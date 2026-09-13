import fs from 'fs-extra';
import path from 'path';

let cachedBrowser = null;
let idleTimer = null;
let detectedExecutablePath = null;
let detectedChannel = null;

/**
 * Dynamically resolves puppeteer or puppeteer-core module
 */
async function getPuppeteer() {
  const tryImports = [
    'puppeteer-core',
    'puppeteer',
    './screenshot-api/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js',
    './screenshot-api/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js'
  ];

  for (const pkg of tryImports) {
    try {
      const mod = await import(pkg);
      return mod.default || mod;
    } catch (e) {
      // continue trying
    }
  }
  return null;
}

/**
 * Finds existing system browser executable path across platforms
 */
function findSystemBrowserPath() {
  if (detectedExecutablePath) return detectedExecutablePath;

  const platform = process.platform;
  const candidates = [];

  if (platform === 'win32') {
    const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || '';

    candidates.push(
      path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Yandex', 'YandexBrowser', 'Application', 'browser.exe')
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    // Linux
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium'
    );
  }

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        detectedExecutablePath = p;
        return p;
      }
    } catch (e) {}
  }

  return null;
}

/**
 * Launches or returns active browser instance
 */
async function getBrowser(puppeteer) {
  if (cachedBrowser && cachedBrowser.connected) {
    resetIdleTimeout();
    return cachedBrowser;
  }

  const commonArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--js-flags="--max-old-space-size=256"'
  ];

  // 1. Try previously detected channel or known system channels
  const channelsToTry = detectedChannel ? [detectedChannel] : ['chrome', 'msedge'];
  for (const channel of channelsToTry) {
    try {
      cachedBrowser = await puppeteer.launch({
        channel,
        args: commonArgs,
        headless: 'new'
      });
      detectedChannel = channel;
      resetIdleTimeout();
      return cachedBrowser;
    } catch (e) {
      // Try next
    }
  }

  // 2. Try explicit executable path
  const execPath = findSystemBrowserPath();
  if (execPath) {
    try {
      cachedBrowser = await puppeteer.launch({
        executablePath: execPath,
        args: commonArgs,
        headless: 'new'
      });
      resetIdleTimeout();
      return cachedBrowser;
    } catch (e) {
      console.warn(`[Local YTree] Failed to launch browser at ${execPath}:`, e.message);
    }
  }

  // 3. Fallback: try default puppeteer launch
  cachedBrowser = await puppeteer.launch({
    args: commonArgs,
    headless: 'new'
  });
  resetIdleTimeout();
  return cachedBrowser;
}

function resetIdleTimeout() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (cachedBrowser) {
      try {
        await cachedBrowser.close();
      } catch (e) {}
      cachedBrowser = null;
    }
  }, 60000); // 60 seconds
}

/**
 * Generates YTree screenshot locally using system browser
 * @param {string} clade - Clade identifier (e.g. E-Y84587)
 * @param {string} theme - 'light' or 'dark'
 * @returns {Promise<{ buffer: Buffer, treeUrl: string }>}
 */
export async function captureYtreeScreenshotLocal(clade, theme = 'light') {
  const puppeteer = await getPuppeteer();
  if (!puppeteer) {
    throw new Error('Puppeteer module not found for local rendering');
  }

  const safeTheme = theme === 'dark' ? 'dark' : 'light';

  // 1. Check canonical ID via SNP API with short timeout
  let resolvedClade = clade;
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`https://snp.apsny.dev/api/search/${encodeURIComponent(clade)}`, {
      signal: controller.signal
    });
    clearTimeout(to);
    if (res.ok) {
      const data = await res.json();
      if (data?.yfullDetails?.canonicalId) {
        resolvedClade = data.yfullDetails.canonicalId;
      }
    }
  } catch (e) {
    // Ignore, use original clade
  }

  const browser = await getBrowser(puppeteer);
  let page = null;

  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });

    const ytreeUrl = `https://ytree.apsny.dev/${encodeURIComponent(resolvedClade)}`;
    await page.goto(ytreeUrl, { waitUntil: 'networkidle2', timeout: 35000 });

    // Wait for tree rows to appear
    let state = null;
    for (let i = 0; i < 80; i++) {
      state = await page.evaluate(() => {
        const findEl = (selector) => {
          const el = document.querySelector(selector);
          if (el) return true;
          const host = document.querySelector('#ajwla-drawer-host');
          if (host && host.shadowRoot) {
            return !!host.shadowRoot.querySelector(selector);
          }
          return false;
        };

        if (findEl('.ajwla-tree-row')) return 'rows';
        if (findEl('.ajwla-drawer-empty')) return 'empty';
        if (findEl('.ajwla-drawer-error')) return 'error';
        return null;
      });

      if (state) break;
      await new Promise(r => setTimeout(r, 250));
    }

    if (!state || state === 'empty' || state === 'error') {
      throw new Error(`Tree state: ${state || 'timeout'}`);
    }

    // Inject override styles
    await page.evaluate(({ safeTheme }) => {
      const style = document.createElement('style');
      style.id = 'local-screenshot-style-override';
      style.textContent = `
        .ajwla-drawer, #ajwla-app-container {
          height: auto !important;
          min-height: 0 !important;
          max-height: none !important;
          overflow: visible !important;
          position: relative !important;
          transform: none !important;
        }
        .ajwla-drawer-body {
          height: auto !important;
          min-height: 0 !important;
          max-height: none !important;
          overflow: visible !important;
          flex: none !important;
          padding: 10px !important;
        }
        .ajwla-copy-snip-btn, .ajwla-warn-banner, #ajwla-clade-path-wrapper, .ajwla-drawer-h,
        footer, .ajwla-banner, .ajwla-legal-footer, .ajwla-banner-mobile-links {
          display: none !important;
        }
      `;

      const host = document.querySelector('#ajwla-drawer-host');
      if (host && host.shadowRoot) {
        host.shadowRoot.appendChild(style);
        const drawer = host.shadowRoot.querySelector('.ajwla-drawer');
        if (drawer) drawer.setAttribute('data-theme', safeTheme);
      } else {
        document.head.appendChild(style);
        const appContainer = document.querySelector('#ajwla-app-container');
        if (appContainer) appContainer.setAttribute('data-theme', safeTheme);
      }
    }, { safeTheme });

    // Dynamic resize
    const docSize = await page.evaluate(() => {
      return {
        width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, 1200),
        height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1600)
      };
    });
    await page.setViewport({ width: docSize.width, height: docSize.height, deviceScaleFactor: 2 });

    await new Promise(r => setTimeout(r, 400));

    // Calculate crop rectangle
    const clipInfo = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('.ajwla-badge, .ajwla-stats, .ajwla-id-row, .ajwla-tree-line'));
      if (elements.length === 0) return null;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          minX = Math.min(minX, rect.left);
          minY = Math.min(minY, rect.top);
          maxX = Math.max(maxX, rect.right);
          maxY = Math.max(maxY, rect.bottom);
        }
      });

      if (minX === Infinity) return null;

      const padding = 20;
      return {
        x: Math.max(0, minX - padding),
        y: Math.max(0, minY - padding),
        width: (maxX - minX) + (padding * 2),
        height: (maxY - minY) + (padding * 2)
      };
    });

    const screenshotOptions = { type: 'png' };
    if (clipInfo) {
      screenshotOptions.clip = clipInfo;
    }

    const buffer = await page.screenshot(screenshotOptions);
    const treeUrl = `https://ytree.apsny.dev/${encodeURIComponent(resolvedClade)}?utm_source=aadna.ru&utm_medium=social&utm_campaign=tree_share&utm_content=${encodeURIComponent(resolvedClade)}`;

    return { buffer, treeUrl };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (e) {}
    }
  }
}

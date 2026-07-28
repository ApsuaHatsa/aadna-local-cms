import Fastify from 'fastify';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.join(__dirname, 'cache');

if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

const fastify = Fastify({ logger: true });

let browser;

// Launch browser once on startup
fastify.addHook('onReady', async () => {
  fastify.log.info('Launching Puppeteer browser...');
  browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--js-flags="--max-old-space-size=256"',
      '--single-process'
    ],
    headless: "new"
  });
  
  // Setup automated cache cleanup every hour
  setInterval(() => {
    try {
      const files = fs.readdirSync(cacheDir);
      const now = Date.now();
      let fileStats = [];
      
      files.forEach(file => {
        const filePath = path.join(cacheDir, file);
        const stats = fs.statSync(filePath);
        // Delete files older than 24 hours
        if (now - stats.mtimeMs > 24 * 60 * 60 * 1000) {
          fs.unlinkSync(filePath);
        } else {
          fileStats.push({ filePath, mtimeMs: stats.mtimeMs });
        }
      });
      
      // Limit to 100 files max to prevent disk exhaustion
      if (fileStats.length > 100) {
        fileStats.sort((a, b) => a.mtimeMs - b.mtimeMs); // Oldest first
        const toDelete = fileStats.slice(0, fileStats.length - 100);
        toDelete.forEach(f => fs.unlinkSync(f.filePath));
      }
    } catch (e) {
      fastify.log.error('Cache cleanup error:', e);
    }
  }, 60 * 60 * 1000); // 1 hour
});

fastify.addHook('onClose', async () => {
  if (browser) await browser.close();
});

fastify.get('/api/screenshot', async (request, reply) => {
  const { clade, theme = 'light', source } = request.query;

  if (!clade) {
    return reply.code(400).send({ error: 'Missing clade parameter' });
  }

  // Basic sanitization
  const safeClade = clade.replace(/[^a-zA-Z0-9\-_]/g, '_');
  const safeTheme = theme === 'dark' ? 'dark' : 'light';

  // Determine UTM source from query param or User-Agent header
  let utmSource = 'social';
  if (source) {
    utmSource = source;
  } else {
    const ua = request.headers['user-agent'] || '';
    if (/telegram/i.test(ua)) {
      utmSource = 'telegram';
    } else if (/facebook/i.test(ua) || /facebot/i.test(ua)) {
      utmSource = 'facebook';
    } else if (/twitter/i.test(ua) || /t.co/i.test(ua)) {
      utmSource = 'twitter';
    } else if (/discord/i.test(ua)) {
      utmSource = 'discord';
    } else if (/whatsapp/i.test(ua)) {
      utmSource = 'whatsapp';
    } else if (/vk/i.test(ua)) {
      utmSource = 'vk';
    } else if (/slack/i.test(ua)) {
      utmSource = 'slack';
    } else if (/linkedin/i.test(ua)) {
      utmSource = 'linkedin';
    }
  }

  // 1. Resolve synonym if FTDNA format or check canonical id on snp.apsny.dev
  let resolvedClade = clade;
  try {
    const res = await fetch(`https://snp.apsny.dev/api/search/${encodeURIComponent(clade)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.yfullDetails && data.yfullDetails.canonicalId) {
        resolvedClade = data.yfullDetails.canonicalId;
      }
    }
  } catch (err) {
    fastify.log.warn(`Failed to resolve clade "${clade}" via snp.apsny.dev: ${err.message}`);
  }

  const safeResolvedClade = resolvedClade.replace(/[^a-zA-Z0-9\-_]/g, '_');
  const cachePath = path.join(cacheDir, `${safeResolvedClade}_${safeTheme}.png`);
  const missingCachePath = path.join(cacheDir, `${safeResolvedClade}.missing`);

  // 2. Check if known to be missing (cached for 24 hours)
  if (fs.existsSync(missingCachePath)) {
    const stats = fs.statSync(missingCachePath);
    const ageMs = Date.now() - stats.mtimeMs;
    if (ageMs < 24 * 60 * 60 * 1000) {
      return reply.code(404).send({ error: 'Branch not found on the tree', clade: resolvedClade });
    }
  }

  // 3. Check cache for screenshot (cache for 24 hours)
  if (fs.existsSync(cachePath)) {
    const stats = fs.statSync(cachePath);
    const ageMs = Date.now() - stats.mtimeMs;
    if (ageMs < 24 * 60 * 60 * 1000) {
      const buffer = fs.readFileSync(cachePath);
      const treeUrl = `https://ytree.apsny.dev/${encodeURIComponent(resolvedClade)}?utm_source=${encodeURIComponent(utmSource)}&utm_medium=social&utm_campaign=tree_share&utm_content=${encodeURIComponent(resolvedClade)}`;
      reply.header('X-Tree-URL', treeUrl);
      reply.header('Content-Type', 'image/png');
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(buffer);
    }
  }

  const url = `https://ytree.apsny.dev/${encodeURIComponent(resolvedClade)}`;
  let page;

  try {
    page = await browser.newPage();
    
    // Set a large viewport so the tree doesn't get clamped by responsive design
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 600000 });

    // Wait for the tree, empty state, or error state to load
    let state = null;
    for (let i = 0; i < 240; i++) { // 60 seconds max (240 * 250ms)
      state = await page.evaluate(() => {
        const findEl = (selector) => {
          const light = document.querySelector(selector);
          if (light) return true;
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

    if (!state) {
      throw new Error('Timeout waiting for tree load state');
    }

    if (state === 'empty') {
      // Save empty state to cache to avoid hitting Puppeteer again
      fs.writeFileSync(missingCachePath, '');
      return reply.code(404).send({ error: 'Branch not found on the tree', clade: resolvedClade });
    }

    if (state === 'error') {
      return reply.code(500).send({ error: 'Failed to load branch data', clade: resolvedClade });
    }

    // Inject CSS to remove fixed heights, scrollbars, and backgrounds for a clean screenshot
    await page.evaluate(({ safeTheme }) => {
      const style = document.createElement('style');
      style.id = 'screenshot-style-override';
      style.textContent = `
        /* Override styles for clean screenshot */
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
        /* Hide things we don't want in the screenshot */
        .ajwla-copy-snip-btn, .ajwla-warn-banner, #ajwla-clade-path-wrapper, .ajwla-drawer-h,
        footer, .ajwla-banner, .ajwla-legal-footer, .ajwla-banner-mobile-links {
          display: none !important;
        }
      `;
      
      const host = document.querySelector('#ajwla-drawer-host');
      if (host && host.shadowRoot) {
        host.shadowRoot.appendChild(style);
        const drawer = host.shadowRoot.querySelector('.ajwla-drawer');
        if (drawer) {
          drawer.setAttribute('data-theme', safeTheme);
        }
      } else {
        document.head.appendChild(style);
        const appContainer = document.querySelector('#ajwla-app-container');
        if (appContainer) {
          appContainer.setAttribute('data-theme', safeTheme);
        }
      }
    }, { safeTheme });

    // Dynamically resize viewport to match document size to render large trees without cutoff
    const docSize = await page.evaluate(() => {
      return {
        width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, 1200),
        height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1600)
      };
    });
    await page.setViewport({ width: docSize.width, height: docSize.height, deviceScaleFactor: 2 });

    // Short wait for any animations to settle
    await new Promise(r => setTimeout(r, 500));

    // Calculate exact bounding box of the tree elements to clip the screenshot perfectly
    const clipInfo = await page.evaluate(() => {
      // Find all tree badges, stats texts, connection lines, and sample rows
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

    // Take the screenshot using computed clip info
    const buffer = await page.screenshot(screenshotOptions);

    // Save to cache
    fs.writeFileSync(cachePath, buffer);

    const treeUrl = `https://ytree.apsny.dev/${encodeURIComponent(resolvedClade)}?utm_source=${encodeURIComponent(utmSource)}&utm_medium=social&utm_campaign=tree_share&utm_content=${encodeURIComponent(resolvedClade)}`;
    reply.header('X-Tree-URL', treeUrl);
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(buffer);

  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: 'Failed to generate screenshot', details: err.message });
  } finally {
    if (page) await page.close();
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3005, host: '0.0.0.0' });
    console.log('Screenshot API running at http://0.0.0.0:3005');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

import fs from 'fs-extra';
import path from 'path';
import matter from 'gray-matter';
import yaml from 'yaml';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { captureYtreeScreenshotLocal } from '../lib/ytree-screenshot.js';

// Переопределяем движок YAML для gray-matter
matter.engines.yaml = {
  parse: yaml.parse.bind(yaml),
  stringify: function(data, options) {
    return yaml.stringify(data, { lineWidth: 0 });
  }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AADNA_PATH = path.resolve(__dirname, '../../aadna');

const forceAll = process.argv.includes('--force') || process.argv.includes('-f');

async function fetchYtreeScreenshot(clade, slug) {
  const themes = ['light', 'dark'];
  const mediaDir = path.join(AADNA_PATH, 'static', 'media', 'results', slug);
  const publicMediaDir = path.join(AADNA_PATH, 'public', 'media', 'results', slug);
  await fs.ensureDir(mediaDir);

  let successCount = 0;
  let treeUrl = '';
  const baseUrl = (process.env.YTREE_API_URL || 'https://ytree-api.apsny.dev').replace(/\/$/, '');

  for (const theme of themes) {
    const cleanClade = clade.replace(/[^a-zA-Z0-9-]/g, '');
    const filename = `ytree_${cleanClade}_${theme}.png`;
    const targetPath = path.join(mediaDir, filename);
    const publicTargetPath = path.join(publicMediaDir, filename);
    const cloudUrl = `${baseUrl}/api/screenshot?clade=${encodeURIComponent(clade)}${theme === 'dark' ? '&theme=dark' : ''}`;

    let buffer = null;

    // 1. Приоритет: локальный headless-рендерер (быстро: 2-5 сек)
    try {
      console.log(`  - Generating local YTree screenshot (${theme} theme)...`);
      const localRes = await captureYtreeScreenshotLocal(clade, theme);
      if (localRes && localRes.buffer) {
        buffer = localRes.buffer;
        if (!treeUrl && localRes.treeUrl) treeUrl = localRes.treeUrl;
        console.log(`  - [Local Engine] Successfully captured ${filename} (${buffer.length} bytes)`);
      }
    } catch (localErr) {
      console.warn(`  - [Local Engine] Skipped (${localErr.message}), trying cloud API...`);
    }

    // 2. Фоллбек: облачный API
    if (!buffer) {
      try {
        console.log(`  - Fetching from cloud API (${theme} theme)...`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);
        const response = await fetch(cloudUrl, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const json = await response.json();
          throw new Error(json.error || 'Branch not found on the tree');
        }

        if (!treeUrl) treeUrl = response.headers.get('x-tree-url') || '';
        const arrayBuffer = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
        console.log(`  - [Cloud Engine] Successfully fetched ${filename} (${buffer.length} bytes)`);
      } catch (cloudErr) {
        console.error(`  - Failed to generate (${theme}):`, cloudErr.message);
      }
    }

    if (buffer) {
      await fs.writeFile(targetPath, buffer);
      if (await fs.pathExists(publicMediaDir)) {
        await fs.writeFile(publicTargetPath, buffer).catch(() => {});
      }
      successCount++;
    }
  }

  if (!treeUrl) {
    treeUrl = `https://ytree.apsny.dev/${encodeURIComponent(clade)}?utm_source=aadna.ru&utm_medium=social&utm_campaign=tree_share&utm_content=${encodeURIComponent(clade)}`;
  }

  return { success: successCount === 2, link: treeUrl };
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function main() {
  console.log('====================================================');
  console.log('🧬 YTree Bulk Sync - Apsny Production Inc. (API)');
  console.log(`Mode: ${forceAll ? 'FORCE ALL (regenerate all)' : 'SMART (auto-detect missing & placeholder cards)'}`);
  console.log('====================================================\n');

  const resultsDir = path.join(AADNA_PATH, 'content', 'results');

  if (!await fs.pathExists(resultsDir)) {
    console.error(`Directory not found: ${resultsDir}`);
    return;
  }

  const files = await fs.readdir(resultsDir);
  const mdFiles = files.filter(f => f.endsWith('.md') && f !== '_index.md');

  console.log(`Found ${mdFiles.length} result posts. Analyzing...\n`);

  const apiCache = new Map();
  let processed = 0;
  let updated = 0;
  let skipped = 0;

  for (const file of mdFiles) {
    const slug = file.replace('.md', '');
    const filePath = path.join(resultsDir, file);
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(raw);

    const customClade = parsed.data.extra?.details_y?.ytree_clade;
    const defaultClade = parsed.data.extra?.y_subclade;
    const ySubclade = (customClade && customClade.trim()) ? customClade.trim() : defaultClade;

    if (!ySubclade) {
      skipped++;
      continue;
    }

    const cladeClean = ySubclade.replace(/[^a-zA-Z0-9-]/g, '');
    const lightPath = path.join(AADNA_PATH, 'static', 'media', 'results', slug, `ytree_${cladeClean}_light.png`);
    const darkPath = path.join(AADNA_PATH, 'static', 'media', 'results', slug, `ytree_${cladeClean}_dark.png`);

    const hasLight = await fs.pathExists(lightPath);
    const hasDark = await fs.pathExists(darkPath);

    // Проверка на наличие старых Satori-карточек (1200x630)
    let isPlaceholder = false;
    if (hasLight) {
      try {
        const meta = await sharp(lightPath).metadata();
        if (meta.width === 1200 && meta.height === 630) {
          isPlaceholder = true;
        }
      } catch (e) {}
    }

    // Проверка актуальности разметки в Markdown
    const hasHtml = parsed.data.extra?.details_y?.ytree_tree?.includes(`ytree_${cladeClean}_light.png`) &&
                    parsed.data.extra?.details_y?.ytree_tree?.includes('ytree-img-light');

    if (hasLight && hasDark && hasHtml && !isPlaceholder && !forceAll) {
      skipped++;
      continue;
    }

    const reason = forceAll 
      ? 'force flag' 
      : isPlaceholder 
        ? 'placeholder card detected (1200x630)' 
        : (!hasLight || !hasDark) 
          ? 'missing screenshot files' 
          : 'outdated HTML layout';

    console.log(`[${processed + 1}/${mdFiles.length}] Processing ${slug} (clade: ${ySubclade}, reason: ${reason})`);

    let fetchRes;
    if (apiCache.has(ySubclade) && !forceAll) {
      const cached = apiCache.get(ySubclade);
      console.log(`  - [Cache Hit] Copying screenshots for ${ySubclade} from ${cached.slug}...`);
      try {
        const mediaDir = path.join(AADNA_PATH, 'static', 'media', 'results', slug);
        const publicMediaDir = path.join(AADNA_PATH, 'public', 'media', 'results', slug);
        await fs.ensureDir(mediaDir);
        await fs.copy(cached.lightSourcePath, lightPath);
        await fs.copy(cached.darkSourcePath, darkPath);

        if (await fs.pathExists(publicMediaDir)) {
          await fs.copy(cached.lightSourcePath, path.join(publicMediaDir, `ytree_${cladeClean}_light.png`)).catch(() => {});
          await fs.copy(cached.darkSourcePath, path.join(publicMediaDir, `ytree_${cladeClean}_dark.png`)).catch(() => {});
        }
        fetchRes = { success: true, link: cached.link };
      } catch (err) {
        console.error(`  - Failed to copy from cache, falling back to render:`, err.message);
        await delay(500);
        fetchRes = await fetchYtreeScreenshot(ySubclade, slug);
      }
    } else {
      fetchRes = await fetchYtreeScreenshot(ySubclade, slug);
      if (fetchRes.success) {
        apiCache.set(ySubclade, {
          slug,
          link: fetchRes.link,
          lightSourcePath: lightPath,
          darkSourcePath: darkPath
        });
      }
    }

    if (fetchRes.success || (hasLight && hasDark && !isPlaceholder)) {
      if (!parsed.data.extra.details_y) {
        parsed.data.extra.details_y = {};
      }

      const imgHtml = 
        `<img src="/media/results/${slug}/ytree_${cladeClean}_light.png" class="no-zoom ytree-img-light block w-full rounded-lg shadow-lg hover:opacity-90 transition-opacity cursor-pointer" alt="YTree ${cladeClean}">\n` +
        `<img src="/media/results/${slug}/ytree_${cladeClean}_dark.png" class="no-zoom ytree-img-dark hidden w-full rounded-lg shadow-lg hover:opacity-90 transition-opacity cursor-pointer" alt="YTree ${cladeClean}">`;

      let finalLink = fetchRes.link || `https://ytree.apsny.dev/${cladeClean}`;
      try {
        const u = new URL(finalLink);
        u.search = '';
        u.searchParams.set('utm_source', 'aadna.ru');
        u.searchParams.set('utm_medium', '/' + slug);
        u.searchParams.set('utm_campaign', 'aadna_referrals');
        u.searchParams.set('utm_content', cladeClean);
        finalLink = u.toString();
      } catch (e) {
        // Fallback
      }

      if (finalLink) {
        parsed.data.extra.details_y.ytree_tree = `<a href="${finalLink}" target="_blank" rel="noopener noreferrer" class="block">\n${imgHtml}\n</a>`;
      } else {
        parsed.data.extra.details_y.ytree_tree = imgHtml;
      }

      const fileContent = matter.stringify(parsed.content, parsed.data, { lineWidth: -1 });
      await fs.writeFile(filePath, fileContent);
      updated++;
      console.log(`  - Updated markdown for ${slug}\n`);
    } else {
      if (parsed.data.extra?.details_y?.ytree_tree && isPlaceholder) {
        // Не удаляем, если не удалось снять новый, но логируем
        console.warn(`  - Keep existing screenshot for ${slug} due to render issue\n`);
      } else {
        console.log(`  - Skipping markdown update due to fetch errors\n`);
      }
    }

    processed++;
  }

  console.log(`\n====================================================`);
  console.log(`✨ Sync completed!`);
  console.log(`Total posts: ${mdFiles.length}`);
  console.log(`Updated:     ${updated}`);
  console.log(`Skipped:     ${skipped}`);
  console.log(`====================================================\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

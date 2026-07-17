import fs from 'fs-extra';
import path from 'path';
import matter from 'gray-matter';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AADNA_PATH = path.resolve(__dirname, '../../aadna');

async function fetchYtreeScreenshot(clade, slug) {
  const themes = ['light', 'dark'];
  const mediaDir = path.join(AADNA_PATH, 'static', 'media', 'results', slug);
  await fs.ensureDir(mediaDir);

  let successCount = 0;
  let treeUrl = '';

  for (const theme of themes) {
    const filename = `ytree_\$\{clade.replace(/[^a-zA-Z0-9-]/g, '')\}_\$\{theme\}.png`;
    const targetPath = path.join(mediaDir, filename);
    const url = `https://ytree-api.apsny.dev/api/screenshot?clade=\$\{clade\}\$\{theme === 'dark' ? '&theme=dark' : ''\}`;

    try {
      if (await fs.pathExists(targetPath)) {
        successCount++;
        if (!treeUrl) {
          const headRes = await fetch(url, { method: 'HEAD' });
          if (headRes.ok) treeUrl = headRes.headers.get('x-tree-url') || '';
        }
        continue;
      }

      console.log(`  - Fetching YTree screenshot (\$\{theme\} theme)...`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`HTTP \$\{response.status\}`);
      
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const json = await response.json();
        throw new Error(json.error || 'Branch not found on the tree');
      }

      if (!treeUrl) treeUrl = response.headers.get('x-tree-url') || '';

      const arrayBuffer = await response.arrayBuffer();
      await fs.writeFile(targetPath, Buffer.from(arrayBuffer));
      console.log(`  - Successfully saved \$\{filename\}`);
      successCount++;
    } catch (err) {
      console.error(`  - Failed to fetch (\$\{theme\}):`, err.message);
      return { success: false, link: '' };
    }
  }
  return { success: successCount === 2, link: treeUrl };
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function main() {
  console.log('Starting YTree bulk sync...');
  const resultsDir = path.join(AADNA_PATH, 'content', 'results');
  
  if (!await fs.pathExists(resultsDir)) {
    console.error(`Directory not found: \${resultsDir}`);
    return;
  }

  const files = await fs.readdir(resultsDir);
  const mdFiles = files.filter(f => f.endsWith('.md') && f !== '_index.md');
  
  console.log(`Found \${mdFiles.length} result posts. Processing...`);
  
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  
  for (const file of mdFiles) {
    const slug = file.replace('.md', '');
    const filePath = path.join(resultsDir, file);
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(raw);
    
    const ySubclade = parsed.data.extra?.y_subclade;
    if (!ySubclade) {
      skipped++;
      continue;
    }

    const cladeClean = ySubclade.replace(/[^a-zA-Z0-9-]/g, '');
    const lightPath = path.join(AADNA_PATH, 'static', 'media', 'results', slug, `ytree_\${cladeClean}_light.png`);
    const darkPath = path.join(AADNA_PATH, 'static', 'media', 'results', slug, `ytree_\${cladeClean}_dark.png`);
    
    const hasLight = await fs.pathExists(lightPath);
    const hasDark = await fs.pathExists(darkPath);
    
    // Check if the HTML is already injected
    const hasHtml = parsed.data.extra?.details_y?.ytree_tree?.includes(`ytree_\${cladeClean}_light.png`);

    if (hasLight && hasDark && hasHtml) {
      skipped++;
      continue;
    }

    console.log(`[\${processed + 1}/\${mdFiles.length}] Processing \${slug} (clade: \${ySubclade})`);
    
    // Throttle requests to avoid DDoS on the VPS
    await delay(1500); // 1.5 second delay between processing each post
    
    const success = await fetchYtreeScreenshot(ySubclade, slug);
    
    if (success || (hasLight && hasDark)) {
      if (!parsed.data.extra.details_y) {
        parsed.data.extra.details_y = {};
      }
      
      parsed.data.extra.details_y.ytree_tree = 
        `<img src="/media/results/\${slug}/ytree_\${cladeClean}_light.png" class="block dark:hidden w-full rounded-lg shadow-lg" alt="YTree \${cladeClean}">\\n` +
        `<img src="/media/results/\${slug}/ytree_\${cladeClean}_dark.png" class="hidden dark:block w-full rounded-lg shadow-lg" alt="YTree \${cladeClean}">`;
        
      const fileContent = matter.stringify(parsed.content, parsed.data, { lineWidth: -1 });
      await fs.writeFile(filePath, fileContent);
      updated++;
      console.log(`  - Updated markdown for \${slug}`);
    } else {
      console.log(`  - Skipping markdown update due to fetch errors`);
    }
    
    processed++;
  }
  
  console.log(`\\nDone! Total files: \${mdFiles.length}, Updated: \${updated}, Skipped/No-op: \${skipped}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

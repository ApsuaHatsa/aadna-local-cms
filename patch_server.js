import fs from 'fs';
let code = fs.readFileSync('server.js', 'utf8');
code = code.replace(
/async function fetchYtreeScreenshot\(clade, slug\) \{[\s\S]*?return successCount === 2;\n\}/m,
`async function fetchYtreeScreenshot(clade, slug) {
  const themes = ['light', 'dark'];
  const mediaDir = require('path').join(AADNA_PATH, 'static', 'media', 'results', slug);
  await fs.ensureDir(mediaDir);

  let successCount = 0;
  let treeUrl = '';

  for (const theme of themes) {
    const filename = \\\`ytree_\\$\\{clade.replace(/[^a-zA-Z0-9-]/g, '')\\}_\\$\\{theme\\}.png\\\`;
    const targetPath = require('path').join(mediaDir, filename);
    const url = \\\`https://ytree-api.apsny.dev/api/screenshot?clade=\\$\\{clade\\}\\$\\{theme === 'dark' ? '&theme=dark' : ''\\}\\\`;

    try {
      if (await fs.pathExists(targetPath)) {
        successCount++;
        if (!treeUrl) {
          const headRes = await fetch(url, { method: 'HEAD' });
          if (headRes.ok) treeUrl = headRes.headers.get('x-tree-url') || '';
        }
        continue;
      }

      console.log(\\\`Fetching YTree screenshot for \\$\\{clade\\} (\\$\\{theme\\} theme)...\\\`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(\\\`HTTP \\$\\{response.status\\}\\\`);
      
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const json = await response.json();
        throw new Error(json.error || 'Branch not found on the tree');
      }

      if (!treeUrl) treeUrl = response.headers.get('x-tree-url') || '';

      const arrayBuffer = await response.arrayBuffer();
      await fs.writeFile(targetPath, Buffer.from(arrayBuffer));
      console.log(\\\`Successfully saved \\$\\{filename\\}\\\`);
      successCount++;
    } catch (err) {
      console.error(\\\`Failed to fetch YTree screenshot (\\$\\{theme\\}):\\\`, err.message);
    }
  }
  return { success: successCount === 2, link: treeUrl };
}`
);
code = code.replace(
/\/\/ Фоновая загрузка\n\s*await fetchYtreeScreenshot\(normalized\.extra\.y_subclade, targetSlug\);\n\s*if \(\!normalized\.extra\.details_y\) \{\n\s*normalized\.extra\.details_y = \{\};\n\s*\}\n\s*\/\/ Вставляем HTML-код с двумя темами\n\s*normalized\.extra\.details_y\.ytree_tree = \n\s*\`\<img src=\"\/media\/results\/\$\{targetSlug\}\/ytree_\$\{clade\}_light\.png\" class=\"block dark:hidden w-full rounded-lg shadow-lg\" alt=\"YTree \$\{clade\}\"\>\\n\` \+\n\s*\`\<img src=\"\/media\/results\/\$\{targetSlug\}\/ytree_\$\{clade\}_dark\.png\" class=\"hidden dark:block w-full rounded-lg shadow-lg\" alt=\"YTree \$\{clade\}\"\>\`;/m,
`// Фоновая загрузка
        const fetchRes = await fetchYtreeScreenshot(normalized.extra.y_subclade, targetSlug);
        
        if (!normalized.extra.details_y) {
          normalized.extra.details_y = {};
        }
        
        // Вставляем HTML-код с двумя темами и оборачиваем в ссылку
        const imgHtml = 
          \\\`<img src="/media/results/\\$\\{targetSlug\\}/ytree_\\$\\{clade\\}_light.png" class="block dark:hidden w-full rounded-lg shadow-lg hover:opacity-90 transition-opacity" alt="YTree \\$\\{clade\\}">\\n\` +
          \\\`<img src="/media/results/\\$\\{targetSlug\\}/ytree_\\$\\{clade\\}_dark.png" class="hidden dark:block w-full rounded-lg shadow-lg hover:opacity-90 transition-opacity" alt="YTree \\$\\{clade\\}">\\\`;
          
        if (fetchRes.link) {
          normalized.extra.details_y.ytree_tree = \\\`<a href="\\$\\{fetchRes.link\\}" target="_blank" rel="noopener noreferrer" class="block">\\n\\$\\{imgHtml\\}\\n</a>\\\`;
        } else {
          normalized.extra.details_y.ytree_tree = imgHtml;
        }`
);
fs.writeFileSync('server.js', code);

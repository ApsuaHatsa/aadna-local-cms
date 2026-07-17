import fs from 'fs';
let code = fs.readFileSync('scripts/sync-ytree.js', 'utf8');
code = code.replace(
/async function fetchYtreeScreenshot\(clade, slug\) \{[\s\S]*?return successCount === 2;\n\}/m,
`async function fetchYtreeScreenshot(clade, slug) {
  const themes = ['light', 'dark'];
  const mediaDir = path.join(AADNA_PATH, 'static', 'media', 'results', slug);
  await fs.ensureDir(mediaDir);

  let successCount = 0;
  let treeUrl = '';

  for (const theme of themes) {
    const filename = \\\`ytree_\\$\\{clade.replace(/[^a-zA-Z0-9-]/g, '')\\}_\\$\\{theme\\}.png\\\`;
    const targetPath = path.join(mediaDir, filename);
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

      console.log(\\\`  - Fetching YTree screenshot (\\$\\{theme\\} theme)...\\\`);
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
      console.log(\\\`  - Successfully saved \\$\\{filename\\}\\\`);
      successCount++;
    } catch (err) {
      console.error(\\\`  - Failed to fetch (\\$\\{theme\\}):\\\`, err.message);
      return { success: false, link: '' };
    }
  }
  return { success: successCount === 2, link: treeUrl };
}`
);
code = code.replace(
/const success = await fetchYtreeScreenshot\(ySubclade, slug\);\n\s*if \(success \|\| \(hasLight && hasDark\)\) \{\n\s*if \(\!parsed\.data\.extra\.details_y\) \{\n\s*parsed\.data\.extra\.details_y = \{\};\n\s*\}\n\s*parsed\.data\.extra\.details_y\.ytree_tree = \n\s*\`\<img src=\"\/media\/results\/\$\{slug\}\/ytree_\$\{cladeClean\}_light\.png\" class=\"block dark:hidden w-full rounded-lg shadow-lg\" alt=\"YTree \$\{cladeClean\}\"\>\\n\` \+\n\s*\`\<img src=\"\/media\/results\/\$\{slug\}\/ytree_\$\{cladeClean\}_dark\.png\" class=\"hidden dark:block w-full rounded-lg shadow-lg\" alt=\"YTree \$\{cladeClean\}\"\>\`;/m,
`const fetchRes = await fetchYtreeScreenshot(ySubclade, slug);
    
    if (fetchRes.success || (hasLight && hasDark)) {
      if (!parsed.data.extra.details_y) {
        parsed.data.extra.details_y = {};
      }
      
      const imgHtml = 
        \\\`<img src="/media/results/\\$\\{slug\\}/ytree_\\$\\{cladeClean\\}_light.png" class="block dark:hidden w-full rounded-lg shadow-lg hover:opacity-90 transition-opacity" alt="YTree \\$\\{cladeClean\\}">\\n\` +
        \\\`<img src="/media/results/\\$\\{slug\\}/ytree_\\$\\{cladeClean\\}_dark.png" class="hidden dark:block w-full rounded-lg shadow-lg hover:opacity-90 transition-opacity" alt="YTree \\$\\{cladeClean\\}">\\\`;
        
      if (fetchRes.link) {
        parsed.data.extra.details_y.ytree_tree = \\\`<a href="\\$\\{fetchRes.link\\}" target="_blank" rel="noopener noreferrer" class="block">\\n\\$\\{imgHtml\\}\\n</a>\\\`;
      } else {
        parsed.data.extra.details_y.ytree_tree = imgHtml;
      }`
);
fs.writeFileSync('scripts/sync-ytree.js', code);

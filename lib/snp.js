import fs from 'fs-extra';
import path from 'path';

const DATA_DIR = '../aadna/data/paths';

function parsePathValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (
        item && typeof item === 'object' && 'name' in item
          ? item.name
          : item
      ))
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/\s*>\s*/).map((item) => item.trim()).filter(Boolean);
  }
  if (value && typeof value === 'object' && 'string' in value) {
    return parsePathValue(value.string);
  }
  return [];
}

export async function syncSnpPath(snp) {
  if (!snp) return;

  await fs.ensureDir(DATA_DIR);
  const snpFile = path.resolve(DATA_DIR, `${snp}.json`);

  // Проверяем, существует ли уже файл в правильном формате
  if (await fs.pathExists(snpFile)) {
    try {
      const existing = await fs.readJSON(snpFile);
      if (existing && typeof existing === 'object' && !Array.isArray(existing) && ('yfull' in existing || 'ftdna' in existing)) {
        // Файл корректен, не нужно перекачивать
        return;
      }
    } catch (e) {
      // Игнорируем ошибку и перезаписываем файл
    }
  }

  console.log(`[SNP Sync] Fetching path for ${snp}...`);
  try {
    const response = await fetch(`https://snp.apsny.dev/api/search/${encodeURIComponent(snp)}`, {
      headers: { 'User-Agent': 'AADNA-Local-CMS/1.0' },
    });

    if (!response.ok) {
      console.warn(`[SNP Sync] Failed to fetch ${snp}: HTTP ${response.status}`);
      return;
    }

    const data = await response.json();
    const yfullPath = parsePathValue(data?.yfullDetails?.path);
    const ftdnaPath = parsePathValue(data?.ftdnaDetails?.path);

    const result = {
      yfull: yfullPath,
      ftdna: ftdnaPath
    };

    await fs.writeJSON(snpFile, result, { spaces: 2 });
    console.log(`[SNP Sync] Saved ${snp} -> YFull: ${yfullPath.length} nodes, FTDNA: ${ftdnaPath.length} nodes`);
  } catch (error) {
    console.error(`[SNP Sync] Error fetching SNP ${snp}:`, error);
  }
}

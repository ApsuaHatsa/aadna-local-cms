import fs from 'fs-extra';
import path from 'path';
import { createHash } from 'crypto';
import yaml from 'yaml';
import sharp from 'sharp';
import QRCode from 'qrcode';

const ROOT = path.resolve(process.cwd(), '../aadna');
const ASSETS_DIR = path.join(ROOT, 'static/preview-assets');
const OUTPUT_DIR = path.join(ROOT, 'static/og/results');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const RULES_PATH = path.join(ROOT, 'data/preview-rules.yml');
const SITE_URL = 'https://aadna.ru'; // или https://aadna.apsny.dev

const GENERATOR_VERSION = '2.0.5';

function loadRules() {
  const raw = fs.readFileSync(RULES_PATH, 'utf-8');
  return yaml.parse(raw);
}

function loadManifest() {
  if (fs.existsSync(MANIFEST_PATH)) {
    return fs.readJSONSync(MANIFEST_PATH);
  }
  return {};
}

function saveManifest(manifest) {
  fs.ensureDirSync(OUTPUT_DIR);
  fs.writeJSONSync(MANIFEST_PATH, manifest, { spaces: 2 });
}

function parseHaplogroupLines(overview) {
  if (!overview) return [];

  const lines = overview.split('\n');
  const result = [];

  let headerIdx = -1;
  let snpColIdx = -1;
  let levelColIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.includes('Уровень') && line.includes('SNP')) {
      const cols = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
      levelColIdx = cols.findIndex(c => c === 'Уровень');
      snpColIdx = cols.findIndex(c => c === 'SNP');
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1 || snpColIdx === -1) return [];

  const levelMap = {
    'основная': 'main',
    'промежуточный': 'intermediate',
    'терминальный': 'terminal',
  };

  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;

    const cols = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (cols.length <= snpColIdx) continue;

    const level = cols[levelColIdx]?.toLowerCase().trim();
    if (!levelMap[level]) continue;

    let snp = cols[snpColIdx];
    const linkMatch = snp.match(/\[([^\]]+)\]/);
    if (linkMatch) {
      snp = linkMatch[1];
    }
    snp = snp.trim();
    if (snp) result.push(snp);
  }

  return result;
}

function resolveFlag(ethnos, rules, overrideFlag) {
  if (overrideFlag) {
    const flagPath = path.join(ASSETS_DIR, 'flags', `${overrideFlag}.svg`);
    return fs.existsSync(flagPath) ? flagPath : null;
  }
  if (!ethnos) return null;

  const flagName = rules.flags[ethnos] ||
    rules.flags[Object.keys(rules.flags).find(k => k.toLowerCase().trim() === ethnos.toLowerCase().trim())];
  if (!flagName) return null;

  const flagPath = path.join(ASSETS_DIR, 'flags', `${flagName}.svg`);
  return fs.existsSync(flagPath) ? flagPath : null;
}

function normalizeValues(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function resolveLabLogo(laboratory, resultType, rules, overrideLab) {
  if (overrideLab) {
    const labPath = path.join(ASSETS_DIR, 'labs', `${overrideLab}.svg`);
    return fs.existsSync(labPath) ? labPath : null;
  }
  if (!laboratory) return null;

  const normalizedLab = laboratory.toLowerCase().trim();
  const resultTypes = normalizeValues(resultType).map(item => String(item).toUpperCase().trim());
  const conditionalLab = rules.conditional_labs?.find(rule => {
    const ruleLab = String(rule.laboratory || '').toLowerCase().trim();
    const ruleResultType = String(rule.result_type || '').toUpperCase().trim();
    return ruleLab === normalizedLab && resultTypes.includes(ruleResultType);
  });
  if (conditionalLab?.logo) {
    const conditionalPath = path.join(ASSETS_DIR, 'labs', `${conditionalLab.logo}.svg`);
    return fs.existsSync(conditionalPath) ? conditionalPath : null;
  }

  const labName = rules.labs[laboratory] ||
    rules.labs[Object.keys(rules.labs).find(k => k.toLowerCase().trim() === laboratory.toLowerCase().trim())];
  if (!labName) return null;

  const labPath = path.join(ASSETS_DIR, 'labs', `${labName}.svg`);
  return fs.existsSync(labPath) ? labPath : null;
}

function fileHash(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

function computeInputHash(data, flagPath, labPath) {
  const hashInput = JSON.stringify({
    version: GENERATOR_VERSION,
    title: data.title,
    flag: data.flag,
    laboratory: data.laboratory,
    haplogroupLines: data.haplogroupLines,
    settlement: data.settlement,
    canonicalUrl: data.canonicalUrl,
    rulesHash: fileHash(RULES_PATH),
    flagAssetHash: fileHash(flagPath),
    labAssetHash: fileHash(labPath),
    aadnaLogoHash: fileHash(path.join(ASSETS_DIR, 'logos/aadna.svg')),
  });
  return createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
}

function surnameSize(text) {
  const len = text.length;
  if (len <= 7) return 160;
  if (len <= 10) return 140;
  if (len <= 14) return 115;
  if (len <= 20) return 95;
  return 75;
}

function haploFontSize(text) {
  const len = text.length;
  if (len <= 4) return 72;
  if (len <= 8) return 62;
  if (len <= 12) return 52;
  return 42;
}

async function generateQR(url) {
  const qrSvg = await QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    color: { dark: '#1B3A5C', light: '#FFFFFF00' },
    width: 180,
  });
  return qrSvg;
}

function embedSvg(filePath, width, height) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  const svgContent = fs.readFileSync(filePath, 'utf-8');
  const b64 = Buffer.from(svgContent).toString('base64');
  return `<image href="data:image/svg+xml;base64,${b64}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`;
}

function escXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function buildSvg(data, flagPath, labPath) {
  const W = 1200;
  const H = 630;
  const NAVY = '#1B3A5C';
  const centerX = W / 2;

  const displayTitle = data.titleMain || data.title;
  const fontSize = surnameSize(displayTitle);
  const titleY = Math.round(fontSize * 0.85) + 15;

  const qrSvg = await generateQR(data.canonicalUrl);
  const qrInner = qrSvg
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '');

  const aadnaLogoPath = path.join(ASSETS_DIR, 'logos/aadna.svg');

  let haploHtml = '';
  if (data.haplogroupLines.length > 0) {
    const rightX = 1000;
    const startY = 260;
    const lineGap = 110;
    data.haplogroupLines.forEach((line, i) => {
      const fs = haploFontSize(line);
      const yPos = startY + i * lineGap;
      haploHtml += `<text x="${rightX}" y="${yPos}" text-anchor="middle" fill="${NAVY}" font-family="Georgia, 'Times New Roman', 'Noto Serif', serif" font-size="${fs}" font-weight="bold">${escXml(line)}</text>\n`;
    });
  }

  let settlementHtml = '';
  if (data.settlement) {
    settlementHtml = `<text x="1000" y="575" text-anchor="middle" fill="${NAVY}" font-family="Georgia, 'Times New Roman', 'Noto Serif', serif" font-size="36">${escXml(data.settlement)}</text>`;
  }

  let flagHtml = '';
  if (flagPath) {
    flagHtml = `<g transform="translate(-65, 158)">${embedSvg(flagPath, 510, 306)}</g>`;
  }

  let labHtml = '';
  if (labPath) {
    if (path.basename(labPath) === 'wgs.svg') {
      labHtml = `<g transform="translate(125, 405)">${embedSvg(labPath, 131, 195)}</g>`;
    } else {
      labHtml = `<g transform="translate(60, 440)">${embedSvg(labPath, 260, 130)}</g>`;
    }
  }

  const logoSize = 250;
  const centerLogoHtml = `<g transform="translate(${centerX - logoSize / 2}, 180)">${embedSvg(aadnaLogoPath, logoSize, logoSize)}</g>`;

  const vbMatch = qrSvg.match(/viewBox="([^"]+)"/);
  const qrViewBox = vbMatch ? vbMatch[1] : '0 0 180 180';
  const qrSize = 160;
  const qrHtml = `<svg x="${centerX - qrSize / 2}" y="410" width="${qrSize}" height="${qrSize}" viewBox="${qrViewBox}">${qrInner}</svg>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#FFFFFF"/>
  <text x="${centerX}" y="${titleY}" text-anchor="middle" fill="${NAVY}" font-family="Georgia, 'Times New Roman', 'Noto Serif', serif" font-size="${fontSize}" font-weight="bold">${escXml(displayTitle)}</text>
  ${flagHtml}
  ${labHtml}
  ${centerLogoHtml}
  ${qrHtml}
  ${haploHtml}
  ${settlementHtml}
</svg>`;

  return svg;
}

export async function generatePreview(slug, fm) {
  const preview = fm.extra?.preview || {};
  const mode = preview.mode || (preview.enabled === false ? 'disabled' : 'auto');

  if (mode === 'disabled') {
    return { action: 'skip', reason: 'disabled' };
  }

  if (mode === 'manual' || preview.image) {
    return { action: 'skip', reason: 'manual' };
  }

  const outputPath = path.join(OUTPUT_DIR, `${slug}.png`);
  const relativeOutput = `static/og/results/${slug}.png`;

  const rules = loadRules();
  const manifest = loadManifest();

  let title = preview.title_override || fm.extra?.surname || fm.title || '';
  const titleMain = fm.extra?.surname || fm.title || '';
  if (!preview.title_override && fm.extra?.surname_alt) {
    title = `${fm.extra.surname} (${fm.extra.surname_alt})`;
  }

  let settlement = preview.settlement_override || fm.extra?.settlement || '';
  if (!preview.settlement_override && fm.extra?.settlement_alt && fm.extra?.settlement) {
    settlement = `${fm.extra.settlement} (${fm.extra.settlement_alt})`;
  }

  const flagOverride = preview.flag_override || null;
  const flagPath = resolveFlag(fm.extra?.ethnos, rules, flagOverride);
  const flagName = flagOverride || fm.extra?.ethnos || '';

  const labOverride = preview.lab_logo_override || null;
  const labPath = resolveLabLogo(fm.extra?.laboratory, fm.extra?.result_type, rules, labOverride);
  const labName = labPath && path.basename(labPath) === 'wgs.svg' ? 'WGS' : (fm.extra?.laboratory || '');

  let haplogroupLines = [];
  if (preview.haplogroup_lines && preview.haplogroup_lines.length > 0) {
    haplogroupLines = preview.haplogroup_lines;
  } else {
    const overview = fm.extra?.details_y?.overview || '';
    haplogroupLines = parseHaplogroupLines(overview);
    if (haplogroupLines.length === 0) {
      if (fm.extra?.y_haplogroup) haplogroupLines.push(fm.extra.y_haplogroup);
      if (fm.extra?.y_subclade) haplogroupLines.push(fm.extra.y_subclade);
    }
  }

  const pagePath = fm.path ? fm.path.replace(/^\//, '').replace(/\/$/, '') : slug;
  const canonicalUrl = `${SITE_URL}/${pagePath}/`;

  const previewData = {
    title,
    titleMain,
    flag: flagName,
    laboratory: labName,
    haplogroupLines,
    settlement,
    canonicalUrl,
  };

  const inputHash = computeInputHash(previewData, flagPath, labPath);

  const manifestKey = slug;
  const existing = manifest[manifestKey];

  if (existing && existing.input_hash === inputHash && fs.existsSync(outputPath)) {
    return { action: 'cached', slug };
  }

  console.log(`[Preview Gen] Generating OG image for ${slug}...`);
  const svg = await buildSvg(previewData, flagPath, labPath);

  fs.ensureDirSync(OUTPUT_DIR);
  await sharp(Buffer.from(svg))
    .resize(1200, 630)
    .png({ quality: 90, compressionLevel: 9 })
    .toFile(outputPath);

  if (slug.includes('cms-tmp-preview')) {
    return { action: 'generated', slug };
  }

  manifest[manifestKey] = {
    source: `content/results/${slug}.md`,
    output: relativeOutput,
    input_hash: inputHash,
    generated_at: new Date().toISOString(),
    canonical_url: canonicalUrl,
    title,
    flag: flagName,
    laboratory: labName,
    haplogroup_lines: haplogroupLines,
    settlement,
  };

  saveManifest(manifest);

  return { action: 'generated', slug };
}

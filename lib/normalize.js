import { slugifyAadnaTitle } from './slugify.js';

const AUTO_TAXONOMIES = [
  'haplogroups',
  'subclades',
  'surnames',
  'subethnos',
  'settlements',
  'test_types',
  'laboratories'
];

function normalizeList(value) {
  if (value == null || value === '') return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function uniqueMerge(preferred, existing) {
  const result = [];
  const seen = new Set();

  for (const item of [...preferred, ...existing]) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function normalizePagePath(value) {
  if (value == null) return '';
  const normalized = String(value).trim().replace(/^\/+/, '').replace(/\/+$/, '');
  return normalized ? `${normalized}/` : '';
}

function getCleanSnp(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const snp = raw.replace(/[^a-zA-Z0-9-+]/g, '').trim();
  return snp || undefined;
}

export function syncTaxonomies(content) {
  const extra = content.extra && typeof content.extra === 'object' ? content.extra : {};
  const current = content.taxonomies && typeof content.taxonomies === 'object' ? content.taxonomies : {};

  const autoValues = {
    haplogroups: normalizeList(extra.y_haplogroup),
    subclades: normalizeList(extra.y_subclade),
    surnames: normalizeList(extra.surname),
    subethnos: normalizeList(extra.subethnos),
    settlements: normalizeList(extra.settlement),
    test_types: normalizeList(extra.result_type),
    laboratories: normalizeList(extra.laboratory),
  };

  const nextTaxonomies = {};

  for (const name of AUTO_TAXONOMIES) {
    const values = uniqueMerge(autoValues[name], normalizeList(current[name]));
    if (values.length > 0) nextTaxonomies[name] = values;
  }

  // Сохраняем другие теги (например, tags), которые не автогенерируются
  for (const [name, values] of Object.entries(current)) {
    if (name in nextTaxonomies || AUTO_TAXONOMIES.includes(name)) continue;
    const normalized = normalizeList(values);
    if (normalized.length > 0) nextTaxonomies[name] = normalized;
  }

  content.taxonomies = nextTaxonomies;
}

export function syncAliasesOnPathChange(content, existingContent) {
  const previousPath = normalizePagePath(existingContent?.path);
  const nextPath = normalizePagePath(content.path);
  if (!previousPath || !nextPath || previousPath === nextPath) return;

  const aliases = normalizeList(content.aliases);
  const seen = new Set(aliases.map((item) => normalizePagePath(item).toLowerCase()));
  if (!seen.has(previousPath.toLowerCase())) {
    aliases.push(previousPath);
  }
  content.aliases = aliases;
}

export function normalizeAadnaContent(content, existingContent, defaultSlug = '') {
  if (!content.extra || typeof content.extra !== 'object') return { content };

  const normalizedContent = JSON.parse(JSON.stringify(content));
  
  // Авто-генерация пути
  const currentPath = normalizePagePath(normalizedContent.path);
  const titlePath = slugifyAadnaTitle(normalizedContent.title);
  normalizedContent.path = currentPath || (titlePath ? `${titlePath}/` : `${defaultSlug}/`);

  syncAliasesOnPathChange(normalizedContent, existingContent);
  if (!normalizedContent.taxonomies && existingContent?.taxonomies) {
    normalizedContent.taxonomies = existingContent.taxonomies;
  }
  syncTaxonomies(normalizedContent);

  const snpToSync = getCleanSnp(normalizedContent.extra?.y_subclade);
  return { content: normalizedContent, snpToSync };
}

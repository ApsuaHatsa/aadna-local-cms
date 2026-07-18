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

function mergeObjects(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      mergeObjects(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

function pruneUndefined(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(pruneUndefined);
  }
  
  const clean = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) {
      clean[key] = pruneUndefined(obj[key]);
    }
  }
  return clean;
}

export function normalizeAadnaContent(content, existingContent, defaultSlug = '') {
  if (!content.extra || typeof content.extra !== 'object') return { content };

  // Создаем копию существующего контента или пустой объект
  const normalizedContent = existingContent ? JSON.parse(JSON.stringify(existingContent)) : {};
  
  // Копируем корневые поля из формы
  normalizedContent.title = content.title;
  normalizedContent.description = content.description;
  const formatToIsoDate = (val) => {
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
      return `${val}T00:00:00.000Z`;
    }
    return val;
  };

  normalizedContent.date = formatToIsoDate(content.date);
  normalizedContent.updated = formatToIsoDate(content.updated);
  normalizedContent.path = content.path;
  normalizedContent.draft = content.draft;
  normalizedContent.authors = content.authors;
  normalizedContent.aliases = content.aliases;

  // Убеждаемся, что системный шаблон сохранен
  if (!normalizedContent.template) {
    normalizedContent.template = 'dna-result.html';
  }

  // Мержим extra
  if (!normalizedContent.extra) normalizedContent.extra = {};
  mergeObjects(normalizedContent.extra, content.extra);
  
  // Авто-генерация пути
  const currentPath = normalizePagePath(normalizedContent.path);
  const titlePath = slugifyAadnaTitle(normalizedContent.title);
  normalizedContent.path = currentPath || (titlePath ? `${titlePath}/` : `${defaultSlug}/`);

  syncAliasesOnPathChange(normalizedContent, existingContent);
  
  // Если taxonomies нет, то берем из существующего файла (для не-авто таксономий)
  if (!normalizedContent.taxonomies && existingContent?.taxonomies) {
    normalizedContent.taxonomies = existingContent.taxonomies;
  }
  syncTaxonomies(normalizedContent);

  const snpToSync = getCleanSnp(normalizedContent.extra?.y_subclade);
  return { content: pruneUndefined(normalizedContent), snpToSync };
}

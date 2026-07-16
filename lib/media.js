import fs from 'fs-extra';
import path from 'path';

const RESULT_MEDIA_INPUT = '../aadna/static/media/results';
const RESULT_MEDIA_OUTPUT = '/media/results';

function getFileExtension(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function getNextMediaName(slug, sourceName, usedNames) {
  const extension = getFileExtension(sourceName);
  const suffix = extension ? `.${extension}` : '';
  let index = 1;
  let candidate = `${slug}_${index}${suffix}`;
  while (usedNames.has(candidate)) {
    index += 1;
    candidate = `${slug}_${index}${suffix}`;
  }
  usedNames.add(candidate);
  return candidate;
}

export async function saveUploadedImage(slug, originalName, fileBuffer) {
  const targetFolder = path.resolve(RESULT_MEDIA_INPUT, slug);
  await fs.ensureDir(targetFolder);

  // Собираем уже существующие файлы в папке
  const existingFiles = await fs.readdir(targetFolder);
  const usedNames = new Set(existingFiles);

  const targetName = getNextMediaName(slug, originalName, usedNames);
  const targetPath = path.join(targetFolder, targetName);

  await fs.writeFile(targetPath, fileBuffer);

  return `${RESULT_MEDIA_OUTPUT}/${slug}/${targetName}`;
}

const ROOT_RESULT_MEDIA_RE = /\/media\/results\/([^\s)"'#/?][^\s)"'#/?]*)(?=[\s)"'#?]|$)/g;

function collectRootResultMedia(value, filenames) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(ROOT_RESULT_MEDIA_RE)) {
      const filename = match[1];
      if (filename && !filename.includes('/')) filenames.add(filename);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectRootResultMedia(item, filenames);
    return;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectRootResultMedia(item, filenames);
  }
}

function replaceRootResultMedia(value, replacements) {
  if (typeof value === 'string') {
    return value.replace(ROOT_RESULT_MEDIA_RE, (match, filename) => (
      replacements.get(filename) ?? match
    ));
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceRootResultMedia(item, replacements));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceRootResultMedia(item, replacements)])
    );
  }

  return value;
}

export async function relocateAadnaResultMedia(slug, content) {
  const rootFilenames = new Set();
  collectRootResultMedia(content, rootFilenames);
  if (rootFilenames.size === 0) return content;

  const targetFolder = path.resolve(RESULT_MEDIA_INPUT, slug);
  await fs.ensureDir(targetFolder);

  const existingFiles = await fs.readdir(targetFolder);
  const usedNames = new Set(existingFiles);
  const replacements = new Map();

  for (const filename of rootFilenames) {
    const sourcePath = path.resolve(RESULT_MEDIA_INPUT, filename);
    
    if (!(await fs.pathExists(sourcePath))) continue;

    const targetName = getNextMediaName(slug, filename, usedNames);
    const targetPath = path.join(targetFolder, targetName);

    // Копируем файл в именную папку рода
    await fs.copy(sourcePath, targetPath);
    // Удаляем из корня
    await fs.remove(sourcePath);

    replacements.set(filename, `${RESULT_MEDIA_OUTPUT}/${slug}/${targetName}`);
  }

  if (replacements.size === 0) return content;
  return replaceRootResultMedia(content, replacements);
}

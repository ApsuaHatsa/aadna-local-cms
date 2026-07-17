import fs from 'fs-extra';
import path from 'path';

function getFileExtension(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function getMediaPaths(collection) {
  const col = ['results', 'articles', 'projects', 'pages'].includes(collection) ? collection : 'results';
  return {
    input: `../aadna/static/media/${col}`,
    output: `/media/${col}`
  };
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

export async function saveUploadedImage(slug, originalName, fileBuffer, collection = 'results') {
  const paths = getMediaPaths(collection);
  const targetFolder = path.resolve(paths.input, slug);
  await fs.ensureDir(targetFolder);

  // Собираем уже существующие файлы в папке
  const existingFiles = await fs.readdir(targetFolder);
  const usedNames = new Set(existingFiles);

  const targetName = getNextMediaName(slug, originalName, usedNames);
  const targetPath = path.join(targetFolder, targetName);

  await fs.writeFile(targetPath, fileBuffer);

  return `${paths.output}/${slug}/${targetName}`;
}

function getRootMediaRegex(collection) {
  return new RegExp(`\\/media\\/${collection}\\/([^\\s)"'#/?][^\\s)"'#/?]*)(?=[\\s)"'#?]|$|\\))`, 'g');
}

function collectRootResultMedia(value, filenames, collection = 'results') {
  const regex = getRootMediaRegex(collection);
  if (typeof value === 'string') {
    for (const match of value.matchAll(regex)) {
      const filename = match[1];
      if (filename && !filename.includes('/')) filenames.add(filename);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectRootResultMedia(item, filenames, collection);
    return;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectRootResultMedia(item, filenames, collection);
  }
}

function replaceRootResultMedia(value, replacements, collection = 'results') {
  const regex = getRootMediaRegex(collection);
  if (typeof value === 'string') {
    return value.replace(regex, (match, filename) => (
      replacements.get(filename) ?? match
    ));
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceRootResultMedia(item, replacements, collection));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceRootResultMedia(item, replacements, collection)])
    );
  }

  return value;
}

export async function relocateAadnaResultMedia(slug, content, collection = 'results') {
  const rootFilenames = new Set();
  collectRootResultMedia(content, rootFilenames, collection);
  if (rootFilenames.size === 0) return content;

  const paths = getMediaPaths(collection);
  const targetFolder = path.resolve(paths.input, slug);
  await fs.ensureDir(targetFolder);

  const existingFiles = await fs.readdir(targetFolder);
  const usedNames = new Set(existingFiles);
  const replacements = new Map();

  for (const filename of rootFilenames) {
    const sourcePath = path.resolve(paths.input, filename);
    
    if (!(await fs.pathExists(sourcePath))) continue;

    const targetName = getNextMediaName(slug, filename, usedNames);
    const targetPath = path.join(targetFolder, targetName);

    // Копируем файл в именную папку рода
    await fs.copy(sourcePath, targetPath);
    // Удаляем из корня
    await fs.remove(sourcePath);

    replacements.set(filename, `${paths.output}/${slug}/${targetName}`);
  }

  if (replacements.size === 0) return content;
  return replaceRootResultMedia(content, replacements, collection);
}

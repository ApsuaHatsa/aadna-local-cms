import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';

function getFileExtension(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

export function getMediaPaths(collection) {
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

// -----------------------------------------------------------------------------
// Медиабиблиотека: сканирование и связка с постами
// -----------------------------------------------------------------------------
let mediaLibraryCache = null;
let mediaLibraryCacheTime = 0;
const CACHE_TTL_MS = 25000;

export function invalidateMediaCache() {
  mediaLibraryCache = null;
  mediaLibraryCacheTime = 0;
}

const VALID_MEDIA_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'svg', 'gif', 'avif', 'ico']);

// Рекурсивный сбор всех файлов директории
async function walkDirectory(dir) {
  let files = [];
  if (!(await fs.pathExists(dir))) return files;
  
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await walkDirectory(fullPath);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

// Быстрое индексирование всех постов и используемых в них картинок
async function indexContentPosts(aadnaPath) {
  const contentDir = path.join(aadnaPath, 'content');
  const refMap = new Map(); // mediaUrl -> Array<{ title, collection, slug }>
  const postsMap = new Map(); // `${collection}:${slug}` -> { title, surname, draft, collection, slug, exists: true }

  if (!(await fs.pathExists(contentDir))) {
    return { refMap, postsMap };
  }

  const allFiles = await walkDirectory(contentDir);
  const mdFiles = allFiles.filter(f => f.endsWith('.md') && !path.basename(f).startsWith('_'));
  const mediaRegex = /\/media\/[a-zA-Z0-9_\-\.\/]+/g;

  for (const filePath of mdFiles) {
    try {
      const relPath = path.relative(contentDir, filePath).replace(/\\/g, '/');
      const pathParts = relPath.split('/');
      if (pathParts.length < 2) continue;

      const collection = pathParts[0];
      const filename = pathParts[pathParts.length - 1];
      const slug = filename.replace(/\.md$/, '');

      const raw = await fs.readFile(filePath, 'utf-8');
      
      // Быстрое извлечение заголовка из frontmatter
      let title = slug;
      let surname = '';
      let draft = false;

      const titleMatch = raw.match(/^title:\s*["']?(.*?)["']?$/m);
      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1].trim();
      }

      const surnameMatch = raw.match(/surname:\s*["']?(.*?)["']?$/m);
      if (surnameMatch && surnameMatch[1]) {
        surname = surnameMatch[1].trim();
      }

      const draftMatch = raw.match(/^draft:\s*(true|false)/m);
      if (draftMatch && draftMatch[1] === 'true') {
        draft = true;
      }

      const postObj = {
        title: title || surname || slug,
        surname,
        draft,
        collection,
        slug,
        exists: true
      };

      postsMap.set(`${collection}:${slug}`, postObj);

      // Поиск всех упоминаний /media/... в контенте
      const matches = raw.match(mediaRegex);
      if (matches) {
        const uniqueUrls = new Set();
        for (let url of matches) {
          // Очистка от знаков препинания и кавычек на конце
          url = url.replace(/[\)\]"'`.,;:]+$/, '');
          uniqueUrls.add(url);
        }

        for (const url of uniqueUrls) {
          if (!refMap.has(url)) {
            refMap.set(url, []);
          }
          refMap.get(url).push({
            title: postObj.title,
            collection,
            slug,
            draft
          });
        }
      }
    } catch (err) {
      console.warn(`[MediaIndex] Ошибка чтения поста ${filePath}:`, err.message);
    }
  }

  return { refMap, postsMap };
}

// Получение полного реестра медиафайлов с метаданными и статистикой
export async function getMediaLibrary(aadnaPath, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && mediaLibraryCache && (now - mediaLibraryCacheTime < CACHE_TTL_MS)) {
    return mediaLibraryCache;
  }

  const mediaRoot = path.join(aadnaPath, 'static/media');
  if (!(await fs.pathExists(mediaRoot))) {
    return {
      items: [],
      stats: {
        totalFiles: 0,
        totalSize: 0,
        byCollection: {},
        byType: {},
        usedCount: 0,
        unusedCount: 0
      }
    };
  }

  // 1. Индексируем посты и упоминания медиафайлов
  const { refMap, postsMap } = await indexContentPosts(aadnaPath);

  // 2. Сканируем все файлы в static/media
  const allMediaPaths = await walkDirectory(mediaRoot);
  const items = [];

  let totalSize = 0;
  const byCollection = {};
  const byType = {};
  let usedCount = 0;
  let unusedCount = 0;

  for (const filePath of allMediaPaths) {
    const filename = path.basename(filePath);
    if (filename.startsWith('.') || filename === '.gitkeep') continue;

    const ext = getFileExtension(filename);
    if (!VALID_MEDIA_EXTENSIONS.has(ext)) continue;

    const relPath = path.relative(mediaRoot, filePath).replace(/\\/g, '/');
    const url = `/media/${relPath}`;
    const parts = relPath.split('/');

    const collection = parts[0] || 'root';
    const folderSlug = parts.length > 2 ? parts[1] : null;

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (e) {
      continue;
    }

    const fileSize = stat.size;
    totalSize += fileSize;

    // Счётчики по коллекциям и типам
    byCollection[collection] = (byCollection[collection] || 0) + 1;
    byType[ext] = (byType[ext] || 0) + 1;

    // Ищем использование в текстах постов
    const usedInPosts = refMap.get(url) || [];

    // Ищем пост по папке (folderSlug)
    let folderPost = null;
    let isPreview = false;

    if (folderSlug) {
      const cleanSlug = folderSlug.replace('.cms-tmp-preview', '').replace('-preview', '');
      isPreview = folderSlug.includes('preview');
      const postKey = `${collection}:${cleanSlug}`;
      
      if (postsMap.has(postKey)) {
        folderPost = {
          ...postsMap.get(postKey),
          rawSlug: folderSlug,
          isPreview
        };
      } else {
        folderPost = {
          title: cleanSlug,
          slug: cleanSlug,
          rawSlug: folderSlug,
          collection,
          exists: false,
          isPreview
        };
      }
    }

    const isUsed = usedInPosts.length > 0 || (folderPost && folderPost.exists);
    if (isUsed) {
      usedCount++;
    } else {
      unusedCount++;
    }

    items.push({
      filename,
      url,
      relativeFsPath: `static/media/${relPath}`,
      collection,
      folderSlug,
      extension: ext,
      size: fileSize,
      modified: stat.mtime.toISOString(),
      usedInPosts,
      folderPost,
      isPreview,
      isOrphaned: !isUsed
    });
  }

  // Сортируем по умолчанию: сначала самые свежие по дате модификации
  items.sort((a, b) => new Date(b.modified) - new Date(a.modified));

  const result = {
    items,
    stats: {
      totalFiles: items.length,
      totalSize,
      byCollection,
      byType,
      usedCount,
      unusedCount
    }
  };

  mediaLibraryCache = result;
  mediaLibraryCacheTime = now;
  return result;
}

// Удаление медиафайла с проверкой безопасности путей
export async function deleteMediaFile(aadnaPath, relativeMediaUrl) {
  if (!relativeMediaUrl || typeof relativeMediaUrl !== 'string') {
    throw new Error('Не указан URL медиафайла для удаления');
  }

  const mediaRoot = path.resolve(aadnaPath, 'static/media');
  const cleanPath = relativeMediaUrl.replace(/^\/media\//, '').replace(/^\/+/, '');
  const targetPath = path.resolve(mediaRoot, cleanPath);

  // Защита от Path Traversal
  if (!targetPath.startsWith(mediaRoot)) {
    throw new Error('Недопустимый путь к файлу');
  }

  if (!(await fs.pathExists(targetPath))) {
    throw new Error('Файл не найден на диске');
  }

  await fs.remove(targetPath);

  // Если родительская папка пуста и это папка конкретной записи, удаляем её
  const parentDir = path.dirname(targetPath);
  if (parentDir !== mediaRoot && path.dirname(parentDir) === mediaRoot) {
    try {
      const remaining = await fs.readdir(parentDir);
      if (remaining.length === 0) {
        await fs.remove(parentDir);
      }
    } catch (e) {
      // Игнорируем ошибки очистки пустой папки
    }
  }

  invalidateMediaCache();
  return true;
}

// Открытие медиафайла в системном просмотрщике ОС
export async function openMediaFile(aadnaPath, relativeMediaUrl) {
  if (!relativeMediaUrl || typeof relativeMediaUrl !== 'string') {
    throw new Error('Не указан URL медиафайла для открытия');
  }

  const mediaRoot = path.resolve(aadnaPath, 'static/media');
  const cleanPath = relativeMediaUrl.replace(/^\/media\//, '').replace(/^\/+/, '');
  const targetPath = path.resolve(mediaRoot, cleanPath);

  // Защита от Path Traversal
  if (!targetPath.startsWith(mediaRoot)) {
    throw new Error('Недопустимый путь к файлу');
  }

  if (!(await fs.pathExists(targetPath))) {
    throw new Error('Файл не найден на диске');
  }

  let cmd, args;
  if (process.platform === 'win32') {
    cmd = 'cmd.exe';
    args = ['/c', 'start', '""', targetPath];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = [targetPath];
  } else {
    cmd = 'xdg-open';
    args = [targetPath];
  }

  const child = spawn(cmd, args, {
    detached: true,
    stdio: 'ignore'
  });
  child.on('error', (err) => {
    console.error('[Media] Ошибка запуска системного просмотрщика:', err);
  });
  child.unref();

  return { success: true, path: targetPath };
}


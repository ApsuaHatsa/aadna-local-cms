import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import yaml from 'yaml';
import matter from 'gray-matter';
import { fileURLToPath } from 'url';
import { execSync, exec, spawn } from 'child_process';

// Импорт библиотек автоматизации
import { normalizeAadnaContent } from './lib/normalize.js';
import { saveUploadedImage, relocateAadnaResultMedia } from './lib/media.js';
import { syncSnpPath } from './lib/snp.js';
import { generatePreview } from './lib/preview.js';
import { getStatus, publish, runGitCommand } from './lib/git.js';
import { slugifyAadnaTitle } from './lib/slugify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 4400;

// Константы путей
const AADNA_PATH = path.resolve(process.cwd(), '../aadna');
const PAGES_CONFIG_PATH = path.join(AADNA_PATH, '.pages.yml');
const RESULTS_DIR = path.join(AADNA_PATH, 'content/results');
const MEDIA_DIR = path.join(AADNA_PATH, 'static/media/results');

// Настройка Express
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Раздача статики UI
app.use(express.static(path.join(__dirname, 'public')));
// Раздача медиафайлов из репозитория aadna для просмотра картинок в админке
app.use('/media', express.static(path.join(AADNA_PATH, 'static/media')));

// Настройка загрузки файлов (Multer)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // Лимит 50MB
});

// Вспомогательная функция для безопасного слагирования имени файла изображения
function slugifyFilename(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const base = path.basename(originalName, ext);
  const safeBase = slugifyAadnaTitle(base);
  return `${safeBase || 'upload'}${ext}`;
}

// 1. GET /api/config - Чтение полей из .pages.yml
app.get('/api/config', async (req, res) => {
  try {
    if (!(await fs.pathExists(PAGES_CONFIG_PATH))) {
      return res.status(404).json({ error: 'Config file .pages.yml not found' });
    }
    const raw = await fs.readFile(PAGES_CONFIG_PATH, 'utf-8');
    const parsed = yaml.parse(raw);
    res.json({ config: parsed, raw });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 1.5 POST /api/config - Запись изменений в .pages.yml
app.post('/api/config', async (req, res) => {
  const { raw } = req.body;
  if (!raw) {
    return res.status(400).json({ error: 'Raw YAML content is required' });
  }

  try {
    // Валидируем YAML синтаксис перед сохранением
    try {
      yaml.parse(raw);
    } catch (parseErr) {
      return res.status(400).json({ error: `Некорректный синтаксис YAML: ${parseErr.message}` });
    }

    await fs.writeFile(PAGES_CONFIG_PATH, raw, 'utf-8');
    
    // Добавляем изменения в индекс Git
    runGitCommand('git add .pages.yml');

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Вспомогательная функция для получения настроек конкретной коллекции
async function getCollectionSettings(collectionName) {
  if (!(await fs.pathExists(PAGES_CONFIG_PATH))) {
    throw new Error('Config file .pages.yml not found');
  }
  const raw = await fs.readFile(PAGES_CONFIG_PATH, 'utf-8');
  const parsed = yaml.parse(raw);
  const collection = parsed.content?.find(c => c.name === collectionName);
  if (!collection) {
    throw new Error(`Collection "${collectionName}" not found in config`);
  }
  return collection;
}

// Функция генерации слага для записи
function getEntrySlug(data, collectionConfig) {
  const template = collectionConfig.filename?.template || '{path}.md';
  
  if (template === '{path}.md' && data.path) {
    return data.path.replace(/\/+$/, '').trim();
  }
  
  const primaryField = collectionConfig.view?.primary || 'title';
  const primaryVal = data[primaryField] || '';
  if (primaryVal) {
    return slugifyAadnaTitle(primaryVal);
  }
  
  return 'untitled';
}

// 2. GET /api/collections/:collection/entries - Список записей конкретной коллекции
app.get('/api/collections/:collection/entries', async (req, res) => {
  const { collection } = req.params;
  try {
    const colSettings = await getCollectionSettings(collection);
    const colDir = path.join(AADNA_PATH, colSettings.path);

    if (!(await fs.pathExists(colDir))) {
      return res.json([]);
    }

    const files = await fs.readdir(colDir);
    const entries = [];

    for (const file of files) {
      if (!file.endsWith('.md') || file.startsWith('_')) continue;
      if (file.includes('.cms-tmp-preview')) continue;

      const filePath = path.join(colDir, file);
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = matter(raw);

      // Исключаем посты legacy_wp для results
      if (collection === 'results' && parsed.data.extra?.content_mode === 'legacy_wp') continue;

      // Формируем базовый объект записи для списка
      const entry = {
        slug: file.replace('.md', ''),
        title: parsed.data.title || file,
        date: parsed.data.date || '',
        draft: parsed.data.draft ?? false,
        ...parsed.data
      };

      entries.push(entry);
    }

    // Сортировка по дате (свежие сверху)
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json(entries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 3. GET /api/collections/:collection/entry/:slug - Чтение конкретной записи
app.get('/api/collections/:collection/entry/:slug', async (req, res) => {
  const { collection, slug } = req.params;
  try {
    const colSettings = await getCollectionSettings(collection);
    const colDir = path.join(AADNA_PATH, colSettings.path);
    const filePath = path.join(colDir, `${slug}.md`);

    if (!(await fs.pathExists(filePath))) {
      return res.status(404).json({ error: `Entry ${slug} not found in collection ${collection}` });
    }

    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(raw);

    res.json({
      frontmatter: parsed.data,
      content: parsed.content
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 4. POST /api/upload - Загрузка изображений (уже переписана под collection)
// Используем существующий эндпоинт, который принимает query-параметры `slug` и `collection`
app.post('/api/upload', upload.single('image'), async (req, res) => {
  const { slug, collection } = req.query;
  const colName = ['results', 'articles', 'projects', 'pages'].includes(collection) ? collection : 'results';

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Если slug есть (редактируем пост) - сохраняем сразу в его медиа-папку
    if (slug && slug !== 'undefined') {
      const cleanSlug = slug.replace('.cms-tmp-preview', '');
      const url = await saveUploadedImage(cleanSlug, req.file.originalname, req.file.buffer, colName);
      return res.json({ url });
    }

    // Если slug нет (создаем новый пост) - сохраняем в корень медиа-папки коллекции с таймстампом
    const ext = path.extname(req.file.originalname).toLowerCase();
    const base = slugifyFilename(path.basename(req.file.originalname, ext));
    const uniqueName = `${path.basename(base, ext)}-${Date.now()}${ext}`;

    const targetDir = path.join(AADNA_PATH, `static/media/${colName}`);
    const targetPath = path.join(targetDir, uniqueName);
    
    await fs.ensureDir(targetDir);
    await fs.writeFile(targetPath, req.file.buffer);

    res.json({ url: `/media/${colName}/${uniqueName}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

async function fetchYtreeScreenshot(clade, slug) {
  const themes = ['light', 'dark'];
  const mediaDir = path.join(AADNA_PATH, 'static', 'media', 'results', slug);
  await fs.ensureDir(mediaDir);

  let successCount = 0;
  let treeUrl = '';

  for (const theme of themes) {
    const cleanClade = clade.replace(/[^a-zA-Z0-9-]/g, '');
    const filename = 'ytree_' + cleanClade + '_' + theme + '.png';
    const targetPath = path.join(mediaDir, filename);
    const url = 'https://ytree-api.apsny.dev/api/screenshot?clade=' + clade + (theme === 'dark' ? '&theme=dark' : '');

    try {
      if (await fs.pathExists(targetPath)) {
        successCount++;
        if (!treeUrl) {
          const headRes = await fetch(url, { method: 'HEAD' });
          if (headRes.ok) treeUrl = headRes.headers.get('x-tree-url') || '';
        }
        continue;
      }

      console.log('Fetching YTree screenshot for ' + clade + ' (' + theme + ' theme)...');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) throw new Error('HTTP ' + response.status);

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const json = await response.json();
        throw new Error(json.error || 'Branch not found on the tree');
      }

      if (!treeUrl) treeUrl = response.headers.get('x-tree-url') || '';

      const arrayBuffer = await response.arrayBuffer();
      await fs.writeFile(targetPath, Buffer.from(arrayBuffer));
      console.log('Successfully saved ' + filename);
      successCount++;
    } catch (err) {
      console.error('Failed to fetch YTree screenshot (' + theme + '):', err.message);
    }
  }
  return { success: successCount === 2, link: treeUrl };
}

// 5. POST /api/collections/:collection/entry - Сохранить/создать запись
app.post('/api/collections/:collection/entry', async (req, res) => {
  const { collection } = req.params;
  const { originalSlug, data, isPreview } = req.body;

  try {
    const colSettings = await getCollectionSettings(collection);
    const colDir = path.join(AADNA_PATH, colSettings.path);

    let existingContent = null;
    const cleanOriginalSlug = originalSlug ? originalSlug.replace('.cms-tmp-preview', '') : '';

    if (cleanOriginalSlug) {
      const existingPath = path.join(colDir, `${cleanOriginalSlug}.md`);
      if (await fs.pathExists(existingPath)) {
        const rawExisting = await fs.readFile(existingPath, 'utf-8');
        existingContent = matter(rawExisting).data;
      }
    }

    let normalized = data;
    let snpToSync = null;

    // Нормализация ДНК результатов (только для results)
    if (collection === 'results') {
      const normRes = normalizeAadnaContent(data, existingContent, cleanOriginalSlug);
      normalized = normRes.content;
      snpToSync = normRes.snpToSync;
    }

    // Определение слага
    const nextSlug = getEntrySlug(normalized, colSettings);

    // Автоматическая генерация скриншотов YTree
    if (collection === 'results') {
      try {
        const customClade = normalized.extra?.details_y?.ytree_clade;
        const defaultClade = normalized.extra?.y_subclade;
        const targetClade = (customClade && customClade.trim()) ? customClade.trim() : defaultClade;

        if (targetClade) {
          const clade = targetClade.replace(/[^a-zA-Z0-9-]/g, '');
          if (clade) {
            const targetSlug = isPreview ? `${nextSlug}-preview` : nextSlug;

            const fetchRes = await fetchYtreeScreenshot(targetClade, targetSlug);

            if (fetchRes.success) {
              if (!normalized.extra.details_y) {
                normalized.extra.details_y = {};
              }

              const imgHtml =
                `<img src="/media/results/${targetSlug}/ytree_${clade}_light.png" class="no-zoom ytree-img-light block w-full rounded-lg shadow-lg hover:opacity-90 transition-opacity cursor-pointer" alt="YTree ${clade}">\n` +
                `<img src="/media/results/${targetSlug}/ytree_${clade}_dark.png" class="no-zoom ytree-img-dark hidden w-full rounded-lg shadow-lg hover:opacity-90 transition-opacity cursor-pointer" alt="YTree ${clade}">`;

              let finalLink = fetchRes.link;
              if (finalLink) {
                try {
                  const u = new URL(finalLink);
                  u.search = '';
                  u.searchParams.set('utm_source', 'aadna.ru');
                  u.searchParams.set('utm_medium', '/' + nextSlug);
                  u.searchParams.set('utm_campaign', 'aadna_referrals');
                  u.searchParams.set('utm_content', clade);
                  finalLink = u.toString();
                } catch (e) {
                  // Fallback
                }
              }

              if (finalLink) {
                normalized.extra.details_y.ytree_tree = `<a href="${finalLink}" target="_blank" rel="noopener noreferrer" class="block">\n${imgHtml}\n</a>`;
              } else {
                normalized.extra.details_y.ytree_tree = imgHtml;
              }
            } else if (normalized.extra.details_y && normalized.extra.details_y.ytree_tree) {
              delete normalized.extra.details_y.ytree_tree;
            }
          }
        } else if (normalized.extra?.details_y && normalized.extra.details_y.ytree_tree) {
          delete normalized.extra.details_y.ytree_tree;
        }
      } catch (ytreeErr) {
        console.error('YTree screenshot error (non-fatal):', ytreeErr.message);
      }
    }

    if (isPreview) {
      // Режим предпросмотра: сохраняем во временный файл
      const previewSlug = `${nextSlug}.cms-tmp-preview`;
      const targetPath = path.join(colDir, `${previewSlug}.md`);

      // Подменяем путь в самом файле, чтобы у Zola не было конфликтов дубликатов
      normalized.path = `${nextSlug}-preview/`;

      // Генерация OG для превью (только для results)
      if (collection === 'results') {
        if (normalized.extra) {
          if (!normalized.extra.preview) normalized.extra.preview = {};
          normalized.extra.preview.image = `/og/results/${previewSlug}.png`;
        }
        const finalContentObj = await relocateAadnaResultMedia(nextSlug, normalized, 'results');
        await generatePreview(previewSlug, finalContentObj);
        
        const fileContent = matter.stringify('', finalContentObj, { lineWidth: -1 });
        await fs.writeFile(targetPath, fileContent);
      } else {
        // Для других коллекций
        const finalContentObj = await relocateAadnaResultMedia(nextSlug, normalized, collection);
        const fileContent = matter.stringify('', finalContentObj, { lineWidth: -1 });
        await fs.writeFile(targetPath, fileContent);
      }

      return res.json({ success: true, slug: previewSlug });
    }

    // Обычное сохранение/публикация
    const targetPath = path.join(colDir, `${nextSlug}.md`);
    const finalContentObj = await relocateAadnaResultMedia(nextSlug, normalized, collection);

    if (collection === 'results') {
      if (snpToSync) {
        await syncSnpPath(snpToSync);
      }
      await generatePreview(nextSlug, finalContentObj);
    }

    const fileContent = matter.stringify('', finalContentObj, { lineWidth: -1 });
    await fs.writeFile(targetPath, fileContent);

    // Если имя файла изменилось, удаляем старый файл
    if (cleanOriginalSlug && cleanOriginalSlug !== nextSlug) {
      const oldPath = path.join(colDir, `${cleanOriginalSlug}.md`);
      await fs.remove(oldPath);
    }

    // Чистим временные файлы предпросмотра
    const previewFile = path.join(colDir, `${nextSlug}.cms-tmp-preview.md`);
    await fs.remove(previewFile);

    if (collection === 'results') {
      const previewImage = path.join(AADNA_PATH, `static/og/results/${nextSlug}.cms-tmp-preview.png`);
      await fs.remove(previewImage);
    }

    // Добавляем файл в индекс Git
    runGitCommand(`git add ${path.relative(AADNA_PATH, targetPath)}`);
    if (cleanOriginalSlug && cleanOriginalSlug !== nextSlug) {
      runGitCommand(`git rm ${path.relative(AADNA_PATH, path.join(colDir, `${cleanOriginalSlug}.md`))}`);
    }

    res.json({ success: true, slug: nextSlug });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 5.5 POST /api/collections/:collection/entry/:slug/revert - Откат изменений
app.post('/api/collections/:collection/entry/:slug/revert', async (req, res) => {
  const { collection, slug } = req.params;
  try {
    const colSettings = await getCollectionSettings(collection);
    const colDir = path.join(AADNA_PATH, colSettings.path);
    const relativeFilePath = path.join(colSettings.path, `${slug}.md`);
    const filePath = path.join(colDir, `${slug}.md`);

    // Проверяем, отслеживается ли файл в Git
    const checkRes = runGitCommand(`git ls-files --error-unmatch ${relativeFilePath}`);
    if (checkRes.success) {
      // Файл отслеживается, откатываем изменения к HEAD
      runGitCommand(`git checkout -- ${relativeFilePath}`);
      
      if (collection === 'results') {
        runGitCommand(`git checkout -- static/og/results/manifest.json`);
        const ogPath = path.join(AADNA_PATH, `static/og/results/${slug}.png`);
        if (await fs.pathExists(ogPath)) {
          const ogCheck = runGitCommand(`git ls-files --error-unmatch static/og/results/${slug}.png`);
          if (!ogCheck.success) {
            await fs.remove(ogPath);
          }
        }
      }
    } else {
      // Файл новый (не отслеживается), просто удаляем его
      await fs.remove(filePath);
      
      if (collection === 'results') {
        const ogPath = path.join(AADNA_PATH, `static/og/results/${slug}.png`);
        await fs.remove(ogPath);
      }
      
      // Удаляем медиа-папку этой записи, если она создалась
      const paths = getMediaPaths(collection);
      const mediaFolder = path.resolve(paths.input, slug);
      await fs.remove(mediaFolder);
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 5.6 POST /api/collections/:collection/entry/:slug/clear-preview - Очистка временных файлов
app.post('/api/collections/:collection/entry/:slug/clear-preview', async (req, res) => {
  const { collection, slug } = req.params;
  const cleanSlug = slug.replace('.cms-tmp-preview', '');
  
  try {
    const colSettings = await getCollectionSettings(collection);
    const colDir = path.join(AADNA_PATH, colSettings.path);
    const previewFile = path.join(colDir, `${cleanSlug}.cms-tmp-preview.md`);
    await fs.remove(previewFile);

    if (collection === 'results') {
      const previewImage = path.join(AADNA_PATH, `static/og/results/${cleanSlug}.cms-tmp-preview.png`);
      await fs.remove(previewImage);
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 5.7 DELETE /api/collections/:collection/entry/:slug - Удаление записи
app.delete('/api/collections/:collection/entry/:slug', async (req, res) => {
  const { collection, slug } = req.params;
  const cleanSlug = slug.replace('.cms-tmp-preview', '');

  try {
    const colSettings = await getCollectionSettings(collection);
    const colDir = path.join(AADNA_PATH, colSettings.path);
    const targetPath = path.join(colDir, `${cleanSlug}.md`);

    if (await fs.pathExists(targetPath)) {
      // Удаляем сам файл
      await fs.remove(targetPath);

      // Удаляем папку медиа
      const paths = getMediaPaths(collection);
      const mediaDir = path.resolve(paths.input, cleanSlug);
      if (await fs.pathExists(mediaDir)) {
        await fs.remove(mediaDir);
      }

      if (collection === 'results') {
        // Удаляем OG-изображение поста
        const ogImage = path.join(AADNA_PATH, 'static/og/results', `${cleanSlug}.png`);
        if (await fs.pathExists(ogImage)) {
          await fs.remove(ogImage);
        }
      }

      // Добавляем удаление в Git
      runGitCommand(`git rm ${path.relative(AADNA_PATH, targetPath)}`);
    }

    // Чистим временные файлы предпросмотра
    const previewFile = path.join(colDir, `${cleanSlug}.cms-tmp-preview.md`);
    await fs.remove(previewFile);

    if (collection === 'results') {
      const previewImage = path.join(AADNA_PATH, `static/og/results/${cleanSlug}.cms-tmp-preview.png`);
      await fs.remove(previewImage);
    }

    // Добавляем изменения в индекс Git
    runGitCommand('git add .');

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 6. GET /api/git-status - Проверка изменений
app.get('/api/git-status', (req, res) => {
  const status = getStatus();
  res.json(status);
});

// 6.5 GET /api/git-diff - Получение текстового diff
app.get('/api/git-diff', (req, res) => {
  const diffRes = runGitCommand('git diff HEAD');
  if (diffRes.success) {
    res.json({ success: true, diff: diffRes.stdout });
  } else {
    // Резервный вариант, если HEAD еще нет (первый коммит)
    const diffRes2 = runGitCommand('git diff');
    res.json({ success: diffRes2.success, diff: diffRes2.stdout, error: diffRes2.stderr });
  }
});

// 7. POST /api/publish - Коммит и отправка изменений в Git
app.post('/api/publish', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Commit message is required' });
  }

  console.log(`[Git Publish] Running commit: "${message}"`);
  const result = publish(message);
  res.json(result);
});

// Запуск сервера
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`\n==================================================`);
    console.log(`🧬 AADNA Local Admin running at: http://localhost:${port}`);
    console.log(`Working with repository: ${AADNA_PATH}`);
    console.log(`==================================================\n`);
    
    // Авто-открытие браузера
    try {
      const startCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      const child = spawn(startCmd, [`http://localhost:${port}`], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    } catch (e) {
      // Игнорируем ошибки авто-открытия
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Порт ${port} занят. Пробуем запустить на порту ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Ошибка при запуске сервера:', err);
    }
  });
}

startServer(PORT);

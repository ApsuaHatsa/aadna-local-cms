import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import yaml from 'yaml';
import matter from 'gray-matter';
import { fileURLToPath } from 'url';
import { execSync, exec } from 'child_process';

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
    
    // Находим коллекцию results
    const resultsCollection = parsed.content?.find(c => c.name === 'results');
    if (!resultsCollection) {
      return res.status(404).json({ error: 'Collection "results" not found in config' });
    }

    res.json(resultsCollection);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 2. GET /api/entries - Список современных результатов
app.get('/api/entries', async (req, res) => {
  try {
    if (!(await fs.pathExists(RESULTS_DIR))) {
      return res.json([]);
    }
    const files = await fs.readdir(RESULTS_DIR);
    const results = [];

    for (const file of files) {
      if (!file.endsWith('.md') || file.startsWith('_')) continue;
      
      const filePath = path.join(RESULTS_DIR, file);
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = matter(raw);

      // Исключаем посты legacy_wp (WordPress миграция)
      if (parsed.data.extra?.content_mode === 'legacy_wp') continue;

      results.push({
        slug: file.replace('.md', ''),
        title: parsed.data.title || file,
        surname: parsed.data.extra?.surname || '',
        haplogroup: parsed.data.extra?.y_haplogroup || '',
        subclade: parsed.data.extra?.y_subclade || '',
        date: parsed.data.date || '',
        draft: parsed.data.draft ?? false
      });
    }

    // Сортировка по дате (свежие сверху)
    results.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 3. GET /api/entry/:slug - Чтение конкретного результата
app.get('/api/entry/:slug', async (req, res) => {
  const { slug } = req.params;
  const filePath = path.join(RESULTS_DIR, `${slug}.md`);

  try {
    if (!(await fs.pathExists(filePath))) {
      return res.status(404).json({ error: `Entry ${slug} not found` });
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

// 4. POST /api/upload - Загрузка файла в корень media или папку поста
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { slug, collection } = req.query;
    const colName = collection || 'results';

    if (slug) {
      // Сохраняем напрямую в папку поста через saveUploadedImage
      const url = await saveUploadedImage(slug, req.file.originalname, req.file.buffer, colName);
      return res.json({ url });
    }

    // Сохраняем в корень с уникальным именем (таймстамп), чтобы избежать коллизий
    const safeName = slugifyFilename(req.file.originalname);
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    const uniqueName = `${base}-${Date.now()}${ext}`;

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

// 5. POST /api/entry - Сохранить/создать результат с автоматизациями
app.post('/api/entry', async (req, res) => {
  const { originalSlug, data, isPreview } = req.body;

  try {
    let existingContent = null;
    const cleanOriginalSlug = originalSlug ? originalSlug.replace('.cms-tmp-preview', '') : '';
    
    if (cleanOriginalSlug) {
      const existingPath = path.join(RESULTS_DIR, `${cleanOriginalSlug}.md`);
      if (await fs.pathExists(existingPath)) {
        const rawExisting = await fs.readFile(existingPath, 'utf-8');
        existingContent = matter(rawExisting).data;
      }
    }

    // 1 & 2. Нормализация контента, авто-слаг, авто-таксономии и алиасы
    const { content: normalized, snpToSync } = normalizeAadnaContent(
      data, 
      existingContent, 
      cleanOriginalSlug
    );

    const nextSlug = normalized.path.replace(/\/+$/, ''); // убираем слеш на конце для имени файла

    if (isPreview) {
      // Режим предпросмотра: сохраняем во временный файл
      const previewSlug = `${nextSlug}.cms-tmp-preview`;
      const targetPath = path.join(RESULTS_DIR, `${previewSlug}.md`);
      
      // Подменяем путь в самом файле, чтобы у Zola не было конфликтов дубликатов путей
      normalized.path = `${nextSlug}-preview/`;
      
      // Настраиваем путь к OG-изображению для превью
      if (normalized.extra) {
        if (!normalized.extra.preview) normalized.extra.preview = {};
        normalized.extra.preview.image = `/og/results/${previewSlug}.png`;
      }

      // Релокация медиафайлов (для превью используем оригинальный слаг, чтобы не дублировать папки)
      const finalContentObj = await relocateAadnaResultMedia(nextSlug, normalized, 'results');
      
      // Генерируем временную OG-картинку
      await generatePreview(previewSlug, finalContentObj);

      // Сохраняем временный файл
      const fileContent = matter.stringify('', finalContentObj, { lineWidth: -1 });
      await fs.writeFile(targetPath, fileContent);

      return res.json({ success: true, slug: previewSlug });
    }

    // Обычное сохранение/публикация
    const targetPath = path.join(RESULTS_DIR, `${nextSlug}.md`);
    const finalContentObj = await relocateAadnaResultMedia(nextSlug, normalized, 'results');

    if (snpToSync) {
      await syncSnpPath(snpToSync);
    }

    await generatePreview(nextSlug, finalContentObj);

    const fileContent = matter.stringify('', finalContentObj, { lineWidth: -1 });
    await fs.writeFile(targetPath, fileContent);

    // Если имя файла изменилось, удаляем старый файл
    if (cleanOriginalSlug && cleanOriginalSlug !== nextSlug) {
      const oldPath = path.join(RESULTS_DIR, `${cleanOriginalSlug}.md`);
      await fs.remove(oldPath);
    }

    // Чистим временные файлы предпросмотра
    const previewFile = path.join(RESULTS_DIR, `${nextSlug}.cms-tmp-preview.md`);
    const previewImage = path.join(AADNA_PATH, `static/og/results/${nextSlug}.cms-tmp-preview.png`);
    await fs.remove(previewFile);
    await fs.remove(previewImage);

    res.json({ success: true, slug: nextSlug });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 5.5 POST /api/entry/:slug/revert - Откат изменений поста
app.post('/api/entry/:slug/revert', async (req, res) => {
  const { slug } = req.params;
  const filePath = path.join(RESULTS_DIR, `${slug}.md`);

  try {
    // Проверяем, отслеживается ли файл в Git
    const checkRes = runGitCommand(`git ls-files --error-unmatch content/results/${slug}.md`);
    if (checkRes.success) {
      // Файл отслеживается, откатываем изменения к HEAD
      runGitCommand(`git checkout -- content/results/${slug}.md`);
      runGitCommand(`git checkout -- static/og/results/manifest.json`);
      
      // Картинку OG можно удалить/пересоздать при необходимости, но git restore возвращает файл.
      // Если файл картинки был создан, но не отслеживается, мы можем удалить его, чтобы не захламлять репозиторий.
      const ogPath = path.join(AADNA_PATH, `static/og/results/${slug}.png`);
      if (await fs.pathExists(ogPath)) {
        const ogCheck = runGitCommand(`git ls-files --error-unmatch static/og/results/${slug}.png`);
        if (!ogCheck.success) {
          await fs.remove(ogPath);
        }
      }
    } else {
      // Файл новый (не отслеживается), просто полностью удаляем его
      await fs.remove(filePath);
      
      // Удаляем также сгенерированную OG-картинку
      const ogPath = path.join(AADNA_PATH, `static/og/results/${slug}.png`);
      await fs.remove(ogPath);
      
      // Удаляем медиа-папку этого рода, если она создалась
      const mediaFolder = path.join(MEDIA_DIR, slug);
      await fs.remove(mediaFolder);
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 5.6 POST /api/entry/:slug/clear-preview - Очистка временных файлов предпросмотра
app.post('/api/entry/:slug/clear-preview', async (req, res) => {
  const { slug } = req.params;
  const cleanSlug = slug.replace('.cms-tmp-preview', '');
  
  const previewFile = path.join(RESULTS_DIR, `${cleanSlug}.cms-tmp-preview.md`);
  const previewImage = path.join(AADNA_PATH, `static/og/results/${cleanSlug}.cms-tmp-preview.png`);

  try {
    await fs.remove(previewFile);
    await fs.remove(previewImage);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 5.7 DELETE /api/entry/:slug - Удаление поста
app.delete('/api/entry/:slug', async (req, res) => {
  const { slug } = req.params;
  const cleanSlug = slug.replace('.cms-tmp-preview', '');

  try {
    const targetPath = path.join(RESULTS_DIR, `${cleanSlug}.md`);

    if (await fs.pathExists(targetPath)) {
      // Удаляем сам файл поста
      await fs.remove(targetPath);

      // Удаляем папку медиа в static/media/results/${cleanSlug}/ если есть
      const mediaDir = path.join(AADNA_PATH, 'static/media/results', cleanSlug);
      if (await fs.pathExists(mediaDir)) {
        await fs.remove(mediaDir);
      }

      // Удаляем OG-изображение поста
      const ogImage = path.join(AADNA_PATH, 'static/og/results', `${cleanSlug}.png`);
      if (await fs.pathExists(ogImage)) {
        await fs.remove(ogImage);
      }
    }

    // Чистим временные файлы предпросмотра
    const previewFile = path.join(RESULTS_DIR, `${cleanSlug}.cms-tmp-preview.md`);
    const previewImage = path.join(AADNA_PATH, `static/og/results/${cleanSlug}.cms-tmp-preview.png`);
    await fs.remove(previewFile);
    await fs.remove(previewImage);

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
      exec(`${startCmd} http://localhost:${port}`, (err) => {
        // Игнорируем ошибки авто-открытия
      });
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

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import yaml from 'yaml';
import matter from 'gray-matter';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// Импорт библиотек автоматизации
import { normalizeAadnaContent } from './lib/normalize.js';
import { saveUploadedImage, relocateAadnaResultMedia } from './lib/media.js';
import { syncSnpPath } from './lib/snp.js';
import { generatePreview } from './lib/preview.js';
import { getStatus, publish } from './lib/git.js';
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

// 4. POST /api/upload - Загрузка файла в корень media
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const safeName = slugifyFilename(req.file.originalname);
    const targetPath = path.join(MEDIA_DIR, safeName);
    
    await fs.ensureDir(MEDIA_DIR);
    await fs.writeFile(targetPath, req.file.buffer);

    res.json({ url: `/media/results/${safeName}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 5. POST /api/entry - Сохранить/создать результат с автоматизациями
app.post('/api/entry', async (req, res) => {
  const { originalSlug, data } = req.body;

  try {
    let existingContent = null;
    if (originalSlug) {
      const existingPath = path.join(RESULTS_DIR, `${originalSlug}.md`);
      if (await fs.pathExists(existingPath)) {
        const rawExisting = await fs.readFile(existingPath, 'utf-8');
        existingContent = matter(rawExisting).data;
      }
    }

    // 1 & 2. Нормализация контента, авто-слаг, авто-таксономии и алиасы
    const { content: normalized, snpToSync } = normalizeAadnaContent(
      data, 
      existingContent, 
      originalSlug
    );

    const nextSlug = normalized.path.replace(/\/+$/, ''); // убираем слеш на конце для имени файла
    const targetPath = path.join(RESULTS_DIR, `${nextSlug}.md`);

    // 3. Релокация медиафайлов из корня в папку /media/results/{slug}/
    const finalContentObj = await relocateAadnaResultMedia(nextSlug, normalized);

    // 4. Синхронизация снип-путей через API snp.apsny.dev
    if (snpToSync) {
      await syncSnpPath(snpToSync);
    }

    // 5. Генерация OG-превью изображения
    await generatePreview(nextSlug, finalContentObj);

    // Сохраняем файл на диск
    const fileContent = matter.stringify('', finalContentObj);
    await fs.writeFile(targetPath, fileContent);

    // Если имя файла изменилось, удаляем старый файл
    if (originalSlug && originalSlug !== nextSlug) {
      const oldPath = path.join(RESULTS_DIR, `${originalSlug}.md`);
      await fs.remove(oldPath);
    }

    res.json({ success: true, slug: nextSlug });
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
app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🧬 AADNA Local Admin running at: http://localhost:${PORT}`);
  console.log(`Working with repository: ${AADNA_PATH}`);
  console.log(`==================================================\n`);
  
  // Авто-открытие браузера
  try {
    const startCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    execSync(`${startCmd} http://localhost:${PORT}`);
  } catch (e) {
    // Игнорируем ошибки авто-открытия
  }
});

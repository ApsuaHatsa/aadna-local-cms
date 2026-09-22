import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { invalidateMediaCache } from './media.js';

const REPO_PATH = path.resolve(process.cwd(), '../aadna');

export function runGitCommand(cmd) {
  try {
    const stdout = execSync(cmd, { cwd: REPO_PATH, encoding: 'utf-8', stdio: 'pipe' });
    return { success: true, stdout: stdout.trim(), stderr: '' };
  } catch (error) {
    return {
      success: false,
      stdout: (error.stdout || '').toString().trim(),
      stderr: (error.stderr || '').toString().trim() || error.message
    };
  }
}

export function getStatus() {
  const statusRes = runGitCommand('git status --porcelain');
  if (!statusRes.success) {
    return { success: false, error: statusRes.stderr };
  }

  const lines = statusRes.stdout.split('\n').filter(Boolean);
  let modified = 0;
  let added = 0;
  let deleted = 0;
  let untracked = 0;
  const files = [];

  for (const line of lines) {
    const code = line.slice(0, 2);
    const file = line.slice(3);
    
    let statusText = 'M';
    if (code.includes('M')) {
      modified++;
      statusText = 'M';
    } else if (code.includes('A')) {
      added++;
      statusText = 'A';
    } else if (code.includes('D')) {
      deleted++;
      statusText = 'D';
    } else if (code.includes('?')) {
      untracked++;
      statusText = '??';
    }
    
    files.push({ file, status: statusText });
  }

  // Получаем последний коммит
  const logRes = runGitCommand('git log -n 1 --oneline');
  const lastCommit = logRes.success ? logRes.stdout : 'Unknown';

  return {
    success: true,
    modified,
    added,
    deleted,
    untracked,
    totalChanges: lines.length,
    lastCommit,
    files
  };
}

export function publish(commitMessage, filesToCommit) {
  if (!commitMessage || !commitMessage.trim()) {
    return { success: false, stderr: 'Commit message is required' };
  }

  const message = commitMessage.trim();

  // 1. git add
  if (filesToCommit && filesToCommit.length > 0) {
    // Сбросим текущий индекс, чтобы не закоммитить лишнее (если что-то было добавлено)
    runGitCommand('git reset');
    
    // Добавим только выбранные файлы. Используем -- чтобы git понимал, что это пути
    const filesArg = filesToCommit.map(f => `"${f.replace(/"/g, '\\"')}"`).join(' ');
    const addRes = runGitCommand(`git add -- ${filesArg}`);
    if (!addRes.success) return addRes;
  } else {
    // По умолчанию добавляем всё
    const addRes = runGitCommand('git add .');
    if (!addRes.success) return addRes;
  }

  // Проверяем, есть ли что коммитить
  const diffRes = runGitCommand('git diff --cached --quiet');
  // В git diff --quiet код возврата 1 означает наличие изменений, код 0 означает отсутствие изменений
  if (diffRes.success) {
    // Код 0: изменений нет
    return { success: true, stdout: 'No changes to commit', stderr: '' };
  }

  // 2. git commit
  const commitRes = runGitCommand(`git commit -m "${message.replace(/"/g, '\\"')}"`);
  if (!commitRes.success) return commitRes;

  // 3. git pull --rebase
  const pullRes = runGitCommand('git pull --rebase origin main');
  if (!pullRes.success) {
    runGitCommand('git rebase --abort');
    return {
      success: false,
      stdout: pullRes.stdout,
      stderr: `Ошибка при синхронизации (git pull --rebase). Возникли конфликты с сервером. Процесс rebase отменен. Пожалуйста, разрешите конфликты вручную в терминале.\nДетали: ${pullRes.stderr}`
    };
  }

  // 4. git push
  const pushRes = runGitCommand('git push origin main');
  return pushRes;
}

// 5. Отмена незакоммиченных изменений конкретных файлов
export function discardFilesChanges(files) {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return { success: false, error: 'Не указаны файлы для отмены изменений' };
  }

  let hasMedia = false;

  for (const file of files) {
    if (!file || typeof file !== 'string') continue;

    // Защита от Path Traversal
    const resolvedPath = path.resolve(REPO_PATH, file);
    if (!resolvedPath.startsWith(REPO_PATH)) {
      continue;
    }

    if (file.startsWith('static/media/')) {
      hasMedia = true;
    }

    // 1. Сброс из индекса (если был добавлен в stage)
    runGitCommand(`git reset HEAD -- "${file.replace(/"/g, '\\"')}"`);

    // 2. Проверяем, отслеживается ли файл в Git (был ли закоммичен ранее)
    const checkTracked = runGitCommand(`git ls-files --error-unmatch "${file.replace(/"/g, '\\"')}"`);
    if (checkTracked.success) {
      // Файл отслеживается: восстанавливаем из HEAD (для измененных и удаленных файлов)
      runGitCommand(`git checkout HEAD -- "${file.replace(/"/g, '\\"')}"`);
    } else {
      // Файл новый или неотслеживаемый (untracked): физически удаляем с диска
      try {
        if (fs.existsSync(resolvedPath)) {
          fs.removeSync(resolvedPath);
        }
      } catch (err) {
        console.error(`[Git Discard] Ошибка удаления файла ${file}:`, err);
      }
    }
  }

  if (hasMedia) {
    try {
      invalidateMediaCache();
    } catch (e) {}
  }

  return { success: true, status: getStatus() };
}

// 6. Получение списка последних коммитов
export function getGitLog(count = 15) {
  const safeCount = Math.min(Math.max(parseInt(count, 10) || 15, 1), 50);
  const logRes = runGitCommand(`git log -n ${safeCount} --pretty=format:"%h%x09%an%x09%ad%x09%s" --date=short`);
  if (!logRes.success) {
    return { success: false, error: logRes.stderr, commits: [] };
  }

  const lines = logRes.stdout.split('\n').filter(Boolean);
  const commits = lines.map(line => {
    const [hash, author, date, ...rest] = line.split('\t');
    return {
      hash: hash || '',
      author: author || '',
      date: date || '',
      message: rest.join('\t') || ''
    };
  });

  return { success: true, commits };
}

// 7. Откат конкретного коммита через git revert
export function revertGitCommit(commitHash) {
  if (!commitHash || typeof commitHash !== 'string' || !/^[a-f0-9]{6,40}$/i.test(commitHash.trim())) {
    return { success: false, error: 'Неверный хэш коммита' };
  }

  const cleanHash = commitHash.trim();

  // Создаем revert-коммит
  const revertRes = runGitCommand(`git revert --no-edit ${cleanHash}`);
  if (!revertRes.success) {
    // При конфликте обязательно прерываем revert
    runGitCommand('git revert --abort');
    return {
      success: false,
      error: `Не удалось автоматически откатить коммит из-за конфликта файлов. Revert отменен.\nДетали: ${revertRes.stderr}`
    };
  }

  // Отправляем в remote
  const pushRes = runGitCommand('git push origin main');
  if (!pushRes.success) {
    return {
      success: true,
      warning: `Коммит ${cleanHash} успешно откачен локально, но не удалось отправить на GitHub: ${pushRes.stderr}`,
      status: getStatus()
    };
  }

  return {
    success: true,
    message: `Коммит ${cleanHash} успешно откачен и опубликован на GitHub`,
    status: getStatus()
  };
}

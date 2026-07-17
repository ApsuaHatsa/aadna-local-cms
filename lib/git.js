import { execSync } from 'child_process';
import path from 'path';

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

export function publish(commitMessage) {
  if (!commitMessage || !commitMessage.trim()) {
    return { success: false, stderr: 'Commit message is required' };
  }

  const message = commitMessage.trim();

  // 1. git add .
  const addRes = runGitCommand('git add .');
  if (!addRes.success) return addRes;

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
  if (!pullRes.success) return pullRes;

  // 4. git push
  const pushRes = runGitCommand('git push origin main');
  return pushRes;
}

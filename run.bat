@echo off
chcp 65001 >nul
echo ╔══════════════════════════════════════════════╗
echo ║   🧬 AADNA Local CMS - Запуск...            ║
echo ╚══════════════════════════════════════════════╝
echo.

cd /d "%~dp0"
set CMS_DIR=%cd%

echo [1/3] Проверка обновлений для CMS...
git fetch origin main >nul 2>&1
if %errorlevel% equ 0 (
  for /f %%i in ('git rev-list --count main..origin/main') do set BEHIND_CMS=%%i
  if "%BEHIND_CMS%" neq "0" if "%BEHIND_CMS%" neq "" (
    git diff --quiet
    if %errorlevel% neq 0 (
      echo [!] Внимание: обнаружены локальные изменения в CMS. Обновление пропущено во избежание конфликтов.
    ) else (
      echo [!] Найдено новых коммитов для CMS: %BEHIND_CMS%. Обновляю...
      git pull --rebase origin main
    )
  ) else (
    echo [✓] CMS обновлена.
  )
) else (
  echo [!] Нет подключения к интернету или репозиторию CMS. Пропускаю обновление.
)

echo.
echo [2/3] Проверка обновлений для сайта aadna...
if exist "..\aadna" (
  cd ..\aadna
  git fetch origin main >nul 2>&1
  if %errorlevel% equ 0 (
    for /f %%i in ('git rev-list --count main..origin/main') do set BEHIND_SITE=%%i
    if "%BEHIND_SITE%" neq "0" if "%BEHIND_SITE%" neq "" (
      git diff --quiet
      if %errorlevel% neq 0 (
        echo [!] Внимание: обнаружены локальные изменения на сайте. Обновление пропущено во избежание конфликтов.
      ) else (
        echo [!] Найдено новых коммитов для сайта: %BEHIND_SITE%. Обновляю...
        git pull --rebase origin main
      )
    ) else (
      echo [✓] Сайт обновлен.
    )
  ) else (
    echo [!] Нет подключения к интернету или репозиторию сайта. Пропускаю обновление.
  )
  cd /d "%CMS_DIR%"
) else (
  echo [✗] Репозиторий сайта ..\aadna не найден!
)

echo.
echo [3/3] Запуск сервера...
start http://localhost:4400
node server.js
pause

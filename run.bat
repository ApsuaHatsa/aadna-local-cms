@echo off
echo ==============================================
echo    AADNA Local CMS - Starting...
echo    Apsny Production Inc. (API)
echo ==============================================
echo.

cd /d "%~dp0"
set CMS_DIR=%cd%

echo [1/3] Checking for CMS updates...
git fetch origin main >nul 2>&1
if %errorlevel% equ 0 (
  for /f %%i in ('git rev-list --count main..origin/main') do set BEHIND_CMS=%%i
  if "%BEHIND_CMS%" neq "0" if "%BEHIND_CMS%" neq "" (
    git diff --quiet
    if %errorlevel% neq 0 (
      echo [!] Local CMS changes detected. Skipping update to avoid conflicts.
    ) else (
      echo [!] Found %BEHIND_CMS% new CMS commits. Updating...
      git pull --rebase origin main
    )
  ) else (
    echo [OK] CMS is up to date.
  )
) else (
  echo [!] No internet or CMS repo unavailable. Skipping update.
)

echo.
echo [2/3] Checking for site updates...
if exist "..\aadna" (
  cd ..\aadna
  git fetch origin main >nul 2>&1
  if %errorlevel% equ 0 (
    for /f %%i in ('git rev-list --count main..origin/main') do set BEHIND_SITE=%%i
    if "%BEHIND_SITE%" neq "0" if "%BEHIND_SITE%" neq "" (
      git diff --quiet
      if %errorlevel% neq 0 (
        echo [!] Local site changes detected. Skipping update to avoid conflicts.
      ) else (
        echo [!] Found %BEHIND_SITE% new site commits. Updating...
        git pull --rebase origin main
      )
    ) else (
      echo [OK] Site is up to date.
    )
  ) else (
    echo [!] No internet or site repo unavailable. Skipping update.
  )
  cd /d "%CMS_DIR%"
) else (
  echo [!] Site repository ..\aadna not found!
)

echo.
echo [3/3] Starting servers...

rem Check if Zola is installed
where zola >nul 2>&1
if %errorlevel% equ 0 (
  rem Check if port 1111 is already in use
  netstat -ano | findstr :1111 >nul 2>&1
  if %errorlevel% equ 0 (
    echo [OK] Zola preview server already running on port 1111.
  ) else (
    echo [..] Starting Zola preview server on port 1111...
    if exist "..\aadna" (
      cd ..\aadna
      start /b zola serve --drafts -p 1111 >nul 2>&1
      cd /d "%CMS_DIR%"
    )
  )
) else (
  echo [!] Zola not found. Local preview on port 1111 will be unavailable.
)

echo =======================================================
echo  Ready! Admin panel: http://localhost:4400
echo =======================================================
node server.js

rem On exit, kill background Zola process
taskkill /f /im zola.exe >nul 2>&1
pause

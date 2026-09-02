# =============================================================================
# AADNA Local CMS - Windows Installer (PowerShell)
# Apsny Production Inc.
# =============================================================================

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# -----------------------------------------------------------------------------
# Проверка прав Администратора и автоматический перезапуск с повышением (UAC)
# -----------------------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Для автоматической тихой установки компонентов требуются права Администратора." -ForegroundColor Yellow
    Write-Host "Запрашиваю права Администратора (UAC)..." -ForegroundColor Yellow
    $scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
    Start-Process powershell.exe -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", $scriptPath) -Verb RunAs
    exit
}

try {

Write-Host "" 
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "   AADNA Local CMS - Installer v1.1" -ForegroundColor Cyan
Write-Host "   Apsny Production Inc. (API)" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# -----------------------------------------------------------------------------
# Этап 1: Выбор рабочей папки
# -----------------------------------------------------------------------------
$defaultWorkspace = "C:\aadna-workspace"
Write-Host "Этот скрипт настроит все компоненты для локального редактирования сайта."
Write-Host "По умолчанию файлы будут установлены в папку: $defaultWorkspace"
$choice = Read-Host "Нажмите Enter для подтверждения или введите другой путь"

$workspace = $defaultWorkspace
if ($choice -ne "") {
    $workspace = $choice.Trim()
}

Write-Host "-> Будет использована папка: $workspace" -ForegroundColor Yellow
if (!(Test-Path $workspace)) {
    New-Item -ItemType Directory -Force -Path $workspace | Out-Null
    Write-Host "[OK] Папка создана." -ForegroundColor Green
}

# Временная папка для скачивания установщиков
$tempDir = Join-Path $workspace "temp_installer"
if (!(Test-Path $tempDir)) {
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
}

# Use TLS 1.2 for all downloads (required by GitHub/Node.js CDN)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$webClient = New-Object System.Net.WebClient

# Функция обновления PATH в текущей сессии
function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# -----------------------------------------------------------------------------
# Этап 2: Проверка и установка Git
# -----------------------------------------------------------------------------
Write-Host "`n[2/13] Проверка Git..." -ForegroundColor Blue
$gitCheck = Get-Command git -ErrorAction SilentlyContinue
if ($gitCheck -eq $null) {
    Write-Host "[!] Git не установлен. Скачиваю Git для Windows..." -ForegroundColor Red
    $gitUrl = "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe"
    $gitExe = Join-Path $tempDir "git-installer.exe"
    
    Write-Host "Скачивание Git (52 MB)..." -ForegroundColor Yellow
    $webClient.DownloadFile($gitUrl, $gitExe)
    if (!(Test-Path $gitExe)) { throw "Файл git-installer.exe не найден после скачивания. Возможно, антивирус заблокировал загрузку." }
    Unblock-File -Path $gitExe -ErrorAction SilentlyContinue
    
    Write-Host "Установка Git (это может занять 1 минуту)..." -ForegroundColor Yellow
    $process = Start-Process -FilePath $gitExe -ArgumentList "/VERYSILENT", "/NORESTART", "/NOCANCEL", "/SP-" -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Ошибка при установке Git (код: $($process.ExitCode))."
    }
    Write-Host "[OK] Git успешно установлен!" -ForegroundColor Green
    Refresh-Path
} else {
    Write-Host "[OK] Git уже установлен: $((git --version).Trim())" -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# Этап 3: Проверка и установка Node.js
# -----------------------------------------------------------------------------
Write-Host "`n[3/13] Проверка Node.js..." -ForegroundColor Blue
$nodeCheck = Get-Command node -ErrorAction SilentlyContinue
$needsNode = $true

if ($nodeCheck -ne $null) {
    $nodeVersionRaw = & node --version
    $nodeMajor = [int]($nodeVersionRaw.Substring(1).Split('.')[0])
    if ($nodeMajor -ge 20) {
        Write-Host "[OK] Node.js уже установлен: $nodeVersionRaw" -ForegroundColor Green
        $needsNode = $false
    } else {
        Write-Host "[!] Установленная версия Node.js ($nodeVersionRaw) устарела. Требуется версия 20+." -ForegroundColor Red
    }
}

if ($needsNode) {
    Write-Host "Скачиваю Node.js v22 LTS..." -ForegroundColor Yellow
    $nodeUrl = "https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi"
    $nodeMsi = Join-Path $tempDir "node-installer.msi"
    
    Write-Host "Скачивание Node.js (30 MB)..." -ForegroundColor Yellow
    $webClient.DownloadFile($nodeUrl, $nodeMsi)
    if (!(Test-Path $nodeMsi)) { throw "Файл node-installer.msi не найден после скачивания. Возможно, антивирус заблокировал загрузку." }
    Unblock-File -Path $nodeMsi -ErrorAction SilentlyContinue
    
    Write-Host "Установка Node.js (это может занять 1-2 минуты)..." -ForegroundColor Yellow
    $msiArgs = "/i `"$nodeMsi`" /qn /norestart /l*v `"$(Join-Path $tempDir 'node-install.log')`""
    $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -Wait -PassThru
    if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
        Write-Host "[!] Ошибка установки Node.js (код: $($process.ExitCode)). Лог: $(Join-Path $tempDir 'node-install.log')" -ForegroundColor Red
        Write-Host "Попробуйте запустить установщик от имени Администратора (правый клик -> Запуск от Администратора)." -ForegroundColor Yellow
        throw "Node.js installation failed with exit code $($process.ExitCode)"
    }
    Write-Host "[OK] Node.js успешно установлен!" -ForegroundColor Green
    Refresh-Path
}

# -----------------------------------------------------------------------------
# Этап 4: Проверка и установка GitHub CLI
# -----------------------------------------------------------------------------
Write-Host "`n[4/13] Проверка GitHub CLI (gh)..." -ForegroundColor Blue
$ghCheck = Get-Command gh -ErrorAction SilentlyContinue
if ($ghCheck -eq $null) {
    Write-Host "[!] GitHub CLI не установлен. Скачиваю..." -ForegroundColor Red
    $ghUrl = "https://github.com/cli/cli/releases/download/v2.65.0/gh_2.65.0_windows_amd64.msi"
    $ghMsi = Join-Path $tempDir "gh-installer.msi"
    
    Write-Host "Скачивание gh..." -ForegroundColor Yellow
    $webClient.DownloadFile($ghUrl, $ghMsi)
    if (!(Test-Path $ghMsi)) { throw "Файл gh-installer.msi не найден после скачивания. Возможно, антивирус заблокировал загрузку." }
    Unblock-File -Path $ghMsi -ErrorAction SilentlyContinue
    
    Write-Host "Установка gh..." -ForegroundColor Yellow
    $process = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i", "`"$ghMsi`"", "/qn", "/norestart" -Wait -PassThru
    if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
        throw "Ошибка при установке GitHub CLI (код: $($process.ExitCode))."
    }
    Write-Host "[OK] GitHub CLI успешно установлен!" -ForegroundColor Green
    Refresh-Path
} else {
    Write-Host "[OK] GitHub CLI уже установлен." -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# Этап 5: Проверка и установка Zola
# -----------------------------------------------------------------------------
Write-Host "`n[5/13] Проверка Zola..." -ForegroundColor Blue
$zolaCheck = Get-Command zola -ErrorAction SilentlyContinue
if ($zolaCheck -eq $null) {
    Write-Host "[!] Zola не найдена. Скачиваю Zola для Windows..." -ForegroundColor Red
    $zolaUrl = "https://github.com/getzola/zola/releases/download/v0.19.2/zola-v0.19.2-x86_64-pc-windows-msvc.zip"
    $zolaZip = Join-Path $tempDir "zola.zip"
    $binDir = Join-Path $workspace "bin"
    
    if (!(Test-Path $binDir)) {
        New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    }
    
    Write-Host "Скачивание Zola (6 MB)..." -ForegroundColor Yellow
    $webClient.DownloadFile($zolaUrl, $zolaZip)
    if (!(Test-Path $zolaZip)) { throw "Файл zola.zip не найден после скачивания. Возможно, антивирус заблокировал загрузку." }
    Unblock-File -Path $zolaZip -ErrorAction SilentlyContinue
    
    Write-Host "Распаковка Zola..." -ForegroundColor Yellow
    Expand-Archive -Path $zolaZip -DestinationPath $binDir -Force
    
    # Добавляем binDir в пользовательский PATH, если его там еще нет
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$binDir*") {
        [System.Environment]::SetEnvironmentVariable("Path", $userPath + ";" + $binDir, "User")
    }
    
    Write-Host "[OK] Zola успешно установлена!" -ForegroundColor Green
    Refresh-Path
} else {
    Write-Host "[OK] Zola уже установлена." -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# Этап 6: Авторизация на GitHub
# -----------------------------------------------------------------------------
Write-Host "`n[6/13] Авторизация на GitHub..." -ForegroundColor Blue

$authCheck = & gh auth status 2>&1
if ($authCheck -like "*Logged in to github.com*") {
    Write-Host "[OK] Вы уже авторизованы в GitHub." -ForegroundColor Green
} else {
    Write-Host "Сейчас откроется браузер для авторизации." -ForegroundColor Yellow
    Write-Host "Шаги:" -ForegroundColor Yellow
    Write-Host "  1. Нажмите Enter в этом окне" -ForegroundColor Yellow
    Write-Host "  2. Вас перенаправит на страницу входа" -ForegroundColor Yellow
    Write-Host "  3. Введите на сайте одноразовый код, который сгенерирует консоль ниже." -ForegroundColor Yellow
    Write-Host ""
    
    # Автоматически открываем браузер, чтобы помочь пользователю
    Start-Process "https://github.com/login/device"
    
    & gh auth login --web --git-protocol https
}

# Настраиваем gh как постоянный хелпер учетных данных для Git
& gh auth setup-git

# Проверка доступа к репозиторию
Write-Host "Проверка доступа к репозиторию aadna..." -ForegroundColor Yellow
$repoCheck = & gh repo view ApsuaHatsa/aadna --json name 2>&1
if ($repoCheck -like "*Could not resolve to a Repository*") {
    Write-Host "`n[!] ВНИМАНИЕ: У вашего аккаунта нет доступа к репозиторию ApsuaHatsa/aadna." -ForegroundColor Red
    Write-Host "Попросите владельца репозитория добавить вас в Collaborators (Настройки -> Access)." -ForegroundColor Red
    Write-Host "После того, как вас добавят, нажмите Enter здесь, чтобы продолжить..."
    Read-Host
} else {
    Write-Host "[OK] Доступ подтвержден!" -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# Этап 7: Настройка Git Identity
# -----------------------------------------------------------------------------
Write-Host "`n[7/13] Настройка профиля Git..." -ForegroundColor Blue
$gitName = & git config --global user.name
$gitEmail = & git config --global user.email

if ($gitName -eq $null -or $gitName -eq "") {
    $gitName = Read-Host "Введите ваше Имя и Фамилию (например, Ардзинба Алхас)"
    git config --global user.name $gitName
}
if ($gitEmail -eq $null -or $gitEmail -eq "") {
    $gitEmail = Read-Host "Введите ваш e-mail от аккаунта GitHub"
    git config --global user.email $gitEmail
}
Write-Host "[OK] Имя Git: $gitName <$gitEmail>" -ForegroundColor Green

# -----------------------------------------------------------------------------
# Этапы 8-9: Клонирование репозиториев
# -----------------------------------------------------------------------------
Write-Host "`n[8-9/13] Скачивание репозиториев..." -ForegroundColor Blue

$siteDir = Join-Path $workspace "aadna"
$cmsDir = Join-Path $workspace "aadna-local-cms"

# Сайт
if (Test-Path $siteDir) {
    Write-Host "[OK] Папка с сайтом aadna уже существует. Обновляю код..." -ForegroundColor Yellow
    Set-Location $siteDir
    git pull origin main
} else {
    Write-Host "Клонирую репозиторий сайта в $siteDir..." -ForegroundColor Yellow
    Set-Location $workspace
    & gh repo clone ApsuaHatsa/aadna
}

# CMS
if (Test-Path $cmsDir) {
    Write-Host "[OK] Папка с CMS уже существует. Обновляю код..." -ForegroundColor Yellow
    Set-Location $cmsDir
    git pull origin main
} else {
    Write-Host "Клонирую репозиторий CMS в $cmsDir..." -ForegroundColor Yellow
    Set-Location $workspace
    & gh repo clone ApsuaHatsa/aadna-local-cms
}

# -----------------------------------------------------------------------------
# Этап 10: Установка зависимостей npm
# -----------------------------------------------------------------------------
Write-Host "`n[10/13] Установка пакетов Node.js..." -ForegroundColor Blue

# Убеждаемся, что npm доступен в текущей сессии (защита от проблемы с PATH на чистых ПК)
Refresh-Path
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if ($npmCmd -eq $null) {
    Write-Host "[!] npm не найден в PATH. Ищу по стандартным путям..." -ForegroundColor Yellow
    $npmCandidates = @(
        "$env:ProgramFiles\nodejs\npm.cmd",
        "${env:ProgramFiles(x86)}\nodejs\npm.cmd",
        "$env:APPDATA\npm\npm.cmd"
    )
    $npmFound = $false
    foreach ($candidate in $npmCandidates) {
        if (Test-Path $candidate) {
            $npmDir = Split-Path $candidate
            $env:Path = $npmDir + ";" + $env:Path
            Write-Host "[OK] npm найден: $candidate" -ForegroundColor Green
            $npmFound = $true
            break
        }
    }
    if (-not $npmFound) {
        throw "npm не найден после установки Node.js. Попробуйте закрыть это окно и запустить install.bat заново."
    }
}

Set-Location $cmsDir
Write-Host "Запуск npm install в $cmsDir..." -ForegroundColor Yellow
npm install

Write-Host "Запуск npm install для Screenshot API..." -ForegroundColor Yellow
Set-Location "$cmsDir\screenshot-api"
npm install
Set-Location $cmsDir

# -----------------------------------------------------------------------------
# Этап 11-12: Создание ярлыков
# -----------------------------------------------------------------------------
Write-Host "`n[11-12/13] Создание файлов быстрого запуска..." -ForegroundColor Blue

# Создаем ярлык на Рабочем столе
$desktopPath = [System.IO.Path]::Combine([System.Environment]::GetFolderPath('Desktop'), "AADNA CMS.lnk")
$runPs1Path = Join-Path $cmsDir "run.ps1"

try {
    $WshShell = New-Object -comObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($desktopPath)
    $Shortcut.TargetPath = "powershell.exe"
    $Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runPs1Path`""
    $Shortcut.WorkingDirectory = $cmsDir
    $Shortcut.IconLocation = "shell32.dll,14" # Красивая иконка папки с шестерёнкой
    $Shortcut.Description = "Запустить локальную админку AADNA"
    $Shortcut.Save()
    Write-Host "[OK] Ярлык 'AADNA CMS' создан на вашем Рабочем столе!" -ForegroundColor Green
} catch {
    Write-Host "[!] Не удалось создать ярлык на рабочем столе (нет прав), но вы можете запускать через run.bat." -ForegroundColor Yellow
}

# -----------------------------------------------------------------------------
# Этап 13: Финальный запуск и уборка
# -----------------------------------------------------------------------------
Write-Host "`n[13/13] Уборка временных файлов..." -ForegroundColor Blue
if (Test-Path $tempDir) {
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "======================================================" -ForegroundColor Green
Write-Host "   УСТАНОВКА УСПЕШНО ЗАВЕРШЕНА!" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Для запуска CMS:" -ForegroundColor Green
Write-Host "  1. Кликните дважды по ярлыку 'AADNA CMS' на рабочем столе." -ForegroundColor Green
Write-Host "  2. Откроется окно админки: http://localhost:4400" -ForegroundColor Green
Write-Host ""
Write-Host "  Рабочая папка проекта: $workspace" -ForegroundColor Green
Write-Host ""

} catch {
    Write-Host "" 
    Write-Host "======================================================" -ForegroundColor Red
    Write-Host "   ОШИБКА ВО ВРЕМЯ УСТАНОВКИ" -ForegroundColor Red
    Write-Host "======================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Детали ошибки:" -ForegroundColor Yellow
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Что делать:" -ForegroundColor Yellow
    Write-Host "  1. Попробуйте запустить install.bat от имени Администратора" -ForegroundColor White
    Write-Host "     (правый клик -> Запуск от имени администратора)" -ForegroundColor White
    Write-Host "  2. Проверьте подключение к интернету" -ForegroundColor White
    Write-Host "  3. Отправьте скриншот этого окна разработчику" -ForegroundColor White
    Write-Host ""
}

Write-Host ""
Read-Host "Нажмите Enter для закрытия этого окна"

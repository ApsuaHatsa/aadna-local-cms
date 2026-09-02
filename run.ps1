# =============================================================================
# AADNA Local CMS - Runner (PowerShell)
# Apsny Production Inc. (API)
# =============================================================================

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$cmsDir = $PSScriptRoot
if (-not $cmsDir) {
    $cmsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
Set-Location $cmsDir

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "   AADNA Local CMS - Launching..." -ForegroundColor Cyan
Write-Host "   Apsny Production Inc. (API)" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# Добавляем ../bin в PATH на случай, если Zola лежит там
$binDir = Resolve-Path (Join-Path $cmsDir "..\bin") -ErrorAction SilentlyContinue
if ($binDir -and ($env:Path -notlike "*$binDir*")) {
    $env:Path = "$binDir;" + $env:Path
}

# -----------------------------------------------------------------------------
# [1/3] Проверка обновлений CMS
# -----------------------------------------------------------------------------
Write-Host "[1/3] Проверка обновлений CMS..." -ForegroundColor Blue
try {
    $null = & git fetch origin main 2>&1
    if ($LASTEXITCODE -eq 0) {
        $behindCms = (& git rev-list --count main..origin/main 2>$null).Trim()
        if ($behindCms -and $behindCms -ne "0") {
            $null = & git diff --quiet 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Host "[!] Локальные изменения в CMS. Обновление пропущено." -ForegroundColor Yellow
            } else {
                Write-Host "[!] Найдено новых коммитов ($behindCms). Обновляю CMS..." -ForegroundColor Yellow
                & git pull --rebase origin main
            }
        } else {
            Write-Host "[OK] CMS в актуальном состоянии." -ForegroundColor Green
        }
    } else {
        Write-Host "[!] Нет связи с GitHub. Пропускаю обновление." -ForegroundColor Yellow
    }
} catch {
    Write-Host "[!] Пропуск обновления CMS: $($_.Exception.Message)" -ForegroundColor Yellow
}

# -----------------------------------------------------------------------------
# [2/3] Проверка обновлений сайта aadna
# -----------------------------------------------------------------------------
Write-Host "`n[2/3] Проверка обновлений сайта aadna..." -ForegroundColor Blue
$siteDir = Resolve-Path (Join-Path $cmsDir "..\aadna") -ErrorAction SilentlyContinue
if ($siteDir -and (Test-Path $siteDir)) {
    Push-Location $siteDir
    try {
        $null = & git fetch origin main 2>&1
        if ($LASTEXITCODE -eq 0) {
            $behindSite = (& git rev-list --count main..origin/main 2>$null).Trim()
            if ($behindSite -and $behindSite -ne "0") {
                $null = & git diff --quiet 2>&1
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "[!] Локальные изменения на сайте. Обновление пропущено." -ForegroundColor Yellow
                } else {
                    Write-Host "[!] Найдено новых коммитов ($behindSite). Обновляю сайт..." -ForegroundColor Yellow
                    & git pull --rebase origin main
                }
            } else {
                Write-Host "[OK] Сайт в актуальном состоянии." -ForegroundColor Green
            }
        } else {
            Write-Host "[!] Нет связи с GitHub. Пропускаю обновление сайта." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[!] Пропуск обновления сайта: $($_.Exception.Message)" -ForegroundColor Yellow
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[!] Репозиторий сайта ..\aadna не найден!" -ForegroundColor Red
}

# -----------------------------------------------------------------------------
# [3/3] Подготовка и запуск серверов
# -----------------------------------------------------------------------------
Write-Host "`n[3/3] Подготовка серверов..." -ForegroundColor Blue

$zolaStartedByUs = $false
$zolaCmd = Get-Command zola -ErrorAction SilentlyContinue

if ($zolaCmd -ne $null) {
    # Проверяем порт 1111
    $zolaPortActive = Get-NetTCPConnection -LocalPort 1111 -State Listen -ErrorAction SilentlyContinue
    if ($zolaPortActive) {
        Write-Host "[OK] Сервер предпросмотра Zola уже работает на порту 1111." -ForegroundColor Green
    } else {
        if ($siteDir -and (Test-Path $siteDir)) {
            Write-Host "[..] Запускаю сервер Zola на порту 1111..." -ForegroundColor Yellow
            Start-Process -FilePath "zola" -ArgumentList "serve", "--drafts", "-p", "1111" -WorkingDirectory $siteDir -WindowStyle Hidden
            $zolaStartedByUs = $true
            Write-Host "[OK] Сервер Zola запущен." -ForegroundColor Green
        }
    }
} else {
    Write-Host "[!] Zola не найдена. Предпросмотр на порту 1111 будет недоступен." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Green
Write-Host "   Админка запускается: http://localhost:4400" -ForegroundColor Green
Write-Host "   Для остановки нажмите Ctrl + C" -ForegroundColor Gray
Write-Host "=======================================================" -ForegroundColor Green
Write-Host ""

try {
    & node server.js
} finally {
    Write-Host "`nОстановка фоновых служб..." -ForegroundColor Yellow
    if ($zolaStartedByUs) {
        Get-Process -Name zola -ErrorAction SilentlyContinue | Stop-Process -Force
        Write-Host "[OK] Сервер Zola остановлен." -ForegroundColor Green
    }
}
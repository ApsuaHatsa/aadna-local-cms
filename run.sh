#!/usr/bin/env bash

# =============================================================================
# 🧬 AADNA Local CMS - Startup & Auto-Update Script (macOS/Linux)
# =============================================================================

cd "$(dirname "$0")"
CMS_DIR_PATH=$(pwd)

echo "╔══════════════════════════════════════════════╗"
echo "║   🧬 AADNA Local CMS - Запуск...            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

echo "[1/3] Проверка обновлений для CMS..."
if git fetch origin main >/dev/null 2>&1; then
  BEHIND_CMS=$(git rev-list --count main..origin/main)
  if [ "$BEHIND_CMS" -gt 0 ]; then
    if ! git diff --quiet; then
      echo "[!] Внимание: обнаружены локальные изменения в CMS. Обновление пропущено во избежание конфликтов."
    else
      echo "[!] Найдено новых коммитов для CMS: $BEHIND_CMS. Обновляю..."
      git pull --rebase origin main
    fi
  else
    echo "[✓] CMS обновлена."
  fi
else
  echo "[!] Нет подключения к интернету или репозиторию CMS. Пропускаю обновление."
fi

echo ""
echo "[2/3] Проверка обновлений для сайта aadna..."
if [ -d "../aadna" ]; then
  cd ../aadna
  if git fetch origin main >/dev/null 2>&1; then
    BEHIND_SITE=$(git rev-list --count main..origin/main)
    if [ "$BEHIND_SITE" -gt 0 ]; then
      if ! git diff --quiet; then
        echo "[!] Внимание: обнаружены локальные изменения на сайте. Обновление пропущено во избежание конфликтов."
      else
        echo "[!] Найдено новых коммитов для сайта: $BEHIND_SITE. Обновляю..."
        git pull --rebase origin main
      fi
    else
      echo "[✓] Сайт обновлен."
    fi
  else
    echo "[!] Нет подключения к интернету или репозиторию сайта. Пропускаю обновление."
  fi
  cd "$CMS_DIR_PATH"
else
  echo "[✗] Репозиторий сайта ../aadna не найден!"
fi

echo ""
echo "[3/3] Запуск сервера..."
xdg-open http://localhost:4400 2>/dev/null || open http://localhost:4400 2>/dev/null &
node server.js

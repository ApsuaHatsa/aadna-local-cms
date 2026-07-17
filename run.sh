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
echo "[3/3] Подготовка серверов..."

ZOLA_PID=""

# Функция очистки фоновых процессов при выходе
cleanup() {
  if [ -n "$ZOLA_PID" ]; then
    echo -e "\n[→] Останавливаю сервер предпросмотра Zola (PID: $ZOLA_PID)..."
    kill "$ZOLA_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Проверяем наличие Zola
ZOLA_CMD="zola"
if ! command -v zola &>/dev/null; then
  if [ -x "$HOME/.local/bin/zola" ]; then
    ZOLA_CMD="$HOME/.local/bin/zola"
  elif [ -x "/usr/local/bin/zola" ]; then
    ZOLA_CMD="/usr/local/bin/zola"
  fi
fi

if command -v "$ZOLA_CMD" &>/dev/null || [ -x "$ZOLA_CMD" ]; then
  # Проверяем, свободен ли порт 1111
  if lsof -i :1111 >/dev/null 2>&1 || nc -z localhost 1111 >/dev/null 2>&1; then
    echo "[✓] Сервер предпросмотра Zola уже запущен на порту 1111."
  else
    echo "[→] Запускаю локальный сервер предпросмотра Zola на порту 1111..."
    if [ -d "../aadna" ]; then
      cd ../aadna
      "$ZOLA_CMD" serve --drafts -p 1111 >/dev/null 2>&1 &
      ZOLA_PID=$!
      cd "$CMS_DIR_PATH"
    fi
  fi
else
  echo "[!] Zola не найдена в системе. Локальный предпросмотр на порту 1111 будет недоступен."
fi

echo "[→] Запускаю сервер админки на порту 4400..."
xdg-open http://localhost:4400 2>/dev/null || open http://localhost:4400 2>/dev/null &
node server.js

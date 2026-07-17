#!/usr/bin/env bash

# =============================================================================
# 🧬 AADNA Local CMS - macOS/Linux Installer (bash)
# Apsny Production Inc.
# =============================================================================

set -euo pipefail

# Цветовая схема
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║        🧬 AADNA Local CMS - Установщик v1.0         ║${NC}"
echo -e "${CYAN}║        Apsny Production Inc. (API)                  ║${NC}"
echo -e "${CYAN}║        macOS / Linux Edition                        ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Определение операционной системы
OS="unknown"
if [[ "$OSTYPE" == "darwin"* ]]; then
  OS="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  OS="linux"
fi

# -----------------------------------------------------------------------------
# Этап 1: Выбор рабочей папки
# -----------------------------------------------------------------------------
DEFAULT_WORKSPACE="$HOME/aadna-workspace"
echo "Этот скрипт настроит все компоненты для локального редактирования сайта."
echo "По умолчанию файлы будут установлены в папку: $DEFAULT_WORKSPACE"
read -p "Нажмите Enter для подтверждения или введите другой путь: " choice

WORKSPACE="${choice:-$DEFAULT_WORKSPACE}"
WORKSPACE="${WORKSPACE/#\~/$HOME}" # Разворачиваем символ ~ в $HOME

echo -e "-> Будет использована папка: ${YELLOW}$WORKSPACE${NC}"
mkdir -p "$WORKSPACE"
echo -e "${GREEN}✓ Папка готова.${NC}"

# Функция открытия ссылки в браузере
open_browser() {
  local url="$1"
  if [ "$OS" = "macos" ]; then
    open "$url" 2>/dev/null || true
  else
    xdg-open "$url" 2>/dev/null || true
  fi
}

# -----------------------------------------------------------------------------
# Этап 2: Проверка и установка Git
# -----------------------------------------------------------------------------
echo -e "\n${BLUE}[2/12] Проверка Git...${NC}"
if ! command -v git &>/dev/null; then
  echo -e "${RED}✗ Git не установлен. Устанавливаю Git...${NC}"
  if [ "$OS" = "macos" ]; then
    echo "Установка через Xcode Command Line Tools..."
    xcode-select --install || true
    echo "Пожалуйста, завершите системное окно установки Xcode Tools, затем нажмите Enter..."
    read
  elif [ "$OS" = "linux" ]; then
    if command -v apt-get &>/dev/null; then
      sudo apt-get update && sudo apt-get install -y git
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y git
    else
      echo -e "${RED}Неизвестный менеджер пакетов. Пожалуйста, установите git вручную.${NC}"
      exit 1
    fi
  fi
  echo -e "${GREEN}✓ Git успешно установлен!${NC}"
else
  echo -e "${GREEN}✓ Git уже установлен: $(git --version)${NC}"
fi

# -----------------------------------------------------------------------------
# Этап 3: Проверка и установка Node.js
# -----------------------------------------------------------------------------
echo -e "\n${BLUE}[3/12] Проверка Node.js...${NC}"
NEEDS_NODE=true

if command -v node &>/dev/null; then
  NODE_VER=$(node -v)
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_MAJOR" -ge 20 ]; then
    echo -e "${GREEN}✓ Node.js уже установлен: $NODE_VER${NC}"
    NEEDS_NODE=false
  else
    echo -e "${YELLOW}✗ Установленная версия Node.js ($NODE_VER) устарела. Требуется версия 20+.${NC}"
  fi
fi

if [ "$NEEDS_NODE" = true ]; then
  echo -e "${YELLOW}Устанавливаю Node.js v22 LTS...${NC}"
  if [ "$OS" = "macos" ]; then
    if command -v brew &>/dev/null; then
      brew install node@22
      brew link --overwrite node@22 || true
    else
      # Скачивание напрямую с nodejs.org
      echo "Скачивание установщика Node.js..."
      curl -L -o /tmp/node.pkg https://nodejs.org/dist/v22.16.0/node-v22.16.0.pkg
      sudo installer -pkg /tmp/node.pkg -target /
    fi
  elif [ "$OS" = "linux" ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
  echo -e "${GREEN}✓ Node.js успешно установлен!${NC}"
fi

# -----------------------------------------------------------------------------
# Этап 4: Проверка и установка GitHub CLI (gh)
# -----------------------------------------------------------------------------
echo -e "\n${BLUE}[4/12] Проверка GitHub CLI (gh)...${NC}"
if ! command -v gh &>/dev/null; then
  echo -e "${RED}✗ GitHub CLI не установлен. Устанавливаю...${NC}"
  if [ "$OS" = "macos" ]; then
    if command -v brew &>/dev/null; then
      brew install gh
    else
      echo "Скачивание GitHub CLI..."
      curl -L -o /tmp/gh.tar.gz https://github.com/cli/cli/releases/download/v2.65.0/gh_2.65.0_macOS_amd64.tar.gz
      tar -xf /tmp/gh.tar.gz -C /tmp/
      sudo cp /tmp/gh_*/bin/gh /usr/local/bin/
    fi
  elif [ "$OS" = "linux" ]; then
    if command -v apt-get &>/dev/null; then
      # Установка для Debian/Ubuntu
      (type -p wget >/dev/null || (sudo apt-get update && sudo apt-get install wget -y)) \
      && sudo mkdir -p -m 755 /etc/apt/keyrings \
      && out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      && cat $out | sudo gpg --dearmor -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
      && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
      && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
      && sudo apt-get update \
      && sudo apt-get install gh -y
    fi
  fi
  echo -e "${GREEN}✓ GitHub CLI успешно установлен!${NC}"
else
  echo -e "${GREEN}✓ GitHub CLI уже установлен.${NC}"
fi

# -----------------------------------------------------------------------------
# Этап 5: Авторизация на GitHub
# -----------------------------------------------------------------------------
echo -e "\n${BLUE}[5/12] Авторизация на GitHub...${NC}"
if gh auth status &>/dev/null; then
  echo -e "${GREEN}✓ Вы уже авторизованы в GitHub.${NC}"
else
  echo -e "${YELLOW}Сейчас откроется браузер для авторизации.${NC}"
  echo "Шаги:"
  echo "  1. Скопируйте одноразовый код, который сейчас появится на экране."
  echo "  2. Вас перенаправит в браузер для входа."
  echo "  3. Введите полученный код на сайте."
  echo ""
  
  open_browser "https://github.com/login/device"
  gh auth login --web --git-protocol https
fi

# Проверка доступа к репозиторию
echo -e "${YELLOW}Проверяю доступ к репозиторию aadna...${NC}"
if ! gh repo view ApsuaHatsa/aadna &>/dev/null; then
  echo -e "\n${RED}✗ ВНИМАНИЕ: У вашего аккаунта нет доступа к репозиторию ApsuaHatsa/aadna.${NC}"
  echo "Попросите владельца репозитория добавить вас в Collaborators (Настройки -> Access)."
  read -p "После того, как вас добавят, нажмите Enter здесь, чтобы продолжить..."
else
  echo -e "${GREEN}✓ Доступ подтвержден!${NC}"
fi

# -----------------------------------------------------------------------------
# Этап 6: Настройка Git Identity
# -----------------------------------------------------------------------------
echo -e "\n${BLUE}[6/12] Настройка профиля Git...${NC}"
GIT_NAME=$(git config --global user.name || echo "")
GIT_EMAIL=$(git config --global user.email || echo "")

if [ -z "$GIT_NAME" ]; then
  read -p "Введите ваше Имя и Фамилию (например, Ардзинба Алхас): " GIT_NAME
  git config --global user.name "$GIT_NAME"
fi
if [ -z "$GIT_EMAIL" ]; then
  read -p "Введите ваш e-mail от аккаунта GitHub: " GIT_EMAIL
  git config --global user.email "$GIT_EMAIL"
fi
echo -e "${GREEN}✓ Git настроен: $GIT_NAME <$GIT_EMAIL>${NC}"

# -----------------------------------------------------------------------------
# Этапы 7-8: Клонирование репозиториев
# -----------------------------------------------------------------------------
echo -e "\n${BLUE}[7-8/12] Скачивание репозиториев...${NC}"

SITE_DIR="$WORKSPACE/aadna"
CMS_DIR="$WORKSPACE/aadna-local-cms"

# Сайт
if [ -d "$SITE_DIR" ]; then
  echo -e "${YELLOW}✓ Папка с сайтом aadna уже существует. Обновляю код...${NC}"
  cd "$SITE_DIR" && git pull origin main
else
  echo -e "${YELLOW}Клонирую репозиторий сайта в $SITE_DIR...${NC}"
  cd "$WORKSPACE" && gh repo clone ApsuaHatsa/aadna
fi

# CMS
if [ -d "$CMS_DIR" ]; then
  echo -e "${YELLOW}✓ Папка с CMS уже существует. Обновляю код...${NC}"
  cd "$CMS_DIR" && git pull origin main
else
  echo -e "${YELLOW}Клонирую репозиторий CMS в $CMS_DIR...${NC}"
  cd "$WORKSPACE" && gh repo clone ApsuaHatsa/aadna-local-cms
fi

# -----------------------------------------------------------------------------
# Этап 9: Установка зависимостей npm
# -----------------------------------------------------------------------------
echo -e "\n${BLUE}[9/12] Установка пакетов Node.js...${NC}"
cd "$CMS_DIR"
echo -e "${YELLOW}Запуск npm install в $CMS_DIR...${NC}"
npm install

# -----------------------------------------------------------------------------
# Этап 10-11: Создание ярлыков
# -----------------------------------------------------------------------------
echo -e "\n${BLUE}[10-11/12] Создание файлов быстрого запуска...${NC}"
chmod +x run.sh

# На macOS создаем ярлык на рабочем столе
if [ "$OS" = "macos" ]; then
  DESKTOP_LAUNCHER="$HOME/Desktop/AADNA CMS.command"
  cat << EOF > "$DESKTOP_LAUNCHER"
#!/usr/bin/env bash
cd "$CMS_DIR" && bash run.sh
EOF
  chmod +x "$DESKTOP_LAUNCHER"
  echo -e "${GREEN}✓ Иконка запуска 'AADNA CMS.command' создана на Рабочем столе!${NC}"
fi

echo -e "\n${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║             УСТАНОВКА УСПЕШНО ЗАВЕРШЕНА!             ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}║  Для запуска CMS:                                    ║${NC}"
if [ "$OS" = "macos" ]; then
echo -e "${GREEN}║  • Кликните по иконке 'AADNA CMS' на вашем столе.    ║${NC}"
else
echo -e "${GREEN}║  • Запустите скрипт run.sh из папки CMS.             ║${NC}"
fi
echo -e "${GREEN}║  • Откроется браузер: http://localhost:4400          ║${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}║  Рабочая папка проекта:                              ║${NC}"
echo -e "${GREEN}║  $WORKSPACE                                          ║${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

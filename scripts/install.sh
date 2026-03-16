#!/usr/bin/env bash
# =============================================================
# Пекарня — встановлення (одна команда)
# Запуск: bash scripts/install.sh
# =============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== Пекарня: встановлення ==="
echo "Директорія: $ROOT"

# --- Python ---
if command -v python3 &>/dev/null; then
    PYTHON=python3
elif command -v python &>/dev/null; then
    PYTHON=python
else
    echo "ПОМИЛКА: Python не знайдено. Встановіть Python 3.11+"
    exit 1
fi

echo "Python: $($PYTHON --version)"

# --- Backend: venv + залежності ---
echo ""
echo ">>> Встановлення бекенду..."
cd "$ROOT/backend"

$PYTHON -m venv venv

# Активація (Windows Git Bash або Linux/macOS)
if [ -f "venv/Scripts/activate" ]; then
    source venv/Scripts/activate
else
    source venv/bin/activate
fi

pip install --upgrade pip -q
pip install -r requirements.txt -q
echo "    Залежності встановлено."

# --- Ініціалізація БД ---
echo ""
echo ">>> Ініціалізація бази даних..."
cd "$ROOT"

$PYTHON -c "
import sys
sys.path.insert(0, '.')
from backend.database import engine, Base
import backend.models
Base.metadata.create_all(bind=engine)
print('    Таблиці створено.')
"

# Seed через schema.sql (INSERT OR IGNORE — безпечно повторювати)
if command -v sqlite3 &>/dev/null; then
    sqlite3 bakery.db < database/schema.sql 2>/dev/null || true
    echo "    Schema.sql застосовано (seed-дані)."
fi

# --- Frontend: npm install ---
echo ""
echo ">>> Встановлення фронтенду..."
if command -v npm &>/dev/null; then
    cd "$ROOT/frontend"
    npm install --silent
    echo "    npm packages встановлено."
else
    echo "ПОПЕРЕДЖЕННЯ: npm не знайдено. Встановіть Node.js 18+."
fi

# --- Готово ---
echo ""
echo "=== Встановлення завершено! ==="
echo ""
echo "Запуск:"
echo "  Бекенд:   bash scripts/start_backend.sh"
echo "  Фронтенд: bash scripts/start_frontend.sh"
echo "  Або разом: bash scripts/start.sh"

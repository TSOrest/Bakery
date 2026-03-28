#!/usr/bin/env bash
# Запуск тестів
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f "backend/venv/Scripts/activate" ]; then
    source backend/venv/Scripts/activate
else
    source backend/venv/bin/activate
fi

pip install pytest httpx -q

echo ">>> Запуск тестів..."
python -m pytest tests/ -v

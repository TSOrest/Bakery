#!/usr/bin/env bash
# Запуск FastAPI бекенду
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f "backend/venv/Scripts/activate" ]; then
    source backend/venv/Scripts/activate
else
    source backend/venv/bin/activate
fi

echo ">>> Бекенд: http://localhost:8000"
echo ">>> Документація: http://localhost:8000/api/docs"

python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

#!/usr/bin/env bash
# Запуск React фронтенду
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/frontend"

echo ">>> Фронтенд: http://localhost:5173"
npm run dev

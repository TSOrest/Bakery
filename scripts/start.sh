#!/usr/bin/env bash
# Запуск обох сервісів одночасно (потребує двох терміналів або tmux)
echo "Запускаємо бекенд і фронтенд..."
echo "Ctrl+C зупиняє обидва."

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$ROOT/scripts/start_backend.sh" &
BACKEND_PID=$!

bash "$ROOT/scripts/start_frontend.sh" &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait

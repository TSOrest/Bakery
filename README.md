# Пекарня — Система управління пекарнею

Веб-застосунок для управління пекарнею. Замінює застарілу базу Access (.accdb).
Повністю офлайн, локальне розгортання на Windows.

---

## Технічний стек

| Компонент | Технологія |
|-----------|-----------|
| Backend | Python 3.11+ · FastAPI · SQLAlchemy 2.0 |
| Database | SQLite (`bakery.db`) |
| Frontend | React 18 · Vite · TypeScript |
| Друк | PDF через браузер (weasyprint) |
| Розгортання | localhost · Windows · Task Scheduler |
| Трей | pystray · Pillow |

---

## Швидкий старт

### Перший запуск (встановлення)

```
install.bat          ← встановлює venv, залежності, базу
install-service.bat  ← реєструє автозапуск при вході в систему + запускає трей
```

### Щоденна робота

Після `install-service.bat` сервер стартує **автоматично при вході в Windows**.
Іконка у системному треї показує стан:

| Іконка | Стан |
|--------|------|
| Зелена | Сервер працює |
| Червона | Сервер зупинений |
| З бейджем | Доступне оновлення |

**Меню трею:** Відкрити · Запустити · Перезапустити · Зупинити · Логи · Оновлення · Вийти

### Ручне керування

```
start.bat        ← запустити сервер
stop.bat         ← зупинити сервер
tray.bat         ← запустити іконку трею (якщо закрита)
start-dev.bat    ← режим розробки (hot-reload + Vite dev server)
```

### Оновлення та відкат

```
update.bat       ← завантажує і встановлює нову версію з GitHub
rollback.bat     ← повертає попередню версію
```

| Сервіс | URL |
|--------|-----|
| Застосунок | http://localhost:8000 |
| Swagger docs | http://localhost:8000/api/docs |
| Dev UI (HMR) | http://localhost:5173 *(тільки в dev-режимі)* |

---

## Структура проекту

```
Пекарня 2/
├── backend/
│   ├── main.py            ← FastAPI app + роздача фронтенду
│   ├── database.py        ← SQLite + SQLAlchemy session
│   ├── models/            ← ORM-моделі (18 таблиць)
│   ├── routers/           ← API ендпоінти
│   ├── schemas/           ← Pydantic схеми
│   ├── services/          ← бізнес-логіка
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── pages/         ← 6 вкладок застосунку
│       ├── components/    ← Layout, спільні компоненти
│       ├── api/           ← fetch-обгортки
│       ├── context/       ← AuthContext, DateContext
│       └── types/         ← TypeScript типи
├── database/
│   ├── schema.sql         ← повна схема SQLite
│   └── migrations/
├── scripts/
│   ├── install-service.ps1  ← Task Scheduler + трей
│   ├── uninstall-service.ps1
│   ├── start.ps1
│   ├── stop.ps1
│   ├── start-dev.ps1
│   ├── update.ps1           ← git checkout + rebuild + restart
│   └── rollback.ps1
├── logs/
│   ├── bakery.log           ← лог сервера (uvicorn)
│   └── tray_crash.log       ← лог помилок трею
├── tray.py                  ← системний трей (pystray)
├── VERSION                  ← поточна версія (напр. v1.0.0)
├── PREVIOUS_VERSION         ← попередня версія (після оновлення)
├── install.bat
├── install-service.bat
├── uninstall-service.bat
├── start.bat
├── stop.bat
├── start-dev.bat
├── tray.bat
├── update.bat
└── rollback.bat
```

---

## Вкладки застосунку

| Вкладка | URL | Опис |
|---------|-----|------|
| Замовлення | `/orders` | Таблиця клієнти × вироби, введення кількостей |
| Випічка | `/baking` | Завдання пекарям + внесення результату + розподіл надлишків |
| Маршрути | `/routes` | Накладні + переміщення після повернення водія |
| Магазин | `/shop` | Щоденна звірка, несвіжий товар, група ІНШЕ |
| Фінанси | `/finances` | Баланси клієнтів, рух коштів |
| Довідники | `/admin` | Вироби, клієнти, ціни, маршрути, налаштування, права ролей |

---

## API

```
/api/v1/
    /products          GET, POST, PUT, DELETE
    /categories        GET, POST
    /clients           GET, POST, PUT, DELETE
    /routes            GET, POST, PUT
    /prices            GET, POST · /resolve · /overrides
    /orders            GET, POST, PUT, DELETE · /copy
    /baking/tasks      GET, POST (generate), PUT
    /baking/surplus    GET, POST
    /invoices          GET, POST, PUT /status
    /auth              POST /login · GET /public-users · CRUD /users
    /settings          GET, PUT
```

---

## Ролі користувачів

| Роль | Доступ |
|------|--------|
| operator | замовлення, випічка, маршрути, накладні, магазин |
| accountant | фінанси, баланси, перегляд всього |
| admin | довідники, ціни, налаштування, повний доступ |
| owner | read-only дашборд |

Права ролей налаштовуються через вкладку **Довідники → Права ролей**.

---

## Система оновлень

Версія зберігається у файлі `VERSION`. При випуску нової версії:

```bash
# На стороні розробника:
echo "v1.1.0" > VERSION
git add VERSION && git commit -m "feat: ..."
git tag v1.1.0
git push origin master --tags
```

На стороні клієнта: трей автоматично виявляє нову версію (перевірка раз на годину),
показує бейдж на іконці та пропонує встановити через меню.

Після оновлення зберігається `PREVIOUS_VERSION` — для відкату через `rollback.bat`.

---

## Архітектура розгортання

```
Windows Task Scheduler
    └── BakeryApp (AtLogon, автоперезапуск 5×)
            └── scripts/run-server.ps1
                    └── uvicorn backend.main:app --host 0.0.0.0 --port 8000
                            ├── /api/v1/...          (FastAPI роутери)
                            └── /*                   (frontend/dist — React SPA)
tray.py (pythonw, без вікна)
    └── моніторить сервер, керує задачею, оновлення
```

---

## Розробка

```
start-dev.bat
```

Запускає:
- uvicorn з `--reload` на порту 8000
- Vite dev server з HMR на порту 5173

Проксі в `vite.config.ts` перенаправляє `/api` → `http://localhost:8000`.
На мережевому диску увімкнено `usePolling: true` (chokidar).

### Тести

```bash
backend/venv/Scripts/pytest tests/ -v
```

---

## Логи

| Файл | Вміст |
|------|-------|
| `logs/bakery.log` | вивід uvicorn (INFO/ERROR) |
| `logs/tray_crash.log` | помилки запуску трею |

"""
Bakery — system tray application.
Manages the BakeryApp Task Scheduler task and provides quick access via tray icon.
"""
import os
import sys
import time
import shutil
import socket
import sqlite3
import subprocess
import threading
import webbrowser
import traceback
import json
import ctypes
from pathlib import Path
from urllib.request import urlopen

# Bootstrap crash log before other imports, so any failure is visible
_ROOT_BOOT = Path(__file__).parent
_DATA_DIR_BOOT = Path(os.environ.get("BAKERY_DATA_DIR", _ROOT_BOOT))
_CRASH_LOG = _DATA_DIR_BOOT / "logs" / "tray_crash.log"
_CRASH_LOG.parent.mkdir(parents=True, exist_ok=True)

# ── Single-instance guard (lock file) ─────────────────────────────────────────
# Завжди фіксований шлях — незалежно від BAKERY_DATA_DIR
# Якщо шлях різний в різних процесах — захист не спрацьовує
_LOCK_FILE = Path(os.environ.get("PROGRAMDATA", "C:\\ProgramData")) / "Bakery" / "logs" / "tray.lock"
_LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
try:
    _lock_fd = open(_LOCK_FILE, "w")
    import msvcrt
    msvcrt.locking(_lock_fd.fileno(), msvcrt.LK_NBLCK, 1)
except OSError:
    sys.exit(0)  # Another instance holds the lock — exit silently

try:
    import pystray
    from PIL import Image, ImageDraw
except Exception:
    with open(_CRASH_LOG, "a", encoding="utf-8") as _f:
        _f.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] IMPORT ERROR:\n")
        traceback.print_exc(file=_f)
    sys.exit(1)

# ── Constants ─────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent


def _resolve_data_dir() -> Path:
    """Визначає DATA_DIR за пріоритетом:
    1. env BAKERY_DATA_DIR (виставляється run-server.ps1 / run-tray.ps1)
    2. %ProgramData%\\Bakery — стандартний продакшн-шлях інсталятора
    3. Парсинг run-server.ps1 (у DATA_DIR\scripts або ROOT\scripts)
    4. ROOT — dev-середовище (всі файли в одній папці)
    """
    from_env = os.environ.get("BAKERY_DATA_DIR", "")
    if from_env:
        return Path(from_env)

    # Стандартне розташування продакшн-інсталяції
    program_data = Path(os.environ.get("ProgramData", r"C:\ProgramData"))
    std_data = program_data / "Bakery"
    if (std_data / "bakery.db").exists():
        return std_data

    # Парсимо згенерований run-server.ps1 (може бути в DATA або ROOT)
    import re
    for runner in [std_data / "scripts" / "run-server.ps1",
                   ROOT / "scripts" / "run-server.ps1"]:
        if runner.exists():
            try:
                for line in runner.read_text(encoding="utf-8-sig", errors="ignore").splitlines():
                    m = re.match(r"\$env:BAKERY_DATA_DIR\s*=\s*'(.+)'", line.strip())
                    if m:
                        p = Path(m.group(1))
                        if p.exists():
                            return p
            except Exception:
                pass

    return ROOT  # dev: все в одній папці


DATA_DIR   = _resolve_data_dir()
TASK_NAME  = "BakeryApp"
TRAY_TASK  = "BakeryTray"
HEALTH_URL = "http://localhost:8000/api/health"
APP_URL    = "http://localhost:8000"
LOG_FILE   = DATA_DIR / "logs" / "bakery.log"
DB_FILE    = DATA_DIR / "bakery.db"
PYTHON     = ROOT / "backend" / "venv" / "Scripts" / "python.exe"
PYTHONW    = ROOT / "backend" / "venv" / "Scripts" / "pythonw.exe"
GITHUB_REPO     = "https://api.github.com/repos/TSOrest/Bakery"
GITHUB_TAGS_URL = f"{GITHUB_REPO}/tags"

CHECK_INTERVAL    = 5     # server status check, seconds
INTERNET_INTERVAL = 30    # internet connectivity check, seconds
UPDATE_INTERVAL   = 3600  # update check, seconds
BACKUP_INTERVAL   = 60    # scheduled backup check, seconds

# Файли-прапори демо-режиму та відновлення бекапу
DEMO_ACTIVE          = DATA_DIR / "DEMO_ACTIVE"
DEMO_ENTER_REQUESTED = DATA_DIR / "DEMO_ENTER_REQUESTED"
DEMO_EXIT_REQUESTED  = DATA_DIR / "DEMO_EXIT_REQUESTED"
RESTORE_REQUESTED    = DATA_DIR / "RESTORE_REQUESTED"

# ── Icon drawing ───────────────────────────────────────────────────────────────

def _darken(hex_c: str, f: float) -> tuple:
    """Darken a hex colour by factor f. Returns RGBA tuple."""
    r, g, b = int(hex_c[1:3], 16), int(hex_c[3:5], 16), int(hex_c[5:7], 16)
    return (max(0, int(r * f)), max(0, int(g * f)), max(0, int(b * f)), 255)


def _make_icon(color: str, badge: bool = False) -> Image.Image:
    """64×64 tray icon: bread loaf on a coloured status circle.
    color  — hex status colour (#27ae60 green / #e74c3c red / #f39c12 yellow)
    badge  — small orange dot in top-right (update available)"""
    size = 64
    img  = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Status circle background
    draw.ellipse([2, 2, 62, 62], fill=color, outline=_darken(color, 0.65), width=2)

    # Bread loaf silhouette
    BREAD = "#FFF3CC"
    CRUST = "#C68A2A"
    draw.rounded_rectangle([13, 33, 51, 53], radius=5, fill=BREAD, outline=CRUST, width=2)
    draw.ellipse([11, 17, 53, 41],            fill=BREAD, outline=CRUST, width=2)
    draw.arc([18, 20, 46, 38], start=215, end=325, fill=CRUST, width=2)  # score line

    if badge:
        draw.ellipse([44, 0, 64, 20], fill="#e67e22", outline="#7a4000", width=1)

    return img


ICON_GREEN       = _make_icon("#27ae60")
ICON_GREEN_BADGE = _make_icon("#27ae60", badge=True)
ICON_RED         = _make_icon("#e74c3c")
ICON_RED_BADGE   = _make_icon("#e74c3c", badge=True)
ICON_YELLOW      = _make_icon("#f39c12")
ICON_YELLOW_B    = _make_icon("#d4870f")   # darker frame for startup animation


# ── Version helpers ────────────────────────────────────────────────────────────

def _read_version(filename: str = "VERSION") -> str:
    f = ROOT / filename
    return f.read_text(encoding="utf-8-sig").strip() if f.exists() else ""


def _github_headers() -> dict:
    """Заголовки для GitHub API з токеном з БД (потрібен для приватного репо)."""
    headers = {"User-Agent": "BakeryTray/1.0"}
    token = _read_setting("github_oauth_token")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _fetch_latest_tag() -> str:
    """Returns latest tag from GitHub, or '' on error."""
    try:
        req = __import__("urllib.request", fromlist=["Request"]).Request(
            GITHUB_TAGS_URL,
            headers=_github_headers(),
        )
        with urlopen(req, timeout=8) as r:
            tags = json.loads(r.read())
            if tags:
                return tags[0]["name"]
    except Exception:
        pass
    return ""


def _fetch_release_notes(tag: str) -> str:
    """Fetch release body for a specific tag from GitHub Releases API.
    Returns empty string if no release found or on network error."""
    if not tag:
        return ""
    try:
        req = __import__("urllib.request", fromlist=["Request"]).Request(
            f"{GITHUB_REPO}/releases/tags/{tag}",
            headers=_github_headers(),
        )
        with urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
            return data.get("body", "").strip()
    except Exception:
        return ""


def _version_tuple(v: str):
    try:
        return tuple(int(x) for x in v.lstrip("v").split("."))
    except Exception:
        return (0,)


def _is_newer(candidate: str, current: str) -> bool:
    return _version_tuple(candidate) > _version_tuple(current)


# ── DB / uptime helpers ────────────────────────────────────────────────────────

def _format_uptime(since: float) -> str:
    """Format elapsed seconds as 'Xг Yхв' or 'Xхв'."""
    if not since:
        return ""
    s = int(time.time() - since)
    h, rem = divmod(s, 3600)
    m = rem // 60
    return f"{h}г {m:02d}хв" if h else f"{m}хв"


def _db_size() -> str:
    """Return bakery.db size as human-readable string."""
    if not DB_FILE.exists():
        return ""
    sz = DB_FILE.stat().st_size
    return f"{sz / 1_048_576:.1f} MB" if sz >= 1_048_576 else f"{sz // 1024} KB"


def _read_setting(key: str) -> str:
    """Читає налаштування з bakery.db напряму (без FastAPI)."""
    try:
        con = sqlite3.connect(str(DB_FILE))
        row = con.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        con.close()
        return row[0] if row and row[0] else ""
    except Exception:
        return ""


def _backup_dir_path() -> Path:
    """Повертає папку для бекапів (з налаштувань або backups/)."""
    custom = _read_setting("backup_local_dir").strip()
    d = Path(custom) if custom else DATA_DIR / "backups"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _clear_wal(db_path: Path) -> None:
    """
    Видаляє stale WAL/SHM файли після заміни DB-файлу.
    Без цього SQLite намагається застосувати WAL від попередньої БД,
    що призводить до некоректних даних або помилок.
    """
    for ext in ("-wal", "-shm"):
        f = Path(str(db_path) + ext)
        try:
            f.unlink(missing_ok=True)
        except Exception:
            pass


def _backup_db() -> str:
    """
    SQLite online backup → backups/bakery_YYYYMMDD-HHMMSS.db + sidecar .meta.json.
    Також копіює у хмарні папки якщо налаштовані.
    Повертає шлях до бекапу.
    """
    if not DB_FILE.exists():
        return ""
    ver = _read_version() or "unknown"
    ts  = time.strftime("%Y-%m-%d_%H-%M-%S")
    backup_dir = _backup_dir_path()
    dst = backup_dir / f"bakery_{ts}.db"
    meta_dst = backup_dir / f"bakery_{ts}.meta.json"

    # SQLite online backup — безпечно при активних з'єднаннях
    try:
        src_con = sqlite3.connect(str(DB_FILE))
        dst_con = sqlite3.connect(str(dst))
        with dst_con:
            src_con.backup(dst_con)
        dst_con.close()
        src_con.close()
    except Exception:
        # Fallback: звичайна копія (якщо сервер вже зупинений)
        shutil.copy2(DB_FILE, dst)

    # Sidecar метаданих
    import datetime as _dt
    meta = {"app_version": ver, "created_at": _dt.datetime.now().isoformat(timespec="seconds")}
    try:
        meta_dst.write_text(json.dumps(meta), encoding="utf-8")
    except Exception:
        pass

    # Копіювання в хмарні папки
    for key in ("backup_cloud_1_path", "backup_cloud_2_path", "backup_cloud_3_path"):
        cp = _read_setting(key).strip()
        if not cp:
            continue
        try:
            cloud_dir = Path(cp)
            cloud_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dst, cloud_dir / dst.name)
            if meta_dst.exists():
                shutil.copy2(meta_dst, cloud_dir / meta_dst.name)
        except Exception:
            pass

    return str(dst)


def _get_local_tags() -> list:
    """Return all local git tags sorted by version descending."""
    try:
        r = subprocess.run(
            ["git", "-C", str(ROOT), "tag", "-l", "--sort=-version:refname"],
            capture_output=True, text=True, timeout=5,
        )
        return [t.strip() for t in r.stdout.splitlines() if t.strip()]
    except Exception:
        return []


def _pick_rollback_version(tags: list, current: str) -> str:
    """Show PowerShell Out-GridView to select a rollback target version."""
    candidates = [t for t in tags if t != current]
    if not candidates:
        return ""
    tags_ps = ", ".join(f'"{t}"' for t in candidates)
    script = (
        f'$t = @({tags_ps}) | '
        f'Out-GridView -Title "Відкат — поточна: {current}" -OutputMode Single; '
        f'if ($t) {{ Write-Output $t }}'
    )
    try:
        r = subprocess.run(
            ["powershell", "-Command", script],
            capture_output=True, text=True, timeout=120,
        )
        return r.stdout.strip()
    except Exception:
        return ""


# ── State ─────────────────────────────────────────────────────────────────────
_server_up:         bool  = False
_server_start_time: float = 0.0     # time.time() when server last came UP
_starting:          bool  = False   # True while waiting for server to start (drives animation)
_internet_up:       bool  = True    # optimistic default; corrected by _poll_internet after 10 s
_latest_version:    str   = ""      # non-empty = newer version available
_update_lock               = threading.Lock()
_local_tags:        list  = []      # cached at startup; changes only after update/rollback (restarts tray)
_last_backup_date:  str   = ""      # YYYY-MM-DD, захист від подвійного бекапу в один день
_notified_version:  str   = ""      # остання версія про яку вже надіслано balloon (без повторів)


# ── Windows helpers ────────────────────────────────────────────────────────────

def _msgbox(title: str, text: str, flags: int = 0) -> int:
    return ctypes.windll.user32.MessageBoxW(0, text, title, flags)


def _confirm(title: str, text: str) -> bool:
    MB_YESNO = 0x04
    IDYES    = 6
    return _msgbox(title, text, MB_YESNO) == IDYES


# ── Notifications ─────────────────────────────────────────────────────────────

def _notify(_icon, title: str, message: str) -> None:
    """Log to bakery.log and show a PowerShell WinRT toast notification."""
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[NOTIFY] {time.strftime('%H:%M:%S')} {title}: {message}\n")
    except Exception:
        pass
    _notify_ps(title, message)


def _notify_ps(title: str, message: str) -> None:
    """Fire a Windows 10/11 toast via scripts/notify.ps1."""
    script = str(ROOT / "scripts" / "notify.ps1")
    try:
        subprocess.Popen(
            ["powershell", "-WindowStyle", "Hidden",
             "-ExecutionPolicy", "Bypass",
             "-File", script,
             "-Title", title,
             "-Message", message],
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except Exception:
        pass


def _check_internet() -> bool:
    """Return True if internet is reachable (TCP connect to 8.8.8.8:53)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(3)
        s.connect(("8.8.8.8", 53))
        s.close()
        return True
    except Exception:
        return False


# ── Server status ──────────────────────────────────────────────────────────────

def _is_server_up() -> bool:
    try:
        with urlopen(HEALTH_URL, timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def _task_exists() -> bool:
    result = subprocess.run(
        ["powershell", "-Command",
         f"Get-ScheduledTask -TaskName {TASK_NAME} -ErrorAction SilentlyContinue"
         " | Select-Object -ExpandProperty State"],
        capture_output=True, text=True, timeout=5,
    )
    return result.returncode == 0 and result.stdout.strip() != ""


def _run_ps(command: str) -> None:
    subprocess.run(
        ["powershell", "-ExecutionPolicy", "Bypass", "-Command", command],
        capture_output=True, timeout=15,
    )


# ── Startup animation ──────────────────────────────────────────────────────────

def _animate_startup(icon) -> None:
    """Alternate between two yellow icon frames while _starting is True."""
    frames = [ICON_YELLOW, ICON_YELLOW_B]
    i = 0
    while _starting:
        icon.icon = frames[i % 2]
        i += 1
        time.sleep(0.5)


# ── Server actions ─────────────────────────────────────────────────────────────

def _kill_uvicorn() -> None:
    _run_ps(
        "Get-CimInstance Win32_Process | "
        "Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*' } | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )


def action_start(icon, _item=None) -> None:
    global _server_up, _starting
    _starting  = True
    icon.icon  = ICON_YELLOW
    icon.title = "Bakery: запуск..."
    threading.Thread(target=_animate_startup, args=(icon,), daemon=True).start()
    _kill_uvicorn()
    time.sleep(1)
    if _task_exists():
        _run_ps(f"Enable-ScheduledTask -TaskName {TASK_NAME} -ErrorAction SilentlyContinue; "
                f"Start-ScheduledTask -TaskName {TASK_NAME}")
    else:
        subprocess.Popen(
            [str(PYTHON), "-m", "uvicorn", "backend.main:app",
             "--host", "0.0.0.0", "--port", "8000"],
            cwd=str(ROOT),
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    _server_up = False
    _refresh(icon)


def action_stop(icon, _item=None) -> None:
    global _server_up, _server_start_time, _starting
    _starting  = False
    icon.icon  = ICON_YELLOW
    icon.title = "Bakery: зупинка..."
    if _task_exists():
        _run_ps(f"Stop-ScheduledTask -TaskName {TASK_NAME} -ErrorAction SilentlyContinue")
    _kill_uvicorn()
    _server_up         = False
    _server_start_time = 0.0
    _notify(icon, "Bakery", "Сервер зупинено")
    _refresh(icon)


def action_restart(icon, _item=None) -> None:
    action_stop(icon)
    time.sleep(1)
    action_start(icon)


def action_open(icon, _item=None) -> None:
    webbrowser.open(APP_URL)


def action_logs(icon, _item=None) -> None:
    LOG_FILE.parent.mkdir(exist_ok=True)
    LOG_FILE.touch(exist_ok=True)
    size_mb = LOG_FILE.stat().st_size / 1_048_576
    if size_mb >= 10 and _confirm(
        "Bakery — логи",
        f"Файл логів: {size_mb:.1f} MB\n\nОчистити перед відкриттям?",
    ):
        LOG_FILE.write_text("", encoding="utf-8")
    subprocess.Popen(["notepad.exe", str(LOG_FILE)])


def action_exit(icon, _item=None) -> None:
    icon.stop()


# ── Update / rollback actions ──────────────────────────────────────────────────

def action_check_update(icon, _item=None) -> None:
    threading.Thread(target=_do_check_update, args=(icon, True), daemon=True).start()


def _do_check_update(icon, show_if_none: bool = False) -> None:
    global _latest_version, _notified_version
    current = _read_version()

    if not _internet_up:
        return

    latest = _fetch_latest_tag()

    with _update_lock:
        _latest_version = latest if _is_newer(latest, current) else ""

    _refresh(icon)

    if _latest_version:
        if show_if_none:
            notes = _fetch_release_notes(latest)
            notes_block = f"\n\nЩо нового:\n{notes}" if notes else ""
            _msgbox(
                "Bakery — оновлення",
                f"Доступна нова версія: {latest}\nПоточна версія: {current}"
                f"{notes_block}\n\n"
                f"Натисніть 'Встановити оновлення' у меню треї.",
                0,
            )
        elif _notified_version != latest:
            # balloon лише якщо ще не сповіщали про цю версію
            _notified_version = latest
            _notify(icon, "Bakery — оновлення",
                    f"Доступна нова версія {latest}. Відкрийте меню треї.")
    elif show_if_none:
        _msgbox("Bakery — оновлення", f"Встановлена остання версія: {current}", 0)


def action_install_update(icon, _item=None) -> None:
    current = _read_version()
    latest  = _latest_version or _fetch_latest_tag()
    if not latest:
        _msgbox("Bakery", "Не вдалося отримати інформацію про версію.", 0)
        return

    notes = _fetch_release_notes(latest)
    notes_block = f"\n\nЩо нового:\n{notes}" if notes else ""

    if not _confirm(
        "Bakery — оновлення",
        f"Встановити оновлення {current} -> {latest}?"
        f"{notes_block}\n\n"
        f"Сервер буде тимчасово зупинено.\n"
        f"Резервна копія бази даних буде збережена автоматично.",
    ):
        return

    _backup_db()
    _notify(icon, "Bakery — оновлення",
            f"Встановлення {current} -> {latest}. Сервер буде перезапущено...")

    script = str(ROOT / "scripts" / "update.ps1")
    subprocess.Popen(
        ["powershell", "-ExecutionPolicy", "Bypass",
         "-File", script, "-TargetTag", latest],
        creationflags=subprocess.CREATE_NEW_CONSOLE,
        cwd=str(ROOT),
    )
    icon.stop()


def action_rollback(icon, _item=None) -> None:
    current = _read_version()
    target  = _pick_rollback_version(_local_tags, current)
    if not target:
        return  # user cancelled or closed the picker

    notes = _fetch_release_notes(current)
    notes_block = f"\n\nБуде втрачено ({current}):\n{notes}" if notes else ""

    if not _confirm(
        "Bakery — відкат",
        f"Відкотити {current} -> {target}?"
        f"{notes_block}\n\n"
        f"Буде створено резервну копію bakery.db.\n"
        f"Після відкату перевірте коректність роботи —\n"
        f"схема бази може не відповідати старому коду.",
    ):
        return

    _backup_db()
    _notify(icon, "Bakery — відкат",
            f"Відкат {current} -> {target}. Сервер буде перезапущено...")

    script = str(ROOT / "scripts" / "rollback.ps1")
    subprocess.Popen(
        ["powershell", "-ExecutionPolicy", "Bypass",
         "-File", script, "-TargetTag", target],
        creationflags=subprocess.CREATE_NEW_CONSOLE,
        cwd=str(ROOT),
    )
    icon.stop()


# ── Demo mode actions ──────────────────────────────────────────────────────────

def _action_demo_enter(icon) -> None:
    """Активує демо режим: backup → swap demo.db → restart."""
    demo_db = DATA_DIR / "demo.db"
    if not demo_db.exists():
        _msgbox("Bakery — демо", "demo.db не знайдено.\nСпочатку згенеруйте демо базу через AdminPage.", 0)
        return
    if not _confirm("Bakery — демо режим",
                    "Увійти в демо режим?\n\n"
                    "Поточна база буде збережена у бекап.\n"
                    "Для виходу скористайтесь меню трею або AdminPage."):
        return
    _notify(icon, "Bakery — демо", "Входимо в демо режим...")
    backup_path = _backup_db()
    action_stop(icon)
    time.sleep(2)
    try:
        shutil.copy2(demo_db, DB_FILE)
        _clear_wal(DB_FILE)
        import datetime as _dt
        DEMO_ACTIVE.write_text(
            json.dumps({"backup_path": backup_path,
                        "since": _dt.datetime.now().isoformat(timespec="seconds")}),
            encoding="utf-8",
        )
    except Exception as e:
        _msgbox("Bakery — помилка", f"Не вдалося ввійти в демо режим:\n{e}", 0)
        return
    action_start(icon)
    _refresh(icon)
    _notify(icon, "Bakery — демо", "Демо режим активний ⚡")


def _action_demo_exit(icon) -> None:
    """Виходить з демо режиму: відновлює pre-demo бекап → restart."""
    if not DEMO_ACTIVE.exists():
        return
    try:
        data = json.loads(DEMO_ACTIVE.read_text(encoding="utf-8"))
        backup_path = data.get("backup_path", "")
    except Exception:
        backup_path = ""

    if not backup_path or not Path(backup_path).exists():
        _msgbox("Bakery — демо", "Pre-demo бекап не знайдено.\nВідновіть базу вручну.", 0)
        return

    if not _confirm("Bakery — вийти з демо",
                    "Вийти з демо режиму?\n\nБуде відновлена робоча база даних."):
        return

    _notify(icon, "Bakery — демо", "Виходимо з демо режиму...")
    action_stop(icon)
    time.sleep(2)
    try:
        shutil.copy2(backup_path, DB_FILE)
        _clear_wal(DB_FILE)
        DEMO_ACTIVE.unlink(missing_ok=True)
    except Exception as e:
        _msgbox("Bakery — помилка", f"Не вдалося відновити базу:\n{e}", 0)
        return
    action_start(icon)
    _refresh(icon)
    _notify(icon, "Bakery — демо", "Демо режим завершено ✓")


def _action_restore_backup(icon, backup_path: str, rollback_first: bool,
                            backup_version: str) -> None:
    """Відновлює бекап: (опційно відкат версії) → stop → swap → start."""
    if not Path(backup_path).exists():
        _msgbox("Bakery — відновлення", f"Файл бекапу не знайдено:\n{backup_path}", 0)
        return
    _notify(icon, "Bakery — відновлення", "Відновлення бекапу...")
    if rollback_first and backup_version:
        target_tag = f"v{backup_version.lstrip('v')}"
        script = str(ROOT / "scripts" / "rollback.ps1")
        subprocess.Popen(
            ["powershell", "-ExecutionPolicy", "Bypass",
             "-File", script, "-TargetTag", target_tag],
            creationflags=subprocess.CREATE_NEW_CONSOLE,
            cwd=str(ROOT),
        )
        icon.stop()
        return
    action_stop(icon)
    time.sleep(2)
    try:
        # Використовуємо SQLite backup API замість raw copy:
        # правильно checkpoint-ує WAL і не зберігає stale WAL від попередньої БД.
        import sqlite3 as _sqlite3
        _clear_wal(DB_FILE)
        src_con = _sqlite3.connect(str(backup_path))
        dst_con = _sqlite3.connect(str(DB_FILE))
        src_con.backup(dst_con)
        dst_con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        dst_con.close()
        src_con.close()
        _clear_wal(DB_FILE)
    except Exception as e:
        _msgbox("Bakery — помилка", f"Не вдалося відновити базу:\n{e}", 0)
        return
    action_start(icon)
    _notify(icon, "Bakery — відновлення", "Бекап відновлено ✓")


# ── Menu / icon builders ───────────────────────────────────────────────────────

def _build_menu(up: bool) -> pystray.Menu:
    current = _read_version()
    has_upd = bool(_latest_version)
    has_rb  = any(t != current for t in _local_tags)

    update_label  = (
        f"Встановити оновлення ({_latest_version})" if has_upd
        else "Перевірити оновлення"
    )
    update_action = (
        (lambda i, _: threading.Thread(target=action_install_update, args=(i,), daemon=True).start())
        if has_upd else action_check_update
    )

    open_submenu = pystray.Menu(
        pystray.MenuItem("Замовлення", lambda i, _: webbrowser.open(APP_URL + "/orders")),
        pystray.MenuItem("Випічка",    lambda i, _: webbrowser.open(APP_URL + "/baking")),
        pystray.MenuItem("Маршрути",   lambda i, _: webbrowser.open(APP_URL + "/routes")),
        pystray.MenuItem("Магазин",    lambda i, _: webbrowser.open(APP_URL + "/shop")),
        pystray.MenuItem("Фінанси",    lambda i, _: webbrowser.open(APP_URL + "/finances")),
        pystray.MenuItem("Довідники",  lambda i, _: webbrowser.open(APP_URL + "/admin")),
    )

    in_demo = DEMO_ACTIVE.exists()

    items = [
        pystray.MenuItem("Відкрити застосунок", action_open, default=True),
        pystray.MenuItem("Відкрити розділ",     open_submenu),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Запустити сервер",     action_start,   enabled=not up),
        pystray.MenuItem("Перезапустити сервер", action_restart, enabled=up),
        pystray.MenuItem("Зупинити сервер",      action_stop,    enabled=up),
        pystray.Menu.SEPARATOR,
    ]

    if in_demo:
        items.append(pystray.MenuItem("⚡ Вийти з демо режиму",
                                      lambda i, _: threading.Thread(target=_action_demo_exit, args=(i,), daemon=True).start()))
    else:
        items.append(pystray.MenuItem("▶ Увійти в демо режим",
                                      lambda i, _: threading.Thread(target=_action_demo_enter, args=(i,), daemon=True).start()))

    items += [
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(update_label, update_action),
    ]

    if has_rb:
        items.append(pystray.MenuItem("Відкатити версію...",
                                      lambda i, _: threading.Thread(target=action_rollback, args=(i,), daemon=True).start()))

    items += [
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Переглянути логи",
                         lambda i, _: threading.Thread(target=action_logs, args=(i,), daemon=True).start()),
        pystray.MenuItem(f"Версія: {current}" if current
                         else "Версія: невідома", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Вийти", action_exit),
    ]

    return pystray.Menu(*items)


def _pick_icon(up: bool) -> Image.Image:
    if DEMO_ACTIVE.exists():
        return ICON_YELLOW
    if up:
        return ICON_GREEN_BADGE if _latest_version else ICON_GREEN
    return ICON_RED_BADGE if _latest_version else ICON_RED


def _build_title(up: bool) -> str:
    ver  = _read_version()
    base = f"Bakery {ver}" if ver else "Bakery"
    if DEMO_ACTIVE.exists():
        return f"{base} | ⚡ ДЕМО РЕЖИМ"
    if up:
        parts = [base, "працює"]
        ut = _format_uptime(_server_start_time)
        if ut:
            parts.append(ut)
        ds = _db_size()
        if ds:
            parts.append(f"БД {ds}")
    else:
        parts = [base, "зупинено"]
    if _latest_version:
        parts.append(f"оновлення {_latest_version}")
    return " | ".join(parts)


def _refresh(icon) -> None:
    up = _is_server_up()
    icon.icon  = _pick_icon(up)
    icon.title = _build_title(up)
    icon.menu  = _build_menu(up)


# ── Background threads ────────────────────────────────────────────────────────

def _poll_status(icon) -> None:
    global _server_up, _server_start_time, _starting
    while True:
        up = _is_server_up()
        if up != _server_up:
            _server_up = up
            _starting  = False  # stop startup animation on any state change
            if up:
                _server_start_time = time.time()
                _notify(icon, "Bakery", "Сервер запущено ✓")
            else:
                _server_start_time = 0.0
                _notify(icon, "Bakery — увага", "Сервер недоступний!")
            icon.icon  = _pick_icon(up)
            icon.title = _build_title(up)
            icon.menu  = _build_menu(up)
        time.sleep(CHECK_INTERVAL)


def _poll_internet(icon) -> None:
    """Monitor internet connectivity; notify on state change."""
    global _internet_up
    time.sleep(10)  # brief startup delay before first check
    while True:
        up = _check_internet()
        try:
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(
                    f"[INTERNET] {time.strftime('%H:%M:%S')} "
                    f"{'up' if up else 'DOWN'} "
                    f"(prev={'up' if _internet_up else 'DOWN'})\n"
                )
        except Exception:
            pass
        if up != _internet_up:
            _internet_up = up
            if not up:
                _notify(icon, "Bakery — увага",
                        "Немає інтернету. Telegram бот та перевірка оновлень недоступні.")
            else:
                _notify(icon, "Bakery",
                        "Інтернет відновлено. Telegram бот та оновлення знову доступні.")
        time.sleep(30)


def _poll_updates(icon) -> None:
    """Check for updates once at startup (after 60 s delay) then every hour."""
    time.sleep(60)
    while True:
        if _internet_up:
            _do_check_update(icon, show_if_none=False)
        time.sleep(UPDATE_INTERVAL)


def _poll_flags(icon) -> None:
    """Швидкий цикл (2 сек) — обробка прапорів від frontend: restore, demo."""
    while True:
        try:
            if DEMO_ENTER_REQUESTED.exists():
                DEMO_ENTER_REQUESTED.unlink(missing_ok=True)
                threading.Thread(target=_action_demo_enter, args=(icon,), daemon=True).start()

            elif DEMO_EXIT_REQUESTED.exists():
                DEMO_EXIT_REQUESTED.unlink(missing_ok=True)
                threading.Thread(target=_action_demo_exit, args=(icon,), daemon=True).start()

            elif RESTORE_REQUESTED.exists():
                try:
                    req = json.loads(RESTORE_REQUESTED.read_text(encoding="utf-8"))
                    RESTORE_REQUESTED.unlink(missing_ok=True)
                    threading.Thread(
                        target=_action_restore_backup,
                        args=(icon,
                              req.get("backup_path", ""),
                              req.get("rollback_first", False),
                              req.get("backup_version", "")),
                        daemon=True,
                    ).start()
                except Exception:
                    RESTORE_REQUESTED.unlink(missing_ok=True)
        except Exception:
            pass
        time.sleep(2)


def _poll_backup(icon) -> None:
    """Щоденний автобекап за налаштованим часом."""
    global _last_backup_date
    time.sleep(90)  # початкова затримка після старту
    while True:
        try:
            # ── Розклад автобекапу ──────────────────────────────────────────
            if _read_setting("backup_enabled") == "1":
                btime = (_read_setting("backup_time") or "02:00").strip()
                now   = time.localtime()
                t_now = f"{now.tm_hour:02d}:{now.tm_min:02d}"
                today = time.strftime("%Y-%m-%d")
                if t_now == btime and _last_backup_date != today:
                    _last_backup_date = today
                    try:
                        result = _backup_db()
                        if result:
                            # Ротація
                            keep = int(_read_setting("backup_keep_count") or "7")
                            backup_dir = _backup_dir_path()
                            files = sorted(backup_dir.glob("bakery_*.db"), reverse=True)
                            for old in files[keep:]:
                                try:
                                    old.unlink()
                                    meta = old.with_suffix(".meta.json")
                                    if meta.exists():
                                        meta.unlink()
                                except Exception:
                                    pass
                            _notify(icon, "Bakery — бекап", f"Автобекап виконано ✓  {today}")
                    except Exception as e:
                        _notify(icon, "Bakery — бекап", f"Помилка автобекапу: {e}")

        except Exception:
            pass

        time.sleep(BACKUP_INTERVAL)


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    global _server_up, _server_start_time, _local_tags
    up = _is_server_up()
    _server_up         = up
    _server_start_time = time.time() if up else 0.0
    _local_tags        = _get_local_tags()

    icon = pystray.Icon(
        name="Bakery",
        icon=_pick_icon(up),
        title=_build_title(up),
        menu=_build_menu(up),
    )

    threading.Thread(target=_poll_status,   args=(icon,), daemon=True).start()
    threading.Thread(target=_poll_internet, args=(icon,), daemon=True).start()
    threading.Thread(target=_poll_updates,  args=(icon,), daemon=True).start()
    threading.Thread(target=_poll_flags,    args=(icon,), daemon=True).start()
    threading.Thread(target=_poll_backup,   args=(icon,), daemon=True).start()

    def _startup_notify():
        time.sleep(3)
        if _server_up:
            _notify(icon, "Bakery", "Сервер працює ✓")
        else:
            _notify(icon, "Bakery — увага", "Сервер зупинено!")
    threading.Thread(target=_startup_notify, daemon=True).start()

    icon.run()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log_path = DATA_DIR / "logs" / "tray_crash.log"
        log_path.parent.mkdir(exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] CRASH:\n")
            traceback.print_exc(file=f)
        raise

"""
Bakery — system tray application.
Manages the BakeryApp Task Scheduler task and provides quick access via tray icon.
"""
import sys
import time
import shutil
import socket
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
_CRASH_LOG = _ROOT_BOOT / "logs" / "tray_crash.log"
_CRASH_LOG.parent.mkdir(exist_ok=True)

# ── Single-instance guard (lock file) ─────────────────────────────────────────
_LOCK_FILE = _ROOT_BOOT / "logs" / "tray.lock"
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
ROOT       = Path(__file__).parent
TASK_NAME  = "BakeryApp"
TRAY_TASK  = "BakeryTray"
HEALTH_URL = "http://localhost:8000/api/health"
APP_URL    = "http://localhost:8000"
LOG_FILE   = ROOT / "logs" / "bakery.log"
DB_FILE    = ROOT / "bakery.db"
PYTHON     = ROOT / "backend" / "venv" / "Scripts" / "python.exe"
PYTHONW    = ROOT / "backend" / "venv" / "Scripts" / "pythonw.exe"
GITHUB_TAGS_URL = "https://api.github.com/repos/TSOrest/Bakery/tags"

CHECK_INTERVAL    = 5     # server status check, seconds
INTERNET_INTERVAL = 30    # internet connectivity check, seconds
UPDATE_INTERVAL   = 3600  # update check, seconds

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
    return f.read_text(encoding="utf-8").strip() if f.exists() else ""


def _fetch_latest_tag() -> str:
    """Returns latest tag from GitHub, or '' on error."""
    try:
        req = __import__("urllib.request", fromlist=["Request"]).Request(
            GITHUB_TAGS_URL,
            headers={"User-Agent": "BakeryTray/1.0"},
        )
        with urlopen(req, timeout=8) as r:
            tags = json.loads(r.read())
            if tags:
                return tags[0]["name"]
    except Exception:
        pass
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


def _backup_db() -> str:
    """Copy bakery.db → bakery.db.bak-VERSION-TIMESTAMP. Returns backup path."""
    if not DB_FILE.exists():
        return ""
    ver = _read_version().lstrip("v") or "unknown"
    ts  = time.strftime("%Y%m%d-%H%M%S")
    dst = ROOT / f"bakery.db.bak-{ver}-{ts}"
    shutil.copy2(DB_FILE, dst)
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
        _run_ps(f"Start-ScheduledTask -TaskName {TASK_NAME}")
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
    global _latest_version
    current = _read_version()

    if not _internet_up:
        return

    latest = _fetch_latest_tag()

    with _update_lock:
        _latest_version = latest if _is_newer(latest, current) else ""

    _refresh(icon)

    if _latest_version:
        if show_if_none:
            _msgbox(
                "Bakery — оновлення",
                f"Доступна нова версія: {latest}\nПоточна версія: {current}\n\n"
                f"Натисніть 'Встановити оновлення' у меню треї.",
                0,
            )
        else:
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

    if not _confirm(
        "Bakery — оновлення",
        f"Встановити оновлення {current} -> {latest}?\n\n"
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

    if not _confirm(
        "Bakery — відкат",
        f"Відкотити {current} -> {target}?\n\n"
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


# ── Menu / icon builders ───────────────────────────────────────────────────────

def _build_menu(up: bool) -> pystray.Menu:
    current = _read_version()
    has_upd = bool(_latest_version)
    has_rb  = any(t != current for t in _local_tags)

    update_label  = (
        f"Встановити оновлення ({_latest_version})" if has_upd
        else "Перевірити оновлення"
    )
    update_action = action_install_update if has_upd else action_check_update

    open_submenu = pystray.Menu(
        pystray.MenuItem("Замовлення", lambda i, _: webbrowser.open(APP_URL + "/orders")),
        pystray.MenuItem("Випічка",    lambda i, _: webbrowser.open(APP_URL + "/baking")),
        pystray.MenuItem("Маршрути",   lambda i, _: webbrowser.open(APP_URL + "/routes")),
        pystray.MenuItem("Магазин",    lambda i, _: webbrowser.open(APP_URL + "/shop")),
        pystray.MenuItem("Фінанси",    lambda i, _: webbrowser.open(APP_URL + "/finances")),
        pystray.MenuItem("Довідники",  lambda i, _: webbrowser.open(APP_URL + "/admin")),
    )

    items = [
        pystray.MenuItem("Відкрити застосунок", action_open, default=True),
        pystray.MenuItem("Відкрити розділ",     open_submenu),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Запустити сервер",     action_start,   enabled=not up),
        pystray.MenuItem("Перезапустити сервер", action_restart, enabled=up),
        pystray.MenuItem("Зупинити сервер",      action_stop,    enabled=up),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(update_label, update_action),
    ]

    if has_rb:
        items.append(pystray.MenuItem("Відкатити версію...", action_rollback))

    items += [
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Переглянути логи",                action_logs),
        pystray.MenuItem(f"Версія: {current}" if current
                         else "Версія: невідома", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Вийти", action_exit),
    ]

    return pystray.Menu(*items)


def _pick_icon(up: bool) -> Image.Image:
    if up:
        return ICON_GREEN_BADGE if _latest_version else ICON_GREEN
    return ICON_RED_BADGE if _latest_version else ICON_RED


def _build_title(up: bool) -> str:
    ver  = _read_version()
    base = f"Bakery {ver}" if ver else "Bakery"
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
        log_path = ROOT / "logs" / "tray_crash.log"
        log_path.parent.mkdir(exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] CRASH:\n")
            traceback.print_exc(file=f)
        raise

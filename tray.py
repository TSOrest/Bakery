"""
Bakery — system tray application.
Manages the BakeryApp Task Scheduler task and provides quick access via tray icon.
"""
import sys
import time
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
    from PIL import Image, ImageDraw, ImageFont
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
PYTHON     = ROOT / "backend" / "venv" / "Scripts" / "python.exe"
PYTHONW    = ROOT / "backend" / "venv" / "Scripts" / "pythonw.exe"
GITHUB_TAGS_URL = "https://api.github.com/repos/TSOrest/Bakery/tags"

CHECK_INTERVAL  = 5    # server status check, seconds
UPDATE_INTERVAL = 3600 # update check, seconds
NO_INTERNET_NOTIFY_INTERVAL = 1800  # notify about no internet at most every 30 min

# ── Icon drawing ───────────────────────────────────────────────────────────────

def _make_icon(color: str, badge: bool = False) -> Image.Image:
    """Draw a 64x64 icon: colored circle with letter B. Optional orange badge for updates."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = 4
    draw.ellipse(
        [margin, margin, size - margin, size - margin],
        fill=color, outline="#333333", width=2,
    )

    try:
        font = ImageFont.truetype("arial.ttf", 30)
    except Exception:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), "B", font=font)
    tx = (size - (bbox[2] - bbox[0])) // 2 - bbox[0]
    ty = (size - (bbox[3] - bbox[1])) // 2 - bbox[1]
    draw.text((tx, ty), "B", fill="white", font=font)

    if badge:
        # Small orange circle in top-right corner
        r = 10
        draw.ellipse([size - r*2, 0, size, r*2], fill="#e67e22", outline="#333", width=1)

    return img


ICON_GREEN        = _make_icon("#27ae60")
ICON_GREEN_BADGE  = _make_icon("#27ae60", badge=True)
ICON_RED          = _make_icon("#e74c3c")
ICON_RED_BADGE    = _make_icon("#e74c3c", badge=True)
ICON_YELLOW       = _make_icon("#f39c12")


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
    """Parse 'v1.2.3' -> (1, 2, 3) for comparison."""
    try:
        return tuple(int(x) for x in v.lstrip("v").split("."))
    except Exception:
        return (0,)


def _is_newer(candidate: str, current: str) -> bool:
    return _version_tuple(candidate) > _version_tuple(current)


def _has_rollback() -> bool:
    return (ROOT / "PREVIOUS_VERSION").exists()


# ── State ─────────────────────────────────────────────────────────────────────
_server_up               = False
_latest_version          = ""     # "" = not checked yet / no update
_update_lock             = threading.Lock()
_no_internet_notified_at = 0.0   # timestamp of last "no internet" notification


# ── Windows helpers ────────────────────────────────────────────────────────────

def _msgbox(title: str, text: str, flags: int = 0) -> int:
    """Show a Windows MessageBox. Returns button ID."""
    return ctypes.windll.user32.MessageBoxW(0, text, title, flags)


def _confirm(title: str, text: str) -> bool:
    """Yes/No dialog. Returns True if user clicked Yes."""
    MB_YESNO = 0x04
    IDYES    = 6
    return _msgbox(title, text, MB_YESNO) == IDYES


# ── Notifications ─────────────────────────────────────────────────────────────

def _notify(icon, title: str, message: str) -> None:
    """Show a system tray balloon notification (non-blocking)."""
    try:
        icon.notify(message, title)
    except Exception:
        pass


def _check_internet() -> bool:
    """Return True if internet is reachable (DNS to 8.8.8.8)."""
    try:
        socket.setdefaulttimeout(3)
        socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect(("8.8.8.8", 53))
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


# ── Server actions ─────────────────────────────────────────────────────────────

def _kill_uvicorn() -> None:
    _run_ps(
        "Get-CimInstance Win32_Process | "
        "Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*' } | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )


def action_start(icon, _item=None) -> None:
    global _server_up
    icon.icon = ICON_YELLOW
    icon.title = "Bakery: запуск..."
    # Kill any orphaned uvicorn processes first to prevent port 8000 conflict
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
    # Reset so _poll_status will detect the UP transition and notify
    _server_up = False
    _refresh(icon)


def action_stop(icon, _item=None) -> None:
    global _server_up
    icon.icon = ICON_YELLOW
    icon.title = "Bakery: зупинка..."
    if _task_exists():
        _run_ps(f"Stop-ScheduledTask -TaskName {TASK_NAME} -ErrorAction SilentlyContinue")
    _kill_uvicorn()
    # Notify immediately (don't wait for poll) and reset so poll won't fire duplicate
    _server_up = False
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
    subprocess.Popen(["notepad.exe", str(LOG_FILE)])


def action_exit(icon, _item=None) -> None:
    icon.stop()


# ── Update actions ─────────────────────────────────────────────────────────────

def action_check_update(icon, _item=None) -> None:
    """Manually check for updates and show result."""
    threading.Thread(target=_do_check_update, args=(icon, True), daemon=True).start()


def _do_check_update(icon, show_if_none: bool = False) -> None:
    global _latest_version, _no_internet_notified_at
    current = _read_version()

    if not _check_internet():
        now = time.time()
        if now - _no_internet_notified_at > NO_INTERNET_NOTIFY_INTERVAL:
            _no_internet_notified_at = now
            _notify(icon, "Bakery — увага",
                    "Немає інтернету. Перевірка оновлень недоступна.")
        return

    latest = _fetch_latest_tag()

    with _update_lock:
        _latest_version = latest if _is_newer(latest, current) else ""

    _refresh(icon)

    if _latest_version:
        if show_if_none:
            # Ручна перевірка — показати діалог із деталями
            _msgbox(
                "Bakery — оновлення",
                f"Доступна нова версія: {latest}\nПоточна версія: {current}\n\n"
                f"Натисніть 'Встановити оновлення' у меню треї.",
                0,
            )
        else:
            # Фонова перевірка — ненав'язливе balloon-сповіщення
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
        f"Сервер буде тимчасово зупинено.",
    ):
        return

    _notify(icon, "Bakery — оновлення",
            f"Встановлення {current} → {latest}. Сервер буде перезапущено...")

    script = str(ROOT / "scripts" / "update.ps1")
    subprocess.Popen(
        ["powershell", "-ExecutionPolicy", "Bypass",
         "-File", script, "-TargetTag", latest],
        creationflags=subprocess.CREATE_NEW_CONSOLE,
        cwd=str(ROOT),
    )
    # Exit — update.ps1 will relaunch the tray after completion
    icon.stop()


def action_rollback(icon, _item=None) -> None:
    prev = _read_version("PREVIOUS_VERSION")
    if not prev:
        _msgbox("Bakery", "Немає попередньої версії для відкату.", 0)
        return

    current = _read_version()
    if not _confirm(
        "Bakery — відкат",
        f"Відкотити {current} -> {prev}?\n\nСервер буде тимчасово зупинено.",
    ):
        return

    script = str(ROOT / "scripts" / "rollback.ps1")
    subprocess.Popen(
        ["powershell", "-ExecutionPolicy", "Bypass", "-File", script],
        creationflags=subprocess.CREATE_NEW_CONSOLE,
        cwd=str(ROOT),
    )
    icon.stop()


# ── Menu builder ──────────────────────────────────────────────────────────────

def _build_menu(up: bool) -> pystray.Menu:
    current = _read_version()
    has_upd = bool(_latest_version)
    has_rb  = _has_rollback()

    update_label = (
        f"Встановити оновлення ({_latest_version})" if has_upd
        else "Перевірити оновлення"
    )
    update_action = action_install_update if has_upd else action_check_update

    version_label = f"Версія: {current}" if current else "Версія: невідома"

    items = [
        pystray.MenuItem("Відкрити застосунок", action_open, default=True),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Запустити сервер",    action_start,   enabled=not up),
        pystray.MenuItem("Перезапустити сервер", action_restart, enabled=up),
        pystray.MenuItem("Зупинити сервер",     action_stop,    enabled=up),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(update_label, update_action),
    ]

    if has_rb:
        prev = _read_version("PREVIOUS_VERSION")
        items.append(
            pystray.MenuItem(f"Відкотити до {prev}", action_rollback)
        )

    items += [
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Переглянути логи", action_logs),
        pystray.MenuItem(version_label, None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Вийти", action_exit),
    ]

    return pystray.Menu(*items)


def _pick_icon(up: bool) -> Image.Image:
    if up:
        return ICON_GREEN_BADGE if _latest_version else ICON_GREEN
    return ICON_RED_BADGE if _latest_version else ICON_RED


def _build_title(up: bool) -> str:
    base = "Bakery: працює" if up else "Bakery: зупинено"
    if _latest_version:
        base += f" | оновлення {_latest_version}"
    return base


def _refresh(icon) -> None:
    up = _is_server_up()
    icon.icon  = _pick_icon(up)
    icon.title = _build_title(up)
    icon.menu  = _build_menu(up)


# ── Background threads ────────────────────────────────────────────────────────

def _poll_status(icon) -> None:
    global _server_up
    while True:
        up = _is_server_up()
        if up != _server_up:
            _server_up = up
            icon.icon  = _pick_icon(up)
            icon.title = _build_title(up)
            icon.menu  = _build_menu(up)
            if up:
                _notify(icon, "Bakery", "Сервер запущено ✓")
            else:
                _notify(icon, "Bakery — увага", "Сервер недоступний!")
        time.sleep(CHECK_INTERVAL)


def _poll_updates(icon) -> None:
    """Check for updates once at startup (after 30s delay) then every hour."""
    time.sleep(30)
    while True:
        _do_check_update(icon, show_if_none=False)
        time.sleep(UPDATE_INTERVAL)


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    global _server_up
    up = _is_server_up()
    _server_up = up

    icon = pystray.Icon(
        name="Bakery",
        icon=_pick_icon(up),
        title=_build_title(up),
        menu=_build_menu(up),
    )

    threading.Thread(target=_poll_status,  args=(icon,), daemon=True).start()
    threading.Thread(target=_poll_updates, args=(icon,), daemon=True).start()

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

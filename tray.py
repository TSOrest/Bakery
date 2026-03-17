"""
Bakery — system tray application.
Manages the BakeryApp Task Scheduler task and provides quick access via tray icon.
"""
import os
import sys
import time
import subprocess
import threading
import webbrowser
import traceback
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError

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
ROOT = Path(__file__).parent
TASK_NAME = "BakeryApp"
HEALTH_URL = "http://localhost:8000/api/health"
APP_URL = "http://localhost:8000"
LOG_FILE = ROOT / "logs" / "bakery.log"
PYTHON = ROOT / "backend" / "venv" / "Scripts" / "python.exe"
CHECK_INTERVAL = 5  # seconds

# ── Icon drawing ───────────────────────────────────────────────────────────────

def _make_icon(color: str) -> Image.Image:
    """Draw a 64x64 icon: colored circle with letter B."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Outer circle
    margin = 4
    draw.ellipse(
        [margin, margin, size - margin, size - margin],
        fill=color,
        outline="#333333",
        width=2,
    )

    # Letter B — centered
    try:
        font = ImageFont.truetype("arial.ttf", 30)
    except Exception:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), "B", font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) // 2 - bbox[0]
    ty = (size - th) // 2 - bbox[1]
    draw.text((tx, ty), "B", fill="white", font=font)

    return img


ICON_GREEN  = _make_icon("#27ae60")
ICON_RED    = _make_icon("#e74c3c")
ICON_YELLOW = _make_icon("#f39c12")


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
         f"Get-ScheduledTask -TaskName {TASK_NAME} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty State"],
        capture_output=True, text=True, timeout=5
    )
    return result.returncode == 0 and result.stdout.strip() != ""


def _run_ps(command: str) -> None:
    subprocess.run(
        ["powershell", "-ExecutionPolicy", "Bypass", "-Command", command],
        capture_output=True, timeout=15
    )


# ── Server actions ─────────────────────────────────────────────────────────────

def _kill_uvicorn() -> None:
    _run_ps(
        "Get-CimInstance Win32_Process | "
        "Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*' } | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )


def action_start(icon, item=None) -> None:
    icon.icon = ICON_YELLOW
    icon.title = "Bakery: запуск..."
    if _task_exists():
        _run_ps(f"Start-ScheduledTask -TaskName {TASK_NAME}")
    else:
        subprocess.Popen(
            [str(PYTHON), "-m", "uvicorn", "backend.main:app",
             "--host", "0.0.0.0", "--port", "8000"],
            cwd=str(ROOT),
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    _rebuild_menu(icon)


def action_stop(icon, item=None) -> None:
    icon.icon = ICON_YELLOW
    icon.title = "Bakery: зупинка..."
    if _task_exists():
        _run_ps(f"Stop-ScheduledTask -TaskName {TASK_NAME} -ErrorAction SilentlyContinue")
    _kill_uvicorn()
    _rebuild_menu(icon)


def action_restart(icon, item=None) -> None:
    action_stop(icon)
    time.sleep(1)
    action_start(icon)


def action_open(icon, item=None) -> None:
    webbrowser.open(APP_URL)


def action_logs(icon, item=None) -> None:
    LOG_FILE.parent.mkdir(exist_ok=True)
    LOG_FILE.touch(exist_ok=True)
    subprocess.Popen(["notepad.exe", str(LOG_FILE)])


def action_exit(icon, item=None) -> None:
    icon.stop()


# ── Dynamic menu (Start vs Stop depending on status) ──────────────────────────

_server_up = False


def _rebuild_menu(icon) -> None:
    up = _is_server_up()
    icon.menu = _build_menu(up)
    icon.icon = ICON_GREEN if up else ICON_RED
    icon.title = "Bakery: працює" if up else "Bakery: зупинено"


def _build_menu(up: bool) -> pystray.Menu:
    return pystray.Menu(
        pystray.MenuItem("Відкрити застосунок", action_open, default=True),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(
            "Запустити сервер",
            action_start,
            enabled=not up,
        ),
        pystray.MenuItem(
            "Перезапустити сервер",
            action_restart,
            enabled=up,
        ),
        pystray.MenuItem(
            "Зупинити сервер",
            action_stop,
            enabled=up,
        ),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Переглянути логи", action_logs),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Вийти", action_exit),
    )


# ── Background status polling ──────────────────────────────────────────────────

def _poll_status(icon: pystray.Icon) -> None:
    global _server_up
    while True:
        up = _is_server_up()
        if up != _server_up:
            _server_up = up
            icon.icon = ICON_GREEN if up else ICON_RED
            icon.title = "Bakery: працює" if up else "Bakery: зупинено"
            icon.menu = _build_menu(up)
        time.sleep(CHECK_INTERVAL)


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    up = _is_server_up()
    _server_up = up

    icon = pystray.Icon(
        name="Bakery",
        icon=ICON_GREEN if up else ICON_RED,
        title="Bakery: працює" if up else "Bakery: зупинено",
        menu=_build_menu(up),
    )

    # Start polling thread
    t = threading.Thread(target=_poll_status, args=(icon,), daemon=True)
    t.start()

    icon.run()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Write crash log so silent pythonw failures are visible
        log_path = ROOT / "logs" / "tray_crash.log"
        log_path.parent.mkdir(exist_ok=True)
        import traceback
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] CRASH:\n")
            traceback.print_exc(file=f)
        raise

# run-tray.ps1 — watchdog for tray.py
# Keeps the tray running: restarts automatically 5 seconds after any exit
# (user clicked "Exit", crash, update). Stopped only via Stop-ScheduledTask.
#
# NOTE: In production this file is generated into C:\ProgramData\Bakery\scripts\
# by install-service.ps1 / update.ps1 with BAKERY_DATA_DIR set.
# This repo copy is used only in dev mode (no BAKERY_DATA_DIR needed — tray.py
# auto-detects DATA_DIR by reading scripts/run-server.ps1).
$ROOT       = Split-Path -Parent $PSScriptRoot
$pythonw    = Join-Path $ROOT 'backend\venv\Scripts\pythonw.exe'
$trayScript = Join-Path $ROOT 'tray.py'

while ($true) {
    if (Test-Path $pythonw) {
        # Inline execution — pythonw is a direct child of this process,
        # so Stop-ScheduledTask killing this script also kills pythonw.
        & $pythonw $trayScript
    }
    Start-Sleep -Seconds 5
}


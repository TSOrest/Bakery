$TASK      = 'BakeryApp'
$TRAY_TASK = 'BakeryTray'

Write-Host '=== Bakery — Remove Auto-Start ===' -ForegroundColor Cyan

# Stop and remove server task
Stop-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TASK -Confirm:$false -ErrorAction SilentlyContinue

# Stop and remove tray task
Stop-ScheduledTask -TaskName $TRAY_TASK -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TRAY_TASK -Confirm:$false -ErrorAction SilentlyContinue

# Kill running uvicorn (all instances including orphans)
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Kill tray
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'pythonw.exe' -and $_.CommandLine -like '*tray.py*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Tasks '$TASK' and '$TRAY_TASK' removed. Auto-start disabled." -ForegroundColor Green
Write-Host 'Use start.bat to run the server manually.'
Write-Host ''

$TASK = 'BakeryApp'

Write-Host '=== Bakery — Remove Auto-Start ===' -ForegroundColor Cyan

# Stop task
Stop-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue

# Kill running uvicorn
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Remove task
Unregister-ScheduledTask -TaskName $TASK -Confirm:$false -ErrorAction SilentlyContinue

Write-Host "Task '$TASK' removed. Auto-start disabled." -ForegroundColor Green
Write-Host 'Use start.bat to run the server manually.'
Write-Host ''

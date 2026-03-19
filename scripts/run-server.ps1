$log = Join-Path 'Z:\\Пекарня 2' 'logs\bakery.log'
$python = 'Z:\\Пекарня 2\\backend\\venv\\Scripts\\python.exe'

# Kill any orphaned uvicorn processes before starting (prevents port 8000 conflict
# after Task Scheduler kills the parent but the grandchild survives as an orphan).
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

Add-Content $log ("
[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] Server starting...")
& $python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 2>&1 |
    ForEach-Object { Add-Content $log ("[{0}]  {1}" -f (Get-Date -Format 'HH:mm:ss'), $_) }

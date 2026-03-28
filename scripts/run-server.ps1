$log = Join-Path 'C:\\Bakery' 'logs\bakery.log'
$python = 'C:\\Bakery\\backend\\venv\\Scripts\\python.exe'

# Kill any orphaned uvicorn processes (taskkill instead of WMI — WMI hangs on some machines)
taskkill /F /IM python.exe /T 2>$null
Start-Sleep -Seconds 1

Add-Content $log ("
[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] Server starting...")

Set-Location 'C:\Bakery'
& $python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 2>&1 |
    ForEach-Object { Add-Content $log ("[{0}]  {1}" -f (Get-Date -Format 'HH:mm:ss'), $_) }

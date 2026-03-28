# Kill all Python and node processes (taskkill — avoids WMI which hangs on some machines)
taskkill /F /IM python.exe /T 2>$null
taskkill /F /IM pythonw.exe /T 2>$null
taskkill /F /IM node.exe /T 2>$null
Start-Sleep -Seconds 1
Write-Host "Done."

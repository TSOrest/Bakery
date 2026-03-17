# Kill all Python processes running uvicorn for this project
Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like "python*" -and $_.CommandLine -like "*uvicorn*" } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "Killed uvicorn PID $($_.ProcessId)"
    }

# Kill node processes on Vite ports
Get-Process -Name node -ErrorAction SilentlyContinue |
    Where-Object {
        $conns = Get-NetTCPConnection -OwningProcess $_.Id -ErrorAction SilentlyContinue
        $conns | Where-Object { $_.LocalPort -in @(5173, 5174) }
    } |
    ForEach-Object { Stop-Process -Id $_.Id -Force; Write-Host "Killed node PID $($_.Id)" }

Start-Sleep -Seconds 1
Write-Host "Done."

@echo off
:: Запит прав адміністратора якщо ще не маємо
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\update.ps1"
pause

@echo off
:: Launch system tray (no console window)
powershell -WindowStyle Hidden -Command "Start-Process '%~dp0backend\venv\Scripts\pythonw.exe' -ArgumentList '\"%~dp0tray.py\"' -WorkingDirectory '%~dp0' -WindowStyle Hidden"

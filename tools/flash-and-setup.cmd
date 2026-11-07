@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0flash-and-setup.ps1" %*
pause

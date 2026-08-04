@echo off
cd /d "%~dp0"
title CALCOTONE Audio Devices
calcotone_host.exe --list-devices
echo.
echo Copy a device name into CALCOTONE-AUDIO-CONFIG.bat to select it.
pause

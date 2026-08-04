@echo off
cd /d "%~dp0"
title CALCOTONE Desktop
echo Starting CALCOTONE desktop...
set "CALCOTONE_AUDIO_MODE=exclusive"
echo Requesting 64-frame exclusive WASAPI; unsupported or busy devices fall back automatically.
echo The faceplate will open inside CALCOTONE; no browser or StackBlitz is required.
echo.
calcotone_host.exe
set CALCOTONE_EXIT=%ERRORLEVEL%
echo.
echo CALCOTONE native host stopped with exit code %CALCOTONE_EXIT%.
echo Send calcotone-native.log when asking for help.
echo.
pause

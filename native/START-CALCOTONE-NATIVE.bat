@echo off
cd /d "%~dp0"
title CALCOTONE Desktop
echo Starting CALCOTONE desktop...
if exist "CALCOTONE-AUDIO-CONFIG.bat" call "CALCOTONE-AUDIO-CONFIG.bat"
if not defined CALCOTONE_AUDIO_MODE set "CALCOTONE_AUDIO_MODE=exclusive"
echo Starting the low-latency WASAPI path using the physical interface endpoints.
echo Exclusive mode is requested by default; CALCOTONE-AUDIO-CONFIG.bat may override it when required.
echo The native host automatically falls back safely when an endpoint rejects exclusive mode.
echo The faceplate will open inside CALCOTONE; no browser or StackBlitz is required.
echo.
calcotone_host.exe
set CALCOTONE_EXIT=%ERRORLEVEL%
echo.
echo CALCOTONE native host stopped with exit code %CALCOTONE_EXIT%.
echo Send calcotone-native.log when asking for help.
echo.
pause

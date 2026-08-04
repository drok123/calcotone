@echo off
cd /d "%~dp0"
title CALCOTONE Desktop
echo Starting CALCOTONE desktop...
if exist "CALCOTONE-AUDIO-CONFIG.bat" call "CALCOTONE-AUDIO-CONFIG.bat"
if not defined CALCOTONE_AUDIO_MODE set "CALCOTONE_AUDIO_MODE=shared"
echo Starting WASAPI compatibility path using the physical interface endpoints.
echo Shared mode bypasses Revelator PCM24-in-32 packing while exclusive conversion is validated.
echo The faceplate will open inside CALCOTONE; no browser or StackBlitz is required.
echo.
calcotone_host.exe
set CALCOTONE_EXIT=%ERRORLEVEL%
echo.
echo CALCOTONE native host stopped with exit code %CALCOTONE_EXIT%.
echo Send calcotone-native.log when asking for help.
echo.
pause

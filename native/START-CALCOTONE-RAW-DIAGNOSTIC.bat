@echo off
cd /d "%~dp0"
title CALCOTONE Raw Diagnostic
if exist "CALCOTONE-AUDIO-CONFIG.bat" call "CALCOTONE-AUDIO-CONFIG.bat"
set "CALCOTONE_RAW_DIAGNOSTIC=1"
if not defined CALCOTONE_AUDIO_MODE set "CALCOTONE_AUDIO_MODE=exclusive"
echo Starting CALCOTONE in TRUE RAW diagnostic mode...
echo All amp, rack, Pressure, Dream, summing, and limiter DSP is bypassed.
echo The same WASAPI capture, FIFO, and render transport remains active.
echo.
calcotone_host.exe
set CALCOTONE_EXIT=%ERRORLEVEL%
echo.
echo CALCOTONE raw diagnostic stopped with exit code %CALCOTONE_EXIT%.
echo.
pause

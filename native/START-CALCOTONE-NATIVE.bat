@echo off
cd /d "%~dp0"
title CALCOTONE Native Audio
echo Starting CALCOTONE native audio...
echo.
calcotone_host.exe
set CALCOTONE_EXIT=%ERRORLEVEL%
echo.
echo CALCOTONE native host stopped with exit code %CALCOTONE_EXIT%.
echo Send calcotone-native.log when asking for help.
echo.
pause

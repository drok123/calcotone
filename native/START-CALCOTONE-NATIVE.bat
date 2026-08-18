@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title CALCOTONE Desktop
echo Starting CALCOTONE desktop...
if not exist "runtime\msedgewebview2.exe" (
  echo ERROR: The bundled desktop runtime is missing.
  echo Re-extract the complete CALCOTONE ZIP and keep the runtime folder beside calcotone_host.exe.
  echo.
  pause
  exit /b 2
)
if not exist "web\index.html" (
  echo ERROR: The packaged CALCOTONE faceplate is missing.
  echo Re-extract the complete CALCOTONE ZIP and keep the web folder beside calcotone_host.exe.
  echo.
  pause
  exit /b 2
)
rem Fixed WebView2 120+ renderer processes use AppContainer on Windows 10.
rem Granting the documented read/execute ACL is harmless on Windows 11.
icacls "runtime" /grant "*S-1-15-2-2:(OI)(CI)(RX)" /T /C /Q >nul 2>&1
icacls "runtime" /grant "*S-1-15-2-1:(OI)(CI)(RX)" /T /C /Q >nul 2>&1
if exist "CALCOTONE-AUDIO-CONFIG.bat" call "CALCOTONE-AUDIO-CONFIG.bat"
if not defined CALCOTONE_AUDIO_MODE set "CALCOTONE_AUDIO_MODE=exclusive"
echo Starting the low-latency WASAPI path using the physical interface endpoints.
echo Exclusive mode is requested by default; CALCOTONE-AUDIO-CONFIG.bat may override it when required.
echo The native host automatically falls back safely when an endpoint rejects exclusive mode.
echo Recoverable endpoint or Windows Audio service resets restart the host automatically.
echo The packaged faceplate and fixed desktop runtime are local; internet and browser installs are not required.
echo.
set /a CALCOTONE_RESTARTS=0
:launch
calcotone_host.exe
set "CALCOTONE_EXIT=!ERRORLEVEL!"
if "!CALCOTONE_EXIT!"=="75" (
  set /a CALCOTONE_RESTARTS+=1
  if !CALCOTONE_RESTARTS! LEQ 12 (
    set /a CALCOTONE_RESTART_DELAY=CALCOTONE_RESTARTS
    if !CALCOTONE_RESTART_DELAY! GTR 5 set /a CALCOTONE_RESTART_DELAY=5
    echo.
    echo Audio endpoint changed or the Windows Audio service reset.
    echo Restarting CALCOTONE in !CALCOTONE_RESTART_DELAY! second(s) ^(!CALCOTONE_RESTARTS!/12^)...
    timeout /t !CALCOTONE_RESTART_DELAY! /nobreak >nul
    goto launch
  )
  echo.
  echo CALCOTONE reached the supervised restart limit.
)
echo.
echo CALCOTONE native host stopped with exit code !CALCOTONE_EXIT!.
echo Send calcotone-native.log when asking for help.
echo.
pause
endlocal

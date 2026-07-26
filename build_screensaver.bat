@echo off
setlocal EnableDelayedExpansion
title Build Home Screensaver

echo ==========================================
echo   Build: Home Screensaver
echo ==========================================
echo.

REM ── Install/update dependencies ───────────────────────────────────────────
echo [1/4] Checking dependencies...
pip install pyinstaller pillow --quiet --upgrade
if errorlevel 1 (
    echo ERROR: pip install failed. Make sure Python is in your PATH.
    pause & exit /b 1
)

REM ── Build EXE ──────────────────────────────────────────────────────────────
echo [2/4] Building executable...
pyinstaller ^
  --onefile ^
  --windowed ^
  --name HomeScreensaver ^
  --hidden-import=google.oauth2.credentials ^
  --hidden-import=google.auth.transport.requests ^
  --hidden-import=google.auth.exceptions ^
  --hidden-import=googleapiclient.discovery ^
  --hidden-import=googleapiclient._helpers ^
  screensaver.py

if not exist dist\HomeScreensaver.exe (
    echo.
    echo ERROR: Build failed. Check the output above for details.
    pause & exit /b 1
)

REM ── Rename to .scr ─────────────────────────────────────────────────────────
echo [3/4] Creating .scr file...
copy /Y dist\HomeScreensaver.exe dist\HomeScreensaver.scr >nul

REM ── Copy to System32 (elevates via UAC) ────────────────────────────────────
echo [4/4] Installing to System32 (a UAC prompt will appear)...
set SRC=%CD%\dist\HomeScreensaver.scr
set DST=%SYSTEMROOT%\System32\HomeScreensaver.scr

powershell -NoProfile -Command ^
  "Start-Process cmd -ArgumentList '/c copy /Y \"%SRC%\" \"%DST%\"' -Verb RunAs -Wait" 2>nul

if exist "%DST%" (
    echo Installed to System32 successfully.
) else (
    echo Could not copy to System32.
    echo Run this manually in an admin PowerShell:
    echo   Copy-Item "%SRC%" "%DST%" -Force
)

echo.
echo ==========================================
echo   Done!
echo ==========================================
echo.
echo To test:  dist\HomeScreensaver.scr /s
echo To configure: Settings ^> Personalization ^> Lock screen ^> Screen saver
echo Select "HomeScreensaver" from the dropdown.
echo.
pause

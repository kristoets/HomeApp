@echo off
setlocal EnableDelayedExpansion
title Build Home Screensaver

echo ==========================================
echo   Build: Home Screensaver
echo ==========================================
echo.

REM ── Install/update dependencies ───────────────────────────────────────────
echo [1/3] Checking dependencies...
pip install pyinstaller pillow --quiet --upgrade
if errorlevel 1 (
    echo ERROR: pip install failed. Make sure Python is in your PATH.
    pause & exit /b 1
)

REM ── Build EXE ──────────────────────────────────────────────────────────────
echo [2/3] Building executable...
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
echo [3/3] Creating .scr file...
copy /Y dist\HomeScreensaver.exe dist\HomeScreensaver.scr >nul

echo.
echo ==========================================
echo   Done!  dist\HomeScreensaver.scr
echo ==========================================
echo.
echo HOW TO INSTALL:
echo   Option A (easiest):
echo     Right-click  dist\HomeScreensaver.scr  and choose "Install"
echo.
echo   Option B (manual):
echo     Copy dist\HomeScreensaver.scr to C:\Windows\System32\
echo     Then open: Settings > Personalization > Lock screen > Screen saver
echo     Select "HomeScreensaver" from the dropdown
echo.
echo   Option C (quick test, no install):
echo     Double-click dist\HomeScreensaver.scr  to run it now
echo     (or run:  dist\HomeScreensaver.scr /s )
echo.
pause

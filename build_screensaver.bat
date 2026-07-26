@echo off
setlocal EnableDelayedExpansion
title Build Home Screensaver

echo ==========================================
echo   Build: Home Screensaver
echo ==========================================
echo.

REM ── Dependencies ──────────────────────────────────────────────────────────
echo [1/4] Checking dependencies...
pip install pyinstaller pillow --quiet --upgrade
if errorlevel 1 (
    echo ERROR: pip install failed. Make sure Python is in your PATH.
    pause & exit /b 1
)

REM ── Clean old build ────────────────────────────────────────────────────────
if exist build rmdir /S /Q build
if exist dist  rmdir /S /Q dist

REM ── Build (folder mode — avoids temp-extraction issues with tkinter) ───────
echo [2/4] Building...
pyinstaller ^
  --onedir ^
  --windowed ^
  --name HomeScreensaver ^
  --collect-all=PIL ^
  --collect-all=tkinter ^
  --hidden-import=google.oauth2.credentials ^
  --hidden-import=google.auth.transport.requests ^
  --hidden-import=google.auth.exceptions ^
  --hidden-import=googleapiclient.discovery ^
  --hidden-import=googleapiclient._helpers ^
  screensaver.py

if not exist "dist\HomeScreensaver\HomeScreensaver.exe" (
    echo.
    echo ERROR: Build failed. Check output above.
    pause & exit /b 1
)

REM ── Rename exe to scr ──────────────────────────────────────────────────────
echo [3/4] Installing to AppData (no admin needed)...
set INSTALL_DIR=%LOCALAPPDATA%\HomeScreensaver

if exist "%INSTALL_DIR%" rmdir /S /Q "%INSTALL_DIR%"
mkdir "%INSTALL_DIR%"
xcopy /Y /E /Q "dist\HomeScreensaver\*" "%INSTALL_DIR%\" >nul
ren "%INSTALL_DIR%\HomeScreensaver.exe" "HomeScreensaver.scr"

REM ── Register in registry ───────────────────────────────────────────────────
echo [4/4] Registering screensaver...
reg add "HKCU\Control Panel\Desktop" /v "SCRNSAVE.EXE"      /t REG_SZ /d "%INSTALL_DIR%\HomeScreensaver.scr" /f >nul
reg add "HKCU\Control Panel\Desktop" /v "ScreenSaveActive"  /t REG_SZ /d "1" /f >nul
reg add "HKCU\Control Panel\Desktop" /v "ScreenSaveTimeOut" /t REG_SZ /d "300" /f >nul

echo.
echo ==========================================
echo   Done!
echo ==========================================
echo.
echo Screensaver installed and registered (activates after 5 min idle).
echo.
echo Test it now:
echo   "%INSTALL_DIR%\HomeScreensaver.scr" /s
echo.
echo To change timeout: Settings ^> Personalization ^> Lock screen ^> Screen saver
echo.
pause

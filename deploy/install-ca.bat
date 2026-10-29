@echo off
chcp 65001 >nul
REM ============================================================================
REM  Install Zhike Internal CA into Windows Trusted Root Store
REM  ---------------------------------------------------------------------------
REM  WHY THIS IS REQUIRED
REM    Teachers share screen via getDisplayMedia(), which is a
REM    secure-context-only API. A page served over HTTPS with a certificate
REM    issued by this internal CA becomes a REAL secure context ONLY after
REM    the CA is trusted by the OS. Clicking "Advanced -> Continue" on the
REM    browser warning does NOT make the page a secure context, and the
REM    share button will still fail.
REM
REM  USAGE
REM    Right-click -> Run as Administrator
REM    (machine-wide trust requires elevation; per-user trust works without it)
REM ============================================================================

setlocal
set "CA=%~dp0cert\ca.crt"

if not exist "%CA%" (
  echo [ERROR] CA certificate not found: %CA%
  echo         Run this script from the deploy\ directory of the project.
  pause
  exit /b 1
)

echo Installing Zhike Internal CA into Trusted Root Certification Authorities...
echo   Source: %CA%
echo.

REM Try machine-wide first (requires admin), fall back to current user
certutil -addstore -f "Root" "%CA%" >nul 2>&1
if %errorlevel% equ 0 (
  echo [OK] Machine-wide trust installed.
) else (
  echo [WARN] Machine-wide install failed - not elevated? Trying current user...
  certutil -user -addstore -f "Root" "%CA%" >nul 2>&1
  if %errorlevel% equ 0 (
    echo [OK] Current-user trust installed.
  ) else (
    echo [ERROR] Failed to install CA. Run this script as Administrator.
    pause
    exit /b 1
  )
)

echo.
echo Verifying...
certutil -store "Root" 2>nul | findstr /i "Zhike Internal CA" >nul
if %errorlevel% equ 0 (
  echo [OK] Zhike Internal CA is now trusted.
) else (
  certutil -user -store "Root" 2>nul | findstr /i "Zhike Internal CA" >nul
  if %errorlevel% equ 0 (
    echo [OK] Zhike Internal CA is now trusted (current user).
  ) else (
    echo [WARN] Installed but not found in store listing - please verify manually.
  )
)

echo.
echo IMPORTANT:
echo   1. Fully close and restart your browser ^(Edge/Chrome^).
echo   2. Open https://47.114.123.118/student/
echo   3. The address bar must show a valid lock icon - no warning.
echo   4. Only then will screen sharing work.
echo.
pause

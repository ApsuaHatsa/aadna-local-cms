@echo off
echo ======================================================
echo    AADNA Local CMS - Installer
echo    Apsny Production Inc. (API)
echo ======================================================
echo.
:: Check Administrator privileges and elevate if needed
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -NoProfile -Command "Start-Process powershell.exe -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-File', '%~dp0install.ps1') -Verb RunAs"
    exit /b
)

echo Starting PowerShell installer...
echo.
powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause

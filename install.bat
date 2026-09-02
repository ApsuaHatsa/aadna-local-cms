@echo off
echo ======================================================
echo    AADNA Local CMS - Installer
echo    Apsny Production Inc. (API)
echo ======================================================
echo.
echo Starting PowerShell installer...
echo.
powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause

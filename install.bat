@echo off
echo ======================================================
echo    AADNA Local CMS - Installer
echo    Apsny Production Inc. (API)
echo ======================================================
echo.
:: Ensure install.ps1 has UTF-8 BOM before execution
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $f='%~dp0install.ps1'; $b=[IO.File]::ReadAllBytes($f); if($b.Length -ge 3 -and ($b[0] -ne 239 -or $b[1] -ne 187 -or $b[2] -ne 191)){ [IO.File]::WriteAllText($f, [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8), [Text.Encoding]::UTF8) } } catch {}" >nul 2>&1

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

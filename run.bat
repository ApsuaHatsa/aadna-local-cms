@echo off
chcp 65001 >nul
echo ╔══════════════════════════════════════════════╗
echo ║   🧬 AADNA Local CMS - Запуск...            ║
echo ╚══════════════════════════════════════════════╝
echo.
cd /d "%~dp0"
start http://localhost:4400
node server.js
pause

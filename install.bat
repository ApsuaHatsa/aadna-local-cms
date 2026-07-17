@echo off
chcp 65001 >nul
echo Запуск установщика AADNA Local CMS...
powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if %errorlevel% neq 0 (
  echo Произошла ошибка во время установки.
  pause
)

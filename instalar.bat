@echo off
cd /d "%~dp0"
where node >nul 2>&1 || (echo Instale Node.js 24 ou superior e tente novamente. & pause & exit /b 1)
npm install
pause

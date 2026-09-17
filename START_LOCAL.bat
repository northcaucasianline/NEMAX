@echo off
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
if not exist node_modules call npm install
call npm run dev
pause

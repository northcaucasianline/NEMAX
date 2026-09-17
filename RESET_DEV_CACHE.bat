@echo off
chcp 65001 >nul
echo Остановка старых Node.js процессов...
taskkill /F /IM node.exe >nul 2>nul
echo Удаление Vite cache...
if exist node_modules\.vite rmdir /S /Q node_modules\.vite
if exist .vite rmdir /S /Q .vite
if exist dist rmdir /S /Q dist
echo.
echo Кеш проекта очищен.
echo Теперь выполните: npm run dev
echo Открывайте: http://127.0.0.1:5173
pause

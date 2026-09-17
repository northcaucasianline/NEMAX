$ErrorActionPreference = "SilentlyContinue"
Write-Host "Остановка старых Node.js процессов..." -ForegroundColor Cyan
Get-Process node | Stop-Process -Force
Start-Sleep -Milliseconds 500

Write-Host "Удаление Vite cache..." -ForegroundColor Cyan
Remove-Item -Recurse -Force "node_modules\.vite"
Remove-Item -Recurse -Force ".vite"
Remove-Item -Recurse -Force "dist"

Write-Host "Кеш проекта очищен." -ForegroundColor Green
Write-Host "Теперь выполните: npm run dev" -ForegroundColor Yellow
Write-Host "Открывайте: http://127.0.0.1:5173" -ForegroundColor Yellow

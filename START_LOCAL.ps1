$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Создан файл .env. Перед подключением внешней нейросети заполните AI_PROVIDER, AI_MODEL, AI_API_BASE_URL и AI_API_KEY." -ForegroundColor Yellow
}

if (-not (Test-Path "node_modules")) {
  Write-Host "Устанавливаю npm-зависимости..." -ForegroundColor Cyan
  npm install
}

Write-Host "Запускаю НЕМАКС..." -ForegroundColor Green
Write-Host "Frontend: http://localhost:5173"
npm run dev

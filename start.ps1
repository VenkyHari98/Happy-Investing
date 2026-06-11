# Happy Investing - one-command launcher
# Usage: right-click -> Run with PowerShell   OR   .\start.ps1

$root = $PSScriptRoot
$url  = "http://localhost:3000"

Write-Host "`nStarting Happy Investing Dashboard..." -ForegroundColor Cyan

# Backend (FastAPI on :8000)
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "Set-Location '$root\backend'; Write-Host 'Backend on http://localhost:8000' -ForegroundColor Green; uvicorn api.main:app --port 8000"

# Frontend (Next.js on :3000)
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "Set-Location '$root\frontend'; Write-Host 'Frontend on http://localhost:3000' -ForegroundColor Green; npm run dev"

# Wait for Next.js to be ready, then open browser
Write-Host "Waiting for servers to start..." -ForegroundColor Yellow
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
}

if ($ready) {
    Write-Host "Dashboard ready - opening browser" -ForegroundColor Green
    Start-Process $url
} else {
    Write-Host "Timed out. Open $url manually in your browser." -ForegroundColor Red
}

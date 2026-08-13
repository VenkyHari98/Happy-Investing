# Happy Investing - one-command launcher
# Usage: right-click -> Run with PowerShell   OR   .\start.ps1

$root   = $PSScriptRoot
$url    = "http://localhost:3000"
$apiUrl = "http://localhost:8000"

Write-Host "`nStarting Happy Investing Dashboard..." -ForegroundColor Cyan

# Backend (FastAPI on :8000)
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "Set-Location '$root\backend'; Write-Host 'Backend on http://localhost:8000' -ForegroundColor Green; uvicorn api.main:app --port 8000"

# Frontend (Next.js on :3000)
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "Set-Location '$root\frontend'; Write-Host 'Frontend on http://localhost:3000' -ForegroundColor Green; npm run dev"

# Wait for backend to be ready, then check data freshness
Write-Host "Waiting for backend..." -ForegroundColor Yellow
$backendReady = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -Uri "$apiUrl/api/pipeline/status" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $backendReady = $true; break }
    } catch {}
}

if ($backendReady) {
    try {
        $status = Invoke-RestMethod -Uri "$apiUrl/api/pipeline/status" -TimeoutSec 5
        if ($status.is_fresh_today) {
            Write-Host "Data is up to date (run: $($status.run_date)) - loading dashboard." -ForegroundColor Green
        } elseif ($status.running) {
            Write-Host "Pipeline refresh already in progress - dashboard will update when it completes." -ForegroundColor Yellow
        } else {
            $lastRun = if ($status.run_date) { $status.run_date } else { "never" }
            Write-Host "Data is stale (last run: $lastRun) - starting pipeline refresh in the background..." -ForegroundColor Yellow
            Invoke-RestMethod -Uri "$apiUrl/api/pipeline/refresh" -Method Post -TimeoutSec 5 | Out-Null
            Write-Host "Refresh started - the dashboard will show a banner until it finishes." -ForegroundColor Cyan
        }
    } catch {
        Write-Host "Could not check data freshness - continuing anyway." -ForegroundColor DarkYellow
    }
} else {
    Write-Host "Backend did not respond in time - skipping freshness check." -ForegroundColor Red
}

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

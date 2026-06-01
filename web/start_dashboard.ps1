$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
python .\start_dashboard.py
Pop-Location

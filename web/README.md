# Happy Investing Web Viewer

This directory contains a simple static dashboard for the F40 strategy engine.

## Usage

1. Run the one-click dashboard launcher:

```powershell
cd "D:\INVESTMENT\AI Automation\Happy Investing"
python web\start_dashboard.py
```

Or use the Windows batch launcher:

```powershell
cd "D:\INVESTMENT\AI Automation\Happy Investing\web"
.\start_dashboard.bat
```

Or run the PowerShell wrapper:

```powershell
cd "D:\INVESTMENT\AI Automation\Happy Investing\web"
.\start_dashboard.ps1
```

2. The launcher will:

- run the current opportunity scanner
- run the 52W backtest
- run the envelope backtest
- build the website JSON data
- start a local web server on port 8000
- open your browser automatically

3. If you want to skip scanner or backtests, use:

```powershell
python web\start_dashboard.py --skip-scanner
python web\start_dashboard.py --skip-backtests
```

4. If you only want to refresh the web data after running scripts elsewhere:

```powershell
python web\build_data.py
```

## Notes

## What this dashboard shows

- `Current Opportunities` — live F40 scanner signals for 52W and envelope setups
- `52W Low→High Backtest` — historical backtest metrics and trade logs
- `Envelope Backtest` — envelope strategy backtest metrics and trade logs

## Notes

- The builder copies:
  - latest `current_setup_summary.json` and `current_setup.json`
  - `backtest_52w_summary.json` and `backtest_52w_trades.json`
  - `backtest_envelope_summary.json` and `backtest_envelope_trades.json`
- Re-run `build_data.py` after running the scanner or backtests to refresh the page content.

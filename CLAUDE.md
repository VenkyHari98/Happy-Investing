# Happy Investing — Project Context

## What this project does
Personal investment research and strategy backtesting platform for NSE India equities.
Three stock universes: F40 (40 fundamentally strong large/mid caps), E40 (extended 40),
S200 (200 high-growth stocks). Provides live opportunity scanning, multi-strategy
backtesting (52W Low→High, Envelope, S200 Rally, ABCD Averaging), and portfolio-level
simulations with configurable allocation tiers.

## Current Architecture
Three layers — fully migrated, `web/` is legacy and no longer the target:
- `Scripts/strategies/` — Python strategy engine (backtest engines, scanners, data cache). **DO NOT MODIFY.** Production-tested, contains all business logic.
- `backend/` — FastAPI wrapper (`backend/api/`) that imports engine modules from `Scripts/strategies/`. Runs on port 8000.
- `frontend/` — Next.js + TypeScript + Tailwind CSS v4 + Shadcn UI + TanStack Query. Runs on port 3000.

Legacy (do not use for new work):
- `web/` — Old static frontend (vanilla JS + HTML + CSS) served by Python's `http.server` on port 8080. Still needed to generate pipeline data via `web/start_dashboard.py --data-only`.

## Tech Stack
- Backend: Python 3.11+, FastAPI, yfinance 0.2.58, pandas 2.2.3, numpy 1.26.4
- Frontend: Next.js, TypeScript, Tailwind CSS v4, Shadcn UI, TanStack Query
- Charts: TradingView Lightweight Charts v5
- No database — file-based cache (pickle in `Scripts/strategies/.cache/`) + JSON outputs

## Key Data Classes
- `Trade` dataclass in `Scripts/strategies/f40_backtest_common.py` — universal trade record
- `PipelineState` in `web/start_dashboard.py` — background pipeline tracking
- Watchlist dict: `{ticker: (cap_tier, sector)}` parsed by `parse_f40_watchlist()`

## Key Strategies
1. **52W Low→High**: Buy at rolling 252-day low, exit at rolling 252-day high (fixed at entry).
   No stop-loss. Multi-entry allowed when stock revisits 8%+ below last entry.
2. **Envelope Long**: Buy when price touches lower 200 SMA envelope (default -14%).
   Exit at upper envelope or mean reversion to 200 SMA.
3. **S200 20% Rally**: Identify stocks with 20%+ rallies from recent lows in S200 universe.
4. **ABCD Averaging**: Downward-averaging tranches at -10% steps from any entry.
5. **Portfolio Backtest**: Unified engine simulating capital allocation across strategies
   with Large=5%, Mid=3%, Small=2% position sizing.

## Data Flow
1. yfinance API → OHLCV cache (.pkl files, daily expiry) in `Scripts/strategies/.cache/`
2. PE series from quarterly+annual income statements → weekly cached .pkl
3. Fundamental metrics (ROCE, ROE, D/E, OPM, etc.) → weekly cached .pkl
4. Strategy scripts → JSON outputs in `Source Data/Downloaded Data/`
5. `web/start_dashboard.py --data-only` triggers the pipeline (writes JSON)
6. FastAPI backend reads JSON outputs directly; frontend fetches via REST

## File-Based Caching (Scripts/strategies/)
- `.cache/` dir: daily OHLCV pkl, weekly PE pkl, weekly fundamentals pkl
- `.store/` dir: persistent incremental OHLCV store (ohlcv_store.py)
- Cache keys include date/week to auto-expire: `{TICKER}_{years}y_{YYYYMMDD}.pkl`
- All caches use `pickle` — not JSON

## API Endpoints (all implemented in `backend/api/routes/`)
```
GET  /api/scanner/f40                     → Current F40 opportunity scanner results
GET  /api/scanner/f40/summary             → F40 scanner summary (run_date, counts)
GET  /api/scanner/s200                    → S200 20% rally scanner results
GET  /api/backtest/52w/summary            → 52W backtest summary
GET  /api/backtest/52w/stocks             → 52W per-stock data
GET  /api/backtest/envelope/summary       → Envelope backtest summary
GET  /api/backtest/envelope/trades        → Envelope trade list
GET  /api/backtest/envelope/stocks        → Envelope per-stock data
POST /api/backtest/envelope/run           → On-demand envelope backtest with params
GET  /api/backtest/envelope/run_status    → Envelope on-demand run status
GET  /api/backtest/s200/summary           → S200 rally backtest summary
GET  /api/backtest/s200/stocks            → S200 per-stock data
GET  /api/backtest/s200/stock/{ticker}    → Single-stock S200 detail
GET  /api/portfolio/f40                   → F40 portfolio backtest (6 variants)
GET  /api/portfolio/f40/variants          → List available F40 variant names
GET  /api/portfolio/s200                  → S200 portfolio backtest
GET  /api/ohlcv/{ticker}                  → OHLCV price data for charts
GET  /api/fundamentals/pe/{ticker}        → PE ratio daily series + 5yr rolling median
GET  /api/fundamentals/metrics/{ticker}   → Fundamental metrics (ROCE, ROE, D/E, OPM…)
GET  /api/fundamentals/config             → Current fundamental_config.py thresholds
GET  /api/pipeline/status                 → {running, completed_at, run_date, error}
POST /api/pipeline/refresh                → Trigger background data refresh
GET  /api/grid-search/stream              → SSE: envelope grid search live progress
POST /api/grid-search/run                 → Start envelope parameter grid search
POST /api/grid-search/stop                → Cancel running grid search
GET  /api/grid-search/status              → Grid search progress (n_done, n_total)
```

## Watchlist Format
Semicolon-delimited text files in `Source Data/Watchlist/`: `TICKER;Cap Tier;Sector`
Cap Tiers: `Large Cap`, `Mid Cap`, `Small Cap`
Example: `RELIANCE;Large Cap;Oil & Gas`
Lines starting with `#` are comments. Header lines with `TICKER` are skipped.

## Financial Sector Handling
Banks, NBFCs, Insurance companies are treated specially:
- Use ROE instead of ROCE
- Skip Net D/E and OPM checks
- Matched by substring against: Bank, NBFC, Insurance, Microfinance, Housing Finance,
  Financial Services, Capital Markets, Consumer Finance, Diversified Financial

## Coding Conventions
- Python: type hints everywhere, dataclasses for structured data, pathlib for paths
- All monetary values in Indian Crores (Cr) for fundamentals, Rupees (₹) for portfolio
- Indian number formatting: `en-IN` locale
- All dates: ISO 8601 (YYYY-MM-DD) in JSON, pandas DatetimeIndex internally
- yfinance ticker suffixes: `.NS` for NSE, `.BO` for BSE — try NS first, fallback to BO
- PE values outside [1, 500] are noise — set to NaN
- Frontend: functional React components, Tailwind utility classes, no class components
- API responses: JSON with snake_case keys matching Python dataclass fields

## Important Constraints
- yfinance has rate limits — ALWAYS use `data_cache.py`, never call yfinance directly
- `ThreadPoolExecutor` with max_workers=10 for parallel OHLCV, 6 for PE fetches
- Fundamental filter gates silently skip when metric is None — never block on missing data
- PE series merges quarterly TTM (recent, granular) with annual TTM (historical base)
- Grid search uses `ProcessPoolExecutor` for CPU parallelism (not thread)
- Pickle files in `.cache/` and `.store/` are NOT committed to git — regenerated per machine

## How to Run
```powershell
# Both services in one command from repo root:
.\start.ps1
# Backend: http://localhost:8000  (FastAPI + /docs)
# Frontend: http://localhost:3000

# Or manually:
# Terminal 1 — backend
cd backend; uvicorn api.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend; npm run dev

# Force pipeline data refresh (regenerates all JSON outputs):
python web/start_dashboard.py --data-only --force
```

## Frontend Pages
1. **52W Low→High** (`/52w`) — Scanner + Stock Analysis (chart + PE overlay + trades) + Portfolio Backtest
2. **Envelope** (`/envelope`) — Scanner + Trade Log + By Stock + Stock Analysis + Portfolio Backtest + Grid Search
3. **S200 20% Rally** (`/s200`) — Scanner + Stock Analysis + Backtest + Portfolio Backtest
4. **Multi-Strategy Scanner** (`/scanner`) — Combined F40 52W + S200 signals with unified status/filter view

# Happy Investing — Project Context

## What this project does
Personal investment research and strategy backtesting platform for NSE India equities.
Three stock universes: F40 (40 fundamentally strong large/mid caps), E40 (extended 40),
S200 (200 high-growth stocks). Provides live opportunity scanning, multi-strategy
backtesting (52W Low→High, Envelope, S200 Rally, ABCD Averaging), and portfolio-level
simulations with configurable allocation tiers.

## Current Architecture
Two layers (migration to three layers is planned but not yet implemented):
- `Scripts/strategies/` — Python strategy code (backtest engines, scanners, data cache). **DO NOT MODIFY during migration.** Production-tested, contains all business logic.
- `web/` — Static frontend (vanilla JS + HTML + CSS) served by a Python HTTP server.

Planned target (not yet built):
- `engine/` ← rename of `Scripts/strategies/`
- `backend/` ← FastAPI wrapper importing engine modules
- `frontend/` ← Next.js 16 + Shadcn UI replacing `web/`

## Tech Stack
- Backend: Python 3.11+, yfinance 0.2.58, pandas 2.2.3, numpy 1.26.4
- Frontend (current): Vanilla JS, HTML, CSS (dark theme), served by Python's `http.server`
- Frontend (target): Next.js 16, TypeScript, Tailwind CSS v4, Shadcn UI, TanStack Query
- Charts (target): TradingView Lightweight Charts
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
5. `web/build_data.py` copies JSON outputs → `web/data/`
6. `web/start_dashboard.py` serves `web/` as static site on port 8080

## File-Based Caching (Scripts/strategies/)
- `.cache/` dir: daily OHLCV pkl, weekly PE pkl, weekly fundamentals pkl
- `.store/` dir: persistent incremental OHLCV store (ohlcv_store.py)
- Cache keys include date/week to auto-expire: `{TICKER}_{years}y_{YYYYMMDD}.pkl`
- All caches use `pickle` — not JSON

## API Endpoints (target — not yet implemented)
```
GET  /api/scanner/f40              → Current F40 opportunity scanner results
GET  /api/scanner/s200             → S200 20% rally scanner results
GET  /api/backtest/52w?years=10    → 52W backtest summary + per-stock trades
GET  /api/backtest/envelope        → Envelope backtest with tunable params
GET  /api/portfolio/f40            → Portfolio-level backtest (6 variants)
GET  /api/portfolio/s200           → S200 portfolio backtest
GET  /api/ohlcv/{ticker}           → OHLCV price data for charts
GET  /api/pe/{ticker}              → PE ratio daily series + 5yr median
GET  /api/metrics/{ticker}         → Fundamental metrics dict
GET  /api/config/fundamental       → Current fundamental_config.py values
GET  /api/pipeline/status          → {running, completed_at, run_date, error}
POST /api/pipeline/refresh         → Trigger background data refresh
SSE  /api/grid-search/stream       → Envelope grid search live progress
POST /api/grid-search/stop         → Cancel running grid search
POST /api/backtest/envelope/run    → On-demand envelope backtest with params
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
- Frontend (target): functional React components, Tailwind utility classes, no class components
- API responses (target): JSON with snake_case keys matching Python dataclass fields

## Important Constraints
- yfinance has rate limits — ALWAYS use `data_cache.py`, never call yfinance directly
- `ThreadPoolExecutor` with max_workers=10 for parallel OHLCV, 6 for PE fetches
- Fundamental filter gates silently skip when metric is None — never block on missing data
- PE series merges quarterly TTM (recent, granular) with annual TTM (historical base)
- Grid search uses `ProcessPoolExecutor` for CPU parallelism (not thread)
- Pickle files in `.cache/` and `.store/` are NOT committed to git — regenerated per machine

## How to Run (current)
```bash
# One command — auto-detects if pipeline needs to run
python web/start_dashboard.py
# Opens at http://localhost:8080

# Force re-run pipeline even if data is fresh today
python web/start_dashboard.py --force

# Skip pipeline, serve existing data only
python web/start_dashboard.py --serve-only
```

## Frontend Pages (current state)
1. **52W Low→High** — Opportunity scanner + stock detail chart + backtest trades
2. **S200 20% Rally** — Rally opportunities + backtest metrics
3. **Portfolio Overview** — Cross-strategy consolidated metrics
4. *Envelope Strategy* — Data generated; UI tab pending
5. *ABCD Averaging* — Pending
6. *Combined Scanner* — Pending

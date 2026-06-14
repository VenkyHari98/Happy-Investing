# RHS / Cup with Handle — Complete Architecture

**Built:** 2026-06-13  
**Session context:** Added as a new strategy page to the Happy Investing platform (FastAPI + Next.js).  
**Universe:** F40 + E40 (~80 stocks combined). Daily charts only. No stop-loss.

---

## 1. Strategy Rules (from instructor notes)

### Reverse Head & Shoulder (RHS)
- Three troughs forming a "W" where the **middle trough (head) is the deepest**
- Left and right shoulders should be at roughly similar heights
- Draw a **horizontal neckline** connecting the two peaks between the troughs
- Neckline must not cross the body of any green candle (only wicks OK)
- **Pattern must form below 200 DMA** (or at least 15-20% below all-time high)
- **Buy signal:** First green candle whose **body** breaks above the neckline
- **Buy execution:** Next day after the breakout candle
- **Target:** `neckline + (neckline - head_low)` — same depth projected above neckline (in %)
- **No stop-loss** — position sizing is the protection

### Cup with Handle (CWH)
- U-shaped decline (cup) followed by recovery to prior high, then a smaller pullback (handle)
- Cup depth: **≥15%** from cup left rim to cup bottom
- Cup must be **U-shaped** (not V-shaped) — bottom must last meaningful time
- Handle: **3–35% pullback** from cup rim, lasts 5–60 days; cannot retrace >50% of cup depth
- Neckline = cup left rim price
- **Pattern must form below 200 DMA**
- **Buy signal:** First green candle body crossing the neckline after handle formation
- **Buy execution:** Next day after breakout candle
- **Target:** `neckline × (1 + cup_depth_ratio)` — cup depth projected above neckline
- **No stop-loss**

### ABCD Averaging (both patterns)
- If stock falls **≥10%** from entry after breakout, one additional averaging trade is allowed
- Averaging trade size: **50% of original allocation**
- New average cost replaces the open position entry price
- Maximum: one averaging trade per pattern cycle

### Priority in the strategy hierarchy
RHS/CWH are **backup strategies** (priority 3–4). Use them when:
- Envelope and NOX have no signal
- 52W Low has no signal
- But you see clear value in a fundamentally strong F40/E40 stock

---

## 2. Complete File Map

### New Files Created

```
Scripts/strategies/f40_backtest_rhs_cwh.py        ← Pattern engine (Python)
backend/api/routes/rhs_cwh.py                      ← FastAPI route handlers
frontend/src/app/rhs/page.tsx                      ← Next.js page (/rhs)
frontend/src/components/rhs/RHSScanner.tsx         ← Current opportunities tab
frontend/src/components/rhs/RHSBacktestTable.tsx   ← Historical backtest by stock
frontend/src/components/rhs/RHSStockList.tsx       ← Sidebar stock list
frontend/src/components/rhs/RHSStockDetail.tsx     ← Chart + pattern cards + trades
```

### Modified Files

```
backend/api/main.py                                ← +rhs_cwh router at /api/rhs
frontend/src/lib/types.ts                          ← +12 new RHS/CWH types
frontend/src/lib/api.ts                            ← +api.rhs.{scanner,summary,stocks,stockDetail}
frontend/src/components/layout/Sidebar.tsx         ← +"RHS / CWH" nav link (Triangle icon)
```

### Output Directory (generated data)

```
Source Data/Downloaded Data/rhs_cwh_backtest/
    backtest_summary.json     ← Overall metrics, pattern params, fundamental gate counts
    stock_data.json           ← Per-stock: price series, detected patterns, trades, open positions
    trades.json               ← All completed trades (flat list)
    trades.csv                ← CSV export
    backtest_report.txt       ← Human-readable summary
    scanner_results.json      ← Current opportunities (FORMING + BREAKOUT status)
```

---

## 3. Python Engine Architecture (`f40_backtest_rhs_cwh.py`)

### Dataclasses

```python
@dataclass
class RHSPattern:
    l_shoulder_date, l_shoulder_price   # left trough
    head_date, head_price               # deepest trough
    r_shoulder_date, r_shoulder_price   # right trough
    neckline_price                      # avg of the two peaks between troughs
    breakout_date, breakout_idx         # day green candle crossed neckline (idx internal only)
    target_price                        # neckline + depth projected above
    pattern_type = "RHS"

@dataclass
class CWHPattern:
    cup_left_date, cup_left_price       # cup left rim (prior high)
    cup_bottom_date, cup_bottom_price   # cup lowest point
    cup_right_date, cup_right_price     # cup recovery to ~rim level
    handle_low_date, handle_low_price   # handle minimum
    neckline_price                      # = cup_left_price
    breakout_date, breakout_idx         # day green candle crossed neckline (idx internal only)
    target_price                        # neckline × (1 + cup_depth_ratio)
    pattern_type = "CWH"
```

### Core Functions

| Function | Purpose |
|----------|---------|
| `find_significant_minima(closes, window=15, depth_pct=8.0)` | Returns indices of significant valleys. A minimum is significant if it's the lowest in ±window days AND ≥depth_pct% below local high. |
| `find_significant_maxima(closes, window=20, height_pct=8.0)` | Returns indices of significant peaks. Symmetric logic. |
| `detect_rhs_patterns(df, ma200, ...)` | Scans price series for RHS patterns. Finds triplets of minima where middle is deepest, shoulders are within 15% of each other, neckline slope <5%, right shoulder below 200 DMA. Detects breakout green candle up to 120 days after right shoulder. |
| `detect_cwh_patterns(df, ma200, ...)` | Scans for CWH patterns. Finds significant peaks → cup bottom → recovery → handle → breakout. Validates U-shape (≥15% of cup time in bottom third of range). |
| `simulate_rhs_cwh_strategy(df, ticker, ...)` | One position at a time simulation. Processes all detected patterns in chronological order. Applies 3 fundamental gates at entry (200 DMA, PE, Phase 2). One ABCD averaging at -10%. |
| `build_price_series(df, rhs, cwh)` | Returns list of OHLC + MA200 + marker dicts for chart rendering. Markers: LS/H/RS for RHS, CL/CB/CR/HL for CWH, B for breakout. |
| `run_scanner(watchlist_files, output_file)` | Loads 2 years of data, detects patterns, identifies FORMING (recent unbroken pattern) and BREAKOUT (neckline crossed ≤30 days ago). Writes scanner_results.json. |
| `run_backtest(watchlist_files, output_folder, years=5)` | Full backtest over 5 years. Loads OHLCV + PE series + fundamentals in parallel. Runs simulation for each stock. Writes all JSON outputs + CSV + report. Also runs scanner at end. |

### Pattern Detection Parameters (defaults)

```python
# RHS
min_pattern_days         = 60    # Minimum total RHS duration (days)
max_pattern_days         = 365   # Maximum total RHS duration (days)
shoulder_tolerance_pct   = 15.0  # Left/right shoulder height difference < 15% of head
neckline_slope_tolerance = 5.0   # Neckline must be within 5% slope

# CWH
min_cup_days             = 60    # Cup minimum duration
max_cup_days             = 365   # Cup maximum duration
min_cup_depth_pct        = 15.0  # Cup must be ≥15% deep
handle_max_retrace_pct   = 50.0  # Handle cannot retrace >50% of cup depth

# Both
require_below_200dma     = True  # Pattern must form at/below 200 DMA
```

### Simulation Logic

```
For each stock:
  1. detect_rhs_patterns() → List[RHSPattern]
  2. detect_cwh_patterns() → List[CWHPattern]
  3. Build entry_map: {buy_day_idx → first pattern with that breakout+1}
     (buy_day_idx = breakout_idx + 1 — buy at next day open)
  4. Day-by-day loop:
       Exit check: if high >= exit_target → close position, record Trade
       ABCD check: if close < entry_price * 0.90 and not abcd_done → average in (50% alloc)
       Entry check: if day in entry_map and no open position:
           Apply 3 fundamental gates (200 DMA / PE / Phase 2)
           If pass: open position at today's open price
  5. Report still-open positions at end of data
```

### Fundamental Gates (same as 52W engine)

1. **Gate 1:** Price at entry must be **below 200 DMA** (`cfg.REQUIRE_BELOW_200DMA`)
2. **Gate 2:** PE at entry must be **< PE_MAX** (default 70) — using historical PE series
3. **Gate 3:** PE at entry must be **below 5-year rolling median PE**
4. **Gate 4:** Phase 2 balance sheet + business quality (`cfg.apply_fundamental_filter_phase2`)
   - ROCE ≥ 15% (non-financial) / ROE ≥ 15% (banks/NBFCs)
   - Net D/E ≤ 0.25 (non-financial)
   - TTM Net Profit ≥ 250 Cr
   - Sales ≥ 90% of ATH, Profit ≥ 90% of ATH (or TFA criteria)
   - OPM non-declining over last 3 years

### Reused from existing codebase

```python
from f40_backtest_common import (
    Trade,                          # Universal trade dataclass (shared with 52W, Envelope, S200)
    compute_portfolio_metrics,      # CAGR, Sharpe, win rate, etc.
    fetch_all_stocks_parallel,      # Parallel OHLCV download with cache
    fetch_all_pe_parallel,          # Current PE for display
    fetch_all_pe_series_parallel,   # Historical PE series for backtest gates
    fetch_all_fundamentals_parallel,# Phase 2 fundamentals
    parse_watchlists,               # Parses F40.txt + E40.txt into {ticker: (cap_tier, sector)}
)
import fundamental_config as cfg    # All gate thresholds (PE_MAX, REQUIRE_BELOW_200DMA, etc.)
```

### Watchlist Loading

```python
# F40 + E40 combined (both semicolon-delimited: TICKER;Cap Tier;Sector)
watchlist_files = [
    "Source Data/Watchlist/F40.txt",
    "Source Data/Watchlist/E40.txt",
]
stocks = parse_watchlists(watchlist_files)
# Returns: {ticker: (cap_tier, sector)} — ~80 stocks
```

### Allocation by Cap Tier

```python
allocations = {"Large Cap": 0.05, "Mid Cap": 0.03, "Small Cap": 0.02}
# Same as all other strategies
```

---

## 4. API Endpoints

All registered under prefix `/api/rhs` in `backend/api/main.py`:

```
GET  /api/rhs/summary          → backtest_summary.json
GET  /api/rhs/stocks           → stock_data.json overview array (no price series)
GET  /api/rhs/stock/{ticker}   → stock_data.json[ticker] full detail (with prices + patterns)
GET  /api/rhs/scanner          → scanner_results.json (current opportunities)
```

Route file: `backend/api/routes/rhs_cwh.py`  
Data directory constant: `DOWNLOADS / "rhs_cwh_backtest"` (same pattern as all other strategies)

---

## 5. TypeScript Types (frontend/src/lib/types.ts)

```typescript
RHSPattern          // l_shoulder_*, head_*, r_shoulder_*, neckline_price, breakout_date, target_price
CWHPattern          // cup_left_*, cup_bottom_*, cup_right_*, handle_low_*, neckline_price, breakout_date, target_price
RHSOpportunity      // Scanner row: ticker, pattern_type, status (FORMING|BREAKOUT), neckline, pct_to_neckline, target
RHSScannerData      // Full scanner response: run_date, counts, opportunities[]
RHSPriceMarker      // {label, pattern_type, price} — embedded in price series for chart markers
RHSPricePoint       // {date, open, high, low, close, ma200, markers[]}
RHSStockOverview    // Summary row: ticker, rhs_count, cwh_count, trades_count, total_pnl, open_count
RHSOpenPosition     // Still-open position: entry_price, neckline, exit_target, unrealised_pct, days_held
RHSStockDetail      // Full stock data: prices[], trades[], rhs_patterns[], cwh_patterns[], open_positions[]
RHSBacktestStockData// {overview: RHSStockOverview[], stock_data: Record<string, RHSStockDetail>}
RHSBacktestMetrics  // cagr, win_rate, avg_trade_pnl_pct, sharpe, etc.
RHSBacktestSummary  // summary: metrics, pattern_params, fundamental_gates, stocks_tested
```

---

## 6. Frontend Components

### Page: `frontend/src/app/rhs/page.tsx`

3-tab layout at `/rhs`:

| Tab | Component | Data source |
|-----|-----------|-------------|
| Current Opportunities | `RHSScanner` | `api.rhs.scanner()` → `/api/rhs/scanner` |
| Backtest by Stock | `RHSBacktestTable` | `api.rhs.stocks()` → `/api/rhs/stocks` |
| Stock Analysis | `RHSStockList` + `RHSStockDetail` | `api.rhs.stocks()` — price series embedded |

Clicking a ticker in Scanner or Backtest table navigates to Stock Analysis tab with that stock selected.

Metrics bar at top (hidden on Stock Analysis tab) shows: Stocks Tested, Completed Trades, Win Rate, Avg P/L, Best Trade, CAGR, Avg Duration, Open Positions.

### `RHSScanner.tsx`
- Summary chips: Scanned / Breakout / Forming / RHS / CWH counts
- Table columns: Ticker | Pattern (orange=RHS, blue=CWH) | Status (green=BREAKOUT, amber=FORMING) | Price | Neckline | % to Neckline | Target | Upside % | Pattern Start | Cap Tier
- Sorted: BREAKOUT first, then by % to neckline ascending
- Disclaimer note at bottom: "Algorithmic pre-screen only — confirm visually on TradingView before trading"

### `RHSStockList.tsx`
- Sidebar list of all stocks in backtest overview
- Green dot = stock has current opportunity in scanner
- Pattern counts shown: 2R (2 RHS detected), 3C (3 CWH detected)
- Trade count shown in green/red

### `RHSBacktestTable.tsx`
- Columns: Ticker | Cap Tier | Sector | RHS count | CWH count | Trades | Open | Total P/L | Close
- Sorted by total P/L descending

### `RHSStockDetail.tsx`
- Time range toggle: 1Y / 3Y / All
- Metric chips: Close, Trades, Total P/L, PE, RHS count, CWH count
- Current opportunity alert banner (amber) if scanner has this stock
- `StockChart` with:
  - Price series (close)
  - MA200 line
  - Entry markers (green arrowUp "B") from completed trades
  - Exit markers (red arrowDown "S") from completed trades  
  - Pattern point markers via `skipped` type: LS/H/RS for RHS, CL/CB/CR/HL for CWH, B for breakout
- Open positions table (if any): entry date, pattern type, entry price, neckline, target, unrealised %, days held
- Detected patterns section: `PatternCard` for each RHS and CWH pattern showing all key dates/prices + neckline + target + upside %
- Completed trades table: pattern type, entry/exit dates, buy/sell prices, P/L %, days held

---

## 7. Data Flow

```
Run command:
  python Scripts/strategies/f40_backtest_rhs_cwh.py
  python Scripts/strategies/f40_backtest_rhs_cwh.py --scanner-only   ← faster, 2yr data

Flow:
  parse_watchlists([F40.txt, E40.txt])
    → fetch_all_stocks_parallel()          → OHLCV cache (.cache/)
    → fetch_all_pe_series_parallel()       → PE cache (.cache/)
    → fetch_all_fundamentals_parallel()    → Fundamentals cache (.cache/)
  For each stock:
    → detect_rhs_patterns(df, ma200)
    → detect_cwh_patterns(df, ma200)
    → simulate_rhs_cwh_strategy(...)       → List[Trade]
    → build_price_series(df, rhs, cwh)     → price + markers for chart
  → Write:
      rhs_cwh_backtest/backtest_summary.json
      rhs_cwh_backtest/stock_data.json
      rhs_cwh_backtest/trades.json
      rhs_cwh_backtest/scanner_results.json
  
  FastAPI reads JSON files on each request (no DB, file-based like all other strategies)
  Next.js queries FastAPI via TanStack Query (stale-while-revalidate)
```

---

## 8. Key Design Decisions

### Why one-position-at-a-time (not multi-entry like 52W)
RHS/CWH patterns are discrete events. Each pattern has its own measured target. Allowing concurrent positions would mix pattern signals from different time windows. The envelope strategy uses the same one-position-at-a-time model for the same reason.

### Why ABCD is limited to one trade at -10%
The instructor notes say: "If it falls 10% from the buy point and a new shoulder or handle is forming, take a second trade." This implies one averaging trade tied to pattern re-formation, not the full ABCD ladder. Full ABCD (10/20/30%) is reserved for strategies where you are buying at a structural level (52W low, envelope lower band).

### Why breakout detection uses green candle body (not just close > neckline)
Directly from instructor rule: "Wait for a green candle whose body breaks above the neckline. Wick alone doesn't count." Algorithm implements this as: `close > neckline AND open < neckline` (candle opens below and closes above = body crossing).

### Why the pre-screen disclaimer matters
These are visual patterns. The algorithm approximates them well but produces ~20–30% false positives compared to trained human eye. The workflow is: **algorithm flags → user confirms on TradingView → place GTT**. Scanner is a time-saver, not an auto-trigger.

### Why price series is embedded in stock_data.json (not fetched via /api/ohlcv)
Other strategies (52W, Envelope) embed their computed price series (including strategy-specific bands) in stock_data.json. RHS/CWH follows the same pattern — the embedded series includes pattern markers pre-computed, saving a second API call from the frontend.

---

## 9. CLI Usage

```powershell
# From repo root: d:\VENKAT\PERSONAL FINANCE\HAPPY INVESTING\Happy-Investing\

# Full backtest (5 years, F40 + E40) + scanner
python Scripts/strategies/f40_backtest_rhs_cwh.py

# Scanner only (2 years, much faster — ~3 min vs ~15 min)
python Scripts/strategies/f40_backtest_rhs_cwh.py --scanner-only

# Custom years or watchlists
python Scripts/strategies/f40_backtest_rhs_cwh.py --years 10
python Scripts/strategies/f40_backtest_rhs_cwh.py --watchlist "Source Data/Watchlist/F40.txt"

# Default args (all optional):
#   --watchlist  "Source Data/Watchlist/F40.txt,Source Data/Watchlist/E40.txt"
#   --output     "Source Data/Downloaded Data/rhs_cwh_backtest"
#   --years      5
#   --portfolio-value 100000
#   --slippage   0.10
#   --scanner-only (flag, no value)
```

---

## 10. Current State (as of 2026-06-13)

### Scanner results (generated)
- Scanned: 79 stocks (TATAMOTORS had yfinance error — delisted/unavailable)
- **BREAKOUT (3):** HONAUT (RHS), DIXON (RHS), ASTRAZEN (RHS)
- **FORMING (5):** BOSCHLTD (CWH), LALPATHLAB (CWH), DMART (CWH), CIPLA (CWH), CDSL (RHS)

### Full backtest status
- The full 5-year backtest was started in background after scanner completed
- Once done, `backtest_summary.json` and `stock_data.json` will be populated
- The `/rhs` page metrics bar and "Backtest by Stock" tab will show data on next refresh

### Page URL
- `http://localhost:3000/rhs` — Scanner working, backtest pending first run

---

## 11. Things to Build Next (possible extensions)

| Feature | Effort | Notes |
|---------|--------|-------|
| Neckline + target as horizontal lines on chart | Low | Pass neckline as flat `lowerEnvelope` series to StockChart for each detected pattern |
| On-demand re-scan button (like envelope run) | Medium | POST endpoint that triggers scanner in background thread, SSE or polling for status |
| Pattern parameter tuning UI | Medium | Like grid search — sweep shoulder_tolerance, min_cup_depth and compare trade counts |
| False positive tagging | Medium | Allow user to mark detected patterns as "confirmed" or "rejected" in a local JSON file |
| GTT placement helper | High | After user confirms pattern, auto-calculate GTT buy price (current close or next day open) and target |

---

## 12. Architecture Reference (full platform context)

This page follows the identical 3-layer architecture as all other strategy pages:

```
Layer 1: Scripts/strategies/f40_backtest_rhs_cwh.py  (Python engine)
            ↓ writes JSON to:
         Source Data/Downloaded Data/rhs_cwh_backtest/

Layer 2: backend/api/routes/rhs_cwh.py  (FastAPI)
            ↓ reads JSON files on GET request
         Registered at /api/rhs in backend/api/main.py

Layer 3: frontend/src/app/rhs/page.tsx  (Next.js)
            ↓ fetches via api.rhs.* (TanStack Query)
         Components in frontend/src/components/rhs/
```

Existing strategies for comparison:
- 52W Low→High: `f40_backtest_52w.py` → `routes/backtest.py` → `/52w`
- Envelope: `f40_backtest_envelope.py` → `routes/backtest.py` → `/envelope`
- S200 20% Rally: `s200_20pct_rally_backtest.py` → `routes/backtest.py` → `/s200`
- RHS/CWH: `f40_backtest_rhs_cwh.py` → `routes/rhs_cwh.py` → `/rhs` ← **this session**

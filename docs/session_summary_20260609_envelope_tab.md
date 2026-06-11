# Session Summary — Envelope Strategy Tab Build
**Date:** 2026-06-09  
**Project:** Happy Investing Dashboard (`d:\VENKAT\PERSONAL FINANCE\HAPPY INVESTING\Happy-Investing`)  
**Goal:** Build a standalone Envelope Strategy main tab in the dashboard — separate from the 52W tab — for F40 stocks only.

---

## Context From Prior Sessions

### Dashboard Architecture
- **Framework:** Vanilla HTML/CSS/JS + Python (no React/Vue). All SVG charts drawn by hand in `web/app.js`.
- **Data pipeline:** `Scripts/strategies/*.py` → `web/data/*.json` (via `web/build_data.py`) → `web/app.js`
- **Performance:** 4-layer optimization done (parallel yfinance downloads, daily pickle cache, gzip responses, Phase 1/2 lazy load in JS). Cold start ~3-5 min, same-day rerun <30 sec.
- **Universe so far:** F40 (40 stocks) and S200. This tab is F40 only.

### Strategy Context (52W Tab — Prior Session 2026-06-09)
- 52W Low→High: CAGR 8.5% (fixed exit), 9.1% (rolling ratchet)
- Root cause of sub-15% CAGR: 53.8% capital idle on average
- 4 pending fixes: declining 52W filter, 20-day MOMENTUM confirmation, multi-year floor filter, time+loss stop
- Baseline for comparison: 52W fixed exit = 9.06% CAGR

---

## What Was Built This Session

### 1. New Python Script: `envelope_portfolio_backtest.py`

**File:** `Scripts/strategies/envelope_portfolio_backtest.py`

**Purpose:** Standalone portfolio-level backtest for envelope strategies on F40 stocks only. Separate from the combined 52W+Envelope backtests in `f40_portfolio_backtest.py`.

**Three strategies simulated:**

| Strategy | Entry | Exit | Logic |
|---|---|---|---|
| `LONG_FULL` | Lower envelope (MA−14%) | Upper envelope (MA+14%) | Full mean-reversion range |
| `LOWER_HALF` | Lower envelope (MA−14%) | 200 DMA | Half the move — quicker exit |
| `UPPER_HALF` | 200 DMA (rising from below) | Upper envelope (MA+14%) | Catch the upper half only |
| `COMBINED` | All 3 simultaneously | (per strategy) | Shared ₹1L cash pool |

**Portfolio mechanics:**
- Shared ₹1L cash pool
- Allocations: Large Cap 3% | Mid Cap 2% | Small Cap 1% of current portfolio value
- Max **1 position per (strategy, ticker)** at a time
- **No explicit MAX_CONCURRENT cap** — cash is the only gate
- Slippage: 0.1% per side
- Entry band: 2% tolerance (enter when price ≤ lower × 1.02 or crosses above MA within 2%)
- UPPER_HALF entry condition: previous close < MA200 AND current bar touches MA within 2% band (crossing from below)

**Output (4 JSON files):**
```
Source Data/Downloaded Data/env_pb_long.json
Source Data/Downloaded Data/env_pb_lower.json
Source Data/Downloaded Data/env_pb_upper.json
Source Data/Downloaded Data/env_pb_combined.json
```

**JSON format** (same as `f40_portfolio_backtest_fixed.json`):
```json
{
  "meta":         { strategy, envelope_pct, sim_start, sim_end, initial_capital, ... },
  "summary":      { cagr_pct, win_rate_pct, total_trades, yearly_returns, by_cap_tier, ... },
  "equity_curve": [ { date, total_value, cash, deployed, open_count } ],
  "trades":       [ { trade_id, strategy, ticker, entry_date, exit_date, pnl_pct, ... } ],
  "stock_prices": { ticker: [ { date, close, ma200, env_lower, env_upper } ] }
}
```

**CLI usage:**
```bash
cd Scripts/strategies
python envelope_portfolio_backtest.py          # defaults: 5yr sim, ₹1L, 14% envelope
python envelope_portfolio_backtest.py --years 3 --env-pct 12
```

---

### 2. `build_data.py` Update

Added 4 new copy targets at the bottom of `web/build_data.py`:
```python
copy_file(DOWNLOADS / 'env_pb_long.json',     'env_pb_long.json',     'Envelope Long Full...')
copy_file(DOWNLOADS / 'env_pb_lower.json',    'env_pb_lower.json',    'Envelope Lower Half...')
copy_file(DOWNLOADS / 'env_pb_upper.json',    'env_pb_upper.json',    'Envelope Upper Half...')
copy_file(DOWNLOADS / 'env_pb_combined.json', 'env_pb_combined.json', 'Envelope Combined...')
```

---

### 3. Dashboard: `web/index.html` Changes

- Removed `disabled` class and "Soon" badge from the **Envelope Strategy** nav item
- Replaced the coming-soon placeholder `<section id="page-envelope">` with the full page:

**Page structure:**
```
page-envelope
├── Page header (title, subtitle, chips: F40 / Mean Reversion)
├── Strategy selector bar (#env-strategy-bar)
│   ├── [Long Full  L→U] [Lower Half] [Upper Half] [All Combined]
│   └── CAGR diff badges on Lower/Upper/Combined vs Long Full
├── Mode description pill (#env-mode-desc)
├── Top-level metric cards (#env-metric-row)
├── Sub-tab nav
│   ├── [Backtest Results] [Trade Log]
│   └──
├── envtab-backtest (sub-tab 1)
│   ├── Metric cards (#env-pb-metric-row)
│   ├── Year-by-Year Returns bar chart
│   ├── Equity Curve SVG (Deployed vs Cash stacked area)
│   └── Cap tier stat cards
└── envtab-tradelog (sub-tab 2)
    ├── Ticker pill filter row
    ├── Filter toolbar (search, outcome, cap, strategy)
    ├── Trade log table (with click-to-chart)
    └── Trade detail panel (SVG chart with envelope bands)
```

---

### 4. Dashboard: `web/app.js` Changes

**New global state:**
```js
const _envData   = { long: null, lower: null, upper: null, combined: null };
let   _envMode   = 'long';
let   _envActive = null;
let   _envSelectedTrade = null;
let   _envInited = false;
const _envFilters = { search: '', status: 'ALL', cap: 'ALL', strategy: 'ALL', ticker: null };
```

**New functions:**
| Function | Purpose |
|---|---|
| `initEnvData(mode, data)` | Called when each JSON loads; stores data and re-renders if active mode |
| `renderEnvTab()` | Master render — calls all sub-renderers + wires filter events once |
| `updateEnvModeDesc()` | Updates strategy description pill |
| `renderEnvSummary()` | Populates `#env-metric-row` and `#env-pb-metric-row` |
| `renderEnvYearlyReturns()` | Year-by-year bar chart in `#env-pb-yearly-wrap` |
| `renderEnvTierStats()` | Cap tier stat cards |
| `drawEnvPortfolioChart()` | SVG equity curve (deployed + cash stacked area) |
| `renderEnvTickerPills()` | Ticker pill filter row with active highlight |
| `renderEnvTradeLog()` | Filterable trade table with click delegation |
| `showEnvTradeChart(trade)` | SVG trade detail chart showing envelope bands |
| `closeEnvTradePanel()` | Hides trade detail panel |
| `updateEnvDiffBadges()` | Shows CAGR delta vs Long Full on each strategy button |

**Phase 2 data loading** (added to `loadData()`):
```js
const envLongP     = fetch('data/env_pb_long.json');
const envLowerP    = fetch('data/env_pb_lower.json');
const envUpperP    = fetch('data/env_pb_upper.json');
const envCombinedP = fetch('data/env_pb_combined.json');
// ...each resolves into initEnvData(mode, data)
```

**Trade detail chart** draws these layers (new vs 52W chart):
- Green dashed: lower envelope band
- Red dashed: upper envelope band  
- Amber dashed: 200 DMA
- Blue solid: close price
- Strategy-coloured dashed: exit target line
- Green circle: entry marker, exit circle colour matches exit type

---

### 5. `web/styles.css` Change

Added 2 lines:
```css
.env-subtab-panel        { display: none; }
.env-subtab-panel.active { display: block; }
```

---

## Backtest Results (5-Year, F40 Only, ₹1L Starting Capital)

| Strategy | Closed Trades | Open at End | Max Concurrent | Win Rate | CAGR | Final Value |
|---|---|---|---|---|---|---|
| Long Full (L→U) | 60 | 31 | 32 | 93.3% | **6.52%** | ₹1,37,123 |
| Lower Half (L→M) | 108 | 22 | 31 | 91.7% | 5.24% | ₹1,29,074 |
| Upper Half (M→U) | 111 | 31 | 35 | 90.1% | 4.57% | ₹1,25,060 |
| Combined (all 3) | 164 | 42 | 42 | 86.6% | 6.17% | ₹1,34,905 |

**Observations:**
- Long Full wins on CAGR — full envelope range captures the most gain per trade
- Lower Half has the most closed trades (faster exits) but lower CAGR — exits too early
- Upper Half is weakest — the 200 DMA crossing entry misses many trades (price overshoots MA)
- Combined CAGR (6.17%) is slightly below Long Full (6.52%) — the 3 strategies compete for the same cash pool
- All four are below the 52W Fixed CAGR (9.06%) — envelope is more frequent but smaller per-trade gain

---

## Open Issue Raised: Position Limits

**Question asked:** "Is there a limit on the number of stocks we buy?"

**Current state:** No explicit cap. Only constraints:
1. One position per (strategy, ticker) at a time
2. Cash availability (e.g., 3% alloc × ₹1L = ₹3,000 per Large Cap trade)

**Numbers:** Long Full peaks at 32 concurrent positions; Combined peaks at 42.

**Not resolved yet:** Whether to add `MAX_CONCURRENT` or `MAX_PER_STOCK` limits. Options discussed:
- `MAX_CONCURRENT = 15` — hard cap like old 52W setup
- Higher allocation % to make cash the natural cap at fewer positions
- `MAX_PER_STOCK_ALL_STRATEGIES = 1` — prevent Combined from holding 3 positions in same ticker simultaneously

**Recommended next step:** Decide the position sizing philosophy first (concentrated vs diversified), then add the cap.

---

## Files Changed / Created This Session

### New files:
```
Scripts/strategies/envelope_portfolio_backtest.py   ← new backtest engine
web/data/env_pb_long.json                           ← generated data (Long Full)
web/data/env_pb_lower.json                          ← generated data (Lower Half)
web/data/env_pb_upper.json                          ← generated data (Upper Half)
web/data/env_pb_combined.json                       ← generated data (Combined)
```

### Modified files:
```
web/build_data.py     ← 4 new copy_file() calls
web/index.html        ← envelope nav enabled + full page HTML
web/app.js            ← ~300 lines of new envelope tab logic
web/styles.css        ← 2 lines (.env-subtab-panel)
```

---

## Pending / Next Steps

### Envelope strategy improvements:
1. **Position cap decision** — Add `MAX_CONCURRENT` or `MAX_PER_STOCK` limit (open question from this session)
2. **Envelope scanner** — Live scanner showing F40 stocks currently near lower/upper envelope bands (analogous to the 52W opportunity scanner). Needs `f40_opportunity_scanner.py` to emit envelope proximity data.
3. **Start dashboard integration** — Add `envelope_portfolio_backtest.py` to `start_dashboard.py` pipeline so it runs automatically with the daily refresh
4. **Short-selling variant** — True short positions (enter at upper env, cover at MA or lower env) — currently not implemented in this tab

### 52W strategy fixes (from prior session, still pending):
1. Declining 52W low filter (skip secular declines)
2. MOMENTUM 20-day confirmation (prevent false recovery entries)
3. Multi-year floor entry filter (faster capital rotation)
4. Time+loss stop on INITIAL (free trapped capital)
5. Remove RELAXO, TEAMLEASE, QUESS, AWL from watchlist

### Dashboard improvements:
- Portfolio Overview tab (cross-strategy capital deployment, consolidated CAGR) — still "Coming Soon"
- ABCD Averaging tab — still "Coming Soon"
- Combined Scanner tab — still "Coming Soon"

---

## Key Architecture Notes for Next Session

- All rendering uses prefix-based helper pattern: `renderPortfolioSummary(prefix, data)` — the envelope tab is **not** on this pattern; it has its own standalone functions prefixed `env` (intentional — different data shape)
- Equity curve chart in envelope tab reuses the exact same SVG logic as `drawPortfolioChart()` in `app.js` but is a separate function `drawEnvPortfolioChart()` — they could be merged if needed
- Trade detail chart in envelope tab **adds envelope bands** (env_lower, env_upper, ma200 lines from `stock_prices`) — the 52W version does not have these
- `_envData` is loaded progressively in Phase 2; `initEnvData(mode, data)` triggers re-render only if the mode just loaded matches `_envMode` (the currently displayed strategy)
- To regenerate data: `python Scripts/strategies/envelope_portfolio_backtest.py` then `python web/build_data.py`

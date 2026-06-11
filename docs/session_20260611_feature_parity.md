# Happy Investing — Session Summary (2026-06-11 Part 2)

## What we did this session

**Goal:** Audit the old dashboard (`web/`) against the new Next.js frontend and fill all feature gaps identified.

---

## Gap audit findings

Compared old `web/index.html` + JS against new `frontend/`. Found these categories of missing features:

| Category | Old | Status |
|---|---|---|
| 52W Scanner: search + sector/cap dropdowns | ✅ | ✅ Done |
| 52W Scanner: sort dropdown (5 options) | ✅ | ✅ Done |
| 52W Scanner: ABCD levels columns (−10/19/27/34%) | ✅ | ✅ Done |
| 52W Scanner: distance-to-low visual fill bar | ✅ | ✅ Done |
| 52W Scanner: potential gain % column | ✅ | ✅ Done |
| 52W Stock Analysis: Opportunity filter (At Low / Approaching / Near DMA) | ✅ | ✅ Done |
| 52W Stock Analysis: chart time range toggle (1Y / 3Y / All) | ✅ | ✅ Done |
| 52W Stock Analysis: open positions full 7-field grid | ✅ | ✅ Done |
| 52W Portfolio Backtest sub-tab | ✅ | ✅ Done |
| S200 Scanner: 8 metric status cards at top | ✅ | ✅ Done |
| S200 Scanner: search + watchlist/sector/cap/sort filters | ✅ | ✅ Done |
| S200 Scanner: missing columns (Candles, Rally End, Expiry date, 200 DMA) | ✅ | ✅ Done |
| S200 Portfolio Backtest sub-tab | ✅ | ✅ Done |
| Envelope: strategy mode selector with CAGR diff badges | ✅ | ✅ Done |
| Envelope: Portfolio Backtest sub-tab | ✅ | ✅ Done |
| **S200 Stock Analysis sub-tab** | ✅ | ✅ Done |
| **Envelope: parameter panel + Run Backtest** | ✅ | ✅ Done |
| **Envelope: Grid Search SSE** | ✅ | ⏳ Next session |

---

## Files created / modified

### New files

```
frontend/src/components/
├── portfolio/
│   ├── EquityCurve.tsx          ← TradingView portfolio value chart (Portfolio + Deployed + Cash + ref line)
│   ├── YearlyReturns.tsx        ← Year-by-year return cards (green/red by sign)
│   ├── CapTierBreakdown.tsx     ← Large/Mid/Small cap stats cards
│   ├── PortfolioTradeLog.tsx    ← Full portfolio trade log with:
│   │                               - Ticker pills (click-to-filter)
│   │                               - Search + Cap + Outcome + Tranche + Strategy filters
│   │                               - All columns: ticker, cap, tranche, entry/exit, days, P/L%, P/L₹, Max DD, Outcome
│   │                               - Click-to-sort on all key columns
│   └── PortfolioBacktest.tsx    ← Composite: variant selector + all 4 sub-sections above
├── envelope/
│   └── EnvelopeByStock.tsx      ← Client-side trade grouping by ticker with win rate + P/L columns
└── s200/
    ├── S200StockList.tsx         ← Left panel (built, wired into Stock Analysis tab)
    ├── S200StockDetail.tsx       ← Right panel: 8 metric cards + live rallies + trade log
    └── (S200Scanner.tsx updated — see modified files)
envelope/
└── EnvelopeConfigPanel.tsx      ← Collapsible param panel: Env%/Zone%/alloc + Run Backtest
```

### Modified files

```
frontend/src/lib/types.ts
  + EnvelopeTrade, EnvelopeSummary
  + S200Status, S200Rally, S200ScannerData (+ source_counts field)
  + S200BacktestSummary, S200StockOverview, S200BacktestStockData
  + PortfolioTrade, EquityCurvePoint, CapTierStats
  + PortfolioSummary, PortfolioMeta, PortfolioBacktestData

frontend/src/lib/api.ts
  + api.backtest.summaryEnvelope(), tradesEnvelope()
  + api.backtest.summaryS200(), stocksS200()
  + api.portfolio.f40(variant, years), s200(years)
  + api.scanner.s200()

frontend/src/components/52w/ScannerTab.tsx   ← full rewrite
  + Search input
  + Sector + Cap dropdowns
  + Sort dropdown: By Zone / Closest Low / Closest High / Highest Gain / Ticker A-Z
  + ABCD-A/B/C/D price columns (computed from 52W low × −10/19/27/34%)
  + Potential gain % column
  + Distance-to-low visual fill bar (coloured by status)
  + "Dist to DMA" (200 DMA column)

frontend/src/components/52w/StockList.tsx   ← added Opportunity filter dropdown
  + "All Opportunities / At 52W Low now / Approaching low / Near DMA"

frontend/src/components/52w/StockDetail.tsx  ← added
  + Chart time range toggle: 1Y / 3Y / All
  + Open positions: 7-field grid (Entry Date, Entry ₹, Fixed Target, Current ₹, Days Held, Unrealised %, % to Target)

frontend/src/components/s200/S200Scanner.tsx  ← full rewrite
  + 8 clickable metric status cards (IN_ZONE / APPROACHING / WATCHING_NEAR / WATCHING / BELOW_BUY / Total Rallies / Scanned / Run Date)
  + Status pills (same as old dashboard)
  + Search + Watchlist + Sector + Cap + Sort dropdowns (6 sort options)
  + Extra table columns: Candles, Rally End, Expiry Date, Days Left, 200 DMA

frontend/src/app/52w/page.tsx
  + "Portfolio Backtest" third sub-tab
  + Variant selector: 52W Only / +Envelope Long / +Rally F40 / All 3 Combined
  + CAGR diff badges on non-active variants (vs active variant)
  + Loads all 4 variants in background for instant comparison

frontend/src/app/s200/page.tsx
  + "Portfolio Backtest" third sub-tab → PortfolioBacktest component

frontend/src/app/envelope/page.tsx
  + "Portfolio Backtest" third sub-tab
  + Variant selector: Long Full / 52W Only / All 3 Combined (with CAGR diff badges)
```

---

## Architecture of the shared PortfolioBacktest component

```
PortfolioBacktest (composite)
├── Variant selector bar  → strategy buttons + CAGR diff badges
├── MetricCards           → 8 summary metrics (trades, win rate, CAGR, P/L, avg P/L, max DD, time in market)
├── YearlyReturns         → horizontal row of year cards (green/red by return)
├── EquityCurve (chart)   → TradingView: Portfolio (blue) + Deployed (teal dashed) + Cash (slate dotted) + Initial (dark dashed)
├── CapTierBreakdown      → 3 cards: Large/Mid/Small with trades/won/win rate/avg P/L
└── PortfolioTradeLog     → full trade table with all filters
```

This is reused by 52W, S200, and Envelope portfolio sub-tabs.

---

## Data sources confirmed

| Tab | Variant | File loaded |
|---|---|---|
| 52W → 52W Only | `fixed` | `f40_portfolio_backtest_fixed_{5|10}y.json` |
| 52W → +Envelope Long | `fixed_env-long` | `f40_portfolio_backtest_fixed_env-long_{5|10}y.json` |
| 52W → +Rally F40 | `fixed_rally-f40` | `f40_portfolio_backtest_fixed_rally-f40_{5|10}y.json` |
| 52W → All 3 Combined | `fixed_env-long_rally-f40` | `f40_portfolio_backtest_fixed_env-long_rally-f40_{5|10}y.json` |
| S200 Portfolio | — | `s200_portfolio_backtest_{5|10}y.json` |

---

## What was done (this session continued)

### S200 Stock Analysis sub-tab ✅
- Added `S200TradeRecord`, `S200StockDetailMetrics`, `S200StockDetailData` types to `types.ts`
- Updated `S200BacktestStockData` to include `stock_data?: Record<string, S200StockDetailData>`
- Added backend route `GET /api/backtest/s200/stock/{ticker}?years=10` in `backtest.py`
- Created `frontend/src/components/s200/S200StockDetail.tsx`:
  - Stock header (ticker, cap, sector, source badge)
  - 8 metric cards (Total Rallies, Entered, Won, Expired, Zone Entry Rate, Win Rate, Avg P/L, Avg Days)
  - Live rallies card (from scanner, filtered to ticker) — green-tinted, shows status, buy zone, target, expiry
  - Historical backtest trade log (full trade table with Rally End, Rally %, Candles, Buy Zone, Entry/Exit, Days, P/L%, Max DD%, Outcome)
- Updated `s200/page.tsx` to add "Stock Analysis" as 3rd sub-tab (split panel: S200StockList left + S200StockDetail right)

### Envelope parameter panel + Run Backtest ✅
- Added `EnvelopeConfigPanel.tsx` component:
  - Collapsed state: shows current params as pill badges + "Re-run" button
  - Expanded state: inputs for Envelope % (1–30) + Zone % (0.5–10) + read-only alloc info + Run Backtest button
  - Running state: pulse indicator + "Backtest running…" message, button disabled
  - Error state: shows failure message inline
- Added backend endpoints in `backtest.py`:
  - `POST /api/backtest/envelope/run?envelope_pct=14&entry_band_pct=2&years=10` — async, returns immediately
  - `GET /api/backtest/envelope/run_status` — poll for running/completed/error state
- Wired into `envelope/page.tsx`:
  - `useQuery` polling at 3s intervals when running
  - Auto-invalidates `envelope-summary` + `envelope-trades` queries when run completes
  - `EnvelopeConfigPanel` replaces the old static params display

## What's next (next session)

### Priority 1 — Grid Search
- Expandable grid search panel on Envelope page
- `SSE /api/grid-search/stream` → live top-10 results table updating as search runs
- Stop button → `POST /api/grid-search/stop`
- Show top results sorted by CAGR with params columns

### Priority 2 — Combined Scanner page (`/scanner`)
- Multi-strategy opportunity view combining F40 52W + S200 scanner results
- Currently shows "Coming Soon" in sidebar nav

---

## How to run

```powershell
# One command from repo root:
.\start.ps1

# Or manually:
# Terminal 1:
cd backend; uvicorn api.main:app --port 8000

# Terminal 2:
cd frontend; npm run dev

# Then open: http://localhost:3000
```

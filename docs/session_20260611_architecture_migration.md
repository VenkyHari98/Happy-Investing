# Happy Investing — Session Summary (2026-06-11)

## What we did this session

### 1. Reviewed architecture audit files
Two audit files in `audit files/` were assessed:
- `happy-investing-architecture-plan.md` — architecture review + migration roadmap
- `happy-investing-CLAUDE-md.md` — proposed CLAUDE.md content

**Verdict:** Audit diagnosis was accurate. Python engine is production-quality (7/10),
frontend is a 3,005-line monolith (3/10). Decided to migrate to:
- FastAPI backend wrapping existing Python (zero changes to strategy code)
- Next.js 16 + Shadcn UI + TradingView Lightweight Charts frontend

---

### 2. Created CLAUDE.md
`Happy-Investing/CLAUDE.md` — project context file for AI tools.
Fixed from the audit proposal: describes **current** state (Scripts/strategies/, web/),
not the future state. API endpoints marked as "(target — not yet implemented)".

---

### 3. Built FastAPI backend (`backend/`)

```
backend/
├── requirements.txt          (fastapi==0.115.5, uvicorn==0.32.1 + existing deps)
└── api/
    ├── main.py               (FastAPI app + CORS)
    ├── paths.py              (ROOT, DOWNLOADS, WATCHLISTS, SCRIPTS constants + latest_dated_dir())
    └── routes/
        ├── scanner.py        (GET /api/scanner/f40, /f40/summary, /s200, /s200/stocks)
        ├── backtest.py       (GET /api/backtest/52w/summary|trades|stocks, /envelope/*, /s200/*)
        ├── portfolio.py      (GET /api/portfolio/f40?variant=fixed&years=10, /f40/variants, /s200)
        └── pipeline.py       (GET /api/pipeline/status, POST /api/pipeline/refresh)
```

All routes read from `Source Data/Downloaded Data/` JSON files — no computation.
Scanner routes use `latest_dated_dir()` to auto-find the most recent dated folder (DDMMYYYY).
Pipeline refresh triggers `web/start_dashboard.py --data-only` as a background subprocess.

**Run:** `cd backend && uvicorn api.main:app --port 8000`
**Docs:** `http://localhost:8000/docs`

---

### 4. Built Next.js frontend (`frontend/`)

Stack: Next.js 16.2.9 · TypeScript · Tailwind CSS v4 · Shadcn UI · TanStack Query ·
TradingView Lightweight Charts v5.2.0

```
frontend/src/
├── app/
│   ├── layout.tsx            (dark theme, sidebar + main layout, TanStack Query provider)
│   ├── page.tsx              (redirects / to /52w)
│   └── 52w/page.tsx          (full 52W tab page with TanStack Query hooks)
├── components/
│   ├── providers.tsx         (QueryClientProvider, staleTime=5min)
│   ├── layout/Sidebar.tsx    (nav: Overview, 52W, Envelope, S200, Multi-Strategy)
│   ├── charts/StockChart.tsx (TradingView LW Charts v5 - price, 52W low/high, 200 DMA, markers)
│   └── 52w/
│       ├── MetricCards.tsx   (grid of metric cards with colour variants)
│       ├── ScannerTab.tsx    (proximity pill filters + sortable scanner table)
│       ├── StockList.tsx     (left panel: sector/cap/search filters, P/L, proximity dots)
│       ├── StockDetail.tsx   (right panel: metrics, chart, open positions, trade log)
│       └── TradeLog.tsx      (completed trades table)
└── lib/
    ├── types.ts              (PricePoint, Trade, StockDetail, BacktestSummary, ScannerRow, etc.)
    ├── api.ts                (typed fetch wrappers for all FastAPI endpoints)
    └── format.ts             (fmtCur, fmtPct, fmtNum, fmtDate - en-IN locale)
```

**Key data insight:** `prices` field in stock_data.json is an array of objects
`{date, close, high, low, w52_high, w52_low, ma200}` — not flat numbers.
All four chart series (price, 52W low/high, 200 DMA) come from this single array.

**Run:** `cd frontend && npm run dev` → `http://localhost:3000`

---

### 5. Created one-command launcher (`start.ps1`)

`Happy-Investing/start.ps1` — opens two PowerShell windows (backend + frontend),
polls until Next.js is ready, then opens the browser automatically.

```powershell
.\start.ps1
# or double-click -> Run with PowerShell
```

Uses `$PSScriptRoot` (not `$MyInvocation`) so it works when dot-sourced too.

---

## Current project structure

```
Happy-Investing/
├── CLAUDE.md                     <- NEW (current-state description)
├── start.ps1                     <- NEW (one-command launcher)
├── backend/                      <- NEW (FastAPI)
├── frontend/                     <- NEW (Next.js dashboard)
├── Scripts/strategies/           <- UNCHANGED (all Python strategy code)
├── Source Data/                  <- UNCHANGED (watchlists + downloaded JSON)
└── web/                          <- UNCHANGED (old dashboard still works on :8080)
```

---

## 52W tab — what's working

**Opportunity Scanner sub-tab:**
- Proximity pills: At 52W Low / Approaching / Near DMA / Far (with counts)
- Full table: Ticker, Status badge, Sector, Cap, Close, 52W Low, Dist%, 52W High, PE, 5yr avg PE
- Sorted nearest-to-low first; colour-coded green/amber/blue

**Stock Analysis sub-tab:**
- Left panel: stock list with sector/cap/search filters + coloured proximity dots
- Right panel:
  - 8 summary metric cards at top (CAGR 27.6%, Win Rate 100%, etc.)
  - 11 per-stock metric cards (trades, open pos, win rate, P/L, avg P/L, best trade, duration, close, PE)
  - TradingView chart: price (blue) + 52W High (purple dashed) + 200 DMA (green dotted) + 52W Low (orange dashed) + entry/exit markers
  - Open positions panel (amber border, target price, unrealised %)
  - Completed trade log table (entry/exit dates, prices, P/L%, net P/L, duration, exit reason)
- 5Y / 10Y horizon toggle

---

## What's next

Tabs to build (same pattern as 52W — copy components, new page, new API hooks):
1. **Envelope Strategy** — data already generated; needs frontend page
2. **S200 Rally** — data already generated; needs frontend page
3. **Portfolio Overview** — cross-strategy consolidated metrics + equity curves

Strategy improvements still pending (from prior session):
- Declining 52W filter
- 20-day MOMENTUM entry
- Multi-year floor for 52W low
- Time + loss stop-loss logic

---

## How to restart

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

Old dashboard still available at `http://localhost:8080` via:
```bash
python web/start_dashboard.py
```

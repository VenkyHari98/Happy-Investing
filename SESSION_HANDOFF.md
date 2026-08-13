# Session Handoff — Happy Investing

Written 2026-07-28, end of a long working session. Paste this file (or point a new
Claude Code session at it) to continue without re-deriving context. Read alongside
`CLAUDE.md` (project conventions) — this doc is session history, not a replacement
for it.

## What happened this session, in order

### 1. Paused backtest-heavy tabs (data/time cost reduction)
User wanted to stop the platform from doing expensive backtest/portfolio work while
focus stays on tuning the opportunity scanners.
- `frontend/src/lib/featureFlags.ts` → `BACKTEST_FEATURES_ENABLED = false`. When false,
  every strategy page (`/52w`, `/envelope`, `/s200`) shows only Scanner + Stock
  Analysis tabs — Portfolio Backtest / Trade Log / By Stock / Grid Search are hidden
  (code untouched, just not rendered, and their data queries are `enabled: false`).
- `PAUSE_PORTFOLIO_BACKTESTS = True` mirrored in `backend/api/routes/pipeline.py` and
  `web/start_dashboard.py` — the daily pipeline skips the 14-variant portfolio backtest
  sweep by default (`--skip-portfolio`), the heaviest step.
- **To fully re-enable later**: flip all three flags back (`featureFlags.ts`,
  `pipeline.py`, `start_dashboard.py`) — they're cross-referenced with comments
  pointing at each other.

### 2. Fundamental Must-Have gates — completed and audited (Phase 1)
Investigated `Scripts/strategies/fundamental_config.py` and found the Must-Have
checklist was ~80% already implemented but with real bugs and gaps:
- Fixed `f40_opportunity_scanner.py`'s 200-DMA gate ignoring `REQUIRE_BELOW_200DMA`.
- Fixed `backend/api/routes/fundamentals.py`'s `/metrics/{ticker}` endpoint — was
  looking up wrong dict keys, silently returned `None` for everything.
- Wired up **Public Shareholding %** gate (was declared, never enforced) via a new
  Screener.in-sourced helper.
- Built the **Asset-Growth (TFA) alt-pass** for the Profit-vs-ATH check (Tangible
  Fixed Assets = Net PPE − Intangibles, computed from yfinance balance sheet).
- Built a **new Must-Have gate**: fall-from-10-year-high by cap tier (Large ≥20%,
  Mid ≥34%, Small ≥60%) — didn't exist in code at all before, only in course notes.
  Bumped every scanner's OHLCV fetch from 2-3y to 10y to support this.
- **Coverage fix**: S200 and RHS/CWH scanners computed fundamentals only at a
  per-*stock* aggregate level, never attached to the individual opportunity rows the
  Scanner tabs render. Fixed — all 4 scanners now emit the identical `fund_*` field
  block per row.
- Frontend: `FundDetails.tsx` got 3 new metric tiles; `S200Scanner.tsx` and
  `RHSScanner.tsx` got the same expand-to-fundamentals UI `ScannerTab.tsx`/
  `EnvelopeScannerTab.tsx` already had.

### 3. Fundamentals data reliability — real bug found and fixed
User saw PGHH's fundamentals panel showing "—" everywhere with a green "All Pass"
badge. Diagnosis found **two unrelated root causes**:
- **The actual bug**: `Scripts/strategies/data_cache.py::get_fundamental_metrics()`
  cached a failed fetch (`None`) for a full ISO week with no retry — a transient
  yfinance rate-limit during the 200+-stock concurrent batch got frozen in for 4
  consecutive weekly cycles, affecting **~25% of the tracked universe**. Fixed: never
  trust or write a cached `None`; added a serial retry pass in
  `fetch_all_fundamentals_parallel()` for stragglers. Verified live — the corrupted
  `PGHH_fund_2026W31.pkl` self-healed on the very next call.
- **A real, separate gap**: Screener.in was never wired up at all — no
  `screener_credentials.json` existed, so pledged %/public shareholding % were `None`
  for every stock, always. Built the full pipeline: a pre-fetch pipeline step
  (non-fatal if creds missing — verified this by actually running it with no creds
  present, confirmed exit code 0), and wired Screener.in as a genuine **fallback**
  source for ROCE/ROE/Net D/E/Sales-Profit-ATH/OPM when yfinance is empty — merged at
  the fetch layer in `f40_backtest_common.py::fetch_fundamental_metrics()` so both
  scanners and any future backtest benefit uniformly. Also fixed a latent
  never-verified ordering assumption in the existing pledge/shareholding "latest
  value" extraction (`screener_cache.py` now parses period labels into real dates
  instead of trusting table column order).
- Frontend: consolidated 4 duplicated `getFundBadge()` copies into
  `frontend/src/lib/fundBadge.ts`; added a distinct amber **"No Data"** badge state
  (vs. green "All Pass") for stocks with zero verifiable fields — the exact PGHH
  scenario.
- **PENDING — user action required**: copy `screener_credentials.json.template` →
  `screener_credentials.json` at repo root, fill in real Screener.in login. Then run
  once manually: `python Scripts/strategies/screener_cache.py --watchlist "Source Data/Watchlist/F40.txt,Source Data/Watchlist/E40.txt,Source Data/Watchlist/S200.txt"`
  and spot-check one real `.store/screener/{TICKER}_screener.json` against the
  Screener.in website to confirm the period-label parsing is correct against real
  scraped HTML (only ever tested against synthetic data — Screener has never
  successfully fetched anything in this environment before now).

### 4. Bank/NBFC/Insurance-specific thresholds
Researched real ROE benchmarks (web search, sources logged in the old plan file
history) — private bank sector avg ~14%, NBFC quality bar cited ~18% but real
large-caps run 15-17% (their ROCE only ~9-11%, confirming ROCE is the wrong metric),
general insurance ~12.7-14.6%, life insurance structurally weakest (HDFC Life ~11-12%
called "reasonable"). Changed in `fundamental_config.py`:
- `MIN_ROE`: 15.0 → **12.0** for the whole Banks/NBFC/Insurance bucket.
- New `MIN_TTM_NET_PROFIT_CR_FINANCIAL = 1000.0` (vs ₹250 Cr generic) — compensates
  for Net D/E being skipped for this sector, matches the course's own S200-building
  methodology.
- Verified live against SBIN (ROE 14% now passes, was failing) and HDFCBANK (ROE 8.8%
  still correctly fails — not a rubber stamp).
- **Deferred, not built**: VNB Margin (Value of New Business ÷ APE) is the *correct*
  metric for life insurers specifically (not ROE, not operating margin — Ind AS
  reserving makes conventional margins misleading). Confirmed via research but it
  needs a data source that doesn't exist anywhere (not yfinance, not Screener.in
  standard tables — insurers disclose it separately in embedded-value investor
  decks). Needs its own future plan once/if a data source is found.
- **Noted, not fixed**: the TFA-vs-ATH alt-pass isn't explicitly skipped for
  financials the way OPM/Net D/E are. Judged low-risk (yfinance rarely returns a
  meaningful TFA for a lender's balance sheet anyway) — flagged for later, not acted on.

### 5. Support & Resistance — new strategy, scanner-only v1
Never built before (confirmed via full codebase search). Course notes describe it as
purely visual ("no indicator, zoom out and eyeball it") — same starting point RHS/CWH
had before being turned into precise geometric rules. Built the same kind of
translation:
- New file `Scripts/strategies/support_resistance_scanner.py` — swing-point detection
  (local extrema, tuned window/depth thresholds) → clustering into support/resistance
  zones (±2% tolerance) → touch counting (≥2 touches = valid zone, matches the
  "bus analogy": 2 prior touches + the current approach = the 3rd-time entry signal)
  → paired to the nearest *validated* resistance zone above.
- **Caught a real bug via synthetic testing before it ever touched production data**:
  the zone-pairing logic initially picked a spurious 1-touch "resistance" a hair above
  support instead of the genuine multi-touch ceiling. Fixed by requiring paired
  resistance candidates to themselves have ≥2 touches.
- Full end-to-end wiring: pipeline step in `web/start_dashboard.py`, backend route
  `backend/api/routes/support_resistance.py` (+ cache key + `main.py` registration),
  frontend types/`SRScanner.tsx`/`/sr` page/sidebar nav, and a `toUnifiedSR` mapper so
  it shows up in the combined Multi-Strategy Scanner (`/scanner`) too.
- **Verified at full production scale**: ran against all 440 real F40+E40+S200 stocks
  — clean run, sensible status spread (90 IN_ZONE / 150 WATCHING / 197 ABOVE_DMA),
  fundamental gates fully populated on every row, only 2 unrelated data-availability
  errors (delisted/renamed tickers).
- **Explicitly deferred to a follow-up plan**: backtest engine, portfolio-level
  simulation, walk-forward (rolling 5yr) zone re-detection (v1 uses static detection —
  detect once, simulate forward, matching RHS/CWH's existing convention), the full
  A/B/C/D ABCD ladder (v1 shows only an informational -10% reference price, no
  simulated execution), the "two red candles near resistance" early-exit heuristic
  (discretionary in the notes, not mechanically coded anywhere else either).
- **PENDING — user action required, explicitly called out as important**: this
  strategy is inherently visual. Pick 2-3 known F40/E40 stocks, pull up real
  TradingView charts, and manually compare the detected support/resistance zones
  against what you'd draw by eye. That's the actual test of whether the
  tolerance/window parameters are reasonable — code running without errors only
  proves the algorithm executes, not that it's *right*.
- **One observed edge case, not fixed**: HDFCBANK's detected support (725.2) and
  paired resistance (739.6) came out only ~2% apart — a real range, but thin enough
  that the "opportunity" barely has upside. Possible future refinement: a minimum
  zone-separation width so paper-thin ranges don't surface as if they were meaningful
  setups.

## Full pending / backlog list (as of end of session)

**User actions required (blocking, not code):**
1. Add real `screener_credentials.json` (from the `.template`) — unblocks the entire
   Screener.in fallback pipeline built in item 3 above.
2. Visually validate Support & Resistance zone detection against real charts for a
   few known stocks (item 5 above) before trusting it or building a backtest on top.

**Deferred feature work (code, no user input needed to start):**
3. Fundamentals "Good-to-Have" scoring (Phase 2, never started): PE vs 10yr median,
   Market Cap/Sales below median, EV/EBITDA below median, 1yr/3yr price-CAGR-vs-
   profit-CAGR, Book Value/Price-to-Book (Screener already scrapes `book_value`/
   `price_to_book`, never wired anywhere), and a combined technical+fundamental
   "opportunity score"/ranking (the "blue moon" surfacing the user originally asked
   about — deliberately not built until Must-Have data was verified correct first).
4. WATCHOUT flags in `fundamental_config.py` (`WARN_RISING_INTEREST`,
   `WARN_EXCEPTIONAL_INCOME_PCT`, `WARN_ANOMALOUS_TAX_RATE`, `WARN_BELOW_BOOK_VALUE`)
   — declared, never implemented, still dead config.
5. VNB Margin for life insurers — needs a new data source, not scoped yet.
6. Support & Resistance backtest + portfolio-level simulation (separate follow-up
   plan per the approved scope).
7. `yfinance` version drift: `requirements.txt`/`backend/requirements.txt` pin
   `0.2.58`, installed version is `1.3.0`. Flagged as a *possible* contributing factor
   to the batch-fetch failures fixed in item 3, never actually investigated or
   resolved — worth a dedicated look with its own testing pass, not a quick fix.

**Pre-existing, not introduced this session (flagged twice during work, never fixed
since out of scope both times):**
8. `react-hooks/static-components` ESLint error in `frontend/src/components/rhs/
   RHSScanner.tsx` (a `SortArrow` component defined inside another component's render
   body) and the identical pattern (`Th` component) in
   `frontend/src/app/scanner/page.tsx`. Cosmetic/lint-only, not a runtime bug.

**Unverified — surfaced from long-term memory, not re-checked this session:**
9. Memory index (`MEMORY.md`) references a "Data Pipeline Optimization Plan" — 3-layer
   cache plan, noted as "`cache.py` done, 10 files still pending." This predates the
   current session entirely; re-verify its actual status before assuming it's still
   accurate (things may have moved since that memory was written).

## Key file map (most-touched this session)
- `Scripts/strategies/fundamental_config.py` — all Must-Have gate config/logic
- `Scripts/strategies/f40_backtest_common.py` — shared fetch/utility functions
  (`fetch_fundamental_metrics`, `compute_fall_from_high`, Screener merge logic)
- `Scripts/strategies/screener_cache.py` — Screener.in scraper/cache
- `Scripts/strategies/support_resistance_scanner.py` — new strategy engine
- `Scripts/strategies/{f40_opportunity_scanner,s200_20pct_rally_scanner,
  f40_backtest_rhs_cwh}.py` — the 3 existing live scanners, all touched
- `backend/api/routes/{fundamentals,pipeline,support_resistance}.py`
- `web/start_dashboard.py` — pipeline orchestration, all skip flags
- `frontend/src/lib/{types,fundBadge,featureFlags,api}.ts`
- `frontend/src/components/shared/FundDetails.tsx`
- `frontend/src/app/scanner/page.tsx` — combined cross-strategy view

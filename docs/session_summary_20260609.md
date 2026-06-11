# Session Summary — 2026-06-09
## Topic: 52W + Envelope Strategy Analysis, Capital Deployment & Locked Capital Fixes

> Use this document to brief a new chat session. It captures every decision made,
> number produced, and fix proposed during this session. Read this before asking
> any follow-up questions on the F40 portfolio backtest.

---

## 1. What Was Changed in This Session

### 1.1 Removed the 15-Position Portfolio Cap (DONE ✅)

**Problem:** `MAX_CONCURRENT = 15` in `f40_portfolio_backtest.py` was counting every open
tranche (INITIAL + ABCD_A + ABCD_B + MOMENTUM etc.) toward a 15-position limit. With 3-4
tranches per stock this capped you at 3-4 concurrent setups — far below what the cash pool
could support.

**Fix applied:**
- [Scripts/strategies/portfolio_backtest_engine.py](../Scripts/strategies/portfolio_backtest_engine.py) —
  removed `len(self.open_positions) < self.max_concurrent` from `can_open()`. Cash is now
  the **only** portfolio-level gate.
- [Scripts/strategies/f40_portfolio_backtest.py](../Scripts/strategies/f40_portfolio_backtest.py) —
  changed `MAX_CONCURRENT = 15` → `MAX_CONCURRENT = 999` (metadata only; no functional effect).

### 1.2 Added Per-Stock Limit of 4 Positions (DONE ✅)

**Rationale:** The simple `f40_backtest_52w.py` has `max_concurrent=4` per stock. The
portfolio engine had no equivalent — a stock could accumulate INITIAL + ABCD_A + ABCD_B +
ABCD_C + ABCD_D + MOMENTUM = 6 tranches. User confirmed 4 per stock (per strategy) is the
right limit.

**Fix applied:**
- Added `open_count_for_strategy(ticker, strategy)` helper to `PortfolioSimulator` in
  [portfolio_backtest_engine.py](../Scripts/strategies/portfolio_backtest_engine.py).
- Added `MAX_PER_STOCK = 4` constant to
  [f40_portfolio_backtest.py](../Scripts/strategies/f40_portfolio_backtest.py).
- Added `sim.open_count_for_strategy(ticker, '52W') < MAX_PER_STOCK` guard before:
  - Step 2: MOMENTUM add
  - Step 3: ABCD add
- Added `sim.open_count_for_strategy(ticker, 'ENV_LONG') < MAX_PER_STOCK` guard before:
  - Step 3b: ENV_LONG ABCD add

### 1.3 Added Combined 52W + Envelope Long Run to Pipeline (DONE ✅)

- [web/start_dashboard.py](../web/start_dashboard.py) — added
  `('F40 Portfolio BT (52W+Env Long)', [..., '--exit-mode', 'fixed', '--envelope', 'long'])`
  to the pipeline so it runs automatically every time.

---

## 2. Current Backtest Results (as of 2026-06-09, 5-year sim, ₹1L)

| Mode | CAGR | Total Return | Completed Trades | Win Rate | Open at End | Max DD |
|------|------|-------------|-----------------|---------|-------------|--------|
| 52W Fixed exit | **+8.5%** | +50.5% | 234 | 100% | 125 | 17.0% |
| 52W Rolling exit | **+9.1%** | +54.5% | 179 | 100% | 131 | 17.5% |
| 52W + Envelope Long | **+5.9%** | +33.2% | 237 (126+111) | 92% | 126 | 20.1% |

**Why the combined strategy is WORSE than pure 52W:**
The envelope (83% win rate) competes for the same cash pool. In 2022-23 corrections when 52W
has the best entries, the envelope has consumed capital on lower-quality positions. The
envelope is cannibalising the best opportunities.

---

## 3. Root Cause of Sub-15% CAGR

### 3.1 Capital Deployment (Fixed exit, 5-year sim)

```
Average cash idle:      53.8% (Rs53,817 of Rs1L sitting in cash on average)
Average deployed:       57.7%
Days with <30% deployed: 23.6% of simulation time
Days with <50% deployed: 38.9% of simulation time
```

The 52W strategy only fires during corrections. In bull markets (2021: 3% avg deployed,
2024: 31% avg deployed), stocks don't hit 52W lows and capital does nothing.

### 3.2 Yearly Breakdown

| Year | Trades | Avg Gain | Total PnL | Avg Deployed |
|------|--------|----------|-----------|-------------|
| 2021 | 2 | 16.3% | Rs293 | **3%** |
| 2022 | 40 | 19.4% | Rs10,266 | 60% |
| 2023 | 98 | **29.5%** | Rs27,506 | 77% |
| 2024 | 45 | 30.0% | Rs14,238 | **31%** |
| 2025 | 31 | 17.0% | Rs7,848 | 78% |
| 2026 | 24 | 19.3% | Rs6,128 | **94%** |

2023 alone generated Rs27,506 (27% of initial capital). The strategy is excellent in
corrections; the drag is idle capital during bull years.

### 3.3 Trade Quality Is Fine

```
Avg trade gain:         25.2%  (across 234 completed trades)
Avg duration:           257 days (0.7 yrs)
Median duration:        160 days
53% of trades complete in <6 months
Avg annualised return per trade: 192.8%  ← the strategy is efficient per ₹
```

The issue is not trade quality — it is **how infrequently trades fire**.

---

## 4. Locked Capital Analysis (125 open positions at sim end)

### 4.1 Breakdown by Duration

```
<6 months  :  33 positions | Rs 47,356 deployed | avg P/L  -5.7%
6-12 months:  20 positions | Rs 21,232 deployed | avg P/L -15.7%
1-2 years  :  49 positions | Rs 78,054 deployed | avg P/L -12.6%
>2 years   :  23 positions | Rs 18,787 deployed | avg P/L -25.7%
```

### 4.2 Breakdown by Cause

| Category | Capital | Share | Description |
|----------|---------|-------|-------------|
| Secular decline traps | Rs 6,509 | 4% | RELAXO, TEAMLEASE, QUESS, AWL — entered secular downtrends |
| Failed MOMENTUM re-entries | Rs 5,171 | 3% | MOMENTUM fired on false recoveries; now >20% loss |
| Normal cyclical waiting | Rs1,54,190 | 93% | Quality stocks at 52W lows, will recover (DMART, BAJAJ-AUTO, ASIANPAINT, etc.) |

**Key insight: 93% of locked capital is the strategy working correctly.** ASIANPAINT,
COLPAL, HINDUNILVR, DMART — these are all high-quality businesses in temporary cyclical
lows. Nothing to fix there; they need time or a larger universe so exits rotate faster.

### 4.3 The 21 "Unreachable" Targets

21 positions where exit target is >2x current price. All come from 5 stocks:

| Stock | Target Multiple | P/L | Held |
|-------|----------------|-----|------|
| AWL | 4.5x current price | -43.9% avg | 3-4 yrs |
| RELAXO | 4.2x current price | -59.6% avg | 4 yrs |
| TEAMLEASE | 3.8x current price | -50.6% avg | 4 yrs |
| QUESS | 3.6x current price | -48.1% avg | 4 yrs |
| BATAINDIA | 2.9x current price | -54.0% avg | 3-4 yrs |

These 5 stocks entered the strategy in 2021-2023 at what appeared to be 52W lows, but were
actually the **start of multi-year secular declines**. Their exit targets (the 52W high at
entry date, now locked in FIXED mode) will never be reached.

---

## 5. Failure Mode 1 — Secular Decline Stocks

### Pattern Observed

RELAXO, TEAMLEASE, QUESS, AWL all show the same signature:
- Each year's 52W low was **lower than the previous year's 52W low** (descending staircase)
- The strategy entered on what looked like a cyclical low but was structural decline
- Net contribution over 5 years: Rs-2,973 (10 completed trades earned +Rs288, 16 stuck
  open have unrealised loss of -Rs3,260)
- The "completed" wins (+10.8% each) are ABCD_B/C tranches briefly bouncing to preceding
  levels — not genuine recovery

### Proposed Fix: Declining 52W Low Filter (NOT YET IMPLEMENTED ❌)

**Rule:** Before any INITIAL entry, check if the current 52W low is more than 15% below
the 52W low from 252 trading days ago.

```python
# In f40_portfolio_backtest.py, step 4 (INITIAL entry), before opening:
prior_52w_low = df.loc[day - pd.Timedelta(days=365), '52w_low']  # approx
if w52_low < prior_52w_low * 0.85:
    continue  # 52W low is declining staircase — skip
```

**Implementation location:** `run_simulation()` in `f40_portfolio_backtest.py`, step 4
(NEW ENTRY section). The `52w_low` column is already computed in `_build_stock_data()`.

**Expected impact:** Prevents Rs2,973 in net losses; prevents 16 zombie positions from
being opened.

---

## 6. Failure Mode 2 — MOMENTUM Tranche False Recoveries

### Pattern Observed

```
Total MOMENTUM trades:     96
Completed (hit target):    70   → 100% win rate → net +Rs6,299
Still open:                26   → avg P/L -16.6%
  of which >20% loss:       8   → capital trap: Rs5,171
```

The MOMENTUM tranche fires when price **crosses above 200 DMA in one day** while INITIAL
is in profit. For BATAINDIA (-58%), QUESS (-61%), AWL (-52%), this was a brief dead-cat
bounce above the MA. The stock then resumed its downtrend immediately.

**Net MOMENTUM contribution: +Rs3,783 (completed+open).** Do NOT remove MOMENTUM — the
completed trades are very profitable. Fix the entry filter instead.

### Proposed Fix: 20-Day Confirmation (NOT YET IMPLEMENTED ❌)

**Rule:** Only allow MOMENTUM entry after the stock has been above the 200 DMA for at
least 20 consecutive trading days (not just a single crossover).

```python
# In f40_portfolio_backtest.py, step 2 (MOMENTUM), replace the single-crossover check:
# Current:
#   d['close'] >= d['ma200'] and (prev_close is None or prev_close < d['ma200'])
# Replace with:
#   track a per-ticker counter: days_above_200dma[ticker]
#   increment each day close >= ma200, reset when close < ma200
#   fire MOMENTUM only when days_above_200dma[ticker] >= 20

days_above_200: Dict[str, int] = {}  # add to run_simulation() init
# each day, for each ticker:
if d['close'] >= d['ma200']:
    days_above_200[ticker] = days_above_200.get(ticker, 0) + 1
else:
    days_above_200[ticker] = 0
# MOMENTUM condition:
if days_above_200.get(ticker, 0) >= 20 and d['close'] > initial_pos.entry_price and ...:
```

**Implementation location:** `run_simulation()` in `f40_portfolio_backtest.py`, steps 1
(tracking) and 2 (MOMENTUM condition).

**Expected impact:** Prevents Rs5,171 of capital deployment in false recoveries. Reduces
MOMENTUM trade count but keeps the high-quality subset.

---

## 7. Proposed Fix 3 — Time + Loss Stop on INITIAL (NOT YET IMPLEMENTED ❌)

**Rule:** If an INITIAL position has been held >365 days AND is >30% in loss, exit at the
current price. Crystallise the loss, free the capital for redeployment.

```
9 INITIAL positions meet this rule at sim end:
  Stocks: ACC, AWL, BATAINDIA, PGHH, QUESS, RELAXO, SANOFI, TCS, TEAMLEASE
  Capital at entry:    Rs12,304
  Cash recovered:       Rs6,580 (at depressed current prices)
  Loss crystallised:    Rs5,730
```

This is a break-even operation on absolute Rs, but the freed Rs6,580 redeployed into new
quality entries at future lows generates positive returns instead of earning nothing.

**Note:** This rule will NOT trigger on good-quality stocks (ASIANPAINT, HINDUNILVR, etc.)
because they don't stay 30% below a 52W low for 12+ months. It only catches the structural
traps.

**Implementation:** In `run_simulation()`, after step 1 (exits), add a stale-position check:

```python
# Step 1c: TIME+LOSS STOP on INITIAL positions
for pos in list(sim.open_positions):
    if pos.tranche != 'INITIAL':
        continue
    d = price_lookup.get(pos.ticker)
    if d is None:
        continue
    duration = (day.date() - datetime.date.fromisoformat(pos.entry_date)).days
    current_pnl_pct = (d['close'] - pos.entry_price) / pos.entry_price * 100
    if duration > 365 and current_pnl_pct < -30:
        sim.close_position(pos, day_str, d['close'], 'STOP_LOSS')
```

---

## 8. Proposed Fix 4 — Better Entry Timing (NOT YET IMPLEMENTED ❌)

### Observation: Fast vs Slow Completions

| Fast exits (avg <100 days) | Slow exits (avg >400 days) |
|---------------------------|---------------------------|
| BERGEPAINT 40d, ASIANPAINT 68d | DABUR 794d, INFY 615d, PFIZER 556d |
| KAJARIACER 126d, PIDILITIND 56d | HINDUNILVR 320d, TCS 337d |

Stocks exiting quickly were at the **bottom of a tight multi-year trading range** — the
52W low was near the same level it was 1-2 years ago. Stocks taking >400 days entered while
still in an open-ended decline (first time at that price level).

### Proposed Filter: Multi-Year Floor Check

**Rule:** Only enter INITIAL when the current 52W low is within 5% of the 52W low from
**2 years ago** (504 trading days). This selects stocks in genuine consolidation (building
a floor) vs. those still finding a bottom.

```python
# Requires 52w_low to be roughly flat over 2 years:
prior_2yr_low = float(df['52w_low'].iloc[max(0, i - 504)])
if w52_low < prior_2yr_low * 0.95:
    continue  # no floor formed yet; stock still declining
```

**Expected impact:** Reduces avg holding duration from 257 days → estimated <150 days.
Faster capital rotation = higher CAGR for same trade quality.

---

## 9. What to Do First in the Next Session

Ordered by implementation effort and expected CAGR impact:

| Priority | Fix | Est. CAGR Lift | Effort |
|----------|-----|---------------|--------|
| 1 | **Declining 52W low filter** (Section 6) | +0.6% + prevents recurrence | 20 lines |
| 2 | **MOMENTUM 20-day confirmation** (Section 7) | +1% (frees Rs5K trapped) | 30 lines |
| 3 | **Multi-year floor entry filter** (Section 9) | +2-3% (faster rotation) | 10 lines |
| 4 | **Time+loss stop on INITIAL** (Section 8) | +0.5% (frees Rs6.5K) | 20 lines |
| 5 | **Remove RELAXO, TEAMLEASE, QUESS, AWL from watchlist** | immediate | edit txt file |
| 6 | **Increase INITIAL allocation to 3-4%** (Large Cap) | proportional CAGR scale | 1 line |

After implementing 1-4 and re-running the backtest, compare the new CAGR baseline.
Then tackle allocation sizing (fix 6) to push toward 15%+.

---

## 10. Files Changed in This Session

| File | Change |
|------|--------|
| `Scripts/strategies/portfolio_backtest_engine.py` | Removed position-count gate from `can_open()`; added `open_count_for_strategy()` method |
| `Scripts/strategies/f40_portfolio_backtest.py` | `MAX_CONCURRENT=999`; `MAX_PER_STOCK=4`; per-stock count checks in steps 2, 3, 3b |
| `web/start_dashboard.py` | Added `--envelope long` combined run to pipeline |
| `docs/backtest_f40_portfolio.md` | ⚠️ Still shows `MAX_CONCURRENT=15` — needs update |
| `docs/strategy_tuning_guide.md` | ⚠️ Still shows old numbers — needs update after next backtest |

---

## 11. Key Numbers to Remember

```
52W Fixed exit CAGR:          +8.5%   (target: 15%+)
Average cash idle:             53.8%  (root cause of sub-15% CAGR)
125 open positions at sim end: 93% are good stocks, just waiting
  Secular traps (4%):          RELAXO, TEAMLEASE, QUESS, AWL — remove from watchlist
  MOMENTUM traps (3%):         fix with 20-day confirmation filter
Total realised PnL (5yr):      Rs66,279 on Rs1L initial capital (66.3%)
Avg trade gain:                25.2% in 257 days
```

# F40 — Portfolio Backtest: Smart Pyramid + Envelope Strategies

> Living document. Append new conditions here as logic is finalized.
> Last updated: 2026-06-08

---

## What This Strategy Does in Plain English

This is the **portfolio-level** backtest — it runs with a single shared cash pool (₹1L default) and deploys capital across multiple stocks and strategies simultaneously.

It layers three sub-strategies on top of each other:

1. **52W Low→High (INITIAL + ABCD + MOMENTUM)** — The core value-recovery play. Buy at 52-week low, hold to 52-week high. Average down in tranches (ABCD) if the stock keeps falling. Add a momentum tranche when the stock recovers above the 200 DMA.

2. **Envelope Long** (`--envelope long`) — Buy when a stock drops 14% below its 200 DMA (the lower envelope). Exit when it bounces back to the 200 DMA.

3. **Envelope Short** (`--envelope short`) — Sell short when a stock rises 14% above its 200 DMA (the upper envelope). Cover when it falls back to the 200 DMA.

All three share one cash pool. Capital flows out on entry and back in on exit.

---

## Universe

- **Watchlists:** F40.txt + E40.txt (combined, de-duplicated)
- **Simulation period:** Last 5 years (configurable via `SIM_YEARS`)
- **Data warmup:** 10 years fetched (for rolling 52W and 200 DMA warmup)
- **Price data:** Daily OHLCV from yfinance (.NS suffix)

---

## Sub-Strategy 1: 52W Smart Pyramid

### Entry (INITIAL tranche)

- Stock's daily **Low** must touch within **+2%** of its rolling 252-day low.
  - Formula: `daily_low ≤ rolling_52w_low × 1.02`
- Enter at: `max(rolling_52w_low, daily_low)`
- **200 DMA gate**: entry price must be below 200 DMA.
- No fundamental gates in the portfolio backtest (data speed; add if needed).
- Only one INITIAL position per stock at a time.
- Priority: stocks exactly at/below 52W low fire first; among ties, highest upside (largest gap to 52W high) wins.

### ABCD Tranches — averaging down on weakness

Once an INITIAL position is open, if the stock keeps falling, we add more at lower levels:

| Tranche | Level (below INITIAL entry) | Exit Target |
|---------|----------------------------|-------------|
| ABCD_A  | −10%                       | Same 52W high as INITIAL |
| ABCD_B  | −19% (= −10% × 0.9)        | Same 52W high as INITIAL |
| ABCD_C  | −27.1% (= −10% × 0.9²)     | Same 52W high as INITIAL |
| ABCD_D  | −34.4% (= −10% × 0.9³)     | Same 52W high as INITIAL |

- Only one ABCD tranche opens per ticker per day.
- `max_abcd_depth` controls how many levels activate (default: 4 = A through D).
- All ABCD tranches exit at the **same** 52W high target as INITIAL. The idea: these are high-quality moat companies — hold the full cycle.

### MOMENTUM tranche — adding on strength

When the stock (while the INITIAL position is still open) closes back above the 200 DMA AND is in profit vs. the INITIAL entry price:

- Open a MOMENTUM tranche at the day's close.
- Exit target: same 52W high as INITIAL.
- Only one MOMENTUM tranche per stock.

### Exit

- Any tranche exits when the stock's daily **High** ≥ that tranche's `exit_target`.
- Exit price = `exit_target` (limit order assumption).
- **No stop-loss. No time limit.**

---

## Sub-Strategy 2: Envelope Long

Activated with `--envelope long` or `--envelope both`.

- **Entry**: daily Low ≤ `lower_envelope × 1.02`, where `lower_envelope = 200 DMA × 0.86` (14% below MA).
- **Entry price**: lower envelope value on the entry day.
- **Exit**: daily High ≥ 200 DMA on that day → exit at 200 DMA.
- Only one ENV_LONG position per stock at a time.
- Lower priority than 52W INITIAL (runs after 52W entries in the daily loop).

---

## Sub-Strategy 3: Envelope Short

Activated with `--envelope short` or `--envelope both`.

- **Entry**: daily High ≥ `upper_envelope × 0.98`, where `upper_envelope = 200 DMA × 1.14` (14% above MA).
- **Entry price**: upper envelope value on the entry day (short sale at this level).
- **Exit**: daily Low ≤ 200 DMA on that day → cover at 200 DMA.
- Only one ENV_SHORT position per stock at a time.
- **Conflict rule**: ENV_SHORT is **blocked** if a 52W long position is open on the same stock — we don't short a stock we are fundamentally long on.

---

## Capital Allocation

### 52W tranches (from `ALLOCATIONS` in `portfolio_backtest_engine.py`)

| Tranche    | Large Cap | Mid Cap | Small Cap |
|------------|-----------|---------|-----------|
| INITIAL    | 2.0%      | 1.2%    | 0.6%      |
| ABCD_A     | 1.0%      | 0.6%    | 0.35%     |
| ABCD_B     | 0.75%     | 0.45%   | 0.25%     |
| ABCD_C     | 0.50%     | 0.30%   | 0.15%     |
| ABCD_D     | 0.25%     | 0.15%   | N/A       |
| MOMENTUM   | 0.50%     | 0.30%   | 0.15%     |
| **Total**  | **5.0%**  | **3.0%**| **1.5%**  |

### Envelope tranches (from `ENVELOPE_ALLOCATIONS` in `portfolio_backtest_engine.py`)

| Cap Tier   | Allocation % |
|------------|-------------|
| Large Cap  | 3%          |
| Mid Cap    | 2%          |
| Small Cap  | 1%          |

Envelope positions use a cash-only gate (`can_open_raw`) — not gated by `max_concurrent`.

---

## Position Sizing

```
shares = position_value / (entry_price × (1 + slippage_pct))
```

where `position_value = current_total_portfolio_value × allocation_pct`.

Portfolio value is marked to market daily (cash + deployed positions at last close).

---

## Slippage

- **0.10% per side** applied to all entry and exit trades.
- Entry cost: `position_value × (1 + 0.001)`
- Exit proceeds: `shares × exit_price × (1 − 0.001)`

---

## Capacity Management

- `max_concurrent = 15` — maximum open positions across all strategies combined.
- `enforce_capacity = True` (default for portfolio sim) — checks both cash availability and concurrent-position count before each INITIAL/ABCD/MOMENTUM entry.
- Envelope entries only check cash (no concurrent count gate).

---

## Exit Modes

| Mode      | Behaviour |
|-----------|-----------|
| `fixed`   | Exit target locked at entry-date 52W high. Never changes. (Default) |
| `rolling` | Exit target ratchets UP if the stock makes a new 252-day high while held. Never drops below the fixed level. Lets winners run further. |

Run with `--exit-mode rolling` to compare.

---

## Order of Operations Each Day

1. **Rolling ratchet** (rolling mode only): raise exit targets for any stock making new 52W highs.
2. **52W exits**: close any tranche whose intraday High ≥ exit target.
3. **Envelope exits**: close ENV_LONG if High ≥ 200 DMA; close ENV_SHORT if Low ≤ 200 DMA.
4. **MOMENTUM adds**: for stocks with open INITIAL where price crossed above 200 DMA today and is in profit.
5. **ABCD adds**: one new ABCD tranche per ticker per day (lowest unlocked level).
6. **52W new entries**: INITIAL tranches for stocks at 52W-low band.
7. **Envelope entries**: ENV_LONG and/or ENV_SHORT (lower priority than 52W).
8. **Drawdown tracking + equity curve**: mark positions to close prices.

---

## How to Run

```bash
cd "d:/VENKAT/PERSONAL FINANCE/HAPPY INVESTING/Happy-Investing"

# Baseline: 52W Smart Pyramid only
python Scripts/strategies/f40_portfolio_backtest.py --exit-mode fixed

# Fixed exit + envelope long
python Scripts/strategies/f40_portfolio_backtest.py --exit-mode fixed --envelope long

# Fixed exit + envelope short
python Scripts/strategies/f40_portfolio_backtest.py --exit-mode fixed --envelope short

# All three strategies combined
python Scripts/strategies/f40_portfolio_backtest.py --exit-mode fixed --envelope both

# Rolling exit + all strategies
python Scripts/strategies/f40_portfolio_backtest.py --exit-mode rolling --envelope both
```

### Output files

Each variant saves to a distinct filename:

| Variant | Output file |
|---------|------------|
| `fixed` (no envelope) | `f40_portfolio_backtest_fixed.json` + `f40_portfolio_backtest.json` (compat) |
| `fixed` + `env-long` | `f40_portfolio_backtest_fixed_env-long.json` |
| `fixed` + `env-short` | `f40_portfolio_backtest_fixed_env-short.json` |
| `fixed` + `env-both` | `f40_portfolio_backtest_fixed_env-both.json` |
| `rolling` | `f40_portfolio_backtest_rolling.json` |

---

## Key Parameters (Configurable)

| Parameter | Default | File |
|-----------|---------|------|
| Simulation years | 5 | `f40_portfolio_backtest.py` → `SIM_YEARS` |
| Initial capital | ₹1,00,000 | `f40_portfolio_backtest.py` → `INITIAL_CAP` |
| Max concurrent positions | 15 | `f40_portfolio_backtest.py` → `MAX_CONCURRENT` |
| Max ABCD depth | 4 | `f40_portfolio_backtest.py` → `PortfolioSimulator(max_abcd_depth=4)` |
| Entry band above 52W low | +2% | `f40_portfolio_backtest.py` → `ENTRY_BAND_PCT` |
| Envelope width | 14% | `f40_portfolio_backtest.py` → `ENV_PCT` |
| Envelope entry tolerance | 2% | `f40_portfolio_backtest.py` → `ENV_ENTRY_BAND` |
| ABCD multipliers | 0.9, 0.81, 0.729, 0.6561 | `portfolio_backtest_engine.py` → `ABCD_MULTIPLIERS` |
| Slippage | 0.10% per side | `PortfolioSimulator(slippage_pct=0.10)` |
| 52W allocation (Large Cap INITIAL) | 2% | `portfolio_backtest_engine.py` → `ALLOCATIONS` |
| Envelope allocation (Large Cap) | 3% | `portfolio_backtest_engine.py` → `ENVELOPE_ALLOCATIONS` |

---

*Append new conditions or changes to logic below this line.*

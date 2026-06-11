# S200 — 20% Rally Portfolio Backtest (Logic)

> Living document. Append new conditions here as logic is finalized.
> Last updated: 2026-06-07

---

## What This Strategy Does in Plain English

We scan all stocks across three watchlists and find historical instances where a stock had a strong, uninterrupted upward move — a "rally" of 20% or more made up of consecutive green candles.

Once a rally is found, we record:
- **Where to buy**: the low of the first green candle (the base of the move)
- **Where to sell**: the high of the last green candle (the top of the move)

When the stock later falls back down to the buy level, we buy it.
If it keeps falling, we add more (Smart Pyramid / ABCD averaging).
When it bounces back up through a key level, the relevant tranche exits.
All entries for a given rally are valid for **1 year** from the last candle date.

---

## Universe

- **Watchlists used:** All three — F40.txt (~40 stocks), E40.txt (~39 stocks), S200.txt (~419 stocks)
- If a stock appears in more than one list, it's deduplicated (counted once; first list takes priority: F40 > E40 > S200).
- **Total universe:** approximately 460+ unique stocks
- **Simulation period:** Last **5 years** (today minus 5 years to today)
- **Data downloaded:** Last **10 years** (extra 5 years used to find rallies that predate the simulation start)
- **Price data used:** Daily OHLCV from yfinance

---

## Step 1: Rally Detection (Pre-Computation)

Before the simulation starts, we scan all 10 years of price data to find every 20%+ rally.

### What counts as a valid rally?

- A rally is a **consecutive sequence of green candles** — each day's close must be higher than the previous day's close.
- The total move from the **low of the first candle** to the **high of the last candle** must be **≥ 20%**.
- No minimum or maximum number of candles required.

### What do we extract from each rally?

- **buy_price** = Low of the first green candle in the rally (the base)
- **sell_price** = High of the last green candle in the rally (the top)
- **rally_end_date** = Date of the last green candle

### How long is a rally "active" for trading?

- We can only buy into a rally within **1 year** of the rally_end_date.
  - Active window: `rally_end_date < today ≤ rally_end_date + 365 days`
- After 1 year, the rally expires and is no longer considered.

---

## Step 2: Buy Zone

- We don't wait for the stock to fall exactly to buy_price. We define a **buy zone**:
  - Buy zone upper limit = `buy_price × 1.0075` (i.e., within 0.75% above buy_price)
- If the stock's daily Low drops into the buy zone (≤ upper limit of zone), an entry is triggered.
- Fill price: if the stock went all the way to buy_price (Low ≤ buy_price), we assume we filled at buy_price. Otherwise we fill at the daily Low.

---

## Entry — When Do We Buy the INITIAL Tranche?

Every day of the simulation, for each active rally on each stock, we check if we can open an initial position. All conditions must pass:

### Condition 1: Rally must be active today
- `rally_end_date < today ≤ rally_end_date + 365 days`
- We must not already have an INITIAL position for this specific (stock, rally) combination.

### Condition 2: Price must enter the buy zone
- `daily_low ≤ buy_price × 1.0075`

### Condition 3 (Gate 1): Buy price must be below the 200-day moving average
- On the day of entry, the buy_price must be **below** the stock's current 200 DMA.
- This ensures we're buying in a stock that is in a downtrend relative to its medium-term average — not one that has already recovered.

### Condition 4 (Gate 2): PE ratio must be below 70
- Historical daily PE at the entry date must be **< 70**.
- If PE data is unavailable, this gate is skipped.

### Condition 5 (Gate 3): PE must be below the 5-year rolling median PE
- PE at entry must be below the stock's own 5-year rolling median PE (using only past data).
- If PE data is unavailable, this gate is skipped.

### Condition 6 (Gate 4): Phase 2 — Fundamental quality check
All checks use only data available at the entry date. If data is missing, the check is silently skipped.

#### Section 3: Balance Sheet Quality

**A. Market Cap > ₹3,000 Cr**
- Universe filter using current market cap.

**B. Net Debt / Equity < 0.25 (non-financial companies)**
- Net Debt = Long-term Debt + Short-term Debt − Cash
- Skipped for banks, NBFCs, insurance companies.

**C. ROCE ≥ 15% (non-financial) or ROE ≥ 15% (financial)**
- ROCE = Operating Income / (Total Assets − Current Liabilities) × 100
- ROE = Net Income / Shareholders' Equity × 100 (used for financial sector)

**D. TTM Net Profit > ₹250 Cr**
- Must be profitable at meaningful scale.

#### Section 5: Business Quality

**E. Sales vs All-Time High ≥ 90%**
- Revenue at entry date must be ≥ 90% of peak historical revenue.

**F. Net Profit vs All-Time High ≥ 90%**
- Profit at entry date must be ≥ 90% of peak historical profit (when positive).

**G. OPM must not be declining (non-financial only)**
- Operating Profit Margin checked for last 3 annual periods — must be flat or improving.
- Skipped for financial sector stocks.

### Candidate Priority (when multiple rallies qualify on the same day)
If multiple stocks qualify for an INITIAL entry on the same day, we prioritize:
1. **Stocks that are exactly at buy_price** (at_zone = 1) over those slightly above it (at_zone = 0).
2. **Higher upside** — `(sell_price − fill_price) / fill_price × 100` — within each at_zone group.

---

## Adding More (ABCD Averaging — Buy on Weakness)

If the stock keeps falling after we buy the INITIAL position, we add more tranches at lower prices. This is called the **Smart Pyramid / ABCD** system.

### ABCD Levels (relative to INITIAL entry price)

| Tranche | Trigger Level (from INITIAL entry) | Added When Price Falls... |
|---------|-------------------------------------|--------------------------|
| ABCD_A  | entry × 0.90                        | 10% below INITIAL entry  |
| ABCD_B  | entry × 0.81                        | 19% below INITIAL entry  |
| ABCD_C  | entry × 0.729                       | 27.1% below INITIAL entry|
| ABCD_D  | entry × 0.6561                      | 34.4% below INITIAL entry|

- Trigger: `daily_low ≤ tranche_level`
- Only one new ABCD tranche is opened per (stock, rally) per day.
- Max ABCD depth = 4 (up to ABCD_D).

### ABCD Exit Targets (each tranche exits at the level above it)

| Tranche | Exits When Price Returns To... |
|---------|---------------------------------|
| ABCD_A  | INITIAL entry price (×1.000)   |
| ABCD_B  | ABCD_A level (×0.900)          |
| ABCD_C  | ABCD_B level (×0.810)          |
| ABCD_D  | ABCD_C level (×0.729)          |

- Each ABCD tranche has its own exit target. It exits independently as soon as its level is hit.
- This means ABCD_A could exit (at break-even) while ABCD_B is still open.

---

## Adding More on Strength (MOMENTUM Tranche)

When the stock, after an INITIAL position is open, **crosses back above the 200 DMA while the INITIAL is in profit**, we add a MOMENTUM tranche.

### MOMENTUM conditions (all must be true on the same day):

1. INITIAL position is open for this (stock, rally).
2. MOMENTUM tranche is not already open for this rally.
3. Today's close ≥ 200 DMA (stock has moved above its medium-term average).
4. Yesterday's close was **below** the 200 DMA (this is a fresh crossover, not a continuation).
5. Today's close > INITIAL entry price (we are in profit on the INITIAL position).
6. Portfolio has capacity (cash + slot available).

### MOMENTUM exit target:
- Same as INITIAL: exits at sell_price (the rally high).

---

## Capital Allocation — How Much Do We Put In Each Tranche?

Capital is allocated as a percentage of the **current total portfolio value** (cash + open positions marked to market).

| Tranche    | Large Cap | Mid Cap | Small Cap |
|------------|-----------|---------|-----------|
| INITIAL    | 2.0%      | 1.2%    | 0.6%      |
| ABCD_A     | 1.0%      | 0.6%    | 0.35%     |
| ABCD_B     | 0.75%     | 0.45%   | 0.25%     |
| ABCD_C     | 0.5%      | 0.3%    | 0.15%     |
| ABCD_D     | 0.25%     | 0.15%   | N/A       |
| MOMENTUM   | 0.5%      | 0.3%    | 0.15%     |
| **Total (full pyramid)** | **5.0%** | **3.0%** | **1.5%** |

- Starting capital: **₹1,00,000 (₹1 Lakh)**
- The % is applied to the portfolio's current value at the time of entry, not the initial ₹1L.
- For Small Cap, ABCD_D is not available (too small allocation size is not meaningful).

---

## Exit — When Do We Sell?

### Normal exit (TARGET_HIT):
- For INITIAL and MOMENTUM: exit when daily High ≥ sell_price (rally high).
- For ABCD tranches: exit when daily High ≥ their individual exit target (see table above).
- Exit price = the target price.

### Expiry exit (EXPIRED):
- If 1 year passes from the rally_end_date and the INITIAL is still open, all open tranches for that rally are closed at the day's closing price.
- Exit reason = EXPIRED.

### End of simulation:
- Any positions still open at the last simulation day are marked with their unrealised P/L at the last known price.
- Exit reason = OPEN.

---

## Order of Operations Each Day

Within each simulation day, events happen in this sequence:

1. **TARGET EXIT** — check all open positions; close any that have hit their exit target (daily High ≥ exit target). This runs first so an entry and exit on the same day are correctly handled.
2. **MOMENTUM ADD** — check if any existing INITIAL position triggers a momentum entry.
3. **ABCD ADD** — check if any existing INITIAL position triggers the next ABCD level.
4. **NEW ENTRY (INITIAL)** — check all active rallies; prioritize and open new initial positions.
5. **Drawdown tracking** — update max drawdown per position based on today's close.
6. **Equity curve snapshot** — record portfolio total value (cash + open positions at today's close).

---

## Slippage / Transaction Costs

- **0.10% per side** (buy + sell), applied to the trade value.
- On buy: `cash paid = position_value × 1.001`
- On sell: `cash received = shares × exit_price × 0.999`

---

## No Look-Ahead Bias

- Rally detection uses data from 10 years ago to the present. During simulation, we only use rallies whose `rally_end_date` is **strictly before** the simulation day being processed.
- Fundamental data (ROCE, ROE, etc.) uses only annual reports available at or before the entry date — no future data.
- PE series uses daily historical PE at the entry date — no future EPS.
- The 200 DMA, 52W high, and all indicators use only data available on the current simulation day.

---

## Key Parameters (Configurable)

| Parameter               | Default Value | Where Configured              |
|-------------------------|--------------|-------------------------------|
| Simulation period        | 5 years      | `s200_portfolio_backtest.py`  |
| Data download period     | 10 years     | `s200_portfolio_backtest.py`  |
| Initial capital          | ₹1,00,000    | `s200_portfolio_backtest.py`  |
| Max concurrent positions | 15           | `s200_portfolio_backtest.py`  |
| Max ABCD depth           | 4 (up to D)  | `s200_portfolio_backtest.py`  |
| Minimum rally size       | 20%          | `s200_20pct_rally_scanner.py` |
| Buy zone width           | 0.75%        | `s200_20pct_rally_scanner.py` |
| Rally validity window    | 365 days     | `s200_portfolio_backtest.py`  |
| ABCD_A trigger           | −10%         | `portfolio_backtest_engine.py`|
| ABCD_B trigger           | −19%         | `portfolio_backtest_engine.py`|
| ABCD_C trigger           | −27.1%       | `portfolio_backtest_engine.py`|
| ABCD_D trigger           | −34.4%       | `portfolio_backtest_engine.py`|
| PE hard cap              | 70           | `fundamental_config.py`       |
| Min Market Cap           | ₹3,000 Cr    | `fundamental_config.py`       |
| Max Net D/E              | 0.25         | `fundamental_config.py`       |
| Min ROCE / ROE           | 15%          | `fundamental_config.py`       |
| Min TTM Net Profit       | ₹250 Cr      | `fundamental_config.py`       |
| Min Sales vs ATH         | 90%          | `fundamental_config.py`       |
| Min Profit vs ATH        | 90%          | `fundamental_config.py`       |
| Slippage                 | 0.10% per side | `s200_portfolio_backtest.py`|

---

## What Is NOT Checked (Yet)

### Gate wired — data feed pending (will activate automatically)

- **Promoter pledging < 5%** — gate logic IS present in `apply_fundamental_filter_phase2()`. Currently always passes because `fetch_fundamental_metrics()` returns `pledged_pct = None` — yfinance does not provide this. Will activate once Screener.in supplies the value.

### Gate NOT wired — needs both data fetch + gate implementation

- **Public shareholding < 30%** — config key defined (`MAX_PUBLIC_SHAREHOLDING_PCT`); no check in `apply_fundamental_filter_phase2()`; field not returned by `fetch_fundamental_metrics()`.
- **Tangible Fixed Assets (TFA) vs ATH ≥ 90%** — intended as alternative pass for Profit ATH failures. Config key defined (`MIN_TFA_VS_ATH_PCT`); no gate logic or data fetch implemented.

### Scoring only (not hard gates)

- **EV/EBITDA, MktCap/Sales, P/B** — scoring metrics, not hard filters.
- **Watchout flags** — rising interest expense, exceptional items (config defined; no active gate logic).

---

## Output Files

- `s200_portfolio_backtest.json` — everything: metadata, equity curve, all trades, per-stock price series
  - `meta` — simulation settings, fundamental gates enabled, allocation table
  - `summary` — CAGR, total return, win rate, max drawdown, time in market, by cap tier breakdown, yearly returns
  - `equity_curve` — daily portfolio value, cash, deployed capital, open positions count
  - `trades` — every trade (all tranches), with: entry/exit date, price, target, tranche, P/L, drawdown

---

## Performance Metrics Reported

| Metric                  | What It Means                                                     |
|-------------------------|-------------------------------------------------------------------|
| CAGR                    | Compound Annual Growth Rate over the simulation period             |
| XIRR                    | Internal rate of return accounting for timing of cash flows        |
| Total Return %          | Simple start-to-end portfolio growth                               |
| Win Rate                | % of completed trades (TARGET_HIT) that had positive P/L          |
| Max Drawdown            | Largest peak-to-trough drop in portfolio value during simulation   |
| Time in Market          | % of simulation days where at least one position was open          |
| Avg Trade Duration      | Average number of days held per completed trade                    |
| Yearly Returns          | Year-by-year portfolio return (Jan–Dec)                            |
| By Cap Tier             | Win rate and avg P/L broken out by Large/Mid/Small Cap             |

---

*Append new conditions or changes to logic below this line.*

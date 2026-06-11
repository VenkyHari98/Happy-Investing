# F40 — 52-Week Low → High Strategy (Backtest Logic)

> Living document. Append new conditions here as logic is finalized.
> Last updated: 2026-06-07

---

## What This Strategy Does in Plain English

We look at the F40 watchlist stocks every day going back 10 years.
Whenever a stock's price drops down to its 52-week low (or very close to it),
we buy it — but only if it passes a set of quality and valuation checks.
We hold until the price hits the 52-week high that existed on the **day we bought** (fixed target).
No stop-loss. No time limit. We just wait.

---

## Universe

- **Watchlist:** F40.txt only (roughly 40 large/mid-cap stocks)
- **Simulation period:** Last 10 years of daily OHLCV data from yfinance
- **Price data used:** Daily Open, High, Low, Close, Volume (Indian NSE stocks, ".NS" suffix)

---

## Entry — When Do We Buy?

### Step 1: Price must reach the 52-week low zone

- We compute a rolling 252-day (1 year) low.
- The stock's daily **Low** must touch within **+2%** of that rolling 52-week low.
  - Formula: `daily_low ≤ rolling_52w_low × 1.02`
- We enter at: `max(rolling_52w_low, daily_low)` — whichever is higher.
- Volume must be > 0 (the market must have traded that day).

### Step 2: Concurrent position limit

- Maximum **4 open positions** per stock at the same time.
- If we already have 4 open trades in a stock, no new entry.

### Step 3: Meaningful new low (multi-entry rule)

- If we already have open positions in this stock, the new entry price must be at least **8% below** our cheapest existing open position.
- This prevents us from buying almost the same level multiple times.
- If this is our first position in the stock, this check is skipped.

### Step 4 (Gate 1): Must be below the 200-day moving average

- We compute a 200-day Simple Moving Average (SMA) of the closing price.
- Entry price must be **strictly below** the 200 DMA.
- If the stock is trading above its 200 DMA at the entry zone, we skip the trade.

### Step 5 (Gate 2): PE ratio must be below 70

- We use the **historical daily PE series** (trailing twelve months EPS, fetched via yfinance).
- PE at the entry date must be **< 70**.
- If PE data is not available for that stock, this gate is **skipped** (we don't block the trade just because PE data is missing).

### Step 6 (Gate 3): PE must be below the 5-year rolling median PE

- We compute the rolling 5-year median of the PE ratio (looking only at data available on the entry date — no look-ahead).
- The PE at entry must be **below** its own 5-year historical median.
- This ensures we're not buying an expensive stock at an "expensive period in its own history."
- If PE data is unavailable, this gate is **skipped**.

### Step 7 (Gate 4): Phase 2 — Fundamental quality check

All checks below use **data that was available at the entry date** (annual reports filed up to that date). No future data is used.

If fundamental data cannot be fetched from yfinance, the entire Phase 2 block is **silently skipped** — we never block a trade just because data is missing.

Each individual metric is also silently skipped when its value is `None` — missing data never blocks a trade on its own.

#### Section 3: Balance Sheet Quality

**A. Market Cap > ₹3,000 Cr (universe filter)**
- Uses current market cap (not historical).
- Stocks below this threshold are considered too small for our universe.
- Applies to all cap tiers.

**B. Net Debt / Equity < 0.25 (for non-financial companies)**
- Net Debt = Long-term Debt + Short-term Debt − Cash & Equivalents
- Net D/E = Net Debt / Shareholders' Equity
- Must be below 0.25 — i.e., the company is not significantly leveraged.
- **Skipped for financial sector stocks** (banks, NBFCs, insurance — they use debt structurally).

**C. ROCE ≥ 15% (for non-financial companies)**
- ROCE = Operating Income / (Total Assets − Current Liabilities) × 100
- Measures how efficiently the company earns returns on its capital.
- **For financial sector stocks**, ROCE is replaced by **ROE ≥ 15%** (ROE = Net Income / Equity × 100).

**D. TTM Net Profit > ₹250 Cr**
- Trailing Twelve Months Net Profit must be positive and meaningful.
- Uses most recent annual net profit available at the entry date.
- Ensures the company is profitable at scale.

#### Section 4: Governance

**E. Pledged shares < 5% of promoter holding**
- Gate is **wired and active** in `apply_fundamental_filter_phase2()`.
- Currently always skipped because `fetch_fundamental_metrics()` returns `pledged_pct = None` — yfinance does not provide this data.
- Will activate automatically once Screener.in integration supplies the value.
- Public shareholding (promoter must hold > 70%) is **defined in config** (`MAX_PUBLIC_SHAREHOLDING_PCT = 30.0`) but **not yet wired** in the gate function or data fetch — both need implementation.

#### Section 5: Business Quality

**F. Sales vs All-Time High ≥ 90%**
- TTM Revenue must be at least 90% of the peak annual revenue seen in the last 10 years.
- Checks: "Is the business still running at near-peak revenue, or has it shrunk?"
- Uses most recent annual revenue available at the entry date vs. all earlier annual figures.

**G. Net Profit vs All-Time High ≥ 90%**
- TTM Net Profit must be at least 90% of the peak annual profit in the last 10 years.
- Checks: "Is the company's profitability near its best-ever level?"
- Only applied when TTM Net Profit is positive (ignores stocks reporting a loss).

**H. Operating Profit Margin (OPM) must not be declining (non-financial only)**
- OPM = Operating Income / Revenue × 100 (calculated for last 3 annual periods)
- The OPM must not decline year-over-year across those 3 years.
  - i.e., OPM(oldest) ≤ OPM(middle) ≤ OPM(latest)
- Checks: "Is the company getting better or worse at converting revenue to operating profit?"
- **Skipped for financial sector stocks** (banks don't report OPM in the conventional way).
- Skipped if fewer than 3 years of data are available.

---

## Exit — When Do We Sell?

- **Exit target: the 52-week high at the date of entry.** This target is fixed and never changes.
  - Why fixed? Because the rolling 52-week high window moves over time, and if we used a rolling target, it could drop below our entry price after a year, which makes no sense.
- We exit when the stock's daily **High** (intraday) reaches or exceeds the fixed target.
- Exit price = the fixed exit target.
- **No stop-loss.** We don't exit due to further price drops.
- **No time limit.** We hold as long as needed to hit the target.
- Open positions at the end of the simulation are reported as "OPEN (still holding)."

---

## Position Sizing

Each trade is sized as a fixed percentage of the **assumed portfolio value** (₹1 Lakh default):

| Cap Tier   | Allocation % |
|------------|-------------|
| Large Cap  | 5%          |
| Mid Cap    | 3%          |
| Small Cap  | 2%          |

- Shares bought = (Portfolio Value × Allocation%) / Entry Price
- This sizing is **per trade**, not per stock (a stock can have up to 4 open trades simultaneously).
- Maximum theoretical exposure to one stock = Allocation% × max_concurrent = e.g., 5% × 4 = 20% for Large Cap.

---

## Slippage / Transaction Costs

- **0.10% per side** (buy + sell), applied to the trade value.
- Slippage is subtracted from P/L: net P/L = gross P/L − (entry slippage + exit slippage).

---

## Order of Checks Each Day (Per Stock)

1. **Exit check first** — if any open position's target is hit today, close it.
2. **Entry check** — only if price is in the 52W low zone and volume > 0.
3. Apply gates 1–4 in order (200 DMA → PE → PE median → Phase 2).
4. Apply multi-entry rule (must be 8%+ below cheapest open position).
5. Open new position.

---

## No Look-Ahead Bias

- All historical fundamentals (ROCE, ROE, OPM, etc.) use **only data that would have been published at or before the entry date**.
- Annual report data is matched using the report's filing date, not the fiscal year end.
- PE series uses the daily EPS/price ratio from the date of entry, not any future EPS.

---

## What Is NOT Checked (Yet)

### Gate wired — data feed pending (will activate automatically)

- **Promoter pledging < 5%** — gate logic IS present in `apply_fundamental_filter_phase2()` (checks `pledged_pct`). Currently always passes because `fetch_fundamental_metrics()` returns `None` for this field — yfinance does not provide pledging data. Needs Screener.in integration to supply `pledged_pct`.

### Gate NOT wired — needs both data fetch + gate implementation

- **Public shareholding < 30%** — config key `MAX_PUBLIC_SHAREHOLDING_PCT` defined but `apply_fundamental_filter_phase2()` has no check for it. `fetch_fundamental_metrics()` also does not return this field. Both fetch and gate need to be implemented.
- **Tangible Fixed Assets (TFA) vs ATH ≥ 90%** — intended as an alternative pass for stocks that fail the Profit ATH test. Config key `MIN_TFA_VS_ATH_PCT` defined but no alternative-pass logic exists in `apply_fundamental_filter_phase2()`. Fixed Asset breakdown from yfinance is unreliable; needs Screener.in.

### Scoring only (not hard gates)

- **EV/EBITDA, MktCap/Sales, P/B** — good-to-have scoring metrics, not hard filters.
- **Watchout flags** — rising interest expense, exceptional items, anomalous tax rates (config keys defined; no active gate logic).

---

## Key Parameters (Configurable)

| Parameter               | Default Value | Where Configured        |
|-------------------------|--------------|-------------------------|
| Entry band above 52W low | +2%          | `f40_backtest_52w.py`   |
| Max concurrent positions | 4            | `f40_backtest_52w.py`   |
| New entry threshold      | 8% below cheapest | `f40_backtest_52w.py` |
| MA period               | 200 days     | `f40_backtest_52w.py`   |
| PE hard cap             | 70           | `fundamental_config.py` |
| Min Market Cap          | ₹3,000 Cr    | `fundamental_config.py` |
| Max Net D/E             | 0.25         | `fundamental_config.py` |
| Min ROCE / ROE          | 15%          | `fundamental_config.py` |
| Min TTM Net Profit      | ₹250 Cr      | `fundamental_config.py` |
| Min Sales vs ATH        | 90%          | `fundamental_config.py` |
| Min Profit vs ATH       | 90%          | `fundamental_config.py` |
| Slippage                | 0.10% per side | `f40_backtest_52w.py` |
| Backtest period         | 10 years     | `f40_backtest_52w.py`   |

---

## Output Files

- `backtest_summary.json` — overall stats, gate block counts
- `trades.json` / `trades.csv` — every completed trade
- `stock_data.json` — per-stock summary + open positions + price series
- `backtest_report.txt` — human-readable text report

---

*Append new conditions or changes to logic below this line.*

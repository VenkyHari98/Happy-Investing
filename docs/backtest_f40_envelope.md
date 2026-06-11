# F40 — Envelope Long Strategy (Backtest Logic)

> Living document. Append new conditions here as logic is finalized.
> Last updated: 2026-06-07

---

## What This Strategy Does in Plain English

Think of the 200-day moving average (200 DMA) as the "fair value centre" of a stock.
We draw a lower band 14% below the 200 DMA — this is called the **lower envelope**.
Whenever a stock's price drops down to touch that lower envelope, we buy.
We hold until the price bounces back up to the 200 DMA itself, then we sell.
One position at a time per stock.

---

## Universe

- **Watchlist:** F40.txt only (roughly 40 large/mid-cap stocks)
- **Simulation period:** Last 10 years of daily OHLCV data from yfinance
- **Price data used:** Daily Open, High, Low, Close, Volume (Indian NSE stocks, ".NS" suffix)
- **Direction:** Long only (this document does not cover the short/upper-envelope strategy)

---

## Key Concept: What Is the Envelope?

- **200 DMA** = 200-day Simple Moving Average of closing prices.
- **Lower envelope** = 200 DMA × (1 − 0.14) = 200 DMA × 0.86 = 14% below the 200 DMA.
- **Upper envelope** = 200 DMA × (1 + 0.14) = 14% above the 200 DMA (not used in long strategy).
- The lower envelope moves every day as the 200 DMA moves.

---

## Entry — When Do We Buy?

### Step 1: Price must reach the lower envelope zone

- We compute the **lower envelope** for each day = current 200 DMA × 0.86.
- The stock's daily **Low** must touch within **+2%** of the lower envelope.
  - Formula: `daily_low ≤ lower_envelope × 1.02`
- We enter at the **lower envelope price** (not the daily low — we assume we got filled at the envelope level).
- Volume must be > 0.
- We must not already be in a position for this stock (only one position at a time).

### Step 2 (Gate 1): PE ratio must be below 70
- Note: below 200 DMA is always satisfied since the lower envelope = MA × 0.86 < MA.

- Uses the **historical daily PE series** at the entry date.
- PE must be **< 70**.
- If PE data is unavailable for this stock, this gate is **skipped**.

### Step 3 (Gate 2): PE must be below the 5-year rolling median PE

- The PE at entry must be **below** the rolling 5-year median PE (using only data available on entry date).
- If PE data is unavailable, this gate is **skipped**.

### Step 4 (Gate 3): Phase 2 — Fundamental quality check

All checks use **data available at the entry date**. If yfinance data is unavailable, Phase 2 is **silently skipped**.

Each individual metric is also silently skipped when its value is `None` — missing data never blocks a trade on its own.

#### Section 3: Balance Sheet Quality

**A. Market Cap > ₹3,000 Cr (universe filter)**
- Uses current market cap.
- Too-small stocks are excluded.

**B. Net Debt / Equity < 0.25 (for non-financial companies)**
- Net Debt = Long-term Debt + Short-term Debt − Cash
- Must be below 0.25 (not a highly leveraged company).
- **Skipped for financial sector stocks** (banks, NBFCs, etc.).

**C. ROCE ≥ 15% (non-financial) or ROE ≥ 15% (financial)**
- ROCE = Operating Income / (Total Assets − Current Liabilities) × 100
- For banks and NBFCs: ROE = Net Income / Shareholders' Equity × 100 is used instead.

**D. TTM Net Profit > ₹250 Cr**
- Uses most recent annual net profit available at entry date.
- The company must be meaningfully profitable.

#### Section 4: Governance

**E. Pledged shares < 5% of promoter holding**
- Gate is **wired and active** in `apply_fundamental_filter_phase2()`.
- Currently always skipped because `fetch_fundamental_metrics()` returns `pledged_pct = None` — yfinance does not provide this data.
- Will activate automatically once Screener.in integration supplies the value.
- Public shareholding (promoter must hold > 70%) is **defined in config** (`MAX_PUBLIC_SHAREHOLDING_PCT = 30.0`) but **not yet wired** in the gate function or data fetch — both need implementation.

#### Section 5: Business Quality

**F. Sales vs All-Time High ≥ 90%**
- TTM Revenue must be ≥ 90% of peak annual revenue in the last 10 years.

**G. Net Profit vs All-Time High ≥ 90%**
- TTM Net Profit must be ≥ 90% of peak annual profit in the last 10 years.
- Only applied if TTM profit is positive.

**H. Operating Profit Margin (OPM) must not be declining (non-financial only)**
- OPM checked for the last 3 annual periods (newest to oldest).
- Must be flat or improving — not falling year over year.
- **Skipped for financial sector stocks.**

---

## Exit — When Do We Sell?

- We exit when the stock's daily **High** reaches or exceeds the **200-day moving average on that day**.
- Exit price = 200 DMA value on the exit day.
- The 200 DMA is **dynamic** — it moves every day as new data comes in. Unlike the 52W strategy, the target is not fixed at entry; it updates daily.
- **No stop-loss.** We don't exit due to further price drops.
- **No time limit.** We hold as long as needed.
- After an exit, the position is reset and we can re-enter later if the stock drops back to the lower envelope again.

---

## Position Sizing

Each trade is sized as a fixed percentage of the assumed portfolio value (₹1 Lakh default):

| Cap Tier   | Allocation % |
|------------|-------------|
| Large Cap  | 5%          |
| Mid Cap    | 3%          |
| Small Cap  | 2%          |

- Shares bought = (Portfolio Value × Allocation%) / Entry Price (lower envelope price)
- One position at a time per stock, so no pyramiding.

---

## Slippage / Transaction Costs

- **0.10% per side** (buy + sell), applied to trade value.
- Net P/L = gross P/L − (entry slippage + exit slippage).

---

## Order of Checks Each Day (Per Stock)

1. **Exit check** — if position is open and today's High ≥ current 200 DMA, close the trade.
2. **Entry check** — only if no position is currently open.
3. Apply gates: fall threshold → PE → PE median → Phase 2.
4. Open new position at the lower envelope price.

---

## No Look-Ahead Bias

- All fundamental data (ROCE, ROE, OPM, etc.) uses only annual reports published on or before the entry date.
- PE series is also historical — uses actual daily PE as of each day, not future EPS.

---

## Difference from 52W Strategy

| Feature               | 52W Low→High            | Envelope Long              |
|-----------------------|-------------------------|----------------------------|
| Entry trigger         | Touches rolling 52W low | Touches 200 DMA × 0.86     |
| Entry price           | Rolling 52W low          | Lower envelope (fixed band) |
| Exit target           | FIXED 52W high at entry  | DYNAMIC 200 DMA (daily)    |
| Concurrent positions  | Up to 4 per stock        | 1 at a time per stock      |
| 200 DMA gate          | Explicit check           | Implicit (always below 200 DMA at entry) |

---

## What Is NOT Checked (Yet)

### Gate wired — data feed pending (will activate automatically)

- **Promoter pledging < 5%** — gate logic IS present in `apply_fundamental_filter_phase2()`. Currently always passes because `fetch_fundamental_metrics()` returns `None` for `pledged_pct`. Needs Screener.in integration.

### Gate NOT wired — needs both data fetch + gate implementation

- **Public shareholding < 30%** — config key defined (`MAX_PUBLIC_SHAREHOLDING_PCT`); no check in `apply_fundamental_filter_phase2()`; field not returned by `fetch_fundamental_metrics()`.
- **Tangible Fixed Assets (TFA) vs ATH ≥ 90%** — intended as alternative pass for Profit ATH failures. Config key defined (`MIN_TFA_VS_ATH_PCT`); no gate logic or data fetch implemented.

### Scoring only (not hard gates)

- **EV/EBITDA, MktCap/Sales, P/B** — scoring metrics, not hard filters.
- **Watchout flags** — rising interest expense, exceptional items (config defined; no active gate logic).

---

## Key Parameters (Configurable)

| Parameter               | Default Value | Where Configured            |
|-------------------------|--------------|------------------------------|
| MA period               | 200 days     | `f40_backtest_envelope.py`   |
| Envelope width          | 14%          | `f40_backtest_envelope.py`   |
| Entry band above envelope| +2%          | `f40_backtest_envelope.py`   |
| PE hard cap             | 70           | `fundamental_config.py`      |
| Min Market Cap          | ₹3,000 Cr    | `fundamental_config.py`      |
| Max Net D/E             | 0.25         | `fundamental_config.py`      |
| Min ROCE / ROE          | 15%          | `fundamental_config.py`      |
| Min TTM Net Profit      | ₹250 Cr      | `fundamental_config.py`      |
| Min Sales vs ATH        | 90%          | `fundamental_config.py`      |
| Min Profit vs ATH       | 90%          | `fundamental_config.py`      |
| Slippage                | 0.10% per side | `f40_backtest_envelope.py` |
| Backtest period         | 10 years     | `f40_backtest_envelope.py`   |

---

## Output Files

- `backtest_summary.json` — overall stats and metrics
- `trades.json` / `trades.csv` — every completed trade
- `backtest_report.txt` — human-readable text report

---

*Append new conditions or changes to logic below this line.*

# Strategy Tuning Guide — F40 Backtest Parameters

> Use this document to review what each parameter controls and what effect changing it has on returns, trade frequency, and risk.
> Last updated: 2026-06-08

---

## How to Use This Document

Each parameter below has:
- **Current value** — what is active today in the code
- **Effect of loosening** — what happens if you relax the condition
- **Effect of tightening** — what happens if you make it stricter
- **Recommended experiments** — specific values worth backtesting
- **Risk** — what could go wrong

Run `f40_portfolio_backtest.py` to compare variants on CAGR, time-in-market %, win rate, and max drawdown.

---

## Part 1 — Entry Conditions (52W Strategy)

---

### 1.1 Entry Band above 52W Low

| | |
|---|---|
| **Current value** | `+2%` |
| **Configured in** | `f40_portfolio_backtest.py → ENTRY_BAND_PCT` / `f40_backtest_52w.py` |
| **What it does** | Allows entry when price is within 2% of the 52W low. Without this, you'd only ever fill on the exact day the stock makes its 52W low — very rare. |

**Loosen (e.g. +5%)**: More entries fire; you enter some stocks slightly higher above the low. Higher trade frequency but average entry quality drops slightly.

**Tighten (e.g. +1%)**: Fewer, sharper entries. Higher average upside per trade but many potential trades are missed.

**Recommended experiments**: `1%, 3%, 5%`

**Risk of loosening**: You catch stocks that are "near" their lows but not actually at them — may reduce average trade return.

---

### 1.2 Max Concurrent Positions (per-stock)

| | |
|---|---|
| **Current value** | `4` (per stock, in `f40_backtest_52w.py`) / `MAX_CONCURRENT = 15` (portfolio-level) |
| **Configured in** | `f40_backtest_52w.py` / `f40_portfolio_backtest.py` |
| **What it does** | Limits how many open positions you can hold in a single stock simultaneously (for the per-stock backtest). Portfolio-level controls total across all stocks. |

**Loosen per-stock max**: Allows deeper averaging into a falling stock — higher potential return if it recovers, larger loss if it doesn't.

**Increase portfolio max (e.g. 20→25)**: More concurrent positions across stocks → higher capital utilization in busy markets.

**Recommended experiments**: Per-stock: `3, 4, 6`. Portfolio: `10, 15, 20`.

**Risk**: More concurrent per stock = more capital in one name = concentrated loss if the stock doesn't recover.

---

### 1.3 New Entry Threshold (multi-entry rule, per-stock backtest only)

| | |
|---|---|
| **Current value** | `8%` below the cheapest open position |
| **Configured in** | `f40_backtest_52w.py → new_entry_threshold_pct` |
| **What it does** | Prevents entering the same stock twice at nearly the same level. New entry only fires if it's at least 8% cheaper than the current cheapest open position. |

**Loosen (e.g. 5%)**: More multi-entries, some at closer levels — useful in choppy markets.

**Tighten (e.g. 12%)**: Only enters on significant new lows — fewer trades, higher average quality.

**Recommended experiments**: `5%, 8%, 12%`

---

### 1.4 ABCD Multipliers (portfolio backtest only)

| | |
|---|---|
| **Current values** | `−10%, −19%, −27.1%, −34.4%` (geometric: each step × 0.9) |
| **Configured in** | `portfolio_backtest_engine.py → ABCD_MULTIPLIERS` |
| **What it does** | Defines the price levels below INITIAL entry where each averaging tranche opens. |

**Tighter steps (e.g. 0.92 multiplier → −8%, −15%, −22%, −28%)**: Starts averaging sooner. More tranches deploy in moderate dips.

**Wider steps (e.g. 0.85 multiplier → −15%, −28%, −38%, −48%)**: Only averages in deep crashes. Fewer activations but larger position builds in severe dislocations.

**Recommended experiments**: Multipliers `0.88`, `0.90` (current), `0.92`

**Risk of tight steps**: You deploy ABCD capital in mild corrections — if the stock keeps falling past the ABCD levels, you're out of ammo to average further.

---

### 1.5 200 DMA Gate

| | |
|---|---|
| **Current value** | `REQUIRE_BELOW_200DMA = True` |
| **Configured in** | `fundamental_config.py` (per-stock backtests) / hardcoded in `f40_portfolio_backtest.py` |
| **What it does** | Blocks entries where the stock is above its 200 DMA. A stock near its 52W low is almost always below its 200 DMA, so this rarely fires — but it catches edge cases. |

**Removing this gate**: Slightly more entries in edge cases where 52W low ≥ 200 DMA (unusual). Low impact.

**Recommendation**: Keep as-is. The 200 DMA is a reliable trend filter.

---

## Part 2 — Fundamental Filters

These live in `fundamental_config.py`. All are applied as **hard gates** in the per-stock backtests; the portfolio backtest does not currently apply them (speed trade-off).

> **Key insight from filter_stats**: Run `f40_backtest_52w.py` and check the block counts to see which gate is filtering the most opportunities. That tells you which one is worth experimenting with first.

---

### 2.1 PE Hard Cap

| | |
|---|---|
| **Current value** | `PE_MAX = 70` |
| **What it does** | Blocks entries where the trailing P/E ratio exceeds 70. |

**Loosen (e.g. 100)**: Catches more stocks — pharma, IT services, consumer stocks often trade at 40-80x during corrections. More trades but higher valuation risk.

**Tighten (e.g. 40)**: Only buys cheap stocks. Fewer entries; misses quality franchises that are legitimately expensive.

**Recommended experiments**: `50, 70 (current), 100`

**Risk of loosening**: You buy expensive stocks at 52W lows — they may still be overvalued even after the fall.

---

### 2.2 PE Below 5-Year Median

| | |
|---|---|
| **Current value** | `PE_BELOW_5YR_MEDIAN = True` |
| **What it does** | Blocks entry unless the current PE is below its own 5-year median. Ensures you're buying "cheap in its own history." |

**Disable**: More entries; picks up stocks where PE is historically elevated but falling. Risk: buying expensive franchises before PE normalizes further.

**Add 10-year median** (`PE_BELOW_10YR_MEDIAN = True`): Stricter. Useful for cyclical sectors where 5-year medians can be distorted.

**Recommended experiment**: Run with `PE_BELOW_5YR_MEDIAN = False` and compare how many extra trades fire vs. how their win rates compare.

---

### 2.3 Net Debt / Equity Ceiling

| | |
|---|---|
| **Current value** | `MAX_NET_DEBT_TO_EQUITY = 0.25` |
| **What it does** | Blocks highly leveraged companies. Applies to non-financial companies only. |

**Loosen (e.g. 0.50)**: Includes more capital-intensive businesses (infra, manufacturing). Higher leverage = higher risk during downturns.

**Tighten (e.g. 0.10)**: Only debt-light companies. Misses many industrials and consumer durables.

**Recommended experiments**: `0.10, 0.25 (current), 0.50`

---

### 2.4 ROCE / ROE Floor

| | |
|---|---|
| **Current value** | `MIN_ROCE = 15%` (non-financial) / `MIN_ROE = 15%` (financial) |
| **What it does** | Ensures the business actually earns a decent return on the capital it deploys. |

**Loosen (e.g. 12%)**: Includes capital-heavy sectors with structurally lower ROCE (utilities, PSU banks). More entries but lower capital efficiency.

**Tighten (e.g. 20%)**: Only best-in-class capital allocators. Fewer stocks but historically these compound faster.

**Recommended experiments**: `12%, 15% (current), 18%, 20%`

---

### 2.5 TTM Net Profit Floor

| | |
|---|---|
| **Current value** | `MIN_TTM_NET_PROFIT_CR = ₹250 Cr` |
| **What it does** | Ensures profitability at scale. Filters out marginal businesses. |

**Loosen (e.g. ₹100 Cr)**: Includes smaller profitable businesses — can increase signal count in the small/mid-cap universe.

**Tighten (e.g. ₹500 Cr)**: Only large profitable businesses — concentrates into the large/mid-cap space.

**Recommended experiments**: `₹100 Cr, ₹250 Cr (current), ₹500 Cr`

---

### 2.6 Sales and Profit vs ATH

| | |
|---|---|
| **Current value** | `MIN_SALES_VS_ATH_PCT = 90%` / `MIN_PROFIT_VS_ATH_PCT = 90%` |
| **What it does** | Ensures the business is running near its peak — not in secular decline. A company at 52W price low but also at 10-year revenue low is a different beast. |

**Loosen (e.g. 75%)**: Catches turnarounds — companies that have fallen from peak but may be recovering. Higher risk but potentially higher reward if the thesis is right.

**Tighten (e.g. 95%)**: Only businesses that are at near-peak performance but temporarily sold off. Very high quality filter.

**Recommended experiments for turnarounds**: Run with `80%, 90% (current), 95%` and compare the win-rate of each cohort.

**Important**: At 90%, a company in a cyclical trough might be excluded even though it's a perfectly normal dip. Consider sector-specific overrides for cyclicals (metals, chemicals).

---

### 2.7 OPM Non-Declining

| | |
|---|---|
| **Current value** | `REQUIRE_OPM_NON_DECLINING = True` |
| **What it does** | Requires that operating profit margins have been flat or improving over the last 3 years. Blocks companies whose unit economics are deteriorating. |

**Disable**: Allows companies in temporary margin compression (input cost spike, pricing lag). Could catch recoveries before margins normalize.

**Tighten (require improvement, not just non-decline)**: Only companies actively expanding margins. Very strict — many good companies plateau.

**Recommended experiment**: Disable for a separate run and check how many additional entries fire + their win rates.

---

## Part 3 — Envelope Strategy Parameters

---

### 3.1 Envelope Width

| | |
|---|---|
| **Current value** | `ENV_PCT = 14%` |
| **Configured in** | `f40_portfolio_backtest.py → ENV_PCT` / `f40_backtest_envelope.py` |
| **What it does** | Sets how far below (or above) the 200 DMA the entry band sits. 14% = price must drop 14% below the MA before an entry fires. |

**Loosen (e.g. 10%)**: More entries fire — the band is closer to the MA, so smaller pullbacks trigger it. More trades, shorter durations, smaller average profit per trade.

**Tighten (e.g. 18%)**: Only deep pullbacks trigger entries. Fewer trades but each starts from a more extreme discount to fair value — historically better win rates and larger average return.

**Recommended experiments**: `10%, 12%, 14% (current), 16%, 18%`

**Key trade-off**: Wider envelope → fewer, higher-quality entries. Narrower → more frequent but shallower.

---

### 3.2 Envelope Entry Tolerance

| | |
|---|---|
| **Current value** | `ENV_ENTRY_BAND = 2%` |
| **What it does** | Allows entry when price is within 2% of the envelope (not just exactly at it). Without this you'd rarely fill. |

Low sensitivity to changes. Keep at 2%.

---

### 3.3 Envelope Allocation

| | |
|---|---|
| **Current values** | Large Cap: 3%, Mid Cap: 2%, Small Cap: 1% |
| **Configured in** | `portfolio_backtest_engine.py → ENVELOPE_ALLOCATIONS` |

**Increase**: Deploys more capital per envelope trade — raises time-in-market % but also raises risk per position.

**Decrease**: More conservative — envelope becomes a small "add-on" to the 52W strategy.

**Recommended experiments**: Try 4%/3%/1.5% vs 2%/1.5%/0.75% and compare drawdown vs capital utilization.

---

## Part 4 — Capital Structure

---

### 4.1 52W INITIAL Allocation

| | |
|---|---|
| **Current value** | Large Cap: 2%, Mid Cap: 1.2%, Small Cap: 0.6% |
| **Configured in** | `portfolio_backtest_engine.py → ALLOCATIONS['Large Cap']['INITIAL']` etc. |

**Increase**: Each initial position is larger → higher per-trade return but more concentrated. Total max exposure per large-cap stock (all tranches): 5%.

**Decrease**: Smaller initial bites → more room to average down (ABCD tranches have more relative weight).

**Recommendation**: Don't change the per-tranche ratios without also adjusting ABCD tranches proportionally (the total per-stock limit is the control knob).

---

### 4.2 Max ABCD Depth

| | |
|---|---|
| **Current value** | `max_abcd_depth = 4` (A through D) |
| **Configured in** | `f40_portfolio_backtest.py → PortfolioSimulator(max_abcd_depth=4)` |

**Reduce to 2 (A and B only)**: Less downward averaging; capital preserved. Better for uncertain markets.

**Keep at 4**: Full pyramid — maximum averaging in deep crashes. Best for high-conviction moat stocks.

**Recommended experiments**: `2, 3, 4`

---

## Part 5 — Incomplete Filters (Three Different States)

These are NOT the same situation — they need different actions to activate:

### State A: Gate wired, data feed pending → activate by connecting Screener.in

| Filter | Config Key | Code location | What's missing |
|--------|-----------|--------------|----------------|
| Pledged shares < 5% | `MAX_PLEDGED_PCT = 5.0` | Gate IS in `apply_fundamental_filter_phase2()` lines 212-214 | `fetch_fundamental_metrics()` always returns `pledged_pct = None`. Once Screener.in supplies this value, the gate activates with zero code change. |

### State B: Gate NOT wired — needs both new data fetch logic AND gate implementation

| Filter | Config Key | Expected Effect | What needs building |
|--------|-----------|----------------|---------------------|
| Public shareholding < 30% | `MAX_PUBLIC_SHAREHOLDING_PCT = 30.0` | Filters out loosely held companies where promoters lack conviction | (1) `fetch_fundamental_metrics()` must return `public_shareholding_pct`; (2) check must be added to `apply_fundamental_filter_phase2()` |
| TFA vs ATH ≥ 90% | `MIN_TFA_VS_ATH_PCT = 90.0` | Alternative pass for asset-heavy stocks failing Profit ATH | (1) `fetch_fundamental_metrics()` must return TFA time-series (needs Screener.in — yfinance unreliable); (2) alternative-pass logic needed in `apply_fundamental_filter_phase2()` |

### State C: Scoring only — no gate implementation intended

| Filter | Config Key | Usage |
|--------|-----------|-------|
| EV/EBITDA below median | `GTH_EV_EBITDA_BELOW_MEDIAN` | Opportunity scoring / ranking only |
| MktCap/Sales below median | `GTH_MKTCAP_SALES_BELOW_MEDIAN` | Opportunity scoring / ranking only |
| P/B < 0.4 | `GTH_PB_MAX = 0.4` | Deep value signal for ranking only |

**Priority action**: Pledged % is the highest-impact governance gate because it's already wired — connecting the Screener.in data feed alone will activate it with no code change. Do that first.

---

## Part 6 — Summary: Highest-Leverage Experiments

Ranked by expected impact on CAGR and capital utilization:

| Priority | Experiment | Expected Effect |
|----------|-----------|-----------------|
| 1 | `--envelope both` combined with 52W | Higher `time_in_market_pct`; captures bull-market gains (short side) |
| 2 | Widen envelope to 16-18% | Fewer but higher-quality envelope entries; better win rate |
| 3 | Lower `MIN_SALES_VS_ATH_PCT` to 80% | Unlocks turnaround stocks; test win rate carefully |
| 4 | Raise `PE_MAX` to 100 | Catches quality franchises in corrections; check if they win |
| 5 | `--exit-mode rolling` vs `fixed` | Rolling only helps when stocks break to new highs — measures upside capture |
| 6 | `max_abcd_depth = 2` vs `4` | Lower depth preserves capital; useful if many stocks don't fully recover |
| 7 | Lower `MIN_ROCE` to 12% | Opens capital-heavy sectors; check sector distribution of new entries |
| 8 | `entry_band_pct = 5%` | More entries, slightly lower quality — useful if signal count is too low |

---

*Append new experiments and results below this line.*

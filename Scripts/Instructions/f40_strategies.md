# F40 Strategies — Instruction Set

Date: 2026-05-29

Purpose: canonical, human-readable rules for the F40 strategy suite. These are reference instructions to be used by the skill/sub-skill implementation and for backtests.

---

## Global conventions
- Use 252 trading days as the 52-week window for rolling high/low calculations.
- All signals and backtests operate on daily OHLC candles. Use the previous completed daily candle when generating new signals for a run.
- No intraday trading: all orders are positional / swing, executed as GTT (Good-Till-Triggered) or equivalent.
- Fill pricing for backtests and records:
  - Buy fills at the trigger level (e.g., 52W low or band price) when the day's low <= trigger.
  - Sell fills at the trigger level (e.g., rolling 52W high) when the day's high >= trigger.
  - When band logic is used (see below) record the fill at the band boundary price.
- Portfolio allocation (per-stock maximum exposure per trade): Large = 5%, Mid = 3%, Small = 2% of portfolio value (configurable).
- Error handling and fallbacks: allow combination with ABCD/envelope strategies; if multiple strategies trigger, rules for priority will be defined during implementation.

---

## Strategy 1 — 52‑Week Low → 52‑Week High (Primary)
Goal: buy at or near the rolling 52‑week low and exit when price later reaches the then-current rolling 52‑week high.

Rules:
- Rolling window: last 252 trading days.
- Buy condition:
  - Primary entry = exact rolling 52W low price (GTT trigger).
  - Allowed entry band = +/- 2% around the 52W low (configurable). If price trades within this band, treat it as a valid fill.
  - When triggered, mark the buy with timestamp, fill price, and source `52W_LOW`.
- Sell condition:
  - At each future day after entry, compute the day’s rolling 52W high (252-day rolling max up to that day).
  - If that day’s intraday high >= rolling 52W high, sell the full position at the rolling 52W high price (GTT sell).
  - Optional early/partial exit: if price reaches within 2.5% below the rolling 52W high (i.e., price >= 52W_high * (1 - 0.025)), allow a discretionary partial or full exit to lock profit. This is configurable.
- Behaviour notes:
  - The rolling 52W high is recomputed daily; the sell target is therefore dynamic — sell at the first day where the dynamic target is reached.
  - If the ABCD averaging strategy is active for the same stock, buys from ABCD may be used to average the position; the 52W‑high sell applies to the aggregated position unless different tranche-level exit rules are specified.

Metrics to record per trade:
- entry_date, entry_price, entry_type (`GTT/52W_LOW`), allocation_pct, shares
- exit_date, exit_price, exit_type (`GTT/52W_HIGH` or `EARLY_EXIT`), pnl_pct, pnl_value
- notes (e.g., whether ABCD averaging was used)

---

## Cross-References / Related strategies
- ABCD downward-averaging strategy: if price declines after the 52W low entry, ABCD tranches may be used to average down (see dedicated ABCD instructions file).
- Envelope strategies (Long/Short): these can be used in combination with the 52W strategy for additional entries/exits; integration rules will be specified when implementing the combined execution engine.

---

## Backtest assumptions
- Use daily OHLC; detect fills when `low <= buy_trigger` and `high >= sell_trigger` on the simulated day.
- Use the previous completed daily candle when generating signals for a new run.
- Ignore slippage, commission, and partial fills for the first implementation; add realistic slippage later if required.

---

## Implementation notes for developers
- File name: `f40_strategies.md` — this is a canonical instruction file used by the skill before coding.
- Configurable parameters to expose in the skill API:
  - `rolling_window_days` (default 252)
  - `entry_band_pct` (default 2.0)
  - `early_exit_band_pct` (default 2.5)
  - `allocations` (default {Large: 0.05, Mid:0.03, Small:0.02})
  - `use_previous_day_for_signals` (default true)
- Store trade records and signals in the daily output JSON under `strategies/52w_low_high/` with per-stock trade history.

---

## Next steps
1. Create a dedicated ABCD instruction file and an Envelope strategies instruction file (Long/Short) capturing the rules discussed earlier.
2. Implement the `52W Low→High` signal generator and backtest module using the `F40.txt` list as the initial universe.
3. Produce a sample backtest report and per-stock signal JSON for review.



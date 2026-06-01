# Envelope Strategies — Instruction Set

Date: 2026-05-29

Purpose: Define the Long and Short Envelope strategies that use a 200-period moving average (configurable as SMA or DMA) with a dynamic envelope percentage (default ±14%). These rules are reference instructions for implementation and tuning.

---

## Global conventions (applies to Envelope strategies)
- Timeframe: Daily candles.
- Moving average type: configurable; default = 200-period Simple Moving Average (SMA). Optionally support DMA (day-based moving average) if required; parameter name: `ma_type` (`SMA` or `DMA`).
- Rolling window for MA: default `ma_period = 200` (configurable).
- Envelope width: default `envelope_pct = 14.0` (percent). Envelope boundaries: lower = MA * (1 - envelope_pct/100), upper = MA * (1 + envelope_pct/100).
- Use previous completed daily candle for signal generation.
- Backtests and live signals use daily OHLC; fills are detected via `low <= buy_trigger` and `high >= sell_trigger`.
- Position sizing: conform to global allocations (`Large:5%`, `Mid:3%`, `Small:2%`) unless overridden per-strategy.

---

## Envelope Long (Buy the dip into lower envelope)
Goal: capture mean-reversion opportunities when price reaches the lower envelope around the 200 MA.

Rules:
- Primary entry conditions:
  - Price touches or trades inside the lower envelope band: `close <= lower_envelope` OR intraday low `<= lower_envelope` on that day.
  - Optionally require a confirming candle pattern (configurable: `require_confirmation` default `false`). If enabled, require the next day to close above that day's low.
- Entry style:
  - Single-fill buy at the trigger price (lower envelope) or within a small `entry_band_pct` (default 2%).
  - If price gaps below lower envelope, treat fill at lower envelope price or at day's open? (Configurable; default = treat as filled at lower envelope.)
- Exit conditions:
  - Primary exit = price returns to the MA (sell at MA price when `high >= MA`), OR
  - Profit target = configurable percent (e.g., 25%) from entry, whichever occurs first.
  - Optional early partial exits: when price reaches `MA * (1 - early_exit_pct)` (configurable), allow partial profit-taking.
- Averaging integration:
  - If price continues to fall after entry, the ABCD averaging rules may apply to add tranches.
  - Envelope Long entries are compatible with ABCD tranche purchases.

---

## Envelope Short (Short on upper envelope / use for downward averaging)
Goal: short or use envelope band to structure down-averaging when price runs up and reverts to MA.

Rules:
- Primary short entry conditions:
  - Price touches or trades at/above upper envelope: `close >= upper_envelope` OR intraday high `>= upper_envelope`.
  - Enter short assuming mean reversion to MA, or use this as signal to set trailing targets.
- Alternative (averaging) use-case:
  - If stock ran up and never touched upper envelope, but subsequently drops back to MA, perform a small tranche buy (e.g., 1% of remaining allocation) at MA and aim for re-entry to upper envelope or lower band depending on strategy combination.
  - This is effectively combining long-envelope re-entry with short-envelope context to average exposure.
- Exit conditions:
  - Cover at the MA when price reaches MA level (`low <= MA`) or use profit-targeting rules for covered short trades.

---

## Dynamic/tunable parameters
- `ma_type`: "SMA" or "DMA" (default "SMA")
- `ma_period`: integer (default 200)
- `envelope_pct`: float (default 14.0)
- `entry_band_pct`: float (default 2.0)
- `early_exit_pct`: float (default 2.5)
- `require_confirmation`: bool (default false)
- `averaging_tranche_pct`: float — size for small tranche buys when averaging on MA (default 1.0% of allocation)

Expose these parameters in the skill configuration so they can be adjusted without code changes.

---

## Implementation notes for developers
- File name: `envelope_strategies.md` — canonical reference for coding.
- Signal output should include: `entry_date`, `entry_price`, `ma_value`, `envelope_pct`, `exit_date`, `exit_price`, `exit_reason`.
- Integrate with ABCD averaging by recording tranche-level buys and sells in `strategies/envelope/` per-stock.


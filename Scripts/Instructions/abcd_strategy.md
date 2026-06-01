# ABCD Downward-Averaging Strategy — Instruction Set

Date: 2026-05-29

Purpose: deterministic rules for the ABCD downward-averaging strategy used to scale into positions after an initial entry (for example, after entering at the 52W low or the lower envelope).

---

## Overview
- ABCD is a tranche-based averaging strategy: start with an initial entry (base tranche), then place up to four additional buy tranches (A, B, C, D) at fixed percent declines from the previous tranche.
- Default step percent: 10% per tranche (configurable). That is, A = initial_entry * (1 - 0.10), B = A * (1 - 0.10), etc.
- Tranche sizing: equal-size per tranche by default (configurable). For example, if total intended allocation for strategy = 5% of portfolio, each tranche = 5% / N_tranches.
- Max tranches: default total tranches = 5 (initial + A + B + C + D).

---

## Rules
- Entry trigger for A–D:
  - Place limit / GTT buys at the defined tranche price levels.
  - If market never reaches a tranche level, that tranche remains unfilled and no further tranche is shifted (no dynamic re-proportioning) unless configured.
- Tranche sizes and allocation:
  - Parameter `total_allocation_pct` (default follows global allocation per cap tier).
  - Parameter `num_tranches` (default 5).
  - Per-tranche allocation = `total_allocation_pct / num_tranches` (configurable for uneven sizing).
- Exit rule:
  - For tranche-level exits, when price recovers to `one_tranche_step_above` the tranche's buy price, sell that tranche.
  - Example: initial entry at 100, A bought at 90 (10% down), if price rallies above 99 (i.e., one tranche step above A = 90 * (1 + 0.10)), sell A tranche. This ensures FIFO profit booking.
  - If price reaches global sell target (e.g., 52W high for the aggregated position), sell remaining tranches at that target.
- Stop / safeguard:
  - Stop additional tranche buys after a configurable maximum drawdown from initial entry (e.g., stop if price falls more than X% from initial entry), or continue up to D by default.

---

## Integration with other strategies
- 52W Low strategy: initial entry often comes from the 52W low trigger. ABCD tranches A–D are placed relative to that initial entry.
- Envelope strategies: if initial entry is from the lower envelope, ABCD can be invoked to add tranches as price falls further.

---

## Dynamic parameters (defaults)
- `step_pct` = 10.0
- `num_tranches` = 5
- `total_allocation_pct` = per-cap-tier allocation by default
- `per_tranche_equal` = true
- `max_drawdown_from_entry_pct` = optional, None by default

---

## Recording & outputs
- Record each tranche with: `tranche_id` (initial/A/B/C/D), `buy_date`, `buy_price`, `size_pct`, `shares`, `sell_date`, `sell_price`, `pnl_pct`, `pnl_value`.
- Maintain a per-stock `abcd` sub-structure under `strategies/abcd/` in the daily JSON output.

---

## Implementation notes for developers
- File name: `abcd_strategy.md` — canonical instruction file for coding.
- Use daily OHLC fills; buy when `low <= tranche_price`; sell when `high >= sell_trigger` for tranche.
- FIFO is assumed for profit accounting; record transaction-level events so any accounting layer can aggregate PnL later.


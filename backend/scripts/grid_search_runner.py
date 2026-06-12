"""Standalone grid search runner — called by the FastAPI backend as a subprocess.

Streams results to stdout as NDJSON:
  {"type": "meta",   "n_total": N}
  {"type": "result", "cagr": x, "env_pct": y, ...}   (one per combo)
  {"type": "done",   "n_done": N}

Usage (called by grid_search.py route):
  python grid_search_runner.py --env-pcts 12,13,14 --zone-pcts 0,0.5,1 --years 10
"""

import argparse
import datetime
import json
import multiprocessing as mp
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from itertools import product
from pathlib import Path

ROOT    = Path(__file__).resolve().parent.parent.parent
SCRIPTS = ROOT / "Scripts" / "strategies"
WLIST   = ROOT / "Source Data" / "Watchlist"

sys.path.insert(0, str(SCRIPTS))

from f40_backtest_common import fetch_all_stocks_parallel, parse_f40_watchlist  # noqa: E402
from envelope_portfolio_backtest import _prepare, _to_arrays, _run_simulation, _compute_metrics  # noqa: E402

ALLOC_LARGE  = [3.0, 4.0, 5.0]
ALLOC_MID    = [2.0, 2.5, 3.0, 3.5]
ALLOC_SMALL  = [1.5, 2.0, 2.5]
EXIT_MODES   = ["fixed", "rolling"]
PYRAMID_OPTS = [True, False]
INITIAL_CAP  = 100_000.0

# ── Worker globals — initialised once per subprocess ─────────────────────────

_g_arrays_by_env: dict = {}
_g_stocks_meta:   dict = {}
_g_sim_start:     str  = ""
_g_sim_end:       str  = ""


def _worker_init(raw_dfs: dict, stocks_meta: dict, s_start: str, s_end: str, envelope_pcts: list) -> None:
    global _g_arrays_by_env, _g_stocks_meta, _g_sim_start, _g_sim_end
    _g_stocks_meta = stocks_meta
    _g_sim_start   = s_start
    _g_sim_end     = s_end
    for env_pct in envelope_pcts:
        stocks_df = {t: _prepare(df, env_pct) for t, df in raw_dfs.items() if len(df) >= 250}
        _g_arrays_by_env[env_pct] = _to_arrays(stocks_df)


def _worker_run_combo(args: tuple) -> dict:
    env_pct, zone_pct, alloc_l, alloc_m, alloc_s, exit_mode, pyramid = args
    allocations = {
        "Large Cap": alloc_l / 100,
        "Mid Cap":   alloc_m / 100,
        "Small Cap": alloc_s / 100,
    }
    trades, ec = _run_simulation(
        {},
        _g_stocks_meta,
        active_strategies=("LONG_FULL",),
        sim_start=_g_sim_start,
        sim_end=_g_sim_end,
        allocations=allocations,
        entry_band=zone_pct / 100,
        exit_mode=exit_mode,
        pyramid=pyramid,
        _prebuilt_arrays=_g_arrays_by_env[env_pct],
    )
    m = _compute_metrics(trades, ec, INITIAL_CAP)
    return {
        "cagr":         m.get("cagr_pct", 0.0),
        "total_return": m.get("total_return_pct", 0.0),
        "env_pct":      env_pct,
        "zone_pct":     zone_pct,
        "alloc_large":  alloc_l,
        "alloc_mid":    alloc_m,
        "alloc_small":  alloc_s,
        "exit_mode":    exit_mode,
        "pyramid":      pyramid,
        "trades":       m.get("total_trades", 0),
        "win_rate":     m.get("win_rate_pct", 0.0),
        "max_dd":       m.get("max_drawdown_pct", 0.0),
        "time_in_mkt":  m.get("time_in_market_pct", 0.0),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Envelope grid search runner.")
    parser.add_argument("--env-pcts",  required=True, help="Comma-separated env% values")
    parser.add_argument("--zone-pcts", required=True, help="Comma-separated zone% values")
    parser.add_argument("--years",     type=int, default=10)
    args = parser.parse_args()

    envelope_pcts = [float(x) for x in args.env_pcts.split(",")]
    zone_pcts     = [float(x) for x in args.zone_pcts.split(",")]
    years         = args.years

    sim_end   = datetime.date.today().isoformat()
    sim_start = (datetime.date.today() - datetime.timedelta(days=int(years * 365.25))).isoformat()

    raw_stocks  = parse_f40_watchlist(WLIST / "F40.txt")
    stocks_meta = {t: (cap, sec) for t, (cap, sec) in raw_stocks.items()}
    raw_dfs     = fetch_all_stocks_parallel(raw_stocks, years=years + 2, errors=[])

    all_combos = list(product(
        envelope_pcts, zone_pcts, ALLOC_LARGE, ALLOC_MID, ALLOC_SMALL, EXIT_MODES, PYRAMID_OPTS
    ))
    total     = len(all_combos)
    n_workers = min(mp.cpu_count() - 1, total, 11)

    print(json.dumps({"type": "meta", "n_total": total}), flush=True)

    n_done = 0
    with ProcessPoolExecutor(
        max_workers=max(1, n_workers),
        initializer=_worker_init,
        initargs=(raw_dfs, stocks_meta, sim_start, sim_end, envelope_pcts),
    ) as executor:
        futures = [executor.submit(_worker_run_combo, combo) for combo in all_combos]
        for future in as_completed(futures):
            try:
                r = future.result()
                n_done += 1
                print(json.dumps({"type": "result", **r}), flush=True)
            except Exception as exc:
                print(json.dumps({"type": "error", "msg": str(exc)}), flush=True)

    print(json.dumps({"type": "done", "n_done": n_done}), flush=True)


if __name__ == "__main__":
    mp.freeze_support()
    main()

"""
envelope_grid_search.py — Parallel parameter sweep for Envelope LONG_FULL strategy.

Each combo is submitted as an independent ProcessPoolExecutor future.
Arrays are pre-built once per envelope % in the worker initializer (no rebuild per combo).
Results are written to CSV immediately as each future completes.

Outputs:
  Source Data/Downloaded Data/envelope_grid_results.csv   (sorted by CAGR on completion)
  docs/envelope_grid_summary.md
"""

import csv
import datetime
import multiprocessing as mp
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from itertools import product
from pathlib import Path
from typing import Dict, List, Tuple

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from f40_backtest_common import fetch_all_stocks_parallel, parse_f40_watchlist
from envelope_portfolio_backtest import _prepare, _to_arrays, _run_simulation, _compute_metrics

ROOT        = Path(__file__).resolve().parent.parent.parent
F40_PATH    = ROOT / 'Source Data' / 'Watchlist' / 'F40.txt'
DOWNLOADS   = ROOT / 'Source Data' / 'Downloaded Data'
DOCS_DIR    = ROOT / 'docs'
DATA_YEARS  = 10
INITIAL_CAP = 100_000.0

SIM_YEARS = 10
sim_end   = datetime.date.today().isoformat()
sim_start = (datetime.date.today() - datetime.timedelta(days=int(SIM_YEARS * 365.25))).isoformat()

ENVELOPE_PCTS = [12.0, 13.0, 14.0, 15.0, 16.0, 17.0]
ZONE_PCTS     = [0.0,  0.5,  1.0,  1.5,  2.0,  2.5]
ALLOC_LARGE   = [3.0,  4.0,  5.0]
ALLOC_MID     = [2.0,  2.5,  3.0,  3.5]
ALLOC_SMALL   = [1.5,  2.0,  2.5]
EXIT_MODES    = ['fixed', 'rolling']
PYRAMID_OPTS  = [True, False]

RESULT_COLS = [
    'cagr', 'env_pct', 'zone_pct',
    'alloc_large', 'alloc_mid', 'alloc_small',
    'exit_mode', 'pyramid',
    'trades', 'win_rate', 'max_dd', 'time_in_mkt', 'total_return',
]

# ── Worker globals (initialised once per subprocess) ─────────────────────────

_g_arrays_by_env: Dict[float, dict] = {}  # {env_pct: {ticker: arrays}}
_g_stocks_meta:   Dict[str, Tuple[str, str]] = {}
_g_sim_start:     str = ''
_g_sim_end:       str = ''


def _worker_init(raw_dfs, stocks_meta, s_start, s_end):
    global _g_arrays_by_env, _g_stocks_meta, _g_sim_start, _g_sim_end
    _g_stocks_meta = stocks_meta
    _g_sim_start   = s_start
    _g_sim_end     = s_end
    # Build numpy arrays once per envelope % — reused across all combos in this worker
    for env_pct in ENVELOPE_PCTS:
        stocks_df = {t: _prepare(df, env_pct) for t, df in raw_dfs.items() if len(df) >= 250}
        _g_arrays_by_env[env_pct] = _to_arrays(stocks_df)


def _worker_run_combo(args) -> dict:
    env_pct, zone_pct, alloc_l, alloc_m, alloc_s, exit_mode, pyramid = args
    allocations = {
        'Large Cap': alloc_l / 100,
        'Mid Cap':   alloc_m / 100,
        'Small Cap': alloc_s / 100,
    }
    trades, ec = _run_simulation(
        {},               # stocks_df unused when _prebuilt_arrays is provided
        _g_stocks_meta,
        active_strategies=('LONG_FULL',),
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
        'cagr':         m.get('cagr_pct', 0.0),
        'total_return': m.get('total_return_pct', 0.0),
        'env_pct':      env_pct,
        'zone_pct':     zone_pct,
        'alloc_large':  alloc_l,
        'alloc_mid':    alloc_m,
        'alloc_small':  alloc_s,
        'exit_mode':    exit_mode,
        'pyramid':      pyramid,
        'trades':       m.get('total_trades', 0),
        'win_rate':     m.get('win_rate_pct', 0.0),
        'max_dd':       m.get('max_drawdown_pct', 0.0),
        'time_in_mkt':  m.get('time_in_market_pct', 0.0),
    }


# ── Summary MD ────────────────────────────────────────────────────────────────

def _write_summary_md(results: List[dict], path: Path, total: int, elapsed_min: float) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sorted_r = sorted(results, key=lambda r: r['cagr'], reverse=True)
    best = sorted_r[0]

    def fmt_row(rank, r):
        pyr = 'Yes' if r['pyramid'] else 'No'
        return (f"| {rank} | {r['cagr']:.2f}% | {r['env_pct']:.0f}% | {r['zone_pct']:.1f}% | "
                f"{r['alloc_large']:.1f}% | {r['alloc_mid']:.1f}% | {r['alloc_small']:.1f}% | "
                f"{r['exit_mode']} | {pyr} | {r['trades']} | {r['win_rate']:.1f}% | "
                f"{r['max_dd']:.1f}% |")

    best_fixed   = next(r for r in sorted_r if r['exit_mode'] == 'fixed')
    best_rolling = next(r for r in sorted_r if r['exit_mode'] == 'rolling')
    best_pyr     = next(r for r in sorted_r if r['pyramid'])
    best_nopyr   = next(r for r in sorted_r if not r['pyramid'])
    top20        = sorted_r[:20]

    def top20_counts(key):
        counts = {}
        for r in top20:
            v = r[key]
            counts[v] = counts.get(v, 0) + 1
        return sorted(counts.items(), key=lambda x: -x[1])

    def best_row(r):
        pyr = 'Yes' if r['pyramid'] else 'No'
        return (f"| {r['cagr']:.2f}% | {r['env_pct']:.0f}% | {r['zone_pct']:.1f}% | "
                f"{r['alloc_large']:.1f}% | {r['alloc_mid']:.1f}% | {r['alloc_small']:.1f}% | "
                f"{pyr} | {r['trades']} | {r['win_rate']:.1f}% | {r['max_dd']:.1f}% |")

    lines = [
        "# Envelope Strategy Grid Search Results",
        "",
        f"**Run date:** {datetime.date.today().isoformat()}  ",
        f"**Simulation window:** {sim_start} → {sim_end} ({SIM_YEARS} years)  ",
        f"**Total combinations tested:** {total}  ",
        f"**Elapsed:** {elapsed_min:.1f} minutes  ",
        "",
        "## Parameter Ranges Tested",
        "",
        "| Parameter | Range |",
        "|-----------|-------|",
        "| Envelope % | 12–17% (1% steps) |",
        "| Zone % | 0–2.5% (0.5% steps) |",
        "| Large Cap alloc | 3–5% |",
        "| Mid Cap alloc | 2–3.5% |",
        "| Small Cap alloc | 1.5–2.5% |",
        "| Exit mode | fixed, rolling |",
        "| Pyramid | Yes, No |",
        "",
        "## Top 20 Combinations (by CAGR)",
        "",
        "| Rank | CAGR | Env% | Zone% | Large% | Mid% | Small% | Exit | Pyramid | Trades | WinR% | MaxDD% |",
        "|------|------|------|-------|--------|------|--------|------|---------|--------|-------|--------|",
    ]
    for i, r in enumerate(top20, 1):
        lines.append(fmt_row(i, r))

    lines += [
        "",
        "## Best by Category",
        "",
        "### Best — Fixed Exit",
        "| CAGR | Env% | Zone% | Large% | Mid% | Small% | Pyramid | Trades | WinR% | MaxDD% |",
        "|------|------|-------|--------|------|--------|---------|--------|-------|--------|",
        best_row(best_fixed),
        "",
        "### Best — Rolling Exit",
        "| CAGR | Env% | Zone% | Large% | Mid% | Small% | Pyramid | Trades | WinR% | MaxDD% |",
        "|------|------|-------|--------|------|--------|---------|--------|-------|--------|",
        best_row(best_rolling),
        "",
        "### Best — With Pyramid",
        "| CAGR | Env% | Zone% | Large% | Mid% | Small% | Exit | Trades | WinR% | MaxDD% |",
        "|------|------|-------|--------|------|--------|------|--------|-------|--------|",
        (f"| {best_pyr['cagr']:.2f}% | {best_pyr['env_pct']:.0f}% | {best_pyr['zone_pct']:.1f}% | "
         f"{best_pyr['alloc_large']:.1f}% | {best_pyr['alloc_mid']:.1f}% | {best_pyr['alloc_small']:.1f}% | "
         f"{best_pyr['exit_mode']} | {best_pyr['trades']} | {best_pyr['win_rate']:.1f}% | {best_pyr['max_dd']:.1f}% |"),
        "",
        "### Best — Without Pyramid",
        "| CAGR | Env% | Zone% | Large% | Mid% | Small% | Exit | Trades | WinR% | MaxDD% |",
        "|------|------|-------|--------|------|--------|------|--------|-------|--------|",
        (f"| {best_nopyr['cagr']:.2f}% | {best_nopyr['env_pct']:.0f}% | {best_nopyr['zone_pct']:.1f}% | "
         f"{best_nopyr['alloc_large']:.1f}% | {best_nopyr['alloc_mid']:.1f}% | {best_nopyr['alloc_small']:.1f}% | "
         f"{best_nopyr['exit_mode']} | {best_nopyr['trades']} | {best_nopyr['win_rate']:.1f}% | {best_nopyr['max_dd']:.1f}% |"),
        "",
        "## Top 20 Pattern Analysis",
        "",
        "| Parameter | Value | Count in Top 20 |",
        "|-----------|-------|-----------------|",
    ]
    for v, cnt in top20_counts('env_pct'):
        lines.append(f"| Envelope % | {v:.0f}% | {cnt}/20 |")
    for v, cnt in top20_counts('zone_pct'):
        lines.append(f"| Zone % | {v:.1f}% | {cnt}/20 |")
    for v, cnt in top20_counts('exit_mode'):
        lines.append(f"| Exit mode | {v} | {cnt}/20 |")
    for v, cnt in top20_counts('pyramid'):
        lines.append(f"| Pyramid | {'Yes' if v else 'No'} | {cnt}/20 |")
    for v, cnt in top20_counts('alloc_large'):
        lines.append(f"| Large alloc | {v:.1f}% | {cnt}/20 |")
    for v, cnt in top20_counts('alloc_mid'):
        lines.append(f"| Mid alloc | {v:.1f}% | {cnt}/20 |")
    for v, cnt in top20_counts('alloc_small'):
        lines.append(f"| Small alloc | {v:.1f}% | {cnt}/20 |")

    pyr_label = 'Yes' if best['pyramid'] else 'No'
    lines += [
        "",
        "## Recommended Configuration",
        "",
        f"Based on maximum CAGR over the {SIM_YEARS}-year simulation window:",
        "",
        "| Parameter | Value |",
        "|-----------|-------|",
        f"| Envelope % | **{best['env_pct']:.0f}%** |",
        f"| Zone % | **{best['zone_pct']:.1f}%** |",
        f"| Large Cap allocation | **{best['alloc_large']:.1f}%** |",
        f"| Mid Cap allocation | **{best['alloc_mid']:.1f}%** |",
        f"| Small Cap allocation | **{best['alloc_small']:.1f}%** |",
        f"| Exit mode | **{best['exit_mode']}** |",
        f"| Pyramid | **{pyr_label}** |",
        "",
        (f"**CAGR: {best['cagr']:.2f}%**  |  "
         f"Total return: {best['total_return']:.1f}%  |  "
         f"Trades: {best['trades']}  |  "
         f"Win rate: {best['win_rate']:.1f}%  |  "
         f"Max drawdown: {best['max_dd']:.1f}%  |  "
         f"Time in market: {best['time_in_mkt']:.1f}%"),
        "",
        "---",
        "*Full results: `Source Data/Downloaded Data/envelope_grid_results_10y.csv`*",
    ]
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    t_start = datetime.datetime.now()

    print("Loading F40 watchlist...")
    raw_stocks = parse_f40_watchlist(F40_PATH)
    stocks_meta: Dict[str, Tuple[str, str]] = {
        t: (cap, sec) for t, (cap, sec) in raw_stocks.items()
    }
    print(f"  {len(stocks_meta)} stocks")

    errors: List[str] = []
    print(f"Downloading {DATA_YEARS}-year OHLCV data (cache-aware)...")
    raw_dfs = fetch_all_stocks_parallel(raw_stocks, years=DATA_YEARS, errors=errors)
    print(f"  {len(raw_dfs)} stocks downloaded, {len(errors)} errors")

    all_combos = list(product(
        ENVELOPE_PCTS, ZONE_PCTS, ALLOC_LARGE, ALLOC_MID, ALLOC_SMALL, EXIT_MODES, PYRAMID_OPTS
    ))
    total     = len(all_combos)
    n_workers = min(mp.cpu_count() - 1, total, 11)
    print(f"\nRunning {total} combinations across {n_workers} workers "
          f"(arrays pre-built once per worker)...\n")

    csv_path = DOWNLOADS / 'envelope_grid_results_10y.csv'
    if csv_path.exists():
        csv_path.unlink()
    csv_path.parent.mkdir(parents=True, exist_ok=True)

    all_results: List[dict] = []

    with open(csv_path, 'w', newline='', encoding='utf-8') as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=RESULT_COLS)
        writer.writeheader()
        csv_file.flush()
        print(f"Live CSV: {csv_path}\n", flush=True)

        with ProcessPoolExecutor(
            max_workers=n_workers,
            initializer=_worker_init,
            initargs=(raw_dfs, stocks_meta, sim_start, sim_end),
        ) as executor:
            futures = {executor.submit(_worker_run_combo, combo): combo for combo in all_combos}

            for future in as_completed(futures):
                r = future.result()
                all_results.append(r)
                writer.writerow({k: r[k] for k in RESULT_COLS})
                csv_file.flush()

                done    = len(all_results)
                elapsed = (datetime.datetime.now() - t_start).total_seconds()
                eta_s   = (elapsed / done) * (total - done)
                best    = max(all_results, key=lambda x: x['cagr'])
                pyr_lbl = 'pyr' if best['pyramid'] else 'nopyr'
                print(f"  [{done}/{total}]  this={r['cagr']:.2f}%  best={best['cagr']:.2f}%  "
                      f"(env={best['env_pct']:.0f}% zone={best['zone_pct']:.1f}% "
                      f"L={best['alloc_large']:.1f}% M={best['alloc_mid']:.1f}% S={best['alloc_small']:.1f}% "
                      f"{best['exit_mode']} {pyr_lbl})  ETA {eta_s/60:.1f}min",
                      flush=True)

    elapsed_total = (datetime.datetime.now() - t_start).total_seconds()

    # Re-write CSV sorted by CAGR
    all_results.sort(key=lambda r: r['cagr'], reverse=True)
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=RESULT_COLS)
        writer.writeheader()
        for r in all_results:
            writer.writerow({k: r[k] for k in RESULT_COLS})
    print(f"\nCSV (sorted) saved: {csv_path}")

    # Print top 30
    print("\n" + "=" * 115)
    print(f"{'Rank':<5} {'CAGR':>7} {'Env%':>5} {'Zone%':>6} {'Lg%':>5} {'Mid%':>5} {'Sm%':>5} "
          f"{'Exit':<8} {'Pyr':<4} {'Trades':>7} {'WinR%':>7} {'MaxDD%':>8} {'Time%':>6}")
    print("-" * 115)
    for i, r in enumerate(all_results[:30], 1):
        pyr = 'Y' if r['pyramid'] else 'N'
        print(f"{i:<5} {r['cagr']:>7.2f} {r['env_pct']:>5.0f} {r['zone_pct']:>6.1f} "
              f"{r['alloc_large']:>5.1f} {r['alloc_mid']:>5.1f} {r['alloc_small']:>5.1f} "
              f"{r['exit_mode']:<8} {pyr:<4} {r['trades']:>7} {r['win_rate']:>7.1f} "
              f"{r['max_dd']:>8.1f} {r['time_in_mkt']:>6.1f}")

    best    = all_results[0]
    pyr_lbl = 'Yes' if best['pyramid'] else 'No'
    print(f"\n{'='*60}")
    print(f"BEST COMBINATION — CAGR {best['cagr']:.2f}%")
    print(f"  Envelope:    {best['env_pct']:.0f}%")
    print(f"  Zone:        {best['zone_pct']:.1f}%")
    print(f"  Allocations: Large={best['alloc_large']:.1f}%  Mid={best['alloc_mid']:.1f}%  Small={best['alloc_small']:.1f}%")
    print(f"  Exit mode:   {best['exit_mode']}")
    print(f"  Pyramid:     {pyr_lbl}")
    print(f"  Trades: {best['trades']}  Win rate: {best['win_rate']:.1f}%  Max DD: {best['max_dd']:.1f}%")
    print(f"{'='*60}")

    md_path = DOCS_DIR / 'envelope_grid_summary_10y.md'
    _write_summary_md(all_results, md_path, total, elapsed_total / 60)
    print(f"\nSummary MD: {md_path}")
    print(f"Total elapsed: {elapsed_total/60:.1f} minutes")


if __name__ == '__main__':
    main()

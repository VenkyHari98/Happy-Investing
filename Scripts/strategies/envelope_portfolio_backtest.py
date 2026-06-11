"""
envelope_portfolio_backtest.py — Standalone Envelope Strategy Portfolio Backtest (F40 only).

Three mean-reversion envelope strategies on a 200-period SMA:

  LONG_FULL   Enter at lower envelope (MA × 0.86); exit at upper envelope (MA × 1.14)
  LOWER_HALF  Enter at lower envelope; exit at 200 DMA  (half-range, shorter hold)
  UPPER_HALF  Enter at 200 DMA when rising from below; exit at upper envelope

  COMBINED    All three strategies running simultaneously in one shared cash pool

F40 stocks only.  Allocations: Large Cap 3% | Mid Cap 2% | Small Cap 1%.
No ABCD averaging — single position per strategy per ticker (plus optional pyramid-up at 200 DMA).

Exit modes:
  fixed   — Exit target locked at entry-time upper envelope price (default)
  rolling — Exit when current upper envelope (today's MA × 1+env_pct%) is hit

Output (Source Data/Downloaded Data/):
  env_pb_long.json
  env_pb_lower.json
  env_pb_upper.json
  env_pb_combined.json
"""

import argparse
import datetime
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from f40_backtest_common import fetch_all_stocks_parallel, parse_f40_watchlist

ROOT       = Path(__file__).resolve().parent.parent.parent
F40_PATH   = ROOT / 'Source Data' / 'Watchlist' / 'F40.txt'
DOWNLOADS  = ROOT / 'Source Data' / 'Downloaded Data'

SIM_YEARS   = 10
DATA_YEARS  = 12      # warmup for 200-period MA
INITIAL_CAP = 100_000.0
SLIPPAGE    = 0.001   # 0.1 % per side

ALL_STRATEGIES = ('LONG_FULL', 'LOWER_HALF', 'UPPER_HALF')


# ── Data prep ──────────────────────────────────────────────────────────────────

def _prepare(df: pd.DataFrame, env_pct: float) -> pd.DataFrame:
    df = df.copy()
    df['ma200']     = df['close'].rolling(200, min_periods=200).mean()
    df['env_lower'] = df['ma200'] * (1 - env_pct / 100)
    df['env_upper'] = df['ma200'] * (1 + env_pct / 100)
    df.index = pd.DatetimeIndex(df.index).tz_localize(None) if df.index.tz else df.index
    df.index = df.index.normalize()
    return df


def _to_arrays(stocks_df: Dict[str, pd.DataFrame]) -> Dict[str, dict]:
    """Convert prepared DataFrames to numpy arrays + index map for fast O(1) lookups."""
    out = {}
    for ticker, df in stocks_df.items():
        ma  = df['ma200'].values
        lo  = df['env_lower'].values
        hi  = df['env_upper'].values
        out[ticker] = {
            'idx_map':   {ts: i for i, ts in enumerate(df.index)},
            'close':     df['close'].values,
            'high':      df['high'].values,
            'low':       df['low'].values,
            'ma200':     ma,
            'env_lower': lo,
            'env_upper': hi,
            'nan_mask':  np.isnan(ma) | np.isnan(lo) | np.isnan(hi),
        }
    return out


# ── Portfolio simulation ───────────────────────────────────────────────────────

def _run_simulation(
    stocks_df: Dict[str, pd.DataFrame],
    stocks_meta: Dict[str, Tuple[str, str]],   # {ticker: (cap_tier, sector)}
    active_strategies: Tuple[str, ...],
    sim_start: str,
    sim_end: str,
    *,
    allocations: Dict[str, float],
    entry_band: float,
    exit_mode: str,
    pyramid: bool,
    _prebuilt_arrays: Optional[Dict[str, dict]] = None,  # skip _to_arrays when pre-built
) -> Tuple[List[dict], List[dict]]:
    cash = INITIAL_CAP
    open_pos: Dict[Tuple[str, str], dict] = {}
    closed_trades: List[dict] = []
    equity_curve:  List[dict] = []
    trade_seq = 0

    # Use pre-built arrays if provided (grid search path), else build from DataFrames
    arrays = _prebuilt_arrays if _prebuilt_arrays is not None else _to_arrays(stocks_df)

    all_dates: List[pd.Timestamp] = sorted(
        {ts for arr in arrays.values() for ts in arr['idx_map']}
    )
    start_ts  = pd.Timestamp(sim_start)
    end_ts    = pd.Timestamp(sim_end)
    sim_dates = [d for d in all_dates if start_ts <= d <= end_ts]

    prev_close:   Dict[str, float] = {}
    prices_today: Dict[str, float] = {}

    for ts in sim_dates:
        date = ts.strftime('%Y-%m-%d')

        # Build today's close prices for mark-to-market
        prices_today = {}
        for ticker, arr in arrays.items():
            if ts in arr['idx_map']:
                prices_today[ticker] = float(arr['close'][arr['idx_map'][ts]])

        # ── Exits (process before entries so freed cash can be reused) ─────────
        exits_today: List[Tuple] = []
        for (strat, ticker), pos in open_pos.items():
            arr = arrays.get(ticker)
            if arr is None or ts not in arr['idx_map']:
                continue
            idx = arr['idx_map'][ts]
            if arr['nan_mask'][idx]:
                continue
            high  = arr['high'][idx]
            low   = arr['low'][idx]
            ma    = arr['ma200'][idx]
            upper = arr['env_upper'][idx]

            exit_price  = None
            exit_reason = None

            if strat == 'LONG_FULL':
                if exit_mode == 'fixed':
                    trigger = pos['exit_target'] * (1 - entry_band)
                    if high >= trigger:
                        exit_price  = pos['exit_target']
                        exit_reason = 'ENV_EXIT'
                else:
                    trigger = upper * (1 - entry_band)
                    if high >= trigger:
                        exit_price  = upper
                        exit_reason = 'ENV_EXIT'
            elif strat == 'LOWER_HALF':
                trigger = ma * (1 - entry_band)
                if high >= trigger:
                    exit_price  = ma
                    exit_reason = 'MA_EXIT'
            elif strat == 'UPPER_HALF':
                trigger = upper * (1 - entry_band)
                if high >= trigger:
                    exit_price  = upper
                    exit_reason = 'ENV_EXIT'

            if exit_price is not None:
                exits_today.append((strat, ticker, date, exit_price, exit_reason))
            else:
                cur_val  = pos['shares'] * low
                drawdown = pos['entry_value'] - cur_val
                if drawdown > pos['max_drawdown']:
                    pos['max_drawdown'] = drawdown

        for (strat, ticker, exit_date, exit_price, exit_reason) in exits_today:
            pos = open_pos.pop((strat, ticker))

            exit_val  = pos['shares'] * exit_price
            slip_exit = exit_val * SLIPPAGE
            gross_pnl = exit_val - pos['entry_value']
            net_pnl   = gross_pnl - pos['entry_value'] * SLIPPAGE - slip_exit
            pnl_pct   = net_pnl / pos['entry_value'] * 100
            duration  = (
                datetime.datetime.strptime(exit_date, '%Y-%m-%d') -
                datetime.datetime.strptime(pos['entry_date'], '%Y-%m-%d')
            ).days
            max_dd_pct = (
                -(pos['max_drawdown'] / pos['entry_value']) * 100
                if pos['max_drawdown'] > 0 else 0.0
            )
            cash += exit_val - slip_exit
            trade_seq += 1
            closed_trades.append({
                'trade_id':             f"{strat}_{ticker}_{trade_seq:04d}",
                'strategy':             strat,
                'ticker':               ticker,
                'cap_tier':             pos['cap_tier'],
                'sector':               pos['sector'],
                'tranche':              'INITIAL',
                'entry_date':           pos['entry_date'],
                'entry_price':          round(pos['entry_price'], 2),
                'exit_target':          round(pos['exit_target'], 2),
                'exit_date':            exit_date,
                'exit_price':           round(exit_price, 2),
                'exit_reason':          exit_reason,
                'trade_duration_days':  duration,
                'position_value':       round(pos['entry_value'], 2),
                'shares':               round(pos['shares'], 4),
                'pnl':                  round(net_pnl, 2),
                'pnl_pct':              round(pnl_pct, 4),
                'max_drawdown_pct':     round(max_dd_pct, 4),
                'pyramided':            pos.get('pyramided', False),
            })

        # ── Entries ────────────────────────────────────────────────────────────
        deployed_val = sum(
            p['shares'] * prices_today.get(tk, p['entry_price'])
            for (_, tk), p in open_pos.items()
        )
        portfolio_val = cash + deployed_val

        for ticker, (cap_tier, sector) in stocks_meta.items():
            arr = arrays.get(ticker)
            if arr is None or ts not in arr['idx_map']:
                continue
            idx   = arr['idx_map'][ts]
            close = float(arr['close'][idx])
            if arr['nan_mask'][idx]:
                prev_close[ticker] = close
                continue
            low   = arr['low'][idx]
            high  = arr['high'][idx]
            ma    = arr['ma200'][idx]
            lower = arr['env_lower'][idx]
            upper = arr['env_upper'][idx]

            alloc   = allocations.get(cap_tier, 0.02)
            pos_val = portfolio_val * alloc

            for strat in active_strategies:
                key = (strat, ticker)

                # Pyramid-up: add second tranche for open LONG_FULL position on 200 DMA cross
                if pyramid and strat == 'LONG_FULL' and key in open_pos:
                    pos = open_pos[key]
                    if not pos.get('pyramided', False):
                        pc = prev_close.get(ticker, close)
                        if pc < ma and close >= ma * (1 - entry_band):
                            pyramid_alloc_val = portfolio_val * alloc * (2 / 3)
                            pyramid_cost      = pyramid_alloc_val * (1 + SLIPPAGE)
                            if pyramid_cost <= cash:
                                extra_shares   = pyramid_alloc_val / close
                                old_val        = pos['entry_value']
                                new_val        = old_val + pyramid_alloc_val
                                pos['entry_price'] = (
                                    pos['entry_price'] * old_val + close * pyramid_alloc_val
                                ) / new_val
                                pos['shares']      += extra_shares
                                pos['entry_value'] = new_val
                                cash               -= pyramid_cost
                                pos['pyramided']   = True
                    continue  # already in position; skip standard entry

                if key in open_pos:
                    continue

                entry_price: Optional[float] = None
                exit_target: Optional[float] = None

                if strat == 'LONG_FULL':
                    if low <= lower * (1 + entry_band):
                        entry_price = lower
                        exit_target = upper

                elif strat == 'LOWER_HALF':
                    if low <= lower * (1 + entry_band):
                        entry_price = lower
                        exit_target = ma

                elif strat == 'UPPER_HALF':
                    pc = prev_close.get(ticker, ma)
                    crossing_up = pc < ma and close >= ma * (1 - entry_band)
                    if crossing_up and low <= ma * (1 + entry_band):
                        entry_price = ma
                        exit_target = upper

                if entry_price is None:
                    continue

                cost = pos_val * (1 + SLIPPAGE)
                if cost > cash:
                    continue

                shares = pos_val / entry_price
                cash  -= cost

                open_pos[key] = {
                    'entry_date':   date,
                    'entry_price':  entry_price,
                    'exit_target':  exit_target,
                    'shares':       shares,
                    'entry_value':  pos_val,
                    'cap_tier':     cap_tier,
                    'sector':       sector,
                    'max_drawdown': 0.0,
                    'pyramided':    False,
                }

            prev_close[ticker] = close

        # ── Equity snapshot ────────────────────────────────────────────────────
        deployed = sum(
            p['shares'] * prices_today.get(tk, p['entry_price'])
            for (_, tk), p in open_pos.items()
        )
        total = cash + deployed
        equity_curve.append({
            'date':        date,
            'total_value': round(total, 2),
            'cash':        round(cash, 2),
            'deployed':    round(deployed, 2),
            'open_count':  len(open_pos),
        })

    # Mark remaining open positions at last price
    trade_seq_open = len(closed_trades)
    for (strat, ticker), pos in open_pos.items():
        last_close = prices_today.get(ticker, pos['entry_price'])
        duration = (
            pd.Timestamp(sim_end) - pd.Timestamp(pos['entry_date'])
        ).days
        unreal_pnl = (last_close - pos['entry_price']) * pos['shares']
        pnl_pct    = (last_close - pos['entry_price']) / pos['entry_price'] * 100
        trade_seq_open += 1
        closed_trades.append({
            'trade_id':             f"{strat}_{ticker}_OPEN_{trade_seq_open:04d}",
            'strategy':             strat,
            'ticker':               ticker,
            'cap_tier':             pos['cap_tier'],
            'sector':               pos['sector'],
            'tranche':              'INITIAL',
            'entry_date':           pos['entry_date'],
            'entry_price':          round(pos['entry_price'], 2),
            'exit_target':          round(pos['exit_target'], 2),
            'exit_date':            None,
            'exit_price':           None,
            'exit_reason':          'OPEN',
            'trade_duration_days':  duration,
            'position_value':       round(pos['entry_value'], 2),
            'shares':               round(pos['shares'], 4),
            'pnl':                  round(unreal_pnl, 2),
            'pnl_pct':              round(pnl_pct, 4),
            'max_drawdown_pct':     round(
                -(pos['max_drawdown'] / pos['entry_value']) * 100
                if pos['max_drawdown'] > 0 else 0.0, 4
            ),
            'pyramided':            pos.get('pyramided', False),
        })

    return closed_trades, equity_curve


# ── Metrics ────────────────────────────────────────────────────────────────────

def _compute_metrics(
    trades: List[dict],
    equity_curve: List[dict],
    initial_cap: float,
) -> dict:
    closed = [t for t in trades if t['exit_reason'] != 'OPEN']
    if not equity_curve:
        return {}

    final_val  = equity_curve[-1]['total_value']
    start_date = equity_curve[0]['date']
    end_date   = equity_curve[-1]['date']
    years      = max(
        (datetime.datetime.strptime(end_date, '%Y-%m-%d') -
         datetime.datetime.strptime(start_date, '%Y-%m-%d')).days / 365.25,
        0.01
    )

    total_ret = (final_val - initial_cap) / initial_cap * 100
    cagr      = ((final_val / initial_cap) ** (1 / years) - 1) * 100 if years > 0 else 0

    wins    = sum(1 for t in closed if (t['pnl_pct'] or 0) > 0)
    n_cls   = len(closed)
    n_open  = sum(1 for t in trades if t['exit_reason'] == 'OPEN')
    wr      = wins / n_cls * 100 if n_cls else 0
    avg_dur = np.mean([t['trade_duration_days'] for t in closed]) if closed else 0
    avg_pnl = np.mean([t['pnl_pct'] for t in closed]) if closed else 0

    # Max drawdown on equity curve (peak-to-trough)
    totals  = [p['total_value'] for p in equity_curve]
    peak    = totals[0]
    max_dd  = 0.0
    for v in totals:
        if v > peak:
            peak = v
        dd = (peak - v) / peak * 100
        if dd > max_dd:
            max_dd = dd

    # Time in market
    tot_days   = len(equity_curve)
    days_in    = sum(1 for p in equity_curve if p['open_count'] > 0)
    time_in    = days_in / tot_days * 100 if tot_days else 0

    # Yearly returns
    by_year: Dict[str, List[float]] = {}
    yr_start: Dict[str, float] = {}
    for pt in equity_curve:
        yr = pt['date'][:4]
        if yr not in yr_start:
            yr_start[yr] = pt['total_value']
        by_year.setdefault(yr, []).append(pt['total_value'])
    yearly: Dict[str, float] = {}
    for yr, vals in by_year.items():
        start = yr_start[yr]
        end   = vals[-1]
        yearly[yr] = round((end - start) / start * 100, 2)

    # By cap tier
    by_tier: Dict[str, dict] = {}
    for t in closed:
        tier = t['cap_tier']
        if tier not in by_tier:
            by_tier[tier] = {'count': 0, 'wins': 0, 'pnl_sum': 0.0}
        by_tier[tier]['count'] += 1
        if (t['pnl_pct'] or 0) > 0:
            by_tier[tier]['wins'] += 1
        by_tier[tier]['pnl_sum'] += t['pnl_pct'] or 0

    cap_tier_stats = {
        tier: {
            'count':        d['count'],
            'wins':         d['wins'],
            'win_rate_pct': round(d['wins'] / d['count'] * 100, 1) if d['count'] else 0,
            'avg_pnl_pct':  round(d['pnl_sum'] / d['count'], 2) if d['count'] else 0,
        }
        for tier, d in by_tier.items()
    }

    return {
        'initial_capital':          initial_cap,
        'final_value':              round(final_val, 2),
        'total_return_pct':         round(total_ret, 2),
        'cagr_pct':                 round(cagr, 2),
        'xirr_pct':                 round(cagr, 2),
        'total_trades':             n_cls,
        'total_expired':            0,
        'open_at_end':              n_open,
        'wins':                     wins,
        'win_rate_pct':             round(wr, 2),
        'avg_trade_duration_days':  round(float(avg_dur), 1),
        'avg_trade_pnl_pct':        round(float(avg_pnl), 2),
        'max_drawdown_pct':         round(max_dd, 2),
        'time_in_market_pct':       round(time_in, 1),
        'yearly_returns':           yearly,
        'by_cap_tier':              cap_tier_stats,
    }


# ── Stock price data for trade charts ─────────────────────────────────────────

def _stock_prices(
    stocks_df: Dict[str, pd.DataFrame],
    sim_start: str,
    sim_end: str,
) -> Dict[str, List[dict]]:
    """Return {ticker: [{date, close, ma200, env_lower, env_upper}]} within sim window."""
    result: Dict[str, List[dict]] = {}
    start_ts = pd.Timestamp(sim_start)
    end_ts   = pd.Timestamp(sim_end)
    for ticker, df in stocks_df.items():
        rows = df[(df.index >= start_ts) & (df.index <= end_ts)]
        pts  = []
        for ts, row in rows.iterrows():
            pts.append({
                'date':      ts.strftime('%Y-%m-%d'),
                'close':     round(float(row['close']), 2),
                'ma200':     round(float(row['ma200']), 2) if not pd.isna(row['ma200']) else None,
                'env_lower': round(float(row['env_lower']), 2) if not pd.isna(row.get('env_lower', float('nan'))) else None,
                'env_upper': round(float(row['env_upper']), 2) if not pd.isna(row.get('env_upper', float('nan'))) else None,
            })
        if pts:
            result[ticker] = pts
    return result


# ── Output helpers ─────────────────────────────────────────────────────────────

def _build_output_dict(
    strategy_label: str,
    active_strategies: Tuple[str, ...],
    trades: List[dict],
    equity_curve: List[dict],
    stock_prices: Dict[str, List[dict]],
    sim_start: str,
    sim_end: str,
    stocks_count: int,
    env_pct: float,
    entry_band: float,
    allocations: Dict[str, float],
    exit_mode: str,
    pyramid: bool,
) -> dict:
    summary = _compute_metrics(trades, equity_curve, INITIAL_CAP)
    return {
        'meta': {
            'strategy':       strategy_label,
            'active_modes':   list(active_strategies),
            'envelope_pct':   env_pct,
            'entry_band_pct': entry_band * 100,
            'exit_mode':      exit_mode,
            'pyramid':        pyramid,
            'run_date':       datetime.date.today().isoformat(),
            'sim_start':      sim_start,
            'sim_end':        sim_end,
            'initial_capital': INITIAL_CAP,
            'stocks_count':   stocks_count,
            'allocations':    {k: {'INITIAL': v} for k, v in allocations.items()},
        },
        'summary':      summary,
        'equity_curve': equity_curve,
        'trades':       trades,
        'stock_prices': stock_prices,
    }


def _write_output(
    path: Path,
    strategy_label: str,
    active_strategies: Tuple[str, ...],
    trades: List[dict],
    equity_curve: List[dict],
    stock_prices: Dict[str, List[dict]],
    sim_start: str,
    sim_end: str,
    stocks_count: int,
    env_pct: float,
    entry_band: float,
    allocations: Dict[str, float],
    exit_mode: str,
    pyramid: bool,
    log=print,
) -> None:
    out = _build_output_dict(
        strategy_label, active_strategies, trades, equity_curve, stock_prices,
        sim_start, sim_end, stocks_count, env_pct, entry_band, allocations, exit_mode, pyramid,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2)
    cagr = out['summary'].get('cagr_pct', '?')
    log(f'  Written: {path.name}  ({len(trades)} trades, CAGR {cagr}%)')


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description='Envelope portfolio backtest (F40)')
    parser.add_argument('--years',       type=int,   default=SIM_YEARS,   help='Simulation window in years')
    parser.add_argument('--capital',     type=float, default=INITIAL_CAP, help='Starting capital')
    parser.add_argument('--env-pct',     type=float, default=14.0,        help='Envelope %% around 200 DMA (default 14)')
    parser.add_argument('--alloc-large', type=float, default=3.0,         help='Large Cap allocation %% (default 3)')
    parser.add_argument('--alloc-mid',   type=float, default=2.0,         help='Mid Cap allocation %% (default 2)')
    parser.add_argument('--alloc-small', type=float, default=1.0,         help='Small Cap allocation %% (default 1)')
    parser.add_argument('--entry-band',  type=float, default=1.0,         help='Entry/exit zone %% (default 1)')
    parser.add_argument('--exit-mode',   choices=['fixed', 'rolling'], default='fixed',
                        help='fixed=locked at entry, rolling=tracks current MA (default fixed)')
    parser.add_argument('--pyramid',     action='store_true',
                        help='Add 2nd tranche when price crosses 200 DMA from below')
    parser.add_argument('--stdout',      action='store_true',
                        help='Print LONG_FULL result JSON to stdout (for API use; no file writes)')
    args = parser.parse_args()

    # Runtime params
    env_pct    = args.env_pct
    entry_band = args.entry_band / 100
    allocations: Dict[str, float] = {
        'Large Cap': args.alloc_large / 100,
        'Mid Cap':   args.alloc_mid   / 100,
        'Small Cap': args.alloc_small / 100,
    }
    exit_mode = args.exit_mode
    pyramid   = args.pyramid

    # When --stdout, route all progress text to stderr so stdout is clean JSON
    log = (lambda *a, **k: print(*a, file=sys.stderr, **k)) if args.stdout else print

    sim_end   = datetime.date.today().isoformat()
    sim_start = (datetime.date.today() - datetime.timedelta(days=int(args.years * 365.25))).isoformat()

    log('Parsing F40 watchlist...')
    raw_stocks = parse_f40_watchlist(F40_PATH)
    stocks_meta: Dict[str, Tuple[str, str]] = {
        t: (cap, sec) for t, (cap, sec) in raw_stocks.items()
    }
    log(f'  {len(stocks_meta)} stocks')

    errors: List[str] = []
    log(f'Downloading {DATA_YEARS}-year OHLCV data (cache-aware)...')
    raw_dfs = fetch_all_stocks_parallel(raw_stocks, years=DATA_YEARS, errors=errors)
    if errors:
        log(f'  Data errors: {len(errors)}')

    log('Preparing indicators...')
    stocks_df: Dict[str, pd.DataFrame] = {}
    for ticker, df in raw_dfs.items():
        if len(df) < 250:
            continue
        stocks_df[ticker] = _prepare(df, env_pct)

    stocks_count = len(stocks_df)
    log(f'  Ready: {stocks_count} stocks with sufficient history')

    log('Computing stock price cache...')
    sp = _stock_prices(stocks_df, sim_start, sim_end)

    sim_kwargs = dict(
        allocations=allocations,
        entry_band=entry_band,
        exit_mode=exit_mode,
        pyramid=pyramid,
    )

    if args.stdout:
        # API mode: run LONG_FULL only, dump JSON to stdout
        log('Running LONG_FULL simulation...')
        trades, ec = _run_simulation(
            stocks_df, stocks_meta,
            active_strategies=('LONG_FULL',),
            sim_start=sim_start,
            sim_end=sim_end,
            **sim_kwargs,
        )
        out = _build_output_dict(
            'ENV_LONG_FULL', ('LONG_FULL',), trades, ec, sp,
            sim_start, sim_end, stocks_count,
            env_pct, entry_band, allocations, exit_mode, pyramid,
        )
        cagr = out['summary'].get('cagr_pct', '?')
        log(f'  {len(trades)} trades, CAGR {cagr}%')
        print(json.dumps(out, separators=(',', ':')))
        return

    # Batch mode: run all 4 modes and write to files
    modes = {
        'LONG':     ('LONG_FULL',),
        'LOWER':    ('LOWER_HALF',),
        'UPPER':    ('UPPER_HALF',),
        'COMBINED': ALL_STRATEGIES,
    }
    labels = {
        'LONG':     'ENV_LONG_FULL',
        'LOWER':    'ENV_LOWER_HALF',
        'UPPER':    'ENV_UPPER_HALF',
        'COMBINED': 'ENV_COMBINED',
    }

    for mode_key, active_strats in modes.items():
        log(f'\nRunning {mode_key} simulation...')
        trades, ec = _run_simulation(
            stocks_df, stocks_meta,
            active_strategies=active_strats,
            sim_start=sim_start,
            sim_end=sim_end,
            **sim_kwargs,
        )
        out_path = DOWNLOADS / f'env_pb_{mode_key.lower()}.json'
        _write_output(
            out_path,
            strategy_label=labels[mode_key],
            active_strategies=active_strats,
            trades=trades,
            equity_curve=ec,
            stock_prices=sp,
            sim_start=sim_start,
            sim_end=sim_end,
            stocks_count=stocks_count,
            env_pct=env_pct,
            entry_band=entry_band,
            allocations=allocations,
            exit_mode=exit_mode,
            pyramid=pyramid,
            log=log,
        )

    if errors:
        log('\nData errors encountered:')
        for e in errors[:10]:
            log(f'  {e}')

    log('\nDone. Run build_data.py to copy files to web/data/.')


if __name__ == '__main__':
    main()

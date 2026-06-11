"""
s200_portfolio_backtest.py — 20% Rally Strategy Portfolio Backtest.

Simulates the S200 20% rally strategy over 5 years with a shared ₹1L cash
pool and Smart Pyramid tranching:
  INITIAL entry when daily low enters the buy zone (buy_price ± 0.75%)
  ABCD_A   when price falls 10% below entry
  ABCD_B   when price falls 19% below entry  (large/mid cap only)
  MOMENTUM when price crosses back above 200 DMA (and in profit)

All tranches for a (ticker, rally_key) group share one exit target (sell_price)
and exit together on TARGET_HIT.  If the 1-year window expires, all open
tranches for that rally are closed at that day's close (EXPIRED).

Output: Source Data/Downloaded Data/s200_portfolio_backtest.json
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

from f40_backtest_common import (
    fetch_all_fundamentals_parallel,
    fetch_all_pe_series_parallel,
    fetch_all_stocks_parallel,
    fetch_historical_data,
    parse_f40_watchlist,
)
from s200_20pct_rally_scanner import BUY_ZONE_PCT, find_20pct_rallies
import fundamental_config as cfg
from portfolio_backtest_engine import (
    ALLOCATIONS,
    PortfolioSimulator,
    PortfolioTrade,
    compute_portfolio_metrics,
)

ROOT        = Path(__file__).resolve().parent.parent.parent
F40_PATH    = ROOT / 'Source Data' / 'Watchlist' / 'F40.txt'
E40_PATH    = ROOT / 'Source Data' / 'Watchlist' / 'E40.txt'
S200_PATH   = ROOT / 'Source Data' / 'Watchlist' / 'S200.txt'
OUTPUT_PATH = ROOT / 'Source Data' / 'Downloaded Data' / 's200_portfolio_backtest.json'

SIM_YEARS  = 10
DATA_YEARS = 12      # extra years for rally discovery + warmup (matches cache from s200 backtest)
INITIAL_CAP = 100_000.0

# ABCD_A: exits at full sell target (rally high) — shallow dip, worth riding the full move.
# ABCD_B/C/D: exit at intermediate levels — deep dips, recycle capital quickly within the 1-year window.
_S200_ABCD_EXIT = {'ABCD_B': 0.900, 'ABCD_C': 0.810, 'ABCD_D': 0.729}


def _load_watchlists() -> Dict[str, Tuple[str, str, str]]:
    """Return {ticker: (cap_tier, sector, watchlist_source)}."""
    stocks: Dict[str, Tuple[str, str, str]] = {}
    for path, label in ((F40_PATH, 'F40'), (E40_PATH, 'E40'), (S200_PATH, 'S200')):
        if path.exists():
            for ticker, (cap, sector) in parse_f40_watchlist(path).items():
                if ticker not in stocks:
                    stocks[ticker] = (cap, sector, label)
    return stocks


def _build_stock_data(
    stocks: Dict[str, Tuple[str, str, str]], errors: List[str]
) -> Dict[str, pd.DataFrame]:
    """Download history, compute indicators, and find all 20% rallies per stock."""
    print(f'  Downloading {len(stocks)} stocks in parallel ({DATA_YEARS}y each)...')
    raw = fetch_all_stocks_parallel(stocks, years=DATA_YEARS, errors=errors)
    result: Dict[str, pd.DataFrame] = {}
    for ticker, df in raw.items():
        if len(df) < 252:
            continue
        df = df.copy()
        df['ma200']   = df['close'].rolling(window=200, min_periods=200).mean()
        df['w52_high'] = df['close'].rolling(window=252, min_periods=1).max()
        if df.index.tz is not None:
            df.index = df.index.tz_convert(None)
        result[ticker] = df
    return result


def _build_rally_index(
    stocks_meta: Dict[str, Tuple[str, str, str]],
    stock_data: Dict[str, pd.DataFrame],
) -> Dict[str, List[dict]]:
    """Pre-compute all valid rallies for each stock keyed by ticker."""
    index: Dict[str, List[dict]] = {}
    for ticker, df in stock_data.items():
        rallies = find_20pct_rallies(df)
        if rallies:
            index[ticker] = rallies
    return index


def run_simulation(
    stocks_meta: Dict[str, Tuple[str, str, str]],
    stock_data: Dict[str, pd.DataFrame],
    rally_index: Dict[str, List[dict]],
    sim_start: datetime.date,
    sim_end: datetime.date,
    pe_series_map: Optional[Dict[str, Tuple]] = None,
    fund_metrics_map: Optional[Dict[str, Optional[dict]]] = None,
) -> PortfolioSimulator:
    sim = PortfolioSimulator(
        initial_capital=INITIAL_CAP,
        max_abcd_depth=4,
        slippage_pct=0.10,
        enforce_capacity=False,
    )

    # Pre-build O(1) PE lookup dicts from pe_series_map
    pe_lookup:     Dict[str, Dict[str, float]] = {}
    pe_med_lookup: Dict[str, Dict[str, float]] = {}
    if pe_series_map:
        for _tkr, (pe_ser, pe_med_ser) in pe_series_map.items():
            if pe_ser is not None:
                pe_lookup[_tkr] = {
                    ts.strftime("%Y-%m-%d"): float(v)
                    for ts, v in pe_ser.dropna().items()
                }
            if pe_med_ser is not None:
                pe_med_lookup[_tkr] = {
                    ts.strftime("%Y-%m-%d"): float(v)
                    for ts, v in pe_med_ser.dropna().items()
                }

    sim_start_ts = pd.Timestamp(sim_start)
    sim_end_ts   = pd.Timestamp(sim_end)
    all_dates = sorted(
        set().union(*[set(df.index) for df in stock_data.values()])
    )
    sim_dates = [d for d in all_dates if sim_start_ts <= d <= sim_end_ts]

    prev_closes: Dict[str, float] = {}
    trade_counter = 0

    for day in sim_dates:
        day_date = day.date()
        day_str  = day_date.isoformat()

        # Build price lookup
        price_lookup: Dict[str, dict] = {}
        for ticker, df in stock_data.items():
            if day not in df.index:
                continue
            row   = df.loc[day]
            ma2   = row.get('ma200')
            w52h  = row.get('w52_high')
            price_lookup[ticker] = {
                'high':    float(row['high']),
                'low':     float(row['low']),
                'close':   float(row['close']),
                'ma200':   float(ma2)  if (ma2  is not None and not pd.isna(ma2))  else None,
                'w52_high': float(w52h) if (w52h is not None and not pd.isna(w52h)) else None,
            }

        # ── 1a. TARGET EXIT ───────────────────────────────────────────────────
        # Each tranche has its own exit_target and exits independently.
        # INITIAL exits at sell_price (rally high).
        # ABCD_A exits at INITIAL entry price; ABCD_B at ABCD_A price; etc.
        # No time-based expiry — hold until target is hit.
        for pos in list(sim.open_positions):
            d = price_lookup.get(pos.ticker)
            if d is None:
                continue
            if d['high'] >= pos.exit_target:
                sim.close_position(pos, day_str, pos.exit_target, 'TARGET_HIT')

        # ── 2. MOMENTUM ADD ───────────────────────────────────────────────────
        rally_groups = {}
        for pos in list(sim.open_positions):
            rally_groups.setdefault(pos._rally_key, []).append(pos)

        for rally_key, positions in rally_groups.items():
            initial_pos = next((p for p in positions if p.tranche == 'INITIAL'), None)
            if initial_pos is None:
                continue
            if 'MOMENTUM' in {p.tranche for p in positions}:
                continue
            ticker = initial_pos.ticker
            d = price_lookup.get(ticker)
            if d is None or d['ma200'] is None:
                continue
            prev_close = prev_closes.get(ticker)
            if (d['close'] >= d['ma200']
                    and (prev_close is None or prev_close < d['ma200'])
                    and d['close'] > initial_pos.entry_price
                    and sim.can_open(initial_pos.cap_tier, 'MOMENTUM')):
                size   = sim.target_size(initial_pos.cap_tier, 'MOMENTUM')
                shares = sim.shares_for(size, d['close'])
                trade  = PortfolioTrade(
                    trade_id=f'{ticker}_M_{trade_counter}',
                    strategy='S200_RALLY',
                    ticker=ticker,
                    cap_tier=initial_pos.cap_tier,
                    sector=initial_pos.sector,
                    watchlist_source=initial_pos.watchlist_source,
                    tranche='MOMENTUM',
                    entry_date=day_str,
                    entry_price=round(d['close'], 2),
                    exit_target=initial_pos.exit_target,
                    shares=shares,
                    position_value=size,
                    exit_date=None, exit_price=None, exit_reason='OPEN',
                    trade_duration_days=0, pnl=None, pnl_pct=None, max_drawdown_pct=0.0,
                    _rally_key=rally_key,
                )
                sim.open_position(trade)
                trade_counter += 1

        # ── 3. ABCD ADD ───────────────────────────────────────────────────────
        abcd_done: set = set()
        rally_groups = {}
        for pos in list(sim.open_positions):
            rally_groups.setdefault(pos._rally_key, []).append(pos)

        for rally_key, positions in rally_groups.items():
            if rally_key in abcd_done:
                continue
            initial_pos = next((p for p in positions if p.tranche == 'INITIAL'), None)
            if initial_pos is None:
                continue
            ticker = initial_pos.ticker
            d = price_lookup.get(ticker)
            if d is None:
                continue
            open_t = {p.tranche for p in positions}
            for tranche, level in sim.abcd_levels(initial_pos.entry_price):
                if tranche in open_t:
                    continue
                if d['low'] <= level and sim.can_open(initial_pos.cap_tier, tranche):
                    # ABCD_A rides to full sell target; B/C/D exit at intermediate levels
                    if tranche == 'ABCD_A':
                        abcd_exit = initial_pos.exit_target
                    else:
                        abcd_exit = round(initial_pos.entry_price * _S200_ABCD_EXIT[tranche], 2)
                    size   = sim.target_size(initial_pos.cap_tier, tranche)
                    shares = sim.shares_for(size, level)
                    trade  = PortfolioTrade(
                        trade_id=f'{ticker}_{tranche}_{trade_counter}',
                        strategy='S200_RALLY',
                        ticker=ticker,
                        cap_tier=initial_pos.cap_tier,
                        sector=initial_pos.sector,
                        watchlist_source=initial_pos.watchlist_source,
                        tranche=tranche,
                        entry_date=day_str,
                        entry_price=level,
                        exit_target=abcd_exit,
                        shares=shares,
                        position_value=size,
                        exit_date=None, exit_price=None, exit_reason='OPEN',
                        trade_duration_days=0, pnl=None, pnl_pct=None, max_drawdown_pct=0.0,
                        _rally_key=rally_key,
                    )
                    sim.open_position(trade)
                    abcd_done.add(rally_key)
                    trade_counter += 1
                    break  # one ABCD tranche per rally_key per day

        # ── 4. NEW ENTRY: price enters buy zone ───────────────────────────────
        candidates: List[Tuple] = []
        for ticker, rallies in rally_index.items():
            if ticker not in price_lookup:
                continue
            cap_tier, sector, watchlist_source = stocks_meta.get(ticker, ('Mid Cap', 'Unknown', 'S200'))
            d = price_lookup[ticker]

            for rally in rallies:
                rally_end_dt = datetime.date.fromisoformat(rally['rally_end_date'])
                expiry_dt    = rally_end_dt + datetime.timedelta(days=365)

                # Only consider rallies that are active today
                if not (rally_end_dt < day_date <= expiry_dt):
                    continue

                buy_price  = rally['buy_price']
                sell_price = rally['sell_price']
                rally_key  = f"{ticker}_{rally['rally_end_date']}"
                zone_high  = buy_price * (1 + BUY_ZONE_PCT / 100)

                if sim.has_initial(ticker, rally_key):
                    continue
                if d['low'] > zone_high:
                    continue
                # S200 condition: buy_price must be below the current 200 DMA
                if d['ma200'] is None or rally['buy_price'] >= d['ma200']:
                    continue
                # Fundamental gate: PE at entry (when historical PE data available)
                if pe_lookup.get(ticker):
                    pe_val = pe_lookup[ticker].get(day_str)
                    if pe_val is not None:
                        if pe_val > cfg.PE_MAX:
                            continue
                        if cfg.PE_BELOW_5YR_MEDIAN and pe_med_lookup.get(ticker):
                            med_val = pe_med_lookup[ticker].get(day_str)
                            if med_val is not None and pe_val >= med_val:
                                continue
                # Fundamental gate: Phase 2 balance sheet + business quality
                if fund_metrics_map:
                    fund = fund_metrics_map.get(ticker)
                    if fund is not None:
                        p2_pass, _ = cfg.apply_fundamental_filter_phase2(fund, at_date=day_str)
                        if not p2_pass:
                            continue
                if not sim.can_open(cap_tier, 'INITIAL'):
                    continue

                # Fill: at buy_price if candle went there, else at daily_low
                fill   = buy_price if d['low'] <= buy_price else d['low']
                upside = (sell_price - fill) / fill * 100
                at_zone = 1 if d['low'] <= buy_price else 0
                candidates.append((at_zone, upside, ticker, cap_tier, sector,
                                    watchlist_source, rally_key, fill, sell_price))

        candidates.sort(key=lambda x: (-x[0], -x[1]))

        for (at_zone, upside, ticker, cap_tier, sector, watchlist_source,
             rally_key, fill, sell_price) in candidates:
            if not sim.can_open(cap_tier, 'INITIAL'):
                continue
            size   = sim.target_size(cap_tier, 'INITIAL')
            shares = sim.shares_for(size, fill)
            trade  = PortfolioTrade(
                trade_id=f'{ticker}_INIT_{trade_counter}',
                strategy='S200_RALLY',
                ticker=ticker,
                cap_tier=cap_tier,
                sector=sector,
                watchlist_source=watchlist_source,
                tranche='INITIAL',
                entry_date=day_str,
                entry_price=round(fill, 2),
                exit_target=round(sell_price, 2),
                shares=shares,
                position_value=size,
                exit_date=None, exit_price=None, exit_reason='OPEN',
                trade_duration_days=0, pnl=None, pnl_pct=None, max_drawdown_pct=0.0,
                _rally_key=rally_key,
            )
            sim.open_position(trade)
            trade_counter += 1

        # ── 5. Update drawdown and equity point ───────────────────────────────
        close_prices: Dict[str, float] = {}
        for ticker, d in price_lookup.items():
            close_prices[ticker] = d['close']
            sim.update_drawdown(ticker, d['close'])

        sim.record_equity_point(day_str, close_prices)
        prev_closes.update(close_prices)

    return sim


def main() -> None:
    parser = argparse.ArgumentParser(description='S200 Portfolio Backtest — 20% Rally Strategy')
    parser.add_argument('--years', type=int, default=10,
                        help='Simulation window in years (default: 10).')
    args = parser.parse_args()

    global SIM_YEARS, DATA_YEARS
    SIM_YEARS  = args.years
    DATA_YEARS = args.years + 2

    today     = datetime.date.today()
    sim_end   = today
    sim_start = today.replace(year=today.year - SIM_YEARS)

    print('S200 Portfolio Backtest -- 20% Rally Strategy')
    print(f'Simulation: {sim_start} -> {sim_end}  |  Capital: Rs{INITIAL_CAP:,.0f}')
    print()

    errors: List[str] = []
    stocks_meta = _load_watchlists()
    if not stocks_meta:
        print('ERROR: No watchlist found.')
        return
    print(f'Loaded {len(stocks_meta)} stocks. Downloading {DATA_YEARS}y of history...')
    print('(This takes ~20 min for the full S200 watchlist)')

    stock_data = _build_stock_data(stocks_meta, errors)
    print(f'Data ready for {len(stock_data)} stocks ({len(errors)} errors).')

    print('Building rally index...')
    rally_index = _build_rally_index(stocks_meta, stock_data)
    total_rallies = sum(len(v) for v in rally_index.values())
    print(f'Found {total_rallies} rallies across {len(rally_index)} stocks.')

    print(f'Fetching historical PE series for {len(stock_data)} stocks (weekly cached)...')
    pe_series_map = fetch_all_pe_series_parallel(stock_data.keys())
    pe_ok = sum(1 for v in pe_series_map.values() if v[0] is not None)
    print(f'  PE series available for {pe_ok}/{len(stock_data)} stocks.')

    print(f'Fetching Phase 2 fundamental data for {len(stock_data)} stocks (weekly cached)...')
    fund_metrics_map = fetch_all_fundamentals_parallel(stock_data.keys(), max_workers=4)
    fund_ok = sum(1 for v in fund_metrics_map.values() if v is not None)
    print(f'  Phase 2 data available for {fund_ok}/{len(stock_data)} stocks.')

    print('Running simulation...')
    sim = run_simulation(stocks_meta, stock_data, rally_index, sim_start, sim_end,
                         pe_series_map=pe_series_map,
                         fund_metrics_map=fund_metrics_map)

    sim.mark_open_positions(sim_end.isoformat())

    metrics = compute_portfolio_metrics(sim, sim_start, sim_end)

    # Per-ticker price series for the trade detail chart in the UI
    all_trade_tickers = set(t.ticker for t in sim.closed_trades) | set(t.ticker for t in sim.open_positions)
    sim_start_ts = pd.Timestamp(sim_start)
    stock_prices: dict = {}
    for ticker in sorted(all_trade_tickers):
        if ticker not in stock_data:
            continue
        df = stock_data[ticker]
        df_slice = df[df.index >= sim_start_ts]
        prices_list = []
        for ts, row in df_slice.iterrows():
            ma = row.get('ma200')
            prices_list.append({
                'date':  ts.strftime('%Y-%m-%d'),
                'close': round(float(row['close']), 2),
                'high':  round(float(row['high']),  2),
                'low':   round(float(row['low']),   2),
                'ma200': round(float(ma), 2) if (ma is not None and not pd.isna(ma)) else None,
            })
        stock_prices[ticker] = prices_list

    output = {
        'meta': {
            'strategy':          'S200_RALLY',
            'run_date':          today.isoformat(),
            'sim_start':         sim_start.isoformat(),
            'sim_end':           sim_end.isoformat(),
            'initial_capital':   INITIAL_CAP,
            'max_abcd_depth':    sim.max_abcd_depth,
            'buy_zone_pct':      BUY_ZONE_PCT,
            'stocks_count':      len(stock_data),
            'rallies_found':     total_rallies,
            'data_errors':       len(errors),
            'allocations':       ALLOCATIONS,
            'fundamental_gates': {
                'below_200dma_enforced':  True,
                'pe_max':                 cfg.PE_MAX,
                'pe_below_5yr_median':    cfg.PE_BELOW_5YR_MEDIAN,
                'phase2_enabled':         True,
                'phase2_available':       fund_ok,
            },
        },
        'summary':      metrics,
        'equity_curve': [pt.to_dict() for pt in sim.equity_curve],
        'trades':        [t.to_dict() for t in sim.closed_trades],
        'stock_prices':  stock_prices,
    }

    out_path = ROOT / 'Source Data' / 'Downloaded Data' / f's200_portfolio_backtest_{args.years}y.json'
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    print(f'\nResults saved to: {out_path}')
    print(f'  CAGR:        {metrics["cagr_pct"]:+.1f}%')
    print(f'  Total Return:{metrics["total_return_pct"]:+.1f}%')
    print(f'  Win Rate:    {metrics["win_rate_pct"]:.1f}%  ({metrics["wins"]}/{metrics["total_trades"]} completed)')
    print(f'  Max Drawdown:{metrics["max_drawdown_pct"]:.1f}%')
    print(f'  Open at end: {metrics["open_at_end"]}')
    if errors:
        print(f'\nData errors ({len(errors)}):')
        for e in errors[:10]:
            print(f'  {e}')


if __name__ == '__main__':
    main()

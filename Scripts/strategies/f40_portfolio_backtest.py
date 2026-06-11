"""
f40_portfolio_backtest.py — 52W Low→High Portfolio Backtest.

Simulates the F40 52-week low→high strategy over 5 years with a shared ₹1L
cash pool and Smart Pyramid tranching:
  INITIAL  entry when price touches the 52W-low band (must be below 200 DMA)
  ABCD_A   when price falls 10% below INITIAL; exits at INITIAL entry price
  ABCD_B   when price falls 19% below INITIAL; exits at ABCD_A price
  ABCD_C   when price falls 27.1% below INITIAL; exits at ABCD_B price
  ABCD_D   when price falls 34.4% below INITIAL; exits at ABCD_C price
  MOMENTUM when price has been above 200 DMA for 20+ consecutive days (and in profit); exits at 52W high

Optional overlays (--envelope, --rally):
  ENV_LONG   buy at lower envelope (MA×0.86), exit at upper (MA×1.14)
  S200_RALLY buy at post-20%-rally retracement zone, exit at prior rally high

INITIAL exits at the 52W high captured at entry date.
Each ABCD tranche exits independently at the price of the tranche above it.
No time-based expiry — hold until target is hit.

Output: Source Data/Downloaded Data/f40_portfolio_backtest.json
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
    compute_rolling_52w,
    fetch_all_stocks_parallel,
    fetch_historical_data,
    parse_f40_watchlist,
    parse_watchlists,
)
from s200_20pct_rally_scanner import BUY_ZONE_PCT, find_20pct_rallies
from portfolio_backtest_engine import (
    ABCD_LABELS,
    ABCD_MULTIPLIERS,
    ALLOCATIONS,
    ENVELOPE_ALLOCATIONS,
    ENV_LONG_ABCD_ALLOCATIONS,
    PortfolioSimulator,
    PortfolioTrade,
    compute_portfolio_metrics,
)

ROOT        = Path(__file__).resolve().parent.parent.parent
F40_PATH    = ROOT / 'Source Data' / 'Watchlist' / 'F40.txt'
E40_PATH    = ROOT / 'Source Data' / 'Watchlist' / 'E40.txt'
S200_PATH   = ROOT / 'Source Data' / 'Watchlist' / 'S200.txt'
DOWNLOADS   = ROOT / 'Source Data' / 'Downloaded Data'

SIM_YEARS      = 10
DATA_YEARS     = 12     # extra years for rolling-window warmup (matches cache from f40_backtest_52w)
INITIAL_CAP    = 100_000.0
MAX_CONCURRENT  = 999   # no portfolio-level cap — only cash limits new entries
MAX_PER_STOCK   = 4     # max concurrent positions per stock per strategy (INITIAL + 3 ABCD)
ENTRY_BAND_PCT  = 2.0   # enter when price ≤ 52w_low × (1 + 2%)
ENV_PCT        = 14.0   # envelope width: lower = MA×(1-14%), upper = MA×(1+14%)
ENV_ENTRY_BAND = 0.02   # 2% tolerance: enter when price ≤ lower×1.02 or ≥ upper×0.98

# S200_RALLY: ABCD_A rides to full sell target; B/C/D exit at intermediate levels.
_S200_ABCD_EXIT: dict = {'ABCD_B': 0.900, 'ABCD_C': 0.810, 'ABCD_D': 0.729}


def _load_watchlists() -> Dict[str, Tuple[str, str, str]]:
    """Return {ticker: (cap_tier, sector, watchlist_source)}."""
    stocks: Dict[str, Tuple[str, str, str]] = {}
    for path, label in ((F40_PATH, 'F40'), (E40_PATH, 'E40')):
        if path.exists():
            for ticker, (cap, sector) in parse_f40_watchlist(path).items():
                if ticker not in stocks:
                    stocks[ticker] = (cap, sector, label)
    return stocks


def _build_stock_data(stocks: Dict[str, Tuple[str, str, str]], errors: List[str]) -> Dict[str, pd.DataFrame]:
    """Download history and compute indicators for each stock."""
    print(f'  Downloading {len(stocks)} stocks in parallel ({DATA_YEARS}y each)...')
    raw = fetch_all_stocks_parallel(stocks, years=DATA_YEARS, errors=errors)
    result: Dict[str, pd.DataFrame] = {}
    for ticker, df in raw.items():
        if len(df) < 252:
            continue
        df = df.copy()
        df['52w_high'], df['52w_low'] = compute_rolling_52w(df['close'], window=252)
        df['ma200'] = df['close'].rolling(window=200, min_periods=200).mean()
        df['env_lower'] = df['ma200'] * (1 - ENV_PCT / 100)
        df['env_upper'] = df['ma200'] * (1 + ENV_PCT / 100)
        if df.index.tz is not None:
            df.index = df.index.tz_convert(None)
        result[ticker] = df
    return result


def _build_rally_index(stock_data: Dict[str, pd.DataFrame]) -> Dict[str, List[dict]]:
    """Pre-compute all valid 20% rallies for each stock in the universe."""
    index: Dict[str, List[dict]] = {}
    for ticker, df in stock_data.items():
        rallies = find_20pct_rallies(df)
        if rallies:
            index[ticker] = rallies
    return index


def run_simulation(
    stocks_meta: Dict[str, Tuple[str, str, str]],
    stock_data: Dict[str, pd.DataFrame],
    sim_start: datetime.date,
    sim_end: datetime.date,
    exit_mode: str = 'fixed',
    envelope: str = 'none',
    rally: str = 'none',
    rally_index: Optional[Dict[str, List[dict]]] = None,
) -> PortfolioSimulator:
    sim = PortfolioSimulator(
        initial_capital=INITIAL_CAP,
        max_concurrent=MAX_CONCURRENT,
        max_abcd_depth=4,
        slippage_pct=0.10,
        exit_mode=exit_mode,
    )

    # Union of all trading dates in the sim window
    sim_start_ts = pd.Timestamp(sim_start)
    sim_end_ts   = pd.Timestamp(sim_end)
    all_dates = sorted(
        set().union(*[set(df.index) for df in stock_data.values()])
    )
    sim_dates = [d for d in all_dates if sim_start_ts <= d <= sim_end_ts]

    prev_closes: Dict[str, float] = {}
    days_above_200: Dict[str, int] = {}   # consecutive days each ticker has closed >= 200 DMA
    trade_counter = 0

    for day in sim_dates:
        day_str = day.date().isoformat()

        # Build price lookup for today
        price_lookup: Dict[str, dict] = {}
        for ticker, df in stock_data.items():
            if day not in df.index:
                continue
            row = df.loc[day]
            w52h = row.get('52w_high')
            w52l = row.get('52w_low')
            ma2  = row.get('ma200')
            envl = row.get('env_lower')
            envu = row.get('env_upper')
            price_lookup[ticker] = {
                'high':      float(row['high']),
                'low':       float(row['low']),
                'close':     float(row['close']),
                'ma200':     float(ma2)  if (ma2  is not None and not pd.isna(ma2))  else None,
                '52w_high':  float(w52h) if (w52h is not None and not pd.isna(w52h)) else None,
                '52w_low':   float(w52l) if (w52l is not None and not pd.isna(w52l)) else None,
                'env_lower': float(envl) if (envl is not None and not pd.isna(envl)) else None,
                'env_upper': float(envu) if (envu is not None and not pd.isna(envu)) else None,
            }

        # Update 200 DMA consecutive-day counters (used by MOMENTUM 20-day confirmation)
        for ticker, d in price_lookup.items():
            if d['ma200'] is not None and d['close'] >= d['ma200']:
                days_above_200[ticker] = days_above_200.get(ticker, 0) + 1
            else:
                days_above_200[ticker] = 0

        # ── 0. ROLLING RATCHET: raise exit targets on new rolling 52W highs ────
        # In 'rolling' mode, each ticker's 52w_high (rolling 252d close max) is
        # used to ratchet up open position targets. Target never drops below the
        # fixed level set at entry. No-op in 'fixed' mode.
        if exit_mode == 'rolling':
            for ticker, d in price_lookup.items():
                rh = d.get('52w_high')
                if rh:
                    sim.update_exit_targets(ticker, rh)

        # ── 1. EXIT: each tranche exits independently at its own target ──────
        # INITIAL exits at 52W high; each ABCD tranche exits at the level above it.
        for pos in list(sim.open_positions):
            d = price_lookup.get(pos.ticker)
            if d is None:
                continue
            if d['high'] >= pos.exit_target:
                sim.close_position(pos, day_str, pos.exit_target, 'TARGET_HIT')

        # ── 1b. ENV_LONG EXITS — all tranches (INITIAL + ABCD) exit at upper envelope ──
        if envelope == 'long':
            for pos in [p for p in sim.open_positions if p.strategy == 'ENV_LONG']:
                d = price_lookup.get(pos.ticker)
                if d and d['env_upper'] and d['high'] >= d['env_upper']:
                    sim.close_position(pos, day_str, d['env_upper'], 'ENV_EXIT')

        # Rebuild ticker_positions after exits (used by steps 2 and 3)
        ticker_positions: Dict[str, List[PortfolioTrade]] = {}
        for pos in list(sim.open_positions):
            ticker_positions.setdefault(pos.ticker, []).append(pos)

        # ── 2. MOMENTUM ADD: 20+ consecutive days above 200 DMA, position in profit ──
        for ticker, positions in ticker_positions.items():
            initial_pos = sim.get_initial(ticker)
            if initial_pos is None:
                continue
            if 'MOMENTUM' in sim.open_depth(ticker):
                continue
            d = price_lookup.get(ticker)
            if d is None or d['ma200'] is None:
                continue
            if (days_above_200.get(ticker, 0) >= 20
                    and d['close'] > initial_pos.entry_price
                    and sim.can_open(initial_pos.cap_tier, 'MOMENTUM')
                    and sim.open_count_for_strategy(ticker, '52W') < MAX_PER_STOCK):
                size   = sim.target_size(initial_pos.cap_tier, 'MOMENTUM')
                shares = sim.shares_for(size, d['close'])
                trade  = PortfolioTrade(
                    trade_id=f'{ticker}_M_{trade_counter}',
                    strategy='52W',
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
                )
                sim.open_position(trade)
                trade_counter += 1

        # ── 2b. S200_RALLY MOMENTUM: 20+ days above 200 DMA, position in profit ──
        if rally in ('f40', 's200'):
            rally_groups_mom: Dict[str, List] = {}
            for pos in list(sim.open_positions):
                if pos.strategy == 'S200_RALLY':
                    rally_groups_mom.setdefault(pos._rally_key, []).append(pos)
            for rk, positions in rally_groups_mom.items():
                initial_pos = next((p for p in positions if p.tranche == 'INITIAL'), None)
                if initial_pos is None:
                    continue
                if 'MOMENTUM' in {p.tranche for p in positions}:
                    continue
                ticker = initial_pos.ticker
                d = price_lookup.get(ticker)
                if d is None or d['ma200'] is None:
                    continue
                if (days_above_200.get(ticker, 0) >= 20
                        and d['close'] > initial_pos.entry_price
                        and sim.can_open(initial_pos.cap_tier, 'MOMENTUM')):
                    size   = sim.target_size(initial_pos.cap_tier, 'MOMENTUM')
                    shares = sim.shares_for(size, d['close'])
                    trade  = PortfolioTrade(
                        trade_id=f'{ticker}_S200_M_{trade_counter}',
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
                        _rally_key=rk,
                    )
                    sim.open_position(trade)
                    trade_counter += 1

        # ── 3. ABCD ADD: one tranche per ticker per day ───────────────────────
        abcd_done: set = set()
        for ticker in list(ticker_positions):
            if ticker in abcd_done:
                continue
            initial_pos = sim.get_initial(ticker)
            if initial_pos is None:
                continue
            d = price_lookup.get(ticker)
            if d is None:
                continue
            open_t = sim.open_depth(ticker)
            for tranche, level in sim.abcd_levels(initial_pos.entry_price):
                if tranche in open_t:
                    continue
                if (d['low'] <= level
                        and sim.can_open(initial_pos.cap_tier, tranche)
                        and sim.open_count_for_strategy(ticker, '52W') < MAX_PER_STOCK):
                    # ABCD_A rides to 52W high; B/C/D exit at the preceding entry level
                    abcd_idx  = ABCD_LABELS.index(tranche)
                    abcd_exit = (initial_pos.exit_target if abcd_idx == 0
                                 else round(initial_pos.entry_price * ABCD_MULTIPLIERS[abcd_idx - 1], 2))
                    fill   = level
                    size   = sim.target_size(initial_pos.cap_tier, tranche)
                    shares = sim.shares_for(size, fill)
                    trade  = PortfolioTrade(
                        trade_id=f'{ticker}_{tranche}_{trade_counter}',
                        strategy='52W',
                        ticker=ticker,
                        cap_tier=initial_pos.cap_tier,
                        sector=initial_pos.sector,
                        watchlist_source=initial_pos.watchlist_source,
                        tranche=tranche,
                        entry_date=day_str,
                        entry_price=fill,
                        exit_target=abcd_exit,
                        shares=shares,
                        position_value=size,
                        exit_date=None, exit_price=None, exit_reason='OPEN',
                        trade_duration_days=0, pnl=None, pnl_pct=None, max_drawdown_pct=0.0,
                    )
                    sim.open_position(trade)
                    abcd_done.add(ticker)
                    trade_counter += 1
                    break  # one ABCD tranche per ticker per day

        # ── 3b. ENV_LONG ABCD: add averaging tranches when price falls from ENV_LONG entry ──
        env_abcd_done: set = set()
        if envelope == 'long':
            for ticker, (cap_tier, sector, watchlist_source) in stocks_meta.items():
                if ticker in env_abcd_done:
                    continue
                env_initial = sim.get_env_long_initial(ticker)
                if env_initial is None:
                    continue
                d = price_lookup.get(ticker)
                if d is None or d['env_upper'] is None:
                    continue
                open_env_t = {p.tranche for p in sim.open_positions
                              if p.ticker == ticker and p.strategy == 'ENV_LONG'}
                for tranche, level in sim.abcd_levels(env_initial.entry_price):
                    if tranche in open_env_t:
                        continue
                    if (d['low'] <= level
                            and sim.open_count_for_strategy(ticker, 'ENV_LONG') < MAX_PER_STOCK):
                        tier_alloc = ENV_LONG_ABCD_ALLOCATIONS.get(
                            cap_tier, ENV_LONG_ABCD_ALLOCATIONS['Mid Cap'])
                        size = sim.current_total_value * (tier_alloc.get(tranche) or 0)
                        if not size:
                            continue
                        if not sim.can_open_raw(size):
                            continue
                        shares = sim.shares_for(size, level)
                        trade = PortfolioTrade(
                            trade_id=f'{ticker}_EL_{tranche}_{trade_counter}',
                            strategy='ENV_LONG',
                            ticker=ticker,
                            cap_tier=cap_tier,
                            sector=sector,
                            watchlist_source=watchlist_source,
                            tranche=tranche,
                            entry_date=day_str,
                            entry_price=round(level, 2),
                            exit_target=round(d['env_upper'], 2),
                            shares=shares,
                            position_value=size,
                            exit_date=None, exit_price=None, exit_reason='OPEN',
                            trade_duration_days=0, pnl=None, pnl_pct=None, max_drawdown_pct=0.0,
                        )
                        sim.open_position(trade)
                        env_abcd_done.add(ticker)
                        trade_counter += 1
                        break  # one tranche per ticker per day

        # ── 3c. S200_RALLY ABCD: averaging tranches per (ticker, rally_key) ────
        if rally in ('f40', 's200'):
            s200_abcd_done: set = set()
            rally_groups_abcd: Dict[str, List] = {}
            for pos in list(sim.open_positions):
                if pos.strategy == 'S200_RALLY':
                    rally_groups_abcd.setdefault(pos._rally_key, []).append(pos)
            for rk, positions in rally_groups_abcd.items():
                if rk in s200_abcd_done:
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
                        abcd_exit = (initial_pos.exit_target if tranche == 'ABCD_A'
                                     else round(initial_pos.entry_price * _S200_ABCD_EXIT[tranche], 2))
                        size   = sim.target_size(initial_pos.cap_tier, tranche)
                        shares = sim.shares_for(size, level)
                        trade  = PortfolioTrade(
                            trade_id=f'{ticker}_{tranche}_S200_{trade_counter}',
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
                            _rally_key=rk,
                        )
                        sim.open_position(trade)
                        s200_abcd_done.add(rk)
                        trade_counter += 1
                        break

        # ── 4. NEW ENTRY: price touches 52W-low band ─────────────────────────
        candidates: List[Tuple] = []
        for ticker, (cap_tier, sector, watchlist_source) in stocks_meta.items():
            if sim.has_initial(ticker):
                continue
            d = price_lookup.get(ticker)
            if d is None or d['52w_low'] is None or d['52w_high'] is None:
                continue
            entry_band = d['52w_low'] * (1 + ENTRY_BAND_PCT / 100)
            if d['low'] > entry_band:
                continue
            # 200 DMA filter: at 52W low price should naturally be below DMA,
            # but enforce explicitly to catch edge cases.
            if d['ma200'] is None or d['52w_low'] >= d['ma200']:
                continue
            if not sim.can_open(cap_tier, 'INITIAL'):
                continue
            fill   = max(d['52w_low'], d['low'])
            target = d['52w_high']
            if target <= fill:
                continue
            upside = (target - fill) / fill * 100
            at_low = 1 if d['low'] <= d['52w_low'] else 0
            # Fix 1: skip secular declines — 52W low falling >15% year-over-year
            # Fix 2: skip stocks still finding a bottom — no floor over 2 years
            df_s = stock_data.get(ticker)
            if df_s is not None and day in df_s.index:
                idx  = df_s.index.get_loc(day)
                w52l = d['52w_low']
                if idx >= 252:
                    prior_1yr = float(df_s['52w_low'].iloc[idx - 252])
                    if not pd.isna(prior_1yr) and w52l < prior_1yr * 0.85:
                        continue
                if idx >= 504:
                    prior_2yr = float(df_s['52w_low'].iloc[idx - 504])
                    if not pd.isna(prior_2yr) and w52l < prior_2yr * 0.95:
                        continue
            candidates.append((at_low, upside, ticker, cap_tier, sector, watchlist_source, fill, target))

        # Priority: exactly at/below 52W low first, then highest upside
        candidates.sort(key=lambda x: (-x[0], -x[1]))

        for (at_low, upside, ticker, cap_tier, sector, watchlist_source, fill, target) in candidates:
            if not sim.can_open(cap_tier, 'INITIAL'):
                continue
            size   = sim.target_size(cap_tier, 'INITIAL')
            shares = sim.shares_for(size, fill)
            trade  = PortfolioTrade(
                trade_id=f'{ticker}_INIT_{trade_counter}',
                strategy='52W',
                ticker=ticker,
                cap_tier=cap_tier,
                sector=sector,
                watchlist_source=watchlist_source,
                tranche='INITIAL',
                entry_date=day_str,
                entry_price=round(fill, 2),
                exit_target=round(target, 2),
                shares=shares,
                position_value=size,
                exit_date=None, exit_price=None, exit_reason='OPEN',
                trade_duration_days=0, pnl=None, pnl_pct=None, max_drawdown_pct=0.0,
            )
            sim.open_position(trade)
            trade_counter += 1

        # ── 5. ENV_LONG INITIAL ENTRY: price touches lower envelope ──────────
        if envelope == 'long':
            for ticker, (cap_tier, sector, watchlist_source) in stocks_meta.items():
                if sim.has_strategy_position(ticker, 'ENV_LONG'):
                    continue
                d = price_lookup.get(ticker)
                if d is None or d['env_lower'] is None or d['env_upper'] is None:
                    continue
                threshold = d['env_lower'] * (1 + ENV_ENTRY_BAND)
                if d['low'] > threshold:
                    continue
                fill = d['env_lower']
                size = sim.current_total_value * ENVELOPE_ALLOCATIONS.get(cap_tier, 0.02)
                if not sim.can_open_raw(size):
                    continue
                shares = sim.shares_for(size, fill)
                trade = PortfolioTrade(
                    trade_id=f'{ticker}_EL_{trade_counter}',
                    strategy='ENV_LONG',
                    ticker=ticker,
                    cap_tier=cap_tier,
                    sector=sector,
                    watchlist_source=watchlist_source,
                    tranche='INITIAL',
                    entry_date=day_str,
                    entry_price=round(fill, 2),
                    exit_target=round(d['env_upper'], 2),
                    shares=shares,
                    position_value=size,
                    exit_date=None, exit_price=None, exit_reason='OPEN',
                    trade_duration_days=0, pnl=None, pnl_pct=None, max_drawdown_pct=0.0,
                )
                sim.open_position(trade)
                trade_counter += 1

        # ── 5b. S200_RALLY INITIAL ENTRY: price enters post-rally buy zone ──────
        if rally in ('f40', 's200') and rally_index is not None:
            s200_entries: List[Tuple] = []
            for ticker, rallies in rally_index.items():
                if ticker not in price_lookup:
                    continue
                cap_tier, sector, watchlist_source = stocks_meta.get(
                    ticker, ('Mid Cap', 'Unknown', 'S200'))
                d = price_lookup[ticker]
                for r in rallies:
                    rally_end_dt = datetime.date.fromisoformat(r['rally_end_date'])
                    expiry_dt    = rally_end_dt + datetime.timedelta(days=365)
                    if not (rally_end_dt < day.date() <= expiry_dt):
                        continue
                    buy_price  = r['buy_price']
                    sell_price = r['sell_price']
                    rk         = f"{ticker}_{r['rally_end_date']}"
                    zone_high  = buy_price * (1 + BUY_ZONE_PCT / 100)
                    if sim.has_initial(ticker, rk):
                        continue
                    if d['low'] > zone_high:
                        continue
                    if d['ma200'] is None or buy_price >= d['ma200']:
                        continue
                    if not sim.can_open(cap_tier, 'INITIAL'):
                        continue
                    fill    = buy_price if d['low'] <= buy_price else d['low']
                    upside  = (sell_price - fill) / fill * 100
                    at_zone = 1 if d['low'] <= buy_price else 0
                    s200_entries.append((at_zone, upside, ticker, cap_tier, sector,
                                         watchlist_source, rk, fill, sell_price))
            s200_entries.sort(key=lambda x: (-x[0], -x[1]))
            for (at_zone, upside, ticker, cap_tier, sector, watchlist_source,
                 rk, fill, sell_price) in s200_entries:
                if not sim.can_open(cap_tier, 'INITIAL'):
                    continue
                size   = sim.target_size(cap_tier, 'INITIAL')
                shares = sim.shares_for(size, fill)
                trade  = PortfolioTrade(
                    trade_id=f'{ticker}_S200_INIT_{trade_counter}',
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
                    _rally_key=rk,
                )
                sim.open_position(trade)
                trade_counter += 1

        # ── 6. Update drawdown trackers and record equity ─────────────────────
        close_prices: Dict[str, float] = {}
        for ticker, d in price_lookup.items():
            close_prices[ticker] = d['close']
            sim.update_drawdown(ticker, d['close'])

        sim.record_equity_point(day_str, close_prices)

        # Advance previous closes
        prev_closes.update(close_prices)

    return sim


def main() -> None:
    parser = argparse.ArgumentParser(description='F40 Portfolio Backtest — 52W Low→High Strategy')
    parser.add_argument(
        '--exit-mode', choices=['fixed', 'rolling'], default='fixed',
        help='fixed: lock exit target at entry-date 52W high (default). '
             'rolling: ratchet target up whenever stock makes a new 252-day high.',
    )
    parser.add_argument(
        '--envelope', choices=['none', 'long'], default='none',
        help='Envelope sub-strategy to layer alongside 52W. '
             'long: buy at lower envelope (MA×0.86), exit at upper envelope (MA×1.14), '
             'with ABCD averaging when price falls further from entry.',
    )
    parser.add_argument(
        '--rally', choices=['none', 'f40', 's200'], default='none',
        help='20%% rally sub-strategy to layer alongside 52W. '
             'f40: apply to F40/E40 universe only. '
             's200: apply to full S200 universe (442 stocks).',
    )
    parser.add_argument('--years', type=int, default=10,
                        help='Simulation window in years (default: 10).')
    args = parser.parse_args()
    exit_mode = args.exit_mode
    envelope  = args.envelope
    rally     = args.rally

    global SIM_YEARS, DATA_YEARS
    SIM_YEARS  = args.years
    DATA_YEARS = args.years + 2

    today     = datetime.date.today()
    sim_end   = today
    sim_start = today.replace(year=today.year - SIM_YEARS)

    overlays = []
    if envelope != 'none': overlays.append(f'ENV_{envelope.upper()}')
    if rally    != 'none': overlays.append(f'RALLY_{rally.upper()}')
    overlay_str = '+'.join(['52W'] + overlays)
    print(f'F40 Portfolio Backtest -- {overlay_str}  [{exit_mode.upper()} EXIT]')
    print(f'Simulation: {sim_start} -> {sim_end}  |  Capital: Rs{INITIAL_CAP:,.0f}')
    print()

    errors: List[str] = []
    stocks_meta = _load_watchlists()
    if not stocks_meta:
        print('ERROR: No watchlist found. Check F40.txt / E40.txt paths.')
        return
    if rally == 's200' and S200_PATH.exists():
        for ticker, (cap, sector) in parse_f40_watchlist(S200_PATH).items():
            if ticker not in stocks_meta:
                stocks_meta[ticker] = (cap, sector, 'S200')
    # f40 rally: no extra stocks — rally index is built from the existing F40/E40 universe
    print(f'Loaded {len(stocks_meta)} stocks. Downloading {DATA_YEARS}y of history...')

    stock_data = _build_stock_data(stocks_meta, errors)
    print(f'Data ready for {len(stock_data)} stocks ({len(errors)} errors).')

    rally_index: Optional[Dict[str, List[dict]]] = None
    if rally in ('f40', 's200'):
        label = 'F40/E40' if rally == 'f40' else 'S200'
        print(f'Building {label} rally index...')
        rally_index = _build_rally_index(stock_data)
        total_rallies = sum(len(v) for v in rally_index.values())
        print(f'  Found {total_rallies} rallies across {len(rally_index)} stocks.')

    print(f'Running simulation (exit={exit_mode}, envelope={envelope}, rally={rally})...')
    sim = run_simulation(stocks_meta, stock_data, sim_start, sim_end,
                         exit_mode=exit_mode, envelope=envelope,
                         rally=rally, rally_index=rally_index)

    # Mark any still-open positions
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

    strat_label = '+'.join(['52W'] + ([f'ENV_{envelope.upper()}'] if envelope != 'none' else [])
                                   + ([f'RALLY_{rally.upper()}'] if rally != 'none' else []))
    output = {
        'meta': {
            'strategy':              strat_label,
            'exit_mode':             exit_mode,
            'envelope_mode':         envelope,
            'envelope_pct':          ENV_PCT,
            'rally_mode':            rally,
            'run_date':              today.isoformat(),
            'sim_start':             sim_start.isoformat(),
            'sim_end':               sim_end.isoformat(),
            'initial_capital':       INITIAL_CAP,
            'max_concurrent':        MAX_CONCURRENT,
            'max_abcd_depth':        sim.max_abcd_depth,
            'entry_band_pct':        ENTRY_BAND_PCT,
            'stocks_count':          len(stock_data),
            'data_errors':           len(errors),
            'allocations':           ALLOCATIONS,
            'envelope_allocations':  ENVELOPE_ALLOCATIONS,
        },
        'summary':      metrics,
        'equity_curve': [pt.to_dict() for pt in sim.equity_curve],
        'trades':        [t.to_dict() for t in sim.closed_trades],
        'stock_prices':  stock_prices,
    }

    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    suffix = ''
    if envelope != 'none': suffix += f'_env-{envelope}'
    if rally    != 'none': suffix += f'_rally-{rally}'
    hz_label  = f'_{args.years}y'
    mode_path = DOWNLOADS / f'f40_portfolio_backtest_{exit_mode}{suffix}{hz_label}.json'
    with open(mode_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    print(f'\nResults saved to: {mode_path}')
    print(f'  CAGR:           {metrics["cagr_pct"]:+.1f}%')
    print(f'  Total Return:   {metrics["total_return_pct"]:+.1f}%')
    print(f'  Win Rate:       {metrics["win_rate_pct"]:.1f}%  ({metrics["wins"]}/{metrics["total_trades"]} completed)')
    print(f'  Max Drawdown:   {metrics["max_drawdown_pct"]:.1f}%')
    print(f'  Time in Market: {metrics["time_in_market_pct"]:.1f}%')
    print(f'  Open at end:    {metrics["open_at_end"]}')
    if envelope != 'none' or rally != 'none':
        all_trades = sim.closed_trades
        active_strats = ['52W']
        if envelope != 'none': active_strats.append('ENV_LONG')
        if rally    != 'none': active_strats.append('S200_RALLY')
        for strat in active_strats:
            completed = [t for t in all_trades
                         if t.strategy == strat
                         and t.exit_reason in ('TARGET_HIT', 'ENV_EXIT')]
            if completed:
                wins = sum(1 for t in completed if (t.pnl or 0) > 0)
                print(f'  [{strat}] completed={len(completed)}  wins={wins}  '
                      f'win_rate={wins/len(completed)*100:.0f}%')
    if errors:
        print(f'\nData errors ({len(errors)}):')
        for e in errors[:10]:
            print(f'  {e}')


if __name__ == '__main__':
    main()

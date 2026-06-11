"""
S200 20% Rally Strategy Backtest
----------------------------------
For each stock in F40+E40+S200 watchlists, scans 5 years of history.
Finds all completed 20% green-candle rallies (where the full 1-year validity
window has already elapsed), then simulates what happened in the following
365 days:
  - Did price return to the buy zone (buy_price ± 0.75%)?
  - If yes, did it reach the sell target (high of the rally)?
  - Tracks: entry, exit reason, P/L, max drawdown, days held.

Exit reasons:
  TARGET_HIT  — sell_price reached before 1-year window closes
  EXPIRED     — entered zone but sell target never reached in time
  NOT_ENTERED — price never returned to buy zone within 1 year

Outputs (written directly, no date-subfolder — one authoritative file):
  s200_backtest_summary.json    — aggregate metrics
  s200_backtest_stock_data.json — per-stock metrics + trade logs
"""

import argparse
import datetime
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from f40_backtest_common import fetch_historical_data, parse_f40_watchlist
from s200_20pct_rally_scanner import BUY_ZONE_PCT, MIN_RALLY_PCT, SINGLE_CANDLE_MIN, find_20pct_rallies

ROOT        = Path(__file__).resolve().parent.parent.parent
F40_PATH    = ROOT / "Source Data" / "Watchlist" / "F40.txt"
E40_PATH    = ROOT / "Source Data" / "Watchlist" / "E40.txt"
S200_PATH   = ROOT / "Source Data" / "Watchlist" / "S200.txt"
OUTPUT_ROOT = ROOT / "Source Data" / "Downloaded Data" / "s200_rally_backtest"

DATA_YEARS    = 10  # fetch 10 years so oldest rallies have a full 1-year forward window
MAX_HOLD_DAYS = 365


@dataclass
class SimTrade:
    ticker: str
    cap_tier: str
    sector: str
    watchlist_source: str
    rally_end_date: str
    rally_pct: float
    candle_count: int
    buy_price: float
    buy_zone_low: float
    buy_zone_high: float
    sell_price: float
    zone_entered: bool
    entry_date: Optional[str]
    entry_price: Optional[float]
    exit_date: Optional[str]
    exit_price: Optional[float]
    exit_reason: str          # TARGET_HIT | EXPIRED | NOT_ENTERED
    days_to_entry: Optional[int]
    days_in_trade: Optional[int]
    pnl_pct: Optional[float]
    max_drawdown_pct: Optional[float]

    def to_dict(self) -> dict:
        return asdict(self)


def _simulate_trade(
    df: pd.DataFrame,
    rally: dict,
    ticker: str,
    cap_tier: str,
    sector: str,
    watchlist_source: str,
) -> SimTrade:
    """Simulate one rally's forward 365-day window."""
    buy_price     = rally["buy_price"]
    sell_price    = rally["sell_price"]
    buy_zone_low  = round(buy_price * (1 - BUY_ZONE_PCT / 100), 2)
    buy_zone_high = round(buy_price * (1 + BUY_ZONE_PCT / 100), 2)
    rally_end_dt  = datetime.date.fromisoformat(rally["rally_end_date"])
    expiry_dt     = rally_end_dt + datetime.timedelta(days=MAX_HOLD_DAYS)

    idx_naive = df.index.tz_localize(None) if df.index.tz is None else df.index.tz_convert(None)
    mask  = (idx_naive > pd.Timestamp(rally_end_dt)) & (idx_naive <= pd.Timestamp(expiry_dt))
    window = df[mask]

    def _not_entered():
        return SimTrade(
            ticker=ticker, cap_tier=cap_tier, sector=sector,
            watchlist_source=watchlist_source,
            rally_end_date=rally["rally_end_date"],
            rally_pct=rally["rally_pct"], candle_count=rally["candle_count"],
            buy_price=buy_price, buy_zone_low=buy_zone_low, buy_zone_high=buy_zone_high,
            sell_price=sell_price, zone_entered=False,
            entry_date=None, entry_price=None,
            exit_date=None, exit_price=None,
            exit_reason="NOT_ENTERED",
            days_to_entry=None, days_in_trade=None,
            pnl_pct=None, max_drawdown_pct=None,
        )

    if window.empty:
        return _not_entered()

    entry_date_str: Optional[str] = None
    entry_price_val: Optional[float] = None
    min_close: Optional[float] = None

    for date_ts, row in window.iterrows():
        date_str = date_ts.strftime("%Y-%m-%d")
        low   = float(row["low"])
        high  = float(row["high"])
        close = float(row["close"])

        if entry_date_str is None:
            if low <= buy_zone_high:
                # Fill at buy_price if reachable, otherwise at the zone's top
                entry_price_val = buy_price if low <= buy_price else min(low, buy_zone_high)
                entry_date_str  = date_str
                min_close       = close
        else:
            min_close = min(min_close, close)
            if high >= sell_price:
                entry_dt      = datetime.date.fromisoformat(entry_date_str)
                days_to_entry = (entry_dt - rally_end_dt).days
                days_in_trade = (date_ts.date() - entry_dt).days
                pnl_pct       = round((sell_price - entry_price_val) / entry_price_val * 100, 2)
                max_dd        = round((min_close - entry_price_val) / entry_price_val * 100, 2)
                return SimTrade(
                    ticker=ticker, cap_tier=cap_tier, sector=sector,
                    watchlist_source=watchlist_source,
                    rally_end_date=rally["rally_end_date"],
                    rally_pct=rally["rally_pct"], candle_count=rally["candle_count"],
                    buy_price=buy_price, buy_zone_low=buy_zone_low, buy_zone_high=buy_zone_high,
                    sell_price=sell_price, zone_entered=True,
                    entry_date=entry_date_str, entry_price=round(entry_price_val, 2),
                    exit_date=date_str, exit_price=round(sell_price, 2),
                    exit_reason="TARGET_HIT",
                    days_to_entry=days_to_entry, days_in_trade=days_in_trade,
                    pnl_pct=pnl_pct, max_drawdown_pct=max_dd,
                )

    if entry_date_str is None:
        return _not_entered()

    # Entered zone but never hit target — mark to last close in window
    last_close    = float(window["close"].iloc[-1])
    entry_dt      = datetime.date.fromisoformat(entry_date_str)
    days_to_entry = (entry_dt - rally_end_dt).days
    days_in_trade = (expiry_dt - entry_dt).days
    pnl_pct       = round((last_close - entry_price_val) / entry_price_val * 100, 2)
    max_dd        = round((min_close - entry_price_val) / entry_price_val * 100, 2)
    return SimTrade(
        ticker=ticker, cap_tier=cap_tier, sector=sector,
        watchlist_source=watchlist_source,
        rally_end_date=rally["rally_end_date"],
        rally_pct=rally["rally_pct"], candle_count=rally["candle_count"],
        buy_price=buy_price, buy_zone_low=buy_zone_low, buy_zone_high=buy_zone_high,
        sell_price=sell_price, zone_entered=True,
        entry_date=entry_date_str, entry_price=round(entry_price_val, 2),
        exit_date=expiry_dt.isoformat(), exit_price=round(last_close, 2),
        exit_reason="EXPIRED",
        days_to_entry=days_to_entry, days_in_trade=days_in_trade,
        pnl_pct=pnl_pct, max_drawdown_pct=max_dd,
    )


def _backtest_stock(
    ticker: str, cap_tier: str, sector: str, watchlist_source: str, errors: list
) -> List[SimTrade]:
    df = fetch_historical_data(ticker, years=DATA_YEARS, errors=errors)
    if df is None or len(df) < 210:
        return []

    rallies = find_20pct_rallies(df)
    today   = datetime.date.today()
    trades: List[SimTrade] = []

    for rally in rallies:
        rally_end_dt = datetime.date.fromisoformat(rally["rally_end_date"])
        expiry_dt    = rally_end_dt + datetime.timedelta(days=MAX_HOLD_DAYS)
        # Only include rallies whose full 1-year window has already elapsed
        if expiry_dt >= today:
            continue
        trades.append(_simulate_trade(df, rally, ticker, cap_tier, sector, watchlist_source))

    return trades


def _stock_metrics(trades: List[SimTrade]) -> dict:
    if not trades:
        return {
            "total_rallies": 0, "not_entered": 0, "entered": 0,
            "target_hit": 0, "expired": 0,
            "zone_entry_rate_pct": None, "win_rate_pct": None,
            "overall_success_rate_pct": None,
            "avg_days_to_entry": None, "avg_days_in_trade": None,
            "avg_pnl_pct": None, "avg_max_drawdown_pct": None,
        }

    entered     = [t for t in trades if t.zone_entered]
    hits        = [t for t in trades if t.exit_reason == "TARGET_HIT"]
    expired     = [t for t in trades if t.exit_reason == "EXPIRED"]
    not_entered = [t for t in trades if not t.zone_entered]

    def avg(lst): return round(float(np.mean(lst)), 2) if lst else None

    return {
        "total_rallies":             len(trades),
        "not_entered":               len(not_entered),
        "entered":                   len(entered),
        "target_hit":                len(hits),
        "expired":                   len(expired),
        "zone_entry_rate_pct":       round(len(entered) / len(trades) * 100, 1) if trades else None,
        "win_rate_pct":              round(len(hits) / len(entered) * 100, 1)   if entered else None,
        "overall_success_rate_pct":  round(len(hits) / len(trades) * 100, 1)   if trades else None,
        "avg_days_to_entry":         avg([t.days_to_entry for t in entered if t.days_to_entry is not None]),
        "avg_days_in_trade":         avg([t.days_in_trade for t in hits   if t.days_in_trade is not None]),
        "avg_pnl_pct":               avg([t.pnl_pct       for t in hits   if t.pnl_pct       is not None]),
        "avg_max_drawdown_pct":      avg([t.max_drawdown_pct for t in entered if t.max_drawdown_pct is not None]),
    }


def main():
    parser = argparse.ArgumentParser(description="S200 20% Rally Backtest")
    parser.add_argument("--output-root", default=str(OUTPUT_ROOT))
    parser.add_argument("--years", type=int, default=DATA_YEARS)
    args = parser.parse_args()

    output_dir = Path(args.output_root)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Build combined watchlist: S200 base, E40/F40 override for cap/sector accuracy
    s200_stocks = parse_f40_watchlist(S200_PATH) if S200_PATH.exists() else {}
    e40_stocks  = parse_f40_watchlist(E40_PATH)  if E40_PATH.exists()  else {}
    f40_stocks  = parse_f40_watchlist(F40_PATH)  if F40_PATH.exists()  else {}

    stocks: dict = {}
    for ticker, (cap, sector) in s200_stocks.items():
        stocks[ticker] = (cap, sector, "S200")
    for ticker, (cap, sector) in e40_stocks.items():
        stocks[ticker] = (cap, sector, "E40")
    for ticker, (cap, sector) in f40_stocks.items():
        stocks[ticker] = (cap, sector, "F40")

    total = len(stocks)
    print(f"Backtesting {total} stocks ({args.years}Y history, {MAX_HOLD_DAYS}-day trade window)...")

    all_trades:    List[SimTrade]   = []
    stock_results: Dict[str, dict]  = {}
    errors: list = []
    scanned = 0

    with ThreadPoolExecutor(max_workers=16) as pool:
        futs = {
            pool.submit(_backtest_stock, ticker, cap_tier, sector, watchlist_source, errors):
            (ticker, cap_tier, sector, watchlist_source)
            for ticker, (cap_tier, sector, watchlist_source) in stocks.items()
        }

        for fut in as_completed(futs):
            ticker, cap_tier, sector, watchlist_source = futs[fut]
            scanned += 1
            if scanned % 50 == 0:
                print(f"  {scanned}/{total} · {len(all_trades)} trades so far...")

            try:
                trades = fut.result()
            except Exception as ex:
                errors.append(f"{ticker}: {ex}")
                trades = []

            all_trades.extend(trades)

            metrics = _stock_metrics(trades)
            stock_results[ticker] = {
                "ticker":           ticker,
                "cap_tier":         cap_tier,
                "sector":           sector,
                "watchlist_source": watchlist_source,
                "metrics":          metrics,
                "trades":           [t.to_dict() for t in trades],
            }

    # Aggregate stats
    all_entered = [t for t in all_trades if t.zone_entered]
    all_hits    = [t for t in all_trades if t.exit_reason == "TARGET_HIT"]
    all_expired = [t for t in all_trades if t.exit_reason == "EXPIRED"]

    def safepct(a, b): return round(a / b * 100, 1) if b else None
    def safeavg(lst):  return round(float(np.mean(lst)), 2) if lst else None

    agg = {
        "zone_entry_rate_pct":      safepct(len(all_entered), len(all_trades)),
        "win_rate_pct":             safepct(len(all_hits), len(all_entered)),
        "overall_success_rate_pct": safepct(len(all_hits), len(all_trades)),
        "avg_days_to_entry":        safeavg([t.days_to_entry  for t in all_entered if t.days_to_entry  is not None]),
        "avg_days_in_trade":        safeavg([t.days_in_trade  for t in all_hits    if t.days_in_trade  is not None]),
        "avg_pnl_pct":              safeavg([t.pnl_pct        for t in all_hits    if t.pnl_pct        is not None]),
        "avg_max_drawdown_pct":     safeavg([t.max_drawdown_pct for t in all_entered if t.max_drawdown_pct is not None]),
    }

    # Per-stock overview: only stocks with at least 1 historical rally
    overview = sorted(
        [
            {
                "ticker":           v["ticker"],
                "cap_tier":         v["cap_tier"],
                "sector":           v["sector"],
                "watchlist_source": v["watchlist_source"],
                **v["metrics"],
            }
            for v in stock_results.values()
            if v["metrics"]["total_rallies"] > 0
        ],
        key=lambda x: (-(x.get("win_rate_pct") or 0), -(x.get("zone_entry_rate_pct") or 0), x["ticker"]),
    )

    summary = {
        "run_date":          datetime.date.today().isoformat(),
        "backtest_years":    args.years,
        "stocks_tested":     scanned,
        "total_rallies":     len(all_trades),
        "total_entered":     len(all_entered),
        "total_hits":        len(all_hits),
        "total_expired":     len(all_expired),
        "total_not_entered": len(all_trades) - len(all_entered),
        "errors_count":      len(errors),
        **agg,
    }

    summary_path = output_dir / "s200_backtest_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    stock_data_path = output_dir / "s200_backtest_stock_data.json"
    with open(stock_data_path, "w", encoding="utf-8") as f:
        json.dump({"run_date": summary["run_date"], "overview": overview, "stock_data": stock_results}, f, indent=2)

    print(f"\nDone.")
    print(f"  Stocks tested  : {scanned}")
    print(f"  Total rallies  : {len(all_trades)}")
    print(f"  Zone entry rate: {agg['zone_entry_rate_pct']}%  ({len(all_entered)} of {len(all_trades)} rallies triggered)")
    print(f"  Win rate       : {agg['win_rate_pct']}%  ({len(all_hits)} hits of {len(all_entered)} entered)")
    print(f"  Expired trades : {len(all_expired)}")
    if agg["avg_pnl_pct"]:
        print(f"  Avg win P/L    : +{agg['avg_pnl_pct']}%")
    if agg["avg_days_in_trade"]:
        print(f"  Avg days held  : {agg['avg_days_in_trade']}")
    if agg["avg_max_drawdown_pct"]:
        print(f"  Avg max DD     : {agg['avg_max_drawdown_pct']}%")
    print(f"  Summary    : {summary_path}")
    print(f"  Stock data : {stock_data_path}")


if __name__ == "__main__":
    main()

"""
52-Week Low->High Strategy Backtest Engine for F40 stocks.

Value-trader rules:
- Entry: price touches the rolling 52W low (+/- entry_band_pct).
- Exit target: FIXED at the 52W high value on the day of entry. Never changes.
  (Prevents the rolling window from dragging the target below entry price.)
- Multiple concurrent entries: if 52W low is revisited and is at least
  new_entry_threshold_pct below the cheapest open entry, open a new position
  up to max_concurrent_positions. Each position is independent with its own
  fixed exit target.
- No stop-loss. No time-based exit. Hold until each position's fixed target.
- Open positions at end of data are reported as OPEN (still holding).
"""

import argparse
import csv
import datetime
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from f40_backtest_common import (
    Trade,
    compute_portfolio_metrics,
    compute_rolling_52w,
    fetch_historical_data,
    parse_f40_watchlist,
)


def simulate_52w_strategy(
    df: pd.DataFrame,
    ticker: str,
    cap_tier: str,
    sector: str,
    portfolio_value: float = 100000.0,
    allocation_pct: float = 0.05,
    entry_band_pct: float = 2.0,
    slippage_pct: float = 0.10,
    ma_period: int = 200,
    max_concurrent: int = 4,
    new_entry_threshold_pct: float = 8.0,
) -> Tuple[List[Trade], List[Dict[str, Any]]]:
    """
    Simulate 52W Low->High strategy with fixed exit targets and multi-entry.

    Returns (completed_trades, open_positions_list).
    """
    trades: List[Trade] = []
    df = df.copy()
    df["52w_high"], df["52w_low"] = compute_rolling_52w(df["close"], window=252)
    df["ma200"] = df["close"].rolling(window=ma_period, min_periods=ma_period).mean()

    # Each element: {entry_date, entry_price, exit_target (FIXED), shares, entry_value, slippage_buy}
    open_positions: List[Dict[str, Any]] = []

    for i in range(252, len(df)):
        date = df.index[i].strftime("%Y-%m-%d")
        high = float(df["high"].iloc[i])
        low  = float(df["low"].iloc[i])
        vol  = float(df["volume"].iloc[i])

        w52_low  = float(df["52w_low"].iloc[i])
        w52_high = float(df["52w_high"].iloc[i])
        entry_band_high = w52_low * (1 + entry_band_pct / 100.0)

        # ── Exit check (evaluate BEFORE new entries so same-day exits don't re-enter) ──
        still_open: List[Dict[str, Any]] = []
        for pos in open_positions:
            if high >= pos["exit_target"]:
                exit_price = pos["exit_target"]
                exit_value = pos["shares"] * exit_price
                slippage_sell = exit_value * (slippage_pct / 100.0)
                gross_pnl = exit_value - pos["entry_value"]
                net_pnl = gross_pnl - pos["slippage_buy"] - slippage_sell
                pnl_pct = (net_pnl / pos["entry_value"]) * 100.0
                duration = (
                    datetime.datetime.strptime(date, "%Y-%m-%d")
                    - datetime.datetime.strptime(pos["entry_date"], "%Y-%m-%d")
                ).days
                trades.append(Trade(
                    stock_ticker=ticker,
                    cap_tier=cap_tier,
                    sector=sector,
                    entry_date=pos["entry_date"],
                    entry_price=pos["entry_price"],
                    exit_date=date,
                    exit_price=exit_price,
                    trade_duration_days=duration,
                    shares=pos["shares"],
                    allocation_pct=allocation_pct,
                    portfolio_value=portfolio_value,
                    entry_value=pos["entry_value"],
                    exit_value=exit_value,
                    gross_pnl=gross_pnl,
                    pnl_pct=pnl_pct,
                    slippage_loss=pos["slippage_buy"] + slippage_sell,
                    net_pnl=net_pnl,
                    exit_reason="52W_HIGH",
                ))
            else:
                still_open.append(pos)
        open_positions = still_open

        # ── Entry check ──────────────────────────────────────────────────────────────
        if low <= entry_band_high and vol > 0 and len(open_positions) < max_concurrent:
            entry_price = max(w52_low, low)

            # Only enter if no positions open, OR this low is meaningfully lower
            cheapest = min((p["entry_price"] for p in open_positions), default=None)
            threshold = new_entry_threshold_pct / 100.0
            is_new_low = cheapest is None or entry_price < cheapest * (1 - threshold)

            if is_new_low:
                shares = (portfolio_value * allocation_pct) / entry_price
                entry_value = shares * entry_price
                open_positions.append({
                    "entry_date": date,
                    "entry_price": entry_price,
                    "exit_target": w52_high,   # FIXED — never changes
                    "shares": shares,
                    "entry_value": entry_value,
                    "slippage_buy": entry_value * (slippage_pct / 100.0),
                })

    # ── Report still-open positions ──────────────────────────────────────────────
    last_close  = float(df["close"].iloc[-1])
    last_date   = df.index[-1].strftime("%Y-%m-%d")
    last_w52hi  = float(df["52w_high"].iloc[-1])

    open_details: List[Dict[str, Any]] = []
    for pos in open_positions:
        days_held = (
            datetime.datetime.strptime(last_date, "%Y-%m-%d")
            - datetime.datetime.strptime(pos["entry_date"], "%Y-%m-%d")
        ).days
        unrealised_pct = ((last_close - pos["entry_price"]) / pos["entry_price"]) * 100.0
        pct_to_target  = ((pos["exit_target"] - last_close) / last_close) * 100.0
        open_details.append({
            "entry_date":       pos["entry_date"],
            "entry_price":      round(pos["entry_price"], 2),
            "exit_target":      round(pos["exit_target"], 2),
            "latest_close":     round(last_close, 2),
            "days_held":        days_held,
            "unrealised_pct":   round(unrealised_pct, 2),
            "pct_to_target":    round(pct_to_target, 2),
        })

    return trades, open_details


def build_price_series(df: pd.DataFrame, ma_period: int = 200) -> List[Dict[str, Any]]:
    """Per-day OHLC + rolling bands for chart rendering."""
    df = df.copy()
    df["52w_high"], df["52w_low"] = compute_rolling_52w(df["close"], window=252)
    df["ma200"] = df["close"].rolling(window=ma_period, min_periods=ma_period).mean()

    points = []
    for idx, row in df.iterrows():
        points.append({
            "date":    idx.strftime("%Y-%m-%d"),
            "close":   round(float(row["close"]), 2),
            "high":    round(float(row["high"]), 2),
            "low":     round(float(row["low"]), 2),
            "w52_high": round(float(row["52w_high"]), 2) if not pd.isna(row["52w_high"]) else None,
            "w52_low":  round(float(row["52w_low"]),  2) if not pd.isna(row["52w_low"])  else None,
            "ma200":    round(float(row["ma200"]),     2) if not pd.isna(row["ma200"])    else None,
        })
    return points


def run_backtest(
    watchlist_file: Path,
    output_folder: Path,
    backtest_years: int = 10,
    portfolio_value: float = 100000.0,
    slippage_pct: float = 0.10,
    ma_period: int = 200,
    max_concurrent: int = 4,
    new_entry_threshold_pct: float = 8.0,
) -> None:
    output_folder.mkdir(parents=True, exist_ok=True)

    stocks = parse_f40_watchlist(watchlist_file)
    print(f"Parsed {len(stocks)} stocks from F40 watchlist")

    allocations = {"Large Cap": 0.05, "Mid Cap": 0.03, "Small Cap": 0.02}

    all_trades: List[Trade] = []
    stock_data_map: Dict[str, Dict[str, Any]] = {}
    errors: List[str] = []

    for ticker, (cap_tier, sector) in stocks.items():
        print(f"Processing {ticker} ({cap_tier} | {sector})...")
        allocation = allocations.get(cap_tier, 0.03)

        df = fetch_historical_data(ticker, years=backtest_years, errors=errors)
        if df is None or df.empty:
            print(f"  -> No data, skipped")
            continue

        trades, open_positions = simulate_52w_strategy(
            df, ticker, cap_tier, sector,
            portfolio_value=portfolio_value,
            allocation_pct=allocation,
            slippage_pct=slippage_pct,
            ma_period=ma_period,
            max_concurrent=max_concurrent,
            new_entry_threshold_pct=new_entry_threshold_pct,
        )
        print(f"  -> {len(trades)} completed, {len(open_positions)} open")
        all_trades.extend(trades)

        price_series = build_price_series(df, ma_period=ma_period)
        stock_pnl = sum(t.net_pnl for t in trades)

        stock_data_map[ticker] = {
            "ticker":         ticker,
            "cap_tier":       cap_tier,
            "sector":         sector,
            "latest_close":   round(float(df["close"].iloc[-1]), 2),
            "latest_date":    df.index[-1].strftime("%Y-%m-%d"),
            "trades_count":   len(trades),
            "total_pnl":      round(stock_pnl, 2),
            "open_positions": open_positions,
            "prices":         price_series,
            "trades":         [t.to_dict() for t in trades],
        }

    metrics = compute_portfolio_metrics(all_trades)
    total_open = sum(len(v["open_positions"]) for v in stock_data_map.values())

    summary = {
        "backtest_date":    datetime.date.today().isoformat(),
        "backtest_years":   backtest_years,
        "portfolio_value":  portfolio_value,
        "slippage_pct":     slippage_pct,
        "ma_period":        ma_period,
        "max_concurrent":   max_concurrent,
        "total_trades":     len(all_trades),
        "open_positions":   total_open,
        "stocks_tested":    len(stocks),
        "metrics":          metrics,
    }

    _write_json(output_folder / "backtest_summary.json", summary)
    _write_json(output_folder / "trades.json", [t.to_dict() for t in all_trades])

    overview = [
        {
            "ticker":           ticker,
            "cap_tier":         d["cap_tier"],
            "sector":           d["sector"],
            "latest_close":     d["latest_close"],
            "latest_date":      d["latest_date"],
            "trades_count":     d["trades_count"],
            "total_pnl":        d["total_pnl"],
            "open_count":       len(d["open_positions"]),
        }
        for ticker, d in stock_data_map.items()
    ]
    _write_json(output_folder / "stock_data.json", {"overview": overview, "stock_data": stock_data_map})

    if all_trades:
        csv_file = output_folder / "trades.csv"
        with csv_file.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=all_trades[0].to_dict().keys())
            writer.writeheader()
            for t in all_trades:
                writer.writerow(t.to_dict())

    _write_report(output_folder / "backtest_report.txt", summary, metrics, all_trades, errors)

    print(f"\nBacktest complete: {len(all_trades)} completed trades, {total_open} open positions.")


def _write_json(path: Path, data: Any) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"  Saved {path.name}")


def _write_report(path: Path, summary: Dict, metrics: Dict, trades: List[Trade], errors: List[str]) -> None:
    with path.open("w", encoding="utf-8") as f:
        f.write("=" * 80 + "\n")
        f.write("52-WEEK LOW->HIGH STRATEGY BACKTEST (F40)\n")
        f.write("Exit: FIXED TARGET (52W High at entry date) | No stop-loss | No time limit\n")
        f.write("Multi-entry: new position per revisited 52W low (>=8% below last entry)\n")
        f.write("=" * 80 + "\n\n")
        f.write(f"Date          : {summary['backtest_date']}\n")
        f.write(f"Data period   : {summary['backtest_years']} years\n")
        f.write(f"Portfolio     : Rs {summary['portfolio_value']:,.0f}\n")
        f.write(f"Slippage      : {summary['slippage_pct']}% per side\n")
        f.write(f"Stocks tested : {summary['stocks_tested']}\n")
        f.write(f"Max concurrent: {summary['max_concurrent']} per stock\n\n")
        f.write("METRICS\n" + "-" * 60 + "\n")
        f.write(f"Completed trades : {metrics['total_trades']}\n")
        f.write(f"Open (holding)   : {summary['open_positions']}\n")
        f.write(f"Win rate         : {metrics['win_rate']:.1f}%\n")
        f.write(f"Avg trade P/L    : {metrics['avg_trade_pnl_pct']:.2f}%\n")
        f.write(f"Best trade       : {metrics['max_gain_pct']:.2f}%\n")
        f.write(f"Worst trade      : {metrics['max_loss_pct']:.2f}%\n")
        f.write(f"Avg duration     : {metrics['avg_trade_duration_days']:.0f} days\n")
        f.write(f"CAGR             : {metrics['cagr']:.2f}%\n")
        f.write(f"Sharpe ratio     : {metrics['sharpe']:.2f}\n")
        if errors:
            f.write("\nERRORS\n" + "-" * 60 + "\n")
            for e in errors[:20]:
                f.write(f"  {e}\n")


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="52W Low->High backtest")
    p.add_argument("--watchlist",              default="Source Data/Watchlist/F40.txt")
    p.add_argument("--output",                 default="Source Data/Downloaded Data/backtest_52w")
    p.add_argument("--years",        type=int,   default=10)
    p.add_argument("--portfolio-value", type=float, default=100000.0)
    p.add_argument("--slippage",     type=float, default=0.10)
    p.add_argument("--ma-period",    type=int,   default=200)
    p.add_argument("--max-concurrent", type=int, default=4)
    p.add_argument("--new-entry-threshold", type=float, default=8.0)
    return p


def main():
    args = build_arg_parser().parse_args()
    run_backtest(
        Path(args.watchlist).resolve(),
        Path(args.output).resolve(),
        backtest_years=args.years,
        portfolio_value=args.portfolio_value,
        slippage_pct=args.slippage,
        ma_period=args.ma_period,
        max_concurrent=args.max_concurrent,
        new_entry_threshold_pct=args.new_entry_threshold,
    )


if __name__ == "__main__":
    main()

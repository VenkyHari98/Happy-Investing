"""
Envelope Long Strategy Backtest Engine for F40 stocks.

Features:
- Fetches historical OHLCV data from yfinance
- Simulates long entries at the lower envelope around a 200-period moving average
- Exits at the MA level
- Supports dynamic MA period and envelope width
- Generates JSON, CSV, and human-readable reports
"""

import argparse
import csv
import datetime
import json
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd

from f40_backtest_common import (
    Trade,
    compute_portfolio_metrics,
    fetch_historical_data,
    parse_f40_watchlist,
)


def simulate_envelope_long_strategy(
    df: pd.DataFrame,
    ticker: str,
    cap_tier: str,
    sector: str,
    portfolio_value: float = 100000.0,
    allocation_pct: float = 0.05,
    ma_period: int = 200,
    envelope_pct: float = 14.0,
    entry_band_pct: float = 2.0,
    slippage_pct: float = 0.10,
    ma_type: str = "SMA",
) -> List[Trade]:
    trades: List[Trade] = []
    df = df.copy()
    df["ma"] = df["close"].rolling(window=ma_period, min_periods=ma_period).mean()
    df["lower_envelope"] = df["ma"] * (1 - envelope_pct / 100.0)
    df["upper_envelope"] = df["ma"] * (1 + envelope_pct / 100.0)

    position = None
    position_entered = False

    for i in range(ma_period, len(df)):
        row = df.iloc[i]
        date = row.name.strftime("%Y-%m-%d")
        high = row["high"]
        low = row["low"]
        close = row["close"]
        vol = row["volume"]
        ma = row["ma"]
        lower = row["lower_envelope"]

        if pd.isna(ma) or pd.isna(lower):
            continue

        entry_threshold = lower * (1 + entry_band_pct / 100.0)

        if not position_entered and low <= entry_threshold and vol > 0:
            entry_price = lower
            shares = (portfolio_value * allocation_pct) / entry_price
            entry_value = shares * entry_price
            slippage_cost = entry_value * (slippage_pct / 100.0)
            position = {
                "entry_date": date,
                "entry_price": entry_price,
                "shares": shares,
                "entry_value": entry_value,
            }
            position_entered = True

        if position_entered and high >= ma:
            exit_price = ma
            exit_value = position["shares"] * exit_price
            slippage_cost_exit = exit_value * (slippage_pct / 100.0)
            gross_pnl = exit_value - position["entry_value"]
            net_pnl = gross_pnl - slippage_cost - slippage_cost_exit
            pnl_pct = (net_pnl / position["entry_value"]) * 100.0
            trade_duration = (
                datetime.datetime.strptime(date, "%Y-%m-%d")
                - datetime.datetime.strptime(position["entry_date"], "%Y-%m-%d")
            ).days

            trade = Trade(
                stock_ticker=ticker,
                cap_tier=cap_tier,
                sector=sector,
                entry_date=position["entry_date"],
                entry_price=position["entry_price"],
                exit_date=date,
                exit_price=exit_price,
                trade_duration_days=trade_duration,
                shares=position["shares"],
                allocation_pct=allocation_pct,
                portfolio_value=portfolio_value,
                entry_value=position["entry_value"],
                exit_value=exit_value,
                gross_pnl=gross_pnl,
                pnl_pct=pnl_pct,
                slippage_loss=slippage_cost + slippage_cost_exit,
                net_pnl=net_pnl,
                exit_reason="MA_EXIT",
            )
            trades.append(trade)
            position = None
            position_entered = False

    return trades


def simulate_envelope_short_strategy(
    df: pd.DataFrame,
    ticker: str,
    cap_tier: str,
    sector: str,
    portfolio_value: float = 100000.0,
    allocation_pct: float = 0.05,
    ma_period: int = 200,
    envelope_pct: float = 14.0,
    entry_band_pct: float = 2.0,
    slippage_pct: float = 0.10,
    ma_type: str = "SMA",
) -> List[Trade]:
    trades: List[Trade] = []
    df = df.copy()
    df["ma"] = df["close"].rolling(window=ma_period, min_periods=ma_period).mean()
    df["lower_envelope"] = df["ma"] * (1 - envelope_pct / 100.0)
    df["upper_envelope"] = df["ma"] * (1 + envelope_pct / 100.0)

    position = None
    position_entered = False

    for i in range(ma_period, len(df)):
        row = df.iloc[i]
        date = row.name.strftime("%Y-%m-%d")
        high = row["high"]
        low = row["low"]
        close = row["close"]
        vol = row["volume"]
        ma = row["ma"]
        upper = row["upper_envelope"]

        if pd.isna(ma) or pd.isna(upper):
            continue

        entry_threshold = upper * (1 - entry_band_pct / 100.0)

        if not position_entered and high >= entry_threshold and vol > 0:
            entry_price = upper
            shares = (portfolio_value * allocation_pct) / entry_price
            entry_value = shares * entry_price
            slippage_cost = entry_value * (slippage_pct / 100.0)
            position = {
                "entry_date": date,
                "entry_price": entry_price,
                "shares": shares,
                "entry_value": entry_value,
            }
            position_entered = True

        if position_entered and low <= ma:
            exit_price = ma
            exit_value = position["shares"] * exit_price
            slippage_cost_exit = exit_value * (slippage_pct / 100.0)
            gross_pnl = position["entry_value"] - exit_value
            net_pnl = gross_pnl - slippage_cost - slippage_cost_exit
            pnl_pct = (net_pnl / position["entry_value"]) * 100.0
            trade_duration = (
                datetime.datetime.strptime(date, "%Y-%m-%d")
                - datetime.datetime.strptime(position["entry_date"], "%Y-%m-%d")
            ).days

            trade = Trade(
                stock_ticker=ticker,
                cap_tier=cap_tier,
                sector=sector,
                entry_date=position["entry_date"],
                entry_price=position["entry_price"],
                exit_date=date,
                exit_price=exit_price,
                trade_duration_days=trade_duration,
                shares=position["shares"],
                allocation_pct=allocation_pct,
                portfolio_value=portfolio_value,
                entry_value=position["entry_value"],
                exit_value=exit_value,
                gross_pnl=gross_pnl,
                pnl_pct=pnl_pct,
                slippage_loss=slippage_cost + slippage_cost_exit,
                net_pnl=net_pnl,
                exit_reason="MA_COVER",
            )
            trades.append(trade)
            position = None
            position_entered = False

    return trades


def build_report(
    output_folder: Path,
    summary: Dict[str, Any],
    trades: List[Trade],
    errors: List[str],
    strategy_name: str,
) -> None:
    summary_file = output_folder / "backtest_summary.json"
    with summary_file.open("w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    trades_json_file = output_folder / "trades.json"
    with trades_json_file.open("w", encoding="utf-8") as f:
        json.dump([t.to_dict() for t in trades], f, indent=2)

    csv_file = output_folder / "trades.csv"
    if trades:
        with csv_file.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=trades[0].to_dict().keys())
            writer.writeheader()
            for t in trades:
                writer.writerow(t.to_dict())

    report_file = output_folder / "backtest_report.txt"
    with report_file.open("w", encoding="utf-8") as f:
        f.write("=" * 80 + "\n")
        f.write(f"{strategy_name.upper()} BACKTEST REPORT (F40 STOCKS)\n")
        f.write("=" * 80 + "\n\n")
        f.write(f"Backtest Date: {summary['backtest_date']}\n")
        f.write(f"Backtest Period: {summary['backtest_years']} years\n")
        f.write(f"Portfolio Value: ₹{summary['portfolio_value']:,.2f}\n")
        f.write(f"Slippage/Commission: {summary['slippage_pct']}% per side\n")
        f.write(f"Stocks Tested: {summary['stocks_tested']}\n\n")

        f.write("PERFORMANCE METRICS\n")
        f.write("-" * 80 + "\n")
        for key, value in summary["metrics"].items():
            f.write(f"{key.replace('_', ' ').title()}: {value}\n")

        if trades:
            f.write("\nSAMPLE TRADES (First 10)\n")
            f.write("-" * 80 + "\n")
            for i, t in enumerate(trades[:10]):
                f.write(f"\nTrade #{i+1}\n")
                f.write(f"  Ticker: {t.stock_ticker} ({t.cap_tier})\n")
                f.write(f"  Entry: {t.entry_date} @ ₹{t.entry_price:.2f}\n")
                f.write(f"  Exit: {t.exit_date} @ ₹{t.exit_price:.2f}\n")
                f.write(f"  Duration: {t.trade_duration_days} days\n")
                f.write(f"  P/L: {t.pnl_pct:.2f}% (₹{t.net_pnl:.2f})\n")

        if errors:
            f.write("\nERRORS / WARNINGS\n")
            f.write("-" * 80 + "\n")
            for err in errors:
                f.write(f"- {err}\n")


def run_backtest(
    watchlist_file: Path,
    output_folder: Path,
    direction: str = "long",
    backtest_years: int = 10,
    portfolio_value: float = 100000.0,
    slippage_pct: float = 0.10,
    ma_period: int = 200,
    envelope_pct: float = 14.0,
    entry_band_pct: float = 2.0,
    ma_type: str = "SMA",
) -> None:
    output_folder.mkdir(parents=True, exist_ok=True)
    stocks = parse_f40_watchlist(watchlist_file)
    print(f"Parsed {len(stocks)} stocks from F40 watchlist")

    allocations = {"Large Cap": 0.05, "Mid Cap": 0.03, "Small Cap": 0.02}
    all_trades: List[Trade] = []
    errors: List[str] = []

    simulate_func = (
        simulate_envelope_long_strategy
        if direction.lower() == "long"
        else simulate_envelope_short_strategy
    )
    strategy_name = "Envelope Long" if direction.lower() == "long" else "Envelope Short"

    for ticker, (cap_tier, sector) in stocks.items():
        print(f"Processing {ticker}...")
        allocation_pct = allocations.get(cap_tier, 0.03)
        df = fetch_historical_data(ticker, years=backtest_years, errors=errors)
        if df is None or df.empty:
            print(f"  → No data, skipped")
            continue

        trades = simulate_func(
            df,
            ticker,
            cap_tier,
            sector,
            portfolio_value=portfolio_value,
            allocation_pct=allocation_pct,
            ma_period=ma_period,
            envelope_pct=envelope_pct,
            entry_band_pct=entry_band_pct,
            slippage_pct=slippage_pct,
            ma_type=ma_type,
        )
        print(f"  → {len(trades)} trades generated")
        all_trades.extend(trades)

    metrics = compute_portfolio_metrics(all_trades)
    summary = {
        "backtest_date": datetime.date.today().isoformat(),
        "backtest_years": backtest_years,
        "direction": strategy_name,
        "portfolio_value": portfolio_value,
        "slippage_pct": slippage_pct,
        "ma_period": ma_period,
        "envelope_pct": envelope_pct,
        "entry_band_pct": entry_band_pct,
        "ma_type": ma_type,
        "total_trades": len(all_trades),
        "stocks_tested": len(stocks),
        "metrics": metrics,
    }
    build_report(output_folder, summary, all_trades, errors, strategy_name="Envelope Long")
    print("Backtest complete!")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Envelope Long backtest engine")
    parser.add_argument(
        "--watchlist",
        default="Source Data/Watchlist/F40.txt",
        help="Path to F40 watchlist file",
    )
    parser.add_argument(
        "--output",
        default="Source Data/Downloaded Data/backtest_envelope_long",
        help="Output folder for backtest results",
    )
    parser.add_argument(
        "--years",
        type=int,
        default=10,
        help="Backtest horizon in years (default 10)",
    )
    parser.add_argument(
        "--portfolio-value",
        type=float,
        default=100000.0,
        help="Portfolio value for allocation sizing",
    )
    parser.add_argument(
        "--slippage",
        type=float,
        default=0.10,
        help="Slippage/commission per side in %",
    )
    parser.add_argument(
        "--ma-period",
        type=int,
        default=200,
        help="Moving average period (default 200)",
    )
    parser.add_argument(
        "--envelope-pct",
        type=float,
        default=14.0,
        help="Envelope percentage around MA (default 14)",
    )
    parser.add_argument(
        "--entry-band-pct",
        type=float,
        default=2.0,
        help="Entry band percent around lower envelope (default 2)",
    )
    parser.add_argument(
        "--ma-type",
        type=str,
        default="SMA",
        help="Moving average type: SMA or DMA (default SMA)",
    )
    parser.add_argument(
        "--direction",
        type=str,
        choices=["long", "short"],
        default="long",
        help="Envelope strategy direction: long or short",
    )
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()
    run_backtest(
        Path(args.watchlist).resolve(),
        Path(args.output).resolve(),
        direction=args.direction,
        backtest_years=args.years,
        portfolio_value=args.portfolio_value,
        slippage_pct=args.slippage,
        ma_period=args.ma_period,
        envelope_pct=args.envelope_pct,
        entry_band_pct=args.entry_band_pct,
        ma_type=args.ma_type,
    )


if __name__ == "__main__":
    main()

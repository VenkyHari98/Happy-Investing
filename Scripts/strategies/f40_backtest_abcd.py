"""
ABCD Downward-Averaging Strategy Backtest for F40 stocks.

Features:
- Fetches historical OHLCV data from yfinance
- Starts an ABCD cycle when price touches 14% below 200-period MA
- Buys tranches at fixed 10% lower levels from the initial entry
- Sells each tranche when price recovers one step above its buy price
- Supports dynamic parameters: MA period, envelope percent, step percent, number of tranches
- Produces JSON, CSV, and human-readable report output
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


def simulate_abcd_strategy(
    df: pd.DataFrame,
    ticker: str,
    cap_tier: str,
    sector: str,
    portfolio_value: float = 100000.0,
    allocation_pct: float = 0.05,
    ma_period: int = 200,
    entry_pct: float = 14.0,
    step_pct: float = 10.0,
    num_tranches: int = 5,
    entry_band_pct: float = 2.0,
    slippage_pct: float = 0.10,
) -> List[Trade]:
    trades: List[Trade] = []
    df = df.copy()
    df["ma"] = df["close"].rolling(window=ma_period, min_periods=ma_period).mean()
    df["entry_level"] = df["ma"] * (1 - entry_pct / 100.0)

    cycle = {
        "active": False,
        "base_price": None,
        "pending_levels": [],
        "filled_tranches": [],
    }

    amount_per_tranche = (portfolio_value * allocation_pct) / num_tranches
    step_multiplier = 1 - step_pct / 100.0

    def build_tranche_levels(base_price: float) -> List[Dict[str, Any]]:
        levels = []
        for idx in range(num_tranches):
            level_price = base_price * (step_multiplier ** idx)
            levels.append(
                {
                    "tranche_id": f"T{idx}",
                    "level": float(level_price),
                    "filled": False,
                    "sold": False,
                }
            )
        return levels

    for i in range(ma_period, len(df)):
        row = df.iloc[i]
        date = row.name.strftime("%Y-%m-%d")
        low = row["low"]
        high = row["high"]
        vol = row["volume"]
        ma = row["ma"]
        entry_level = row["entry_level"]

        if pd.isna(ma) or pd.isna(entry_level):
            continue

        entry_threshold = entry_level * (1 + entry_band_pct / 100.0)

        if not cycle["active"] and low <= entry_threshold and vol > 0:
            cycle["active"] = True
            cycle["base_price"] = float(entry_level)
            cycle["pending_levels"] = build_tranche_levels(cycle["base_price"])
            cycle["filled_tranches"] = []

        if cycle["active"]:
            while cycle["pending_levels"] and low <= cycle["pending_levels"][0]["level"]:
                tranche = cycle["pending_levels"].pop(0)
                buy_price = tranche["level"]
                shares = amount_per_tranche / buy_price
                sell_target = buy_price / step_multiplier
                cycle["filled_tranches"].append(
                    {
                        "tranche_id": tranche["tranche_id"],
                        "buy_price": float(buy_price),
                        "sell_target": float(sell_target),
                        "shares": float(shares),
                        "entry_date": date,
                        "sold": False,
                    }
                )

            for tranche in list(cycle["filled_tranches"]):
                if tranche["sold"]:
                    continue
                if high >= tranche["sell_target"]:
                    entry_value = tranche["shares"] * tranche["buy_price"]
                    exit_value = tranche["shares"] * tranche["sell_target"]
                    entry_slippage = entry_value * (slippage_pct / 100.0)
                    exit_slippage = exit_value * (slippage_pct / 100.0)
                    gross_pnl = exit_value - entry_value
                    net_pnl = gross_pnl - entry_slippage - exit_slippage
                    pnl_pct = (net_pnl / entry_value) * 100.0
                    trade_duration = (
                        datetime.datetime.strptime(date, "%Y-%m-%d")
                        - datetime.datetime.strptime(tranche["entry_date"], "%Y-%m-%d")
                    ).days

                    trades.append(
                        Trade(
                            stock_ticker=ticker,
                            cap_tier=cap_tier,
                            sector=sector,
                            entry_date=tranche["entry_date"],
                            entry_price=tranche["buy_price"],
                            exit_date=date,
                            exit_price=tranche["sell_target"],
                            trade_duration_days=trade_duration,
                            shares=tranche["shares"],
                            allocation_pct=allocation_pct / num_tranches,
                            portfolio_value=portfolio_value,
                            entry_value=entry_value,
                            exit_value=exit_value,
                            gross_pnl=gross_pnl,
                            pnl_pct=pnl_pct,
                            slippage_loss=entry_slippage + exit_slippage,
                            net_pnl=net_pnl,
                            exit_reason="ABCD_SELL",
                        )
                    )
                    tranche["sold"] = True

            cycle["filled_tranches"] = [t for t in cycle["filled_tranches"] if not t["sold"]]

            if not cycle["pending_levels"] and not cycle["filled_tranches"]:
                cycle["active"] = False
                cycle["base_price"] = None

    return trades


def build_report(
    output_folder: Path,
    summary: Dict[str, Any],
    trades: List[Trade],
    errors: List[str],
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
        f.write("ABCD STRATEGY BACKTEST REPORT (F40 STOCKS)\n")
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
    backtest_years: int = 10,
    portfolio_value: float = 100000.0,
    slippage_pct: float = 0.10,
    ma_period: int = 200,
    entry_pct: float = 14.0,
    step_pct: float = 10.0,
    num_tranches: int = 5,
    entry_band_pct: float = 2.0,
) -> None:
    output_folder.mkdir(parents=True, exist_ok=True)
    stocks = parse_f40_watchlist(watchlist_file)
    print(f"Parsed {len(stocks)} stocks from F40 watchlist")

    allocations = {"Large Cap": 0.05, "Mid Cap": 0.03, "Small Cap": 0.02}
    all_trades: List[Trade] = []
    errors: List[str] = []

    for ticker, (cap_tier, sector) in stocks.items():
        print(f"Processing {ticker}...")
        allocation_pct = allocations.get(cap_tier, 0.03)
        df = fetch_historical_data(ticker, years=backtest_years, errors=errors)
        if df is None or df.empty:
            print(f"  → No data, skipped")
            continue

        trades = simulate_abcd_strategy(
            df,
            ticker,
            cap_tier,
            sector,
            portfolio_value=portfolio_value,
            allocation_pct=allocation_pct,
            ma_period=ma_period,
            entry_pct=entry_pct,
            step_pct=step_pct,
            num_tranches=num_tranches,
            entry_band_pct=entry_band_pct,
            slippage_pct=slippage_pct,
        )
        print(f"  → {len(trades)} trades generated")
        all_trades.extend(trades)

    metrics = compute_portfolio_metrics(all_trades)
    summary = {
        "backtest_date": datetime.date.today().isoformat(),
        "backtest_years": backtest_years,
        "portfolio_value": portfolio_value,
        "slippage_pct": slippage_pct,
        "ma_period": ma_period,
        "entry_pct": entry_pct,
        "step_pct": step_pct,
        "num_tranches": num_tranches,
        "entry_band_pct": entry_band_pct,
        "total_trades": len(all_trades),
        "stocks_tested": len(stocks),
        "metrics": metrics,
    }
    build_report(output_folder, summary, all_trades, errors)
    print("Backtest complete!")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ABCD strategy backtest engine")
    parser.add_argument(
        "--watchlist",
        default="Source Data/Watchlist/F40.txt",
        help="Path to F40 watchlist file",
    )
    parser.add_argument(
        "--output",
        default="Source Data/Downloaded Data/backtest_abcd",
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
        help="MA period for entry level (default 200)",
    )
    parser.add_argument(
        "--entry-pct",
        type=float,
        default=14.0,
        help="Entry percent below MA (default 14)",
    )
    parser.add_argument(
        "--step-pct",
        type=float,
        default=10.0,
        help="Downstep percent between tranches (default 10)",
    )
    parser.add_argument(
        "--num-tranches",
        type=int,
        default=5,
        help="Number of total tranches including initial entry (default 5)",
    )
    parser.add_argument(
        "--entry-band-pct",
        type=float,
        default=2.0,
        help="Entry tolerance band percent around initial level (default 2)",
    )
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()
    run_backtest(
        Path(args.watchlist).resolve(),
        Path(args.output).resolve(),
        backtest_years=args.years,
        portfolio_value=args.portfolio_value,
        slippage_pct=args.slippage,
        ma_period=args.ma_period,
        entry_pct=args.entry_pct,
        step_pct=args.step_pct,
        num_tranches=args.num_tranches,
        entry_band_pct=args.entry_band_pct,
    )


if __name__ == "__main__":
    main()

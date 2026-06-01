"""
Current opportunity scanner for F40 stocks.

Features:
- Reads F40 watchlist
- Fetches recent daily OHLCV data
- Computes rolling 252-day 52W low/high
- Computes 200-day MA and ±14% envelope bands
- Flags current setup signals for:
  - 52W low buy candidate
  - 52W high sell candidate
  - Envelope long candidate
  - Envelope short candidate
  - ABCD-ready down-averaging zone
- Writes JSON/CSV/text output for frontend usage
"""

import argparse
import csv
import datetime
import json
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd

from f40_backtest_common import fetch_historical_data, parse_f40_watchlist


DEFAULT_ENVELOPE_PCT = 14.0
DEFAULT_PROXIMITY_PCT = 2.0


def compute_current_setup(
    df: pd.DataFrame,
    envelope_pct: float = DEFAULT_ENVELOPE_PCT,
    proximity_pct: float = DEFAULT_PROXIMITY_PCT,
    ma_period: int = 200,
    window: int = 252,
) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    df = df.copy()
    df["52w_high"] = df["close"].rolling(window=window, min_periods=1).max()
    df["52w_low"] = df["close"].rolling(window=window, min_periods=1).min()
    df["ma"] = df["close"].rolling(window=ma_period, min_periods=ma_period).mean()
    df["lower_envelope"] = df["ma"] * (1 - envelope_pct / 100.0)
    df["upper_envelope"] = df["ma"] * (1 + envelope_pct / 100.0)

    last = df.iloc[-1]
    date = last.name.strftime("%Y-%m-%d")
    close = float(last["close"])
    low = float(last["low"])
    high = float(last["high"])
    ma = float(last["ma"]) if not pd.isna(last["ma"]) else None
    w52_high = float(last["52w_high"]) if not pd.isna(last["52w_high"]) else None
    w52_low = float(last["52w_low"]) if not pd.isna(last["52w_low"]) else None
    lower_env = float(last["lower_envelope"]) if not pd.isna(last["lower_envelope"]) else None
    upper_env = float(last["upper_envelope"]) if not pd.isna(last["upper_envelope"]) else None

    def pct_distance(price: float, target: float) -> float:
        return float(((price - target) / target) * 100.0) if target else None

    result["date"] = date
    result["close"] = close
    result["low"] = low
    result["high"] = high
    result["52w_high"] = w52_high
    result["52w_low"] = w52_low
    result["ma"] = ma
    result["lower_envelope"] = lower_env
    result["upper_envelope"] = upper_env
    result["distance_to_52w_low_pct"] = pct_distance(close, w52_low) if w52_low else None
    result["distance_to_52w_high_pct"] = pct_distance(close, w52_high) if w52_high else None
    result["distance_to_lower_envelope_pct"] = pct_distance(close, lower_env) if lower_env else None
    result["distance_to_upper_envelope_pct"] = pct_distance(close, upper_env) if upper_env else None

    result["signals"] = []
    if w52_low and close <= w52_low * (1 + proximity_pct / 100.0):
        result["signals"].append("52W_LOW_BUY_CANDIDATE")
    if w52_high and close >= w52_high * (1 - proximity_pct / 100.0):
        result["signals"].append("52W_HIGH_SELL_CANDIDATE")
    if lower_env and close <= lower_env * (1 + proximity_pct / 100.0):
        result["signals"].append("ENVELOPE_LONG_CANDIDATE")
    if upper_env and close >= upper_env * (1 - proximity_pct / 100.0):
        result["signals"].append("ENVELOPE_SHORT_CANDIDATE")
    if w52_low and close <= w52_low * 0.90:
        result["signals"].append("ABCD_AVERAGE_ZONE")

    if not result["signals"]:
        result["signals"].append("NO_IMMEDIATE_SIGNAL")

    result["summary"] = {
        "days_of_data": len(df),
        "window_days": window,
        "ma_period": ma_period,
        "envelope_pct": envelope_pct,
        "proximity_pct": proximity_pct,
    }
    return result


def build_report(
    output_folder: Path,
    summary: Dict[str, Any],
    rows: List[Dict[str, Any]],
) -> None:
    output_folder.mkdir(parents=True, exist_ok=True)
    summary_file = output_folder / "current_setup_summary.json"
    with summary_file.open("w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    rows_file = output_folder / "current_setup.json"
    with rows_file.open("w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2)

    csv_file = output_folder / "current_setup.csv"
    with csv_file.open("w", newline="", encoding="utf-8") as f:
        fieldnames = list(rows[0].keys()) if rows else []
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    report_file = output_folder / "current_setup_report.txt"
    with report_file.open("w", encoding="utf-8") as f:
        f.write("=" * 80 + "\n")
        f.write("F40 CURRENT OPPORTUNITY SCANNER REPORT\n")
        f.write("=" * 80 + "\n\n")
        f.write(f"Run Date: {summary['run_date']}\n")
        f.write(f"Stocks Scanned: {summary['stocks_scanned']}\n")
        f.write(f"Candidate Stocks: {summary['candidate_count']}\n")
        f.write(f"Window Days: {summary['window_days']}\n")
        f.write(f"MA Period: {summary['ma_period']}\n")
        f.write(f"Envelope Pct: {summary['envelope_pct']}\n")
        f.write(f"Proximity Pct: {summary['proximity_pct']}\n\n")
        f.write("CANDIDATE BREAKDOWN\n")
        f.write("-" * 80 + "\n")
        for signal, count in summary["signal_counts"].items():
            f.write(f"{signal}: {count}\n")


def run_scanner(
    watchlist_file: Path,
    output_root: Path,
    years: int = 2,
    envelope_pct: float = DEFAULT_ENVELOPE_PCT,
    proximity_pct: float = DEFAULT_PROXIMITY_PCT,
    ma_period: int = 200,
    window: int = 252,
) -> None:
    output_date = datetime.date.today().strftime("%d%m%Y")
    output_folder = output_root / output_date
    stocks = parse_f40_watchlist(watchlist_file)

    rows: List[Dict[str, Any]] = []
    signal_counts: Dict[str, int] = {}
    errors: List[str] = []

    for ticker, (cap_tier, sector) in stocks.items():
        try:
            df = fetch_historical_data(ticker, years=years, errors=errors)
            if df is None or df.empty:
                continue
            setup = compute_current_setup(
                df,
                envelope_pct=envelope_pct,
                proximity_pct=proximity_pct,
                ma_period=ma_period,
                window=window,
            )
            row = {
                "ticker": ticker,
                "cap_tier": cap_tier,
                "sector": sector,
                **setup,
            }
            rows.append(row)
            for signal in setup["signals"]:
                signal_counts[signal] = signal_counts.get(signal, 0) + 1
        except Exception as ex:
            errors.append(f"{ticker}: {ex}")

    candidate_count = sum(1 for row in rows if any(s != "NO_IMMEDIATE_SIGNAL" for s in row["signals"]))
    summary = {
        "run_date": datetime.date.today().isoformat(),
        "watchlist_file": str(watchlist_file),
        "stocks_scanned": len(rows),
        "candidate_count": candidate_count,
        "window_days": window,
        "ma_period": ma_period,
        "envelope_pct": envelope_pct,
        "proximity_pct": proximity_pct,
        "signal_counts": signal_counts,
        "errors": errors,
    }

    build_report(output_folder, summary, rows)
    print(f"Saved current setup report to {output_folder}")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="F40 current opportunity scanner")
    parser.add_argument(
        "--watchlist",
        default="Source Data/Watchlist/F40.txt",
        help="Path to F40 watchlist file",
    )
    parser.add_argument(
        "--output-root",
        default="Source Data/Downloaded Data/current_setup",
        help="Root folder for current setup output",
    )
    parser.add_argument(
        "--years",
        type=int,
        default=2,
        help="Historical years of data to fetch (default 2)",
    )
    parser.add_argument(
        "--envelope-pct",
        type=float,
        default=DEFAULT_ENVELOPE_PCT,
        help="Envelope percent around MA (default 14)",
    )
    parser.add_argument(
        "--proximity-pct",
        type=float,
        default=DEFAULT_PROXIMITY_PCT,
        help="Proximity percent for signal bands (default 2)",
    )
    parser.add_argument(
        "--ma-period",
        type=int,
        default=200,
        help="Moving average period (default 200)",
    )
    parser.add_argument(
        "--window",
        type=int,
        default=252,
        help="Rolling window for 52W levels (default 252)",
    )
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()
    run_scanner(
        Path(args.watchlist).resolve(),
        Path(args.output_root).resolve(),
        years=args.years,
        envelope_pct=args.envelope_pct,
        proximity_pct=args.proximity_pct,
        ma_period=args.ma_period,
        window=args.window,
    )


if __name__ == "__main__":
    main()

import argparse
import datetime
import json
import os
import traceback
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

import requests
import yfinance as yf

WATCHLIST_FILES = ["E40.txt", "F40.txt", "S200.txt"]
MAX_SYMBOLS_PER_FILE = 200


@dataclass
class WatchlistStock:
    ticker: str
    cap: str
    sector: str


def json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if value == float("inf") or value == float("-inf"):
            return None
        if value != value:
            return None
        return value
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    return str(value)


def parse_watchlist(path: Path) -> List[WatchlistStock]:
    stocks: List[WatchlistStock] = []
    if not path.exists():
        return stocks

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            raw = line.strip()
            if not raw or raw.startswith("#"):
                continue
            parts = raw.split(";")
            if len(parts) < 3:
                continue
            ticker = parts[0].strip()
            cap = parts[1].strip()
            sector = parts[2].strip()
            if not ticker or not cap or not sector:
                continue
            if ticker.lower() == "ticker" or "ticker" in ticker.lower():
                continue
            stocks.append(WatchlistStock(ticker=ticker, cap=cap, sector=sector))
            if len(stocks) >= MAX_SYMBOLS_PER_FILE:
                break
    return stocks


def parse_all_watchlists(folder: Path) -> List[WatchlistStock]:
    seen: Dict[str, WatchlistStock] = {}
    for file_name in WATCHLIST_FILES:
        path = folder / file_name
        parsed = parse_watchlist(path)
        for stock in parsed:
            key = stock.ticker.upper()
            if key in seen:
                continue
            seen[key] = stock
    return list(seen.values())


def get_output_folder(root: Path, run_date: Optional[datetime.date] = None) -> Path:
    run_date = run_date or datetime.date.today()
    folder_name = run_date.strftime("%d%m%Y")
    output_folder = root / folder_name
    output_folder.mkdir(parents=True, exist_ok=True)
    return output_folder


def write_json(path: Path, data: Any) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def write_error_log(path: Path, errors: List[Dict[str, str]]) -> None:
    lines = [f"Timestamp: {datetime.datetime.now():%Y-%m-%d %H:%M:%S}", ""]
    if not errors:
        lines.append("No errors recorded.")
    else:
        lines.append("Errors:")
        lines.append("ticker | source | stage | message")
        lines.append("-" * 120)
        for error in errors:
            lines.append(
                " | ".join(
                    str(error.get(k, "")) for k in ["ticker", "source", "stage", "message"]
                )
            )
    lines.append("")
    lines.append(f"Total errors: {len(errors)}")
    path.write_text("\n".join(lines), encoding="utf-8")


def history_to_records(df) -> List[Dict[str, Any]]:
    if df is None or df.empty:
        return []
    df = df.copy()
    df.index = df.index.tz_localize(None) if hasattr(df.index, "tz") and df.index.tz else df.index
    df.columns = [c.lower() for c in df.columns]
    records = []
    for index, row in df.iterrows():
        item = {"date": index.strftime("%Y-%m-%d")}
        item.update({k: json_safe(v) for k, v in row.to_dict().items()})
        records.append(item)
    return records


def retrieve_yfinance_data(ticker: str, errors: List[Dict[str, str]]) -> Dict[str, Any]:
    symbol_ns = f"{ticker}.NS"
    symbol_bo = f"{ticker}.BO"
    result: Dict[str, Any] = {"ticker": ticker, "symbol_ns": symbol_ns, "symbol_bo": symbol_bo}

    def load_history(symbol: str, period: str) -> Optional[Any]:
        try:
            t = yf.Ticker(symbol)
            df = t.history(period=period, interval="1d", auto_adjust=True)
            if df is None or df.empty:
                return None
            if df["Close"].isna().all():
                return None
            return df
        except Exception as ex:
            errors.append(
                {
                    "ticker": ticker,
                    "source": "Source A",
                    "stage": f"history-{symbol}-{period}",
                    "message": str(ex),
                }
            )
            return None

    history = load_history(symbol_ns, "5y")
    if history is None:
        history = load_history(symbol_ns, "max")
    if history is None:
        history = load_history(symbol_bo, "5y")
        if history is None:
            history = load_history(symbol_bo, "max")

    if history is not None:
        result["source_a_history"] = history_to_records(history)
    else:
        errors.append(
            {
                "ticker": ticker,
                "source": "Source A",
                "stage": "history-all-fail",
                "message": "yfinance OHLCV lookup failed for both NSE and BSE symbols",
            }
        )

    try:
        t = yf.Ticker(symbol_ns)
        info = t.info or {}
        sanitized = {k: json_safe(v) for k, v in info.items()}
        if "longBusinessSummary" in sanitized and sanitized["longBusinessSummary"]:
            sanitized["longBusinessSummary"] = sanitized["longBusinessSummary"][:600]
        result["source_a_info"] = sanitized
    except Exception as ex:
        errors.append(
            {
                "ticker": ticker,
                "source": "Source A",
                "stage": "info",
                "message": str(ex),
            }
        )

    try:
        t = yf.Ticker(symbol_ns)
        financials = {"income_statement": {}, "balance_sheet": {}, "cashflow": {}}
        if hasattr(t, "financials") and t.financials is not None:
            financials["income_statement"] = [
                {"item": str(idx), **{str(col): json_safe(val) for col, val in row.items()}}
                for idx, row in t.financials.fillna(0).astype(object).iterrows()
            ]
        if hasattr(t, "balance_sheet") and t.balance_sheet is not None:
            financials["balance_sheet"] = [
                {"item": str(idx), **{str(col): json_safe(val) for col, val in row.items()}}
                for idx, row in t.balance_sheet.fillna(0).astype(object).iterrows()
            ]
        if hasattr(t, "cashflow") and t.cashflow is not None:
            financials["cashflow"] = [
                {"item": str(idx), **{str(col): json_safe(val) for col, val in row.items()}}
                for idx, row in t.cashflow.fillna(0).astype(object).iterrows()
            ]
        result["source_a_financials"] = financials
    except Exception as ex:
        errors.append(
            {
                "ticker": ticker,
                "source": "Source A",
                "stage": "financials",
                "message": str(ex),
            }
        )

    try:
        t = yf.Ticker(symbol_ns)
        rec = getattr(t, "recommendations_summary", None)
        if rec is not None and len(rec) > 0:
            rec_row = rec.iloc[0].to_dict()
            result["source_a_recommendations"] = {k: json_safe(v) for k, v in rec_row.items()}
    except Exception as ex:
        errors.append(
            {
                "ticker": ticker,
                "source": "Source A",
                "stage": "recommendations",
                "message": str(ex),
            }
        )

    return result


def fetch_nse_rest_data(ticker: str, errors: List[Dict[str, str]]) -> Dict[str, Any]:
    errors.append(
        {
            "ticker": ticker,
            "source": "Source B",
            "stage": "not-implemented",
            "message": "NSE REST API integration will be added in a later sub-skill.",
        }
    )
    return {"source_b": None}


def fetch_screener_data(ticker: str, errors: List[Dict[str, str]]) -> Dict[str, Any]:
    errors.append(
        {
            "ticker": ticker,
            "source": "Source C",
            "stage": "not-implemented",
            "message": "Screener.in integration will be added in a later sub-skill.",
        }
    )
    return {"source_c": None}


def fetch_fallback_ohlcv(ticker: str, errors: List[Dict[str, str]]) -> Dict[str, Any]:
    errors.append(
        {
            "ticker": ticker,
            "source": "Source D",
            "stage": "not-implemented",
            "message": "Historical OHLCV fallback via NSE archives is not implemented yet.",
        }
    )
    return {"source_d": None}


def fetch_stock_data(stock: WatchlistStock, errors: List[Dict[str, str]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "ticker": stock.ticker,
        "cap": stock.cap,
        "sector": stock.sector,
        "fetched_at": datetime.datetime.now().isoformat(),
    }

    source_a = retrieve_yfinance_data(stock.ticker, errors)
    result["source_a"] = source_a

    source_b = fetch_nse_rest_data(stock.ticker, errors)
    result["source_b"] = source_b

    source_c = fetch_screener_data(stock.ticker, errors)
    result["source_c"] = source_c

    source_d = fetch_fallback_ohlcv(stock.ticker, errors)
    result["source_d"] = source_d

    return result


def run_fetch(
    watchlist_folder: Path,
    output_root: Path,
    run_date: Optional[datetime.date] = None,
) -> None:
    output_folder = get_output_folder(output_root, run_date)
    errors: List[Dict[str, str]] = []

    stocks = parse_all_watchlists(watchlist_folder)
    if not stocks:
        raise RuntimeError(f"No watchlist data found in {watchlist_folder}")

    results: List[Dict[str, Any]] = []
    for stock in stocks:
        try:
            record = fetch_stock_data(stock, errors)
            results.append(record)
        except Exception as ex:
            errors.append(
                {
                    "ticker": stock.ticker,
                    "source": "fetch_loop",
                    "stage": "exception",
                    "message": f"{type(ex).__name__}: {ex}",
                }
            )

    output_file = output_folder / "all_stocks.json"
    write_json(output_file, {"generated_at": datetime.datetime.now().isoformat(), "stocks": results})

    error_file = output_folder / f"errorlog_{output_folder.name}.txt"
    write_error_log(error_file, errors)
    print(f"Saved data to {output_file}")
    print(f"Saved error log to {error_file}")


def parse_date(value: str) -> datetime.date:
    if len(value) == 8 and value.isdigit():
        return datetime.datetime.strptime(value, "%d%m%Y").date()
    return datetime.date.fromisoformat(value)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Indian equity data fetch skill")
    parser.add_argument(
        "--watchlist-folder",
        default="Source Data/Watchlist",
        help="Folder containing the watchlist text files",
    )
    parser.add_argument(
        "--output-root",
        default="Source Data/Downloaded Data",
        help="Root folder for downloaded daily output",
    )
    parser.add_argument(
        "--date",
        help="Date string for the daily folder (DDMMYYYY or YYYY-MM-DD). Default is today.",
    )
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()
    watchlist_folder = Path(args.watchlist_folder).resolve()
    output_root = Path(args.output_root).resolve()
    run_date = parse_date(args.date) if args.date else None
    run_fetch(watchlist_folder, output_root, run_date)


if __name__ == "__main__":
    main()

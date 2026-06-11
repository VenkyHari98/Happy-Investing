"""
S200 20% Rally Scanner
----------------------
Scans the S200 watchlist for valid 20% green-candle rally patterns.

Rules (per class notes):
- Consecutive green candles (close >= open), doji-green ok, red breaks streak
- Measured: low of first green candle → high of last green candle
- Minimum 20% move (19% accepted for single-candle days)
- Buy zone: buy_price ± 0.75%
- Sell target: high of last green candle in rally
- Valid if today <= rally_end_date + 365 days
- S200 condition: buy_price must be below current 200 DMA

Outputs:
  s200_20pct_rallies.json  — flat list of all rally opportunities
  s200_stock_data.json     — per-stock price series + rally zones for chart rendering
"""

import argparse
import datetime
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional, Tuple

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import yfinance as yf
from f40_backtest_common import (
    fetch_all_fundamentals_parallel,
    fetch_historical_data,
    fetch_historical_pe_avgs,
    fetch_stock_pe,
    parse_f40_watchlist,
)
import fundamental_config as cfg


ROOT        = Path(__file__).resolve().parent.parent.parent
F40_PATH    = ROOT / "Source Data" / "Watchlist" / "F40.txt"
E40_PATH    = ROOT / "Source Data" / "Watchlist" / "E40.txt"
S200_PATH   = ROOT / "Source Data" / "Watchlist" / "S200.txt"
OUTPUT_ROOT = ROOT / "Source Data" / "Downloaded Data" / "s200_20pct_rally"

BUY_ZONE_PCT      = 0.75
MIN_RALLY_PCT     = 20.0
SINGLE_CANDLE_MIN = 19.0
APPROACHING_PCT   = 5.0
NEAR_PCT          = 15.0
DATA_YEARS        = 3
CHART_DAYS        = 730   # 2 years of price data for chart rendering

STATUS_PRIORITY = {
    "IN_ZONE":             0,
    "IN_ZONE_NEAR_EXPIRY": 1,
    "APPROACHING":         2,
    "WATCHING_NEAR":       3,
    "WATCHING":            4,
    "BELOW_BUY":           5,
    "EXPIRED":             6,
}


def find_20pct_rallies(df: pd.DataFrame) -> list:
    """Scan OHLC dataframe and return all valid 20%+ green-candle streaks."""
    rallies = []
    n = len(df)
    if n < 2:
        return rallies

    opens  = df["open"].values
    highs  = df["high"].values
    lows   = df["low"].values
    closes = df["close"].values
    dates  = df.index

    i = 0
    while i < n:
        if closes[i] >= opens[i]:
            streak_start = i
            j = i + 1
            while j < n and closes[j] >= opens[j]:
                j += 1
            streak_end = j - 1

            buy_price  = float(lows[streak_start])
            sell_price = float(highs[streak_end])

            if buy_price > 0:
                rally_pct = (sell_price - buy_price) / buy_price * 100
                is_single = streak_end == streak_start
                min_pct   = SINGLE_CANDLE_MIN if is_single else MIN_RALLY_PCT

                if rally_pct >= min_pct:
                    rally_end_dt = dates[streak_end]
                    expiry_dt    = rally_end_dt + pd.Timedelta(days=365)
                    rallies.append({
                        "rally_start_date": dates[streak_start].strftime("%Y-%m-%d"),
                        "rally_end_date":   rally_end_dt.strftime("%Y-%m-%d"),
                        "expiry_date":      expiry_dt.strftime("%Y-%m-%d"),
                        "buy_price":        round(buy_price, 2),
                        "sell_price":       round(sell_price, 2),
                        "rally_pct":        round(rally_pct, 2),
                        "candle_count":     streak_end - streak_start + 1,
                    })
            i = j
        else:
            i += 1

    return rallies


def compute_status(
    current_price: float,
    buy_price: float,
    days_to_expiry: int,
    below_200dma: bool,
) -> str:
    zone_low  = buy_price * (1 - BUY_ZONE_PCT / 100)
    zone_high = buy_price * (1 + BUY_ZONE_PCT / 100)

    if not below_200dma:
        return "ABOVE_DMA"

    if days_to_expiry < 0:
        if zone_low <= current_price <= zone_high:
            return "IN_ZONE_NEAR_EXPIRY"
        return "EXPIRED"

    if current_price < zone_low:
        return "BELOW_BUY"
    if current_price <= zone_high:
        return "IN_ZONE"
    if current_price <= buy_price * (1 + APPROACHING_PCT / 100):
        return "APPROACHING"
    if current_price <= buy_price * (1 + NEAR_PCT / 100):
        return "WATCHING_NEAR"
    return "WATCHING"


def scan_stock(
    ticker: str, cap_tier: str, sector: str,
    today: datetime.date, errors: list,
) -> Tuple[list, Optional[list], Optional[float], Optional[float], Optional[float], Optional[float], Optional[float]]:
    """
    Returns (rally_results, price_series, w52_high, w52_low, pe_current, pe_3yr_avg, pe_5yr_avg).
    price_series/w52/pe are None if no rallies found (saves memory).
    """
    df = fetch_historical_data(ticker, years=DATA_YEARS, errors=errors)
    if df is None or len(df) < 210:
        return [], None, None, None, None, None, None

    ma200_series    = df["close"].rolling(200, min_periods=200).mean()
    w52_high_series = df["close"].rolling(252, min_periods=1).max()
    w52_low_series  = df["close"].rolling(252, min_periods=1).min()

    ma200_val = float(ma200_series.iloc[-1])
    if np.isnan(ma200_val):
        return [], None, None, None, None, None, None

    w52_high_current = round(float(w52_high_series.iloc[-1]), 2)
    w52_low_current  = round(float(w52_low_series.iloc[-1]),  2)
    current_price    = float(df["close"].iloc[-1])
    rallies          = find_20pct_rallies(df)
    results          = []

    for r in rallies:
        expiry_dt      = datetime.date.fromisoformat(r["expiry_date"])
        days_to_expiry = (expiry_dt - today).days

        buy_price  = r["buy_price"]
        sell_price = r["sell_price"]
        zone_low   = round(buy_price * (1 - BUY_ZONE_PCT / 100), 2)
        zone_high  = round(buy_price * (1 + BUY_ZONE_PCT / 100), 2)

        if days_to_expiry < 0:
            continue

        below_200dma = buy_price < ma200_val
        status       = compute_status(current_price, buy_price, days_to_expiry, below_200dma)

        if status == "ABOVE_DMA":
            continue

        if current_price > zone_high:
            dist_to_buy = round((current_price - zone_high) / zone_high * 100, 2)
        elif current_price < zone_low:
            dist_to_buy = round((current_price - zone_low) / zone_low * 100, 2)
        else:
            dist_to_buy = 0.0

        remaining_gain = round((sell_price - current_price) / current_price * 100, 2)

        # Informational: how far has buy_price fallen from the 52W high
        fall_from_52w_high = (
            round((w52_high_current - buy_price) / w52_high_current * 100.0, 2)
            if w52_high_current > 0 else 0.0
        )

        results.append({
            "ticker":                    ticker,
            "cap_tier":                  cap_tier,
            "sector":                    sector,
            "current_price":             round(current_price, 2),
            "ma200":                     round(ma200_val, 2),
            "rally_start_date":          r["rally_start_date"],
            "rally_end_date":            r["rally_end_date"],
            "expiry_date":               r["expiry_date"],
            "days_to_expiry":            days_to_expiry,
            "rally_pct":                 r["rally_pct"],
            "buy_price":                 buy_price,
            "sell_price":                sell_price,
            "buy_zone_low":              zone_low,
            "buy_zone_high":             zone_high,
            "below_200dma":              below_200dma,
            "candle_count":              r["candle_count"],
            "status":                    status,
            "dist_to_buy_zone_pct":      dist_to_buy,
            "remaining_gain_pct":        remaining_gain,
            "fund_fall_from_52w_high_pct": fall_from_52w_high,
        })

    if not results:
        return [], None, None, None, None, None, None

    # Build OHLC price series for chart rendering (last CHART_DAYS of data)
    cutoff    = pd.Timestamp(today - datetime.timedelta(days=CHART_DAYS))
    idx_naive = df.index.tz_localize(None) if df.index.tz is None else df.index.tz_convert(None)
    df_chart  = df[idx_naive >= cutoff]
    prices    = []
    for date, row in df_chart.iterrows():
        ma_val   = ma200_series.get(date, np.nan)
        w52h_val = w52_high_series.get(date, np.nan)
        w52l_val = w52_low_series.get(date, np.nan)
        prices.append({
            "date":     date.strftime("%Y-%m-%d"),
            "open":     round(float(row["open"]),  2),
            "high":     round(float(row["high"]),  2),
            "low":      round(float(row["low"]),   2),
            "close":    round(float(row["close"]), 2),
            "ma200":    round(float(ma_val),    2) if not np.isnan(ma_val)   else None,
            "w52_high": round(float(w52h_val),  2) if not np.isnan(w52h_val) else None,
            "w52_low":  round(float(w52l_val),  2) if not np.isnan(w52l_val) else None,
        })

    pe_current = fetch_stock_pe(ticker)
    pe_3yr_avg, pe_5yr_avg = fetch_historical_pe_avgs(ticker)

    return results, prices, w52_high_current, w52_low_current, pe_current, pe_3yr_avg, pe_5yr_avg


def main():
    parser = argparse.ArgumentParser(description="S200 20% Rally Scanner")
    parser.add_argument("--output-root", default=str(OUTPUT_ROOT))
    args = parser.parse_args()

    output_root = Path(args.output_root)
    today       = datetime.date.today()
    date_str    = today.strftime("%d%m%Y")
    output_dir  = output_root / date_str
    output_dir.mkdir(parents=True, exist_ok=True)

    # Build combined watchlist: F40 > E40 > S200 priority for watchlist_source tagging
    s200_stocks = parse_f40_watchlist(S200_PATH) if S200_PATH.exists() else {}
    e40_stocks  = parse_f40_watchlist(E40_PATH)  if E40_PATH.exists()  else {}
    f40_stocks  = parse_f40_watchlist(F40_PATH)  if F40_PATH.exists()  else {}

    # Merge: S200 base, then E40 overrides, then F40 overrides
    stocks: dict = {}
    for ticker, (cap, sector) in s200_stocks.items():
        stocks[ticker] = (cap, sector, 'S200')
    for ticker, (cap, sector) in e40_stocks.items():
        stocks[ticker] = (cap, sector, 'E40')
    for ticker, (cap, sector) in f40_stocks.items():
        stocks[ticker] = (cap, sector, 'F40')

    total = len(stocks)
    print(f"Scanning {total} stocks (F40={len(f40_stocks)} E40={len(e40_stocks)} S200={len(s200_stocks)}, deduplicated) for 20% rally patterns...")

    all_rallies         = []
    stock_data: dict    = {}
    errors              = []
    stocks_scanned      = 0
    stocks_with_rallies = 0

    with ThreadPoolExecutor(max_workers=16) as pool:
        futs = {
            pool.submit(scan_stock, ticker, cap_tier, sector, today, errors):
            (ticker, cap_tier, sector, watchlist_source)
            for ticker, (cap_tier, sector, watchlist_source) in stocks.items()
        }

        for fut in as_completed(futs):
            ticker, cap_tier, sector, watchlist_source = futs[fut]
            stocks_scanned += 1
            if stocks_scanned % 50 == 0:
                print(f"  {stocks_scanned}/{total} scanned · {len(all_rallies)} rallies found so far...")

            try:
                results, prices, w52_high, w52_low, pe_current, pe_3yr_avg, pe_5yr_avg = fut.result()
            except Exception as ex:
                errors.append(f"{ticker}: {ex}")
                continue

            if results:
                for r in results:
                    r['watchlist_source'] = watchlist_source
                stocks_with_rallies += 1
                all_rallies.extend(results)

                best_status = min(results, key=lambda r: STATUS_PRIORITY.get(r["status"], 99))["status"]
                best_gain   = max(r["remaining_gain_pct"] for r in results)

                # PE filter assessment at stock level
                pe_fails = []
                if pe_current is not None and pe_current > cfg.PE_MAX:
                    pe_fails.append(f"PE {pe_current:.1f} > max {cfg.PE_MAX:.0f}")
                if (cfg.PE_BELOW_5YR_MEDIAN
                        and pe_5yr_avg is not None
                        and pe_current is not None
                        and pe_current >= pe_5yr_avg):
                    pe_fails.append(f"PE {pe_current:.1f} >= 5yr avg {pe_5yr_avg:.1f}")
                pe_pass = len(pe_fails) == 0

                # Per-stock chart entry — slim rally list (no duplicated stock-level fields)
                stock_data[ticker] = {
                    "ticker":            ticker,
                    "cap_tier":          cap_tier,
                    "sector":            sector,
                    "watchlist_source":  watchlist_source,
                    "current_price":     results[0]["current_price"],
                    "ma200":             results[0]["ma200"],
                    "w52_high":          w52_high,
                    "w52_low":           w52_low,
                    "pe_current":        pe_current,
                    "pe_3yr_avg":        pe_3yr_avg,
                    "pe_5yr_avg":        pe_5yr_avg,
                    "fund_pe_pass":      pe_pass,
                    "fund_pe_fail_reasons": pe_fails,
                    "best_status":       best_status,
                    "rally_count":       len(results),
                    "best_gain_pct":     best_gain,
                    "prices":            prices or [],
                    "rallies": sorted(
                        [
                            {
                                "rally_start_date":     r["rally_start_date"],
                                "rally_end_date":       r["rally_end_date"],
                                "expiry_date":          r["expiry_date"],
                                "days_to_expiry":       r["days_to_expiry"],
                                "rally_pct":            r["rally_pct"],
                                "candle_count":         r["candle_count"],
                                "buy_price":            r["buy_price"],
                                "buy_zone_low":         r["buy_zone_low"],
                                "buy_zone_high":        r["buy_zone_high"],
                                "sell_price":           r["sell_price"],
                                "status":               r["status"],
                                "dist_to_buy_zone_pct": r["dist_to_buy_zone_pct"],
                                "remaining_gain_pct":   r["remaining_gain_pct"],
                            }
                            for r in results
                        ],
                        key=lambda x: STATUS_PRIORITY.get(x["status"], 99),
                    ),
                }

    # Phase 2: balance sheet + business quality for stocks with rallies
    if stock_data:
        print(f"Fetching Phase 2 fundamental data for {len(stock_data)} stocks with rallies...")
        fund_map = fetch_all_fundamentals_parallel(list(stock_data.keys()), max_workers=4)
        for tkr, sd in stock_data.items():
            fund = fund_map.get(tkr)
            p2_pass, p2_fails = cfg.apply_fundamental_filter_phase2(fund)
            sd["fund_s3_s5_pass"]          = p2_pass
            sd["fund_s3_s5_fail_reasons"]  = p2_fails
            sd["fund_roce"]                = fund.get("roce_current")       if fund else None
            sd["fund_roe"]                 = fund.get("roe_current")        if fund else None
            sd["fund_net_de"]              = fund.get("net_de_current")     if fund else None
            sd["fund_ttm_np_cr"]           = fund.get("ttm_np_cr")          if fund else None
            sd["fund_sales_vs_ath_pct"]    = fund.get("sales_vs_ath_pct")  if fund else None
            sd["fund_profit_vs_ath_pct"]   = fund.get("profit_vs_ath_pct") if fund else None
            sd["fund_pledged_pct"]         = fund.get("pledged_pct")        if fund else None
    else:
        fund_map = {}

    # Sort flat rally list by status priority then distance
    all_rallies.sort(key=lambda x: (
        STATUS_PRIORITY.get(x["status"], 99),
        x.get("dist_to_buy_zone_pct") or 0,
    ))

    status_counts: dict[str, int] = {}
    for r in all_rallies:
        s = r["status"]
        status_counts[s] = status_counts.get(s, 0) + 1

    # Build sorted stock overview for the left panel list
    overview = sorted(
        [
            {
                "ticker":              v["ticker"],
                "cap_tier":            v["cap_tier"],
                "sector":              v["sector"],
                "watchlist_source":    v.get("watchlist_source", "S200"),
                "current_price":       v["current_price"],
                "w52_high":            v.get("w52_high"),
                "w52_low":             v.get("w52_low"),
                "pe_current":          v.get("pe_current"),
                "pe_3yr_avg":          v.get("pe_3yr_avg"),
                "pe_5yr_avg":          v.get("pe_5yr_avg"),
                "fund_pe_pass":           v.get("fund_pe_pass"),
                "fund_pe_fail_reasons":   v.get("fund_pe_fail_reasons", []),
                "fund_s3_s5_pass":        v.get("fund_s3_s5_pass"),
                "fund_s3_s5_fail_reasons":v.get("fund_s3_s5_fail_reasons", []),
                "fund_roce":              v.get("fund_roce"),
                "fund_roe":               v.get("fund_roe"),
                "fund_net_de":            v.get("fund_net_de"),
                "fund_ttm_np_cr":         v.get("fund_ttm_np_cr"),
                "fund_pledged_pct":       v.get("fund_pledged_pct"),
                "best_status":            v["best_status"],
                "rally_count":         v["rally_count"],
                "best_gain_pct":       v["best_gain_pct"],
            }
            for v in stock_data.values()
        ],
        key=lambda x: (STATUS_PRIORITY.get(x["best_status"], 99), x["ticker"]),
    )

    # ── Write rallies file ─────────────────────────────────────────────────
    source_counts = {"F40": len(f40_stocks), "E40": len(e40_stocks), "S200": len(s200_stocks)}
    fund_pe_pass    = sum(1 for v in stock_data.values() if v.get("fund_pe_pass"))
    fund_s3s5_pass  = sum(1 for v in stock_data.values() if v.get("fund_s3_s5_pass"))
    rallies_out = {
        "run_date":            today.isoformat(),
        "stocks_scanned":      stocks_scanned,
        "stocks_with_rallies": stocks_with_rallies,
        "total_rallies":       len(all_rallies),
        "status_counts":       status_counts,
        "source_counts":       source_counts,
        "fundamental_config": {
            "pe_max":              cfg.PE_MAX,
            "pe_below_5yr_median": cfg.PE_BELOW_5YR_MEDIAN,
        },
        "fundamental_counts": {
            "stocks_pe_pass":   fund_pe_pass,
            "stocks_s3_s5_pass": fund_s3s5_pass,
        },
        "errors_count":        len(errors),
        "rallies":             all_rallies,
        "errors":              errors[:50],
    }
    rallies_path = output_dir / "s200_20pct_rallies.json"
    with open(rallies_path, "w", encoding="utf-8") as f:
        json.dump(rallies_out, f, indent=2, ensure_ascii=False)

    # ── Write stock data file ──────────────────────────────────────────────
    stock_data_out = {
        "run_date":  today.isoformat(),
        "overview":  overview,
        "stock_data": stock_data,
    }
    stock_data_path = output_dir / "s200_stock_data.json"
    with open(stock_data_path, "w", encoding="utf-8") as f:
        json.dump(stock_data_out, f, indent=2, ensure_ascii=False)

    print(f"\nDone.")
    print(f"  Stocks scanned:         {stocks_scanned}")
    print(f"  Stocks with rallies:    {stocks_with_rallies}")
    print(f"  Total rally entries:    {len(all_rallies)}")
    for s, c in sorted(status_counts.items(), key=lambda x: STATUS_PRIORITY.get(x[0], 99)):
        print(f"    {s:<25} {c}")
    print(f"  Errors:                 {len(errors)}")
    print(f"  Rallies:    {rallies_path}")
    print(f"  Stock data: {stock_data_path}")


if __name__ == "__main__":
    main()

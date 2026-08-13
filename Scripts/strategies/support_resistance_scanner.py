"""
Support & Resistance Scanner
-----------------------------
Scans the F40 + E40 + S200 watchlists for stocks currently at/near a
historically-validated support zone, per class notes:

- No indicator — support/resistance zones are found visually on the chart by
  looking for price levels the stock has bounced off multiple times.
- Minimum 2 touches to consider a zone valid; the "3rd approach" is when the
  bus-analogy says to actually take the trade.
- Maximum 5-year lookback — older levels lose relevance.
- Buy at support, sell at resistance. Buy point should be below 200 DMA.

This scanner codifies "zoom out and eyeball it" into a deterministic
algorithm (swing-point detection -> clustering into zones -> touch counting),
the same kind of translation f40_backtest_rhs_cwh.py already did for the
Reverse Head & Shoulder / Cup With Handle patterns.

v1 scope: scanner only (current opportunities). No backtest/portfolio yet —
see the plan for why (zone-detection needs visual validation against real
charts first).

Outputs:
  support_resistance.json — flat list of current opportunities (one per stock)
"""

import argparse
import datetime
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from f40_backtest_common import (
    compute_fall_from_high,
    fetch_all_fundamentals_parallel,
    fetch_all_pe_parallel,
    fetch_all_stocks_parallel,
    parse_f40_watchlist,
)
import fundamental_config as cfg


ROOT        = Path(__file__).resolve().parent.parent.parent
F40_PATH    = ROOT / "Source Data" / "Watchlist" / "F40.txt"
E40_PATH    = ROOT / "Source Data" / "Watchlist" / "E40.txt"
S200_PATH   = ROOT / "Source Data" / "Watchlist" / "S200.txt"
OUTPUT_ROOT = ROOT / "Source Data" / "Downloaded Data" / "support_resistance"

DATA_YEARS          = 10   # fetch window — needed for the fall-from-10yr-high Must-Have gate
ZONE_LOOKBACK_YEARS = 5    # zone detection itself only uses the trailing N years (per notes)
SWING_WINDOW         = 10   # trading days on each side to confirm a swing point
SWING_DEPTH_PCT      = 3.0  # minimum % move to count as a genuine bounce, not noise
ZONE_TOLERANCE_PCT   = 2.0  # cluster swing points within this % of each other into one zone
BUY_ZONE_PCT         = 2.0  # current price must be within this % of the support level
MIN_TOUCHES_VALID    = 2    # zone needs this many confirmed prior touches to be tradeable

STATUS_PRIORITY = {
    "IN_ZONE":    0,
    "WATCHING":   1,
    "ABOVE_DMA":  2,
}


# ── Swing point detection (same technique as f40_backtest_rhs_cwh.py's
# find_significant_minima/find_significant_maxima, tuned for this strategy) ──

def find_swing_lows(prices: np.ndarray, window: int = SWING_WINDOW, depth_pct: float = SWING_DEPTH_PCT) -> List[int]:
    n = len(prices)
    result = []
    for i in range(window, n - window):
        seg = prices[i - window: i + window + 1]
        if prices[i] != seg.min():
            continue
        local_high = max(prices[i - window: i + 1].max(), prices[i: i + window + 1].max())
        if local_high > 0 and prices[i] < local_high * (1.0 - depth_pct / 100.0):
            result.append(i)
    return result


def find_swing_highs(prices: np.ndarray, window: int = SWING_WINDOW, depth_pct: float = SWING_DEPTH_PCT) -> List[int]:
    n = len(prices)
    result = []
    for i in range(window, n - window):
        seg = prices[i - window: i + window + 1]
        if prices[i] != seg.max():
            continue
        local_low = min(prices[i - window: i + 1].min(), prices[i: i + window + 1].min())
        if local_low > 0 and prices[i] > local_low * (1.0 + depth_pct / 100.0):
            result.append(i)
    return result


def cluster_into_zones(swing_prices: List[float], tolerance_pct: float = ZONE_TOLERANCE_PCT) -> List[Dict]:
    """Group nearby swing prices into zones. Returns [{'level': float, 'touches': int}, ...]."""
    if not swing_prices:
        return []
    ordered = sorted(swing_prices)
    zones: List[List[float]] = [[ordered[0]]]
    for p in ordered[1:]:
        if abs(p - zones[-1][-1]) / zones[-1][-1] * 100.0 <= tolerance_pct:
            zones[-1].append(p)
        else:
            zones.append([p])
    return [{"level": sum(z) / len(z), "touches": len(z)} for z in zones]


def pair_support_with_resistance(support_zones: List[Dict], resistance_zones: List[Dict]) -> None:
    """Attach the nearest VALIDATED resistance zone ABOVE each support zone as its
    target (mutates in place). Only zones with >= MIN_TOUCHES_VALID touches count as
    candidates — a one-off swing high a hair above support is noise, not a real
    ceiling the stock has actually bounced off repeatedly.
    """
    for s in support_zones:
        candidates = [
            r for r in resistance_zones
            if r["level"] > s["level"] and r["touches"] >= MIN_TOUCHES_VALID
        ]
        s["target"] = min(candidates, key=lambda r: r["level"])["level"] if candidates else None


def detect_zones(df: pd.DataFrame, lookback_years: int = ZONE_LOOKBACK_YEARS) -> Tuple[List[Dict], List[Dict]]:
    """Return (support_zones, resistance_zones) from the trailing lookback_years of df."""
    cutoff = df.index.max() - pd.DateOffset(years=lookback_years)
    window_df = df[df.index >= cutoff]
    if len(window_df) < SWING_WINDOW * 2 + 1:
        return [], []

    lows  = window_df["low"].values.astype(float)
    highs = window_df["high"].values.astype(float)

    support_zones    = cluster_into_zones([lows[i]  for i in find_swing_lows(lows)])
    resistance_zones = cluster_into_zones([highs[i] for i in find_swing_highs(highs)])
    pair_support_with_resistance(support_zones, resistance_zones)
    return support_zones, resistance_zones


def pick_nearest_zone(zones: List[Dict], current_price: float) -> Optional[Dict]:
    if not zones:
        return None
    return min(zones, key=lambda z: abs(current_price - z["level"]))


def compute_status(zone: Dict, current_price: float, ma200: Optional[float]) -> Tuple[str, float]:
    """Returns (status, dist_to_support_pct)."""
    level = zone["level"]
    dist_pct = round((current_price - level) / level * 100.0, 2)
    below_dma = ma200 is not None and not np.isnan(ma200) and level < ma200
    if not below_dma:
        return "ABOVE_DMA", dist_pct
    in_zone = abs(dist_pct) <= BUY_ZONE_PCT
    if in_zone and zone["touches"] >= MIN_TOUCHES_VALID:
        return "IN_ZONE", dist_pct
    return "WATCHING", dist_pct


def scan_stock(
    ticker: str, cap_tier: str, sector: str, watchlist_source: str, df: Optional[pd.DataFrame]
) -> Optional[Dict]:
    if df is None or len(df) < SWING_WINDOW * 2 + 1:
        return None

    ma200_series = df["close"].rolling(200, min_periods=200).mean()
    ma200_val    = float(ma200_series.iloc[-1]) if not ma200_series.empty else float("nan")
    current_price = float(df["close"].iloc[-1])

    support_zones, resistance_zones = detect_zones(df)
    zone = pick_nearest_zone(support_zones, current_price)
    if zone is None:
        return None

    status, dist_pct = compute_status(zone, current_price, ma200_val)
    remaining_gain_pct = (
        round((zone["target"] - current_price) / current_price * 100.0, 2)
        if zone.get("target") else None
    )

    return {
        "ticker":               ticker,
        "cap_tier":             cap_tier,
        "sector":               sector,
        "watchlist_source":     watchlist_source,
        "current_price":        round(current_price, 2),
        "ma200":                round(ma200_val, 2) if not np.isnan(ma200_val) else None,
        "support_level":        round(zone["level"], 2),
        "resistance_level":     round(zone["target"], 2) if zone.get("target") else None,
        "touch_count":          zone["touches"],
        "abcd_b_level":         round(zone["level"] * 0.90, 2),  # informational only — see plan
        "status":               status,
        "dist_to_support_pct":  dist_pct,
        "remaining_gain_pct":   remaining_gain_pct,
        "below_200dma":         status != "ABOVE_DMA",
    }


def main():
    parser = argparse.ArgumentParser(description="Support & Resistance Scanner")
    parser.add_argument("--output-root", default=str(OUTPUT_ROOT))
    args = parser.parse_args()

    output_root = Path(args.output_root)
    today       = datetime.date.today()
    date_str    = today.strftime("%d%m%Y")
    output_dir  = output_root / date_str
    output_dir.mkdir(parents=True, exist_ok=True)

    # Three-way watchlist merge tagging watchlist_source — same pattern as
    # s200_20pct_rally_scanner.py (not parse_watchlists(), which doesn't tag source).
    s200_stocks = parse_f40_watchlist(S200_PATH) if S200_PATH.exists() else {}
    e40_stocks  = parse_f40_watchlist(E40_PATH)  if E40_PATH.exists()  else {}
    f40_stocks  = parse_f40_watchlist(F40_PATH)  if F40_PATH.exists()  else {}

    stocks: dict = {}
    for ticker, (cap, sector) in s200_stocks.items():
        stocks[ticker] = (cap, sector, 'S200')
    for ticker, (cap, sector) in e40_stocks.items():
        stocks[ticker] = (cap, sector, 'E40')
    for ticker, (cap, sector) in f40_stocks.items():
        stocks[ticker] = (cap, sector, 'F40')

    total = len(stocks)
    print(f"Scanning {total} stocks (F40={len(f40_stocks)} E40={len(e40_stocks)} S200={len(s200_stocks)}, deduplicated) for support/resistance zones...")

    errors: List[str] = []
    print(f"Fetching OHLCV for {total} stocks (cached)...")
    stock_dfs = fetch_all_stocks_parallel(stocks, years=DATA_YEARS, errors=errors)
    print(f"  {len(stock_dfs)}/{total} stocks with usable price history")

    print(f"Fetching PE data for {len(stock_dfs)} stocks in parallel...")
    pe_map = fetch_all_pe_parallel(stock_dfs.keys())

    print(f"Fetching Phase 2 fundamental data for {len(stock_dfs)} stocks...")
    fund_map = fetch_all_fundamentals_parallel(stock_dfs.keys(), max_workers=4, errors=errors)

    results: List[Dict] = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        futs = {
            pool.submit(scan_stock, ticker, cap_tier, sector, watchlist_source, stock_dfs.get(ticker)): ticker
            for ticker, (cap_tier, sector, watchlist_source) in stocks.items()
        }
        for fut in as_completed(futs):
            ticker = futs[fut]
            try:
                row = fut.result()
            except Exception as ex:
                errors.append(f"{ticker}: {ex}")
                continue
            if row is None:
                continue

            df = stock_dfs.get(ticker)
            cap_tier = stocks[ticker][0]

            # ── Fundamental filter assessment — identical pattern to every other scanner ──
            below_200dma = row["below_200dma"]

            high_10yr, fall_from_10yr_high = compute_fall_from_high(df, years=10)
            fall_pass, fall_fail_reason = cfg.check_fall_from_high(cap_tier, fall_from_10yr_high)

            pe_current, pe_3yr_avg, pe_5yr_avg = pe_map.get(ticker, (None, None, None))
            pe_fails = []
            if pe_current is not None and pe_current > cfg.PE_MAX:
                pe_fails.append(f"PE {pe_current:.1f} > max {cfg.PE_MAX:.0f}")
            if (cfg.PE_BELOW_5YR_MEDIAN and pe_5yr_avg is not None
                    and pe_current is not None and pe_current >= pe_5yr_avg):
                pe_fails.append(f"PE {pe_current:.1f} >= 5yr avg {pe_5yr_avg:.1f}")
            pe_pass = len(pe_fails) == 0

            fund = fund_map.get(ticker)
            p2_pass, p2_fails = cfg.apply_fundamental_filter_phase2(fund)
            if fall_fail_reason:
                p2_fails = [*p2_fails, fall_fail_reason]

            row.update({
                "pe_current":                pe_current,
                "pe_5yr_avg":                pe_5yr_avg,
                "fund_below_200dma":         below_200dma,
                "fund_fall_from_10yr_high_pct": fall_from_10yr_high,
                "fund_fall_from_high_pass":  fall_pass,
                "fund_pe_pass":              pe_pass,
                "fund_pe_fail_reasons":      pe_fails,
                "fund_s3_s5_pass":           p2_pass,
                "fund_s3_s5_fail_reasons":   p2_fails,
                "fund_is_financial":         cfg.is_financial_sector(fund.get("sector", ""), fund.get("industry", "")) if fund else False,
                "fund_roce":                 fund.get("roce_current")      if fund else None,
                "fund_roe":                  fund.get("roe_current")       if fund else None,
                "fund_net_de":               fund.get("net_de_current")    if fund else None,
                "fund_ttm_np_cr":            fund.get("ttm_np_cr")         if fund else None,
                "fund_sales_vs_ath_pct":     fund.get("sales_vs_ath_pct")  if fund else None,
                "fund_profit_vs_ath_pct":    fund.get("profit_vs_ath_pct") if fund else None,
                "fund_tfa_vs_ath_pct":       fund.get("tfa_vs_ath_pct")    if fund else None,
                "fund_opm_3yr":              fund.get("opm_3yr")           if fund else None,
                "fund_roce_source":          fund.get("roce_source")       if fund else None,
                "fund_roe_source":           fund.get("roe_source")        if fund else None,
                "fund_opm_source":           fund.get("opm_source")        if fund else None,
                "fund_pledged_pct":          fund.get("pledged_pct")       if fund else None,
                "fund_public_shareholding_pct": fund.get("public_shareholding_pct") if fund else None,
                "fund_all_pass": bool(
                    (below_200dma or not cfg.REQUIRE_BELOW_200DMA)
                    and pe_pass
                    and p2_pass
                    and fall_pass
                ),
            })
            results.append(row)

    results.sort(key=lambda x: (STATUS_PRIORITY.get(x["status"], 99), abs(x["dist_to_support_pct"])))

    status_counts: Dict[str, int] = {}
    for r in results:
        status_counts[r["status"]] = status_counts.get(r["status"], 0) + 1

    source_counts = {"F40": len(f40_stocks), "E40": len(e40_stocks), "S200": len(s200_stocks)}

    out = {
        "run_date":       today.isoformat(),
        "stocks_scanned": len(stock_dfs),
        "total_found":    len(results),
        "status_counts":  status_counts,
        "source_counts":  source_counts,
        "opportunities":  results,
        "errors":         errors[:50],
    }
    out_path = output_dir / "support_resistance.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    print(f"\nDone.")
    print(f"  Stocks scanned: {len(stock_dfs)}")
    print(f"  Opportunities found: {len(results)}")
    for s, c in sorted(status_counts.items(), key=lambda x: STATUS_PRIORITY.get(x[0], 99)):
        print(f"    {s:<12} {c}")
    print(f"  Errors: {len(errors)}")
    print(f"  Output: {out_path}")


if __name__ == "__main__":
    main()

"""
Reconciliation audit for fundamentals data — the "how do we know it's picked up
properly" check.

Screener.in is the primary source for ROCE/ROE/OPM/Sales(TTM)/Net Profit(TTM) (see
f40_backtest_common.py's _screener_merge_fundamentals), with yfinance as fallback
only when Screener.in has nothing for a ticker. This audit exists to catch the two
failure modes that flipping the merge silently doesn't surface on its own:

  1. missing_screener — a ticker has no Screener.in data for a Must-Have ratio, so
     the gate quietly ran on the (structurally different) yfinance fallback instead.
  2. outliers — yfinance and Screener.in both have data but disagree by more than a
     large relative margin. Normal cross-source formula differences (different
     "capital employed"/revenue-line definitions) are expected and usually stay
     within this margin; a bigger gap is more likely an actual scraper parsing bug
     (wrong table row/column picked) and is worth a manual spot-check.

Not meant to adjudicate which source is "more correct" for a given stock — that
call already defaults to Screener.in. This is purely a net to catch missing or
garbled data.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional

OUTLIER_RELATIVE_THRESHOLD = 0.40  # 40% relative deviation

# (report key, "current" field, yfinance-raw field, source field or None)
_SCALAR_METRICS = [
    ("roce", "roce_current", "_yf_roce_current", "roce_source"),
    ("roe", "roe_current", "_yf_roe_current", "roe_source"),
    ("sales_ttm_cr", "ttm_revenue_cr", "_yf_ttm_revenue_cr", None),
    ("net_profit_ttm_cr", "ttm_np_cr", "_yf_ttm_np_cr", None),
]


def _relative_diff(a: float, b: float) -> Optional[float]:
    denom = max(abs(a), abs(b))
    if denom == 0:
        return None
    return abs(a - b) / denom


def build_discrepancy_report(tickers: List[str]) -> Dict:
    """
    For each ticker, load its cached fundamentals (data_cache.get_fundamental_metrics
    — a pure cache read, no network calls) and compare the Screener-primary
    "current" value against the pre-merge yfinance-only snapshot kept for this
    purpose. Returns {"missing_screener": [...], "outliers": [...]}.
    """
    from data_cache import get_fundamental_metrics

    missing_screener: List[Dict] = []
    outliers: List[Dict] = []

    for ticker in tickers:
        fund = get_fundamental_metrics(ticker)
        if not fund:
            continue

        for metric, current_key, yf_raw_key, source_key in _SCALAR_METRICS:
            current_val = fund.get(current_key)
            yf_val = fund.get(yf_raw_key)
            if current_val is None:
                continue
            if yf_val is None:
                # yfinance had nothing either — not a "missing Screener" case,
                # just a stock with no data on this metric from any source.
                continue
            if source_key and fund.get(source_key) == "yfinance":
                # current IS the yfinance value (Screener had nothing) — flag it
                # so it's visible which stocks are running on the fallback.
                missing_screener.append({"ticker": ticker, "metric": metric, "value": current_val})
                continue
            rel = _relative_diff(current_val, yf_val)
            if rel is not None and rel > OUTLIER_RELATIVE_THRESHOLD:
                outliers.append({
                    "ticker": ticker,
                    "metric": metric,
                    "screener_value": current_val,
                    "yfinance_value": yf_val,
                    "relative_diff_pct": round(rel * 100, 1),
                })

        # OPM: compare latest (index 0) of the 3yr trend arrays the same way.
        opm_current = fund.get("opm_3yr")
        opm_yf = fund.get("_yf_opm_3yr")
        if opm_current and fund.get("opm_source") == "yfinance":
            missing_screener.append({"ticker": ticker, "metric": "opm", "value": opm_current[0]})
        elif opm_current and opm_yf:
            rel = _relative_diff(opm_current[0], opm_yf[0])
            if rel is not None and rel > OUTLIER_RELATIVE_THRESHOLD:
                outliers.append({
                    "ticker": ticker,
                    "metric": "opm",
                    "screener_value": opm_current[0],
                    "yfinance_value": opm_yf[0],
                    "relative_diff_pct": round(rel * 100, 1),
                })

    outliers.sort(key=lambda r: r["relative_diff_pct"], reverse=True)
    return {"missing_screener": missing_screener, "outliers": outliers}


def write_discrepancy_report(tickers: List[str], output_path: Path) -> Dict:
    report = build_discrepancy_report(tickers)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"  Fundamentals reconciliation: {len(report['outliers'])} outlier(s), "
          f"{len(report['missing_screener'])} metric(s) on yfinance fallback "
          f"→ {output_path}")
    return report


if __name__ == "__main__":
    import sys
    from f40_backtest_common import parse_watchlists

    watchlist_arg = sys.argv[1] if len(sys.argv) > 1 else None
    if not watchlist_arg:
        print("Usage: python fundamentals_audit.py <watchlist1.txt,watchlist2.txt,...>")
        sys.exit(1)

    paths = [Path(p.strip()) for p in watchlist_arg.split(",")]
    all_tickers = list(parse_watchlists(paths).keys())
    out = Path(__file__).resolve().parent.parent.parent / "Source Data" / "Downloaded Data" / "fundamentals_discrepancies.json"
    write_discrepancy_report(all_tickers, out)

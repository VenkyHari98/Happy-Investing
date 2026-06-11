import datetime
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd
import yfinance as yf


@dataclass
class Trade:
    stock_ticker: str
    cap_tier: str
    sector: str
    entry_date: str
    entry_price: float
    exit_date: str
    exit_price: float
    trade_duration_days: int
    shares: float
    allocation_pct: float
    portfolio_value: float
    entry_value: float
    exit_value: float
    gross_pnl: float
    pnl_pct: float
    slippage_loss: float
    net_pnl: float
    exit_reason: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def parse_f40_watchlist(path: Path) -> Dict[str, Tuple[str, str]]:
    """Parse a watchlist file and return dict of {ticker: (cap_tier, sector)}.

    Handles two formats:
    1. Semicolon-delimited: Ticker;CapTier;Sector
    2. Simple list: one ticker per line
    """
    stocks: Dict[str, Tuple[str, str]] = {}
    if not path.exists():
        raise FileNotFoundError(f"Watchlist not found: {path}")

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            if ";" in line:
                parts = line.split(";")
                if len(parts) < 3:
                    continue
                ticker = parts[0].strip()
                cap = parts[1].strip()
                sector = parts[2].strip()
                if ticker and cap and sector and ticker.upper() != "TICKER":
                    stocks[ticker] = (cap, sector)
            else:
                ticker = line.strip()
                if ticker and ticker.upper() != "TICKER":
                    stocks[ticker] = ("Mid Cap", "Unknown")
    return stocks


def parse_watchlists(paths) -> Dict[str, Tuple[str, str]]:
    """Parse one or more watchlist files and merge into a single dict.

    Accepts a single Path, a list of Paths, or a comma-separated string.
    Later files override earlier ones on ticker collision.
    """
    if isinstance(paths, (str, Path)):
        path_list = [Path(p.strip()) for p in str(paths).split(",")]
    else:
        path_list = list(paths)
    merged: Dict[str, Tuple[str, str]] = {}
    for p in path_list:
        merged.update(parse_f40_watchlist(Path(p)))
    return merged


def fetch_historical_pe_series(
    ticker: str,
) -> Tuple[Optional[pd.Series], Optional[pd.Series]]:
    """
    Build a daily PE ratio series from quarterly (or annual) EPS data via yfinance.

    Returns (pe_daily, pe_5yr_median) — both pd.Series indexed by tz-naive date.
    Returns (None, None) when insufficient data is available; callers must treat
    None as "no PE data → skip PE gate for this stock".

    pe_daily     : daily Price/TTM-EPS  (price ÷ trailing-12-month EPS)
    pe_5yr_median: rolling 1260-trading-day (≈5yr, min 252) median of pe_daily

    Method:
      1. Try quarterly_income_stmt, fall back to quarterly_financials, then annual.
      2. Prefer 'Diluted EPS' / 'Basic EPS' rows; compute from Net Income/Shares
         if direct EPS rows are absent.
      3. TTM EPS = rolling 4-quarter sum of positive quarters.
         For annual data, the annual EPS IS the TTM EPS.
      4. Forward-fill quarterly/annual EPS onto the daily price index (no look-ahead
         beyond the reporting date — we use each figure only from the date it appears).
      5. PE values outside [1, 500] are treated as noise and set to NaN.
    """
    symbols = [f"{ticker}.BO"] if ticker.isdigit() else [f"{ticker}.NS", f"{ticker}.BO"]
    for symbol in symbols:
        try:
            t = yf.Ticker(symbol)

            # ── Step 1: extract both quarterly TTM and annual EPS ─────────────
            # yfinance gives ~5 quarters of quarterly data but 4-5 years of
            # annual data. Merge them: annual provides historical base,
            # quarterly TTM overrides for recent dates (more granular).
            eps_quarterly = _extract_eps_from_stmt(t, quarterly=True)
            eps_annual    = _extract_eps_from_stmt(t, quarterly=False)

            quarterly_ttm: Optional[pd.Series] = None
            if eps_quarterly is not None and len(eps_quarterly) >= 4:
                q_ttm = eps_quarterly.rolling(window=4, min_periods=4).sum()
                quarterly_ttm = q_ttm[q_ttm > 0]

            annual_ttm: Optional[pd.Series] = None
            if eps_annual is not None:
                a = eps_annual.dropna()
                annual_ttm = a[a > 0] if not a.empty else None

            # Build merged EPS series: annual base + quarterly override
            if quarterly_ttm is not None and annual_ttm is not None:
                merged = annual_ttm.copy()
                for dt, val in quarterly_ttm.items():
                    merged[dt] = val
                ttm_eps = merged[merged > 0].sort_index()
            elif quarterly_ttm is not None:
                ttm_eps = quarterly_ttm
            elif annual_ttm is not None:
                ttm_eps = annual_ttm
            else:
                continue

            if ttm_eps.empty:
                continue

            # ── Step 2: daily price history ───────────────────────────────────
            hist = t.history(period="15y", interval="1d", auto_adjust=True)
            if hist is None or hist.empty:
                continue
            hist.index = (
                hist.index.tz_localize(None) if hist.index.tz is not None else hist.index
            )

            # ── Step 3: forward-fill EPS onto daily index (no look-ahead) ─────
            combined_idx = hist.index.union(ttm_eps.index).sort_values()
            ttm_daily    = ttm_eps.reindex(combined_idx).ffill().reindex(hist.index)

            # ── Step 4: daily PE  ─────────────────────────────────────────────
            pe_daily = (hist["Close"] / ttm_daily).round(2)
            pe_daily = pe_daily.replace([np.inf, -np.inf], np.nan)
            pe_daily = pe_daily.where((pe_daily >= 1) & (pe_daily <= 500))

            if pe_daily.dropna().empty:
                continue

            # ── Step 5: rolling 5-year median (1260 td, min 1yr of data) ──────
            pe_5yr_median = pe_daily.rolling(window=1260, min_periods=252).median()

            return pe_daily, pe_5yr_median

        except Exception:
            continue

    return None, None


def _extract_eps_from_stmt(t: "yf.Ticker", quarterly: bool) -> Optional[pd.Series]:
    """
    Pull EPS from yfinance income statement (quarterly or annual).
    Returns a chronologically sorted pd.Series(EPS, index=Date) or None.
    Handles both new-API (income_stmt) and old-API (financials) attribute names.
    """
    stmt = None
    if quarterly:
        for attr in ("quarterly_income_stmt", "quarterly_financials"):
            try:
                candidate = getattr(t, attr, None)
                if candidate is not None and not candidate.empty:
                    stmt = candidate
                    break
            except Exception:
                pass
    else:
        for attr in ("income_stmt", "financials"):
            try:
                candidate = getattr(t, attr, None)
                if candidate is not None and not candidate.empty:
                    stmt = candidate
                    break
            except Exception:
                pass

    if stmt is None or stmt.empty:
        return None

    # Normalise column dates to tz-naive
    cols = pd.to_datetime(stmt.columns)
    if cols.tz is not None:
        cols = cols.tz_localize(None)
    stmt = stmt.copy()
    stmt.columns = cols

    # Try direct EPS rows first
    for key in ("Diluted EPS", "Basic EPS"):
        if key in stmt.index:
            row = stmt.loc[key].sort_index()
            s = pd.to_numeric(row, errors="coerce").dropna()
            if not s.empty:
                return s

    # Fallback: compute EPS = Net Income / Shares
    ni_key = next(
        (k for k in ("Net Income", "Net Income Common Stockholders") if k in stmt.index),
        None,
    )
    sh_key = next(
        (k for k in ("Diluted Average Shares", "Basic Average Shares",
                     "Ordinary Shares Number", "Share Issued")
         if k in stmt.index),
        None,
    )
    if ni_key and sh_key:
        ni = pd.to_numeric(stmt.loc[ni_key], errors="coerce")
        sh = pd.to_numeric(stmt.loc[sh_key], errors="coerce")
        eps = (ni / sh).sort_index().dropna()
        if not eps.empty:
            return eps

    return None


def fetch_all_pe_series_parallel(
    tickers: Iterable,
    max_workers: int = 6,
    use_cache: bool = True,
) -> Dict[str, Tuple[Optional[pd.Series], Optional[pd.Series]]]:
    """
    Fetch (pe_daily, pe_5yr_median) for all tickers concurrently.

    Returns {ticker: (pe_daily_series, pe_5yr_median_series)}.
    Either series may be None when yfinance has no EPS data for that stock.
    The PE gate is silently skipped for any stock where both are None.
    """
    def _fetch(ticker: str) -> Tuple[str, Tuple]:
        if use_cache:
            try:
                from data_cache import get_pe_series
                return (ticker, get_pe_series(ticker))
            except ImportError:
                pass
        return (ticker, fetch_historical_pe_series(ticker))

    results: Dict[str, Tuple] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = {pool.submit(_fetch, t): t for t in tickers}
        for fut in as_completed(futs):
            ticker = futs[fut]
            try:
                _, pe_tuple = fut.result()
                results[ticker] = pe_tuple if pe_tuple else (None, None)
            except Exception:
                results[ticker] = (None, None)
    return results


# ── Phase 2: Balance Sheet + Business Quality metrics ──────────────────────

_REV_KEYS  = ['Total Revenue', 'Revenue', 'Operating Revenue']
_NI_KEYS   = ['Net Income', 'Net Income Common Stockholders',
               'Net Income From Continuing Operations']
_OP_KEYS   = ['Operating Income', 'EBIT', 'Pretax Income']
_TA_KEYS   = ['Total Assets']
_CL_KEYS   = ['Current Liabilities', 'Total Current Liabilities']
_EQ_KEYS   = ['Stockholders Equity', 'Total Stockholders Equity',
               'Total Equity Gross Minority Interest', 'Common Stock Equity']
_LTD_KEYS  = ['Long Term Debt', 'Long Term Debt And Capital Lease Obligation']
_STD_KEYS  = ['Current Debt', 'Short Term Borrowings',
               'Current Debt And Capital Lease Obligation']
_CASH_KEYS = ['Cash And Cash Equivalents',
               'Cash Cash Equivalents And Short Term Investments',
               'Cash And Short Term Investments']


def _norm_cols(stmt):
    """Normalize financial statement column dates to tz-naive Timestamps."""
    if stmt is None or stmt.empty:
        return None
    cols = pd.to_datetime(stmt.columns, errors='coerce')
    if hasattr(cols, 'tz') and cols.tz is not None:
        cols = cols.tz_localize(None)
    out = stmt.copy()
    out.columns = cols
    return out


def _first_nonempty(ticker_obj, *attrs):
    """Return the first non-empty DataFrame attribute from a yfinance Ticker."""
    for attr in attrs:
        try:
            s = getattr(ticker_obj, attr, None)
            if s is not None and not s.empty:
                return s
        except Exception:
            pass
    return None


def _row_series(stmt, keys) -> Optional[pd.Series]:
    """Extract first matching row as a chronologically sorted Series."""
    if stmt is None:
        return None
    for key in keys:
        if key in stmt.index:
            s = pd.to_numeric(stmt.loc[key], errors='coerce').dropna()
            if not s.empty:
                return s.sort_index()
    return None


def _col_val(stmt, col, keys) -> Optional[float]:
    """Read a single numeric value from a statement cell (col is a Timestamp)."""
    if stmt is None:
        return None
    for key in keys:
        if key in stmt.index and col in stmt.columns:
            v = stmt.at[key, col]
            if pd.notna(v):
                return float(v)
    return None


def _screener_pledged(ticker: str) -> Optional[float]:
    """Return latest promoter pledge % from Screener.in cache, or None."""
    try:
        from screener_cache import load_screener_data
        sc = load_screener_data(ticker)
        if sc:
            return sc.get("pledged_pct_latest")
    except Exception:
        pass
    return None


def fetch_fundamental_metrics(ticker: str) -> Optional[Dict]:
    """
    Fetch Phase 2 fundamental metrics via yfinance annual + quarterly statements.

    Returns a dict with both current-snapshot values (for scanners) and annual
    historical time-series (for backtests with forward-fill by date).

    Sections covered (from fundamental_config.py):
      3 — Balance sheet: ROCE, ROE, Net Debt/Equity, TTM Net Profit (Cr)
      4 — Governance: pledged_pct returned as None (gate wired; Screener.in needed for data)
      5 — Business quality: Sales vs ATH, Profit vs ATH, OPM trend
    Sections deferred (Screener.in required):
      6 — TFA vs ATH (Fixed Asset breakdown unreliable from yfinance)

    Returns None when no income-statement data is available. Individual metric
    fields may be None when yfinance has no data for that metric — callers must
    treat None as "gate not applicable, do not block".
    """
    symbols = [f"{ticker}.BO"] if ticker.isdigit() else [f"{ticker}.NS", f"{ticker}.BO"]
    for symbol in symbols:
        try:
            t    = yf.Ticker(symbol)
            info = t.info or {}
            sector      = info.get("sector",    "") or ""
            industry    = info.get("industry",  "") or ""
            mktcap_raw  = info.get("marketCap") or info.get("market_cap")
            marketcap_cr = round(float(mktcap_raw) / 1e7, 1) if mktcap_raw else None

            ann_is = _norm_cols(_first_nonempty(t, 'income_stmt', 'financials'))
            ann_bs = _norm_cols(_first_nonempty(t, 'balance_sheet'))
            q_is   = _norm_cols(_first_nonempty(t, 'quarterly_income_stmt', 'quarterly_financials'))

            if ann_is is None and q_is is None:
                continue

            # ── Annual series ──────────────────────────────────────────────
            rev_s = _row_series(ann_is, _REV_KEYS)
            ni_s  = _row_series(ann_is, _NI_KEYS)
            op_s  = _row_series(ann_is, _OP_KEYS)

            # OPM series: [(date_str, pct), ...] newest-first
            opm_series: List[Tuple[str, float]] = []
            if op_s is not None and rev_s is not None:
                for dt in sorted(op_s.index, reverse=True):
                    if dt in rev_s.index:
                        rv = float(rev_s[dt])
                        ov = float(op_s[dt])
                        if rv > 0:
                            opm_series.append((dt.strftime("%Y-%m-%d"),
                                               round(ov / rv * 100, 2)))

            # Revenue and profit dicts (Cr) — only positive values
            revenue_cr: Dict[str, float] = {}
            if rev_s is not None:
                for dt, v in rev_s.items():
                    if pd.notna(v) and v > 0:
                        revenue_cr[dt.strftime("%Y-%m-%d")] = round(float(v) / 1e7, 2)

            profit_cr: Dict[str, float] = {}
            if ni_s is not None:
                for dt, v in ni_s.items():
                    if pd.notna(v) and v > 0:
                        profit_cr[dt.strftime("%Y-%m-%d")] = round(float(v) / 1e7, 2)

            peak_rev = max(revenue_cr.values()) if revenue_cr else None
            peak_np  = max(profit_cr.values())  if profit_cr  else None

            # ── Annual balance-sheet ratios ────────────────────────────────
            roce_dict:   Dict[str, float] = {}
            roe_dict:    Dict[str, float] = {}
            net_de_dict: Dict[str, float] = {}

            if ann_bs is not None and not ann_bs.empty:
                for col in ann_bs.columns:
                    if not hasattr(col, 'strftime'):
                        continue
                    dt_s = col.strftime("%Y-%m-%d")

                    ta   = _col_val(ann_bs, col, _TA_KEYS)
                    cl   = _col_val(ann_bs, col, _CL_KEYS)
                    eq   = _col_val(ann_bs, col, _EQ_KEYS)
                    ltd  = _col_val(ann_bs, col, _LTD_KEYS) or 0.0
                    std  = _col_val(ann_bs, col, _STD_KEYS) or 0.0
                    cash = _col_val(ann_bs, col, _CASH_KEYS) or 0.0

                    # EBIT: exact date match first, then nearest in income series
                    ebit = _col_val(ann_is, col, _OP_KEYS)
                    if ebit is None and op_s is not None and not op_s.empty:
                        try:
                            idx = op_s.index.get_indexer([col], method='nearest')
                            if idx[0] >= 0:
                                ebit = float(op_s.iloc[idx[0]])
                        except Exception:
                            pass

                    ni = _col_val(ann_is, col, _NI_KEYS)
                    if ni is None and ni_s is not None and not ni_s.empty:
                        try:
                            idx = ni_s.index.get_indexer([col], method='nearest')
                            if idx[0] >= 0:
                                ni = float(ni_s.iloc[idx[0]])
                        except Exception:
                            pass

                    cap_emp = (ta - cl) if (ta and cl) else None
                    if ebit is not None and cap_emp and cap_emp > 0:
                        roce_dict[dt_s] = round(ebit / cap_emp * 100, 1)

                    if ni is not None and eq and eq > 0:
                        roe_dict[dt_s] = round(ni / eq * 100, 1)

                    if eq and eq > 0:
                        net_de_dict[dt_s] = round((ltd + std - cash) / eq, 3)

            # ── TTM from quarterly ─────────────────────────────────────────
            ttm_revenue_cr: Optional[float] = None
            ttm_np_cr:      Optional[float] = None
            if q_is is not None and not q_is.empty:
                q_rev = _row_series(q_is, _REV_KEYS)
                q_ni  = _row_series(q_is, _NI_KEYS)
                if q_rev is not None:
                    r4 = q_rev.sort_index(ascending=False).head(4)
                    if len(r4) >= 4:
                        ttm_revenue_cr = round(float(r4.sum()) / 1e7, 2)
                if q_ni is not None:
                    r4 = q_ni.sort_index(ascending=False).head(4)
                    if len(r4) >= 4:
                        ttm_np_cr = round(float(r4.sum()) / 1e7, 2)

            # ── Current snapshot (most recent annual value) ────────────────
            def _latest(d: dict) -> Optional[float]:
                return d[max(d)] if d else None

            sales_vs_ath: Optional[float] = None
            if ttm_revenue_cr and peak_rev and peak_rev > 0:
                sales_vs_ath = round(ttm_revenue_cr / peak_rev * 100, 1)

            profit_vs_ath: Optional[float] = None
            if ttm_np_cr and ttm_np_cr > 0 and peak_np and peak_np > 0:
                profit_vs_ath = round(ttm_np_cr / peak_np * 100, 1)

            return {
                "ticker":      ticker,
                "sector":      sector,
                "industry":    industry,
                "marketcap_cr": marketcap_cr,
                # Current snapshot (for scanners — no date context needed)
                "ttm_revenue_cr":    ttm_revenue_cr,
                "ttm_np_cr":         ttm_np_cr,
                "roce_current":      _latest(roce_dict),
                "roe_current":       _latest(roe_dict),
                "net_de_current":    _latest(net_de_dict),
                "opm_3yr":           [v for _, v in opm_series[:3]] if opm_series else None,
                "sales_vs_ath_pct":  sales_vs_ath,
                "profit_vs_ath_pct": profit_vs_ath,
                # Section 4 — Governance — filled from Screener.in cache when available
                "pledged_pct":       _screener_pledged(ticker),
                # Historical series (for backtests — forward-fill by date)
                "roce_series":       roce_dict,
                "roe_series":        roe_dict,
                "net_de_series":     net_de_dict,
                "opm_series":        opm_series,     # [(date_str, pct), ...] newest-first
                "revenue_series_cr": revenue_cr,
                "profit_series_cr":  profit_cr,
                "peak_revenue_cr":   peak_rev,
                "peak_profit_cr":    peak_np,
            }

        except Exception:
            continue

    return None


def fetch_all_fundamentals_parallel(
    tickers: Iterable,
    max_workers: int = 4,
    use_cache: bool = True,
) -> Dict[str, Optional[Dict]]:
    """
    Fetch Phase 2 fundamental metrics for all tickers concurrently.
    Returns {ticker: metrics_dict | None}.
    Uses weekly file cache via data_cache.get_fundamental_metrics when available.
    """
    def _fetch(ticker: str) -> Tuple[str, Optional[Dict]]:
        if use_cache:
            try:
                from data_cache import get_fundamental_metrics
                return (ticker, get_fundamental_metrics(ticker))
            except ImportError:
                pass
        return (ticker, fetch_fundamental_metrics(ticker))

    results: Dict[str, Optional[Dict]] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = {pool.submit(_fetch, t): t for t in tickers}
        for fut in as_completed(futs):
            ticker = futs[fut]
            try:
                _, m = fut.result()
                results[ticker] = m
            except Exception:
                results[ticker] = None
    return results


def fetch_stock_pe(ticker: str) -> Optional[float]:
    """Fetch trailing P/E. Tries yfinance first, falls back to Screener.in cache."""
    symbols = [f"{ticker}.BO"] if ticker.isdigit() else [f"{ticker}.NS", f"{ticker}.BO"]
    for symbol in symbols:
        try:
            info = yf.Ticker(symbol).info
            pe = info.get("trailingPE")
            if pe and isinstance(pe, (int, float)) and 0 < pe < 2000:
                return round(float(pe), 1)
        except Exception:
            pass
    # Screener.in fallback — critical for insurance / NBFC / financial holding companies
    # where yfinance has no standard EPS data.
    try:
        from screener_cache import load_screener_data
        sc = load_screener_data(ticker)
        if sc and sc.get("pe_ttm") and sc["pe_ttm"] > 0:
            return round(float(sc["pe_ttm"]), 1)
    except Exception:
        pass
    return None


def fetch_historical_pe_avgs(ticker: str) -> Tuple[Optional[float], Optional[float]]:
    """Estimate 3yr and 5yr average trailing PE from yfinance annual income statement.

    Returns (pe_3yr_avg, pe_5yr_avg). Both None if data unavailable.
    Fails silently — non-critical; caller should display '—' on None.
    """
    symbols = [f"{ticker}.BO"] if ticker.isdigit() else [f"{ticker}.NS", f"{ticker}.BO"]
    for symbol in symbols:
        try:
            t = yf.Ticker(symbol)
            stmt = t.income_stmt
            if stmt is None or stmt.empty:
                continue

            eps_row = None
            for key in ("Diluted EPS", "Basic EPS"):
                if key in stmt.index:
                    eps_row = stmt.loc[key]
                    break
            if eps_row is None:
                continue

            hist = t.history(period="6y", interval="1mo", auto_adjust=True)
            if hist is None or hist.empty:
                continue
            hist_idx = hist.index.tz_localize(None) if hist.index.tz is not None else hist.index

            pe_vals: List[float] = []
            for col in eps_row.index:
                try:
                    eps = float(eps_row[col])
                except (TypeError, ValueError):
                    continue
                if not (eps > 0) or np.isnan(eps):
                    continue
                ts = pd.Timestamp(col)
                if ts.tz is not None:
                    ts = ts.tz_localize(None)
                idx = int(hist_idx.searchsorted(ts))
                if idx >= len(hist):
                    idx = len(hist) - 1
                price = float(hist["Close"].iloc[idx])
                pe = price / eps
                if 0 < pe < 2000:
                    pe_vals.append(round(pe, 1))

            if not pe_vals:
                continue

            n3 = min(len(pe_vals), 3)
            n5 = min(len(pe_vals), 5)
            pe_3yr = round(sum(pe_vals[:n3]) / n3, 1)
            pe_5yr = round(sum(pe_vals[:n5]) / n5, 1)
            return pe_3yr, pe_5yr
        except Exception:
            pass

    # Screener.in fallback — compute PE from Screener EPS history + yfinance monthly prices.
    # Covers insurance / financial stocks where yfinance has no income statement EPS.
    try:
        from screener_cache import load_screener_data
        sc = load_screener_data(ticker)
        if sc and sc.get("eps_annual"):
            symbols = [f"{ticker}.BO"] if ticker.isdigit() else [f"{ticker}.NS", f"{ticker}.BO"]
            for symbol in symbols:
                try:
                    hist = yf.Ticker(symbol).history(period="6y", interval="1mo", auto_adjust=True)
                    if hist is None or hist.empty:
                        continue
                    hist_idx = hist.index.tz_localize(None) if hist.index.tz is not None else hist.index
                    pe_vals: List[float] = []
                    # eps_annual keys are like "Mar 2024" — sort newest first
                    for period_label, eps_val in sorted(
                        sc["eps_annual"].items(),
                        key=lambda kv: kv[0],
                        reverse=True,
                    )[:6]:
                        try:
                            eps = float(eps_val)
                            if not (eps > 0) or np.isnan(eps):
                                continue
                            ts = pd.Timestamp(period_label)
                            idx = int(hist_idx.searchsorted(ts))
                            if idx >= len(hist):
                                idx = len(hist) - 1
                            price = float(hist["Close"].iloc[idx])
                            pe = price / eps
                            if 0 < pe < 2000:
                                pe_vals.append(round(pe, 1))
                        except Exception:
                            continue
                    if pe_vals:
                        n3 = min(len(pe_vals), 3)
                        n5 = min(len(pe_vals), 5)
                        return round(sum(pe_vals[:n3]) / n3, 1), round(sum(pe_vals[:n5]) / n5, 1)
                    break
                except Exception:
                    pass
    except Exception:
        pass

    return None, None


def fetch_historical_data(
    ticker: str, years: int = 10, errors: Optional[List[str]] = None
) -> Optional[pd.DataFrame]:
    """Fetch historical daily OHLCV data from yfinance."""
    if errors is None:
        errors = []

    symbols = [f"{ticker}.BO"] if ticker.isdigit() else [f"{ticker}.NS", f"{ticker}.BO"]
    for symbol in symbols:
        try:
            t = yf.Ticker(symbol)
            df = t.history(period=f"{years}y", interval="1d", auto_adjust=True)
            if df is None or df.empty:
                continue
            if df["Close"].isna().all():
                continue
            df.index.name = "Date"
            df.columns = [c.lower() for c in df.columns]
            df = df[["open", "high", "low", "close", "volume"]].copy()
            df = df.dropna(subset=["close"])
            return df
        except Exception as ex:
            errors.append(f"{ticker} ({symbol}): {ex}")
            continue

    errors.append(f"{ticker}: no data from yfinance (NSE or BSE)")
    return None


def fetch_all_stocks_parallel(
    tickers: Iterable,
    years: int,
    max_workers: int = 10,
    errors: Optional[List[str]] = None,
    use_cache: bool = True,
) -> Dict[str, pd.DataFrame]:
    """Fetch OHLCV for all tickers concurrently. Returns {ticker: DataFrame}.

    Uses the daily file-based cache (data_cache.get_ohlcv) by default so
    same-day re-runs are near-instant. Falls back to direct yfinance calls if
    data_cache is unavailable.
    """
    if errors is None:
        errors = []

    if use_cache:
        try:
            from data_cache import get_ohlcv
            def _fetch(ticker: str):
                return (ticker, get_ohlcv(ticker, years, errors))
        except ImportError:
            use_cache = False

    if not use_cache:
        def _fetch(ticker: str):
            return (ticker, fetch_historical_data(ticker, years, errors))

    results: Dict[str, pd.DataFrame] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = {pool.submit(_fetch, t): t for t in tickers}
        for fut in as_completed(futs):
            try:
                ticker, df = fut.result()
                if df is not None:
                    results[ticker] = df
            except Exception as ex:
                errors.append(str(ex))
    return results


def fetch_all_pe_parallel(
    tickers: Iterable,
    max_workers: int = 6,
) -> Dict[str, Tuple[Optional[float], Optional[float], Optional[float]]]:
    """Fetch (pe_current, pe_3yr_avg, pe_5yr_avg) for all tickers concurrently.

    Returns {ticker: (pe_current, pe_3yr_avg, pe_5yr_avg)}.
    """
    def _fetch(ticker: str):
        pe = fetch_stock_pe(ticker)
        pe3, pe5 = fetch_historical_pe_avgs(ticker)
        return (ticker, (pe, pe3, pe5))

    results: Dict[str, Tuple] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = {pool.submit(_fetch, t): t for t in tickers}
        for fut in as_completed(futs):
            ticker = futs[fut]
            try:
                _, pe_tuple = fut.result()
                results[ticker] = pe_tuple
            except Exception:
                results[ticker] = (None, None, None)
    return results


def compute_rolling_52w(prices: pd.Series, window: int = 252) -> Tuple[pd.Series, pd.Series]:
    if isinstance(prices, np.ndarray):
        prices = pd.Series(prices)
    rolling_high = prices.rolling(window=window, min_periods=1).max()
    rolling_low = prices.rolling(window=window, min_periods=1).min()
    return rolling_high, rolling_low


def compute_portfolio_metrics(trades: List[Trade]) -> Dict[str, Any]:
    if not trades:
        return {
            "total_trades": 0,
            "winning_trades": 0,
            "losing_trades": 0,
            "win_rate": 0.0,
            "total_pnl": 0.0,
            "avg_trade_pnl_pct": 0.0,
            "max_gain_pct": 0.0,
            "max_loss_pct": 0.0,
            "avg_trade_duration_days": 0,
            "cagr": 0.0,
            "sharpe": 0.0,
            "max_drawdown": 0.0,
        }

    pnl_pcts = [t.pnl_pct for t in trades]
    winning = len([p for p in pnl_pcts if p > 0])
    losing = len([p for p in pnl_pcts if p < 0])
    total_pnl = sum([t.net_pnl for t in trades])
    avg_pnl_pct = np.mean(pnl_pcts) if pnl_pcts else 0.0
    max_gain = max(pnl_pcts) if pnl_pcts else 0.0
    max_loss = min(pnl_pcts) if pnl_pcts else 0.0
    avg_duration = np.mean([t.trade_duration_days for t in trades]) if trades else 0

    if len(trades) > 1:
        first_date = datetime.datetime.strptime(trades[0].entry_date, "%Y-%m-%d")
        last_date = datetime.datetime.strptime(trades[-1].exit_date, "%Y-%m-%d")
        days_elapsed = (last_date - first_date).days
        years_elapsed = max(days_elapsed / 365.25, 0.1)
        base_portfolio_value = trades[0].portfolio_value
        total_return = total_pnl / base_portfolio_value
        cagr = (((1 + total_return) ** (1 / years_elapsed)) - 1) * 100.0
    else:
        cagr = 0.0

    if len(pnl_pcts) > 1:
        sharpe = (np.mean(pnl_pcts) / (np.std(pnl_pcts) + 1e-6)) * np.sqrt(252)
    else:
        sharpe = 0.0

    max_dd = abs(min(pnl_pcts)) if pnl_pcts else 0.0

    return {
        "total_trades": len(trades),
        "winning_trades": winning,
        "losing_trades": losing,
        "win_rate": (winning / len(trades)) * 100.0 if trades else 0.0,
        "total_pnl": total_pnl,
        "avg_trade_pnl_pct": avg_pnl_pct,
        "max_gain_pct": max_gain,
        "max_loss_pct": max_loss,
        "avg_trade_duration_days": avg_duration,
        "cagr": cagr,
        "sharpe": sharpe,
        "max_drawdown": max_dd,
    }

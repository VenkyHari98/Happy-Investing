import datetime
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

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
_PPE_KEYS        = ['Net PPE', 'Gross PPE']
_INTANGIBLE_KEYS = ['Goodwill And Other Intangible Assets', 'Other Intangible Assets',
                      'Goodwill']


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
    """Return latest promoter pledge % from Screener.in cache, or None.

    Not in the main company page HTML or its shareholding table — it's a
    "quick ratio" (an account-level custom addition to Screener's #top-ratios
    panel), loaded via a separate AJAX call after page load. Confirmed real via
    the site's own ratio catalog (/api/ratio/search/?q=pledge) and wired up in
    screener_cache.py's ScreenerClient._fetch_pledged_pct, which adds it to the
    account once (persists server-side, applies to every ticker from then on)
    the same way the site's own "+ Add Ratio" search box does.
    """
    try:
        from screener_cache import load_screener_data
        sc = load_screener_data(ticker)
        if sc:
            return sc.get("pledged_pct_latest")
    except Exception:
        pass
    return None


def _screener_public_shareholding(ticker: str) -> Optional[float]:
    """Return latest "Public" shareholding %, or None.

    Screener.in's shareholding table breaks holders into Promoters / FIIs / DIIs
    / Government / Public / Others — "Public" (retail + non-institutional) is its
    own line item, not "100 - promoter %" (that would include FIIs/DIIs/Govt too,
    and is a completely different, much larger number: e.g. INFY's non-promoter
    share is ~86%, but its actual "Public" row is ~14-16%). Read the "Public"
    series directly (public_pct_latest, picked by parsed period date in
    screener_cache.py — never assumes table column order).
    """
    try:
        from screener_cache import load_screener_data
        sc = load_screener_data(ticker)
        if sc:
            return sc.get("public_pct_latest")
    except Exception:
        pass
    return None


def _screener_prefer(target: Dict[str, float], screener_series: Optional[Dict[str, float]]) -> None:
    """Merge Screener.in period values into a yfinance-keyed {'YYYY-MM-DD': value}
    dict IN PLACE. Screener.in wins whenever it has a value for a year — yfinance's
    own value for that year is overwritten. yfinance values only survive for years
    Screener has no entry for at all.

    Screener.in is treated as the more reliable source for these ratios: yfinance
    and Screener.in compute ROCE/OPM from genuinely different formula definitions
    (different "capital employed"/revenue-line bases), and Screener.in is the
    source this project's strategy rules and gate thresholds were designed around.

    Matches by fiscal YEAR, not exact date string — yfinance keys balance-sheet
    columns by their real reported date (e.g. "2026-03-31"), while Screener's
    parsed period labels always normalize to day 1 ("2026-03-01"). Both represent
    the same fiscal year but are different string keys, so a plain
    `target[key] = value` would silently insert a second, parallel entry instead
    of actually overriding — any existing entry for that year must be removed
    first.
    """
    if not screener_series:
        return
    from screener_cache import parse_period_label

    for label, value in screener_series.items():
        d = parse_period_label(label)
        if d is None:
            continue
        year = str(d.year)
        for existing_key in [k for k in target if k[:4] == year]:
            del target[existing_key]
        target[d.isoformat()] = value


def _screener_fill_gap_years_only(target: Dict[str, float], screener_series: Optional[Dict[str, float]]) -> None:
    """Like _screener_prefer, but only fills years yfinance has nothing at all
    for — yfinance's own value always wins when both sources cover a year.

    Used for Net D/E specifically: Screener.in's scraped balance sheet only
    exposes "Borrowings" and "Equity Capital" (face-value share capital, not
    total shareholders' equity — Reserves isn't folded in) with no cash line at
    all, so what we'd compute from it is a fundamentally different, less
    accurate ratio (missing Reserves in the denominator, never nets out cash)
    than yfinance's own properly-computed Net Debt/Equity — not a case of
    "different but equally valid formula" like ROCE/OPM, just worse data. Kept
    only as a last-resort fallback for years yfinance has no balance sheet at
    all — never treated as primary.
    """
    if not screener_series:
        return
    from screener_cache import parse_period_label

    existing_years = {k[:4] for k in target}
    for label, value in screener_series.items():
        d = parse_period_label(label)
        if d is None or str(d.year) in existing_years:
            continue
        target[d.isoformat()] = value
        existing_years.add(str(d.year))


def _screener_merge_fundamentals(
    ticker: str,
    revenue_cr: Dict[str, float],
    profit_cr: Dict[str, float],
    roce_dict: Dict[str, float],
    roe_dict: Dict[str, float],
    net_de_dict: Dict[str, float],
    opm_series: List[Tuple[str, float]],
) -> List[Tuple[str, float]]:
    """
    Merge Screener.in cached annual series into the yfinance-derived series,
    with Screener.in as the primary source for years it covers (see
    _screener_prefer) — yfinance fills in only years Screener has nothing for.
    Mutates revenue_cr/profit_cr/roce_dict/roe_dict/net_de_dict in place.
    Returns the (possibly extended/overridden) opm_series list, since lists
    can't be mutated into a caller's variable the way dicts can.
    """
    try:
        from screener_cache import load_screener_data, parse_period_label
    except Exception:
        return opm_series

    sc = load_screener_data(ticker)
    if not sc:
        return opm_series

    _screener_prefer(revenue_cr, sc.get("sales_cr"))
    _screener_prefer(profit_cr, sc.get("net_profit_cr"))
    _screener_prefer(roce_dict, sc.get("roce_annual"))
    _screener_prefer(roe_dict, sc.get("roe_annual"))
    _screener_fill_gap_years_only(net_de_dict, sc.get("net_de_annual"))

    opm_by_year: Dict[str, Tuple[str, float]] = {d[:4]: (d, v) for d, v in opm_series}
    for label, value in (sc.get("opm_pct") or {}).items():
        d = parse_period_label(label)
        if d is None:
            continue
        opm_by_year[str(d.year)] = (d.isoformat(), value)
    opm_series = sorted(opm_by_year.values(), key=lambda dv: dv[0], reverse=True)

    return opm_series


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

            # ── Annual balance-sheet ratios ────────────────────────────────
            roce_dict:   Dict[str, float] = {}
            roe_dict:    Dict[str, float] = {}
            net_de_dict: Dict[str, float] = {}
            tfa_dict:    Dict[str, float] = {}   # Tangible Fixed Assets = Net PPE - Intangibles

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

                    # Raw yfinance balance-sheet values are in plain Rupees, not
                    # Crores — every other series here (revenue_cr, profit_cr)
                    # divides by 1e7; this one didn't, so tfa_series/tfa_dict were
                    # ~1e7x too large. Only ever consumed as a same-unit ratio
                    # (tfa_vs_ath_pct = latest/peak) so this was harmless in
                    # practice — but wrong/misleading if ever read as an absolute
                    # Cr figure, so fixed for consistency with every other series.
                    ppe        = _col_val(ann_bs, col, _PPE_KEYS)
                    intangible = _col_val(ann_bs, col, _INTANGIBLE_KEYS) or 0.0
                    if ppe is not None:
                        tfa_dict[dt_s] = round((ppe - intangible) / 1e7, 1)

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

            # Snapshot of yfinance's own (pre-merge) figures — kept only for the
            # reconciliation audit (fundamentals_audit.py) to compare against
            # Screener.in's numbers; never used for gates.
            _yf_roce_before = roce_dict[max(roce_dict)] if roce_dict else None
            _yf_roe_before  = roe_dict[max(roe_dict)]   if roe_dict  else None
            _yf_opm_before  = [v for _, v in opm_series[:3]] if opm_series else None

            # ── Screener.in primary — overrides yfinance for any year it covers;
            # yfinance only fills years Screener has nothing for (see
            # _screener_prefer). Screener.in is the more reliable source for
            # these ratios — see module docstring / fundamental_config.py ──
            opm_series = _screener_merge_fundamentals(
                ticker, revenue_cr, profit_cr, roce_dict, roe_dict, net_de_dict, opm_series
            )

            try:
                from screener_cache import load_screener_data
                sc_current = load_screener_data(ticker)
            except Exception:
                sc_current = None

            peak_rev = max(revenue_cr.values()) if revenue_cr else None
            peak_np  = max(profit_cr.values())  if profit_cr  else None

            # ── Current snapshot (most recent annual value) ────────────────
            def _latest(d: dict) -> Optional[float]:
                return d[max(d)] if d else None

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

            _yf_ttm_revenue_before = ttm_revenue_cr
            _yf_ttm_np_before = ttm_np_cr

            # Screener.in TTM override — its own TTM column, when cached, is
            # preferred over the yfinance-quarterly-sum above for the same
            # source-of-truth reason as the annual series merge.
            if sc_current:
                sc_ttm_rev = (sc_current.get("sales_cr") or {}).get("TTM")
                sc_ttm_np  = (sc_current.get("net_profit_cr") or {}).get("TTM")
                if sc_ttm_rev is not None:
                    ttm_revenue_cr = sc_ttm_rev
                if sc_ttm_np is not None:
                    ttm_np_cr = sc_ttm_np

            # Approximate TTM with latest annual figure when quarterly data is
            # insufficient (e.g. <4 quarters reported) — only for the ATH
            # comparison below, never exposed as the real "ttm_*_cr" fields.
            approx_ttm_revenue = ttm_revenue_cr if ttm_revenue_cr is not None else _latest(revenue_cr)
            approx_ttm_np      = ttm_np_cr      if ttm_np_cr      is not None else _latest(profit_cr)

            sales_vs_ath: Optional[float] = None
            if approx_ttm_revenue and peak_rev and peak_rev > 0:
                sales_vs_ath = round(approx_ttm_revenue / peak_rev * 100, 1)

            profit_vs_ath: Optional[float] = None
            if approx_ttm_np and approx_ttm_np > 0 and peak_np and peak_np > 0:
                profit_vs_ath = round(approx_ttm_np / peak_np * 100, 1)

            tfa_latest = _latest(tfa_dict)
            peak_tfa   = max(tfa_dict.values()) if tfa_dict else None
            tfa_vs_ath: Optional[float] = None
            if tfa_latest and tfa_latest > 0 and peak_tfa and peak_tfa > 0:
                tfa_vs_ath = round(tfa_latest / peak_tfa * 100, 1)

            # roce_current/roe_current: Screener's own "current" scalar (its
            # live top-ratios figure) isn't always identical to the latest
            # annual-dict entry (e.g. a mid-year update) — prefer it directly
            # over recomputing from the merged dict when Screener has it.
            sc_roce_latest = sc_current.get("roce_latest") if sc_current else None
            sc_roe_latest  = sc_current.get("roe_latest")  if sc_current else None
            roce_current = sc_roce_latest if sc_roce_latest is not None else _latest(roce_dict)
            roe_current  = sc_roe_latest  if sc_roe_latest  is not None else _latest(roe_dict)
            roce_source = "screener" if sc_roce_latest is not None else ("yfinance" if roce_current is not None else None)
            roe_source  = "screener" if sc_roe_latest  is not None else ("yfinance" if roe_current  is not None else None)
            opm_source  = "screener" if (sc_current and sc_current.get("opm_pct")) else ("yfinance" if opm_series else None)

            return {
                "ticker":      ticker,
                "sector":      sector,
                "industry":    industry,
                "marketcap_cr": marketcap_cr,
                # Current snapshot (for scanners — no date context needed)
                "ttm_revenue_cr":    ttm_revenue_cr,
                "ttm_np_cr":         ttm_np_cr,
                "roce_current":      roce_current,
                "roe_current":       roe_current,
                "net_de_current":    _latest(net_de_dict),
                "opm_3yr":           [v for _, v in opm_series[:3]] if opm_series else None,
                "sales_vs_ath_pct":  sales_vs_ath,
                "profit_vs_ath_pct": profit_vs_ath,
                "tfa_vs_ath_pct":    tfa_vs_ath,
                # Which source each ratio's "current" value came from — surfaced
                # in the UI so a Screener/yfinance mismatch is visible, not hidden.
                "roce_source": roce_source,
                "roe_source":  roe_source,
                "opm_source":  opm_source,
                # Pre-merge yfinance figures, for fundamentals_audit.py only —
                # never used for gates (those use the Screener-primary values above).
                "_yf_roce_current":    _yf_roce_before,
                "_yf_roe_current":     _yf_roe_before,
                "_yf_opm_3yr":         _yf_opm_before,
                "_yf_ttm_revenue_cr":  _yf_ttm_revenue_before,
                "_yf_ttm_np_cr":       _yf_ttm_np_before,
                # Section 4 — Governance — filled from Screener.in cache when available
                "pledged_pct":       _screener_pledged(ticker),
                "public_shareholding_pct": _screener_public_shareholding(ticker),
                # Historical series (for backtests — forward-fill by date)
                "roce_series":       roce_dict,
                "roe_series":        roe_dict,
                "net_de_series":     net_de_dict,
                "tfa_series":        tfa_dict,
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
    errors: Optional[List[str]] = None,
    force: bool = False,
    max_age_days: Optional[int] = None,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> Dict[str, Optional[Dict]]:
    """
    Fetch Phase 2 fundamental metrics for all tickers concurrently.
    Returns {ticker: metrics_dict | None}.
    Uses the stable (non-expiring) file cache via data_cache.get_fundamental_metrics
    when available — fundamentals only change quarterly, so this is normally a
    cache read, not a network call. force/max_age_days are passed straight
    through to get_fundamental_metrics() — see its docstring. Both default to
    "never refetch automatically," matching every existing (scanner) caller;
    only the dedicated "Refresh Fundamentals" pipeline mode sets them.

    progress_callback(done, total), if given, is invoked after each ticker
    completes in the concurrent pass (for a progress bar) — best-effort, never
    allowed to break the fetch itself.

    Tickers that come back None from the concurrent pass are retried once
    more, serially with a short delay — concurrent batches of 100+ requests
    are more prone to transient yfinance rate-limiting than a slow serial
    retry of just the stragglers.
    """
    def _fetch(ticker: str) -> Tuple[str, Optional[Dict]]:
        if use_cache:
            try:
                from data_cache import get_fundamental_metrics
                return (ticker, get_fundamental_metrics(ticker, force=force, max_age_days=max_age_days))
            except ImportError:
                pass
        return (ticker, fetch_fundamental_metrics(ticker))

    tickers = list(tickers)
    total = len(tickers)
    results: Dict[str, Optional[Dict]] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = {pool.submit(_fetch, t): t for t in tickers}
        for done, fut in enumerate(as_completed(futs), 1):
            ticker = futs[fut]
            try:
                _, m = fut.result()
                results[ticker] = m
            except Exception:
                results[ticker] = None
            if progress_callback is not None:
                try:
                    progress_callback(done, total)
                except Exception:
                    pass

    failed = [t for t, m in results.items() if m is None]
    for ticker in failed:
        time.sleep(0.5)
        try:
            _, m = _fetch(ticker)
            if m is not None:
                results[ticker] = m
        except Exception:
            pass

    if errors is not None:
        for ticker in failed:
            if results.get(ticker) is None:
                errors.append(f"{ticker}: fundamentals fetch failed after retry")

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

            # Explicit newest-first sort — do not rely on yfinance's raw column
            # order being chronological (it usually is, but "usually" already
            # bit us elsewhere this session with Screener's date keys; "3yr/5yr
            # avg" must always mean the N *most recent* years, not just the
            # first N columns yfinance happens to return).
            sorted_cols = sorted(eps_row.index, key=lambda c: pd.Timestamp(c), reverse=True)

            pe_vals: List[float] = []
            for col in sorted_cols:
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

            # Sanity cross-check against yfinance's own trailingPE (a reliable,
            # pre-computed ratio). Seen for real on INFY: this function's
            # "Diluted EPS" row read ~0.71-0.80 (vs a real EPS around ~65 — an
            # ~85x scaling error in yfinance's own historical EPS line for that
            # specific ticker, not something fixable on our end), producing a
            # "5yr average PE" of 1657 against a real current PE of 13 — a
            # number that looks like real output but is actually noise. If the
            # most recent computed value is wildly off from the known-good
            # current PE, treat the whole EPS row as untrustworthy for this
            # ticker rather than silently returning a corrupted average.
            trailing_pe = t.info.get("trailingPE")
            if (trailing_pe and isinstance(trailing_pe, (int, float)) and trailing_pe > 0
                    and not (trailing_pe / 5 <= pe_vals[0] <= trailing_pe * 5)):
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


def fetch_stock_pe_cached(ticker: str) -> Optional[float]:
    """Weekly-cached wrapper around fetch_stock_pe. Falls back to the raw
    fetch if data_cache is unavailable."""
    try:
        from data_cache import get_stock_pe
        return get_stock_pe(ticker)
    except ImportError:
        return fetch_stock_pe(ticker)


def fetch_historical_pe_avgs_cached(ticker: str) -> Tuple[Optional[float], Optional[float]]:
    """Weekly-cached wrapper around fetch_historical_pe_avgs. Falls back to
    the raw fetch if data_cache is unavailable."""
    try:
        from data_cache import get_historical_pe_avgs
        return get_historical_pe_avgs(ticker)
    except ImportError:
        return fetch_historical_pe_avgs(ticker)


def fetch_all_pe_parallel(
    tickers: Iterable,
    max_workers: int = 6,
) -> Dict[str, Tuple[Optional[float], Optional[float], Optional[float]]]:
    """Fetch (pe_current, pe_3yr_avg, pe_5yr_avg) for all tickers concurrently.

    Uses the weekly file cache (data_cache.get_stock_pe / get_historical_pe_avgs)
    so same-week reruns skip yfinance's slow .info/.income_stmt calls.
    Returns {ticker: (pe_current, pe_3yr_avg, pe_5yr_avg)}.
    """
    def _fetch(ticker: str):
        pe = fetch_stock_pe_cached(ticker)
        pe3, pe5 = fetch_historical_pe_avgs_cached(ticker)
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


def compute_fall_from_high(df: pd.DataFrame, years: int = 10) -> Tuple[Optional[float], Optional[float]]:
    """
    Return (high_price, fall_pct) — the max close over the trailing `years`
    (or the full frame if it covers less than that) and the latest close's
    % fall from it. Used for the cap-tier drawdown Must-Have gate
    (fundamental_config.check_fall_from_high) — NOT the same as the 52-week
    high already computed separately by each scanner.
    """
    if df is None or df.empty:
        return None, None
    cutoff = df.index.max() - pd.DateOffset(years=years)
    window = df[df.index >= cutoff]
    if window.empty:
        return None, None
    high = float(window["close"].max())
    close = float(df["close"].iloc[-1])
    if high <= 0:
        return high, None
    fall_pct = round((high - close) / high * 100.0, 2) if close < high else 0.0
    return high, fall_pct


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

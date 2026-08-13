"""File-based cache for yfinance downloads.

OHLCV cache key   : {TICKER}_{years}y_{YYYYMMDD}.pkl   — daily expiry
PE series key     : {TICKER}_pe_{YYYY}W{WW}.pkl         — weekly expiry
Current PE key    : {TICKER}_pecur_{YYYY}W{WW}.pkl      — weekly expiry
PE 3/5yr avg key  : {TICKER}_peavgs_{YYYY}W{WW}.pkl      — weekly expiry
Fundamentals key  : {TICKER}_fund.pkl                    — no auto-expiry;
                     only refreshed via get_fundamental_metrics(force=True),
                     triggered by the dedicated "Refresh Fundamentals" pipeline
                     mode (see web/start_dashboard.py --refresh-fundamentals),
                     never by the daily OHLCV/scanner pipeline.

Each ticker writes to its own file so there are no shared-file races.
list.append is GIL-protected in CPython, so errors can be shared safely
across threads.

Usage:
    from data_cache import get_ohlcv, get_pe_series
    df              = get_ohlcv('RELIANCE', years=3, errors=errors)
    pe_d, pe_med    = get_pe_series('RELIANCE')

Cleanup (run manually when disk space matters):
    from data_cache import purge_old_cache
    purge_old_cache(keep_days=2)
"""

import pickle
import time
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd

CACHE_DIR = Path(__file__).parent / '.cache'


def get_ohlcv(
    ticker: str, years: int, errors: Optional[List[str]] = None
) -> Optional[pd.DataFrame]:
    """Return OHLCV DataFrame via the persistent store (ohlcv_store).

    The persistent store only downloads new trading days on each run rather
    than re-fetching the full history every calendar day.  Falls back to the
    original daily file cache if ohlcv_store is unavailable.
    """
    if errors is None:
        errors = []

    try:
        from ohlcv_store import get_ohlcv as _store_get
        return _store_get(ticker, years, errors)
    except ImportError:
        pass

    # ── Fallback: original daily file cache ───────────────────────────────────
    from f40_backtest_common import fetch_historical_data  # deferred — avoids circular import

    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{ticker}_{years}y_{date.today():%Y%m%d}.pkl"

    if cache_file.exists():
        try:
            return pd.read_pickle(cache_file)
        except Exception:
            cache_file.unlink(missing_ok=True)

    df = fetch_historical_data(ticker, years=years, errors=errors)
    if df is not None:
        try:
            df.to_pickle(cache_file)
        except Exception:
            pass
    return df


def get_pe_series(
    ticker: str,
    errors: Optional[List[str]] = None,
) -> Tuple[Optional[pd.Series], Optional[pd.Series]]:
    """
    Weekly-cached wrapper around fetch_historical_pe_series.

    Returns (pe_daily, pe_5yr_median) — both tz-naive DatetimeIndex Series.
    Returns (None, None) when yfinance has no EPS data for this stock.

    Cache TTL is one calendar week (key = YYYY + ISO week number).
    PE series data changes at most quarterly, so weekly refresh is sufficient.
    """
    if errors is None:
        errors = []

    from f40_backtest_common import fetch_historical_pe_series

    CACHE_DIR.mkdir(exist_ok=True)
    today    = date.today()
    iso      = today.isocalendar()
    week_key = f"{iso.year}W{iso.week:02d}"
    cache_file = CACHE_DIR / f"{ticker}_pe_{week_key}.pkl"

    if cache_file.exists():
        try:
            with open(cache_file, "rb") as fh:
                return pickle.load(fh)
        except Exception:
            cache_file.unlink(missing_ok=True)

    result = fetch_historical_pe_series(ticker)

    try:
        with open(cache_file, "wb") as fh:
            pickle.dump(result, fh)
    except Exception:
        pass

    return result


def get_fundamental_metrics(
    ticker: str,
    force: bool = False,
    max_age_days: Optional[int] = None,
) -> Optional[Dict]:
    """
    Stable-cached wrapper around fetch_fundamental_metrics.

    Returns the Phase 2 fundamentals dict (or None when yfinance has no
    statement data).  Cache key: {TICKER}_fund.pkl — no auto-expiry by
    default. Fundamentals (ROCE, ROE, Net D/E, TTM Net Profit, OPM, etc.)
    only change when a company posts quarterly results, not daily or weekly —
    so once fetched, this is cached indefinitely for every normal caller
    (all 4 scanners use the default `max_age_days=None`) and only refreshed
    as a side effect of the daily OHLCV/scanner pipeline never triggers it.

    force=True always bypasses the cache (used by the "Refresh Fundamentals"
    full-refresh mode). max_age_days, when set, treats a cache file older
    than that many days (by file mtime) as stale too — used by the
    "Refresh Fundamentals" *incremental* mode to only re-fetch tickers whose
    data plausibly predates their last quarterly result, without forcing
    every ticker in the universe.

    A cached `None` is never trusted or written: a failed fetch (transient
    yfinance error/rate-limit, not "no data exists") retries on the very next
    call rather than being frozen as a false negative.
    """
    from f40_backtest_common import fetch_fundamental_metrics

    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{ticker}_fund.pkl"

    is_stale_by_age = (
        max_age_days is not None
        and cache_file.exists()
        and (time.time() - cache_file.stat().st_mtime) / 86400 > max_age_days
    )

    if not force and not is_stale_by_age and cache_file.exists():
        try:
            with open(cache_file, "rb") as fh:
                cached = pickle.load(fh)
            if cached is not None:
                return cached
            # Previously cached failure — fall through and retry instead of
            # re-serving the None indefinitely.
        except Exception:
            cache_file.unlink(missing_ok=True)

    result = fetch_fundamental_metrics(ticker)
    if result is not None:
        try:
            with open(cache_file, "wb") as fh:
                pickle.dump(result, fh)
        except Exception:
            pass
    return result


def get_stock_pe(ticker: str) -> Optional[float]:
    """
    Weekly-cached wrapper around fetch_stock_pe (current trailing P/E).

    yfinance's `.info` call is one of its slowest/most rate-limited endpoints —
    caching it means same-week reruns skip it entirely instead of re-hitting it
    for every ticker on every pipeline run.
    Cache key: {TICKER}_pecur_{YYYY}W{WW}.pkl
    """
    from f40_backtest_common import fetch_stock_pe

    CACHE_DIR.mkdir(exist_ok=True)
    today    = date.today()
    iso      = today.isocalendar()
    week_key = f"{iso.year}W{iso.week:02d}"
    cache_file = CACHE_DIR / f"{ticker}_pecur_{week_key}.pkl"

    if cache_file.exists():
        try:
            with open(cache_file, "rb") as fh:
                return pickle.load(fh)
        except Exception:
            cache_file.unlink(missing_ok=True)

    result = fetch_stock_pe(ticker)
    try:
        with open(cache_file, "wb") as fh:
            pickle.dump(result, fh)
    except Exception:
        pass
    return result


def get_historical_pe_avgs(ticker: str) -> Tuple[Optional[float], Optional[float]]:
    """
    Weekly-cached wrapper around fetch_historical_pe_avgs (3yr/5yr average
    trailing PE, derived from annual EPS + a monthly price history call).
    Cache key: {TICKER}_peavgs_{YYYY}W{WW}.pkl
    """
    from f40_backtest_common import fetch_historical_pe_avgs

    CACHE_DIR.mkdir(exist_ok=True)
    today    = date.today()
    iso      = today.isocalendar()
    week_key = f"{iso.year}W{iso.week:02d}"
    cache_file = CACHE_DIR / f"{ticker}_peavgs_{week_key}.pkl"

    if cache_file.exists():
        try:
            with open(cache_file, "rb") as fh:
                return pickle.load(fh)
        except Exception:
            cache_file.unlink(missing_ok=True)

    result = fetch_historical_pe_avgs(ticker)
    try:
        with open(cache_file, "wb") as fh:
            pickle.dump(result, fh)
    except Exception:
        pass
    return result


def purge_old_cache(keep_days: int = 2) -> int:
    """Delete cache files older than keep_days. Returns count of deleted files."""
    if not CACHE_DIR.exists():
        return 0
    today = date.today()
    deleted = 0
    for f in CACHE_DIR.glob("*.pkl"):
        parts = f.stem.rsplit('_', 1)
        if len(parts) == 2:
            try:
                ds = parts[1]
                file_date = date(int(ds[:4]), int(ds[4:6]), int(ds[6:]))
                if (today - file_date).days >= keep_days:
                    f.unlink()
                    deleted += 1
            except (ValueError, IndexError):
                pass
    return deleted

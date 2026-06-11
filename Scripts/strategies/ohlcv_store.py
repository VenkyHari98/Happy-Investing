"""Persistent per-ticker OHLCV store with incremental daily updates.

Instead of re-downloading years of history on every new calendar day, each
ticker gets one .pkl file that grows by ~1 row per trading day.

Bootstrap (first call per ticker):
  1. Check daily cache for an existing 10y download from today/yesterday
  2. If found, seed the store from it (avoids a full re-download)
  3. Otherwise, download full FULL_HISTORY_YEARS via yfinance

Subsequent calls (same or later day):
  - If store is up to date: return immediately (zero network calls)
  - If store is stale: fetch only the missing days via yfinance start= param,
    append, dedup, sort, save

The DataFrame stored and returned always has:
  - Index: DatetimeIndex, tz-naive, name="Date"
  - Columns: open, high, low, close, volume  (lowercase float/int)
"""

from datetime import date, timedelta
from pathlib import Path
from typing import List, Optional

import pandas as pd

STORE_DIR        = Path(__file__).parent / '.store'
FULL_HISTORY_YEARS = 10


# ── Public API ─────────────────────────────────────────────────────────────────

def get_ohlcv(
    ticker: str,
    years: int,
    errors: Optional[List[str]] = None,
) -> Optional[pd.DataFrame]:
    """Return OHLCV DataFrame for ticker from the persistent store.

    On the first call the store is bootstrapped (10y download or seeded from
    the daily .cache/).  On subsequent calls only missing trading days are
    fetched.  The `years` parameter slices the tail of the returned data; the
    store itself always retains full history.
    """
    if errors is None:
        errors = []

    STORE_DIR.mkdir(exist_ok=True)
    store_file = STORE_DIR / f'{ticker}.pkl'

    df = None
    if store_file.exists():
        try:
            df = pd.read_pickle(store_file)
            df = _maybe_update(ticker, df, store_file)
        except Exception as exc:
            errors.append(f'{ticker}: store read/update error — {exc}')
            df = None

    if df is None or df.empty:
        df = _bootstrap(ticker, store_file, errors)

    if df is None or df.empty:
        return None

    # Slice to the caller's requested window
    if years < FULL_HISTORY_YEARS:
        cutoff = pd.Timestamp.today().normalize() - pd.DateOffset(years=years)
        df = df[df.index >= cutoff]

    return df if not df.empty else None


# ── Internal helpers ───────────────────────────────────────────────────────────

def _normalise_index(df: pd.DataFrame) -> pd.DataFrame:
    """Strip timezone from index so comparisons with date.today() are simple."""
    if df.index.tz is not None:
        df = df.copy()
        df.index = df.index.tz_localize(None)
    return df


def _maybe_update(ticker: str, df: pd.DataFrame, store_file: Path) -> pd.DataFrame:
    """Append any trading days newer than the store's last row."""
    df = _normalise_index(df)
    last_date = df.index[-1].date()
    today = date.today()

    if last_date >= today:
        return df  # already current

    # Skip delta fetch on weekends — NSE/BSE are closed, no new rows will appear.
    # Monday runs still proceed normally (last_date=Friday, today=Monday).
    if today.weekday() >= 5:  # 5=Saturday, 6=Sunday
        return df

    delta_start = last_date + timedelta(days=1)
    delta = _fetch_delta(ticker, delta_start)

    if delta is not None and not delta.empty:
        df = pd.concat([df, delta])
        df = df[~df.index.duplicated(keep='last')]
        df.sort_index(inplace=True)
        df.to_pickle(store_file)

    return df


def _bootstrap(ticker: str, store_file: Path, errors: List[str]) -> Optional[pd.DataFrame]:
    """Seed the store for a ticker that has no persistent file yet.

    Tries the daily .cache/ first (avoids a network call when yesterday's
    download already exists), then falls back to a fresh yfinance fetch.
    """
    df = _load_from_daily_cache(ticker)

    if df is None:
        from f40_backtest_common import fetch_historical_data
        df = fetch_historical_data(ticker, years=FULL_HISTORY_YEARS, errors=errors)

    if df is None or df.empty:
        return None

    df = _normalise_index(df)
    df.to_pickle(store_file)

    # Try to fetch today's row if the seeded data is already stale
    df = _maybe_update(ticker, df, store_file)
    return df


def _load_from_daily_cache(ticker: str) -> Optional[pd.DataFrame]:
    """Return a 10y DataFrame from the daily .cache/ if one exists from today or yesterday."""
    cache_dir = Path(__file__).parent / '.cache'
    if not cache_dir.exists():
        return None

    for delta_days in (0, 1):
        candidate_date = date.today() - timedelta(days=delta_days)
        cache_file = cache_dir / f'{ticker}_10y_{candidate_date:%Y%m%d}.pkl'
        if cache_file.exists():
            try:
                df = pd.read_pickle(cache_file)
                if df is not None and not df.empty:
                    df.index.name = 'Date'
                    df.columns = [c.lower() for c in df.columns]
                    available = [c for c in ('open', 'high', 'low', 'close', 'volume') if c in df.columns]
                    df = df[available].dropna(subset=['close'])
                    return df
            except Exception:
                continue

    return None


def _fetch_delta(ticker: str, start: date) -> pd.DataFrame:
    """Fetch OHLCV rows from `start` to today using a date-range yfinance call.

    Returns an empty DataFrame (not None) when no new trading days exist —
    this is normal for weekends and public holidays.
    """
    import yfinance as yf

    start_str = start.strftime('%Y-%m-%d')

    # Numeric tickers (e.g. 544467, 543971) are BSE-only — skip the failed .NS lookup
    symbols = [f'{ticker}.BO'] if ticker.isdigit() else [f'{ticker}.NS', f'{ticker}.BO']
    for symbol in symbols:
        try:
            t = yf.Ticker(symbol)
            df = t.history(start=start_str, interval='1d', auto_adjust=True)
            if df is None or df.empty:
                continue
            df.index.name = 'Date'
            df.columns = [c.lower() for c in df.columns]
            df = df[['open', 'high', 'low', 'close', 'volume']].copy()
            df = df.dropna(subset=['close'])
            if df.index.tz is not None:
                df.index = df.index.tz_localize(None)
            return df
        except Exception:
            continue

    return pd.DataFrame()

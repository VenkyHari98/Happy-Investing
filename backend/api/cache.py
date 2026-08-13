"""In-process TTL cache for the Happy Investing API.

Thread-safe: uses threading.Lock per operation.
No external dependencies — pure Python stdlib only.

Usage:
    from .cache import cache, TTL_SCANNER, KEY_SCANNER_F40
    hit = cache.get(KEY_SCANNER_F40)
    if hit is not None:
        return hit
    data = ...load from disk...
    cache.set(KEY_SCANNER_F40, data, TTL_SCANNER)
    return data
"""

import threading
from datetime import datetime, timedelta
from typing import Any, Optional

# ── TTL constants (seconds) ───────────────────────────────────────────────────
TTL_SCANNER   = 24 * 60 * 60       # 24h — scanner data changes once a day
TTL_BACKTEST  =  7 * 24 * 60 * 60  # 7d  — backtest results rarely change
TTL_PORTFOLIO =  7 * 24 * 60 * 60  # 7d  — portfolio files rarely change
TTL_OHLCV     =  1 * 60 * 60       # 1h  — intraday prices

# ── Cache key constants ───────────────────────────────────────────────────────
KEY_SCANNER_F40          = "scanner-f40"
KEY_SCANNER_F40_SUMMARY  = "scanner-f40-summary"
KEY_SCANNER_S200         = "scanner-s200"
KEY_SCANNER_S200_STOCKS  = "scanner-s200-stocks"

KEY_BACKTEST_52W         = "backtest-52w-{years}y"
KEY_BACKTEST_52W_STOCKS  = "backtest-52w-stocks-{years}y"
KEY_BACKTEST_52W_TRADES  = "backtest-52w-trades-{years}y"

KEY_BACKTEST_ENV         = "backtest-env-{years}y"
KEY_BACKTEST_ENV_STOCKS  = "backtest-env-stocks-{years}y"
KEY_BACKTEST_ENV_TRADES  = "backtest-env-trades-{years}y"

KEY_BACKTEST_S200        = "backtest-s200-{years}y"
KEY_BACKTEST_S200_STOCKS = "backtest-s200-stocks-{years}y"

KEY_PORTFOLIO_F40        = "portfolio-f40-{variant}-{years}y"
KEY_PORTFOLIO_S200       = "portfolio-s200-{years}y"

KEY_RHS_SUMMARY          = "rhs-summary"
KEY_RHS_STOCKS           = "rhs-stocks"
KEY_RHS_STOCKS_RAW       = "rhs-stocks-raw"
KEY_RHS_SCANNER          = "rhs-scanner"

KEY_SR_SCANNER           = "sr-scanner"


class TTLCache:
    """Thread-safe in-memory TTL cache backed by a plain Python dict."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, datetime]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if datetime.utcnow() < expires_at:
                return value
            del self._store[key]
            return None

    def set(self, key: str, value: Any, ttl: int) -> None:
        with self._lock:
            self._store[key] = (value, datetime.utcnow() + timedelta(seconds=ttl))

    def invalidate(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def invalidate_prefix(self, prefix: str) -> None:
        with self._lock:
            for k in [k for k in self._store if k.startswith(prefix)]:
                del self._store[k]

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def stats(self) -> dict:
        with self._lock:
            now = datetime.utcnow()
            alive = {k: exp for k, (_, exp) in self._store.items() if now < exp}
            return {
                "alive_keys": len(alive),
                "keys": [
                    {"key": k, "expires_in_s": int((exp - now).total_seconds())}
                    for k, exp in sorted(alive.items())
                ],
            }


# Module-level singleton — import this everywhere
cache = TTLCache()

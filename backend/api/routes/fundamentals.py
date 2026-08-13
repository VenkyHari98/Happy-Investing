"""Fundamentals routes — PE series, fundamental metrics, and config."""
import math
import sys
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException
from ..paths import SCRIPTS

if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

router = APIRouter()


# ── PE Series ─────────────────────────────────────────────────────────────────

@router.get("/pe/{ticker}")
def get_pe(ticker: str, years: int = 5):
    """Return daily PE ratio series + 5yr rolling median for a ticker.

    Response:
      { ticker, pe_series: [{date, pe}], median_5y: float|null, current_pe: float|null }
    """
    if years not in (1, 2, 3, 5, 10):
        raise HTTPException(400, "years must be one of 1, 2, 3, 5, 10")

    try:
        from data_cache import get_pe_series  # type: ignore[import]
    except ImportError as exc:
        raise HTTPException(500, f"Cannot import data_cache: {exc}")

    try:
        errors: list[str] = []
        pe_daily, pe_5yr_median = get_pe_series(ticker, errors=errors)
    except Exception as exc:
        raise HTTPException(500, str(exc))

    if pe_daily is None or pe_daily.empty:
        # Not an error — just no PE data (e.g., bank without EPS reporting)
        return {"ticker": ticker, "pe_series": [], "median_5y": None, "current_pe": None}

    # Filter to requested horizon
    cutoff = datetime.now() - timedelta(days=years * 365)
    pe_daily = pe_daily[pe_daily.index >= cutoff]

    def _clean(v) -> Optional[float]:
        if v is None:
            return None
        try:
            f = float(v)
            return None if (math.isnan(f) or math.isinf(f)) else round(f, 2)
        except (TypeError, ValueError):
            return None

    pe_series = []
    for date, val in pe_daily.items():
        cleaned = _clean(val)
        if cleaned is not None:
            pe_series.append({"date": date.strftime("%Y-%m-%d"), "pe": cleaned})

    # current_pe: last non-NaN value
    current_pe: Optional[float] = None
    for item in reversed(pe_series):
        current_pe = item["pe"]
        break

    # median_5y: last value of rolling 5yr median series
    median_5y: Optional[float] = None
    if pe_5yr_median is not None and not pe_5yr_median.empty:
        last_val = pe_5yr_median.dropna()
        if not last_val.empty:
            median_5y = _clean(last_val.iloc[-1])

    return {
        "ticker": ticker,
        "pe_series": pe_series,
        "median_5y": median_5y,
        "current_pe": current_pe,
    }


# ── Fundamental Metrics ───────────────────────────────────────────────────────

@router.get("/metrics/{ticker}")
def get_metrics(ticker: str):
    """Return fundamental metrics for a ticker.

    Response:
      { ticker, roce, roe, de_ratio, opm, revenue_growth, profit_growth,
        is_financial_sector, pledged_pct }
    All numeric fields are float|null.
    """
    try:
        from data_cache import get_fundamental_metrics  # type: ignore[import]
    except ImportError as exc:
        raise HTTPException(500, f"Cannot import data_cache: {exc}")

    try:
        raw = get_fundamental_metrics(ticker)
    except Exception as exc:
        raise HTTPException(500, str(exc))

    def _safe(v) -> Optional[float]:
        if v is None:
            return None
        try:
            f = float(v)
            return None if (math.isnan(f) or math.isinf(f)) else round(f, 2)
        except (TypeError, ValueError):
            return None

    if raw is None:
        return {
            "ticker": ticker,
            "roce": None, "roe": None, "de_ratio": None, "opm": None,
            "revenue_growth": None, "profit_growth": None,
            "is_financial_sector": False, "pledged_pct": None,
        }

    # raw is the dict returned by fetch_fundamental_metrics() — see
    # Scripts/strategies/f40_backtest_common.py for the authoritative key names.
    def _get(*keys):
        for k in keys:
            v = raw.get(k) if isinstance(raw, dict) else getattr(raw, k, None)
            if v is not None:
                return _safe(v)
        return None

    opm_3yr = raw.get("opm_3yr") if isinstance(raw, dict) else getattr(raw, "opm_3yr", None)
    opm_latest = _safe(opm_3yr[0]) if opm_3yr else None

    try:
        import fundamental_config as cfg  # type: ignore[import]
        sector_str = f"{raw.get('sector', '')} {raw.get('industry', '')}".lower()
        is_financial_sector = any(s.lower() in sector_str for s in cfg.FINANCIAL_SECTORS)
    except ImportError:
        is_financial_sector = False

    return {
        "ticker": ticker,
        "roce":            _get("roce_current"),
        "roe":              _get("roe_current"),
        "de_ratio":        _get("net_de_current"),
        "opm":             opm_latest,
        # Not computed anywhere yet — revenue/profit CAGR is a Phase 2 metric.
        "revenue_growth":  None,
        "profit_growth":   None,
        "is_financial_sector": is_financial_sector,
        "pledged_pct":     _get("pledged_pct"),
    }


# ── Config ────────────────────────────────────────────────────────────────────

@router.get("/config")
def get_config():
    """Return fundamental filter thresholds from fundamental_config.py."""
    try:
        import fundamental_config as cfg  # type: ignore[import]
    except ImportError as exc:
        raise HTTPException(500, f"Cannot import fundamental_config: {exc}")

    # Collect all uppercase/public attributes that are simple scalars
    result: dict = {}
    for key in dir(cfg):
        if key.startswith("_"):
            continue
        val = getattr(cfg, key)
        if isinstance(val, (int, float, str, bool, list)):
            result[key] = val

    return result

"""OHLCV route — serve live price data for stock charts."""
import math
import sys
from fastapi import APIRouter, HTTPException
from ..paths import SCRIPTS

# Add strategies directory so data_cache / ohlcv_store are importable
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

router = APIRouter()


@router.get("/{ticker}")
def get_stock_ohlcv(ticker: str, years: int = 10):
    """Return daily OHLCV + 200-SMA for a ticker.

    Response: list of { date, close, ma200 } dicts, newest data last.
    ma200 is null for the first 199 bars before the SMA warms up.
    """
    if years not in (1, 2, 3, 5, 10):
        raise HTTPException(status_code=400, detail="years must be one of 1, 2, 3, 5, 10")
    try:
        from data_cache import get_ohlcv as _get_ohlcv  # type: ignore[import]
        errors: list[str] = []
        df = _get_ohlcv(ticker, years=years, errors=errors)
        if df is None or df.empty:
            detail = f"No OHLCV data for {ticker}"
            if errors:
                detail += f": {errors[0]}"
            raise HTTPException(status_code=404, detail=detail)

        df["ma200"] = df["close"].rolling(200, min_periods=200).mean()

        result = []
        for date, row in df.iterrows():
            ma = row["ma200"]
            ma_val = None if (isinstance(ma, float) and math.isnan(ma)) else round(float(ma), 2)
            result.append({
                "date": date.strftime("%Y-%m-%d"),
                "close": round(float(row["close"]), 2),
                "ma200": ma_val,
            })
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

"""RHS/CWH pattern backtest + scanner routes."""
import json
from fastapi import APIRouter, HTTPException
from ..paths import DOWNLOADS
from ..cache import (
    cache, TTL_SCANNER,
    KEY_RHS_SUMMARY, KEY_RHS_STOCKS, KEY_RHS_STOCKS_RAW, KEY_RHS_SCANNER,
)

router = APIRouter()


def _load_json(path):
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Data not found: {path.name}. Run the RHS/CWH backtest first.")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


_DIR = DOWNLOADS / "rhs_cwh_backtest"


@router.get("/summary")
def rhs_summary():
    hit = cache.get(KEY_RHS_SUMMARY)
    if hit is not None:
        return hit
    data = _load_json(_DIR / "backtest_summary.json")
    cache.set(KEY_RHS_SUMMARY, data, TTL_SCANNER)
    return data


@router.get("/stocks")
def rhs_stocks():
    hit = cache.get(KEY_RHS_STOCKS)
    if hit is not None:
        return hit
    raw = cache.get(KEY_RHS_STOCKS_RAW)
    if raw is None:
        raw = _load_json(_DIR / "stock_data.json")
        cache.set(KEY_RHS_STOCKS_RAW, raw, TTL_SCANNER)
    overview = raw.get("overview", [])
    cache.set(KEY_RHS_STOCKS, overview, TTL_SCANNER)
    return overview


@router.get("/stock/{ticker}")
def rhs_stock_detail(ticker: str):
    # Reuse cached full dict to avoid re-reading disk
    raw = cache.get(KEY_RHS_STOCKS_RAW)
    if raw is None:
        raw = _load_json(_DIR / "stock_data.json")
        cache.set(KEY_RHS_STOCKS_RAW, raw, TTL_SCANNER)
    stock_data = raw.get("stock_data", {})
    if ticker not in stock_data:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in RHS/CWH backtest data")
    return stock_data[ticker]


@router.get("/scanner")
def rhs_scanner():
    hit = cache.get(KEY_RHS_SCANNER)
    if hit is not None:
        return hit
    data = _load_json(_DIR / "scanner_results.json")
    cache.set(KEY_RHS_SCANNER, data, TTL_SCANNER)
    return data

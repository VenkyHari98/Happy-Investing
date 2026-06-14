"""RHS/CWH pattern backtest + scanner routes."""
import json
from fastapi import APIRouter, HTTPException
from ..paths import DOWNLOADS

router = APIRouter()


def _load_json(path):
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Data not found: {path.name}. Run the RHS/CWH backtest first.")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


_DIR = DOWNLOADS / "rhs_cwh_backtest"


@router.get("/summary")
def rhs_summary():
    return _load_json(_DIR / "backtest_summary.json")


@router.get("/stocks")
def rhs_stocks():
    data = _load_json(_DIR / "stock_data.json")
    return data.get("overview", [])


@router.get("/stock/{ticker}")
def rhs_stock_detail(ticker: str):
    data = _load_json(_DIR / "stock_data.json")
    stock_data = data.get("stock_data", {})
    if ticker not in stock_data:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in RHS/CWH backtest data")
    return stock_data[ticker]


@router.get("/scanner")
def rhs_scanner():
    return _load_json(_DIR / "scanner_results.json")

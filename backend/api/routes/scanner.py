"""Scanner routes — serve pre-generated scanner JSON outputs."""
import json
from fastapi import APIRouter, HTTPException
from ..paths import DOWNLOADS, latest_dated_dir

router = APIRouter()


def _load_json(path):
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Data not found: {path.name}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@router.get("/f40")
def f40_scanner():
    """Latest F40 opportunity scanner results (current_setup.json)."""
    base = DOWNLOADS / "current_setup"
    latest = latest_dated_dir(base)
    if latest is None:
        raise HTTPException(status_code=404, detail="No F40 scanner data found. Run pipeline first.")
    return _load_json(latest / "current_setup.json")


@router.get("/f40/summary")
def f40_scanner_summary():
    """Latest F40 scanner summary (run_date, candidate_count, signal_counts, etc.)."""
    base = DOWNLOADS / "current_setup"
    latest = latest_dated_dir(base)
    if latest is None:
        raise HTTPException(status_code=404, detail="No F40 scanner data found. Run pipeline first.")
    return _load_json(latest / "current_setup_summary.json")


@router.get("/s200")
def s200_scanner():
    """Latest S200 20% rally scanner results."""
    base = DOWNLOADS / "s200_20pct_rally"
    latest = latest_dated_dir(base)
    if latest is None:
        raise HTTPException(status_code=404, detail="No S200 scanner data found. Run pipeline first.")
    return _load_json(latest / "s200_20pct_rallies.json")


@router.get("/s200/stocks")
def s200_stock_data():
    """Latest S200 per-stock detail data."""
    base = DOWNLOADS / "s200_20pct_rally"
    latest = latest_dated_dir(base)
    if latest is None:
        raise HTTPException(status_code=404, detail="No S200 scanner data found. Run pipeline first.")
    return _load_json(latest / "s200_stock_data.json")

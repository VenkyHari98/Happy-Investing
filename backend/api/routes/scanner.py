"""Scanner routes — serve pre-generated scanner JSON outputs."""
import json
from fastapi import APIRouter, HTTPException
from ..paths import DOWNLOADS, latest_dated_dir
from ..cache import (
    cache, TTL_SCANNER,
    KEY_SCANNER_F40, KEY_SCANNER_F40_SUMMARY, KEY_SCANNER_S200, KEY_SCANNER_S200_STOCKS,
)

router = APIRouter()


def _load_json(path):
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Data not found: {path.name}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _load_dated(base, filename, not_found_msg):
    latest = latest_dated_dir(base)
    if latest is None:
        raise HTTPException(status_code=404, detail=not_found_msg)
    return _load_json(latest / filename)


@router.get("/f40")
def f40_scanner():
    """Latest F40 opportunity scanner results (current_setup.json)."""
    hit = cache.get(KEY_SCANNER_F40)
    if hit is not None:
        return hit
    data = _load_dated(DOWNLOADS / "current_setup", "current_setup.json",
                       "No F40 scanner data found. Run pipeline first.")
    cache.set(KEY_SCANNER_F40, data, TTL_SCANNER)
    return data


@router.get("/f40/summary")
def f40_scanner_summary():
    """Latest F40 scanner summary (run_date, candidate_count, signal_counts, etc.)."""
    hit = cache.get(KEY_SCANNER_F40_SUMMARY)
    if hit is not None:
        return hit
    data = _load_dated(DOWNLOADS / "current_setup", "current_setup_summary.json",
                       "No F40 scanner data found. Run pipeline first.")
    cache.set(KEY_SCANNER_F40_SUMMARY, data, TTL_SCANNER)
    return data


@router.get("/s200")
def s200_scanner():
    """Latest S200 20% rally scanner results."""
    hit = cache.get(KEY_SCANNER_S200)
    if hit is not None:
        return hit
    data = _load_dated(DOWNLOADS / "s200_20pct_rally", "s200_20pct_rallies.json",
                       "No S200 scanner data found. Run pipeline first.")
    cache.set(KEY_SCANNER_S200, data, TTL_SCANNER)
    return data


@router.get("/s200/stocks")
def s200_stock_data():
    """Latest S200 per-stock detail data."""
    hit = cache.get(KEY_SCANNER_S200_STOCKS)
    if hit is not None:
        return hit
    data = _load_dated(DOWNLOADS / "s200_20pct_rally", "s200_stock_data.json",
                       "No S200 scanner data found. Run pipeline first.")
    cache.set(KEY_SCANNER_S200_STOCKS, data, TTL_SCANNER)
    return data

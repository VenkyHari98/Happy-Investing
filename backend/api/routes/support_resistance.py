"""Support & Resistance scanner route — serves pre-generated scanner JSON output."""
import json
from fastapi import APIRouter, HTTPException
from ..paths import DOWNLOADS, latest_dated_dir
from ..cache import cache, TTL_SCANNER, KEY_SR_SCANNER

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


@router.get("/scanner")
def sr_scanner():
    """Latest Support & Resistance scanner results."""
    hit = cache.get(KEY_SR_SCANNER)
    if hit is not None:
        return hit
    data = _load_dated(DOWNLOADS / "support_resistance", "support_resistance.json",
                       "No Support & Resistance scanner data found. Run pipeline first.")
    cache.set(KEY_SR_SCANNER, data, TTL_SCANNER)
    return data

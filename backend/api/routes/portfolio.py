"""Portfolio backtest routes — serve pre-generated portfolio simulation JSON outputs."""
import json
from typing import Literal
from fastapi import APIRouter, HTTPException
from ..paths import DOWNLOADS
from ..cache import cache, TTL_PORTFOLIO, KEY_PORTFOLIO_F40, KEY_PORTFOLIO_S200

router = APIRouter()

Years = Literal["5", "10"]

# Map query param values to filename suffixes
F40_VARIANTS = {
    "fixed":                   "fixed",
    "rolling":                 "rolling",
    "fixed_env-long":          "fixed_env-long",
    "fixed_rally-f40":         "fixed_rally-f40",
    "fixed_rally-s200":        "fixed_rally-s200",
    "fixed_env-long_rally-f40": "fixed_env-long_rally-f40",
}


def _load_json(path):
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Data not found: {path.name}. Run pipeline first.")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@router.get("/f40")
def portfolio_f40(
    variant: Literal[
        "fixed",
        "rolling",
        "fixed_env-long",
        "fixed_rally-f40",
        "fixed_rally-s200",
        "fixed_env-long_rally-f40",
    ] = "fixed",
    years: Years = "10",
):
    """F40 portfolio backtest. variant controls the strategy combination."""
    key = KEY_PORTFOLIO_F40.format(variant=variant, years=years)
    hit = cache.get(key)
    if hit is not None:
        return hit
    suffix = F40_VARIANTS[variant]
    data = _load_json(DOWNLOADS / f"f40_portfolio_backtest_{suffix}_{years}y.json")
    cache.set(key, data, TTL_PORTFOLIO)
    return data


@router.get("/f40/variants")
def portfolio_f40_variants():
    """List all available F40 portfolio variant names."""
    return {"variants": list(F40_VARIANTS.keys())}


@router.get("/s200")
def portfolio_s200(years: Years = "10"):
    """S200 portfolio backtest."""
    key = KEY_PORTFOLIO_S200.format(years=years)
    hit = cache.get(key)
    if hit is not None:
        return hit
    data = _load_json(DOWNLOADS / f"s200_portfolio_backtest_{years}y.json")
    cache.set(key, data, TTL_PORTFOLIO)
    return data

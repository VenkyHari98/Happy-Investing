"""Happy Investing — FastAPI backend.

Run with:
    cd backend
    uvicorn api.main:app --reload --port 8000

Dashboard (existing) still runs on :8080 via:
    python web/start_dashboard.py
"""
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .routes import scanner, backtest, portfolio, pipeline, ohlcv, grid_search, fundamentals, rhs_cwh, support_resistance
from .cache import (
    cache,
    TTL_SCANNER, TTL_BACKTEST,
    KEY_SCANNER_F40, KEY_SCANNER_F40_SUMMARY, KEY_SCANNER_S200,
    KEY_BACKTEST_52W, KEY_BACKTEST_ENV, KEY_BACKTEST_S200,
)
from .paths import DOWNLOADS, latest_dated_dir

logger = logging.getLogger("happy_investing.startup")


def _safe_json(path):
    try:
        if not path.exists():
            return None
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning("Startup preload failed %s: %s", path, e)
        return None


@asynccontextmanager
async def lifespan(app):
    for name, base, file, key, ttl in [
        ("scanner-f40",         DOWNLOADS / "current_setup",    "current_setup.json",         KEY_SCANNER_F40,         TTL_SCANNER),
        ("scanner-f40-summary", DOWNLOADS / "current_setup",    "current_setup_summary.json", KEY_SCANNER_F40_SUMMARY, TTL_SCANNER),
        ("scanner-s200",        DOWNLOADS / "s200_20pct_rally", "s200_20pct_rallies.json",    KEY_SCANNER_S200,        TTL_SCANNER),
    ]:
        d = latest_dated_dir(base)
        if d and (data := _safe_json(d / file)):
            cache.set(key, data, ttl)
            logger.info("Preloaded %s", name)

    for years in ("5", "10"):
        for label, path, key_tpl in [
            ("52w", DOWNLOADS / f"backtest_52w_{years}y" / "backtest_summary.json",                   KEY_BACKTEST_52W),
            ("env", DOWNLOADS / f"backtest_envelope_long_{years}y" / "backtest_summary.json",         KEY_BACKTEST_ENV),
            ("s200", DOWNLOADS / f"s200_rally_backtest_{years}y" / "s200_backtest_summary.json",      KEY_BACKTEST_S200),
        ]:
            if data := _safe_json(path):
                cache.set(key_tpl.format(years=years), data, TTL_BACKTEST)
                logger.info("Preloaded backtest-%s-%sy summary", label, years)

    logger.info("Startup preload complete: %s", cache.stats())
    yield
    cache.clear()


app = FastAPI(
    title="Happy Investing API",
    description="REST API wrapping the Happy Investing strategy engine.",
    version="0.1.0",
    lifespan=lifespan,
)

# GZip MUST be registered before CORS
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scanner.router,   prefix="/api/scanner",   tags=["Scanner"])
app.include_router(backtest.router,  prefix="/api/backtest",  tags=["Backtest"])
app.include_router(portfolio.router, prefix="/api/portfolio", tags=["Portfolio"])
app.include_router(pipeline.router,  prefix="/api/pipeline",  tags=["Pipeline"])
app.include_router(ohlcv.router,       prefix="/api/ohlcv",        tags=["OHLCV"])
app.include_router(grid_search.router,   prefix="/api/grid-search",   tags=["GridSearch"])
app.include_router(fundamentals.router,  prefix="/api/fundamentals",  tags=["Fundamentals"])
app.include_router(rhs_cwh.router,       prefix="/api/rhs",           tags=["RHS/CWH"])
app.include_router(support_resistance.router, prefix="/api/sr",       tags=["Support & Resistance"])


@app.get("/", include_in_schema=False)
def root():
    return {"status": "ok", "docs": "/docs"}


@app.get("/api/cache/stats", tags=["Admin"])
def cache_stats():
    return cache.stats()

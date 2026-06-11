"""Happy Investing — FastAPI backend.

Run with:
    cd backend
    uvicorn api.main:app --reload --port 8000

Dashboard (existing) still runs on :8080 via:
    python web/start_dashboard.py
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import scanner, backtest, portfolio, pipeline, ohlcv

app = FastAPI(
    title="Happy Investing API",
    description="REST API wrapping the Happy Investing strategy engine.",
    version="0.1.0",
)

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
app.include_router(ohlcv.router,     prefix="/api/ohlcv",     tags=["OHLCV"])


@app.get("/", include_in_schema=False)
def root():
    return {"status": "ok", "docs": "/docs"}

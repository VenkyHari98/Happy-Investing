"""Backtest routes — serve pre-generated per-stock backtest JSON outputs."""
import datetime
import json
import subprocess
import sys
import threading
from typing import Literal
from fastapi import APIRouter, HTTPException
from ..paths import ROOT, DOWNLOADS, SCRIPTS, WATCHLISTS

router = APIRouter()

Years = Literal["5", "10"]

# ── Envelope on-demand run state ──────────────────────────────────────────────

_env_run_state: dict = {
    "running": False,
    "started_at": "",
    "completed_at": "",
    "error": "",
    "params": {},
}
_env_lock = threading.Lock()


def _run_envelope_bg(envelope_pct: float, entry_band_pct: float, years: int):
    with _env_lock:
        _env_run_state["running"] = True
        _env_run_state["started_at"] = datetime.datetime.now().isoformat(timespec="seconds")
        _env_run_state["error"] = ""

    output_dir = str(DOWNLOADS / f"backtest_envelope_long_{years}y")
    cmd = [
        sys.executable,
        str(SCRIPTS / "f40_backtest_envelope.py"),
        "--watchlist", str(WATCHLISTS / "F40.txt"),
        "--output", output_dir,
        "--years", str(years),
        "--envelope-pct", str(envelope_pct),
        "--entry-band-pct", str(entry_band_pct),
        "--direction", "long",
    ]
    try:
        result = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, timeout=1800)
        if result.returncode != 0:
            raise RuntimeError(result.stderr or result.stdout or "Backtest exited non-zero")
        with _env_lock:
            _env_run_state["completed_at"] = datetime.datetime.now().isoformat(timespec="seconds")
            _env_run_state["error"] = ""
    except Exception as exc:
        with _env_lock:
            _env_run_state["error"] = str(exc)
    finally:
        with _env_lock:
            _env_run_state["running"] = False


def _load_json(path):
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Data not found: {path.name}. Run pipeline first.")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@router.get("/52w/summary")
def backtest_52w_summary(years: Years = "10"):
    return _load_json(DOWNLOADS / f"backtest_52w_{years}y" / "backtest_summary.json")


@router.get("/52w/trades")
def backtest_52w_trades(years: Years = "10"):
    return _load_json(DOWNLOADS / f"backtest_52w_{years}y" / "trades.json")


@router.get("/52w/stocks")
def backtest_52w_stocks(years: Years = "10"):
    return _load_json(DOWNLOADS / f"backtest_52w_{years}y" / "stock_data.json")


@router.get("/envelope/summary")
def backtest_envelope_summary(years: Years = "10"):
    return _load_json(DOWNLOADS / f"backtest_envelope_long_{years}y" / "backtest_summary.json")


@router.get("/envelope/trades")
def backtest_envelope_trades(years: Years = "10"):
    return _load_json(DOWNLOADS / f"backtest_envelope_long_{years}y" / "trades.json")


@router.get("/envelope/stocks")
def backtest_envelope_stocks(years: Years = "10"):
    return _load_json(DOWNLOADS / f"backtest_envelope_long_{years}y" / "stock_data.json")


@router.get("/envelope/run_status")
def envelope_run_status():
    with _env_lock:
        return dict(_env_run_state)


@router.post("/envelope/run")
def envelope_run(
    envelope_pct: float = 14.0,
    entry_band_pct: float = 2.0,
    years: int = 10,
):
    if years not in (5, 10):
        raise HTTPException(status_code=400, detail="years must be 5 or 10")
    if not (1.0 <= envelope_pct <= 30.0):
        raise HTTPException(status_code=400, detail="envelope_pct must be between 1 and 30")
    if not (0.5 <= entry_band_pct <= 10.0):
        raise HTTPException(status_code=400, detail="entry_band_pct must be between 0.5 and 10")

    with _env_lock:
        if _env_run_state["running"]:
            raise HTTPException(status_code=409, detail="Envelope backtest is already running.")
        _env_run_state["params"] = {
            "envelope_pct": envelope_pct,
            "entry_band_pct": entry_band_pct,
            "years": years,
        }

    t = threading.Thread(
        target=_run_envelope_bg,
        args=(envelope_pct, entry_band_pct, years),
        daemon=True,
    )
    t.start()
    return {"status": "started", "message": "Envelope backtest running in background."}


@router.get("/s200/summary")
def backtest_s200_summary(years: Years = "10"):
    return _load_json(DOWNLOADS / f"s200_rally_backtest_{years}y" / "s200_backtest_summary.json")


@router.get("/s200/stocks")
def backtest_s200_stocks(years: Years = "10"):
    return _load_json(DOWNLOADS / f"s200_rally_backtest_{years}y" / "s200_backtest_stock_data.json")


@router.get("/s200/stock/{ticker}")
def backtest_s200_stock_detail(ticker: str, years: Years = "10"):
    data = _load_json(DOWNLOADS / f"s200_rally_backtest_{years}y" / "s200_backtest_stock_data.json")
    stock_data = data.get("stock_data", {})
    if ticker not in stock_data:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in S200 backtest data")
    return stock_data[ticker]

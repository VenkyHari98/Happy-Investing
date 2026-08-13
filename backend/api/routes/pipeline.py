"""Pipeline routes — check data freshness and trigger background refresh."""
import datetime
import json
import subprocess
import sys
import threading
from fastapi import APIRouter, HTTPException
from ..paths import ROOT, DOWNLOADS
from ..cache import cache

router = APIRouter()

# Temporary pause switch — portfolio backtests are the heaviest pipeline step
# (14 runs/day) and aren't needed while frontend focus is scanner tabs only
# (see frontend/src/lib/featureFlags.ts). Flip together with that flag
# and PAUSE_PORTFOLIO_BACKTESTS in web/start_dashboard.py to re-enable.
PAUSE_PORTFOLIO_BACKTESTS = True

# Temporary pause switch — skips the 52W/Envelope/S200-rally backtest engines and
# RHS's full backtest run (the per-stock data behind the "Stock Analysis" tabs).
# Mirrors STOCK_ANALYSIS_ENABLED in frontend/src/lib/featureFlags.ts and
# PAUSE_STOCK_ANALYSIS_BACKTESTS in web/start_dashboard.py — flip all three
# together to re-enable. Opportunity scanners are unaffected.
PAUSE_STOCK_ANALYSIS_BACKTESTS = True

# In-memory pipeline state (single-process, reset on server restart)
_state: dict = {
    "running": False,
    "started_at": "",
    "completed_at": "",
    "run_date": "",
    "error": "",
}
_lock = threading.Lock()


def _current_run_date() -> str:
    """Read run_date from the latest F40 scanner summary, if it exists."""
    base = DOWNLOADS / "current_setup"
    candidates = [d for d in base.iterdir() if d.is_dir() and d.name.isdigit() and len(d.name) == 8] if base.exists() else []
    if not candidates:
        return ""
    def to_sortable(name: str) -> str:
        return name[4:8] + name[2:4] + name[0:2]
    latest = max(candidates, key=lambda d: to_sortable(d.name))
    summary = latest / "current_setup_summary.json"
    if not summary.exists():
        return ""
    try:
        with open(summary, encoding="utf-8") as f:
            return json.load(f).get("run_date", "")
    except Exception:
        return ""


def _current_fundamentals_run_date() -> str:
    """Read last_refreshed from fundamentals_meta.json, if it exists.

    Written only by the dedicated fundamentals-refresh mode
    (web/start_dashboard.py --refresh-fundamentals) — never by the daily
    OHLCV/scanner pipeline, since fundamentals only change quarterly.
    """
    meta = DOWNLOADS / "fundamentals_meta.json"
    if not meta.exists():
        return ""
    try:
        with open(meta, encoding="utf-8") as f:
            return json.load(f).get("last_refreshed", "")
    except Exception:
        return ""


def _current_fundamentals_progress() -> dict | None:
    """Read the live progress file written throughout a fundamentals refresh
    (screener_cache.write_progress) — {"phase", "current", "total", "label"}.
    None if no refresh has ever run.
    """
    progress = DOWNLOADS / "fundamentals_progress.json"
    if not progress.exists():
        return None
    try:
        with open(progress, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


@router.get("/status")
def pipeline_status():
    """Return current pipeline state and data freshness."""
    with _lock:
        state = dict(_state)
    run_date = _current_run_date()
    today = datetime.date.today().isoformat()
    return {
        **state,
        "run_date": run_date,
        "is_fresh_today": run_date == today,
        "today": today,
        "fundamentals_run_date": _current_fundamentals_run_date(),
        "fundamentals_progress": _current_fundamentals_progress(),
    }


def _run_pipeline_bg(flags: list[str]):
    """Background worker that calls start_dashboard.py --data-only."""
    with _lock:
        _state["running"] = True
        _state["started_at"] = datetime.datetime.now().isoformat(timespec="seconds")
        _state["error"] = ""

    cmd = [sys.executable, str(ROOT / "web" / "start_dashboard.py"), "--data-only"] + flags
    try:
        result = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr or result.stdout or "Pipeline exited non-zero")
        cache.invalidate_prefix("scanner-")
        cache.invalidate_prefix("backtest-")
        cache.invalidate_prefix("portfolio-")
        cache.invalidate_prefix("rhs-")
        cache.invalidate_prefix("sr-")
        with _lock:
            _state["completed_at"] = datetime.datetime.now().isoformat(timespec="seconds")
            _state["run_date"] = datetime.date.today().isoformat()
            _state["error"] = ""
    except Exception as exc:
        with _lock:
            _state["error"] = str(exc)
    finally:
        with _lock:
            _state["running"] = False


@router.post("/refresh")
def pipeline_refresh(
    force: bool = False,
    skip_scanners: bool = False,
    skip_backtests: bool = PAUSE_STOCK_ANALYSIS_BACKTESTS,
    skip_portfolio: bool = PAUSE_PORTFOLIO_BACKTESTS,
):
    """Trigger a background pipeline refresh (OHLCV + scanners/backtests only —
    never fundamentals, see /refresh-fundamentals). Returns immediately.

    Poll GET /api/pipeline/status to track progress.
    """
    with _lock:
        if _state["running"]:
            raise HTTPException(status_code=409, detail="Pipeline is already running.")

    flags = []
    if force:
        flags.append("--force")
    if skip_scanners:
        flags.append("--skip-scanners")
    if skip_backtests:
        flags.append("--skip-backtests")
    if skip_portfolio:
        flags.append("--skip-portfolio")

    t = threading.Thread(target=_run_pipeline_bg, args=(flags,), daemon=True)
    t.start()
    return {"status": "started", "message": "Pipeline running in background. Poll /api/pipeline/status for updates."}


def _run_fundamentals_refresh_bg(force_all: bool = False):
    """Background worker that calls start_dashboard.py --refresh-fundamentals."""
    with _lock:
        _state["running"] = True
        _state["started_at"] = datetime.datetime.now().isoformat(timespec="seconds")
        _state["error"] = ""

    cmd = [sys.executable, str(ROOT / "web" / "start_dashboard.py"), "--refresh-fundamentals"]
    if force_all:
        cmd.append("--force-all-fundamentals")
    try:
        result = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr or result.stdout or "Fundamentals refresh exited non-zero")
        cache.invalidate_prefix("scanner-")
        cache.invalidate_prefix("rhs-")
        cache.invalidate_prefix("sr-")
        with _lock:
            _state["completed_at"] = datetime.datetime.now().isoformat(timespec="seconds")
            _state["error"] = ""
    except Exception as exc:
        with _lock:
            _state["error"] = str(exc)
    finally:
        with _lock:
            _state["running"] = False


@router.post("/refresh-fundamentals")
def pipeline_refresh_fundamentals(force_all: bool = False):
    """Trigger a background fundamentals-only refresh (Screener.in + yfinance
    Phase-2 metrics, then scanners re-run so the fresh data shows up
    immediately). Returns immediately.

    Incremental by default (force_all=False) — only re-fetches tickers stale
    enough (~90 days) to plausibly have a new quarterly result, typically
    fast. force_all=True re-fetches every ticker regardless of freshness —
    realistically 8-12 minutes for the full universe, since Screener.in has
    no bulk API and stays deliberately sequential.

    Deliberately separate from POST /refresh — fundamentals only change on
    quarterly results, so this is manual/on-demand only, never automatic.
    Poll GET /api/pipeline/status (fundamentals_run_date, fundamentals_progress)
    to track progress.
    """
    with _lock:
        if _state["running"]:
            raise HTTPException(status_code=409, detail="Pipeline is already running.")

    t = threading.Thread(target=_run_fundamentals_refresh_bg, args=(force_all,), daemon=True)
    t.start()
    return {"status": "started", "message": "Fundamentals refresh running in background. Poll /api/pipeline/status for updates."}

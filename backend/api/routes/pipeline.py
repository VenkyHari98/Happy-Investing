"""Pipeline routes — check data freshness and trigger background refresh."""
import datetime
import json
import subprocess
import sys
import threading
from fastapi import APIRouter, HTTPException
from ..paths import ROOT, DOWNLOADS

router = APIRouter()

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
    skip_backtests: bool = False,
    skip_portfolio: bool = False,
):
    """Trigger a background pipeline refresh. Returns immediately.

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

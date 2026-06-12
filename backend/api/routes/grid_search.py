"""Grid Search routes — run envelope parameter sweep as subprocess, stream results via SSE."""

import asyncio
import datetime
import json
import subprocess
import sys
import threading
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..paths import ROOT

router = APIRouter()

RUNNER = Path(__file__).resolve().parent.parent.parent / "scripts" / "grid_search_runner.py"

# ── State ─────────────────────────────────────────────────────────────────────

_gs_state: dict = {
    "running":      False,
    "started_at":   "",
    "completed_at": "",
    "error":        "",
    "n_done":       0,
    "n_total":      0,
    "results":      [],   # accumulated, sorted by CAGR desc
}
_gs_lock: threading.Lock = threading.Lock()
_gs_proc: Optional[subprocess.Popen] = None


def _snapshot() -> dict:
    with _gs_lock:
        return {k: _gs_state[k] for k in ("running", "started_at", "completed_at", "error", "n_done", "n_total")}


# ── Stdout reader thread ──────────────────────────────────────────────────────

def _read_stdout(proc: subprocess.Popen) -> None:
    try:
        for raw in proc.stdout:  # type: ignore[union-attr]
            line = raw.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue

            mtype = msg.get("type")
            if mtype == "meta":
                with _gs_lock:
                    _gs_state["n_total"] = msg.get("n_total", 0)
            elif mtype == "result":
                with _gs_lock:
                    _gs_state["results"].append({k: v for k, v in msg.items() if k != "type"})
                    _gs_state["n_done"] = len(_gs_state["results"])
            elif mtype == "done":
                with _gs_lock:
                    _gs_state["results"].sort(key=lambda r: r["cagr"], reverse=True)
    except Exception:
        pass
    finally:
        proc.wait()
        rc = proc.returncode
        with _gs_lock:
            if rc not in (0, -15, 1) and not _gs_state["error"]:
                _gs_state["error"] = f"Runner exited with code {rc}"
            _gs_state["completed_at"] = datetime.datetime.now().isoformat(timespec="seconds")
            _gs_state["running"] = False


# ── Endpoints ─────────────────────────────────────────────────────────────────

# Fixed grid values matching envelope_grid_search.py
_VALID_ENV_PCTS  = [12.0, 13.0, 14.0, 15.0, 16.0, 17.0]
_VALID_ZONE_PCTS = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5]


@router.post("/run")
def grid_search_run(
    env_pct_min:  float = 12.0,
    env_pct_max:  float = 17.0,
    zone_pct_min: float = 0.0,
    zone_pct_max: float = 2.5,
    years:        int   = 10,
):
    global _gs_proc

    if years not in (5, 10):
        raise HTTPException(400, "years must be 5 or 10")
    if not (1.0 <= env_pct_min <= env_pct_max <= 30.0):
        raise HTTPException(400, "Invalid env_pct range")
    if not (0.0 <= zone_pct_min <= zone_pct_max <= 20.0):
        raise HTTPException(400, "Invalid zone_pct range")

    with _gs_lock:
        if _gs_state["running"]:
            raise HTTPException(409, "Grid search already running.")

    env_pcts  = [e for e in _VALID_ENV_PCTS  if env_pct_min  <= e <= env_pct_max]
    zone_pcts = [z for z in _VALID_ZONE_PCTS if zone_pct_min <= z <= zone_pct_max]

    if not env_pcts or not zone_pcts:
        raise HTTPException(400, "No valid parameter values in specified range")

    # Reset state
    n_combos = len(env_pcts) * len(zone_pcts) * 3 * 4 * 3 * 2 * 2
    with _gs_lock:
        _gs_state.update({
            "running":      True,
            "started_at":   datetime.datetime.now().isoformat(timespec="seconds"),
            "completed_at": "",
            "error":        "",
            "n_done":       0,
            "n_total":      n_combos,
            "results":      [],
        })

    proc = subprocess.Popen(
        [
            sys.executable, str(RUNNER),
            "--env-pcts",  ",".join(str(e) for e in env_pcts),
            "--zone-pcts", ",".join(str(z) for z in zone_pcts),
            "--years",     str(years),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=str(ROOT),
    )

    with _gs_lock:
        _gs_proc = proc

    threading.Thread(target=_read_stdout, args=(proc,), daemon=True).start()

    return {"status": "started", "n_total": n_combos, "env_pcts": env_pcts, "zone_pcts": zone_pcts}


@router.post("/stop")
def grid_search_stop():
    global _gs_proc
    with _gs_lock:
        if not _gs_state["running"]:
            return {"status": "not_running"}
        proc = _gs_proc
        _gs_state["error"] = "Stopped by user"

    if proc:
        proc.terminate()

    return {"status": "stopping"}


@router.get("/status")
def grid_search_status():
    return _snapshot()


@router.get("/stream")
async def grid_search_stream():
    """SSE endpoint — streams results as they arrive, replays all on reconnect."""

    async def generate():
        cursor = 0
        while True:
            with _gs_lock:
                running    = _gs_state["running"]
                all_results = list(_gs_state["results"])  # snapshot
                n_done     = _gs_state["n_done"]
                n_total    = _gs_state["n_total"]
                error      = _gs_state["error"]

            new_items = all_results[cursor:]
            cursor += len(new_items)

            for item in new_items:
                yield f"event: result\ndata: {json.dumps(item)}\n\n"

            if n_total > 0:
                yield f"event: progress\ndata: {json.dumps({'n_done': n_done, 'n_total': n_total})}\n\n"

            if not running:
                if error:
                    yield f"event: fail\ndata: {json.dumps({'error': error})}\n\n"
                yield f"event: done\ndata: {json.dumps({'n_done': n_done, 'n_total': n_total})}\n\n"
                return

            await asyncio.sleep(0.5)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

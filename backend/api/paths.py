"""Shared path constants for the FastAPI backend."""
from pathlib import Path

# backend/api/ → backend/ → Happy-Investing/
ROOT = Path(__file__).resolve().parent.parent.parent

DOWNLOADS  = ROOT / "Source Data" / "Downloaded Data"
WATCHLISTS = ROOT / "Source Data" / "Watchlist"
SCRIPTS    = ROOT / "Scripts" / "strategies"
WEB_DATA   = ROOT / "web" / "data"


def latest_dated_dir(base: Path) -> Path | None:
    """Return the most recently dated subdirectory (DDMMYYYY format) under base."""
    candidates = [d for d in base.iterdir() if d.is_dir() and d.name.isdigit() and len(d.name) == 8]
    if not candidates:
        return None
    # Sort by the date value: DDMMYYYY → convert to YYYYMMDD for correct sorting
    def to_sortable(name: str) -> str:
        return name[4:8] + name[2:4] + name[0:2]
    return max(candidates, key=lambda d: to_sortable(d.name))

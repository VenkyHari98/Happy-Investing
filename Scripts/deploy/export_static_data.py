"""export_static_data.py — copy the latest opportunity-scanner outputs into
frontend/src/data/opportunities/ for the static Vercel deployment.

Run after `python web/start_dashboard.py --data-only` (see
.github/workflows/refresh-opportunities.yml). Each file is independent — a
missing source is skipped with a warning, not a hard failure, so one broken
scanner doesn't block the others from publishing.
"""
import datetime
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DOWNLOADS = ROOT / "Source Data" / "Downloaded Data"
OUT = ROOT / "frontend" / "src" / "data" / "opportunities"

OUT.mkdir(parents=True, exist_ok=True)
copied: list[str] = []
skipped: list[str] = []


def latest_dated_dir(base: Path) -> Path | None:
    """Most recent DDMMYYYY-named subdirectory under base, or None."""
    if not base.exists():
        return None
    candidates = [d for d in base.iterdir() if d.is_dir() and d.name.isdigit() and len(d.name) == 8]
    if not candidates:
        return None
    return max(candidates, key=lambda d: d.name[4:8] + d.name[2:4] + d.name[0:2])


def copy_file(src: Path, dst_name: str, label: str) -> None:
    if src.exists():
        shutil.copy2(src, OUT / dst_name)
        copied.append(f"  [OK]  {label}")
    else:
        skipped.append(f"  [--]  {label} — not found at {src}")


# F40 opportunity scanner (dated dir)
folder = latest_dated_dir(DOWNLOADS / "current_setup")
run_date = None
if folder:
    copy_file(folder / "current_setup.json", "current_setup.json", "F40 opportunity scanner rows")
    copy_file(folder / "current_setup_summary.json", "current_setup_summary.json", "F40 scanner summary")
    try:
        run_date = json.loads((folder / "current_setup_summary.json").read_text(encoding="utf-8")).get("run_date")
    except Exception:
        pass
else:
    skipped.append("  [--]  F40 opportunity scanner — no dated output found")

# S200 20% rally scanner (dated dir)
folder = latest_dated_dir(DOWNLOADS / "s200_20pct_rally")
if folder:
    copy_file(folder / "s200_20pct_rallies.json", "s200_20pct_rallies.json", "S200 rally opportunities")
else:
    skipped.append("  [--]  S200 rally scanner — no dated output found")

# Support/Resistance scanner (dated dir)
folder = latest_dated_dir(DOWNLOADS / "support_resistance")
if folder:
    copy_file(folder / "support_resistance.json", "support_resistance.json", "Support/Resistance opportunities")
else:
    skipped.append("  [--]  Support/Resistance scanner — no dated output found")

# RHS/CWH scanner (fixed dir, overwritten in place each run — not dated)
copy_file(DOWNLOADS / "rhs_cwh_backtest" / "scanner_results.json", "rhs_scanner_results.json", "RHS/CWH opportunities")

# Synthetic pipeline status — `today` is computed per-request by the Route
# Handler, not baked in here, so the "N days old" banner stays accurate
# between deploys.
fundamentals_run_date = None
meta_path = DOWNLOADS / "fundamentals_meta.json"
if meta_path.exists():
    try:
        fundamentals_run_date = json.loads(meta_path.read_text(encoding="utf-8")).get("last_refreshed")
    except Exception:
        pass

status = {
    "running": False,
    "run_date": run_date,
    "fundamentals_run_date": fundamentals_run_date,
    "fundamentals_progress": None,
    "error": "",
    "exported_at": datetime.datetime.utcnow().isoformat() + "Z",
}
(OUT / "pipeline_status.json").write_text(json.dumps(status, indent=2), encoding="utf-8")
copied.append("  [OK]  pipeline status")

print(f"\nExported to: {OUT}")
for line in copied:
    print(line)
if skipped:
    print("\nSkipped (not found):")
    for line in skipped:
        print(line)

"""
build_data.py — copy all strategy outputs into web/data/ for the dashboard.

Each strategy section is fully independent.  If a strategy has not been run yet
its section prints a warning and skips — it does NOT crash the whole script.
This means you can run just one strategy and still get its data into the web folder.

Horizon-specific files (backtests) are copied for both 5y and 10y variants.
The frontend uses a toggle to switch between them.
"""

from pathlib import Path
import shutil
import datetime

ROOT      = Path(__file__).resolve().parent
WEB_DATA  = ROOT / 'data'
DOWNLOADS = ROOT.parent / 'Source Data' / 'Downloaded Data'

CURRENT_SETUP_ROOT = DOWNLOADS / 'current_setup'
S200_RALLY_ROOT    = DOWNLOADS / 's200_20pct_rally'

WEB_DATA.mkdir(parents=True, exist_ok=True)
copied  = []
skipped = []


def latest_dated_folder(root: Path):
    """Return the most-recent DDMMYYYY subfolder, or None."""
    if not root.exists():
        return None
    folders = [p for p in root.iterdir() if p.is_dir()]
    if not folders:
        return None
    try:
        return max(folders, key=lambda p: datetime.datetime.strptime(p.name, '%d%m%Y'))
    except ValueError:
        return None


def copy_file(src: Path, dst_name: str, label: str):
    if src.exists():
        shutil.copy2(src, WEB_DATA / dst_name)
        copied.append(f'  [OK]  {label}')
    else:
        skipped.append(f'  [--]  {label} — not found at {src}')


# ── F40 Current Setup Scanner (not horizon-specific) ──────────────────────
folder = latest_dated_folder(CURRENT_SETUP_ROOT)
if folder:
    copy_file(folder / 'current_setup_summary.json', 'current_setup_summary.json', 'F40 current setup summary')
    copy_file(folder / 'current_setup.json',         'current_setup.json',         'F40 current setup rows')
else:
    skipped.append('  [--]  F40 current setup — run f40_opportunity_scanner.py first')

# ── S200 20% Rally Scanner (not horizon-specific) ─────────────────────────
folder = latest_dated_folder(S200_RALLY_ROOT)
if folder:
    copy_file(folder / 's200_20pct_rallies.json', 's200_20pct_rallies.json', 'S200 rally opportunities')
    copy_file(folder / 's200_stock_data.json',    's200_stock_data.json',    'S200 stock chart data')
else:
    skipped.append('  [--]  S200 rally — run s200_20pct_rally_scanner.py first')

# ── Envelope Strategy Portfolio Backtest (on-demand, not horizon-specific) ──
copy_file(DOWNLOADS / 'env_pb_long.json',     'env_pb_long.json',     'Envelope Long Full portfolio backtest')
copy_file(DOWNLOADS / 'env_pb_lower.json',    'env_pb_lower.json',    'Envelope Lower Half portfolio backtest')
copy_file(DOWNLOADS / 'env_pb_upper.json',    'env_pb_upper.json',    'Envelope Upper Half portfolio backtest')
copy_file(DOWNLOADS / 'env_pb_combined.json', 'env_pb_combined.json', 'Envelope Combined portfolio backtest')

# ── Horizon-specific files: copied for both 5y and 10y ────────────────────
for hz in ('5y', '10y'):
    hz_label = f'_{hz}'

    # 52W stock-level backtest
    bt52w_root = DOWNLOADS / f'backtest_52w_{hz}'
    if bt52w_root.exists():
        copy_file(bt52w_root / 'backtest_summary.json', f'backtest_52w_summary_{hz}.json',    f'52W backtest summary ({hz})')
        copy_file(bt52w_root / 'stock_data.json',       f'backtest_52w_stock_data_{hz}.json', f'52W stock detail data ({hz})')
    else:
        skipped.append(f'  [--]  52W backtest ({hz}) — run f40_backtest_52w.py --years {hz[:-1]} first')

    # Envelope stock-level backtest
    env_root = DOWNLOADS / f'backtest_envelope_long_{hz}'
    if env_root.exists():
        copy_file(env_root / 'backtest_summary.json', f'backtest_envelope_summary_{hz}.json', f'Envelope backtest summary ({hz})')
        copy_file(env_root / 'trades.json',           f'backtest_envelope_trades_{hz}.json',  f'Envelope backtest trades ({hz})')
    else:
        skipped.append(f'  [--]  Envelope backtest ({hz}) — run f40_backtest_envelope.py --years {hz[:-1]} first')

    # S200 rally stock-level backtest
    s200bt_root = DOWNLOADS / f's200_rally_backtest_{hz}'
    if s200bt_root.exists():
        copy_file(s200bt_root / 's200_backtest_summary.json',    f's200_backtest_summary_{hz}.json',    f'S200 rally backtest summary ({hz})')
        copy_file(s200bt_root / 's200_backtest_stock_data.json', f's200_backtest_stock_data_{hz}.json', f'S200 rally backtest stock data ({hz})')
    else:
        skipped.append(f'  [--]  S200 rally backtest ({hz}) — run s200_20pct_rally_backtest.py --years {hz[:-1]} first')

    # F40 portfolio backtests (6 variants)
    for variant in ('fixed', 'rolling', 'fixed_env-long', 'fixed_rally-f40', 'fixed_rally-s200', 'fixed_env-long_rally-f40'):
        src_name = f'f40_portfolio_backtest_{variant}_{hz}.json'
        copy_file(DOWNLOADS / src_name, src_name, f'F40 portfolio ({variant}, {hz})')

    # S200 portfolio backtest
    copy_file(DOWNLOADS / f's200_portfolio_backtest_{hz}.json',
              f's200_portfolio_backtest_{hz}.json',
              f'S200 rally portfolio backtest ({hz})')

# ── Report ─────────────────────────────────────────────────────────────────
print(f'\nData copied to: {WEB_DATA}')
for line in copied:
    print(line)
if skipped:
    print('\nSkipped (not yet generated):')
    for line in skipped:
        print(line)

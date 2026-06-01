from pathlib import Path
import shutil
import datetime

ROOT = Path(__file__).resolve().parent
CURRENT_SETUP_ROOT = ROOT.parent / 'Source Data' / 'Downloaded Data' / 'current_setup'
BACKTEST_52W_ROOT = ROOT.parent / 'Source Data' / 'Downloaded Data' / 'backtest_52w'
BACKTEST_ENVELOPE_ROOT = ROOT.parent / 'Source Data' / 'Downloaded Data' / 'backtest_envelope_long'
WEB_DATA = ROOT / 'data'

WEB_DATA.mkdir(parents=True, exist_ok=True)

if not CURRENT_SETUP_ROOT.exists():
    raise FileNotFoundError(f'Current setup data root not found: {CURRENT_SETUP_ROOT}')

current_folders = [p for p in CURRENT_SETUP_ROOT.iterdir() if p.is_dir()]
if not current_folders:
    raise FileNotFoundError(f'No current setup folders found under {CURRENT_SETUP_ROOT}')

latest_current = max(current_folders, key=lambda p: datetime.datetime.strptime(p.name, '%d%m%Y'))
current_summary_src = latest_current / 'current_setup_summary.json'
current_rows_src = latest_current / 'current_setup.json'

if not current_summary_src.exists() or not current_rows_src.exists():
    raise FileNotFoundError('Expected current_setup_summary.json and current_setup.json in the latest current_setup folder.')

shutil.copy2(current_summary_src, WEB_DATA / 'current_setup_summary.json')
shutil.copy2(current_rows_src, WEB_DATA / 'current_setup.json')
print(f'Copied latest current setup files from {latest_current} to {WEB_DATA}')

if not BACKTEST_52W_ROOT.exists():
    raise FileNotFoundError(f'52W backtest folder not found: {BACKTEST_52W_ROOT}')

if not BACKTEST_ENVELOPE_ROOT.exists():
    raise FileNotFoundError(f'Envelope backtest folder not found: {BACKTEST_ENVELOPE_ROOT}')

shutil.copy2(BACKTEST_52W_ROOT / 'backtest_summary.json', WEB_DATA / 'backtest_52w_summary.json')
shutil.copy2(BACKTEST_52W_ROOT / 'trades.json', WEB_DATA / 'backtest_52w_trades.json')
stock_data_src = BACKTEST_52W_ROOT / 'stock_data.json'
if stock_data_src.exists():
    shutil.copy2(stock_data_src, WEB_DATA / 'backtest_52w_stock_data.json')
    print(f'Copied 52W stock detail data to {WEB_DATA}')
else:
    print(f'Warning: {stock_data_src} not found; 52W stock detail visualization will be unavailable.')
print(f'Copied 52W backtest data to {WEB_DATA}')

shutil.copy2(BACKTEST_ENVELOPE_ROOT / 'backtest_summary.json', WEB_DATA / 'backtest_envelope_summary.json')
shutil.copy2(BACKTEST_ENVELOPE_ROOT / 'trades.json', WEB_DATA / 'backtest_envelope_trades.json')
print(f'Copied envelope backtest data to {WEB_DATA}')

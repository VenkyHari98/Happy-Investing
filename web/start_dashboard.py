import argparse
import http.server
import socketserver
import subprocess
import sys
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent
SCRIPTS_DIR = WORKSPACE / 'Scripts' / 'strategies'

CURRENT_SCANNER = SCRIPTS_DIR / 'f40_opportunity_scanner.py'
BACKTEST_52W = SCRIPTS_DIR / 'f40_backtest_52w.py'
BACKTEST_ENVELOPE = SCRIPTS_DIR / 'f40_backtest_envelope.py'
BUILD_DATA = ROOT / 'build_data.py'


def run_command(command, cwd=None):
    print(f'> Running: {" ".join(str(c) for c in command)}')
    subprocess.run(command, cwd=cwd or WORKSPACE, check=True)


def build_current_setup(years=2, envelope_pct=14.0, proximity_pct=2.0, ma_period=200, window=252):
    run_command([
        sys.executable,
        str(CURRENT_SCANNER),
        '--years', str(years),
        '--envelope-pct', str(envelope_pct),
        '--proximity-pct', str(proximity_pct),
        '--ma-period', str(ma_period),
        '--window', str(window),
    ])


def build_backtest_52w(years=10, portfolio_value=100000.0, slippage=0.10):
    run_command([
        sys.executable,
        str(BACKTEST_52W),
        '--years', str(years),
        '--portfolio-value', str(portfolio_value),
        '--slippage', str(slippage),
    ])


def build_backtest_envelope(years=10, portfolio_value=100000.0, slippage=0.10, ma_period=200, envelope_pct=14.0, entry_band_pct=2.0, ma_type='SMA', direction='long'):
    run_command([
        sys.executable,
        str(BACKTEST_ENVELOPE),
        '--years', str(years),
        '--portfolio-value', str(portfolio_value),
        '--slippage', str(slippage),
        '--ma-period', str(ma_period),
        '--envelope-pct', str(envelope_pct),
        '--entry-band-pct', str(entry_band_pct),
        '--ma-type', ma_type,
        '--direction', direction,
    ])


def build_web_data():
    run_command([sys.executable, str(BUILD_DATA)])


def start_local_server(port=8000):
    print(f'Opening dashboard at http://localhost:{port}')
    webbrowser.open(f'http://localhost:{port}')
    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.ThreadingTCPServer(('', port), handler) as httpd:
        try:
            print(f'Serving web dashboard from {ROOT} on port {port}...')
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nServer stopped.')


def parse_args():
    parser = argparse.ArgumentParser(description='Build and launch the Happy Investing dashboard')
    parser.add_argument('--skip-scanner', action='store_true', help='Skip running the current setup scanner')
    parser.add_argument('--skip-backtests', action='store_true', help='Skip running the backtests')
    parser.add_argument('--port', type=int, default=8000, help='Port used for the local dashboard server')
    parser.add_argument('--no-browser', action='store_true', help='Do not open the browser automatically')
    return parser.parse_args()


def main():
    args = parse_args()

    if not args.skip_scanner:
        build_current_setup()

    if not args.skip_backtests:
        build_backtest_52w()
        build_backtest_envelope()

    build_web_data()

    if not args.no_browser:
        webbrowser.open(f'http://localhost:{args.port}')

    print('Starting local dashboard server. Press Ctrl+C to stop.')
    start_local_server(args.port)


if __name__ == '__main__':
    main()

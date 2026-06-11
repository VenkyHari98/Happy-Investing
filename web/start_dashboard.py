"""
start_dashboard.py — ONE command to rebuild all strategy data and launch the dashboard.

Smart launch behavior (no flags needed):
  - 1st launch of the day  → detects stale data, starts server immediately with
                             existing data, runs full pipeline in background
  - 2nd+ launch of the day → detects data is already fresh, skips pipeline entirely
  - First ever launch      → no data exists; runs blocking pipeline, then serves

Override flags:
  --force              force a full pipeline re-run regardless of data freshness
  --skip-scanners      skip F40 and S200 live scanners
  --skip-backtests     skip 52W and Envelope backtests
  --skip-portfolio     skip F40 and S200 portfolio backtests
  --data-only          run pipeline but do NOT start the web server
  --serve-only         skip all pipeline steps; just serve existing web/data/
  --port N             local server port (default 8080)
"""

import csv
import dataclasses
import datetime
import gzip
import http.server
import json
import multiprocessing
import os
import socketserver
import subprocess
import sys
import threading
import webbrowser
from concurrent.futures import ProcessPoolExecutor, as_completed
from itertools import product
from urllib.parse import urlparse, parse_qs
from pathlib import Path

ROOT        = Path(__file__).resolve().parent
WORKSPACE   = ROOT.parent
SCRIPTS_DIR = WORKSPACE / 'Scripts' / 'strategies'

# Make strategy scripts importable (needed for grid-search SSE endpoint)
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

# Shared stop flag for the grid-search SSE endpoint
_grid_stop_event = threading.Event()

DOWNLOADS          = WORKSPACE / 'Source Data' / 'Downloaded Data'

F40_SCANNER        = SCRIPTS_DIR / 'f40_opportunity_scanner.py'
S200_RALLY         = SCRIPTS_DIR / 's200_20pct_rally_scanner.py'
S200_RALLY_BACKTEST  = SCRIPTS_DIR / 's200_20pct_rally_backtest.py'
BACKTEST_52W         = SCRIPTS_DIR / 'f40_backtest_52w.py'
BACKTEST_ENVELOPE    = SCRIPTS_DIR / 'f40_backtest_envelope.py'
F40_PORTFOLIO_BT     = SCRIPTS_DIR / 'f40_portfolio_backtest.py'
S200_PORTFOLIO_BT    = SCRIPTS_DIR / 's200_portfolio_backtest.py'
BUILD_DATA           = ROOT / 'build_data.py'

DATA_DIR      = ROOT / 'data'
SUMMARY_FILE  = DATA_DIR / 'current_setup_summary.json'


# ── Freshness helpers ──────────────────────────────────────────────────────────

def is_data_fresh_today() -> bool:
    """Return True if current_setup_summary.json has run_date == today."""
    try:
        with open(SUMMARY_FILE, 'r', encoding='utf-8') as f:
            d = json.load(f)
        return d.get('run_date') == datetime.date.today().isoformat()
    except Exception:
        return False


def has_any_data() -> bool:
    """Return True if there is at least one core output file to serve."""
    return (DATA_DIR / 'current_setup.json').exists()


# ── Pipeline state (shared between HTTP handler and background thread) ─────────

@dataclasses.dataclass
class PipelineState:
    running: bool = False
    started_at: str = ''
    completed_at: str = ''
    run_date: str = ''
    error: str = ''

    def to_dict(self):
        return dataclasses.asdict(self)


_pipeline_state = PipelineState()


# ── Pipeline helpers ───────────────────────────────────────────────────────────

def _stream_output(label: str, proc: subprocess.Popen) -> None:
    """Read subprocess stdout line-by-line and prefix each line with [label]."""
    prefix = f'[{label}]'
    for line in proc.stdout:
        print(f'{prefix} {line}', end='', flush=True)


def run_parallel(steps: list, cwd=None) -> None:
    """Launch all (label, command) pairs concurrently, stream their output, wait for all.

    Raises subprocess.CalledProcessError if any step exits non-zero.
    """
    if not steps:
        return

    print(f'\n{"=" * 60}')
    print(f'  Running {len(steps)} step(s) in parallel')
    for label, _ in steps:
        print(f'    - {label}')
    print('=' * 60)

    procs: dict = {}
    threads: list = []

    for label, cmd in steps:
        proc = subprocess.Popen(
            cmd,
            cwd=cwd or WORKSPACE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        procs[label] = proc
        t = threading.Thread(target=_stream_output, args=(label, proc), daemon=True)
        t.start()
        threads.append(t)

    for t in threads:
        t.join()

    failed = [label for label, proc in procs.items() if proc.wait() != 0]
    if failed:
        raise subprocess.CalledProcessError(
            returncode=1,
            cmd=failed,
            output=f'Pipeline steps failed: {failed}',
        )

    print(f'\n  All {len(steps)} step(s) completed successfully.')


def run(label: str, command: list, cwd=None) -> None:
    """Run a single command, streaming its output."""
    run_parallel([(label, command)], cwd=cwd)


def _build_pipeline_steps(args) -> list:
    """Build the list of (label, command) pairs based on skip flags."""
    all_steps = []

    if not args.skip_scanners:
        all_steps += [
            ('F40 Opportunity Scanner', [sys.executable, str(F40_SCANNER)]),
            ('S200 20% Rally Scanner', [sys.executable, str(S200_RALLY)]),
        ]
    else:
        print('\n[Skipped] Live scanners (--skip-scanners)')

    if not args.skip_backtests:
        for hz in ('5', '10'):
            all_steps += [
                (f'S200 Rally Backtest {hz}Y',     [sys.executable, str(S200_RALLY_BACKTEST), '--years', hz,
                                                    '--output-root', str(DOWNLOADS / f's200_rally_backtest_{hz}y')]),
                (f'52W Backtest {hz}Y',            [sys.executable, str(BACKTEST_52W),     '--years', hz,
                                                    '--output', str(DOWNLOADS / f'backtest_52w_{hz}y')]),
                (f'Envelope Backtest {hz}Y',       [sys.executable, str(BACKTEST_ENVELOPE), '--years', hz,
                                                    '--output', str(DOWNLOADS / f'backtest_envelope_long_{hz}y')]),
            ]
    else:
        print('\n[Skipped] Per-stock backtests (--skip-backtests)')

    if not args.skip_portfolio:
        for hz in ('5', '10'):
            all_steps += [
                (f'F40 Portfolio Fixed {hz}Y',        [sys.executable, str(F40_PORTFOLIO_BT), '--exit-mode', 'fixed',   '--years', hz]),
                (f'F40 Portfolio Rolling {hz}Y',      [sys.executable, str(F40_PORTFOLIO_BT), '--exit-mode', 'rolling', '--years', hz]),
                (f'F40 Portfolio Env-Long {hz}Y',     [sys.executable, str(F40_PORTFOLIO_BT), '--exit-mode', 'fixed', '--envelope', 'long',  '--years', hz]),
                (f'F40 Portfolio Rally-F40 {hz}Y',    [sys.executable, str(F40_PORTFOLIO_BT), '--exit-mode', 'fixed', '--rally', 'f40',      '--years', hz]),
                (f'F40 Portfolio Rally-S200 {hz}Y',   [sys.executable, str(F40_PORTFOLIO_BT), '--exit-mode', 'fixed', '--rally', 's200',     '--years', hz]),
                (f'F40 Portfolio All-3 {hz}Y',        [sys.executable, str(F40_PORTFOLIO_BT), '--exit-mode', 'fixed', '--envelope', 'long', '--rally', 'f40', '--years', hz]),
                (f'S200 Portfolio {hz}Y',             [sys.executable, str(S200_PORTFOLIO_BT), '--years', hz]),
            ]
    else:
        print('\n[Skipped] Portfolio backtests (--skip-portfolio)')

    return all_steps


def run_pipeline_background(args, state: PipelineState) -> None:
    """Run the full pipeline in a background daemon thread."""
    state.running = True
    state.started_at = datetime.datetime.now().isoformat(timespec='seconds')
    state.error = ''
    try:
        all_steps = _build_pipeline_steps(args)
        if all_steps:
            run_parallel(all_steps)
        run('Copying data to web/data/', [sys.executable, str(BUILD_DATA)])
        state.run_date = datetime.date.today().isoformat()
        state.completed_at = datetime.datetime.now().isoformat(timespec='seconds')
        print(f'\n[Pipeline] Background refresh complete. run_date={state.run_date}', flush=True)
    except Exception as exc:
        state.error = str(exc)
        print(f'\n[Pipeline] ERROR: {exc}', flush=True)
    finally:
        state.running = False


# ── CLI args ───────────────────────────────────────────────────────────────────

def parse_args():
    import argparse
    p = argparse.ArgumentParser(
        description='Rebuild all Happy Investing strategy data and launch the dashboard.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('--force',          action='store_true', help='Force full pipeline re-run regardless of data freshness')
    p.add_argument('--skip-scanners',  action='store_true', help='Skip F40 and S200 live scanners')
    p.add_argument('--skip-backtests', action='store_true', help='Skip 52W and Envelope backtests')
    p.add_argument('--skip-portfolio', action='store_true', help='Skip F40 and S200 portfolio backtests')
    p.add_argument('--data-only',      action='store_true', help='Build data but do not start the web server')
    p.add_argument('--serve-only',     action='store_true', help='Skip all data pipeline steps; just serve existing web/data/')
    p.add_argument('--port',           type=int, default=8080, help='Local server port (default: 8080)')
    return p.parse_args()


# ── HTTP server ────────────────────────────────────────────────────────────────

def _start_server(args):
    os.chdir(ROOT)   # serve from web/ so index.html is at /
    url = f'http://localhost:{args.port}'
    print(f'\n  Opening dashboard at {url}')
    print('  Press Ctrl+C to stop the server.\n')
    webbrowser.open(url)

    ENVELOPE_BT_SCRIPT = SCRIPTS_DIR / 'envelope_portfolio_backtest.py'

    class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            # Pipeline status endpoint
            if self.path == '/api/pipeline-status':
                payload = json.dumps(_pipeline_state.to_dict()).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(payload)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(payload)
                return

            # SSE grid-search streaming endpoint
            if self.path.startswith('/api/envelope/grid-search'):
                self._handle_grid_sse()
                return

            # Serve JSON with gzip compression — reduces 22MB→~2MB over loopback
            if self.path.split('?')[0].endswith('.json'):
                file_path = self.translate_path(self.path)
                try:
                    with open(file_path, 'rb') as f:
                        raw = f.read()
                    compressed = gzip.compress(raw, compresslevel=6)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Content-Encoding', 'gzip')
                    self.send_header('Content-Length', str(len(compressed)))
                    self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
                    self.end_headers()
                    self.wfile.write(compressed)
                    return
                except (FileNotFoundError, IsADirectoryError):
                    pass  # fall through to default handler (returns 404)
            super().do_GET()

        def do_OPTIONS(self):
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.end_headers()

        def _handle_grid_sse(self):
            """GET /api/envelope/grid-search — Server-Sent Events streaming grid search."""
            from envelope_grid_search import (
                _worker_init, _worker_run_combo, _write_summary_md,
                ENVELOPE_PCTS, ZONE_PCTS, ALLOC_LARGE, ALLOC_MID, ALLOC_SMALL,
                EXIT_MODES, PYRAMID_OPTS, RESULT_COLS, INITIAL_CAP,
                sim_start, sim_end, DATA_YEARS,
            )
            from f40_backtest_common import fetch_all_stocks_parallel, parse_f40_watchlist

            qs = parse_qs(urlparse(self.path).query)

            def _flist(key, default):
                return [float(x) for x in qs[key][0].split(',')] if key in qs else default

            def _slist(key, default):
                return qs[key][0].split(',') if key in qs else default

            def _blist(key, default):
                return [v.lower() == 'true' for v in qs[key][0].split(',')] if key in qs else default

            env_pcts   = _flist('env_pcts',    ENVELOPE_PCTS)
            zone_pcts  = _flist('zone_pcts',   ZONE_PCTS)
            al_large   = _flist('alloc_large', ALLOC_LARGE)
            al_mid     = _flist('alloc_mid',   ALLOC_MID)
            al_small   = _flist('alloc_small', ALLOC_SMALL)
            exit_modes = _slist('exit_modes',  EXIT_MODES)
            pyramids   = _blist('pyramid',     PYRAMID_OPTS)

            all_combos = list(product(env_pcts, zone_pcts, al_large, al_mid, al_small, exit_modes, pyramids))
            total = len(all_combos)

            # SSE response headers (no Content-Length — stream is open-ended)
            self.send_response(200)
            self.send_header('Content-Type',  'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('X-Accel-Buffering', 'no')
            self.send_header('Access-Control-Allow-Origin', '*')
            http.server.BaseHTTPRequestHandler.end_headers(self)

            def sse(data_dict):
                msg = f"data: {json.dumps(data_dict)}\n\n"
                self.wfile.write(msg.encode('utf-8'))
                self.wfile.flush()

            f40_path  = WORKSPACE / 'Source Data' / 'Watchlist' / 'F40.txt'
            downloads = WORKSPACE / 'Source Data' / 'Downloaded Data'
            docs_dir  = WORKSPACE / 'docs'

            try:
                sse({'event': 'status', 'msg': 'Loading watchlist & data...'})
                raw_stocks  = parse_f40_watchlist(f40_path)
                stocks_meta = {t: (c, s) for t, (c, s) in raw_stocks.items()}
                raw_dfs     = fetch_all_stocks_parallel(raw_stocks, years=DATA_YEARS, errors=[])
                sse({'event': 'status', 'msg': f'Starting {total} combinations on {min(multiprocessing.cpu_count()-1,11)} workers...'})
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception as exc:
                try: sse({'event': 'error', 'msg': str(exc)})
                except Exception: pass
                return

            _grid_stop_event.clear()
            csv_path = downloads / 'envelope_grid_results.csv'
            if csv_path.exists():
                csv_path.unlink()
            csv_path.parent.mkdir(parents=True, exist_ok=True)

            all_results = []
            t_start = datetime.datetime.now()
            n_workers = min(multiprocessing.cpu_count() - 1, total, 11)

            try:
                with open(csv_path, 'w', newline='', encoding='utf-8') as csv_f:
                    writer = csv.DictWriter(csv_f, fieldnames=RESULT_COLS)
                    writer.writeheader()
                    csv_f.flush()

                    with ProcessPoolExecutor(
                        max_workers=n_workers,
                        initializer=_worker_init,
                        initargs=(raw_dfs, stocks_meta, sim_start, sim_end),
                    ) as executor:
                        futures = {executor.submit(_worker_run_combo, c): c for c in all_combos}
                        for future in as_completed(futures):
                            if _grid_stop_event.is_set():
                                executor.shutdown(wait=False, cancel_futures=True)
                                break
                            r = future.result()
                            all_results.append(r)
                            writer.writerow({k: r[k] for k in RESULT_COLS})
                            csv_f.flush()

                            done    = len(all_results)
                            elapsed = (datetime.datetime.now() - t_start).total_seconds()
                            eta_s   = (elapsed / done) * (total - done)
                            best    = max(all_results, key=lambda x: x['cagr'])
                            try:
                                sse({
                                    'done': done, 'total': total,
                                    'eta_min': round(eta_s / 60, 1),
                                    **{k: r[k] for k in RESULT_COLS},
                                    'best_cagr':        best['cagr'],
                                    'best_env_pct':     best['env_pct'],
                                    'best_zone_pct':    best['zone_pct'],
                                    'best_alloc_large': best['alloc_large'],
                                    'best_alloc_mid':   best['alloc_mid'],
                                    'best_alloc_small': best['alloc_small'],
                                    'best_exit_mode':   best['exit_mode'],
                                    'best_pyramid':     best['pyramid'],
                                })
                            except (BrokenPipeError, ConnectionResetError):
                                executor.shutdown(wait=False, cancel_futures=True)
                                break
            except Exception as exc:
                try: sse({'event': 'error', 'msg': str(exc)})
                except Exception: pass
                return

            # Finalize: re-sort CSV and write summary MD
            all_results.sort(key=lambda r: r['cagr'], reverse=True)
            with open(csv_path, 'w', newline='', encoding='utf-8') as f:
                w = csv.DictWriter(f, fieldnames=RESULT_COLS)
                w.writeheader()
                for r in all_results:
                    w.writerow({k: r[k] for k in RESULT_COLS})
            if all_results:
                elapsed_min = (datetime.datetime.now() - t_start).total_seconds() / 60
                _write_summary_md(all_results, docs_dir / 'envelope_grid_summary.md', total, elapsed_min)
                print(f'[Grid] Complete — {len(all_results)}/{total} combos in {elapsed_min:.1f}min  '
                      f'best CAGR {all_results[0]["cagr"]:.2f}%', flush=True)

            try:
                sse({'event': 'complete', 'total': total, 'done': len(all_results), 'top10': all_results[:10]})
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_POST(self):
            if self.path == '/api/envelope/grid-search/stop':
                _grid_stop_event.set()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
                return

            if self.path != '/api/envelope_backtest':
                self.send_response(404)
                self.end_headers()
                return

            length = int(self.headers.get('Content-Length', 0))
            try:
                params = json.loads(self.rfile.read(length))
            except Exception:
                self.send_response(400)
                self.end_headers()
                return

            cmd = [
                sys.executable, str(ENVELOPE_BT_SCRIPT),
                '--env-pct',     str(params.get('env_pct',     14)),
                '--alloc-large', str(params.get('alloc_large',  3)),
                '--alloc-mid',   str(params.get('alloc_mid',    2)),
                '--alloc-small', str(params.get('alloc_small',  1)),
                '--entry-band',  str(params.get('entry_band',   1)),
                '--exit-mode',   str(params.get('exit_mode', 'fixed')),
                '--stdout',
            ]
            if params.get('pyramid'):
                cmd.append('--pyramid')

            print(f'[API] envelope_backtest env_pct={params.get("env_pct",14)} '
                  f'exit_mode={params.get("exit_mode","fixed")} pyramid={params.get("pyramid",False)}',
                  flush=True)

            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=300,
                    cwd=str(WORKSPACE),
                )
            except subprocess.TimeoutExpired:
                self.send_response(504)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Backtest timed out (>5 min)'}).encode())
                return

            if result.returncode != 0:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': result.stderr[-2000:]}).encode())
                return

            payload = result.stdout.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(payload)

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
            super().end_headers()

        def log_message(self, fmt, *args):
            pass

    with socketserver.ThreadingTCPServer(('', args.port), NoCacheHandler) as httpd:
        httpd.allow_reuse_address = True
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nServer stopped.')


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    print('\n' + '=' * 60)
    print('  Happy Investing -- Dashboard')
    print('=' * 60)

    if args.serve_only:
        print('  (--serve-only: using existing web/data/)')

    elif args.force or not has_any_data():
        # Blocking: forced refresh, or first-ever run with no data at all
        if args.force:
            print('  [--force] Running full pipeline...')
        else:
            print('  No data found. Running full pipeline (this may take several minutes)...')

        all_steps = _build_pipeline_steps(args)
        if all_steps:
            run_parallel(all_steps)
        run('Copying data to web/data/', [sys.executable, str(BUILD_DATA)])

        print('\n' + '=' * 60)
        print('  Pipeline complete. Dashboard data is up to date.')
        print('=' * 60)

        if args.data_only:
            print('  (--data-only: server not started)')
            return

    elif is_data_fresh_today():
        # Data already generated today — skip pipeline entirely
        print(f'  Data already fresh for today ({datetime.date.today()}). Skipping pipeline.')

        if args.data_only:
            print('  (--data-only: server not started)')
            return

    else:
        # Stale data exists — serve immediately, refresh in background
        print('  Stale data detected. Starting background pipeline...')
        print('  Server will open immediately with existing data.')
        print('  A banner in the browser will show when new data is ready.\n')

        threading.Thread(
            target=run_pipeline_background,
            args=(args, _pipeline_state),
            daemon=True,
        ).start()

        if args.data_only:
            # Wait for background thread before returning
            print('  (--data-only: waiting for background pipeline to finish...)')
            while _pipeline_state.running:
                import time
                time.sleep(2)
            return

    _start_server(args)


if __name__ == '__main__':
    main()

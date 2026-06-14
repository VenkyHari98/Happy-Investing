"""
Reverse Head & Shoulder (RHS) and Cup With Handle (CWH) Pattern Backtest Engine.

F40 + E40 universe (~80 stocks). Daily charts only. No stop-loss.

Buy: green candle body breaks above neckline → buy at next-day open.
Sell: target = neckline + depth_projected_above_neckline.
ABCD: one averaging trade allowed at -10% from entry.
"""

import argparse
import csv
import datetime
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from f40_backtest_common import (
    Trade,
    compute_portfolio_metrics,
    fetch_all_fundamentals_parallel,
    fetch_all_pe_parallel,
    fetch_all_pe_series_parallel,
    fetch_all_stocks_parallel,
    parse_watchlists,
)
import fundamental_config as cfg


# ── Pattern dataclasses ───────────────────────────────────────────────────────

@dataclass
class RHSPattern:
    l_shoulder_date:  str
    l_shoulder_price: float
    head_date:        str
    head_price:       float
    r_shoulder_date:  str
    r_shoulder_price: float
    neckline_price:   float
    breakout_date:    Optional[str]
    breakout_idx:     Optional[int]  # internal — excluded from to_dict
    target_price:     float
    pattern_type:     str = "RHS"

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d.pop("breakout_idx", None)
        return d


@dataclass
class CWHPattern:
    cup_left_date:    str
    cup_left_price:   float
    cup_bottom_date:  str
    cup_bottom_price: float
    cup_right_date:   str
    cup_right_price:  float
    handle_low_date:  str
    handle_low_price: float
    neckline_price:   float
    breakout_date:    Optional[str]
    breakout_idx:     Optional[int]  # internal — excluded from to_dict
    target_price:     float
    pattern_type:     str = "CWH"

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d.pop("breakout_idx", None)
        return d


# ── Local extrema helpers ─────────────────────────────────────────────────────

def find_significant_minima(closes: np.ndarray, window: int = 15, depth_pct: float = 8.0) -> List[int]:
    """Indices of significant local valleys (lower than ±window neighbours, ≥depth_pct% below local high)."""
    n = len(closes)
    result = []
    for i in range(window, n - window):
        seg = closes[i - window : i + window + 1]
        if closes[i] != seg.min():
            continue
        local_high = max(closes[i - window : i + 1].max(), closes[i : i + window + 1].max())
        if closes[i] < local_high * (1.0 - depth_pct / 100.0):
            result.append(i)
    return result


def find_significant_maxima(closes: np.ndarray, window: int = 20, height_pct: float = 8.0) -> List[int]:
    """Indices of significant local peaks (higher than ±window neighbours, ≥height_pct% above local low)."""
    n = len(closes)
    result = []
    for i in range(window, n - window):
        seg = closes[i - window : i + window + 1]
        if closes[i] != seg.max():
            continue
        local_low = min(closes[i - window : i + 1].min(), closes[i : i + window + 1].min())
        if closes[i] > local_low * (1.0 + height_pct / 100.0):
            result.append(i)
    return result


# ── Pattern detectors ─────────────────────────────────────────────────────────

def detect_rhs_patterns(
    df: pd.DataFrame,
    ma200: pd.Series,
    min_pattern_days:          int   = 60,
    max_pattern_days:          int   = 365,
    shoulder_tolerance_pct:    float = 15.0,
    neckline_slope_tolerance:  float = 5.0,
) -> List[RHSPattern]:
    """Detect Reverse Head & Shoulder patterns in a daily price series."""
    closes = df["close"].values.astype(float)
    opens  = df["open"].values.astype(float)
    dates  = [d.strftime("%Y-%m-%d") for d in df.index]
    n      = len(closes)

    minima = find_significant_minima(closes, window=15, depth_pct=8.0)
    patterns: List[RHSPattern] = []
    seen_heads: set = set()

    for k in range(len(minima) - 2):
        li = minima[k]        # left shoulder
        hi = minima[k + 1]   # head
        ri = minima[k + 2]   # right shoulder

        if hi - li < 20 or ri - hi < 20:
            continue
        duration = ri - li
        if not (min_pattern_days <= duration <= max_pattern_days):
            continue

        ls_p   = closes[li]
        head_p = closes[hi]
        rs_p   = closes[ri]

        if head_p >= ls_p or head_p >= rs_p:
            continue
        if abs(ls_p - rs_p) / head_p > shoulder_tolerance_pct / 100.0:
            continue

        # Peaks between troughs → neckline
        peak1_idx = li + int(np.argmax(closes[li : hi + 1]))
        peak2_idx = hi + int(np.argmax(closes[hi : ri + 1]))
        p1, p2    = closes[peak1_idx], closes[peak2_idx]
        neckline  = (p1 + p2) / 2.0
        if abs(p1 - p2) / neckline * 100.0 > neckline_slope_tolerance:
            continue

        # Right shoulder must be at or below 200 DMA
        ma_at_rs = float(ma200.iloc[ri]) if not pd.isna(ma200.iloc[ri]) else None
        if ma_at_rs is not None and rs_p > ma_at_rs * 1.05:
            continue

        head_date = dates[hi]
        if head_date in seen_heads:
            continue
        seen_heads.add(head_date)

        depth_ratio = (neckline - head_p) / neckline
        target      = neckline * (1.0 + depth_ratio)

        # Breakout: first green candle body crossing neckline after right shoulder
        bo_idx, bo_date = None, None
        for j in range(ri + 1, min(ri + 120, n)):
            if closes[j] > neckline and opens[j] < neckline:
                bo_idx, bo_date = j, dates[j]
                break

        patterns.append(RHSPattern(
            l_shoulder_date=dates[li],  l_shoulder_price=round(ls_p,   2),
            head_date=dates[hi],         head_price=round(head_p, 2),
            r_shoulder_date=dates[ri],  r_shoulder_price=round(rs_p,   2),
            neckline_price=round(neckline, 2),
            breakout_date=bo_date,       breakout_idx=bo_idx,
            target_price=round(target,  2),
        ))

    return patterns


def detect_cwh_patterns(
    df: pd.DataFrame,
    ma200: pd.Series,
    min_cup_days:          int   = 60,
    max_cup_days:          int   = 365,
    min_cup_depth_pct:     float = 15.0,
    handle_max_retrace_pct: float = 50.0,
) -> List[CWHPattern]:
    """Detect Cup With Handle patterns in a daily price series."""
    closes = df["close"].values.astype(float)
    opens  = df["open"].values.astype(float)
    dates  = [d.strftime("%Y-%m-%d") for d in df.index]
    n      = len(closes)

    maxima = find_significant_maxima(closes, window=20, height_pct=8.0)
    patterns: List[CWHPattern] = []
    seen_lefts: set = set()

    for left_idx in maxima:
        cup_left_p = closes[left_idx]

        # Find cup bottom (minimum in reasonable search range)
        s_start = left_idx + 15
        s_end   = min(left_idx + int(max_cup_days * 0.65), n - 40)
        if s_end <= s_start + 10:
            continue

        bot_offset = int(np.argmin(closes[s_start:s_end]))
        bot_idx    = s_start + bot_offset
        bot_p      = closes[bot_idx]

        cup_depth = (cup_left_p - bot_p) / cup_left_p * 100.0
        if cup_depth < min_cup_depth_pct:
            continue

        ma_at_bot = float(ma200.iloc[bot_idx]) if not pd.isna(ma200.iloc[bot_idx]) else None
        if ma_at_bot is not None and bot_p > ma_at_bot * 1.05:
            continue

        # Cup right rim: first recovery to within 8% of left rim
        rim_thresh  = cup_left_p * 0.92
        right_idx, right_p = None, None
        for j in range(bot_idx + 10, min(left_idx + max_cup_days, n - 20)):
            if closes[j] >= rim_thresh:
                right_idx, right_p = j, closes[j]
                break
        if right_idx is None:
            continue

        cup_dur = right_idx - left_idx
        if not (min_cup_days <= cup_dur <= max_cup_days):
            continue

        # U-shape: at least 15% of cup time in bottom third of price range
        pr  = cup_left_p - bot_p
        bot3_thresh = bot_p + pr * 0.33
        days_bot = sum(1 for k in range(left_idx, right_idx + 1) if closes[k] < bot3_thresh)
        if days_bot < cup_dur * 0.15:
            continue

        left_key = dates[left_idx]
        if left_key in seen_lefts:
            continue
        seen_lefts.add(left_key)

        # Handle: small pullback after right rim
        h_start = right_idx + 1
        h_end   = min(right_idx + 60, n - 5)
        if h_end <= h_start:
            continue

        hl_offset = int(np.argmin(closes[h_start:h_end]))
        hl_idx    = h_start + hl_offset
        hl_p      = closes[hl_idx]

        handle_decline = (right_p - hl_p) / right_p * 100.0
        if not (3.0 <= handle_decline <= 35.0):
            continue

        max_allowed = bot_p + pr * (1.0 - handle_max_retrace_pct / 100.0)
        if hl_p < max_allowed:
            continue

        neckline    = cup_left_p
        depth_ratio = (cup_left_p - bot_p) / cup_left_p
        target      = cup_left_p * (1.0 + depth_ratio)

        bo_idx, bo_date = None, None
        for j in range(hl_idx + 1, min(hl_idx + 90, n)):
            if closes[j] > neckline and opens[j] < neckline:
                bo_idx, bo_date = j, dates[j]
                break

        patterns.append(CWHPattern(
            cup_left_date=dates[left_idx],  cup_left_price=round(cup_left_p, 2),
            cup_bottom_date=dates[bot_idx], cup_bottom_price=round(bot_p,    2),
            cup_right_date=dates[right_idx], cup_right_price=round(right_p,  2),
            handle_low_date=dates[hl_idx],  handle_low_price=round(hl_p,     2),
            neckline_price=round(neckline, 2),
            breakout_date=bo_date,           breakout_idx=bo_idx,
            target_price=round(target, 2),
        ))

    return patterns


# ── Simulation engine ─────────────────────────────────────────────────────────

def simulate_rhs_cwh_strategy(
    df: pd.DataFrame,
    ticker: str,
    cap_tier: str,
    sector: str,
    rhs_patterns: List[RHSPattern],
    cwh_patterns: List[CWHPattern],
    portfolio_value: float = 100_000.0,
    allocation_pct:  float = 0.05,
    slippage_pct:    float = 0.10,
    pe_series:       Optional[pd.Series] = None,
    pe_5yr_median:   Optional[pd.Series] = None,
    fund_metrics:    Optional[Dict]       = None,
) -> Tuple[List[Trade], List[Dict[str, Any]], Dict[str, int], List[Dict[str, Any]]]:
    """
    Simulate RHS/CWH trades on pre-detected patterns. One position at a time.
    One ABCD averaging trade allowed when price falls ≥10% from entry.
    """
    trades:  List[Trade]         = []
    skipped: List[Dict[str, Any]] = []
    fstats   = {k: 0 for k in ("blocked_200dma", "blocked_pe", "blocked_pe_5yr_median", "blocked_phase2", "entries_taken")}

    closes = df["close"].values.astype(float)
    highs  = df["high"].values.astype(float)
    opens  = df["open"].values.astype(float)
    dates  = [d.strftime("%Y-%m-%d") for d in df.index]
    n      = len(df)
    ma200v = df["close"].rolling(200, min_periods=200).mean().values

    pe_dict:     Dict[str, float] = {}
    pe_med_dict: Dict[str, float] = {}
    if pe_series is not None:
        pe_dict     = {ts.strftime("%Y-%m-%d"): float(v) for ts, v in pe_series.dropna().items()}
    if pe_5yr_median is not None:
        pe_med_dict = {ts.strftime("%Y-%m-%d"): float(v) for ts, v in pe_5yr_median.dropna().items()}

    # Build entry map: buy_day_idx → first pattern with that breakout+1
    entry_map: Dict[int, Any] = {}
    for pat in rhs_patterns + cwh_patterns:  # type: ignore[operator]
        if pat.breakout_idx is not None:
            buy_idx = pat.breakout_idx + 1
            if buy_idx < n and buy_idx not in entry_map:
                entry_map[buy_idx] = pat

    open_pos:  Optional[Dict[str, Any]] = None
    abcd_done: bool = False

    for i in range(1, n):
        date  = dates[i]
        high  = highs[i]
        close = closes[i]
        op    = opens[i]

        # ── Exit / ABCD ──
        if open_pos is not None:
            if high >= open_pos["exit_target"]:
                ep  = open_pos["exit_target"]
                ev  = open_pos["shares"] * ep
                sl  = ev * (slippage_pct / 100.0)
                gpnl = ev - open_pos["entry_value"]
                npnl = gpnl - open_pos["slippage_buy"] - sl
                dur  = (datetime.datetime.strptime(date, "%Y-%m-%d")
                        - datetime.datetime.strptime(open_pos["entry_date"], "%Y-%m-%d")).days
                trades.append(Trade(
                    stock_ticker=ticker, cap_tier=cap_tier, sector=sector,
                    entry_date=open_pos["entry_date"], entry_price=open_pos["entry_price"],
                    exit_date=date, exit_price=ep,
                    trade_duration_days=dur,
                    shares=open_pos["shares"],
                    allocation_pct=allocation_pct, portfolio_value=portfolio_value,
                    entry_value=open_pos["entry_value"], exit_value=ev,
                    gross_pnl=gpnl, pnl_pct=npnl / open_pos["entry_value"] * 100.0,
                    slippage_loss=open_pos["slippage_buy"] + sl, net_pnl=npnl,
                    exit_reason=f"{open_pos['pattern_type']}_TARGET",
                ))
                open_pos  = None
                abcd_done = False

            elif not abcd_done and close < open_pos["entry_price"] * 0.90:
                ma_val = ma200v[i]
                if not (cfg.REQUIRE_BELOW_200DMA and (np.isnan(ma_val) or close >= ma_val)):
                    abcd_shares = (portfolio_value * allocation_pct * 0.5) / close
                    abcd_val    = abcd_shares * close
                    sl_buy      = abcd_val * (slippage_pct / 100.0)
                    total_sh    = open_pos["shares"] + abcd_shares
                    total_val   = open_pos["entry_value"] + abcd_val
                    open_pos["shares"]       = total_sh
                    open_pos["entry_value"]  = total_val
                    open_pos["slippage_buy"] += sl_buy
                    open_pos["entry_price"]  = total_val / total_sh
                    abcd_done = True

        # ── Entry ──
        if open_pos is None and i in entry_map:
            pat   = entry_map[i]
            ep    = op if op > 0 else close
            ma_val = ma200v[i]

            if cfg.REQUIRE_BELOW_200DMA and (np.isnan(ma_val) or ep >= ma_val):
                fstats["blocked_200dma"] += 1
                skipped.append({"date": date, "price": round(ep, 2), "reason": "above_200dma", "pattern_type": pat.pattern_type})
                continue

            if pe_dict:
                pev = pe_dict.get(date)
                if pev is not None:
                    if pev > cfg.PE_MAX:
                        fstats["blocked_pe"] += 1
                        skipped.append({"date": date, "price": round(ep, 2), "reason": f"pe>{cfg.PE_MAX}", "pattern_type": pat.pattern_type})
                        continue
                    if cfg.PE_BELOW_5YR_MEDIAN and pe_med_dict:
                        med = pe_med_dict.get(date)
                        if med is not None and pev >= med:
                            fstats["blocked_pe_5yr_median"] += 1
                            skipped.append({"date": date, "price": round(ep, 2), "reason": "pe>5yr_med", "pattern_type": pat.pattern_type})
                            continue

            if fund_metrics is not None:
                p2_pass, _ = cfg.apply_fundamental_filter_phase2(fund_metrics, at_date=date)
                if not p2_pass:
                    fstats["blocked_phase2"] += 1
                    skipped.append({"date": date, "price": round(ep, 2), "reason": "phase2_fail", "pattern_type": pat.pattern_type})
                    continue

            fstats["entries_taken"] += 1
            shares   = (portfolio_value * allocation_pct) / ep
            ev_entry = shares * ep
            open_pos = {
                "entry_date":   date,
                "entry_price":  ep,
                "exit_target":  pat.target_price,
                "shares":       shares,
                "entry_value":  ev_entry,
                "slippage_buy": ev_entry * (slippage_pct / 100.0),
                "pattern_type": pat.pattern_type,
                "neckline":     pat.neckline_price,
                "pattern_start": getattr(pat, "l_shoulder_date", getattr(pat, "cup_left_date", "")),
            }
            abcd_done = False

    # ── Open positions still holding ──
    last_close = float(closes[-1])
    last_date  = dates[-1]
    open_details: List[Dict[str, Any]] = []
    if open_pos is not None:
        days_held = (datetime.datetime.strptime(last_date, "%Y-%m-%d")
                     - datetime.datetime.strptime(open_pos["entry_date"], "%Y-%m-%d")).days
        open_details.append({
            "entry_date":     open_pos["entry_date"],
            "entry_price":    round(open_pos["entry_price"], 2),
            "exit_target":    round(open_pos["exit_target"], 2),
            "neckline":       round(open_pos["neckline"], 2),
            "latest_close":   round(last_close, 2),
            "days_held":      days_held,
            "unrealised_pct": round((last_close - open_pos["entry_price"]) / open_pos["entry_price"] * 100.0, 2),
            "pct_to_target":  round((open_pos["exit_target"] - last_close) / last_close * 100.0, 2),
            "pattern_type":   open_pos["pattern_type"],
        })

    return trades, open_details, fstats, skipped


# ── Price series (for chart rendering) ───────────────────────────────────────

def build_price_series(
    df: pd.DataFrame,
    rhs_patterns: List[RHSPattern],
    cwh_patterns: List[CWHPattern],
    ma_period: int = 200,
) -> List[Dict[str, Any]]:
    closes = df["close"].values.astype(float)
    ma200v = pd.Series(closes).rolling(ma_period, min_periods=ma_period).values

    markers: Dict[str, List[Dict]] = {}

    def _add(date: str, label: str, pt: str, price: float):
        markers.setdefault(date, []).append({"label": label, "pattern_type": pt, "price": round(price, 2)})

    for p in rhs_patterns:
        _add(p.l_shoulder_date, "LS", "RHS", p.l_shoulder_price)
        _add(p.head_date,       "H",  "RHS", p.head_price)
        _add(p.r_shoulder_date, "RS", "RHS", p.r_shoulder_price)
        if p.breakout_date:
            _add(p.breakout_date, "B", "RHS", p.neckline_price)

    for p in cwh_patterns:
        _add(p.cup_left_date,   "CL", "CWH", p.cup_left_price)
        _add(p.cup_bottom_date, "CB", "CWH", p.cup_bottom_price)
        _add(p.cup_right_date,  "CR", "CWH", p.cup_right_price)
        _add(p.handle_low_date, "HL", "CWH", p.handle_low_price)
        if p.breakout_date:
            _add(p.breakout_date, "B", "CWH", p.neckline_price)

    points = []
    for i, (idx, row) in enumerate(df.iterrows()):
        date = idx.strftime("%Y-%m-%d")
        points.append({
            "date":    date,
            "close":   round(float(row["close"]), 2),
            "high":    round(float(row["high"]),  2),
            "low":     round(float(row["low"]),   2),
            "open":    round(float(row["open"]),  2),
            "ma200":   round(float(ma200v[i]), 2) if not np.isnan(ma200v[i]) else None,
            "markers": markers.get(date, []),
        })
    return points


# ── Scanner: current opportunities ───────────────────────────────────────────

def _pattern_status(pat: Any, last_date: str, recent_days: int = 30) -> Optional[str]:
    today = datetime.date.fromisoformat(last_date)
    if pat.breakout_date:
        age = (today - datetime.date.fromisoformat(pat.breakout_date)).days
        return "BREAKOUT" if age <= recent_days else None
    # No breakout — check if pattern formation is recent enough to act on
    if hasattr(pat, "r_shoulder_date"):
        age = (today - datetime.date.fromisoformat(pat.r_shoulder_date)).days
        return "FORMING" if age <= 120 else None
    if hasattr(pat, "handle_low_date"):
        age = (today - datetime.date.fromisoformat(pat.handle_low_date)).days
        return "FORMING" if age <= 60 else None
    return None


def run_scanner(
    watchlist_files,
    output_file: Path,
    scan_years: int = 2,
) -> None:
    """Scan F40+E40 for current RHS/CWH opportunities and write scanner_results.json."""
    output_file.parent.mkdir(parents=True, exist_ok=True)
    stocks = parse_watchlists(watchlist_files)
    print(f"Scanning {len(stocks)} stocks for RHS/CWH patterns ({scan_years}y data)...")

    errors: List[str] = []
    stock_dfs = fetch_all_stocks_parallel(stocks, years=scan_years, errors=errors)

    opportunities: List[Dict[str, Any]] = []
    run_date = datetime.date.today().isoformat()

    for ticker, df in stock_dfs.items():
        if df is None or df.empty or len(df) < 200:
            continue
        cap_tier, sector = stocks[ticker]
        ma200 = df["close"].rolling(200, min_periods=200).mean()
        last_date  = df.index[-1].strftime("%Y-%m-%d")
        last_close = float(df["close"].iloc[-1])

        for pat in detect_rhs_patterns(df, ma200) + detect_cwh_patterns(df, ma200):  # type: ignore[operator]
            status = _pattern_status(pat, last_date)
            if status is None:
                continue

            pct_to_neckline = (pat.neckline_price - last_close) / last_close * 100.0
            rec: Dict[str, Any] = {
                "ticker":          ticker,
                "cap_tier":        cap_tier,
                "sector":          sector,
                "pattern_type":    pat.pattern_type,
                "status":          status,
                "neckline":        pat.neckline_price,
                "current_price":   round(last_close, 2),
                "pct_to_neckline": round(pct_to_neckline, 2),
                "target":          pat.target_price,
                "last_date":       last_date,
                "breakout_date":   pat.breakout_date,
            }
            if isinstance(pat, RHSPattern):
                rec.update({
                    "pattern_start_date": pat.l_shoulder_date,
                    "head_price":         pat.head_price,
                    "r_shoulder_date":    pat.r_shoulder_date,
                    "r_shoulder_price":   pat.r_shoulder_price,
                })
            else:
                rec.update({
                    "pattern_start_date": pat.cup_left_date,
                    "cup_bottom_price":   pat.cup_bottom_price,
                    "handle_low_date":    pat.handle_low_date,
                    "handle_low_price":   pat.handle_low_price,
                })
            opportunities.append(rec)
            print(f"  {ticker} [{pat.pattern_type}] {status}: neckline={pat.neckline_price:.1f} target={pat.target_price:.1f}")

    opportunities.sort(key=lambda x: (0 if x["status"] == "BREAKOUT" else 1, x["pct_to_neckline"]))

    _write_json(output_file, {
        "run_date":       run_date,
        "stocks_scanned": len(stock_dfs),
        "total_found":    len(opportunities),
        "rhs_count":      sum(1 for o in opportunities if o["pattern_type"] == "RHS"),
        "cwh_count":      sum(1 for o in opportunities if o["pattern_type"] == "CWH"),
        "breakout_count": sum(1 for o in opportunities if o["status"] == "BREAKOUT"),
        "forming_count":  sum(1 for o in opportunities if o["status"] == "FORMING"),
        "opportunities":  opportunities,
    })
    print(f"Scanner done: {len(opportunities)} found.")


# ── Full backtest orchestrator ─────────────────────────────────────────────────

def run_backtest(
    watchlist_files,
    output_folder:   Path,
    backtest_years:  int   = 5,
    portfolio_value: float = 100_000.0,
    slippage_pct:    float = 0.10,
) -> None:
    output_folder.mkdir(parents=True, exist_ok=True)
    stocks = parse_watchlists(watchlist_files)
    print(f"Parsed {len(stocks)} stocks")

    allocations = {"Large Cap": 0.05, "Mid Cap": 0.03, "Small Cap": 0.02}
    all_trades: List[Trade] = []
    stock_data_map: Dict[str, Dict[str, Any]] = {}
    errors: List[str] = []
    total_fstats = {k: 0 for k in ("blocked_200dma", "blocked_pe", "blocked_pe_5yr_median", "blocked_phase2", "entries_taken")}

    print(f"Downloading {len(stocks)} stocks ({backtest_years}y)...")
    stock_dfs = fetch_all_stocks_parallel(stocks, years=backtest_years, errors=errors)

    print(f"Fetching current PE for display ({len(stock_dfs)} stocks)...")
    pe_map = fetch_all_pe_parallel(stock_dfs.keys())

    print(f"Fetching historical PE series ({len(stock_dfs)} stocks)...")
    pe_series_map = fetch_all_pe_series_parallel(stock_dfs.keys())
    pe_ok = sum(1 for v in pe_series_map.values() if v[0] is not None)

    print(f"Fetching Phase 2 fundamentals ({len(stock_dfs)} stocks)...")
    fund_map = fetch_all_fundamentals_parallel(stock_dfs.keys())
    fund_ok  = sum(1 for v in fund_map.values() if v is not None)

    for ticker, df in stock_dfs.items():
        if df is None or df.empty or len(df) < 250:
            continue
        cap_tier, sector = stocks[ticker]
        alloc = allocations.get(cap_tier, 0.03)

        ma200 = df["close"].rolling(200, min_periods=200).mean()
        rhs = detect_rhs_patterns(df, ma200)
        cwh = detect_cwh_patterns(df, ma200)

        pe_pair = pe_series_map.get(ticker, (None, None))
        trades, open_pos, fstats, skipped = simulate_rhs_cwh_strategy(
            df, ticker, cap_tier, sector,
            rhs_patterns=rhs, cwh_patterns=cwh,
            portfolio_value=portfolio_value, allocation_pct=alloc,
            slippage_pct=slippage_pct,
            pe_series=pe_pair[0], pe_5yr_median=pe_pair[1],
            fund_metrics=fund_map.get(ticker),
        )
        for k in total_fstats:
            total_fstats[k] += fstats[k]
        print(f"  {ticker}: {len(rhs)} RHS + {len(cwh)} CWH → {len(trades)} trades, {len(open_pos)} open")

        all_trades.extend(trades)
        price_series = build_price_series(df, rhs, cwh)
        pe_c, pe3, pe5 = pe_map.get(ticker, (None, None, None))

        stock_data_map[ticker] = {
            "ticker":          ticker,
            "cap_tier":        cap_tier,
            "sector":          sector,
            "latest_close":    round(float(df["close"].iloc[-1]), 2),
            "latest_date":     df.index[-1].strftime("%Y-%m-%d"),
            "trades_count":    len(trades),
            "total_pnl":       round(sum(t.net_pnl for t in trades), 2),
            "pe_current":      pe_c,
            "pe_3yr_avg":      pe3,
            "pe_5yr_avg":      pe5,
            "rhs_patterns":    [p.to_dict() for p in rhs],
            "cwh_patterns":    [p.to_dict() for p in cwh],
            "open_positions":  open_pos,
            "prices":          price_series,
            "trades":          [t.to_dict() for t in trades],
            "skipped_entries": skipped,
        }

    metrics    = compute_portfolio_metrics(all_trades)
    total_open = sum(len(v["open_positions"]) for v in stock_data_map.values())

    summary = {
        "backtest_date":    datetime.date.today().isoformat(),
        "backtest_years":   backtest_years,
        "portfolio_value":  portfolio_value,
        "slippage_pct":     slippage_pct,
        "total_trades":     len(all_trades),
        "open_positions":   total_open,
        "stocks_tested":    len(stocks),
        "pattern_params": {
            "min_pattern_days":      60,
            "max_pattern_days":      365,
            "shoulder_tolerance_pct": 15.0,
            "neckline_slope_pct":    5.0,
            "min_cup_depth_pct":     15.0,
            "handle_max_retrace_pct": 50.0,
            "require_below_200dma":  cfg.REQUIRE_BELOW_200DMA,
        },
        "metrics": metrics,
        "fundamental_gates": {
            "below_200dma_enforced": cfg.REQUIRE_BELOW_200DMA,
            "pe_max":                cfg.PE_MAX,
            "pe_below_5yr_median":   cfg.PE_BELOW_5YR_MEDIAN,
            "pe_series_available":   pe_ok,
            "phase2_available":      fund_ok,
            **{k: total_fstats[k] for k in total_fstats},
        },
    }

    _write_json(output_folder / "backtest_summary.json", summary)
    _write_json(output_folder / "trades.json", [t.to_dict() for t in all_trades])

    overview = [
        {
            "ticker":       t,
            "cap_tier":     d["cap_tier"],
            "sector":       d["sector"],
            "latest_close": d["latest_close"],
            "latest_date":  d["latest_date"],
            "trades_count": d["trades_count"],
            "total_pnl":    d["total_pnl"],
            "open_count":   len(d["open_positions"]),
            "rhs_count":    len(d["rhs_patterns"]),
            "cwh_count":    len(d["cwh_patterns"]),
        }
        for t, d in stock_data_map.items()
    ]
    _write_json(output_folder / "stock_data.json", {"overview": overview, "stock_data": stock_data_map})

    if all_trades:
        with (output_folder / "trades.csv").open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=all_trades[0].to_dict().keys())
            writer.writeheader()
            for t in all_trades:
                writer.writerow(t.to_dict())

    _write_report(output_folder / "backtest_report.txt", summary, metrics, all_trades, errors)
    print(f"\nBacktest complete: {len(all_trades)} trades, {total_open} open.")


# ── I/O helpers ───────────────────────────────────────────────────────────────

def _write_json(path: Path, data: Any) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"  Saved {path.name}")


def _write_report(path: Path, summary: Dict, metrics: Dict, trades: List[Trade], errors: List[str]) -> None:
    with path.open("w", encoding="utf-8") as f:
        f.write("=" * 80 + "\n")
        f.write("REVERSE HEAD & SHOULDER / CUP WITH HANDLE BACKTEST (F40 + E40)\n")
        f.write("Buy: green candle body crosses neckline → next-day open\n")
        f.write("Sell: target = neckline + depth projected above | No stop-loss\n")
        f.write("=" * 80 + "\n\n")
        f.write(f"Date          : {summary['backtest_date']}\n")
        f.write(f"Data period   : {summary['backtest_years']} years\n")
        f.write(f"Portfolio     : Rs {summary['portfolio_value']:,.0f}\n")
        f.write(f"Slippage      : {summary['slippage_pct']}% per side\n")
        f.write(f"Stocks tested : {summary['stocks_tested']}\n\n")
        f.write("METRICS\n" + "-" * 60 + "\n")
        f.write(f"Completed trades : {metrics['total_trades']}\n")
        f.write(f"Open (holding)   : {summary['open_positions']}\n")
        f.write(f"Win rate         : {metrics['win_rate']:.1f}%\n")
        f.write(f"Avg trade P/L    : {metrics['avg_trade_pnl_pct']:.2f}%\n")
        f.write(f"Best trade       : {metrics['max_gain_pct']:.2f}%\n")
        f.write(f"Worst trade      : {metrics['max_loss_pct']:.2f}%\n")
        f.write(f"Avg duration     : {metrics['avg_trade_duration_days']:.0f} days\n")
        f.write(f"CAGR             : {metrics['cagr']:.2f}%\n")
        f.write(f"Sharpe           : {metrics['sharpe']:.2f}\n")
        g = summary.get("fundamental_gates", {})
        if g:
            f.write("\nFUNDAMENTAL GATES\n" + "-" * 60 + "\n")
            f.write(f"Blocked (200 DMA)     : {g.get('blocked_200dma', 0)}\n")
            f.write(f"Blocked (PE > max)    : {g.get('blocked_pe', 0)}\n")
            f.write(f"Blocked (PE > 5yr med): {g.get('blocked_pe_5yr_median', 0)}\n")
            f.write(f"Blocked (Phase 2)     : {g.get('blocked_phase2', 0)}\n")
            f.write(f"Entries taken         : {g.get('entries_taken', 0)}\n")
        if errors:
            f.write("\nERRORS\n" + "-" * 60 + "\n")
            for e in errors[:20]:
                f.write(f"  {e}\n")


# ── CLI ───────────────────────────────────────────────────────────────────────

def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="RHS / CWH pattern backtest + scanner")
    p.add_argument("--watchlist",      default="Source Data/Watchlist/F40.txt,Source Data/Watchlist/E40.txt")
    p.add_argument("--output",         default="Source Data/Downloaded Data/rhs_cwh_backtest")
    p.add_argument("--years",          type=int,   default=5)
    p.add_argument("--portfolio-value", type=float, default=100_000.0)
    p.add_argument("--slippage",       type=float, default=0.10)
    p.add_argument("--scanner-only",   action="store_true")
    return p


def main() -> None:
    args = build_arg_parser().parse_args()
    wl   = [Path(p.strip()).resolve() for p in args.watchlist.split(",")]
    out  = Path(args.output).resolve()

    if args.scanner_only:
        run_scanner(wl, out / "scanner_results.json")
    else:
        run_backtest(wl, out, backtest_years=args.years,
                     portfolio_value=args.portfolio_value, slippage_pct=args.slippage)
        run_scanner(wl, out / "scanner_results.json")


if __name__ == "__main__":
    main()

"""
portfolio_backtest_engine.py — Shared simulation engine for portfolio-level backtests.

Implements Smart Pyramid tranching: INITIAL → ABCD averaging (weakness)
→ Momentum add when price crosses back above 200 DMA (strength).
All tranches share one cash pool; capital rotates as exits free cash.
"""

import datetime
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np


# ── Allocation constants ───────────────────────────────────────────────────────
# Each value is a FRACTION of current portfolio total value.
# Risk limit per stock (all tranches combined): Large Cap ≤ 5%, Mid Cap ≤ 3%, Small Cap ≤ 1.5%
ALLOCATIONS: Dict[str, Dict[str, Optional[float]]] = {
    'Large Cap': {          # sum = 6.00%
        'INITIAL':  0.0300,
        'ABCD_A':   0.0100,
        'ABCD_B':   0.0075,
        'ABCD_C':   0.0050,
        'ABCD_D':   0.0025,
        'MOMENTUM': 0.0050,
    },
    'Mid Cap': {            # sum = 3.00%
        'INITIAL':  0.0120,
        'ABCD_A':   0.0060,
        'ABCD_B':   0.0045,
        'ABCD_C':   0.0030,
        'ABCD_D':   0.0015,
        'MOMENTUM': 0.0030,
    },
    'Small Cap': {          # sum = 1.50%
        'INITIAL':  0.0060,
        'ABCD_A':   0.0035,
        'ABCD_B':   0.0025,
        'ABCD_C':   0.0015,
        'ABCD_D':   None,
        'MOMENTUM': 0.0015,
    },
}

ABCD_MULTIPLIERS: List[float] = [0.90, 0.81, 0.729, 0.6561]
ABCD_LABELS:      List[str]   = ['ABCD_A', 'ABCD_B', 'ABCD_C', 'ABCD_D']

# Envelope strategy: one position per ticker, INITIAL entry allocation.
ENVELOPE_ALLOCATIONS: Dict[str, float] = {
    'Large Cap':  0.030,
    'Mid Cap':    0.020,
    'Small Cap':  0.010,
}

# ENV_LONG ABCD tranches — averaging down when price falls from ENV_LONG entry.
ENV_LONG_ABCD_ALLOCATIONS: Dict[str, Dict[str, Optional[float]]] = {
    'Large Cap': {          # INITIAL is 3% from ENVELOPE_ALLOCATIONS
        'ABCD_A': 0.0150,
        'ABCD_B': 0.0100,
        'ABCD_C': 0.0075,
        'ABCD_D': 0.0050,
    },
    'Mid Cap': {            # INITIAL is 2%
        'ABCD_A': 0.0100,
        'ABCD_B': 0.0075,
        'ABCD_C': 0.0050,
        'ABCD_D': None,
    },
    'Small Cap': {          # INITIAL is 1%
        'ABCD_A': 0.0050,
        'ABCD_B': 0.0025,
        'ABCD_C': None,
        'ABCD_D': None,
    },
}


# ── Data classes ───────────────────────────────────────────────────────────────

@dataclass
class PortfolioTrade:
    trade_id: str
    strategy: str              # '52W' | 'S200_RALLY'
    ticker: str
    cap_tier: str
    sector: str
    watchlist_source: str
    tranche: str               # 'INITIAL' | 'ABCD_A' | 'ABCD_B' | 'MOMENTUM'
    entry_date: str
    entry_price: float
    exit_target: float
    shares: float
    position_value: float      # nominal ₹ at entry (before slippage)
    exit_date: Optional[str]
    exit_price: Optional[float]
    exit_reason: str           # 'TARGET_HIT' | 'ENV_EXIT' | 'EXPIRED' | 'OPEN'
    trade_duration_days: int
    pnl: Optional[float]
    pnl_pct: Optional[float]
    max_drawdown_pct: float
    # Internal — excluded from JSON output
    _min_close: float = 0.0
    _rally_key: Optional[str] = None   # S200: '{ticker}_{rally_end_date}'

    def to_dict(self) -> dict:
        return {
            'trade_id':            self.trade_id,
            'strategy':            self.strategy,
            'ticker':              self.ticker,
            'cap_tier':            self.cap_tier,
            'sector':              self.sector,
            'watchlist_source':    self.watchlist_source,
            'tranche':             self.tranche,
            'entry_date':          self.entry_date,
            'entry_price':         round(self.entry_price, 2),
            'exit_target':         round(self.exit_target, 2),
            'shares':              round(self.shares, 4),
            'position_value':      round(self.position_value, 2),
            'exit_date':           self.exit_date,
            'exit_price':          round(self.exit_price, 2) if self.exit_price is not None else None,
            'exit_reason':         self.exit_reason,
            'trade_duration_days': self.trade_duration_days,
            'pnl':                 round(self.pnl, 2) if self.pnl is not None else None,
            'pnl_pct':             round(self.pnl_pct, 2) if self.pnl_pct is not None else None,
            'max_drawdown_pct':    round(self.max_drawdown_pct, 2),
        }


@dataclass
class EquityCurvePoint:
    date: str
    total_value: float
    cash: float
    deployed: float
    open_count: int

    def to_dict(self) -> dict:
        return {
            'date':        self.date,
            'total_value': round(self.total_value, 2),
            'cash':        round(self.cash, 2),
            'deployed':    round(self.deployed, 2),
            'open_count':  self.open_count,
        }


# ── Simulator ─────────────────────────────────────────────────────────────────

class PortfolioSimulator:
    def __init__(
        self,
        initial_capital: float = 100_000.0,
        max_concurrent: int = 15,
        max_abcd_depth: int = 2,   # 1 = ABCD_A only, 2 = A + B
        slippage_pct: float = 0.10,
        enforce_capacity: bool = True,
        exit_mode: str = 'fixed',
        # exit_mode='fixed'  : exit_target locked at entry date, never changes.
        # exit_mode='rolling': exit_target ratchets UP whenever the stock makes
        #   a new rolling 252-day high while held — never drops below the initial
        #   fixed target. Identical to fixed for most trades; differs when a stock
        #   breaks out to new highs, letting winners run further.
        # enforce_capacity=False: every valid signal fires regardless of position
        # count or available cash — use for individual strategy backtests.
        # enforce_capacity=True: respect max_concurrent and cash limits — use
        # only when running a combined multi-strategy portfolio.
    ):
        self.initial_capital  = initial_capital
        self.cash             = initial_capital
        self.max_concurrent   = max_concurrent
        self.max_abcd_depth   = max_abcd_depth
        self._slip            = slippage_pct / 100.0
        self.enforce_capacity = enforce_capacity
        self.exit_mode        = exit_mode

        self.open_positions: List[PortfolioTrade]   = []
        self.closed_trades:  List[PortfolioTrade]   = []
        self.equity_curve:   List[EquityCurvePoint] = []
        self._last_prices:   Dict[str, float]       = {}

    # ── Portfolio value ───────────────────────────────────────────────────────

    @property
    def current_total_value(self) -> float:
        """End-of-previous-day equity (or initial capital on day 1)."""
        return self.equity_curve[-1].total_value if self.equity_curve else self.initial_capital

    # ── Position sizing ───────────────────────────────────────────────────────

    def target_size(self, cap_tier: str, tranche: str) -> float:
        """Target ₹ to deploy. 0.0 if tranche not applicable for this tier."""
        pct = ALLOCATIONS.get(cap_tier, ALLOCATIONS['Mid Cap']).get(tranche, 0.0)
        if not pct:
            return 0.0
        return self.current_total_value * pct

    def shares_for(self, position_value: float, fill: float) -> float:
        """Correct share count: accounts for entry slippage so equity tracks cash exactly."""
        return position_value / (fill * (1 + self._slip))

    def can_open(self, cap_tier: str, tranche: str) -> bool:
        size = self.target_size(cap_tier, tranche)
        if not size:
            return False
        if not self.enforce_capacity:
            return True
        return self.cash >= size * (1 + self._slip)

    # ── Open / close ─────────────────────────────────────────────────────────

    def open_position(self, trade: PortfolioTrade) -> None:
        self.cash -= trade.position_value * (1 + self._slip)
        self.open_positions.append(trade)

    def close_position(
        self, trade: PortfolioTrade, exit_date: str, exit_price: float, exit_reason: str
    ) -> None:
        proceeds  = trade.shares * exit_price * (1 - self._slip)
        cost      = trade.position_value * (1 + self._slip)   # actual cash paid at entry
        entry_dt  = datetime.date.fromisoformat(trade.entry_date)
        exit_dt   = datetime.date.fromisoformat(exit_date)

        trade.exit_date           = exit_date
        trade.exit_price          = round(exit_price, 2)
        trade.exit_reason         = exit_reason
        trade.trade_duration_days = (exit_dt - entry_dt).days
        trade.pnl                 = round(proceeds - cost, 2)
        trade.pnl_pct             = round(trade.pnl / cost * 100, 2) if cost else None

        self.cash           += proceeds
        self.open_positions  = [p for p in self.open_positions if p is not trade]
        self.closed_trades.append(trade)

    # ── ABCD levels ───────────────────────────────────────────────────────────

    def abcd_levels(self, anchor: float) -> List[Tuple[str, float]]:
        return [
            (ABCD_LABELS[i], round(anchor * ABCD_MULTIPLIERS[i], 2))
            for i in range(min(self.max_abcd_depth, len(ABCD_LABELS)))
        ]

    # ── Tranche membership ────────────────────────────────────────────────────

    def open_depth(self, ticker: str, rally_key: Optional[str] = None) -> set:
        """Return set of tranche names currently open for this (ticker, rally_key)."""
        return {
            p.tranche for p in self.open_positions
            if p.ticker == ticker
            and (rally_key is None or p._rally_key == rally_key)
        }

    def has_initial(self, ticker: str, rally_key: Optional[str] = None) -> bool:
        return 'INITIAL' in self.open_depth(ticker, rally_key)

    def get_initial(self, ticker: str, rally_key: Optional[str] = None) -> Optional[PortfolioTrade]:
        for p in self.open_positions:
            if (p.ticker == ticker and p.tranche == 'INITIAL'
                    and (rally_key is None or p._rally_key == rally_key)):
                return p
        return None

    def get_env_long_initial(self, ticker: str) -> Optional[PortfolioTrade]:
        for p in self.open_positions:
            if p.ticker == ticker and p.strategy == 'ENV_LONG' and p.tranche == 'INITIAL':
                return p
        return None

    # ── Envelope helpers ──────────────────────────────────────────────────────

    def has_strategy_position(self, ticker: str, strategy: str) -> bool:
        return any(p.ticker == ticker and p.strategy == strategy
                   for p in self.open_positions)

    def open_count_for_strategy(self, ticker: str, strategy: str) -> int:
        return sum(1 for p in self.open_positions
                   if p.ticker == ticker and p.strategy == strategy)

    def get_open_by_strategy(self, ticker: str, strategy: str) -> 'List[PortfolioTrade]':
        return [p for p in self.open_positions
                if p.ticker == ticker and p.strategy == strategy]

    def can_open_raw(self, size: float) -> bool:
        """Cash-only check — no concurrent-count gate. Used for envelope entries."""
        return not self.enforce_capacity or self.cash >= size * (1 + self._slip)

    # ── Daily tracking ────────────────────────────────────────────────────────

    def update_drawdown(self, ticker: str, close: float) -> None:
        for pos in self.open_positions:
            if pos.ticker != ticker:
                continue
            if pos._min_close == 0.0:
                pos._min_close = close
            else:
                pos._min_close = min(pos._min_close, close)
            dd = (pos._min_close - pos.entry_price) / pos.entry_price * 100
            pos.max_drawdown_pct = round(dd, 2)

    def record_equity_point(self, date: str, close_prices: Dict[str, float]) -> None:
        deployed = sum(
            pos.shares * (close_prices.get(pos.ticker)
                          or self._last_prices.get(pos.ticker)
                          or pos.entry_price)
            for pos in self.open_positions
        )
        self.equity_curve.append(EquityCurvePoint(
            date=date,
            total_value=round(self.cash + deployed, 2),
            cash=round(self.cash, 2),
            deployed=round(deployed, 2),
            open_count=len(self.open_positions),
        ))
        self._last_prices.update(close_prices)

    # ── Rolling ratchet: raise exit targets on new highs ─────────────────────

    def update_exit_targets(self, ticker: str, rolling_high: float) -> None:
        """Raise exit_target for all open positions on ticker if rolling_high exceeds it.

        Called each simulation day before the exit check.  Only active in
        exit_mode='rolling'; no-op in 'fixed' mode.  Target never drops.
        """
        if self.exit_mode != 'rolling':
            return
        for pos in self.open_positions:
            if pos.ticker == ticker and rolling_high > pos.exit_target:
                pos.exit_target = round(rolling_high, 2)

    # ── End-of-sim: mark remaining open positions ─────────────────────────────

    def mark_open_positions(self, sim_end_date: str) -> None:
        """Tag all still-open positions as OPEN with unrealised P/L at last known price."""
        end_dt = datetime.date.fromisoformat(sim_end_date)
        for pos in list(self.open_positions):
            last_price = self._last_prices.get(pos.ticker, pos.entry_price)
            proceeds   = pos.shares * last_price * (1 - self._slip)
            cost       = pos.position_value * (1 + self._slip)
            entry_dt   = datetime.date.fromisoformat(pos.entry_date)

            pos.exit_date           = sim_end_date
            pos.exit_price          = round(last_price, 2)
            pos.exit_reason         = 'OPEN'
            pos.trade_duration_days = (end_dt - entry_dt).days
            pos.pnl                 = round(proceeds - cost, 2)
            pos.pnl_pct             = round(pos.pnl / cost * 100, 2) if cost else None
            self.closed_trades.append(pos)
        self.open_positions.clear()


# ── XIRR ──────────────────────────────────────────────────────────────────────

def compute_xirr(
    cashflows: List[Tuple[datetime.date, float]],
    max_iter: int = 500,
    tol: float = 1e-8,
) -> Optional[float]:
    """Newton-Raphson XIRR. Outflows negative, inflows positive."""
    if len(cashflows) < 2:
        return None
    t0      = cashflows[0][0]
    t_yrs   = [(cf[0] - t0).days / 365.25 for cf in cashflows]
    amounts = [cf[1] for cf in cashflows]

    def npv(r: float) -> float:
        return sum(a / (1 + r) ** t for a, t in zip(amounts, t_yrs))

    def d_npv(r: float) -> float:
        return sum(-t * a / (1 + r) ** (t + 1) for a, t in zip(amounts, t_yrs))

    r = 0.10
    for _ in range(max_iter):
        f, df = npv(r), d_npv(r)
        if abs(df) < 1e-12:
            break
        r_new = max(-0.9999, min(100.0, r - f / df))
        if abs(r_new - r) < tol:
            r = r_new
            break
        r = r_new

    result = round(r * 100, 2)
    return result if -99 < result < 10_000 else None


# ── Portfolio metrics ──────────────────────────────────────────────────────────

def compute_portfolio_metrics(
    sim: PortfolioSimulator,
    sim_start: datetime.date,
    sim_end: datetime.date,
) -> dict:
    all_trades = sim.closed_trades
    completed  = [t for t in all_trades if t.exit_reason in ('TARGET_HIT', 'ENV_EXIT')]
    expired    = [t for t in all_trades if t.exit_reason == 'EXPIRED']
    open_end   = [t for t in all_trades if t.exit_reason == 'OPEN']

    eq      = sim.equity_curve
    initial = sim.initial_capital
    final   = eq[-1].total_value if eq else initial

    years            = max((sim_end - sim_start).days / 365.25, 0.01)
    total_return_pct = (final - initial) / initial * 100
    cagr             = (((final / initial) ** (1 / years)) - 1) * 100

    xirr = compute_xirr([(sim_start, -initial), (sim_end, final)])

    peak = initial
    max_dd = 0.0
    for pt in eq:
        if pt.total_value > peak:
            peak = pt.total_value
        dd = (peak - pt.total_value) / peak * 100
        if dd > max_dd:
            max_dd = dd

    n_days = len(eq)
    days_in = sum(1 for pt in eq if pt.open_count > 0)
    time_in_market = days_in / n_days * 100 if n_days else 0.0

    wins     = [t for t in completed if (t.pnl or 0) > 0]
    win_rate = len(wins) / len(completed) * 100 if completed else 0.0
    avg_dur  = float(np.mean([t.trade_duration_days for t in completed])) if completed else 0.0
    avg_pnl  = float(np.mean([t.pnl_pct for t in completed if t.pnl_pct is not None])) if completed else 0.0

    # Per-year returns
    yearly: Dict[str, float] = {}
    for year in sorted({pt.date[:4] for pt in eq}):
        pts = [pt for pt in eq if pt.date.startswith(year)]
        if pts:
            yearly[year] = round(
                (pts[-1].total_value - pts[0].total_value) / pts[0].total_value * 100, 2
            )

    # Per cap tier
    by_tier: Dict[str, dict] = {}
    for tier in ('Large Cap', 'Mid Cap', 'Small Cap'):
        tc = [t for t in completed if t.cap_tier == tier]
        tw = [t for t in tc if (t.pnl or 0) > 0]
        by_tier[tier] = {
            'count':       len(tc),
            'wins':        len(tw),
            'win_rate_pct': round(len(tw) / len(tc) * 100, 1) if tc else None,
            'avg_pnl_pct':  round(float(np.mean([t.pnl_pct for t in tc
                                                  if t.pnl_pct is not None])), 2) if tc else None,
        }

    return {
        'initial_capital':        initial,
        'final_value':            round(final, 2),
        'total_return_pct':       round(total_return_pct, 2),
        'cagr_pct':               round(cagr, 2),
        'xirr_pct':               xirr,
        'total_trades':           len(completed),
        'total_expired':          len(expired),
        'open_at_end':            len(open_end),
        'wins':                   len(wins),
        'win_rate_pct':           round(win_rate, 1),
        'avg_trade_duration_days': round(avg_dur, 1),
        'avg_trade_pnl_pct':      round(avg_pnl, 2),
        'max_drawdown_pct':       round(max_dd, 2),
        'time_in_market_pct':     round(time_in_market, 1),
        'yearly_returns':         yearly,
        'by_cap_tier':            by_tier,
    }

import datetime
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import yfinance as yf


@dataclass
class Trade:
    stock_ticker: str
    cap_tier: str
    sector: str
    entry_date: str
    entry_price: float
    exit_date: str
    exit_price: float
    trade_duration_days: int
    shares: float
    allocation_pct: float
    portfolio_value: float
    entry_value: float
    exit_value: float
    gross_pnl: float
    pnl_pct: float
    slippage_loss: float
    net_pnl: float
    exit_reason: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def parse_f40_watchlist(path: Path) -> Dict[str, Tuple[str, str]]:
    """Parse F40.txt and return dict of {ticker: (cap_tier, sector)}.

    Handles two formats:
    1. Semicolon-delimited: Ticker;CapTier;Sector
    2. Simple list: one ticker per line
    """
    stocks: Dict[str, Tuple[str, str]] = {}
    if not path.exists():
        raise FileNotFoundError(f"F40 watchlist not found: {path}")

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            if ";" in line:
                parts = line.split(";")
                if len(parts) < 3:
                    continue
                ticker = parts[0].strip()
                cap = parts[1].strip()
                sector = parts[2].strip()
                if ticker and cap and sector and ticker.upper() != "TICKER":
                    stocks[ticker] = (cap, sector)
            else:
                ticker = line.strip()
                if ticker and ticker.upper() != "TICKER":
                    stocks[ticker] = ("Mid Cap", "Unknown")
    return stocks


def fetch_historical_data(
    ticker: str, years: int = 10, errors: Optional[List[str]] = None
) -> Optional[pd.DataFrame]:
    """Fetch historical daily OHLCV data from yfinance."""
    if errors is None:
        errors = []

    for symbol in (f"{ticker}.NS", f"{ticker}.BO"):
        try:
            t = yf.Ticker(symbol)
            df = t.history(period=f"{years}y", interval="1d", auto_adjust=True)
            if df is None or df.empty:
                continue
            if df["Close"].isna().all():
                continue
            df.index.name = "Date"
            df.columns = [c.lower() for c in df.columns]
            df = df[["open", "high", "low", "close", "volume"]].copy()
            df = df.dropna(subset=["close"])
            return df
        except Exception as ex:
            errors.append(f"{ticker} ({symbol}): {ex}")
            continue

    errors.append(f"{ticker}: no data from yfinance (NSE or BSE)")
    return None


def compute_rolling_52w(prices: pd.Series, window: int = 252) -> Tuple[pd.Series, pd.Series]:
    if isinstance(prices, np.ndarray):
        prices = pd.Series(prices)
    rolling_high = prices.rolling(window=window, min_periods=1).max()
    rolling_low = prices.rolling(window=window, min_periods=1).min()
    return rolling_high, rolling_low


def compute_portfolio_metrics(trades: List[Trade]) -> Dict[str, Any]:
    if not trades:
        return {
            "total_trades": 0,
            "winning_trades": 0,
            "losing_trades": 0,
            "win_rate": 0.0,
            "total_pnl": 0.0,
            "avg_trade_pnl_pct": 0.0,
            "max_gain_pct": 0.0,
            "max_loss_pct": 0.0,
            "avg_trade_duration_days": 0,
            "cagr": 0.0,
            "sharpe": 0.0,
            "max_drawdown": 0.0,
        }

    pnl_pcts = [t.pnl_pct for t in trades]
    winning = len([p for p in pnl_pcts if p > 0])
    losing = len([p for p in pnl_pcts if p < 0])
    total_pnl = sum([t.net_pnl for t in trades])
    avg_pnl_pct = np.mean(pnl_pcts) if pnl_pcts else 0.0
    max_gain = max(pnl_pcts) if pnl_pcts else 0.0
    max_loss = min(pnl_pcts) if pnl_pcts else 0.0
    avg_duration = np.mean([t.trade_duration_days for t in trades]) if trades else 0

    if len(trades) > 1:
        first_date = datetime.datetime.strptime(trades[0].entry_date, "%Y-%m-%d")
        last_date = datetime.datetime.strptime(trades[-1].exit_date, "%Y-%m-%d")
        days_elapsed = (last_date - first_date).days
        years_elapsed = max(days_elapsed / 365.25, 0.1)
        base_portfolio_value = trades[0].portfolio_value
        total_return = total_pnl / base_portfolio_value
        cagr = (((1 + total_return) ** (1 / years_elapsed)) - 1) * 100.0
    else:
        cagr = 0.0

    if len(pnl_pcts) > 1:
        sharpe = (np.mean(pnl_pcts) / (np.std(pnl_pcts) + 1e-6)) * np.sqrt(252)
    else:
        sharpe = 0.0

    max_dd = abs(min(pnl_pcts)) if pnl_pcts else 0.0

    return {
        "total_trades": len(trades),
        "winning_trades": winning,
        "losing_trades": losing,
        "win_rate": (winning / len(trades)) * 100.0 if trades else 0.0,
        "total_pnl": total_pnl,
        "avg_trade_pnl_pct": avg_pnl_pct,
        "max_gain_pct": max_gain,
        "max_loss_pct": max_loss,
        "avg_trade_duration_days": avg_duration,
        "cagr": cagr,
        "sharpe": sharpe,
        "max_drawdown": max_dd,
    }

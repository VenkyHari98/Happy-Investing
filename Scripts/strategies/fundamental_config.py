import bisect

# fundamental_config.py
# ============================================================
# FUNDAMENTAL SCREENING CONFIGURATION
# Edit this file to adjust filters based on current market conditions.
# Loaded at runtime by all strategy and scanner scripts.
# ============================================================

# ============================================================
# SECTION 1 — TECHNICAL ENTRY GATE (MUST HAVE)
# ============================================================

# Never buy above 200 DMA
REQUIRE_BELOW_200DMA: bool = True

# ============================================================
# SECTION 2 — VALUATION (MUST HAVE)
# ============================================================

PE_MAX: float = 70.0           # Hard ceiling on TTM PE
PE_BELOW_5YR_MEDIAN: bool = True   # TTM PE must be < 5-year median PE
PE_BELOW_10YR_MEDIAN: bool = False # Good to have — set True to make mandatory

# ============================================================
# SECTION 3 — BALANCE SHEET (MUST HAVE)
# ============================================================

# Minimum market cap — universe filter; stocks below this are too small to trade
MIN_MARKET_CAP_CR: float = 3000.0

# Net Debt / Equity — skip for banks/NBFCs (use ROE instead)
MAX_NET_DEBT_TO_EQUITY: float = 0.25

MIN_ROCE: float = 15.0         # Non-financial companies
MIN_ROE: float = 15.0          # Banks / NBFCs (used when ROCE not applicable)

# Sectors treated as financial (use ROE instead of ROCE, skip net D/E + OPM checks)
# Matched against both yfinance 'sector' and 'industry' fields (case-insensitive substring)
FINANCIAL_SECTORS: list = [
    "Bank", "NBFC", "Insurance", "Microfinance", "Housing Finance",
    "Financial Services", "Financial", "Capital Markets",
    "Diversified Financial", "Consumer Finance",
]

MIN_TTM_NET_PROFIT_CR: float = 250.0   # TTM Net Profit > 250 crore

# ============================================================
# SECTION 4 — GOVERNANCE (MUST HAVE)
# ============================================================

# Promoter must hold > 70%, i.e., public (non-promoter) shareholding < 30%
MAX_PUBLIC_SHAREHOLDING_PCT: float = 30.0

# Pledged shares must be < 5% of promoter holding.
# Gate is enforced whenever pledged_pct is available in the metrics dict;
# silently skipped when None (yfinance does not provide this — needs Screener.in).
MAX_PLEDGED_PCT: float = 5.0

# ============================================================
# SECTION 5 — BUSINESS QUALITY (MUST HAVE)
# ============================================================

# Sales near all-time high: TTM Sales >= 90% of peak Sales in last 10 years
MIN_SALES_VS_ATH_PCT: float = 90.0

# Profit near all-time high: TTM Net Profit >= 90% of peak Net Profit in last 10 years
# A stock can skip this if it passes the Asset Growth Criteria below
MIN_PROFIT_VS_ATH_PCT: float = 90.0

# OPM must be stable or improving (not declining over last 3 annual periods)
REQUIRE_OPM_NON_DECLINING: bool = True

# ============================================================
# SECTION 6 — ASSET GROWTH CRITERIA
# (Alternative pass for stocks that fail the Profit ATH test)
# ============================================================
# Tangible Fixed Assets (TFA) = Fixed Assets - Intangible Assets
# TFA (latest) >= 90% of highest TFA in last 10 years
MIN_TFA_VS_ATH_PCT: float = 90.0

# ============================================================
# SECTION 7 — GOOD TO HAVE (used for scoring, not hard filters)
# ============================================================

# Valuation multiples below historical median
GTH_MKTCAP_SALES_BELOW_MEDIAN: bool = True
GTH_EV_EBITDA_BELOW_MEDIAN: bool = True

# Price CAGR should lag Profit CAGR (stock cheap relative to earnings growth)
GTH_1YR_PRICE_CAGR_VS_PROFIT: bool = True
GTH_3YR_PRICE_CAGR_VS_PROFIT: bool = True

# Price-to-Book < 0.4 — deep value signal
GTH_PB_MAX: float = 0.4

# Prefer stocks deeper below 200 DMA (used for opportunity scoring/ranking)
GTH_PREFER_DEEPER_FALL: bool = True

# ============================================================
# SECTION 8 — WATCHOUT FLAGS (printed as warnings, not hard blocks)
# ============================================================

# Warn if interest expense is rising faster than operating profit
WARN_RISING_INTEREST: bool = True

# Warn if exceptional items are significant (>10% of net profit)
WARN_EXCEPTIONAL_INCOME_PCT: float = 10.0

# Warn if effective tax rate is anomalous (deferred tax manipulation signal)
WARN_ANOMALOUS_TAX_RATE: bool = True

# Warn if stock is trading below book value (potential deep value OR value trap)
WARN_BELOW_BOOK_VALUE: bool = True

# ============================================================
# SECTION 9 — DATA AVAILABILITY NOTES
# ============================================================
# AVAILABLE TODAY (yfinance):
#   PE current, 3yr avg, 5yr avg
#   Price OHLCV (fall from 52W high, 200 DMA, price CAGR)
#
# WIRED IN FILTER — GATE ACTIVE WHEN DATA IS PRESENT:
#   ROCE, ROE, Net Debt/Equity, Net Profit (TTM + 10yr history) — from yfinance
#   Sales (TTM + 10yr history for ATH check) — from yfinance
#   OPM (quarterly/annual trend) — from yfinance
#   Pledged % of promoter holding — gate wired; data needs Screener.in
#
# REQUIRES SCREENER.IN INTEGRATION (gate wired, data feed pending):
#   Pledged %, Public Shareholding %
#   Fixed Assets, Intangible Assets (for TFA)
#   EV/EBITDA, Market Cap/Sales, Book Value
#
# All gates silently skip when their metric is None — never block on missing data.
# ============================================================


# ============================================================
# PHASE 2 FILTER FUNCTION — Sections 3 + 5
# Called by all strategies at runtime after fetch_fundamental_metrics().
# ============================================================


def _fwd_fill(series_dict: dict, at_date: str):
    """Forward-fill: return most recent value at or before at_date. O(log n)."""
    if not series_dict:
        return None
    keys = sorted(series_dict)
    idx  = bisect.bisect_right(keys, at_date) - 1
    return series_dict[keys[idx]] if idx >= 0 else None


def apply_fundamental_filter_phase2(
    metrics,
    at_date=None,
):
    """
    Apply Section 3 (Balance Sheet) + Section 5 (Business Quality) gates.

    metrics : dict returned by fetch_fundamental_metrics(), or None.
    at_date : 'YYYY-MM-DD' for historical backtest lookups; None for scanner
              (uses current snapshot values).

    Returns (all_pass: bool, fail_reasons: list[str]).

    Design: when a metric is not available (None / empty series), that specific
    gate is silently skipped — same pattern as Phase 1 PE gate.  We never block
    an entry solely because data is absent.
    """
    if metrics is None:
        return True, []

    sector   = metrics.get("sector",   "") or ""
    industry = metrics.get("industry", "") or ""
    sector_str   = f"{sector} {industry}".lower()
    is_financial = any(s.lower() in sector_str for s in FINANCIAL_SECTORS)
    fail_reasons = []

    # ── Market cap gate (universe filter — always uses current cap) ───────
    marketcap_cr = metrics.get("marketcap_cr")
    if marketcap_cr is not None and marketcap_cr < MIN_MARKET_CAP_CR:
        fail_reasons.append(f"mktcap={marketcap_cr:.0f}Cr<{MIN_MARKET_CAP_CR:.0f}Cr")

    # ── Section 3: Balance Sheet ──────────────────────────────────────────
    if at_date:
        net_de = _fwd_fill(metrics.get("net_de_series", {}), at_date)
        roce   = _fwd_fill(metrics.get("roce_series",   {}), at_date)
        roe    = _fwd_fill(metrics.get("roe_series",    {}), at_date)
        # For historical TTM net profit use the most recent annual profit as proxy
        ttm_np = _fwd_fill(metrics.get("profit_series_cr", {}), at_date)
    else:
        net_de = metrics.get("net_de_current")
        roce   = metrics.get("roce_current")
        roe    = metrics.get("roe_current")
        ttm_np = metrics.get("ttm_np_cr")

    if not is_financial and net_de is not None:
        if net_de > MAX_NET_DEBT_TO_EQUITY:
            fail_reasons.append(f"net_de={net_de:.2f}>{MAX_NET_DEBT_TO_EQUITY}")

    if not is_financial and roce is not None:
        if roce < MIN_ROCE:
            fail_reasons.append(f"roce={roce:.1f}%<{MIN_ROCE}%")
    elif is_financial and roe is not None:
        if roe < MIN_ROE:
            fail_reasons.append(f"roe={roe:.1f}%<{MIN_ROE}%")

    if ttm_np is not None and ttm_np < MIN_TTM_NET_PROFIT_CR:
        fail_reasons.append(f"ttm_np={ttm_np:.0f}Cr<{MIN_TTM_NET_PROFIT_CR:.0f}Cr")

    # ── Section 4: Governance ────────────────────────────────────────────
    pledged_pct = metrics.get("pledged_pct")
    if pledged_pct is not None and pledged_pct > MAX_PLEDGED_PCT:
        fail_reasons.append(f"pledged={pledged_pct:.1f}%>{MAX_PLEDGED_PCT:.1f}%")

    # ── Section 5: Business Quality ───────────────────────────────────────
    if at_date:
        rev_s   = metrics.get("revenue_series_cr", {})
        prof_s  = metrics.get("profit_series_cr",  {})
        opm_all = metrics.get("opm_series", [])  # [(date_str, pct), ...] newest-first

        # Sales vs ATH: compare most recent annual revenue to its peak up to at_date
        rev_at = [v for d, v in sorted(rev_s.items()) if d <= at_date]
        sales_vs_ath = round(rev_at[-1] / max(rev_at) * 100, 1) if len(rev_at) >= 2 else None

        # Profit vs ATH
        prof_at = [v for d, v in sorted(prof_s.items()) if d <= at_date]
        profit_vs_ath = (
            round(prof_at[-1] / max(prof_at) * 100, 1)
            if (len(prof_at) >= 2 and prof_at[-1] > 0) else None
        )

        # OPM trend: filter to dates known at at_date, keep newest-first order
        opm_hist = [(d, v) for d, v in opm_all if d <= at_date]
        opm_3yr  = [v for _, v in opm_hist[:3]]
    else:
        sales_vs_ath  = metrics.get("sales_vs_ath_pct")
        profit_vs_ath = metrics.get("profit_vs_ath_pct")
        opm_3yr = metrics.get("opm_3yr") or []

    if sales_vs_ath is not None and sales_vs_ath < MIN_SALES_VS_ATH_PCT:
        fail_reasons.append(f"sales_vs_ath={sales_vs_ath:.0f}%<{MIN_SALES_VS_ATH_PCT:.0f}%")

    if profit_vs_ath is not None and profit_vs_ath < MIN_PROFIT_VS_ATH_PCT:
        fail_reasons.append(f"profit_vs_ath={profit_vs_ath:.0f}%<{MIN_PROFIT_VS_ATH_PCT:.0f}%")

    # OPM trend check: skip for financial sector (banks have no standard OPM)
    if REQUIRE_OPM_NON_DECLINING and not is_financial and len(opm_3yr) >= 3:
        # opm_3yr[0] = latest, [1] = prev year, [2] = oldest of the three
        if opm_3yr[0] < opm_3yr[1] or opm_3yr[1] < opm_3yr[2]:
            fail_reasons.append(
                f"opm_declining=[{opm_3yr[2]:.1f},{opm_3yr[1]:.1f},{opm_3yr[0]:.1f}]"
            )

    return len(fail_reasons) == 0, fail_reasons

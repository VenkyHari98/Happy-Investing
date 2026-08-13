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

# Fall-from-10yr-high is informational only (2026-07) — no longer gates
# fund_all_pass. The % is still computed and shown on every row so it can
# inform the decision, but the call on "is this fall deep enough" is
# deliberately left to the user, weighed against how strong the fundamentals
# are — not a hard floor. Set True to make it a Must-Have gate again.
REQUIRE_FALL_FROM_HIGH: bool = False

# Reference fall-from-10yr-high by cap tier — used for the informational
# threshold shown in the UI, and as the actual gate when REQUIRE_FALL_FROM_HIGH
# is True. "More down = better" (see GTH_PREFER_DEEPER_FALL below) — these are
# floors, not a disqualifying upper bound. Keys must match the cap-tier
# strings used in watchlist files.
MIN_FALL_FROM_HIGH_PCT: dict = {
    "Large Cap": 20.0,
    "Mid Cap":   30.0,
    "Small Cap": 40.0,
}


def check_fall_from_high(cap_tier, fall_pct):
    """
    Check a stock's % fall from its 10-year high against its cap-tier minimum.

    fall_pct : % fall from the 10yr high (0 = at the high, 100 = fallen to zero).
    Returns (pass: bool, fail_reason: str | None). Always passes when
    REQUIRE_FALL_FROM_HIGH is False (informational only — see above). Also
    skipped (pass=True) when fall_pct is None or cap_tier isn't a recognised
    bucket — never block on missing data.
    """
    min_fall = MIN_FALL_FROM_HIGH_PCT.get(cap_tier)
    if not REQUIRE_FALL_FROM_HIGH or min_fall is None or fall_pct is None:
        return True, None
    if fall_pct < min_fall:
        return False, f"fall_from_10yr_high={fall_pct:.1f}%<{min_fall:.0f}% ({cap_tier})"
    return True, None

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

# Banks/NBFCs/Insurance run structurally lower ROE than a 15% non-financial bar —
# private bank sector average is ~14% (2025), quality NBFCs like Bajaj Finance/
# Cholamandalam run 15-17% but their ROCE is only ~9-11% (confirming ROCE isn't the
# right metric here), and healthy life insurers (HDFC Life ~11-12%) are described as
# "reasonable" well below 15%. 12% clears the weakest legitimately-healthy sub-segment
# (life insurance) without gutting the bar — single-digit ROE is the real distress signal.
MIN_ROE: float = 12.0          # Banks / NBFCs / Insurance (used when ROCE not applicable)

# Sectors treated as financial (use ROE instead of ROCE, skip net D/E + OPM checks)
# Matched against both yfinance 'sector' and 'industry' fields (case-insensitive substring)
FINANCIAL_SECTORS: list = [
    "Bank", "NBFC", "Insurance", "Microfinance", "Housing Finance",
    "Financial Services", "Financial", "Capital Markets",
    "Diversified Financial", "Consumer Finance",
]

MIN_TTM_NET_PROFIT_CR: float = 250.0             # Non-financial companies
# Net D/E is skipped for financials (see above), so it can no longer screen out small,
# weak lenders/insurers by leverage — the profit-scale bar compensates instead.
MIN_TTM_NET_PROFIT_CR_FINANCIAL: float = 1000.0  # Banks / NBFCs / Insurance

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


def is_financial_sector(sector: str, industry: str) -> bool:
    """True if this stock's ROCE/ROE gate should use the financial-sector rules
    (ROE, not ROCE — see MIN_ROE/MIN_ROCE above). Matched against yfinance's
    'sector'/'industry' fields (case-insensitive substring against
    FINANCIAL_SECTORS). Exposed standalone (not just inline in
    apply_fundamental_filter_phase2) so scanners can attach it to their output
    rows as fund_is_financial — the frontend needs to know which of ROCE/ROE is
    actually gated for a given stock to color/threshold them correctly.
    """
    sector_str = f"{sector or ''} {industry or ''}".lower()
    return any(s.lower() in sector_str for s in FINANCIAL_SECTORS)


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
    is_financial = is_financial_sector(sector, industry)
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

    min_ttm_np = MIN_TTM_NET_PROFIT_CR_FINANCIAL if is_financial else MIN_TTM_NET_PROFIT_CR
    if ttm_np is not None and ttm_np < min_ttm_np:
        fail_reasons.append(f"ttm_np={ttm_np:.0f}Cr<{min_ttm_np:.0f}Cr")

    # ── Section 4: Governance ────────────────────────────────────────────
    pledged_pct = metrics.get("pledged_pct")
    if pledged_pct is not None and pledged_pct > MAX_PLEDGED_PCT:
        fail_reasons.append(f"pledged={pledged_pct:.1f}%>{MAX_PLEDGED_PCT:.1f}%")

    public_shareholding_pct = metrics.get("public_shareholding_pct")
    if public_shareholding_pct is not None and public_shareholding_pct > MAX_PUBLIC_SHAREHOLDING_PCT:
        fail_reasons.append(
            f"public_holding={public_shareholding_pct:.1f}%>{MAX_PUBLIC_SHAREHOLDING_PCT:.1f}%"
        )

    # ── Section 5: Business Quality ───────────────────────────────────────
    if at_date:
        rev_s   = metrics.get("revenue_series_cr", {})
        prof_s  = metrics.get("profit_series_cr",  {})
        tfa_s   = metrics.get("tfa_series",         {})
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

        # Tangible Fixed Assets vs ATH — alt-pass for a failing Profit ATH check
        tfa_at = [v for d, v in sorted(tfa_s.items()) if d <= at_date]
        tfa_vs_ath = (
            round(tfa_at[-1] / max(tfa_at) * 100, 1)
            if (len(tfa_at) >= 2 and tfa_at[-1] > 0) else None
        )

        # OPM trend: filter to dates known at at_date, keep newest-first order
        opm_hist = [(d, v) for d, v in opm_all if d <= at_date]
        opm_3yr  = [v for _, v in opm_hist[:3]]
    else:
        sales_vs_ath  = metrics.get("sales_vs_ath_pct")
        profit_vs_ath = metrics.get("profit_vs_ath_pct")
        tfa_vs_ath    = metrics.get("tfa_vs_ath_pct")
        opm_3yr = metrics.get("opm_3yr") or []

    if sales_vs_ath is not None and sales_vs_ath < MIN_SALES_VS_ATH_PCT:
        fail_reasons.append(f"sales_vs_ath={sales_vs_ath:.0f}%<{MIN_SALES_VS_ATH_PCT:.0f}%")

    # Profit ATH — Asset Growth Criteria is an alt-pass: a stock only fails here
    # when it misses BOTH the profit-ATH check and the TFA-ATH check. Missing
    # TFA data (None) does not penalize a stock that already passes on profit.
    if profit_vs_ath is not None and profit_vs_ath < MIN_PROFIT_VS_ATH_PCT:
        tfa_alt_pass = tfa_vs_ath is not None and tfa_vs_ath >= MIN_TFA_VS_ATH_PCT
        if not tfa_alt_pass:
            fail_reasons.append(
                f"profit_vs_ath={profit_vs_ath:.0f}%<{MIN_PROFIT_VS_ATH_PCT:.0f}%"
                + (f" (tfa_vs_ath={tfa_vs_ath:.0f}%<{MIN_TFA_VS_ATH_PCT:.0f}%)" if tfa_vs_ath is not None else "")
            )

    # OPM trend check: skip for financial sector (banks have no standard OPM)
    if REQUIRE_OPM_NON_DECLINING and not is_financial and len(opm_3yr) >= 3:
        # opm_3yr[0] = latest, [1] = prev year, [2] = oldest of the three
        if opm_3yr[0] < opm_3yr[1] or opm_3yr[1] < opm_3yr[2]:
            fail_reasons.append(
                f"opm_declining=[{opm_3yr[2]:.1f},{opm_3yr[1]:.1f},{opm_3yr[0]:.1f}]"
            )

    return len(fail_reasons) == 0, fail_reasons

// Temporary pause switch: while false, only the Opportunity Scanner tabs are shown/
// fetched across all strategies. Portfolio Backtest, Trade Log, By Stock,
// Backtest-by-Stock and Grid Search are hidden (code kept, not deleted).
// Flip to true to bring them back. Mirrors the pause in backend/api/routes/pipeline.py
// and web/start_dashboard.py (PAUSE_PORTFOLIO_BACKTESTS) — flip all three together.
export const BACKTEST_FEATURES_ENABLED = false;

// Temporary pause switch: while false, the "Stock Analysis" tab (per-stock chart +
// PE overlay + trade history) is hidden on 52W/Envelope/S200/RHS, and its backing
// data queries are not fetched. Opportunity Scanner tabs are unaffected. Flip to
// true to bring it back. Mirrors PAUSE_STOCK_ANALYSIS_BACKTESTS in
// backend/api/routes/pipeline.py and web/start_dashboard.py — flip all three together.
export const STOCK_ANALYSIS_ENABLED = false;

// Static (Vercel + GitHub Actions) deploys have no live backend process.
// The opportunity-data "Refresh Now" button (StaleBanner) works everywhere —
// it POSTs to /api/pipeline/refresh, which locally hits the live FastAPI
// backend and on Vercel dispatches .github/workflows/refresh-opportunities.yml
// instead. Fundamentals refresh (Screener.in scrape, 8-12 min) has no such
// static equivalent — no GitHub Action wraps that mode — so its controls
// stay hidden on static deploys. Set NEXT_PUBLIC_STATIC_DEPLOY=true there.
export const LIVE_PIPELINE_CONTROLS_ENABLED = process.env.NEXT_PUBLIC_STATIC_DEPLOY !== "true";

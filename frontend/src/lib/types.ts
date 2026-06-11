// ── Scanner (current_setup.json) ─────────────────────────────────────────────

export interface ScannerRow {
  ticker: string;
  cap_tier: string;
  sector: string;
  close: number;
  ma: number;                     // 200 SMA (JSON field name)
  "52w_low": number;
  "52w_high": number;
  distance_to_52w_low_pct: number;
  distance_to_52w_high_pct: number;
  signals: string[];
  pe_current: number | null;
  pe_5yr_avg: number | null;
  // Envelope bands
  lower_envelope?: number | null;
  upper_envelope?: number | null;
  distance_to_lower_envelope_pct?: number | null;
  distance_to_upper_envelope_pct?: number | null;
  // Fundamental filter results
  fund_below_200dma?: boolean;
  fund_pe_pass?: boolean;
  fund_s3_s5_pass?: boolean;
  fund_all_pass?: boolean;
  fund_roce?: number | null;
  fund_roe?: number | null;
  fund_net_de?: number | null;
  fund_opm_3yr?: number | null;
  fund_pledged_pct?: number | null;
}

export interface ScannerSummary {
  run_date: string;
  stocks_scanned: number;
  candidate_count: number;
  signal_counts: Record<string, number>;
  fundamental_config: Record<string, unknown>;
  errors: string[];
}

// ── Backtest 52W ─────────────────────────────────────────────────────────────

export interface Trade {
  stock_ticker: string;
  cap_tier: string;
  sector: string;
  entry_date: string;
  entry_price: number;
  exit_date: string | null;
  exit_price: number | null;
  trade_duration_days: number;
  shares: number;
  pnl_pct: number;
  net_pnl: number;
  gross_pnl: number;
  exit_reason: string;
}

export interface PricePoint {
  date: string;
  close: number;
  high: number;
  low: number;
  w52_high: number | null;
  w52_low: number | null;
  ma200: number | null;
}

export interface OpenPosition {
  entry_date: string;
  entry_price: number;
  target_price: number;
  shares: number;
  current_value: number;
  unrealised_pct: number;
}

export interface SkippedEntry {
  date: string;
  price: number;
  reason: string; // "limit_full" | "cycle_active"
}

export interface StockDetail {
  ticker: string;
  cap_tier: string;
  sector: string;
  latest_close: number;
  latest_date: string;
  trades_count: number;
  total_pnl: number;
  pe_current: number | null;
  pe_3yr_avg: number | null;
  pe_5yr_avg: number | null;
  open_positions: OpenPosition[];
  prices: PricePoint[];
  trades: Trade[];
  skipped_entries?: SkippedEntry[];
}

export interface StockOverview {
  ticker: string;
  cap_tier: string;
  sector: string;
  latest_close: number;
  latest_date: string;
  trades_count: number;
  total_pnl: number;
  open_count: number;
}

export interface BacktestStockData {
  overview: StockOverview[];
  stock_data: Record<string, StockDetail>;
}

export interface BacktestMetrics {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  avg_trade_pnl_pct: number;
  max_gain_pct: number;
  max_loss_pct: number;
  avg_trade_duration_days: number;
  cagr: number;
  sharpe: number;
  max_drawdown: number;
}

export interface BacktestSummary {
  backtest_date: string;
  backtest_years: number;
  total_trades: number;
  open_positions: number;
  stocks_tested: number;
  metrics: BacktestMetrics;
}

// ── Envelope Backtest ────────────────────────────────────────────────────────

export interface EnvelopeTrade extends Trade {
  allocation_pct: number;
  entry_value: number;
  exit_value: number;
  slippage_loss: number;
  net_pnl: number;
}

export interface EnvelopeSummary extends BacktestSummary {
  direction: string;
  envelope_pct: number;
  ma_period: number;
  entry_band_pct: number;
  ma_type: string;
}

// ── S200 Scanner ─────────────────────────────────────────────────────────────

export type S200Status = "IN_ZONE" | "APPROACHING" | "WATCHING_NEAR" | "WATCHING" | "BELOW_BUY";

export interface S200Rally {
  ticker: string;
  cap_tier: string;
  sector: string;
  watchlist_source: string;
  current_price: number;
  ma200: number;
  rally_start_date: string;
  rally_end_date?: string;
  expiry_date: string;
  days_to_expiry: number;
  rally_pct: number;
  candle_count?: number;
  buy_price: number;
  sell_price: number;
  buy_zone_low: number;
  buy_zone_high: number;
  status: S200Status;
  dist_to_buy_zone_pct: number;
  remaining_gain_pct: number;
  below_200dma: boolean;
}

export interface S200ScannerData {
  run_date: string;
  stocks_scanned: number;
  stocks_with_rallies?: number;
  total_rallies: number;
  status_counts: Record<string, number>;
  source_counts?: Record<string, number>;
  rallies: S200Rally[];
}

// ── S200 Backtest ─────────────────────────────────────────────────────────────

export interface S200BacktestSummary {
  run_date: string;
  backtest_years: number;
  stocks_tested: number;
  total_rallies: number;
  total_entered: number;
  total_hits: number;
  total_expired: number;
  total_not_entered: number;
  zone_entry_rate_pct: number;
  win_rate_pct: number;
  overall_success_rate_pct: number;
  avg_days_to_entry: number;
  avg_days_in_trade: number;
  avg_pnl_pct: number;
  avg_max_drawdown_pct: number;
}

export interface S200StockOverview {
  ticker: string;
  cap_tier: string;
  sector: string;
  watchlist_source: string;
  total_rallies: number;
  not_entered: number;
  entered: number;
  target_hit: number;
  expired: number;
  zone_entry_rate_pct: number;
  win_rate_pct: number;
  overall_success_rate_pct: number;
  avg_days_to_entry: number;
  avg_days_in_trade: number;
  avg_pnl_pct: number;
  avg_max_drawdown_pct: number;
}

export interface S200BacktestStockData {
  run_date: string;
  overview: S200StockOverview[];
  stock_data?: Record<string, S200StockDetailData>;
}

// ── S200 Per-Stock Detail ─────────────────────────────────────────────────────

export interface S200TradeRecord {
  ticker: string;
  cap_tier: string;
  sector: string;
  watchlist_source: string;
  rally_start_date: string;
  rally_end_date: string;
  rally_pct: number;
  candle_count: number;
  buy_price: number;
  buy_zone_low: number;
  buy_zone_high: number;
  sell_price: number;
  zone_entered: boolean;
  entry_date: string | null;
  entry_price: number | null;
  exit_date: string | null;
  exit_price: number | null;
  exit_reason: string;
  days_to_entry: number | null;
  days_in_trade: number | null;
  pnl_pct: number | null;
  max_drawdown_pct: number | null;
}

export interface S200StockDetailMetrics {
  total_rallies: number;
  not_entered: number;
  entered: number;
  target_hit: number;
  expired: number;
  zone_entry_rate_pct: number;
  win_rate_pct: number;
  overall_success_rate_pct: number;
  avg_days_to_entry: number;
  avg_days_in_trade: number;
  avg_pnl_pct: number;
  avg_max_drawdown_pct: number;
}

export interface S200StockDetailData {
  ticker: string;
  cap_tier: string;
  sector: string;
  watchlist_source: string;
  metrics: S200StockDetailMetrics;
  trades: S200TradeRecord[];
}

// ── Portfolio Backtest ───────────────────────────────────────────────────────

export interface PortfolioTrade {
  trade_id: string;
  strategy: string;
  ticker: string;
  cap_tier: string;
  sector: string;
  watchlist_source: string;
  tranche: string;
  entry_date: string;
  entry_price: number;
  exit_target: number;
  shares: number;
  position_value: number;
  exit_date: string | null;
  exit_price: number | null;
  exit_reason: string;
  trade_duration_days: number;
  pnl: number;
  pnl_pct: number;
  max_drawdown_pct: number;
}

export interface EquityCurvePoint {
  date: string;
  total_value: number;
  cash: number;
  deployed: number;
  open_count: number;
}

export interface CapTierStats {
  count: number;
  wins: number;
  win_rate_pct: number;
  avg_pnl_pct: number;
}

export interface PortfolioSummary {
  initial_capital: number;
  final_value: number;
  total_return_pct: number;
  cagr_pct: number;
  xirr_pct: number;
  total_trades: number;
  total_expired: number;
  open_at_end: number;
  wins: number;
  win_rate_pct: number;
  avg_trade_duration_days: number;
  avg_trade_pnl_pct: number;
  max_drawdown_pct: number;
  time_in_market_pct: number;
  yearly_returns: Record<string, number>;
  by_cap_tier: Record<string, CapTierStats>;
}

export interface PortfolioMeta {
  strategy: string;
  run_date: string;
  sim_start: string;
  sim_end: string;
  initial_capital: number;
  stocks_count: number;
  data_errors: number;
  exit_mode?: string;
  envelope_pct?: number;
  envelope_mode?: string;
  rally_mode?: string;
}

export interface PortfolioBacktestData {
  meta: PortfolioMeta;
  summary: PortfolioSummary;
  equity_curve: EquityCurvePoint[];
  trades: PortfolioTrade[];
}

// ── OHLCV ────────────────────────────────────────────────────────────────────

export interface OhlcvPoint {
  date: string;
  close: number;
  ma200: number | null;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

export interface PipelineStatus {
  running: boolean;
  started_at: string;
  completed_at: string;
  run_date: string;
  error: string;
  is_fresh_today: boolean;
  today: string;
}

// ── Envelope per-stock data (skipped entries) ────────────────────────────────

export interface EnvelopeStockItem {
  ticker: string;
  cap_tier: string;
  sector: string;
  skipped_entries: SkippedEntry[];
}

export interface EnvelopeStockData {
  run_date: string;
  stock_data: Record<string, EnvelopeStockItem>;
}

// ── 52W proximity status ──────────────────────────────────────────────────────

export type ProximityStatus = "IN_ZONE" | "APPROACHING" | "NEAR" | "BEYOND";

export function getProximityStatus(row: ScannerRow): ProximityStatus {
  const dist = row.distance_to_52w_low_pct ?? 999;
  if (dist <= 2) return "IN_ZONE";
  if (dist <= 15) return "APPROACHING";
  if (dist <= 40) return "NEAR";
  return "BEYOND";
}

export const PROXIMITY_LABELS: Record<ProximityStatus, string> = {
  IN_ZONE: "At 52W Low",
  APPROACHING: "Approaching",
  NEAR: "Near DMA",
  BEYOND: "Far",
};

import type {
  ScannerRow,
  ScannerSummary,
  BacktestStockData,
  BacktestSummary,
  EnvelopeSummary,
  EnvelopeTrade,
  EnvelopeStockData,
  S200BacktestSummary,
  S200BacktestStockData,
  S200StockDetailData,
  S200ScannerData,
  OhlcvPoint,
  PortfolioBacktestData,
  PipelineStatus,
  GridSearchStatus,
  PeData,
  FundamentalsData,
  RHSScannerData,
  RHSBacktestSummary,
  RHSBacktestStockData,
  RHSStockDetail,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  scanner: {
    f40: () => get<ScannerRow[]>("/api/scanner/f40"),
    f40Summary: () => get<ScannerSummary>("/api/scanner/f40/summary"),
    s200: () => get<S200ScannerData>("/api/scanner/s200"),
  },

  backtest: {
    summary52w: (years: "5" | "10" = "10") =>
      get<BacktestSummary>(`/api/backtest/52w/summary?years=${years}`),
    stocks52w: (years: "5" | "10" = "10") =>
      get<BacktestStockData>(`/api/backtest/52w/stocks?years=${years}`),
    summaryEnvelope: (years: "5" | "10" = "10") =>
      get<EnvelopeSummary>(`/api/backtest/envelope/summary?years=${years}`),
    tradesEnvelope: (years: "5" | "10" = "10") =>
      get<EnvelopeTrade[]>(`/api/backtest/envelope/trades?years=${years}`),
    stocksEnvelope: (years: "5" | "10" = "10") =>
      get<EnvelopeStockData>(`/api/backtest/envelope/stocks?years=${years}`),
    envelopeRunStatus: () =>
      get<{ running: boolean; started_at: string; completed_at: string; error: string; params: Record<string, number> }>(`/api/backtest/envelope/run_status`),
    envelopeRun: (envelope_pct: number, entry_band_pct: number, years: number) =>
      fetch(`${BASE}/api/backtest/envelope/run?envelope_pct=${envelope_pct}&entry_band_pct=${entry_band_pct}&years=${years}`, { method: "POST" }).then((r) => r.json()),
    summaryS200: (years: "5" | "10" = "10") =>
      get<S200BacktestSummary>(`/api/backtest/s200/summary?years=${years}`),
    stocksS200: (years: "5" | "10" = "10") =>
      get<S200BacktestStockData>(`/api/backtest/s200/stocks?years=${years}`),
    stockDetailS200: (ticker: string, years: "5" | "10" = "10") =>
      get<S200StockDetailData>(`/api/backtest/s200/stock/${encodeURIComponent(ticker)}?years=${years}`),
  },

  portfolio: {
    f40: (variant = "fixed", years: "5" | "10" = "10") =>
      get<PortfolioBacktestData>(`/api/portfolio/f40?variant=${variant}&years=${years}`),
    s200: (years: "5" | "10" = "10") =>
      get<PortfolioBacktestData>(`/api/portfolio/s200?years=${years}`),
  },

  ohlcv: (ticker: string, years: number = 10) =>
    get<OhlcvPoint[]>(`/api/ohlcv/${encodeURIComponent(ticker)}?years=${years}`),

  pipeline: {
    status: () => get<PipelineStatus>("/api/pipeline/status"),
    refresh: (opts?: { force?: boolean; skipScanners?: boolean }) => {
      const params = new URLSearchParams();
      if (opts?.force) params.set("force", "true");
      if (opts?.skipScanners) params.set("skip_scanners", "true");
      return fetch(`${BASE}/api/pipeline/refresh?${params}`, { method: "POST" }).then((r) =>
        r.json()
      );
    },
  },

  fundamentals: {
    pe: (ticker: string, years: number = 5) =>
      get<PeData>(`/api/fundamentals/pe/${encodeURIComponent(ticker)}?years=${years}`),
    metrics: (ticker: string) =>
      get<FundamentalsData>(`/api/fundamentals/metrics/${encodeURIComponent(ticker)}`),
    config: () =>
      get<Record<string, unknown>>("/api/fundamentals/config"),
  },

  rhs: {
    scanner: () => get<RHSScannerData>("/api/rhs/scanner"),
    summary: () => get<RHSBacktestSummary>("/api/rhs/summary"),
    stocks: () => get<RHSBacktestStockData>("/api/rhs/stocks"),
    stockDetail: (ticker: string) => get<RHSStockDetail>(`/api/rhs/stock/${encodeURIComponent(ticker)}`),
  },

  gridSearch: {
    status: () => get<GridSearchStatus>("/api/grid-search/status"),
    run: (params: {
      env_pct_min?: number;
      env_pct_max?: number;
      zone_pct_min?: number;
      zone_pct_max?: number;
      years?: number;
    }) => {
      const p = new URLSearchParams();
      if (params.env_pct_min  != null) p.set("env_pct_min",  String(params.env_pct_min));
      if (params.env_pct_max  != null) p.set("env_pct_max",  String(params.env_pct_max));
      if (params.zone_pct_min != null) p.set("zone_pct_min", String(params.zone_pct_min));
      if (params.zone_pct_max != null) p.set("zone_pct_max", String(params.zone_pct_max));
      if (params.years        != null) p.set("years",        String(params.years));
      return fetch(`${BASE}/api/grid-search/run?${p}`, { method: "POST" }).then((r) => r.json());
    },
    stop: () =>
      fetch(`${BASE}/api/grid-search/stop`, { method: "POST" }).then((r) => r.json()),
    streamUrl: () => `${BASE}/api/grid-search/stream`,
  },
};

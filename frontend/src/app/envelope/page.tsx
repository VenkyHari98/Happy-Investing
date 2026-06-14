"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MetricCards, type MetricDef } from "@/components/52w/MetricCards";
import { EnvelopeTradesTable } from "@/components/envelope/EnvelopeTradesTable";
import { EnvelopeByStock } from "@/components/envelope/EnvelopeByStock";
import { EnvelopeConfigPanel } from "@/components/envelope/EnvelopeConfigPanel";
import { GridSearchPanel } from "@/components/envelope/GridSearchPanel";
import { EnvelopeStockList } from "@/components/envelope/EnvelopeStockList";
import { EnvelopeStockDetail } from "@/components/envelope/EnvelopeStockDetail";
import { EnvelopeScannerTab } from "@/components/envelope/EnvelopeScannerTab";
import { PortfolioBacktest } from "@/components/portfolio/PortfolioBacktest";
import { Tip } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { fmtPct, fmtNum } from "@/lib/format";

type Horizon = "5" | "10";

// Strategy mode options matching the F40 portfolio variants
const ENVELOPE_VARIANTS = [
  { key: "fixed_env-long", label: "Long Full (L→U)" },
  { key: "fixed", label: "52W Only" },
  { key: "fixed_env-long_rally-f40", label: "All 3 Combined" },
];

export default function EnvelopePage() {
  const [horizon, setHorizon] = useState<Horizon>("10");
  const [portfolioVariant, setPortfolioVariant] = useState("fixed_env-long");
  const [selectedStockTicker, setSelectedStockTicker] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("scanner");
  const queryClient = useQueryClient();
  const prevRunningRef = useRef(false);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["envelope-summary", horizon],
    queryFn: () => api.backtest.summaryEnvelope(horizon),
  });

  const { data: trades, isLoading: tradesLoading } = useQuery({
    queryKey: ["envelope-trades", horizon],
    queryFn: () => api.backtest.tradesEnvelope(horizon),
  });

  const { data: portfolioData } = useQuery({
    queryKey: ["portfolio-f40", portfolioVariant, horizon],
    queryFn: () => api.portfolio.f40(portfolioVariant, horizon),
  });

  const { data: scannerRows } = useQuery({
    queryKey: ["scanner-f40"],
    queryFn: api.scanner.f40,
    staleTime: 1000 * 60 * 60,
  });

  const { data: scannerSummary } = useQuery({
    queryKey: ["scanner-f40-summary"],
    queryFn: api.scanner.f40Summary,
    staleTime: 1000 * 60 * 60,
  });

  const { data: runStatus } = useQuery({
    queryKey: ["envelope-run-status"],
    queryFn: api.backtest.envelopeRunStatus,
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });

  // When a run transitions from running→done, invalidate envelope data queries
  useEffect(() => {
    const isRunning = runStatus?.running ?? false;
    if (prevRunningRef.current && !isRunning && !runStatus?.error) {
      queryClient.invalidateQueries({ queryKey: ["envelope-summary"] });
      queryClient.invalidateQueries({ queryKey: ["envelope-trades"] });
    }
    prevRunningRef.current = isRunning;
  }, [runStatus, queryClient]);

  const handleRun = useCallback(
    async (envelopePct: number, entryBandPct: number) => {
      await api.backtest.envelopeRun(envelopePct, entryBandPct, parseInt(horizon));
      queryClient.invalidateQueries({ queryKey: ["envelope-run-status"] });
    },
    [horizon, queryClient]
  );

  // Load compare data for diff badges
  const { data: compareEnvLong } = useQuery({
    queryKey: ["portfolio-f40", "fixed_env-long", horizon],
    queryFn: () => api.portfolio.f40("fixed_env-long", horizon),
    enabled: portfolioVariant !== "fixed_env-long",
  });

  const { data: compareFixed } = useQuery({
    queryKey: ["portfolio-f40", "fixed", horizon],
    queryFn: () => api.portfolio.f40("fixed", horizon),
    enabled: portfolioVariant !== "fixed",
  });

  const { data: compareAll } = useQuery({
    queryKey: ["portfolio-f40", "fixed_env-long_rally-f40", horizon],
    queryFn: () => api.portfolio.f40("fixed_env-long_rally-f40", horizon),
    enabled: portfolioVariant !== "fixed_env-long_rally-f40",
  });

  const compareMap = {
    "fixed_env-long": compareEnvLong,
    fixed: compareFixed,
    "fixed_env-long_rally-f40": compareAll,
  } as Record<string, typeof portfolioData>;

  // Stock Analysis — derive unique tickers and filter trades
  const allTickers = trades ? Array.from(new Set(trades.map((t) => t.stock_ticker))) : [];
  const firstTicker = !selectedStockTicker && allTickers.length ? allTickers[0] : null;
  const displayTicker = selectedStockTicker ?? firstTicker;
  const displayTrades = displayTicker && trades
    ? trades.filter((t) => t.stock_ticker === displayTicker)
    : [];

  const m = summary?.metrics;
  const summaryMetrics: MetricDef[] = m
    ? [
        { label: "Total Trades", value: m.total_trades, variant: "accent", tooltip: "All buy→sell cycles the envelope strategy completed across F40 stocks" },
        { label: "Win Rate", value: fmtPct(m.win_rate, 1), variant: "green", tooltip: "% of completed trades that exited at a profit" },
        { label: "CAGR", value: fmtPct(m.cagr, 1), variant: m.cagr >= 0 ? "green" : "red", tooltip: "Compound Annual Growth Rate over the backtest period" },
        { label: "Avg Trade P/L", value: fmtPct(m.avg_trade_pnl_pct), variant: m.avg_trade_pnl_pct >= 0 ? "green" : "red", tooltip: "Average % return per completed trade" },
        { label: "Best Trade", value: fmtPct(m.max_gain_pct), variant: "green", tooltip: "Highest single-trade return in the backtest" },
        { label: "Worst Trade", value: fmtPct(m.max_loss_pct), variant: "red", tooltip: "Biggest single-trade loss — useful for understanding downside risk" },
        { label: "Avg Duration", value: m.avg_trade_duration_days ? `${Math.round(m.avg_trade_duration_days)}d` : "—", tooltip: "Average days held per envelope trade" },
        { label: "Max Drawdown", value: fmtPct(m.max_drawdown), variant: "red", tooltip: "Largest peak-to-trough drop in portfolio value during the backtest — a key risk measure" },
      ]
    : [];

  return (
    <div className="flex flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Envelope Long Strategy</h1>
          <p className="text-xs text-muted-foreground">
            Buy at lower envelope (−14% of 200 SMA), exit at upper envelope or mean reversion
          </p>
        </div>
        <div className="flex gap-1 border border-border rounded-md p-0.5">
          {(["5", "10"] as Horizon[]).map((h) => (
            <Tip
              key={h}
              content={h === "5" ? "Run the backtest using 5 years of price history" : "Run the backtest using 10 years of price history — gives more data but may include older market conditions"}
              below
            >
              <button
                onClick={() => setHorizon(h)}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  horizon === h ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {h}Y
              </button>
            </Tip>
          ))}
        </div>
      </div>

      {/* Summary metrics — hidden when Stock Analysis tab is active */}
      {activeTab !== "analysis" && (
        <div className="px-6 py-3 border-b border-border shrink-0">
          {summaryLoading ? (
            <div className="text-xs text-muted-foreground">Loading metrics…</div>
          ) : (
            <MetricCards metrics={summaryMetrics} />
          )}
        </div>
      )}

      {/* Parameter panel — shows current params + Re-run control */}
      <EnvelopeConfigPanel
        currentEnvelopePct={summary?.envelope_pct ?? 14}
        currentEntryBandPct={summary?.entry_band_pct ?? 2}
        years={horizon}
        runStatus={runStatus ?? null}
        onRun={handleRun}
      />

      {/* Grid search panel — parameter sweep with live SSE results */}
      <GridSearchPanel years={horizon} />

      {/* Sub-tabs */}
      <Tabs defaultValue="scanner" onValueChange={setActiveTab} className="flex flex-col">
        <TabsList className="mx-6 mt-3 w-fit shrink-0">
          <TabsTrigger value="scanner">
            <Tip content="See which F40 stocks are currently near the lower envelope band — live buy candidates" below>
              <span>Scanner</span>
            </Tip>
          </TabsTrigger>
          <TabsTrigger value="trades">
            <Tip content="Full list of every individual envelope trade across all stocks" below>
              <span>Trade Log</span>
            </Tip>
          </TabsTrigger>
          <TabsTrigger value="bystock">
            <Tip content="Aggregate win rate and P/L stats grouped by stock" below>
              <span>By Stock</span>
            </Tip>
          </TabsTrigger>
          <TabsTrigger value="analysis">
            <Tip content="Deep-dive into a single stock's envelope trades and price chart" below>
              <span>Stock Analysis</span>
            </Tip>
          </TabsTrigger>
          <TabsTrigger value="portfolio">
            <Tip content="Simulate the envelope strategy across the full F40 portfolio" below>
              <span>Portfolio Backtest</span>
            </Tip>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scanner" className="px-6 py-4">
          {scannerRows ? (
            <EnvelopeScannerTab
              rows={scannerRows}
              runDate={scannerSummary?.run_date}
              envelopePct={summary?.envelope_pct ?? 14}
            />
          ) : (
            <div className="text-sm text-muted-foreground">Loading scanner data…</div>
          )}
        </TabsContent>

        <TabsContent value="trades" className="px-6 py-4">
          {tradesLoading ? (
            <div className="text-sm text-muted-foreground">Loading trades…</div>
          ) : trades ? (
            <EnvelopeTradesTable trades={trades} />
          ) : null}
        </TabsContent>

        <TabsContent value="bystock" className="px-6 py-4">
          {tradesLoading ? (
            <div className="text-sm text-muted-foreground">Loading trades…</div>
          ) : trades ? (
            <EnvelopeByStock trades={trades} />
          ) : null}
        </TabsContent>

        {/* Stock Analysis — split panel with chart */}
        <TabsContent value="analysis" className="overflow-hidden">
          {tradesLoading ? (
            <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
              Loading trade data…
            </div>
          ) : (
            <div className="flex h-[calc(100dvh-200px)] overflow-hidden">
              <div className="w-56 shrink-0 border-r border-border overflow-hidden">
                <EnvelopeStockList
                  trades={trades ?? []}
                  selectedTicker={displayTicker}
                  onSelect={setSelectedStockTicker}
                />
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {displayTicker ? (
                  <EnvelopeStockDetail
                    ticker={displayTicker}
                    trades={displayTrades}
                    envelopePct={summary?.envelope_pct ?? 14}
                    years={horizon}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    Select a stock to view detail
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="portfolio" className="px-6 py-4">
          {portfolioData ? (
            <PortfolioBacktest
              data={portfolioData}
              compareData={compareMap}
              variants={ENVELOPE_VARIANTS}
              activeVariant={portfolioVariant}
              onVariantChange={setPortfolioVariant}
              showStrategy={portfolioVariant === "fixed_env-long_rally-f40"}
            />
          ) : (
            <div className="text-sm text-muted-foreground">Loading portfolio backtest…</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MetricCards, type MetricDef } from "@/components/52w/MetricCards";
import { ScannerTab } from "@/components/52w/ScannerTab";
import { StockList } from "@/components/52w/StockList";
import { StockDetail } from "@/components/52w/StockDetail";
import { PortfolioBacktest } from "@/components/portfolio/PortfolioBacktest";
import { Tip } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { fmtPct, fmtNum } from "@/lib/format";

type Horizon = "5" | "10";

// F40 portfolio variant options with display labels
const F40_VARIANTS = [
  { key: "fixed", label: "52W Only" },
  { key: "fixed_env-long", label: "+Envelope Long" },
  { key: "fixed_rally-f40", label: "+Rally F40" },
  { key: "fixed_env-long_rally-f40", label: "All 3 Combined" },
];

export default function W52Page() {
  const [horizon, setHorizon] = useState<Horizon>("10");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [portfolioVariant, setPortfolioVariant] = useState("fixed");
  const [activeTab, setActiveTab] = useState<string>("analysis");

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["52w-summary", horizon],
    queryFn: () => api.backtest.summary52w(horizon),
  });

  const { data: stockData, isLoading: stocksLoading } = useQuery({
    queryKey: ["52w-stocks", horizon],
    queryFn: () => api.backtest.stocks52w(horizon),
  });

  const { data: scanner } = useQuery({
    queryKey: ["scanner-f40"],
    queryFn: api.scanner.f40,
  });

  const { data: scannerSummary } = useQuery({
    queryKey: ["scanner-f40-summary"],
    queryFn: api.scanner.f40Summary,
  });

  // Load base + all compare variants for diff badges
  const { data: portfolioData } = useQuery({
    queryKey: ["portfolio-f40", portfolioVariant, horizon],
    queryFn: () => api.portfolio.f40(portfolioVariant, horizon),
  });

  const { data: portfolioCompareFixed } = useQuery({
    queryKey: ["portfolio-f40", "fixed", horizon],
    queryFn: () => api.portfolio.f40("fixed", horizon),
    enabled: portfolioVariant !== "fixed",
  });

  const { data: portfolioCompareEnv } = useQuery({
    queryKey: ["portfolio-f40", "fixed_env-long", horizon],
    queryFn: () => api.portfolio.f40("fixed_env-long", horizon),
    enabled: portfolioVariant !== "fixed_env-long",
  });

  const { data: portfolioCompareRally } = useQuery({
    queryKey: ["portfolio-f40", "fixed_rally-f40", horizon],
    queryFn: () => api.portfolio.f40("fixed_rally-f40", horizon),
    enabled: portfolioVariant !== "fixed_rally-f40",
  });

  const { data: portfolioCompareAll } = useQuery({
    queryKey: ["portfolio-f40", "fixed_env-long_rally-f40", horizon],
    queryFn: () => api.portfolio.f40("fixed_env-long_rally-f40", horizon),
    enabled: portfolioVariant !== "fixed_env-long_rally-f40",
  });

  // Build compare map for diff badges
  const compareMap = {
    fixed: portfolioCompareFixed,
    "fixed_env-long": portfolioCompareEnv,
    "fixed_rally-f40": portfolioCompareRally,
    "fixed_env-long_rally-f40": portfolioCompareAll,
  } as Record<string, typeof portfolioData>;

  const m = summary?.metrics;
  const summaryMetrics: MetricDef[] = m
    ? [
        { label: "Completed Trades", value: m.total_trades, variant: "accent", tooltip: "Total buy→sell cycles the strategy closed across all F40 stocks in the backtest period" },
        { label: "Open (Holding)", value: summary.open_positions, variant: "amber", sub: "target not yet hit", tooltip: "Positions bought near a 52W low that haven't reached the target (52W high) yet" },
        { label: "Win Rate", value: fmtPct(m.win_rate, 1), variant: "green", tooltip: "% of completed trades that closed at a profit" },
        { label: "CAGR", value: fmtPct(m.cagr, 1), variant: m.cagr >= 0 ? "green" : "red", tooltip: "Compound Annual Growth Rate — annualised return of the strategy over the backtest period" },
        { label: "Avg Trade P/L", value: fmtPct(m.avg_trade_pnl_pct), variant: m.avg_trade_pnl_pct >= 0 ? "green" : "red", tooltip: "Average % gain/loss per completed trade" },
        { label: "Best Trade", value: fmtPct(m.max_gain_pct), variant: "green", tooltip: "Single highest-returning trade in the entire backtest" },
        { label: "Avg Duration", value: m.avg_trade_duration_days ? `${Math.round(m.avg_trade_duration_days)}d` : "—", sub: "target exits only", tooltip: "Average days held per trade (target exits only — early exits excluded)" },
        { label: "Stocks Tested", value: summary.stocks_tested, tooltip: "Number of F40 stocks included in this backtest run" },
      ]
    : [];

  const firstTicker = !selectedTicker && stockData?.overview?.length ? stockData.overview[0].ticker : null;
  const displayTicker = selectedTicker ?? firstTicker;
  const displayData = displayTicker && stockData?.stock_data ? stockData.stock_data[displayTicker] : null;

  return (
    <div className="flex flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold">52W Low → High</h1>
          <p className="text-xs text-muted-foreground">
            Buy at 52-week low, exit at 52-week high (fixed target at entry)
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

      {/* Sub-tabs */}
      <Tabs defaultValue="analysis" onValueChange={setActiveTab} className="flex flex-col">
        <TabsList className="mx-6 mt-3 w-fit shrink-0">
          <TabsTrigger value="scanner">
            <Tip content="See which F40 stocks are currently near their 52-week low — live buy opportunities" below>
              <span>Opportunity Scanner</span>
            </Tip>
          </TabsTrigger>
          <TabsTrigger value="analysis">
            <Tip content="Drill into a single stock: see its trade history, open positions, PE chart, and price chart" below>
              <span>Stock Analysis</span>
            </Tip>
          </TabsTrigger>
          <TabsTrigger value="portfolio">
            <Tip content="Simulate running this strategy across the entire F40 portfolio with realistic position sizing" below>
              <span>Portfolio Backtest</span>
            </Tip>
          </TabsTrigger>
        </TabsList>

        {/* Opportunity Scanner */}
        <TabsContent value="scanner" className="px-6 py-4">
          {scanner ? (
            <ScannerTab rows={scanner} runDate={scannerSummary?.run_date} />
          ) : (
            <div className="text-sm text-muted-foreground">Loading scanner…</div>
          )}
        </TabsContent>

        {/* Stock Analysis */}
        <TabsContent value="analysis" className="overflow-hidden">
          {stocksLoading ? (
            <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
              Loading stock data…
            </div>
          ) : (
            <div className="flex h-[calc(100dvh-120px)] overflow-hidden">
              <div className="w-56 shrink-0 border-r border-border overflow-hidden">
                <StockList
                  overview={stockData?.overview ?? []}
                  scannerRows={scanner ?? []}
                  selectedTicker={displayTicker}
                  onSelect={setSelectedTicker}
                />
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {displayData ? (
                  <StockDetail data={displayData} years={horizon} />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    Select a stock to view detail
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Portfolio Backtest */}
        <TabsContent value="portfolio" className="px-6 py-4">
          {portfolioData ? (
            <PortfolioBacktest
              data={portfolioData}
              compareData={compareMap}
              variants={F40_VARIANTS}
              activeVariant={portfolioVariant}
              onVariantChange={setPortfolioVariant}
              showStrategy={portfolioVariant !== "fixed"}
            />
          ) : (
            <div className="text-sm text-muted-foreground">Loading portfolio backtest…</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

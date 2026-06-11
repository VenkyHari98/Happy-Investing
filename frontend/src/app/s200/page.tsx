"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MetricCards, type MetricDef } from "@/components/52w/MetricCards";
import { S200Scanner } from "@/components/s200/S200Scanner";
import { S200BacktestTable } from "@/components/s200/S200BacktestTable";
import { S200StockList } from "@/components/s200/S200StockList";
import { S200StockDetail } from "@/components/s200/S200StockDetail";
import { PortfolioBacktest } from "@/components/portfolio/PortfolioBacktest";
import { api } from "@/lib/api";
import { fmtPct, fmtNum } from "@/lib/format";

type Horizon = "5" | "10";

export default function S200Page() {
  const [horizon, setHorizon] = useState<Horizon>("10");
  const [selectedStockTicker, setSelectedStockTicker] = useState<string | null>(null);

  const { data: btSummary, isLoading: summaryLoading } = useQuery({
    queryKey: ["s200-backtest-summary", horizon],
    queryFn: () => api.backtest.summaryS200(horizon),
  });

  const { data: btStocks, isLoading: stocksLoading } = useQuery({
    queryKey: ["s200-backtest-stocks", horizon],
    queryFn: () => api.backtest.stocksS200(horizon),
  });

  const { data: scanner } = useQuery({
    queryKey: ["scanner-s200"],
    queryFn: api.scanner.s200,
  });

  const { data: portfolioData } = useQuery({
    queryKey: ["portfolio-s200", horizon],
    queryFn: () => api.portfolio.s200(horizon),
  });

  const firstStockTicker = !selectedStockTicker && btStocks?.overview?.length
    ? btStocks.overview[0].ticker
    : null;
  const displayStockTicker = selectedStockTicker ?? firstStockTicker;
  const displayStockData = displayStockTicker && btStocks?.stock_data
    ? btStocks.stock_data[displayStockTicker] ?? null
    : null;
  const displayStockRallies = displayStockTicker && scanner
    ? scanner.rallies.filter((r) => r.ticker === displayStockTicker)
    : [];

  const summaryMetrics: MetricDef[] = btSummary
    ? [
        { label: "Stocks Tested", value: btSummary.stocks_tested, variant: "accent" },
        { label: "Total Rallies", value: btSummary.total_rallies },
        { label: "Entered", value: btSummary.total_entered },
        { label: "Won (Target Hit)", value: btSummary.total_hits, variant: "green" },
        { label: "Zone Entry Rate", value: fmtNum(btSummary.zone_entry_rate_pct) + "%", variant: "amber" },
        { label: "Win Rate", value: fmtNum(btSummary.win_rate_pct) + "%", variant: "green" },
        { label: "Avg P/L", value: fmtPct(btSummary.avg_pnl_pct), variant: btSummary.avg_pnl_pct >= 0 ? "green" : "red" },
        { label: "Avg Days in Trade", value: `${Math.round(btSummary.avg_days_in_trade)}d` },
      ]
    : [];

  return (
    <div className="flex flex-col h-screen">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold">20% Rally</h1>
          <p className="text-xs text-muted-foreground">
            Stocks with 20%+ rallies from recent lows — buy on retest of rally base, target full rally size
          </p>
        </div>
        <div className="flex gap-1 border border-border rounded-md p-0.5">
          {(["5", "10"] as Horizon[]).map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                horizon === h ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {h}Y
            </button>
          ))}
        </div>
      </div>

      {/* Summary metrics */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        {summaryLoading ? (
          <div className="text-xs text-muted-foreground">Loading metrics…</div>
        ) : (
          <MetricCards metrics={summaryMetrics} />
        )}
      </div>

      {/* Sub-tabs */}
      <Tabs defaultValue="scanner" className="flex flex-col flex-1 overflow-hidden">
        <TabsList className="mx-6 mt-3 w-fit shrink-0">
          <TabsTrigger value="scanner">Current Opportunities</TabsTrigger>
          <TabsTrigger value="backtest">Backtest by Stock</TabsTrigger>
          <TabsTrigger value="analysis">Stock Analysis</TabsTrigger>
          <TabsTrigger value="portfolio">Portfolio Backtest</TabsTrigger>
        </TabsList>

        {/* Current Opportunities */}
        <TabsContent value="scanner" className="flex-1 overflow-y-auto px-6 py-4">
          {scanner ? (
            <S200Scanner data={scanner} />
          ) : (
            <div className="text-sm text-muted-foreground">Loading scanner…</div>
          )}
        </TabsContent>

        {/* Backtest by Stock */}
        <TabsContent value="backtest" className="flex-1 overflow-y-auto px-6 py-4">
          {stocksLoading ? (
            <div className="text-sm text-muted-foreground">Loading backtest data…</div>
          ) : btStocks ? (
            <S200BacktestTable overview={btStocks.overview} />
          ) : null}
        </TabsContent>

        {/* Stock Analysis */}
        <TabsContent value="analysis" className="flex-1 overflow-hidden">
          {stocksLoading ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Loading stock data…
            </div>
          ) : (
            <div className="flex h-full">
              <div className="w-56 shrink-0 border-r border-border overflow-hidden">
                <S200StockList
                  overview={btStocks?.overview ?? []}
                  scannerData={scanner ?? null}
                  selectedTicker={displayStockTicker}
                  onSelect={setSelectedStockTicker}
                />
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {displayStockData ? (
                  <S200StockDetail
                    data={displayStockData}
                    currentRallies={displayStockRallies}
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

        {/* Portfolio Backtest */}
        <TabsContent value="portfolio" className="flex-1 overflow-y-auto px-6 py-4">
          {portfolioData ? (
            <PortfolioBacktest data={portfolioData} />
          ) : (
            <div className="text-sm text-muted-foreground">Loading portfolio backtest…</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

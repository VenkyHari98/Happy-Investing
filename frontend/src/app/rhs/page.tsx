"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MetricCards, type MetricDef } from "@/components/52w/MetricCards";
import { RHSScanner } from "@/components/rhs/RHSScanner";
import { RHSBacktestTable } from "@/components/rhs/RHSBacktestTable";
import { RHSStockList } from "@/components/rhs/RHSStockList";
import { RHSStockDetail } from "@/components/rhs/RHSStockDetail";
import { api } from "@/lib/api";
import { fmtPct, fmtNum } from "@/lib/format";

export default function RHSPage() {
  const [activeTab, setActiveTab]       = useState("scanner");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const { data: scanner }  = useQuery({ queryKey: ["rhs-scanner"],  queryFn: api.rhs.scanner });
  const { data: summary, isLoading: sumLoading } = useQuery({ queryKey: ["rhs-summary"],  queryFn: api.rhs.summary });
  const { data: stocks,  isLoading: stocksLoading } = useQuery({ queryKey: ["rhs-stocks"],   queryFn: api.rhs.stocks });

  const firstTicker     = !selectedTicker && stocks?.overview?.length ? stocks.overview[0].ticker : null;
  const displayTicker   = selectedTicker ?? firstTicker;
  const displayData     = displayTicker && stocks?.stock_data ? stocks.stock_data[displayTicker] ?? null : null;
  const displayOpps     = scanner?.opportunities.filter((o) => o.ticker === displayTicker) ?? [];

  const handleSelect = (ticker: string) => {
    setSelectedTicker(ticker);
    setActiveTab("analysis");
  };

  const metrics: MetricDef[] = summary
    ? [
        { label: "Stocks Tested",    value: summary.stocks_tested,   variant: "accent", tooltip: "F40 + E40 stocks scanned" },
        { label: "Completed Trades", value: summary.total_trades,                        tooltip: "Simulated trades that hit target" },
        { label: "Win Rate",         value: fmtNum(summary.metrics.win_rate) + "%", variant: "green", tooltip: "% of trades that reached the target" },
        { label: "Avg P/L",          value: fmtPct(summary.metrics.avg_trade_pnl_pct), variant: summary.metrics.avg_trade_pnl_pct >= 0 ? "green" : "red", tooltip: "Average % return per completed trade" },
        { label: "Best Trade",       value: fmtPct(summary.metrics.max_gain_pct), variant: "green", tooltip: "Best single trade return" },
        { label: "CAGR",             value: fmtPct(summary.metrics.cagr),         variant: summary.metrics.cagr >= 0 ? "green" : "red", tooltip: "Compound annual growth rate" },
        { label: "Avg Duration",     value: `${Math.round(summary.metrics.avg_trade_duration_days)}d`, tooltip: "Average trade holding period" },
        { label: "Open Positions",   value: summary.open_positions, variant: "amber", tooltip: "Still holding (target not yet reached)" },
      ]
    : [];

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold">RHS / Cup with Handle</h1>
          <p className="text-xs text-muted-foreground">
            Reverse Head & Shoulder and Cup With Handle pattern scanner for F40 + E40.
            Buy on neckline breakout, target = depth projected above neckline.
          </p>
        </div>
      </div>

      {/* Metrics */}
      {activeTab !== "analysis" && (
        <div className="px-6 py-3 border-b border-border shrink-0">
          {sumLoading ? (
            <p className="text-xs text-muted-foreground">Loading metrics…</p>
          ) : summary ? (
            <MetricCards metrics={metrics} />
          ) : (
            <p className="text-xs text-muted-foreground">
              No backtest data yet — run{" "}
              <code className="bg-muted px-1 rounded text-[10px]">python Scripts/strategies/f40_backtest_rhs_cwh.py</code>{" "}
              to generate.
            </p>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col">
        <TabsList className="mx-6 mt-3 w-fit shrink-0">
          <TabsTrigger value="scanner">Current Opportunities</TabsTrigger>
          <TabsTrigger value="backtest">Backtest by Stock</TabsTrigger>
          <TabsTrigger value="analysis">Stock Analysis</TabsTrigger>
        </TabsList>

        {/* Scanner */}
        <TabsContent value="scanner" className="px-6 py-4">
          {scanner ? (
            <RHSScanner data={scanner} onSelectTicker={handleSelect} />
          ) : (
            <p className="text-sm text-muted-foreground">Loading scanner… (run engine if data is missing)</p>
          )}
        </TabsContent>

        {/* Backtest table */}
        <TabsContent value="backtest" className="px-6 py-4">
          {stocksLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : stocks?.overview ? (
            <RHSBacktestTable overview={stocks.overview} onSelect={handleSelect} />
          ) : (
            <p className="text-sm text-muted-foreground">No backtest data. Run the engine first.</p>
          )}
        </TabsContent>

        {/* Stock analysis */}
        <TabsContent value="analysis" className="overflow-hidden">
          {stocksLoading ? (
            <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="flex h-[calc(100dvh-120px)] overflow-hidden">
              <div className="w-56 shrink-0 border-r border-border overflow-hidden">
                <RHSStockList
                  overview={stocks?.overview ?? []}
                  scannerData={scanner ?? null}
                  selectedTicker={displayTicker}
                  onSelect={setSelectedTicker}
                />
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {displayData ? (
                  <RHSStockDetail data={displayData} currentOpportunities={displayOpps} />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    Select a stock to view detail
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

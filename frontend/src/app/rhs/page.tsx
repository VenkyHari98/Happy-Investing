"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RHSScanner } from "@/components/rhs/RHSScanner";
import { RHSBacktestTable } from "@/components/rhs/RHSBacktestTable";
import { RHSStockList } from "@/components/rhs/RHSStockList";
import { RHSStockDetail } from "@/components/rhs/RHSStockDetail";
import { api } from "@/lib/api";
import { StaleBanner } from "@/components/shared/StaleBanner";
import { BACKTEST_FEATURES_ENABLED, STOCK_ANALYSIS_ENABLED } from "@/lib/featureFlags";

export default function RHSPage() {
  const [activeTab, setActiveTab]       = useState("scanner");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const { data: scanner }  = useQuery({ queryKey: ["rhs-scanner"],  queryFn: api.rhs.scanner });
  const { data: stocks,  isLoading: stocksLoading } = useQuery({
    queryKey: ["rhs-stocks"],
    queryFn: api.rhs.stocks,
    enabled: BACKTEST_FEATURES_ENABLED || STOCK_ANALYSIS_ENABLED,
  });

  const firstTicker     = !selectedTicker && stocks?.overview?.length ? stocks.overview[0].ticker : null;
  const displayTicker   = selectedTicker ?? firstTicker;
  const displayData     = displayTicker && stocks?.stock_data ? stocks.stock_data[displayTicker] ?? null : null;
  const displayOpps     = scanner?.opportunities.filter((o) => o.ticker === displayTicker) ?? [];

  const handleSelect = (ticker: string) => {
    setSelectedTicker(ticker);
    if (STOCK_ANALYSIS_ENABLED) setActiveTab("analysis");
  };

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

      <StaleBanner runDate={scanner?.run_date} strategy="RHS/CWH" />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col">
        <TabsList className="mx-6 mt-3 w-fit shrink-0">
          <TabsTrigger value="scanner">Current Opportunities</TabsTrigger>
          {BACKTEST_FEATURES_ENABLED && <TabsTrigger value="backtest">Backtest by Stock</TabsTrigger>}
          {STOCK_ANALYSIS_ENABLED && <TabsTrigger value="analysis">Stock Analysis</TabsTrigger>}
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
        {BACKTEST_FEATURES_ENABLED && (
          <TabsContent value="backtest" className="px-6 py-4">
            {stocksLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : stocks?.overview ? (
              <RHSBacktestTable overview={stocks.overview} onSelect={handleSelect} />
            ) : (
              <p className="text-sm text-muted-foreground">No backtest data. Run the engine first.</p>
            )}
          </TabsContent>
        )}

        {/* Stock analysis */}
        {STOCK_ANALYSIS_ENABLED && (
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
        )}
      </Tabs>
    </div>
  );
}

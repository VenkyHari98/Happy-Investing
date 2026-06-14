"use client";
import type { RHSStockOverview, RHSScannerData } from "@/lib/types";

interface Props {
  overview: RHSStockOverview[];
  scannerData: RHSScannerData | null;
  selectedTicker: string | null | undefined;
  onSelect: (ticker: string) => void;
}

export function RHSStockList({ overview, scannerData, selectedTicker, onSelect }: Props) {
  const activeSet = new Set(scannerData?.opportunities.map((o) => o.ticker) ?? []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border shrink-0">
        {overview.length} stocks
      </div>
      <div className="flex-1 overflow-y-auto">
        {overview.map((s) => {
          const hasPattern = s.rhs_count + s.cwh_count > 0;
          const isActive   = activeSet.has(s.ticker);
          const isSelected = s.ticker === selectedTicker;
          return (
            <button
              key={s.ticker}
              onClick={() => onSelect(s.ticker)}
              className={`w-full text-left px-3 py-2 text-xs border-b border-border/40 hover:bg-muted/30 transition-colors ${
                isSelected ? "bg-primary/10 text-primary font-medium border-l-2 border-primary" : "text-foreground"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-medium truncate">{s.ticker}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" title="Current opportunity" />
                  )}
                  {hasPattern && (
                    <span className="text-[9px] text-muted-foreground">
                      {s.rhs_count > 0 && <span className="text-orange-400">{s.rhs_count}R</span>}
                      {s.cwh_count > 0 && <span className="text-blue-400 ml-0.5">{s.cwh_count}C</span>}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex justify-between text-muted-foreground mt-0.5">
                <span>{s.cap_tier.replace(" Cap", "")}</span>
                <span className={s.trades_count > 0 ? (s.total_pnl >= 0 ? "text-green-400" : "text-red-400") : ""}>
                  {s.trades_count > 0 ? `${s.trades_count}T` : "—"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";
import type { RHSStockOverview } from "@/lib/types";

interface Props {
  overview: RHSStockOverview[];
  onSelect?: (ticker: string) => void;
}

export function RHSBacktestTable({ overview, onSelect }: Props) {
  const sorted = [...overview].sort((a, b) => b.total_pnl - a.total_pnl);

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/30 border-b border-border">
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Ticker</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Cap Tier</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Sector</th>
            <th className="text-right px-3 py-2 font-medium text-muted-foreground">RHS</th>
            <th className="text-right px-3 py-2 font-medium text-muted-foreground">CWH</th>
            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Trades</th>
            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Open</th>
            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total P/L</th>
            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Close</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <tr
              key={s.ticker}
              className="border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
              onClick={() => onSelect?.(s.ticker)}
            >
              <td className="px-3 py-2 font-medium text-foreground">{s.ticker}</td>
              <td className="px-3 py-2 text-muted-foreground">{s.cap_tier}</td>
              <td className="px-3 py-2 text-muted-foreground truncate max-w-[120px]">{s.sector}</td>
              <td className="px-3 py-2 text-right tabular-nums text-orange-400">{s.rhs_count}</td>
              <td className="px-3 py-2 text-right tabular-nums text-blue-400">{s.cwh_count}</td>
              <td className="px-3 py-2 text-right tabular-nums">{s.trades_count}</td>
              <td className="px-3 py-2 text-right tabular-nums text-amber-400">{s.open_count}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-medium ${s.total_pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                {s.total_pnl >= 0 ? "+" : ""}₹{Math.round(s.total_pnl).toLocaleString("en-IN")}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                ₹{s.latest_close.toLocaleString("en-IN")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

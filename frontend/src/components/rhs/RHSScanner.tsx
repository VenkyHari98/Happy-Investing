"use client";
import type { RHSScannerData, RHSOpportunity } from "@/lib/types";

interface Props {
  data: RHSScannerData;
  onSelectTicker?: (ticker: string) => void;
}

const STATUS_STYLE: Record<string, string> = {
  BREAKOUT: "bg-green-500/15 text-green-400 border border-green-500/30",
  FORMING:  "bg-amber-500/15 text-amber-400 border border-amber-500/30",
};

const TYPE_STYLE: Record<string, string> = {
  RHS: "bg-orange-500/15 text-orange-400",
  CWH: "bg-blue-500/15 text-blue-400",
};

export function RHSScanner({ data, onSelectTicker }: Props) {
  const { opportunities } = data;

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="bg-muted/40 px-2 py-0.5 rounded">
          Scanned: <span className="text-foreground font-medium">{data.stocks_scanned}</span>
        </span>
        <span className="bg-green-500/10 text-green-400 px-2 py-0.5 rounded">
          Breakout: {data.breakout_count}
        </span>
        <span className="bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded">
          Forming: {data.forming_count}
        </span>
        <span className="bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded">
          RHS: {data.rhs_count}
        </span>
        <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded">
          CWH: {data.cwh_count}
        </span>
        <span className="ml-auto text-muted-foreground">Run: {data.run_date}</span>
      </div>

      {opportunities.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          No current RHS or CWH patterns detected.
          <p className="text-xs mt-1">Run the backtest engine to generate scanner data.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Ticker</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Pattern</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Price</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Neckline</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">% to Neckline</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Target</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Upside</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Pattern Start</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Cap Tier</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((opp, i) => {
                const upside = ((opp.target - opp.current_price) / opp.current_price * 100).toFixed(1);
                return (
                  <tr
                    key={`${opp.ticker}-${opp.pattern_type}-${i}`}
                    className="border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
                    onClick={() => onSelectTicker?.(opp.ticker)}
                  >
                    <td className="px-3 py-2 font-medium text-foreground">{opp.ticker}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TYPE_STYLE[opp.pattern_type] ?? ""}`}>
                        {opp.pattern_type}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_STYLE[opp.status] ?? ""}`}>
                        {opp.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">₹{opp.current_price.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-400">₹{opp.neckline.toLocaleString("en-IN")}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${opp.pct_to_neckline < 0 ? "text-green-400" : "text-muted-foreground"}`}>
                      {opp.pct_to_neckline > 0 ? "+" : ""}{opp.pct_to_neckline.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-400">₹{opp.target.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-400">+{upside}%</td>
                    <td className="px-3 py-2 text-muted-foreground">{opp.pattern_start_date}</td>
                    <td className="px-3 py-2 text-muted-foreground">{opp.cap_tier}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Algorithmic pre-screen only — confirm visually on TradingView before trading.
        FORMING = pattern detected, no breakout yet. BREAKOUT = neckline crossed within last 30 days.
      </p>
    </div>
  );
}

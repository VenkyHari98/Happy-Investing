import { Card, CardContent } from "@/components/ui/card";
import type { CapTierStats } from "@/lib/types";
import { fmtPct, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  byCapTier: Record<string, CapTierStats>;
}

export function CapTierBreakdown({ byCapTier }: Props) {
  const tiers = ["Large Cap", "Mid Cap", "Small Cap"].filter((t) => byCapTier[t]);

  return (
    <div>
      <h3 className="text-sm font-medium text-muted-foreground mb-2">Performance by Cap Tier</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {tiers.map((tier) => {
          const s = byCapTier[tier];
          return (
            <Card key={tier} className="bg-card/60">
              <CardContent className="px-4 py-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{tier.replace(" Cap", "")}</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  <span className="text-muted-foreground">Trades</span>
                  <span className="text-right tabular-nums">{s.count}</span>
                  <span className="text-muted-foreground">Won</span>
                  <span className="text-right tabular-nums text-green-400">{s.wins}</span>
                  <span className="text-muted-foreground">Win Rate</span>
                  <span
                    className={cn(
                      "text-right tabular-nums font-medium",
                      s.win_rate_pct >= 80 ? "text-green-400" : s.win_rate_pct >= 60 ? "text-amber-400" : "text-red-400"
                    )}
                  >
                    {fmtNum(s.win_rate_pct)}%
                  </span>
                  <span className="text-muted-foreground">Avg P/L</span>
                  <span
                    className={cn(
                      "text-right tabular-nums",
                      s.avg_pnl_pct >= 0 ? "text-green-400" : "text-red-400"
                    )}
                  >
                    {fmtPct(s.avg_pnl_pct)}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCards, type MetricDef } from "@/components/52w/MetricCards";
import { EquityCurve } from "./EquityCurve";
import { YearlyReturns } from "./YearlyReturns";
import { CapTierBreakdown } from "./CapTierBreakdown";
import { PortfolioTradeLog } from "./PortfolioTradeLog";
import type { PortfolioBacktestData } from "@/lib/types";
import { Tip } from "@/components/ui/tooltip";
import { fmtCur, fmtPct, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

interface VariantOption {
  key: string;
  label: string;
  tooltip?: string;
}

const VARIANT_TIPS: Record<string, string> = {
  "52W Only": "Backtest using only the 52-week Low/High strategy",
  "+Envelope Long": "Add the Envelope strategy on top of the 52W base",
  "+Rally F40": "Add the S200 Rally strategy (F40 stocks only) on top of the 52W base",
  "All 3 Combined": "Run all three strategies together — 52W Low/High + Envelope + S200 Rally",
};

interface Props {
  data: PortfolioBacktestData;
  compareData?: Record<string, PortfolioBacktestData | undefined>;
  variants?: VariantOption[];
  activeVariant?: string;
  onVariantChange?: (v: string) => void;
  showStrategy?: boolean;
}

export function PortfolioBacktest({
  data,
  compareData,
  variants,
  activeVariant,
  onVariantChange,
  showStrategy = false,
}: Props) {
  const s = data.summary;
  const baseCAGR = s.cagr_pct;

  const metrics: MetricDef[] = [
    { label: "Total Trades", value: s.total_trades, variant: "accent", tooltip: "All completed buy→sell cycles across all stocks in this portfolio backtest" },
    { label: "Wins", value: s.wins, variant: "green", tooltip: "Number of trades that closed at a profit" },
    { label: "Win Rate", value: fmtNum(s.win_rate_pct) + "%", variant: s.win_rate_pct >= 80 ? "green" : "amber", tooltip: "% of completed trades that were profitable" },
    { label: "CAGR", value: fmtPct(s.cagr_pct, 1), variant: s.cagr_pct >= 0 ? "green" : "red", tooltip: "Compound Annual Growth Rate — the annualised return of this portfolio strategy" },
    { label: "Total P/L", value: fmtCur(s.final_value - s.initial_capital), variant: s.final_value > s.initial_capital ? "green" : "red", tooltip: "Total ₹ profit/loss across all completed trades in the backtest" },
    { label: "Avg Trade P/L", value: fmtPct(s.avg_trade_pnl_pct), variant: s.avg_trade_pnl_pct >= 0 ? "green" : "red", tooltip: "Average % return per trade — measures per-trade consistency" },
    { label: "Max Drawdown", value: fmtPct(-Math.abs(s.max_drawdown_pct)), variant: "red", tooltip: "Largest peak-to-trough drop in portfolio value during the backtest — key risk metric" },
    { label: "Time in Market", value: fmtNum(s.time_in_market_pct) + "%", sub: "avg deployed", tooltip: "Average % of capital deployed at any point — higher means the strategy keeps capital working" },
  ];

  return (
    <div className="space-y-5">
      {/* Variant selector with diff badges */}
      {variants && variants.length > 1 && onVariantChange && (
        <div className="flex gap-2 flex-wrap">
          {variants.map((v) => {
            const vData = compareData?.[v.key];
            const diffCAGR = vData ? vData.summary.cagr_pct - baseCAGR : null;
            const isActive = activeVariant === v.key;
            const tip = v.tooltip ?? VARIANT_TIPS[v.label];
            const btn = (
              <button
                onClick={() => onVariantChange(v.key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                )}
              >
                {v.label}
                {!isActive && diffCAGR != null && (
                  <Tip content="CAGR difference vs the currently selected variant">
                    <span
                      className={cn(
                        "text-xs px-1 rounded",
                        diffCAGR > 0 ? "text-green-400" : "text-red-400"
                      )}
                    >
                      {diffCAGR > 0 ? "+" : ""}
                      {diffCAGR.toFixed(1)}%
                    </span>
                  </Tip>
                )}
              </button>
            );
            if (tip) return <Tip key={v.key} content={tip} below>{btn}</Tip>;
            return <span key={v.key}>{btn}</span>;
          })}
        </div>
      )}

      {/* Summary metrics */}
      <MetricCards metrics={metrics} />

      {/* Yearly returns */}
      <YearlyReturns yearlyReturns={s.yearly_returns} />

      {/* Equity curve */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Portfolio Equity Curve
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          <EquityCurve data={data.equity_curve} initialCapital={s.initial_capital} />
        </CardContent>
      </Card>

      {/* Cap tier breakdown */}
      <CapTierBreakdown byCapTier={s.by_cap_tier} />

      {/* Trade log */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">
          Full Trade Log ({data.trades.length} trades)
        </h3>
        <PortfolioTradeLog trades={data.trades} showStrategy={showStrategy} />
      </div>
    </div>
  );
}

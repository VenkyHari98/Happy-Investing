"use client";
import { useMemo, useState } from "react";
import { StockChart, type ChartPoint, type TradeMarker } from "@/components/charts/StockChart";
import { MetricCards, type MetricDef } from "@/components/52w/MetricCards";
import { TradeLog } from "@/components/52w/TradeLog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type StockDetail as StockDetailType } from "@/lib/types";
import { fmtCur, fmtPct, fmtNum, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type TimeRange = "1Y" | "3Y" | "All";

interface StockDetailProps {
  data: StockDetailType;
  years?: "5" | "10";
}

export function StockDetail({ data, years = "10" }: StockDetailProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("All");

  const trades = data.trades ?? [];
  const openPos = data.open_positions ?? [];
  const wins = trades.filter((t) => t.pnl_pct > 0).length;
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;
  const avgDur = trades.length
    ? trades.reduce((s, t) => s + t.trade_duration_days, 0) / trades.length
    : 0;
  const avgPnl = trades.length
    ? trades.reduce((s, t) => s + t.pnl_pct, 0) / trades.length
    : 0;
  const bestTrade = trades.length ? Math.max(...trades.map((t) => t.pnl_pct)) : null;

  const metrics: MetricDef[] = [
    { label: "Completed Trades", value: trades.length, variant: "accent" },
    { label: "Open Positions", value: openPos.length, variant: openPos.length ? "amber" : "default" },
    { label: "Win Rate", value: `${winRate.toFixed(1)}%`, variant: "green" },
    { label: "Total P/L", value: fmtCur(data.total_pnl), variant: data.total_pnl >= 0 ? "green" : "red" },
    { label: "Avg Trade P/L", value: fmtPct(avgPnl), variant: avgPnl >= 0 ? "green" : "red" },
    { label: "Best Trade", value: fmtPct(bestTrade), variant: "green" },
    { label: "Avg Duration", value: avgDur ? `${Math.round(avgDur)}d` : "—" },
    { label: "Latest Close", value: fmtCur(data.latest_close) },
    { label: "Current PE", value: data.pe_current != null ? fmtNum(data.pe_current) + "x" : "—" },
    { label: "3Yr Avg PE", value: data.pe_3yr_avg != null ? fmtNum(data.pe_3yr_avg) + "x" : "—", sub: "3yr historical" },
    { label: "5Yr Avg PE", value: data.pe_5yr_avg != null ? fmtNum(data.pe_5yr_avg) + "x" : "—", sub: "5yr historical" },
  ];

  // Build chart series — filter by time range
  const allPrices = data.prices ?? [];
  const cutoffDate = useMemo(() => {
    if (timeRange === "All") return null;
    const now = new Date();
    const years = timeRange === "1Y" ? 1 : 3;
    now.setFullYear(now.getFullYear() - years);
    return now.toISOString().slice(0, 10);
  }, [timeRange]);

  const prices = useMemo(
    () => (cutoffDate ? allPrices.filter((p) => p.date >= cutoffDate) : allPrices),
    [allPrices, cutoffDate]
  );

  const pricePoints: ChartPoint[] = useMemo(
    () => prices.map((p) => ({ time: p.date, value: p.close })),
    [prices]
  );
  const w52LowPoints: ChartPoint[] = useMemo(
    () => prices.filter((p) => p.w52_low != null).map((p) => ({ time: p.date, value: p.w52_low! })),
    [prices]
  );
  const w52HighPoints: ChartPoint[] = useMemo(
    () => prices.filter((p) => p.w52_high != null).map((p) => ({ time: p.date, value: p.w52_high! })),
    [prices]
  );
  const ma200Points: ChartPoint[] = useMemo(
    () => prices.filter((p) => p.ma200 != null).map((p) => ({ time: p.date, value: p.ma200! })),
    [prices]
  );

  const markers: TradeMarker[] = useMemo(
    () => [
      ...trades
        .filter((t) => t.entry_date && (!cutoffDate || t.entry_date >= cutoffDate))
        .map((t) => ({ time: t.entry_date, type: "entry" as const, price: t.entry_price })),
      ...trades
        .filter((t) => t.exit_date && (!cutoffDate || t.exit_date >= cutoffDate))
        .map((t) => ({ time: t.exit_date!, type: "exit" as const, price: t.exit_price! })),
      ...(data.skipped_entries ?? [])
        .filter((e) => !cutoffDate || e.date >= cutoffDate)
        .map((e) => ({ time: e.date, type: "skipped" as const, price: e.price, label: "M" })),
    ],
    [trades, data.skipped_entries, cutoffDate]
  );

  return (
    <div className="space-y-4">
      {/* Stock header */}
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold font-mono text-primary">{data.ticker}</h2>
        <Badge variant="outline">{data.cap_tier?.replace(" Cap", "")}</Badge>
        <span className="text-sm text-muted-foreground">{data.sector}</span>
        <span className="text-sm text-muted-foreground ml-auto">
          as of {fmtDate(data.latest_date)}
        </span>
      </div>

      {/* Metrics */}
      <MetricCards metrics={metrics} />

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Price · 52W Low/High · 200 DMA
              <span className="ml-3 text-[10px] space-x-3">
                <span className="text-green-400">■ B = Buy entry</span>
                <span className="text-red-400">■ S = Sell (target hit)</span>
                <span className="text-gray-500">● M = Missed (limit full)</span>
              </span>
            </CardTitle>
            {/* Time range buttons */}
            <div className="flex gap-1 border border-border rounded p-0.5">
              {(["1Y", "3Y", "All"] as TimeRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setTimeRange(r)}
                  className={cn(
                    "px-2 py-0.5 text-xs rounded transition-colors",
                    timeRange === r
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          <StockChart
            prices={pricePoints}
            w52Low={w52LowPoints}
            w52High={w52HighPoints}
            ma200={ma200Points}
            markers={markers}
            height={320}
            ticker={data.ticker}
          />
        </CardContent>
      </Card>

      {/* Open positions — full detail */}
      {openPos.length > 0 && (
        <Card className="border-amber-500/20">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-amber-400">
              Open Positions ({openPos.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {openPos.map((p, i) => (
              <div key={i} className="grid grid-cols-3 sm:grid-cols-7 gap-2 text-xs border border-amber-500/10 rounded p-2 bg-amber-500/5">
                <div>
                  <div className="text-muted-foreground">Entry Date</div>
                  <div className="tabular-nums font-medium">{fmtDate(p.entry_date)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Entry ₹</div>
                  <div className="tabular-nums font-medium">{fmtCur(p.entry_price)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Fixed Target</div>
                  <div className="tabular-nums text-purple-400">{fmtCur(p.target_price)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Current ₹</div>
                  <div className="tabular-nums">{fmtCur(data.latest_close)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Days Held</div>
                  <div className="tabular-nums">
                    {Math.round((new Date().getTime() - new Date(p.entry_date).getTime()) / 86400000)}d
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Unrealised</div>
                  <div className={cn("tabular-nums font-medium", p.unrealised_pct >= 0 ? "text-green-400" : "text-red-400")}>
                    {fmtPct(p.unrealised_pct)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">% to Target</div>
                  <div className="tabular-nums text-amber-400">
                    {p.target_price && data.latest_close
                      ? fmtPct(((p.target_price - data.latest_close) / data.latest_close) * 100)
                      : "—"}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Trade log */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Completed Trades ({trades.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          <TradeLog trades={trades} />
        </CardContent>
      </Card>
    </div>
  );
}

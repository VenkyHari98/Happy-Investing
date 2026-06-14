"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StockChart, type ChartPoint, type TradeMarker } from "@/components/charts/StockChart";
import { TradeLog } from "@/components/52w/TradeLog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { type StockDetail as StockDetailType } from "@/lib/types";
import { api } from "@/lib/api";
import { fmtCur, fmtPct, fmtNum, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type TimeRange = "1Y" | "3Y" | "All";

interface StockDetailProps {
  data: StockDetailType;
  years?: "5" | "10";
}

export function StockDetail({ data, years = "10" }: StockDetailProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("All");

  const { data: peData } = useQuery({
    queryKey: ["pe", data.ticker],
    queryFn: () => api.fundamentals.pe(data.ticker, 10),
    staleTime: 7 * 24 * 60 * 60 * 1000, // weekly — matches backend PE cache TTL
  });

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

  const pePoints: ChartPoint[] = useMemo(() => {
    if (!peData?.pe_series?.length) return [];
    return peData.pe_series
      .filter((p) => !cutoffDate || p.date >= cutoffDate)
      .map((p) => ({ time: p.date, value: p.pe }));
  }, [peData, cutoffDate]);

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
        <span className="text-xs text-muted-foreground ml-auto">as of {fmtDate(data.latest_date)}</span>
      </div>

      {/* Compact stat strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs -mt-1">
        <span className="text-muted-foreground">
          <span className="text-foreground font-medium tabular-nums">{trades.length}</span> trades
        </span>
        {openPos.length > 0 && (
          <span className="text-amber-400 font-medium">{openPos.length} open</span>
        )}
        <span className="text-muted-foreground">
          WR <span className={cn("font-medium", winRate >= 60 ? "text-green-400" : "text-amber-400")}>{winRate.toFixed(1)}%</span>
        </span>
        <span className="text-muted-foreground">
          Avg P/L <span className={cn("font-medium", avgPnl >= 0 ? "text-green-400" : "text-red-400")}>{fmtPct(avgPnl)}</span>
        </span>
        <span className="text-muted-foreground">
          Best <span className="text-green-400 font-medium">{fmtPct(bestTrade)}</span>
        </span>
        <span className="text-muted-foreground">
          Hold <span className="font-medium">{avgDur ? `${Math.round(avgDur)}d` : "—"}</span>
        </span>
        <span className="ml-auto flex items-center gap-x-3 text-muted-foreground">
          {data.pe_current != null && (
            <span>PE <span className="font-medium text-foreground">{fmtNum(data.pe_current)}x</span></span>
          )}
          {data.pe_3yr_avg != null && (
            <span>3yr <span className="font-medium">{fmtNum(data.pe_3yr_avg)}x</span></span>
          )}
          {data.pe_5yr_avg != null && (
            <span>5yr <span className="font-medium">{fmtNum(data.pe_5yr_avg)}x</span></span>
          )}
        </span>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Price · 52W Low/High · 200 DMA
              <span className="ml-3 text-[10px] space-x-3">
                <Tip content="Strategy bought here — price touched the rolling 52-week low">
                  <span className="text-green-400 cursor-default">■ B = Buy entry</span>
                </Tip>
                <Tip content="Strategy sold here — price reached the 52W high that was locked in at the time of buying">
                  <span className="text-red-400 cursor-default">■ S = Sell (target hit)</span>
                </Tip>
                <Tip content="Stock touched the low again but was skipped — maximum positions for this stock were already open at the time">
                  <span className="text-gray-500 cursor-default">● M = Missed (limit full)</span>
                </Tip>
              </span>
            </CardTitle>
            {/* Time range buttons */}
            <div className="flex gap-1 border border-border rounded p-0.5">
              {(["1Y", "3Y", "All"] as TimeRange[]).map((r) => (
                <Tip
                  key={r}
                  content={r === "1Y" ? "Show last 1 year of price history" : r === "3Y" ? "Show last 3 years of price history" : "Show full available history"}
                  below
                >
                  <button
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
                </Tip>
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
            pePoints={pePoints.length ? pePoints : undefined}
            peMedian={peData?.median_5y ?? undefined}
            markers={markers}
            height={500}
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
                  <Tip content="The 52W high at the time of buying — this is the fixed sell target the strategy is waiting to hit">
                    <div className="text-muted-foreground cursor-default">Fixed Target</div>
                  </Tip>
                  <div className="tabular-nums text-purple-400">{fmtCur(p.target_price)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Current ₹</div>
                  <div className="tabular-nums">{fmtCur(data.latest_close)}</div>
                </div>
                <div>
                  <Tip content="Number of calendar days this position has been open since the buy date">
                    <div className="text-muted-foreground cursor-default">Days Held</div>
                  </Tip>
                  <div className="tabular-nums">
                    {Math.round((new Date().getTime() - new Date(p.entry_date).getTime()) / 86400000)}d
                  </div>
                </div>
                <div>
                  <Tip content="Current mark-to-market gain/loss on this open position (based on today's close vs entry price)">
                    <div className="text-muted-foreground cursor-default">Unrealised</div>
                  </Tip>
                  <div className={cn("tabular-nums font-medium", p.unrealised_pct >= 0 ? "text-green-400" : "text-red-400")}>
                    {fmtPct(p.unrealised_pct)}
                  </div>
                </div>
                <div>
                  <Tip content="How much further the price needs to rise to hit the fixed sell target">
                    <div className="text-muted-foreground cursor-default">% to Target</div>
                  </Tip>
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

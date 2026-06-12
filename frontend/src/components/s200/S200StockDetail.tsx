"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MetricCards, type MetricDef } from "@/components/52w/MetricCards";
import { StockChart, type ChartPoint, type TradeMarker } from "@/components/charts/StockChart";
import type { S200StockDetailData, S200Rally, S200Status } from "@/lib/types";
import { api } from "@/lib/api";
import { fmtPct, fmtNum, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type TimeRange = "1Y" | "3Y" | "All";

const STATUS_COLORS: Record<S200Status, string> = {
  IN_ZONE: "bg-green-500/20 text-green-400 border-green-500/30",
  APPROACHING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  WATCHING_NEAR: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  WATCHING: "bg-muted text-muted-foreground border-border",
  BELOW_BUY: "bg-rose-500/20 text-rose-400 border-rose-500/30",
};

const STATUS_LABELS: Record<S200Status, string> = {
  IN_ZONE: "In Zone",
  APPROACHING: "Approaching",
  WATCHING_NEAR: "Near",
  WATCHING: "Watching",
  BELOW_BUY: "Below Buy",
};

const OUTCOME_COLORS: Record<string, string> = {
  TARGET_HIT: "text-green-400",
  EXPIRED: "text-rose-400",
  NOT_ENTERED: "text-muted-foreground",
};

interface Props {
  data: S200StockDetailData;
  currentRallies: S200Rally[];
  years?: "5" | "10";
}

export function S200StockDetail({ data, currentRallies, years = "10" }: Props) {
  const [timeRange, setTimeRange] = useState<TimeRange>("All");
  const { metrics: m, trades } = data;

  const { data: ohlcv, isLoading: ohlcvLoading } = useQuery({
    queryKey: ["ohlcv", data.ticker, years],
    queryFn: () => api.ohlcv(data.ticker, parseInt(years)),
    staleTime: 1000 * 60 * 60, // 1 hour — price data doesn't change mid-session
  });

  const { data: peData } = useQuery({
    queryKey: ["pe", data.ticker],
    queryFn: () => api.fundamentals.pe(data.ticker, 10),
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });

  const metricCards: MetricDef[] = [
    { label: "Total Rallies", value: m.total_rallies, variant: "accent" },
    { label: "Entered", value: m.entered },
    { label: "Won (Target Hit)", value: m.target_hit, variant: "green" },
    { label: "Expired", value: m.expired, variant: m.expired > 0 ? "red" : "default" },
    { label: "Zone Entry Rate", value: fmtNum(m.zone_entry_rate_pct) + "%", variant: "amber" },
    { label: "Win Rate", value: fmtNum(m.win_rate_pct) + "%", variant: m.win_rate_pct >= 70 ? "green" : "amber" },
    { label: "Avg P/L", value: fmtPct(m.avg_pnl_pct), variant: m.avg_pnl_pct >= 0 ? "green" : "red" },
    { label: "Avg Days in Trade", value: `${Math.round(m.avg_days_in_trade)}d` },
  ];

  // Time range cutoff
  const cutoffDate = useMemo(() => {
    if (timeRange === "All") return null;
    const d = new Date();
    d.setFullYear(d.getFullYear() - (timeRange === "1Y" ? 1 : 3));
    return d.toISOString().slice(0, 10);
  }, [timeRange]);

  // Build chart series from OHLCV
  const pricePoints: ChartPoint[] = useMemo(() => {
    if (!ohlcv) return [];
    return ohlcv
      .filter((p) => !cutoffDate || p.date >= cutoffDate)
      .map((p) => ({ time: p.date, value: p.close }));
  }, [ohlcv, cutoffDate]);

  const ma200Points: ChartPoint[] = useMemo(() => {
    if (!ohlcv) return [];
    return ohlcv
      .filter((p) => p.ma200 != null && (!cutoffDate || p.date >= cutoffDate))
      .map((p) => ({ time: p.date, value: p.ma200! }));
  }, [ohlcv, cutoffDate]);

  const pePoints: ChartPoint[] = useMemo(() => {
    if (!peData?.pe_series?.length) return [];
    return peData.pe_series
      .filter((p) => !cutoffDate || p.date >= cutoffDate)
      .map((p) => ({ time: p.date, value: p.pe }));
  }, [peData, cutoffDate]);

  // Markers: RS (rally base, amber), R (rally peak, purple), B (buy, green), S (sell, red), M (missed, grey)
  const markers: TradeMarker[] = useMemo(() => {
    const result: TradeMarker[] = [];
    for (const t of trades) {
      if (cutoffDate && t.rally_end_date < cutoffDate) continue;
      // Rally start marker — only if different date from rally end (multi-candle rallies)
      if (t.rally_start_date && t.rally_start_date !== t.rally_end_date &&
          (!cutoffDate || t.rally_start_date >= cutoffDate)) {
        result.push({ time: t.rally_start_date, type: "rallyStart", price: 0, label: "RS" });
      }
      // Rally end / peak marker
      if (!cutoffDate || t.rally_end_date >= cutoffDate) {
        result.push({ time: t.rally_end_date, type: "rally", price: 0, label: "R" });
      }
      if (t.entry_date && t.entry_price != null && (!cutoffDate || t.entry_date >= cutoffDate)) {
        result.push({ time: t.entry_date, type: "entry", price: t.entry_price, label: "B" });
      }
      if (t.exit_date && t.exit_price != null && (!cutoffDate || t.exit_date >= cutoffDate)) {
        result.push({ time: t.exit_date, type: "exit", price: t.exit_price, label: "S" });
      }
      // NOT_ENTERED = signal fired but zone was never entered (missed opportunity)
      if (t.exit_reason === "NOT_ENTERED" && t.rally_start_date &&
          (!cutoffDate || t.rally_start_date >= cutoffDate)) {
        result.push({ time: t.rally_start_date, type: "skipped", price: t.buy_price, label: "M" });
      }
    }
    // Sort by date so lightweight-charts doesn't complain
    return result.sort((a, b) => a.time.localeCompare(b.time));
  }, [trades, cutoffDate]);

  return (
    <div className="space-y-4">
      {/* Stock header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-xl font-semibold font-mono text-primary">{data.ticker}</h2>
        <Badge variant="outline">{data.cap_tier?.replace(" Cap", "")}</Badge>
        <span className="text-sm text-muted-foreground">{data.sector}</span>
        <Badge variant="secondary" className="text-xs ml-auto">{data.watchlist_source}</Badge>
      </div>

      {/* Metric cards */}
      <MetricCards metrics={metricCards} />

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Price · 200 SMA
              <span className="ml-3 text-[10px] space-x-3">
                <span className="text-amber-400">■ RS = Rally base (start)</span>
                <span className="text-purple-400">■ R = Rally peak (end)</span>
                <span className="text-green-400">■ B = Buy entry (retest)</span>
                <span className="text-red-400">■ S = Sell exit (target)</span>
                <span className="text-gray-500">● M = Missed (not entered)</span>
              </span>
            </CardTitle>
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
          {ohlcvLoading ? (
            <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height: 320 }}>
              Loading price data…
            </div>
          ) : (
            <StockChart
              prices={pricePoints}
              ma200={ma200Points}
              pePoints={pePoints.length ? pePoints : undefined}
              peMedian={peData?.median_5y ?? undefined}
              markers={markers}
              height={320}
              ticker={data.ticker}
            />
          )}
        </CardContent>
      </Card>

      {/* Current live rallies */}
      {currentRallies.length > 0 && (
        <Card className="border-green-500/20">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-green-400">
              Live Rallies ({currentRallies.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {currentRallies.map((r, i) => (
              <div
                key={i}
                className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs border border-green-500/10 rounded p-2 bg-green-500/5"
              >
                <div>
                  <div className="text-muted-foreground">Status</div>
                  <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border", STATUS_COLORS[r.status])}>
                    {STATUS_LABELS[r.status]}
                  </span>
                </div>
                <div>
                  <div className="text-muted-foreground">Rally</div>
                  <div className="font-medium text-green-400">{fmtPct(r.rally_pct)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Buy Zone</div>
                  <div className="tabular-nums">
                    ₹{fmtNum(r.buy_zone_low, 0)} – ₹{fmtNum(r.buy_zone_high, 0)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Target / Expiry</div>
                  <div className="tabular-nums">
                    ₹{fmtNum(r.sell_price, 0)} · {fmtDate(r.expiry_date)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Current ₹</div>
                  <div className="tabular-nums">{fmtNum(r.current_price, 1)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Dist to Zone</div>
                  <div className={cn("tabular-nums", r.dist_to_buy_zone_pct <= 0 ? "text-green-400" : "text-amber-400")}>
                    {fmtPct(r.dist_to_buy_zone_pct)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Remaining Gain</div>
                  <div className="tabular-nums text-purple-400">{fmtPct(r.remaining_gain_pct)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Days Left</div>
                  <div className={cn("tabular-nums", r.days_to_expiry <= 7 ? "text-rose-400" : "")}>
                    {r.days_to_expiry}d
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Historical backtest trade log */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Backtest Trade History ({trades.length} rallies)
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          <div className="rounded-md border border-border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Rally Period</TableHead>
                  <TableHead className="text-right">Rally %</TableHead>
                  <TableHead className="text-right">Candles</TableHead>
                  <TableHead>Buy Zone</TableHead>
                  <TableHead>Entry Date</TableHead>
                  <TableHead>Exit Date</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">P/L %</TableHead>
                  <TableHead className="text-right">Max DD %</TableHead>
                  <TableHead>Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((t, i) => {
                  const outcome = t.zone_entered
                    ? (t.exit_reason ?? "OPEN")
                    : "NOT_ENTERED";
                  return (
                    <TableRow key={i} className="hover:bg-muted/30">
                      <TableCell className="text-xs tabular-nums">
                        {t.rally_start_date && t.rally_start_date !== t.rally_end_date
                          ? <>{fmtDate(t.rally_start_date)}<span className="text-muted-foreground mx-1">→</span>{fmtDate(t.rally_end_date)}</>
                          : fmtDate(t.rally_end_date)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-green-400">
                        {fmtPct(t.rally_pct)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {t.candle_count}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">
                        ₹{fmtNum(t.buy_zone_low, 0)}–{fmtNum(t.buy_zone_high, 0)}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {t.entry_date ? fmtDate(t.entry_date) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {t.exit_date ? fmtDate(t.exit_date) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground text-xs">
                        {t.days_in_trade != null ? `${t.days_in_trade}d` : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums font-medium",
                          t.pnl_pct == null
                            ? "text-muted-foreground"
                            : t.pnl_pct >= 0
                            ? "text-green-400"
                            : "text-red-400"
                        )}
                      >
                        {t.pnl_pct != null ? fmtPct(t.pnl_pct) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-rose-400">
                        {t.max_drawdown_pct != null ? fmtPct(t.max_drawdown_pct) : "—"}
                      </TableCell>
                      <TableCell>
                        <span className={cn("text-xs font-medium", OUTCOME_COLORS[outcome] ?? "text-muted-foreground")}>
                          {outcome.replace("_", " ")}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {trades.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      No trade history
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

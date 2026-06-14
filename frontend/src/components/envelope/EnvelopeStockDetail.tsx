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
import { StockChart, type ChartPoint, type TradeMarker } from "@/components/charts/StockChart";
import type { EnvelopeTrade, EnvelopeStockData } from "@/lib/types";
import { Tip } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { fmtCur, fmtPct, fmtNum, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type TimeRange = "1Y" | "3Y" | "All";

const EXIT_COLORS: Record<string, string> = {
  ENV_EXIT: "bg-green-500/20 text-green-400 border-green-500/30",
  STOP_LOSS: "bg-red-500/20 text-red-400 border-red-500/30",
  OPEN: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

interface Props {
  ticker: string;
  trades: EnvelopeTrade[];       // already filtered to this ticker
  envelopePct: number;
  years?: "5" | "10";
}

export function EnvelopeStockDetail({ ticker, trades, envelopePct, years = "10" }: Props) {
  const [timeRange, setTimeRange] = useState<TimeRange>("All");

  const { data: ohlcv, isLoading: ohlcvLoading } = useQuery({
    queryKey: ["ohlcv", ticker, years],
    queryFn: () => api.ohlcv(ticker, parseInt(years)),
    staleTime: 1000 * 60 * 60,
  });

  const { data: envelopeStocks } = useQuery<EnvelopeStockData>({
    queryKey: ["backtest", "envelopeStocks", years],
    queryFn: () => api.backtest.stocksEnvelope(years),
    staleTime: 1000 * 60 * 60,
  });

  const { data: peData } = useQuery({
    queryKey: ["pe", ticker],
    queryFn: () => api.fundamentals.pe(ticker, 10),
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });

  const skippedEntries = envelopeStocks?.stock_data?.[ticker]?.skipped_entries ?? [];

  // Metrics derived from trades
  const wins = trades.filter((t) => t.pnl_pct > 0).length;
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;
  const avgPnl = trades.length ? trades.reduce((s, t) => s + t.pnl_pct, 0) / trades.length : 0;
  const totalNetPnl = trades.reduce((s, t) => s + t.net_pnl, 0);
  const bestTrade = trades.length ? Math.max(...trades.map((t) => t.pnl_pct)) : 0;
  const worstTrade = trades.length ? Math.min(...trades.map((t) => t.pnl_pct)) : 0;
  const avgDays = trades.length ? trades.reduce((s, t) => s + t.trade_duration_days, 0) / trades.length : 0;

  const cap_tier = trades[0]?.cap_tier ?? "";
  const sector = trades[0]?.sector ?? "";


  // Time range cutoff
  const cutoffDate = useMemo(() => {
    if (timeRange === "All") return null;
    const d = new Date();
    d.setFullYear(d.getFullYear() - (timeRange === "1Y" ? 1 : 3));
    return d.toISOString().slice(0, 10);
  }, [timeRange]);

  // Build chart series
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

  // Envelope bands computed client-side from MA200 + envelopePct
  const lowerEnvelope: ChartPoint[] = useMemo(() => {
    return ma200Points.map((p) => ({
      time: p.time,
      value: parseFloat((p.value * (1 - envelopePct / 100)).toFixed(2)),
    }));
  }, [ma200Points, envelopePct]);

  const upperEnvelope: ChartPoint[] = useMemo(() => {
    return ma200Points.map((p) => ({
      time: p.time,
      value: parseFloat((p.value * (1 + envelopePct / 100)).toFixed(2)),
    }));
  }, [ma200Points, envelopePct]);

  // Entry/exit/skipped markers for this ticker's trades
  const markers: TradeMarker[] = useMemo(() => {
    const result: TradeMarker[] = [];
    for (const t of trades) {
      if (t.entry_date && t.entry_price != null && (!cutoffDate || t.entry_date >= cutoffDate)) {
        result.push({ time: t.entry_date, type: "entry", price: t.entry_price, label: "L" });
      }
      if (t.exit_date && t.exit_price != null && (!cutoffDate || t.exit_date >= cutoffDate)) {
        result.push({ time: t.exit_date, type: "exit", price: t.exit_price, label: "S" });
      }
    }
    for (const e of skippedEntries) {
      if (!cutoffDate || e.date >= cutoffDate) {
        result.push({ time: e.date, type: "skipped", price: e.price, label: "M" });
      }
    }
    return result.sort((a, b) => a.time.localeCompare(b.time));
  }, [trades, skippedEntries, cutoffDate]);

  return (
    <div className="space-y-4">
      {/* Stock header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-xl font-semibold font-mono text-primary">{ticker}</h2>
        {cap_tier && <Badge variant="outline">{cap_tier.replace(" Cap", "")}</Badge>}
        {sector && <span className="text-sm text-muted-foreground">{sector}</span>}
        <Badge variant="secondary" className="text-xs ml-auto">Env ±{envelopePct}%</Badge>
      </div>

      {/* Compact stat strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs -mt-1">
        <span className="text-muted-foreground">
          <span className="text-foreground font-medium tabular-nums">{trades.length}</span> trades
        </span>
        <span className="text-muted-foreground">
          <span className="text-green-400 font-medium tabular-nums">{wins}</span> won
        </span>
        <span className="text-muted-foreground">
          WR <span className={cn("font-medium", winRate >= 70 ? "text-green-400" : "text-amber-400")}>{fmtNum(winRate)}%</span>
        </span>
        <span className="text-muted-foreground">
          Avg <span className={cn("font-medium", avgPnl >= 0 ? "text-green-400" : "text-red-400")}>{fmtPct(avgPnl)}</span>
        </span>
        <span className="text-muted-foreground">
          Best <span className="text-green-400 font-medium">{fmtPct(bestTrade)}</span>
        </span>
        <span className="text-muted-foreground">
          Worst <span className="text-red-400 font-medium">{fmtPct(worstTrade)}</span>
        </span>
        <span className="text-muted-foreground">
          Net P/L <span className={cn("font-medium", totalNetPnl >= 0 ? "text-green-400" : "text-red-400")}>{fmtCur(totalNetPnl)}</span>
        </span>
        <span className="text-muted-foreground">
          Hold <span className="font-medium">{Math.round(avgDays)}d</span>
        </span>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Price · 200 SMA · Envelope Bands
              <span className="ml-3 text-[10px] space-x-3">
                <Tip content={`The envelope bands ±${envelopePct}% around the 200 SMA — buy at lower, sell at upper`}>
                  <span className="text-amber-400 cursor-default">■ Lower/Upper Env (±{envelopePct}%)</span>
                </Tip>
                <Tip content="Strategy bought here — price touched the lower envelope band">
                  <span className="text-green-500 cursor-default">■ L = Long entry</span>
                </Tip>
                <Tip content="Strategy sold here — price reached the upper envelope or mean-reverted to 200 SMA">
                  <span className="text-red-400 cursor-default">■ S = Sell exit</span>
                </Tip>
                <Tip content="Stock touched the lower envelope again but was skipped — a trade was already open for this stock">
                  <span className="text-gray-500 cursor-default">● M = Missed (cycle active)</span>
                </Tip>
              </span>
            </CardTitle>
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
          {ohlcvLoading ? (
            <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height: 320 }}>
              Loading price data…
            </div>
          ) : (
            <StockChart
              prices={pricePoints}
              ma200={ma200Points}
              lowerEnvelope={lowerEnvelope}
              upperEnvelope={upperEnvelope}
              pePoints={pePoints.length ? pePoints : undefined}
              peMedian={peData?.median_5y ?? undefined}
              markers={markers}
              height={500}
              ticker={ticker}
            />
          )}
        </CardContent>
      </Card>

      {/* Trade log */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Trade History ({trades.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          <div className="rounded-md border border-border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Entry Date</TableHead>
                  <TableHead className="text-right">Entry ₹</TableHead>
                  <TableHead>Exit Date</TableHead>
                  <TableHead className="text-right">Exit ₹</TableHead>
                  <TableHead className="text-right"><Tip content="Calendar days this trade was held" below><span className="cursor-default">Days</span></Tip></TableHead>
                  <TableHead className="text-right"><Tip content="What % of the portfolio was allocated to this trade in the backtest" below><span className="cursor-default">Alloc %</span></Tip></TableHead>
                  <TableHead className="text-right"><Tip content="% gain or loss from entry to exit" below><span className="cursor-default">P/L %</span></Tip></TableHead>
                  <TableHead className="text-right"><Tip content="₹ profit/loss for this trade based on the allocated position size" below><span className="cursor-default">Net P/L</span></Tip></TableHead>
                  <TableHead><Tip content="How the trade closed: ENV_EXIT = upper envelope hit, STOP_LOSS = stop triggered, OPEN = still active" below><span className="cursor-default">Exit</span></Tip></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((t, i) => (
                  <TableRow key={i} className="hover:bg-muted/30">
                    <TableCell className="tabular-nums text-xs">{fmtDate(t.entry_date)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{fmtCur(t.entry_price)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {t.exit_date ? fmtDate(t.exit_date) : <span className="text-amber-400">Open</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {t.exit_price != null ? fmtCur(t.exit_price) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{t.trade_duration_days}d</TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {(t.allocation_pct * 100).toFixed(1)}%
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums font-medium text-xs",
                        t.pnl_pct >= 0 ? "text-green-400" : "text-red-400"
                      )}
                    >
                      {fmtPct(t.pnl_pct)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums text-xs",
                        t.net_pnl >= 0 ? "text-green-400" : "text-red-400"
                      )}
                    >
                      {fmtCur(t.net_pnl)}
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-xs border",
                        EXIT_COLORS[t.exit_reason] ?? "bg-muted text-muted-foreground border-border"
                      )}>
                        {t.exit_reason}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {trades.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      No trades
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

"use client";
import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EnvelopeTrade } from "@/lib/types";
import { fmtCur, fmtPct, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";

type SortKey = "ticker" | "trades" | "win_rate" | "total_pnl" | "avg_pnl";
type SortDir = "asc" | "desc";

interface StockRow {
  ticker: string;
  cap_tier: string;
  sector: string;
  trades: number;
  winning: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl: number;
}

interface Props {
  trades: EnvelopeTrade[];
}

export function EnvelopeByStock({ trades }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("total_pnl");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const rows = useMemo<StockRow[]>(() => {
    const map = new Map<string, StockRow>();
    for (const t of trades) {
      const key = t.stock_ticker;
      if (!map.has(key)) {
        map.set(key, {
          ticker: t.stock_ticker,
          cap_tier: t.cap_tier,
          sector: t.sector,
          trades: 0,
          winning: 0,
          total_pnl: 0,
          avg_pnl: 0,
          win_rate: 0,
        });
      }
      const r = map.get(key)!;
      r.trades += 1;
      if (t.pnl_pct > 0) r.winning += 1;
      r.total_pnl += t.net_pnl;
    }
    for (const r of map.values()) {
      r.win_rate = r.trades > 0 ? (r.winning / r.trades) * 100 : 0;
      r.avg_pnl = r.trades > 0 ? r.total_pnl / r.trades : 0;
    }
    return Array.from(map.values());
  }, [trades]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let diff = 0;
      if (sortKey === "ticker") diff = a.ticker.localeCompare(b.ticker);
      else if (sortKey === "trades") diff = a.trades - b.trades;
      else if (sortKey === "win_rate") diff = a.win_rate - b.win_rate;
      else if (sortKey === "total_pnl") diff = a.total_pnl - b.total_pnl;
      else if (sortKey === "avg_pnl") diff = a.avg_pnl - b.avg_pnl;
      return sortDir === "asc" ? diff : -diff;
    });
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function SortHead({ col, label, className, tip }: { col: SortKey; label: string; className?: string; tip?: string }) {
    const active = sortKey === col;
    return (
      <TableHead
        className={cn("cursor-pointer select-none hover:text-foreground", className)}
        onClick={() => toggleSort(col)}
      >
        {tip ? (
          <Tip content={tip} below>
            <span className="cursor-default">{label}</span>
          </Tip>
        ) : label}
        {active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
      </TableHead>
    );
  }

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHead col="ticker" label="Ticker" />
            <TableHead>Cap</TableHead>
            <TableHead>Sector</TableHead>
            <SortHead col="trades" label="Trades" className="text-right" tip="Total completed buy→sell cycles for this stock in the backtest" />
            <TableHead className="text-right"><Tip content="Number of those trades that closed profitably" below><span className="cursor-default">Won</span></Tip></TableHead>
            <SortHead col="win_rate" label="Win Rate" className="text-right" tip="% of trades that were profitable" />
            <SortHead col="total_pnl" label="Total P/L" className="text-right" tip="Cumulative ₹ profit/loss across all trades for this stock" />
            <SortHead col="avg_pnl" label="Avg P/L" className="text-right" tip="Average % return per trade — the best measure of consistent performance" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={r.ticker} className="hover:bg-muted/30">
              <TableCell className="font-mono font-semibold text-primary">{r.ticker}</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {r.cap_tier?.replace(" Cap", "")}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.sector}</TableCell>
              <TableCell className="text-right tabular-nums">{r.trades}</TableCell>
              <TableCell className="text-right tabular-nums text-green-400">{r.winning}</TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums font-medium",
                  r.win_rate >= 80 ? "text-green-400" : r.win_rate >= 60 ? "text-amber-400" : "text-red-400"
                )}
              >
                {fmtNum(r.win_rate)}%
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  r.total_pnl >= 0 ? "text-green-400" : "text-red-400"
                )}
              >
                {fmtCur(r.total_pnl)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums text-sm",
                  r.avg_pnl >= 0 ? "text-green-400/80" : "text-red-400/80"
                )}
              >
                {fmtCur(r.avg_pnl)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { S200StockOverview } from "@/lib/types";
import { fmtPct, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey =
  | "ticker"
  | "total_rallies"
  | "entered"
  | "target_hit"
  | "zone_entry_rate_pct"
  | "win_rate_pct"
  | "avg_pnl_pct"
  | "avg_days_in_trade";
type SortDir = "asc" | "desc";

interface Props {
  overview: S200StockOverview[];
}

export function S200BacktestTable({ overview }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("win_rate_pct");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = [...overview].sort((a, b) => {
    let diff = 0;
    if (sortKey === "ticker") diff = a.ticker.localeCompare(b.ticker);
    else if (sortKey === "total_rallies") diff = a.total_rallies - b.total_rallies;
    else if (sortKey === "entered") diff = a.entered - b.entered;
    else if (sortKey === "target_hit") diff = a.target_hit - b.target_hit;
    else if (sortKey === "zone_entry_rate_pct") diff = a.zone_entry_rate_pct - b.zone_entry_rate_pct;
    else if (sortKey === "win_rate_pct") diff = a.win_rate_pct - b.win_rate_pct;
    else if (sortKey === "avg_pnl_pct") diff = a.avg_pnl_pct - b.avg_pnl_pct;
    else if (sortKey === "avg_days_in_trade") diff = a.avg_days_in_trade - b.avg_days_in_trade;
    return sortDir === "asc" ? diff : -diff;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function SortHead({ col, label, className }: { col: SortKey; label: string; className?: string }) {
    const active = sortKey === col;
    return (
      <TableHead
        className={cn("cursor-pointer select-none hover:text-foreground", className)}
        onClick={() => toggleSort(col)}
      >
        {label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </TableHead>
    );
  }

  return (
    <div className="rounded-md border border-border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHead col="ticker" label="Ticker" />
            <TableHead>Cap</TableHead>
            <TableHead>Source</TableHead>
            <SortHead col="total_rallies" label="Rallies" className="text-right" />
            <SortHead col="entered" label="Entered" className="text-right" />
            <SortHead col="target_hit" label="Won" className="text-right" />
            <SortHead col="zone_entry_rate_pct" label="Entry Rate" className="text-right" />
            <SortHead col="win_rate_pct" label="Win Rate" className="text-right" />
            <SortHead col="avg_pnl_pct" label="Avg P/L%" className="text-right" />
            <SortHead col="avg_days_in_trade" label="Avg Days" className="text-right" />
            <TableHead className="text-right">Max DD%</TableHead>
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
              <TableCell className="text-xs text-muted-foreground">{r.watchlist_source}</TableCell>
              <TableCell className="text-right tabular-nums">{r.total_rallies}</TableCell>
              <TableCell className="text-right tabular-nums">{r.entered}</TableCell>
              <TableCell className="text-right tabular-nums text-green-400">{r.target_hit}</TableCell>
              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                {fmtNum(r.zone_entry_rate_pct)}%
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums font-medium",
                  r.win_rate_pct >= 80 ? "text-green-400" : r.win_rate_pct >= 60 ? "text-amber-400" : "text-red-400"
                )}
              >
                {fmtNum(r.win_rate_pct)}%
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  r.avg_pnl_pct >= 0 ? "text-green-400" : "text-red-400"
                )}
              >
                {fmtPct(r.avg_pnl_pct)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                {Math.round(r.avg_days_in_trade)}d
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs text-rose-400">
                {fmtPct(r.avg_max_drawdown_pct)}
              </TableCell>
            </TableRow>
          ))}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                No data available
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

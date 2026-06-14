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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EnvelopeTrade } from "@/lib/types";
import { fmtCur, fmtPct, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";

type SortKey = "entry_date" | "pnl_pct" | "net_pnl" | "trade_duration_days";
type SortDir = "asc" | "desc";

const EXIT_COLORS: Record<string, string> = {
  ENV_EXIT: "bg-green-500/20 text-green-400 border-green-500/30",
  STOP_LOSS: "bg-red-500/20 text-red-400 border-red-500/30",
  OPEN: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

interface Props {
  trades: EnvelopeTrade[];
}

export function EnvelopeTradesTable({ trades }: Props) {
  const [cap, setCap] = useState("ALL");
  const [sector, setSector] = useState("ALL");
  const [exitReason, setExitReason] = useState("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("entry_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const caps = useMemo(() => ["ALL", ...Array.from(new Set(trades.map((t) => t.cap_tier))).sort()], [trades]);
  const sectors = useMemo(() => ["ALL", ...Array.from(new Set(trades.map((t) => t.sector))).sort()], [trades]);
  const exitReasons = useMemo(() => ["ALL", ...Array.from(new Set(trades.map((t) => t.exit_reason))).sort()], [trades]);

  const filtered = useMemo(() => {
    let t = trades;
    if (cap !== "ALL") t = t.filter((r) => r.cap_tier === cap);
    if (sector !== "ALL") t = t.filter((r) => r.sector === sector);
    if (exitReason !== "ALL") t = t.filter((r) => r.exit_reason === exitReason);
    return t;
  }, [trades, cap, sector, exitReason]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let diff = 0;
      if (sortKey === "entry_date") diff = a.entry_date.localeCompare(b.entry_date);
      else if (sortKey === "pnl_pct") diff = a.pnl_pct - b.pnl_pct;
      else if (sortKey === "net_pnl") diff = a.net_pnl - b.net_pnl;
      else if (sortKey === "trade_duration_days") diff = a.trade_duration_days - b.trade_duration_days;
      return sortDir === "asc" ? diff : -diff;
    });
  }, [filtered, sortKey, sortDir]);

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
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <Select value={cap} onValueChange={(v) => setCap(v ?? "ALL")}>
          <SelectTrigger className="h-7 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {caps.map((c) => (
              <SelectItem key={c} value={c} className="text-xs">
                {c === "ALL" ? "All Caps" : c.replace(" Cap", "")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sector} onValueChange={(v) => setSector(v ?? "ALL")}>
          <SelectTrigger className="h-7 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sectors.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">
                {s === "ALL" ? "All Sectors" : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={exitReason} onValueChange={(v) => setExitReason(v ?? "ALL")}>
          <SelectTrigger className="h-7 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {exitReasons.map((r) => (
              <SelectItem key={r} value={r} className="text-xs">
                {r === "ALL" ? "All Exit Reasons" : r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{sorted.length} trades</span>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Ticker</TableHead>
              <TableHead>Cap</TableHead>
              <TableHead>Sector</TableHead>
              <SortHead col="entry_date" label="Entry Date" tip="Date the strategy bought (entered the lower envelope zone)" />
              <TableHead className="text-right">Entry ₹</TableHead>
              <TableHead className="text-right"><Tip content="Date the strategy sold (upper envelope, 200 SMA reversion, or stop-loss)" below><span className="cursor-default">Exit Date</span></Tip></TableHead>
              <TableHead className="text-right">Exit ₹</TableHead>
              <SortHead col="trade_duration_days" label="Days" className="text-right" tip="Calendar days this trade was held" />
              <TableHead className="text-right"><Tip content="% of total portfolio capital allocated to this specific trade" below><span className="cursor-default">Alloc%</span></Tip></TableHead>
              <SortHead col="pnl_pct" label="P/L%" className="text-right" tip="% return from entry to exit" />
              <SortHead col="net_pnl" label="Net P/L" className="text-right" tip="₹ profit/loss for this trade at the allocated position size" />
              <TableHead><Tip content="How the trade closed: ENV_EXIT = hit upper band, STOP_LOSS = stop triggered, OPEN = still active" below><span className="cursor-default">Exit Reason</span></Tip></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((t, i) => (
              <TableRow key={i} className="hover:bg-muted/30">
                <TableCell className="font-mono font-semibold text-primary">{t.stock_ticker}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {t.cap_tier?.replace(" Cap", "")}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{t.sector}</TableCell>
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
                  <span
                    className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-xs border",
                      EXIT_COLORS[t.exit_reason] ?? "bg-muted text-muted-foreground border-border"
                    )}
                  >
                    {t.exit_reason}
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                  No trades match this filter
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

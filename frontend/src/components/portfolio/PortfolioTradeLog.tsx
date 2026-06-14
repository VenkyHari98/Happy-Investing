"use client";
import { useState, useMemo, useEffect } from "react";
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
import type { PortfolioTrade } from "@/lib/types";
import { Tip } from "@/components/ui/tooltip";
import { fmtCur, fmtPct, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "entry_date" | "pnl_pct" | "pnl" | "trade_duration_days" | "max_drawdown_pct";
type SortDir = "asc" | "desc";

const OUTCOME_COLORS: Record<string, string> = {
  TARGET_HIT: "bg-green-500/20 text-green-400 border-green-500/30",
  EXPIRED: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  OPEN: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  STOPLOSS: "bg-red-500/20 text-red-400 border-red-500/30",
  EXIT_SIGNAL: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

interface Props {
  trades: PortfolioTrade[];
  showStrategy?: boolean;
}

export function PortfolioTradeLog({ trades, showStrategy = false }: Props) {
  const [search, setSearch] = useState("");
  const [cap, setCap] = useState("ALL");
  const [outcome, setOutcome] = useState("ALL");
  const [tranche, setTranche] = useState("ALL");
  const [strategy, setStrategy] = useState("ALL");
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("entry_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);

  const tickers = useMemo(
    () => Array.from(new Set(trades.map((t) => t.ticker))).sort(),
    [trades]
  );
  const outcomes = useMemo(
    () => ["ALL", ...Array.from(new Set(trades.map((t) => t.exit_reason))).sort()],
    [trades]
  );
  const tranches = useMemo(
    () => ["ALL", ...Array.from(new Set(trades.map((t) => t.tranche))).sort()],
    [trades]
  );
  const strategies = useMemo(
    () => ["ALL", ...Array.from(new Set(trades.map((t) => t.strategy))).sort()],
    [trades]
  );

  const filtered = useMemo(() => {
    let t = trades;
    if (activeTicker) t = t.filter((r) => r.ticker === activeTicker);
    if (search) t = t.filter((r) => r.ticker.toLowerCase().includes(search.toLowerCase()));
    if (cap !== "ALL") t = t.filter((r) => r.cap_tier === cap);
    if (outcome !== "ALL") t = t.filter((r) => r.exit_reason === outcome);
    if (tranche !== "ALL") t = t.filter((r) => r.tranche === tranche);
    if (showStrategy && strategy !== "ALL") t = t.filter((r) => r.strategy === strategy);
    return t;
  }, [trades, activeTicker, search, cap, outcome, tranche, strategy, showStrategy]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let diff = 0;
      if (sortKey === "entry_date") diff = a.entry_date.localeCompare(b.entry_date);
      else if (sortKey === "pnl_pct") diff = a.pnl_pct - b.pnl_pct;
      else if (sortKey === "pnl") diff = a.pnl - b.pnl;
      else if (sortKey === "trade_duration_days") diff = a.trade_duration_days - b.trade_duration_days;
      else if (sortKey === "max_drawdown_pct") diff = a.max_drawdown_pct - b.max_drawdown_pct;
      return sortDir === "asc" ? diff : -diff;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = pageSize === 0 ? 1 : Math.ceil(sorted.length / pageSize);
  const paginated = useMemo(
    () => (pageSize === 0 ? sorted : sorted.slice(page * pageSize, (page + 1) * pageSize)),
    [sorted, page, pageSize]
  );

  // Reset to first page whenever filters or sort change
  useEffect(() => { setPage(0); }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function SortHead({ col, label, className, tip }: { col: SortKey; label: string; className?: string; tip?: string }) {
    const active = sortKey === col;
    return (
      <TableHead
        className={cn("cursor-pointer select-none hover:text-foreground whitespace-nowrap", className)}
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
      {/* Ticker pills */}
      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={() => setActiveTicker(null)}
          className={cn(
            "px-2 py-0.5 rounded text-xs font-mono border transition-colors",
            activeTicker === null
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
          )}
        >
          All
        </button>
        {tickers.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTicker(activeTicker === t ? null : t)}
            className={cn(
              "px-2 py-0.5 rounded text-xs font-mono border transition-colors",
              activeTicker === t
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          className="bg-background border border-border rounded px-3 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-32"
          placeholder="Search ticker…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={cap} onValueChange={(v) => setCap(v ?? "ALL")}>
          <SelectTrigger className="h-7 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["ALL", "Large Cap", "Mid Cap", "Small Cap"].map((c) => (
              <SelectItem key={c} value={c} className="text-xs">
                {c === "ALL" ? "All Caps" : c.replace(" Cap", "")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={outcome} onValueChange={(v) => setOutcome(v ?? "ALL")}>
          <SelectTrigger className="h-7 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {outcomes.map((o) => (
              <SelectItem key={o} value={o} className="text-xs">
                {o === "ALL" ? "All Outcomes" : o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tranche} onValueChange={(v) => setTranche(v ?? "ALL")}>
          <SelectTrigger className="h-7 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tranches.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">
                {t === "ALL" ? "All Tranches" : t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showStrategy && (
          <Select value={strategy} onValueChange={(v) => setStrategy(v ?? "ALL")}>
            <SelectTrigger className="h-7 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {strategies.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {s === "ALL" ? "All Strategies" : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground">{sorted.length} trades</span>
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(0); }}>
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[50, 100, 250, 0].map((n) => (
                <SelectItem key={n} value={String(n)} className="text-xs">
                  {n === 0 ? "Show all" : `${n} / page`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8 text-muted-foreground">#</TableHead>
              <TableHead>Ticker</TableHead>
              <TableHead>Cap</TableHead>
              {showStrategy && <TableHead>Strategy</TableHead>}
              <TableHead><Tip content="Which averaging tranche this is (1 = initial entry, 2+ = averaging down at lower prices)" below><span className="cursor-default">Tranche</span></Tip></TableHead>
              <SortHead col="entry_date" label="Entry Date" />
              <TableHead className="text-right">Entry ₹</TableHead>
              <TableHead className="text-right"><Tip content="The fixed sell target price for this trade" below><span className="cursor-default">Target ₹</span></Tip></TableHead>
              <TableHead className="text-right">Exit Date</TableHead>
              <TableHead className="text-right">Exit ₹</TableHead>
              <SortHead col="trade_duration_days" label="Days" className="text-right" tip="Calendar days from entry to exit — or days held so far for open trades" />
              <SortHead col="pnl_pct" label="P/L%" className="text-right" tip="% return from entry to exit price" />
              <SortHead col="pnl" label="P/L ₹" className="text-right" tip="₹ profit/loss based on position size allocated" />
              <SortHead col="max_drawdown_pct" label="Max DD" className="text-right" tip="Largest intra-trade price drop below entry — how far underwater this trade went before recovery" />
              <TableHead><Tip content="How the trade closed: TARGET_HIT (✓), EXPIRED (lapsed), OPEN (still active), STOPLOSS, EXIT_SIGNAL" below><span className="cursor-default">Outcome</span></Tip></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.map((t, i) => (
              <TableRow key={t.trade_id} className="hover:bg-muted/30">
                <TableCell className="text-muted-foreground text-xs">{(pageSize > 0 ? page * pageSize : 0) + i + 1}</TableCell>
                <TableCell className="font-mono font-semibold text-primary">{t.ticker}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {t.cap_tier?.replace(" Cap", "")}
                  </Badge>
                </TableCell>
                {showStrategy && (
                  <TableCell className="text-xs text-muted-foreground">{t.strategy}</TableCell>
                )}
                <TableCell className="text-xs text-muted-foreground">{t.tranche}</TableCell>
                <TableCell className="tabular-nums text-xs">{fmtDate(t.entry_date)}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">{fmtCur(t.entry_price)}</TableCell>
                <TableCell className="text-right tabular-nums text-xs text-purple-400">
                  {fmtCur(t.exit_target)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {t.exit_date ? fmtDate(t.exit_date) : <span className="text-blue-400">Open</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {t.exit_price != null ? fmtCur(t.exit_price) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs">{t.trade_duration_days}d</TableCell>
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
                    t.pnl >= 0 ? "text-green-400" : "text-red-400"
                  )}
                >
                  {fmtCur(t.pnl)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-rose-400">
                  {t.max_drawdown_pct != null ? fmtPct(-Math.abs(t.max_drawdown_pct)) : "—"}
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-xs border whitespace-nowrap",
                      OUTCOME_COLORS[t.exit_reason] ?? "bg-muted text-muted-foreground border-border"
                    )}
                  >
                    {t.exit_reason}
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={showStrategy ? 16 : 15} className="text-center text-muted-foreground py-8">
                  No trades match this filter
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination nav */}
      {pageSize > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span>
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <Tip content="First page" below>
              <button
                disabled={page === 0}
                onClick={() => setPage(0)}
                className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
              >
                «
              </button>
            </Tip>
            <Tip content="Previous page" below>
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ‹
              </button>
            </Tip>
            <span className="px-2">
              Page {page + 1} / {totalPages}
            </span>
            <Tip content="Next page" below>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ›
              </button>
            </Tip>
            <Tip content="Last page" below>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage(totalPages - 1)}
                className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
              >
                »
              </button>
            </Tip>
          </div>
        </div>
      )}
    </div>
  );
}

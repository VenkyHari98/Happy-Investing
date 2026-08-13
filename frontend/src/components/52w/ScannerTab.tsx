"use client";
import React, { useState, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
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
import { type ScannerRow } from "@/lib/types";
import { fmtCur, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FundDetails } from "@/components/shared/FundDetails";
import { getFundBadge, getFundStatus, type FundStatus } from "@/lib/fundBadge";
import { useSort } from "@/lib/useSort";
import { SortArrow, SORTABLE_TH_CLASS } from "@/components/shared/SortArrow";

// ── Status (from backend status_52w field) ────────────────────────────────────
type Status52W = "IN_ZONE" | "APPROACHING" | "WATCHING_NEAR" | "WATCHING" | "BELOW_BUY";

const STATUS_COLORS: Record<Status52W, string> = {
  IN_ZONE:       "bg-green-500/20 text-green-400 border-green-500/30",
  APPROACHING:   "bg-amber-500/20 text-amber-400 border-amber-500/30",
  WATCHING_NEAR: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  WATCHING:      "bg-muted text-muted-foreground border-border",
  BELOW_BUY:     "bg-rose-500/20 text-rose-400 border-rose-500/30",
};

const STATUS_LABELS: Record<Status52W, string> = {
  IN_ZONE:       "At 52W Low",
  APPROACHING:   "Approaching",
  WATCHING_NEAR: "Near",
  WATCHING:      "Far",
  BELOW_BUY:     "Falling Low",
};

const STATUS_ORDER: Record<Status52W, number> = {
  IN_ZONE: 0, APPROACHING: 1, WATCHING_NEAR: 2, WATCHING: 3, BELOW_BUY: 4,
};

const PILL_TOOLTIPS: Record<Status52W | "ALL", string> = {
  ALL:           "Show all F40 stocks regardless of where they are relative to their 52W low",
  IN_ZONE:       "Price is within 2% of the 52-week low — the strategy's buy zone",
  APPROACHING:   "Price is 2–8% above the 52W low — entering buy territory, worth watching",
  WATCHING_NEAR: "Price is 8–20% above the 52W low — moderate proximity, not yet at low",
  WATCHING:      "Price is well above the 52W low (>20%) — no immediate buying opportunity",
  BELOW_BUY:     "52W low itself is declining — buying here risks catching a falling knife",
};

function getStatus52W(row: ScannerRow): Status52W {
  const s = row.status_52w as Status52W | undefined;
  if (s && s in STATUS_COLORS) return s;
  // Fallback from distance if backend field absent
  const dist = row.distance_to_52w_low_pct ?? 999;
  if (dist <= 2) return "IN_ZONE";
  if (dist <= 8) return "APPROACHING";
  if (dist <= 20) return "WATCHING_NEAR";
  return "WATCHING";
}

// ── Signal labels / colors ────────────────────────────────────────────────────
type SignalKey = "52W_LOW_BUY_CANDIDATE" | "52W_HIGH_SELL_CANDIDATE" | "ENVELOPE_LONG_CANDIDATE" | "ENVELOPE_SHORT_CANDIDATE" | "NO_IMMEDIATE_SIGNAL";

const SIGNAL_LABELS: Record<SignalKey, string> = {
  "52W_LOW_BUY_CANDIDATE":    "52W Low ↓",
  "52W_HIGH_SELL_CANDIDATE":  "52W High ↑",
  "ENVELOPE_LONG_CANDIDATE":  "Env Long ↓",
  "ENVELOPE_SHORT_CANDIDATE": "Env Short ↑",
  "NO_IMMEDIATE_SIGNAL":      "No Signal",
};

const SIGNAL_COLORS: Record<SignalKey, string> = {
  "52W_LOW_BUY_CANDIDATE":    "bg-green-500/20 text-green-400 border-green-500/30",
  "52W_HIGH_SELL_CANDIDATE":  "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "ENVELOPE_LONG_CANDIDATE":  "bg-orange-500/20 text-orange-400 border-orange-500/30",
  "ENVELOPE_SHORT_CANDIDATE": "bg-red-500/20 text-red-400 border-red-500/30",
  "NO_IMMEDIATE_SIGNAL":      "bg-muted text-muted-foreground border-border",
};

// ── Sort options ─────────────────────────────────────────────────────────────
type SortOption = "zone" | "closest_low" | "closest_high" | "highest_gain" | "ticker_az";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "zone",         label: "By Zone" },
  { value: "closest_low",  label: "Closest to 52W Low" },
  { value: "closest_high", label: "Closest to 52W High" },
  { value: "highest_gain", label: "Highest Potential Gain" },
  { value: "ticker_az",    label: "Ticker A–Z" },
];

interface ScannerTabProps {
  rows: ScannerRow[];
  runDate?: string;
}

export function ScannerTab({ rows, runDate }: ScannerTabProps) {
  const [signalFilter, setSignalFilter] = useState<"ALL" | "BUY" | "SELL">("BUY");
  const [statusFilter, setStatusFilter] = useState<Status52W | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("ALL");
  const [cap, setCap] = useState("ALL");
  const [fundFilter, setFundFilter] = useState<FundStatus | "ALL">("ALL");
  const [dmaOnly, setDmaOnly] = useState(false);
  const [sortOption, setSortOption] = useState<SortOption>("zone");
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

  const sectors = useMemo(
    () => ["ALL", ...Array.from(new Set(rows.map((r) => r.sector))).sort()],
    [rows]
  );

  const buyRows  = useMemo(() => rows.filter((r) => r.signals?.includes("52W_LOW_BUY_CANDIDATE")),   [rows]);
  const sellRows = useMemo(() => rows.filter((r) => r.signals?.includes("52W_HIGH_SELL_CANDIDATE")), [rows]);

  // Base pool: signal filter + search + sector + cap (status filter applied separately)
  const baseFiltered = useMemo(() => {
    let t: ScannerRow[] =
      signalFilter === "BUY"  ? buyRows  :
      signalFilter === "SELL" ? sellRows :
      rows;
    if (search)         t = t.filter((r) => r.ticker.toLowerCase().includes(search.toLowerCase()));
    if (sector !== "ALL") t = t.filter((r) => r.sector === sector);
    if (cap    !== "ALL") t = t.filter((r) => r.cap_tier === cap);
    if (fundFilter !== "ALL") t = t.filter((r) => getFundStatus(r) === fundFilter);
    if (dmaOnly) t = t.filter((r) => r.fund_below_200dma === true);
    return t;
  }, [rows, buyRows, sellRows, signalFilter, search, sector, cap, fundFilter, dmaOnly]);

  // Counts reflect current search/sector/cap state so pills stay accurate
  const counts = useMemo(() => {
    return baseFiltered.reduce<Record<string, number>>((acc, r) => {
      const s = getStatus52W(r);
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
  }, [baseFiltered]);

  const statusFiltered = useMemo(() => {
    if (statusFilter === "ALL") return baseFiltered;
    return baseFiltered.filter((r) => getStatus52W(r) === statusFilter);
  }, [baseFiltered, statusFilter]);

  const presetSorted = useMemo(() => {
    return [...statusFiltered].sort((a, b) => {
      if (sortOption === "zone") {
        const sa = STATUS_ORDER[getStatus52W(a)] ?? 9;
        const sb = STATUS_ORDER[getStatus52W(b)] ?? 9;
        if (sa !== sb) return sa - sb;
        return (a.distance_to_52w_low_pct ?? 999) - (b.distance_to_52w_low_pct ?? 999);
      }
      if (sortOption === "closest_low")
        return (a.distance_to_52w_low_pct ?? 999) - (b.distance_to_52w_low_pct ?? 999);
      // distance_to_52w_high_pct is always <= 0 (close vs. its own high), so
      // "closest to high" (nearest 0) sorts by descending raw value, and
      // "highest potential gain" (furthest below high) sorts ascending.
      if (sortOption === "closest_high")
        return (b.distance_to_52w_high_pct ?? 0) - (a.distance_to_52w_high_pct ?? 0);
      if (sortOption === "highest_gain")
        return (a.distance_to_52w_high_pct ?? 999) - (b.distance_to_52w_high_pct ?? 999);
      if (sortOption === "ticker_az") return a.ticker.localeCompare(b.ticker);
      return 0;
    });
  }, [statusFiltered, sortOption]);

  // Clicking a column header overrides the preset dropdown sort above.
  const getSortValue = useCallback((row: ScannerRow, key: string): unknown => {
    switch (key) {
      case "ticker": return row.ticker;
      case "status": return STATUS_ORDER[getStatus52W(row)];
      case "signals": return (row.signals ?? []).length;
      case "sector": return row.sector;
      case "cap": return row.cap_tier;
      case "close": return row.close;
      case "52w_low": return row["52w_low"];
      case "dist_to_low": return row.distance_to_52w_low_pct;
      case "52w_high": return row["52w_high"];
      case "pot_gain": return row.distance_to_52w_high_pct != null ? Math.abs(row.distance_to_52w_high_pct) : null;
      case "200_dma": return row.ma;
      case "pe": return row.pe_current;
      case "5yr_pe": return row.pe_5yr_avg;
      case "fundamentals": return { pass: 2, no_data: 1, fail: 0 }[getFundStatus(row)];
      default: return null;
    }
  }, []);
  const { sorted: columnSorted, sortKey, sortDir, toggleSort } = useSort(presetSorted, getSortValue);
  const sorted = sortKey ? columnSorted : presetSorted;

  return (
    <div className="space-y-4">
      {/* Signal type toggle + status pills */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap items-center">
          {/* Signal type toggle */}
          <div className="flex border border-border rounded-md overflow-hidden">
            {(["BUY", "SELL", "ALL"] as const).map((s) => (
              <Tip
                key={s}
                content={
                  s === "BUY"  ? `Show only buy candidates: stocks near their 52W low (${buyRows.length} stocks)`
                  : s === "SELL" ? `Show only sell signals: stocks near their 52W high (${sellRows.length} stocks)`
                  : "Show all F40 stocks regardless of signal direction"
                }
                below
              >
                <button
                  onClick={() => setSignalFilter(s)}
                  className={cn(
                    "px-3 py-1 text-xs font-medium transition-colors",
                    signalFilter === s
                      ? s === "BUY"
                        ? "bg-green-500/20 text-green-400"
                        : s === "SELL"
                        ? "bg-red-500/20 text-red-400"
                        : "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {s === "BUY" ? `▲ Buy (${buyRows.length})` : s === "SELL" ? `▼ Sell (${sellRows.length})` : "All"}
                </button>
              </Tip>
            ))}
          </div>
          {/* Status pills */}
          {(["ALL", "IN_ZONE", "APPROACHING", "WATCHING_NEAR", "WATCHING", "BELOW_BUY"] as const).map((id) => (
            <Tip key={id} content={PILL_TOOLTIPS[id === "ALL" ? "ALL" : id as Status52W]} below>
              <button
                onClick={() => setStatusFilter(id)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                  statusFilter === id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                )}
              >
                {id === "ALL" ? "All" : STATUS_LABELS[id as Status52W]}
                {id !== "ALL" && counts[id] != null && (
                  <span className="ml-1.5 opacity-70">{counts[id]}</span>
                )}
              </button>
            </Tip>
          ))}
        </div>
        {runDate && <span className="text-xs text-muted-foreground">Scanned: {runDate}</span>}
      </div>

      {/* Filters + sort bar */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          className="bg-background border border-border rounded px-3 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-32"
          placeholder="Search ticker…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={sector} onValueChange={(v) => setSector(v ?? "ALL")}>
          <SelectTrigger className="h-7 w-44 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {sectors.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">{s === "ALL" ? "All Sectors" : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={cap} onValueChange={(v) => setCap(v ?? "ALL")}>
          <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["ALL", "Large Cap", "Mid Cap", "Small Cap"].map((c) => (
              <SelectItem key={c} value={c} className="text-xs">{c === "ALL" ? "All Caps" : c.replace(" Cap", "")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tip content="Filter by whether the stock passes every Must-Have fundamental gate (ROCE/ROE, Net D/E, PE, pledge, public shareholding, sales/profit ATH, OPM trend)" below>
          <Select value={fundFilter} onValueChange={(v) => setFundFilter((v ?? "ALL") as FundStatus | "ALL")}>
            <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs">All Fundamentals</SelectItem>
              <SelectItem value="pass" className="text-xs">Pass Only</SelectItem>
              <SelectItem value="fail" className="text-xs">Fail Only</SelectItem>
              <SelectItem value="no_data" className="text-xs">No Data</SelectItem>
            </SelectContent>
          </Select>
        </Tip>
        <Select value={sortOption} onValueChange={(v) => setSortOption((v ?? "zone") as SortOption)}>
          <SelectTrigger className="h-7 w-52 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tip content="Show only stocks currently trading below their 200-day moving average — a key strategy requirement. Above-DMA setups are invalid entries." below>
          <button
            onClick={() => setDmaOnly((v) => !v)}
            className={cn(
              "px-3 py-1 rounded text-xs font-medium border transition-colors",
              dmaOnly
                ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
            )}
          >
            Below 200 DMA Only
          </button>
        </Tip>
        <span className="text-xs text-muted-foreground ml-auto">{sorted.length} stocks</span>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={SORTABLE_TH_CLASS} onClick={() => toggleSort("ticker")}>
                Ticker<SortArrow active={sortKey === "ticker"} dir={sortDir} />
              </TableHead>
              <TableHead className={SORTABLE_TH_CLASS} onClick={() => toggleSort("status")}>
                <Tip content="Where this stock sits relative to its 52-week rolling low (computed by the scanner)" below>
                  <span className="cursor-default">Status</span>
                </Tip>
                <SortArrow active={sortKey === "status"} dir={sortDir} />
              </TableHead>
              <TableHead className={SORTABLE_TH_CLASS} onClick={() => toggleSort("signals")}>
                <Tip content="Active scanner signals: 52W Low ↓ means buy candidate, 52W High ↑ means near sell territory" below>
                  <span className="cursor-default">Signals</span>
                </Tip>
                <SortArrow active={sortKey === "signals"} dir={sortDir} />
              </TableHead>
              <TableHead className={SORTABLE_TH_CLASS} onClick={() => toggleSort("sector")}>
                Sector<SortArrow active={sortKey === "sector"} dir={sortDir} />
              </TableHead>
              <TableHead className={SORTABLE_TH_CLASS} onClick={() => toggleSort("cap")}>
                Cap<SortArrow active={sortKey === "cap"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("close")}>
                Close<SortArrow active={sortKey === "close"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("52w_low")}>
                <Tip content="Rolling 52-week low — the strategy's buy trigger level" below>
                  <span className="cursor-default">52W Low</span>
                </Tip>
                <SortArrow active={sortKey === "52w_low"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right min-w-[100px]", SORTABLE_TH_CLASS)} onClick={() => toggleSort("dist_to_low")}>
                <Tip content="How far above the 52W low the current price is. 0% = at the low (buy zone). Lower is better for entry" below>
                  <span className="cursor-default">Dist to Low</span>
                </Tip>
                <SortArrow active={sortKey === "dist_to_low"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("52w_high")}>
                <Tip content="Rolling 52-week high — this becomes the fixed sell target when the strategy buys" below>
                  <span className="cursor-default">52W High</span>
                </Tip>
                <SortArrow active={sortKey === "52w_high"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("pot_gain")}>
                <Tip content="Potential upside from current price to the 52W high. This is the expected gain if the strategy buys now and the target is hit" below>
                  <span className="cursor-default">Pot. Gain</span>
                </Tip>
                <SortArrow active={sortKey === "pot_gain"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("200_dma")}>
                <Tip content="200-day moving average — a key trend indicator. Price near the DMA often signals a recovery zone" below>
                  <span className="cursor-default">200 DMA</span>
                </Tip>
                <SortArrow active={sortKey === "200_dma"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("pe")}>
                <Tip content="Current Price-to-Earnings ratio — compare with 5Yr average to judge if the stock is cheap or expensive" below>
                  <span className="cursor-default">PE</span>
                </Tip>
                <SortArrow active={sortKey === "pe"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("5yr_pe")}>
                <Tip content="5-year average PE — a long-term valuation benchmark. Current PE below this suggests the stock may be historically cheap" below>
                  <span className="cursor-default">5Yr PE</span>
                </Tip>
                <SortArrow active={sortKey === "5yr_pe"} dir={sortDir} />
              </TableHead>
              <TableHead className={SORTABLE_TH_CLASS} onClick={() => toggleSort("fundamentals")}>
                <Tip content="Whether the stock passes the fundamental quality screen (ROCE, ROE, D/E, OPM, PE checks)" below>
                  <span className="cursor-default">Fundamentals</span>
                </Tip>
                <SortArrow active={sortKey === "fundamentals"} dir={sortDir} />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => {
              const status = getStatus52W(row);
              const distPct = row.distance_to_52w_low_pct;
              const barWidth = distPct != null ? Math.min(distPct / 40, 1) * 100 : 0;
              const fundBadge = getFundBadge(row);
              const isExpanded = expandedTicker === row.ticker;

              return (
                <React.Fragment key={row.ticker}>
                  <TableRow className="hover:bg-muted/30">
                    <TableCell className="font-mono font-semibold text-primary">{row.ticker}</TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs border", STATUS_COLORS[status])}>
                        {STATUS_LABELS[status]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(row.signals ?? []).map((sig) => {
                          const key = sig as SignalKey;
                          return (
                            <span key={sig} className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border", SIGNAL_COLORS[key] ?? "bg-muted text-muted-foreground border-border")}>
                              {SIGNAL_LABELS[key] ?? sig}
                            </span>
                          );
                        })}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.sector}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{row.cap_tier?.replace(" Cap", "")}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCur(row.close)}</TableCell>
                    <TableCell className="text-right tabular-nums text-orange-400">{fmtCur(row["52w_low"])}</TableCell>
                    {/* Dist to low with visual fill bar */}
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={cn("tabular-nums text-xs font-medium", status === "IN_ZONE" ? "text-green-400" : "text-muted-foreground")}>
                          {distPct != null ? `+${distPct.toFixed(1)}%` : "—"}
                        </span>
                        {distPct != null && (
                          <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className={cn("h-full rounded-full",
                                status === "IN_ZONE" ? "bg-green-400" : status === "APPROACHING" ? "bg-amber-400" : "bg-blue-400"
                              )}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-purple-400">{fmtCur(row["52w_high"])}</TableCell>
                    <TableCell className="text-right tabular-nums text-green-400 font-medium text-xs">
                      {row.distance_to_52w_high_pct != null ? `+${Math.abs(row.distance_to_52w_high_pct).toFixed(1)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-amber-400 text-xs">{fmtCur(row.ma)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.pe_current != null ? fmtNum(row.pe_current) + "x" : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{row.pe_5yr_avg != null ? fmtNum(row.pe_5yr_avg) + "x" : "—"}</TableCell>
                    <TableCell>
                      <Tip content={isExpanded ? "Click to collapse fundamentals breakdown" : "Click to see full fundamentals: ROCE, D/E, OPM trend, Sales ATH, Pledged %, and why it passes/fails"} below>
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedTicker(isExpanded ? null : row.ticker); }}
                          className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] border transition-colors cursor-pointer hover:opacity-80", fundBadge.cls)}
                        >
                          {fundBadge.label}
                          <span className="ml-1 opacity-50">{isExpanded ? "▲" : "▼"}</span>
                        </button>
                      </Tip>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={18} className="p-0">
                        <FundDetails row={row} />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={18} className="text-center text-muted-foreground py-8">
                  No stocks match this filter
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

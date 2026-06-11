"use client";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { S200StockOverview, S200ScannerData, S200Status } from "@/lib/types";
import { fmtPct, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

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

interface Props {
  overview: S200StockOverview[];
  scannerData: S200ScannerData | null;
  selectedTicker: string | null;
  onSelect: (ticker: string) => void;
}

type StatusFilter = "ALL" | S200Status;

export function S200StockList({ overview, scannerData, selectedTicker, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("ALL");
  const [cap, sCap] = useState("ALL");
  const [source, setSource] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  const sectors = ["ALL", ...Array.from(new Set(overview.map((s) => s.sector))).sort()];
  const sources = ["ALL", ...Array.from(new Set(overview.map((s) => s.watchlist_source))).sort()];

  // Build status map from scanner
  const statusMap = new Map<string, S200Status>();
  if (scannerData) {
    // Use "best_status" derived from stock_data, or look up in rallies
    for (const rally of scannerData.rallies) {
      if (!statusMap.has(rally.ticker)) {
        statusMap.set(rally.ticker, rally.status);
      }
    }
  }

  let items = overview;
  if (search) items = items.filter((s) => s.ticker.toLowerCase().includes(search.toLowerCase()));
  if (sector !== "ALL") items = items.filter((s) => s.sector === sector);
  if (cap !== "ALL") items = items.filter((s) => s.cap_tier === cap);
  if (source !== "ALL") items = items.filter((s) => s.watchlist_source === source);
  if (statusFilter !== "ALL") {
    items = items.filter((s) => statusMap.get(s.ticker) === statusFilter);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="space-y-2 p-3 border-b border-border">
        <input
          className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Search ticker…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2">
          <Select value={sector} onValueChange={(v) => setSector(v ?? "ALL")}>
            <SelectTrigger className="h-7 text-xs flex-1">
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
          <Select value={cap} onValueChange={(v) => sCap(v ?? "ALL")}>
            <SelectTrigger className="h-7 text-xs flex-1">
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
        </div>
        <div className="flex gap-2">
          <Select value={source} onValueChange={(v) => setSource(v ?? "ALL")}>
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter((v ?? "ALL") as StatusFilter)}>
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs">All Status</SelectItem>
              {(["IN_ZONE", "APPROACHING", "WATCHING_NEAR", "WATCHING", "BELOW_BUY"] as S200Status[]).map((s) => (
                <SelectItem key={s} value={s} className="text-xs">{STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {items.map((s) => {
          const currentStatus = statusMap.get(s.ticker);
          return (
            <button
              key={s.ticker}
              onClick={() => onSelect(s.ticker)}
              className={cn(
                "w-full text-left px-3 py-2.5 border-b border-border/50 hover:bg-muted/30 transition-colors",
                selectedTicker === s.ticker && "bg-primary/10 border-l-2 border-l-primary"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold text-sm text-primary truncate">{s.ticker}</span>
                {currentStatus && (
                  <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border shrink-0", STATUS_COLORS[currentStatus])}>
                    {STATUS_LABELS[currentStatus]}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {s.sector} · {s.cap_tier?.replace(" Cap", "")} · <span className="text-foreground/60">{s.watchlist_source}</span>
              </div>
              <div className="flex gap-3 mt-0.5 text-xs">
                <span className="text-muted-foreground">{s.total_rallies}R</span>
                <span className={cn("font-medium", s.win_rate_pct >= 70 ? "text-green-400" : "text-amber-400")}>
                  {fmtNum(s.win_rate_pct)}%WR
                </span>
                <span className={cn(s.avg_pnl_pct >= 0 ? "text-green-400" : "text-red-400")}>
                  {fmtPct(s.avg_pnl_pct)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

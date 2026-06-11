"use client";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type StockOverview, type ScannerRow, getProximityStatus } from "@/lib/types";
import { fmtCur } from "@/lib/format";
import { cn } from "@/lib/utils";

interface StockListProps {
  overview: StockOverview[];
  scannerRows: ScannerRow[];
  selectedTicker: string | null;
  onSelect: (ticker: string) => void;
}

type OpportunityFilter = "ALL" | "IN_ZONE" | "APPROACHING" | "NEAR";

export function StockList({ overview, scannerRows, selectedTicker, onSelect }: StockListProps) {
  const [sector, setSector] = useState("ALL");
  const [cap, setCap] = useState("ALL");
  const [search, setSearch] = useState("");
  const [opportunity, setOpportunity] = useState<OpportunityFilter>("ALL");

  const scanMap = new Map(scannerRows.map((r) => [r.ticker, r]));

  const sectors = ["ALL", ...Array.from(new Set(overview.map((s) => s.sector))).sort()];
  const caps = ["ALL", "Large Cap", "Mid Cap", "Small Cap"];

  let items = overview;
  if (sector !== "ALL") items = items.filter((s) => s.sector === sector);
  if (cap !== "ALL") items = items.filter((s) => s.cap_tier === cap);
  if (search) items = items.filter((s) => s.ticker.toLowerCase().includes(search.toLowerCase()));
  if (opportunity !== "ALL") {
    items = items.filter((s) => {
      const scanRow = scanMap.get(s.ticker);
      if (!scanRow) return false;
      return getProximityStatus(scanRow) === opportunity;
    });
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
          <Select value={cap} onValueChange={(v) => setCap(v ?? "ALL")}>
            <SelectTrigger className="h-7 text-xs flex-1">
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
        </div>
        <Select value={opportunity} onValueChange={(v) => setOpportunity((v ?? "ALL") as OpportunityFilter)}>
          <SelectTrigger className="h-7 text-xs w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL" className="text-xs">All Opportunities</SelectItem>
            <SelectItem value="IN_ZONE" className="text-xs">At 52W Low now</SelectItem>
            <SelectItem value="APPROACHING" className="text-xs">Approaching low</SelectItem>
            <SelectItem value="NEAR" className="text-xs">Near DMA</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {items.map((s) => {
          const scanRow = scanMap.get(s.ticker);
          const status = scanRow ? getProximityStatus(scanRow) : null;
          const dotColor =
            status === "IN_ZONE"
              ? "bg-green-400"
              : status === "APPROACHING"
              ? "bg-amber-400"
              : "bg-muted-foreground/30";

          return (
            <button
              key={s.ticker}
              onClick={() => onSelect(s.ticker)}
              className={cn(
                "w-full text-left px-3 py-2.5 border-b border-border/50 hover:bg-muted/30 transition-colors",
                selectedTicker === s.ticker && "bg-primary/10 border-l-2 border-l-primary"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-sm text-primary">{s.ticker}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">{s.trades_count}T</span>
                  {s.open_count > 0 && (
                    <span className={cn("w-1.5 h-1.5 rounded-full", dotColor)} />
                  )}
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {s.sector} ·{" "}
                <span className="text-foreground/60">{s.cap_tier?.replace(" Cap", "")}</span>
              </div>
              <div className={cn("text-xs font-medium mt-0.5", s.total_pnl >= 0 ? "text-green-400" : "text-red-400")}>
                P/L {fmtCur(s.total_pnl)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EnvelopeTrade } from "@/lib/types";
import { fmtPct, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

interface StockRow {
  ticker: string;
  cap_tier: string;
  sector: string;
  trades: number;
  winning: number;
  win_rate: number;
  avg_pnl: number;
}

interface Props {
  trades: EnvelopeTrade[];
  selectedTicker: string | null;
  onSelect: (ticker: string) => void;
}

export function EnvelopeStockList({ trades, selectedTicker, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [cap, setCap] = useState("ALL");

  const rows = useMemo<StockRow[]>(() => {
    const map = new Map<string, StockRow>();
    for (const t of trades) {
      if (!map.has(t.stock_ticker)) {
        map.set(t.stock_ticker, {
          ticker: t.stock_ticker,
          cap_tier: t.cap_tier,
          sector: t.sector,
          trades: 0,
          winning: 0,
          avg_pnl: 0,
          win_rate: 0,
        });
      }
      const r = map.get(t.stock_ticker)!;
      r.trades += 1;
      if (t.pnl_pct > 0) r.winning += 1;
      r.avg_pnl += t.pnl_pct;
    }
    for (const r of map.values()) {
      r.win_rate = r.trades > 0 ? (r.winning / r.trades) * 100 : 0;
      r.avg_pnl = r.trades > 0 ? r.avg_pnl / r.trades : 0;
    }
    return Array.from(map.values()).sort((a, b) => b.trades - a.trades);
  }, [trades]);

  let items = rows;
  if (search) items = items.filter((r) => r.ticker.toLowerCase().includes(search.toLowerCase()));
  if (cap !== "ALL") items = items.filter((r) => r.cap_tier === cap);

  return (
    <div className="flex flex-col h-full">
      <div className="space-y-2 p-3 border-b border-border">
        <input
          className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Search ticker…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={cap} onValueChange={(v) => setCap(v ?? "ALL")}>
          <SelectTrigger className="h-7 text-xs w-full">
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

      <div className="flex-1 overflow-y-auto">
        {items.map((r) => (
          <button
            key={r.ticker}
            onClick={() => onSelect(r.ticker)}
            className={cn(
              "w-full text-left px-3 py-2.5 border-b border-border/50 hover:bg-muted/30 transition-colors",
              selectedTicker === r.ticker && "bg-primary/10 border-l-2 border-l-primary"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold text-sm text-primary truncate">{r.ticker}</span>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {r.cap_tier?.replace(" Cap", "")}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">{r.sector}</div>
            <div className="flex gap-3 mt-0.5 text-xs">
              <span className="text-muted-foreground">{r.trades}T</span>
              <span className={cn("font-medium", r.win_rate >= 70 ? "text-green-400" : "text-amber-400")}>
                {fmtNum(r.win_rate)}%WR
              </span>
              <span className={cn(r.avg_pnl >= 0 ? "text-green-400" : "text-red-400")}>
                {fmtPct(r.avg_pnl)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

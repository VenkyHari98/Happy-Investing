"use client";
import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import type { S200ScannerData, S200Status } from "@/lib/types";
import { fmtCur, fmtPct, fmtNum, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";

const STATUS_COLORS: Record<S200Status, string> = {
  IN_ZONE:       "bg-green-500/20 text-green-400 border-green-500/30",
  APPROACHING:   "bg-amber-500/20 text-amber-400 border-amber-500/30",
  WATCHING_NEAR: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  WATCHING:      "bg-muted text-muted-foreground border-border",
  BELOW_BUY:     "bg-rose-500/20 text-rose-400 border-rose-500/30",
  ABOVE_DMA:     "bg-muted/50 text-muted-foreground/60 border-border/50",
};

const STATUS_ORDER: Record<S200Status, number> = {
  IN_ZONE: 0, APPROACHING: 1, WATCHING_NEAR: 2, WATCHING: 3, BELOW_BUY: 4, ABOVE_DMA: 5,
};

const STATUS_LABELS: Record<S200Status, string> = {
  IN_ZONE:       "In Zone",
  APPROACHING:   "Approaching",
  WATCHING_NEAR: "Near",
  WATCHING:      "Watching",
  BELOW_BUY:     "Below Buy",
  ABOVE_DMA:     "Above 200 DMA",
};

type SortOption = "status" | "closest_zone" | "highest_gain" | "expiring_soon" | "biggest_rally" | "ticker_az";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "status", label: "By Status" },
  { value: "closest_zone", label: "Closest to Buy Zone" },
  { value: "highest_gain", label: "Highest Remaining Gain" },
  { value: "expiring_soon", label: "Expiring Soon" },
  { value: "biggest_rally", label: "Biggest Rally %" },
  { value: "ticker_az", label: "Ticker A–Z" },
];

const ACTIVE_STATUSES: S200Status[] = ["IN_ZONE", "APPROACHING", "WATCHING_NEAR", "WATCHING", "BELOW_BUY"];
const ALL_STATUSES: S200Status[] = [...ACTIVE_STATUSES, "ABOVE_DMA"];

interface Props {
  data: S200ScannerData;
}

export function S200Scanner({ data }: Props) {
  const [filter, setFilter] = useState<S200Status | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [watchlist, setWatchlist] = useState("ALL");
  const [sector, setSector] = useState("ALL");
  const [cap, setCap] = useState("ALL");
  const [sortOption, setSortOption] = useState<SortOption>("status");

  const sectors = useMemo(
    () => ["ALL", ...Array.from(new Set(data.rallies.map((r) => r.sector))).sort()],
    [data.rallies]
  );

  const watchlists = useMemo(() => {
    const sources = Array.from(new Set(data.rallies.map((r) => r.watchlist_source).filter(Boolean))).sort();
    return sources.length > 1 ? ["ALL", ...sources] : [];
  }, [data.rallies]);

  const filtered = useMemo(() => {
    let t = data.rallies;
    if (filter !== "ALL") t = t.filter((r) => r.status === filter);
    if (search) t = t.filter((r) => r.ticker.toLowerCase().includes(search.toLowerCase()));
    if (sector !== "ALL") t = t.filter((r) => r.sector === sector);
    if (cap !== "ALL") t = t.filter((r) => r.cap_tier === cap);
    if (watchlist !== "ALL") t = t.filter((r) => r.watchlist_source === watchlist);
    return t;
  }, [data.rallies, filter, search, sector, cap, watchlist]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortOption === "status") {
        const oa = STATUS_ORDER[a.status] ?? 9, ob = STATUS_ORDER[b.status] ?? 9;
        if (oa !== ob) return oa - ob;
        return (a.dist_to_buy_zone_pct ?? 999) - (b.dist_to_buy_zone_pct ?? 999);
      }
      if (sortOption === "closest_zone")
        return (a.dist_to_buy_zone_pct ?? 999) - (b.dist_to_buy_zone_pct ?? 999);
      if (sortOption === "highest_gain")
        return (b.remaining_gain_pct ?? 0) - (a.remaining_gain_pct ?? 0);
      if (sortOption === "expiring_soon")
        return (a.days_to_expiry ?? 9999) - (b.days_to_expiry ?? 9999);
      if (sortOption === "biggest_rally")
        return (b.rally_pct ?? 0) - (a.rally_pct ?? 0);
      if (sortOption === "ticker_az") return a.ticker.localeCompare(b.ticker);
      return 0;
    });
  }, [filtered, sortOption]);

  return (
    <div className="space-y-4">
      {/* Metric cards */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {ACTIVE_STATUSES.map((s) => {
          const count = data.status_counts[s] ?? 0;
          const isActive = count > 0;
          const statusTip = s === "IN_ZONE" ? "Stocks currently in the 20% rally buy zone — the strategy's active buy area"
            : s === "APPROACHING" ? "Stocks heading toward the buy zone but not yet inside it"
            : s === "WATCHING_NEAR" ? "Stocks with a recent rally setup but price is near (not yet at) the buy zone"
            : s === "WATCHING" ? "Active rally setups where the price hasn't returned to the buy zone yet"
            : "Price has dropped below the buy zone — the setup may still be valid but with more risk";
          return (
            <Tip key={s} content={statusTip} below>
              <button
                onClick={() => setFilter(filter === s ? "ALL" : s)}
                className={cn(
                  "flex flex-col items-center px-3 py-2 rounded border transition-colors text-left w-full",
                  filter === s
                    ? "border-primary bg-primary/10"
                    : isActive
                    ? "border-border bg-card/60 hover:bg-muted/40"
                    : "border-border bg-card/30 opacity-50"
                )}
              >
                <span className="text-xs text-muted-foreground">{STATUS_LABELS[s]}</span>
                <span
                  className={cn(
                    "text-xl font-semibold tabular-nums",
                    s === "IN_ZONE" ? "text-green-400" : s === "APPROACHING" ? "text-amber-400" : s === "BELOW_BUY" ? "text-rose-400" : "text-foreground"
                  )}
                >
                  {count}
                </span>
              </button>
            </Tip>
          );
        })}
        <Tip content="Count of 20%+ rally setups currently tracked in the S200 universe" below>
          <Card className="bg-card/60 w-full">
            <CardContent className="px-3 py-2">
              <p className="text-xs text-muted-foreground">Total Rallies</p>
              <p className="text-xl font-semibold">{data.total_rallies}</p>
            </CardContent>
          </Card>
        </Tip>
        <Tip content="Number of S200 stocks checked in the latest scanner run" below>
          <Card className="bg-card/60 w-full">
            <CardContent className="px-3 py-2">
              <p className="text-xs text-muted-foreground">Scanned</p>
              <p className="text-xl font-semibold">{data.stocks_scanned}</p>
            </CardContent>
          </Card>
        </Tip>
        <Tip content="When the scanner data was last refreshed" below>
          <div className="flex flex-col items-center px-3 py-2 rounded border border-border bg-card/60 w-full">
            <span className="text-xs text-muted-foreground">Run Date</span>
            <span className="text-sm font-medium tabular-nums">{data.run_date}</span>
          </div>
        </Tip>
      </div>

      {/* Status pills */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilter("ALL")}
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
            filter === "ALL" ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
          )}
        >
          All <span className="ml-1.5 opacity-70">{data.rallies.length}</span>
        </button>
        {ACTIVE_STATUSES.map((s) => {
          const count = data.status_counts[s] ?? 0;
          if (count === 0) return null;
          return (
            <button
              key={s}
              onClick={() => setFilter(filter === s ? "ALL" : s)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                filter === s ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
              )}
            >
              {STATUS_LABELS[s]} <span className="ml-1.5 opacity-70">{count}</span>
            </button>
          );
        })}
        {/* Above DMA — rejected stocks, shown as a distinct pill at the end */}
        {(data.status_counts["ABOVE_DMA"] ?? 0) > 0 && (
          <button
            onClick={() => setFilter(filter === "ABOVE_DMA" ? "ALL" : "ABOVE_DMA")}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
              filter === "ABOVE_DMA"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/40 text-muted-foreground/70 border-border hover:bg-muted"
            )}
          >
            Above 200 DMA <span className="ml-1.5 opacity-70">{data.status_counts["ABOVE_DMA"]}</span>
          </button>
        )}
      </div>

      {/* Filters + sort */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          className="bg-background border border-border rounded px-3 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-32"
          placeholder="Search ticker…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {watchlists.length > 1 && (
          <Select value={watchlist} onValueChange={(v) => setWatchlist(v ?? "ALL")}>
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {watchlists.map((w) => (
                <SelectItem key={w} value={w} className="text-xs">{w}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
        <Select value={sortOption} onValueChange={(v) => setSortOption((v ?? "status") as SortOption)}>
          <SelectTrigger className="h-7 w-52 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{sorted.length} rallies</span>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Ticker</TableHead>
              <TableHead><Tip content="Which watchlist this stock belongs to: F40 (fundamentally strong), E40 (extended), or S200 (growth universe)" below><span className="cursor-default">Source</span></Tip></TableHead>
              <TableHead>Cap</TableHead>
              <TableHead>Sector</TableHead>
              <TableHead><Tip content="Where the stock currently sits relative to the rally buy zone" below><span className="cursor-default">Status</span></Tip></TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right"><Tip content="The price range to buy at: the rally base ± the entry band" below><span className="cursor-default">Buy Zone</span></Tip></TableHead>
              <TableHead className="text-right min-w-[90px]"><Tip content="How far above the buy zone the current price is. 'In zone' = currently at the buy level" below><span className="cursor-default">Dist to Zone</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="The full rally target price — where the strategy aims to sell" below><span className="cursor-default">Target ₹</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="Remaining % upside from current price to the target — how much profit is still available" below><span className="cursor-default">Rem. Gain</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="The size of the original 20%+ rally that created this setup" below><span className="cursor-default">Rally%</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="Number of price bars (days) the rally took from base to peak" below><span className="cursor-default">Candles</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="Date when the original rally peaked" below><span className="cursor-default">Rally End</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="Date when this rally setup expires — price must enter the buy zone before this date" below><span className="cursor-default">Expiry</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="Calendar days remaining before the setup expires" below><span className="cursor-default">Days Left</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="200-day moving average — a key trend filter for the strategy" below><span className="cursor-default">200 DMA</span></Tip></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r, i) => {
              const isAboveDMA = r.status === "ABOVE_DMA";
              return (
              <TableRow key={i} className={cn("hover:bg-muted/30", isAboveDMA && "opacity-50")}>
                <TableCell className={cn("font-mono font-semibold", isAboveDMA ? "text-muted-foreground" : "text-primary")}>{r.ticker}</TableCell>
                <TableCell>
                  <span className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border",
                    r.watchlist_source === "F40" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                    r.watchlist_source === "E40" ? "bg-purple-500/20 text-purple-400 border-purple-500/30" :
                    "bg-muted text-muted-foreground border-border"
                  )}>
                    {r.watchlist_source ?? "S200"}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{r.cap_tier?.replace(" Cap", "")}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.sector}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs border", STATUS_COLORS[r.status] ?? "bg-muted text-muted-foreground border-border")}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                    {r.above_dma_reason && (
                      <span className="text-[10px] text-muted-foreground/70 pl-0.5">{r.above_dma_reason}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtCur(r.current_price)}</TableCell>
                <TableCell className="text-right tabular-nums text-xs text-green-400">
                  {fmtCur(r.buy_zone_low)}–{fmtCur(r.buy_zone_high)}
                </TableCell>
                <TableCell className="text-right">
                  <span className={cn("tabular-nums text-xs font-medium", r.status === "IN_ZONE" ? "text-green-400" : "text-muted-foreground")}>
                    {r.dist_to_buy_zone_pct != null
                      ? r.dist_to_buy_zone_pct === 0 ? "In zone" : `+${fmtNum(r.dist_to_buy_zone_pct)}%`
                      : "—"}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-purple-400">{fmtCur(r.sell_price)}</TableCell>
                <TableCell className="text-right tabular-nums text-green-400 font-medium">{fmtPct(r.remaining_gain_pct)}</TableCell>
                <TableCell className="text-right tabular-nums text-amber-400 font-medium">{fmtPct(r.rally_pct)}</TableCell>
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                  {r.candle_count ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                  {r.rally_start_date ? fmtDate(r.rally_start_date) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                  {r.expiry_date ? fmtDate(r.expiry_date) : "—"}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums text-xs", r.days_to_expiry < 30 ? "text-rose-400" : "text-muted-foreground")}>
                  {r.days_to_expiry}d
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-amber-400">{fmtCur(r.ma200)}</TableCell>
              </TableRow>
              );
            })}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={16} className="text-center text-muted-foreground py-8">
                  No rallies match this filter
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

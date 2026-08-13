"use client";
import React, { useState, useMemo } from "react";
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
import { fmtCur, fmtPct, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
import { FundDetails } from "@/components/shared/FundDetails";
import { getFundBadge, getFundStatus, type FundStatus } from "@/lib/fundBadge";

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
  const [fundFilter, setFundFilter] = useState<FundStatus | "ALL">("ALL");
  const [sortOption, setSortOption] = useState<SortOption>("status");
  const [dmaOnly, setDmaOnly] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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
    if (dmaOnly) t = t.filter((r) => r.below_200dma === true);
    if (fundFilter !== "ALL") t = t.filter((r) => getFundStatus(r) === fundFilter);
    return t;
  }, [data.rallies, filter, search, sector, cap, watchlist, dmaOnly, fundFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      // dist_to_buy_zone_pct is signed (negative when price has already fallen
      // below the buy zone) — "closest to zone" always means smallest absolute
      // distance, not smallest raw (signed) value.
      if (sortOption === "status") {
        const oa = STATUS_ORDER[a.status] ?? 9, ob = STATUS_ORDER[b.status] ?? 9;
        if (oa !== ob) return oa - ob;
        return Math.abs(a.dist_to_buy_zone_pct ?? 999) - Math.abs(b.dist_to_buy_zone_pct ?? 999);
      }
      if (sortOption === "closest_zone")
        return Math.abs(a.dist_to_buy_zone_pct ?? 999) - Math.abs(b.dist_to_buy_zone_pct ?? 999);
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
        <Tip content="Show only setups whose buy zone is below the 200 DMA — a key strategy requirement. Above-DMA setups are invalid entries." below>
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
              <TableHead className="text-right"><Tip content="Date when the original rally peaked (highest price of the rally)" below><span className="cursor-default">Rally Peak</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="Date when this rally setup expires — price must enter the buy zone before this date" below><span className="cursor-default">Expiry</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="Calendar days remaining before the setup expires" below><span className="cursor-default">Days Left</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="200-day moving average — a key trend filter for the strategy" below><span className="cursor-default">200 DMA</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="Current Price-to-Earnings ratio" below><span className="cursor-default">PE</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="5-year average PE — compare with current to judge if the stock is historically cheap" below><span className="cursor-default">5yr PE</span></Tip></TableHead>
              <TableHead>Fundamentals</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r, i) => {
              const isAboveDMA = r.status === "ABOVE_DMA";
              const fundBadge = getFundBadge(r);
              const isExpanded = expandedKey === String(i);
              return (
              <React.Fragment key={i}>
              <TableRow className={cn("hover:bg-muted/30", isAboveDMA && "opacity-50")}>
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
                      ? r.dist_to_buy_zone_pct === 0 ? "In zone" : fmtPct(r.dist_to_buy_zone_pct)
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
                  {r.rally_end_date ? fmtDate(r.rally_end_date) : r.rally_start_date ? fmtDate(r.rally_start_date) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                  {r.expiry_date ? fmtDate(r.expiry_date) : "—"}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums text-xs", r.days_to_expiry < 30 ? "text-rose-400" : "text-muted-foreground")}>
                  {r.days_to_expiry}d
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-amber-400">{fmtCur(r.ma200)}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">
                  {r.pe_current != null ? `${r.pe_current.toFixed(1)}x` : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                  {r.pe_5yr_avg != null ? `${r.pe_5yr_avg.toFixed(1)}x` : "—"}
                </TableCell>
                <TableCell>
                  <Tip content={isExpanded ? "Click to collapse fundamentals breakdown" : "Click to see full fundamentals: ROCE, D/E, OPM trend, Sales ATH, Pledged %, and why it passes/fails"} below>
                    <button
                      onClick={(e) => { e.stopPropagation(); setExpandedKey(isExpanded ? null : String(i)); }}
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
                  <TableCell colSpan={19} className="p-0">
                    <FundDetails row={r} />
                  </TableCell>
                </TableRow>
              )}
              </React.Fragment>
              );
            })}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={19} className="text-center text-muted-foreground py-8">
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

"use client";
import React, { useState, useMemo, useCallback } from "react";
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
import type { SROpportunity, SRScannerData, SRStatus } from "@/lib/types";
import { fmtCur, fmtPct, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
import { FundDetails } from "@/components/shared/FundDetails";
import { getFundBadge, getFundStatus, type FundStatus } from "@/lib/fundBadge";
import { useSort } from "@/lib/useSort";
import { SortArrow, SORTABLE_TH_CLASS } from "@/components/shared/SortArrow";

const STATUS_COLORS: Record<SRStatus, string> = {
  IN_ZONE:   "bg-green-500/20 text-green-400 border-green-500/30",
  WATCHING:  "bg-muted text-muted-foreground border-border",
  ABOVE_DMA: "bg-muted/50 text-muted-foreground/60 border-border/50",
};

const STATUS_ORDER: Record<SRStatus, number> = { IN_ZONE: 0, WATCHING: 1, ABOVE_DMA: 2 };

const STATUS_LABELS: Record<SRStatus, string> = {
  IN_ZONE:   "At Support",
  WATCHING:  "Watching",
  ABOVE_DMA: "Above 200 DMA",
};

type SortOption = "status" | "closest_support" | "highest_gain" | "most_touches" | "ticker_az";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "status", label: "By Status" },
  { value: "closest_support", label: "Closest to Support" },
  { value: "highest_gain", label: "Highest Remaining Gain" },
  { value: "most_touches", label: "Most Touches (conviction)" },
  { value: "ticker_az", label: "Ticker A–Z" },
];

const ACTIVE_STATUSES: SRStatus[] = ["IN_ZONE", "WATCHING"];

interface Props {
  data: SRScannerData;
}

export function SRScanner({ data }: Props) {
  const [filter, setFilter] = useState<SRStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [watchlist, setWatchlist] = useState("ALL");
  const [sector, setSector] = useState("ALL");
  const [cap, setCap] = useState("ALL");
  const [fundFilter, setFundFilter] = useState<FundStatus | "ALL">("ALL");
  const [dmaOnly, setDmaOnly] = useState(false);
  const [sortOption, setSortOption] = useState<SortOption>("status");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const sectors = useMemo(
    () => ["ALL", ...Array.from(new Set(data.opportunities.map((r) => r.sector))).sort()],
    [data.opportunities]
  );

  const watchlists = useMemo(() => {
    const sources = Array.from(new Set(data.opportunities.map((r) => r.watchlist_source).filter(Boolean))).sort();
    return sources.length > 1 ? ["ALL", ...sources] : [];
  }, [data.opportunities]);

  const filtered = useMemo(() => {
    let t = data.opportunities;
    if (filter !== "ALL") t = t.filter((r) => r.status === filter);
    if (search) t = t.filter((r) => r.ticker.toLowerCase().includes(search.toLowerCase()));
    if (sector !== "ALL") t = t.filter((r) => r.sector === sector);
    if (cap !== "ALL") t = t.filter((r) => r.cap_tier === cap);
    if (watchlist !== "ALL") t = t.filter((r) => r.watchlist_source === watchlist);
    if (fundFilter !== "ALL") t = t.filter((r) => getFundStatus(r) === fundFilter);
    if (dmaOnly) t = t.filter((r) => r.fund_below_200dma === true);
    return t;
  }, [data.opportunities, filter, search, sector, cap, watchlist, fundFilter, dmaOnly]);

  const presetSorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortOption === "status") {
        const oa = STATUS_ORDER[a.status] ?? 9, ob = STATUS_ORDER[b.status] ?? 9;
        if (oa !== ob) return oa - ob;
        return Math.abs(a.dist_to_support_pct) - Math.abs(b.dist_to_support_pct);
      }
      if (sortOption === "closest_support")
        return Math.abs(a.dist_to_support_pct) - Math.abs(b.dist_to_support_pct);
      if (sortOption === "highest_gain")
        return (b.remaining_gain_pct ?? 0) - (a.remaining_gain_pct ?? 0);
      if (sortOption === "most_touches")
        return b.touch_count - a.touch_count;
      if (sortOption === "ticker_az") return a.ticker.localeCompare(b.ticker);
      return 0;
    });
  }, [filtered, sortOption]);

  // Clicking a column header overrides the preset dropdown sort above.
  const getSortValue = useCallback((r: SROpportunity, key: string): unknown => {
    switch (key) {
      case "ticker": return r.ticker;
      case "source": return r.watchlist_source ?? "S200";
      case "cap": return r.cap_tier;
      case "sector": return r.sector;
      case "status": return STATUS_ORDER[r.status];
      case "price": return r.current_price;
      case "support": return r.support_level;
      case "dist_support": return Math.abs(r.dist_to_support_pct);
      case "touches": return r.touch_count;
      case "resistance": return r.resistance_level;
      case "rem_gain": return r.remaining_gain_pct;
      case "zone_gain": return r.zone_gain_pct;
      case "dma": return r.ma200;
      case "pe": return r.pe_current;
      case "abcd_b": return r.abcd_b_level;
      case "fundamentals": return { pass: 2, no_data: 1, fail: 0 }[getFundStatus(r)];
      default: return null;
    }
  }, []);
  const { sorted: columnSorted, sortKey, sortDir, toggleSort } = useSort(presetSorted, getSortValue);
  const sorted = sortKey ? columnSorted : presetSorted;

  return (
    <div className="space-y-4">
      {/* Metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
        {ACTIVE_STATUSES.map((s) => {
          const count = data.status_counts[s] ?? 0;
          const isActive = count > 0;
          const statusTip = s === "IN_ZONE"
            ? "Price is within 1.5% of a validated support zone (≥2 prior touches) and below the 200 DMA — the strategy's buy zone"
            : "Support zone detected but either only 1 confirmed prior touch (still building conviction) or price isn't currently near it";
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
                <span className={cn("text-xl font-semibold tabular-nums", s === "IN_ZONE" ? "text-green-400" : "text-foreground")}>
                  {count}
                </span>
              </button>
            </Tip>
          );
        })}
        <Tip content="Setups where the support zone itself sits above the current 200 DMA — notes say buy point should be below 200 DMA, so these are excluded from active signals" below>
          <Card className="bg-card/40 w-full opacity-70">
            <CardContent className="px-3 py-2">
              <p className="text-xs text-muted-foreground">Above 200 DMA</p>
              <p className="text-xl font-semibold">{data.status_counts["ABOVE_DMA"] ?? 0}</p>
            </CardContent>
          </Card>
        </Tip>
        <Tip content="Number of F40+E40+S200 stocks checked in the latest scanner run" below>
          <Card className="bg-card/60 w-full">
            <CardContent className="px-3 py-2">
              <p className="text-xs text-muted-foreground">Scanned</p>
              <p className="text-xl font-semibold">{data.stocks_scanned}</p>
            </CardContent>
          </Card>
        </Tip>
        {data.filtered_low_gain_count != null && (
          <Tip content="Setups with no confirmed resistance target, or whose fixed support→resistance return doesn't clear the cap-tier minimum (Large Cap ≥20%, Mid/Small Cap ≥30%) — dropped before they ever reach this table" below>
            <Card className="bg-card/40 w-full opacity-70">
              <CardContent className="px-3 py-2">
                <p className="text-xs text-muted-foreground">Filtered (Low Gain)</p>
                <p className="text-xl font-semibold">{data.filtered_low_gain_count}</p>
              </CardContent>
            </Card>
          </Tip>
        )}
        <Tip content="When the scanner data was last refreshed" below>
          <div className="flex flex-col items-center px-3 py-2 rounded border border-border bg-card/60 w-full">
            <span className="text-xs text-muted-foreground">Run Date</span>
            <span className="text-sm font-medium tabular-nums">{data.run_date}</span>
          </div>
        </Tip>
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
          <SelectTrigger className="h-7 w-56 text-xs">
            <SelectValue />
          </SelectTrigger>
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
        <span className="text-xs text-muted-foreground ml-auto">{sorted.length} setups</span>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={SORTABLE_TH_CLASS} onClick={() => toggleSort("ticker")}>
                Ticker<SortArrow active={sortKey === "ticker"} dir={sortDir} />
              </TableHead>
              <TableHead className={SORTABLE_TH_CLASS} onClick={() => toggleSort("source")}>
                <Tip content="Which watchlist this stock belongs to: F40 (fundamentally strong), E40 (extended), or S200 (growth universe)" below><span className="cursor-default">Source</span></Tip>
                <SortArrow active={sortKey === "source"} dir={sortDir} />
              </TableHead>
              <TableHead className={SORTABLE_TH_CLASS} onClick={() => toggleSort("cap")}>
                Cap<SortArrow active={sortKey === "cap"} dir={sortDir} />
              </TableHead>
              <TableHead className={SORTABLE_TH_CLASS} onClick={() => toggleSort("sector")}>
                Sector<SortArrow active={sortKey === "sector"} dir={sortDir} />
              </TableHead>
              <TableHead className={SORTABLE_TH_CLASS} onClick={() => toggleSort("status")}>
                <Tip content="At Support = 3rd+ approach to a validated (≥2 touch) zone, below 200 DMA. Watching = still building conviction (1 prior touch) or not currently near the zone." below><span className="cursor-default">Status</span></Tip>
                <SortArrow active={sortKey === "status"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("price")}>
                Price<SortArrow active={sortKey === "price"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("support")}>
                <Tip content="The detected support zone level — buy at this price. Prices within ±1.5% cluster into the same zone; minimum 2 touches to be a valid level." below><span className="cursor-default">Support</span></Tip>
                <SortArrow active={sortKey === "support"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right min-w-[90px]", SORTABLE_TH_CLASS)} onClick={() => toggleSort("dist_support")}>
                <Tip content="How far current price is from the support level, as a %. Negative = price is below support." below><span className="cursor-default">Dist to Support</span></Tip>
                <SortArrow active={sortKey === "dist_support"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("touches")}>
                <Tip content="Number of confirmed times the stock has bounced off this level in the trailing 5 years — higher = more conviction (bus analogy: 2nd time confirms, 3rd time is the trade)" below><span className="cursor-default">Touches</span></Tip>
                <SortArrow active={sortKey === "touches"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("resistance")}>
                <Tip content="The nearest validated resistance zone above support — sell target (±1.5% band, same as support)" below><span className="cursor-default">Resistance ₹</span></Tip>
                <SortArrow active={sortKey === "resistance"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("zone_gain")}>
                <Tip content="Fixed support→resistance return — a property of the zone itself, not today's price. Every row here already clears its cap-tier minimum (Large Cap ≥20%, Mid/Small Cap ≥30%); setups below that are dropped before they reach this table." below><span className="cursor-default">Zone Gain</span></Tip>
                <SortArrow active={sortKey === "zone_gain"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("rem_gain")}>
                <Tip content="Remaining % upside from today's price to the resistance target — moves daily as price moves, unlike Zone Gain" below><span className="cursor-default">Rem. Gain</span></Tip>
                <SortArrow active={sortKey === "rem_gain"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("dma")}>
                <Tip content="200-day moving average — the support zone must sit below this to be a valid buy per the strategy rules" below><span className="cursor-default">200 DMA</span></Tip>
                <SortArrow active={sortKey === "dma"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("pe")}>
                PE<SortArrow active={sortKey === "pe"} dir={sortDir} />
              </TableHead>
              <TableHead className={cn("text-right", SORTABLE_TH_CLASS)} onClick={() => toggleSort("abcd_b")}>
                <Tip content="Informational only (no simulated averaging yet): the -10% ABCD reference price if the stock falls below support" below><span className="cursor-default">ABCD (B)</span></Tip>
                <SortArrow active={sortKey === "abcd_b"} dir={sortDir} />
              </TableHead>
              <TableHead className={SORTABLE_TH_CLASS} onClick={() => toggleSort("fundamentals")}>
                Fundamentals<SortArrow active={sortKey === "fundamentals"} dir={sortDir} />
              </TableHead>
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
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs border", STATUS_COLORS[r.status] ?? "bg-muted text-muted-foreground border-border")}>
                        {STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCur(r.current_price)}</TableCell>
                    <TableCell className="text-right tabular-nums text-green-400">{fmtCur(r.support_level)}</TableCell>
                    <TableCell className="text-right">
                      <span className={cn("tabular-nums text-xs font-medium", r.status === "IN_ZONE" ? "text-green-400" : "text-muted-foreground")}>
                        {r.dist_to_support_pct > 0 ? "+" : ""}{fmtNum(r.dist_to_support_pct)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      <span className={r.touch_count >= 2 ? "text-amber-400 font-medium" : "text-muted-foreground"}>
                        {r.touch_count}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-purple-400">
                      {r.resistance_level != null ? fmtCur(r.resistance_level) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-amber-300 font-semibold">
                      {r.zone_gain_pct != null ? fmtPct(r.zone_gain_pct) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-green-400 font-medium">
                      {r.remaining_gain_pct != null ? fmtPct(r.remaining_gain_pct) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-amber-400">{r.ma200 != null ? fmtCur(r.ma200) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.pe_current != null ? fmtNum(r.pe_current) + "x" : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{fmtCur(r.abcd_b_level)}</TableCell>
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
                      <TableCell colSpan={16} className="p-0">
                        <FundDetails row={r} />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={16} className="text-center text-muted-foreground py-8">
                  No setups match this filter
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Algorithmic zone detection (swing-point clustering) — cross-check visually on TradingView before trading.
        Minimum 2 confirmed touches for a valid zone; support must sit below the 200 DMA per strategy rules.
      </p>
    </div>
  );
}

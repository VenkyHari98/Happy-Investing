"use client";
import React, { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { fmtCur } from "@/lib/format";
import { Tip } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RHSScannerData, RHSOpportunity } from "@/lib/types";
import { FundDetails } from "@/components/shared/FundDetails";
import { getFundBadge, getFundStatus, type FundStatus } from "@/lib/fundBadge";
import { useSort } from "@/lib/useSort";
import { SortArrow, SORTABLE_TH_CLASS } from "@/components/shared/SortArrow";

const STATUS_STYLE: Record<string, string> = {
  BREAKOUT: "bg-green-500/15 text-green-400 border border-green-500/30",
  FORMING:  "bg-amber-500/15 text-amber-400 border border-amber-500/30",
};

const TYPE_STYLE: Record<string, string> = {
  RHS: "bg-orange-500/15 text-orange-400",
  CWH: "bg-blue-500/15 text-blue-400",
};

function calcUpside(opp: RHSOpportunity): number {
  return (opp.target - opp.current_price) / opp.current_price * 100;
}

interface Props {
  data: RHSScannerData;
  onSelectTicker?: (ticker: string) => void;
}

export function RHSScanner({ data, onSelectTicker }: Props) {
  const [patternFilter, setPatternFilter] = useState<"ALL" | "RHS" | "CWH">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "BREAKOUT" | "FORMING">("ALL");
  const [search, setSearch] = useState("");
  const [cap, setCap] = useState("ALL");
  const [sector, setSector] = useState("ALL");
  const [fundFilter, setFundFilter] = useState<FundStatus | "ALL">("ALL");
  const [dmaOnly, setDmaOnly] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const { opportunities } = data;

  const sectors = useMemo(
    () => ["ALL", ...Array.from(new Set(opportunities.map((o) => o.sector).filter(Boolean))).sort()],
    [opportunities]
  );

  const filtered = useMemo(() => {
    let t = opportunities;
    if (patternFilter !== "ALL") t = t.filter((o) => o.pattern_type === patternFilter);
    if (statusFilter  !== "ALL") t = t.filter((o) => o.status        === statusFilter);
    if (search) t = t.filter((o) => o.ticker.toLowerCase().includes(search.toLowerCase()));
    if (cap    !== "ALL") t = t.filter((o) => o.cap_tier === cap);
    if (sector !== "ALL") t = t.filter((o) => o.sector   === sector);
    if (fundFilter !== "ALL") t = t.filter((o) => getFundStatus(o) === fundFilter);
    if (dmaOnly) t = t.filter((o) => o.fund_below_200dma === true);
    return t;
  }, [opportunities, patternFilter, statusFilter, search, cap, sector, fundFilter, dmaOnly]);

  // Baseline (no column clicked yet): BREAKOUT first, then closest to/past neckline
  const presetSorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.status !== b.status) return a.status === "BREAKOUT" ? -1 : 1;
      return a.pct_to_neckline - b.pct_to_neckline;
    });
  }, [filtered]);

  const getSortValue = useCallback((opp: RHSOpportunity, key: string): unknown => {
    switch (key) {
      case "ticker": return opp.ticker;
      case "pattern_type": return opp.pattern_type;
      case "status": return opp.status;
      case "price": return opp.current_price;
      case "neckline": return opp.neckline;
      case "pct_to_neckline": return opp.pct_to_neckline;
      case "target": return opp.target;
      case "upside": return calcUpside(opp);
      case "pattern_start": return opp.pattern_start_date;
      case "cap_tier": return opp.cap_tier;
      case "pe": return opp.pe_current;
      case "5yr_pe": return opp.pe_5yr_avg;
      case "fundamentals": return { pass: 2, no_data: 1, fail: 0 }[getFundStatus(opp)];
      default: return null;
    }
  }, []);
  const { sorted: columnSorted, sortKey, sortDir, toggleSort, clearSort } = useSort(presetSorted, getSortValue);
  const sorted = sortKey ? columnSorted : presetSorted;

  function sortArrow(col: string) {
    return <SortArrow active={sortKey === col} dir={sortDir} />;
  }

  const counts = useMemo(() => {
    const base = opportunities.filter((o) =>
      (patternFilter === "ALL" || o.pattern_type === patternFilter)
    );
    return {
      rhs:      base.filter((o) => o.pattern_type === "RHS").length,
      cwh:      base.filter((o) => o.pattern_type === "CWH").length,
      breakout: base.filter((o) => o.status === "BREAKOUT").length,
      forming:  base.filter((o) => o.status === "FORMING").length,
    };
  }, [opportunities, patternFilter]);

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="bg-muted/40 px-2 py-0.5 rounded">
          Scanned: <span className="text-foreground font-medium">{data.stocks_scanned}</span>
        </span>
        <span className="bg-green-500/10 text-green-400 px-2 py-0.5 rounded">
          Breakout: {data.breakout_count}
        </span>
        <span className="bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded">
          Forming: {data.forming_count}
        </span>
        <span className="bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded">
          RHS: {data.rhs_count}
        </span>
        <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded">
          CWH: {data.cwh_count}
        </span>
        <span className="ml-auto text-muted-foreground">Run: {data.run_date}</span>
      </div>

      {/* Pattern type toggle + status pills */}
      <div className="flex gap-2 flex-wrap items-center">
        {/* Pattern type toggle */}
        <div className="flex border border-border rounded-md overflow-hidden">
          {(["ALL", "RHS", "CWH"] as const).map((p) => (
            <Tip
              key={p}
              content={
                p === "RHS" ? `Reverse Head & Shoulders — bullish reversal pattern (${counts.rhs} found)`
                : p === "CWH" ? `Cup with Handle — breakout continuation pattern (${counts.cwh} found)`
                : "Show all pattern types"
              }
              below
            >
              <button
                onClick={() => setPatternFilter(p)}
                className={cn(
                  "px-3 py-1 text-xs font-medium transition-colors",
                  patternFilter === p
                    ? p === "RHS"
                      ? "bg-orange-500/20 text-orange-400"
                      : p === "CWH"
                      ? "bg-blue-500/20 text-blue-400"
                      : "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {p === "ALL" ? "All Patterns" : p}
                {p !== "ALL" && (
                  <span className="ml-1.5 opacity-70">{p === "RHS" ? counts.rhs : counts.cwh}</span>
                )}
              </button>
            </Tip>
          ))}
        </div>
        {/* Status pills */}
        {(["ALL", "BREAKOUT", "FORMING"] as const).map((id) => (
          <Tip
            key={id}
            content={
              id === "BREAKOUT" ? "Neckline crossed within the last 30 days — active breakout in progress"
              : id === "FORMING"  ? "Pattern detected but breakout not yet confirmed"
              : "Show all statuses"
            }
            below
          >
            <button
              onClick={() => setStatusFilter(id)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                statusFilter === id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
              )}
            >
              {id === "ALL" ? "All" : id === "BREAKOUT" ? "Breakout" : "Forming"}
              {id !== "ALL" && (
                <span className="ml-1.5 opacity-70">{id === "BREAKOUT" ? counts.breakout : counts.forming}</span>
              )}
            </button>
          </Tip>
        ))}
      </div>

      {/* Filter bar */}
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
        <button
          onClick={clearSort}
          className={cn(
            "px-3 py-1 rounded text-xs font-medium border transition-colors",
            sortKey === null
              ? "bg-primary/10 text-primary border-primary/30"
              : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
          )}
        >
          Default Sort
        </button>
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
        <span className="text-xs text-muted-foreground ml-auto">{sorted.length} patterns</span>
      </div>

      {opportunities.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          No current RHS or CWH patterns detected.
          <p className="text-xs mt-1">Run the backtest engine to generate scanner data.</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          No patterns match this filter
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th
                  className={cn("text-left px-3 py-2 font-medium text-muted-foreground select-none", SORTABLE_TH_CLASS)}
                  onClick={() => toggleSort("ticker", "asc")}
                >
                  Ticker {sortArrow("ticker")}
                </th>
                <th
                  className={cn("text-left px-3 py-2 font-medium text-muted-foreground select-none", SORTABLE_TH_CLASS)}
                  onClick={() => toggleSort("pattern_type", "asc")}
                >
                  Pattern {sortArrow("pattern_type")}
                </th>
                <th
                  className={cn("text-left px-3 py-2 font-medium text-muted-foreground select-none", SORTABLE_TH_CLASS)}
                  onClick={() => toggleSort("status", "asc")}
                >
                  Status {sortArrow("status")}
                </th>
                <th
                  className={cn("text-right px-3 py-2 font-medium text-muted-foreground select-none", SORTABLE_TH_CLASS)}
                  onClick={() => toggleSort("price")}
                >
                  Price {sortArrow("price")}
                </th>
                <th
                  className={cn("text-right px-3 py-2 font-medium text-muted-foreground select-none", SORTABLE_TH_CLASS)}
                  onClick={() => toggleSort("neckline")}
                >
                  Neckline {sortArrow("neckline")}
                </th>
                <th
                  className={cn("text-right px-3 py-2 font-medium text-muted-foreground select-none", SORTABLE_TH_CLASS)}
                  onClick={() => toggleSort("pct_to_neckline", "asc")}
                >
                  <Tip content="% distance from current price to the neckline. Negative = already past neckline (breakout territory)" below>
                    <span>% to Neckline {sortArrow("pct_to_neckline")}</span>
                  </Tip>
                </th>
                <th
                  className={cn("text-right px-3 py-2 font-medium text-muted-foreground select-none", SORTABLE_TH_CLASS)}
                  onClick={() => toggleSort("target")}
                >
                  Target {sortArrow("target")}
                </th>
                <th
                  className={cn("text-right px-3 py-2 font-medium text-muted-foreground select-none", SORTABLE_TH_CLASS)}
                  onClick={() => toggleSort("upside")}
                >
                  <Tip content="Remaining % upside from current price to the pattern target. Click to sort." below>
                    <span>Upside {sortArrow("upside")}</span>
                  </Tip>
                </th>
                <th
                  className={cn("text-left px-3 py-2 font-medium text-muted-foreground select-none", SORTABLE_TH_CLASS)}
                  onClick={() => toggleSort("pattern_start", "asc")}
                >
                  Pattern Start {sortArrow("pattern_start")}
                </th>
                <th
                  className={cn("text-left px-3 py-2 font-medium text-muted-foreground select-none", SORTABLE_TH_CLASS)}
                  onClick={() => toggleSort("cap_tier", "asc")}
                >
                  Cap {sortArrow("cap_tier")}
                </th>
                <th
                  className={cn("text-right px-3 py-2 font-medium text-muted-foreground select-none", SORTABLE_TH_CLASS)}
                  onClick={() => toggleSort("pe")}
                >
                  PE {sortArrow("pe")}
                </th>
                <th
                  className={cn("text-right px-3 py-2 font-medium text-muted-foreground select-none", SORTABLE_TH_CLASS)}
                  onClick={() => toggleSort("5yr_pe")}
                >
                  5yr PE {sortArrow("5yr_pe")}
                </th>
                <th
                  className={cn("text-left px-3 py-2 font-medium text-muted-foreground select-none", SORTABLE_TH_CLASS)}
                  onClick={() => toggleSort("fundamentals", "asc")}
                >
                  Fundamentals {sortArrow("fundamentals")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((opp, i) => {
                const upside = calcUpside(opp);
                const rowKey = `${opp.ticker}-${opp.pattern_type}-${i}`;
                const fundBadge = getFundBadge(opp);
                const isExpanded = expandedKey === rowKey;
                return (
                  <React.Fragment key={rowKey}>
                  <tr
                    className="border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
                    onClick={() => onSelectTicker?.(opp.ticker)}
                  >
                    <td className="px-3 py-2 font-medium text-foreground font-mono">{opp.ticker}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TYPE_STYLE[opp.pattern_type] ?? ""}`}>
                        {opp.pattern_type}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_STYLE[opp.status] ?? ""}`}>
                        {opp.status}
                      </span>
                      {opp.tracked_open && (
                        <Tip content={`Still open since ${opp.first_seen} — carried forward from an earlier scan since it hasn't hit target or expired yet`} below>
                          <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            open since {opp.first_seen}
                          </span>
                        </Tip>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">₹{opp.current_price.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-400">₹{opp.neckline.toLocaleString("en-IN")}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${opp.pct_to_neckline < 0 ? "text-green-400" : "text-muted-foreground"}`}>
                      {opp.pct_to_neckline > 0 ? "+" : ""}{opp.pct_to_neckline.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-400">{fmtCur(opp.target)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-400">+{upside.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-muted-foreground">{opp.pattern_start_date}</td>
                    <td className="px-3 py-2 text-muted-foreground">{opp.cap_tier}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {opp.pe_current != null ? `${opp.pe_current.toFixed(1)}x` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {opp.pe_5yr_avg != null ? `${opp.pe_5yr_avg.toFixed(1)}x` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Tip content={isExpanded ? "Click to collapse fundamentals breakdown" : "Click to see full fundamentals: ROCE, D/E, OPM trend, Sales ATH, Pledged %, and why it passes/fails"} below>
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedKey(isExpanded ? null : rowKey); }}
                          className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] border transition-colors cursor-pointer hover:opacity-80", fundBadge.cls)}
                        >
                          {fundBadge.label}
                          <span className="ml-1 opacity-50">{isExpanded ? "▲" : "▼"}</span>
                        </button>
                      </Tip>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-b border-border/50">
                      <td colSpan={13} className="p-0">
                        <div className="bg-muted/20 border-t border-border/50 px-4 py-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
                          {opp.pattern_type === "RHS" ? (
                            <>
                              <span className="text-muted-foreground">
                                Head: <span className="text-foreground font-medium tabular-nums">{opp.head_price != null ? fmtCur(opp.head_price) : "—"}</span>
                              </span>
                              <span className="text-muted-foreground">
                                Right Shoulder: <span className="text-foreground font-medium tabular-nums">{opp.r_shoulder_price != null ? fmtCur(opp.r_shoulder_price) : "—"}</span>
                                {opp.r_shoulder_date ? ` (${opp.r_shoulder_date})` : ""}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-muted-foreground">
                                Cup Bottom: <span className="text-foreground font-medium tabular-nums">{opp.cup_bottom_price != null ? fmtCur(opp.cup_bottom_price) : "—"}</span>
                              </span>
                              <span className="text-muted-foreground">
                                Handle Low: <span className="text-foreground font-medium tabular-nums">{opp.handle_low_price != null ? fmtCur(opp.handle_low_price) : "—"}</span>
                                {opp.handle_low_date ? ` (${opp.handle_low_date})` : ""}
                              </span>
                            </>
                          )}
                          <span className="text-muted-foreground">
                            Breakout Date: <span className="text-foreground font-medium">{opp.breakout_date ?? "—"}</span>
                          </span>
                          {opp.tracked_open && (
                            <span className="text-amber-400">
                              Open since {opp.first_seen} — carried forward from an earlier scan, no target hit yet
                            </span>
                          )}
                        </div>
                        <FundDetails row={opp} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Algorithmic pre-screen only — confirm visually on TradingView before trading.
        FORMING = pattern detected, no breakout yet. BREAKOUT = neckline crossed within last 30 days.
      </p>
    </div>
  );
}

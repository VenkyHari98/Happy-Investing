"use client";
import { Fragment, useState, useMemo } from "react";
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
import type { ScannerRow } from "@/lib/types";
import { fmtCur, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
import { FundDetails } from "@/components/shared/FundDetails";
import { getFundBadge, getFundStatus, type FundStatus } from "@/lib/fundBadge";

// Long and Short are two independent tracks, each measured from their own
// band (lower for Long, upper for Short) — a stock's Short-side distance has
// no bearing on its Long-side status and vice versa. "Deeper past the trigger
// line" always qualifies as In Zone, with no cap on depth (more down = better
// for Long; more up = better for Short) — only the "not there yet" side (above
// the lower band for Long, below the upper band for Short) is tiered.
type EnvStatus = "IN_ZONE" | "NEAR" | "APPROACHING" | "NOT_QUALIFIED";

const STATUS_COLORS: Record<EnvStatus, string> = {
  IN_ZONE:       "bg-green-500/20 text-green-400 border-green-500/30",
  NEAR:          "bg-blue-500/20 text-blue-400 border-blue-500/30",
  APPROACHING:   "bg-amber-500/20 text-amber-400 border-amber-500/30",
  NOT_QUALIFIED: "bg-muted/50 text-muted-foreground/60 border-border/50",
};
const STATUS_LABELS: Record<EnvStatus, string> = {
  IN_ZONE:       "In Zone",
  NEAR:          "Near",
  APPROACHING:   "Approaching",
  NOT_QUALIFIED: "Not Qualified",
};
const STATUS_ORDER: Record<EnvStatus, number> = { IN_ZONE: 0, NEAR: 1, APPROACHING: 2, NOT_QUALIFIED: 3 };

function getDirectionalEnvStatus(row: ScannerRow, direction: "LONG" | "SHORT"): EnvStatus {
  const raw = direction === "LONG" ? row.distance_to_lower_envelope_pct : row.distance_to_upper_envelope_pct;
  if (raw == null) return "NOT_QUALIFIED";
  // Normalize so "more negative" always means "further past the trigger line,
  // in the good direction" for both Long (below lower band) and Short (above
  // upper band) — Short's raw distance is inverted relative to Long's.
  const d = direction === "LONG" ? raw : -raw;
  if (d <= 2) return "IN_ZONE";
  if (d <= 5) return "NEAR";
  if (d <= 7) return "APPROACHING";
  return "NOT_QUALIFIED";
}

// For the "ALL" view a stock can realistically only be near one band at a
// time (the two bands sit 2x envelopePct apart on the 200 SMA) — show
// whichever direction it currently qualifies for; default to Long (the
// primary buy-side focus) when it qualifies for neither.
function getEnvStatusForFilter(
  row: ScannerRow,
  filter: "ALL" | "LONG" | "SHORT"
): { status: EnvStatus; direction: "LONG" | "SHORT" } {
  if (filter === "LONG") return { status: getDirectionalEnvStatus(row, "LONG"), direction: "LONG" };
  if (filter === "SHORT") return { status: getDirectionalEnvStatus(row, "SHORT"), direction: "SHORT" };
  const longStatus = getDirectionalEnvStatus(row, "LONG");
  if (longStatus !== "NOT_QUALIFIED") return { status: longStatus, direction: "LONG" };
  const shortStatus = getDirectionalEnvStatus(row, "SHORT");
  if (shortStatus !== "NOT_QUALIFIED") return { status: shortStatus, direction: "SHORT" };
  return { status: "NOT_QUALIFIED", direction: "LONG" };
}

interface EnvelopeScannerTabProps {
  rows: ScannerRow[];
  runDate?: string;
  envelopePct?: number;
}

export function EnvelopeScannerTab({ rows, runDate, envelopePct = 14 }: EnvelopeScannerTabProps) {
  const [signalFilter, setSignalFilter] = useState<"ALL" | "LONG" | "SHORT">("LONG");
  const [statusFilter, setStatusFilter] = useState<EnvStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("ALL");
  const [cap, setCap] = useState("ALL");
  const [fundFilter, setFundFilter] = useState<FundStatus | "ALL">("ALL");
  const [dmaOnly, setDmaOnly] = useState(false);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

  const sectors = useMemo(
    () => ["ALL", ...Array.from(new Set(rows.map((r) => r.sector))).sort()],
    [rows]
  );

  // Qualifying counts (Long/Short toggle button labels only) — how many of
  // the full universe currently qualify (any status other than Not Qualified)
  // for that direction. NOT used to reduce the table's row set: every F40
  // stock must remain visible and land in exactly one status bucket for
  // whichever direction is selected, including Not Qualified itself — a
  // stock's absence from this count is exactly what the Not Qualified bucket
  // is for, so the table must never pre-exclude it.
  const longQualifyingCount = useMemo(
    () => rows.filter((r) => getDirectionalEnvStatus(r, "LONG") !== "NOT_QUALIFIED").length,
    [rows]
  );
  const shortQualifyingCount = useMemo(
    () => rows.filter((r) => getDirectionalEnvStatus(r, "SHORT") !== "NOT_QUALIFIED").length,
    [rows]
  );

  // Base pool: always the full universe — Long/Short/All only change which
  // lens computes each row's status (see getEnvStatusForFilter), never which
  // rows are eligible to appear. Search/sector/cap/fund are the only actual
  // row filters here (status filter applied separately below so its own pill
  // counts stay live against the current search/sector/cap/fund state).
  const baseFiltered = useMemo(() => {
    let t: ScannerRow[] = rows;
    if (search)           t = t.filter((r) => r.ticker.toLowerCase().includes(search.toLowerCase()));
    if (sector !== "ALL") t = t.filter((r) => r.sector === sector);
    if (cap    !== "ALL") t = t.filter((r) => r.cap_tier === cap);
    if (fundFilter !== "ALL") t = t.filter((r) => getFundStatus(r) === fundFilter);
    if (dmaOnly) t = t.filter((r) => r.fund_below_200dma === true);
    return t;
  }, [rows, search, sector, cap, fundFilter, dmaOnly]);

  // Counts reflect current search/sector/cap/fund state so pills stay accurate after filtering
  const counts = useMemo(() => {
    return baseFiltered.reduce<Record<string, number>>((acc, r) => {
      const s = getEnvStatusForFilter(r, signalFilter).status;
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
  }, [baseFiltered, signalFilter]);

  const filtered = useMemo(() => {
    let t = baseFiltered;
    if (statusFilter !== "ALL") t = t.filter((r) => getEnvStatusForFilter(r, signalFilter).status === statusFilter);
    return [...t].sort((a, b) => {
      const ra = getEnvStatusForFilter(a, signalFilter), rb = getEnvStatusForFilter(b, signalFilter);
      if (STATUS_ORDER[ra.status] !== STATUS_ORDER[rb.status]) return STATUS_ORDER[ra.status] - STATUS_ORDER[rb.status];
      // Sort by normalized distance (more negative = deeper past the trigger, better)
      const da = ra.direction === "LONG" ? (a.distance_to_lower_envelope_pct ?? 999) : -(a.distance_to_upper_envelope_pct ?? 999);
      const db = rb.direction === "LONG" ? (b.distance_to_lower_envelope_pct ?? 999) : -(b.distance_to_upper_envelope_pct ?? 999);
      return da - db;
    });
  }, [baseFiltered, statusFilter, signalFilter]);

  return (
    <div className="space-y-4">
      {/* Signal type + status pills */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap items-center">
          {/* Signal type toggle */}
          <div className="flex border border-border rounded-md overflow-hidden">
            {(["LONG", "SHORT", "ALL"] as const).map((s) => (
              <Tip
                key={s}
                content={
                  s === "LONG" ? "Show only long (buy) candidates: stocks near the lower envelope band"
                  : s === "SHORT" ? "Show only short signals: stocks near the upper envelope band"
                  : "Show all envelope signals regardless of direction"
                }
                below
              >
                <button
                  onClick={() => setSignalFilter(s)}
                  className={cn(
                    "px-3 py-1 text-xs font-medium transition-colors",
                    signalFilter === s
                      ? s === "LONG"
                        ? "bg-green-500/20 text-green-400"
                        : s === "SHORT"
                        ? "bg-red-500/20 text-red-400"
                        : "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {s === "LONG" ? `▲ Long (${longQualifyingCount})` : s === "SHORT" ? `▼ Short (${shortQualifyingCount})` : "All"}
                </button>
              </Tip>
            ))}
          </div>
          {/* Status pills */}
          {(["ALL", "IN_ZONE", "NEAR", "APPROACHING", "NOT_QUALIFIED"] as const).map((id) => {
            const band = signalFilter === "SHORT" ? "upper (sell)" : "lower (buy)";
            const tipText = id === "ALL" ? "Show all F40 stocks"
              : id === "IN_ZONE" ? `At or past the ${band} envelope trigger — within 2% either side, no cap on how far past`
              : id === "NEAR" ? `Within 2-5% of the ${band} envelope band — getting close`
              : id === "APPROACHING" ? `Within 5-7% of the ${band} envelope band — still some distance to go`
              : `More than 7% from the ${band} envelope band right now`;
            return (
              <Tip key={id} content={tipText} below>
                <button
                  onClick={() => setStatusFilter(id)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                    statusFilter === id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                  )}
                >
                  {id === "ALL" ? "All" : id === "NOT_QUALIFIED" ? "Not Qualified" : STATUS_LABELS[id as EnvStatus]}
                  {id !== "ALL" && counts[id] != null && (
                    <span className="ml-1.5 opacity-70">{counts[id]}</span>
                  )}
                </button>
              </Tip>
            );
          })}
        </div>
        {runDate && <span className="text-xs text-muted-foreground">Scanned: {runDate}</span>}
      </div>

      {/* Filters */}
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
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} stocks · ±{envelopePct}% envelope</span>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Ticker</TableHead>
              <TableHead><Tip content="How close this stock is to the envelope buy zone" below><span className="cursor-default">Status</span></Tip></TableHead>
              <TableHead>Sector</TableHead>
              <TableHead>Cap</TableHead>
              <TableHead className="text-right">Close ₹</TableHead>
              <TableHead className="text-right"><Tip content="200-day simple moving average — the centre line of the envelope band" below><span className="cursor-default">200 SMA ₹</span></Tip></TableHead>
              <TableHead className="text-right">
                <Tip content={`Lower envelope band: ${envelopePct}% below the 200 SMA — the strategy's buy trigger level`} below>
                  <span className="cursor-default">Lower Env<br /><span className="text-[10px] font-normal text-muted-foreground">−{envelopePct}%</span></span>
                </Tip>
              </TableHead>
              <TableHead className="text-right min-w-[110px]"><Tip content="How far above the lower envelope the current price is. 0% or negative = in buy zone" below><span className="cursor-default">Dist to Lower</span></Tip></TableHead>
              <TableHead className="text-right">
                <Tip content={`Upper envelope band: ${envelopePct}% above the 200 SMA — the strategy's sell target`} below>
                  <span className="cursor-default">Upper Env<br /><span className="text-[10px] font-normal text-muted-foreground">+{envelopePct}%</span></span>
                </Tip>
              </TableHead>
              <TableHead className="text-right">
                <Tip content="Potential upside from current price to the upper envelope (expected profit if bought now)" below>
                  <span className="cursor-default">Pot. Gain<br /><span className="text-[10px] font-normal text-muted-foreground">to Upper</span></span>
                </Tip>
              </TableHead>
              <TableHead className="text-right">
                <Tip content="ABCD Averaging tranche A: if bought at the lower envelope and the stock falls further, this is the 2nd buy level — 10% below the initial entry (50% of the tranche allocation)" below>
                  ABCD-A<br /><span className="text-[10px] text-muted-foreground font-normal">−10%</span>
                </Tip>
              </TableHead>
              <TableHead className="text-right">
                <Tip content="ABCD tranche B: 3rd averaging level — 19% below the initial entry (33% of the tranche allocation)" below>
                  ABCD-B<br /><span className="text-[10px] text-muted-foreground font-normal">−19%</span>
                </Tip>
              </TableHead>
              <TableHead className="text-right">
                <Tip content="ABCD tranche C: 4th (deepest) averaging level — 27.1% below the initial entry (25% of the tranche allocation)" below>
                  ABCD-C<br /><span className="text-[10px] text-muted-foreground font-normal">−27.1%</span>
                </Tip>
              </TableHead>
              <TableHead className="text-right"><Tip content="Current Price-to-Earnings ratio" below><span className="cursor-default">PE</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="5-year average PE — compare with current to judge if the stock is historically cheap" below><span className="cursor-default">5yr PE</span></Tip></TableHead>
              <TableHead><Tip content="Whether the stock passes the fundamental quality screen (ROCE, ROE, D/E, OPM, PE checks)" below><span className="cursor-default">Fundamentals</span></Tip></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row) => {
              const status = getEnvStatusForFilter(row, signalFilter).status;
              const distLower = row.distance_to_lower_envelope_pct;
              const distUpper = row.distance_to_upper_envelope_pct;
              const fundBadge = getFundBadge(row);
              const barPct = distLower != null ? Math.min(Math.max((distLower + 5) / 20, 0), 1) * 100 : 0;
              // ABCD tranches: 10%/19%/27.1% below the initial entry (lower envelope),
              // matching f40_backtest_envelope.py's real backtested multipliers
              // (0.90 / 0.81 / 0.729 compounding 10% steps) — not a fabricated level.
              const entry = row.lower_envelope;
              const abcdA = entry != null ? entry * 0.90 : null;
              const abcdB = entry != null ? entry * 0.81 : null;
              const abcdC = entry != null ? entry * 0.729 : null;
              const isNotQualified = status === "NOT_QUALIFIED";
              const isExpanded = expandedTicker === row.ticker;

              return (
                <Fragment key={row.ticker}>
                  <TableRow className={cn("hover:bg-muted/30", isNotQualified && "opacity-50")}>
                    <TableCell className={cn("font-mono font-semibold", isNotQualified ? "text-muted-foreground" : "text-primary")}>{row.ticker}</TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs border", STATUS_COLORS[status])}>
                        {STATUS_LABELS[status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">{row.sector}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{row.cap_tier?.replace(" Cap", "")}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCur(row.close)}</TableCell>
                    <TableCell className="text-right tabular-nums text-amber-400 text-xs">{fmtCur(row.ma)}</TableCell>
                    <TableCell className="text-right tabular-nums text-orange-400 text-xs">{fmtCur(row.lower_envelope)}</TableCell>
                    {/* Distance to lower envelope with visual bar */}
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={cn(
                          "tabular-nums text-xs font-medium",
                          distLower == null ? "text-muted-foreground"
                          : distLower <= 0 ? "text-green-400"
                          : distLower <= 5 ? "text-amber-400"
                          : "text-muted-foreground"
                        )}>
                          {distLower != null
                            ? distLower <= 0
                              ? `${distLower.toFixed(1)}% ↓`
                              : `+${distLower.toFixed(1)}%`
                            : "—"}
                        </span>
                        {distLower != null && (
                          <div className="w-20 h-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className={cn("h-full rounded-full transition-all",
                                distLower <= 0 ? "bg-green-400" : distLower <= 5 ? "bg-amber-400" : "bg-blue-400"
                              )}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-purple-400 text-xs">{fmtCur(row.upper_envelope)}</TableCell>
                    <TableCell className="text-right tabular-nums text-green-400 font-medium text-xs">
                      {distUpper != null ? `+${Math.abs(distUpper).toFixed(1)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{abcdA != null ? fmtCur(abcdA) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{abcdB != null ? fmtCur(abcdB) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{abcdC != null ? fmtCur(abcdC) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {row.pe_current != null ? fmtNum(row.pe_current) + "x" : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {row.pe_5yr_avg != null ? fmtNum(row.pe_5yr_avg) + "x" : "—"}
                    </TableCell>
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
                      <TableCell colSpan={17} className="p-0">
                        <FundDetails row={row} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
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

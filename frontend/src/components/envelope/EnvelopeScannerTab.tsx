"use client";
import { useState, useMemo } from "react";
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

// Status based on distance to lower envelope (for LONG candidates)
type EnvStatus = "IN_ZONE" | "APPROACHING" | "WATCHING" | "NOT_QUALIFIED";

const STATUS_COLORS: Record<EnvStatus, string> = {
  IN_ZONE:       "bg-green-500/20 text-green-400 border-green-500/30",
  APPROACHING:   "bg-amber-500/20 text-amber-400 border-amber-500/30",
  WATCHING:      "bg-muted text-muted-foreground border-border",
  NOT_QUALIFIED: "bg-muted/50 text-muted-foreground/60 border-border/50",
};
const STATUS_LABELS: Record<EnvStatus, string> = {
  IN_ZONE:       "In Zone",
  APPROACHING:   "Approaching",
  WATCHING:      "Watching",
  NOT_QUALIFIED: "No Signal",
};
const STATUS_ORDER: Record<EnvStatus, number> = { IN_ZONE: 0, APPROACHING: 1, WATCHING: 2, NOT_QUALIFIED: 3 };

function getEnvStatus(row: ScannerRow): EnvStatus {
  // Stocks without any envelope signal go to Not Qualified bucket
  if (!row.signals?.some((s) => s.startsWith("ENVELOPE_"))) return "NOT_QUALIFIED";
  const dist = row.distance_to_lower_envelope_pct;
  if (dist == null) return "WATCHING";
  if (dist <= 2) return "IN_ZONE";       // at or below lower env (within 2% proximity band)
  if (dist <= 12) return "APPROACHING";
  return "WATCHING";
}

function getFundBadge(row: ScannerRow) {
  if (row.fund_all_pass) return { label: "All Pass", cls: "bg-green-500/20 text-green-400 border-green-500/30" };
  const fails = [];
  if (row.fund_pe_pass === false) fails.push("PE");
  if (row.fund_s3_s5_pass === false) fails.push("Phase2");
  if (row.fund_below_200dma === false) fails.push("200DMA");
  if (fails.length === 0) return { label: "—", cls: "bg-muted text-muted-foreground border-border" };
  return { label: `Fail: ${fails.join(", ")}`, cls: "bg-red-500/20 text-red-400 border-red-500/30" };
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
  const [fundOnly, setFundOnly] = useState(false);

  const sectors = useMemo(
    () => ["ALL", ...Array.from(new Set(rows.map((r) => r.sector))).sort()],
    [rows]
  );

  const longRows = useMemo(
    () => rows.filter((r) => r.signals?.includes("ENVELOPE_LONG_CANDIDATE")),
    [rows]
  );
  const shortRows = useMemo(
    () => rows.filter((r) => r.signals?.includes("ENVELOPE_SHORT_CANDIDATE")),
    [rows]
  );

  const counts = useMemo(() => {
    // For counts: LONG/SHORT pools only show their respective signal rows; ALL shows everything
    const base =
      signalFilter === "SHORT" ? shortRows :
      signalFilter === "LONG"  ? longRows  :
      rows;
    return base.reduce<Record<string, number>>((acc, r) => {
      const s = getEnvStatus(r);
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
  }, [rows, longRows, shortRows, signalFilter]);

  const filtered = useMemo(() => {
    // Base pool: LONG/SHORT filter to signal rows; ALL includes the full watchlist
    let t: ScannerRow[];
    if (signalFilter === "LONG") t = longRows;
    else if (signalFilter === "SHORT") t = shortRows;
    else t = rows; // ALL — show every F40 stock including those without envelope signals

    if (statusFilter !== "ALL") t = t.filter((r) => getEnvStatus(r) === statusFilter);
    if (search) t = t.filter((r) => r.ticker.toLowerCase().includes(search.toLowerCase()));
    if (sector !== "ALL") t = t.filter((r) => r.sector === sector);
    if (cap !== "ALL") t = t.filter((r) => r.cap_tier === cap);
    if (fundOnly) t = t.filter((r) => r.fund_all_pass);

    return [...t].sort((a, b) => {
      const sa = getEnvStatus(a), sb = getEnvStatus(b);
      if (STATUS_ORDER[sa] !== STATUS_ORDER[sb]) return STATUS_ORDER[sa] - STATUS_ORDER[sb];
      const da = a.distance_to_lower_envelope_pct ?? 999;
      const db = b.distance_to_lower_envelope_pct ?? 999;
      return da - db;
    });
  }, [rows, longRows, shortRows, signalFilter, statusFilter, search, sector, cap, fundOnly]);

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
                  {s === "LONG" ? `▲ Long (${longRows.length})` : s === "SHORT" ? `▼ Short (${shortRows.length})` : "All"}
                </button>
              </Tip>
            ))}
          </div>
          {/* Status pills */}
          {(["ALL", "IN_ZONE", "APPROACHING", "WATCHING", "NOT_QUALIFIED"] as const).map((id) => {
            const tipText = id === "ALL" ? "Show all F40 stocks"
              : id === "IN_ZONE" ? "Price is within the entry band of the lower envelope — active buy zone"
              : id === "APPROACHING" ? "Price is heading toward the lower envelope but not in the buy zone yet"
              : id === "WATCHING" ? "Price is below the 200 SMA — monitoring but no buy signal yet"
              : "Stock does not meet the envelope strategy conditions right now";
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
        <Tip content="Filter to only show stocks that pass the fundamental quality checks (PE, ROCE, D/E, OPM)" below>
          <button
            onClick={() => setFundOnly((v) => !v)}
            className={cn(
              "px-3 py-1 rounded text-xs font-medium border transition-colors",
              fundOnly
                ? "bg-green-500/20 text-green-400 border-green-500/30"
                : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
            )}
          >
            Fund Pass Only
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
              <TableHead className="text-right"><Tip content="Current Price-to-Earnings ratio" below><span className="cursor-default">PE</span></Tip></TableHead>
              <TableHead className="text-right"><Tip content="5-year average PE — compare with current to judge if the stock is historically cheap" below><span className="cursor-default">5yr PE</span></Tip></TableHead>
              <TableHead><Tip content="Whether the stock passes the fundamental quality screen (ROCE, ROE, D/E, OPM, PE checks)" below><span className="cursor-default">Fundamentals</span></Tip></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row) => {
              const status = getEnvStatus(row);
              const distLower = row.distance_to_lower_envelope_pct;
              const distUpper = row.distance_to_upper_envelope_pct;
              const fundBadge = getFundBadge(row);
              // Progress bar: capped at ±20% range (left=below, right=above lower env)
              const barPct = distLower != null ? Math.min(Math.max((distLower + 5) / 20, 0), 1) * 100 : 0;

              const isNotQualified = status === "NOT_QUALIFIED";
              return (
                <TableRow key={row.ticker} className={cn("hover:bg-muted/30", isNotQualified && "opacity-50")}>
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
                  <TableCell className="text-right tabular-nums text-xs">
                    {row.pe_current != null ? fmtNum(row.pe_current) + "x" : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {row.pe_5yr_avg != null ? fmtNum(row.pe_5yr_avg) + "x" : "—"}
                  </TableCell>
                  <TableCell>
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] border", fundBadge.cls)}>
                      {fundBadge.label}
                    </span>
                  </TableCell>
                </TableRow>
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

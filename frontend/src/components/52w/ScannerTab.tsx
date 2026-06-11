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
import { type ScannerRow, getProximityStatus, PROXIMITY_LABELS, type ProximityStatus } from "@/lib/types";
import { fmtCur, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<ProximityStatus, string> = {
  IN_ZONE: "bg-green-500/20 text-green-400 border-green-500/30",
  APPROACHING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  NEAR: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  BEYOND: "bg-muted text-muted-foreground border-border",
};

const STATUS_ORDER: Record<ProximityStatus, number> = {
  IN_ZONE: 0, APPROACHING: 1, NEAR: 2, BEYOND: 3,
};

type SortOption = "zone" | "closest_low" | "closest_high" | "highest_gain" | "ticker_az";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "zone", label: "By Zone" },
  { value: "closest_low", label: "Closest to 52W Low" },
  { value: "closest_high", label: "Closest to 52W High" },
  { value: "highest_gain", label: "Highest Potential Gain" },
  { value: "ticker_az", label: "Ticker A–Z" },
];

// ABCD averaging levels below 52W low
const ABCD_LEVELS = { A: -0.10, B: -0.19, C: -0.27, D: -0.34 };

interface ScannerTabProps {
  rows: ScannerRow[];
  runDate?: string;
}

export function ScannerTab({ rows, runDate }: ScannerTabProps) {
  const [filter, setFilter] = useState<ProximityStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("ALL");
  const [cap, setCap] = useState("ALL");
  const [sortOption, setSortOption] = useState<SortOption>("zone");

  const sectors = useMemo(
    () => ["ALL", ...Array.from(new Set(rows.map((r) => r.sector))).sort()],
    [rows]
  );

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    const s = getProximityStatus(r);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  const filtered = useMemo(() => {
    let t = rows;
    if (filter !== "ALL") t = t.filter((r) => getProximityStatus(r) === filter);
    if (search) t = t.filter((r) => r.ticker.toLowerCase().includes(search.toLowerCase()));
    if (sector !== "ALL") t = t.filter((r) => r.sector === sector);
    if (cap !== "ALL") t = t.filter((r) => r.cap_tier === cap);
    return t;
  }, [rows, filter, search, sector, cap]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortOption === "zone") {
        const sa = getProximityStatus(a), sb = getProximityStatus(b);
        if (STATUS_ORDER[sa] !== STATUS_ORDER[sb]) return STATUS_ORDER[sa] - STATUS_ORDER[sb];
        return (a.distance_to_52w_low_pct ?? 999) - (b.distance_to_52w_low_pct ?? 999);
      }
      if (sortOption === "closest_low")
        return (a.distance_to_52w_low_pct ?? 999) - (b.distance_to_52w_low_pct ?? 999);
      if (sortOption === "closest_high")
        return (a.distance_to_52w_high_pct ?? 999) - (b.distance_to_52w_high_pct ?? 999);
      if (sortOption === "highest_gain")
        return (b.distance_to_52w_high_pct ?? 0) - (a.distance_to_52w_high_pct ?? 0);
      if (sortOption === "ticker_az") return a.ticker.localeCompare(b.ticker);
      return 0;
    });
  }, [filtered, sortOption]);

  return (
    <div className="space-y-4">
      {/* Status pills */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
          {(["ALL", "IN_ZONE", "APPROACHING", "NEAR", "BEYOND"] as const).map((id) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                filter === id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
              )}
            >
              {id === "ALL" ? "All" : PROXIMITY_LABELS[id]}
              {id !== "ALL" && counts[id] != null && (
                <span className="ml-1.5 opacity-70">{counts[id]}</span>
              )}
            </button>
          ))}
        </div>
        {runDate && (
          <span className="text-xs text-muted-foreground">Scanned: {runDate}</span>
        )}
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
        <Select value={sortOption} onValueChange={(v) => setSortOption((v ?? "zone") as SortOption)}>
          <SelectTrigger className="h-7 w-52 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{sorted.length} stocks</span>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Ticker</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sector</TableHead>
              <TableHead>Cap</TableHead>
              <TableHead className="text-right">Close</TableHead>
              <TableHead className="text-right">52W Low</TableHead>
              <TableHead className="text-right min-w-[100px]">Dist to Low</TableHead>
              <TableHead className="text-right">52W High</TableHead>
              <TableHead className="text-right">Pot. Gain</TableHead>
              <TableHead className="text-right">200 DMA</TableHead>
              <TableHead className="text-right">ABCD-A<br /><span className="text-[10px] text-muted-foreground font-normal">−10%</span></TableHead>
              <TableHead className="text-right">ABCD-B<br /><span className="text-[10px] text-muted-foreground font-normal">−19%</span></TableHead>
              <TableHead className="text-right">ABCD-C<br /><span className="text-[10px] text-muted-foreground font-normal">−27%</span></TableHead>
              <TableHead className="text-right">ABCD-D<br /><span className="text-[10px] text-muted-foreground font-normal">−34%</span></TableHead>
              <TableHead className="text-right">PE</TableHead>
              <TableHead className="text-right">5Yr PE</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => {
              const status = getProximityStatus(row);
              const low = row["52w_low"];
              const abcdA = low != null ? low * (1 + ABCD_LEVELS.A) : null;
              const abcdB = low != null ? low * (1 + ABCD_LEVELS.B) : null;
              const abcdC = low != null ? low * (1 + ABCD_LEVELS.C) : null;
              const abcdD = low != null ? low * (1 + ABCD_LEVELS.D) : null;
              const distPct = row.distance_to_52w_low_pct;
              const barWidth = distPct != null ? Math.min(distPct / 40, 1) * 100 : 0;

              return (
                <TableRow key={row.ticker} className="hover:bg-muted/30">
                  <TableCell className="font-mono font-semibold text-primary">{row.ticker}</TableCell>
                  <TableCell>
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs border", STATUS_COLORS[status])}>
                      {PROXIMITY_LABELS[status]}
                    </span>
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
                            className={cn("h-full rounded-full", status === "IN_ZONE" ? "bg-green-400" : status === "APPROACHING" ? "bg-amber-400" : "bg-blue-400")}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-purple-400">{fmtCur(row["52w_high"])}</TableCell>
                  <TableCell className="text-right tabular-nums text-green-400 font-medium text-xs">
                    {row.distance_to_52w_high_pct != null ? `+${row.distance_to_52w_high_pct.toFixed(1)}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-amber-400 text-xs">{fmtCur(row.ma)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{abcdA != null ? fmtCur(abcdA) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{abcdB != null ? fmtCur(abcdB) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{abcdC != null ? fmtCur(abcdC) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{abcdD != null ? fmtCur(abcdD) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.pe_current != null ? fmtNum(row.pe_current) + "x" : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{row.pe_5yr_avg != null ? fmtNum(row.pe_5yr_avg) + "x" : "—"}</TableCell>
                </TableRow>
              );
            })}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={16} className="text-center text-muted-foreground py-8">
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

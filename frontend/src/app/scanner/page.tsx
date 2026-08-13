"use client";
import { useState, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tip } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { getProximityStatus, PROXIMITY_LABELS, type ScannerRow, type S200Rally, type RHSOpportunity, type SROpportunity, type FundamentalFields } from "@/lib/types";
import { StaleBanner } from "@/components/shared/StaleBanner";
import { cn } from "@/lib/utils";
import { getFundStatus, type FundStatus } from "@/lib/fundBadge";

// ── Unified signal shape ──────────────────────────────────────────────────────

interface UnifiedSignal {
  ticker: string;
  strategy: "52W" | "S200" | "Envelope" | "RHS" | "S/R";
  statusKey: string;
  statusLabel: string;
  statusPriority: number;
  sector: string;
  cap_tier: string;
  keyMetric: string;
  keyValue: number;        // for sorting
  subMetric?: string;
  action_href: string;
  current_price: number;
  entry_price: number | null;   // buy/support/neckline/lower-envelope level, per strategy
  target_price: number | null;  // sell target/resistance/upper-envelope, per strategy
  fund_all_pass?: boolean;
  fund_below_200dma?: boolean;
  // Carried through so getFundStatus() can compute the same Pass/Fail/No Data
  // bucket here as every individual strategy tab — see fundBadge.ts.
  fund_roce?: number | null;
  fund_roe?: number | null;
  fund_net_de?: number | null;
  fund_ttm_np_cr?: number | null;
  fund_sales_vs_ath_pct?: number | null;
  fund_profit_vs_ath_pct?: number | null;
}

const S200_PRIORITY: Record<string, number> = {
  IN_ZONE: 0, APPROACHING: 1, WATCHING_NEAR: 2, WATCHING: 3, BELOW_BUY: 4,
};
const S200_LABELS: Record<string, string> = {
  IN_ZONE: "In Zone", APPROACHING: "Approaching", WATCHING_NEAR: "Watching Near",
  WATCHING: "Watching", BELOW_BUY: "Below Buy",
};
const PROX_PRIORITY: Record<string, number> = {
  IN_ZONE: 0, APPROACHING: 1, NEAR: 2, BEYOND: 3,
};
const ENV_STATUS_PRIORITY: Record<string, number> = {
  IN_ZONE: 0, APPROACHING: 1, WATCHING: 2, NOT_QUALIFIED: 3,
};
const ENV_STATUS_LABELS: Record<string, string> = {
  IN_ZONE: "In Zone", APPROACHING: "Approaching", WATCHING: "Watching", NOT_QUALIFIED: "No Signal",
};
const RHS_STATUS_PRIORITY: Record<string, number> = { BREAKOUT: 0, FORMING: 2 };
const RHS_STATUS_LABELS: Record<string, string> = { BREAKOUT: "Breakout", FORMING: "Forming" };
const SR_STATUS_PRIORITY: Record<string, number> = { IN_ZONE: 0, WATCHING: 1, ABOVE_DMA: 2 };
const SR_STATUS_LABELS: Record<string, string> = { IN_ZONE: "At Support", WATCHING: "Watching", ABOVE_DMA: "Above 200 DMA" };

// Shared fundamental fields every toUnified* mapper carries through, so
// getFundStatus() can compute the same Pass/Fail/No Data bucket here as each
// individual strategy tab.
function fundFieldsOf(row: FundamentalFields) {
  return {
    fund_all_pass: row.fund_all_pass,
    fund_below_200dma: row.fund_below_200dma,
    fund_roce: row.fund_roce,
    fund_roe: row.fund_roe,
    fund_net_de: row.fund_net_de,
    fund_ttm_np_cr: row.fund_ttm_np_cr,
    fund_sales_vs_ath_pct: row.fund_sales_vs_ath_pct,
    fund_profit_vs_ath_pct: row.fund_profit_vs_ath_pct,
  };
}

function toUnifiedF40(row: ScannerRow): UnifiedSignal {
  const prox = getProximityStatus(row);
  const dist = row.distance_to_52w_low_pct ?? 0;
  return {
    ticker: row.ticker,
    strategy: "52W",
    statusKey: prox,
    statusLabel: PROXIMITY_LABELS[prox],
    statusPriority: PROX_PRIORITY[prox] ?? 9,
    sector: row.sector,
    cap_tier: row.cap_tier,
    keyMetric: `${dist >= 0 ? "+" : ""}${dist.toFixed(1)}% to Low`,
    keyValue: dist,
    action_href: "/52w",
    current_price: row.close,
    entry_price: row["52w_low"],
    target_price: row["52w_high"],
    ...fundFieldsOf(row),
  };
}

function toUnifiedS200(rally: S200Rally): UnifiedSignal {
  const pct = rally.dist_to_buy_zone_pct ?? 0;
  return {
    ticker: rally.ticker,
    strategy: "S200",
    statusKey: rally.status,
    statusLabel: S200_LABELS[rally.status] ?? rally.status,
    statusPriority: S200_PRIORITY[rally.status] ?? 9,
    sector: rally.sector,
    cap_tier: rally.cap_tier,
    keyMetric: `+${rally.rally_pct.toFixed(1)}% Rally`,
    keyValue: rally.rally_pct,
    subMetric: pct <= 0 ? `${pct.toFixed(1)}% in zone` : `${pct.toFixed(1)}% to zone`,
    action_href: "/s200",
    current_price: rally.current_price,
    entry_price: rally.buy_price,
    target_price: rally.sell_price,
    ...fundFieldsOf(rally),
  };
}

function toUnifiedEnvelope(row: ScannerRow): UnifiedSignal | null {
  if (!row.signals?.includes("ENVELOPE_LONG_CANDIDATE")) return null;
  const dist = row.distance_to_lower_envelope_pct;
  let statusKey: string;
  if (dist == null) statusKey = "WATCHING";
  else if (dist <= 2) statusKey = "IN_ZONE";
  else if (dist <= 12) statusKey = "APPROACHING";
  else statusKey = "WATCHING";
  return {
    ticker: row.ticker,
    strategy: "Envelope",
    statusKey,
    statusLabel: ENV_STATUS_LABELS[statusKey] ?? statusKey,
    statusPriority: ENV_STATUS_PRIORITY[statusKey] ?? 9,
    sector: row.sector,
    cap_tier: row.cap_tier,
    keyMetric: dist != null ? (dist <= 0 ? `${dist.toFixed(1)}% in zone` : `+${dist.toFixed(1)}% to Lower Env`) : "At Envelope",
    keyValue: dist ?? 999,
    action_href: "/envelope",
    current_price: row.close,
    entry_price: row.lower_envelope ?? null,
    target_price: row.upper_envelope ?? null,
    ...fundFieldsOf(row),
  };
}

function toUnifiedRHS(opp: RHSOpportunity): UnifiedSignal {
  const upside = (opp.target - opp.current_price) / opp.current_price * 100;
  return {
    ticker: opp.ticker,
    strategy: "RHS",
    statusKey: opp.status,
    statusLabel: RHS_STATUS_LABELS[opp.status] ?? opp.status,
    statusPriority: RHS_STATUS_PRIORITY[opp.status] ?? 9,
    sector: opp.sector,
    cap_tier: opp.cap_tier,
    keyMetric: `+${upside.toFixed(1)}% Upside`,
    keyValue: upside,
    subMetric: opp.pattern_type,
    action_href: "/rhs",
    current_price: opp.current_price,
    entry_price: opp.neckline,
    target_price: opp.target,
    ...fundFieldsOf(opp),
  };
}

function toUnifiedSR(opp: SROpportunity): UnifiedSignal {
  return {
    ticker: opp.ticker,
    strategy: "S/R",
    statusKey: opp.status,
    statusLabel: SR_STATUS_LABELS[opp.status] ?? opp.status,
    statusPriority: SR_STATUS_PRIORITY[opp.status] ?? 9,
    sector: opp.sector,
    cap_tier: opp.cap_tier,
    keyMetric: opp.remaining_gain_pct != null ? `+${opp.remaining_gain_pct.toFixed(1)}% to Resistance` : `${opp.dist_to_support_pct.toFixed(1)}% to Support`,
    keyValue: opp.remaining_gain_pct ?? opp.dist_to_support_pct,
    subMetric: `${opp.touch_count} touches`,
    action_href: "/sr",
    current_price: opp.current_price,
    entry_price: opp.support_level,
    target_price: opp.resistance_level,
    ...fundFieldsOf(opp),
  };
}

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ statusKey, label }: { statusKey: string; label: string }) {
  const cls = {
    IN_ZONE:       "bg-green-500/15 text-green-400 border-green-500/30",
    APPROACHING:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
    WATCHING_NEAR: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    NEAR:          "bg-blue-500/15 text-blue-400 border-blue-500/30",
    WATCHING:      "bg-muted/40 text-muted-foreground border-border",
    BEYOND:        "bg-muted/20 text-muted-foreground/60 border-border",
    BELOW_BUY:     "bg-red-500/10 text-red-400/80 border-red-500/20",
    ABOVE_DMA:     "bg-muted/20 text-muted-foreground/60 border-border",
  }[statusKey] ?? "bg-muted/20 text-muted-foreground border-border";

  return (
    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap", cls)}>
      {label}
    </span>
  );
}

// ── Signal table ──────────────────────────────────────────────────────────────

function SignalTable({ signals }: { signals: UnifiedSignal[] }) {
  const [sortCol, setSortCol] = useState<"status" | "ticker" | "metric">("status");
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = useMemo(() => {
    return [...signals].sort((a, b) => {
      let cmp = 0;
      if (sortCol === "status") cmp = a.statusPriority - b.statusPriority || a.ticker.localeCompare(b.ticker);
      else if (sortCol === "ticker") cmp = a.ticker.localeCompare(b.ticker);
      else if (sortCol === "metric") cmp = a.keyValue - b.keyValue;
      return sortAsc ? cmp : -cmp;
    });
  }, [signals, sortCol, sortAsc]);

  function toggle(col: "status" | "ticker" | "metric") {
    if (sortCol === col) setSortAsc((v) => !v);
    else { setSortCol(col); setSortAsc(true); }
  }

  function sortableTh(col: "status" | "ticker" | "metric", children: ReactNode) {
    return (
      <th
        onClick={() => toggle(col)}
        className="pb-2 pr-4 text-left text-muted-foreground font-medium cursor-pointer hover:text-foreground select-none whitespace-nowrap"
      >
        {children}
        {sortCol === col && <span className="ml-1 text-primary">{sortAsc ? "↑" : "↓"}</span>}
      </th>
    );
  }

  if (signals.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No signals match the current filters.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-border text-xs">
            {sortableTh("ticker", "Ticker")}
            <th className="pb-2 pr-4 text-left text-muted-foreground font-medium whitespace-nowrap">
              <Tip content="Which strategy flagged this stock: 52W = 52-week Low/High, S200 = 20% Rally" below>
                <span className="cursor-default">Strategy</span>
              </Tip>
            </th>
            {sortableTh("status", (
              <Tip content="How close the stock is to the strategy's buy zone right now" below>
                <span className="cursor-default">Status</span>
              </Tip>
            ))}
            <th className="pb-2 pr-4 text-left text-muted-foreground font-medium">Sector</th>
            <th className="pb-2 pr-4 text-left text-muted-foreground font-medium">Cap</th>
            {sortableTh("metric", (
              <Tip content="The most relevant number for this signal (distance to low for 52W, remaining gain for S200)" below>
                <span className="cursor-default">Key Metric</span>
              </Tip>
            ))}
            <th className="pb-2 pr-4 text-right text-muted-foreground font-medium whitespace-nowrap">Price</th>
            <th className="pb-2 pr-4 text-right text-muted-foreground font-medium whitespace-nowrap">
              <Tip content="Buy/support/neckline/lower-envelope level, depending on the strategy" below>
                <span className="cursor-default">Entry</span>
              </Tip>
            </th>
            <th className="pb-2 pr-4 text-right text-muted-foreground font-medium whitespace-nowrap">
              <Tip content="Sell target/resistance/upper-envelope level, depending on the strategy" below>
                <span className="cursor-default">Target</span>
              </Tip>
            </th>
            <th className="pb-2 pr-4 text-center text-muted-foreground font-medium whitespace-nowrap">
              <Tip content="Whether this stock passes every Must-Have fundamental gate (ROCE/ROE, Net D/E, PE, pledge, public shareholding, sales/profit ATH, OPM trend)" below>
                <span className="cursor-default">Fund</span>
              </Tip>
            </th>
            <th className="pb-2 text-right text-muted-foreground font-medium">
              <Tip content="Click to open the full analysis for this stock in its strategy tab" below>
                <span className="cursor-default">Go To</span>
              </Tip>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s, i) => (
            <tr key={`${s.strategy}-${s.ticker}-${i}`} className="border-b border-border/40 hover:bg-muted/10 transition-colors">
              <td className="py-2 pr-4 font-medium tabular-nums">{s.ticker}</td>
              <td className="py-2 pr-4">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] px-1.5 py-0.5",
                    s.strategy === "52W"      ? "border-primary/40 text-primary"
                    : s.strategy === "S200"   ? "border-violet-500/40 text-violet-400"
                    : s.strategy === "Envelope" ? "border-orange-500/40 text-orange-400"
                    : s.strategy === "RHS"    ? "border-green-500/40 text-green-400"
                    : "border-cyan-500/40 text-cyan-400"
                  )}
                >
                  {s.strategy}
                </Badge>
              </td>
              <td className="py-2 pr-4">
                <StatusPill statusKey={s.statusKey} label={s.statusLabel} />
              </td>
              <td className="py-2 pr-4 text-muted-foreground text-xs">{s.sector}</td>
              <td className="py-2 pr-4 text-muted-foreground text-xs whitespace-nowrap">{s.cap_tier}</td>
              <td className="py-2 pr-4 tabular-nums text-xs">
                <span>{s.keyMetric}</span>
                {s.subMetric && (
                  <span className="ml-1.5 text-muted-foreground/60">{s.subMetric}</span>
                )}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-xs">₹{s.current_price.toLocaleString("en-IN")}</td>
              <td className="py-2 pr-4 text-right tabular-nums text-xs text-amber-400">
                {s.entry_price != null ? `₹${s.entry_price.toLocaleString("en-IN")}` : "—"}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-xs text-green-400">
                {s.target_price != null ? `₹${s.target_price.toLocaleString("en-IN")}` : "—"}
              </td>
              <td className="py-2 pr-4 text-center">
                {s.fund_all_pass === true ? (
                  <span className="text-green-400" title="Passes every Must-Have fundamental gate">✓</span>
                ) : s.fund_all_pass === false ? (
                  <span className="text-red-400" title="Fails one or more Must-Have fundamental gates">✗</span>
                ) : (
                  <span className="text-muted-foreground/40">—</span>
                )}
              </td>
              <td className="py-2 text-right">
                <Link
                  href={s.action_href}
                  className="text-xs text-primary hover:underline whitespace-nowrap"
                >
                  {s.strategy} →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function filterSignals(
  signals: UnifiedSignal[],
  search: string,
  sector: string,
  cap: string,
  status: string,
  fund: string,
  dmaOnly: boolean,
): UnifiedSignal[] {
  return signals.filter((s) => {
    if (search && !s.ticker.toLowerCase().includes(search.toLowerCase()) &&
        !s.sector.toLowerCase().includes(search.toLowerCase())) return false;
    if (sector !== "all" && s.sector !== sector) return false;
    if (cap !== "all" && s.cap_tier !== cap) return false;
    if (status !== "all" && s.statusKey !== status) return false;
    if (fund !== "all" && getFundStatus(s) !== fund) return false;
    if (dmaOnly && s.fund_below_200dma !== true) return false;
    return true;
  });
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ScannerPage() {
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("all");
  const [cap, setCap] = useState("all");
  const [status, setStatus] = useState("all");
  const [fund, setFund] = useState<FundStatus | "all">("all");
  const [dmaOnly, setDmaOnly] = useState(false);

  const { data: f40Data, isLoading: f40Loading } = useQuery({
    queryKey: ["scanner-f40"],
    queryFn: api.scanner.f40,
    staleTime: 60 * 60 * 1000,
  });

  const { data: s200Data, isLoading: s200Loading } = useQuery({
    queryKey: ["scanner-s200"],
    queryFn: api.scanner.s200,
    staleTime: 60 * 60 * 1000,
  });

  const { data: rhsData, isLoading: rhsLoading } = useQuery({
    queryKey: ["rhs-scanner"],
    queryFn: api.rhs.scanner,
    staleTime: 60 * 60 * 1000,
  });

  const { data: srData, isLoading: srLoading } = useQuery({
    queryKey: ["sr-scanner"],
    queryFn: api.sr.scanner,
    staleTime: 60 * 60 * 1000,
  });

  const loading = f40Loading || s200Loading || rhsLoading || srLoading;

  const allSignals: UnifiedSignal[] = useMemo(() => {
    const f40 = (f40Data ?? []).map(toUnifiedF40);
    const s200 = (s200Data?.rallies ?? []).map(toUnifiedS200);
    const env = (f40Data ?? []).map(toUnifiedEnvelope).filter((s): s is UnifiedSignal => s !== null);
    const rhs = (rhsData?.opportunities ?? []).map(toUnifiedRHS);
    const sr = (srData?.opportunities ?? []).map(toUnifiedSR);
    return [...f40, ...s200, ...env, ...rhs, ...sr].sort((a, b) => a.statusPriority - b.statusPriority || a.ticker.localeCompare(b.ticker));
  }, [f40Data, s200Data, rhsData, srData]);

  const f40Signals      = useMemo(() => allSignals.filter((s) => s.strategy === "52W"),      [allSignals]);
  const s200Signals     = useMemo(() => allSignals.filter((s) => s.strategy === "S200"),     [allSignals]);
  const envSignals      = useMemo(() => allSignals.filter((s) => s.strategy === "Envelope"), [allSignals]);
  const rhsSignals      = useMemo(() => allSignals.filter((s) => s.strategy === "RHS"),      [allSignals]);
  const srSignals       = useMemo(() => allSignals.filter((s) => s.strategy === "S/R"),      [allSignals]);

  const sectors = useMemo(() => {
    const set = new Set(allSignals.map((s) => s.sector));
    return Array.from(set).sort();
  }, [allSignals]);

  const caps = useMemo(() => {
    const set = new Set(allSignals.map((s) => s.cap_tier));
    return Array.from(set).sort();
  }, [allSignals]);

  const statuses = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of allSignals) seen.set(s.statusKey, s.statusLabel);
    return Array.from(seen.entries()).sort((a, b) => (S200_PRIORITY[a[0]] ?? PROX_PRIORITY[a[0]] ?? ENV_STATUS_PRIORITY[a[0]] ?? RHS_STATUS_PRIORITY[a[0]] ?? SR_STATUS_PRIORITY[a[0]] ?? 9) - (S200_PRIORITY[b[0]] ?? PROX_PRIORITY[b[0]] ?? ENV_STATUS_PRIORITY[b[0]] ?? RHS_STATUS_PRIORITY[b[0]] ?? SR_STATUS_PRIORITY[b[0]] ?? 9));
  }, [allSignals]);

  const filteredAll  = useMemo(() => filterSignals(allSignals,  search, sector, cap, status, fund, dmaOnly), [allSignals,  search, sector, cap, status, fund, dmaOnly]);
  const filteredF40  = useMemo(() => filterSignals(f40Signals,  search, sector, cap, status, fund, dmaOnly), [f40Signals,  search, sector, cap, status, fund, dmaOnly]);
  const filteredS200 = useMemo(() => filterSignals(s200Signals, search, sector, cap, status, fund, dmaOnly), [s200Signals, search, sector, cap, status, fund, dmaOnly]);
  const filteredEnv  = useMemo(() => filterSignals(envSignals,  search, sector, cap, status, fund, dmaOnly), [envSignals,  search, sector, cap, status, fund, dmaOnly]);
  const filteredRHS  = useMemo(() => filterSignals(rhsSignals,  search, sector, cap, status, fund, dmaOnly), [rhsSignals,  search, sector, cap, status, fund, dmaOnly]);
  const filteredSR   = useMemo(() => filterSignals(srSignals,   search, sector, cap, status, fund, dmaOnly), [srSignals,   search, sector, cap, status, fund, dmaOnly]);

  const runDate = s200Data?.run_date ?? rhsData?.run_date ?? srData?.run_date ?? (f40Data && f40Data.length > 0 ? "—" : undefined);

  // Summary stats: actionable only (priority 0 or 1)
  const actionableF40  = f40Signals.filter((s) => s.statusPriority <= 1).length;
  const actionableS200 = s200Signals.filter((s) => s.statusPriority <= 1).length;
  const actionableEnv  = envSignals.filter((s)  => s.statusPriority <= 1).length;
  const actionableRHS  = rhsSignals.filter((s)  => s.statusPriority <= 1).length;
  // SR only has 3 statuses (IN_ZONE=0, WATCHING=1, ABOVE_DMA=2) and WATCHING
  // covers both "1-touch unconfirmed zone" and "nowhere near the zone" — unlike
  // the other strategies' priority-1 status, it doesn't mean "getting close."
  // So "actionable" here means IN_ZONE only, matching the tooltip below.
  const actionableSR   = srSignals.filter((s)   => s.statusPriority <= 0).length;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Multi-Strategy Scanner</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              All 5 strategies — F40 52W Low, Envelope Long, S200 20% Rally, RHS/CWH patterns, Support/Resistance — combined view
            </p>
          </div>
          {runDate && (
            <span className="text-xs text-muted-foreground shrink-0 mt-1">
              Data: {runDate}
            </span>
          )}
        </div>

        {/* Summary chips */}
        {!loading && (
          <div className="flex gap-3 mt-3 flex-wrap">
            {[
              { label: "Total Signals", value: allSignals.length, cls: "text-foreground", tip: "Combined count across all 4 strategies" },
              { label: "F40 52W", value: actionableF40, cls: "text-primary", tip: "F40 stocks at or near their 52-week low — buy candidates" },
              { label: "Envelope Long", value: actionableEnv, cls: "text-orange-400", tip: "F40 stocks in or approaching the lower envelope buy zone" },
              { label: "S200 Rally", value: actionableS200, cls: "text-violet-400", tip: "S200 stocks currently in or approaching their 20% rally buy zone" },
              { label: "RHS/CWH", value: actionableRHS, cls: "text-green-400", tip: "F40+E40 stocks with active breakouts (BREAKOUT status)" },
              { label: "Support/Resistance", value: actionableSR, cls: "text-cyan-400", tip: "F40+E40+S200 stocks currently at a validated support zone, below 200 DMA" },
            ].map(({ label, value, cls, tip }) => (
              <Tip key={label} content={tip} below>
                <div className="flex items-center gap-1.5 bg-card border border-border rounded px-3 py-1.5">
                  <span className={cn("text-base font-semibold tabular-nums", cls)}>{value}</span>
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              </Tip>
            ))}
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="px-6 py-2.5 border-b border-border shrink-0 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search ticker or sector…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48 bg-background border border-border rounded px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <Select value={sector} onValueChange={(v) => setSector(v ?? "all")}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Sector" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sectors</SelectItem>
            {sectors.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={cap} onValueChange={(v) => setCap(v ?? "all")}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="Cap Tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Cap Tiers</SelectItem>
            {caps.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v ?? "all")}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {statuses.map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Tip content="Filter by whether the stock passes every Must-Have fundamental gate (ROCE/ROE, Net D/E, PE, pledge, public shareholding, sales/profit ATH, OPM trend)" below>
          <Select value={fund} onValueChange={(v) => setFund((v ?? "all") as FundStatus | "all")}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="Fundamentals" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Fundamentals</SelectItem>
              <SelectItem value="pass">Pass Only</SelectItem>
              <SelectItem value="fail">Fail Only</SelectItem>
              <SelectItem value="no_data">No Data</SelectItem>
            </SelectContent>
          </Select>
        </Tip>
        <Tip content="Show only signals currently trading below their 200-day moving average — a key strategy requirement. Above-DMA setups are invalid entries." below>
          <button
            onClick={() => setDmaOnly((v) => !v)}
            className={cn(
              "h-8 px-3 rounded text-xs font-medium border transition-colors",
              dmaOnly
                ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
            )}
          >
            Below 200 DMA Only
          </button>
        </Tip>
        {(search || sector !== "all" || cap !== "all" || status !== "all" || fund !== "all" || dmaOnly) && (
          <button
            onClick={() => { setSearch(""); setSector("all"); setCap("all"); setStatus("all"); setFund("all"); setDmaOnly(false); }}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted/30 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      <StaleBanner runDate={runDate} strategy="Combined Scanner" />

      {/* Content */}
      <div className="px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <span className="text-sm text-muted-foreground animate-pulse">Loading scanner data…</span>
          </div>
        ) : (
          <Tabs defaultValue="all">
            <TabsList className="mb-4">
              <TabsTrigger value="all">
                <Tip content="All active signals from all 4 strategies combined" below>
                  <span>All Signals</span>
                </Tip>
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">({filteredAll.length})</span>
              </TabsTrigger>
              <TabsTrigger value="f40">
                <Tip content="Only 52W Low strategy signals from the F40 watchlist" below>
                  <span>F40 52W</span>
                </Tip>
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">({filteredF40.length})</span>
              </TabsTrigger>
              <TabsTrigger value="envelope">
                <Tip content="F40 stocks near the lower envelope band — buy when price touches −14% of 200 SMA" below>
                  <span>Envelope Long</span>
                </Tip>
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">({filteredEnv.length})</span>
              </TabsTrigger>
              <TabsTrigger value="s200">
                <Tip content="Only 20% Rally strategy signals from the S200 watchlist" below>
                  <span>S200 Rallies</span>
                </Tip>
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">({filteredS200.length})</span>
              </TabsTrigger>
              <TabsTrigger value="rhs">
                <Tip content="Reverse Head & Shoulders and Cup-With-Handle patterns from F40+E40 — breakout and forming opportunities" below>
                  <span>RHS / CWH</span>
                </Tip>
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">({filteredRHS.length})</span>
              </TabsTrigger>
              <TabsTrigger value="sr">
                <Tip content="Support/Resistance setups from F40+E40+S200 — validated support zones below 200 DMA" below>
                  <span>Support / Resistance</span>
                </Tip>
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">({filteredSR.length})</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all">
              <SignalTable signals={filteredAll} />
            </TabsContent>
            <TabsContent value="f40">
              <SignalTable signals={filteredF40} />
            </TabsContent>
            <TabsContent value="envelope">
              <SignalTable signals={filteredEnv} />
            </TabsContent>
            <TabsContent value="s200">
              <SignalTable signals={filteredS200} />
            </TabsContent>
            <TabsContent value="rhs">
              <SignalTable signals={filteredRHS} />
            </TabsContent>
            <TabsContent value="sr">
              <SignalTable signals={filteredSR} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

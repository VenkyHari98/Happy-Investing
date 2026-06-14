"use client";
import { useMemo, useState } from "react";
import { StockChart, type ChartPoint, type TradeMarker, type PatternOverlay } from "@/components/charts/StockChart";
import type { RHSStockDetail, RHSPattern, CWHPattern, RHSOpportunity } from "@/lib/types";
import { fmtPct, fmtNum } from "@/lib/format";

interface Props {
  data: RHSStockDetail;
  currentOpportunities: RHSOpportunity[];
}

type TimeRange = "1Y" | "3Y" | "All";

const PATTERN_MARKER_LABEL: Record<string, string> = {
  LS: "LS", H: "H", RS: "RS",
  CL: "CL", CB: "CB", CR: "CR", HL: "HL",
  B: "B",
};

/** Add N calendar days to a YYYY-MM-DD string */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function RHSStockDetail({ data, currentOpportunities }: Props) {
  const [timeRange, setTimeRange] = useState<TimeRange>("All");
  // "RHS-0", "CWH-1", etc. — null means all patterns shown at normal opacity
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const cutoff = useMemo(() => {
    if (timeRange === "All") return null;
    const d = new Date();
    d.setFullYear(d.getFullYear() - (timeRange === "1Y" ? 1 : 3));
    return d.toISOString().slice(0, 10);
  }, [timeRange]);

  // Price + MA200 from embedded series
  const { prices: pricePoints, ma200Points } = useMemo(() => {
    const pts = data.prices.filter((p) => !cutoff || p.date >= cutoff);
    const prices: ChartPoint[] = pts.map((p) => ({ time: p.date, value: p.close }));
    const ma200Points: ChartPoint[] = pts
      .filter((p) => p.ma200 != null)
      .map((p) => ({ time: p.date, value: p.ma200! }));
    return { prices, ma200Points };
  }, [data.prices, cutoff]);

  // Trade entry/exit markers + pattern point markers from embedded price series
  const tradeMarkers: TradeMarker[] = useMemo(() => {
    const out: TradeMarker[] = [];
    for (const t of data.trades) {
      if (!cutoff || t.entry_date >= cutoff) {
        out.push({ time: t.entry_date, type: "entry", price: t.entry_price, label: "B" });
      }
      if (t.exit_date && t.exit_price != null && (!cutoff || t.exit_date >= cutoff)) {
        out.push({ time: t.exit_date, type: "exit", price: t.exit_price, label: "S" });
      }
    }
    const ptSet = data.prices.filter((p) => !cutoff || p.date >= cutoff);
    for (const p of ptSet) {
      for (const m of p.markers) {
        out.push({
          time: p.date,
          type: m.label === "B" ? "rallyStart" : "skipped",
          price: m.price,
          label: PATTERN_MARKER_LABEL[m.label] ?? m.label,
        });
      }
    }
    return out;
  }, [data.trades, data.prices, cutoff]);

  // Build PatternOverlay objects for canvas rendering
  const patternOverlays: PatternOverlay[] = useMemo(() => {
    const overlays: PatternOverlay[] = [];

    data.rhs_patterns.forEach((p, i) => {
      const key = `RHS-${i}`;
      const startDate = p.l_shoulder_date;
      const endDate = p.breakout_date ?? p.r_shoulder_date;
      const targetEndDate = addDays(endDate, 60);
      const pts = data.prices
        .filter((d) => d.date >= startDate && d.date <= endDate)
        .map((d) => ({ date: d.date, price: d.close }));

      const isSelected = selectedKey === key;
      const someSelected = selectedKey !== null;
      const opacity = someSelected ? (isSelected ? 0.40 : 0.06) : 0.22;

      overlays.push({
        patternType: "RHS",
        pricePoints: pts,
        necklinePrice: p.neckline_price,
        necklineStartDate: startDate,
        necklineEndDate: endDate,
        targetPrice: p.target_price,
        targetStartDate: endDate,
        targetEndDate,
        opacity,
      });
    });

    data.cwh_patterns.forEach((p, i) => {
      const key = `CWH-${i}`;
      const startDate = p.cup_left_date;
      const endDate = p.breakout_date ?? p.cup_right_date;
      const targetEndDate = addDays(endDate, 60);
      const pts = data.prices
        .filter((d) => d.date >= startDate && d.date <= endDate)
        .map((d) => ({ date: d.date, price: d.close }));

      const isSelected = selectedKey === key;
      const someSelected = selectedKey !== null;
      const opacity = someSelected ? (isSelected ? 0.40 : 0.06) : 0.22;

      overlays.push({
        patternType: "CWH",
        pricePoints: pts,
        necklinePrice: p.neckline_price,
        necklineStartDate: startDate,
        necklineEndDate: endDate,
        targetPrice: p.target_price,
        targetStartDate: endDate,
        targetEndDate,
        opacity,
      });
    });

    return overlays;
  }, [data.rhs_patterns, data.cwh_patterns, data.prices, selectedKey]);

  const hasOpenPos = data.open_positions.length > 0;
  const totalPatterns = data.rhs_patterns.length + data.cwh_patterns.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{data.ticker}</h2>
          <p className="text-xs text-muted-foreground">{data.cap_tier} · {data.sector}</p>
        </div>
        <div className="flex gap-1 border border-border rounded-md p-0.5">
          {(["1Y", "3Y", "All"] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                timeRange === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Metric chips */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="bg-muted/40 px-2 py-1 rounded">
          Close: <span className="font-medium text-foreground">₹{data.latest_close.toLocaleString("en-IN")}</span>
        </span>
        <span className="bg-muted/40 px-2 py-1 rounded">
          Trades: <span className="font-medium text-foreground">{data.trades_count}</span>
        </span>
        <span className="bg-muted/40 px-2 py-1 rounded">
          Total P/L: <span className={`font-medium ${data.total_pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
            {data.total_pnl >= 0 ? "+" : ""}₹{Math.round(data.total_pnl).toLocaleString("en-IN")}
          </span>
        </span>
        {data.pe_current != null && (
          <span className="bg-muted/40 px-2 py-1 rounded">
            PE: <span className="font-medium text-foreground">{fmtNum(data.pe_current)}</span>
          </span>
        )}
        <span className="bg-orange-500/10 text-orange-400 px-2 py-1 rounded">RHS: {data.rhs_patterns.length}</span>
        <span className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded">CWH: {data.cwh_patterns.length}</span>
      </div>

      {/* Current opportunity alert */}
      {currentOpportunities.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs space-y-1">
          <p className="font-medium text-amber-400">Current Opportunity</p>
          {currentOpportunities.map((opp, i) => (
            <p key={i} className="text-muted-foreground">
              <span className="text-foreground">{opp.pattern_type}</span> · Status: {opp.status} ·
              Neckline: <span className="text-amber-400">₹{opp.neckline.toLocaleString("en-IN")}</span> ·
              Target: <span className="text-green-400">₹{opp.target.toLocaleString("en-IN")}</span>
              {opp.pct_to_neckline !== 0 && (
                <> · {opp.pct_to_neckline > 0 ? `+${opp.pct_to_neckline.toFixed(1)}% to neckline` : `${opp.pct_to_neckline.toFixed(1)}% above neckline`}</>
              )}
            </p>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="rounded-md border border-border overflow-hidden">
        <StockChart
          prices={pricePoints}
          ma200={ma200Points}
          markers={tradeMarkers}
          patternOverlays={patternOverlays}
          height={400}
          ticker={data.ticker}
        />
      </div>

      {/* Chart legend */}
      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground px-0.5">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded-sm bg-orange-500/40" /> RHS shape
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded-sm bg-blue-500/40" /> CWH shape
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-5 border-t border-dashed border-amber-500/70" /> Neckline
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-5 border-t border-dashed border-green-500/70" /> Target
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-5 border-t border-dotted border-green-400/60" /> 200 SMA
        </span>
        {totalPatterns > 1 && (
          <span className="text-muted-foreground italic">Click a pattern card to isolate it on the chart</span>
        )}
      </div>

      {/* Open positions */}
      {hasOpenPos && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-2">Open Positions</h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Entry Date</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Type</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Entry</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Neckline</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Target</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Unrealised</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Days</th>
                </tr>
              </thead>
              <tbody>
                {data.open_positions.map((pos, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="px-3 py-1.5">{pos.entry_date}</td>
                    <td className="px-3 py-1.5">
                      <span className={`text-[10px] px-1 rounded ${pos.pattern_type === "RHS" ? "bg-orange-500/15 text-orange-400" : "bg-blue-500/15 text-blue-400"}`}>
                        {pos.pattern_type}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">₹{pos.entry_price.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-amber-400">₹{pos.neckline.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-green-400">₹{pos.exit_target.toLocaleString("en-IN")}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${pos.unrealised_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {fmtPct(pos.unrealised_pct)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{pos.days_held}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detected patterns */}
      {totalPatterns > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-muted-foreground">Detected Patterns</h3>
            {selectedKey !== null && (
              <button
                onClick={() => setSelectedKey(null)}
                className="text-[10px] text-muted-foreground hover:text-foreground border border-border/60 rounded px-2 py-0.5 transition-colors"
              >
                Show All
              </button>
            )}
          </div>
          <div className="space-y-2">
            {data.rhs_patterns.map((p, i) => {
              const key = `RHS-${i}`;
              return (
                <PatternCard
                  key={key}
                  pattern={p}
                  isSelected={selectedKey === key}
                  onSelect={() => setSelectedKey((prev) => (prev === key ? null : key))}
                />
              );
            })}
            {data.cwh_patterns.map((p, i) => {
              const key = `CWH-${i}`;
              return (
                <PatternCard
                  key={key}
                  pattern={p}
                  isSelected={selectedKey === key}
                  onSelect={() => setSelectedKey((prev) => (prev === key ? null : key))}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Completed trades */}
      {data.trades.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-2">Completed Trades</h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Type</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Entry</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Exit</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Buy</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Sell</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">P/L</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Days</th>
                </tr>
              </thead>
              <tbody>
                {[...data.trades].reverse().map((t, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="px-3 py-1.5">
                      <span className={`text-[10px] px-1 rounded ${t.exit_reason?.startsWith("RHS") ? "bg-orange-500/15 text-orange-400" : "bg-blue-500/15 text-blue-400"}`}>
                        {t.exit_reason?.startsWith("RHS") ? "RHS" : "CWH"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">{t.entry_date}</td>
                    <td className="px-3 py-1.5">{t.exit_date ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">₹{t.entry_price.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">₹{(t.exit_price ?? 0).toLocaleString("en-IN")}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${t.pnl_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {fmtPct(t.pnl_pct)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{t.trade_duration_days}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

interface PatternCardProps {
  pattern: RHSPattern | CWHPattern;
  isSelected: boolean;
  onSelect: () => void;
}

function PatternCard({ pattern, isSelected, onSelect }: PatternCardProps) {
  const isRHS = pattern.pattern_type === "RHS";
  const baseColor = isRHS ? "orange" : "blue";

  const borderClass = isSelected
    ? isRHS ? "border-orange-400" : "border-blue-400"
    : isRHS ? "border-orange-500/30" : "border-blue-500/30";

  const bgClass = isRHS ? "bg-orange-500/5" : "bg-blue-500/5";
  const labelClass = isRHS ? "text-orange-400" : "text-blue-400";

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-md border px-3 py-2 text-xs space-y-1 transition-all cursor-pointer hover:opacity-90 ${borderClass} ${bgClass}`}
      title={isSelected ? "Click to deselect" : "Click to isolate on chart"}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`font-medium ${labelClass}`}>{pattern.pattern_type}</span>
          {isSelected && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${isRHS ? "bg-orange-500/20 text-orange-400" : "bg-blue-500/20 text-blue-400"}`}>
              highlighted
            </span>
          )}
        </div>
        {pattern.breakout_date ? (
          <span className="text-green-400 text-[10px]">Breakout {pattern.breakout_date}</span>
        ) : (
          <span className="text-amber-400 text-[10px]">Forming</span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
        {isRHS ? (
          <>
            <span>LS: ₹{(pattern as RHSPattern).l_shoulder_price.toLocaleString("en-IN")} ({(pattern as RHSPattern).l_shoulder_date})</span>
            <span>H: ₹{(pattern as RHSPattern).head_price.toLocaleString("en-IN")} ({(pattern as RHSPattern).head_date})</span>
            <span>RS: ₹{(pattern as RHSPattern).r_shoulder_price.toLocaleString("en-IN")} ({(pattern as RHSPattern).r_shoulder_date})</span>
          </>
        ) : (
          <>
            <span>CL: ₹{(pattern as CWHPattern).cup_left_price.toLocaleString("en-IN")} ({(pattern as CWHPattern).cup_left_date})</span>
            <span>CB: ₹{(pattern as CWHPattern).cup_bottom_price.toLocaleString("en-IN")} ({(pattern as CWHPattern).cup_bottom_date})</span>
            <span>CR: ₹{(pattern as CWHPattern).cup_right_price.toLocaleString("en-IN")} ({(pattern as CWHPattern).cup_right_date})</span>
            <span>HL: ₹{(pattern as CWHPattern).handle_low_price.toLocaleString("en-IN")} ({(pattern as CWHPattern).handle_low_date})</span>
          </>
        )}
      </div>
      <div className="flex gap-4">
        <span className="text-amber-400">Neckline: ₹{pattern.neckline_price.toLocaleString("en-IN")}</span>
        <span className="text-green-400">Target: ₹{pattern.target_price.toLocaleString("en-IN")}</span>
        <span className="text-muted-foreground">
          Upside: +{(((pattern.target_price - pattern.neckline_price) / pattern.neckline_price) * 100).toFixed(1)}%
        </span>
      </div>
    </button>
  );
}

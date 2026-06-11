"use client";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RunStatus {
  running: boolean;
  started_at: string;
  completed_at: string;
  error: string;
}

interface Props {
  currentEnvelopePct: number;
  currentEntryBandPct: number;
  years: "5" | "10";
  runStatus: RunStatus | null;
  onRun: (envelopePct: number, entryBandPct: number) => void;
}

export function EnvelopeConfigPanel({
  currentEnvelopePct,
  currentEntryBandPct,
  years,
  runStatus,
  onRun,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [envelopePct, setEnvelopePct] = useState(currentEnvelopePct);
  const [entryBandPct, setEntryBandPct] = useState(currentEntryBandPct);

  const isRunning = runStatus?.running ?? false;

  function handleRun() {
    onRun(envelopePct, entryBandPct);
    setExpanded(false);
  }

  return (
    <div className="px-6 py-2 border-b border-border shrink-0">
      {/* Collapsed view — param summary + expand button */}
      <div className="flex items-center gap-3 text-xs">
        <span className="text-muted-foreground font-medium">Backtest params:</span>
        <Badge variant="outline" className="text-xs font-mono">Env ±{currentEnvelopePct}%</Badge>
        <Badge variant="outline" className="text-xs font-mono">Zone ±{currentEntryBandPct}%</Badge>
        <Badge variant="secondary" className="text-xs">L 5% · M 3% · S 2%</Badge>
        <button
          onClick={() => setExpanded((e) => !e)}
          disabled={isRunning}
          className={cn(
            "ml-auto text-xs px-2 py-0.5 rounded border transition-colors",
            isRunning
              ? "border-border text-muted-foreground cursor-not-allowed"
              : "border-primary/40 text-primary hover:bg-primary/10"
          )}
        >
          {isRunning ? "Running…" : expanded ? "Close" : "Re-run"}
        </button>
      </div>

      {/* Run status message */}
      {isRunning && (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-amber-400">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          Backtest running in background — this takes a few minutes. Data will refresh on completion.
        </div>
      )}
      {!isRunning && runStatus?.error && (
        <div className="mt-1.5 text-xs text-red-400">Run failed: {runStatus.error}</div>
      )}

      {/* Expanded config panel */}
      {expanded && !isRunning && (
        <Card className="mt-3 border-primary/20">
          <CardContent className="px-4 py-3">
            <div className="flex flex-wrap items-end gap-4">
              {/* Envelope % */}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Envelope %</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    step={0.5}
                    value={envelopePct}
                    onChange={(e) => setEnvelopePct(parseFloat(e.target.value) || 14)}
                    className="w-20 bg-background border border-border rounded px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <span className="text-[10px] text-muted-foreground/60">band around 200 SMA</span>
              </label>

              {/* Entry Band (Zone) % */}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Zone % (entry band)</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0.5}
                    max={10}
                    step={0.5}
                    value={entryBandPct}
                    onChange={(e) => setEntryBandPct(parseFloat(e.target.value) || 2)}
                    className="w-20 bg-background border border-border rounded px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <span className="text-[10px] text-muted-foreground/60">tolerance above lower env</span>
              </label>

              {/* Allocation info (read-only) */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Position sizes</span>
                <div className="flex gap-1.5">
                  {[["Large", "5%"], ["Mid", "3%"], ["Small", "2%"]].map(([cap, pct]) => (
                    <span key={cap} className="text-xs border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                      {cap} {pct}
                    </span>
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground/60">fixed, not configurable</span>
              </div>

              {/* Horizon info */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Horizon</span>
                <span className="text-sm font-medium">{years}Y</span>
                <span className="text-[10px] text-muted-foreground/60">from page toggle</span>
              </div>

              {/* Run button */}
              <button
                onClick={handleRun}
                className="mb-0.5 px-4 py-1.5 bg-primary text-primary-foreground text-sm rounded hover:bg-primary/90 transition-colors font-medium"
              >
                Run Backtest
              </button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

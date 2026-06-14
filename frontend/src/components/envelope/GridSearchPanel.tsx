"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import type { GridSearchResult, GridSearchStatus } from "@/lib/types";

interface Props {
  years: "5" | "10";
}

export function GridSearchPanel({ years }: Props) {
  const [expanded, setExpanded]   = useState(false);
  const [envMin,   setEnvMin]     = useState(12);
  const [envMax,   setEnvMax]     = useState(17);
  const [zoneMin,  setZoneMin]    = useState(0);
  const [zoneMax,  setZoneMax]    = useState(2.5);

  const [status,    setStatus]    = useState<GridSearchStatus | null>(null);
  const [results,   setResults]   = useState<GridSearchResult[]>([]);
  const [localError, setLocalError] = useState("");

  const esRef = useRef<EventSource | null>(null);

  // Connect to SSE stream, accumulating top-20 results in state
  const connectSSE = useCallback(() => {
    esRef.current?.close();
    setResults([]);

    const es = new EventSource(api.gridSearch.streamUrl());
    esRef.current = es;

    es.addEventListener("result", (e: MessageEvent) => {
      const r = JSON.parse(e.data) as GridSearchResult;
      setResults((prev) => {
        const next = [...prev, r];
        next.sort((a, b) => b.cagr - a.cagr);
        return next.slice(0, 20);
      });
    });

    es.addEventListener("progress", (e: MessageEvent) => {
      const { n_done, n_total } = JSON.parse(e.data) as { n_done: number; n_total: number };
      setStatus((prev) =>
        prev
          ? { ...prev, n_done, n_total, running: true }
          : { running: true, n_done, n_total, started_at: "", completed_at: "", error: "" }
      );
    });

    es.addEventListener("fail", (e: MessageEvent) => {
      const { error } = JSON.parse(e.data) as { error: string };
      setLocalError(error);
      setStatus((prev) => prev ? { ...prev, running: false } : null);
      es.close();
      esRef.current = null;
    });

    es.addEventListener("done", (e: MessageEvent) => {
      const { n_done, n_total } = JSON.parse(e.data) as { n_done: number; n_total: number };
      setStatus((prev) =>
        prev
          ? { ...prev, running: false, n_done, completed_at: new Date().toISOString() }
          : { running: false, n_done, n_total, started_at: "", completed_at: new Date().toISOString(), error: "" }
      );
      es.close();
      esRef.current = null;
    });
  }, []);

  // On mount: check if a run is already in progress
  useEffect(() => {
    api.gridSearch.status()
      .then((s) => {
        setStatus(s);
        if (s.running) connectSSE();
      })
      .catch(() => {});

    return () => { esRef.current?.close(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRun = useCallback(async () => {
    setLocalError("");
    try {
      const res = await api.gridSearch.run({
        env_pct_min:  envMin,
        env_pct_max:  envMax,
        zone_pct_min: zoneMin,
        zone_pct_max: zoneMax,
        years:        parseInt(years),
      });
      if (res.status !== "started") {
        setLocalError(res.detail ?? "Failed to start");
        return;
      }
    } catch (err) {
      setLocalError(String(err));
      return;
    }
    setExpanded(false);
    connectSSE();
  }, [envMin, envMax, zoneMin, zoneMax, years, connectSSE]);

  const handleStop = useCallback(async () => {
    await api.gridSearch.stop();
    esRef.current?.close();
    esRef.current = null;
    setStatus((prev) => prev ? { ...prev, running: false } : null);
  }, []);

  const isRunning = status?.running ?? false;
  const n_done    = status?.n_done ?? 0;
  const n_total   = status?.n_total ?? 0;
  const pct       = n_total > 0 ? Math.round((n_done / n_total) * 100) : 0;
  const hasResults = results.length > 0;
  const hasPrior   = !isRunning && !!status?.completed_at;

  return (
    <div className="px-6 py-2 border-b border-border shrink-0">
      {/* Collapsed header */}
      <div className="flex items-center gap-3 text-xs">
        <Tip content="Automatically test hundreds of envelope/zone % combinations to find the settings that produce the best CAGR" below>
          <span className="text-muted-foreground font-medium cursor-default">Grid Search:</span>
        </Tip>

        {isRunning ? (
          <>
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-amber-400 tabular-nums">
              {n_done.toLocaleString()} / {n_total.toLocaleString()} combos ({pct}%)
            </span>
          </>
        ) : hasPrior ? (
          <>
            <Tip content="Envelope % range used in this grid search" below><Badge variant="outline" className="text-xs">Env {envMin}–{envMax}%</Badge></Tip>
            <Tip content="Zone % range used in this grid search" below><Badge variant="outline" className="text-xs">Zone {zoneMin}–{zoneMax}%</Badge></Tip>
            <Tip content="Total parameter combinations tested in this run" below><span className="text-muted-foreground/60 text-[10px] cursor-default">{n_done.toLocaleString()} combos tested</span></Tip>
          </>
        ) : (
          <span className="text-muted-foreground/60 text-[10px]">Not yet run this session</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {isRunning && (
            <button
              onClick={handleStop}
              className="text-xs px-2 py-0.5 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Stop
            </button>
          )}
          <button
            onClick={() => setExpanded((e) => !e)}
            disabled={isRunning}
            className={cn(
              "text-xs px-2 py-0.5 rounded border transition-colors",
              isRunning
                ? "border-border text-muted-foreground cursor-not-allowed"
                : "border-primary/40 text-primary hover:bg-primary/10"
            )}
          >
            {isRunning ? "Running…" : expanded ? "Close" : hasPrior ? "Re-run" : "Run Grid Search"}
          </button>
        </div>
      </div>

      {/* Error message */}
      {localError && (
        <div className="mt-1.5 text-xs text-red-400">Grid search failed: {localError}</div>
      )}

      {/* Progress bar */}
      {isRunning && n_total > 0 && (
        <div className="mt-2 h-1 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Expanded config panel */}
      {expanded && !isRunning && (
        <Card className="mt-3 border-primary/20">
          <CardContent className="px-4 py-3">
            <div className="flex flex-wrap items-end gap-4">
              {/* Env% range */}
              <div className="flex flex-col gap-1">
                <Tip content="Min and max envelope % to test. Each step is 1%. Keep range tight to avoid long run times">
                  <span className="text-xs text-muted-foreground cursor-default">Envelope % range</span>
                </Tip>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number" min={1} max={30} step={1} value={envMin}
                    onChange={(e) => setEnvMin(parseFloat(e.target.value) || 12)}
                    className="w-16 bg-background border border-border rounded px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-xs text-muted-foreground">–</span>
                  <input
                    type="number" min={1} max={30} step={1} value={envMax}
                    onChange={(e) => setEnvMax(parseFloat(e.target.value) || 17)}
                    className="w-16 bg-background border border-border rounded px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <span className="text-[10px] text-muted-foreground/60">valid: 12–17% (1% steps)</span>
              </div>

              {/* Zone% range */}
              <div className="flex flex-col gap-1">
                <Tip content="Min and max zone % to test. Each step is 0.5%">
                  <span className="text-xs text-muted-foreground cursor-default">Zone % range</span>
                </Tip>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number" min={0} max={10} step={0.5} value={zoneMin}
                    onChange={(e) => setZoneMin(parseFloat(e.target.value) || 0)}
                    className="w-16 bg-background border border-border rounded px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-xs text-muted-foreground">–</span>
                  <input
                    type="number" min={0} max={10} step={0.5} value={zoneMax}
                    onChange={(e) => setZoneMax(parseFloat(e.target.value) || 2.5)}
                    className="w-16 bg-background border border-border rounded px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <span className="text-[10px] text-muted-foreground/60">valid: 0–2.5% (0.5% steps)</span>
              </div>

              {/* Alloc (read-only) */}
              <div className="flex flex-col gap-1">
                <Tip content="Position sizes are also swept across this range for each combo — total combos = env steps × zone steps × alloc combos">
                  <span className="text-xs text-muted-foreground cursor-default">Alloc sweep</span>
                </Tip>
                <div className="flex gap-1 flex-wrap">
                  {[["L", "3–5%"], ["M", "2–3.5%"], ["S", "1.5–2.5%"]].map(([cap, range]) => (
                    <span key={cap} className="text-xs border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                      {cap} {range}
                    </span>
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground/60">+ fixed × rolling × pyr/nopyr</span>
              </div>

              {/* Horizon (read-only) */}
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
                Run Grid Search
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Live / completed results table */}
      {hasResults && (
        <div className="mt-3 overflow-x-auto">
          <table className="text-xs w-full">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                {[
                  { h: "#", tip: "" },
                  { h: "CAGR%", tip: "Compound Annual Growth Rate for this parameter combination — higher is better" },
                  { h: "Env%", tip: "The envelope width tested" },
                  { h: "Zone%", tip: "The entry band width tested" },
                  { h: "Large%", tip: "Large Cap position size used in this combination" },
                  { h: "Mid%", tip: "Mid Cap position size used in this combination" },
                  { h: "Small%", tip: "Small Cap position size used in this combination" },
                  { h: "Exit", tip: "Exit method tested (upper envelope vs 200 SMA mean reversion)" },
                  { h: "Pyramid", tip: "Whether pyramiding (multi-tranche averaging) was enabled" },
                  { h: "Trades", tip: "Number of trades generated with these settings" },
                  { h: "Win%", tip: "Win rate with these settings" },
                  { h: "MaxDD%", tip: "Maximum drawdown — bigger negative = more risk" },
                ].map(({ h, tip }, i) => (
                    <th key={h} className={cn("pb-1 pr-3", i > 0 ? "text-right" : "text-left")}>
                      {tip ? (
                        <Tip content={tip} below>
                          <span className="cursor-default">{h}</span>
                        </Tip>
                      ) : h}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {results.slice(0, 10).map((r, i) => (
                <tr
                  key={i}
                  className={cn(
                    "border-b border-border/40 hover:bg-muted/20 transition-colors",
                    i === 0 && "text-green-400 font-medium"
                  )}
                >
                  <td className="py-1 pr-3 text-muted-foreground">{i + 1}</td>
                  <td className="text-right py-1 pr-3 tabular-nums">{r.cagr.toFixed(2)}%</td>
                  <td className="text-right py-1 pr-3 tabular-nums">{r.env_pct.toFixed(0)}%</td>
                  <td className="text-right py-1 pr-3 tabular-nums">{r.zone_pct.toFixed(1)}%</td>
                  <td className="text-right py-1 pr-3 tabular-nums">{r.alloc_large.toFixed(1)}%</td>
                  <td className="text-right py-1 pr-3 tabular-nums">{r.alloc_mid.toFixed(1)}%</td>
                  <td className="text-right py-1 pr-3 tabular-nums">{r.alloc_small.toFixed(1)}%</td>
                  <td className="text-right py-1 pr-3">{r.exit_mode}</td>
                  <td className="text-right py-1 pr-3">{r.pyramid ? "Yes" : "No"}</td>
                  <td className="text-right py-1 pr-3 tabular-nums">{r.trades}</td>
                  <td className="text-right py-1 pr-3 tabular-nums">{r.win_rate.toFixed(1)}%</td>
                  <td className="text-right py-1 tabular-nums text-red-400">{r.max_dd.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {isRunning
              ? `Top 10 of ${results.length} seen so far — updating live`
              : `Top 10 of ${n_done.toLocaleString()} combinations tested`}
          </p>
        </div>
      )}
    </div>
  );
}

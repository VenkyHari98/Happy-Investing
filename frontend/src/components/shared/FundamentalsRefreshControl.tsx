"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
import type { FundamentalsPhase } from "@/lib/types";
import { LIVE_PIPELINE_CONTROLS_ENABLED } from "@/lib/featureFlags";

const STALE_AFTER_DAYS = 90; // quarterly-ish reminder threshold — purely visual, never auto-triggers

const PHASE_LABELS: Record<FundamentalsPhase, string> = {
  screener: "Pulling Screener.in data",
  yfinance: "Refreshing yfinance fundamentals",
  scanners: "Re-running scanners",
  done: "Done",
};

function daysSince(dateStr: string): number | null {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function invalidateAfterRefresh(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["pipeline-status"] });
  queryClient.invalidateQueries({ queryKey: ["scanner-f40"] });
  queryClient.invalidateQueries({ queryKey: ["scanner-f40-summary"] });
  queryClient.invalidateQueries({ queryKey: ["scanner-s200"] });
  queryClient.invalidateQueries({ queryKey: ["rhs-scanner"] });
  queryClient.invalidateQueries({ queryKey: ["sr-scanner"] });
}

export function FundamentalsRefreshControl() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const prevRunningRef = useRef(false);

  const { data: status } = useQuery({
    queryKey: ["pipeline-status"],
    queryFn: api.pipeline.status,
    refetchInterval: (query) => (query.state.data?.running ? 3000 : 30_000),
  });

  const isRunning = status?.running ?? false;
  const progress = status?.fundamentals_progress ?? null;
  const days = status?.fundamentals_run_date ? daysSince(status.fundamentals_run_date) : null;
  const isStale = days == null || days >= STALE_AFTER_DAYS;

  // Fire once when a run transitions from running -> finished
  useEffect(() => {
    if (prevRunningRef.current && !isRunning) {
      invalidateAfterRefresh(queryClient);
    }
    prevRunningRef.current = isRunning;
  }, [isRunning, queryClient]);

  const displayError = error ?? (!isRunning ? status?.error || null : null);

  async function handleRefresh(forceAll: boolean) {
    setError(null);
    try {
      await api.pipeline.refreshFundamentals({ forceAll });
      queryClient.invalidateQueries({ queryKey: ["pipeline-status"] });
    } catch {
      setError("Failed to start refresh");
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="px-4 py-3 border-t border-border text-xs">
      <Tip
        content="Fundamentals (ROCE, ROE, Net D/E, TTM Profit, OPM, Screener.in pledge/shareholding) only change on quarterly results — never refreshed automatically. Incremental refresh only touches stocks stale ~90+ days; Force Full re-fetches everyone (8-12 min)."
        right
      >
        <div className="flex flex-col gap-1.5">
          <span className={cn("text-muted-foreground", isStale && !isRunning && "text-amber-400")}>
            Fundamentals:{" "}
            {isRunning
              ? "refreshing…"
              : days == null
              ? "never refreshed"
              : `${days} day${days === 1 ? "" : "s"} ago`}
          </span>

          {isRunning && progress && (
            <div className="flex flex-col gap-0.5">
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${progress.total > 0 ? pct : 8}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground/80">
                {PHASE_LABELS[progress.phase] ?? progress.phase}
                {progress.total > 0 && ` — ${progress.current}/${progress.total}`}
                {progress.label ? ` (${progress.label})` : ""}
              </span>
            </div>
          )}

          {LIVE_PIPELINE_CONTROLS_ENABLED && (
            <button
              onClick={() => handleRefresh(false)}
              disabled={isRunning}
              className={cn(
                "px-2 py-1 rounded text-[11px] font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                isStale
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
                  : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
              )}
            >
              {isRunning ? "Refreshing…" : "Refresh Fundamentals"}
            </button>
          )}

          {LIVE_PIPELINE_CONTROLS_ENABLED && !isRunning && (
            <Tip content="Re-fetches every stock regardless of freshness, not just the stale ones — realistically 8-12 minutes, since Screener.in has no bulk API. Rarely needed." right>
              <button
                onClick={() => handleRefresh(true)}
                className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground underline underline-offset-2 text-left w-fit"
              >
                Force full refresh
              </button>
            </Tip>
          )}

          {displayError && <span className="text-red-400 text-[10px]">{displayError}</span>}
        </div>
      </Tip>
    </div>
  );
}

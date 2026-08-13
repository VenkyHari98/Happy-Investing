"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { LIVE_PIPELINE_CONTROLS_ENABLED } from "@/lib/featureFlags";

interface Props {
  runDate: string | undefined;
  strategy: string;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function StaleBanner({ runDate, strategy }: Props) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const { data: pipelineStatus } = useQuery({
    queryKey: ["pipeline-status"],
    queryFn: api.pipeline.status,
    refetchInterval: 30_000,
  });

  const effectiveRunDate = pipelineStatus?.run_date ?? runDate;
  const today = pipelineStatus?.today ?? new Date().toISOString().slice(0, 10);
  const daysOld = effectiveRunDate ? daysBetween(effectiveRunDate, today) : null;
  const isRunning = pipelineStatus?.running ?? refreshing;
  const isFresh = daysOld != null && daysOld <= 1;

  if (isFresh && !isRunning) return null;

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await api.pipeline.refresh({ force: true });
      // Poll pipeline status every 5s until done
      const poll = setInterval(async () => {
        const status = await api.pipeline.status();
        if (!status.running) {
          clearInterval(poll);
          setRefreshing(false);
          // Invalidate all scanner queries so they refetch
          queryClient.invalidateQueries({ queryKey: ["scanner-f40"] });
          queryClient.invalidateQueries({ queryKey: ["scanner-f40-summary"] });
          queryClient.invalidateQueries({ queryKey: ["scanner-s200"] });
          queryClient.invalidateQueries({ queryKey: ["rhs-scanner"] });
          queryClient.invalidateQueries({ queryKey: ["pipeline-status"] });
          if (status.error) setRefreshError(status.error);
        }
      }, 5000);
    } catch {
      setRefreshing(false);
      setRefreshError("Failed to start refresh");
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs">
      <span className="shrink-0">⚠</span>
      {isRunning ? (
        <span className="flex items-center gap-2">
          <span className="animate-spin text-sm">⟳</span>
          Pipeline refresh in progress — scanner data will update when complete…
        </span>
      ) : (
        <>
          <span>
            {strategy} data is{" "}
            <span className="font-semibold">{daysOld != null ? `${daysOld} day${daysOld !== 1 ? "s" : ""} old` : "stale"}</span>
            {effectiveRunDate ? ` (last scanned: ${effectiveRunDate})` : ""}.
            {" "}Opportunities may have changed.
          </span>
          {LIVE_PIPELINE_CONTROLS_ENABLED && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="ml-auto shrink-0 px-3 py-0.5 rounded text-[11px] font-medium border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
            >
              Refresh Now →
            </button>
          )}
        </>
      )}
      {refreshError && (
        <span className="text-red-400 text-[10px] ml-2">{refreshError}</span>
      )}
    </div>
  );
}

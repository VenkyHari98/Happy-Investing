"use client";
import { useQuery } from "@tanstack/react-query";
import { SRScanner } from "@/components/sr/SRScanner";
import { api } from "@/lib/api";
import { StaleBanner } from "@/components/shared/StaleBanner";

export default function SRPage() {
  const { data: scanner, isLoading } = useQuery({
    queryKey: ["sr-scanner"],
    queryFn: api.sr.scanner,
    staleTime: 60 * 60 * 1000,
  });

  return (
    <div className="flex flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Support &amp; Resistance</h1>
          <p className="text-xs text-muted-foreground">
            Buy at a validated support zone (2+ prior touches, below 200 DMA), sell at the paired resistance zone above it — F40 + E40 + S200
          </p>
        </div>
      </div>

      <StaleBanner runDate={scanner?.run_date} strategy="Support & Resistance" />

      <div className="px-6 py-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading scanner…</div>
        ) : scanner ? (
          <SRScanner data={scanner} />
        ) : (
          <div className="text-sm text-muted-foreground">
            No scanner data yet — run the pipeline (<code className="bg-muted px-1 rounded text-[10px]">python Scripts/strategies/support_resistance_scanner.py</code>) to generate.
          </div>
        )}
      </div>
    </div>
  );
}

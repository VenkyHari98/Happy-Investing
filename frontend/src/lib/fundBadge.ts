import type { FundamentalFields } from "@/lib/types";

export interface FundBadge {
  label: string;
  cls: string;
}

// A stock with every core gating field null was never actually verified —
// distinct from a stock that was checked and genuinely passed everything.
function hasNoData(row: FundamentalFields): boolean {
  return (
    row.fund_roce == null &&
    row.fund_roe == null &&
    row.fund_net_de == null &&
    row.fund_ttm_np_cr == null &&
    row.fund_sales_vs_ath_pct == null &&
    row.fund_profit_vs_ath_pct == null
  );
}

export type FundStatus = "pass" | "fail" | "no_data";

// Single source of truth for "does this row pass fundamentals" — used both by
// the badge below and by the cross-tab Fundamentals filter, so filtering to
// "Pass" always matches exactly what the badge on-screen says, never a
// separately-drifting definition.
export function getFundStatus(row: FundamentalFields): FundStatus {
  if (hasNoData(row)) return "no_data";
  return row.fund_all_pass ? "pass" : "fail";
}

export function getFundBadge(row: FundamentalFields): FundBadge {
  const status = getFundStatus(row);
  if (status === "no_data") {
    return { label: "No Data", cls: "bg-amber-500/10 text-amber-400/80 border-amber-500/20" };
  }
  if (status === "pass") {
    return { label: "All Pass", cls: "bg-green-500/20 text-green-400 border-green-500/30" };
  }
  const fails: string[] = [];
  if (row.fund_pe_pass === false) fails.push("PE");
  if (row.fund_s3_s5_pass === false) fails.push("Phase2");
  if (row.fund_below_200dma === false) fails.push("200DMA");
  if (row.fund_fall_from_high_pass === false) fails.push("Fall");
  if (fails.length === 0) return { label: "—", cls: "bg-muted text-muted-foreground border-border" };
  return { label: `Fail: ${fails.join(", ")}`, cls: "bg-red-500/20 text-red-400 border-red-500/30" };
}

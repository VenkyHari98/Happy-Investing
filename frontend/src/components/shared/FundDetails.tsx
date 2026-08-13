"use client";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import type { FundamentalFields } from "@/lib/types";

interface Props {
  row: FundamentalFields & { cap_tier: string };
}

function Metric({
  label,
  value,
  pass,
  threshold,
  informational,
  source,
}: {
  label: string;
  value: string;
  pass?: boolean;
  threshold?: string;
  informational?: boolean;
  source?: "screener" | "yfinance" | null;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[110px]">
      <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">
        {label}
        {source && (
          <span
            className="ml-1 normal-case tracking-normal text-muted-foreground/50"
            title={source === "screener" ? "Sourced from Screener.in" : "Sourced from yfinance (Screener.in had no data for this stock)"}
          >
            ({source === "screener" ? "Screener" : "yfinance"})
          </span>
        )}
      </span>
      <span className={cn(
        "text-xs font-medium tabular-nums",
        informational ? "text-muted-foreground"
        : pass === true  ? "text-green-400"
        : pass === false ? "text-red-400"
        : "text-foreground"
      )}>
        {value}
        {!informational && pass !== undefined && (
          <span className="ml-1 text-[10px]">{pass ? "✓" : "✗"}</span>
        )}
      </span>
      {threshold && (
        <span className="text-[10px] text-muted-foreground/50">{threshold}</span>
      )}
    </div>
  );
}

function opmTrend(opm: number[] | null | undefined): string {
  if (!opm || opm.length === 0) return "—";
  // opm is newest-first ([latest, prev, oldest]) — display chronologically
  // (oldest → newest, left to right) to match how Screener.in's own table reads.
  const chron = [...opm].reverse();
  const vals = chron.map((v) => v.toFixed(1) + "%").join(" → ");
  if (chron.length < 2) return vals;
  const oldest = chron[0];
  const newest = chron[chron.length - 1];
  const arrow = newest > oldest ? " ↑" : newest < oldest ? " ↓" : " →";
  return vals + arrow;
}

function opmPass(opm: number[] | null | undefined): boolean | undefined {
  if (!opm || opm.length < 2) return undefined;
  // Mirrors fundamental_config.py's REQUIRE_OPM_NON_DECLINING check: each
  // year must be >= the prior year (opm is newest-first, so adjacent pairs
  // must be non-increasing walking from index 0 outward).
  for (let i = 0; i < opm.length - 1; i++) {
    if (opm[i] < opm[i + 1]) return false;
  }
  return true;
}

export function FundDetails({ row }: Props) {
  const failReasons = [
    ...(row.fund_pe_fail_reasons ?? []),
    ...(row.fund_s3_s5_fail_reasons ?? []),
  ];

  return (
    <div className="bg-muted/20 border-t border-border/50 px-4 py-3 space-y-3">
      {/* Metrics grid */}
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {/* ROCE — only actually gated for non-financial stocks (MIN_ROCE=15%);
            for financials it's informational since ROE is the real gate. */}
        <Metric
          label="ROCE"
          value={row.fund_roce != null ? fmtNum(row.fund_roce) + "%" : "—"}
          pass={row.fund_roce != null && !row.fund_is_financial ? row.fund_roce >= 15 : undefined}
          informational={row.fund_is_financial}
          threshold="≥ 15%"
          source={row.fund_roce_source}
        />

        {/* ROE — only actually gated for financial stocks (MIN_ROE=12%, not 15%);
            for non-financials it's informational since ROCE is the real gate. */}
        <Metric
          label="ROE"
          value={row.fund_roe != null ? fmtNum(row.fund_roe) + "%" : "—"}
          pass={row.fund_roe != null && row.fund_is_financial ? row.fund_roe >= 12 : undefined}
          informational={!row.fund_is_financial}
          threshold="≥ 12%"
          source={row.fund_roe_source}
        />

        {/* Net D/E */}
        <Metric
          label="Net D/E"
          value={row.fund_net_de != null ? fmtNum(row.fund_net_de) + "x" : "—"}
          pass={row.fund_net_de != null ? row.fund_net_de <= 0.25 : undefined}
          threshold="≤ 0.25x"
        />

        {/* TTM Net Profit */}
        <Metric
          label="TTM Net Profit"
          value={row.fund_ttm_np_cr != null ? "₹" + fmtNum(row.fund_ttm_np_cr) + " Cr" : "—"}
          pass={row.fund_ttm_np_cr != null ? row.fund_ttm_np_cr >= 250 : undefined}
          threshold="≥ ₹250 Cr"
        />

        {/* OPM Trend */}
        <Metric
          label="OPM Trend (3yr)"
          value={opmTrend(row.fund_opm_3yr)}
          pass={opmPass(row.fund_opm_3yr)}
          threshold="Non-declining"
          source={row.fund_opm_source}
        />

        {/* Sales vs ATH */}
        <Metric
          label="Sales vs ATH"
          value={row.fund_sales_vs_ath_pct != null ? fmtNum(row.fund_sales_vs_ath_pct) + "%" : "—"}
          pass={row.fund_sales_vs_ath_pct != null ? row.fund_sales_vs_ath_pct >= 90 : undefined}
          threshold="≥ 90%"
        />

        {/* Profit vs ATH */}
        <Metric
          label="Profit vs ATH"
          value={row.fund_profit_vs_ath_pct != null ? fmtNum(row.fund_profit_vs_ath_pct) + "%" : "—"}
          pass={row.fund_profit_vs_ath_pct != null ? row.fund_profit_vs_ath_pct >= 90 : undefined}
          threshold="≥ 90%"
        />

        {/* Pledged % */}
        <Metric
          label="Promoter Pledge"
          value={row.fund_pledged_pct != null ? fmtNum(row.fund_pledged_pct) + "%" : "—"}
          pass={row.fund_pledged_pct != null ? row.fund_pledged_pct <= 5 : undefined}
          threshold="≤ 5%"
        />

        {/* Public Shareholding % */}
        <Metric
          label="Public Shareholding"
          value={row.fund_public_shareholding_pct != null ? fmtNum(row.fund_public_shareholding_pct) + "%" : "—"}
          pass={row.fund_public_shareholding_pct != null ? row.fund_public_shareholding_pct <= 30 : undefined}
          threshold="≤ 30%"
        />

        {/* TFA vs ATH — alt-pass for Profit vs ATH, not a standalone fail */}
        <Metric
          label="TFA vs ATH"
          value={row.fund_tfa_vs_ath_pct != null ? fmtNum(row.fund_tfa_vs_ath_pct) + "%" : "—"}
          informational
        />

        {/* Fall from 52W High */}
        <Metric
          label="Fall from 52W High"
          value={row.fund_fall_from_52w_high_pct != null
            ? (row.fund_fall_from_52w_high_pct > 0 ? "−" : "") + fmtNum(Math.abs(row.fund_fall_from_52w_high_pct)) + "%"
            : "—"}
          informational
        />

        {/* Fall from 10yr High — informational only: not a pass/fail gate, the
            depth of the fall is a judgment call weighed against how strong the
            fundamentals are, not a hard floor. Reference (not required) level
            shown per cap tier for context. */}
        <Metric
          label={`Fall from 10yr High (${row.cap_tier})`}
          value={row.fund_fall_from_10yr_high_pct != null
            ? (row.fund_fall_from_10yr_high_pct > 0 ? "−" : "") + fmtNum(Math.abs(row.fund_fall_from_10yr_high_pct)) + "%"
            : "—"}
          informational
          threshold={
            row.cap_tier === "Large Cap" ? "ref. 20%+"
            : row.cap_tier === "Mid Cap" ? "ref. 30%+"
            : row.cap_tier === "Small Cap" ? "ref. 40%+"
            : undefined
          }
        />
      </div>

      {/* Fail reasons */}
      {failReasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/30">
          <span className="text-[10px] text-muted-foreground/60 mr-1 self-center">Why it fails:</span>
          {failReasons.map((r, i) => (
            <span key={i} className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded font-mono">
              {r}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

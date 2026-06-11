const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const inrCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function fmtCur(v: number | null | undefined): string {
  if (v == null) return "—";
  return Math.abs(v) >= 1_00_000 ? inrCompact.format(v) : inr.format(v);
}

export function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}

export function fmtNum(v: number | null | undefined, decimals = 1): string {
  if (v == null) return "—";
  return v.toFixed(decimals);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

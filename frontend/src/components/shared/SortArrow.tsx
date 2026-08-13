import type { SortDir } from "@/lib/useSort";

/** Drop inline next to a header label. Neutral ↕ when this column isn't the
 * active sort; ▲/▼ pointing the actual current direction once it is. */
export function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className="inline-block w-2.5 text-[9px] opacity-60 ml-0.5">
      {active ? (dir === "desc" ? "▼" : "▲") : "↕"}
    </span>
  );
}

/** Shared className for a clickable, sortable header cell. */
export const SORTABLE_TH_CLASS = "cursor-pointer select-none hover:text-foreground transition-colors";

"use client";
import { useCallback, useMemo, useState } from "react";

export type SortDir = "asc" | "desc";

/** Nulls/undefined/NaN always sort last, regardless of direction. Numbers
 * compare numerically; everything else compares as a locale-aware string. */
export function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const aNil = a === null || a === undefined || (typeof a === "number" && Number.isNaN(a)) || a === "";
  const bNil = b === null || b === undefined || (typeof b === "number" && Number.isNaN(b)) || b === "";
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;

  let cmp: number;
  if (typeof a === "number" && typeof b === "number") {
    cmp = a - b;
  } else if (typeof a === "boolean" && typeof b === "boolean") {
    cmp = a === b ? 0 : a ? -1 : 1;
  } else {
    cmp = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  }
  return dir === "asc" ? cmp : -cmp;
}

/**
 * Click-to-sort state for a table. First click on a column defaults to
 * high-to-low (desc) since that's usually the more useful starting order for
 * the numeric columns in these scanners (biggest gain/upside/rally first);
 * the second click on the same column flips to low-to-high.
 */
export function useSort<T>(rows: T[], getValue: (row: T, key: string) => unknown) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = useCallback((key: string, initialDir: SortDir = "desc") => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
        return prevKey;
      }
      setSortDir(initialDir);
      return key;
    });
  }, []);

  /** Drop back to whatever baseline ordering `rows` already came in (e.g. a
   * table's own hardcoded "default" sort) instead of a column-click sort. */
  const clearSort = useCallback(() => setSortKey(null), []);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    // Stable sort: pair with original index so equal-valued rows keep order.
    return rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => {
        const cmp = compareValues(getValue(a.row, sortKey), getValue(b.row, sortKey), sortDir);
        return cmp !== 0 ? cmp : a.i - b.i;
      })
      .map((x) => x.row);
  }, [rows, sortKey, sortDir, getValue]);

  return { sorted, sortKey, sortDir, toggleSort, clearSort };
}

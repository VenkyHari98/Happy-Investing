import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";

interface Props {
  yearlyReturns: Record<string, number>;
}

export function YearlyReturns({ yearlyReturns }: Props) {
  const years = Object.keys(yearlyReturns).sort();

  return (
    <div>
      <h3 className="text-sm font-medium text-muted-foreground mb-2">Year-by-Year Returns</h3>
      <div className="flex flex-wrap gap-2">
        {years.map((year) => {
          const ret = yearlyReturns[year];
          return (
            <Tip key={year} content={`${year} annual return — calculated from Jan 1 to Dec 31 of that year`} below>
              <div
                className={cn(
                  "flex flex-col items-center px-3 py-2 rounded border min-w-[64px]",
                  ret > 0
                    ? "border-green-500/30 bg-green-500/10"
                    : ret < 0
                    ? "border-red-500/30 bg-red-500/10"
                    : "border-border bg-muted/20"
                )}
              >
                <span className="text-xs text-muted-foreground">{year}</span>
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    ret > 0 ? "text-green-400" : ret < 0 ? "text-red-400" : "text-muted-foreground"
                  )}
                >
                  {ret > 0 ? "+" : ""}
                  {ret.toFixed(1)}%
                </span>
              </div>
            </Tip>
          );
        })}
      </div>
    </div>
  );
}

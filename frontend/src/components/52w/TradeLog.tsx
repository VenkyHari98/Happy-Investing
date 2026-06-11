import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { type Trade } from "@/lib/types";
import { fmtCur, fmtPct, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TradeLogProps {
  trades: Trade[];
}

export function TradeLog({ trades }: TradeLogProps) {
  if (trades.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No completed trades</p>;
  }

  return (
    <div className="rounded-md border border-border overflow-auto max-h-72">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Entry</TableHead>
            <TableHead>Exit</TableHead>
            <TableHead className="text-right">Entry ₹</TableHead>
            <TableHead className="text-right">Exit ₹</TableHead>
            <TableHead className="text-right">P/L %</TableHead>
            <TableHead className="text-right">Net P/L</TableHead>
            <TableHead className="text-right">Days</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((t, i) => (
            <TableRow key={i} className="hover:bg-muted/30">
              <TableCell className="text-xs tabular-nums">{fmtDate(t.entry_date)}</TableCell>
              <TableCell className="text-xs tabular-nums">{fmtDate(t.exit_date)}</TableCell>
              <TableCell className="text-right tabular-nums text-xs">{fmtCur(t.entry_price)}</TableCell>
              <TableCell className="text-right tabular-nums text-xs">{fmtCur(t.exit_price)}</TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums text-xs font-medium",
                  t.pnl_pct >= 0 ? "text-green-400" : "text-red-400"
                )}
              >
                {fmtPct(t.pnl_pct)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums text-xs",
                  t.net_pnl >= 0 ? "text-green-400" : "text-red-400"
                )}
              >
                {fmtCur(t.net_pnl)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                {t.trade_duration_days}d
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs",
                    t.exit_reason?.includes("target")
                      ? "border-green-500/30 text-green-400"
                      : "border-muted text-muted-foreground"
                  )}
                >
                  {t.exit_reason?.replace(/_/g, " ") ?? "—"}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

import { Card, CardContent } from "@/components/ui/card";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  tooltip?: string;
  variant?: "default" | "green" | "red" | "amber" | "accent";
}

function MetricCard({ label, value, sub, tooltip, variant = "default" }: MetricCardProps) {
  const valueClass = cn({
    "text-green-400": variant === "green",
    "text-red-400": variant === "red",
    "text-amber-400": variant === "amber",
    "text-blue-400": variant === "accent",
    "text-foreground": variant === "default",
  });
  const card = (
    <Card className="bg-card/60">
      <CardContent className="px-4 py-3">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={cn("text-xl font-semibold tabular-nums", valueClass)}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );

  if (!tooltip) return card;
  return (
    <Tip content={tooltip} className="w-full">
      {card}
    </Tip>
  );
}

export interface MetricDef {
  label: string;
  value: string | number;
  sub?: string;
  tooltip?: string;
  variant?: MetricCardProps["variant"];
}

export function MetricCards({ metrics }: { metrics: MetricDef[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
      {metrics.map((m) => (
        <MetricCard key={m.label} {...m} />
      ))}
    </div>
  );
}

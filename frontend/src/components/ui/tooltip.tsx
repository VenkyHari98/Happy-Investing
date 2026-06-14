import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TipProps {
  content: string;
  children: ReactNode;
  className?: string;
  /** Position the tooltip below the element instead of above */
  below?: boolean;
  /** Position the tooltip to the right of the element (e.g. sidebar nav) */
  right?: boolean;
}

/**
 * Lightweight CSS-only tooltip. Wraps any element; shows text on hover.
 * No JS, no Radix, no dependencies.
 */
export function Tip({ content, children, className, below = false, right = false }: TipProps) {
  return (
    <span className={cn("group/tip relative", right ? "block" : "inline-flex", className)}>
      {children}
      <span
        className={cn(
          "pointer-events-none absolute z-50",
          "opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150",
          "w-max max-w-[240px] rounded-md",
          "bg-zinc-900 border border-zinc-700",
          "px-2.5 py-1.5 text-[11px] leading-relaxed text-zinc-200 shadow-lg whitespace-normal text-center",
          right
            ? "left-full ml-2 top-1/2 -translate-y-1/2"
            : below
            ? "top-full mt-1.5 left-1/2 -translate-x-1/2"
            : "bottom-full mb-1.5 left-1/2 -translate-x-1/2",
        )}
      >
        {content}
      </span>
    </span>
  );
}

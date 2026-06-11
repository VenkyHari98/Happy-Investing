"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrendingUp, BarChart2, Activity, Layers, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/",        label: "Overview",       icon: LayoutDashboard },
  { href: "/52w",     label: "52W Low→High",   icon: TrendingUp },
  { href: "/envelope",label: "Envelope",       icon: Activity },
  { href: "/s200",    label: "20% Rally",      icon: BarChart2 },
  { href: "/scanner", label: "Multi-Strategy", icon: Layers },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="flex flex-col w-56 shrink-0 h-screen border-r border-border bg-card">
      <div className="px-4 py-5 border-b border-border">
        <span className="text-sm font-semibold tracking-wide text-primary">Happy Investing</span>
        <p className="text-xs text-muted-foreground mt-0.5">F40 · S200 · NSE India</p>
      </div>
      <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-4 py-2.5 text-sm rounded-none transition-colors",
              path === href
                ? "bg-primary/10 text-primary font-medium border-l-2 border-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
        F40 · E40 · 20% Rally
      </div>
    </aside>
  );
}

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon: LucideIcon;
  trend?: "up" | "down" | "neutral";
  highlight?: boolean;
  loading?: boolean;
}

export function MetricCard({
  label,
  value,
  subtext,
  icon: Icon,
  trend,
  highlight = false,
  loading = false,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border p-5 flex flex-col gap-3 transition-all",
        "bg-[hsl(0,0%,7%)] border-[hsl(0,0%,12%)]",
        highlight && "border-sky-500/40 bg-sky-950/20"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          {label}
        </span>
        <Icon
          size={16}
          className={cn(
            "text-zinc-500",
            highlight && "text-sky-400"
          )}
        />
      </div>

      {loading ? (
        <div className="h-8 w-20 rounded bg-zinc-800 animate-pulse" />
      ) : (
        <div className="flex items-end gap-2">
          <span className="text-3xl font-bold tabular-nums leading-none">
            {value}
          </span>
          {trend && (
            <span
              className={cn(
                "text-xs pb-0.5 font-medium",
                trend === "up" && "text-green-400",
                trend === "down" && "text-red-400",
                trend === "neutral" && "text-zinc-500"
              )}
            >
              {trend === "up" ? "↑" : trend === "down" ? "↓" : "—"}
            </span>
          )}
        </div>
      )}

      {subtext && (
        <span className="text-xs text-zinc-500">{subtext}</span>
      )}
    </div>
  );
}

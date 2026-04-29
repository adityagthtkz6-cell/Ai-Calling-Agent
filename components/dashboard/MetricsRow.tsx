"use client";

import {
  Phone, Users, Zap, Database,
  DollarSign, Clock,
} from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import type { DashboardMetrics } from "@/lib/hooks/useMetrics";
import { formatDuration } from "@/lib/utils";

interface MetricsRowProps {
  metrics: DashboardMetrics;
  loading: boolean;
}

export function MetricsRow({ metrics, loading }: MetricsRowProps) {
  const cacheColor =
    metrics.cacheHitRate >= 70
      ? "↑"
      : metrics.cacheHitRate >= 40
      ? "—"
      : "↓";

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
      <MetricCard
        label="Calls Today"
        value={metrics.callsToday}
        icon={Phone}
        loading={loading}
        highlight={metrics.callsToday > 0}
      />
      <MetricCard
        label="Leads Qualified"
        value={metrics.leadsQualified}
        icon={Users}
        loading={loading}
        trend={metrics.leadsQualified > 0 ? "up" : "neutral"}
        highlight={metrics.leadsQualified > 0}
      />
      <MetricCard
        label="Follow-Up Rate"
        value={`${metrics.followUpRate}%`}
        subtext="of qualified leads"
        icon={Zap}
        loading={loading}
        trend={metrics.followUpRate >= 80 ? "up" : metrics.followUpRate >= 50 ? "neutral" : "down"}
      />
      <MetricCard
        label="Cache Hit Rate"
        value={`${metrics.cacheHitRate}%`}
        subtext="embeddings served from Redis"
        icon={Database}
        loading={loading}
        trend={cacheColor === "↑" ? "up" : cacheColor === "↓" ? "down" : "neutral"}
        highlight={metrics.cacheHitRate >= 70}
      />
      <MetricCard
        label="LLM Cost Today"
        value={`$${metrics.estimatedLLMCostToday.toFixed(4)}`}
        subtext="<$100/month target"
        icon={DollarSign}
        loading={loading}
        trend={metrics.estimatedLLMCostToday < 3 ? "neutral" : "down"}
      />
      <MetricCard
        label="Avg Call Duration"
        value={formatDuration(metrics.avgCallDurationSeconds)}
        icon={Clock}
        loading={loading}
      />
    </div>
  );
}

"use client";

import { use, useState, useCallback } from "react";
import {
  Activity, Radio, RefreshCw,
} from "lucide-react";
import { useLiveCallLog } from "@/lib/hooks/useLiveCallLog";
import { useMetrics } from "@/lib/hooks/useMetrics";
import { MetricsRow } from "@/components/dashboard/MetricsRow";
import { CallLogTable } from "@/components/dashboard/CallLogTable";
import { KnowledgeBasePanel } from "@/components/dashboard/KnowledgeBasePanel";
import { BrainDumpForm } from "@/components/dashboard/BrainDumpForm";
import { cn } from "@/lib/utils";

interface PageProps {
  params: Promise<{ clientId: string }>;
}

export default function DashboardPage({ params }: PageProps) {
  const { clientId } = use(params);

  const { callLogs, loading: callsLoading, refetch: refetchCalls } = useLiveCallLog(clientId);
  const { metrics, loading: metricsLoading, refetch: refetchMetrics } = useMetrics(clientId);

  const [activeTab, setActiveTab] = useState<"calls" | "knowledge">("calls");
  const [kbRefreshKey, setKbRefreshKey] = useState(0);

  const handleBrainDumpSuccess = useCallback(() => {
    setKbRefreshKey((k) => k + 1);
    refetchMetrics();
  }, [refetchMetrics]);

  function handleRefreshAll() {
    refetchCalls();
    refetchMetrics();
  }

  return (
    <div className="min-h-screen bg-[hsl(0,0%,4%)]">
      {/* Top nav */}
      <header className="sticky top-0 z-30 border-b border-[hsl(0,0%,10%)] bg-[hsl(0,0%,4%)/90%] backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio size={18} className="text-sky-400" />
            <span className="font-semibold text-sm tracking-tight">
              Mission Control
            </span>
            <span className="text-xs font-mono text-zinc-600 hidden sm:block">
              client:{clientId.slice(0, 8)}…
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Live indicator */}
            <div className="flex items-center gap-1.5">
              <span className="pulse-dot" />
              <span className="text-xs text-zinc-500">Live</span>
            </div>

            <button
              onClick={handleRefreshAll}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded hover:bg-white/[0.04]"
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* Metrics row */}
        <section>
          <MetricsRow metrics={metrics} loading={metricsLoading} />
        </section>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-[hsl(0,0%,7%)] border border-[hsl(0,0%,12%)] w-fit">
          {(["calls", "knowledge"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all capitalize",
                activeTab === tab
                  ? "bg-white/[0.08] text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {tab === "calls" ? (
                <span className="flex items-center gap-1.5">
                  <Activity size={13} />
                  Call Log
                  {callLogs.length > 0 && (
                    <span className="text-xs bg-sky-500/20 text-sky-400 px-1.5 py-0.5 rounded-full tabular-nums">
                      {callLogs.length}
                    </span>
                  )}
                </span>
              ) : (
                "Knowledge Base"
              )}
            </button>
          ))}
        </div>

        {/* Call Log tab */}
        {activeTab === "calls" && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-300">
                Recent Calls
                <span className="ml-2 text-xs font-normal text-zinc-600">
                  — updates in real-time via Supabase Realtime
                </span>
              </h2>
            </div>
            <CallLogTable callLogs={callLogs} loading={callsLoading} />
          </section>
        )}

        {/* Knowledge Base tab */}
        {activeTab === "knowledge" && (
          <section className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
              <KnowledgeBasePanel
                key={kbRefreshKey}
                clientId={clientId}
              />
              <BrainDumpForm
                clientId={clientId}
                onSuccess={handleBrainDumpSuccess}
              />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

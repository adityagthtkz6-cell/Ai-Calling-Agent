"use client";

import { useEffect, useState, useCallback } from "react";
import { browserClient } from "../supabase/client";

// ============================================================
// useMetrics
// Derives dashboard KPIs from Supabase data.
// Refreshes every 30s + on Realtime lead events.
// ============================================================

export interface DashboardMetrics {
  callsToday: number;
  leadsQualified: number;
  followUpRate: number;        // % of qualified leads with at least 1 touch sent
  cacheHitRate: number;        // % across all today's calls
  estimatedLLMCostToday: number;
  avgCallDurationSeconds: number;
  kbLastUpdatedAt: string | null;
  kbDocumentCount: number;
}

const EMPTY: DashboardMetrics = {
  callsToday: 0,
  leadsQualified: 0,
  followUpRate: 0,
  cacheHitRate: 0,
  estimatedLLMCostToday: 0,
  avgCallDurationSeconds: 0,
  kbLastUpdatedAt: null,
  kbDocumentCount: 0,
};

export function useMetrics(clientId: string) {
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY);
  const [loading, setLoading] = useState(true);

  const compute = useCallback(async () => {
    if (!clientId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = browserClient as any;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    const [callsRes, leadsRes, followUpRes, kbRes] = await Promise.all([
      db.from("call_logs")
        .select("duration_seconds, llm_cost_usd, cache_hits, cache_misses")
        .eq("client_id", clientId)
        .gte("created_at", todayISO),

      db.from("leads")
        .select("status, qualifier_score")
        .eq("client_id", clientId)
        .gte("created_at", todayISO),

      db.from("follow_up_sequences")
        .select("status, lead_id")
        .eq("client_id", clientId)
        .eq("touch_number", 1),

      db.from("kb_documents")
        .select("last_updated")
        .eq("client_id", clientId)
        .order("last_updated", { ascending: false })
        .limit(1),
    ]);

    const calls = callsRes.data ?? [];
    const leads = leadsRes.data ?? [];
    const touches = followUpRes.data ?? [];
    const kbDocs = kbRes.data ?? [];

    const callsToday = calls.length;
    const leadsQualified = leads.filter(
      (l: { status: string }) => l.status === "qualified" || l.status === "booked"
    ).length;

    const touchesSent = touches.filter(
      (t: { status: string }) => t.status === "sent" || t.status === "replied"
    ).length;
    const followUpRate = leadsQualified > 0
      ? Math.round((touchesSent / leadsQualified) * 100)
      : 0;

    const totalHits = calls.reduce((s: number, c: { cache_hits: number }) => s + (c.cache_hits ?? 0), 0);
    const totalMisses = calls.reduce((s: number, c: { cache_misses: number }) => s + (c.cache_misses ?? 0), 0);
    const cacheHitRate = totalHits + totalMisses > 0
      ? Math.round((totalHits / (totalHits + totalMisses)) * 100)
      : 0;

    const estimatedLLMCostToday = calls.reduce(
      (s: number, c: { llm_cost_usd: number | null }) => s + (c.llm_cost_usd ?? 0),
      0
    );

    const durationsWithValue = calls.filter((c: { duration_seconds: number | null }) => c.duration_seconds);
    const avgCallDurationSeconds = durationsWithValue.length > 0
      ? Math.round(
          durationsWithValue.reduce((s: number, c: { duration_seconds: number }) => s + c.duration_seconds, 0) /
          durationsWithValue.length
        )
      : 0;

    setMetrics({
      callsToday,
      leadsQualified,
      followUpRate,
      cacheHitRate,
      estimatedLLMCostToday,
      avgCallDurationSeconds,
      kbLastUpdatedAt: kbDocs[0]?.last_updated ?? null,
      kbDocumentCount: kbDocs.length,
    });
    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    compute();
    const interval = setInterval(compute, 30000);

    // Refresh on new leads
    const channel = browserClient
      .channel(`metrics:${clientId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "leads",
        filter: `client_id=eq.${clientId}`,
      }, () => compute())
      .subscribe();

    return () => {
      clearInterval(interval);
      browserClient.removeChannel(channel);
    };
  }, [clientId, compute]);

  return { metrics, loading, refetch: compute };
}

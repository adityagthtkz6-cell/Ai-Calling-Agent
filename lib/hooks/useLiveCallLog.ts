"use client";

import { useEffect, useState, useCallback } from "react";
import { browserClient } from "../supabase/client";
import type { Database } from "../supabase/types";

// ============================================================
// useLiveCallLog
// Subscribes to Supabase Realtime on call_logs for a given client.
// New rows appear in <1 second (Realtime INSERT event).
// Also fetches initial page of recent calls on mount.
// ============================================================

type CallLog = Database["public"]["Tables"]["call_logs"]["Row"];

const PAGE_SIZE = 50;

export function useLiveCallLog(clientId: string) {
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: fetchError } = await (browserClient as any)
      .from("call_logs")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setCallLogs((data as CallLog[]) ?? []);
    }
    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    fetchInitial();

    // Subscribe to Realtime inserts + updates
    const channel = browserClient
      .channel(`call_logs:${clientId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "call_logs",
          filter: `client_id=eq.${clientId}`,
        },
        (payload) => {
          setCallLogs((prev) => [payload.new as CallLog, ...prev].slice(0, PAGE_SIZE));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "call_logs",
          filter: `client_id=eq.${clientId}`,
        },
        (payload) => {
          setCallLogs((prev) =>
            prev.map((log) =>
              log.id === (payload.new as CallLog).id
                ? (payload.new as CallLog)
                : log
            )
          );
        }
      )
      .subscribe();

    return () => {
      browserClient.removeChannel(channel);
    };
  }, [clientId, fetchInitial]);

  return { callLogs, loading, error, refetch: fetchInitial };
}

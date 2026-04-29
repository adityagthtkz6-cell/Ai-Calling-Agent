"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Phone, MessageSquare } from "lucide-react";
import { cn, formatDuration, formatRelativeTime, OUTCOME_LABEL } from "@/lib/utils";
import type { Database } from "@/lib/supabase/types";

type CallLog = Database["public"]["Tables"]["call_logs"]["Row"];

interface CallLogTableProps {
  callLogs: CallLog[];
  loading: boolean;
}

export function CallLogTable({ callLogs, loading }: CallLogTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="rounded-xl border border-[hsl(0,0%,12%)] bg-[hsl(0,0%,7%)] p-6">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-zinc-800/50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (callLogs.length === 0) {
    return (
      <div className="rounded-xl border border-[hsl(0,0%,12%)] bg-[hsl(0,0%,7%)] p-12 text-center">
        <Phone size={32} className="mx-auto mb-3 text-zinc-600" />
        <p className="text-zinc-400 text-sm">No calls yet today</p>
        <p className="text-zinc-600 text-xs mt-1">
          Calls will appear here in real-time as Retell webhook fires
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[hsl(0,0%,12%)] bg-[hsl(0,0%,7%)] overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[1fr_120px_80px_80px_80px_36px] gap-4 px-4 py-3 border-b border-[hsl(0,0%,12%)] text-xs font-medium text-zinc-500 uppercase tracking-wider">
        <span>Caller</span>
        <span>Time</span>
        <span>Duration</span>
        <span>Outcome</span>
        <span>Cached</span>
        <span />
      </div>

      {/* Rows */}
      <div className="divide-y divide-[hsl(0,0%,10%)]">
        {callLogs.map((log) => {
          const isExpanded = expandedId === log.id;
          const outcome = OUTCOME_LABEL[log.outcome ?? ""] ?? { label: log.outcome ?? "—", color: "text-zinc-400" };
          const totalReqs = (log.cache_hits ?? 0) + (log.cache_misses ?? 0);
          const hitPct = totalReqs > 0
            ? Math.round(((log.cache_hits ?? 0) / totalReqs) * 100)
            : null;

          return (
            <div key={log.id}>
              {/* Main row */}
              <button
                className={cn(
                  "w-full grid grid-cols-[1fr_120px_80px_80px_80px_36px] gap-4 px-4 py-3",
                  "text-left text-sm hover:bg-white/[0.02] transition-colors",
                  isExpanded && "bg-white/[0.02]"
                )}
                onClick={() => setExpandedId(isExpanded ? null : log.id)}
              >
                <span className="font-mono text-zinc-300 truncate">
                  {log.caller_number ?? "—"}
                </span>
                <span className="text-zinc-500 text-xs">
                  {log.created_at ? formatRelativeTime(log.created_at) : "—"}
                </span>
                <span className="text-zinc-300 tabular-nums">
                  {formatDuration(log.duration_seconds)}
                </span>
                <span className={cn("font-medium", outcome.color)}>
                  {outcome.label}
                </span>
                <span className={cn(
                  "text-xs tabular-nums",
                  hitPct !== null && hitPct >= 70 ? "text-green-400" :
                  hitPct !== null && hitPct >= 40 ? "text-yellow-400" :
                  "text-zinc-500"
                )}>
                  {hitPct !== null ? `${hitPct}%` : "—"}
                </span>
                <span className="flex items-center justify-center text-zinc-600">
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              </button>

              {/* Transcript drawer */}
              {isExpanded && (
                <div className="px-4 pb-4 bg-[hsl(0,0%,5%)] border-t border-[hsl(0,0%,10%)]">
                  <div className="mt-3 flex items-center gap-2 mb-2">
                    <MessageSquare size={13} className="text-zinc-500" />
                    <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                      Transcript
                    </span>
                    {log.retell_call_id && (
                      <span className="ml-auto text-xs font-mono text-zinc-600">
                        {log.retell_call_id}
                      </span>
                    )}
                  </div>
                  {log.transcript ? (
                    <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto rounded bg-black/30 p-3">
                      {log.transcript}
                    </pre>
                  ) : (
                    <p className="text-xs text-zinc-600 italic">
                      No transcript available — call may still be in progress or transcript is pending from Retell
                    </p>
                  )}

                  {/* Cache stats */}
                  <div className="mt-3 flex gap-4 text-xs text-zinc-500">
                    <span>Cache hits: <span className="text-green-400">{log.cache_hits ?? 0}</span></span>
                    <span>Cache misses: <span className="text-yellow-400">{log.cache_misses ?? 0}</span></span>
                    {log.llm_tokens_used && (
                      <span>Tokens: <span className="text-zinc-300">{log.llm_tokens_used.toLocaleString()}</span></span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

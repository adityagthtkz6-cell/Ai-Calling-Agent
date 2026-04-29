"use client";

import { useState, useEffect, useCallback } from "react";
import { BookOpen, ChevronDown, ChevronRight, RefreshCw, AlertTriangle } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { browserClient } from "@/lib/supabase/client";

interface KBDocument {
  id: string;
  title: string;
  source_type: string;
  chunk_count: number | null;
  last_updated: string | null;
  source_url: string | null;
}

interface KBChunk {
  id: string;
  chunk_index: number;
  content: string;
  token_count: number | null;
}

const STALE_DAYS = 30;

interface KnowledgeBasePanelProps {
  clientId: string;
}

export function KnowledgeBasePanel({ clientId }: KnowledgeBasePanelProps) {
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Record<string, KBChunk[]>>({});
  const [loading, setLoading] = useState(true);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (browserClient as any)
      .from("kb_documents")
      .select("id, title, source_type, chunk_count, last_updated, source_url")
      .eq("client_id", clientId)
      .order("last_updated", { ascending: false });
    setDocuments((data ?? []) as KBDocument[]);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  const fetchChunks = useCallback(async (docId: string) => {
    if (chunks[docId]) {
      setExpandedDoc((prev) => prev === docId ? null : docId);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (browserClient as any)
      .from("kb_chunks")
      .select("id, chunk_index, content, token_count")
      .eq("document_id", docId)
      .eq("client_id", clientId)
      .order("chunk_index");
    setChunks((prev) => ({ ...prev, [docId]: (data ?? []) as KBChunk[] }));
    setExpandedDoc(docId);
  }, [chunks, clientId]);

  const isStale = (lastUpdated: string | null) => {
    if (!lastUpdated) return true;
    return (Date.now() - new Date(lastUpdated).getTime()) > STALE_DAYS * 86400000;
  };

  const SOURCE_LABELS: Record<string, string> = {
    pdf: "PDF", text: "Text", url: "URL", brain_dump: "Brain Dump",
  };

  return (
    <div className="rounded-xl border border-[hsl(0,0%,12%)] bg-[hsl(0,0%,7%)] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(0,0%,12%)]">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-sky-400" />
          <span className="text-sm font-semibold">Knowledge Base</span>
          {!loading && (
            <span className="text-xs text-zinc-500">
              {documents.length} document{documents.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <button
          onClick={fetchDocuments}
          className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded"
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {loading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-zinc-800/50 animate-pulse" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <div className="p-8 text-center text-zinc-500 text-sm">
          No documents ingested yet. Use the brain dump below to add knowledge.
        </div>
      ) : (
        <div className="divide-y divide-[hsl(0,0%,10%)]">
          {documents.map((doc) => {
            const stale = isStale(doc.last_updated);
            const isOpen = expandedDoc === doc.id;
            return (
              <div key={doc.id}>
                <button
                  onClick={() => fetchChunks(doc.id)}
                  className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-white/[0.02] transition-colors"
                >
                  <span className="text-zinc-600">
                    {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </span>
                  <span className="flex-1 text-sm font-medium text-zinc-200 truncate">
                    {doc.title}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                    {SOURCE_LABELS[doc.source_type] ?? doc.source_type}
                  </span>
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {doc.chunk_count ?? 0} chunks
                  </span>
                  {stale && (
                    <span title="Stale — not updated in 30+ days">
                      <AlertTriangle size={12} className="text-yellow-500 shrink-0" />
                    </span>
                  )}
                  <span className="text-xs text-zinc-600">
                    {doc.last_updated ? formatRelativeTime(doc.last_updated) : "never"}
                  </span>
                </button>

                {isOpen && chunks[doc.id] && (
                  <div className="bg-[hsl(0,0%,5%)] border-t border-[hsl(0,0%,10%)] px-5 py-3 max-h-72 overflow-y-auto">
                    <div className="space-y-3">
                      {chunks[doc.id].map((chunk) => (
                        <div key={chunk.id} className="text-xs">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-zinc-600 font-mono">#{chunk.chunk_index}</span>
                            {chunk.token_count && (
                              <span className="text-zinc-700">{chunk.token_count} tokens</span>
                            )}
                          </div>
                          <p className={cn(
                            "text-zinc-400 leading-relaxed font-mono",
                            "border-l-2 border-zinc-800 pl-3"
                          )}>
                            {chunk.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

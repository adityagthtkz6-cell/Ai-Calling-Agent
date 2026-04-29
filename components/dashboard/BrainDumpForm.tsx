"use client";

import { useState } from "react";
import { Brain, Send, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BrainDumpFormProps {
  clientId: string;
  onSuccess?: (documentId: string, title: string, chunks: number) => void;
}

type State = "idle" | "loading" | "success" | "error";

interface Result {
  title: string;
  documentId: string;
  chunksUpserted: number;
  normalizationTokens: number;
  embeddingTokensUsed: number;
  cacheHits: number;
  cacheMisses: number;
}

export function BrainDumpForm({ clientId, onSuccess }: BrainDumpFormProps) {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const PLACEHOLDER =
    "Type any business update in plain English…\n\n" +
    "Examples:\n" +
    "• \"We now offer Ozempic consultations at $299/month, available Mon–Fri 9am–5pm\"\n" +
    "• \"Our new location opens May 1st at 123 Main St, San Francisco\"\n" +
    "• \"We no longer accept insurance — all services are cash-pay only\"";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || text.trim().length < 10) return;

    setState("loading");
    setResult(null);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/brain-dump", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.NEXT_PUBLIC_INGEST_API_KEY ?? "",
        },
        body: JSON.stringify({ client_id: clientId, text: text.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error ?? "Unknown error");
        setState("error");
        return;
      }

      setResult(data);
      setState("success");
      setText("");
      onSuccess?.(data.documentId, data.title, data.chunksUpserted);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setState("error");
    }
  }

  return (
    <div className="rounded-xl border border-[hsl(0,0%,12%)] bg-[hsl(0,0%,7%)] overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-[hsl(0,0%,12%)]">
        <Brain size={16} className="text-purple-400" />
        <span className="text-sm font-semibold">Brain Dump</span>
        <span className="text-xs text-zinc-500 ml-1">
          — update the KB in plain English
        </span>
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (state !== "idle") setState("idle");
          }}
          placeholder={PLACEHOLDER}
          disabled={state === "loading"}
          rows={6}
          className={cn(
            "w-full rounded-lg border text-sm resize-none transition-colors",
            "bg-[hsl(0,0%,5%)] border-[hsl(0,0%,14%)] text-zinc-200 placeholder:text-zinc-600",
            "focus:outline-none focus:ring-1 focus:ring-sky-500/50 focus:border-sky-500/50",
            "p-3 leading-relaxed font-mono",
            state === "loading" && "opacity-60 cursor-not-allowed"
          )}
        />

        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-600">
            {text.length > 0 && `${text.trim().split(/\s+/).length} words`}
          </span>

          <button
            type="submit"
            disabled={state === "loading" || text.trim().length < 10}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              "bg-purple-600 hover:bg-purple-500 text-white",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              state === "loading" && "cursor-wait"
            )}
          >
            {state === "loading" ? (
              <><Loader2 size={14} className="animate-spin" /> Processing…</>
            ) : (
              <><Send size={14} /> Ingest into KB</>
            )}
          </button>
        </div>

        {/* Success */}
        {state === "success" && result && (
          <div className="flex items-start gap-3 rounded-lg bg-green-950/30 border border-green-800/30 p-3">
            <CheckCircle size={16} className="text-green-400 mt-0.5 shrink-0" />
            <div className="text-xs space-y-1">
              <p className="text-green-300 font-medium">
                Ingested: &ldquo;{result.title}&rdquo;
              </p>
              <p className="text-zinc-400">
                {result.chunksUpserted} chunk{result.chunksUpserted !== 1 ? "s" : ""} written
                · {result.cacheHits} cache hit{result.cacheHits !== 1 ? "s" : ""}
                · {result.normalizationTokens + result.embeddingTokensUsed} tokens used
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {state === "error" && errorMsg && (
          <div className="flex items-start gap-3 rounded-lg bg-red-950/30 border border-red-800/30 p-3">
            <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-300">{errorMsg}</p>
          </div>
        )}
      </form>
    </div>
  );
}

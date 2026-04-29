import { NextRequest, NextResponse } from "next/server";
import { searchKnowledgeBase } from "@/lib/supabase/ragSearch";
import { serviceClient } from "@/lib/supabase/client";

// ============================================================
// POST /api/retell/rag-tool
// Called by Retell mid-conversation when the voice agent
// invokes the search_knowledge tool.
//
// Retell sends:
//   { call: { call_id, metadata }, args: { query } }
//
// We return:
//   { result: "<top 3 chunks concatenated as plain text>" }
//
// Latency budget: must respond in <1500ms to stay under
// Retell's tool call timeout. Redis cache hit = ~5ms total.
// Cache miss = embed (~300ms) + vector search (~50ms) = ~350ms.
// Both well within budget.
// ============================================================

export async function POST(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) {
    return NextResponse.json({ result: "" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const query: string = body?.args?.query ?? body?.query ?? "";
    const callId: string = body?.call?.call_id ?? "";

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ result: "No query provided." });
    }

    const { chunks, cacheHit, tokensUsed } = await searchKnowledgeBase(
      clientId,
      query,
      3,
      0.70
    );

    if (chunks.length === 0) {
      return NextResponse.json({
        result:
          "I don't have specific information about that in my knowledge base. Let me have someone follow up with you.",
      });
    }

    // Concatenate top chunks as plain prose for the LLM
    const result = chunks
      .map((c) => c.content)
      .join("\n\n")
      .trim();

    // Log cache stats back to call_logs if we have a call_id
    if (callId) {
      updateCallLogCacheStats(clientId, callId, cacheHit, tokensUsed).catch(() => {});
    }

    return NextResponse.json({ result });
  } catch (err) {
    console.error("[/api/retell/rag-tool] error:", err);
    // Never fail hard — return empty result so the agent can recover gracefully
    return NextResponse.json({
      result: "I'm having trouble accessing that information right now. Let me have someone follow up with you.",
    });
  }
}

async function updateCallLogCacheStats(
  clientId: string,
  retellCallId: string,
  cacheHit: boolean,
  tokensUsed: number
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = serviceClient as any;
  const { data: log } = await db
    .from("call_logs")
    .select("id, cache_hits, cache_misses")
    .eq("client_id", clientId)
    .eq("retell_call_id", retellCallId)
    .maybeSingle();

  if (!log) return;

  await db
    .from("call_logs")
    .update({
      cache_hits: (log.cache_hits ?? 0) + (cacheHit ? 1 : 0),
      cache_misses: (log.cache_misses ?? 0) + (cacheHit ? 0 : 1),
      llm_tokens_used: (log.llm_tokens_used ?? 0) + tokensUsed,
    })
    .eq("id", log.id);
}

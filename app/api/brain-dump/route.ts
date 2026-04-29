import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { chunkText } from "@/lib/ingestion/chunker";
import { embedChunks } from "@/lib/ingestion/embedder";
import { upsertDocument } from "@/lib/ingestion/upsert";
import { checkRateLimit } from "@/lib/redis/rateLimiter";

// ============================================================
// POST /api/brain-dump
// The "plain English KB update" interface from the PRD.
// Client types: "we now offer Ozempic consultations at $200"
// System auto-generates a clean document title and ingests it.
//
// Flow:
//   1. Receive plain-English text from client or dashboard
//   2. Use GPT-4.1-mini to normalize + extract structured content
//   3. Run through standard chunk → embed → upsert pipeline
//   4. Return document ID + chunk count
//
// Auth: expects x-api-key header OR Supabase auth JWT (dashboard).
// ============================================================

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const INGEST_API_KEY = process.env.INGEST_API_KEY;

const NORMALIZE_SYSTEM_PROMPT = `You are a business knowledge extraction assistant.
The user will give you a plain-English business update.
Your job:
1. Extract the key factual information (services, prices, hours, policies, FAQs)
2. Write it as clean, structured prose — no bullet points, no lists
3. Generate a short document title (5 words max) that describes what was updated
4. Return ONLY valid JSON in this format:
{
  "title": "string",
  "content": "string"
}
Do not add any commentary outside the JSON.`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  if (INGEST_API_KEY && apiKey !== INGEST_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { client_id: clientId, text } = body;

    if (!clientId || !text) {
      return NextResponse.json(
        { error: "client_id and text are required" },
        { status: 400 }
      );
    }

    if (text.length < 10) {
      return NextResponse.json(
        { error: "Text too short to ingest" },
        { status: 422 }
      );
    }

    // Rate limit check
    const rateCheck = await checkRateLimit(clientId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 }
      );
    }

    // Step 1: Normalize + title generation via GPT-4.1-mini
    const normalization = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: NORMALIZE_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });

    const rawResponse = normalization.choices[0]?.message?.content ?? "{}";
    let parsed: { title?: string; content?: string };

    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse normalization response", raw: rawResponse },
        { status: 500 }
      );
    }

    const title = parsed.title ?? `Brain Dump ${new Date().toISOString().slice(0, 10)}`;
    const normalizedContent = parsed.content ?? text;

    if (!normalizedContent || normalizedContent.length < 10) {
      return NextResponse.json(
        { error: "Normalization produced empty content" },
        { status: 422 }
      );
    }

    // Step 2: Chunk → embed → upsert
    const chunks = chunkText(normalizedContent);
    const { embeddedChunks, totalTokensUsed, cacheHits, cacheMisses } =
      await embedChunks(clientId, chunks);

    const result = await upsertDocument({
      clientId,
      title,
      sourceType: "brain_dump",
      rawContent: normalizedContent,
      embeddedChunks,
    });

    return NextResponse.json({
      success: true,
      title,
      documentId: result.documentId,
      chunksUpserted: result.chunksUpserted,
      chunksReplaced: result.chunksReplaced,
      normalizationTokens: normalization.usage?.total_tokens ?? 0,
      embeddingTokensUsed: totalTokensUsed,
      cacheHits,
      cacheMisses,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/brain-dump] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

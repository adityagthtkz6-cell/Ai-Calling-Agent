import { NextRequest, NextResponse } from "next/server";
import { chunkText } from "@/lib/ingestion/chunker";
import { embedChunks } from "@/lib/ingestion/embedder";
import { upsertDocument } from "@/lib/ingestion/upsert";
import { parsePdfFromBuffer } from "@/lib/ingestion/pdfParser";
import { scrapeUrl } from "@/lib/ingestion/urlScraper";
import { checkRateLimit } from "@/lib/redis/rateLimiter";

// ============================================================
// POST /api/ingest
// Accepts: multipart/form-data OR application/json
// Fields:
//   client_id   required
//   title       required
//   type        "pdf" | "text" | "url"
//   content     text content (if type=text)
//   url         URL to scrape (if type=url)
//   file        PDF file upload (if type=pdf, multipart only)
//
// Auth: expects x-api-key header matching INGEST_API_KEY env var.
// In production this is called by your own backend / n8n only.
// ============================================================

const INGEST_API_KEY = process.env.INGEST_API_KEY;

export async function POST(req: NextRequest) {
  // Auth guard
  const apiKey = req.headers.get("x-api-key");
  if (INGEST_API_KEY && apiKey !== INGEST_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = req.headers.get("content-type") ?? "";
    let clientId: string;
    let title: string;
    let type: string;
    let content: string | undefined;
    let url: string | undefined;
    let pdfBuffer: Buffer | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      clientId = formData.get("client_id") as string;
      title = formData.get("title") as string;
      type = formData.get("type") as string;
      content = (formData.get("content") as string) ?? undefined;
      url = (formData.get("url") as string) ?? undefined;

      const file = formData.get("file") as File | null;
      if (file) {
        const arrayBuffer = await file.arrayBuffer();
        pdfBuffer = Buffer.from(arrayBuffer);
      }
    } else {
      const body = await req.json();
      clientId = body.client_id;
      title = body.title;
      type = body.type;
      content = body.content;
      url = body.url;
    }

    // Validate required fields
    if (!clientId || !title || !type) {
      return NextResponse.json(
        { error: "client_id, title, and type are required" },
        { status: 400 }
      );
    }

    // Rate limit check before any LLM call
    const rateCheck = await checkRateLimit(clientId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded", remaining: 0 },
        { status: 429 }
      );
    }

    // Extract raw text based on source type
    let rawText: string;

    if (type === "pdf") {
      if (!pdfBuffer) {
        return NextResponse.json(
          { error: "No PDF file provided for type=pdf" },
          { status: 400 }
        );
      }
      rawText = await parsePdfFromBuffer(pdfBuffer);
    } else if (type === "url") {
      if (!url) {
        return NextResponse.json(
          { error: "url field required for type=url" },
          { status: 400 }
        );
      }
      rawText = await scrapeUrl(url);
    } else if (type === "text") {
      if (!content) {
        return NextResponse.json(
          { error: "content field required for type=text" },
          { status: 400 }
        );
      }
      rawText = content;
    } else {
      return NextResponse.json(
        { error: `Unknown type: ${type}. Use pdf | text | url` },
        { status: 400 }
      );
    }

    if (!rawText || rawText.length < 20) {
      return NextResponse.json(
        { error: "Extracted text is empty or too short to ingest" },
        { status: 422 }
      );
    }

    // Chunk → embed → upsert pipeline
    const chunks = chunkText(rawText);
    const { embeddedChunks, totalTokensUsed, cacheHits, cacheMisses } =
      await embedChunks(clientId, chunks);

    const result = await upsertDocument({
      clientId,
      title,
      sourceType: type as "pdf" | "text" | "url" | "brain_dump",
      sourceUrl: url,
      rawContent: rawText,
      embeddedChunks,
    });

    return NextResponse.json({
      success: true,
      documentId: result.documentId,
      chunksUpserted: result.chunksUpserted,
      chunksReplaced: result.chunksReplaced,
      totalTokensUsed,
      cacheHits,
      cacheMisses,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/ingest] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

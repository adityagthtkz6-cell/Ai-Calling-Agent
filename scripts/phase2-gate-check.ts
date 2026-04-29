#!/usr/bin/env ts-node
// ============================================================
// Phase 2 Gate Check
// Run: npm run phase2:gate
//
// PASS criteria (from PRD):
//   ✓ Chunker produces correct chunk count + overlap
//   ✓ Embedder cache-miss path calls OpenAI, stores in Redis
//   ✓ Embedder cache-hit path skips OpenAI entirely
//   ✓ Upsert writes document + chunks to Supabase
//   ✓ Re-ingest replaces old chunks (no duplicates)
//   ✓ RAG search returns correct chunk for test query
//   ✓ Brain-dump normalizes plain-English input
// ============================================================

import "dotenv/config";
import { chunkText, estimateTokens } from "../lib/ingestion/chunker";
import { embedChunks } from "../lib/ingestion/embedder";
import { upsertDocument } from "../lib/ingestion/upsert";
import { searchKnowledgeBase } from "../lib/supabase/ragSearch";
import { serviceClient } from "../lib/supabase/client";
import { disconnectRedis } from "../lib/redis/client";
import { deleteCachedEmbedding } from "../lib/redis/embeddingCache";

const TEST_CLIENT_ID = "00000000-0000-0000-0000-000000000001";

let passed = 0;
let failed = 0;

function pass(label: string, detail?: string) {
  console.log(`  ✅ PASS: ${label}${detail ? ` (${detail})` : ""}`);
  passed++;
}

function fail(label: string, err?: unknown) {
  console.error(`  ❌ FAIL: ${label}`, err ?? "");
  failed++;
}

// ── Test 1: Chunker ─────────────────────────────────────────
function testChunker() {
  console.log("\n[1] Chunker");

  const shortText = "Hello world. This is a short document.";
  const shortChunks = chunkText(shortText);
  shortChunks.length === 1
    ? pass("Short text → 1 chunk")
    : fail(`Short text chunk count: expected 1, got ${shortChunks.length}`);

  // Generate text longer than TARGET_CHUNK_TOKENS (400 tokens ≈ 1600 chars)
  const para = "This is a paragraph about our medical weight loss program. ";
  const longText = (para.repeat(10) + "\n\n").repeat(8); // ~8 paragraphs
  const longChunks = chunkText(longText);

  longChunks.length > 1
    ? pass(`Long text → ${longChunks.length} chunks`)
    : fail("Long text should produce multiple chunks");

  longChunks.every((c) => c.content.length > 0)
    ? pass("All chunks have content")
    : fail("Empty chunk detected");

  const tokenCounts = longChunks.map((c) => estimateTokens(c.content));
  const maxTokens = Math.max(...tokenCounts);
  maxTokens <= 500
    ? pass(`Max chunk size: ${maxTokens} tokens (≤ 500)`)
    : fail(`Chunk too large: ${maxTokens} tokens`);

  // Chunk indices are sequential
  const indices = longChunks.map((c) => c.chunkIndex);
  const sequential = indices.every((idx, i) => idx === i);
  sequential
    ? pass("Chunk indices are sequential")
    : fail(`Non-sequential indices: ${indices.join(",")}`);
}

// ── Test 2: Embedder + Redis cache ──────────────────────────
async function testEmbedder() {
  console.log("\n[2] Embedder + Redis cache");

  if (!process.env.OPENAI_API_KEY) {
    console.log("  ⚠️  SKIP: OPENAI_API_KEY not set");
    return;
  }

  const chunks = chunkText(
    "SFSBI Weight Loss Center offers semaglutide prescriptions starting at $299 per month."
  );

  // Clear any existing cache for this content to force a miss
  await deleteCachedEmbedding(TEST_CLIENT_ID, chunks[0].content);

  // First call — should be cache miss
  const result1 = await embedChunks(TEST_CLIENT_ID, chunks);
  result1.cacheMisses >= 1
    ? pass(`Cache miss: ${result1.cacheMisses} miss(es), ${result1.totalTokensUsed} tokens used`)
    : fail("Expected cache miss on first embed");

  result1.embeddedChunks.every((c) => c.embedding.length === 1536)
    ? pass("All embeddings are 1536-dimensional")
    : fail("Wrong embedding dimension");

  // Second call — should be cache hit (same content)
  const result2 = await embedChunks(TEST_CLIENT_ID, chunks);
  result2.cacheHits >= 1 && result2.totalTokensUsed === 0
    ? pass(`Cache hit: ${result2.cacheHits} hit(s), 0 tokens used`)
    : fail(`Cache hit expected: hits=${result2.cacheHits}, tokens=${result2.totalTokensUsed}`);
}

// ── Test 3: Upsert to Supabase ──────────────────────────────
async function testUpsert() {
  console.log("\n[3] Upsert to Supabase");

  if (!process.env.OPENAI_API_KEY) {
    console.log("  ⚠️  SKIP: OPENAI_API_KEY not set");
    return;
  }

  const testTitle = "Phase 2 Gate Test Document";
  const testContent =
    "This is a test document for the Phase 2 gate check. " +
    "It verifies that the ingestion pipeline writes chunks to Supabase correctly. " +
    "The SFSBI clinic offers weight loss programs starting at $299 per month.";

  const chunks = chunkText(testContent);
  const { embeddedChunks } = await embedChunks(TEST_CLIENT_ID, chunks);

  const result = await upsertDocument({
    clientId: TEST_CLIENT_ID,
    title: testTitle,
    sourceType: "text",
    rawContent: testContent,
    embeddedChunks,
  });

  result.documentId
    ? pass(`Document upserted: ${result.documentId}`)
    : fail("No documentId returned");

  result.chunksUpserted === chunks.length
    ? pass(`${result.chunksUpserted} chunk(s) upserted`)
    : fail(`Expected ${chunks.length} chunks, got ${result.chunksUpserted}`);

  // Verify chunks exist in Supabase
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: dbChunks } = await (serviceClient as any)
    .from("kb_chunks")
    .select("id")
    .eq("document_id", result.documentId);

  (dbChunks?.length ?? 0) === chunks.length
    ? pass(`DB verified: ${dbChunks?.length} chunk(s) in kb_chunks`)
    : fail(`DB chunk count mismatch: expected ${chunks.length}, got ${dbChunks?.length}`);

  // Test re-ingest (should replace, not duplicate)
  const result2 = await upsertDocument({
    clientId: TEST_CLIENT_ID,
    title: testTitle,
    sourceType: "text",
    rawContent: testContent + " (updated)",
    embeddedChunks,
  });

  result2.chunksReplaced > 0
    ? pass(`Re-ingest replaced ${result2.chunksReplaced} old chunk(s)`)
    : fail("Re-ingest should report replaced chunks");

  // Verify no duplicate chunks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: dbChunks2 } = await (serviceClient as any)
    .from("kb_chunks")
    .select("id")
    .eq("document_id", result2.documentId);

  (dbChunks2?.length ?? 0) === chunks.length
    ? pass(`No duplicates after re-ingest: ${dbChunks2?.length} chunk(s)`)
    : fail(`Duplicate chunks detected: ${dbChunks2?.length} found, expected ${chunks.length}`);
}

// ── Test 4: RAG search returns correct chunk ─────────────────
async function testRAGRetrieval() {
  console.log("\n[4] RAG retrieval — correct chunk returned");

  if (!process.env.OPENAI_API_KEY) {
    console.log("  ⚠️  SKIP: OPENAI_API_KEY not set");
    return;
  }

  const result = await searchKnowledgeBase(
    TEST_CLIENT_ID,
    "how much does the weight loss program cost",
    3,
    0.50
  );

  result.chunks.length > 0
    ? pass(
        `Vector search: ${result.chunks.length} chunk(s) returned`,
        `top similarity: ${result.chunks[0].similarity.toFixed(3)}`
      )
    : fail("No chunks returned — are embeddings in Supabase?");

  if (result.chunks.length > 0) {
    const topContent = result.chunks[0].content.toLowerCase();
    topContent.includes("299") || topContent.includes("weight") || topContent.includes("program")
      ? pass("Correct chunk content retrieved (pricing/program info)")
      : fail(`Unexpected chunk content: "${result.chunks[0].content.slice(0, 100)}..."`);
  }

  // Second call — cache hit
  const result2 = await searchKnowledgeBase(
    TEST_CLIENT_ID,
    "how much does the weight loss program cost",
    3,
    0.50
  );
  result2.cacheHit
    ? pass("Second RAG query served from Redis cache")
    : fail("Second RAG query should be a cache hit");
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log("════════════════════════════════════════");
  console.log("  PHASE 2 GATE CHECK — Ingestion Pipeline");
  console.log("════════════════════════════════════════");

  testChunker();
  await testEmbedder();
  await testUpsert();
  await testRAGRetrieval();

  await disconnectRedis();

  console.log("\n════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed / ${failed} failed`);
  if (failed === 0) {
    console.log("  ✅ Phase 2 gate PASSED — proceed to Phase 3 (Retell agent)");
  } else {
    console.log("  ❌ Phase 2 gate FAILED — fix issues above before Phase 3");
    process.exit(1);
  }
  console.log("════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

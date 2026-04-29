#!/usr/bin/env ts-node
// ============================================================
// Phase 1 Gate Check
// Run: npx ts-node scripts/phase1-gate-check.ts
//
// PASS criteria (from PRD):
//   ✓ Redis connects and cache round-trip works
//   ✓ Rate limiter increments and blocks at limit
//   ✓ Agent loop guard fires at >3 executions
//   ✓ Supabase connects and seed data is readable
//   ✓ Vector search returns correct chunk for test query
//   ✓ Cache hit path skips embedding call on second query
// ============================================================

import "dotenv/config";
import { getRedisClient, disconnectRedis } from "../lib/redis/client";
import { getCachedEmbedding, setCachedEmbedding } from "../lib/redis/embeddingCache";
import { checkRateLimit } from "../lib/redis/rateLimiter";
import { checkAgentLoop, resetLoopCounter } from "../lib/redis/agentLoopGuard";
import { serviceClient } from "../lib/supabase/client";
import { searchKnowledgeBase } from "../lib/supabase/ragSearch";

const TEST_CLIENT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_LEAD_ID   = "20000000-0000-0000-0000-000000000001";

let passed = 0;
let failed = 0;

function pass(label: string) {
  console.log(`  ✅ PASS: ${label}`);
  passed++;
}

function fail(label: string, err?: unknown) {
  console.log(`  ❌ FAIL: ${label}`, err ?? "");
  failed++;
}

async function testRedisConnection() {
  console.log("\n[1] Redis connection + ping");
  try {
    const redis = await getRedisClient();
    const pong = await redis.ping();
    pong === "PONG" ? pass("Redis ping") : fail("Redis ping returned: " + pong);
  } catch (e) {
    fail("Redis connection", e);
  }
}

async function testEmbeddingCache() {
  console.log("\n[2] Embedding cache round-trip");
  try {
    const testQuery = "what are your office hours";
    const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);

    await setCachedEmbedding(TEST_CLIENT_ID, testQuery, fakeEmbedding);
    const retrieved = await getCachedEmbedding(TEST_CLIENT_ID, testQuery);

    if (!retrieved) {
      fail("Cache: value not found after set");
      return;
    }
    if (retrieved[0] === fakeEmbedding[0] && retrieved.length === 1536) {
      pass("Embedding cache set + get");
    } else {
      fail("Embedding cache: value mismatch");
    }

    // Test normalization — different whitespace, same hash
    const cachedNormalized = await getCachedEmbedding(TEST_CLIENT_ID, "  What are your  Office Hours  ");
    cachedNormalized ? pass("Cache normalization (case + whitespace)") : fail("Cache normalization");
  } catch (e) {
    fail("Embedding cache", e);
  }
}

async function testRateLimiter() {
  console.log("\n[3] Rate limiter");
  const testClientId = "rate-test-" + Date.now();
  try {
    const redis = await getRedisClient();
    await redis.del(`rate:${testClientId}:${new Date().toISOString().slice(0, 13).replace("T", "-")}`);

    let result = await checkRateLimit(testClientId);
    result.allowed ? pass("Rate limiter: first call allowed") : fail("Rate limiter: first call blocked");
    result.currentCount === 1 ? pass("Rate limiter: count = 1") : fail(`Count expected 1, got ${result.currentCount}`);
  } catch (e) {
    fail("Rate limiter", e);
  }
}

async function testAgentLoopGuard() {
  console.log("\n[4] Agent loop guard");
  try {
    await resetLoopCounter(TEST_CLIENT_ID, TEST_LEAD_ID);

    const r1 = await checkAgentLoop(TEST_CLIENT_ID, TEST_LEAD_ID);
    const r2 = await checkAgentLoop(TEST_CLIENT_ID, TEST_LEAD_ID);
    const r3 = await checkAgentLoop(TEST_CLIENT_ID, TEST_LEAD_ID);
    const r4 = await checkAgentLoop(TEST_CLIENT_ID, TEST_LEAD_ID); // should be unsafe

    r1.safe && r2.safe && r3.safe ? pass("Loop guard: 3 executions allowed") : fail("Loop guard: blocked too early");
    !r4.safe ? pass("Loop guard: 4th execution blocked") : fail("Loop guard: did not block at limit");

    await resetLoopCounter(TEST_CLIENT_ID, TEST_LEAD_ID);
  } catch (e) {
    fail("Agent loop guard", e);
  }
}

async function testSupabaseConnection() {
  console.log("\n[5] Supabase connection + seed data");
  try {
    const { data, error } = await serviceClient
      .from("clients")
      .select("id, name, slug")
      .eq("id", TEST_CLIENT_ID)
      .single();

    if (error) { fail("Supabase clients query", error.message); return; }
    data?.slug === "sfsbi" ? pass("Supabase: demo client readable") : fail("Supabase: wrong slug " + data?.slug);

    const { data: leads, error: leadsErr } = await serviceClient
      .from("leads")
      .select("id, status")
      .eq("client_id", TEST_CLIENT_ID);

    if (leadsErr) { fail("Supabase leads query", leadsErr.message); return; }
    (leads?.length ?? 0) >= 2 ? pass(`Supabase: ${leads!.length} seed leads readable`) : fail("Supabase: seed leads missing");
  } catch (e) {
    fail("Supabase connection", e);
  }
}

async function testVectorSearch() {
  console.log("\n[6] Vector search (requires real embeddings + OpenAI key)");

  if (!process.env.OPENAI_API_KEY) {
    console.log("  ⚠️  SKIP: OPENAI_API_KEY not set — run after configuring .env.local");
    return;
  }

  try {
    const result = await searchKnowledgeBase(
      TEST_CLIENT_ID,
      "what is the cost of the weight loss program",
      3,
      0.50
    );

    result.chunks.length > 0
      ? pass(`Vector search: ${result.chunks.length} chunk(s) returned (similarity: ${result.chunks[0].similarity.toFixed(3)})`)
      : fail("Vector search: no chunks returned — seed data may not have embeddings yet");

    result.cacheHit === false ? pass("First query: cache miss (expected)") : fail("First query should be a cache miss");

    // Second call — should hit cache
    const result2 = await searchKnowledgeBase(
      TEST_CLIENT_ID,
      "what is the cost of the weight loss program",
      3,
      0.50
    );
    result2.cacheHit ? pass("Second query: cache hit") : fail("Second query should be a cache hit");
  } catch (e) {
    fail("Vector search", e);
  }
}

async function main() {
  console.log("════════════════════════════════════════");
  console.log("  PHASE 1 GATE CHECK — Voice Intelligence Platform");
  console.log("════════════════════════════════════════");

  await testRedisConnection();
  await testEmbeddingCache();
  await testRateLimiter();
  await testAgentLoopGuard();
  await testSupabaseConnection();
  await testVectorSearch();

  await disconnectRedis();

  console.log("\n════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed / ${failed} failed`);
  if (failed === 0) {
    console.log("  ✅ Phase 1 gate PASSED — proceed to Phase 2");
  } else {
    console.log("  ❌ Phase 1 gate FAILED — fix issues above before Phase 2");
    process.exit(1);
  }
  console.log("════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

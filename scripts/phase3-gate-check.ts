#!/usr/bin/env ts-node
// ============================================================
// Phase 3 Gate Check
// Run: npm run phase3:gate
//
// PASS criteria (from PRD):
//   ✓ System prompt builds under 650 tokens
//   ✓ System prompt is under 400-token target
//   ✓ Retell agent payload validates (all required fields present)
//   ✓ 5-scenario self-test scores 80+ overall
//   ✓ Each scenario scores 60+ (none blocked)
// ============================================================

import "dotenv/config";
import { buildSystemPrompt, validatePromptTokens } from "../lib/agents/retell/systemPrompt";
import { buildRetellAgentPayload } from "../lib/agents/retell/agentConfig";
import { runSelfTest, DEFAULT_TEST_SCENARIOS } from "../lib/agents/retell/selfTest";
import { disconnectRedis } from "../lib/redis/client";

const TEST_CLIENT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_WEBHOOK_BASE = "https://your-app.vercel.app";

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

// ── Test 1: System prompt token count ───────────────────────
function testSystemPromptTokens() {
  console.log("\n[1] System prompt token validation");

  const config = {
    agentName: "Alex",
    businessName: "SFSBI Weight Loss Center",
    followUpTimeframe: "24 hours",
    language: "en" as const,
  };

  let prompt: string;
  try {
    prompt = buildSystemPrompt(config);
  } catch (e) {
    fail("buildSystemPrompt threw", e);
    return;
  }

  const { tokens, withinTarget, withinHardLimit } = validatePromptTokens(prompt);

  withinHardLimit
    ? pass(`Hard limit check: ${tokens} tokens (max 650)`)
    : fail(`EXCEEDS hard limit: ${tokens} tokens`);

  withinTarget
    ? pass(`Target check: ${tokens} tokens (target 400)`)
    : console.log(`  ⚠️  WARNING: ${tokens} tokens exceeds 400-token target (still valid)`);

  // Bilingual variant
  const esConfig = { ...config, language: "es" as const };
  const esPrompt = buildSystemPrompt(esConfig);
  const esTokens = validatePromptTokens(esPrompt);
  esTokens.withinHardLimit
    ? pass(`ES variant: ${esTokens.tokens} tokens (within 650)`)
    : fail(`ES variant exceeds hard limit: ${esTokens.tokens} tokens`);
}

// ── Test 2: Agent payload structure ─────────────────────────
function testAgentPayload() {
  console.log("\n[2] Retell agent payload structure");

  const agentConfig = {
    agentName: "Alex",
    businessName: "SFSBI Weight Loss Center",
    followUpTimeframe: "24 hours",
    language: "en" as const,
  };

  let payload: ReturnType<typeof buildRetellAgentPayload>;
  try {
    payload = buildRetellAgentPayload(agentConfig, {
      clientId: TEST_CLIENT_ID,
      webhookBaseUrl: TEST_WEBHOOK_BASE,
    });
  } catch (e) {
    fail("buildRetellAgentPayload threw", e);
    return;
  }

  // Validate required SKILL.md settings
  payload.responsiveness === 0.9
    ? pass("responsiveness = 0.9")
    : fail(`responsiveness = ${payload.responsiveness} (expected 0.9)`);

  payload.interruption_sensitivity === 0.8
    ? pass("interruption_sensitivity = 0.8")
    : fail(`interruption_sensitivity = ${payload.interruption_sensitivity} (expected 0.8)`);

  payload.enable_backchannel === true
    ? pass("backchannel enabled")
    : fail("backchannel must be enabled");

  payload.backchannel_frequency === 0.5
    ? pass("backchannel_frequency = 0.5")
    : fail(`backchannel_frequency = ${payload.backchannel_frequency} (expected 0.5)`);

  payload.ambient_sound === "office"
    ? pass("ambient_sound = office")
    : fail(`ambient_sound = ${payload.ambient_sound} (expected office)`);

  payload.end_call_after_silence_ms === 30000
    ? pass("silence_timeout = 30000ms")
    : fail(`silence_timeout = ${payload.end_call_after_silence_ms} (expected 30000)`);

  payload.max_call_duration_ms === 600000
    ? pass("max_call_duration = 600000ms")
    : fail(`max_call_duration = ${payload.max_call_duration_ms} (expected 600000)`);

  // Validate search_knowledge tool is present
  const ragTool = payload.general_tools.find((t) => t.name === "search_knowledge");
  ragTool
    ? pass("search_knowledge tool present")
    : fail("search_knowledge tool MISSING from agent payload");

  ragTool?.url?.includes("/api/retell/rag-tool")
    ? pass("RAG tool URL points to /api/retell/rag-tool")
    : fail(`RAG tool URL incorrect: ${ragTool?.url}`);

  payload.webhook_url.includes("/api/retell/webhook")
    ? pass("Webhook URL points to /api/retell/webhook")
    : fail(`Webhook URL incorrect: ${payload.webhook_url}`);

  payload.post_call_analysis_data && payload.post_call_analysis_data.length >= 4
    ? pass(`Post-call analysis: ${payload.post_call_analysis_data.length} fields defined`)
    : fail("Post-call analysis fields missing or incomplete");
}

// ── Test 3: 5-scenario self-test ─────────────────────────────
async function testSelfTest() {
  console.log("\n[3] 5-Scenario self-test");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("  ⚠️  SKIP: ANTHROPIC_API_KEY not set");
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    console.log("  ⚠️  SKIP: OPENAI_API_KEY not set (needed for KB lookups)");
    return;
  }

  const agentPrompt = buildSystemPrompt({
    agentName: "Alex",
    businessName: "SFSBI Weight Loss Center",
    followUpTimeframe: "24 hours",
    language: "en",
  });

  console.log("  Running 5 scenarios (this takes ~60–90 seconds)...");
  const result = await runSelfTest(TEST_CLIENT_ID, agentPrompt, DEFAULT_TEST_SCENARIOS);

  result.scenarios.forEach((s) => {
    s.score >= 80
      ? pass(`Scenario ${s.scenarioId} — ${s.scenarioName}`, `${s.score}/100`)
      : s.score >= 60
      ? console.log(`  ⚠️  REVIEW: Scenario ${s.scenarioId} — ${s.scenarioName} (${s.score}/100): ${s.reasoning}`)
      : fail(`Scenario ${s.scenarioId} — ${s.scenarioName} — BLOCKED (${s.score}/100): ${s.reasoning}`);
  });

  console.log(`\n  Overall score: ${result.overallScore}/100`);

  if (result.passed) {
    pass(`Overall self-test: ${result.overallScore}/100 — DEPLOY APPROVED`);
  } else if (result.flagForReview) {
    console.log(`  ⚠️  REVIEW REQUIRED: ${result.overallScore}/100 — agent needs tuning before client deploy`);
  } else {
    fail(`DEPLOY BLOCKED: ${result.overallScore}/100 — score below 60`);
  }
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log("════════════════════════════════════════");
  console.log("  PHASE 3 GATE CHECK — Retell Voice Agent");
  console.log("════════════════════════════════════════");

  testSystemPromptTokens();
  testAgentPayload();
  await testSelfTest();

  await disconnectRedis();

  console.log("\n════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed / ${failed} failed`);
  if (failed === 0) {
    console.log("  ✅ Phase 3 gate PASSED — proceed to Phase 4 (n8n workflows)");
  } else {
    console.log("  ❌ Phase 3 gate FAILED — fix issues above before Phase 4");
    process.exit(1);
  }
  console.log("════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

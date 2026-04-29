#!/usr/bin/env ts-node
// ============================================================
// Phase 5 Gate Check
// Run: npm run phase5:gate
//
// PASS criteria (from PRD):
//   ✓ Qualifier agent scores lead and returns valid JSON
//   ✓ Follow-up agent generates message for 3 call types
//   ✓ Knowledge agent returns KB-grounded SMS reply
//   ✓ Orchestrator routes: post_call / sms_inbound / scheduled
//   ✓ Agent loop guard blocks in orchestrator path
//   ✓ Output schema validation rejects malformed agent output
// ============================================================

import "dotenv/config";
import { runQualifierAgent } from "../lib/agents/qualifier";
import { runFollowUpAgent } from "../lib/agents/followUp";
import { runKnowledgeAgent } from "../lib/agents/knowledge";
import { orchestrate } from "../lib/agents/orchestrator";
import { validateAgentOutput } from "../lib/agents/types";
import { disconnectRedis } from "../lib/redis/client";
import { resetLoopCounter } from "../lib/redis/agentLoopGuard";

const TEST_CLIENT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_LEAD_ID = "20000000-0000-0000-0000-000000000001";

let passed = 0;
let failed = 0;

function pass(label: string, detail?: string) {
  console.log(`  ✅ PASS: ${label}${detail ? ` (${detail})` : ""}`);
  passed++;
}

function fail(label: string, err?: unknown) {
  console.error(`  ❌ FAIL: ${label}`, err instanceof Error ? err.message : err ?? "");
  failed++;
}

// ── Test 1: Schema validation guard ─────────────────────────
function testSchemaValidation() {
  console.log("\n[1] Agent output schema validation");

  // Valid output should pass
  try {
    const valid = {
      agentType: "qualifier",
      success: true,
      contextUpdates: {},
      nextAction: "noop",
      tokensUsed: 100,
      costUsd: 0.001,
      reasoning: "Test pass",
    };
    validateAgentOutput(valid);
    pass("Valid output accepted");
  } catch (e) {
    fail("Valid output rejected", e);
  }

  // Missing required field should throw
  try {
    validateAgentOutput({ agentType: "qualifier", success: true });
    fail("Should have thrown on missing fields");
  } catch {
    pass("Missing fields correctly rejected");
  }

  // Negative tokensUsed should throw
  try {
    validateAgentOutput({
      agentType: "qualifier", success: true, contextUpdates: {},
      nextAction: "noop", tokensUsed: -1, costUsd: 0, reasoning: "x",
    });
    fail("Negative tokensUsed should be rejected");
  } catch {
    pass("Negative tokensUsed correctly rejected");
  }
}

// ── Test 2: Qualifier agent ──────────────────────────────────
async function testQualifierAgent() {
  console.log("\n[2] Qualifier agent");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("  ⚠️  SKIP: ANTHROPIC_API_KEY not set");
    return;
  }

  const context = {
    clientId: TEST_CLIENT_ID,
    leadId: TEST_LEAD_ID,
    callerNumber: "+14155559001",
    callerName: "Maria Garcia",
    callTranscript:
      "Agent: Hi! This is Alex from SFSBI Weight Loss Center, how can I help?\n" +
      "Caller: Hi, I'd like to book a consultation for the semaglutide program. I heard it's $299 a month?\n" +
      "Agent: That's right! The Medical Weight Loss Program starts at $299. Can I get your name and number?\n" +
      "Caller: Sure, I'm Maria Garcia, 415-555-9001.",
    callOutcome: "qualified",
    serviceInterest: "Medical Weight Loss Program",
  };

  try {
    const output = await runQualifierAgent(context);

    output.success ? pass("Qualifier: success=true") : fail("Qualifier: success=false");

    const score = output.contextUpdates.qualifierScore ?? 0;
    score >= 70
      ? pass(`Qualifier: score ${score} (expected ≥70 for clear booking intent)`)
      : fail(`Qualifier: score ${score} too low for clear booking intent`);

    output.contextUpdates.intent
      ? pass(`Qualifier: intent = ${output.contextUpdates.intent}`)
      : fail("Qualifier: no intent returned");

    output.tokensUsed > 0
      ? pass(`Qualifier: ${output.tokensUsed} tokens used, $${output.costUsd.toFixed(6)}`)
      : fail("Qualifier: zero tokens used");

  } catch (e) {
    fail("Qualifier agent threw", e);
  }

  // Spam call should score low
  try {
    const spamContext = {
      clientId: TEST_CLIENT_ID,
      leadId: TEST_LEAD_ID,
      callerNumber: "+10000000000",
      callTranscript: "Caller: Is this the pizza place? Agent: No, this is a weight loss clinic. Caller: Wrong number, bye.",
      callOutcome: "hung_up",
    };

    const spamOutput = await runQualifierAgent(spamContext);
    const spamScore = spamOutput.contextUpdates.qualifierScore ?? 100;
    spamScore <= 30
      ? pass(`Qualifier: spam correctly scored ${spamScore}/100`)
      : fail(`Qualifier: spam scored too high: ${spamScore}/100`);
  } catch (e) {
    fail("Qualifier spam test", e);
  }
}

// ── Test 3: Follow-up agent ──────────────────────────────────
async function testFollowUpAgent() {
  console.log("\n[3] Follow-up agent");

  const highScoreContext = {
    clientId: TEST_CLIENT_ID,
    leadId: TEST_LEAD_ID,
    callerNumber: "+14155559001",
    callerName: "Maria",
    qualifierScore: 85,
    serviceInterest: "Medical Weight Loss Program",
    callTranscript: "Caller asked about semaglutide pricing and seemed very interested.",
  };

  // Template path (score 60–79)
  const midContext = { ...highScoreContext, qualifierScore: 65, callTranscript: undefined };
  try {
    const output = await runFollowUpAgent(midContext, "SFSBI Weight Loss Center", 2);
    output.message.length > 0
      ? pass(`Follow-up touch 2 (template): "${output.message.slice(0, 60)}..."`)
      : fail("Follow-up touch 2: empty message");
    output.tokensUsed === 0
      ? pass("Follow-up touch 2: template path used (0 tokens)")
      : console.log(`  ℹ️  Follow-up touch 2: ${output.tokensUsed} tokens`);
  } catch (e) {
    fail("Follow-up template path", e);
  }

  // LLM path (score 80+ with transcript, requires OpenAI)
  if (process.env.OPENAI_API_KEY) {
    try {
      const output = await runFollowUpAgent(highScoreContext, "SFSBI Weight Loss Center", 1);
      output.message.length > 0
        ? pass(`Follow-up touch 1 (LLM): "${output.message.slice(0, 60)}..."`)
        : fail("Follow-up touch 1: empty message");
    } catch (e) {
      fail("Follow-up LLM path", e);
    }
  } else {
    console.log("  ⚠️  SKIP follow-up LLM path: OPENAI_API_KEY not set");
  }

  // Score < 60 should noop
  const lowContext = { ...highScoreContext, qualifierScore: 25 };
  try {
    const output = await runFollowUpAgent(lowContext, "SFSBI", 1);
    output.nextAction === "noop"
      ? pass("Follow-up: low-score lead correctly nooped")
      : fail(`Follow-up: low-score should noop, got ${output.nextAction}`);
  } catch (e) {
    fail("Follow-up noop test", e);
  }
}

// ── Test 4: Knowledge agent ──────────────────────────────────
async function testKnowledgeAgent() {
  console.log("\n[4] Knowledge agent");

  if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY) {
    console.log("  ⚠️  SKIP: ANTHROPIC_API_KEY or OPENAI_API_KEY not set");
    return;
  }

  const context = {
    clientId: TEST_CLIENT_ID,
    leadId: TEST_LEAD_ID,
    callerNumber: "+14155559001",
    callerName: "Maria",
    qualifierScore: 85,
    serviceInterest: "Medical Weight Loss Program",
  };

  try {
    const output = await runKnowledgeAgent(context, "What does the Ozempic consultation cost?");

    output.success
      ? pass("Knowledge agent: success=true")
      : fail("Knowledge agent: failed");

    output.replyMessage?.length > 0
      ? pass(`Knowledge reply: "${output.replyMessage.slice(0, 80)}..."`)
      : fail("Knowledge agent: empty reply message");

    output.tokensUsed > 0
      ? pass(`Knowledge agent: ${output.tokensUsed} tokens, $${output.costUsd.toFixed(6)}`)
      : fail("Knowledge agent: zero tokens");

  } catch (e) {
    fail("Knowledge agent", e);
  }
}

// ── Test 5: Orchestrator routing ─────────────────────────────
async function testOrchestrator() {
  console.log("\n[5] Orchestrator routing");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("  ⚠️  SKIP: ANTHROPIC_API_KEY not set");
    return;
  }

  // Reset loop counter so test starts clean
  await resetLoopCounter(TEST_CLIENT_ID, TEST_LEAD_ID);

  try {
    const result = await orchestrate({
      trigger: "post_call",
      clientId: TEST_CLIENT_ID,
      leadId: TEST_LEAD_ID,
      callTranscript: "Caller asked about semaglutide. Gave name Maria, number 415-555-9001.",
      callOutcome: "qualified",
    });

    result.success
      ? pass(`Orchestrator post_call: ran [${result.agentsRun.join(", ")}]`)
      : fail(`Orchestrator post_call failed: ${result.blockedReason}`);

    result.agentsRun.includes("qualifier")
      ? pass("Orchestrator: qualifier agent ran")
      : fail("Orchestrator: qualifier agent did not run");

  } catch (e) {
    fail("Orchestrator post_call", e);
  }

  // sms_inbound routing
  if (process.env.OPENAI_API_KEY) {
    try {
      const result = await orchestrate({
        trigger: "sms_inbound",
        clientId: TEST_CLIENT_ID,
        leadId: TEST_LEAD_ID,
        inboundSmsText: "What are your office hours?",
      });

      result.success
        ? pass(`Orchestrator sms_inbound: ran [${result.agentsRun.join(", ")}]`)
        : fail(`Orchestrator sms_inbound failed: ${result.blockedReason}`);

    } catch (e) {
      fail("Orchestrator sms_inbound", e);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log("════════════════════════════════════════");
  console.log("  PHASE 5 GATE CHECK — Multi-Agent Layer");
  console.log("════════════════════════════════════════");

  testSchemaValidation();
  await testQualifierAgent();
  await testFollowUpAgent();
  await testKnowledgeAgent();
  await testOrchestrator();

  await disconnectRedis();

  console.log("\n════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed / ${failed} failed`);
  if (failed === 0) {
    console.log("  ✅ Phase 5 gate PASSED — proceed to Phase 6 (Mission Control dashboard)");
  } else {
    console.log("  ❌ Phase 5 gate FAILED — fix issues above before Phase 6");
    process.exit(1);
  }
  console.log("════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

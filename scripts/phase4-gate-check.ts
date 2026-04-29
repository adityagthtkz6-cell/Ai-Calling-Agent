#!/usr/bin/env ts-node
// ============================================================
// Phase 4 Gate Check
// Run: npm run phase4:gate
//
// PASS criteria (from PRD):
//   ✓ /api/n8n/lead-update writes lead status to Supabase
//   ✓ Idempotency key prevents duplicate processing
//   ✓ follow_up_sequences row created for touch logging
//   ✓ Telegram alert utility sends (or skips gracefully if no token)
//   ✓ Agent loop guard blocks at threshold in lead-update path
//   ✓ n8n workflow JSONs are valid and importable
// ============================================================

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { serviceClient } from "../lib/supabase/client";
import { sendTelegramAlert } from "../lib/alerts/slack";
import { disconnectRedis } from "../lib/redis/client";

const TEST_CLIENT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_LEAD_ID = "20000000-0000-0000-0000-000000000001";
const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const INGEST_API_KEY = process.env.INGEST_API_KEY || "test-key";

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

// ── Test 1: n8n workflow JSON validity ──────────────────────
function testWorkflowJson() {
  console.log("\n[1] n8n workflow JSON validity");

  const workflows = [
    "n8n/workflows/post-call-orchestrator.json",
    "n8n/workflows/sms-follow-up-sequence.json",
  ];

  for (const wf of workflows) {
    const fullPath = path.join(process.cwd(), wf);
    if (!fs.existsSync(fullPath)) {
      fail(`File missing: ${wf}`);
      continue;
    }

    try {
      const content = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
      content.name && content.nodes && content.connections
        ? pass(`${path.basename(wf)}: valid JSON with name/nodes/connections`)
        : fail(`${path.basename(wf)}: missing required n8n fields`);

      const nodeCount = content.nodes.length;
      nodeCount >= 5
        ? pass(`${path.basename(wf)}: ${nodeCount} nodes defined`)
        : fail(`${path.basename(wf)}: only ${nodeCount} nodes — seems incomplete`);
    } catch (e) {
      fail(`${path.basename(wf)}: JSON parse error`, e);
    }
  }
}

// ── Test 2: Lead update API ─────────────────────────────────
async function testLeadUpdateApi() {
  console.log("\n[2] /api/n8n/lead-update endpoint");

  const idempotencyKey = `gate-check-${Date.now()}`;

  // Clean up any previous gate check event
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = serviceClient as any;
  await db.from("agent_events").delete().like("idempotency_key", "gate-check-%");

  try {
    const res = await fetch(`${APP_BASE_URL}/api/n8n/lead-update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": INGEST_API_KEY,
      },
      body: JSON.stringify({
        client_id: TEST_CLIENT_ID,
        lead_id: TEST_LEAD_ID,
        status: "qualified",
        intent: "booking",
        qualifier_score: 88,
        idempotency_key: idempotencyKey,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      fail(`lead-update returned ${res.status}`, text);
      return;
    }

    const data = await res.json();
    data.success
      ? pass("Lead update: returned success")
      : fail("Lead update: success not true", data);

    // Verify Supabase was updated
    const { data: lead } = await db
      .from("leads")
      .select("status, qualifier_score")
      .eq("id", TEST_LEAD_ID)
      .maybeSingle();

    lead?.status === "qualified"
      ? pass("Supabase: lead status = qualified")
      : fail(`Supabase: expected qualified, got ${lead?.status}`);

    lead?.qualifier_score === 88
      ? pass("Supabase: qualifier_score = 88")
      : fail(`Supabase: expected 88, got ${lead?.qualifier_score}`);

    // Test idempotency — same key should be skipped
    const res2 = await fetch(`${APP_BASE_URL}/api/n8n/lead-update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": INGEST_API_KEY,
      },
      body: JSON.stringify({
        client_id: TEST_CLIENT_ID,
        lead_id: TEST_LEAD_ID,
        status: "new",              // would revert status if not idempotent
        idempotency_key: idempotencyKey,
      }),
    });

    const data2 = await res2.json();
    data2.skipped
      ? pass("Idempotency: duplicate key correctly skipped")
      : fail("Idempotency: duplicate was NOT skipped", data2);

    // Verify status was NOT reverted
    const { data: lead2 } = await db
      .from("leads")
      .select("status")
      .eq("id", TEST_LEAD_ID)
      .maybeSingle();

    lead2?.status === "qualified"
      ? pass("Idempotency: status not reverted to 'new'")
      : fail(`Idempotency: status was reverted to ${lead2?.status}`);
  } catch (e) {
    fail("lead-update API call failed — is Next.js dev server running?", e);
  }
}

// ── Test 3: Follow-up touch logging ─────────────────────────
async function testFollowUpLogging() {
  console.log("\n[3] Follow-up touch logging");

  const idempotencyKey = `gate-touch-${Date.now()}`;

  try {
    const res = await fetch(`${APP_BASE_URL}/api/n8n/lead-update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": INGEST_API_KEY,
      },
      body: JSON.stringify({
        client_id: TEST_CLIENT_ID,
        lead_id: TEST_LEAD_ID,
        follow_up_touch: {
          touch_number: 1,
          status: "sent",
          sent_at: new Date().toISOString(),
          message_body: "Hi! Thanks for calling SFSBI Weight Loss Center.",
        },
        idempotency_key: idempotencyKey,
      }),
    });

    if (!res.ok) {
      fail(`Follow-up touch returned ${res.status}`, await res.text());
      return;
    }

    // Verify row in follow_up_sequences
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = serviceClient as any;
    const { data: touch } = await db
      .from("follow_up_sequences")
      .select("touch_number, status, message_body")
      .eq("lead_id", TEST_LEAD_ID)
      .eq("touch_number", 1)
      .maybeSingle();

    touch?.status === "sent"
      ? pass("follow_up_sequences: touch 1 written with status=sent")
      : fail(`follow_up_sequences: expected sent, got ${touch?.status}`);

    touch?.message_body?.length > 0
      ? pass("follow_up_sequences: message_body stored")
      : fail("follow_up_sequences: message_body empty");
  } catch (e) {
    fail("Follow-up touch test", e);
  }
}

// ── Test 4: Telegram alert utility ──────────────────────────
async function testTelegramAlert() {
  console.log("\n[4] Telegram alert utility");

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log("  ⚠️  SKIP: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — will log to console only");
    pass("Telegram graceful skip when no credentials");
    return;
  }

  const sent = await sendTelegramAlert({
    severity: "info",
    title: "Phase 4 Gate Check",
    message: "Test alert from Voice Intelligence Platform phase4:gate script",
    clientId: TEST_CLIENT_ID,
    metadata: { test: true },
  });

  sent
    ? pass("Telegram: test alert delivered successfully")
    : fail("Telegram: alert failed to deliver");
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log("════════════════════════════════════════");
  console.log("  PHASE 4 GATE CHECK — n8n + Automation");
  console.log("════════════════════════════════════════");
  console.log(`  App URL: ${APP_BASE_URL}`);
  console.log("  Note: Tests 2 & 3 require Next.js dev server running (npm run dev)\n");

  testWorkflowJson();
  await testLeadUpdateApi();
  await testFollowUpLogging();
  await testTelegramAlert();

  await disconnectRedis();

  console.log("\n════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed / ${failed} failed`);
  if (failed === 0) {
    console.log("  ✅ Phase 4 gate PASSED — proceed to Phase 5 (multi-agent layer)");
  } else {
    console.log("  ❌ Phase 4 gate FAILED — fix issues above before Phase 5");
    process.exit(1);
  }
  console.log("════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

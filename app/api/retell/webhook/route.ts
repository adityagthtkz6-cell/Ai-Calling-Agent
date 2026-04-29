import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { serviceClient } from "@/lib/supabase/client";
import { orchestrate } from "@/lib/agents/orchestrator";

// ============================================================
// POST /api/retell/webhook
// Receives post-call events from Retell AI.
// Failure mode #4 mitigation: returns 200 IMMEDIATELY (async),
// so Retell never retries due to timeout. Processing happens
// after response is sent.
//
// Events handled:
//   call_started   — create call_log row
//   call_ended     — update call_log, write lead, trigger n8n
//   call_analyzed  — update lead with post-call analysis
// ============================================================

const RETELL_WEBHOOK_SECRET = process.env.RETELL_WEBHOOK_SECRET ?? "";

function verifyRetellSignature(
  payload: string,
  signatureHeader: string | null
): boolean {
  if (!RETELL_WEBHOOK_SECRET || !signatureHeader) return false;
  const expected = createHmac("sha256", RETELL_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");
  return signatureHeader === expected;
}

export async function POST(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) {
    return NextResponse.json({ error: "Missing client_id" }, { status: 400 });
  }

  const rawBody = await req.text();

  // Signature verification — skip in dev if secret not set
  if (RETELL_WEBHOOK_SECRET) {
    const sig = req.headers.get("x-retell-signature");
    if (!verifyRetellSignature(rawBody, sig)) {
      console.warn("[retell/webhook] Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // Return 200 immediately — process async (failure mode #4)
  const response = NextResponse.json({ received: true });

  // Fire-and-forget processing
  processWebhookEvent(clientId, rawBody).catch((err) => {
    console.error("[retell/webhook] processing error:", err);
    // TODO: push to dead letter queue in n8n
  });

  return response;
}

async function processWebhookEvent(clientId: string, rawBody: string) {
  let event: RetellWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    console.error("[retell/webhook] Failed to parse body");
    return;
  }

  const { event: eventType, call } = event;
  if (!call?.call_id) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = serviceClient as any;

  if (eventType === "call_started") {
    await db.from("call_logs").insert({
      client_id: clientId,
      retell_call_id: call.call_id,
      caller_number: call.from_number ?? "unknown",
      started_at: new Date().toISOString(),
      cache_hits: 0,
      cache_misses: 0,
    });
    return;
  }

  if (eventType === "call_ended") {
    const durationSeconds = call.duration_ms ? Math.round(call.duration_ms / 1000) : null;
    const transcript = call.transcript ?? null;
    const outcome = deriveOutcome(call);

    // Update call log
    await db
      .from("call_logs")
      .update({
        duration_seconds: durationSeconds,
        transcript,
        outcome,
        ended_at: new Date().toISOString(),
      })
      .eq("retell_call_id", call.call_id)
      .eq("client_id", clientId);

    // Create lead record
    const { data: newLead } = await db
      .from("leads")
      .insert({
        client_id: clientId,
        caller_number: call.from_number ?? "unknown",
        intent: outcome === "spam" ? "spam" : "inquiry",
        status: outcome === "spam" ? "spam" : "new",
        call_id: call.call_id,
      })
      .select("id")
      .single();

    // Link lead to call log
    if (newLead?.id) {
      await db
        .from("call_logs")
        .update({ lead_id: newLead.id })
        .eq("retell_call_id", call.call_id);
    }

    // Trigger n8n post-call workflow
    await triggerN8nWorkflow(clientId, call, newLead?.id, outcome);

    // Trigger multi-agent pipeline (qualifier + follow-up)
    if (newLead?.id && outcome !== "spam") {
      orchestrate({
        trigger: "post_call",
        clientId,
        leadId: newLead.id,
        callTranscript: transcript ?? undefined,
        callOutcome: outcome,
      }).catch((err) => console.error("[retell/webhook] orchestrate error:", err));
    }
    return;
  }

  if (eventType === "call_analyzed") {
    const analysis = call.call_analysis ?? {};

    // Update lead with post-call analysis from Retell
    const { data: log } = await db
      .from("call_logs")
      .select("lead_id")
      .eq("retell_call_id", call.call_id)
      .maybeSingle();

    if (log?.lead_id) {
      await db
        .from("leads")
        .update({
          caller_name: analysis.caller_name ?? null,
          intent: analysis.caller_intent ?? null,
          service_interest: analysis.service_interest ?? null,
          status: analysis.lead_captured ? "qualified" : "new",
        })
        .eq("id", log.lead_id);
    }
  }
}

function deriveOutcome(call: RetellCall): string {
  if (call.disconnection_reason === "voicemail_reached") return "voicemail";
  if (call.duration_ms && call.duration_ms < 10000) return "hung_up";
  return "qualified";
}

async function triggerN8nWorkflow(
  clientId: string,
  call: RetellCall,
  leadId: string | undefined,
  outcome: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = serviceClient as any;
  const { data: client } = await db
    .from("clients")
    .select("n8n_webhook_url, name")
    .eq("id", clientId)
    .maybeSingle();

  if (!client?.n8n_webhook_url) {
    console.warn(`[retell/webhook] No n8n_webhook_url for client ${clientId}`);
    return;
  }

  const payload = {
    client_id: clientId,
    client_name: client.name,
    lead_id: leadId,
    call_id: call.call_id,
    caller_number: call.from_number,
    outcome,
    duration_seconds: call.duration_ms ? Math.round(call.duration_ms / 1000) : null,
    transcript: call.transcript ?? null,
    timestamp: new Date().toISOString(),
  };

  try {
    const n8nRes = await fetch(client.n8n_webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!n8nRes.ok) {
      console.error(`[retell/webhook] n8n trigger failed: ${n8nRes.status}`);
      // TODO: push to dead letter queue
    }
  } catch (err) {
    console.error("[retell/webhook] n8n trigger error:", err);
  }
}

// ── Types ───────────────────────────────────────────────────

interface RetellCall {
  call_id: string;
  from_number?: string;
  to_number?: string;
  duration_ms?: number;
  transcript?: string;
  disconnection_reason?: string;
  call_analysis?: {
    caller_name?: string;
    caller_intent?: string;
    service_interest?: string;
    lead_captured?: boolean;
    call_outcome?: string;
  };
}

interface RetellWebhookEvent {
  event: "call_started" | "call_ended" | "call_analyzed";
  call: RetellCall;
}

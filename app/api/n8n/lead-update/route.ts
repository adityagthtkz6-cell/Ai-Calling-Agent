import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/client";
import { checkAgentLoop } from "@/lib/redis/agentLoopGuard";

// ============================================================
// POST /api/n8n/lead-update
// Called by n8n workflows to write back to Supabase.
// Handles: lead status updates, follow-up touch logging,
//          follow-up scheduling, opt-out recording.
//
// Idempotency: every call must include an idempotency_key.
// Duplicate calls with the same key are silently ignored
// (checked via agent_events table).
//
// Auth: x-api-key header (same INGEST_API_KEY as /api/ingest).
// ============================================================

const INGEST_API_KEY = process.env.INGEST_API_KEY;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  if (INGEST_API_KEY && apiKey !== INGEST_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      client_id: clientId,
      lead_id: leadId,
      idempotency_key: idempotencyKey,
      status,
      intent,
      qualifier_score: qualifierScore,
      follow_up_touch: followUpTouch,
      schedule_follow_up: scheduleFollowUp,
    } = body;

    if (!clientId) {
      return NextResponse.json({ error: "client_id required" }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = serviceClient as any;

    // Idempotency check — skip if already processed
    if (idempotencyKey) {
      const { data: existingEvent } = await db
        .from("agent_events")
        .select("id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existingEvent) {
        return NextResponse.json({ skipped: true, reason: "duplicate idempotency_key" });
      }

      // Record this event so future duplicates are caught
      await db.from("agent_events").insert({
        client_id: clientId,
        lead_id: leadId ?? null,
        agent_type: "orchestrator",
        event_type: "completed",
        input_payload: body,
        idempotency_key: idempotencyKey,
      });
    }

    // Agent loop guard — prevent runaway re-processing
    if (leadId) {
      const loopCheck = await checkAgentLoop(clientId, leadId);
      if (!loopCheck.safe) {
        return NextResponse.json(
          { error: "Agent loop detected — execution blocked", executionCount: loopCheck.executionCount },
          { status: 429 }
        );
      }
    }

    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (intent !== undefined) updates.intent = intent;
    if (qualifierScore !== undefined) updates.qualifier_score = qualifierScore;

    // Update lead record
    if (leadId && Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await db.from("leads").update(updates).eq("id", leadId).eq("client_id", clientId);
    }

    // Log a completed follow-up touch
    if (leadId && followUpTouch) {
      const { touch_number, status: touchStatus, sent_at, message_body, replied_at, reply_content } = followUpTouch;

      await db
        .from("follow_up_sequences")
        .upsert({
          client_id: clientId,
          lead_id: leadId,
          touch_number,
          channel: followUpTouch.channel ?? "sms",
          status: touchStatus ?? "sent",
          message_body: message_body ?? null,
          sent_at: sent_at ?? null,
          replied_at: replied_at ?? null,
          reply_content: reply_content ?? null,
        }, { onConflict: "lead_id,touch_number" });
    }

    // Schedule a future follow-up touch
    if (leadId && scheduleFollowUp) {
      const { touch_number, scheduled_at, channel } = scheduleFollowUp;

      await db
        .from("follow_up_sequences")
        .upsert({
          client_id: clientId,
          lead_id: leadId,
          touch_number,
          channel: channel ?? "sms",
          status: "pending",
          sent_at: null,
        }, { onConflict: "lead_id,touch_number" });
    }

    return NextResponse.json({ success: true, leadId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/n8n/lead-update] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

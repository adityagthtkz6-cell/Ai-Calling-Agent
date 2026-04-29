import { NextRequest, NextResponse } from "next/server";
import { orchestrate } from "@/lib/agents/orchestrator";
import type { OrchestrateInput } from "@/lib/agents/orchestrator";

// ============================================================
// POST /api/agents/orchestrate
// Entry point for all multi-agent workflows.
// Called by:
//   - /api/retell/webhook (post_call trigger)
//   - Inbound SMS handler (sms_inbound trigger)
//   - n8n scheduled workflow (scheduled trigger)
//
// Auth: x-api-key header
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
      trigger,
      client_id: clientId,
      lead_id: leadId,
      call_transcript: callTranscript,
      call_outcome: callOutcome,
      inbound_sms_text: inboundSmsText,
      touch_number: touchNumber,
    } = body;

    if (!trigger || !clientId || !leadId) {
      return NextResponse.json(
        { error: "trigger, client_id, and lead_id are required" },
        { status: 400 }
      );
    }

    const validTriggers = ["post_call", "sms_inbound", "scheduled"];
    if (!validTriggers.includes(trigger)) {
      return NextResponse.json(
        { error: `Invalid trigger. Must be one of: ${validTriggers.join(", ")}` },
        { status: 400 }
      );
    }

    const input: OrchestrateInput = {
      trigger,
      clientId,
      leadId,
      callTranscript,
      callOutcome,
      inboundSmsText,
      touchNumber,
    };

    const result = await orchestrate(input);

    if (!result.success && result.blockedReason) {
      const isRateLimit = result.blockedReason.includes("Rate limit") ||
                          result.blockedReason.includes("loop");
      return NextResponse.json(
        { error: result.blockedReason, blocked: true },
        { status: isRateLimit ? 429 : 500 }
      );
    }

    return NextResponse.json({
      success: result.success,
      agents_run: result.agentsRun,
      total_tokens_used: result.totalTokensUsed,
      total_cost_usd: result.totalCostUsd,
      outputs: result.outputs.map((o) => ({
        agent: o.agentType,
        next_action: o.nextAction,
        reasoning: o.reasoning,
        tokens: o.tokensUsed,
        cost_usd: o.costUsd,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/agents/orchestrate] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

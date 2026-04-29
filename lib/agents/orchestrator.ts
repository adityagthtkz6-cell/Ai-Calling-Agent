import { serviceClient } from "../supabase/client";
import { checkAgentLoop } from "../redis/agentLoopGuard";
import { checkRateLimit, trackLLMCost } from "../redis/rateLimiter";
import { runQualifierAgent } from "./qualifier";
import { runFollowUpAgent } from "./followUp";
import { runKnowledgeAgent } from "./knowledge";
import { alertWebhookFailure } from "../alerts/slack";
import type {
  AgentContext,
  AgentOutput,
  OrchestratorTrigger,
} from "./types";
import { validateAgentOutput } from "./types";

// ============================================================
// Orchestrator Agent
// Routes all incoming events to the correct specialist agent.
// Owns: rate limiting, loop guard, context read/write, audit log.
// Shared state: AgentContext lives in Supabase leads table.
// All six failure mode mitigations run through here.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = serviceClient as any;

export interface OrchestrateInput {
  trigger: OrchestratorTrigger;
  clientId: string;
  leadId: string;
  // Optional extras depending on trigger
  callTranscript?: string;
  callOutcome?: string;
  inboundSmsText?: string;   // for sms_inbound trigger
  touchNumber?: number;      // for scheduled trigger
}

export interface OrchestrateResult {
  success: boolean;
  agentsRun: string[];
  totalTokensUsed: number;
  totalCostUsd: number;
  outputs: AgentOutput[];
  blockedReason?: string;
}

export async function orchestrate(
  input: OrchestrateInput
): Promise<OrchestrateResult> {
  const { trigger, clientId, leadId } = input;
  const agentsRun: string[] = [];
  const outputs: AgentOutput[] = [];
  let totalTokensUsed = 0;
  let totalCostUsd = 0;

  // ── Guard 1: Rate limit ──────────────────────────────────
  const rateCheck = await checkRateLimit(clientId);
  if (!rateCheck.allowed) {
    return {
      success: false,
      agentsRun: [],
      totalTokensUsed: 0,
      totalCostUsd: 0,
      outputs: [],
      blockedReason: `Rate limit exceeded (${rateCheck.currentCount} calls this hour)`,
    };
  }

  // ── Guard 2: Agent loop check ────────────────────────────
  const loopCheck = await checkAgentLoop(clientId, leadId);
  if (!loopCheck.safe) {
    return {
      success: false,
      agentsRun: [],
      totalTokensUsed: 0,
      totalCostUsd: 0,
      outputs: [],
      blockedReason: `Agent loop detected (${loopCheck.executionCount} executions in 60s)`,
    };
  }

  // ── Load context from Supabase ───────────────────────────
  const { data: lead, error: leadError } = await db
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (leadError || !lead) {
    await alertWebhookFailure(clientId, leadId, `Lead not found: ${leadError?.message}`);
    return {
      success: false,
      agentsRun: [],
      totalTokensUsed: 0,
      totalCostUsd: 0,
      outputs: [],
      blockedReason: `Lead ${leadId} not found for client ${clientId}`,
    };
  }

  const { data: client } = await db
    .from("clients")
    .select("name, language")
    .eq("id", clientId)
    .maybeSingle();

  let context: AgentContext = {
    clientId,
    leadId,
    callerNumber: lead.caller_number,
    callerName: lead.caller_name ?? null,
    intent: lead.intent ?? null,
    serviceInterest: lead.service_interest ?? null,
    qualifierScore: lead.qualifier_score ?? null,
    callTranscript: input.callTranscript ?? null,
    callOutcome: input.callOutcome ?? lead.status,
    lastSmsReply: input.inboundSmsText ?? null,
    touchNumber: input.touchNumber ?? 1,
  };

  // ── Route by trigger ─────────────────────────────────────
  try {
    if (trigger === "post_call") {
      // Step 1: Qualifier always runs after every call
      const qualifierOutput = await runQualifierAgent(context);
      validateAgentOutput(qualifierOutput);
      outputs.push(qualifierOutput);
      agentsRun.push("qualifier");
      context = mergeContext(context, qualifierOutput.contextUpdates);
      totalTokensUsed += qualifierOutput.tokensUsed;
      totalCostUsd += qualifierOutput.costUsd;

      // Step 2: If score >= 60, run Follow-Up to get Touch 1 message
      if ((context.qualifierScore ?? 0) >= 60) {
        const followUpOutput = await runFollowUpAgent(context, client?.name ?? "our team", 1);
        validateAgentOutput(followUpOutput);
        outputs.push(followUpOutput);
        agentsRun.push("follow_up");
        totalTokensUsed += followUpOutput.tokensUsed;
        totalCostUsd += followUpOutput.costUsd;
      }

      // Step 3: Write qualifier results + new status back to Supabase
      const newStatus = (context.qualifierScore ?? 0) >= 60
        ? "qualified"
        : (context.intent === "spam" ? "spam" : "new");

      await db.from("leads").update({
        qualifier_score: context.qualifierScore,
        intent: context.intent,
        service_interest: context.serviceInterest,
        status: newStatus,
        updated_at: new Date().toISOString(),
      }).eq("id", leadId);

    } else if (trigger === "sms_inbound") {
      // SMS reply → Knowledge Agent answers it
      if (!input.inboundSmsText) {
        throw new Error("inboundSmsText required for sms_inbound trigger");
      }
      const knowledgeOutput = await runKnowledgeAgent(context, input.inboundSmsText);
      validateAgentOutput(knowledgeOutput);
      outputs.push(knowledgeOutput);
      agentsRun.push("knowledge");
      totalTokensUsed += knowledgeOutput.tokensUsed;
      totalCostUsd += knowledgeOutput.costUsd;

    } else if (trigger === "scheduled") {
      // Scheduled follow-up touch
      const touchNum = input.touchNumber ?? 2;
      const followUpOutput = await runFollowUpAgent(context, client?.name ?? "our team", touchNum);
      validateAgentOutput(followUpOutput);
      outputs.push(followUpOutput);
      agentsRun.push("follow_up");
      totalTokensUsed += followUpOutput.tokensUsed;
      totalCostUsd += followUpOutput.costUsd;
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await alertWebhookFailure(clientId, leadId, message);
    // Write failure to agent_events
    await writeAgentEvent(clientId, leadId, "orchestrator", "failed", input, { error: message });
    return {
      success: false,
      agentsRun,
      totalTokensUsed,
      totalCostUsd,
      outputs,
      blockedReason: message,
    };
  }

  // ── Track cost for runaway detection ────────────────────
  if (totalCostUsd > 0) {
    await trackLLMCost(clientId, totalCostUsd);
  }

  // ── Audit log ────────────────────────────────────────────
  await writeAgentEvent(clientId, leadId, "orchestrator", "completed", input, {
    agentsRun,
    totalTokensUsed,
    totalCostUsd,
  });

  return {
    success: true,
    agentsRun,
    totalTokensUsed,
    totalCostUsd,
    outputs,
  };
}

// ── Helpers ──────────────────────────────────────────────────

function mergeContext(base: AgentContext, updates: Partial<AgentContext>): AgentContext {
  return { ...base, ...Object.fromEntries(
    Object.entries(updates).filter(([, v]) => v !== undefined)
  )};
}

async function writeAgentEvent(
  clientId: string,
  leadId: string,
  agentType: string,
  eventType: "completed" | "failed",
  input: unknown,
  output: unknown
) {
  const idempotencyKey = `orch:${clientId}:${leadId}:${agentType}:${Date.now()}`;
  await db.from("agent_events").insert({
    client_id: clientId,
    lead_id: leadId,
    agent_type: agentType,
    event_type: eventType,
    input_payload: input as Record<string, unknown>,
    output_payload: output as Record<string, unknown>,
    idempotency_key: idempotencyKey,
  });
}

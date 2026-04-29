// ============================================================
// Shared Agent Types — Voice Intelligence Platform
// All agents read/write AgentContext. Output is schema-validated
// JSON (failure mode #1: data corruption mitigation).
// ============================================================

export type AgentType =
  | "orchestrator"
  | "qualifier"
  | "follow_up"
  | "knowledge"
  | "self_test";

export type OrchestratorTrigger =
  | "post_call"       // Retell webhook fired
  | "sms_inbound"     // Caller replied to a follow-up SMS
  | "scheduled"       // Cron-triggered follow-up touch

export type LeadIntent =
  | "booking"
  | "price_check"
  | "inquiry"
  | "complaint"
  | "spam"
  | "other";

export type LeadStatus =
  | "new"
  | "qualified"
  | "booked"
  | "followed_up"
  | "closed"
  | "spam";

// Shared context object passed between all agents.
// Persisted to Supabase leads table after every agent run.
export interface AgentContext {
  clientId: string;
  leadId: string;
  callerNumber: string;
  callerName?: string | null;
  intent?: LeadIntent | null;
  serviceInterest?: string | null;
  qualifierScore?: number | null;
  callTranscript?: string | null;
  callOutcome?: string | null;
  lastSmsReply?: string | null;
  touchNumber?: number;
}

// Schema-validated output every agent must return.
// Validation happens in the Orchestrator before any state write.
export interface AgentOutput {
  agentType: AgentType;
  success: boolean;
  contextUpdates: Partial<AgentContext>;  // merged into AgentContext
  nextAction:
    | "qualify"
    | "follow_up"
    | "knowledge_lookup"
    | "schedule_touch"
    | "close"
    | "noop";
  nextAgentPayload?: Record<string, unknown>;
  tokensUsed: number;
  costUsd: number;
  reasoning: string;          // one sentence — auditable in dashboard
}

// Validation guard — ensures agent output is safe to write
export function validateAgentOutput(raw: unknown): AgentOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Agent output is not an object");
  }
  const o = raw as Record<string, unknown>;

  const required: (keyof AgentOutput)[] = [
    "agentType", "success", "contextUpdates", "nextAction",
    "tokensUsed", "costUsd", "reasoning",
  ];

  for (const field of required) {
    if (o[field] === undefined || o[field] === null) {
      throw new Error(`Agent output missing required field: ${field}`);
    }
  }

  if (typeof o.tokensUsed !== "number" || o.tokensUsed < 0) {
    throw new Error("tokensUsed must be a non-negative number");
  }
  if (typeof o.costUsd !== "number" || o.costUsd < 0) {
    throw new Error("costUsd must be a non-negative number");
  }

  return o as unknown as AgentOutput;
}

// Cost per 1M tokens (approximate, April 2026 pricing)
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "gpt-4.1-mini":      { input: 0.40, output: 1.60 },   // per 1M tokens
  "claude-haiku-4-5":  { input: 0.80, output: 4.00 },
  "claude-sonnet-4-5": { input: 3.00, output: 15.00 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const costs = MODEL_COSTS[model] ?? { input: 1.0, output: 4.0 };
  return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
}

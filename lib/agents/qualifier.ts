import Anthropic from "@anthropic-ai/sdk";
import type { AgentContext, AgentOutput } from "./types";
import { estimateCost, validateAgentOutput } from "./types";

// ============================================================
// Qualifier Agent
// Model: Claude Haiku (fast + cheap — this runs after every call)
// Input: call transcript + context
// Output: lead score 0–100, intent classification, next action
//
// Scoring rubric:
//   80–100  High intent — book/buy signal, contact info captured
//   60–79   Medium intent — interested, needs follow-up
//   40–59   Ambiguous — human review queue (failure mode #1)
//   0–39    Low/no intent — spam, wrong number, not interested
// ============================================================

const MODEL = "claude-haiku-4-5";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const QUALIFIER_SYSTEM = `You are a lead qualification specialist for a voice AI platform.
Analyze the call transcript and score the lead 0–100.

Scoring rubric:
- 80–100: Strong buying signal. Caller asked about pricing/booking, shared contact info, expressed urgency.
- 60–79: Moderate interest. Asked questions but no clear next step taken.
- 40–59: Ambiguous. Hard to tell intent. Flag for human review.
- 0–39: No intent. Spam, wrong number, or clearly not a fit.

Respond with ONLY valid JSON matching this exact schema:
{
  "score": <number 0-100>,
  "intent": <"booking"|"price_check"|"inquiry"|"complaint"|"spam"|"other">,
  "service_interest": <string or null>,
  "reasoning": <one sentence>,
  "next_action": <"follow_up"|"schedule_touch"|"close"|"noop">
}`;

export async function runQualifierAgent(
  context: AgentContext
): Promise<AgentOutput> {
  const transcript = context.callTranscript ?? "(no transcript available)";
  const userMessage = `CLIENT: ${context.clientId}
CALLER NUMBER: ${context.callerNumber}
CALLER NAME: ${context.callerName ?? "unknown"}
CALL OUTCOME: ${context.callOutcome ?? "unknown"}
SERVICE INTEREST: ${context.serviceInterest ?? "unknown"}

TRANSCRIPT:
${transcript}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: QUALIFIER_SYSTEM,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.type === "text" ? b.text : "")
    .join("");

  let parsed: {
    score: number;
    intent: string;
    service_interest: string | null;
    reasoning: string;
    next_action: string;
  };

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Qualifier agent returned invalid JSON: ${rawText.slice(0, 200)}`);
  }

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd = estimateCost(MODEL, inputTokens, outputTokens);

  const score = Math.min(100, Math.max(0, Number(parsed.score)));

  // Map score to status (failure mode #1: ambiguous zone → human review)
  let derivedStatus: string;
  if (score >= 80) derivedStatus = "qualified";
  else if (score >= 60) derivedStatus = "new";         // gets follow-up
  else if (score >= 40) derivedStatus = "new";         // human review queue
  else derivedStatus = context.callOutcome === "spam" ? "spam" : "new";

  const output: AgentOutput = {
    agentType: "qualifier",
    success: true,
    contextUpdates: {
      qualifierScore: score,
      intent: parsed.intent as AgentContext["intent"],
      serviceInterest: parsed.service_interest ?? context.serviceInterest,
    },
    nextAction: score >= 40
      ? (parsed.next_action as AgentOutput["nextAction"]) ?? "follow_up"
      : "noop",
    nextAgentPayload: {
      qualifierScore: score,
      derivedStatus,
      // Human review queue: scores 40–70 flagged (failure mode #1)
      requiresHumanReview: score >= 40 && score < 70,
    },
    tokensUsed: inputTokens + outputTokens,
    costUsd,
    reasoning: parsed.reasoning,
  };

  return validateAgentOutput(output);
}

import Anthropic from "@anthropic-ai/sdk";
import { searchKnowledgeBase } from "../supabase/ragSearch";
import type { AgentContext, AgentOutput } from "./types";
import { estimateCost, validateAgentOutput } from "./types";

// ============================================================
// Knowledge Agent
// Model: Claude Haiku (cost-optimized for high-volume replies)
// Trigger: inbound SMS/WhatsApp reply from a lead
// Uses the same RAG KB as the voice agent — one source of truth.
// Context bleed prevention: all KB lookups namespaced by clientId
// (failure mode #3).
//
// Output: a reply message ready to send via Twilio/WhatsApp.
// ============================================================

const MODEL = "claude-haiku-4-5";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const KNOWLEDGE_SYSTEM = `You are a helpful AI assistant responding to an SMS message from a potential client.
You have access to knowledge base context retrieved from the business's information.

Rules:
- Keep replies under 160 characters when possible (one SMS)
- Never make up information not in the KB context
- If KB context doesn't answer the question, say you'll have someone follow up
- Be warm and conversational — this is a text message, not an email
- Never use bullet points or lists in SMS replies
- Always end with a clear next step

Respond with ONLY valid JSON:
{
  "reply_message": "<the SMS text to send>",
  "intent_detected": "<booking|price_check|inquiry|complaint|spam|other>",
  "kb_used": <true|false>,
  "reasoning": "<one sentence>",
  "next_action": "<schedule_touch|close|noop>"
}`;

export async function runKnowledgeAgent(
  context: AgentContext,
  inboundMessage: string
): Promise<AgentOutput & { replyMessage: string }> {
  // RAG lookup — cache-first (failure mode #3: keyed by clientId)
  const { chunks, cacheHit, tokensUsed: embedTokens } = await searchKnowledgeBase(
    context.clientId,
    inboundMessage,
    3,
    0.65
  );

  const kbContext = chunks.length > 0
    ? chunks.map((c) => c.content).join("\n\n")
    : "No relevant information found in knowledge base.";

  const userMessage = `BUSINESS CONTEXT (from knowledge base):
${kbContext}

LEAD INFO:
Name: ${context.callerName ?? "unknown"}
Previous service interest: ${context.serviceInterest ?? "not specified"}
Lead score: ${context.qualifierScore ?? "not scored"}

INBOUND SMS FROM LEAD:
"${inboundMessage}"

Write a reply SMS message.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: KNOWLEDGE_SYSTEM,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.type === "text" ? b.text : "")
    .join("");

  let parsed: {
    reply_message: string;
    intent_detected: string;
    kb_used: boolean;
    reasoning: string;
    next_action: string;
  };

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Knowledge agent returned invalid JSON: ${rawText.slice(0, 200)}`);
  }

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd = estimateCost(MODEL, inputTokens + embedTokens, outputTokens);

  const output = {
    agentType: "knowledge" as const,
    success: true,
    contextUpdates: {
      intent: parsed.intent_detected as AgentContext["intent"],
      lastSmsReply: inboundMessage,
    },
    nextAction: (parsed.next_action as AgentOutput["nextAction"]) ?? "noop",
    nextAgentPayload: {
      replyMessage: parsed.reply_message,
      kbUsed: parsed.kb_used,
      cacheHit,
    },
    tokensUsed: inputTokens + outputTokens + embedTokens,
    costUsd,
    reasoning: parsed.reasoning,
    replyMessage: parsed.reply_message,
  };

  return validateAgentOutput(output) as AgentOutput & { replyMessage: string };
}

// ============================================================
// Retell System Prompt Builder
// Generates a per-client system prompt from a template.
// Hard limit: 650 tokens. Target: under 400.
// All business knowledge lives in the KB — never in this prompt.
// ============================================================

import { estimateTokens } from "../../../lib/ingestion/chunker";

const SYSTEM_PROMPT_HARD_LIMIT = 650;
const SYSTEM_PROMPT_TARGET = 400;

export interface AgentConfig {
  agentName: string;
  businessName: string;
  followUpTimeframe: string;   // e.g. "24 hours" or "the next business day"
  transferPhoneNumber?: string;
  language?: "en" | "es";
}

export function buildSystemPrompt(config: AgentConfig): string {
  const {
    agentName,
    businessName,
    followUpTimeframe,
    transferPhoneNumber,
    language = "en",
  } = config;

  const bilingualNote =
    language === "es"
      ? "\nIf the caller speaks Spanish, respond in Spanish throughout the call."
      : "";

  const transferInstruction = transferPhoneNumber
    ? `Say: "Let me connect you with our team. One moment." Then use transfer_call function.`
    : `Say: "Let me have someone from our team call you right back." Then capture their number.`;

  const prompt = `## IDENTITY
You are ${agentName}, the AI receptionist for ${businessName}.
You speak naturally, warmly, and concisely. This is a phone call.
Never use lists or bullet points. One question at a time. Maximum 2–3 sentences per response.${bilingualNote}

## YOUR JOB
1. Greet the caller warmly
2. Find out why they're calling
3. Answer their question using search_knowledge tool
4. If they're interested: capture name and callback number
5. Confirm what happens next

## SPEECH RULES
NEVER say: "Certainly!", "Absolutely!", "Of course!"
NEVER read a list out loud
NEVER ask two questions in a row
DO say: "Got it", "Sure", "Happy to help with that"
DO pause naturally before complex answers

## KNOWLEDGE
Call search_knowledge before answering any factual question about services, pricing, hours, or policies.
Do NOT guess. If the tool returns nothing relevant, say: "Let me have someone follow up with you on that."

## HANDOFF
If caller needs immediate human help:
${transferInstruction}

## LEAD CAPTURE
When caller shows interest, ask: "Just to make sure we can follow up — what's the best name and number for you?"
Then confirm: "Perfect. Someone will reach out within ${followUpTimeframe}."`.trim();

  const tokenCount = estimateTokens(prompt);

  if (tokenCount > SYSTEM_PROMPT_HARD_LIMIT) {
    throw new Error(
      `System prompt exceeds hard limit: ${tokenCount} tokens (max ${SYSTEM_PROMPT_HARD_LIMIT}). Reduce prompt content.`
    );
  }

  if (tokenCount > SYSTEM_PROMPT_TARGET) {
    console.warn(
      `[systemPrompt] Warning: ${tokenCount} tokens (target ${SYSTEM_PROMPT_TARGET}). Consider trimming.`
    );
  }

  return prompt;
}

export function validatePromptTokens(prompt: string): {
  tokens: number;
  withinTarget: boolean;
  withinHardLimit: boolean;
} {
  const tokens = estimateTokens(prompt);
  return {
    tokens,
    withinTarget: tokens <= SYSTEM_PROMPT_TARGET,
    withinHardLimit: tokens <= SYSTEM_PROMPT_HARD_LIMIT,
  };
}

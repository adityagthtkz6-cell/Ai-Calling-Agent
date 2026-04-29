import OpenAI from "openai";
import type { AgentContext, AgentOutput } from "./types";
import { estimateCost, validateAgentOutput } from "./types";

// ============================================================
// Follow-Up Agent
// Model: GPT-4.1-mini (better instruction-following for templates)
// Trigger: high-score lead (qualifier_score >= 60) after call
// Generates the personalized follow-up strategy:
//   - Which touch to send next
//   - Exact message text per touch (1–5)
//   - Optimal channel (SMS vs WhatsApp)
//   - Whether to escalate to human
// ============================================================

const MODEL = "gpt-4.1-mini";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FOLLOW_UP_SYSTEM = `You are a follow-up strategy specialist for a service business.
Your job: given a lead's context, generate the optimal next follow-up message.

Message rules:
- SMS: under 160 characters, casual, one clear CTA
- Touch 1: immediate warm intro (sent by n8n automatically)
- Touch 2 (1h later): light check-in, no pressure
- Touch 3 (24h): value proposition + soft ask
- Touch 4 (72h): social proof or urgency
- Touch 5 (7d): graceful exit with open door

Respond with ONLY valid JSON:
{
  "touch_number": <1-5>,
  "message": "<the exact SMS text to send>",
  "channel": <"sms"|"whatsapp">,
  "send_delay_hours": <number>,
  "reasoning": "<one sentence>",
  "next_action": <"schedule_touch"|"close"|"noop">,
  "escalate_to_human": <boolean>
}`;

const TOUCH_TEMPLATES = {
  1: (name: string, biz: string, service: string) =>
    `Hi${name ? ` ${name}` : ""}! Thanks for calling ${biz}. Still interested in ${service}? Reply here anytime!`,
  2: (name: string, biz: string, service: string) =>
    `Hey${name ? ` ${name}` : ""}, just checking in from ${biz}. Happy to answer any questions about ${service}!`,
  3: (name: string, biz: string, service: string) =>
    `${name ? `${name}, ` : ""}${biz} here — many clients love ${service}. Want to book a quick call this week?`,
  4: (name: string, biz: string, _service: string) =>
    `Last week, a new client at ${biz} started their journey. ${name ? `${name}, ` : ""}ready to be next? Reply YES!`,
  5: (name: string, biz: string, _service: string) =>
    `${name ? `${name}, ` : ""}we're here whenever you're ready. ${biz} — reply anytime. Take care!`,
};

export async function runFollowUpAgent(
  context: AgentContext,
  clientName: string,
  currentTouchNumber: number = 1
): Promise<AgentOutput & { message: string; sendDelayHours: number; channel: string }> {

  // For scores 80+ use GPT to personalize; for 60–79 use template directly
  if ((context.qualifierScore ?? 0) < 60) {
    return {
      agentType: "follow_up",
      success: true,
      contextUpdates: {},
      nextAction: "noop",
      tokensUsed: 0,
      costUsd: 0,
      reasoning: "Lead score below 60 — no follow-up scheduled",
      message: "",
      sendDelayHours: 0,
      channel: "sms",
    };
  }

  const name = context.callerName ?? "";
  const service = context.serviceInterest ?? "our services";

  // Use template for predictable cost on touches 1–5
  const templateFn = TOUCH_TEMPLATES[currentTouchNumber as keyof typeof TOUCH_TEMPLATES]
    ?? TOUCH_TEMPLATES[5];
  const templateMessage = templateFn(name, clientName, service);

  // Only call GPT for high-intent leads (80+) where personalization matters
  if ((context.qualifierScore ?? 0) >= 80 && context.callTranscript) {
    const userMessage = `LEAD CONTEXT:
Name: ${name || "unknown"}
Business: ${clientName}
Service interest: ${service}
Qualifier score: ${context.qualifierScore}
Touch number: ${currentTouchNumber}
Previous intent: ${context.intent ?? "inquiry"}
Call transcript excerpt: "${(context.callTranscript ?? "").slice(0, 400)}"

Template fallback: "${templateMessage}"

Generate an optimized follow-up message for touch ${currentTouchNumber}.`;

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: FOLLOW_UP_SYSTEM },
        { role: "user", content: userMessage },
      ],
      temperature: 0.4,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const rawText = response.choices[0]?.message?.content ?? "{}";
    let parsed: {
      touch_number: number;
      message: string;
      channel: string;
      send_delay_hours: number;
      reasoning: string;
      next_action: string;
      escalate_to_human: boolean;
    };

    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error(`Follow-up agent returned invalid JSON: ${rawText.slice(0, 200)}`);
    }

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const costUsd = estimateCost(MODEL, inputTokens, outputTokens);

    const DELAY_BY_TOUCH: Record<number, number> = { 1: 0, 2: 1, 3: 24, 4: 72, 5: 168 };

    const output = {
      agentType: "follow_up" as const,
      success: true,
      contextUpdates: {},
      nextAction: (parsed.next_action as AgentOutput["nextAction"]) ?? "schedule_touch",
      nextAgentPayload: {
        touchNumber: parsed.touch_number ?? currentTouchNumber,
        escalateToHuman: parsed.escalate_to_human ?? false,
      },
      tokensUsed: inputTokens + outputTokens,
      costUsd,
      reasoning: parsed.reasoning,
      message: parsed.message || templateMessage,
      sendDelayHours: parsed.send_delay_hours ?? DELAY_BY_TOUCH[currentTouchNumber] ?? 24,
      channel: parsed.channel ?? "sms",
    };

    return validateAgentOutput(output) as AgentOutput & {
      message: string;
      sendDelayHours: number;
      channel: string;
    };
  }

  // Template path — no LLM call, zero cost
  const DELAY_BY_TOUCH: Record<number, number> = { 1: 0, 2: 1, 3: 24, 4: 72, 5: 168 };

  const output = {
    agentType: "follow_up" as const,
    success: true,
    contextUpdates: {},
    nextAction: currentTouchNumber < 5 ? "schedule_touch" as const : "close" as const,
    nextAgentPayload: { touchNumber: currentTouchNumber },
    tokensUsed: 0,
    costUsd: 0,
    reasoning: `Template touch ${currentTouchNumber} — lead score ${context.qualifierScore}, no LLM call needed`,
    message: templateMessage,
    sendDelayHours: DELAY_BY_TOUCH[currentTouchNumber] ?? 24,
    channel: "sms",
  };

  return validateAgentOutput(output) as AgentOutput & {
    message: string;
    sendDelayHours: number;
    channel: string;
  };
}

import Anthropic from "@anthropic-ai/sdk";
import type { Messages } from "@anthropic-ai/sdk/resources";
import { searchKnowledgeBase } from "../../supabase/ragSearch";

// ============================================================
// 5-Scenario Self-Test Runner
// Must score 80+ before any client deploy (PRD hard gate).
// Uses Claude Sonnet to score each conversation turn-by-turn.
// Scoring: 0–100 per scenario, averaged for final score.
// Gate: < 60 = block deploy | 60–79 = flag for review | 80+ = pass
// ============================================================

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface TestScenario {
  id: number;
  name: string;
  callerLines: string[];       // Simulated caller utterances
  passCriteria: string;
  failSignals: string;
}

export interface ScenarioResult {
  scenarioId: number;
  scenarioName: string;
  score: number;               // 0–100
  passed: boolean;
  reasoning: string;
  agentResponses: string[];
}

export interface SelfTestResult {
  clientId: string;
  overallScore: number;
  passed: boolean;             // score >= 80
  flagForReview: boolean;      // score 60–79
  blockDeploy: boolean;        // score < 60
  scenarios: ScenarioResult[];
  runAt: string;
}

// The 5 canonical scenarios from the PRD
export const DEFAULT_TEST_SCENARIOS: TestScenario[] = [
  {
    id: 1,
    name: "New caller, clear intent",
    callerLines: [
      "Hi, I'd like to book a consultation for the weight loss program.",
      "How much does it cost?",
      "That sounds good. My name is Sarah and my number is 415-555-0101.",
    ],
    passCriteria:
      "Lead captured (name + phone), correct service info given from KB, follow-up confirmed, no double questions.",
    failSignals:
      "Wrong pricing, asks two questions at once, reads a list, says 'Certainly', fails to confirm follow-up.",
  },
  {
    id: 2,
    name: "Vague caller — saw your ad",
    callerLines: [
      "Hi, I saw your ad online and wanted to learn more.",
      "I'm not sure exactly... I guess I want to lose weight.",
      "What's the cheapest option?",
    ],
    passCriteria:
      "Agent narrows to one service within 3 exchanges without overwhelming the caller. Does not dump full service list.",
    failSignals:
      "Lists all services at once, asks more than one question in a row, confuses caller with too much info.",
  },
  {
    id: 3,
    name: "Price objection",
    callerLines: [
      "I'm interested in the Ozempic consultation.",
      "That sounds expensive. I don't know if I can afford it.",
      "What if I can't pay upfront?",
    ],
    passCriteria:
      "Acknowledges concern empathetically, pivots to value and payment options from KB, does not give unauthorized discount.",
    failSignals:
      "Apologizes excessively, gives wrong price, offers unauthorized discount, becomes robotic or defensive.",
  },
  {
    id: 4,
    name: "Spam / wrong number",
    callerLines: [
      "Is this the pizza place?",
      "Oh wrong number I think.",
    ],
    passCriteria:
      "Identifies non-legitimate call within 2–3 exchanges, ends politely in under 30 seconds.",
    failSignals:
      "Tries to qualify the caller, wastes time, fails to end call gracefully.",
  },
  {
    id: 5,
    name: "After-hours voicemail scenario",
    callerLines: [
      "[VOICEMAIL_DETECTED]",
    ],
    passCriteria:
      "Leaves a professional voicemail message with business name, call-back request, and SMS follow-up note.",
    failSignals:
      "Hangs up silently, leaves blank voicemail, fails to mention SMS follow-up.",
  },
];

const SCORER_SYSTEM_PROMPT = `You are a quality assurance evaluator for an AI voice receptionist.
You will receive:
1. A test scenario description with pass/fail criteria
2. A simulated conversation between a caller and the AI agent

Score the AI agent's performance from 0–100 based on:
- Did it meet the pass criteria? (50 points)
- Did it avoid the fail signals? (30 points)
- Was the conversation natural and professional? (20 points)

Respond with ONLY valid JSON:
{
  "score": <number 0-100>,
  "reasoning": "<one to two sentences explaining the score>"
}`;

async function simulateConversation(
  clientId: string,
  agentSystemPrompt: string,
  scenario: TestScenario
): Promise<string[]> {
  const agentResponses: string[] = [];
  const conversationHistory: { role: "user" | "assistant"; content: string }[] = [];

  for (const callerLine of scenario.callerLines) {
    if (callerLine === "[VOICEMAIL_DETECTED]") {
      // Simulate voicemail by asking agent what it would say
      conversationHistory.push({
        role: "user",
        content:
          "The call has gone to voicemail. Please leave an appropriate voicemail message now.",
      });
    } else {
      conversationHistory.push({ role: "user", content: callerLine });
    }

    // Get agent response — includes RAG tool call simulation
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      system:
        agentSystemPrompt +
        "\n\nIMPORTANT: You are being tested. When you need to look up information, " +
        "include [SEARCHING_KB: <query>] in your response and I will provide the KB result on the next turn.",
      messages: conversationHistory,
    });

    let agentText = (response.content as Messages.ContentBlock[])
      .filter((b) => b.type === "text")
      .map((b) => b.type === "text" ? (b as Messages.TextBlock).text : "")
      .join("");

    // Handle KB lookup simulation
    const kbMatch = agentText.match(/\[SEARCHING_KB:\s*(.+?)\]/);
    if (kbMatch) {
      const query = kbMatch[1].trim();
      const { chunks } = await searchKnowledgeBase(clientId, query, 3, 0.50);
      const kbResult =
        chunks.length > 0
          ? chunks.map((c) => c.content).join("\n")
          : "No relevant information found.";

      // Feed KB result back and get final response
      conversationHistory.push({ role: "assistant", content: agentText });
      conversationHistory.push({
        role: "user",
        content: `[KB_RESULT]: ${kbResult}`,
      });

      const finalResponse = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 300,
        system: agentSystemPrompt,
        messages: conversationHistory,
      });

      agentText = (finalResponse.content as Messages.ContentBlock[])
        .filter((b) => b.type === "text")
        .map((b) => b.type === "text" ? (b as Messages.TextBlock).text : "")
        .join("");
    }

    agentResponses.push(agentText);
    conversationHistory.push({ role: "assistant", content: agentText });
  }

  return agentResponses;
}

async function scoreScenario(
  scenario: TestScenario,
  agentResponses: string[],
  callerLines: string[]
): Promise<{ score: number; reasoning: string }> {
  const conversationText = callerLines
    .map((line, i) => `Caller: ${line}\nAgent: ${agentResponses[i] ?? "(no response)"}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 200,
    system: SCORER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `SCENARIO: ${scenario.name}
PASS CRITERIA: ${scenario.passCriteria}
FAIL SIGNALS: ${scenario.failSignals}

CONVERSATION:
${conversationText}`,
      },
    ],
  });

  const rawText = (response.content as Messages.ContentBlock[])
    .filter((b) => b.type === "text")
    .map((b) => b.type === "text" ? (b as Messages.TextBlock).text : "")
    .join("");

  try {
    const parsed = JSON.parse(rawText);
    return {
      score: Math.min(100, Math.max(0, Number(parsed.score))),
      reasoning: String(parsed.reasoning),
    };
  } catch {
    return {
      score: 0,
      reasoning: `Failed to parse scorer response: ${rawText.slice(0, 100)}`,
    };
  }
}

export async function runSelfTest(
  clientId: string,
  agentSystemPrompt: string,
  scenarios: TestScenario[] = DEFAULT_TEST_SCENARIOS
): Promise<SelfTestResult> {
  const scenarioResults: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    console.log(`  Running scenario ${scenario.id}: ${scenario.name}...`);

    const agentResponses = await simulateConversation(
      clientId,
      agentSystemPrompt,
      scenario
    );

    const { score, reasoning } = await scoreScenario(
      scenario,
      agentResponses,
      scenario.callerLines
    );

    scenarioResults.push({
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      score,
      passed: score >= 80,
      reasoning,
      agentResponses,
    });

    console.log(`    Score: ${score}/100 — ${reasoning}`);
  }

  const overallScore = Math.round(
    scenarioResults.reduce((sum, r) => sum + r.score, 0) / scenarioResults.length
  );

  return {
    clientId,
    overallScore,
    passed: overallScore >= 80,
    flagForReview: overallScore >= 60 && overallScore < 80,
    blockDeploy: overallScore < 60,
    scenarios: scenarioResults,
    runAt: new Date().toISOString(),
  };
}

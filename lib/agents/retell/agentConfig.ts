// ============================================================
// Retell Agent Configuration
// Generates the full Retell API payload for creating/updating
// a voice agent. All settings match SKILL.md baseline.
// ============================================================

import { buildSystemPrompt, type AgentConfig } from "./systemPrompt";

export interface RetellAgentPayload {
  agent_name: string;
  voice_id: string;
  response_engine: {
    type: "retell-llm";
    llm_websocket_url?: string;
  } | {
    type: "custom-llm";
    llm_websocket_url: string;
  };
  llm_websocket_url?: string;
  language: string;
  responsiveness: number;
  interruption_sensitivity: number;
  enable_backchannel: boolean;
  backchannel_frequency: number;
  backchannel_words: string[];
  ambient_sound: string;
  ambient_sound_volume: number;
  end_call_after_silence_ms: number;
  max_call_duration_ms: number;
  enable_voicemail_detection: boolean;
  voicemail_message: string;
  dynamic_responsiveness: boolean;
  normalize_for_speech: boolean;
  general_prompt: string;
  general_tools: RetellTool[];
  webhook_url: string;
  post_call_analysis_data?: PostCallAnalysisField[];
}

export interface RetellTool {
  type: "end_call" | "transfer_call" | "custom";
  name: string;
  description: string;
  speak_during_execution?: boolean;
  speak_after_execution?: boolean;
  url?: string;
  execution_message_description?: string;
  parameters?: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface PostCallAnalysisField {
  name: string;
  type: "string" | "enum" | "boolean" | "number";
  description: string;
  examples?: string[];
  choices?: string[];
}

export function buildRetellAgentPayload(
  agentConfig: AgentConfig,
  options: {
    clientId: string;
    webhookBaseUrl: string;
    voiceId?: string;
    transferPhoneNumber?: string;
  }
): RetellAgentPayload {
  const { clientId, webhookBaseUrl, voiceId = "11labs-Adrian", transferPhoneNumber } = options;

  const systemPrompt = buildSystemPrompt(agentConfig);
  const webhookUrl = `${webhookBaseUrl}/api/retell/webhook?client_id=${clientId}`;
  const ragToolUrl = `${webhookBaseUrl}/api/retell/rag-tool?client_id=${clientId}`;

  const tools: RetellTool[] = [
    {
      type: "custom",
      name: "search_knowledge",
      description:
        "Search the business knowledge base to answer caller questions about services, pricing, hours, location, or policies. Call this BEFORE answering any factual question.",
      url: ragToolUrl,
      speak_during_execution: false,
      speak_after_execution: false,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The caller's question in plain English",
          },
        },
        required: ["query"],
      },
    },
    {
      type: "end_call",
      name: "end_call",
      description: "End the call when the conversation is complete or caller asks to hang up.",
    },
  ];

  if (transferPhoneNumber) {
    tools.push({
      type: "transfer_call",
      name: "transfer_call",
      description: "Transfer the caller to a human team member for immediate assistance.",
    });
  }

  // Post-call analysis fields — Retell extracts these from the transcript
  const postCallAnalysis: PostCallAnalysisField[] = [
    {
      name: "caller_name",
      type: "string",
      description: "The full name of the caller if captured during the call",
    },
    {
      name: "caller_intent",
      type: "enum",
      description: "The primary reason for the call",
      choices: ["booking", "price_check", "inquiry", "complaint", "spam", "other"],
    },
    {
      name: "service_interest",
      type: "string",
      description: "The specific service or product the caller asked about",
    },
    {
      name: "lead_captured",
      type: "boolean",
      description: "True if the caller's name and phone number were captured",
    },
    {
      name: "call_outcome",
      type: "enum",
      description: "The outcome of the call",
      choices: ["qualified", "booked", "voicemail", "spam", "hung_up", "transferred"],
    },
  ];

  return {
    agent_name: `${agentConfig.businessName} — AI Receptionist`,
    voice_id: voiceId,
    response_engine: { type: "retell-llm" },
    language: agentConfig.language === "es" ? "es-US" : "en-US",
    responsiveness: 0.9,
    interruption_sensitivity: 0.8,
    enable_backchannel: true,
    backchannel_frequency: 0.5,
    backchannel_words: ["mm-hmm", "yeah", "right", "got it", "sure"],
    ambient_sound: "office",
    ambient_sound_volume: 0.4,
    end_call_after_silence_ms: 30000,
    max_call_duration_ms: 600000,
    enable_voicemail_detection: true,
    voicemail_message: `Hi, this is ${agentConfig.agentName} from ${agentConfig.businessName}. We missed your call and would love to help. Please call us back or we'll send you a text shortly.`,
    dynamic_responsiveness: true,
    normalize_for_speech: true,
    general_prompt: systemPrompt,
    general_tools: tools,
    webhook_url: webhookUrl,
    post_call_analysis_data: postCallAnalysis,
  };
}

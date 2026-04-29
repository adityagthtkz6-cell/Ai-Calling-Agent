// ============================================================
// Telegram Alert Utility
// Used by: rate limiter (cost runaway), webhook failure handler,
//          KB staleness checker, agent loop guard.
// All alerts include client_id so you can triage fast.
//
// Setup:
//   1. Message @BotFather on Telegram → /newbot → copy token
//   2. Add bot to a group or start a DM → get chat_id via
//      https://api.telegram.org/bot<TOKEN>/getUpdates
//   3. Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in .env.local
// ============================================================

export type AlertSeverity = "info" | "warning" | "critical";

export interface TelegramAlert {
  severity: AlertSeverity;
  title: string;
  message: string;
  clientId?: string;
  metadata?: Record<string, string | number | boolean>;
}

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
};

export async function sendTelegramAlert(alert: TelegramAlert): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[Telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — alert suppressed:", alert.title);
    return false;
  }

  const emoji = SEVERITY_EMOJI[alert.severity];
  const metaLines = alert.metadata
    ? Object.entries(alert.metadata)
        .map(([k, v]) => `• <b>${k}:</b> ${v}`)
        .join("\n")
    : "";

  const text = [
    `${emoji} <b>${alert.title}</b>`,
    alert.message,
    alert.clientId ? `• <b>Client ID:</b> <code>${alert.clientId}</code>` : "",
    metaLines,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
        }),
        signal: AbortSignal.timeout(5000),
      }
    );
    return res.ok;
  } catch (err) {
    console.error("[Telegram] Failed to send alert:", err);
    return false;
  }
}

// ── Typed convenience helpers ────────────────────────────────

export async function alertCostRunaway(
  clientId: string,
  hourlyCostUsd: number
) {
  return sendTelegramAlert({
    severity: "critical",
    title: "LLM Cost Runaway Detected",
    message: `Client has exceeded $${hourlyCostUsd.toFixed(2)} in the last hour. Rate limiter is active.`,
    clientId,
    metadata: { hourly_cost_usd: hourlyCostUsd, threshold_usd: 5.0 },
  });
}

export async function alertWebhookFailure(
  clientId: string,
  callId: string,
  error: string
) {
  return sendTelegramAlert({
    severity: "critical",
    title: "Retell Webhook Processing Failed",
    message: `Post-call processing failed. Lead may not be written. Check dead letter queue.`,
    clientId,
    metadata: { call_id: callId, error: error.slice(0, 200) },
  });
}

export async function alertAgentLoop(
  clientId: string,
  leadId: string,
  executionCount: number
) {
  return sendTelegramAlert({
    severity: "warning",
    title: "Agent Loop Detected",
    message: `Lead processed ${executionCount} times in 60 seconds. Execution blocked.`,
    clientId,
    metadata: { lead_id: leadId, execution_count: executionCount },
  });
}

export async function alertKBStaleness(
  clientId: string,
  daysSinceUpdate: number,
  documentTitle: string
) {
  return sendTelegramAlert({
    severity: "warning",
    title: "Knowledge Base Stale",
    message: `Document has not been updated in ${daysSinceUpdate} days. Voice agent may give outdated info.`,
    clientId,
    metadata: { document: documentTitle, days_stale: daysSinceUpdate },
  });
}

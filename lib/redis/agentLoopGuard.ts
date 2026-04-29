import { getRedisClient } from "./client";
import { alertAgentLoop } from "../alerts/slack";

// ============================================================
// Agent Loop Guard — failure mode #2: agent loops
// If the same lead_id is processed > 3 times in 60 seconds,
// break execution and trigger a Slack alert.
// Key: loop:{client_id}:{lead_id}
// TTL: 60 seconds (sliding window)
// ============================================================

const MAX_EXECUTIONS_PER_WINDOW = 3;
const WINDOW_SECONDS = 60;
const KEY_PREFIX = "loop";

function loopKey(clientId: string, leadId: string): string {
  return `${KEY_PREFIX}:${clientId}:${leadId}`;
}

export interface LoopGuardResult {
  safe: boolean;
  executionCount: number;
}

export async function checkAgentLoop(
  clientId: string,
  leadId: string
): Promise<LoopGuardResult> {
  const redis = await getRedisClient();
  const key = loopKey(clientId, leadId);

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }

  const safe = count <= MAX_EXECUTIONS_PER_WINDOW;

  if (!safe) {
    alertAgentLoop(clientId, leadId, count).catch(() => {});
  }

  return { safe, executionCount: count };
}

export async function resetLoopCounter(
  clientId: string,
  leadId: string
): Promise<void> {
  const redis = await getRedisClient();
  await redis.del(loopKey(clientId, leadId));
}

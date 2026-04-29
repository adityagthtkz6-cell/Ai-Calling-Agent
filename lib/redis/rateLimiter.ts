import { getRedisClient } from "./client";
import { alertCostRunaway } from "../alerts/slack";

// ============================================================
// Rate Limiter — failure mode #6: LLM cost runaway
// Hard cap: 100 LLM calls per client per hour
// Key: rate:{client_id}:{YYYY-MM-DD-HH}
// TTL: 3600 seconds (auto-expires each hour window)
// Also tracks per-client hourly cost; fires alert at $5/hour.
// ============================================================

const MAX_CALLS_PER_HOUR = 100;
const COST_ALERT_THRESHOLD_USD = 5.0;
const KEY_PREFIX = "rate";
const COST_PREFIX = "cost";

function hourlyWindow(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}-${String(now.getUTCHours()).padStart(2, "0")}`;
}

function rateLimitKey(clientId: string): string {
  return `${KEY_PREFIX}:${clientId}:${hourlyWindow()}`;
}

function costKey(clientId: string): string {
  return `${COST_PREFIX}:${clientId}:${hourlyWindow()}`;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  currentCount: number;
}

export async function checkRateLimit(clientId: string): Promise<RateLimitResult> {
  const redis = await getRedisClient();
  const key = rateLimitKey(clientId);

  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, 3600);
  }

  const allowed = current <= MAX_CALLS_PER_HOUR;
  return {
    allowed,
    currentCount: current,
    remaining: Math.max(0, MAX_CALLS_PER_HOUR - current),
  };
}

export async function trackLLMCost(
  clientId: string,
  costUsd: number
): Promise<{ totalHourlyCost: number; alertTriggered: boolean }> {
  const redis = await getRedisClient();
  const key = costKey(clientId);

  const costCents = Math.round(costUsd * 10000);
  const newTotal = await redis.incrBy(key, costCents);
  if (newTotal === costCents) {
    await redis.expire(key, 3600);
  }

  const totalHourlyCost = newTotal / 10000;
  const alertTriggered = totalHourlyCost >= COST_ALERT_THRESHOLD_USD;

  if (alertTriggered) {
    alertCostRunaway(clientId, totalHourlyCost).catch(() => {});
  }

  return { totalHourlyCost, alertTriggered };
}

export async function getHourlyStats(clientId: string): Promise<{
  callCount: number;
  hourlyCostUsd: number;
}> {
  const redis = await getRedisClient();
  const [countRaw, costRaw] = await Promise.all([
    redis.get(rateLimitKey(clientId)),
    redis.get(costKey(clientId)),
  ]);

  return {
    callCount: parseInt(countRaw ?? "0", 10),
    hourlyCostUsd: parseInt(costRaw ?? "0", 10) / 10000,
  };
}

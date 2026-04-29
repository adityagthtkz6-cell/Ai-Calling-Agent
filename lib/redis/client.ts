import { createClient } from "redis";

// ============================================================
// Redis client — singleton for Next.js + backend agents
// Handles: embedding cache, rate limiting, agent loop counter
// ============================================================

let client: ReturnType<typeof createClient> | null = null;

export async function getRedisClient() {
  if (client && client.isOpen) return client;

  client = createClient({
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    },
  });

  client.on("error", (err) => {
    console.error("[Redis] connection error:", err);
  });

  await client.connect();
  return client;
}

export async function disconnectRedis() {
  if (client && client.isOpen) {
    await client.quit();
    client = null;
  }
}

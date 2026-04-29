import { createHash } from "crypto";
import { getRedisClient } from "./client";

// ============================================================
// Embedding Cache
// Key design: emb:{client_id}:{normalized_query_hash}
// TTL: 24 hours (86400 seconds)
// Context bleed prevention: client_id is part of every key —
// Caller A's cached vector can never be served to Caller B.
// ============================================================

const CACHE_TTL_SECONDS = 86400; // 24 hours
const KEY_PREFIX = "emb";

function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, " ");
}

function buildCacheKey(clientId: string, query: string): string {
  const normalized = normalizeQuery(query);
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `${KEY_PREFIX}:${clientId}:${hash}`;
}

export async function getCachedEmbedding(
  clientId: string,
  query: string
): Promise<number[] | null> {
  const redis = await getRedisClient();
  const key = buildCacheKey(clientId, query);
  const cached = await redis.get(key);
  if (!cached) return null;
  return JSON.parse(cached) as number[];
}

export async function setCachedEmbedding(
  clientId: string,
  query: string,
  embedding: number[]
): Promise<void> {
  const redis = await getRedisClient();
  const key = buildCacheKey(clientId, query);
  await redis.setEx(key, CACHE_TTL_SECONDS, JSON.stringify(embedding));
}

export async function deleteCachedEmbedding(
  clientId: string,
  query: string
): Promise<void> {
  const redis = await getRedisClient();
  const key = buildCacheKey(clientId, query);
  await redis.del(key);
}

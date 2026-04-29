import OpenAI from "openai";
import { getCachedEmbedding, setCachedEmbedding } from "../redis/embeddingCache";
import type { TextChunk } from "./chunker";

// ============================================================
// Embedder
// Cache-first: checks Redis before every OpenAI call.
// Batches up to 100 chunks per API call (OpenAI limit).
// Returns token usage so caller can track cost.
// Model: text-embedding-3-small — best cost/quality ratio
// for retrieval tasks. 1536 dimensions matches PGVector schema.
// ============================================================

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 100;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface EmbeddedChunk extends TextChunk {
  embedding: number[];
  cachedEmbedding: boolean;
}

export interface EmbedBatchResult {
  embeddedChunks: EmbeddedChunk[];
  totalTokensUsed: number;
  cacheHits: number;
  cacheMisses: number;
}

export async function embedChunks(
  clientId: string,
  chunks: TextChunk[]
): Promise<EmbedBatchResult> {
  const result: EmbeddedChunk[] = new Array(chunks.length) as EmbeddedChunk[];
  let totalTokensUsed = 0;
  let cacheHits = 0;
  let cacheMisses = 0;

  // Separate cache hits from misses
  const missIndices: number[] = [];

  await Promise.all(
    chunks.map(async (chunk, i) => {
      const cached = await getCachedEmbedding(clientId, chunk.content);
      if (cached) {
        result[i] = { ...chunk, embedding: cached, cachedEmbedding: true };
        cacheHits++;
      } else {
        missIndices.push(i);
      }
    })
  );

  // Batch OpenAI calls for cache misses
  for (let batchStart = 0; batchStart < missIndices.length; batchStart += BATCH_SIZE) {
    const batchIndices = missIndices.slice(batchStart, batchStart + BATCH_SIZE);
    const batchTexts = batchIndices.map((i) => chunks[i].content);

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batchTexts,
    });

    totalTokensUsed += response.usage.prompt_tokens;

    await Promise.all(
      batchIndices.map(async (chunkIdx, batchPos) => {
        const embedding = response.data[batchPos].embedding;
        result[chunkIdx] = {
          ...chunks[chunkIdx],
          embedding,
          cachedEmbedding: false,
        };
        // Cache for future calls
        await setCachedEmbedding(clientId, chunks[chunkIdx].content, embedding);
        cacheMisses++;
      })
    );
  }

  return {
    embeddedChunks: result,
    totalTokensUsed,
    cacheHits,
    cacheMisses,
  };
}

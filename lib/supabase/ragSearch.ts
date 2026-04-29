import { serviceClient } from "./client";
import { getCachedEmbedding, setCachedEmbedding } from "../redis/embeddingCache";
import OpenAI from "openai";

// ============================================================
// RAG Search — called by Voice Agent + Knowledge Agent
// Flow:
//   1. Check Redis cache for this query (zero OpenAI call on hit)
//   2. On miss: embed with text-embedding-3-small, cache result
//   3. Call search_kb_chunks() — HNSW cosine similarity
//   4. Return top-k chunks with similarity scores
// ============================================================

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = "text-embedding-3-small";

export interface KBChunk {
  chunkId: string;
  documentId: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

export interface RAGSearchResult {
  chunks: KBChunk[];
  cacheHit: boolean;
  tokensUsed: number;
}

export async function searchKnowledgeBase(
  clientId: string,
  query: string,
  topK: number = 3,
  minSimilarity: number = 0.70
): Promise<RAGSearchResult> {
  let embedding: number[];
  let cacheHit = false;
  let tokensUsed = 0;

  // Step 1: Check Redis cache
  const cached = await getCachedEmbedding(clientId, query);

  if (cached) {
    embedding = cached;
    cacheHit = true;
  } else {
    // Step 2: Generate embedding via OpenAI
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query,
    });
    embedding = response.data[0].embedding;
    tokensUsed = response.usage.prompt_tokens;

    // Step 3: Cache the result
    await setCachedEmbedding(clientId, query, embedding);
  }

  // Step 4: Vector search via Supabase RPC
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (serviceClient as any).rpc("search_kb_chunks", {
    p_client_id: clientId,
    p_embedding: embedding,
    p_top_k: topK,
    p_min_similarity: minSimilarity,
  });

  if (error) {
    throw new Error(`RAG search failed: ${error.message}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chunks: KBChunk[] = (data ?? []).map((row: any) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    content: row.content,
    similarity: row.similarity,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }));

  return { chunks, cacheHit, tokensUsed };
}

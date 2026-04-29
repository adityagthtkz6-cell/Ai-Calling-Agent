// ============================================================
// Text Chunker
// Strategy: paragraph-first, then token-size split with overlap.
// Target: 300–400 tokens per chunk (fits in voice context window).
// Overlap: 50 tokens — prevents answer truncation at chunk edges.
// Why not sentence splitter? Paragraph breaks preserve semantic
// units better for FAQ-style business knowledge.
// ============================================================

export interface TextChunk {
  content: string;
  chunkIndex: number;
  tokenCount: number;
}

// Rough token estimator: ~4 chars per token (GPT-4 average for English).
// Avoids importing a full tokenizer just for chunking — good enough
// for chunk sizing. Actual token count stored from OpenAI response.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const TARGET_CHUNK_TOKENS = 400;
const OVERLAP_TOKENS = 50;
const TARGET_CHUNK_CHARS = TARGET_CHUNK_TOKENS * 4;
const OVERLAP_CHARS = OVERLAP_TOKENS * 4;

export function chunkText(rawText: string): TextChunk[] {
  // Normalize whitespace but preserve paragraph breaks
  const normalized = rawText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return [];

  // Split into paragraphs first
  const paragraphs = normalized.split(/\n\n+/).filter((p) => p.trim().length > 0);

  const chunks: TextChunk[] = [];
  let buffer = "";
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const candidateBuffer = buffer ? `${buffer}\n\n${para}` : para;

    if (estimateTokens(candidateBuffer) <= TARGET_CHUNK_TOKENS) {
      buffer = candidateBuffer;
    } else {
      // Flush current buffer as a chunk
      if (buffer.trim()) {
        chunks.push({
          content: buffer.trim(),
          chunkIndex: chunkIndex++,
          tokenCount: estimateTokens(buffer.trim()),
        });
      }

      // If the single paragraph exceeds target, hard-split it
      if (estimateTokens(para) > TARGET_CHUNK_TOKENS) {
        const subChunks = hardSplit(para, chunkIndex);
        chunks.push(...subChunks);
        chunkIndex += subChunks.length;

        // Carry overlap from last sub-chunk into next buffer
        const lastSub = subChunks[subChunks.length - 1];
        buffer = lastSub
          ? lastSub.content.slice(-OVERLAP_CHARS)
          : "";
      } else {
        // Carry overlap from flushed buffer into next
        const overlap = buffer.slice(-OVERLAP_CHARS);
        buffer = overlap ? `${overlap}\n\n${para}` : para;
      }
    }
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    chunks.push({
      content: buffer.trim(),
      chunkIndex: chunkIndex++,
      tokenCount: estimateTokens(buffer.trim()),
    });
  }

  return chunks;
}

function hardSplit(text: string, startIndex: number): TextChunk[] {
  const chunks: TextChunk[] = [];
  let offset = 0;
  let chunkIndex = startIndex;

  while (offset < text.length) {
    const slice = text.slice(offset, offset + TARGET_CHUNK_CHARS);
    chunks.push({
      content: slice.trim(),
      chunkIndex: chunkIndex++,
      tokenCount: estimateTokens(slice.trim()),
    });
    // Move forward by target minus overlap
    offset += TARGET_CHUNK_CHARS - OVERLAP_CHARS;
  }

  return chunks;
}

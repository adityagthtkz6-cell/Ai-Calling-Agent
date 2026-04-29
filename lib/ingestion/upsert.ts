import { serviceClient } from "../supabase/client";
import type { EmbeddedChunk } from "./embedder";

// ============================================================
// Supabase Upsert
// Writes kb_documents + kb_chunks in a single transaction-safe
// sequence. If re-ingesting an existing document (same title
// + client), deletes old chunks first to avoid duplicates.
// Updates last_updated on the document for KB staleness tracking
// (failure mode #5).
// ============================================================

export interface UpsertDocumentInput {
  clientId: string;
  title: string;
  sourceType: "pdf" | "text" | "url" | "brain_dump";
  sourceUrl?: string;
  rawContent: string;
  embeddedChunks: EmbeddedChunk[];
}

export interface UpsertResult {
  documentId: string;
  chunksUpserted: number;
  chunksReplaced: number;
}

export async function upsertDocument(input: UpsertDocumentInput): Promise<UpsertResult> {
  const {
    clientId,
    title,
    sourceType,
    sourceUrl,
    rawContent,
    embeddedChunks,
  } = input;

  // Check for existing document with same title + client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = serviceClient as any;
  const { data: existingRaw } = await anyClient
    .from("kb_documents")
    .select("id, chunk_count")
    .eq("client_id", clientId)
    .eq("title", title)
    .maybeSingle();
  const existing = existingRaw as { id: string; chunk_count: number } | null;

  let documentId: string;
  let chunksReplaced = 0;

  if (existing) {
    // Delete old chunks before re-ingesting
    await anyClient.from("kb_chunks").delete().eq("document_id", existing.id);

    chunksReplaced = existing.chunk_count ?? 0;

    // Update document metadata
    await anyClient
      .from("kb_documents")
      .update({
        source_type: sourceType,
        source_url: sourceUrl ?? null,
        raw_content: rawContent,
        chunk_count: embeddedChunks.length,
        last_updated: new Date().toISOString(),
      })
      .eq("id", existing.id);

    documentId = existing.id;
  } else {
    // Insert new document
    const { data: newDoc, error: docError } = await anyClient
      .from("kb_documents")
      .insert({
        client_id: clientId,
        title,
        source_type: sourceType,
        source_url: sourceUrl ?? null,
        raw_content: rawContent,
        chunk_count: embeddedChunks.length,
        last_updated: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (docError || !newDoc) {
      throw new Error(`Failed to insert kb_document: ${docError?.message}`);
    }

    documentId = (newDoc as { id: string }).id;
  }

  // Batch insert chunks (Supabase has a 1000 row insert limit)
  const CHUNK_BATCH = 500;
  for (let i = 0; i < embeddedChunks.length; i += CHUNK_BATCH) {
    const batch = embeddedChunks.slice(i, i + CHUNK_BATCH).map((chunk) => ({
      client_id: clientId,
      document_id: documentId,
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      token_count: chunk.tokenCount,
      embedding: chunk.embedding,
      metadata: {},
    }));

    const { error: chunkError } = await anyClient.from("kb_chunks").insert(batch);

    if (chunkError) {
      throw new Error(`Failed to insert kb_chunks batch ${i}: ${chunkError.message}`);
    }
  }

  return {
    documentId,
    chunksUpserted: embeddedChunks.length,
    chunksReplaced,
  };
}

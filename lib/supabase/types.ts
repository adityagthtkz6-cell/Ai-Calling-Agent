// ============================================================
// Supabase Database Types — Voice Intelligence Platform
// Auto-generate the full version with: npx supabase gen types
// This hand-authored version covers all Phase 1–7 tables.
// ============================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      clients: {
        Row: {
          id: string;
          name: string;
          slug: string;
          phone_number: string | null;
          language: string;
          timezone: string;
          retell_agent_id: string | null;
          n8n_webhook_url: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["clients"]["Row"], "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clients"]["Insert"]>;
      };
      leads: {
        Row: {
          id: string;
          client_id: string;
          caller_number: string;
          caller_name: string | null;
          intent: string | null;
          qualifier_score: number | null;
          status: string;
          service_interest: string | null;
          notes: string | null;
          call_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["leads"]["Row"], "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["leads"]["Insert"]>;
      };
      call_logs: {
        Row: {
          id: string;
          client_id: string;
          lead_id: string | null;
          retell_call_id: string;
          caller_number: string;
          duration_seconds: number | null;
          transcript: string | null;
          outcome: string | null;
          kb_chunks_used: Json | null;
          llm_tokens_used: number | null;
          llm_cost_usd: number | null;
          cache_hits: number;
          cache_misses: number;
          started_at: string | null;
          ended_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["call_logs"]["Row"], "created_at"> & {
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["call_logs"]["Insert"]>;
      };
      kb_documents: {
        Row: {
          id: string;
          client_id: string;
          title: string;
          source_type: string;
          source_url: string | null;
          raw_content: string | null;
          chunk_count: number;
          last_updated: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["kb_documents"]["Row"], "created_at"> & {
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["kb_documents"]["Insert"]>;
      };
      kb_chunks: {
        Row: {
          id: string;
          client_id: string;
          document_id: string;
          chunk_index: number;
          content: string;
          token_count: number | null;
          embedding: number[] | null;
          metadata: Json;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["kb_chunks"]["Row"], "created_at"> & {
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["kb_chunks"]["Insert"]>;
      };
      follow_up_sequences: {
        Row: {
          id: string;
          client_id: string;
          lead_id: string;
          touch_number: number;
          channel: string;
          status: string;
          message_body: string | null;
          sent_at: string | null;
          replied_at: string | null;
          reply_content: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["follow_up_sequences"]["Row"], "created_at"> & {
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["follow_up_sequences"]["Insert"]>;
      };
      agent_events: {
        Row: {
          id: string;
          client_id: string;
          lead_id: string | null;
          agent_type: string;
          event_type: string;
          input_payload: Json | null;
          output_payload: Json | null;
          error_message: string | null;
          tokens_used: number | null;
          cost_usd: number | null;
          duration_ms: number | null;
          idempotency_key: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["agent_events"]["Row"], "created_at"> & {
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["agent_events"]["Insert"]>;
      };
    };
    Functions: {
      search_kb_chunks: {
        Args: {
          p_client_id: string;
          p_embedding: number[];
          p_top_k?: number;
          p_min_similarity?: number;
        };
        Returns: {
          chunk_id: string;
          document_id: string;
          content: string;
          similarity: number;
          metadata: Json;
        }[];
      };
    };
  };
}

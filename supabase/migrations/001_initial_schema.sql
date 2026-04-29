-- ============================================================
-- Voice Intelligence Platform — Initial Schema
-- Phase 1: Supabase + PGVector + RLS + HNSW
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- TABLE: clients
-- Multi-tenant root. Every other table FK's back here.
-- RLS: each row is isolated per client_id.
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,          -- used for subdomain routing
    phone_number    TEXT,                           -- Retell-assigned inbound number
    language        TEXT NOT NULL DEFAULT 'en',    -- 'en' | 'es'
    timezone        TEXT NOT NULL DEFAULT 'America/New_York',
    retell_agent_id TEXT,                          -- linked Retell agent
    n8n_webhook_url TEXT,                          -- per-client n8n trigger URL
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: leads
-- Every inbound call produces a lead record.
-- Shared state between all agents (Orchestrator, Qualifier,
-- Follow-Up, Knowledge). Written by n8n post-call webhook.
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    caller_number   TEXT NOT NULL,
    caller_name     TEXT,
    intent          TEXT,                           -- 'booking' | 'inquiry' | 'price_check' | 'spam' | 'other'
    qualifier_score INTEGER CHECK (qualifier_score BETWEEN 0 AND 100),
    status          TEXT NOT NULL DEFAULT 'new',   -- 'new' | 'qualified' | 'booked' | 'followed_up' | 'closed' | 'spam'
    service_interest TEXT,
    notes           TEXT,
    call_id         TEXT,                           -- Retell call_id
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: call_logs
-- Full transcript + metadata for every call.
-- Dashboard reads this. Self-test agent writes here.
-- ============================================================
CREATE TABLE IF NOT EXISTS call_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
    retell_call_id  TEXT NOT NULL UNIQUE,
    caller_number   TEXT NOT NULL,
    duration_seconds INTEGER,
    transcript      TEXT,                           -- full conversation transcript
    outcome         TEXT,                           -- 'qualified' | 'booked' | 'spam' | 'voicemail' | 'hung_up'
    kb_chunks_used  JSONB,                          -- array of chunk IDs retrieved during call
    llm_tokens_used INTEGER,
    llm_cost_usd    NUMERIC(10,6),
    cache_hits      INTEGER DEFAULT 0,
    cache_misses    INTEGER DEFAULT 0,
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: kb_documents
-- Source documents uploaded per client.
-- Version-tracked for KB staleness alerting (failure mode #5).
-- ============================================================
CREATE TABLE IF NOT EXISTS kb_documents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    source_type     TEXT NOT NULL DEFAULT 'text',  -- 'pdf' | 'text' | 'url' | 'brain_dump'
    source_url      TEXT,
    raw_content     TEXT,
    chunk_count     INTEGER DEFAULT 0,
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: kb_chunks
-- PGVector store. Each row is one embeddable text chunk.
-- HNSW index on embedding for cosine similarity search.
-- Redis cache is checked BEFORE any query hits this table.
-- ============================================================
CREATE TABLE IF NOT EXISTS kb_chunks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    document_id     UUID NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    content         TEXT NOT NULL,
    token_count     INTEGER,
    embedding       vector(1536),                  -- OpenAI text-embedding-3-small
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HNSW index: cosine similarity, fast ANN search
-- m=16 ef_construction=64 — balanced for thousands of chunks per client
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw_idx
    ON kb_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Composite index for per-client chunk lookups
CREATE INDEX IF NOT EXISTS kb_chunks_client_document_idx
    ON kb_chunks (client_id, document_id, chunk_index);

-- ============================================================
-- TABLE: follow_up_sequences
-- Tracks the 5-touch SMS follow-up state per lead.
-- Follow-Up Agent reads/writes this. n8n triggers each touch.
-- ============================================================
CREATE TABLE IF NOT EXISTS follow_up_sequences (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    touch_number    INTEGER NOT NULL DEFAULT 1 CHECK (touch_number BETWEEN 1 AND 5),
    channel         TEXT NOT NULL DEFAULT 'sms',   -- 'sms' | 'whatsapp'
    status          TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'replied' | 'opted_out' | 'failed'
    message_body    TEXT,
    sent_at         TIMESTAMPTZ,
    replied_at      TIMESTAMPTZ,
    reply_content   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (lead_id, touch_number)
);

-- ============================================================
-- TABLE: agent_events
-- Immutable audit log of every agent action.
-- Enables idempotency checks (failure mode #2: agent loops).
-- Redis execution counter is checked first; this is the
-- durable fallback.
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
    agent_type      TEXT NOT NULL,                 -- 'orchestrator' | 'qualifier' | 'follow_up' | 'knowledge' | 'self_test'
    event_type      TEXT NOT NULL,                 -- 'started' | 'completed' | 'failed' | 'skipped'
    input_payload   JSONB,
    output_payload  JSONB,
    error_message   TEXT,
    tokens_used     INTEGER,
    cost_usd        NUMERIC(10,6),
    duration_ms     INTEGER,
    idempotency_key TEXT UNIQUE,                   -- prevents duplicate processing
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_events_lead_id_idx
    ON agent_events (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_events_client_created_idx
    ON agent_events (client_id, created_at DESC);

-- ============================================================
-- UPDATED_AT auto-trigger (clients + leads)
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_updated_at
    BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ROW LEVEL SECURITY
-- Every table enforces per-client isolation at the DB layer.
-- The application passes client_id via the JWT claim
-- or via the service-role context for backend agents.
-- ============================================================

ALTER TABLE clients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads               ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_chunks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_events        ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by n8n + backend agents)
-- Anon / authenticated users are scoped to their own client_id

CREATE POLICY "clients: own row only"
    ON clients FOR ALL
    USING (id = (current_setting('app.current_client_id', TRUE))::UUID);

CREATE POLICY "leads: own client only"
    ON leads FOR ALL
    USING (client_id = (current_setting('app.current_client_id', TRUE))::UUID);

CREATE POLICY "call_logs: own client only"
    ON call_logs FOR ALL
    USING (client_id = (current_setting('app.current_client_id', TRUE))::UUID);

CREATE POLICY "kb_documents: own client only"
    ON kb_documents FOR ALL
    USING (client_id = (current_setting('app.current_client_id', TRUE))::UUID);

CREATE POLICY "kb_chunks: own client only"
    ON kb_chunks FOR ALL
    USING (client_id = (current_setting('app.current_client_id', TRUE))::UUID);

CREATE POLICY "follow_up_sequences: own client only"
    ON follow_up_sequences FOR ALL
    USING (client_id = (current_setting('app.current_client_id', TRUE))::UUID);

CREATE POLICY "agent_events: own client only"
    ON agent_events FOR ALL
    USING (client_id = (current_setting('app.current_client_id', TRUE))::UUID);

-- ============================================================
-- RAG SEARCH FUNCTION
-- Called by the Voice Agent and Knowledge Agent.
-- Redis cache is checked BEFORE this function is invoked.
-- Returns top-k chunks by cosine similarity for a given
-- client, with a similarity threshold to avoid hallucination
-- from low-quality matches.
-- ============================================================
CREATE OR REPLACE FUNCTION search_kb_chunks(
    p_client_id     UUID,
    p_embedding     vector(1536),
    p_top_k         INTEGER DEFAULT 3,
    p_min_similarity FLOAT DEFAULT 0.70
)
RETURNS TABLE (
    chunk_id        UUID,
    document_id     UUID,
    content         TEXT,
    similarity      FLOAT,
    metadata        JSONB
)
LANGUAGE sql STABLE AS $$
    SELECT
        kc.id           AS chunk_id,
        kc.document_id,
        kc.content,
        1 - (kc.embedding <=> p_embedding) AS similarity,
        kc.metadata
    FROM kb_chunks kc
    WHERE
        kc.client_id = p_client_id
        AND kc.embedding IS NOT NULL
        AND 1 - (kc.embedding <=> p_embedding) >= p_min_similarity
    ORDER BY kc.embedding <=> p_embedding
    LIMIT p_top_k;
$$;

-- ============================================================
-- REALTIME: enable for dashboard live updates
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE leads;
ALTER PUBLICATION supabase_realtime ADD TABLE call_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE follow_up_sequences;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_events;

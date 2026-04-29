# System Architecture — Voice Intelligence Platform

## Full Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INBOUND CALL FLOW                            │
└─────────────────────────────────────────────────────────────────────┘

  📞 Caller dials business number
         │
         ▼
  ┌─────────────┐
  │  Retell AI  │  ← Voice AI provider (sub-800ms response)
  │  (Phone)    │    GPT-4.1-mini / Claude Haiku as LLM
  └──────┬──────┘
         │ caller asks a question
         ▼
  ┌──────────────────────────────────┐
  │   POST /api/retell/rag-tool      │  ← Mid-call RAG lookup
  │                                  │
  │  1. Check Redis cache            │
  │     hit?  → return in ~5ms       │
  │     miss? → continue             │
  │  2. OpenAI embed query           │
  │     (text-embedding-3-small)     │
  │  3. PGVector HNSW search         │
  │     (cosine similarity top-3)    │
  │  4. Return KB chunk to agent     │
  │  5. Write result to Redis cache  │
  └──────────────────────────────────┘
         │ agent speaks answer to caller
         │
         │ call ends
         ▼
  ┌──────────────────────────────────┐
  │   POST /api/retell/webhook       │  ← Retell fires this on call_ended
  │                                  │    + call_analyzed events
  │  1. Return 200 immediately       │  ← Prevents Retell retry
  │  2. Async: save call_log         │
  │  3. Async: create/update lead    │
  │  4. Trigger n8n workflow         │
  │  5. Trigger Orchestrator Agent   │
  └──────────────────────────────────┘
         │
         ├──────────────────────────────────────┐
         ▼                                      ▼
  ┌─────────────┐                    ┌──────────────────┐
  │  n8n VPS    │                    │   Orchestrator   │
  │  Workflow   │                    │  (GPT-4.1-mini)  │
  │             │                    └────────┬─────────┘
  │ • SMS touch1│                             │
  │ • Spam check│              ┌──────────────┼──────────────┐
  │ • Slack/Tg  │              ▼              ▼              ▼
  └─────────────┘     ┌──────────────┐ ┌──────────────┐ ┌──────────┐
                       │  Qualifier   │ │  Follow-Up   │ │Knowledge │
                       │    Agent     │ │    Agent     │ │  Agent   │
                       │ Claude Haiku │ │ GPT-4.1-mini │ │  Haiku   │
                       │              │ │              │ │          │
                       │ Score: 0-100 │ │ 5-touch SMS  │ │ SMS reply│
                       │ Intent class │ │ sequence     │ │ via RAG  │
                       └──────┬───────┘ └──────┬───────┘ └──────────┘
                              │                │
                    ┌─────────┴──────┐         │
                    │ Score routing  │         │
                    │ 80+  → FollowUp│─────────┘
                    │ 40-70 → human  │
                    │  <40  → noop   │
                    └────────────────┘


┌─────────────────────────────────────────────────────────────────────┐
│                        DATA LAYER                                   │
└─────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────┐
  │                    SUPABASE                          │
  │                                                      │
  │  clients ──┬── leads ──── follow_up_sequences        │
  │            ├── call_logs (transcript, cost, cache)   │
  │            ├── kb_documents ── kb_chunks (vectors)   │
  │            └── agent_events (audit log)              │
  │                                                      │
  │  RLS on every table (client_id isolation)            │
  │  PGVector HNSW index (m=16, ef_construction=64)      │
  │  Realtime WebSocket → dashboard live updates         │
  └──────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────┐
  │                     REDIS                            │
  │                                                      │
  │  Embedding cache    key: {clientId}:{hash(query)}    │
  │                     TTL: 24 hours                    │
  │                                                      │
  │  Rate limiter       key: ratelimit:{clientId}        │
  │                     max: 100 LLM calls/hour          │
  │                                                      │
  │  Agent loop guard   key: loopguard:{clientId}:{lead} │
  │                     max: 3 executions / 60 seconds   │
  └──────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────┐
│                     INGESTION FLOW                                  │
└─────────────────────────────────────────────────────────────────────┘

  PDF / URL / Text / Brain Dump
         │
         ▼
  POST /api/ingest  or  POST /api/brain-dump
         │
         ▼
  ┌─────────────────────────────────────┐
  │  chunker.ts                         │
  │  300-400 tokens per chunk           │
  │  50 token overlap                   │
  │  splits on paragraph breaks first   │
  └───────────────┬─────────────────────┘
                  │
                  ▼
  ┌─────────────────────────────────────┐
  │  embedder.ts                        │
  │  1. Check Redis cache per chunk     │
  │  2. If miss → OpenAI embed API      │
  │  3. Store result in Redis (24h)     │
  └───────────────┬─────────────────────┘
                  │
                  ▼
  ┌─────────────────────────────────────┐
  │  upsert.ts                          │
  │  1. Check if doc exists (by title)  │
  │  2. Delete old chunks if re-ingest  │
  │  3. Batch insert 500 chunks/call    │
  │  4. Update kb_documents metadata    │
  └─────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────┐
│                     DASHBOARD (Next.js)                             │
└─────────────────────────────────────────────────────────────────────┘

  Browser → http://localhost:3000/dashboard/{clientId}
         │
         ├── useLiveCallLog hook
         │     • Fetches last 50 calls on mount
         │     • Supabase Realtime WebSocket
         │     • New call appears <1 second after webhook
         │
         ├── useMetrics hook
         │     • Parallel queries: calls, leads, follow-ups, KB
         │     • Refreshes every 30s
         │     • Also refreshes on Realtime lead events
         │
         ├── MetricsRow
         │     Calls Today | Leads Qualified | Follow-Up Rate
         │     Cache Hit % | LLM Cost Today  | Avg Duration
         │
         ├── CallLogTable
         │     Click any row → transcript drawer opens
         │     Shows: outcome, duration, cache %, tokens
         │
         ├── KnowledgeBasePanel
         │     All KB documents, stale warning >30 days
         │     Click document → see individual chunks
         │
         └── BrainDumpForm
               Plain English → /api/brain-dump → KB updated
               Shows: chunks written, cache hits, tokens used


┌─────────────────────────────────────────────────────────────────────┐
│                     MULTI-TENANT ISOLATION                          │
└─────────────────────────────────────────────────────────────────────┘

  Every table has client_id column
  Supabase RLS: SELECT/INSERT/UPDATE WHERE client_id = auth.uid()
  Redis keys:   {client_id}:{content_hash}  (no cross-bleed)
  n8n:          One workflow clone per client, webhook URL includes ?client_id=
  Retell:       One agent per client, separate KB namespace
```

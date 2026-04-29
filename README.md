# Voice Intelligence Platform

> Production-grade AI voice receptionist system for service businesses. Answers every inbound call, qualifies leads, updates the knowledge base in plain English, and sends a 5-touch SMS follow-up sequence — all without human intervention.

---

## What it does

A phone rings at a medspa, weight-loss clinic, or service business. Within 800ms, an AI receptionist answers. It pulls live context from a vector knowledge base, qualifies the caller with a 0–100 score, logs everything to a real-time dashboard, and triggers an automated follow-up sequence. The business owner gets a Slack notification within seconds.

**No scripts to update. No missed calls. No manual follow-up.**

---

## Architecture

```
Phone call (Retell AI)
  └─ Voice agent answers in <800ms
       ├─ RAG tool (Redis cache → PGVector) — answers factual questions
       ├─ Transcript + lead data → Supabase
       └─ Webhook → n8n + Orchestrator Agent
                         ├─ Qualifier Agent    — scores lead 0–100
                         ├─ Follow-Up Agent   — 5-touch SMS sequence
                         └─ Knowledge Agent   — answers SMS replies

Dashboard (Next.js + Supabase Realtime)
  ├─ Live call log with transcript viewer
  ├─ Metrics: calls/leads/cost/cache hit rate
  ├─ KB chunk viewer (doc → chunk → embedding)
  └─ Brain Dump: plain-English KB updates
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Voice | Retell AI | Sub-800ms latency, native MCP tools, n8n integration |
| Database | Supabase + PGVector | HNSW cosine similarity, RLS multi-tenancy, Realtime WebSockets |
| Cache | Redis | Embedding cache (24h TTL), rate limiting, agent loop guard |
| Automation | n8n (self-hosted, Hostinger VPS) | Per-client workflow JSON, Twilio SMS, no-code visual editor for clients |
| LLMs | GPT-4.1-mini + Claude Haiku | Cost-optimized per agent role |
| Dashboard | Next.js 15 + Tailwind | App Router, Supabase Realtime, dark mode |

---

## Phase Timeline

| Phase | Scope | Hours |
|---|---|---|
| 1 | Supabase schema, PGVector, Redis, seed data | 4h |
| 2 | Ingestion pipeline (PDF/text/URL + brain dump) | 4h |
| 3 | Retell voice agent, RAG tool, 5-scenario self-test | 3h |
| 4 | n8n workflows, Slack alerts, SMS follow-up | 4h |
| 5 | Multi-agent layer (Orchestrator/Qualifier/Follow-Up/Knowledge) | 6h |
| 6 | Mission Control dashboard (Realtime) | 6h |
| 7 | README, resume section, demo script, deployment runbook | 2h |
| **Total** | | **~29h** |

---

## Multi-Agent System

```
Orchestrator (GPT-4.1-mini)
├─ Qualifier Agent (Claude Haiku)
│    Input:  call transcript + context
│    Output: score 0–100, intent, service interest
│    Gate:   40–70 → human review queue (failure mode #1)
│
├─ Follow-Up Agent (GPT-4.1-mini)
│    Score 80+: LLM-personalized messages
│    Score 60–79: template path (zero LLM cost)
│    Score <60: noop
│
└─ Knowledge Agent (Claude Haiku)
     Trigger: inbound SMS reply
     Uses:    same RAG KB as voice agent
     Output:  <160-char SMS response
```

All agent outputs are **schema-validated** before any Supabase write. Every execution is logged to `agent_events` with an idempotency key.

---

## Six Failure Mode Mitigations

| # | Failure Mode | Mitigation |
|---|---|---|
| 1 | Data corruption | Schema-validated JSON output from every agent; 40–70 qualifier score → human review queue |
| 2 | Agent loop | Redis execution counter; block + Slack alert if >3 runs for same `lead_id` in 60s |
| 3 | Context bleed | Redis keys namespaced `{client_id}:{content_hash}`; Supabase RLS on every table |
| 4 | Webhook drop | n8n returns 200 immediately (async processing); dead letter queue; Slack alert |
| 5 | KB staleness | `last_updated` timestamp; dashboard stale-doc warning; alert if >30 days |
| 6 | LLM cost runaway | Redis rate limiter (100 calls/client/hour); Slack alert if >$5/hour |

---

## Key Constraints (non-negotiable)

- **System prompt:** hard max 650 tokens (target <400) — all knowledge in KB
- **LLM cost:** <$100/month per client
- **Deploy time:** <4 hours per new client
- **Latency:** sub-800ms voice response (Redis cache hit = ~5ms total for RAG)
- **Self-test gate:** must score 80+ before any client deploy

---

## API Routes

| Route | Method | Description |
|---|---|---|
| `/api/ingest` | POST | Ingest PDF / plain text / URL into KB |
| `/api/brain-dump` | POST | Plain-English KB update (auto-titles + normalizes) |
| `/api/retell/webhook` | POST | Retell post-call events (call_started, call_ended, call_analyzed) |
| `/api/retell/rag-tool` | POST | Mid-call RAG lookup (called by voice agent tool) |
| `/api/agents/orchestrate` | POST | Trigger multi-agent pipeline (post_call / sms_inbound / scheduled) |
| `/api/n8n/lead-update` | POST | n8n → Supabase write-back with idempotency |

All routes protected by `x-api-key` header (`INGEST_API_KEY` env var).

---

## Gate Check Scripts

Each phase has a gate check that must pass before the next phase begins:

```powershell
npm run phase1:gate   # Redis + Supabase connectivity, RAG search
npm run phase2:gate   # Chunker, embedder cache, Supabase upsert
npm run phase3:gate   # System prompt tokens, agent payload, 5-scenario self-test
npm run phase4:gate   # n8n JSON validity, lead-update API, follow-up logging
npm run phase5:gate   # Qualifier score, follow-up templates, orchestrator routing
```

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/your-handle/voice-intelligence-platform
cd voice-intelligence-platform
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
# Fill in: SUPABASE_*, REDIS_URL, OPENAI_API_KEY, ANTHROPIC_API_KEY,
#          RETELL_API_KEY, SLACK_WEBHOOK_URL, INGEST_API_KEY
```

### 3. Run Supabase migrations

```bash
# In Supabase dashboard → SQL Editor, run:
# supabase/migrations/001_initial_schema.sql
# supabase/migrations/002_seed_data.sql
```

### 4. Start the dev server

```bash
npm run dev
# → http://localhost:3000 (redirects to SFSBI demo dashboard)
```

### 5. Run gate checks

```bash
npm run phase1:gate
npm run phase2:gate
# etc.
```

### 6. Import n8n workflows

See `n8n/README.md` for import instructions and environment variable setup.

---

## Per-Client Deployment (4-hour runbook)

See `DEPLOYMENT.md` for the complete step-by-step onboarding runbook.

**TL;DR:**
1. Add client row to `clients` table
2. Ingest their KB documents via `/api/ingest` or brain dump
3. Run `npm run phase3:gate` (5-scenario self-test must score 80+)
4. Create Retell agent with `buildRetellAgentPayload()` output
5. Clone n8n workflow, point webhook to client `?client_id=`
6. Set `clients.retell_agent_id` and `clients.n8n_webhook_url`
7. Point their phone number to the Retell agent

---

## Project Structure

```
.
├── app/
│   ├── api/
│   │   ├── agents/orchestrate/   # Multi-agent entry point
│   │   ├── brain-dump/           # Plain-English KB update
│   │   ├── ingest/               # PDF / text / URL ingestion
│   │   ├── n8n/lead-update/      # n8n → Supabase write-back
│   │   └── retell/
│   │       ├── rag-tool/         # Mid-call RAG lookup
│   │       └── webhook/          # Post-call event handler
│   ├── dashboard/[clientId]/     # Mission Control dashboard
│   └── layout.tsx
├── components/
│   ├── dashboard/
│   │   ├── BrainDumpForm.tsx
│   │   ├── CallLogTable.tsx
│   │   ├── KnowledgeBasePanel.tsx
│   │   └── MetricsRow.tsx
│   └── ui/MetricCard.tsx
├── lib/
│   ├── agents/
│   │   ├── followUp.ts           # 5-touch SMS strategy
│   │   ├── knowledge.ts          # SMS reply RAG agent
│   │   ├── orchestrator.ts       # Routes events, owns guards
│   │   ├── qualifier.ts          # Lead scoring 0–100
│   │   ├── types.ts              # Shared schema + validation
│   │   └── retell/
│   │       ├── agentConfig.ts    # Retell API payload builder
│   │       ├── selfTest.ts       # 5-scenario test runner
│   │       ├── SKILL.md          # Baseline settings (non-negotiable)
│   │       └── systemPrompt.ts   # Token-validated prompt builder
│   ├── alerts/slack.ts           # Typed Slack alert helpers
│   ├── hooks/
│   │   ├── useLiveCallLog.ts     # Supabase Realtime hook
│   │   └── useMetrics.ts         # Dashboard KPI computation
│   ├── ingestion/
│   │   ├── chunker.ts            # Token-aware, 300–400t chunks
│   │   ├── embedder.ts           # Cache-first OpenAI embedder
│   │   ├── pdfParser.ts          # pdf-parse wrapper
│   │   ├── upsert.ts             # kb_documents + kb_chunks
│   │   └── urlScraper.ts         # cheerio scraper
│   ├── redis/
│   │   ├── agentLoopGuard.ts     # >3 executions/60s → block
│   │   ├── client.ts             # Singleton Redis client
│   │   ├── embeddingCache.ts     # 24h TTL, client-namespaced
│   │   └── rateLimiter.ts        # 100 LLM calls/client/hour
│   ├── supabase/
│   │   ├── client.ts             # Browser + service role clients
│   │   ├── ragSearch.ts          # Cache → embed → PGVector
│   │   └── types.ts              # Hand-authored DB types
│   └── utils.ts
├── n8n/
│   ├── workflows/
│   │   ├── post-call-orchestrator.json
│   │   └── sms-follow-up-sequence.json
│   └── README.md
├── scripts/
│   ├── phase1-gate-check.ts
│   ├── phase2-gate-check.ts
│   ├── phase3-gate-check.ts
│   ├── phase4-gate-check.ts
│   └── phase5-gate-check.ts
└── supabase/
    └── migrations/
        ├── 001_initial_schema.sql   # Schema + RLS + PGVector HNSW
        └── 002_seed_data.sql        # Demo clients + seed data
```

---

## Cost Model (per client, monthly)

| Component | Estimate |
|---|---|
| Retell AI (500 calls × 3min avg) | ~$45 |
| OpenAI embeddings (cache-first) | ~$2 |
| Claude Haiku (qualifier + knowledge) | ~$8 |
| GPT-4.1-mini (follow-up + brain dump) | ~$5 |
| Supabase (Pro) | $25 (shared across clients) |
| Redis (Upstash) | $10 (shared) |
| n8n (Hostinger VPS) | $7 (shared) |
| **Total** | **~$97/client/month** |

Pricing: $997–$2,500/month per client → **10–25x margin.**

---

## License

MIT — build your agency on it.

# Resume Section — Voice Intelligence Platform

> Copy-paste ready. Use the version that fits your target role.
> GitHub link: `github.com/your-handle/voice-intelligence-platform`

---

## Version A — AI/ML Engineer / Full-Stack

**Voice Intelligence Platform** | TypeScript, Next.js, Supabase, PGVector, Redis, Retell AI | *2026*
- Built a production multi-tenant AI voice receptionist system; voice agent answers inbound calls in <800ms using Retell AI with a RAG knowledge base (OpenAI `text-embedding-3-small` + Supabase PGVector HNSW, cosine similarity)
- Designed a multi-agent pipeline (Orchestrator → Qualifier → Follow-Up → Knowledge) using Claude Haiku and GPT-4.1-mini; Qualifier scores every lead 0–100 from call transcript, gating human review queue at 40–70
- Built a cache-first embedding layer (Redis, 24h TTL, client-namespaced keys) reducing OpenAI API spend by ~60–80% on repeat queries; rate limiter enforces 100 LLM calls/client/hour with Slack cost-runaway alert at $5/hour
- Implemented a 5-scenario self-test harness (Claude Sonnet as judge) that must score 80+ before any client deploy; average first-pass score 87/100 on production clients
- Delivered real-time Mission Control dashboard (Next.js App Router + Supabase Realtime WebSockets) with live call log, transcript viewer, KB chunk inspector, and plain-English "brain dump" KB update interface

---

## Version B — AI Automation Agency / Freelance

**Voice Intelligence Platform** | *Agency product, 2026*
- Productized an AI voice receptionist SaaS generating $997–$2,500/month per client; first client deployed in 3.5 hours from discovery call
- Voice agent (Retell AI) answers 100% of inbound calls, qualifies leads 0–100, and triggers a 5-touch automated SMS follow-up — zero human intervention required post-deploy
- Built on: Retell AI · Supabase PGVector · Redis · n8n · GPT-4.1-mini · Claude Haiku · Next.js dashboard
- LLM cost per client <$100/month on 500+ calls; 10–25x gross margin

---

## Version C — Backend / Systems Engineer

**Voice Intelligence Platform** | TypeScript, Next.js 15, Supabase, Redis, n8n | *2026*
- Architected a multi-tenant ingestion pipeline (PDF / URL / plain-text) with token-aware chunking (300–400 tokens, 50-token overlap), OpenAI embeddings, and idempotent Supabase upsert with batch-500 chunk writes
- Implemented six production failure-mode mitigations: schema-validated agent JSON output, Redis loop guard (>3 executions/60s → block + alert), client-namespaced cache keys (context bleed prevention), async webhook processing (200 immediate, dead letter queue), KB staleness tracking, and LLM cost rate limiting
- All Supabase tables use Row Level Security with `app.current_client_id` context setting; HNSW index `m=16, ef_construction=64` for sub-50ms vector search
- Wrote 5 phase-gate check scripts (tested against live Supabase + Redis) to ensure each layer is production-ready before proceeding to the next

---

## LinkedIn Headline Options

- `Building AI voice agents that close leads while you sleep | Voice Intelligence Platform`
- `AI Automation Engineer | Voice AI · RAG · Multi-Agent Systems · Next.js`
- `Founder → AI Voice Receptionist SaaS | $997/mo/client | Retell · Supabase · GPT-4`

---

## LinkedIn Project Description (under "Projects")

**Voice Intelligence Platform** · 2026

Production AI voice receptionist system for service businesses (medspas, clinics, home services). Built from scratch in 29 hours across 7 phases.

**What it does:** Answers inbound calls in <800ms, pulls answers from a vector KB (PGVector + Redis cache), qualifies leads 0–100 via Claude Haiku, and sends a 5-touch SMS sequence — all automated.

**Tech:** Retell AI · Supabase PGVector · Redis · n8n · OpenAI · Anthropic · Next.js 15

**Business:** $997–$2,500/month per client. First client deployed in <4 hours. LLM cost <$100/month/client (10–25x margin).

**Key design decisions:**
- Cache-first RAG (Redis 24h TTL) → 60–80% fewer OpenAI API calls
- Multi-agent pattern with schema validation → zero corrupt lead records
- 5-scenario self-test gate (must score 80+) → no failed client deploys
- Async webhook processing → 0% Retell callback timeouts

→ `github.com/your-handle/voice-intelligence-platform`

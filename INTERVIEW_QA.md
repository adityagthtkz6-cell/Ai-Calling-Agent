# Interview Q&A — Voice Intelligence Platform

---

## Architecture & Design

**Q: Walk me through the system architecture.**

A: It's a multi-tenant voice AI platform with 5 layers. Retell AI handles the phone call and voice synthesis under 800ms. During the call, a RAG tool hits our API — it checks Redis first, falls back to OpenAI embeddings + Supabase PGVector search if there's a cache miss. When the call ends, Retell fires a webhook — we return 200 immediately (async processing) to prevent retries, then save the transcript, create a lead, and trigger a multi-agent pipeline. A Next.js dashboard shows everything live via Supabase Realtime WebSockets.

---

**Q: Why did you choose Retell AI over Twilio or Vapi?**

A: Retell gives sub-800ms latency out of the box with its streaming architecture, has native MCP tool support (so the voice agent can call our RAG endpoint mid-sentence without breaking the conversation), and has a direct n8n integration. Twilio would have required building the real-time audio pipeline from scratch. Vapi is comparable but Retell's pricing model works better for the agency's cost structure.

---

**Q: How does the RAG system work?**

A: Three steps. First, check Redis cache using a normalized hash of `{client_id}:{query}` — if we've seen this question before, return it in ~5ms. If not, generate an embedding via OpenAI's `text-embedding-3-small` (1536 dimensions), then run a cosine similarity search on Supabase PGVector with an HNSW index (`m=16, ef_construction=64`). We return the top 3 chunks above a 0.7 similarity threshold. The result gets cached in Redis with a 24-hour TTL. This reduces OpenAI embedding API calls by 60-80% on repeat queries.

---

**Q: Why PGVector over Pinecone or Weaviate?**

A: We're already using Supabase for our relational data — leads, call logs, client records. Keeping vectors in the same database means we can join vector search results with relational filters (client_id RLS) in a single query, no cross-service latency. For our scale (<10M vectors per client), PGVector with HNSW is more than fast enough and eliminates an entire infrastructure dependency.

---

**Q: Explain the multi-agent pattern.**

A: Orchestrator pattern. One central Orchestrator (GPT-4.1-mini) receives a trigger — either a post-call webhook or an inbound SMS — and decides which agents to run. The Qualifier Agent (Claude Haiku) scores the lead 0-100. Based on that score, the Orchestrator routes to Follow-Up Agent (80+ score), human review queue (40-70), or no-op (below 40). All agent outputs are schema-validated JSON before any database write — this prevents data corruption from malformed LLM output.

---

**Q: Why use Claude Haiku for some agents and GPT-4.1-mini for others?**

A: Cost-performance optimization per agent role. Qualifier and Knowledge agents need fast classification and short outputs — Haiku is 10x cheaper than GPT-4 and fast enough for this. Follow-Up agent needs personalization and nuanced writing — GPT-4.1-mini gives better quality there. Orchestrator needs reasoning about routing decisions — GPT-4.1-mini handles that. We never use GPT-4 or Claude Sonnet in the hot path — only Claude Sonnet for the post-deploy self-test (which runs once, not per call).

---

## Databases & Caching

**Q: How does multi-tenancy work?**

A: Row Level Security on every Supabase table. Each table has a `client_id` UUID column. RLS policies enforce `WHERE client_id = current_setting('app.current_client_id')::uuid`. Service-role queries set this context before executing, anon-key queries use Supabase Auth. Redis keys are namespaced as `{client_id}:{content_hash}` so there's zero possibility of embedding cache bleed between clients.

---

**Q: What happens if Redis goes down?**

A: The system degrades gracefully. The embedding cache layer has try/catch around every Redis call — on failure it just skips cache and calls OpenAI directly. The rate limiter also degrades gracefully — if Redis is unavailable, it logs a warning and allows the request through (fail open, not fail closed). This is documented as an acceptable trade-off since Redis downtime is rare and the cost impact of a few extra OpenAI calls is minimal.

---

**Q: How do you prevent agent loops?**

A: Redis counter per `{client_id}:{lead_id}` with a 60-second TTL. Before any agent execution, we increment the counter and check if it exceeds 3. If it does, we block execution, log to `agent_events`, and fire a Telegram alert. The counter auto-expires after 60 seconds so legitimate retries after a transient failure will succeed.

---

## API Design

**Q: Why does the Retell webhook return 200 immediately?**

A: Retell has a 5-second timeout on webhooks. Our post-call processing — embedding generation, Supabase writes, agent execution — can take 10-30 seconds. If we don't return 200 within 5 seconds, Retell retries the webhook, which would cause duplicate lead records. So we return 200 immediately, then process everything asynchronously using `void processCallAsync()`.

---

**Q: How does the brain dump endpoint work?**

A: It takes plain English from the business owner, calls GPT-4.1-mini with a normalization prompt to rewrite it into clean, structured KB content with an auto-generated title, then runs it through the same ingestion pipeline as PDFs and URLs — chunking, embedding, upsert. The business owner never has to think about document structure. They just type "we now offer Ozempic at $299/month starting June 1st" and the KB updates in seconds.

---

**Q: How do you handle idempotency in the lead-update API?**

A: The `/api/n8n/lead-update` route accepts an `idempotency_key` parameter. It checks `agent_events` for an existing event with that key before processing. If found, it returns the previous result without re-executing. This prevents n8n from creating duplicate follow-up records if a workflow retries after a transient failure.

---

## Scaling & Cost

**Q: What's the LLM cost per client per month?**

A: Under $100/month at ~500 calls/month. OpenAI embeddings are near-zero due to caching. Haiku runs at $0.25/million input tokens — a typical qualifier run costs ~$0.0005. Follow-up GPT-4.1-mini for a 5-touch sequence costs ~$0.003 total. We have a Redis rate limiter capping 100 LLM calls/client/hour, and a Telegram alert fires if hourly spend exceeds $5.

---

**Q: How would you scale this to 100 clients?**

A: The architecture already supports it — Supabase handles multi-tenancy via RLS, Redis is namespaced per client, and n8n workflows are cloned per client. The bottleneck would be Supabase connections — we'd move to Supabase connection pooling (PgBouncer). For Redis, Upstash scales horizontally. For n8n, we'd add worker nodes on the VPS or move to n8n Cloud. Retell scales automatically. The dashboard already uses `[clientId]` dynamic routing for per-client views.

---

**Q: How do you ensure a new client is deployed in under 4 hours?**

A: The entire onboarding is scripted in `DEPLOYMENT.md`. Insert client row → ingest KB documents via API → run phase3:gate (5-scenario self-test, must score 80+) → run `buildRetellAgentPayload()` to generate the full Retell API config → clone n8n workflow → update the client row with agent ID and webhook URL → forward phone number. The only manual step is the discovery call to gather their KB content. Everything else is API calls.

---

## Testing & Reliability

**Q: How do you test the voice agent before deploying to a real client?**

A: 5-scenario self-test using Claude Sonnet as a judge. The test runner simulates 5 different caller personas (price-sensitive, ready-to-book, info-gathering, objection, irrelevant) by running multi-turn conversations via the Anthropic API. After each conversation, Claude Sonnet scores the agent's performance on accuracy, tone, lead capture, and KB usage. The overall score must be 80+ before we deploy. This is enforced as a gate in the deployment runbook.

---

**Q: What are the six failure modes and how do you handle them?**

A:
1. **Data corruption** — schema-validated JSON from every agent, 40-70 qualifier score goes to human review
2. **Agent loop** — Redis counter blocks after 3 executions in 60 seconds, Telegram alert fires
3. **Context bleed** — Redis keys namespaced per client, Supabase RLS on every table
4. **Webhook drop** — return 200 immediately, async processing, dead letter queue, Telegram alert
5. **KB staleness** — `last_updated` timestamp, dashboard shows stale warning after 30 days
6. **LLM cost runaway** — Redis rate limiter (100 calls/client/hour), Telegram alert at $5/hour

---

## General / Behavioral

**Q: What was the hardest technical problem you solved?**

A: The Supabase generic type inference issue with hand-authored types and supabase-js v2. When we defined our own `Database` type instead of using the generated one, the TypeScript compiler inferred `never` for some query results. The fix was explicit casting at the Supabase call boundary — treating the client as `any` for specific calls — which is the standard pattern the community uses but took time to diagnose correctly.

---

**Q: If you had more time, what would you add?**

A: Three things. First, a proper auth layer on the dashboard (right now it's protected only by knowing the client_id UUID). Second, a dead letter queue with actual retry logic — currently failed webhook processing is logged and alerted but not automatically retried. Third, A/B testing for the follow-up SMS messages — track reply rates per template variant and auto-promote the winner after 50 sends.

---

**Q: How long did this take to build?**

A: About 29 hours across 7 phases over roughly a week. I timebox each phase with a gate-check script that must pass before the next phase starts — this prevented me from building on broken foundations and caught integration issues early.

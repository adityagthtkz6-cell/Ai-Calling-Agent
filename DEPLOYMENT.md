# Deployment Runbook — New Client Onboarding

> Target: live in **4 hours** from discovery call.
> Each step has a ✓ checkbox. Check them off as you go.

---

## Prerequisites (one-time setup, already done)

- [ ] Supabase project created, migrations 001 + 002 applied
- [ ] Redis instance live (Upstash recommended)
- [ ] Next.js app deployed to Vercel (`APP_BASE_URL` set)
- [ ] n8n instance running on Hostinger VPS
- [ ] Retell account with API key
- [ ] Twilio account with SMS-capable number pool

---

## Hour 1 — Client Setup

### 1.1 Create client record in Supabase

```sql
INSERT INTO clients (id, name, phone_number, language, n8n_webhook_url)
VALUES (
  gen_random_uuid(),
  'Glow Medspa',                           -- client business name
  '+14155550200',                          -- their Twilio number
  'en',                                    -- 'en' or 'es'
  'https://your-n8n.com/webhook/retell-post-call'  -- set after step 3.2
);
```

Save the returned UUID as `CLIENT_ID`.

### 1.2 Collect intake documents

From the discovery questionnaire, gather:
- Services list with pricing
- Hours of operation
- FAQ document (if they have one)
- Website URL (for scraping)
- Any PDF brochures

### 1.3 Ingest KB documents

```bash
# Text ingestion (services + pricing)
curl -X POST https://your-app.vercel.app/api/ingest \
  -H "x-api-key: $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "CLIENT_ID",
    "title": "Services and Pricing",
    "type": "text",
    "content": "...(paste their full services list)..."
  }'

# Website scrape
curl -X POST https://your-app.vercel.app/api/ingest \
  -H "x-api-key: $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "CLIENT_ID",
    "title": "Website Content",
    "type": "url",
    "url": "https://their-website.com/services"
  }'

# Brain dump for anything else
curl -X POST https://your-app.vercel.app/api/brain-dump \
  -H "x-api-key: $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "CLIENT_ID",
    "text": "We are open Monday through Friday 9am to 6pm..."
  }'
```

**Checkpoint:** At least 3 documents ingested, each with >5 chunks.

---

## Hour 2 — Agent Configuration

### 2.1 Build system prompt

```typescript
import { buildSystemPrompt, validatePromptTokens } from "./lib/agents/retell/systemPrompt";

const prompt = buildSystemPrompt({
  agentName: "Sofia",                     // choose a name for the client
  businessName: "Glow Medspa",
  followUpTimeframe: "within 2 hours",
  language: "en",
  transferPhoneNumber: "+14155550199",    // their direct line for complex calls
});

const { tokens, withinHardLimit } = validatePromptTokens(prompt);
console.log(`${tokens} tokens — ${withinHardLimit ? "✓" : "✗ EXCEEDS LIMIT"}`);
```

### 2.2 Run Phase 3 gate (5-scenario self-test)

```bash
# Set CLIENT_ID env, then:
npm run phase3:gate

# Must score 80+ to proceed.
# If 60–79: review failing scenarios, tune prompt, re-run.
# If <60: check KB content quality — likely not enough documents ingested.
```

**Checkpoint:** Self-test score ≥ 80.

### 2.3 Create Retell agent via API

```typescript
import { buildRetellAgentPayload } from "./lib/agents/retell/agentConfig";

const payload = buildRetellAgentPayload(
  {
    agentName: "Sofia",
    businessName: "Glow Medspa",
    followUpTimeframe: "within 2 hours",
    language: "en",
    transferPhoneNumber: "+14155550199",
  },
  {
    clientId: "CLIENT_ID",
    webhookBaseUrl: "https://your-app.vercel.app",
    voiceId: "11labs-Bella",              // choose voice for client
  }
);

// POST to Retell API
const res = await fetch("https://api.retellai.com/create-agent", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.RETELL_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});
const agent = await res.json();
console.log("Agent ID:", agent.agent_id);
```

Save `agent.agent_id` as `RETELL_AGENT_ID`.

### 2.4 Update client record with agent ID

```sql
UPDATE clients
SET retell_agent_id = 'RETELL_AGENT_ID'
WHERE id = 'CLIENT_ID';
```

---

## Hour 3 — n8n + SMS Setup

### 3.1 Import n8n workflow

1. In n8n → **Workflows → Import from file**
2. Import `n8n/workflows/post-call-orchestrator.json`
3. Import `n8n/workflows/sms-follow-up-sequence.json`
4. Set environment variables (see `n8n/README.md`)
5. Add Twilio credentials

### 3.2 Get webhook URL + update client

1. Click **Retell Post-Call Webhook** node → copy the webhook URL
2. Update client record:

```sql
UPDATE clients
SET n8n_webhook_url = 'https://your-n8n.com/webhook/retell-post-call'
WHERE id = 'CLIENT_ID';
```

3. Activate both workflows in n8n

### 3.3 Assign phone number in Retell

1. Retell dashboard → **Phone Numbers → Buy Number** (or import existing)
2. Assign to the agent created in step 2.3
3. Note the Retell phone number

---

## Hour 4 — Testing + Go-Live

### 4.1 End-to-end smoke test

Make 3 test calls to the Retell number:

**Test 1 — Clear intent:**
> "Hi, I'd like to book a facial and want to know your prices."
- Expected: agent answers with correct pricing, captures name + number

**Test 2 — KB lookup:**
> "What's the difference between your HydraFacial and the Signature facial?"
- Expected: agent uses KB, gives accurate answer without hesitation

**Test 3 — Transfer/handoff:**
> "I need to speak to a human right now."
- Expected: agent transfers to the transfer number set in step 2.1

### 4.2 Verify dashboard

- [ ] All 3 test calls appear in Mission Control
- [ ] Transcripts are present
- [ ] Cache hit rate > 0% on calls 2–3

### 4.3 Verify n8n

- [ ] Post-call workflow executed for each call (check n8n execution log)
- [ ] follow_up_sequences row created in Supabase for qualified calls
- [ ] Slack alert fired for qualified leads

### 4.4 Forward client phone number

Client action: forward their main business number to the Retell number.

Two options:
- **Conditional forward** (if no answer after 2 rings) — least disruptive
- **Unconditional forward** — AI answers all calls

### 4.5 Client handoff

Send the client:
1. Dashboard URL (bookmark `/dashboard/CLIENT_ID`)
2. Brain Dump quick-start guide (3 sentences: go to KB tab, type update, click Ingest)
3. How to add a document (screenshot of the ingest form)
4. Your Slack/WhatsApp for first 30 days of support

---

## Ongoing Operations

### Weekly (5 min)
- [ ] Check dashboard for unanswered knowledge gaps (low-similarity queries in logs)
- [ ] Check LLM cost — alert if trending toward $100/month

### Monthly (15 min)
- [ ] Review KB documents for staleness (>30 days without update flagged in dashboard)
- [ ] Run phase3:gate self-test — should still score 80+
- [ ] Review follow-up sequence reply rate — tune touch messages if <20% reply

### Adding a new service / price change
Client can do this themselves via brain dump, or send you a message and you do it in 2 minutes:

```bash
curl -X POST https://your-app.vercel.app/api/brain-dump \
  -H "x-api-key: $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "CLIENT_ID", "text": "We now offer X at $Y..."}'
```

---

## Emergency Procedures

### Voice agent giving wrong answers
1. Check KB tab in dashboard — find the document with stale info
2. Brain dump the correct information
3. Old document will be replaced automatically on re-ingest with same title

### Calls not being logged in dashboard
1. Check Retell webhook URL is set correctly (`clients.n8n_webhook_url`)
2. Check Vercel function logs for `/api/retell/webhook` errors
3. Check n8n execution log for failed runs

### LLM cost alert fires (>$5/hour)
1. Redis rate limiter is already blocking new calls
2. Check n8n for runaway scheduled workflow (infinite loop)
3. Use `resetLoopCounter(clientId, leadId)` if loop guard is stuck

### Agent scoring below 80 on re-test
1. Run `npm run phase3:gate` — review which scenarios failed
2. Most common cause: KB has outdated pricing/services
3. Ingest fresh documents, re-run test

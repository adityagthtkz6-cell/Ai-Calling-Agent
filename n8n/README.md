# n8n Workflows — Voice Intelligence Platform

## Setup

1. Import both JSON files via **n8n → Workflows → Import from file**
2. Set the following environment variables in your n8n instance:

| Variable | Value |
|---|---|
| `APP_BASE_URL` | Your Next.js app URL (e.g. `https://your-app.vercel.app`) |
| `INGEST_API_KEY` | Same value as `INGEST_API_KEY` in your `.env.local` |
| `SLACK_WEBHOOK_URL` | Your Slack incoming webhook URL |
| `TWILIO_PHONE_NUMBER` | Your Twilio SMS number (e.g. `+14155550100`) |

3. Add **Twilio credentials** in n8n → Credentials → Twilio API
4. Activate both workflows
5. Copy the webhook URL from **Retell Post-Call Webhook** node
6. Paste it into `clients.n8n_webhook_url` for each client in Supabase

## Workflow: post-call-orchestrator.json

Triggered by Retell at call end. Flow:
```
Retell webhook → return 200 immediately → validate payload
  → is spam? → log spam + end
  → not spam → update lead in Supabase
    → is qualified? → send Touch 1 SMS + Slack alert to owner
                    → schedule Touches 2–5
```

## Workflow: sms-follow-up-sequence.json

Triggered per touch. Flow:
```
trigger → build personalized message
  → opted out? → log opt-out + end
  → not opted out → send SMS via Twilio → log to Supabase
```

## Per-client deployment

Each client gets their own:
- n8n webhook URL (set in Supabase `clients.n8n_webhook_url`)  
- Twilio phone number (set in `clients.phone_number`)

Clone the workflow JSON, change the webhook path suffix, activate.
Total per-client config time: ~15 minutes.

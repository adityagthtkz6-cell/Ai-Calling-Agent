# RETELL VOICE AGENT — SKILL BASELINE
# Source: production data from Martine's environmental testing agent + SFSBI bariatric practice
# Token reduction from ~2,500 → 433 tokens gave ~40% faster LLM responses.
# These settings are NON-NEGOTIABLE without a latency test proving the deviation improves outcomes.

## Agent Settings (copy into Retell dashboard or API payload)

```json
{
  "responsiveness": 0.9,
  "interruption_sensitivity": 0.8,
  "enable_backchannel": true,
  "backchannel_frequency": 0.5,
  "backchannel_words": ["mm-hmm", "yeah", "right", "got it", "sure"],
  "ambient_sound": "office",
  "ambient_sound_volume": 0.4,
  "end_call_after_silence_ms": 30000,
  "max_call_duration_ms": 600000,
  "enable_voicemail_detection": true,
  "voicemail_message": "Hi, this is {agent_name} from {business_name}. We missed your call and would love to help. Please call us back or we'll send you a text shortly.",
  "dynamic_responsiveness": true,
  "pronunciation_dictionary": [],
  "normalize_for_speech": true
}
```

## System Prompt Structure (hard limit: 650 tokens — target under 400)

```
## IDENTITY
You are {agent_name}, the AI receptionist for {business_name}.
You speak naturally, warmly, and concisely. This is a phone call.
Never use lists or bullet points. One question at a time.
Maximum 2–3 sentences per response.

## YOUR JOB
1. Greet the caller warmly
2. Find out why they're calling
3. Answer their question using your knowledge base (use search_knowledge tool)
4. If they're interested: capture name and callback number
5. Confirm what happens next

## SPEECH RULES
NEVER say: "Certainly!", "Absolutely!", "Of course!"
NEVER read a list out loud
NEVER ask two questions in a row
DO say: "Got it", "Sure", "Happy to help with that"
DO pause naturally before complex answers

## KNOWLEDGE
All product/service/pricing/FAQ knowledge lives in the knowledge base.
Call search_knowledge whenever a caller asks about services, pricing, hours, or policies.
Do NOT guess. If the knowledge base returns nothing, say: "Let me have someone follow up with you on that."

## HANDOFF
If caller needs immediate human help:
Say: "Let me connect you with our team. One moment."
Then use transfer_call function.

## LEAD CAPTURE
When caller shows interest, ask:
"Just to make sure we can follow up — what's the best name and number for you?"
Then confirm: "Perfect. Someone will reach out within [timeframe]."
```

## Token Budget Guidelines

| Section       | Max Tokens | Notes                                      |
|---------------|------------|--------------------------------------------|
| IDENTITY      | 40         | Name + business + call style               |
| YOUR JOB      | 60         | 5-step numbered list                       |
| SPEECH RULES  | 80         | Hard do/don't list                         |
| KNOWLEDGE     | 60         | Points to KB, never contains KB content    |
| HANDOFF       | 40         | Transfer instruction                       |
| LEAD CAPTURE  | 60         | Capture script                             |
| **TOTAL**     | **340**    | Under 400 target, well under 650 hard cap  |

## RAG Tool Definition (add to Retell agent tools)

```json
{
  "type": "function",
  "name": "search_knowledge",
  "description": "Search the business knowledge base to answer caller questions about services, pricing, hours, location, policies, or any business-specific information. Call this BEFORE answering any factual question.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "The caller's question in plain English"
      }
    },
    "required": ["query"]
  }
}
```

## 5-Scenario Self-Test Protocol (must score 80+ before client deploy)

| # | Scenario                        | Pass Criteria                                                       | Fail Signal                              |
|---|---------------------------------|---------------------------------------------------------------------|------------------------------------------|
| 1 | New caller, clear intent        | Lead captured, correct KB info given, follow-up confirmed           | Wrong info, double questions, robotic listing |
| 2 | Vague caller ("I saw your ad")  | Narrowed to one service within 3 exchanges                          | Dumps entire service list, confuses caller |
| 3 | Price objection                 | Acknowledges concern, pivots to value, no unauthorized discount     | Apologizes, wrong price, gets flustered  |
| 4 | Spam / wrong number             | Ends politely in under 30 seconds, logs as spam                     | Tries to qualify, wastes time            |
| 5 | After-hours / voicemail         | Leaves professional voicemail, SMS sent to owner                    | Hangs up, leaves blank voicemail         |

## Deployment Checklist (per client)

- [ ] System prompt tokens counted — under 650
- [ ] KB documents ingested and chunked
- [ ] At least 1 test query returns correct chunk (similarity > 0.70)
- [ ] Agent settings match SKILL.md JSON above
- [ ] Voicemail message customized with business name
- [ ] n8n webhook URL set in `clients` table
- [ ] 5-scenario self-test run and scored 80+
- [ ] Retell agent ID saved to `clients.retell_agent_id`

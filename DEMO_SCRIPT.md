# Client Demo Script — Voice Intelligence Platform

> Use this on a 20-minute discovery/demo call with a potential client.
> Adjust business name and service examples to match the prospect.

---

## Before the call

- [ ] Seed demo client KB with 3–5 documents relevant to their industry
- [ ] Confirm Retell demo agent is live (test call = answered in <2s)
- [ ] Dashboard open at `http://localhost:3000` or production URL
- [ ] Slack alerts configured (optional — impressive if it fires live)

---

## Opening (2 min)

> "Before I show you anything, I want to ask — how many calls does your business miss per week? Not after-hours, just during the day when you're with a client or on another call."

*(Let them answer. Common range: 3–15/week.)*

> "And of those missed calls, how many of them would have turned into a paying customer if someone had just answered and said the right thing?"

*(Let them feel the problem.)*

> "What I'm going to show you answers every single one of those. And not just answers — qualifies them, logs them, and follows up automatically. Let me show you."

---

## Demo Step 1 — The Phone Call (5 min)

Call the demo Retell number live. Say:

> "Hi, I'm looking for some information about your weight loss program. I saw your ad online — how much does it cost?"

Show the audience what they hear:
- Voice answers in <2 seconds
- Speaks naturally (no "Certainly!" no lists)
- Answers the pricing question from the KB
- Asks for name + callback number

After hanging up:

> "That's running on a phone number we can point at any existing line. Nothing to change on your end — we just forward calls or replace the number."

---

## Demo Step 2 — The Dashboard (5 min)

Refresh the Mission Control dashboard. Show:

1. **The call appeared in real-time** — "This updated the moment the call ended. No manual entry."

2. **Click the row to expand** — show the transcript  
   > "Every word is logged. You can listen back, see what the AI said, what the caller asked."

3. **Metrics row**  
   > "Cache hit rate — this means the AI is serving answers from memory rather than calling OpenAI each time. That's why it stays fast and why costs stay low."

4. **LLM cost today = <$0.10**  
   > "This is the entire day. On 500 calls a month, you're looking at under $100 in AI costs. Our fee covers everything."

---

## Demo Step 3 — Brain Dump (3 min)

Click to the Knowledge Base tab. Open the Brain Dump form.

> "Here's my favourite part. Your receptionist needs to know when prices change, when you add a new service, when your hours change. Most systems — you have to rewrite a script, re-train something, wait for IT."

Type live:

```
We now offer a new 3-month Ozempic package starting at $799 total, 
which includes monthly consultations and prescription management. 
Available starting June 1st.
```

Click **Ingest into KB**.

> "In about 5 seconds, your AI receptionist knows about this. The next call that asks about your Ozempic program — it'll answer correctly."

Show the chunk appear in the document list.

---

## Demo Step 4 — Automated Follow-Up (2 min)

> "After every qualified call, the system automatically texts the caller within minutes. Not 'we'll call you back sometime' — a personalized message using their name and what they were asking about."

Show the `follow_up_sequences` data (or a sample text message screenshot):

```
Hi Maria! Thanks for calling SFSBI Weight Loss Center. 
Still interested in our Medical Weight Loss Program? 
Reply here anytime!
```

> "If they don't reply, it sends a second message in an hour. Third in 24 hours. Fifth and final at 7 days — then it stops. TCPA compliant, opt-out handled automatically."

---

## Objection Handling

**"What if it says something wrong?"**
> "It only answers from information you've given it — the knowledge base we just built together. If it doesn't know something, it says 'let me have someone follow up with you.' It never makes things up."

**"What about complicated calls?"**
> "Anything it can't handle — it transfers to you or captures a callback number. You stay in the loop for complex situations. The simple 80% of calls — pricing, hours, booking, FAQ — it handles completely."

**"What does it cost?"**
> "Our management fee is $997/month. That includes the voice AI, the knowledge base, the follow-up sequences, the dashboard, and our team managing it. You save 30–50 hours of staff time per month and stop losing leads from missed calls."

**"Can we try it first?"**
> "Yes — we do a 14-day paid pilot at $497. You keep the lead data and call logs either way. If you're not seeing qualified leads within 2 weeks, we'll refund it."

---

## Close (2 min)

> "What would your business look like if you captured every one of those missed calls, qualified them, and followed up automatically — without hiring anyone new?"

> "I can have this running on your phone number within 4 hours of our call ending today. Want to move forward?"

**Next steps if yes:**
1. Send discovery questionnaire (services, pricing, hours, FAQs)
2. We build the KB from their materials
3. They forward one phone number to our Retell number
4. Live within 4 hours

---

## Discovery Questions (for intake)

Ask these before/during onboarding:

1. What services do you offer? List them all with current pricing.
2. What are your hours? Any after-hours policy?
3. What's the most common question callers ask?
4. Do you accept insurance? (If healthcare)
5. What's your booking process? (Online? Call back? Walk-in?)
6. Who should we transfer complex calls to? What's their direct number?
7. What's the ideal follow-up timeframe for your leads?
8. Any services or topics the AI should NOT discuss?
9. Languages? (EN only, or EN + ES?)
10. Do you have any existing FAQs, brochures, or a website we can pull from?

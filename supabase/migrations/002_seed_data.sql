-- ============================================================
-- Voice Intelligence Platform — Seed Data
-- Phase 1: demo client + sample KB documents for gate testing
-- Run AFTER 001_initial_schema.sql
-- ============================================================

-- Demo client: bariatric practice (mirrors SFSBI real-world case)
INSERT INTO clients (
    id,
    name,
    slug,
    phone_number,
    language,
    timezone,
    retell_agent_id,
    is_active
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'SFSBI Weight Loss Center',
    'sfsbi',
    '+14155550100',
    'en',
    'America/Los_Angeles',
    NULL,   -- populated after Retell agent is created in Phase 3
    TRUE
) ON CONFLICT (id) DO NOTHING;

-- Demo client 2: medspa (for multi-client isolation testing)
INSERT INTO clients (
    id,
    name,
    slug,
    phone_number,
    language,
    timezone,
    is_active
) VALUES (
    '00000000-0000-0000-0000-000000000002',
    'Glow Medspa',
    'glow-medspa',
    '+14155550200',
    'en',
    'America/Chicago',
    TRUE
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Sample KB documents for SFSBI
-- These are used to verify vector search returns correct chunk
-- during Phase 1 gate check (without real embeddings).
-- Real embeddings are generated in Phase 2 ingestion pipeline.
-- ============================================================
INSERT INTO kb_documents (
    id,
    client_id,
    title,
    source_type,
    raw_content,
    chunk_count
) VALUES (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Services and Pricing',
    'text',
    'We offer three main programs at SFSBI Weight Loss Center. The Medical Weight Loss Program starts at $299 per month and includes weekly check-ins with our physician, prescription access to GLP-1 medications like semaglutide and tirzepatide, and personalized meal planning. The Ozempic Consultation is a one-time $200 fee and covers a full medical history review and prescription evaluation. The Bariatric Surgery Consultation is $150 and includes a full candidacy assessment with our surgical coordinator.',
    3
),
(
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'Hours and Location',
    'text',
    'SFSBI Weight Loss Center is located at 450 Sutter Street, Suite 1207, San Francisco, CA 94108. Our office hours are Monday through Friday 8am to 5pm Pacific Time. We are closed on weekends and major holidays. For after-hours questions, our AI assistant is available 24/7. For urgent medical concerns, please contact your primary care physician or call 911.',
    2
),
(
    '10000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'Insurance and Payment',
    'text',
    'We accept most major PPO insurance plans for surgical consultations. Medical weight loss programs are typically not covered by insurance and are offered on a cash-pay basis. We accept all major credit cards, HSA, and FSA accounts. Payment plans are available for programs over $500. We do not accept Medi-Cal or Medicare for weight loss programs.',
    2
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Sample lead records for dashboard testing (Phase 6)
-- ============================================================
INSERT INTO leads (
    id,
    client_id,
    caller_number,
    caller_name,
    intent,
    qualifier_score,
    status,
    service_interest,
    call_id
) VALUES
(
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '+14155559001',
    'Maria Garcia',
    'booking',
    85,
    'qualified',
    'Medical Weight Loss Program',
    'retell-test-call-001'
),
(
    '20000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '+14155559002',
    'James Chen',
    'price_check',
    62,
    'new',
    'Ozempic Consultation',
    'retell-test-call-002'
),
(
    '20000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    '+14155559003',
    NULL,
    'spam',
    5,
    'spam',
    NULL,
    'retell-test-call-003'
) ON CONFLICT (id) DO NOTHING;

-- Sample call logs
INSERT INTO call_logs (
    id,
    client_id,
    lead_id,
    retell_call_id,
    caller_number,
    duration_seconds,
    outcome,
    llm_tokens_used,
    llm_cost_usd,
    cache_hits,
    cache_misses
) VALUES
(
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'retell-test-call-001',
    '+14155559001',
    187,
    'qualified',
    1240,
    0.000744,
    3,
    1
),
(
    '30000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    'retell-test-call-002',
    '+14155559002',
    94,
    'qualified',
    860,
    0.000516,
    2,
    0
) ON CONFLICT (retell_call_id) DO NOTHING;

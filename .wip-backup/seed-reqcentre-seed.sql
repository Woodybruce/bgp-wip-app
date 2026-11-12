-- Requirements centre: rows for the LOCAL test database (bgpsmoke) only.
-- Safe to run again: every row has a fixed id (prefix 4ec00000-) and every
-- insert is ON CONFLICT DO NOTHING. Nothing is updated or deleted. Dates are
-- worked out from the day the file is first run.
--
-- The app writes these tables through server/requirement-intake.ts only; this
-- file writes the same shapes by hand so the screens have something to show.
--
--   000000000001-04  the four tenant brands, made only if absent by name
--   000000000101-07  crm_requirements_leasing: one row per state
--   000000000201     external_requirements: the PIPnet import row behind 104
--   000000000301-16  requirement_evidence: lines on requirements, every kind
--   000000000401-07  requirement_evidence: open suggestions, every source
--   000000000501-08  brand_signals: stories behind the suggestions and "In the news"

BEGIN;

-- The four named brands, only when the test data has no brand of that name.
INSERT INTO crm_companies (id, name, company_type)
SELECT v.id, v.name, v.company_type
  FROM (VALUES
    ('4ec00000-0000-4000-8000-000000000001', 'Wingstop',     'Tenant - Quick Service'),
    ('4ec00000-0000-4000-8000-000000000002', 'Flat Iron',    'Tenant - Casual Dining'),
    ('4ec00000-0000-4000-8000-000000000003', 'Yo Chi',       'Tenant - Café'),
    ('4ec00000-0000-4000-8000-000000000004', 'Blank Street', 'Tenant - Café')
  ) AS v(id, name, company_type)
 WHERE NOT EXISTS (SELECT 1 FROM crm_companies c WHERE lower(btrim(c.name)) = lower(v.name))
ON CONFLICT (id) DO NOTHING;

-- Brands and people by name / email, so no id from another seed is typed here.
CREATE TEMP TABLE seed_brand ON COMMIT DROP AS
SELECT DISTINCT ON (k.key) k.key, c.id, c.name
  FROM (VALUES ('wingstop', 'Wingstop'), ('flatiron', 'Flat Iron'), ('yochi', 'Yo Chi'), ('blank', 'Blank Street'),
               ('jersey', 'Jersey Mike''s'), ('light', 'The Light Cinema'), ('bakery', 'Testco Bakery'), ('fashion', 'Testco Fashion'),
               ('ramen', 'Testco Ramen'), ('qa', 'QA Retail Brand'), ('amorino', 'Amorino')) AS k(key, name)
  JOIN crm_companies c ON lower(btrim(c.name)) = lower(k.name) AND c.merged_into_id IS NULL AND c.archived_at IS NULL
 ORDER BY k.key, c.created_at, c.id;

CREATE TEMP TABLE seed_user ON COMMIT DROP AS
SELECT k.key, u.id, u.name
  FROM (VALUES ('victoria', 'victoria@brucegillinghampollard.com'), ('emily', 'emily@brucegillinghampollard.com'),
               ('lucy', 'lucy@brucegillinghampollard.com'), ('emilyc', 'emilyc@brucegillinghampollard.com')) AS k(key, email)
  JOIN users u ON lower(u.email) = k.email;

CREATE TEMP TABLE seed_now ON COMMIT DROP AS SELECT now()::timestamp AS t;

-- ── The PIPnet import row behind requirement 104 ───────────────────────────
INSERT INTO external_requirements (id, source, source_url, source_id, company_name, contact_name, tenure, size_range, use_class, locations, last_updated, description, status, imported_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000201', 'PIPnet', 'https://pipnet.example/requirement/88001', 'seed-88001', b.name, 'Testco Agents LLP',
       'Leasehold', '1,000 - 1,500 sq ft', 'E(b)', ARRAY['Kent', 'Surrey', 'Sussex'], '03/09/2026',
       'High street and shopping centre units for a bakery cafe. Seed row for the requirements centre.', 'active',
       timestamp '2026-09-04 05:30:00', timestamp '2026-09-04 05:30:00'
  FROM seed_brand b WHERE b.key = 'bakery'
ON CONFLICT (id) DO NOTHING;

-- ── Requirements: one per state ────────────────────────────────────────────

-- 101 LIVE: BGP's own, confirmed last week by Victoria on a call. Owner: Victoria.
INSERT INTO crm_requirements_leasing (id, name, status, company_id, use, requirement_type, size, requirement_locations, bgp_contact_user_id, bgp_contact_user_ids,
       comments, requirement_date, sources, created_at, updated_at, last_confirmed_at, last_confirmed_by, last_confirmed_by_name, confirmed_how, origin)
SELECT '4ec00000-0000-4000-8000-000000000101', 'Wingstop — South East shopping centres', 'Active', b.id, ARRAY['Restaurant'], ARRAY['Shopping Centre'],
       ARRAY['2,000 - 3,500 sq ft'], ARRAY['South East', 'Kent', 'Essex'], u.id, ARRAY[u.id],
       'Ten more shopping centre sites wanted in 2027. Extraction essential. Seed row.', to_char(n.t - interval '21 days', 'YYYY-MM-DD'), NULL,
       n.t - interval '21 days', n.t - interval '6 days', n.t - interval '6 days', u.id, u.name, 'call', 'bgp'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'wingstop' AND u.key = 'victoria'
ON CONFLICT (id) DO NOTHING;

-- 102 LIVE, GOING STALE: confirmed 80 days ago by Emily Dumbell at a meeting. Owners: Emily and Lucy.
INSERT INTO crm_requirements_leasing (id, name, status, company_id, use, requirement_type, size, requirement_locations, bgp_contact_user_id, bgp_contact_user_ids,
       comments, requirement_date, sources, created_at, updated_at, last_confirmed_at, last_confirmed_by, last_confirmed_by_name, confirmed_how, origin)
SELECT '4ec00000-0000-4000-8000-000000000102', 'Flat Iron — regional cities', 'Active', b.id, ARRAY['Restaurant'], ARRAY['High street'],
       ARRAY['3,500 - 5,000 sq ft'], ARRAY['Manchester', 'Leeds', 'Edinburgh'], u.id, ARRAY[u.id, l.id],
       'Regional flagships, corner units with character preferred. Seed row.', to_char(n.t - interval '130 days', 'YYYY-MM-DD'), NULL,
       n.t - interval '130 days', n.t - interval '80 days', n.t - interval '80 days', u.id, u.name, 'meeting', 'bgp'
  FROM seed_brand b, seed_user u, seed_user l, seed_now n WHERE b.key = 'flatiron' AND u.key = 'emily' AND l.key = 'lucy'
ON CONFLICT (id) DO NOTHING;

-- 103 TO CONFIRM: logged through ChatBGP seven months ago, last confirmed 5 months ago by Lucy Cox by email. Owner: Lucy.
INSERT INTO crm_requirements_leasing (id, name, status, company_id, use, requirement_type, size, requirement_locations, bgp_contact_user_id, bgp_contact_user_ids,
       comments, requirement_date, sources, created_at, updated_at, last_confirmed_at, last_confirmed_by, last_confirmed_by_name, confirmed_how, origin)
SELECT '4ec00000-0000-4000-8000-000000000103', 'Yo Chi — London high streets', 'Active', b.id, ARRAY['A1 Food'], ARRAY['High street'],
       ARRAY['500 - 1,000 sq ft'], ARRAY['London'], u.id, ARRAY[u.id],
       'Six to eight London high street sites over 18 months, strong evening footfall. Seed row.', to_char(n.t - interval '210 days', 'YYYY-MM-DD'), ARRAY['ChatBGP'],
       n.t - interval '210 days', n.t - interval '150 days', n.t - interval '150 days', u.id, u.name, 'email', 'bgp'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'yochi' AND u.key = 'lucy'
ON CONFLICT (id) DO NOTHING;

-- 104 BACKGROUND (market listing): a PIPnet listing as the import stamps it now. Nobody at BGP has confirmed it. No owner.
INSERT INTO crm_requirements_leasing (id, name, status, company_id, use, requirement_type, size, requirement_locations,
       comments, requirement_date, sources, created_at, updated_at, origin, external_requirement_id, last_listed_at, last_listed_source)
SELECT '4ec00000-0000-4000-8000-000000000104', 'Testco Bakery — South East high streets (PIPnet)', 'Active', b.id, ARRAY['A1 Food'], ARRAY['High street', 'Shopping Centre'],
       ARRAY['1,000 - 2,000 sq ft'], ARRAY['Kent', 'Surrey', 'Sussex'],
       'Imported from PIPnet. Seed row.', '2026-09-03', ARRAY['PIPnet'],
       timestamp '2026-09-04 05:30:00', timestamp '2026-09-04 05:30:00', 'pipnet', '4ec00000-0000-4000-8000-000000000201', timestamp '2026-09-03 00:00:00', 'PIPnet'
  FROM seed_brand b WHERE b.key = 'bakery'
ON CONFLICT (id) DO NOTHING;

-- 105 BACKGROUND (market listing): a Requirement List import as the old import left it: no date, no origin, no link.
INSERT INTO crm_requirements_leasing (id, name, status, company_id, use, size, requirement_locations, comments, requirement_date, sources, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000105', 'Testco Bakery — retail parks (The Requirement List)', 'Active', b.id, ARRAY['A1 Food'],
       ARRAY['1,000 - 2,000 sq ft'], ARRAY['National'], 'Imported from The Requirement List. Seed row.', NULL, ARRAY['TRL'],
       n.t - interval '240 days', n.t - interval '240 days'
  FROM seed_brand b, seed_now n WHERE b.key = 'bakery'
ON CONFLICT (id) DO NOTHING;

-- 106 TO CONFIRM (Draft): the kind of row the old "Create requirement" button on a viewing left behind.
INSERT INTO crm_requirements_leasing (id, name, status, company_id, comments, requirement_date, sources, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000106', b.name || ' — viewing requirement', 'Draft', b.id,
       'Draft for review. Viewed: RU10 Test, Westgate Test Centre on 2026-11-01. This is observed activity, not a confirmed size or location requirement. Seed row.',
       '2026-11-01', ARRAY['Viewing'], n.t - interval '10 days', n.t - interval '10 days'
  FROM seed_brand b, seed_now n WHERE b.key = 'ramen'
ON CONFLICT (id) DO NOTHING;

-- 107 CLOSED: BGP's own, confirmed by Victoria, then marked satisfied (Past) when the deal reached solicitors.
INSERT INTO crm_requirements_leasing (id, name, status, company_id, use, requirement_type, size, requirement_locations, bgp_contact_user_id, bgp_contact_user_ids,
       comments, requirement_date, sources, created_at, updated_at, last_confirmed_at, last_confirmed_by, last_confirmed_by_name, confirmed_how, origin)
SELECT '4ec00000-0000-4000-8000-000000000107', 'Flat Iron — Covent Garden', 'Past', b.id, ARRAY['Restaurant'], ARRAY['High street'],
       ARRAY['3,500 - 5,000 sq ft'], ARRAY['London'], u.id, ARRAY[u.id],
       'Satisfied: let at Covent Garden. Seed row.', to_char(n.t - interval '300 days', 'YYYY-MM-DD'), NULL,
       n.t - interval '300 days', n.t - interval '190 days', n.t - interval '220 days', u.id, u.name, 'call', 'bgp'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'flatiron' AND u.key = 'victoria'
ON CONFLICT (id) DO NOTHING;

-- ── Evidence on requirements: one line of every kind ───────────────────────
-- status 'attached' or 'confirmed'; resolved_reason 'direct' = a person (or a
-- record) put it straight on the requirement, not through a suggestion.

-- On 101 (Wingstop, live): call, note, press, whatsapp.
INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, evidence_date, headline, status,
       created_by_kind, created_by_user_id, created_by_name, resolved_by_user_id, resolved_by_name, resolved_at, resolved_reason, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000301', '4ec00000-0000-4000-8000-000000000101', b.id, b.name, 'call', 'Call', n.t - interval '6 days',
       'Spoke to their head of property: ten more South East shopping centre sites wanted in 2027, 2,000 to 3,500 sq ft with extraction.', 'attached',
       'person', u.id, u.name, u.id, u.name, n.t - interval '6 days', 'direct', n.t - interval '6 days', n.t - interval '6 days'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'wingstop' AND u.key = 'victoria'
ON CONFLICT DO NOTHING;

INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, evidence_date, headline, status,
       created_by_kind, created_by_user_id, created_by_name, resolved_by_user_id, resolved_by_name, resolved_at, resolved_reason, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000302', '4ec00000-0000-4000-8000-000000000101', b.id, 'Wingstop — South East shopping centres', 'note', 'Requirements', n.t - interval '6 days',
       'Confirmed still live (call)', 'attached',
       'person', u.id, u.name, u.id, u.name, n.t - interval '6 days', 'direct', n.t - interval '6 days', n.t - interval '6 days'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'wingstop' AND u.key = 'victoria'
ON CONFLICT DO NOTHING;

INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, source_ref, evidence_date, headline, excerpt, details, confidence, status,
       created_by_kind, created_by_name, resolved_by_user_id, resolved_by_name, resolved_at, dedupe_key, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000303', '4ec00000-0000-4000-8000-000000000101', b.id, b.name, 'press', 'Propel',
       'newsletter:' || to_char(n.t - interval '20 days', 'YYYY-MM-DD') || ':Propel Morning Briefing', n.t - interval '20 days',
       'Wingstop UK targets 20 new restaurants in 2027 after record year', 'Stated: 20 UK sites; 2027.',
       '{"rule":"strong_story","why":"states 20 UK sites","signalType":"opening","sites":20,"uk":true,"timing":"2027","_matchedBy":"tag"}'::jsonb, 'high', 'attached',
       'machine', 'News reader', u.id, u.name, n.t - interval '19 days', 'press:' || b.id || ':seed-req-centre:wingstop-20-sites', n.t - interval '20 days', n.t - interval '19 days'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'wingstop' AND u.key = 'victoria'
ON CONFLICT DO NOTHING;

INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, evidence_date, headline, status,
       created_by_kind, created_by_user_id, created_by_name, resolved_by_user_id, resolved_by_name, resolved_at, resolved_reason, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000304', '4ec00000-0000-4000-8000-000000000101', b.id, b.name, 'whatsapp', 'WhatsApp', n.t - interval '14 days',
       'Message from their agent: still looking in Kent and Essex, will send the updated target list.', 'attached',
       'person', u.id, u.name, u.id, u.name, n.t - interval '14 days', 'direct', n.t - interval '14 days', n.t - interval '14 days'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'wingstop' AND u.key = 'victoria'
ON CONFLICT DO NOTHING;

-- On 102 (Flat Iron, going stale): meeting, note, viewing, gossip.
INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, evidence_date, headline, status,
       created_by_kind, created_by_user_id, created_by_name, resolved_by_user_id, resolved_by_name, resolved_at, resolved_reason, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000305', '4ec00000-0000-4000-8000-000000000102', b.id, b.name, 'meeting', 'Meeting', n.t - interval '80 days',
       'Met their property director: wants Manchester, Leeds and Edinburgh, 3,500 to 5,000 sq ft, corner units.', 'attached',
       'person', u.id, u.name, u.id, u.name, n.t - interval '80 days', 'direct', n.t - interval '80 days', n.t - interval '80 days'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'flatiron' AND u.key = 'emily'
ON CONFLICT DO NOTHING;

INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, evidence_date, headline, status,
       created_by_kind, created_by_user_id, created_by_name, resolved_by_user_id, resolved_by_name, resolved_at, resolved_reason, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000306', '4ec00000-0000-4000-8000-000000000102', b.id, 'Flat Iron — regional cities', 'note', 'Requirements', n.t - interval '80 days',
       'Confirmed still live (meeting)', 'attached',
       'person', u.id, u.name, u.id, u.name, n.t - interval '80 days', 'direct', n.t - interval '80 days', n.t - interval '80 days'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'flatiron' AND u.key = 'emily'
ON CONFLICT DO NOTHING;

INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, source_ref, evidence_date, headline, url, status,
       created_by_kind, created_by_user_id, created_by_name, resolved_by_user_id, resolved_by_name, resolved_at, resolved_reason, dedupe_key, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000307', '4ec00000-0000-4000-8000-000000000102', b.id, b.name, 'viewing', 'Viewing', '4ec00000-0000-4000-8000-000000000601',
       n.t - interval '30 days', 'Viewed: Unit 14, Trinity Leeds on ' || to_char(n.t - interval '30 days', 'YYYY-MM-DD') || ' (4,200 sq ft)', '/available?workspace=viewings', 'attached',
       'person', u.id, u.name, u.id, u.name, n.t - interval '29 days', 'direct', 'viewing:4ec00000-0000-4000-8000-000000000601', n.t - interval '29 days', n.t - interval '29 days'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'flatiron' AND u.key = 'emily'
ON CONFLICT DO NOTHING;

INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, source_ref, evidence_date, headline, excerpt, url, said_by, details, confidence, status,
       created_by_kind, created_by_name, resolved_by_user_id, resolved_by_name, resolved_at, dedupe_key, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000308', '4ec00000-0000-4000-8000-000000000102', b.id, b.name, 'gossip', 'Gossip & market intel', '4ec00000-0000-4000-8000-000000000602',
       n.t - interval '41 days', l.name || ' in Gossip & market intel', 'Flat Iron told me they would look at Edinburgh if the right St James Quarter unit came up',
       (SELECT '/chatbgp?thread=' || t.id FROM chat_threads t WHERE t.title = 'Gossip & market intel' AND t.linked_type = 'channel' ORDER BY t.created_at LIMIT 1),
       l.name, '{"locations":["Edinburgh"],"_matchedBy":"tag"}'::jsonb, 'medium', 'attached',
       'machine', 'Chat reader', u.id, u.name, n.t - interval '40 days', 'chat-message:4ec00000-0000-4000-8000-000000000602:' || b.id, n.t - interval '41 days', n.t - interval '40 days'
  FROM seed_brand b, seed_user u, seed_user l, seed_now n WHERE b.key = 'flatiron' AND u.key = 'emily' AND l.key = 'lucy'
ON CONFLICT DO NOTHING;

-- On 103 (Yo Chi, to confirm): chat (the ChatBGP log that made it), email, note, team_chat, listing.
INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, evidence_date, headline, excerpt, details, status,
       created_by_kind, created_by_user_id, created_by_name, resolved_by_user_id, resolved_by_name, resolved_at, resolved_reason, dedupe_key, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000309', '4ec00000-0000-4000-8000-000000000103', b.id, b.name, 'chat', 'ChatBGP', n.t - interval '210 days',
       u.name || ' told ChatBGP: 500 - 1,000 sq ft; London', 'Their UK MD wants high street shops with evening footfall.',
       '{"size":["500 - 1,000 sq ft"],"locations":["London"],"use":[],"budget":null,"priority":null,"contact":null,"_matchedBy":"name"}'::jsonb, 'confirmed',
       'person', u.id, u.name, u.id, u.name, n.t - interval '210 days', 'direct', 'chatbgp:seed-req-centre-yochi-0309', n.t - interval '210 days', n.t - interval '210 days'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'yochi' AND u.key = 'lucy'
ON CONFLICT DO NOTHING;

INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, evidence_date, headline, status,
       created_by_kind, created_by_user_id, created_by_name, resolved_by_user_id, resolved_by_name, resolved_at, resolved_reason, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000310', '4ec00000-0000-4000-8000-000000000103', b.id, b.name, 'email', 'Email', n.t - interval '150 days',
       'Email from their UK MD: six to eight London high street sites over 18 months, 800 to 1,200 sq ft.', 'attached',
       'person', u.id, u.name, u.id, u.name, n.t - interval '150 days', 'direct', n.t - interval '150 days', n.t - interval '150 days'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'yochi' AND u.key = 'lucy'
ON CONFLICT DO NOTHING;

INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, evidence_date, headline, status,
       created_by_kind, created_by_user_id, created_by_name, resolved_by_user_id, resolved_by_name, resolved_at, resolved_reason, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000311', '4ec00000-0000-4000-8000-000000000103', b.id, 'Yo Chi — London high streets', 'note', 'Requirements', n.t - interval '150 days',
       'Confirmed still live (email)', 'attached',
       'person', u.id, u.name, u.id, u.name, n.t - interval '150 days', 'direct', n.t - interval '150 days', n.t - interval '150 days'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'yochi' AND u.key = 'lucy'
ON CONFLICT DO NOTHING;

INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, source_ref, evidence_date, headline, excerpt, said_by, details, confidence, status,
       created_by_kind, created_by_name, resolved_by_user_id, resolved_by_name, resolved_at, dedupe_key, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000312', '4ec00000-0000-4000-8000-000000000103', b.id, b.name, 'team_chat', 'Team chat', '4ec00000-0000-4000-8000-000000000603',
       n.t - interval '61 days', e.name || ' in team chat', 'Yo Chi are asking about kiosks as well as shops now, anything under 1,000 sq ft in a mall',
       e.name, '{"size":["under 1,000 sq ft"],"use":["kiosk"],"_matchedBy":"tag"}'::jsonb, 'high', 'attached',
       'machine', 'Chat reader', u.id, u.name, n.t - interval '60 days', 'chat-message:4ec00000-0000-4000-8000-000000000603:' || b.id, n.t - interval '61 days', n.t - interval '60 days'
  FROM seed_brand b, seed_user u, seed_user e, seed_now n WHERE b.key = 'yochi' AND u.key = 'lucy' AND e.key = 'emilyc'
ON CONFLICT DO NOTHING;

INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, evidence_date, headline, status,
       created_by_kind, created_by_name, resolved_by_name, resolved_at, resolved_reason, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000313', '4ec00000-0000-4000-8000-000000000103', b.id, b.name, 'listing', 'PIPnet', timestamp '2026-10-02 00:00:00',
       'Listed on PIPnet', 'attached',
       'machine', 'PIPnet import', 'PIPnet import', timestamp '2026-10-03 05:30:00', 'direct', timestamp '2026-10-03 05:30:00', timestamp '2026-10-03 05:30:00'
  FROM seed_brand b WHERE b.key = 'yochi'
ON CONFLICT DO NOTHING;

-- On 107 (Flat Iron, closed): offer, deal ("mark as satisfied?" answered yes), note.
INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, source_ref, evidence_date, headline, status,
       created_by_kind, created_by_name, resolved_by_name, resolved_at, resolved_reason, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000314', '4ec00000-0000-4000-8000-000000000107', b.id, b.name, 'offer', 'Offer', '4ec00000-0000-4000-8000-000000000604',
       n.t - interval '205 days', 'Offer (agreed): Unit 12, Covent Garden', 'attached',
       'machine', 'Offer record', 'Offer record', n.t - interval '205 days', 'direct', n.t - interval '205 days', n.t - interval '205 days'
  FROM seed_brand b, seed_now n WHERE b.key = 'flatiron'
ON CONFLICT DO NOTHING;

INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, source_ref, evidence_date, headline, details, status,
       created_by_kind, created_by_name, resolved_by_user_id, resolved_by_name, resolved_at, resolved_reason, dedupe_key, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000315', '4ec00000-0000-4000-8000-000000000107', b.id, b.name, 'deal', 'Deal', '4ec00000-0000-4000-8000-000000000605',
       n.t - interval '191 days', 'Deal #1042 for Flat Iron at Unit 12, Covent Garden reached solicitors. Mark the requirement as satisfied?',
       '{"proposal":"mark_satisfied","requirementId":"4ec00000-0000-4000-8000-000000000107","dealId":"4ec00000-0000-4000-8000-000000000605","dealRef":"1042","status":"SOL","_matchedBy":"tag"}'::jsonb, 'attached',
       'machine', 'Deal status rule', u.id, u.name, n.t - interval '190 days', 'satisfied', 'deal-solicitors:4ec00000-0000-4000-8000-000000000605', n.t - interval '191 days', n.t - interval '190 days'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'flatiron' AND u.key = 'victoria'
ON CONFLICT DO NOTHING;

INSERT INTO requirement_evidence (id, requirement_id, company_id, brand_name, kind, source_label, evidence_date, headline, status,
       created_by_kind, created_by_user_id, created_by_name, resolved_by_user_id, resolved_by_name, resolved_at, resolved_reason, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000316', '4ec00000-0000-4000-8000-000000000107', b.id, 'Flat Iron — Covent Garden', 'note', 'Requirements', n.t - interval '190 days',
       'Marked satisfied: Deal #1042 for Flat Iron at Unit 12, Covent Garden reached solicitors. Mark the requirement as satisfied?', 'attached',
       'person', u.id, u.name, u.id, u.name, n.t - interval '190 days', 'direct', n.t - interval '190 days', n.t - interval '190 days'
  FROM seed_brand b, seed_user u, seed_now n WHERE b.key = 'flatiron' AND u.key = 'victoria'
ON CONFLICT DO NOTHING;

-- ── Open suggestions: one from each source ─────────────────────────────────

-- 401 ChatBGP, a name not in the CRM: Victoria told ChatBGP, the brand could not be matched, so it waits for a person to pick the brand.
INSERT INTO requirement_evidence (id, company_id, brand_name, kind, source_label, evidence_date, headline, excerpt, details, status,
       created_by_kind, created_by_user_id, created_by_name, dedupe_key, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000401', NULL, 'Dishoom', 'chat', 'ChatBGP', n.t - interval '1 day',
       u.name || ' told ChatBGP: 5,000 - 10,000 sq ft; Manchester, Birmingham', 'Their agent says they want two more regional flagships, ideally listed buildings.',
       '{"size":["5,000 - 10,000 sq ft"],"locations":["Manchester","Birmingham"],"use":["Restaurant"],"budget":null,"priority":"high","contact":null}'::jsonb, 'open',
       'person', u.id, u.name, 'chatbgp:seed-req-centre-dishoom-0401', n.t - interval '1 day', n.t - interval '1 day'
  FROM seed_user u, seed_now n WHERE u.key = 'victoria'
ON CONFLICT DO NOTHING;

-- 402 A chat post: Emily Cann tagged Yo Chi in the Gossip & market intel channel.
INSERT INTO requirement_evidence (id, company_id, brand_name, kind, source_label, source_ref, evidence_date, headline, excerpt, url, said_by, details, confidence, status,
       created_by_kind, created_by_name, dedupe_key, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000402', b.id, b.name, 'gossip', 'Gossip & market intel', '4ec00000-0000-4000-8000-000000000606', n.t - interval '2 days',
       e.name || ' in Gossip & market intel', 'Yo Chi want three more London sites next year, Clapham is done, now looking at Islington and Richmond, about 1,000 sq ft',
       (SELECT '/chatbgp?thread=' || t.id FROM chat_threads t WHERE t.title = 'Gossip & market intel' AND t.linked_type = 'channel' ORDER BY t.created_at LIMIT 1),
       e.name, '{"sites":3,"size":["about 1,000 sq ft"],"locations":["Islington","Richmond"],"timing":"next year","_matchedBy":"tag"}'::jsonb, 'high', 'open',
       'machine', 'Chat reader', 'chat-message:4ec00000-0000-4000-8000-000000000606:' || b.id, n.t - interval '2 days', n.t - interval '2 days'
  FROM seed_brand b, seed_user e, seed_now n WHERE b.key = 'yochi' AND e.key = 'emilyc'
ON CONFLICT DO NOTHING;

-- 403 A meeting: the summary of a Teams transcript note named Jersey Mike's.
INSERT INTO requirement_evidence (id, company_id, brand_name, kind, source_label, source_ref, evidence_date, headline, excerpt, details, confidence, status,
       created_by_kind, created_by_name, dedupe_key, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000403', b.id, b.name, 'meeting', 'Teams meeting', 'note:seed-req-centre-0403', n.t - interval '3 days',
       'Jersey Mike''s UK franchise partner: site strategy catch-up', 'They want ten shopping centre sites in the first two years, 1,200 to 1,800 sq ft, starting with Bluewater and Westfield',
       '{"sites":10,"size":["1,200 to 1,800 sq ft"],"locations":["Bluewater","Westfield"],"timing":"the first two years","_matchedBy":"name"}'::jsonb, 'high', 'open',
       'machine', 'Meeting reader', 'note:seed-req-centre-0403:jersey mike s', n.t - interval '3 days', n.t - interval '3 days'
  FROM seed_brand b, seed_now n WHERE b.key = 'jersey'
ON CONFLICT DO NOTHING;

-- 404 + 405 Two viewings in 90 days by a brand with no requirement: one suggestion, two lines (405 joined 404).
INSERT INTO requirement_evidence (id, company_id, brand_name, kind, source_label, source_ref, evidence_date, headline, url, details, status,
       created_by_kind, created_by_name, dedupe_key, suggestion_id, created_at, updated_at)
SELECT v.id, b.id, b.name, 'viewing', 'Viewing', v.viewing_id, date_trunc('day', n.t - make_interval(days => v.days_ago)) + interval '12 hours',
       v.headline, '/available?workspace=viewings', '{"rule":"two_viewings_90_days","_matchedBy":"tag"}'::jsonb, 'open',
       'machine', 'Viewing rule', 'viewing:' || v.viewing_id, v.suggestion_id, n.t - interval '5 days' + make_interval(secs => v.ord), n.t - interval '5 days' + make_interval(secs => v.ord)
  FROM (VALUES
    ('4ec00000-0000-4000-8000-000000000404', '4ec00000-0000-4000-8000-000000000607', 21, 'Viewed: RU10 Test, Westgate Test Centre', NULL, 0),
    ('4ec00000-0000-4000-8000-000000000405', '4ec00000-0000-4000-8000-000000000608', 5, 'Viewed: 304 Queen Street (RU9), Westgate Test Centre', '4ec00000-0000-4000-8000-000000000404', 1)
  ) AS v(id, viewing_id, days_ago, headline, suggestion_id, ord), seed_brand b, seed_now n WHERE b.key = 'qa'
ON CONFLICT DO NOTHING;

-- 406 A press story with a stated number of sites: Propel, Blank Street, 15 UK shops. Blank Street has no requirement.
INSERT INTO requirement_evidence (id, company_id, brand_name, kind, source_label, source_ref, evidence_date, headline, excerpt, details, confidence, status,
       created_by_kind, created_by_name, dedupe_key, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000406', b.id, b.name, 'press', 'Propel',
       'newsletter:' || to_char(n.t - interval '2 days', 'YYYY-MM-DD') || ':Propel Morning Briefing', n.t - interval '2 days',
       'Blank Street to open 15 more UK shops in 2027, targeting commuter hubs and regional cities', 'Stated: 15 UK sites; Manchester, Edinburgh, Birmingham; 2027.',
       '{"rule":"strong_story","why":"states 15 UK sites","signalType":"opening","sites":15,"uk":true,"locations":["Manchester","Edinburgh","Birmingham"],"timing":"2027","_matchedBy":"tag"}'::jsonb, 'high', 'open',
       'machine', 'News reader', 'press:' || b.id || ':newsletter:' || to_char(n.t - interval '2 days', 'YYYY-MM-DD') || ':Propel Morning Briefing:opening', n.t - interval '2 days', n.t - interval '2 days'
  FROM seed_brand b, seed_now n WHERE b.key = 'blank'
ON CONFLICT DO NOTHING;

-- 407 "Still live?": a closure story about Flat Iron, whose requirement 102 is live and was confirmed before the story.
INSERT INTO requirement_evidence (id, company_id, brand_name, kind, source_label, source_ref, evidence_date, headline, excerpt, url, details, status,
       created_by_kind, created_by_name, dedupe_key, created_at, updated_at)
SELECT '4ec00000-0000-4000-8000-000000000407', b.id, b.name, 'press', 'news.example', 'seed-req-centre-flat-iron-estate-review', n.t - interval '4 days',
       'Still live? ' || b.name || ': Flat Iron to close three regional restaurants in estate review',
       'Sites in Cambridge, Bristol and Cardiff are to shut by January as the group reviews its regional estate.',
       'https://news.example/flat-iron-estate-review',
       '{"proposal":"still_live","requirementId":"4ec00000-0000-4000-8000-000000000102","signalType":"closure","story":"Flat Iron to close three regional restaurants in estate review","_matchedBy":"tag"}'::jsonb, 'open',
       'machine', 'News reader', 'still-live:' || b.id || ':https://news.example/flat-iron-estate-review', n.t - interval '4 days', n.t - interval '4 days'
  FROM seed_brand b, seed_now n WHERE b.key = 'flatiron'
ON CONFLICT DO NOTHING;

-- ── Brand signals: the stories behind the suggestions, and "In the news" ───
-- ai_generated is false so no reader's tidy-up removes them.
INSERT INTO brand_signals (id, brand_company_id, signal_type, headline, detail, source, signal_date, magnitude, sentiment, ai_generated, ai_relevant, geography, confidence, created_at)
SELECT v.id, b.id, v.signal_type, v.headline, v.detail,
       CASE WHEN v.source = 'propel' THEN 'newsletter:' || to_char(n.t - make_interval(days => v.days_ago), 'YYYY-MM-DD') || ':Propel Morning Briefing' ELSE v.source END,
       n.t - make_interval(days => v.days_ago), v.magnitude, v.sentiment, false, true, 'uk', v.confidence, n.t - make_interval(days => v.days_ago)
  FROM (VALUES
    -- Behind suggestion 406. Blank Street stays OFF "In the news": it has a suggestion waiting.
    ('4ec00000-0000-4000-8000-000000000501', 'blank', 'opening', 'Blank Street to open 15 more UK shops in 2027, targeting commuter hubs and regional cities',
     'Stated: 15 UK sites; Manchester, Edinburgh, Birmingham; 2027. Via newsletter: Propel Morning Briefing (newsletter@propelinfo.com)', 'propel', 2, 'large', 'positive', NULL),
    -- Behind suggestion 407 (a closure: not an expansion story).
    ('4ec00000-0000-4000-8000-000000000502', 'flatiron', 'closure', 'Flat Iron to close three regional restaurants in estate review',
     'Sites in Cambridge, Bristol and Cardiff are to shut by January as the group reviews its regional estate.', 'https://news.example/flat-iron-estate-review', 4, 'medium', 'negative', 'reported'),
    -- "In the news", nothing on the books at all: The Light Cinema (two stories) and Testco Fashion.
    ('4ec00000-0000-4000-8000-000000000503', 'light', 'opening', 'The Light to open eight-screen cinema and entertainment venue in Huddersfield in 2027',
     'Stated: 30,000 sq ft; Huddersfield; 2027. Anchor of the Piazza scheme; the operator says it is looking for four further regional towns.', 'https://news.example/the-light-huddersfield', 6, 'large', 'positive', 'confirmed'),
    ('4ec00000-0000-4000-8000-000000000504', 'light', 'funding', 'The Light secures £25m facility to fund five new UK venues',
     'Stated: 5 UK sites. Via newsletter: Propel Morning Briefing (newsletter@propelinfo.com)', 'propel', 18, 'large', 'positive', NULL),
    ('4ec00000-0000-4000-8000-000000000505', 'fashion', 'hiring', 'Testco Fashion hiring store managers for six new regional stores',
     'Stated: 6 UK sites; Leeds, Nottingham, Bristol. Roles advertised for openings in spring 2027.', 'https://news.example/testco-fashion-hiring', 25, 'medium', 'positive', 'reported'),
    -- "In the news", only a background market listing on the books: Testco Bakery (104, 105) and Amorino (another seed's PIPnet row).
    ('4ec00000-0000-4000-8000-000000000506', 'bakery', 'requirement', 'Testco Bakery seeking 1,000 to 1,500 sq ft high street units across the South East',
     'Stated: 1,000 to 1,500 sq ft; Kent, Surrey, Sussex. Agents instructed on a 12-site search.', 'https://news.example/testco-bakery-requirement', 9, 'medium', 'positive', 'reported'),
    ('4ec00000-0000-4000-8000-000000000507', 'amorino', 'opening', 'Amorino plans ten more UK gelato boutiques by 2028',
     'Stated: 10 UK sites; 2028. Via newsletter: Propel Morning Briefing (newsletter@propelinfo.com)', 'propel', 12, 'large', 'positive', NULL),
    -- Behind evidence 303. Wingstop stays OFF "In the news": it has a live requirement.
    ('4ec00000-0000-4000-8000-000000000508', 'wingstop', 'opening', 'Wingstop UK targets 20 new restaurants in 2027 after record year',
     'Stated: 20 UK sites; 2027. Via newsletter: Propel Morning Briefing (newsletter@propelinfo.com)', 'propel', 20, 'large', 'positive', NULL)
  ) AS v(id, brand, signal_type, headline, detail, source, days_ago, magnitude, sentiment, confidence)
  JOIN seed_brand b ON b.key = v.brand, seed_now n
ON CONFLICT DO NOTHING;

COMMIT;

-- What the file's rows look like now (whether inserted by this run or an earlier one).
SELECT 'crm_companies' AS tbl, count(*) FROM crm_companies WHERE id LIKE '4ec00000-%'
UNION ALL SELECT 'external_requirements', count(*) FROM external_requirements WHERE id LIKE '4ec00000-%'
UNION ALL SELECT 'crm_requirements_leasing', count(*) FROM crm_requirements_leasing WHERE id LIKE '4ec00000-%'
UNION ALL SELECT 'requirement_evidence (on requirements)', count(*) FROM requirement_evidence WHERE id LIKE '4ec00000-%' AND requirement_id IS NOT NULL
UNION ALL SELECT 'requirement_evidence (open suggestion lines)', count(*) FROM requirement_evidence WHERE id LIKE '4ec00000-%' AND status = 'open'
UNION ALL SELECT 'brand_signals', count(*) FROM brand_signals WHERE id LIKE '4ec00000-%';

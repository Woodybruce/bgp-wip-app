import express, { type Request, Response, NextFunction } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import dns from "node:dns";

// Railway's default DNS result order prefers IPv6, which silently
// times out against several gov.uk edges (Idox Public Access, etc).
// Force IPv4-first resolution before any outbound fetch runs.
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

// Process-level error logging. Crashes during SSE streams (chatbgp,
// pathway, etc.) often escape the per-route try/catch because the
// failure happens in a tool's async pipeline or a downstream library
// throws synchronously. Without these handlers the client just sees
// "Sorry, I couldn't respond" with no server context.
process.on("unhandledRejection", (reason: any) => {
  const stack = reason?.stack || (reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason));
  const status = reason?.status || reason?.statusCode;
  const url = reason?.url || reason?.config?.url;
  console.error(
    `[FATAL] Unhandled promise rejection${status ? ` (status ${status})` : ""}${url ? ` for ${url}` : ""}:`,
    stack,
  );
});

process.on("uncaughtException", (err: any) => {
  console.error("[FATAL] Uncaught exception — shutting down:", err?.stack || err);
  setTimeout(() => process.exit(1), 1000);
});
import { registerRoutes } from "./routes";
import { pool } from "./db";

// Auto-migrate: add columns/tables that may be missing after database restore.
// CRITICAL: each statement runs in its own try/catch so one failure (e.g. an
// IMMUTABLE-check on a GIN index expression under older Postgres) does NOT
// abort the whole batch. A single multi-statement pool.query stops at the
// first error, which is how compliance_board/training tables went missing.
(async () => {
  const MIGRATIONS: string[] = [
    // Per-client CRM: extra brands added from the global directory beyond
    // the client's auto category slice.
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS crm_extra_brand_ids TEXT[]`,
    // Client brand theme (logo.dev) — logo + colours for the client-app skin.
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS logo_url TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS brand_primary_color TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS brand_secondary_color TEXT`,
    // Targeting brief: images attached from Image Studio.
    `ALTER TABLE unit_briefs ADD COLUMN IF NOT EXISTS image_ids TEXT[]`,
    // Heads of Terms: each property carries a standard HOTs template;
    // each tracker unit carries its negotiated instance.
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS hots_template TEXT`,
    `ALTER TABLE available_units ADD COLUMN IF NOT EXISTS hots_content TEXT`,
    `ALTER TABLE available_units ADD COLUMN IF NOT EXISTS hots_updated_at TIMESTAMPTZ`,
    // Target operators: BGP agent pills (auto-tagged to whoever adds the
    // target) + the client-side contact driving it.
    `ALTER TABLE unit_target_operators ADD COLUMN IF NOT EXISTS agent_user_ids TEXT[]`,
    `ALTER TABLE unit_target_operators ADD COLUMN IF NOT EXISTS client_contact_id VARCHAR`,
    `ALTER TABLE unit_target_operators ADD COLUMN IF NOT EXISTS comments JSONB`,
    // Backfill briefs created without a client company (tracker
    // auto-creates) from the property's landlord, so the targets'
    // Client-Contact picker has the client's people to offer.
    `UPDATE unit_briefs ub
        SET client_company_id = p.landlord_id
       FROM crm_properties p
      WHERE p.id = ub.property_id
        AND ub.client_company_id IS NULL
        AND p.landlord_id IS NOT NULL`,
    // Diary→viewings sync: provenance + idempotent upsert key for viewings
    // auto-created from Outlook calendar events (see server/viewing-sync.ts).
    `ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS source TEXT`,
    `ALTER TABLE unit_viewings ADD COLUMN IF NOT EXISTS calendar_event_id TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS unit_viewings_calendar_event_idx ON unit_viewings (calendar_event_id) WHERE calendar_event_id IS NOT NULL`,
    // Email→offers check: provenance + one-row-per-thread dedupe for offers
    // auto-detected from synced inboxes (see server/viewing-sync.ts).
    `ALTER TABLE unit_offers ADD COLUMN IF NOT EXISTS source TEXT`,
    `ALTER TABLE unit_offers ADD COLUMN IF NOT EXISTS email_conversation_id TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS unit_offers_email_conversation_idx ON unit_offers (email_conversation_id) WHERE email_conversation_id IS NOT NULL`,
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS leasing_privacy_enabled BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS sharepoint_folder_url TEXT`,
    `ALTER TABLE lease_events ADD COLUMN IF NOT EXISTS landlord TEXT`,
    `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS source_url TEXT`,
    `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS source_title TEXT`,
    `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS source_contact_id VARCHAR`,
    `UPDATE crm_leads SET source = 'News' WHERE source = 'News Feed'`,
    `UPDATE crm_leads SET source = 'Email' WHERE source IN ('Team Email', 'team email', 'email')`,
    `UPDATE crm_leads SET source = 'File' WHERE source IN ('SharePoint File', 'sharepoint file', 'file')`,
    `UPDATE crm_comps SET source_evidence = 'News' WHERE source_evidence = 'News Feed'`,
    `UPDATE crm_comps SET source_evidence = 'Email' WHERE source_evidence IN ('Team Email', 'team email')`,
    `UPDATE crm_comps SET source_evidence = 'File' WHERE source_evidence IN ('SharePoint File', 'sharepoint file')`,
    `CREATE TABLE IF NOT EXISTS lease_events (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id VARCHAR,
      address TEXT,
      tenant TEXT,
      tenant_company_id VARCHAR,
      unit_ref TEXT,
      event_type TEXT NOT NULL,
      event_date TIMESTAMP,
      notice_date TIMESTAMP,
      current_rent TEXT,
      estimated_erv TEXT,
      sqft TEXT,
      source_evidence TEXT,
      source_url TEXT,
      source_title TEXT,
      source_contact_id VARCHAR,
      contact_id VARCHAR,
      assigned_to TEXT,
      status TEXT DEFAULT 'Monitoring',
      notes TEXT,
      deal_id VARCHAR,
      comp_id VARCHAR,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_lease_events_property ON lease_events(property_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lease_events_date ON lease_events(event_date)`,
    `CREATE INDEX IF NOT EXISTS idx_lease_events_status ON lease_events(status)`,
    `CREATE TABLE IF NOT EXISTS property_intelligence_cache (
      cache_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT now(),
      expires_at TIMESTAMP NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_pi_cache_expires ON property_intelligence_cache(expires_at)`,
    `CREATE TABLE IF NOT EXISTS land_registry_title_purchases (
      id SERIAL PRIMARY KEY,
      title_number TEXT NOT NULL,
      documents TEXT NOT NULL,
      register_url TEXT,
      plan_url TEXT,
      proprietor_data JSONB,
      raw_response JSONB,
      cost_gbp NUMERIC(10,2),
      requested_by VARCHAR,
      created_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_lr_title_purchases_title_docs ON land_registry_title_purchases(title_number, documents)`,
    `CREATE INDEX IF NOT EXISTS idx_lr_title_purchases_created ON land_registry_title_purchases(created_at DESC)`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS po_number TEXT`,
    // Xero contact replaces the old internal "invoicing entity" — Xero is the
    // source of truth for billing. Cached fields render in deal list / form
    // without an extra Xero API call.
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS xero_contact_id TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS xero_contact_name TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS xero_account_number TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS xero_billing_address JSONB`,
    `CREATE INDEX IF NOT EXISTS crm_deals_xero_contact_id_idx ON crm_deals (xero_contact_id) WHERE xero_contact_id IS NOT NULL`,
    `ALTER TABLE crm_deals DROP COLUMN IF EXISTS invoicing_entity_id`,
    // Landlord provenance on properties — tells the UI/audit how we got
    // the landlord_id and how much we trust it. Set by Pathway Stage 4
    // when CCOD/OCOD matches the proprietor; reset to 'manual' when a
    // human edits via property-detail. Lets us strikethrough stale
    // institutional records (e.g. Sugar/Amsprop legend at Haymarket)
    // when HMLR data contradicts them.
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS landlord_source TEXT`,
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS landlord_confidence TEXT`,
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS landlord_verified_at TIMESTAMPTZ`,
    // chatbgp_learnings supersession — kills the "Sugar/Amsprop legend
    // resurfacing" problem. When HMLR-verified data lands, old learnings
    // that referred to the now-disproven proprietor get marked superseded
    // (active=false + superseded_at + reason) so they no longer feed
    // ChatBGP's context.
    `ALTER TABLE chatbgp_learnings ADD COLUMN IF NOT EXISTS subject_property_id VARCHAR(64)`,
    `ALTER TABLE chatbgp_learnings ADD COLUMN IF NOT EXISTS subject_company_number VARCHAR(32)`,
    `ALTER TABLE chatbgp_learnings ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMP`,
    `ALTER TABLE chatbgp_learnings ADD COLUMN IF NOT EXISTS superseded_by_learning_id INTEGER`,
    `ALTER TABLE chatbgp_learnings ADD COLUMN IF NOT EXISTS superseded_reason TEXT`,
    `CREATE INDEX IF NOT EXISTS chatbgp_learnings_subject_property_idx ON chatbgp_learnings (subject_property_id) WHERE subject_property_id IS NOT NULL`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS kyc_approved BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS kyc_approved_at TIMESTAMP`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS kyc_approved_by TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_risk_level TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_source_of_funds TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_source_of_funds_notes TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_source_of_wealth TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_source_of_wealth_notes TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_pep_status TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_pep_notes TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_edd_required BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_edd_reason TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_edd_completed_at TIMESTAMP`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_edd_completed_by TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_edd_notes TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_id_verified BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_id_verified_at TIMESTAMP`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_id_verified_by TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_id_doc_type TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_address_verified BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_address_doc_type TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_sar_filed BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_sar_reference TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_sar_filed_at TIMESTAMP`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_compliance_notes TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_checklist JSONB`,
    `CREATE TABLE IF NOT EXISTS aml_settings (id SERIAL PRIMARY KEY, nominated_officer_id VARCHAR, nominated_officer_name TEXT, nominated_officer_email TEXT, nominated_officer_appointed_at TIMESTAMP, firm_risk_assessment JSONB, firm_risk_assessment_updated_at TIMESTAMP, firm_risk_assessment_updated_by TEXT, aml_policy_notes TEXT, recheck_interval_days INTEGER DEFAULT 365, updated_at TIMESTAMP DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS aml_training_records (id SERIAL PRIMARY KEY, user_id VARCHAR NOT NULL, user_name TEXT NOT NULL, training_type TEXT NOT NULL, training_date TIMESTAMP NOT NULL, completed_at TIMESTAMP, score INTEGER, topics TEXT[], notes TEXT, certified_by TEXT, next_due_date TIMESTAMP, created_at TIMESTAMP DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS aml_recheck_reminders (id SERIAL PRIMARY KEY, deal_id VARCHAR, company_id VARCHAR, entity_name TEXT NOT NULL, recheck_type TEXT NOT NULL, due_date TIMESTAMP NOT NULL, completed_at TIMESTAMP, completed_by TEXT, notes TEXT, created_at TIMESTAMP DEFAULT now())`,
    // User-drawn map annotations — pins, text labels, postcode highlights.
    // Kept light: each row is one annotation; `kind` discriminates type;
    // `geometry` is a tiny GeoJSON blob for future polygons / lines /
    // drive-time routes.
    `CREATE TABLE IF NOT EXISTS map_annotations (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), owner_id VARCHAR, kind TEXT NOT NULL, label TEXT, color TEXT, lat DOUBLE PRECISION, lng DOUBLE PRECISION, geometry JSONB, created_at TIMESTAMP DEFAULT now())`,
    // Named annotation layers — group pins / labels / polygons / drive
    // times into a coherent layer (e.g. "Brent Cross deck — Apr 2026")
    // that can be toggled, renamed, or shared as one unit.
    `CREATE TABLE IF NOT EXISTS map_layers (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, color TEXT, owner_id VARCHAR, shared_with_team BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT now())`,
    `ALTER TABLE map_annotations ADD COLUMN IF NOT EXISTS layer_id VARCHAR`,
    `ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'sharepoint'`,
    // knowledge_base_search_idx (GIN) is built AFTER this loop on a
    // dedicated no-timeout client — its build exceeds the pool's 30s
    // query_timeout, and the old DROP + CREATE pair here meant every boot
    // dropped the index then failed to rebuild it.
    `CREATE INDEX IF NOT EXISTS knowledge_base_source_idx ON knowledge_base (source)`,
    `CREATE INDEX IF NOT EXISTS knowledge_base_category_idx ON knowledge_base (category)`,
    `CREATE INDEX IF NOT EXISTS chat_messages_content_search_idx ON chat_messages USING GIN (to_tsvector('english', coalesce(content,'')))`,
    `CREATE TABLE IF NOT EXISTS user_tasks (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), user_id VARCHAR NOT NULL, title TEXT NOT NULL, description TEXT, due_date TIMESTAMP, priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'todo', category TEXT, linked_deal_id VARCHAR, linked_property_id VARCHAR, linked_contact_id VARCHAR, sort_order INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT now(), completed_at TIMESTAMP)`,
    // Watch House awards — admin-issued or auto-detected recognitions.
    // emoji + reason are free-form; kind = 'coffee'|'beer'|'lunch'|'star'|'auto'
    // surfaces on the dashboard. issued_by_user_id is null for auto awards.
    `CREATE TABLE IF NOT EXISTS staff_awards (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      issued_by_user_id VARCHAR,
      kind TEXT NOT NULL DEFAULT 'star',
      emoji TEXT,
      reason TEXT,
      created_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS staff_awards_recent_idx ON staff_awards (created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS staff_awards_user_idx ON staff_awards (user_id, created_at DESC)`,
    // Phone / laptop contract tracker — when's my upgrade.
    `CREATE TABLE IF NOT EXISTS staff_kit (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      kind TEXT NOT NULL,
      device TEXT,
      contract_start DATE,
      contract_end DATE,
      provider TEXT,
      monthly_cost_pence INTEGER,
      notes TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS staff_kit_user_idx ON staff_kit (user_id)`,
    // Benefits catalogue — admin-edited cards (cycle to work, nursery, EAP…).
    `CREATE TABLE IF NOT EXISTS benefits (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      eligibility TEXT,
      enrolment_url TEXT,
      contact TEXT,
      provider TEXT,
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`,
    // Per-user enrolment status across benefits.
    `CREATE TABLE IF NOT EXISTS staff_benefit_enrolments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      benefit_slug TEXT NOT NULL,
      status TEXT DEFAULT 'enrolled',
      enrolled_at TIMESTAMP DEFAULT now(),
      notes TEXT,
      UNIQUE (user_id, benefit_slug)
    )`,
    // Policy-level fields per benefit so HR can track renewals, premiums and
    // member-service URLs (Aviva Health, life insurance, dental etc).
    // No API integration with these providers — these are the practical fields
    // BGP needs to know when to re-quote and where to send staff to log in.
    `ALTER TABLE benefits ADD COLUMN IF NOT EXISTS policy_number TEXT`,
    `ALTER TABLE benefits ADD COLUMN IF NOT EXISTS policy_holder TEXT`,
    `ALTER TABLE benefits ADD COLUMN IF NOT EXISTS renewal_date DATE`,
    `ALTER TABLE benefits ADD COLUMN IF NOT EXISTS annual_premium_pence BIGINT`,
    `ALTER TABLE benefits ADD COLUMN IF NOT EXISTS group_size INTEGER`,
    `ALTER TABLE benefits ADD COLUMN IF NOT EXISTS provider_portal_url TEXT`,
    `ALTER TABLE benefits ADD COLUMN IF NOT EXISTS member_login_instructions TEXT`,
    `ALTER TABLE benefits ADD COLUMN IF NOT EXISTS broker_contact TEXT`,
    `ALTER TABLE benefits ADD COLUMN IF NOT EXISTS renewal_task_created_for_year INTEGER`,
    // Per-staff member numbers for member-services portals (Royal London
    // pension number, Aviva DigiCare member ID, etc).
    `CREATE TABLE IF NOT EXISTS staff_benefit_credentials (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      benefit_slug TEXT NOT NULL,
      member_number TEXT,
      member_email TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now(),
      UNIQUE (user_id, benefit_slug)
    )`,
    // RICS competencies + BGP career levels for the career roadmap module.
    `CREATE TABLE IF NOT EXISTS staff_competencies (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      competency TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 0,
      evidence TEXT,
      reviewed_at TIMESTAMP,
      reviewed_by_user_id VARCHAR,
      updated_at TIMESTAMP DEFAULT now(),
      UNIQUE (user_id, competency)
    )`,
    // Performance reviews — schema mirrors the actual BGP review template
    // shown in Tom Cater / Pete Wood / Alex Todd / Will Penfold / Lucy
    // Gardiner / Luke Donohoe's May 2026 reviews. Goals live in a separate
    // table so they can be linked to user_tasks for follow-through.
    `CREATE TABLE IF NOT EXISTS staff_reviews (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      period TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'annual',
      review_date DATE,
      current_salary_pence BIGINT,
      last_increase_date DATE,
      last_bonus_note TEXT,
      fees_target_pence BIGINT,
      fees_achieved_pence BIGINT,
      pipeline_under_offer_pence BIGINT,
      pipeline_negotiating_pence BIGINT,
      expected_invoice_next_year_pence BIGINT,
      achievements TEXT,
      development_areas TEXT,
      goals TEXT,
      referrals TEXT,
      marketing_pr TEXT,
      salary_expectation_pence BIGINT,
      feedback TEXT,
      bgp_can_help TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      submitted_at TIMESTAMP,
      reviewed_by_user_id VARCHAR,
      reviewed_at TIMESTAMP,
      ai_summary TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now(),
      UNIQUE (user_id, period)
    )`,
    `CREATE INDEX IF NOT EXISTS staff_reviews_user_idx ON staff_reviews (user_id, review_date DESC)`,
    `ALTER TABLE staff_reviews ADD COLUMN IF NOT EXISTS manager_comments TEXT`,
    `ALTER TABLE staff_reviews ADD COLUMN IF NOT EXISTS employee_acknowledgement TEXT`,
    `ALTER TABLE staff_reviews ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT '[]'::jsonb`,
    `ALTER TABLE staff_reviews ADD COLUMN IF NOT EXISTS source_file_url TEXT`,
    // Outcome-letter tracking — once admin clicks 'Draft letter', the
    // BGP-branded DOCX is cached in file_storage and the storage_key
    // is stamped here. letter_issued goes true when admin marks it
    // sent (no further edits allowed).
    `ALTER TABLE staff_reviews ADD COLUMN IF NOT EXISTS letter_storage_key TEXT`,
    `ALTER TABLE staff_reviews ADD COLUMN IF NOT EXISTS letter_generated_at TIMESTAMP`,
    `ALTER TABLE staff_reviews ADD COLUMN IF NOT EXISTS letter_issued BOOLEAN DEFAULT false`,
    `CREATE TABLE IF NOT EXISTS staff_review_goals (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      review_id VARCHAR,
      user_id VARCHAR NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      metric_type TEXT,
      target_value REAL,
      current_value REAL,
      due_date DATE,
      status TEXT DEFAULT 'active',
      linked_task_id VARCHAR,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS staff_review_goals_user_idx ON staff_review_goals (user_id, status)`,
    // Parental leave — maternity / paternity / shared parental / adoption.
    // Distinct from holiday_requests because it's a pre-planned multi-month
    // absence with KIT days, statutory pay milestones and a return date that
    // may shift. Status: planned → on_leave → returned (or extended/cancelled).
    `CREATE TABLE IF NOT EXISTS staff_parental_leave (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      kind TEXT NOT NULL,
      start_date DATE NOT NULL,
      planned_end_date DATE,
      actual_return_date DATE,
      kit_days_used INTEGER DEFAULT 0,
      kit_days_allowance INTEGER DEFAULT 10,
      status TEXT DEFAULT 'planned',
      notes TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS staff_parental_leave_user_idx ON staff_parental_leave (user_id, start_date DESC)`,
    `CREATE INDEX IF NOT EXISTS staff_parental_leave_active_idx ON staff_parental_leave (status, start_date)`,
    // Why Buy — Claude Design variant. Each row is an iteration of the deck.
    // Stored as self-contained HTML (inline CSS, no external assets) so we
    // can preview in a sandboxed iframe and print/export later.
    `CREATE TABLE IF NOT EXISTS why_buy_designs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL,
      version INTEGER NOT NULL,
      prompt TEXT,
      html TEXT NOT NULL,
      brief_snapshot JSONB,
      created_by_user_id VARCHAR,
      created_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS why_buy_designs_run_idx ON why_buy_designs (run_id, version DESC)`,
    // brief_hash = fingerprint of the brief the deck version was generated
    // from, so the in-app pane can flag a deck as stale when the pathway
    // data has drifted since.
    `ALTER TABLE why_buy_designs ADD COLUMN IF NOT EXISTS brief_hash TEXT`,
    // Pension contributions — Royal London CSV import per pay run.
    `CREATE TABLE IF NOT EXISTS pension_contributions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR,
      employee_match_name TEXT,
      pay_period TEXT,
      pay_date DATE,
      employee_pence BIGINT DEFAULT 0,
      employer_pence BIGINT DEFAULT 0,
      pensionable_pay_pence BIGINT,
      provider TEXT DEFAULT 'royal-london',
      source_file TEXT,
      imported_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS pension_contributions_user_idx ON pension_contributions (user_id, pay_date DESC)`,
    // Marketing events / activity calendar — Emmy's strategy in structured form.
    `CREATE TABLE IF NOT EXISTS marketing_events (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      kind TEXT,
      category TEXT,
      starts_at TIMESTAMP,
      ends_at TIMESTAMP,
      location TEXT,
      description TEXT,
      lead_user_id VARCHAR,
      attendee_user_ids TEXT[],
      attendee_contact_ids TEXT[],
      external_url TEXT,
      outlook_event_id TEXT,
      status TEXT DEFAULT 'planned',
      created_by_user_id VARCHAR,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS marketing_events_starts_idx ON marketing_events (starts_at)`,
    // Marketing campaigns — ongoing programmes from Emmy's strategy
    `CREATE TABLE IF NOT EXISTS marketing_campaigns (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      team TEXT,
      activity_type TEXT,
      cadence TEXT,
      lead_user_id VARCHAR,
      objective TEXT,
      proof_points TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT now()
    )`,
    // Press / media contacts list (separate from CRM contacts so journalists
    // don't pollute the agent/landlord tables)
    `CREATE TABLE IF NOT EXISTS marketing_press_contacts (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      title TEXT,
      publication TEXT,
      email TEXT,
      phone TEXT,
      bgp_lead_user_id VARCHAR,
      last_contact_at TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP DEFAULT now()
    )`,
    // Promotion pitches — what a surveyor presents to ED/board to make their case.
    `CREATE TABLE IF NOT EXISTS staff_promotion_pitches (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      from_level TEXT,
      to_level TEXT,
      pitch_date DATE,
      status TEXT DEFAULT 'draft',
      narrative TEXT,
      key_wins TEXT,
      financials TEXT,
      development TEXT,
      ask TEXT,
      ai_draft TEXT,
      decision TEXT,
      decision_notes TEXT,
      decided_at TIMESTAMP,
      decided_by_user_id VARCHAR,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS staff_promotion_pitches_user_idx ON staff_promotion_pitches (user_id, pitch_date DESC)`,
    // In-app file storage — replaces external SharePoint URLs for HR documents,
    // contracts, payslips, review attachments, headshots, etc. Binary lives in
    // file_blobs (split out so list/select queries stay light).
    `CREATE TABLE IF NOT EXISTS uploaded_files (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id VARCHAR,
      uploaded_by_user_id VARCHAR,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT,
      size_bytes BIGINT,
      linked_review_id VARCHAR,
      linked_deal_id VARCHAR,
      visibility TEXT DEFAULT 'admin-self',
      review_year INTEGER,
      notes TEXT,
      created_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS uploaded_files_owner_idx ON uploaded_files (owner_user_id, kind, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS file_blobs (
      file_id VARCHAR PRIMARY KEY,
      data BYTEA NOT NULL
    )`,
    // Per-team AI summaries — refreshed daily, fed to dashboard org cards.
    `CREATE TABLE IF NOT EXISTS team_ai_summaries (
      team TEXT PRIMARY KEY,
      summary TEXT,
      generated_at TIMESTAMP DEFAULT now()
    )`,
    // Brucey Bonuses — points awarded by AI (or admin) for good work, with a
    // weekly winner. event_kind is the action that earned them so we can de-dup.
    `CREATE TABLE IF NOT EXISTS brucey_points (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      points INTEGER NOT NULL,
      reason TEXT,
      event_kind TEXT,
      event_ref TEXT,
      awarded_by TEXT NOT NULL DEFAULT 'ai',
      awarded_by_user_id VARCHAR,
      created_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS brucey_points_user_idx ON brucey_points (user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS brucey_points_recent_idx ON brucey_points (created_at DESC)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS brucey_points_dedup_idx ON brucey_points (event_kind, event_ref) WHERE event_ref IS NOT NULL`,
    // Brucey Bonus Wheel — monthly + quarterly winners record what they
    // spun, the prize pool itself, and an audit of who spun what when.
    // Prizes stay in the pool after winning (reusable). Quarterly grand
    // prize is just a separate period_type entry — same wheel, bigger
    // prizes if Woody seeds them with a quarterly tag.
    `CREATE TABLE IF NOT EXISTS brucey_prizes (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      label TEXT NOT NULL,
      description TEXT,
      emoji TEXT,
      tier TEXT NOT NULL DEFAULT 'monthly',
      sort_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS brucey_prizes_tier_idx ON brucey_prizes (tier, sort_order) WHERE is_active = true`,
    `CREATE TABLE IF NOT EXISTS brucey_winners (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      period_type TEXT NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      points INTEGER NOT NULL,
      prize_id VARCHAR,
      prize_label TEXT,
      spun_at TIMESTAMP DEFAULT now(),
      spun_by_user_id VARCHAR,
      notes TEXT
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS brucey_winners_period_idx ON brucey_winners (period_type, period_start)`,
    `CREATE INDEX IF NOT EXISTS brucey_winners_user_idx ON brucey_winners (user_id, spun_at DESC)`,
    // Seed the default prize pool — only fires when the table is empty so
    // edits made on the admin page survive re-deploys.
    `INSERT INTO brucey_prizes (label, description, emoji, tier, sort_order)
     SELECT * FROM (VALUES
       ('Watch House lunch',   'Sandwich + coffee on the firm',                   '☕'::text, 'monthly'::text,   1),
       ('Half-day Friday',     'Knock off at lunch on the Friday of your choosing','🌴'::text, 'monthly'::text,   2),
       ('£50 voucher',         'Amazon / John Lewis / whoever',                   '💷'::text, 'monthly'::text,   3),
       ('Bottle of bubbles',   'Decent fizz, your desk on Monday',                '🍾'::text, 'monthly'::text,   4),
       ('Cinema tickets x2',   'Cineworld pair',                                  '🎬'::text, 'monthly'::text,   5),
       ('Coffee for the team', 'Watch House run on you, on us',                   '🫖'::text, 'monthly'::text,   6),
       ('Restaurant for two',  'Dinner for two at a Tom-and-Pete-approved spot',  '🍽️'::text, 'quarterly'::text, 1),
       ('Spa half-day',        'Treat yourself',                                  '💆'::text, 'quarterly'::text, 2),
       ('Theatre tickets',     'Two tickets to a West End show',                  '🎭'::text, 'quarterly'::text, 3),
       ('£250 voucher',        'Quarterly grand prize',                           '💰'::text, 'quarterly'::text, 4)
     ) AS s(label, description, emoji, tier, sort_order)
     WHERE NOT EXISTS (SELECT 1 FROM brucey_prizes)`,
    `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS linked_onenote_page_id TEXT`,
    `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS linked_onenote_page_url TEXT`,
    `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS linked_evernote_note_id TEXT`,
    `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS linked_evernote_note_url TEXT`,
    `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS parent_task_id VARCHAR`,
    `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false`,
    `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS tags TEXT`,
    `CREATE TABLE IF NOT EXISTS system_activity_log (id SERIAL PRIMARY KEY, source TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, count INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS image_studio_images (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), file_name TEXT NOT NULL, category TEXT DEFAULT 'Uncategorised', tags TEXT[] DEFAULT '{}', description TEXT, source TEXT DEFAULT 'upload', property_id VARCHAR, area TEXT, address TEXT, brand_name TEXT, brand_sector TEXT, property_type TEXT, mime_type TEXT DEFAULT 'image/jpeg', file_size INTEGER, width INTEGER, height INTEGER, thumbnail_data TEXT, sharepoint_item_id TEXT, sharepoint_drive_id TEXT, local_path TEXT, uploaded_by VARCHAR, created_at TIMESTAMP DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS image_studio_collections (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, description TEXT, cover_image_id VARCHAR, created_by VARCHAR, created_at TIMESTAMP DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS image_studio_collection_images (id SERIAL PRIMARY KEY, collection_id VARCHAR NOT NULL, image_id VARCHAR NOT NULL, added_at TIMESTAMP DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS deleted_sharepoint_images (id SERIAL PRIMARY KEY, sharepoint_drive_id TEXT NOT NULL, sharepoint_item_id TEXT NOT NULL, deleted_at TIMESTAMP DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS comp_files (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), comp_id VARCHAR NOT NULL, file_name TEXT NOT NULL, file_path TEXT NOT NULL, file_size INTEGER, mime_type TEXT, created_at TIMESTAMP DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS land_registry_searches (id SERIAL PRIMARY KEY, user_id VARCHAR NOT NULL, address TEXT NOT NULL, postcode TEXT, freeholds_count INTEGER DEFAULT 0, leaseholds_count INTEGER DEFAULT 0, freeholds JSONB, leaseholds JSONB, intelligence JSONB, ai_summary JSONB, ownership JSONB, crm_property_id VARCHAR, notes TEXT, tags JSONB DEFAULT '[]', status VARCHAR DEFAULT 'New', created_at TIMESTAMP DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS leasing_schedule_units (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), property_id VARCHAR NOT NULL, unit_name TEXT, zone TEXT, positioning TEXT, tenant_name TEXT, agent_initials TEXT, lease_expiry TIMESTAMP, lease_break TIMESTAMP, rent_review TIMESTAMP, landlord_break TIMESTAMP, rent_pa REAL, sqft REAL, mat_psqft REAL, lfl_percent REAL, occ_cost_percent REAL, financial_notes TEXT, target_brands TEXT, optimum_target TEXT, priority TEXT, status TEXT, updates TEXT, target_company_ids TEXT[], sort_order INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS leasing_schedule_audit (id SERIAL PRIMARY KEY, unit_id VARCHAR, property_id VARCHAR NOT NULL, user_id VARCHAR NOT NULL, user_name TEXT NOT NULL, action TEXT NOT NULL, field_name TEXT, old_value TEXT, new_value TEXT, created_at TIMESTAMP DEFAULT now())`,
    // Frozen snapshots of a property's Leasing Schedule — used to record what
    // was presented at a given Monday client meeting. Contents are a JSON
    // dump of every leasing_schedule_units row for the property at snapshot
    // time. Past meetings stay reclaimable even as the live schedule moves on.
    `CREATE TABLE IF NOT EXISTS leasing_schedule_snapshots (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id VARCHAR NOT NULL,
      meeting_month TEXT,
      taken_at TIMESTAMP DEFAULT now(),
      taken_by_id VARCHAR,
      taken_by_name TEXT,
      unit_count INTEGER,
      notes TEXT,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_leasing_snapshots_property ON leasing_schedule_snapshots(property_id, taken_at DESC)`,

    // Tenancy schedule — single source of truth per unit, aligned with the
    // Landsec investment-grade template (see SharePoint: Landsec Leisure -
    // Tenancy Schedule - BGP.xlsx). Columns are union of Landsec template +
    // a handful of legacy columns kept alive for the xlsx import path.
    `CREATE TABLE IF NOT EXISTS tenancy_schedule_units (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id VARCHAR NOT NULL,
      -- Unit Details
      grouping TEXT,
      premises TEXT,
      unit_number TEXT,
      permitted_use TEXT,
      status TEXT,
      am_initiative TEXT,
      -- Tenant Details
      tenant_name TEXT,
      trading_name TEXT,
      tenant_mix TEXT,
      -- Lease Details
      lease_start DATE,
      break_date DATE,
      break_details TEXT,
      break_notice TEXT,
      lease_expiry DATE,
      term_years REAL,
      unexpired_term_break REAL,
      unexpired_term REAL,
      next_review_date DATE,
      outside_lt_act TEXT,
      measurement_type TEXT,
      -- Areas — GIA per floor
      area_basement_gia REAL,
      area_ground_gia REAL,
      area_first_gia REAL,
      area_other_gia REAL,
      -- Areas — NIA per floor
      area_basement_nia REAL,
      area_ground_nia REAL,
      area_first_nia REAL,
      area_first_sales_nia REAL,
      area_other_nia REAL,
      -- Areas — ITZA + totals
      area_ground_itza REAL,
      gia_sqft REAL,
      nia_sqft REAL,
      itza_sqft REAL,
      units_applied REAL,
      -- Rental Income
      passing_rent_pa REAL,
      marketing_rent_pa REAL,
      turnover_rent_payable REAL,
      erv_profile TEXT,
      erv_pa REAL,
      rent_free_value REAL,
      capex_value REAL,
      -- Rates (MLA)
      rateable_value REAL,
      rates_payable REAL,
      -- Occupational Costs
      service_charge REAL,
      service_charge_cap REAL,
      insurance REAL,
      -- Shortfalls
      shortfall_liability TEXT,
      rental_shortfalls REAL,
      -- NOI
      topped_up_noi REAL,
      noi_pa REAL,
      -- Comments
      comments TEXT,
      leasing_comments TEXT,
      target_tenants TEXT,
      target_company_ids TEXT[],
      underwriting_comments TEXT,
      -- BGP integration
      epc_rating TEXT,
      rent_psf REAL,
      turnover_percent REAL,
      blended_erv REAL,
      deal_id VARCHAR,
      letting_tracker_unit_id VARCHAR,
      in_leasing_schedule BOOLEAN DEFAULT false,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now(),
      -- Legacy columns kept alive for the xlsx import path; UI will not read
      -- or write these going forward, drop in a later cleanup commit.
      area_basement REAL,
      area_ground REAL,
      area_first REAL,
      area_second REAL,
      area_other REAL,
      landlord_shortfall REAL,
      net_income REAL,
      total_occ_costs REAL,
      occ_costs_psf REAL,
      wault_rent_percent REAL,
      break_type TEXT,
      rent_review_1_date TEXT,
      rent_review_1_amount TEXT,
      rent_review_2_date TEXT,
      rent_review_2_amount TEXT,
      rent_review_3_date TEXT,
      rent_review_3_amount TEXT,
      rent_review_4_date TEXT,
      rent_review_4_amount TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tenancy_schedule_units_property ON tenancy_schedule_units(property_id)`,
    `CREATE TABLE IF NOT EXISTS kyc_investigations (id SERIAL PRIMARY KEY, subject_type TEXT NOT NULL, subject_name TEXT NOT NULL, company_number TEXT, crm_company_id VARCHAR, officer_name TEXT, risk_level TEXT, risk_score INTEGER, sanctions_match BOOLEAN DEFAULT false, result JSONB, conducted_by VARCHAR, conducted_at TIMESTAMP DEFAULT now(), notes TEXT)`,
    `CREATE INDEX IF NOT EXISTS kyc_investigations_company_number_idx ON kyc_investigations (company_number)`,
    `CREATE INDEX IF NOT EXISTS kyc_investigations_crm_company_id_idx ON kyc_investigations (crm_company_id)`,
    `CREATE INDEX IF NOT EXISTS kyc_investigations_conducted_at_idx ON kyc_investigations (conducted_at)`,
    `CREATE TABLE IF NOT EXISTS kyc_audit_log (id SERIAL PRIMARY KEY, investigation_id TEXT NOT NULL, action TEXT NOT NULL, performed_by VARCHAR, notes TEXT, created_at TIMESTAMP DEFAULT now())`,
    `ALTER TABLE kyc_audit_log ALTER COLUMN investigation_id TYPE TEXT USING investigation_id::TEXT`,
    `CREATE TABLE IF NOT EXISTS deal_audit_log (id SERIAL PRIMARY KEY, deal_id VARCHAR NOT NULL, field TEXT NOT NULL, old_value TEXT, new_value TEXT, reason TEXT, changed_by VARCHAR, changed_by_name VARCHAR, created_at TIMESTAMP DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS kyc_documents (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), company_id VARCHAR, contact_id VARCHAR, deal_id VARCHAR, doc_type TEXT NOT NULL, file_url TEXT NOT NULL, file_name TEXT NOT NULL, file_size INTEGER, mime_type TEXT, certified_by TEXT, certified_at TIMESTAMP, expires_at TIMESTAMP, notes TEXT, uploaded_by VARCHAR, uploaded_at TIMESTAMP DEFAULT now(), deleted_at TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_kyc_documents_company_id ON kyc_documents(company_id) WHERE deleted_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_kyc_documents_contact_id ON kyc_documents(contact_id) WHERE deleted_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_kyc_documents_deal_id ON kyc_documents(deal_id) WHERE deleted_at IS NULL`,
    `CREATE TABLE IF NOT EXISTS aml_training_modules (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT NOT NULL, description TEXT, content_markdown TEXT NOT NULL, quiz JSONB NOT NULL DEFAULT '[]'::jsonb, pass_score INTEGER DEFAULT 80, estimated_minutes INTEGER, required_for_roles TEXT[], active BOOLEAN DEFAULT true, created_by VARCHAR, created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS aml_training_attempts (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), module_id VARCHAR NOT NULL, user_id VARCHAR NOT NULL, user_name TEXT, answers JSONB NOT NULL, score INTEGER NOT NULL, passed BOOLEAN NOT NULL, started_at TIMESTAMP DEFAULT now(), completed_at TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_aml_training_attempts_user ON aml_training_attempts(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_aml_training_attempts_module ON aml_training_attempts(module_id)`,
    `CREATE TABLE IF NOT EXISTS veriff_sessions (session_id TEXT PRIMARY KEY, company_id VARCHAR, contact_id VARCHAR, deal_id VARCHAR, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT, status TEXT, decision_code INTEGER, decision_reason TEXT, verdict_person JSONB, verdict_document JSONB, verification_url TEXT, requested_by VARCHAR, created_at TIMESTAMP DEFAULT now(), received_at TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_veriff_sessions_company ON veriff_sessions(company_id)`,
    `CREATE INDEX IF NOT EXISTS idx_veriff_sessions_deal ON veriff_sessions(deal_id)`,
    `CREATE TABLE IF NOT EXISTS data_room_analyses (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), user_id VARCHAR NOT NULL, deal_name TEXT NOT NULL, team TEXT, crm_deal_id VARCHAR, file_count INTEGER DEFAULT 0, red_flags INTEGER DEFAULT 0, amber_flags INTEGER DEFAULT 0, green_flags INTEGER DEFAULT 0, overall_risk TEXT, overall_summary TEXT, analysis JSONB, created_at TIMESTAMP DEFAULT now())`,
    `ALTER TABLE data_room_analyses ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'done'`,
    `ALTER TABLE data_room_analyses ADD COLUMN IF NOT EXISTS progress_classified INTEGER DEFAULT 0`,
    `ALTER TABLE data_room_analyses ADD COLUMN IF NOT EXISTS progress_total INTEGER DEFAULT 0`,
    `ALTER TABLE data_room_analyses ADD COLUMN IF NOT EXISTS error_message TEXT`,
    `ALTER TABLE data_room_analyses ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`,
    `CREATE INDEX IF NOT EXISTS idx_data_room_analyses_user ON data_room_analyses(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_data_room_analyses_deal ON data_room_analyses(crm_deal_id) WHERE crm_deal_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS data_room_files (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), analysis_id VARCHAR NOT NULL, user_id VARCHAR NOT NULL, archive_name TEXT, file_name TEXT NOT NULL, display_name TEXT NOT NULL, file_size INTEGER, primary_type TEXT, sub_type TEXT, extracted_text TEXT, classification JSONB, enrichment JSONB, created_at TIMESTAMP DEFAULT now())`,
    `ALTER TABLE data_room_files ADD COLUMN IF NOT EXISTS local_path TEXT`,
    `ALTER TABLE data_room_files ADD COLUMN IF NOT EXISTS mime_type TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_data_room_files_analysis ON data_room_files(analysis_id)`,
    `ALTER TABLE aml_settings ADD COLUMN IF NOT EXISTS firm_risk_assessment_status TEXT`,
    `ALTER TABLE aml_settings ADD COLUMN IF NOT EXISTS firm_risk_assessment_approved_at TIMESTAMP`,
    `ALTER TABLE aml_settings ADD COLUMN IF NOT EXISTS firm_risk_assessment_approved_by TEXT`,
    `ALTER TABLE aml_settings ADD COLUMN IF NOT EXISTS firm_risk_assessment_next_review_at TIMESTAMP`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS kyc_approved_by TEXT`,
    // Cached HTML render of each policy doc — DOCX files get converted via
    // mammoth on first access so the policy list shows them inline with BGP
    // styling instead of a "click to download" prompt.
    `ALTER TABLE policy_files ADD COLUMN IF NOT EXISTS rendered_html TEXT`,
    `ALTER TABLE policy_files ADD COLUMN IF NOT EXISTS rendered_at TIMESTAMP`,
    // Cache the line-level invoice content so we can round-trip with Xero —
    // edits on either side stay in sync. Stored on the xero_invoices row
    // alongside the existing status/total/number.
    `ALTER TABLE xero_invoices ADD COLUMN IF NOT EXISTS line_description TEXT`,
    `ALTER TABLE xero_invoices ADD COLUMN IF NOT EXISTS line_amount REAL`,
    `ALTER TABLE xero_invoices ADD COLUMN IF NOT EXISTS contact_name TEXT`,
    `ALTER TABLE xero_invoices ADD COLUMN IF NOT EXISTS po_number TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS kyc_expires_at TIMESTAMP`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_checklist JSONB`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_risk_level TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_pep_status TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS ai_competitors JSONB`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS ai_competitors_at TIMESTAMP`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_source_of_wealth TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_source_of_wealth_notes TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_edd_required BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_edd_reason TEXT`,
    // CH-accounts auto-fetch (May 2026). doc_id = CH document-metadata UUID,
    // storage_key points at the PDF in the file_storage table. We only
    // re-download when doc_id changes (every CH filing gets a new UUID).
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS last_accounts_doc_id TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS last_accounts_made_up_to DATE`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS last_accounts_storage_key TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS last_accounts_fetched_at TIMESTAMP`,
    // SharePoint folder structure for landlords (May 2026). Mirrors the
    // crm_properties columns so PropertyFoldersPanel can be reused by
    // passing the landlord's company name as propertyName.
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS folder_teams TEXT[]`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS sharepoint_folder_url TEXT`,
    // Annual report auto-download for landlords (May 2026). Same shape
    // as last_accounts_* — original public URL the scraper found,
    // file_storage key for the cached PDF, fetched timestamp.
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS annual_report_url TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS annual_report_storage_key TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS annual_report_fetched_at TIMESTAMP`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_notes TEXT`,
    // Per-account roles for BGP staff covering a brand / landlord.
    // bgp_contact_user_ids[] answers WHO covers the account; this
    // table answers WHAT each of them does for it (Charlotte =
    // Investment lead, Harriette = Leasing). Row exists only when
    // someone has typed a role; missing row → no role assigned.
    `CREATE TABLE IF NOT EXISTS crm_company_bgp_roles (
       company_id TEXT NOT NULL,
       user_id TEXT NOT NULL,
       role TEXT,
       created_at TIMESTAMPTZ DEFAULT NOW(),
       updated_at TIMESTAMPTZ DEFAULT NOW(),
       PRIMARY KEY (company_id, user_id)
     )`,
    // Property plans (Goad / leasing plan / agent-supplied PDF). One
    // row per FLOOR per property — a centre like Bluewater needs
    // Ground + First. The plan image lives in file_storage; we keep
    // width/height here so polygon overlays scale correctly without
    // an extra fetch.
    `CREATE TABLE IF NOT EXISTS property_plans (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       property_id TEXT NOT NULL,
       floor TEXT NOT NULL,
       display_order INT DEFAULT 0,
       storage_key TEXT NOT NULL,
       width INT,
       height INT,
       source TEXT,
       notes TEXT,
       created_at TIMESTAMPTZ DEFAULT NOW(),
       updated_at TIMESTAMPTZ DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_property_plans_property ON property_plans (property_id, display_order)`,
    // Geographic-overlay columns — Phase 1 of the 'upload any tenancy
    // plan' flow. When a GeoJSON (or vector file converted to GeoJSON)
    // is uploaded, the polygons are stored on the plan row itself so
    // the live Pathway map can render them as a layer without an extra
    // round-trip. is_geo flags whether this plan has world coordinates
    // (vs the legacy image-based plans with 0-1 normalised polygons).
    `ALTER TABLE property_plans ADD COLUMN IF NOT EXISTS geojson JSONB`,
    `ALTER TABLE property_plans ADD COLUMN IF NOT EXISTS is_geo BOOLEAN DEFAULT false`,
    `ALTER TABLE property_plans ADD COLUMN IF NOT EXISTS bbox_north DOUBLE PRECISION`,
    `ALTER TABLE property_plans ADD COLUMN IF NOT EXISTS bbox_south DOUBLE PRECISION`,
    `ALTER TABLE property_plans ADD COLUMN IF NOT EXISTS bbox_east DOUBLE PRECISION`,
    `ALTER TABLE property_plans ADD COLUMN IF NOT EXISTS bbox_west DOUBLE PRECISION`,
    `CREATE INDEX IF NOT EXISTS idx_property_plans_geo ON property_plans (is_geo, bbox_west, bbox_east, bbox_south, bbox_north) WHERE is_geo = true`,

    // Property brochures — leasing / investment / OM PDFs uploaded
    // directly to a property's brochure board. Same pattern as
    // property_plans: row carries metadata + storage_key, bytes live
    // in file_storage. No SharePoint dependency — brochures are
    // BGP-native. The "type" column drives the leasing/investment
    // toggle on the property page; "archived" hides old versions
    // until the team opens the Archive accordion.
    `CREATE TABLE IF NOT EXISTS property_brochures (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       property_id TEXT NOT NULL,
       type TEXT NOT NULL CHECK (type IN ('leasing', 'investment')),
       original_name TEXT NOT NULL,
       storage_key TEXT NOT NULL,
       mime_type TEXT DEFAULT 'application/pdf',
       size_bytes BIGINT,
       page_count INT,
       archived BOOLEAN DEFAULT false,
       notes TEXT,
       uploaded_by TEXT,
       created_at TIMESTAMPTZ DEFAULT NOW(),
       updated_at TIMESTAMPTZ DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_property_brochures_property ON property_brochures (property_id, type, archived)`,

    // Polygons drawn on a plan. unit_id (nullable) links to
    // leasing_schedule_units — that's where status / tenant / rent
    // come from at render time, so the plan is automatically a
    // visual mirror of the schedule. status_override lets the plan
    // show a state (under offer) before the schedule reflects it.
    // polygon is { points: [[x, y], ...] } with x/y normalised 0-1
    // against the plan image dimensions so the SVG scales cleanly.
    `CREATE TABLE IF NOT EXISTS property_plan_units (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       plan_id UUID NOT NULL,
       unit_id TEXT,
       label TEXT,
       polygon JSONB NOT NULL,
       status_override TEXT,
       created_at TIMESTAMPTZ DEFAULT NOW(),
       updated_at TIMESTAMPTZ DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_property_plan_units_plan ON property_plan_units (plan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_property_plan_units_unit ON property_plan_units (unit_id) WHERE unit_id IS NOT NULL`,
    // Type-mismatch cleanup (may already be correct — that's fine)
    `ALTER TABLE crm_deals ALTER COLUMN break_option TYPE TEXT USING break_option::text`,
    // Indexes for compliance-board counterparty joins (otherwise /api/kyc/board
    // and /api/kyc/board/deals do four full scans of crm_deals per request).
    `CREATE INDEX IF NOT EXISTS idx_crm_deals_landlord_id  ON crm_deals(landlord_id)  WHERE landlord_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant_id    ON crm_deals(tenant_id)    WHERE tenant_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_crm_deals_vendor_id    ON crm_deals(vendor_id)    WHERE vendor_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_crm_deals_purchaser_id ON crm_deals(purchaser_id) WHERE purchaser_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_crm_deals_status       ON crm_deals(status)`,

    // ── Brand Bible / deal flow — additive schema ─────────────────────────
    // crm_companies: brand fields
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS is_tracked_brand BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS tracking_reason TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS brand_group_id VARCHAR`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS concept_pitch TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS store_count INTEGER`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS rollout_status TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS backers TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS instagram_handle TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS tiktok_handle TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS dept_store_presence TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS franchise_activity TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS hunter_flag BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS stock_ticker TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS agent_type TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS ai_generated_fields JSONB`,
    `CREATE INDEX IF NOT EXISTS idx_crm_companies_is_tracked_brand ON crm_companies(is_tracked_brand) WHERE is_tracked_brand = true`,
    `CREATE INDEX IF NOT EXISTS idx_crm_companies_brand_group_id   ON crm_companies(brand_group_id) WHERE brand_group_id IS NOT NULL`,

    // crm_deals: stage + solicitor leg
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS stage TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMP`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS solicitor_firm TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS solicitor_contact TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS solicitor_instructed_at TIMESTAMP`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS draft_lease_received_at TIMESTAMP`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS comments_returned_at TIMESTAMP`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS engrossment_at TIMESTAMP`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS solicitor_notes TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals(stage) WHERE stage IS NOT NULL`,

    // available_units: link to leasing schedule unit
    `ALTER TABLE available_units ADD COLUMN IF NOT EXISTS leasing_schedule_unit_id VARCHAR`,
    `CREATE INDEX IF NOT EXISTS idx_available_units_leasing_schedule_unit_id ON available_units(leasing_schedule_unit_id) WHERE leasing_schedule_unit_id IS NOT NULL`,

    // unit_briefs: operator targeting briefs per letting tracker unit (e.g. Landsec instructions)
    `CREATE TABLE IF NOT EXISTS unit_briefs (
       id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
       unit_id VARCHAR NOT NULL,
       property_id VARCHAR NOT NULL,
       client_company TEXT,
       client_company_id VARCHAR,
       title TEXT,
       objective TEXT,
       location_context TEXT,
       target_criteria TEXT,
       priority_categories TEXT,
       agent_instruction TEXT,
       success_measures TEXT,
       instructed_date TEXT,
       deadline1_date TEXT,
       deadline1_deliverables TEXT,
       deadline2_date TEXT,
       deadline2_deliverables TEXT,
       min_targets INTEGER DEFAULT 5,
       priority_targets INTEGER DEFAULT 2,
       status TEXT DEFAULT 'Active',
       source_file_id VARCHAR,
       document_file_id VARCHAR,
       created_by_user_id VARCHAR,
       created_by_name TEXT,
       created_at TIMESTAMP DEFAULT now(),
       updated_at TIMESTAMP DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_unit_briefs_unit ON unit_briefs(unit_id)`,
    `CREATE INDEX IF NOT EXISTS idx_unit_briefs_property ON unit_briefs(property_id)`,
    `CREATE TABLE IF NOT EXISTS unit_target_operators (
       id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
       brief_id VARCHAR NOT NULL,
       operator_name TEXT NOT NULL,
       company_id VARCHAR,
       category TEXT,
       priority TEXT,
       rationale TEXT,
       existing_relationship TEXT,
       feedback TEXT,
       status TEXT DEFAULT 'Identified',
       sort_order INTEGER DEFAULT 0,
       created_at TIMESTAMP DEFAULT now(),
       updated_at TIMESTAMP DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_unit_target_operators_brief ON unit_target_operators(brief_id)`,

    // brand_agent_representations
    `CREATE TABLE IF NOT EXISTS brand_agent_representations (
       id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
       brand_company_id VARCHAR NOT NULL,
       agent_company_id VARCHAR NOT NULL,
       agent_type TEXT NOT NULL,
       region TEXT,
       primary_contact_id VARCHAR,
       start_date TIMESTAMP,
       end_date TIMESTAMP,
       notes TEXT,
       created_at TIMESTAMP DEFAULT now(),
       updated_at TIMESTAMP DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_brand_agent_rep_brand ON brand_agent_representations(brand_company_id)`,
    `CREATE INDEX IF NOT EXISTS idx_brand_agent_rep_agent ON brand_agent_representations(agent_company_id)`,
    `CREATE INDEX IF NOT EXISTS idx_brand_agent_rep_active ON brand_agent_representations(brand_company_id) WHERE end_date IS NULL`,

    // brand_signals (time-series of openings / closures / funding / news)
    `CREATE TABLE IF NOT EXISTS brand_signals (
       id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
       brand_company_id VARCHAR NOT NULL,
       signal_type TEXT NOT NULL,
       headline TEXT NOT NULL,
       detail TEXT,
       source TEXT,
       signal_date TIMESTAMP,
       magnitude TEXT,
       sentiment TEXT,
       ai_generated BOOLEAN DEFAULT false,
       created_at TIMESTAMP DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_brand_signals_brand_date ON brand_signals(brand_company_id, signal_date DESC)`,

    // leasing_pitch (per-property ERV / incentives / target tenants)
    `CREATE TABLE IF NOT EXISTS leasing_pitch (
       id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
       property_id VARCHAR NOT NULL UNIQUE,
       erv REAL,
       erv_per_sqft REAL,
       incentive_plan TEXT,
       rent_free_months INTEGER,
       capex_contribution REAL,
       fit_out_contribution REAL,
       target_brand_ids TEXT[],
       marketing_strategy TEXT,
       positioning TEXT,
       ai_generated_fields JSONB,
       created_at TIMESTAMP DEFAULT now(),
       updated_at TIMESTAMP DEFAULT now()
     )`,

    // deal_hots (structured, versioned Heads of Terms)
    `CREATE TABLE IF NOT EXISTS deal_hots (
       id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
       deal_id VARCHAR NOT NULL,
       version INTEGER NOT NULL DEFAULT 1,
       rent_pa REAL,
       term_years REAL,
       break_option TEXT,
       rent_free_months REAL,
       fit_out_contribution REAL,
       deposit REAL,
       rent_review_mechanism TEXT,
       use_class TEXT,
       alienation TEXT,
       repair_obligations TEXT,
       aga_required BOOLEAN DEFAULT false,
       schedule_of_condition BOOLEAN DEFAULT false,
       notes TEXT,
       status TEXT DEFAULT 'draft',
       signed_at TIMESTAMP,
       signed_by TEXT,
       created_by VARCHAR,
       created_at TIMESTAMP DEFAULT now(),
       updated_at TIMESTAMP DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_hots_deal_version ON deal_hots(deal_id, version DESC)`,

    // deal_events (append-only audit log)
    `CREATE TABLE IF NOT EXISTS deal_events (
       id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
       deal_id VARCHAR NOT NULL,
       event_type TEXT NOT NULL,
       from_stage TEXT,
       to_stage TEXT,
       payload JSONB,
       actor_id VARCHAR,
       actor_name TEXT,
       occurred_at TIMESTAMP DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_events_deal_occurred ON deal_events(deal_id, occurred_at DESC)`,

    // Dedupe machinery — track merges so we can undo and hide merged rows
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS merged_into_id VARCHAR`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS merged_at TIMESTAMP`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS merged_by TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS uk_entity_name TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_crm_companies_merged_into ON crm_companies(merged_into_id) WHERE merged_into_id IS NOT NULL`,

    // ── Landlord/Investor hunter signals ──────────────────────────────
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS mandate_asset_class TEXT[]`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS mandate_lot_size_min REAL`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS mandate_lot_size_max REAL`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS mandate_geographies TEXT[]`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS acquiring_now BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS acquiring_now_notes TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS capital_source TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aum REAL`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS fund_vintage_year INTEGER`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS fund_end_year INTEGER`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS disposing_now BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS disposing_now_notes TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS distress_flag BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS distress_notes TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS letting_hunter_flag BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS letting_hunter_notes TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS investment_hunter_flag BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS investment_hunter_notes TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS asset_manager_contact_id VARCHAR`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS website TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS concept_status TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS brand_analysis TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS brand_analysis_at TIMESTAMP`,
    // crm_properties drift
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS postcode TEXT`,
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS latitude TEXT`,
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS longitude TEXT`,
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS tags TEXT`,
    // crm_contacts drift
    `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS phone_mobile TEXT`,
    `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS sub_group TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_crm_companies_acquiring_now ON crm_companies(acquiring_now) WHERE acquiring_now = true`,
    `CREATE INDEX IF NOT EXISTS idx_crm_companies_distress_flag ON crm_companies(distress_flag) WHERE distress_flag = true`,
    `CREATE INDEX IF NOT EXISTS idx_crm_companies_letting_hunter ON crm_companies(letting_hunter_flag) WHERE letting_hunter_flag = true`,

    // ── Letting hunter — competitor agent on each property ────────────
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS competitor_agent TEXT`,
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS competitor_agent_instructed_at TIMESTAMP`,
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS competitor_agent_status TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_crm_properties_competitor_agent ON crm_properties(competitor_agent) WHERE competitor_agent IS NOT NULL`,

    // ── Ownership stack on properties ─────────────────────────────────
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS freeholder_id VARCHAR`,
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS long_leaseholder_id VARCHAR`,
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS senior_lender_id VARCHAR`,
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS junior_lender_id VARCHAR`,
    // Asset Brief — structured fields that replace the Notes blob.
    // weekly_focus is an array of { id, text, owner_user_id, deal_id }
    // — the 3-5 items the asset lead types in. Everything else on the
    // brief (active deals, activity feed, risks, performance) is
    // derived live from other tables.
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS weekly_focus JSONB DEFAULT '[]'::jsonb`,
    // BGP Commentary — Claude-generated 3-5 sentence narrative on
    // what's happening at the property, written from the asset-brief
    // payload (active deals, risks, leasing schedule, recent activity).
    // Re-rolls on demand via the panel's refresh button.
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS bgp_commentary TEXT`,
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS bgp_commentary_at TIMESTAMP`,
    // Competitor Agent — FK to crm_companies (where company_type =
    // 'Agent'). The legacy competitor_agent text column lives on for
    // display + back-compat with anything that reads it; we update
    // it from the company name on link.
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS competitor_agent_id VARCHAR`,
    // Unified schedule rollout flag. When true on a property, the property
    // detail page collapses the separate Leasing Schedule + Tenancy Schedule
    // panels into one "Schedule" panel with a lens toggle (Lettings vs
    // Tenancy). Bluewater is the first test property; once verified we'll
    // flip the firm-wide default to true and retire the two old panels.
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS unified_schedule BOOLEAN DEFAULT false`,
    // Backfill: existing landlord_id → freeholder_id (best default; user can correct)
    `UPDATE crm_properties SET freeholder_id = landlord_id WHERE freeholder_id IS NULL AND landlord_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_crm_properties_freeholder ON crm_properties(freeholder_id) WHERE freeholder_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_crm_properties_senior_lender ON crm_properties(senior_lender_id) WHERE senior_lender_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_crm_properties_junior_lender ON crm_properties(junior_lender_id) WHERE junior_lender_id IS NOT NULL`,

    // ── Lender profile fields on crm_companies ────────────────────────
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS lender_type TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS lending_active BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS typical_loan_size_min_m REAL`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS typical_loan_size_max_m REAL`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS typical_ltv_max REAL`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS typical_margin_bps INTEGER`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS typical_loan_term TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS typical_loan_structure TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS recourse TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS preferred_asset_classes TEXT[]`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS preferred_geographies TEXT[]`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS lending_appetite_notes TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS x_handle TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS last_interaction TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_crm_companies_lending_active ON crm_companies(lending_active) WHERE lending_active = true`,

    // ── Landlord debt / capital event log — distress + activity stream ──
    `CREATE TABLE IF NOT EXISTS landlord_debt_events (
       id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
       landlord_id VARCHAR NOT NULL,
       property_id VARCHAR,
       event_type TEXT NOT NULL,
       event_date TIMESTAMP,
       lender TEXT,
       amount REAL,
       notes TEXT,
       source_url TEXT,
       source TEXT DEFAULT 'manual',
       created_at TIMESTAMP DEFAULT NOW(),
       updated_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_landlord_debt_events_landlord ON landlord_debt_events(landlord_id)`,
    `CREATE INDEX IF NOT EXISTS idx_landlord_debt_events_property ON landlord_debt_events(property_id) WHERE property_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_landlord_debt_events_date ON landlord_debt_events(event_date)`,

    `CREATE TABLE IF NOT EXISTS dedupe_candidates (
       id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
       cluster_key TEXT NOT NULL,
       company_ids TEXT[] NOT NULL,
       reason TEXT,
       ai_verdict TEXT,
       ai_confidence REAL,
       status TEXT DEFAULT 'pending',
       reviewed_by TEXT,
       reviewed_at TIMESTAMP,
       created_at TIMESTAMP DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_dedupe_candidates_status ON dedupe_candidates(status)`,

    `CREATE TABLE IF NOT EXISTS dedupe_merges (
       id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
       primary_id VARCHAR NOT NULL,
       secondary_id VARCHAR NOT NULL,
       merged_by TEXT,
       merged_at TIMESTAMP DEFAULT now(),
       secondary_snapshot JSONB,
       reference_updates JSONB,
       notes TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_dedupe_merges_primary ON dedupe_merges(primary_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dedupe_merges_secondary ON dedupe_merges(secondary_id)`,

    // Weekly client report preferences (per contact)
    `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS weekly_report_enabled BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS weekly_report_last_sent_at TIMESTAMP`,
    `CREATE INDEX IF NOT EXISTS idx_crm_contacts_weekly_report ON crm_contacts(weekly_report_enabled) WHERE weekly_report_enabled = true`,

    // Push notification subscriptions
    `CREATE TABLE IF NOT EXISTS push_subscriptions (id SERIAL PRIMARY KEY, user_id VARCHAR NOT NULL, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TIMESTAMP DEFAULT now())`,

    // Team calendar events
    `CREATE TABLE IF NOT EXISTS team_events (id SERIAL PRIMARY KEY, title TEXT NOT NULL, event_type TEXT, start_time TIMESTAMP NOT NULL, end_time TIMESTAMP, property_id VARCHAR, property_name TEXT, deal_id VARCHAR, company_name TEXT, location TEXT, attendees TEXT[] DEFAULT '{}', notes TEXT, created_by VARCHAR, created_at TIMESTAMP DEFAULT now())`,

    // Remove dead/blocked RSS sources from news_sources table
    `DELETE FROM news_sources WHERE name IN ('React News','EG / CoStar','Property Reporter','Estates Gazette','Bisnow London','Planning Resource','The Caterer')`,

    // Address resolution fields on pathway runs
    `ALTER TABLE property_pathway_runs ADD COLUMN IF NOT EXISTS uprn TEXT`,
    `ALTER TABLE property_pathway_runs ADD COLUMN IF NOT EXISTS formatted_address TEXT`,
    `ALTER TABLE property_pathway_runs ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`,
    `ALTER TABLE property_pathway_runs ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`,

    // Dedupe CRM link tables, then enforce uniqueness so duplicates can't return.
    // Each dedupe must run before its index creation, which fails while duplicates exist.
    `DELETE FROM crm_company_properties a USING crm_company_properties b
      WHERE a.company_id = b.company_id AND a.property_id = b.property_id AND a.id > b.id`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_company_properties_pair ON crm_company_properties(company_id, property_id)`,
    `DELETE FROM crm_company_deals a USING crm_company_deals b
      WHERE a.company_id = b.company_id AND a.deal_id = b.deal_id AND a.id > b.id`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_company_deals_pair ON crm_company_deals(company_id, deal_id)`,
    `DELETE FROM crm_contact_deals a USING crm_contact_deals b
      WHERE a.contact_id = b.contact_id AND a.deal_id = b.deal_id AND a.id > b.id`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contact_deals_pair ON crm_contact_deals(contact_id, deal_id)`,
    `DELETE FROM crm_contact_properties a USING crm_contact_properties b
      WHERE a.contact_id = b.contact_id AND a.property_id = b.property_id AND a.id > b.id`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contact_properties_pair ON crm_contact_properties(contact_id, property_id)`,
    `DELETE FROM crm_contact_requirements a USING crm_contact_requirements b
      WHERE a.contact_id = b.contact_id AND a.requirement_id = b.requirement_id AND a.id > b.id`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contact_requirements_pair ON crm_contact_requirements(contact_id, requirement_id)`,
    // crm_trading_entities — formal legal/billing entities under a brand.
    // The parent brand is what the team picks; the entity is what we KYC
    // and what's on the lease. Previously stored as a {name, added_at}
    // jsonb on crm_companies — graduated to its own table so we can
    // store CH numbers per entity and key AML off the right party.
    `CREATE TABLE IF NOT EXISTS crm_trading_entities (
      id                       VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_company_id        VARCHAR NOT NULL,
      name                     TEXT NOT NULL,
      companies_house_number   TEXT,
      vat_number               TEXT,
      is_default               BOOLEAN NOT NULL DEFAULT false,
      notes                    TEXT,
      kyc_status               TEXT,
      kyc_expires_at           TIMESTAMP,
      kyc_approved_at          TIMESTAMP,
      kyc_approved_by          TEXT,
      aml_risk_level           TEXT,
      sanctions_screen         JSONB,
      last_checked_at          TIMESTAMP,
      created_at               TIMESTAMP DEFAULT NOW(),
      updated_at               TIMESTAMP DEFAULT NOW()
    )`,
    // Late additions for existing deploys (CREATE TABLE IF NOT EXISTS
    // skipped them on first run before the KYC fields were added).
    `ALTER TABLE crm_trading_entities ADD COLUMN IF NOT EXISTS kyc_status TEXT`,
    `ALTER TABLE crm_trading_entities ADD COLUMN IF NOT EXISTS kyc_expires_at TIMESTAMP`,
    `ALTER TABLE crm_trading_entities ADD COLUMN IF NOT EXISTS kyc_approved_at TIMESTAMP`,
    `ALTER TABLE crm_trading_entities ADD COLUMN IF NOT EXISTS kyc_approved_by TEXT`,
    `ALTER TABLE crm_trading_entities ADD COLUMN IF NOT EXISTS aml_risk_level TEXT`,
    `ALTER TABLE crm_trading_entities ADD COLUMN IF NOT EXISTS sanctions_screen JSONB`,
    `ALTER TABLE crm_trading_entities ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP`,
    `CREATE INDEX IF NOT EXISTS crm_trading_entities_parent_idx ON crm_trading_entities (parent_company_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS crm_trading_entities_parent_name_uniq
       ON crm_trading_entities (parent_company_id, LOWER(name))`,
    // Backfill from the legacy jsonb array. Each tradingEntities element
    // becomes a row. uk_entity_name (the canonical entity field) becomes
    // the default row when set. Safe to re-run — UNIQUE on (parent, name)
    // makes inserts no-op on conflict.
    `INSERT INTO crm_trading_entities (parent_company_id, name, is_default)
     SELECT c.id, c.uk_entity_name, true
       FROM crm_companies c
      WHERE c.uk_entity_name IS NOT NULL AND length(trim(c.uk_entity_name)) > 0
     ON CONFLICT (parent_company_id, LOWER(name)) DO NOTHING`,
    `INSERT INTO crm_trading_entities (parent_company_id, name, is_default)
     SELECT c.id, te.value->>'name', false
       FROM crm_companies c
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.trading_entities, '[]'::jsonb)) te
      WHERE te.value->>'name' IS NOT NULL AND length(trim(te.value->>'name')) > 0
     ON CONFLICT (parent_company_id, LOWER(name)) DO NOTHING`,

    // Per-counterparty Xero contact links. ID holds a Xero ContactID
    // GUID (the actual legal/billing entity for that role); name cached
    // locally so the picker renders without a Xero round-trip. Nullable
    // for back-compat — AML falls back to the parent brand when null.
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS landlord_entity_id    VARCHAR`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS landlord_entity_name  TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS tenant_entity_id      VARCHAR`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS tenant_entity_name    TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS vendor_entity_id      VARCHAR`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS vendor_entity_name    TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS purchaser_entity_id   VARCHAR`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS purchaser_entity_name TEXT`,

    // deal_fee_allocations.is_bgp_house — explicit boolean for the BGP
    // House (firm overhead/tax) slice. Sage import used to tag this via
    // " (BGP House)" suffix on the agent name; we keep that for back-compat
    // but the boolean is the canonical signal going forward.
    `ALTER TABLE deal_fee_allocations ADD COLUMN IF NOT EXISTS is_bgp_house BOOLEAN NOT NULL DEFAULT false`,
    // Backfill: anything tagged with the legacy suffix is BGP House.
    `UPDATE deal_fee_allocations SET is_bgp_house = true WHERE is_bgp_house = false AND agent_name ILIKE '%(BGP House)%'`,

    // Scheduled jobs — ChatBGP can author rows via sql_write; the worker
    // in server/scheduled-jobs.ts polls every minute. Migration 0013 is
    // the canonical version; mirrored here so a DB that lost track of
    // that migration (or never ran it) still gets the table on boot
    // rather than logging "relation scheduled_jobs does not exist"
    // every 60 seconds. Idempotent — IF NOT EXISTS throughout.
    `CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name            TEXT NOT NULL,
      description     TEXT,
      schedule_kind   TEXT NOT NULL,
      schedule_value  TEXT NOT NULL,
      action_kind     TEXT NOT NULL,
      action_payload  JSONB NOT NULL,
      enabled         BOOLEAN NOT NULL DEFAULT true,
      created_by      VARCHAR,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      next_run_at     TIMESTAMPTZ NOT NULL,
      last_run_at     TIMESTAMPTZ,
      last_run_status TEXT,
      last_run_output TEXT,
      last_run_ms     INTEGER,
      run_count       INTEGER NOT NULL DEFAULT 0,
      error_count     INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS scheduled_jobs_next_run_idx
       ON scheduled_jobs (next_run_at) WHERE enabled = true`,

    // Tenant Rep status board
    `CREATE TABLE IF NOT EXISTS tenant_rep_searches (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      client_name TEXT NOT NULL,
      company_id VARCHAR,
      contact_id VARCHAR,
      deal_id VARCHAR,
      status TEXT NOT NULL DEFAULT 'Brief Received',
      target_use TEXT[],
      size_min INTEGER,
      size_max INTEGER,
      target_locations TEXT[],
      budget_min INTEGER,
      budget_max INTEGER,
      next_action TEXT,
      next_action_date TEXT,
      notes TEXT,
      assigned_to TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`,
    // Earlier WIP imports stamped every NEG deal (across all teams) into this
    // table with status 'In Progress' — a column the kanban doesn't render,
    // so the board read "112 active searches" but every column was empty.
    // Drop the rows that don't belong to a Tenant Rep deal, then relabel the
    // genuine ones so they appear in the Brief Received column.
    // crm_deals.team is text[] — array membership check, not string compare.
    `DELETE FROM tenant_rep_searches s
       USING crm_deals d
      WHERE s.deal_id = d.id
        AND (d.team IS NULL OR NOT ('Tenant Rep' = ANY(d.team)))`,
    `UPDATE tenant_rep_searches SET status = 'Brief Received' WHERE status = 'In Progress'`,

    // Document Studio run history — created lazily here because it's not in
    // the Drizzle schema/migrations (storage.ts uses raw SQL for this table).
    `CREATE TABLE IF NOT EXISTS document_runs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      document_type TEXT,
      description TEXT,
      content TEXT NOT NULL DEFAULT '',
      source_files TEXT[],
      canva_design_id TEXT,
      canva_edit_url TEXT,
      canva_view_url TEXT,
      design TEXT,
      status TEXT DEFAULT 'done',
      created_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_document_runs_created ON document_runs(created_at DESC)`,

    // ── Deal status canonicalisation ──
    // Backfill legacy status strings on crm_deals, available_units and
    // investment_tracker into the canonical 10-code set (REP/SPEC/LIVE/AVA/
    // NEG/SOL/EXC/COM/WIT/INV). Original values are preserved in
    // *_legacy columns so the migration is reversible. Idempotent — the
    // UPDATE statements no-op once values are canonical.
    `ALTER TABLE crm_deals          ADD COLUMN IF NOT EXISTS status_legacy TEXT`,
    `ALTER TABLE available_units    ADD COLUMN IF NOT EXISTS marketing_status_legacy TEXT`,
    `ALTER TABLE investment_tracker ADD COLUMN IF NOT EXISTS status_legacy TEXT`,
    `UPDATE crm_deals          SET status_legacy = status            WHERE status_legacy IS NULL AND status IS NOT NULL`,
    `UPDATE available_units    SET marketing_status_legacy = marketing_status WHERE marketing_status_legacy IS NULL AND marketing_status IS NOT NULL`,
    `UPDATE investment_tracker SET status_legacy = status            WHERE status_legacy IS NULL AND status IS NOT NULL`,
    `UPDATE crm_deals SET status = CASE
        WHEN UPPER(TRIM(status)) IN ('REP','SPEC','LIVE','AVA','NEG','SOL','EXC','COM','WIT','INV') THEN UPPER(TRIM(status))
        WHEN LOWER(TRIM(status)) IN ('under negotiation','negotiation','hots') THEN 'NEG'
        WHEN LOWER(TRIM(status)) IN ('under offer','sols','solicitors')        THEN 'SOL'
        WHEN LOWER(TRIM(status)) = 'exchanged'                                  THEN 'EXC'
        WHEN LOWER(TRIM(status)) IN ('completed','complete','let')             THEN 'COM'
        WHEN LOWER(TRIM(status)) IN ('invoiced','billed')                      THEN 'INV'
        WHEN LOWER(TRIM(status)) IN ('reporting','targeting')                  THEN 'REP'
        WHEN LOWER(TRIM(status)) = 'speculative'                                THEN 'SPEC'
        WHEN LOWER(TRIM(status)) = 'live'                                       THEN 'LIVE'
        WHEN LOWER(TRIM(status)) IN ('available','marketing')                  THEN 'AVA'
        WHEN LOWER(TRIM(status)) IN ('withdrawn','lost','dead')                THEN 'WIT'
        ELSE status
      END
      WHERE status IS NOT NULL
        AND UPPER(TRIM(status)) NOT IN ('REP','SPEC','LIVE','AVA','NEG','SOL','EXC','COM','WIT','INV')`,
    `UPDATE available_units SET marketing_status = CASE
        WHEN UPPER(TRIM(marketing_status)) IN ('REP','AVA','NEG','SOL','EXC','COM','WIT','INV') THEN UPPER(TRIM(marketing_status))
        WHEN LOWER(TRIM(marketing_status)) IN ('under negotiation','negotiation','hots') THEN 'NEG'
        WHEN LOWER(TRIM(marketing_status)) IN ('under offer','sols','solicitors')        THEN 'SOL'
        WHEN LOWER(TRIM(marketing_status)) = 'exchanged'                                  THEN 'EXC'
        WHEN LOWER(TRIM(marketing_status)) IN ('completed','complete','let')             THEN 'COM'
        WHEN LOWER(TRIM(marketing_status)) IN ('invoiced','billed')                      THEN 'INV'
        WHEN LOWER(TRIM(marketing_status)) IN ('reporting','targeting')                  THEN 'REP'
        WHEN LOWER(TRIM(marketing_status)) IN ('available','marketing')                  THEN 'AVA'
        WHEN LOWER(TRIM(marketing_status)) IN ('withdrawn','lost','dead')                THEN 'WIT'
        ELSE marketing_status
      END
      WHERE marketing_status IS NOT NULL
        AND UPPER(TRIM(marketing_status)) NOT IN ('REP','AVA','NEG','SOL','EXC','COM','WIT','INV')`,
    `UPDATE investment_tracker SET status = CASE
        WHEN UPPER(TRIM(status)) IN ('REP','SPEC','LIVE','AVA','NEG','SOL','EXC','COM','WIT','INV') THEN UPPER(TRIM(status))
        WHEN LOWER(TRIM(status)) IN ('under negotiation','negotiation','hots') THEN 'NEG'
        WHEN LOWER(TRIM(status)) IN ('under offer','sols','solicitors')        THEN 'SOL'
        WHEN LOWER(TRIM(status)) = 'exchanged'                                  THEN 'EXC'
        WHEN LOWER(TRIM(status)) IN ('completed','complete','let')             THEN 'COM'
        WHEN LOWER(TRIM(status)) IN ('invoiced','billed')                      THEN 'INV'
        WHEN LOWER(TRIM(status)) IN ('reporting','targeting')                  THEN 'REP'
        WHEN LOWER(TRIM(status)) = 'speculative'                                THEN 'SPEC'
        WHEN LOWER(TRIM(status)) = 'live'                                       THEN 'LIVE'
        WHEN LOWER(TRIM(status)) IN ('available','marketing')                  THEN 'AVA'
        WHEN LOWER(TRIM(status)) IN ('withdrawn','lost','dead')                THEN 'WIT'
        ELSE status
      END
      WHERE status IS NOT NULL
        AND UPPER(TRIM(status)) NOT IN ('REP','SPEC','LIVE','AVA','NEG','SOL','EXC','COM','WIT','INV')`,

    // ── Deal Ref — sequential human-readable number starting at 1000 ─────────
    // Each crm_deal gets a unique integer ref that never changes and is shown
    // on every board (Letting Tracker, Investment Tracker, WIP Report, Deals).
    `CREATE SEQUENCE IF NOT EXISTS deal_ref_seq START WITH 1000 INCREMENT BY 1`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS deal_ref INTEGER`,
    `UPDATE crm_deals SET deal_ref = NEXTVAL('deal_ref_seq') WHERE deal_ref IS NULL`,
    `ALTER TABLE crm_deals ALTER COLUMN deal_ref SET DEFAULT NEXTVAL('deal_ref_seq')`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_deals_deal_ref ON crm_deals(deal_ref) WHERE deal_ref IS NOT NULL`,

    // ── Investment Tracker — add completion_date ───────────────────────────
    `ALTER TABLE investment_tracker ADD COLUMN IF NOT EXISTS completion_date TEXT`,

    // ── Property Units — master record per physical space ─────────────────
    // The unit (e.g. "Unit 12 at Westfield") is the stable entity. Listings
    // (available_units) and deals (crm_deals) link to it via unit_id.
    `CREATE TABLE IF NOT EXISTS property_units (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id VARCHAR NOT NULL,
      unit_name TEXT NOT NULL,
      floor TEXT,
      sqft REAL,
      use_class TEXT,
      condition TEXT,
      epc_rating TEXT,
      frontage TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_property_units_unique
       ON property_units (property_id, lower(trim(unit_name)))`,
    `ALTER TABLE available_units ADD COLUMN IF NOT EXISTS unit_id VARCHAR`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS unit_id VARCHAR`,
    `CREATE INDEX IF NOT EXISTS idx_available_units_unit_id ON available_units(unit_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crm_deals_unit_id ON crm_deals(unit_id)`,

    // ── Stripe Issuing card programme + expense tracking ──────────────────
    `CREATE TABLE IF NOT EXISTS stripe_cardholders (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL UNIQUE,
      user_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      stripe_cardholder_id TEXT NOT NULL UNIQUE,
      monthly_limit INTEGER NOT NULL DEFAULT 100000,
      daily_limit INTEGER NOT NULL DEFAULT 25000,
      single_tx_limit INTEGER NOT NULL DEFAULT 25000,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS stripe_cards (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      cardholder_id VARCHAR NOT NULL REFERENCES stripe_cardholders(id),
      stripe_card_id TEXT NOT NULL UNIQUE,
      last4 TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS expenses (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      cardholder_id VARCHAR REFERENCES stripe_cardholders(id),
      stripe_transaction_id TEXT UNIQUE,
      type TEXT NOT NULL DEFAULT 'card',
      status TEXT NOT NULL DEFAULT 'pending_receipt',
      merchant TEXT,
      amount_pence INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'gbp',
      transaction_date TIMESTAMP,
      category TEXT,
      xero_account_code TEXT,
      xero_tracking_property TEXT,
      xero_tracking_person TEXT,
      xero_expense_id TEXT,
      receipt_url TEXT,
      receipt_filename TEXT,
      business_purpose TEXT,
      attendees TEXT,
      calendar_event_id TEXT,
      is_personal BOOLEAN DEFAULT FALSE,
      is_client_rechargeable BOOLEAN DEFAULT FALSE,
      related_deal_id VARCHAR,
      mileage_miles REAL,
      notes TEXT,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS expense_receipts (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      expense_id VARCHAR NOT NULL REFERENCES expenses(id),
      storage_key TEXT NOT NULL,
      mime_type TEXT,
      filename TEXT,
      uploaded_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_cardholder ON expenses(cardholder_id)`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status)`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(transaction_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_expense_receipts_expense ON expense_receipts(expense_id)`,

    // ── HR Module ────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS staff_profiles (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL UNIQUE,
      title TEXT,
      start_date TEXT,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      salary_current INTEGER,
      manager_id VARCHAR,
      department TEXT,
      rics_pathway TEXT,
      apc_status TEXT,
      apc_assessment_date TEXT,
      education TEXT,
      bio TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      emergency_contact_relation TEXT,
      holiday_entitlement INTEGER DEFAULT 25,
      pension_opt_in BOOLEAN DEFAULT true,
      pension_rate REAL DEFAULT 5.0,
      contract_sharepoint_url TEXT,
      passport_sharepoint_url TEXT,
      linkedin_url TEXT,
      xero_tracking_name TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS salary_history (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      salary_pence INTEGER NOT NULL,
      effective_date TEXT NOT NULL,
      reason TEXT,
      notes TEXT,
      recorded_by VARCHAR,
      created_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS holiday_requests (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days_count REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      approved_by VARCHAR,
      approved_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS hr_documents (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR,
      doc_type TEXT NOT NULL,
      name TEXT NOT NULL,
      sharepoint_url TEXT,
      sharepoint_drive_id TEXT,
      sharepoint_item_id TEXT,
      review_year INTEGER,
      created_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_staff_profiles_user ON staff_profiles(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_salary_history_user ON salary_history(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_holiday_requests_user ON holiday_requests(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_hr_documents_user ON hr_documents(user_id)`,
    // Mirror manager_id from staff_profiles → users for rows where users
    // hasn't been populated yet (pre-mirror writes). Idempotent — only
    // fills rows where users.manager_id IS NULL so subsequent overrides
    // via the HR edit dialog survive. Downstream expense + holiday
    // approval routing reads users.manager_id; staff_profiles is the
    // legacy single-source.
    `UPDATE users u
        SET manager_id = sp.manager_id
       FROM staff_profiles sp
      WHERE sp.user_id = u.id
        AND sp.manager_id IS NOT NULL
        AND u.manager_id IS NULL`,
    // Commission attribution: deal_fee_allocations historically keyed on
    // agent_name only. The internalAgentIds dual-write on crm_deals means
    // we now have a stable id for each agent — add a parallel column on
    // the allocations table so renames + first-name collisions don't
    // mis-credit commission. Backfill via users.name lookup, nullable
    // for any name that doesn't resolve (typos, "(BGP House)" rows,
    // ex-employees pre-dating the users table).
    `ALTER TABLE deal_fee_allocations ADD COLUMN IF NOT EXISTS agent_user_id VARCHAR`,
    `CREATE INDEX IF NOT EXISTS idx_dfa_agent_user_id ON deal_fee_allocations(agent_user_id) WHERE agent_user_id IS NOT NULL`,
    `UPDATE deal_fee_allocations dfa
        SET agent_user_id = u.id
       FROM users u
      WHERE LOWER(u.name) = LOWER(dfa.agent_name)
        AND dfa.agent_user_id IS NULL
        AND dfa.is_bgp_house = false`,
    // (wip_entries.agent_user_id column-add + backfill removed — Sage
    // imports are no longer the source of truth; nothing reads from
    // wip_entries on the live path. The column may exist in the DB
    // from a prior boot but it's harmless dead data now.)

    // ── Brand profile — ensure crm_companies has all columns the API selects ─
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS bgp_contact_crm TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS bgp_contact_user_ids TEXT[]`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMP`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS brand_analysis TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS brand_analysis_at TIMESTAMP`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS concept_status TEXT`,
    // ── Org chart enhancement (May 2026) ─────────────────────────────────────
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS dob TEXT`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS address TEXT`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS wfh_days TEXT[]`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS employment_type TEXT`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS cv_sharepoint_url TEXT`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS board_member BOOLEAN DEFAULT false`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS management_team BOOLEAN DEFAULT false`,
    // APC grad date tracking — intent-to-submit + actual submission
    // sit alongside the existing apc_submission_deadline (target) and
    // apc_assessment_date (final interview).
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS apc_intent_to_submit_date TEXT`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS apc_submission_date TEXT`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS rics_number TEXT`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS apc_planned_sitting TEXT`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS apc_submission_deadline TEXT`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS apc_counsellor_name TEXT`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS apc_counsellor_email TEXT`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS cv_summary TEXT`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS cv_specialisms TEXT[]`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS cv_notable_clients TEXT[]`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS cv_career_history JSONB`,
    // ── Xero Payroll employee link (Jun 2026) ───────────────────────────────
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS xero_employee_id TEXT`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS xero_employee_name TEXT`,
    `ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS xero_linked_at TIMESTAMP`,
    `CREATE TABLE IF NOT EXISTS cpd_entries (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      entry_date DATE NOT NULL,
      hours REAL NOT NULL,
      kind TEXT NOT NULL DEFAULT 'informal',
      activity TEXT NOT NULL,
      competency TEXT,
      created_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS cpd_entries_user_idx ON cpd_entries(user_id, entry_date DESC)`,
    // PLA (Lease Advisory) instructions — was in migration 0006 but never
    // bootstrapped, so fresh Railway deploys hit "relation pla_matters does
    // not exist". Mirror the migration here so the table self-heals on boot.
    // UI calls these "Instructions"; DB name kept as pla_matters for history.
    `CREATE TABLE IF NOT EXISTS pla_matters (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id varchar NOT NULL,
      matter_type text NOT NULL,
      client_contact_id varchar,
      client_company_id varchar,
      acting_for text,
      lead_user_id varchar NOT NULL,
      team_user_ids text[],
      current_rent numeric,
      current_rent_review_date date,
      break_date date,
      expiry_date date,
      quoting_rent numeric,
      counter_quoting_rent numeric,
      agreed_rent numeric,
      notice_served_at timestamp,
      notice_served_by text,
      counter_notice_deadline timestamp,
      counter_notice_served_at timestamp,
      status text NOT NULL DEFAULT 'open',
      opened_at timestamp DEFAULT now(),
      settled_at timestamp,
      closed_at timestamp,
      sharepoint_folder_url text,
      folder_template_applied boolean DEFAULT false,
      notes text,
      tags text[],
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS pla_matters_property_idx ON pla_matters (property_id)`,
    `CREATE INDEX IF NOT EXISTS pla_matters_lead_idx     ON pla_matters (lead_user_id)`,
    `CREATE INDEX IF NOT EXISTS pla_matters_status_idx   ON pla_matters (status) WHERE status NOT IN ('closed','settled')`,
    `CREATE INDEX IF NOT EXISTS pla_matters_review_idx   ON pla_matters (current_rent_review_date) WHERE current_rent_review_date IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS pla_matter_comps (
      matter_id varchar NOT NULL,
      comp_id varchar NOT NULL,
      weight real DEFAULT 1.0,
      notes text,
      added_by varchar,
      added_at timestamp DEFAULT now(),
      PRIMARY KEY (matter_id, comp_id)
    )`,
    `CREATE INDEX IF NOT EXISTS pla_matter_comps_comp_idx ON pla_matter_comps (comp_id)`,
    `CREATE TABLE IF NOT EXISTS pla_matter_workbooks (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      matter_id varchar NOT NULL,
      kind text NOT NULL,
      sharepoint_url text,
      generated_at timestamp DEFAULT now(),
      generated_by varchar,
      inputs_snapshot jsonb,
      output_summary jsonb
    )`,
    `CREATE INDEX IF NOT EXISTS pla_matter_workbooks_matter_idx ON pla_matter_workbooks (matter_id)`,
    `CREATE TABLE IF NOT EXISTS pla_matter_events (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      matter_id varchar NOT NULL,
      event_kind text NOT NULL,
      event_date timestamp NOT NULL,
      description text,
      done boolean DEFAULT false,
      done_at timestamp,
      created_by varchar,
      created_at timestamp DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS pla_matter_events_matter_idx ON pla_matter_events (matter_id)`,
    `CREATE INDEX IF NOT EXISTS pla_matter_events_upcoming_idx ON pla_matter_events (event_date) WHERE done = false`,
    // Lease Advisory status alignment (May 2026):
    //   • Lease advisory now follows the same lifecycle as Letting Tracker:
    //     instruction = unit, deal CRM follows the same status codes.
    //   • Bespoke statuses (open/in_negotiation/agreed/settled/closed/on_hold)
    //     get remapped to DEAL_STATUS_CODES (REP/NEG/EXC/COM/WIT/REP). Old
    //     value preserved in legacy_status so we can revert if needed.
    //   • New deal_id column links the matter to its auto-created crm_deals row.
    `ALTER TABLE pla_matters ADD COLUMN IF NOT EXISTS legacy_status TEXT`,
    `ALTER TABLE pla_matters ADD COLUMN IF NOT EXISTS deal_id VARCHAR`,
    `UPDATE pla_matters
        SET legacy_status = status,
            status = CASE status
              WHEN 'open'           THEN 'REP'
              WHEN 'in_negotiation' THEN 'NEG'
              WHEN 'agreed'         THEN 'EXC'
              WHEN 'settled'        THEN 'COM'
              WHEN 'closed'         THEN 'WIT'
              WHEN 'on_hold'        THEN 'REP'
              ELSE status
            END
        WHERE status IN ('open','in_negotiation','agreed','settled','closed','on_hold')
          AND legacy_status IS NULL`,
    `CREATE INDEX IF NOT EXISTS pla_matters_deal_idx ON pla_matters (deal_id) WHERE deal_id IS NOT NULL`,
    `ALTER TABLE pla_matters ADD COLUMN IF NOT EXISTS unit_id VARCHAR`,
    `CREATE INDEX IF NOT EXISTS pla_matters_unit_idx ON pla_matters (unit_id) WHERE unit_id IS NOT NULL`,
    // Unit-level address — for sub-units that have their own postal address /
    // rateable value / UPRN distinct from the parent property.
    `ALTER TABLE property_units ADD COLUMN IF NOT EXISTS unit_address TEXT`,
    `ALTER TABLE property_units ADD COLUMN IF NOT EXISTS unit_postcode TEXT`,
    `ALTER TABLE property_units ADD COLUMN IF NOT EXISTS unit_uprn TEXT`,
    `ALTER TABLE property_units ADD COLUMN IF NOT EXISTS unit_address_free_text TEXT`,
    // Entity images — single table that attaches an image to a property, unit
    // or deal. Bytes live in file_blobs (same pattern as profile photos /
    // payslips). Captured from Street View, dropped in from disk, or
    // produced by Image Studio.
    `CREATE TABLE IF NOT EXISTS entity_images (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type TEXT NOT NULL,
      entity_id VARCHAR NOT NULL,
      file_id VARCHAR NOT NULL,
      kind TEXT,
      title TEXT,
      notes TEXT,
      created_by_user_id VARCHAR,
      created_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS entity_images_entity_idx ON entity_images (entity_type, entity_id, created_at DESC)`,
    `ALTER TABLE entity_images ADD COLUMN IF NOT EXISTS image_studio_id VARCHAR`,
    // Brand credit reports — cache for Red Flag (or other third-party credit
    // provider) reports keyed by company. Sidebar covenant card reads the
    // newest row. Empty table until Red Flag is wired.
    `CREATE TABLE IF NOT EXISTS brand_credit_reports (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL,
      provider TEXT NOT NULL DEFAULT 'red_flag',
      score INTEGER,
      band TEXT,
      risk_level TEXT,
      credit_limit_pence BIGINT,
      raw_payload JSONB,
      fetched_at TIMESTAMP DEFAULT now(),
      fetched_by_user_id VARCHAR
    )`,
    `CREATE INDEX IF NOT EXISTS brand_credit_reports_company_idx ON brand_credit_reports (company_id, fetched_at DESC)`,
    // RocketReach company firmographics cache — one row per brand, refreshed on
    // demand from /api/brand/:id/rocketreach-company/refresh. Stores the raw
    // lookupCompany payload as JSON so we can pluck fields without re-deploying
    // when we want to surface a new one.
    `CREATE TABLE IF NOT EXISTS brand_rocketreach_data (
      company_id VARCHAR PRIMARY KEY,
      payload JSONB NOT NULL,
      fetched_at TIMESTAMP DEFAULT now()
    )`,
    // Compliance overrides — captured when someone promotes a deal to SOL
    // without AML / fee agreement being complete. Lets us produce a compliance
    // report and chase the gaps before exchange.
    `CREATE TABLE IF NOT EXISTS deal_compliance_audit (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      deal_id VARCHAR NOT NULL,
      user_id VARCHAR,
      missing_fields TEXT[],
      target_status TEXT,
      override_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS deal_compliance_audit_deal_idx ON deal_compliance_audit (deal_id, override_at DESC)`,
    `CREATE TABLE IF NOT EXISTS bonus_history (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      amount_pence INTEGER NOT NULL,
      effective_date TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'bonus',
      reason TEXT,
      notes TEXT,
      recorded_by VARCHAR,
      created_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS bonus_history_user_idx ON bonus_history(user_id, effective_date DESC)`,
    // Dedupe key for the salary importer — one bonus per (user, date, amount, kind)
    // means re-running the spreadsheet import is idempotent.
    `CREATE UNIQUE INDEX IF NOT EXISTS bonus_history_dedup_idx ON bonus_history(user_id, effective_date, amount_pence, kind)`,
    // AML AI augments + MLR scope determination
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_sof_analysis JSONB`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_ai_triage JSONB`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_market_data JSONB`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS mlr_scope TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS mlr_scope_reason TEXT`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS mlr_scope_assessed_at TIMESTAMP`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS mlr_scope_assessed_by TEXT`,
    // Country risk lookup. Drives the auto-EDD trigger when a UBO chain
    // touches a high-risk jurisdiction. Seeded with the FATF + UK Treasury
    // lists at boot; admin can edit via /api/aml/country-risk.
    `CREATE TABLE IF NOT EXISTS aml_country_risks (
      country_code VARCHAR(2) PRIMARY KEY,
      country_name TEXT NOT NULL,
      risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high')),
      source TEXT,
      notes TEXT,
      updated_at TIMESTAMP DEFAULT now()
    )`,
    // Seed (idempotent — only inserts if missing). Sources: FATF "high-risk
    // jurisdictions subject to a call for action" + UK HMT consolidated list
    // + EU AMLD list, conservative as of May 2026. Admin can override.
    `INSERT INTO aml_country_risks (country_code, country_name, risk_level, source, notes) VALUES
      ('IR', 'Iran', 'high', 'FATF', 'Call for action — FATF black list'),
      ('KP', 'North Korea', 'high', 'FATF', 'Call for action — FATF black list'),
      ('MM', 'Myanmar', 'high', 'FATF', 'FATF grey list'),
      ('AF', 'Afghanistan', 'high', 'UK HMT', 'Sanctions in force'),
      ('BY', 'Belarus', 'high', 'UK HMT', 'Sanctions in force'),
      ('RU', 'Russia', 'high', 'UK HMT', 'Sanctions in force'),
      ('SY', 'Syria', 'high', 'UK HMT', 'Sanctions in force'),
      ('YE', 'Yemen', 'high', 'UK HMT', 'Conflict-related sanctions'),
      ('CU', 'Cuba', 'high', 'UK HMT', 'Sanctions in force'),
      ('VE', 'Venezuela', 'high', 'UK HMT', 'Targeted sanctions'),
      ('LY', 'Libya', 'high', 'UK HMT', 'Sanctions in force'),
      ('SO', 'Somalia', 'high', 'UK HMT', 'Sanctions in force'),
      ('SD', 'Sudan', 'high', 'UK HMT', 'Sanctions in force'),
      ('SS', 'South Sudan', 'high', 'UK HMT', 'Sanctions in force'),
      ('IQ', 'Iraq', 'high', 'UK HMT', 'Sanctions in force'),
      ('LB', 'Lebanon', 'high', 'EU AMLD', 'EU AMLD high-risk third country'),
      ('ML', 'Mali', 'high', 'EU AMLD', 'EU AMLD high-risk third country'),
      ('VU', 'Vanuatu', 'medium', 'FATF', 'FATF grey list'),
      ('PK', 'Pakistan', 'medium', 'FATF', 'FATF grey list'),
      ('BG', 'Bulgaria', 'medium', 'FATF', 'FATF grey list'),
      ('PA', 'Panama', 'medium', 'FATF', 'FATF grey list'),
      ('PH', 'Philippines', 'medium', 'FATF', 'FATF grey list')
    ON CONFLICT (country_code) DO NOTHING`,
    // Tokenised KYC upload portal — tenant/customer self-service.
    `CREATE TABLE IF NOT EXISTS kyc_upload_tokens (
      token VARCHAR(64) PRIMARY KEY,
      deal_id VARCHAR NOT NULL,
      contact_email TEXT,
      contact_name TEXT,
      created_at TIMESTAMP DEFAULT now(),
      created_by VARCHAR,
      expires_at TIMESTAMP NOT NULL,
      revoked_at TIMESTAMP,
      last_used_at TIMESTAMP,
      use_count INTEGER DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_kyc_upload_tokens_deal ON kyc_upload_tokens(deal_id)`,
    `CREATE TABLE IF NOT EXISTS kyc_upload_files (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      token VARCHAR(64) NOT NULL,
      deal_id VARCHAR NOT NULL,
      original_filename TEXT NOT NULL,
      content_type TEXT,
      size_bytes INTEGER,
      sharepoint_url TEXT,
      ai_classification JSONB,
      uploaded_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_kyc_upload_files_deal ON kyc_upload_files(deal_id)`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS aml_mlro_report_url TEXT`,
    // Promote the three other board members to admin alongside Woody +
    // Layla. Idempotent: re-runs are no-ops once is_admin is already true.
    // Match by name with ILIKE so minor spelling variants in the users
    // table still pick up. Wendy signs in as the shared accounts@ mailbox,
    // so match that email too (her row is named "Accounts", not "Wendy").
    `UPDATE users SET is_admin = true WHERE
       LOWER(name) ILIKE 'jack%barratt%'
       OR LOWER(name) ILIKE 'charlotte%roberts%'
       OR LOWER(name) ILIKE 'rupert%bentley%smith%'
       OR LOWER(name) ILIKE 'wendy%'
       OR LOWER(name) ILIKE '%mckenzie%'
       OR LOWER(email) = 'accounts@brucegillinghampollard.com'`,
    // Relabel the accounts@ login from the generic "Accounts" to "Wendy
    // McKenzie" so approvals / audit / toasts read clearly. Only touches the
    // placeholder name so a deliberate rename later isn't clobbered.
    `UPDATE users SET name = 'Wendy McKenzie'
      WHERE LOWER(email) = 'accounts@brucegillinghampollard.com'
        AND (name IS NULL OR name = '' OR name ILIKE 'accounts')`,

    // Ensure Carly Cunliffe (London F&B, reports to Rupert) exists with her
    // contact details. Idempotent: insert only if she isn't already there
    // (by name or email), then set email/phone regardless. Placeholder
    // password — she signs in via Microsoft SSO like the rest of the team.
    `INSERT INTO users (username, password, name, role, team, manager_id, email, phone, is_admin, is_active)
     SELECT 'carly.cunliffe', '$2b$10$CDskRcFnhZbhAhSEUnpjeusJATcpEIxJ4WKBqI11EWF02Y3ixn8fq',
            'Carly Cunliffe', 'Graduate Surveyor – London F&B / Tenant Rep', 'London F&B',
            (SELECT id FROM users WHERE LOWER(name) ILIKE 'rupert%bentley%smith%' LIMIT 1),
            'carly@brucegillinghampollard.com', '+44 7930 552978', false, true
     WHERE NOT EXISTS (
       SELECT 1 FROM users
        WHERE LOWER(name) ILIKE 'carly%cunliffe%'
           OR LOWER(email) = 'carly@brucegillinghampollard.com'
     )`,
    `UPDATE users
        SET email = 'carly@brucegillinghampollard.com', phone = '+44 7930 552978'
      WHERE LOWER(name) ILIKE 'carly%cunliffe%'`,

    // ── Migration 0005 (resolver columns on crm_properties) — defensively
    // re-applied here in case a Railway deploy ever skipped the file-based
    // 0005_property_resolver.sql. Without these the Drizzle select on
    // crmProperties throws "column does not exist" → 500 on /api/crm/properties.
    `ALTER TABLE crm_properties
       ADD COLUMN IF NOT EXISTS uprn text,
       ADD COLUMN IF NOT EXISTS toid text,
       ADD COLUMN IF NOT EXISTS usrn text,
       ADD COLUMN IF NOT EXISTS os_ngd_feature_id text,
       ADD COLUMN IF NOT EXISTS inspire_polygon_id text,
       ADD COLUMN IF NOT EXISTS voa_ba_reference text,
       ADD COLUMN IF NOT EXISTS fhrs_id text,
       ADD COLUMN IF NOT EXISTS ward text,
       ADD COLUMN IF NOT EXISTS lpa text,
       ADD COLUMN IF NOT EXISTS parl_constituency text,
       ADD COLUMN IF NOT EXISTS aliases jsonb,
       ADD COLUMN IF NOT EXISTS resolution_status text,
       ADD COLUMN IF NOT EXISTS resolved_at timestamp,
       ADD COLUMN IF NOT EXISTS resolved_by varchar`,
    `CREATE INDEX IF NOT EXISTS crm_properties_uprn_idx ON crm_properties (uprn) WHERE uprn IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS crm_properties_toid_idx ON crm_properties (toid) WHERE toid IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS crm_properties_voa_idx ON crm_properties (voa_ba_reference) WHERE voa_ba_reference IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS crm_properties_inspire_idx ON crm_properties (inspire_polygon_id) WHERE inspire_polygon_id IS NOT NULL`,

    // ── Migration 0014 (HMLR ownership). pg_trgm enables fast ILIKE on
    // property_address for the postcode + street-number match. The INSPIRE
    // polygon layer + PostGIS are created below too (was previously
    // deferred) — both are PostGIS-guarded: if the extension isn't
    // available on this Postgres the tolerant runner skips them and boot
    // continues; the table just stays empty until the INSPIRE ingest runs.
    `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
    `CREATE TABLE IF NOT EXISTS hmlr_proprietors (
      title_number                       TEXT NOT NULL,
      dataset                            TEXT NOT NULL,
      proprietor_position                INTEGER NOT NULL DEFAULT 1,
      proprietor_name                    TEXT,
      proprietor_category                TEXT,
      company_registration_no            TEXT,
      country_incorporated               TEXT,
      proprietor_address_1               TEXT,
      proprietor_address_2               TEXT,
      proprietor_address_3               TEXT,
      date_proprietor_added              DATE,
      price_paid                         TEXT,
      property_address                   TEXT,
      postcode                           TEXT,
      postcode_normalised                TEXT,
      tenure                             TEXT,
      multiple_address_indicator         TEXT,
      additional_proprietor_indicator    TEXT,
      ingest_run_id                      UUID,
      inserted_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (title_number, dataset, proprietor_position)
    )`,
    `CREATE INDEX IF NOT EXISTS hmlr_proprietors_postcode_idx
       ON hmlr_proprietors (postcode_normalised)
       WHERE postcode_normalised IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS hmlr_proprietors_company_idx
       ON hmlr_proprietors (company_registration_no)
       WHERE company_registration_no IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS hmlr_proprietors_name_idx
       ON hmlr_proprietors (lower(proprietor_name))`,
    `CREATE INDEX IF NOT EXISTS hmlr_proprietors_dataset_idx
       ON hmlr_proprietors (dataset)`,
    `CREATE INDEX IF NOT EXISTS hmlr_proprietors_address_trgm_idx
       ON hmlr_proprietors USING GIN (lower(property_address) gin_trgm_ops)`,
    `CREATE TABLE IF NOT EXISTS hmlr_ingest_runs (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dataset           TEXT NOT NULL,
      source_url        TEXT,
      source_filename   TEXT,
      rows_processed    INTEGER NOT NULL DEFAULT 0,
      rows_inserted     INTEGER NOT NULL DEFAULT 0,
      rows_updated      INTEGER NOT NULL DEFAULT 0,
      rows_skipped      INTEGER NOT NULL DEFAULT 0,
      status            TEXT NOT NULL,
      error             TEXT,
      notes             TEXT,
      started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at       TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS hmlr_ingest_runs_dataset_idx
       ON hmlr_ingest_runs (dataset, started_at DESC)`,

    // INSPIRE Index Polygons (free, no title_number) — boundary shapes for
    // map shading on the property-intelligence map. PostGIS-FREE: this DB
    // has no PostGIS, so geometry is stored as GeoJSON in a jsonb column
    // (WGS84) + a numeric min/max lng/lat bbox for fast viewport queries.
    // Stays empty until the INSPIRE ingest runs (server/hmlr-polygons-fetch.ts
    // via POST /api/admin/hmlr/fetch-polygons-from-sharepoint). See replit.md.
    `CREATE TABLE IF NOT EXISTS hmlr_title_polygons (
      inspire_id        BIGINT PRIMARY KEY,
      title_number      TEXT,
      geojson           JSONB NOT NULL,
      min_lng           DOUBLE PRECISION NOT NULL,
      min_lat           DOUBLE PRECISION NOT NULL,
      max_lng           DOUBLE PRECISION NOT NULL,
      max_lat           DOUBLE PRECISION NOT NULL,
      region            TEXT,
      ingest_run_id     UUID,
      inserted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS hmlr_title_polygons_bbox_lng_idx
       ON hmlr_title_polygons (min_lng, max_lng)`,
    `CREATE INDEX IF NOT EXISTS hmlr_title_polygons_bbox_lat_idx
       ON hmlr_title_polygons (min_lat, max_lat)`,
    `CREATE INDEX IF NOT EXISTS hmlr_title_polygons_title_idx
       ON hmlr_title_polygons (title_number)
       WHERE title_number IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS hmlr_title_polygons_region_idx
       ON hmlr_title_polygons (region)`,

    // ── Shopping centres + tenants ─────────────────────────────────────
    // Hand-curated (or scraped) tenant directory for major UK shopping
    // centres — Cardinal Place, Westfield, Brent Cross, etc. Plugs the
    // gap that VOA + Places + brand_stores can't fill: large multi-unit
    // schemes where the centre is one VOA hereditament but houses many
    // tenants. The retail context renderer reads from these tables as
    // an additional unit source.
    //
    // Populate via ChatBGP sql_write (or a small scraper helper) per
    // centre. Each tenant row has an approximate lat/lng so it can be
    // matched to an OS NGD building polygon.
    `CREATE TABLE IF NOT EXISTS shopping_centres (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name              TEXT NOT NULL,
      short_name        TEXT,                              -- "Cardinal Place"
      website_url       TEXT,
      directory_url     TEXT,                              -- where tenants are listed
      address           TEXT,
      postcode          TEXT,
      lat               DOUBLE PRECISION,
      lng               DOUBLE PRECISION,
      bbox              JSONB,                             -- {south,north,west,east}
      operator          TEXT,                              -- Landsec / Hammerson / Unibail / ...
      notes             TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS shopping_centres_postcode_idx
       ON shopping_centres (UPPER(REPLACE(postcode, ' ', '')))
       WHERE postcode IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS shopping_centres_latlng_idx
       ON shopping_centres (lat, lng)
       WHERE lat IS NOT NULL AND lng IS NOT NULL`,

    `CREATE TABLE IF NOT EXISTS shopping_centre_tenants (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      centre_id         UUID NOT NULL,                     -- → shopping_centres.id
      tenant_name       TEXT NOT NULL,
      unit_label        TEXT,                              -- "Unit A1", "Ground Floor 12"
      category          TEXT,                              -- 'fashion'|'fnb'|'services'|'beauty'|'convenience'|'vacant'|'other'
      lat               DOUBLE PRECISION,
      lng               DOUBLE PRECISION,
      area_sqft         INTEGER,
      use_class         TEXT,
      source_url        TEXT,
      last_verified     DATE,
      notes             TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS shopping_centre_tenants_centre_idx
       ON shopping_centre_tenants (centre_id)`,
    `CREATE INDEX IF NOT EXISTS shopping_centre_tenants_latlng_idx
       ON shopping_centre_tenants (lat, lng)
       WHERE lat IS NOT NULL AND lng IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS shopping_centre_tenants_name_idx
       ON shopping_centre_tenants (lower(tenant_name))`,

    // ── Migration 0015 (document design preferences) — free-text rows
    // injected into Claude-driven document generation as house style.
    `CREATE TABLE IF NOT EXISTS document_design_preferences (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scope           TEXT NOT NULL,
      preference      TEXT NOT NULL,
      category        TEXT,
      enabled         BOOLEAN NOT NULL DEFAULT true,
      added_by        TEXT,
      added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      disabled_at     TIMESTAMPTZ,
      notes           TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS document_design_preferences_scope_active_idx
       ON document_design_preferences (scope) WHERE enabled = true`,
    `CREATE INDEX IF NOT EXISTS document_design_preferences_added_at_idx
       ON document_design_preferences (added_at DESC)`,

    // ── Migration 0023 (news tag vocabulary) — controlled list the AI
    // scorer uses to tag every article. Editable by any logged-in user
    // via the news settings UI. Seeded with Harry's initial wishlist.
    `CREATE TABLE IF NOT EXISTS news_tags (
      id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL UNIQUE,
      label       TEXT NOT NULL,
      active      BOOLEAN DEFAULT true,
      sort_order  INTEGER DEFAULT 0,
      created_by  VARCHAR,
      created_at  TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS news_tags_active_idx ON news_tags (sort_order) WHERE active = true`,
    `INSERT INTO news_tags (name, label, sort_order) VALUES
       ('new openings',      'New openings',      10),
       ('flagships',         'Flagships',         20),
       ('dtc',               'DTC',               30),
       ('brand performance', 'Brand performance', 40),
       ('global retail',     'Global retail',     50),
       ('retail',            'Retail',            60),
       ('fashion',           'Fashion',           70),
       ('high street',       'High street',       80),
       ('wellness',          'Wellness',          90),
       ('new operators',     'New operators',    100)
     ON CONFLICT (name) DO NOTHING`,

    // Instagram Business Discovery cache (24h TTL). Keyed on brand company id
    // so we cache one profile (~25 posts + stats) per brand. Lookups are
    // bypassed with ?force=1 from the brand profile refresh button.
    `CREATE TABLE IF NOT EXISTS brand_instagram_cache (
      brand_company_id VARCHAR PRIMARY KEY,
      username         TEXT NOT NULL,
      profile_data     JSONB NOT NULL,
      fetched_at       TIMESTAMP NOT NULL DEFAULT now()
    )`,

    // brand_stores: country column lets us separate UK from global rows for
    // brand portfolio maps with a UK / Global toggle. Default 'GB' for the
    // existing data since the original research function was UK-only.
    `ALTER TABLE brand_stores ADD COLUMN IF NOT EXISTS country TEXT`,
    `UPDATE brand_stores SET country = 'GB' WHERE country IS NULL`,
    `CREATE INDEX IF NOT EXISTS brand_stores_country_idx ON brand_stores (brand_company_id, country)`,

    // ── Migration 0024 — menu / best-sellers intel (brand panel).
    // Single JSONB blob holds {type, items[], source_url, citations}.
    // Refreshed on demand via Perplexity from the brand profile UI.
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS menu_intel JSONB`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS menu_intel_at TIMESTAMP`,

    // ── Migration 0025 — property_imagery_assets (Pathway Stage 8 +
    // Why Buy memo source images). Mirrors shared/schema.ts; the
    // SQL-file migration (migrations/0007_property_imagery_assets.sql)
    // never gets executed in this deployment because we apply schema
    // via this auto-migrate path, not Drizzle's CLI. Without this
    // table, Stage 9 Claude-design crashes with "relation does not
    // exist" and falls back to the legacy pdfkit renderer.
    `CREATE TABLE IF NOT EXISTS property_imagery_assets (
      id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      property_id     VARCHAR NOT NULL,
      kind            TEXT NOT NULL,
      source          TEXT NOT NULL,
      image_studio_id VARCHAR,
      source_url      TEXT,
      generated_from  JSONB,
      score           REAL,
      width           INTEGER,
      height          INTEGER,
      caption         TEXT,
      pinned          BOOLEAN DEFAULT false,
      hidden          BOOLEAN DEFAULT false,
      generated_at    TIMESTAMP DEFAULT now(),
      generated_by    VARCHAR,
      pathway_run_id  VARCHAR,
      matter_id       VARCHAR
    )`,
    `CREATE INDEX IF NOT EXISTS idx_pia_property_kind
       ON property_imagery_assets (property_id, kind) WHERE hidden = false`,
    `CREATE INDEX IF NOT EXISTS idx_pia_image_studio
       ON property_imagery_assets (image_studio_id) WHERE image_studio_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_pia_pinned
       ON property_imagery_assets (property_id, kind) WHERE pinned = true`,
    `CREATE INDEX IF NOT EXISTS idx_pia_pathway
       ON property_imagery_assets (pathway_run_id) WHERE pathway_run_id IS NOT NULL`,

    // Cached AI-generated market commentary for Brand Explorer categories
    `CREATE TABLE IF NOT EXISTS brand_market_commentary (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      scope_key TEXT NOT NULL UNIQUE,
      scope_label TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      parent_key TEXT,
      parent_label TEXT,
      content JSONB NOT NULL,
      brand_count INTEGER DEFAULT 0,
      news_count INTEGER DEFAULT 0,
      generated_at TIMESTAMP DEFAULT now()
    )`,

    // Decks — generic, app-wide composable document primitive.
    // See shared/schema.ts for the full architectural notes.
    `CREATE TABLE IF NOT EXISTS decks (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      template_key TEXT NOT NULL,
      property_id VARCHAR,
      company_id VARCHAR,
      deal_id VARCHAR,
      status TEXT NOT NULL DEFAULT 'draft',
      notes TEXT,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_decks_property ON decks (property_id) WHERE property_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_decks_company  ON decks (company_id)  WHERE company_id  IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_decks_deal     ON decks (deal_id)     WHERE deal_id     IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_decks_template ON decks (template_key)`,

    `CREATE TABLE IF NOT EXISTS deck_cards (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      deck_id VARCHAR NOT NULL,
      type TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'draft',
      title TEXT,
      content JSONB,
      asset_refs JSONB,
      locked_at TIMESTAMP,
      locked_by VARCHAR,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deck_cards_deck ON deck_cards (deck_id, sort_order)`,

    // Document Studio v2 — one library index for every deliverable (deck / word /
    // pdf / sheet). The artifact file is the working copy (file_storage); the
    // canonical record is mirrored to SharePoint. deck_id links deck-type docs
    // back to deck_cards for card editing.
    `CREATE TABLE IF NOT EXISTS studio_documents (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      category TEXT,
      template_key TEXT,
      deck_id VARCHAR,
      project TEXT,
      property_id VARCHAR,
      company_id VARCHAR,
      deal_id VARCHAR,
      storage_key TEXT,
      file_name TEXT,
      content_type TEXT,
      size INTEGER,
      preview_keys JSONB,
      sharepoint_web_url TEXT,
      sharepoint_item_id TEXT,
      sharepoint_path TEXT,
      status TEXT NOT NULL DEFAULT 'ready',
      version INTEGER NOT NULL DEFAULT 1,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_studio_documents_category ON studio_documents (category)`,
    `CREATE INDEX IF NOT EXISTS idx_studio_documents_project  ON studio_documents (project)`,
    `CREATE INDEX IF NOT EXISTS idx_studio_documents_type     ON studio_documents (doc_type)`,

    `CREATE TABLE IF NOT EXISTS deck_templates (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      default_cards JSONB NOT NULL,
      pdf_scope TEXT NOT NULL DEFAULT 'general',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT now()
    )`,

    // Seed the Why Buy template — first end-to-end deck template.
    // ON CONFLICT DO NOTHING so re-deploys never overwrite local edits.
    `INSERT INTO deck_templates (key, name, description, default_cards, pdf_scope) VALUES (
      'why_buy',
      'Why Buy Memo',
      'Buy-side pitch for a single instruction — opportunity, evidence, returns, asks.',
      '[
        {"type":"cover","title":"Cover","sortOrder":10,"content":{"hero":"","subtitle":""}},
        {"type":"narrative","title":"Executive summary","sortOrder":20,"content":{"markdown":""}},
        {"type":"narrative","title":"The opportunity","sortOrder":30,"content":{"markdown":""}},
        {"type":"image_grid","title":"Property imagery","sortOrder":40,"content":{"imageIds":[]}},
        {"type":"kpi_block","title":"Headline numbers","sortOrder":50,"content":{"kpis":[]}},
        {"type":"data_table","title":"Comparable evidence","sortOrder":60,"content":{"headers":[],"rows":[]}},
        {"type":"map","title":"Location","sortOrder":70,"content":{"propertyId":null}},
        {"type":"risk_register","title":"Risks and mitigants","sortOrder":80,"content":{"items":[]}},
        {"type":"next_steps","title":"Next steps","sortOrder":90,"content":{"items":[]}},
        {"type":"signature_block","title":"BGP team","sortOrder":100,"content":{"team":[],"fee":""}}
      ]'::jsonb,
      'why_buy'
    ) ON CONFLICT (key) DO NOTHING`,

    // Seed the AM/IM template — asset management / investment memo for
    // pitching BGP as delivery partner on an existing instruction.
    `INSERT INTO deck_templates (key, name, description, default_cards, pdf_scope) VALUES (
      'am_im',
      'AM/IM Pitch',
      'Asset management / investment memo — pitch BGP as the delivery partner. Used for AG-style mandate pitches.',
      '[
        {"type":"cover","title":"Cover","sortOrder":10,"content":{"hero":"","subtitle":""}},
        {"type":"narrative","title":"Executive summary","sortOrder":20,"content":{"markdown":""}},
        {"type":"narrative","title":"The value gap","sortOrder":30,"content":{"markdown":""}},
        {"type":"kpi_block","title":"Scenario summary","sortOrder":40,"content":{"kpis":[]}},
        {"type":"model_link","title":"Financial model","sortOrder":50,"content":{"modelRef":"","summary":""}},
        {"type":"data_table","title":"Capex programme","sortOrder":60,"content":{"headers":["Item","Cost","Phase","Status"],"rows":[]}},
        {"type":"data_table","title":"Leasing strategy","sortOrder":70,"content":{"headers":["Unit","Target","Rent","Timeline"],"rows":[]}},
        {"type":"image_grid","title":"Concept imagery","sortOrder":80,"content":{"imageIds":[]}},
        {"type":"map","title":"Location & scheme context","sortOrder":90,"content":{"propertyId":null}},
        {"type":"risk_register","title":"Risks and mitigants","sortOrder":100,"content":{"items":[]}},
        {"type":"signature_block","title":"BGP mandate","sortOrder":110,"content":{"team":[],"fee":""}},
        {"type":"next_steps","title":"Next steps","sortOrder":120,"content":{"items":[]}}
      ]'::jsonb,
      'placemaking'
    ) ON CONFLICT (key) DO NOTHING`,

    // Seed Leasing Pitch + Rent Review + Brand Pack templates so the
    // primitive has the full set Woody outlined. Each can be refined
    // later by editing default_cards.
    `INSERT INTO deck_templates (key, name, description, default_cards, pdf_scope) VALUES (
      'leasing_pitch',
      'Leasing Pitch',
      'Pitch deck for a leasing instruction — property overview, available units, target tenants, comparable evidence.',
      '[
        {"type":"cover","title":"Cover","sortOrder":10,"content":{}},
        {"type":"narrative","title":"The opportunity","sortOrder":20,"content":{"markdown":""}},
        {"type":"image_grid","title":"Property imagery","sortOrder":30,"content":{"imageIds":[]}},
        {"type":"data_table","title":"Available units","sortOrder":40,"content":{"headers":["Unit","Use","Sqft","Rent","Status"],"rows":[]}},
        {"type":"data_table","title":"Target tenants","sortOrder":50,"content":{"headers":["Brand","Sector","Requirement","Status"],"rows":[]}},
        {"type":"data_table","title":"Comparable evidence","sortOrder":60,"content":{"headers":["Address","Tenant","Sqft","Rent psf","Date"],"rows":[]}},
        {"type":"map","title":"Location","sortOrder":70,"content":{}},
        {"type":"signature_block","title":"BGP leasing team","sortOrder":80,"content":{"team":[],"fee":""}},
        {"type":"next_steps","title":"Next steps","sortOrder":90,"content":{"items":[]}}
      ]'::jsonb,
      'pitch'
    ) ON CONFLICT (key) DO NOTHING`,

    `INSERT INTO deck_templates (key, name, description, default_cards, pdf_scope) VALUES (
      'rent_review',
      'Rent Review Pack',
      'Tenant-rep or landlord rent review submission — subject property, comps, analysis, representations.',
      '[
        {"type":"cover","title":"Cover","sortOrder":10,"content":{}},
        {"type":"narrative","title":"Subject property","sortOrder":20,"content":{"markdown":""}},
        {"type":"data_table","title":"Comparable evidence","sortOrder":30,"content":{"headers":["Address","Tenant","Zone A","ITZA","Date"],"rows":[]}},
        {"type":"narrative","title":"Zone A analysis","sortOrder":40,"content":{"markdown":""}},
        {"type":"narrative","title":"Representations","sortOrder":50,"content":{"markdown":""}},
        {"type":"map","title":"Pitch & local context","sortOrder":60,"content":{}},
        {"type":"signature_block","title":"BGP team","sortOrder":70,"content":{"team":[],"fee":""}}
      ]'::jsonb,
      'general'
    ) ON CONFLICT (key) DO NOTHING`,

    `INSERT INTO deck_templates (key, name, description, default_cards, pdf_scope) VALUES (
      'brand_pack',
      'Brand Pack',
      'Brand-side intelligence pack — covenant, store estate, target sites, recent news.',
      '[
        {"type":"cover","title":"Cover","sortOrder":10,"content":{}},
        {"type":"narrative","title":"Brand overview","sortOrder":20,"content":{"markdown":""}},
        {"type":"kpi_block","title":"Headline metrics","sortOrder":30,"content":{"kpis":[]}},
        {"type":"image_grid","title":"Brand imagery","sortOrder":40,"content":{"imageIds":[]}},
        {"type":"data_table","title":"Store estate","sortOrder":50,"content":{"headers":["Location","Sqft","Type","Opened"],"rows":[]}},
        {"type":"narrative","title":"Current requirements","sortOrder":60,"content":{"markdown":""}},
        {"type":"narrative","title":"Recent news","sortOrder":70,"content":{"markdown":""}},
        {"type":"next_steps","title":"Approach","sortOrder":80,"content":{"items":[]}}
      ]'::jsonb,
      'general'
    ) ON CONFLICT (key) DO NOTHING`,

    // Log the Deck primitive itself as a formal change request so it
    // shows up in Settings → Change Requests with a proper paper trail.
    // ON CONFLICT keyed by a fingerprint in the description so re-runs
    // don't duplicate.
    `INSERT INTO app_change_requests (description, requested_by, requested_by_user_id, category, priority, status)
     SELECT $deck_request_marker$ [Deck primitive · app-wide composable document layer]

Generic, app-wide system for any BGP deliverable (Why Buy, AM/IM pitch, leasing brochure, rent review pack, brand pack). Pathway is one populator, not the owner — same shared-primitive pattern as Image Studio.

Architecture:
- decks (id, name, template_key, property_id?, company_id?, deal_id?, status, notes)
- deck_cards (id, deck_id, type, sort_order, state {draft|locked}, title, content jsonb, asset_refs jsonb)
- deck_templates (key, name, default_cards jsonb, pdf_scope) — opinions about card sets, not code branches

Universal card vocabulary: cover, narrative, image, image_grid, map, kpi_block, data_table, model_link, risk_register, next_steps, signature_block. Same set serves every template.

Phase 1 (foundation — this commit): schema + Why Buy template seed + REST CRUD + stub /decks page (read-only).
Phase 1.5: assembler endpoint (pipes locked-card content to generate_claude_designed_pdf with the template''s pdf_scope) + Pathway auto-creates a deck at end of run + ChatBGP create_deck tool.
Phase 2: full card editor UI + AM/IM template + first end-to-end Why Buy.
Phase 3: leasing pitch, rent review, brand pack templates.

Deferred for v2: Excel model live-link (cells editable through the board), review/approval workflow with audit trail, multi-user co-editing. $deck_request_marker$,
       'Claude Code',
       NULL,
       'feature',
       'high',
       'pending'
     WHERE NOT EXISTS (
       SELECT 1 FROM app_change_requests WHERE description LIKE '%[Deck primitive · app-wide composable document layer]%'
     )`,

    // Backfill NULL group_name on crm_properties. 304/425 imported rows
    // came in without a group string, which left the Properties board
    // unable to show them under any tab (the old logic was exact-string
    // match). The board now treats nulls as "Properties" implicitly, but
    // setting the value explicitly keeps the data tidy and makes ad-hoc
    // SQL / exports unambiguous. Idempotent — re-runs are no-ops.
    `UPDATE crm_properties SET group_name = 'Properties' WHERE group_name IS NULL`,

    // London Property News — domain no longer resolves (ENOTFOUND on every
    // fetch), so the feed only produced error noise. Removed from the seed
    // list in news-feeds.ts; this deactivates the existing DB row.
    `UPDATE news_sources SET active = false WHERE url LIKE '%londonpropertynews.co.uk%' AND active = true`,
  ];

  let ok = 0, skipped = 0;
  for (const sql of MIGRATIONS) {
    try {
      await pool.query(sql);
      ok++;
    } catch (e: any) {
      skipped++;
      const head = sql.slice(0, 80).replace(/\s+/g, " ");
      console.warn(`[auto-migrate] skipped (${e.message}): ${head}...`);
    }
  }
  console.log(`[auto-migrate] Schema migration complete — ${ok} applied, ${skipped} skipped`);

  // ── One-off (per Woody, 2026-08): staff headshots. Point profile_pic_url
  // at the committed /headshots/<slug>.jpg assets for the people whose photos
  // Woody supplied. Only fills a photo that's absent or an auto-synced M365
  // data: URL — never clobbers a photo someone deliberately uploaded via the
  // UI (/uploads/…) — so it applies once and doesn't fight manual changes on
  // later boots.
  try {
    const headshots: Array<{ email: string; url: string }> = [
      { email: "woody@brucegillinghampollard.com",     url: "/headshots/woody-bruce.jpg" },
      { email: "charlotte@brucegillinghampollard.com", url: "/headshots/charlotte-roberts.jpg" },
      { email: "emily@brucegillinghampollard.com",     url: "/headshots/emily-dumbell.jpg" },
      { email: "victoria@brucegillinghampollard.com",  url: "/headshots/victoria-broadhead.jpg" },
      { email: "luke@brucegillinghampollard.com",      url: "/headshots/luke-donohoe.jpg" },
      { email: "lucyg@brucegillinghampollard.com",     url: "/headshots/lucy-gardiner.jpg" },
      { email: "emilyc@brucegillinghampollard.com",    url: "/headshots/emily-cann.jpg" },
    ];
    for (const h of headshots) {
      const r = await pool.query(
        `UPDATE users SET profile_pic_url = $1
          WHERE lower(email) = lower($2)
            AND (profile_pic_url IS NULL OR profile_pic_url = '' OR profile_pic_url LIKE 'data:%')`,
        [h.url, h.email],
      );
      if ((r.rowCount ?? 0) > 0) console.log(`[one-off headshots] Set headshot for ${h.email}`);
    }
  } catch (e: any) {
    console.warn("[one-off headshots] failed:", e?.message);
  }

  // ── One-off (per Woody): Ollie Wilkinson and Rob Barnes have left the team.
  // Remove them from the org chart / team roster by setting is_active = false
  // (kept, not deleted, so their historical deal / fee / expense links stay
  // valid). Their direct reports roll up to the leaver's own manager so the
  // chart stays connected. Idempotent — skips anyone already inactive, so it
  // applies exactly once.
  try {
    const departures = [
      { email: "ollie@brucegillinghampollard.com", name: "Ollie Wilkinson" },
      { email: "rob@brucegillinghampollard.com",   name: "Rob Barnes" },
    ];
    for (const d of departures) {
      const { rows } = await pool.query(
        `SELECT id, manager_id, is_active FROM users
          WHERE lower(email) = lower($1) OR lower(name) = lower($2) LIMIT 1`,
        [d.email, d.name],
      );
      const person = rows[0];
      if (!person) { console.warn(`[one-off departures] ${d.name} not found — nothing changed`); continue; }
      if (person.is_active === false) continue; // already removed — idempotent
      // Roll their direct reports up to the leaver's own manager.
      await pool.query(`UPDATE users SET manager_id = $1 WHERE manager_id = $2`, [person.manager_id ?? null, person.id]);
      await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [person.id]);
      console.log(`[one-off departures] Removed ${d.name} from the team (deactivated; direct reports rolled up)`);
    }
  } catch (e: any) {
    console.warn("[one-off departures] failed:", e?.message);
  }

  // ── One-off (per Woody): deals 3437, 3490 & 3226 (Harry) are exempt from
  // the 15% BGP House cut — the whole fee goes to the agent, not 85%. The fee
  // editor hard-locks the house slice on every deal, so this can't be done in
  // the UI; we correct it in the data. Scoped to these deal refs only, so
  // the 15% policy stays enforced everywhere else. Guarded on the BGP House
  // row still existing, so it applies exactly once (no re-scaling drift on
  // later boots). Removes the house slice and scales the remaining agent
  // allocation(s) up to 100% (% rows) / the full fee (fixed rows) so BOTH the
  // WIP split (share-normalised) and commission billing (raw %/amount) credit
  // the agent the whole fee.
  try {
    const { rows: exemptDeals } = await pool.query(
      `SELECT id, name, deal_ref, fee FROM crm_deals WHERE deal_ref = ANY($1::int[])`,
      [[3437, 3490, 3226]],
    );
    for (const d of exemptDeals) {
      const { rows: house } = await pool.query(
        `SELECT 1 FROM deal_fee_allocations WHERE deal_id = $1 AND is_bgp_house = true LIMIT 1`,
        [d.id],
      );
      if (house.length === 0) continue; // already corrected — idempotent
      await pool.query(`DELETE FROM deal_fee_allocations WHERE deal_id = $1 AND is_bgp_house = true`, [d.id]);
      await pool.query(
        `UPDATE deal_fee_allocations a
            SET percentage = ROUND((a.percentage * 100.0 / s.total)::numeric, 4)
           FROM (SELECT SUM(percentage) AS total FROM deal_fee_allocations
                  WHERE deal_id = $1 AND allocation_type = 'percentage' AND is_bgp_house = false) s
          WHERE a.deal_id = $1 AND a.allocation_type = 'percentage' AND a.is_bgp_house = false AND s.total > 0`,
        [d.id],
      );
      await pool.query(
        `UPDATE deal_fee_allocations a
            SET fixed_amount = ROUND((a.fixed_amount * $2 / s.total)::numeric, 2)
           FROM (SELECT SUM(fixed_amount) AS total FROM deal_fee_allocations
                  WHERE deal_id = $1 AND allocation_type = 'fixed' AND is_bgp_house = false) s
          WHERE a.deal_id = $1 AND a.allocation_type = 'fixed' AND a.is_bgp_house = false AND s.total > 0 AND $2 IS NOT NULL`,
        [d.id, d.fee],
      );
      const { rows: after } = await pool.query(
        `SELECT agent_name, allocation_type, percentage, fixed_amount FROM deal_fee_allocations WHERE deal_id = $1`,
        [d.id],
      );
      console.log(
        `[one-off 3437/3490/3226] Removed BGP House cut on deal ${d.deal_ref} "${d.name}" — full fee to agent(s): ` +
        after.map((r: any) => `${r.agent_name}=${r.allocation_type === "fixed" ? "£" + r.fixed_amount : r.percentage + "%"}`).join(", "),
      );
    }
    if (exemptDeals.length === 0) {
      console.warn("[one-off 3437/3490/3226] no deals found with ref 3437, 3490 or 3226 — nothing changed");
    }
  } catch (e: any) {
    console.warn("[one-off 3437/3490/3226] correction failed:", e?.message);
  }

  // ── One-off (per Woody): deal 3511 was saved with NO BGP House 15% slice
  // (the pre-fix loophole let a fixed/blank split through). Add it back: scale
  // the existing agent allocation(s) down to make room, then insert the BGP
  // House row (15% for a percentage split, 15% of the fee for a fixed one).
  // Guarded on the row being absent so it runs exactly once (no drift).
  try {
    const { rows: fixDeals } = await pool.query(
      `SELECT id, name, deal_ref, fee FROM crm_deals WHERE deal_ref = $1`,
      [3511],
    );
    for (const d of fixDeals) {
      const { rows: house } = await pool.query(
        `SELECT 1 FROM deal_fee_allocations WHERE deal_id = $1 AND is_bgp_house = true LIMIT 1`,
        [d.id],
      );
      if (house.length > 0) continue; // already has the 15% — idempotent
      const { rows: existing } = await pool.query(
        `SELECT allocation_type FROM deal_fee_allocations WHERE deal_id = $1 AND is_bgp_house = false LIMIT 1`,
        [d.id],
      );
      const fee = Number(d.fee) || 0;
      if (existing[0]?.allocation_type === "fixed") {
        await pool.query(
          `UPDATE deal_fee_allocations a
              SET fixed_amount = ROUND((a.fixed_amount * ($2 * 0.85) / NULLIF(s.total, 0))::numeric, 2)
             FROM (SELECT SUM(fixed_amount) AS total FROM deal_fee_allocations
                    WHERE deal_id = $1 AND allocation_type = 'fixed' AND is_bgp_house = false) s
            WHERE a.deal_id = $1 AND a.allocation_type = 'fixed' AND a.is_bgp_house = false AND s.total > 0`,
          [d.id, fee],
        );
        await pool.query(
          `INSERT INTO deal_fee_allocations (deal_id, agent_name, allocation_type, fixed_amount, is_bgp_house)
             VALUES ($1, 'BGP House', 'fixed', ROUND(($2 * 0.15)::numeric, 2), true)`,
          [d.id, fee],
        );
      } else {
        await pool.query(
          `UPDATE deal_fee_allocations a
              SET percentage = ROUND((a.percentage * 85.0 / s.total)::numeric, 4)
             FROM (SELECT SUM(percentage) AS total FROM deal_fee_allocations
                    WHERE deal_id = $1 AND allocation_type = 'percentage' AND is_bgp_house = false) s
            WHERE a.deal_id = $1 AND a.allocation_type = 'percentage' AND a.is_bgp_house = false AND s.total > 0`,
          [d.id],
        );
        await pool.query(
          `INSERT INTO deal_fee_allocations (deal_id, agent_name, allocation_type, percentage, is_bgp_house)
             VALUES ($1, 'BGP House', 'percentage', 15, true)`,
          [d.id],
        );
      }
      const { rows: after } = await pool.query(
        `SELECT agent_name, allocation_type, percentage, fixed_amount FROM deal_fee_allocations WHERE deal_id = $1`,
        [d.id],
      );
      console.log(
        `[one-off 3511] Added BGP House 15% to deal ${d.deal_ref} "${d.name}": ` +
        after.map((r: any) => `${r.agent_name}=${r.allocation_type === "fixed" ? "£" + r.fixed_amount : r.percentage + "%"}`).join(", "),
      );
    }
    if (fixDeals.length === 0) {
      console.warn("[one-off 3511] deal 3511 not found — nothing changed");
    }
  } catch (e: any) {
    console.warn("[one-off 3511] correction failed:", e?.message);
  }

  // ── knowledge_base GIN search index — built off the boot path ──────────
  // The build takes longer than the pool's 30s query_timeout, so as a
  // MIGRATIONS entry it failed every boot — and the legacy DROP that ran
  // before it meant each deploy dropped the index and never rebuilt it,
  // leaving knowledge-base search sequential-scanning. Dedicated client,
  // no statement timeout, fire-and-forget so boot isn't held up. The
  // legacy non-IMMUTABLE variant (with ai_tags) is dropped if it's still
  // present; IF NOT EXISTS makes every subsequent boot a no-op.
  (async () => {
    const pgMod = await import("pg");
    const client = new pgMod.default.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === "disable"
        ? false
        : process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    });
    try {
      await client.connect();
      await client.query("SET statement_timeout = 0");
      const def = await client.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'knowledge_base_search_idx'`,
      );
      if (def.rows[0]?.indexdef?.includes("ai_tags")) {
        await client.query(`DROP INDEX knowledge_base_search_idx`);
      }
      await client.query(
        `CREATE INDEX IF NOT EXISTS knowledge_base_search_idx ON knowledge_base USING GIN (to_tsvector('english', coalesce(file_name,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(content,'') || ' ' || coalesce(category,'')))`,
      );
      console.log("[auto-migrate] knowledge_base GIN index ensured");
    } catch (e: any) {
      console.warn("[auto-migrate] knowledge_base GIN index build failed:", e?.message);
    } finally {
      try { await client.end(); } catch {}
    }
  })();

  // ── Clean up WIP-sync-derived team values from deal_type ───────────────
  // Early versions of syncWipToCrmDeals wrote team names ('Leasing', 'Investment',
  // 'Tenant Rep', 'Lease Advisory') into deal_type. NULL them so proper CRM
  // deal types can be set without being overwritten on each re-import.
  try {
    await pool.query(`UPDATE crm_deals SET deal_type = NULL WHERE deal_type IN ('Leasing', 'Investment', 'Tenant Rep', 'Lease Advisory')`);
  } catch (e: any) {
    console.warn('[auto-migrate] deal_type cleanup skipped:', e.message);
  }

  // ── Backfill property_units from existing available_units ──────────────
  // Dedupe by (property_id, lower(trim(unit_name))). Each existing listing
  // gets its unit_id wired; any deal linked to that listing also gets unit_id.
  // Idempotent — only fills NULL unit_ids, only inserts missing master rows.
  try {
    const result = await pool.query(`
      WITH dedup AS (
        SELECT
          property_id,
          lower(trim(unit_name)) AS norm_name,
          MIN(unit_name) AS unit_name,
          MIN(floor) AS floor,
          MAX(sqft) AS sqft,
          MIN(use_class) AS use_class,
          MIN(condition) AS condition,
          MIN(epc_rating) AS epc_rating
        FROM available_units
        WHERE unit_id IS NULL
        GROUP BY property_id, lower(trim(unit_name))
      )
      INSERT INTO property_units (property_id, unit_name, floor, sqft, use_class, condition, epc_rating)
      SELECT property_id, unit_name, floor, sqft, use_class, condition, epc_rating
      FROM dedup
      ON CONFLICT (property_id, lower(trim(unit_name))) DO NOTHING
    `);
    const inserted = result.rowCount ?? 0;

    const linkListings = await pool.query(`
      UPDATE available_units au
      SET unit_id = pu.id
      FROM property_units pu
      WHERE au.unit_id IS NULL
        AND au.property_id = pu.property_id
        AND lower(trim(au.unit_name)) = lower(trim(pu.unit_name))
    `);

    const linkDeals = await pool.query(`
      UPDATE crm_deals d
      SET unit_id = au.unit_id
      FROM available_units au
      WHERE d.unit_id IS NULL
        AND au.deal_id = d.id
        AND au.unit_id IS NOT NULL
    `);

    if (inserted || linkListings.rowCount || linkDeals.rowCount) {
      console.log(`[backfill-units] inserted ${inserted} property_units, linked ${linkListings.rowCount ?? 0} listings, ${linkDeals.rowCount ?? 0} deals`);
    }
  } catch (e: any) {
    console.warn(`[backfill-units] failed: ${e.message}`);
  }

  // ── Seed staff start dates from employment contracts (May 2026) ────────
  // Idempotent — ON CONFLICT only updates start_date, never overwrites other fields.
  // Nick Goodman is a consultant (not employee) so pension_opt_in = false.
  try {
    const staffSeed: Array<{ name: string; startDate: string; title: string | null; consultant?: boolean }> = [
      { name: "Jack Barratt",            startDate: "2012-09-03", title: "Director" },
      { name: "Victoria Broadhead",      startDate: "2013-05-07", title: "Director" },
      { name: "Nick Halley",             startDate: "2014-09-01", title: "Associate Director" },
      { name: "Charlotte Brunt",         startDate: "2014-12-01", title: "Associate Surveyor" },
      { name: "Dominic Tixerant",        startDate: "2016-09-05", title: "Associate Director" },
      { name: "Lucy Cope",               startDate: "2017-09-04", title: "Senior Surveyor" },
      { name: "Layla",                   startDate: "2017-10-16", title: "PA / Office Manager" },
      { name: "Pete Wood",               startDate: "2018-08-20", title: "Director" },
      { name: "Cara Milligan",           startDate: "2019-06-10", title: "Personal Assistant" },
      { name: "Evie North",              startDate: "2019-10-07", title: null },
      { name: "Jamie Orme",              startDate: "2020-06-01", title: "Director" },
      { name: "Harry Cody",              startDate: "2020-09-14", title: "Associate Director" },
      { name: "Alex Todd",               startDate: "2021-09-01", title: null },
      { name: "Lizzie Knights",          startDate: "2022-03-21", title: "Director" },
      { name: "Lucy Gardiner",           startDate: "2022-08-08", title: "Associate Director" },
      { name: "Rob Barnes",              startDate: "2022-09-05", title: "Graduate Surveyor" },
      { name: "William Penfold",         startDate: "2023-05-01", title: null },
      { name: "Oliver Wilkinson",        startDate: "2023-07-03", title: "Associate Director" },
      { name: "Danny Cardosi",           startDate: "2024-01-03", title: "Senior Surveyor" },
      { name: "Harry Elliott",           startDate: "2024-04-24", title: null },
      { name: "Emily Cann",              startDate: "2024-09-09", title: "Graduate Surveyor" },
      { name: "Jonny Palmer",            startDate: "2024-09-09", title: "Graduate Surveyor" },
      { name: "Tom Cater",               startDate: "2025-01-01", title: "Associate Director" },
      { name: "Harriette Walker",        startDate: "2025-05-19", title: "PA" },
      { name: "Paris Fixman",            startDate: "2025-07-21", title: "Graduate Surveyor" },
      { name: "Libby Evans",             startDate: "2025-08-11", title: "Graduate Surveyor" },
      { name: "Tiggy Savage",            startDate: "2025-09-01", title: "Graduate Surveyor" },
      { name: "Luke Donohoe",            startDate: "2025-09-22", title: "Graduate Surveyor" },
      { name: "Kate Martin",             startDate: "2026-04-01", title: null },
      { name: "Carly Cunliffe",          startDate: "2026-05-05", title: "Graduate Surveyor" },
    ];
    let seeded = 0;
    for (const s of staffSeed) {
      const r = await pool.query(
        `INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
         SELECT u.id, $2, $3, 'active', 25, $4, $5
         FROM users u WHERE u.name ILIKE $1 AND u.is_active = true
         LIMIT 1
         ON CONFLICT (user_id) DO UPDATE SET
           start_date = CASE WHEN staff_profiles.start_date IS NULL THEN EXCLUDED.start_date ELSE staff_profiles.start_date END,
           title = CASE WHEN staff_profiles.title IS NULL THEN EXCLUDED.title ELSE staff_profiles.title END,
           updated_at = now()`,
        [`%${s.name}%`, s.startDate, s.title, !s.consultant, s.consultant ? 0.0 : 5.0]
      );
      if (r.rowCount) seeded++;
    }
    console.log(`[seed-staff] ${seeded} staff profiles seeded/updated`);
  } catch (e: any) {
    console.warn(`[seed-staff] failed: ${e.message}`);
  }
})();
import { setupAuth, requireAuth } from "./auth";
import { setupMicrosoftRoutes } from "./microsoft";
import { setupWhatsAppRoutes } from "./whatsapp";
import { setupChatBGPRoutes } from "./chatbgp";
import { setupNewsIntelligenceRoutes } from "./news-intelligence";
import { setupNewsFeedRoutes } from "./news-feeds";
import { setupModelsRoutes } from "./models";
import { setupDocumentTemplateRoutes } from "./document-templates";
import { setupCanvaRoutes } from "./canva";
import { setupXeroRoutes } from "./xero";
import { registerXeroFinancialRoutes } from "./xero-financials";
import { registerApiUsageRoutes } from "./api-usage";
import { setupEvernoteRoutes } from "./evernote";
import { registerLandRegistryRoutes } from "./land-registry";
import { setupBusinessGatewayRoutes } from "./business-gateway";
import { setupCovenantRoutes } from "./covenant-engine";
import { registerPropertyResolverRoutes } from "./property-resolver";
import { registerPlaMattersRoutes } from "./pla-matters";
import { registerPlaValuationRoutes, registerComparablesScheduleRoute } from "./pla-valuation";
import { registerWestminsterRestaurantsRoutes } from "./westminster-restaurants";
import { registerPropertyImageryRoutes } from "./property-imagery";
import { registerDocumentBriefRoutes } from "./document-briefs";
// Simple request queue for AI endpoints
const activeRequests = new Set<string>();
const requestQueue: Array<{ req: Request; res: Response; next: NextFunction }> = [];
const MAX_CONCURRENT_AI_REQUESTS = 3;
import { registerVoaRoutes, startVoaAutoImport } from "./voa";
import { registerLegalDDRoutes } from "./legal-dd";
import { setupSharedMailboxRoutes } from "./shared-mailbox";
import { registerInteractionRoutes } from "./interactions";
import { registerTaskSuggestionRoutes } from "./task-suggestions";
import { setupCrmRoutes, startAutoEnrichment, startAutoTurnoverResearch } from "./crm";
import companiesHouseRouter, { runBatchReKyc } from "./companies-house";
import { registerPropertyPathwayRoutes } from "./property-pathway";
import { registerDemeterRoutes } from "./demeter";
import { registerRetailContextPlanRoutes } from "./retail-context-plan";
import { registerMapLayerRoutes } from "./map-layers";
import sanctionsRouter from "./sanctions-screening";
import kycClouseauRouter, { runMonthlyReScreening } from "./kyc-clouseau";
import amlComplianceRouter from "./aml-compliance";
import veriffRouter from "./veriff";
import kycOrchestratorRouter, { runPeriodicAmlReScreening } from "./kyc-orchestrator";
import perplexityRouter from "./perplexity";
import brandDedupeRouter from "./brand-dedupe";
import brandProfileRouter from "./brand-profile";
import brandEnrichmentRouter, { runNightlyBrandEnrichment } from "./brand-enrichment";
import brandAiTakeRouter from "./brand-ai-take";
import goadTenantResolverRouter from "./goad-tenant-resolver";
import contactsDiscoveryRouter from "./contacts-discovery";
import brandDigestRouter, { runFortnightlyBrandDigest } from "./brand-digest";
import brandTriggersRouter, { runDailyBrandTriggers } from "./brand-triggers";
import brandPerplexityRefreshRouter, { runMonthlyPerplexityRefresh } from "./brand-perplexity-refresh";
import brandScraperRouter, { runDailyBrandScraper } from "./brand-scraper";
import brandSocialScraperRouter, { runWeeklySocialScrape } from "./brand-social-scraper";
import rocketreachContactsRouter, { rocketreachHealth } from "./rocketreach-contacts";
import rocketreachCompanyRouter from "./rocketreach-company";
import apolloCompanyRouter from "./apollo-company";
import brandCompetitorsRouter from "./brand-competitors";
import bulkBrandLogosRouter from "./bulk-brand-logos";
import brandImagesRouter from "./brand-images";
import instagramRouter from "./instagram";
import pipnetRequirementsRouter from "./pipnet-requirements";
import purgeApolloContactsRouter from "./purge-apollo-contacts";
import { experianHealth, fetchCommercialCredit, isExperianConfigured, debugExperianRaw, sandboxAudit } from "./experian";
import propertyGapAnalysisRouter from "./property-gap-analysis";
import brandPackRouter from "./brand-pack";
import dealDocsRouter from "./deal-docs";
import weeklyReportRouter, { runWeeklyClientReports } from "./weekly-report";
import dealReportRouter from "./deal-report";
import dealStagesRouter from "./deal-stages";
import leasingPitchRouter from "./leasing-pitch";
import cadRouter from "./cad";
import propertyPlansRouter from "./property-plans";
import propertyAssetBriefRouter from "./property-asset-brief";
import { registerPropertyBrochureRoutes } from "./property-brochures";
import leasingScheduleRouter from "./leasing-schedule";
import tenancyScheduleRouter from "./tenancy-schedule";
import clientTeamsRouter from "./client-teams";
import clientSharepointRouter from "./client-sharepoint";
import activitySummaryRouter from "./activity-summary";
import expansionIntelRouter from "./expansion-intel";
import turnoverRouter from "./turnover";
import { serveStatic } from "./static";
import { registerEmailProcessorRoutes, startEmailProcessor } from "./email-processor";
import { registerHealthCheckRoutes, startHealthCheck } from "./health-check";
import { setupArchivistRoutes, runArchivistCrawl } from "./archivist";
import { registerAIIntelligenceRoutes } from "./ai-intelligence";
import { setupLeadsRoutes } from "./leads";
import { registerMcpRoutes } from "./mcp-server";
import { setupWebSocket } from "./websocket";
import { createServer } from "http";

const app = express();
// Railway terminates TLS at its edge proxy and forwards with X-Forwarded-For.
// Without this, req.ip is the edge proxy's address for every user, so the
// rate limiters below share ONE bucket across the whole userbase — ordinary
// afternoon browsing 429'd the brand-profile auto-triggers (contacts / KYC /
// store research never fired) and the login limiter could lock the entire
// office out at 20 attempts per 15 min.
app.set("trust proxy", 1);
const httpServer = createServer(app);

// Railway health check — unauthenticated, before all middleware
app.get("/api/ping", (_req, res) => res.json({ status: "ok" }));

// Privacy policy — public, unauthenticated. Required by Meta for app
// publishing (WhatsApp Business API webhook).
app.get("/privacy", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy Policy — Bruce Gillingham Pollard</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#222;line-height:1.55}
  h1{font-size:1.8rem;margin-bottom:0.2rem}
  h2{font-size:1.2rem;margin-top:2rem;border-bottom:1px solid #eee;padding-bottom:6px}
  .meta{color:#888;font-size:0.9rem;margin-bottom:2rem}
  ul{padding-left:1.2rem}
  a{color:#0a58ca}
  footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #eee;color:#888;font-size:0.85rem}
</style>
</head>
<body>
<h1>Privacy Policy</h1>
<p class="meta">Bruce Gillingham Pollard LLP &middot; Last updated: 3 May 2026</p>

<p>This Privacy Policy describes how Bruce Gillingham Pollard LLP ("BGP", "we", "us", "our") collects, uses and shares information when you interact with the BGP property dashboard ("the Service"), including via our WhatsApp Business channel.</p>

<h2>1. Who we are</h2>
<p>Bruce Gillingham Pollard LLP is a Central London commercial property consultancy. The Service is an internal property management platform used by BGP staff and authorised contacts. For data protection enquiries, contact us at <a href="mailto:info@brucegillinghampollard.com">info@brucegillinghampollard.com</a>.</p>

<h2>2. Information we collect</h2>
<ul>
  <li><strong>Account information</strong> &mdash; name, email, role, team membership of authorised users.</li>
  <li><strong>CRM data</strong> &mdash; contact, company, deal, property and requirement records you create or that we receive in the course of business.</li>
  <li><strong>Communications</strong> &mdash; emails, WhatsApp messages, and chat threads sent to or from BGP through the Service. WhatsApp messages are received via the Meta WhatsApp Business API.</li>
  <li><strong>Usage data</strong> &mdash; logs of features used, timestamps, IP address, and device/browser metadata for security and audit purposes.</li>
</ul>

<h2>3. How we use your information</h2>
<ul>
  <li>To provide the Service and respond to enquiries on WhatsApp, email and other channels.</li>
  <li>To maintain client and prospect records as part of our property advisory business.</li>
  <li>To improve our internal tools, including AI-assisted features, diagnostics and audit logs.</li>
  <li>To comply with legal, regulatory and contractual obligations.</li>
</ul>

<h2>4. WhatsApp Business API</h2>
<p>When you message our WhatsApp Business number, the message and its metadata (sender phone number, profile name visible to WhatsApp, timestamps) are delivered to us via Meta's WhatsApp Business API and stored securely in our system. Replies sent from our number are also stored. We use this data only to respond to you and to maintain a record of our communications. We do not sell or share WhatsApp message content with third parties for advertising purposes.</p>

<h2>5. Lawful basis</h2>
<p>We process personal data on the basis of legitimate interests (managing client relationships and conducting our property advisory business), contract (where you instruct us), consent (where required), and legal obligation (where applicable).</p>

<h2>6. Sharing</h2>
<p>We share information only with:</p>
<ul>
  <li>Service providers who help us run the Service (cloud hosting, AI providers, email and messaging providers, identity verification providers) under appropriate data-protection terms.</li>
  <li>Professional advisers and regulators where legally required.</li>
  <li>Counterparties in property transactions to the extent necessary to progress an instruction (e.g. solicitors, surveyors).</li>
</ul>

<h2>7. Retention</h2>
<p>We retain personal data for as long as necessary to provide the Service and meet our legal and business obligations. Communications and CRM records are typically retained for the duration of the client relationship plus seven years.</p>

<h2>8. Your rights</h2>
<p>Subject to applicable law (including UK GDPR), you have the right to access, correct, delete or restrict processing of your personal data, to object to processing, and to data portability. To exercise any of these rights, email <a href="mailto:info@brucegillinghampollard.com">info@brucegillinghampollard.com</a>. You also have the right to lodge a complaint with the UK Information Commissioner's Office (<a href="https://ico.org.uk">ico.org.uk</a>).</p>

<h2>9. Security</h2>
<p>We use industry-standard technical and organisational measures, including TLS in transit, access controls, and encrypted storage, to protect personal data. No system is perfectly secure; please use a strong password and tell us immediately if you suspect any unauthorised access.</p>

<h2>10. International transfers</h2>
<p>Our service providers may process data outside the United Kingdom and the European Economic Area. Where this happens, we rely on appropriate safeguards (such as Standard Contractual Clauses) as required by law.</p>

<h2>11. Cookies</h2>
<p>The Service uses session cookies strictly necessary to keep you signed in. We do not use advertising or third-party tracking cookies.</p>

<h2>12. Changes to this policy</h2>
<p>We may update this policy from time to time. The "Last updated" date at the top of this page indicates when it was last revised.</p>

<h2>13. Contact</h2>
<p>Bruce Gillingham Pollard LLP<br>
24 Lowndes Street, London SW1X 9HY, United Kingdom<br>
<a href="mailto:info@brucegillinghampollard.com">info@brucegillinghampollard.com</a></p>

<footer>&copy; ${new Date().getFullYear()} Bruce Gillingham Pollard LLP. All rights reserved.</footer>
</body>
</html>`);
});

// Square BGP mark for Meta App icon upload (and other 1024x1024 needs).
// Renders via the canvas module so font rendering works on Railway's Linux
// container (sharp's SVG text rendering depends on system fonts that aren't
// installed in the production image).
app.get("/bgp-mark.png", async (_req, res) => {
  try {
    const { createCanvas } = await import("canvas");
    const SIZE = 1024;
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#2E5E3F";
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 480px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("BGP", SIZE / 2, SIZE / 2 + 40);

    const png = canvas.toBuffer("image/png");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Content-Disposition", "inline; filename=\"BGP-mark-1024.png\"");
    res.send(png);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to render mark", message: err?.message });
  }
});

/**
 * ScraperAPI status check — confirms the key is set + valid, reports the
 * remaining credit balance and plan, and runs a single test fetch through
 * the proxy to verify end-to-end. Auth-light (require any session) so it
 * can be hit from the browser quickly. Three pieces:
 *   1) ENV: is SCRAPERAPI_KEY set
 *   2) Account: hit api.scraperapi.com/account → plan + credits
 *   3) Test fetch: pull a known-good Westminster IDOX docs page through
 *      the proxy and check we get HTML back (not a block / 503)
 */
app.get("/api/scraperapi/ping", requireAuth, async (_req, res) => {
  const key = process.env.SCRAPERAPI_KEY;
  const out: any = { keySet: !!key, keyLength: key?.length || 0 };
  if (!key) {
    out.error = "SCRAPERAPI_KEY env var is not set on this deployment.";
    return res.status(503).json(out);
  }
  // 1) Account info — credit balance, plan name, request count
  try {
    const accRes = await fetch(`https://api.scraperapi.com/account?api_key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (accRes.ok) {
      const account = await accRes.json() as any;
      out.account = {
        plan: account.subscriptionPlan || account.plan || "unknown",
        creditsLeft: account.requestLimit != null && account.requestCount != null
          ? account.requestLimit - account.requestCount
          : null,
        requestLimit: account.requestLimit ?? null,
        requestCount: account.requestCount ?? null,
        concurrencyLimit: account.concurrencyLimit ?? null,
        failedRequestCount: account.failedRequestCount ?? null,
      };
    } else {
      out.account = { error: `Account endpoint returned ${accRes.status}`, body: (await accRes.text().catch(() => "")).slice(0, 200) };
    }
  } catch (err: any) {
    out.account = { error: err?.message || "fetch threw" };
  }

  // 2) Test fetch — known Westminster docs-tab URL (a real planning app on
  // 18-22 Haymarket). If this comes back as HTML > 1KB the proxy is
  // working end-to-end.
  const testUrl = "https://idoxpa.westminster.gov.uk/online-applications/applicationDetails.do?activeTab=documents&keyVal=PEH1KFRPIVX00";
  try {
    const t0 = Date.now();
    // Business plan includes UK geotargeting — request UK IPs so the
    // residential rotation matches the origin's expected traffic profile
    // (slightly faster + fewer soft-throttles on UK gov sites).
    const tRes = await fetch(
      `https://api.scraperapi.com/?api_key=${encodeURIComponent(key)}&url=${encodeURIComponent(testUrl)}&country_code=uk&render=false`,
      { signal: AbortSignal.timeout(25000) }
    );
    const elapsed = Date.now() - t0;
    if (tRes.ok) {
      const body = await tRes.text();
      out.testFetch = {
        ok: true,
        status: tRes.status,
        elapsedMs: elapsed,
        bodyBytes: body.length,
        looksLikeIdoxPage: /applicationDocumentsTable|Documents tab|application reference/i.test(body),
        firstLine: body.slice(0, 200).replace(/\s+/g, " ").trim(),
      };
    } else {
      out.testFetch = {
        ok: false,
        status: tRes.status,
        elapsedMs: elapsed,
        body: (await tRes.text().catch(() => "")).slice(0, 300),
      };
    }
  } catch (err: any) {
    out.testFetch = { ok: false, error: err?.message || "fetch threw" };
  }

  res.json(out);
});

const MAINTENANCE_MODE = false;
const MAINTENANCE_ALLOWED_EMAILS = new Set([
  "woody@brucegillinghampollard.com",
]);

app.use(async (req: any, res, next) => {
  if (!MAINTENANCE_MODE) return next();
  // Always allow auth routes so login still works
  if (req.path.startsWith("/api/auth") || req.path.startsWith("/api/branding")) return next();
  // Allow static assets (JS/CSS/images) so the login page renders on mobile
  if (req.path.match(/\.(js|css|png|jpg|svg|ico|woff|woff2|ttf|webp|map)$/)) return next();

  // Check if this user's session email is in the allowed list
  const userId = req.session?.userId;
  if (userId) {
    try {
      const row = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
      const email = row.rows[0]?.email?.toLowerCase().trim();
      if (email && MAINTENANCE_ALLOWED_EMAILS.has(email)) return next();
    } catch {}
  }

  // Block API calls with JSON
  if (req.path.startsWith("/api/")) {
    return res.status(503).json({ error: "maintenance", message: "Dashboard is temporarily down for maintenance." });
  }

  // Block everyone else with the maintenance page (works on mobile too)
  res.status(503).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BGP Dashboard — Maintenance</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1a1a2e;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}.container{max-width:480px;padding:40px}h1{font-size:28px;margin-bottom:12px;color:#c9a96e}p{font-size:16px;line-height:1.6;color:#aab;margin-bottom:8px}.logo{font-size:14px;letter-spacing:3px;color:#888;margin-bottom:32px}</style></head><body><div class="container"><div class="logo">BRUCE GILLINGHAM POLLARD</div><h1>Scheduled Maintenance</h1><p>We're making some improvements. The dashboard will be back shortly.</p><p style="margin-top:24px;font-size:13px;color:#667">If you need urgent assistance, please contact the team directly.</p></div></body></html>`);
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
});
app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/microsoft", loginLimiter);
app.use("/api/auth/register", loginLimiter);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  // 200 predates the 30s live-refresh polling (queryClient defaults) — a
  // busy page now legitimately re-fires its whole query set twice a minute,
  // so 200 self-429'd ordinary browsing and knocked users back to sign-in.
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  // The whole office sits behind one NAT'd public IP, so per-IP buckets
  // still pool every staff member together — a brand profile open fires
  // ~30 calls, and five people browsing at once starved the auto-triggers.
  // Key authenticated traffic by its bearer token instead; anonymous
  // traffic falls back to the (IPv6-safe) IP key.
  keyGenerator: (req) =>
    req.headers.authorization || ipKeyGenerator(req.ip || ""),
  skip: (req) => {
    // Dev/QA runs everything from one IP (two harness personas + HMR), so the
    // per-IP bucket trips on ordinary page loads. The limiter is a prod
    // protection; skip it entirely outside production.
    if (process.env.NODE_ENV !== "production") return true;
    const p = req.originalUrl || req.path;
    return (
      p.startsWith("/api/chat") ||
      p.startsWith("/api/ai/") ||
      p.startsWith("/api/chatbgp") ||
      // Brand logo thumbnails fire ~200 per Brand Explorer page load.
      // Already cached by the browser for 24h on 404, and the rendered
      // page is unusable if we 429 them.
      p.startsWith("/api/brand-logo") ||
      // Image-studio thumb/full + entity images + HR photos + property
      // brochure files: all browser-cached static-ish image / pdf reads
      // that legitimately fire dozens-hundreds in parallel on a page
      // load. Rate-limiting them just blanks the gallery on first paint
      // and there's no abuse vector worth defending against.
      p.startsWith("/api/image-studio") ||
      p.startsWith("/api/entity-images") ||
      p.startsWith("/api/hr/photo") ||
      /^\/api\/properties\/[^/]+\/brochures\/[^/]+\/file/.test(p) ||
      /^\/api\/properties\/[^/]+\/plans\/[^/]+\/file/.test(p)
    );
  },
  message: { message: "Too many requests. Please slow down and try again." },
});
app.use("/api/", apiLimiter);

function trackAndProcessRequest(requestId: string, res: import("express").Response, next: import("express").NextFunction) {
  activeRequests.add(requestId);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    activeRequests.delete(requestId);
    while (requestQueue.length > 0) {
      const queued = requestQueue.shift();
      if (queued && !queued.res.headersSent && !queued.res.destroyed && !queued.res.writableEnded) {
        const nextId = `queued-${Date.now()}-${Math.random()}`;
        setImmediate(() => trackAndProcessRequest(nextId, queued.res, queued.next));
        return;
      }
    }
  };
  res.on('finish', cleanup);
  res.on('close', cleanup);
  next();
}

app.use((req, res, next) => {
  const isAiRoute = req.path.startsWith('/api/chatbgp/chat') ||
    req.path.startsWith('/api/ai/') ||
    req.path.includes('/visual-auto-design') ||
    req.path.includes('/visual-design-chat') ||
    req.path.startsWith('/api/models/');
  if (!isAiRoute) {
    return next();
  }
  if (activeRequests.size < MAX_CONCURRENT_AI_REQUESTS) {
    const requestId = `${req.ip}-${Date.now()}-${Math.random()}`;
    return trackAndProcessRequest(requestId, res, next);
  }
  if (requestQueue.length >= 10) {
    return res.status(503).json({ error: 'Server too busy', message: 'Too many requests. Please try again in a few moments.' });
  }
  requestQueue.push({ req, res, next });
});

app.use((req, res, next) => {
  let timeoutMs = 45000;
  if (req.path.includes('/doc-templates/upload')) {
    timeoutMs = 240000;
  } else if (req.path.includes('/chatbgp/chat')) {
    timeoutMs = 300000;
  } else if (req.path.startsWith('/api/chat') || req.path.startsWith('/api/ai/') || req.path.includes('/visual-auto-design') || req.path.includes('/visual-design-chat') || req.path.startsWith('/api/models/') || req.path.includes('/kyc-clouseau/investigate')) {
    timeoutMs = 120000;
  } else if (req.path.includes('/import-excel') || req.path.includes('/import-multi') || req.path.includes('/leasing-schedule/import') || req.path.includes('/resolve-tenants') || req.path.includes('/promote-orphans-to-tenancy')) {
    // Excel imports of 200+ row schedules and the spine backfill /
    // promote sweeps both run many UPDATEs in series — the default
    // 45s timeout cuts them off mid-pass, leaving partial state.
    timeoutMs = 180000;
  } else if (req.path === '/api/interactions/sync' || req.path === '/api/interactions/discover-contacts') {
    // Sync iterates ~18 BGP staff mailboxes × email + calendar via
    // paginated Graph API calls. Routinely 45s+. Don't 504 it mid-pass
    // and leave half the users unsynced.
    timeoutMs = 180000;
  } else if (req.path.includes('/image-studio/upload') || req.path.includes('/image-studio/capture-pdf')) {
    // A batch of iPhone HEICs is decoded via pure-JS (WASM) libheif and
    // resized with sharp — ~3s/photo, so 20 of them blows past 45s. PDFs
    // are rasterised page-by-page. Give both room to finish.
    timeoutMs = 180000;
  } else if (req.path.includes('/image-studio/ai-edit') || req.path.includes('/image-studio/ai-generate') || req.path.includes('/image-studio/capture-and-enhance')) {
    // Gemini image edit/generate runs to its own 90s abort (editWithGemini),
    // so the route has to outlast it — the 45s default was 504ing mid-edit and
    // leaving an ERR_HTTP_HEADERS_SENT crash when the late response landed.
    // (We also drop 4K on edits to keep them quick; this is the safety margin.)
    timeoutMs = 120000;
  }
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timeout', message: 'The server took too long to respond. Please try again.' });
    }
  }, timeoutMs);
  res.on('finish', () => clearTimeout(timeout));
  res.on('close', () => clearTimeout(timeout));
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // Skip noisy logs — per-thumbnail brand-logo 404s on Brand Explorer
      // can fire ~200 times per page load. They're cached by the browser
      // for 24h on 404, but the first paint is still noisy.
      if (path.startsWith("/api/brand-logo/") && res.statusCode === 404) return;
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      const safeToLogRoutes = ["/api/config/", "/api/push/", "/api/heartbeat"];
      const isSafeToLog = safeToLogRoutes.some(r => path.startsWith(r));
      if (capturedJsonResponse && isSafeToLog) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

app.use("/api/branding/fonts", express.static(
  process.cwd() + "/server/assets/branding/fonts",
  { maxAge: "7d", immutable: true }
));

app.use("/api/branding/assets", express.static(
  process.cwd() + "/server/assets/branding",
  { maxAge: "7d", immutable: true }
));

(async () => {
  setupAuth(app);

  // ── Client default-deny backstop ──────────────────────────────────────
  // Client logins (role='Client', e.g. Landsec) are external — they must
  // only reach an explicit set of client-safe API surfaces. Rather than
  // rely on every internal router remembering to guard itself (the opt-in
  // model that leaked BGP mail, chat, HR, WIP…), we deny clients ALL of
  // /api by default and allow only the vetted prefixes below. Runs after
  // setupAuth so req.session.userId is populated for token logins too.
  // GET/HEAD surfaces a client may read.
  const CLIENT_ALLOWED_API = [
    // /api/brands/ = Brand Intelligence hub reads (hub, hunter, turnover
    // status, market commentary). GET-only here; the research/flag POSTs
    // stay staff-only via the write allowlist. (Landsec brand access.)
    "/api/client/", "/api/crm/", "/api/brands/", "/api/client-teams/",
    "/api/portfolio/", "/api/company-portfolio", "/api/leasing-schedule/",
    "/api/tenancy-schedule/", "/api/properties/", "/api/property/",
    "/api/property-intelligence", "/api/land-registry", "/api/business-rates",
    // Plan images + unit polygons for the Plans board — property-page board
    // parity for clients (Woody, 2026-08-03). Plan ids are UUIDs; writes
    // (upload, polygon editing, auto-detect) stay staff-only.
    "/api/plans/",
    "/api/voa", "/api/map-layers", "/api/os-data", "/api/edozo",
    "/api/image-studio", "/api/ai-briefing",
    "/api/notifications", "/api/daily-digest", "/api/activity-feed",
    "/api/dashboard/", "/api/search", "/api/users", "/api/news-feed/",
    "/api/favorite-instructions", "/api/chatbgp/", "/api/hr/photo/",
    "/api/available-units", "/api/tasks",
    // Canonical activity feed — handler scopes clients to their own
    // portfolio and returns sanitised summaries only.
    "/api/activity-summary",
    "/api/chat/threads", "/api/chat-media/", "/api/brand-logo/",
    // Unread count for the mobile Messages badge — count only, no content.
    "/api/chat/notifications",
    // Smart-tag picker + "conversations about X" — both company-scoped for
    // clients server-side (tag-search filters to the caller's own portfolio;
    // threads-tagging is member-scoped), so a Landsec login only ever sees
    // its own entities and its own threads.
    "/api/chat/tag-search", "/api/chat/threads-tagging",
    // Harmless infra reads every logged-in browser makes: the public web-push
    // VAPID key (push writes are already client-allowed) and aggregate logo
    // cache stats used by the shared company-logo helper.
    "/api/push/vapid-key", "/api/brand-logo-stats",
    // Google Maps JS key for address autocomplete on the deal-create form
    // (low-sensitivity, domain-restricted publishable key).
    "/api/config/maps-key",
    // Turnover Board reads (the tab is client-visible; research/edit POSTs
    // stay staff-only via the write allowlist) and the saved dashboard
    // template (read-only layout defaults).
    "/api/turnover", "/api/dashboard-template",
    // Operator Targeting Briefs on the client's own units — the Letting
    // Tracker lists these, and the handler scopes the rows (and their target
    // operators) to the caller's portfolio.
    "/api/unit-briefs",
    // Client calendar — the handler company-scopes events for client
    // viewers (client-sync events only). Dropped out of the list in a
    // branch merge, which blanked Mark's calendar with a 403.
    "/api/team-events",
    // Calendar intelligence bar — the handler computes insights from the
    // caller's own company only (fees nulled) when scoped.
    "/api/microsoft/calendar/insights",
    // Insights feed — the handler slices to client-safe audience +
    // category + own-company rows when scoped.
    "/api/insights",
  ];
  // Microsoft 365 stays otherwise blocked for clients (mail/files/tokens all
  // 403) — the two calendar-intelligence endpoints above/below are the only
  // exceptions, and both company-jail their context server-side.
  // The only writes a client may perform. (heartbeat/push/config are
  // harmless presence + client-preference pings every user sends;
  // /api/chatbgp/ covers chat + chat-with-files — tools are stripped for
  // clients inside those handlers via clientChatGuard.)
  const CLIENT_ALLOWED_WRITES = [
    "/api/auth/logout", "/api/chatbgp/", "/api/heartbeat",
    // Meeting-prep AI briefing (POST) — company-jailed + fee-free for
    // scoped callers inside the handler; email context is staff-only.
    "/api/microsoft/calendar/briefing",
    // ChatBGP panel bookkeeping: the AI reply goes to /api/chatbgp/ (allowed)
    // but the panel first creates a thread + posts the user message here.
    // Message POST enforces thread membership server-side; membership and
    // group-pic management stay staff-only via CLIENT_BLOCKED_SUBPATHS.
    // /api/chat/upload lets a client attach a document (e.g. their own
    // targeting brief PDF) to a chat message.
    "/api/chat/threads", "/api/chat/upload",
    // Landsec may add/amend CRM contacts — POST/PUT scope-checked in crm.ts
    // (own company or the hospitality-brand slice only).
    "/api/crm/contacts",
    // Clients may create tenant BRANDS (create is category-gated to the
    // client CRM slice; company PUT is gated to own row / visible brands)
    // and kick the AI enrichment on a brand they can see. Both checks live
    // in the handlers, added for the requirements-board "+ New brand" flow.
    "/api/crm/companies", "/api/brand/enrich/",
    // Client pulls brands into their own CRM from the global directory
    // (crm_extra_brand_ids on their company) — scope-checked per handler.
    "/api/client/crm/",
    // Clients may create + edit deals on their OWN portfolio (Woody, 2026-07:
    // "client needs to be able to do as much as the agent"). The handler
    // forces the deal onto the client's own company and strips every fee
    // field — clients never set or see BGP's fee. Delete stays staff-only.
    "/api/crm/deals",
    // Clients may author Operator Targeting Briefs on their own units and
    // upload/file photos for their own buildings — each endpoint verifies the
    // unit/property is in the client's scope. ("Client does as much as the
    // agent"; brief + photo authoring.) Only these specific image-studio
    // writes are opened — delete / ai-generate / bulk ops stay staff-only.
    "/api/unit-briefs", "/api/image-studio/upload",
    "/api/push/", "/api/config/", "/api/favorite-instructions",
    // Clients may edit their OWN leasing/tenancy schedule rows (positioning,
    // bands, targets, meeting updates). Each endpoint verifies the property is
    // in the client's scope; import/bulk-delete stay staff-only. (Landsec.)
    // Both singular (/unit/:id PUT) and plural (/units/:id/archive PATCH) —
    // the archive button 403'd while the delete beside it worked.
    "/api/tenancy-schedule/unit", "/api/leasing-schedule/unit", "/api/leasing-schedule/units",
    // One-click "+ Tracker" from the tenancy schedule — scope-checked in the
    // handler (checkPropertyAccess), so a client can only list their own units.
    "/api/leasing-schedule/promote-from-tenancy",
    // Clients may manage their OWN tasks (every task endpoint is scoped to
    // user_id); the My Tasks dashboard widget needs create/complete/reorder.
    "/api/tasks",
    // Per-user news actions (click/save/dismiss tracking) — harmless and
    // needed for the News tab; the fetch/scrape trigger stays staff-only.
    "/api/news-feed/engage",
    // The client app's "Your BGP Team" board is a full mirror of the
    // internal client-team board — same data, same editing (Woody,
    // 2026-07). Covers member add/edit/reorder and column management.
    "/api/client-teams/",
    // Letting Tracker parity ("client needs to be able to do as much as
    // the agent"): unit add/edit/delete, viewings, offers, marketing
    // files, deal link. Every handler scope-checks the unit's property
    // against the client's company and strips BGP fee fields.
    "/api/available-units",
    // Clients may add events to their own calendar — the POST forces
    // company_name to the caller's company and created_by to the caller,
    // so events land on their (company-scoped) calendar only; delete is
    // creator-only in the handler.
    "/api/team-events",
  ];
  // Sub-routes to block even though a parent prefix is allowed (BGP intel /
  // brand pipeline that isn't the client's own profile; OneNote task import
  // rides on Microsoft, which stays sealed for clients).
  const CLIENT_BLOCKED_SUBPATHS = [
    /^\/api\/chat\/threads\/[^/]+\/(members|group-pic)/,
    /^\/api\/tasks\/(onenote|import)/,
    // ── Firm-wide / cross-company GETs that sit under an allowed parent
    //    prefix but were never company-scoped. Blocked for clients so a
    //    Landsec login can't pull other landlords' data via the network tab.
    //    (Landsec audit, pre-demo sweep.) The scoped equivalents clients DO
    //    use — /api/crm/companies, /deals, /properties, /available-units,
    //    /leasing-schedule/property/:id, /company-property-links — are not
    //    matched here and keep working.
    /^\/api\/dashboard\/intelligence/,
    /^\/api\/crm\/(landlords|stats)\b/,
    // property-deal-links + property-tenants are no longer blocked: the
    // client Properties page needs both maps and the handlers now scope
    // them to the caller's own portfolio (same pattern as property-agents).
    /^\/api\/crm\/(contact-property-links|contact-deal-links|contact-requirement-links|company-deal-links)\b/,
    /^\/api\/crm\/companies\/[^/]+\/trading-entities/,
    /^\/api\/crm\/properties\/[^/]+\/agents/,
    // all-viewings / all-offers (+counts) are now SCOPED per caller in
    // routes.ts, so clients get letting activity on their OWN units — the
    // tracker's viewings/offers controls need them to render. matches is
    // now scoped in routes.ts too (own unit only, results filtered to
    // client-visible brands) — the brief dialog needs it. all-files stays
    // firm-wide and blocked.
    /^\/api\/available-units\/all-files\b/,
    /^\/api\/leasing-schedule\/export-excel/,           // firm-wide export; per-property /property/:id/export stays scoped
    /^\/api\/leasing-schedule\/property\/[^/]+\/privacy/,
    // tenancy-schedule /links is no longer blocked: the client unified
    // schedule (editable since the Tenancy→Tracker parity work) needs the
    // deal/letting link map, and the handler now scope-checks the property.
    // brochures / tasks / plans / plan-pickable-units came OFF this list in
    // the board-parity work (Woody, 2026-08-03) — their handlers now
    // scope-check the property via clientBlockedForProperty.
    /^\/api\/properties\/[^/]+\/(360|orphan-deals|instructions|project-files|duplicate-units|unresolved-tenants|linkage-audit)\b/,
    /^\/api\/image-studio\/orphans/,
  ];
  app.use("/api", async (req: any, res, next) => {
    // NB: inside app.use("/api", …) the mount path is stripped from req.path,
    // so match on the full originalUrl (minus query string).
    const p = (req.originalUrl || req.url || "").split("?")[0];
    if (p.startsWith("/api/auth/")) return next();
    try {
      const { isClientRequestUser } = await import("./company-scope");
      if (!(await isClientRequestUser(req))) return next(); // BGP staff: unaffected
      const isWrite = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (isWrite) {
        // Blocked sub-paths win even over an allowed parent (e.g. task import
        // rides on Microsoft, which stays sealed for clients).
        if (CLIENT_BLOCKED_SUBPATHS.some(re => re.test(p))) {
          return res.status(403).json({ error: "Not available for client accounts" });
        }
        // Staff-only deal operations riding under the allowed /api/crm/deals
        // prefix — none of their handlers client-check, so the gateway must:
        // single + bulk delete, bulk field edits, the internal per-agent fee
        // split, and the firm-wide rent-analysis / HOTs-parse AI ops. Deal
        // create + edit stay open (scope-checked + fee-stripped in crm.ts).
        if (/^\/api\/crm\/deals\/(bulk-update|bulk-delete|bulk-rent-analysis)$/.test(p) ||
            /^\/api\/crm\/deals\/[^/]+\/(fee-allocations|parse-hots)$/.test(p) ||
            (req.method === "DELETE" && /^\/api\/crm\/deals\/[^/]+$/.test(p))) {
          return res.status(403).json({ error: "Not available for client accounts" });
        }
        // Contact-graph link writes ride under the allowed /api/crm/contacts
        // prefix but have no scope check — a client could wire ANY contact
        // onto ANY deal / property / requirement (including other tenants').
        // Client contact parity is add/amend of the contact RECORD only, not
        // the relationship graph, so block these link writes entirely.
        if (/^\/api\/crm\/contacts\/[^/]+\/(properties|deals|requirements)(\/|$)/.test(p)) {
          return res.status(403).json({ error: "Not available for client accounts" });
        }
        // Authoring an Operator Targeting Brief on one of their own units —
        // the create route hangs off /api/available-units/:id/brief; the
        // handler verifies the unit's property is in the client's scope.
        // (We don't open all of /api/available-units, only the brief POST.)
        if (req.method === "POST" && /^\/api\/available-units\/[^/]+\/brief$/.test(p)) return next();
        // AI-draft a brief for one of their own units (read-only draft, the
        // handler scope-checks the unit); the client reviews before saving.
        if (req.method === "POST" && /^\/api\/available-units\/[^/]+\/brief\/draft-ai$/.test(p)) return next();
        // Leasing strategy board writes on the client's OWN property — the
        // strategic-principles key block, AI target generation and target-
        // tenant rows ("Save failed — read-only" on the Landsec board).
        // checkPropertyAccess in leasing-schedule.ts confines clients to
        // their own company's properties on every one of these routes.
        if (/^\/api\/leasing-schedule\/property\/[^/]+\/(strategic-principles|generate-targets)$/.test(p)) return next();
        if (/^\/api\/leasing-schedule\/target\/[^/]+$/.test(p)) return next();
        // BGP Commentary regenerate on the client's OWN property — Mark
        // Warne's 403 on Liverpool ONE (Woody, 2026-08-03). The handler in
        // property-asset-brief.ts confines clients to in-scope properties
        // and the prompt never carries fee figures.
        if (req.method === "POST" && /^\/api\/properties\/[^/]+\/bgp-commentary\/regenerate$/.test(p)) return next();
        // Image Studio client parity (Woody, 2026-08-04: "the image studio
        // needs the full functionality of the BGP image studio"). Creative
        // writes are opened to clients — every handler in image-studio.ts
        // scope-jails the image / collection / property to the caller's
        // company. Hard delete, bulk-delete, dedupe, sync, capture-pdf and
        // the firm-wide AI sweeps stay staff-only (requireAdmin or scope
        // 403 at the route, and no allowance here).
        if (/^\/api\/image-studio\//.test(p)) {
          const allowedStudioWrite =
            /^\/api\/image-studio\/(ai-edit|ai-edit-async|ai-generate|stock-search|import-stock|ai-tag|capture-streetview|capture-and-enhance|bulk-tag|bulk-categorize|bulk-assign-property)$/.test(p) ||
            (/^\/api\/image-studio\/collections(\/|$)/.test(p) && !/rebuild-properties/.test(p)) ||
            (req.method === "PATCH" && /^\/api\/image-studio\/[^/]+$/.test(p) && !/^\/api\/image-studio\/(bulk-|dedupe|trigger-sync|clear-deleted)/.test(p)) ||
            (req.method === "POST" && /^\/api\/image-studio\/[^/]+\/(trash|restore|revert|attach)$/.test(p));
          if (allowedStudioWrite) return next();
        }
        // Enrichment buttons on a client-visible brand — covenant refresh +
        // Companies House enrich (Woody, 2026-08-04: "allow for Landsec to
        // hit the enrichment button — they need to be able to use the app
        // in the same way we can"). Both only refresh derived/public data
        // on the brand record; gated on the client's brand slice.
        const enrichTarget = p.match(/^\/api\/(?:brand\/([^/]+)\/credit-check|companies-house\/auto-kyc\/([^/]+))$/);
        if (req.method === "POST" && enrichTarget) {
          const { isClientVisibleBrand, resolveCompanyScope } = await import("./company-scope");
          const scope = await resolveCompanyScope(req);
          if (await isClientVisibleBrand(enrichTarget[1] || enrichTarget[2], scope)) return next();
          return res.status(403).json({ error: "Not available for client accounts" });
        }
        // Contacts-map pins/hides on the client's own property — the
        // handlers scope-check via clientBlockedForProperty and only touch
        // the per-property override table, never CRM rows.
        if ((req.method === "POST" || req.method === "DELETE") && /^\/api\/properties\/[^/]+\/contact-override(\/|$)/.test(p)) return next();
        // Brochure + plan uploads on the client's own property — handlers
        // scope-check via clientBlockedForProperty.
        if (req.method === "POST" && /^\/api\/properties\/[^/]+\/brochures\/upload$/.test(p)) return next();
        if (req.method === "POST" && /^\/api\/properties\/[^/]+\/plans$/.test(p)) return next();
        // Activity AI summarise on client feeds (Woody, 2026-08-05: "include
        // the usability") — the handler company-jails the interaction to the
        // caller's scope/visible brands; sync + discover-contacts don't match
        // this shape and stay staff-only.
        if (req.method === "POST" && /^\/api\/interactions\/[^/]+\/summarise$/.test(p)) return next();
        // Same prefix-matching rule as the read allowlist: entries ending in
        // "/" match by prefix, others match exactly or as a path segment.
        if (CLIENT_ALLOWED_WRITES.some(w =>
          w.endsWith("/") ? p.startsWith(w) : (p === w || p.startsWith(w + "/"))
        )) return next();
        return res.status(403).json({ error: "Read-only access for client accounts" });
      }
      if (CLIENT_BLOCKED_SUBPATHS.some(re => re.test(p))) {
        return res.status(403).json({ error: "Not available for client accounts" });
      }
      const allowed = CLIENT_ALLOWED_API.some(pre =>
        pre.endsWith("/") ? p.startsWith(pre) : (p === pre || p.startsWith(pre + "/") || p.startsWith(pre + "?"))
      );
      // Covenant badge + commentary reads for clients (Woody, 2026-08-04:
      // "open up covenant for Mark") — the per-company report only, and only
      // for the client's own company or a brand in their visible slice.
      // Watchlist, alerts, watch writes and runs stay staff-only (they don't
      // match these shapes and fall through to the default block).
      const covCrm = req.method === "GET" ? p.match(/^\/api\/covenant\/by-crm\/([^/]+)$/) : null;
      const covNum = req.method === "GET" ? p.match(/^\/api\/covenant\/((?=[A-Za-z0-9]*\d)[A-Za-z0-9]{6,10})$/) : null;
      if (covCrm || covNum) {
        const { resolveCompanyScope, isClientVisibleBrand } = await import("./company-scope");
        const covScope = await resolveCompanyScope(req);
        if (covCrm && (covCrm[1] === covScope || (await isClientVisibleBrand(covCrm[1], covScope)))) return next();
        if (covNum && covScope) {
          const hit = await pool.query(`SELECT id FROM crm_companies WHERE companies_house_number = $1 LIMIT 1`, [covNum[1]]);
          const covCid = hit.rows[0]?.id;
          if (covCid && (covCid === covScope || (await isClientVisibleBrand(covCid, covScope)))) return next();
        }
        return res.status(403).json({ error: "Not available for client accounts" });
      }
      // Full Brand Intelligence reads (profile, hunter-score, competitors,
      // suggested-units, ai-take, pack…) for the client's own company or any
      // brand in the hospitality slice; everything else stays blocked.
      const brandRead = p.match(/^\/api\/brand\/([^/]+)\//);
      if (brandRead) {
        const { resolveCompanyScope, isClientVisibleBrand } = await import("./company-scope");
        const scope = await resolveCompanyScope(req);
        if (brandRead[1] === scope || (await isClientVisibleBrand(brandRead[1], scope))) return next();
      }
      // AI activity commentary (AIActivityCard) on the client's OWN company —
      // the dashboard BGP Relationship board mirrors the internal page
      // (Woody, 2026-07-30) — or on a brand in their visible slice: the
      // brand profile's BGP Relationship zone is client-visible too (Woody,
      // 2026-08-04 parity). Read-only: the exact landlord|brand/:id shape
      // only, so the raw meeting/email viewer routes and the curate POST
      // (a write) stay sealed for clients.
      const activityRead = p.match(/^\/api\/activity\/(landlord|brand)\/([^/]+)$/);
      if (activityRead) {
        const { resolveCompanyScope, isClientVisibleBrand } = await import("./company-scope");
        const scope = await resolveCompanyScope(req);
        if (scope && (activityRead[2] === scope || (await isClientVisibleBrand(activityRead[2], scope)))) return next();
      }
      // All-correspondence drawer on the brand profile — client-visible for
      // their own company and slice brands (Woody, 2026-08-04). The handler
      // in interactions.ts re-checks the same scope rule and 403s anything
      // outside it, so this only lets the request reach that gate.
      const interactionsRead = p.match(/^\/api\/interactions\/company\/([^/]+)$/);
      if (interactionsRead) {
        const { resolveCompanyScope, isClientVisibleBrand } = await import("./company-scope");
        const scope = await resolveCompanyScope(req);
        if (scope && (interactionsRead[1] === scope || (await isClientVisibleBrand(interactionsRead[1], scope)))) return next();
      }
      if (allowed) return next();
      return res.status(403).json({ error: "Not available for client accounts" });
    } catch { return next(); }
  });

  setupMicrosoftRoutes(app);
  setupWhatsAppRoutes(app);
  setupChatBGPRoutes(app);
  setupArchivistRoutes(app);
  setupNewsIntelligenceRoutes(app);
  setupNewsFeedRoutes(app);
  import("./contact-verify").then(m => { m.setupContactVerifyRoutes(app); m.startContactVerifySweep(); }).catch(e => console.warn("[contact-verify] setup failed:", e?.message));
  import("./insights-feed").then(m => { m.setupInsightsRoutes(app); m.startInsightsLoop(); }).catch(e => console.warn("[insights] setup failed:", e?.message));
  import("./notes").then(m => m.setupNotesRoutes(app)).catch(e => console.warn("[notes] setup failed:", e?.message));
  import("./teams-notes").then(m => { m.setupTeamsNotesRoutes(app); m.startTeamsNotesLoop(); }).catch(e => console.warn("[teams-notes] setup failed:", e?.message));
  setupModelsRoutes(app);
  setupDocumentTemplateRoutes(app);
  setupCanvaRoutes(app);
  setupXeroRoutes(app);
  registerXeroFinancialRoutes(app);
  registerApiUsageRoutes(app);
  setupEvernoteRoutes(app);
  registerLandRegistryRoutes(app);
  setupBusinessGatewayRoutes(app);
  setupCovenantRoutes(app);
  registerPropertyResolverRoutes(app);
  registerPropertyBrochureRoutes(app);
  registerPlaMattersRoutes(app);
  registerPlaValuationRoutes(app);
  registerComparablesScheduleRoute(app);
  registerWestminsterRestaurantsRoutes(app);
  registerPropertyImageryRoutes(app);
  registerDocumentBriefRoutes(app);
  registerVoaRoutes(app);
  // Probe the VOA SQLite snapshot at boot so we log where rates data is coming
  // from. No-op if the file isn't mounted — callers gracefully degrade.
  try {
    const { voaSqliteInfo } = await import("./voa-sqlite");
    const info = voaSqliteInfo();
    if (info.available) {
      console.log(`[voa-sqlite] backend=sqlite path=${info.path} rows=${info.rowCount} builtAt=${info.builtAt} areas=${info.areas}`);
    } else {
      console.log("[voa-sqlite] backend=postgres (no SQLite file present — falling back to voa_ratings table)");
    }
  } catch (err: any) {
    console.warn("[voa-sqlite] probe error:", err?.message || err);
  }
  registerLegalDDRoutes(app);
  setupSharedMailboxRoutes(app);
  registerInteractionRoutes(app);
  registerTaskSuggestionRoutes(app);

  registerEmailProcessorRoutes(app);
  registerHealthCheckRoutes(app);
  registerAIIntelligenceRoutes(app);
  setupLeadsRoutes(app);
  registerMcpRoutes(app);
  setupCrmRoutes(app);
  app.use(companiesHouseRouter);
  registerPropertyPathwayRoutes(app);
  const { registerPortfolioRoutes } = await import("./portfolios");
  registerPortfolioRoutes(app);
  const { registerActivityRoutes } = await import("./activity-routes");
  registerActivityRoutes(app);
  const { registerIngestRoutes } = await import("./ingest-routes");
  registerIngestRoutes(app);
  const { registerGenericCrmRoutes } = await import("./generic-crm-routes");
  registerGenericCrmRoutes(app);
  registerDemeterRoutes(app);
  registerRetailContextPlanRoutes(app);
  registerMapLayerRoutes(app);
  app.use(leasingScheduleRouter);
  app.use(tenancyScheduleRouter);
  app.use(clientTeamsRouter);
  app.use(clientSharepointRouter);
  app.use(activitySummaryRouter);
  app.use(expansionIntelRouter);
  app.use(turnoverRouter);
  app.use(sanctionsRouter);
  app.use(kycClouseauRouter);
  app.use(amlComplianceRouter);
  app.use(veriffRouter);
  app.use(kycOrchestratorRouter);
  app.use(perplexityRouter);
  app.use(brandDedupeRouter);
  app.use(brandProfileRouter);
  app.use(brandEnrichmentRouter);
  app.use(brandAiTakeRouter);
  app.use(goadTenantResolverRouter);
  app.use(contactsDiscoveryRouter);
  app.use(brandDigestRouter);
  app.use(brandTriggersRouter);
  app.use(brandPerplexityRefreshRouter);
  app.use(brandScraperRouter);
  app.use(brandSocialScraperRouter);
  app.use(rocketreachContactsRouter);
  app.use(rocketreachCompanyRouter);
  app.use(apolloCompanyRouter);
  app.use(brandCompetitorsRouter);
  app.use(bulkBrandLogosRouter);
  app.use(brandImagesRouter);
  app.use(instagramRouter);
  app.use(pipnetRequirementsRouter);
  app.use(purgeApolloContactsRouter);

  // Health + lookup endpoints for the two new data providers.
  app.get("/api/rocketreach/health", async (_req, res) => {
    res.json(await rocketreachHealth());
  });
  app.get("/api/experian/health", async (_req, res) => {
    res.json(await experianHealth());
  });
  app.post("/api/experian/credit-report", requireAuth, async (req, res) => {
    try {
      if (!isExperianConfigured()) return res.status(400).json({ error: "EXPERIAN not configured" });
      const companyNumber = String(req.body?.companyNumber || "").trim();
      if (!companyNumber) return res.status(400).json({ error: "companyNumber required" });
      const report = await fetchCommercialCredit(companyNumber);
      if (!report) return res.status(404).json({ error: "No Experian credit report found for that company" });
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Unknown error" });
    }
  });
  // Temporary sandbox debug route — remove after testing
  app.post("/api/experian/debug-raw", requireAuth, async (req, res) => {
    try {
      if (!isExperianConfigured()) return res.status(400).json({ error: "EXPERIAN not configured" });
      const companyNumber = String(req.body?.companyNumber || "").trim();
      if (!companyNumber) return res.status(400).json({ error: "companyNumber required" });
      const result = await debugExperianRaw(companyNumber, {
        path: req.body?.path,
        method: req.body?.method,
        reqBody: req.body?.reqBody,
        extraHeaders: req.body?.extraHeaders,
        baseOverride: req.body?.baseOverride,
        noAuth: req.body?.noAuth,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Unknown error" });
    }
  });
  // Comprehensive sandbox audit — exercises every Experian product BGP cares
  // about, returns a sales-ready buy list. Hit GET /api/experian/sandbox-audit
  // (?regnum=XXXX optional, defaults to Experian's 99999999 dummy company).
  app.get("/api/experian/sandbox-audit", requireAuth, async (req, res) => {
    try {
      const regnum = String(req.query?.regnum || "99999999");
      const out = await sandboxAudit(regnum);
      res.json(out);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Unknown error" });
    }
  });
  // Business Profile endpoint discovery — hit once to find the correct path, then remove
  app.get("/api/experian/discover-profile", requireAuth, async (req, res) => {
    try {
      if (!isExperianConfigured()) return res.status(400).json({ error: "EXPERIAN not configured" });
      const regnum = String(req.query?.regnum || "99999999").trim().toUpperCase();
      const candidates = [
        { path: `/risk/business/v2/businessprofile/${regnum}`,                    method: "GET" },
        { path: `/risk/business/v2/registeredbusinessprofile/${regnum}`,          method: "GET" },
        { path: `/risk/business/v2/businessinformation/${regnum}`,                method: "GET" },
        { path: `/business-information/businesses/uk/v1/profile/${regnum}`,       method: "GET" },
        { path: `/business-information/businesses/uk/v2/profile/${regnum}`,       method: "GET" },
        { path: `/kyb/businesses/uk/v1/profile/${regnum}`,                        method: "GET" },
        { path: `/compliance/business/v1/company/${regnum}`,                      method: "GET" },
        { path: `/risk/business/v2/businessprofile`,                              method: "POST", reqBody: { registrationNumber: regnum } },
        { path: `/business-information/businesses/uk/v1/profile`,                 method: "POST", reqBody: { registrationNumber: regnum, country: "GB" } },
      ];
      // Run all in parallel — avoids sequential 30s timeouts stacking up
      const settled = await Promise.allSettled(
        candidates.map(c => debugExperianRaw(regnum, { path: c.path, method: c.method, reqBody: c.reqBody })
          .then(r => ({ path: c.path, method: c.method, status: r.status, ok: r.status >= 200 && r.status < 300, preview: JSON.stringify(r.body).slice(0, 300) }))
          .catch((e: any) => ({ path: c.path, method: c.method, status: null, ok: false, preview: e?.message }))
        )
      );
      const results = settled.map(s => s.status === "fulfilled" ? s.value : { ok: false, preview: (s as any).reason?.message });
      res.json({ regnum, results });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Unknown error" });
    }
  });
  app.use(propertyGapAnalysisRouter);
  app.use(brandPackRouter);
  app.use(dealDocsRouter);
  app.use(weeklyReportRouter);
  app.use(dealReportRouter);
  app.use(dealStagesRouter);
  app.use(leasingPitchRouter);
  app.use(cadRouter);
  app.use(propertyPlansRouter);
  app.use(propertyAssetBriefRouter);

  await registerRoutes(httpServer, app);
  setupWebSocket(httpServer);

  // Idempotent boot-time migration for the People & HR columns. Runs once on
  // every startup; ADD COLUMN IF NOT EXISTS makes it a no-op once applied.
  try {
    const { pool } = await import("./db");
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS manager_id varchar,
        ADD COLUMN IF NOT EXISTS dob text,
        ADD COLUMN IF NOT EXISTS address text,
        ADD COLUMN IF NOT EXISTS personal_email text,
        ADD COLUMN IF NOT EXISTS wfh_days text[],
        ADD COLUMN IF NOT EXISTS employment_type text,
        ADD COLUMN IF NOT EXISTS start_date text,
        ADD COLUMN IF NOT EXISTS cv_url text,
        ADD COLUMN IF NOT EXISTS bio text,
        ADD COLUMN IF NOT EXISTS board_member boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS management_team boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 0
    `);
    log("HR columns ready", "migrate");
  } catch (err: any) {
    console.error("[migrate] HR columns:", err?.message);
  }

  // Two-stage expense approval: route any pre-existing pending_approval rows
  // into stage 1 (random Wendy/Layla) so nothing is left on the old model.
  // Best-effort + idempotent; delayed so the column auto-migrate has landed.
  setTimeout(() => {
    import("./expense-approval")
      .then(({ backfillApprovalStages }) => backfillApprovalStages())
      .catch((err: any) => console.warn("[migrate] approval-stage backfill skipped:", err?.message));
  }, 15000);

  app.all("/api/{*path}", (_req: Request, res: Response) => {
    res.status(404).json({ message: "Not found" });
  });

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      // "::" (dual-stack) unless the host has no IPv6 (some containers) —
      // HOST=0.0.0.0 overrides without a code change.
      host: process.env.HOST || "::",
    },
    () => {
      log(`serving on port ${port}`);
      // startEmailProcessor(); // DISABLED - maintenance mode
      setTimeout(() => startHealthCheck(), 10000);
      // ChatBGP-authored scheduled jobs — runs in dev too so local testing
      // works. Worker is idle if the table is empty / has nothing due.
      setTimeout(async () => {
        try {
          const { startScheduledJobs } = await import("./scheduled-jobs");
          startScheduledJobs();
        } catch (e: any) {
          console.error("[scheduled-jobs] Failed to start:", e?.message);
        }
      }, 15000);
      // Resume pathway runs whose auto-chain was killed by the last
      // redeploy — they used to stay "running" forever.
      setTimeout(async () => {
        try {
          const { resumeInterruptedPathwayRuns } = await import("./property-pathway");
          await resumeInterruptedPathwayRuns();
        } catch (e: any) {
          console.error("[pathway resume] Failed:", e?.message);
        }
      }, 20000);
      // Background crawls only run in production — too slow/fragile over local internet
      const isProduction = process.env.NODE_ENV === "production";
      if (isProduction) {
        setTimeout(() => startAutoEnrichment(), 30000);
        setTimeout(() => startAutoTurnoverResearch(), 30000);
        import("./client-team-events-sync").then(m => m.startClientEventsSyncLoop()).catch(() => {});
        // Heavy crawls (image-sync + archivist) block the event loop and
        // were starving ChatBGP after every redeploy — a single chat turn
        // would hit the 10-min deadline because the box was saturated. They
        // do near-zero useful work most of the time (everything's already
        // indexed), so run them ONCE a day at ~midnight UK, when no one is
        // using the app — not on boot, and not every 6 hours. Chained so the
        // two never spike CPU/memory simultaneously.
        {
          let lastNightlyCrawlDay = "";
          const ukNow = () =>
            new Intl.DateTimeFormat("en-GB", {
              timeZone: "Europe/London",
              hourCycle: "h23",
              year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
            })
              .formatToParts(new Date())
              .reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {} as Record<string, string>);
          const checkNightlyCrawls = async () => {
            const p = ukNow();
            const day = `${p.year}-${p.month}-${p.day}`;
            if (p.hour !== "00" || lastNightlyCrawlDay === day) return;
            lastNightlyCrawlDay = day;
            console.log(`[nightly-crawl] Midnight UK (${day}) — running image-sync then archivist`);
            try {
              const { runImageSync } = await import("./image-studio");
              await runImageSync();
            } catch (e: any) {
              console.error("[image-sync] Nightly sync error:", e?.message);
            }
            try {
              await runArchivistCrawl();
            } catch (e: any) {
              console.error("[archivist] Nightly crawl error:", e?.message);
            }
          };
          setInterval(() => { checkNightlyCrawls().catch(() => {}); }, 5 * 60 * 1000);
        }
        setTimeout(async () => {
          try {
            const { startLeaseEventMonitoring } = await import("./lease-events");
            startLeaseEventMonitoring();
          } catch (e: any) {
            console.error("[lease-events] Failed to start monitoring:", e.message);
          }
        }, 90000);
        setTimeout(async () => {
          try {
            const { startIntelCachePurge } = await import("./utils/intel-cache");
            startIntelCachePurge();
          } catch (e: any) {
            console.error("[intel-cache] Failed to start:", e.message);
          }
        }, 120000);
        // VOA auto-import disabled — was OOM-killing the server. Admin can
        // run POST /api/voa/import manually (or hit GET /api/voa/status?import=1)
        // when the service has enough headroom, ideally from a one-off job.
        // To re-enable: uncomment the line below AND ensure ≥2GB memory.
        // startVoaAutoImport();
      } else {
        console.log("[dev] Skipping background crawls (image-sync, archivist, auto-enrich) — production only");
      }
      // KYC monthly re-screening cron (check daily, run on 1st of month)
      setInterval(() => {
        const now = new Date();
        if (now.getDate() === 1 && now.getHours() === 3) {
          runMonthlyReScreening().catch(err =>
            console.error("[kyc-cron] Monthly re-screening failed:", err?.message)
          );
        }
      }, 60 * 60 * 1000); // Check every hour

      // Expenses: weekly agent chase (Mon 09:00) + monthly approver
      // digest (28th 09:00). Both fire in production AND development —
      // dev firing is gated by whether WHATSAPP_TOKEN_V2 is set. Wrap
      // the dynamic import in an IIFE so the surrounding listen()
      // callback stays sync — couldn't make the callback itself async
      // without changing the listen() signature.
      (async () => {
        try {
          const { startExpenseCron } = await import("./expense-cron");
          startExpenseCron();
        } catch (e: any) {
          console.warn("[expense-cron] start failed:", e?.message);
        }
      })();

      // Auto email-receipt sweep — every 10 min, retry matching email
      // receipts to pending card expenses (receipts often email through a
      // few minutes after the swipe). Pushes a phone notification on each
      // match. Idempotent — matched expenses drop out of the query.
      setInterval(() => {
        import("./expense-email-receipt")
          .then(m => m.sweepPendingEmailReceipts())
          .then(r => { if (r.matched > 0) console.log(`[email-receipt sweep] matched ${r.matched}/${r.scanned}`); })
          .catch(err => console.warn("[email-receipt sweep] failed:", err?.message));
      }, 10 * 60 * 1000);

      // One-off (idempotent) cleanup of the diary noise the old import-time
      // matcher stamped onto non-hospitality card rows — e.g. a leasing
      // meeting + 12 attendees on a £0.75 train tap. Clears only auto-attached
      // events on non-eating/drinking Revolut rows; restaurant matches and
      // manual entries are untouched. Reruns clear nothing.
      import("./expense-calendar-context")
        .then(m => m.clearMeetingNoise())
        .then(n => { if (n > 0) console.log(`[expense-calendar] cleared diary noise from ${n} non-hospitality card rows`); })
        .catch(err => console.warn("[expense-calendar] clearMeetingNoise failed:", err?.message));

      // One-off (idempotent): stop existing software-subscription card rows
      // nagging for a receipt — flip them to categorised (the supplier invoice
      // is the record; the sweep still files it if it emails through).
      import("./revolut")
        .then(m => m.categoriseExistingSubscriptions())
        .then(n => { if (n > 0) console.log(`[revolut] auto-categorised ${n} recurring-subscription rows (no longer chasing receipts)`); })
        .catch(err => console.warn("[revolut] categoriseExistingSubscriptions failed:", err?.message));

      // Daily AML orchestrator re-sweep — 02:00 every night we pick up any
      // company whose KYC has gone stale (past the firm's recheck_interval_days,
      // default 365) or has an overdue aml_recheck_reminders row, and re-run
      // the full sweep (Companies House + UBO + sanctions + adverse media).
      // Capped at 25 companies per night so a single run can't blow through
      // quotas. Production only — dev shouldn't be making live API calls overnight.
      if (process.env.NODE_ENV === "production") {
        setInterval(() => {
          const now = new Date();
          if (now.getHours() === 2) {
            runPeriodicAmlReScreening().catch(err =>
              console.error("[kyc-orch-cron] Periodic re-screening failed:", err?.message)
            );
          }
        }, 60 * 60 * 1000);
      }

      // Nightly KYC refresh — re-runs Companies House KYC for stale/dissolved companies.
      // Runs at 1am every night (production only). Processes up to 40 companies per run.
      if (process.env.NODE_ENV === "production") {
        setInterval(() => {
          const now = new Date();
          if (now.getHours() === 1 && now.getMinutes() < 60) {
            runBatchReKyc({ limit: 40 }).catch(err =>
              console.error("[kyc-refresh] nightly run failed:", err?.message)
            );
          }
        }, 60 * 60 * 1000);
      }

      // Nightly brand-enrichment — tops up stale / never-enriched brand rows.
      // Runs at 4am (once per day, production only to avoid accidental API spend in dev).
      if (process.env.NODE_ENV === "production") {
        setInterval(() => {
          const now = new Date();
          if (now.getHours() === 4 && now.getMinutes() < 60) {
            runNightlyBrandEnrichment().catch(err =>
              console.error("[brand-enrich] nightly run failed:", err?.message)
            );
          }
        }, 60 * 60 * 1000);
      }

      // Daily Brucey Bonuses scan — 06:00 every day. Idempotent via the
      // (event_kind, event_ref) partial unique index, so the rolling 7-day
      // window catches new events without re-awarding old ones. Production
      // only — dev would clobber test data on every restart.
      if (process.env.NODE_ENV === "production") {
        setInterval(() => {
          const now = new Date();
          if (now.getHours() === 6 && now.getMinutes() < 60) {
            import("./hr-routes")
              .then(m => m.runBruceyPointsScan())
              .then(r => console.log(`[brucey-cron] daily scan: ${r.newAwards} new awards from ${r.scannedEvents} events`))
              .catch(err => console.error("[brucey-cron] daily run failed:", err?.message));
          }
        }, 60 * 60 * 1000);

        // Daily benefit renewal sweep — 06:30. Creates a 'Renew {benefit}'
        // task 60 days before each policy's renewal_date so HR has time to
        // re-quote. Idempotent per (benefit, calendar year).
        setInterval(() => {
          const now = new Date();
          if (now.getHours() === 6 && now.getMinutes() >= 30) {
            import("./hr-routes")
              .then(m => m.runBenefitRenewalSweep())
              .then(r => console.log(`[benefit-renewal-cron] created ${r.length} renewal task(s)`))
              .catch(err => console.error("[benefit-renewal-cron] failed:", err?.message));
          }
        }, 60 * 60 * 1000);
      }

      // Weekly client report cron — Monday 09:00 (production only, sends email)
      if (process.env.NODE_ENV === "production") {
        setInterval(() => {
          const now = new Date();
          // getDay(): 0=Sun, 1=Mon
          if (now.getDay() === 1 && now.getHours() === 9 && now.getMinutes() < 60) {
            runWeeklyClientReports().catch(err =>
              console.error("[weekly-report] cron run failed:", err?.message)
            );
          }
          // Fortnightly brand digest — alternating Mondays at 08:00
          // Week-of-year even = send; avoids clashing with weekly client report
          const weekOfYear = Math.ceil((now.getDate() + new Date(now.getFullYear(), now.getMonth(), 1).getDay()) / 7);
          if (now.getDay() === 1 && now.getHours() === 8 && now.getMinutes() < 60 && weekOfYear % 2 === 0) {
            runFortnightlyBrandDigest().catch(err =>
              console.error("[brand-digest] cron run failed:", err?.message)
            );
          }
          // Nightly expansion-fact normalisation — 05:00, between the
          // scraper (04:00) and the trigger scan (07:00) so triggers score
          // off normalised facts. Capped at 25 brands per night.
          if (now.getHours() === 5 && now.getMinutes() < 60) {
            import("./expansion-intel").then(m => m.nightlyNormalisePass()).catch(err =>
              console.error("[expansion-intel] cron run failed:", err?.message)
            );
          }
          // Daily brand-trigger scan — 07:00, after the scraper has run
          if (now.getHours() === 7 && now.getMinutes() < 60) {
            runDailyBrandTriggers().catch(err =>
              console.error("[brand-triggers] cron run failed:", err?.message)
            );
          }
          // Daily brand scraper — 04:00, careers/newsroom probe
          if (now.getHours() === 4 && now.getMinutes() < 60) {
            runDailyBrandScraper().catch(err =>
              console.error("[brand-scraper] cron run failed:", err?.message)
            );
          }
          // Daily PIPnet sync — 05:30. Pulls newly-posted PIPnet requirements
          // AND available properties so the boards/map update themselves when
          // PIPnet puts something new up. Both imports dedup (requirements by
          // normalised brand, properties by folder id), so re-running is safe.
          if (now.getHours() === 5 && now.getMinutes() >= 30) {
            import("./pipnet")
              .then(async (m) => {
                const reqs = await m.importPipnetRequirements({ allPages: true, monthsBack: 3, autoPromote: true }).catch((e: any) => { console.error("[pipnet-cron] requirements failed:", e?.message); return null; });
                if (reqs) console.log(`[pipnet-cron] requirements: ${reqs.imported} imported, ${reqs.promoted} promoted`);
                const props = await m.importPipnetProperties({ allPages: true }).catch((e: any) => { console.error("[pipnet-cron] properties failed:", e?.message); return null; });
                if (props) console.log(`[pipnet-cron] properties: ${props.imported} imported, ${props.withBrochure} with brochure`);
              })
              .catch(err => console.error("[pipnet-cron] run failed:", err?.message));
          }
          // Weekly social scrape — Monday 05:00, Instagram + TikTok follower counts
          if (now.getDay() === 1 && now.getHours() === 5 && now.getMinutes() < 60) {
            runWeeklySocialScrape().catch(err =>
              console.error("[brand-social-scraper] cron run failed:", err?.message)
            );
          }
          // Weekly UK trading entity re-scrape — Sunday 02:00. Re-scrapes
          // every brand with a domain that still has no uk_entity_name.
          // Brands that already have one (auto-scraped or manually set)
          // are left alone. Picks up shop closures / new Shopify rebrands
          // and brands whose T&Cs page was previously bot-blocked.
          if (now.getDay() === 0 && now.getHours() === 2 && now.getMinutes() < 60) {
            import("./brand-entity-rescrape")
              .then(m => m.runWeeklyUkEntityRescrape())
              .then(r => console.log(`[uk-entity-rescrape] weekly: ${r.found}/${r.total} new, ${r.errored} errors`))
              .catch(err => console.error("[uk-entity-rescrape] cron run failed:", err?.message));
          }
          // Weekly accounts auto-fetch — Sunday 03:00, an hour after the
          // entity rescrape so brands that just got their CH number
          // resolved get their accounts pulled in the same week. Idempotent
          // per company: only re-downloads if the latest CH filing's
          // doc_id differs from what we have stored.
          if (now.getDay() === 0 && now.getHours() === 3 && now.getMinutes() < 60) {
            import("./ch-accounts")
              .then(m => m.runBulkAccountsFetch())
              .then(r => console.log(`[ch-accounts] weekly: ${r.downloaded} new / ${r.upToDate} up-to-date / ${r.errored} errors (${r.total} total)`))
              .catch(err => console.error("[ch-accounts] cron run failed:", err?.message));
          }
          // Weekly Instagram-handle backfill — Sunday 04:00. Renders each
          // brand's homepage with JS to catch SPA-injected social links,
          // then falls back to Haiku for brands the scraper can't pick up.
          if (now.getDay() === 0 && now.getHours() === 4 && now.getMinutes() < 60) {
            import("./brand-scraper")
              .then(m => m.backfillInstagramHandles(2000))
              .then(r => console.log(`[ig-backfill] weekly: ${r.filled}/${r.attempted} filled (${r.filledFromHtml} html, ${r.filledFromAi} AI), ${r.skipped} skipped, ${r.errors} errors`))
              .catch(err => console.error("[ig-backfill] cron run failed:", err?.message));
          }
          // Weekly landlord-website scrape — Sunday 05:00. Drills the
          // portfolio / investor / board pages of landlord-shaped companies
          // (render:true), AI-extracts share ticker, IR contact, board,
          // annual report URL, asset list. ~30s/brand throttle, max 50 per
          // run, so worst case ~25 min — well under the budget.
          if (now.getDay() === 0 && now.getHours() === 5 && now.getMinutes() < 60) {
            import("./landlord-scraper")
              .then(m => m.runWeeklyLandlordScrape({ limit: 50 }))
              .then(r => console.log(`[landlord-scrape] weekly: ${r.succeeded}/${r.attempted} ok, ${r.failed} failed`))
              .catch(err => console.error("[landlord-scrape] cron run failed:", err?.message));
          }
          // Monthly Perplexity refresh — 1st of month, 03:00
          if (now.getDate() === 1 && now.getHours() === 3 && now.getMinutes() < 60) {
            runMonthlyPerplexityRefresh().catch(err =>
              console.error("[perplexity-refresh] cron run failed:", err?.message)
            );
          }
        }, 60 * 60 * 1000);
      }
      setTimeout(async () => {
        try {
          const { db } = await import("./db");
          const { sql } = await import("drizzle-orm");
          const addColIfMissing = async (table: string, col: string, colType: string) => {
            const check = await db.execute(sql`
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = ${table} AND column_name = ${col}
            `);
            if ((check as any).rows?.length === 0) {
              console.log(`Adding ${col} to ${table}...`);
              await db.execute(sql.raw(`ALTER TABLE "${table}" ADD COLUMN "${col}" ${colType}`));
            }
          };
          await addColIfMissing("crm_requirements_leasing", "bgp_contact_user_ids", "text[]");
          await addColIfMissing("crm_requirements_investment", "bgp_contact_user_ids", "text[]");
          // Defensive backfill — anything the Drizzle schema declares but prod might be missing.
          // db.select() pulls every declared column; a missing one 500s the route.
          await addColIfMissing("crm_requirements_leasing", "location_data", "text");
          await addColIfMissing("crm_requirements_leasing", "principal_contact_id", "varchar");
          await addColIfMissing("crm_requirements_leasing", "agent_contact_id", "varchar");
          await addColIfMissing("crm_requirements_leasing", "bgp_contact_user_id", "varchar");
          await addColIfMissing("crm_requirements_leasing", "deal_id", "varchar");
          await addColIfMissing("crm_requirements_leasing", "landlord_pack", "text");
          await addColIfMissing("crm_requirements_leasing", "extract", "text");
          await addColIfMissing("crm_requirements_leasing", "comments", "text");
          await addColIfMissing("crm_requirements_leasing", "requirement_date", "text");
          await addColIfMissing("crm_requirements_leasing", "contacted", "boolean");
          await addColIfMissing("crm_requirements_leasing", "details_sent", "boolean");
          await addColIfMissing("crm_requirements_leasing", "viewing", "boolean");
          await addColIfMissing("crm_requirements_leasing", "shortlisted", "boolean");
          await addColIfMissing("crm_requirements_leasing", "under_offer", "boolean");
          await addColIfMissing("crm_requirements_leasing", "sources", "text[]");
          await addColIfMissing("crm_requirements_leasing", "requirement_type", "text[]");
          await addColIfMissing("crm_properties", "website", "text");
          await addColIfMissing("crm_properties", "billing_entity_id", "varchar");
          await addColIfMissing("investment_tracker", "client_id", "varchar");
          await addColIfMissing("investment_tracker", "client_contact_id", "varchar");
          await addColIfMissing("investment_tracker", "vendor_id", "varchar");
          await addColIfMissing("investment_tracker", "vendor_agent_id", "varchar");
          await addColIfMissing("crm_contacts", "last_enriched_at", "timestamp");
          await addColIfMissing("crm_contacts", "enrichment_source", "text");
          await addColIfMissing("crm_companies", "last_enriched_at", "timestamp");
          await addColIfMissing("crm_companies", "enrichment_source", "text");
          await addColIfMissing("users", "additional_teams", "text[]");
          // Drizzle defines users.profile_pic_url but production users
          // table was created before that column existed — any query
          // joining on `u.profile_pic_url` (e.g. property tasks, my-
          // tasks owner display) 500s on prod until this lands.
          await addColIfMissing("users", "profile_pic_url", "text");
          await addColIfMissing("users", "name", "text");
          await addColIfMissing("users", "email", "text");
          await addColIfMissing("users", "team", "text");

          // user_tasks.updated_at — original CREATE TABLE only set
          // created_at + completed_at. Queries that ORDER BY or
          // RETURNING updated_at (e.g. property tasks endpoint) were
          // 500'ing on prod.
          await addColIfMissing("user_tasks", "updated_at", "TIMESTAMP DEFAULT NOW()");

          // crm_interactions.deal_id — added when interactions started
          // linking to deals (for the property asset-brief activity
          // feed + linkage audit). The column was never in the original
          // CREATE TABLE / Drizzle schema, so prod queries that JOIN
          // crm_deals on i.deal_id 500.
          await addColIfMissing("crm_interactions", "deal_id", "varchar");

          // crm_deal_agents — many-to-many between deals and BGP users.
          // The property asset-brief deals feed array_aggs user_ids
          // from this table; if it doesn't exist the whole asset-brief
          // and brief-dependent endpoints (tasks, activity) 500.
          await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS crm_deal_agents (
            deal_id VARCHAR NOT NULL,
            user_id VARCHAR NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            PRIMARY KEY (deal_id, user_id)
          )`));
          await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_crm_deal_agents_deal ON crm_deal_agents (deal_id)`));
          await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_crm_deal_agents_user ON crm_deal_agents (user_id)`));

          // Ensure leasing_schedule_units has all columns added after initial deploy.
          await addColIfMissing("leasing_schedule_units", "rent_pa", "real");
          await addColIfMissing("leasing_schedule_units", "sqft", "real");
          await addColIfMissing("leasing_schedule_units", "financial_notes", "text");
          await addColIfMissing("leasing_schedule_units", "target_company_ids", "text[]");
          await addColIfMissing("leasing_schedule_units", "sort_order", "integer DEFAULT 0");
          // Landsec leasing-tracker alignment — status band drives row colour,
          // meeting_month flags which monthly client meeting this cycle is for.
          await addColIfMissing("leasing_schedule_units", "status_band", "text");
          await addColIfMissing("leasing_schedule_units", "meeting_month", "text");
          await addColIfMissing("leasing_schedule_units", "agent_input", "text");
          await addColIfMissing("leasing_schedule_units", "last_updated_by", "text");
          // FK to the source tenancy_schedule_units row — when set, the
          // Leasing Schedule pulls Existing/expiry/break live from tenancy
          // rather than holding a stale copy.
          await addColIfMissing("leasing_schedule_units", "tenancy_unit_id", "varchar");
          // CRM company link for the Existing tenant — drives the click-through
          // from the Leasing Schedule cell to the brand profile.
          await addColIfMissing("leasing_schedule_units", "tenant_company_id", "varchar");
          // Positioning umbrella group (Landsec Key ii) — e.g. "Everyday
          // Connections" / "Quick Refuel" / "Joyful Gatherings" / "Leisurely
          // Refuel". Drives the filter chips at the top of the schedule.
          await addColIfMissing("leasing_schedule_units", "positioning_group", "text");
          // Per-property Strategic Principles & Priorities (Landsec key block).
          // JSONB: { enabled, fivePriorities[], positioningKey[], rules[], topThree[] }
          await addColIfMissing("crm_properties", "strategic_principles", "jsonb");
          // Tenancy schedule additions from the Landsec Bluewater feed mapping
          // (Earliest Landlord Break / Credit Check Rating / Deposit Held /
          // Total Arrears). Portfolio Asset Manager lives on the property row.
          await addColIfMissing("tenancy_schedule_units", "landlord_break_date", "date");
          await addColIfMissing("tenancy_schedule_units", "credit_rating", "text");
          await addColIfMissing("tenancy_schedule_units", "deposit_held", "real");
          await addColIfMissing("tenancy_schedule_units", "arrears_balance", "real");
          await addColIfMissing("crm_properties", "asset_manager", "text");
          // Per-property BGP staff role (Lead / Investment / Leasing /
          // Letting Surveyor) so the contacts pills don't all look the same.
          await addColIfMissing("crm_property_agents", "role", "text");

          // BGP team org chart per client — see shared/schema.ts
          // crmClientTeamMembers. Loose reporting lines, free-typed team
          // groups; the org chart on the company page reads from here.
          await db.execute(sql.raw(`
            CREATE TABLE IF NOT EXISTS crm_client_team_members (
              id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
              client_company_id varchar NOT NULL,
              user_id varchar NOT NULL,
              team_group text,
              role text,
              reports_to_user_id varchar,
              sort_order integer DEFAULT 0,
              created_at timestamp DEFAULT now(),
              UNIQUE(client_company_id, user_id)
            )
          `));
          await db.execute(sql.raw(`
            CREATE INDEX IF NOT EXISTS idx_crm_client_team_client
              ON crm_client_team_members(client_company_id)
          `));
          // Manual "account lead" pin — the kanban board's apex chip
          // defaults to whoever has the highest property_count, but the
          // team can pin a specific person here so the chip doesn't
          // jump around as property allocations change.
          await addColIfMissing("crm_client_team_members", "is_lead", "boolean DEFAULT false");
          // Drop the UNIQUE(client_company_id, user_id) so the same person
          // can appear in multiple columns on a client (e.g. someone who
          // sits in both Investment and Lease Advisory). The original
          // constraint name from CREATE TABLE is the column-name-suffix
          // form, but we also catch the generic "..._key" pattern just in
          // case Postgres auto-named it differently on this database.
          await db.execute(sql.raw(`
            DO $$
            DECLARE
              cname text;
            BEGIN
              FOR cname IN
                SELECT conname FROM pg_constraint
                 WHERE conrelid = 'crm_client_team_members'::regclass
                   AND contype = 'u'
              LOOP
                EXECUTE format('ALTER TABLE crm_client_team_members DROP CONSTRAINT %I', cname);
              END LOOP;
            EXCEPTION WHEN undefined_table THEN NULL;
            END $$;
          `));
          // Editable column list per client. Members keep their team_group
          // as a free string; this table just holds the visible column
          // ordering and any user-renamed labels so the kanban can render
          // empty columns and remember add/delete actions.
          await db.execute(sql.raw(`
            CREATE TABLE IF NOT EXISTS crm_client_team_columns (
              client_company_id varchar NOT NULL,
              name text NOT NULL,
              sort_order integer NOT NULL DEFAULT 0,
              color_key text,
              created_at timestamp DEFAULT now(),
              PRIMARY KEY (client_company_id, name)
            )
          `));
          // color_key was added after the table — earlier prod deploys
          // got the table without it, which 500s the POST /columns
          // insert path. Idempotent add.
          await addColIfMissing("crm_client_team_columns", "color_key", "text");
          await addColIfMissing("crm_client_team_columns", "created_at", "timestamp DEFAULT now()");
          // One-time seed from legacy data — unnest bgp_contact_user_ids
          // on every company, plus every (property landlord_id × agent
          // user_id) pairing from crm_property_agents. Runs only when the
          // table is empty so it doesn't clobber team edits on restarts.
          const seedCheck = await db.execute(sql.raw(
            "SELECT COUNT(*)::int AS n FROM crm_client_team_members"
          ));
          const seedRowCount = Number((seedCheck as any).rows?.[0]?.n ?? 0);
          if (seedRowCount === 0) {
            // No ON CONFLICT — the UNIQUE constraint was dropped above to
            // allow the same person in multiple columns. DISTINCT keeps
            // intra-statement duplicates out of the seed.
            await db.execute(sql.raw(`
              INSERT INTO crm_client_team_members
                (client_company_id, user_id, team_group)
              SELECT DISTINCT id AS client_company_id,
                     UNNEST(bgp_contact_user_ids) AS user_id,
                     'Unassigned' AS team_group
              FROM crm_companies
              WHERE bgp_contact_user_ids IS NOT NULL
                AND array_length(bgp_contact_user_ids, 1) > 0
            `));
            await db.execute(sql.raw(`
              INSERT INTO crm_client_team_members
                (client_company_id, user_id, team_group)
              SELECT DISTINCT p.landlord_id AS client_company_id,
                     pa.user_id,
                     'Unassigned' AS team_group
              FROM crm_property_agents pa
              JOIN crm_properties p ON p.id = pa.property_id
              WHERE p.landlord_id IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM crm_client_team_members tm
                   WHERE tm.client_company_id = p.landlord_id
                     AND tm.user_id = pa.user_id
                )
            `));
          }
          // Floor-level distinct from Zone — Landsec sheets give the floor
          // code (Floor 100 / 101) as a separate column; the Zone label
          // (Wintergarden / Plaza) is the higher-level grouping.
          await addColIfMissing("tenancy_schedule_units", "floor_level", "text");

          // Tenancy schedule — bring in line with the Landsec investment-grade
          // template. Unit Details / Tenant / Lease / Areas (GIA+NIA splits) /
          // Rental Income / Rates / Occ Costs / Shortfalls / NOI / Comments.
          // `in_leasing_schedule` toggle flags rows that should also surface
          // on the Leasing Schedule view (single source of truth pattern).
          await addColIfMissing("tenancy_schedule_units", "grouping", "text");
          await addColIfMissing("tenancy_schedule_units", "am_initiative", "text");
          await addColIfMissing("tenancy_schedule_units", "tenant_mix", "text");
          await addColIfMissing("tenancy_schedule_units", "break_details", "text");
          // T/L/M chip alongside the break date — Tenant / Landlord / Mutual.
          await addColIfMissing("tenancy_schedule_units", "break_type", "text");
          // break_notice was originally a free-text "notice/note" but is now
          // used as the date by which the break notice has to be served.
          // We leave the existing text values in place (PG accepts text in a
          // date column only if reparseable, so we don't alter type here —
          // the API normalises to date on write).
          await addColIfMissing("tenancy_schedule_units", "break_notice", "text");
          await addColIfMissing("tenancy_schedule_units", "unexpired_term_break", "real");
          await addColIfMissing("tenancy_schedule_units", "next_review_date", "date");
          await addColIfMissing("tenancy_schedule_units", "measurement_type", "text");
          // Per-floor GIA / NIA splits + ITZA
          await addColIfMissing("tenancy_schedule_units", "area_basement_gia", "real");
          await addColIfMissing("tenancy_schedule_units", "area_ground_gia", "real");
          await addColIfMissing("tenancy_schedule_units", "area_first_gia", "real");
          await addColIfMissing("tenancy_schedule_units", "area_other_gia", "real");
          await addColIfMissing("tenancy_schedule_units", "area_basement_nia", "real");
          await addColIfMissing("tenancy_schedule_units", "area_ground_nia", "real");
          await addColIfMissing("tenancy_schedule_units", "area_first_nia", "real");
          await addColIfMissing("tenancy_schedule_units", "area_first_sales_nia", "real");
          await addColIfMissing("tenancy_schedule_units", "area_other_nia", "real");
          await addColIfMissing("tenancy_schedule_units", "area_ground_itza", "real");
          await addColIfMissing("tenancy_schedule_units", "itza_sqft", "real");
          await addColIfMissing("tenancy_schedule_units", "units_applied", "real");
          // Rental income detail
          await addColIfMissing("tenancy_schedule_units", "marketing_rent_pa", "real");
          await addColIfMissing("tenancy_schedule_units", "turnover_rent_payable", "real");
          await addColIfMissing("tenancy_schedule_units", "erv_profile", "text");
          await addColIfMissing("tenancy_schedule_units", "rent_free_value", "real");
          await addColIfMissing("tenancy_schedule_units", "capex_value", "real");
          // Rates
          await addColIfMissing("tenancy_schedule_units", "rateable_value", "real");
          await addColIfMissing("tenancy_schedule_units", "rates_payable", "real");
          // Occupational costs
          await addColIfMissing("tenancy_schedule_units", "service_charge_cap", "real");
          // Shortfalls & NOI
          await addColIfMissing("tenancy_schedule_units", "shortfall_liability", "text");
          await addColIfMissing("tenancy_schedule_units", "rental_shortfalls", "real");
          await addColIfMissing("tenancy_schedule_units", "topped_up_noi", "real");
          // Comments + leasing link-through
          await addColIfMissing("tenancy_schedule_units", "comments", "text");
          await addColIfMissing("tenancy_schedule_units", "leasing_comments", "text");
          await addColIfMissing("tenancy_schedule_units", "target_tenants", "text");
          await addColIfMissing("tenancy_schedule_units", "target_company_ids", "text[]");
          await addColIfMissing("tenancy_schedule_units", "underwriting_comments", "text");
          await addColIfMissing("tenancy_schedule_units", "in_leasing_schedule", "boolean DEFAULT false");
          await addColIfMissing("image_studio_images", "brand_sector", "text");
          // FK into crm_companies for landlord / brand attribution.
          // Lets us query "all images for this landlord" by FK rather
          // than fragile lowercase brand_name matching.
          await addColIfMissing("image_studio_images", "company_id", "varchar");
          await pool.query(`CREATE INDEX IF NOT EXISTS idx_image_studio_company_id ON image_studio_images(company_id) WHERE company_id IS NOT NULL`).catch(() => {});
          // One-shot backfill: any auto-fetched image whose brand_name
          // matches a crm_companies row gets its company_id stamped.
          // Safe to re-run — the WHERE clause skips rows already linked.
          await pool.query(
            `UPDATE image_studio_images i
                SET company_id = c.id
               FROM crm_companies c
              WHERE i.company_id IS NULL
                AND i.brand_name IS NOT NULL
                AND LOWER(TRIM(i.brand_name)) = LOWER(TRIM(c.name))
                AND c.merged_into_id IS NULL`
          ).catch((e: any) => console.warn("[image-studio backfill company_id] failed:", e.message));
          await addColIfMissing("crm_companies", "brand_analysis", "text");
          await addColIfMissing("crm_companies", "brand_analysis_at", "timestamp");
          await addColIfMissing("crm_companies", "concept_status", "text");
          await addColIfMissing("crm_companies", "trading_entities", "jsonb");
          // Canonical brand FK on the tenancy + available-units rows.
          // Populated at write-time by the tenant resolver; the read
          // path joins on this in preference to the soft name match.
          await addColIfMissing("tenancy_schedule_units", "tenant_company_id", "varchar");
          await addColIfMissing("available_units", "tenant_company_id", "varchar");
          // Canonical unit FK — every downstream row (deal, vacant
          // unit, leasing row) should point at a tenancy_schedule row
          // by ID. Stops the unit_name string drift between three
          // overlapping tables. leasing_schedule_units.tenancy_unit_id
          // was added earlier; add to crm_deals + available_units to
          // match. Backfilled by resolveTenancyUnitForRow during
          // import + the property-level adopt buttons.
          await addColIfMissing("crm_deals", "tenancy_unit_id", "varchar");
          await addColIfMissing("available_units", "tenancy_unit_id", "varchar");

          // Auto-track all tenant companies as brands (idempotent).
          await db.execute(sql.raw(`
            UPDATE crm_companies
            SET is_tracked_brand = true
            WHERE is_tracked_brand = false
              AND LOWER(company_type) LIKE '%tenant%'
          `));

          // Clear any negative store counts left over from buggy AI enrichment.
          await db.execute(sql.raw(`UPDATE crm_companies SET store_count = NULL WHERE store_count < 0`));

          // Clear Google News logo image URLs so articles fall back to a newspaper icon.
          await db.execute(sql.raw(`UPDATE news_articles SET image_url = NULL WHERE image_url ~* 'google\\.com|gstatic\\.com|googleusercontent\\.com/.*/proxy'`));

          // Remove duplicate contacts (same name + company_id) keeping the oldest row.
          await db.execute(sql.raw(`
            DELETE FROM crm_contacts
            WHERE id IN (
              SELECT id FROM (
                SELECT id,
                  ROW_NUMBER() OVER (
                    PARTITION BY LOWER(name), company_id
                    ORDER BY created_at ASC
                  ) AS rn
                FROM crm_contacts
                WHERE company_id IS NOT NULL AND name IS NOT NULL
              ) ranked
              WHERE rn > 1
            )
          `));

          await db.execute(sql.raw(`
            UPDATE users SET additional_teams = ARRAY['Landsec']
            WHERE LOWER(email) IN (
              'emily@brucegillinghampollard.com',
              'emilyc@brucegillinghampollard.com',
              'lucyg@brucegillinghampollard.com',
              'luke@brucegillinghampollard.com',
              'rob@brucegillinghampollard.com',
              'tom@brucegillinghampollard.com'
            ) AND (additional_teams IS NULL OR additional_teams = '{}')
          `));

          await db.execute(sql.raw(`
            CREATE TABLE IF NOT EXISTS crm_property_clients (
              id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
              property_id varchar NOT NULL,
              contact_id varchar NOT NULL,
              role text,
              created_at timestamp DEFAULT now(),
              UNIQUE(property_id, contact_id)
            )
          `));

          await db.execute(sql.raw(`
            CREATE TABLE IF NOT EXISTS target_tenants (
              id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
              unit_id varchar NOT NULL,
              property_id varchar NOT NULL,
              company_id varchar,
              brand_name text NOT NULL,
              rationale text,
              quality_rating text NOT NULL DEFAULT 'amber',
              status text NOT NULL DEFAULT 'suggested',
              suggested_by text NOT NULL DEFAULT 'ai',
              approved_by varchar,
              outcome text,
              created_at timestamp DEFAULT now(),
              updated_at timestamp DEFAULT now()
            )
          `));

          await db.execute(sql.raw(`
            CREATE TABLE IF NOT EXISTS kyc_investigations (
              id serial PRIMARY KEY,
              subject_type text NOT NULL,
              subject_name text NOT NULL,
              company_number text,
              crm_company_id varchar,
              officer_name text,
              risk_level text,
              risk_score integer,
              sanctions_match boolean DEFAULT false,
              result jsonb,
              conducted_by varchar,
              conducted_at timestamp DEFAULT now(),
              notes text
            )
          `));
          await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS kyc_investigations_company_number_idx ON kyc_investigations (company_number)`));
          await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS kyc_investigations_crm_company_id_idx ON kyc_investigations (crm_company_id)`));
          await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS kyc_investigations_conducted_at_idx ON kyc_investigations (conducted_at)`));

          await db.execute(sql.raw(`
            CREATE TABLE IF NOT EXISTS kyc_audit_log (
              id serial PRIMARY KEY,
              investigation_id text NOT NULL,
              action text NOT NULL,
              performed_by varchar,
              notes text,
              created_at timestamp DEFAULT now()
            )
          `));

          await db.execute(sql.raw(`
            CREATE TABLE IF NOT EXISTS deal_audit_log (
              id serial PRIMARY KEY,
              deal_id varchar NOT NULL,
              field text NOT NULL,
              old_value text,
              new_value text,
              reason text,
              changed_by varchar,
              changed_by_name varchar,
              created_at timestamp DEFAULT now()
            )
          `));
          await db.execute(sql.raw(`
            CREATE TABLE IF NOT EXISTS file_storage (
              storage_key VARCHAR PRIMARY KEY,
              data BYTEA NOT NULL,
              content_type VARCHAR NOT NULL DEFAULT 'application/octet-stream',
              original_name VARCHAR,
              size INTEGER,
              created_at TIMESTAMP DEFAULT NOW()
            )
          `));
        } catch (err: any) {
          console.error("Startup migration error:", err?.message);
        }

        try {
          const { seedDatabase } = await import("./seed");
          await seedDatabase();
        } catch (err: any) {
          console.error("Seed error:", err);
        }

        // Ensure all team members exist (catches new additions that seed skips)
        try {
          const { pool: dbPool } = await import("./db");
          const { hashPassword } = await import("./auth");
          const newMembers = [
            { username: "johnny@brucegillinghampollard.com", name: "Johnny", email: "johnny@brucegillinghampollard.com" },
            { username: "daisy@brucegillinghampollard.com", name: "Daisy Driscoll", email: "daisy@brucegillinghampollard.com" },
          ];
          for (const m of newMembers) {
            const exists = await dbPool.query(`SELECT 1 FROM users WHERE username = $1 OR email = $2`, [m.username, m.email]);
            if (exists.rows.length === 0) {
              const hashed = await hashPassword("B@nd0077!");
              await dbPool.query(
                `INSERT INTO users (id, username, password, name, email, is_admin) VALUES (gen_random_uuid(), $1, $2, $3, $4, false)`,
                [m.username, hashed, m.name, m.email]
              );
              console.log(`[seed] Created user account: ${m.name} (${m.username})`);
            }
          }
        } catch (err: any) {
          console.error("User creation error:", err?.message);
        }

        // Seed properties if production has fewer than dev
        try {
          const { pool: dbPool } = await import("./db");
          const propCount = await dbPool.query(`SELECT COUNT(*) as cnt FROM crm_properties`);
          if (parseInt(propCount.rows[0].cnt) < 800) {
            const path = await import("path");
            const fsSync = await import("fs");
            const zlib = await import("zlib");
            const seedPaths = [
              path.default.join(process.cwd(), "server", "seed-properties.sql.gz"),
              path.default.join(process.cwd(), "dist", "seed-properties.sql.gz"),
            ];
            const seedPath = seedPaths.find((p) => fsSync.default.existsSync(p));
            if (seedPath) {
              console.log("[seed] Seeding properties from", seedPath);
              const compressed = fsSync.default.readFileSync(seedPath);
              const sqlContent = zlib.default.gunzipSync(compressed).toString("utf-8");
              const statements = sqlContent.split(";\n").filter((s: string) => s.trim().startsWith("INSERT"));
              let seeded = 0;
              for (const stmt of statements) {
                try { await dbPool.query(stmt); seeded++; } catch (_) {}
              }
              console.log(`[seed] Seeded ${seeded} properties`);
            }
          }
        } catch (err: any) {
          console.error("Properties seed error:", err?.message);
        }

        // Seed companies if production has fewer than dev
        try {
          const { pool: dbPool } = await import("./db");
          const compCount = await dbPool.query(`SELECT COUNT(*) as cnt FROM crm_companies`);
          if (parseInt(compCount.rows[0].cnt) < 3600) {
            const path = await import("path");
            const fsSync = await import("fs");
            const zlib = await import("zlib");
            const seedPaths = [
              path.default.join(process.cwd(), "server", "seed-companies.sql.gz"),
              path.default.join(process.cwd(), "dist", "seed-companies.sql.gz"),
            ];
            const seedPath = seedPaths.find((p) => fsSync.default.existsSync(p));
            if (seedPath) {
              console.log("[seed] Seeding companies from", seedPath);
              const compressed = fsSync.default.readFileSync(seedPath);
              const sqlContent = zlib.default.gunzipSync(compressed).toString("utf-8");
              const statements = sqlContent.split(";\n").filter((s: string) => s.trim().startsWith("INSERT"));
              let seeded = 0;
              for (const stmt of statements) {
                try { await dbPool.query(stmt); seeded++; } catch (_) {}
              }
              console.log(`[seed] Seeded ${seeded} companies`);
            }
          }
        } catch (err: any) {
          console.error("Companies seed error:", err?.message);
        }

        // Seed company-property links
        try {
          const { pool: dbPool } = await import("./db");
          const cpCount = await dbPool.query(`SELECT COUNT(*) as cnt FROM crm_company_properties`);
          if (parseInt(cpCount.rows[0].cnt) < 460) {
            const path = await import("path");
            const fsSync = await import("fs");
            const zlib = await import("zlib");
            const seedPaths = [
              path.default.join(process.cwd(), "server", "seed-company-properties.sql.gz"),
              path.default.join(process.cwd(), "dist", "seed-company-properties.sql.gz"),
            ];
            const seedPath = seedPaths.find((p) => fsSync.default.existsSync(p));
            if (seedPath) {
              console.log("[seed] Seeding company-property links from", seedPath);
              const compressed = fsSync.default.readFileSync(seedPath);
              const sqlContent = zlib.default.gunzipSync(compressed).toString("utf-8");
              const statements = sqlContent.split(";\n").filter((s: string) => s.trim().startsWith("INSERT"));
              let seeded = 0;
              for (const stmt of statements) {
                try { await dbPool.query(stmt); seeded++; } catch (_) {}
              }
              console.log(`[seed] Seeded ${seeded} company-property links`);
            }
          }
        } catch (err: any) {
          console.error("Company-property links seed error:", err?.message);
        }

        // Sync deal company/property references from dev
        try {
          const { pool: dbPool } = await import("./db");
          const checkSync = await dbPool.query(`SELECT COUNT(*) as cnt FROM crm_deals WHERE landlord_id = '8f24f46b-77f9-4b32-bb30-63ee1c6cafb7'`);
          if (parseInt(checkSync.rows[0].cnt) < 80) {
            const path = await import("path");
            const fsSync = await import("fs");
            const zlib = await import("zlib");
            const seedPaths = [
              path.default.join(process.cwd(), "server", "seed-deal-links.sql.gz"),
              path.default.join(process.cwd(), "dist", "seed-deal-links.sql.gz"),
            ];
            const seedPath = seedPaths.find((p) => fsSync.default.existsSync(p));
            if (seedPath) {
              console.log("[seed] Syncing deal company/property references from", seedPath);
              const compressed = fsSync.default.readFileSync(seedPath);
              const sqlContent = zlib.default.gunzipSync(compressed).toString("utf-8");
              const statements = sqlContent.split(";\n").filter((s: string) => s.trim().startsWith("UPDATE"));
              let synced = 0;
              for (const stmt of statements) {
                try { await dbPool.query(stmt); synced++; } catch (_) {}
              }
              console.log(`[seed] Synced ${synced} deal references`);
            }
          }
        } catch (err: any) {
          console.error("Deal links sync error:", err?.message);
        }

        // Seed company-deal links
        try {
          const { pool: dbPool } = await import("./db");
          const linkCount = await dbPool.query(`SELECT COUNT(*) as cnt FROM crm_company_deals`);
          if (parseInt(linkCount.rows[0].cnt) < 880) {
            const path = await import("path");
            const fsSync = await import("fs");
            const zlib = await import("zlib");
            const seedPaths = [
              path.default.join(process.cwd(), "server", "seed-company-deals.sql.gz"),
              path.default.join(process.cwd(), "dist", "seed-company-deals.sql.gz"),
            ];
            const seedPath = seedPaths.find((p) => fsSync.default.existsSync(p));
            if (seedPath) {
              console.log("[seed] Seeding company-deal links from", seedPath);
              const compressed = fsSync.default.readFileSync(seedPath);
              const sqlContent = zlib.default.gunzipSync(compressed).toString("utf-8");
              const statements = sqlContent.split(";\n").filter((s: string) => s.trim().startsWith("INSERT"));
              let seeded = 0;
              for (const stmt of statements) {
                try { await dbPool.query(stmt); seeded++; } catch (_) {}
              }
              console.log(`[seed] Seeded ${seeded} company-deal links`);
            }
          }
        } catch (err: any) {
          console.error("Company-deals seed error:", err?.message);
        }

        try {
          const { pool: dbPool } = await import("./db");
          const leasingCount = await dbPool.query(`SELECT COUNT(*) as cnt FROM leasing_schedule_units`);
          if (parseInt(leasingCount.rows[0].cnt) < 500) {
            const path = await import("path");
            const fsSync = await import("fs");
            const zlib = await import("zlib");
            const seedPaths = [
              path.default.join(process.cwd(), "server", "seed-leasing-schedule.sql.gz"),
              path.default.join(process.cwd(), "dist", "seed-leasing-schedule.sql.gz"),
            ];
            const seedPath = seedPaths.find((p) => fsSync.default.existsSync(p));
            if (seedPath) {
              console.log("[seed] Seeding leasing schedule data from", seedPath);
              const compressed = fsSync.default.readFileSync(seedPath);
              const sqlContent = zlib.default.gunzipSync(compressed).toString("utf-8");
              const statements = sqlContent.split(";\n").filter((s: string) => s.trim().startsWith("INSERT"));
              let seeded = 0;
              for (const stmt of statements) {
                try {
                  await dbPool.query(stmt);
                  seeded++;
                } catch (seedErr: any) {
                  /* skip duplicates */
                }
              }
              console.log(`[seed] Seeded ${seeded} leasing schedule units`);
            }
          }
        } catch (err: any) {
          console.error("Leasing schedule seed error:", err?.message);
        }

        try {
          const { pool: dbPool } = await import("./db");
          const dupLandsec = await dbPool.query(`SELECT id FROM crm_companies WHERE LOWER(name) = 'land sec' AND id != '8f24f46b-77f9-4b32-bb30-63ee1c6cafb7'`);
          if (dupLandsec.rows.length > 0) {
            const dupId = dupLandsec.rows[0].id;
            const mainId = '8f24f46b-77f9-4b32-bb30-63ee1c6cafb7';
            const moveDeals = await dbPool.query(`UPDATE crm_deals SET landlord_id = $1 WHERE landlord_id = $2`, [mainId, dupId]);
            const moveContacts = await dbPool.query(`UPDATE crm_contacts SET company_id = $1 WHERE company_id = $2`, [mainId, dupId]);
            const moveProps = await dbPool.query(`UPDATE crm_properties SET landlord_id = $1 WHERE landlord_id = $2`, [mainId, dupId]);
            const moveCompanyDeals = await dbPool.query(`UPDATE crm_company_deals SET company_id = $1 WHERE company_id = $2`, [mainId, dupId]);
            await dbPool.query(`DELETE FROM crm_companies WHERE id = $1`, [dupId]);
            console.log(`[data-merge] Merged duplicate 'Land Sec' (${dupId}) into LandSec: ${moveDeals.rowCount} deals, ${moveContacts.rowCount} contacts, ${moveProps.rowCount} properties, ${moveCompanyDeals.rowCount} company-deal links`);
          }
        } catch (err: any) {
          console.error("[data-merge] Landsec merge error:", err?.message);
        }

        // Status-string normalisation (legacy → canonical) — kept independently
        // of the WIP cleanup that used to live alongside it.
        try {
          const { pool: dbPool } = await import("./db");
          const statusFix1 = await dbPool.query(`UPDATE crm_deals SET status = 'SOLs' WHERE status = 'Solicitors'`);
          const statusFix2 = await dbPool.query(`UPDATE crm_deals SET status = 'Live' WHERE status = 'Active'`);
          if ((statusFix1.rowCount || 0) + (statusFix2.rowCount || 0) > 0) {
            console.log(`[status-fix] Updated ${(statusFix1.rowCount || 0) + (statusFix2.rowCount || 0)} deal statuses`);
          }
        } catch (err: any) {
          console.error("status normalisation error:", err?.message);
        }
        // wip_entries auto-sync removed — Sage imports are retired. The
        // table still holds historic rows for audit; nothing on the live
        // path reads it.
      }, 1000);
    },
  );
})();

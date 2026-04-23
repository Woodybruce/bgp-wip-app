import express, { type Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import dns from "node:dns";

// Railway's default DNS result order prefers IPv6, which silently
// times out against several gov.uk edges (Idox Public Access, etc).
// Force IPv4-first resolution before any outbound fetch runs.
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception — shutting down:", err);
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
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS leasing_privacy_enabled BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS sharepoint_folder_url TEXT`,
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
    `ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'sharepoint'`,
    // Drop the legacy index that may have been created with a non-IMMUTABLE
    // expression (array_to_string was STABLE in Postgres <14). We rebuild it
    // below without the ai_tags piece so it's IMMUTABLE on every version.
    `DROP INDEX IF EXISTS knowledge_base_search_idx`,
    `CREATE INDEX IF NOT EXISTS knowledge_base_search_idx ON knowledge_base USING GIN (to_tsvector('english', coalesce(file_name,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(content,'') || ' ' || coalesce(category,'')))`,
    `CREATE INDEX IF NOT EXISTS knowledge_base_source_idx ON knowledge_base (source)`,
    `CREATE INDEX IF NOT EXISTS knowledge_base_category_idx ON knowledge_base (category)`,
    `CREATE INDEX IF NOT EXISTS chat_messages_content_search_idx ON chat_messages USING GIN (to_tsvector('english', coalesce(content,'')))`,
    `CREATE TABLE IF NOT EXISTS user_tasks (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), user_id VARCHAR NOT NULL, title TEXT NOT NULL, description TEXT, due_date TIMESTAMP, priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'todo', category TEXT, linked_deal_id VARCHAR, linked_property_id VARCHAR, linked_contact_id VARCHAR, sort_order INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT now(), completed_at TIMESTAMP)`,
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
    `CREATE TABLE IF NOT EXISTS kyc_investigations (id SERIAL PRIMARY KEY, subject_type TEXT NOT NULL, subject_name TEXT NOT NULL, company_number TEXT, crm_company_id VARCHAR, officer_name TEXT, risk_level TEXT, risk_score INTEGER, sanctions_match BOOLEAN DEFAULT false, result JSONB, conducted_by VARCHAR, conducted_at TIMESTAMP DEFAULT now(), notes TEXT)`,
    `CREATE INDEX IF NOT EXISTS kyc_investigations_company_number_idx ON kyc_investigations (company_number)`,
    `CREATE INDEX IF NOT EXISTS kyc_investigations_crm_company_id_idx ON kyc_investigations (crm_company_id)`,
    `CREATE INDEX IF NOT EXISTS kyc_investigations_conducted_at_idx ON kyc_investigations (conducted_at)`,
    `CREATE TABLE IF NOT EXISTS kyc_audit_log (id SERIAL PRIMARY KEY, investigation_id INTEGER NOT NULL, action TEXT NOT NULL, performed_by VARCHAR, notes TEXT, created_at TIMESTAMP DEFAULT now())`,
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
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS kyc_expires_at TIMESTAMP`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_checklist JSONB`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_risk_level TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_pep_status TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_source_of_wealth TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_source_of_wealth_notes TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_edd_required BOOLEAN DEFAULT false`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_edd_reason TEXT`,
    `ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS aml_notes TEXT`,
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
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS completion_target_date TIMESTAMP`,
    `ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS solicitor_notes TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals(stage) WHERE stage IS NOT NULL`,

    // available_units: link to leasing schedule unit
    `ALTER TABLE available_units ADD COLUMN IF NOT EXISTS leasing_schedule_unit_id VARCHAR`,
    `CREATE INDEX IF NOT EXISTS idx_available_units_leasing_schedule_unit_id ON available_units(leasing_schedule_unit_id) WHERE leasing_schedule_unit_id IS NOT NULL`,

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
    `CREATE INDEX IF NOT EXISTS idx_crm_companies_merged_into ON crm_companies(merged_into_id) WHERE merged_into_id IS NOT NULL`,

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
})();
import { setupAuth } from "./auth";
import { setupMicrosoftRoutes } from "./microsoft";
import { setupWhatsAppRoutes } from "./whatsapp";
import { setupChatBGPRoutes } from "./chatbgp";
import { setupNewsIntelligenceRoutes } from "./news-intelligence";
import { setupNewsFeedRoutes } from "./news-feeds";
import { setupModelsRoutes } from "./models";
import { setupDocumentTemplateRoutes } from "./document-templates";
import { setupCanvaRoutes } from "./canva";
import { setupXeroRoutes } from "./xero";
import { setupEvernoteRoutes } from "./evernote";
import { registerLandRegistryRoutes } from "./land-registry";
// Simple request queue for AI endpoints
const activeRequests = new Set<string>();
const requestQueue: Array<{ req: Request; res: Response; next: NextFunction }> = [];
const MAX_CONCURRENT_AI_REQUESTS = 3;
import { registerVoaRoutes, startVoaAutoImport } from "./voa";
import { registerLegalDDRoutes } from "./legal-dd";
import { setupSharedMailboxRoutes } from "./shared-mailbox";
import { registerInteractionRoutes } from "./interactions";
import { setupCrmRoutes, startAutoEnrichment, startAutoTurnoverResearch } from "./crm";
import companiesHouseRouter from "./companies-house";
import { registerPropertyPathwayRoutes } from "./property-pathway";
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
import apolloContactsRouter from "./apollo-contacts";
import rocketreachContactsRouter, { rocketreachHealth } from "./rocketreach-contacts";
import { experianHealth, fetchCommercialCredit, isExperianConfigured } from "./experian";
import propertyGapAnalysisRouter from "./property-gap-analysis";
import brandPackRouter from "./brand-pack";
import dealDocsRouter from "./deal-docs";
import weeklyReportRouter, { runWeeklyClientReports } from "./weekly-report";
import dealStagesRouter from "./deal-stages";
import leasingPitchRouter from "./leasing-pitch";
import cadRouter from "./cad";
import leasingScheduleRouter from "./leasing-schedule";
import tenancyScheduleRouter from "./tenancy-schedule";
import turnoverRouter from "./turnover";
import { serveStatic } from "./static";
import { registerEmailProcessorRoutes, startEmailProcessor } from "./email-processor";
import { registerHealthCheckRoutes, startHealthCheck } from "./health-check";
import { setupArchivistRoutes, startArchivist } from "./archivist";
import { registerAIIntelligenceRoutes } from "./ai-intelligence";
import { setupLeadsRoutes } from "./leads";
import { registerMcpRoutes } from "./mcp-server";
import { setupWebSocket } from "./websocket";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

// Railway health check — unauthenticated, before all middleware
app.get("/api/ping", (_req, res) => res.json({ status: "ok" }));

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

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const p = req.originalUrl || req.path;
    return (
      p.startsWith("/api/chat") ||
      p.startsWith("/api/ai/") ||
      p.startsWith("/api/chatbgp")
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
  setupMicrosoftRoutes(app);
  setupWhatsAppRoutes(app);
  setupChatBGPRoutes(app);
  setupArchivistRoutes(app);
  setupNewsIntelligenceRoutes(app);
  setupNewsFeedRoutes(app);
  setupModelsRoutes(app);
  setupDocumentTemplateRoutes(app);
  setupCanvaRoutes(app);
  setupXeroRoutes(app);
  setupEvernoteRoutes(app);
  registerLandRegistryRoutes(app);
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

  registerEmailProcessorRoutes(app);
  registerHealthCheckRoutes(app);
  registerAIIntelligenceRoutes(app);
  setupLeadsRoutes(app);
  registerMcpRoutes(app);
  setupCrmRoutes(app);
  app.use(companiesHouseRouter);
  registerPropertyPathwayRoutes(app);
  registerRetailContextPlanRoutes(app);
  registerMapLayerRoutes(app);
  app.use(leasingScheduleRouter);
  app.use(tenancyScheduleRouter);
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
  app.use(apolloContactsRouter);
  app.use(rocketreachContactsRouter);

  // Health + lookup endpoints for the two new data providers.
  app.get("/api/rocketreach/health", async (_req, res) => {
    res.json(await rocketreachHealth());
  });
  app.get("/api/experian/health", async (_req, res) => {
    res.json(await experianHealth());
  });
  app.post("/api/experian/credit-report", async (req, res) => {
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
  app.use(propertyGapAnalysisRouter);
  app.use(brandPackRouter);
  app.use(dealDocsRouter);
  app.use(weeklyReportRouter);
  app.use(dealStagesRouter);
  app.use(leasingPitchRouter);
  app.use(cadRouter);

  await registerRoutes(httpServer, app);
  setupWebSocket(httpServer);

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
      host: "::",
    },
    () => {
      log(`serving on port ${port}`);
      // startEmailProcessor(); // DISABLED - maintenance mode
      setTimeout(() => startHealthCheck(), 10000);
      // Background crawls only run in production — too slow/fragile over local internet
      const isProduction = process.env.NODE_ENV === "production";
      if (isProduction) {
        setTimeout(() => startAutoEnrichment(), 30000);
        setTimeout(() => startAutoTurnoverResearch(), 30000);
        setTimeout(async () => {
          try {
            const { startImageSync } = await import("./image-studio");
            startImageSync();
          } catch (e: any) {
            console.error("[image-sync] Failed to start:", e.message);
          }
        }, 60000);
        setTimeout(() => startArchivist(), 300000);
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

          // Ensure leasing_schedule_units has all columns added after initial deploy.
          await addColIfMissing("leasing_schedule_units", "rent_pa", "real");
          await addColIfMissing("leasing_schedule_units", "sqft", "real");
          await addColIfMissing("leasing_schedule_units", "financial_notes", "text");
          await addColIfMissing("leasing_schedule_units", "target_company_ids", "text[]");
          await addColIfMissing("leasing_schedule_units", "sort_order", "integer DEFAULT 0");
          await addColIfMissing("image_studio_images", "brand_sector", "text");

          // Auto-track all tenant companies as brands (idempotent).
          await db.execute(sql.raw(`
            UPDATE crm_companies
            SET is_tracked_brand = true
            WHERE is_tracked_brand = false
              AND LOWER(company_type) LIKE '%tenant%'
          `));

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
              investigation_id integer NOT NULL,
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

        try {
          const { pool: dbPool } = await import("./db");
          const junkDel = await dbPool.query(`DELETE FROM wip_entries WHERE (ref = 'Total' OR ref LIKE 'Applied filters%') OR (deal_status IS NULL AND group_name IS NULL AND project IS NULL)`);
          if (junkDel.rowCount && junkDel.rowCount > 0) {
            console.log(`[wip-cleanup] Removed ${junkDel.rowCount} junk WIP rows`);
          }
          const statusFix1 = await dbPool.query(`UPDATE crm_deals SET status = 'SOLs' WHERE status = 'Solicitors'`);
          const statusFix2 = await dbPool.query(`UPDATE crm_deals SET status = 'Live' WHERE status = 'Active'`);
          if ((statusFix1.rowCount || 0) + (statusFix2.rowCount || 0) > 0) {
            console.log(`[status-fix] Updated ${(statusFix1.rowCount || 0) + (statusFix2.rowCount || 0)} deal statuses`);
          }
        } catch (err: any) {
          console.error("WIP cleanup error:", err?.message);
        }

        try {
          const { pool: dbPool } = await import("./db");
          const { rows: wipCount } = await dbPool.query(`SELECT COUNT(*) as c FROM wip_entries`);
          const { rows: dealCount } = await dbPool.query(`SELECT COUNT(*) as c FROM crm_deals`);
          if (parseInt(wipCount[0]?.c || "0") > 0 && parseInt(dealCount[0]?.c || "0") === 0) {
            console.log(`[wip-sync] WIP entries found but no CRM deals — running auto-sync...`);
            const { syncWipToCrmDeals } = await import("./crm");
            await syncWipToCrmDeals(dbPool);
            console.log(`[wip-sync] Auto-sync complete`);
          }
        } catch (err: any) {
          console.error("[wip-sync] error:", err?.message);
        }
      }, 1000);
    },
  );
})();

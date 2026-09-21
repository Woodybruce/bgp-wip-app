-- Migration 0046 — Canonical per-entity KYC (Delivery 5, Task 1)
--
-- crm_entity_kyc is the canonical per-entity KYC state, keyed by entity
-- kind + id (crm_companies.id | crm_trading_entities.id). It starts NULL —
-- brand-level crm_companies.kyc_* is NOT copied in; the group view reads
-- brand state live from crm_companies for entity_kind='company' rows with
-- no crm_entity_kyc row yet, and renders it as the brand's own status,
-- never as evidence about children. The deprecated
-- crm_trading_entities.kyc_* columns stay untouched (drop is a future,
-- separate migration).
--
-- The kyc_audit_log entity columns let the existing audit trail record
-- entity-level actions without inventing a parallel log.
-- All additive, idempotent.

CREATE TABLE IF NOT EXISTS crm_entity_kyc (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_kind text NOT NULL,              -- company | trading_entity
  entity_id text NOT NULL,                -- crm_companies.id | crm_trading_entities.id
  kyc_status text NOT NULL DEFAULT 'pending',  -- pending | in_review | approved | rejected | expired
  checked_at timestamptz,
  approved_by text,                       -- reviewer NAME, same representation as crm_companies.kyc_approved_by
  approved_at timestamptz,
  expires_at timestamptz,
  next_review_at timestamptz,
  outstanding jsonb,                      -- [{key, label, since}] — unchecked checklist items / missing evidence
  evidence jsonb,                         -- {investigation_id?, sanctions?, companies_house?, notes?}
  last_check_job_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_entity_kyc_entity ON crm_entity_kyc(entity_kind, entity_id);

ALTER TABLE kyc_audit_log
  ADD COLUMN IF NOT EXISTS entity_kind text,
  ADD COLUMN IF NOT EXISTS entity_id text;

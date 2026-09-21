-- Migration 0042 — Entity graph lookup indexes (Delivery 2)
--
-- crm_companies.parent_company_id and crm_trading_entities.parent_company_id
-- already exist; the account resolver walks them to build the confirmed
-- entity tree. This migration only adds the lookup indexes that walk needs.
-- All additive, idempotent.

CREATE INDEX IF NOT EXISTS idx_crm_companies_parent ON crm_companies(parent_company_id);
CREATE INDEX IF NOT EXISTS idx_crm_trading_entities_parent ON crm_trading_entities(parent_company_id);
CREATE INDEX IF NOT EXISTS idx_crm_properties_freeholder ON crm_properties(freeholder_id);
CREATE INDEX IF NOT EXISTS idx_crm_properties_long_leaseholder ON crm_properties(long_leaseholder_id);

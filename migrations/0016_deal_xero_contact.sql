-- Migration 0016 — Xero contact becomes source of truth for deal billing
--
-- Previously, each crm_deal pointed at an internal crm_companies row via
-- invoicing_entity_id. That gave us a "billing entity" inside the app —
-- but it diverged from Xero (which the finance team treats as the
-- authoritative ledger). Two sources of truth, recurring confusion.
--
-- After this migration: each deal points at a Xero contact directly via
-- xero_contact_id. We also cache name/account-number/billing-address from
-- Xero so the deal list and invoice form can render without an extra
-- round-trip to Xero on every load.
--
-- Historical invoices in xero_invoices keep their own invoicing_entity_id
-- column untouched (they remember what entity was used at the time).

ALTER TABLE crm_deals
  ADD COLUMN IF NOT EXISTS xero_contact_id      TEXT,
  ADD COLUMN IF NOT EXISTS xero_contact_name    TEXT,
  ADD COLUMN IF NOT EXISTS xero_account_number  TEXT,
  ADD COLUMN IF NOT EXISTS xero_billing_address JSONB;

ALTER TABLE crm_deals
  DROP COLUMN IF EXISTS invoicing_entity_id;

CREATE INDEX IF NOT EXISTS crm_deals_xero_contact_id_idx
  ON crm_deals (xero_contact_id)
  WHERE xero_contact_id IS NOT NULL;

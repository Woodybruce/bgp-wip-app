-- Migration 0047 — Deal contracting entities + shadow gate log (Delivery 5, Task 1)
--
-- crm_deal_entities links a deal's counterparty roles to LEGAL entities
-- (crm_companies.id | crm_trading_entities.id), populated manually / by
-- reviewed linking — never from Xero (Xero ContactIDs are billing
-- identifiers, not legal-entity FKs). aml_shadow_gate_runs stores the
-- shadow comparison snapshots (current brand-level gate outcome vs the
-- proposed entity-aware outcome). NOTHING here is read by any gate:
-- checkCounterpartyAml stays byte-identical; flipping the live gate is a
-- post-Delivery-5 decision with the shadow report as its evidence.
-- All additive, idempotent.

CREATE TABLE IF NOT EXISTS crm_deal_entities (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id varchar NOT NULL,
  role text NOT NULL,                     -- landlord | tenant | vendor | purchaser
  entity_kind text NOT NULL,              -- company | trading_entity
  entity_id text NOT NULL,
  link_source text NOT NULL DEFAULT 'manual',  -- manual | migration — never 'xero'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_deal_entities_role
  ON crm_deal_entities(deal_id, role, entity_kind, entity_id);

CREATE TABLE IF NOT EXISTS aml_shadow_gate_runs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by text,
  rows jsonb NOT NULL                     -- per deal: current gate outcome vs proposed entity-aware outcome + diff reason
);

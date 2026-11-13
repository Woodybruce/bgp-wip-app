-- The company on the lease (Woody, 2026-11-13): a crm_trading_entities.id under the
-- row's brand (tenant_company_id). NOT crm_deals.tenant_entity_id, which is a Xero
-- ContactID. Written only by server/tenancy-tenant.ts (a person's action) and the admin
-- Preview-then-Apply back-fill in server/tenant-entity-backfill.ts. Safe to run again.
ALTER TABLE tenancy_schedule_units ADD COLUMN IF NOT EXISTS tenant_entity_id varchar;
CREATE INDEX IF NOT EXISTS tenancy_schedule_units_tenant_entity_idx
  ON tenancy_schedule_units (tenant_entity_id) WHERE tenant_entity_id IS NOT NULL;

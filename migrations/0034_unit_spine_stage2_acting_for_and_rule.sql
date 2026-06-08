-- Migration 0034 — Unit spine (Stage 2, part 2): bgp_acting_for + one-live-deal rule
--
-- Adds the landlord/tenant axis to crm_deals — distinguishing agency work
-- (BGP represents the landlord, deal goes on the Letting Tracker) from
-- acquisition work (BGP represents the tenant, deal stays in the CRM but
-- shouldn't clutter the marketing board). Same property + spine + AML
-- machinery for both; only the Tracker filter differs (UI change, not here).
--
-- Then adds the partial unique index that enforces "one live LANDLORD-REP
-- deal per tenancy unit". Tenant-rep deals are deliberately exempt —
-- multiple tenant-rep deals on the same building/unit are normal (we may
-- represent two different tenants chasing space in the same building).
--
-- Pre-fix: two known Google tenant-rep deals are currently flagged as
-- landlord (the default). Without flipping them, the unique index would
-- fail to create. They are fixed by this migration BEFORE the index is added.
--
-- Reversibility: DROP INDEX, ALTER TABLE ... DROP COLUMN. Data loss = zero
-- (we don't change tenancy_unit_id or status on the Google deals — only the
-- bgp_acting_for flag).

-- 1. Add the flag (default landlord — historical assumption).
ALTER TABLE crm_deals
  ADD COLUMN IF NOT EXISTS bgp_acting_for TEXT DEFAULT 'landlord';

-- 2. Flag the two known tenant-rep deals on the shared Google tenancy row.
--    (Beauty Pie + Ronning Menswear, both tenant-rep acquisitions.)
UPDATE crm_deals SET bgp_acting_for = 'tenant'
WHERE id IN (
  '57ddb5a8-dc9a-46b0-9100-6de37f3fe257',  -- Google - Beauty Pie
  'aaed1958-cf83-4ac8-b05b-1b67ee677025'   -- Google Ground Floor - Ronning Menswear
);

-- 3. Enforce one live landlord-rep deal per tenancy unit.
--    Scoped tightly so it never fires on tenant-rep deals or null-spine deals.
CREATE UNIQUE INDEX IF NOT EXISTS crm_deals_one_live_landlord_per_unit_idx
  ON crm_deals (tenancy_unit_id)
  WHERE tenancy_unit_id IS NOT NULL
    AND bgp_acting_for = 'landlord'
    AND status NOT IN ('Completed','Invoiced','Withdrawn','COM','INV','WIT');

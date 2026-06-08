-- Migration 0032 — Unit spine (Stage 1, additive)
--
-- This is Stage 1 of the unit-spine cleanup. The goal of the wider work is to
-- end the duplication of facts across property_units, tenancy_schedule_units,
-- available_units, leasing_schedule_units and crm_deals — by making each fact
-- live on exactly one table, with the others reading through a single set of
-- "child → spine" links.
--
-- Decisions locked (see docs/target-structure.md):
--   1. Marketing rows reach physical via the spine, not directly.
--   2. Floor areas (NIA/GIA/ITZA) are PHYSICAL facts, owned by property_units.
--   3. Deals can legitimately be building/portfolio-level — flagged, not
--      forced into a fake unit link.
--   4. Only one live deal per unit, enforced by DB rule.
--
-- THIS MIGRATION IS STRICTLY ADDITIVE. Nothing is renamed, dropped, moved or
-- back-filled. Existing code continues to read/write the legacy columns
-- exactly as before. The new columns sit alongside, ready for Stage 2+ to
-- start populating and reading.
--
-- What we add:
--   tenancy_schedule_units
--     + property_unit_id   varchar  (FK → property_units.id) — the missing
--                                    physical link the two-layer spine needs.
--     + occupancy_status   text     — separated from deal status; one of
--                                    Vacant | Trading | Holding Over |
--                                    Lease Event Pending | Archived
--     + marketing_active   boolean  — drives Tracker/Leasing visibility,
--                                    independent of occupancy.
--     + marketing_reason   text     — Vacant | Lease Event | Tenant at Risk |
--                                    Active Management (free-text-ish; we
--                                    don't enum-constrain at the DB layer
--                                    yet, in case the vocab evolves).
--
--   crm_deals
--     + deal_scope         text default 'unit'  — 'unit' | 'building' |
--                                    'portfolio'. Building/portfolio-level
--                                    deals (investment acquisitions,
--                                    consultancy mandates, etc.) keep
--                                    tenancy_unit_id NULL by design rather
--                                    than via a fake link.
--
-- What we do NOT do here (later stages):
--   - Back-fill property_unit_id (needs Stage 2 reconciliation work; current
--     gate shows 0 name-matches, so it's a manual/heuristic job).
--   - Back-fill occupancy / marketing_active from existing status (Stage 2).
--   - Add the partial unique index enforcing "one live deal per unit"
--     (Stage 2 — needs the existing single violation cleared first, else
--     index creation will fail).
--   - Drop the legacy status column, back-pointers, or duplicated physical
--     fields (Stage 5/6, only after read-through proven).
--
-- Reversibility: every change uses IF NOT EXISTS. To roll back, drop the
-- four new columns and the one new index — no data conversion needed because
-- nothing has been populated yet.

-- ---------------------------------------------------------------------------
-- tenancy_schedule_units: physical link + occupancy/marketing axis
-- ---------------------------------------------------------------------------

ALTER TABLE tenancy_schedule_units
  ADD COLUMN IF NOT EXISTS property_unit_id  VARCHAR,
  ADD COLUMN IF NOT EXISTS occupancy_status  TEXT,
  ADD COLUMN IF NOT EXISTS marketing_active  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketing_reason  TEXT;

-- Index for spine-up lookups (tenancy row → its physical master).
-- NULL today on every row; partial index keeps it lean until back-fill.
CREATE INDEX IF NOT EXISTS tenancy_schedule_units_property_unit_id_idx
  ON tenancy_schedule_units (property_unit_id)
  WHERE property_unit_id IS NOT NULL;

-- Filter index for "show me the marketed units" — the main Tracker/Leasing query.
CREATE INDEX IF NOT EXISTS tenancy_schedule_units_marketing_active_idx
  ON tenancy_schedule_units (marketing_active)
  WHERE marketing_active = TRUE;

-- ---------------------------------------------------------------------------
-- crm_deals: scope flag for building/portfolio deals
-- ---------------------------------------------------------------------------

ALTER TABLE crm_deals
  ADD COLUMN IF NOT EXISTS deal_scope TEXT DEFAULT 'unit';

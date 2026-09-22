-- Migration 0045 — Account folder map (Delivery 5, Task 1)
--
-- The ONE durable account→folder mapping for the standard client folder
-- tree. Keyed by CRM identity (owner_kind + owner_id + logical_key), storing
-- Graph IDs (drive_id + item_id) — paths and webUrls are display caches
-- refreshed on write, never identity. A SharePoint folder maps to at most
-- one logical node regardless of its current name (uq_account_folder_map_item),
-- which is the rename/duplicate-name answer. bind_status='conflict' records
-- "two physical folders claim one logical node" for human resolution.
-- All additive, idempotent.

CREATE TABLE IF NOT EXISTS account_folder_map (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind text NOT NULL,               -- company | entity | property | section
  owner_id text NOT NULL,                 -- crm_companies.id | crm_trading_entities.id | crm_properties.id
  parent_map_id varchar,                  -- nesting within the logical tree (NULL at the client root)
  logical_key text NOT NULL,              -- e.g. 'root' | '01-client-relationship' | '02-group-legal-entities' | '03-properties' | 'property' | 'property:01-instructions' …
  display_name text NOT NULL,             -- folder label at bind/create time (entity folders: "<name> — <registration ID>"; property folders: "<name> — <property id suffix>")
  drive_id text NOT NULL,
  item_id text NOT NULL,
  cached_path text,                       -- display cache only — re-derived on bind; never used for identity
  web_url text,
  bind_status text NOT NULL DEFAULT 'bound',  -- bound | created | missing | conflict
  bound_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_folder_map_owner_key
  ON account_folder_map(owner_kind, owner_id, logical_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_folder_map_item
  ON account_folder_map(drive_id, item_id);
CREATE INDEX IF NOT EXISTS idx_account_folder_map_owner ON account_folder_map(owner_kind, owner_id);

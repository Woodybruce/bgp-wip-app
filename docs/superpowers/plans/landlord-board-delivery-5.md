# Landlord/client boards — Delivery 5: standard client folder tree + entity-level KYC

Source: "BGP landlord and client boards — implementation plan" (2026-09-20), Delivery 5 only.
Codebase: bgp-wip-app, post Delivery 1 + 2 + 3 (migrations 0041–0044 applied; resolver, reconciliation, account deals/workspace live) and parallel to Delivery 4 (preparation pipeline/media — different scope, do not touch).

Delivery 5 scope (from the master plan):
- **A. Standard client folder tree (SharePoint).** One durable account→folder mapping (drive ID + folder ID, not paths); upload-to-current-folder behaviour; complete pagination; idempotent + resumable setup jobs that survive restart/throttling/partial failure; duplicate property names and renamed folders keep correct records. Logical tree: `Client / 01 Client & relationship / 02 Group & legal entities / [entity — registration ID] / KYC & onboarding… / 03 Properties / [Property — stable property ID] / 01 Instructions & appointments … 99 Archive / 04 Media library / 05 Investment strategy / 06 Commercial — restricted / 99 Archive`. Bind existing physical roots FIRST — no bulk moving/recreating today's folders. Rollout starts with an inventory/dry-run mapping report, then creates only genuinely missing folders within authorised locations. Never broaden access by moving restricted documents into a shared client root.
- **B. Entity-level KYC.** Reconcile child companies, the `trading_entities` jsonb and the `crm_trading_entities` table into one canonical group/entity view incl. nested SPVs/JVs. Per-entity check status, approval/reviewer, evidence, expiry, outstanding items, next review. Group summary "X of Y entities current" must never hide unchecked/expired children; never copy a parent approval onto a child. Start individual check jobs from a group action with per-entity outcomes and progress. Xero entity/contact IDs are billing identifiers, NOT legal-entity FKs. Contracting-entity links only behind a shadow comparison — no live deal-gate change.

Acceptance gates (from the master plan):
- More than 200 items remain navigable (complete pagination).
- Same-name properties resolve correctly (stable IDs, not names).
- No duplicate folder trees after retry/restart.
- Approved parent + unchecked child is visibly incomplete in the UI.
- Shadow comparison report exists before any deal-gate logic changes.

## Global Constraints

- Migrations ARE in scope. Every change is a separate, reviewable file under `migrations/`, numbered from `0045` (head is `0044_reconciliation.sql`; note a legacy `0041_crm_interviews.sql` shares the 0041 number — ignore it, do not renumber). Each new file must ALSO be mirrored as statements in the boot-time `MIGRATIONS` array (`server/index.ts:45`, tail at ~`:2648-2650`) AND appended to `IDEMPOTENT_SQL_MIGRATIONS` (`server/schema-drift.ts:36-41`) — that list is what the `--migrate-only` phase of `script/build.ts:160-170` applies, and what `applyIdempotentSqlMigrations` re-applies at boot. All additive, all nullable, all `IF NOT EXISTS`. (`healSchemaDrift`, `server/schema-drift.ts:110-126`, auto-adds missing columns for existing tables but deliberately never CREATEs tables — new tables need the migration file.)
- Do NOT silently reinterpret existing fields. `crm_companies.kyc_*`, `crm_trading_entities.kyc_*` (deprecated, `shared/schema.ts:1499-1512`) and the `trading_entities` jsonb (`shared/schema.ts:510`) keep their current meaning; canonical per-entity KYC starts NULL in a new table. No bulk data rewrites; no backfill of approvals.
- Permissions never widen. `resolveCompanyScope(req)` flows into every new read endpoint exactly as in Deliveries 2/3; the SharePoint client jail (`server/client-sharepoint.ts:89-96`) keeps its exact semantics; folder creation only ever happens inside the already-authorised client root; `06 Commercial — restricted` is created as an empty folder — documents are NEVER moved into or out of it by this delivery.
- Deal gates are frozen. `checkCounterpartyAml` (`server/deal-gates.ts:29`) and every call site (`server/crm.ts:2748`, PUT `/api/crm/deals/:id`, deal-stages) stay byte-identical in behaviour. Entity-aware gating is a shadow comparison only.
- Xero IDs are billing identifiers. `crm_deals.landlord_entity_id` / `tenant_entity_id` / `vendor_entity_id` / `purchaser_entity_id` (`shared/schema.ts:896-902`) are Xero ContactID GUIDs (`server/deal-gates.ts:5-12`); `xero_contact_id` etc. (`shared/schema.ts:947-953`) likewise. Never join them to `crm_trading_entities` or any legal entity.
- Match existing code style: TypeScript, raw SQL via `pool.query`, lazy pool + `deps.pool` injection for tests, node:test via tsx (`node --import tsx --test <file>`). Typecheck: `npm run check`. No new npm dependencies. One commit per task; the implementer commits its own work. Do NOT push, deploy, or touch any database.

## Current-state findings (verified against the tree)

### A. SharePoint folders

- **Two folder-root conventions coexist.** (1) Team-rooted path synthesis: `BGP share drive/{team}/{propertyName}` built in `GET /api/microsoft/property-folders/:team/:propertyName` (`server/microsoft.ts:2969`) and in `POST /api/microsoft/property-folders` (`:2553-2556`), rooted at `SHAREPOINT_ROOT_FOLDER = "BGP share drive"` (`:29`) with per-team templates `TEAM_FOLDER_TREES` (`:2253-2442`). (2) Client-rooted: `BGP share drive/{ClientName}/{PropertyName}` built by `POST /api/microsoft/client-folders` (`:2745-2746`), plus a third `BGP share drive/Companies/{companyName}` variant (`:2628-2636`). Stored-URL overrides exist on both `crm_properties.sharepoint_folder_url` (`shared/schema.ts:796`, preferred at `server/microsoft.ts:2919`) and `crm_companies.sharepoint_folder_url` (`shared/schema.ts:2845`, the client jail root, `server/client-sharepoint.ts:44-75`).
- **Pagination is already complete.** Delivery 1's `listAllChildren` (`server/microsoft-graph-pagination.ts:33`) follows `@odata.nextLink` with a 50-page cap and is used by every CRM drive-item listing found: staff property folders (`server/microsoft.ts:2945`, `:2977`), company browse (`:3091`), the generic files list (`:579`), and the client jail list (`server/client-sharepoint.ts:126-129`). Delivery 5's gate (>200 items navigable) is a *verification* of this coverage, not a rebuild.
- **Upload-to-current-folder is already fixed.** `resolveUploadDestination` (`server/microsoft-graph-pagination.ts:79`) makes a selected folder with missing IDs a 4xx, never a silent root upload (`server/microsoft.ts:3142-3169`); the client sends the browsed folder's `driveId`+`currentItemId` (`client/src/pages/properties.tsx:1758-1773`).
- **Property identity is still name-based in the folder features that remain.** `POST /api/microsoft/client-folders` resolves the portfolio as `SELECT DISTINCT p.name …` (`server/microsoft.ts:2731-2739`) — two same-named properties collapse into one folder, and a renamed folder breaks the path. `ClientPropertyFoldersPanel` matches the property's folder by loose name containment (`client/src/pages/properties.tsx:2270-2275`). The team-rooted browsing path also synthesises from `propertyName` (`server/microsoft.ts:2969`).
- **Setup jobs are in-memory and lie about completion.** `clientFolderJobs = new Map(...)` (`server/microsoft.ts:2690-2699`); the job is fire-and-forget (`:2802-2819`), dies with the process, and `job.status = "done"` is set whenever the batch loop returns — per-folder errors only increment a counter (`:2811`), so "done" can mean partially failed. The UI polls `GET /client-folders/status/:companyId` (`:2701-2705`; poller at `client/src/components/brand-profile-panel.tsx:4496-4518`) and gives up after 10 minutes.
- **A durable-job pattern already exists and is the template.** `runPreparationStage` (`server/brand-preparation-jobs.ts:47-119`): `system_settings` row per (subject, stage) + `pg_try_advisory_lock` + claim/lease + cooldown/backoff — survives restart, double-run safe. Delivery 4 uses it; Delivery 5 copies the pattern for folder jobs.
- The client jail resolves its root from `sharepoint_folder_url` via the Graph `/shares/` API every 10 minutes (`server/client-sharepoint.ts:30-75`) — a stored drive/item ID mapping removes that resolution and the name-sibling fallback query.

### B. Entity KYC

- **Three entity representations today.** (1) Child companies via `crm_companies.parent_company_id` (`shared/schema.ts:449`), read by `GET /api/crm/companies/:id/sub-companies` (`server/crm.ts:2982-2997`, scope-guarded) and rendered with per-sub KYC badges by `SubCompaniesPanel` (`client/src/pages/companies.tsx:196-236`). (2) The `trading_entities` jsonb on `crm_companies` (`shared/schema.ts:510`), edited by `TradingEntitiesPanel` (`client/src/pages/companies.tsx:245-329`) which writes a per-entry `kyc_status` into the jsonb — a third, unsynced KYC vocabulary (`pending|in_review|pass|fail|expired`, panel `:318-323`). (3) The `crm_trading_entities` table (`shared/schema.ts:1487-1515`) with routes at `server/crm.ts:2814-2937`; creates are mirrored into the jsonb for the tenancy-schedule picker (`:2866-2884`). Its `kyc_*` columns are explicitly DEPRECATED (`shared/schema.ts:1499-1512`). The resolver already walks (1) + (3) as the confirmed tree (`server/account-resolver.ts:141-227`).
- **KYC today is brand-level only.** `crm_companies.kyc_status/kyc_checked_at/kyc_approved_by/kyc_expires_at` (`shared/schema.ts:454-457`), checklist jsonb `aml_checklist` (`:458`), routes: `GET/PUT /api/kyc/company/:id[/checklist]`, `POST .../approve|reject` (`server/aml-compliance.ts:727-851`; approve stamps expiry from `aml_settings.recheck_interval_days` and inserts `aml_recheck_reminders`, `:791-817`). Audit trail `kyc_audit_log` (`shared/schema.ts:2728`, writer `server/aml-compliance.ts:39-48`).
- **An automated check sweep already exists.** `runAllAmlChecks(companyId, dealId?, userId?)` (`server/kyc-orchestrator.ts:261`) runs Companies House/UBO/sanctions/PEP/adverse-media/Veriff, records a `kyc_investigations` row (`:363`, table at `shared/schema.ts:2708`), and auto-ticks `aml_checklist` preserving manual ticks (`tickChecklistItems`, `:87-133`). HTTP entry: `POST /api/kyc/run-all-checks` (`:833`). This is the per-entity "check job" the group action fans out to.
- **The deal gate is brand-level and Xero-blind.** `checkCounterpartyAml` (`server/deal-gates.ts:29-62`) reads only `crm_companies.kyc_status/kyc_expires_at` for the four counterparty FKs; the header comment (`:5-12`) documents that the `*EntityId` columns are Xero ContactID GUIDs and that an earlier entity-aware branch silently always missed. Note the trading-entity delete guard (`server/crm.ts:2924-2933`) counts deals by those Xero columns, so it effectively never fires — flag, don't fix, in this delivery.
- The `AccountEntity` contract (`server/account-resolver.ts:25-33`) already carries `companiesHouseNumber`, `relation`, `relationConfidence` — the canonical group view extends this rather than inventing a parallel tree.

## Task 1: Migrations — folder map, entity KYC, contracting-entity shadow

Three files, each independently reviewable, each mirrored per Global Constraints. Apply in order.

**`migrations/0045_account_folder_map.sql`** — the ONE durable account→folder mapping. Keyed by CRM identity, storing Graph IDs; path/webUrl are display caches refreshed on write, never identity:

```sql
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
```

The second unique index is the rename/duplicate-name answer: a SharePoint folder maps to at most one logical node regardless of its current name. `bind_status='conflict'` records "two physical folders claim one logical node" for human resolution — never auto-merged.

**`migrations/0046_entity_kyc.sql`** — canonical per-entity KYC, keyed by entity kind + id, plus audit columns so `kyc_audit_log` can record entity-level actions without inventing a parallel log:

```sql
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
```

No backfill: brand-level `crm_companies.kyc_*` is NOT copied into `crm_entity_kyc` — the group view reads brand state live from `crm_companies` for `entity_kind='company'` rows with no `crm_entity_kyc` row yet, and renders it as the brand's own status, never as evidence about children. The deprecated `crm_trading_entities.kyc_*` columns stay untouched (drop is a future, separate migration).

**`migrations/0047_deal_contracting_entities_shadow.sql`** — contracting-entity links + the shadow comparison log. Nothing here is read by any gate:

```sql
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
```

**Verification.** Each file applies and re-applies cleanly (`psql -f` twice). Boot array + `IDEMPOTENT_SQL_MIGRATIONS` updated. `shared/schema.ts` gains `accountFolderMap`, `crmEntityKyc`, `crmDealEntities`, `amlShadowGateRuns` and the two `kycAuditLog` columns. `npm run check` green.

## Task 2: Folder-tree spec + mapping resolver (`shared/client-folder-tree.ts`, `server/account-folder-map.ts`)

**`shared/client-folder-tree.ts`** (shared so server job and client report render the same tree): the canonical logical tree as data —

```ts
export const CLIENT_FOLDER_TREE = [
  { key: "01-client-relationship", label: "01 Client & relationship" },
  { key: "02-group-legal-entities", label: "02 Group & legal entities", perEntity: [
    { key: "kyc-onboarding", label: "KYC & onboarding" },
    { key: "entity-corporate", label: "Corporate documents" },
  ]},
  { key: "03-properties", label: "03 Properties", perProperty: [
    { key: "01-instructions", label: "01 Instructions & appointments" },
    { key: "02-letting", label: "02 Letting & marketing" },
    { key: "03-tenancy-schedules", label: "03 Tenancy schedules & units" },
    { key: "04-property-media", label: "04 Property media" },
    { key: "99-archive", label: "99 Archive" },
  ]},
  { key: "04-media-library", label: "04 Media library" },
  { key: "05-investment-strategy", label: "05 Investment strategy" },
  { key: "06-commercial-restricted", label: "06 Commercial — restricted", restricted: true },
  { key: "99-archive", label: "99 Archive" },
] as const;
```

Exact labels beyond those named in the master plan are confirmed with the team at implementation; the *keys* are the contract, labels are display data. Entity folder display name is `"<entity name> — <CH registration ID>"` (registration ID mandatory in the label per the master plan; `"<name> — no-registration"` when absent so it is visibly incomplete, never silently name-only). Property folder display name is `"<property name> — <first 8 of crm_properties.id>"` so same-name properties produce distinct, stable folders.

**`server/account-folder-map.ts`** — read-only resolver + bind writers:

- `getAccountFolderMap(companyId, opts, deps)` — loads all `account_folder_map` rows for the account root (company + resolver entity set + portfolio from `resolveAccountView`, reusing its entity/property sets — never a second account-scope SQL).
- `resolveNodeFolder(map, ownerKind, ownerId, logicalKey): { driveId, itemId } | null` — pure lookup used by upload/listing paths.
- `recordFolderBinding(...)` / `recordFolderCreated(...)` — upsert by `(owner_kind, owner_id, logical_key)`; stamping `web_url` and, for the client root and property roots, mirroring `web_url` onto `crm_companies.sharepoint_folder_url` / `crm_properties.sharepoint_folder_url` exactly as today's stamper does (`server/microsoft.ts:2755-2773`) so existing readers (the client jail, `PropertyFoldersPanel`) keep working unchanged.
- `folderNameCandidates(map row)` — the names a physical folder might already have (current display name, legacy name-only variant) for the bind pass.

**Verification.** `server/account-folder-map.test.ts`: same-name-property fixture produces two map rows with distinct display names and distinct logical bindings; rename scenario (cached_path stale) still resolves by item id; upsert idempotent on retry. Pure helpers tested without a DB; DB tests skip without a test database.

## Task 3: Inventory / dry-run mapping report (bind FIRST)

**Endpoint:** `GET /api/accounts/:id/folder-inventory` — staff only (403 when `resolveCompanyScope(req)` non-null, same guard shape as the reconciliation route). New module `server/account-folder-inventory.ts`, router mounted beside the Delivery 2/3 account routers (`server/index.ts` `app.use(...)` pattern).

**Flow.** `resolveAccountView` → entity set + portfolio (stable property ids). Resolve the client root: prefer `account_folder_map`, else `crm_companies.sharepoint_folder_url` (the jail's resolver, `server/client-sharepoint.ts:44-75`, extracted into a shared helper), else the legacy `BGP share drive/{ClientName}` path probe. Walk the physical tree with `listAllChildren` (bounded depth 4, page-cap warnings surfaced) and match each expected logical node against physical children by (a) existing `account_folder_map` binding, (b) `folderNameCandidates` exact match, (c) nothing → `missing`. Ambiguous matches (two physical folders hit one logical node) → `conflict`, no binding written.

**Report row shape (per logical node):** `{ logicalKey, ownerKind, ownerId, ownerLabel, displayName, status: 'bound' | 'matched' | 'missing' | 'conflict', driveId, itemId, physicalName, notes[] }`, plus a summary `{ total, bound, matched, missing, conflicts }` and the raw child counts proving pagination (the report asserts it enumerated every child page; >200-item folders appear whole). `?apply=1` is NOT in this task — the dry-run report is read-only; binding writes happen in Task 4's job, which re-runs the same matcher and persists `bound` rows before creating `missing` ones.

**UI.** A "Folder tree" card on the landlord workspace (staff only) rendering the report table with status chips and the conflicts list first. Reuses existing `Card`/`Badge` components; no new page.

**Verification.** `server/account-folder-inventory.test.ts` with a stubbed Graph fetch: fixtures for bound/matched/missing/conflict; a >200-item folder (3 synthetic pages) fully enumerated; same-name properties both reported against their own ids; scoped request → 403 (guard-helper test).

## Task 4: Durable, resumable folder setup jobs (`server/client-folder-jobs.ts`)

Replace the in-memory `clientFolderJobs` Map (`server/microsoft.ts:2690-2699`) and the fire-and-forget body of `POST /api/microsoft/client-folders` (`:2707-2834`) with a durable runner modelled on `runPreparationStage` (`server/brand-preparation-jobs.ts:47-119`):

- **State.** One `system_settings` row per `(companyId)` holding `{ status, claim, leaseUntil, startedAt, nodes: [{ logicalKey, ownerKind, ownerId, status: pending|bound|created|failed, error? }] }`. Per-node status is the resume point: a restart re-reads the row and skips `bound|created` nodes. `pg_try_advisory_lock` on the job key makes double-clicks and concurrent runners no-ops.
- **Steps.** (1) Re-run the Task-3 matcher, persist `bound` bindings. (2) Create only `missing` nodes, parent-before-child, via `createFolderByPath` (`server/microsoft.ts:2444`) — 409 counts as success (existing behaviour, `:2873-2884`), then re-resolve the child's item id and persist the binding. (3) Stamp webUrls (root + property roots) exactly as today. Throttling: bounded parallelism 3 (today's `runChunked`), Graph 429/5xx marks the node `failed` with the error and continues; the job ends `done` ONLY when every node is `bound|created`, otherwise `failed` with the failure list — "done despite partial failure" becomes impossible.
- **Endpoints.** `POST /api/microsoft/client-folders` keeps its request/response contract (202 + `{ started, properties, total }`) but starts the durable runner; `GET /api/microsoft/client-folders/status/:companyId` reads the durable row (so the existing UI poller at `brand-profile-panel.tsx:4496-4518` works unchanged) and adds `failedNodes: [{ logicalKey, error }]` which the UI surfaces as a retryable per-node list. Restarting a `failed` job resumes — it never re-creates `bound|created` nodes, so no duplicate trees after retry/restart.
- **Identity.** The portfolio comes from `resolveAccountView` (property ids), not the `SELECT DISTINCT p.name` query (`server/microsoft.ts:2731-2739`, deleted). Entity folders come from the resolver's confirmed entity set.

**Verification.** `server/client-folder-jobs.test.ts` with an injected pool + stubbed Graph: mid-job "crash" (runner dropped after node k) resumes and completes with zero duplicate create calls (create-call spy); a 429 on one property leaves the job `failed` with exactly that node listed, and a retry completes it; two concurrent POSTs → one runner (`alreadyRunning` path preserved).

## Task 5: ID-based folder resolution on the read paths

- `server/client-sharepoint.ts` `resolveRoot` (:44-75): prefer `account_folder_map` (company root binding → drive/item id directly, keeping the 10-minute cache), fall back to today's `sharepoint_folder_url` + `/shares/` resolution. The `assertInRoot` jail (:89-96) is unchanged — the item-id prefix check stays the security boundary.
- `ClientPropertyFoldersPanel` (`client/src/pages/properties.tsx:2234-2277`): replace the loose name-containment match (:2270-2275) with the property's `account_folder_map` binding, exposed via `GET /api/client/sharepoint/property-root?propertyId=` (new, scope-guarded, jail-checked); fall back to the name match only when no binding exists (legacy accounts), labelled "unverified match" in the UI.
- `PropertyFoldersPanel` (`client/src/pages/properties.tsx:1713+`) keeps working via `sharepoint_folder_url`/path synthesis for un-migrated properties — binding is progressive, never a big-bang cutover.

**Verification.** Tests for the root-resolution preference order (map → URL → none) and the jail check rejecting an item outside the bound root even when a binding exists. `npm run check`.

## Task 6: Canonical group/entity view (`GET /api/accounts/:id/entities`)

New module `server/account-entities.ts`, same router-mount pattern. `resolveAccountView` supplies the confirmed tree; this layers the reconciliation and the KYC state.

**Reconciliation (read-side, no writes).** For every company in the resolver's entity set, collect three lists: child companies (`parent_company_id`), `crm_trading_entities` rows, and the legacy `trading_entities` jsonb entries. Merge by `lower(trim(name))` + Companies House number into one `GroupEntity` per legal entity:

```ts
{
  entityKind: "company" | "trading_entity",
  entityId: string,                       -- canonical row id (crm_trading_entities.id or crm_companies.id)
  name, companiesHouseNumber: string | null,
  relation: "self" | "parent" | "subsidiary" | "trading_entity",
  relationConfidence, evidence: string[],  -- all three sources that mention this entity
  representationConflicts: string[],      -- e.g. "jsonb entry has no crm_trading_entities row", "CH number differs"
  kyc: { status, approvedBy, approvedAt, expiresAt, nextReviewAt, outstanding: [{key,label}], lastCheckedAt } | null,
  groupRollupBlocks: boolean,             -- true when status is not approved-or-valid
}
```

Conflicts are reported, never resolved by code (no auto-creation of `crm_trading_entities` rows from jsonb, no jsonb edits). `kyc` is read from `crm_entity_kyc` first; for `entityKind='company'` with no row, the live `crm_companies.kyc_*` state is shown as that company's own status — and is NEVER projected onto any other entity. Nested SPVs/JVs appear through the resolver's existing cycle-safe tree (depth cap 8).

**Group summary.** `{ total, current, inReview, unchecked, expired, rejected }` where `current` counts only entities with `status='approved' AND (expires_at IS NULL OR expires_at > now())`. The response always includes the full per-entity list; the summary is derived from it, so "X of Y current" can never hide a child — the UI renders the worst-status bucket first.

**Verification.** `server/account-entities.test.ts`: three-representation fixture merges into one entity with all evidence sources; a jsonb-only entry surfaces with `representationConflicts` and no invented id; approved parent + unchecked child yields `current < total` with the child in the unchecked bucket; expired approval counts as not current.

## Task 7: Per-entity KYC state + group UI

**Endpoints** (in `server/account-entities.ts`, writes `requireAdmin` matching the approve/reject routes at `server/aml-compliance.ts:784,827`):

- `PUT /api/entities/:kind/:id/kyc` — MLRO checklist-style update of `crm_entity_kyc` (status → `in_review`, outstanding items, evidence notes); audit row in `kyc_audit_log` with the new `entity_kind`/`entity_id` columns.
- `POST /api/entities/:kind/:id/kyc/approve` — stamps status/checked_at/approved_by (session user's NAME, the `:829-832` representation rule)/expires_at/next_review_at from `aml_settings.recheck_interval_days`, inserts an `aml_recheck_reminders` row for the entity, audits. Never touches any other entity's row.
- `POST /api/entities/:kind/:id/kyc/reject` — symmetric.

**UI (`client/src/components/account-entities-panel.tsx`, mounted on the landlord workspace and the company page's `SubCompaniesPanel` slot).** One deduplicated entity list: name + CH number, relation chip, representation-conflict warning icon, per-entity KYC status chip (same colour language as `SubCompaniesPanel`, `companies.tsx:223-227`), expiry/next-review date, outstanding-item count, and approve/reject actions for admins. Header: "X of Y entities current" plus explicit buckets ("2 unchecked · 1 expired") — an approved parent beside an unchecked child renders the child row with its own "No KYC" state and the summary never reads "current". `TradingEntitiesPanel`'s jsonb `kyc_status` select is left functional but labelled legacy; the panel reads canonical state from the new endpoint.

**Verification.** Endpoint tests: approve writes exactly one entity's row + audit + reminder; a child approve does not modify the parent; non-admin → 403; group summary fixture from Task 6 rendered through the state layer. Client correctness by `npm run check` + reused components (no client test harness exists).

## Task 8: Group check action with per-entity outcomes

`POST /api/accounts/:id/entity-checks` (staff/admin): fans out one check job per entity in the group view. `entity_kind='company'` → `runAllAmlChecks(entityId, undefined, userId)` (`server/kyc-orchestrator.ts:261` — full sweep, `kyc_investigations` row, checklist auto-ticks preserving manual ticks). `entity_kind='trading_entity'` → a lighter variant reusing the same building blocks (`getCompanyData`, `screenSanctions`, `assessRisk` from `server/kyc-clouseau.ts`) keyed by CH number/name, writing results into `crm_entity_kyc.evidence` + `last_check_job_at` — NOT into the deprecated `crm_trading_entities.kyc_*` columns. Per-entity execution is durable: a `system_settings`-backed run record per (account, run id) with per-entity `{ status: queued|running|done|failed, investigationId?, error? }` so progress survives restart, modelled on Task 4's runner. `GET /api/accounts/:id/entity-checks/latest` returns the run record for the progress UI (per-entity rows with outcome chips). Entity checks do not call `recomputeDealKycApproved` — deal-level effects are Task 9's shadow only.

**Verification.** Fan-out fixture: 3 companies + 2 trading entities each get exactly one outcome; a failing entity leaves the run `done` with that entity `failed` and the rest `done`; retry re-runs only `failed` entities; no writes to `crm_deals.kyc_approved` (pool spy).

## Task 9: Shadow gate comparison (report BEFORE any gate change)

`server/aml-shadow-gate.ts`:

- `checkCounterpartyAmlShadow(dealId)` — computes BOTH outcomes for a deal: current (`checkCounterpartyAml`, brand-level) and proposed (entity-aware: counterparties resolved through `crm_deal_entities` where a contracting entity is linked, falling back to the brand FK; each checked against `crm_entity_kyc`/`crm_companies` state). Pure composition over the two existing result shapes; no call-site changes anywhere.
- `POST /api/aml/shadow-gate-report/run` (admin) — evaluates every active deal (canonical active statuses via `isActiveDealStatus`), persists an `aml_shadow_gate_runs` snapshot: per deal `{ dealId, name, current: {pass,notReady[]}, proposed: {pass,notReady[]}, changed: 'newly_blocked' | 'newly_passing' | 'same', reasons[] }`. `GET /api/aml/shadow-gate-report` (staff only) returns the latest snapshot with the `changed` rows first.
- `crm_deal_entities` is populated manually (and by reviewed per-deal linking UI later); an empty link set means proposed == current for that deal, stated explicitly in the row.

**Gate (verbatim target):** the shadow report exists and has been generated before ANY deal-gate logic change — and no such change is in this delivery. Flipping the live gate is a post-Delivery-5 decision with this report as its evidence.

**Verification.** `server/aml-shadow-gate.test.ts`: deal with brand-approved parent but unapproved linked contracting entity → current pass / proposed block, `changed='newly_blocked'`; deal with no `crm_deal_entities` rows → `same`; the live gate module is imported but its call sites untouched (grep assertion in the commit message; no behavioural test changes in existing gate tests).

## Task 10: Full verification

`npm run check` clean; all Delivery 1–4 test files plus the new ones green under `node --import tsx --test`; the acceptance-gate table below executed.

## Phased task breakdown and acceptance checks

| Phase | Tasks | Acceptance check (maps to the Delivery 5 gates) |
|---|---|---|
| 1 | Task 1 migrations + schema.ts + boot array + drift list | All three migrations apply + re-apply cleanly; boot log shows them applied via `applyIdempotentSqlMigrations`; zero existing rows modified. |
| 2 | Tasks 2–3 mapping resolver + inventory report | **Gate: >200 items navigable** — report fixture with 3 Graph pages enumerates every item; conflicts reported, nothing created, dry-run is read-only. **Gate: same-name properties resolve correctly** — two same-named properties bind by id to distinct folders. |
| 3 | Task 4 durable jobs + Task 5 read-path binding | **Gate: no duplicate trees after retry/restart** — crash/resume fixture issues zero duplicate creates; failed nodes visible and retryable; "done" only when fully bound/created. |
| 4 | Tasks 6–7 entity view + per-entity KYC + UI | **Gate: approved parent + unchecked child visibly incomplete** — summary fixture shows "X of Y" shortfall with the child named; approve-per-entity writes one row + audit + reminder only. |
| 5 | Task 8 group checks + Task 9 shadow report + Task 10 | Per-entity outcomes and progress durable; **Gate: shadow comparison report exists before any deal-gate change** — snapshot generated, `changed` rows explain both directions, live gate untouched. |

## Out of scope for Delivery 5 (do not implement)

- Moving, renaming, or re-rooting any EXISTING SharePoint folder; migrating documents into the new tree; any change to SharePoint/item permissions (the tree is bound in place; only genuinely missing folders are created, empty).
- Any live deal-gate behaviour change (`checkCounterpartyAml`, deal-stages, bulk status, invoicing locks) — shadow report only.
- Writing or migrating the deprecated `crm_trading_entities.kyc_*` columns, the `trading_entities` jsonb mirror, or brand-level `crm_companies.kyc_*`; jsonb→table migration of trading entities (the schema's "phase 4").
- Re-keying Xero contact/entity columns, or fixing the Xero-GUID delete guard at `server/crm.ts:2924-2933` (flagged to the team, not fixed here).
- Delivery 4's preparation pipeline/media scope; reconciliation report changes; any client-permission or scope-rule change (`isPropertyInScope`, `isDealInScope`, the jail's `assertInRoot`).
- Automatic creation of `crm_trading_entities` rows from jsonb entries (conflicts are reported for humans).

## Explicit uncertainties (verified against the tree at planning time)

- Exact subfolder labels under `[Property — …]` and `[entity — registration ID]` are partially elided ("…") in the master plan; Task 2's keys are the contract and the label list must be confirmed with the team before Task 4 creates anything (creation is gated on the reviewed constant, not guessed).
- `landlord_website_findings`-style runtime tables taught Delivery 2 that not everything is in `shared/schema.ts`; `account_folder_map`/`crm_entity_kyc`/`crm_deal_entities` are NOT known to exist in production — the `IF NOT EXISTS` migrations make either case safe, and `healSchemaDrift` will add the `kyc_audit_log` columns even if the boot mirror is missed.
- Trading-entity automated checks have no existing sweep equivalent to `runAllAmlChecks`; Task 8 composes one from `kyc-clouseau` building blocks. If `getCompanyData`/`screenSanctions` prove company-row-shaped in ways that don't fit a trading entity, Task 8 degrades to recording `status='in_review'` + outstanding items for trading entities (human check) rather than faking automation — flagged in the run record.
- The Graph token in setup jobs is the acting staff member's delegated token (`getValidMsToken`); a durable job that resumes after restart needs a fresh token from the retrying user's session — the runner takes the token per resume call, it is never persisted.
- `clientFolderJobs` status shape is consumed by the existing poller; Task 4 keeps the wire fields (`status/created/errors/total/message`) and only adds `failedNodes` — if other consumers exist beyond `brand-profile-panel.tsx:4496-4518`, the implementer greps before finalising the shape.

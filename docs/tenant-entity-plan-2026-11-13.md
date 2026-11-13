# Tenancy schedule row → the company on the lease (`tenant_entity_id`): build plan

Final build plan, 13 November 2026. Checked against branch `claude/sleepy-gates-grb2ww` at
`b9bcd3c3` ("Match brands for a whole schedule in one pass in the unit feed"), which comes after
`954bc2bc` ("Let a client login add a tenant brand from a brand picker"). Woody approved on 13
November "the link from a schedule row to the tenant's legal entity (one new database column,
tenant_entity_id)" (`docs/property-page-rebuild-2026-11-13.md:218-220`). His reasons: trading-as
names "should be linked to brands but their actual AML contracted company name is often different
and should be a sub company within the brands for covenant checking and AML", and "the link to
tenants and ability to set them is important in the tenancy schedule". He also said, with this
task, "there is no anthropic only rule". Nothing here uses AI, so the plan sets no provider rule.

Words: **brand** = `tenant_company_id`; **entity** / **company on the lease** = `tenant_entity_id`
(a `crm_trading_entities` row); **lease name** = `tenant_name`; **trading name** = `trading_name`.

## 0. Facts the plan rests on (checked at b9bcd3c3)

- **Entity table.** `crm_trading_entities` (`shared/schema.ts:1594`; boot `MIGRATIONS`,
  `server/index.ts:1633-1676`): `id` varchar, `parent_company_id`, `name`, `companies_house_number`,
  `is_default`, `notes`; unique on `(parent_company_id, LOWER(name))`. Routes in `server/crm.ts`:
  GET `/api/crm/companies/:id/trading-entities` (refused to client logins); POST
  `/api/crm/trading-entities` (3063: `ON CONFLICT … DO UPDATE` overwrites notes and CH number, then
  mirrors the name into the `crm_companies.trading_entities` jsonb, 3101-3117); PUT; DELETE (refuses
  only for `crm_deals.*_entity_id`).
- **Every boot copies the jsonb back into the table** (`index.ts:1672-1676`, `DO NOTHING`), so an
  entity whose name is in the jsonb comes back after a delete. Brand pages send that jsonb to client
  logins (`brand-profile.ts:319`).
- **Schedule row** (`shared/schema.ts:2745-2761`): `tenant_name`, `trading_name`,
  `tenant_company_id`; no foreign key, no entity link.
- **Resolver** (`server/tenant-brand-resolver.ts`): per-row `resolveBrandIdSubquery` (29-71) ends
  `LIMIT 1` with **no ORDER BY**. The set form `brandNameKeySql` + `BRAND_KEYS_CTE` keeps one brand
  per key with `ORDER BY norm_key, brand_id` (lower id wins) and is what the feed's `SPINE_SQL`
  uses; `qa/regression/property-units-guards.test.mjs` test 10 pins it. Per-row callers:
  `tenancy-schedule.ts:63` (GET soft match), 327 (POST), 452 (PUT), 937 (Excel import);
  `tenant-brand-resolver.ts:109/112/119/122` (`backfillPropertyTenants`); `leasing-schedule.ts:169`
  (read), 347 (overwrite with `COALESCE(resolver, existing)`), 460; `evidence-plan.ts:866`.
- **The four tenant-cell defects, confirmed.** (1) `TenantBrandPicker` saves only the name
  (`onSelect={(opt) => onSave(unitId, field, opt.name)}`, `PropertyTenancySchedule.tsx` ~1981).
  (2) The PUT re-resolves the brand on every name edit with no guard (`tenancy-schedule.ts:449-455`),
  so a non-matching name writes NULL over a hand link. (3) First match in no fixed order, so the
  GET's soft match can disagree with the feed. (4) `coalesce(trading_name, tenant_name, '')` does
  not skip `''`.
- **Pickers in the file.** `BrandSearchInput` is already imported (line 15, used at 479): it
  returns `BrandPick { name, companyId }`, and with `allowCreate` a client login gets a bare
  "Tenant" brand self-added to its list. `TenantBrandPicker` (1917-1998, used at 2272, 2425, 2433)
  returns a name only.
- **Compact view** shows `tenant_name`, not `trading_name` (`COMPACT_COLUMN_FIELDS`, 698; pinned by
  `qa/regression/property-tenancy-compact.test.mjs:14`).
- **Clients see brand covenant** (Woody, 2026-08-04, "open up covenant for Mark"): the gateway lets
  a client GET `/api/covenant/by-crm/:id` for a visible brand, and `/api/covenant/:num` only when a
  `crm_companies` row in its list carries the number (`index.ts:5164-5180`). The schedule shows
  `CovenantBadgeByCompany` unless `readOnly` (2253); its "staff-only" comment is stale.
- **AML.** In-app AML retired 2026-10-05 ("KYC4U are the MLRO"; the kyc route answers 410), so
  `crm_entity_kyc` has no live writer. `checkCounterpartyAml` (`server/deal-gates.ts:29-60`) reads
  the brand's `kyc_status`/`kyc_expires_at`; `server/aml-shadow-gate.test.ts:177-181` pins it.
- **Name clash.** `crm_deals.tenant_entity_id` holds a **Xero ContactID**; the new column holds a
  `crm_trading_entities.id`.
- **Migrations** end at `0060_letting_suggestions.sql`, last in `IDEMPOTENT_SQL_MIGRATIONS`
  (`server/schema-drift.ts`); the working branch also ends at 0060.
- **Audit.** `investment_comp_migration_log` (batch, table_name, record_id, action, prior, note) is
  read only by staff back-fill/undo code. `leasing_schedule_audit` belongs to the leasing screen and
  is client-readable, so it is **not** used.

## 1. The column and its migration

`migrations/0061_tenancy_tenant_entity.sql` (if a 0061 has landed by build time, take the next
free number):

```sql
-- The company on the lease (Woody, 2026-11-13): a crm_trading_entities.id under the
-- row's brand (tenant_company_id). NOT crm_deals.tenant_entity_id, which is a Xero
-- ContactID. Written only by server/tenancy-tenant.ts (a person's action) and the admin
-- Preview-then-Apply back-fill in server/tenant-entity-backfill.ts. Safe to run again.
ALTER TABLE tenancy_schedule_units ADD COLUMN IF NOT EXISTS tenant_entity_id varchar;
CREATE INDEX IF NOT EXISTS tenancy_schedule_units_tenant_entity_idx
  ON tenancy_schedule_units (tenant_entity_id) WHERE tenant_entity_id IS NOT NULL;
```

- Append `"0061_tenancy_tenant_entity.sql"` to `IDEMPOTENT_SQL_MIGRATIONS` after 0060.
- `shared/schema.ts`, `tenancyScheduleUnits`, after `tenantCompanyId`:
  `tenantEntityId: varchar("tenant_entity_id"), // crm_trading_entities.id (NOT crm_deals.tenant_entity_id, a Xero id)`
- No foreign key (an `ON DELETE` would unlink silently); the DELETE route refuses instead (§7).

## 2. The rule and the one write door

### 2.1 What a row's brand and entity are

- Brand = `tenant_company_id`, meaning unchanged; reads keep `COALESCE(tc_fk, tc_soft)`.
- Entity = `tenant_entity_id`.
- **Invariant on write:** a row with an entity has a brand, and the entity's parent (resolved as
  `coalesce(parent.merged_into_id, parent.id)`, refused if that is itself merged) is that brand.
  Reads tolerate drift; the back-fill Preview lists it; nothing repairs it by itself.
- `tenant_name` and `trading_name` are only ever what people typed; never overwritten from the
  brand or the entity.
- **Reversal, recorded here, in CLAUDE.md and in the code comment:** the Tenant column was
  picker-only ("Free-text input is intentionally not offered", `PropertyTenancySchedule.tsx:2264`).
  From now on the lease name is the landlord's text; the CRM links are the brand line and the
  company line.

### 2.2 Pure rules: `shared/tenant-entity.ts` (new)

`planTenantWrite(current, input, facts, viewer)` → `{ set, notes, refusal? }`, the one decision
function. `input` fields are optional (absent = unchanged, `null` = clear): `companyId`,
`tradingName`, `tenantName`, `entityId`, `createEntity { name, companiesHouseNumber? }`. `viewer` is
`"staff" | "client"`. `facts` come from one SQL lookup using `brandNameKeySql` (no TypeScript copy
of the key): `pickedBrand {id, mergedInto}`, `entity {id, parentId}` (merge-resolved),
`oldLeaseKey`, `newLeaseKey`, `entityKey`, `storedBrandMatchesOldNames` (the old trading or lease
key equals the stored brand's name key or a jsonb alias key), and `nameMatch` (the unique brand for
the new trading name, else the new lease name; NULL on a tie, §2.4). Rules, in order:

- **R1 Text.** Apply `tradingName`/`tenantName`: trim, `''` → null.
- **R2 Vacated.** If `namedTenant(trading, lease)` (`shared/property-units.ts`) is now null and no
  `companyId` was sent → brand and entity null.
- **R3 Picked brand.** `companyId` sent → brand = it, resolved to its survivor if merged (no
  survivor → `BRAND_MERGED`); `null` clears.
- **R4 Picked entity.** `entityId` on a row with no resulting brand → brand = entity's parent;
  parent ≠ resulting brand → `ENTITY_NOT_UNDER_BRAND`; `null` unlinks. `createEntity` → created
  under the resulting brand and linked; no brand → `BRAND_FIRST`.
- **R5 Lease name changed, nothing picked.** Row has an entity, `newLeaseKey ≠ oldLeaseKey` and
  `newLeaseKey ≠ entityKey` → entity null, note `entity_cleared_lease_name_changed` (a new tenant
  must not show the old tenant's covenant). Formatting edits (same key) keep it.
- **R6 Name edit and the brand, nothing picked.** A NULL brand is filled from `nameMatch`. A brand
  on a row with an entity is never changed by a name edit (note `brand_name_differs` when the names
  no longer match it). A brand with no entity moves to `nameMatch` only when
  `storedBrandMatchesOldNames` (the link was machine-made from the old names) and `nameMatch` is a
  different brand. Otherwise keep it, with `brand_name_differs` when the names no longer match. A
  name matching nothing never clears a brand (defect 2).
- **R7 Brand changed.** Resulting brand ≠ current and the entity is not under it → entity null,
  note `entity_cleared_brand_changed`.
- **R8 Client limits.** A client's `entityId`/`createEntity` → `STAFF_ONLY` (403). A client write
  that would clear or change an **existing** entity (by R2, R3, R5 or R7) → `ENTITY_SET_BY_BGP`
  (409): "BGP has recorded the company on this lease. Ask BGP to change the tenant." (Woody 2.)
- Nothing here creates a brand. An entity is created only under R4 from a person's `createEntity`.

Also: `leaseCompanyState(row)` → `"linked" | "none" | "lease_in_brand_name" | "no_brand"`
(`lease_in_brand_name` = no entity and the lease key equals the brand or trading key; the server
passes that boolean from SQL), and `TENANT_ENTITY_REFUSALS` (code, HTTP status, wording).

### 2.3 The door: `server/tenancy-tenant.ts` (new)

- **`setTenancyTenant(db, rowId, input, actor)`**: inside the caller's transaction (or its own
  when given a pool): `SELECT … FOR UPDATE`, one facts query, `planTenantWrite`, one `UPDATE
  tenancy_schedule_units SET …, updated_at = now()`; returns `{ row, notes }`. `actor` is `{
  userId, name, viewer } | { system: string }`. The only code that sets `tenant_entity_id`, apart
  from the back-fill and the two completion-revert clears (§7).
- **`relinkTenantAfterNameEdit(db, rowId, before, actor)`**: the same function for callers that only
  changed text; `before` = the row's four tenant columns before their write.
- **`insertTradingEntity(db, { parentCompanyId, name, companiesHouseNumber })`**: under `SAVEPOINT`,
  `INSERT … ON CONFLICT (parent_company_id, LOWER(name)) DO NOTHING RETURNING id`; on conflict
  SELECT the existing row and return `{ id, created: false }`. It **never** changes an existing
  entity's notes or CH number (that stays with PUT `/api/crm/trading-entities/:id`), **never**
  writes the jsonb mirror (keeps lease names off client brand pages; a deleted entity stays deleted
  at boot), never sets `is_default`.
- **Audit:** each set/change/clear of `tenant_entity_id`, and each entity this door creates, writes
  one `investment_comp_migration_log` row: `batch` `tenant-entity-door` (a person) or
  `tenant-entity-system` (no person); `table_name` `tenancy_schedule_units` or
  `crm_trading_entities`; `action` `entity_linked|entity_changed|entity_cleared|entity_created`;
  `prior {tenant_entity_id, tenant_company_id}`; `note` "<who>: <rule/note code>". Brand and name
  edits are not logged, as with every schedule edit today (Woody 5).
- **Route** `PUT /api/tenancy-schedule/unit/:id/tenant`, on the existing router in
  `server/tenancy-schedule.ts`. The client gateway already passes it as a path segment of
  `/api/tenancy-schedule/unit` (`index.ts:4918`); restricted Landsec roles have no rule for it and
  stay refused. Handler order: (1) a `vacant-…` id → 400 "Add this unit to the schedule first";
  (2) the PUT's scope check (`resolveCompanyScope` + `isPropertyInScope`) before any other query;
  (3) `viewer = scope ? "client" : "staff"` (staff viewing as a client are a client); (4) a client's
  `companyId` must pass `isClientVisibleBrand(companyId, scope)` else 403 `BRAND_NOT_IN_LIST` (a
  brand it just created via `allowCreate` is self-added, so it passes); (5) `setTenancyTenant`;
  (6) reply = the row in the GET's shape (§5), entity fields stripped for a client, plus `notes`
  and, for staff, `matchesLease` for the picker.

### 2.4 Resolver (`server/tenant-brand-resolver.ts`)

- **Defect 3, one rule:** add `ORDER BY bkn.brand_id` before `LIMIT 1` in
  `resolveBrandIdSubquery`, the order `BRAND_KEYS_CTE` uses, so the schedule GET and the feed name
  the same brand. No new name source, no tiers, no `crm_trading_entities` branch. Every caller keeps
  today's behaviour, now deterministic (including `leasing-schedule.ts:347/460`).
- **New `resolveBrandMatchSql(param)`**: same keys via `brandNameKeySql`, returns `CASE WHEN
  count(DISTINCT brand_id) = 1 THEN min(brand_id) END` (NULL on a tie). Used only by the door's R6,
  so a name edit never picks between two brands.
- **New `tenantNameForBrandSql(alias)`** = `coalesce(nullif(btrim(${a}.trading_name), ''),
  nullif(btrim(${a}.tenant_name), ''), '')`, replacing the literal at `tenancy-schedule.ts:63, 327,
  937` and `tenant-brand-resolver.ts:109, 112` (A). B applies the same NULLIF at
  `leasing-schedule.ts:169` and `property-asset-brief.ts:1607` (three-way coalesce there).

### 2.5 What the existing schedule PUT and POST keep

- `PUT /api/tenancy-schedule/unit/:id` still takes and saves both names. 449-455 become
  `relinkTenantAfterNameEdit(client, id, previous, actor)` in the same transaction (widen the
  `previous` SELECT at 431-433 to the four tenant columns). A client edit refused by R8 rolls the
  whole PUT back with 409. The reply row is read after the relink. What changes for callers: a
  non-matching name keeps the brand; VACANT clears brand and entity.
- `tenant_company_id` and `tenant_entity_id` stay **off** `TENANCY_FIELDS`.
- `POST /api/tenancy-schedule/unit`: when the body carries `tenant_company_id` (the add form),
  call `setTenancyTenant(…, { companyId })` after the insert, with §2.3's client check; otherwise
  the name resolve at 323-330 with `tenantNameForBrandSql`.
- Clear-property (`tenancy-schedule.ts:1381-1385`, behind `LETTING_REPAIR_TOOLS_ENABLED`, false
  today) refuses with 409 while any row on the property has `tenant_entity_id`, naming the count.

## 3. The tenant cell (`client/src/components/PropertyTenancySchedule.tsx`)

**The `tenant_name` column becomes the Tenant cell**, in full and compact view, so compact keeps a
brand control. Header "Tenant". Up to three lines:

1. **Brand line.** Linked: the brand name links to `/companies/<id>` (as today) beside
   `CovenantBadgeByCompany` (shown unless `readOnly`, exactly as today, so clients keep brand
   covenant) and a ghost "Change" button. Unlinked: a ghost "Set brand" button. Both open
   `BrandSearchInput` (`allowCreate`, `initialQuery` = trading or lease name); `onPick` sends `PUT
   …/unit/:id/tenant { companyId: pick.companyId, tradingName: <existing trading name, or
   pick.name when blank> }`; "Unlink" sends `{ companyId: null }`. A `brand_name_differs` note
   shows muted "Trading name differs from the brand".
2. **Lease line.** "Lease: <tenant_name>", `InlineEdit` through the existing PUT. Plain text,
   never a brand picker.
3. **Company line, staff only**, plain `text-[11px] text-muted-foreground`, no coloured chip.
   Linked: "ITX UK Limited · CH 01234567" + `CovenantBadge companyNumber=<entity CH>`, ghost menu
   Change company / Unlink / Add CH number (PUT `/api/crm/trading-entities/:id`). Linked, no
   number: "ITX UK Limited · no CH number"; the brand badge gets the tooltip `note` (§4). `none`
   with a brand: ghost button "+ Company" opening `LeaseCompanyPicker`. `lease_in_brand_name`:
   "Lease in the brand's own name". `no_brand`: nothing.

**`LeaseCompanyPicker`** (new, `client/src/components/lease-company-picker.tsx`): the brand's
entities from GET `/api/crm/companies/:brandId/trading-entities`, the one the server flags
`matchesLease` first as "Matches the lease", then "Add '<lease name>' as a company of <brand>" (name
prefilled, optional CH number) → `createEntity`. A person presses every link; nothing links on open.

**`trading_name` column:** plain `InlineEdit` through the existing PUT. **`TenantBrandPicker` is
deleted.** `AddTenancyUnitForm` (2405-2450): `BrandSearchInput` for the brand (keeps `companyId`,
posts `tenant_company_id`), text `Input`s for "Tenant on the lease" and "Trading as". The
`/api/crm/companies-basic` queryKey shape stays wherever it remains
(`server/tracker-requests.test.ts:74-75`).

**Phone card** (1570-1740): "<brand> · Lease: <name>" and, for staff, the company line, read-only.

**Client logins** (`isClientViewer`, 745): brand line with brand covenant (as today) and lease
line; may pick or create a brand in their list (the server refuses others); no company line, no
`LeaseCompanyPicker`, no entity covenant request; an R8 refusal shows its wording in a toast.

**Convert on touch** (DESIGN.md): the cell's markers and `BreakTypeChip` (573) move to `Pill`. The
vacant-row amber backgrounds (1588, 2020, 2069) are row tints, not chips, and stay. Fix the stale
covenant comment at 2250-2252 (clients see brand covenant for brands in their list). One line in
`server/chatbgp-app-map.ts`: brand and company on the lease are set in the schedule's Tenant cell
and seen in the unit panel.

## 4. Covenant and AML

**Covenant.** A row whose entity has a CH number shows `CovenantBadge companyNumber=<entity CH>`
(`GET /api/covenant/:companyNumber`), staff only (the gateway would refuse a client anyway unless a
`crm_companies` row in its list carries the number); no engine change. An entity without a number
shows "no CH number" with "Add CH number", and the brand badge stays with a new optional `note` prop
on `CovenantBadgeByCompany` (`client/src/components/covenant-badge.tsx`) appending to the tooltip:
"Brand's own Companies House company, not the company on the lease." A row with no entity keeps the
brand badge exactly as today, for staff and clients. Watchlist and alerts are keyed by number
already; unchanged.

**AML: unchanged in this step.** `checkCounterpartyAml` stays at brand level and
`aml-shadow-gate.test.ts:177-181` stays green. KYC4U matching (`server/kyc4u.ts`), the status
mirror onto `crm_companies.kyc_status`, `crm_entity_kyc`, `crm_deal_entities` and
`crm_deals.tenant_entity_id` (Xero) are untouched. **Why it waits:** Woody has said AML should run
on the contracting company, but KYC4U is the MLRO, its requests are matched to one `crm_companies`
id, and moving the gate changes which deals warn or block; that needs the KYC4U side and the shadow
report first, as the next step (Woody 3). **Shown now** (unit panel, staff only, from the brand's
real fields): "KYC4U: <kyc_status>, expires <date> (on the brand, not the company on the lease)" or
"KYC4U: not checked".

## 5. The feed and the property page

- **Schedule GET** (`tenancy-schedule.ts:52-79`): `LEFT JOIN crm_trading_entities te ON te.id =
  t.tenant_entity_id`; select `te.name AS tenant_entity_name, te.companies_house_number AS
  tenant_entity_ch` and the boolean `lease_in_brand_name`. When `tsScope` is set, delete
  `tenant_entity_id`, `tenant_entity_name`, `tenant_entity_ch` from each row before `res.json`.
- **Other readers** that send `t.*` to clients or share links (`leasing-schedule.ts:1125, 1176`,
  `landsec-unit.ts:302`, `evidence-plan-sharing.ts:221`, `tenancy-schedule.ts:1123`) would send
  the bare `tenant_entity_id`. That is an opaque id, not a name, and is accepted; the name, CH
  number and entity covenant stay staff only, and a D guard stops a new reader joining the name.
- **`shared/property-units.ts`:** `PropertyUnit.tenant` gains `entityId`, `entityName`,
  `companiesHouseNumber` (`string | null`), `leaseCompany: LeaseCompanyState | null`, and `kyc {
  status, expiresAt } | null` (brand level). `UnitFlags.noLeaseCompany` = occupied, a named lease
  name, a brand, no entity, not `lease_in_brand_name`. `propertyUnitCounts.noLeaseCompany`;
  `UnitFilter` gains `"nolease"`.
- **`server/property-units.ts` `SPINE_SQL`:** add `LEFT JOIN crm_trading_entities te ON te.id =
  t.tenant_entity_id`, the brand's `kyc_status`/`kyc_expires_at` from `tc_fk`/`tc_soft`, and
  `lease_in_brand_name` via `brandNameKeySql`, inside the existing query (guard test 4's count
  unchanged). Tracker-only units get nulls. Both routes blank the entity fields and `kyc`, set
  `noLeaseCompany = false` and `counts.noLeaseCompany = 0` for a client (`staff = !(await
  resolveCompanyScope(req))`).
- **Unit panel** (`unit-panel.tsx` ~474-480), staff only, under "Lease in the name of …": "Company
  on the lease: <name> · CH <n> · <CovenantBadge>" or "No company on the lease. Set it on the
  tenancy schedule." (link calls `onOpenSchedule`), then the KYC4U line. Plain text. Clients:
  unchanged.
- **Unit list** (`unit-list.tsx`): `FILTERS` gains `{ key: "nolease", label: "No company on lease"
  }`, shown only when its count is above 0 (the `notonschedule` rule), never to a client. It earns
  its place as the work list for covenant and the back-fill (526 rows across the app have a lease
  name differing from the trading name, `docs/property-page-rebuild-2026-11-13.md:83`).

## 6. The admin back-fill (Preview, then Apply): links only, creates nothing

`server/tenant-entity-backfill.ts`, following `server/letting-backfill.ts`: the dry run is recorded
under a `system_settings` key with the pairs it showed; Apply is refused without one in the last
hour, re-runs the preview on live data and touches only ticked pairs. Routes in `server/routes.ts`
beside the letting back-fills, `requireAuth, requireAdmin`: `POST /api/admin/tenant-entity-backfill
{ dryRun, propertyId?, pairs? }` and `POST /api/admin/tenant-entity-backfill/undo { batch }`. Never
at boot or on a timer.

Rows considered: `tenant_entity_id IS NULL`, not archived, `namedTenant(tenant_name)` not null.
Grouped in SQL with `brandNameKeySql`. Definitions: **confirmed brand** = the brand's own name key
equals the row's trading-name key (any other stored brand may come from the old first-match
resolver or the AI trading-name finder). **Verified entity** = has a CH number or `is_default`
(others may be boot copies of AI-chosen jsonb names, `trading-names.ts:117-127`). **Person or
landlord-like** = lease name starts `Mr|Mrs|Ms|Miss|Dr ` or its key matches a non-tenant-type
`crm_companies` row.

| group | when | Apply |
|---|---|---|
| `link_existing` | confirmed brand B; exactly one **verified** entity under B (merge-resolved) with key = lease key | links the ticked (B, lease key) pairs |
| `entity_unverified` | as above, entity not verified | listed only |
| `brand_unconfirmed` | brand set, not confirmed | listed only |
| `create_candidates` | confirmed brand; lease key ≠ brand and trading keys; no matching entity; not person/landlord-like | listed only (a work list for "+ Company") |
| `lease_in_brand_name` | lease key = brand or trading key | listed only |
| `ambiguous` | two or more entities under B share the key | listed only |
| `looks_like_person_or_landlord` | as defined | listed only |
| `no_brand` | no stored brand | listed only |
| `entity_drift` | linked rows whose entity's merge-resolved parent ≠ the row's brand | listed only |

Preview: counts per group, and rows (property, unit, lease name, trading name, brand, the entity it
would link) grouped by (brand, lease key). Apply: ticked pairs, one transaction per property, skips
any row whose names, brand or entity changed since the preview. Audit: per linked row one
`investment_comp_migration_log` row (`batch 'tenant-entity-backfill-<ISO>'`, `table_name
'tenancy_schedule_units'`, `action 'entity_linked'`, `prior {"tenant_entity_id": null,
"tenant_company_id": "<id>"}`, `note "link_existing: <entity name> (<id>, CH <n>) for lease name
'<tenant_name>'"`), plus `{at, by, batch, counts}` appended to `system_settings`
`tenant_entity_backfill:runs`. Undo restores `prior` on rows still holding the batch's entity; it
creates and deletes no entities. UI: a panel beside `LettingBackfillPanel` in
`client/src/pages/settings.tsx` (`BACKFILL_JOBS`), tick boxes per pair, Preview / type-APPLY.
Bulk creation of entities is not in this step (Woody 4).

## 7. Every other writer of a schedule row's tenant

| writer | today | must (package) |
|---|---|---|
| Excel import (`tenancy-schedule.ts:974, 1008` → `importTenancyRows`) | inserts new rows; resolves brand on inserted ids (937) | `tenantNameForBrandSql` at 937 (A); never sets an entity. Replace mode (paused by flag) refuses with 409 while any row on the property has `tenant_entity_id` (`tenancy-import.ts`, B) |
| ChatBGP `upsertChatTenancySchedule` → explicit edits (`tenancy-import.ts:143-153`) | writes names, no relink | `importTenancyRows` gains option `afterTenantEdit(db, id, before)`; `chatbgp-tenancy-import.ts` passes `relinkTenantAfterNameEdit` with the actor; `chatbgp.ts:7773, 13329` pass the requesting staff user, or `{system: "chatbgp"}` on a server-originated run (B) |
| Evidence plan unit edit (`evidence-plan.ts:860-867`) | re-resolves brand with the wipe defect | read `before`; `relinkTenantAfterNameEdit` replaces 865-867 (B) |
| Review resolve (`property-review.ts:121-150`) | can write `tenant_company_id`, `trading_name` | for `tenancy_schedule_units`, lift those and `tenant_name` out of the generic UPDATE into `setTenancyTenant(db, id, {companyId, tradingName, tenantName}, resolvingUser)`: the option is a person's pick. `tenant_entity_id` stays off its allowlist (B) |
| Completion revert (`crm.ts:4199-4206`, `deal-stages.ts:239-245`) | clears the brand when it equals the deal's tenant | add `tenant_entity_id = CASE WHEN tenant_company_id = $3 THEN NULL ELSE tenant_entity_id END` to the same statement (B) |
| Duplicate reconcile (`tenancy-reconcile.ts:150-188`) | fills the keeper's blanks from donors | fill `tenant_entity_id` only when the keeper's final brand equals that donor's (B) |
| `backfillPropertyTenants`, `assign-tenant-brand` | fill a NULL brand | `tenantNameForBrandSql` (A); no entity |
| `leasing-schedule.ts:169`, `property-asset-brief.ts:1607` (reads) | defect-4 coalesce | `nullif(btrim(…),'')` on each name (B) |
| ChatBGP `sql_write` (`sql-tools.ts:331-344`) | can write any column | refuse `tenant_entity_id` on `tenancy_schedule_units`; inline constant like the requirement-provenance block (B) |
| `DELETE /api/crm/trading-entities/:id` (`crm.ts:3155-3168`) | refuses for deals only | also refuse while a schedule row, `crm_properties.billing_entity_id` or `crm_entity_kyc.entity_id` points at it: "This company is on the lease of N schedule rows. Unlink it first." (B) |
| Completion fill, duplicate merge, brochure ingest/undo, promote orphans, leasing seed, unit mirror, estate units, trading-name finder, `repoint-merged-brands`, POST trading-entities | — | none (merge already conflicts on a differing column; brochure undo's `prior` carries the column; drift is listed by the Preview) |

## 8. Tests

**Pure** (`shared/tenant-entity.test.ts`): name edit matching nothing keeps the brand (defect 2); a
tie keeps the stored brand or leaves none (defect 3); VACANT clears both; a picked id wins; a
hand-picked brand with an entity survives a trading-name edit matching another brand; a
machine-made brand with no entity follows a new unique match; a lease-name edit with a new key
clears the entity, the same key keeps it; a brand change clears an entity not under it; an entity
under another brand is refused; an entity on a brandless row sets the brand; client
`entityId`/`createEntity` → `STAFF_ONLY`; client vacate, re-brand or lease rename on a row with an
entity → `ENTITY_SET_BY_BGP`; `leaseCompanyState` for all four states.

**SQL in a throwaway schema** (copy `withSchema` and the `PROPERTY_PAGE_DATABASE_URL` guard from
`server/property-page.test.ts:337-375`; add `crm_trading_entities`,
`investment_comp_migration_log`, and `ADD COLUMN IF NOT EXISTS tenant_entity_id`):
- `server/tenancy-tenant.test.ts` (A): `resolveBrandIdSubquery` = `BRAND_KEYS_CTE` on a fixture with
  a two-brand tie, a merged brand and a jsonb alias; `resolveBrandMatchSql` NULL on the tie; the
  door writes, refuses and logs; `insertTradingEntity` on an existing name returns `created: false`,
  changes no notes or number, writes no jsonb; **create via the door, delete, run the two boot
  INSERTs (`index.ts:1667-1676`), the entity is not back**; the PUT no longer wipes; an empty
  trading name lets the lease name match (defect 4).
- `server/tenant-entity-backfill.test.ts` (D): each group; Apply refused without a preview; links
  only ticked pairs; skips a row edited after the preview; never applies an unconfirmed brand or
  unverified entity; undo restores.
- `server/property-page.test.ts` (D, extend): entity fields, `kyc`, `noLeaseCompany` for staff;
  null or zero for a client; query count unchanged.

**Source guards**, one file per package, asserting only on that package's files
(`qa/regression/*.test.mjs`, picked up by `npm run qa:regression`):
- `tenant-entity-door-guards.test.mjs` (A): `tenant_entity_id =` written only in
  `tenancy-tenant.ts`; migration listed; absent from `TENANCY_FIELDS`; the tenant route's scope
  check precedes any other query; `insertTradingEntity` has `DO NOTHING` and no `trading_entities`
  write; `resolveBrandIdSubquery` has `ORDER BY bkn.brand_id`.
- `tenant-entity-writers-guards.test.mjs` (B): review resolve routes `tenant_company_id` through
  `setTenancyTenant` and never lists `tenant_entity_id`; `sql-tools.ts` refuses it; `deal-gates.ts`
  mentions neither `tenancy_schedule_units` nor `tenant_entity_id`; both revert statements clear
  the entity with the brand; the DELETE guard counts schedule rows.
- `tenant-entity-screen-guards.test.mjs` (C): `TenantBrandPicker` gone; brand `onPick` calls
  `/tenant` with `companyId`; `CovenantBadgeByCompany` not gated on `isClientViewer`;
  `CovenantBadge companyNumber` and `LeaseCompanyPicker` behind `!isClientViewer`; the
  `companies-basic` queryKey shape unchanged.
- `tenant-entity-feed-guards.test.mjs` (D): `SPINE_SQL` joins `crm_trading_entities` and the
  module strips entity fields for a client; the back-fill has no `setInterval`, is not imported by
  `server/index.ts`, and never INSERTs into `crm_trading_entities`; no file other than
  `tenancy-schedule.ts`/`property-units.ts` joins `te.name` from `tenant_entity_id`.
- Behaviour (C): extend `qa/regression/property-tenancy-compact.test.mjs` so compact mode renders a
  brand control in the `tenant_name` cell for a client and for staff.

**Must stay green:** `npm test` (notably `landsec-gateway`, `tracker-requests`,
`brand-profile-deals`); `npm run qa:regression` (`property-units-guards` with test 10 unchanged,
`property-tenancy-compact`, `property-tenancy-actions`, `tenancy-calendar-dates`,
`chatbgp-tenancy-import`, `tenancy-import`, `tenancy-merge`, `access.cjs`);
`shared/property-units.test.ts` (fixture gains the new `tenant` fields);
`server/aml-shadow-gate.test.ts`; `npm run check`; the disposable harnesses
`tenancy-unit-identity-postgres.mjs` (A: bindings gain `./tenancy-tenant`, plus a
`crm_trading_entities` table) and `tenancy-import-postgres.mjs` (B: add `crm_companies (id, name,
trading_entities jsonb, merged_into_id)`, `crm_trading_entities`, `investment_comp_migration_log`).
`package.json` is left alone: new suites run with `node --import tsx --test <file>`, as the
requirements suites do.

## 9. Build order: four packages, no file in two

A is merged first, the same day. B, C and D are written in parallel against §2's contract
(function names, input fields, refusal codes, reply shape) and merged after A.

**A. Column, rules, door, route.** Files: `migrations/0061_tenancy_tenant_entity.sql`,
`server/schema-drift.ts`, `shared/schema.ts`, `shared/tenant-entity.ts`,
`shared/tenant-entity.test.ts`, `server/tenant-brand-resolver.ts` (ORDER BY,
`resolveBrandMatchSql`, `tenantNameForBrandSql`, its use at 109/112), `server/tenancy-tenant.ts`,
`server/tenancy-tenant.test.ts`, `server/tenancy-schedule.ts` (GET join and strip; PUT via relink;
POST with `tenant_company_id`; NULLIF at 63/327/937; clear-property refusal; the tenant route),
`qa/regression/tenancy-unit-identity-postgres.mjs`,
`qa/regression/tenant-entity-door-guards.test.mjs`. Accept:
`node --import tsx --test shared/tenant-entity.test.ts qa/regression/tenant-entity-door-guards.test.mjs`;
`PROPERTY_PAGE_DATABASE_URL=… node --import tsx --test server/tenancy-tenant.test.ts`;
`npm test`; `npm run qa:regression`; `npm run check`; on a local database the migration runs twice
cleanly and `GET /api/admin/schema-drift` lists nothing missing; a client PUT `/tenant` with
`entityId` → 403, with an out-of-list brand → 403.

**B. Other writers.** Files: `server/tenancy-import.ts`, `server/chatbgp-tenancy-import.ts`,
`server/chatbgp.ts`, `server/evidence-plan.ts`, `server/property-review.ts`,
`server/tenancy-reconcile.ts`, `server/deal-stages.ts`, `server/crm.ts` (revert clear, DELETE
guard), `server/sql-tools.ts`, `server/leasing-schedule.ts` (169 only),
`server/property-asset-brief.ts` (1607 only), `qa/regression/tenancy-import-postgres.mjs`,
`qa/regression/tenant-entity-writers-guards.test.mjs`. Accept:
`node --import tsx --test qa/regression/tenant-entity-writers-guards.test.mjs server/aml-shadow-gate.test.ts`;
`npm run qa:regression` (chatbgp-tenancy-import, tenancy-import, tenancy-merge, the sql-tools
binding tests); `TENANCY_IMPORT_DATABASE_URL=… node --import tsx qa/regression/tenancy-import-postgres.mjs`;
`npm run check`.

**C. The schedule screen.** Files: `client/src/components/PropertyTenancySchedule.tsx`,
`client/src/components/lease-company-picker.tsx` (new), `client/src/components/covenant-badge.tsx`
(`note` prop), `server/chatbgp-app-map.ts`, `qa/regression/property-tenancy-compact.test.mjs`,
`qa/regression/tenant-entity-screen-guards.test.mjs`. Accept:
`node --import tsx --test qa/regression/tenant-entity-screen-guards.test.mjs qa/regression/property-tenancy-compact.test.mjs qa/regression/property-tenancy-actions.test.mjs server/tracker-requests.test.ts`;
`npm run check`. In a browser (writes on a local server; read-only checks on prod with
`BGP_QA_TOKEN` after deploy): picking a brand sends `companyId`; compact view shows the brand line;
staff link, create and unlink a company on the lease; the badge requests `/api/covenant/<entity
CH>`; a client login keeps the brand badge and sends no entity request. Not verified in a browser by
this plan.

**D. Feed, unit panel, back-fill, docs.** Files: `shared/property-units.ts`,
`shared/property-units.test.ts`, `server/property-units.ts`, `server/property-page.test.ts`,
`client/src/components/property-page/unit-panel.tsx`,
`client/src/components/property-page/unit-list.tsx`, `server/tenant-entity-backfill.ts`,
`server/tenant-entity-backfill.test.ts`, `server/routes.ts`, `client/src/pages/settings.tsx`,
`qa/regression/tenant-entity-feed-guards.test.mjs`, `CLAUDE.md` (a "Company on the lease"
paragraph under "Property page rebuild", including the end of the picker-only Tenant column),
`docs/property-page-rebuild-2026-11-13.md` (what was built, what waits). Accept:
`node --import tsx --test shared/property-units.test.ts qa/regression/tenant-entity-feed-guards.test.mjs qa/regression/property-units-guards.test.mjs`;
`PROPERTY_PAGE_DATABASE_URL=… node --import tsx --test server/property-page.test.ts server/tenant-entity-backfill.test.ts`;
`npm run check`; Preview against a local copy of live data lists rows in the groups, and Apply
without a preview → 409. Browser (not verified here): the "No company on lease" pill shows only
with a count and never for a client.

## 10. Needs Woody's word before it is built

1. **Clients and the company on the lease.** Clients already see the brand's covenant (his
   2026-08-04 "open up covenant for Mark"), and on 2026-08-01 he kept the Compliance & KYC panel
   visible to clients because landlords need tenant AML and financial standing. This plan shows
   clients none of the entity detail (name, CH number, entity covenant). Should they see it, as
   that precedent suggests?
2. **A client change against BGP's link.** When BGP has set the company on the lease and a client
   changes the row's brand, marks it vacant, or retypes the lease name to another company, this
   plan refuses ("Ask BGP"). Or should the change go through and clear BGP's link (logged)?
3. **AML on the company on the lease.** He has said AML should run on the contracting company. How?
   Should KYC4U requests be matched to the entity and verdicts stored per entity, and should the
   deal gate then warn or block on the entity's verdict? This is the next step, with the shadow
   report as the evidence.
4. **Bulk creation.** Should the back-fill create company-on-the-lease records in bulk from the
   landlord's lease text (per brand group an admin ticks, no CH number)? This plan only links
   existing, verified companies and lists the rest for a person.
5. **Who changed a tenant.** Does he want a visible history of brand and name changes on schedule
   rows? Today no schedule edit is logged; this plan logs only changes to the company on the lease,
   in the staff-only back-fill log.

## Not in this step

- AML gate, KYC4U matching or `crm_entity_kyc` on the entity (Woody 3).
- Back-fill creation of entities (Woody 4), and any back-fill that sets a brand from a name.
- A `crm_trading_entities` branch in the brand resolver. If ever wanted, it must change
  `resolveBrandIdSubquery`, `BRAND_KEYS_CTE` and guard test 10 together.
- Changing `POST /api/crm/trading-entities` (its `DO UPDATE` overwrite and jsonb mirror) or making
  DELETE drop the jsonb alias. Until then, entities made through that route come back at boot after
  a delete; entities made by the new door do not.
- Separate finding: the nightly trading-name finder (`trading-names.ts:117-127`) writes AI-chosen
  legal names into the jsonb and the boot copy turns them into entity rows. The back-fill treats
  them as unverified; stopping it is a separate task.
- The phone card's change sheet; a cross-brand entity picker; brand/name edit history (Woody 5).
- `leasing-schedule.ts:347`'s `COALESCE(resolver, existing)` overwrite (leasing schedule's own).

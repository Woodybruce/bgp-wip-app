# Landlord/client boards — Delivery 2: account and portfolio links

Source: "BGP landlord and client boards — implementation plan" (2026-09-20), Delivery 2 only.
Codebase: bgp-wip-app @ 5dcdc5a7 (branch `claude/terminal-coding-interface-JOGQK`), post Delivery 1 (ae4848aa) + Delivery 1.5 (79b7f3db / 10202c5c).

Delivery 2 scope (verbatim): "Account and portfolio links — Shared account resolver; confirmed entity tree; ownership/JV/management roles; exact property matching; country-aware discovery; Hammerson reconciliation report."

Acceptance gate (verbatim): "All official destinations accounted for, including legitimate grouped properties. Ambiguous postcode causes no automatic ownership change. Report scope does not change client access."

## Global Constraints

- Schema changes ARE in scope this time (Delivery 1 forbade them), but every change is a separate, reviewable migration file under `migrations/`, numbered after the current head (`0040_brand_agent_unknown_firm.sql`). All additive, all nullable, all `IF NOT EXISTS` — same convention as `0005_property_resolver.sql`.
- Do NOT silently reinterpret existing fields. Existing `crm_company_properties` rows and `crm_properties.landlord_id` values keep their current meaning; new relationship metadata starts NULL and is rendered as "unknown" until a human sets it. No bulk data rewrites anywhere in this delivery.
- Preserve the client-scope (`bpScope` / `resolveCompanyScope`) permission model exactly. The account resolver is a READ-side assembler: it filters what a scoped viewer sees, it never grants access, and nothing in it is consulted by `isPropertyInScope` / `isDealInScope` (`server/company-scope.ts:251`). Reporting relationships (parent/subsidiary rollups) must not widen what a client login can see.
- Uncertain matches stay unresolved. No guessed owners, no guessed locations, no fuzzy auto-linking.
- Match existing code style: TypeScript, raw SQL via `pool.query`, node:test via tsx. Test command: `node --import tsx --test <file>`. Typecheck: `npm run check` (tsc).
- No new npm dependencies.
- One commit per task; the implementer commits its own work.

## What already exists (do not rebuild)

Delivery 2 assembles a shared resolver from pieces that already ship. Reuse, don't duplicate:

- **Entity tree links** — `crm_companies.parent_company_id` (`shared/schema.ts:449`), read by the sub-companies route `GET /api/crm/companies/:id/sub-companies` (`server/crm.ts:2910`). Trading/legal entities live in `crm_trading_entities` (`shared/schema.ts:1442`) with routes at `server/crm.ts:2742-2850`. No new entity column is needed; the resolver walks these.
- **Company↔property link** — `crm_company_properties` (`shared/schema.ts:1378`, pair-unique) + `crm_properties.landlord_id` FK + the ownership stack `freeholder_id` / `long_leaseholder_id` (`shared/schema.ts:807-811`). The union rule clients already use is `isPropertyInScope` (`server/company-scope.ts:251`).
- **Company↔deal union** — `storage.getCompanyDeals` (`server/storage.ts:865`) already unions the four counterparty FKs with the `crm_company_deals` join. Deals carry `bgp_acting_for` (`shared/schema.ts:864`) — the instruction vs related-activity discriminator.
- **Deal totals / canonical statuses** — `dealTotalsSql`, `isCompletedDealStatus`, `isActiveDealStatus` (`server/brand-profile-deals.ts`, Delivery 1) over `shared/deal-status.ts` codes. The resolver reuses `dealTotalsSql` verbatim per entity set.
- **Team assembly** — `server/client-teams.ts:64` already unions the curated board (`crm_client_team_members`, `shared/schema.ts:1315`) with `crm_property_agents` (`shared/schema.ts:1300`) over client-scoped properties, including same-named sibling company rows (`boardCompanyIds`). The resolver generalises this pattern, it does not re-invent it.
- **Contact stats** — `contactInteractionStatsQ` + the contact decoration IIFE (`server/brand-profile.ts:394-413`, `:953-965`).
- **Exact-match property linking** — `normalisePropertyName` / `normalisePostcode` / `autoLinkScrapedProperties` (`server/landlord-scraper.ts:422-530`). Export the two normalisers for the resolver and the reconciliation report.
- **Discovery dismissal** — `landlord_dismissed_discoveries` (`server/landlord-scraper.ts:59-66`).
- **Landlord flag** — the `isLandlord` query (`server/brand-profile.ts:911-923`) and the client helper `isLandlordCompany` (`client/src/lib/company-kind.ts`, Delivery 1.5).

## Task 1: Migrations — relationship roles, indexes, property country, reconciliation tables

Four files, each independently reviewable. Apply in order.

**`migrations/0041_company_property_relationships.sql`** — extend the existing join table rather than inventing a parallel one (the pair-unique index on `(company_id, property_id)` is the identity we want to annotate):

```sql
ALTER TABLE crm_company_properties
  ADD COLUMN IF NOT EXISTS relationship_role text,        -- owner | jv | manager | unknown
  ADD COLUMN IF NOT EXISTS ownership_stake_pct real,      -- JV stake; NULL unless evidenced
  ADD COLUMN IF NOT EXISTS relationship_confidence text,  -- confirmed | inferred | unresolved
  ADD COLUMN IF NOT EXISTS relationship_source text,      -- e.g. 'manual', 'land-registry', 'website-scrape'
  ADD COLUMN IF NOT EXISTS valid_from timestamptz,
  ADD COLUMN IF NOT EXISTS valid_to timestamptz,
  ADD COLUMN IF NOT EXISTS relationship_notes text;
```

Existing rows stay NULL on every new column — the resolver renders NULL role as `unknown`. **Do not backfill** "owner" onto rows that were created as generic links; that would be the silent reinterpretation the plan forbids.

**`migrations/0042_entity_graph_indexes.sql`** — `crm_companies.parent_company_id` and `crm_trading_entities.parent_company_id` already exist; this migration only adds lookup indexes for the graph walk:

```sql
CREATE INDEX IF NOT EXISTS idx_crm_companies_parent ON crm_companies(parent_company_id);
CREATE INDEX IF NOT EXISTS idx_crm_trading_entities_parent ON crm_trading_entities(parent_company_id);
CREATE INDEX IF NOT EXISTS idx_crm_properties_freeholder ON crm_properties(freeholder_id);
CREATE INDEX IF NOT EXISTS idx_crm_properties_long_leaseholder ON crm_properties(long_leaseholder_id);
```

**`migrations/0043_property_country.sql`** — country + geocode provenance on the property itself:

```sql
ALTER TABLE crm_properties
  ADD COLUMN IF NOT EXISTS country text,          -- ISO 3166-1 alpha-2, e.g. 'GB','IE','FR'
  ADD COLUMN IF NOT EXISTS geocode_status text;   -- resolved | unresolved | needs_review
```

No backfill: existing rows keep NULL country and NULL geocode_status. Correction of known-wrong rows (Dundrum→Newcastle, French assets shown as UK) is Task 4's reviewed, per-row repair — not this migration. *Uncertainty flagged:* `crm_properties` has no country column today (verified against `shared/schema.ts:761-829`); if a runtime-created column appears in production before this migration ships, the `IF NOT EXISTS` makes it a no-op.

**`migrations/0044_reconciliation.sql`** — baseline seed list + generated report snapshots:

```sql
CREATE TABLE IF NOT EXISTS account_reconciliation_baselines (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,               -- the account this baseline belongs to (Hammerson row id)
  baseline_name text NOT NULL,            -- 'hammerson-official-destinations'
  destination_name text NOT NULL,         -- official name as published
  official_group_key text,                -- e.g. 'bullring-grand-central' — NULL when standalone
  expected_crm_property_count int NOT NULL DEFAULT 1,  -- 2 for Bullring & Grand Central
  category text NOT NULL DEFAULT 'destination',        -- destination | development | disposed
  country text,                           -- ISO-2 from the official source
  source_url text,
  source_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS account_reconciliation_runs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  baseline_name text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by text,
  rows jsonb NOT NULL                     -- one object per baseline row; see Task 5
);
```

**Verification.** Each file applies cleanly against a scratch database (`psql -f`) and is idempotent on re-run. `npm run check` passes after the matching `shared/schema.ts` additions (add the new columns to `crmCompanyProperties` and `crmProperties`, and the two new tables, so drizzle types stay truthful).

## Task 2: The account resolver (`server/account-resolver.ts`)

**Module:** new file `server/account-resolver.ts`. Read-only assembler — it issues SELECTs only, and a test asserts that.

**Entry point:**

```ts
export async function resolveAccountView(
  companyId: string,
  opts: { scopeCompanyId?: string | null } = {},
): Promise<AccountView>
```

`scopeCompanyId` is the already-resolved client scope from `resolveCompanyScope(req)` (staff pass `null`). The resolver uses it only to filter output, exactly as the current brand-profile queries do — never to add rows.

**Types (exported, shared with the report and the UI):**

```ts
export type RelationshipRole = "owner" | "jv" | "manager" | "unknown";
export type RelationshipConfidence = "confirmed" | "inferred" | "unresolved";

export interface AccountEntity {
  companyId: string;
  name: string;
  companyType: string | null;
  companiesHouseNumber: string | null;
  relation: "self" | "parent" | "subsidiary" | "trading_entity";
  relationConfidence: RelationshipConfidence; // parent_company_id link => confirmed; name-only => unresolved
  evidence: string;                           // "crm_companies.parent_company_id" | "crm_trading_entities"
}

export interface AccountProperty {
  propertyId: string;
  name: string;
  postcode: string | null;
  country: string | null;                     // ISO-2, from crm_properties.country (Task 1)
  relationshipRole: RelationshipRole;         // from crm_company_properties.relationship_role; landlord_id FK => owner(confirmed-ish, see below)
  ownershipStakePct: number | null;
  owningEntityId: string | null;              // which AccountEntity the link hangs off
  confidence: RelationshipConfidence;
  sources: string[];                          // ["landlord_id","company_property_link","freeholder_id"]
  unitCount: number;
}

export interface AccountInstruction {         // BGP is instructed BY the account
  dealId: string; name: string; status: string | null; propertyId: string | null;
  partyEntityId: string;                      // which account entity is the counterparty
  instructedAt: string | null;
}

export interface RelatedMarketActivity {      // BGP activity AT the account's property, not FOR the account
  dealId: string; name: string; status: string | null; propertyId: string;
  activityKind: "tenant_rep" | "investment" | "other";
  counterpartyName: string | null;            // the tenant we acted for, etc.
}

export interface AccountView {
  root: AccountEntity;
  entities: AccountEntity[];                  // cycle-safe confirmed tree
  properties: AccountProperty[];              // portfolio destinations
  instructions: AccountInstruction[];
  relatedMarketActivity: RelatedMarketActivity[];
  contacts: AccountContact[];                 // employer ∪ property/account relationships, deduped by contact id
  team: AccountTeamMember[];                  // curated ∪ property agents ∪ evidenced deal contributors
  totals: { deals: number; completedDeals: number };  // per dealTotalsSql over the entity set
}
```

**Assembly (per §3 of the governing plan):**

1. **Entity tree.** Walk `crm_companies.parent_company_id` up from the root to the top ancestor, then collect descendants breadth-first. Append `crm_trading_entities` rows for every company in the set as `trading_entity` leaves. **Cycle protection:** a `visited: Set<string>` checked before every hop plus a hard depth cap of 8; `merged_into_id` is followed at most once (to read the surviving row's parent). A cycle (A→B→A) terminates on the second visit to A; the row that would close the loop is still returned, flagged `relationConfidence: "unresolved"` with evidence `"cycle detected"`, so bad data is visible rather than silently dropped or infinitely recursed. Only links via `parent_company_id` / `crm_trading_entities` count as **confirmed**; subsidiary work rolls up through these links only.
2. **Properties.** Union per entity: `crm_properties.landlord_id` (role `owner`, confidence `confirmed` when the entity is the root, `inferred` when reached via the tree), `crm_company_properties` rows (role/confidence/stake from the Task-1 columns; NULL role → `unknown`), `freeholder_id`/`long_leaseholder_id` (role `owner`, confidence `confirmed`). Dedup by `propertyId`, merging `sources`. A property whose only evidence is an ambiguous postcode match is **not** included — exact matching rules live in Task 3.
3. **Instructions vs related market activity.** Deals where any account entity is a counterparty AND `bgp_acting_for` matches that party's side (entity is `landlord_id` with `bgp_acting_for='landlord'`, or vendor/purchaser on an investment mandate) → `AccountInstruction`. Deals at an account *property* where BGP acted for the *tenant* (`bgp_acting_for='tenant'`, `tenant_id` not in the entity set, `property_id` in the portfolio) → `RelatedMarketActivity`. A tenant-rep letting at a Hammerson centre is related market activity, **not** a Hammerson instruction — this is the explicit §3 rule and a test case. Explicit `crm_company_deals` links join the instruction list with `confidence` inherited from the link.
4. **Contacts.** `crm_contacts.company_id IN (entity set)` ∪ contacts via `crm_contact_properties` / `crm_property_clients` on portfolio properties. Dedup by contact id; decorate with the existing `contactInteractionStatsQ` shape (`interaction_count`, `last_interaction_at`, excluding future-dated rows). **No double counting:** interaction stats are grouped per `contact_id` once over the union, and per-mailbox suggestion counts stay in `PENDING_CONTACT_SUGGESTIONS_SQL` (`server/brand-profile-suggestions.ts`, Delivery 1) — the resolver does not re-aggregate mailboxes.
5. **Team.** Curated `crm_client_team_members` ∪ `crm_property_agents` over portfolio properties ∪ evidenced contributors (distinct `internal_agent_ids` / `deal_fee_allocations.agent_user_id` on the account's instructions). Three buckets, labelled by source — generalising the `server/client-teams.ts:64` UNION. Team membership is display-only; it changes no permissions.
6. **Client scoping.** When `opts.scopeCompanyId` is set, properties are filtered through the same rule as `isPropertyInScope` (own rows only), instructions through the counterparty rule used by `dealsClientScope` (`server/brand-profile.ts:287-289`), fees/team columns stripped, interactions emptied — the resolver *reuses* those SQL fragments; it does not invent a second scope language.

**What it reuses vs replaces.** Reuses: `dealTotalsSql`, `PENDING_CONTACT_SUGGESTIONS_SQL`, the contact-stats query shape, the client-teams union pattern, `isPropertyInScope`'s rule. Replaces (in Delivery 2, at the brand-profile call site only): the landlord_id-only `ownedPropertiesQ` (`server/brand-profile.ts:428-437`) and the single-company `contactsQ` — both become thin projections of `AccountView` for `kind=landlord` companies. The resolver itself is additive; nothing stops the tenant path working as before.

**Verification.** `server/account-resolver.test.ts` (node:test): cycle protection on an A→B→A fixture (terminates, flags unresolved); instruction-vs-related-activity split on a tenant-rep-at-owned-centre fixture; contact dedup across employer + property paths; scope filtering never adds rows for a scoped viewer; a pool spy asserting zero mutating statements (`INSERT|UPDATE|DELETE`) during resolution. Where helpers are pure (tree walk over an injected adjacency map, deal classification), test them without a database; DB-backed tests follow the Delivery 1 pattern and skip when no test database is configured.

## Task 3: Exact property matching — no automatic change on ambiguity

**Problem.** `autoLinkScrapedProperties` (`server/landlord-scraper.ts:454-530`) links on exact normalised name or exact postcode, but builds `byPostcode` as a `Map` that silently keeps the last row when two CRM properties share a postcode (`:473-479`) — an ambiguous postcode can win an automatic `landlord_id` write. `CompanyPropertiesBoard.tsx` dedups discovery by shared postcode the same way (`:517-527`), which is fine for display (read-only) but the write path must be stricter.

**Required changes.**
1. In `autoLinkScrapedProperties`, build `byPostcode` as `Map<string, row[]>`; a postcode hit with `length !== 1` is recorded in `skipped` with reason `"ambiguous postcode — N CRM rows share it"` and **no UPDATE is issued**. Name matches stay unique-or-skip.
2. Add a country guard (after Task 4 lands): a scraped item whose source country is known and whose postcode-format doesn't fit that country (UK postcode regex against `country='IE'`/`'FR'`) is skipped as `"country/postcode mismatch"` rather than linked.
3. The board's client-side `alreadyLinked` dedup may stay as-is (it only hides rows), but surface the ambiguity: discovery items whose postcode matches >1 CRM property get a "review" badge instead of a plain "Add to CRM" button. Keep `PropertyManageActions` (reallocate/unlink/delete, `CompanyPropertiesBoard.tsx:157-277`) as the human escape hatch.
4. Do not touch existing `landlord_id` assignments. Wrong historical links are fixed by a human via Reallocate, not by migration.

**Verification.** Extend (or add) a test around the linking decision — factor the match decision into a pure `decidePropertyLink(scraped, candidates)` export and test: exact name link, exact unique postcode link, duplicate-postcode → skip with reason, country mismatch → skip, existing different landlord → skip (already covered behaviour, keep green). `npm run check` passes.

## Task 4: Country-aware discovery (Dundrum, Les 3 Fontaines, La Vallée Village)

**Problem.** Discovery assumes the UK everywhere: the scrape prompt says "UK commercial landlord" (`server/landlord-scraper.ts:126`), ScraperAPI is pinned `country_code=uk` (`scraperFetch(url, { uk: true, ... })`, `landlord-scraper.ts:179`; `server/utils/scraperapi.ts:79`), the geocode query string appends a literal `"UK"` (`landlord-scraper.ts:288`), and the geocoder hard-filters `components=country:GB` (`server/geocode.ts:71`). Production evidence: "Dundrum Town Centre" geocoded to "Dundrum, Newcastle BT33, UK"; French assets displayed as "United Kingdom". Uncertain matches must stay unresolved rather than acquiring a guessed location.

**Required changes.**

1. **Shared country helpers** — extract `COUNTRY_TAIL_TO_ISO` / `inferCountryFromAddress` (`server/brand-profile.ts:33-50`) into `shared/geo-country.ts`, add `countryNameFromIso(iso)` ("IE" → "Ireland") and `UK_POSTCODE_RE`. Update brand-profile to import from the shared module.

2. **Capture source country from page context** (`landlord-scraper.ts`):
   - Extend `buildPrompt` (:121-144): drop "UK" from the framing; ask for a landlord-level `home_country` (ISO-2, from footer/contact page/about) and a per-property `country` (ISO-2, from the asset page's own context — `/ie/` URLs, Irish addresses, French copy). Null when not evidenced — never guessed.
   - `LandlordFindings.properties` items gain `country?: string | null`; the findings JSONB carries it through (no migration — the column is JSONB).
   - ScraperAPI egress country: keep `uk: true` for the fetch (it only picks the proxy exit and works fine on .ie/.fr sites); optionally thread `home_country` into a new `country?: string` option on `scraperFetch` (`buildScraperUrl` already takes `country_code`) once known — an optimisation, not a correctness fix.

3. **Geocode with a country hint** (`server/geocode.ts`):
   - `geocodeOne(query, opts?: { countryHint?: string | null })` and `geocodeBatch(items: Array<{ query: string; countryHint?: string | null }>, concurrency)`. When a hint is present: `region=<hint lowercase>` and `components=country:<HINT>`. When absent: keep today's UK bias (`region=uk`, `components=country:GB`) so existing UK-only callers are untouched.
   - **Validate the result against the hint:** read `address_components` from the same Geocoding API response (no extra call); if `country.short_name` ≠ the hint, treat the lookup as unresolved — cache a NULL miss and return nulls. This is the exact fix for Dundrum→Newcastle: with hint `IE`, the BT33 result fails validation and the asset stays unplotted instead of wrongly plotted.
   - **Cache key includes the hint:** `${cacheKey(query)}|${hint ?? ""}`. Old poisoned entries keyed under `"dundrum town centre, uk"` are simply never hit again — no cache purge needed.
   - In `landlord-scraper.ts:285-297`, build each query as `[name, postcode, address, countryNameFromIso(country) ?? (country ? null : "UK")]` — the literal `"UK"` is only the fallback when the scrape found no country evidence — and pass the hint into `geocodeBatch`. Unresolved items store `lat/lng = null` and keep their `country`; the board already tolerates null coords (markers are skipped, the row still lists).

4. **Repair existing wrong rows — reviewed, per-row, no bulk destructive updates.** New `scripts/repair-landlord-geocodes.ts`:
   - Default mode is a **read-only report**: for every `landlord_website_findings` row, list scraped properties whose `formatted_address` tail country (`inferCountryFromAddress`) contradicts the item's `country` (or whose formatted address says UK while the item name matches a known non-UK baseline destination — Task 5's seed list doubles as the check list here), plus `crm_properties` rows with `country IS NULL` and a postcode that isn't a UK postcode.
   - `--apply` mode re-geocodes only the flagged findings entries with the correct hint and writes back just those JSONB array elements; an entry that comes back unresolved keeps its old `formatted_address` and gets its coords nulled — nothing is deleted, every write is logged with before/after.
   - For `crm_properties` rows that were created from bad discoveries, `--apply` sets `geocode_status='needs_review'` and clears coords only where the new hinted geocode either resolves (coords + `country` updated) or is confirmed mismatched. No `UPDATE` without a per-row evidence line in the report.

**Verification.** `server/geocode-country.test.ts`: hint flows into the request URL; hint/result country mismatch → unresolved NULL-cache; cache keys differ by hint; missing hint preserves the legacy GB filter. `shared/geo-country.test.ts` for tail parsing incl. "Dundrum, Newcastle BT33, UK" → GB vs a Dublin formatted address → IE. A pure `buildGeocodeQuery(item)` helper test covers the "UK only as fallback" rule. `npm run check` passes.

## Task 5: Hammerson reconciliation report

**Baseline encoding.** Seed `account_reconciliation_baselines` (Task 1) with `baseline_name='hammerson-official-destinations'`, one row per official destination — 11 rows, `category='destination'`:

| destination_name | country | official_group_key | expected_crm_property_count |
|---|---|---|---|
| Manchester Arndale | GB | — | 1 |
| Brent Cross | GB | — | 1 |
| Bullring & Grand Central | GB | bullring-grand-central | 2 |
| Cabot Circus | GB | — | 1 |
| The Oracle | GB | — | 1 |
| Westquay | GB | — | 1 |
| Dundrum Town Centre | IE | — | 1 |
| Ilac Centre | IE | — | 1 |
| Pavilions | IE | — | 1 |
| Les 3 Fontaines | FR | — | 1 |
| Les Terrasses du Port | FR | — | 1 |

Each row carries `source_url` (the Hammerson portfolio page it was taken from) and `source_date`. Bullring & Grand Central is ONE official row expecting TWO CRM properties (Bullring, Grand Central) — legitimate grouping handled by `official_group_key` + `expected_crm_property_count`, so the CRM rows stay separate. Development sites and disposed assets are seeded as separate rows with `category='development'` / `'disposed'` and excluded from the "all destinations accounted for" gate — they report in their own sections.

**Generation flow** — `server/account-reconciliation.ts`, `generateReconciliationReport(companyId, baselineName)`:
1. `resolveAccountView(companyId)` (staff scope).
2. For each baseline row, match against `AccountView.properties` by `normalisePropertyName` exact match, then exact postcode — the same strict rules as Task 3; ambiguous or absent → the row's `unresolved_differences` explains why (never a guessed match).
3. Row shape (stored in `account_reconciliation_runs.rows` jsonb): `{ destination_name, source_url, source_date, country, category, relationship_role, ownership_stake_pct, crm_property_ids, owning_entity_names, bgp_instruction: boolean (any AccountInstruction on those property ids), media_count (image_studio_images count per property), status: 'matched' | 'partial' | 'unresolved', unresolved_differences: string[] }`.
4. Extra CRM properties in the account view that match no baseline row append as `status: 'extra_in_crm'` rows — reconciliation is symmetric.
5. Persist a run snapshot per generation; the UI reads the latest.

**Route + UI placement.** `GET /api/accounts/:id/reconciliation?baseline=hammerson-official-destinations` — **staff only**: if `resolveCompanyScope(req)` returns non-null, respond 403. The report never writes to permission tables and never feeds `isPropertyInScope`; "report scope does not change client access" is honoured by the report simply not existing for client logins. UI: a "Reconciliation" card rendered by `CompanyPropertiesBoard.tsx` when `kind='landlord'`, the viewer is staff (`!cpbIsClient`, the check already at `:359-361`), and a baseline exists for the company — a compact table of the columns above with status chips, plus the generation timestamp. No new page.

**Verification.** `server/account-reconciliation.test.ts`: seed fixture → all 11 destination rows accounted for; Bullring & Grand Central reports `matched` only when both CRM ids resolve (and `partial` with one); development/disposed rows don't count against the destination gate; a tenant-rep deal at Brent Cross shows as related activity, not a Hammerson instruction (`bgp_instruction` unaffected); a client-scoped request to the route returns 403 (test the guard helper, not the wire). `npm run check` passes.

## Phased task breakdown and acceptance checks

| Phase | Tasks | Acceptance check (maps to the Delivery 2 gate) |
|---|---|---|
| 1 | Task 1 migrations + schema.ts updates | All four migrations apply + re-apply cleanly; `npm run check` green; zero existing rows modified (row counts + checksums before/after identical). |
| 2 | Task 2 resolver + tests | Cycle fixture terminates and flags; tenant-rep-at-centre is RelatedMarketActivity, not an instruction; resolver issues no writes; scoped viewer sees no extra rows. |
| 3 | Task 3 exact matching + tests | Duplicate-postcode fixture produces no UPDATE; `skipped` carries the ambiguity reason. **Gate: "Ambiguous postcode causes no automatic ownership change."** |
| 4 | Task 4 country-aware discovery + repair script | Dundrum with hint IE no longer resolves to BT33 (mismatch → unresolved); French assets keep `country='FR'` and never display "United Kingdom"; repair script defaults to read-only and `--apply` writes are per-row logged. |
| 5 | Task 5 reconciliation + UI | Report shows all 11 official destinations, Bullring & Grand Central as one grouped row with two CRM ids; development/disposed in separate categories; **Gate: "All official destinations accounted for, including legitimate grouped properties."** Client login → 403 on the route, and client-visible profile payloads are byte-identical before/after this delivery. **Gate: "Report scope does not change client access."** |

## Out of scope for Delivery 2 (do not implement)

- The dedicated landlord workspace page, full deal pagination (Delivery 3)
- Automatic preparation/media pipeline changes (Delivery 4)
- Folder tree migration, entity-level KYC (Deliveries 5, 7)
- Backfilling relationship roles onto existing `crm_company_properties` rows (human curation, post-Delivery 2)
- Bulk geocode repair of unrelated UK-only properties (the repair script's scope is landlord discovery rows + their created CRM properties)

## Explicit uncertainties (verified against the tree at 5dcdc5a7)

- `landlord_website_findings`, `landlord_dismissed_discoveries` and `geocode_cache` are created at runtime via `ensureTable()` (`server/landlord-scraper.ts:35-68`, `server/geocode.ts:17-30`) and are NOT in `shared/schema.ts`. Task 4 stores per-property country inside the existing `properties` JSONB — no migration for that table; if the implementer prefers typed columns, that becomes a fifth migration and should be argued separately.
- Migration application path: the repo has `migrations/` with a drizzle `meta/_journal.json`, a separate `scripts/migrations/`, and `npm run db:push` (drizzle-kit push). Which of these actually runs `0041-0044` against production should be confirmed before Phase 1 lands; the SQL is written to be safe under any of them (additive, idempotent).
- No ownership-stake or JV concept exists anywhere in the schema today (verified — `crm_company_properties` is a bare pair, `crm_properties` has the freeholder/long-leaseholder/lender stack only). Task 1 introduces it as net-new nullable columns; any existing production convention for recording JV stakes should be checked with the team before the first human data entry.
- `brand_stores.country` exists (`server/brand-profile.ts:417` selects it) but its format/controlled vocabulary was not verified; Task 4's shared ISO-2 helpers should align with it if the formats differ, in a separate commit.

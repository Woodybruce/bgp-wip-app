# Landlord/client boards — Delivery 3: the landlord workspace layout

Source: "BGP landlord and client boards — implementation plan" (2026-09-20), Delivery 3 only.
Codebase: bgp-wip-app @ 45d0216f (branch `claude/landlord-delivery-3-JOGQK`, cut from `origin/claude/terminal-coding-interface-JOGQK`), post Delivery 1 + Delivery 2 (migrations 0041–0044 applied, resolver + reconciliation live).

Delivery 3 scope (verbatim, from the master plan/brief): "Dedicated landlord workspace layout on the existing company page — real deal rows (paginated account deal list backed by the account resolver, not the old capped-at-20 query); BGP client team view replacing/augmenting the old Coverage; unified contacts section (employer ∪ account/property relationships); next actions from My Tasks; layout: Overview / Portfolio / Deals & activity / People & team; investment strategy only when actual investment-requirement records exist."

Acceptance gates (from the brief):
- At least 25 deals remain correctly counted across pagination — totals independent of page size.
- A deal linked to parent + subentity, or via multiple joins, appears exactly once (dedupe by deal id).
- Tenant-representation deals at account centres are labelled related activity, never "client instruction".
- Existing deep links and edit flows on the company page keep working (old query params / anchors / dialogs).
- Fees only where the current user already has fee visibility (the existing bpScope rule); when in doubt, omit.

## Global Constraints

- No new migrations. Nothing in this delivery needs a column that doesn't exist; the deal list's "next action" comes from `user_tasks` links, not a new deal field. (Brief: "No new migrations unless absolutely necessary" — it isn't.)
- The resolver (`server/account-resolver.ts`, Delivery 2) is the single source for account-scoped data on this page: entity set, portfolio, instruction-vs-related classification, contacts, base team. New endpoints call `resolveAccountView` and then enrich — they never invent a second account-scope SQL of their own.
- Permissions never widen. `scopeCompanyId` from `resolveCompanyScope(req)` (staff pass `null`) flows into the resolver exactly as Delivery 2; fees and internal tasks are staff-only (same rule as the brand-profile fee strip, `server/brand-profile.ts:1013-1017`); team stays empty for scoped viewers (resolver behaviour, kept).
- Match existing code style: TypeScript, raw SQL via `pool.query`, lazy pool + `deps.pool` injection for tests, node:test via tsx. Test command: `node --import tsx --test <file>`. Typecheck: `npm run check`.
- No new npm dependencies. Client reuses existing components (`CompanyContactsBoard` / `KeyContactRow`, `Pill`, `Badge`, `Card`) and the existing design language of `brand-profile-panel.tsx`.
- One commit per task; the implementer commits its own work.
- Do NOT push, deploy, or touch any database — the parent agent merges and deploys.

## What already exists (do not rebuild)

- **Account scope assembly** — `resolveAccountView(companyId, { scopeCompanyId })` (`server/account-resolver.ts`): entity tree (cycle-safe), portfolio with roles, `instructions` vs `relatedMarketActivity` (`classifyDealForAccount`), deduped contacts with `via[]` + interaction stats, base team with `sources[]`, deduped totals.
- **Canonical deal statuses** — `shared/deal-status.ts` (`legacyToCode`, `DEAL_STATUS_LABELS`, `DEAL_STATUS_COLORS`) and `isCompletedDealStatus` (`server/brand-profile-deals.ts`). Stage/status labels and chips reuse these verbatim.
- **Fee visibility rule** — the brand profile strips `fee`/`team`/`internal_agent` for any resolved client scope (`bpScope`, `server/brand-profile.ts:1013-1017`) and nulls `dealTotals.totalFees` (`:921`). That bpScope check IS the existing permission helper for fees; this delivery applies the same rule and renders no fee column for scoped viewers.
- **Team board** — `server/client-teams.ts` (curated board incl. `is_lead`, same-named sibling expansion via `boardCompanyIds`) and `ClientTeamOrgChart` (client). The resolver's team assembly already unions curated ∪ property agents ∪ deal contributors.
- **Contacts board** — `CompanyContactsBoard` / `KeyContactRow` (`client/src/components/company-contacts-board.tsx`): one deduped list, interaction touches, discovery cascade, landlord role-filter bypass (`isLandlord` prop, Delivery 1).
- **Tasks** — `user_tasks` (`server/index.ts:255`) with `linked_deal_id` / `linked_property_id` / `linked_contact_id`, `status='done'` for completed, owner = `user_id` → `users`. `/api/tasks` (server/routes.ts:9060) shows the join shape (deal_name/property_name/contact_name/assignee_name).
- **Investment requirements** — `crm_requirements_investment` (`shared/schema.ts:1075`) with `company_id`.
- **Landlord layout primitives** — Delivery 1 already gates tenant-only blocks behind `!isLandlord`, renders "Landlord conversation" half-width on desktop, and the mobile section pills (`panelSection`, `panelSec`, `brand-profile-panel.tsx:405-406,1061-1067`). `CompanyPropertiesBoard` renders inside the landlord panel (`:1286-1290`).
- **Route mounting** — `app.use(accountReconciliationRouter)` (`server/index.ts:4134`) is the pattern; Delivery 2's `GET /api/accounts/:id/reconciliation` is the sibling route.

## Task 1: `GET /api/accounts/:id/deals` — the paginated account deal list

**Module:** new file `server/account-deals.ts`, router mounted in `server/index.ts` next to `accountReconciliationRouter`.

**Flow.** `requireAuth` → `resolveCompanyScope(req)` → `resolveAccountView(companyId, { scopeCompanyId }, { pool })`. The union of `view.instructions` ∪ `view.relatedMarketActivity` defines the deal universe (already deduped by deal id and already classified — a tenant-rep letting at an account centre arrives as related activity). One enrichment query over `crm_deals` by `id = ANY($1)` fetches display columns; one query over `user_tasks` fetches the next open action per deal. Classification metadata (bucket, partyEntityId, activityKind) comes from the resolver's lists keyed by deal id — never re-derived with new rules.

**Row shape (per deal):**

```ts
{
  dealId, name, bucket: "instruction" | "related",  // related = related market activity
  activityKind: "tenant_rep" | "investment" | "other" | null,
  partyEntityId: string | null,                     // for the entity filter
  propertyId, propertyName, unitName: string | null, // unit via d.unit_id → property_units / tenancy_schedule_units name, best-effort
  counterparty: string | null,                      // the counterparty that is NOT the account (tenant for landlord instructions, landlord for related tenant-rep, vendor/purchaser counterparties for investment)
  service: string | null,                           // d.deal_type
  status: string | null,                            // canonical label via shared/deal-status on the client
  stage: string | null,                             // d.stage
  team: string[],                                   // d.team ∪ d.internal_agent (staff only; [] for scoped)
  lastActivityAt: string | null,                    // GREATEST(d.updated_at, interactions not per-deal — updated_at is the honest field)
  instructedAt, targetDate, completedAt: string | null,
  fee: number | null,                               // ONLY present when staff — key omitted entirely for scoped viewers
  nextAction: { taskId, title, ownerName, dueDate } | null,  // earliest-due open user_task linked to the deal
}
```

**Query params:** `page` (1-based, default 1), `pageSize` (default 25, max 100), `bucket` (`all`|`instruction`|`related`), `propertyId`, `entityId` (party entity), `service` (deal_type), `stage` (d.stage or canonical status code), `person` (BGP team member name match against team/internal_agent), `from`/`to` (ISO dates on `updated_at`). Filtering happens in JS after classification over the account's deal universe (bounded: one account's deals, not the whole table); pagination slices the filtered set. Completed work is never excluded — it's reachable via the stage/status filter (`COM`/`INV`).

**Response:** `{ deals: AccountDealRow[], total, completedTotal, page, pageSize, feesVisible, entities: [{companyId, name}], properties: [{propertyId, name}] }` — `entities`/`properties` echo the resolver's sets so the filter dropdowns are option-complete without a second resolver call. `total`/`completedTotal` are computed over the filtered set BEFORE slicing — totals are independent of page size by construction. `feesVisible = scopeCompanyId == null`.

**Dedupe.** The universe is built from two resolver lists keyed by deal id; the enrichment query selects by id. A deal linked to parent + subentity (two counterparty FKs in the entity set, or FK + `crm_company_deals` link) appears exactly once — a test fixture proves it.

## Task 2: `GET /api/accounts/:id/workspace` — team view, unified contacts, next actions, investment requirements

**Module:** new file `server/account-workspace.ts`, same router-mount pattern. Calls `resolveAccountView` once, then layers four read-only enrichments. Everything here is staff-facing: for scoped viewers `team`, `nextActions` come back empty (the resolver already strips team; tasks are BGP-internal to-do lists — a client login's own `/api/tasks` is unchanged and untouched). Fees don't appear here at all.

**Response shape:**

```ts
{
  team: Array<AccountTeamMember & {
    isLead: boolean;                 // crm_client_team_members.is_lead across the client-teams boardCompanyIds set
    propertyNames: string[];         // which portfolio properties they're an agent on
    lastContributionAt: string | null; // latest interaction they evidencably touched (interactions only — deal-update attribution was dropped: crm_deals has no per-person update trail)
  }>,                                // one row per person, resolver sources[] preserved: curated | property_agent | deal_contributor | recent_contributor
  contacts: Array<AccountContact & {
    employerName: string | null;
    propertyNames: string[];         // portfolio properties linking them (crm_contact_properties ∪ crm_property_clients)
  }>,
  nextActions: Array<{               // open user_tasks linked to the account via deal / portfolio property / account contact
    taskId, title, status, priority, dueDate: string | null,
    ownerName: string | null,
    linkKind: "deal" | "property" | "contact",
    linkId, linkLabel: string | null,
  }>,                                // sorted due-date asc, NULLS last; capped at 50
  investmentRequirements: Array<{ id, name, status, use: string[] | null, size: string[] | null, locations: string[] | null, updatedAt }>,
  totals: { deals, completedDeals }, // resolver totals, echoed for the overview summary
}
```

- **Team.** Start from `view.team`; add `is_lead` and per-person `propertyNames` from `crm_client_team_members` / `crm_property_agents` (same tables, same board-company expansion as `server/client-teams.ts:22-32`); add a fourth source `recent_contributor` for BGP users evidenced by `crm_interactions.bgp_user` on the account in the last 24 months, matched to `users` by exact name/email — unmatched strings are ignored (no guessed identities). One deduplicated row per user, role + sources shown.
- **Contacts.** `view.contacts` (already employer ∪ property ∪ property_client, deduped, with interaction stats) plus `employerName` (entity lookup) and `propertyNames` (restricted to the portfolio ids the resolver returned). Source = the existing `via[]`. No contact creation logic anywhere in this delivery.
- **Next actions.** `user_tasks` where `status <> 'done'` (and `completed_at IS NULL`) AND (`linked_deal_id` ∈ account deal ids ∪ `linked_property_id` ∈ portfolio ∪ `linked_contact_id` ∈ account contacts). Owner from `users`. This is the "next action / owner / due date" source for BOTH this card and Task 1's per-deal `nextAction` — one query shape, no new columns.
- **Investment strategy.** `crm_requirements_investment` rows with `company_id` ∈ entity set. Returned as-is; when there are no records the array is empty and the UI renders NOTHING — buying intent is never inferred from ownership. **Tightened at implementation:** scoped viewers get only their own company's rows (`company_id = scopeCompanyId`), not the whole entity set's — the entity tree is not a permission grant onto sibling entities' requirements.

## Task 3: Client — `AccountDealsBoard` (`client/src/components/account-deals-board.tsx`)

New card component, landlord pages only, placed in the BGP Relationship zone ("Deals & activity" for landlords):

- Filter row: bucket pills (All / Instructions / Related activity), property select, entity select, service select, stage select, BGP person select, date-from/date-to inputs. Options come from the deals response (`entities`, `properties`) plus the distinct service/stage/team values in the fetched universe — the endpoint returns them, no extra calls.
- Desktop (`md+`): table — Property/Unit · Counterparty · Instruction/Service · Stage (canonical status chip via `DEAL_STATUS_LABELS`/`DEAL_STATUS_COLORS`) · BGP team · Last activity · Next action (title · owner · due). Related rows carry a "related activity" badge in place of an instruction label, so a tenant-rep letting can never read as a client instruction.
- Phone: the same rows as stacked cards (`md:hidden` list), no wide table.
- Fee column rendered only when `feesVisible` is true (server omits the field otherwise — defence in depth, matching the brand-profile strip rule).
- Pagination footer: "Showing X–Y of N" + prev/next; pageSize fixed at 25. `completedTotal` shown as a subdued "N completed" note so completed work is visibly a filter away, not deleted.
- Deal names link to the existing `/deals?id=<id>` deep link; property names to `/properties/<id>`.

## Task 4: Client — People & team, next actions, investment strategy, landlord layout

All edits confined to the landlord (`isLandlord`) branches; tenant/brand pages render byte-for-byte as before.

1. **Team view** — new `AccountTeamCard` (in `client/src/components/account-workspace-cards.tsx`): one deduplicated list from `workspace.team` — account lead pinned first with a "Lead" pill, then everyone else with role + source pills (`curated` → team-group name, `property_agent` → "Property team · <properties>", `deal_contributor` → "Deal team", `recent_contributor` → "Recent activity"). Sits beside the existing `ClientTeamOrgChart` editor (which stays — it's the editing surface; the new card is the unified read view the brief asks Coverage to become). The old "Coverage:" row keeps working for non-landlord pages untouched; on landlord pages the new card renders above it and the legacy coverers row stays as the editing entry point.
2. **Unified contacts** — `CompanyContactsBoard` gains optional additive props: when rows carry `via`/`employerName`/`propertyNames` (only the landlord account payload supplies them), render a compact filter row (employer select, property select, role text input) above the list and a source chip per row. For landlords the sidebar board is fed `workspace.contacts` (mapped to the existing contact shape: `id`, `name`, `role`, `email`, `phone`, `linkedin_url`, `avatar_url`, `interaction_count`, `last_interaction_at`) instead of the root-only `data.contacts`. Brands get the old call signature — no behaviour change. Discovery cascade, pending senders, promotion: untouched.
3. **Next actions** — `AccountNextActionsCard`: owner · due date · linked deal/property/contact chip linking to the existing pages. Bounded at 8 rows + "View all in My Tasks" link to `/tasks`. Rendered in the landlord Overview column (right of chat/key summaries on desktop, stacked on phone). Empty → the card renders nothing (no placeholder noise).
4. **Investment strategy** — small card listing `workspace.investmentRequirements` (name, status, use/size/locations), rendered only when the array is non-empty. Landlord + staff; scoped viewers see their own company's records only (see Task 2 tightening). Never inferred.
5. **Layout** — landlord mobile pills relabelled (keys unchanged, so no state/deep-link changes): Profile → `Overview`, Ownership → `Portfolio`, Relationship → `Deals & activity`, Contacts & media → `People`. `panelSec` keys are untouched; desktop renders all zones as today. The new Deals board goes in the relationship zone; People zone content (sidebar `CompanyContactsBoard` + `ClientTeamOrgChart`) is unchanged in location. Bounded summaries: next actions capped at 8, investment requirements at 5, with "View all" affordances.

**Deep links / edit flows.** Nothing in `companies.tsx` page-level routing, query-param handling, `ContactFormDialog`, `BgpTeamMenu`, or `PropertyManageActions` is modified; the new endpoints are additive GETs; pill state keys are unchanged. Verification includes a grep that every removed/relocated block keeps its `data-testid`s where the block still exists.

## Task 5: Tests

Same pattern as Delivery 2: lazy pool + `deps.pool` injection, regex-routed mock querier, no live database.

**`server/account-deals.test.ts`:**
- 30-deal paginated fixture: `total` is 30 at pageSize 10 and 25; the union of pages 1–3 at pageSize 10 is 30 distinct ids (totals independent of page size; >25 deals counted).
- Dedupe: a deal with landlord_id=parent AND vendor_id=subsidiary (plus a `crm_company_deals` link) appears exactly once across all pages.
- Tenant-rep at an owned centre → `bucket: "related"`, `activityKind: "tenant_rep"`; never an instruction.
- Filters: property, entity, service, stage, person, from/to each narrow the set as expected; `COM` deals reachable via stage filter.
- Scoped viewer: `feesVisible` false and no `fee` key on any row; team arrays empty; the deal set matches the resolver's scoped universe.
- Pool spy: zero mutating statements.

**`server/account-workspace.test.ts`:**
- Team: one row per user across curated + property-agent + deal-contributor + interaction-evidenced sources; `is_lead` surfaced; unmatched `bgp_user` strings produce no row.
- Contacts: employer + property-linked contact carries both `via` entries, `employerName`, `propertyNames`; interaction stats preserved.
- Next actions: tasks linked via deal / property / contact all surface with owner + due date; done tasks excluded.
- Investment requirements: present when rows exist, empty array otherwise.
- Scoped viewer: `team` and `nextActions` empty, contacts scoped exactly as the resolver scopes them.

**Client:** no new test harness exists for components (Delivery 1/2 shipped none) — client correctness is by `npm run check` and reusing already-tested components.

## Phased task breakdown and acceptance checks

| Phase | Tasks | Acceptance check |
|---|---|---|
| 1 | Task 1 deals endpoint + tests | 30-deal fixture paginates with stable totals; multi-link deal appears once; tenant-rep-at-centre is `related`; scoped viewer gets no fees. |
| 2 | Task 2 workspace endpoint + tests | Team deduped with lead + sources; unified contacts carry employer/property/source; tasks surface via all three link kinds; investment records only when they exist. |
| 3 | Task 3 deals board UI | Filters + pagination work; mobile renders cards; fee column absent for clients; deal/property deep links unchanged. |
| 4 | Task 4 people/layout UI | Landlord page composes Overview / Portfolio / Deals & activity / People; tenant pages unchanged (`npm run check`, testid preservation). |
| 5 | Full verification | `npm run check` clean; the Delivery-1/2 test files + both new test files all green under `node --import tsx --test`. |

## Out of scope for Delivery 3 (do not implement)

- Contact creation/editing logic (existing dialogs and promotion flows are reused as-is).
- Editing the curated team board from the new team card (ClientTeamOrgChart stays the editor).
- Automatic preparation/media pipeline changes (Delivery 4).
- Folder tree migration, entity-level KYC (Deliveries 5, 7).
- Reconciliation UI changes (Delivery 2 shipped it; untouched).
- Any migration, any write endpoint, any change to `/api/tasks` or `/api/client-teams` semantics.
- Backfilling `relationship_role` or any other data (human curation, post-Delivery 2).

## Explicit uncertainties (verified against the tree at 45d0216f)

- `crm_deals` has no "next action" column; `user_tasks` links are the evidence-backed source the brief points at ("surface My Tasks items related to the account"). Per-deal next action = earliest-due open linked task; deals with no linked task show "—", never a guessed action.
- `user_tasks.status` vocabulary seen in the client: `todo` / `in_progress` / `done` (`client/src/pages/tasks.tsx:140,401`). Open = `status IS DISTINCT FROM 'done' AND completed_at IS NULL`.
- `crm_interactions.bgp_user` is a free-text name/email (`shared/schema.ts:1447`); matching it to `users` is exact `lower(name)`/`lower(email)` only — ambiguous or unmatched strings contribute nothing rather than a guessed identity.
- The unit name on a deal: `crm_deals.unit_id` → `property_units`, `tenancy_unit_id` → `tenancy_schedule_units`; both are best-effort LEFT JOINs — a deal with neither shows the property only.
- The landlord page is also visible to that landlord's own client login; under scope the resolver strips team/fees/interactions, so the workspace/deals endpoints degrade to properties + instruction rows + own-account investment records. This matches the Delivery 1/2 client-parity decisions without widening anything.

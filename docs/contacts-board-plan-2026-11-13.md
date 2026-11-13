# Shared contacts board, slice 1: the property page's People tab (final build plan)

13 November 2026. Design only: nothing in the repository was changed. Checked against `/home/user/bgp-wip-app` at
HEAD `b9bcd3c3` (branch `claude/sleepy-gates-grb2ww`; since the first draft at `4aa54e7c` only
`server/property-units.ts` moved, by 12 lines, none of them used here). No live database was used. Nothing was
tried in a browser.

Woody asked "I feel like we need all boards to use the same Contacts approach?" and approved "Build the shared
contacts board next, property page first", plus closing the leak that sends a contact's last interaction to
client logins. On 13 November he also said "there is no anthropic only rule". This slice uses no AI, so nothing
in it depends on that.

**Baseline at `b9bcd3c3`, recorded now so "no new failures" can be checked:**
- `npm run qa:regression`: 1754 tests, 1700 pass, 0 fail.
- `npm test`: 507 tests, 501 pass, 6 fail. All six are in `server/investment-sale-evidence.test.ts` (tests 126 to
  130 and 132) and have nothing to do with contacts.
- `qa/regression/property-page-labels.test.mjs`, `portfolio-contacts.test.mjs`,
  `landlord-contact-suggestions.test.mjs` and `brand-contacts-parity.test.mjs` all pass (37 of 37).

Every acceptance line below means: the named command passes, and the two suites show no failure beyond that
baseline.

---

## 1. What is shared, and what is not yet

| Board today | Server read | Row | Hand-set store |
|---|---|---|---|
| Property Contacts card (classic page, and the plan-led People tab, `property-detail.tsx:1329-1346`) | `GET /api/properties/:id/linked-contacts` (`server/property-asset-brief.ts:1139`) | `personRow` in `LinkedContactsPanel` (`client/src/pages/properties.tsx`), `InlineAgents`, `PropertyBgpTeamFromWork` | `property_contact_overrides` (pin/hide), `crm_property_agents` |
| Client portfolio board | `loadPortfolioContacts` (`server/portfolio-contacts.ts:214`) | `PortfolioContactsBoard` | reads `crm_property_clients` and the overrides |
| Landlord and brand pages | `server/account-resolver.ts`, brand profile | `CompanyContactsBoard` / `KeyContactRow` (`company-contacts-board.tsx:74`) | `crm_contacts.role` (global job title) |
| Unit brief | `server/unit-brief-workspace.ts` | brief People tab | `unit_brief_people` |
| Deal page | `/api/crm/contacts` | plain cards | nine contact columns on `crm_deals` |

**Decisions.**
- **The shared row is `KeyContactRow`.** Every person with a CRM record, on every board, is drawn by it. The
  property board is the first new board to use it. A BGP person (a `users` row) and a company with no named
  person keep a one-line row in the board file.
- **The shared client rule is `recordPersonForViewer()`** in the new `shared/record-people.ts`: one allow-list,
  applied on the server to every entry. The staff test is `contactViewer(req)` in the new
  `server/contact-viewer.ts`, which returns `{ staff: await canReadLandlordMeetings(req) }`
  (`server/landlord-meetings.ts:306`: not a client, no company scope, BGP address, role not Client, active). This
  is the "one `contactViewer(req)`" the 12 November contact plan asked for.
- **The shared evidence pieces** are `evidence()` and the occupier CTEs in `server/portfolio-contacts.ts`. They
  are exported unchanged and reused by the new property read, `server/property-people.ts`. The portfolio query's
  text does not change: a golden test pins it byte for byte.
- **Groups are not shared yet.** `PEOPLE_GROUPS` (section 2) is the property board's vocabulary in this slice. The
  portfolio board keeps its four keys (`internal`, `deals`, `tenants`, `consultants`) until it converts in a
  later slice. Nothing says "shared groups" until a second board reads them.

## 2. The property's people

### Groups (`PEOPLE_GROUPS`, in this order; a person sits in the first group any relationship puts them in)

All groups show at once, under sub-heads. The pill row above them is a filter with "All N" first and selected,
and a count on each pill (`docs/DESIGN.md` §5, `Pill` from `client/src/components/ui/pill.tsx`).

| key | Sub-head | Evidence (property mode, `$1` = the page's property id) | Role shown | Client sees it |
|---|---|---|---|---|
| `bgp` | BGP team | `crm_property_agents` (`source: "assigned"`; the board draws these only through `InlineAgents`, never as rows); BGP users on open deals and the owner's account team (the two queries moved to constants, WP-A); `unit_brief_people.role = 'bgp_agent'` | set (`pa.role`), else derived ("Leasing", "On deals", "BGP agent on <unit> brief") | name, email, phone and role only, never the deal, source or via |
| `client` | Client's team | `crm_property_clients` (role set, `pc.role`); `unit_brief_people` with `client_leasing`, `senior_asset_manager`, `asset_manager` (role from `BRIEF_PERSON_ROLES` label) | set | yes |
| `owner` | Landlord and owner | owner-company contacts whose job title contains "director"; `crm_contact_properties` rows whose contact is at an owner company; owner-company contacts with `last_interaction IS NOT NULL` ("In touch with BGP") | derived: "Director", "Linked to this property", "In touch with BGP" | yes, except "In touch with BGP": staff only |
| `units` | Tenants and agents, by unit | occupier company entries from `resolved_occupiers` (one per company), with `lastContactPerson` (staff); deal `tenant_contact_id` and `leasing_agent_contact_id`; tracker parties (company entries); `unit_brief_people.role = 'joint_agent'`; viewing `contact_id` and `agent_contact_id`; offer `contact_id` | "Tenant", "Leasing agent", "Joint agent", "Viewed", "Agent at a viewing", "Offer" | yes, except viewings, offers and `lastContactPerson`: staff only |
| `deals` | Others on deals | the other seven deal contact columns, as `portfolio-contacts.ts:59-63` names them; agent firms on `crm_company_properties` (company type `Agent%` or `agent_type` set), as company entries | the column's label; "Agent firm" | yes |
| `advisers` | Advisers | contacts at `crm_company_properties` companies of consultant type (the predicate at `portfolio-contacts.ts:92-95`); `crm_contact_properties` rows whose company is consultant-type | the company type | yes |
| `added` | Added by the team | `property_contact_overrides kind = 'pin'`; any other `crm_contact_properties` link ("Linked to this property") | "Added by the team" / "Linked to this property" | yes |

Within each group, set roles come first, then names A to Z, for every login. Order never shows recency.

**Owner companies** (`owners` CTE): `crm_properties.landlord_id`, `freeholder_id`, `long_leaseholder_id`, plus
any `crm_company_properties` company that is not `company_type ILIKE 'tenant%'`, not `ILIKE 'Agent%'`, has
`agent_type IS NULL`, and is not consultant-type. This is narrower than the classic card, which takes every
linked company.

**Deals on this property** (property mode's own `pdeals` CTE, never the portfolio's): `crm_deals d LEFT JOIN
property_units pu ON pu.id = d.unit_id LEFT JOIN tenancy_schedule_units ts ON ts.id = d.tenancy_unit_id WHERE
d.property_id = $1 OR pu.property_id = $1 OR ts.property_id = $1`, the same test as the classic card
(`property-asset-brief.ts:1276-1278`). It outputs `$1::text AS here_property_id`.

**Hidden.** Every property-mode branch tests `NOT EXISTS (... o.contact_id = <contact> AND o.property_id = $1 AND
o.kind = 'hide')`, always with the page's `$1` and never with `d.property_id` or `a.property_id`. That way a
contact hidden on the property stays hidden when the deal reaches the property only through its unit. The board
shows "N hidden · restore" through the existing override routes.

**Occupiers** are company entries, never every contact at the company. A staff reply adds `lastContactPerson`:
`LATERAL (SELECT ... FROM crm_contacts WHERE company_id = <occupier> AND last_interaction IS NOT NULL ORDER BY
last_interaction DESC LIMIT 1)`. The same rule applies to a live deal's tenant company. The portfolio's "every
contacted person at the brand" branch is not used.

**Who counts as BGP.** Side and group come from the relationship (a brief role, `crm_property_agents`, a deal's
internal agent), never from whether a `users` row exists. A user goes into `bgp` only when their email ends with
the BGP domain, their role is not `Client` and they are active. A Landsec login on a brief as `client_leasing`
goes to `client`. A brief person with no `user_id` and no `contact_id` becomes a one-line row (name and firm).

### Which unit a relationship is on (resolved on the server)

Each relationship carries `scheduleRowId`, `trackerId` and `unitName`, resolved in SQL:
- `tracker_rows` CTE: every `available_units` row on the property, with its schedule row found by the **same four
  ties** as `TRACKER_ONLY_SQL` (`server/property-units.ts:113-121`), first match by the same order as `SPINE_SQL`.
  `property-people-guards` parses the ties out of both files and asserts that they are equal, so the two cannot
  drift. `server/property-units.ts` is not edited.
- A deal's row is `ts.id` when `d.tenancy_unit_id` is on this property, else the row of its tracker row
  (`a.deal_id = d.id`), else the schedule row with `property_unit_id = d.unit_id`.
- A brief person's row is the row of the brief's tracker row (`unit_briefs.unit_id`). Viewings and offers use
  their tracker row.

On the board, a relationship is on a unit when `rel.scheduleRowId === unit.scheduleRowId || (rel.trackerId &&
rel.trackerId === unit.trackerId)` (`peopleOnUnit`). Anything that matches no unit goes under a visible **"Not
tied to a unit"** sub-head, so nobody is dropped.

### A person's role on THIS property

- **Store: `crm_property_clients`, kept as is.** It already holds one role per person per property, and the
  portfolio board (`portfolio-contacts.ts:54`) and the landlord account board (`account-resolver.ts:653-658`,
  badge "property client") already read it.
- **Who may be given one: owner-company people only.** `PUT` refuses with a 400 ("A role at this property is for
  the owner's own people") unless the contact's `company_id` is in `owners`. Those people are already on the
  landlord's Key contacts board through their employer, so the only change there is the "property client" badge.
  No tenant, agent, brand or company-less person is added to a landlord's contacts. The menu item is drawn only
  on rows where `viewer.canSetRole` is true for that entry (`ownerPerson: true` in the feed).
- **Choices:** `PROPERTY_CLIENT_ROLES`, today's `CLIENT_ROLE_OPTIONS` (`properties.tsx`) moved to
  `shared/record-people.ts`. The unused `ClientBoardPanel` keeps its own copy and is not touched.
- **`property_contact_overrides` stays as is**: pin means "someone the evidence missed", hide means "a wrong row".
  Its routes, the client gateway line and the tested client pin/hide behaviour are unchanged.
- **Read:** `roleOnRecord()` takes the first relationship with `roleSource: "set"` in group order, else the
  derived role of the deciding relationship. The global job title is sent separately as `jobTitle`.
- **Write (BGP staff only, `contactViewer` true), new in `server/property-people.ts`:**
  - `PUT /api/properties/:id/people/:contactId/client-role` `{ role: string | null }`. In one transaction: `SELECT
    pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, then `UPDATE crm_property_clients SET role = $3 WHERE
    property_id = $1 AND contact_id = $2`, then `INSERT ... SELECT ... WHERE NOT EXISTS` when nothing was updated.
    `role: null` sets the role to NULL and **keeps the row**. A non-null role must be in `PROPERTY_CLIENT_ROLES`.
  - `DELETE /api/properties/:id/people/:contactId/client-role` removes the row. The menu item reads "Remove from
    the client's team", and its confirmation says "<name> will also leave <landlord>'s key contacts for this
    property". It is offered on any row that has a `crm_property_clients` link.
- **Wording, so it is not confused with the job title:** the menu item is "Role at <property name>", and the
  pill beside the name is "<role> · this property". `KeyContactRow`'s own "Edit role" / "Add role" (the global
  job title) stays exactly as it is.

## 3. The link to CRM strategy (staff only)

**Read.** One new export in `server/crm-engagement.ts`, so every read of `crm_engagement_*` stays in that file:

```ts
export async function planForCompanies(q: Queryable, companyIds: string[],
  here: { propertyId: string; tenancyUnitIds: string[] }):
  Promise<Map<string, { openCount: number; hereCount: number;
    next: { id: string; title: string; dueAt: string | null; ownerName: string | null; here: boolean } | null;
    strategies: Array<{ id: string; name: string; contactIds: string[] }> }>>
```

- **Actions:** the joins of `getCrmEngagementData`'s action query (`crm-engagement.ts:294-299`) with
  `eventPrivacyColumns`. Filter `l.company_id = ANY($1)` and `t.status <> 'done'`, then drop private-event rows
  with `isPrivateEmailRecord`. "Here" is `(to_jsonb(l)->>'property_id') = $2 OR (to_jsonb(l)->>'tenancy_unit_id')
  = ANY($3)`, read through `to_jsonb` so a database without the plan columns still works. Next is the soonest due
  action, with actions here first.
- **Strategies:** `crm_strategy_targets` joined to `marketing_campaigns` with `status = 'active'`, giving the name
  and `contact_ids`.
- `loadPropertyPeople` calls it once, for staff only. Any error (a missing table or column) is caught: the reply
  carries `plan: "unavailable"` and the people still load. It never returns a 500.
- **Here = the property id and its schedule row ids only.** Landsec scheme sibling records are left for later.
- **Last contact:** `crm_contacts.last_interaction` for a person, and the latest across its contacts for a
  company. Staff only.
- The row's `aside` reads "Last contact 3 Nov · Next: <title> 12 Dec · <owner>", or "N open actions", plus "In
  <strategy>" when the person is in that strategy's `contact_ids`.

**Add action from a person (staff, plan companies only).**
- The feed sends `companyKind: "landlord" | "brand" | "other"`, worked out with `EXISTS (SELECT 1 FROM
  crm_companies c WHERE c.id = co.id AND ${PLAN_COMPANY_PREDICATE})` and brand = `company_type ILIKE 'tenant%'`.
  The menu item shows only for `landlord` or `brand`.
- On open, the board fetches `GET /api/crm/engagement/options?companyId=&kind=` and `GET
  /api/crm/engagement?companyId=&kind=`, as `LandlordEngagementPanel` does. It mounts `ActionEditor`
  (`crm-engagement/dialogs.tsx:157`) with `companyId`, `kind` and `initial.notes = "About <person> at
  <property>[, <unit>]"`. It saves with `POST /api/crm/engagement/actions` exactly as that panel does, then
  invalidates the engagement key and `["/api/properties", id, "people"]`.
- **Place:** `actionPlaceFor(propertyId, scheduleRowId, options.sharePartners)` (pure, `shared/record-people.ts`)
  returns `{ propertyId, tenancyUnitId }` only for a **brand** action when the property is in one of the share
  partners' `schemes[].propertyIds`. That is exactly the case where `ActionPlanFields` shows the scheme
  (`dialogs.tsx:117-118`). In every other case it returns nulls and the place is only in the notes. A landlord
  action never carries a place (decided 12 November; the server refuses one, `crm-engagement.ts:212`). So the
  Brand CRM never gets an action at a property it has no scheme line for, and the Landlord CRM is unchanged.
- The person is named only in the notes. `createEngagementAction` never sets `user_tasks.linked_property_id` or
  `linked_contact_id`: `/api/properties/:id/tasks` shows tasks by `linked_property_id` to client logins, and the
  code says so at `crm-engagement.ts:430`. A source guard pins it.
- Events on people are left for a later slice.

## 4. The unit panel: people on the unit

- `UnitPeopleBlock`, exported from the new `client/src/components/property-page/people-board.tsx`, is mounted
  with one line after `<LettingBlock ... />` in `PropertyUnitPanel` (`unit-panel.tsx:494`). It reads
  `usePropertyPeople(propertyId)`, the same cached fetch as the People tab, and filters it with `peopleOnUnit`.
- Sub-heads: **Tenant** (the occupier company entry, plus the deal's tenant contact), **Agents** (the leasing agent
  and the brief's joint agent), **On the brief** (brief people). There is no viewings or offers sub-head:
  `LettingBlock` already lists them. An empty block is not drawn.
- `server/property-units.ts` and `shared/property-units.ts` are not touched.
- **Speed check (WP-B acceptance):** the SQL test seeds 300 schedule rows and 300 tracker rows, and the staff read
  must take under 1 s on the throwaway schema. If it fails, the unit block is not mounted in this step and moves
  to "Not in this step". The People tab ships either way.

## 5. What a non-staff login is sent, and the leak

**The new feed (`GET /api/properties/:id/people`).** `propertyReadBlocked` (`server/property-units.ts:34`) runs
first. The handler sends only `entries.map(e => recordPersonForViewer(e, viewer))`, which builds new objects
from an allow-list and never spreads its input. Restricted Landsec roles stay refused: `restrictedLandsecApiRule`
(`shared/landsec.ts:249`) has no rule for this path, and the gateway test asserts `deny`.

| Field | Staff | Non-staff (own property only) |
|---|---|---|
| `id`, `kind`, `name`, `jobTitle`, `email`, `phone` | yes | yes |
| `contactId` | yes | only when `canOpenContact` |
| `company {id,name}` | yes | name always; `id` only when `canOpenCompany` (the portfolio's slice rule) |
| `group`, `side`, `roleOnRecord`, `roleSource` | yes | yes |
| `relationships[]` | all | only `visibility: "all"`, each rebuilt as `{group, role, roleSource, deal{id,name}, scheduleRowId, trackerId, unitName, status}`; for `bgp` only `{group, role, roleSource}`; a person left with none is dropped |
| `companyKind`, `ownerPerson`, `source`, `via` | yes | **never** |
| `lastContactAt`, `lastContactPerson`, `plan`, `addedBy` | yes | **never** (the key is absent, not null) |
| `hiddenCount` | yes | yes (a client may pin and hide on its own property; deliberate and tested) |
| `viewer {staff, canSetRoles, canAddActions, canPinHide}` | true/true/true/true | false/false/false/true |

Staff viewing as a client get the non-staff shape, because `contactViewer` is false while a scope is set. Note
that a BGP login whose session resolves to a company scope through its own team, or whose email is not on the
BGP domain, is also treated as non-staff. That is the safe direction and is kept on purpose.

**The live leak, shipped first (WP-A, day 1).**
- `GET /api/properties/:id/linked-contacts`: when `contactViewer(req).staff` is false, `shape()` (`:1147`), the
  tenants mapper's `contact` (`:1429`) and the brand-only `co-…` rows (`:1437`) are built **without** the
  `last_interaction` key. `landlord`, `deals`, `interest`, `consultants` and `pinned` are sorted by name, and
  `tenants` by company name. The staff reply is unchanged. The classic panel already draws the date only when it
  is present.
- `GET /api/crm/properties/:id/clients` (`crm.ts:3478`, reachable by clients because `/api/crm/` is a client GET
  prefix): for a non-staff caller, each link is `{ id, propertyId, contactId, role, contact: { id, name, role,
  email, phone, companyId } }`, never the whole `crm_contacts` row.
- `PUT` and `DELETE /api/crm/properties/:id/clients/:clientId` (`crm.ts:3510-3525`) add `AND property_id = :id`.
  Client writes there are already refused by the CRM write guard (`crm.ts:1500-1526`).
- **Residual, put to Woody (section 10, point 5):** which landlord people the classic card lists, and which tenant
  contact it picks, is still chosen by BGP's contact history. Only the date is removed.

## 6. Schema

**None.** All the tables exist: `crm_property_clients` (`shared/schema.ts:857`, boot table `server/index.ts:7045`),
`property_contact_overrides` (created at runtime; reads check `to_regclass` first, as `loadPortfolioContacts`
does), `crm_contact_properties`, `unit_brief_people` (migration 0050) and the `crm_engagement_*` tables. Nothing
goes on `IDEMPOTENT_SQL_MIGRATIONS`, nothing runs at boot or on a timer, and nothing is back-filled. The role
write does not rely on a unique index (advisory lock plus NOT EXISTS).

## 7. Work packages

Four packages built in parallel, with no file in two packages. **Day 0 contracts:** WP-B commits
`shared/record-people.ts` (types, `PEOPLE_GROUPS`, `PROPERTY_CLIENT_ROLES`, signatures) and WP-C commits the
`planForCompanies` signature returning an empty map. **Shipping order:** day 1 WP-A (the leak, deployed alone).
Days 2-3: WP-B, WP-C and WP-D step 1 (a read-only board on the plan-led page). Day 4: WP-D step 2 (role and Add
action). Day 5: WP-D step 3 (unit block). Each step is merged and deployed on its own.

### WP-A: close the leak (day 1, ships alone)

**Files.** New: `server/contact-viewer.ts`, `qa/regression/contact-leak-guards.test.mjs`. Edited:
`server/property-asset-brief.ts`, `server/crm.ts`, `qa/regression/property-page-labels.test.mjs`.

**What.**
- `contactViewer(req): Promise<{ staff: boolean }>` (dynamic import of `./landlord-meetings`).
- `linked-contacts`: `const { contactViewer } = await import("./contact-viewer")`, then the changes in section 5.
- Move the two BGP queries (`dealAgentsQ`, `accountTeamQ`, `:1210-1234`) into exported constants
  `BGP_DEAL_AGENTS_SQL` (a function of nothing, embedding `TERMINAL_SQL`) and `BGP_ACCOUNT_TEAM_SQL`. The handler
  runs the same text. WP-B imports them.
- `crm.ts`: the `/clients` GET allow-list and the PUT/DELETE `property_id` check.
- The labels harness: the `require` mock answers `./company-scope` and `./contact-viewer` (`{ contactViewer:
  async () => ({ staff }) }`), and the two new constants are added to its `lists`. Add a client run that seeds
  `last_interaction: '2031-01-01'` and asserts that `"last_interaction"` and `2031` are both absent from
  `JSON.stringify(body)`, and that the landlord names are in A to Z order. The staff run keeps every assertion.
- `contact-leak-guards`: the `/clients` GET handler calls `contactViewer` and maps contacts through an explicit
  object literal (no spread of `contact`). PUT and DELETE filter on `propertyId`.

**Acceptance.**
- `node --import tsx --test qa/regression/property-page-labels.test.mjs qa/regression/contact-leak-guards.test.mjs`
- `npm run qa:regression` and `npm test`: no new failures against the baseline.
- `npm run check` clean.
- After deploy, with a Landsec client session: `curl -s -H "Authorization: Bearer $TOKEN"
  https://<app>/api/properties/<a Landsec property id>/linked-contacts | grep -c last_interaction` prints 0. The
  same call with a staff token still shows dates. Read only.

### WP-B: the feed, the rule, the role routes (server)

**Files.** New: `shared/record-people.ts`, `shared/record-people.test.ts`, `server/property-people.ts`,
`server/property-people.test.ts`, `qa/regression/property-people-guards.test.mjs`,
`qa/regression/portfolio-query-golden.test.mjs`, `qa/regression/__golden__/portfolio-contacts-query.txt`.
Edited: `server/portfolio-contacts.ts`, `server/index.ts`, `server/landsec-gateway.test.ts`, `package.json`,
`qa/regression/portfolio-contacts-postgres.mjs`.

**What, in this order.**
1. **Before any edit**, write the golden test. It snapshots `buildPortfolioContactsQuery('c', null, 'false',
   true)` and `(..., false)` text and values at HEAD into the `__golden__` file. Then edit.
2. `server/portfolio-contacts.ts`: `export` on `evidence`. Move the `tenancy` and `resolved_occupiers` CTE text
   into `export const OCCUPIER_CTES` and interpolate it where it was. The golden test must stay byte-identical.
3. `shared/record-people.ts`: `PEOPLE_GROUPS`, `PROPERTY_CLIENT_ROLES`, the `RecordPerson` and `RecordPeopleReply`
   types, `groupOf(rels)`, `roleOnRecord(rels)`, `recordPersonForViewer(p, { staff })`, `peopleOnUnit(people,
   unit)` (returns the unit's people; `unplaced(people, units)` returns the rest), `actionPlaceFor(propertyId,
   scheduleRowId, sharePartners)`.
4. `server/property-people.ts`:
   - `buildPropertyPeopleQuery(propertyId, scopeCompanyId, brandSliceSql, hasOverrides)` with the CTEs `props`
     (one row), `owners`, `overrides`, property-mode `pdeals`, `tracker_rows`, `OCCUPIER_CTES`, and the branches
     in section 2. Each branch carries `group_key`, `role`, `role_source`, `visibility`, `schedule_row_id`,
     `tracker_id`, `unit_name`. The final SELECT is modelled on `portfolio-contacts.ts:152-175`, except that side
     comes from the branch, plus `company_kind`, `owner_person`, `last_interaction` and `left_at`. Inactive users
     and non-BGP users are filtered out of `bgp`.
   - `loadPropertyPeople(db, propertyId, viewer)` runs the overrides check, the main query, `BGP_DEAL_AGENTS_SQL`
     and `BGP_ACCOUNT_TEAM_SQL` (merged through `propertyBgpTeam()`), and `planForCompanies` for staff inside a
     try/catch. It applies `recordPersonForViewer` to everything.
   - `GET /api/properties/:id/people`: `propertyReadBlocked`, then `contactViewer`, then `loadPropertyPeople`.
   - `PUT` and `DELETE /api/properties/:id/people/:contactId/client-role` (section 2): staff only (403
     otherwise), owner-person check on PUT, advisory lock.
   - Export `propertyPeopleRouter`.
5. `server/index.ts`: import it and add `app.use(propertyPeopleRouter)` beside `app.use(propertyUnitsRouter)`. No
   gateway line: `/api/properties/` is already a client GET prefix (`:4799`), client writes stay refused, and the
   routes check `contactViewer` themselves.
6. `server/landsec-gateway.test.ts`: GET and PUT on `/api/properties/p1/people` and
   `/api/properties/p1/people/c1/client-role` give `deny` for `asset_manager` and `joint_agent`.
7. `package.json` `test`: add `shared/record-people.test.ts` and `server/crm-engagement-companies.test.ts` (WP-C's
   file).
8. `portfolio-contacts-postgres.mjs`: add `deleted_at timestamp` and `status text` to its temporary
   `unit_viewings`.

**Tests in this package.**
- `shared/record-people.test.ts` (pure): group priority (a deal tenant contact who also has a
  `crm_property_clients` row is in `client`; a pin alone is in `added`); set role beats derived; for non-staff,
  `Object.keys` of a person equals the allow-list exactly, the JSON holds none of `2031-01-01`, `CANARY-ACTION`,
  `CANARY-STRATEGY` or `canary-user-id`, a `staff` relationship is dropped and so is a person left with none, a
  `bgp` relationship has no `deal`, and `company.id` is withheld when `canOpenCompany` is false; `peopleOnUnit`
  matches by schedule row or tracker id and never by name, and `unplaced` returns the rest; `actionPlaceFor`
  returns nulls for a landlord action, and for a brand at a non-scheme property, and the ids for a brand at a
  scheme property.
- `server/property-people.test.ts` (throwaway schema; copy `withSchema` and the `PROPERTY_PAGE_DATABASE_URL`
  skip rule from `server/property-page.test.ts:337-380`; create `property_contact_overrides` with the DDL at
  `property-asset-brief.ts:1063-1069`). The seed and what each part must show:
  - A deal with `property_id NULL` and `tenancy_unit_id` on this property whose `tenant_contact_id` is hidden: the
    contact is in no group.
  - A deal linked by `unit_id` only: it is on the right schedule row.
  - A schedule row with two tracker rows and the brief on the older one: the brief people are on that unit.
  - A Landsec login on a brief as `client_leasing`: in `client`, side `client`.
  - An inactive BGP user on a deal: absent.
  - An agent firm on `crm_company_properties`: not in `owner`.
  - A tenant company with five contacted people: one `lastContactPerson`, and the five are not listed.
  - A consultant director: in `advisers`.
  - Nothing from another property.
  - The role PUT updates, then inserts; `null` keeps the row with role NULL; DELETE removes it.
  - A tenant-company contact is refused with a 400.
  - Two parallel PUTs leave one row.
  - The client shape drops viewing, offer and in-touch-only people.
  - With `crm_engagement_actions` dropped, the reply has people and `plan: "unavailable"`.
  - The query count is the same for 3 and 300 schedule rows, and the 300-row staff read takes under 1 s.
- `qa/regression/property-people-guards.test.mjs` (source): the GET handler calls `propertyReadBlocked` before
  any query, and `res.json` receives only the mapped entries. The GET path has no INSERT, UPDATE or DELETE.
  Every `visible(` call in property mode passes `'$1'`. The `tracker_rows` ties equal `TRACKER_ONLY_SQL`'s (parsed
  as in `property-units-guards.test.mjs:111-136`). PUT and DELETE check `contactViewer` and `PROPERTY_CLIENT_ROLES`.
  There is no `crm_engagement_actions` SQL in `property-people.ts`, and no `setInterval` and no boot call.

**Acceptance.**
- `node --import tsx --test shared/record-people.test.ts qa/regression/property-people-guards.test.mjs
  qa/regression/portfolio-query-golden.test.mjs server/landsec-gateway.test.ts`
- `PROPERTY_PAGE_DATABASE_URL=postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpdev node --import tsx --test
  server/property-people.test.ts` (a local database only; it skips without one)
- `node --import tsx --test qa/regression/portfolio-contacts.test.mjs
  qa/regression/landlord-contact-suggestions.test.mjs qa/regression/brand-contacts-parity.test.mjs
  qa/regression/property-units-guards.test.mjs` unchanged and green.
- `npm test`, `npm run qa:regression`: no new failures. `npm run check` clean.
- Against the classic card on the same local property: everyone on the classic card is listed, except
  consultants' directors (now Advisers) and agent firms' people (now Others on deals). Record the counts per group
  beside the classic card's counts in the PR description.

### WP-C: the CRM plan read (server)

**Files.** Edited: `server/crm-engagement.ts`. New: `server/crm-engagement-companies.test.ts`.

**What.** `planForCompanies` as in section 3, added as an export only. No existing function, route or query in
the file changes.

**Acceptance.**
- `node --import tsx --test server/crm-engagement-companies.test.ts`. With a stub `Queryable`, it checks the
  `done` filter, the private-event drop, here-first order, active strategies only, and that the SQL reads the
  plan columns through `to_jsonb(l)`. A source assertion checks that `createEngagementAction`'s `INSERT INTO
  user_tasks` names neither `linked_property_id` nor `linked_contact_id`.
- `node --import tsx --test qa/regression/crm-engagement-kind.test.mjs qa/regression/brand-*.test.mjs` unchanged
  and green, plus `npm run qa:regression` (which includes `access.cjs`).

### WP-D: the shared row, the board, the unit block, the words (client and docs)

**Files.** Edited: `client/src/components/company-contacts-board.tsx`,
`client/src/components/property-page/use-property-page.ts`, `client/src/components/property-page/unit-panel.tsx`,
`client/src/components/property-detail.tsx`, `server/chatbgp-app-map.ts`,
`docs/property-page-rebuild-2026-11-13.md`, `CLAUDE.md`. New:
`client/src/components/property-page/people-board.tsx`, `qa/regression/key-contact-row-slots.test.mjs`.

**Step 1 (read-only board, with WP-B and WP-C).**
- `KeyContactRow` gains four optional props: `recordRole?: ReactNode` (drawn after the name),
  `aside?: ReactNode` (before the icon links on desktop; on the phone, on the row's second line),
  `menuItems?: ReactNode` (after a `DropdownMenuSeparator` inside the existing `DropdownMenuContent`) and
  `onChanged?: () => void` (called in the existing `saveRole` and `markLeft` `onSuccess`, after their own
  invalidations). No new hook and no new runtime import (`ReactNode` is a type-only import). Landlord and brand
  boards pass none of these props, so they do not change.
- `usePropertyPeople(propertyId)`, query key `["/api/properties", propertyId, "people"]`.
- `PropertyPeopleBoard` in `people-board.tsx`:
  - The pill filter row ("All N" first and selected, a count per group), then every group under sub-heads.
  - The BGP group: `InlineAgents` (imported unchanged), then the feed's `bgp` rows except `source: "assigned"`.
  - **Adapter:** `KeyContactRow` is drawn only when `entry.contactId` is set, with `contact={{ id:
    entry.contactId, name, role: entry.jobTitle, email, phone, left_at: entry.leftAt }}` and `companyId={
    entry.company?.id ?? "" }`. Never spread the entry. `isLandlord` is set for a landlord or brand
    `companyKind`; `meetingHistory` is set for a landlord only. Other entries get the one-line row.
  - `recordRole`: a `Pill` reading "<roleOnRecord> · this property" when `roleSource` is "set".
  - `aside` (staff): last contact, next action and strategy, as in section 3.
  - The units group is split by unit label from `usePropertyUnits`, with "Not tied to a unit" last (`unplaced`).
  - "N hidden · restore", Hide and Add person (pin) use the existing override routes.
  - `property-detail.tsx`: inside the People `PropertySection` (`:1329`), render `<PropertyPeopleBoard>` when
    `planLayout` is set. Otherwise the existing `ReferenceSection` stays exactly as it is.
- `key-contact-row-slots.test.mjs`: the `landlord-contact-suggestions.test.mjs` harness, rendered with and
  without the props. The four `useState` calls are unchanged and the slots render. A source guard checks that
  `people-board.tsx` passes `id: entry.contactId` and `role: entry.jobTitle`, and has no `...entry` or `...p`
  inside a `contact={` prop.

**Step 2 (role and Add action).** Menu items: "Role at <property name>" (when `ownerPerson` and
`viewer.canSetRoles`; a role picker calling the PUT), "Remove from the client's team" (with a `crm_property_clients`
link; a confirmation, then DELETE), "Add action" (section 3, `actionPlaceFor`) and "Open brief" for brief
people. Add person also offers "Add to the client's team with a role" for owner-company people.

**Step 3 (unit block).** `UnitPeopleBlock` (section 4) and one import plus one line in `unit-panel.tsx` after
`:494`. Skip this step if WP-B's speed check failed.

**Words.** `server/chatbgp-app-map.ts` (the property page line): the People tab's groups, "Role at this property"
and Add action. `docs/property-page-rebuild-2026-11-13.md`: what was built. `CLAUDE.md` "Property page rebuild":
one paragraph naming the feed (`server/property-people.ts`), the rule (`recordPersonForViewer`,
`contactViewer`), the row (`KeyContactRow`), the role store (owner people only, and that it badges them on the
landlord's Key contacts), and that a staff session scoped to a team counts as non-staff.

**Acceptance.**
- `node --import tsx --test qa/regression/key-contact-row-slots.test.mjs
  qa/regression/landlord-contact-suggestions.test.mjs qa/regression/brand-contacts-parity.test.mjs`
  (the last two unedited).
- `npm run check` clean; `npm run qa:regression`: no new failures.
- In a browser on a local copy, at 1280 px and at 390 px: the classic page is unchanged; the plan-led People tab
  shows every group; there is no horizontal scroll at 390 px; the job title and "· this property" pill both show
  on one row and read as two things; setting a role adds the "property client" badge on the landlord's Key
  contacts; Add action from a brand person at a non-scheme property saves with no scheme, and the Brand CRM shows
  no line for that property; a unit panel shows Tenant, Agents and On the brief. Say plainly in the PR if any of
  this was not tried in a browser.

## 8. Review findings: what changed

All checked against `b9bcd3c3`. Accepted, and built into the sections above: hides on unit-only deals (own
`pdeals`, `$1` in every hide test); clearing a role keeps the row (separate DELETE); roles for owner people only;
the `KeyContactRow` adapter; side from the relationship, active BGP users only; plan read through `to_jsonb` with
`plan: "unavailable"`; units resolved on the server plus "Not tied to a unit"; the leak key absent with a value
canary; no deal on a `bgp` relationship for clients; one `lastContactPerson` per tenant; agent firms out of
`owners`; other `crm_contact_properties` links go to `added`; the task link columns exist (point 10.4 reworded,
guard added); an advisory lock on the role write; scoped staff count as non-staff (named, kept); the leak as WP-A
on day 1; shipping steps; groups stated as the property board's for now (option b); `actionPlaceFor`; "Role at
<property>" wording; landlord-page effect narrowed to a badge; no viewings in the unit block and a speed check;
scheme siblings moved out; all groups shown, pills as filters; BGP agents drawn once; acceptance reworded with
counts per group.
Partly wrong, kept as is with this reason: "the tests are already failing". At `b9bcd3c3` the labels and contact
tests pass (37 of 37) and `qa:regression` has 0 failures, because `bc656220` repaired them. `npm test`'s 6
failures are unrelated and are recorded as the baseline. The golden test and the repair of the postgres harness
are still in WP-B.

## 9. Not in this step

- Opening the plan-led page, and so this board, to client logins (rebuild roll-out, which waits on Woody). Before
  that, `KeyContactRow`'s title editor must be staff-only, because the client CRM guard lets a client save
  fields through `PUT /api/crm/contacts/:id`.
- Moving the portfolio, landlord, brand, deal and brief boards onto `PEOPLE_GROUPS` and a record read of their
  own. Until then the groups belong to the property board.
- Landsec scheme sibling records in "here", events on people, and "Log interaction" from a row.
- The 12 November contact plan's layers A to C (`classifyContact`, folding mailboxes, identity merge,
  `loadAccountPeople`).
- Retiring `LinkedContactsPanel`, `PropertyBgpTeamFromWork` and the unused `ClientBoardPanel`.
- Merging `crm_contact_properties`, `crm_property_clients` and `property_contact_overrides`, and roles for people
  who are not the owner's (both need schema).
- The unit block, if the speed check fails.

## 10. Needs Woody's word

1. When the plan-led page opens to Landsec, may a client login see the named people who viewed a unit or made an
   offer on its property? The classic card shows them today. This slice hides them, as the unit panel already
   does.
2. May a client login give a person a role on its own property, or only pin and hide people as it does today?
   (Roles are BGP staff only in this slice.)
3. Should people who are not the owner's (the tenant's acquisition agent, the landlord's solicitor) carry a role
   on a property? That needs one new table, a schema change.
4. Should an action added from a person record that person on the action? `user_tasks.linked_contact_id`
   already exists, but this slice leaves it unset. Should a landlord action be allowed to sit at a property? On
   12 November places were decided as brand actions only.
5. On the classic card and the client's portfolio board, some people are still chosen because BGP has been in
   touch with them ("Landlord — active", the freshest contact at a tenant). The date is now removed. Should
   client logins also stop seeing a list chosen that way?

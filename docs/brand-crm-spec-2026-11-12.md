# Brand CRM build spec: schemes and units, stages, diary, contacts (12 November 2026)

Woody's direction on 12 November 2026: keep the pills; a brand strategy is
about which schemes we want the brand in and whether there is a target unit
there, linked to the Letting Tracker and to requirements; rethink the stage
names; brands have their own CRM, worded "Brand", kept apart from the
Landlord CRM; a CRM diary shared between BGP's agents and Landsec; brand
contacts checked against landlord contacts. Demo brands: Jersey Mike's,
Wingstop, Flat Iron, Yo Chi, Blank Street, Starbucks, The Light Cinema.

Five readers mapped the code, two designers worked independently, and a
feasibility check chose between them part by part. Nothing here is built
yet. The feasibility check follows the spec.

```text
BUILD SPEC: BRAND CRM, SCHEMES AND UNITS, STAGES, DIARY, CONTACTS
12 November 2026. Read-only work: nothing in the repo or database was changed.

=====================================================================
PART 1. FOR WOODY
=====================================================================

WHAT YOU ASKED FOR AND WHAT YOU WILL GET

A. Brand strategy built on schemes and units
- Every brand page gets a card called "Schemes and units". It has one line per scheme and unit.
- Each line shows the scheme, the unit, where it stands, the next step and who has it.
- The card opens with the brand's live requirement. Each line has a chip saying whether that unit fits it.
- Each line links to the Letting Tracker row, the deal and the Landsec unit page.
- You can record "we want them at this scheme, no unit yet". A list underneath shows places the brand asked for where we have no target.

B. Stage names that mean something
- The stage belongs to a brand at a unit, not to the brand as a whole.
- Nobody picks it from a list. The app reads it from targets, viewings, offers, deals and tenancies.
- The words match the Letting Tracker, so the two can never disagree.
- The five old stage names go. One hand-set flag stays, called "On hold".

C. A Brand CRM that is separate from the Landlord CRM
- A new "Brand CRM" pill sits inside Brand Intelligence. Staff also get a menu link to it.
- It has three views: Targets, Diary, and Strategies and events. Every label says "Brand".
- The Landlord CRM page keeps every word it has. Brand actions leave that page.
- A new strategy or event must be all brands or all landlords. The two lists are never mixed.

D. A CRM diary
- One dated list across all brands. It can be grouped by date, person, brand or scheme.
- It holds CRM actions, booked viewings, viewing follow-ups, deals waiting on someone, briefs awaiting signature and brand cases awaiting a reply.
- Landsec gets its own diary. It shows their requests to BGP and everything waiting on them.
- With your OK on the database changes, BGP can share a chosen action with Landsec and mark it "waiting on Landsec".

E. Brand contacts compared with landlord contacts
- I checked the two side by side. The desktop brand page has used the landlord board since 2 November.
- Ranking, email counts, suggested contacts and roles already match.
- Three things fail on brands. Email history per person is refused. The cross on a suggested contact fails. "Add contact" appears twice.
- Before the pitch the two failing controls are hidden and the duplicate goes. They are fixed properly afterwards.
- The phone brand page still uses the older board. Meeting history and the evidence-based team board are landlord only. Both follow after the pitch.

STAGE NAMES

Recommended set. One stage per brand per unit. The furthest live evidence wins.
- Wanted: we want them in this scheme and no unit is picked yet.
- Unit identified: a unit is named for them and they have not been approached on it.
- Approached: the unit has been put to the brand or its agent, or a viewing is booked.
- Viewed: they have inspected the unit.
- Negotiating: an offer is in or terms are being traded.
- HOTs: heads of terms are agreed.
- Solicitors: the letting is in legals.
- Let: exchanged or completed, and not yet open.
- Trading: they are the tenant there today.
- Not proceeding: it stopped, shown with the reason. Brand passed, landlord declined, withdrawn, or the unit went to someone else.

The brand's headline is a summary of its lines. For example "3 schemes: 1 at HOTs, 1 viewed, 1 wanted".
A brand giving up a unit shows as "Disposing". It never shows as a target.

The alternative, a shorter set: Target, Pitched, Viewing, Terms, Let, Dropped. It is read from the same records. "Terms" would show the tracker status beside it.

WHAT LANDSEC SEES

Leasing manager, and today's full Landsec logins
- The Brand CRM pill under their existing Brands menu entry. Their five menu entries do not change.
- A grid of brands against the 14 schemes, and the Schemes and units card on each brand in their slice.
- Lines on Landsec schemes only. Never another landlord's activity, BGP's strategies, or BGP's notes.
- A "Wanted" line that BGP wrote shows only when BGP ticks "show to Landsec".
- The diary across all schemes, with their own requests to BGP.
- The fit chip on every line. The requirement detail only where they can already see that requirement today.

Asset manager
- The same grid and card, limited to their own schemes.
- For other schemes they see a count and a link to the brand case. You already decided they see brand cases portfolio-wide.
- No diary before the pitch. They keep the Lettings page and brand cases as now. Their diary follows after.

Joint agent
- No Brand CRM at all, before or after the pitch.
- After the pitch, a diary of deals waiting and viewings on their own schemes. No briefs, no brand cases, no brand contact names.
- One leak is closed now. Their unit page was sent a brand contact name that the screen never showed.

None of this was tested with a Landsec login. It is all read from code.

WHAT CAN BE READY FOR THE PITCH

Six working days remain: Friday 13 and Monday 16 to Friday 20 November.
1. The Brand CRM split and the wording. One day.
2. The engine that reads stages from records, with tests. Two days.
3. The Schemes and units card on the brand page. One day.
4. The Landsec grid of brands against schemes. One day.
5. The diary, read-only, for staff and full Landsec logins. One day.
6. Hiding the two failing contact controls and the duplicate button. About two hours.

That fills all six days with no slack.
- Nothing has been run on real data. The test database holds only Starbucks of your seven brands.
- A second developer is working in the two files this mounts into. That adds risk.
- The other pre-pitch items from this morning's review do not fit alongside this. You need to choose.

Staff work alongside, with no code
- Enter the three Jersey Mike's lettings as deals on their units, through the deal form.
- Add or check a live requirement for each of the seven brands.
- Write the Jersey Mike's brand case with its units.
- Put the seven brands on one brand strategy, with a first action each.
- Check each of the seven is in Landsec's slice and is not hidden.

WHAT FOLLOWS

- Sharing a BGP action with Landsec, pinning an action to a scheme or unit, and "waiting on Landsec".
- Diaries for asset managers and joint agents.
- Landsec adding "Wanted" lines and raising requests from the diary.
- A second list view for all landlords, not only Landsec.
- Email history and the dismiss control working properly on brands. The phone brand board brought into line.
- The evidence-based team board and meeting history for brands.
- An "On plan" chip on the Requirements board, so the link reads both ways.

DATABASE CHANGES I NEED YOUR OK FOR

1. One new table for "Wanted" lines. Without it, wishes sit on the Landsec brand case, for the 14 schemes only, written by staff only.
2. Two new fields on a CRM action, for its scheme and its unit. Without them, the next step shows per brand, not per scheme, and asset managers cannot be shown actions.
3. One new field on a CRM action, the share marker. Without it, Landsec sees its own requests and the derived items, and nothing BGP raises.
4. Two new fields on a CRM action, for who it is waiting on. Without them, "Landsec to do X" shows only through the deal clock and brand cases.

Stage names, the split, the grid and the read-only diary need no database change.
Item 1 is the one I need on Friday. Items 2 to 4 are for after the pitch.

DECISIONS

1. Stage names: the full set or the short set?
2. The new "Wanted" table: yes or no, by Friday?
3. The five new action fields: yes, later, or no?
4. "On hold" as the one hand-set flag? Should an On hold brand be safe from the tidy?
5. BGP's "Wanted" lines hidden from Landsec until ticked?
6. A shared action shows Landsec the title only, never the notes?
7. May Landsec leasing managers add "Wanted" lines? Asset managers too, on their schemes?
8. Asset managers: other schemes as a count only?
9. Joint agents: no Brand CRM, and a later diary of deals and viewings only?
10. Does "agents" mean BGP's agents only, or joint agents too?
11. Requirement detail for Landsec: chip always, detail only where they see it today?
12. Regions: is Leeds "North East"? Braintree "East Anglia"? Portsmouth "South East"? Street "South West"?
13. Hide draft brand cases from Landsec logins? Today they can open them.
14. What stage is each of the three Jersey Mike's lettings at today?
15. Which of this morning's review items give way for this?
16. Brand CRM as a pill in Brand Intelligence plus a menu link?
17. Contact fixes: hide now and fix after the pitch?

=====================================================================
PART 2. FOR THE DEVELOPER
=====================================================================

Root /home/user/bgp-wip-app. Merge rule from the feasibility check: plan-first for A (cut back, with derive-first's lean table) and D; derive-first for B and C; same list for E with derive-first's timing. Line numbers in client/src/components/brand-profile-panel.tsx and client/src/pages/brands-hub.tsx drift (another developer is in both); use the names.

---------------------------------------------------------------------
2.1 DATA MODEL
---------------------------------------------------------------------

2.1.1 The brand-scheme row is derived, not stored

One module, `server/brand-scheme-plan.ts` (new), does the SQL; `shared/brand-stage.ts` (new) holds the pure rules (stage ranking, requirement chip) so server, client and tests share them.

Row identity: `companyId | schemeKey-or-propertyId | unitKey`.
- Scheme: `schemeForPropertyName(p.name)` (server/landsec-schemes.ts:41) for the 14 schemes; any other property is its own "scheme" (`schemeKey = null`, name = property name).
- unitKey: `tenancy_schedule_units.id` (the spine) when it can be resolved, else `au:<available_units.id>`, else `lsu:<leasing_schedule_units.id>`, else `none` (no unit yet). A row whose key is not a spine id carries `splitKey: true` so the UI can flag "unit not linked to the tenancy schedule" instead of silently merging.

Two entry modes for the same query: by brand (`$1` = brand ids, single brand page) and by properties (`$2` = property ids, the Landsec grid; `$1` NULL). Every branch takes both predicates so the grid does not scan 1,900 brands.

Main evidence query (sketch; column names checked against the local DB's information_schema, not against real rows):

```sql
-- $1 text[] brand ids or NULL; $2 text[] property ids or NULL (NULL = staff, all properties)
WITH ev AS (
  SELECT t.tenant_company_id AS company_id, t.property_id, t.id AS spine_id, NULL::varchar AS tracker_id, NULL::varchar AS lsu_id,
         NULL::varchar AS deal_id, 'trading' AS src, t.status AS st, t.updated_at::text AS at, NULL::jsonb AS x
    FROM tenancy_schedule_units t
   WHERE t.tenant_company_id IS NOT NULL AND ($1::text[] IS NULL OR t.tenant_company_id = ANY($1))
     AND ($2::text[] IS NULL OR t.property_id = ANY($2)) AND COALESCE(t.status,'') NOT IN ('Vacant','Void','Available')
  UNION ALL
  SELECT u.tenant_company_id, u.property_id, u.tenancy_unit_id, NULL, u.id, NULL, 'trading_ls', u.status, u.updated_at::text, NULL
    FROM leasing_schedule_units u
   WHERE u.tenant_company_id IS NOT NULL AND ($1::text[] IS NULL OR u.tenant_company_id = ANY($1)) AND ($2::text[] IS NULL OR u.property_id = ANY($2))
  UNION ALL
  SELECT d.tenant_id, d.property_id, d.tenancy_unit_id, NULL, NULL, d.id, 'deal', d.status,
         COALESCE(d.stage_entered_at, d.updated_at, d.created_at)::text,
         jsonb_build_object('dealType', d.deal_type, 'ref', d.deal_ref, 'unitId', d.unit_id, 'agent', d.internal_agent,
                            'agentIds', d.internal_agent_ids, 'exchangedAt', d.exchanged_at, 'completedAt', d.completed_at)
    FROM crm_deals d
   WHERE d.tenant_id IS NOT NULL AND ($1::text[] IS NULL OR d.tenant_id = ANY($1)) AND ($2::text[] IS NULL OR d.property_id = ANY($2))
  UNION ALL
  SELECT o.company_id, au.property_id, au.tenancy_unit_id, au.id, au.leasing_schedule_unit_id, au.deal_id, 'offer', o.status, o.offer_date, NULL
    FROM unit_offers o JOIN available_units au ON au.id = o.unit_id
   WHERE o.company_id IS NOT NULL AND ($1::text[] IS NULL OR o.company_id = ANY($1)) AND ($2::text[] IS NULL OR au.property_id = ANY($2))
  UNION ALL
  SELECT v.company_id, au.property_id, au.tenancy_unit_id, au.id, au.leasing_schedule_unit_id, au.deal_id, 'viewing', v.status, v.viewing_date,
         jsonb_build_object('viewingId', v.id, 'requirementId', v.requirement_id, 'followUp', v.follow_up_date, 'nextAction', v.next_action,
                            'ownerId', v.owner_user_id, 'outcome', v.outcome)
    FROM unit_viewings v JOIN available_units au ON au.id = v.unit_id          -- inner join: unit-less viewings cannot be scoped, so they are left out
   WHERE v.company_id IS NOT NULL AND v.deleted_at IS NULL AND COALESCE(v.status,'') NOT IN ('cancelled','not_leasing')
     AND ($1::text[] IS NULL OR v.company_id = ANY($1)) AND ($2::text[] IS NULL OR au.property_id = ANY($2))
  UNION ALL
  SELECT i.company_id, au.property_id, au.tenancy_unit_id, au.id, au.leasing_schedule_unit_id, au.deal_id, 'interest', NULL, i.interest_date, NULL
    FROM unit_interest i JOIN available_units au ON au.id = i.unit_id
   WHERE i.company_id IS NOT NULL AND ($1::text[] IS NULL OR i.company_id = ANY($1)) AND ($2::text[] IS NULL OR au.property_id = ANY($2))
  UNION ALL
  SELECT t.company_id, au.property_id, au.tenancy_unit_id, au.id, au.leasing_schedule_unit_id, au.deal_id, 'tracker_target', t.status,
         COALESCE(t.updated_at, t.created_at)::text,
         jsonb_build_object('targetId', t.id, 'briefId', t.brief_id, 'priority', t.priority, 'agentIds', t.agent_user_ids)
    FROM unit_target_operators t JOIN unit_briefs b ON b.id = t.brief_id JOIN available_units au ON au.id = b.unit_id
   WHERE t.company_id IS NOT NULL AND ($1::text[] IS NULL OR t.company_id = ANY($1)) AND ($2::text[] IS NULL OR au.property_id = ANY($2))
  UNION ALL
  SELECT tt.company_id, u.property_id, u.tenancy_unit_id, NULL, u.id, NULL, 'schedule_target', tt.status, COALESCE(tt.updated_at, tt.created_at)::text,
         jsonb_build_object('outcome', tt.outcome, 'rating', tt.quality_rating)
    FROM target_tenants tt JOIN leasing_schedule_units u ON u.id = tt.unit_id
   WHERE tt.company_id IS NOT NULL AND COALESCE(tt.status,'') NOT IN ('rejected','suggested')
     AND ($1::text[] IS NULL OR tt.company_id = ANY($1)) AND ($2::text[] IS NULL OR u.property_id = ANY($2))
  UNION ALL
  SELECT cid, u.property_id, u.tenancy_unit_id, NULL, u.id, NULL, 'leasing_target_ids', NULL, u.updated_at::text, NULL
    FROM leasing_schedule_units u, unnest(u.target_company_ids) cid
   WHERE ($1::text[] IS NULL OR cid = ANY($1)) AND ($2::text[] IS NULL OR u.property_id = ANY($2)) AND u.tenant_company_id IS DISTINCT FROM cid
  UNION ALL
  SELECT cid, t.property_id, t.id, NULL, NULL, NULL, 'tenancy_target_ids', NULL, t.updated_at::text, NULL
    FROM tenancy_schedule_units t, unnest(t.target_company_ids) cid
   WHERE ($1::text[] IS NULL OR cid = ANY($1)) AND ($2::text[] IS NULL OR t.property_id = ANY($2)) AND t.tenant_company_id IS DISTINCT FROM cid
), r AS (
  SELECT ev.*, COALESCE(ev.tracker_id,
           (SELECT au.id FROM available_units au WHERE au.deal_id = ev.deal_id ORDER BY au.updated_at DESC NULLS LAST LIMIT 1)) AS tracker2
    FROM ev
), k AS (
  SELECT r.*, au.unit_name AS tracker_unit, au.sqft AS tracker_sqft, au.marketing_status, au.deal_id AS tracker_deal_id,
         COALESCE(r.spine_id, au.tenancy_unit_id,
           (SELECT t.id FROM tenancy_schedule_units t WHERE t.letting_tracker_unit_id = au.id LIMIT 1),
           (SELECT l.tenancy_unit_id FROM leasing_schedule_units l WHERE l.id = COALESCE(r.lsu_id, au.leasing_schedule_unit_id)),
           (SELECT d.tenancy_unit_id FROM crm_deals d WHERE d.id = COALESCE(r.deal_id, au.deal_id)),
           (SELECT t.id FROM tenancy_schedule_units t WHERE t.deal_id = COALESCE(r.deal_id, au.deal_id) LIMIT 1),
           (SELECT t.id FROM tenancy_schedule_units t WHERE t.property_unit_id = r.x->>'unitId' LIMIT 1)) AS spine
    FROM r LEFT JOIN available_units au ON au.id = r.tracker2
)
SELECT k.company_id, COALESCE(k.property_id, ts.property_id) AS property_id, p.name AS property_name, p.address,
       k.spine, k.tracker2 AS tracker_id, k.lsu_id, COALESCE(k.deal_id, k.tracker_deal_id) AS deal_id, k.src, k.st, k.at, k.x,
       ts.premises, ts.unit_number, ts.status AS unit_status, ts.tenant_name AS occupier, ts.tenant_company_id AS occupier_id,
       ts.lease_expiry, ts.break_date, ts.permitted_use, COALESCE(ts.nia_sqft, ts.gia_sqft, k.tracker_sqft) AS sqft, k.tracker_unit
  FROM k
  LEFT JOIN tenancy_schedule_units ts ON ts.id = k.spine
  LEFT JOIN crm_properties p ON p.id = COALESCE(k.property_id, ts.property_id);
```

This is the same three-way spine/tracker/deal join the scheme page uses (server/landsec-unit.ts:117-123), plus `crm_deals.unit_id` to `tenancy_schedule_units.property_unit_id` as the fourth id. Both columns exist; that they point at the same `property_units` row is NOT CONFIRMED (the check cites shared/schema.ts:895 for the deal side only).

Separate, individually guarded queries merged in code (so a missing table or bad JSON cannot take the plan down):
- Brand case units: `SELECT bc.company_id, bc.status AS case_status, pu FROM landsec_brand_cases bc, jsonb_array_elements(COALESCE(bc.proposed_units,'[]'::jsonb)) pu WHERE ($1::text[] IS NULL OR bc.company_id = ANY($1))`. `pu->>'schemeKey'` gives the scheme; `pu->>'tenancyUnitId'` null means scheme-only. For any client viewer use only `case_status = 'sent'`.
- Wishes: `SELECT * FROM brand_scheme_targets WHERE ...` in try/catch (table may be absent; see 2.1.4).
- Unit deals, for the stale-evidence rule: `SELECT d.id, d.tenant_id, d.status, d.deal_type, d.tenancy_unit_id, au.id AS tracker_id, COALESCE(d.completed_at, d.exchanged_at) AS closed_at FROM crm_deals d LEFT JOIN available_units au ON au.deal_id = d.id WHERE d.tenancy_unit_id = ANY($spines) OR au.id = ANY($trackers)`.
- Deal clocks: `SELECT * FROM landsec_deal_clock WHERE deal_id = ANY($deals)`.
- Requirements: `SELECT id, company_id, name, size, use, requirement_locations, status, sources, deal_id, updated_at, created_at FROM crm_requirements_leasing WHERE company_id = ANY($1) AND (status IS NULL OR status = 'Active')` (live = NULL or Active, the Requirements board rule; the brand page card's Active-only test in `BrandProfilePanel` should follow).
- Open CRM actions per brand: `crm_engagement_actions l JOIN user_tasks t ON t.id = l.task_id WHERE l.company_id = ANY($1) AND t.status <> 'done'` (staff only in the plan response).
- Single-brand view only: name-only matches (`unit_target_operators.operator_name` with null `company_id`, `leasing_schedule_units.target_brands` / `optimum_target`, `tenancy_schedule_units.target_tenants`, `landsec_units.brief_target_brands`) using the `key()` normaliser in server/brand-relevance.ts:24-33 (export it). Rows carry `byName: true` and the UI tags them "matched by name". Never in the grid.

2.1.2 Stage rules (shared/brand-stage.ts)

Deal statuses go through `legacyToCode` (shared/deal-status.ts); letting types through `isLettingType` and `TENANT_SIDE_TYPES` (shared/letting-rules.ts:29, 55). Rank, furthest live evidence wins:

| Rank | Stage key | Evidence |
|---|---|---|
| 1 | wanted | wish row with no unit; sent or staff-visible brand case unit with no tenancyUnitId (status Proposed or Agreed) |
| 2 | unit_identified | tracker target Identified; leasing or tenancy `target_company_ids`; target_tenants approved or converted; wish row with a unit; brand case unit with a unit; name-only match |
| 3 | approached | tracker target Approached or Meeting Held; unit_interest; viewing status scheduled; brand is `tenant_id` on a landlord-side letting deal at OPP or AVA |
| 4 | viewed | viewing status completed; tracker target Inspection Done |
| 5 | negotiating | unit_offers not Rejected; tracker target Offer or Negotiating; deal NEG |
| 6 | hots | deal HOT; tracker target Heads of Terms |
| 7 | solicitors | deal SOL; tracker target In Sols |
| 8 | let | deal EXC, COM or INV; tracker target Let; target_tenants outcome signed |
| 9 | trading | tenancy row with `tenant_company_id` = brand and an occupied status (`trading`, `trading_ls`) |
| - | not_proceeding | only when no live evidence remains: target Passed (Brand passed); offer Rejected (Landlord declined); deal WIT or ARCH (Withdrawn); case unit Declined (Landlord declined); wish ruled out (its typed reason); target_tenants outcome passed or withdrawn |
| - | disposing | brand on a Lease Disposal or Sub-Letting deal; shown as its own label, never ranked as a target |

Corrections from the check that the rules must implement:
- Stale evidence: for each unit, take the latest closed letting (`closed_at` from the unit-deals query, any tenant). Ignore this brand's viewings, offers, interest and targets dated before it, unless that letting is the brand's own.
- Other tenant: if the unit's live deal (NEG, HOT, SOL) or latest closed letting names a different `tenant_id`, the brand's row becomes not_proceeding with reason "Unit went to another brand" (no name in the reason).
- Brand case unit status "Under offer" is hand-picked (client/src/pages/landsec-brand-case.tsx:286) and does not move the stage; show it as a note.
- `daysAtStage` from the winning evidence's `at` (for deals `stage_entered_at`; the audit-log rule in `stageSinceFor`, landsec-unit.ts, is more exact and can replace it later).
- Brand-level headline is computed: counts per stage, sorted by furthest.
- Short-set alternative is a label map over the same keys: Target (1-2), Pitched (3), Viewing (4), Terms (5-7, with the tracker word beside it), Let (8-9), Dropped.

2.1.3 Requirement chip (shared/brand-stage.ts)

Uses `parseReqSize` (shared/requirement-fit.ts:6) and a place test. Add `regions: string[]` to every entry of `LANDSEC_SCHEMES` (server/landsec-schemes.ts:24), using the chips in client/src/lib/crm-options.ts `reqLeasingLocations`. Proposed, pending decision 12: liverpool-one North West; trinity-leeds and white-rose North East (there is no Yorkshire chip); buchanan-galleries Scotland; bluewater, westgate-oxford, gunwharf-quays South East; st-davids Wales; clarks-village South West; braintree-village East Anglia; the four London schemes London. "National" matches every scheme. Note `requirementFitsUnit` discards "London" entries (requirement-fit.ts:35); the chip must not.

Place fits = a named location is a substring of scheme name + town + property name/address/postcode, OR a region chip is in the scheme's `regions`, OR "National".

| Chip key | Rule |
|---|---|
| linked | a viewing on this unit carries `requirement_id`, or the requirement's `deal_id` is this row's deal, or the wish row pins `requirement_id` |
| fits | place fits and unit sq ft is inside the parsed range |
| place_fits_size_unknown | place fits, unit has no area |
| place_fits_size_out | place fits, area outside the range (return both figures) |
| size_fits_no_places | requirement gives no places (the usual PIPnet case), size fits |
| not_on_list | places given, none match this scheme |
| place_unknown | region chips only on a non-Landsec property (no region table exists for those) |
| no_requirement | no live requirement with this `company_id` |

With several live requirements, test all and return the best chip with the requirement that produced it. Known parse quirks to keep visible in tests: "Under 500 sq ft" reads as 300-800; a second size band is ignored.

"Asked for, no target yet": for each live requirement place that fits a scheme with no row for this brand, emit `{place, schemes[]}`.

2.1.4 New table (needs Woody's OK; ask on day one)

File `migrations/0050_brand_scheme_targets.sql`, appended to `IDEMPOTENT_SQL_MIGRATIONS` (server/schema-drift.ts:36-46), and a matching pgTable in shared/schema.ts. Shape is derive-first's lean table plus the visibility switch and creator company the check asked for; `landlord_view*`, `priority`, `owner_user_id` are dropped.

```sql
CREATE TABLE IF NOT EXISTS brand_scheme_targets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id varchar NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,
  property_id varchar NOT NULL,
  tenancy_unit_id varchar,
  unit_label text,
  note text,
  requirement_id varchar,
  visible_to_client boolean NOT NULL DEFAULT false,
  ruled_out_at timestamp,
  ruled_out_reason text,
  created_by varchar,
  created_by_name text,
  created_by_company_id varchar,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS brand_scheme_targets_uq ON brand_scheme_targets (company_id, property_id, COALESCE(tenancy_unit_id, ''), lower(COALESCE(unit_label, '')));
CREATE INDEX IF NOT EXISTS brand_scheme_targets_property_idx ON brand_scheme_targets (property_id);
```

Notes:
- A file is one `pool.query`; one bad statement drops the whole file with only a warning (`applyIdempotentSqlMigrations`), so every read of this table is in try/catch and returns a `warnings` entry. The alternative home is the boot `MIGRATIONS` array in server/index.ts; either satisfies CLAUDE.md. Do not put it in `CRM_ENGAGEMENT_MIGRATIONS`.
- For a scheme wish, `property_id` = that scheme's `canonicalId` from `resolveLandsecPortfolio`.
- No FK on property or unit. `mergeProperties` repoints any column named `property_id` by itself (per the check, server/property-merge.ts:10, 44-52; I did not read it).
- Same commit: add `{ table: "brand_scheme_targets", column: "company_id" }` to `COMPANY_REFS` (server/brand-dedupe.ts:24), and add keep-signals to `SIGNALS` in server/brand-relevance.ts: `schemeTarget` (`SELECT DISTINCT company_id AS id FROM brand_scheme_targets WHERE ruled_out_at IS NULL`) and a `deleteOnly` one for any row. Without these, "Delete for good" cascades the wishes away. Side effect to accept: if the table failed to create, Hide and Delete refuse to run (they refuse when a signal cannot be checked).
- Existing gap found, not in scope to fix silently: `crm_engagement_actions`, `crm_strategy_targets` and `crm_event_companies` are not in `COMPANY_REFS` either (grep of brand-dedupe.ts and property-merge.ts found no reference).

Fallback if the table is refused: a wish is a `proposedUnits` entry with `tenancyUnitId: null` via `PUT /api/landsec/brand-case/:companyId` (server/landsec-brand-case.ts:113-151). The PUT replaces the whole array, so read-modify-write. Limits: 14 schemes, staff only. Draft cases must then be hidden from client viewers on BOTH routes: the list (:66, add `status = 'sent'` for `scope.isClient`) and the single case (:84, return `case: null` for a client when draft). That is decision 13.

2.1.5 Action columns (needs OK; after the pitch)

Appended to `CRM_ENGAGEMENT_MIGRATIONS` (server/crm-engagement.ts:13), plain statements with no foreign keys, because one failed statement there makes the whole plan answer 503 (server/index.ts:3008-3020):

```sql
ALTER TABLE crm_engagement_actions ADD COLUMN IF NOT EXISTS property_id VARCHAR
ALTER TABLE crm_engagement_actions ADD COLUMN IF NOT EXISTS tenancy_unit_id VARCHAR
ALTER TABLE crm_engagement_actions ADD COLUMN IF NOT EXISTS shared_with_company_id VARCHAR
ALTER TABLE crm_engagement_actions ADD COLUMN IF NOT EXISTS waiting_on_party TEXT
ALTER TABLE crm_engagement_actions ADD COLUMN IF NOT EXISTS waiting_on_user_id VARCHAR
CREATE INDEX IF NOT EXISTS crm_engagement_actions_shared_idx ON crm_engagement_actions(shared_with_company_id) WHERE shared_with_company_id IS NOT NULL
```

Rules that go with them:
- Do NOT write `user_tasks.linked_property_id` or `linked_deal_id` for a CRM action: it would put the title on the landlord's Portfolio activity board regardless of the share marker (server/property-asset-brief.ts ~1657).
- Do NOT let a Landsec login own an action (`assertOwner` stays as is): the owner gets `t.*` including the description from `GET /api/tasks` and can edit it via `PATCH /api/tasks/:id` (server/routes.ts ~9610, ~9697). "Landsec to do X" is `waiting_on_party` (values from `LANDSEC_WAITING_PARTIES`, shared/landsec.ts) plus an optional named login.
- A shared action exposes title, owner name, due date, status and place only. Never `description`.

2.1.6 `concept_status`

- No schema change. From now on the only value written is `parked`, shown as "On hold". Values are mapped on read, never rewritten.
- Run first on production (read-only): `SELECT concept_status, COUNT(*) FROM crm_companies GROUP BY 1`.
- Two writers to guard: `updateBrandRecord` allow-list (server/brand-profile.ts:1309-1311: accept only null or `parked`, staff only) and `PUT /api/crm/companies/:id` (server/crm.ts:2041: add `delete req.body.conceptStatus` to the client-scope strip, and the same value check for staff).
- Strip `concept_status` from what client viewers receive in the profile (`company: c`, brand-profile.ts ~1167).
- Tidy `flagged` signal (brand-relevance.ts:62-63) lists watching, pitching, won_deal; whether `parked` joins it is decision 4.

---------------------------------------------------------------------
2.2 ENDPOINTS
---------------------------------------------------------------------

Front doors. Staff routes live under `/api/brand-crm/` (new prefix, on no client allowlist, so clients are denied by default at the gateway in server/index.ts ~4755/~5111; handlers also refuse when `resolveCompanyScope(req)` is non-null). Every Landsec login, and staff previewing as Landsec, uses `/api/landsec/brand-crm/*` and `/api/landsec/diary`, resolved by `landsecViewer` (server/landsec-access.ts:73). Do not put any of this under `/api/brands/`: that prefix is in `CLIENT_ALLOWED_API` and `ASSET_MANAGER_READS`.

Register in server/index.ts beside `setupLandsecBrandCaseRoutes(app)` (~5353).

Shared types (shared/brand-stage.ts):

```ts
type BrandStage = "wanted"|"unit_identified"|"approached"|"viewed"|"negotiating"|"hots"|"solicitors"|"let"|"trading"|"not_proceeding"|"disposing";
type ReqChip = "linked"|"fits"|"place_fits_size_unknown"|"place_fits_size_out"|"size_fits_no_places"|"not_on_list"|"place_unknown"|"no_requirement";
interface PlanRow {
  key: string; companyId: string;
  scheme: { key: string|null; name: string; group: string|null; propertyId: string|null };
  unit: { key: string; tenancyUnitId: string|null; trackerId: string|null; label: string; sqft: number|null;
          occupier: string|null; leaseExpiry: string|null; splitKey: boolean } | null;      // null = no unit yet
  stage: BrandStage; stageSince: string|null; daysAtStage: number|null;
  evidence: Array<{ src: string; label: string; at: string|null; byName?: boolean }>;
  notProceedingReason: string|null;
  requirement: { chip: ReqChip; requirementId: string|null; unitSqft: number|null; range: {min:number;max:number}|null };
  nextStep: { kind: "action"|"viewing_followup"|"viewing_booked"|"deal_waiting"; title: string; dueAt: string|null;
              daysWaiting: number|null; who: string|null; refId: string } | null;
  owner: { id: string|null; name: string|null; source: "deal"|"target"|"viewing"|"wish" } | null;
  links: { tracker: string|null; deal: string|null; unitPage: string|null; property: string|null; scheme: string|null; brandCase: string|null };
  wish: { id: string; note: string|null; visibleToClient: boolean; createdByName: string|null } | null;
}
interface BrandPlan {
  brand: { id: string; name: string; logoUrl: string|null; onHold?: boolean; lead?: {id:string;name:string}|null; aim?: string|null;
           headline: string; nextAction?: { id: string; title: string; dueAt: string|null; ownerName: string|null } | null };
  requirements: Array<{ id: string; summary: string; ageDays: number|null; source: string|null; detailHidden: boolean }>;
  rows: PlanRow[]; notProceeding: PlanRow[];
  askedNoTarget: Array<{ place: string; schemes: Array<{ key: string; name: string }> }>;
  otherSchemeCount?: number;         // asset managers: rows outside their schemes
  warnings: string[];
}
```

Links: tracker `/available?unitId=<trackerId>`; deal `/deals/<id>`; unit page `/landsec/unit/<tenancyUnitId>` only when the property is inside the 14 schemes; scheme `/landsec/scheme/<key>` else `/properties/<id>`; requirement `/requirements?companyId=<id>` (no route opens one requirement; `/requirements/<id>` and `?highlight=` are dead today).

Before the action columns exist, `nextStep` per row comes only from viewing follow-ups, booked viewings and the deal clock; the earliest open CRM action sits at `brand.nextAction` (staff only). Owner: deal agent from `crm_deals.internal_agent` / `internal_agent_ids` (columns exist; which one names the BGP agent is NOT CONFIRMED), else tracker target `agent_user_ids`, else viewing `owner_user_id`, else wish creator.

Add (before the pitch):
- `GET /api/brand-crm/plan/:companyId` returns `BrandPlan`. Staff, unscoped. Includes name-only matches.
- `GET /api/brand-crm/plan?landlord=landsec` returns the grid: `{ schemes: [{key,name,group}], brands: [{ id, name, logoUrl, onHold, lead, requirementHeld, furthest: BrandStage, wantedNoUnit: number, openActions: number, nextAction, cells: Record<schemeKey, { stage: BrandStage; count: number; rowKeys: string[] }> }] }`. Brands listed: any brand with a row on the 14 schemes, plus brands targeted by a strategy (`crm_strategy_targets` on a tenant company) so the seven demo brands show before they have rows.
- `GET /api/landsec/brand-crm/plan` and `GET /api/landsec/brand-crm/plan/:companyId`: same shapes, filtered (2.4).
- `GET /api/brand-crm/diary?from=&to=&kinds=&brandId=&schemeKey=&ownerId=&includeDone=` and `GET /api/landsec/diary?...` return:
  ```ts
  { items: Array<{ id: string; kind: "crm_action"|"viewing_booked"|"viewing_followup"|"deal_waiting"|"brief_signature"|"case_response"|"tenant_rep"|"crm_event";
      title: string; date: string|null; daysWaiting: number|null; overdue: boolean;
      brand: {id:string;name:string}|null; scheme: {key:string;name:string}|null; unitLabel: string|null;
      who: { side: "bgp"|"landsec"|"other"; name: string|null }; raisedBy: "bgp"|"client"|null;
      status: "todo"|"in_progress"|"done"|null; canComplete: boolean; url: string }>,
    counts: { overdue: number; thisWeek: number; nextWeek: number; later: number; waiting: number } }
  ```
  Sources: `crm_engagement_actions` + `user_tasks` on tenant companies; `unit_viewings` (booked = status scheduled; follow-up = `follow_up_date`; both are TEXT columns, so filter with `~ '^\d{4}-\d{2}-\d{2}'` before comparing; inner join to `available_units`; for staff, skip a follow-up that already has a task with `source_ref = 'viewing_followup:<id>'`); `landsec_deal_clock` joined to live deals with a `tenant_id`; `landsec_units` where `briefStatus` is awaiting_am, awaiting_leasing or unsigned (brand null); sent `landsec_brand_cases` with no `landsec_brand_case_responses` row for the viewer (for staff: per asset-manager login in `landsec_access`); staff only: `tenant_rep_searches.next_action` and brand-linked `marketing_events`. Completing an action reuses `PATCH /api/crm/engagement/actions/:id`.
- `GET /api/crm/engagement/brand-search?q=` (staff): `[{id,name}]`, unhidden tenant companies, LIMIT 20, for the brand pickers. I did not identify an existing brand search to reuse; check before adding.
- If the table is approved in time: `POST /api/brand-crm/targets` `{ companyId, schemeKey? , propertyId?, tenancyUnitId?, unitLabel?, note?, requirementId?, visibleToClient? }` returns `{ ok, id }` (400 when a scheme has no property record; 409 on the unique index), and `PATCH /api/brand-crm/targets/:id` `{ tenancyUnitId?, unitLabel?, note?, visibleToClient?, ruledOut?: { reason: string } | null }`. No delete; rule out instead. The unit picker for a Landsec scheme can read `GET /api/landsec/scheme/:key`. "Add to tracker targets" on a row with a tracker brief calls the existing `POST /api/unit-briefs/:id/targets` (body shape not read).

Change (before the pitch):
- `GET /api/crm/engagement` and `/options` (server/crm-engagement.ts:331-346) take `kind=landlord|brand`. Ignored when `companyId` is given, and on the client branch, so brand pages and Landsec's "Your requests to BGP" are unchanged.
  - `getCrmEngagementData(companyId, deps, kind)`:
    - strategies: landlord = no row in `crm_strategy_targets` OR at least one target whose company type is not `tenant%`; brand = at least one `tenant%` target. Return only that kind's targets on each.
    - events: same rule through `crm_event_companies`; guests filtered to contacts of that kind's companies.
    - actions: by `crm_companies.company_type` of `l.company_id` (landlord = NOT LIKE 'tenant%', so no existing action disappears).
  - `getCrmEngagementOptions(q, companyId, kind)`: landlord = `LANDLORD_CATALOGUE_PREDICATE` only; brand = today's brand clause (brands already on a plan plus the asking brand). Do not load the whole directory here; it also loads every contact for the set (:196-199). Pickers use brand-search, then `/options?companyId=` for that brand's contacts.
- Writes take `kind` in the body or query for strategies and events:
  - new record: all companies must be of that kind (`assertCompanies(q, ids, kind)`); a brand strategy needs at least one target or it would vanish from the brand view.
  - TRAP in the current save functions: `saveEngagementStrategy` and `saveEngagementEvent` delete and re-insert every link (:213-214, :232-237). Editing an existing mixed record from one view would delete the other kind's links. With `kind`, scope the DELETEs to companies of that kind (and to guests and strategy links visible in that view).
- Wording: the zod `companyLink` message and the fixed strings at :57, :65, :76, :111, :121, :245-246, :256 say "landlord". Use a schema/message factory keyed by kind; landlord text stays the default.
- `restrictedLandsecApiDecision` (server/landsec-access.ts:108-111): add `joint_agent` + `/api/landsec/brand-crm` to the deny line beside brand-case.
- `GET /api/landsec/unit/:id` (server/landsec-unit.ts ~183, ~271): drop viewing `contact_name` when `access.role === "joint_agent"`.
- Optional two-line fix for other clients who keep the old card: `GET /api/brands/:id/portfolio-activity` files live and withdrawn deals under "Tenant at" because it tests only 'Dead'/'Withdrawn' (server/crm.ts ~4888). Use `legacyToCode` and count only EXC, COM, INV as tenancies.

After the pitch (with the action columns): `POST /api/landsec/diary/requests`, `POST /api/landsec/brand-crm/targets`; these need new `CLIENT_ALLOWED_WRITES` entries (server/index.ts ~4869 lists only `/api/landsec/unit`, `/api/landsec/deal/`, `/api/landsec/brand-case/`), and because restricted roles pass every method under `/api/landsec/` (`RESTRICTED_COMMON`), each handler must itself refuse joint agents and scheme-check asset managers. Extend `actionInputSchema` with `propertyId`, `tenancyUnitId`, `sharedWithCompanyId`, `waitingOnParty`, `waitingOnUserId`; `clientPlanView` then also returns actions where `shared_with_company_id` = the viewer's scope, with `notes: null`.

---------------------------------------------------------------------
2.3 CLIENT COMPONENTS AND MOUNTS
---------------------------------------------------------------------

New, under `client/src/components/brand-crm/`:
- `scheme-plan-card.tsx` ("Schemes and units"). Header line: lead, On hold toggle (staff), aim, next step. Requirement line with link, or "No requirement held. Add requirement" (`/requirements?new=1`). Desktop: table grouped by scheme (Scheme, Unit, Stage pill with evidence line and days, Requirement chip, Next step and date, Owner, link icons). Phone: card list (docs/DESIGN.md: no tables on phones). Footer: "Asked for, no target yet", folded "Not proceeding (n)", and for asset managers "Also at N other schemes, see the brand case". Staff "+ Scheme" opens the wish form when the table exists.
  - Mount: in `BrandProfilePanel` where `PortfolioActivityBlock` is mounted (brand-profile-panel.tsx, currently ~1703) and in client/src/components/mobile-brand-view.tsx beside the brand `LandlordEngagementPanel` (~253). Render it for staff and for Landsec viewers on tenant brands; it replaces the Targeted and Pitched lists there. Other client logins, landlords and agent firms keep `PortfolioActivityBlock`. One mount line each; agree timing with the developer in that file.
  - Endpoint choice: `/api/auth/me` `companyScopeId` set (client login or staff previewing as a client) uses `/api/landsec/brand-crm/plan/:id`; otherwise `/api/brand-crm/plan/:id`.
- `plan-board.tsx` (Targets view): the grid, brands down, 14 schemes across in the four `LANDSEC_GROUPS`, cell = furthest stage pill, click opens that brand's rows in a side sheet. Filter pills with counts: stage, owner, scheme, "No next step", "Wanted, no unit". Phone: brand cards with scheme chips.
- `diary.tsx`: one list; group-by pill row (Date: Overdue, This week, Next week, Later, Waiting; Person; Brand; Scheme); kind pills filter. Read-only before the pitch apart from ticking off an action the viewer may edit.
- `brand-crm-tab.tsx`: sub-pill row Targets / Diary / Strategies and events (the last one staff only, rendering `<CrmEngagementPanel kind="brand" />`). Sub-view in `?view=`, brand filter in `?company=`.
- Stage pills and chips use `client/src/components/ui/pill.tsx` and token colours only; no new chip style.

Edits:
- client/src/pages/brands-hub.tsx `BrandsHub`: add `"crm"` to `HubTab` and `HUB_TABS`, an entry `{ key: "crm", label: "Brand CRM" }` in `VISIBLE_HUB_TABS`, include it in the phone filter (today `t.key === "explorer"` only), and a case in the render switch. Shown to staff and to Landsec viewers who are not joint agents.
- client/src/components/app-sidebar.tsx: staff link "Brand CRM" to `/brands?tab=crm` in both staff lists (near the "Brand Intelligence" entries, ~102 and the phone overlay ~667). `LANDSEC_NAV` is not touched.
- client/src/components/crm-engagement/overview.tsx `CrmEngagementPanel` and dialogs.tsx (`StrategyEditor`, `EventEditor`, `ActionEditor`): new `kind?: "landlord" | "brand"` prop, default landlord. It adds `kind` to the two fetches and swaps the strings ("Landlord", "All landlords", "Landlord page", "landlords it concerns", and the dialog strings at dialogs.tsx ~38, 41, 77, 92). Brand pickers type-to-search via brand-search.
- client/src/pages/people.tsx (~1925): `<CrmEngagementPanel kind="landlord" />`. If `?company=` names a brand, redirect to `/brands?tab=crm&view=strategies&company=`.
- shared/landlord-engagement-view.ts `crmEngagementLink(companyId, record, kind = "landlord")`: brand returns `/brands?tab=crm&view=strategies&company=...`; client/src/components/landlord-engagement-panel.tsx passes its `kind`.
- client/src/components/company-contacts-board.tsx: on brands hide the email-history link and menu item (`canOpenHistory`, ~118) and the dismiss cross on suggested contacts (~802-807) until the server fixes land; `BrandProfilePanel` header: remove the duplicate "Add contact" (~1610).
- server/chatbgp-app-map.ts: update the hub pills and brand CRM lines (~95-96), the CRM page lines (~51, ~119-123), in the same commit as the navigation change.

---------------------------------------------------------------------
2.4 SCOPING PER LOGIN TYPE
---------------------------------------------------------------------

| Viewer | Plan and grid | Diary (before the pitch) |
|---|---|---|
| BGP staff, unscoped | `/api/brand-crm/*`: all brands, all landlords, name-only matches, all wishes, brand-level CRM action | Everything |
| BGP staff previewing as Landsec | Landsec front door; treat as a client view for visibility (`landsecViewer().isClient` is false for them, so test `resolveCompanyScope(req)` too) | As the full Landsec login |
| Full Landsec login and leasing manager (`role` "landsec" or "leasing_manager") | Brand must pass `isClientVisibleBrand`. Properties = `landsecSchemePropertyIds(companyId)` (the 14 schemes, not every Landsec-linked property). Wishes only where `visible_to_client`. Brand case units only from sent cases. No `brand.nextAction`, no lead/aim/onHold, no name-only matches, no target `rationale`/internal evidence. Requirement: chip always; `detailHidden: true` unless the requirement's `sources` include "PIPnet" or its company is the client's own (the Requirements page rule, server/crm.ts ~5363-5375), pending decision 11 | Actions raised by a login of their own company across slice brands (a set-based form of `clientOwnActionIds` with the slice check per brand); deals waiting; briefs awaiting signature; brand cases they have not answered; booked viewings and follow-ups on the 14 schemes |
| Asset manager | Same, with rows filtered by `viewerCanSeeScheme`; `otherSchemeCount` for the rest | Handler returns 403 until the post-pitch step (the gateway lets them reach `/api/landsec/`, so the handler must refuse) |
| Joint agent | Denied at the gateway (new deny line) and in the handler | Handler returns 403 until the post-pitch step; then deals waiting and viewings on own schemes only, no briefs, no cases, no contact names |
| Any other client login (not Landsec) | `landsecViewer` returns null: 403 on the Landsec routes; `/api/brand-crm` denied at the gateway. They keep today's `PortfolioActivityBlock` | None |

Standing rules that still hold: clients never receive strategies, events or BGP-raised actions (`clientPlanView`); nothing BGP raises is shared until `shared_with_company_id` exists; no boot-time writes anywhere in this build; a real letting is entered through server/letting-service.ts `createDeal`, and a speculative target is NEVER recorded by opening a deal (`createDeal` makes or adopts a tracker row and refuses a second live landlord-side letting on the unit).

The check's caveat stands: this does not close the older finding. `/api/brands/:id/portfolio-activity`, `tracker-comments` and `suggested-pitches` remain reachable by asset managers and are filtered by company, not scheme.

---------------------------------------------------------------------
2.5 ORDERED BUILD STEPS
---------------------------------------------------------------------

Six working days (13, 16-20 Nov), no slack. Day one: get decision 2 (the table) and run the two production counts (`concept_status` values; strategies and events with both tenant and non-tenant links).

1. Split and wording, 1 day. server/crm-engagement.ts (kind on reads, options, writes, scoped deletes, brand-search, messages); client/src/components/crm-engagement/overview.tsx and dialogs.tsx; client/src/pages/people.tsx; shared/landlord-engagement-view.ts; client/src/components/landlord-engagement-panel.tsx; brands-hub.tsx tab shell with the Strategies and events view; app-sidebar.tsx; server/chatbgp-app-map.ts. Replaces the review's C2.
2. Engine and stage rules, 2 days. New shared/brand-stage.ts, server/brand-scheme-plan.ts (queries, grouping, viewer filter, four GET routes); `regions` in server/landsec-schemes.ts; joint-agent deny in server/landsec-access.ts; registration in server/index.ts; export `key` from server/brand-relevance.ts; `concept_status` guards in server/brand-profile.ts and server/crm.ts. If the table is approved: migrations/0050, server/schema-drift.ts, shared/schema.ts, `COMPANY_REFS`, tidy signals, POST/PATCH targets. If not: brand-case fallback and the two draft filters in server/landsec-brand-case.ts.
3. Brand card, 1 day. client/src/components/brand-crm/scheme-plan-card.tsx; one mount line in `BrandProfilePanel` and one in mobile-brand-view.tsx.
4. Landsec grid, 1 day. client/src/components/brand-crm/plan-board.tsx; Targets view in the tab shell; phone filter in brands-hub.tsx.
5. Diary, read-only, 1 day. New server/brand-crm-diary.ts (both routes; 403 for restricted roles); client/src/components/brand-crm/diary.tsx.
6. Contacts stop-gaps, about 2 hours. company-contacts-board.tsx hides; duplicate button; `contact_name` strip in server/landsec-unit.ts.
7. Staff, no code: the three Jersey Mike's lettings through the deal form (needs `property_units` rows; may hit `LIVE_LETTING_EXISTS` on a unit that already has a live letting); requirements; the brand case; one strategy holding the seven brands; slice and hidden checks.

After the pitch: the action columns with place, share tick and waiting-on in `ActionEditor`; asset-manager and joint-agent diaries; Landsec writes with their allowlist entries; all-landlords list view; brand-case proposed units read from the table through an admin Preview then Apply copy (never a boot sweep); contacts fixes proper (server/brand-email-threads.ts:159 plus a person filter on `BRAND_EMAIL_ROWS_SQL`; server/contacts-discovery.ts:503, 734, 760; mobile-brand-view.tsx workspace contacts); relationship team and meetings for brands; "On plan" chip on the Requirements board; notifications; scheme filtering of the older `/api/brands/:id/*` routes for asset managers.

---------------------------------------------------------------------
2.6 TESTS TO ADD
---------------------------------------------------------------------

Runner is `node --import tsx --test`; the `test` script in package.json names four files explicitly, and there are 43 `server/*.test.ts` files. How the others are run was not checked; add new files wherever the existing engagement and landlord tests are wired.

- shared/brand-stage.test.ts
  - each evidence kind maps to its stage; furthest wins; legacy status strings via `legacyToCode`.
  - Let versus Trading: completed deal alone is Let; tenancy row is Trading.
  - booked viewing is Approached; completed viewing is Viewed.
  - stale evidence before the unit's last closed letting is ignored; a different tenant on the unit's deal gives not_proceeding.
  - Lease Disposal and Sub-Letting give disposing, never a target.
  - brand case "Under offer" does not move the stage; AI-suggested target_tenants do not make a row.
  - requirement chip: every key; regions ("South East" fits Bluewater; "National" fits all; "London" fits the London group); "Under 500 sq ft"; no places; unit with no area.
- server/brand-scheme-plan.test.ts (fake `Queryable`, as crm-engagement's `deps.pool` allows)
  - tracker-only and spine evidence for one physical unit merge into one row through each of the joins; an unresolvable tracker row yields `splitKey: true`, not a merge.
  - Landsec viewer: non-scheme properties dropped; hidden brand or brand outside the slice 403; non-visible wish hidden; draft brand case units hidden; requirement detail hidden unless PIPnet; no `nextAction`.
  - asset manager: only own-scheme rows plus `otherSchemeCount`; joint agent 403; non-Landsec client 403.
  - missing `brand_scheme_targets` table returns a warning, not a 500.
- crm-engagement kind tests
  - landlord view keeps unlinked strategies and events and all non-tenant actions; brand-only records are absent.
  - a mixed record appears in both views with only that view's companies.
  - saving a mixed record from one view leaves the other kind's targets, guests and strategy links intact.
  - a new mixed strategy or event is refused; a brand strategy with no target is refused.
  - no `kind` and a `companyId`: response identical to today; client branch (`clientPlanView`, `clientOwnActionIds`) unchanged.
- diary tests
  - a Landsec login sees only its own company's actions across brands; another client's actions never appear; hidden and out-of-slice brands excluded.
  - restricted roles get 403; text dates that are not ISO are skipped, not thrown.
  - a viewing follow-up with a `viewing_followup:` task appears once for staff.
- gateway: `restrictedLandsecApiDecision` denies a joint agent `/api/landsec/brand-crm`, allows an asset manager GET; `/api/brand-crm/*` is refused for a client login and for staff with a client scope.
- `concept_status`: a client PUT to `/api/crm/companies/:id` cannot set it; `updateBrandRecord` accepts only null or `parked`; the client profile payload omits it.
- brand-relevance: the new signal keeps a brand with a live wish; a brand with any wish is not deletable.
- Browser pass on real data (BGP_QA_TOKEN, read only): Starbucks plus the six brands once staff have entered them; desktop and phone; nothing in this spec has been opened in a browser.

---------------------------------------------------------------------
2.7 NOT CONFIRMED (carry into the work)
---------------------------------------------------------------------

- Production data: `concept_status` values; how many strategies or events mix brands and landlords; whether the seven brands are in Landsec's slice and unhidden; whether the three Jersey Mike's units have tracker rows, `property_units` rows or deals. The local DB holds only Starbucks, 0 requirements, 0 target_tenants, 1 brand case, 1 strategy.
- Which deal column holds the brand on a Lease Disposal or Sub-Letting (the query assumes `tenant_id`).
- Which of `crm_deals.internal_agent` / `internal_agent_ids` names the BGP agent.
- That `crm_deals.unit_id` and `tenancy_schedule_units.property_unit_id` reference the same `property_units` row.
- `mergeProperties` behaviour (taken from the check, not read by me); where the "Relationship lead" role is stored; the body of `POST /api/unit-briefs/:id/targets`; `clientBrandSliceSql`; whether `/requirements?new=1` can prefill a brand; whether an existing brand search endpoint can serve the pickers.
- Whether the Landsec unit page gives joint agents the agreed-brief figures (raised by the check, not resolved).
- `leasing_schedule_units` rows with a `tenant_company_id` are counted as trading without a status test, as today's card does.
- Requirements stored with a name and no `company_id` are invisible to the chip.
- Effort figures are estimates; the second developer in brand-profile-panel.tsx and brands-hub.tsx is the main schedule risk.
- No Landsec login was used and no page was opened in a browser for this spec.

Files read for this spec: docs/brands-review-2026-11-12.md (to line 330), server/crm-engagement.ts, server/landsec-access.ts, server/landsec-schemes.ts, server/landsec-brand-case.ts, shared/landsec.ts, shared/requirement-fit.ts, server/schema-drift.ts (head), server/brand-relevance.ts (to line 120), server/brand-dedupe.ts (`COMPANY_REFS`), server/crm.ts (portfolio-activity, company PUT), server/landsec-unit.ts (parts), migrations/0049_landsec_units.sql (head), and greps of server/index.ts, brands-hub.tsx, app-sidebar.tsx, App.tsx. Everything else rests on the five maps and the feasibility check.
```

## Feasibility check

```text
CHECK OF THE TWO DESIGNS AGAINST THE CODE (read-only; nothing changed, SELECT only)

Neither design wins outright. Take plan-first for A (cut back) and D, derive-first for B and C, and derive-first's timing for E. Both pre-pitch build orders are too long as written.

| Part | Winner | Main correction |
|---|---|---|
| A. Schemes and units | plan-first, with derive-first's lean table | Drop the hand-set columns; fix unit keys and stale evidence |
| B. Stage names | derive-first | Use "Unit identified"; a booked viewing counts as Approached |
| C. Separate Brand CRM | derive-first (near tie) | The landlord view must keep strategies and events with no company link |
| D. Diary | plan-first | Share the title only; no joint-agent briefs; add the client write allowlist entry |
| E. Contacts | same list; derive-first's timing | Add plan-first's joint-agent contact-name strip |

## Claims that are wrong or incomplete

- **Derive-first's staff routes sit on a client-readable prefix.** `/api/brands/` is in `CLIENT_ALLOWED_API` (server/index.ts ~4758) and in `ASSET_MANAGER_READS` (server/landsec-access.ts:101). So `GET /api/brands/crm-diary` and `/api/brands/scheme-plan` reach every client login unless the handler refuses. Plan-first's `/api/brand-crm/*` is denied to clients by default.
- **A Landsec owner on a shared action leaks the notes (derive-first D).** `GET /api/tasks` returns `t.*` to the owner, description included (server/routes.ts ~9610). `PATCH /api/tasks/:id` lets the owner change title and description (~9697). Reject the `assertOwner` change; plan-first's "waiting on" keeps a BGP owner.
- **Asset managers cannot get CRM actions "limited to their schemes" before the columns exist (derive-first D).** `crm_engagement_actions` has six columns and none is a place (confirmed on the test DB). Plan-first says this correctly.
- **New Landsec writes need an allowlist entry both designs miss.** `CLIENT_ALLOWED_WRITES` lists only `/api/landsec/unit`, `/api/landsec/deal/` and `/api/landsec/brand-case/` (index.ts ~4871). Restricted roles pass every method under `/api/landsec/` (`RESTRICTED_COMMON`), so the handler itself must refuse joint agents and scheme-check asset managers.
- **The kind filter would change the landlord CRM as described (both, C).** `getCrmEngagementData` with no company returns every `marketing_campaigns` and `marketing_events` row, linked or not (server/crm-engagement.ts:151-158). The landlord view must keep rows with no company link or at least one non-tenant link. The brand view takes rows with at least one tenant link.
- **"Closes the asset manager finding" is overstated (plan-first D).** `/api/brands/:id/portfolio-activity`, `tracker-comments` and `suggested-pitches` stay reachable and are filtered by company only (server/crm.ts:4864-4880).
- **Draft brand cases are open on two routes, not one.** Neither the list (server/landsec-brand-case.ts:66) nor the single case (:84) filters on status. The no-table route for wishes needs both hidden from clients.
- **Opening a deal on an occupied target unit is wrong for a speculative target (derive-first decision 9).** `createDeal` makes or adopts a tracker row for any live letting (server/letting-service.ts:780-840, `ensureTrackerRowForDeal`) and refuses a second live landlord-side letting on the unit. Use it only for real lettings, such as the three Jersey Mike's ones.
- **The stage column has a second writer both designs miss.** `PUT /api/crm/companies/:id` passes the body to `storage.updateCrmCompany` for a client on a visible brand (crm.ts:2041-2059). Guarding `updateBrandRecord` alone is not enough.
- **Property merges need no work; company merges do.** `mergeProperties` finds every column named `property_id` by itself (server/property-merge.ts:10, 44-52). `COMPANY_REFS` in server/brand-dedupe.ts is a hand list and needs the new table added. `crm_engagement_actions` is not on it today either.

## Confirmed as described

- **Wish with no unit:** the brand case PUT accepts `tenancyUnitId: null` and replaces the whole array (landsec-brand-case.ts:124, 141).
- **Deal clock:** any role with unit access can set it, joint agents included (server/landsec-unit.ts:498-505). Joint agents cannot sign briefs (:559).
- **Joint-agent leak:** viewing `contact_name` goes to every role (landsec-unit.ts:183).
- **Contacts refusals:** the email-history route is staff-only (server/brand-email-threads.ts:150-152, 159). The dismiss route is staff-only and landlord-only (server/contacts-discovery.ts:753-761).
- **503 risk:** one failed statement in `CRM_ENGAGEMENT_MIGRATIONS` takes the plan down for everyone (index.ts:3008-3020).

## Database statements

All are additive and placed where boot applies them.

- **Table by boot array (derive-first) or by file 0050 (plan-first):** both work. The five Landsec tables are created only by file 0049 through `IDEMPOTENT_SQL_MIGRATIONS` (server/schema-drift.ts:36-60). A file is one query, so one bad statement drops the whole file with only a warning; reads must tolerate a missing table.
- **Action columns:** use plan-first's form with no foreign keys. Derive-first's `REFERENCES crm_companies` on the share marker is the one statement with a new way to fail.
- **Table shape:** derive-first's, plus plan-first's `visible_to_client boolean NOT NULL DEFAULT false` and `created_by_company_id`.
  - Derive-first would show BGP-written "Wanted" rows and notes to Landsec with no marker.
  - Drop `landlord_view*`, `priority` and `owner_user_id`. The case unit status already offers Proposed, Agreed, Under offer and Declined (client/src/pages/landsec-brand-case.tsx:286).
  - `requirement_id` is optional.
- **Tidy:** the keep-signal must ship in the same commit as the table. The table cascades on company delete, and "Delete for good" would otherwise remove wishes.

## Part by part

**A. Plan-first, cut back.**
- Keep from plan-first: the separate Landsec front door, the visibility switch, "Asked for, no target yet", Lease Disposal and Sub-Letting shown as "Disposing", and the region question for Woody. The chips have no Yorkshire (client/src/lib/crm-options.ts:282).
- Keep from derive-first: the lean table, and name-only matches on the single-brand view only.
- Fix the unit key: resolve the unit through all three joins before grouping. Deals also carry `unit_id` pointing at `property_units`, a fourth id (shared/schema.ts:895).
- Fix stale evidence: ignore viewings and offers from before the unit's last completed letting. Show "Not proceeding" when the unit's deal names another tenant.
- For Landsec viewers, follow the Requirements page rule on requirement detail until Woody decides.

**B. Derive-first.**
- It separates Let from Trading. Plan-first's "Open" would mark the Jersey Mike's units open on completion.
- Take from plan-first: "Unit identified", which matches the tracker's "Identified", and booked viewing as Approached.
- Keep derive-first's single "On hold" stored as `parked`. Count production values first.

**C. Derive-first, near tie.**
- Keep the `company=` parameter.
- Do not load the whole brand directory through `/options`; it also loads every contact for the set (crm-engagement.ts:196-199). Use a search.
- Read the landlord side as "not tenant", so no existing action disappears.
- The server's "landlord" messages are fixed strings (crm-engagement.ts:57, 245-246) and need a brand wording.

**D. Plan-first.**
- Share the title only, as derive-first proposes.
- Drop briefs from the joint-agent diary.
- The cross-brand client read needs the slice check per brand and a set-based form of `clientOwnActionIds`.
- `follow_up_date` and `viewing_date` are text (schema.ts:1972, 1989). Viewings with no unit cannot be scoped, so leave them out for Landsec.

**E. Same list in both.**
- Before the pitch: fix or hide the email-history link, the dismiss control and the duplicate button. The review's L2 already covers the first.
- Add plan-first's joint-agent strip.
- The relationship team board waits.

## Build order

Six working days remain (13 and 16-20 November). Each design claims about six developer days, on top of the review's own six. A second developer is in the two files both designs mount into, and nothing has been run on real data.

A realistic cut:
1. C split and wording, 1 day. It replaces the review's C2.
2. Engine and stage rules with a ranking test, 2 days, not 1.5.
3. Brand card, 1 day.
4. One list view (the Landsec matrix), 1 day.
5. Diary, read-only, for staff and full Landsec logins only, 1 day.

That is six days with no slack. Asset-manager and joint-agent diaries, sharing, action columns and the second list view wait. Ask Woody for the table on day one, since it is the only store for "wanted, no unit".

Staff must enter the three lettings through the deal form. That needs `property_units` rows and may hit `LIVE_LETTING_EXISTS`.

## Not verified

- Production data: `concept_status` values, mixed strategies, and whether the seven brands are in Landsec's slice.
- Which deal column holds the brand on a Lease Disposal.
- Whether the unit page gives joint agents the agreed brief figures.
- Nothing was opened in a browser.
```

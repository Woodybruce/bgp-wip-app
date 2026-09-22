# Unit Status & Spine Cleanup — Migration Plan

Companion to `unit-status-architecture.svg` (current), `unit-status-target-state.svg`
(target), and `unit-column-ownership.xlsx` (the field-level ownership spec — the
canonical source of truth for who-owns-what). Run-first gate: `integrity-gate-report.sql`.

Owner: Woody. Status: awaiting integrity-gate numbers before any code changes.

## Decisions locked

- **Vocabulary** — seven names used verbatim in DB and UI:
  Available · Negotiating · Solicitors · Exchanged · Completed · Invoiced · Withdrawn.
- **Two-layer spine** — `property_units` owns PHYSICAL facts (address, UPRN, area,
  EPC, condition, use class); they're permanent and survive lease changes.
  `tenancy_schedule_units` owns LEASE/INCOME facts (rent, dates, breaks, tenant,
  rates). `available_units`, `leasing_schedule_units` and `crm_deals` read through.
- **Marketing model** — separate layer. Status answers "where is the deal?"; a
  marketing flag + reason answers "is this unit being marketed and why?".
- **Deal is born at Solicitors** — the WIP/SOL promotion creates the `crm_deals`
  row (capturing parties, fees, AML). Add-Unit and marketing-on do **not** create
  deals. Pre-deal agent ownership lives on `available_units.agent_user_ids`.
- **Concurrent deals** — a remarketed Trading unit keeps its tenancy intact and a
  new letting deal rides its own journey alongside.
- **One live deal per unit** — competing tenants live as rows in `unit_offers`
  against the single live deal. Accepted offer promotes to the deal's headline terms.
- **Invoiced is internal-only** — visible on Letting Tracker, Deals, WIP. The Leasing
  Schedule (the client view — there is no separate client property page) caps at
  Completed; the unit then drops off the marketing list and reads "Trading" via occupancy.
- **Unified Add-Unit** — one dialog on Letting Tracker AND Tenancy Schedule. Always
  writes `property_units` (physical) + `tenancy_schedule_units` (lease spine).
- **Sequencing** — integrity gate → staged additive migration → flip & delete. No big-bang.

## Column ownership (two-layer) — summary

Detailed, editable spec is in `unit-column-ownership.xlsx` (101 facts). Summary:

| Fact group | Owner | Read-through from |
|------------|-------|-------------------|
| Address, UPRN, floor, **area (nia/gia/itza)**, EPC, condition, use class | **`property_units`** (physical) | tenancy, available_units, leasing, crm_deals |
| Passing rent, ERV, quoting, lease dates, breaks, review, tenant, rates, SC, insurance | **`tenancy_schedule_units`** (lease) | available_units, leasing_schedule_units |
| Occupancy, marketing_active, marketing_reason | `tenancy_schedule_units` (new cols) | all boards (filter) |
| Deal status (the 7), agreed rent, pricing, fee, AML, dates, **date of entry**, solicitor sub-journey | `crm_deals` | Tracker / Leasing / Deals |
| Viewings, offers, marketing start, agents, marketing collateral | `available_units` (Tracker) | leasing reads viewings/offers |
| Zone, positioning, priority, **target brands** | `leasing_schedule_units` | — |
| `tenancyScheduleUnits.targetTenants`, `targetCompanyIds` | **retire** (own on leasing) | — |

## Structural gaps to fix (found in schema audit)

1. **No physical→lease FK.** `tenancy_schedule_units` has only `property_id`, no FK to
   `property_units`. The two-layer model needs `tenancy_schedule_units.property_unit_id`
   added + back-filled by matching `(property_id, unit name)`. (See integrity-gate query 4.)
2. **Bidirectional back-pointers.** `available_units.tenancy_unit_id` ⇄
   `tenancy_schedule_units.letting_tracker_unit_id` point at each other. Keep one
   direction (child → spine); **delete** `letting_tracker_unit_id`.
3. **Triple deal link.** `available_units.deal_id`, `tenancy_schedule_units.deal_id`,
   `crm_deals.tenancy_unit_id` all store the relationship. Keep `crm_deals.tenancy_unit_id`
   as canonical; retire the two cached `deal_id` columns after read-through lands.
4. **Auto-deal-on-Tracker** (available-units.tsx ~577–621) contradicts deal-at-SOL.
   Removed in Stage 3; existing AVA-status deals reconciled in the same stage.

## Target schema (delta only)

```
property_units                         (becomes the physical master of record)
    unit_address, unit_postcode, unit_uprn, floor, sqft, use_class,
    condition, epc_rating          (already present)
  + nia_sqft, gia_sqft, itza_sqft  (migrated in from tenancy at Stage 5)

tenancy_schedule_units
  + property_unit_id     FK → property_units.id      (Stage 1, back-filled)
  + occupancy            Vacant | Trading | Holding Over | Lease Event Pending | Archived
  + marketing_active     boolean
  + marketing_reason     Vacant | Lease Event | Tenant at Risk | Active Management
  - status               (dropped at Stage 6)
  - letting_tracker_unit_id, deal_id, target_tenants, target_company_ids,
    epc_rating, nia/gia/itza_sqft   (retired at Stage 5)

crm_deals                              (rename status labels only; columns already exist)
    status: Available … Withdrawn (seven names, UI label over AVA/NEG/SOL/EXC/COM/INV/WIT)
    created_at  → surface as "Date of entry" (sortable)
    solicitor_firm/contact/instructed_at/draft_lease_received_at/
    comments_returned_at/engrossment_at/notes → surface (already in schema)

available_units, leasing_schedule_units
    status fields retired in UI; rows persist as filtered read-through views
```

## Stages

**Stage 0 — Integrity gate (READ-ONLY, blocking)**
- Run `integrity-gate-report.sql` against prod.
- Decision: if null/dangling spine links and multiple-live-deal violations are small,
  proceed as a refactor. If large, insert a data-cleanup sprint first.
- No code changes until the numbers are in.

**Stage 1 — Additive schema** (no behaviour change)
- Add `property_unit_id` to `tenancy_schedule_units`; back-fill by `(property_id, unit name)`.
  For unmatched tenancy rows, create the missing `property_units` master from tenancy data.
- Add `occupancy`, `marketing_active`, `marketing_reason` to `tenancy_schedule_units`.
- Backfill occupancy + marketing_active from existing `status` (mapping below).
- Dual-write: legacy `status` keeps updating alongside the new columns.

**Stage 2 — UI rename**
- All status pills/dropdowns adopt the seven names.
- `leasing_schedule_units.status` / `available_units.marketing_status` display canonical
  names; values translated at the edges. No DB changes.

**Stage 3 — Unified Add-Unit + deal-at-SOL**
- One `UnitFormDialog` on Letting Tracker AND Tenancy Schedule. Writes `property_units`
  + `tenancy_schedule_units` (linked). `marketing_active=true` also creates an
  `available_units` row.
- Remove auto-deal-on-Tracker. Deal creation moves entirely to the WIP/SOL promotion.
- Reconcile existing AVA-status deals: keep with a `pre_sol` flag (history) or delete
  per the integrity-gate count — decide once the numbers are in.
- Point pre-deal agent ownership at `available_units.agent_user_ids`.
- Retire the "Promote orphans to tenancy" button (unification makes it redundant).

**Stage 4 — Engine collapse**
- Replace `server/unit-mirror.ts` inline maps with one shared mapping module.
- Marketing-flag edits drive Tracker/Leasing visibility (replaces coarse reverse-mirror).
- Dual-write retained for safety.

**Stage 5 — Column ownership cleanup (read-through)**
- Migrate physical facts (area, EPC, condition, use class) to `property_units`;
  boards read through the `property_unit_id` / `tenancy_unit_id` joins.
- Retire `tenancy.target_tenants` / `target_company_ids` (own on leasing).
- Delete back-pointers: `tenancy.letting_tracker_unit_id`, cached `deal_id` columns.
- Mirror engines stop column translation; only `marketing_active` fans out.

**Stage 6 — Flip & delete**
- Re-run integrity gate: every unit reconciled.
- Drop `tenancy_schedule_units.status`. Remove dual-write paths.
- Diagram + xlsx become ground truth.

## Parallel workstream P — Board UX (no schema dependency)

Can run alongside Stages 1–6; only depends on Stage 1's `marketing_active` flag for one filter.

- **Shared base filter set** on all four boards: search, "my units/deals"
  (internal_agent_ids / agent_user_ids contains me), marketing-active-only,
  date-range (board picks the date: Tracker=marketing_start, Tenancy=expiry/break/review,
  Leasing=expiry, Deals=created_at/target/completed).
- **Sort parity** — port the Deals board `useTableSort` hook to Tenancy, Tracker, Leasing.
- **Surface date-of-entry** (`crm_deals.created_at`) on Tracker + Deals, sortable.
- **Surface solicitor sub-journey** on the deal detail (firm/contact/draft-lease/
  comments/engrossment/notes — all already in schema).
- Note: saved-views are DB-backed; porting *views* is API+schema, porting *sort* is cheap.

## Backfill mapping (Stage 1)

Reading the existing `tenancy_schedule_units.status`, populate:

| existing status | occupancy             | marketing_active | marketing_reason |
|-----------------|-----------------------|------------------|------------------|
| Vacant / Void   | Vacant                | true             | Vacant           |
| Marketing       | Vacant                | true             | Vacant           |
| In Negotiation  | Vacant                | true             | Vacant           |
| Held            | Vacant                | true             | Vacant           |
| Under Offer     | Vacant                | true             | Vacant           |
| Occupied / Let  | Trading               | false            | —                |
| Trading         | Trading               | false            | —                |
| Holding Over    | Holding Over          | false            | —                |
| TAW             | Holding Over          | false            | —                |
| Lease Event     | Lease Event Pending   | false            | —                |
| Archived        | Archived              | false            | —                |
| (anything else) | left untouched, logged for manual review |

`crm_deals.status` codes (AVA…WIT) get the seven friendly labels at the UI layer — no
DB change to deal status values.

## Risks

- **Spine links not populated** — quantified by Stage 0; gates everything. Read-through
  joins return blanks if `tenancy_unit_id` / `property_unit_id` are null.
- **Missing physical masters** — tenancy rows with no `property_units` match get one
  created from tenancy data at Stage 1; logged for review.
- **Orphaned AVA deals** when auto-deal is removed (Stage 3) — reconciliation decided
  by integrity-gate count.
- **Legacy/unknown status values** — Stage 1 logs, never auto-changes.
- **Boards reading old `status` mid-transition** — dual-write through Stages 1–4;
  Stage 5/6 fire only when the gate is clean.

## Cleanup candidates retired by this work

1. Tenancy "Add" never opens a deal → unified Add-Unit writes the spine; deal is born
   at Solicitors by design (not a bug to fix, a flow to formalise).
2. Deal "Add" doesn't show on boards → boards filter on marketing flag + spine link,
   not deal existence.
3. Reverse-mirror coarsens occupancy → mirror gone; occupancy on its own axis.
4. Unrecognised status no-op → one vocabulary, nothing to misrecognise.
5. Two mapping sources drift → collapsed to one.
6. Bidirectional back-pointers + triple deal link → reduced to one direction (child → spine).
7. Physical facts re-entered per lease → owned once on `property_units`.

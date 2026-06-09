# Integrity Gate — Baseline Reconciliation (snapshot)

Run against production Railway Postgres on 2026-06-08. Read-only.
Source query: `integrity-gate-oneshot.sql`.

## Raw result

| metric | value |
|--------|-------|
| property_units rows | 152 |
| tenancy_schedule_units rows | 198 |
| available_units rows | 54 |
| leasing_schedule_units rows | 1101 |
| crm_deals rows | 190 |
| 1 · available_units NO spine link | 25 |
| 1 · available_units DANGLING spine link | 0 |
| 2 · available_units NO physical link | 0 |
| 2 · available_units DANGLING physical link | 2 |
| 3 · leasing_schedule NO spine link | 903 |
| 3 · leasing_schedule DANGLING spine link | 1 |
| 4 · crm_deals NO spine link | 174 |
| 4 · crm_deals DANGLING spine link | 0 |
| 5 · tenancy matchable to physical (by name) | 83 |
| 5 · tenancy NO physical match | 115 |
| 6 · back-pointer mismatch (avail ⇄ tenancy) | 24 |
| 6 · deal_id mismatch | 7 |
| 7 · units with >1 LIVE deal | 1 |
| 8 · EPC drift avail vs tenancy | 0 |
| 8 · sqft drift avail vs tenancy NIA | 0 |
| 9 · tenancy still holding target brands | 9 |

## Reading

- **No corruption among linked rows.** EPC drift = 0, sqft drift = 0. Where links
  exist, the mirror has kept duplicated fields in sync. The problem is *missing
  links*, not *divergent data*.
- **Core letting flow is a small, tractable cleanup:** 25 available_units to link
  (46%), 2 dangling physical links, 1 multi-live-deal violation, 9 target-brand
  rows to migrate, and a back-pointer (`letting_tracker_unit_id`) that is stale on
  24 of 29 linked pairs — confirming it should be deleted, not trusted.
- **The big numbers are separate datasets, not breakage:**
  - `leasing_schedule_units` (1101 rows, 82% unlinked) is the Landsec-centric
    client dataset — it was never wired to the tenancy spine. Linking it is a
    project in its own right, not a bug-fix.
  - `crm_deals` (190 rows, 92% unlinked) includes investment/agency/requirement
    deals that legitimately have no single tenancy unit. Only letting deals need
    the spine link.
- **Two-layer back-fill needs more than name-matching.** Only 83/198 tenancy rows
  (42%) match a `property_units` row by `(property_id, unit name)`. property_units
  (152) < tenancy (198), so some tenancy rows have no physical master at all. The
  `property_unit_id` back-fill = create-missing + fuzzy-match + manual reconcile.

## Decision required: spine scope

- **A. Letting pipeline only** (recommended start): spine = available_units ↔
  tenancy ↔ letting deals. ~25 links + small cleanup. Leave Landsec leasing
  schedule and investment deals as separate islands for now.
- **B. Everything**: link all 1101 leasing rows + all 190 deals. Large, mostly
  manual.
- **C. Phased**: A now, leasing schedule onboarding as a later phase.

## Decision

Scope = **B (everything, including Landsec)**, chosen 2026-06-08. "Linked" means: link every row that maps to a unit; building/portfolio-level deals (investment/agency/requirements with no unit) get an explicit "not unit-scoped" flag rather than a forced link. Next: `linkage-proposal.sql` sizes the auto-matchable vs manual burden.

## Linkage proposal results (2026-06-08)

| category | auto_unique | ambiguous | no_match / build-level | total |
|----------|-------------|-----------|------------------------|-------|
| A available_units orphans → tenancy | 0 | 0 | 25 | 25 |
| B leasing_schedule orphans → tenancy | 0 | 0 | 903 | 903 |
| C crm_deals unlinked (has unit_id / none) | 37 | — | 137 | 174 |
| D tenancy without physical → property_units | 0 | 0 | 115 (must create) | 115 |

Unlinked-deal `deal_type`: **170 New Letting**, 1 Purchase, 1 Investment Acquisition,
1 Consultancy, 1 null.

### Reading
- **Name-based auto-matching is a dead end.** Zero normalised name matches in A, B, D.
  The tables use different unit-naming schemes (or non-overlapping property_id sets).
  Reconciliation is a manual / heuristic project, not a scripted UPDATE.
- **But a better bridge exists:** every available_units row already has `unit_id` →
  property_units (0 missing). Once `tenancy.property_unit_id` is populated, units can be
  matched sibling-to-sibling *through property_units* instead of by name. That's the
  reconciliation key to build on — not names.
- **Deals are mostly unit-scoped, not building-level.** 170/174 unlinked are New Letting
  — they're letting deals that lost their unit link, a DATA problem. Only ~4 (Purchase,
  Investment Acq, Consultancy, null) are genuinely unit-less → the `deal_scope='building'`
  population is tiny, which validates the flag but means it's not where the volume is.
- **None of this changes the target structure** — it validates it. The structure is what
  lets these orphans be attributed at all.

## Stage 1 — APPLIED to production 2026-06-08

Migration 0032 run against prod Railway Postgres. Verified present:
- `tenancy_schedule_units`: property_unit_id, occupancy_status, marketing_active, marketing_reason
- `crm_deals`: deal_scope (default 'unit')
All columns NULL/default, no back-fill yet, no behaviour change. Stage 2 next.

## Stage 2 part 1 — APPLIED 2026-06-08 (back-fill occupancy/marketing)

Migration 0033 run against prod. UPDATE 198. Result:
- Occupied(170) → Trading / not-marketed
- Vacant(9), Marketing(8), Under Offer(8) → Vacant / marketing_active=true / reason=Vacant
- Held(3) → Vacant / not-marketed  (provenance unknown — suspected Landsec quirk; correctable later)
Totals: 170 Trading, 28 Vacant; 25 marketing_active.
Note: 54 available_units rows vs 25 marketing-active tenancy units — reconcile later.

## Stage 2 part 2 — APPLIED 2026-06-08 (bgp_acting_for + one-live-deal rule)

Migration 0034 run against prod. Clean:
- crm_deals.bgp_acting_for added (default 'landlord')
- 2 Google tenant-rep deals (Beauty Pie + Ronning Menswear) flipped to 'tenant'
- Partial unique index `crm_deals_one_live_landlord_per_unit_idx` created — rule now ENFORCED
Tally: landlord 188 · tenant 2. Tenant-rep tagging is opt-in going forward.

## Stage 2 part 3 — APPLIED 2026-06-08 (back-fill property_unit_id via bridge)

Migration 0035 run against prod. UPDATE 29. Result:
- 29 tenancy rows now have property_unit_id (the new physical link)
- 169 still NULL — long-tail manual reconciliation (Path B), unblocked from Stage 3
- All 29 were populated by copying through available_units (the only viable bridge,
  since name-matching returned 0)

Stage 2 is now COMPLETE: structure live, back-fill done where automatable, one-live-deal
rule enforced, tenant-rep distinction made. Stage 3 (unified Add-Unit + deal-at-SOL,
code change) is next.

## Mobile Expenses fixes — APPLIED 2026-06-08

Code: PATCH /api/expenses/:id now advances status on isPersonal flip; Revolut
ingestion auto-categorises £0 + TfL at source. One-shot cleanup of existing
pending_receipt rows:
- 4 × £0 (Anthropic ×2, Google, Microsoft Store) → categorised / "Auth / £0"
- 4 × TfL £1.50 → categorised / "Travel"
- 1 × Mortimers Cafe £7.80 (was stuck personal) → approved / "Personal (deduct from payroll)"
Awaiting list trimmed from 16 → 7 real receipts.

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

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

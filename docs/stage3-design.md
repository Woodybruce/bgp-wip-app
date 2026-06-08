# Stage 3 — Unified Add-Unit + Deal-at-Solicitors

The first stage with user-facing change. Stages 1–2 were silent DB plumbing;
Stage 3 changes how units come into the system and removes a long-standing
silent side-effect (auto-creating deals on Add Unit).

## What the user sees

### The "+ Add Unit" button — same dialog, two entry points

| Surface | Today | After |
|---------|-------|-------|
| Letting Tracker (`/available`) | Opens `UnitFormDialog`, captures marketing + creates everything inc. a deal | Opens unified dialog, defaults **marketing_active = true** |
| Tenancy Schedule (`/tenancy-schedule/:id`) | Opens `AddTenancyUnitForm` (minimal — unit number + tenant + dates) | Opens **same** unified dialog, defaults **marketing_active = false** |
| Leasing Schedule (`/leasing-schedule`) | Opens `AddLeasingUnitForm` (its own thing) | **No change in Stage 3** — Landsec island stays islanded until we get to it |

The dialog is the SAME component, with a single boolean — "is this unit being marketed?" — that pre-fills correctly per entry point and is editable in the form. Everything else (property picker, unit name, areas, EPC, rent, tenant) is shared.

### What disappears

- **"Promote orphans to tenancy" button** on Tenancy Schedule. Redundant — every new unit now writes to tenancy directly.
- **The silent auto-deal on Add Unit.** No more pre-SOL deal rows polluting the kanban; the Tracker shows units, not deals, until Solicitors.

### What appears

- **"Promote to Solicitors" button** on the Tracker row (this already exists as the WIP flip dialog) becomes the **single** place a deal is born. UI doesn't change much; the flow downstream of it is what's being formalised.

### Pre-deal agent ownership

Today: agents get stamped on both `available_units.agent_user_ids` AND `crm_deals.internal_agent` at Add time.
After: only `available_units.agent_user_ids`. The deal inherits these names when promoted at SOL. Already-supported by schema; we just stop the second write.

## What happens behind the scenes

### POST /api/available-units — five things → four

```
BEFORE                                  AFTER
─────                                   ─────
1. find/create property_units           1. find/create property_units    (same)
2. INSERT available_units               2. INSERT available_units        (same)
3. INSERT leasing_schedule_units        3. INSERT leasing_schedule_units (same)
4. ensureTenancyRow (mirror)            4. ensureTenancyRow (mirror)     (same)
5. INSERT crm_deals + stamp deal_id     5. ─ REMOVED ─
```

Removing #5 means `available_units.deal_id` is NULL until SOL promotion.
Anything reading "the deal for this unit" must tolerate that — Stage 3 audits and fixes those readers (there are a few — kanban color map, fee allocation, AML compliance filter — all flagged in `crm_deals` schema comments line 841–847).

### New POST /api/tenancy/unit (or extend existing)

Tenancy-Schedule Add becomes the same code path:
- Same unified validator
- `marketing_active = false` default
- Always writes property_units + tenancy_schedule_units
- Optionally writes available_units **only if `marketing_active = true`**
- Never writes crm_deals

### SOL promotion (existing WIP form, available-units.tsx:1820–2176)

This already exists and does the right thing — it's the "promote to Solicitors" dialog that captures tenant, fees, AML, lease terms. Stage 3 work here is:
- Make it the **only** place `crm_deals` rows are born
- Stamp the new `bgp_acting_for` (default landlord, toggle for tenant-rep)
- Ensure `tenancy_unit_id` is always populated on the new deal (the spine link)

## Existing-data reconciliation

188 deals currently exist with `bgp_acting_for = 'landlord'`. Some are real Solicitors+ deals; some are the auto-created pre-SOL deals we're killing the source of.

Two options, presented per integrity-gate finding (~37 of the 174 unlinked deals have unit_id set, the rest don't):

- **A. Leave them alone.** Existing deals keep working; new unified Add stops creating more pre-SOL ghosts. Over time, AVA-status ghosts naturally age out.
- **B. Tidy on the way through.** Sweep through all `status = 'AVA'` deals with no SOL+ progression; either delete or set `status = 'Withdrawn'` so they vanish from the live boards.

A is safer, B is cleaner. I recommend **A** for Stage 3 and a separate one-time clean in Stage 6 alongside other final tidies.

## Risks + rollback

| Risk | Mitigation |
|------|------------|
| Reader assumes "every available_units row has a deal_id" | Code audit + null-safe reads. List of three known readers in schema.ts:841–847. |
| New Add-Unit form mis-defaults marketing flag | Boolean is editable in the form; can't be silently wrong. |
| WIP/SOL promotion path was rarely the *only* deal entry point — now it's load-bearing | Existing flow is solid (KYC, fees, AML), just used more often. |
| Branch can't be deployed mid-flight | Feature-flag the new behaviour: `UNIFIED_ADD_UNIT=1` env var. Old path remains code-present until flag is removed in Stage 4. |

Rollback = flip the env var off. No DB migration needed for the code change itself.

## Decisions to confirm before I write code

1. **Recommended A** — leave existing 188 deals untouched; sweep stale AVAs in Stage 6.
2. **Recommended yes** — feature-flag with `UNIFIED_ADD_UNIT=1` so we can ship to staging first.
3. **The shared dialog** — replace both `UnitFormDialog` (available-units.tsx) and `AddTenancyUnitForm` (PropertyTenancySchedule.tsx) with one new component. Old two stay as deprecated until Stage 4 (cleanup).
4. **Leasing Schedule add** — leave alone in Stage 3 (own decision when we onboard Landsec).

## Out of scope for Stage 3

- Filter/sort parity across boards (Workstream P, runs in parallel)
- Property_unit_id reconciliation UI for the 169 NULL tenancy rows (separate workstream)
- Engine-collapse (Stage 4), read-through joins (Stage 5), drop legacy status (Stage 6)

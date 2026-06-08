# Unit Status Cleanup — Migration Plan

Companion to `unit-status-architecture.svg` (current) and `unit-status-target-state.svg` (target).
Owner: Woody. Status: awaiting sign-off before any code changes.

## Decisions locked

- **Vocabulary** — seven names used verbatim in DB and UI:
  Available · Negotiating · Solicitors · Exchanged · Completed · Invoiced · Withdrawn.
- **Marketing model** — separate layer. Status answers "where is the deal?"; a marketing flag + reason answers "is this unit being marketed and why?".
- **Concurrent deals** — a remarketed Trading unit keeps its tenancy intact and a new letting deal rides its own journey alongside.
- **Sequencing** — plan-and-diagram first; staged additive migration; no big-bang.

## Target schema (delta only)

```
tenancy_schedule_units
  + occupancy           Vacant | Trading | Holding Over | Lease Event Pending | Archived
  + marketing_active    boolean
  + marketing_reason    Vacant | Lease Event | Tenant at Risk | Active Management
  - status              (dropped at Stage 4)

crm_deals
    status              Available | Negotiating | Solicitors | Exchanged
                        Completed | Invoiced | Withdrawn         (rename only)

available_units, leasing_schedule_units
    status fields retired in UI; rows still exist as filtered views during the staged rollout
```

## Stages

**Stage 1 — additive schema** (no behaviour change)
- Add the three new columns on `tenancy_schedule_units`.
- Backfill `occupancy` + `marketing_active` from existing `status` via the mapping below.
- Dual-write: writes to `status` continue; new columns updated alongside.

**Stage 2 — UI rename**
- All status pills and dropdowns adopt the seven names.
- `leasing_schedule_units.status` and `available_units.marketing_status` start displaying the canonical names; their values are translated at the edges.
- No DB changes.

**Stage 3 — engine collapse**
- Replace `server/unit-mirror.ts` inline status maps with the shared `shared/lease-status-mirror.ts`.
- Two mirror modules become one.
- Marketing-flag edits drive Tracker/Leasing visibility (replaces the coarse reverse-mirror).
- Dual-write retained for safety.

**Stage 4 — flip and delete**
- Bluewater consistency report run: every unit reconciled.
- Drop `tenancy_schedule_units.status`.
- Remove dual-write paths.
- This diagram becomes the ground truth.

## Backfill mapping (Stage 1)

Reading the existing `tenancy_schedule_units.status` value, populate:

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

`crm_deals.status` codes (AVA, NEG, SOL, EXC, COM, INV, WIT) become labelled with the seven names at the UI layer — no DB change to deal status values.

## Risks

- **Bluewater rows with unknown legacy values** — already a problem today (silent no-op bug). Stage 1 surfaces them as a log; nothing is auto-changed.
- **Two boards reading old `status` during transition** — mitigated by dual-write through Stages 1-3. Stage 4 only fires when the consistency report is clean.
- **Client property page exposing Leasing Schedule** — must land after Stage 2 (UI rename) so clients only ever see the seven friendly names.

## Cleanup candidates retired by this work

All five from the current-state diagram:

1. Tenancy "Add" never opens a deal → fixed by marketing-on auto-creating a deal.
2. Deal "Add" doesn't show on boards → no longer a problem; boards filter on marketing flag, not deal existence.
3. Reverse-mirror coarsens occupancy → mirror gone; occupancy on its own axis.
4. Unrecognised status no-op → one vocabulary, nothing to misrecognise.
5. Two mapping sources drift → collapsed to one.

# Deals, units and the Letting Tracker — thoughts before we change anything

*26 October 2026. Based on a full read of the code by six independent readers, a proposal that went through two rounds of adversarial critique, and the two decisions you gave me today. Nothing in this document is live; the work built this week is sitting uncommitted until you've chosen.*

## 1. The short version

- A "unit" is stored in **seven different tables**, and a letting's status lives in **five columns kept in step by two separate sync engines**. That is the root of the duplication, and of the doubling-up you're seeing.
- Your two rules are the right ones and can be made **true by construction** rather than by sweeping up afterwards: make the Letting Tracker a *view of letting deals* instead of a separate list that has to be kept in sync with the deals. One record per letting, from Marketing to Invoiced, with a Ref #, a fee and a fee split from day one. The tracker, the Deals board and the WIP all show the same record.
- The doubling-up happens because the Deals page lets someone create a "New Letting" deal without ever checking whether that unit is already on the tracker, and because ChatBGP and the WIP import create Negotiating deals that never get a tracker row. The fix is a unit search on the New Deal form (same as the tracker's), which **links** to the existing unit and its Ref # instead of creating a second deal.
- It's a staged job: six phases, each shippable and reversible on its own, roughly four to five weeks of work in total. The first two phases (measure; stop the data moving; one vocabulary; close the gap between deals and tracker, including the Deals-page search) give you most of the benefit.
- I need about eight decisions from you, listed in section 7. The most important: does "Marketing or Negotiation" mean exactly those two statuses, and is Lease Disposal a landlord-side instruction (it's treated as tenant-side in some places today)?

## 2. How it works today

**Seven places hold "a unit".** The unit master (physical facts), the tenancy schedule (the rent roll, or "spine"), the Letting Tracker row, the Leasing Schedule (the Landsec board, marked "retired" for staff but live for client logins), the deal itself, the evidence-plan units (comps maps) and the floor-plan outlines. The unit's name, size, floor, use class and EPC are copied into most of them. Renaming a unit cascades by hand through three of the copies and misses the rest, which is why some units end up linked by name-matching, and we have six different ways of normalising a unit name.

**Status is written in five places.** The deal's status (the 12 codes), a second "stage" column on the deal, the tracker's own marketing status, the tenancy schedule's free-text status, and the leasing schedule's status. Two sync engines try to keep them equal and disagree about what Solicitors means on the schedule. Some things write status directly and bypass both engines: the Xero sync (sets Invoiced), the kanban drag, Promote to Solicitors, the WIP import. Nine screens read the tracker's cached status with their own private lists of words. The public website reads the tracker's cached status, not the deal's.

**Five ways to create a tracker row, five ways to create a letting deal, and they don't all talk to each other.** Add Unit on the tracker is the only path that does everything (unit master, schedule link, leasing row, deal). The tenancy schedule's "mark vacant" fan-out, the Landsec tracker focus, a one-off migration that still runs on every deploy, and the boot loop each insert rows the heals then try to patch up by name. On the deal side: the New Deal form, ChatBGP's create_deal, the WIP import and the WIP report's status cell all create deals; only Add Unit links the deal to a tracker row. Hence Negotiating deals that are not on the tracker, and tracker units whose deal was made separately on the Deals page.

**What this week's work changed** (all uncommitted, waiting for you):
- Every tracker unit now gets its backing deal (Ref #) the moment it exists, through one shared routine used by every creation path; existing units without one get a deal a minute after the next deploy; a re-marketed unit gets a fresh deal rather than reviving the old one. Reviewed by three independent reviewers; ten findings fixed.
- Per your instruction this morning: Marketing deals count on the WIP with or without a fee (a fee-less one shows under Needs Attention as "no fee" so someone fills it in), the Deals board now runs from Marketing onwards instead of starting at Solicitors, and the kanban has a Marketing column. The New Deal form still sends new lettings to the tracker, which creates the deal.

## 3. Your rule, stated precisely

- **A "letting" deal** = deal type New Letting or Lease Disposal, as you named them. The code also treats Temp Lease and Licence as lettings; I'd keep those in. Not Lease Acquisition / Sub-Letting (we act for the tenant on someone else's unit), not Rent Review / Regear / Lease Renewal (advisory on an occupied unit), not Sale / Purchase.
- **Marketing = AVA, Negotiation = NEG** in the stored codes. The tracker and the website already treat HOTs and Solicitors as live too (Solicitors shows as "Under Offer" on bgp.uk.com). My recommendation: a letting deal at Marketing, Negotiating, HOTs or Solicitors is on the tracker; Exchanged, Completed, Withdrawn and Invoiced fold under the tracker's Historic pill. Your minimum (just AVA and NEG) also works.
- **Forward rule:** every letting deal in those statuses has exactly one tracker row, and that row *is* the deal.
- **Reverse rule:** every tracker row points at a letting deal, and its Ref # is the deal's Ref #. Re-marketing a let or withdrawn unit starts a new deal.
- **Fee rule:** the fee and the fee split live on the deal only. A Marketing deal is on the WIP from birth; no fee means "fee needed", not "not WIP". That gives you the leasing fee forecast you asked for.

## 4. The proposed end state

Three tables own facts; everything else reads through them:

1. **Unit master** — one row per physical space: name, address, floor, areas, use class, condition, EPC. Nothing else stores these.
2. **Tenancy schedule (the spine)** — one row per occupancy: tenant, lease dates, passing rent, ERV, quoting rent. It carries *occupancy only* (Vacant / Trading / Holding Over / Lease Event / Archived), never pipeline status.
3. **The deal** — the one record of a letting from Marketing to Invoiced: Ref #, type, which side we act for, status (the only pipeline status), fee, fee %, fee split, agreed rent, agents, parties, dates. Linked to the unit master and to the current occupancy.

The **Letting Tracker becomes a view of letting deals** with marketing collateral attached: the tracker row shrinks to website flag, lease terms, available date, photos, brochures, the per-unit Heads of Terms document, viewings and offers. It keeps its id, so the bgp.uk.com listing links don't change (the website reads the listing feed live, so feed changes need no website redeploy). "Add Unit" means "instruct BGP on this unit" (it creates the deal); removing a unit means withdrawing the deal. The Deals board already lists every deal from Marketing; the tracker lists the letting-type ones with their collateral. Same record on both, so your two rules need no sweeps, backfills or boot loops to stay true.

The **Leasing Schedule** (Landsec's board) becomes a lens over the spine and the live deal, keeping only what's genuinely theirs (zone, positioning, priority, targets, updates). The **evidence-plan units** stay a per-plan layer that snapshots from the spine, as they do now.

## 5. The plan, in phases

Each phase ships on its own and can be backed out. Efforts are working days of build plus a short soak each.

| Phase | What it does | Effort | Risk |
|---|---|---|---|
| **0 — Measure and freeze** | A read-only "letting integrity" report (units without a deal, letting deals without a tracker row and which door made them, stub-and-real pairs, deals on two rows, status disagreements). A data snapshot. Declare the hidden schema so drift is visible. Fix the docs that now say the opposite of today's decisions. | 1–2 days | None for users |
| **0b — Stop the data moving** | Delete the deploy-time loop that creates mis-named tracker rows from Negotiating deals; re-point the schedule's "Re-sync" button from firm-wide to this-property; freeze four overlapping admin repair buttons. | ½ day | Low |
| **1 — One vocabulary** | One shared definition of "letting type", "on the tracker", "historic", "WIP", "which side", used by every screen and ChatBGP; declare the stray "ARCH" status; stop the two writers that store legacy labels; one ChatBGP handler instead of two. | 2–3 days | Low–medium (two counts change visibly) |
| **2 — Close the gap and stop the doubling-up** | One tracker-row factory used by every creation path. Saving a letting deal (Deals page, ChatBGP, WIP import) ensures its tracker row. **The New Deal form gets the tracker's unit finder: if the unit is on the tracker it shows "Already on the tracker as #1234" and links to it rather than creating a second deal.** Dry-run backfill creating tracker rows for live letting deals that lack one; merge stub-and-real pairs; one-live-letting-per-unit rule enforced at the database. Nightly integrity report instead of boot repairs. | 4–5 days | Medium — you review the dry-run list first |
| **3 — One status writer** | Every status change (deal page, tracker, bulk change, kanban, Promote to Solicitors, Xero sync) goes through one gate with one audit trail and one hook that updates the schedules, phone shell and website. Occupancy on the tenancy schedule separated from pipeline status. | 5–6 days | Medium — behind a flag for a week, compared to the baseline |
| **4 — One home for physical facts and links** | Screens read name/size/EPC from the unit master only; retire the copied columns and the stale back-links after a release of dual-reading. | 3–4 days | Medium |
| **5 — The tracker becomes the deal view** | The tracker page is driven by the deal query; the tracker table shrinks to marketing data; the duplicate sync engine, heals, backfills and most admin repair buttons are deleted. | 6–8 days | Medium–high (tracker, phone, website, ChatBGP) — flagged and run side-by-side |
| **6 — Landsec board and evidence plans** | Decide whether the Leasing Schedule stays a client-owned table or becomes a lens; link its 900 unlinked rows; pick one target-brand store. | 3–5 days | Visible to Landsec — needs their sign-off |

**My recommendation:** do Phases 0–2 now (about two weeks). They remove the doubling-up, give every letting a Ref # and a fee home, put the WIP forecast on a sound footing, and give us the numbers to plan the rest. Phases 3–5 are the real cleanup and can follow once the first two have bedded in. Phase 6 waits for the Landsec decision.

## 6. What to retire

Roughly 25 items: the deploy-time migration loop, four one-off admin buttons (Sync Tracker → Leasing Schedule, Renumber Units, Rename Legacy Teams, the firm-wide Re-sync), one of the two sync engines and the three status maps that disagree, the raw status writes that bypass the gates, the duplicate ChatBGP handler block, dead routes and a dead table, the unused Add-Unit feature flag, and, at the end, the copied columns on the tracker row. The full list with file references is in the technical appendix.

## 7. Decisions I need from you

1. **Statuses on the tracker:** exactly Marketing and Negotiating, or also HOTs and Solicitors (my recommendation), with Exchanged onwards under Historic? Is Solicitors still "Under Offer" on the website?
2. **Letting types:** New Letting and Lease Disposal only, or also Temp Lease and Licence? Sub-Letting?
3. **Lease Disposal, which side?** The app currently treats it as a *tenant-side* instruction (the client is the outgoing tenant) on the WIP, KYC4U and the deal form, but you've put it alongside New Letting on the tracker, which is landlord-side. Which is it? And if we derive the side from the type, do you want to see the list of existing deals that would move before anything is changed? (It affects what Landsec sees in their instruction list.)
4. **The tracker becomes a view of letting deals** (section 4): yes or no? This is the structural change; everything else is tidying.
5. **Letting deals with no property or unit** (typed on the WIP report, by ChatBGP, or imported): refuse until a unit is picked, or show them on the tracker in an "Unplaced" group for someone to fix?
6. **Where is the fee split entered for a Marketing-stage unit:** only on the deal page, or also on the Add Unit form at creation? Pick one.
7. **Client-added units:** when a Landsec login adds a unit, should that create a BGP instruction (a deal with a Ref #) at all, or only a schedule row that BGP then instructs?
8. **The Leasing Schedule (Landsec board):** keep it as their own board, or make it a read-only lens over the tenancy schedule and live deals?
9. **Re-marketing a unit:** do the previous letting's viewings and offers stay visible on the new deal, or go with the historic one?
10. **Freeze now?** May I switch off the four admin repair buttons and the deploy-time loop straight away (Phase 0b), so the data stops moving while we work?

## 8. What I can't tell from the code

The counts: how many letting deals have no tracker row (and which door made them), how many tracker rows have no deal after the sweep, how many stub-and-real pairs, how many units sit on the tracker because the old deploy loop put them there, and whether the one-live-deal-per-unit index actually exists in the live database (no deploy path applies it). Phase 0's report answers all of these, so I'd like to build that first regardless of what else you decide.

## 9. What's sitting uncommitted, and what I'd do with it

Two pieces of work are in the working tree:

- **Every unit gets a deal reference** (reviewed, type-checks). Consistent with every direction above. I'd commit it now: it is Phase 2's first step and already removes the "no Ref #, no fees" problem.
- **Marketing deals on the WIP and the Deals board** (your instruction this morning). Also consistent. I'd commit it with the above, and update ChatBGP's app map to match.

Separately, the Brucey/Watch House perks are hidden in a commit waiting for your "push".

If you'd rather see the integrity report numbers before anything ships, say so and I'll build Phase 0 first and hold both.

---
*Technical appendix (full proposal with file and line references, the retire list and the critics' outstanding points) saved alongside this document as `letting-cleanup-technical-appendix.md`.*

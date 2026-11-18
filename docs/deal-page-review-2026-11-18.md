# Deal page review, 18 November 2026

Woody, 18 November 2026, on The Dulwich Bakery's deal page:

- "deal board doesn't have the Billing or contracting entities? Just has the
  landlord and tenant which links to brands? Can you consider the deal board
  generally too use the work we have done on landlord, brands and property to
  bring up to the same level as Landsec will see this? does it link to how we
  are saying the app works for Landsec? Needs a chat box too no and how the
  negotiations have evolved etc then the tasks list for the deal?
  Responsibility etc? Needs to really link up unless that's happening on
  another board somewhere?"
- "the tabs dont open or link in recent and deal move as example"
- "need full time line of deal tracking from marketing to completion.. needs a
  proper app review and thought"
- "and most importantly adding the billing entities so can AML. Also when
  doing that if the AML hasn't started need the ability to add in all the info
  so it can start such as email phone numbers etc how does that work?"

And earlier the same afternoon, on AML: "BGP internal AML check options to
run on the deal page and when add deal form. option to request KYC4U check
which is already built but we also need a button to upload the KYC4U check and
docs or does the sync with KYC4U do that? We then need a dashboard of all AML
/ KYC live and finished checks ... We have something somewhere already but it
was built ages ago and was hard to navigate."

Read from the code on 18 November 2026. Nothing was changed. Nothing here is
built until Woody approves.

## The short answer

The deal page is a record card: who the parties are, the fee, Xero, the AI
activity read and the AML box. Almost everything that happens to a letting
from marketing to completion is recorded, but on the **Letting Tracker unit**,
not the deal: the brief, viewings, offers and every negotiating position, the
Heads of Terms, the deal checklist with who is responsible, the
recommendation. The deal page shows none of it. The one screen that puts deal
and unit together is the **Landsec unit page** (`/landsec/unit/:id`), and the
deal clock (stage, days at stage, waiting on, NER) shows on the deal page only
in the Landsec view. So a Landsec login sees more of a letting than BGP's own
agents do on the deal page.

The billing (contracting) companies are set per party on the deal form, but
the deal page shows none of them, and AML runs on the brand, never on the
company that signs.

## What is there today

The page: `client/src/components/deal-detail.tsx` (1,561 lines), drawn by
`client/src/pages/deals.tsx` for `/deals/:id`. The phone uses the same page
with pills (Overview, Brand, KYC, Activity, Files).

| Section | Who sees it | What it reads |
|---|---|---|
| Header: name, status, property, counterparty, target date, tenancy schedule chip, "Back to Letting Tracker" (when the heading is a unit) | everyone | `GET /api/crm/deals/:id` |
| Deal clock (stage, days at stage, waiting on, NER, brief check, link to the Landsec unit page) | **Landsec view only**, Landsec schemes only | `GET /api/landsec/deals` |
| Team / dates strip (team, tenure, fee agreement, instructed, exchanged, completed, invoiced, last and next contact) | everyone | the deal row |
| Parties: BGP team, BGP acting for, landlord and tenant (or vendor and purchaser), one deal-level "Xero Contact" | everyone (clients read only) | the deal row; whole company, contact, property and user lists to look up names |
| Fee allocation | BGP staff | `/api/crm/deals/:id/fee-allocations` |
| Headline rent and terms | everyone | the deal row |
| Xero invoicing | BGP staff | `/api/xero/*` |
| Deal Activity (AI curated) | BGP staff | `/api/activity/deal/:id` |
| Emails, calls and meetings | everyone | `/api/activity-summary?dealId=` |
| KYC: the AML box per party, joint agency note | BGP staff | `/api/kyc/deal/:id/status` |
| Brand profiles (the older layout, collapsed) | not a joint agent | `/api/brand/:id/profile` |
| Right rail: Files (the property's folder), Linked property, Linked contacts, Comments, History (Timeline, Audit log) | Timeline is BGP staff only | `/api/deals/:id/timeline`, `/api/crm/deals/:id/audit-log` |

What the page does not show at all:

- **Billing companies per party.** The deal holds one per party
  (`landlord_entity_id` / `_name`, `tenant_…`, `vendor_…`, `purchaser_…`,
  Xero contact ids set on the deal form), but the page shows only the
  deal-level Xero contact ("Not set, add via Edit").
- **The company on the lease** from the tenancy schedule, which the unit feed
  the page already loads carries (name, Companies House number, its covenant
  state).
- **The party contacts** (`landlord_contact_id`, `tenant_contact_id`, …), the
  agent firms and the joint agent. "Linked contacts" ignores the party
  contacts.
- **The Ref #**, invoicing email and notes, the scheme, the solicitors.
- **Anything from the tracker unit**: offers and the negotiation log, the
  Heads of Terms, the deal checklist and who is responsible, the
  recommendation, the Targeting Brief, viewings. All keyed by the tracker unit
  (`available_units.id`); the dialogs that draw them already exist
  (`DealChecklistDialog`, `HotsWorkspaceDialog`, `RecommendationDialog`,
  `UnitBriefDialog`, `NegotiationPanel`). The page finds the tracker row only
  through the unit feed, which returns live deals only, so a completed deal
  loses its unit.
- **A conversation.** "Comments" is a text box appended to one field
  (`crm_deals.comments`): no tags, no people, no ChatBGP. The shared
  conversation exists only for properties (`server/record-conversation.ts`).
- **A task list.** Tasks can be linked to a deal (`user_tasks.linked_deal_id`,
  and the checklist's tasks are), but nothing lists a deal's tasks.
- **The stage moves.** The staff-only Timeline in the right rail covers deal
  dates, KYC approval, requirements, comps, invoices and interactions, but not
  stage moves, offers or the Heads of Terms. Stage moves are only in the Audit
  log.

The activity feed's pills ("the tabs dont open or link"):
`activity-summary.tsx`. "1 recent" and "1 deal move" are filters, so with one
item pressing them changes nothing, and a deal move opens a box whose only
links are "Open the deal" and "Deal": the page already open.

Also found: unused code in `deal-detail.tsx` (a SharePoint dialog nothing
opens, a fee editor, an agents save), whole tables downloaded to look up a few
names, and CLAUDE.md out of step with the code on what a joint agent sees on
the deal page (the code shows it Image Studio, Edit, Files, Comments and
History).

Two facts that shape the build:

- The unit's pieces are keyed by the tracker unit and always read the unit's
  **current** deal. None takes a deal id, and a deal on a unit that has since
  been re-marketed cannot reach its own checklist or recommendation through
  them (the rows are still there, under the old deal).
- Some of their reads **write**: opening the checklist creates it, opening an
  offer's negotiation writes its first round, and the Heads of Terms read can
  rewrite its agreed date. A deal page must read through summaries that change
  nothing (`/api/deal-checklists/summary`, `/api/unit-recommendations/summary`,
  `/api/unit-offers/unit/:unitId/summary`) and open the existing dialogs only
  when a person asks.

## The proposal: one deal page, built like the landlord and brand pages

The same frame the landlord, agent and lender pages use (`CompanyKindPage`:
one section at a time, kept in `?section=`), and the same page for every
login, cut on the server as today (a client never sees the fee or BGP's AML
working; a joint agent sees its own schemes, no brand pages).

**Header line.** Name and Ref #, the stage chip, days at stage (the one rule,
`resolveStageSince`), what it is waiting on and since when, the target date,
the property and unit, "On the Letting Tracker". Actions: Edit and one More
menu (Image Studio, Document, Delete).

**The stage strip, the page's spine** (Woody: "full time line of deal tracking
from marketing to completion"): Marketing → Negotiating → HOTs → Solicitors →
Exchanged → Completed → Invoiced, with the date each was reached, the days spent
in it and who moved it, read from `deal_audit_log` and the deal's dates
(instructed, exchanged, completed, invoiced). The stage it is at is lit and the
target date sits against the next. An investment deal starts at Solicitors, as
Jack's rule has it.

**Summary card.** The unit and size, headline rent, NER, term, break and rent
free, the fee and split for BGP staff, each party in one line (brand →
contracting company → who to ask → AML state).

**Conversation line** (Woody: "Needs a chat box too"). Recommended: **the
property's shared conversation, cut to the deal**: the deal page shows the
messages tagged with the deal or its unit, and a message written there is
tagged with both. One thread per building, so the Letting Tracker comments,
the property page and the deal page read the same thing, with the rules
already written for clients and joint agents. (The other way, a conversation
of its own per deal, is a third place to look.) The old Comments box becomes
a read-only "earlier notes" line.

**The pills:**

1. **Overview**: the summary, the next things owed (open checklist items,
   AML not started), the activity feed.
2. **Timeline**: every event in date order, each opening its own detail:
   instructed, brief agreed, viewings, each offer and counter, Heads of Terms
   issued and signed, AML started and cleared for each party, checklist items
   ticked, exchange, completion, invoices. A deal move is a line here, not an
   activity item that links back to the page you are on, and the activity
   pills show only when there are two or more kinds to filter.
3. **Negotiation**: the offers and every position (the negotiation log), the
   Heads of Terms stage with Open Heads of Terms, the recommendation, the
   Targeting Brief.
4. **Checklist & tasks** (Woody: "the tasks list for the deal? Responsibility"):
   the deal checklist by stage, who is responsible for each item and for the
   letting, what it is waiting on, Make responsible; and every other task
   linked to the deal (`user_tasks.linked_deal_id`), which nothing lists today.
5. **Parties & AML**: each party's brand, contracting company, Xero billing
   contact, who to ask and the AML box (next section); the joint agency note.
6. **Fees & invoicing** (BGP staff): the fee allocation, Xero invoicing, PO and
   invoicing email.
7. **Files**: the unit's files (brochures, plans, the final Heads of Terms), the
   property folder, each party's KYC documents for BGP staff.
8. **History**: the audit log.

New reads, each keyed by the deal and writing nothing: the deal's letting
(its tracker unit, found from `available_units.deal_id` or the deal's tenancy
row so a completed deal keeps it; the checklist, offers, Heads of Terms,
recommendation and brief summaries; for an older deal on a re-marketed unit,
its own rows), the deal's tasks, and the timeline. Actions open the dialogs
that exist, given the deal's tracker unit, as the Landsec unit page does.

**The deal clock for every letting** (Woody: "bring up to the same level as
Landsec"): days at stage, waiting on and depends on are Landsec-only today.
The waiting-on is already worked out from the checklist for any deal; setting
it by hand, and the clock columns on the Deals list, would open to every
letting.

## The contracting company, and AML on it (Woody: "most importantly adding the billing entities so can AML")

### What the app holds today

- A deal's parties are CRM companies: `landlord_id`, `tenant_id`, `vendor_id`,
  `purchaser_id`. For a tenant that is the brand (The Dulwich Bakery), not the
  company that signs the lease.
- The company that signs is a `crm_trading_entities` row under the brand
  (name, Companies House number, VAT number, a default flag). The deal form's
  Billing entity box (BGP staff) creates one from Companies House and makes it
  a Xero contact.
- The deal stores only each party's **Xero contact**: `landlord_entity_id` /
  `_name`, `tenant_entity_id` / `_name`, `vendor_…`, `purchaser_…` are Xero
  ContactIDs, not links to the trading entity. The deal page shows one
  "Xero Contact: Not set, add via Edit" and nothing per party.
- The tenancy schedule has its own "company on the lease"
  (`tenancy_schedule_units.tenant_entity_id`, a trading entity), which the deal
  never reads.
- **AML runs on the brand.** Checks before asking, the client checks and the
  KYC4U request all take the deal's party company, and approval is the brand's
  `crm_companies.kyc_status`. The trading entity carries KYC columns
  (`kyc_status`, `kyc_expires_at`, `kyc_approved_at` / `_by`,
  `aml_risk_level`, `sanctions_screen`, `last_checked_at`) that nothing reads or
  writes ("KYC happens at the brand level", schema comment).
- So a brand that trades through several companies (franchisees, an SPV per
  site) is approved once for all of them, and a brand with no Companies House
  record ("The Dulwich Bakery: Not on Companies House, manual KYC needed")
  cannot be read even when the company on its lease can.

### Proposal

One line per party on the deal, in this order: **brand → contracting company →
who to ask → AML**.

1. **Contracting company.** Pick one of the brand's companies or find it at
   Companies House (the billing entity flow that exists); the brand's default
   is offered first, and for a letting the tenancy schedule's company on the
   lease. It shows its Companies House number, registered office and status,
   and its Xero billing contact (made from it, as today).
2. **Who to ask.** The person the client checks and KYC4U go to: pick a
   contact filed under the brand or the company, or add one in place (name,
   job title, email, mobile). It is saved to the CRM, so it is there next time
   and on the KYC4U request. Today "Someone else" in the client checks dialog
   is typed and thrown away.
3. **AML on the contracting company.** Checks before asking read Companies
   House by its number; the client checks and the KYC4U request name it;
   approval is recorded on it, with the brand kept as the answer for a party
   that has no company set (every deal before this change). The deal clears
   when each party's company is approved.
4. **"Ready to start" checklist.** While AML has not started, the box lists
   what is missing and lets you fill it there: no contracting company → "Add
   the company that signs"; no one to ask → "Add who to ask (email, mobile)";
   no registered office → read from Companies House; an individual → date of
   birth and home address go in the client checks, not here. When nothing is
   missing, Start shows the three routes: BGP checks (already running),
   Send client checks, Request KYC4U check.

Schema (additive, nullable; waits on Woody per CLAUDE.md): on `crm_deals` a
link to the trading entity per party (`landlord_trading_entity_id`,
`tenant_trading_entity_id`, `vendor_trading_entity_id`,
`purchaser_trading_entity_id`), and `trading_entity_id` on `kyc_documents`,
`kyc_investigations`, `kyc_upload_tokens`, `kyc4u_requests` and
`kyc_audit_log`, so every AML record says which company it is about. The
entity's own KYC columns hold its approval.

### The AML box, the outcome, and KYC4U's results

- **The box** is the same on the deal page and in New Deal's Kick off AML step
  (which today offers one button per party): BGP checks (Companies House,
  sanctions lists, ComplyAdvantage once Mesh has a screening configuration,
  the web search for PEPs and adverse media; it runs by itself), Send client
  checks, then the outcome.
- **The outcome.** A routine party (no red flag) gets **BGP sign-off** once its
  checks are done: recorded on the contracting company with who signed and
  when, valid for the re-check period (six months today), and audited. A party
  with a red flag goes to KYC4U (Request KYC4U check, built), then **Add KYC4U
  result**: upload KYC4U's report and documents, pick Approved, Rejected or More
  information needed, and it is recorded as KYC4U's verdict is today.
- **Does the KYC4U sync do it?** Statuses only, and not on its own:
  - KYC4U's statuses come in when someone clicks the **Send to ChatBGP**
    bookmark on KYC4U's request page, or uploads their export (KYC4U page).
    The last time was **6 October 2026** (435 requests, 142 matched to
    companies), so statuses on the app are six weeks old.
  - The automatic sync (signing in to KYC4U's SharePoint every six hours) is in
    the server but is not connected and has no button.
  - KYC4U's documents (about 9,900 files in their SharePoint) are never copied:
    the app counts the files in each request's folder and links to it.
  - So Add KYC4U result is the dependable way in. Copying KYC4U's documents
    automatically needs that SharePoint sign-in to work, which is worth one
    try, because BGP should hold its own copy of what it relies on for the five
    years the records must be kept.

### The AML dashboard (Woody: "a dashboard of all AML / KYC live and finished checks ... nice and easy")

One page with pills **To do**, **In progress**, **Done**, **Expiring**, and
the KYC4U grid for admins. One row per deal party: the party and its
contracting company, the deal, a stage chip (Not started → BGP checked → Client
checks sent → Client finished → With KYC4U → Approved / Rejected → Expiring),
any red flag, who or what it is waiting on, the days since anything moved,
and the deal's agents. Mine / All and a search. A row opens the party's whole
trail (BGP checks, the client check requests and their files, KYC4U requests
and results, documents, the audit log) with the box's buttons. A party is To
do when HMRC expects its checks (`KYC_TIMING`): a landlord on any live deal, a
tenant or buyer from HOTs. One rule for the stage, used by the box and the
dashboard alike, read from the records the app already holds. The old
Compliance Board, Investigator and Training screens were removed when in-app
AML was retired in October; the KYC4U page is all that is left of them.

## Order of work

Each step ships on its own.

1. **Contracting company and who to ask, per party** (Woody: "most
   importantly"). On the deal page and the deal form: pick or create each
   party's contracting company (the brand's companies, Companies House, the
   company on the lease), its Xero billing contact made from it, and who to
   ask (pick or add, name, email, mobile, saved to the CRM). The AML box reads
   them: checks before asking use the company's Companies House number, the
   client checks go to the saved person, the KYC4U request is filled from both.
   "Ready to start" lists what is missing and fills it in place.
   **Built on 18 November 2026** (Woody: "go"): see "The company that signs
   and who to ask" in CLAUDE.md.
2. **AML on the contracting company**: approval on the company, BGP sign-off,
   Add KYC4U result, the same box in Kick off AML. The client checks change
   built on 18 November (`fd140668`, not yet live) goes out with this or before.
   **Built on 18 November 2026** (Woody: "Ok go ahead with your suggestions I
   will do the requests"), with KYC4U's Connect button and its approval link
   for KYC4U's IT admin back, and KYC4U's documents copied by the sync: see
   "Approval on the company that signs, BGP sign-off, KYC4U results" in
   CLAUDE.md. Woody's to do: send KYC4U's IT admin the approval link (My BGP →
   KYC4U pill), then press Connect KYC4U.
3. **The timeline and the clock**: the stage strip and the events, days at
   stage and waiting on for every letting, the activity pills fixed.
4. **Negotiation, checklist and tasks on the deal**: the deal-keyed reads,
   the pills, the existing dialogs, the deal's tasks.
5. **The conversation**: the property's thread cut to the deal.
6. **The AML dashboard.**
7. **The page shape and the tidy**: the pills and summary card in the landlord
   page's frame, files, the phone pills, the unused code and whole-table
   downloads removed, CLAUDE.md put right on what a joint agent sees.

## Decisions for Woody

My defaults, used unless Woody says otherwise, except the first, which needs
his yes because it changes the database:

1. **AML on the contracting company**, which adds columns: on `crm_deals` a
   link to each party's company (`landlord_trading_entity_id`,
   `tenant_trading_entity_id`, `vendor_trading_entity_id`,
   `purchaser_trading_entity_id`), and `trading_entity_id` on the AML records
   (`kyc_documents`, `kyc_investigations`, `kyc_upload_tokens`,
   `kyc4u_requests`, `kyc_audit_log`). Additive and nullable; old deals keep
   working on the brand.
2. **Who presses BGP sign-off**: admins (the directors' list). Alternatives:
   any BGP staff on the deal, or always KYC4U.
3. **The conversation**: the property's thread cut to the deal.
4. **The clock for every letting**, waiting on settable by BGP staff on any
   letting.
5. **The dashboard's place**: a pill on Deals, beside the deal list and the
   Letting Tracker.

This review covers the deal parts of `docs/consistency-review-2026-11-14.md`
(sections 2, 4, 5, 6 and 8), which were never approved.

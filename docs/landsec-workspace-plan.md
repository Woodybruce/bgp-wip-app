# Landsec workspace — build plan (agreed with Woody, 11 Nov 2026)

Woody said "OK lets build" on this plan. Build in the order below. Convert-on-touch and all rules in CLAUDE.md still apply.

## Why

Landsec's Hospitality & Leisure leasing instruction is out to tender (RFP 28 Oct 2026). Pitches are the weeks of 23 and 30 November 2026 at 80 Victoria Street; the deck goes in 24 hours before; contract starts 1 Jan 2027. BGP is pitching to be the single lead agent across 14 schemes and wants to present this app as how Landsec's leasing team, asset managers (AMs) and joint agents work day to day. The principal complaints are speed and organisation: deals stall because people are convinced late, and leasing and AM teams are now both empowered.

The 14 schemes: Bluewater; Westgate Oxford; St David's & Queens Arcade Cardiff; Liverpool ONE; Trinity Leeds; White Rose Leeds; Buchanan Galleries Glasgow; Gunwharf Quays; Clarks Village; Braintree Village; One New Change; New Street Square; Lucent; Victoria. Groups: North (Liverpool ONE, Trinity, White Rose, Buchanan), South (Bluewater, Westgate, St David's), Outlets (Gunwharf, Clarks, Braintree), Workplace London (ONC, NSS, Lucent, Victoria). Categories: Restaurants & Bars; Café, Grab & Go and QSR; Food Halls; Competitive Socialising; Active Leisure; Gyms, Wellness & Softplay — plus ALL retail in the four London schemes. Landsec measures and pays on Net Effective Rent (annualised rent less the effective annual cost of incentives over the MINIMUM lease term): 10% of NER sole agent, 7.5% joint.

Contract points that bind the build: confidential information must not go into any AI system "unless such system is operated solely within your own secure environment" and not used to train third-party models; no further processors without consent; heads of terms only if approved in writing by Landsec; audit right; return or delete data at termination.

## The product in one line

One page per unit that everyone on the scheme shares, with an agreed brief at the front, a clock on every deal, and AI doing the paperwork.

## Build before the pitch (in this order)

1. **Landsec home.** The 14 schemes only, grouped North / South / Outlets / London. Hide the 51 out-of-scope Landsec properties from this view. Merge or hide duplicates (second Liverpool ONE record; Victoria split over Cardinal Place, 123 Victoria Street and three stray records; Queens Arcade sits inside St David's). Fix the analytics that return zero (`server/routes.ts` ~10170 matches deal group name "Landsec"; deals are labelled "Land Sec" or nothing). Menu for Landsec people: Portfolio, Scheme, Lettings, Brands, Ask. Add the missing categories (Food Halls, Competitive Socialising, Active Leisure, Softplay) and all-retail for the four London schemes (`shared/tenant-categories.ts` CLIENT_CRM_CATEGORIES ~60-69).
2. **One unit page.** Victoria Broadhead's list in one place: available or potentially available; ERV / target rent; incentives; target tenants; plans; sq ft for both levels; marketing details; leasing plan; heads of terms; who to report to; who checks heads; solicitors' details; catch-ups with solicitors; progress once in solicitors. Nearly all exists across the tracker (`client/src/pages/available-units.tsx`), tenancy schedule, property page and deal page; solicitor fields are on deals (`shared/schema.ts` ~1042-1049). Bring them together; do not create a new store for facts that already have one.
3. **Agreed brief, two signatures.** Per unit: use and category, NER floor, incentive ceiling, capex envelope, target brands, "do nothing" comparison. Signed by the Landsec leasing manager AND the asset manager before marketing. Builds on the existing unit brief (unit_briefs / unit_target_operators, AI draft exists). Record who agreed and when.
4. **Deal clock.** Each deal: stage, days at stage (statusChangedAt exists), who it is waiting on (named person or party), and any deal it depends on. Offers checked against the brief and shown on NER using Landsec's definition (term to first break — `server/comp-devalue.ts` already does this; `server/crm.ts` ~3653 uses the full lease and should follow). Portfolio view of where deals are stuck.
5. **Brand case.** Jersey Mike's is the showpiece (AMs doubt the brand on its US reputation and website; the UK launch is strong). One case per rollout brand: UK store photos / video, fit-out, queues, trading evidence, UK operator and backers, covenant grade, proposed Landsec units. Each AM records: seen / supportive / concerns / wants a store visit. Leasing lead sees who is on board across the portfolio. Builds on the brand profile and Brand Pack PDF.
6. **Logins by role and scheme.** Roles: Landsec leasing manager (all schemes), asset manager (their schemes), joint agent (their schemes), BGP (everything). **Build as a new, separate front door**: these roles see only the new workspace pages, served by a small set of new routes that check the person's scheme list — default-deny everything else. Do NOT retrofit scheme checks into the existing client view (about 72 server files call the scope helpers). Reference pattern: Pave's operator jail (`pave-platform/server/operator-scope.ts`, `operatorApiAllowed`) — copy the idea, not the code. Existing gateway for today's client logins: `server/index.ts` ~4496-4880; scope helpers `server/company-scope.ts`; client guard `client/src/App.tsx` ~274-292. Starting map of who belongs to which scheme: last year's deck (see below).
7. **AI lock-down.** For Landsec data, one provider only (Anthropic) and the provider switch must not be able to route it elsewhere (`server/utils/ai-provider.ts` ~12-56; `server/chatbgp.ts` ~1153, ~1308; `server/utils/anthropic-client.ts` ~155, ~174). Produce a one-page list of outside services that touch Landsec data, for the pitch.

### Decisions Woody accepted as defaults (he said go without changing them)

1. Joint agents see units, deals and files on their schemes only — NOT BGP's brand contacts, email history or fees.
2. Asset managers see brand pages and the brand case across the portfolio, but deals and figures only on their schemes.
3. Demo schemes: Gunwharf Quays and Bluewater, plus the Liverpool ONE Jersey Mike's unit.
4. AI reads final heads of terms to fill deal terms, on Anthropic only.
Woody also said leasing managers see everything.

### Data to fill alongside the build (for the demo)

- Landsec's leasing tracker, the London tenancy file, the Liverpool ONE occupancy-cost file, final heads of terms, plans for One New Change and New Street Square (paths in the sources section below).
- Enter the three Jersey Mike's lettings by hand with Woody: Bluewater former Burger King unit (L057), Liverpool ONE former Byron unit (P22), the middle QSR unit at Gunwharf Quays.
- Clear the 452 junk pending offer rows (14 Aug backfill). Confirm with Woody before deleting anything.
- The app's email log stops at 24 Oct 2026 — find out why the sync stalled and restart it.
- Bug: property project files error on every property ("relation property_files does not exist").

## After the pitch (show as roadmap)

Heads of terms approval in the platform and a recommendation note / approval paper written from the deal record (needs Landsec's template — ask the team for the "Club de Padel Recommendation Note - Cardiff" and "Fee approval - Sushi Tachi" emails); keep full emails so offers file themselves (subject style "OFFER: Brand (unit)"); turnover per tenant from the monthly packs; AI mock-ups of a brand in a unit; show where Amplify differs from the agreed figure; audit log of client access and per-client data export / delete; finish the lettings cleanup (Leasing Schedule as a lens — Phases 3-6 in `docs/letting-cleanup-thoughts.md`).

## Checking the live app

A read-only test login is in the environment as `BGP_QA_TOKEN` (see CLAUDE.md "Checking pages on prod"). Live app: https://chatbgp.app . It acts as Woody: read only, no paid refreshes, send nothing.


## Process problems (from Woody and the SharePoint review, 11 Nov 2026)

1. **Nobody has agreed who decides each step.** The nine-step "Ways of Working" table in `Land Sec x BGP - 02.02.26.docx` has blank Asset manager / Leasing manager boxes. Leasing and AM teams are now both empowered.
2. **Approvals come after the deal is negotiated.** Approval paper, CAPR, TCE, capex and board approval all follow agreed heads; deals wait there (Clarks Costa, Pho Trinity, Bluewater).
3. **No set-up brief and no approval form** exist in the client folder. Landsec needs help with both.
4. **Tracking is spread over at least seven spreadsheets**, none with a status column, with the same lines copied between them. No view of stage, days at stage, or who a deal is waiting on.
5. **Asset managers don't see BGP's work** because it isn't uploaded to Amplify, Landsec's system of record.
6. **Speed and organisation** are the principal complaint: deals get stuck because some people aren't convinced or on board.

7. **Brand buy-in across all asset managers for portfolio rollouts (added 11 Nov, Jersey Mike's).**
   - Jersey Mike's want many Landsec sites. To deliver, every AM needs to have seen the brand.
   - AMs have quality concerns from the brand's US reputation (low value), a brash website, and comparison with Subway.
   - The UK launch is much better: product quality, fit-out, large queues. That evidence hasn't reached the AMs.
   - Idea to test (not built): one "brand case" per rollout brand — UK store photos and video, fit-out, queues, trading evidence, UK operator and backers, covenant, proposed Landsec units — sent to every AM, who each record seen / supportive / concerns / wants a store visit. Leasing lead sees who is on board across the portfolio. Aim: one portfolio-level yes to the brand, so site deals only argue terms.

   - Jersey Mike's deals already agreed by Woody: the Burger King unit at Bluewater, the Byron unit at Liverpool ONE, the middle QSR unit at Gunwharf Quays.

## From the BGP team (WhatsApp, 11 Nov 2026)

8. **No streamlined unit record from start to finish (Victoria Broadhead).** For each unit the team needs, in one place: available or potentially available; ERV / target rent; incentives; target tenants; plans; sq ft for both levels; marketing details; leasing plan; heads of terms; who to report to; who checks heads; solicitors' details; catch-ups with solicitors; progress once in solicitors. (Her message was cut off at "Read more" — the rest is still to come.)
9. **Tenant turnover and performance figures (Emily Cann, London).** These are given out in the monthly meetings and need to be on the app.
10. **No updates from Landsec's retail team (Victoria).**
11. **No access to retail unit details (Alex Todd).** At Bluewater several retail units are being targeted for coffee; the team has to chase Landsec to confirm details, which adds delay.
12. **AI mock-ups are useful (Victoria)** — showing a brand in a unit.
13. **No single source of truth for occupancy costs, ERVs etc. (Emily Atkin).** Amplify is often very different from the truth. (This changes the earlier idea of simply feeding Amplify: the platform needs to hold the agreed figure and show where Amplify differs.)
14. **Leasing manager and asset manager disagree on target uses / categories for a unit (Emily Atkin).** BGP gets sent down the wrong leasing trail and everyone wastes time. (Same root as problems 1 and 2: agree the brief, including use and category, before marketing.)

Woody has also asked the team to ask Landsec people directly: biggest frustration, blockers, things they hate, most time-consuming tasks.

## From last year's deck (`LandSec x BGP - 2026 Strategy.pptx`, BGP Archive / Marketing / Presentations & Pitches / Landsec 2026 Strategy)

BGP's own stated weaknesses then: diary management (viewings came first); speed of offers; relationship with asset managers; reporting style (ad hoc advice rather than clear recommendations and commentary).

Promises made then, which the pitch should show as delivered through the platform:
- One over-riding tracker for all assets, updated weekly, sent to AM and leasing before each leasing meeting, "to be incorporated into Amplify if possible".
- Offers presented to leasing AND asset team within 24 hours of receipt.
- One-page advice doc and devaluation approach, shared and approved by leasing and asset teams.
- Legal call updates for each asset.
- Enhanced use of Amplify from conversations and viewings through to completion.
- 6-monthly 360 reviews; one director at each leasing meeting.

The deck also names, per scheme, the Landsec asset managers, the Landsec leasing team, the BGP team and the joint agent (CBRE on most; Starka at Liverpool ONE; Culverwell at Buchanan Galleries). That is a ready-made starting map for per-scheme access.

## Live data check (read-only, 11 Nov 2026)

- All 14 schemes have a record: 1,131 units. Passing rent on 55% of units, ERV 60%, lease expiry 51%. Liverpool ONE has rent on 7% of units, Lucent 3%.
- 129 live tracker rows (85 Marketing, 18 Negotiating, 8 HOTs, 18 Solicitors); 109 live letting deals.
- Deals: rent on 53%, tenant on 20%, fee on 19%. Rent-free, capital contribution, net effective rent and solicitor firm / contact / instructed date are empty on EVERY deal, including all 16 at Solicitors.
- Viewings recorded on 3 units, offers on 2 live units. 446 offer rows sit on 4 units, created 14 Aug (looks like import duplicates).
- Tracker: quoting rent 46%, brief with target brands 44% (none at Trinity), lease terms 2%. 19 rows have no deal.
- Plans: 9 plan images across 4 schemes, no unit outlines. One New Change, New Street Square, Buchanan Galleries have no files at all.
- Turnover: 2,623 rows, none tied to a property; mostly AI estimates.
- `/api/portfolio/landsec/analytics` returns zero for everything (it looks for deal group "Landsec"; deals are labelled "Land Sec" or nothing).
- Leasing schedule (1,115 rows) and tenancy schedule (1,131 rows) disagree per scheme (St David's 202 vs 110; Liverpool ONE 80 vs 172).
- Duplicates / gaps: second Liverpool ONE record; Queens Arcade only inside St David's; Victoria split over Cardinal Place and 123 Victoria Street plus three stray Victoria records.
- 51 out-of-scope Landsec properties with 1,332 units are in the app (West India Quay 256, Brighton Marina 174, Southside 95, Lewisham 79...).
- Jersey Mike's: brand record exists but empty; none of the three lettings is in the app. Bluewater Burger King unit (L057) shows Marketing with Shake Shack as target; Liverpool ONE Byron unit (P22) shows Vacant; nothing at Gunwharf.
- Logins: 3 Landsec client logins (one on a BGP email address); 42 BGP staff.
- Bug: property project files endpoint returns an error on every property ("relation property_files does not exist").
- Best demo scheme: Gunwharf Quays (fullest tenancy data, 30 live tracker rows across all stages, 27 live deals). Bluewater is the only one with plans and brochures.
- Longest-stuck deals: Bluewater Shake Shack (Negotiating, 189 days); Cardinal Place (Solicitors, 118 days). Many dates were reset by the October cleanup, so real ages are longer.

## Sources that could fill the app (file share and email check, 11 Nov 2026)

Working folder: `BGP - Share Drive/National/National/Landsec` (national), `BGP - Share Drive/London/Landsec (London)` (London).

Best to bring in first:
1. `Leasing Tracker Landsec MW May 2026.xlsx` (BGP Archive/Chat BGP) — Landsec's own: per tenant expiry, breaks, sales per sq ft, like-for-like %, occupancy cost %, targets, meeting updates, for 10 schemes. Stale (May).
2. `Central_London_Executive_Tenancy_Views_No_MAT_With_Lucent_and_ONC_Voids.xlsx` (London folder, 16 Oct 2026) — only source for Lucent, One New Change, New Street Square rents and expiries; one row per unit. Easy.
3. Final heads of terms (~190 national Word files, 42 numbered headings: rent, turnover %, rent commencement, capital contribution, landlord's solicitors, Landsec contact, asset manager, brand manager). Many are drafts of one deal; London uses a different template.
4. `Liverpool One/Occ Costs and TS - June 2025 - Updated.xlsx` (not opened) — the app is nearly blank on Liverpool ONE rents.
5. Plans for One New Change and New Street Square (unit plans dump and London folder).
Also: 7 "Target Rent" spreadsheets (stale, Bluewater April 2023); 24 monthly "Retail Trading - Agent Pack" PDFs (per asset: like-for-like sales, top/bottom five retailers, footfall — NOT per-unit sales); fee agreement (June 2022 letter: minimum 10% of net effective rent, renewals 7%).

Email (what the app holds from the team's mailboxes):
- 5,818 Landsec emails in the last three months of the log, 1,137 threads, 29 BGP mailboxes, 174 Landsec people, 416 diary events. None linked to a deal or unit; the app keeps only the subject and a 255-character preview, no body or attachments.
- Offers: ~132 threads with a consistent subject style ("OFFER: Brand (unit)"). Heads of terms: ~87 threads. Solicitors: ~95 threads; recurring firms CMS, Eversheds Sutherland, Walker Morris.
- The app's own offer detector holds 452 pending rows on five units (443 from a 14 Aug backfill, half naming Landsec as the offering party) — junk to clean. Shopping-centre offers are essentially undetected.
- The app's email log stops at 24 Oct 2026 — the email sync looks stalled. Check before any demo.
- Landsec sends: monthly "Agents Pack / Agent Trading Pack" PDF; target-rent emails (Clarks 13 Oct, Bluewater 16 Oct); "LS Leasing 2.0" (15 Jun); "Landsec Hospitality: Portfolio Priorities" (16 Jul); "Updated Bluewater HOTs template - F&B" (23 Oct); "Closed Lost" system notices. Since 1 Oct heads of terms also sit on Landsec's new leasing SharePoint.
- Nearest things to an approval form: "Club de Padel Recommendation Note - Cardiff" (21–22 Oct) and "Fee approval - Sushi Tachi" (9–15 Oct). Ask the team for these.
- Meetings: monthly leasing meeting per scheme (9–13 Landsec, 4–7 BGP people), fortnightly Liverpool ONE F&B catch-up, weekly Workplace check-in. Notes go by email.
- Waiting examples: Sushidog Bluewater heads — second Landsec reviewer replied after 6 days and two chasers, still open a month later; Costa Braintree — 35 days for Landsec's heads to come back, then 15+ days unanswered; Oval Works plans — 23 days and three chasers.
- Jersey Mike's: only early threads (Liverpool Lord Street requirement; Westgate L40 at £90,000 pa quoting; Bluewater U062 marked Closed Lost 17 Jul). Nothing anywhere on the three lettings Woody agreed — they need entering by hand.

Not found anywhere: approval paper template, set-up briefs, budgets, per-unit monthly sales, solicitor instruction dates, any Amplify export. Buchanan Galleries has almost nothing in the share.
Mess: at least five copies of the national folder tree; duplicate heads-of-terms folders; unit codes differ between sources.

## App and contract issues (from the earlier review)

- AI clause in the contract; lock the AI provider and list outside services.
- Access is all-or-nothing; need per-scheme access and roles for AMs and joint agents.
- Net Effective Rent: app calculates over full lease, fees on headline rent.
- No heads of terms approval step.
- No list of the 14 schemes; missing categories; London schemes need all retail.
- No audit log or per-client data export/delete.
- Unit status on seven screens; 26 menu areas for a Landsec login; 13-board dashboard keyed to the name "Landsec".
- Pitch deck `Landsec Dec 2026.pptx` still has Hammerson text and no process map or Amplify mention.

## Still needed from Landsec

- Their approval paper template and approval levels.
- Whether Amplify accepts uploads.

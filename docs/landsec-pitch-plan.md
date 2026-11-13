# Landsec pitch: build plan and problem list

Agreed with Woody on 11 November 2026 ("OK lets build"). Pitches are the weeks of 23 and 30 November 2026; the deck goes to Landsec 24 hours before. Contract start 1 January 2027.

Source documents: the RFP pack (Request for Proposal, H+L Agent Pitch Brief, Pitch Agenda, draft Brand Letting Agent Appointment September 2026), the Landsec folders in SharePoint, last year's deck, the team's WhatsApp list of problems, and a read-only check of the live app's Landsec data. The findings are in the second half of this file.

## The product in one line

One Landsec workspace: a single page per unit that everyone on the scheme shares, with an agreed brief at the front, a clock on every deal, and AI doing the paperwork.

## Build before the pitch, in this order

1. **Landsec home.** The 14 schemes only, grouped North, South, Outlets and London. Hide out-of-scope properties, merge duplicates (second Liverpool ONE record; Victoria's five records; Queens Arcade inside St David's), fix the analytics that return zero (they look for deal group "Landsec"; deals say "Land Sec" or nothing). Cut the Landsec menu to Portfolio, Scheme, Lettings, Brands and Ask.
2. **One unit page.** Everything on Victoria's list in one place: availability, ERV and target rent, incentives, target brands, plans, square footage by level, marketing details, leasing plan, heads of terms, who to report to, who checks heads, solicitors' details, legal progress. Most fields exist already across the tracker, tenancy schedule, property page and deal page (solicitor fields are on crm_deals).
3. **Agreed brief with two signatures.** Use and category, net effective rent floor, incentive ceiling, capex envelope and target brands, signed by the Landsec leasing manager and the asset manager before marketing starts. Builds on the existing unit brief.
4. **Deal clock.** Each deal shows its stage, days at that stage, who it is waiting on, and any deal it depends on. Offers are checked against the brief and shown on Net Effective Rent as Landsec defines it (incentives spread over the minimum term to first break, not the full lease; `server/comp-devalue.ts` already uses the term to earliest break). A portfolio view shows where deals are stuck and with whom.
5. **Brand case.** Jersey Mike's as the showpiece: UK store photos, covenant, proposed units, and each asset manager's response (seen / supportive / concerns / wants a store visit). Builds on the brand page and Brand Pack.
6. **Logins by role and scheme.** Leasing managers see all 14 schemes; asset managers and joint agents see their schemes only.
7. **AI lock-down.** One AI provider for Landsec data (Anthropic), the provider switch disabled for it, and a one-page list of outside services that touch Landsec data, for the pitch.

Alongside: fill the data for the demo (sources listed below), enter the three Jersey Mike's lettings by hand (corrected 12 Nov 2026: they are early targets, not lettings; record them as Wanted lines in the Brand CRM and enter no deals, see the Brand CRM entry at the end), clear the 452 junk offer rows, and find out why the email log stops at 24 October.

## After the pitch (shown as the roadmap)

Heads of terms approval and a recommendation note written by the platform (needs Landsec's template; nearest examples are the "Club de Padel Recommendation Note - Cardiff" and "Fee approval - Sushi Tachi" emails, October 2026); keeping full emails so offers file themselves; turnover per tenant from the monthly trading packs; AI mock-ups of a brand in a unit; showing where Amplify differs; an audit log of client access and a per-client data export/delete; finishing the lettings cleanup (Leasing Schedule as a lens).

## Decisions (Woody accepted these defaults on 11 November 2026)

- **Joint agents** (CBRE, Starka, Culverwell) see units, deals and files on their schemes only. They do not see BGP's brand contacts, email history or fees.
  - **Changed by Woody on 12 November 2026** ("Joint agents should have full control like us", "But only on their instructed properties also they can't have access to the brand pages"): on a unit at a scheme on their login a joint agent now does every letting action a BGP login does (brief, targets, files, interest, viewings, offers, Heads of Terms through to Solicitors, deal checklist, recommendation, Share with a brand, add or edit a unit), from their own pages `/landsec/tracker`, `/landsec/viewings` and `/landsec/tasks`.
  - Still closed to them: brand pages and BGP's CRM, BGP's brand contacts, BGP's notes on target brands and the generated Targeting Brief document, BGP's email history and diary invitation details, BGP's fee and internal split, the BGP deal page, ChatBGP, search, every scheme not on their login, deleting a unit or a signed brief, and BGP's own agents on a brief. Asset managers are unchanged.
  - How: `briefAccess()` returns `agentControl` (BGP staff, or a joint agent on their scheme) for actions and `seesBgpNotes` (false for a joint agent) for redactions; `isStaff` is never true for a joint agent. The gateway list is `restrictedLandsecApiRule` in `shared/landsec.ts`, tested in `server/landsec-gateway.test.ts`.
- **Asset managers** see brand pages and the brand case across the whole portfolio, but deals and figures only on their own schemes.
- **Leasing managers** see everything.
- **Demo schemes:** Gunwharf Quays and Bluewater, plus the Liverpool ONE Jersey Mike's unit.
- **AI reads the heads of terms** to fill deal terms, on Anthropic only.

## How to build item 6

Give asset managers and joint agents a new, separate front door: they see only the new workspace pages, through a small set of new routes that check the person's scheme list. Do not retrofit scheme checks into the existing Landsec client view; about 72 server files call the existing scope helpers. The existing gateway is default-deny for clients (`server/index.ts`, `CLIENT_ALLOWED_API`), so the new roles should be denied everything except the new workspace routes. Last year's deck names the people per scheme and is the starting map.

## Build log

- **Item 1, Landsec home — built 11 Nov 2026, not yet checked on the live app** (no `BGP_QA_TOKEN` in the session). `server/landsec-schemes.ts` is the registry of the 14 schemes (group, town, name matcher); every Landsec-linked property is bucketed by name, so duplicates roll up under their scheme and the 51 out-of-scope records drop out of the client property list, the portfolio endpoint and the home. `GET /api/landsec/home` feeds `client/src/pages/landsec-home.tsx`, which replaces the widget dashboard at `/` for the Landsec brand. Analytics now match deals by group spelling (`land\s*sec`), landlord or scheme property. Menu cut to Portfolio / Scheme / Lettings / Brands / Ask on desktop, the phone overlay and the phone tab bar. Duplicate records are NOT merged in the data: an admin merges them from the scheme card (uses `mergeProperties`), after checking the keeper. Not done: the three categories to add and all-retail for London (`CLIENT_CRM_CATEGORIES`) — that is a CRM slice decision, left for Woody.
- **Menu changed 12 Nov 2026 (supersedes the menu and home page in item 1), built, not checked in a browser.** Woody: "The side bar should have Properties, deals and letting tracker"; Brands stays; Ask goes because chat is the chat panel. For a full Landsec login and staff viewing as Landsec the menu is Properties (`/deals/properties`, which carries the scheme cards), Deals (`/deals`, which carries the deal clock), Letting Tracker (`/deals/letting`) and Brands; `/` lands on Properties; `/landsec/deals` and `/landsec/scheme/<key>` redirect to Deals and to the scheme's property page. Asset managers and joint agents keep `landsec-home.tsx`, `landsec-deals.tsx` and the scheme page under the names Properties and Deals. Plan and what is still open: `docs/landsec-menu-plan-2026-11-12.md` and the "Landsec menu" passage in `CLAUDE.md`.
- **Item 2, One unit page — built 11 Nov 2026, not checked on the live app.** `/landsec/scheme/<key>` lists a scheme's units (tenancy rows joined to the tracker and the live deal); `/landsec/unit/<tenancy unit id>` is the single unit page, fed by `GET /api/landsec/unit/:id` (`server/landsec-unit.ts`), which gathers the tenancy row, leasing-schedule row, tracker row with files / viewings / offers, the unit brief and its targets, the deal with its solicitor leg, the people on the scheme and the plans. New table `landsec_units` (migration 0049, in `IDEMPOTENT_SQL_MIGRATIONS`, `shared/schema.ts`) holds the fields nothing else carried: report to, checks heads, incentives, leasing plan, marketing details, legal progress, solicitor catch-ups. `PUT /api/landsec/unit/:id` writes each field to its owning table (ERV + target tenants → tenancy; target brands → leasing schedule; target rent + lease terms → tracker; solicitor fields → deal; the rest → landsec_units). Client logins may write (the gateway allows `/api/landsec/unit`); fees never leave the server for them. Home cards now open the scheme page.
- **Item 3, Agreed brief with two signatures — built 11 Nov 2026, checked on the QA fixture, not on the live app.** Lives at the top of the unit page: use, category (`LANDSEC_BRIEF_CATEGORIES` in `shared/landsec.ts`), NER floor, incentive ceiling, capex envelope, target brands, notes, on `landsec_units` (`brief_*` columns, migration 0049). `POST /api/landsec/unit/:id/brief/sign` with `{role: "leasing" | "am", withdraw?}` records the signed-in person's name and time; an empty brief cannot be signed; saving a change to the terms withdraws both signatures. Until item 6 any Landsec or BGP login can sign in either role — the name on the signature is the accountability; item 6 should restrict "leasing" to leasing-manager logins and "am" to asset-manager logins for the unit's scheme. The scheme page tags vacant and live units Brief agreed / unsigned / none and has a "No agreed brief" pill.
- **Item 4, Deal clock — built 11 Nov 2026, checked on the QA fixture, not on the live app.** Days at stage = latest `deal_audit_log` status change (the mobile deal cards' rule), else `stage_entered_at`, else creation. Waiting-on party / name / since / note and the dependency live in `landsec_deal_clock` (migration 0049), written by `PUT /api/landsec/deal/:id/clock`; the waiting clock restarts when the party changes. NER is `landsecNer()` in `shared/landsec.ts`: headline less incentives spread over the term certain to the first break (parsed from the deal's lease length and break option; 5 years assumed and flagged when neither is recorded); each deal and offer is checked against the brief's NER floor. `GET /api/landsec/deals` is the portfolio view at `/landsec/deals`, now the Lettings menu entry (the BGP letting tracker is one click away). Incentive-ceiling and category checks are shown side by side, not computed.
- **Item 5, Brand case — built 11 Nov 2026, checked on the QA fixture, not on the live app.** `landsec_brand_cases` (one per brand: headline, UK story, covenant summary, evidence jsonb of photos / videos / links / PDFs, proposed units jsonb, draft/sent) and `landsec_brand_case_responses` (one per person per case: seen / supportive / concerns / visit, role, note), migration 0049; routes in `server/landsec-brand-case.ts` (BGP writes; any Landsec or BGP login responds; uploads go through `saveFile` under `landsec-brand-case/` and are served at `/uploads/landsec-brand-case/<file>` to Landsec-scope logins only). Pages `/landsec/brand-cases` and `/landsec/brand-case/:companyId`; strip on the home; "Brand case" button on the brand profile. **The Jersey Mike's case itself is not written** — no content was invented; BGP opens the Jersey Mike's brand record, presses Brand case, writes the UK story and uploads the store photos, and adds the three agreed units (Bluewater Burger King unit, Liverpool ONE Byron unit, Gunwharf middle QSR unit) once those units are in the app. Covenant grade shows for BGP only (the covenant engine is staff-only); the covenant summary text is what the AMs read.
- **Item 6, Logins by role and scheme — built 11 Nov 2026, checked on the QA fixture, not on the live app.** Built as the separate front door: `landsec_access` (user → leasing_manager | asset_manager | joint_agent, schemes[], firm; migration 0049) and `server/landsec-access.ts`. `landsecViewer(req)` replaces the per-file scope helper in every Landsec route and carries the person's scheme set; the home, scheme, unit, deal-clock and deals endpoints filter or refuse on it; brand cases are portfolio-wide for asset managers and refused to joint agents; the brief's signature is role-bound (AM signs as AM, LM as LM, joint agents cannot sign). The `/api` gateway (`restrictedLandsecApiDecision`) lets asset-manager and joint-agent logins reach only `/api/landsec/*` (+ brand-page reads for asset managers) and refuses the rest before any handler (widened for joint agents only on 12 Nov 2026, see Decisions); the client jails routes and menus on `landsecRole` from `/api/auth/me`. Admin creates logins from the panel on the Landsec home (`POST /api/landsec/access`; users row role Client, team Landsec; a generated password is shown once). The three existing Landsec logins have no row and keep the full view (= leasing manager). Still to do by hand: create the real logins from last year's deck's per-scheme people map, and get Woody's view on whether leasing managers should also lose Scheme / Ask.
- **Item 7, AI lock-down — built 11 Nov 2026, checked on the QA fixture.** `runLandsecLocked` / `isLandsecLocked` in `server/utils/ai-provider.ts` (an AsyncLocalStorage context); `landsecAiLockMiddleware` in `server/landsec-access.ts` runs every Landsec-scoped `/api` request inside it (Landsec login, or staff viewing as Landsec), so `chatProvider()` and `globalProvider()` answer Anthropic whatever CHATBGP_PROVIDER / AI_PROVIDER say, for the whole request including tool calls and streams; the OpenAI / Gemini / Flux image helpers in Image Studio throw the lock message inside it (checked: a Landsec login's AI edit gets a 403 with the message; a staff All-Teams call is not locked; staff switched to Landsec is). `GET /api/admin/ai-keys` reports `landsecLock`. Unit test in `server/ai-provider.test.ts`. Background jobs (mailbox sync email reading) follow the global switch — keep AI_PROVIDER unset on Railway. The one-page list for the pitch is `docs/landsec-outside-services.md` (items marked "to confirm" need a human check).

## Working notes for the next session

- The live app is https://chatbgp.app. With `BGP_QA_TOKEN` set in the environment, pages can be checked read-only as Woody (see CLAUDE.md, "Checking pages on prod").
- Contract points that constrain the build: the AI clause (confidential information only in an AI system "operated solely within your own secure environment" and never used to train third-party models); heads of terms only with Landsec's written approval; audit right; return or deletion of data at the end; fees 10% of NER as sole agent and 7.5% as joint agent.
- Items 1–7 were built on 11 Nov 2026 on branch `claude/brave-dijkstra-bhre7z` (a fast-forward of the working branch plus one commit per item; see the build log above). Nothing has been checked on the live app: this session had no `BGP_QA_TOKEN`. Every item was checked on the QA fixture (`qa/run-smoke.sh`'s database) with a Landsec login, an asset-manager login, a joint-agent login and a BGP admin.
- Left for a human: merge the branch into `claude/terminal-coding-interface-JOGQK`; run `/api/admin/schema-drift` after deploy to confirm migration 0049 applied; write the Jersey Mike's case and record its three target units as Wanted lines in the Brand CRM (not lettings: corrected 12 Nov 2026); create the real role logins from last year's deck; the demo data fills listed under "Sources"; the categories / all-retail CRM slice decision.

---


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
   - Correction (Woody, 12 Nov 2026): Jersey Mike's is "just starting to show interest". Treat the three units as early targets, not agreed lettings, and do not enter deals for them.

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

### 12 Nov 2026: independent review, and two changes made from it

A second, independent review of items 1 to 7 and the brand work ran on the
QA app (78 findings, all confirmed on a second check, none on production).
The full list is in docs/landsec-review-2026-11-12.md; nothing beyond the
two items here has been changed yet.

- **Brand CRM plan card, client logins.** The card showed every client the
  other clients' actions and BGP's notes. A client now sees only the actions
  its own company raised, no strategies or events, and its form lists that
  one brand and no contacts.
- **Brand tidy is now hide, then delete** (Woody: "dont archive just delete
  them or hide"). Screens say Hide / Hidden / Unhide. The keep-list also
  matches names on schedules, offers, target lists and briefs, deal parties,
  parent companies and KYC work. Hide and Delete refuse to run if any check
  failed. Re-adding a hidden brand brings the old record back. Delete for
  good takes only hidden brands nothing points at.
- Still open from the review, in the order it ranked them: the AI lock gaps
  (chat attachments, chat tools, Document Studio, staff's own chat), the
  restricted-role gateway, cross-scheme deals on brand pages and the brand
  pack, the role-removal fallback, the agreed brief's signature rules, the
  NER and floor check, draft brand cases visible to Landsec, joint-agent
  unit data, the waiting-on clock, and the Landsec deal counts.

### 12 Nov 2026 (later): the Letting Tracker and the Targeting Brief

Woody put the review items above on hold ("hold all this I just want to work
on the letting tracker as a key part of the Landsec pitch") and asked for the
Targeting Brief to become the way a unit is set up, across the app and for
Landsec. Built on branch `claude/eloquent-allen-2sq5f4`; the rules are in
CLAUDE.md under "Targeting Brief workspace".

- **Add brief** at the top of the Letting Tracker adds the unit (with its
  deal reference) and starts its brief; for a Landsec login it is the main
  button. The client's brief document can be uploaded to fill it in.
- The brief now holds: the brief text, the **commercials**, the **people
  involved** (BGP agents, a joint agent, the leasing team, a senior asset
  manager, the asset manager for the scheme), **plans and files** (unit
  plans, the scheme's plans, Add scheme brochure, photos, other files),
  each person's **comments** with AI help, and **sign-off**: every person
  presses Agree brief and the date is kept.
- A change to the brief or the commercials after people have agreed raises
  the version and asks everyone to agree again; the timeline records who
  did what.
- Asset managers and joint agents open the same brief from the Landsec unit
  page, on their own schemes only. Since 12 November 2026 a joint agent on
  the scheme changes the brief as BGP does (see Decisions); BGP's notes on
  the targets and the generated brief document stay closed to them.
- Open for Woody: the two briefs Woody attached did not reach the session,
  so the commercials field list is a first reading (see
  `BRIEF_COMMERCIAL_FIELDS` in `shared/unit-brief.ts`); whether the older
  two-signature "Agreed brief" card on the Landsec unit page is retired in
  favour of this one; whether BGP staff recording an agreement for someone
  without a login stays allowed; and the Landsec menu has no CRM entry, so
  the Agents tab at /companies is reachable only by typing the address.

### 12 Nov 2026 (later still): the Brand CRM

Woody asked for the brands to have their own CRM, built on schemes and units
and shared with Landsec, and approved the summary the same day. The spec is
`docs/brand-crm-spec-2026-11-12.md` (its Decisions section overrides the
body); the rules are in CLAUDE.md under "Brand CRM". Built on branch
`claude/brave-dijkstra-bhre7z` in eight steps. **Nothing has been opened in a
browser and the app was not rebuilt or restarted**: every screen is
typechecked and drawn to static markup in tests only, and the server was
exercised through tests and read-only SQL against the local QA database with
the four test logins' roles (staff, full Landsec, asset manager, joint agent).

- **The split.** The Landlord CRM (`/contacts`, Overview) keeps every word it
  had and now lists landlord records only. Brand strategies, events and
  actions live in the Brand CRM (`/brands?tab=crm`, a pill in Brand
  Intelligence and a staff menu link). A strategy or event is all brands or
  all landlords; an old mixed one shows on both pages with its own side only.
- **Stages read from the records** (`shared/brand-stage.ts`): Wanted, Unit
  identified, Approached, Viewed, Negotiating, HOTs, Solicitors, Let,
  Trading, Not proceeding, plus Disposing. One stage per brand per unit, the
  furthest live record wins. The one flag set by hand is On hold.
- **Schemes and units** on every brand page: one line per scheme and unit
  with the stage and what it was read from, whether the unit fits the
  brand's requirement, the next step, the owner and links to the Letting
  Tracker row, the deal and the Landsec unit page. Staff add a scheme with
  + Scheme.
- **The Wanted table** (`brand_scheme_targets`, migration 0055): "we want
  this brand at this scheme", with or without a unit. Hidden from Landsec
  until BGP ticks Show to Landsec. Retired with a reason, never deleted. It
  never creates a deal.
- **Targets**: brands down the side, the 14 schemes across the top, a stage
  pill in each cell, filters by stage, scheme, owner, "Wanted, no unit" and
  "No next step". A list of cards on a phone.
- **Action fields** (five new columns on `crm_engagement_actions`): a brand
  CRM action can be placed at a scheme and unit, marked as waiting on a
  party, and shared with Landsec. A shared action shows Landsec its title,
  due date, owner, status, scheme and unit, never the notes.
- **Diary**: one dated list of brand CRM actions, booked viewings, viewing
  follow-ups, deals waiting on someone, briefs awaiting a signature and
  brand cases awaiting a reply, grouped by date, person, brand or scheme.
  BGP staff add actions; a full Landsec login adds requests to BGP.
- **Who sees what.** BGP staff: everything. A full Landsec login or leasing
  manager: the brands on its list at the 14 schemes, never another
  landlord's activity or BGP's strategies, notes, lead, aim or fees. An
  asset manager: the same on their own schemes. A joint agent: a Brand CRM
  page of its own (`/landsec/brand-crm`) with brand names and stages on its
  own schemes and a diary of deals waiting, viewings and shared actions; no
  brand pages, contacts, briefs, brand cases or notes. No other client login
  gets any of it. All of this is cut on the server.
- **Brand contacts**: one person's email history and the dismiss cross on a
  suggested contact now work on a brand (staff only); the phone brand page
  has the landlord-style contacts board for staff; Add contact appears once;
  the Landsec unit page no longer sends a joint agent the brand contact's
  name on a viewing.
- **Jersey Mike's (Woody's correction).** The brand is "just starting to
  show interest". The Burger King unit at Bluewater, the Byron unit at
  Liverpool ONE and the middle QSR unit at Gunwharf Quays are early targets.
  Record each as a Wanted line (brand page, Schemes and units, + Scheme, with
  the unit picked) or as a target on the unit's brief. Do not enter deals.

Tests on 12 Nov 2026: typecheck clean; `npm test` 128 of 128; the three
engine test files and the Brand CRM regression files all pass (see
`qa/regression/README.md`, "Brand CRM"); the full regression folder has 112
failures, every one of which also fails on the commit before this build
(most need `initdb` or a PostgreSQL socket this machine does not have). One
older test the build had broken (the brand fact review save) was repaired.

Fixed after testing (12 Nov 2026, later): BGP's contacts read from its
mailboxes (`contacts-cascade`, `bgp-known-contacts`) are staff only in the
handler, and a dismissed contact suggestion is no longer sent to a client;
a client's brand page and suggested pitches use only the requirements the
Requirements page lets it read; a joint agent is told "Ruled out by BGP",
never BGP's typed reason; staff looking through the Landsec door no longer
see their own BGP actions as Landsec's requests; the plan and diary read the
tenancy schedule once per call (77 seconds down to 0.1 on a 100,000-row
test) and the plan query runs with JIT off; an asset manager is not drawn the
CRM plan card; the requirement chip no longer says a place fits when the
requirement names none; a grid cell's number counts live lines; + Scheme
takes a typed unit and the requirement it answers, and a Wanted line's note
can be edited.

To do after deploy, by hand:

- Check all 14 schemes have a property record (a Wanted line cannot be
  added at a scheme without one; locally only two have).

- Open `/api/admin/schema-drift` and confirm migration 0055 and the five new
  action columns applied (they are created at boot; nothing is back-filled).
- Check each view in a browser as staff, a full Landsec login, an asset
  manager and a joint agent, on desktop and phone, before it is shown.
- For the demo: confirm the seven brands (Jersey Mike's, Wingstop, Flat
  Iron, Yo Chi, Blank Street, Starbucks, The Light Cinema) are on Landsec's
  brand list and not hidden; enter their requirements; add the Jersey Mike's
  Wanted lines and tick Show to Landsec; make one brand strategy for the
  seven. The local QA database holds only Starbucks, so none of this was
  seen with real data.

Open for Woody:

- Whether Landsec should be told that a shared action is waiting on Landsec
  (today nobody outside BGP is sent who an action waits on).
- Whether an On hold brand is safe from the brand tidy.
- Draft brand cases are left out of the plan but a Landsec login can still
  open one on the brand-case pages.
- Landsec writing its own Wanted lines, and an all-landlords Targets list
  for staff, both wait until after the pitch.
- The engine's three test files are not on the `npm test` line in
  `package.json` (another session was editing that line); add them when the
  branches are merged.

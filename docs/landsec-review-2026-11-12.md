# Independent review of the Landsec workspace and brand work (12 November 2026)

Scope: everything built for docs/landsec-pitch-plan.md items 1 to 7 and the
brand directory / CRM plan work. Eight reviewers, each finding re-checked by
a second reviewer told to refute it. All checks ran on the QA test app, not
on production. File and line references are as at commit edeb7e5.

Status on 12 November 2026:
- 1.1 (brand CRM plan card) is fixed in commit 6420da4 with the "proper fix"
  shape: a client sees only its own company's actions.
- 1.10 and section 4 (brand sweep) are done in commit 6420da4, items 1 to 6
  and the guarded delete, except that client search and lists still go
  through the existing slice helper; the client brand page itself refuses a
  hidden brand.
- 2.16 (boot statement for the hidden-brand column) is done in 6420da4.
- Everything else is open.

```text
INDEPENDENT REVIEW: CONCLUSION

All 78 findings survived a second check and none was refuted; many are the same fault seen from different angles, so they are merged below. Everything was reproduced on the QA test app, not on production, and no code was changed. "Your call" marks a decision only Woody can make.


1. FIX BEFORE ANYONE AT LANDSEC LOGS IN

1.1 The brand CRM plan card shows clients each other's actions and BGP's internal notes.
- What goes wrong: a Landsec login on any brand page reads BGP's strategy objectives, event outcomes and action notes (the test data included a fee note), and any second landlord client reads Landsec's actions, and vice versa. Pressing "Add CRM action" also lists BGP's whole landlord client base with contact names and roles.
- Fix now (about 20 minutes): switch the card off for client logins.
- Proper fix (about a day): a client sees only its own actions, no strategies or events, and a company picker holding only that brand.
- Your call: this narrows "see it, add actions" to "add actions and see your own" until a per-item "share with Landsec" tick exists.
[server/crm-engagement.ts; client/src/components/landlord-engagement-panel.tsx, brand-profile-panel.tsx:2647, mobile-brand-view.tsx:252; server/index.ts:4838]

1.2 A file attached to ChatBGP by a Landsec login loses the "Anthropic only" lock.
- What goes wrong: over a normal connection the attachment and the conversation go to OpenAI whenever the chat provider switch is set to OpenAI, while the status check still says Anthropic.
- Fix: build every upload route through one shared helper that carries the lock, make the lock check fail closed, and add a slow-upload test.
[server/landsec-access.ts:32; new server/utils/upload.ts; server/chatbgp.ts:14310]

1.3 ChatBGP's tools and Document Studio call other AI providers with no lock check.
- What goes wrong: a recording dropped into chat by a Landsec login goes whole to OpenAI, an image request goes to Google Gemini, and a research question (rent and unit included) goes to Perplexity. Staff building a document from Landsec heads of terms send the full text to Gemini first.
- Fix: put the refusal where each outside provider is called, and remove those five tools from the Landsec view.
- Your call: the Landsec view loses audio transcription, chat images and web research. Either accept that or disclose Perplexity.
[server/chatbgp.ts:8377, 10529, 9243, 12216; server/perplexity.ts; server/document-templates.ts:808; server/models.ts:2046]

1.4 The "one AI provider for Landsec data" promise is not true for BGP's own day-to-day work.
- What goes wrong: the lock only covers Landsec logins and staff who switch the team picker. Staff in their normal view, the Friday insights run and WhatsApp ChatBGP all follow the chat provider switch, which the written guidance does not mention. The pitch handout says OpenAI and Gemini receive nothing, and the admin page always reports the lock as on.
- Not known: production's setting could not be seen. The app's own text suggests chat runs on OpenAI.
- Your call: either pin all ChatBGP to Anthropic with one setting that is on by default, or name OpenAI in the handout as a processor for staff chat.
- Either way, before the pitch: check the two Railway settings, correct the handout, and make the admin report tell the truth.
[server/utils/ai-provider.ts:46; server/ai-key-check.ts:43; docs/landsec-outside-services.md; docs/landsec-pitch-plan.md:47]

1.5 An asset-manager login can read BGP's intelligence on any company, including rival landlords.
- What goes wrong: by typing a web address (a company name is enough), the most restricted Landsec staff login downloads BGP's pack on a competing landlord. It also sees who BGP emails there and the last subject line. The full Landsec login is refused all of this. A joint agent can fetch BGP's mapping key.
- Fix: the restricted list must only narrow access, then fall through to the normal client checks. Allow clients to mark their own notifications read, so the bell still clears.
[server/index.ts:4959; server/landsec-access.ts:100-113]

1.6 The brand pack PDF and brand pages show deals from other clients and other schemes.
- What goes wrong: another landlord's login downloads a pack listing a Landsec letting with its scheme, unit, rent and term (this half existed before this work). A Bluewater-only asset manager sees Westgate deals and an offer rent on brand pages, and a deal's "depends on" line can name a deal on a scheme the viewer cannot see.
- Fix: filter those deal lists by the viewer's company and schemes, and give the pack its own access check.
[server/brand-pack.ts:103; server/crm.ts:4855 and 3156; server/brand-profile.ts:402; server/landsec-unit.ts:78]

1.7 Removing a role, or a database hiccup, turns a restricted login into a full Landsec login.
- What goes wrong: the bin icon on the access panel leaves a joint agent's password working and opens all 14 schemes, brand contacts, brand cases and chat. It is one click with no confirmation. A failed role lookup does the same for that one request.
- Fix: the bin deactivates restricted logins behind a confirm dialog, and a failed lookup refuses the request.
[server/landsec-access.ts:55 and 175; client/src/components/landsec-access-panel.tsx:68; server/auth.ts:490]

1.8 The agreed brief does not hold as a two-signature control.
What goes wrong:
- A joint agent, who is refused the right to sign, can rewrite the brief, wipe both Landsec signatures, drop the rent floor to £1, and change ERV, asking rent, solicitor details and the deal clock.
- One person, including BGP staff, can give both signatures, and can overwrite or withdraw someone else's.
- Pressing Save with no change wipes both signatures.
- A signature can land on terms changed moments earlier.
- No earlier version is kept.
- "Meets floor" shows green against a floor nobody has signed.

Fix:
- Joint agents become read-only on the unit page.
- Each side signs only as itself, and one person cannot hold both signatures.
- Signatures clear only when a term really changes.
- A signature is tied to the version the signer saw.
- The superseded version is kept.

Your call:
- With BGP unable to sign, no brief reads "agreed" until a real leasing manager and a real asset manager both log in, so the role logins must exist before the demo.
- Keeping history needs a small database change.
- Decide whether joint agents may still update legal progress and the deal clock.
[server/landsec-unit.ts:318-405, 498, 547-582; client/src/pages/landsec-unit.tsx:353-406; client/src/pages/landsec-deals.tsx:158]

1.9 Net Effective Rent and the floor check give wrong answers. No fee is calculated from these figures; the harm is a wrong NER and a false pass or fail shown to Landsec.
- Offers with a term and a break: incentives are spread over the full lease, so NER is overstated and a breaching offer shows "Meets floor". Fix: treat offers exactly as deals. [server/landsec-unit.ts:273; shared/landsec.ts:115]
- Break wording: "year 5, no penalty" is read as no break, "6 months notice at year 5" as a 6-year term, and a date as nothing, with no warning. Fix: read only year-anchored wording, and show "break not read" with a neutral "Check break" pill when unsure. [shared/landsec.ts:88-103]
- Landlord-only breaks are treated as the tenant's, which understates NER. Your call: confirm Landsec's rule, then pass the break party in. [server/landsec-unit.ts:86, 459]
- A premium paid by the tenant is counted as a landlord cost, so the better the offer the worse it looks. Fix: leave it out and show it on its own line. [server/landsec-unit.ts:273]
- When nobody has entered rent-free or capital, NER equals headline rent and shows green. The plan says this is every live deal today. Fix: show "Headline £x, incentives not recorded" and give no pass or fail. [shared/landsec.ts:116; server/landsec-unit.ts:89]

1.10 Do not press Apply on the brand sweep yet.
- What goes wrong: it hides brands currently trading on a Landsec scheme whenever the schedule holds only their name. Nothing ever un-hides them, and if one of its checks errors it hides more, with no warning.
- Fix: see section 4.
[server/brand-relevance.ts:17, 60-68, 95]

1.11 Draft brand cases are visible to Landsec the moment BGP first saves them.
- What goes wrong: half-written covenant notes appear on Landsec's home page, Landsec can file "concerns" against a draft, and a Landsec login can label its response as coming from BGP. "Mark as sent" changes nothing.
- Fix: clients see and answer sent cases only, and the role label comes from the login.
[server/landsec-brand-case.ts:66, 84, 204-210]

1.12 A joint agent's unit page carries BGP's brand contact names, internal deal comments and target feedback.
- What goes wrong: these are in the data behind the page, not on screen, but that breaks the decided rule that joint agents never see BGP's brand contacts.
- Fix: stop sending fields the page never shows, and give joint agents a named list of what they receive.
[server/landsec-unit.ts:183, 190, 292, 297]

1.13 The "waiting on" clock blames the wrong party.
- What goes wrong: changing the party on the unit page keeps the old start date, so the new party inherits the previous party's days. Clearing the party leaves a stale date behind.
- Fix: restart on a party change unless the date was really edited, and reject bad or future dates.
[server/landsec-unit.ts:518; client/src/pages/landsec-unit.tsx:447]

1.14 Landsec deal counts disagree, and a loose name match can pull in another client's deal.
- What goes wrong: the 14-scheme filter was applied to the property list only, so deals, available units, the portfolio card and analytics still count out-of-scope Landsec properties. A deal group such as "Portland Securities" would be counted as Landsec and its name shown to Landsec.
- Fix: one rule for "a Landsec deal in the client view", used everywhere, and an exact group-name match.
[server/routes.ts:10239-10251, 8944, 8985, 4975; server/crm.ts client deals list]


2. FIX SOON (real, not dangerous; the first five show in the pitch)

2.1 Phone home page. On a phone, "/" still shows the old home.
- Asset managers and joint agents get zeros, an error card and tiles that bounce.
- The full Landsec login never sees the 14-scheme home.
- Fix: show the Landsec home on phones.
- Your call: this removes the old phone tiles (Tasks, Calendar and so on) for the full Landsec login, matching the approved five-entry menu.
[client/src/App.tsx:611]

2.2 Dead links and empty pages for the two new roles.
- Deal names, "Property record", "Letting tracker" and the home stage pills throw asset managers and joint agents back to the home page with no message.
- The asset manager's brand page is mostly empty, with a chat box that cannot work.
- Brand Explorer shows no brands, and the chat rail is shown to roles that cannot use it.
- Fix: hide or re-point these for restricted roles.
- The loss of Tasks, Calendar and so on for the full Landsec login is the approved menu cut, not a fault.
[client/src/pages/landsec-deals.tsx, landsec-home.tsx:78, landsec-unit.tsx:144-148, landsec-scheme.tsx:81; brand-profile-panel.tsx; App.tsx:300-317, 814]

2.3 Files on the unit page do not open. Every brochure and plan link is malformed and opens the app shell; it is a one-line fix. [server/landsec-unit.ts:270]

2.4 Money fields silently blank the value. Typing "95k" or "£95,000 pa" saves an empty figure with no error, including the NER floor. A failed save also closes the form and loses the typed text. Fix: one money parser with an error message, a server check, and close the form only on success. [client/src/pages/landsec-unit.tsx:379, 495; server/landsec-unit.ts:328]

2.5 The Lettings board disagrees with the scheme page and home.
- Deals linked through the tracker show no unit and no brief check, and have nowhere to set "waiting on".
- A unit with two tracker rows appears twice.
- The home pills count tracker rows while the board counts deals.
- "Stuck 30d+" is swamped by Marketing voids.
[server/landsec-unit.ts:115, 365, 466; server/landsec-schemes.ts:189; client/src/pages/landsec-deals.tsx]

2.6 Wrong deal picked for a unit. An old comps or free-text-status deal edited more recently displaces the live deal, so clock and solicitor edits land on the wrong record. [server/landsec-unit.ts:121, 205, 233]

2.7 Days at stage can reset to 0 after a refused status change, for example from a minutes import. [server/landsec-unit.ts:50-59]

2.8 Solicitor fields cannot be cleared. Firm, contact and notes stay although the page says saved, and a bad date causes a server error. [server/landsec-unit.ts:370]

2.9 Brand case unit picker. Typing a unit name saves the first letter as the name and the rest as the note. [client/src/pages/landsec-brand-case.tsx:288]

2.10 Desktop brand page. "Add agent" opens its form inside a hidden tab, so it looks dead. Landlord panels on deal pages have a blank Portfolio tab, and clients can land on an empty Stores tab. [client/src/components/brand-profile-panel.tsx:872-880, 2547, 2602]

2.11 Merging and deleting units.
- Merging duplicate units is refused with a misleading message once both copies have Landsec notes, and one such pair blocks the firm-wide reconcile.
- Deleting a unit or a mistaken listing strands a signed brief where the app cannot reach it. A Landsec login can do this.
[migrations/0049_landsec_units.sql:11; server/tenancy-merge.ts; server/tenancy-reconcile.ts; server/tenancy-schedule.ts:531; server/routes.ts:5826]

2.12 Staff viewing as Landsec still see BGP's fee row on the unit page. Demo from a real Landsec login, or strip it. [server/landsec-unit.ts:294, 488]

2.13 AI lock hardening.
- The lock identifies Landsec by exact company name, so a rename unlocks it until restart, and it lets the request through on an error.
- The /mcp connector hands Landsec records to any outside assistant holding the shared key, and is missing from the services handout.
[server/landsec-schemes.ts:92; server/landsec-access.ts:32-38; server/mcp-server.ts:1140]

2.14 Marketing-file downloads have no scope check. Any signed-in login with the exact file link can open them; this existed before this work. [server/routes.ts:8119]

2.15 Automated checks are stale.
- The smoke and phone suites still test the old Landsec dashboard.
- Two regression tests break: the gateway harness stops at its first check, and the CRM plan test still expects brands to be refused.
- The deploy gate was already failing before this work, at an earlier step, for unrelated reasons.
[qa/smoke.mjs:221-259; qa/phone-session-smoke.mjs:199; qa/regression/access.cjs; qa/regression/crm-engagement-postgres.test.mjs]

2.16 First boot of this build. Company pages error for about a second until the new hidden-brand column is added; add it at the start of boot. [server/index.ts MIGRATIONS]

2.17 Full CRM plan page. A brand with no plan yet cannot be picked there, hidden brands are offered and then fail on save, and the wording still says "landlord". [client/src/components/crm-engagement/overview.tsx:93; dialogs.tsx:126; server/crm-engagement.ts:191]


3. BETTER APPROACHES (most useful for the pitch first)

3.1 Make the brief a real pre-approval check.
- Change: add two numeric ceilings (maximum rent-free months, maximum capital). Give each offer and deal one verdict, "Inside the signed brief" or "Outside on: rent free +12 months, capital +£50k", only when both signatures are present. Add an "Ask for an exception" button that uses the existing waiting-on.
- Why: today the brief checks one number, and a 24-month rent-free deal shows green beside a signed 12-month ceiling. This is the answer to "approvals come after the deal is negotiated".
- Wording: do not say "heads can issue". The contract needs Landsec's written approval.
- Effort: medium (about a day; needs your OK for the database change). [shared/landsec.ts; server/landsec-unit.ts:89]

3.2 Tell people when something is waiting on them.
- Why: nothing is requested, notified or sent today, so last year's promises (weekly tracker, offers to both teams within 24 hours, legal updates per asset) cannot be shown or measured.
- "Waiting on you" strip on the home: briefs to sign, deals waiting on my role, unanswered brand cases. Medium, about a day, no database change.
- "Send for signature" with "requested 3 days ago". Medium. The notification bell is currently blank for every client login and must be fixed first. Emailing Landsec people is your call.
- "Presented to Landsec" stamp on offers. Small; needs your OK for the column; never triggered by email-detected offers.
- Printable weekly scheme report. Small to medium. The emailed version waits until after the pitch.
[server/landsec-home.ts; server/routes.ts:10456; server/leasing-viewings.ts:258]

3.3 Fill the two demo schemes with real terms.
- Change: read final heads of terms into rent free, capital, term, break and solicitor fields. Draft briefs as "Drafted by BGP, awaiting signatures". Enter the Jersey Mike's lettings and clear the junk offers.
- Why: otherwise every deal reads "No one named", every unit "No brief", and NER has nothing behind it.
- Effort: large (2 to 3 days, mostly data; already on the plan).

3.4 One consistent, editable Lettings board.
- Change: use the scheme page's unit match on the board and one rule for "brief drafted". Limit "stuck" to Negotiating, HOTs and Solicitors. Count the home pills from deals. Let "waiting on" be edited from the board row.
- Change: suggest a waiting party only where it is a recorded fact (the missing signatory), shown as "suggested".
- Why: the board is the "where deals are stuck and with whom" view and currently contradicts the other pages.
- Effort: small to medium (about half a day). [server/landsec-unit.ts:466; client/src/pages/landsec-deals.tsx]

3.5 Make the brand case answer "who is on board".
- Change: count Landsec responses only (today's "supportive 1" is BGP). Take the role from the login. Show "3 of 9 asset managers answered" by scheme. Link each proposed unit's page to its case.
- Why: this is the Jersey Mike's showpiece.
- Effort: medium (about a day; no new table needed). [server/landsec-brand-case.ts:42, 213]

3.6 Store each property's scheme rather than guessing from its name.
- Why: a rename changes what a joint agent can see. A Landsec login renaming a test property locked the agent out, and a new "Westgate House, Newcastle" record appeared inside their Oxford scheme. Names such as "Clark's Village" and "1 New Change" fall out, while "Queen Victoria Street" falls in.
- Change: add a scheme key assigned by an admin, with the name match as the suggestion only.
- Effort: medium (about a day; needs your OK for the database change).
- Cheaper interim: tighten the patterns, flag near-misses, and stop pre-ticking records for the irreversible merge. [server/landsec-schemes.ts:25; client/src/pages/landsec-home.tsx:241]

3.7 Make ERV traceable.
- Change: record who changed it and when in the existing audit table, and show "set by X on date" on the page.
- Why: today a mistyped digit or an outside agent changes it for everyone with no trace.
- Effort: small (2 to 3 hours). The "Amplify says" comparison stays on the post-pitch roadmap, as planned. [server/landsec-unit.ts:333]

3.8 Bring the new Landsec pages to the house design standard.
- Change: stage colours in place of black chips, a normal-size status chip, mono figures, a card list (not a table) on phones, and plain error messages with a link home.
- Why: this is the pitch surface and it looks different from the rest of the app.
- Effort: small. [client/src/pages/landsec-*.tsx]

3.9 Trim the extra database look-ups on every client request.
- Change: reuse and cache the "is this Landsec" check.
- Effort: small, optional. Do not cache the role lookup. [server/landsec-access.ts:23, 78]


4. THE BRAND SWEEP

Recommendation: hide, not delete. Keep the reversible flag, call it "Hide" everywhere, and offer "Delete permanently" only for hidden brands that nothing points at.

Why not delete:
- Deleting a brand blanks its links on deals, and the other links are plain text, so they would be left dangling.
- A delete during testing raised a warning from the AML retention safeguard.
- The sweep's keep-list has gaps today. It would destroy brands currently trading on Landsec schemes (named by text only), brands Landsec targets by name, and companies that are vendor, purchaser or landlord on a deal.

Why hide needs work before Apply is pressed:
- Re-adding a hidden brand creates a duplicate with none of its history.
- A hidden brand that later gets linked stays hidden for good.
- Clients can still find hidden brands by search and direct link, although the dialog says they cannot.
- A client's "add brand" on a hidden brand silently does nothing.
- There is no bulk undo.

Do these first (about a day):
1. Keep any brand whose name matches a tenant, offer, viewing or target name on a schedule. Also keep deal counterparties, parent companies, and brands with KYC work.
2. Refuse Apply if any check failed to run.
3. Un-hide automatically when a hidden brand gains a link. Leave hand-hidden brands alone.
4. Re-adding a hidden name (staff create or client add-brand) restores the old record.
5. Hide consistently from clients, including search and the brand page. Staff still find hidden brands, labelled "Hidden", with a Restore button.
6. Relabel Archive to Hide throughout.

Then add "Delete permanently". It is admin-only, with a typed confirmation, and only for hidden brands with no contacts, no KYC work, no links and no name match.

Brands with contacts but no activity can still be hidden (your earlier choice) but should never be deleted by the sweep.
[server/brand-relevance.ts; server/crm.ts:2005; server/company-scope.ts:146-169; server/routes.ts:2034, 6609; server/storage.ts:777, 1277; client/src/components/brand-tidy.tsx]


5. NOT REVIEWED

No reviewer covered these areas. A single final pass looked at each (on the test app unless marked "code only"), without the double check applied above.

1. Merging two duplicate brands strands the brand case and CRM plan on the hidden duplicate, so the Jersey Mike's case could vanish from its page. [server/brand-dedupe.ts:24-70]
2. No change history on any Landsec write, although the handout says the activity log records who opened what. This matters for Landsec's audit right. [server/landsec-unit.ts:335-369; docs/landsec-outside-services.md:45]
3. Two people editing one unit: there is no clash check, and one of six simultaneous catch-up notes was lost. Code only: the next tenancy import may overwrite an ERV typed on the unit page. [server/landsec-unit.ts:409-427; server/tenancy-schedule.ts:664]
4. Brand sweep: a failed check hides more brands (seen), restore is one brand per click, and the hidden list is capped at 500.
5. Brand-case evidence files are served as whatever type the uploader claims, so a staff-uploaded file could run script in a Landsec login's session. [server/landsec-brand-case.ts:17-24, 193]
6. ChatBGP's app map is wrong in several Landsec lines. Out-of-scope Landsec properties still appear in search and by direct link. [server/chatbgp-app-map.ts:45-46, 114-115]
7. Outside-firm logins: a one-character password was accepted, there is no forced change or expiry, re-creating a login silently overwrites the password, and the panel has no deactivate control. [server/landsec-access.ts]
8. Automated tests: nothing tests NER, the role gateway, the scheme matcher or the sweep, so every fault above can return unnoticed.
9. Accessibility was not examined: no labels on icon buttons or search boxes, and keyboard and focus were not checked.
10. ChatBGP and the new data (code only): Ask can give directions but cannot read a brief, clock or brand case. What staff ChatBGP can read or write in the new tables was not examined.
11. Nothing was run against production-shaped data. The test app has 2 of 14 schemes and 11 brands. Before deploy, a read-only pass as Woody is needed on the sweep preview, the Landsec home (out-of-scope list) and the schema-drift report.
12. Still untested: staff viewing as Landsec in a browser, cookie-session security on the new write routes, a non-admin staff login on admin routes, a leasing-manager login, and forms on a phone. The page shells did hold at phone width.
```

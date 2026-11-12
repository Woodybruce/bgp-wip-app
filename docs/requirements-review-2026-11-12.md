# Requirements review: towards a live requirements centre (12 November 2026)

Woody asked for the Requirements page to become the live requirements centre
for expanding brands, fed by chats, discussions, emails and news such as
Propel, and considered app wide. Six readers mapped the page, every intake
path, the communications the app holds, the news pipeline, every consumer of
requirements and the screens. Three proposers drafted 39 suggestions and each
was checked against the code (all 39 sound with changes). Read-only: nothing
here is built. The test database holds no requirement rows, so points that
need live data say so. File references are as at commit 81b6953.

```text
REQUIREMENTS REVIEW FOR WOODY

This review is read-only. Nothing was changed, saved or sent. It is reasoned from the code, because the test database holds no requirement rows. Where a point needs the live system, it says so.

REVIEW: WHERE REQUIREMENTS COME FROM TODAY AND WHY THE PAGE FEELS HISTORIC

A1. Only one feed runs by itself. PIPnet is imported each morning at 05:30. It takes listings from the last three months and reads five result pages at most.

A2. The Requirement List only refreshes when someone presses the button under Sync tools. It has no schedule. Its rows arrive with no date at all.

A3. Every imported row is saved as Active. Nothing in the app ever moves a row off Active. Only a person editing the row changes its status.

A4. The date on a row means different things. It can be PIPnet's listing date, a viewing date, or the day someone typed it in. When PIPnet lists a brand again, the date is not refreshed. So the green, amber and red age badge is not a "last confirmed" date.

A5. The imports allow one row per brand. A second search for the same brand is dropped. A changed listing only fills blank fields.

A6. A row carries no evidence. It has a source label, a comments box and a text date. The page reads nothing from news, brand signals, emails or chats. The only activity it shows is confirmed viewings.

A7. When someone asks ChatBGP to log a requirement, it is saved to an old table that no page reads. It never appears on the Requirements page.

A8. Requirements made from a viewing are saved as Draft. The page only lists Active, Past and Archived. Those drafts are invisible.

A9. Wipe & resync deletes every requirement whose name matches a name in that import. That includes hand-made rows. It then reloads only three months of PIPnet.

A10. The rest of the app treats every Active row as live, whatever its age. The unit target engine gives a fitting requirement its biggest score and calls it a live requirement. About twenty screens each use their own meaning of live. Only the expansion score uses a 12-month window.

A11. A Landsec login sees every PIPnet row for any brand, plus rows for its own company. That list is not limited to their brand slice. BGP's hand-entered rows are hidden from them.

A12. What could not be checked without live data: how many rows exist, their ages and sources. Whether the 05:30 PIPnet job is succeeding. Whether the old chat table holds rows. Whether the Tenant Rep page loads on live. It failed on the test system because it looks for the wrong saved sign-in. The visible history shows no change in the last three months to where requirement rows come from.

REVIEW: WHAT THE APP ALREADY KNOWS THAT NEVER REACHES A REQUIREMENT

Emails

B1. The email log keeps the subject and about 200 characters of each email. It keeps no full text and no attachments. An email is only filed if it matches a known contact. Two inbox checks exist, for offers and for interest, but both need a tracker unit to be named. An email saying "we want 2,000 sq ft in Leeds" produces nothing. The mailbox sync looked stalled at 24 October on the last live check.

B2. The app can fetch the full text of an email when asked. It already does this for publisher newsletters and for the nightly archive. So reading emails for requirements is a build, not an impossibility. It does mean the app reading staff mailboxes, with a cost per email. Circulars with PDF attachments from senders not in the CRM would still be missed at first.

Chats

B3. ChatBGP threads, team chat and the Gossip channel are stored in full. A post can carry a brand tag. The only reader is the Gossip summary, which is made on request and saves nothing.

B4. Hard limit: the app can only read what is typed into the app. Microsoft Teams chat messages, staff's own WhatsApp, phone calls and face-to-face talk are not held anywhere. The app's WhatsApp number is ChatBGP for staff only.

Meetings

B5. Teams meeting transcripts are saved as notes with a summary and suggested tasks. Nothing looks for requirements in them. A note is filed to the company most attendees belong to, which may be a landlord or an agent. Whether transcripts are arriving needs a live check.

Viewings and offers

B6. Viewings, offers and interest all carry the brand. They are the strongest sign a brand is looking. A viewing can only create a Draft by a button, and it is refused if the brand already has any requirement. It never updates an existing one. Unconfirmed offers found by email are known to be noisy on live.

News and Propel

B7. The news side is well built. It reads 29 press sources including Propel's feed. It also reads Propel's daily email in full from staff mailboxes every 30 minutes on live. Stories become brand signals that feed the expansion score, the alerts and the brand page. None of it creates, updates or suggests a requirement. On the test system Starbucks had 20 dated signals, including a target of 500 new UK shops. The Requirements page was empty.

B8. Hard limits: each Propel email is cut at about 8,000 characters and 20 items. Only a one-line headline is kept, with no link. Stated site numbers, sizes and towns are lost at that point. The fuller facts come from a nightly pass that covers 25 brands a night. Article pages are never read, only the headline and a short extract. Whether the Propel email reader is running needs a live check.

THE DESIGN IN ONE PARAGRAPH

A live requirement is one record per search, shown under its brand, that a named BGP person has confirmed within a set period. Each record carries a list of dated evidence: a call, an email, a chat post, a viewing, a PIPnet listing, a Propel story. Every source feeds one intake. That means PIPnet, The Requirement List, ChatBGP, team chat, meetings, emails and trade news. Anything a machine detects becomes a suggestion, never a live requirement. Suggestions land in one staff-only list on the Requirements page called To confirm. A person answers each one with one tap: confirm, add to an existing requirement, wrong brand, or not a requirement. Each brand then sits on one of three rungs. Expanding means press reports only and no brief. To confirm means something is waiting for a person. Live means confirmed and in date. Old imports stay visible as market listings in the background. Every other screen in the app uses the same single rule for what counts as live.

SUGGESTIONS: THE REQUIREMENTS CENTRE PAGE

1. A read-only health report. An admin page that counts rows by source, age, status, drafts, undated rows and rows with no brand link. It also counts rows in the old chat table and auto-made Tenant Rep rows. Why: nobody can size anything else without it. Effort: small, half a day to one day.

2. Hide the two Wipe & resync items now. Why: they delete hand-made requirements by name. Effort: small, under an hour.

3. One meaning of live, used everywhere. Four states: Live, To confirm, Background and Closed. The rule is written once and every screen reads it. Until a real confirmed date exists, a row may only say "listed" or "last edited", never "confirmed". Why: today an import from long ago and yesterday's phone call look the same. Effort: medium, 5 to 7 days including the main screens. Needs your OK: three new fields for when, who and how it was confirmed.

4. An evidence list on every requirement, with a plain "how sure" label. Each line holds its own source, date, headline or excerpt, and a link where one exists. The label is worked out from the list. Why: nothing on a row says why it is there. Effort: medium, 5 to 6 days. Needs your OK: one new table. Limits: a Propel email item has no link to open. An email line shows the subject, date and a short excerpt only.

5. The To confirm list. Staff only. It shows the invisible Draft rows first, then suggestions from every source. One open suggestion per brand at a time. A dismissal quietens news suggestions for that brand for about 30 days. Why: this is the safeguard that stops guesses becoming live requirements. Effort: medium, 5 to 6 days after item 4.

6. A "Still live" button and gentle ageing. One tap stamps the confirmed date. Rows not confirmed in time drop to To confirm on their own, with no overnight job writing to the database. The owner gets a Monday line in the morning briefing. Why: nothing ages today. Effort: small to medium, about 6 days across the button and the ageing. Needs items 3 and 7 first.

7. Give every requirement a BGP owner. Add the owner to the add form, the row and the phone card. Suggest owners from the brand's BGP team as a preview list for a person to accept. Why: almost no leasing requirement has an owner, so nobody can be nudged. Effort: small, 2 to 3 days. No database change.

8. Treat old PIPnet and Requirement List rows as market listings. They move to Background and show "not re-issued on PIPnet since" with a date. The app cannot prove a listing has gone, so it will not say so. Each row gets a link to its import record. New hand-made rows are stamped as BGP's own. Why: the old rows are what make the page feel historic. Effort: medium, 3 to 4 days. Needs your OK: one new link field.

9. A new page layout. Step one: a row of pills with counts, a sort, a source filter, visible dates and a renamed Past section. Step two, after the items above: To confirm, Going stale, In the news and Mine. Open on Everyone until owners are handed out. Why: three status tables hide what needs doing. Effort: large, 6 to 8 days across both steps.

10. Lead with the brand. One card per expanding brand, with its separate searches beneath it and any Tenant Rep instruction at the top. Allow more than one search per brand. Store size as real numbers. Why: one row per brand loses second searches. Effort: large, 8 to 10 days in three steps. Needs your OK: size fields. Caution: the Tenant Rep board also holds rows made automatically for deals at Negotiating. Those need a tidy first.

11. One fit rule and an honest reason. Six different matchers exist today and they can disagree. Choose one rule, show old against new, then switch. Reasons should carry the state and date. Why: Fits and Match give different answers for the same unit. Effort: medium, 4 to 5 days. Needs your decision on the rule.

12. Small repairs while the page is open. Remove dead controls. Remove edit and delete buttons that Landsec logins can see but cannot use. Fix the Tenant Rep sign-in fault. Effort: small, about 1 day.

13. Phone triage list. Cards showing state, date, owner and source, with Confirm and Still live under the thumb. Merge the two phone lists into one. Effort: medium, 3 to 4 days. Do this last.

Already exists: the "Recently viewing, 90 days" filter, and viewings already link to a requirement.

SUGGESTIONS: PICKING UP EMAILS, CHATS AND MEETINGS

1. Fix ChatBGP first. "Log a requirement" should save to the real list, matched to the brand's CRM record, with a duplicate check and an audit line. In the same change, block these two tools for client logins. They are open to Landsec logins today. Why: this is the clearest broken link and the cheapest to mend. Effort: small to medium, 2 to 3 days. No database change.

2. One intake for every source. One piece of server code that every feed calls. It has two exits. A machine detection becomes a suggestion. A named staff member's instruction counts as the confirm, if you agree. It never invents a brand. An unmatched name always becomes a suggestion. The other back doors into the list are closed or routed through it. Effort: medium, 5 to 6 days.

3. Match the brand by the strongest clue. Use the sender's contact record first, then a brand tag, then the brand's recorded other names. If two brands are possible, the card says so and the reviewer picks. Effort: small, 2 to 3 days.

4. Viewings and offers as evidence. Show a brand's confirmed viewings and offers on its requirement, read live. A viewing should attach to an existing requirement, not be refused. Two plain rules raise suggestions. One: two viewings in 90 days and no requirement. Two: the deal has reached solicitors, so mark the requirement Past. Effort: small to medium, 3 to 4 days.

5. Team chat and Gossip. Posts by staff that tag a brand are read for a stated requirement and raise a suggestion. Staff-only threads only. Never threads with a client member. Effort: small to medium, about 3 days.

6. Meeting transcripts. Each Teams transcript is passed to the intake. Effort: small, about 2 days. Check on live first that transcripts are arriving.

7. The email reader. A scheduled reader over staff mailboxes. Version one reads only emails to or from a known brand or agent contact. It fetches the full text one email at a time and keeps only a short quote. It remembers every email it has already judged. It writes suggestions only. Private mailboxes stay excluded. Effort: medium, 5 to 6 days. Needs your OK to read full email text. Do not switch it on until the mailbox sync is shown to be running.

8. Later additions to the email reader, not yet sized. Requirement circulars from unknown senders, and their PDF attachments. The app already has a PDF requirement reader that could be joined up.

9. Two manual routes, not yet sized. A "Log as requirement" button in the Outlook add-in. Forwarding an email to the ChatBGP inbox, which showed as not connected on the test system.

10. A feed status panel and previewed back-fills. One panel shows when each feed last ran: PIPnet, mailbox sync, Propel, transcripts. Back-fills of old emails, old signals and old chat rows are admin Preview then Apply, team by team. Effort: medium, 5 to 6 days.

11. All of this reading stays on Anthropic, with a daily cap. Background jobs run outside the Landsec lock, so the intake must call Anthropic directly and log its own spend. Effort: small, 1 to 2 days inside item 2. Separate finding: the nightly email archive sends every staff email through the switchable AI helper. That includes Landsec correspondence.

Already exists: the detect-then-confirm pattern for email offers, and the brand alias list.

SUGGESTIONS: NEWS THAT DRIVES REQUIREMENTS

1. Check the Propel email reader is running. It only runs on live and depends on the same Microsoft access as the stalled mailbox sync. If it is down, only Propel's feed is arriving. That showed 10 items in 30 days on the test system. Effort: part of the half-day live check.

2. An "Expanding now, nothing on our books" list. Brands with recent expansion, funding or stated-requirement stories and no requirement. It appears as the In the news pill on the Requirements page. "Add requirement" pre-fills the brand, headline and link, and saves it as unconfirmed. Effort: small to medium, about 3 days. No database change.

3. Teach both news readers to spot a stated requirement. Add one yes or no question to each reader: does this story state what space the brand wants, or an expansion target? Capture sites, size, towns and timing. Keep the story's existing type, so scores and maps do not move unreviewed. Read long Propel emails in sections so later stories are not cut off. Effort: small to medium, about 3 days.

4. Strong stories raise a To confirm card. A named brand with a stated number of UK sites qualifies. News never resets the confirmed date. Only a person does. Effort: small, inside item 3, once the To confirm list exists.

5. News in the other direction, not yet sized. A closure, CVA or administration story should raise a "still live?" card on that brand's requirement. Those signals already exist.

6. Wider sources, for your decision. The Caterer, Planning Resource and Property Reporter are not fed at all. Propel's monthly multi-site database is only read when someone asks ChatBGP. Nobody has checked the PIPnet, Requirement List or Propel terms for scraping, AI reading or showing results to Landsec. That is unchecked, not a finding.

Already exists: the nightly pass already recognises a "stated requirement" fact, and the score already counts it.

SUGGESTIONS: ACROSS THE APP

1. Tracker targets, Plan targets and "brands that fit". Scale the score by how recently the requirement was confirmed. Replace "live requirement" with a dated, honest reason. Fix one fault whatever else is decided: the target engine loads every requirement for client viewers, including BGP's hand-entered ones. Effort: medium, 2 to 3 days.

2. Property and landlord pages. "Space that fits a brand's requirement" uses the same live rule and dated reasons. Effort: included in item 1.

3. Brand page, Brand Explorer, expansion score and alerts. Use the confirmed date. Stop Requirement List imports scoring as BGP's own requirements. Correct every heading that says "live" over rows of any status. A news signal gets a staff-only "raise as requirement" action that sends a suggestion. Effort: small to medium, 3 days.

4. Landsec. This needs your decision before any build. Recommended: public listings and trade news show for brands in their slice. BGP-entered requirements stay private unless a person marks one to share. Requirements where BGP acts for the brand always stay hidden. Asset managers get anything only through the Landsec workspace. Joint agents get nothing. Effort: medium, 4 to 5 days after the decision. Needs your OK: one share marker field. Expect the Landsec list to shrink until imported brands are given a category.

5. ChatBGP. Its "open requirements" context and its requirement search should read the real list with the live rule. The app map needs new lines: what counts as live, how to log a requirement by chat, and how a phone user reaches Requirements. Effort: inside the ChatBGP fix.

6. Weekly insights, daily digest and leads. Join news to requirements in code by brand, so the Friday report lists real overlaps. Today it asks the AI to spot them. The digest shows "N requirements need reconfirming". Effort: small, 1.5 to 2 days.

7. Brand tidy and the Agents list. An old import should keep a brand for 12 months, not 24. The client Agents list should need a current requirement. Do not apply the rule to viewing sync, or it loses the viewings that reconfirm a requirement. Effort: small, 1.5 days. Needs your nod and a preview, as both are decided areas.

8. Two gaps, not yet sized. Nothing alerts the person marketing a unit when a new requirement fits it. And a letting deal for a brand does not link to, or close, that brand's requirement.

9. Investment requirements are parked. Everything above is the leasing list. You said brands, so that seems right, but it is a choice.

Already exists: brand briefs already treat an old Active row as unproven, and the alerts already guard against a burst when scoring changes.

ORDER OF WORK

Quick wins, before the pitches. About 1 to 2 days in total.
- The live check, half a day: mailbox sync, PIPnet job, Propel reader, transcripts, and which AI provider is set.
- The health report, half a day to one day.
- Hide the two Wipe & resync items.

Foundations, straight after 30 November. About 10 to 12 days.
- Make the imports honest about dates and stamp hand-made rows.
- The single live rule.
- Target brands and "brands that fit" stop calling old rows live, with the client fault closed.
- Show the hidden Draft rows and correct the "live" headings.
- The ChatBGP fix.

First release. About 6 weeks.
- Evidence list, confirmed date and the Still live button.
- The intake and the To confirm list.
- Owners.
- Viewings, team chat and meeting feeds.
- The Expanding list and the news reader changes.
- Brand page and score.
- Weekly insights and digest.

Later. About 7 to 8 weeks, to be re-sized after the health report.
- The email reader, the status panel and the back-fills.
- The Landsec view.
- Brand-first cards, more than one search per brand, and numeric sizes.
- The single fit rule.
- The new page layout, step two, and the phone list.
- Brand tidy and Agents list.

Rough total: three to four months for one developer. The estimates overlap, so treat the total as a guide.

For the Landsec pitch in the week of 23 November: do not show the Requirements page. It would show old listings as live. What exists today and is worth showing is the brand page Intel tab with dated expansion signals. The News page's brand list is also limited to their slice. Check both on live first, as the test system's Brand watch was empty. Dated target brands on a Landsec unit are not on the new unit page yet. Describe the live requirements centre as the next phase. Do not demo it.

DECISIONS FOR YOU

1. Do you approve the database changes: one evidence table, plus new fields for confirmed date, sizes, import link and share marker?
2. What are the windows? Suggested: Live is confirmed within 90 days. To confirm is 90 days to 12 months. Background is older or import-only.
3. Does a staff member telling ChatBGP to log a requirement count as the human confirm?
4. May the app read the full text of staff emails for requirements? Which mailboxes? Attachments and circulars from unknown senders too?
5. Can a press story become a requirement on confirm, or must it sit on the Expanding rung until someone has spoken to the brand? Should strong stories raise a card automatically?
6. Old PIPnet and Requirement List rows: keep as Background, hide, or retire? Should they keep a brand in the directory for 12 months or 24?
7. Landsec: public listings limited to their slice? BGP-entered requirements only when marked to share? Tenant-rep requirements always hidden? Anything for asset managers?
8. Tenant Rep: keep its own board, or fold it in as the Instructed stage? OK to list its auto-made rows for a tidy?
9. Owners: one person or a small team? Who clears unowned suggestions? Do suggestions expire after 30 days?
10. The fit rule: is size alone enough, or size plus use or place?
11. Imports: put The Requirement List on a schedule? Remove Wipe & resync for good? Keep the newsletter reader adding up to five new brands per email?
12. Pin the background email jobs, including the nightly archive, to Anthropic now?
13. Which trade sources after Propel, and who checks the subscription terms?
14. Timing: only the live check and health report before the pitches?
15. What should the Past section be called? It is titled "BGP Requirements" today.

FILE REFERENCES FOR THE DEVELOPER

All paths are under /home/user/bgp-wip-app. The repo is at 530603e, two commits past 81b6953. Neither later commit touches requirements code.

Lines I re-read myself in this session: server/chatbgp.ts 7679-7689 and 2323-2356. server/leasing-viewings.ts 370-381. client/src/pages/requirements.tsx 792-794 and 1149. server/pipnet.ts 1251-1283. server/routes.ts 3753-3770. server/target-tenant-engine.ts 112-115 and 229-247. server/interactions.ts 259-264, 358, 1172-1178, 1217. server/insights-feed.ts 290-299. server/news-brand-linking.ts 262-279. server/crm.ts 5361-5376 and 786-803. server/index.ts 34-41, 5532, 6585-6592. server/trl.ts 433-450. server/expansion-intel.ts 37, 62-67, 274-280, 311. shared/schema.ts 1086-1115. client/src/pages/tenant-rep.tsx 444-457 and client/src/lib/queryClient.ts 87. A grep for "requirement" in server/brand-triggers.ts, daily-briefing.ts, deal-stages.ts, letting-service.ts and crm-engagement.ts returned nothing. Every other reference below comes from the maps and the checkers. I did not re-open those lines.

Review references
- A1: server/index.ts 6586-6592. server/pipnet.ts 915-923, 955.
- A2: client/src/pages/requirements.tsx 412, 1018. server/routes.ts 3843. server/trl.ts 433-450. No TRL job found in server/index.ts.
- A3: server/pipnet.ts 1291-1305. server/trl.ts 449. server/crm.ts 5434-5436. server/storage.ts 1157-1160.
- A4: server/pipnet.ts 1247-1248, 1274, 1296. server/crm.ts 5422-5424. server/leasing-viewings.ts 376-378. Badge at requirements.tsx 87-99.
- A5: server/pipnet.ts 1253-1283. server/trl.ts 402-425. server/leasing-viewings.ts 373-374.
- A6: shared/schema.ts 1086-1115. Page queries at requirements.tsx 473-590.
- A7: server/chatbgp.ts 4054-4070, 7679-7689, 13376-13386, 7750-7763, 13304-13326, 7019-7023. server/mcp-server.ts 205-220. Legacy table at shared/schema.ts 43-55.
- A8: server/leasing-viewings.ts 376. requirements.tsx 792-794. client/src/lib/crm-options.ts 224.
- A9: server/routes.ts 3750-3776, 3857-3882. Menu at requirements.tsx 1015, 1019.
- A10: server/target-tenant-engine.ts 112-115, 229-243. server/crm.ts 5187-5194, 5251, 5308-5311. client/src/components/mobile-brand-view.tsx 444-447. server/expansion-intel.ts 62-66.
- A11: server/crm.ts 5363-5375. replit.md 42.
- A12: tenant-rep.tsx 444-457 against queryClient.ts 87. Screenshots in /tmp/claude-0/-home-user/4c454855-b3ac-5dd1-9467-1529a6518a24/scratchpad/reqreview/screens-history/out2 and /tmp/claude-0/-home-user/4c454855-b3ac-5dd1-9467-1529a6518a24/scratchpad/reqreview/screens-history/out3.
- B1: server/interactions.ts 174-213, 259-286, 358, 1172-1217. shared/schema.ts 1493-1507. server/viewing-sync.ts 522-694. docs/landsec-pitch-plan.md 133-137. The code stores 200 characters. The earlier live check reported 255.
- B2: server/insights-feed.ts 257. server/archivist.ts 263-298, 619-697. Email processor off at server/index.ts 5532. Attachments flag only at server/archivist.ts 649.
- B3: shared/schema.ts 365-399. server/routes.ts 149, 195-215. server/gossip-channel.ts 50-78.
- B4: server/whatsapp.ts 365-390, 979-995. No Teams chat reader found by grep of server.
- B5: server/teams-notes.ts 34-45, 47-130, 147-151.
- B6: shared/schema.ts 1965-2019. server/leasing-viewings.ts 359-383. docs/landsec-pitch-plan.md 136.
- B7: server/news-feeds.ts 62-118, 76. server/insights-feed.ts 45-63, 231-257, 413-416. server/news-brand-linking.ts 239-364, 932-979. Zero references to requirement tables in the news files, per the news map grep.
- B8: server/insights-feed.ts 292, 298-299. server/news-brand-linking.ts 264-279, 286-287, 344-358. server/expansion-intel.ts 37, 224, 311-325. server/news-feeds.ts 273-285.

Requirements centre page
- 1 Health report: pattern in server/letting-integrity.ts 7. Reads crm_requirements_leasing, external_requirements, requirements, tenant_rep_searches. No schema change.
- 2 Hide Wipe & resync: requirements.tsx 1006-1021, 429, 449. server/routes.ts 3750-3776, 3857-3882. No schema change.
- 3 One meaning of live: new function plus SQL fragment beside shared/requirement-fit.ts. Consumers include server/target-tenant-engine.ts 112-115, server/crm.ts 5187-5194, 5308-5311, 8659-8660, 8829-8849, server/property-gap-analysis.ts 522-537, server/account-teams.ts 36-67, server/brand-pack.ts 93-100, server/brand-profile.ts 458-466, server/routes.ts 9893-9901, server/chatbgp.ts 2160-2175. Wording to reuse at server/brand-brief-evidence.ts 10, 46. Schema: last_confirmed_at, last_confirmed_by, confirmed_how on crm_requirements_leasing, all nullable, added through shared/schema.ts and the drift guard at server/schema-drift.ts 36.
- 4 Evidence list: new table requirement_evidence with id, requirement_id nullable, company_id, kind, evidence_date, source_ref, url, excerpt, said_by, status, internal flag, dedupe_key, created_at. Needs a boot CREATE TABLE IF NOT EXISTS, pattern at server/index.ts 144, 157. Signal ids are unstable at server/expansion-intel.ts 274-295, so lines must be self-contained. Strip evidence server-side for client logins.
- 5 To confirm list: requirements.tsx 792-794 and a new staff-only endpoint outside /api/crm, because clients may GET anything under it at server/index.ts 4755-4759. Draft source at server/leasing-viewings.ts 376. Viewing link at client/src/components/leasing-viewings.tsx 186. App map line at server/chatbgp-app-map.ts 51.
- 6 Still live and ageing: server/crm.ts 5434-5446. server/storage.ts 1157-1160. requirements.tsx 537, 89-99. server/daily-briefing.ts 52. Uses item 3 columns.
- 7 Owners: shared/schema.ts 1100-1101. server/leasing-viewings.ts 376-377. requirements.tsx 752-755, 1929, 3905-3911, 3137-3151. server/hr-routes.ts 453-460. server/bgp-team-sync.ts 32-33. No schema change.
- 8 Market listings: server/pipnet.ts 1002-1014, 1054-1097, 1253-1310. server/trl.ts 111, 235, 257, 402-450. server/crm.ts 5416-5425 for the BGP stamp. shared/schema.ts 1579-1601. Schema: external_requirement_id nullable on crm_requirements_leasing, back-filled by admin Preview then Apply.
- 9 Layout: requirements.tsx 792-800, 838-922, 1001-1021, 1149, 2364-2472. server/storage.ts 1144-1145. docs/DESIGN.md convert on touch. No schema change.
- 10 Brand-first: server/pipnet.ts 1253-1257. server/trl.ts 402-406. server/leasing-viewings.ts 373-374. shared/schema.ts 3116-3135. server/crm.ts 786-803. tenant-rep.tsx 71-78. shared/requirement-fit.ts 6-15. crm-options.ts 261-269. Schema: size_min and size_max integers, nullable. Optional tenant_rep_search_id.
- 11 Fit rule: shared/requirement-fit.ts 6-42. server/crm.ts 5196-5206, 5313-5345. server/routes.ts 9371-9467. server/property-gap-analysis.ts 522-537. server/ai-intelligence.ts 253-268. server/chatbgp.ts 16036. No schema change.
- 12 Small repairs: requirements.tsx 679-704, 1793, 2281-2333, 3664-3697. server/index.ts 4835-4905, 5103-5106. tenant-rep.tsx 444-457.
- 13 Phone: requirements.tsx 1036-1112. client/src/components/mobile-app.tsx 3795-3803, 4640-4651.

Picking up emails, chats and meetings
- 1 ChatBGP fix: server/chatbgp.ts 4054-4070, 4148-4165, 7679-7689, 7750-7763, 13304-13326, 13376-13386, 7019-7023, 2160-2175, 2323-2353, 2372. server/routes.ts 139, 368-371. server/mcp-server.ts 205-220. Template at server/landlord-chat-requirements.ts 67-90, 113-127. Client write allowlist at server/index.ts 4835-4836. No schema change.
- 2 Intake: precedent in server/letting-service.ts 263, 575, 780, 850. Doors to close: server/crm.ts 5434-5436, server/routes.ts 3895-3972, server/universal-ingest.ts 205-223, server/generic-crm-routes.ts 47, 61, server/sql-tools.ts 23-65.
- 3 Brand matching: server/viewing-sync.ts 191-216. server/brand-identity.ts 45-61. server/brand-news-relevance.ts 164-175. Name cleaners at server/news-brand-linking.ts 75-82, server/trl.ts 292-296, server/pipnet.ts 858-862. Unhide on re-add at server/routes.ts 6627 and server/brand-relevance.ts 157.
- 4 Viewings and offers: server/leasing-viewings.ts 359-383. server/viewing-sync.ts 206-216, 371. shared/schema.ts 1965-2038. requirements.tsx 477-485.
- 5 Team chat and Gossip: server/routes.ts 149, 195-215. server/gossip-channel.ts 13-78.
- 6 Transcripts: server/teams-notes.ts 34-45, 47-130, 134-151. server/index.ts 5284.
- 7 Email reader: server/interactions.ts 259-286, 358-362, 581, 1172-1217. server/viewing-sync.ts 575-588. server/insights-feed.ts 246-257, 286-290. Private mail guard at server/index.ts 34, 41 and server/private-mail-graph.ts 196-201. Do not source from server/archivist.ts 644-683, which uses different ids. The judged-email record goes in the evidence table or a small keys table, which is a schema change.
- 8 Circulars and PDFs: server/requirement-vision-parser.ts. server/chatbgp.ts 2327.
- 9 Manual routes: server/interactions.ts 1279-1289, 1339. server/news-intelligence.ts 93-121.
- 10 Status panel and back-fills: server/interactions.ts 1358. server/teams-notes.ts 134-136. server/archivist.ts 819-826. Pattern at server/letting-backfill.ts 1-25.
- 11 Anthropic only: server/utils/ai-provider.ts 12-16, 46-54. server/utils/anthropic-client.ts 13-27, 154-217. server/landsec-access.ts 32-38. server/api-usage.ts 29. Archive at server/archivist.ts 277. docs/landsec-pitch-plan.md 47.

News that drives requirements
- 1 Propel check: server/insights-feed.ts 46-47, 257, 329-333, 413-416. server/news-feeds.ts 76, 1584-1594.
- 2 Expanding list: server/leads.ts 64-74. shared/schema.ts 612-629. server/hunter-score.ts 245-252. server/routes.ts 6647-6676. No schema change.
- 3 Reader changes: server/news-brand-linking.ts 14, 26-49, 239-364, with reply limit at 264, prompt at 269, body cut at 272, item cap at 279, insert whitelist at 354, and 932-979. server/insights-feed.ts 292, 298-299. Do not change signal types read at server/hunter-score.ts 72, 206-212, 249-252, server/brand-openings-map.ts 62, 153, server/centre-openings.ts 86.
- 4 Cards from stories: uses the evidence table. Key on brand plus link, or publisher, subject and date.
- 5 Closure cards: server/brand-triggers.ts 50, 248-348, 298.
- 6 Sources: server/index.ts 1595-1596, 2876-2879. server/chatbgp.ts 233, 4920. server/auth-cookies.ts 21-28.

Across the app
- 1 and 2 Targets and fits: server/target-tenant-engine.ts 48-50, 72-76, 112-115, 146, 229-247, 295, 302, 438-445. server/crm.ts 5164-5290. server/account-teams.ts 36-67, 321-329. server/leasing-schedule.ts 1314-1395.
- 3 Brand page and score: server/expansion-intel.ts 62-66. server/hunter-score.ts 245-252. server/crm.ts 8659-8660, 8787, 8829-8849, 9237. server/brand-profile.ts 458-466. mobile-brand-view.tsx 444-447. server/brand-pack.ts 93-100, 490. server/brand-triggers.ts 40-45.
- 4 Landsec: server/crm.ts 5363-5392. server/company-scope.ts 146-171. shared/tenant-categories.ts 72-76. server/landsec-access.ts 97-114. server/landsec-unit.ts 185-190. server/crm-engagement.ts 281-291, 345. Read docs/landsec-pitch-plan.md first. Schema: one nullable share marker boolean on crm_requirements_leasing, default off.
- 5 ChatBGP and app map: server/chatbgp.ts 2160-2175, 7019-7023, 7105. server/chatbgp-app-map.ts 47, 51, 54, 100, 111, 148.
- 6 Weekly and digest: server/weekly-insights.ts 80-102. server/leads.ts 55-92. server/routes.ts 9893-9901. server/interactions.ts 1721-1732. Join on company id, shared/schema.ts 614, 1092.
- 7 Tidy and Agents: server/brand-relevance.ts 57-58, 80-82. server/client-agent-directory.ts 52-65. Leave server/viewing-sync.ts 206-216 and server/contact-verify.ts 72-76 alone.
- 8 Unit alert and deal loop: no requirement references in server/brand-triggers.ts, server/daily-briefing.ts, server/deal-stages.ts, server/letting-service.ts or server/crm-engagement.ts, by grep.
- 9 Investment parked: shared/schema.ts 1121-1154. server/investment-buyers.ts 66-80.

Standing rules that apply to every item: schema changes need the owner's OK. New tables need a boot statement or a listed file. No boot-time writes. Repairs are admin Preview then Apply. Convert chips, tabs and headers on touch. Update server/chatbgp-app-map.ts in the same commit as any navigation change.
```

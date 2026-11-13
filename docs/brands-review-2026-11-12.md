# Brand pages review against the Landlords pages and CRM tools (12 November 2026)

Woody asked: use the Landlords clean-up and the newer CRM tools to improve the
brand pages, and create a CRM strategy for brands, without losing Menu
highlights. Seven readers mapped the code and the screens, three proposers
drafted 40 suggestions, and each was checked against the code (36 sound with
changes, 4 sound, none dropped). Read-only: nothing here is built yet. File
references are as at commit 81b6953.

Woody said on 12 November that security and awareness items can be sorted
later, so L1 below is parked with the items in docs/landsec-review-2026-11-12.md.

```text
BRAND PAGES REVIEW FOR WOODY, 12 NOVEMBER 2026

How to read this
- The code was read at the current commit. Nothing was changed.
- Screens were viewed on the test database only, and its data is thin. Nobody saw a filled Menu highlights card.
- No Landsec login and no live app were used. Every point about what Landsec sees comes from reading code.
- I took "Landlords board" to mean the landlord profile page and the CRM page. That is where the October work sits. The Landlords list page itself was last changed on 27 September.
- Efforts are one developer's time. A day means about eight hours.


REVIEW: WHAT THE LANDLORD PAGES DO THAT THE BRAND PAGES DO NOT

What landlords have and brands lack
- The landlord page opens with sentences and numbers. You see About, "Portfolio we track" and "Working with BGP: 1 live deal, 1 contact". The brand card opens with buttons, chips and "Find stock ticker".
- The landlord page is one scroll with nothing hidden. The brand page shows one of five sections. It opens on Profile, which was blank on both test brands.
- Landlords have a written relationship brief second on the page. It is dated and ends in a highlighted "Next step". Brands have a shorter BGP take, and only inside the Profile section.
- Landlords have a Meetings card built from staff diaries. It shows a summary, the next two invitations and how many diaries were checked. Brands have nothing for meetings.
- Landlords have an Email threads card with a summary and two highlighted threads. On a brand, emails sit behind a small "1 email thread" link under About.
- Landlords have a BGP team board built from evidence. Each person shows email, invitation, deal and chat counts, with suggested roles to confirm. Brands have the older team chips and a free-text Lead.
- The CRM plan is third on the landlord page. On a brand it is inside the Relationship section, so most visits never show it.
- Landlords have a real deals list with filters. A brand has count pills and "Open deal" links only.
- Key contacts sit beside Company checks as a pair on landlords. On a brand both are in the fifth section. The desktop brand header has no covenant badge, though the phone has one.
- Landlords have one News and social board. Brands have three news lists across two sections, and the same headlines repeat.
- Landlord cards share one pattern. Each has a title with a count, a short summary, a fixed cap and "View all N". Empty blocks disappear. Brand pages draw empty boxes and leave half the page blank beside single cards.
- Landlords show Team planning notes from the Heads of Team interviews, and meeting history per contact. Brands show neither.
- The landlord conversation shows speaker names and photos. It refreshes the brief and picks up actions confirmed in chat. The brand conversation is the older version.

Already on brand pages, so not proposed again
- The CRM plan card: already exists on brands since 11 November.
- The combined Company checks card: already exists on brands since 2 November.
- The Key contacts board ranked by recent activity: already exists on brands.
- The plain-English covenant overview: already exists for brands, for staff.
- Being on a CRM plan already protects a brand from the tidy.

What the brand page does better and must keep
- Menu highlights and Best sellers, with the food switch and the staff Refresh. Landlords have nothing like it.
- The Stores board with its map and twelve-month change, and the Expansion score with its four bars and Signals.
- The pitching tools: Pitch property, Add to deal, Brand pack, Brand case, Suggested pitches and Pitched with evidence.
- The Instagram grid, follower counts, News and Media filters, and the Landsec "Your requests to BGP" view.


SUGGESTIONS: BRAND PAGE LAYOUT AND INFORMATION

Ranked. L1 to L6 are for before the pitch. L7 onwards waits.

L1. Close the places where a Landsec login can see BGP's own figures
- What changes: a Landsec login stops receiving the "BGP engagement" bar and the "Why this score" lines. Those lines count BGP deals, offers and viewings across all landlords. The same figures also show in the score badge hover text, on the phone brand page and on the Brand Hunter board. All four get fixed on the server.
- The BGP take is one saved text per brand, shared by staff and clients. It is written from all the brand's deals and names properties, BGP agents and the most-emailed person. The quick step is to send no take to a client login.
- Photo delete buttons show to everyone but only work for admins. Show them to admins only.
- Also found: the brand profile sends more to a Landsec browser than the screen draws. That includes tenancies with total rent at other landlords' schemes, BGP's stage, the Hunter flag, the saved email summary and BGP's rent comps. Tenancies are drawn on screen. The rest is sent but not shown. All should be stripped on the server.
- Asset managers can only read. The chat box and "Add request" cannot work for them, so hide both for that login.
- Why: the pitch promises Landsec that data is locked down.
- Effort: small, about 1 day for the score, the take and the delete buttons. A Landsec-safe take is 1 to 1.5 days more. The profile data strip and the asset manager changes were not costed in this review.
- Needs your OK: hiding the take reverses the 4 August decision that clients get it too. A client's score would show out of 75.

L2. Fix the two controls that do not work
- What changes: "Add agent" in Key contacts opens a form drawn only inside the hidden Intel section. The fix switches to Intel first. "Email history" on a brand contact is refused by the server with "landlords only". There are two entry points, the email count link and the menu item. Hide both on brands for now.
- Why: both will be pressed in a demo.
- Effort: small, 1 to 2 hours. Neither fault was pressed, both were read from code.

L3. Stop the page opening on an empty section
- What changes: the first pill is renamed Overview. It holds the BGP take, the CRM plan, Menu highlights or Best sellers, and the cover photos. Menu highlights moves from the fifth section to the first screen. It sits in a two-column row so it does not stretch across the page. The phone card moves from Intel to Overview in the same change, so both screens agree.
- The menu card is mounted once only. Staff still see it when empty so they can press Refresh. Clients still see it only when it has items.
- Staff who are not on a BGP email address would see "plan could not be loaded" first. The landlord page already guards against this. The brand page gets the same check.
- ChatBGP's directions are updated in the same change. They are already out of date.
- Why: this is the change that protects Menu highlights and gets the CRM plan seen.
- Effort: small, about half a day including checks on a full brand, a thin brand and a Landsec login.
- Needs your OK: this keeps the pills, as you decided on 11 November.

L4. Make the first card read like the landlord's
- What changes: the facts already under About get a "Working with BGP" heading and move above the About text. They are lead, last touch, email threads, live and completed deals, and requirements. A contacts count is added.
- The duplicate "Add contact" goes. "Refresh contacts" moves to the Key contacts strip. It is not a duplicate, because it runs the paid people search. Invoicing controls move there too. Call, Email, Add to deal and Pitch property stay.
- Why: the page opens with facts and not controls. That is the main reason the landlord card reads better.
- Effort: small, 4 to 6 hours. A landlord test pins one line here and needs updating.
- Needs your OK: the profile is not filtered by scheme for asset managers. I recommend the new numbers stay staff only until it is.

L5. Stop drawing empty boxes and repeats
- What changes: the Expansion card hides when it has nothing. The untitled Relationship box hides for clients when empty. A lone card spans the full width. The Hunter flag shows once. The parent group shows once, not twice. The empty CRM plan shows one line, not three, on brands only. An unused lookup on every page open is switched off.
- Company checks stays visible to Landsec, as decided on 1 August. It could open by default for them, because the summary on top is staff only.
- Why: thin brands are most brands, and empty boxes are most of their clutter.
- Effort: medium, 6 to 8 hours.

L6. Email threads card on the brand Overview, for staff
- What changes: the landlord Email threads card is mounted on brands with brand wording. It shows the two latest threads. The summary loads when asked for, not on every page view.
- Why: staff get the same "what is going on" read from data already held.
- Effort: small, 3 to 4 hours. The fuller landlord-style summary would be about a day.
- Limits: staff only. A brand with no website domain shows no emails.

L7. Re-cut the pills so each answers one question
- What changes: six pills. Overview, Deals and space, Stores and menu, Expansion, People and checks, News and media. Each shows a count where the page knows it. The page opens on the first pill with content. The chosen pill is kept in the address so links can land on it.
- Why: today's names do not match their contents. Covenant, menu and news all sit under "Contacts and media".
- Effort: medium, 8 to 10 hours.
- Needs your OK: page shape. The design standard document says desktop shows everything, which your 11 November decision overrode. The document should be updated.

L8. Deals and space, with a real deals list
- What changes: a brand deals card showing the 20 most recent deals with role, property, stage and last update. Beside it sit live tenancies, lease events, space preferences, viewings with follow-up date and next action, BGP requirements and PIPnet.
- The landlord deals board cannot simply be switched on. It would drop ordinary lettings where the brand is only the tenant. It would also pull in sister brands' deals.
- Why: a brand has no deals list today.
- Effort: medium, 10 to 12 hours.
- Needs your OK: whether Landsec sees the list for its own deals, or staff only.

L9. People and checks as a pair
- What changes: Key contacts beside Company checks, as on landlords. "Currently representing" moves under Tenant rep, so all agent facts are together. The covenant grade badge goes in the desktop header.
- Group entities and Billing stay as they are for now. A 2 November test deliberately keeps them off the brand card.
- Effort: medium, 6 to 8 hours.

L10. Expansion as a pair
- What changes: the score card on the left with one Refresh menu. Signals and the competitor set on the right. Department store and franchise notes move here. The "none on PIPnet" filler goes.
- Effort: small to medium, 5 to 7 hours.

L11. One News and social board
- What changes: News and Media on the left, social tabs with the Instagram grid on the right. Stories already in Signals are left out. Documents and gallery stay as one full-width card.
- This cannot be done by switching on landlord mode. That would remove the Instagram grid and the openings and jobs feeds.
- Effort: medium, 8 to 10 hours.

L12. Menu teaser on the first card, full card in Stores and menu
- What changes: at the re-cut, the first card gains a "What they sell" line of three or four items with "Show all N". The full card moves to Stores and menu.
- Effort: small, 4 to 5 hours. Check it against a real brand with a long menu.

L13. One card pattern everywhere
- What changes: every brand card gets the standard small uppercase title with a count, a short summary, a cap and "Show all N". Each card keeps its own small Refresh, because each does a different job at a different cost.
- Effort: medium, 8 to 10 hours, done alongside L7 to L11.

L14. Phone brought into line
- What changes: the same six sections in the same order, the combined Company checks card, and the brand deals card. The phone-only "BGP engagement" and "Tracker updates" cards are kept.
- Effort: medium to large, 12 to 16 hours. Do it after the desktop re-cut. The phone view is shared with landlords, agents, lenders and the deal page.

L15. Smaller gaps, not costed
- The brand conversation could take the landlord upgrades: named speakers, photos and actions confirmed in chat.
- The Brand pack PDF has no menu items. If Menu highlights matters to the brand case, it should be in the PDF.
- Turnover, rent affordability and rent comps are loaded but never drawn on desktop. Draw them for staff or stop sending them.
- The landlord Team view is not needed on brands. The deals card covers it.


SUGGESTIONS: A CRM STRATEGY FOR BRANDS

What a brand strategy is in practice. It is four facts per brand: a named lead, a stage, an aim, and a dated next step. The team runs three or four group strategies. Each brand joins one with a one-sentence reason. The stage says where BGP stands with the brand. The next step is one CRM action with an owner and a due date, which also appears in My Tasks. That is small enough to keep up, and it gives the brands list something to sort by.

What works today, with no database change
- A brand can be on a strategy, an event and an action. The plan card is on the brand page and the phone.
- The stage field exists with five values. Nothing on screen shows it.
- Roles per person exist, including "Relationship lead".
- Viewing follow-up dates and tenant-rep next actions are recorded, but not shown on the brand page.

What Landsec logins see
- Today: only "Your requests to BGP", the actions their own company raised. Nothing changes there.
- They would not see: the strategy line, stage, lead, kind, emails, meetings, the brief or the brands table.
- Showing them a chosen BGP action needs a share marker that names the client. That is a database change.
- Asset managers can only read, so they cannot add a request.

Ranked suggestions

C1. Dress five demo brands before the pitch. No code.
- What changes: for each brand, confirm the website and core facts first, or the BGP take stays blank. Add the first CRM action on the brand's own page, then the strategy. Press the menu and stores refreshes by hand.
- A Landsec login will not see the strategy. If the demo runs from a Landsec login, raise one or two requests from it.
- Check each brand is in Landsec's slice. Do not use the test login for paid refreshes.
- Effort: small, 3 to 4 hours of a staff member's time.

C2. Make the CRM page work for brands
- What changes: "Landlord", "All landlords" and "Choose landlord" become your chosen wording. A Landlords, Brands, All switch is added. "Open full plan" from a brand page lands on a form that can pick that brand. Hidden brands stop appearing in the pickers. Staff get a "Start strategy" button on the brand card.
- Why: on the test data a brand's four actions sit under a filter labelled "Landlord". A brand with nothing planned cannot be picked on the CRM page today.
- Effort: small, about 1 day. Type-to-search for any brand in the forms is about 1 day more.
- No database change. Clients are unaffected.

C3. A one-line strategy strip on every brand
- What changes: one staff-only line on the Overview. Lead, stage, aim, next step. The stage is a dropdown. The lead shows "No lead set" unless someone holds the Relationship lead role. The aim is the brand's reason on its strategy. The next step is the earliest open action.
- The stage is removed from what Landsec logins receive, and only the five values can be saved.
- The "Concept pitch" field is editable today but shown nowhere. It could become the aim.
- Effort: medium, about 1.5 days. No database change. Depends on C2.
- Needs your OK: the stage names, and the first three or four strategies.

C4. The working list: a brands table with the plan on it
- See B2 below. This is the team lead's view of the strategy.

C5. Show the brand case to staff on the brand page
- What changes: a line such as "Brand case sent, 4 supportive, 1 concerns", with a link. Staff outside the Landsec view have no link to the case today.
- Effort: small, 2 to 3 hours. No database change.

C6. One list of next steps
- What changes: viewing follow-ups and tenant-rep next actions appear beside the CRM actions, for staff. Stored alerts show as prompts with "Make CRM action". Stored alerts are insolvency, fundraise and executive change.
- Hot and cooling alerts are emailed but not kept, so they cannot be listed yet.
- Effort: medium, 7 to 9 hours. No database change.

C7. Three kinds of brand
- What changes: a staff-only label. BGP acts for them, hunting, or tenant only. Each kind orders the page a little differently.
- The "acts for" test should lean on the tenant-rep board. The deal field for which side BGP acted is not yet reliable, and that rule is still parked for your review.
- Effort: medium, 6 to 8 hours. No database change.

C8. A records-based relationship brief for brands
- What changes: the landlord brief, rewritten for brands. It reads tenant deals, tenancies, target units, the CRM plan and recent emails. It ends in a next step. It sits beside the BGP take and does not replace it.
- Today the brand take, the fortnightly digest, the alert emails and the Brand pack do not read the CRM plan at all.
- Effort: large, 2 to 3 days. Staff only. No database change.

C9. BGP team board with one named lead
- What changes: the landlord team board on brands, with role rules rewritten. An agent who let a unit to the brand for a landlord must not be labelled as acting for the brand.
- Clients keep the team chips they see today.
- Effort: medium, 8 to 12 hours. Depends on C11 and C10.

C10. Meetings for brands
- What changes: diary invitations and the meeting summary for a short list of brands.
- Brand meetings are not in the saved diary data at all. A fresh scan of staff diaries is needed. The matching code stalled the server on 2 November, so this is the riskiest item.
- Effort: large, 12 to 16 hours plus the re-scan and a live check. No database change.
- Needs your OK: which brands, and whether summaries must use Anthropic only. Today they can go to another provider.

C11. Make "Email history" per person work on brands
- What changes: the links hidden in L2 come back working.
- Effort: medium, about 1 day.

C12. Team planning notes on brand pages
- What changes: interview answers naming a brand appear on its page as suggestions to confirm.
- Short names such as Pret, Leon and Itsu cannot match under today's rule. Names like Boots would match wrongly.
- Effort: medium, 5 to 7 hours. No database change.

C13. The parts that do need a database change
- A priority tier per brand. There is none today.
- A unit or deal link on a CRM action. Today an action cannot say which unit it is about.
- A share marker naming one client, so a chosen BGP action can be shown to Landsec only.
- Effort: tier and unit link, 10 to 14 hours together. Share marker, 10 to 14 hours.
- Needs your OK: all three. Everything above runs without them.


SUGGESTIONS: THE BRANDS LIST

B1. Fix the dead links and wrong numbers
- "All Brands" and Super Brands "Show all" go to a CRM tab that does not exist. Staff land on the CRM overview. Landsec lands on Agents. Point both at Brand Explorer.
- "Show all" on Turnover Leaders does nothing. The hub tabs should follow the address, as the CRM page does.
- The "Categories" tile is a fixed number. Replace it with "Brands on a CRM plan", for staff only.
- Hidden brands still appear in Super Brands, Turnover Leaders and Brand Hunter. That undoes the tidy.
- With "Hidden" selected, the count shows the visible total.
- Effort: small, 3 to 5 hours. Read from code, not clicked.

B2. A table view in Brand Explorer, with the plan on it
- What changes: a Table and Cards switch for staff on desktop. Sortable columns for lead, stage, open CRM actions, next action date, live deals, contacts, stores and targets. Counts on the relationship pills. A stage filter. The chosen pill is remembered.
- "Last touch" cannot match the brand page. That figure is too slow to work out for about 1,900 brands. The column would be "Last logged contact", or left out at first.
- The target count needs a new full count. Today's stops at eight per brand.
- Why: neither list shows who owns a brand or what happens next. This is the screen that makes the strategy usable.
- Effort: large, 2 to 3 days. No database change. Staff only.
- Needs your OK: the columns, and whether this replaces the idea of a Brands tab on the CRM page. I recommend it does.

B3. Tidy the hub to the standard
- What changes: tiles in one style, standard colours for chips and icons, and one logo component in place of three.
- Effort: small, about half a day.

B4. Speed
- The Explorer loads every company and draws every tile at once. The table should show about 50 rows at a time.
- Not costed beyond the table.

Not reviewed: the Brand Hunter and Turnover Board tabs. The Hunter scoring legend may be out of date.


KEEP LIST

Every brand feature stays. "Now" means after L3. "Later" means after the re-cut in L7.

- Menu highlights and Best sellers, with the food switch, staff Refresh and the client rule: Overview now. Stores and menu later, with a teaser on the first card.
- Stores board and map: Stores now. Stores and menu later.
- Cover photo strip: Overview.
- BGP take: Overview.
- Brand conversation with its brand starter questions: top of the page, beside the first card.
- CRM plan, including Landsec's "Your requests to BGP": Overview.
- Rollout badge, Hunter pick, Brand pack, Brand case, Pitch property, Add to deal, Call, Email: the first card.
- Backers with Create, Instagram and TikTok follower counts, stock card and ticker picker: the first card.
- Lead, last touch, email threads, deal counts, Tenant at, Targeted, Pitched and Suggested pitches: the first card, under "Working with BGP".
- Live tenancies with "building for sale", lease events, viewing activity: Relationship now. Deals and space later.
- Space preferences: Relationship now. Deals and space later.
- Group and sibling brands: on the "Part of" line.
- BGP requirements and PIPnet: Intel now. Deals and space later.
- Expansion score, four bars, why-lines, previous research: Intel now. Expansion later.
- Signals with Log intel: Intel now. Expansion later.
- Competitor set with Research: Relationship now. Expansion later.
- Department store and franchise notes: the first card now. Expansion later.
- Key contacts, Tenant rep, Add contact: Contacts and media now. People and checks later.
- Currently representing, with its add form: Intel now. People and checks later.
- Company checks with covenant grade, covenant verdict and KYC, visible to Landsec: Contacts and media now. People and checks later.
- News and Media with Industry and Press tabs and filters: Contacts and media now. News and media later.
- Brand feed with Instagram grid and "Follow brand channels": the same.
- Documents link, gallery, lightbox and cover choice: the same, as one full-width card.
- Group entities KYC card: above the first card, unchanged.
- Phone-only "BGP engagement" and "Tracker updates": kept on the phone. People and checks, and Deals and space, later.
- Brand Explorer: category tiles, Market View, news grid, phone search, Landsec "Add brand", Tidy and Hidden. Unchanged.
- Brand Hunter and Turnover Board: unchanged.


ORDER OF WORK

There are six working days before the week of 23 November. This list fills them. It does not allow for the Landsec pitch build, which I did not weigh.

Before the pitch, in order
1. L1, close the Landsec exposures. About 1 day.
2. L2, fix the two dead controls. 1 to 2 hours.
3. B1, fix the hub links and hidden brands. 3 to 5 hours.
4. L5, stop empty boxes and repeats. 6 to 8 hours.
5. C2, CRM page wording and brand picking. About 1 day.
6. L3, Overview first with Menu highlights and the CRM plan. Half a day.
7. L4, "Working with BGP" on the first card. 4 to 6 hours.
8. C1, dress five demo brands. 3 to 4 hours of staff time, after steps 1 to 7 are live.
9. C3, the strategy strip. 1.5 days.
10. L6, Email threads card for staff. 3 to 4 hours.

Total: about 6 developer days, plus half a day of staff time. Steps 1 to 7 are about 4 days and are the safe core. Steps 9 and 10 leave no slack. Drop them first if time runs short.

If time allows, otherwise first after the pitch
- C5, brand case line. 2 to 3 hours.
- B2, the brands table. 2 to 3 days.

What waits until after the pitch
- Layout: L7 to L14. About 8 to 10 days in total.
- CRM: C6 to C13. About 11 to 14 days in total, plus a diary re-scan.
- B3, B4, L15 and the uncosted parts of L1.


DECISIONS FOR YOU

1. Did "Landlords board" mean the landlord profile page and the CRM page? I assumed yes.
2. Page shape: pills with Overview first, one long scroll like landlords, or brief and plan fixed above the pills? I recommend the first.
3. For the pitch: hide the BGP take from Landsec logins, or spend 1 to 1.5 days on a Landsec-safe copy?
4. Should Landsec see the "Why this score" lines? I recommend no.
5. Should a Landsec login see a brand's tenancies and rent at other landlords' schemes? Today it does. I recommend own schemes only.
6. Confirm the saved email summary, stage, Hunter flag and rent comps are removed from what Landsec receives.
7. Asset managers: keep new figures staff only until they are filtered by scheme? I recommend yes.
8. Should Landsec see a brand's deals list for its own deals, or staff only?
9. Is a brand strategy the four facts: lead, stage, aim, next step?
10. Stage names: Watching, Pitching, Parked, Won, Lost. Keep or rename?
11. Should Parked and Lost brands be open to the brand tidy? Today they are.
12. Is the lead the person with the Relationship lead role? Is one lead compulsory for a brand on a strategy?
13. CRM page wording: "Company" or "Landlord or brand"?
14. Working list: a table in Brand Explorer, or a Brands tab on the CRM page? I recommend the table.
15. Table columns: include fee income per brand for staff? Is "Last logged contact" acceptable?
16. Call and Email on the brand card: keep, or drop as landlords did? I recommend keep.
17. Group entities and Billing inside brand Company checks: yes, or leave? I recommend leave.
18. Which five brands for the demo, and shown from a staff login or a Landsec login?
19. New fields: approve, defer or refuse each of priority tier, unit link on an action, and client share marker.
20. Brand meetings after the pitch: worth a diary re-scan? Which brands? Anthropic only for summaries?
21. Records brief on brands: show it beside the BGP take, or replace the take? I recommend beside.
22. Planning notes on brand pages as suggestions to confirm: yes or no?
23. Three kinds of brand: confirm. Does the tenant-rep board alone count as "BGP acts for them"?


FILE REFERENCES FOR THE DEVELOPER

Root: /home/user/bgp-wip-app. All paths below are relative to it.
P = client/src/components/brand-profile-panel.tsx. MBV = client/src/components/mobile-brand-view.tsx. BP = server/brand-profile.ts.
Line numbers are from the reader maps at 81b6953 and the checkers at HEAD ad9abba, which did not touch these files. One exception: the app map pill line is at server/chatbgp-app-map.ts:95 at HEAD, where the checkers cite 94. I did not re-read the code myself in this pass. Items the checkers marked "read from code, not run" are still unrun.

Review section
- Landlord branch and order: P:2362-2413. Glance block: P:2274-2337. Top row: P:2341-2360.
- Landlord brief composition: P:2371-2378; client/src/components/bgp-take-strip.tsx:37, 45, 90, 97, 108-109.
- Meetings card: client/src/components/landlord-meetings-summary.tsx:67, 83, 99, 113-134. Server gate: server/landlord-meetings.ts:447-448.
- Email card: client/src/components/landlord-email-summary.tsx:18-52. Brand link today: P:1647-1667.
- Team board: client/src/components/landlord-relationship-team.tsx:21-99; server/landlord-relationship-team.ts:125. Brand chips and Lead: P:1630-1657.
- CRM plan mounts: P:2379 landlord, P:2647 brand, MBV:251-252.
- Deals board landlord-only: P:2381, P:2802; client/src/components/account-deals-board.tsx:227-329.
- Contacts beside checks: P:2383-2388 landlord; P:5581-5587 brand. Phone covenant badge: MBV:187.
- News: P:2399, P:5692-5913; client/src/components/brand-feed-card.tsx:93-226.
- Planning notes and meeting history: client/src/components/landlord-engagement-panel.tsx:105; P:5581.
- Conversation switch: P:1622, 4777-4799, 5129; client/src/components/landlord-chat-bubble.tsx.
- Brand pills, one section at a time: P:868-872, 2504-2510. Profile pill contents: P:2514-2601.
- History of the landlord work: commits fe6b3ff, 8e3fced, 5628413, fae5791, fbc994d, 278af0b, 513c4cd, 81a5ea4, edeb7e5, 6420da4. Landlords list last change f49eb22 on 27 Sep; client/src/pages/people.tsx last change 8ec93f9 on 28 Oct.
- Screenshots: /tmp/claude-0/-home-user/4c454855-b3ac-5dd1-9467-1529a6518a24/scratchpad/brandreview/screens/out/desktop-landlord-landsec.png, /tmp/claude-0/-home-user/4c454855-b3ac-5dd1-9467-1529a6518a24/scratchpad/brandreview/screens/out/desktop-brand-starbucks-fold.png, /tmp/claude-0/-home-user/4c454855-b3ac-5dd1-9467-1529a6518a24/scratchpad/brandreview/screens/out/desktop-brand-starbucks-brand-section-more.png, /tmp/claude-0/-home-user/4c454855-b3ac-5dd1-9467-1529a6518a24/scratchpad/brandreview/screens/out/desktop-brand-testco-brand-section-relationship.png, /tmp/claude-0/-home-user/4c454855-b3ac-5dd1-9467-1529a6518a24/scratchpad/brandreview/screens/out/desktop-brands-hub.png, /tmp/claude-0/-home-user/4c454855-b3ac-5dd1-9467-1529a6518a24/scratchpad/brandreview/screens/out/desktop-brands-explorer.png, /tmp/claude-0/-home-user/4c454855-b3ac-5dd1-9467-1529a6518a24/scratchpad/brandreview/screens/tiles/desktop-crm-overview-t1.png

L1. Close the Landsec exposures
- Score route with no viewer check: server/brand-ai-take.ts:557-566. Firm-wide lines: server/hunter-score.ts:245, 248, 256-263; server/expansion-intel.ts:58-114.
- Drawn without a client gate: P:2939-2980; badge hover P:2881; phone bar MBV:434-436; Hunter board server/crm.ts:8875-8878, 9027-9040; client/src/components/brand-hunter-board.tsx:338; client/src/pages/brands-hub.tsx:190-193.
- Take: server/brand-ai-take.ts:72-76, 84-106, 113-117, 329, 451-452, 467, 522-524, 540. Parity comment P:2532-2535. Client gateway server/index.ts:5132-5139.
- Delete buttons: P:6039-6050, 6110-6119; server/image-studio.ts:2290.
- Profile payload: live tenancies with total rent BP:557-571, 1193, drawn P:2662-2687; whole company row BP:310-322, 1167; rent comps BP:636-647, 1276-1296; saved email summary written at server/brand-email-threads.ts:308.
- Asset managers: client/src/App.tsx:301; server/landsec-access.ts:102, 114; no scheme filter BP:405-407, 475, 759; docs/landsec-review-2026-11-12.md:57, 132; docs/landsec-pitch-plan.md:182.

L2. Fix the two dead controls
- Add agent: button P:5417-5418; handler P:875-883; form P:1867-2016, drawn only at P:3040; hidden sections P:872; docs/landsec-review-2026-11-12.md item 2.10.
- Email history: P:5550, 5581; client/src/components/company-contacts-board.tsx:118-122, 249, 267; server/brand-email-threads.ts:21-33, 159, 163-164, 254; server/landlord-activity-person.ts:7-9, 22-28.

L3. Overview first
- First section: P:2514-2601; take P:2539; cover strip P:2554; Part of P:2582-2591. Grid opens P:2635.
- Menu card: P:3380-3496; heading rule P:3401-3406; client rule P:3425-3427; sidebar mount P:5600-5609; phone mount MBV:554-563.
- CRM plan BGP-email check: P:2379 against P:2647; server/crm-engagement.ts:97-101, 308-316.
- Pills: P:2505-2509. App map: server/chatbgp-app-map.ts:94-95.

L4. Working with BGP on the first card
- Existing block: P:1626-1671, 4682-4717, placed at P:1860; deal counts P:1446-1447.
- Buttons: P:1600-1613; Refresh contacts P:895-916, 1605; board refresh client/src/components/company-contacts-board.tsx:431-433, 689-697; invoicing P:1608, 5583; client/src/components/company-invoicing-controls.tsx:27-28, 61, 76-78.
- Test pin: qa/regression/landlord-profile-ui.test.mjs:92. Deal page uses the panel: client/src/components/deal-detail.tsx:1294-1295.

L5. Empty boxes and repeats
- Relationship box P:2648; competitor empty state P:3215-3222; Expansion card P:2863, 2020, 3096-3097; grid P:436-505, 474; full-width marker P:2647-2648.
- Parent group P:2488, 2582-2591, 2752-2782. Hunter flag P:1513, 2886. Unused fetch P:1400-1417, 945, 2810.
- Company checks for clients P:4140-4150. Empty plan sentences client/src/components/landlord-engagement-panel.tsx:64, 78, 96.

L6. Email threads card for staff
- client/src/components/landlord-email-summary.tsx:15-55; server/brand-email-threads.ts:17-18, 150-166, 224, 256-275, 287-293; client/src/components/brand-email-history.tsx:39-46; P:1661-1666, 2373-2376.

L7. Re-cut the pills
- P:868-872, 2504-2510, 2635-2636, 2856, 3047; page data for counts P:1426-1456; own loads client/src/components/brand-viewing-activity.tsx:10-14, P:3078-3086, client/src/components/brand-feed-card.tsx:91-95.
- Pinned phone ids: qa/regression/phone-property-brand.test.mjs:119-120; qa/phone-session-smoke.mjs:130. docs/DESIGN.md:125-126, 231-235.

L8. Deals and space
- Why the landlord board fails for brands: server/account-resolver.ts:394-422, 453-488, 499, 585-587; server/account-deals.ts:190-200.
- Profile deal rows: BP:403-407, 654-669, 1183-1187, 1286-1288; P:1441-1453, 1476.
- Viewings: shared/viewing-workflow.ts:31-32; client/src/components/brand-viewing-activity.tsx:26-47. Lease events BP:755-761; P:2695-2719. Space preferences P:2723-2749. Requirements P:2994-3027. PIPnet P:3077-3133.

L9. People and checks
- P:2383-2388, 5402-5436, 5581-5587, 4112-4172; qa/regression/landlord-company-checks.test.mjs:50-62; client/src/components/account-entities-panel.tsx:187-192; client/src/pages/companies.tsx:1375-1376.

L10. Expansion
- P:2863-2991, 2017-2150, 3035, 2788-2796, 3152-3335, 1826-1841, 3093-3108.

L11. News and social
- client/src/components/brand-feed-card.tsx:96-105, 114, 132, 178-180, 203-222; server/landlord-news.ts:92-94; P:5692-5959, 5995-6001.

L12. Menu teaser
- P:3381-3496, 5600-5609, 2603, 5476-5484; MBV:555, 647-648.

L13. One card pattern
- client/src/components/landlord-activity-card.tsx:5-17; docs/DESIGN.md:47-48, 127-129, 153-154, 216-217; P:3432, 4135, 2701, 3008, 2804; client/src/components/company-contacts-board.tsx:688; client/src/components/bgp-take-strip.tsx:108.

L14. Phone
- MBV:64, 77-82, 131, 179, 198-209, 246-258, 310, 315-384, 389-412, 486, 554-563, 647-699.

L15. Smaller gaps
- Chat: P:1622, 4741-4799, 5129. Brand pack: server/brand-pack.ts. Fetched not drawn: P:1448-1454. Pill state: P:868. Team view: P:2382.

C1. Dress five demo brands
- server/crm-engagement.ts:186-195, 281-287, 329-336; client/src/components/crm-engagement/overview.tsx:92-93; server/brand-ai-take.ts:465-466; P:3425-3427; docs/landsec-review-2026-11-12.md item 2.12.

C2. CRM page for brands
- Wording: client/src/components/crm-engagement/overview.tsx:166, 188, 199; client/src/components/crm-engagement/dialogs.tsx:38-44, 53, 77, 92, 94, 126; server/crm-engagement.ts:57, 65, 76, 111, 121, 245-246.
- Picker: server/crm-engagement.ts:107, 186-199, 321-327; overview.tsx:76, 92-93; shared/landlord-engagement-view.ts:40-42. Card buttons: client/src/components/landlord-engagement-panel.tsx:54-57. Tabs: client/src/pages/people.tsx:1169-1181. docs/landsec-review-2026-11-12.md items 2.15, 2.17, line 181.

C3. Strategy strip
- Stage: shared/schema.ts:516; BP:317, 1166-1167, 1302-1322, 1344, 1361-1369; P:106; server/brand-relevance.ts:62-67. Client write block: server/index.ts:4835-4856, 5103-5106.
- Lead: shared/bgp-account-roles.ts:5-13; P:1651, 4023-4068; BP:890-917.
- Aim and next step: client/src/components/landlord-engagement-panel.tsx:99; shared/landlord-engagement-view.ts:22-24. Concept pitch: P:94, 1485, 2166-2172.

C5. Brand case line
- server/landsec-access.ts:73-85; server/landsec-brand-case.ts:28-31, 79-109; shared/schema.ts:3983-4012; P:940-941, 1520-1524.

C6. One list of next steps
- shared/viewing-workflow.ts:31-32; shared/schema.ts:3116-3135; server/routes.ts:10542-10561; server/brand-triggers.ts:96-102, 249-262, 276-295, 302, 320, 341, 507-509; client/src/components/landlord-engagement-panel.tsx:39, 105-108.

C7. Three kinds of brand
- server/target-tenant-engine.ts:153-158; shared/schema.ts:905, 594-606; shared/letting-rules.ts:97-104; server/crm.ts:8626-8663.

C8. Records brief for brands
- server/landlord-relationship-brief.ts:7-14, 36-37, 48-93, 102-137, 187-244; server/brand-ai-take.ts:45-79, 169-259, 330-344, 525-534. Plan tables read only by server/crm-engagement.ts, server/landlord-relationship-brief.ts, server/brand-relevance.ts, server/index.ts.

C9. BGP team board
- server/landlord-relationship-team.ts:9-12, 86-98, 125-148, 156, 177; shared/landlord-relationship-team.ts:1; shared/bgp-account-roles.ts:5-13; server/index.ts:1010-1025; P:1634-1642.

C10. Meetings for brands
- server/landlord-meeting-matching.ts:13-19, 42-48, 55-63, 83-112; server/landlord-meetings.ts:42-48, 104-105, 289, 306-312, 447-450; server/interactions.ts:427; server/landlord-meeting-summary.ts:20-47, 131-145, 185; client/src/components/landlord-weekly-meetings.tsx:23, 59.

C11. Per-person email history on brands
- As L2, plus server/brand-email-threads.ts:43, 160-166.

C12. Planning notes for brands
- shared/crm-interview-questions.ts:15-16; server/landlord-interview-links.ts:27-28, 60-68; server/landlord-meeting-matching.ts:42-44, 63, 83, 124-133; server/crm-engagement.ts:253-256; client/src/components/landlord-engagement-panel.tsx:18-21, 105; client/src/components/crm-meetings-tab.tsx:259-265.

C13. Database changes
- server/crm-engagement.ts:13-49, 64, 275-287, 304-322, 343-345, 354; server/index.ts:620; shared/schema.ts:506, 2116-2133; BP:1309-1311. Migrations go in the boot list, not drizzle.

B1. Hub links and numbers
- client/src/pages/brands-hub.tsx:183-189, 276, 316, 343, 436, 840-850, 1120-1123; client/src/pages/people.tsx:1764-1778; server/crm.ts:8754-8766, 8800-8820, 8889-8894.

B2. Brands table
- client/src/pages/brands-hub.tsx:706, 714-721, 733, 840-855, 1085-1102, 1126-1166; server/crm.ts:8626-8668, 1928-1929; server/storage.ts:795; server/crm-engagement.ts:41-46, 146-186; server/brand-profile-suggestions.ts:69-82; shared/schema.ts:565-566; server/activity-routes.ts:200. Patterns: client/src/pages/landlords.tsx:108-115, 255-261, 374; client/src/pages/people.tsx:150-152, 320-325, 1897-1899.

B3. Hub tidy
- client/src/pages/brands-hub.tsx:129, 308-325, 370, 386, 465, 529, 979-981, 1141-1154, 1361; client/src/components/brand-hunter-board.tsx:66-88, 125, 217-219, 247-257, 424-465.

B4. Speed
- client/src/pages/brands-hub.tsx:708, 714-721, 1127; server/storage.ts:795.
```

## Live observations (12 November 2026, the real Wingstop page on the live app, staff view, 1440 wide)

Added by the lead after looking at the live app. Screenshots of the page as it is today, with real data, are in
/tmp/claude-0/-home-user/4c454855-b3ac-5dd1-9467-1529a6518a24/scratchpad/brandpage/live-reference/
(tall-wingstop-overview.png, tall-wingstop-stores.png, tall-wingstop-relationship.png, tall-wingstop-intel.png,
tall-wingstop-more.png, and first screens for Flat Iron, Jersey Mike's and Starbucks). Open them: they show what a
full, real brand looks like, which the thin local test data does not.

What a real brand's page shows today, and what the re-layout must fix:

- The top block is about 690px tall before the pill row, so on a 900px screen the pills and every card under them
  are below the fold. The profile card is a long stack: "Official profile prepared · Updated · Details"; "Website
  wingstop.co.uk · Change"; "Review saved facts"; a Details strip; Email / Add to deal / Pitch property; Working with
  BGP (last touch, 1 requirement, 5 contacts, 1 email thread); BGP team; Tenant at (1); Targeted (1); Suggested
  pitches (6, two shown, each a two-line box); About (three lines, Read more); Backers (two, each with a
  description); the Instagram handle; "Find stock ticker".
- Beside it the Brand conversation card is the same height and almost entirely blank: about 570px of empty space
  above the "Ask ChatBGP" chips and the input. It has two tabs, Chat and Tracker (1).
- The header has only Back, a letter placeholder where the logo should be, the name, the category chip, Edit and
  Delete. The actions an agent uses are inside the card.
- Real content is good once reached and must be kept: the BGP take with dated Demand / Recent activity / BGP
  relationship lines and a highlighted Next step; Menu highlights with six priced items and a Source link; a cover
  photo strip; Expansion intelligence with the score, four bars, BGP requirements, PIPnet and ten signals; Key
  contacts (five, with roles); Company checks with the covenant grade "A · 100/100" and a plain-English verdict; the
  Brand feed "What's new"; a nine-photo Instagram grid; News and media with source filter chips; Documents and gallery.
- Real lists are longer than the test data: plan for 6 or more suggested pitches, 2 or more backers, 10 signals,
  9 news items, 5 or more contacts. Compact, counted, capped lines with "Show all N" matter.
- The Intel pill holds one card and leaves the rest of the screen empty; Contacts and media holds seven cards.
- Speed (measured on the live app): the page shows a grey loading skeleton for 10 to 15 seconds before anything
  appears. Calls that took over 4 seconds: /api/brand/<id>/profile 8.6 to 9.6s; /api/brand/<id>/hunter-score 5 to 7s;
  /api/crm/companies (the whole company list) 4 to 6s; /api/brand/<id>/contacts-cascade 19 to 22s. The re-layout
  should not make this worse: the header and summary band should draw as soon as the profile arrives, and nothing in
  the first screen should wait on hunter-score, the full company list or contacts-cascade. A dedicated speed pass
  follows this build.

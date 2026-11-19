# Leasing requirements board review, 19 November 2026

Woody, 19 November 2026: "Can you look at the leasing requirements board it's
old and I think isn't that well set up or linked to the rest of the app?"

The board is the **Requirements** pill on Brands (`/brands?tab=requirements`,
`client/src/pages/requirements.tsx`, Leasing view). I looked at it on live as
BGP staff on a computer and a phone, read every requirement row through the
read-only test login, and read the code. Nothing was changed or sent. Nothing
here is built until Woody approves.

The 12 November work (`docs/requirements-review-2026-11-12.md`) fixed what a
requirement **means**: who confirmed it and when, and the rule that a machine
only ever suggests. It left the board's **shape** as it was: a wide
spreadsheet of rows with an editor in every cell. This review is about that
shape and its links.

## The short answer

The board is a feed of PIPnet listings laid out as an old spreadsheet.

- Of 211 requirements on live, 210 are PIPnet listings that nobody at BGP has
  confirmed. One was made by BGP. None is closed. Only 13 of the 210 brands
  are on any BGP deal.
- The PIPnet import has been stopped since 15 November. The app's ScraperAPI
  account is out of credits (100,073 of 100,000 used), and every PIPnet
  search goes through it. The login itself still works.
- It opens on 58 suggestions, not on requirements.
- The row runs to 17 columns. Three of them are empty on every row, and two
  more repeat what the row already says.
- A requirement has no page of its own. You can edit it, but you cannot open
  it.
- What the row links to is thin. The units that fit open the property, not the
  unit. Discuss starts a new chat each time you press it. The brand's
  expansion score, Super Brand star, Brand CRM stage, viewings and offers are
  not on the row at all.
- The rest of the app barely links back. About 70 places show requirements.
  Only two open a requirement itself, and both open its edit form. For BGP
  staff the brand page leaves out all 210 market listings. It says "No BGP
  requirement recorded · Add a requirement", which invites a duplicate. Yet
  the same page's Suggested pitches quotes that listing as "their
  requirement".
- "Fit your units 199" means size alone. 199 of the 211 requirements fit,
  averaging 36 units each out of 153 on the market. The stricter shared rule,
  used by the target engine and landlord pages, gives 140 requirements with a
  fit, averaging 5 units each. Nine places decide a fit, each in its own
  way. On the same row, Find matching units never checks size.
- It downloads the whole CRM every time it opens: about 3.4 MB compressed. On
  top of that, a news list takes 10 seconds to answer.

The proposal:

- A board of the brands that want space, with the brand's context on each
  row.
- A requirement panel, opened with `?requirementId=`, that every place in the
  app opens when it shows a requirement.
- One fit rule, with each fit opening the unit.
- One meaning of "live" everywhere.
- A feed that loads only what the board shows.

Seven decisions for Woody are at the end.

## What the board is today (live, 19 November 2026)

**The rows.** 211 leasing requirements, every one with status Active.

| | Rows |
|---|---|
| PIPnet imports (no `origin`, source PIPnet) | 210 |
| Made by BGP (`origin = 'bgp'`) | 1 |
| Confirmed by a named person | 1 |
| Closed (past, archived or satisfied) | 0 |
| Linked to a brand | 210 |
| An agent contact (the agent PIPnet lists) | 206 |
| A BGP owner | 1 |
| A principal contact at the brand | 0 |
| A deal | 0 |
| Map locations | 0 |
| Typed places (`requirement_locations`) | 70 |
| A size | 202 |
| A use | 173 |
| A requirement type (high street, shopping centre ...) | 117 |
| A group (F&B, Retail, Fitness & Wellness, Leisure) | 83 |
| Comments | 158 |
| A landlord pack (a one-page PDF) | 210 |

No brand has more than one requirement: the PIPnet import keeps one row per
brand.

The import also adds its label to a row a person made before 12 November. So
a few of the 210 may have started as BGP's own (the health report says so).
84 rows have been edited by hand since they were made.

**The brands behind them** (read from the CRM on 19 November):

- Only 13 of the 210 brands are a party on any BGP deal, and 7 of those on a
  live one.
- None is a Super Brand.
- None has a BGP team set (`bgp_contact_user_ids`). Only 6 companies in the
  whole CRM have one.
- 35 brands have no company type at all. These are name-only records the
  import made when PIPnet named a client the CRM did not hold
  (`promoteToCrmRequirement`, `server/pipnet.ts`).
- Three requirements are tied to the wrong kind of company: an agent, a
  landlord and a client.

**The import has been stopped since 15 November.** The health report (Sync
tools → Health report) says PIPnet last saw a listing on 15 November, though
the import runs at 05:30 every day. The cause was found on 19 November:

- The app's PIPnet login works. The admin login test passed, with the
  credentials held in the app's database.
- Every PIPnet search goes through ScraperAPI, and the ScraperAPI account is
  out of credits. The app's costs report shows 100,073 requests used of
  100,000. A search answers "ScraperAPI paused — account out of credits".
- Eight other parts of the app also go through ScraperAPI:
  - The Requirement List import;
  - planning documents;
  - Companies House;
  - brand enrichment and identity checks;
  - the brand, landlord and social scrapers.

  While the credits are out, each of these either skips ScraperAPI or fails.
  The app does not log which feature used the 100,000.

No new row has come from PIPnet since 12 November. 62 existing rows were seen
again before the credits ran out.

The 590 "active" listings in the import table are not recent ones that went
missing. They came from a one-off import in May 2026, with PIPnet dates going
back to 2025, and were never turned into rows. 136 of them are for brands
already on the board. The 321 that did become rows arrived between May and
November.

**What PIPnet holds**, from the 911 requirement listings and 379 available
properties the app has stored:

- **Each retail requirement listing gives:**
  - the client (the brand);
  - an area range, held on 863 of the 911;
  - the agent firm and the agent's name, with a phone on 264 and an email
    on 79;
  - a status and a document date.

  Behind each listing is a detail page with the agent's address and mobile,
  and a brochure (the "landlord pack"). The app reads the brochure for use
  and places. Even so, only 189 listings have a use class and 80 have places.
  That is why few requirements on the board have places.
- **Retail availability:** space on the market across the UK. Each one has
  the address, size, tenure, use class and the agent firm (121 firms). 201
  have a rent and 232 a rateable value. These are kept apart from the CRM, on
  their own map layer.

**How old they are.** The board counts a market listing's age from the day
PIPnet listed it. The median is 119 days. 99 were listed within the last 90
days, and 52 more than six months ago. 149 rows were imported before 12
November, when the import started stamping its own listing date. For those
149, the only date is PIPnet's original requirement date, so a listing PIPnet
still carries cannot be told apart from one it dropped.

**The lists.** To confirm 58 (all 58 are suggestions: 48 from news, 10 from
emails; no requirement rows), Live 1, Going stale 0, In the news 550, Market
listings 210, Closed 0. The board opens on To confirm, which is the
suggestions tray. Below the lists come a row of filters (Fit your units 199,
Last 90 days 99, Retail 20, F&B 33, Fitness & Wellness 18, Leisure 12,
Other 128, Source, Sort), two demand cards, and then the list.

**The units the board fits against.** 153 units on the Letting Tracker are
marketing (AVA 138, NEG 15). Of these, 115 have a size, 38 do not, and 96 have
no use class at all.

## Findings

### It opens on the wrong thing

1. **The first screen is the suggestions tray.** It shows 58 news and email
   suggestions, each with Confirm and Wrong brand buttons. No requirement is
   on the first screen on a computer, and none is above the fold on a phone.
   The tray is BGP's work list, and it is worth having. But it is not "who
   wants space". The 12 November design made it the To confirm list because
   suggestions and unconfirmed drafts would sit there together. On live, To
   confirm holds suggestions only.

2. **"76 open requirements" is not the number of open requirements.** It sits
   under "Most-wanted size: 1,000–3,000 sq ft". It is the number of
   requirements in that size band (`demand.topBand`, `requirements.tsx` about
   line 1248), but it reads as a total. There are 211.

### The row is a spreadsheet

3. **17 columns, wider than the screen.** The columns are Name, State, BGP
   owner, Dated, Status, Use, Requirement Type, Size, Req. Locations, Fits,
   Map Locations, Principal Contact, Agent Contact, Deal, Landlord Pack,
   Comments and Actions (`LeasingSection`, from line 2796). On a 1440px screen
   the table stops at Use. Every other column sits off to the right. Most
   cells are editors in place: a brand picker, a contact picker, multi-selects
   for use, type and size, a date, a map. This is how the board was set up as
   a Monday.com-style sheet.

4. **Three columns are empty on every row:** Principal Contact (0 rows), Deal
   (0) and Map Locations (0). The property chips under Map Locations come from
   somewhere else (finding 9).

5. **Two columns repeat what the row already says.** Status reads Active on
   all 211 rows, next to the State chip ("Market listing"), so each row shows
   two statuses that disagree in kind. Dated repeats the "listed on PIPnet
   13 Oct" line that already sits under the State chip.

6. **A requirement has no page.** Nothing opens a requirement to read it.
   `?requirementId=` opens the edit form for staff (`requirementId`, line 337)
   and a search for a client login. The evidence drawer
   (`RequirementEvidenceDrawer`, `client/src/components/requirement-centre.tsx`)
   is the only read-only view. It holds the evidence lines and nothing about
   the brand.

### What the row links to

7. **The units that fit open the property, not the unit.** A fit opens
   `/properties/:id` (line 3210). The app has helpers for opening the unit
   itself (`client/src/lib/unit-links.ts`: `propertyUnitHref` for the unit on
   the property page, `trackerUnitHref` for its tracker row), but the board
   does not use them.

8. **"+N more" cannot be clicked, and "+ brief" only appears on hover.** "+N
   more" (line 3229) is plain text. "+ brief", which adds the brand to the
   unit's Targeting Brief, is hidden until the mouse is over it
   (`opacity-0 group-hover`), so on a phone nobody can see it. The full list
   of fits is behind the row's Find matching units button, which opens a
   second dialog with its own rule (finding 12).

9. **A second "match" on the same row, by a different rule.** Under Map
   Locations, up to three property chips show. They come from
   `propertyMatchMap` (line 686), which checks the requirement's typed places
   against the name and address of **every** property record in the CRM,
   whoever owns it and whether or not BGP is letting it. So a row can show
   fits from one rule and property chips from another, and the two do not
   agree.

10. **Discuss starts a new conversation every time.** Discuss posts a new
    chat thread titled "<brand> — requirement", with ChatBGP in it, and moves
    you there (`discussRequirement`, line 577). Pressed twice, it makes two
    threads. Neither is linked to the brand or the requirement. The brand's
    own conversation, the one on the brand page, is not used.

11. **Most of what the app knows about the brand is not on the row.** The
    brand's name opens its page, and the agent opens the contact page. That is
    all. The row does not show:
    - the Expansion score and its band;
    - the Super Brand star;
    - the brand's BGP team;
    - its stage at a scheme on the Brand CRM;
    - its viewings and offers on the Letting Tracker;
    - its store count and sites on the way;
    - its latest news;
    - its CRM plan;
    - a link to the PIPnet listing (`external_requirement_id` is on 62 rows,
      but the board does not use it).

    The board does have a "Recent viewing evidence" card, but it only shows
    while its viewing filter is on, and it sits above the list, not on each
    row.

### The fits

12. **Nine ways to decide a fit, and two of them disagree on the same row.**
    The Fits column checks size and nothing else. The Find matching units
    button on the same row checks place and use and never size.

    | Where | What it checks |
    |---|---|
    | The board's Fits column (`GET /api/crm/requirements-leasing/matches`, `server/crm.ts` line 5621) | Size alone. A unit with no size fits on use or place. |
    | The board's Find matching units (`/api/requirements/matches/:id`, `server/routes.ts` line 10523) | Place and use class. Never size. |
    | The tracker's Find matching requirements (`/api/available-units/matches/:unitId`, line 10568) | Place and use class. Never size. |
    | Brand Gap's lists (`server/property-gap-analysis.ts`) | Size and use class (`requirementUseFits`). A unit with no use class counts as fitting. |
    | Space fits on landlord pages (`server/account-teams.ts`) and the target engine (`server/target-tenant-engine.ts`) | Size and use or place (`requirementFitsUnit`). A unit with no size needs both. |
    | The Brand CRM's chip (`requirementChip`, `shared/brand-stage.ts`) | Size and place, with regions. Never use. |
    | The tracker's brand suggestions (`server/crm.ts` around line 5508) | Size alone is enough. |
    | Suggested pitches on the brand page (`server/crm.ts` around line 5430) | Size, within 0.5 to 1.6 times, and place words. |
    | The property chips (finding 9) | Place words against every property in the CRM. |

    `requirementFitsUnit`'s own comment says it follows "the same rules as the
    requirements Fits column". It does not.

    On the live data, three of these rules give:

    | Rule | Requirements with a fit | Units per requirement, on average |
    |---|---|---|
    | The board's Fits column (size alone) | 199 of 211 | 35.7 |
    | Brand Gap's rule (size and use class) | 198 | 26.3 |
    | The target engine's rule (size and use or place) | 140 | 5.2 |

    When a requirement "fits" a quarter of the market, the fit tells you
    nothing. Izzy Home Store fits 90 units on the board, 63 on size and use
    class, and 10 on the shared rule. City Slots fits 81, 53 and 4. The single
    fit rule has waited on Woody since 12 November.

13. **The units are as much the problem as the rule.** 96 of the 153
    marketing units have no use class, and 38 have no size. A use test cannot
    do its work on a unit with no use. So whichever rule is chosen, those
    units need a use class and a size before fits are honest.

### Speed

14. **It downloads the whole CRM on every open.** The page fetches every
    company (1.37 MB compressed), every contact (1.37 MB), every deal
    (0.25 MB), every property (0.21 MB) and every viewing (0.21 MB). That is
    about 3.4 MB compressed, mostly for the pickers inside the cells. The deal
    page did the same until 18 November, and it now loads its pickers only
    when they are opened.

15. **In the news takes 10 seconds and loads even when nobody opens it.**
    `GET /api/requirement-centre/expanding` answered in 10.3 seconds on live.
    The page asks for it on every staff open (`expandingQuery`, line 544),
    whichever list is showing.

## Where the rest of the app meets requirements

A code search on 19 November found about 70 places outside the board that
read or show leasing requirements. They cover:

- the brand page, on a computer and a phone;
- the Brand CRM;
- Brand Gap;
- the Letting Tracker and the target engine;
- landlord and property pages;
- the Brands overview, Explorer and Hunter;
- the CRM lists and Start strategy;
- viewings, deals, contacts and agents;
- the dashboard and the phone home;
- ChatBGP;
- the Brand Pack and the reports.

The points below were checked against the code.

16. **Almost none of them open the requirement.**
    - **Two open a single requirement** (`?requirementId=`): the contact
      page's Records list and the landlord chat receipt. Both open the edit
      form.
    - **Six have the requirement's id but open the brand's list instead**
      (`?companyId=`):
      - the brand page's requirements card;
      - the deal page's Brand Profiles card;
      - the Brand CRM card;
      - Brand Gap's target detail;
      - a viewing's "Linked requirement";
      - ChatBGP's requirement tools (`pageUrl`, `server/chatbgp-requirements.ts`).

      The dashboard's "Live requirement" alert carries the id but opens the
      bare board (`digestHref`, `client/src/pages/dashboard.tsx` line 141).
    - **About twenty show a requirement with no link to it at all:**
      - the tracker's Find matching requirements and its brand suggestions;
      - the target engine's evidence;
      - the Brand CRM chip and Targets board;
      - the phone brand page;
      - Tenant rep "on a requirement";
      - the counts on the brand page;
      - Explorer's chip;
      - Who's hot;
      - the overview tile;
      - the CRM list's reason;
      - Start strategy's "Requirement on file";
      - the dashboard widget's rows;
      - the client Agents directory.
    - **One link is broken.** The Brands overview's radar links to
      `/companies/<id>?tab=requirements` (`brands-hub.tsx` line 570), but the
      company page ignores `tab`.

17. **The brand page and the board disagree.** For BGP staff, the brand page
    lists only live and to-confirm requirements (`server/brand-profile.ts`,
    from line 544). On live, that is one brand. The other 210 brands on the
    board get one of two things:
    - "No BGP requirement recorded · Add a requirement" (`brand-profile-panel.tsx`
      line 3452), which invites a duplicate;
    - a live PIPnet lookup, which is a separate fetch and not the board's
      row.

    On the same page, Suggested pitches quotes the listing as "their
    requirement", and so do Brand Gap, the target engine and the tracker.
    The server sends each row's state and date, but the desktop page never
    draws them. The phone card has no link.

18. **A deal and its requirement are never shown together.** The server
    links them through `crm_requirements_leasing.deal_id`, for:
    - the Brand CRM's "Linked" chip;
    - the "mark as satisfied?" question;
    - ChatBGP.

    Only the requirement form sets the link, through its Deal picker. The
    deal page never shows it, and the deal form cannot set it. On live, no
    requirement has a deal.

19. **Brand Gap can say "None held" for a brand that has a requirement.** Its
    targets read only the 30 best-weighted requirements whose use fits a
    unit at the scheme (`server/property-gap-analysis.ts` line 598). A brand
    outside those 30 shows "None held" and an Add requirement button. Its
    "Fits here" units cannot be opened.

20. **Each place has its own idea of "live",** although CLAUDE.md says every
    consumer uses the one rule in `shared/requirement-live.ts`.
    - **Six places read status "active" or blank:**
      - the diary sync that links a viewing to a requirement;
      - the client Agents directory;
      - the contact review;
      - ChatBGP's offer logging;
      - brand enrichment;
      - the intake's brand match.
    - **Two add "status = Active" on top of the rule:** the Expansion
      why-lines and ChatBGP's brand profile.
    - **Four apply no state at all,** so closed requirements still show on the
      agent firm page and the contact page.
    - **Five use their own date windows:**
      - Who's hot: 90 days;
      - the market commentary: 90 days;
      - the dashboard widget: 7 days;
      - the brand tidy: 24 months;
      - HR points: this week.

    The wording drifts too:
    - "Live" covers live and to confirm on Explorer's chip and filter and on
      the overview tile. A client login also sees the tile.
    - On landlord pages, "listing" is used for any older row, including
      BGP's own.

21. **Clients may add a requirement, but most places do not offer it.**
    Client logins have been able to add one since 17 November, and Brand Gap
    offers it. The brand page, the phone brand page, the Brand CRM card and
    the dashboard still hide Add from them.

22. **Old code still carries old rules:**
    - The phone shell's "Reqs" list applies no state at all. It looks
      unreachable: nothing in `mobile-app.tsx` sets its tab.
    - Three panels that are never mounted still hold old matchers and status
      rules.
    - In Brand Gap, a joint agent's "Requirements whose use fits" rows link
      to a page it is refused.

## Proposal

The rules of 12 and 17 November stay exactly as they are. A machine only
suggests, and a named BGP person confirms. Nothing ages a row on a timer. A
requirement's state is read, never stored. Client logins read, add and amend
every requirement, but never see its state, its owner or who confirmed it.
Joint agents see none. Everything below is reading and layout. The only
writes are the ones the board already makes.

### 1. A board of brands that want space

One row per brand. The data already holds one requirement per brand.

On a computer the row needs about eight columns, which fit the screen with no
sideways scroll:

| Column | What it shows |
|---|---|
| Brand | Logo, name and the Super Brand star. Opens the brand page. |
| Wants | Size, use and places in one line, with the requirement type under it. |
| State | One chip and one date: "Listed on PIPnet 13 Oct", "Confirmed 3 Nov". No Status column and no Dated column. |
| Fits | How many units fit by the one rule (section 3). The best one names the unit and opens it. |
| Agent | The named person and their firm, with call and email icons. Opens the contact. |
| BGP | The requirement's owner, or the owner decision 5 gives it, greyed. |
| Expansion | The score and its band, as on Brand Hunter. |
| Last contact | From `shared/last-contact.ts`, as on the CRM lists. |

On a phone the same row becomes a card, and the list comes first.

Editing moves into the requirement panel (section 2). That removes the
pickers from the row, and with them the need to download the whole CRM.

The list pills become: **Open** (the default), **BGP's own**, **Market
listings**, **Suggestions 58**, **In the news**, **Closed**, with Everyone /
Mine. The filters go into one Filters popover, as on the Investment Tracker.
The two demand cards become one line ("Most wanted: 1,000–3,000 sq ft (76 of
211) · London, Marylebone, Covent Garden"), or are dropped.

### 2. A requirement panel that opens from anywhere

Pressing a row opens a panel beside the list. Its address is
`?requirementId=`, so every link in the app that names a requirement lands on
it. Today those links open the edit form.

The panel shows:

- **The head:** the brand, its star, the state and its evidence line, and
  Confirm or Still live. Then Edit, and More (Close as satisfied, Not live,
  Delete for admins).
- **What it wants:** size, use, type, places, comments, the source, and the
  PIPnet listing.
- **Who:** the agent (with call and email, and their firm's page), the BGP
  owner, and the principal contact at the brand.
- **Where it fits:** every unit by the one rule, each with the reason ("size
  fits · Restaurant · Leeds"). Each one opens the unit (`propertyUnitHref` or
  `trackerUnitHref`). Each has **Add as target** (the unit's Targeting Brief,
  as "+ brief" does today, but visible) and **Want at this scheme** (the Brand
  CRM's Wanted line).
- **The brand:**
  - Expansion score, store count, sites on the way and the latest signals,
    drawn from the brand page's own cards;
  - its stage at each scheme on the Brand CRM;
  - its viewings and offers on the Letting Tracker in the last 12 months;
  - its deals;
  - its landlord pack.
- **Evidence:** the evidence drawer's lines, and Add evidence.
- **Conversation:** the brand's own conversation, the same thread as on the
  brand page, in place of Discuss's new thread each time.
- **CRM:** the brand's plan card, with Start strategy.

A client login sees what it wants, the agent, the brand link and the fits
against its own units. It does not see the state, the owner, the evidence or
the CRM plan, so the cut stays as `requirementClientCopy` and
`requirementReason().clientText` make it today.

### 3. One fit rule, and each fit opens the unit

Every place in finding 12 uses one function. The Brand CRM chip ("Size fits,
no places") and suggested pitches ("Fits", "Size fits", "Close to") keep
their wording on the same rule underneath. Each fit says why it fits. The
property chips (finding 9) go.

Which rule is decision 2. Alongside it, a data card lists the marketing units
with no use class (96) or no size (38) for someone to fill in. Nothing is
written automatically.

### 4. Load only what the board shows

One feed route, in the style of `server/crm-hub.ts`, sends the board's rows
in a fixed number of queries. Each row carries the brand's name and logo, the
star, the Expansion score, the BGP team, the agent's name, the fits and the
last contact. The pickers load when the panel's Edit opens. In the news loads
only when its pill is opened, and its 10-second query gets looked at.

### 5. Every place that shows a requirement opens the panel

Each place in findings 16 to 19 that shows a requirement opens the panel with
`?requirementId=`. That includes:

- every row on the brand page, on a computer and a phone;
- the Brand CRM card and chip;
- Brand Gap's targets;
- the tracker's Find matching requirements and its brand suggestions;
- the target engine's evidence;
- a viewing's linked requirement;
- the dashboard alert and widget;
- Explorer, Who's hot and the radar;
- Start strategy;
- ChatBGP's receipts.

A count, such as "3 requirements" on a brand page, opens the board filtered to
that brand.

Beyond the links:

- **The brand page shows what the board shows.** The desktop page draws the
  state and date the server already sends. If decision 7 is yes, market
  listings appear there too, labelled, with Confirm. That replaces "No BGP
  requirement recorded · Add a requirement" for a brand the board already
  holds.
- **Deal and requirement.** The panel shows the deal a requirement led to.
  The deal page shows the requirement it answers. The requirement form already has a
  Deal picker (`DealSearchPicker`), and the panel keeps it. The deal page
  gains a line naming the requirement, which opens the panel.
- **Brand Gap** reads a brand's requirement whether or not it is in the top
  30, and its "Fits here" units open the unit.
- **Add for clients** is offered wherever the server already lets a client
  add a requirement: the brand page, the phone brand page, the Brand CRM card
  and the dashboard.

### 6. One meaning of "live"

Every place in finding 20 reads `requirementStateSql` or `requirementLive`
from `shared/requirement-live.ts`. Each uses its words: "live", "to confirm",
"market listing" or "older", never "Live" for both of the first two. A guard
test fails on a new `status = 'Active'` reading of a requirement outside the
rule.

Some of these places choose agents through a requirement: the client Agents
directory, the contact review and ChatBGP's offer logging. Moving them onto
the rule changes which agents they offer. Before that ships, the build lists
which agents each place would gain or lose, for Woody to see.

The phone shell's Reqs list and the three unmounted panels are deleted.

## Build order

1. **Get the PIPnet import running again.** ScraperAPI needs topping up, or
   its plan needs to renew (Woody's). Then check the next 05:30 run.

   Two more things are Woody's call:
   - whether the 590 May listings should be brought in;
   - whether the import should keep making a name-only brand record, with no
     type, for a client the CRM does not hold.
2. **Feed and fit rule (server):** the board feed, and the chosen fit rule in
   `shared/requirement-fit.ts` with tests, used by every caller (finding 12).
   The client cut and the joint agent rule carry over unchanged.
3. **The panel:** read, then edit, with the brand's cards, fits, evidence,
   conversation, CRM plan and deal.
4. **The board:** the new row on a computer and a phone, the pills, the
   Filters popover, and the corrected demand line.
5. **Links in:** every place in findings 16 to 19 opens the panel. This step
   also covers the brand page, Brand Gap and Add for clients from section 5.
6. **One meaning of "live":** section 6, with its guard test, and the old
   code removed.
7. **The unit data card**, if Woody wants it (decision 2).

Each step updates `server/chatbgp-app-map.ts` and the requirements section of
CLAUDE.md where it changes what a screen shows.

Each step is checked in a browser against a local copy before it is
committed. Nothing is pushed until Woody says push.

## Decisions for Woody

1. **One row per brand, or one row per requirement?** I recommend one row per
   brand. The data already holds one requirement per brand, and BGP works
   brand by brand. A brand with a second requirement would show both inside
   its row.

2. **The fit rule.**
   - (a) Size **and** use or place, the rule space fits and the target engine
     already use: 140 requirements with a fit, about 5 units each.
   - (b) Size and use class, Brand Gap's rule, with place only used to rank:
     198 with a fit, about 26 units each until the 96 units get a use class.
   - (c) Size alone, as the board does today: 199 with a fit, about 36 units
     each.

   I recommend (a), together with the unit data card, so the use test has
   something to work with.

3. **What the board opens on.** I recommend Open: BGP's own first, then
   market listings, newest listing first. Suggestions would become their own
   pill, with the count.

4. **Old market listings.** 52 listings are more than six months old. For 149
   of them, the board cannot tell whether PIPnet still carries them. I
   recommend a market listing that PIPnet has not listed for six months shows
   under Older. This would be worked out when the board is read, with nothing
   written to the database. Today an unconfirmed import stays under Market
   listings at any age.

5. **Who owns a market listing.** 210 of 211 requirements have no BGP owner.
   Today the first person to confirm one becomes its owner, and only one has
   been confirmed. The brand's BGP team cannot fill the gap: it is set on
   none of these brands, and only 13 of them are on a BGP deal whose agents
   could stand in.

   The choices:
   - (a) Leave listings unowned until someone confirms them, as today.
   - (b) Give each group a named owner, who sees that group's listings under
     Mine: F&B, Retail, Leisure, and Fitness & Wellness. Woody would name
     the four people.
   - (c) Use the agents on the brand's deals where there are any, and leave
     the rest unowned.

   I recommend (b). A listing nobody owns is a listing nobody chases. Each
   row's owner would be worked out on read, with nothing written. Handing
   owners out is on the 12 November "not built, waiting on Woody" list.

6. **In the news (550 brands).** These are brands in the press with nothing on
   BGP's books. I recommend it stays a pill on the board but loads only when
   opened. The alternative is moving it to Brand Hunter as a filter, since it
   is a prospecting list.

7. **Market listings on the brand page.** Since 12 November the brand page
   has shown staff only live and to-confirm requirements, under the heading
   "BGP requirements". So 210 brands on the board read "No BGP requirement
   recorded · Add a requirement" there.

   I recommend the brand page also shows a brand's market listing, labelled
   "Market listing, listed on PIPnet 13 Oct, not confirmed", with Confirm, so
   staff confirm the listing rather than add a second row. Client logins
   already see every requirement there, so nothing changes for them.

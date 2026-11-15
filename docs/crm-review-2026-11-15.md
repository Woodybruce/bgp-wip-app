# CRM page review, 15 November 2026

Woody, 15 November 2026, on the side bar's CRM page: "This doesn't seem to
have used the various design and upgrades we've been doing across the app.
Firstly it's not uniform between brand, agent and landlords in Landsec, and
it also lacks connectivity and usability ... Has it considered the CRM
strategy we built for landlords? We want to do a similar thing for brands,
has that been built anywhere? ... We just need to add brands to that I think
as one engine and then join it all up for BGP, and then Landsec can use that
for theirs, just move lenders and landlords out ... there should be a
uniformity and they should all be linked to the calendar ... can we link
that calendar to or have it overlay the normal team and Landsec calendar?
Firstly join it all up and make them all the same but using the best bits of
them all."

Read from the code and from the live screens (BGP view) on 15 November 2026.

## What is there today

Five places hold CRM, each built at a different time:

| Place | Who | What it shows | How it is drawn |
|---|---|---|---|
| CRM → Overview | BGP | The strategy engine for landlords: events calendar, strategies, actions | Calendar grid and two cards |
| CRM → Landlords | BGP | 280 landlord accounts | Cards or table; properties, deals, contacts counts |
| CRM → Agents | BGP | 506 agent firms | Rows that expand to show the firm's people |
| CRM → Lenders | BGP | 5 lenders | Three stat tiles and a table (LTV, loan range, appetite) |
| CRM → CRM Meetings | BGP | This week's landlord meetings, head-of-team interviews | Card grid |
| Brand CRM (under Brand Intelligence) | BGP, Landsec | Targets grid, Diary, Strategies and events for brands | Grid, grouped tables |
| CRM for a Landsec login | Landsec | Brand Directory, Agents, Landsec Contacts | Cards with inline contacts; tables |

## Answers to the questions

- **Has the brand strategy been built?** Yes. It is the same engine as the
  landlord one, shown under Brand Intelligence → Brand CRM → **Strategies and
  events**, and as the CRM plan card on every brand's page. It is in a
  different place under a different name, which is why it does not look
  built.
- **Does the CRM page use the landlord strategy?** Only on its Overview tab,
  and only for landlords. The Landlords, Agents and Lenders tabs do not show
  a strategy, an open action or a next step against any company.
- **Agents and lenders are not in the engine.** A strategy, event or action
  can only be linked to a landlord-type company or a brand. An agent firm or
  a lender cannot have one, and their pages have no CRM plan card.
- **Is it linked to the calendar?** No. CRM events show only in the
  Overview's own small calendar. CRM actions, strategy review dates and the
  Brand CRM diary are on no calendar. The team calendar's "CRM" switch means
  something else (meetings synced from Outlook).

## What is wrong

1. **Four list designs for one idea.** Landlords are cards, agents are
   expanding rows, lenders are tiles and a table, the Landsec brand list is
   cards with contacts on them. Filters are pills on two, a segmented bar on
   one, buttons and a drop-down on another.
2. **The lists say nothing about the relationship.** No tab shows who at BGP
   owns the account, when we last spoke, the next action or the strategy it
   is in. The landlord card's counts (properties, deals, contacts) are the
   only facts.
3. **Brands are missing from the CRM page** for BGP, and are the main thing
   on it for Landsec. The same word means two different pages.
4. **The engine is split in two views** (Landlord CRM and Brand CRM) that
   never meet, so nobody can see everything they owe this week in one place.
5. **Small faults**: clicking an agent row expands it and only the name
   opens the firm; "Open people" on a landlord goes to the same place as the
   card; lenders cannot be added or deleted from the tab (the Add Lender
   button is never shown); the Landsec tab set is switched on by the team
   picker, not by the Landsec view test the rest of the app uses.
6. **Company pages differ by type.** A brand has the new header, summary
   card and six pills. A landlord, an agent firm and a lender each have an
   older layout of their own, and only landlords and brands carry the plan.

## Proposal: one CRM, four kinds of company, one diary

**The page.** CRM becomes one page with the same tabs for everyone:

- **Overview**: the strategy engine for every kind of company, with a kind
  filter (All, Landlords, Brands, Agents, Lenders). Strategies, events and
  actions in one place.
- **Landlords, Brands, Agents, Lenders**: one list design for all four.
- **Diary**: everything dated, for everyone (below).
- **CRM Meetings** and **Review** stay as pills at the end.

Landsec gets the same page with **Brands** and **Agents** (and its own
contacts), and no Landlords or Lenders. Brand Intelligence keeps the
Targets grid, which is a leasing tool, and links to the CRM for the rest.

**One list design, from the best of each:**

- From Landlords: the cards / table switch, the client crown, the counts.
- From Agents: opening a row to see the firm's people without leaving.
- From the Landsec brand list: named contacts on the card, with add and edit.
- From the Brand CRM: stage chips, the owner filter, "No next step".
- New on every row: BGP owner, last contact, next action with its date,
  strategy name, and a kind-specific line (a landlord's properties and
  deals; a brand's requirement and stage; an agent's brands represented; a
  lender's appetite and loan range).
- One filter row everywhere: search, owner, "No next step", "No contact in
  90 days", then the kind's own pills.

**One engine.** Agents and lenders join landlords and brands as companies a
strategy, event or action can be linked to, and a strategy can cover more
than one kind (a brand and the agent who acts for it). The words on the
forms follow the company's kind. The CRM plan card goes on agent and lender
pages too.

**One diary, and the calendar.** The Brand CRM diary becomes the CRM diary
for every kind: actions due, events, strategy reviews, viewings, deals
waiting. The team calendar and the Landsec calendar each get a **CRM**
layer that can be switched on and off: events and actions show as entries
on the day, in their own colour, and open the record. Landsec's layer holds
only what Landsec may already see (shared brand actions, viewings, its own
requests).

**Company pages.** Landlord, agent and lender pages move to the brand
page's shape (header with one More menu, summary card, pills), each with
its own sections.

## Order of work

1. Engine: agents and lenders as plan companies; one Overview with a kind
   filter; forms worded by kind. (No change to what Landsec sees.)
2. Lists: the one list design on Landlords, Agents, Lenders; add the Brands
   tab for BGP; the same component for Landsec's Brands and Agents.
3. Diary for every kind, on the CRM page.
4. The CRM layer on the team calendar and the Landsec calendar.
5. Company pages for landlords, agents and lenders in the brand page's shape.

## Decisions needed

1. **One Overview for all kinds.** This reverses the 12 November decision
   that the Brand CRM is kept separate from the Landlord CRM. Recommended:
   yes, with the kind filter, and "Strategies and events" under Brand
   Intelligence becomes a link to it.
2. **Where brands live for BGP.** Recommended: a Brands tab on the CRM page
   listing brands BGP is working (on a strategy, with an action, a
   requirement or a live deal), not all 2,679; Brand Intelligence stays the
   full directory.
3. **What Landsec sees on the calendar layer.** Recommended: only what it
   already sees in the diary.
4. **Lenders**: there are 5 on the live list. Recommended: keep the tab but
   in the shared design, with no stat tiles.

## Built on 15 November 2026

- The employer-checks **Review** is a pill at the end of the pill row, with
  its count, in place of the full-width line above it.
- **Describe it in your own words**: a note box at the top of a new CRM
  strategy, action or event, in both the landlord and brand views. It fills
  the name, the objective or notes, the owner, dates, place and the
  companies named, and lists any company it could not find. Nothing is
  saved until the person presses Create. Not yet run against the live AI
  service: the checks and the three forms were tested with stand-in
  readings.

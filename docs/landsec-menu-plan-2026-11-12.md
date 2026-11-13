# Landsec menu and access plan (12 November 2026)

Woody asked for Portfolio and Lettings to be folded into Properties and Deals, with the side bar reduced to Properties, Deals, Letting Tracker and Brands. Three readers mapped the code, a designer wrote a plan and a feasibility check corrected it against the code. Nothing here is built yet.

**Build status, 13 November 2026.** Steps 1 to 4 of section 8 are built for full Landsec logins and BGP staff viewing as Landsec (one set of counts; the deal clock on Deals; the scheme cards and the Units section on Properties; the menu, the landing page and the redirects). It was then tested in a browser and the problems found were fixed the same day: a stage or Stuck pill is now the whole Deals filter; the old Deals and scheme addresses redirect only in the Landsec view, so BGP staff on All Teams keep the scheme page the Brand CRM links to; Stuck is one count on Properties and Deals (every open deal in negotiation); the deal clock columns sit straight after the status on Deals; the deal page prints one Net Effective Rent. Still open from section 7: the Deals status cards count every deal and the tracker pills count tracker rows, so they match the Properties stage pills (live lettings on the schemes) only when the data does. Steps 5 to 9 are not built. Asset managers and joint agents keep their scheme-limited pages, now named Properties and Deals on their menu, with no chat. Whether those two roles move onto the real pages and get chat is an open question for Woody: the "Landsec menu" passage in `CLAUDE.md` sets out both positions. Defaults taken on section 9: brand cases are one link inside Brands (decision 7); deals outside the 14 schemes are listed for staff and nothing is removed (decision 3); phone labels are "Tracker" and "Chat" (decision 10); the older Agreed brief card is left as it is (decision 5).

## Woody's decisions

- The Landsec side bar is: Properties, Deals, Letting Tracker, Brands.
- Portfolio and Lettings go; their useful parts move into Properties and Deals.
- Ask is deleted from the side bar ("its in the chat function"): ChatBGP is reached through the chat panel.
- Brands stays.

## Access model (Woody, 12 Nov 2026, later the same day)

Verbatim: "so each log in will be given a list of properties they work on or ALL. Everyone can have the same access to each properties the only difference is that we probably dont want to give the full brand list and detailed brand board to joint agents"

What this means:
- Every Landsec-side login (Landsec staff, asset managers, joint agents) carries a list of the properties it works on, or ALL.
- On a property a login is allowed, everyone sees and does the same things: the same Properties, Deals and Letting Tracker pages, limited on the server to that login's properties.
- The one difference: joint agents do not get the full brand list (Brand Intelligence hub / Brand Explorer) or the detailed brand board (the brand profile page). So the joint agent side bar is Properties, Deals, Letting Tracker, with no Brands.
- This REPLACES the 11 Nov decision that asset managers and joint agents get "a separate front door of new workspace routes". They now use the real pages with a property filter. It also replaces "asset managers see deals and figures only on their schemes" as a separate rule: the property list is the only limit.
- Existing rules about what any client login sees (for example no BGP fee wording, no BGP-internal notes) are unchanged: this is about which properties, not about new information.

## Chat (Woody, 12 Nov 2026)

Verbatim: "everyone can use the chat function should be open to all"

- The chat function (the ChatBGP panel and messages) is open to every Landsec-side login, including asset managers and joint agents, who do not have it today.
- "Ask" is still removed from the side bar: chat is reached from the chat panel and the phone chat tab.
- Build requirement that follows from the access model: what ChatBGP can read or do for a login must be limited to that login's properties, and for a joint agent it must not open the brand list or the detailed brand board.


---

# CORRECTED PLAN: Landsec menu becomes Properties, Deals, Letting Tracker, Brands

Checked against the working copy on 12 Nov 2026 (top commit b5642c3 plus the Brand CRM build's uncommitted edits). Read-only: nothing changed, nothing run in a browser or against a database. Component and function names are quoted because `App.tsx`, `app-sidebar.tsx`, `brands-hub.tsx` and `landsec-access.ts` are being edited by the Brand CRM build.

**The short version.** Steps 1 to 4 (menu, and moving Portfolio and Lettings into Properties and Deals) are screen work and hold up against the code, with corrections. The access change (steps 5 to 8) is the risky part and the designer's plan had four faults there, listed at the end. `docs/landsec-review-2026-11-12.md` already records open holes for asset managers and joint agents (its items 1.5, 1.6, 1.7, 1.8, 1.12); I confirmed 1.5, 1.6 and 1.7 are still in the code. They must be closed before either role is put on the real pages.

## 1. The menu

| Login | Desktop side bar | Phone tabs |
|---|---|---|
| Landsec login with ALL or a list (leasing or asset manager) | Properties, Deals, Letting Tracker, Brands | Properties, Deals, Tracker, Brands, Chat |
| Joint agent | Properties, Deals, Letting Tracker | Properties, Deals, Tracker, Chat |
| BGP staff viewing as Landsec | Same four; staff-only "Landsec admin" block at the foot of Properties | Home, Properties, Deals, Tracker, Chat (see below) |

- **Addresses:** Properties `/deals/properties`, Deals `/deals`, Letting Tracker `/deals/letting`, Brands `/brands`. All three pages already exist as the `DealsHub` tabs for a client (confirmed: `tabs` filter in `DealsHub`).
- **Ask** leaves `LANDSEC_NAV` and `LANDSEC_NAV_ITEMS`. Desktop chat is the `button-chatbgp-rail` rail, which is shown to client logins and works for them (`chatIsClient` in `chat-panel.tsx` gives AI chat only). Phone chat is a Chat tab to `/messages`.
- `DealsHub` hides its own tab row when the brand is Landsec.
- **Active entry, a real fault not a "to check":** `NavSection.isActive` treats `/deals` as "any address starting /deals", so Deals would light on all three pages; `MobileBottomNav.isActive` does the same. Both need a Landsec rule: Properties = `/deals/properties`, `/properties`, `/properties/*`, `/landsec/unit/*`; Letting Tracker = `/deals/letting`, `/available`; Deals = `/deals`, `/deals/list`, `/deals/<id>`; Brands = any `/brands` (today's rule unlights it on `?tab=crm`, the Brand CRM tab).
- **Phone header:** the phone shell titles `/deals/properties` and `/deals/letting` as "Deals"; add the right titles.
- **Staff on a phone:** `MobileHome` at `/` is where staff viewing as Landsec find the "Exit" banner ("a phone stuck in Landsec view has no way back", Woody 7 Aug). They keep `/` as `MobileHome` and a Home tab in place of Brands.
- `landsecNavFor` and the `LANDSEC_NAV_ITEMS` filter are keyed on the old titles; rewrite both. `MobileSidebarOverlay` is mounted nowhere.

## 2. Where a Landsec login lands

`/` and `/home` go to Properties (`/deals/properties`).

- `Home` in `App.tsx`: redirect when the brand is Landsec.
- Phone branch in `AuthenticatedApp` (renders `MobileHome` at `/`): redirect real Landsec client logins only (`role === "Client"`), not staff.
- **Until steps 6 and 7 are live, asset managers and joint agents must be left out of both redirects** and keep `LandsecHome` at `/`. `/deals` is not in `LANDSEC_RESTRICTED_ROUTES`, so redirecting them would loop between `/` and `/deals/properties` through `ClientRouteGuard`.
- This drops the old phone tiles for Landsec logins (`PORTFOLIO_LINKS`: Requirements, Images, CRM, Calendar, News). The desktop menu already lacks them.

## 3. Properties

**Moves in**

| From Portfolio | Where it goes |
|---|---|
| Four groups with a card per scheme (units, vacant, occupancy, stage counts, passing rent, oldest live deal) | Default "Schemes" view at the top of `PropertiesList` for Landsec, still fed by `GET /api/landsec/home` (already filtered per viewer by `viewerCanSeeScheme`). Lift `SchemeCard` into a shared component. Table, card and board stay on the view toggle |
| Empty-scheme card | Kept, not clickable |
| Stage pills | In `PropertiesBoardHeader`; each opens Deals filtered to that stage (check the Deals URL filter name when building) |
| Brand cases strip | One "Brand cases" link inside Brands. Never for joint agents. After the Brand CRM build finishes with `brands-hub.tsx` |
| `MergeDialog`, out-of-scope list, `LandsecAccessPanel` | "Landsec admin" block at the foot of Properties, BGP staff only. Out-of-scope rows are not links there: once the limit in section 5 applies, staff in the Landsec view are refused those records and must open them from All Teams |

**Dropped as duplicate:** the "Landsec portfolio" heading and totals, the unrendered `viewer` field, and the client-side `isLandsecView` landlord-name filter in `PropertiesList`. That filter must go before joint agents arrive: it finds Landsec through `/api/crm/companies`, which they will not get in full, and would blank their list.

**A card or row opens** the property page (`/properties/<id>`, `PropertyDetail`), the scheme's main record.

**The scheme page is folded in** as a "Units and lettings" section on the property page.
- Keep `GET /api/landsec/scheme/:key`: the brand case page's unit picker also uses it (`landsec-brand-case.tsx`).
- The property page knows a property id, not a scheme key: add a by-property lookup to that endpoint.
- `/landsec/scheme/:key` must redirect, not vanish: the Brand CRM build emits that link (`links.scheme` in `server/brand-scheme-plan.ts`, asserted in its test), and so do the brand case page and the unit page.

**The unit page (`/landsec/unit/:id`) stays.** Checklist and recommendation emails, `?hots=1`, `?checklist=1`, `?recommendation=1`, the Brand CRM's `links.unitPage` and the brand case all point at it. Breadcrumb becomes Properties, the property, the unit. It imports `StatusPill` from `landsec-scheme.tsx` and `BriefCheck` from `landsec-deals.tsx`: move both (and `StageChip`, `WaitingOn`, which is not exported today) to a shared file before any page is deleted.

## 4. Deals

**Feed, changed from the plan.** Do not rework `GET /api/crm/deals`. Keep `GET /api/landsec/deals` as the clock feed and have `Deals` join it by deal id when the brand is Landsec. Reasons: it is already limited per viewer; the unit page already refreshes that query after a save; there is one source so nothing can drift; and `server/crm.ts` is left alone. Deals with no scheme property simply show blank clock cells (`PUT /api/landsec/deal/:id/clock` refuses them anyway).

| Lettings benefit | Deals table | `DealKanban` and phone cards |
|---|---|---|
| Days at stage | New column | Chip, amber at 30 days |
| Waiting on (party, name, days, note) | New column, edited in place with `WaitingOn` | One line |
| Depends on | New column | Not shown |
| Net Effective Rent (`landsecNer`) | New column; legacy Rent Analysis stays off | Phone card only |
| Brief check (`BriefCheck`) | New column | Not shown |
| Stuck 30d+, Waiting on each party, No one named | Filter pills with counts, "Stuck first" sort | Board keeps the filter |
| Search on waiting-on name and note | Added | n/a |

Fixes to make in the same step, all from the review and all still open in the code:
- **Stuck means Negotiating, HOTs and Solicitors only** (review 3.4). Every tracker unit now has a Marketing deal, so otherwise the pill is all voids.
- **NER gives false greens** (review 1.9): with no rent free or capital entered, NER equals headline and shows "Meets floor". Show "incentives not recorded" and no pass or fail. Do this before the chip reaches the main Deals page.
- **Depends on can name a deal on a scheme the viewer cannot see** (review 1.6, `clocksFor`). Blank it to "another deal" when outside the viewer's properties.
- **Unit and brief for tracker-linked deals** (review 2.5): the feed finds the unit only through `crm_deals.tenancy_unit_id`. Also follow the tracker link (`available_units.deal_id`), read the Targeting Brief floor (`unit_briefs` commercials `nerFloorPa`) first and fall back to the old `landsec_units.brief_ner_floor`.
- The per-status cards on Deals print a "£0" fee line to client logins (`s.feeTotal` is not behind `isClientDeals`). Hide it.

Also: a "Deal clock" card on `deal-detail.tsx`; the tracker gets days at stage, the waiting-on name and the Stuck pill only.

## 5. The access model

**Storage, corrected.** No schema change, but "empty means ALL" is wrong and unsafe. Today an empty list means no schemes, and unknown keys are dropped, so a renamed key would silently become ALL. Use: `schemes = NULL` is ALL (leasing manager rows already store NULL); an empty list is nothing. `/api/auth/me` sends `landsecSchemes || []`, which cannot tell the two apart: add an explicit all-properties flag. `setupLandsecAccessRoutes` and `landsecViewer` change so any role may be ALL or a list.

**Limited login** below means: has a list, or is a joint agent. The client must key on that (`ClientRouteGuard` keys on `landsecRole` today, so a leasing manager with a list would get the full route list).

**Scheme by name is a hazard, not a benefit** (review 3.6). Scheme membership is a name match. A Landsec login can rename a property (PUT `/api/crm/properties/:id` is open to clients); the review saw a rename lock an agent out and a new record fall into another scheme. With the property list as the only limit, either store an admin-assigned scheme on the property (needs Woody's OK: schema change) or, at least, stop limited logins renaming properties and hold new name matches for staff.

**The one filter**
- New `landsecPropertyLimit(req)` in `server/landsec-access.ts`, resolved once per request beside `landsecAiLockMiddleware` and held in the same kind of request context.
- **That context is lost after a file upload** (the reason `server/utils/upload.ts` `relock` exists). `relock` must restore the limit too, with a test that uploads as a limited login against an out-of-list unit.
- **Fail closed:** `getLandsecAccess` swallows a failed lookup (`.catch(() => ({ rows: [] }))`), which turns a joint agent into a full login for that request (review 1.7). Remove it.
- Enforced in `isPropertyInScope`, `isDealInScope` (a deal counts only if its property is in the limit) and one SQL helper added by hand to the lists.
- **Stage it:** apply the limit for limited logins first. Applying the 14-scheme rule to today's full logins and staff is a separate switch, after Woody has seen the list of what would leave (decision 3).
- New deals from a Landsec login must carry a property in the limit, or the creator cannot see what they just made.
- Caches: `getClientCrmContext` caches by company (`crmContext:client:<company>`); key by the property list too.
- `briefSchemePropertyIds` becomes a wrapper. `landsecPlanViewer` in `server/brand-scheme-plan.ts` (the Brand CRM build) hard-codes "leasing sees all, the other two use their list": it must change in the same commit, or an asset manager on ALL sees nothing there and a leasing manager with a list sees everything.

**Endpoints.** The plan's table stands, with these additions that use their own company-scope SQL and are not caught by the three chokepoints:

| Route | Why |
|---|---|
| `GET /api/crm/companies/:id/deals` and `/properties` | With the Landsec company's own id these return every Landsec deal and property. An asset manager can call this today (the `ASSET_MANAGER_READS` prefix); the id is in `/api/auth/me` and `/api/landsec/home` |
| `GET /api/brands/:id/portfolio-activity`, `/tracker-comments`, `/suggested-pitches`; `/api/crm/companies/:companyId/property-summary`, `/contact-summary`; `/api/brands/hub`; `/api/turnover` | Brand pages show offers, viewings and deals across all schemes (review 1.6). Under the new rule a login with a list gets the full brand list but these sections limited to its properties |
| `GET /api/available-units/:id/offers` and `all-offers` | Return raw offer rows (contact name, comments, company id). `unit-negotiation.ts` blanks these for a joint agent; the older lists do not |
| Viewings and interest lists; viewings in `GET /api/landsec/unit/:id` | Carry brand contact names (review 1.12, still sent today) |
| `GET /api/available-units/matches/:unitId` | Requirement matches: a brand list by another door. Refuse for joint agents |
| `GET /api/search` | Returns contacts and brands. Properties only for joint agents |
| `/api/properties/:id/linked-contacts`, `/api/activity-summary`, `/api/deals/:id/timeline`, `/api/activity/deal/:id` | Contacts and email-derived activity. Refuse for joint agents and hide the Contacts and Activity sections for them, as well as Brand gap and Compliance |
| `PUT /api/landsec/unit/:id` | No joint agent check: a joint agent can rewrite the old Agreed brief, ERV and solicitor details (review 1.8) |

`/api/crm/fee-allocations` needs nothing: it already returns empty to client logins.

**Gateway, corrected.** The plan said a limited login "never falls through to `CLIENT_ALLOWED_API`". That is the fault behind review 1.5: today `restrictedLandsecApiDecision` returning "allow" skips `CLIENT_BLOCKED_SUBPATHS` and the visible-brand checks, so an asset manager reads BGP's file on any company. The new `LIMITED_LANDSEC_API` list must only narrow: a request must be on it AND pass the normal client checks. It names only routes with a passing test.

**Route jail.** For limited logins: `/deals`, `/properties`, `/available`, `/landsec`, `/tenancy-schedule`, `/messages`, `/chatbgp`, `/settings/profile`, plus `/brands` and `/companies` unless a joint agent.

**Code that assumes "these roles have no tracker or deal page"** and must flip when they get them: `dealUrl` in `server/unit-hots.ts`, `way` in `server/unit-recommendation.ts`, the email link in `server/deal-checklist.ts`, `canOpenRecords` in `server/brand-scheme-plan.ts`. `hasTaskList` stays (My Tasks is not opened to limited logins).

**Joint agents and brands.** As the plan: brand names and logos wherever a unit, deal, offer or tenancy row names them; targets through `targetForViewer`; refused `/api/brands/*`, `/api/brand/*`, `/api/crm/companies/:id*`, `/api/client/crm/*`, `/api/covenant/*`, `/api/crm/contacts*`, `/api/crm/requirements-*`, `/api/crm/engagement/*`, `/api/landsec/brand-case*`, `/api/crm/deals/:id/related-emails`, plus `/api/brand-crm/*`; `GET /api/crm/companies` names only. The Brand CRM build gives a joint agent a grid for its own schemes (`GET /api/landsec/brand-crm/plan`); with no Brands entry they cannot reach it (decision 8).

**Removing a login's role** (the bin on `LandsecAccessPanel`) deletes the row, and no row means ALL with brands and chat (review 1.7). It must deactivate a joint agent or asset manager login behind a confirm.

**Chat, open to every Landsec login**
- Today: a block-list (`CLIENT_BLOCKED_TOOLS`), everything else open and scoped by company in `getClientCrmContext`, `clientScopedCrmSearch` and `chatCrmWriteDenial`. Asset managers and joint agents are refused `/api/chatbgp/` and `/api/chat/threads` at the gateway.
- **Corrected:** the limit does not reach "every tool call" by travelling with the request. Most tool handlers run their own SQL (five `isPropertyInScope` calls in the whole of `chatbgp.ts`). So:
  - ALL logins: the block-list as now.
  - Login with a list: an allow-list, applied where tools are offered (`filterToolsForClientScope`), where they run (`executeCrmToolRaw`, the one client chokepoint) and at the two chat-loop gates. Start with `search_crm`, `navigate_to`, `log_viewing`, `log_offer`, `update_available_unit`, `update_deal` and tasks. Each handler is read and tested before it is listed; a new tool is closed until added.
  - `getClientCrmContext`, `clientScopedCrmSearch` and `chatCrmWriteDenial` take the property list as an argument.
  - Joint agent: the same list, no brand, covenant, company, contact or requirement tools; `navigate_to` refuses `contacts`, `companies` and `requirements` (it has two copies in the file).
  - `CLIENT_SYSTEM_PROMPT` promises the full toolset: limited logins need their own wording.
- Gateway for limited logins: `/api/chatbgp/*`, `/api/chat/threads*`, `/api/chat/upload`, `/api/chat-media/`, `/api/chat/notifications`. Not `/api/chat/tag-search` or `threads-tagging` until limited.
- Until step 8 the chat rail still shows to the two roles and cannot work; hide it for them.

**Before it is safe to switch on:** the plan's four checks (table-driven route test, the same through chat, cache keys, a non-Landsec client and All Teams staff unchanged), plus the upload test and the brand-page test above.

**Order:** full logins and staff, then asset managers, then joint agents, then chat for limited logins.

## 6. Redirects, tests, app map

| Old address | Goes to |
|---|---|
| `/`, `/home` (Landsec) | `/deals/properties` (see section 2 for who is excluded) |
| `/landsec/deals` | `/deals` |
| `/landsec/scheme/:key` | The scheme's property page, Units section |
| `/available` | **No redirect.** It is the same component as `/deals/letting`, and about twenty links across the app carry query strings to it (`?propertyId=&unitId=`, `?workspace=viewings`, `?pitchBrand=`, the Brand CRM's `links.tracker`). Leave it working and light Letting Tracker on it |
| `/landsec/unit/:id`, `/landsec/brand-cases`, `/landsec/brand-case/:id`, `/chatbgp` | Unchanged |

- **App map** (`server/chatbgp-app-map.ts`): line 46 (phone tabs); line 47, which holds the menu, the scheme page, the unit page breadcrumb, brand cases "strip on the Landsec home" and the logins-by-role paragraph; lines 118 to 119; line 150 (asset managers and joint agents "on the Landsec unit page"). Also `navigate_to`'s page list.
- **Docs:** `CLAUDE.md` (the "Decided" paragraph and "have no Letting Tracker"), `docs/landsec-pitch-plan.md`, the header of `server/landsec-access.ts`, `LANDSEC_ROLES` scope wording in `shared/landsec.ts`, `docs/brand-crm-spec-2026-11-12.md` (link list).
- **Tests:** `server/brand-scheme-plan.test.ts` asserts the `/landsec/scheme/` and `/available?` links and `restrictedLandsecApiDecision`; `qa/regression/frontend-routes.test.ts` reads `CLIENT_ALLOWED_ROUTES`; `e2e/audit-landsec-visual.spec.ts` shoots `/` as "dashboard". No test uses the menu test ids.

## 7. One set of numbers

As the plan: a Landsec property is a record matching one of the 14 schemes and the count shown is schemes; a Landsec deal is a deal on a Landsec property; a live letting is a letting-type deal at Marketing, Negotiating, HOTs or Solicitors, counted from the deal. One `landsecCounts(propertyIds)` feeds the Properties header, the scheme cards, the Deals cards and the tracker pills, replacing `schemePipelines` (which counts the tracker row's raw status and takes "oldest live deal" from last-updated, not days at stage). The tracker and Deals agree only when every row has a deal and every live letting a row (129 against 109 on 11 November); staff see the gap as a chip to `GET /api/admin/letting-integrity`; repair is admin Preview then Apply only. This is review items 1.14 and 2.5.

## 8. Build steps

| # | Step | Files and components | Test with |
|---|---|---|---|
| 1 | One rule and counts; staff list of what the 14-scheme rule would remove | `server/landsec-schemes.ts`, `server/landsec-home.ts` | Full login: three headers match |
| 2 | Deals gets the clock, with the Stuck, NER, depends-on and unit-link fixes | Shared clock components; `GET /api/landsec/deals`; `Deals`, `DealKanban`, `deal-detail.tsx`, tracker status cell | Each stuck deal reads the same on the unit page and Deals |
| 3 | Properties gets the cards and the Units section | Shared `SchemeCard`; `PropertiesList`, `PropertiesBoardHeader`, `property-detail.tsx`; admin block | Full login; BGP admin |
| 4 | Menu, landing, redirects, for full logins and staff only | `LANDSEC_NAV`, `landsecNavFor`, `LANDSEC_NAV_ITEMS`, both `isActive` rules, `Home`, phone `/` branch, `DealsHub`, app map. After the Brand CRM build lands | Desktop and phone; staff on a phone can still exit; another client unchanged |
| 5 | Close the open review holes (1.5, 1.6, 1.7, 1.8, 1.12), then the property filter with the gateway still closed | `server/landsec-access.ts`, `server/company-scope.ts`, `server/utils/upload.ts`, the lists in section 5, cache keys, tests | All login types plus a non-Landsec client |
| 6 | Open to asset managers | `LIMITED_LANDSEC_API`, route list, `LandsecAccessPanel`, `landsecPlanViewer`, the role-assuming links | Asset manager with two schemes; leasing manager with a list |
| 7 | Open to joint agents | Brand refusals, stripped offers and viewings, hidden sections | Joint agent, one scheme: no brand page or contact by menu, link, URL or API |
| 8 | Chat for limited logins | `server/chatbgp.ts`, gateway, phone Chat tab | Joint agent asks about another scheme and a brand profile; both refused |
| 9 | Delete the old pages only | `LandsecHome`, `LandsecDeals`, `LandsecScheme`. Keep `/api/landsec/home`, `/api/landsec/deals`, `/api/landsec/scheme/:key` | Old links redirect |

Every screen touched is brought to `docs/DESIGN.md` in the same commit.

## 9. Decisions for Woody

1. **Have any asset manager or joint agent logins been given out?** If yes, the holes in step 5 are live now and come first.
2. **Timing against the pitch (w/c 23 November):** steps 1 to 4 before it; the access rebuild (5 to 8) after, unless those logins must be shown in the room. I recommend after.
3. **Should deals on Landsec properties outside the 14 schemes leave the Landsec view?** I recommend yes, once you have seen the list from step 1.
4. **Can a joint agent add viewings, offers, units and deals, or only read?** Your new rule says "the same"; earlier decisions made them read-only on the brief, HOTs and negotiation log. I recommend viewings and offers yes, no deletes, the rest as decided.
5. **Retire the older Agreed brief card for the Targeting Brief?**
6. **A joint agent naming a brand not on their properties:** type the name (recommended) or a names-only search?
7. **Brand cases:** a link inside Brands (recommended) or a strip on Properties?
8. **Joint agents and the Brand CRM grid for their own schemes:** none (recommended, it is a brand board) or keep it somewhere?
9. **Let an admin set each property's scheme instead of matching by name?** Needs a database change. I recommend yes before joint agents go live.
10. **Phone:** labels "Tracker" and "Chat"; the old phone tiles (Requirements, Images, CRM, Calendar, News) go for Landsec logins.
11. **Property page sections not yet covered** (Image Studio, Property Intelligence, SharePoint files) hidden for logins with a list until each is done? I recommend yes.

---

# WHAT I CHANGED AND WHY

1. **Gateway rule reversed.** The plan's "never falls through to the client list" repeats the fault behind review 1.5 (confirmed in `server/index.ts`: "allow" returns before the blocked sub-paths and brand checks). The limited list must narrow, then pass the normal checks.
2. **"Empty list means ALL" removed.** Today empty means nothing; flipping it makes a bad key fail open. ALL is stored as NULL.
3. **Name matching reclassified as a risk** (review 3.6), with a decision added.
4. **Request context is lost on uploads** (`relock` in `server/utils/upload.ts`); the limit must be restored there. Also the swallowed lookup error in `getLandsecAccess`.
5. **Chat claim corrected.** The limit does not cover tool calls by itself; tools need an allow-list at three named places and the three scope functions need the list as an argument.
6. **Routes the plan missed**, each read in the code: company deals and properties by Landsec's own id, the brand page activity routes, raw offer lists, requirement matches, global search, linked contacts and activity, `PUT /api/landsec/unit/:id`.
7. **Deals feed simplified:** join `GET /api/landsec/deals` rather than rework `GET /api/crm/deals`.
8. **Review fixes folded into step 2** (Stuck swamped by Marketing, NER false greens, depends-on leak, unit link) so known wrong answers are not promoted onto the main Deals page.
9. **`/available` not redirected:** many live deep links with query strings, including the Brand CRM's.
10. **Other session's dependencies named:** `StatusPill` and `BriefCheck` imports, the brand case unit picker's use of the scheme endpoint, Brand CRM links and `landsecPlanViewer`, the role-assuming links in HOTs, checklist and recommendation. Step 9 keeps three endpoints the plan would have deleted.
11. **Redirect loop** for restricted roles in step 4, and **staff phone exit** via `MobileHome`, both added.
12. **Menu highlight** turned from "to check" into a stated fault with the rule.
13. **Role removal** (the bin) added: it silently makes a joint agent a full login.
14. Decisions grew from 8 to 11 (timing, Brand CRM grid for joint agents, admin-set scheme).

Not verified: anything on live data; the Deals URL filter name for stage pills; whether each chat tool handler checks the property (none was tested).

---

# SUMMARY FOR WOODY

**What Portfolio and Lettings gave that Properties and Deals did not**
- Portfolio: the 14 schemes as cards in four groups with units, vacancy, stage counts and rent; schemes with no record yet; the staff tools (merge duplicates, logins).
- Lettings: days at each stage, who a deal is waiting on, what it depends on, Net Effective Rent against the brief, and the "stuck" filters.

**What moves where**
- The scheme cards become the top of Properties; the scheme page becomes a "Units and lettings" section on the property page.
- The clock columns and filters go onto Deals, the board and the deal page.
- The unit page stays, because emails and Heads of Terms link to it.
- Ask goes; chat is the panel on the right and a Chat tab on the phone.

**Side bar**
- Landsec staff and asset managers: Properties, Deals, Letting Tracker, Brands.
- Joint agents: Properties, Deals, Letting Tracker.

**The catch**
Putting asset managers and joint agents on the real pages is the risky part. Yesterday's review found they can already reach things they should not, and I confirmed three of those are still open. I recommend the menu work before the pitch and the access change after.

**Your decisions:** whether those logins exist yet; timing; whether deals outside the 14 schemes drop out; what joint agents may edit; retiring the old Agreed brief; and whether an admin sets each property's scheme.

Files: `/home/user/bgp-wip-app/docs/landsec-review-2026-11-12.md` (the review cited), `/home/user/bgp-wip-app/server/landsec-access.ts`, `/home/user/bgp-wip-app/server/index.ts`, `/home/user/bgp-wip-app/server/brand-scheme-plan.ts`, `/home/user/bgp-wip-app/server/utils/upload.ts`, `/home/user/bgp-wip-app/server/chatbgp.ts`, `/home/user/bgp-wip-app/client/src/App.tsx`, `/home/user/bgp-wip-app/client/src/components/app-sidebar.tsx`, `/home/user/bgp-wip-app/client/src/components/mobile-bottom-nav.tsx`.

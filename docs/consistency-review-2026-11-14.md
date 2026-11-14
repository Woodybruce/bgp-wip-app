# Consistency review: landlord, brand, property, deal, contact pages and the Letting Tracker (14 November 2026)

Woody, 2026-11-14: "the upgrades we made with the Landlord pages havent been
used particularly well to help with the brand pages and the property pages ...
We need consistency so that its all linked in CRM and properties and chat and
deals / letting tracker ... review where we have doubled up and then merge
these to use the best qualities of each one", then "make sure tenancy schedule
and plans are all linked too". A read-only review; nothing was changed. Each
item: where the job is done today, the best version, the merge, its size and
the data rules that must hold. Nothing here is built until Woody approves.

## 1. Units tied together: schedule, plan, tracker, deal (do first)

- Today three pairs of pointers tie a unit (`available_units.tenancy_unit_id` /
  `tenancy_schedule_units.letting_tracker_unit_id`, `property_unit_id` =
  `unit_id`, and the name), plus three for its deal (`crm_deals.tenancy_unit_id`,
  `available_units.deal_id`, `tenancy_schedule_units.deal_id`). The unit feed
  (`server/property-units.ts`) picks a winner; the schedule screen does not use
  the feed and matches by unit number and the deal's NAME
  (`findTenancyUnitLink`, `PropertyTenancySchedule.tsx:1300`; `/links` does not
  send `crm_deals.tenancy_unit_id`). The schedule's auto-knit stamps ids by
  `lower(trim(unit_name))` (`tenancy-schedule.ts:400`), not `normUnitSql`.
- Jumps: the unit panel is the best (schedule `?unitId=`, deal, tracker
  `unitId`). Missing or lossy: schedule "LT" badge to bare `/deals/letting`,
  targets to bare `/available`, chat unit tag `tagPath("unit")` to bare
  `/available`, deal page to the tracker by property only and no "Show on plan",
  tracker row to the property only (no schedule row or plan).
- Same field, different reading: Vacant counted by the schedule's own test
  against `unitOccupancy`; letting stage as raw `marketing_status` against
  `unitStage`; rent from three sources (passing, asking, deal) unlabelled.
- Merge: (a) one `unitHref` / `scheduleHref` / `planHref` from the unit panel,
  used by the schedule badges, chat tags, deal page and tracker row (small);
  (b) the schedule screen takes its deal and tracker ties from the unit feed,
  no deal-name fallback (medium); (c) the schedule's Vacant count and status
  chips from `unitOccupancy` / `unitStage` (small); (d) auto-knit stops
  stamping by name; disagreeing pointers go on the letting-integrity report
  (medium). Risk: which deal a row shows can change; check against
  `GET /api/admin/letting-integrity` first. Joint agent keeps its own tracker
  path. Keep the guard that holds the two SQL copies in step.

## 2. People on a record

- Landlord: `CompanyContactsBoard` + `KeyContactRow` (richest: email and
  meeting history and counts, linked records, mark as left, AI flags, inbox
  suggestions). Property: `people-board.tsx` adapter onto `KeyContactRow`
  (best on viewer safety, groups, role at the property, per-unit blocks, CRM
  plan per person) but passes no counts, so history cannot be opened. Deal:
  "Linked Contacts" plain cards from a full `/api/crm/contacts` download.
  Brand phone builds tenant reps inline. Tracker: client contact as a link only.
- Merge: `KeyContactRow` is the one row; the property adapter becomes the
  general RecordPerson adapter carrying staff-only counts, avatar, LinkedIn and
  mark-as-left (added to `recordPersonForViewer`'s staff list);
  `/api/deals/:id/people` on the same shape for the deal page; `TenantRepsBlock`
  on the phone. Medium. Risk: counts never to a client; the server flags decide,
  not `rowIsClient`; no brand contact names to a joint agent.

## 3. BGP side ("who covers it")

- Landlord `LandlordRelationshipTeam` (roles, emails, meetings, history) vs
  brand `bgpTeamRow` / `CovererChip`, phone text, property initials rows plus
  `InlineAgents`, deal plain text. Merge: `LandlordRelationshipTeam` everywhere,
  its read widened to brands and properties. Medium.

## 4. Record conversation

- `CompanyMiniChat` on landlord, brand, property; deal has append-only
  `DealComments` (no tags, no ChatBGP) though the server already handles deal
  threads. Landlord-only extras behind the `landlord` prop: the new bubble,
  take refresh on a new message, confirmed CRM actions with Open links.
  Property lacks the brand's Tracker tab. `TaggedConversationsPanel` only on
  the classic property page.
- Merge: one `RecordConversation` (company / property / deal), landlord extras
  on for all, property gets "Unit comments", deal swaps `DealComments` for it
  with the old comments kept read-only, tagged conversations on every record
  page. Target and brief comments stay as they are (own visibility rules).
  Medium. Risk: no deal-linked conversation for a joint agent
  (`jointAgentLinkAllowed`).

## 5. BGP take (AI summary)

- Brand and landlord `BgpTakeStrip` + `server/brand-ai-take.ts`: refreshes
  itself when the data changes, ends "Next step", names are links. Property
  `BgpCommentaryCard`: stored, refreshed only by hand, four bullets, no links.
  Deal: none.
- Merge: `BgpTakeStrip` for company / property / deal; the property prompt
  moves onto that path with "Next step", automatic refresh and links; a deal
  take from the clock and checklist. Medium. Risk: no fees (client-cut deal);
  Landsec-restricted logins keep their limits.

## 6. CRM plan and "next action"

- `LandlordEngagementPanel` on landlord and brand, gated two ways (an email
  suffix on landlord pages, `isClientViewer` on brand). Three meanings of next
  action: plan actions, `user_tasks`, the deal checklist. Deal and contact pages
  show no plan; the property board shows a per-person next action that the
  landlord board does not.
- Merge: keep the panel; per-person "Next: … · In strategy" on landlord and
  brand rows; a plan line on contact and deal pages; one staff test (server
  flags). Medium. Risk: `clientPlanView`, share marker stay server-side.

## 7. Activity and last contact

- `ActivitySummary` (property, phone company view), landlord email and meeting
  summaries, brand email-history dialog, deal `AIActivityCard` /
  `DealTimeline` / audit / comments, contact `InteractionsBoard`. Unit panel
  keeps its own viewing words. At least five "last contact" calculations; two
  can read negative or "today" for a future date.
- Merge: `ActivitySummary` as the one recent-and-upcoming feed (add deal and
  contact scopes), landlord summaries as its drill-down, shared viewing rows;
  `shared/last-contact.ts` everywhere. Large (feed), small (last contact).

## 8. Files, news, company chips, layout

- Files: `PropertyFoldersPanel` already shared (good). Tracker unit files have
  three screens; extract one `UnitFilesPanel` (also on the unit panel and deal
  page); deal page gives clients their data room. Medium. Keep `upload`-only
  public files and the final HOTs rule.
- News: three list styles and two Instagram components; the landlord "News &
  social" card as the shell, `BrandNewsMedia` as the list, one
  `InstagramPreview`. Small to medium.
- Company rows: one `CompanyChip` (logo, initials fallback, link, role pill) on
  people, deal parties, tracker, viewings, deal boards; tracker tenant by the
  feed's brand id, not by name; one stage pill. Small to medium.
- Layout: `BrandCard` as the one card shell; a shared `?section=` hook from the
  brand page for property, deal, landlord; deal header actions into a More
  menu; the property intro row as the pattern for deal and brand. Large, page
  by page.

## Side finding

- The brand page counts live requirements as `status === "Active"`
  (`brand-profile-panel.tsx:908`, `:1854`), against the one live rule in
  `shared/requirement-live.ts`. Small fix.

## Proposed order

1. Units tied together (section 1) and the last-contact rule, the requirement
   count fix and `CompanyChip`: the links the team uses daily.
2. People (2) and the BGP side (3): one row and one team block everywhere.
3. Conversation (4) and the take (5) on every record, the deal page included.
4. Plan (6) and activity (7).
5. Files, news and layout (8), page by page.

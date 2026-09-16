# Simpler property views — 16 September 2026

Implemented on `claude/terminal-coding-interface-JOGQK`. Validation below uses a disposable local app and does not establish production deployment status.

## Layouts

- **Building:** property identity, ownership and existing business-field editors, weekly actions, recorded passing rent, tenant cards and next lease events. Other boards open through the section pills.
- **Multi-let / mixed-use:** the same overview with an editable compact tenancy schedule on the overview. The schedule starts with nine essential fields, including area and passing rent ahead of the lease dates. Floor/use filters, row actions, plan links, exports and the full schedule remain available.
- **Shopping centre / estate:** retains the existing full property board and its reference column.

The `Property layout` choice is saved on the same property record as `propertyView`. It is independent of asset class, ownership and permissions. Automatic uses explicit centre/estate classifications or recorded current tenancy identities to suggest a layout. Retail alone does not imply a centre. Missing, failed or tracker-only schedules do not produce a single-building recommendation; the full page remains available until the user chooses a layout.

Building and multi-let pages have Overview, Tenancy, Plans, Deals & units, Files & contacts, KYC, Activity and Research sections. **Show full page** restores the existing board without changing the saved layout. **Return to simple view** reverses it. Research includes the existing news, risks, brand-gap and property-intelligence tools. Notes/commentary remain under Activity; brochures and images remain under Files & contacts with their existing permissions.

Unvisited simple-view sections defer mounting integrations. Once visited, their component state remains mounted when switching sections or layouts, preserving unfinished edits. Plan deep links open the Plans section. Opening tenancy from the summary also reopens a collapsed schedule.

## Data and access

- All summaries and edits use the existing canonical tenancy query and endpoints. There is no copied schedule or separate small-building record.
- Missing rent stays unknown. A partial rent total states how many rows have a recorded rent. Dates use the calendar-date helper; past recorded dates prompt a review rather than disappearing.
- Compact column preferences are separate from full-board preferences. The dedicated full-schedule route always uses the full presentation.
- Client property/schedule editing stays scoped by the existing server checks. Saving a layout does not change access. Staff-only imports, research and internal controls retain their current permissions.
- Additive migration `0037_property_view.sql` and startup DDL introduce the nullable field with an allowed-value constraint. POST/PUT reject invalid choices before writing.
- Structured address display now includes line1/line2 and postcode when those are the recorded fields.

## Verification

- 436 regression tests pass, including new inference, missing-data, compact-column preference, draft-preservation and scoped-write checks.
- Eight isolated PostgreSQL checks pass: repeatable migration, real Drizzle reads/writes for every layout and automatic reset, invalid-value rejection, and preservation of existing fields.
- Browser QA used disposable synthetic one-unit, three-unit mixed-use, six-unit centre and empty-property fixtures. Both staff and scoped-client accounts were used.
- The client's saved Building choice survived reload. Editing a rent in the compact schedule changed the summary total from £210,000 to £211,000 immediately; the test value was restored. Files/contacts remained accessible, a tenancy row opened its plan, and Show full page restored 53 data columns plus their group headings/actions.
- Staff automatic one-unit and mixed-use overviews displayed the expected summaries; the mixed-use schedule remained editable on the overview.
- A freshly seeded property with no schedule showed no automatic recommendation. Explicit Building selection displayed a missing-data message and led to the existing Add Unit / Import controls, without invented occupancy or rent totals.
- The final build displayed the revised rent-first compact column order and complete structured address. A 900px browser viewport had no page or layout-control horizontal overflow.
- TypeScript, the production client/server build and `git diff --check` passed. Build/check/regression logs are in the workspace's `audit-evidence/property-views-20260916` folder.

Live production integrations and the separate physical-phone shell are not certified by these local layout checks. Earlier plan-scanning limitations remain: this presentation change does not establish the accuracy of a live Brent Cross scan.

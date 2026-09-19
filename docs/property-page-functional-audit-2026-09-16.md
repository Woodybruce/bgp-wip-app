# Existing property page: functional audit

This audit repairs the existing page before introducing simpler views for small or mixed-use properties. The current sections, records, links and layout remain available. Implemented on `claude/terminal-coding-interface-JOGQK`; validation below does not establish production deployment status.

## Confirmed defects repaired

- **Client tenancy editing:** row add/edit/delete controls now follow the existing property-scoped server permissions. Import, bulk operations and administrative re-sync retain their existing staff restrictions. The empty schedule can open its Add Unit form, including the optional unified dialog.
- **Unit identity:** renaming a tenancy retains its linked tracker/leasing records. Schedule reads use stable links before legacy names, preventing an existing unit from reappearing as a duplicate vacancy.
- **Property edits:** multiple asset classes survive editing. Ordinary tenancy saves refresh property metrics. Creating a tracker entry after a status change waits for the tenancy save to succeed. Re-sync reads the actual response before reporting its counts.
- **Research identity:** complete postcodes and canonical UPRNs are used; “Unit A1” is no longer treated as a postcode. Candidate discovery preserves user-entered property names. AI title recommendations require the existing explicit selection action instead of automatically changing ownership.
- **Enrichment results:** the explicit action waits for research and persistence, reports unavailable/no-match/review/partial outcomes, records the authenticated researcher against the correct property, and prevents duplicate concurrent lookups. Safe exact matches fill missing details while keeping existing owner links and KYC decisions. Failed or empty title lookups do not write a purported result. The page and ChatBGP no longer claim that an unstarted background job is running.
- **Metrics and commentary:** occupancy comes from the tenancy schedule, with a labelled legacy fallback. Missing, failed or ambiguous data does not become zero vacancy or a clean risk assessment. Commentary generation preserves existing text when its required inputs are incomplete. Current tasks feed the commentary context.
- **Live counts:** Heads of Terms is included in live totals and its proper pipeline stage. Failed reads show an error rather than “nothing live.”
- **Task actions:** colleague tasks remain visible; completion is available only where the task owner/assigner and linked-record permissions permit it.
- **Access checks:** a client cannot move a listing or link a task to another portfolio. Normal authorised property, tenancy, listing and task edits remain available.

## Validation coverage

Used an isolated PostgreSQL database and compiled local app with synthetic fixtures: one-unit building, three-unit mixed-use building, six-unit shopping centre, empty property and inaccessible property. Staff and client identities were tested. Provider/email credentials were absent.

| Area | Checks |
| --- | --- |
| Property page | Detail reads, inline area save, multiple asset-class save, persistence after navigation |
| Notes and tasks | Note save; task create/complete; task capability and cross-portfolio checks |
| Tenancy | Empty Add Unit, client inline edit, row add/update/delete, rename identity, genuine vacancy preservation, full-board navigation |
| Summaries | Known occupancy, missing/error states, HoTs totals, stage breakdown, saved commentary preservation |
| Linked records | Contact/deal/plan/brochure endpoint reads; scoped foreign-property denial |
| Files | Actual PDF canvas preview, original plan image loading, cookie-only file access, staff brochure metadata edits |
| Export | Staff and client Excel responses parsed successfully as workbooks |
| Enrichment | Mocked unavailable/empty/ambiguous/exact results; actual PostgreSQL transactions, rollback, concurrent edits and duplicate-request locking |

Final validation: **393 regression tests passed**, `npm run check` passed, the production client/server build passed, and `git diff --check` was clean. Three isolated PostgreSQL suites passed **25 checks** (8 brief, 7 enrichment, 10 tenancy identity). The compiled app passed **34 HTTP write/access/persistence assertions**, followed by final checks of rename counts/stable IDs and task capabilities.

Browser checks confirmed saved notes, area and multiple asset classes; task creation/completion; client inline tenancy editing and empty-schedule unit creation; full-board navigation; contact/deal navigation; PDF canvas and original plan image rendering; pipeline drill-down; and denial of an unrelated property. After the last rebuild, the client’s saved floor edit remained visible, a colleague task remained visible without a completion button, and the client could create and complete their own task. Both staff and client Excel exports parsed as valid workbooks.

Database regression scripts require explicit disposable-database opt-in and clean up their isolated schemas. Browser tests exercise real controls; no live property records are changed. No push or deployment was performed.

## Limits and follow-up

This is not certification of every integration. Live Land Registry, Companies House, OS/VOA, AI generation, Microsoft/SharePoint and image-provider results remain unverified with production credentials. The local dump lacks some historical project-file/instruction tables; those limitations were recorded, not concealed by fabricated schemas. No mobile device pass was performed in this audit.

The full rent roll remains wide and needs horizontal scrolling. A future simpler default view should preserve a route to the full board and every existing section. Existing staff-only document-editing and research controls have not been broadly re-permissioned by this audit.

The previously implemented three evidence-plan label modes are a separate pending change and are not a claim that live auto-scanning has passed this property-page audit.

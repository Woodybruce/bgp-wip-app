# Leasing viewings in the Letting Tracker

Implemented on `claude/terminal-coding-interface-JOGQK`. This change extends the existing tracker; `unit_viewings` and `unit_offers` remain the records used by unit pages, the calendar, ChatBGP and reporting.

## How the team uses it

1. Put **Viewing**, the property/unit, brand and time in the Outlook booking. Invite the brand contact or the named agent acting for that brand.
2. Open **Letting Tracker → Viewings**. Use Week, Upcoming, Needs details or Outcomes due; filter by property, BGP owner or search.
3. Resolve missing details by selecting the tracker unit, actual occupier brand, brand contact and/or representing agent, time and responsible BGP person. Agent employer and occupier brand are separate links.
4. After the visit, choose Attended and an outcome, or Cancelled, No-show or Not a leasing viewing. Add feedback, a next action and a follow-up date.
5. Use **Record offer** to open the existing offer form with its unit, brand and contact filled in. Imported email offers require explicit confirmation before they enter the conversion figures.
6. Link an existing brand requirement, or create a clearly marked draft if none exists. Observed space and location are evidence; they do not overwrite the brand's stated requirements.
7. Add other units on the same visit when relevant. They share the booking identity but retain separate unit outcomes.

Requirements has a **Recently viewing (90d)** filter and dated viewing evidence. Desktop and phone brand pages show confirmed recent and upcoming viewings with links back to the tracker. Existing unit tools, offers, documents, schedules and deal links remain in Units.

## Capture and ownership

- Outlook capture runs through the existing interaction sync and its configured mailbox access and date window (normally 30 days back, 60 ahead). A title containing a viewing term is the explicit signal; this is not a claim that arbitrary diary titles can always be inferred correctly.
- The calendar follows pagination. A partial/failed mailbox scan is reported instead of silently treated as complete; email-sync failure does not prevent that mailbox's calendar scan.
- Matching uses explicit unit evidence and exact CRM emails. Representing agents resolve through current named brand representations or active requirements. Several plausible brands, contacts or units remain for review instead of choosing an arbitrary one.
- BGP ownership comes from the BGP organiser, falling back to the BGP mailbox. Missing/unmatched bookings remain staff-only until attached to a portfolio unit.
- Stable calendar identity deduplicates mirrored invitations and repeat scans. Multi-unit visits retain a shared booking ID. Calendar changes cannot silently overwrite a reported outcome or a human-confirmed identity; material changes require review.
- Calendar cancellations are retained. A booking missing from a complete owner-calendar window is flagged for review, not assumed to be a cancellation. Deleted tracker records retain a tombstone to prevent import resurrection.

## Accountability and reminders

The worker reconciles tasks a minute after startup and every five minutes. Each viewing has at most one active follow-up task, assigned to its BGP owner. Missing details are actionable immediately; missing outcomes become due on the next Monday–Friday working day; a dated next action becomes due on its follow-up date. Bank holidays are not currently modelled.

Updating the viewing resolves its task. Merely ticking off an incomplete viewing task causes it to reopen at the next reconciliation. Unassigned bookings remain visible in Needs details; they cannot be emailed to an invented owner.

**Email delivery is off by default.** Set `VIEWING_REMINDER_EMAILS_ENABLED=true` only when the existing shared-mailbox sender is configured and the team is ready for delivery. The worker sends a combined owner digest on Monday and overdue reminders on other weekdays, with a 48-hour overdue threshold. A durable delivery ledger prevents repeated sends in the same period. Failed or uncertain deliveries are recorded; no automatic resend in that period risks a duplicate.

This implementation adds application behaviour, not a Codex reminder or a separate external calendar. No live emails were sent during development.

## Business reporting

Open **Letting Tracker → Reports** and choose the viewing period and BGP owner. The report exposes its underlying opportunities and the missing-data counts.

- An opportunity is a confirmed attended **brand + physical unit** pair, starting at its first recorded attended viewing. Repeat visits and duplicate tracker rows for the same physical unit do not create extra opportunities.
- A conversion requires a confirmed offer for that brand and unit, dated from the viewing day through 90 days later. Revisions and multiple offers count once. Unconfirmed email suggestions do not count.
- Conversion to date includes recent opportunities. Mature conversion uses only opportunities with the full 90-day observation window; an empty denominator displays a dash, not 0%.
- Cancelled, no-show, non-leasing, unresolved and unconfirmed records remain visible as coverage or status counts rather than inflating the conversion percentage.
- Owner filtering is applied after establishing the first viewing across the available history, so filtering cannot manufacture a new first visit.
- The older unit Offers counters still count tracker offer rows; they are not the verified conversion KPI.

## Access and deployment

Clients keep edit access to viewings and offers on their own portfolio units. New selections respect the agreed brand CRM slice and named-agent relationships. Existing valid links on an accessible property remain editable even if the current directory slice no longer offers them. Other portfolios and unassigned diary records stay inaccessible. Raw calendar source metadata is removed from client responses.

Additive migrations `0038_leasing_viewings.sql` and `0039_viewing_reminders.sql` are also applied idempotently at application startup. Historical outcomes are normalised conservatively; historical company IDs are not assumed to be verified brands. Existing records may therefore need review before entering conversion reporting. Offer writes and viewing-identity changes use the same row lock to prevent mismatched concurrent edits.

## Validation

Validation uses synthetic records in a disposable local PostgreSQL database and a local browser app with external service credentials absent. Coverage includes import deduplication, uncertainty, cancellation, multi-unit visits, permissions, preserving client edits, optimistic concurrency, atomic offer writes, requirement linking, report cohort mathematics, reminder reconciliation and delivery deduplication. UI regression tests cover dialogs, filters, deep links, phone drawer structure and legacy records.

Browser checks exercise a staff viewing → outcome → requirement draft → existing offer form → report journey, plus scoped client editing. The phone layout preview forces touch detection in a disposable build; it does not substitute for testing on a physical iPhone. Live Microsoft Graph tenant delivery and real mailbox matching still require a post-deployment check. No live data was changed by these QA runs.

Final local results: TypeScript and production build passed; all 507 regression tests passed. PostgreSQL suites passed 19 workflow/access checks, 14 ingestion checks, 16 reminder checks and 9 concurrent offer-write checks. The client phone preview successfully saved and reopened a note on its own property viewing; its drawer and report fit a 390px viewport without horizontal overflow.

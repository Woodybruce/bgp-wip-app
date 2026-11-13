# Contact intelligence everywhere: plan (12 November 2026)

Woody: "the contacts structure we made for the landlords part of the BGP app is really great we should use that across all?", then "just in the smartness of working out who the contact is and the info?"

This is the plan to put the landlord contact engine (who a person really is, their employer, person or shared mailbox, real recent contact, suggestions, per-person history) behind every place the app lists contacts, and to deal with the records minted from email addresses. Three readers mapped the code, a designer wrote the plan and a feasibility check corrected it. Nothing here is built yet, and nothing was checked on live data.

---

# Contact intelligence everywhere: corrected plan

Checked against the code at `/home/user/bgp-wip-app` (HEAD now 355c37a, Brand CRM still editing) and the five other working copies, 12 Nov 2026. Nothing was run in a browser and no live data was counted, so performance points are from reading the queries, and day figures are estimates. The classifier rules were run against sample names in a scratch script: `/tmp/claude-0/-home-user/4c454855-b3ac-5dd1-9467-1529a6518a24/scratchpad/contactintel/classify-test.mjs`.

## Confirmed in code before the plan

- **Three leaks to client logins are real, and each is wider than the draft said.**
  - `GET /api/brand/:id/profile` sends every contact with `interaction_count`, `last_interaction_at`, `enrichment_source`, `last_enriched_at` and `left_note` (a BGP staff note). On the desktop brand page a client's board runs in landlord mode, so it is also ordered by BGP's last contact.
  - `GET /api/crm/contacts`, `GET /api/crm/contacts/:id` and the POST/PUT replies send the whole row (`notes` with "Auto-added from email — <staff name>", `bgpAllocation`, `nextMeetingDate`, `enrichmentSource`). `ContactDetail` prints the notes. The client PUT also passes the raw body to `updateCrmContact`, so a client can write those fields.
  - `GET /api/properties/:id/linked-contacts` (`shape()`) sends `last_interaction`.
- **A real client cannot reach `/api/accounts/:id/workspace`** (not on `CLIENT_ALLOWED_API` or `ASSET_MANAGER_READS`). Staff viewing as a client can, and on a desktop brand page they are shown the client's own people (`contactEntityIds = [scopeCompanyId]`), so the preview differs from what the client sees.
- **The mailbox sync cannot simply stop saving unnamed senders.** `crm_interactions.contact_id` is NOT NULL and `syncEmailsForUser` files an email only against a saved contact. An unsaved sender means the email is not kept, and `PENDING_CONTACT_SUGGESTIONS_SQL` reads only kept emails, so that person would never be suggested either.
- **The old AI check still runs** on desktop pages of companies that are not a landlord, brand or agent (lenders, untyped firms minted from an email domain).
- **One person's email history on a brand is already decided: on, staff only** (CLAUDE.md, Brand CRM). `/home/user/bgp-brandpage` turns it off with a `personHistory` prop and will break `qa/regression/brand-contacts-parity.test.mjs` on merge.

## 1. One contact engine

Not one wrapper over `resolveAccountView`. That function loads properties, deals, unit counts and the team before contacts, and walks the company tree one query per company (up to 500). Three layers instead:

**Layer A, pure rules in `shared/` (no database, runs in browser or server).**
- Identity: `landlordDisplayContacts` / `landlordContactIdentityKeys`, kept where they are. The board keeps calling them (running them twice is harmless); other surfaces call the same functions. One change: **an address the classifier calls a shared mailbox is not an identity key**. Today two different people saved under `info@` merge into one; `promote-sender`'s `identityEmail` already refuses those addresses as identity.
- Kind: new `classifyContact()` in `shared/contact-kind.ts` (section 4).
- Ranking and folding: `compareKeyContacts`, `keyContactHiddenReason`.
- "Name from email": `isEmailPlaceholderName` catches only one-word names ("Dbarker"). Move `placeholderNamesFor` from `server/signature-contact-sync.ts` to shared and use both, so "Rob Hardie" from `rob.hardie@` is caught too.

**Layer B, who is at a company: `loadAccountPeople(companyId, viewer)` in new `server/contact-engine.ts`.** Extract step 4 of `resolveAccountView` into a function both call.
- Landlords: employer tree plus property-linked people, as now.
- Every other company type: employer and confirmed group only. Any company can be hand-linked to a property (`linkCompanyProperty`), and the landlord rule would then put that property's landlord people on an agent's or brand's page.
- A cap and "showing N of M"; the workspace has no limit today (the profile caps at 100).

**Layer C, activity: `ACCOUNT_CONTACT_ACTIVITY_SQL`, staff only, for a bounded list of ids.**
- Its last step joins contacts to events on "id OR address", and the address list goes into one `?|` test. On a firm with thousands of contacts that needs measuring before any flip.
- Its failure is swallowed (`.catch(() => rows: [])`), which would silently turn "most active first" into "A to Z". Return `activity: "unavailable"` and say so on the board.
- Never run across the whole CRM (hub tabs, pickers, search): those use Layer A only.

**Response shape** (one per person):

```ts
type EnginePerson = {
  contactId: string; name: string; nameFromEmail: boolean;
  kind: "person" | "mailbox" | "system" | "unconfirmed"; sharedAddress: boolean;
  role: string | null; roleRank: 0 | 1 | 2;
  email: string | null; phone: string | null; linkedinUrl: string | null; avatarUrl: string | null;
  employer: { companyId: string | null; name: string | null; status: "stored" | "unconfirmed" | "left" };
  records: { contactId: string; email: string | null }[];
  folded: null | "left" | "placeholder" | "mailbox" | "stale";
  // BGP staff only; absent for everyone else:
  kindReason?: string; via?: string[]; propertyNames?: string[]; leftAt?: string; leftNote?: string;
  activity?: { emails; meetings; recent30d; recent90d; lastEmailAt; lastMeetingAt; lastAt } | "unavailable";
  employerCheck?: { suggestedCompanyName: string; findingId: string };
};
```

Employer is never inferred: stored is `company_id`, left is `contact_left_companies`, a different employer is only an open `verifyContact` finding shown to staff. BGP's own staff are never engine contacts (`isInternalAddress`); they come from HR. Suggestions stay on their own endpoints.

**Landlord-only checks to widen** (each is pinned by a test that quotes the source line; the test changes in the same commit):

| Where | Becomes | Test to update |
|---|---|---|
| `landlordStyleContacts`, `staffBrandContacts` | every company type, staff only; never fetched for a client view | `landlord-contact-suggestions.test.mjs` |
| `dismissible` and the dismiss route | any unmerged company (the table is keyed by company only) | `brand-contacts-parity.test.mjs` |
| `hasEmailMetrics`, `canOpenHistory`, linked-record menu | staff, when the data is present | both of the above |
| `compareKeyContacts` `opts.landlord` | activity first when activity is present | `landlord-contact-activity.test.mjs` pins "Brands keep role priority" |
| `useContactsCheck` | retired once the classifier is on those boards | `brand-contacts-check.test.mjs` |

**Stays landlord-only:** the company meeting diary and `LandlordMeetingsHistory` (name-in-subject matching), `getLandlordRelationshipTeam` (overlay its names from HR), Apollo.

## 2. What each login sees

One `contactViewer(req)`: staff is the strictest existing test, `canReadLandlordMeetings` (BGP address, active, not viewing as a client). Landsec roles come from `landsecViewer()`.

| Login | Gets | Never gets |
|---|---|---|
| BGP staff | everything | none |
| Client, leasing manager, asset manager | name, role, email, phone, employer name, kind, records it could already open; for its own company, brands passing `isClientVisibleBrand`, agents under the named-link rule | activity, order by activity, "stale", suggestions, history, notes, source, employer check, `leftNote`, `via`, `propertyNames`, `kindReason`, merged records outside its own visibility |
| Joint agent | only what the Landsec unit and brief handlers already send; nothing on brand or agent companies | all of it |

- The activity query is not run for a non-staff viewer.
- Each row is built by an allow-list, never a spread. **Two allow-lists**: `publicPerson()` for new engine routes, and `clientContactRow()` for `/api/crm/contacts`, which must keep today's key names (`id`, `name`, `role`, `companyId`, `companyName`, `email`, `phone`, `phoneMobile`, `avatarUrl`, `linkedinUrl`) because 27 client files read that list. The same allow-list filters what a client may write.
- A client's identity merge runs only over records it can see.
- Client order: role rank, real name, A to Z.
- Test by value, not only by key name: seed a contact with a canary note, a staff name and interactions, then assert none of them appears in any client reply (profile, contact list, detail, POST/PUT replies, property contacts, Brand Directory, own-contacts, Landsec unit, brief candidates).
- Any new route a client screen calls must sit under an allowed prefix and must not collide with `/api/crm/contacts/:id` (use `/api/crm/contact-picker`, not `/api/contacts/pick` or `/api/crm/contacts/pick`).

## 3. Surface by surface, in priority order

| # | Surface | Change | Effort |
|---|---|---|---|
| 1 | Client brand page | No stats query for `bpScope`; contacts through an allow-list (drops counts, source, `left_note`); same board rule on desktop and phone; workspace not fetched in a client view | small, 0.5d |
| 2 | Client contact list, detail, POST/PUT | `clientContactRow()` in a new file, used at each reply; write allow-list | small, 1d |
| 3 | Property linked contacts | Strip `last_interaction` for clients; merge by identity; fold mailboxes. `PortfolioContactsBoard` only selects by it, lower priority | medium, 1.5d |
| 4 | Mailbox sync and other creators | Section 4 | medium, 1.5d |
| 5 | Staff CRM hub tabs | Counts become people using Layer A in the page (merge, mailboxes out). No activity ranking in the list; activity when a firm is opened | medium, 1.5d |
| 6 | Pickers (deals, tracker, requirements) | One picker over `/api/crm/contact-picker?q=&companyId=`: people first, employer shown, mailboxes last, 20 rows, client-scoped as the list is. Bare-name create checks for an existing person | medium, 3d plus 0.5d a screen |
| 7 | Agent, lender and other company pages | Staff get the landlord-style board, employer-only people, capped; measure the largest agent firm first | medium, 2d |
| 8 | Brand page, staff | Meeting counts (one prop). Per-person meeting list from `crm_interactions` is a new build | small 0.5d; list 2d |
| 9 | Client Brand Directory | Replace one-per-name with the identity merge inside the brand | small, 1d |
| 10 | Contact detail | "Also saved as" links, kind badge, employer status | small, 1d |
| 11 | ChatBGP search and create; global search | Layer A on results; create checks email and LinkedIn first | small, 1.5d |
| 12 | Landsec unit People; brief `people-candidates` | Merge by email or LinkedIn, drop mailboxes | small, 0.5d each |
| 13 | Client Agents tab; client Contacts tab | Import the shared classifier | small, 0.5d |
| 14 | Contact data health | Three clean-up lists (section 4) | large, 4d |
| 15 | Test rewrites for the board flips | The four regression files above | 1.5d |

## 4. The junk

**One classifier, `classifyContact({ name, email, employerName })`.** It judges the address and the name separately. A typed name must be able to win, because the tracker's `isSharedMailbox`, used as the base, returned "mailbox" for "Bill Payne" at `accounts@`, "Mark Press" at `press@` and "Nick Smith" at `info@nicksmith.co.uk`.

- **Address:**
  - system: no-reply, bounce, platform domains, sending subdomains, machine-generated, meeting rooms;
  - role: the exact `GENERIC_LOCAL_PART` list, or made only of mailbox words, or a role word plus a separator and a short non-name remainder such as `info-uk@`;
  - personal: the rest.
- The role list is the union of today's lists. The tracker list alone lacks team, property, properties and acquisitions, so swapping it in would let `promote-sender` and the signature sync start treating `team@` as a person.
- **Verdict:**

| Example | Result |
|---|---|
| "Jo Info", `jo.info@infotech.co.uk` (also the "Info Tech Ltd contact Jo Info" label) | person, name from email |
| "Hello Fresh", `hello@hellofresh.com` | mailbox |
| "Hello Fresh", `partnerships@hellofresh.co.uk` | unconfirmed: the name is the firm's name (missed by every current rule) |
| "Sales", `sales@` | mailbox |
| "Maria Sales"; "David Press" at `press.david@`; "Robert Service" at `service.robert@` | person. The draft's "role word plus separator" rule flagged the last two |
| "Bill Payne", `accounts@acme.co.uk` | person, marked shared address; the address is not used to merge |
| "Accountspayable Paymentrun", "Accountsreceivable", "A1propertysmart (info@)", "898 02 File" | mailbox |
| "0xsheetal", "Acs", "Dbarker", "Locations", "Hr" | unconfirmed |
| "Adam" (first name only) | person, kept |
| `jane.smith@brand.com` saved as the name | person, name from email (the draft's "contains @" rule made this a mailbox) |
| "Do Media", `do.media@` | mailbox by the word list: a known false positive of the short words, corrected only by a stored value |

**Where the flag is stored** (needs your OK). Columns in `shared/schema.ts` are added at boot by `schema-drift.ts`; the index needs a file. 0056 is taken by `/home/user/bgp-req`, so this is 0057:

```sql
ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS person_kind text,
  ADD COLUMN IF NOT EXISTS person_kind_set_by varchar,
  ADD COLUMN IF NOT EXISTS person_kind_set_at timestamp,
  ADD COLUMN IF NOT EXISTS same_person_as varchar;
CREATE INDEX IF NOT EXISTS idx_crm_contacts_same_person_as ON crm_contacts (same_person_as) WHERE same_person_as IS NOT NULL;
```

A stored value beats the rule; `same_person_as` is a fourth identity key, so no record is deleted or repointed. Without the columns, lists are still cleaned on read, but a wrong call cannot be corrected and two addresses for one person cannot be joined.

**Stopping new junk** (`server/email-auto-contacts.ts`, no schema change):
- **Keep saving every real correspondent**, so the email is kept. The record is classed on read, and unconfirmed and mailbox records stay out of people lists and pickers until a signature or a person names them.
- Do not rename mailboxes to "Company (local@)" as the flag: `email-auto-contacts.test.ts` pins that a display label ("Smith & Co") is kept.
- The Outlook add-in (`/api/interactions/log`) uses `contactNameFor` instead of the raw address.
- `create_contact` and `POST /api/crm/contacts` check email and LinkedIn first.
- `AUTO_SOURCES` gains `rocketreach-search`.
- `attachSenderEmailsByName` writes during a page read. Turn it into a one-click suggestion on the board ("attach this address to Cassie O'Flanagan") and list the rest in the clean-up.
- Swapping the cascade's `isDistributionList` (which drops every address without a dot) for the classifier will surface more suggestions and paid look-ups; do it separately and count first.

**Admin Preview then Apply** (`server/contact-cleanup.ts`, `/api/admin/contact-cleanup/`, modelled on `server/brand-relevance.ts`, never at boot, never a delete):
1. **Not a person**: what the rule flags, with the reason, email count and what uses the record. Records on a deal, viewing or requirement, and "name is the firm's name", are listed apart for a hand check.
2. **Same person**: same personal email or LinkedIn pre-ticked; same letters-only name with the same employer or email domain unticked; same name across companies never offered.
3. **Employer**: open `contact_verifications` findings, and contacts with no employer whose domain matches one verified company.

Apply only fills empty values and saves the before-values, so Undo restores them.

**Two existing tools should stop:**
- The every-boot `DELETE FROM crm_contacts` in `server/index.ts` (same name and company, keeps the oldest, repoints nothing; contacts have no foreign keys). It also deletes the second "Adam" at a firm, which the next hourly sync re-creates under a new id.
- `POST /api/crm/duplicates/merge` for contacts: deletes after repointing eight references, with no staff check of its own (the client gateway blocks it today).

## 5. Order of work

**Before the Landsec pitches (w/c 23 Nov), no database change:**
1. Leak fixes, rows 1 to 3, 3d. `server/property-asset-brief.ts` is free. `server/brand-profile.ts` is edited in three copies and `server/crm.ts` in three: keep each change to a new helper file plus two or three lines, and hand them to the Brand CRM build in this copy.
2. `shared/contact-kind.ts` with tests on the names above, 1.5d. New file.
3. Remove the boot delete (one block in `server/index.ts`, no copy edits it), once you say yes.
4. Mailbox sync and add-in changes, 1.5d. `email-auto-contacts.ts`, `signature-contact-sync.ts` and `interactions.ts` are untouched in every copy.

**Next:** `server/contact-engine.ts` with the resolver extraction (`account-resolver.ts` and `account-workspace.ts` are free), then contact detail and the hub tabs, 5d.

**After you approve the columns:** migration 0057, the fourth identity key, the clean-up screens, 5d.

**Must wait:**

| Step | Waits for | Shared files |
|---|---|---|
| Board flips, meeting counts on brands, client brand board | Brand page re-layout (`/home/user/bgp-brandpage`, 2,300 lines changed in the panel) and Brand CRM | `company-contacts-board.tsx`, `brand-profile-panel.tsx`, `mobile-brand-view.tsx` |
| Widening `dismissible` | Brand CRM | `server/contacts-discovery.ts` |
| Pickers on requirements and tracker; ChatBGP; `promote-sender`; schema | Requirements centre (`/home/user/bgp-req`) | `requirements.tsx`, `available-units.tsx`, `chatbgp.ts`, `routes.ts`, `storage.ts`, `shared/schema.ts`, `schema-drift.ts` |
| Deal page and deal forms picker | Landsec menu build (`/home/user/bgp-menu`), which now edits them | `deal-detail.tsx`, `deals.tsx` |
| Landsec unit People | Landsec menu build | `server/landsec-unit.ts` |
| Hub tabs; shared classifier in the client Contacts tab | Client Contacts tab (`/home/user/bgp-tracker`) | `people.tsx`, `server/client-own-contacts.ts` |

## 6. Decisions for Woody

1. Add the four columns to contacts? Without them there are no corrections and no stored merges.
2. Mailbox sync: keep saving unnamed senders but hold them out of people lists as "unconfirmed" until named? I recommend yes. Not saving them at all would lose their emails.
3. Shared mailboxes: keep as a labelled general address outside people lists? I recommend keep.
4. A named person on a shared address (Bill Payne at accounts@): show as a person marked "shared address"? I recommend yes.
5. Remove the every-boot delete of same-name contacts? I recommend yes.
6. Freeze the Settings contact merge, which deletes? I recommend yes.
7. Should a client see unconfirmed, inbox-made records and general addresses at a brand at all? I recommend named people only; their existence shows who BGP emails.
8. May a client see "left the company" marks (never the note)?
9. Staff brand boards already show most-active first and everyone, not only property and C-suite (since 2 Nov). Keep that, and use it for agents and lenders too?
10. On non-landlord pages, list employees only, not people linked through a property? I recommend yes.
11. Meeting counts, and a per-person meeting list, on brand and agent pages for staff?
12. Retire the old AI contacts check once the classifier is in? I recommend yes.
13. Apollo look-ups beyond landlords? I recommend no.

---

## What I changed and why

1. **Engine split into three layers** instead of one wrapper: `resolveAccountView` is too heavy to call from hubs, pickers and search, and its contact step is not separately callable.
2. **Activity is bounded and fails loudly**: no contact limit in the workspace, a costly join on big firms, and a swallowed error that would silently change the ranking.
3. **Non-landlords get employer-only people**: the landlord rule imports property-linked people, and any company can be linked to a property.
4. **Shared mailbox addresses are not identity keys**: otherwise different people saved under `info@` merge.
5. **Identity functions stay shared, not moved**: the board and four test files depend on them in the browser.
6. **Leak list widened** (`left_note`, source, POST/PUT replies, client writes, ordering by BGP's last contact) and the client allow-list keeps existing key names, since 27 files read that list.
7. **Client stripping extended** to `via`, `propertyNames`, `kindReason`, `leftNote` and merged records outside the client's view; the test checks values, not just key names.
8. **Classifier rebuilt so a typed name wins**: the base rule and two draft rules flagged real people (Bill Payne, David Press, Robert Service, a full address saved as a name); the base list was also narrower than the lists it would replace.
9. **"Hold unnamed senders as suggestions" removed**: it would drop their emails and they would never be suggested.
10. **"Rename every mailbox" removed**: a pinned test keeps display labels.
11. **Old AI check "runs nowhere" corrected**: it still runs on lender and untyped company pages.
12. **Decision on brand person history removed**: already decided on; flagged as a merge hazard with the brand page build.
13. **Order of work updated**: the deal page is no longer free (`/home/user/bgp-menu` edits it); `crm.ts` and `brand-profile.ts` are each edited in three copies; picker route moved under an allowed prefix that does not collide with `/api/crm/contacts/:id`; test rewrites added as their own line.

## Summary for Woody

On landlord pages the app works out who each person really is. It joins duplicate records that share an email or LinkedIn, shows their real employer, counts emails and meetings properly, puts the people you are actually dealing with first, folds away leavers and stale names, and suggests people found in inboxes for you to add or dismiss. Everywhere else, including the 3,326 list, the app shows raw records, many made automatically from email addresses.

The plan applies those rules everywhere, in this order. First, before the Landsec pitches, three fixes: Landsec logins can currently see BGP's email counts, last-contact dates and internal notes on contacts. Then one shared rule for person versus mailbox, then the mailbox sync, then the staff CRM lists, pickers, agent pages, search and ChatBGP. Screen changes on brand and landlord pages wait for the builds already in flight.

Junk records are not deleted. Mailboxes such as accounts@ become labelled general addresses, and unnamed records are held back until a real name is known. An admin Preview then Apply screen marks and joins the rest, with undo.

Your decisions: add four fields to contacts; stop the automatic delete that runs on every restart; freeze the old merge tool; what Landsec may see at a brand; whether brand and agent pages show most-active people first.

# Letting Tracker review, 12 November 2026

Asked for by Woody: "review it broadly and confirm any functioning issues that
don't work first and suggest". Eight reviewers used the tracker on a test copy
of the app (desktop list, brief and targets, files and HOTs, viewings and
offers, the deal link, a Landsec login, the phone) and one read the live app
without changing anything. Every finding below was reproduced, not guessed.
The first ten were re-checked by a second reviewer and all ten held; the
re-check of the rest was stopped to free the machine for the build, so treat
those as found once.

Status key: **Fixed** = fixed on the session branch (not yet on the live app).
**Replaced** = the part is being rebuilt in this work. **Open** = still there.

## 1. Fixed in this work

| What was wrong | Status |
|---|---|
| Edit Unit and Save wiped the fee and the BGP agents on the unit's deal, and could push the deal back to Marketing | Fixed: the form now sends only what was changed |
| Three pickers inside the Targeting Brief could not be clicked (also on the live app) | Fixed |
| A generated Targeting Brief PDF, and any file filed under "Other", was published to the public website feed once the unit was on the website | Fixed: the website gets brochures, plans and photos only |
| Any client login could read another landlord's Targeting Brief and targets by unit id | Fixed |
| A brief or target edit accepted fields it should never change (move it to another unit, rewrite the author) | Fixed |
| A unit could end up with two briefs, the newest hiding the first | Fixed for new briefs. Three units on live already have two or three: see section 3 |
| AI-suggested operators were saved at once, saved again on every press, or saved onto another unit's brief | Fixed: suggestions wait as chips until Save |
| Unsaved brief edits were thrown away without warning; Escape in a dropdown closed the whole brief | Fixed |
| The Targets and Priority A tiles always measured against 5 and 2 | Fixed: the numbers wanted can be set |
| "Generate brief document" added another copy every press | Fixed: it replaces the last one |
| The target routes accepted a blank name and any text as status or priority | Fixed |
| A unit file could be downloaded by another landlord's login with the link | Fixed for client logins |
| On the phone there was no way to open a unit's brief | Fixed: the brief chip is on the phone card |
| The brief did not fit a phone screen | Fixed |
| Deleting a unit left its brief, targets and interest behind | Fixed |
| The admin "Focus tracker" button would have deleted units whose only activity was a brief | Fixed |
| Links with a status (for example from the Landsec home page) were ignored | Fixed |
| Tabbing into a number box and typing added to the old figure | Fixed |
| Offers, viewings and interest were deleted on one tap | Fixed: they ask first |
| Interest and viewings were only an icon at the end of the row | Fixed: both are columns on the main table |
| An offer's status could not be changed anywhere; every offer read "Pending" for ever | Replaced by the negotiation log |
| Heads of Terms: the area and date never filled, the tenant line could show the property and unit, the wrong offer was used when two shared a date, Download PDF failed without a browser session, unsaved edits were replaced | Replaced by the new HOTs flow |

## 2. Still open: how the tracker behaves

Most likely to be noticed in the pitch first.

**Units and their deals**
1. Add Unit makes a second row and a second live deal when the unit is already listed under a slightly different name ("RU10" and "RU10 Test"), or is on the tracker as Withdrawn. Add brief does not have this problem: it picks the unit from the tenancy schedule.
2. Renaming a unit on its row does not rename its deal, tenancy schedule row or leasing schedule row.
3. Deleting a Marketing unit also deletes its deal, fee and fee split, with no warning, and a client login can do it. Deleting a unit past Marketing leaves the live deal behind, and the next edit to that deal brings back an empty row.
4. Re-marketing a withdrawn unit can leave the row with no deal; "Create ref" then fails with a raw database error.
5. Choosing Solicitors on a Withdrawn or Completed row re-opens the closed deal instead of starting a new one.
6. "Promote to Solicitors" does not update the Leasing Schedule, writes no status entry in the deal's history and skips the AML check the other route runs. The new "Convert to Solicitors" on the HOTs flow goes through the proper checks; the old button should be retired once that is live.
7. Units added through Add Unit never change status on the Leasing Schedule (it stays Vacant while the deal moves on).
8. A status edit on the tenancy schedule changes the tracker row but not the deal.
9. The Promote dialog offers deal types that are not lettings (Sale, Rent Review, Lease Renewal).

**Filters and counts**
10. With no status chip chosen the list silently drops Solicitors and historic units while the chip still says "All".
11. The filter labelled "All Deal Statuses" filters on target status, not the Deal Status column.
12. The Agent and Team filters do not match the Agent column on the rows.
13. The viewings number on a row disagrees with the list it opens (no-shows and cancelled are listed, not counted). On live the three tabs give three different viewing totals and the Reports tab is all zeros.
14. The stored viewing count and last viewing date on a unit are never written, so the phone list never shows them and the Landsec unit page never shows the last viewing.
15. The Website pill says "Live" for units the public feed is leaving out.
16. "Clear" on a row's property always errors.

**Viewings and offers**
17. The Add Viewing form offers every CRM company and "Create company", then refuses anything that is not a tenant brand. Its contact picker lists every contact and refuses anyone not employed by the brand (so the brand's agent cannot be picked).
18. An offer linked to a viewing cannot be edited once that viewing is deleted or its date changes.
19. Changing a viewing's date silently un-confirms it, which drops it from Reports. Any edit to a viewing stamps "outcome recorded".
20. A landlord login sees diary entries BGP marked "Not a leasing viewing", with BGP's note.
21. A blank offer (no brand, no figures) can be saved and counts in the totals.
22. An offer found in email keeps its "confirm figures" badge after the figures are confirmed.

**Targets and files**
23. Two people commenting on the same target overwrite each other, and anyone can edit another person's comment under that person's name. (Comments on the brief itself are now per person and dated; target comments are not.)
24. Targets cannot be reordered.
25. A rejected file upload only says "Upload failed"; the reason is thrown away.

**A Landsec login**
26. Cannot add a new brand or company from the tracker (every "Create" answers 403) and cannot create a property, so units can only be added where a property record exists.
27. The Add and Edit Unit form shows BGP's fee and fee split, and what is typed is thrown away.
28. Client logins are listed as BGP people ("BGP Contact" offers Mark Warne), and a target a client adds names the client as its agent.
29. The Landsec menu has no entry for the Letting Tracker ("Lettings" opens the deal clock) and no entry for the CRM. Asset managers and joint agents are shown a "Letting tracker" button that bounces them home.
30. The CRM's Agents tab lists agents acting for brands, not letting agents, so a joint agent firm does not appear there. The Targeting Brief's joint agent picker reads the CRM's agent companies directly (494 on live, including CBRE).

**Phone**
31. A unit cannot be moved to Negotiating, HOTs or Solicitors, put on or off the website, or deleted, and there is no property filter.
32. On the phone Deals screen the Letting Tracker tab is cut off at the right edge.

## 3. Still open: the data on the live app

Read on the live app on 12 November. None of this was changed.

| Finding | Number |
|---|---|
| Offers on the tracker that are unconfirmed email back-fills (some name Landsec's own leasing managers as the bidder) | 1,033 |
| Tracker rows with no deal or Ref | 190 of 466 |
| Live letting deals not on the tracker | 34 |
| Units carrying two live landlord deals | 11 |
| Targeting Briefs pointing at units that no longer exist (22 are Landsec; they hold 40 targets) | 25 of 95 |
| Units with two or three briefs | 3 |
| Interest entries on units no longer on the tracker | 24 |
| Rows storing agent names instead of people (the Agent filter misses them) | 23 |
| Live Landsec rows with no quoting rent / no agent / no Ref | 71 / 117 / 20 of 131 |

Also on live: a unit in Negotiating, HOTs or Solicitors does not show the brand
it is being let to; the tracker downloads the whole company table (62 MB) twice
on desktop, about 12 seconds; the "BGP owner" picker lists the Landsec Guest
login and three non-person accounts.

## 4. Suggestions, in the order I would do them

1. **Clean the Landsec rows before the pitch.** A per-scheme completeness line (rent, size, agent, photos, Ref, brief agreed) and work it down for the 131 live Landsec rows.
2. **Make every headline number mean "confirmed".** Put email and diary back-fills in a "to confirm" queue so the strip, the row badges and Reports agree. The 1,033 back-filled offers are the biggest single distortion.
3. **One admin Preview then Apply for briefs**: re-link the 25 orphan briefs to their re-added units, merge the 3 duplicate sets, then make one-brief-per-unit a database rule.
4. **Show the incoming brand on the row** once a unit reaches Negotiating, HOTs or Solicitors, with the Ref.
5. **One status writer.** Route Promote to Solicitors and the tenancy schedule's status edit through the same check, mirror and history as the row's own status edit.
6. **Replace the bin with Withdraw** on any unit that has a deal; keep true delete for admins on empty or closed units; remove it from client logins.
7. **Give the client its own Add Unit form**: no fee block, no "BGP Contact", a scheme picker from the 14-scheme list.
8. **Put the tracker and the CRM in the Landsec menu**, and add a "Joint agents" list to the Landsec CRM.
9. **A phone "More" sheet on the unit card**: status, website, brief, targets, HOTs.
10. **A slim company lookup** for the tracker instead of the full company list.

Decisions these need from Woody: items 5 and 6 change how staff work day to
day; item 3 changes data on live; item 8 reverses part of the 11 November menu
decision.

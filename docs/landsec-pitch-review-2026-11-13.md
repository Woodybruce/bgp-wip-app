# Landsec pitch review, 13 November 2026

Deeper review of the three areas that matter for the pitch: who can see what, the new lettings flow, and where AI data goes. Follows the app review of 12 November.

**Verdict.** The new roles' front door holds: a joint agent and an asset manager were refused every direct attempt to read or change another scheme's records, and the demo path from Add brief to Solicitors works end to end. The leaks are in older routes the new rules never reached. The handout written for Landsec says three things the code contradicts.

## Update, 13 November, 12:30

The seven items at the top of this page are fixed and live: pushed to the working branch on your word, running on the live app since 12:27. Each item below says what changed.

More was found while fixing them and fixed too. Brand cover photos never loaded for a full Landsec login; they load now, and a client is sent only photos of its own company, its own buildings and brands it may see. The MLRO's block could be skipped on the deal page itself when a rejected tenant and Solicitors were set in one save, or a deal was created straight at Solicitors; both are refused now.

Two independent reviews of the fixes found more of the same kind, all closed: BGP's AML risk level and pitch advice in the data behind a brand page and in a client's Brand Pack, the deal's AML fields on every deal sent to a client, BGP's fee terms in the reply to a client's own deal save, a client login starting a new deal already signed off, a client being told which party the MLRO had rejected, the Brands page counting a brand's deals with every landlord, and one hand-typed request line read two ways.

Another session closed some of the same leaks its own way this morning. The two are merged, the stricter rule kept wherever they differed.

Checked with 163 checks on the private local copy as five kinds of login; on the code before the change 34 of the first 60 failed. Old code against new in a real browser as each login: 33 pages, every request answering as before except the cover photo. After the deploy, read only: all 12 website listings are still listed, the info sheet's link answers not found, and the tracker, Deals and Brands pages load with no failing request. The client-side cuts were proved on the test copy, not on live (I hold no client login there).

## Close before anyone outside BGP has a login

Leaks and ways round the rules. Almost all sit in older routes that the new role rules never reached. Each fix is small.

### 1. The brand pack PDF lists a brand's deals with every landlord, rents included

*Reproduced*

The Brand pack download on a brand page prints the brand's six most recent deals whoever the landlord is: property, unit, stage, rent, size and term. Another landlord's login reads Landsec's lettings, a Landsec login reads other landlords', and an asset manager limited to one scheme reads the others. The brand page itself has been corrected and now cuts this list properly. The PDF was missed.

**How I know.** I added three test deals for one brand and downloaded the pack as each login. The other landlord's pack read "Bluewater Shopping Centre, Unit L101, With solicitors, £250,000 pa, 2,400 sq ft, 10 yrs" and a second Landsec letting. The Landsec login's pack showed the other landlord's negotiation at £310,000. This is item 1.6 of the 12 November review.

**Fix.** Give the pack the same cut the brand page uses (the viewer's own company and, for an asset manager, their schemes) and the same check on whether the login may see the brand at all.

**Fixed, 13 November.** Live since 12:27 on 13 November. The pack now takes the brand page's cut: a client's pack lists only its own deals with the brand, an asset manager's only its own schemes, and a company the login may not see is refused.

**Where.** `server/brand-pack.ts:113 and :262`

### 2. An asset manager's login is let past checks that stop the full Landsec login

*Reproduced*

The rule list lets an asset manager read anything under the brand and company addresses, and the gateway treats that answer as final. Routes that relied on the ordinary client checks are therefore open to the most restricted Landsec role, for any company in BGP's CRM. They can download BGP's pack on a rival landlord with its contacts, read its covenant report and BGP's scores, and read BGP's list of suspected duplicate companies and of tracked brands. Asset managers and joint agents can also fetch the Ordnance Survey key the server uses for paid look-ups.

**How I know.** I ran 33 company addresses against four kinds of company, and 13 general ones, as five logins. On a rival landlord and again on an agent firm the asset manager got 14 answers the full Landsec login was refused, including a pack PDF naming the rival's head of leasing, plus three of BGP's housekeeping lists. The mapping-key address answered both restricted roles and refused the full Landsec login. This is item 1.5 of the 12 November review: the contact and email routes it named are now BGP only, the rest is still open.

**Fix.** For an asset manager's brand reads, let the request carry on through the ordinary client checks after the role list says yes. Take the mapping-key address off the restricted list.

**Fixed, 13 November.** Live since 12:27 on 13 November. An asset manager's brand requests now go through the same checks as a full Landsec login's. The mapping-key address is closed to both restricted roles. In a browser, that login's home, brand list, brand pages and own company page answer exactly as before.

**Where.** `shared/landsec.ts:206-224; server/index.ts:5027; server/os-data.ts:773`

### 3. Adding "#/files" to an address gets a restricted login the whole unit list

*Reproduced*

The gateway judges the address as it arrives, including anything after a "#". The app chooses which page to run from the part before it. So an address the rules allow ("a unit's files") runs the unit list, which the rules say these logins must never reach.

**How I know.** With a hand-built request, a joint agent limited to Bluewater was refused the unit list, then received 79 units across Bluewater and Westgate by adding "#/files". The second reviewer reproduced it and found the same trick opens the all-offers, all-viewings and all-interest lists and the list of marketing files for every client's units. A browser never sends a raw "#", so this needs a script. Neither of us could test whether the hosting front end passes one through, so treat it as open until it is closed in the code.

**Fix.** Make the gateway judge the same path the app routes on, or refuse any address containing "#". It is a one-line change.

**Fixed, 13 November.** Live since 12:27 on 13 November. The gateway now judges the address the app actually routes on, so nothing written after the path changes the answer. Fifteen variations of the trick are refused in a test with a real server.

**Where.** `server/index.ts:5014`

### 4. One address gives any client login other landlords' vacant units, rents and target brands

*Reproduced*

An older "suggested units" address for a brand returns vacant units from every landlord's leasing schedule: unit, size, rent, positioning, the preferred target and the target brands. Nothing limits it to the caller's own properties.

**How I know.** The other landlord's test login received two Bluewater units with their rents and strategy fields. The screen that used this address is switched off for everyone, so it is reached only by typing it, but it still answers any signed-in login.

**Fix.** Limit it to the caller's own properties and schemes, or close it to client logins.

**Fixed, 13 November.** Live since 12:27 on 13 November. The address is BGP staff only: no client login of any kind is sent it. No screen uses it for a client.

**Where.** `server/brand-ai-take.ts:583`

### 5. Client logins are sent BGP's fee terms and BGP's private notes

*Reproduced*

Four routes send client logins more than the rest of the app allows. The company list and the data behind every brand page carry BGP's letting and investment prospecting notes on each brand and the saved AI fields, which hold the summary of BGP's emails with the brand. The screens do not draw them, but they are in what the browser receives. Asking for its own company's deals returns every Landsec deal with BGP's fee percentage and fee agreement, and an asset manager limited to one scheme receives every scheme. Opening its own company record returns all 114 fields BGP holds on Landsec, including the AML risk level and notes and BGP's prospecting and distress notes.

**How I know.** With test notes in place, the company list and the brand page's data returned all of them to the full Landsec login and to another landlord's login. The Bluewater-only asset manager received six deals (four Bluewater, two Westgate) each showing "fee percentage 10, fee agreement 10% of NER". Both Landsec logins read back the AML risk level and three sets of BGP notes on their own company. Corrected on 13 November: the first version of this card also listed BGP's comments on deals and which BGP people cover a brand. Comments are a field clients read and write on their own deals, and the brand page shows the BGP team on purpose. Neither was a leak.

**Fix.** Apply the existing client strip to the company list, the brand page's company data and both company routes, and the scheme limit to the deals route.

**Fixed, 13 November.** Live since 12:27 on 13 November. One list of what a client is never sent about a company now applies to the company list, a client's own record, the brand page's data and the reply to a save. Company and property deal lists carry no fee terms, and an asset manager gets its own schemes' deals and properties only. The reply to a client's own deal save, which still carried the fee terms and BGP's AML working, is cut the same way.

**Where.** `server/crm.ts:1968 and :3183; server/brand-profile.ts:1231`

### 6. A unit's Notes box is printed on a PDF the public website serves

*Reproduced*

The public listing feed leaves a unit's Notes out on purpose. The info sheet does not: whatever is typed in Notes on the tracker row is printed under "The opportunity". The sheet is stored as a brochure, so once the unit is on the website the public feed lists it and serves it to anyone. Where the unit has no other brochure it becomes the website's Download button and is copied to the old WordPress site by the hourly sync. Share with a brand also offers it already ticked. An internal note would go out with it.

**How I know.** On the local copy I typed "landlord will take 70k, do not quote" into Notes, pressed Info sheet, and fetched the PDF from the public file address with no login: the line was in it. On the live public feed today, one of the 12 published units has a generated info sheet, and its opportunity paragraph is the tracker note ("Tracey Pollard's letting ... Brochure produced October 2024; images marked indicative").

**Fix.** Leave Notes off the info sheet, or give the sheet its own description box. Until then, read the Notes on any unit before it goes on the website.

**Fixed, 13 November.** Live since 12:27 on 13 November. The public feed, the public file link and the WordPress sync now give out only files stored as uploads. On the live site the one info sheet is off the feed and its link answers "not found"; the listing kept its brochure and photos. The old WordPress site never held a copy. The info sheet still prints Notes when an agent sends it by hand: whether it should is your call.

**Where.** `server/unit-info-sheet.ts:312; server/routes.ts:4934`

### 7. The older Promote to Solicitors route skips the MLRO's block, and a Landsec login can call it

*Reproduced*

The one hard AML rule you kept is that a party the MLRO has rejected stops the deal. The older Promote route ignores it. It sets the deal straight to Solicitors and takes the tenant, the landlord, the deal type and the "AML checked" answer from whoever calls it. It writes no status history and records no AML warning. For BGP staff this is the route taken whenever Solicitors is picked in the tracker's status column. A full Landsec login is let through to it too, though only by calling the address directly, since their screen does not offer it.

**How I know.** Signed in as the full Landsec login, with the tenant marked rejected in the test database, the call succeeded. The unit and the deal went to Solicitors, the landlord was rewritten to another company, the type became Sale and the deal was marked "AML check completed: YES", which makes the AML gate skip it from then on. No history row, no warning.

**Fix.** Close the route to client logins now. For BGP staff, send it through the same gate and write door as Convert on the Heads of Terms flow, or retire it as the tracker review already proposed.

**Fixed, 13 November.** Live since 12:27 on 13 November. Staff only. A party the MLRO has rejected stops it before anything is written, the form's AML answer is kept only from the MLRO (an agent is told when theirs is not kept), and the move, the warning and any sign-off are recorded on the deal.

**Where.** `server/routes.ts:7908`

### 8. Renaming the Landsec company record removes the scheme limits

*Reproduced*

Whether a login counts as Landsec is decided by the company's name reading "Landsec" or "Land Securities". If someone tidies the name in the CRM, the scheme check stops recognising the restricted logins and lets them through to every scheme, while their own home page breaks.

**How I know.** I renamed the test company to "Landsec plc". The Bluewater-only asset manager, refused a Westgate unit's brief, heads of terms and checklist a moment earlier, could open all three. Restoring the name restored the refusals.

**Fix.** When a login has a restricted role and the Landsec check cannot be made, refuse the request. Longer term, store which company is Landsec instead of matching its name.

**Where.** `server/landsec-schemes.ts:94; server/landsec-access.ts:95; server/unit-brief-workspace.ts:66`

### 9. The access panel: one Save makes a joint agent a full Landsec login, and a one-character password is accepted

*Reproduced*

The bin on the panel now deactivates a joint agent correctly. The Edit form beside it does not have the same guard: saving a joint agent's row with the role set to leasing manager gives that outside firm all 14 schemes, the brand pages and the brand contacts. The panel also accepts any password, replaces an existing login's password without saying one existed, and leaves old sessions signed in.

**How I know.** I created a joint agent, saved it once with the other role, and the same login then opened the brand hub, the full unit list and a Westgate unit. A second test login was created with the password "1" and signed in.

**Fix.** Refuse a role change on a joint agent's row (deactivate it and make a new login). Require the same eight characters as the ordinary password reset, and sign the person out when their password is changed.

**Where.** `server/landsec-access.ts:205-228; client/src/components/landsec-access-panel.tsx:84`

### 10. What a joint agent is still sent that the written rule keeps from them

*Reproduced*

The rule is that a joint agent never receives BGP's brand contacts, and the people pickers give them names with no email addresses. Five places do not follow it. (1) Viewings and interest lines that BGP booked from its CRM carry the name of BGP's contact at the brand, on the unit's lists, the viewings calendar and the joint agent's tracker. (2) On schemes that use BGP's standard heads of terms (10 of the 14), a draft generated by BGP names that contact too. (3) The Landsec unit page sends each Landsec contact's email and phone number. (4) Opening a brief sends the email address of everyone on it. (5) The people list names every Landsec-side login, including joint agents at other firms.

**How I know.** I booked a viewing and logged interest as BGP staff with a CRM contact, then read each feed as the joint agent: the contact's name came back in all four, with no id, email or phone. The unit page returned a Landsec contact's email and mobile, and the brief returned four email addresses where the picker for the same brief returned none. Item (5) was read in the code and confirmed by the second reviewer.

**Fix.** Blank the contact name wherever a joint agent did not enter it, as the unit page and the offers list already do, and send Landsec people and brief members as names only.

**Note.** Your call on (1) and (4). A joint agent running a viewing arguably needs to know who they are meeting, and a note in the code says they are meant to get the emails on a brief. If so, write that into the rules; if not, blank them as the unit page and the pickers do.

**Where.** `server/leasing-viewings.ts:103; server/unit-hots.ts:435; server/landsec-unit.ts:384; server/unit-brief-workspace.ts:133; server/routes.ts:1310`

### Smaller faults in this area

- **BGP's Landsec team sheet can be read by anyone from the app's script files.** The sheet of who works on each of the 14 schemes (named Landsec asset managers and leasing leads, BGP's agents and the joint agents' people) is built into the browser code, which is served with no login. Names and schemes only, no emails.
- **An asset manager's brand page still carries figures beyond its schemes.** The deal lists are cut correctly, but the same reply holds the brand's tenancies with total passing rent at every landlord's property, and target lists and lease events across the whole Landsec portfolio.
- **Hidden brands still appear in three client reads.** A brand BGP has hidden still shows, with its contacts, in the client brand directory, in a client's search, and by direct address.
- **The brand plan tells a client when BGP confirmed a listing.** It sends "updated N days ago" worked out from the last-edit time, which a BGP confirmation resets. The requirements rule keeps that time from clients for this reason.
- **The Landsec analytics feed still matches deals by a loose name.** A deal whose group contains "land sec", such as Portland Securities, is counted as Landsec and its name can reach a Landsec login.
- **A refused file type answers with a server error.** Uploading a file of a type that is not allowed returns error 500 where it should be a plain refusal.
- **Staff viewing as Landsec still see BGP's fee row on the unit page.** No Landsec login is sent the fee. The risk is a demo or screen-share from a staff login assumed to show exactly what Landsec sees.
- **Every signed-in browser is told the name of files imported by email, WhatsApp or a SharePoint link.** The "Import complete" pop-up goes to every login, Landsec and joint agents included, with the file name and, in the data, the sender's email address or phone number.
- **Merging two duplicate brand records leaves the Landsec brand case and the brand's CRM actions on the hidden duplicate.** Nothing is deleted, but the case and the actions vanish from the brand's page until they are moved across.
- **A Landsec login can type any role label on its brand-case response.** Including "BGP". The person's name still comes from their login.

## The lettings flow

The flow works when followed. These are the places where its controls can be stepped round or where screens disagree.

### 11. Net Effective Rent is worked out three ways and gives two answers

*Reproduced*

The deal clock uses Landsec's definition: incentives spread to the first break. The negotiation log, the "offer meets the brief" tick on the tracker and the recommendation spread them over the whole lease and never read the break. An offer with a break therefore passes the floor on two screens and fails it on the third. The recommendation is the document Landsec decides on.

**How I know.** I ran the three sums on one offer: 10 years, tenant break at year 5, £100,000 rent, 12 months rent free, £50,000 capital, floor £80,000. The deal clock gives £70,000 and a fail. The negotiation log and the recommendation give £85,000, and the recommendation prints "106% of the floor". Two reviewers found this independently. The other faults in the 12 November review's item 1.9 are also still there: break wording such as "6 months notice at year 5" is read as a 6-year term, a landlord-only break shortens the term, and a premium paid by the tenant counts as a cost.

**Fix.** Use the deal clock's sum everywhere, and show "not checked" on the recommendation when rent free and capital are missing, as the deal clock now does.

**Where.** `shared/unit-negotiation.ts:89; shared/unit-recommendation.ts:165; shared/landsec.ts:139`

### 12. Signed heads of terms can be rewritten by any login on the unit, and the earlier text is not kept

*Reproduced*

Only the current text of a draft is stored. Each amendment and each "generate from the offer" overwrites it, and a signature records only a version number. After an amendment nobody can show the wording that was signed or issued, and a mistaken "replace with a fresh copy" cannot be undone. Any login that can open the unit can make that change until the heads of terms are issued, whether or not they are on the brief: the message "You can read and agree the Heads of Terms, not change them" can never appear, because the switch behind it is on for everyone.

**How I know.** On a draft that BGP and Landsec had both signed, the asset manager test login (not on that brief) replaced the text. The version went from 1 to 2 and both signatures were cleared. The second reviewer confirmed the text is not kept, and noted the switch was opened on purpose when joint agents were given full control on 12 November.

**Fix.** Keep the full text of each version (a small new table, which needs your approval). Then decide who may amend: BGP and the joint agent only, as the message says, or every login on the unit as now.

**Note.** Your call on who may amend. Keeping the text is worth doing either way.

**Where.** `server/unit-brief-workspace.ts:77; server/unit-hots.ts:676`

### 13. A sign-off can be recorded for someone who has their own login

*Reproduced*

The rule is that a person with a login agrees for themselves, and an agreement is recorded on someone's behalf only when they have no login. The check looks only at whether the person's line on the brief is tied to a login. It is not tied when a joint agent types the name and email instead of picking the person, or when the person was added before their login existed. The same gap lets an agent record or replace a Landsec manager's decision on a recommendation.

**How I know.** As the joint agent I typed the asset manager's name and email onto a brief, set the rent floor to £1, and recorded her agreement. The brief showed her as agreed, "recorded by" the joint agent. She has a login and had agreed nothing. The second reviewer confirmed it and noted that the timeline does record who did it, and that BGP staff adding someone by name or from a CRM contact leave the same gap.

**Fix.** At the moment an agreement is recorded for someone, check whether their email belongs to an active login and refuse if it does.

**Where.** `server/unit-brief-workspace.ts:764; server/unit-recommendation.ts:1397`

### 14. Taking a person off the brief removes their say

*Two reviewers*

Who must sign the heads of terms and who must decide a recommendation is read from the brief at that moment. Remove a Landsec manager who declined a recommendation and, if the rest approved, it reads Approved. Remove someone who has not agreed the heads of terms and they can be issued. With nobody on the brief they can be issued with no sign-off at all.

**How I know.** Read in the code by one reviewer and confirmed by a second. The removal is written in the brief's timeline only, not in the heads of terms or recommendation history.

**Fix.** Fix the list of signers when sign-off starts, or require a fresh sign-off when the list changes, and apply the brief's own rule (at least one BGP agent and one client-side person) to both.

**Where.** `server/unit-hots.ts:747`

### 15. Issuing a recommendation emails it to any address typed onto the brief

*Two reviewers*

The rule is that a joint agent adds to a brief only the people its own list offers. The app refuses a person picked by id from outside that list, but under "Someone not listed" it accepts any typed name with any typed email, unless the address is BGP's. Given a client-side role, that person becomes a decision-maker, and when the recommendation is issued the app emails them the tenant, rent, term, incentives and the recommendation, from the Landsec mailbox.

**How I know.** Read in the code by one reviewer and confirmed by a second.

**Fix.** Send the issue email only to people matched to a Landsec login or a Landsec contact, and show the sender who will receive it before it goes.

**Where.** `server/unit-recommendation.ts:1342`

### 16. AML says nothing in two Convert cases

*Reproduced*

When a joint agent converts with the tenant typed as text, the deal reaches Solicitors with no tenant company on it. The AML check then looks only at the landlord, nothing is recorded about the tenant and nobody at BGP is told. The joint agent is shown "AML checks started", but nothing starts: the automatic run has been off since in-app AML was retired on 5 October. Separately, when a unit is already at Solicitors and is then converted, the tenant is added with no warning recorded.

**How I know.** On a unit with no offer and no sign-off, the joint agent test login converted with a typed tenant name. The deal went to Solicitors with no tenant company and the reply said "AML checks started". The second case was read in the code and confirmed by the second reviewer.

**Fix.** When a tenant is added to a deal at or past Solicitors, run the same check and record the same warning as a status move. When the tenant is only text, create a task for BGP to link the company. Reword the joint agent's line to say what actually happens.

**Note.** This sits with the wider question below of how KYC4U and the MLRO are told about a warning now that the in-app queue has no screen.

**Where.** `server/unit-hots.ts:911 and :982; server/unit-hots.ts:221`

### 17. A Landsec login can delete a unit with its signed brief, its agreed offer and BGP's deal

*Reproduced*

An agreed offer cannot be deleted, and a brief that people have agreed can only be deleted by BGP. Deleting the unit itself has neither check. A full Landsec login can delete a Marketing unit on its own property, and with it BGP's deal, reference and fee split, the brief with every signature and comment, all offers including an agreed one, the negotiation log and the heads of terms draft. The Delete Unit box on the screen now lists what will go and says it cannot be undone. Asset managers and joint agents are refused.

**How I know.** As the full Landsec login, deleting the agreed offer was refused and deleting the brief was refused ("People have agreed this brief, so it can only be deleted by BGP"). Deleting the unit then succeeded, and the unit, deal 1129, the brief, its people and timeline, the offer and its rounds were all gone from the database. The Letting Tracker review of 12 November raised this as its item 3.

**Fix.** Once anything on a unit has been signed or agreed, withdraw the unit and its deal in place of deleting them, or keep the delete for BGP.

**Note.** Your call: whether a client login should be able to delete a unit that carries BGP's deal and reference at all.

**Where.** `server/routes.ts:6143`

### 18. ChatBGP's database tool can write sign-offs, offers and Landsec roles directly

*Two reviewers*

ChatBGP's general database-write tool refuses a short list of tables. None of the Landsec, brief, sign-off, offer or tracker tables is on it. A member of staff asking ChatBGP to "mark the brief as agreed" or "set that offer to agreed" can have it write the signature or the status directly, with no timeline entry and none of the rules. It can also delete a joint agent's role row, after which that login is treated as a full Landsec login.

**How I know.** Read in the code by two reviewers working separately and confirmed by a third. Landsec logins cannot do this: their chat has no database tools.

**Fix.** Add these tables to the tool's refuse list, so these writes go only through the screens that hold the rules.

**Where.** `server/sql-tools.ts:61`

### 19. The Landsec unit page loses typed figures and keeps no history

*Reproduced*

Typing "95k" or "£95,000 pa" into ERV, Target rent, the rent floor or capex saves a blank and wipes the old figure with no error. A blank Target rent also blanks the asking rent on the tracker row. Sent directly to the server the same text is stored as an invalid number. Changing who a deal is waiting on keeps the old start date, so the new party inherits the last party's days. Solicitor fields cannot be cleared. None of these saves keeps a record of the old value or, for most fields, of who changed it.

**How I know.** I saved "95k", "£95,000 pa" and "95,000" to the server as the Landsec login: each stored "not a number" in both ERV and the asking rent and answered ok. On the screen "95,000" works and the other two blank the field. The Targeting Brief's own money boxes read all of these correctly. As the asset manager I changed the tracker's asking rent from £250,000 to £5 from this page with nothing recorded. Items 2.4, 1.13, 2.8 and section 5 item 2 of the 12 November review.

**Fix.** Use the brief's money reader on this page and refuse what it cannot read. Restart the waiting clock when the party changes. Write each change to the deal history that already exists.

**Where.** `server/landsec-unit.ts:405-470; client/src/pages/landsec-unit.tsx:539`

### 20. The older two-signature brief card still does not hold

*Two reviewers*

The card shown on any unit with no Targeting Brief still has every fault the 12 November review listed: a save with no change removes both signatures, one person can sign as both sides, and "meets floor" can show against a floor nobody has signed.

**How I know.** Checked by two reviewers. It is the same code as before.

**Fix.** Retire the card in favour of the Targeting Brief, which does these things correctly. CLAUDE.md records this as your call.

**Where.** `server/landsec-unit.ts:318-405`

### Smaller faults in this area

- **A refused re-marketing still wipes the unit's heads of terms and closes its offers.** When a new deal cannot be made for a re-marketed unit the tracker says the status was not changed, but the earlier letting's heads of terms text, sign-offs and issue date have already been cleared and its offers marked Closed. From the Leasing Schedule the change is not refused at all.
- **Two typing slips in money boxes are saved as a different amount.** A misplaced comma is dropped, so "9,5000" saves as 95,000, and a full stop used as a thousands mark, "£95.000", saves as £95. The usual forms ("95k", "£95,000 pa") are read correctly on the brief and the negotiation log.
- **Add Unit says "Unit added" when the unit's deal could not be made.** The failure goes to the server log only, leaving a live row with no deal and no reference. The joint agent's dialog does tell the person; the main BGP forms do not.
- **A Landsec login can add a BGP agent to a brief.** The rule says only BGP adds and removes its own agents. Removal is BGP only; adding is refused only for a joint agent.
- **Heads of terms can be signed and issued with blanks in them.** A filled Bluewater form still has about 22 blanks marked "[ ]", St David's 19, White Rose 18 and Trinity Leeds 9. The app lists what it could not place and shows a "Still to fill" note, but does not stop sign-off or issue.
- **Recommendation figures read as complete when inputs are missing.** With no rent free or capital entered it shows "100% of the floor", and "total occupational cost" counts missing service charge, rates and insurance as zero.
- **Target rent changed on the Landsec unit page does not reach the deal.** The tracker row and the Targeting Brief both update the deal. This page updates the tracker row only, so the Deals board and the rent line at the top of the same page keep the old figure.
- **Making someone responsible on the checklist emails them at once.** One click saves the person and sends the email, with no confirm step and no quiet mode. Taking someone off an item and putting them back emails them again each time; only the Remind button is limited to once an hour. In a demo on the live app this reaches real people.
- **Share with a brand opens with "Other terms" already ticked.** That is the brief's catch-all box, where the AI reader of a client's instruction puts any term it cannot place. Unless the sender unticks it, the wording is printed in the brand's PDF.
- **The unit info sheet fails on some characters.** A tab, an arrow, an emoji or a non-Western letter anywhere in the unit name, address, lease terms or notes stops the PDF with an error. The share pack cleans its text first; the info sheet does not.

## Where AI data goes

The lock works for the logins it covers. The gaps are in what it does not cover, and in what the handout says.

### 21. Staff ChatBGP follows the provider switch, whoever's data it is

*Two reviewers*

The lock covers a Landsec login and BGP staff who have switched the team picker to Landsec. It is decided by who is asking, never by whose data it is. A BGP agent in the normal view who asks ChatBGP about a Landsec unit sends the question and everything the tools fetch to whichever provider the chat setting names. The Friday insights run and WhatsApp ChatBGP do the same. With both settings left empty everything goes to Anthropic. Nothing stops chat following the setting once it is set, and the handout tells the team to leave only one of the two settings alone.

**How I know.** Two reviewers ran the provider choice with the chat setting on OpenAI and the general setting empty: chat went to OpenAI. On the live app, ChatBGP logged OpenAI "no credits" errors between 29 October and 10 November, so staff chat has been running on OpenAI. Item 1.4 of the 12 November review, unchanged.

**Fix.** Your decision, then a small change either way: pin all ChatBGP to Anthropic by default, or name OpenAI in the handout as a processor for BGP staff chat.

**Note.** Before the pitch, look at CHATBGP_PROVIDER and AI_PROVIDER on Railway. Neither reviewer could see them.

**Where.** `server/utils/ai-provider.ts:46-60`

### 22. Some features go to Google, OpenAI and Perplexity whatever the switches say

*Two reviewers*

Outside the Landsec view, Document Studio sends the instructions and the full text of the source documents to Google Gemini first and uses Claude only if Gemini fails. A recording dropped into staff chat, and every WhatsApp voice note, goes to OpenAI to be transcribed. Chat image requests go to Gemini and chat web research goes to Perplexity. So "Anthropic is the only AI provider for Landsec data" does not hold for BGP's own work on Landsec material even with both switches empty.

**How I know.** Read in the code and confirmed by a second reviewer. Inside the Landsec view these paths are closed correctly.

**Fix.** Either keep Landsec documents out of these features by rule, or check the data and not only the viewer before each outside call. The handout should say which.

**Where.** `server/document-templates.ts:961; server/chatbgp.ts:8377; server/perplexity.ts:215`

### 23. Perplexity is sent each scheme's name and its list of missing brands, including from a Landsec login

*Two reviewers*

A job that runs every night sends Perplexity, for each scheme about once a week, the scheme name, postcode, nearby centres, unit uses and up to 15 brands that do not trade there. The same request runs when anyone opens a scheme's Brand gap card and the saved answer is over a week old. That includes a full Landsec login, because the Perplexity connection never checks the lock. No rent or deal figure is sent.

**How I know.** Read in the code by two reviewers and confirmed by a third. The lock's own description names Perplexity as a provider that should refuse inside it.

**Fix.** Add the lock check where Perplexity and Exa are called. Decide whether the nightly job should skip Landsec schemes.

**Note.** Your call: whether a scheme name with a list of target brands counts as Landsec's confidential information.

**Where.** `server/property-gap-analysis.ts:999; server/perplexity.ts:215`

### 24. The outside-assistant connector hands over every client's records to whoever holds one shared key

*Two reviewers*

The connector that lets an outside AI assistant read the app asks for one shared key. It has no user, no client limit and no Landsec lock. With the key a caller can search and open deals with their fees, contacts with emails, tracker units with rents, SharePoint files, the email archive and ChatBGP conversations, Landsec's included. If no dedicated key is set it accepts the secret that signs login sessions. It is not on the handout.

**How I know.** Read in the code by two reviewers and confirmed by two more. Item 2.13 of the 12 November review, unchanged.

**Fix.** Decide whether it is still needed. If it is, give it its own key, per person, and leave Landsec records out. Add it to the handout either way.

**Where.** `server/mcp-server.ts:1130`

### 25. Three kinds of BGP use sit outside the lock while looking at Landsec

*Reproduced*

A BGP staff member whose own team is Landsec is shown the Landsec view, but the server only locks staff whose picker is set to a team different from their own. ChatBGP over WhatsApp is never locked, even when the person's picker is saved on Landsec. In the Landsec view, asking ChatBGP to advance a property pathway still reaches Perplexity and Exa.

**How I know.** I used the image generator's lock message as the signal: a full Landsec login and staff with the picker on Landsec were locked, a staff login whose own team is Landsec was not. On the live app one BGP staff login has Landsec as its own team today. The WhatsApp and pathway cases were read in the code and confirmed by a second reviewer.

**Fix.** Treat a staff member's own team the same as a picked one. Start the lock for WhatsApp runs from the person's saved picker. Add the pathway tools to the locked list.

**Where.** `server/company-scope.ts:46; server/whatsapp.ts:428; server/chatbgp.ts:2366`

### 26. The admin report always says the Landsec lock is on

*Two reviewers*

The AI key check reports "Landsec lock: Anthropic, switch ignored, outside image AI refused". Those words are written into the report, not measured. It would say the same if the lock were removed. Its provider line also shows only one of the two switches.

**How I know.** Read in the code by two reviewers.

**Fix.** Report what the settings actually are, both of them, and test the lock when the report runs.

**Where.** `server/ai-key-check.ts:46`

### The handout: lines to correct

| What it says | What the code does |
|---|---|
| "Anthropic: the only AI provider for Landsec data" | True for a Landsec login and for staff viewing as Landsec. Not true for BGP staff working on Landsec material in their normal view, for WhatsApp ChatBGP, or for Document Studio, transcription and web research. |
| "Perplexity, Exa: web-research queries from ChatBGP tools" | A nightly job and the Brand gap card also send Perplexity each scheme's name, postcode, unit uses and missing-brand list. |
| "Keep AI_PROVIDER unset" | Chat reads a second setting, CHATBGP_PROVIDER, first. Both must be left empty. |
| "Microsoft 365 ... synced into the app (subject lines, previews, attendees)" | Accurate for the hourly sync. Left out: a nightly job copies the full text of the last six months of every BGP mailbox and two SharePoint folders into the app, has the AI summarise each item, and makes it searchable by staff ChatBGP and the connector. |
| "The app's activity log records who opened what" | It does not. No table records which person opened which record. Change history exists for deals, the Leasing Schedule, the Targeting Brief and heads of terms, and not for the Landsec unit page or the deal clock. |
| "A complete export and a complete delete are both single operations" | There is no Landsec export or delete routine. Landsec material is also in BGP's mailboxes and diaries, Xero, the old WordPress site and with the services that received it. |
| Services not listed | The outside-assistant connector; Imagine Art; MyScript handwriting recognition; ComplyAdvantage; KYC4U; the old WordPress site's host; a DuckDuckGo search in one ChatBGP tool. |
| "To confirm" lines | Azure OCR in the same tenant, OnlyOffice on BGP's own server and the Railway region each depend on a setting and cannot be confirmed from the code. Also check whether the two AI_INTEGRATIONS_ANTHROPIC settings from the app's earlier hosting are still set: if they are, Claude requests pass through that address first. |

## The 12 November list: what is closed and what is not

| Item | What it was | Now | What is left |
|---|---|---|---|
| 1.1 | Brand CRM plan card showed clients each other's actions | Closed | Marked closed on 12 November. Not re-checked in this review. |
| 1.2 | A file attached to ChatBGP by a Landsec login lost the lock | Closed | Two reviewers ran a slow upload: it stays locked. |
| 1.3 | ChatBGP tools and Document Studio called other providers | Partly | The five tools and the image and Gemini paths are closed in the Landsec view. Perplexity and Exa have no check of their own. |
| 1.4 | "One AI provider" not true for BGP's own work | Open | Unchanged. |
| 1.5 | Asset manager reads BGP's intelligence on any company | Partly | Contacts and email history closed. The pack, covenant, scores and lists are open. |
| 1.6 | Brand pack and brand pages show other clients' deals | Partly | Brand page fixed, confirmed by running. The pack is open. |
| 1.7 | Removing a role turned a restricted login into a full one | Partly | The bin now deactivates and ends sessions, confirmed by running. The Edit form can still change the role. |
| 1.8 | The agreed brief does not hold as a two-signature control | Open | Unchanged on the older card. The Targeting Brief's own sign-off works. |
| 1.9 | NER and the floor check give wrong answers | Partly | "Not checked" now shows when incentives are missing. The break, premium and wording faults remain, and two newer screens use a different sum. |
| 1.10 | Brand sweep would hide trading brands | Closed | Marked closed on 12 November. Not re-checked in this review. |
| 1.11 | Draft brand cases visible to Landsec | Partly | Hidden from the plan and diary. Still open on the brand-case pages, which is recorded as waiting on you. |
| 1.12 | Joint agent's unit page carried BGP's brand contacts and comments | Partly | Blanked on the unit page. Other feeds still send the contact name. |
| 1.13 | The waiting-on clock blames the wrong party | Open | The form always sends the old date, so the server's correction never runs. |
| 1.14 | Landsec deal counts disagree; loose name match | Partly | Lists and the portfolio card are cut to the 14 schemes. The analytics feed still uses the loose match. |
| 2.3 | Files on the unit page did not open | Closed |  |
| 2.4 | Money fields silently blank the value | Open |  |
| 2.5 | Lettings board disagreed with the scheme page | Partly | A unit with two tracker rows still shows twice. |
| 2.6 | Wrong deal picked for a unit | Open |  |
| 2.7 | Days at stage reset after a refused change | Open |  |
| 2.8 | Solicitor fields cannot be cleared | Open |  |
| 2.11 | Merging and deleting units | Open |  |
| 2.12 | Staff viewing as Landsec still see BGP's fee row | Open |  |
| 2.13 | Lock by company name; the outside connector | Partly | The lock now reads the team name and refuses on an error. The connector is unchanged. |
| 2.14 | Marketing files had no scope check | Closed |  |
| 5.1 | Merging duplicate brands strands the brand case | Open |  |
| 5.2 | No change history on Landsec writes | Open |  |
| 5.3 | Two people editing one unit overwrite each other | Open |  |
| 5.5 | Brand-case files served as whatever type the upload claimed | Open |  |
| 5.7 | Outside-firm logins: password rules | Partly | A deactivate control exists. One-character passwords are still accepted. |
| 5.12 | Session security on the new write routes | Closed | Read in the code, not tested in a browser. |

Items of that review about screens and tests (2.1, 2.2, 2.9, 2.10, 2.15 to 2.17) were outside this review. The Letting Tracker review of 12 November listed twelve open items that fall in these files. None is fully closed. Three are partly closed: deleting a unit past Marketing now withdraws its deal first, re-marketing from the tracker row now names the new deal and refuses if it cannot be made, and a plain status change on a closed row now starts a new deal. Still open: a second row and deal when a unit is added under a slightly different name, renaming a unit not reaching its deal, the older Promote route, the Leasing Schedule and tenancy schedule not following the tracker, non-letting types in the Promote box, and three small offer-form faults.

## What held

- A joint agent and an asset manager limited to Bluewater were refused every attempt to read a unit at another Landsec scheme or another landlord by its id: 17 kinds of record, 136 requests.
- Neither could change or delete an offer, viewing or interest line at another scheme by its id. All 40 attempts were refused and nothing in the database changed.
- A joint agent could not add a unit at another scheme, move its own unit to another property, or mark a deal invoiced. Its own unit came back with the fee and BGP's agents blanked.
- The joint agent was refused all 145 brand and company requests. BGP's contacts, the contact cascade and brand email threads were refused to every client login.
- Twenty-three alternative spellings of a refused address (capitals, extra slashes, dot segments, encoded characters, method tricks) were all refused. Only the "#" form got through.
- Removing a joint agent's role deactivates the login. Its open session, its token and a fresh sign-in were all refused straight afterwards.
- The brand page now cuts a brand's deals correctly for each login: the full Landsec login saw its two test deals, the Bluewater asset manager one, the other landlord its own.
- The Brand CRM plan and diary sent the joint agent brand names and stages for its own scheme only, with no company ids, notes, owners or deal links. Another landlord was refused.
- The demo path works end to end: Add brief (a second press reuses the unit, brief and deal), four people sign as themselves, a no-change save keeps the signatures and a real change resets them, two offers, a counter, heads of terms on the Bluewater form, sign-off, issue by the joint agent, final copy, Convert to Solicitors.
- Pressing Agree on two competing offers at the same instant left exactly one agreed. The other was refused with a clear message.
- Share with a brand refused a CRM contact, a brand not named on the unit, an Outlook draft for a joint agent, and any attempt to tick the rent floor, ERV or the incentive ceilings. The stored PDF was refused to every login but BGP staff.
- The deal checklist enforced its people list on the server, and a joint agent could tick only its own tasks.
- Inside the Landsec view the five ChatBGP tools that use outside AI, Document Studio's Gemini path and all image paths refuse, and an attached file stays locked.

## Decisions only you can make

- **The info sheet and the Notes box.** The sheet no longer reaches the website, but it still prints whatever is in Notes when an agent sends it or shares it with a brand. Say whether Notes is the sheet's description or the team's own notes.
- **AML answers typed by agents.** The Promote box now keeps its "AML / KYC checked" answer only from the MLRO, as the deal page already does. The New Deal form still lets anyone start a deal with it set to YES, which switches the AML gate off for that deal. Say whether a new deal may start that way.
- **What Landsec sees about itself.** A Landsec login's own company page still shows BGP's KYC status and PEP flag on Landsec, and the Deals page shows each party's KYC state. The client dashboard withholds both.
- **Thirteen live deals already marked "AML check: YES".** A stored YES switches the AML gate off for that deal: no block on a rejected party and no warning recorded. Thirteen live deals carry one (11 at Solicitors, 1 exchanged, 1 completed), and where it was typed on the old Promote box or the New Deal form nothing records who set it. KYC4U or an admin should confirm or clear them.
- **Pictures that are not website photos.** 186 tracker units carry a picture borrowed from Image Studio, and 171 of them have no uploaded photo. The website has never been able to show those pictures, so they no longer count as the unit's photo: tick one of those units for the website and it reads "Missing 1" until a photo is uploaded. None of the 13 units on the website today is affected.
- **Staff chat and Landsec data.** Pin all ChatBGP to Anthropic by default, or name OpenAI in the handout as a processor for BGP staff chat.
- **The nightly email archive.** Whether Landsec emails and files should be in the searchable archive of full email text. The handout must say what is stored either way.
- **Perplexity and scheme names.** Whether a scheme name with a list of target brands is Landsec's confidential information.
- **The outside-assistant connector.** Keep it with its own per-person key and Landsec left out, or switch it off.
- **Drafts.** Whether Landsec logins should read a recommendation while it is still a draft. Today they can, and can download it. The same question is already open for draft brand cases.
- **Heads of terms agreed outside the app.** Whether a final copy can be uploaded and converted with no sign-off in the app. Today it can, by BGP or a joint agent, and the record does not say that the sign-off was skipped.
- **Names on viewings.** Whether a joint agent may see the name of BGP's contact at a brand on a viewing they are running.
- **AML lines shown to Landsec.** After Convert, a Landsec login reads BGP's AML line in full, for example "AML not complete: Landsec (no checks run)". Only a joint agent gets a neutral line.
- **Telling the MLRO.** Warnings are recorded again once the fix is live, but no screen shows the queue since in-app AML was retired on 5 October. How KYC4U and the MLRO are told is yours and theirs to decide.
- **The older brief card.** Retire it in favour of the Targeting Brief.

## The order I would fix things in

1. **Done, 13 November.** The seven items at the top of this page, fixed and live since 12:27 on 13 November: the brand pack, suggested units, the company routes, the asset manager's pass-through, the "#" trick, the info sheet on the public feed and the older Promote to Solicitors box.
2. **Then.** Correct the handout before it goes to Landsec, and look at the four Railway settings named above.
3. **Then.** One Net Effective Rent sum across the deal clock, the negotiation log and the recommendation.
4. **Then.** Heads of terms: who may amend, keep each version's text, fix the signer list, and stop sign-off being recorded for people with logins.
5. **Then.** The access panel guards, the name-based Landsec check, and the joint agent redactions.
6. **Before the demo.** The Landsec unit page's money boxes and waiting-on clock. Demo from real role logins, and remember that making someone responsible on a checklist sends them a real email.

## How this was checked

Eight reviewers each took one slice, read the code and reported faults and the state of each item from the 12 November review; a second reviewer tried to refute every item. The lead reviewer then ran the main claims on a private local copy of the app (test fixture, no real data, no outside network) as BGP staff, a full Landsec login, an asset manager and a joint agent limited to Bluewater, and another landlord. "Reproduced" means it was made to happen there. The only contact with the live app was one read of the login list.

Not covered: no screen was opened in a browser; the live Railway settings could not be seen; whether the hosting front end passes a raw "#" through was not tested.

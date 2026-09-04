# UX notes — improvement suggestions from rolling QA

Things that WORK but didn't serve the user well during a tested journey:
unclear, clunky, too many steps, or missing something the user obviously
wanted. Collected by the rolling QA routine for Woody's review.

Rules (Woody, 2026-08-01): suggestions are NOT implemented until he confirms
them by number. Bugs (broken vs intended behaviour) don't belong here — those
get fixed directly.

Format per entry: date · persona/surface · what the user was trying to do ·
what happened · concrete suggested improvement.

## Open suggestions

170. 2026-09-04 · BGP staff / desktop 1440px (QA r533) · followed a
   "Messages" link/bookmark on desktop to pick up a team conversation · the
   route redirects to /chatbgp (by design — /messages is the mobile chat
   tab), but with no AI key configured ChatBGP renders a FULL-PAGE dead end:
   "Not Connected — AI service is not configured. Please contact your
   administrator to enable ChatBGP." There is no nav, no thread list and no
   way back to team chat from that screen — person-to-person messaging needs
   no AI at all, so an AI outage (or a key rotation) reads as "messaging is
   down". SUGGESTION: keep the ChatBGP composer disabled with that notice,
   but still render the page shell + thread list, so team conversations stay
   readable and openable when the AI service is unavailable.

169. 2026-09-04 · BGP staff / desktop 1440px (QA r532) · opened Requirements
   to check what leasing briefs were live · the page renders the table HEADER
   ROW (Name / Date / Status / Use / Requirement Type / Size / Req. Locations)
   over a ~130px tall empty grey slab with NO empty state at all — no icon, no
   copy, no call to action, just "0 active requirements" in the strip above.
   Comps, Evidence Plans and the tracker all have a proper icon + sentence +
   action empty state; Requirements is the odd one out, and a first-time user
   can't tell whether it's empty or still loading. SUGGESTION: give both
   Requirements tabs (LEASING and INVESTMENT) the house empty state — icon,
   "No leasing requirements yet", one line of guidance, and an "Add
   requirement" button that opens the same dialog as the header button.

168. 2026-09-04 · BGP staff / desktop 1440px (QA r532) · went to Comps for
   rent-review evidence on a Bluewater unit · the strip reads "0 comps · 0
   verified · 11 AI leads awaiting review · 0 areas" and the body says "No
   matching comps — Try adjusting your filters". The advice is wrong: no
   filter change can help, because every one of the 11 comps in the system is
   an unreviewed AI lead and the table only ever shows CONFIRMED comps. The
   answer sits in the strip one line above, but nothing connects them, so the
   user clears filters, re-searches, and concludes the comps database is
   empty. SUGGESTION: when there are 0 confirmed comps but N leads, swap the
   empty state for "All N comps are AI leads awaiting review" plus a button
   that opens the leads panel; keep "Try adjusting your filters" for the case
   where confirmed comps exist but the filters exclude them.

167. 2026-09-04 · Landsec client / desktop 1440px (QA r531) · looked at
   "Your BGP Team" on the dashboard while auditing the client-teams routes ·
   the board renders SEVEN empty kanban columns (Office / Corporate,
   Investment, Lease Advisory, National Leasing, Development, Tenant Rep,
   London Leasing) each saying "drop here", with both of Landsec's actual
   people — Victoria Broadhead and Woody Bruce — parked in an eighth
   "UNASSIGNED" column, then ~300px of empty board below. A landlord reading
   it cold sees a mostly-blank board and no answer to "who do I call".
   Suggestion: collapse (or hide) columns with zero members for client
   viewers and render UNASSIGNED first, so a 2-person team reads as two
   cards rather than seven vacancies; keep the full column set on the staff
   side, where the columns are the editing surface.

166. 2026-09-04 · BGP staff / mobile 390px (QA r530) · between viewings,
   wanted her own numbers · the phone home screen leads with "MY BILLING —
   2026/27" showing £0 Billed / £0 Commission / £0 Potential / £0
   Negotiating / £0 Solicitors, and immediately under it "TOTAL BILLING
   £250,000". Read cold on a phone that looks like the app has lost her
   figures, when the truth is the firm's six live deals simply have no BGP
   contact set to her. Suggestion: when a staff user's own billing is all
   zero, say why on the tile — "No deals with you as BGP contact yet" —
   instead of five £0s, and label the tile below "TOTAL BILLING (firm)" so
   the two numbers can't read as the same figure.

165. 2026-09-04 · BGP staff / mobile 390px (QA r530) · wanted the Letting
   Tracker on her phone · nothing on the phone shell points at it: the four
   bottom tabs are Dashboard / Messages / Deals / News, and the home
   screen's tiles are Deals, Expenses, Images, CRM + Brand Intelligence,
   Comps, SharePoint, Property Intelligence. The tracker is reachable only
   by typing the URL, by global search, or two hops via the billing tile →
   WIP Report → its "Letting Tracker" pill. It is the board leasing staff
   live in day to day, and the client shell shows a Tasks tab for less.
   Suggestion: add a "Letting Tracker" tile to the phone home screen's
   first tile row (it already renders a proper phone card list, verified
   this round at 390px), or swap it in for one of the BOARDS tiles.

164. 2026-09-04 · Landsec client / phone 390px + desktop (QA r529) · logged
   a viewing from the Letting Tracker and typed a brand the CRM doesn't
   hold yet · since r528 the client's company picker correctly no longer
   offers the staff-only "Create company" row, but what replaces it is a
   bare "No matches." — a dead end that doesn't say the name can still be
   typed into the notes, or that BGP add companies. Staff, one login over,
   get "Create company '<name>'". Suggestion: give the client picker its
   own empty state — "No match — type the brand in the notes and your BGP
   team will add it" — so the removed control leaves guidance behind
   rather than a full stop.

163. 2026-09-04 · Landsec client / mobile 390px (QA r528) · logged an offer
   from a Letting Tracker unit card on the phone · "Save Offer" is enabled
   with the form untouched, so a stray tap creates an offer row with no
   company, no rent and no date content behind it — the exact shape #154
   was confirmed to block for viewings, on the sibling dialog two buttons
   away (the viewing Save correctly stays disabled until company/contact/
   attendees/notes is set). Suggestion: apply #154's guard to the offer
   dialog — require at least one of company/contact/rent before Save
   enables (and the same for the Interest dialog).

162. 2026-09-04 · Landsec client / mobile 390px (QA r528) · opened the app on
   the phone, wanted to search for a unit and check notifications from the
   home tab · #156's phone-shell header search + bell are there on every
   normal route (/available, /deals, /news…) but NOT on the Dashboard tab —
   "/" renders the mobile dashboard shell, which has its own header with no
   search icon and no bell, so the first screen of the app is the one place
   the client can't search or see notifications from. Suggestion: put the
   same GlobalSearch + NotificationCenter pair in the mobile dashboard
   header so the entry points don't disappear on the home tab.

161. 2026-09-04 · BGP staff / desktop 1440px (QA r527) · opened a bookmarked
   /subscriptions link as a non-admin (Victoria, Head of National) · the
   page loads, but its "API Keys & Environment" panel reads "Status
   unavailable" and still offers the admin controls: pressing "Test Apollo /
   Xero / CH" paints three red XCircle tiles — "Apollo.io Request failed",
   "Companies House Request failed", "Xero Request failed" plus a
   "Connect / Reconnect Xero" prompt — because /api/integrations/status and
   /api/integrations/ping are requireAdmin. It reads as "the firm's
   integrations are down", not "this bit is admin-only". The page is out of
   her sidebar (adminNavBase renders only when user.isAdmin), so this is the
   pasted-URL/bookmark path — but /finance and /expenses route-gate
   (EquityRoute/AdminRoute) while /subscriptions, /whatsapp, /addins and
   /settings don't. Suggestion: either wrap /subscriptions in AdminRoute
   like /expenses, or hide the keys panel for non-admins and label the
   failure "Admin only" instead of a red request-failed state.

160. 2026-09-04 · Landsec client / desktop 1440px (QA r526) · read Brand News
   for stories on their own brands · each card's footer prints the raw
   signal_type token from the database — "Starbucks · sector_move · 3 Aug
   2026", also "portfolio_change", "leadership" — machine field names in a
   client-facing feed. Suggestion: map the tokens to sentence-case labels
   ("Sector move", "News", "Opening") on the client feed, same as the deal
   status labels do.

159. 2026-09-04 · Landsec client / desktop 1440px (QA r526) · scanned the
   portfolio dashboard KPI strip · two tiles end in a dangling fragment:
   Total Units reads "124 occupied · 77 vacant · full rent roll" and
   Occupancy "38.3% vacancy · of full rent roll", which next to a Passing
   Rent tile showing "—  no passing rent recorded yet" reads as if a figure
   failed to load rather than as a note about the denominator. Suggestion:
   fold the qualifier into the tile's own sentence ("across the full rent
   roll") or drop it — the strip already says which units are counted.

158. 2026-09-04 · Landsec client / desktop 1440px (QA r526) · opened their
   own deals from the Deals hub · #155 shipped read-only party slots on the
   deal DETAIL page ("Not set yet — your BGP team will link parties"), but
   the Deals TABLE one click earlier still shows the staff pickers for the
   same two fields — the Client column's "+ Link landlord" (the open #129
   complaint) and a Tenant column "+ Link tenant" that opens the full
   company directory (Amorino, Honi Poke, Starbucks, Testco…) and writes
   the deal. Same deal, two behaviours, one of them the one #155 was
   confirmed to remove. Suggestion: decide #129 with #155's answer — client
   party cells read-only in the table too (Client defaulting to their own
   company), leaving the Edit dialog as the one place a client sets parties.

157. 2026-09-04 · BGP staff / desktop 1440px (QA r524) · searched the Letting
   Tracker for a unit, then clicked the FY "Viewings 2" strip chip to see
   which units had viewings — the chip is a global toggle that intersects
   with the search, so the list dropped to 0 rows while the strip still said
   "Viewings 2", and the only explanation ("showing units with viewings —
   click again to clear") sits far right in small text. Suggest the strip
   counters reflect the active search/filters (or the chip clears the search),
   so the numbers users see match the rows below.

150. 2026-09-03 · Landsec client / desktop 1440px (QA r500) · tried to open
    an account/profile menu from the sidebar footer · clicking "Mark Warne"
    (or the MW avatar) does nothing — the only affordance there is the
    small logout arrow, and there is no client-facing account surface at
    all (change password, notification prefs, email). Clients who want to
    change their password have to ask BGP. Suggestion: make the name/avatar
    open a small menu (Account, Log out) even if Account only offers a
    change-password form for now.

129. 2026-09-02 · Landsec client / desktop 1440px (QA r452) · reviewing
    their own deals on the Deals board · both Landsec deals show an empty
    "Client" column with a staff-worded "+ Link landlord" affordance — as
    the client, "who the client is" is themselves, and the empty cell +
    staff jargon reads like something is broken or unassigned · for client
    users, default the deal's client cell to their own company name (or at
    least relabel the empty state "Link client" and pre-select their
    company in the picker, which now only offers Landsec anyway).

128. 2026-09-01 · BGP staff / desktop 1440px (QA r450) · using the WIP
    report's TEAM cross-filter board to see how the teams are tracking ·
    the board opened showing "National £0" and "National Leasing £0" while
    the headline right above says "Total net fees: £250,000" — the only
    fee-bearing deal has no team set, so both team rows read £0 and the
    board looks broken even though the filter itself works · either bucket
    fee-bearing deals with no team into a visible "No team" row on the
    board (like the Client board's "—" handling), or show the deal count
    next to each row so £0 with 2 deals reads as "fees not filled in",
    not "nothing happening".

(Woody 2026-08-18, on confirming 50-64: "ignore 46 and 32" — the two entries
below stay parked, not built. Rounds shouldn't re-log them.)

127. 2026-09-01 · BGP staff / mobile 390px (QA r448) · searching landlords in
    CRM (Contacts → landlord search) · a query with no hits ("sa") empties
    the list to a bare blank area — only the small "0 results" counter next
    to the search box says anything, and on the phone it's easy to miss ·
    show a proper empty state in the list area ("No landlords match — clear
    search"), like the contacts card list already has.

126. 2026-09-01 · Landsec client / mobile 390px (QA r446) · opening the full
    Bluewater tenancy schedule on the phone · the page shows two stacked
    headers (the shell's "Tenancy Schedule" bar, then the page's own
    "Back to property / Tenancy Schedule" block) and the two-line page
    title leaves "· Bluewater Shopping Centre" hanging awkwardly in the
    right gutter · on the phone shell, collapse to the shell header alone
    (or one compact "Tenancy Schedule · Bluewater" line) so the schedule
    starts a screen-height sooner.

125. 2026-09-01 · Landsec client / desktop 1440px (QA r444) · reading the
    Bluewater tenancy schedule stat strip during quarterly-review prep ·
    "PASSING RENT" shows "—" when no rent is recorded but the neighbouring
    "AVG ERV £PSF" shows "0" for the same kind of missing data — a client
    could read that as a genuine £0 ERV · use the same dash-when-unset rule
    for ERV (and any other stat tiles) as passing rent.

124. 2026-09-01 · BGP staff / desktop 1440px (QA r442) · scanning Image
    Studio's LIBRARY tab · the sidebar category "Uncategorised" said 1 while
    the albums view showed an "Uncategorised" folder with 2 photos beside an
    "All 2" count — the sidebar counts images whose CATEGORY is
    Uncategorised, the album groups images with NO ADDRESS, two different
    meanings sharing one label on the same screen · rename the album folder
    (e.g. "No address") or count both by the same rule.

123. 2026-09-01 · staff + client / unit Files dialog (QA r438) · generated an
    info sheet on a unit whose particulars fields are all empty · the PDF
    prints the "PARTICULARS" heading + rule with nothing under it — a
    visibly empty page-1 body that an agent could accidentally issue ·
    suppress the heading when no particulars rows exist, or warn "this unit
    has no area/rent/EPC recorded" before generating.

122. 2026-09-01 · Landsec client / mobile 390px (QA r438) · tapped "Files"
    on a tracker unit card wanting the brochure · the dialog's second
    action is "Create in Doc Studio", which opens the staff Document Studio
    in a new tab — on the phone shell that's a dead end for a client ·
    hide the Doc Studio button for client logins (staff keep it).

121. 2026-09-01 · Landsec client / desktop 1440px (QA r436) · "see how my
    Bluewater lettings are progressing" · property page header metadata
    (Status, Asset Class, BGP Team, Website, Area) all rendered as bare
    em-dashes on the fixture — five "—" fields at the very top make the page
    look unfinished to a client · hide unset header fields (or collapse the
    block) instead of printing dash placeholders.

120. 2026-09-01 · Landsec client / desktop 1440px (QA r436) · scanning the
    Letting Tracker for progress · every Available row shows two adjacent
    pills that both read "Available" (Unit Status + Deal Status) — across 75
    rows the duplication is noise and hides the rows where the two actually
    differ · collapse to one pill when the values match, or visually
    de-emphasise the duplicate.

119. 2026-09-01 · Landsec client / desktop 1440px (QA r436) · followed a
    /turnover link while logged in as a client · the client shell doesn't
    register the route, so the app silently bounced to the dashboard — no
    message, looks like a broken link (the /api/turnover data itself is
    correctly slice-scoped) · show a "not available for client accounts"
    notice (or a client turnover slice page) instead of a silent redirect.

118. 2026-08-29 · Landsec client / ChatBGP (QA r426, code review — no browser
    this round) · "ask ChatBGP how my F&B tenants at Bluewater are trading" ·
    query_turnover was reachable from client chat but read the WHOLE turnover
    table (any landlord's schemes), so r426 blocked it for clients along with
    the other money tools — meaning a client now gets no turnover answer at
    all from chat · Suggest: a portfolio-scoped turnover path for client
    ChatBGP (filter to the caller's own properties, same slice as their Comps
    board), so the legit "how are MY tenants trading" ask works again.

117. 2026-08-29 · BGP staff / desktop 1440px (QA r422) · "message a colleague
    from the desktop chat panel" · Picking one person in New Message shows a
    button labelled "Create Group (1 member)" — the user is starting a 1:1,
    not a group; mobile already says "Start Chat" for a single pick ·
    Suggest: mirror mobile's label on desktop — "Start Chat" when exactly one
    member is selected, "Create Group (N members)" otherwise.

116. 2026-08-28 · BGP staff / desktop 1440px (QA r413) · "log yesterday's
    viewing with the brand, then record the offer they made" · Both steps
    work, but they are two fully separate dialogs: after saving a viewing
    with outcome "Offer Expected", recording the actual offer means closing
    the Viewings dialog, opening the Offers dialog on the same row and
    re-picking the same company/contact/date from scratch — double data
    entry for what the user experiences as one event ("they viewed, then
    offered") · Suggest: a "Record offer" shortcut on the viewing card (or
    shown after saving with outcome "Offer Expected") that opens the offer
    form pre-filled with the viewing's company, contact and date.

115. 2026-08-28 · Landsec client / mobile 390px (QA r409) · "a colleague
    mentioned a brand — look it up" · Brand Intelligence search for a brand
    that isn't in the client's slice (e.g. "Gail") says only "No matches for
    'Gail' — try a shorter name." Two issues: (a) "try a shorter name" is
    odd advice for a 4-letter query, and (b) the empty state never points at
    the "Add brand" button sitting directly above it, which searches the
    WIDER global directory and is exactly what the user needs next (the
    self-add flow itself works cleanly at 390px — verified this round).
    Suggest: zero-hit copy becomes "No matches in your brands — search the
    wider directory via Add brand" (mirrors the confirmed #13 pattern on
    Contacts).

114. 2026-08-28 · Landsec client / desktop 1440px (QA r407) · "see how my
    Bluewater lettings are progressing" · On the client Properties table
    (/properties, TABLE view) only the property NAME text is clickable —
    clicking anywhere else in the row (ownership chips aside, the row is
    mostly empty cells: Status/Class/Team all "—") does nothing, with no
    hover cue about where the click target is. Users treat list rows as
    click targets; a whole-row click (like the Letting Tracker rows) or at
    least a cursor-pointer row hover would remove the dead-click. Suggest:
    make the row itself open the property, keeping inner links working.

113. 2026-08-28 · BGP staff / mobile 390px (QA r403) · "on the train: check
    my diary for today" · The calendar page itself is genuinely phone-ready
    (day view, UPCOMING list, event bottom-sheet with attendees all render
    clean at 390px) but a staff phone user has NO tap path to it: bottom
    nav is Dashboard/Messages/Deals/News, the staff mobile-home QUICK_LINKS
    are Deals/Expenses/Images/CRM, and the only in-app links to /calendar
    live on the desktop dashboard widget and inside a deals-page meetings
    card that is M365-gated. Clients DO get a Calendar tile
    (PORTFOLIO_LINKS). Victoria has to type the URL or ask ChatBGP.
    Suggest: add a Calendar tile to QUICK_LINKS in mobile-home.tsx
    (mirroring the client grid), or surface a "today" diary strip on the
    staff mobile home that links through.

112. 2026-08-27 · Landsec client / mobile 390px (QA r401) · "check a tenant's
    covenant standing" · On a client's brand Compliance panel, when no UK
    trading entity is set the copy says "Not confirmed yet — BGP is
    identifying the UK trading entity." but immediately below it offers the
    client a "Search Companies House for ‘X’" link (external CH search).
    Mixed message: the client is told BGP is handling it, then handed the
    tool to do it themselves (and they can't save a match anyway — edit is
    staff-only). Suggest: hide the CH search link for client viewers
    (brand-profile-panel.tsx ~line 4130, gate on bcIsClient like the
    edit/rescrape buttons beside it).

111. 2026-08-27 · Landsec client / mobile 390px (QA r401) · "a colleague says
    Wagamama's lease is expiring — find their contact" · Wagamama Limited is
    on Mark's own tenancy schedule, but has no brand row in the directory,
    so Brand Intelligence search says "No matches for ‘wagamama’ — try a
    shorter name" and the Add-brand dialog (global directory search) also
    dead-ends at "No brands match." — there is NO path for a client to get
    their own tenant tracked from here (partly a fixture data gap, but the
    dead end is real whenever a tenancy tenant is missing from the
    directory). Suggest: when a client search misses, check the tenant
    names on their own tenancy schedules and offer "Wagamama is one of your
    tenants — ask BGP to add it" (request lands with staff), or auto-seed
    directory stubs from tenancy-schedule tenant names.

110. 2026-08-27 · Landsec client / desktop 1440px (QA r399) · "which leases
    expire soon — show me Wagamama's" · The dashboard EXPIRING (6M) KPI
    opens a tidy popover of 8 expiring tenants, but clicking a tenant lands
    on the full 200-unit Tenancy Schedule with no filter or highlight — the
    user has to re-type the tenant name into the schedule search to find the
    row they just clicked. Suggest: carry the tenant through (prefill the
    schedule search with the clicked tenant, or scroll-to + flash-highlight
    the matching row).

109. 2026-08-27 · BGP staff (non-admin) / desktop 1440px (QA r397) · "check
    my numbers on the WIP report" · For a non-admin agent the WIP REPORT
    tab lists deals (header said "6 transactions · £250,000") but the AGENT
    SUMMARY tab on the same screen came back empty — the summary endpoint
    only counts deals whose team exactly equals the user's team string
    (fixture deals carry team "National" vs Victoria's "National Leasing",
    and team-less deals are skipped entirely for non-admins), while the
    deal table clearly uses a looser rule · Align the two tabs' scoping
    (same team-matching rule, and decide whether team-less deals belong in
    a non-admin's summary) so the two tabs on one screen never disagree.
    Flagging as UX not bug: may be a fixture-data artifact — prod team
    strings may match exactly.

108. 2026-08-27 · BGP staff / desktop 1440px (QA r397) · "remove a fee split
    I added on the wrong deal" · Once a fee split is saved it cannot be
    cleared: the editor's BGP House row is locked and auto-re-added, saving
    with only BGP House trips "Percentages total 15% — must equal 100%",
    and the API rejects an empty allocations array by design (must include
    the BGP House row) · Add an explicit "Clear split" action on the Fee
    Allocation card (staff-only, confirm dialog) that removes all rows and
    returns the deal to "No split yet".

107. 2026-08-27 · BGP staff (equity) / mobile 390px (QA r395) · "check the
    cashflow forecast on my phone" · On the Finance page's cashflow stat
    tiles, big negative amounts render as "£" alone on one line with
    "(4,244,249)" wrapped underneath (LOW POINT / CLOSE tiles at 390px) —
    legible but scruffy · Keep the currency symbol glued to the number
    (non-breaking, e.g. £(4.24m) or whitespace-nowrap + smaller type on
    the phone tiles).

106. ~~2026-08-27 · BGP staff (equity) / mobile 390px (QA r394) · /cashflow
    phone double header~~ · OBSOLETE r395: cashflow v3 removed the
    standalone /cashflow page (it now redirects to /finance, which has no
    double header at 390px — verified r395). Nothing to build.

105. 2026-08-27 · Landsec client / mobile 390px (QA r393) · "look at the
    Bluewater floor plan on my phone" · The Plans viewer opens at 100% zoom
    showing one giant colour block, and its only usage hint reads "drag to
    pan · wheel to zoom" — there is no wheel on a phone, and no pinch-zoom
    hint or fit-to-screen start state · Start the plan fitted to the
    viewport and switch the hint to touch wording ("pinch to zoom") when
    the device is touch.

104. 2026-08-27 · Landsec client / mobile 390px (QA r393) · "open my
    Bluewater property page" · The Overview card leads with Status, Asset
    Class, BGP Team, Website and Area — all showing "—" dashes for the
    client's own flagship property, pushing the real content (ownership,
    tasks, risk register) below a card of empty placeholders · Hide
    unfilled fields for client viewers (or fill these fields for Landsec
    properties — Bluewater has no asset class or website set).

103. 2026-08-27 · BGP staff / desktop 1440px (QA r392) · "check a unit's
    rateable value" · The Business Rates entry-detail sheet slides up as a
    full-width bottom sheet at 1440px — each label sits at the far left and
    its value ~1,350px away at the far right, so the eye has to track the
    whole screen per row · Cap the sheet at ~640px (centred, or a right-hand
    side sheet on desktop); mobile behaviour is fine as is.

102. 2026-08-27 · BGP staff / desktop 1440px (QA r392) · "make a folder /
    delete a file in SharePoint" · New folder uses the native browser
    prompt() and delete uses confirm() — both work, but they're unstyled
    browser chrome in an app where every other action uses the design-system
    dialog, and the prompt offers no inline duplicate-name feedback (409
    only surfaces as a toast after submit) · Swap to the app Dialog with an
    input + validation message.

101. 2026-08-27 · Landsec client / desktop 1440px (QA r391) · "add a note-to-
    self on my Bluewater property page" · The This Week's Focus quick-add
    placeholder reads "Add a task — e.g. Pizza Express HOTs to legal" — BGP
    staff jargon (HOTs, a rival-agent-style example) shown to a landlord
    client · Give client viewers a client-flavoured example ("e.g. Chase
    Q3 leasing update") or a neutral "Add a task…".

100. 2026-08-26 · BGP staff / desktop 1440px (QA r389) · "log a viewing on
    a Bluewater unit from the Letting Tracker" · The per-unit Viewings /
    Offers count buttons live in the activity column, which sits off-screen
    to the right at 1440px — the visible Actions column only offers
    AI/comment/edit/delete, so logging a viewing means discovering a
    horizontal scroll first (the FY strip up top shows viewing counts,
    which makes the missing per-row affordance more surprising) · Surface
    a Viewing/Offer action in the always-visible Actions cluster (or its
    ⋯ menu), or pin the activity column so it stays on-screen.

99. 2026-08-26 · BGP staff / mobile 390px (QA r387) · "review the photos I
    took on a site visit in /m/images" · Tapping a photo in Recent Captures
    opens the Edit-with-AI sheet, where the photo itself is a small
    thumbnail strip at the top ("Tap to zoom" for the real view) — a user
    who just wants to LOOK at their capture gets an editing prompt and
    suggestion pills first, and the actual photo needs a second tap ·
    Open a full-screen viewer on tap (swipe between captures), with Edit
    with AI as an action on that viewer; keeps the one-tap edit path but
    makes the common "just look at it" case first-class.

98. 2026-08-26 · BGP staff / mobile 390px (QA r386) · "open the Planning
    documents dialog on a pathway run from a phone" · The dialog opens and
    is legible, but each application header keeps its desktop columns
    (date w-20 + LPA badge + PDF-count badge all shrink-0), leaving ~110px
    for the reference and description — refs like PP/25/06454 break
    mid-token onto two lines and descriptions wrap 2-3 words per line ·
    On <sm stack the header: date + badges on one small top line, ref +
    description full-width below (doc rows could do the same with their
    category pill).

97. 2026-08-26 · Landsec client / desktop (QA r383) · "scan my Letting
    Tracker to see how lettings are progressing" · Every row's Property/Unit
    headline is the truncated property name ("Bluewater Sho...") repeated
    153 times, while the distinguishing unit name sits in the small grey
    sub-line — for a client whose whole tracker is one property the primary
    line carries zero information and the eye has to read the sub-line on
    every row · Flip the emphasis (unit name as the headline, property as
    the sub-line), or at least stop truncating when the column is wide
    enough — staff multi-property boards can keep property-first.

96. 2026-08-25 · BGP staff / mobile 390px (QA r379) · "open a brand's Stores
    pill on the phone" · On a 0-store brand the auto-fired store scan's
    failure surfaces as a raw config string in a red toast ("Store search
    failed / GOOGLE_API_KEY not configured") that covers a third of the
    phone screen and outlives two pill switches · Map server-side config
    errors to a friendly "Store research isn't available right now" and
    keep the toast short — the raw error can go to the console/log instead.

94. 2026-08-25 · BGP staff / desktop (QA r373) · "log a £25m offer on The
    Royal Exchange from the Investment Tracker offers dialog" · When the
    save failed (pre-fix date 400), NOTHING happened — the add form just sat
    there: the viewing/offer/distribution dialog mutations in
    investment-tracker.tsx have no onError toast (the page-level mutations
    all do). The user can't tell a failed save from a slow one and may close
    the dialog believing the offer was logged · Add the standard onError
    destructive toast to the add/update/delete mutations inside
    ViewingsDialog, OffersDialog and DistributionsDialog.

93. 2026-08-25 · BGP staff / mobile 390px (QA r371) · "log an offer on a
    tracker unit" · When server validation rejects a form, the toast shows
    the raw zod text — e.g. 'Validation error: Number must be less than or
    equal to 8388607 at "rentPa"' (seen before the r371 cap fix; other
    forms still surface messages in this shape, field names in code-speak) ·
    Map validation failures to friendly wording using the form's field
    labels ("Rent p.a. is too large") before tossing them into the toast.

92. 2026-08-25 · Landsec client / mobile 390px (QA r369) · "search Brand
    Intelligence for a brand I'm scouting (Amorino)" · The search-result
    tile shows a blank white square where the logo should be when a brand
    has no logo image — looks broken next to the name · Fall back to the
    lettered avatar the brand profile header already uses (an "A" chip for
    Amorino) instead of an empty square.

83. 2026-08-21 · Landsec client / mobile 390px (QA r361) · "check my
    property on the PI map from my phone" · On the Map tool at 390px the
    map canvas runs underneath the fixed bottom nav: the Google Maps zoom
    "+/-" control sits half-hidden behind the Portfolio/…/News bar
    (bottom-right corner), and the search row's Resolve button touches the
    right edge. Everything still works, but zoom is a fiddly tap. Suggest
    giving the map container bottom padding equal to the bottom-nav height
    on mobile (and a little right inset on the search row).

82. 2026-08-21 · Landsec client / desktop 1440px (QA r360) · "review my
    saved Land Registry searches" · The Recent Searches cards show a status
    dropdown (New/Investigating/…) and a link-to-property button, but both
    write via PATCH /api/land-registry/searches/* which is staff-only — a
    client picking a status just gets a silent 403. Suggest rendering the
    status as a plain badge and hiding the link button for client logins
    (the statuses are acquisition-pipeline labels aimed at staff anyway).

81. 2026-08-21 · Landsec client / desktop 1440px (QA r359) · "look up my
    property on the Property Intelligence map" · The intelligence panel's
    header strip offers a "No Pathway run yet — Run Pathway" button, but
    Pathway is a hidden staff-only tool for clients (every
    /api/property-pathway route 403s), so the button can only dead-end;
    the panel also fires a 403'd pathway/latest fetch on every resolve.
    Suggest hiding the Pathway strip (and skipping the pathway/latest
    fetch) for client logins, as the Pathway/Investigator tabs already are.

80. 2026-08-20 · Landsec client / mobile 390px (QA r353) · "ask ChatBGP a
    question from my phone" · The empty-chat suggestion chips are one static
    list shared by every persona (AI_SUGGESTIONS in mobile-app.tsx), so a
    Landsec client is offered "Draft HOTs for a property" and "Search CRM
    contacts" — staff jobs they'd never phrase that way. Suggest a
    client-flavoured set when user.role is client, e.g. "What's happening
    across my portfolio?", "Which of my units are available?", "What's my
    passing rent at Bluewater?".

79. 2026-08-20 · Landsec client / desktop 1440px (QA r351) · "check what
    leasing requirements BGP is tracking for us" · The desktop Requirements
    table's empty state says the generic "No active requirements found" —
    the client-aware line from UX #38 ("No live requirements for your
    portfolio yet — BGP logs these on your behalf") was only wired into the
    mobile card view. A client at a desk gets no hint that this list is
    BGP-maintained rather than self-serve. Suggest reusing the same
    isClientView copy in the desktop table's empty row.

78. 2026-08-20 · BGP staff / desktop (QA r349) · "a new brand just rang about
    a unit — log the interest" · The Letting Tracker's Interest dialog only
    lets you pick a company that already exists in CRM (the combobox has no
    inline-create, unlike the investment tracker's picker which has an
    onCreate row). For a brand-new caller the user has to abandon the dialog,
    create the company in CRM, come back and reopen it. Suggest adding the
    same inline "create brand" row to the Interest (and Viewing/Offer)
    company pickers.

77. 2026-08-20 · BGP staff / mobile 390px (QA r347) · "check who's in Unit
    BX10 on the Bluewater tenancy board from my phone" · The full tenancy
    board's sticky Unit column is so narrow at 390px that unit names truncate
    to ~3 characters ("QA-…", "GLO…") — once you scroll the columns you can't
    tell which row is which. Suggest widening the sticky column a touch on
    mobile, or wrapping the unit name to two lines inside it.

46. 2026-08-14 · Landsec client / desktop 1440px (logged by QA r294 on the
    staging branch) · "check my property before a lease-expiry chat with
    BGP" · the property page's Compliance & KYC sidebar (deliberately
    client-visible per the 2026-08-01 decision) also exposes the BILLING
    ENTITY row as an EDITABLE control to clients — "+ Set billing entity"
    opens the full company-search dropdown and the PUT succeeds, letting a
    client change the SPV that BGP invoices its own fees to · Suggested:
    render the billing entity read-only (name badge only) for client
    viewers, same pattern as the brand-profile KYC staff-action gating.
    Needs Woody's numbered confirmation — not built.

32. 2026-08-11 · Landsec client / mobile 390px · "a colleague asked who our
    contact at Starbucks is — find them on my phone" · the brand profile at
    390px leads with the full-height Chat panel, so the KEY CONTACTS card
    (and everything else) starts more than one screen down; the contact
    lookup meant scrolling past a mostly-empty chat box every visit ·
    Suggested: on mobile, collapse the brand-profile chat to a compact
    "Ask about this brand" bar (expanding on tap) so contacts/covenant/
    signals are visible on the first screen.
    (r259 addendum: same layout confirmed on STAFF mobile 390px — Victoria's
    pre-meeting brand review also starts a full screen below the chat panel,
    so the fix should cover /companies/:id for both personas.)

## Confirmed / done

103. 2026-08-27 · BGP staff / desktop 1440px (QA r392) · "check a unit's
    rateable value" · The Business Rates entry-detail sheet slides up as a
    full-width bottom sheet at 1440px — each label sits at the far left and
    its value ~1,350px away at the far right, so the eye has to track the
    whole screen per row · Cap the sheet at ~640px (centred, or a right-hand
    side sheet on desktop); mobile behaviour is fine as is.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

102. 2026-08-27 · BGP staff / desktop 1440px (QA r392) · "make a folder /
    delete a file in SharePoint" · New folder uses the native browser
    prompt() and delete uses confirm() — both work, but they're unstyled
    browser chrome in an app where every other action uses the design-system
    dialog, and the prompt offers no inline duplicate-name feedback (409
    only surfaces as a toast after submit) · Swap to the app Dialog with an
    input + validation message.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

101. 2026-08-27 · Landsec client / desktop 1440px (QA r391) · "add a note-to-
    self on my Bluewater property page" · The This Week's Focus quick-add
    placeholder reads "Add a task — e.g. Pizza Express HOTs to legal" — BGP
    staff jargon (HOTs, a rival-agent-style example) shown to a landlord
    client · Give client viewers a client-flavoured example ("e.g. Chase
    Q3 leasing update") or a neutral "Add a task…".
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

100. 2026-08-26 · BGP staff / desktop 1440px (QA r389) · "log a viewing on
    a Bluewater unit from the Letting Tracker" · The per-unit Viewings /
    Offers count buttons live in the activity column, which sits off-screen
    to the right at 1440px — the visible Actions column only offers
    AI/comment/edit/delete, so logging a viewing means discovering a
    horizontal scroll first (the FY strip up top shows viewing counts,
    which makes the missing per-row affordance more surprising) · Surface
    a Viewing/Offer action in the always-visible Actions cluster (or its
    ⋯ menu), or pin the activity column so it stays on-screen.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

99. 2026-08-26 · BGP staff / mobile 390px (QA r387) · "review the photos I
    took on a site visit in /m/images" · Tapping a photo in Recent Captures
    opens the Edit-with-AI sheet, where the photo itself is a small
    thumbnail strip at the top ("Tap to zoom" for the real view) — a user
    who just wants to LOOK at their capture gets an editing prompt and
    suggestion pills first, and the actual photo needs a second tap ·
    Open a full-screen viewer on tap (swipe between captures), with Edit
    with AI as an action on that viewer; keeps the one-tap edit path but
    makes the common "just look at it" case first-class.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

98. 2026-08-26 · BGP staff / mobile 390px (QA r386) · "open the Planning
    documents dialog on a pathway run from a phone" · The dialog opens and
    is legible, but each application header keeps its desktop columns
    (date w-20 + LPA badge + PDF-count badge all shrink-0), leaving ~110px
    for the reference and description — refs like PP/25/06454 break
    mid-token onto two lines and descriptions wrap 2-3 words per line ·
    On <sm stack the header: date + badges on one small top line, ref +
    description full-width below (doc rows could do the same with their
    category pill).
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

97. 2026-08-26 · Landsec client / desktop (QA r383) · "scan my Letting
    Tracker to see how lettings are progressing" · Every row's Property/Unit
    headline is the truncated property name ("Bluewater Sho...") repeated
    153 times, while the distinguishing unit name sits in the small grey
    sub-line — for a client whose whole tracker is one property the primary
    line carries zero information and the eye has to read the sub-line on
    every row · Flip the emphasis (unit name as the headline, property as
    the sub-line), or at least stop truncating when the column is wide
    enough — staff multi-property boards can keep property-first.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

95. 2026-08-25 · Landsec client / mobile 390px (QA r377) · "look up Starbucks
    from the phone Brands search and see who they are / who to call" · The
    brand profile opens on the CHAT pill ("Ask anything about Starbucks — @
    tags properties…"), which reads as an internal BGP tool; the client had
    to notice and tap Contacts/Intel to get what they came for · Land client
    logins on Contacts (or Intel) instead of Chat on the phone brand
    profile — staff can keep Chat-first.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

91. 2026-08-24 · Landsec client / desktop 1440px (QA r367) · "catch up on
    news about my tenants" · The Brand News list shows the same story twice
    when the raw feed headline and the normalised signal differ slightly —
    e.g. "Musician sues Starbucks for £2m after 'career-ending' incident in
    London branch - London Evening Standard" and "Musician sues Starbucks
    for £2m over incident at London branch" render as two entries a few rows
    apart. Brand-profile Signals already dedupe by normalised headline (UX
    #12); suggest applying the same near-duplicate collapse to the News tab
    list so clients don't read the same lawsuit twice.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

90. 2026-08-24 · Landsec client / desktop 1440px (QA r367) · "open the
    tenancy schedule" · Typing/bookmarking /tenancy-schedule silently lands
    on the Properties list with no explanation (the redirect is intended —
    the schedule is per-property) — the user asked for a schedule and gets
    a different page with no hint they should pick a property. Suggest a
    one-line toast or banner after the redirect: "Pick a property to open
    its tenancy schedule."
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

89. 2026-08-24 · Landsec client / desktop 1440px (QA r366) · "see which of
    my brands are active right now" · On Brand Intelligence → Overview, the
    Who's Hot rows use "d" for two different things side by side: a filled
    badge "1d" means 1 DEAL while the timestamp directly under it reads
    "21d" meaning 21 DAYS ago — a client can easily read the deal badge as
    another age. Suggest distinct labels (e.g. "1 deal" / badge tooltip, or
    "21d ago" for the timestamp) so the two "d"s can't be confused.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

88. 2026-08-24 · BGP staff / desktop 1440px (QA r365) · "pull turnover
    entries in from CRM comps" · Clicking From CRM Comps when no comp tenant
    matches a brand name just toasts "Created 0 draft entries from CRM comps
    (0 skipped)" and the board doesn't change — the user gets no hint WHY
    nothing matched (matching is exact name-equality between crm_comps.tenant
    and the brand book) or what to do next. Suggest the 0-created toast
    explain the match rule and point at the gap, e.g. "No comp tenants
    matched a brand name — check tenant spellings on the Comps board", and
    ideally list the top unmatched tenant names so staff can fix or add the
    brands.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

87. 2026-08-24 · BGP staff / desktop 1440px (QA r364) · "log a turnover
    figure for a brand" · Add Turnover Entry works cleanly, but a row added
    for Amorino (a Restaurant brand) lands with Category "—" because the
    dialog's Category select starts empty and nothing pre-fills it from the
    selected brand's companyType — the same brand's AI-estimate rows show
    "Restaurant", so the board's category filter now misses the hand-added
    row. Suggest defaulting the dialog's Category from the selected
    company's type (still editable). (Also noted in passing: the Brand
    dropdown renders only the first 100 companies with no search — fine on
    the fixture's 17, but on prod's full brand book most brands would be
    unreachable except via the free-text name fallback, which skips the
    company link. A searchable combobox would fix both.)
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

86. 2026-08-24 · BGP staff / desktop 1440px (QA r364) · "see who's earning
    what on the WIP report" · The Agent Summary tab on a book where no deal
    has an agent/BGP-contact assigned shows an "Agent Fee Breakdown" panel
    that is simply blank (header + empty body) and a 0-row table whose
    footer reads "Total £0 · £0 · £0 · 100%" — 100% of nothing. No hint
    of WHY it's empty. Suggest an empty state ("No fees are attributed to
    agents yet — assign a BGP contact on a deal to see the split") and
    suppressing the 100% when the total is zero.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

85. 2026-08-24 · BGP staff / mobile 390px (QA r363) · "look up a brand's
    contact from my phone" · On the brand profile's Contacts pill, the Key
    Contacts panel opened with "No property-tier contacts. Click Show all
    below." + "1 in CRM · no new contacts found" — the one contact the user
    wanted is behind an extra "Show all 1 contacts" tap. When there are no
    property-tier contacts but only a handful of CRM contacts, suggest just
    listing them straight away (keep the Show all gate for long lists).
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

84. 2026-08-24 · BGP staff / mobile 390px (QA r363) · "open a deal from the
    Deals tab" · On the phone deal page the header back-arrow button wraps
    onto its own line below the deal title, landing next to the status chip
    (title takes the full 390px row, the ghost icon button drops under it) —
    it reads as a mystery "←" control mid-page rather than page chrome; the
    breadcrumb above already provides the way back. Suggest hiding the
    ghost back button below md (breadcrumb + bottom nav cover navigation)
    or pinning it into the top bar row.
   → DONE — already fixed by the 26 Aug deal-page redesign (back button hidden below md)

75. 2026-08-20 · Landsec client / mobile 390px (QA r345) · "look up Honi
    Poke on my phone before a meeting" · The brand profile's Chat card
    fills the entire first screen after the hero photo — Key Contacts,
    compliance and the actual brand facts all sit below the fold, so on a
    phone the profile reads as a chat app before it reads as a profile. ·
    Suggested: on mobile, render Chat collapsed (a "Chat" bar that expands
    on tap) or move it below Key Contacts, so facts come first.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

76. 2026-08-20 · Landsec client / mobile 390px (QA r345) · "check the old
    leasing strategy board" · The retired /leasing-schedule/:id board
    (banner says "This board is retired") still shows editing affordances
    to a client login — "Set band" / "Set positioning" buttons on every
    unit and an "Enable" button for Strategic Principles — BGP strategy
    controls that mean little to Mark and invite edits on a board nobody
    maintains. · Suggested: for client logins render the archived board
    read-only (keep the banner + reference data, drop the edit buttons).
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

74. 2026-08-20 · BGP staff / desktop 1440px (QA r344) · "carry on working
    with a pending invoice verdict" · The new red verdict banner (fixed,
    top-0) overlays the app header instead of pushing it down, so the
    global search box and header controls sit hidden behind it for as long
    as a verdict is pending — annoying is the brief, but hiding search
    costs real workflows. · Suggested: give the authenticated shell a
    top offset when the banner is mounted (like iOS in-call bars) so the
    header stays usable; keep the banner un-dismissable.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

70. 2026-08-19 · BGP staff / Letting Tracker mobile 390px (QA r339) ·
    "find unit L112 to log a viewing" · Every mobile unit card's headline
    is the PROPERTY name (`prop?.name || u.unitName`, available-units.tsx
    ~1687), so a Bluewater-filtered list shows 150 identical "Bluewater
    Shopping Centre" headlines with the actual unit ("L112 Bluewater")
    relegated to the small grey subtitle — scanning for a unit means
    reading subtitles. Same class as the r229 search-labelling fix. ·
    Suggested: lead with the unit name, property as the subtitle (or
    property once as a group header when filtered to one centre).
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

Confirmed by Woody 2026-09-04 ("everything but 150" — #150 explicitly NOT
confirmed, remains open above); built same day by the parent session
(deployed with the r482-r522 bug-fix merge follow-up). #144 and #149 are
one fix (bottom-anchored phone toasts); #135 supersedes #42's "—" rows on
the phone tracker cards. Not yet browser-verified — QA rounds to judge the
new behaviour as intended:
156. 2026-09-04 · BGP staff / mobile 390px (QA r522) · tried to look
    something up quickly and check notifications between viewings · the
    staff phone shell has NO global-search or notifications entry point —
    desktop's header has both (⌘K search box + bell with a badge showing
    10 unread), but on the phone Victoria can only search within
    individual pages (tracker, brands, contacts) and never sees her
    notifications at all. Suggestion: add a search icon and a bell (badge
    count) to the phone-shell header, opening the same ⌘K palette and
    notifications popover the desktop uses.

155. 2026-09-04 · Landsec client / mobile 390px (QA r520) · opened their own
    deal's detail page · the Overview "Parties" card shows empty Landlord/
    Tenant slots with staff-worded "+ Link landlord" / "+ Link tenant"
    affordances — to the landlord viewing their own deal the empty Landlord
    slot plus staff jargon reads like the deal is set up wrong (same
    complaint as #129 on the deals board's Client column). Suggestion:
    for client users default the Landlord party to their own company and
    show parties read-only-ish ("Not set yet — your BGP team will link
    parties") rather than staff link-pickers.

154. 2026-09-04 · Landsec client / mobile 390px (QA r520) · logged a viewing
    from the tracker's Viewings dialog · tapping "Save Viewing" with the
    form untouched (only the defaulted date) succeeds and creates a
    "No company — 2026-09-04" row in the shared viewing log; on a phone the
    button sits right under the keyboard so an accidental empty save is
    easy, and the row flows into FY counts and staff reports. Company-less
    viewings are intended (2026-08-09 #9), but a fully empty one carries no
    information. Suggestion: disable Save until at least one of company/
    contact/attendees/notes is set.

153. 2026-09-04 · Landsec client / desktop 1440px (QA r518) · scanned the
    Bluewater Tenancy Schedule KPI strip on the property page · the Service
    Charge tile wraps its £11,370,076 total mid-digit ("£11,370,07 / 6") in
    the embedded 7-column strip — the figure misreads at a glance (the Full
    Board page fits it on one line). break-words was chosen deliberately over
    clipping, so suggest compact formatting for 7-figure sums in the embedded
    strip (e.g. "£11.37m", full figure on hover/title), matching the
    dashboard's compact-KPI style.

152. 2026-09-03 · BGP staff / mobile 390px (QA r504) · reviewed a brand
    profile then moved on to the calendar · the profile's auto-fired store
    scan failed a few seconds later (keyless env) and its red "Store search
    failed / GOOGLE_API_KEY not configured" toast popped mid-screen over the
    calendar — a raw config error on a page that had nothing to do with it.
    Suggestion: don't toast failures of background auto-fired scans at all
    (log to the stores diagnostic strip instead); keep toasts for
    user-initiated scans. Related: #96 (friendly wording), 149 (mid-screen
    placement).

151. 2026-09-03 · Landsec client / mobile 390px (QA r502) · opened the Files
    dialog on a Letting Tracker unit · the generator row reads "Info sheet —
    branded PDF for agents/tenants", which is BGP-side language: to a
    landlord client "for agents/tenants" reads like it's not for them, and
    it's unclear what they'd get. Suggestion: client-facing copy for the
    same control, e.g. "Unit info sheet — branded PDF" (keep the current
    wording for staff).

149. 2026-09-03 · BGP staff / mobile 390px (QA r496) · logged a phone-call
    interest on U124 from the tracker's Interest dialog · the "Interest
    logged" toast pops mid-screen and sits exactly over the row that was
    just added, so for a few seconds you can't see the thing you just
    created (same for the viewing/offer dialogs' toasts at 390px).
    Suggestion: bottom-anchor toasts on the phone shell so the
    confirmation stays out of the content's way.

148. 2026-09-03 · Landsec client / mobile 390px (QA r494) · tapped the Tasks
    tab to check open tasks on the phone · the AI Daily Briefing card fills
    the entire first viewport (title, spinner/Generate button, skeleton
    lines) before the "Tasks" list — the thing the tab is named for starts
    a full screen below the fold, and the one open task needs a scroll to
    see. Suggestion: on the phone Tasks tab, start the briefing card
    collapsed to its header row (like the property page's "Cost plan &
    inputs" pattern, remembered per device) or move it below the task
    list — tasks first on a tab called Tasks.

147. 2026-09-03 · Landsec client / desktop 1440px (QA r492) · logging this
    morning's offer on L112 from a brand not yet in the CRM · typed the
    company name into the offer form's Company picker, got "No matches.",
    saved anyway — the offer persisted as "No company" with the typed name
    silently discarded (the field visibly resets to "Select company", but a
    user focused on rent/terms will miss it). The API and the email-sync
    path both accept free-text companyName, and the Investment Tracker's
    CrmPicker already has an inline green "Create company '<name>'" row —
    the Letting Tracker's CrmPicker (offers + viewings dialogs,
    available-units.tsx:148) is the only picker without it. Suggestion:
    port the investment-tracker onCreate affordance (or accept the typed
    text as free-text companyName) so an unmatched company isn't lost.
    Affects staff and clients alike; clients can POST companies
    (allowlisted), so parity holds.

146. 2026-09-03 · BGP staff / desktop 1440px (QA r490) · reviewing U124 on the
    Letting Tracker before a client call · searched "U124" (3 of 81 units),
    the header still read "Viewings 2 · Offers 1", but U124's own dialogs
    said "No viewings recorded yet" / "No offers recorded yet" — the FY
    header counts are tracker-wide and ignore the active search/filters, so
    it reads like the data failed to load · Suggest: scope the header KPI
    counts to the filtered rows (or label them "all units") when a search or
    filter is active.

145. 2026-09-03 · BGP staff / mobile 390px (QA r488) · glancing at the Today
    page's Recent Deals list between viewings · a deal with no status renders
    an empty grey stage chip (a blank pill next to the deal name) — it reads
    as a rendering glitch rather than "no stage yet" · Suggest: hide the
    stage chip when the deal has no status, or show a muted "No stage" label
    instead of an empty pill.

144. 2026-09-03 · Landsec client / mobile 390px (QA r486) · logging a viewing
    then an offer from the Letting Tracker unit card · after Save, the
    success toast ("Viewing added" / "Offer added") renders as a large card
    centred over the middle of the dialog, exactly covering the just-added
    row for ~4s — the user can't see the thing they just created until the
    toast fades, and it also sits mid-form when the offer form is open ·
    Suggest: anchor toasts to the bottom edge (above the bottom nav) on the
    phone shell so dialog content stays visible.

143. 2026-09-03 · Landsec client / desktop 1440px (QA r484) · skimming Brand
    News for signals across the tenant slice · every article card shows a
    summary line that is a verbatim copy of the headline (title and
    description are identical for all wire rows), so each card says the same
    thing twice and the list reads as noise · Suggest: hide the description
    line when it equals (or startsWith) the headline, so cards collapse to
    one line unless the summary genuinely adds information — pairs with the
    existing near-duplicate-collapse suggestion for the News tab.

142. 2026-09-03 · BGP staff / desktop 1440px (QA r482) · a non-admin staff
    member following a link to /expenses (e.g. from my-expenses' "ask Woody
    or Layla… on the Expenses admin page" hint) · since r482 the admin-only
    /expenses and /expenses/revolut pages bounce non-admins back to the
    Dashboard (previously they rendered the full admin chrome over silently
    403'd data — "No spend yet this month" with dead admin buttons); the
    bounce is the house AdminRoute pattern but happens with no explanation ·
    Suggest: a one-line toast on the AdminRoute bounce ("That page needs
    admin access") so the redirect doesn't read as a broken link.

141. 2026-09-03 · BGP staff / mobile 390px (QA r480) · skimming the WIP
    report on the phone before a team call · the "Net fees by team" chart
    shows £0 for both teams (National, National Leasing) while the header
    says £250,000 total — the £250K deal has no team attributed, and fees
    without a team simply vanish from the by-team split, so the chart
    contradicts the total with no explanation (the Agent Summary tab
    handles the same case with a clear "no fees attributed yet — assign a
    BGP contact" empty state) · Suggest: add an "Unassigned" bar to the
    by-team (and by-client/by-property, if applicable) breakdowns when
    attributed fees don't sum to the total, or reuse the Agent Summary
    empty-state hint.

140. 2026-09-03 · Landsec client / mobile 390px (QA r478) · checking which
    brands are trading on the phone · the Brand Intelligence hub on mobile
    shows only Brand Explorer — the Turnover Board tab the client uses on
    desktop is deliberately hidden (brands-hub.tsx: other boards "still
    being built" on mobile) with no hint it exists or that it's
    desktop-only, so a client looking for turnover data on the phone finds
    nothing · Suggest: when the mobile turnover board ships, expose the tab;
    until then a small "Turnover Board is available on desktop" line (or a
    read-only card-list variant) would stop the dead-end.

139. 2026-09-03 · Landsec client / desktop 1440px (QA r476) · scanning the
    Brand Explorer for hospitality brand intel · the "Brand News" panel under
    the client's brand grid is a generic fashion-wire feed (WWD: Nike, Tom
    Ford, PVH, Sydney Sweeney…) — the panel filters articles to the Retail
    + Hospitality categories (brands-hub.tsx), and "Retail" is mostly
    fashion wire copy, so nothing relates to the client's hospitality/
    leisure/fitness slice or the 9 brands shown above it · for client
    logins, narrow Brand News to the slice categories (or match article
    text against visible brand names), with a "no relevant stories" empty
    state.

138. 2026-09-03 · BGP staff / desktop 1440px (QA r474) · picking a hero image
    in Image Studio · the word "Uncategorised" means two different things on
    the same screen: the CATEGORIES sidebar counts images whose category is
    "Uncategorised" (1 here), while the albums grid's "Uncategorised" folder
    counts images with no ADDRESS (2 here) — the mismatched numbers next to
    the same label read like a bug · rename the album folder to something
    address-flavoured ("No property / address") or unify the two counts.

137. 2026-09-03 · BGP staff / desktop 1440px (QA r472) · outlining units on
    a new Evidence Plan · after double-clicking to close an outline, the
    unit reference is asked for via a raw browser prompt() window — the
    only browser-chrome prompt in the app, it can't be styled, shows no
    context, and a stray Esc silently throws the just-drawn outline away ·
    replace with the app's own small dialog (unit ref field + Save/Cancel),
    keeping the drawn polygon on Cancel so it can be re-named rather than
    redrawn.

136. 2026-09-02 · Landsec client / mobile 390px (QA r470) · reviewing
    Bluewater's Boards section on the phone · the empty Brochures panel
    reads "No brochures yet — drop a PDF here or use Add." — drag-and-drop
    doesn't exist on a touch phone, so half the instruction is impossible
    and reads desktop-first (same panel/copy also serves staff mobile) ·
    on touch/mobile render the empty state as "No brochures yet — use Add"
    (keep the drop-zone copy for pointer devices).

135. 2026-09-02 · BGP staff / mobile 390px (QA r464) · working the Bluewater
    letting tracker on the phone (75 units in Marketing) · every unit card
    unconditionally reserves two label rows for Area and Rent p.a., and on
    this fixture most render as "Area —" / "Rent p.a. —", so scanning the
    list is mostly em-dash rows between unit names (the Tenant row already
    hides itself when empty) · hide the Area/Rent rows on the phone card
    when there's no value, matching the Tenant row's behaviour, so each
    card shrinks to what's actually known and more units fit per screen.

134. 2026-09-02 · Landsec client / mobile 390px (QA r462) · opening Bluewater's
    property page to review the asset · the Overview tab's first card stacks
    Status / Asset Class / BGP Team / Website — all four rendered as "—" on
    the fixture — so the first phone viewport after the header is mostly
    em-dashes before any real content (ownership, tasks, boards) appears ·
    on the client's phone view, collapse fields with no value (or float the
    populated Ownership rows to the top of the card) so the first screen
    shows information, not placeholders.

133. 2026-09-02 · Landsec client / desktop 1440px (QA r460) · reading the
    full tenancy schedule board during a portfolio review · the KPI strip
    mixes empty-state treatments: PASSING RENT shows "—" when no rent data
    exists, but the tile next to it reads "AVG ERV £PSF 0" — a literal
    zero that reads as "the ERV is £0" rather than "no ERV data" · show
    "—" (like passing rent) when no units carry an ERV.

132. 2026-09-02 · BGP staff / desktop 1440px (QA r458) · Requirements page
    while prepping a pitch · the toolbar mixes everyday actions (search,
    Add requirement, New Brand) with five maintenance/debug controls
    ("Refresh PIPnet", "Wipe & resync", "Inspect PIPnet", "Inspect Detail",
    "Refresh TRL", "Wipe & resync TRL") at equal visual weight — two of
    them start with "Wipe", one click from the search box, and nothing
    signals they're admin plumbing · move the inspect/wipe/resync controls
    behind a single "Sync tools" dropdown (or admin-only visibility) so the
    everyday row is Add requirement + search + New Brand.

131. 2026-09-02 · BGP staff / mobile 390px (QA r456) · opening a brand
    profile to prep a pitch on the phone · the 260px hero pane sits as a
    bare grey block for the first several seconds while the flagship
    street-view image loads (no spinner, no skeleton — on first visit it
    reads as a broken/empty panel filling half the viewport; it only
    collapses if the fetch errors) · give the hero pane a loading shimmer
    or fade the image in, so slow mobile networks see "loading" rather
    than "blank".

130. 2026-09-02 · Landsec client / mobile 390px (QA r454) · scanning the
    Letting Tracker cards on the phone · card titles read "L112 Bluewater,
    Bluewater" / "U124/U125/U126, Bluewater, B…" with "Bluewater Shopping
    Centre" repeated again on the subtitle line — the property name appears
    up to three times per card because unit_name embeds it and the title
    truncates at 390px before the distinguishing part · when the unit name
    ends with (or contains) the property name the card title could strip
    that suffix and let the subtitle carry the property, so the ~28 visible
    title chars go to the unit reference the user is actually scanning for.

Confirmed by Woody 2026-08-22 ("83"); built + visually verified same day
by the parent session (390px iPhone UA):
83. Mobile PI map no longer runs under the bottom nav: the Property
   Intelligence page drops its min-h-screen below md (the mobile shell
   already sizes the page to the space above the fixed nav), so the map's
   zoom +/- controls sit fully above the Portfolio/…/News bar; the map
   search row also gets a wider right inset at 390px (w-[calc(100%-32px)])
   so the Resolve button clears the screen edge. (Logged by QA r361 on
   staging; entry recorded here on the working branch.)

Confirmed by Woody 2026-08-20 ("71 should be automated too fro diaries?
72 65 68 73 67 66 69"); built same day by the parent session. Not yet
browser-verified unless a round has since covered them:
71. Interest is now writable: POST /api/available-units/:id/interest + a
   "Log interest" form in the unit's Interest dialog (company picker,
   date, note — mirrors add-viewing), AND a diary leg (syncDiaryInterest
   in viewing-sync.ts): non-viewing calls/meetings that name a tracker
   unit and involve a known external contact land as interest rows
   (source 'diary', cal_<iCalUId> dedupe, 90-day already-engaged check).
72. Teams + Agents tracker filters are hidden for client logins.
65. Deal-header BGP contact is always contactable for clients: agents on
   the account-team board keep their mailto; when none resolve to an
   email the account lead is appended so there's never an inert name.
68. Tracker header recounts under active search/filters ("n of m units").
73. Property page card retitled "Tenancy Schedule" to match the pop-out
   and the client nav.
67. Viewing cards no longer repeat the attendees line when it already
   headlines the card.
66. 390px tenancy Full Board: sticky Unit column capped at 120px
   (truncated) and the sticky actions column un-pins below md, freeing
   most of the viewport for the scrolling sheet.
69. Client PI hub gets a "My properties" quick-pick bar (client-scoped
   /api/crm/properties): one tap resolves the property page-wide —
   seeds the Map and prefills Land Registry + Business Rates via
   PropertyContext.

Confirmed by Woody 2026-08-18 ("do 64 63 62 61 60 59 58 57 56 55 54 53 52 51
50 … ignore 46 and 32"); built same day. None browser-verified yet unless
noted:
64. WAULT excludes terms over 60 yrs (placeholder 2154 expiries); the KPI
   tile shows an amber "n excluded — placeholder expiry" sub-line.
63. Deals-board stage chips recount against the active search (mobile chips
   and desktop status cards both use the searched set).
62. Tenancy Full Board headers are tap-to-sort (asc → desc → off, ▲/▼
   indicator; date/number/text aware, empty values sink) — "soonest expiry"
   answerable on a phone.
61. Image Studio Library "All" grid excludes Brands images, so the grid
   matches the "Library (n)" tab and rail counts.
60. Already existed (built with #39 in batch B): PeopleHub header has an
   "Add contact" button reusing ContactFormDialog.
59. Client Portfolio home (mobile) gets a compact "Your BGP team" row —
   avatars/name/role from the client-teams board, tap to email.
58. Viewings dialog headline falls back companyName → contactName →
   attendees → "No company" (offers have no attendees field).
57. "Deal created" toast carries a "View deal →" action navigating to the
   new deal (create returns the id through the mutation).
56. Staff get the same lightweight Add-event dialog as clients (team_events
   row, separate from Outlook sync); server now stamps created_by for staff
   creates so authors can delete their own events.
55. Mobile property page drops the duplicate "← Properties /" back-link row
   (top bar + breadcrumb remain).
54. Mobile news feed: Latest/Saved chip tabs + bookmark toggle per card,
   reusing /api/news-feed/engage + /saved (desktop saves show on phone).
53. Quick Access self-heals: opening a dead company link drops it from the
   recents list, and the not-found card gives clients "Brand not in your
   list" copy with a Brand Directory pointer.
52. Hand-added leasing requirements default requirementDate to today
   server-side (imports keep their own dates) — Fresh badge + 90-day KPI
   work immediately.
51. Mobile deal cards show Target (month/year) and "n d in <status>"
   (time-in-status from the deal audit log, overlaid server-side as
   statusChangedAt; falls back to created_at). Card field cap raised 4→5.
50. "Off tenancy spine" chip hidden from client viewers, and a nightly
   04:00 sweep (relinkOffSpineDeals) auto-stamps tenancy_unit_id where the
   confident (property, unit name) match now succeeds; staff tooltip
   mentions the auto-link.

Confirmed by Woody 2026-08-15 ("45 48 49"); built same day (suggestions 45,
48, 49 were logged by QA rounds r292-r295 on the staging branch — recorded
here since JOGQK is the canonical copy):
45. Tenancy schedule search feedback: the header clear-badge now covers
   search + status filters ("N of M · clear", clears all three), and on
   phones a match count renders directly under the Search box so typing
   gives visible feedback without scrolling past the KPI tiles.
48. Deal Comments card is append-only: comments POST to
   /api/crm/deals/:id/comments, which stamps author + time into the
   existing comments blob ("[15 Aug 2026, 10:47 · Name]" blocks) — a later
   comment can never overwrite an earlier one; each append is also written
   to the deal audit log. The card renders entries as a list with
   author/date lines; pre-existing free text shows as "Earlier note".
   API-verified both directions; not yet browser-verified.
49. News tag chips show per-tag match counts from the loaded feed and grey
   out / disable zero-match tags ("No matching articles in this feed"
   tooltip) — a sparse feed slice reads as a data gap, not a broken filter.
   Not yet browser-verified.

Confirmed by Woody 2026-08-13 ("image studio for non admin just needs to be
the same as it is for admin. 44 yes go ahead"); built + browser-verified
same day:
43. Full /image-studio is open to ALL staff — StudioRoute no longer bounces
   non-admins to /m/images and the sidebar entry points straight at
   /image-studio. Destructive maintenance endpoints (bulk/permanent delete,
   dedupe, bulk AI-tag) stay admin-only server-side. Two-bot scenario
   staff-image-studio-redirect replaced by staff-image-studio-full-access.
44. Client deal detail header shows "BGP contact: {name}" (mailto link)
   next to the tenant slot — the deal's internalAgent names when set, else
   the account team's flagged lead, else the first account-team member.
   Tracker unit rows left as-is for now (suggestion's "consider" clause).

Confirmed by Woody 2026-08-12 ("do all apart from 32" — #32 explicitly NOT
confirmed, remains open above); built 2026-08-12:
14. /m/images: desktop-aware copy ("Use") + non-admin staff hint that the
   full Image Studio is admin-only.
15. Brand profile "Pitch property" carries the brand to /available
   (?pitchBrand= banner + one-tap "+ brand" target add on any unit);
   "Add to deal" pre-fills the deals search with the brand name.
16. Dashboard Expiring (6m) tile opens a popover listing the expiring
   leases (sorted by expiry), each row linking to the tenancy schedule.
17. Tenancy header: Import / Excel / Re-sync / Columns collapse behind a
   "⋯ More" menu below `sm:` so unit rows start on the first screen.
18. Calendar opens in Week view when today is a weekend (work-week grid
   otherwise unchanged).
19. Deal Parties slots follow deal type — Landlord + Tenant on leasing,
   Vendor + Purchaser on Sale/Purchase; linked slots always shown.
20. Map at 390px: search bar full-width, Download Plan / Map-Satellite
   pills stack below it instead of covering it.
21. New client-scoped /api/client/map/pins (own portfolio only) — client
   map now shows their estates as pins; staff /api/map/pins stays 403.
22. Add Offer date defaults to today (matches Add Viewing).
23. Property Pathway board has its own "Start investigation" form
   (address + postcode → same run ChatBGP would start).
24. Letting Tracker unit-name click now opens the unit's targeting brief;
   inline rename moved behind a hover pencil icon.
25. Deal detail shows a client-visible "Your BGP contact(s)" line from the
   deal's internal agent (no fees).
26. Comps "AI leads" stat: admins get a button to the Leads tab,
   non-admins a tooltip ("an admin reviews these").
27. Add-brand dialog rows link to the brand profile once the brand is in
   the client's CRM; the added toast hints tap-to-open.
28. Tenancy schedule key-columns preset (Unit / Status / Tenant / Quoting
   Rent / Expiry): first-visit default on phones + one-tap "Key columns"
   / "All columns" toggle in ⋯ More and the Columns popover.
29. Mobile requirement cards get a Match button opening the existing
   RequirementMatchesDialog.
30. Targeting Brief dialog always renders the Target operators section;
   the brief auto-creates on first save/target add (no invisible gate).
31. FY Viewings / Offers chips on the tracker are now toggle filters —
   click to show only units with viewings/offers, click again to clear.
33. Client view disables Edit on agent contacts with a "Managed by BGP"
   tooltip (write gate already 403'd; affordance now matches).
34. Contact page "Log activity" (call / meeting / note + date + summary)
   posting into the same activity feed as synced items.
35. Client News feed: /news for client viewers lists brand signals scoped
   to their slice via new /api/client/news-signals + a News nav entry.
36. Deal audit log resolves company/property UUIDs to names (raw id kept
   in the tooltip).
37. Mobile calendar gets an "Upcoming" agenda block (next 5 events) above
   the day grid; tapping an entry opens the event.
38. Requirements empty state is filter-aware; unfiltered client copy says
   BGP logs requirements on their behalf.
39. Staff "Add contact" entry points: brand/company profile contacts board
   + CRM hub header, reusing the existing ContactFormDialog.
40. Client-visible brand expansion commentary strips the internal
   "Recommendation" (pitch strategy) section.
41. Instagram card empty state uses client-safe copy ("Instagram feed
   unavailable for this brand.").
42. Mobile tracker cards keep Area / Rent rows with an explicit "—" when
   unset (Tenant row only when present).

Confirmed by Woody 2026-08-09 ("go ahead with them all"); built + visually
verified same day (commit dbade8e0):
6.+8. Mobile landing is now the Dashboard (staff) / Portfolio (client) at "/";
   the unified Messages list moved to /messages (supersedes the 2026-08-05
   Messages-home decision — landing on an empty chat list read as a blank app).
7. Client Deals board subtitle now notes "+N letting deals on the Letting
   Tracker" when tracker-linked deals are excluded from the CRM list.
9. Viewing/offer row edit/delete controls: aria-labels + titles, larger tap
   targets, and "No company" instead of "Unknown".
10. Comps stats strip counts only table-visible comps; the AI stat now reads
   "N AI leads awaiting review".
11. Suggested Pitches rows show the reason as a sub-line (hover title kept).
12. Brand Signals dedupe near-identical headlines (first/newest wins).
13. Contacts zero-hit searches that match a company name show "Looking for a
   brand? Search Brand Intelligence →".

Confirmed by Woody 2026-08-08 ("Do all 5"); built + visually verified same day:
1. 2026-08-08 · Letting Tracker viewing/offer rows now have an edit pencil —
   PATCH routes added for unit viewings + offers, form switches to edit mode.
2. 2026-08-08 · Add Viewing date defaults to today (still editable).
3. 2026-08-08 · Deals board: re-entering a gated stage (SOL/EXC/COM/INV) is
   allowed when it reverts the deal's most recent move (24h window) — the AML
   gate still blocks all other entries; reverts are audit-logged with
   revert: true in deal_events.
4. 2026-08-08 · Client dashboard passing-rent KPI shows "—" + "no passing
   rent recorded yet" instead of £0.0m when no rent data exists.
5. 2026-08-08 · Occupancy bases labelled: dashboard tiles say "full rent
   roll", leasing schedule says "Units on this board" / "board units only".

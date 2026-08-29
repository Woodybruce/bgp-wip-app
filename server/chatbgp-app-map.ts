// ─────────────────────────────────────────────────────────────────────────
// THE APP MAP — ChatBGP's knowledge of the dashboard itself.
//
// Woody, 2026-08-23: ChatBGP sent him to a Settings page the PHONE app has
// no route to ("update it so it completely understands the app in all
// areas"). This module is the fix: one maintained description of every
// screen and how to reach it on desktop vs the phone, appended to the
// system prompt in chatbgp.ts.
//
// ⚠️ KEEP THIS CURRENT: whenever a Claude Code session (terminal or web)
// changes navigation, adds/removes a page, or moves a control, update the
// relevant lines here in the same commit. Stale lines here become confident
// wrong answers in front of the team.
// ─────────────────────────────────────────────────────────────────────────

export const APP_MAP = `
## The App — full map (read before giving any in-app directions)

The dashboard runs in two shells and they are NOT the same:
- **Desktop web** (chatbgp.app in a browser): full sidebar navigation, every page below.
- **Phone app** (installed to the Home Screen): its own compact shell — 4 bottom tabs + a tile-based home. Many desktop pages are reachable on the phone by URL but have NO visible menu entry.

**RULE for directions**: always say WHERE the user should be ("on desktop…", "in the phone app…"). Only describe controls listed here. If you don't know the phone path for something, say it's a desktop feature rather than guessing. If the user says a control isn't where you said, believe them and log_app_feedback.

### Phone app (installed, staff)
Bottom tabs (exactly 4): **Dashboard** (home tiles), **Messages** (unified chat list), **Deals**, **News**. There is NO ChatBGP tab — ChatBGP is the pinned top row inside Messages, or the black "Ask ChatBGP…" button on the home screen.
Phone home screen, top to bottom:
- "Ask ChatBGP…" button (opens ChatBGP on the most recent conversation).
- Black finance tile with small **Personal | Company** pill tabs — Personal = the user's own billing/commission (from their fee allocations); Company = firm-wide income/net/debtors (incl. Sage legacy)/cash/projected FY net (equity directors only: Woody, Jack, Rupert, Charlotte; others never see the Company tab). Tapping opens Deals (Personal) or the Finance page (Company).
- Total billing tile (firm WIP roll-up → WIP report).
- "N expenses to approve" banner (approvers only) → approval queue.
- Quick links: Deals, Expenses, Images, CRM.
- Boards grid: Brand Intelligence, Comps, SharePoint, Property Intelligence.
- (My profile moved to the Messages header — see below.)
- AI Daily Briefing card, then My Tasks.
**My Profile on the phone**: tap YOUR OWN avatar in the top-right of the Messages header (chats list) — opens the WhatsApp-style profile screen at /m/profile: big photo with a camera badge (tap to change it — camera roll, JPG/PNG/WebP/HEIC max 5MB; propagates to chat messages and everywhere their name shows), phone/email/team rows, their CV from HR (about, summary, specialisms, notable clients, career history, education, LinkedIn), and a "Full HR profile" jump-off for edits/documents/holidays. THIS is where a phone user sets their profile photo.
Opening ChatBGP (home button or the pinned Messages row) lands on the user's MOST RECENT ChatBGP conversation; a fresh chat is the "+" button in the ChatBGP header.
Phone Messages/chat: WhatsApp-style in BGP colours — warm stone wallpaper, own messages in soft nectar bubbles with in-bubble time + read ticks (terracotta when everyone has seen the thread, grey otherwise), date chips, swipe a thread to archive, drafts auto-saved per thread. **Group chat icon**: open the group chat and tap the group's avatar circle in the header — opens the photo picker, sets the icon for everyone. 1-to-1 chats automatically show each person's profile photo.
Phone client logins (e.g. Landsec) get different tabs: Portfolio, Messages, Deals, Tasks, News.
There is NO Settings menu on the phone. Anything described as "in Settings" is desktop-only — except the profile photo, which on the phone is set from the My Profile screen (avatar in the Messages header, above).

### Desktop navigation (sidebar)
- Core: Dashboard (/), My Tasks, Deals (WIP source of truth), Requirements, Brand Intelligence (/brands), CRM (/contacts), People & HR, My Card (personal expenses), Comps, ChatBGP, Image Studio, Property Intelligence, Cann CAD (beta measuring), SharePoint, Calendar, Mail, Portfolios, AML Compliance (KYC Clouseau board).
- Specialist: Tenant Rep, Letting Hunter, Investment Hunter, Landlord Intelligence, Lease Advisory (/pla/matters), London Restaurants (BD), Model Studio, Document Studio, Document Briefs, Reporting, Board Report, Leads, Enrichment Hub.
- Admin section (admins only): Finance, Expenses (console), WhatsApp, News admin, Subscriptions & APIs, Office Add-ins, Settings (/settings — Organisation page: team structure + the "My profile" photo card).
- Equity directors who aren't admins also get a **Finance** link in their core nav.
- Finance also carries "Equity partners" — the four partners' remuneration by fiscal year (salary/bonus/dividends — "dividends" is the stored cash-advances field renamed, seeded FY24-25 + FY25-26, FY26-27 editable; phone shows one card per partner) with a live equal-split profit-share forecast per partner driven by the cashflow forecast (equity/admin only, like the whole Finance page). And "Historical billings" — the Sage-era invoiced-WIP history (FY2019-FY2026, May-April fiscal years, ex VAT) with Team / Client / Agent / Company lenses, a year picker, and vs-year-before deltas per row. Cashflow forecast lives ON the Finance page (no separate board, no password — /cashflow just redirects to /finance; equity/admin only). Cash in is app-driven: pipeline-weighted deal fees + Xero invoices due, plus one editable "Legacy receivables (pre-Xero)" line; cash out is Wendy's editable costs plan (Budget/Actual per month); the closing-balance chain anchors on Xero's live cash at bank. Click cost/legacy cells to edit; add cost lines with the button. On phones it shows one month at a time with prev/next arrows. The board's stats, chart and month summary always show; the typed budget/actual lines sit behind a "Cost plan & inputs" row that starts minimised — tap it to open and edit (remembered per device).
- Dashboard (/) is a customisable widget grid ("Customise" button): news, leads, KPI overview, calendar, letting tracker, deals board, inbox, WIP report, SharePoint, tasks & briefing, my portfolio, Landsec analytics — plus **Equity Finance** (equity directors only).

### Finance (desktop /finance — equity directors + admins ONLY: Woody, Jack, Rupert, Charlotte, plus admins like Wendy)
Live from Xero (15-min cache, Refresh button forces a pull). One place per fact (deduplicated 2026-08-28): headline stats you can TAP OPEN (2026-08-29): Income FYTD opens the paid-invoices-by-deal list, Net profit FYTD opens the full P&L lines, Cash at bank opens the per-account balances + net assets, Debtors outstanding opens the aged buckets + largest overdue + the Sage legacy note. Then the Company outlook (the ONE forecast — see below), the cashflow plan board, historical billings, equity partners, commission statements (one collapsed row per agent — tap a name to open their bar, band progress and per-deal statement with paid/awaiting flags), card spend, app running costs. The old standalone P&L / Cash position / Aged debtors / Paid-this-year cards are gone — that detail lives inside the headline dropdowns now. The old separate WIP-pipeline stat cards, projected-year bar, cost run-rate/projected-FY-net cards and bottom month-by-month chart are gone — the Company outlook carries all of that. Front and centre sits the **Company outlook** panel: three headline numbers (Money in / Money out / Profit for the projected year, with per-partner share on top of the £145k basic and the next-6-months figure), a deal-book strip using the same stages and weights as the WIP report (with an Open WIP report link), expandable cost dropdowns (Basic company costs / Salaries & payroll / Commissions — tap a row to see the plan lines or the per-agent commission table behind the number, including a warning for pipeline deals missing fee splits), and a month-by-month chart overlaying the last few years' Sage billings. Commissions are computed live from the deal boards' fee splits through the tier bands. Below it: the **Cashflow forecast** board (Wendy's editable cost plan + the typed Legacy Sage receivables line), **Historical billings** (FY2019–26 by team/agent/client/company) and the **Equity partners** remuneration board (salary/bonus/dividends per FY + the live profit-share forecast). Other staff asking for these numbers: politely say the company finance view is restricted to the equity group.

### Deal invoice-verdict alarm (live)
Deals whose target completion date has passed (within the last 6 months) and aren't invoiced demand a verdict from their agent: red banner in the app (full-screen block after 3+ days), "🚨 DEAL EMERGENCY" emails 6×/day per deal to the agent until answered (On track / Slipping with new date / Ready to invoice), 08:00 push, 09:00 daily summary to equity@. Verdicts reset monthly. If an agent complains about the red emails: answering the verdict in the app stops them immediately.

### Brand Intelligence (/brands and brand profile pages)
Tenant brands with news (Google News + RSS), an Instagram board (all posts with media), signals, requirements, comps, competitor section, Compliance & KYC panel, and a designed 2-page Brand Pack PDF download (Bordeaux palette). On the phone, /brands opens with a search box at the top that finds brands, contacts at those brands, and acting agents in one list (typing swaps the category tiles for grouped results; contacts get call/email buttons; clearing the box brings the category browser back). Every tenant brand gets the full treatment — there is no "tracked" subset and the UI no longer shows a tracked label or filter (Woody, 2026-08-24). The brand list was culled in Aug 2026 to substantive brands only.

### Detail pages on the PHONE (deal / property / brand / company)
On phones these record pages show a row of section pills under the page title and ONE section at a time (desktop shows everything in two columns). Deal page pills: Overview / Brand / KYC / Activity / Files. Property page pills: Overview / Boards / Deals & units / Files & contacts / KYC / Activity. Brand/company profile pills on the phone: Chat / Contacts / Intel / Stores / Social / Compliance. Chat opens with ONE combined card — the company description flowing into the "BGP take" read — then one-tap topic reads (Overview/Covenant/Signals/Contacts/Expansion/Financials/Pitch/Email) above the brand chat thread. Contacts has tappable call/email/LinkedIn buttons on every contact row plus the BGP engagement card (deals, touches, last touch, activity feed — email rows have an open-in-Outlook button). Intel runs Expansion (score, live requirements, Pipnet asks) → Key facts (backers, franchise, dept stores, stock) → Momentum (Apollo firmographics — fetches itself on first open, Refresh re-pulls) → portfolio activity → signals → best sellers → competition → News & media. Covenant + KYC checks also self-start: once the brand's UK trading entity is known, the Companies House number is auto-matched and the covenant grade, officers, accounts and AML screen fill in on their own — nobody needs to press anything. Stores holds the UK stores map WITH a store list underneath (Show all N; auto-researches itself on first open) and live tenancies; Social holds the Instagram board. (Desktop brand profile keeps its own Profile / Stores / Relationship / Intel / More sections.) If a phone user says they "can't find" the KYC panel, files, competitor set or key contacts on a record: tell them to tap the matching pill under the title.

### Client portal (Landsec etc.)
Client logins see a scoped version: Portfolio home, letting tracker, their deals/tasks/news, brand slice = hospitality/leisure/fitness categories + brands they self-add, activity analyses scoped to their account. Compliance & KYC stays visible; staff-only action buttons are hidden. Clients can never be added to chat threads.

### WhatsApp (the BGP business number)
Staff can text the BGP WhatsApp number directly — it's ChatBGP on WhatsApp. A contact/brand lookup text ("does anyone have Roland from WatchHouse direct?", "who reps Wingstop?") gets an instant contact card back — name, role, mobile, email, plus acting agents — pulled live from the CRM. Anything else (questions, files, brochures, receipts) goes to the full ChatBGP. Works only from phone numbers registered on a staff profile. If someone asks "how do I get a contact quickly on my phone": app → Brands → search box, or text the BGP WhatsApp number.

### Weekly BGP Insights
Automated Friday-afternoon job: ChatBGP compiles "BGP Insights — Leasing Week in Review" as a designed PDF (Bordeaux house style, scope 'bgp_insights' in document_design_preferences) and emails it to Woody to forward.

### Expenses flow
Card spend (Revolut/Stripe) → receipt capture (photo/email) → stage 1 info check (Wendy, or Layla on cover) → stage 2 director sign-off (Woody/Charlotte/Jack/Rupert, random, never own spend) → posted to Xero as Spend Money on account 1230. Phone: My Card = own expenses; approvers get the home-screen banner.

### WIP report (/wip-report)
The firm's money list, live from crm_deals. Tabs: **WIP Report** (filterable deal detail — on phones it renders as tappable cards instead of the wide table), **Agent Summary** (per-agent WIP/invoiced with drill-down), **Fee Check** (deal fee vs Xero invoice mismatches, seniors only), **Needs Attention** (seniors only — deals with broken links: no client, no agent, no date, invoiced without a Xero invoice, live deals with no fee; each row opens the deal to fix). Broken links also surface as an amber card on the Finance page. If someone asks why a deal shows "Unknown" client or is missing from a month: it's almost certainly in Needs Attention.

### Other key pages (desktop paths)
/wip-report (team WIP — quick search box above the filters finds a deal/client/property by name; Client, Tenant and Property cells click through to their pages; on the phone the table becomes a card list, one card per deal), /investment-tracker, /leasing-schedule, /available (letting tracker), /portfolios, /pathway-review + /pathway-portfolio (property pathway runs, Why Buy decks), /kyc-clouseau (AML board), /covenant-watch, /land-registry (title searches + two ways to buy title docs: "Order Title" via PropertyData, and "Official Copy (HMLR)" buttons — on title rows, next to the manual title-number box, and on Pathway title rows — ordering the statutory OC1 register direct from HM Land Registry's Business Gateway; the PDF saves to file storage and the title gets badged as owned), /image-studio (phone: /m/images — capture + AI-edit tool showing your recent phone photos plus hand-made folders, Properties and Pathway-run photo folders; the full brand library stays desktop), /map & /map-bgp, /board-report, /decks, /today (day view), /diary, /calendar, /mail, /whatsapp (admin), /business-rates, /lease-events, /marketing-files, /edozo.

### ChatBGP over WhatsApp (the BGP business number)
Messaging the BGP WhatsApp number reaches the same ChatBGP as the dashboard — same AI model, full toolset (CRM, deals, email, calendar, SharePoint, document generation, web search). It understands: typed messages, voice notes (transcribed automatically — just talk), photos (it can see them), and documents/brochures (PDFs are read and can be filed into the CRM; captions like "import this brochure" trigger the import pipeline). Receipts photographed by a cardholder are matched to their pending expenses automatically.
`;

// The AML dashboard (Woody, 18 November 2026: step 6 of
// docs/deal-page-review-2026-11-18.md, a pill on Deals). Source guards: BGP
// staff only, never under the retired AML switch, the party read the deal
// card's way, and the pill never mounted for a client login.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const feed = read('server/aml-dashboard.ts');
const index = read('server/index.ts');
const hub = read('client/src/pages/deals-hub.tsx');

test('the feed is BGP staff only and mounted', () => {
  assert.match(feed, /async function staffMe\(req: Request\)[\s\S]*contactViewer\(req\)\)\.staff/);
  for (const route of ['router.get("/api/aml-dashboard"', 'router.get("/api/aml-dashboard/party"']) {
    const body = feed.slice(feed.indexOf(route), feed.indexOf('});', feed.indexOf(route)));
    assert.ok(feed.includes(route), route);
    assert.match(body, /const me = await staffMe\(req\);\s*if \(!me\) return res\.status\(403\)/, `${route} checks for staff first`);
  }
  assert.match(index, /import amlDashboardRouter from "\.\/aml-dashboard";/);
  assert.match(index, /app\.use\(amlDashboardRouter\);/);
  const allowed = index.slice(index.indexOf('const CLIENT_ALLOWED_API = ['), index.indexOf('const CLIENT_ALLOWED_WRITES = ['));
  assert.doesNotMatch(allowed, /aml-dashboard/);
});

test('the retired AML switch does not catch it', () => {
  const block = index.slice(index.indexOf('const RETIRED_AML = ['), index.indexOf('];', index.indexOf('const RETIRED_AML = [')));
  const first = block.split('\n').find(l => l.includes('(aml|kyc-clouseau'));
  assert.ok(first, 'the switch still names /api/aml');
  const literal = first.trim().replace(/,$/, '');
  const retired = new RegExp(literal.slice(1, literal.lastIndexOf('/')));
  assert.equal(retired.test('/api/aml-dashboard'), false);
  assert.equal(retired.test('/api/aml-dashboard/party'), false);
  assert.equal(retired.test('/api/aml/deal/d1/sof'), true, 'the rest of /api/aml/ stays retired');
});

test('each party is read the deal card\'s way', () => {
  assert.match(feed, /loadPartyKyc\(pool, parties\.map/);
  assert.match(feed, /partyRedFlags\(\{/);
  assert.match(feed, /dealRedFlags\(deal\)/);
  assert.match(feed, /SCREENED_INVESTIGATION_SQL/);
  // With KYC4U only on KYC4U's own word: a request raised on the deal, or
  // KYC4U's latest status for the party (never a bare in_review).
  assert.match(feed, /FROM kyc4u_requests\s+WHERE company_id = ANY/);
  assert.match(feed, /kyc4uInReview = !!kyc4uLast && kyc4uVerdict\(kyc4uLast\.status\) === "in_review"/);
  assert.match(read('shared/aml-dashboard.ts'), /f\.kyc\.status === "in_review" && f\.kyc4uInReview/);
  // A closed deal's undecided parties are their own pill, never To do.
  assert.match(feed, /bucket: amlBucket\(stage, due, amlDealClosed\(p\.deal\.status\)\)/);
  // Off the Investment Tracker as everywhere (from Solicitors), and earlier where Issue 4 needs checks:
  // an investment sale from Live or Available, any investment deal from heads of terms.
  // One building's rows for its Ownership & KYC tab (23 November 2026).
  // The Companies view reads the same set through amlBoardScopeSql (24 November 2026).
  assert.match(feed, /: `\$\{amlBoardScopeSql\("d"\)\}\$\{opts\.propertyId \? ` AND d\.property_id = \$1` : ""\}`;/);
  assert.match(feed, /AND \$\{amlBoardDealSql\(alias\)\}`;\n\}/);
  assert.match(feed, /\$\{dealLeftTrackerSql\(alias\)\} OR \(\$\{investmentDealSql\(alias\)\}/);
  // Who BGP acts for decides when each party is due and its deadline.
  assert.match(feed, /const due = amlDue\(p\.role, p\.deal\.status, clientRole\);/);
  assert.match(feed, /late: amlLate\(stage, deadline\),/);
  // It reads; it never writes.
  assert.doesNotMatch(feed, /\b(INSERT INTO|UPDATE|DELETE FROM)\b/);
});

test('the pill is BGP staff only on Deals', () => {
  assert.match(hub, /\{ key: "aml" as const, label: "AML", icon: ShieldCheck \}/);
  assert.match(hub, /\{tab === "aml" && !dhUserLoading && !isClient && <AmlDashboard \/>\}/);
  assert.match(hub, /if \(isClient\) return allTabs\.filter\(t => t\.key === "deals" \|\| t\.key === "letting" \|\| t\.key === "properties"\);/);
  assert.match(hub, /t === "investment" \|\| t === "wip-report" \|\| t === "aml"\) setLocation\("\/deals\/list"/);
  assert.match(hub, /aml: "\/deals\/aml"/);
});

test('the checks table has a scroll bar above it and a heading that stays in view (Woody, 2026-11-20)', () => {
  const page = read('client/src/pages/aml-dashboard.tsx');
  // The rows scroll inside ScrollableTable's box, which the app's sticky table heading needs; a page-height wrapper never scrolls.
  assert.match(page, /<ScrollableTable minWidth=\{\d+\} topScrollbar>\s*<table className="w-full text-sm" data-testid="aml-table">/);
  assert.doesNotMatch(page, /<div className="rounded-lg border overflow-x-auto">\s*<table className="w-full text-sm" data-testid="aml-table">/);
  const box = read('client/src/components/scrollable-table.tsx');
  assert.match(box, /\{topScrollbar && \(\s*<div ref=\{topScrollRef\} className="sync-scroll-top"/);
  assert.match(box, /const els = \[tableScrollRef\.current, bottomScrollRef\.current, topScrollRef\.current\]/, 'the bars and the table scroll sideways together');
  assert.match(read('client/src/index.css'), /\.sync-scroll-top \{/);
});

test('the table shows the transaction status, the red flags under due diligence and every agent (Woody, 23 November 2026)', () => {
  const page = read('client/src/pages/aml-dashboard.tsx');
  assert.match(page, /<th className="text-left font-medium px-3 py-2">Transaction status<\/th>/);
  assert.match(page, /<th className="text-left font-medium px-3 py-2">AML stage<\/th>/);
  assert.match(page, /<th className="text-left font-medium px-3 py-2">Due diligence and red flags<\/th>/);
  assert.doesNotMatch(page, />Red flags<\/th>/, 'the red flags sit under due diligence, not in a column of their own');
  assert.match(page, /<td rowSpan=\{n\} onClick=\{openLead\} className=\{block\}><DealStatusChip row=\{first\} \/><\/td>/);
  assert.match(page, /<td className=\{`\$\{cell\(i\)\} max-w-\[240px\]`\}><DiligenceCell row=\{r\} onOpen=\{onOpen\} \/><\/td>/);
  // Every agent on a line of their own, never cut off.
  assert.match(page, /\{agents\.map\(a => <li key=\{a\} className="whitespace-nowrap">\{a\}<\/li>\)\}/);
  // The party, transaction and waiting-on columns give way below 1536px so the agents fit a laptop screen.
  assert.match(page, /<td className=\{`\$\{cell\(i\)\} max-w-\[170px\] 2xl:max-w-\[230px\]`\}><PartyCell row=\{r\} \/><\/td>/);
  assert.match(page, /<td rowSpan=\{n\} onClick=\{openLead\} className=\{`\$\{block\} max-w-\[190px\] 2xl:max-w-\[260px\]`\}><DealCell row=\{first\} \/><\/td>/);
  assert.match(page, /<td className=\{`\$\{cell\(i\)\} min-w-\[120px\] max-w-\[200px\]`\}>\{r\.waitingOn\}<\/td>/);
  assert.doesNotMatch(page, /r\.agents\.join\(", "\)/);
  // The status in the Transactions board's words, a letting's AVA as Marketing.
  assert.match(read('shared/aml-dashboard.ts'), /words: dealStatusLabel\(row\.dealStatus, row\.dealType\)/);
});

test('the top folds once the table scrolls, keeping the title and pills (Woody, 22 November 2026)', () => {
  const page = read('client/src/pages/aml-dashboard.tsx');
  // Transactions and Companies fold alike since 24 November 2026 (startsHere).
  assert.match(page, /const foldedTop = folded && !isMobile && startsHere;/);
  assert.match(page, /if \(table\.scrollTop > 48\) setFolded\(/);
  // The policy line has its own pill, so the table starts at the top (22 November 2026).
  assert.match(page, /\{ key: "policy", label: "Policy" \},/);
  assert.match(page, /\{shownSection === "policy" && <AmlPolicyPanel \/>\}/);
  // The title sits beside the section pills, folded or not.
  assert.match(page, /<h1 className=\{`\$\{foldedTop \? "text-lg" : "text-xl"\} font-semibold whitespace-nowrap`\}>AML checks<\/h1>/);
  // The table measures the room below it again once the fold has drawn.
  assert.match(page, /window\.dispatchEvent\(new Event\("resize"\)\)/);
  // The Policy pill shows the officers, the documents and the settings on the page, not in a pop-up.
  const panel = read('client/src/components/aml-policy-panel.tsx');
  assert.match(panel, /<div className="max-w-3xl space-y-4 text-sm" data-testid="aml-policy-panel">/);
  assert.doesNotMatch(panel, /data-testid="aml-policy-open"/);
});

// One line per transaction with its parties inside it (Woody, 24 November 2026:
// "combine the 2 (normally) AML checks into just one transaction board or line").
test('the board is one line per transaction, each party on a line of its own inside it', () => {
  const page = read('client/src/pages/aml-dashboard.tsx');
  assert.match(page, /const transactions = useMemo\(\(\) => groupAmlByTransaction\(data\?\.rows \|\| \[\]\), \[data\]\);/);
  assert.match(page, /scoped\.filter\(t => t\.buckets\.includes\(bucket\)\)/);
  assert.match(page, /const counts = useMemo\(\(\) => transactionBucketCounts\(scoped\), \[scoped\]\);/);
  // The table: a group per transaction; its own cells once (rowSpan), a line per party.
  assert.match(page, /\{shown\.map\(t => <TransactionRows key=\{t\.key\} t=\{t\} bucket=\{bucket\} onOpen=\{setOpen\} \/>\)\}/);
  assert.match(page, /<tbody className="group\/txn border-t border-border" data-testid=\{`aml-transaction-\$\{t\.dealId\}`\}>/);
  assert.match(page, /<tr key=\{r\.key\} onClick=\{\(\) => onOpen\(r\)\} className="cursor-pointer" data-testid=\{`aml-row-\$\{r\.key\}`\}>/);
  // Cards and the phone: one card per transaction, a line per party.
  assert.match(page, /render=\{t => <AmlTransactionCard key=\{t\.key\} t=\{t\} bucket=\{bucket\} onOpen=\{setOpen\} \/>\}/);
  assert.doesNotMatch(page, /function AmlPartyCard\(/);
  // The property page's AML on transactions here groups the same way.
  assert.match(read('client/src/components/property-page/ownership-card.tsx'), /const transactions = groupAmlByTransaction\(data\?\.rows \|\| \[\]\);/);
});

// Start from the AML page (Woody, 24 November 2026: "what about my add new
// transaction text box and upload files box etc here?", "and add new company AML etc").
test('the AML page starts a new transaction from words or heads of terms, and adds a company', () => {
  const page = read('client/src/pages/aml-dashboard.tsx');
  // One top for Transactions and Companies (Woody, 24 November 2026: "make the company
  // page the same format as the transactions page on the top ... and obviously have the
  // new box"): the bar above both views, and both fold on scroll.
  assert.match(page, /const startsHere = shownSection === "checks" \|\| shownSection === "companies";/);
  assert.match(page, /\{startsHere && !foldedTop && <AmlStartBar onTransaction=\{setStartTx\} onCompany=\{\(\) => \{ setAddCompany\(true\); setSection\("companies"\); \}\} \/>\}/);
  assert.equal([...page.matchAll(/<AmlStartBar /g)].length, 1, 'one bar, not one per view');
  assert.match(page, /const foldedTop = folded && !isMobile && startsHere;/);
  assert.match(page, /useEffect\(\(\) => \{ setFolded\(false\); lastTopRef\.current = 0; \}, \[shownSection\]\);/);
  assert.match(page, /const NewTransactionDialog = lazy\(\(\) => import\("@\/pages\/deals"\)\.then\(m => \(\{ default: m\.NewTransactionDialog \}\)\)\);/);
  assert.match(page, /initialNote=\{startTx\.note \|\| null\}/);
  assert.match(page, /initialHotsFile=\{startTx\.file \|\| null\}/);
  assert.match(page, /<KycCompaniesView isAdmin=\{!!me\?\.isAdmin\} startAdding=\{addCompany\} \/>/);
  const bar = read('client/src/components/aml-start.tsx');
  // The box keeps its own drops, and saves nothing itself.
  assert.match(bar, /onDrop=\{e => \{ if \(!hasFiles\(e\)\) return; e\.preventDefault\(\); e\.stopPropagation\(\);/);
  assert.doesNotMatch(bar, /apiRequest|fetch\(/);
  const deals = read('client/src/pages/deals.tsx');
  assert.match(deals, /export function NewTransactionDialog\(/);
  assert.match(deals, /initialText=\{!handover && initialNote \? initialNote : undefined\}/);
  assert.match(deals, /autoRead=\{!handover && !!initialNote\}/);
  assert.match(deals, /autoHotsFile=\{!handover && !isClientCreate \? initialHotsFile : null\}/);
  assert.match(deals, /if \(!autoHotsFile \|\| autoHotsRead\.current\) return;/);
  const companies = read('client/src/components/kyc-companies/companies-view.tsx');
  assert.match(companies, /const \[adding, setAdding\] = useState\(startAdding\);\n\s+useEffect\(\(\) => \{ if \(startAdding\) setAdding\(true\); \}, \[startAdding\]\);/);
  // Its controls are laid out as Transactions' (Select, Table or Cards, then the search), and
  // Add a company is the bar's, not a second button.
  assert.doesNotMatch(companies, /data-testid="kyc-companies-add"/);
  const controls = companies.indexOf('data-testid="kyc-companies-select"');
  assert.ok(controls > 0 && controls < companies.indexOf('data-testid="kyc-companies-view-toggle"') && companies.indexOf('data-testid="kyc-companies-view-toggle"') < companies.indexOf('data-testid="kyc-companies-search"'));
});

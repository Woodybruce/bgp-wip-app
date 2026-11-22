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
  // An investment deal only from Solicitors, as everywhere off the Investment Tracker.
  assert.match(feed, /dealLeftTrackerSql\("d"\)/);
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
  assert.match(page, /<ScrollableTable minWidth=\{1000\} topScrollbar>\s*<table className="w-full text-sm" data-testid="aml-table">/);
  assert.doesNotMatch(page, /<div className="rounded-lg border overflow-x-auto">\s*<table className="w-full text-sm" data-testid="aml-table">/);
  const box = read('client/src/components/scrollable-table.tsx');
  assert.match(box, /\{topScrollbar && \(\s*<div ref=\{topScrollRef\} className="sync-scroll-top"/);
  assert.match(box, /const els = \[tableScrollRef\.current, bottomScrollRef\.current, topScrollRef\.current\]/, 'the bars and the table scroll sideways together');
  assert.match(read('client/src/index.css'), /\.sync-scroll-top \{/);
});

test('the top folds once the table scrolls, keeping the title and pills (Woody, 22 November 2026)', () => {
  const page = read('client/src/pages/aml-dashboard.tsx');
  assert.match(page, /const foldedTop = folded && !isMobile && shownSection === "checks";/);
  assert.match(page, /if \(table\.scrollTop > 48\) setFolded\(/);
  assert.match(page, /\{!foldedTop && <AmlPolicyPanel \/>\}/);
  // The title sits beside the section pills, folded or not.
  assert.match(page, /<h1 className=\{`\$\{foldedTop \? "text-lg" : "text-xl"\} font-semibold whitespace-nowrap`\}>AML checks<\/h1>/);
  // The table measures the room below it again once the fold has drawn.
  assert.match(page, /window\.dispatchEvent\(new Event\("resize"\)\)/);
  // The policy is one line; its documents, officers and settings open in a dialog.
  const panel = read('client/src/components/aml-policy-panel.tsx');
  assert.match(panel, /data-testid="aml-policy-open">Policy and settings<\/button>/);
  assert.match(panel, /<DialogContent className="max-w-2xl max-h-\[85vh\] overflow-y-auto" data-testid="aml-policy-dialog">/);
});

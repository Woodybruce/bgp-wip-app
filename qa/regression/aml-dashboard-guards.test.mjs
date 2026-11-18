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

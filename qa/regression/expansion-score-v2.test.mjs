import test from 'node:test';
import assert from 'node:assert/strict';
import { computeExpansionScoreV2, dedupeFacts, splitSubScores, clientScoreView, siteSale } from '../../server/hunter-score.ts';
import { rolloutBadge } from '../../shared/rollout-badge.ts';
import { plansFromAnswer, plansWeight } from '../../shared/accounts-plans.ts';

const now = new Date().toISOString();
const brand = { name: 'Bunsik' };

test('HoTs deals, PIPnet requirements, coming-soon sites and interest all score, each under its own label', () => {
  const out = computeExpansionScoreV2({ brand, facts: [], bgp: { committedDeals: 1, liveDeals: 1, completedDeals24m: 1, pipnetRequirements: 2, activeRequirements: 0, comingSoonUk: 2, interest90d: 1, offers90d: 0, viewings90d: 0, interactions90d: 6, representedBy: 1 } });
  const labels = out.lines.map(l => l.label);
  assert.ok(labels.includes('1 deal at HoTs or beyond with BGP'));
  assert.ok(labels.includes('2 market listings (PIPnet / The Requirement List), not confirmed by BGP'));
  assert.ok(!labels.some(l => /\blive\b/i.test(l) && /requirement|listing/i.test(l)), 'an unconfirmed listing is never called live');
  assert.ok(labels.includes('2 UK sites "coming soon" on its own website'));
  assert.ok(labels.includes('Interest in 1 BGP unit in 90 days'));
  assert.ok(!labels.some(l => /on BGP's books/.test(l)), 'PIPnet is not counted as a BGP requirement');
  assert.equal(out.subScores.pipeline, 12, 'coming-soon sites are pipeline, not momentum');
  assert.equal(out.subScores.ukMomentum, 0);
});

test('two figures: Expansion is market evidence only, Relationship is BGP\'s own work and is never added in', () => {
  const market = { facts: [{ signal_type: 'opening', headline: 'Bunsik opens in Leeds', geography: 'uk', confidence: 'high', signal_date: now }] };
  const cold = computeExpansionScoreV2({ brand, ...market });
  const close = computeExpansionScoreV2({ brand, ...market, bgp: { committedDeals: 2, liveDeals: 1, offers90d: 2, viewings90d: 2, interactions90d: 9 } });
  assert.equal(close.score, cold.score, 'BGP deals do not move the Expansion figure');
  assert.equal(cold.relationship, 0);
  assert.equal(close.relationship, 25);
  assert.equal(close.subScores.engagement, 25);
  assert.equal(close.score, close.subScores.ukMomentum + close.subScores.pipeline + close.subScores.capacity + close.subScores.intent);
  assert.equal(close.expansionScore, close.score);
  assert.ok(!close.expansionFlags.some(f => /deal|offer|viewing|touchpoint/i.test(f)), 'chips are market lines only');
  assert.deepEqual(splitSubScores({ ukMomentum: 20, capacity: 10, intent: 11, engagement: 20 }), { expansion: 41, relationship: 20 }, 'a row saved before the split');
  assert.deepEqual(splitSubScores(close.subScores), { expansion: close.score, relationship: 25 });
  assert.equal(splitSubScores(null), null);
});

test('a client login is sent the Expansion figure only', () => {
  const out = clientScoreView(computeExpansionScoreV2({ brand, facts: [], bgp: { committedDeals: 1, interactions90d: 6, pipnetRequirements: 1 } }));
  assert.equal(out.relationship, undefined);
  assert.equal(out.subScores.engagement, undefined);
  assert.ok(!out.lines.some(l => l.bucket === 'engagement'));
  assert.ok(out.lines.some(l => l.label === '1 market listing'));
});

test('the rollout badge counts for six months from the day it was set, then lapses', () => {
  const at = (rollout_status_at, today) => computeExpansionScoreV2({ brand: { ...brand, rollout_status: 'scaling', rollout_status_at }, facts: [], now: new Date(today) });
  const fresh = at('2026-11-01', '2026-12-01');
  assert.equal(fresh.subScores.ukMomentum, 5);
  assert.equal(fresh.badge.live, true);
  const lapsed = at('2026-03-01', '2026-11-15');
  assert.equal(lapsed.subScores.ukMomentum, 0, 'Greene King: Scaling set in March scores nothing in November');
  assert.deepEqual(lapsed.badge, { status: 'scaling', live: false, setAt: '2026-03-01', lapsesOn: '2026-08-31' });
  assert.equal(at(null, '2027-05-01').badge.live, true, 'a badge with no date counts from 15 November 2026');
  assert.equal(at(null, '2027-05-20').badge.live, false);
  assert.equal(rolloutBadge('', null).status, null);
});

test('a sale of sites is a contraction; a purchase, or sales of something else, is not', () => {
  assert.deepEqual(siteSale('Greene King has agreed to sell a 24-pub package to Punch', 'Greene King'), { sites: 24 });
  assert.deepEqual(siteSale('Stonegate to offload its portfolio of 40 pubs', 'Stonegate'), { sites: 40 });
  assert.deepEqual(siteSale('Mitchells & Butlers puts 15 pubs up for sale', 'Mitchells & Butlers'), { sites: 15 });
  assert.deepEqual(siteSale('Greene King sells 24 pubs to Admiral, which acquires them for £30m', 'Greene King'), { sites: 24 });
  assert.equal(siteSale('Loungers snaps up 5 sites sold by Brewhouse', 'Loungers'), null, 'the brand is the buyer');
  assert.equal(siteSale('Greggs sold 2 million sausage rolls in 300 shops', 'Greggs'), null);
  assert.equal(siteSale('Wingstop opens new restaurant in Reading', 'Wingstop'), null);
  const out = computeExpansionScoreV2({ brand: { name: 'Greene King' }, facts: [{ signal_type: 'sector_move', headline: 'Greene King has agreed to sell a 24-pub package to Punch', geography: 'uk', confidence: 'high', signal_date: now }] });
  assert.deepEqual(out.lines.map(l => [l.bucket, l.points]), [['ukMomentum', -8]]);
  assert.match(out.lines[0].label, /^Sale of sites: /);
});

test('the store count leads momentum; planning, job adverts and stated plans fill the pipeline', () => {
  const news = [1, 2, 3, 4].map(i => ({ signal_type: 'opening', headline: `Bunsik opens site ${i} in Leeds`, geography: 'uk', confidence: 'high', signal_date: now }));
  assert.equal(computeExpansionScoreV2({ brand, facts: news }).subScores.ukMomentum, 22, 'headlines alone are capped at 22');
  const counted = computeExpansionScoreV2({ brand, facts: news, estate: { count: 40, opened: 5, closed: 2, net: 3, months: 6, comingSoon: 0, uk: true } });
  assert.deepEqual(counted.lines.filter(l => l.bucket === 'ukMomentum').map(l => [l.points, l.label]), [
    [12, 'Net +3 sites in 6 months, counted on its own website (5 opened, 2 closed)'],
    [10, 'UK openings & hiring in the news, time-decayed'],
  ]);
  const churn = computeExpansionScoreV2({ brand, facts: [], estate: { count: 2400, opened: 2, closed: 8, net: -6, months: 5, comingSoon: 0, uk: true } });
  assert.equal(churn.lines[0].points, -4, '6 pubs of 2,400 is churn');
  const small = computeExpansionScoreV2({ brand, facts: [], estate: { count: 30, opened: 0, closed: 6, net: -6, months: 5, comingSoon: 0, uk: true } });
  assert.equal(small.lines[0].points, -18, '6 sites of 30 is not');
  const pipe = computeExpansionScoreV2({ brand, facts: [], now: new Date('2026-11-15'),
    pipeline: { planning12m: 2, planning90d: 1, planningTowns: ['Reading', 'Leeds'], newOpeningJobs: 1, propertyRoles: 1, jobTowns: ['York'] },
    plans: { period: '2025-12-28', openings: { summary: '15 new restaurants in 2026', count: 15 }, closures: null, capex: { summary: '£20m' } } });
  assert.deepEqual(pipe.lines.map(l => [l.bucket, l.points, l.label]), [
    ['pipeline', 8, '2 planning applications naming it in 12 months (Reading, Leeds)'],
    ['pipeline', 3, '1 job advert for a new opening (York)'],
    ['pipeline', 4, 'Hiring for property: 1 advert'],
    ['pipeline', 9, 'Accounts to Dec 2025 state: 15 new restaurants in 2026'],
    ['capacity', 3, 'Accounts state capital spend: £20m'],
  ]);
  assert.equal(pipe.subScores.pipeline, 24);
  const old = computeExpansionScoreV2({ brand, facts: [], now: new Date('2026-11-15'), plans: { period: '2023-12-31', openings: { summary: '15 new restaurants', count: 15 }, closures: null, capex: null } });
  assert.equal(old.lines.length, 0, 'a plan in accounts nearly three years old no longer counts');
});

test('a plan read from the accounts is kept only with a sentence that is in them', () => {
  const text = 'Strategic report. We expect to open 30 new restaurants in the year ahead, funded from cash. Capital expenditure of £25m is planned for 2026.';
  const kept = plansFromAnswer({
    openings: { summary: '30 new restaurants next year', count: 30, quote: 'We expect to open 30 new restaurants in the year ahead, funded from cash.' },
    closures: { summary: '12 closures', count: 12, quote: 'We will close 12 underperforming sites.' },
    capex: { summary: '£25m in 2026', count: null, quote: 'Capital expenditure of £25m is planned for 2026.' },
  }, text);
  assert.equal(kept.openings.count, 30);
  assert.equal(kept.closures, null, 'the sentence is not in the accounts');
  assert.equal(kept.capex.summary, '£25m in 2026');
  assert.equal(kept.none, false);
  assert.equal(plansFromAnswer({ openings: { summary: '40 new sites', count: 40, quote: 'We expect to open 30 new restaurants in the year ahead, funded from cash.' } }, text).openings.count, null, 'a count the sentence does not carry is dropped');
  assert.equal(plansFromAnswer({ openings: null, closures: null, capex: null }, text).none, true);
  assert.equal(plansFromAnswer({ openings: { summary: '30 new restaurants', count: 30, quote: 'We expect to open 30 new restaurants.' } }, null).openings.count, 30, 'a scan has no text to check against');
  assert.equal(plansWeight('2025-12-28', new Date('2026-11-15')), 1);
  assert.equal(plansWeight('2024-12-28', new Date('2026-11-15')), 0.5);
  assert.equal(plansWeight('2023-12-31', new Date('2026-11-15')), 0);
});

test('falling headcount pulls momentum down instead of up; provider vocabulary is understood', () => {
  const down = computeExpansionScoreV2({ brand, facts: [{ signal_type: 'hiring', headline: 'Headcount down 20% over 12 months', sentiment: 'negative', geography: 'uk', confidence: 'high', signal_date: now }] });
  assert.equal(down.subScores.ukMomentum, 0);
  assert.ok(down.lines.some(l => l.points < 0));
  const funded = computeExpansionScoreV2({ brand, facts: [{ signal_type: 'funding', headline: '£40m raise', magnitude: 'major', confidence: 'high', signal_date: now }] });
  assert.equal(funded.subScores.capacity, 14);
});

test('one story is scored once however many feeds carried it, and the dated copy is the one kept', () => {
  const opening = { signal_type: 'opening', geography: 'uk', confidence: 'high', signal_date: now };
  const once = computeExpansionScoreV2({ brand, facts: [{ ...opening, headline: 'Popeyes opens at The Brewery, Romford' }] });
  const copies = computeExpansionScoreV2({ brand, facts: [
    { ...opening, signal_date: null, headline: 'Popeyes opens at The Brewery, Romford' },
    { ...opening, headline: 'Popeyes opens at The Brewery, Romford - Retail Times' },
    { ...opening, headline: 'POPEYES OPENS AT THE BREWERY ROMFORD' },
    { ...opening, headline: 'A different headline for the same link', source: 'https://example.com/a' },
    { ...opening, headline: 'Yet another headline for that link', source: 'https://example.com/a' },
  ] });
  const two = computeExpansionScoreV2({ brand, facts: [{ ...opening, headline: 'Popeyes opens at The Brewery, Romford' }, { ...opening, headline: 'A different headline for the same link', source: 'https://example.com/a' }] });
  assert.equal(once.subScores.ukMomentum, 7);
  assert.equal(copies.subScores.ukMomentum, two.subScores.ukMomentum, 'five rows, two stories');
  assert.equal(dedupeFacts([{ signal_type: 'opening', headline: 'Same story' }, { signal_type: 'closure', headline: 'Same story' }]).length, 2, 'an opening and a closure are never one story');
});

test('a headcount fall has its own line and is not called a closure', () => {
  const out = computeExpansionScoreV2({ brand, facts: [{ signal_type: 'hiring', headline: 'Headcount down 20% over 12 months', sentiment: 'negative', geography: 'uk', confidence: 'high', signal_date: now }] });
  assert.deepEqual(out.lines.map(l => l.label), ['Headcount falling']);
  assert.equal(out.lines[0].points, -2);
});

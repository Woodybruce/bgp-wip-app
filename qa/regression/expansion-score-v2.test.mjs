import test from 'node:test';
import assert from 'node:assert/strict';
import { computeExpansionScoreV2 } from '../../server/hunter-score.ts';

const now = new Date().toISOString();
const brand = { name: 'Bunsik' };

test('HoTs deals, PIPnet requirements, coming-soon sites and interest all score, each under its own label', () => {
  const out = computeExpansionScoreV2({ brand, facts: [], bgp: { committedDeals: 1, liveDeals: 1, completedDeals24m: 1, pipnetRequirements: 2, activeRequirements: 0, comingSoonUk: 2, interest90d: 1, offers90d: 0, viewings90d: 0, interactions90d: 6, representedBy: 1 } });
  const labels = out.lines.map(l => l.label);
  assert.ok(labels.includes('1 deal at HoTs or beyond with BGP'));
  assert.ok(labels.includes('2 live PIPnet requirements'));
  assert.ok(labels.includes('2 UK sites "coming soon" on its own website'));
  assert.ok(labels.includes('Interest in 1 BGP unit in 90 days'));
  assert.ok(!labels.some(l => /with BGP/.test(l) && /requirement/.test(l)), 'PIPnet is not counted as a BGP requirement');
  assert.equal(out.subScores.ukMomentum, 12);
});

test('falling headcount pulls momentum down instead of up; provider vocabulary is understood', () => {
  const down = computeExpansionScoreV2({ brand, facts: [{ signal_type: 'hiring', headline: 'Headcount down 20% over 12 months', sentiment: 'negative', geography: 'uk', confidence: 'high', signal_date: now }] });
  assert.equal(down.subScores.ukMomentum, 0);
  assert.ok(down.lines.some(l => l.points < 0));
  const funded = computeExpansionScoreV2({ brand, facts: [{ signal_type: 'funding', headline: '£40m raise', magnitude: 'major', confidence: 'high', signal_date: now }] });
  assert.equal(funded.subScores.capacity, 14);
});

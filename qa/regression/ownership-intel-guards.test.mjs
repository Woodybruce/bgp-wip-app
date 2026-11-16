// Who owns the brand (Woody, 2026-11-15): the weekly read of the London Food
// Money Matrix. The rules themselves are tested in server/ownership-intel.test.ts
// (in `npm test`); these guards keep the read inside its lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { planOwnership, readOwnershipPage, OWNERSHIP_INTEL_KEY } from '../../shared/ownership-intel.ts';
import { CLIENT_PROFILE_AI_KEYS } from '../../shared/tenant-categories.ts';
const require = createRequire(import.meta.url);
const { source } = require('./source-harness.cjs');

test('the ownership reading is BGP-only: it is on no list of saved fields a client login is sent', () => {
  assert.equal(CLIENT_PROFILE_AI_KEYS.includes(OWNERSHIP_INTEL_KEY), false);
  const panel = source('client/src/components/brand-profile-panel.tsx');
  assert.match(panel, /const ownership: OwnershipIntel \| null = !isClientViewer && aiFields\[OWNERSHIP_INTEL_KEY\]\?\.owner \?/);
});

test('the read never adds or hides a brand, uses no AI, and its routes are admin only', () => {
  const server = source('server/ownership-intel.ts');
  assert.doesNotMatch(server, /INSERT INTO crm_companies|DELETE FROM|archived_at\s*=/i);
  assert.doesNotMatch(server, /anthropic|openai|perplexity|callClaude/i);
  const routes = [...server.matchAll(/app\.(get|post)\("([^"]+)",([^\n]*)/g)];
  assert.deepEqual(routes.map(route => route[2]), ['/api/admin/ownership-intel', '/api/admin/ownership-intel/read']);
  for (const route of routes) assert.match(route[3], /^ requireAuth, requireAdmin,/);
  // Backers is only ever set where it still holds what the plan saw.
  assert.equal((server.match(/SET backers = /g) || []).length, 1);
  assert.match(server, /WHERE id = \$1 AND coalesce\(btrim\(backers\), ''\) = \$5/);
});

test('it runs once a week, and a page that is not the list changes nothing', () => {
  assert.match(source('server/index.ts'), /\{ key: "ownership-intel", due: weeklyAt\(1, 3\), run: \(\) =>\s*import\("\.\/ownership-intel"\)\.then\(m => m\.weeklyOwnershipRead\(\)\) \}/);
  assert.equal(readOwnershipPage('<html><body>Deployment not found</body></html>'), null);
});

test('a name is matched to one food and drink brand only; only an outside investor fills a blank Backers', () => {
  const place = (name, kind, owner) => ({ name, kind, owner, since: 2020, note: '', source: null, area: 'Soho' });
  const brand = (id, name, extra = {}) => ({ id, name, backers: null, hidden: false, fits: true, intel: null, ...extra });
  const { writes, report } = planOwnership(
    [place('Pret A Manger', 'pe', 'JAB Holding'), place('Costa Coffee', 'corp', 'Coca-Cola'), place('The Wolseley', 'corp', 'Minor International'), place('Flat Iron', 'pe', 'TriSpan + McWin'), place('Honest Burgers', 'pe', 'Active Partners')],
    [brand('1', 'Pret a Manger'), brand('2', 'Costa Coffee'), brand('3', 'Wolseley', { fits: false, recordedAs: 'Tenant - Retail' }), brand('4', 'Flat Iron', { backers: 'Piper' })],
    '2026-11-16T03:00:00.000Z');
  assert.deepEqual(writes.map(write => [write.id, write.setBackers]), [['1', 'JAB Holding'], ['2', null], ['4', null]]);
  assert.deepEqual(report.differs.map(row => row.name), ['Flat Iron']);
  assert.deepEqual(report.notInDirectory.map(row => row.name), ['Honest Burgers']);
  assert.equal(report.skipped.length, 1);
});

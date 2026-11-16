// Backfill Tracker Deals (Woody, 2026-11-16: "go"): the one letting repair
// that runs again while the others stay paused. Admins only, never at boot,
// and its answer says what happened to every row it looked at.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { LETTING_REPAIR_TOOLS_ENABLED } from '../../shared/feature-flags.ts';
const require = createRequire(import.meta.url);
const { source } = require('./source-harness.cjs');

test('every /api/admin address is admin only: no staff exception for the backfill', () => {
  const index = source('server/index.ts');
  assert.match(index, /app\.use\("\/api\/admin", \(req, res, next\) => requireAdmin\(req, res, next\)\);/);
  assert.doesNotMatch(index, /ADMIN_PATH_STAFF_EXCEPTIONS/);
  assert.doesNotMatch(index, /backfill-tracker-deals/);
});

test('the backfill is not paused, the other repair tools still are', () => {
  assert.equal(LETTING_REPAIR_TOOLS_ENABLED, false);
  const routes = source('server/routes.ts');
  const start = routes.indexOf('app.post("/api/admin/backfill-tracker-deals"');
  assert.ok(start > 0);
  const body = routes.slice(start, routes.indexOf('app.post("/api/admin/rename-teams"', start));
  assert.doesNotMatch(body, /LETTING_REPAIR/);
  assert.match(body, /backfillUnitBackingDeals\(pool\)/);
  // The answer counts each outcome: there is no preview, so this is the record.
  for (const part of ['letting.scanned', 'letting.created', 'letting.linked', 'letting.skipped', 'letting.failed']) {
    assert.ok(body.includes(part), part);
  }
  assert.match(routes, /app\.post\("\/api\/admin\/rename-teams", requireAuth, async \(req, res\) => \{\s*if \(!LETTING_REPAIR_TOOLS_ENABLED\)/);
});

test('the sweep never runs at boot or on a timer', () => {
  const index = source('server/index.ts');
  assert.doesNotMatch(index, /backfillUnitBackingDeals\(|import\("\.\/unit-mirror"\)[^\n]*backfill/);
  const routes = source('server/routes.ts');
  assert.equal((routes.match(/backfillUnitBackingDeals/g) || []).length, 2);
});

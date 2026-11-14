// Source guards for the admin back-fill of the company on the lease
// (server/tenant-entity-backfill.ts, docs/tenant-entity-plan-2026-11-13.md
// section 6): it links only, only what an admin ticked after a preview, and
// never by itself. The SQL is tested in server/tenant-entity-backfill.test.ts.
//   node --import tsx --test qa/regression/tenant-entity-backfill-guards.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, find, route, ts } = require('./source-harness.cjs');

const BACKFILL = 'server/tenant-entity-backfill.ts';
const ROOT = new URL('../../', import.meta.url).pathname;
const fn = name => find(BACKFILL, node => ts.isFunctionDeclaration(node) && node.name?.text === name);

test('it never runs by itself: no timer, and nothing at boot imports it', () => {
  const s = source(BACKFILL);
  assert.doesNotMatch(s, /setInterval|setTimeout|setImmediate|cron/i);
  assert.doesNotMatch(source('server/index.ts'), /tenant-entity-backfill/);
  const importers = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== 'node_modules') walk(path); continue; }
      if (!/\.(ts|tsx|mjs|cjs|js)$/.test(name) || /\.test\.(ts|mjs|cjs|js)$/.test(name)) continue;
      if (/tenant-entity-backfill/.test(readFileSync(path, 'utf8'))) importers.push(relative(ROOT, path));
    }
  };
  walk(join(ROOT, 'server'));
  assert.deepEqual(importers.sort(), ['server/routes.ts', BACKFILL].sort());
});

test('it links only: no company is made, changed or deleted, and no brand or name is written', () => {
  const s = source(BACKFILL);
  assert.doesNotMatch(s, /INSERT INTO crm_trading_entities|UPDATE crm_trading_entities|DELETE FROM crm_trading_entities/i);
  assert.doesNotMatch(s, /UPDATE crm_companies|trading_entities\s*=/i);
  assert.doesNotMatch(s, /tenant_company_id\s*=(?!=)/, 'never sets the brand');
  assert.doesNotMatch(s, /\b(tenant_name|trading_name)\s*=(?!=)/, 'never writes a name');
  assert.doesNotMatch(s, /insertTradingEntity|setTenancyTenant|relinkTenantAfterNameEdit/);
  // Every SET on a schedule row is the company on the lease and the edit time, nothing else.
  const sets = [...s.matchAll(/UPDATE tenancy_schedule_units \w+\s+SET ([\s\S]*?)\s+FROM/g)].map(m => m[1].replace(/\s+/g, ' '));
  assert.equal(sets.length, 2, 'the apply and the undo');
  for (const set of sets) assert.match(set, /^tenant_entity_id = [\w.>'-]+, updated_at = now\(\)$/, set);
  // A link is made only while the row is as previewed and still has no company.
  const apply = fn('runTenantEntityBackfill');
  for (const guard of ['t.tenant_entity_id IS NULL', 't.tenant_name IS NOT DISTINCT FROM w.tenant_name', 't.trading_name IS NOT DISTINCT FROM w.trading_name', 't.tenant_company_id IS NOT DISTINCT FROM w.company_id']) {
    assert.ok(apply.includes(guard), guard);
  }
  // The undo touches only rows that still hold the company the batch linked.
  assert.match(fn('undoTenantEntityBackfill'), /WHERE t\.id = d\.id AND t\.tenant_entity_id = d\.entity_id/);
  assert.doesNotMatch(s, /anthropic|openai|perplexity|callClaude|ai-provider/i);
});

test('Apply is refused without a recent preview, and applies only link_existing pairs that preview recorded', () => {
  const apply = fn('runTenantEntityBackfill');
  const refusedAt = apply.indexOf('refusal(409, "Preview first');
  assert.ok(refusedAt > 0, 'refuses without a preview');
  assert.match(apply, /Date\.now\(\) - new Date\(dry\.at\)\.getTime\(\) > DRY_RUN_TTL_MS/);
  assert.match(source(BACKFILL), /const DRY_RUN_TTL_MS = 60 \* 60_000;/);
  for (const later of ['classify(pool', 'UPDATE tenancy_schedule_units']) assert.ok(apply.indexOf(later, apply.indexOf('if (opts.dryRun)') + 1) > refusedAt, `${later} comes after the refusal`);
  assert.match(apply, /const pair = dry\.pairs\[key\];\s+if \(!pair\) \{ notPreviewed\.push\(key\); continue; \}/);
  assert.match(apply, /if \(group !== "link_existing"\) continue;/);
  assert.match(apply, /DELETE FROM system_settings WHERE key = \$1`, \[DRY_RUN_KEY\]/, 'a preview is used once');
  // The ticks come from the preview this admin is looking at.
  assert.match(apply, /if \(!opts\.by \|\| dry\.by !== opts\.by \|\| opts\.previewedAt !== dry\.at\)/);
  assert.ok(apply.indexOf('dry.by !== opts.by') < apply.indexOf('classify(pool', apply.indexOf('if (opts.dryRun)') + 1));
  // At the write the company must still sit under the row's brand and be verified.
  assert.match(apply, /= w\.company_id\s+AND \(nullif\(btrim\(te\.companies_house_number\), ''\) IS NOT NULL OR te\.is_default\)/);
  // The verified and confirmed rules sit in the SQL, keyed as the schedule keys names.
  const s = source(BACKFILL);
  assert.match(s, /count\(\*\) FILTER \(WHERE ch IS NOT NULL OR is_default\)::int AS n_verified/);
  // A link needs the full legal names to agree, not only the brand key.
  assert.match(s, /WHEN eg\.n = 1 AND eg\.lk IS DISTINCT FROM u\.lease_legal_key THEN 'ambiguous'\s+WHEN eg\.n = 1 AND eg\.n_verified = 1 THEN 'link_existing'/);
  assert.match(s, /u\.brand_key IS DISTINCT FROM u\.trading_key THEN 'brand_unconfirmed'/);
  assert.match(s, /import \{ brandNameKeySql \} from "\.\/tenant-brand-resolver";/);
});

test('both routes are admin only', () => {
  for (const path of ['/api/admin/tenant-entity-backfill', '/api/admin/tenant-entity-backfill/undo']) {
    const r = route('server/routes.ts', 'post', path);
    assert.match(r, new RegExp(`^app\\.post\\("${path.replace(/[/-]/g, m => `\\${m}`)}", requireAuth, requireAdmin, async`), path);
  }
});

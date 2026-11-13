// The covenant report by company number, for a client login (Greggs,
// 2026-11-13). Two records can carry one company number; the gateway tested
// only whichever the database listed first, so Landsec was refused the
// covenant on a brand in its slice. It now tests every record with the number.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { restrictedLandsecApiRule, RESTRICTED_LANDSEC_ROLES } from '../../shared/landsec.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');

const block = find('server/index.ts', (node, ast) => ts.isIfStatement(node) && node.expression.getText(ast) === 'covCrm || covNum');

async function gateway({ records, visible = [], scope = 'landsec', byId = null }) {
  const queries = [];
  const { run } = evaluate(`exports.run = async (req, res, next, pool, covCrm, covNum) => { ${block} return 'fell through'; };`, {
    require: () => ({
      resolveCompanyScope: async () => scope,
      isClientVisibleBrand: async id => visible.includes(id),
    }),
  });
  const pool = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: records.map(id => ({ id })) }; } };
  const res = { status: code => ({ json: () => `refused ${code}` }) };
  const outcome = await run({}, res, () => 'allowed', pool, byId ? [null, byId] : null, byId ? null : [null, '00502851']);
  return { outcome, queries };
}

test('a client reads the covenant when any record with that company number is a brand it may open', async () => {
  // The record outside the slice is listed first: this was the refusal.
  assert.equal((await gateway({ records: ['retail', 'restaurant'], visible: ['restaurant'] })).outcome, 'allowed');
  assert.equal((await gateway({ records: ['restaurant', 'retail'], visible: ['restaurant'] })).outcome, 'allowed');
  // The client's own company.
  assert.equal((await gateway({ records: ['other', 'landsec'] })).outcome, 'allowed');
});

test('a company number with no record the client may open is still refused', async () => {
  assert.equal((await gateway({ records: ['retail', 'other'] })).outcome, 'refused 403');
  assert.equal((await gateway({ records: [] })).outcome, 'refused 403');
  // No company scope resolved: nothing is looked up and nothing is allowed.
  const unscoped = await gateway({ records: ['restaurant'], visible: ['restaurant'], scope: null });
  assert.equal(unscoped.outcome, 'refused 403');
  assert.equal(unscoped.queries.length, 0);
});

test('the lookup is by the number asked for, is not cut to one record and is in a fixed order', async () => {
  const { queries } = await gateway({ records: ['retail', 'restaurant'], visible: ['restaurant'] });
  assert.equal(queries.length, 1);
  assert.equal(String(queries[0].params), '00502851');
  assert.match(queries[0].sql, /WHERE companies_house_number = \$1/);
  assert.match(queries[0].sql, /ORDER BY/);
  assert.doesNotMatch(queries[0].sql, /LIMIT 1\b/);
});

test('the report by company id keeps its own check of that one record', async () => {
  assert.equal((await gateway({ records: [], visible: ['restaurant'], byId: 'restaurant' })).outcome, 'allowed');
  assert.equal((await gateway({ records: [], visible: ['restaurant'], byId: 'retail' })).outcome, 'refused 403');
});

test('a joint agent is still refused the report by company number; an asset manager is no longer a restricted role', () => {
  assert.equal(restrictedLandsecApiRule('joint_agent', 'GET', '/api/covenant/00502851'), 'deny');
  // Woody, 13 November 2026: an asset manager is a full Landsec login. It never
  // reaches the restricted rule, and reads the report as any client in its slice does.
  assert.deepEqual([...RESTRICTED_LANDSEC_ROLES], ['joint_agent']);
});

test('the covenant engine picks the record behind a shared number the same way every time', () => {
  const engine = source('server/covenant-engine.ts');
  const lookup = engine.slice(engine.indexOf("companies_house_data->'latestAccountsExtracted' AS acc"), engine.indexOf('accounts = rows[0]?.acc'));
  assert.match(lookup, /ORDER BY \(merged_into_id IS NULL\) DESC[\s\S]*created_at, id\s+LIMIT 1/);
});

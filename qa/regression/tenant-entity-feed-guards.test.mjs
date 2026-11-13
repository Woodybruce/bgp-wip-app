// The company on the lease in the unit feed (docs/tenant-entity-plan-2026-11-13.md,
// section 5): the feed reads it inside its existing query, and a client login is
// sent none of it. Checked against the source.
//   node --import tsx --test qa/regression/tenant-entity-feed-guards.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, find, ts } = require('./source-harness.cjs');

const UNITS = 'server/property-units.ts';
const ROOT = new URL('../../', import.meta.url).pathname;
const collapse = text => text.replace(/\s+/g, ' ').trim();
const constant = (file, name) => find(file, (node, ast) => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === name));
const fn = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);

test('SPINE_SQL joins the company on the lease and reads the brand\'s KYC4U fields in the one query', () => {
  const spine = collapse(constant(UNITS, 'SPINE_SQL'));
  assert.match(spine, /LEFT JOIN crm_trading_entities te ON te\.id = t\.tenant_entity_id/);
  assert.match(spine, /te\.name AS tenant_entity_name, te\.companies_house_number AS tenant_entity_ch/);
  assert.match(spine, /AS lease_in_brand_name/);
  // The state is the schedule tenant cell's: leaseCompanyState of the row, on the
  // stored brand (t.tenant_company_id), not the brand found by name.
  assert.match(spine, /t\.tenant_company_id, t\.tenant_entity_id,/);
  assert.match(fn(UNITS, 'loadPropertyUnits'), /leaseCompany: leaseCompanyState\(r\),/);
  assert.match(spine, /COALESCE\(tc_fk\.kyc_status, tc_soft\.kyc_status\) AS brand_kyc_status/);
  assert.match(spine, /COALESCE\(tc_fk\.kyc_expires_at, tc_soft\.kyc_expires_at\)/);
  // Never crm_deals.tenant_entity_id, which is a Xero contact id.
  assert.doesNotMatch(source(UNITS), /d\.tenant_entity_id/);
  // Read inside the existing reads: loadPropertyUnits names no new table.
  assert.doesNotMatch(fn(UNITS, 'loadPropertyUnits'), /crm_trading_entities|FROM crm_companies/);
  assert.equal((fn(UNITS, 'loadPropertyUnits').match(/db\.query\(/g) || []).length, 7, 'the property, then the six reads');
});

test('a client is sent no company on the lease, no state, no KYC4U, and no "no company on lease" flag or count', () => {
  const client = collapse(constant(UNITS, 'clientUnit'));
  assert.match(client, /tenant: \{ \.\.\.unit\.tenant, entityId: null, entityName: null, companiesHouseNumber: null, leaseCompany: null, kyc: null \}/);
  assert.match(client, /flags: \{ \.\.\.unit\.flags, noLeaseCompany: false \}/);
  const viewer = collapse(fn(UNITS, 'unitsForViewer'));
  assert.match(viewer, /if \(viewer\.staff\) return feed;/);
  assert.match(viewer, /units: feed\.units\.map\(clientUnit\), counts: \{ \.\.\.feed\.counts, noLeaseCompany: 0 \}/);
  // The detail cuts its unit the same way.
  assert.match(collapse(fn(UNITS, 'loadPropertyUnitDetail')), /const shown = viewer\.staff \? unit : clientUnit\(unit\);[\s\S]*unit: shown,/);
  // Both routes decide staff by the company scope (staff viewing as a client are a client).
  const text = source(UNITS);
  const feedRoute = text.slice(text.indexOf('router.get("/api/properties/:propertyId/units",'), text.indexOf('router.get("/api/properties/:propertyId/units/:unitId"'));
  assert.match(feedRoute, /const staff = !\(await resolveCompanyScope\(req\)\);\s+res\.json\(unitsForViewer\(feed, \{ staff \}\)\);/);
  assert.doesNotMatch(feedRoute, /res\.json\(feed\)/);
  const detailRoute = text.slice(text.indexOf('router.get("/api/properties/:propertyId/units/:unitId"'));
  assert.match(detailRoute, /const staff = !\(await resolveCompanyScope\(req\)\);[\s\S]*loadPropertyUnitDetail\(pool, propertyId, String\(req\.params\.unitId\), \{ staff \}\)/);
});

// The company's name, Companies House number and covenant are BGP's. A file
// that reads a schedule row's company on the lease by joining its name is a
// new door for them: only these read it. The schedule and the unit feed cut it
// for a client; the back-fill is reached only through admin routes
// (requireAuth, requireAdmin), which no client login passes.
const ALLOWED = ['server/tenancy-schedule.ts', 'server/property-units.ts', 'server/tenant-entity-backfill.ts'];
const JOINS = [
  /crm_trading_entities\s+(?:AS\s+)?(\w+)\s+ON\s+(?:\1\.id(?:::text)?\s*=\s*\w+\.tenant_entity_id|\w+\.tenant_entity_id(?:::text)?\s*=\s*\1\.id)\b/i,
  /FROM\s+crm_trading_entities\b[^`;]{0,200}?\bWHERE\s+(?:\w+\.)?id(?:::text)?\s*=\s*\w+\.tenant_entity_id\b/i,
];
function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(name) && !/\.test\.(ts|mjs|cjs|js)$/.test(name)) out.push(relative(ROOT, path));
  }
  return out;
}

test('no file other than the schedule and the unit feed joins the company on the lease from tenant_entity_id', () => {
  const files = ['server', 'shared', 'client/src', 'script', 'scripts'].flatMap(dir => { try { return sourceFiles(join(ROOT, dir)); } catch { return []; } });
  assert.ok(files.length > 100, `expected the app's source files, found ${files.length}`);
  const joining = files.filter(file => { const text = readFileSync(join(ROOT, file), 'utf8'); return JOINS.some(rule => rule.test(text)); }).sort();
  assert.deepEqual(joining, ALLOWED.filter(file => files.includes(file)).sort());
  const routes = source('server/routes.ts');
  for (const path of ['/api/admin/tenant-entity-backfill"', '/api/admin/tenant-entity-backfill/undo"']) {
    if (!files.includes('server/tenant-entity-backfill.ts')) break;
    assert.match(routes, new RegExp(`app\\.post\\("${path.replace(/[/-]/g, m => `\\${m}`)}, requireAuth, requireAdmin,`), path);
  }
  // The rules catch both spellings of the join and a subquery.
  assert.ok(JOINS[0].test('LEFT JOIN crm_trading_entities x ON x.id = r.tenant_entity_id'));
  assert.ok(JOINS[0].test('JOIN crm_trading_entities e ON r.tenant_entity_id = e.id'));
  assert.ok(JOINS[1].test('(SELECT name FROM crm_trading_entities WHERE id = t.tenant_entity_id)'));
  assert.ok(!JOINS[0].test('JOIN crm_trading_entities te ON te.parent_company_id = t.tenant_company_id'));
});

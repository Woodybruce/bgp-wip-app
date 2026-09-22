// Compare actual nightly SQL eligibility with the shared context rules in an
// isolated schema of the disposable QA database. No providers or public data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import pg from 'pg';
import { propertyResearchContext, PROPERTY_RESEARCH_USE_PATTERN, PROPERTY_RESEARCH_CENTRE_PATTERN } from '../../shared/property-research.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const supplied = process.env.PROPERTY_RESEARCH_DATABASE_URL;
const url = new URL(supplied || 'file:///');
if (url.hostname || url.pathname !== '/bgp_smoke' || url.searchParams.get('host') !== '/tmp/bgp-propertyqa-20260916/socket' || url.searchParams.get('port') !== '55446') throw new Error('Disposable local QA database required');

let selection;
const source = find('server/property-gap-analysis.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'runNightlyGapLiveIntelSweep');
const { runNightlyGapLiveIntelSweep } = evaluate(source, {
  PROPERTY_RESEARCH_USE_PATTERN, PROPERTY_RESEARCH_CENTRE_PATTERN,
  ensureGapColumns: async () => {},
  pool: { query: async (sql, values) => { assert.equal(selection, undefined); selection = { sql, values }; return { rows: [] }; } },
  require: name => { assert.equal(name, './perplexity'); return { isPerplexityConfigured: () => true }; },
});
await runNightlyGapLiveIntelSweep();
assert.ok(selection);
const schema = `qa_research_uses_${process.pid}_${Date.now()}`;
const db = new pg.Pool({ connectionString: supplied, ssl: false, options: `-c search_path=${schema}` });
const contextSource = find('server/property-gap-analysis.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'readPropertyResearchContext');
const { readPropertyResearchContext } = evaluate(contextSource + '\nexports.readPropertyResearchContext=readPropertyResearchContext;', { pool: db, propertyResearchContext });
let checks = 0;
try {
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`CREATE TABLE crm_properties(id text PRIMARY KEY, asset_class text, property_view text, gap_commentary text, gap_live_intel_at timestamptz);
    CREATE TABLE tenancy_schedule_units(property_id text, permitted_use text, status text, occupancy_status text);
    CREATE TABLE leasing_schedule_units(property_id text);
    INSERT INTO crm_properties VALUES ('synthetic', 'Mixed Use', NULL, 'Synthetic previous research', NULL);
    INSERT INTO tenancy_schedule_units VALUES ('synthetic', NULL, 'Occupied', NULL);`);
  for (const use of ['E(a)', 'Class E(b)', 'E ( d )', 'A1', 'A3', 'Shops', 'Restaurants', 'Cafés', 'Gyms', 'Bars', 'Pubs', 'Kiosks', 'Takeaways', 'F & B', 'E', 'Class E', 'E(c)', 'E(e)', 'E(f)', 'E(g)', 'E(g)(i)', 'B8', 'Offices', 'Workshop', 'Barcode storage']) {
    for (const [status, occupancy_status] of [['Occupied', null], [' Archived ', 'Occupied'], ['Occupied', ' Archived '], [null, 'ARCHIVED']]) {
      await db.query('UPDATE tenancy_schedule_units SET permitted_use=$1,status=$2,occupancy_status=$3', [use, status, occupancy_status]);
      const selected = (await db.query(selection.sql, selection.values)).rows.length > 0;
      assert.equal(selected, propertyResearchContext({ assetClass: 'Mixed Use' }, [{ permitted_use: use, status, occupancy_status }]).mode !== 'not_applicable', `${use} / ${status} / ${occupancy_status}`);
      assert.equal(selected, (await readPropertyResearchContext('synthetic')).mode !== 'not_applicable', `context SQL: ${use} / ${status} / ${occupancy_status}`);
      checks++;
    }
  }
  await db.query('DELETE FROM tenancy_schedule_units');
  for (const assetClass of ['Office', 'Residential', 'Retail', 'F & B', 'Shopping Centre', 'Retail Park', 'Outlet Village']) {
    await db.query('UPDATE crm_properties SET asset_class=$1', [assetClass]);
    const selected = (await db.query(selection.sql, selection.values)).rows.length > 0;
    assert.equal(selected, propertyResearchContext({ assetClass }).mode !== 'not_applicable', assetClass);
    checks++;
  }
  console.log(`PASS ${checks} PostgreSQL research eligibility cases; actual nightly query and shared context agree`);
} finally {
  try { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
  finally { await db.end(); }
}

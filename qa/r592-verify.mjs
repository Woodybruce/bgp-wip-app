// r592 visual verify — a BGP agent adds a unit on the Letting Tracker; Mark
// Warne then opens his own Tenancy Schedule on his phone at 390px. The unit
// must appear in the VACANT tile, survive the vacant filter, and carry a
// Vacant chip — not sit in the row list outside every tile.
process.env.QA_MAIN = '0';
process.env.QA_STEP_BASE = process.env.QA_STEP_BASE || '70';
import pg from 'pg';
const PROP = 'cccccccc-0000-0000-0000-000000000001';
const BASE = 'http://127.0.0.1:5000';
const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';

const staff = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }) })).json();
const SH = { Authorization: `Bearer ${staff.token}`, 'Content-Type': 'application/json' };
const r = await fetch(`${BASE}/api/available-units`, { method: 'POST', headers: SH, body: JSON.stringify({ propertyId: PROP, unitName: 'QA-R592-VERIFY', marketingStatus: 'AVA', sqft: 1200 }) });
const unit = await r.json();
console.log(`staff added QA-R592-VERIFY -> HTTP ${r.status} id=${unit.id}`);

const h = await import('./r592-client-mobile-journey.mjs');
const { page, go, tap, report } = h;
const info = await go(`/tenancy-schedule/${PROP}`, 'verify-tenancy-tiles');
const tiles = await page.evaluate(() => {
  const out = {};
  for (const el of document.querySelectorAll('[data-testid^="tenancy-stat-"]')) {
    out[el.getAttribute('data-testid').replace('tenancy-stat-', '')] = (el.innerText || '').split('\n').slice(1).join(' ').trim();
  }
  return out;
});
console.log('TILES: ' + JSON.stringify(tiles));

// Tap the Vacant tile — does the unit the agent just added show up in it?
await tap('[data-testid="tenancy-stat-vacant"]', 'verify-vacant-filter');
const seen = await page.evaluate(() => {
  const t = document.body.innerText || '';
  const i = t.indexOf('QA-R592-VERIFY');
  return { present: i >= 0, around: i >= 0 ? t.slice(Math.max(0, i - 60), i + 140).replace(/\n+/g, ' | ') : null };
});
console.log(`VACANT FILTER shows QA-R592-VERIFY: ${seen.present}`);
if (seen.around) console.log(`   row: ${seen.around}`);

// Teardown — the tracker DELETE must take its spine stub with it.
const c = new pg.Client({ connectionString: url });
await c.connect();
const d = await fetch(`${BASE}/api/available-units/${unit.id}`, { method: 'DELETE', headers: SH });
const left = (await c.query(`SELECT unit_number, status FROM tenancy_schedule_units WHERE property_id=$1 AND unit_number LIKE 'QA-R592-%'`, [PROP])).rows;
console.log(`DELETE -> ${d.status}; spine stubs left behind: ${left.length}`);
await c.query(`DELETE FROM tenancy_schedule_units WHERE property_id=$1 AND unit_number LIKE 'QA-R592-%'`, [PROP]);
await c.query(`DELETE FROM leasing_schedule_units WHERE property_id=$1 AND unit_name LIKE 'QA-R592-%'`, [PROP]);
await c.query(`DELETE FROM available_units WHERE property_id=$1 AND unit_name LIKE 'QA-R592-%'`, [PROP]);
await c.query(`DELETE FROM crm_deals WHERE name LIKE '%QA-R592-%'`);
const counts = (await c.query(`SELECT (SELECT count(*)::int FROM available_units) au, (SELECT count(*)::int FROM leasing_schedule_units) ls, (SELECT count(*)::int FROM tenancy_schedule_units) ts`)).rows[0];
console.log(`fixture after teardown: ${JSON.stringify(counts)}`);
await c.end();
await h.browser.close();

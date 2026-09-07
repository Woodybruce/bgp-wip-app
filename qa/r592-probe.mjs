// r592 probe — what does the Letting Tracker's CREATE path stamp into the
// LANDLORD'S OWN tenancy schedule? POST /api/available-units calls
// ensureTenancyRowForAvailableUnit (routes.ts:4589), which inserts a spine
// row with mapMarketingToTenancyStatus(marketing_status) — whose default arm
// returns the LEGACY value "Marketing". The tenancy board's own vocabulary is
// SCHEDULE_STATUSES (Vacant / Opportunity / In Negotiation / Under Offer /
// Occupied / Trading / Lease Event / Archived) and its tiles bucket via
// STATUS_BUCKETS { Occupied:[Occupied,Trading,Let,Not Vacant],
// Vacant:[Vacant,Void,Available,AVA] } — neither knows "Marketing".
//
// CONTROLS: a SOL unit (must land on 'Under Offer', a bucketed value) and the
// pre-existing spine rows (must be untouched).
import pg from 'pg';
const BASE = 'http://127.0.0.1:5000';
const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const PROP = 'cccccccc-0000-0000-0000-000000000001';
const OCC = ["Occupied", "Trading", "Let", "Not Vacant"];
const VAC = ["Vacant", "Void", "Available", "AVA"];

const c = new pg.Client({ connectionString: url });
await c.connect();
const before = (await c.query(`SELECT count(*)::int n FROM tenancy_schedule_units WHERE property_id=$1`, [PROP])).rows[0].n;
const beforeCensus = (await c.query(`SELECT status, count(*)::int n FROM tenancy_schedule_units WHERE property_id=$1 GROUP BY 1 ORDER BY 2 DESC`, [PROP])).rows;
console.log(`spine rows before: ${before}`);
console.table(beforeCensus);

const login = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }) })).json();
if (!login.token) { console.error('login failed'); process.exit(2); }
const H = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };

const made = [];
const mk = async (unitName, marketingStatus) => {
  const r = await fetch(`${BASE}/api/available-units`, { method: 'POST', headers: H, body: JSON.stringify({ propertyId: PROP, unitName, marketingStatus, sqft: 950 }) });
  if (!r.ok) { console.log(`  POST ${unitName} refused ${r.status}`); return null; }
  const u = await r.json(); made.push(u.id); return u;
};
const ava = await mk('QA-R592-SPINE-A', 'AVA');
const neg = await mk('QA-R592-SPINE-N', 'NEG');
const sol = await mk('QA-R592-SPINE-S', 'SOL');   // CONTROL — must bucket
const com = await mk('QA-R592-SPINE-C', 'COM');   // CONTROL — must bucket

const rows = (await c.query(
  `SELECT unit_number, status, letting_tracker_unit_id IS NOT NULL AS is_stub
     FROM tenancy_schedule_units WHERE property_id=$1 AND unit_number LIKE 'QA-R592-SPINE-%' ORDER BY unit_number`, [PROP])).rows;
console.log('\nWhat the CREATE path stamped on the landlord\'s tenancy schedule:');
console.table(rows.map(r => ({
  unit: r.unit_number, status: r.status, stub: r.is_stub,
  countedOccupied: OCC.includes(r.status || ''), countedVacant: VAC.includes(r.status || ''),
  bucketed: OCC.includes(r.status || '') || VAC.includes(r.status || ''),
})));
const unbucketed = rows.filter(r => !OCC.includes(r.status || '') && !VAC.includes(r.status || ''));
console.log(`\nUNBUCKETED spine rows created by the tracker: ${unbucketed.length} of ${rows.length}  ${unbucketed.length ? '<-- in neither tile, hidden from the Vacant filter, no chip colour' : ''}`);
if (!rows.length) console.log('CONTROL FAILED: the POST created no spine row at all — this probe is vacuous');

// The tiles as the page computes them, over the whole property.
const all = (await c.query(`SELECT status FROM tenancy_schedule_units WHERE property_id=$1`, [PROP])).rows;
const occ = all.filter(r => OCC.includes(r.status || '')).length;
const vac = all.filter(r => VAC.includes(r.status || '')).length;
console.log(`TILES: total ${all.length} · occupied ${occ} · vacant ${vac} · accounted-for ${occ + vac} · MISSING ${all.length - occ - vac}`);

if (process.argv.includes('--restore')) {
  for (const id of made) {
    const d = await fetch(`${BASE}/api/available-units/${id}`, { method: 'DELETE', headers: H });
    console.log(`  DELETE ${id} -> ${d.status}`);
  }
  const left = (await c.query(`SELECT unit_number, status FROM tenancy_schedule_units WHERE property_id=$1 AND unit_number LIKE 'QA-R592-SPINE-%'`, [PROP])).rows;
  console.log(`spine rows LEFT BEHIND after the tracker deletes: ${left.length}`);
  console.table(left);
  // Hard teardown so the fixture is exact either way.
  await c.query(`DELETE FROM tenancy_schedule_units WHERE property_id=$1 AND unit_number LIKE 'QA-R592-SPINE-%'`, [PROP]);
  await c.query(`DELETE FROM leasing_schedule_units WHERE property_id=$1 AND unit_name LIKE 'QA-R592-SPINE-%'`, [PROP]);
  await c.query(`DELETE FROM available_units WHERE property_id=$1 AND unit_name LIKE 'QA-R592-SPINE-%'`, [PROP]);
  await c.query(`DELETE FROM crm_deals WHERE name LIKE '%QA-R592-SPINE-%'`);
  const after = (await c.query(`SELECT count(*)::int n FROM tenancy_schedule_units WHERE property_id=$1`, [PROP])).rows[0].n;
  console.log(`spine rows after teardown: ${after} (before ${before})`);
}
await c.end();

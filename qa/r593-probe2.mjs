// r593 probe, PHASE B — after a boot with a NEG deal that has no listing.
// Q1: did the boot auto-seed (routes.ts:7676) resurrect a listing, and under
//     which name convention?
// Q2: does the one-live-listing guard (routes.ts:4507) catch a re-add of the
//     SAME physical unit under its bare name?
// CONTROLS: (a) the comma convention, which the guard is known to catch;
//           (b) a genuinely different unit, which must NOT be deduped.
import pg from 'pg';
const BASE = 'http://127.0.0.1:5000';
const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const PROP = 'cccccccc-0000-0000-0000-000000000001';
const UNIT = 'QA-R593-U1';

const c = new pg.Client({ connectionString: url });
await c.connect();
const seeded = (await c.query(
  `SELECT id, unit_name, marketing_status, deal_id FROM available_units
    WHERE property_id=$1 AND unit_name LIKE '%QA-R593%' ORDER BY created_at`, [PROP])).rows;
console.log('listings for the unit after boot:');
console.table(seeded);

const login = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }) })).json();
const H = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };

const add = async (name) => {
  const r = await fetch(`${BASE}/api/available-units`, { method: 'POST', headers: H, body: JSON.stringify({ propertyId: PROP, unitName: name, marketingStatus: 'AVA', sqft: 1200 }) });
  const u = await r.json();
  console.log(`POST "${name}" -> ${r.status} id=${u.id} alreadyListed=${!!u.alreadyListed}`);
  return u;
};

console.log('\n-- the agent re-adds the unit under its BARE name (the tracker/tenancy one-click) --');
const bare = await add(UNIT);
console.log('\n-- CONTROL (a): the comma convention, which the guard IS shaped for --');
const comma = await add(`${UNIT}, Bluewater`);
console.log('\n-- CONTROL (b): a genuinely different unit — must NOT be deduped --');
const other = await add('QA-R593-U2');

const after = (await c.query(
  `SELECT id, unit_name, marketing_status FROM available_units
    WHERE property_id=$1 AND unit_name LIKE '%QA-R593%' ORDER BY created_at`, [PROP])).rows;
console.log('\nLIVE listings on the property for these units:');
console.table(after);
const forU1 = after.filter(r => r.unit_name.includes('U1'));
console.log(`\nVERDICT: ${forU1.length} live listing(s) for ONE physical unit ${UNIT}`);
const forU3 = after.filter(r => r.unit_name.includes('U3'));
console.log(`BOOT-SEED GUARD: ${forU3.length} live listing(s) for QA-R593-U3 (its NEG deal was unlinked before boot; must stay 1)`);
console.table(forU3);
await c.end();

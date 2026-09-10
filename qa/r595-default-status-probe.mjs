// r595: does a tracker listing created WITHOUT marketing_status bank the
// LABEL 'Available' into the codes column? The column DEFAULT is
// 'Available'::text, and canonicaliseUnitStatus() only acts on a PRESENT
// string — an omitted field means drizzle omits the column and PG applies
// the label, so r588's canonicalise-on-write never sees it.
import pg from 'pg';
const BASE = 'http://127.0.0.1:5000';
const PASSWORD = 'B@nd0077!';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
let pass = 0, fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${msg}`); ok ? pass++ : fail++; };

const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: PASSWORD }) });
const { token } = await lr.json();
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

async function purge() {
  for (const [t, col] of [['available_units','unit_name'], ['leasing_schedule_units','unit_name'], ['tenancy_schedule_units','unit_number'], ['property_units','unit_name'], ['crm_deals','name']]) {
    await c.query(`DELETE FROM ${t} WHERE ${col} LIKE '%QA-R595%'`);
  }
}
// A previous run's auto-created DEAL survives a listing-only teardown, and
// the boot auto-seed then re-lists it under the en-dash name — which answers
// the dupe guard and makes the next run's control read the WRONG row.
await purge();

const prop = (await c.query(`SELECT id, name FROM crm_properties ORDER BY name LIMIT 1`)).rows[0];
console.log('   target property:', prop.name);

const made = [];
async function post(body, label) {
  const r = await fetch(`${BASE}/api/available-units`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (j.id) made.push(j.id);
  const row = j.id ? (await c.query(`SELECT marketing_status, unit_name FROM available_units WHERE id = $1`, [j.id])).rows[0] : null;
  console.log(`   ${label}: status ${r.status} id=${j.id} alreadyListed=${!!j.alreadyListed} name=${JSON.stringify(row?.unit_name)} → banked ${JSON.stringify(row?.marketing_status)}`);
  return row?.marketing_status ?? null;
}

// 1. OMITTED marketingStatus — the bug under test.
const omitted = await post({ propertyId: prop.id, unitName: 'QA-R595 omitted status' }, 'marketingStatus OMITTED');
check(omitted === 'AVA', `an omitted marketingStatus banks the CODE, not the label (got ${JSON.stringify(omitted)})`);

// 2. CONTROL, near miss: the LABEL sent explicitly must still canonicalise
//    (r588's canonicalise-on-write) — proves the check above isn't passing
//    just because everything gets rewritten somewhere else.
const label = await post({ propertyId: prop.id, unitName: 'QA-R595 label status', marketingStatus: 'Available' }, 'marketingStatus = "Available"');
check(label === 'AVA', `CONTROL: an explicit label still canonicalises to AVA (got ${JSON.stringify(label)})`);

// 3. CONTROL, near miss: a non-AVA code must be preserved verbatim, so the
//    fix is not simply stamping AVA over everything.
const neg = await post({ propertyId: prop.id, unitName: 'QA-R595 neg status', marketingStatus: 'NEG' }, 'marketingStatus = "NEG"');
check(neg === 'NEG', `CONTROL: an explicit NEG is preserved, not overwritten with AVA (got ${JSON.stringify(neg)})`);

// teardown
for (const id of made) {
  await fetch(`${BASE}/api/available-units/${id}`, { method: 'DELETE', headers: { Authorization: auth.Authorization } });
}
await purge();
const leftover = (await c.query(`SELECT count(*)::int n FROM available_units WHERE unit_name LIKE 'QA-R595%'`)).rows[0].n;
console.log(`   teardown: ${leftover} QA-R595 listing(s) left`);
const total = (await c.query(`SELECT count(*)::int n FROM available_units`)).rows[0].n;
console.log(`   available_units now ${total} (baseline 76)`);
console.log(`\n${pass} PASS / ${fail} FAIL`);
await c.end();
process.exit(fail ? 1 : 0);

// r593 probe, PHASE A — set up the state the boot resurrector needs.
//
// The one-live-listing guard (routes.ts:4507) compares the FIRST COMMA
// SEGMENT of unit_name. But available_units.unit_name exists in three
// conventions and the third one has a named source: POST /api/available-units
// names the backing deal `${property.name} – ${unit.unitName}` (EN DASH,
// routes.ts:4644), and the boot auto-seed at routes.ts:7676 spawns a fresh
// listing for every NEG/HOTs deal with no listing, using `deal.name` as the
// unit name. That name has no comma, so its first comma segment is the WHOLE
// string — and the guard can never match it against the bare unit name.
//
// PHASE A: create a listing, move it to NEG, delete the listing (the deal
// survives — UX #292). PHASE B (after a restart) checks what boot did.
import pg from 'pg';
const BASE = 'http://127.0.0.1:5000';
const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const PROP = 'cccccccc-0000-0000-0000-000000000001';
const UNIT = 'QA-R593-U1';

const c = new pg.Client({ connectionString: url });
await c.connect();
const login = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }) })).json();
if (!login.token) { console.error('login failed'); process.exit(2); }
const H = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };

const r = await fetch(`${BASE}/api/available-units`, { method: 'POST', headers: H, body: JSON.stringify({ propertyId: PROP, unitName: UNIT, marketingStatus: 'AVA', sqft: 1200 }) });
const unit = await r.json();
console.log(`created listing ${unit.id} name=${unit.unitName} deal=${unit.dealId}`);

const deal = (await c.query(`SELECT id, name, status FROM crm_deals WHERE id=$1`, [unit.dealId])).rows[0];
console.log(`backing deal name: ${JSON.stringify(deal?.name)}  status=${deal?.status}`);
console.log(`  contains EN DASH (U+2013): ${String(deal?.name || '').includes('–')}`);

const p = await fetch(`${BASE}/api/available-units/${unit.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ marketingStatus: 'NEG' }) });
console.log(`PATCH -> NEG: ${p.status}`);
const deal2 = (await c.query(`SELECT status FROM crm_deals WHERE id=$1`, [unit.dealId])).rows[0];
console.log(`deal status after mirror: ${deal2?.status}`);

const d = await fetch(`${BASE}/api/available-units/${unit.id}`, { method: 'DELETE', headers: H });
console.log(`DELETE listing: ${d.status}`);
const survives = (await c.query(`SELECT id, name, status FROM crm_deals WHERE id=$1`, [unit.dealId])).rows[0];
console.log(`deal after listing delete: ${survives ? `${JSON.stringify(survives.name)} @ ${survives.status}` : 'GONE'}`);
const left = (await c.query(`SELECT id, unit_name FROM available_units WHERE property_id=$1 AND unit_name LIKE 'QA-R593%'`, [PROP])).rows;
console.log(`listings named QA-R593* still present: ${left.length}`);

// SECOND SETUP, for the boot auto-seed's own guard: a unit that KEEPS its
// live listing under the bare name while its NEG deal loses the back-link.
// Boot then sees a NEG deal with no listing by deal_id — it must NOT spawn a
// second listing for a unit that is already listed under another convention.
const r3 = await fetch(`${BASE}/api/available-units`, { method: 'POST', headers: H, body: JSON.stringify({ propertyId: PROP, unitName: 'QA-R593-U3', marketingStatus: 'NEG', sqft: 800 }) });
const u3 = await r3.json();
await c.query(`UPDATE crm_deals SET status='NEG' WHERE id=$1`, [u3.dealId]);
await c.query(`UPDATE available_units SET deal_id=NULL WHERE id=$1`, [u3.id]);
console.log(`U3 listing ${u3.id} kept, deal ${u3.dealId} unlinked and left at NEG`);
await c.end();

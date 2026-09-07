// r594 verifier — both fixes, live against the running server, then cleanup.
// 1. blankToNull: an offer/viewing logged with no company picked (the "" the
//    CRM picker sends) must bank NULL, not '', so the asset brief's
//    "link the brand" gap list still sees the unit as uncounterpartied.
// 2. IN_PLAY_STATUS_RX: a HOT unit is back on the gap list.
import pg from 'pg';
const BASE = 'http://127.0.0.1:5000';
const c = new pg.Client({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
let pass = 0, fail = 0;
const ck = (ok, m) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${m}`); ok ? pass++ : fail++; };
const login = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }) })).json();
const H = { 'content-type': 'application/json', Authorization: `Bearer ${login.token}` };
const PROP = 'cccccccc-0000-0000-0000-000000000001';

const u = (await c.query(`SELECT id, unit_name, marketing_status FROM available_units
  WHERE property_id=$1 AND marketing_status='AVA' AND tenant_company_id IS NULL AND deal_id IS NULL LIMIT 1`, [PROP])).rows[0];
console.log(`\n── unit under test: ${u.unit_name} (${u.id})`);

// ── 1. the write boundary, exactly what the phone dialog posts.
const body = { companyId: '', companyName: '', contactId: '', contactName: '', offerDate: '2026-09-07', rentPa: 1234, comments: 'r594 verify' };
const r = await fetch(`${BASE}/api/available-units/${u.id}/offers`, { method: 'POST', headers: H, body: JSON.stringify(body) });
const off = await r.json();
ck(r.status === 200, `POST offer with blank picker ids → ${r.status}`);
const row = (await c.query(`SELECT company_id, contact_id, company_name, contact_name FROM unit_offers WHERE id=$1`, [off.id])).rows[0];
console.log(`   stored: ${JSON.stringify(row)}`);
ck(row.company_id === null && row.contact_id === null, 'blank picker ids banked as NULL, not ""');
ck(row.company_name === null && row.contact_name === null, 'blank names banked as NULL too');
const vr = await fetch(`${BASE}/api/available-units/${u.id}/viewings`, { method: 'POST', headers: H, body: JSON.stringify({ companyId: '', contactId: '', viewingDate: '2026-09-07' }) });
const vw = await vr.json();
const vrow = (await c.query(`SELECT company_id, contact_id FROM unit_viewings WHERE id=$1`, [vw.id])).rows[0];
ck(vrow && vrow.company_id === null && vrow.contact_id === null, `the sibling viewing writer too: ${JSON.stringify(vrow)}`);

// ── the consequence: the gap list still sees the unit (the real point).
const gap = () => c.query(`SELECT au.unit_name FROM available_units au
  WHERE au.property_id=$1 AND lower(COALESCE(au.marketing_status,'')) ~ '(neg|offer|hot|sol|exc|terms)'
    AND au.tenant_company_id IS NULL AND au.deal_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM unit_offers o WHERE o.unit_id=au.id AND o.company_id IS NOT NULL)`, [PROP]);
await c.query(`UPDATE available_units SET marketing_status='HOT' WHERE id=$1`, [u.id]);
ck((await gap()).rows.some(x => x.unit_name === u.unit_name), 'a HOT unit whose only offer names no company IS on the "link the brand" gap list');
// CONTROL — a real company on the offer must still remove it from the gap list.
const brand = (await c.query(`SELECT id FROM crm_companies LIMIT 1`)).rows[0];
await fetch(`${BASE}/api/available-units/offers/${off.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ companyId: brand.id }) });
ck(!(await gap()).rows.some(x => x.unit_name === u.unit_name), 'CONTROL: give that offer a real company and the unit leaves the gap list — the predicate is not vacuous');

// ── cleanup: this verifier's rows, and the journey's own artefacts.
await c.query(`DELETE FROM unit_offers WHERE id=$1`, [off.id]);
if (vw?.id) await c.query(`DELETE FROM unit_viewings WHERE id=$1`, [vw.id]);
await c.query(`UPDATE available_units SET marketing_status=$2 WHERE id=$1`, [u.id, u.marketing_status]);
const j = await c.query(`DELETE FROM unit_offers WHERE comments LIKE 'r594 QA%' RETURNING id`);
const h = await c.query(`DELETE FROM crm_companies WHERE name='Honi' RETURNING id`);
console.log(`   cleanup: ${j.rowCount} journey offer(s), ${h.rowCount} stray "Honi" company row(s)`);
const census = await c.query(`SELECT (SELECT count(*)::int FROM available_units) au, (SELECT count(*)::int FROM leasing_schedule_units) ls, (SELECT count(*)::int FROM tenancy_schedule_units) ts, (SELECT count(*)::int FROM unit_offers) offers`);
console.log(`   census: ${JSON.stringify(census.rows[0])}`);
ck(census.rows[0].au === 76 && census.rows[0].ls === 169, 'fixture baselines back to au 76 / ls 169');
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} pass, ${fail} fail`);
await c.end();
process.exit(fail === 0 ? 0 : 1);

// r617: the three merge doors. A = Settings property merge, B = Settings company
// merge's FK coverage, C = brand dedupe merge over an overlapping junction link.
import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
const BASE = 'http://127.0.0.1:5000';

async function login(username, password) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('login ' + r.status + ' ' + JSON.stringify(j));
  return j.token || j.accessToken || j.sessionToken;
}
const token = await login('victoria@brucegillinghampollard.com', 'B@nd0077!');
const H = { 'content-type': 'application/json', authorization: 'Bearer ' + token };
const q = (s, p) => pool.query(s, p);
const clean = async () => {
  await q("DELETE FROM crm_company_deals WHERE company_id IN (SELECT id FROM crm_companies WHERE name LIKE 'QA r617%')");
  await q("DELETE FROM crm_company_properties WHERE company_id IN (SELECT id FROM crm_companies WHERE name LIKE 'QA r617%')");
  await q("DELETE FROM crm_property_tenants WHERE company_id IN (SELECT id FROM crm_companies WHERE name LIKE 'QA r617%') OR property_id IN (SELECT id FROM crm_properties WHERE name LIKE 'QA r617%')");
  await q("DELETE FROM crm_property_agents WHERE property_id IN (SELECT id FROM crm_properties WHERE name LIKE 'QA r617%')");
  await q("DELETE FROM crm_comps WHERE name LIKE 'QA r617%' OR tenant_company_id IN (SELECT id FROM crm_companies WHERE name LIKE 'QA r617%') OR landlord_company_id IN (SELECT id FROM crm_companies WHERE name LIKE 'QA r617%')");
  await q("DELETE FROM crm_deals WHERE name LIKE 'QA r617%'");
  await q("DELETE FROM dedupe_merges WHERE primary_id IN (SELECT id FROM crm_companies WHERE name LIKE 'QA r617%')");
  await q("DELETE FROM crm_companies WHERE name LIKE 'QA r617%'");
  await q("DELETE FROM crm_properties WHERE name LIKE 'QA r617%'");
};
await clean();

// ── A: Settings property merge ────────────────────────────────────────────
const u1 = (await q("SELECT id FROM users WHERE lower(email)=lower($1)", ['victoria@brucegillinghampollard.com'])).rows[0].id;
const u2 = (await q("SELECT id FROM users WHERE COALESCE(role,'')<>'Client' AND id<>$1 LIMIT 1", [u1])).rows[0].id;
const pKeep = (await q("INSERT INTO crm_properties (name) VALUES ('QA r617 Dup House') RETURNING id")).rows[0].id;
const pGone = (await q("INSERT INTO crm_properties (name) VALUES ('QA r617 Dup House') RETURNING id")).rows[0].id;
const coT = (await q("INSERT INTO crm_companies (name) VALUES ('QA r617 Tenant Brand') RETURNING id")).rows[0].id;
await q("INSERT INTO crm_property_agents (property_id, user_id, role) VALUES ($1,$2,'Lead')", [pKeep, u1]);
await q("INSERT INTO crm_property_agents (property_id, user_id, role) VALUES ($1,$2,'Leasing')", [pGone, u2]);
await q("INSERT INTO crm_property_tenants (property_id, company_id) VALUES ($1,$2)", [pGone, coT]);

let r = await fetch(BASE + '/api/crm/duplicates/merge', { method: 'POST', headers: H,
  body: JSON.stringify({ entity: 'property', keepId: pKeep, deleteIds: [pGone] }) });
console.log('A · merge property        ->', r.status, (await r.text()).slice(0, 160));
console.log('A · duplicate rows left   ->', (await q("SELECT count(*)::int c FROM crm_properties WHERE name='QA r617 Dup House'")).rows[0].c, '(want 1)');
console.log('A · agents on keeper      ->', (await q("SELECT count(*)::int c FROM crm_property_agents WHERE property_id=$1", [pKeep])).rows[0].c, '(want 2)');
console.log('A · tenant link on keeper ->', (await q("SELECT count(*)::int c FROM crm_property_tenants WHERE property_id=$1", [pKeep])).rows[0].c, '(want 1)');
console.log('A · orphan agent rows     ->', (await q("SELECT count(*)::int c FROM crm_property_agents pa WHERE NOT EXISTS (SELECT 1 FROM crm_properties p WHERE p.id=pa.property_id)")).rows[0].c, '(want 0)');

// ── C: brand dedupe merge, primary and secondary sharing one deal link ────
const cPrim = (await q("INSERT INTO crm_companies (name) VALUES ('QA r617 Brand A') RETURNING id")).rows[0].id;
const cSec  = (await q("INSERT INTO crm_companies (name) VALUES ('QA r617 Brand A Ltd') RETURNING id")).rows[0].id;
const dealId = (await q("INSERT INTO crm_deals (name) VALUES ('QA r617 Shared Deal') RETURNING id")).rows[0].id;
await q("INSERT INTO crm_company_deals (company_id, deal_id) VALUES ($1,$2)", [cPrim, dealId]);
await q("INSERT INTO crm_company_deals (company_id, deal_id) VALUES ($1,$2)", [cSec, dealId]);
await q("INSERT INTO crm_company_properties (company_id, property_id) VALUES ($1,$2)", [cPrim, pKeep]);
await q("INSERT INTO crm_company_properties (company_id, property_id) VALUES ($1,$2)", [cSec, pKeep]);
// a link the secondary holds ALONE — must move across, proving the collision
// guard doesn't over-skip
const soloDeal = (await q("INSERT INTO crm_deals (name) VALUES ('QA r617 Solo Deal') RETURNING id")).rows[0].id;
await q("INSERT INTO crm_company_deals (company_id, deal_id) VALUES ($1,$2)", [cSec, soloDeal]);
await q("INSERT INTO crm_comps (name, tenant_company_id) VALUES ('QA r617 Comp', $1)", [cSec]);

r = await fetch(BASE + '/api/brand/dedupe/merge', { method: 'POST', headers: H,
  body: JSON.stringify({ primaryId: cPrim, secondaryId: cSec }) });
console.log('C · brand dedupe merge    ->', r.status, (await r.text()).slice(0, 200));
console.log('C · secondary merged?     ->', (await q("SELECT merged_into_id FROM crm_companies WHERE id=$1", [cSec])).rows[0].merged_into_id ? 'yes' : 'NO (rolled back)');
console.log('C · deal links on primary ->', (await q("SELECT count(*)::int c FROM crm_company_deals WHERE company_id=$1", [cPrim])).rows[0].c, '(want 2: the shared one, once, + the solo one moved across)');
console.log('C · shared link duplicated?->', (await q("SELECT count(*)::int c FROM crm_company_deals WHERE company_id=$1 AND deal_id=$2", [cPrim, dealId])).rows[0].c, '(want 1)');
console.log('C · left on the secondary ->', (await q("SELECT count(*)::int c FROM crm_company_deals WHERE company_id=$1", [cSec])).rows[0].c, '(want 1: only the colliding row, kept so undo is lossless)');
console.log('C · comp re-pointed       ->', (await q("SELECT count(*)::int c FROM crm_comps WHERE tenant_company_id=$1", [cPrim])).rows[0].c, '(want 1)');

await clean();
await pool.end();

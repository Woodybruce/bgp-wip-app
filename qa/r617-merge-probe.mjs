// r617: does POST /api/crm/duplicates/merge work for entity="property"?
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

// two duplicate properties, each with a property-agent link
const u = (await pool.query("SELECT id FROM users WHERE lower(email)=lower($1)", ['victoria@brucegillinghampollard.com'])).rows[0].id;
const u2 = (await pool.query("SELECT id FROM users WHERE lower(email)<>lower($1) AND COALESCE(role,'')<>'Client' LIMIT 1", ['victoria@brucegillinghampollard.com'])).rows[0].id;
const a = (await pool.query("INSERT INTO crm_properties (name, address) VALUES ('QA r617 Dup House', to_jsonb('1 QA Way'::text)) RETURNING id")).rows[0].id;
const b = (await pool.query("INSERT INTO crm_properties (name, address) VALUES ('QA r617 Dup House', to_jsonb('1 QA Way'::text)) RETURNING id")).rows[0].id;
await pool.query("INSERT INTO crm_property_agents (property_id, user_id, role) VALUES ($1,$2,'Lead')", [a, u]);
await pool.query("INSERT INTO crm_property_agents (property_id, user_id, role) VALUES ($1,$2,'Leasing')", [b, u2]);
console.log('seeded keep=%s delete=%s', a, b);

const scan = await fetch(BASE + '/api/crm/duplicates/scan', { headers: H });
const sj = await scan.json();
const grp = (sj.properties?.duplicates || []).find(d => d.name?.includes('QA r617'));
console.log('scan status', scan.status, '· our group:', JSON.stringify(grp));

const r = await fetch(BASE + '/api/crm/duplicates/merge', {
  method: 'POST', headers: H,
  body: JSON.stringify({ entity: 'property', keepId: a, deleteIds: [b] }),
});
console.log('MERGE property ->', r.status, (await r.text()).slice(0, 300));

// control: does the company branch work?
const c1 = (await pool.query("INSERT INTO crm_companies (name) VALUES ('QA r617 Dup Co') RETURNING id")).rows[0].id;
const c2 = (await pool.query("INSERT INTO crm_companies (name) VALUES ('QA r617 Dup Co') RETURNING id")).rows[0].id;
const rc = await fetch(BASE + '/api/crm/duplicates/merge', {
  method: 'POST', headers: H,
  body: JSON.stringify({ entity: 'company', keepId: c1, deleteIds: [c2] }),
});
console.log('MERGE company  ->', rc.status, (await rc.text()).slice(0, 200));

console.log('rows left: props', (await pool.query("SELECT count(*) FROM crm_properties WHERE name like 'QA r617%'")).rows[0].count,
            '· cos', (await pool.query("SELECT count(*) FROM crm_companies WHERE name like 'QA r617%'")).rows[0].count);
await pool.end();

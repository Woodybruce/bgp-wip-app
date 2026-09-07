// r592 — after Mark self-adds a brand from the global directory, do ALL his
// scoped surfaces see it? The canonical gates are isClientVisibleBrand /
// clientBrandSliceSql; anything that hand-rolls the category slice will hide
// the brand he just added. CONTROLS: an in-slice brand (must pass every
// surface) and an out-of-slice brand he has NOT added (must fail every one).
import pg from 'pg';
const BASE = 'http://127.0.0.1:5000';
const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const ADDED   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0007'; // Testco Jewellers — self-added
const INSLICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003'; // Testco Gym — category slice
const RIVAL   = '88888888-1111-1111-1111-111111111111'; // QA Retail Brand — NOT added

const c = new pg.Client({ connectionString: url });
await c.connect();
const landsec = (await c.query(`SELECT id, crm_extra_brand_ids FROM crm_companies WHERE name='Landsec'`)).rows[0];
console.log(`Landsec extras: ${JSON.stringify(landsec.crm_extra_brand_ids)}`);
if (!(landsec.crm_extra_brand_ids || []).includes(ADDED)) {
  await c.query(`UPDATE crm_companies SET crm_extra_brand_ids = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(crm_extra_brand_ids,'{}') || $1::text))) WHERE id=$2`, [ADDED, landsec.id]);
  console.log('(re-applied the self-add for the probe)');
}
await c.end();

const login = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'mark.warne@landsec.com', password: 'B@nd0077!' }) })).json();
if (!login.token) { console.error('login failed', JSON.stringify(login).slice(0, 200)); process.exit(2); }
const H = { Authorization: `Bearer ${login.token}` };

const SURFACES = (id) => [
  ['crm company detail',      `/api/crm/companies/${id}`],
  ['brand hub detail',        `/api/brands/${id}`],
  ['interactions feed',       `/api/interactions/company/${id}`],
  ['activity feed',           `/api/crm/companies/${id}/activity`],
  ['leasing footprint',       `/api/leasing-schedule/company/${id}`],
  ['turnover detail',         `/api/turnover/company/${id}`],
  ['brand contacts',          `/api/crm/companies/${id}/contacts`],
];
const rows = [];
for (const [tag, ids] of [['ADDED', ADDED], ['IN-SLICE (control)', INSLICE], ['NOT-ADDED (control)', RIVAL]]) {
  for (const [label, path] of SURFACES(ids)) {
    let s = 0, n = null;
    try {
      const r = await fetch(BASE + path, { headers: H });
      s = r.status;
      if (r.ok) { const d = await r.json().catch(() => null); n = Array.isArray(d) ? `${d.length} rows` : (d && (d.name || d.id) ? 'object' : typeof d); }
    } catch (e) { s = -1; n = String(e).slice(0, 60); }
    rows.push({ brand: tag, surface: label, status: s, body: n });
  }
}
console.table(rows);

// And the scoped SEARCH — can he find the brand he just added by name?
for (const [tag, q] of [['ADDED', 'Testco Jewellers'], ['IN-SLICE', 'Testco Gym'], ['NOT-ADDED', 'QA Retail Brand']]) {
  const r = await fetch(`${BASE}/api/crm/search?q=${encodeURIComponent(q)}`, { headers: H });
  const d = await r.json().catch(() => null);
  const flat = JSON.stringify(d || '');
  console.log(`search ${tag} "${q}" -> HTTP ${r.status}; name present: ${flat.includes(q)}`);
}

// r605 — the property-plan colour key read `available_units.marketing_status`
// with LABEL regexes (`/under offer/i`, `/available|vacant/i`) over a column
// the boot canonicaliser guarantees holds CODES (AVA/NEG/SOL/…). Both
// predicates matched nothing, so a vacant unit came back "unknown" (grey)
// instead of "vacant" (rose) on the plan the panel exists to draw.
// Seeds one polygon over a real AVA unit, reads the endpoint, cleans up.
import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5000';
const pool = new Pool({ connectionString: process.env.DATABASE_URL
  || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'ok ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// An available unit with NO tenant on the leasing schedule: pre-fix this fell
// all the way through to "unknown"; it is the plainest vacancy there is.
const { rows: cand } = await pool.query(`
  SELECT au.unit_id, au.marketing_status, pu.property_id
    FROM available_units au
    JOIN property_units pu ON pu.id = au.unit_id
   WHERE au.marketing_status = 'AVA'
     AND NOT EXISTS (
       SELECT 1 FROM leasing_schedule_units lsu
        WHERE lsu.property_id = pu.property_id AND lsu.unit_name = pu.unit_name
          AND lsu.tenant_name IS NOT NULL AND lsu.tenant_name <> '')
   LIMIT 1`);
if (!cand.length) { console.log('no AVA unit without a tenant — cannot probe'); process.exit(1); }
const { unit_id, property_id } = cand[0];

const { rows: planRows } = await pool.query(
  `INSERT INTO property_plans (property_id, floor, storage_key)
   VALUES ($1, 'QA-R605', 'qa/r605/none.png') RETURNING id`, [property_id]);
const planId = planRows[0].id;
const { rows: puRows } = await pool.query(
  `INSERT INTO property_plan_units (plan_id, unit_id, label, polygon)
   VALUES ($1, $2, 'QA-R605 poly', $3::jsonb) RETURNING id`,
  [planId, unit_id, JSON.stringify({ points: [[0, 0], [1, 0], [1, 1]] })]);

try {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }),
  });
  const token = (await login.json()).token;
  const res = await fetch(`${BASE}/api/plans/${planId}/units`, { headers: { Authorization: 'Bearer ' + token } });
  check(`GET /api/plans/:id/units → 200`, res.ok, `HTTP ${res.status}`);
  const body = await res.json();
  const u = (body.units || []).find((x) => x.id === puRows[0].id);
  check('the seeded polygon comes back', !!u);
  if (u) {
    console.log(`     marketing_status=${u.marketing_status} → status="${u.status}"`);
    check('an AVA unit with no tenant colours as VACANT, not unknown',
      u.status === 'vacant', `got "${u.status}"`);
  }
} finally {
  await pool.query('DELETE FROM property_plan_units WHERE plan_id = $1', [planId]);
  await pool.query('DELETE FROM property_plans WHERE id = $1', [planId]);
  await pool.end();
}

console.log(failures === 0 ? '\nr605 plan-colour probe: all green' : `\nr605 plan-colour probe: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

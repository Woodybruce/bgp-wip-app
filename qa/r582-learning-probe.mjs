// r582: does the deal dialog's "What did we learn from this deal?" note
// actually reach the tenant's brand card? Drives the REAL endpoint the
// dialog uses (PUT /api/crm/deals/:id with {status, learning}) as Woody (COM needs a senior),
// then asks brand_signals whether the learning landed. Self-cleaning.
import pg from 'pg';
const BASE = process.env.QA_BASE || 'http://localhost:5000';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const DEAL = 'dddd5582-0000-0000-0000-0000000001';
const LEARNING = 'R582 probe learning — tenant needed 9m rent free to accept ZoneA 300.';
try {
  const { rows: b } = await pool.query(
    `SELECT id, name FROM crm_companies WHERE name IS NOT NULL ORDER BY name LIMIT 1`);
  const tenant = b[0];
  await pool.query(`DELETE FROM crm_deals WHERE id = $1`, [DEAL]);
  await pool.query(`DELETE FROM brand_signals WHERE source = $1`, [`bgp-deal:${DEAL}`]);
  await pool.query(
    `INSERT INTO crm_deals (id, name, status, deal_type, tenant_id, fee, aml_check_completed)
     VALUES ($1, 'R582 probe — completing deal', 'EXC', 'New Letting', $2, 25000, 'YES')`,
    [DEAL, tenant.id]);
  console.log('probe deal at EXC, tenant =', tenant.name, tenant.id);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'woody@brucegillinghampollard.com', password: 'B@nd0077!' }) });
  const auth = await login.json();
  const tok = auth.token;

  // Exactly what the dialog posts when the agent steps a deal to Completed
  // and fills the green "What did we learn?" box (deals.tsx:2332).
  const put = await fetch(`${BASE}/api/crm/deals/${DEAL}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ status: 'COM', learning: LEARNING, changeReason: 'r582 probe' }) });
  console.log('PUT status', put.status);

  await new Promise(r => setTimeout(r, 1500));
  const { rows: sig } = await pool.query(
    `SELECT headline, detail, brand_company_id FROM brand_signals WHERE source = $1`,
    [`bgp-deal:${DEAL}`]);
  const { rows: d } = await pool.query(`SELECT status FROM crm_deals WHERE id = $1`, [DEAL]);
  console.log('deal status now:', d[0]?.status);
  if (sig.length === 0) {
    console.log('RESULT: NO brand_signals row — the learning the agent typed was DISCARDED.');
  } else {
    console.log('RESULT: learning captured ->', JSON.stringify(sig[0]));
  }
} finally {
  await pool.query(`DELETE FROM brand_signals WHERE source = $1`, [`bgp-deal:${DEAL}`]);
  await pool.query(`DELETE FROM crm_deals WHERE id = $1`, [DEAL]);
  await pool.query(`DELETE FROM deal_audit_log WHERE deal_id = $1`, [DEAL]).catch(()=>{});
  await pool.query(`DELETE FROM crm_comps WHERE deal_id = $1`, [DEAL]).catch(()=>{});
  const { rows } = await pool.query(`SELECT count(*)::int n FROM crm_deals WHERE id LIKE 'dddd5582%'`);
  console.log('fixture restored, probe rows left:', rows[0].n);
  await pool.end();
}

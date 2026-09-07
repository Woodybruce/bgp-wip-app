// r585 — prove the two label-vs-code fixes.
//   A) /api/dashboard/my-portfolio (server/crm.ts:9098) excluded dead deals with
//      `NOT IN ('Dead','Draft')` — labels against a codes column, a no-op, so a
//      WITHDRAWN deal (and the property it drags in) stayed on a staff member's
//      own dashboard widget. Now NOT IN ('WIT').
//   B) /api/ai/comp-analysis (server/ai-intelligence.ts:375) selected its comp
//      set with `IN ('Completed','Invoiced','Billed','Exchanged')` — 0 rows
//      always, so comp analysis was fed an EMPTY comp set. Now IN ('EXC','COM','INV').
// Phase 1 (setup) writes the fixture, phase 2 (restore) puts it back.
import pg from 'pg';
const BASE = 'http://127.0.0.1:5000';
const URL = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const c = new pg.Client({ connectionString: URL });
await c.connect();

const WIT_DEAL = '11110000-0000-0000-0000-000000000301'; // Bluewater MSU9 letting (NEG)
const LIVE_DEAL = '11110000-0000-0000-0000-000000000302'; // U124 Gail's letting (SOL)
const AGENT = 'Victoria Broadhead';
let fails = 0;
const check = (name, ok, detail) => { console.log(`  ${ok ? 'ok ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails++; };

if (process.argv.includes('--restore')) {
  await c.query(`UPDATE crm_deals SET status='NEG', internal_agent=NULL WHERE id=$1`, [WIT_DEAL]);
  await c.query(`UPDATE crm_deals SET internal_agent=NULL WHERE id=$1`, [LIVE_DEAL]);
  console.log('[r585] fixture restored');
  await c.end();
  process.exit(0);
}

// ── setup ───────────────────────────────────────────────────────────────────
await c.query(`UPDATE crm_deals SET status='WIT', internal_agent=ARRAY[$2] WHERE id=$1`, [WIT_DEAL, AGENT]);
await c.query(`UPDATE crm_deals SET internal_agent=ARRAY[$2] WHERE id=$1`, [LIVE_DEAL, AGENT]);
console.log('[r585] fixture: MSU9 -> WIT, both deals assigned to', AGENT);

// ── A: my-portfolio ─────────────────────────────────────────────────────────
const lr = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }),
});
const user = await lr.json();
if (!user.token) { console.error('login failed', lr.status); process.exit(2); }

const pr = await fetch(`${BASE}/api/dashboard/my-portfolio`, { headers: { Authorization: `Bearer ${user.token}` } });
const portfolio = await pr.json();
if (!Array.isArray(portfolio)) console.log('   raw:', pr.status, JSON.stringify(portfolio).slice(0, 300));
const allDeals = (Array.isArray(portfolio) ? portfolio : []).flatMap((p) => p.deals || []);
console.log('\nA) /api/dashboard/my-portfolio');
console.log('   properties:', Array.isArray(portfolio) ? portfolio.length : 'ERR', '| deals:', allDeals.map((d) => `${d.name} [${d.status}]`).join(', ') || '(none)');
// CONTROL: the live deal must still be there, else the assertion below is vacuous.
check('live SOL deal is present (control)', allDeals.some((d) => d.id === LIVE_DEAL));
check('withdrawn deal is NOT on the widget', !allDeals.some((d) => d.id === WIT_DEAL),
  allDeals.some((d) => d.id === WIT_DEAL) ? 'MSU9 [WIT] still shown' : '');

// ── B: comp-analysis comp set ───────────────────────────────────────────────
const before = await c.query(`SELECT count(*)::int n FROM crm_deals WHERE status IN ('Completed','Invoiced','Billed','Exchanged')`);
const after = await c.query(`SELECT count(*)::int n FROM crm_deals WHERE status IN ('EXC','COM','INV')`);
console.log('\nB) comp-analysis comp set (server/ai-intelligence.ts:375)');
console.log(`   old label predicate: ${before.rows[0].n} rows | new code predicate: ${after.rows[0].n} rows`);
check('the old label predicate really was empty', before.rows[0].n === 0);
check('the new code predicate returns comps', after.rows[0].n > 0);

console.log(`\n[r585] ${fails} failure(s)`);
await c.end();
process.exit(fails ? 1 : 0);

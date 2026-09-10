// r588 proof harness.
//  BUG 1 — client/src/pages/available-units.tsx: a failed fee-allocation PUT
//     raised its warning toast inside mutationFn, where TOAST_LIMIT=1 let
//     onSuccess's "Unit added" evict it. Proven VISUALLY (see r588-visual3).
//  BUG 2 — a LABEL written into available_units.marketing_status, a codes
//     column (r587's hand-off, the sweep's sixth shape). Proven END TO END
//     over HTTP against POST /api/available-units, plus the two migration
//     handlers' literals, with controls.
// Usage: node qa/r588-probe.mjs [--restore]
import pg from 'pg';
const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:5000';
const c = new pg.Client({ connectionString: url });
await c.connect();
let fails = 0;
const ok = (l, p, d='') => { if (!p) fails++; console.log(`  ${p?'[ok]':'[FAIL]'} ${l}${d?' — '+d:''}`); };
const PROP = 'cccccccc-0000-0000-0000-000000000001';
const MARK = 'QA-R588-LABELWRITE';

if (process.argv.includes('--restore')) {
  const r = await c.query(`delete from available_units where unit_name like $1 returning id`, [`${MARK}%`]);
  const d = await c.query(`delete from crm_deals where name like $1 returning id`, [`${MARK}%`]);
  console.log(`restored: removed ${r.rowCount} unit(s), ${d.rowCount} deal(s)`);
  await c.end(); process.exit(0);
}

const login = await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({ username:'victoria@brucegillinghampollard.com', password:'B@nd0077!' }) });
const auth = await login.json().catch(()=>null);
if (!auth?.token) { console.log(`login failed ${login.status}`); await c.end(); process.exit(1); }
const H = { Authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' };

const availableCount = async () => {
  // The exact predicate routes.ts:177 uses for "(N available)".
  const { rows } = await c.query(
    `SELECT (SELECT COUNT(*)::int FROM available_units au WHERE au.property_id=$1 AND au.marketing_status='AVA') AS ava,
            (SELECT COUNT(*)::int FROM available_units au WHERE au.property_id=$1) AS total`, [PROP]);
  return rows[0];
};

console.log('\n== r588 BUG 2 · a LABEL posted into the codes column');
const before = await availableCount();
console.log(`   before: ${before.ava} AVA of ${before.total} rows on the property`);

// The exact body the unified add-unit dialog sent before the fix.
const post = async (name, status) => {
  const r = await fetch(`${BASE}/api/available-units`, { method:'POST', headers:H, body: JSON.stringify({
    propertyId: PROP, unitName: name, marketingStatus: status, sqft: 1200, askingRent: 55 }) });
  const j = await r.json().catch(()=>({}));
  return { status: r.status, id: j?.id, alreadyListed: j?.alreadyListed };
};
const stored = async (id) => (await c.query(`select marketing_status from available_units where id=$1`, [id])).rows[0]?.marketing_status;

const a = await post(`${MARK} label`, 'Available');
ok('POST with the label "Available" is accepted', a.status === 200 || a.status === 201, `HTTP ${a.status}`);
const aStatus = await stored(a.id);
ok('the row lands as the CODE, not the label', aStatus === 'AVA', `stored "${aStatus}"`);
const afterA = await availableCount();
ok("routes.ts:177's AVA available_count sees it", afterA.ava === before.ava + 1, `${before.ava} -> ${afterA.ava}`);

// CONTROLS — the fix must not be a blanket stamp.
const b = await post(`${MARK} neg`, 'Under Negotiation');
ok('CONTROL a NEG label canonicalises to NEG, not AVA', (await stored(b.id)) === 'NEG', `stored "${await stored(b.id)}"`);
const d0 = await post(`${MARK} code`, 'HOT');
ok('CONTROL an already-canonical code is passed through', (await stored(d0.id)) === 'HOT', `stored "${await stored(d0.id)}"`);
const e0 = await post(`${MARK} unknown`, 'Something Else');
ok('CONTROL an unrecognised value is left alone, not dropped', (await stored(e0.id)) === 'Something Else', `stored "${await stored(e0.id)}"`);
const afterAll = await availableCount();
ok('CONTROL the NEG/HOT/unknown rows do NOT inflate available_count', afterAll.ava === before.ava + 1, `${before.ava} -> ${afterAll.ava}`);

// PATCH path — updateAvailableUnit shares the boundary.
const patch = await fetch(`${BASE}/api/available-units/${a.id}`, { method:'PATCH', headers:H, body: JSON.stringify({ marketingStatus: 'Solicitors' }) });
ok('PATCH with a label is accepted', patch.ok, `HTTP ${patch.status}`);
ok('PATCH canonicalises too', (await stored(a.id)) === 'SOL', `stored "${await stored(a.id)}"`);

// The two migration handlers' own literals — read the source, not the DB,
// since they only fire on a legacy fixture.
const src = await import('fs').then(m => m.readFileSync('server/routes.ts','utf8'));
ok('no `marketingStatus: "Available"` literal remains in routes.ts', !/marketingStatus: "Available"/.test(src));
const dlg = await import('fs').then(m => m.readFileSync('client/src/components/unified-add-unit-dialog.tsx','utf8'));
ok('no `marketingStatus: "Available"` literal remains in the add-unit dialog', !/marketingStatus: "Available"/.test(dlg));

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'} — run with --restore to clean up`);
await c.end();
process.exit(fails ? 1 : 0);

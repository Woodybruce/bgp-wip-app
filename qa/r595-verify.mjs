// r595: the deferred 'Available' literal, end to end through the real
// endpoint. POST /api/admin/letting-tracker-focus's PULL-IN pass INSERTed
// marketing_status as the literal 'Available' with a raw pool.query,
// bypassing canonicaliseUnitStatus — a LABEL into the codes column, while
// the same file's two other pull-in paths already went through
// storage.createAvailableUnit with 'AVA'.
//
// DESTRUCTIVE: dryRun:false also runs the PRUNE pass. Restore the fixture
// (bash qa/run-smoke.sh) after running this.
import pg from 'pg';
const BASE = 'http://127.0.0.1:5000';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
let pass = 0, fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${msg}`); ok ? pass++ : fail++; };

const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'woody@brucegillinghampollard.com', password: 'B@nd0077!' }) });
const { token } = await lr.json();
if (!token) throw new Error('admin login failed');
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

// Give one strategy-board row with no tracker listing some activity, so the
// pull-in pass has exactly one candidate we can name.
const cand = (await c.query(`
  SELECT ls.id, ls.unit_name, ls.tenancy_unit_id
    FROM leasing_schedule_units ls
    JOIN tenancy_schedule_units ts ON ts.id = ls.tenancy_unit_id
   WHERE NOT EXISTS (SELECT 1 FROM available_units au WHERE au.tenancy_unit_id = ls.tenancy_unit_id)
     AND coalesce(ls.updates,'') = '' AND coalesce(ls.optimum_target,'') = '' AND coalesce(ls.target_brands,'') = ''
   ORDER BY ls.unit_name LIMIT 1`)).rows[0];
if (!cand) throw new Error('no idle strategy-board row to use as a pull-in candidate');
console.log('   candidate:', cand.unit_name, cand.tenancy_unit_id);
await c.query(`UPDATE leasing_schedule_units SET updates = $1 WHERE id = $2`, ['QA-R595 pull-in probe', cand.id]);

const dry = await (await fetch(`${BASE}/api/admin/letting-tracker-focus`, { method: 'POST', headers: auth, body: JSON.stringify({ dryRun: true }) })).json();
console.log('   dry run:', JSON.stringify({ scanned: dry.scanned, keep: dry.keep, prune: dry.prune, pullIn: dry.pullIn }));
check(dry.pullIn >= 1 && (dry.pullInSample || []).some(s => String(s).includes(cand.unit_name)),
  `BASELINE not vacuous: the dry run lists our candidate among ${dry.pullIn} pull-in(s)`);

const live = await (await fetch(`${BASE}/api/admin/letting-tracker-focus`, { method: 'POST', headers: auth, body: JSON.stringify({ dryRun: false }) })).json();
console.log('   live run:', JSON.stringify({ pruned: live.pruned, added: live.added, migrated: live.migrated }));

const made = (await c.query(`SELECT unit_name, marketing_status FROM available_units WHERE tenancy_unit_id = $1`, [cand.tenancy_unit_id])).rows;
console.log('   pulled-in row(s):', JSON.stringify(made));
check(made.length === 1, `the pull-in created exactly one tracker listing for the candidate (got ${made.length})`);
const status = made[0]?.marketing_status ?? null;
check(status !== 'Available', `it did NOT bank the label 'Available' (got ${JSON.stringify(status)})`);
const CODES = ['OPP','AVA','NEG','HOT','SOL','EXC','COM','WIT','INV'];
check(CODES.includes(String(status)), `it banked a LETTING_STATUSES code (got ${JSON.stringify(status)})`);
check(status === 'AVA', `and specifically AVA — the code the old 'Available' literal meant (got ${JSON.stringify(status)})`);

// CONTROL, near miss: the pull-in must not have blanket-stamped AVA over
// listings that already carried another code. Nothing on the board should
// read as a label either.
const stray = (await c.query(`SELECT DISTINCT marketing_status FROM available_units WHERE marketing_status IS NOT NULL AND marketing_status <> '' AND marketing_status <> ALL($1::text[])`, [CODES])).rows;
check(stray.length === 0, `CONTROL: no non-code status anywhere in available_units after the run (found ${JSON.stringify(stray.map(r => r.marketing_status))})`);
const census = (await c.query(`SELECT marketing_status, count(*)::int n FROM available_units GROUP BY 1 ORDER BY 2 DESC`)).rows;
console.log('   post-run census:', JSON.stringify(census));

console.log(`\n${pass} PASS / ${fail} FAIL`);
console.log('   !! fixture is now PRUNED — run `bash qa/run-smoke.sh` to restore, then re-apply qa/seed-personas.sql');
await c.end();
process.exit(fail ? 1 : 0);

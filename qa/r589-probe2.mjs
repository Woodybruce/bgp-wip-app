// r589 bug 2, predicate-level proof WITH controls (no user surface writes
// 'Active' — this is a boot-time normalisation hook, so there is nothing to
// verify visually). Insert deals at the two legacy labels plus two controls,
// run the two statements exactly as server/index.ts now has them, and assert
// each lands on a CODE.
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const mk = async (name, status) => {
  const r = await c.query(`INSERT INTO crm_deals (name, status, deal_type) VALUES ($1,$2,'New Letting') RETURNING id`, [name, status]);
  return r.rows[0].id;
};
const ids = {
  solicitors: await mk('QA-R589 Solicitors', 'Solicitors'),
  active:     await mk('QA-R589 Active', 'Active'),
  ctlCode:    await mk('QA-R589 already NEG', 'NEG'),      // control: must be untouched
  ctlOther:   await mk('QA-R589 unknown', 'Something Else'), // control: must be untouched
};
const f1 = await c.query(`UPDATE crm_deals SET status = 'SOL' WHERE LOWER(TRIM(status)) IN ('solicitors', 'sols')`);
const f2 = await c.query(`UPDATE crm_deals SET status = 'LIVE' WHERE LOWER(TRIM(status)) = 'active'`);
console.log(`statusFix1 touched ${f1.rowCount} row(s); statusFix2 touched ${f2.rowCount} row(s)`);
const got = {};
for (const [k, id] of Object.entries(ids)) {
  got[k] = (await c.query('SELECT status FROM crm_deals WHERE id = $1', [id])).rows[0].status;
  console.log(`  ${k.padEnd(11)} -> ${JSON.stringify(got[k])}`);
}
await c.query(`DELETE FROM crm_deals WHERE name LIKE 'QA-R589 %'`);
const left = (await c.query(`SELECT count(*) FROM crm_deals WHERE name LIKE 'QA-R589 %'`)).rows[0].count;
const fail = [];
if (got.solicitors !== 'SOL') fail.push(`'Solicitors' landed on ${got.solicitors}, not the code SOL`);
if (got.active !== 'LIVE') fail.push(`'Active' landed on ${got.active}, not the code LIVE`);
if (got.ctlCode !== 'NEG') fail.push(`CONTROL failed: an already-canonical NEG was rewritten to ${got.ctlCode}`);
if (got.ctlOther !== 'Something Else') fail.push(`CONTROL failed: an unrecognised status was rewritten to ${got.ctlOther}`);
if (left !== '0') fail.push(`cleanup left ${left} QA row(s)`);
console.log(fail.length ? `FAIL: ${fail.join(' | ')}` : 'PASS — both legacy labels land on codes, both controls untouched, fixture clean');
await c.end();

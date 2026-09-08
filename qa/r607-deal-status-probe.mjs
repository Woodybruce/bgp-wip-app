// r607 — the two ChatBGP write doors this round fixed, driven through the real
// dispatchers (executeCrmToolRaw = desktop, handleCrmToolCall = mobile twin).
//
// 1) `crm_deals.status` is the CODES column and the firm's WIP hero is a raw
//    SQL code predicate (hr-routes.ts: status IN ('AVA','NEG','HOT','SOL',
//    'EXC','COM')). create_deal / update_deal / bulk_update_crm and the
//    Models-page agent took the model's free-text status straight to the DB,
//    and their schemas said "Status of the deal" / "e.g. { status: 'Under
//    Offer' }". A label there drops the deal out of WIP pounds AND the count.
// 2) The tenancy schedule is the god of truth and every other write door on
//    it fans the status out to available_units / leasing_schedule_units /
//    crm_deals (unit-mirror). upsert_tenancy_schedule didn't.
//
// Run: npx tsx --env-file=.env qa/r607-deal-status-probe.mjs
import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;

const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const pool = new Pool({ connectionString: url });
const WIP = `status IN ('AVA','NEG','HOT','SOL','EXC','COM')`;

const { executeCrmToolRaw, handleCrmToolCall } = await import('../server/chatbgp.ts');
const fakeReq = { session: {}, headers: {}, user: null };

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'ok ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const dealStatus = async (id) =>
  (await pool.query(`SELECT status FROM crm_deals WHERE id = $1`, [id])).rows[0]?.status;
const inWip = async (id) =>
  (await pool.query(`SELECT 1 FROM crm_deals WHERE id = $1 AND ${WIP}`, [id])).rows.length === 1;

const dealIds = [];
let tenancy = null, origTenancy = null, origAu = null, origLs = null;

try {
  // ---- 1. deal-status doors -------------------------------------------
  const created = await executeCrmToolRaw(
    'create_deal',
    { name: 'r607 probe — created under offer', status: 'Under Offer', fee: 1234 },
    fakeReq,
  );
  const dealId = created?.data?.id;
  check('desktop create_deal returns an id', !!dealId, String(dealId));
  if (dealId) dealIds.push(dealId);
  check('desktop create_deal canonicalises "Under Offer" -> SOL',
    (await dealStatus(dealId)) === 'SOL', `stored ${JSON.stringify(await dealStatus(dealId))}`);
  check('the new deal counts toward the firm WIP hero', await inWip(dealId));

  await executeCrmToolRaw('update_deal', { id: dealId, status: 'exchanged' }, fakeReq);
  check('desktop update_deal canonicalises "exchanged" -> EXC',
    (await dealStatus(dealId)) === 'EXC', `stored ${JSON.stringify(await dealStatus(dealId))}`);

  await executeCrmToolRaw('bulk_update_crm',
    { entityType: 'deal', ids: [dealId], updates: { status: 'Under Offer' } }, fakeReq);
  check('bulk_update_crm canonicalises a deal status label -> SOL',
    (await dealStatus(dealId)) === 'SOL', `stored ${JSON.stringify(await dealStatus(dealId))}`);

  // Mobile twin. summaryHelper needs a keyed AI call it cannot make here —
  // the write lands before it, so swallow only that.
  await handleCrmToolCall('update_deal', { id: dealId, status: 'Negotiating' },
    fakeReq, { messages: [] }, {}, { id: 'probe', name: 'update_deal' })
    .catch((e) => console.log(`    (summary helper skipped: ${e.message})`));
  check('mobile update_deal canonicalises "Negotiating" -> NEG',
    (await dealStatus(dealId)) === 'NEG', `stored ${JSON.stringify(await dealStatus(dealId))}`);

  // Out-of-vocabulary values are stored verbatim, not dropped — 'ARCH' is a
  // real stored non-code the WIP-archive exclusions rely on.
  await executeCrmToolRaw('update_deal', { id: dealId, status: 'ARCH' }, fakeReq);
  check(`'ARCH' is left alone, not coerced`,
    (await dealStatus(dealId)) === 'ARCH', `stored ${JSON.stringify(await dealStatus(dealId))}`);

  // PRE-FIX shape, asserted directly: a raw label is invisible to the hero.
  const raw = await pool.query(
    `INSERT INTO crm_deals (name, status, fee) VALUES ($1,$2,$3) RETURNING id`,
    ['r607 probe — raw label (pre-fix shape)', 'Under Offer', 5678]);
  dealIds.push(raw.rows[0].id);
  check('pre-fix shape: a label in crm_deals.status hides the deal from WIP',
    !(await inWip(raw.rows[0].id)));

  // ---- 2. upsert_tenancy_schedule fans out ----------------------------
  // A unit with both projection rows linked, so the fan-out has somewhere to land.
  const { rows: [t] } = await pool.query(
    `SELECT ts.id, ts.property_id, ts.status,
            au.id AS au_id, au.marketing_status AS au_status,
            ls.id AS ls_id, ls.status AS ls_status
       FROM tenancy_schedule_units ts
       JOIN available_units au ON au.tenancy_unit_id = ts.id
       JOIN leasing_schedule_units ls ON ls.tenancy_unit_id = ts.id
      WHERE ts.status = 'Vacant'
      LIMIT 1`);
  if (!t) {
    console.log('  --   no linked vacant tenancy unit in the fixture; fan-out leg skipped');
  } else {
    tenancy = t.id; origTenancy = t.status; origAu = t.au_status; origLs = t.ls_status;
    console.log(`  unit ${t.id}: tenancy ${t.status} / tracker ${t.au_status} / leasing ${t.ls_status}`);
    await executeCrmToolRaw('upsert_tenancy_schedule',
      { propertyId: t.property_id, rows: [{ id: t.id, status: 'Under Offer', tenantName: 'r607 probe tenant' }] },
      fakeReq);
    const after = await pool.query(
      `SELECT (SELECT status FROM tenancy_schedule_units WHERE id = $1) AS ts,
              (SELECT marketing_status FROM available_units WHERE id = $2) AS au,
              (SELECT status FROM leasing_schedule_units WHERE id = $3) AS ls`,
      [t.id, t.au_id, t.ls_id]);
    const a = after.rows[0];
    check('upsert_tenancy_schedule writes the spine', a.ts === 'Under Offer', `ts=${a.ts}`);
    check('...and fans out to the Letting Tracker (SOL)', a.au === 'SOL', `available_units=${a.au}`);
    check(`...and to the client's leasing board (Under Offer)`,
      a.ls === 'Under Offer', `leasing_schedule_units=${a.ls}`);
  }
} finally {
  if (dealIds.length) await pool.query(`DELETE FROM crm_deals WHERE id = ANY($1::text[])`, [dealIds]);
  if (tenancy) {
    await pool.query(`UPDATE tenancy_schedule_units SET status = $2, tenant_name = NULL WHERE id = $1`, [tenancy, origTenancy]);
    await pool.query(`UPDATE available_units SET marketing_status = $2 WHERE tenancy_unit_id = $1`, [tenancy, origAu]);
    await pool.query(`UPDATE leasing_schedule_units SET status = $2 WHERE tenancy_unit_id = $1`, [tenancy, origLs]);
    console.log(`  restored ${tenancy} to ${origTenancy} / ${origAu} / ${origLs}`);
  }
  await pool.end();
}

console.log(failures ? `\nr607 probe: ${failures} FAILURE(S)` : '\nr607 probe: all green');
process.exit(failures ? 1 : 0);

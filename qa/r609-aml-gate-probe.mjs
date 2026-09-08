// r609 — the AML counterparty gate is enforced on the HTTP doors only.
//
// deal-gates.ts names its callers: PUT /api/crm/deals/:id, the deal-stages
// SOL+ transition, the available-units promote (warn-but-allow) and the
// bulk-status update. ChatBGP's `update_deal` is a FIFTH door: it writes
// `status` straight through storage.updateCrmDeal, which canonicalises the
// vocabulary (r606) but runs no gate — so "move the Bluewater deal to
// solicitors" in chat lands SOL with no counterparty KYC check, no 409 and
// no MLRO override recorded.
//
// Run: npx tsx --env-file=.env qa/r609-aml-gate-probe.mjs
import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;

const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const pool = new Pool({ connectionString: url });

const { executeCrmToolRaw, handleCrmToolCall } = await import('../server/chatbgp.ts');
const { checkCounterpartyAml } = await import('../server/deal-gates.ts');
const fakeReq = { session: {}, headers: {}, user: null };

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'ok ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const dealStatus = async (id) =>
  (await pool.query(`SELECT status FROM crm_deals WHERE id = $1`, [id])).rows[0]?.status;

const dealIds = [];
try {
  // A counterparty the gate must refuse: kyc_status is not 'approved'.
  const ll = (await pool.query(
    `SELECT id, name, kyc_status FROM crm_companies
      WHERE kyc_status IS DISTINCT FROM 'approved' ORDER BY name LIMIT 1`)).rows[0];
  check('fixture has a non-approved counterparty', !!ll, ll && `${ll.name} (${ll.kyc_status ?? 'no checks run'})`);

  const gate = await checkCounterpartyAml({ landlordId: ll.id });
  check('the gate itself refuses that counterparty',
    gate.hasCounterparties && gate.notReady.length === 1, gate.notReady.map(n => `${n.name}: ${n.reason}`).join(', '));

  const refusedBy = (out) => {
    const txt = JSON.stringify(out ?? {});
    return /AML/i.test(txt);
  };

  for (const [label, drive] of [
    ['executeCrmToolRaw (desktop)', (fn, args) => executeCrmToolRaw(fn, args, fakeReq)],
    ['handleCrmToolCall (mobile twin)', (fn, args) => handleCrmToolCall(fn, args, fakeReq)],
  ]) {
    const { rows } = await pool.query(
      `INSERT INTO crm_deals (name, status, deal_type, landlord_id)
       VALUES ($1, 'NEG', 'Letting', $2) RETURNING id`,
      [`QA-R609 AML gate — ${label}`, ll.id]);
    const id = rows[0].id;
    dealIds.push(id);

    let refused = false;
    try { refused = refusedBy(await drive('update_deal', { id, status: 'SOL' })); }
    catch (e) { refused = /AML/i.test(e?.message || ''); }
    check(`${label}: update_deal to SOL refused, deal stays NEG`,
      refused && (await dealStatus(id)) === 'NEG', `refused=${refused} status=${await dealStatus(id)}`);

    // An UNGATED move must still go straight through — the gate is SOL+ only.
    try { await drive('update_deal', { id, status: 'HOT' }); } catch (e) { /* reported below */ }
    check(`${label}: update_deal to HOT (ungated) still lands`,
      (await dealStatus(id)) === 'HOT', `status=${await dealStatus(id)}`);

    // MLRO override is the documented way past the gate — it must still work.
    await pool.query(`UPDATE crm_deals SET aml_check_completed = 'YES' WHERE id = $1`, [id]);
    try { await drive('update_deal', { id, status: 'SOL' }); } catch (e) { /* reported below */ }
    check(`${label}: MLRO override still reaches SOL`,
      (await dealStatus(id)) === 'SOL', `status=${await dealStatus(id)}`);
  }

  // bulk_update_crm — the 100-at-a-time door. Its HTTP twin gates; this one
  // must skip the blocked deal and still move the clean one.
  {
    const mk = async (name, aml) => {
      const { rows } = await pool.query(
        `INSERT INTO crm_deals (name, status, deal_type, landlord_id, aml_check_completed)
         VALUES ($1, 'NEG', 'Letting', $2, $3) RETURNING id`, [name, ll.id, aml]);
      dealIds.push(rows[0].id);
      return rows[0].id;
    };
    const blockedId = await mk('QA-R609 bulk blocked', null);
    const clearedId = await mk('QA-R609 bulk cleared', 'YES');
    const out = await executeCrmToolRaw('bulk_update_crm',
      { entityType: 'deal', ids: [blockedId, clearedId], updates: { status: 'SOL' } }, fakeReq);
    check('bulk_update_crm: blocked deal stays NEG',
      (await dealStatus(blockedId)) === 'NEG', `status=${await dealStatus(blockedId)}`);
    check('bulk_update_crm: cleared deal still reaches SOL',
      (await dealStatus(clearedId)) === 'SOL', `status=${await dealStatus(clearedId)}`);
    check('bulk_update_crm: names the blocked deal back to the model',
      !!out?.data?.blockedByAml?.length, JSON.stringify(out?.data?.blockedByAml || null));
  }
} finally {
  for (const id of dealIds) await pool.query(`DELETE FROM crm_deals WHERE id = $1`, [id]);
  await pool.end();
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
process.exit(failures ? 1 : 0);

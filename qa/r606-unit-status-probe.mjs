// r606 — proves ChatBGP's update_available_unit no longer writes a LABEL into
// available_units.marketing_status (a CODES column), and that a unit it touches
// stays visible to the client availability queries (WHERE marketing_status IN
// ('AVA','NEG')).
import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;

const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const pool = new Pool({ connectionString: url });

const { executeCrmToolRaw, handleCrmToolCall } = await import('../server/chatbgp.ts');

const fakeReq = { session: {}, headers: {}, user: null };

const { rows: [unit] } = await pool.query(
  `SELECT au.id, au.unit_name, au.marketing_status, au.property_id
     FROM available_units au
    WHERE au.marketing_status = 'AVA'
    ORDER BY au.created_at DESC LIMIT 1`);
if (!unit) { console.error('no AVA unit in fixture'); process.exit(2); }
const original = unit.marketing_status;
console.log(`unit ${unit.unit_name} (${unit.id}) starts at ${original}`);

async function statusOf() {
  const { rows } = await pool.query(`SELECT marketing_status FROM available_units WHERE id = $1`, [unit.id]);
  return rows[0]?.marketing_status;
}
async function visibleInAvailability() {
  const { rows } = await pool.query(
    `SELECT 1 FROM available_units WHERE id = $1 AND marketing_status IN ('AVA','NEG')`, [unit.id]);
  return rows.length === 1;
}

let failures = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? 'ok ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// Desktop dispatcher — the label the tool schema used to advertise.
await executeCrmToolRaw('update_available_unit', { id: unit.id, marketingStatus: 'Under Offer' }, fakeReq);
let s = await statusOf();
check('desktop update_available_unit canonicalises "Under Offer"', s === 'SOL', `stored ${JSON.stringify(s)}`);

// Back to a live status via a label, and confirm it stays on the availability list.
await executeCrmToolRaw('update_available_unit', { id: unit.id, marketingStatus: 'Available' }, fakeReq);
s = await statusOf();
check('desktop update_available_unit canonicalises "Available"', s === 'AVA', `stored ${JSON.stringify(s)}`);
check('unit stays visible to the AVA/NEG availability queries', await visibleInAvailability());

// Mobile twin.
await handleCrmToolCall('update_available_unit', { id: unit.id, marketingStatus: 'Under Negotiation' }, fakeReq, {}, {}, { id: 'probe', name: 'update_available_unit' });
s = await statusOf();
check('mobile update_available_unit canonicalises "Under Negotiation"', s === 'NEG', `stored ${JSON.stringify(s)}`);

// A value outside the vocabulary is still stored verbatim (data is not dropped).
await executeCrmToolRaw('update_available_unit', { id: unit.id, marketingStatus: 'On Hold' }, fakeReq);
s = await statusOf();
check('an unknown status is stored verbatim, not dropped', s === 'On Hold', `stored ${JSON.stringify(s)}`);

await pool.query(`UPDATE available_units SET marketing_status = $1 WHERE id = $2`, [original, unit.id]);
console.log(`restored to ${original}`);
await pool.end();
console.log(failures ? `\nr606 unit-status probe: ${failures} FAILURE(S)` : '\nr606 unit-status probe: all green');
process.exit(failures ? 1 : 0);

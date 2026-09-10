// r594 probe — the asset brief's four tracker queries are blind to the code HOT.
//
// property-asset-brief.ts:1072, 1099, 1330, 1376 all gate "units actively in
// play" with  lower(marketing_status) ~ '(neg|offer|sol|exc|hots|terms)'.
// available_units.marketing_status holds CODES (guaranteed by the boot
// canonicaliser and, since r588, canonicalised on write). The code is HOT —
// three letters — and the alternation offers 'hots', which needs a trailing
// s. So a unit at Heads of Terms, the hottest pre-solicitors stage, matches
// NOTHING: it is absent from the tracker-parties group (nobody is named as
// negotiating it) AND absent from the "link the brand" gap list built to
// catch exactly that silence.
//
// Runs OLD and NEW predicates side by side over the real fixture, with
// near-miss controls, then restores.
import pg from 'pg';
const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const PROP = 'cccccccc-0000-0000-0000-000000000001'; // Bluewater
const OLD = `'(neg|offer|sol|exc|hots|terms)'`;
const NEW = `'(neg|offer|hot|sol|exc|terms)'`;
const c = new pg.Client({ connectionString: url });
await c.connect();
let pass = 0, fail = 0;
const ck = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); ok ? pass++ : fail++; };

// ── 1. The predicate itself, code by code. No fixture involved.
const codes = ['NEG', 'HOT', 'SOL', 'EXC', 'AVA', 'OPP', 'WIT'];
const r1 = await c.query(
  `SELECT x AS code, lower(x) ~ ${OLD} AS old_m, lower(x) ~ ${NEW} AS new_m FROM unnest($1::text[]) x`, [codes]);
console.log('\n── 1. predicate over the canonical codes');
for (const r of r1.rows) console.log(`   ${r.code.padEnd(4)} old=${r.old_m ? 'match' : '  -  '}  new=${r.new_m ? 'match' : '  -  '}`);
const m = Object.fromEntries(r1.rows.map(r => [r.code, r]));
ck(m.HOT.old_m === false && m.HOT.new_m === true, 'HOT: invisible to the old regex, matched by the new one');
for (const k of ['NEG', 'SOL', 'EXC']) ck(m[k].old_m && m[k].new_m, `${k}: matched by BOTH (in-play codes unchanged)`);
for (const k of ['AVA', 'OPP', 'WIT']) ck(!m[k].old_m && !m[k].new_m, `CONTROL ${k}: matched by NEITHER (the fix did not widen to every unit)`);
// The legacy labels the old regex was written for must still work.
const labels = ['Heads of Terms', 'HOTs', 'In Negotiation', 'Available'];
const r1b = await c.query(`SELECT x AS l, lower(x) ~ ${NEW} AS new_m FROM unnest($1::text[]) x`, [labels]);
console.log('   legacy labels under the new regex: ' + r1b.rows.map(r => `${r.l}=${r.new_m}`).join(', '));
ck(r1b.rows.find(r => r.l === 'Heads of Terms').new_m && r1b.rows.find(r => r.l === 'HOTs').new_m,
   'legacy "Heads of Terms"/"HOTs" labels still match the new regex');
ck(!r1b.rows.find(r => r.l === 'Available').new_m, 'CONTROL: legacy "Available" label still matches neither');

// ── 2. The gap list, over a REAL Bluewater unit stepped to HOT.
const gap = (rx) => c.query(
  `SELECT au.unit_name FROM available_units au
    WHERE au.property_id = $1 AND lower(COALESCE(au.marketing_status,'')) ~ ${rx}
      AND au.tenant_company_id IS NULL AND au.deal_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM unit_offers o WHERE o.unit_id = au.id AND o.company_id IS NOT NULL)
    ORDER BY au.unit_name`, [PROP]);
const cand = await c.query(
  `SELECT id, unit_name, marketing_status FROM available_units
    WHERE property_id = $1 AND marketing_status = 'AVA'
      AND tenant_company_id IS NULL AND deal_id IS NULL LIMIT 1`, [PROP]);
const u = cand.rows[0];
console.log(`\n── 2. gap list ("link the brand"), unit ${u.unit_name} (${u.id})`);
await c.query(`UPDATE available_units SET marketing_status = 'NEG' WHERE id = $1`, [u.id]);
const negOld = (await gap(OLD)).rows.map(r => r.unit_name);
ck(negOld.includes(u.unit_name), `at NEG the unit IS on the gap list under the old regex (${negOld.length} rows) — baseline not vacuous`);
await c.query(`UPDATE available_units SET marketing_status = 'HOT' WHERE id = $1`, [u.id]);
const hotOld = (await gap(OLD)).rows.map(r => r.unit_name);
const hotNew = (await gap(NEW)).rows.map(r => r.unit_name);
ck(!hotOld.includes(u.unit_name), `stepped to HOT it VANISHES from the gap list under the old regex (${hotOld.length} rows) — THE BUG`);
ck(hotNew.includes(u.unit_name), `and is BACK under the new regex (${hotNew.length} rows) — THE FIX`);
await c.query(`UPDATE available_units SET marketing_status = 'AVA' WHERE id = $1`, [u.id]);
const avaNew = (await gap(NEW)).rows.map(r => r.unit_name);
ck(!avaNew.includes(u.unit_name), 'CONTROL: back at AVA it is off the gap list under the new regex too');

// ── 3. Tracker parties — who is named as negotiating the unit.
const parties = (rx) => c.query(
  `WITH active_units AS (
     SELECT au.id, au.unit_name, au.tenant_company_id, au.deal_id FROM available_units au
      WHERE au.property_id = $1 AND lower(COALESCE(au.marketing_status,'')) ~ ${rx})
   SELECT co.name FROM active_units u JOIN crm_companies co ON co.id = u.tenant_company_id`, [PROP]);
const brand = (await c.query(`SELECT id, name FROM crm_companies LIMIT 1`)).rows[0];
await c.query(`UPDATE available_units SET marketing_status='HOT', tenant_company_id=$2 WHERE id=$1`, [u.id, brand.id]);
const pOld = (await parties(OLD)).rows.map(r => r.name);
const pNew = (await parties(NEW)).rows.map(r => r.name);
console.log(`\n── 3. tracker parties, brand "${brand.name}" on a HOT unit`);
ck(!pOld.includes(brand.name), `brand NOT named as a party under the old regex (${pOld.length} rows) — the unit is in neither group`);
ck(pNew.includes(brand.name), `brand named under the new regex (${pNew.length} rows)`);

// ── restore
await c.query(`UPDATE available_units SET marketing_status = $2, tenant_company_id = NULL WHERE id = $1`, [u.id, u.marketing_status]);
const back = await c.query(`SELECT marketing_status, tenant_company_id FROM available_units WHERE id = $1`, [u.id]);
ck(back.rows[0].marketing_status === u.marketing_status && back.rows[0].tenant_company_id === null, 'fixture restored');
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} pass, ${fail} fail`);
await c.end();
process.exit(fail === 0 ? 0 : 1);

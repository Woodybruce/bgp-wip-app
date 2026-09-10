// r586 proof harness — both fixes are the LEGACY-LABEL-vs-CODE class and
// neither has a locally renderable surface (pathway stage 1 and ChatBGP both
// need AI keys), so they are proven at the data / context-string level WITH
// CONTROLS: without the control the "and the bad row is absent" assertion is
// vacuous.
//   1. server/property-pathway.ts:2667 — pathway tenancy vacancy
//   2. server/chatbgp.ts:1907 — ChatBGP firm "Pipeline snapshot"
// Usage: node qa/r586-probe.mjs [--restore]
import pg from 'pg';
import { legacyToCode } from '../shared/deal-status.ts';

const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const c = new pg.Client({ connectionString: url });
await c.connect();
let fails = 0;
const ok = (label, pass, detail = '') => { if (!pass) fails++; console.log(`  ${pass ? '[ok]' : '[FAIL]'} ${label}${detail ? ' — ' + detail : ''}`); };

const PROP = 'cccccccc-0000-0000-0000-000000000001';
const UNIT_CTRL = '6341f12a-3887-445e-9a90-85208a78ecad'; // L022 Bluewater, AVA, no deal

if (process.argv.includes('--restore')) {
  await c.query(`update available_units set marketing_status='AVA' where id=$1`, [UNIT_CTRL]);
  console.log('restored: L022 marketing_status -> AVA');
  await c.end(); process.exit(0);
}

// ── 1. pathway tenancy vacancy ─────────────────────────────────────────
const oldPred = (ms) => (ms || 'Available').toLowerCase() === 'available';
const newPred = (ms) => (legacyToCode(ms) || 'AVA') === 'AVA';
const derive = (units, pred) => {
  const vacant = units.filter(u => pred(u.marketing_status)).length;
  const let_ = units.length - vacant;
  return { vacant, status: vacant === units.length ? 'vacant' : let_ === units.length ? 'let' : 'mixed' };
};
let { rows: units } = await c.query(
  `select id, unit_name, marketing_status from available_units where property_id=$1 order by unit_name limit 50`, [PROP]);
console.log(`\n-- pathway tenancy (Bluewater, ${units.length} units, statuses ${[...new Set(units.map(u => u.marketing_status))].join('/')})`);
const before = { old: derive(units, oldPred), new: derive(units, newPred) };
console.log(`   old label predicate: ${JSON.stringify(before.old)}`);
console.log(`   new code  predicate: ${JSON.stringify(before.new)}`);
ok('old predicate saw ZERO vacant units (the bug)', before.old.vacant === 0, `vacant=${before.old.vacant}`);
ok('old predicate therefore called an all-marketed scheme "let"', before.old.status === 'let');
ok('new predicate counts the marketed units', before.new.vacant > 0, `vacant=${before.new.vacant}/${units.length}`);
ok('new predicate calls a part-let scheme "mixed"', before.new.status === 'mixed', before.new.status);

// CONTROL: step every unit on the property to AVA — the new predicate must
// then say "vacant", the old one still "let". Without this the "mixed" above
// could be an accident of the fixture rather than the predicate working.
const { rows: allAva } = await c.query(
  `select id, unit_name, 'AVA' as marketing_status from available_units where property_id=$1 limit 50`, [PROP]);
const ctrl = derive(allAva, newPred);
ok('CONTROL all-AVA scheme reads "vacant" under the new predicate', ctrl.status === 'vacant', JSON.stringify(ctrl));
ok('CONTROL all-AVA scheme still reads "let" under the old one', derive(allAva, oldPred).status === 'let');
// CONTROL 2: a genuinely let unit must NOT count as vacant.
ok('CONTROL a COM unit is not counted vacant', newPred('COM') === false);
ok('CONTROL a legacy "Available" label still counts vacant', newPred('Available') === true);

// ── 2. ChatBGP firm pipeline snapshot ──────────────────────────────────
// The fixture ships NO withdrawn deal, so every "the WIT row is absent"
// assertion below would be vacuous. Manufacture one (and restore it after).
const { rows: victim } = await c.query(
  `select id, name, status, fee from crm_deals where fee is not null and fee > 0 order by fee desc limit 1`);
if (!victim.length) { console.log('  [FAIL] no fee-bearing deal to step to WIT'); process.exit(1); }
const V = victim[0];
await c.query(`update crm_deals set status='WIT' where id=$1`, [V.id]);
console.log(`\n   stepped "${V.name}" (fee £${Number(V.fee).toLocaleString()}) ${V.status} -> WIT for the control`);
// Replicate the handler's filter over the real crm_deals rows.
const { rows: deals } = await c.query(`select id, name, status, fee from crm_deals`);
const oldActive = deals.filter(d => !['Dead', 'Withdrawn', 'Leasing Comps', 'Investment Comps'].includes(d.status));
const EXCLUDED = ['leasing comps', 'investment comps'];
const newActive = deals.filter(d => !EXCLUDED.includes(String(d.status || '').trim().toLowerCase())
  && legacyToCode(d.status) !== 'WIT');
const sum = (rows) => rows.reduce((t, d) => t + (Number(d.fee) || 0), 0);
const wit = deals.filter(d => d.status === 'WIT');
console.log(`\n-- ChatBGP pipeline snapshot (${deals.length} deals, ${wit.length} WIT)`);
console.log(`   old: ${oldActive.length} active, fees £${sum(oldActive).toLocaleString()}`);
console.log(`   new: ${newActive.length} active, fees £${sum(newActive).toLocaleString()}`);
ok('fixture actually has a WITHDRAWN deal to exclude (control)', wit.length > 0, `${wit.length}`);
ok('old filter counted the withdrawn deal(s) in the firm pipeline (the bug)',
  wit.every(d => oldActive.some(a => a.id === d.id)));
ok('new filter drops every withdrawn deal', wit.every(d => !newActive.some(a => a.id === d.id)));
ok('CONTROL a live deal is still counted', newActive.length > 0 && newActive.length === oldActive.length - wit.length,
  `${newActive.length} vs ${oldActive.length}-${wit.length}`);
const witFees = sum(wit);
ok('withdrawn fees no longer inflate the total', sum(newActive) === sum(oldActive) - witFees,
  `£${witFees.toLocaleString()} of withdrawn fees removed`);
// CONTROL: the comps pseudo-statuses ARE literal stored values — they must
// still be excluded by the new filter (that half of the old check was right).
ok('CONTROL comps pseudo-statuses stay excluded', EXCLUDED.every(s => !newActive.some(d => String(d.status || '').toLowerCase() === s)));

await c.query(`update crm_deals set status=$2 where id=$1`, [V.id, V.status]);
const { rows: back } = await c.query(`select status from crm_deals where id=$1`, [V.id]);
ok(`fixture restored — "${V.name}" back to ${V.status}`, back[0].status === V.status, back[0].status);

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURES'}`);
await c.end();
process.exit(fails ? 1 : 0);

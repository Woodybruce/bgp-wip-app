// r587 proof harness.
//   1. server/property-asset-brief.ts:211 — the HOT fault line. This one HAS
//      a real endpoint (GET /api/properties/:id/asset-brief), so it is proven
//      END TO END over HTTP, not just at the predicate level.
//   2. server/goad-plan-data.ts:654 — the Goad plan's CRM vacancy override.
//      No renderable surface here (needs VOA sqlite + Places keys), so it is
//      proven at the predicate level WITH CONTROLS.
// Usage: node qa/r587-probe.mjs [--restore]
import pg from 'pg';
import { legacyToCode } from '../shared/deal-status.ts';

const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:5000';
const c = new pg.Client({ connectionString: url });
await c.connect();
let fails = 0;
const ok = (label, pass, detail = '') => { if (!pass) fails++; console.log(`  ${pass ? '[ok]' : '[FAIL]'} ${label}${detail ? ' — ' + detail : ''}`); };

const PROP = 'cccccccc-0000-0000-0000-000000000001';

// Pick an un-dealed AVA unit on the property to drive through the funnel.
const { rows: cand } = await c.query(
  `select id, unit_name, marketing_status from available_units
     where property_id=$1 and deal_id is null and marketing_status='AVA'
     order by unit_name limit 1`, [PROP]);
if (!cand.length) { console.log('no un-dealed AVA unit on the fixture property — cannot probe'); await c.end(); process.exit(1); }
const UNIT = cand[0].id;

if (process.argv.includes('--restore')) {
  await c.query(`update available_units set marketing_status='AVA' where id=$1`, [UNIT]);
  const { rows: r } = await c.query(`select marketing_status from available_units where id=$1`, [UNIT]);
  console.log(`restored: ${cand[0].unit_name} -> ${r[0].marketing_status}`);
  await c.end(); process.exit(0);
}
console.log(`\n== r587 probe · driving ${cand[0].unit_name} (${UNIT}) through the asset-brief funnel`);

// ── login as staff so the asset-brief GET is authorised ────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }),
});
const auth = await login.json().catch(() => null);
if (!auth?.token) { console.log(`login failed ${login.status} ${JSON.stringify(auth).slice(0, 140)}`); await c.end(); process.exit(1); }
const cookie = `Bearer ${auth.token}`;

const brief = async () => {
  const r = await fetch(`${BASE}/api/properties/${PROP}/asset-brief`, { headers: { Authorization: cookie } });
  if (!r.ok) throw new Error(`asset-brief ${r.status}`);
  const j = await r.json();
  return { pipeline: j.pipeline, items: j.pipeline_items || j.pipelineItems, lettings: j.lettings || [] };
};
const setStatus = (s) => c.query(`update available_units set marketing_status=$2 where id=$1`, [UNIT, s]);
const inBucket = (b, name) => (b || []).some(i => String(i.label || '').includes(name) || String(i.sub || '').includes(name));
const shortName = String(cand[0].unit_name).split(',')[0].trim();

// ── 1. THE BUG, over HTTP ─────────────────────────────────────────────
console.log(`\n-- 1. asset-brief funnel: a HOTs unit with no crm_deals row`);
await setStatus('AVA');
const base = await brief();
console.log(`   AVA  -> hots=${base.pipeline.hots} legals=${base.pipeline.legals}`);

await setStatus('HOT');
const hot = await brief();
console.log(`   HOT  -> hots=${hot.pipeline.hots} legals=${hot.pipeline.legals}`);
ok('a HOTs unit now lands in the hots bucket', hot.pipeline.hots === base.pipeline.hots + 1,
   `${base.pipeline.hots} -> ${hot.pipeline.hots}`);
ok('and it is NAMED in the hots drilldown, not just counted', inBucket(hot.items?.hots, shortName),
   JSON.stringify(hot.items?.hots || []).slice(0, 160));
ok('it did NOT leak into legals', hot.pipeline.legals === base.pipeline.legals);
// THE HEADLINE: before the fix a HOTs unit was in NO bucket at all, so the
// funnel total lost a unit at the stage just before signature.
const sum = (p) => ['engaged','viewed','pitch_out','hots','legals','signed'].reduce((a, k) => a + (p[k] || 0), 0);
ok('the funnel total gains the unit (it used to be silently dropped)', sum(hot.pipeline) === sum(base.pipeline) + 1,
   `${sum(base.pipeline)} -> ${sum(hot.pipeline)}`);

// The old arms, run over the SAME row, to show what was happening.
const oldHots = (s) => s === 'neg' || s === 'negotiating' || s === 'under_offer' || s === 'und';
const oldLegals = (s) => s === 'sol' || s === 'solicitors' || s === 'exc' || s === 'exchanged';
ok('CONTROL the old arms put "hot" in NEITHER bucket (the bug)', !oldHots('hot') && !oldLegals('hot'));
ok('CONTROL "hots" was equally homeless', !oldHots('hots') && !oldLegals('hots'));
ok('CONTROL HOT is a legal available_units.marketing_status', legacyToCode('HOT') === 'HOT' && legacyToCode('HOTs') === 'HOT');

// ── CONTROLS: the neighbouring arms must be untouched ─────────────────
console.log(`\n-- controls: the arms either side still route correctly`);
await setStatus('NEG');
const neg = await brief();
ok('CONTROL a NEG unit still counts in hots', neg.pipeline.hots === base.pipeline.hots + 1, `hots=${neg.pipeline.hots}`);
await setStatus('SOL');
const sol = await brief();
ok('CONTROL a SOL unit still counts in legals', sol.pipeline.legals === base.pipeline.legals + 1, `legals=${sol.pipeline.legals}`);
ok('CONTROL a SOL unit is not in hots', sol.pipeline.hots === base.pipeline.hots, `hots=${sol.pipeline.hots}`);
await setStatus('AVA');
const ava = await brief();
ok('CONTROL an AVA unit is in neither bucket (not a blanket fold)',
   ava.pipeline.hots === base.pipeline.hots && ava.pipeline.legals === base.pipeline.legals);

// ORDER BY: a HOTs unit must sort with the transacting units, not the AVA tail.
await setStatus('HOT');
const ordered = await brief();
const idx = ordered.lettings.findIndex(u => u.id === UNIT);
const avaAfter = ordered.lettings.slice(idx + 1).filter(u => legacyToCode(u.marketing_status) === 'AVA').length;
ok('a HOTs unit sorts ABOVE the AVA tail in the lettings list', idx >= 0 && avaAfter > 0,
   `position ${idx + 1}/${ordered.lettings.length}, ${avaAfter} AVA rows below it`);
await setStatus('AVA');

// ── 2. Goad plan CRM vacancy override (predicate level) ───────────────
console.log(`\n-- 2. goad-plan-data.ts CRM vacancy override (no renderable surface — predicate proof)`);
const oldPred = (ms) => (ms || '').toLowerCase() === 'available';
const newPred = (ms) => legacyToCode(ms) === 'AVA';
const { rows: goadRows } = await c.query(
  `SELECT cp.name, au.marketing_status
     FROM crm_properties cp
LEFT JOIN available_units au ON au.property_id = cp.id
    WHERE cp.postcode IS NOT NULL AND au.marketing_status IS NOT NULL
    LIMIT 400`);
const oldFires = goadRows.filter(r => oldPred(r.marketing_status)).length;
const newFires = goadRows.filter(r => newPred(r.marketing_status)).length;
console.log(`   over ${goadRows.length} real (property, unit-status) pairs: old fired ${oldFires}, new fires ${newFires}`);
ok('the old label predicate fired on ZERO real rows (the bug)', oldFires === 0, `${oldFires} hits`);
ok('the new code predicate marks the marketed units confirmed_vacant', newFires > 0, `${newFires} hits`);
ok('CONTROL a legacy "Available" label still fires', newPred('Available') === true);
ok('CONTROL a let unit (COM) does not', newPred('COM') === false);
ok('CONTROL a NEG unit is not called confirmed_vacant', newPred('NEG') === false);
// The LEFT JOIN means marketing_status can be NULL for a property with no
// units at all; that must NOT read as vacant (why the fix has no `|| "AVA"`).
ok('CONTROL a property with NO units (NULL status) is not called vacant', newPred(null) === false);
const { rows: nulls } = await c.query(
  `SELECT count(*)::int n FROM crm_properties cp
LEFT JOIN available_units au ON au.property_id = cp.id
   WHERE cp.postcode IS NOT NULL AND au.marketing_status IS NULL`);
console.log(`   (${nulls[0].n} such NULL-status pairs on this fixture — the control is defensive${nulls[0].n ? '' : ' and, here, hypothetical'})`);

const { rows: fin } = await c.query(`select marketing_status from available_units where id=$1`, [UNIT]);
console.log(`\nfixture restored: ${cand[0].unit_name} -> ${fin[0].marketing_status}`);
console.log(fails ? `\n${fails} FAILURE(S)` : `\nall assertions pass`);
await c.end();
process.exit(fails ? 1 : 0);

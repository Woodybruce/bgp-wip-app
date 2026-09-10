// r583 — proves the two legacy-label fixes through the real endpoints.
//  1. /api/wip/agent-drilldown/:agent stages a SOL deal as "wip" (was
//     "pipeline": the local drilldownStage compared codes to legacy labels).
//  2. /api/daily-digest raises the critical kyc_gap alert on a deal past NEG
//     with kyc_approved = false (the digest's list was legacy labels only,
//     so the alert never fired at any stage).
// Inserts a probe deal, asserts, then removes it — fixture back to shipped.
import pg from '../node_modules/pg/lib/index.js';

const BASE = 'http://localhost:5000';
const DB = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const AGENT = 'Victoria Broadhead';
const ID = '58358358-0000-0000-0000-000000000583';
const NAME = 'QA-R583 stage+kyc probe';

const c = new pg.Client({ connectionString: DB });
await c.connect();
await c.query('DELETE FROM crm_deals WHERE id = $1', [ID]);
await c.query(
  `INSERT INTO crm_deals (id, name, status, fee, internal_agent, team, kyc_approved, deal_type)
   VALUES ($1, $2, 'SOL', 100000, $3, $4, false, 'Leasing')`,
  [ID, NAME, [AGENT], ['National Leasing']],
);

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok ' : '  FAIL'}  ${msg}`); if (!ok) failures++; };

try {
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }),
  });
  const user = await lr.json();
  if (!user.token) throw new Error(`login failed: ${JSON.stringify(user).slice(0, 200)}`);
  const H = { Authorization: `Bearer ${user.token}` };

  const drill = await (await fetch(`${BASE}/api/wip/agent-drilldown/${encodeURIComponent(AGENT)}`, { headers: H })).json();
  const row = Array.isArray(drill) ? drill.find((d) => d.dealId === ID) : null;
  check(!!row, `drilldown returns the SOL deal (${row ? row.name : 'MISSING'})`);
  check(row?.stage === 'wip', `SOL deal stages as WIP, not pipeline — got "${row?.stage}"`);
  check(row?.wip > 0, `the same row carries WIP money — £${row?.wip}`);

  const digest = await (await fetch(`${BASE}/api/daily-digest`, { headers: H })).json();
  const alerts = Array.isArray(digest) ? digest : (digest?.alerts || []);
  const kyc = alerts.filter((a) => a.type === 'kyc_gap');
  check(kyc.length > 0, `daily digest raises kyc_gap alerts — ${kyc.length}`);
  check(kyc.some((a) => a.entityId === ID), 'the probe deal is named in a kyc_gap alert');
  check(kyc.every((a) => a.severity === 'critical'), 'kyc_gap alerts are critical severity');
} finally {
  await c.query('DELETE FROM crm_deals WHERE id = $1', [ID]);
  await c.end();
}

console.log(failures ? `\n── r583 probe: ${failures} FAILURE(S) ──` : '\n── r583 probe: all green ──');
process.exit(failures ? 1 : 0);

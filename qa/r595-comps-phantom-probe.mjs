// r595: prove `client-comps-readonly` needs the STAFF chunk's confirmed comp.
// The fixture's 11 crm_comps rows are ALL AI leads (unverified, evidence
// source News), so `confirmedComps` is empty and the comps TABLE — the only
// place the "Net Effective" column header lives — never renders. Victoria's
// `agent-add-scheme-comp` is what puts a confirmed comp on the board.
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5000';
const PASSWORD = 'B@nd0077!';
let pass = 0, fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${msg}`); ok ? pass++ : fail++; };

async function login(context, username) {
  const r = await context.request.post(`${BASE}/api/auth/login`, { data: { username, password: PASSWORD } });
  const u = await r.json();
  if (!u.token) throw new Error(`login failed ${username}: ${JSON.stringify(u).slice(0,150)}`);
  const page = await context.newPage();
  await page.goto(BASE);
  await page.evaluate(([t, uu]) => {
    localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(uu));
  }, [u.token, u]);
  page.qaToken = u.token;
  return page;
}

async function clientNetEffective(page) {
  await page.goto(`${BASE}/comps`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1800);
  return page.getByText(/net effective/i).count();
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const staff = await login(sctx, 'victoria@brucegillinghampollard.com');
const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const client = await login(cctx, 'mark.warne@landsec.com');

// BASELINE: fixture only. Client comps table absent.
const before = await clientNetEffective(client);
check(before === 0, `baseline (fixture only): client /comps shows no "Net Effective" (count ${before})`);

const counts = await staff.evaluate(async () => {
  const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
  const list = await (await fetch('/api/crm/comps', { headers: auth })).json();
  const isLead = (c) => !c.verified && (['News Feed','Team Email','SharePoint File'].includes(c.sourceEvidence || '') || c.createdBy === 'AI Auto-Extract');
  return { total: list.length, leads: list.filter(isLead).length, confirmed: list.filter(c => !isLead(c)).length };
});
console.log('   staff comps census:', JSON.stringify(counts));
check(counts.total === 11 && counts.confirmed === 0, `fixture crm_comps are ALL leads (${counts.leads}/${counts.total}), 0 confirmed`);

// Now do exactly what victoria's `agent-add-scheme-comp` does.
const made = await staff.evaluate(async () => {
  const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
  const r = await fetch('/api/crm/comps', { method: 'POST', headers: auth,
    body: JSON.stringify({ name: 'QA-COMP R595, Bluewater Shopping Centre', tenantName: 'QA Comp Tenant', area: 'Bluewater' }) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, id: j.id || null };
});
check(!!made.id, `staff logged the scheme comp (status ${made.status})`);

const after = await clientNetEffective(client);
check(after > 0, `WITH the staff comp on the board: client /comps shows "Net Effective" (count ${after})`);
await client.screenshot({ path: '/tmp/r595-comps-with-staff-comp.png' });

// NEAR-MISS CONTROL: delete it again — the header must go away, proving the
// assertion tracks the staff comp and not some unrelated page change.
await staff.evaluate(async (id) => {
  await fetch(`/api/crm/comps/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + localStorage.getItem('authToken') } });
}, made.id);
const gone = await clientNetEffective(client);
check(gone === 0, `CONTROL: comp deleted → client /comps loses "Net Effective" again (count ${gone})`);

console.log(`\n${pass} PASS / ${fail} FAIL`);
await browser.close();
process.exit(fail ? 1 : 0);

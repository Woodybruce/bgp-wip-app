// r631 probe: the client Edit-Deal dialog shows Fee / AML Check / Xero / PO
// and a fee-allocation editor. Do the doors BEHIND those controls accept a
// client write? (amlCheckCompleted is the MLRO override the AML gate reads.)
import { chromium, devices } from '../node_modules/playwright/index.mjs';
const BASE = 'http://localhost:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const login = async (u) => { const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: u, password: 'B@nd0077!' } }); return (await r.json()); };
const mark = await login('mark.warne@landsec.com');
const H = { Authorization: `Bearer ${mark.token}` };
const DEAL = '11110000-0000-0000-0000-000000000301';

const before = await (await ctx.request.get(`${BASE}/api/crm/deals/${DEAL}`, { headers: H })).json();
console.log(`BEFORE: status=${before.status} aml=${JSON.stringify(before.amlCheckCompleted)} fee=${JSON.stringify(before.fee)} internalAgent=${JSON.stringify(before.internalAgent)}`);

// 1. MLRO override as a client
let r = await ctx.request.put(`${BASE}/api/crm/deals/${DEAL}`, { headers: H, data: { amlCheckCompleted: 'YES' } });
console.log(`\n[1] PUT amlCheckCompleted=YES -> ${r.status()} ${(await r.text()).slice(0,160)}`);
let now = await (await ctx.request.get(`${BASE}/api/crm/deals/${DEAL}`, { headers: H })).json();
console.log(`    read back: aml=${JSON.stringify(now.amlCheckCompleted)}  ${now.amlCheckCompleted === 'YES' ? '<<< CLIENT SET THE MLRO OVERRIDE' : 'stripped'}`);

// 2. does that override actually defeat the AML gate? try a gated status move
r = await ctx.request.put(`${BASE}/api/crm/deals/${DEAL}`, { headers: H, data: { status: 'SOL' } });
console.log(`\n[2] PUT status=SOL (gated code) -> ${r.status()} ${(await r.text()).slice(0,200)}`);
now = await (await ctx.request.get(`${BASE}/api/crm/deals/${DEAL}`, { headers: H })).json();
console.log(`    read back: status=${now.status}`);

// 2b. control: with the override OFF, does the same move get gated?
await ctx.request.put(`${BASE}/api/crm/deals/${DEAL}`, { headers: H, data: { status: before.status } });
const vic = await login('victoria@brucegillinghampollard.com');
const VH = { Authorization: `Bearer ${vic.token}` };
await ctx.request.put(`${BASE}/api/crm/deals/${DEAL}`, { headers: VH, data: { amlCheckCompleted: null } });
const ctxB = await browser.newContext({ ...devices['iPhone 13'] });
const mark2 = await (await ctxB.request.post(`${BASE}/api/auth/login`, { data: { username: 'mark.warne@landsec.com', password: 'B@nd0077!' } })).json();
const H2 = { Authorization: `Bearer ${mark2.token}` };
r = await ctxB.request.put(`${BASE}/api/crm/deals/${DEAL}`, { headers: H2, data: { status: 'SOL' } });
console.log(`\n[2b] CONTROL, override cleared, PUT status=SOL -> ${r.status()} ${(await r.text()).slice(0,220)}`);
await ctxB.request.put(`${BASE}/api/crm/deals/${DEAL}`, { headers: H2, data: { status: before.status } });

// 3. fee allocations — the card + Edit button the dialog shows the client
const fa = await ctxB.request.get(`${BASE}/api/crm/deals/${DEAL}/fee-allocations`, { headers: H2 });
console.log(`\n[3] GET fee-allocations as Mark -> ${fa.status()} ${(await fa.text()).slice(0,120)}`);
r = await ctxB.request.put(`${BASE}/api/crm/deals/${DEAL}/fee-allocations`, { headers: H2, data: { allocations: [
  { agentName: 'Mark Warne', allocationType: 'percentage', percentage: 85 },
  { agentName: 'BGP House', allocationType: 'percentage', percentage: 15, isBgpHouse: true },
] } });
console.log(`    PUT fee-allocations as Mark -> ${r.status()} ${(await r.text()).slice(0,200)}`);
const asStaff = await ctx.request.get(`${BASE}/api/crm/deals/${DEAL}/fee-allocations`, { headers: VH });
console.log(`    staff now sees: ${(await asStaff.text()).slice(0,300)}`);
const dealStaff = await (await ctx.request.get(`${BASE}/api/crm/deals/${DEAL}`, { headers: VH })).json();
console.log(`    crm_deals.internal_agent now: ${JSON.stringify(dealStaff.internalAgent)} (was ${JSON.stringify(before.internalAgent)})`);

// restore
await ctx.request.put(`${BASE}/api/crm/deals/${DEAL}`, { headers: VH, data: { status: before.status, amlCheckCompleted: before.amlCheckCompleted ?? null, internalAgent: before.internalAgent } });
await ctx.request.put(`${BASE}/api/crm/deals/${DEAL}/fee-allocations`, { headers: VH, data: { allocations: [{ agentName: 'BGP House', allocationType: 'percentage', percentage: 100, isBgpHouse: true }] } });
console.log('\n[restored]');
await browser.close();

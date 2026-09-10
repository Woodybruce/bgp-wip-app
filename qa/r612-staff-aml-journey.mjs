// r612 journey: Victoria @ 1440px — quarterly AML/KYC housekeeping on the
// MLRO surfaces (AML Compliance + Compliance Board + KYC hub), with a write.
import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const BASE = 'http://localhost:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await r.json(); if (!user.token) { console.log('login failed', JSON.stringify(user).slice(0,200)); process.exit(2); }
const page = await ctx.newPage();
const bad = [];
page.on('console', m => { if (m.type() === 'error') bad.push('CONSOLE ' + m.text().slice(0, 160)); });
page.on('response', res => { const s = res.status(); if (s >= 400) bad.push(`${s} ${res.request().method()} ${res.url().replace(BASE,'')}`); });
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u]) => { localStorage.setItem('bgp_auth_token',t); localStorage.setItem('authToken',t); localStorage.setItem('user',JSON.stringify(u)); }, [user.token,user]);

const shot = async (n) => { await page.screenshot({ path: `qa/smoke-shots/r612-${n}.png`, fullPage: true }); };
const text = async (sel) => (await page.locator(sel).first().textContent().catch(()=>null))?.replace(/\s+/g,' ').trim();

// 1 — the AML compliance surface
await page.goto(`${BASE}/aml-compliance`).catch(()=>{});
await page.waitForTimeout(9000);
console.log('--- 1. /aml-compliance ---');
console.log('h1:', await text('h1'));
console.log('tabs:', await page.evaluate(() => [...document.querySelectorAll('[role="tab"],nav button')].map(e=>(e.textContent||'').trim()).filter(Boolean).slice(0,20)));
console.log('overdue badge in header:', await page.evaluate(() => {
  const p = document.querySelector('h1')?.parentElement?.querySelector('p');
  return p ? p.textContent.replace(/\s+/g,' ').trim() : null;
}));
await shot('01-aml-hub');

// find the AML Compliance tab if the hub is tabbed
const tabNames = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map(e=>(e.textContent||'').trim()));
console.log('roleTabs:', tabNames);

// 2 — the reminders card: what does an MLRO see today?
const remBefore = await (await ctx.request.get(`${BASE}/api/aml/reminders`, { headers: { Authorization: `Bearer ${user.token}` } })).json();
const ocBefore = await (await ctx.request.get(`${BASE}/api/aml/reminders/overdue-count`, { headers: { Authorization: `Bearer ${user.token}` } })).json();
console.log('--- 2. reminders before ---');
console.log('rows:', remBefore.length, 'overdue-count:', JSON.stringify(ocBefore));
console.log(remBefore.slice(0,6).map(x => `#${x.id} ${x.entity_name} due=${x.due_date} done=${x.completed_at}`));

// 3 — THE WRITE: Victoria schedules today's annual CDD re-check, as the UI does
const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
const created = await (await ctx.request.post(`${BASE}/api/aml/reminders`, { headers: { Authorization: `Bearer ${user.token}` }, data: { entityName: 'QA r612 Holdings Ltd', recheckType: 'annual_cdd', dueDate: iso, notes: 'r612 journey — due today' } })).json();
console.log('--- 3. write: reminder due TODAY (' + iso + ') ---');
console.log('created:', JSON.stringify(created));
const ocAfter = await (await ctx.request.get(`${BASE}/api/aml/reminders/overdue-count`, { headers: { Authorization: `Bearer ${user.token}` } })).json();
console.log('overdue-count after:', JSON.stringify(ocAfter), '(was', ocBefore.count + ')');

await page.reload().catch(()=>{});
await page.waitForTimeout(7000);
console.log('header line now:', await page.evaluate(() => { const p = document.querySelector('h1')?.parentElement?.querySelector('p'); return p ? p.textContent.replace(/\s+/g,' ').trim() : null; }));
const row = page.locator('div:has-text("QA r612 Holdings Ltd")').last();
console.log('row text:', (await row.textContent().catch(()=>null))?.replace(/\s+/g,' ').trim());
console.log('OVERDUE printed on the card?', await page.locator('div:has-text("QA r612 Holdings Ltd") >> text=OVERDUE').count());
await row.scrollIntoViewIfNeeded().catch(()=>{});
await shot('02-reminder-due-today');

// 4 — the compliance board: does the KYC picture agree with itself?
await page.goto(`${BASE}/compliance-board`).catch(()=>{});
await page.waitForTimeout(9000);
console.log('--- 4. /compliance-board ---');
console.log('h1:', await text('h1'));
console.log('kpis:', await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,div')].filter(e=>e.children.length===0).map(e=>(e.textContent||'').trim()).filter(t=>t && t.length<40).slice(0,50)));
await shot('03-compliance-board');
const board = await (await ctx.request.get(`${BASE}/api/kyc/compliance-board`, { headers: { Authorization: `Bearer ${user.token}` } })).json().catch(e=>({err:String(e)}));
console.log('board API keys:', Array.isArray(board) ? `array ${board.length}` : Object.keys(board||{}).slice(0,12));

console.log('--- issues seen in the browser ---');
console.log([...new Set(bad)].slice(0,30).join('\n') || 'none');
await browser.close();

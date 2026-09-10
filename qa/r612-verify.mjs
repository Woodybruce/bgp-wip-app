// r612 re-verify: the reminder due TODAY must read as due, not overdue.
import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const BASE = 'http://localhost:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await r.json();
const H = { Authorization: `Bearer ${user.token}` };
const oc = await (await ctx.request.get(`${BASE}/api/aml/reminders/overdue-count`, { headers: H })).json();
console.log('overdue-count with one reminder due TODAY:', JSON.stringify(oc), '(expect 0)');
// and a genuinely late one still counts
const y = new Date(Date.now() - 3 * 86400000); const yiso = `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
const late = await (await ctx.request.post(`${BASE}/api/aml/reminders`, { headers: H, data: { entityName: 'QA r612 Late Ltd', recheckType: 'annual_cdd', dueDate: yiso } })).json();
const oc2 = await (await ctx.request.get(`${BASE}/api/aml/reminders/overdue-count`, { headers: H })).json();
console.log('after adding one due 3 days ago:', JSON.stringify(oc2), '(expect 1)');
const page = await ctx.newPage();
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u]) => { localStorage.setItem('bgp_auth_token',t); localStorage.setItem('authToken',t); localStorage.setItem('user',JSON.stringify(u)); }, [user.token,user]);
const errs = []; page.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,120)); });
await page.goto(`${BASE}/aml-compliance`).catch(()=>{});
await page.waitForTimeout(9000);
const rows = await page.evaluate(() => [...document.querySelectorAll('div')].filter(e => /QA r612/.test(e.textContent||'') && e.children.length <= 4 && (e.textContent||'').length < 200).map(e => (e.textContent||'').replace(/\s+/g,' ').trim()));
console.log('rows:', [...new Set(rows)].slice(-4));
console.log('header:', await page.evaluate(() => { const h = document.querySelector('h1'); return h ? h.parentElement.parentElement.textContent.replace(/\s+/g,' ').trim().slice(0,140) : null; }));
await page.locator('text=QA r612 Holdings Ltd').first().scrollIntoViewIfNeeded().catch(()=>{});
await page.screenshot({ path: 'qa/smoke-shots/r612v-reminders.png', fullPage: true });
console.log('console errors:', errs.length ? [...new Set(errs)] : 'none');
// clean up both probe rows
for (const id of [1, late.id]) await ctx.request.delete(`${BASE}/api/aml/reminders/${id}`, { headers: H });
const rem = await (await ctx.request.get(`${BASE}/api/aml/reminders`, { headers: H })).json();
console.log('reminders left after cleanup:', rem.length, '(expect 0)');
await browser.close();

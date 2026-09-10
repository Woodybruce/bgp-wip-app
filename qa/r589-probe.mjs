// r589: the already-listed early return in POST /api/available-units used to
// ship the RAW pg row (snake_case) while every other response from that
// handler came back through Drizzle in camelCase. Callers read `unit.dealId`
// off it, got undefined, and the Add-Unit fee-split PUT was skipped entirely
// on a re-add — silently, under a "Unit added" toast.
//
// Part A (API): the re-add response must carry camelCase keys and no
// snake_case ones, plus alreadyListed, and must not create a second listing.
// Part B (browser): the dialog must attempt the fee PUT on a re-add and must
// stop claiming "Unit added" when nothing was added.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE = 'http://localhost:5000';
const login = async (email) => {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: email, password: 'B@nd0077!' }) });
  if (!r.ok) throw new Error(`login ${r.status}`);
  return await r.json();
};
const me = await login('victoria@brucegillinghampollard.com');
const H = { Authorization: `Bearer ${me.token}`, 'Content-Type': 'application/json' };

// ---- Part A ----
const units = await (await fetch(`${BASE}/api/available-units`, { headers: H })).json();
const all = Array.isArray(units) ? units : (units?.data || []);
const target = all.find(u => u.propertyId && u.unitName && u.dealId) || all.find(u => u.propertyId && u.unitName);
if (!target) { console.log('SKIP: no listed unit to re-add'); process.exit(0); }
console.log(`re-adding an already-listed unit: ${target.unitName} (property ${target.propertyId})`);
const before = all.length;
const res = await fetch(`${BASE}/api/available-units`, { method: 'POST', headers: H,
  body: JSON.stringify({ propertyId: target.propertyId, unitName: target.unitName, marketingStatus: 'AVA' }) });
const body = await res.json();
const keys = Object.keys(body);
const snake = keys.filter(k => k.includes('_'));
const after = (await (await fetch(`${BASE}/api/available-units`, { headers: H })).json()).length;
console.log(`  HTTP ${res.status}  alreadyListed=${body.alreadyListed}  id=${body.id === target.id ? 'MATCHES the existing listing' : 'DIFFERENT — a duplicate!'}`);
console.log(`  dealId=${JSON.stringify(body.dealId)}  propertyId=${JSON.stringify(body.propertyId)}  marketingStatus=${JSON.stringify(body.marketingStatus)}`);
console.log(`  snake_case keys still on the response: ${snake.length ? snake.join(', ') : '(none)'}`);
console.log(`  listing count ${before} -> ${after} (must not grow)`);
const failA = [];
if (body.alreadyListed !== true) failA.push('alreadyListed missing');
if (snake.length) failA.push(`snake_case leaked: ${snake.join(',')}`);
if (body.dealId === undefined) failA.push('dealId undefined — the fee-split PUT would still be skipped');
if (body.propertyId === undefined) failA.push('propertyId undefined');
if (after !== before) failA.push('a duplicate listing was created');
console.log(failA.length ? `PART A FAIL: ${failA.join(' | ')}` : 'PART A PASS');

// ---- Part B ----
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/*', (r) => r.request().url().startsWith(BASE) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
const page = await ctx.newPage();
const seen = [];
page.on('response', (r) => { if (/fee-allocations|api\/available-units$/.test(r.url())) seen.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE,'')}`); });
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[me.token,me]);
await page.goto(`${BASE}/available`).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(2500);
await page.locator('[data-testid="button-add-unit"]').first().click();
await page.waitForTimeout(1200);
await page.locator('[data-testid="select-property"]').first().click();
await page.waitForTimeout(900);
await page.getByRole('option', { name: /Bluewater Shopping Centre/ }).first().click();
await page.waitForTimeout(1600);
await page.locator('[data-testid="select-unit"], [data-testid="input-unit-name"]').first().click().catch(()=>{});
await page.waitForTimeout(1200);
const idx = await page.evaluate(() => {
  const os = [...document.querySelectorAll('[role="option"]')];
  return os.findIndex(e => { const t=(e.textContent||'').trim(); return t && !/^select|^no /i.test(t); });
});
if (idx < 0) { console.log('PART B SKIP: no unit options'); await browser.close(); process.exit(0); }
const picked = await page.locator('[role="option"]').nth(idx).textContent();
console.log(`  picked unit option: ${String(picked).replace(/\n+/g,' | ').slice(0,90)}`);
await page.locator('[role="option"]').nth(idx).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: 'qa/smoke-shots/r589-01-dialog.png' });
for (const s of ['button:has-text("Save")','button:has-text("Create")']) {
  const el = page.locator(s).last();
  if (await el.count() && await el.isVisible().catch(()=>false)) { await el.click().catch(()=>{}); break; }
}
await page.waitForTimeout(3500);
const toast = await page.evaluate(() => [...document.querySelectorAll('[role="status"],[data-radix-toast-viewport] li,li[data-state]')]
  .map(e => (e.textContent||'').trim()).filter(Boolean).join(' ~~ '));
await page.screenshot({ path: 'qa/smoke-shots/r589-02-toast.png' });
console.log(`  network: ${seen.join(' ; ') || '(none)'}`);
console.log(`  TOAST: ${toast || '(no toast captured)'}`);
const failB = [];
if (/^Unit added$/i.test(toast.split(' ~~ ')[0] || '')) failB.push('still says plain "Unit added" on a re-add');
if (!/already on the tracker/i.test(toast)) failB.push('the toast does not say the unit was already listed');
if (!seen.some(x => /fee-allocations/.test(x))) failB.push('the fee-allocation PUT was never attempted — dealId still undefined');
console.log(failB.length ? `PART B FAIL: ${failB.join(' | ')}` : 'PART B PASS');
await browser.close();

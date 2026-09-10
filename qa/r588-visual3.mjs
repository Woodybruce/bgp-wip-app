// r588 BUG 1 visual verification: add a unit with the auto-inserted BGP House
// row as the only fee line (what the dialog does if no agent is named). The
// fee-allocation PUT 400s; the toast Victoria is left with must say so.
import { chromium } from '../node_modules/playwright/index.mjs';
import { readFileSync } from 'fs';
const BASE = 'http://localhost:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/*', (r) => r.request().url().startsWith(BASE) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
const c0 = JSON.parse(readFileSync('/tmp/r588-token.json','utf8'));
const page = await ctx.newPage();
const seen = [];
page.on('response', (res) => { if (/fee-allocations/.test(res.url())) seen.push(`${res.status()} ${res.request().method()} fee-allocations`); });
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[c0.token,c0]);
await page.goto(`${BASE}/available`).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(2500);
await page.locator('[data-testid="button-add-unit"]').first().click();
await page.waitForTimeout(1200);
await page.locator('[data-testid="select-property"]').first().click();
await page.waitForTimeout(900);
await page.getByRole('option', { name: /Bluewater Shopping Centre/ }).first().click();
await page.waitForTimeout(1500);
await page.locator('[data-testid="select-unit"], [data-testid="input-unit-name"]').first().click().catch(()=>{});
await page.waitForTimeout(1200);
const idx = await page.evaluate(() => {
  const os = [...document.querySelectorAll('[role="option"]')];
  const i = os.findIndex(e => { const t=(e.textContent||'').trim(); return t && !/^select|^no /i.test(t); });
  return i;
});
console.log(`picking option index ${idx}`);
await page.locator('[role="option"]').nth(idx).click();
await page.waitForTimeout(700);
await page.locator('input[placeholder*="85,000"]').first().fill('64000').catch(()=>{});
// Give the fee editor's effect time to materialise its locked BGP House row —
// that lone 15% line is the payload the server rejects.
await page.waitForTimeout(2500);
const feeState = await page.evaluate(() => {
  const t = document.body.innerText;
  const m = t.match(/BGP fee split[\s\S]{0,400}/);
  return m ? m[0].replace(/\n+/g,' | ') : '(no fee split section)';
});
console.log(`fee editor state: ${feeState.slice(0,300)}`);
// Victoria adds an agent line to the split but leaves the % at 0 — the
// realistic case, and the one that leaves the total at 15% (BGP House only).
const addAgent = page.locator('button:has-text("Add agent")').first();
if (await addAgent.count()) { await addAgent.click().catch(()=>{}); }
await page.waitForTimeout(1800);
const feeState2 = await page.evaluate(() => {
  const m = (document.body.innerText||'').match(/BGP fee split[\s\S]{0,500}/);
  return m ? m[0].replace(/\n+/g,' | ') : '(none)';
});
console.log(`fee editor after Add agent: ${feeState2.slice(0,360)}`);
await page.screenshot({ path: 'qa/smoke-shots/r588-feesplit-dialog.png' });
for (const s of ['button:has-text("Save")','button:has-text("Create")']) {
  const el = page.locator(s).last();
  if (await el.count() && await el.isVisible().catch(()=>false)) { await el.click().catch(()=>{}); break; }
}
await page.waitForTimeout(3000);
const toast = await page.evaluate(() => [...document.querySelectorAll('[role="status"],li[data-state]')].map(e=>(e.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean));
console.log(`fee-allocation calls: ${JSON.stringify(seen)}`);
console.log(`TOASTS ON SCREEN: ${JSON.stringify(toast)}`);
await page.screenshot({ path: 'qa/smoke-shots/r588-feesplit-toast.png' });
await browser.close();

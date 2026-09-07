import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync, readFileSync, writeFileSync } from 'fs';
const BASE = 'http://localhost:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/*', (r) => r.request().url().startsWith(BASE) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
const c0 = JSON.parse(readFileSync('/tmp/r588-token.json','utf8'));
const page = await ctx.newPage();
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[c0.token,c0]);
const PROP = 'cccccccc-0000-0000-0000-000000000001';
await page.goto(`${BASE}/properties/${PROP}`).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(3500);
// scroll to the Letting-Tracker pill row inside the tenancy schedule card
const h = await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(e => e.children.length===0 && /^200 units$/.test((e.textContent||'').trim()));
  if (!el) return null;
  const card = el.closest('div.rounded-lg, div[class*="card"], section') || el.parentElement;
  card.scrollIntoView({ block: 'start' });
  return true;
});
console.log('scrolled', h);
await page.waitForTimeout(1200);
await page.screenshot({ path: 'qa/smoke-shots/r588-tracker-pills.png' });
// also the funnel
await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(e => e.children.length===0 && /PIPELINE & PERFORMANCE/.test((e.textContent||'')));
  if (el) el.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(1000);
await page.screenshot({ path: 'qa/smoke-shots/r588-funnel.png' });
await browser.close();

// r543 interactive probe of under-visited staff surfaces.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE = 'http://localhost:5000';
const USER = process.env.QA_USER || 'victoria@brucegillinghampollard.com';
const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/*', (r) => { const u = r.request().url(); return (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
const lr = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: 'B@nd0077!' } });
const user = await lr.json();
const page = await ctx.newPage();
const bucket = [];
page.on('response', (res) => { if (res.status() >= 400) bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`); });
page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0,200)}`));
page.on('console', async (m) => {
  if (m.type() !== 'error' && m.type() !== 'warning') return;
  const t = m.text(); if (/Failed to load resource|\[ws\]/.test(t)) return;
  if (/validateDOMNesting/.test(t)) { const a=[]; for (const x of m.args()) { try { a.push(await x.jsonValue()); } catch { a.push('?'); } } bucket.push('DOMNEST '+JSON.stringify(a).slice(0,700)); return; }
  bucket.push(`CONSOLE[${m.type()}] ${t.slice(0,250)}`);
});
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);

const routes = (process.env.QA_ROUTES || '/lease-events').split(',');
for (const route of routes) {
  bucket.length = 0;
  await page.goto(BASE + route).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(2500);
  const dump = await page.evaluate(() => ({
    path: location.pathname,
    text: (document.body.innerText||'').replace(/\n{2,}/g,'\n').trim().slice(0, 2600),
    testids: [...document.querySelectorAll('[data-testid]')].map(e=>e.getAttribute('data-testid')).slice(0,90),
  }));
  console.log(`\n======== ${route} -> ${dump.path}`);
  console.log(dump.text);
  console.log('-- testids:', dump.testids.join(', '));
  if (bucket.length) console.log('-- issues:', [...new Set(bucket)].join('\n   '));
}
await browser.close();

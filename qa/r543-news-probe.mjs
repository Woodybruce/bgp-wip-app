import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE = 'http://localhost:5000';
const USER = process.env.QA_USER || 'victoria@brucegillinghampollard.com';
const b = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.route('**/*', (r) => { const u = r.request().url(); return (u.startsWith(BASE)||u.startsWith('data:')||u.startsWith('blob:')) ? r.continue() : r.abort(); });
const lr = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: 'B@nd0077!' } });
const user = await lr.json();
const p = await ctx.newPage();
await p.goto(BASE).catch(()=>{});
await p.evaluate(([t,u]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);
await p.goto(BASE + '/news').catch(()=>{});
await p.waitForLoadState('networkidle').catch(()=>{});
await p.waitForTimeout(4000);
const hits = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll('*').forEach(e => {
    if (e.children.length === 0 && /brand:[0-9a-f]{8}-/.test(e.textContent || '')) out.push({ tag: e.tagName, cls: (e.className||'').toString().slice(0,80), text: (e.textContent||'').trim().slice(0,70) });
  });
  return out.slice(0, 15);
});
console.log('BRAND-UUID CHIPS ON /news:', JSON.stringify(hits, null, 1));
console.log('body sample:', (await p.evaluate(() => document.body.innerText)).replace(/\n{2,}/g,'\n').slice(0, 1200));
await p.screenshot({ path: 'qa/smoke-shots/r543-news-brand-category-chip.png' });
await b.close();

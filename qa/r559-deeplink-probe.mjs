// r559: sweep deep links that promise a pre-filtered/targeted destination.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE = 'http://localhost:5000';
const TAG = 'r559';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  await ctx.route('**/*', (route) => { const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue(); return route.abort(); });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
  const user = await r.json();
  const page = await ctx.newPage();
  const visit = async (u, w=3000) => { await page.goto(BASE+u, {waitUntil:'domcontentloaded'}).catch(()=>{}); await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(w); };
  const txt = () => page.evaluate(()=> (document.body.innerText||'').replace(/\s+/g,' '));
  const shot = async (l) => { const p=`qa/smoke-shots/${TAG}-${l}.png`; await page.screenshot({path:p}); return p; };
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([tok,u])=>{localStorage.setItem('bgp_auth_token',tok);localStorage.setItem('authToken',tok);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);

  // pick a real company that appears on a deal
  const comps = await (await ctx.request.get(`${BASE}/api/crm/companies?limit=5`, { headers: { Authorization: `Bearer ${user.token}` } })).json();
  const list = Array.isArray(comps) ? comps : (comps.companies || comps.data || []);
  const c0 = list[0];
  console.log('== company sample', c0 && `${c0.name} / ${c0.id}`);

  // A) "Add to deal" from a brand profile -> /deals?search=<name>
  await visit(`/deals?search=${encodeURIComponent(c0?.name || 'Costa')}`, 4000);
  const a = await txt();
  console.log('== A /deals?search url:', page.url());
  console.log('   active tab:', await page.evaluate(()=>{const b=[...document.querySelectorAll('[data-testid^="toggle-deals-"]')].find(x=>/bg-background/.test(x.className)); return b?b.innerText.trim():'(none)';}));
  console.log('   search box value:', await page.evaluate(()=>{const i=[...document.querySelectorAll('input')].find(x=>/search/i.test(x.placeholder||'')); return i?JSON.stringify(i.value):'(no search input)';}));
  console.log('   TEXT:', a.slice(0, 500));
  console.log('   shot', await shot('A-deals-search'));

  // A2) the same param on the list route, which does read it
  await visit(`/deals/list?search=${encodeURIComponent(c0?.name || 'Costa')}`, 4000);
  console.log('== A2 /deals/list?search search box value:', await page.evaluate(()=>{const i=[...document.querySelectorAll('input')].find(x=>/search/i.test(x.placeholder||'')); return i?JSON.stringify(i.value):'(no search input)';}));
  console.log('   TEXT:', (await txt()).slice(0, 400));

  // B) create-company redirect from comps -> /companies?highlight=<id>
  await visit(`/companies?highlight=${encodeURIComponent(c0?.id || '')}`, 4000);
  const b = await txt();
  console.log('== B /companies?highlight url:', page.url());
  console.log('   any highlighted row?:', await page.evaluate(()=>document.querySelectorAll('[data-highlighted],.ring-2,.bg-primary\\/10').length));
  console.log('   first rows:', await page.evaluate(()=>[...document.querySelectorAll('table tbody tr')].slice(0,4).map(t=>t.innerText.replace(/\s+/g,' ').slice(0,60))));
  console.log('   TEXT:', b.slice(0, 400));
  console.log('   shot', await shot('B-companies-highlight'));

  // B2) what /companies/:id gives instead
  await visit(`/companies/${encodeURIComponent(c0?.id || '')}`, 4000);
  console.log('== B2 /companies/:id TEXT:', (await txt()).slice(0, 300));
} finally { await browser.close(); }

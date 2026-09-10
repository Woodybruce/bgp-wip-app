import { chromium } from '../node_modules/playwright/index.mjs';
const BASE = 'http://localhost:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  await ctx.route('**/*', (route) => { const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue(); return route.abort(); });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
  const user = await r.json();
  const page = await ctx.newPage();
  const visit = async (u, w=3500) => { await page.goto(BASE+u, {waitUntil:'domcontentloaded'}).catch(()=>{}); await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(w); };
  const txt = () => page.evaluate(()=> (document.body.innerText||'').replace(/\s+/g,' '));
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([tok,u])=>{localStorage.setItem('bgp_auth_token',tok);localStorage.setItem('authToken',tok);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
  await visit('/', 3500);            // warm up: fully hydrated app
  const tab = () => page.evaluate(()=>{const b=[...document.querySelectorAll('[data-testid^="toggle-deals-"]')].map(x=>`${x.innerText.trim()}${/bg-background/.test(x.className)?'*':''}`); return b.join(' | ');});
  const sbox = () => page.evaluate(()=>{const i=[...document.querySelectorAll('input')].find(x=>/search/i.test(x.placeholder||'')); return i?JSON.stringify(i.value):'(no search input)';});

  // A (warm): the exact URL the brand-profile "Add to deal" button navigates to
  await visit('/deals?search=Amorino', 4000);
  console.log('== A warm url:', page.url());
  console.log('   tabs:', await tab());
  console.log('   search box:', await sbox());
  console.log('   TEXT:', (await txt()).slice(280, 900));
  await page.screenshot({path:'qa/smoke-shots/r559-A2-deals-search-warm.png'});

  // Now the real user path: open the brand profile and CLICK "Add to deal"
  const comps = await (await ctx.request.get(`${BASE}/api/crm/companies?limit=40`, { headers: { Authorization: `Bearer ${user.token}` } })).json();
  const list = Array.isArray(comps) ? comps : (comps.companies || comps.data || []);
  const c0 = list[0];
  await visit(`/companies/${c0.id}`, 5000);
  const btn = page.locator('button', { hasText: 'Add to deal' }).first();
  console.log('== click "Add to deal" on', c0.name, '— present:', await btn.count());
  if (await btn.count()) {
    await btn.click().catch(e=>console.log('   click err', String(e).slice(0,120)));
    await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(4000);
    console.log('   landed url:', page.url());
    console.log('   tabs:', await tab());
    console.log('   search box:', await sbox());
    console.log('   TEXT:', (await txt()).slice(280, 800));
    await page.screenshot({path:'qa/smoke-shots/r559-A3-add-to-deal-click.png'});
  }
} finally { await browser.close(); }

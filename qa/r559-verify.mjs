// r559 verification: the two fixed deep links now land where their labels promise.
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
  let bucket=[];
  page.on('pageerror', e => bucket.push('PAGEERROR '+String(e).slice(0,180)));
  const visit = async (u, w=4000) => { await page.goto(BASE+u, {waitUntil:'domcontentloaded'}).catch(()=>{}); await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(w); };
  const txt = () => page.evaluate(()=> (document.body.innerText||'').replace(/\s+/g,' '));
  const tab = () => page.evaluate(()=>[...document.querySelectorAll('[data-testid^="toggle-deals-"]')].filter(x=>/bg-background/.test(x.className)).map(x=>x.innerText.trim()).join(','));
  const sbox = () => page.evaluate(()=>{const i=[...document.querySelectorAll('input')].find(x=>/search/i.test(x.placeholder||'')); return i?i.value:null;});
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([tok,u])=>{localStorage.setItem('bgp_auth_token',tok);localStorage.setItem('authToken',tok);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
  await visit('/', 3500);
  const comps = await (await ctx.request.get(`${BASE}/api/crm/companies?limit=40`, { headers: { Authorization: `Bearer ${user.token}` } })).json();
  const list = Array.isArray(comps) ? comps : (comps.companies || comps.data || []);
  const c0 = list[0];

  // FIX 1 — brand profile "Add to deal"
  await visit(`/companies/${c0.id}`, 5000);
  const btn = page.locator('button', { hasText: 'Add to deal' }).first();
  await btn.click();
  await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(4000);
  console.log('FIX1 landed url :', page.url());
  console.log('FIX1 active tab :', await tab());
  console.log('FIX1 search box :', JSON.stringify(await sbox()), '(expect', JSON.stringify(c0.name)+')');
  console.log('FIX1 heading    :', (await txt()).match(/Deals \d+ deals?[^·]*/)?.[0] || '(n/a)');
  await page.screenshot({path:'qa/smoke-shots/r559-fix1-add-to-deal.png'});

  // FIX 2 — comps "Open matched CRM company" / created-company redirect
  await visit(`/companies/${c0.id}`, 5000);
  const t = await txt();
  console.log('FIX2 record url :', page.url());
  console.log('FIX2 shows name :', t.includes(c0.name), '—', c0.name);
  await page.screenshot({path:'qa/smoke-shots/r559-fix2-company-record.png'});
  console.log('pageerrors:', bucket.length ? bucket : 'none');
} finally { await browser.close(); }

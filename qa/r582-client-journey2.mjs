// r582 step 2-4: follow the landlord's links — EXPIRING (6M) "click to list",
// the Vacancy Pipeline property link, and the one Negotiating unit.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE = 'http://localhost:5000';
const TAG = process.env.QA_TAG || 'r582k';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  await ctx.route('**/*', (route) => { const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue(); return route.abort(); });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'mark.warne@landsec.com', password: 'B@nd0077!' } });
  const user = await r.json();
  const page = await ctx.newPage();
  let bucket = [];
  page.on('response', (res) => { if (res.status() >= 400) bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`); });
  page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0,250)}`));
  const flush = (l) => { const s=[...new Set(bucket)]; bucket=[]; if (s.length) console.log(`   [${l}] `+s.join('\n   ')); };
  let step = 20;
  const shot = async (l) => { step++; const p=`qa/smoke-shots/${TAG}-${step}-${l}.png`; await page.screenshot({path:p,fullPage:false}); return p; };
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([tok,u])=>{localStorage.setItem('bgp_auth_token',tok);localStorage.setItem('authToken',tok);localStorage.setItem('user',JSON.stringify(u));},[user.token,user.user||user]);

  // what does the API say, as the client?
  const api = async (p) => { const rr = await ctx.request.get(`${BASE}${p}`, { headers: { Authorization: `Bearer ${user.token}` } }); return { s: rr.status(), b: rr.status()===200 ? await rr.json() : await rr.text() }; };
  const scope = (user.user||user).companyScopeId;
  const pf = await api(`/api/company-portfolio/${scope}`);
  if (pf.s===200) {
    console.log('== PORTFOLIO stats:', JSON.stringify(pf.b.stats));
    console.log('   deals array (n=%d):', (pf.b.deals||[]).length, JSON.stringify((pf.b.deals||[]).map(d=>({n:d.name,s:d.status,t:d.dealType,p:d.property_name}))));
    console.log('   properties:', JSON.stringify((pf.b.properties||[]).map(p=>({n:p.name,id:p.id}))));
    const lu = pf.b.leasingUnits||[];
    console.log('   leasingUnits n=%d  first:', lu.length, JSON.stringify(lu[0]));
    const withExp = lu.filter(u=>u.lease_expiry);
    console.log('   with lease_expiry:', withExp.length, ' with passing_rent:', lu.filter(u=>u.passing_rent_pa).length);
  } else console.log('== PORTFOLIO', pf.s, String(pf.b).slice(0,200));

  // 2 — EXPIRING (6M) tile: click to list
  await page.goto(`${BASE}/dashboard`, {waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(3500);
  const tile = page.locator('text=/EXPIRING \\(6M\\)/i').first();
  if (await tile.count()) {
    await tile.click({timeout:8000}).catch(e=>console.log('   tile click failed', String(e).slice(0,120)));
    await page.waitForTimeout(3000);
    console.log('\n== STEP 2 after EXPIRING(6M) click: url', page.url(), 'shot', await shot('expiring'));
    const t = await page.evaluate(()=> (document.body.innerText||'').replace(/\s+/g,' '));
    console.log('   TEXT:', t.slice(0,1500));
  } else console.log('\n== STEP 2 no EXPIRING tile found');
  flush('expiring');
} finally { await browser.close(); }

import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000'; const TAG=process.env.QA_TAG||'r611';
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
const ctx = await browser.newContext({ viewport:{width:1440,height:900} });
await ctx.route('**/*', r => r.request().url().startsWith(BASE)||/^(data|blob):/.test(r.request().url()) ? r.continue() : r.abort());
const u = await (await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}})).json();
const page = await ctx.newPage();
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,x])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(x));},[u.token,u]);
await page.goto(`${BASE}/leasing-schedule`).catch(()=>{});
await page.waitForTimeout(14000);
console.log('path:', await page.evaluate(()=>location.pathname));
const hits = await page.evaluate(()=>{
  const out=[];
  for (const el of document.querySelectorAll('*')) {
    const t=(el.innerText||'').replace(/\s+/g,' ').trim();
    if (/\b\d+ expiring\b/i.test(t) && t.length<120) out.push(t);
  }
  const heads=[...document.querySelectorAll('th')].map(e=>e.textContent.trim());
  return { badges:[...new Set(out)].slice(0,6), heads, body:(document.body.innerText||'').replace(/\s+/g,' ').slice(0,600) };
});
console.log(JSON.stringify(hits,null,1));
await page.screenshot({path:`qa/smoke-shots/${TAG}-board-prefix.png`, fullPage:false});
const card = await page.locator('text=/\\d+ expiring/i').first();
if (await card.count()) { await card.scrollIntoViewIfNeeded().catch(()=>{}); await page.waitForTimeout(600); await page.screenshot({path:`qa/smoke-shots/${TAG}-badge-prefix.png`}); }
await browser.close();

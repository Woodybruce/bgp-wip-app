import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000';
const b = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium')?'/opt/pw-browsers/chromium':undefined, args:['--no-sandbox'] });
const ctx = await b.newContext({ viewport:{width:1440,height:1000} });
await ctx.route('**/*',(r)=>{const u=r.request().url();return (u.startsWith(BASE)||u.startsWith('data:')||u.startsWith('blob:'))?r.continue():r.abort();});
const lr = await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
const user = await lr.json();
const p = await ctx.newPage();
await p.goto(BASE).catch(()=>{});
await p.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);

await p.goto(BASE+'/board-report').catch(()=>{});
await p.waitForLoadState('networkidle').catch(()=>{});
await p.waitForTimeout(3500);
const cat = await p.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(e => /CATEGORY BREAKDOWN/.test(e.textContent||'') && e.children.length < 6);
  const card = el ? el.closest('div')?.parentElement : null;
  const txt = (card?.innerText || document.body.innerText);
  return { uuids: /brand:[0-9a-f]{8}-/.test(document.body.innerText), sample: (txt.match(/CATEGORY BREAKDOWN[\s\S]{0,300}/)||[''])[0] };
});
console.log('BOARD REPORT uuids present?', cat.uuids);
console.log(cat.sample);
await p.screenshot({ path:'qa/smoke-shots/r543-board-report-categories-after.png' });

await p.goto(BASE+'/marketing-files').catch(()=>{});
await p.waitForLoadState('networkidle').catch(()=>{});
await p.waitForTimeout(2500);
const mf = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-testid^="marketing-file-"] p')].map(e=>e.textContent);
  return { rows, doubleSep: rows.some(t => /·\s*·/.test(t||'')) };
});
console.log('MARKETING FILES rows:', JSON.stringify(mf));
await p.screenshot({ path:'qa/smoke-shots/r543-marketing-files-after.png' });
await b.close();

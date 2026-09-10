// r590 journey step 2 — Mark on the client dashboard: read the headline KPIs,
// then the portfolio board, then Bluewater. Capture text, not just shots.
import { chromium } from '../node_modules/playwright/index.mjs';
import fs from 'fs';
const BASE='http://localhost:5000';
const r = await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'mark.warne@landsec.com',password:'B@nd0077!'})});
const me = await r.json();
const H={Authorization:`Bearer ${me.token}`,'Content-Type':'application/json'};
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx = await browser.newContext({viewport:{width:1440,height:900}});
await ctx.route('**/*',(q)=> q.request().url().startsWith(BASE)||q.request().url().startsWith('data:')?q.continue():q.abort());
const page = await ctx.newPage();
const bad=[]; page.on('response',res=>{if(res.status()>=400&&res.url().startsWith(BASE))bad.push(`${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`);});
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[me.token,me.user||me]);
const out=[];
const visit = async (path,name)=>{
  await page.goto(`${BASE}${path}`).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(2800);
  await page.screenshot({path:`qa/smoke-shots/r590-${name}.png`,fullPage:true});
  const t = await page.evaluate(()=>document.body.innerText.replace(/\n{2,}/g,'\n'));
  out.push(`\n\n===== ${path} (${page.url()}) =====\n`+t);
};
await visit('/','02-dash');
const nav = await page.evaluate(()=>[...new Set([...document.querySelectorAll('a[href]')].map(a=>((a.textContent||'').trim().replace(/\s+/g,' ').slice(0,28))+' -> '+a.getAttribute('href')))]);
out.push('\n===== NAV =====\n'+nav.join('\n'));
fs.writeFileSync('/tmp/r590-dash.txt', out.join('\n'));
console.log('NAV:\n'+nav.join('\n'));
console.log('\n--- DASH first 2500 chars ---\n'+out[0].slice(0,2500));
console.log('\n--- HTTP>=400 ---\n'+[...new Set(bad)].join('\n'));
await browser.close();

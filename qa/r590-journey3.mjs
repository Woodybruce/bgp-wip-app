// r590 journey step 3 — Mark's board paper: the letting board, the property
// page, the tenancy schedule, and one deal. Judge every number as him.
import { chromium } from '../node_modules/playwright/index.mjs';
import fs from 'fs';
const BASE='http://localhost:5000';
const BW='cccccccc-0000-0000-0000-000000000001';
const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'mark.warne@landsec.com',password:'B@nd0077!'})});
const me=await r.json();
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
await ctx.route('**/*',q=>q.request().url().startsWith(BASE)||q.request().url().startsWith('data:')?q.continue():q.abort());
const page=await ctx.newPage();
const bad=[]; page.on('response',res=>{if(res.status()>=400&&res.url().startsWith(BASE))bad.push(`${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`);});
page.on('pageerror',e=>console.log('PAGEERROR:',String(e).slice(0,180)));
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[me.token,me.user||me]);
const out=[];
const visit=async(p,n,head=2200)=>{
  await page.goto(`${BASE}${p}`).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(3000);
  await page.screenshot({path:`qa/smoke-shots/r590-${n}.png`,fullPage:true});
  const t=await page.evaluate(()=>document.body.innerText.replace(/\n{2,}/g,'\n'));
  out.push(`\n\n===== ${p} =====\n`+t);
  console.log(`\n===== ${p} =====\n`+t.slice(0,head));
};
await visit(`/deals/letting?propertyId=${BW}`,'03-letting-board',3000);
await visit(`/properties/${BW}`,'04-property',2500);
await visit(`/tenancy-schedule/${BW}`,'05-tenancy',2200);
fs.writeFileSync('/tmp/r590-j3.txt',out.join('\n'));
console.log('\n--- HTTP>=400 ---\n'+[...new Set(bad)].join('\n'));
await browser.close();

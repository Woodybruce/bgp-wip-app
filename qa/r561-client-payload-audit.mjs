import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
import fs from 'fs';
const BASE='http://127.0.0.1:5000';
const PASSWORD='B@nd0077!';
const USER=process.env.QA_USER||'mark.warne@landsec.com';
const OUT=process.env.QA_OUT||'/tmp/r561-payloads';
fs.mkdirSync(OUT,{recursive:true});

const MARKERS=[
  /brucegillinghampollard/i,
  /\bnet[_ ]?fee/i, /\bfee[_ ]?(split|earned|target|amount)/i,
  /\bwip\b/i, /commission/i, /\binvoice/i, /billed/i,
  /leaderboard/i, /busiest[_ ]?agent/i,
  /\blead(s)?_?(source|status|notes)\b/i,
  /internal[_ ]?note/i, /\bprospect/i, /ski[_ ]?target/i,
];

const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox']});
const ctx = await browser.newContext({viewport:{width:1440,height:900}});
const page = await ctx.newPage();
const hits=[]; const seen=new Set();
page.on('response', async (res)=>{
  try{
    const u=new URL(res.url());
    if(!u.pathname.startsWith('/api/')) return;
    const key=u.pathname+u.search;
    if(seen.has(key)) return; seen.add(key);
    const ct=res.headers()['content-type']||'';
    if(!/json|text/.test(ct)) return;
    const body=await res.text();
    const found=MARKERS.filter(m=>m.test(body)).map(m=>String(m));
    fs.writeFileSync(`${OUT}/${key.replace(/[^a-z0-9]/gi,'_').slice(0,120)}.json`, body);
    if(found.length) hits.push({key, status:res.status(), found, len:body.length});
  }catch{}
});

// API login then inject token
const r = await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:USER,password:PASSWORD}});
const {token} = await r.json();
await page.goto(BASE+'/login',{waitUntil:'domcontentloaded'}).catch(()=>{});
await page.evaluate(t=>localStorage.setItem('authToken',t), token);

const routes=(process.env.QA_ROUTES||'/,/calendar,/tasks,/news,/deals,/available,/requirements,/comps,/crm,/properties,/property-intelligence,/messages,/images').split(',');
for(const rt of routes){
  try{
    await page.goto(BASE+rt,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(4500);
    console.log(`visited ${rt}`);
  }catch(e){ console.log(`visit fail ${rt}: ${e.message.slice(0,80)}`); }
}
console.log('\n== payloads captured:', seen.size);
console.log('== marker hits:', hits.length);
for(const h of hits) console.log(`${h.status} ${h.key}  [${h.len}b]  ${h.found.join(' ')}`);
await browser.close();

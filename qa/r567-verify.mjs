// r567 — read the money columns of one Bluewater row as both personas,
// looking cells up by their header LABEL (column order shifts with lens).
import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const BASE='http://127.0.0.1:5000';
const PROP='cccccccc-0000-0000-0000-000000000001';
const UNIT='SVL08 Bluewater - Upper Level';
const WANT=['Service Charge','Rates Payable','Rateable Value','Deposit Held','Arrears','Capex','NOI (pa)','Topped Up NOI','Passing Rent','ERV (pa)','Unexp (Expiry) mths','Unexp (Break) mths','Unexp (Review) mths','T/O %','NIA','Expiry'];
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox']});
for(const who of ['victoria@brucegillinghampollard.com','mark.warne@landsec.com']){
  const ctx = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await ctx.newPage();
  const t=await (await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:who,password:'B@nd0077!'}})).json();
  await page.goto(BASE+'/login',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.evaluate(x=>localStorage.setItem('authToken',x), t.token);
  await page.goto(BASE+'/tenancy-schedule/'+PROP,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(11000);
  const out = await page.evaluate(({UNIT,WANT})=>{
    const table=document.querySelector('table'); if(!table) return {err:'no table'};
    const hrows=[...table.querySelectorAll('thead tr')];
    // the label row is the one that actually carries the wanted labels
    let labelRow=null, best=0;
    for(const hr of hrows){
      const txts=[...hr.querySelectorAll('th')].map(th=>(th.textContent||'').replace(/\s+/g,' ').trim());
      const hit=WANT.filter(w=>txts.includes(w)).length;
      if(hit>best){best=hit; labelRow=txts;}
    }
    if(!labelRow) return {err:'no label row'};
    let row=null;
    for(const tr of table.querySelectorAll('tbody tr')){
      if((tr.textContent||'').includes(UNIT)){ row=[...tr.querySelectorAll('td')].map(td=>(td.textContent||'').replace(/\s+/g,' ').trim()); break; }
    }
    if(!row) return {err:'row not found'};
    const res={};
    for(const w of WANT){ const i=labelRow.indexOf(w); res[w]= i<0 ? '(col hidden)' : JSON.stringify(row[i]); }
    return {res, ths:labelRow.length, tds:row.length};
  },{UNIT,WANT});
  console.log('=== '+who.split('@')[0]+' ('+JSON.stringify({ths:out.ths,tds:out.tds})+') ===');
  if(out.err) console.log('  ERR '+out.err);
  else for(const [k,v] of Object.entries(out.res)) console.log(`  ${k.padEnd(16)} = ${v}`);
  await page.screenshot({path:`qa/smoke-shots/r567-${who.split('@')[0]}.png`});
  await ctx.close();
}
await browser.close();

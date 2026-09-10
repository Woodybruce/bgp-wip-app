import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const BASE='http://127.0.0.1:5000';
const PROP='cccccccc-0000-0000-0000-000000000001';
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox']});
const HEADS=['Unit','Zone','Floor','Use','Status','AM','Tenant','TradingAs','Start','BreakDate','BreakNotice','Expiry','Term','UnexpBreak','UnexpExpiry','UnexpReview','NextReview','LTAct'];
for(const who of ['mark.warne@landsec.com','victoria@brucegillinghampollard.com']){
  const ctx = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await ctx.newPage();
  const t=await (await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:who,password:'B@nd0077!'}})).json();
  await page.goto(BASE+'/login',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.evaluate(x=>localStorage.setItem('authToken',x), t.token);
  await page.goto(BASE+'/tenancy-schedule/'+PROP,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(10000);
  const row = await page.evaluate(()=>{
    for(const tr of document.querySelectorAll('tbody tr')){
      if(/SVL02 Bluewater/.test(tr.textContent||'')) return [...tr.querySelectorAll('td')].map(td=>(td.textContent||'').replace(/\s+/g,' ').trim());
    }
    return null;
  });
  console.log('=== '+who.split('@')[0]+' ===');
  if(!row){console.log('row not found');}
  else{
    const idx={Start:8,BreakDate:9,Expiry:11,Term:12,NIA:29,PassingRent:31,QuotingRent:32,TOpct:34,ERV:36,RateablePV:39,RatesPayable:40,ServiceCharge:41,Insurance:43,Credit:48,Deposit:49,Arrears:50};
    for(const [k,i] of Object.entries(idx)) console.log(`  ${k.padEnd(15)} = ${JSON.stringify(row[i])}`);
  }
  await page.screenshot({path:`qa/smoke-shots/r566-s9-${who.split('@')[0]}.png`});
  await ctx.close();
}
await browser.close();

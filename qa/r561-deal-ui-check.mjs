import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const BASE='http://127.0.0.1:5000'; const PASSWORD='B@nd0077!';
const DEAL='11110000-0000-0000-0000-000000000302';
const who=process.env.QA_USER||'mark.warne@landsec.com';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
const r=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:who,password:PASSWORD}});
const {token}=await r.json();
const p=await ctx.newPage();
await p.goto(BASE+'/login',{waitUntil:'domcontentloaded'}).catch(()=>{});
await p.evaluate(t=>localStorage.setItem('authToken',t),token);
for (const route of ['/deals','/deals/'+DEAL]) {
  await p.goto(BASE+route,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(7000);
  const txt=await p.evaluate(()=>document.body.innerText);
  const hits=['NCA-SAR','INTERNAL:','possible_match','XERO-4471','ap@landsec.example','Landsec Retail Ltd (BGP billing)','high'].filter(s=>txt.includes(s));
  console.log(`\n### ${who} ${route} — visible internal strings: ${JSON.stringify(hits)}`);
  const amlBits=txt.split('\n').filter(l=>/aml|AML|SAR|PEP|risk|Compliance|KYC/i.test(l)).slice(0,15);
  console.log('  AML-ish lines:', JSON.stringify(amlBits));
  await p.screenshot({path:`qa/smoke-shots/r561-${who.split('@')[0]}-${route.replace(/\W/g,'_')}.png`,fullPage:false});
}
await b.close();

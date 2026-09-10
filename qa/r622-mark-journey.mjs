// r622 exploratory journey: Mark Warne (Landsec client), CLIENT DESKTOP 1440px.
// Task: prepare for tomorrow's Landsec leasing meeting — check the portfolio
// KPIs, drill the "expiring" tile, then record agreed terms on a live deal.
import { chromium } from 'playwright';
import { existsSync } from 'fs';
const BASE='http://127.0.0.1:5000', SHOTS='/tmp/r622';
const b=await chromium.launch({executablePath:existsSync('/opt/pw-browsers/chromium')?'/opt/pw-browsers/chromium':undefined,args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/,r=>r.abort());
const bad=[]; ctx.on('response',r=>{if(r.status()>=400)bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE,'')}`)});
const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
const u=await lr.json(); const TOKEN=u.token;
const p=await ctx.newPage();
await p.goto(BASE); await p.evaluate(([t,uu])=>{localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(uu));},[TOKEN,u]);
async function api(m,path,body){const r=await ctx.request.fetch(`${BASE}${path}`,{method:m,headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},...(body?{data:body}:{})});let j=null;try{j=await r.json()}catch{};return{s:r.status(),j};}
async function visit(path,label,wait=2500){
  await p.goto(`${BASE}${path}`).catch(e=>{if(!/ERR_ABORTED/.test(String(e)))throw e});
  await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(wait);
  const t=(await p.locator('main, body').first().innerText().catch(()=>'')).trim();
  await p.screenshot({path:`${SHOTS}/${label.replace(/[^a-z0-9]+/gi,'-')}.png`});
  return t;
}
await visit('/','warmup',4000);

// ── 1. the portfolio KPI row, read as Mark reads it ─────────────────────
const dash=await visit('/','01-dashboard',4000);
const g=(re)=>{const m=dash.match(re);return m?m[1]:'(not found)'};
console.log('KPI row as rendered:');
console.log('  PROPERTIES      ', g(/PROPERTIES\s*\n\s*(\S+)/));
console.log('  TOTAL UNITS     ', g(/TOTAL UNITS\s*\n\s*(\S+)/), '|', g(/TOTAL UNITS\s*\n\s*\S+\s*\n\s*(.+)/));
console.log('  OCCUPANCY       ', g(/OCCUPANCY\s*\n\s*(\S+)/), '|', g(/OCCUPANCY\s*\n\s*\S+\s*\n\s*(.+)/));
console.log('  ACTIVE DEALS    ', g(/ACTIVE DEALS\s*\n\s*(\S+)/));
console.log('  EXPIRING (6M)   ', g(/EXPIRING \(6M\)\s*\n\s*(\S+)/), '|', g(/EXPIRING \(6M\)\s*\n\s*\S+\s*\n\s*(.+)/));
console.log('  Letting Tracker ', g(/Letting Tracker\s*\n\s*(.+)/));

// ── 2. "click to list" — does the tile's number match the list it opens? ──
const tile=p.getByText('leases expiring soon', {exact:false}).first();
if(await tile.count()){
  await tile.click({timeout:8000}).catch(e=>console.log('  tile click failed:',String(e).slice(0,120)));
  await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(2500);
  await p.screenshot({path:`${SHOTS}/02-expiring-list.png`});
  const t=(await p.locator('main, body').first().innerText());
  console.log('\nAfter clicking "leases expiring soon" — url:', p.url().replace(BASE,''));
  console.log('  dialog/list rows:', await p.locator('[role="dialog"] tbody tr, [role="dialog"] li').count(), '| table rows:', await p.locator('tbody tr').count());
  console.log(t.replace(/Powered by BGP[\s\S]*?⌘\s*K\s*/,'').slice(0,1400));
}else console.log('\n  ** no "leases expiring soon" affordance found **');

// ── 3. API cross-check of every printed number ───────────────────────────
console.log('\n── API cross-check ──');
for(const path of ['/api/client/portfolio-kpis','/api/client/dashboard','/api/available-units','/api/crm/deals','/api/lease-expiries']){
  const x=await api('GET',path);
  console.log(`  ${path} -> ${x.s} ${Array.isArray(x.j)?x.j.length+' rows':JSON.stringify(x.j||'').slice(0,300)}`);
}
console.log('\n=== >=400 ===\n'+[...new Set(bad)].join('\n'));
await b.close();

import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5000';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/,r=>r.abort());
async function run(un,label){
  const r=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:un,password:'B@nd0077!'}});
  const u=await r.json();
  const p=await ctx.newPage();
  p.on('response',async(res)=>{ if(res.url().includes('requirements-leasing')&&!res.url().includes('matches')){ try{const j=await res.json(); console.log(`  [${label}] ${res.url().replace(BASE,'')} -> ${Array.isArray(j)?j.length+' rows: '+j.map(x=>x.name+'/'+x.status).join(', '):JSON.stringify(j).slice(0,150)}`);}catch(e){} } });
  await p.goto(BASE); await p.evaluate(([t,uu])=>{localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(uu));},[u.token,u]);
  await p.goto(`${BASE}/`).catch(()=>{}); await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(3000);
  await p.goto(`${BASE}/requirements`).catch(()=>{}); await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(4000);
  const t=await p.locator('main, body').first().innerText();
  const m=t.match(/(\d+)\s+active requirements/);
  console.log(`  [${label}] header says: ${m?m[0]:'(no header count)'} · has "No active requirements found": ${/No active requirements found/.test(t)}`);
  console.log(`  [${label}] rows visible: ${await p.locator('tbody tr').count()}`);
  await p.screenshot({path:`/tmp/r622/req-${label}.png`});
  await p.close();
}
await run('mark.warne@landsec.com','mark');
await run('victoria@brucegillinghampollard.com','vic');
await b.close();

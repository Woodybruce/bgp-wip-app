import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5000';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/,r=>r.abort());
const r=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
const u=await r.json();
const p=await ctx.newPage();
await p.goto(BASE);
await p.evaluate(([t,uu])=>{localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(uu));},[u.token,u]);
// warm up
await p.goto(`${BASE}/instructions`).catch(()=>{}); await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(3000);
await p.goto(`${BASE}/`).catch(()=>{}); await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(8000);
const t=(await p.locator('main, body').first().innerText());
console.log('LEN',t.length); console.log(t.slice(0,3000));
await p.screenshot({path:'/tmp/r622/dash-warm.png'});
await b.close();

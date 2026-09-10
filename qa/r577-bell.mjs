// r577: staff notification bell — which deals raise the "KYC not approved" alert.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const TAG=process.argv[2]||'x';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
try{
 const ctx=await b.newContext({viewport:{width:1440,height:1000},locale:'en-GB'});
 const r=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
 const user=await r.json();
 const api=await ctx.request.get(`${BASE}/api/notifications`,{headers:{Authorization:`Bearer ${user.token}`}});
 const js=await api.json();
 console.log('API kyc_gap rows:');
 for(const n of js.filter(n=>n.type==='kyc_gap')) console.log('   ', n.title, '|', n.description);
 console.log('API total notifications:', js.length);
 const page=await ctx.newPage();
 await page.goto(BASE).catch(()=>{});
 await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
 await page.goto(`${BASE}/`,{waitUntil:'domcontentloaded'}).catch(()=>{});
 await page.waitForLoadState('networkidle').catch(()=>{});
 await page.waitForTimeout(3000);
 const bell=page.locator('[data-testid="button-notifications"]').first();
 await bell.click().catch(e=>console.log('bell click fail',e.message));
 await page.waitForTimeout(1500);
 const rows=page.locator('[data-testid^="notification-kyc-"]');
 const n=await rows.count();
 console.log('BELL kyc rows rendered:', n);
 for(let i=0;i<n;i++) console.log('   ', (await rows.nth(i).innerText()).replace(/\s+/g,' '));
 await page.screenshot({path:`qa/smoke-shots/r577-bell-${TAG}.png`});
}finally{await b.close();}

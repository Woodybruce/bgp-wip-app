// r577: /hr — the ski-target hero's WIP vs the Hunger Games pipeline/active
// boards. Same page, same deals: they should agree about which stages count.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const TAG=process.argv[2]||'x';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
try{
 const ctx=await b.newContext({viewport:{width:1440,height:1100},locale:'en-GB'});
 const r=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
 const user=await r.json();
 const H={Authorization:`Bearer ${user.token}`};
 const firm=await (await ctx.request.get(`${BASE}/api/dashboard/firm-summary`,{headers:H})).json();
 const ind =await (await ctx.request.get(`${BASE}/api/dashboard/individual-leaderboard`,{headers:H})).json();
 const team=await (await ctx.request.get(`${BASE}/api/hr/team-summary`,{headers:H})).json();
 console.log('FIRM  wipPence      =', firm.wipPence, `(£${(firm.wipPence/100).toLocaleString()})`);
 const lucy=(ind.topPipeline||[]).find(x=>x.name==='Lucy Gardiner');
 const lucyA=(ind.topActive||[]).find(x=>x.name==='Lucy Gardiner');
 console.log('INDIV Lucy pipeline =', lucy?lucy.pipelinePence:'(absent)', lucy?`(£${(lucy.pipelinePence/100).toLocaleString()})`:'');
 console.log('INDIV Lucy active   =', lucyA?lucyA.activeDeals:'(absent)', 'deals');
 const nl=(team.teams||[]).find(t=>t.team==='National Leasing');
 console.log('TEAM  National Leasing pipeline =', nl?nl.pipelinePence:'(absent)', nl?`(£${(nl.pipelinePence/100).toLocaleString()})`:'');
 const page=await ctx.newPage();
 await page.goto(BASE).catch(()=>{});
 await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
 await page.goto(`${BASE}/hr`,{waitUntil:'domcontentloaded'}).catch(()=>{});
 await page.waitForLoadState('networkidle').catch(()=>{});
 await page.waitForTimeout(4000);
 for(const tab of ['Top pipeline','Most active']){
   await page.getByRole('button',{name:tab}).first().click().catch(e=>console.log('tab click fail',tab,e.message));
   await page.waitForTimeout(900);
   const row=page.locator('[data-testid^="leaderboard-"]').first();
   console.log(`BOARD "${tab}" top row:`, await row.count()? (await row.innerText()).replace(/\s+/g,' ') : '(empty)');
 }
 await page.screenshot({path:`qa/smoke-shots/r577-hr-${TAG}.png`});
}finally{await b.close();}

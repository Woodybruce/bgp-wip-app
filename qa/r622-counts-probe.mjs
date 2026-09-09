import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5000';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext();
async function tok(un){const r=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:un,password:'B@nd0077!'}});const j=await r.json();if(!j.token)throw new Error(un+' login failed');return j.token;}
const MARK=await tok('mark.warne@landsec.com'), VIC=await tok('victoria@brucegillinghampollard.com');
async function get(t,path){const r=await ctx.request.fetch(`${BASE}${path}`,{headers:{Authorization:`Bearer ${t}`}});let j=null;try{j=await r.json()}catch{};return {s:r.status(),j};}
for(const path of ['/api/crm/requirements-leasing','/api/crm/requirements-leasing/matches']){
  for(const [nm,t] of [['mark',MARK],['vic',VIC]]){
    const x=await get(t,path);
    console.log(`${path} ${nm} ${x.s} -> ${Array.isArray(x.j)?x.j.length+' rows':JSON.stringify(x.j).slice(0,200)}`);
  }
}
const all=await get(VIC,'/api/crm/requirements-leasing');
if(Array.isArray(all.j)) for(const r of all.j) console.log(`  staff req: ${r.name} | company=${r.companyId} | status=${r.status} | active=${r.isActive}`);
await b.close();

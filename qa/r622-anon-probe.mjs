import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5000';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
// A FRESH context per request — no cookie jar carry-over (r622: a shared
// ctx.request jar made a Bearer probe silently run as the last login).
async function raw(method,path,body,token){
  const c=await b.newContext();
  const r=await c.request.fetch(`${BASE}${path}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{}),'Content-Type':'application/json'},...(body?{data:body}:{})});
  let j=null;try{j=await r.json()}catch{}
  await c.close();
  return {s:r.status(),j};
}
async function tok(un){const c=await b.newContext();const r=await c.request.post(`${BASE}/api/auth/login`,{data:{username:un,password:'B@nd0077!'}});const j=await r.json();await c.close();return j.token;}

console.log('── ANONYMOUS (no cookie, no token) ──');
for(const path of ['/api/crm/requirements-leasing','/api/crm/requirements-investment','/api/crm/companies','/api/crm/contacts','/api/crm/properties','/api/crm/deals','/api/available-units']){
  const x=await raw('GET',path);
  console.log(`  GET ${path} -> ${x.s} ${Array.isArray(x.j)?x.j.length+' rows':JSON.stringify(x.j).slice(0,80)}`);
}
console.log('\n── MARK (Bearer only, clean jar) ──');
const M=await tok('mark.warne@landsec.com');
for(const path of ['/api/crm/requirements-leasing','/api/crm/requirements-investment']){
  const x=await raw('GET',path,null,M);
  console.log(`  GET ${path} -> ${x.s} ${Array.isArray(x.j)?x.j.length+' rows: '+x.j.map(r=>r.name).join(','):JSON.stringify(x.j).slice(0,80)}`);
}
console.log('\n── VICTORIA (Bearer only, clean jar) ──');
const V=await tok('victoria@brucegillinghampollard.com');
for(const path of ['/api/crm/requirements-leasing','/api/crm/requirements-investment']){
  const x=await raw('GET',path,null,V);
  console.log(`  GET ${path} -> ${x.s} ${Array.isArray(x.j)?x.j.length+' rows: '+x.j.map(r=>r.name).join(','):JSON.stringify(x.j).slice(0,80)}`);
}
await b.close();

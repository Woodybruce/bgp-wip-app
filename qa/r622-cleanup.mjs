import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5000';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext();
const r=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
const T=(await r.json()).token;
const g=await ctx.request.fetch(`${BASE}/api/crm/deals`,{headers:{Authorization:`Bearer ${T}`}});
const deals=await g.json();
for(const d of deals){ if(d.rentPa!=null) console.log('rentPa set on', d.id, d.propertyName||'', '->', d.rentPa); }
const t=deals.find(d=>d.id==='11110000-0000-0000-0000-000000000302');
console.log('\ntarget 302 rentPa:', t?.rentPa);
if(t?.rentPa!=null){
  const p=await ctx.request.fetch(`${BASE}/api/crm/deals/302-clear`.replace('302-clear',t.id),{method:'PUT',headers:{Authorization:`Bearer ${T}`,'Content-Type':'application/json'},data:{rentPa:null}});
  console.log('cleanup PUT ->', p.status());
  const g2=await ctx.request.fetch(`${BASE}/api/crm/deals`,{headers:{Authorization:`Bearer ${T}`}});
  console.log('rentPa after cleanup:', (await g2.json()).find(d=>d.id===t.id)?.rentPa);
}
await b.close();

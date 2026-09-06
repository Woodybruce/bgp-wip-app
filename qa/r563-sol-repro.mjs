const BASE='http://127.0.0.1:5000'; const PASSWORD='B@nd0077!';
async function tok(u){const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:PASSWORD})});return (await r.json()).token;}
async function get(t,p){const r=await fetch(BASE+p,{headers:{Authorization:'Bearer '+t}});return r.ok?await r.json():{__status:r.status};}
const t=await tok('victoria@brucegillinghampollard.com');
const units=await get(t,'/api/available-units'); const deals=await get(t,'/api/crm/deals');
const arrU=Array.isArray(units)?units:units.data||[];
const dm=new Map((Array.isArray(deals)?deals:deals.data||[]).map(d=>[d.id,d]));
for(const u of arrU.filter(x=>x.dealId)){
  const d=dm.get(u.dealId);
  console.log(`unit ${u.unitName} id=${u.id} rowStatus=${u.marketingStatus} propertyId=${u.propertyId}`);
  console.log(`   deal ${d?.dealRef} id=${d?.id} status=${d?.status} unitId=${d?.unitId} feeAgreement=${d?.feeAgreement} aml=${d?.amlCheckCompleted}`);
}

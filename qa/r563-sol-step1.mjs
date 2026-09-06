const BASE='http://127.0.0.1:5000'; const PASSWORD='B@nd0077!';
const DEAL='11110000-0000-0000-0000-000000000301';
const UNIT='36c81e04-6f16-4951-8ea7-cbaf16b83741';
async function tok(u){const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:PASSWORD})});return (await r.json()).token;}
const t=await tok('victoria@brucegillinghampollard.com');
const put=await fetch(`${BASE}/api/crm/deals/${DEAL}`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({status:'SOL',feeAgreement:'NO',amlCheckCompleted:'YES'})});
console.log('PUT ->',put.status);
const g=async p=>{const r=await fetch(BASE+p,{headers:{Authorization:'Bearer '+t}});return r.ok?await r.json():{__s:r.status};};
const units=await g('/api/available-units'); const arrU=Array.isArray(units)?units:units.data||[];
const u=arrU.find(x=>x.id===UNIT);
console.log('unit still present?', !!u, u&&{dealId:u.dealId,marketingStatus:u.marketingStatus});
const deals=await g('/api/crm/deals'); const arrD=Array.isArray(deals)?deals:deals.data||[];
const d=arrD.find(x=>x.id===DEAL);
console.log('deal in /api/crm/deals?', !!d, d&&{status:d.status,dealRef:d.dealRef,fee:d.feeAgreement,aml:d.amlCheckCompleted});

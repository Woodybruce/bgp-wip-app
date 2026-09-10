const BASE='http://127.0.0.1:5000'; const DEAL='11110000-0000-0000-0000-000000000301';
const tok=async u=>(await (await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:'B@nd0077!'})})).json()).token;
const t=await tok('victoria@brucegillinghampollard.com');
const r=await fetch(`${BASE}/api/crm/deals/${DEAL}`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({feeAgreement:'YES',amlCheckCompleted:'YES',status:'SOL'})});
console.log('PUT ->',r.status);
const mt=await tok('mark.warne@landsec.com');
for (const [who,tk] of [['victoria',t],['mark',mt]]) {
  const j=await (await fetch(`${BASE}/api/crm/deals`,{headers:{Authorization:'Bearer '+tk}})).json();
  const arr=Array.isArray(j)?j:j.data||[]; const d=arr.find(x=>x.id===DEAL);
  console.log(who,'sees feeAgreement=',JSON.stringify(d?.feeAgreement),'amlCheckCompleted=',JSON.stringify(d?.amlCheckCompleted),'status=',d?.status);
}

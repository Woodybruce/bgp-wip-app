const BASE='http://127.0.0.1:5000'; const PASSWORD='B@nd0077!';
const PROP='cccccccc-0000-0000-0000-000000000001';
const CO='d25ec158-82df-4f50-8188-cae113af5f9f';
const DEAL='11110000-0000-0000-0000-000000000302';
async function tok(u){const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:PASSWORD})});return (await r.json()).token;}
const KEYS=['fee','feePercentage','commission','feeAgreement','feeAgreementUrl','feeNotes','poNumber','invoicedAt','amlSarReference','invoicingNotes','xeroAccountNumber'];
const t=await tok('mark.warne@landsec.com');
for (const p of [`/api/crm/properties/${PROP}/deals`, `/api/crm/companies/${CO}/deals`, '/api/crm/deals']) {
  const r=await fetch(BASE+p,{headers:{Authorization:'Bearer '+t}});
  if(!r.ok){console.log(`${p} -> ${r.status}`);continue;}
  const j=await r.json(); const arr=Array.isArray(j)?j:(j.data||[]);
  const d=arr.find(x=>x.id===DEAL);
  console.log(`\n--- ${p} (${arr.length} rows) ---`);
  if(!d){console.log('   probe deal not present'); continue;}
  for(const k of KEYS) console.log('   ',k,'=',JSON.stringify(d[k]));
}

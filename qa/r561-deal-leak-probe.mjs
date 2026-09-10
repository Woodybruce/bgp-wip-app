const BASE='http://127.0.0.1:5000'; const PASSWORD='B@nd0077!';
const DEAL='11110000-0000-0000-0000-000000000302';
async function tok(u){const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:PASSWORD})});return (await r.json()).token;}
const KEYS=['amlSarFiled','amlSarReference','amlSarFiledAt','amlComplianceNotes','amlPepStatus','amlPepNotes','amlEddReason','amlRiskLevel','mlrScopeReason','invoicingNotes','invoicingEmail','xeroContactName','xeroAccountNumber','xeroBillingAddress','fee','feeNotes','poNumber','invoicedAt'];
for (const who of ['mark.warne@landsec.com','victoria@brucegillinghampollard.com']) {
  const t=await tok(who);
  for (const p of [`/api/crm/deals`, `/api/crm/deals/${DEAL}`]) {
    const r=await fetch(BASE+p,{headers:{Authorization:'Bearer '+t}});
    if(!r.ok){console.log(`${who} ${p} -> ${r.status}`);continue;}
    const j=await r.json();
    const d=Array.isArray(j)? j.find(x=>x.id===DEAL) : (j.deal||j);
    if(!d){console.log(`${who} ${p} -> deal not in payload`);continue;}
    console.log(`\n--- ${who}  ${p} ---`);
    for(const k of KEYS) console.log('   ', k, '=', JSON.stringify(d[k]));
  }
}

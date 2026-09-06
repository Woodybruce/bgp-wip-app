const BASE='http://127.0.0.1:5000';
const tok=async u=>(await (await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:'B@nd0077!'})})).json()).token;
for (const who of ['victoria@brucegillinghampollard.com','mark.warne@landsec.com','sam.reed@hammerson.com']) {
  const t=await tok(who).catch(()=>null);
  if(!t){console.log(who,'-> no token');continue;}
  const r=await fetch(`${BASE}/api/insights`,{headers:{Authorization:'Bearer '+t}});
  const j=r.ok?await r.json():{__s:r.status};
  const rows=(j.insights||[]).filter(x=>/R563/.test(x.headline||''));
  console.log(`\n=== ${who} (${r.status}) sees ${rows.length} R563 row(s)`);
  for(const x of rows) console.log('   ',x.audience,'|',x.category,'|',x.headline,'| companyId=',x.company_id ?? x.companyId);
}

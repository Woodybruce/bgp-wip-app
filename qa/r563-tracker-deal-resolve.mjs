const BASE='http://127.0.0.1:5000'; const PASSWORD='B@nd0077!';
async function tok(u){const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:PASSWORD})});return (await r.json()).token;}
async function get(t,p){const r=await fetch(BASE+p,{headers:{Authorization:'Bearer '+t}});return r.ok?await r.json():{__status:r.status};}
for (const who of ['victoria@brucegillinghampollard.com','mark.warne@landsec.com']) {
  const t=await tok(who);
  const units = await get(t,'/api/available-units');
  const deals = await get(t,'/api/crm/deals');
  const arrU = Array.isArray(units)?units:(units.data||[]);
  const arrD = Array.isArray(deals)?deals:(deals.data||[]);
  const dm = new Map(arrD.map(d=>[d.id,d]));
  const linked = arrU.filter(u=>u.dealId);
  const unresolved = linked.filter(u=>!dm.has(u.dealId));
  console.log(`\n=== ${who} — units ${arrU.length}, deals ${arrD.length}, units with dealId ${linked.length}, UNRESOLVED ${unresolved.length}`);
  for (const u of unresolved.slice(0,10)) console.log(`   unit ${u.unitName} (${u.id}) dealId=${u.dealId} rowStatus=${u.marketingStatus}`);
  // status disagreement between unit row and its resolved deal
  let dis=0;
  for (const u of linked) { const d=dm.get(u.dealId); if(d && String(d.status||'').toUpperCase()!==String(u.marketingStatus||'').toUpperCase()) dis++; }
  console.log(`   rows whose own marketingStatus != linked deal status: ${dis}`);
}

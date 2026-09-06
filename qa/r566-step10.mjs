const BASE='http://127.0.0.1:5000';
async function tok(u){const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,password:'B@nd0077!'})});return (await r.json()).token;}
const t=await tok('mark.warne@landsec.com');
const H={authorization:'Bearer '+t};
// what does the client's letting tracker hold?
for(const p of ['/api/letting-tracker/units','/api/available-units','/api/letting-tracker']){
  const r=await fetch(BASE+p,{headers:H});
  console.log(p, r.status);
  if(r.ok){const j=await r.json(); const arr=Array.isArray(j)?j:(j.units||[]); console.log('  count',arr.length, arr[0]?Object.keys(arr[0]).slice(0,25).join(','):'');
    const hit=arr.filter(u=>/SVL02|Nando/i.test(JSON.stringify(u)));
    console.log('  SVL02/Nando matches:', hit.length, JSON.stringify(hit[0]||'').slice(0,400));
  }
}

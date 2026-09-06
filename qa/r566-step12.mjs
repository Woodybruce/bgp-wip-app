const BASE='http://127.0.0.1:5000';
async function tok(u){const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,password:'B@nd0077!'})});return (await r.json()).token;}
const PROP='cccccccc-0000-0000-0000-000000000001';
for(const who of ['mark.warne@landsec.com','victoria@brucegillinghampollard.com']){
  const t=await tok(who);
  const r=await fetch(`${BASE}/api/tenancy-schedule/property/${PROP}/export-excel`,{headers:{authorization:'Bearer '+t}});
  const buf=Buffer.from(await r.arrayBuffer());
  console.log(who.split('@')[0], r.status, r.headers.get('content-type'), 'bytes', buf.length);
  if(r.status>=400) console.log('  body:', buf.toString('utf8').slice(0,200));
}

const BASE='http://127.0.0.1:5000';
async function tok(u){const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,password:'B@nd0077!'})});const j=await r.json();return j.token;}
const PROP='cccccccc-0000-0000-0000-000000000001';
const mk=await tok('mark.warne@landsec.com'), vk=await tok('victoria@brucegillinghampollard.com');
const store={};
for(const [name,t] of [['mark',mk],['victoria',vk]]){
  const r=await fetch(`${BASE}/api/tenancy-schedule/property/${PROP}`,{headers:{authorization:'Bearer '+t}});
  console.log(name, r.status);
  if(!r.ok){console.log((await r.text()).slice(0,200)); continue;}
  const j=await r.json();
  const arr=Array.isArray(j)?j:(j.units||j.rows||j.data||[]);
  console.log(name,'payload keys:',Array.isArray(j)?'array':Object.keys(j).join(','));
  console.log(name,'count',arr.length);
  store[name]=arr;
  if(arr[0]) console.log(name,'row keys:', Object.keys(arr[0]).join(','));
  const f=(k)=>arr.filter(u=>u[k]!=null&&u[k]!=='').length;
  console.log(name,'passingRent',f('passingRent'),'breakDate',f('breakDate'),'leaseExpiry',f('leaseExpiry'),'expiryDate',f('expiryDate'),'ervPa',f('ervPa'),'quotingRent',f('quotingRent'));
  const b=arr.find(u=>u.breakDate);
  if(b) console.log(name,'sample break row:', JSON.stringify(b).slice(0,900));
}
if(store.mark&&store.victoria){
  const mkeys=new Set(Object.keys(store.mark[0]||{})), vkeys=new Set(Object.keys(store.victoria[0]||{}));
  console.log('keys only victoria:', [...vkeys].filter(k=>!mkeys.has(k)).join(','));
  console.log('keys only mark:', [...mkeys].filter(k=>!vkeys.has(k)).join(','));
}

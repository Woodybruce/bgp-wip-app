// r576 fixture restore — undo the phone-edit probe on Bluewater MSU9 letting.
const BASE='http://127.0.0.1:5000';
const UNIT='36c81e04-6f16-4951-8ea7-cbaf16b83741';
const t = (await (await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'})})).json()).token;
const H={Authorization:'Bearer '+t,'Content-Type':'application/json'};
let r = await fetch(`${BASE}/api/available-units/${UNIT}`,{method:'PATCH',headers:H,body:JSON.stringify({sqft:null,askingRent:null})});
console.log('unit PATCH', r.status);
const u = await (await fetch(`${BASE}/api/available-units/${UNIT}`,{headers:H})).json();
console.log('unit now', JSON.stringify({sqft:u.sqft,askingRent:u.askingRent,dealId:u.dealId}));
if (u.dealId) {
  r = await fetch(`${BASE}/api/crm/deals/${u.dealId}`,{method:'PATCH',headers:H,body:JSON.stringify({rentPa:null,totalAreaSqft:null})});
  console.log('deal PATCH', r.status);
  const d = await (await fetch(`${BASE}/api/crm/deals/${u.dealId}`,{headers:H})).json();
  console.log('deal now', JSON.stringify({rentPa:d.rentPa,totalAreaSqft:d.totalAreaSqft,status:d.status}));
}
const rows = await (await fetch(`${BASE}/api/tenancy-schedule/property/cccccccc-0000-0000-0000-000000000001`,{headers:H})).json();
const nia = (Array.isArray(rows)?rows:[]).reduce((s,x)=>s+Number(x.nia_sqft||0),0);
console.log('tenancy rows', Array.isArray(rows)?rows.length:'?', 'total NIA', nia);

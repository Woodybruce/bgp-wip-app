const BASE='http://localhost:5000';
const u = await (await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'})})).json();
const H={Authorization:'Bearer '+u.token};
const BW='cccccccc-0000-0000-0000-000000000001';
const j = async (p)=>{ const r=await fetch(BASE+p,{headers:H}); const t=await r.text(); try{return {s:r.status,d:JSON.parse(t)};}catch{return {s:r.status,d:t.slice(0,200)};} };
const props = await j('/api/crm/properties');
const bw = (Array.isArray(props.d)?props.d:props.d.properties||[]).find(p=>/Bluewater/i.test(p.name||''));
console.log('property row keys with unit/occ:', JSON.stringify(Object.fromEntries(Object.entries(bw||{}).filter(([k])=>/unit|occ|vacan|total/i.test(k)))));
const units = await j('/api/crm/properties/'+BW+'/units');
const arr = Array.isArray(units.d)?units.d:(units.d.units||[]);
console.log('units endpoint status', units.s, 'count', arr.length);
const byStatus = {}; for(const x of arr){ const k=(x.marketingStatus||x.status||'?'); byStatus[k]=(byStatus[k]||0)+1; }
console.log('by marketingStatus:', JSON.stringify(byStatus));
const occ = {}; for(const x of arr){ const k=(x.occupancyStatus||x.occupancy||'?'); occ[k]=(occ[k]||0)+1; }
console.log('by occupancy:', JSON.stringify(occ));
console.log('sample unit keys:', JSON.stringify(Object.keys(arr[0]||{})));

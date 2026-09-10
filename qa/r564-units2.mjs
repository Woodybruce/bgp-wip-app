const BASE='http://localhost:5000';
const u = await (await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'})})).json();
const H={Authorization:'Bearer '+u.token};
const LS='d25ec158-82df-4f50-8188-cae113af5f9f', BW='cccccccc-0000-0000-0000-000000000001';
const j=async(p)=>{const r=await fetch(BASE+p,{headers:H});const t=await r.text();try{return{s:r.status,d:JSON.parse(t)};}catch{return{s:r.status,d:t.slice(0,150)};}};
const co = await j('/api/leasing-schedule/company/'+LS);
const arr = Array.isArray(co.d)?co.d:[];
console.log('company leasing-schedule status', co.s, 'rows', arr.length);
const byProp={}; for(const x of arr){const k=x.property_id||x.propertyId||'?';byProp[k]=(byProp[k]||0)+1;}
console.log('rows by property:', JSON.stringify(byProp));
const bwRows = arr.filter(x=>(x.property_id||x.propertyId)===BW);
const st={}; for(const x of bwRows){const k=x.status||'?';st[k]=(st[k]||0)+1;}
console.log('BW rows', bwRows.length, 'by status', JSON.stringify(st));
const pj = await j('/api/leasing-schedule/property/'+BW);
const parr = Array.isArray(pj.d)?pj.d:(pj.d&&pj.d.units)||[];
console.log('property leasing-schedule status', pj.s, 'rows', parr.length);
const st2={}; for(const x of parr){const k=x.status||'?';st2[k]=(st2[k]||0)+1;}
console.log('BW property rows by status', JSON.stringify(st2));

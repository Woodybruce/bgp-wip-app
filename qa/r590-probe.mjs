// r590: does the client dashboard's Letting Tracker headline agree with the
// board it deep-links to? DB has 82 available_units (81 AVA + 1 NEG); the
// widget says "79 live lettings · 77 Available · 2 Negotiating".
const BASE='http://localhost:5000';
const login = async (e)=>{const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:e,password:'B@nd0077!'})});return r.json();};
const mark = await login('mark.warne@landsec.com');
const H={Authorization:`Bearer ${mark.token}`};
const units = await (await fetch(`${BASE}/api/available-units`,{headers:H})).json();
const deals = await (await fetch(`${BASE}/api/crm/deals`,{headers:H})).json();
console.log('units returned to Mark:', units.length, ' deals returned:', deals.length);
const byId={}; for(const d of deals) byId[d.id]=d.status;
const LETTING=['AVA','NEG','HOT','SOL','EXC','COM','OPP','WIT'];
const tally={};
const orphan=[];
for(const u of units){
  const dealStatus = u.dealId ? byId[u.dealId] : undefined;
  const eff = (u.dealId ? (byId[u.dealId]||null) : null) || u.marketingStatus || 'AVA';
  tally[eff]=(tally[eff]||0)+1;
  if(u.dealId && byId[u.dealId]===undefined) orphan.push(`${u.unitName} dealId=${u.dealId} NOT in /api/crm/deals`);
}
console.log('effective-status tally as the widget computes it:', tally);
console.log('units whose linked deal is NOT in the client deals list:', orphan.length);
orphan.slice(0,10).forEach(o=>console.log('   '+o));
const rawTally={}; for(const u of units) rawTally[u.marketingStatus]=(rawTally[u.marketingStatus]||0)+1;
console.log('raw marketing_status tally:', rawTally);

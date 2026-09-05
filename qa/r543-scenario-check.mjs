const BASE='http://localhost:5000';
async function tok(u){const r=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:'B@nd0077!'})});return (await r.json()).token;}
const v=await tok('victoria@brucegillinghampollard.com'); const m=await tok('mark.warne@landsec.com');
const rep=await fetch(BASE+'/api/board-report',{headers:{Authorization:'Bearer '+v}});
const body=await rep.json();
const cats=(body?.marketInsights?.categoryBreakdown||[]).map(c=>c.category);
console.log('victoria board-report', rep.status, 'cats:', JSON.stringify(cats));
console.log('raw brand keys:', cats.filter(c=>String(c).startsWith('brand:')).length);
const cr=await fetch(BASE+'/api/board-report',{headers:{Authorization:'Bearer '+m}});
const cx=await fetch(BASE+'/api/board-report/export-excel',{headers:{Authorization:'Bearer '+m}});
console.log('mark board-report', cr.status, 'export', cx.status);

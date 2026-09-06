const BASE = 'http://localhost:5000';
const r = await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ username:'victoria@brucegillinghampollard.com', password:'B@nd0077!' }) });
const u = await r.json();
const H = { Authorization: 'Bearer ' + u.token, 'content-type':'application/json' };
const deals = await (await fetch(`${BASE}/api/crm/deals`, { headers:H })).json();
console.log('n deals', deals.length);
for (const d of deals) console.log('DEAL', d.id, JSON.stringify((d.title||'').slice(0,40)), 'status=', d.status, 'unitId=', d.unitId);

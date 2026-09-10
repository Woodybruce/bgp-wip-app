const BASE = 'http://localhost:5000';
const r = await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ username:'victoria@brucegillinghampollard.com', password:'B@nd0077!' }) });
const u = await r.json();
const H = { Authorization: 'Bearer ' + u.token, 'content-type':'application/json' };
const put = await fetch(`${BASE}/api/crm/deals/11110000-0000-0000-0000-000000000301`, { method:'PUT', headers:H, body: JSON.stringify({ status: 'NEG', feeAgreement: 'YES' }) });
console.log('restore', put.status);

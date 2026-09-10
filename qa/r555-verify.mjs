// r555 verify: "Fees Billed YTD" must count invoiced deals only.
const BASE = 'http://localhost:5000';
const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }) });
const { token } = await r.json();
const H = { Authorization: 'Bearer ' + token, 'content-type': 'application/json' };
const get = async (p) => { const x = await fetch(BASE + p, { headers: H }); return { status: x.status, body: await x.json().catch(() => null) }; };

const before = await get('/api/board-report');
console.log('BEFORE  totalFeesYTD =', before.body.performance.totalFeesYTD, ' monthlyFees =', JSON.stringify(before.body.performance.monthlyFees));

const mk = await fetch(`${BASE}/api/crm/deals`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'QA-PROBE Billed Deal', fee: 111000, status: 'INV', invoicedAt: new Date().toISOString() }) });
const deal = await mk.json();
console.log('probe deal', mk.status, deal.id, deal.status, deal.fee);

const after = await get('/api/board-report');
console.log('AFTER   totalFeesYTD =', after.body.performance.totalFeesYTD, ' monthlyFees =', JSON.stringify(after.body.performance.monthlyFees));
console.log('topDeals', JSON.stringify((after.body.topDeals || []).map(d => [d.name, d.fee, d.status])));

const del = await fetch(`${BASE}/api/crm/deals/${deal.id}`, { method: 'DELETE', headers: H });
console.log('cleanup delete', del.status);
const end = await get('/api/board-report');
console.log('AFTER CLEANUP totalFeesYTD =', end.body.performance.totalFeesYTD);

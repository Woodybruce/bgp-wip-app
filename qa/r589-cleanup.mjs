// r589: remove QA leftovers from available_units through the real DELETE
// endpoint (it also cleans the stub deal + tenancy/leasing mirrors).
// Reports each DELETE's status — the r589 round found that the two-bot
// scenario staff-unit-writes-canonicalise-status leaks a row.
const BASE = 'http://localhost:5000';
const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }) });
const me = await r.json();
const H = { Authorization: `Bearer ${me.token}`, 'Content-Type': 'application/json' };
const list = await (await fetch(`${BASE}/api/available-units`, { headers: H })).json();
const all = Array.isArray(list) ? list : (list?.data || []);
const junk = all.filter(u => /QA-R58|ANC1 Bluewater - Whole Demise|QA-PORTFOLIO/i.test(u.unitName || ''));
console.log(`${all.length} listings; ${junk.length} QA leftover(s)`);
for (const u of junk) {
  const d = await fetch(`${BASE}/api/available-units/${u.id}`, { method: 'DELETE', headers: H });
  console.log(`  DELETE ${u.unitName} -> ${d.status}${d.ok ? '' : ' ' + (await d.text()).slice(0, 120)}`);
}
const after = await (await fetch(`${BASE}/api/available-units`, { headers: H })).json();
console.log(`listings now: ${(Array.isArray(after) ? after : after.data).length} (fixture baseline 81)`);

// Non-vacuity check for the r587 two-bot scenario: runs its exact fetch
// sequence and PRINTS what it saw, so an [ok] cannot hide a silent skip.
const BASE = 'http://127.0.0.1:5000';
const login = await (await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }) })).json();
const h = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
const units = await (await fetch(`${BASE}/api/available-units`, { headers: h })).json();
const rows = Array.isArray(units) ? units : (units?.data || units?.units || []);
const unit = rows.find(u => u.marketingStatus === 'AVA' && !u.dealId && u.propertyId);
console.log(`units in payload: ${rows.length}; candidate: ${unit ? `${unit.unitName} (${unit.id})` : 'NONE — SCENARIO WOULD SKIP'}`);
if (!unit) process.exit(1);
const brief = async () => {
  const r = await fetch(`${BASE}/api/properties/${unit.propertyId}/asset-brief`, { headers: h });
  const j = await r.json();
  const p = j.pipeline || {};
  return { hots: p.hots || 0, legals: p.legals || 0,
           total: ['engaged','viewed','pitch_out','hots','legals','signed'].reduce((a, k) => a + (p[k] || 0), 0) };
};
const setStatus = (st) => fetch(`${BASE}/api/available-units/${unit.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ marketingStatus: st }) });
const before = await brief();
const put = await setStatus('HOT');
console.log(`PATCH marketingStatus=HOT -> ${put.status}${put.ok ? '' : ' — SCENARIO WOULD SKIP'}`);
if (!put.ok) process.exit(1);
const after = await brief();
await setStatus('AVA');
const restored = await brief();
console.log(`before ${JSON.stringify(before)}\nafter  ${JSON.stringify(after)}\nrestored ${JSON.stringify(restored)}`);
console.log(after.hots === before.hots + 1 && after.total === before.total + 1 && restored.hots === before.hots
  ? 'SCENARIO FIRES FOR REAL and its assertions are live'
  : 'SCENARIO DID NOT MOVE THE NUMBERS');

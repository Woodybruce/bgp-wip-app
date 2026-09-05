// r555: follow ONE fee from the deal record through every surface that shows it.
const BASE = 'http://localhost:5000';
async function login(u) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: 'B@nd0077!' }) });
  const j = await r.json();
  if (!j.token) throw new Error('login failed ' + u + ' ' + JSON.stringify(j).slice(0,200));
  return j.token;
}
async function get(tok, path) {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + tok } });
  let b = null; try { b = await r.json(); } catch { b = null; }
  return { status: r.status, body: b };
}
const vt = await login('victoria@brucegillinghampollard.com');

const deals = await get(vt, '/api/crm/deals');
const withFee = (deals.body || []).filter(d => Number(d.fee) > 0);
console.log('DEALS total', (deals.body||[]).length, 'with fee>0', withFee.length);
for (const d of withFee) console.log('  DEAL', d.id, JSON.stringify({ name: d.name, fee: d.fee, status: d.status, team: d.team, targetDate: d.targetDate, completedAt: d.completedAt, exchangedAt: d.exchangedAt, updatedAt: d.updatedAt }));

const wip = await get(vt, '/api/wip');
const entries = Array.isArray(wip.body) ? wip.body : (wip.body?.entries || []);
console.log('\nWIP status', wip.status, 'entries', entries.length);
let wipSum = 0, invSum = 0;
for (const e of entries) { wipSum += Number(e.amtWip||0); invSum += Number(e.amtInvoice||0);
  console.log('  WIP', JSON.stringify({ deal: e.dealName || e.name, wip: e.amtWip, inv: e.amtInvoice, status: e.status, month: e.targetMonth || e.month })); }
console.log('  WIP totals: wip', wipSum, 'invoiced', invSum, 'sum', wipSum+invSum);

const br = await get(vt, '/api/board-report');
console.log('\nBOARD status', br.status);
if (br.body) {
  console.log('  performance', JSON.stringify(br.body.performance));
  console.log('  totalDeals', br.body.totalDeals);
  console.log('  topDeals', JSON.stringify((br.body.topDeals||[]).slice(0,10)));
}
const an = await get(vt, '/api/portfolio/landsec/analytics');
console.log('\nLANDSEC ANALYTICS status', an.status, an.body ? JSON.stringify({ totalDeals: an.body.totalDeals, totalWIP: an.body.totalWIP, totalInvoiced: an.body.totalInvoiced, pipelineValue: an.body.pipelineValue }) : '');

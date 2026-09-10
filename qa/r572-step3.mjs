import { page, go, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r572-staff-desktop-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 400000);
HARD.unref?.();
const api = async (p) => page.evaluate(async (u) => {
  const t = localStorage.getItem('bgp_auth_token');
  const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
  return { status: r.status, body: await r.text() };
}, p);
try {
  await go('/', 'kpi');
  const k = await api('/api/dashboard/kpi-trends');
  console.log('KPI-TRENDS', k.status, k.body.slice(0, 900));
  for (const p of ['/api/crm/deals', '/api/crm/properties', '/api/crm/contacts']) {
    const r = await api(p);
    let n = null; try { const j = JSON.parse(r.body); n = Array.isArray(j) ? j.length : (Array.isArray(j?.deals) ? j.deals.length : Object.keys(j).slice(0,8)); } catch {}
    console.log(`API ${p} -> ${r.status} len=${JSON.stringify(n)}`);
  }
} catch (e) { console.log('FATAL', String(e).slice(0,500)); }
await browser.close();

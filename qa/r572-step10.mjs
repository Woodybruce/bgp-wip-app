import { page, go, tap, report, shot, browser } from '/home/user/bgp-wip-app/qa/r572-staff-desktop-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 400000);
HARD.unref?.();
const WG = 'de222c86-d59c-42b5-842a-a545d0e7fa44';
const api = async (p) => page.evaluate(async (u) => { const t = localStorage.getItem('bgp_auth_token'); const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } }); return { status: r.status, body: await r.text() }; }, p);
try {
  await go(`/properties/${WG}`, 'westgate');
  const tabs = await page.evaluate(() => [...document.querySelectorAll('button,[role="tab"],a')].map(e=>({t:(e.innerText||'').replace(/\s+/g,' ').trim().slice(0,32),tid:e.getAttribute('data-testid')||''})).filter(x=>/tenanc|leasing|schedule|unit|overview/i.test(x.t)).slice(0,20));
  console.log('TABS', JSON.stringify(tabs));
  const r = await api(`/api/crm/companies/d25ec158-82df-4f50-8188-cae113af5f9f/property-summary?role=landlord`);
  console.log('PROP-SUMMARY', r.status, r.body.slice(0,600));
  for (const p of [`/api/properties/${WG}/tenancy-schedule`, `/api/properties/${WG}/leasing-schedule`]) {
    const x = await api(p);
    let s=''; try { const j=JSON.parse(x.body); s = Array.isArray(j)?`array len=${j.length}`:`keys=${Object.keys(j).join(',')} units=${(j.units||j.rows||[]).length}`; } catch { s = x.body.slice(0,120); }
    console.log(`API ${p} -> ${x.status} ${s}`);
  }
} catch (e) { console.log('FATAL', String(e).slice(0,500)); }
await browser.close();

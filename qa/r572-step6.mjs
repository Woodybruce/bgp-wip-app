import { page, go, tap, report, shot, browser } from '/home/user/bgp-wip-app/qa/r572-staff-desktop-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 400000);
HARD.unref?.();
const api = async (p) => page.evaluate(async (u) => {
  const t = localStorage.getItem('bgp_auth_token');
  const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
  return { status: r.status, body: await r.text() };
}, p);
try {
  await go('/instructions', 'instructions-full');
  const t = await page.evaluate(() => { const m = document.querySelector('[data-testid="instructions-page"]'); return (m?.innerText||document.body.innerText||'').replace(/\s+/g,' ').slice(0,1500); });
  console.log('--- INSTRUCTIONS PAGE ---\n' + t);
  await go('/', 'dash-instr');
  const w = await page.evaluate(() => {
    const link = [...document.querySelectorAll('a[href="/instructions"]')].pop();
    let card = link; for (let i=0;i<7 && card;i++) card = card.parentElement;
    return (card?.innerText||'').replace(/\s+/g,' ').slice(0,1200);
  });
  console.log('--- DASH INSTRUCTIONS WIDGET ---\n' + w);
  for (const p of ['/api/instructions', '/api/crm/instructions']) {
    const r = await api(p);
    console.log(`API ${p} -> ${r.status} ${r.body.slice(0,400)}`);
  }
} catch (e) { console.log('FATAL', String(e).slice(0,500)); }
await browser.close();

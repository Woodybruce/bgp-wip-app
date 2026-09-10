import { page, go, tap, report, shot, browser } from '/home/user/bgp-wip-app/qa/r572-staff-desktop-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 400000);
HARD.unref?.();
try {
  await go('/instructions', 'instructions');
  const t = await page.evaluate(() => (document.body.innerText||'').replace(/\s+/g,' ').slice(700, 4200));
  console.log('--- INSTRUCTIONS ---\n' + t);
  const tids = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')].map(e=>e.getAttribute('data-testid')))].slice(0,60));
  console.log('TIDS', JSON.stringify(tids));
} catch (e) { console.log('FATAL', String(e).slice(0,500)); }
await browser.close();

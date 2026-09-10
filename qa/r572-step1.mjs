import { page, go, report, shot, browser } from '/home/user/bgp-wip-app/qa/r572-staff-desktop-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 400000);
HARD.unref?.();
try {
  await go('/', 'dashboard');
  const t = await page.evaluate(() => (document.body.innerText||'').replace(/\n{2,}/g,'\n').slice(0, 4000));
  console.log('--- DASHBOARD TEXT ---\n' + t);
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href],button')].map(e => ({t:(e.innerText||'').replace(/\s+/g,' ').trim().slice(0,40), h:e.getAttribute('href')||'', tid:e.getAttribute('data-testid')||''})).filter(x=>x.t).slice(0,80));
  console.log('--- LINKS ---\n' + JSON.stringify(links));
} catch (e) { console.log('FATAL', String(e).slice(0,500)); }
await browser.close();

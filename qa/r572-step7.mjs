import { page, go, tap, report, shot, browser } from '/home/user/bgp-wip-app/qa/r572-staff-desktop-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 400000);
HARD.unref?.();
const body = (n=2500) => page.evaluate((k) => (document.body.innerText||'').replace(/\s+/g,' ').slice(0,k), n);
try {
  await go('/landlords', 'landlords');
  console.log('LANDLORDS', (await body(1800)).slice(600));
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href*="/company"],a[href*="/landlord"],[data-testid*="landlord"]')].map(e=>({t:(e.innerText||'').replace(/\s+/g,' ').trim().slice(0,40),h:e.getAttribute('href')||'',tid:e.getAttribute('data-testid')||''})).slice(0,25));
  console.log('LL-LINKS', JSON.stringify(links));
} catch (e) { console.log('FATAL', String(e).slice(0,500)); }
await browser.close();

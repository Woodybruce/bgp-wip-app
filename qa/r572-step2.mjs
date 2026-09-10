import { page, go, report, shot, browser } from '/home/user/bgp-wip-app/qa/r572-staff-desktop-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 400000);
HARD.unref?.();
try {
  await go('/', 'dashboard-top');
  const t = await page.evaluate(() => (document.body.innerText||'').replace(/\n{2,}/g,'\n').slice(0, 2600));
  console.log('--- DASHBOARD HEAD ---\n' + t);
} catch (e) { console.log('FATAL', String(e).slice(0,500)); }
await browser.close();

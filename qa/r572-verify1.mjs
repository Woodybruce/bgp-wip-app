import { page, go, tap, report, shot, browser } from '/home/user/bgp-wip-app/qa/r572-staff-desktop-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 400000);
HARD.unref?.();
try {
  await go('/landlords', 'landlords-fixed-overview');
  console.log('OVERVIEW', await page.evaluate(() => (document.querySelector('[data-testid="page-landlords"]')?.innerText||'').replace(/\s+/g,' ').slice(0,900)));
  await tap('[data-testid="tab-portfolio"]', 'landlords-fixed-table');
  console.log('TABLE', await page.evaluate(() => (document.querySelector('table')?.innerText||'').replace(/\n/g,' || ').slice(0,900)));
} catch (e) { console.log('FATAL', String(e).slice(0,500)); }
await browser.close();

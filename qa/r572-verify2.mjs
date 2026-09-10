import { page, go, tap, report, shot, browser } from '/home/user/bgp-wip-app/qa/r572-staff-desktop-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 400000);
HARD.unref?.();
try {
  await go('/landlords', 'landlords-final');
  console.log('LEADERBOARD', await page.evaluate(() => { const b=(document.querySelector('[data-testid="page-landlords"]')?.innerText||'').replace(/\s+/g,' '); const i=b.indexOf('Biggest portfolios'); return b.slice(i, i+220); }));
  await go('/leasing-schedule', 'leasing-board-unfiltered');
  console.log('LEASING', await page.evaluate(() => (document.body.innerText||'').replace(/\s+/g,' ').slice(600,1500)));
} catch (e) { console.log('FATAL', String(e).slice(0,500)); }
await browser.close();

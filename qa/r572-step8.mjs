import { page, go, tap, report, shot, browser } from '/home/user/bgp-wip-app/qa/r572-staff-desktop-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 400000);
HARD.unref?.();
const LANDSEC = 'd25ec158-82df-4f50-8188-cae113af5f9f';
try {
  await go('/landlords', 'landlords-overview');
  console.log('OVERVIEW', await page.evaluate(() => (document.querySelector('[data-testid="page-landlords"]')?.innerText||'').replace(/\s+/g,' ').slice(0,900)));
  await tap('[data-testid="tab-portfolio"]', 'landlords-portfolio-tab');
  console.log('TABLE', await page.evaluate(() => (document.querySelector('table')?.innerText||'').replace(/\t/g,' | ').replace(/\n/g,' || ').slice(0,900)));
  await go(`/companies/${LANDSEC}`, 'landsec-company');
  const t = await page.evaluate(() => (document.body.innerText||'').replace(/\s+/g,' '));
  const i = t.search(/Propert/i);
  console.log('COMPANY-PAGE around Properties:', t.slice(Math.max(0,i-200), i+1200));
} catch (e) { console.log('FATAL', String(e).slice(0,500)); }
await browser.close();

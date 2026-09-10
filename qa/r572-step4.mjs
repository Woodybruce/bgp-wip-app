import { page, go, tap, report, shot, browser } from '/home/user/bgp-wip-app/qa/r572-staff-desktop-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 400000);
HARD.unref?.();
const pills = () => page.evaluate(() => { const o={}; for (const b of document.querySelectorAll('[data-testid^="stat-card-"]')) o[b.getAttribute('data-testid').replace('stat-card-','')] = (b.innerText||'').replace(/\s+/g,' ').trim(); return o; });
try {
  await go('/', 'dash');
  // the letting-tracker widget's own summary chips
  const widget = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href^="/deals/letting"]')].slice(0,6)
      .map(e => ({ t:(e.innerText||'').replace(/\s+/g,' ').trim().slice(0,60), h:e.getAttribute('href') }));
    const w = [...document.querySelectorAll('[data-testid]')].filter(e=>/letting|tracker/i.test(e.getAttribute('data-testid'))).map(e=>e.getAttribute('data-testid'));
    return { a, w };
  });
  console.log('WIDGET', JSON.stringify(widget));
  await tap('a[href="/deals/letting?status=AVA"]', 'tracker-ava-deeplink');
  console.log('PILLS', JSON.stringify(await pills()));
  const rows = await page.evaluate(() => document.querySelectorAll('[data-testid^="button-edit-"]').length);
  console.log('ROWS-VISIBLE', rows);
  const head = await page.evaluate(() => (document.body.innerText||'').replace(/\s+/g,' ').slice(0,900));
  console.log('HEAD', head);
} catch (e) { console.log('FATAL', String(e).slice(0,500)); }
await browser.close();

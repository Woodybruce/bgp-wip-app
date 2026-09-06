import { go, tap, report, page, shot, browser } from './r552-client-mobile-journey.mjs';
const PROP = 'cccccccc-0000-0000-0000-000000000001';
await go(`/tenancy-schedule/${PROP}`, 'full-board');
await tap('[data-testid="tenancy-stat-vacant"]', 'vacant-tile');
// follow the LT badge on the first vacant card — it promises the Letting Tracker
const lt = page.locator('[data-testid^="tenancy-card-"] >> text=LT').first();
if (await lt.count()) {
  console.log('LT badge href:', await page.evaluate(() => {
    const c = document.querySelector('[data-testid^="tenancy-card-"]');
    return [...c.querySelectorAll('a')].map(a=>a.getAttribute('href')+' :: '+a.innerText.replace(/\n/g,' ')).join(' | ');
  }));
  await lt.click({ timeout: 6000 }).catch(e=>console.log('LT click fail', String(e).slice(0,120)));
  await report('after-lt', { text: true });
}
await browser.close();

import { go, tap, page, browser } from './r560-client-mobile-journey.mjs';
await go('/deals', 'deals-tab-wait');
await page.waitForTimeout(6000);
const info = await page.evaluate(() => ({
  txt: document.body.innerText.slice(0,1500),
  html: document.querySelector('#root > div')?.innerHTML.slice(0, 1200) || '(none)',
}));
console.log('TXT after 6s:\n'+info.txt);
console.log('\nHTML:\n'+info.html);
await page.screenshot({ path: 'qa/smoke-shots/r560-deals-blank.png' });
// now the explicit list route
await go('/deals/list', 'deals-list', { text: true, full: true });
await browser.close();

import { go, tap, page, browser, report } from './r614-journey.mjs';
await go('/brands', 'hub-fixed');
await page.waitForTimeout(4000);
const tiles = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('div').forEach(d => {
    const lab = d.querySelector(':scope > div.text-\\[11px\\]');
    const val = d.querySelector(':scope > div.text-2xl');
    if (lab && val) out.push(`${lab.textContent.trim()} = ${val.textContent.trim()}`);
  });
  return out;
});
console.log('TILES: ' + JSON.stringify(tiles));
await tap('text=BRAND EXPLORER', 'explorer-cats');
const cats = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.replace(/\n/g, ' ')).filter(t => /^(All Brands|Fashion|Food|Leisure|Health|Luxury)/.test(t)));
console.log('EXPLORER CATEGORY CARDS: ' + JSON.stringify(cats));
// journey continues: the client's Requirements surface
await go('/requirements', 'requirements', { text: true });
await browser.close();

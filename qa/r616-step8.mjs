import { go, tap, report, shot, page, browser, BASE } from './r600-client-mobile-journey.mjs';
const PID = 'cccccccc-0000-0000-0000-000000000001';
await page.goto(BASE + '/properties/' + PID).catch(()=>{});
await page.waitForTimeout(14000);
await tap('button:text-is("Boards")', 'boards', {});
await page.waitForTimeout(4000);
const info = await report('boards-settled', {});
console.log('BOARD TEXT:', await page.evaluate(() => (document.body.innerText||'').slice(600, 3200)));
console.log('WIDEST:', await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('table, [class*="overflow-x"], .grid')) {
    if (el.scrollWidth > el.clientWidth + 4) out.push(`${el.tagName}.${(el.className||'').toString().slice(0,60)} scroll=${el.scrollWidth} client=${el.clientWidth}`);
  }
  return out.slice(0,8).join(' || ');
}));
await browser.close();

import { go, tap, report, shot, page, browser, BASE } from './r600-client-mobile-journey.mjs';
const PID = 'cccccccc-0000-0000-0000-000000000001';
await page.goto(BASE + '/properties/' + PID).catch(()=>{});
await page.waitForTimeout(14000);
await tap('button:text-is("Boards")', 'boards', {});
await page.waitForTimeout(4000);
console.log('TOP:', await page.evaluate(() => (document.body.innerText||'').slice(0, 1400)));
await shot('boards-top');
await browser.close();

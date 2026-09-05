// r544 driver — Mark's phone task: "an agent asked about a Bluewater unit".
const H = await import('./r544-client-mobile-journey.mjs');
const { page, go, tap, report, shot, browser } = H;

// 1. Open the deal the agent asked about
await go('/deals', 'deals');
await tap('text=U124 Bluewater', 'deal-detail-U124');
console.log('   deal text:', await page.evaluate(() => (document.body.innerText||'').replace(/\s+/g,' ').slice(0, 900)));

// 2. Letting tracker — the unit itself
await go('/available', 'letting-tracker');
console.log('   tracker text:', await page.evaluate(() => (document.body.innerText||'').replace(/\s+/g,' ').slice(0, 900)));

// 3. Search a unit on the tracker
const search = page.locator('input[placeholder*="earch" i]').first();
if (await search.count()) {
  await search.fill('U124');
  await report('tracker-search-U124');
  console.log('   filtered:', await page.evaluate(() => (document.body.innerText||'').replace(/\s+/g,' ').slice(0, 700)));
}

// 4. Unit card actions
await tap('button:has-text("Files")', 'unit-files-dialog');
console.log('   files dialog:', await page.evaluate(() => (document.querySelector('[role=dialog]')?.innerText||'NO DIALOG').replace(/\s+/g,' ').slice(0, 600)));
await page.keyboard.press('Escape').catch(()=>{});
await page.waitForTimeout(600);

await browser.close();

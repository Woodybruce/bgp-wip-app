import { go, tap, page, browser } from './r560-client-mobile-journey.mjs';
await go('/deals/list', 'deals-list');
await page.waitForTimeout(3000);
// filter chips: do they deliver what they count?
for (const label of ['SOLICITORS','EXCHANGED','ALL']) {
  const el = page.locator(`text=${label}`).first();
  await el.click({ timeout: 5000 }).catch(e=>console.log('chip click fail',label,String(e).slice(0,120)));
  await page.waitForTimeout(1200);
  const t = await page.evaluate(()=>document.body.innerText.replace(/\n{2,}/g,'\n'));
  console.log(`\n--- after chip ${label} ---\n${t.slice(0,700)}`);
  await page.screenshot({ path: `qa/smoke-shots/r560-chip-${label}.png` });
}
// open the deal
await tap('text=U124 Bluewater', 'deal-open');
await page.waitForTimeout(5000);
const t = await page.evaluate(()=>({p:location.pathname,txt:document.body.innerText.replace(/\n{2,}/g,'\n'),ov:document.documentElement.scrollWidth-window.innerWidth}));
console.log(`\n== DEAL ${t.p} overflow ${t.ov}\n${t.txt.slice(0,3500)}`);
await page.screenshot({ path: 'qa/smoke-shots/r560-deal-profile.png' });
await browser.close();

import { go, page, browser } from './r560-client-mobile-journey.mjs';
const LINKS = ['Tracker','Requirements','Brands','Deals','Images'];
for (const L of LINKS) {
  await go('/', `home-${L}`);
  await page.waitForTimeout(1000);
  let bucket = [];
  const onres = (r)=>{ if(r.status()>=400) bucket.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:5000','')}`); };
  page.on('response', onres);
  const ok = await page.locator(`text="${L}"`).first().click({ timeout: 5000 }).then(()=>true).catch(()=>false);
  if (!ok) { console.log(`\n!! ${L}: not tappable`); page.off('response',onres); continue; }
  await page.waitForTimeout(5500);
  const info = await page.evaluate(()=>({p:location.pathname+location.search,txt:document.body.innerText.replace(/\n{2,}/g,'\n').trim(),ov:document.documentElement.scrollWidth-window.innerWidth}));
  await page.screenshot({ path: `qa/smoke-shots/r560-ql-${L}.png` });
  page.off('response', onres);
  console.log(`\n=== QUICKLINK "${L}" -> ${info.p} | ${info.txt.length} chars${info.ov>1?` | H-OVERFLOW +${info.ov}`:''}`);
  for (const b of [...new Set(bucket)]) console.log('   '+b);
  console.log(info.txt.slice(0,700));
}
await browser.close();

import { go, page, browser } from './r560-client-mobile-journey.mjs';
const LINKS = ['Tracker','Requirements','Brands','Deals','Images','CRM','Calendar','News','Comps','SharePoint','Property Intelligence'];
for (const L of LINKS) {
  await go('/', `home-for-${L}`);
  await page.waitForTimeout(1200);
  let bucket = [];
  const onres = (r)=>{ if(r.status()>=400) bucket.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:5000','')}`); };
  page.on('response', onres);
  const el = page.locator(`text="${L}"`).first();
  const ok = await el.click({ timeout: 5000 }).then(()=>true).catch(()=>false);
  if (!ok) { console.log(`\n!! ${L}: no tappable element`); page.off('response',onres); continue; }
  await page.waitForTimeout(5000);
  const info = await page.evaluate(()=>({p:location.pathname+location.search,txt:document.body.innerText.replace(/\n{2,}/g,'\n').trim(),ov:document.documentElement.scrollWidth-window.innerWidth,boundary:/Something went wrong|not found|No access|Access denied/i.test(document.body.innerText||'')}));
  await page.screenshot({ path: `qa/smoke-shots/r560-ql-${L.replace(/\W+/g,'-')}.png` });
  page.off('response', onres);
  console.log(`\n=== QUICKLINK "${L}" -> ${info.p} | ${info.txt.length} chars${info.ov>1?` | H-OVERFLOW +${info.ov}`:''}${info.boundary?' | SUSPECT TEXT':''}`);
  for (const b of [...new Set(bucket)]) console.log('   '+b);
  console.log(info.txt.slice(0,900));
}
await browser.close();

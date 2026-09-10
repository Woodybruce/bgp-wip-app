import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(()=>{console.log('!! HARD TIMEOUT');process.exit(9);},350000); HARD.unref?.();
const chk=(n,c)=>console.log(`${c?'  ok ':'  FAIL'} ${n}`);
try {
  const w = await go('/wip-report', 'verify-wip');
  const title = await page.evaluate(()=> (document.querySelector('[data-testid="wip-report-title"]')?.textContent||'').replace(/\s+/g,' ').trim());
  console.log('TITLE:', JSON.stringify(title));
  chk('wip title no longer claims National Leasing', !/National Leasing/.test(title));
  chk('wip title says All Teams', /All Teams/.test(title));
  chk('total still £250,000', /Total net fees: £250,000/.test(await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))));
  chk('no h-overflow', (w.overflow||0) <= 1);

  const d = await go('/deals/44444444-4444-4444-4444-444444444444', 'verify-deal');
  const badge = await page.evaluate(()=> (document.querySelector('[data-testid="badge-fee-total"]')?.textContent||'').trim());
  console.log('FEE BADGE:', JSON.stringify(badge));
  chk('deal page now shows the fee', /250,000/.test(badge));
  chk('deal page no h-overflow', (d.overflow||0) <= 1);
  await shot('verify-deal-fee');
  await browser.close();
} catch(e){ console.log('FATAL',e); await browser.close(); process.exit(1); }

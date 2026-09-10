import { go, tap, report, shot, page, browser, BASE, user } from './r600-client-mobile-journey.mjs';
const PID = 'cccccccc-0000-0000-0000-000000000001';
await page.goto(BASE + '/properties/' + PID).catch(()=>{});
await page.waitForTimeout(14000);
await report('overview', {});
for (const pill of ['Boards','Deals & units','Files & contacts','KYC','Activity']) {
  await tap(`button:text-is("${pill}")`, 'pill-' + pill.replace(/\W+/g,'-'), { text: true });
}
// what does /api/users give a client? (the focus card's assignee dropdown)
const u = await page.evaluate(async (tok) => {
  const r = await fetch('/api/users', { headers: { Authorization: 'Bearer ' + tok } });
  const b = await r.text();
  return r.status + ' :: ' + b.slice(0, 400);
}, user.token);
console.log('API /api/users AS CLIENT:', u);
await browser.close();

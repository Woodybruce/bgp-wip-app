import { go, page, browser, report, user, BASE } from './r614-journey.mjs';
const ID = '77777777-7777-7777-7777-777777777777';
await go(`/companies/${ID}`, 'brand-direct');
await page.waitForTimeout(8000);
await report('brand-direct-settled', { text: true, full: true });
const html = await page.evaluate(() => {
  const main = document.querySelector('main') || document.body;
  return { bodyLen: document.body.innerHTML.length, mainLen: main.innerHTML.length, mainHtml: main.innerHTML.slice(0, 600) };
});
console.log(JSON.stringify(html, null, 1).slice(0, 1500));
const api = await page.evaluate(async (t) => {
  const j = async (u) => { const r = await fetch(u, { headers: { Authorization: 'Bearer ' + t } }); const txt = await r.text(); return { u, s: r.status, b: txt.slice(0, 300) }; };
  return [await j('/api/crm/companies/77777777-7777-7777-7777-777777777777'),
          await j('/api/crm/companies?limit=5')];
}, user.token);
console.log(JSON.stringify(api, null, 1).slice(0, 2000));
await browser.close();

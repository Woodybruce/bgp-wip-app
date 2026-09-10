import { go, tap, page, browser, user } from './r614-journey.mjs';
await go('/brands', 'hub');
await tap('text=BRAND EXPLORER', 'explorer');
const info = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('*').forEach(el => {
    if (el.children.length === 0 && /Honi Poke/.test(el.textContent || '')) {
      let a = el, chain = [];
      for (let i = 0; i < 6 && a; i++, a = a.parentElement) {
        const r = a.getBoundingClientRect();
        chain.push(`${a.tagName}${a.getAttribute('data-testid') ? '#' + a.getAttribute('data-testid') : ''}.${(a.className || '').toString().slice(0, 60)} [${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}]`);
      }
      out.push(chain);
    }
  });
  return out;
});
console.log(JSON.stringify(info, null, 1).slice(0, 3000));
await browser.close();

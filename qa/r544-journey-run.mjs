const H = await import('./r544-client-mobile-journey.mjs');
const { page, go, tap, shot, browser } = H;
await go('/properties/cccccccc-0000-0000-0000-000000000001', 'prop-news-after');
const dupes = await page.evaluate(() => {
  const links = [...document.querySelectorAll('a[data-testid^="news-article-"]')];
  return links.slice(0, 6).map(a => {
    const ps = [...a.querySelectorAll('p')].map(p => p.textContent.trim());
    return { lines: ps.length, first: ps[0]?.slice(0, 60), second: ps[1]?.slice(0, 60) || null };
  });
});
console.log(JSON.stringify(dupes, null, 1));
await page.evaluate(() => { const a=document.querySelector('a[data-testid^="news-article-"]'); a?.scrollIntoView({block:'center'}); });
await page.waitForTimeout(800);
await shot('prop-news-after-shot');
await browser.close();

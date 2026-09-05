// Standalone check of the r544 pair: client phone starter prompts are
// landlord-voiced, staff phone prompts keep the BGP set.
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE = 'http://localhost:5000';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
for (const [who, u] of [['mark', 'mark.warne@landsec.com'], ['victoria', 'victoria@brucegillinghampollard.com']]) {
  const ctx = await b.newContext({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: u, password: 'B@nd0077!' } });
  const user = await r.json();
  const page = await ctx.newPage();
  await page.goto(BASE).catch(() => {});
  await page.evaluate(([t, uu]) => { localStorage.setItem('authToken', t); localStorage.setItem('bgp_auth_token', t); localStorage.setItem('user', JSON.stringify(uu)); }, [user.token, user]);
  await page.goto(`${BASE}/messages`).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  await page.locator('[data-testid="mobile-pinned-chatbgp"]').first().click();
  await page.waitForTimeout(2500);
  const chips = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="mobile-suggestion-"]')].map(e => e.textContent.trim()));
  console.log(who, '| path', await page.evaluate(() => location.pathname + location.search), '| chips:', JSON.stringify(chips));
  await ctx.close();
}
await b.close();

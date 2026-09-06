import { go, page, browser, ctx, BASE, user } from './r560-client-mobile-journey.mjs';
const H = { Authorization: `Bearer ${user.token}` };
const ins = await ctx.request.get(`${BASE}/api/microsoft/calendar/insights`, { headers: H });
console.log('MARK insights ->', ins.status(), (await ins.text()).slice(0,1600));
const vr = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const v = await vr.json();
if (v.token) {
  const vi = await ctx.request.get(`${BASE}/api/microsoft/calendar/insights`, { headers: { Authorization: `Bearer ${v.token}` } });
  console.log('\nVICTORIA insights ->', vi.status(), (await vi.text()).slice(0,1600));
}
await go('/calendar', 'calendar-mobile');
await page.waitForTimeout(4000);
const t = await page.evaluate(()=>({txt:document.body.innerText.replace(/\n{2,}/g,'\n'),ov:document.documentElement.scrollWidth-window.innerWidth}));
console.log(`\n== CALENDAR overflow ${t.ov}\n${t.txt.slice(0,2000)}`);
await page.screenshot({ path: 'qa/smoke-shots/r560-calendar-client.png', fullPage: true });
await browser.close();

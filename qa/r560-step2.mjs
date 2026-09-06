import { go, tap, page, browser, ctx, BASE, user } from './r560-client-mobile-journey.mjs';
const H = { Authorization: `Bearer ${user.token}` };
await go('/tasks', 'tasks2');
await tap('[data-testid="task-row-7ca8bf74-537b-4e96-90d6-c82d1d224cd9"]', 'task-open', { text: true, full: true });
await go('/deals', 'deals-tab', { text: true, full: true, ids: true });
// what does the portfolio-activity panel actually query?
for (const p of ['/api/client/team-activity','/api/tasks','/api/client/tasks','/api/activity']) {
  const r = await ctx.request.get(BASE + p, { headers: H });
  console.log(`API ${p} -> ${r.status()} ${(await r.text()).slice(0,300)}`);
}
await browser.close();

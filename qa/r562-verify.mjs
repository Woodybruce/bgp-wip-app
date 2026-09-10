import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 420000);
HARD.unref?.();
const UNIT = '36c81e04-6f16-4951-8ea7-cbaf16b83741';
const DEAL = '11110000-0000-0000-0000-000000000301';
try {
  await go('/', 'cold');
  // put the deal back to Negotiating (this round's own save regressed it)
  const restore = await page.evaluate(async (d) => {
    const tok = localStorage.getItem('bgp_auth_token');
    const r = await fetch(`/api/crm/deals/${d}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'NEG' }) });
    return { s: r.status, b: (await r.text()).slice(0, 140) };
  }, DEAL);
  console.log('-- RESTORE DEAL', JSON.stringify(restore));
  await go('/available', 'tracker');
  await page.waitForTimeout(2500);
  const before = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' ').slice(0, 260));
  console.log('-- BEFORE', JSON.stringify(before));
  await tap(`[data-testid="unit-edit-${UNIT}"]`, 'unit-edit');
  await page.waitForTimeout(1800);
  const field = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const t = (dlg?.innerText || '').replace(/\s+/g,' ');
    const i = t.indexOf('Unit Status');
    return t.slice(i, i + 70);
  });
  console.log('-- UNIT STATUS FIELD', JSON.stringify(field));
  await page.locator('[role="dialog"] textarea').first().fill('R562 verify — post-fix note');
  await page.locator('[role="dialog"] button', { hasText: /^Save$/ }).first().click({ timeout: 8000 });
  await page.waitForTimeout(3500);
  await report('after-save');
  const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' ').slice(0, 260));
  console.log('-- AFTER ', JSON.stringify(after));
  const deal = await page.evaluate(async (d) => {
    const tok = localStorage.getItem('bgp_auth_token');
    const j = await (await fetch('/api/crm/deals', { headers: { Authorization: 'Bearer ' + tok } })).json();
    const x = j.find(y => y.id === d); return x && { status: x.status };
  }, DEAL);
  console.log('-- DEAL AFTER SAVE', JSON.stringify(deal));
  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }

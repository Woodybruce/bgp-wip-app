// r631 verify: (a) the client Edit dialog no longer carries staff-only
// controls, (b) a client's own legitimate edit still saves, (c) the never-
// tested button-deal-image-studio, (d) the phone Deals list with a warm.
import { page, ctx, go, tap, report, warm, browser, BASE, user, assertPhoneShell } from './r623-mark-phone-journey.mjs';
const DEAL = '11110000-0000-0000-0000-000000000301';
const STAFF_ONLY = ['input-deal-fee','select-deal-fee-agreement','select-deal-aml','deal-xero-contact-search','input-deal-po-number','input-deal-invoiced-at','select-deal-team','input-deal-agent','card-fee-allocation','button-edit-fee-allocation'];

await assertPhoneShell();

// (d) the phone Deals tab, warmed properly
await warm('/deals', 12000);
await go('/deals', 'deals-warm', { text: true, settle: 4000 });
const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid]')]
  .map(e => e.getAttribute('data-testid')).filter(t => /deal/i.test(t)).slice(0, 25));
console.log('   deal-ish testids on the phone deals tab:', cards.join(' ') || '(none)');

await go(`/deals/${DEAL}`, 'deal-detail', { settle: 3500 });
await tap('[data-testid="button-edit-deal"]:visible', 'edit-dialog', { settle: 2500 });
const dlg = await page.evaluate((ids) => {
  const d = document.querySelector('[role="dialog"]');
  return { labels: [...d.querySelectorAll('label')].map(l => (l.textContent||'').trim()),
           leaks: ids.filter(t => !!d.querySelector(`[data-testid="${t}"]`)) };
}, STAFF_ONLY);
console.log('\nLABELS NOW:', dlg.labels.join(' | '));
console.log(`STAFF-ONLY CONTROLS STILL PRESENT: ${dlg.leaks.length ? dlg.leaks.join(', ') : 'NONE'}`);

// (b) Mark's own legitimate edit — the task: push the target date out a month
const newDate = '2026-11-30';
await page.fill('[data-testid="input-deal-target-date"]', newDate);
await page.fill('[data-testid="input-deal-comments"]', 'Chased brand for HoTs comments — Mark, from phone');
page.on('request', r => { if (/api\/crm\/deals/.test(r.url()) && r.method() !== 'GET') console.log(`   >>> ${r.method()} ${r.url().replace(BASE,'')} ${String(r.postData()||'').slice(0,200)}`); });
page.on('response', async r => { if (/api\/crm\/deals/.test(r.url()) && r.request().method() !== 'GET') console.log(`   <<< ${r.status()} ${(await r.text().catch(()=>'')).slice(0,160)}`); });
await tap('[data-testid="button-save-deal"]', 'saved', { settle: 4000 });
console.log('   toast/validation text: ' + (await page.evaluate(() => { const d=document.querySelector('[role="dialog"]'); return JSON.stringify({ dialogStillOpen: !!d, invalid: [...document.querySelectorAll(':invalid')].map(e=>e.getAttribute('data-testid')||e.tagName).slice(0,6), toast: (document.querySelector('[role="status"],[data-radix-toast-viewport]')?.innerText||'').slice(0,200) }); })));
const after = await (await ctx.request.get(`${BASE}/api/crm/deals/${DEAL}`, { headers: { Authorization: `Bearer ${user.token}` } })).json();
console.log(`\nWRITE: targetDate=${String(after.targetDate).slice(0,10)} (wanted ${newDate}) comments=${JSON.stringify(String(after.comments||'').slice(0,60))}`);
console.log(`   aml=${JSON.stringify(after.amlCheckCompleted)} status=${after.status} internalAgent=${JSON.stringify(after.internalAgent)}  [must be untouched]`);
await go(`/deals/${DEAL}`, 'deal-after-save', { text: true, settle: 3000 });

// (c) Image Studio from the client phone deal detail
await tap('[data-testid="button-deal-image-studio"]:visible', 'image-studio', { text: true, settle: 5000 });
await browser.close();

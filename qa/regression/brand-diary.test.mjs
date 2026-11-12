// The Diary view of the Brand CRM: what BGP staff are drawn, what a full
// Landsec login is drawn and what a joint agent is drawn. The server cuts the
// list to the viewer; this checks the screen groups it, and adds no button,
// tick or brand-page link for a viewer who was not sent the right to it.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

globalThis.React = React;
const { QueryClientProvider } = await import('@tanstack/react-query');
const { Router } = await import('wouter');
const { queryClient } = await import('../../client/src/lib/queryClient.ts');
const { Diary } = await import('../../client/src/components/brand-crm/diary.tsx');

after(() => queryClient.clear());

const item = (over) => ({
  id: 'crm_action:a1', kind: 'crm_action', title: 'Send the plans', date: '2026-11-16', daysWaiting: null, overdue: false,
  brand: { id: 'b1', name: 'Test Subs' }, scheme: { key: 'bluewater', name: 'Bluewater' }, unitLabel: 'Unit L104', owner: 'Alex Todd', waitingOn: null,
  raisedBy: 'bgp', status: 'todo', actionId: null, canComplete: false, url: '/brands?tab=crm&view=strategies&company=b1&action=a1', ...over,
});
const diary = (items, over = {}) => ({ items, counts: { overdue: 1, thisWeek: 1, nextWeek: 1, later: 0, waiting: 1 }, today: '2026-11-12', canAddAction: false, canAddRequest: false, warnings: [], ...over });

const staffItems = [
  item({ id: 'crm_action:late', title: 'Agree the extraction route', date: '2026-11-10', overdue: true, actionId: 'late', canComplete: true, waitingOn: { side: 'landsec', name: 'Landsec asset manager' } }),
  item({ id: 'viewing_booked:v1', kind: 'viewing_booked', title: 'Viewing booked', date: '2026-11-13', raisedBy: null, status: null, url: '/available?propertyId=p&unitId=au' }),
  item({ id: 'crm_action:a1', raisedBy: 'client', status: 'in_progress' }),
  item({ id: 'deal_waiting:d1', kind: 'deal_waiting', title: 'Deal waiting on Tenant', date: null, daysWaiting: 12, brand: { id: 'b2', name: 'Yo Chi' }, scheme: { key: 'white-rose', name: 'White Rose' },
    unitLabel: null, owner: 'Sam Reed', waitingOn: { side: 'other', name: 'Tenant' }, raisedBy: null, status: null, url: '/deals/d1' }),
];

function draw(staff, data) {
  queryClient.setQueryData([staff ? '/api/brand-crm/diary' : '/api/landsec/diary'], data);
  const html = renderToStaticMarkup(React.createElement(Router, { ssrPath: '/' },
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(Diary, { staff }))));
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), ids: [...html.matchAll(/data-testid="([^"]+)"/g)].map(m => m[1]), hrefs: [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]) };
}

test('BGP staff get the list grouped by date, the kind pills with counts, Add action and a tick on an action they may edit', () => {
  const view = draw(true, diary(staffItems, { canAddAction: true, warnings: ['Viewings could not be read.'] }));
  assert.match(view.text, /4 items · 1 overdue · 1 waiting on someone/);
  assert.match(view.text, /Group by Date Person Brand Scheme/);
  assert.match(view.text, /Everything 4 CRM actions 2 Viewings booked 1 Deals waiting 1 Waiting on Landsec 1/);
  // Sections in order: Overdue, This week, Next week, Waiting. No empty Later section.
  const order = ['Overdue 1', 'This week 1', 'Next week 1', 'Waiting 1'].map(label => view.text.indexOf(label));
  assert.ok(order.every((at, i) => at > -1 && (i === 0 || at > order[i - 1])), order.join(','));
  assert.doesNotMatch(view.text, /Later 0|Later 1/);
  assert.match(view.text, /Agree the extraction route CRM actions Test Subs Bluewater · Unit L104 Alex Todd Landsec asset manager/);
  assert.match(view.text, /Send the plans CRM actions Raised by the client · In progress/);
  assert.match(view.text, /12 days waiting Deal waiting on Tenant Deals waiting Yo Chi White Rose Sam Reed Tenant/);
  assert.ok(view.ids.includes('brand-diary-add-action') && !view.ids.includes('brand-diary-add-request'));
  assert.deepEqual(view.ids.filter(id => id.startsWith('brand-diary-done-')), ['brand-diary-done-crm_action:late']);
  for (const id of ['brand-diary-group-date', 'brand-diary-group-person', 'brand-diary-group-brand', 'brand-diary-group-scheme', 'brand-diary-kind-all', 'brand-diary-kind-crm_action',
    'brand-diary-kind-deal_waiting', 'brand-diary-filter-waiting-landsec', 'brand-diary-table-0', 'brand-diary-item-deal_waiting:d1']) assert.ok(view.ids.includes(id), id);
  assert.ok(!view.ids.includes('brand-diary-kind-brief_signature'));     // no pill for a kind with nothing in it
  assert.ok(view.hrefs.includes('/deals/d1') && view.hrefs.includes('/companies/b1'));
  assert.match(view.text, /Viewings could not be read\./);
});

test('a full Landsec login gets Add request, its own requests and BGP\'s shared actions labelled, and no tick on BGP\'s', () => {
  const view = draw(false, diary([
    item({ id: 'crm_action:own', title: 'Introduce them to Trinity', raisedBy: 'client', actionId: 'own', canComplete: true, scheme: null, unitLabel: null, url: '/companies/b1' }),
    item({ id: 'crm_action:shared', title: 'Agree the extraction route', url: '/companies/b1' }),
    item({ id: 'case_response:c1', kind: 'case_response', title: 'Brand case awaiting your reply', date: null, daysWaiting: 3, scheme: null, unitLabel: null, owner: null,
      waitingOn: { side: 'landsec', name: 'You' }, raisedBy: null, status: null, url: '/landsec/brand-case/b1' }),
  ], { canAddRequest: true }));
  assert.ok(view.ids.includes('brand-diary-add-request') && !view.ids.includes('brand-diary-add-action'));
  assert.match(view.text, /Introduce them to Trinity CRM actions Your request to BGP/);
  assert.match(view.text, /Agree the extraction route CRM actions From BGP/);
  assert.deepEqual(view.ids.filter(id => id.startsWith('brand-diary-done-')), ['brand-diary-done-crm_action:own']);
  assert.match(view.text, /3 days waiting Brand case awaiting your reply Brand cases Test Subs/);
  assert.ok(view.hrefs.includes('/landsec/brand-case/b1'));
  assert.doesNotMatch(view.text, /Raised by the client/);
});

test('a joint agent gets brand names with no brand page, no tick and neither add button', () => {
  const view = draw(false, diary([
    item({ id: 'crm_action:shared', brand: { id: null, name: 'Test Subs' }, url: '/landsec/scheme/bluewater' }),
    item({ id: 'deal_waiting:d1', kind: 'deal_waiting', title: 'Deal waiting on Landsec asset manager', date: null, daysWaiting: 5, brand: { id: null, name: 'Yo Chi' },
      waitingOn: { side: 'landsec', name: 'Landsec asset manager' }, raisedBy: null, status: null, url: '/landsec/unit/ts-1' }),
  ]));
  assert.match(view.text, /Test Subs/);
  assert.ok(view.hrefs.every(href => !href.startsWith('/companies') && !href.startsWith('/brands') && !href.startsWith('/deals')), view.hrefs.join(' '));
  assert.ok(!view.ids.some(id => id.startsWith('brand-diary-done-') || id.startsWith('brand-diary-add-')));
});

test('an account the server refuses, and an empty diary, each say so', () => {
  assert.match(draw(false, null).text, /The diary is not available for this account\./);
  assert.match(draw(false, diary([])).text, /Nothing in the diary for your schemes\./);
  assert.match(draw(true, diary([], { canAddAction: true })).text, /Nothing in the diary\. Brand actions, booked viewings/);
});

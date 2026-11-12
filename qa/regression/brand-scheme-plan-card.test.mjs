// The "Schemes and units" card on a brand's page (Brand CRM): what BGP staff
// are drawn, what a Landsec view is drawn, and that a refused login gets no
// card. The server cuts the plan to the viewer; this checks the screen draws
// no BGP control or note for a plan it is told it cannot edit.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

globalThis.React = React;
const { QueryClientProvider } = await import('@tanstack/react-query');
const { Router } = await import('wouter');
const { queryClient } = await import('../../client/src/lib/queryClient.ts');
const { SchemePlanCard } = await import('../../client/src/components/brand-crm/scheme-plan-card.tsx');

// The cache keeps a timer per query: clear it so the run ends.
after(() => queryClient.clear());

const row = over => ({
  key: 'b|bluewater|u1', companyId: 'b', brandName: 'Test Subs',
  scheme: { key: 'bluewater', name: 'Bluewater', group: 'South', propertyId: 'p1' },
  unit: { key: 'u1', tenancyUnitId: 'u1', trackerId: 't1', label: 'Unit L104', sqft: 1850, occupier: 'Other Burger', leaseExpiry: '2027-03-24', splitKey: false },
  stage: 'hots', stageLabel: 'HOTs', stageSince: '2026-11-01T00:00:00Z', daysAtStage: 11,
  evidence: [{ src: 'hots', label: 'Heads of terms issued', at: '2026-11-01T00:00:00Z' }], notes: [], notProceedingReason: null,
  requirement: { chip: 'place_fits_size_out', requirementId: 'r1', unitSqft: 1850, range: { min: 2000, max: 3000 } },
  nextStep: { kind: 'deal_waiting', title: 'Waiting on Landsec asset manager', dueAt: null, daysWaiting: 5, who: null, refId: 'd1' },
  owner: { id: 'u', name: 'Alex Todd', source: 'deal' },
  links: { tracker: '/available?propertyId=p1&unitId=t1', deal: '/deals/d1', unitPage: '/landsec/unit/u1', property: '/properties/p1', scheme: '/landsec/scheme/bluewater', brandCase: null },
  wish: null, ...over,
});
const wanted = wish => row({
  key: 'b|gunwharf-quays|none', scheme: { key: 'gunwharf-quays', name: 'Gunwharf Quays', group: 'Outlets', propertyId: 'p2' }, unit: null,
  stage: 'wanted', stageLabel: 'Wanted', daysAtStage: 0, evidence: [{ src: 'wish', label: 'Wanted at this scheme', at: '2026-11-12T10:00:00Z' }],
  requirement: { chip: 'no_requirement', requirementId: null, unitSqft: null, range: null }, nextStep: null, owner: null,
  links: { tracker: null, deal: null, unitPage: null, property: '/properties/p2', scheme: '/landsec/scheme/gunwharf-quays', brandCase: null }, wish,
});
const staffPlan = {
  brand: { id: 'b', name: 'Test Subs', logoUrl: null, headline: '2 schemes: 1 at HOTs, 1 wanted', onHold: true, lead: { id: 'u', name: 'Alex Todd' }, aim: 'Three stores in 2027',
    nextAction: { id: 'a1', title: 'Call the property director', dueAt: '2026-11-20T09:00:00Z', ownerName: 'Alex Todd' } },
  requirements: [{ id: 'r1', summary: '2,000-3,000 sq ft · South East', ageDays: 12, source: 'PIPnet', detailHidden: false }],
  rows: [row({}), wanted({ id: 'w1', note: 'Keen on the QSR row', visibleToClient: false, ruledOut: false, createdByName: 'Alex Todd', requirementId: null })],
  notProceeding: [row({ key: 'b|white-rose|none', scheme: { key: 'white-rose', name: 'White Rose', group: 'North', propertyId: 'p3' }, unit: null, stage: 'not_proceeding', stageLabel: 'Not proceeding',
    notProceedingReason: 'Town ruled out', evidence: [{ src: 'wish', label: 'Wanted line ruled out', at: '2026-11-02T00:00:00Z' }], nextStep: null,
    wish: { id: 'w2', note: null, visibleToClient: true, ruledOut: true, createdByName: null, requirementId: null } })],
  askedNoTarget: [{ place: 'South East', schemes: [{ key: 'westgate-oxford', name: 'Westgate Oxford' }] }],
  canEdit: true, warnings: [],
};
// What the Landsec door sends: no BGP header fields, no note, nothing to edit.
const clientPlan = {
  brand: { id: 'b', name: 'Test Subs', logoUrl: null, headline: '2 schemes: 1 at HOTs, 1 wanted' },
  requirements: [{ id: 'r1', summary: 'Requirement held', ageDays: null, source: null, detailHidden: true }],
  rows: [row({ links: { ...row({}).links, brandCase: '/landsec/brand-case/b' } }), wanted({ id: 'w1', note: null, visibleToClient: true, ruledOut: false, createdByName: 'Alex Todd', requirementId: null })],
  notProceeding: [], askedNoTarget: [], canEdit: false, warnings: [],
};

function draw(client, plan) {
  queryClient.setQueryData([client ? '/api/landsec/brand-crm/plan' : '/api/brand-crm/plan', 'b'], plan);
  const html = renderToStaticMarkup(React.createElement(Router, { ssrPath: '/' },
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(SchemePlanCard, { companyId: 'b', client }))));
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), ids: [...html.matchAll(/data-testid="([^"]+)"/g)].map(m => m[1]), hrefs: [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&')) };
}

test('BGP staff get the headline, lead, On hold, next step, the lines with their links, and the Wanted line controls', () => {
  const card = draw(false, staffPlan);
  assert.match(card.text, /Schemes and units 2 schemes: 1 at HOTs, 1 wanted/);
  assert.match(card.text, /Lead Alex Todd Next step Call the property director · Alex Todd · Due 20 Nov Aim: Three stores in 2027/);
  assert.match(card.html, /aria-pressed="true"[^>]*data-testid="scheme-plan-on-hold"|data-testid="scheme-plan-on-hold"[^>]*aria-pressed="true"/);
  assert.match(card.text, /Requirement 2,000-3,000 sq ft · South East · PIPnet · updated 12 days ago Open requirements/);
  for (const heading of ['Scheme', 'Unit', 'Stage', 'Requirement', 'Next step', 'Owner']) assert.match(card.html, new RegExp(`<th[^>]*>${heading}</th>`));
  assert.match(card.text, /Bluewater Unit L104 1,850 sq ft Now Other Burger Lease to 24 Mar 2027 HOTs Heads of terms issued, 1 Nov 2026 · 11 days Place fits, size outside their range 1,850 sq ft, outside the 2,000 to 3,000 we allow around the size they asked for Waiting on Landsec asset manager Waiting 5 days Alex Todd/);
  assert.match(card.text, /Gunwharf Quays No unit yet Wanted Wanted at this scheme, 12 Nov 2026 · today Note: Keen on the QSR row Show to Landsec Edit note Retire the Wanted line/);
  assert.match(card.text, / On hold Scheme Lead /);
  for (const href of ['/available?propertyId=p1&unitId=t1', '/deals/d1', '/landsec/unit/u1', '/requirements?companyId=b']) assert.ok(card.hrefs.includes(href), href);
  assert.match(card.text, /Asked for, no target yet South East Westgate Oxford/);
  assert.match(card.text, /Not proceeding \(1\) White Rose Town ruled out · Wanted line ruled out, 2 Nov 2026 · 11 days Bring back the Wanted line/);
  for (const id of ['scheme-plan-add', 'scheme-plan-table', 'scheme-plan-list', 'scheme-plan-wish-visible-1', 'scheme-plan-wish-retire-1', 'scheme-plan-wish-restore-s0', 'scheme-plan-asked-add-westgate-oxford']) assert.ok(card.ids.includes(id), id);
  assert.doesNotMatch(card.text, /Also at/);
});

test('a brand with no requirement and no lines says so, with Add requirement for staff only', () => {
  const empty = { ...staffPlan, brand: { ...staffPlan.brand, headline: 'No schemes or units yet', onHold: false, lead: null, nextAction: null, aim: null }, requirements: [], rows: [], notProceeding: [], askedNoTarget: [] };
  const staff = draw(false, empty);
  assert.match(staff.text, /No schemes or units yet .*Lead not set Next step none set No requirement held Add requirement No scheme or unit is recorded for this brand yet\. Add the schemes we want it in with \+ Scheme\./);
  assert.ok(staff.hrefs.includes('/requirements?companyId=b&new=1'));
  // Off hold, the pill is an action, not a status every brand seems to carry.
  assert.match(staff.text, / Put on hold Scheme /);
  assert.doesNotMatch(staff.text, / On hold /);
  // A scheme with no property record is named, not offered as a button that can only fail.
  const noRecord = draw(false, { ...empty, askedNoTarget: [{ place: 'London', schemes: [{ key: 'one-new-change', name: 'One New Change', noProperty: true }, { key: 'westgate-oxford', name: 'Westgate Oxford' }] }] });
  assert.match(noRecord.text, /Asked for, no target yet London One New Change \(no property record yet\) Westgate Oxford/);
  assert.ok(!noRecord.ids.includes('scheme-plan-asked-add-one-new-change') && noRecord.ids.includes('scheme-plan-asked-add-westgate-oxford'));
  const client = draw(true, { ...empty, brand: { id: 'b', name: 'Test Subs', logoUrl: null, headline: 'No schemes or units yet' }, canEdit: false });
  assert.match(client.text, /No requirement held No scheme or unit is recorded for this brand yet\. $/);
  assert.deepEqual(client.hrefs, []);
});

test('a Landsec view is drawn no BGP control: no lead, On hold, + Scheme, note, tick or retire', () => {
  const card = draw(true, clientPlan);
  assert.match(card.text, /Schemes and units 2 schemes: 1 at HOTs, 1 wanted Requirement Requirement held Open requirements/);
  assert.match(card.text, /Gunwharf Quays No unit yet Wanted Wanted at this scheme/);
  assert.doesNotMatch(card.text, /Lead |On hold|Aim:|Note:|Show to Landsec|Retire|Bring back|Add requirement|Press a scheme/);
  assert.deepEqual(card.ids.filter(id => /on-hold|scheme-plan-add|staff-line|wish|asked-add/.test(id)), []);
});

test('an asset manager is told how many other schemes the brand is at, and has no requirements page link', () => {
  const card = draw(true, { ...clientPlan, rows: [clientPlan.rows[0]], otherSchemeCount: 2 });
  assert.match(card.text, /Also at 2 other schemes\. See the brand case/);
  assert.ok(card.hrefs.includes('/landsec/brand-case/b'));
  assert.ok(!card.hrefs.some(href => href.startsWith('/requirements')));
  assert.doesNotMatch(draw(true, { ...clientPlan, otherSchemeCount: 0 }).text, /Also at/);
});

test('a unit the brand already trades from or has let is not judged against its requirement, unless the line is linked to it', () => {
  const held = over => row({ stage: 'trading', stageLabel: 'Trading', nextStep: null, ...over });
  const trading = draw(false, { ...staffPlan, rows: [held({})], notProceeding: [] });
  assert.doesNotMatch(trading.text, /Place fits|outside the 2,000/);
  assert.doesNotMatch(draw(false, { ...staffPlan, rows: [held({ stage: 'let', stageLabel: 'Let' })], notProceeding: [] }).text, /Place fits/);
  const linked = draw(false, { ...staffPlan, rows: [held({ requirement: { chip: 'linked', requirementId: 'r1', unitSqft: 1850, range: null } })], notProceeding: [] });
  assert.match(linked.text, /Linked to their requirement/);
});


test('a login the server refuses gets no card', () => {
  assert.equal(draw(true, null).html, '');
  assert.equal(draw(false, null).html, '');
});

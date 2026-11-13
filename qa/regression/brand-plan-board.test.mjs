// The Targets board of the Brand CRM: the grid BGP staff are drawn, the one a
// Landsec view is drawn, and the one a joint agent is drawn. The server cuts
// the grid to the viewer; this checks the screen adds no BGP filter, column
// or brand-page link for a viewer who was not sent the data for it.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

globalThis.React = React;
const { QueryClientProvider } = await import('@tanstack/react-query');
const { Router } = await import('wouter');
const { queryClient } = await import('../../client/src/lib/queryClient.ts');
const { PlanBoard } = await import('../../client/src/components/brand-crm/plan-board.tsx');

after(() => queryClient.clear());

const SCHEMES = [
  { key: 'bluewater', name: 'Bluewater', group: 'South' },
  { key: 'white-rose', name: 'White Rose', group: 'North' },
  { key: 'gunwharf-quays', name: 'Gunwharf Quays', group: 'Outlets' },
  { key: 'cardinal-place', name: 'Cardinal Place', group: 'London' },
];
const staffGrid = {
  schemes: SCHEMES, canEdit: true, warnings: ['Offer rounds could not be read.'],
  brands: [
    { key: 'b1', id: 'b1', name: 'Test Subs', logoUrl: null, requirementHeld: true, furthest: 'hots', wantedNoUnit: 1, onHold: true, lead: { id: 'u', name: 'Alex Todd' }, openActions: 2, nextAction: null,
      cells: {
        bluewater: { stage: 'hots', count: 2, rowKeys: ['b1|bluewater|u1', 'b1|bluewater|u2'], wanted: 0, owners: ['Alex Todd'], noNextStep: 0 },
        'gunwharf-quays': { stage: 'wanted', count: 1, rowKeys: ['b1|gunwharf-quays|none'], wanted: 1, owners: ['Sam Reed'], noNextStep: 1 },
      } },
    { key: 'b2', id: 'b2', name: 'Yo Chi', logoUrl: null, requirementHeld: false, furthest: null, wantedNoUnit: 0, onHold: false, lead: null, openActions: 0, nextAction: null, cells: {} },
  ],
};
// What the Landsec door sends a full Landsec login: no BGP columns on a brand or a cell.
const clientGrid = {
  schemes: SCHEMES, canEdit: false, warnings: [],
  brands: [{ key: 'b1', id: 'b1', name: 'Test Subs', logoUrl: null, requirementHeld: true, furthest: 'hots', wantedNoUnit: 0,
    cells: { bluewater: { stage: 'hots', count: 1, rowKeys: ['b1|bluewater|u1'], wanted: 0 } } }],
};
// A joint agent: its own scheme, an opaque key, no brand id.
const jointGrid = {
  schemes: [SCHEMES[0]], canEdit: false, warnings: [],
  brands: [{ key: 'b1', id: null, name: 'Test Subs', logoUrl: null, requirementHeld: true, furthest: 'viewed', wantedNoUnit: 0, rows: [],
    cells: { bluewater: { stage: 'viewed', count: 1, rowKeys: ['b1|bluewater|u1'], wanted: 0 } } }],
};

function draw(staff, grid) {
  queryClient.setQueryData([staff ? '/api/brand-crm/plan' : '/api/landsec/brand-crm/plan'], grid);
  const html = renderToStaticMarkup(React.createElement(Router, { ssrPath: '/' },
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(PlanBoard, { staff }))));
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), ids: [...html.matchAll(/data-testid="([^"]+)"/g)].map(m => m[1]), hrefs: [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]) };
}

test('BGP staff get every scheme in its group, the furthest stage per cell, their own filters and brands with no line yet', () => {
  const board = draw(true, staffGrid);
  // Groups run North, South, Outlets, London whatever order the schemes arrive in.
  assert.match(board.text, /Brand North South Outlets London White Rose Bluewater Gunwharf Quays Cardinal Place/);
  assert.match(board.text, /2 brands across 4 schemes\. Landsec schemes only/);
  assert.match(board.text, /Test Subs On hold 2 schemes · Requirement held · Lead Alex Todd · 2 open actions HOTs 2 Wanted/);
  assert.match(board.text, /Yo Chi No scheme yet · No requirement/);
  assert.match(board.text, /All stages 2 Wanted 1 HOTs 1/);
  assert.match(board.text, /Scheme Owner No next step 1 Wanted, no unit 1/);
  for (const id of ['brand-plan-grid', 'brand-plan-search', 'brand-plan-stage-all', 'brand-plan-stage-hots', 'brand-plan-stage-wanted', 'brand-plan-scheme-filter', 'brand-plan-owner-filter',
    'brand-plan-filter-no-next-step', 'brand-plan-filter-wanted', 'brand-plan-cell-0-bluewater', 'brand-plan-cell-0-gunwharf-quays', 'brand-plan-brand-1']) assert.ok(board.ids.includes(id), id);
  assert.ok(!board.ids.includes('brand-plan-cell-0-white-rose') && !board.ids.includes('brand-plan-cell-1-bluewater'));
  assert.ok(board.hrefs.includes('/landsec/scheme/bluewater'));
  assert.match(board.text, /Offer rounds could not be read\./);
});

test('a Landsec view gets the grid with no owner or next-step filter and nothing of BGP on a brand', () => {
  const board = draw(false, clientGrid);
  assert.match(board.text, /1 brand across 4 schemes/);
  assert.doesNotMatch(board.text, /Landsec schemes only|Lead |open action|On hold|No requirement|No next step|Owner/);
  assert.match(board.text, /Test Subs 1 scheme · Requirement held HOTs/);
  for (const id of ['brand-plan-owner-filter', 'brand-plan-filter-no-next-step']) assert.ok(!board.ids.includes(id), id);
  for (const id of ['brand-plan-scheme-filter', 'brand-plan-filter-wanted', 'brand-plan-cell-0-bluewater']) assert.ok(board.ids.includes(id), id);
});

test('a joint agent gets its own scheme only, brand names and stages, and no link to a brand page', () => {
  const board = draw(false, jointGrid);
  assert.match(board.text, /1 brand across 1 scheme/);
  assert.match(board.text, /Brand South Bluewater Test Subs 1 scheme · Requirement held Viewed/);
  assert.ok(!board.ids.includes('brand-plan-scheme-filter'));      // one scheme: nothing to choose
  assert.ok(board.hrefs.every(href => !href.startsWith('/companies') && !href.startsWith('/brands')), board.hrefs.join(' '));
  assert.doesNotMatch(board.text, /other scheme/);
});

test('an account the server refuses, and an empty grid, each say so', () => {
  assert.match(draw(false, null).text, /Targets are not available for this account\./);
  assert.match(draw(false, { ...clientGrid, brands: [] }).text, /No brand has a line at your schemes yet\./);
  assert.match(draw(true, { ...staffGrid, brands: [] }).text, /No brand has a line at a Landsec scheme yet\./);
});

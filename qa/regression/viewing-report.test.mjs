import assert from 'node:assert/strict';
import test from 'node:test';
import { buildViewingReport } from '../../shared/viewing-report.ts';
const visit = (id, extra = {}) => ({ id, unitId: 'unit-1', physicalUnitId: 'physical-1', companyId: 'brand-1', viewingDate: '2026-06-01', status: 'completed', confirmed: true, ownerUserId: 'owner-1', team: 'Retail', ...extra });
const offer = (id, extra = {}) => ({ id, unitId: 'unit-1', physicalUnitId: 'physical-1', companyId: 'brand-1', offerDate: '2026-06-15', confirmed: true, ...extra });
const report = extra => buildViewingReport({ viewings: [], offers: [], from: '2026-06-01', to: '2026-06-30', asOf: '2026-09-30', ...extra });

test('repeat viewings, duplicate inputs and offer revisions count one brand/physical-unit opportunity', () => {
  const v = visit('first');
  const r = report({ viewings: [v, v, visit('repeat', { viewingDate: '2026-06-10', unitId: 'renewed-listing' })], offers: [offer('first-offer'), offer('revision', { offerDate: '2026-06-20', unitId: 'renewed-listing' })] });
  assert.equal(r.totals.viewings, 2);
  assert.equal(r.totals.completedOpportunities, 1);
  assert.equal(r.totals.confirmedOfferOpportunities, 1);
  assert.equal(r.totals.conversionRate, 100);
  assert.equal(r.totals.repeatViewings, 1);
  assert.equal(r.opportunities[0].offerIds.length, 2);
});

test('first completed view across all history establishes cohort and owner before filters', () => {
  const rows = [visit('old', { viewingDate: '2026-05-15', ownerUserId: 'owner-2', team: 'Office' }), visit('repeat')];
  assert.equal(report({ viewings: rows, offers: [offer('offer')] }).totals.completedOpportunities, 0);
  assert.equal(report({ viewings: rows, ownerUserId: 'owner-1' }).totals.completedOpportunities, 0);
  assert.equal(report({ viewings: rows, team: 'Retail' }).totals.completedOpportunities, 0);
  const sameMonth = [visit('first', { ownerUserId: 'owner-2', team: 'Office' }), visit('repeat', { viewingDate: '2026-06-10' })];
  assert.equal(report({ viewings: sameMonth, ownerUserId: 'owner-1' }).totals.completedOpportunities, 0);
  assert.equal(report({ viewings: sameMonth, ownerUserId: 'owner-2' }).totals.completedOpportunities, 1);
});

test('offers before viewing, unconfirmed suggestions, other brands/units and offers outside the window do not convert', () => {
  const r = report({ viewings: [visit('first')], offers: [offer('prior', { offerDate: '2026-05-31' }), offer('draft', { confirmed: false }), offer('wrong-brand', { companyId: 'brand-2' }), offer('wrong-unit', { physicalUnitId: 'physical-2' }), offer('late', { offerDate: '2026-08-31' })] });
  assert.equal(r.totals.confirmedOfferOpportunities, 0);
  assert.equal(r.totals.conversionRate, 0);
  assert.equal(r.coverage.unconfirmedOffers, 1);
});

test('same-day and day-90 confirmed offers count, but observations never extend past asOf', () => {
  assert.equal(report({ viewings: [visit('v')], offers: [offer('o', { offerDate: '2026-06-01' })] }).totals.confirmedOfferOpportunities, 1);
  assert.equal(report({ viewings: [visit('v')], offers: [offer('o', { offerDate: '2026-08-30' })] }).totals.confirmedOfferOpportunities, 1);
  assert.equal(report({ viewings: [visit('v')], offers: [offer('o')], asOf: '2026-06-10' }).totals.confirmedOfferOpportunities, 0);
});

test('recent cohorts have a separate mature-window denominator rather than becoming mature failures', () => {
  const r = report({ viewings: [visit('early'), visit('late', { companyId: 'brand-2', viewingDate: '2026-06-30' })], offers: [offer('early-offer')], asOf: '2026-09-01' });
  assert.equal(r.totals.completedOpportunities, 2);
  assert.equal(r.totals.conversionRate, 50);
  assert.equal(r.totals.matureOpportunities, 1);
  assert.equal(r.totals.matureConversionRate, 100);
});

test('unreviewed completed visits and missing IDs remain coverage gaps, not conversions from names', () => {
  const r = report({ viewings: [visit('unconfirmed', { confirmed: false }), visit('no-brand', { companyId: null, companyName: 'brand-1' }), visit('no-unit', { physicalUnitId: null, unitId: null }), visit('bad-date', { viewingDate: '2026-02-30' }), visit('unknown-status', { status: null })], offers: [offer('o')] });
  assert.equal(r.totals.completedOpportunities, 0);
  assert.equal(r.totals.conversionRate, null);
  assert.equal(r.totals.unresolved, 3);
  assert.equal(r.coverage.unconfirmedCompleted, 1);
  assert.equal(r.coverage.missingBrand, 1);
  assert.equal(r.coverage.missingUnit, 1);
  assert.equal(r.coverage.invalidViewingDate, 1);
  assert.equal(r.coverage.unknownStatus, 1);
  assert.equal(report({ viewings: [visit('old-unreviewed', { confirmed: false, viewingDate: '2026-05-15' }), visit('reviewed-repeat')] }).totals.completedOpportunities, 0);
});

test('scheduled, cancelled, no-show and non-leasing events have separate counts and never form cohorts', () => {
  const r = report({ viewings: [visit('pending', { status: 'scheduled' }), visit('cancelled', { status: 'cancelled' }), visit('no-show', { status: 'no_show' }), visit('inspection', { status: 'not_leasing' }), visit('deleted', { deletedAt: '2026-06-02' })] });
  assert.equal(r.totals.viewings, 4);
  assert.equal(r.totals.pending, 1);
  assert.equal(r.totals.cancelled, 1);
  assert.equal(r.totals.noShow, 1);
  assert.equal(r.totals.notLeasing, 1);
  assert.equal(r.totals.completedOpportunities, 0);
});

test('report boundaries are validated as real calendar dates and windows must be bounded', () => {
  for (const input of [{ from: '2026-02-30' }, { to: '2026-05-01' }, { asOf: 'nonsense' }, { conversionWindowDays: 0 }, { conversionWindowDays: 90.5 }]) assert.throws(() => report(input));
});

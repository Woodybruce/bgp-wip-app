import assert from 'node:assert/strict';
import test from 'node:test';
import { nextViewingWorkingDay, viewingFollowupDecision } from '../../server/viewing-followups.ts';

const viewing = extra => ({ id: 'viewing-1', unitId: 'unit-1', companyId: 'brand-1', contactId: 'contact-1', agentContactId: null, ownerUserId: 'owner-1', viewingDate: '2026-09-18', viewingTime: '14:00', status: 'scheduled', outcome: null, detailsConfirmedAt: '2026-09-17T09:00:00Z', createdAt: '2026-09-16T09:00:00Z', companyName: 'Brand', unitName: 'Unit 1', propertyName: 'Property', ...extra });
const decision = (extra, date = '2026-09-21T10:00:00Z') => viewingFollowupDecision(viewing(extra), new Date(date));

test('missing details prompt immediately and keep the original due day across sweeps', () => {
  const row = { companyId: null, contactId: null, detailsConfirmedAt: null };
  const first = decision(row, '2026-09-16T10:00:00Z');
  const later = decision(row, '2026-09-19T10:00:00Z');
  assert.equal(first.kind, 'details');
  assert.equal(first.dueDate, '2026-09-16');
  assert.equal(later.dueDate, first.dueDate);
  assert.ok(first.reasons.includes('Confirm the brand'));
  assert.ok(first.reasons.includes('Choose a brand contact or representing agent'));
  assert.equal(first.emailOverdue, false);
  assert.equal(later.emailOverdue, true);
});

test('confirmed future bookings have no follow-up and Friday outcomes wait until Monday', () => {
  assert.equal(decision({}, '2026-09-17T15:00:00Z').needed, false);
  assert.equal(decision({}, '2026-09-19T15:00:00Z').needed, false);
  assert.equal(decision({}, '2026-09-20T15:00:00Z').needed, false);
  const monday = decision({});
  assert.equal(monday.kind, 'outcome');
  assert.equal(monday.dueDate, '2026-09-21');
  assert.equal(monday.emailOverdue, true);
  assert.equal(nextViewingWorkingDay('2026-09-18'), '2026-09-21');
  assert.equal(nextViewingWorkingDay('2026-09-20'), '2026-09-21');
});

test('completed outcomes resolve the action, incomplete outcomes reopen, and cancellations close it', () => {
  assert.equal(decision({ status: 'completed', outcome: 'Interested' }).needed, false);
  assert.equal(decision({ status: 'completed', outcome: '  ' }).kind, 'outcome');
  for (const status of ['cancelled', 'no_show', 'not_leasing']) assert.equal(decision({ status, companyId: null, detailsConfirmedAt: null }).needed, false);
  assert.equal(decision({ deletedAt: '2026-09-19T09:00:00Z', detailsConfirmedAt: null }).needed, false);
});

test('explicit follow-up actions reopen when due and close when their date is moved or removed', () => {
  const action = { status: 'completed', outcome: 'Follow Up', nextAction: 'Confirm revised space requirement', followUpDate: '2026-09-21' };
  assert.equal(decision(action).kind, 'action');
  assert.equal(decision({ ...action, followUpDate: '2026-09-22' }).needed, false);
  assert.equal(decision({ ...action, followUpDate: null }).needed, false);
});

test('48-hour threshold uses the UK viewing time, including summer time', () => {
  const row = { viewingDate: '2026-09-14', viewingTime: '14:00' };
  assert.equal(decision(row, '2026-09-16T12:59:00Z').emailOverdue, false);
  assert.equal(decision(row, '2026-09-16T13:00:00Z').emailOverdue, true);
});

test('details tasks with nothing linked are titled from the calendar subject and date, with one plain Why line', () => {
  const bare = { unitId: null, companyId: null, contactId: null, detailsConfirmedAt: null, unitName: null, propertyName: null, companyName: null };
  const goyard = decision({ ...bare, viewingDate: '2026-06-09', createdAt: '2026-06-01T09:00:00Z', sourceDetails: { subject: 'Goyard viewing', issues: ['Choose which tracker units are being viewed', 'Confirm the brand being represented'] } }, '2026-06-10T10:00:00Z');
  assert.equal(goyard.title, 'Confirm viewing details — Goyard viewing · 9 Jun');
  assert.equal(goyard.why, 'No property or tracker unit identified · no brand identified · no brand contact or agent');
  const gp = decision({ ...bare, viewingDate: '2026-05-22', createdAt: '2026-05-20T09:00:00Z', sourceDetails: { subject: 'RE: GP x Brixton Village Viewing', sourcePropertyName: 'Brixton Village', issues: ['Choose which tracker units are being viewed'] } }, '2026-05-23T10:00:00Z');
  assert.equal(gp.title, 'Confirm viewing details — GP x Brixton Village · 22 May');
  assert.ok(gp.why.startsWith('No tracker unit chosen at Brixton Village'));
  const named = decision({ unitId: null, unitName: null, propertyName: null, companyId: 'brand-1', companyName: 'Goyard', detailsConfirmedAt: null, viewingDate: '2026-06-18', sourceDetails: { issues: ['Confirm the brand being represented'] } }, '2026-06-19T10:00:00Z');
  assert.equal(named.title, 'Confirm viewing details — Goyard · 18 Jun');
  assert.ok(!named.why.includes('brand'), 'a gap the record has since filled is not listed');
});

test('details tasks for viewings over 45 days old with no unit or brand are resolved, not kept', () => {
  const stale = { unitId: null, companyId: null, detailsConfirmedAt: null, viewingDate: '2026-06-09', sourceDetails: { subject: 'Goyard viewing' } };
  assert.equal(decision(stale, '2026-09-28T10:00:00Z').needed, false);
  assert.equal(decision({ ...stale, viewingDate: '2026-08-20' }, '2026-09-28T10:00:00Z').kind, 'details');
  assert.equal(decision({ detailsConfirmedAt: null, viewingDate: '2026-06-09' }, '2026-09-28T10:00:00Z').kind, 'details', 'linked but unconfirmed viewings still ask');
});

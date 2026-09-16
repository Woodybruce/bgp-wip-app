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

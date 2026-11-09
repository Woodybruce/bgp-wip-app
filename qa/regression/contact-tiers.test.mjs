import test from 'node:test';
import assert from 'node:assert/strict';
import { contactTier, nameKey } from '../../shared/contact-tiers.ts';

test('key contacts are property people and C-suite / founders — not regional MDs or assistants', () => {
  const cases = {
    'Property Director': 'property', 'Head of Acquisitions': 'property', 'Head of New Sites': 'property', 'Expansion Manager': 'property',
    'UK Chief Executive': 'leadership', 'CEO': 'leadership', 'Co-Founder': 'leadership', 'Managing Director': 'leadership', 'Chairman': 'leadership',
    'Regional Managing Director': null, 'Regional Managing Director - Central London': null, 'Area Managing Director': null,
    'Personal Assistant to COO': null, 'Restaurant Manager': null, 'Head of Marketing': null, 'Business Development Manager': null,
    'Talent Acquisition Specialist': null, 'Customer Acquisition Manager': null, 'Head of Expansion': 'property', 'Chief People Officer': 'leadership',
  };
  for (const [role, tier] of Object.entries(cases)) assert.equal(contactTier(role), tier, role);
});

test('an email local part matches the saved name', () => {
  assert.equal(nameKey('cassie.oflanagan'), nameKey("Cassie O'Flanagan"));
  assert.equal(nameKey('Mark  Standish'), nameKey('Mark Standish'));
});

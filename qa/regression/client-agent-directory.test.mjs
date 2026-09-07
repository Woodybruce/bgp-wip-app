import assert from 'node:assert/strict';
import test from 'node:test';
import { mapClientAgentDirectoryRows } from '../../server/client-agent-directory.ts';

const linked = overrides => ({
  brandId: 'coffee', brandName: 'Coffee Brand', source: 'requirement', region: null,
  firmId: 'agency', firmName: 'Example Agency', firmDomain: 'agency.example', firmCompanyType: 'Agent',
  contactId: 'agent', contactName: 'Alex Agent', contactRole: null,
  contactEmail: 'alex@agency.example', contactPhone: '020 0000 0000', contactSpecialty: null,
  ...overrides,
});

test('multiple requirement and representation links keep one contact with all brand evidence', () => {
  const entries = mapClientAgentDirectoryRows([
    linked({}), linked({}), linked({ source: 'representation', region: 'London' }),
    linked({ brandId: 'gym', brandName: 'Gym Brand' }),
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].contacts.length, 1);
  assert.deepEqual(entries[0].contacts[0].represents, [
    { brandId: 'coffee', brandName: 'Coffee Brand', sources: ['representation', 'requirement'], regions: ['London'] },
    { brandId: 'gym', brandName: 'Gym Brand', sources: ['requirement'], regions: [] },
  ]);
});

test('same-name people with distinct contact IDs are retained', () => {
  const [firm] = mapClientAgentDirectoryRows([linked({ contactId: 'one' }), linked({ contactId: 'two' })]);
  assert.deepEqual(firm.contacts.map(c => c.id), ['one', 'two']);
});

test('missing employer keeps a named person without fabricating a firm', () => {
  const [entry] = mapClientAgentDirectoryRows([linked({ firmId: null, firmName: null, firmDomain: null, firmCompanyType: null })]);
  assert.equal(entry.id, 'contact:agent');
  assert.equal(entry.kind, 'contact');
  assert.equal(entry.companyId, null);
  assert.equal(entry.name, 'Alex Agent');
  assert.equal(entry.contacts[0].email, 'alex@agency.example');
  assert.equal(entry.represents[0].brandId, 'coffee');
});

test('a firm representation without a named person never invents employees', () => {
  const [entry] = mapClientAgentDirectoryRows([linked({ source: 'representation', contactId: null, contactName: null })]);
  assert.equal(entry.kind, 'firm');
  assert.deepEqual(entry.contacts, []);
  assert.equal(entry.represents[0].brandName, 'Coffee Brand');
});

test('a person only carries their own brand links within a firm', () => {
  const [firm] = mapClientAgentDirectoryRows([
    linked({}), linked({ contactId: 'another-agent', contactName: 'Blair Agent', brandId: 'gym', brandName: 'Gym Brand' }),
  ]);
  assert.equal(firm.represents.length, 2);
  assert.deepEqual(firm.contacts[0].represents.map(b => b.brandId), ['coffee']);
  assert.deepEqual(firm.contacts[1].represents.map(b => b.brandId), ['gym']);
});

test('conflicting recorded firm associations are not silently reassigned', () => {
  const entries = mapClientAgentDirectoryRows([
    linked({ source: 'representation' }), linked({ firmId: 'other-agency', firmName: 'Other Agency' }),
  ]);
  assert.equal(entries.length, 2);
  assert.equal(new Set(entries.flatMap(e => e.contacts.map(c => c.id))).size, 1);
});

test('incomplete rows cannot create nameless directory entries', () => {
  assert.deepEqual(mapClientAgentDirectoryRows([linked({ firmId: null, firmName: null, contactId: null, contactName: null })]), []);
});

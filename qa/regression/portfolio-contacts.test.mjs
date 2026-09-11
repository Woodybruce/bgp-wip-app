import assert from 'node:assert/strict';
import test from 'node:test';
import { mapPortfolioContactRows, loadPortfolioContacts } from '../../server/portfolio-contacts.ts';

const relation = overrides => ({ group: 'deals', source: 'Named deal contact · Tenant', property: { id: 'one', name: 'First Scheme' }, deal: { id: 'deal', name: 'First Deal' }, confirmed: true, ...overrides });
const row = overrides => ({ entry_id: 'contact:one', kind: 'person', name: 'Alex Agent', role: null, email: 'alex@example.test', phone: null, contact_id: 'one', company_id: 'agency', company_name: 'Agency', can_open_contact: true, can_open_company: true, side: null, relationship: relation({}), ...overrides });

test('one contact keeps every scheme and group without duplicated source rows', () => {
  const result = mapPortfolioContactRows([
    row({}), row({}), row({ relationship: relation({ property: { id: 'two', name: 'Second Scheme' } }) }),
    row({ relationship: relation({ group: 'tenants', source: 'Contact at occupier company', deal: null }) }),
  ], [{ id: 'two', name: 'Second Scheme' }, { id: 'one', name: 'First Scheme' }]);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].relationships.length, 3);
  assert.deepEqual(result.properties.map(p => p.id), ['one', 'two']);
});

test('distinct people with the same name or email are not merged', () => {
  const result = mapPortfolioContactRows([row({}), row({ entry_id: 'contact:two', contact_id: 'two' })], []);
  assert.deepEqual(result.entries.map(e => e.contactId), ['one', 'two']);
});

test('permissions preserve a contact card without offering a forbidden profile', () => {
  const [entry] = mapPortfolioContactRows([row({ can_open_contact: false, can_open_company: false })], []).entries;
  assert.equal(entry.name, 'Alex Agent');
  assert.equal(entry.canOpenContact, false);
  assert.equal(entry.canOpenCompany, false);
  assert.equal(entry.relationships[0].property.id, 'one');
});

test('BGP users are separate from CRM contact identities and never acquire contact links', () => {
  const [entry] = mapPortfolioContactRows([row({ entry_id: 'user:one', contact_id: null, company_id: null, company_name: null, can_open_contact: false, can_open_company: false, side: 'bgp' })], []).entries;
  assert.equal(entry.id, 'user:one');
  assert.equal(entry.contactId, null);
  assert.equal(entry.company, null);
  assert.equal(entry.side, 'bgp');
  assert.equal(entry.canOpenContact, false);
});

test('output order is stable regardless of database row arrival order', () => {
  const rows = [row({ name: 'Zed', entry_id: 'contact:zed' }), row({}), row({ relationship: relation({ source: 'Named offer contact', deal: null, unitName: 'Unit 10' }) }), row({ relationship: relation({ source: 'Named offer contact', deal: null, unitName: 'Unit 2' }) })];
  assert.deepEqual(mapPortfolioContactRows(rows, []), mapPortfolioContactRows([...rows].reverse(), []));
});

test('missing optional overrides are read without creating tables or hiding failures', async () => {
  const calls = [];
  const client = { async query(text) {
    calls.push(text);
    if (text.includes('to_regclass')) return { rows: [{ present: false }] };
    if (text.startsWith('SELECT p.id')) return { rows: [{ id: 'one', name: 'First Scheme' }] };
    return { rows: [row({})] };
  } };
  const result = await loadPortfolioContacts(client, 'client', 'client', 'false');
  assert.equal(result.entries.length, 1);
  assert.ok(calls.every(sql => !/\b(?:CREATE|ALTER|INSERT|UPDATE|DELETE)\b/.test(sql)));
  assert.ok(!calls.at(-1).includes('FROM property_contact_overrides'));
  await assert.rejects(loadPortfolioContacts({ query: async () => { throw new Error('Database unavailable'); } }, 'client', 'client', 'false'), /Database unavailable/);
});

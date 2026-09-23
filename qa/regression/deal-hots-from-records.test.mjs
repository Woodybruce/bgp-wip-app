import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedHotsTerms, emptyDealFields, rankHotsDocs, fillDealFromHots } from '../../server/deal-hots-from-records.ts';

const hots = {
  id: 'kb9', fileName: 'FINAL Heads of Terms - Kiss The Hippo - 2A George Street 20.04.2026.docx', fileUrl: null, lastModified: '2026-04-20T00:00:00Z',
  content: `HEADS OF TERMS 2A George Street
Tenant: Kiss The Hippo Coffee Ltd
Rent: £85,000 per annum exclusive. Term: 10 years. Tenant only break at year 5. Rent free: 6 months.
Tenant's Agent: Shelley Sandzer, 32 Wigmore Street, London. FAO: Jane Smith. Email: jane@shelleysandzer.co.uk
Landlord's Agent: Bruce Gillingham Pollard, 95-96 New Bond Street, London W1S 1DB. FAO: Rob Barnes. Email: rob@brucegillinghampollard.com`,
};
const answer = { tenantEntity: 'Kiss The Hippo Coffee Ltd', rentPa: 85000, leaseLengthYears: 10, breakOption: 'Tenant only break at year 5', breakParty: 'Tenant', rentFreeMonths: 6,
  capitalContribution: null, totalAreaSqft: null, summary: '10 years at £85k with a tenant break at 5.',
  tenantAgent: { firm: 'Shelley Sandzer', contactName: 'Jane Smith', contactEmail: 'jane@shelleysandzer.co.uk', quote: "Tenant's Agent: Shelley Sandzer, 32 Wigmore Street" } };

test('HOTs terms and the named tenant agent are kept when the document supports them', () => {
  const t = checkedHotsTerms(hots, answer);
  assert.equal(t.rentPa, 85000); assert.equal(t.leaseLengthYears, 10); assert.equal(t.breakParty, 'Tenant');
  assert.equal(t.tenantEntity, 'Kiss The Hippo Coffee Ltd');
  assert.deepEqual(t.tenantAgent, { firm: 'Shelley Sandzer', contactName: 'Jane Smith', contactEmail: 'jane@shelleysandzer.co.uk', quote: "Tenant's Agent: Shelley Sandzer, 32 Wigmore Street" });
});

test('BGP, an invented quote, or an unlisted email never becomes the tenant agent', () => {
  assert.equal(checkedHotsTerms(hots, { ...answer, tenantAgent: { firm: 'Bruce Gillingham Pollard', quote: "Landlord's Agent: Bruce Gillingham Pollard, 95-96 New Bond Street" } }).tenantAgent, null);
  assert.equal(checkedHotsTerms(hots, { ...answer, tenantAgent: { firm: 'Shelley Sandzer', quote: 'Shelley Sandzer act for the tenant on this letting' } }).tenantAgent, null);
  assert.equal(checkedHotsTerms(hots, { ...answer, tenantAgent: { ...answer.tenantAgent, contactEmail: 'someone@else.com' } }).tenantAgent.contactEmail, null);
  assert.equal(checkedHotsTerms(hots, { ...answer, tenantEntity: 'Hippo Holdings Ltd' }).tenantEntity, null);
});

test('only empty deal fields are filled — typed values are never overwritten', () => {
  const t = checkedHotsTerms(hots, answer);
  assert.deepEqual(emptyDealFields({ rent_pa: 90000, lease_length: null, break_option: '', rent_free: 0 }, t),
    { lease_length: 10, break_option: 'Tenant only break at year 5', break_party: 'Tenant', rent_free: 6, tenant_entity_name: 'Kiss The Hippo Coffee Ltd' });
});

test('the HOTs naming the property and marked FINAL is read first', () => {
  const other = { ...hots, id: 'kb1', fileName: 'Draft HOTs - Kiss The Hippo - Richmond.docx', content: 'Richmond unit', lastModified: '2026-06-01T00:00:00Z' };
  assert.equal(rankHotsDocs([other, hots], '2A George Street, Richmond')[0].id, 'kb9');
  assert.equal(rankHotsDocs([other, hots], 'George Street')[0].id, 'kb9');
});

test('a deal without HOTs is left alone', async () => {
  const pool = { query: async () => ({ rows: [{ id: 'd1', tenant_id: 'b1', tenant_name: 'Kiss The Hippo', property_name: '2A George Street' }] }) };
  assert.deepEqual(await fillDealFromHots('d1', { pool, docs: async () => [], read: async () => { throw new Error('should not read'); } }), { status: 'no_hots' });
});

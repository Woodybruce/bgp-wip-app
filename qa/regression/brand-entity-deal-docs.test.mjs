import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedDealEntity, entityPassages, findTenantEntityInDealRecords } from '../../server/brand-entity-deal-docs.ts';

const email = {
  id: 'kb1', fileName: 'Re: Honest Greens | CW', fileUrl: 'https://outlook.office.com/x', filePath: 'email:accounts@',
  content: `From: Rupert Bentley-Smith\nThanks L-Train. Heads attached.\n\nNew Letting to HGUK Restaurants Ltd on behalf of Canary Wharf Properties (RT5) Limited. Fee is 12% of base rent agreed at £500,000pa. Therefore fee is £60,000 plus VAT`,
};

test('deal record passages keep the sentences that name registered companies', () => {
  const passages = entityPassages(email.content);
  assert.ok(passages.some(p => p.includes('HGUK Restaurants Ltd') && p.includes('Canary Wharf Properties (RT5) Limited')));
});

test('the tenant named in a BGP fee email is accepted with its quote', () => {
  const found = checkedDealEntity([email], { role: 'tenant', entityName: 'HGUK Restaurants Ltd', doc: 1, quote: 'New Letting to HGUK Restaurants Ltd on behalf of Canary Wharf Properties (RT5) Limited.' });
  assert.equal(found.entityName, 'HGUK Restaurants Ltd');
  assert.equal(found.doc.fileName, 'Re: Honest Greens | CW');
  assert.equal(found.chNumber, null);
});

test('a made-up quote, the landlord, or a non-company answer is refused', () => {
  assert.equal(checkedDealEntity([email], { role: 'tenant', entityName: 'HGUK Restaurants Ltd', doc: 1, quote: 'The tenant is HGUK Restaurants Ltd as per the lease.' }), null);
  assert.equal(checkedDealEntity([email], { role: 'landlord', entityName: 'Canary Wharf Properties (RT5) Limited', doc: 1, quote: 'on behalf of Canary Wharf Properties (RT5) Limited.' }), null);
  assert.equal(checkedDealEntity([email], { role: 'tenant', entityName: 'Honest Greens', doc: 1, quote: 'New Letting to HGUK Restaurants Ltd on behalf of' }), null);
  assert.equal(checkedDealEntity([email], { role: 'tenant', entityName: 'Other Foods Ltd', doc: 1, quote: 'New Letting to HGUK Restaurants Ltd on behalf of' }), null);
  assert.equal(checkedDealEntity([email], { role: null }), null);
});

test('a company number is kept only when it is written in the document', () => {
  const hots = { ...email, content: 'Tenant: HGUK Restaurants Ltd (company number 12345678) of 1 High Street' };
  assert.equal(checkedDealEntity([hots], { role: 'tenant', entityName: 'HGUK Restaurants Ltd', chNumber: '12345678', doc: 1, quote: 'Tenant: HGUK Restaurants Ltd (company number 12345678)' }).chNumber, '12345678');
  assert.equal(checkedDealEntity([hots], { role: 'tenant', entityName: 'HGUK Restaurants Ltd', chNumber: '87654321', doc: 1, quote: 'Tenant: HGUK Restaurants Ltd (company number 12345678)' }).chNumber, null);
});

test('no deal records means no answer and no model call', async () => {
  let asked = false;
  const found = await findTenantEntityInDealRecords({ name: 'Honest Greens' }, { docs: async () => [], ask: async () => { asked = true; return null; } });
  assert.equal(found, null); assert.equal(asked, false);
});

// The inbox sweep credits an offer or an interest line to the brand the
// subject names, never to the unit's own landlord (Woody, 19 November 2026,
// "Are you fixing it?"): the real syncOfferEmails and syncInterestEmails run
// against a fake database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import * as matching from '../../server/viewing-matching.ts';
import { viewingMissingDetails } from '../../shared/viewing-workflow.ts';
const require = createRequire(import.meta.url);
const { source, evaluate } = require('./source-harness.cjs');

const units = [
  { id: 'u-pearl', unit_name: '1-4.3', property_id: 'p-pearl', property_name: 'Pearl Yard', property_aliases: null, landlord_id: 'pearl-landlord' },
  { id: 'u-arch', unit_name: 'Arch 14a', property_id: 'p-kilburn', property_name: 'Kilburn Mews', property_aliases: null, landlord_id: 'tfl-ltd' },
];
const brands = [
  { id: 'fulai', name: 'Fulai' }, { id: 'crisp', name: 'Crisp Pizza' }, { id: 'tfl-ltd', name: 'TfL Ltd' }, { id: 'gails', name: "Gail's" }, { id: 'reiss', name: 'Reiss' },
];
const person = (id, email, companyId, companyName, companyType) => ({ id, name: id, email, companyId, companyName, companyType });
const contacts = [
  person('cara', 'cara@crisp.test', 'crisp', 'Crisp Pizza', 'Tenant - Restaurant'),
  // A landlord typed as a tenant in the CRM, as TfL is.
  person('tom', 'tom@tfl.test', 'tfl-ltd', 'TfL Ltd', 'Tenant'),
  person('gill', 'gill@gails.test', 'gails', "Gail's", 'Tenant - Café & Coffee'),
];

function harness() {
  const offers = [], interest = [];
  const pool = {
    async query(sql, args) {
      if (sql.includes('FROM available_units au')) return { rows: units };
      if (sql.includes('FROM crm_properties WHERE')) return { rows: [{ id: 'p-pearl', name: 'Pearl Yard', aliases: null }, { id: 'p-kilburn', name: 'Kilburn Mews', aliases: null }] };
      if (sql.includes('FROM crm_companies') && sql.includes("company_type ILIKE 'tenant%'")) return { rows: brands.map(b => ({ ...b, domain: null, domain_url: null, website: null })) };
      if (sql.includes('FROM crm_contacts')) return { rows: contacts.filter(c => args[0].includes(c.email)) };
      if (sql.includes('FROM brand_agent_representations')) return { rows: [] };
      if (sql.includes('SELECT 1 FROM unit_offers') || sql.includes('SELECT 1 FROM (')) return { rows: [] };
      const row = () => ({ unit: args[0], companyName: args[1], contactName: args[2], contact: args[3], company: args[4], note: args[6] });
      if (sql.includes('INSERT INTO unit_offers')) { offers.push(row()); return { rows: [{ id: `o${offers.length}` }] }; }
      if (sql.includes('INSERT INTO unit_interest')) { interest.push(row()); return { rows: [{ id: `i${interest.length}` }] }; }
      throw new Error(`Unexpected query: ${sql.slice(0, 120)}`);
    },
  };
  const sync = evaluate(source('server/viewing-sync.ts'), { require(name) {
    if (name === './db') return { pool };
    if (name === 'node:crypto') return { createHash };
    if (name === '@shared/viewing-workflow') return { viewingMissingDetails };
    if (name === './viewing-matching') return matching;
    throw new Error(`Unexpected import ${name}`);
  } });
  return { sync, offers, interest };
}
const mail = (subject, from) => ({
  id: subject, conversationId: `conv-${subject}`, subject, bodyPreview: '', receivedDateTime: '2026-11-18T10:00:00Z',
  from: { emailAddress: { address: from } }, toRecipients: [{ emailAddress: { address: 'woody@brucegillinghampollard.com' } }], ccRecipients: [],
});

test('an offer is credited to the brand the subject names, not to whoever sent it', async () => {
  const h = harness();
  assert.equal(await h.sync.syncOfferEmails([mail('Fw: Offer | 1-4.3 Pearl Yard | Fulai', 'cara@crisp.test')], 'woody@brucegillinghampollard.com'), 1);
  assert.deepEqual(h.offers.map(o => [o.unit, o.company, o.companyName, o.contact]), [['u-pearl', 'fulai', 'Fulai', null]]);
});

test('with no brand named, the sender\'s brand is credited with its contact, as before', async () => {
  const h = harness();
  await h.sync.syncOfferEmails([mail('Offer - 1-4.3 Pearl Yard', 'cara@crisp.test')], 'woody@brucegillinghampollard.com');
  assert.deepEqual(h.offers.map(o => [o.company, o.contact]), [['crisp', 'cara']]);
});

test('the sender\'s brand stays when the subject names it too', async () => {
  const h = harness();
  await h.sync.syncOfferEmails([mail('Re: Gails X Reiss offer - Pearl Yard 1-4.3', 'gill@gails.test')], 'woody@brucegillinghampollard.com');
  assert.deepEqual(h.offers.map(o => [o.company, o.contact]), [['gails', 'gill']]);
});

test('the unit\'s own landlord is never credited, even when it is typed as a tenant', async () => {
  const h = harness();
  assert.equal(await h.sync.syncOfferEmails([mail('J Bensons Solicitors - Offer - Kilburn Mews, Arch 14a', 'tom@tfl.test')], 'woody@brucegillinghampollard.com'), 0);
  assert.deepEqual(h.offers, []);
  // From the landlord, but naming the bidder: the bidder is credited.
  await h.sync.syncOfferEmails([mail('Fulai - Offer - Kilburn Mews, Arch 14a', 'tom@tfl.test')], 'woody@brucegillinghampollard.com');
  assert.deepEqual(h.offers.map(o => [o.unit, o.company, o.contact]), [['u-arch', 'fulai', null]]);
});

test('interest from email follows the same rule', async () => {
  const h = harness();
  assert.equal(await h.sync.syncInterestEmails([mail('Interested in 1-4.3 Pearl Yard for Fulai', 'cara@crisp.test')], 'woody@brucegillinghampollard.com'), 1);
  assert.deepEqual(h.interest.map(i => [i.unit, i.company, i.contact]), [['u-pearl', 'fulai', null]]);
  assert.equal(await h.sync.syncInterestEmails([mail('Keen on Kilburn Mews Arch 14a', 'tom@tfl.test')], 'woody@brucegillinghampollard.com'), 0);
});

test('every sweep that credits a company from the people on an email or invitation goes through the one rule', () => {
  const sync = source('server/viewing-sync.ts');
  for (const fn of ['syncDiaryInterest', 'syncOfferEmails', 'syncInterestEmails']) {
    const body = sync.slice(sync.indexOf(`export async function ${fn}(`));
    const end = body.indexOf('\nexport ', 10);
    const own = end > 0 ? body.slice(0, end) : body;
    assert.match(own, /const credited = chooseEmailBrand\((event|msg)\.subject \|\| "", await loadViewingPeople\(emails\), context\.brands\);/, fn);
    assert.match(own, /if \(unit\.landlordId && unit\.landlordId === contact\.company_id\) continue;/, fn);
    assert.doesNotMatch(own, /if \(!brand\.brandId \|\| brand\.reasons\.length\) continue;/, fn);
  }
});

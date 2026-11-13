import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLandsecBgpTeam, buildLandsecJointAgents, withoutShownPeople, namedJointAgencyFor,
} from '../../server/client-agents-overview.ts';

const SCHEMES = [
  ['liverpool-one', 'Liverpool ONE', 'North'], ['trinity-leeds', 'Trinity Leeds', 'North'],
  ['white-rose', 'White Rose', 'North'], ['buchanan-galleries', 'Buchanan Galleries', 'North'],
  ['bluewater', 'Bluewater', 'South'], ['westgate-oxford', 'Westgate Oxford', 'South'],
  ['st-davids', "St David's & Queens Arcade", 'South'], ['gunwharf-quays', 'Gunwharf Quays', 'Outlets'],
  ['clarks-village', 'Clarks Village', 'Outlets'], ['braintree-village', 'Braintree Village', 'Outlets'],
  ['one-new-change', 'One New Change', 'London'], ['new-street-square', 'New Street Square', 'London'],
  ['lucent', 'Lucent', 'London'], ['victoria', 'Victoria', 'London'],
].map(([key, name, group]) => ({ key, name, group }));

const staff = (name, extra = {}) => ({ name, title: 'Director', email: `${name.split(' ')[0].toLowerCase()}@brucegillinghampollard.com`, phone: '020 0000 0000', photoUrl: null, ...extra });

test('BGP people appear only with a current staff record, details from HR, leads first', () => {
  const team = buildLandsecBgpTeam(SCHEMES, [
    staff('Luke Donohoe', { title: 'Surveyor' }), staff('Emily Dumbell'), staff('Charlotte Roberts', { title: 'Equity Director' }),
  ]);
  assert.deepEqual(team.map(p => p.name), ['Charlotte Roberts', 'Emily Dumbell', 'Luke Donohoe']);
  const emily = team.find(p => p.name === 'Emily Dumbell');
  assert.equal(emily.title, 'Director');
  assert.equal(emily.email, 'emily@brucegillinghampollard.com');
  assert.ok(emily.lead.includes('bluewater'));
  assert.ok(emily.support.includes('victoria'), 'the London offices row covers the Victoria scheme');
  assert.ok(!emily.support.includes('gunwharf-quays') && emily.lead.includes('gunwharf-quays'));
  assert.equal(team.find(p => p.name === 'Luke Donohoe').lead.length, 0);
  // Rob Barnes, Lucy Gardiner, Victoria Broadhead and Emily Cann have no record here: not shown.
  assert.ok(!team.some(p => /Barnes|Gardiner|Broadhead|Cann/.test(p.name)));
});

test('two staff records with one name are not guessed between', () => {
  assert.deepEqual(buildLandsecBgpTeam(SCHEMES, [staff('Emily Dumbell'), staff('Emily Dumbell', { email: 'other@brucegillinghampollard.com' })]), []);
});

test('the named joint agency follows the scheme, and only where the sheet has a joint team', () => {
  assert.equal(namedJointAgencyFor('liverpool-one'), 'Starka');
  assert.equal(namedJointAgencyFor('buchanan-galleries'), 'Culverwell');
  assert.equal(namedJointAgencyFor('bluewater'), 'CBRE');
  assert.equal(namedJointAgencyFor('lucent'), null);
  assert.equal(namedJointAgencyFor('not-a-scheme'), null);
});

test('joint agents: each firm once, details only from a matching record', () => {
  const firms = buildLandsecJointAgents(SCHEMES, [], [
    { name: 'Nigel Costain', role: 'Executive Director', email: 'nigel@cbre.example', phone: '020 1', companyName: 'CBRE Ltd', companyIsAgent: true },
    // A namesake at a brand must not supply the Starka agent's details.
    { name: 'Sammy Jones', role: 'Head of Marketing', email: 'sammy@brand.example', phone: null, companyName: null, companyIsAgent: false },
    // Same name at a different agent firm: not taken as the CBRE joint agent.
    { name: 'Tom Dracup', role: null, email: 'tom@other.example', phone: null, companyName: 'Other Agency', companyIsAgent: true },
  ]);
  assert.deepEqual(firms.map(f => f.name), ['CBRE', 'Culverwell', 'Starka']);
  const cbre = firms[0];
  assert.deepEqual(cbre.people.map(p => p.name), ['George Radford', 'Nigel Costain', 'Tamara Lamb', 'Tom Dracup']);
  const nigel = cbre.people.find(p => p.name === 'Nigel Costain');
  assert.equal(nigel.email, 'nigel@cbre.example');
  assert.equal(nigel.detailSource, 'crm');
  assert.deepEqual(nigel.firmSources, ['crm', 'scheme']);
  const tom = cbre.people.find(p => p.name === 'Tom Dracup');
  assert.equal(tom.email, null);
  assert.equal(tom.detailSource, null);
  const sammy = firms[2].people.find(p => p.name === 'Sammy Jones');
  assert.equal(sammy.email, null);
  assert.equal(sammy.role, null);
  assert.deepEqual(sammy.schemes, ['liverpool-one']);
  assert.ok(!cbre.schemes.includes('liverpool-one') && !cbre.schemes.includes('lucent'));
});

test('a joint-agent login supplies firm, email and schemes; no firm means firm not confirmed', () => {
  const firms = buildLandsecJointAgents(SCHEMES, [
    { name: 'Tamara Lamb', email: 'tamara@cbre.example', phone: null, firm: 'CBRE Limited', schemes: ['bluewater'] },
    { name: 'New Person', email: 'new@agency.example', phone: null, firm: 'Agency Two', schemes: ['lucent'] },
    { name: 'No Firm', email: 'nofirm@agency.example', phone: null, firm: null, schemes: ['lucent'] },
  ], []);
  const cbre = firms.find(f => f.name === 'CBRE');
  const tamara = cbre.people.find(p => p.name === 'Tamara Lamb');
  assert.equal(tamara.email, 'tamara@cbre.example');
  assert.equal(tamara.detailSource, 'login');
  assert.deepEqual(tamara.firmSources, ['login', 'scheme']);
  assert.deepEqual(firms.find(f => f.name === 'Agency Two').people.map(p => p.name), ['New Person']);
  const unconfirmed = firms[firms.length - 1];
  assert.equal(unconfirmed.name, null);
  assert.deepEqual(unconfirmed.people.map(p => p.name), ['No Firm']);
  assert.deepEqual(unconfirmed.people[0].firmSources, []);
});

const brand = (id, sources = ['representation']) => ({ brandId: id, brandName: id, sources, regions: [] });
const contact = (id, name, email, brands) => ({ id, name, role: null, email, phone: null, specialty: null, represents: brands.map(b => brand(b)) });

test('tenant reps drop people already shown, keep the rest of the firm and namesakes elsewhere', () => {
  const entries = [
    { id: 'cbre', name: 'CBRE', domain: null, companyType: 'Agent', kind: 'firm', companyId: 'cbre',
      contacts: [contact('1', 'Tom Dracup', 'tom.dracup@cbre.example', ['bakery']), contact('2', 'Jess Other', 'jess@cbre.example', ['coffee'])],
      represents: [brand('bakery'), brand('coffee'), brand('firm-only')] },
    { id: 'other', name: 'Other Agency', domain: null, companyType: 'Agent', kind: 'firm', companyId: 'other',
      contacts: [contact('3', 'Tom Dracup', 'tom@other.example', ['gym'])], represents: [brand('gym')] },
    { id: 'contact:4', name: 'Emily Dumbell', domain: null, companyType: null, kind: 'contact', companyId: null,
      contacts: [contact('4', 'Emily Dumbell', null, ['cinema'])], represents: [brand('cinema')] },
    { id: 'solo', name: 'Solo Agency', domain: null, companyType: 'Agent', kind: 'firm', companyId: 'solo',
      contacts: [contact('5', 'Someone Else', 'emily@brucegillinghampollard.com', ['ramen'])], represents: [brand('ramen')] },
  ];
  const shown = [
    { name: 'Tom Dracup', emails: ['tom.dracup@cbre-test.example'], firms: ['CBRE'] },
    { name: 'Emily Dumbell', emails: ['emily@brucegillinghampollard.com'], firms: ['BGP', 'Bruce Gillingham Pollard'] },
  ];
  const result = withoutShownPeople(entries, shown);
  assert.deepEqual(result.map(e => e.id), ['cbre', 'other']);
  assert.deepEqual(result[0].contacts.map(c => c.name), ['Jess Other']);
  assert.deepEqual(result[0].represents.map(b => b.brandId), ['coffee', 'firm-only']);
  assert.deepEqual(result[1].contacts.map(c => c.name), ['Tom Dracup'], 'a namesake with another email at another firm stays');
  assert.equal(withoutShownPeople(entries, []), entries);
});

test('a namesake at a different known firm stays listed even when one side has no email', () => {
  const firm = (name, c) => ({ id: name, name, domain: null, companyType: 'Agent', kind: 'firm', companyId: name, contacts: [c], represents: [brand('gym')] });
  // Joint agent with no recorded details; the tenant rep at another firm has an email.
  const a = withoutShownPeople(
    [firm('Savills', contact('1', 'George Radford', 'george.radford@savills.example', ['gym']))],
    [{ name: 'George Radford', emails: [], firms: ['CBRE'] }]);
  assert.deepEqual(a.map(e => e.contacts.map(c => c.name)), [['George Radford']]);
  // BGP person with an email; the tenant rep at another firm has none.
  const b = withoutShownPeople(
    [firm('Savills', contact('2', 'Emily Dumbell', null, ['gym']))],
    [{ name: 'Emily Dumbell', emails: ['emily@brucegillinghampollard.com'], firms: ['BGP', 'Bruce Gillingham Pollard'] }]);
  assert.deepEqual(b.map(e => e.contacts.map(c => c.name)), [['Emily Dumbell']]);
  // Same firm, no email on either side: the same person, dropped.
  assert.deepEqual(withoutShownPeople(
    [firm('CBRE Ltd', contact('3', 'George Radford', null, ['gym']))],
    [{ name: 'George Radford', emails: [], firms: ['CBRE'] }]), []);
  // Firm unknown on one side: the name alone decides.
  assert.deepEqual(withoutShownPeople(
    [firm('Savills', contact('4', 'No Firm', 'nofirm@savills.example', ['gym']))],
    [{ name: 'No Firm', emails: [], firms: [] }]), []);
});

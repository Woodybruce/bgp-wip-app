import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assetTerms, subjectMatches, emailDomain, isExternalDomain, normaliseCompanyDomain,
  rankCorrespondents, suggestClient, copiedAlongside, trackerCorrespondence,
} from '../../server/tracker-correspondence.ts';

const NOW = new Date('2026-09-28T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 864e5).toISOString();
const row = (subject, participants, { direction = 'outbound', type = 'email', user = 'jack@brucegillinghampollard.com', age = 3 } = {}) =>
  ({ subject, participants, direction, type, bgp_user: user, interaction_date: daysAgo(age) });

const companies = new Map([
  ['appley.net', { id: 'appley', name: 'Appley', company_type: 'Landlord' }],
  ['aresmgmt.com', { id: 'ares', name: 'Ares Management', company_type: 'Investor' }],
  ['northstarcapital.co.uk', { id: 'northstar', name: 'Northstar Capital', company_type: 'Landlord' }],
  ['theardentcompanies.com', { id: 'ardent', name: 'Ardent', company_type: 'Landlord' }],
  ['cbre.com', { id: 'cbre', name: 'CBRE', company_type: 'Agent' }],
  ['greenstreetnews.com', { id: 'gsn', name: 'Green Street News', company_type: 'Other' }],
  ['gpe.co.uk', { id: 'gpe', name: 'Great Portland Estates', company_type: 'Investor' }],
  ['landsec.com', { id: 'landsec', name: 'Landsec', company_type: 'Landlord' }],
  ['inception-group.com', { id: 'inception', name: 'Inception T2', company_type: 'Tenant - Bar' }],
]);

test('asset terms drop a leading "The", keep short all-caps aliases, skip short words', () => {
  assert.deepEqual(assetTerms(['The Royal Exchange', 'Royal Exchange', 'REX', 'Bank', null]), ['Royal Exchange', 'REX']);
  assert.ok(subjectMatches('Fwd: Rex Comps', ['REX']));
  assert.ok(subjectMatches('RE: The Royal Exchange - Confidential', ['Royal Exchange']));
  assert.ok(!subjectMatches('Rexford Place lunch', ['REX']));
});

test('BGP mailboxes (typos included) and free-mail domains are never a firm', () => {
  assert.equal(emailDomain('TM@Appley.net'), 'appley.net');
  assert.equal(emailDomain('not-an-address'), null);
  for (const d of ['brucegillinghampollard.com', 'bucegillinghampollard.com', 'brucegillinhampollard.com', 'gmail.com']) assert.ok(!isExternalDomain(d), d);
  assert.ok(isExternalDomain('aresmgmt.com'));
  assert.equal(normaliseCompanyDomain('https://www.appley.net/team'), 'appley.net');
  assert.equal(normaliseCompanyDomain('someone@appley.net'), null);
});

test('the firm BGP is working with now outranks a spring enquiry; vendor, occupiers, agents and news never rank', () => {
  const rows = [
    // Northstar in June — plenty of traffic, long ago
    ...Array.from({ length: 8 }, (_, i) => row(`The Royal Exchange Uppers ${i}`, ['nick@brucegillinghampollard.com', 'farid@northstarcapital.co.uk'], { age: 100 + i })),
    // Appley this week — the same email in three BGP mailboxes counts once
    row('Re: The Royal Exchange - Confidential', ['jack@brucegillinghampollard.com', 'tm@appley.net', 'cb@appley.net'], { age: 4 }),
    row('Re: The Royal Exchange - Confidential', ['jack@brucegillinghampollard.com', 'tm@appley.net', 'cb@appley.net'], { age: 4, user: 'nick@brucegillinghampollard.com' }),
    row('RE: The Royal Exchange - Confidential', ['jack@brucegillinghampollard.com', 'tm@appley.net'], { age: 4, user: 'jonny@brucegillinghampollard.com' }),
    row('REX - Inspection', ['jack@brucegillinghampollard.com', 'tm@appley.net', 'am@appley.net'], { type: 'meeting', direction: 'past', age: 4 }),
    row('REX Call', ['tm@appley.net', 'jack@brucegillinghampollard.com'], { direction: 'inbound', age: 4 }),
    // a letting at the building, the vendor, an agent and a newsletter
    ...Array.from({ length: 6 }, (_, i) => row(`Royal Exchange Units 7-9 AFL ${i}`, ['olly@inception-group.com'], { age: 2 + i })),
    row('Royal Exchange leasing', ['ahilston@theardentcompanies.com'], { age: 2 }),
    row('Royal Exchange/Bank Opportunity', ['isabel.osborne@cbre.com'], { age: 1 }),
    row('London Bulletin - Royal Exchange', ['info@greenstreetnews.com'], { direction: 'inbound', age: 1 }),
    // someone who wrote in but BGP never answered
    row('Royal Exchange', ['harry.buxton@gpe.co.uk'], { direction: 'inbound', age: 5 }),
  ];
  const ranked = rankCorrespondents(rows, companies, { excludeCompanyIds: ['ardent'], now: NOW });
  assert.deepEqual(ranked.map(c => c.companyId), ['appley', 'northstar']);
  const appley = ranked[0];
  assert.equal(appley.messages, 3, 'one confidential email, one inspection, one call invite');
  assert.equal(appley.meetings, 1);
  assert.deepEqual(appley.bgpUsers.sort(), ['jack@brucegillinghampollard.com', 'jonny@brucegillinghampollard.com', 'nick@brucegillinghampollard.com']);
  assert.ok(appley.score > ranked[1].score);
});

test('the client is suggested when the row names someone else or no one — never over a leading client or stale work', () => {
  const ranked = [
    { companyId: 'appley', name: 'Appley', messages: 12, lastDate: daysAgo(3), score: 20 },
    { companyId: 'northstar', name: 'Northstar Capital', messages: 21, lastDate: daysAgo(95), score: 1 },
  ];
  assert.deepEqual(suggestClient(ranked, ['ardent'], 'Ardent', { now: NOW }), { kind: 'mismatch', company: ranked[0], currentClient: 'Ardent' });
  assert.equal(suggestClient(ranked, [], null, { now: NOW }).kind, 'no_client');
  assert.equal(suggestClient(ranked, ['appley'], 'Appley', { now: NOW }), null);
  assert.equal(suggestClient(ranked, ['ares', 'appley'], 'Ares Management', { now: NOW }), null, 'an extra client counts');
  assert.equal(suggestClient([{ ...ranked[0], lastDate: daysAgo(120) }], [], null, { now: NOW }), null);
  assert.equal(suggestClient([{ ...ranked[0], messages: 2 }], [], null, { now: NOW }), null);
  assert.equal(suggestClient([ranked[0], { companyId: 'cdp', messages: 4, lastDate: daysAgo(10), score: 12 }], ['cdp'], 'CdP', { now: NOW }), null,
    'a client close behind the leader is not overruled');
});

test('the capital partner copied on the client’s own threads surfaces; a mass invite does not', () => {
  const rows = [
    row('1-3 Upper James St', ['tm@appley.net', 'mjenkinson@aresmgmt.com', 'mquek@aresmgmt.com', 'jack@brucegillinghampollard.com'], { direction: 'inbound', age: 140 }),
    row('RE: 1-3 Upper James St', ['tm@appley.net', 'schambers@aresmgmt.com', 'jack@brucegillinghampollard.com'], { direction: 'inbound', age: 139 }),
    row('RE: 1-3 Upper James St', ['tm@appley.net', 'schambers@aresmgmt.com', 'jack@brucegillinghampollard.com'], { direction: 'inbound', age: 139, user: 'nick@brucegillinghampollard.com' }),
    row('BGP Summer Lunch', ['tm@appley.net', 'a@landsec.com', 'b@canarywharf.com', 'c@portmanestate.co.uk', 'd@bpsdc.co.uk'], { age: 110 }),
    row('BGP Summer Lunch reminder', ['tm@appley.net', 'a@landsec.com', 'b@canarywharf.com', 'c@portmanestate.co.uk', 'd@bpsdc.co.uk'], { age: 109 }),
    row('Islington Square Run Through', ['tm@appley.net', 'mike.egerton@cbre.com'], { age: 3 }),
  ];
  const copied = copiedAlongside(rows, 'appley.net', companies);
  assert.deepEqual(copied.map(c => [c.companyId, c.messages]), [['ares', 2]]);
  assert.deepEqual(copied[0].subjects, ['1-3 Upper James St']);
  assert.deepEqual(copiedAlongside(rows, 'appley.net', companies, { excludeCompanyIds: ['ares'] }), [], 'already a client');
});

test('an asset read end to end: Appley leads Jack’s threads and Ares is flagged beside them', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM investment_tracker t/.test(sql)) return { rows: [{ id: 't1', asset_name: 'The Royal Exchange', board_type: 'Purchases', client: 'Ardent', client_id: 'ardent-client', vendor_id: 'reil', buyer_id: null, property_name: 'Royal Exchange', property_aliases: ['The Royal Exchange', 'REX'], property_landlord_id: 'ardent', extra_client_ids: [] }] };
      if (/subject ILIKE ANY/.test(sql)) return { rows: [
        row('Re: The Royal Exchange - Confidential', ['jack@brucegillinghampollard.com', 'tm@appley.net'], { age: 4 }),
        row('REX - Inspection', ['jack@brucegillinghampollard.com', 'tm@appley.net'], { type: 'meeting', direction: 'past', age: 4 }),
        row('Fwd: Rex Comps', ['jack@brucegillinghampollard.com', 'tm@appley.net'], { age: 0 }),
        row('Royal Exchange leasing', ['ahilston@theardentcompanies.com'], { age: 2 }),
        row('Prices', ['someone@appley.net'], { age: 2 }),
      ] };
      if (/participants::text ILIKE/.test(sql)) return { rows: [
        row('1-3 Upper James St', ['tm@appley.net', 'mquek@aresmgmt.com'], { direction: 'inbound', age: 140 }),
        row('1-3 Upper James St inspection', ['tm@appley.net', 'mquek@aresmgmt.com'], { type: 'meeting', direction: 'past', age: 137 }),
      ] };
      if (/FROM crm_companies/.test(sql)) {
        const all = [
          { id: 'appley', name: 'Appley', company_type: 'Landlord', domain: 'appley.net', domain_url: 'https://appley.net', parent_company_id: null },
          { id: 'ares', name: 'Ares Management', company_type: 'Investor', domain: 'aresmgmt.com', domain_url: null, parent_company_id: null },
          { id: 'ardent', name: 'Ardent', company_type: 'Landlord', domain: 'theardentcompanies.com', domain_url: null, parent_company_id: null },
        ];
        return { rows: all.filter(c => params[0].includes(c.domain)) };
      }
      return { rows: [] };
    },
  };
  const out = await trackerCorrespondence('t1', { pool, now: NOW });
  assert.deepEqual(out.terms, ['Royal Exchange', 'REX']);
  assert.deepEqual(calls.find(c => /subject ILIKE ANY/.test(c.sql)).params[0], ['%Royal Exchange%', '%REX%']);
  assert.equal(out.suggestion.kind, 'mismatch');
  assert.equal(out.suggestion.company.companyId, 'appley');
  assert.equal(out.suggestion.company.messages, 3, 'the "Prices" email is not about the asset');
  assert.ok(!out.correspondents.some(c => c.companyId === 'ardent'), 'the building’s owner is the other side');
  assert.equal(calls.find(c => /participants::text ILIKE/.test(c.sql)).params[0], '%@appley.net"%');
  assert.equal(out.copiedWith, 'Appley');
  assert.deepEqual(out.copied.map(c => c.companyId), ['ares']);
});

test('an extra client on a Purchases-board asset reads as buying on that company’s Team view', async () => {
  process.env.DATABASE_URL ||= 'postgres://unused@localhost/unused';
  const { getAccountTeams } = await import('../../server/account-teams.ts');
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push(sql);
      if (/FROM crm_companies WHERE id = \$1/.test(sql)) return { rows: [{ id: 'ares', name: 'Ares Management', company_type: 'Investor', companies_house_number: null, parent_company_id: null, merged_into_id: null }] };
      if (/FROM investment_tracker\s+WHERE client_id/.test(sql)) return { rows: [{ id: 't1', asset_name: 'The Royal Exchange', board_type: 'Purchases', status: 'LIVE', client: 'Appley', client_id: 'appley', vendor: 'The Royal Exchange Investments Limited', vendor_id: 'reil', buyer: null, buyer_id: null, property_id: 'p1', extra_client: true }] };
      return { rows: [] };
    },
  };
  const out = await getAccountTeams('ares', { pool });
  const trackerSql = calls.find(s => /FROM investment_tracker\s+WHERE client_id/.test(s));
  assert.match(trackerSql, /investment_tracker_clients/);
  assert.equal(out.investment.tracker[0].side, 'buying');
});

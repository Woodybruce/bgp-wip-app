import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import * as matching from '../../server/viewing-matching.ts';
import { viewingMissingDetails } from '../../shared/viewing-workflow.ts';
import { viewingFollowupDecision } from '../../server/viewing-followups.ts';
const require = createRequire(import.meta.url);
const { source, evaluate, find, ts } = require('./source-harness.cjs');
const person = (id, companyId, companyType = 'Tenant - Retail') => ({ id, name: id, email: `${id}@example.test`, companyId, companyName: companyId, companyType });
const agent = person('agent', 'agency', 'Agent');
const brandContact = person('tenant', 'brand');
const link = (brandId = 'brand', extras = {}) => ({ contactId: 'agent', brandId, brandName: brandId, kind: 'agent', ...extras });
const units = [
  { id: 'u1', unitName: 'Unit 1', propertyId: 'p1', propertyName: 'Brent Cross' },
  { id: 'u2', unitName: 'Unit 2', propertyId: 'p1', propertyName: 'Brent Cross' },
];
const invitation = (changes = {}) => ({ id: 'graph-1', iCalUId: 'booking-1', subject: 'Viewing at Brent Cross Unit 1', location: { displayName: 'Brent Cross' },
  start: { dateTime: '2026-09-16T09:00:00', timeZone: 'UTC' }, organizer: { emailAddress: { address: 'carly@brucegillinghampollard.com' } },
  attendees: [{ emailAddress: { address: agent.email } }], ...changes });

test('viewing agents resolve through exact representation and requirement links, never their employer', () => {
  const result = matching.matchViewingBrand([agent.email], [agent], [link('brand', { requirementId: 'req' })]);
  assert.equal(result.brandId, 'brand');
  assert.equal(result.agentContactId, 'agent');
  assert.equal(result.requirementId, 'req');
  assert.deepEqual(result.reasons, []);
  assert.equal(matching.matchViewingBrand([agent.email], [agent], []).brandId, null);
  const oldMisfiled = { ...agent, companyId: 'wrong-brand', companyType: 'Tenant - Retail' };
  assert.equal(matching.matchViewingBrand([agent.email], [oldMisfiled], [link()]).brandId, 'brand');
});

test('all attendees are considered and conflicting brands remain unresolved', () => {
  const other = person('other', 'other-brand');
  for (const order of [[agent.email, other.email], [other.email, agent.email]]) {
    const result = matching.matchViewingBrand(order, [agent, other], [link()]);
    assert.equal(result.brandId, null);
    assert.ok(result.reasons.includes('ambiguous_brand'));
  }
  const result = matching.matchViewingBrand([agent.email, brandContact.email], [agent, brandContact], [link(), link('other-brand')]);
  assert.equal(result.brandId, 'brand', 'a brand employee can disambiguate the same agent’s clients');
});

test('unknown attendees, contractors and duplicate CRM emails require review without guessing their employer', () => {
  const contractor = person('builder', 'construction', 'Contractor');
  const result = matching.matchViewingBrand([agent.email, contractor.email, 'unknown@example.test'], [agent, contractor], [link()]);
  assert.equal(result.brandId, 'brand');
  assert.ok(result.reasons.includes('unmatched_attendee'));
  assert.ok(result.reasons.includes('unconfirmed_attendee_role'));
  assert.ok(matching.matchViewingBrand([agent.email], [agent, { ...agent, id: 'duplicate' }], [link()]).reasons.includes('duplicate_contact_email'));
});

test('contact matching normalizes email, does not infer another employee’s agency links, and avoids arbitrary requirements', () => {
  const result = matching.matchViewingBrand([' AGENT@EXAMPLE.TEST ', 'carly@brucegillinghampollard.com'], [agent], [link('brand', { requirementId: 'r1' }), link('brand', { requirementId: 'r2' })]);
  assert.equal(result.brandId, 'brand');
  assert.equal(result.requirementId, null);
  assert.equal(matching.matchViewingBrand([agent.email], [agent], [link('brand', { contactId: 'colleague' })]).brandId, null);
});

test('unit matching supports an explicit multi-unit visit with word boundaries and refuses ambiguous properties', () => {
  assert.deepEqual(matching.matchViewingUnits('Viewing Brent Cross Unit 1 and Unit 2', units).units.map(unit => unit.id), ['u1', 'u2']);
  assert.deepEqual(matching.matchViewingUnits('Viewing Brent Cross Unit 10', units).units, []);
  assert.deepEqual(matching.matchViewingUnits('Viewing Unit 1', units).units, []);
  assert.deepEqual(matching.matchViewingUnits('Viewing Brent Cross', units).units, []);
  assert.deepEqual(matching.matchViewingUnits('Viewing Brent Cross Unit 1', [units[0], { ...units[0], id: 'duplicate' }]).units, []);
  assert.deepEqual(matching.matchViewingUnits('Viewing Brent Cross and Bluewater', [...units, { id: 'b1', unitName: 'MSU9', propertyId: 'p2', propertyName: 'Bluewater Shopping Centre' }]).units, []);
});

test('calendar dates accept UTC with or without offsets and preserve London summer/winter time', () => {
  for (const dateTime of ['2026-09-16T09:00:00', '2026-09-16T09:00:00Z', '2026-09-16T10:00:00+01:00']) {
    assert.deepEqual(matching.londonViewingDateTime({ dateTime, timeZone: 'UTC' }), { date: '2026-09-16', time: '10:00' });
  }
  assert.deepEqual(matching.londonViewingDateTime({ dateTime: '2026-12-16T00:00:00', timeZone: 'UTC' }), { date: '2026-12-16', time: '00:00' });
  assert.throws(() => matching.parseGraphDateTime({ dateTime: '2026-09-16T09:00:00', timeZone: 'Europe/London' }), /unexpected timezone/);
  assert.throws(() => matching.parseGraphDateTime({ dateTime: 'invalid', timeZone: 'UTC' }), /invalid start/);
});

test('inspections, contractor visits and unclassified tours never automatically become leasing viewings', () => {
  assert.equal(matching.isLeasingViewing('Viewing with tenant'), true);
  for (const subject of ['Site inspection', 'Contractor viewing', 'Fire safety viewing', 'Site tour']) assert.equal(matching.isLeasingViewing(subject), false);
});

function ingestionHarness({ rows = [], tracker = units, contacts = [agent], links = [link()], failWrite = false, properties = [], brands = [] } = {}) {
  let stored = structuredClone(rows);
  let next = 1;
  let snapshot;
  const calls = [];
  const owners = [{ id: 'carly', email: 'carly@brucegillinghampollard.com' }, { id: 'will', email: 'will@brucegillinghampollard.com' }];
  const fields = ['unit_id', 'company_name', 'contact_name', 'contact_id', 'company_id', 'viewing_date', 'viewing_time', 'attendees', 'agent_contact_id', 'owner_user_id', 'requirement_id', 'details_confirmed_at', 'source_details', 'booking_id'];
  const pool = {
    async query(sql, args) {
      calls.push(sql);
      if (sql.includes('FROM available_units')) return { rows: tracker.map(unit => ({ id: unit.id, unit_name: unit.unitName, property_id: unit.propertyId, property_name: unit.propertyName, property_aliases: unit.propertyAliases || null })) };
      if (sql.includes('FROM crm_properties WHERE')) return { rows: properties };
      if (sql.includes('FROM crm_companies') && sql.includes("company_type ILIKE 'tenant%'")) return { rows: brands };
      if (sql.includes('SELECT booking_id, calendar_event_id')) return { rows: stored.filter(row => args[0].includes(row.booking_id || row.calendar_event_id)) };
      if (sql.includes('FROM users')) return { rows: owners };
      if (sql.includes('FROM crm_contacts')) return { rows: contacts.filter(person => args[0].includes(person.email)) };
      if (sql.includes('FROM brand_agent_representations')) {
        assert.match(sql, /r\.end_date IS NULL/);
        assert.match(sql, /r\.start_date <= NOW\(\)/);
        assert.match(sql, /IN \('', 'active'\)/);
        assert.match(sql, /q\.agent_contact_id = ANY\(\$1\)/);
        return { rows: links.filter(link => args[0].includes(link.contactId)) };
      }
      assert.fail(`Unexpected outside query: ${sql}`);
    },
    async connect() {
      return {
        release() {},
        async query(sql, args) {
          calls.push(sql);
          if (sql.includes('FROM crm_contacts') || sql.includes('FROM brand_agent_representations')) return pool.query(sql, args);
          if (sql === 'BEGIN') { snapshot = structuredClone(stored); return { rows: [] }; }
          if (sql === 'ROLLBACK') { stored = snapshot; return { rows: [] }; }
          if (sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
          if (sql.startsWith('SELECT * FROM unit_viewings')) return { rows: stored.filter(row => row.booking_id === args[0] || row.calendar_event_id === args[0]) };
          if (sql.includes("status = 'cancelled'")) {
            stored.filter(row => (row.booking_id === args[0] || row.calendar_event_id === args[0]) && !row.deleted_at).forEach(row => { row.booking_id = args[0]; row.status = 'cancelled'; });
            return { rows: [] };
          }
          if (sql.includes("SET status='not_leasing'")) {
            stored.filter(row => args[0].includes(row.id)).forEach(row => { row.status = 'not_leasing'; row.source_details = { ...(row.source_details || {}), autoNotLeasing: true }; });
            return { rows: [] };
          }
          if (failWrite) throw new Error('Synthetic write failure');
          const changes = Object.fromEntries(fields.map((field, index) => [field, field === 'source_details' ? JSON.parse(args[index]) : args[index]]));
          if (sql.startsWith('UPDATE unit_viewings SET unit_id')) {
            Object.assign(stored.find(row => row.id === args[14]), changes);
            return { rows: [] };
          }
          if (sql.startsWith('INSERT INTO unit_viewings')) {
            if (stored.some(row => row.calendar_event_id === args[14])) return { rows: [] };
            const row = { ...changes, id: `new-${next++}`, calendar_event_id: args[14], source: 'diary', status: 'scheduled', notes: args[15] };
            stored.push(row);
            return { rows: [{ id: row.id }] };
          }
          assert.fail(`Unexpected transaction query: ${sql}`);
        },
      };
    },
  };
  const module = evaluate(source('server/viewing-sync.ts'), { require(name) {
    if (name === './db') return { pool };
    if (name === 'node:crypto') return { createHash };
    if (name === '@shared/viewing-workflow') return { viewingMissingDetails };
    if (name === './viewing-matching') return matching;
    throw new Error(`Unexpected import ${name}`);
  } });
  return { module, calls, get rows() { return stored; }, run: (event = invitation(), mailbox = owners[0].email) => module.syncDiaryViewings([event], mailbox) };
}

test('calendar capture creates a confirmed brand viewing owned by its organiser and dedupes across mailboxes', async () => {
  const h = ingestionHarness();
  assert.equal(await h.run(), 1);
  assert.equal(await h.run(invitation(), 'will@brucegillinghampollard.com'), 0);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].company_id, 'brand');
  assert.equal(h.rows[0].agent_contact_id, 'agent');
  assert.equal(h.rows[0].owner_user_id, 'carly');
  assert.equal(h.rows[0].viewing_time, '10:00');
  assert.ok(h.rows[0].details_confirmed_at);
});

test('unmatched property and uncertain attendees are retained as a candidate for details', async () => {
  const h = ingestionHarness({ tracker: [] });
  await h.run(invitation({ attendees: [{ emailAddress: { address: 'contractor@example.test' } }] }));
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].unit_id, null);
  assert.equal(h.rows[0].company_id, null);
  assert.equal(h.rows[0].details_confirmed_at, null);
  assert.ok(h.rows[0].source_details.issues.length >= 3);
});

test('multiple named units create one row per unit under one booking; cancellation reaches all rows and preserves outcomes', async () => {
  const h = ingestionHarness();
  const event = invitation({ subject: 'Viewing Brent Cross Unit 1 and Unit 2' });
  assert.equal(await h.run(event), 2);
  assert.deepEqual(h.rows.map(row => row.calendar_event_id), ['booking-1', 'booking-1::unit:u2']);
  h.rows[0].outcome = 'Interested';
  await h.run({ ...event, subject: 'Cancelled', isCancelled: true });
  assert.ok(h.rows.every(row => row.status === 'cancelled'));
  assert.equal(h.rows[0].outcome, 'Interested');
});

test('changed invitations flag durable review without moving confirmed links, and completed time/outcomes are preserved', async () => {
  const h = ingestionHarness();
  await h.run();
  h.rows[0].company_id = 'manually-chosen';
  const changed = invitation({ subject: 'Viewing Brent Cross Unit 2', start: { dateTime: '2026-09-17T13:00:00Z', timeZone: 'UTC' } });
  await h.run(changed);
  assert.equal(h.rows[0].unit_id, 'u1');
  assert.equal(h.rows[0].company_id, 'manually-chosen');
  assert.equal(h.rows[0].viewing_date, '2026-09-17');
  assert.equal(h.rows[0].details_confirmed_at, null);
  await h.run(changed);
  assert.equal(h.rows[0].company_id, 'manually-chosen', 'review persists across repeated sweeps');
  assert.ok(h.rows[0].source_details.issues.some(issue => issue.startsWith('Calendar invitation changed')));
  h.rows[0].status = 'completed';
  h.rows[0].outcome = 'Interested';
  await h.run(invitation());
  assert.equal(h.rows[0].viewing_date, '2026-09-17');
  assert.equal(h.rows[0].outcome, 'Interested');
});

test('manually confirmed ambiguous events stay resolved and tombstones stop calendar resurrection', async () => {
  const h = ingestionHarness();
  const event = invitation({ attendees: [{ emailAddress: { address: 'unknown@example.test' } }] });
  await h.run(event);
  Object.assign(h.rows[0], { details_confirmed_at: new Date(), company_id: 'brand', contact_id: 'chosen', source_details: { ...h.rows[0].source_details, issues: [] } });
  await h.run(event);
  assert.deepEqual(h.rows[0].source_details.issues, []);
  assert.equal(h.rows[0].contact_id, 'chosen');
  h.rows[0].deleted_at = new Date();
  await h.run(event);
  assert.equal(h.rows.length, 1);
  assert.ok(h.rows[0].deleted_at);
});

test('legacy unconfirmed employer-as-brand entries are reevaluated; contractor visits are not saved, inspections are kept to classify', async () => {
  const h = ingestionHarness({ rows: [{ id: 'old', calendar_event_id: 'booking-1', unit_id: 'u1', company_id: 'agency', status: 'scheduled', source_details: {} }] });
  await h.run();
  assert.equal(h.rows[0].company_id, 'brand');
  assert.equal(h.rows[0].booking_id, 'booking-1');
  const contractor = ingestionHarness();
  assert.equal(await contractor.run(invitation({ subject: 'Roehampton Sports Ground contractor survey' })), 0);
  assert.equal(contractor.rows.length, 0);
  // Inspections are viewings (Woody, 2026-08-04): saved, flagged to classify.
  const inspection = ingestionHarness();
  await inspection.run(invitation({ subject: 'Roehampton Sports Ground Estate Inspection' }));
  assert.equal(inspection.rows.length, 1);
  assert.ok(inspection.rows[0].source_details.issues.some(i => /leasing viewing/i.test(i)));
  assert.ok(inspection.module.looksLikeViewing('Inspection'), 'historical broad calendar classification remains supported');
});

test('an untouched diary capture of a contractor visit closes as not_leasing; confirmed rows are never closed', async () => {
  const base = { calendar_event_id: 'booking-1', source: 'diary', unit_id: null, company_id: null, outcome: null, source_details: {} };
  const h = ingestionHarness({ rows: [{ ...base, id: 'open', status: 'scheduled', details_confirmed_at: null }] });
  await h.run(invitation({ subject: 'Roehampton Sports Ground contractor survey' }));
  assert.equal(h.rows[0].status, 'not_leasing');
  assert.equal(h.rows[0].source_details.autoNotLeasing, true);
  const confirmed = ingestionHarness({ rows: [{ ...base, id: 'kept', status: 'scheduled', details_confirmed_at: new Date(), unit_id: 'u1', company_id: 'brand' }] });
  await confirmed.run(invitation({ subject: 'Roehampton Sports Ground contractor survey' }));
  assert.equal(confirmed.rows[0].status, 'scheduled');
  const reverted = ingestionHarness({ rows: [{ ...base, id: 'back', status: 'scheduled', details_confirmed_at: null, source_details: { autoNotLeasing: true } }] });
  await reverted.run(invitation({ subject: 'Roehampton Sports Ground contractor survey' }));
  assert.equal(reverted.rows[0].status, 'scheduled', 'a row moved back from not_leasing by hand is not closed again');
});

const brixton = [
  { id: 'bv1', unitName: 'Unit 12', propertyId: 'bv', propertyName: 'Brixton Village', propertyAliases: ['Brixton Market'] },
  { id: 'bv2', unitName: 'Unit 40', propertyId: 'bv', propertyName: 'Brixton Village', propertyAliases: ['Brixton Market'] },
  { id: 'bh1', unitName: 'Studio 3', propertyId: 'bh', propertyName: 'Brixton Hill Studios' },
  { id: 'bs1', unitName: 'Unit A', propertyId: 'bs', propertyName: 'Brixton Station Road' },
  { id: 'mr1', unitName: 'Unit 7', propertyId: 'mr', propertyName: 'Market Row' },
];

test('property aliases and multi-word names match anywhere; the subject outranks the location', () => {
  const market = matching.matchViewingUnits('Brixton market viewing Bourne', brixton);
  assert.deepEqual(market.property, { id: 'bv', name: 'Brixton Village' });
  assert.deepEqual(market.units, []);
  assert.deepEqual(market.issues, ['Choose which tracker units are being viewed']);
  const gp = matching.matchViewingUnits('GP x Brixton Village Viewing', brixton, { location: 'Meet outside the Market Row entrance on Electric Road' });
  assert.equal(gp.property?.id, 'bv');
  assert.equal(matching.matchViewingUnits('Viewing', brixton, { location: 'Market Row entrance' }).property?.id, 'mr', 'location is used when the subject names no property');
  assert.deepEqual(matching.matchViewingUnits('Brixton Village Unit 12 viewing', brixton).units.map(unit => unit.id), ['bv1']);
  const other = matching.matchViewingUnits('Viewing at Coldharbour Works', brixton, { properties: [{ id: 'cw', name: 'Coldharbour Works' }, { id: 'lone', name: 'Works' }] });
  assert.deepEqual(other.property, { id: 'cw', name: 'Coldharbour Works' }, 'a property without tracker units is still named');
  // Live shape: Brixton Village / Brixton Market have no tracker units, Market Row does.
  const live = { properties: [{ id: 'bv', name: 'Brixton Village' }, { id: 'bm', name: 'Brixton Market' }, { id: 'mr', name: 'Market Row' }] };
  const rowOnly = brixton.filter(unit => unit.propertyId === 'mr');
  assert.equal(matching.matchViewingUnits('GP x Brixton Village Viewing', rowOnly, { ...live, location: 'Meet outside the Market Row entrance on Electric Road' }).property?.id, 'bv', 'the subject outranks a tracker property in the location');
  assert.equal(matching.matchViewingUnits('Brixton market viewing Bourne', rowOnly, { ...live, location: 'Market Row' }).property?.id, 'bm');
  assert.equal(matching.matchViewingUnits('Viewing', rowOnly, { ...live, location: 'Market Row entrance' }).property?.id, 'mr');
  assert.deepEqual(matching.propertyAliasList(['A', 1, ' ']), ['A']);
  assert.deepEqual(matching.propertyAliasList('Brixton Market'), ['Brixton Market']);
});

test('the brand named in the invitation is used only when attendees give none, and only when exactly one matches', () => {
  const index = matching.buildViewingBrandIndex([
    { id: 'goyard', name: 'Goyard' }, { id: 'market', name: 'Market' }, { id: 'bv-brand', name: 'Brixton Village' },
    { id: 'gp', name: 'General Projects', domains: ['https://www.generalprojects.com/'] }, { id: 'bgp', name: 'Bruce Gillingham Pollard' },
    { id: 'pret', name: 'Pret A Manger' }, { id: 'pret-short', name: 'Pret' },
  ], ['Brixton Village', 'Brixton Market']);
  assert.deepEqual(matching.inferViewingBrand('Goyard viewing', [], index), { brandId: 'goyard', brandName: 'Goyard', reason: 'brand_from_invitation' });
  assert.equal(matching.inferViewingBrand('Brixton market viewing', [], index), null, 'common words and property names are not brands');
  assert.equal(matching.inferViewingBrand('Goyardine viewing', [], index), null, 'whole words only');
  assert.equal(matching.inferViewingBrand('Goyard and Pret A Manger viewing', [], index), null, 'two brands named is a guess');
  assert.equal(matching.inferViewingBrand('Pret A Manger viewing', [], index)?.brandId, 'pret', 'the longer name wins over one it contains');
  assert.equal(matching.inferViewingBrand('Bruce Gillingham Pollard viewing', [], index), null);
  assert.deepEqual(matching.inferViewingBrand('GP x Brixton Village Viewing', ['a@generalprojects.com', 'b@reedwatts.com'], index), { brandId: 'gp', brandName: 'General Projects', reason: 'brand_from_domain' });
  assert.equal(matching.inferViewingBrand('Goyard viewing', [], index, ['other']), null, 'attendee candidates restrict the choice');
});

test('calendar capture takes the brand from the subject and records the named property', async () => {
  const h = ingestionHarness({ tracker: brixton, brands: [{ id: 'goyard', name: 'Goyard', domain: null, domain_url: null, website: null }] });
  await h.run(invitation({ subject: 'Goyard viewing', location: null, organizer: { emailAddress: { address: 'woody@brucegillinghampollard.com' } }, attendees: [] }));
  assert.equal(h.rows[0].company_id, 'goyard');
  assert.equal(h.rows[0].company_name, 'Goyard');
  assert.equal(h.rows[0].source_details.brandReason, 'brand named in the invitation');
  assert.equal(h.rows[0].details_confirmed_at, null);
  assert.ok(h.rows[0].source_details.issues.some(issue => /named in the invitation/.test(issue)));
  const bv = ingestionHarness({ tracker: brixton });
  await bv.run(invitation({ iCalUId: 'booking-2', subject: 'Brixton market viewing Bourne', location: null }));
  assert.equal(bv.rows[0].unit_id, null);
  assert.equal(bv.rows[0].source_details.sourcePropertyId, 'bv');
  assert.equal(bv.rows[0].source_details.sourcePropertyName, 'Brixton Village');
});

// Live shape (Woody, 2026-09-28): the Royal Exchange has one tracker unit, and
// Jack's "REX - Inspection" with the Appley team was filed against it.
const rex = [{ id: 'rex1', unitName: 'Unit 16 & 17', propertyId: 'rex', propertyName: 'Royal Exchange', propertyAliases: ['The Royal Exchange'] }];
const appley = person('tm', 'appley', 'Landlord');
const rexInspection = invitation({ iCalUId: 'rex-booking', subject: 'REX - Inspection ', location: { displayName: 'The Royal Exchange' },
  start: { dateTime: '2026-09-24T10:00:00Z', timeZone: 'UTC' }, organizer: { emailAddress: { address: 'carly@brucegillinghampollard.com' } },
  attendees: [{ emailAddress: { address: appley.email } }] });

test('an inspection, tour or walk-around of a building never takes its only tracker unit unless it names it', async () => {
  const inspection = matching.matchViewingUnits('REX - Inspection ', rex, { location: 'The Royal Exchange' });
  assert.deepEqual(inspection.units, []);
  assert.deepEqual(inspection.property, { id: 'rex', name: 'Royal Exchange' });
  assert.deepEqual(inspection.issues, ['Choose which tracker units are being viewed']);
  assert.deepEqual(matching.matchViewingUnits('Walk around The Royal Exchange // CDP & BGP', rex).units, []);
  assert.deepEqual(matching.matchViewingUnits('Site tour', rex, { location: 'The Royal Exchange' }).units, []);
  assert.deepEqual(matching.matchViewingUnits('Royal Exchange inspection Unit 16 & 17', rex).units.map(unit => unit.id), ['rex1'], 'a named unit still matches');
  assert.deepEqual(matching.matchViewingUnits('Cru viewing', rex, { location: 'The Royal Exchange' }).units.map(unit => unit.id), ['rex1'], 'a leasing viewing still takes the only unit');
  const h = ingestionHarness({ tracker: rex, contacts: [appley], links: [] });
  await h.run(rexInspection);
  assert.equal(h.rows[0].unit_id, null);
  assert.equal(h.rows[0].source_details.sourcePropertyId, 'rex');
  assert.ok(h.rows[0].source_details.issues.includes(h.module.NOT_LEASING_ISSUE));
});

function rematchHarness(rows, { tracker = rex, contacts = [appley] } = {}) {
  const sync = ingestionHarness({ tracker, contacts, links: [] }).module;
  const stored = structuredClone(rows);
  const settings = [], reconciled = [];
  const pool = {
    async query(sql, args) {
      if (sql.includes('FROM system_settings')) { settings.push(args[0]); return { rows: [] }; }
      if (sql.includes('INSERT INTO system_settings')) return { rows: [] };
      if (sql.includes("WHERE source = 'diary'")) return { rows: stored.filter(row => row.status === 'scheduled') };
      if (sql.includes('SELECT 1 FROM unit_viewings WHERE booking_id')) return { rows: stored.filter(row => row.booking_id === args[0] && row.unit_id === args[1] && row.id !== args[2]) };
      if (sql.includes('SET unit_id = $4')) {
        const row = stored.find(entry => entry.id === args[0] && entry.unit_id === args[1] && entry.company_id === args[2]);
        if (!row) return { rows: [], rowCount: 0 };
        Object.assign(row, { unit_id: args[3], company_id: args[4], source_details: { ...row.source_details, ...JSON.parse(args[10]) } });
        return { rows: [], rowCount: 1 };
      }
      assert.fail(`Unexpected rematch query: ${sql}`);
    },
  };
  const module = evaluate(source('server/viewing-rematch.ts'), { require(name) {
    if (name === './db') return { pool };
    if (name === '@shared/viewing-workflow') return { viewingMissingDetails };
    if (name === './viewing-matching') return matching;
    if (name === './viewing-sync') return sync;
    if (name === './viewing-followups') return { async reconcileViewingFollowup(id) { reconciled.push(id); return { resolved: 0, updated: 1, created: 0 }; } };
    throw new Error(`Unexpected import ${name}`);
  } });
  return { run: () => module.runViewingRematch(), rows: stored, settings, reconciled, NOT_LEASING_ISSUE: sync.NOT_LEASING_ISSUE };
}

test('the v3 re-match releases a unit the sync guessed for an inspection and restores the leasing question', async () => {
  const details = { subject: 'REX - Inspection ', location: 'The Royal Exchange', participants: [{ email: appley.email }],
    sourceUnitIds: ['rex1'], sourcePropertyId: 'rex', sourcePropertyName: 'Royal Exchange', issues: ['Confirm the brand being represented'] };
  const base = { booking_id: null, company_id: null, contact_id: null, agent_contact_id: null, owner_user_id: 'jack', viewing_date: '2026-09-24', viewing_time: '11:00', status: 'scheduled' };
  const h = rematchHarness([
    { ...base, id: 'guessed', unit_id: 'rex1', source_details: details },
    { ...base, id: 'chosen', unit_id: 'rex-other', source_details: details },
    { ...base, id: 'leasing', unit_id: 'rex1', source_details: { ...details, subject: 'Cru viewing', issues: [] } },
  ]);
  await h.run();
  assert.deepEqual(h.settings, ['migration:viewing_rematch_v3']);
  const [guessed, chosen, leasing] = h.rows;
  assert.equal(guessed.unit_id, null, 'the sole-unit guess is released');
  assert.deepEqual(guessed.source_details.sourceUnitIds, []);
  assert.ok(guessed.source_details.issues.includes(h.NOT_LEASING_ISSUE));
  assert.ok(guessed.source_details.issues.includes('Choose which tracker units are being viewed'));
  assert.equal(chosen.unit_id, 'rex-other', 'a unit a person chose is never released');
  assert.equal(leasing.unit_id, 'rex1', 'a leasing viewing keeps the only unit');
  assert.ok(!leasing.source_details.issues?.includes(h.NOT_LEASING_ISSUE));
  assert.deepEqual(h.reconciled, ['guessed', 'chosen', 'leasing']);
  const task = viewingFollowupDecision({ id: 'guessed', unitId: null, companyId: null, contactId: null, agentContactId: null, ownerUserId: 'jack',
    viewingDate: '2026-09-24', viewingTime: '11:00', status: 'scheduled', outcome: null, detailsConfirmedAt: null, createdAt: '2026-09-23T20:04:31Z',
    sourceDetails: guessed.source_details }, new Date('2026-09-28T10:00:00Z'));
  assert.match(task.title, /^Confirm viewing details — REX - Inspection · 24 Sept?$/, 'the task names the invitation, not Unit 16 & 17');
});

test('captured events remain reviewable if renamed away from viewing; save failures roll back and surface', async () => {
  const h = ingestionHarness();
  await h.run();
  await h.run(invitation({ subject: 'Contractor meeting' }));
  assert.equal(h.rows[0].details_confirmed_at, null);
  const failed = ingestionHarness({ failWrite: true });
  await assert.rejects(failed.run(), /could not be saved/);
  assert.equal(failed.rows.length, 0);
});

function fn(name) { return find('server/interactions.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === name); }

test('calendar pagination reaches beyond 300 records and fails visibly at a safety bound', async () => {
  const urls = [];
  const { graphGetPaged } = evaluate(`${fn('graphGetPaged')}\nexports.graphGetPaged = graphGetPaged;`, { async graphGet(token, url, headers) {
    urls.push({ url, headers });
    const page = Number(url.split('/').at(-1));
    return { value: Array.from({ length: 100 }, (_, index) => page * 100 + index), '@odata.nextLink': page < 4 ? `page/${page + 1}` : undefined };
  } });
  const result = await graphGetPaged('token', 'page/0', 1000, { requireComplete: true, headers: { Prefer: 'outlook.timezone="UTC"' } });
  assert.equal(result.length, 500);
  assert.ok(urls.every(call => call.headers.Prefer === 'outlook.timezone="UTC"'));
  await assert.rejects(graphGetPaged('token', 'page/0', 3, { requireComplete: true }), /not fully scanned/);
});

test('UTC preference is sent as a Graph HTTP header, not a query-string parameter', async () => {
  let received;
  const { graphGet } = evaluate(`${fn('graphGet')}\nexports.graphGet = graphGet;`, { fetch: async (url, options) => {
    received = { url, options };
    return { ok: true, text: async () => '{"value":[]}' };
  } });
  await graphGet('token', 'https://graph.microsoft.com/v1.0/users/test/calendarView', { Prefer: 'outlook.timezone="UTC"' });
  assert.equal(received.options.headers.Prefer, 'outlook.timezone="UTC"');
  assert.doesNotMatch(source('server/interactions.ts'), /&Prefer=/);
});

test('an email failure does not skip that mailbox’s calendar and both counts remain visible', async () => {
  const calendarUsers = [];
  const query = { from() { return this; }, where() { return Promise.resolve([]); }, then(resolve) { return Promise.resolve([]).then(resolve); } };
  const { runInteractionSync } = evaluate(`${fn('runInteractionSync')}\nexports.runInteractionSync = runInteractionSync;`, {
    getAppToken: async () => 'test', getAllContacts: async () => [], getBgpEmails: async () => ['a@example.test', 'b@example.test'],
    db: { select: () => query }, crmCompanies: {}, crmInteractions: {}, sql() {},
    syncEmailsForUser: async () => { throw new Error('Mailbox email unavailable'); },
    syncCalendarForUser: async (token, user) => { calendarUsers.push(user); return 3; }, trackEmailActivity() {},
  });
  const result = await runInteractionSync();
  assert.deepEqual(calendarUsers, ['a@example.test', 'b@example.test']);
  assert.equal(result.synced.calendar, 6);
  assert.equal(result.errors.length, 2);
  assert.equal(result.perUserStats.length, 2);
});

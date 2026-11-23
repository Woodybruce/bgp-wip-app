// One deal form for every way a letting reaches Solicitors (Woody,
// 2026-11-17): "in each of these situations lets have one form its exactly the
// same. use the new deal form as the basis but we need billing entity also
// linked to the tenants with ability to create as per the last one. also the
// type it and AI fills in ability in a new box at the top." New Deal, the
// Letting Tracker's move to Solicitors and the Heads of Terms' Convert to
// Solicitors open the New Deal form (DealFormDialog); a handover opens it on
// the unit's own deal, set to Solicitors. The deal note route, the billing
// entity route, the note mapping and the handover's starting form run for real
// with synthetic services; the screens are held by source checks. Nothing here
// needs a database, Companies House or Xero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as lettingNote from '../../shared/letting-note.ts';
import * as noteParse from '../../shared/letting-note-parse.ts';
import * as calendarDate from '../../shared/calendar-date.ts';
import * as lettingRules from '../../shared/letting-rules.ts';
import { dealNotePatch, noteTenant, addCommentLines } from '../../client/src/lib/deal-note.ts';
const require = createRequire(import.meta.url);
const { source, find, route, evaluate, ts } = require('./source-harness.cjs');
const zod = require('zod');

const DEALS = 'client/src/pages/deals.tsx';
const TRACKER = 'client/src/pages/available-units.tsx';
const HOTS = 'client/src/components/unit-hots/hots-workspace.tsx';
const quiet = { log() {}, warn() {}, error() {} };
const plain = value => JSON.parse(JSON.stringify(value));
const fn = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const constant = (file, name) => find(file, (node, ast) => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === name));
const response = () => ({ statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
// A whole server module, its imports answered from `modules` (anything else is an error).
const load = (file, modules, extra = {}) => {
  const js = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return evaluate(js.replace(/^"use strict";/, ''), {
    require(name) { if (name in modules) return modules[name]; throw new Error(`Unexpected module: ${name}`); },
    console: quiet, ...extra,
  });
};

// ── The box at the top: POST /api/deal-notes/read ────────────────────────────

const STAFF = { userId: 'u1', name: 'Woody Bruce', email: 'woody@brucegillinghampollard.com', isStaff: true, scope: null, scopeName: null, landsecRole: null, canEditTerms: true, agentControl: true, seesBgpNotes: true };
const CLIENT = { ...STAFF, name: 'Landsec leasing', email: 'leasing@landsec.com', isStaff: false, scope: 'landsec', agentControl: false };
const VIEWING_AS_CLIENT = { ...STAFF, scope: 'landsec' };
const TIGHT = 'Terms: 10 year lease. Rent £120k pax. 6 MRF. TBO yr 5';

async function readDealNote({ access = STAFF, body = { text: TIGHT, propertyId: 'p1', trackerUnitId: null }, unit = true, property = true, onUnit = [{ id: 'b1', name: "Jersey Mike's" }], dealReader = null } = {}) {
  const queries = [], accessFor = [];
  const pool = { async query(sql, params) {
    queries.push(sql);
    if (/FROM available_units u LEFT JOIN crm_properties p/.test(sql)) return { rows: unit ? [{ id: 'u1', unit_name: 'Unit 12', property_id: 'p1', property_name: 'Bluewater' }] : [] };
    if (/SELECT name FROM crm_properties WHERE id = \$1/.test(sql)) return { rows: property ? [{ name: 'Bluewater' }] : [] };
    if (/FROM users WHERE lower\(email\) LIKE/.test(sql)) return { rows: [{ name: 'Woody Bruce' }] };
    return { rows: [] };
  } };
  const mod = load('server/unit-note-reader.ts', {
    zod, '@shared/letting-note': lettingNote, '@shared/letting-note-parse': noteParse, '@shared/calendar-date': calendarDate,
    './db': { pool },
    './unit-brief-workspace': { briefAccess: async (_req, propertyId) => { accessFor.push(propertyId); return access; } },
    './unit-negotiation': { brandsOnUnit: async () => onUnit },
    ...(dealReader ? { './deal-note-reader': dealReader } : {}),
  }, { process: { env: {} } });   // no provider key: the rules read it alone
  let handler;
  mod.setupUnitNoteReaderRoutes({ post(url, ...handlers) { if (url === '/api/deal-notes/read') handler = handlers.at(-1); } });
  assert.ok(handler, 'the deal note route is registered');
  const res = response();
  await handler({ body }, res);
  return { res, body: plain(res.body ?? null), queries, accessFor };
}

test('the box reads a tight note for a New Deal with only a property: the terms fill, read as an offer', async () => {
  const { res, body, accessFor, queries } = await readDealNote();
  assert.equal(res.statusCode, 200, JSON.stringify(body));
  assert.deepEqual(accessFor, ['p1'], 'access is the property\'s');
  assert.equal(body.kind, 'offer');
  assert.deepEqual([body.fields.rentPa, body.fields.termYears, body.fields.rentFreeMonths], [120000, 10, 6]);
  assert.match(body.fields.breakOption, /year 5/);
  assert.equal(body.usedAi, false);
  assert.ok(!queries.some(sql => /available_units/.test(sql)), 'no tracker unit is looked up without one');
});

test('with the tracker unit the brands on the unit are the brands, and its property decides access', async () => {
  const { res, body, accessFor } = await readDealNote({ body: { text: `Jersey Mike's. ${TIGHT}`, trackerUnitId: 'u1' } });
  assert.equal(res.statusCode, 200, JSON.stringify(body));
  assert.deepEqual(accessFor, ['p1']);
  assert.equal(body.fields.brandName, "Jersey Mike's");
  assert.equal(body.fields.brandId, 'b1');
  assert.equal(body.fields.rentPa, 120000);
});

test('the deal itself is read beside the terms (2026-11-20): the route sends `deal` and tidies the offer reading by it', async () => {
  const deal = { dealType: { value: 'New Letting', quote: 'Letting' }, place: null, usedAi: false, dropped: [],
    parties: [{ role: 'tenant', name: 'Acme Ltd', quote: 'to Acme Ltd', candidates: [], register: [], registerNote: null }] };
  const asked = [], tidied = [];
  const dealReader = {
    readDealFromNote: async (_db, text, userId) => { asked.push([text, userId]); return deal; },
    tidyOfferReadingForDeal: (reading, d) => { tidied.push(d); reading.fields.tidied = true; },
  };
  const { res, body } = await readDealNote({ body: { text: TIGHT, propertyId: 'p1' }, dealReader });
  assert.equal(res.statusCode, 200, JSON.stringify(body));
  assert.deepEqual(body.deal, deal);
  assert.deepEqual(asked, [[TIGHT, 'u1']], 'the note and the login the read is counted against');
  assert.equal(tidied.length, 1);
  assert.equal(body.fields.tidied, true);
  assert.equal(body.fields.rentPa, 120000, 'the terms are still read');

  // The deal reading failing never costs the terms.
  const broken = await readDealNote({ dealReader: { readDealFromNote: async () => { throw new Error('down'); }, tidyOfferReadingForDeal: () => { throw new Error('never'); } } });
  assert.equal(broken.res.statusCode, 200);
  assert.equal(broken.body.deal, null);
  assert.equal(broken.body.fields.rentPa, 120000);
  const none = await readDealNote();
  assert.equal(none.res.statusCode, 200, 'with no deal reader at all the box still reads the terms');
  assert.equal(none.body.deal, null);
});

test('only BGP staff signed in as themselves: a client login, or staff viewing as a client, is refused before anything is read', async () => {
  for (const access of [CLIENT, VIEWING_AS_CLIENT, null]) {
    const { res, queries } = await readDealNote({ access });
    assert.equal(res.statusCode, 403, JSON.stringify(access));
    assert.ok(!queries.some(sql => /FROM users/.test(sql)), 'the staff list is never read for them');
  }
});

test('an unknown unit or property is a 404; the body takes the note and where the deal is, and nothing else', async () => {
  assert.equal((await readDealNote({ body: { text: TIGHT, trackerUnitId: 'gone' }, unit: false })).res.statusCode, 404);
  assert.equal((await readDealNote({ body: { text: TIGHT, propertyId: 'gone' }, property: false })).res.statusCode, 404);
  assert.equal((await readDealNote({ body: { text: TIGHT, kind: 'offer' } })).res.statusCode, 400, 'a strict body');
  assert.equal((await readDealNote({ body: { text: TIGHT, source: { type: 'target_comment', targetId: 't', at: 'x' } } })).res.statusCode, 400);
  const long = await readDealNote({ body: { text: 'x'.repeat(lettingNote.NOTE_MAX + 1) } });
  assert.equal(long.res.statusCode, 400);
  assert.match(long.body.message, /too long/);
  assert.equal((await readDealNote({ body: { text: '   ' } })).res.statusCode, 400);
});

test('the reader keeps one read of the users table and saves nothing; client logins never reach the route', () => {
  const reader = source('server/unit-note-reader.ts');
  assert.equal(reader.split('FROM users').length - 1, 1);
  assert.doesNotMatch(reader, /\b(?:INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(reader, /hots_final|readDocumentForAI/, 'a Heads of Terms document is read by the deal form\'s HOTs parser, not this reader');
  for (const list of ['CLIENT_ALLOWED_WRITES', 'CLIENT_ALLOWED_API']) {
    assert.doesNotMatch(find('server/index.ts', (node, ast) => ts.isVariableDeclaration(node) && node.name.getText(ast) === list), /deal-notes/, list);
  }
});

// ── Create billing entity ────────────────────────────────────────────────────

const insertTradingEntity = evaluate(fn('server/tenancy-tenant.ts', 'insertTradingEntity')).insertTradingEntity;
const pickBillingAddress = evaluate(fn('server/xero.ts', 'pickBillingAddress')).pickBillingAddress;
const CH_PROFILE = { company_name: "JERSEY MIKE'S UK LIMITED", company_status: 'active',
  registered_office_address: { premises: '1', address_line_1: 'High Street', locality: 'London', postal_code: 'W1A 1AA', country: 'England' } };

async function runBilling(o = {}) {
  const writes = [], reads = [], xeroCalls = [], remembered = [], chCalls = [];
  const client = {
    async query(sql, params) {
      writes.push(sql.trim().replace(/\s+/g, ' '));
      if (/^INSERT INTO crm_trading_entities/.test(sql.trim())) return { rows: o.entityExists ? [] : [{ id: 'te-new' }] };
      if (/SELECT id FROM crm_trading_entities WHERE parent_company_id/.test(sql)) return { rows: [{ id: 'te-old' }] };
      if (/SELECT id, name, companies_house_number FROM crm_trading_entities/.test(sql)) {
        return { rows: [{ id: params[0], name: "JERSEY MIKE'S UK LIMITED", companies_house_number: o.heldNumber === undefined ? '12345678' : o.heldNumber }] };
      }
      return { rows: [] };
    },
    release() { writes.push('release'); },
  };
  const pool = {
    async query(sql, params) {
      reads.push(sql.trim().replace(/\s+/g, ' '));
      if (/FROM crm_companies WHERE id = \$1/.test(sql)) return { rows: o.brand === null ? [] : [o.brand || { id: 'b1', name: "Jersey Mike's", merged_into_id: null }] };
      if (/FROM users WHERE id = \$1/.test(sql)) return { rows: [{ name: 'Woody Bruce', email: 'woody@brucegillinghampollard.com' }] };
      return { rows: [] };
    },
    async connect() { writes.push('connect'); return client; },
  };
  const mod = load('server/billing-entity.ts', {
    './auth': { requireAuth: (_req, _res, next) => next() },
    './company-scope': { isClientRequestUser: async () => !!o.isClient, resolveCompanyScope: async () => o.scope || null },
    './db': { pool },
    './companies-house': { chFetch: async path => { chCalls.push(path); if (o.chError) throw new Error(o.chError); return o.profile || CH_PROFILE; } },
    './tenancy-tenant': { insertTradingEntity },
    './xero-system-session': { withSystemXero: async work => (o.notConnected ? null : work({ xeroTokens: { tenantId: 'firm-tenant' } })) },
    './xero': {
      pickBillingAddress,
      rememberXeroContact: (tenantId, contact) => remembered.push({ tenantId, id: contact.ContactID }),
      xeroApi: async (_session, path, opts = {}) => {
        const method = opts.method || 'GET';
        const sent = opts.body ? JSON.parse(opts.body) : null;
        xeroCalls.push({ path, method, sent });
        if (method === 'GET') return { Contacts: o.found || [] };
        if (o.postError) throw new Error(o.postError);
        const c = sent.Contacts[0];
        return { Contacts: [{ ContactID: 'xc-new', Name: c.Name, Addresses: c.Addresses || [], ContactStatus: 'ACTIVE' }] };
      },
    },
  });
  let handler;
  mod.setupBillingEntityRoutes({ post(url, ...handlers) { if (url === '/api/billing-entities') handler = handlers.at(-1); } });
  const res = response();
  await handler({ body: o.body || { brandId: 'b1', companyNumber: '12345678' }, session: { userId: 'u1' } }, res);
  return { res, body: plain(res.body ?? null), writes, reads, xeroCalls: plain(xeroCalls), remembered: plain(remembered), chCalls: plain(chCalls), mod };
}

test('only BGP staff signed in as themselves create a billing entity: nothing is read or written for anyone else', async () => {
  for (const who of [{ isClient: true }, { scope: 'landsec' }]) {
    const out = await runBilling(who);
    assert.equal(out.res.statusCode, 403, JSON.stringify(who));
    assert.deepEqual([out.reads.length, out.writes.length, out.chCalls.length, out.xeroCalls.length], [0, 0, 0, 0], JSON.stringify(who));
  }
  for (const body of [{ brandId: 'b1' }, { brandId: 'b1', companyNumber: 'not a number!' }, { companyNumber: '12345678' }]) {
    const out = await runBilling({ body });
    assert.equal(out.res.statusCode, 400, JSON.stringify(body));
    assert.equal(out.reads.length, 0);
  }
});

test('a missing or merged brand, and a closed company, are refused before anything is written; a brand is never made', async () => {
  const missing = await runBilling({ brand: null });
  assert.equal(missing.res.statusCode, 404);
  assert.equal(missing.chCalls.length, 0);
  const merged = await runBilling({ brand: { id: 'b1', name: 'Old', merged_into_id: 'b9' } });
  assert.equal(merged.res.statusCode, 409);
  const closed = await runBilling({ profile: { ...CH_PROFILE, company_status: 'dissolved' } });
  assert.equal(closed.res.statusCode, 409);
  assert.match(closed.body.message, /dissolved at Companies House/);
  assert.deepEqual([closed.writes.length, closed.xeroCalls.length], [0, 0]);
  const unknown = await runBilling({ chError: 'Companies House API error 404: {"errors":[]}' });
  assert.equal(unknown.res.statusCode, 404);
  for (const out of [missing, merged, closed, unknown]) assert.ok(![...out.reads, ...out.writes].some(sql => /INSERT INTO crm_companies|UPDATE crm_companies/.test(sql)));
});

test('the company is read from Companies House, saved under the brand through the door, and made a contact in the firm\'s Xero', async () => {
  // A name or address in the request is never used: the server reads the company itself.
  const out = await runBilling({ body: { brandId: 'b1', companyNumber: '12345678', name: 'Someone Else Ltd', address: 'Elsewhere' } });
  assert.equal(out.res.statusCode, 201, JSON.stringify(out.body));
  assert.deepEqual(out.chCalls, ['/company/12345678']);
  // The door: one transaction, DO NOTHING on a name already there, then the audit line.
  assert.equal(out.writes[0], 'connect');
  assert.equal(out.writes[1], 'BEGIN');
  assert.ok(out.writes.some(sql => /^INSERT INTO crm_trading_entities \(parent_company_id, name, companies_house_number\) VALUES \(\$1, \$2, \$3\) ON CONFLICT \(parent_company_id, LOWER\(name\)\) DO NOTHING/.test(sql)));
  assert.ok(out.writes.some(sql => /^INSERT INTO investment_comp_migration_log/.test(sql)));
  assert.deepEqual(out.writes.slice(-2), ['COMMIT', 'release']);
  assert.deepEqual(out.body.entity, { id: 'te-new', name: "JERSEY MIKE'S UK LIMITED", companiesHouseNumber: '12345678', created: true });
  // Xero: a search by the legal name first, then the contact with its number and registered office.
  assert.equal(out.xeroCalls[0].method, 'GET');
  assert.equal(decodeURIComponent(out.xeroCalls[0].path), '/Contacts?where=Name=="JERSEY MIKE\'S UK LIMITED"');
  assert.equal(out.xeroCalls[1].method, 'POST');
  assert.deepEqual(out.xeroCalls[1].sent, { Contacts: [{ Name: "JERSEY MIKE'S UK LIMITED", CompanyNumber: '12345678',
    Addresses: [{ AddressType: 'POBOX', AddressLine1: '1 High Street', City: 'London', PostalCode: 'W1A 1AA', Country: 'England' }] }] });
  // The picker's shape, so the picker selects it and the deal carries its ContactID.
  assert.equal(out.body.contact.ContactID, 'xc-new');
  assert.equal(out.body.contact.Name, "JERSEY MIKE'S UK LIMITED");
  assert.equal(out.body.contact.BillingAddress.AddressType, 'POBOX');
  assert.equal(out.body.xeroCreated, true);
  assert.equal(out.body.xeroError, null);
  assert.deepEqual(out.remembered, [{ tenantId: 'firm-tenant', id: 'xc-new' }]);
});

test('a contact Xero already has is used, never made twice; a company already under the brand is reused unless its number differs', async () => {
  const found = await runBilling({ found: [{ ContactID: 'xc-1', Name: "Jersey Mike's UK Limited", ContactStatus: 'ACTIVE' }] });
  assert.equal(found.res.statusCode, 201);
  assert.deepEqual(found.xeroCalls.map(c => c.method), ['GET']);
  assert.equal(found.body.contact.ContactID, 'xc-1');
  assert.equal(found.body.xeroCreated, false);
  const reused = await runBilling({ entityExists: true, found: [{ ContactID: 'xc-1', Name: "JERSEY MIKE'S UK LIMITED" }] });
  assert.equal(reused.res.statusCode, 200);
  assert.equal(reused.body.entity.created, false);
  assert.ok(!reused.writes.some(sql => /investment_comp_migration_log/.test(sql)), 'no audit line for a company that was already there');
  const clash = await runBilling({ entityExists: true, heldNumber: '99999999' });
  assert.equal(clash.res.statusCode, 409);
  assert.match(clash.body.message, /99999999/);
  assert.ok(clash.writes.includes('ROLLBACK') && !clash.writes.includes('COMMIT'));
  assert.equal(clash.xeroCalls.length, 0);
});

test('a Xero refusal leaves the company saved and says why in plain words', async () => {
  const off = await runBilling({ notConnected: true });
  assert.equal(off.res.statusCode, 201);
  assert.equal(off.body.contact, null);
  assert.match(off.body.xeroError, /not connected/);
  const dup = await runBilling({ postError: 'Xero API error: 400 - {"Elements":[{"ValidationErrors":[{"Message":"The contact name JERSEY MIKE\'S UK LIMITED is already assigned to another contact. The contact name must be unique across all active contacts."}]}]}' });
  assert.equal(dup.body.contact, null);
  assert.equal(dup.body.xeroError, 'Xero already has a contact by this name. Type the name in the box to find it.');
  assert.doesNotMatch(dup.mod.xeroRefusal('Xero API error: 500 - {"raw":"stack"}'), /500|raw|stack/);
});

test('the request\'s company number is tidied, and the contact for Xero leaves out an address Companies House does not give', async () => {
  const { mod } = await runBilling();
  assert.deepEqual(plain(mod.billingEntityInput({ brandId: ' b1 ', companyNumber: ' 1234567 ' })), { brandId: 'b1', companyNumber: '01234567' });
  assert.deepEqual(plain(mod.billingEntityInput({ brandId: 'b1', companyNumber: 'sc123456' })), { brandId: 'b1', companyNumber: 'SC123456' });
  assert.equal(mod.billingEntityInput({ brandId: 'b1', companyNumber: '123456789' }), null);
  assert.deepEqual(plain(mod.xeroContactFor({ name: 'ACME LIMITED', number: '00000001', office: {} })), { Name: 'ACME LIMITED', CompanyNumber: '00000001' });
});

test('a contact made here goes on the firm\'s cached Xero list, once, and on no other organisation\'s', () => {
  const x = evaluate([constant('server/xero.ts', 'contactListCache'), fn('server/xero.ts', 'rememberXeroContact'),
    'exports.cache = contactListCache;'].join('\n'));
  x.cache.set('firm', { at: 1, list: [{ ContactID: 'a' }] });
  x.cache.set('firm-tenant', { at: 1, list: [] });
  x.cache.set('other-tenant', { at: 1, list: [] });
  x.rememberXeroContact('firm-tenant', { ContactID: 'new', Name: 'NEW LIMITED' });
  x.rememberXeroContact('firm-tenant', { ContactID: 'new', Name: 'NEW LIMITED' });
  assert.deepEqual([...x.cache.get('firm').list].map(c => c.ContactID), ['a', 'new']);
  assert.deepEqual([...x.cache.get('firm-tenant').list].map(c => c.ContactID), ['new']);
  assert.equal(x.cache.get('other-tenant').list.length, 0);
});

test('the billing entity route is registered, and the client gateway lets no client login reach it', () => {
  assert.match(source('server/index.ts'), /\(await import\("\.\/billing-entity"\)\)\.setupBillingEntityRoutes\(app\);/);
  for (const list of ['CLIENT_ALLOWED_WRITES', 'CLIENT_ALLOWED_API']) {
    assert.doesNotMatch(find('server/index.ts', (node, ast) => ts.isVariableDeclaration(node) && node.name.getText(ast) === list), /billing-entit/, list);
  }
});

// ── The one form ─────────────────────────────────────────────────────────────

const FORM = { tenantId: 'old', tenantEntityId: 'xero-old', tenantEntityName: 'OLD LIMITED', rentPa: '100000', leaseLength: '5', rentFree: '', breakOption: '', capitalContribution: '', comments: 'Finance: invoice the landlord' };
const TENANTS = [{ id: 'b1', name: "Jersey Mike's" }, { id: 'b2', name: 'Pho' }, { id: 'b3', name: 'Pho' }];
const reading = fields => ({ kind: 'offer', text: '', fields, quotes: {}, unplaced: [], dropped: [], saidBy: null, usedAi: false });

test('a reading fills the rent, the lease terms and the capital contribution; anything with no box goes into Comments once', () => {
  const { patch, brandHint } = dealNotePatch(FORM, reading({ rentPa: 120000, termYears: 10, rentFreeMonths: 6, breakOption: 'Tenant break at year 5', fittingOutContribution: 50000, turnoverRentPct: 9, premium: 25000, date: '2026-11-09' }), TENANTS);
  assert.deepEqual([patch.rentPa, patch.leaseLength, patch.rentFree, patch.breakOption, patch.capitalContribution], ['120000', '10', '6', 'Tenant break at year 5', '50000']);
  assert.equal(patch.comments, 'Finance: invoice the landlord\nTurnover rent: 9%\nPremium: £25,000\nDated 9 Nov 2026');
  assert.equal(brandHint, undefined, 'no brand named');
  assert.ok(!('tenantId' in patch));
  // One value (Use): only that box changes; a line already there is not added twice.
  assert.deepEqual(dealNotePatch(FORM, reading({ rentPa: 95000 }), TENANTS).patch, { rentPa: '95000' });
  assert.equal(addCommentLines('Premium: £25,000', ['Premium: £25,000', 'Contact: Sam']), 'Premium: £25,000\nContact: Sam');
});

test('the tenant is taken only when the picker lists it, by id or one exact name; an offer\'s date is never the target date', () => {
  const byId = dealNotePatch(FORM, reading({ brandName: "Jersey Mike's", brandId: 'b1' }), TENANTS);
  assert.deepEqual(byId.patch, { tenantId: 'b1', tenantEntityId: '', tenantEntityName: '', tenantTradingEntityId: '' });
  assert.equal(byId.brandHint, null);
  const unknown = dealNotePatch(FORM, reading({ brandName: 'Dishoom' }), TENANTS);
  assert.ok(!('tenantId' in unknown.patch));
  assert.equal(unknown.brandHint, 'Dishoom');
  assert.equal(noteTenant(reading({ brandName: 'pho' }), TENANTS), null, 'two tenants by that name: neither');
  assert.equal(dealNotePatch({ ...FORM, tenantId: 'b1' }, reading({ brandId: 'b1', brandName: "Jersey Mike's" }), TENANTS).patch.tenantId, undefined, 'the same tenant keeps its billing entity');
  assert.ok(!('targetDate' in dealNotePatch(FORM, reading({ date: '2027-03-01' }), TENANTS).patch));
});

function handoverForm() {
  const empty = { name: '', status: '', dealType: '', propertyId: '', unitId: '', landlordId: '', tenantId: '', tenantEntityId: '', tenantEntityName: '', fee: '', rentPa: '', totalAreaSqft: '', leaseLength: '', rentFree: '', breakOption: '', capitalContribution: '' };
  return evaluate(fn(DEALS, 'handoverForm'), {
    dealToForm: deal => ({ ...empty, ...deal }), emptyForm: empty,
    LEGACY_LETTING_TYPES: lettingRules.LEGACY_LETTING_TYPES, DEFAULT_LETTING_TYPE: lettingRules.DEFAULT_LETTING_TYPE,
  }).handoverForm;
}

test('a handover opens on the unit\'s own deal at Solicitors, with the unit\'s figures and the property\'s landlord where the deal has none', () => {
  const start = handoverForm();
  const unit = { id: 'row-1', unitName: 'Unit 12', propertyId: 'p1', propertyName: 'Bluewater', propertyUnitId: 'pu-1', dealId: 'd1', fee: 12000, askingRent: 150000, sqft: 2450 };
  const f = plain(start({ name: 'Bluewater – Unit 12', status: 'NEG', dealType: 'Leasing', propertyId: 'p1', fee: '9000' }, { kind: 'promote', unit }, 'landlord-1'));
  assert.equal(f.status, 'SOL');
  assert.equal(f.dealType, lettingRules.DEFAULT_LETTING_TYPE, 'a legacy letting label reads as New Letting');
  assert.deepEqual([f.fee, f.rentPa, f.totalAreaSqft, f.landlordId, f.unitId, f.name], ['9000', '150000', '2450', 'landlord-1', 'pu-1', 'Bluewater – Unit 12']);
  // A tracker row with no deal yet: named after the place.
  assert.equal(plain(start(null, { kind: 'promote', unit: { ...unit, dealId: null } }, null)).name, 'Bluewater – Unit 12');
});

test('a Heads of Terms convert starts from the agreed offer\'s tenant and terms; a new tenant drops the old billing entity', () => {
  const start = handoverForm();
  const unit = { id: 'row-1', unitName: 'Unit 12', propertyId: 'p1', dealId: 'd1' };
  const defaults = { tenantCompanyId: 'b1', tenantName: "Jersey Mike's", rentPa: 120000, leaseLengthYears: 10, rentFreeMonths: 6, breakOption: 'Tenant break at year 5', capitalContribution: 50000 };
  const f = plain(start({ tenantId: 'b9', tenantEntityId: 'xero-9', tenantEntityName: 'OLD', rentPa: '100000' }, { kind: 'hots', unit, defaults, onConverted() {} }, null));
  assert.deepEqual([f.tenantId, f.tenantEntityId, f.tenantEntityName], ['b1', '', '']);
  assert.deepEqual([f.rentPa, f.leaseLength, f.rentFree, f.breakOption, f.capitalContribution], ['120000', '10', '6', 'Tenant break at year 5', '50000']);
  const same = plain(start({ tenantId: 'b1', tenantEntityId: 'xero-1', tenantEntityName: 'JERSEY MIKE\'S UK LIMITED' }, { kind: 'hots', unit, defaults, onConverted() {} }, null));
  assert.equal(same.tenantEntityId, 'xero-1', 'the same tenant keeps its billing entity');
});

test('the Letting Tracker\'s move to Solicitors opens the one form on the unit\'s deal; the old Promote box is gone', () => {
  const page = source(TRACKER);
  assert.match(page, /import \{ DealHandoverDialog \} from "@\/pages\/deals";/);
  assert.match(page, /if \(field === "marketingStatus" && legacyToCode\(value\) === "SOL" && !isClientTracker\) \{[\s\S]{0,120}setPromoteUnit\(unit\);/);
  assert.match(page, /<DealHandoverDialog\s+open=\{!!promoteUnit\}/);
  assert.match(page, /kind: "promote",\s+unit: \{\s+id: promoteUnit\.id,/);
  for (const gone of ['wipForm', 'wipDealMutation', 'applyPromoteNote', '/create-deal`']) assert.ok(!page.includes(gone), gone);
});

test('the Heads of Terms\' convert opens the one form for BGP staff; a joint agent keeps the short form with no CRM picking', () => {
  const ws = source(HOTS);
  assert.match(ws, /viewer\.canConvert && ws\.convertDefaults && viewer\.isStaff \? \(/);
  assert.match(ws, /data-testid="hots-convert-start"/);
  assert.match(ws, /<HotsConvertForm defaults=\{ws\.convertDefaults\} busy=\{busy === "convert"\} onConvert=\{convert\} crmPicker=\{false\} \/>/);
  assert.match(ws, /kind: "hots",[\s\S]{0,400}onConverted: out => \{ setConverted\(out\); afterWrite\(true\); \},/);
});

test('a handover saves through the unit\'s own deal: Solicitors on the deal\'s save, or the Heads of Terms\' convert for the terms, never a new deal', () => {
  const save = constant(DEALS, 'saveHandover');
  assert.match(save, /payload\.status = "SOL";\s+if \(!dealId\) \{/);
  assert.match(save, /`\/api\/available-units\/\$\{encodeURIComponent\(h\.unit\.id\)\}\/ensure-deal`/, 'a tracker row with no deal is given its deal by the tracker\'s own door first');
  assert.match(save, /const res = await apiRequest\("PUT", `\/api\/crm\/deals\/\$\{dealId\}`, payload\);\s+const warned = res\.headers\.get\("X-AML-Warning"\);/);
  assert.ok(!save.includes('/create-deal'), 'the old Promote route is not used');
  assert.match(save, /for \(const key of \["tenantId", "rentPa", "leaseLength", "rentFree", "breakOption", "capitalContribution"\]\) delete payload\[key\];\s+if \(dealId\) await apiRequest\("PUT", `\/api\/crm\/deals\/\$\{dealId\}`, payload\);/);
  assert.match(save, /hotsCall<HotsConversion>\("POST", `\/api\/unit-hots\/\$\{encodeURIComponent\(h\.unit\.id\)\}\/convert`, terms\)/);
  assert.match(save, /delete payload\.internalAgent;/, 'BGP Contact follows the fee split\'s own save');
  assert.ok(!save.includes('postDeal'), 'a handover never creates a deal');
});

test('the form: the box at the top, Create billing entity on the tenant, Add heads of terms files on the unit, the lease terms', () => {
  const page = source(DEALS);
  assert.match(page, /readUrl="\/api\/deal-notes\/read"\s+readExtra=\{\{ propertyId: form\.propertyId \|\| null, trackerUnitId: handover\?\.unit\.id \|\| null \}\}/);
  assert.match(page, /\{!isEdit && !isClientCreate && form\.dealType !== "Consultant" && \(\s+<NoteFill/, 'staff only, never on the edit form');
  assert.match(page, /createFor=\{\{ id: form\.tenantId, name: partyName\(form\.tenantId, "the tenant"\) \}\}/);
  assert.match(page, /await hotsCall\("POST", `\/api\/unit-hots\/\$\{encodeURIComponent\(hotsUnitId\)\}\/final`, filing\);/);
  assert.match(page, /const patch: Record<string, any> = place \? \{\} : \{ status: "HOT" \};/, 'a handover stays at Solicitors when its HOTs are read');
  assert.match(page, /data-testid="deal-lease-terms"/);
  assert.match(page, /\{!isEdit && !isClientCreate && !handover && \(\s+<Button/, 'no Show all fields on a handover');
  // The save keeps a worded break and a total area with no floor areas.
  const toPayload = fn(DEALS, 'formToPayload');
  assert.match(toPayload, /breakOption: form\.breakOption\.trim\(\) \|\| null,/);
  assert.match(toPayload, /return t > 0 \? t : parseNum\(form\.totalAreaSqft\);/);
});

test('New Deal for a unit live on the tracker before Solicitors opens that unit\'s own deal in the form, never a second deal', () => {
  const page = source(DEALS);
  assert.match(page, /if \(row\.trackerRowId && code && \(\[\.\.\.PRE_MARKETING_STATUSES, "AVA", "NEG", "HOT"\] as string\[\]\)\.includes\(code\)\) \{\s+setMoveTo\(/);
  assert.match(page, /\{!deal && !handover && \(\s+<DealHandoverDialog open=\{!!moveTo\}/);
});

test('the final Heads of Terms upload the box uses files the document as hots_final and moves no status', () => {
  const upload = route('server/unit-hots.ts', 'post', '/api/unit-hots/:unitId/final');
  assert.match(upload, /if \(!access\.agentControl\) return res\.status\(403\)/);
  assert.match(upload, /VALUES \(\$1, \$2, \$3, 'hots_final', \$4, \$5, 'other'\)/);
  assert.doesNotMatch(upload, /moveUnitStatus|marketingStatus|marketing_status|updateDeal|crm_deals/);
});

test('the Xero picker says plainly a company is not in Xero yet when the firm link answers, keeps the reconnect advice for a real problem, and creates only with a brand', () => {
  const picker = source('client/src/components/xero-contact-picker.tsx');
  assert.match(picker, /const firmAnswers = !!check\?\.firm\?\.connected && !check\.firm\.error && Number\(check\.firm\.contacts\) > 0;/);
  assert.match(picker, /const notInXero = emptyAnswer && !!trimmed && firmAnswers;/);
  assert.match(picker, /is not in Xero yet\./);
  assert.match(picker, /\{!isFetching && !notConnected && !notInXero && !stillChecking && \(/);
  assert.match(picker, /\{createFor\?\.id && \(\s*<Button/);
  assert.match(picker, /createFor\?: \{ id: string; name: string \} \| null;/, 'optional: every other picker is unchanged');
  const dialog = source('client/src/components/billing-entity-create.tsx');
  assert.match(dialog, /fetch\("\/api\/billing-entities"/);
  assert.match(dialog, /body: JSON\.stringify\(\{ brandId: brand\.id, companyNumber: hit\.companyNumber, \.\.\.\(xero \? \{\} : \{ xero: false \}\) \}\)/, 'the name and address come from Companies House on the server');
  // Or a person (20 November 2026): their own name, email and mobile, checked as a private individual.
  assert.match(dialog, /person: \{ name: person\.name, email: person\.email \|\| null, mobile: person\.mobile \|\| null \}/);
  assert.match(dialog, /\/api\/companies-house\/search\?q=/);
});

// ── Billing entities linked to their party, and Kick off AML ─────────────────
// Woody, 2026-11-17: "tenant and Landlord first then the billing entity comes up
// linked to that tenant or landlord", then "on the form we need a button to
// allow us to Kick off the AML".

test('each party\'s billing box comes up once the party is picked, linked to it, with Create; never for a client login', () => {
  const page = source(DEALS);
  for (const [role, fallback] of [['landlord', 'the landlord'], ['tenant', 'the tenant'], ['vendor', 'the vendor'], ['purchaser', 'the purchaser']]) {
    assert.match(page, new RegExp(`\\{form\\.${role}Id && !hideFees && \\(`), `${role}: after the party is picked, staff only`);
    assert.match(page, new RegExp(`Billing entity for \\{partyName\\(form\\.${role}Id, "${fallback}"\\)\\} \\(Xero\\)`), `${role}: named for its party`);
    assert.match(page, new RegExp(`createFor=\\{\\{ id: form\\.${role}Id, name: partyName\\(form\\.${role}Id, "${fallback}"\\) \\}\\}`), `${role}: linked to its party`);
  }
});

test('the box lists the companies filed under the party first; picking one keeps it under the party and finds or makes its Xero contact', () => {
  const picker = source('client/src/components/xero-contact-picker.tsx');
  assert.match(picker, /queryKey: leaseCompaniesKey\(partyId\),/, 'one cache with the lease company picker');
  assert.match(picker, /fetch\(`\/api\/crm\/companies\/\$\{encodeURIComponent\(partyId\)\}\/trading-entities`/);
  assert.match(picker, /Filed under \{createFor\.name\}/);
  // With a Companies House number: the billing entity route (the company stays under the party; Xero's contact is found by name or made).
  assert.match(picker, /body: JSON\.stringify\(\{ brandId: createFor\.id, companyNumber: f\.companiesHouseNumber \}\)/);
  // Without one: its name is searched in Xero.
  assert.match(picker, /if \(!f\.companiesHouseNumber \|\| !createFor\?\.id\) \{ setSearch\(f\.name\); return; \}/);
  // Create is always offered for the party, not only when Xero has no match: a company or a person (20 November 2026).
  assert.match(picker, /New billing entity for \{createFor\.name\}: a company or a person/);
  // A person filed under the party is linked through the person route, by name.
  assert.match(picker, /body: JSON\.stringify\(\{ brandId: createFor\.id, person: \{ name: f\.name \} \}\)/);
  assert.match(picker, /queryClient\.invalidateQueries\(\{ queryKey: leaseCompaniesKey\(createFor\.id\) \}\)/);
});

test('the billing entity route speaks of a landlord or a brand, and still takes no name or address from the request', () => {
  const route = source('server/billing-entity.ts');
  assert.match(route, /That landlord or brand was not found\./);
  assert.match(route, /Check which company is right on its page\./);
  assert.doesNotMatch(route, /That brand was not found/);
});

test('after New Deal or a move to Solicitors saves, the form offers Kick off AML on each party: BGP staff only, never on the edit form', () => {
  const page = source(DEALS);
  const step = constant(DEALS, 'showAmlStep');
  assert.match(step, /if \(!dealId \|\| isClientCreate\) return false;/);
  assert.match(step, /\["landlord", "Landlord", form\.landlordId\], \["tenant", "Tenant", form\.tenantId\],/);
  assert.match(step, /if \(!parties\.length\) return false;/);
  assert.match(page, /if \(isEdit \|\| !showAmlStep\(data\?\.id, data\?\.dealRef \?\? null\)\) onOpenChange\(false\);/);
  assert.match(page, /if \(!showAmlStep\(data\?\.id, data\?\.conversion\?\.dealRef \?\? deal\?\.dealRef \?\? null\)\) onOpenChange\(false\);/);
  // Each party gets the client checks (KYC4U is no longer used, 23 November 2026).
  assert.match(page, /\{clientChecks && <SendClientChecksButton dealId=\{amlStep\.dealId\} companyId=\{p\.id\} partyName=\{p\.name\} label="Kick off AML" \/>\}/);
  assert.match(page, /useEffect\(\(\) => \{ if \(!open\) setAmlStep\(null\); \}, \[open\]\);/);
  assert.doesNotMatch(page, /Kyc4uRequestButton/);
});

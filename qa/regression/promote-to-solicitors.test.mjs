// The Promote to Solicitors box on the Letting Tracker (Woody, 2026-11-17):
// "use the AI notes to fill in the form function we have for other forms",
// "allow for add HOTs which should also then file and populate", and "if cant
// find a billing entity for tenant then should be able to create one and
// search companies house?". The note reader's route (the Heads of Terms
// source), the billing entity route, the form's reading mapper and the Xero
// list cache run for real with synthetic services; the screens are held by
// source checks. Nothing here needs a database, Companies House or Xero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as lettingNote from '../../shared/letting-note.ts';
import * as noteParse from '../../shared/letting-note-parse.ts';
import * as calendarDate from '../../shared/calendar-date.ts';
import { STANDARD_HOTS_TEMPLATE } from '../../shared/unit-hots.ts';
const require = createRequire(import.meta.url);
const { source, find, route, evaluate, ts } = require('./source-harness.cjs');
const zod = require('zod');

const PAGE = 'client/src/pages/available-units.tsx';
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

// ── The note reader: the unit's final Heads of Terms as a source ─────────────

const HOTS = STANDARD_HOTS_TEMPLATE
  .replace(/\{UNIT\}/g, 'Unit 12').replace(/\{PROPERTY\}/g, 'Bluewater').replace('{DATE}', '12 November 2026')
  .replace('{AREA}', '2,450 sq ft').replace('{LANDLORD}', 'Landsec Bluewater Limited').replace('{TENANT}', "Jersey Mike's UK Limited")
  .replace('{TENANT_CONTACT}', 'Sam Smith').replace('{TERM}', '10 years').replace('{BREAK}', 'Tenant break at year 5 on 6 months notice')
  .replace('{RENT}', '£120,000').replace('{TURNOVER_RENT}', 'None').replace('{RENT_DEPOSIT}', '3 months rent').replace('{CAPITAL_CONTRIBUTION}', '£50,000')
  .replace('{RENT_FREE}', '6 months').replace('{RENT_REVIEW}', 'Upward only at year 5').replace('{SERVICE_CHARGE}', '£25,000')
  .replace('{INSURANCE}', '£3,000').replace('{USE}', 'Restaurant');

const STAFF = { userId: 'u1', name: 'Woody Bruce', email: 'woody@brucegillinghampollard.com', isStaff: true, scope: null, scopeName: null, landsecRole: null, canEditTerms: true, agentControl: true, seesBgpNotes: true };
const CLIENT = { ...STAFF, name: 'Landsec leasing', email: 'leasing@landsec.com', isStaff: false, scope: 'landsec', agentControl: false };

async function readHots({ access = STAFF, file = '/uploads/marketing-files/final-hots.pdf', docText = HOTS, body = { kind: 'offer', source: { type: 'hots_final' } } } = {}) {
  const queries = [], docReads = [];
  const pool = { async query(sql, params) {
    queries.push(sql);
    if (/FROM available_units u LEFT JOIN crm_properties p/.test(sql)) return { rows: [{ id: 'u1', unit_name: 'Unit 12', property_id: 'p1', property_name: 'Bluewater' }] };
    if (/JOIN unit_marketing_files f ON f\.id = u\.hots_final_file_id AND f\.unit_id = u\.id/.test(sql)) return { rows: file ? [{ file_path: file }] : [] };
    return { rows: [] };
  } };
  const mod = load('server/unit-note-reader.ts', {
    zod, '@shared/letting-note': lettingNote, '@shared/letting-note-parse': noteParse, '@shared/calendar-date': calendarDate,
    './db': { pool },
    './unit-brief-workspace': { briefAccess: async () => access },
    './document-reader': { readDocumentForAI: async args => { docReads.push(args); return docText == null ? { ok: true, error: 'Extraction failed: no text layer' } : { ok: true, text: docText }; } },
    './unit-negotiation': { brandsOnUnit: async () => [{ id: 'b1', name: "Jersey Mike's" }] },
  }, { process: { env: {} } });   // no provider key: the rules read it alone
  let handler;
  mod.setupUnitNoteReaderRoutes({ post(url, ...handlers) { if (url === '/api/unit-offers/unit/:unitId/read-note') handler = handlers.at(-1); } });
  const res = response();
  await handler({ params: { unitId: 'u1' }, body }, res);
  return { res, body: plain(res.body ?? null), queries, docReads, mod };
}

test('the final Heads of Terms are read from the file on the unit, as a note written out in full: nothing fills but a brand on the unit', async () => {
  const { res, body, docReads, mod } = await readHots();
  assert.equal(res.statusCode, 200, JSON.stringify(body));
  assert.deepEqual(plain(docReads), [{ storageKey: 'marketing-files/final-hots.pdf', includePageImages: false, maxTextChars: 40000 }]);
  // Prose: Claude's reading and the rules' never fill a term by themselves. The brand on the unit, found alone, may.
  assert.deepEqual(body.fields, { brandName: "Jersey Mike's", brandId: 'b1' });
  const unsure = field => (body.unsure || []).filter(u => u.field === field);
  assert.ok(unsure('rentPa').some(u => u.value === 120000 && /120,000/.test(u.quote)), JSON.stringify(body.unsure));
  assert.ok(unsure('termYears').some(u => u.value === 10), 'the lease length to check');
  assert.ok(unsure('rentFreeMonths').some(u => u.value === 6 && /Rent free: 6 months/.test(u.quote)), 'the rent free to check, with its words');
  assert.ok(unsure('breakOption').some(u => /year 5/.test(u.value)));
  // The document is longer than the reader takes: cut, and the read-back says so.
  assert.ok(body.text.length <= lettingNote.NOTE_MAX);
  assert.equal(body.reason, `${mod.HOTS_READ_REASON} ${mod.HOTS_CUT_NOTE}`);
  assert.equal(body.usedAi, false);
});

test('a short Heads of Terms is not said to be cut; a document with no text says so; none on the unit is a 404', async () => {
  const short = await readHots({ docText: 'Heads of Terms. Tenant: Jersey Mike\'s. Term: 10 years. Rent: £120,000 per annum exclusive. Rent free: 6 months.' });
  assert.equal(short.res.statusCode, 200);
  assert.equal(short.body.reason, short.mod.HOTS_READ_REASON);
  const blank = await readHots({ docText: null });
  assert.equal(blank.res.statusCode, 422);
  assert.match(blank.body.message, /No text could be read/);
  const none = await readHots({ file: null });
  assert.equal(none.res.statusCode, 404);
  assert.match(none.body.message, /no final Heads of Terms on this unit/);
  assert.equal(none.docReads.length, 0);
});

test('only the agents who file the Heads of Terms may have them read: anyone else is refused before the file is looked up', async () => {
  const { res, queries, docReads } = await readHots({ access: CLIENT });
  assert.equal(res.statusCode, 403);
  assert.equal(docReads.length, 0);
  assert.ok(!queries.some(sql => /unit_marketing_files/.test(sql)));
  // And a request may only name the source: never its words, never which file.
  assert.equal((await readHots({ body: { kind: 'offer', source: { type: 'hots_final', fileId: 'other-unit-file' } } })).res.statusCode, 400);
  assert.equal((await readHots({ body: { kind: 'offer', source: { type: 'hots_final', text: 'Rent £1 pax' } } })).res.statusCode, 400);
});

test('the route reads the Heads of Terms after the unit and the scheme checks, and the reader still saves nothing', () => {
  const reader = source('server/unit-note-reader.ts');
  const at = needle => { const i = reader.indexOf(needle); assert.ok(i > 0, needle); return i; };
  const order = [at('briefAccess(req, unit.property_id)'), at('readNoteBody.safeParse'), at('if (body.source?.type === "hots_final")'),
    at('if (!access.agentControl) return res.status(403)'), at('JOIN unit_marketing_files f ON f.id = u.hots_final_file_id'), at('readDocumentForAI({'), at('readLettingNote({')];
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(reader, /\b(?:INSERT|UPDATE|DELETE)\b/);
  assert.match(reader, /includePageImages: false/);
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

// ── The form ─────────────────────────────────────────────────────────────────

function promoteMapper() {
  const v = name => constant(PAGE, name);
  const state = { form: { tenantId: 'old', tenantName: 'Old Brand', tenantEntityId: 'xero-old', tenantEntityName: 'OLD LIMITED', askingRent: '100000', leaseLength: '5', rentFree: '', targetDate: '2027-01-31', comments: 'Bluewater — Unit 12' }, hint: undefined };
  const { applyPromoteNote } = evaluate([v('noteName'), v('noteDay'), v('noteNumber'), v('oneByName'), v('noteCompany'), v('addNoteLines'), v('noteAgentLine'), v('applyPromoteNote'),
    'exports.applyPromoteNote = applyPromoteNote;'].join('\n'), {
    wipUnit: { id: 'u1' },
    offersByUnit: { u1: [{ companyId: 'b1' }] }, viewingsByUnit: { u1: [] }, interestByUnit: { u1: [{ companyId: 'b2' }] },
    crmCompanies: [{ id: 'b1', name: "Jersey Mike's" }, { id: 'b2', name: 'Pho' }, { id: 'b3', name: 'Dishoom' }],
    setWipForm: update => { state.form = typeof update === 'function' ? update(state.form) : update; },
    setWipBrandHint: hint => { state.hint = hint; },
    formatCalendarDate: calendarDate.formatCalendarDate,
  });
  const apply = fields => applyPromoteNote({ kind: 'offer', text: '', fields, quotes: {}, unplaced: [], dropped: [], saidBy: null, usedAi: false });
  return { apply, state };
}

test('a reading fills the rent, the lease length and the rent free; a break goes into the Notes as a line; nothing else moves', () => {
  const { apply, state } = promoteMapper();
  apply({ rentPa: 120000, termYears: 10, rentFreeMonths: 6, breakOption: 'Tenant break at year 5' });
  assert.deepEqual([state.form.askingRent, state.form.leaseLength, state.form.rentFree], ['120000', '10', '6']);
  assert.equal(state.form.comments, 'Bluewater — Unit 12\nBreak: Tenant break at year 5');
  assert.equal(state.form.tenantId, 'old');
  assert.equal(state.form.targetDate, '2027-01-31');
  // One value at a time (Use): only that box. The same line is never added twice.
  apply({ rentPa: 95000 });
  assert.deepEqual([state.form.askingRent, state.form.leaseLength], ['95000', '10']);
  apply({ breakOption: 'Tenant break at year 5' });
  assert.equal(state.form.comments, 'Bluewater — Unit 12\nBreak: Tenant break at year 5');
});

test('the tenant brand is taken only when it is already on the unit; an offer\'s date is a line, never the target completion date', () => {
  const { apply, state } = promoteMapper();
  apply({ brandName: 'Dishoom' });
  assert.equal(state.form.tenantId, 'old', 'a brand not on the unit is never picked');
  assert.equal(state.hint, 'Dishoom');
  apply({ brandName: "Jersey Mike's", brandId: 'b1' });
  assert.deepEqual([state.form.tenantId, state.form.tenantName, state.form.tenantEntityId, state.form.tenantEntityName], ['b1', "Jersey Mike's", '', '']);
  assert.equal(state.hint, null);
  apply({ brandName: 'pho' });
  assert.equal(state.form.tenantId, 'b2', 'one exact name among the unit\'s brands');
  apply({ date: '2026-11-09', premium: 25000, fittingOutContribution: 50000, turnoverRentPct: 9 });
  assert.equal(state.form.targetDate, '2027-01-31');
  assert.match(state.form.comments, /\nDated 9 Nov 2026/);
  assert.match(state.form.comments, /\nPremium: £25,000\nCapital contribution: £50,000/);
  assert.match(state.form.comments, /\nTurnover rent: 9%/);
});

test('the Promote box reads its Notes with the shared box as an offer, new words only, and files Add HOTs through the HOTs flow before reading them', () => {
  const page = source(PAGE);
  assert.match(page, /<FillFromNotes key=\{`promote:\$\{wipUnit\?\.id \|\| ""\}`\} kind="offer" unitId=\{wipUnit\?\.id\} word="notes" newWordsOnly\s+text=\{wipForm\.comments\} keepText=\{v => setWipForm\(f => \(\{ \.\.\.f, comments: v \}\)\)\} onApply=\{applyPromoteNote\}>/);
  assert.match(page, /hotsCall<HotsWorkspace>\("POST", `\/api\/unit-hots\/\$\{encodeURIComponent\(unit\.id\)\}\/final`, fd\)/);
  assert.match(page, /<NoteFill key=\{reading\.key\} kind="offer" unitId=\{wipUnit\.id\} source=\{\{ type: "hots_final" \}\} autoRead autoApply onApply=\{applyPromoteNote\} \/>/);
  assert.match(page, /accept="\.pdf,\.docx"[^\n]*data-testid="wip-hots-file"/);
  // The tenant's billing picker offers Create billing entity under the tenant brand picked.
  assert.match(page, /createFor=\{wipForm\.tenantId \? \{ id: wipForm\.tenantId, name: wipForm\.tenantName \|\| "the tenant brand" \} : null\}/);
  // The compliance and AML parts of the box are untouched.
  assert.match(page, /if \(wipForm\.amlChecked !== "YES" && wipForm\.amlChecked !== "N-A"\) softMissing\.push\("AML \/ KYC checked"\);/);
});

test('the final Heads of Terms upload the box uses files the document as hots_final and moves no status', () => {
  const upload = route('server/unit-hots.ts', 'post', '/api/unit-hots/:unitId/final');
  assert.match(upload, /if \(!access\.agentControl\) return res\.status\(403\)/);
  assert.match(upload, /VALUES \(\$1, \$2, \$3, 'hots_final', \$4, \$5, 'other'\)/);
  assert.doesNotMatch(upload, /moveUnitStatus|marketingStatus|marketing_status|updateDeal|crm_deals/);
});

test('the shared note box names a Heads of Terms source and, where asked, reads only the words typed after the ones a box opened with', () => {
  const box = source('client/src/components/letting-note/note-fill.tsx');
  assert.match(box, /const doc = source\?\.type === "hots_final";/);
  assert.match(box, /\{reading\?\.text && !doc && /, 'a whole document is not printed in the box');
  assert.match(box, /return newWordsOnly && opening\.current && now\.startsWith\(opening\.current\) \? now\.slice\(opening\.current\.length\)\.trim\(\) : now;/);
  assert.match(box, /const said = toRead\(now\);\s+if \(!said\) return;/);
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
  assert.match(dialog, /body: JSON\.stringify\(\{ brandId: brand\.id, companyNumber: hit\.companyNumber \}\)/, 'the name and address come from Companies House on the server');
  assert.match(dialog, /\/api\/companies-house\/search\?q=/);
});

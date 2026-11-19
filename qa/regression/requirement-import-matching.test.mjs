import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { listingTarget, importMayLabel, requirementListingUpdates } = await import('../../shared/requirement-live.ts');
const pipnetAgents = await import('../../shared/pipnet-agents.ts');
const require = createRequire(import.meta.url);
const { find, evaluate, ts, source } = require('./source-harness.cjs');

// Audit, 2026-11-17: PIPnet and The Requirement List folded a new listing
// into the first requirement row of the same brand name, in no order and
// closed rows included. A closed row takes no listing update, so a brand
// whose old requirement was Past never came back under Market listings; and
// an older hand-made row (origin not recorded) could be labelled PIPnet,
// which puts it in front of client logins.

const row = (id, extra = {}) => ({ id, name: 'Pret A Manger', status: 'Active', origin: 'pipnet', sources: ['PIPnet'], externalRequirementId: null, lastListedAt: null, ...extra });
const sameBrand = r => r.name.toLowerCase().startsWith('pret a manger');

test('a listing folds into an open row by its link first, then an open row of the brand, never a closed one', () => {
  const linked = row('linked', { name: 'Pret A Manger Ltd', externalRequirementId: 'ext-1' });
  const named = row('named');
  assert.equal(listingTarget([named, linked], 'ext-1', sameBrand), linked, 'the link wins over the name');
  assert.equal(listingTarget([named, row('other')], 'ext-1', sameBrand), named, 'newest first among open rows of the brand');
  assert.equal(listingTarget([row('past', { status: 'Past' }), row('done', { status: 'satisfied' })], 'ext-1', sameBrand), null, 'a closed row is never folded into');
  assert.equal(listingTarget([row('past', { status: 'Past', externalRequirementId: 'ext-1' }), named], 'ext-1', sameBrand), named);
  // The row this very listing became was closed by a person: it is left so.
  assert.equal(listingTarget([row('past', { status: 'Archived', externalRequirementId: 'ext-1' })], 'ext-1', sameBrand), 'closed');
  assert.equal(listingTarget([], 'ext-1', sameBrand), null);
});

test('an import labels only rows of its own kind', () => {
  assert.equal(importMayLabel({ origin: 'bgp', sources: ['PIPnet'] }, 'PIPnet'), false);
  assert.equal(importMayLabel({ origin: null, sources: null }, 'PIPnet'), false, 'an older row may be hand-made');
  assert.equal(importMayLabel({ origin: null, sources: ['TRL'] }, 'PIPnet'), false);
  assert.equal(importMayLabel({ origin: null, sources: ['PIPnet'] }, 'PIPnet'), true);
  assert.equal(importMayLabel({ origin: '  ', sources: ['the requirement list'] }, 'TRL'), true);
  assert.equal(importMayLabel({ origin: 'pipnet' }, 'PIPnet'), true);
  assert.equal(importMayLabel({ origin: 'trl' }, 'PIPnet'), true);
});

// The real promote and refresh functions against a small stand-in for drizzle.
const fn = (file, name) => find(file, n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const table = (name, cols) => Object.fromEntries([['_table', name], ...cols.map(c => [c, `${name}.${c}`])]);
const TABLES = {
  crmRequirementsLeasing: table('crm_requirements_leasing', ['id', 'createdAt', 'externalRequirementId']),
  crmCompanies: table('crm_companies', ['id', 'name']),
  crmContacts: table('crm_contacts', ['id', 'name', 'companyId']),
  externalRequirements: table('external_requirements', ['id']),
};
const drizzle = { eq: (col, val) => ({ eq: [col, val] }), and: (...all) => ({ and: all }), isNull: col => ({ isNull: col }), desc: col => ({ desc: col }), ilike: (col, val) => ({ ilike: [col, val] }) };

function fakeDb(requirements) {
  const writes = [];
  const reads = [];
  const read = t => {
    const q = { where: () => q, limit: () => q, orderBy: o => { reads.push({ table: t._table, orderBy: o }); return q; },
      then: (ok, ko) => Promise.resolve(t._table === 'crm_requirements_leasing' ? requirements : []).then(ok, ko) };
    return q;
  };
  const tx = {
    select: () => ({ from: read }),
    insert: t => ({ values: v => {
      writes.push({ op: 'insert', table: t._table, v });
      const done = Promise.resolve([{ id: `new-${writes.length}` }]);
      return { returning: () => done, then: (ok, ko) => done.then(ok, ko) };
    } }),
    update: t => ({ set: v => ({ where: cond => { writes.push({ op: 'update', table: t._table, v, id: cond.eq[1] }); return Promise.resolve(); } }) }),
  };
  return { db: { ...tx, transaction: work => work(tx) }, writes, reads };
}
const requirementWrites = writes => writes.filter(w => w.table === 'crm_requirements_leasing');
// Arrays made inside the evaluated source carry that realm's prototype.
const plain = v => JSON.parse(JSON.stringify(v));

const LISTING = { companyName: 'Pret A Manger', companyLogo: null, contactName: null, contactTitle: null, contactEmail: null, contactPhone: null,
  useClass: 'A3', sizeRange: '1,000-1,500 sq ft', locations: null, tenure: null, description: null, pitch: null, lastUpdated: '01/11/2026', rawData: {} };

function pipnet(requirements) {
  const fake = fakeDb(requirements);
  // The agent firm and contact (upsertPipnetAgent) run for real; the tenant
  // rep link, written after the transaction through its own door, is a stand-in.
  const code = ['normaliseBrandName', 'parseUkDate', 'mapPlanningClassToBgpUse', 'promoteToCrmRequirement', 'upsertPipnetAgent'].map(n => fn('server/pipnet.ts', n)).join('\n');
  const mod = evaluate(`${code}\nexports.promote = promoteToCrmRequirement;`, { db: fake.db, ...TABLES, ...drizzle, listingTarget, importMayLabel, requirementListingUpdates,
    ...pipnetAgents, recordPipnetTenantRep: async () => 'skipped' });
  return { ...fake, promote: (externalId = 'ext-1') => mod.promote(externalId, LISTING) };
}

function trl(requirements) {
  const fake = fakeDb(requirements);
  const code = ['normaliseBrandName', 'parseTrlListedDate', 'classifyTrlContact', 'promoteTrlToCrmRequirement', 'refreshTrlListing'].map(n => fn('server/trl.ts', n)).join('\n');
  const mod = evaluate(`${code}\nexports.promote = promoteTrlToCrmRequirement;\nexports.refresh = refreshTrlListing;`, { db: fake.db, ...TABLES, ...drizzle, listingTarget, importMayLabel, requirementListingUpdates });
  return { ...fake, promote: (externalId = 'ext-1') => mod.promote(externalId, LISTING), refresh: (externalId = 'ext-1') => mod.refresh(externalId, LISTING) };
}

test('PIPnet: a brand whose old requirement is Past comes back as a market listing of its own', async () => {
  const p = pipnet([row('old', { status: 'Past', origin: null, sources: null })]);
  assert.equal(await p.promote(), true);
  const [created, ...rest] = requirementWrites(p.writes);
  assert.equal(rest.length, 0, 'the Past row is not touched');
  assert.equal(created.op, 'insert');
  assert.deepEqual(plain(created.v.sources), ['PIPnet']);
  assert.equal(created.v.origin, 'pipnet');
  assert.equal(created.v.externalRequirementId, 'ext-1');
  assert.deepEqual(p.reads.find(r => r.table === 'crm_requirements_leasing').orderBy, { desc: 'crm_requirements_leasing.createdAt' });
});

test('PIPnet: the open row carrying the listing\'s link is the one refreshed, not a newer row of the same name', async () => {
  const p = pipnet([row('newer', { origin: 'bgp', sources: null }), row('linked', { name: 'Pret A Manger Ltd', externalRequirementId: 'ext-1', lastListedAt: new Date('2026-09-01T00:00:00Z') })]);
  assert.equal(await p.promote(), false);
  const writes = requirementWrites(p.writes);
  assert.deepEqual(writes.map(w => [w.op, w.id]), [['update', 'linked']]);
  assert.deepEqual(writes[0].v.lastListedAt, new Date('2026-11-01T00:00:00Z'));
  assert.ok(p.writes.some(w => w.table === 'external_requirements' && w.v.status === 'converted'));
});

test('PIPnet: a row a person closed stays closed when its listing is seen again', async () => {
  const p = pipnet([row('closed', { status: 'Archived', externalRequirementId: 'ext-1' })]);
  assert.equal(await p.promote(), false);
  assert.deepEqual(requirementWrites(p.writes), []);
});

test('PIPnet: an older row with no origin and no PIPnet label is linked and dated, never labelled', async () => {
  const p = pipnet([row('older', { origin: null, sources: null })]);
  assert.equal(await p.promote(), false);
  const [update] = requirementWrites(p.writes);
  assert.equal(update.id, 'older');
  assert.ok(!('sources' in update.v), 'labelled PIPnet, a hand-made row would reach client logins');
  assert.equal(update.v.externalRequirementId, 'ext-1');
  const own = pipnet([row('own', { origin: 'bgp', sources: ['Monday'] })]);
  await own.promote();
  assert.ok(!('sources' in requirementWrites(own.writes)[0].v));
});

test('TRL: the same rules on promote, and a converted listing with no row holding it is made a row', async () => {
  const fresh = trl([row('old', { status: 'Past', origin: null, sources: ['TRL'] })]);
  assert.equal(await fresh.promote(), true);
  const [created] = requirementWrites(fresh.writes);
  assert.equal(created.op, 'insert');
  assert.deepEqual(plain(created.v.sources), ['TRL']);
  const older = trl([row('older', { origin: null, sources: null })]);
  assert.equal(await older.promote(), false);
  assert.ok(!('sources' in requirementWrites(older.writes)[0].v));

  // refreshTrlListing answers false when no row holds the listing; the import then promotes it.
  assert.equal(await trl([row('old', { status: 'Past' })]).refresh(), false);
  const closed = trl([row('closed', { status: 'Past', externalRequirementId: 'ext-1' })]);
  assert.equal(await closed.refresh(), true);
  assert.deepEqual(closed.writes, []);
  const linked = trl([row('named'), row('linked', { externalRequirementId: 'ext-1' })]);
  assert.equal(await linked.refresh(), true);
  assert.deepEqual(requirementWrites(linked.writes).map(w => [w.op, w.id]), [['update', 'linked']]);
  assert.match(source('server/trl.ts'), /if \(!\(await refreshTrlListing\(externalId, record\)\)\) await promoteTrlToCrmRequirement\(externalId, record\);/);
});

// PIPnet's flyers into the tenant rep CRM (19 November 2026). Woody: "All
// agents who put up a flyer should be added to our tenant rep agent CRM".
// The import matched agent firms by exact name ("CBRE" and "CBRE Ltd" became
// two companies), made no tenant rep link, and skipped the agents on listings
// that name no client. The real promote step runs here against a small
// stand-in for drizzle; the link's own door is checked in the source.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { listingTarget, importMayLabel, requirementListingUpdates } = await import('../../shared/requirement-live.ts');
const pipnetAgents = await import('../../shared/pipnet-agents.ts');
const require = createRequire(import.meta.url);
const { find, evaluate, ts, source } = require('./source-harness.cjs');

const fn = (file, name) => find(file, n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const table = (name, cols) => Object.fromEntries([['_table', name], ...cols.map(c => [c, `${name}.${c}`])]);
const TABLES = {
  crmRequirementsLeasing: table('crm_requirements_leasing', ['id', 'createdAt', 'externalRequirementId']),
  crmCompanies: table('crm_companies', ['id', 'name', 'companyType', 'createdAt', 'mergedIntoId']),
  crmContacts: table('crm_contacts', ['id', 'name', 'companyId', 'email']),
  externalRequirements: table('external_requirements', ['id']),
};
const drizzle = { eq: (col, val) => ({ eq: [col, val] }), and: (...all) => ({ and: all }), isNull: col => ({ isNull: col }), desc: col => ({ desc: col }), ilike: (col, val) => ({ ilike: [col, val] }) };
const field = col => col.split('.')[1];
const holds = (row, cond) => {
  if (!cond) return true;
  if (cond.and) return cond.and.every(c => holds(row, c));
  if (cond.eq) return row[field(cond.eq[0])] === cond.eq[1];
  if (cond.isNull) return row[field(cond.isNull)] == null;
  if (cond.ilike) return String(row[field(cond.ilike[0])] || '').toLowerCase().includes(cond.ilike[1].replace(/%/g, '').toLowerCase());
  return true;
};

function fakeDb(rows) {
  const writes = [];
  const store = { crm_companies: rows.companies || [], crm_contacts: rows.contacts || [], crm_requirements_leasing: [], external_requirements: [] };
  const read = t => {
    let cond = null;
    const q = { where: c => { cond = c; return q; }, limit: () => q, orderBy: () => q,
      then: (ok, ko) => Promise.resolve(store[t._table].filter(r => holds(r, cond))).then(ok, ko) };
    return q;
  };
  const tx = {
    select: () => ({ from: read }),
    insert: t => ({ values: v => {
      const id = `new-${writes.length + 1}`;
      writes.push({ op: 'insert', table: t._table, v, id });
      store[t._table].push({ id, ...v });
      const done = Promise.resolve([{ id }]);
      return { returning: () => done, then: (ok, ko) => done.then(ok, ko) };
    } }),
    update: t => ({ set: v => ({ where: cond => { writes.push({ op: 'update', table: t._table, v, id: cond.eq[1] }); return Promise.resolve(); } }) }),
  };
  return { db: { ...tx, transaction: work => work(tx) }, writes };
}
const plain = v => JSON.parse(JSON.stringify(v));

const LISTING = (rawData = {}) => ({ companyName: 'Pret A Manger', contactName: 'Jo Smith', contactEmail: 'jo.smith@cbre.com', contactPhone: '020 7000 0000',
  useClass: 'A3', sizeRange: '1,000-1,500 sq ft', locations: null, tenure: null, description: null, lastUpdated: '01/11/2026',
  rawData: { _agentCompany: 'CBRE Ltd', _mobile: '07700 900000', _detail: { requirementId: 'R1' }, ...rawData } });

function promote(rows, listing = LISTING()) {
  const fake = fakeDb(rows);
  const reps = [];
  const code = ['normaliseBrandName', 'parseUkDate', 'mapPlanningClassToBgpUse', 'promoteToCrmRequirement', 'upsertPipnetAgent'].map(n => fn('server/pipnet.ts', n)).join('\n');
  const mod = evaluate(`${code}\nexports.promote = promoteToCrmRequirement;`, { db: fake.db, ...TABLES, ...drizzle, listingTarget, importMayLabel, requirementListingUpdates,
    ...pipnetAgents, recordPipnetTenantRep: async input => { reps.push(input); return input.brandId && input.firmId && input.brandId !== input.firmId ? 'made' : 'skipped'; } });
  return mod.promote('ext-1', listing).then(() => ({ ...fake, reps }));
}
const brand = { id: 'pret', name: 'Pret A Manger', companyType: 'Tenant - F&B', mergedIntoId: null };

test('"CBRE Ltd" on a flyer is the CRM\'s CBRE: no second firm, the agent filed under it, marked From PIPnet', async () => {
  const { writes, reps } = await promote({ companies: [brand, { id: 'cbre', name: 'CBRE', companyType: 'Agent', mergedIntoId: null, createdAt: '2025-01-01' }] });
  assert.equal(writes.filter(w => w.table === 'crm_companies' && w.op === 'insert').length, 0, 'no new company');
  const contact = writes.find(w => w.table === 'crm_contacts' && w.op === 'insert');
  assert.ok(contact, 'the agent is added');
  assert.equal(contact.v.companyId, 'cbre');
  assert.equal(contact.v.enrichmentSource, 'pipnet');
  assert.equal(contact.v.contactType, 'Agent');
  assert.equal(contact.v.notes, "Added from PIPnet — the agent on Pret A Manger's requirement, listed 2026-11-01");
  assert.deepEqual(plain(reps), [{ brandId: 'pret', firmId: 'cbre', contactId: contact.id, brand: 'Pret A Manger', listedOn: '2026-11-01', ref: 'R1' }]);
  const marked = writes.filter(w => w.table === 'external_requirements' && w.v.rawData);
  assert.equal(marked.length, 1, 'the listing is marked as linked');
  assert.ok(marked[0].v.rawData._tenantRepAt);
  assert.equal(marked[0].v.rawData._agentCompany, 'CBRE Ltd', 'the rest of the listing is kept');
});

test('a listing links its agent once: a link a person deleted is not put back by the same flyer', async () => {
  const { reps, writes } = await promote({ companies: [brand, { id: 'cbre', name: 'CBRE', companyType: 'Agent', mergedIntoId: null }] },
    LISTING({ _tenantRepAt: '2026-11-19T06:00:00.000Z' }));
  assert.equal(reps.length, 0);
  assert.ok(!writes.some(w => w.table === 'external_requirements' && w.v.rawData));
  // The import carries the marker over when it reads the listing again.
  assert.match(fn('server/pipnet.ts', 'importPipnetRow'), /_tenantRepAt: stored\?\._tenantRepAt \|\| null,/);
});

test('a firm only a brand or landlord shares the name of is made new, as an agent firm marked From PIPnet', async () => {
  const { writes, reps } = await promote({ companies: [brand, { id: 'shop', name: 'CBRE', companyType: 'Tenant - Retail', mergedIntoId: null }] });
  const made = writes.find(w => w.table === 'crm_companies' && w.op === 'insert');
  assert.equal(made.v.name, 'CBRE Ltd');
  assert.equal(made.v.companyType, 'Agent');
  assert.equal(made.v.enrichmentSource, 'pipnet');
  assert.equal(reps[0].firmId, made.id);
  assert.ok(!writes.some(w => w.table === 'crm_companies' && w.op === 'update' && w.id === 'shop'), 'the brand is not retyped');
});

test('a company recorded as nothing is taken and recorded as an agent firm, as before; a merged one is not', async () => {
  const { writes } = await promote({ companies: [brand, { id: 'gone', name: 'CBRE', companyType: 'Agent', mergedIntoId: 'cbre2' }, { id: 'plain', name: 'C.B.R.E.', companyType: null, mergedIntoId: null }] });
  // The search narrows by "cbre", which "C.B.R.E." does not contain as typed: a new firm is made.
  assert.ok(writes.some(w => w.table === 'crm_companies' && w.op === 'insert'));
  const typed = await promote({ companies: [brand, { id: 'plain', name: 'CBRE', companyType: '', mergedIntoId: null }] });
  assert.ok(typed.writes.some(w => w.table === 'crm_companies' && w.op === 'update' && w.id === 'plain' && w.v.companyType === 'Agent'));
  assert.ok(!typed.writes.some(w => w.table === 'crm_companies' && w.op === 'insert'));
});

test('the agent already at the firm is found by email and only gains what it lacks', async () => {
  const { writes, reps } = await promote({
    companies: [brand, { id: 'cbre', name: 'CBRE', companyType: 'Agent', mergedIntoId: null }],
    contacts: [{ id: 'jo', name: 'Joanna Smith', companyId: 'cbre', email: 'Jo.Smith@cbre.com', phone: null, phoneMobile: '07000 000000' }],
  });
  assert.ok(!writes.some(w => w.table === 'crm_contacts' && w.op === 'insert'), 'no second contact');
  const update = writes.find(w => w.table === 'crm_contacts' && w.op === 'update');
  assert.deepEqual(plain(update.v), { phone: '020 7000 0000' });
  assert.equal(reps[0].contactId, 'jo');
});

test('a brand listing for itself is not made an agent firm, and makes no tenant rep link of its own', async () => {
  const { writes, reps } = await promote({ companies: [brand] }, LISTING({ _agentCompany: 'Pret A Manger Ltd' }));
  assert.ok(!writes.some(w => w.table === 'crm_companies'), 'the brand is not retyped and no firm is made');
  assert.equal(writes.find(w => w.table === 'crm_contacts' && w.op === 'insert').v.companyId, 'pret');
  assert.equal(reps[0].brandId, reps[0].firmId, 'the link step is handed the brand as its own firm, which it skips');
  const record = fn('server/pipnet.ts', 'recordPipnetTenantRep');
  assert.match(record, /if \(!input\.brandId \|\| !input\.firmId \|\| input\.brandId === input\.firmId\) return "skipped";/);
  assert.ok(!writes.some(w => w.table === 'external_requirements' && w.v.rawData), 'a skipped link does not mark the listing');
});

test('the tenant rep link goes through its own door after the listing commits, once per brand and firm', () => {
  const promoteSrc = fn('server/pipnet.ts', 'promoteToCrmRequirement');
  const tx = promoteSrc.indexOf('const created = await db.transaction(');
  const link = promoteSrc.indexOf('await recordPipnetTenantRep(');
  assert.ok(tx > 0 && link > tx && promoteSrc.lastIndexOf('return created;') > link, 'the link is made after the transaction');
  const record = fn('server/pipnet.ts', 'recordPipnetTenantRep');
  assert.match(record, /agent_type = 'tenant_rep' LIMIT 1/, 'a link a person ended is not made again');
  assert.doesNotMatch(record, /end_date IS NULL/);
  assert.match(record, /createBrandRepresentation\(pool, \{[\s\S]*agentType: "tenant_rep"/);
  assert.doesNotMatch(record, /INSERT INTO brand_agent_representations/);
});

test('a listing that names no client keeps its agent, and nothing else', () => {
  const loop = fn('server/pipnet.ts', 'importPipnetRow');
  assert.doesNotMatch(loop, /companyName === "\[No Client Quoted\]"\) (continue|return)/);
  const at = loop.indexOf('if (companyName === "[No Client Quoted]") {');
  assert.ok(at > 0);
  const block = loop.slice(at, loop.indexOf('\n  }\n', at));
  assert.match(block, /upsertPipnetAgent\(tx, \{/);
  assert.match(block, /brand: null/);
  assert.match(block, /return \{ \.\.\.outcome, status: "agent_only" \};/);
  assert.doesNotMatch(block, /externalRequirements|promoteToCrmRequirement|downloadBrochureAsPdf|parseRequirementBrochure|recordPipnetTenantRep/);
  assert.ok(loop.indexOf('if (parsedDate && parsedDate < ctx.cutoff)') < at, 'an old anonymous listing is skipped as any old listing is');
});

test('the import still never confirms a requirement', () => {
  const text = source('server/pipnet.ts');
  assert.doesNotMatch(text, /lastConfirmedAt|last_confirmed_at|bgpCreatedStamp/);
});

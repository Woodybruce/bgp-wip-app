import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { insertUnitOfferSchema } from '../../shared/schema.ts';
import { viewingMissingDetails } from '../../shared/viewing-workflow.ts';
import { calendarDateValue } from '../../shared/calendar-date.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');
const functionSource = name => find('server/chatbgp.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const sourceFile = ts.createSourceFile('server/chatbgp.ts', source('server/chatbgp.ts'), ts.ScriptTarget.Latest, true);
function loggingBranches(name) {
  const declaration = sourceFile.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  return declaration.body.statements.filter(node => ts.isIfStatement(node) && /^fnName === "log_(viewing|offer)"$/.test(node.expression.getText(sourceFile))).map(node => node.getText(sourceFile)).join('\n');
}
const request = { session: { userId: 'carly' } };
const viewingArgs = { entityType: 'unit', entityId: 'unit', company: 'Brand as typed', contact: 'Contact as typed', viewingDate: '2026-09-16', viewingTime: '10:00' };
const offerArgs = { entityType: 'unit', entityId: 'unit', offerDate: '2026-09-16', rentPa: 45000 };
function harness({ scope = null, unitAllowed = true, brandAllowed = true, scopeError, serviceError, namedBrand = true, agencyEmployer = false, linkedAgent = true, incomplete = false } = {}) {
  const calls = [], writes = [];
  const tables = { unitOffers: 'unit-offers', investmentViewings: 'investment-viewings', investmentOffers: 'investment-offers' };
  const db = { insert(table) { return { values(value) {
    writes.push({ table, value });
    const result = { id: 'saved-offer', ...value };
    return { returning: async () => [result], then(resolve) { return Promise.resolve([result]).then(resolve); } };
  } }; } };
  const pool = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM crm_companies')) return { rows: namedBrand ? [{ id: 'brand', name: 'Verified Brand', company_type: agencyEmployer ? 'Agent' : 'Tenant - Retail' }] : [] };
    if (sql.includes('EXISTS (SELECT 1 FROM brand_agent_representations')) return { rows: linkedAgent ? [{ id: 'agent', name: 'Verified Agent' }] : [] };
    if (sql.includes('FROM crm_contacts')) return { rows: [{ id: 'contact', name: 'Verified Contact', company_id: 'brand' }] };
    assert.fail(`Unexpected SQL ${sql}`);
  } };
  const context = {
    db,
    resolveCompanyScope: async req => { calls.push({ scopeRequest: req }); if (scopeError) throw new Error('Scope unavailable'); return scope; },
    isPropertyInScope: async (client, property) => { calls.push({ client, property }); return unitAllowed; },
    async summaryHelper() { return 'Investment action recorded'; },
    require(name) {
      if (name === './db') return { db, pool };
      if (name === '@shared/schema') return { ...tables, insertUnitOfferSchema };
      if (name === '../shared/calendar-date') return { calendarDateValue };
      if (name === '../shared/viewing-workflow') return { viewingMissingDetails };
      if (name === './company-scope') return { isClientVisibleBrand: async () => brandAllowed };
      if (name === './storage') return { storage: { async getAvailableUnit(id) { calls.push({ unitId: id }); return { id, propertyId: 'property' }; } } };
      if (name === './leasing-viewings') return {
        async createTrackerViewing(req, unitId, values) {
          calls.push({ createViewing: { req, unitId, values } });
          if (serviceError) throw Object.assign(new Error('Unit outside your portfolio'), { status: 403 });
          return { id: 'viewing', unitId, companyId: incomplete ? null : 'brand', companyName: values.companyName, contactId: null,
            agentContactId: incomplete ? null : 'agent', ownerUserId: 'carly', viewingDate: values.viewingDate, viewingTime: values.viewingTime,
            status: values.status || 'scheduled', detailsConfirmedAt: incomplete ? null : new Date() };
        },
        async createTrackerOffer(req, unitId, values) {
          calls.push({ createOffer: { req, unitId, values } });
          if (serviceError) throw Object.assign(new Error('Viewing outside your portfolio'), { status: 403 });
          const identity = values.viewingId ? { companyId: 'linked-brand', companyName: 'Viewing Brand', contactId: 'linked-agent', contactName: 'Viewing Agent' } : {};
          const value = { ...values, ...identity, unitId, confirmedAt: new Date() };
          writes.push({ table: tables.unitOffers, value });
          return { id: 'saved-offer', ...value };
        },
      };
      throw new Error(`Unexpected import ${name}; tests must not contact an AI provider`);
    },
  };
  const module = evaluate(`${functionSource('executeLeasingActivity')}
    exports.raw = async function(fnName,fnArgs,req) { ${loggingBranches('executeCrmToolRaw')} };
    exports.legacy = async function(fnName,fnArgs,req) { ${loggingBranches('handleCrmToolCall')} };
  `, context);
  return { ...module, calls, writes };
}

test('both ChatBGP viewing executors use the shared scoped service with explicit IDs, status and follow-up', async () => {
  for (const path of ['raw', 'legacy']) {
    const h = harness();
    const args = { ...viewingArgs, companyId: 'brand', agentContactId: 'agent', ownerUserId: 'carly', requirementId: 'requirement', status: 'completed', outcome: 'Interested', nextAction: 'Send particulars', followUpDate: '2026-09-18' };
    await h[path]('log_viewing', args, request);
    const call = h.calls.find(call => call.createViewing).createViewing;
    assert.equal(call.req, request);
    assert.equal(call.unitId, 'unit');
    for (const key of ['companyId', 'agentContactId', 'ownerUserId', 'requirementId', 'status', 'outcome', 'nextAction', 'followUpDate']) assert.equal(call.values[key], args[key]);
    assert.equal(call.values.companyName, args.company);
    assert.equal(call.values.contactName, args.contact);
    assert.equal(h.writes.length, 0, 'no direct unit_viewings insert remains');
  }
});

test('names-only ChatBGP viewings are reported as needing details and do not fabricate CRM IDs', async () => {
  for (const path of ['raw', 'legacy']) {
    const h = harness({ incomplete: true });
    const result = await h[path]('log_viewing', viewingArgs, request);
    const values = h.calls.find(call => call.createViewing).createViewing.values;
    assert.equal(values.companyId, undefined);
    assert.equal(values.contactId, undefined);
    assert.equal(values.agentContactId, undefined);
    if (path === 'raw') {
      assert.equal(result.data.needsDetails, true);
      assert.ok(result.data.missingDetails.includes('Confirm the brand'));
    } else assert.match(result.response.reply, /Still needed:.*Confirm the brand/);
  }
});

test('logging leasing activity needs authenticated request context in both executors', async () => {
  for (const path of ['raw', 'legacy']) for (const name of ['log_viewing', 'log_offer']) {
    const h = harness();
    const result = await h[path](name, name === 'log_viewing' ? viewingArgs : offerArgs, {});
    assert.match(path === 'raw' ? result.data.error : result.response.reply, /Sign in/);
    assert.equal(h.calls.length, 0);
    assert.equal(h.writes.length, 0);
  }
  const h = harness();
  await h.raw('log_viewing', viewingArgs, { tokenUserId: 'carly' });
  assert.equal(h.calls[0].createViewing.req.tokenUserId, 'carly');
});

test('service permission denials propagate without any unscoped fallback or direct write', async () => {
  for (const path of ['raw', 'legacy']) {
    const h = harness({ serviceError: true });
    await assert.rejects(h[path]('log_viewing', viewingArgs, request), /outside your portfolio/);
    await assert.rejects(h[path]('log_offer', { ...offerArgs, viewingId: 'other-viewing' }, request), /outside your portfolio/);
    assert.equal(h.writes.length, 0);
  }
});

test('a linked ChatBGP offer takes authoritative brand/contact from its viewing in both executors', async () => {
  for (const path of ['raw', 'legacy']) {
    const h = harness();
    await h[path]('log_offer', { ...offerArgs, viewingId: 'viewing', companyId: 'agency', contactId: 'wrong', company: 'Wrong', contact: 'Wrong' }, request);
    const atomicCall = h.calls.find(call => call.createOffer).createOffer;
    assert.equal(atomicCall.req, request);
    assert.equal(atomicCall.values.viewingId, 'viewing');
    assert.equal(atomicCall.values.companyId, undefined, 'identity is resolved by the atomic writer, not a stale pre-read');
    const saved = h.writes[0].value;
    assert.equal(saved.viewingId, 'viewing'); assert.equal(saved.unitId, 'unit');
    assert.equal(saved.companyId, 'linked-brand'); assert.equal(saved.companyName, 'Viewing Brand');
    assert.equal(saved.contactId, 'linked-agent'); assert.equal(saved.contactName, 'Viewing Agent');
    assert.ok(saved.confirmedAt instanceof Date);
  }
});

test('unlinked offers keep free-text names without inventing a brand or claiming conversion linkage', async () => {
  for (const path of ['raw', 'legacy']) {
    const h = harness();
    const result = await h[path]('log_offer', { ...offerArgs, company: 'Savills', contact: 'Named agent' }, request);
    assert.equal(h.writes[0].value.companyId, null);
    assert.equal(h.writes[0].value.contactId, null);
    assert.equal(h.writes[0].value.companyName, 'Savills');
    if (path === 'raw') assert.equal(result.data.needsDetails, true);
    else assert.match(result.response.reply, /Link the offering brand/);
  }
});

test('unit, brand and scope lookup failures fail closed for ChatBGP offers', async () => {
  for (const options of [{ scope: 'client', unitAllowed: false }, { scope: 'client', brandAllowed: false }, { agencyEmployer: true }, { namedBrand: false }]) {
    const h = harness(options);
    const result = await h.raw('log_offer', { ...offerArgs, companyId: 'brand' }, request);
    assert.equal(result.data.success, false);
    assert.equal(h.writes.length, 0);
  }
  const h = harness({ scopeError: true });
  await assert.rejects(h.raw('log_offer', offerArgs, request), /Scope unavailable/);
  assert.equal(h.writes.length, 0);
});

test('agent offers require the brand first and an explicit current agent relationship', async () => {
  const missingBrand = harness();
  assert.equal((await missingBrand.raw('log_offer', { ...offerArgs, agentContactId: 'agent' }, request)).data.success, false);
  const missingLink = harness({ linkedAgent: false });
  assert.equal((await missingLink.raw('log_offer', { ...offerArgs, companyId: 'brand', agentContactId: 'agent' }, request)).data.success, false);
  const linked = harness();
  await linked.raw('log_offer', { ...offerArgs, companyId: 'brand', agentContactId: 'agent' }, request);
  assert.equal(linked.writes[0].value.companyId, 'brand');
  assert.equal(linked.writes[0].value.contactId, 'agent');
  const sql = linked.calls.find(call => call.sql?.includes('EXISTS (SELECT 1 FROM brand_agent_representations')).sql;
  assert.match(sql, /ar\.end_date IS NULL/);
  assert.match(sql, /IN \('','active'\)/);
});

test('invalid offer dates and figures are rejected before a database write', async () => {
  for (const change of [{ offerDate: '2026-02-30' }, { offerDate: 'tomorrow' }, { rentPa: '45000' }]) {
    const h = harness();
    const result = await h.raw('log_offer', { ...offerArgs, ...change }, request);
    assert.equal(result.data.success, false);
    assert.equal(h.writes.length, 0);
  }
});

test('investment viewing and offer branches retain their original payloads and avoid leasing services', async () => {
  for (const path of ['raw', 'legacy']) for (const name of ['log_viewing', 'log_offer']) {
    const h = harness();
    await h[path](name, { entityType: 'investment', entityId: 'investment', company: 'Investor', contact: 'Investment Contact', viewingDate: '2026-09-16', offerDate: '2026-09-16', offerPrice: 5000000, outcome: 'Old investment outcome' }, request);
    assert.equal(h.calls.length, 0);
    assert.equal(h.writes[0].value.trackerId, 'investment');
    assert.equal(h.writes[0].value.company, 'Investor');
    if (name === 'log_viewing') assert.equal(h.writes[0].value.outcome, 'Old investment outcome');
    else assert.equal(h.writes[0].value.offerPrice, 5000000);
  }
});

test('tool definitions expose the IDs needed for viewing links and explicitly distinguish brands from agents', () => {
  const tools = [];
  for (const name of ['log_viewing', 'log_offer']) {
    const snippet = find('server/chatbgp.ts', node => ts.isCallExpression(node) && node.expression.getText(sourceFile) === 'tools.push' && node.arguments[0]?.getText(sourceFile).includes(`name: "${name}"`));
    evaluate(snippet, { tools });
  }
  const viewing = tools.find(tool => tool.function.name === 'log_viewing').function;
  for (const key of ['companyId', 'contactId', 'agentContactId', 'ownerUserId', 'requirementId', 'status', 'nextAction', 'followUpDate']) assert.ok(viewing.parameters.properties[key]);
  assert.match(viewing.description, /never an agent's employer/);
  const offer = tools.find(tool => tool.function.name === 'log_offer').function;
  assert.ok(offer.parameters.properties.viewingId);
  assert.match(offer.description, /explicitly asks to log/);
});

const assert = require('node:assert/strict');
const test = require('node:test');
const { source, route, evaluate } = require('./source-harness.cjs');

const brand = { id: 'brand', name: 'Example Brand', company_type: 'Brand' };
const agency = { id: 'agency', name: 'Example Agency' };
const parent = { id: 'parent', name: 'Example Group' };
const person = (changes = {}) => ({
  name: 'Alice Morris', email: 'alice@exampleagency.test', linkedin_url: 'https://www.linkedin.com/in/alice-morris/',
  current_employer: agency.name, role: 'Partner', source: 'direct', previous_employers: [], ...changes,
});

function rocketHarness({ companies = [brand, agency, parent], contacts = [], failInsert = false } = {}) {
  const handlers = new Map();
  const calls = [];
  const writes = [];
  let released = false;
  const stored = contacts.map(contact => ({ ...contact }));
  const pool = {
    async query(sql) {
      assert.match(sql, /FROM crm_companies WHERE id = \$1/);
      return { rows: [brand] };
    },
    async connect() {
      return {
        async query(sql, values) {
          calls.push(sql);
          if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
          if (sql.includes('FROM crm_companies')) return { rows: companies };
          if (sql.includes('FROM crm_contacts')) return { rows: [...stored] };
          assert.match(sql, /INSERT INTO crm_contacts/);
          if (failInsert) throw new Error('Synthetic insert failure');
          writes.push(values);
          const row = { id: `new-${writes.length}`, name: values[0], email: values[2], linkedin_url: values[5], company_id: values[8], company_name: values[9] };
          stored.push(row);
          return { rows: [row] };
        },
        release() { released = true; },
      };
    },
  };
  evaluate(source('server/rocketreach-contacts.ts'), {
    URL, process: { env: {} },
    fetch() { assert.fail('Import tests must never contact a provider'); },
    require(name) {
      if (name === 'express') return { Router: () => ({ post: (path, ...chain) => handlers.set(path, chain.at(-1)) }) };
      if (name === './auth') return { requireAuth() {} };
      if (name === './db') return { pool };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return {
    calls, writes, stored,
    get released() { return released; },
    async invoke(people) {
      let status = 200;
      let data;
      await handlers.get('/api/brand/:companyId/rocketreach/import')(
        { params: { companyId: brand.id }, body: { people, enrich: false } },
        { status(code) { status = code; return this; }, json(value) { data = value; } },
      );
      return { status, data };
    },
  };
}

test('RocketReach puts a new agent under the confirmed agency and preserves brand only as source context', async () => {
  const h = rocketHarness();
  const { status, data } = await h.invoke([person()]);
  assert.equal(status, 200);
  assert.equal(data.inserted, 1);
  assert.equal(data.insertedHere, 0);
  assert.equal(data.insertedElsewhere, 1);
  assert.equal(h.writes[0][8], agency.id);
  assert.equal(h.writes[0][9], agency.name);
  assert.match(h.writes[0][7], /Discovered from the Example Brand profile/);
  assert.equal(data.results[0].companyId, agency.id);
  assert.equal(h.calls.at(-1), 'COMMIT');
  assert.equal(h.released, true);
});

test('direct employees still import at the brand, without substring employer matching', async () => {
  const h = rocketHarness();
  const { data } = await h.invoke([
    person({ current_employer: 'EXAMPLE-BRAND', email: 'alice@examplebrand.test' }),
    person({ name: 'Beatrice Hall', current_employer: 'Example Brand Other', email: 'beatrice@other.test', linkedin_url: null }),
  ]);
  assert.equal(data.insertedHere, 1);
  assert.equal(data.skipped, 1);
  assert.equal(h.writes[0][8], brand.id);
  assert.match(data.results[1].reason, /no matching CRM company/);
});

test('parent-group results attach to their employer instead of the child brand', async () => {
  const h = rocketHarness();
  const { data } = await h.invoke([person({ current_employer: parent.name, source: 'parent_group', source_company_name: parent.name })]);
  assert.equal(data.insertedElsewhere, 1);
  assert.equal(h.writes[0][8], parent.id);
  assert.equal(h.writes[0][1], 'Partner');
  assert.match(h.writes[0][7], /Parent-group search: Example Group/);
});

test('missing, unknown and ambiguous employer evidence is reported and never stamped onto the browsed brand', async () => {
  for (const employer of [null, '', 'Unknown Agency', agency.name]) {
    const companies = employer === agency.name ? [brand, agency, { id: 'duplicate-agency', name: agency.name }] : [brand, agency];
    const h = rocketHarness({ companies });
    const { data } = await h.invoke([person({ current_employer: employer })]);
    assert.equal(data.skipped, 1);
    assert.equal(data.inserted, 0);
    assert.equal(h.writes.length, 0);
    assert.ok(data.results[0].reason);
  }
});

test('legal-suffix aliases are not guessed when CRM contains similar company names', async () => {
  const h = rocketHarness({ companies: [brand, { id: 'limited', name: 'Example Agency Ltd' }, { id: 'llp', name: 'Example Agency LLP' }] });
  const { data } = await h.invoke([person({ current_employer: 'Example Agency' })]);
  assert.equal(data.skipped, 1);
  assert.equal(data.inserted, 0);
  assert.match(data.results[0].reason, /no matching CRM company/);
});

test('provider alternative emails find an existing contact and conflicting alternative identities are reported', async () => {
  const h = rocketHarness({ contacts: [{ id: 'personal-email', name: 'Alice Morris', email: 'alice@personal.test', company_id: agency.id }] });
  const { data } = await h.invoke([person({ personal_email: 'alice@personal.test', linkedin_url: null })]);
  assert.equal(data.existing, 1);
  assert.equal(data.results[0].contactId, 'personal-email');
  assert.equal(h.writes.length, 0);
  const conflict = rocketHarness({ contacts: [
    { id: 'personal-email', name: 'Alice Morris', email: 'alice@personal.test' },
    { id: 'work-email', name: 'Alice Morris', email: person().email },
  ] });
  const conflictResult = await conflict.invoke([person({ personal_email: 'alice@personal.test' })]);
  assert.equal(conflictResult.data.skipped, 1);
  assert.equal(conflict.writes.length, 0);
});

test('a corrected contact anywhere in CRM is reused without changing their employer', async () => {
  const h = rocketHarness({ contacts: [{ id: 'corrected', name: 'Alice Morris', email: ' ALICE@EXAMPLEAGENCY.TEST ', company_id: agency.id, company_name: agency.name }] });
  const { data } = await h.invoke([person({ current_employer: brand.name })]);
  assert.equal(data.existing, 1);
  assert.equal(data.inserted, 0);
  assert.equal(data.results[0].contactId, 'corrected');
  assert.equal(data.results[0].companyId, agency.id);
  assert.match(data.results[0].reason, /left unchanged for review/);
  assert.equal(h.writes.length, 0);
  assert.equal(h.stored[0].company_id, agency.id);
});

test('LinkedIn identity normalizes host, scheme, query, fragment, case and trailing slash', async () => {
  const h = rocketHarness({ contacts: [{ id: 'corrected', name: 'Alice Morris', email: 'old-address@agency.test', linkedin_url: 'http://uk.linkedin.com/in/ALICE-MORRIS?trk=public#bio', company_id: agency.id }] });
  const { data } = await h.invoke([person()]);
  assert.equal(data.existing, 1);
  assert.equal(data.results[0].contactId, 'corrected');
  assert.equal(h.writes.length, 0);
});

test('contradictory existing identities are skipped, not merged or duplicated', async () => {
  const variants = [
    [{ id: 'email-person', name: 'Alice Morris', email: person().email }, { id: 'linkedin-person', name: 'Alice Morris', linkedin_url: person().linkedin_url }],
    [{ id: 'other-person', name: 'Alice Morris', email: person().email, linkedin_url: 'https://linkedin.com/in/another-person' }],
    [{ id: 'recycled-email', name: 'Other Person', email: person().email }],
  ];
  for (const contacts of variants) {
    const h = rocketHarness({ contacts });
    const { data } = await h.invoke([person()]);
    assert.equal(data.skipped, 1);
    assert.equal(data.existing, 0);
    assert.equal(h.writes.length, 0);
  }
});

test('names alone and shared mailboxes cannot establish person identity', async () => {
  for (const email of [null, 'info@exampleagency.test', 'not-an-email']) {
    const h = rocketHarness({ contacts: [{ id: 'same-name', name: 'Alice Morris' }] });
    const { data } = await h.invoke([person({ email, linkedin_url: null })]);
    assert.equal(data.skipped, 1);
    assert.equal(data.inserted, 0);
    assert.equal(data.existing, 0);
  }
});

test('the same incoming person appears only once even across duplicate provider results', async () => {
  const h = rocketHarness();
  const { data } = await h.invoke([person(), person()]);
  assert.equal(data.inserted, 1);
  assert.equal(data.existing, 1);
  assert.equal(h.writes.length, 1);
});

test('database failures roll back and release the checked-out connection', async () => {
  const h = rocketHarness({ failInsert: true });
  const { status } = await h.invoke([person()]);
  assert.equal(status, 500);
  assert.equal(h.calls.at(-1), 'ROLLBACK');
  assert.equal(h.released, true);
});

function outlookHarness(existingContactId = null) {
  let handler;
  const calls = [];
  evaluate(route('server/interactions.ts', 'post', '/api/interactions/log'), {
    requireAuth() {},
    app: { post: (_path, ...chain) => { handler = chain.at(-1); } },
    pool: {
      async query(sql, values) {
        calls.push({ sql, values });
        if (/SELECT id FROM crm_contacts/.test(sql)) return { rows: existingContactId ? [{ id: existingContactId }] : [] };
        if (/INSERT INTO crm_contacts/.test(sql)) return { rows: [{ id: 'new-sender' }] };
        if (/INSERT INTO crm_interactions/.test(sql)) return { rows: [{ id: 'filed-interaction' }] };
        assert.fail(`Unexpected query ${sql}`);
      },
    },
  });
  return {
    calls,
    async invoke(body = {}) {
      let status = 200;
      let data;
      await handler({ body: { companyId: brand.id, senderName: 'Alice Morris', senderEmail: person().email, ...body }, user: { name: 'Test Staff' } },
        { status(code) { status = code; return this; }, json(value) { data = value; } });
      return { status, data };
    },
  };
}

test('Outlook filing preserves the brand on the interaction without inventing sender employment', async () => {
  const h = outlookHarness();
  const { status, data } = await h.invoke();
  assert.equal(status, 200);
  assert.equal(data.contactCreated, true);
  const contactInsert = h.calls.find(call => /INSERT INTO crm_contacts/.test(call.sql));
  assert.match(contactInsert.sql, /VALUES \(\$1, \$2, NULL, NULL,/);
  assert.equal(contactInsert.values.length, 2);
  const interactionInsert = h.calls.find(call => /INSERT INTO crm_interactions/.test(call.sql));
  assert.equal(interactionInsert.values[0], 'new-sender');
  assert.equal(interactionInsert.values[1], brand.id);
});

test('Outlook retains existing exact-email and explicitly picked contact links', async () => {
  for (const picked of [false, true]) {
    const h = outlookHarness(picked ? null : 'known-agent');
    const { data } = await h.invoke(picked ? { contactId: 'picked-agent' } : {});
    assert.equal(data.contactCreated, false);
    assert.equal(h.calls.some(call => /INSERT INTO crm_contacts/.test(call.sql)), false);
    const interactionInsert = h.calls.find(call => /INSERT INTO crm_interactions/.test(call.sql));
    assert.equal(interactionInsert.values[0], picked ? 'picked-agent' : 'known-agent');
    assert.equal(interactionInsert.values[1], brand.id);
  }
});

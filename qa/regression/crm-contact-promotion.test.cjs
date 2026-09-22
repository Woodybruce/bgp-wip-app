const assert = require('node:assert/strict');
const test = require('node:test');
const { route, evaluate } = require('./source-harness.cjs');
const sourceCompany = { id: 'source-brand', name: 'Example Source Brand' };
const request = { email: 'jordan@agency.test', name: 'Jordan Agent', role: 'Partner', phone: '020 0000 0000', mobile: '07000 000000', linkedin: 'https://www.linkedin.com/in/jordan-agent/?trk=fixture' };
function harness({ existing = [], scoped = false, failInsert = false } = {}) {
  let handler;
  const calls = [];
  const writes = [];
  let released = false;
  evaluate(route('server/routes.ts', 'post', '/api/brand/:companyId/promote-sender'), {
    URL, requireAuth() {}, resolveCompanyScope: async () => scoped ? 'client' : null,
    app: { post: (_path, ...chain) => { handler = chain.at(-1); } },
    pool: {
      async query(sql) { calls.push(sql); assert.match(sql, /SELECT id, name FROM crm_companies/); return { rows: [sourceCompany] }; },
      async connect() {
        return {
          async query(sql, values) {
            calls.push(sql);
            if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
            if (sql.includes('FROM crm_contacts')) return { rows: existing };
            assert.match(sql, /INSERT INTO crm_contacts/);
            if (failInsert) throw new Error('Synthetic database failure');
            writes.push({ sql, values });
            return { rows: [{ id: 'created-contact' }] };
          },
          release() { released = true; },
        };
      },
    },
  });
  return { calls, writes, get released() { return released; }, async invoke(body = request) {
    let status = 200;
    let data;
    await handler({ params: { companyId: sourceCompany.id }, body }, { status(code) { status = code; return this; }, json(value) { data = value; } });
    return { status, data };
  } };
}

test('shared-board discovery keeps every submitted contact field without stamping the viewed brand as employer', async () => {
  const h = harness();
  const { status, data } = await h.invoke({ ...request, companyId: 'do-not-trust', companyName: 'Do not trust' });
  assert.equal(status, 200);
  assert.equal(data.created, true);
  assert.equal(data.employerConfirmed, false);
  assert.equal(data.companyId, null);
  assert.equal(data.companyName, null);
  assert.match(h.writes[0].sql, /\$6, NULL, NULL, \$7/);
  assert.deepEqual(Array.from(h.writes[0].values).slice(0, 6), ['Jordan Agent', request.email, 'Partner', request.phone, request.mobile, 'https://linkedin.com/in/jordan-agent']);
  assert.match(h.writes[0].values[6], /Example Source Brand/);
  assert.match(h.writes[0].values[6], /employer unconfirmed/);
  assert.equal(h.calls.at(-1), 'COMMIT');
  assert.equal(h.released, true);
});

test('email-only pending sender gets a usable name and a contact link with employer unconfirmed', async () => {
  const h = harness();
  const { data } = await h.invoke({ email: 'sam.agent@agency.test' });
  assert.equal(data.name, 'Sam Agent');
  assert.equal(data.id, 'created-contact');
  assert.equal(data.employerConfirmed, false);
  assert.equal(h.writes[0].values[1], 'sam.agent@agency.test');
});

test('global corrected agency contact is reused without changing employment or its other fields', async () => {
  const contact = { id: 'corrected', name: 'Jordan Agent', email: request.email.toUpperCase(), linkedin_url: 'http://uk.linkedin.com/in/JORDAN-AGENT/', company_id: 'agency', company_name: 'Actual Agency' };
  const h = harness({ existing: [contact] });
  const { data } = await h.invoke();
  assert.equal(data.created, false);
  assert.equal(data.id, contact.id);
  assert.equal(data.companyId, 'agency');
  assert.equal(data.companyName, 'Actual Agency');
  assert.equal(data.employerConfirmed, true);
  assert.equal(h.writes.length, 0);
});

test('email-only reuse does not confuse a generated display name with the existing verified name', async () => {
  const h = harness({ existing: [{ id: 'existing', name: 'Jordan Longsurname', email: 'jl@agency.test', company_id: 'agency', company_name: 'Agency' }] });
  const { data } = await h.invoke({ email: 'jl@agency.test' });
  assert.equal(data.created, false);
  assert.equal(data.name, 'Jordan Longsurname');
  assert.equal(h.writes.length, 0);
});

test('LinkedIn-only candidates are identified safely without requiring an email', async () => {
  const h = harness();
  const { status, data } = await h.invoke({ name: 'Jordan Agent', linkedin: request.linkedin, phone: request.phone });
  assert.equal(status, 200);
  assert.equal(data.created, true);
  assert.equal(data.email, null);
  assert.equal(h.writes[0].values[5], 'https://linkedin.com/in/jordan-agent');
});

test('identity conflicts return review errors without duplicate insertion or reassignment', async () => {
  for (const existing of [
    [{ id: 'one', name: request.name, email: request.email }, { id: 'two', name: request.name, linkedin_url: request.linkedin }],
    [{ id: 'one', name: request.name, email: request.email, linkedin_url: 'https://linkedin.com/in/different-person' }],
    [{ id: 'one', name: 'Different Person', email: request.email }],
  ]) {
    const h = harness({ existing });
    const { status, data } = await h.invoke();
    assert.equal(status, 409);
    assert.match(data.error, /conflicts/);
    assert.equal(h.writes.length, 0);
    assert.equal(h.calls.at(-1), 'ROLLBACK');
    assert.equal(h.released, true);
  }
});

test('generic mailboxes, name-only contacts and invalid profile URLs do not bypass identity checks', async () => {
  for (const body of [{ name: 'Jordan Agent' }, { email: 'info@agency.test' }, { name: 'Jordan Agent', linkedin: 'https://linkedin.com.evil.test/in/jordan-agent' }]) {
    const h = harness();
    assert.equal((await h.invoke(body)).status, 400);
    assert.equal(h.writes.length, 0);
    assert.equal(h.calls.length, 0);
  }
});

test('client-scoped discovery promotion is blocked before any identity or company lookup', async () => {
  const h = harness({ scoped: true });
  assert.equal((await h.invoke()).status, 403);
  assert.equal(h.calls.length, 0);
});

test('promotion and RocketReach use the same transaction lock, and database errors roll back', async () => {
  const h = harness({ failInsert: true });
  assert.equal((await h.invoke()).status, 500);
  assert.ok(h.calls.some(sql => sql === "SELECT pg_advisory_xact_lock(hashtext('rocketreach-contact-import'))"));
  assert.equal(h.calls.at(-1), 'ROLLBACK');
  assert.equal(h.released, true);
});

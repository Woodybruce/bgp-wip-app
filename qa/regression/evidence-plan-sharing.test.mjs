// Run with: node --import tsx --test qa/regression/evidence-plan-sharing.test.mjs
// Requires initdb/pg_ctl in PATH and a non-root OS user. No .env or live database is used.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createEvidencePlanSharingRouters, ensureEvidencePlanShareSchema } from '../../server/evidence-plan-sharing.ts';
import { createSharingFixture, ids, id, fileKeys } from './evidence-plan-sharing-fixture.mjs';

let fixture;
before(async () => { fixture = await createSharingFixture(createEvidencePlanSharingRouters, ensureEvidencePlanShareSchema); });
beforeEach(async () => { await fixture.reset(); });
after(async () => { await fixture?.cleanup(); });

const management = plan => `/api/evidence-plans/${plan || ids.plan}/share`;
const expected = share => share && !share.revokedAt ? { id: share.id, updatedAt: share.updatedAt } : null;
const currentShare = async () => (await fixture.request(management(), { user: 'staff' })).json.share;
const revoke = async () => fixture.request(`${management()}/revoke`, { method: 'POST', user: 'staff', body: { expectedShare: expected(await currentShare()) } });
const publicPlan = token => `/api/public/evidence-plans/${token}`;
const image = (token, level = ids.level) => `${publicPlan(token)}/levels/${level}/background`;
const document = (token, entry = ids.entry) => `${publicPlan(token)}/entries/${entry}/document`;
const settings = extra => ({
  label: 'Client review', entryIds: [ids.entry, ids.secondEntry],
  documentEntryIds: [ids.entry], includeUnitFacts: false, expectedShare: null, ...extra,
});
const share = async extra => {
  const response = await fixture.request(management(), { method: 'PUT', user: 'staff', body: settings({ expectedShare: expected(await currentShare()), ...extra }) });
  assert.equal(response.status, 200, response.text);
  assert.ok(response.json.share?.token);
  return response.json.share;
};
const safeHeaders = response => {
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
};
const onlyKeys = (object, allowed) => {
  assert.deepEqual(Object.keys(object).filter(key => !allowed.includes(key)), []);
};

test('anonymous, disabled and client callers cannot read, create, update or revoke shares', async () => {
  for (const user of [undefined, 'disabled', 'client', 'unmapped-client', 'staff-client-view', 'disabled-row', 'external', 'client-row']) {
    for (const method of ['GET', 'PUT', 'POST']) {
      const response = await fixture.request(management() + (method === 'POST' ? '/revoke' : ''), { method, user, ...(method !== 'GET' ? { body: settings() } : {}) });
      assert.equal(response.status, !user ? 401 : 403, `${user}/${method}: ${response.text}`);
    }
  }
  assert.equal((await fixture.db.query('SELECT count(*) FROM evidence_plan_shares')).rows[0].count, '0');
});

test('staff see no share initially and save a stable active link without duplicating it', async () => {
  const initial = await fixture.request(management(), { user: 'staff' });
  assert.equal(initial.status, 200);
  assert.equal(initial.json.share, null);
  const first = await share();
  assert.ok(first.token.length >= 40, 'Use a high-entropy bearer token');
  const updated = await share({ label: 'Revised client review', entryIds: [ids.entry] });
  assert.equal(updated.token, first.token);
  assert.equal(updated.id, first.id);
  assert.equal(updated.label, 'Revised client review');
  assert.ok(Date.parse(updated.updatedAt) >= Date.parse(first.updatedAt) + 1);
  assert.equal((await fixture.db.query('SELECT count(*) FROM evidence_plan_shares WHERE revoked_at IS NULL')).rows[0].count, '1');
});

test('old clients and a migrated pre-mode share keep read-only access', async () => {
  const first = await share();
  assert.equal(first.accessMode, 'view', 'Omitting accessMode must not grant editing');
  await fixture.db.query('ALTER TABLE evidence_plan_shares DROP COLUMN access_mode');
  await ensureEvidencePlanShareSchema(fixture.db);
  const migrated = await currentShare();
  assert.equal(migrated.token, first.token);
  assert.equal(migrated.accessMode, 'view');
  const access = await fixture.request(`${publicPlan(first.token)}/access`);
  assert.equal(access.status, 200, access.text);
  safeHeaders(access);
  assert.deepEqual(access.json, { accessMode: 'view', planName: 'Shared scheme' });
  assert.equal((await fixture.request(publicPlan(first.token))).status, 200);
});

test('the access descriptor reveals an editor plan ID only for an explicit edit capability', async () => {
  const { token } = await share({ accessMode: 'edit' });
  const access = await fixture.request(`${publicPlan(token)}/access`);
  assert.equal(access.status, 200, access.text);
  safeHeaders(access);
  assert.deepEqual(access.json, { accessMode: 'edit', planName: 'Shared scheme', planId: ids.plan });
  for (const denied of ['invalid', 'A'.repeat(43)]) {
    assert.equal((await fixture.request(`${publicPlan(denied)}/access`)).status, 404);
  }
  await revoke();
  assert.equal((await fixture.request(`${publicPlan(token)}/access`)).status, 404);
});

test('changing either access mode rotates the capability and permanently revokes previous URLs', async () => {
  const view = await share();
  const edit = await share({ accessMode: 'edit' });
  const replacementView = await share({ accessMode: 'view' });
  assert.equal(new Set([view.token, edit.token, replacementView.token]).size, 3);
  assert.equal(new Set([view.id, edit.id, replacementView.id]).size, 3);
  for (const expired of [view, edit]) {
    for (const method of ['GET', 'HEAD']) {
      for (const url of [publicPlan(expired.token), `${publicPlan(expired.token)}/access`, image(expired.token), document(expired.token)]) {
        const response = await fixture.request(url, { method });
        assert.equal(response.status, 404, `${method} ${url}: ${response.text}`);
        safeHeaders(response);
      }
    }
  }
  const rows = (await fixture.db.query('SELECT token,access_mode,revoked_at FROM evidence_plan_shares')).rows;
  assert.equal(rows.filter(row => !row.revoked_at).length, 1);
  assert.equal(rows.filter(row => row.revoked_at).length, 2);
  assert.equal((await fixture.request(`${publicPlan(replacementView.token)}/access`)).json.accessMode, 'view');
});

test('editing share settings without a capability change preserves the explicit edit token', async () => {
  const first = await share({ accessMode: 'edit' });
  const revised = await share({ accessMode: 'edit', label: 'Updated editing invitation', entryIds: [], documentEntryIds: [] });
  assert.equal(revised.id, first.id);
  assert.equal(revised.token, first.token);
  assert.equal(revised.accessMode, 'edit');
  assert.notEqual(revised.updatedAt, first.updatedAt);
  assert.equal((await fixture.db.query('SELECT count(*) FROM evidence_plan_shares')).rows[0].count, '1');
});

test('a stale tab cannot widen or replace the active capability after a mode rotation', async () => {
  const first = await share();
  const editor = await share({ accessMode: 'edit' });
  for (const mode of ['view', 'edit']) {
    const response = await fixture.request(management(), { method: 'PUT', user: 'staff',
      body: settings({ accessMode: mode, expectedShare: expected(first) }) });
    assert.equal(response.status, 409, response.text);
  }
  assert.deepEqual(await currentShare(), editor);
  assert.equal((await fixture.request(`${publicPlan(first.token)}/access`)).status, 404);
});

test('a stale authenticated session for a deleted user cannot manage shares', async () => {
  for (const method of ['GET', 'PUT', 'POST']) {
    const response = await fixture.request(management() + (method === 'POST' ? '/revoke' : ''), {
      method, user: 'deleted', ...(method !== 'GET' ? { body: settings() } : {}),
    });
    assert.equal(response.status, 401, response.text);
  }
  assert.equal((await fixture.db.query('SELECT count(*) FROM evidence_plan_shares')).rows[0].count, '0');
});

test('cross-site forms and forged browser origins cannot revoke or change a staff link', async () => {
  const first = await share();
  for (const [headers, status] of [
    [{ 'content-type': 'application/x-www-form-urlencoded' }, 415],
    [{ 'content-type': 'text/plain' }, 415],
    [{ origin: 'https://attacker.example' }, 403],
    [{ 'sec-fetch-site': 'cross-site' }, 403],
    [{ 'sec-fetch-site': 'same-site' }, 403],
    [{ origin: 'null' }, 403],
    [{ authorization: 'Bearer forged', origin: 'https://attacker.example' }, 403],
  ]) {
    for (const method of ['PUT', 'POST']) {
      const response = await fixture.request(management() + (method === 'POST' ? '/revoke' : ''), {
        method, user: 'staff', headers, body: settings({ label: 'Must not change' }),
      });
      assert.equal(response.status, status, `${method} ${JSON.stringify(headers)}: ${response.text}`);
    }
  }
  const stored = (await fixture.request(management(), { user: 'staff' })).json.share;
  assert.equal(stored.token, first.token);
  assert.equal(stored.label, first.label);
  assert.equal(stored.revokedAt, null);
});

test('stale staff tabs cannot widen or revoke a newer selection on the same share', async () => {
  const first = await share();
  const newer = await share({ entryIds: [ids.entry], documentEntryIds: [], includeUnitFacts: false });
  assert.equal(newer.id, first.id);
  assert.notEqual(newer.updatedAt, first.updatedAt);
  const staleSave = await fixture.request(management(), {
    method: 'PUT', user: 'staff', body: settings({ expectedShare: expected(first), includeUnitFacts: true }),
  });
  assert.equal(staleSave.status, 409, staleSave.text);
  const staleRevoke = await fixture.request(`${management()}/revoke`, {
    method: 'POST', user: 'staff', body: { expectedShare: expected(first) },
  });
  assert.equal(staleRevoke.status, 409, staleRevoke.text);
  assert.deepEqual(await currentShare(), newer);
  const response = await fixture.request(publicPlan(first.token));
  assert.deepEqual(response.json.entries.map(row => row.id), [ids.entry]);
  assert.equal(response.json.entries[0].documentUrl, undefined);
  assert.ok(response.json.units.every(unit => !unit.facts));
});

test('a stale tab cannot modify or revoke a replacement link after another tab recreates it', async () => {
  const first = await share();
  assert.equal((await revoke()).status, 200);
  const replacement = await share({ entryIds: [], documentEntryIds: [] });
  for (const expectedShare of [expected(first), null]) {
    const saved = await fixture.request(management(), {
      method: 'PUT', user: 'staff', body: settings({ expectedShare }),
    });
    assert.equal(saved.status, 409, saved.text);
    const revoked = await fixture.request(`${management()}/revoke`, {
      method: 'POST', user: 'staff', body: { expectedShare },
    });
    assert.equal(revoked.status, 409, revoked.text);
  }
  assert.deepEqual(await currentShare(), replacement);
  assert.equal((await fixture.request(publicPlan(first.token))).status, 404);
  assert.equal((await fixture.request(publicPlan(replacement.token))).status, 200);
});

test('public JSON contains only selected entries and explicitly allowed fields', async () => {
  const { token } = await share();
  const response = await fixture.request(publicPlan(token));
  assert.equal(response.status, 200, response.text);
  safeHeaders(response);
  const payload = response.json;
  assert.deepEqual(payload.entries.map(entry => entry.id).sort(), [ids.entry, ids.secondEntry].sort());
  onlyKeys(payload, ['plan', 'levels', 'units', 'entries']);
  onlyKeys(payload.plan, ['name', 'updatedAt']);
  assert.equal(payload.plan.name, 'Shared scheme');
  for (const level of payload.levels) onlyKeys(level, ['id', 'name', 'width', 'height', 'imageUrl']);
  for (const unit of payload.units) {
    onlyKeys(unit, ['id', 'levelId', 'unitRef', 'tenantName', 'polygon', 'dot']);
    assert.equal(unit.facts, undefined);
  }
  for (const entry of payload.entries) onlyKeys(entry, [
    'id', 'unitId', 'unitRef', 'tenant', 'transactionType', 'transactionDate', 'sizeSqft', 'zoneA',
    'netZoneA', 'itza', 'headlineRent', 'netEffective', 'term', 'concession', 'documentUrl',
  ]);
  for (const forbidden of ['PRIVATE-', 'OTHER-', 'UNSELECTED-', 'source_key', 'background_key',
    'created_by', 'tenancy_unit_id', 'property_id', 'notes', ...Object.values(fileKeys)]) {
    assert.ok(!response.text.includes(forbidden), `Public JSON leaked ${forbidden}`);
  }
  assert.equal(payload.entries.find(row => row.id === ids.entry).documentUrl, document(token));
  assert.equal(payload.entries.find(row => row.id === ids.secondEntry).documentUrl, undefined);
  assert.equal(fixture.fileReads.length, 0, 'JSON does not need to read private document bytes');
});

test('real zero values survive public presentation and optional facts remain opt-in', async () => {
  const { token } = await share({ includeUnitFacts: true });
  const response = await fixture.request(publicPlan(token));
  assert.equal(response.status, 200, response.text);
  const entry = response.json.entries.find(row => row.id === ids.entry);
  for (const field of ['sizeSqft', 'zoneA', 'netZoneA', 'itza', 'headlineRent', 'netEffective']) assert.equal(entry[field], 0, field);
  const facts = response.json.units.find(row => row.id === ids.unit).facts;
  onlyKeys(facts, ['leaseStart', 'leaseExpiry', 'breakDate', 'reviewDate', 'outsideLtAct', 'erv', 'passingRent', 'sqft']);
  for (const field of ['erv', 'passingRent', 'sqft']) assert.equal(facts[field], 0, field);
  await share({ includeUnitFacts: false });
  const hidden = await fixture.request(publicPlan(token));
  assert.ok(hidden.json.units.every(unit => !Object.hasOwn(unit, 'facts')));
});

test('canonical tenancy identity stays current without publishing financial facts or private schedule fields', async () => {
  await fixture.db.query(`INSERT INTO tenancy_schedule_units
    (id,property_id,unit_number,trading_name,tenant_name,erv_pa,passing_rent_pa,nia_sqft,comments,underwriting_comments)
    VALUES ('tenancy-a','property-a','A1','Current trading name','Private legal tenant',0,0,0,'PRIVATE-SCHEDULE-NOTE','PRIVATE-UNDERWRITING'),
      ('tenancy-b','property-b','A1','OTHER-CANONICAL-SECRET','Other legal tenant',999999,999999,999999,'OTHER-NOTE','OTHER-UNDERWRITING')`);
  await fixture.db.query('UPDATE evidence_plan_units SET tenancy_unit_id=$1,erv=15000,passing_rent=25000 WHERE id=$2', ['tenancy-a', ids.unit]);
  const { token } = await share({ includeUnitFacts: false });
  const withoutFacts = await fixture.request(publicPlan(token));
  const unit = withoutFacts.json.units.find(row => row.id === ids.unit);
  assert.equal(unit.tenantName, 'Current trading name');
  assert.equal(unit.facts, undefined);
  assert.ok(!withoutFacts.text.includes('PRIVATE-') && !withoutFacts.text.includes('OTHER-'));
  await share({ includeUnitFacts: true });
  const withFacts = await fixture.request(publicPlan(token));
  const facts = withFacts.json.units.find(row => row.id === ids.unit).facts;
  assert.equal(facts.erv, 0);
  assert.equal(facts.passingRent, 0);
  assert.equal(facts.sqft, 0);
  assert.ok(!withFacts.text.includes('PRIVATE-') && !withFacts.text.includes('OTHER-'));
});

test('image access is scoped to a live token and a level from that plan', async () => {
  const { token } = await share();
  const ok = await fixture.request(image(token));
  assert.equal(ok.status, 200, ok.text);
  assert.ok(ok.text.endsWith('synthetic-plan-image'));
  assert.match(ok.headers.get('content-type'), /^image\/png/);
  safeHeaders(ok);
  fixture.fileReads.length = 0;
  for (const level of [ids.otherLevel, id(999), 'not-a-uuid']) {
    const denied = await fixture.request(image(token, level));
    assert.equal(denied.status, 404, denied.text);
  }
  assert.deepEqual(fixture.fileReads, [], 'Rejected IDs must not reach storage');
});

test('document access requires both selected-entry and selected-document membership in the same plan', async () => {
  const { token } = await share();
  const ok = await fixture.request(document(token));
  assert.equal(ok.status, 200, ok.text);
  assert.match(ok.text, /^%PDF/);
  assert.match(ok.headers.get('content-disposition') || '', /^attachment;/);
  safeHeaders(ok);
  fixture.fileReads.length = 0;
  for (const entry of [ids.secondEntry, ids.unselectedEntry, ids.otherEntry, id(999), 'not-a-uuid']) {
    const denied = await fixture.request(document(token, entry));
    assert.equal(denied.status, 404, denied.text);
  }
  assert.deepEqual(fixture.fileReads, [], 'Rejected document IDs must not reach storage');
});

test('tampered stored allowlists cannot turn a foreign entry into public JSON or a download', async () => {
  const { token, id: shareId } = await share();
  await fixture.db.query('UPDATE evidence_plan_shares SET entry_ids=array_append(entry_ids,$1::uuid), document_entry_ids=array_append(document_entry_ids,$1::uuid) WHERE id=$2', [ids.otherEntry, shareId]);
  const json = await fixture.request(publicPlan(token));
  assert.equal(json.status, 200, json.text);
  assert.ok(!json.text.includes('OTHER-'));
  assert.ok(!json.json.entries.some(row => row.id === ids.otherEntry));
  assert.equal((await fixture.request(document(token, ids.otherEntry))).status, 404);
  assert.ok(!fixture.fileReads.includes(fileKeys.otherDoc));
});

test('invalid and unknown tokens deny JSON, images and documents uniformly', async () => {
  await share();
  for (const token of ['bad', 'x'.repeat(500), 'A'.repeat(43), '%27%20OR%201%3D1--']) {
    for (const url of [publicPlan(token), image(token), document(token)]) {
      const response = await fixture.request(url);
      assert.equal(response.status, 404, `${url}: ${response.text}`);
      safeHeaders(response);
      assert.ok(!response.text.includes('synthetic') && !response.text.includes('PRIVATE-'));
    }
  }
  assert.deepEqual(fixture.fileReads, []);
});

test('revocation kills JSON, HEAD, image and document access; recreating never revives the old token', async () => {
  const first = await share();
  assert.equal((await revoke()).status, 200);
  assert.ok((await fixture.request(management(), { user: 'staff' })).json.share.revokedAt);
  const second = await share();
  assert.notEqual(second.token, first.token);
  assert.notEqual(second.id, first.id);
  for (const method of ['GET', 'HEAD']) for (const url of [publicPlan(first.token), image(first.token), document(first.token)]) {
    const response = await fixture.request(url, { method });
    assert.equal(response.status, 404, `${method} ${url}`);
    safeHeaders(response);
  }
  assert.equal((await fixture.request(publicPlan(second.token))).status, 200);
  assert.equal((await fixture.db.query('SELECT count(*) FROM evidence_plan_shares WHERE revoked_at IS NOT NULL')).rows[0].count, '1');
});

test('removing an entry or document permission takes effect on the unchanged active token', async () => {
  const first = await share({ documentEntryIds: [ids.entry, ids.secondEntry] });
  assert.equal((await fixture.request(document(first.token, ids.secondEntry))).status, 200);
  await share({ entryIds: [ids.entry], documentEntryIds: [] });
  const response = await fixture.request(publicPlan(first.token));
  assert.deepEqual(response.json.entries.map(row => row.id), [ids.entry]);
  assert.equal(response.json.entries[0].documentUrl, undefined);
  assert.equal((await fixture.request(document(first.token))).status, 404);
  assert.equal((await fixture.request(document(first.token, ids.secondEntry))).status, 404);
});

test('public routes accept no state-changing methods and do not expose staff source/file routes', async () => {
  const { token } = await share();
  const before = (await fixture.db.query('SELECT * FROM evidence_plan_shares')).rows;
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const url of [publicPlan(token), image(token), document(token)]) {
      const response = await fixture.request(url, { method, body: settings({ label: 'ATTACK' }) });
      assert.ok([404, 405].includes(response.status), `${method} ${url}: ${response.status}`);
    }
  }
  for (const suffix of ['/source?key=' + encodeURIComponent(fileKeys.doc), '/background?key=' + encodeURIComponent(fileKeys.otherImage), '/share']) {
    assert.equal((await fixture.request(publicPlan(token) + suffix)).status, 404);
  }
  assert.deepEqual((await fixture.db.query('SELECT * FROM evidence_plan_shares')).rows, before);
  assert.deepEqual(fixture.fileReads, []);
});

test('settings reject malformed IDs, unsupported values and document selections outside the selected entries', async () => {
  const cases = [
    null, [], {}, { ...settings(), label: 42 }, { ...settings(), label: 'x'.repeat(10000) },
    settings({ entryIds: 'all' }), settings({ entryIds: [null] }), settings({ entryIds: ['not-a-uuid'] }),
    settings({ entryIds: [ids.otherEntry] }), settings({ entryIds: [id(999)] }),
    settings({ documentEntryIds: [ids.unselectedEntry] }), settings({ documentEntryIds: [ids.otherEntry] }),
    settings({ documentEntryIds: 'all' }), settings({ includeUnitFacts: 'true' }),
    ...['admin', 'EDIT', '', true, null, 1, ['edit']].map(accessMode => settings({ accessMode })),
    settings({ includeUnitFacts: null }), settings({ token: 'chosen-token' }), settings({ source_key: fileKeys.otherDoc }),
    settings({ expectedShare: 'none' }), settings({ expectedShare: {} }),
    settings({ expectedShare: { id: ids.plan, updatedAt: 'not-a-date' } }),
    Object.fromEntries(Object.entries(settings()).filter(([key]) => key !== 'expectedShare')),
  ];
  for (const body of cases) {
    const response = await fixture.request(management(), { method: 'PUT', user: 'staff', body });
    assert.equal(response.status, 400, `${JSON.stringify(body)}: ${response.text}`);
  }
  assert.equal((await fixture.db.query('SELECT count(*) FROM evidence_plan_shares')).rows[0].count, '0');
});

test('failed settings changes preserve the prior link and choices atomically', async () => {
  const first = await share();
  const before = (await fixture.db.query('SELECT * FROM evidence_plan_shares')).rows;
  const response = await fixture.request(management(), { method: 'PUT', user: 'staff', body: settings({ entryIds: [ids.entry, ids.otherEntry], expectedShare: expected(first) }) });
  assert.equal(response.status, 400);
  assert.deepEqual((await fixture.db.query('SELECT * FROM evidence_plan_shares')).rows, before);
  assert.equal((await fixture.request(publicPlan(first.token))).status, 200);
});

test('deleted plans and moved entries immediately cease to authorize content', async () => {
  const { token } = await share();
  await fixture.db.query('UPDATE evidence_plan_entries SET plan_id=$1 WHERE id=$2', [ids.otherPlan, ids.entry]);
  const response = await fixture.request(publicPlan(token));
  assert.ok(!response.json.entries.some(row => row.id === ids.entry));
  assert.equal((await fixture.request(document(token))).status, 404);
  await fixture.db.query('DELETE FROM evidence_plans WHERE id=$1', [ids.plan]);
  for (const url of [publicPlan(token), image(token), document(token)]) assert.equal((await fixture.request(url)).status, 404);
});

test('approved PDF/Excel types download with signatures; active HTML/SVG/script payload types are rejected', async () => {
  const { token } = await share();
  for (const [contentType, originalName] of [
    ['application/pdf', 'evidence.pdf'],
    ['application/vnd.ms-excel', 'evidence.xls'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'evidence.xlsx'],
  ]) {
    const data = contentType === 'application/pdf' ? Buffer.from('%PDF-1.4 safe fixture')
      : contentType === 'application/vnd.ms-excel' ? Buffer.from('d0cf11e0a1b11ae100000000', 'hex')
      : Buffer.from('504b030400000000', 'hex');
    fixture.files.set(fileKeys.doc, { data, contentType, originalName, size: data.length });
    const response = await fixture.request(document(token));
    assert.equal(response.status, 200, `${contentType}: ${response.text}`);
    assert.match(response.headers.get('content-disposition') || '', /^attachment;/);
    safeHeaders(response);
  }
  for (const contentType of ['text/html', 'image/svg+xml', 'application/javascript', 'application/x-msdownload']) {
    fixture.files.set(fileKeys.doc, { data: Buffer.from('<script>private</script>'), contentType, originalName: 'evidence.pdf', size: 24 });
    const response = await fixture.request(document(token));
    assert.ok([404, 415].includes(response.status), `${contentType}: ${response.text}`);
    assert.ok(!response.text.includes('<script>'));
  }
});

test('background endpoints never serve active SVG or HTML as a plan image', async () => {
  const { token } = await share();
  for (const contentType of ['image/svg+xml', 'text/html', 'application/pdf']) {
    fixture.files.set(fileKeys.image, { data: Buffer.from('<svg onload="attack()"/>'), contentType, originalName: 'plan.svg', size: 24 });
    const response = await fixture.request(image(token));
    assert.ok([404, 415].includes(response.status), `${contentType}: ${response.text}`);
    assert.ok(!response.text.includes('<svg'));
  }
});

test('mislabelled active bytes fail file signature validation and original filenames cannot inject headers', async () => {
  const { token } = await share();
  fixture.files.set(fileKeys.doc, { data: Buffer.from('<html>not a PDF</html>'), contentType: 'application/pdf', originalName: 'report.pdf', size: 22 });
  assert.equal((await fixture.request(document(token))).status, 404);
  fixture.files.set(fileKeys.image, { data: Buffer.from('<svg onload="attack()"/>'), contentType: 'image/png', originalName: 'plan.png', size: 24 });
  assert.equal((await fixture.request(image(token))).status, 404);
  fixture.files.set(fileKeys.doc, { data: Buffer.from('%PDF-1.4 synthetic'), contentType: 'application/pdf', originalName: 'private"\r\nX-Private: leaked.pdf', size: 18 });
  const response = await fixture.request(document(token));
  assert.equal(response.status, 200, response.text);
  assert.equal(response.headers.get('x-private'), null);
  assert.match(response.headers.get('content-disposition'), /^attachment; filename="evidence\.pdf"$/);
});

test('storage failures never expose keys, tokens or internal errors in a public response', async () => {
  const { token } = await share();
  fixture.files.set(fileKeys.doc, new Error(`PRIVATE-STORAGE ${fileKeys.doc} token=${token}`));
  const response = await fixture.request(document(token));
  assert.equal(response.status, 500);
  safeHeaders(response);
  for (const secret of ['PRIVATE-STORAGE', fileKeys.doc, token]) assert.ok(!response.text.includes(secret));
});

test('nested geometry is reconstructed from coordinates rather than leaking source metadata', async () => {
  await fixture.db.query('UPDATE evidence_plan_units SET polygon=$1,dot=$2 WHERE id=$3', [
    JSON.stringify([{ x: .1, y: .1, notes: 'PRIVATE-POINT' }, { x: .4, y: .1 }, { x: .4, y: .4 }]),
    JSON.stringify({ x: .2, y: .2, source_key: fileKeys.otherDoc }), ids.unit,
  ]);
  const { token } = await share();
  const response = await fixture.request(publicPlan(token));
  const unit = response.json.units.find(row => row.id === ids.unit);
  assert.deepEqual(unit.polygon, [{ x: .1, y: .1 }, { x: .4, y: .1 }, { x: .4, y: .4 }]);
  assert.deepEqual(unit.dot, { x: .2, y: .2 });
  assert.ok(!response.text.includes('PRIVATE-POINT') && !response.text.includes(fileKeys.otherDoc));
});

test('empty selections share a plan without silently selecting any evidence or documents', async () => {
  const { token } = await share({ entryIds: [], documentEntryIds: [] });
  const response = await fixture.request(publicPlan(token));
  assert.equal(response.status, 200, response.text);
  assert.deepEqual(response.json.entries, []);
  assert.equal((await fixture.request(document(token))).status, 404);
  assert.equal((await fixture.request(image(token))).status, 200);
});

test('concurrent creates produce one active link, report conflicts, and separate plans never share tokens', async () => {
  const responses = await Promise.all(Array.from({ length: 5 }, () => fixture.request(management(), { method: 'PUT', user: 'staff', body: settings() })));
  assert.equal(responses.filter(response => response.status === 200).length, 1, responses.map(row => row.text).join('\n'));
  assert.equal(responses.filter(response => response.status === 409).length, 4);
  const first = responses.find(response => response.status === 200).json.share;
  assert.equal((await fixture.db.query('SELECT count(*) FROM evidence_plan_shares WHERE revoked_at IS NULL')).rows[0].count, '1');
  const other = await fixture.request(management(ids.otherPlan), { method: 'PUT', user: 'staff', body: settings({ entryIds: [ids.otherEntry], documentEntryIds: [ids.otherEntry] }) });
  assert.equal(other.status, 200, other.text);
  assert.notEqual(other.json.share.token, first.token);
  assert.equal((await fixture.request(document(first.token, ids.otherEntry))).status, 404);
});

test('public router runs before client denial and public page bypasses persistent staff providers', async () => {
  const index = await readFile(new URL('../../server/index.ts', import.meta.url), 'utf8');
  const mount = index.indexOf('app.use(evidencePlanSharePublicRouter)');
  const clientGate = index.indexOf('Client default-deny backstop');
  assert.ok(mount > 0 && mount < index.indexOf('setupAuth(app);') && mount < clientGate);
  const app = await readFile(new URL('../../client/src/App.tsx', import.meta.url), 'utf8');
  const appBody = app.slice(app.indexOf('function App() {'));
  assert.ok(appBody.indexOf('<EvidencePlanShare />') > 0);
  assert.ok(appBody.indexOf('<EvidencePlanShare />') < appBody.indexOf('const Provider:'));
  assert.ok(!appBody.slice(0, appBody.indexOf('const Provider:')).includes('<ThemeProvider>'));
});

test('public bearer URLs cannot be cached or served offline by the service worker', async () => {
  const listeners = new Map();
  const code = await readFile(new URL('../../client/public/sw.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, {
    self: { addEventListener: (name, handler) => listeners.set(name, handler), location: new URL('https://example.test/') },
    URL, caches: new Proxy({}, { get: () => { throw new Error('Shared plan must not touch caches'); } }),
  });
  const handler = listeners.get('fetch');
  assert.equal(typeof handler, 'function');
  for (const route of ['/evidence-plan-share', '/evidence-plan-share/example-token',
    '/api/public/evidence-plans/example-token', '/api/public/evidence-plans/example-token/entries/example/document']) {
    let intercepted = false;
    handler({ request: { method: 'GET', url: `https://example.test${route}`, mode: 'navigate' }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, route);
  }
});

test('forged Authorization values cannot rotate the public share rate-limit bucket', () => {
  const require = createRequire(import.meta.url);
  const { find, evaluate, ts } = require('./source-harness.cjs');
  const declaration = find('server/index.ts', node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(item => item.name.getText() === 'apiLimiter'));
  const { limiter } = evaluate(`${declaration}\nexport const limiter = apiLimiter;`, {
    rateLimit: options => options, ipKeyGenerator: ip => `ip:${ip}`, process: { env: { NODE_ENV: 'production' } },
  });
  for (const path of ['/api/public/evidence-plans/token', '/API/PUBLIC/EVIDENCE-PLANS/token/levels/id/background']) {
    for (const authorization of [undefined, 'Bearer forged-one', 'Bearer forged-two']) {
      const request = { originalUrl: path, path, ip: '192.0.2.7', headers: { authorization } };
      assert.equal(limiter.keyGenerator(request), 'ip:192.0.2.7');
      assert.equal(limiter.skip(request), false);
    }
  }
});

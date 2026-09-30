import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, route, ts } = require('./source-harness.cjs');
const file = 'server/business-gateway.ts';
const fn = name => find(file, n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const variable = name => find(file, n => ts.isVariableStatement(n)
  && n.declarationList.declarations.some(d => d.name.getText() === name));
const parserSource = ['ocXmlElement', 'ocXmlText', 'extractOcDocument', 'summariseOcResponse', 'classifyOfficialCopyResponse'].map(fn).join('\n');
const parser = evaluate(parserSource);
const pdf = Buffer.from('%PDF-1.4\nexample register\n%%EOF').toString('base64');
const envelope = inner => `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>${inner}</soapenv:Body></soapenv:Envelope>`;
const result = (type, inner) => envelope(`<r:GatewayResponse xmlns:r="urn:hmlr"><r:TypeCode>${type}</r:TypeCode>${inner}</r:GatewayResponse>`);
const delivered = result('30', `<r:Results><r:ExternalReference><r:Reference>BGP-client-ref</r:Reference></r:ExternalReference><r:ActualPrice><r:GrossPriceAmount currencyID="GBP">7.00</r:GrossPriceAmount></r:ActualPrice><r:Attachment><r:EmbeddedFileBinaryObject>${pdf}</r:EmbeddedFileBinaryObject></r:Attachment><r:ResultTypeCode>10</r:ResultTypeCode><r:HMLRReference><r:Reference>HMLR-12345</r:Reference></r:HMLRReference></r:Results>`);
const rejected = result('20', '<r:Rejection><r:RejectionResponse><r:Reason>Login details are invalid.</r:Reason><r:Code>bg.auth.fails</r:Code></r:RejectionResponse></r:Rejection>');
const pending = result('10', '<r:Acknowledgement><r:AcknowledgementDetails><r:UniqueID>queued-42</r:UniqueID><r:ExpectedResponseDateTime>2026-10-01T08:00:00Z</r:ExpectedResponseDateTime><r:MessageDescription>Service is not currently available. System has queued your request.</r:MessageDescription></r:AcknowledgementDetails></r:Acknowledgement>');

test('business rejections inside HTTP 200 remain rejected and retain the actual fault', () => {
  const summary = parser.summariseOcResponse(rejected);
  assert.equal(summary.fault, 'Login details are invalid.');
  assert.equal(summary.code, 'bg.auth.fails');
  assert.equal(parser.classifyOfficialCopyResponse(200, summary, false), 'rejected');
});

test('queued acknowledgement remains pending with the collection details, not a successful PDF', () => {
  const summary = parser.summariseOcResponse(pending);
  assert.equal(summary.uniqueId, 'queued-42');
  assert.equal(summary.expectedResponseDateTime, '2026-10-01T08:00:00Z');
  assert.match(summary.message, /queued/);
  assert.equal(parser.classifyOfficialCopyResponse(200, summary, false), 'pending');
});

test('valid result returns the actual HMLR reference and accepts optional PDF format attributes', () => {
  const summary = parser.summariseOcResponse(delivered);
  assert.equal(summary.reference, 'HMLR-12345');
  assert.equal(summary.externalReference, 'BGP-client-ref');
  assert.equal(summary.actualPrice, '7.00');
  assert.equal(summary.hasDocument, true);
  assert.equal(parser.classifyOfficialCopyResponse(200, summary, true), 'delivered');
  for (const attributes of ['', " format='pdf'", ' r:format="pdf" mimeCode="application/pdf"']) {
    assert.equal(parser.extractOcDocument(`<r:EmbeddedFileBinaryObject${attributes}>${pdf}</r:EmbeddedFileBinaryObject>`)?.base64, pdf);
  }
});

test('HTML/empty/non-PDF/malformed responses cannot become successful register retrievals', () => {
  for (const body of ['<html>Login</html>', '', result('30', ''), result('30', '<r:EmbeddedFileBinaryObject format="pdf">aHRtbA==</r:EmbeddedFileBinaryObject>')]) {
    const summary = parser.summariseOcResponse(body);
    assert.equal(parser.extractOcDocument(body), null);
    assert.equal(parser.classifyOfficialCopyResponse(200, summary, false), 'failed');
  }
  assert.equal(parser.classifyOfficialCopyResponse(500, parser.summariseOcResponse(delivered), true), 'failed');
});

test('SOAP authentication faults are decoded without dropping the diagnostic code', () => {
  const summary = parser.summariseOcResponse(envelope('<soapenv:Fault><faultcode>soapenv:Server</faultcode><faultstring>Login details are invalid. A&amp;B &#39;account&#39;</faultstring><detail><Code>bg.auth.fails</Code></detail></soapenv:Fault>'));
  assert.equal(summary.fault, "Login details are invalid. A&B 'account'");
  assert.equal(summary.code, 'bg.auth.fails');
  assert.equal(parser.classifyOfficialCopyResponse(500, summary, false), 'rejected');
});

test('order envelope enforces the advertised fee ceiling and escapes credentials', () => {
  const { buildOfficialCopyEnvelope } = evaluate(variable('xmlEscape') + '\n' + fn('buildOfficialCopyEnvelope'), { randomUUID: () => 'abcdef1234567890' });
  const xml = buildOfficialCopyEnvelope({ titleNumber: 'ngl813653' }, { username: 'test&name', password: '<test-password>' });
  assert.match(xml, /<ns1:GrossPriceAmount>7<\/ns1:GrossPriceAmount>/);
  assert.match(xml, /ContinueIfActualFeeExceedsExpectedFeeIndicator>false</);
  assert.match(xml, /<wsse:Username>test&amp;name<\/wsse:Username>/);
  assert.match(xml, /&lt;test-password&gt;/);
  assert.match(buildOfficialCopyEnvelope({ titleNumber: 'NGL813653', expectedPrice: 6.25 }, { username: 'test', password: 'test' }), /<ns1:GrossPriceAmount>6.25</);
});

test('backdated copies require a literal true opt-in without changing the product or fee ceiling', () => {
  const { buildOfficialCopyEnvelope } = evaluate(variable('xmlEscape') + '\n' + fn('buildOfficialCopyEnvelope'), { randomUUID: () => 'abcdef1234567890' });
  for (const allowBackdated of [undefined, false, true, 'true', 'false', 1, null]) {
    const xml = buildOfficialCopyEnvelope({ titleNumber: 'NGL813653', allowBackdated }, { username: 'test', password: 'test' });
    assert.match(xml, new RegExp(`<ns1:SendBackDatedIndicator>${allowBackdated === true}</ns1:SendBackDatedIndicator>`));
    assert.match(xml, /<ns1:GrossPriceAmount>7<\/ns1:GrossPriceAmount>/);
    assert.match(xml, /<ns1:RequestedOfficialCopyCode>10<\/ns1:RequestedOfficialCopyCode>/);
    assert.match(xml, /<ns1:OfficialCopyTypeCode>10<\/ns1:OfficialCopyTypeCode>/);
    assert.match(xml, /ContinueIfActualFeeExceedsExpectedFeeIndicator>false</);
    assert.match(xml, /ContinueIfTitleIsClosedAndContinuedIndicator>false</);
  }
});

// Relevant fields from HMLR's published V2 GR514442/GR514443/DT501578/GR519468
// fixtures. Referred-to documents are unrelated to this OC1 register check.
// https://landregistry.github.io/bgtechdoc/services/official_copy_document_availability_v2/
const availablePayload = { data: { title_status: 'Title number is valid.', title_status_code: 'VALID', title_number: 'GR514442', applications_pending: false, referred_to_documents: [],
  register: { type: 'register', type_code: 'REGISTER', availability: 'available for immediate download', availability_code: 'IMMEDIATE', backdated: false },
  title_plan: { type: 'plan', type_code: 'TITLEPLAN', availability: 'available for immediate download', availability_code: 'IMMEDIATE', backdated: false } } };
function availabilityFixture({ status = 200, body = JSON.stringify(availablePayload), live = true, configured = true, credentials = true, fail } = {}) {
  const calls = [];
  const compiled = evaluate(fn('bgOfficialCopyAvailability'), {
    bgIsLive: () => live, bgConfigured: () => configured,
    bgCredentials: () => credentials ? { username: 'fixture-user', password: 'fixture-secret' } : null,
    bgRequest: async opts => { calls.push(opts); if (fail) throw new Error(fail); return { status, body }; },
  });
  return { run: title => compiled.bgOfficialCopyAvailability(title), calls };
}

test('account access is checked with a GET availability request, never a paid order', async () => {
  const f = availabilityFixture();
  const checked = await f.run(' ngl 813653 ');
  assert.equal(checked.authentication, 'verified');
  assert.equal(checked.ok, true);
  assert.equal(checked.titleStatus, 'VALID');
  assert.equal(checked.registerAvailability, 'IMMEDIATE');
  assert.equal(checked.registerBackdated, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, 'GET');
  assert.equal(f.calls[0].path, '/bg2/api/v2/titles/NGL813653/official-copies/availability');
  assert.match(f.calls[0].headers.Authorization, /^Basic /);
  assert.equal(f.calls[0].body, undefined);
  assert.doesNotMatch(JSON.stringify(checked), /fixture-secret|fixture-user|Basic/);
});

test('successful authentication does not hide a closed title or unavailable register', async () => {
  for (const [title, status, continued] of [['DT501578', 'CLOSED', undefined], ['GR519468', 'CLOSED_AND_CONTINUED', 'GR519470']]) {
    const payload = { data: { ...availablePayload.data, title_number: title, title_status_code: status,
      title_status: 'According to our records this title number has been cancelled (or closed).', continued_under_title_number: continued,
      register: { ...availablePayload.data.register, availability: 'not available', availability_code: 'UNAVAILABLE' } } };
    const checked = await availabilityFixture({ body: JSON.stringify(payload) }).run(title);
    assert.equal(checked.ok, true);
    assert.equal(checked.authentication, 'verified');
    assert.equal(checked.titleStatus, status);
    assert.equal(checked.registerAvailability, 'UNAVAILABLE');
    assert.equal(checked.continuedUnderTitleNumber, continued);
  }
});

test('availability preserves manual-delivery and backdated-only facts for the caller to review', async () => {
  const manual = { data: { ...availablePayload.data, register: { ...availablePayload.data.register, availability: 'requires further investigation', availability_code: 'MANUAL' } } };
  assert.equal((await availabilityFixture({ body: JSON.stringify(manual) }).run('GR514442')).registerAvailability, 'MANUAL');
  const backdated = { data: { ...availablePayload.data, title_number: 'GR514443', title_status_code: 'PENDING_APPLICATIONS', applications_pending: true,
    title_status: 'There is at least one pending application for registration against this title number. You may want to view the day list.',
    register: { ...availablePayload.data.register, backdated: true } } };
  const checked = await availabilityFixture({ body: JSON.stringify(backdated) }).run('GR514443');
  assert.equal(checked.registerAvailability, 'IMMEDIATE');
  assert.equal(checked.registerBackdated, true);
  assert.equal(checked.titleStatus, 'PENDING_APPLICATIONS');
});

test('403 reports account role/organisation rejection separately from bad credentials and preserves support trace', async () => {
  const f = availabilityFixture({ status: 403, body: JSON.stringify({ error_code: 'BG40005', error_message: 'Incorrect user role or organisation is not permitted', trace_id: 'support-trace' }) });
  const checked = await f.run('NGL813653');
  assert.equal(checked.authentication, 'forbidden');
  assert.equal(checked.code, 'BG40005');
  assert.equal(checked.traceId, 'support-trace');
  assert.match(checked.error, /role or organisation/);
  assert.equal(checked.ok, false);
  const invalid = await availabilityFixture({ status: 401 }).run('NGL813653');
  assert.equal(invalid.authentication, 'rejected');
});

test('missing configuration and invalid titles never contact HMLR', async () => {
  for (const settings of [{ configured: false }, { credentials: false }]) {
    const f = availabilityFixture(settings);
    assert.equal((await f.run('NGL813653')).authentication, 'not_configured');
    assert.equal(f.calls.length, 0);
  }
  const f = availabilityFixture();
  assert.equal((await f.run('../password')).ok, false);
  assert.equal(f.calls.length, 0);
});

test('availability respects test environment and never guesses auth success on provider or network failure', async () => {
  const f = availabilityFixture({ live: false });
  await f.run('GR514442');
  assert.match(f.calls[0].path, /^\/bg2test\/api\/v2\//);
  for (const settings of [{ status: 404 }, { status: 429 }, { status: 503 }, { status: 200, body: '<html>Sign in</html>' }, { status: 200, body: '{"error_message":"Invalid account"}' }, { status: 200, body: '{"data":[]}' }, { fail: 'socket timeout' }]) {
    const checked = await availabilityFixture(settings).run('NGL813653');
    assert.equal(checked.ok, false);
    assert.equal(checked.authentication, 'unverified');
  }
});

function orderFixture({ status = 200, body = delivered, fail } = {}) {
  const calls = [];
  const compiled = evaluate(variable('xmlEscape') + '\n' + fn('buildOfficialCopyEnvelope') + '\n' + parserSource + '\n' + fn('officialCopyByTitle'), {
    randomUUID: () => 'abcdef1234567890abcdef1234567890', bgConfigured: () => true,
    bgCredentials: () => ({ username: 'test', password: 'test' }), bgOfficialCopyPath: () => '/official-copy',
    bgRequest: async opts => { calls.push(opts); if (fail) throw new Error(fail); return { status, body }; },
  });
  return { run: (opts = {}) => compiled.officialCopyByTitle({ titleNumber: 'NGL813653', ...opts }), calls };
}

test('order summaries retain only the explicit backdated choice for delivery, rejection and unknown outcomes', async () => {
  for (const provider of [{ body: delivered }, { body: pending }, { body: rejected }, { fail: 'socket timeout' }]) {
    for (const allowBackdated of [undefined, false, true, 'true']) {
      const fixture = orderFixture(provider);
      const received = await fixture.run({ allowBackdated });
      assert.equal(received.summary.registerBackdated, allowBackdated === true);
      assert.equal(fixture.calls.length, 1);
      assert.match(fixture.calls[0].body, new RegExp(`<ns1:SendBackDatedIndicator>${allowBackdated === true}</ns1:SendBackDatedIndicator>`));
      assert.match(fixture.calls[0].body, /ContinueIfActualFeeExceedsExpectedFeeIndicator>false</);
    }
  }
});

test('persisted register metadata retains the confirmed backdated nature', async () => {
  const writes = [];
  const { persistOfficialCopy } = evaluate(fn('ocStorageKey') + '\n' + fn('persistOfficialCopy'), {
    saveFile: async () => {}, pool: { query: async (_sql, params) => { writes.push(params); } },
  });
  const received = await orderFixture().run({ allowBackdated: true });
  await persistOfficialCopy({ titleNumber: 'NGL813653', base64: received.document.base64, summary: received.summary, userId: 'test-user' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][2].registerBackdated, true);
  assert.equal(writes[0][2].source, 'hmlr_business_gateway');
  assert.equal(writes[0][3], 7);
});

test('cached register summary reads the matching Business Gateway record and returns only its backdated flag', async () => {
  for (const stored of [true, false, 'true', undefined]) {
    let query, params;
    const { getStoredOfficialCopySummary } = evaluate(fn('getStoredOfficialCopySummary'), {
      pool: { query: async (sql, args) => {
        query = sql; params = args;
        return { rows: [{ raw_response: { source: 'hmlr_business_gateway', registerBackdated: stored, privateData: 'not for chat' } }] };
      } },
    });
    const summary = await getStoredOfficialCopySummary('ngl813653');
    assert.equal(summary.registerBackdated, stored === true);
    assert.deepEqual(Object.keys(summary), ['registerBackdated']);
    assert.deepEqual(Array.from(params), ['NGL813653']);
    assert.match(query, /title_number = \$1 AND documents = 'register'/);
    assert.match(query, /raw_response->>'source' = 'hmlr_business_gateway'/);
  }
  const { getStoredOfficialCopySummary } = evaluate(fn('getStoredOfficialCopySummary'), { pool: { query: async () => ({ rows: [] }) } });
  assert.equal(await getStoredOfficialCopySummary('NGL813653'), null);
});

test('order request distinguishes delivered, pending and rejected while retaining its request ID', async () => {
  for (const [body, expected] of [[delivered, 'delivered'], [pending, 'pending'], [rejected, 'rejected']]) {
    const f = orderFixture({ body });
    const received = await f.run();
    assert.equal(received.outcome, expected);
    assert.equal(received.ok, expected === 'delivered');
    assert.match(f.calls[0].body, new RegExp(`<ns1:MessageID>${received.requestMessageId}</ns1:MessageID>`));
    assert.equal(received.summary.messageId, received.requestMessageId);
    assert.equal(f.calls.length, 1);
  }
});

test('network failure keeps the request ID and unknown-order warning without automatic paid retries', async () => {
  const f = orderFixture({ fail: 'Business Gateway request timed out' });
  const received = await f.run();
  assert.equal(received.outcome, 'unknown');
  assert.equal(received.status, 0);
  assert.equal(received.summary.messageId, received.requestMessageId);
  assert.match(received.summary.message, /outcome is unknown/);
  assert.equal(f.calls.length, 1);
});

function routeFixture(providerResult, { persistError, requestBody = { titleNumber: 'NGL813653' } } = {}) {
  let handler, persistenceCalls = 0, orderOptions;
  evaluate(route(file, 'post', '/api/lr-bg/official-copy'), {
    app: { post: (_url, _auth, callback) => { handler = callback; } }, requireAuth() {},
    bgConfigured: () => true, bgCredentials: () => ({ username: 'test', password: 'test' }),
    officialCopyByTitle: async options => { orderOptions = options; return providerResult; },
    persistOfficialCopy: async () => { persistenceCalls++; if (persistError) throw new Error('storage unavailable'); return { registerUrl: '/api/lr-bg/register/NGL813653' }; },
    console: { error() {} },
  });
  return { run: async () => {
    let status, body;
    const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
    await handler({ body: requestBody, session: { userId: 'user' } }, res);
    return { status, body, persistenceCalls, orderOptions };
  } };
}

test('HTTP order route never advertises saved success if storing a received register failed', async () => {
  const provider = await orderFixture().run();
  const response = await routeFixture(provider, { persistError: true }).run();
  assert.equal(response.status, 502);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.outcome, 'delivered');
  assert.equal(response.body.saved, null);
  assert.match(response.body.error, /Do not place another paid order/);
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(pdf));
});

test('HTTP order route returns pending without claiming delivery or trying to persist a PDF', async () => {
  const provider = await orderFixture({ body: pending }).run();
  const response = await routeFixture(provider).run();
  assert.equal(response.status, 202);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.outcome, 'pending');
  assert.equal(response.persistenceCalls, 0);
  assert.equal(response.body.summary.uniqueId, 'queued-42');
});

test('register route validates the title and never allows a caller to override the confirmed product, fee or backdated choice', async () => {
  const provider = await orderFixture().run();
  const valid = await routeFixture(provider, { requestBody: { titleNumber: ' ngl 813653 ', expectedPrice: 100, requestedOfficialCopyCode: '30', officialCopyTypeCode: '20', allowBackdated: true } }).run();
  assert.equal(valid.orderOptions.titleNumber, 'NGL813653');
  assert.equal(valid.orderOptions.expectedPrice, 7);
  assert.equal(valid.orderOptions.requestedOfficialCopyCode, undefined);
  assert.equal(valid.orderOptions.officialCopyTypeCode, undefined);
  assert.equal(valid.orderOptions.allowBackdated, undefined);
  const invalid = await routeFixture(provider, { requestBody: { titleNumber: '../../other' } }).run();
  assert.equal(invalid.status, 400);
  assert.equal(invalid.orderOptions, undefined);
});

test('certificate status explicitly leaves account verification unchecked without attempting credentials', async () => {
  let handler, body;
  evaluate(route(file, 'get', '/api/lr-bg/status'), {
    app: { get: (_url, _auth, callback) => { handler = callback; } }, requireAuth() {},
    bgConnectivity: async () => ({ ok: true, env: 'live', status: 200 }),
    bgCredentials: () => ({ username: 'test', password: 'test' }), bgOfficialCopyPath: () => '/official-copy', bgKeyFingerprints: () => ({}),
  });
  await handler({}, { json(value) { body = value; } });
  assert.equal(body.certificateConnection, true);
  assert.equal(body.credentialsVerification, 'not_checked');
  assert.match(body.note, /ordering have not been verified/);
});

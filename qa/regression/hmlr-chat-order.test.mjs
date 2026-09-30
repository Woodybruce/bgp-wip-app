import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const branch = find('server/chatbgp.ts', (n, ast) => ts.isIfStatement(n) && n.expression.getText(ast) === 'fnName === "order_hmlr_official_copy"');

function fixture(overrides = {}) {
  const calls = [], pdfs = [];
  const availability = { ok: true, authentication: 'verified', status: 200, titleStatus: 'VALID', registerAvailability: 'IMMEDIATE', registerBackdated: false };
  const result = { ok: true, outcome: 'delivered', status: 200, requestMessageId: 'request-1', summary: { actualPrice: '7', reference: 'hmlr-1' }, document: { base64: Buffer.from('register').toString('base64') } };
  const bg = {
    ocStorageKey: title => `lr-bg/${title}-OC1-Register.pdf`,
    bgOfficialCopyAvailability: async title => { calls.push(['check', title]); return overrides.availability ?? availability; },
    officialCopyByTitle: async opts => { calls.push(['order', opts]); if (overrides.orderError) throw new Error('timeout'); return overrides.result ?? result; },
    persistOfficialCopy: async opts => { calls.push(['save', opts]); if (overrides.saveError) throw new Error('disk failure'); },
  };
  class PDFParse {
    constructor(options) { assert.ok(options.data instanceof Uint8Array, 'Pass PDF bytes as data in LoadParameters'); pdfs.push(this); }
    async getText() { if (overrides.pdfError) throw new Error('Unreadable PDF'); return { pages: [{ text: 'Proprietor: Example Ltd' }, { text: 'Charge: Example Bank' }] }; }
    async destroy() { this.destroyed = true; }
  }
  const modules = {
    './business-gateway': bg,
    './file-storage': { getFile: async key => { calls.push(['cached', key]); if (overrides.storageError) throw new Error('storage unavailable'); return overrides.cached ?? null; } },
    'pdf-parse': overrides.pdfModule ?? { PDFParse },
  };
  const { handle } = evaluate(`export async function handle(fnArgs: any, req: any) { const fnName = "order_hmlr_official_copy"; ${branch} }`, {
    Uint8Array, require(name) { assert.ok(name in modules, `Unexpected module ${name}`); return modules[name]; },
  });
  return { calls, pdfs, async run(args = {}) { return (await handle({ title_number: ' ngl813653 ', ...args }, { session: { userId: 'staff-1' } })).data; } };
}

const failedAvailabilityChecks = [
  { ok: false, status: 403, authentication: 'forbidden', error: 'Incorrect user role or organisation is not permitted', code: 'BG40005' },
  { ok: false, status: 401, authentication: 'rejected', error: 'Unauthorised', code: 'BG40004' },
  { ok: false, authentication: 'unverified', error: 'Business Gateway request timed out' },
];

test('failed availability checks remain read-only even when confirmation and reorder are supplied', async () => {
  for (const availability of failedAvailabilityChecks) {
    const f = fixture({ availability });
    const out = await f.run({ check_only: true, confirmed: true, reorder: true });
    assert.equal(out.success, false);
    assert.equal(out.outcome, 'availability_check_failed');
    assert.equal(out.orderSubmitted, false);
    assert.equal(out.availability.error, availability.error);
    assert.equal(out.availability.status, availability.status);
    assert.match(out.note, /REST document-availability check failed/);
    assert.match(out.note, /does not establish whether the separate SOAP ordering service/);
    assert.deepEqual(f.calls.map(c => c[0]), ['check']);
  }
});

test('failed availability checks require explicit fee confirmation and an endpoint-specific warning', async () => {
  for (const availability of failedAvailabilityChecks) {
    for (const confirmed of [undefined, false, 'true']) {
      const f = fixture({ availability });
      const out = await f.run({ confirmed });
      assert.equal(out.needsConfirmation, true);
      assert.equal(out.orderSubmitted, false);
      assert.equal(out.availability.error, availability.error);
      assert.match(out.fee, /£7 maximum/);
      assert.match(out.warning, /REST document-availability check failed/);
      assert.match(out.note, /Explain this warning before asking for confirmation/);
      assert.match(out.note, /Do not diagnose a bad password or require an administrator change from this check alone/);
      assert.deepEqual(f.calls.map(c => c[0]), ['cached', 'check']);
    }
  }
});

test('an explicitly confirmed SOAP order can deliver despite a separate availability service failure', async () => {
  for (const availability of failedAvailabilityChecks) {
    const f = fixture({ availability });
    const out = await f.run({ confirmed: true });
    assert.equal(out.outcome, 'delivered');
    assert.equal(out.registerUrl, '/api/lr-bg/register/NGL813653');
    assert.deepEqual(f.calls.map(c => c[0]), ['cached', 'check', 'order', 'save']);
    assert.equal(f.calls.find(c => c[0] === 'order')[1].expectedPrice, 7);
  }
});

test('after a REST 403, an explicitly confirmed order reports the actual SOAP rejection without retrying', async () => {
  const result = { ok: false, outcome: 'rejected', status: 500, requestMessageId: 'soap-rejected-1', summary: { fault: 'Login details are invalid.', code: 'soap:Client' }, document: null };
  const f = fixture({ availability: failedAvailabilityChecks[0], result });
  const out = await f.run({ confirmed: true });
  assert.equal(out.outcome, 'rejected');
  assert.equal(out.status, 500);
  assert.equal(out.fault, result.summary.fault);
  assert.equal(out.requestMessageId, 'soap-rejected-1');
  assert.equal(out.registerUrl, undefined);
  assert.match(out.note, /Do not retry automatically/);
  assert.deepEqual(f.calls.map(c => c[0]), ['cached', 'check', 'order']);
});

test('missing local gateway configuration still blocks a confirmed order', async () => {
  const f = fixture({ availability: { ok: false, authentication: 'not_configured', error: 'Certificate or credentials missing' } });
  const out = await f.run({ confirmed: true });
  assert.equal(out.outcome, 'preflight_blocked');
  assert.equal(out.orderSubmitted, false);
  assert.match(out.note, /not configured/);
  assert.deepEqual(f.calls.map(c => c[0]), ['cached', 'check']);
});

test('read-only access check never orders, even with confirmed true and reorder true', async () => {
  const f = fixture();
  const out = await f.run({ check_only: true, confirmed: true, reorder: true });
  assert.equal(out.outcome, 'availability_checked');
  assert.equal(out.orderSubmitted, false);
  assert.deepEqual(f.calls.map(c => c[0]), ['check']);
});

test('fresh copies require explicit boolean confirmation after the free check', async () => {
  for (const confirmed of [undefined, false, 'true']) {
    const f = fixture();
    const out = await f.run({ confirmed });
    assert.equal(out.needsConfirmation, true);
    assert.match(out.fee, /£7 maximum/);
    assert.equal(f.calls.some(c => c[0] === 'order'), false);
  }
});

test('stored registers remain readable without HMLR access or any new purchase', async () => {
  const f = fixture({ cached: { data: Buffer.from('cached-pdf') } });
  const out = await f.run();
  assert.equal(out.success, true);
  assert.match(out.registerText, /Example Bank/);
  assert.match(out.note, /\[Download official register\]\(\/api\/lr-bg\/register\/NGL813653\)/);
  assert.deepEqual(f.calls.map(c => c[0]), ['cached']);
  assert.equal(f.pdfs[0].destroyed, true);
});

test('a failed cache read cannot silently cause a duplicate purchase', async () => {
  const f = fixture({ storageError: true });
  const out = await f.run({ confirmed: true });
  assert.equal(out.outcome, 'storage_unavailable');
  assert.deepEqual(f.calls.map(c => c[0]), ['cached']);
});

test('a confirmed purchase caps the fee and returns a link only after saving', async () => {
  const f = fixture();
  const out = await f.run({ confirmed: true });
  assert.equal(out.outcome, 'delivered');
  assert.equal(f.calls.find(c => c[0] === 'order')[1].expectedPrice, 7);
  assert.equal(f.calls.find(c => c[0] === 'save')[1].userId, 'staff-1');
  assert.equal(out.registerUrl, '/api/lr-bg/register/NGL813653');
  assert.match(out.registerText, /Proprietor/);
  assert.equal(f.pdfs[0].destroyed, true);
});

test('pending acknowledgements retain reference and do not claim a saved copy or no charge', async () => {
  const f = fixture({ result: { ok: false, outcome: 'pending', status: 200, requestMessageId: 'request-p', summary: { reference: 'pending-1', expectedResponseDateTime: '2026-10-01T12:00:00' }, document: null } });
  const out = await f.run({ confirmed: true });
  assert.equal(out.outcome, 'pending');
  assert.equal(out.summary.reference, 'pending-1');
  assert.equal(out.requestMessageId, 'request-p');
  assert.match(out.note, /Do not order it again/);
  assert.equal(out.registerUrl, undefined);
  assert.equal(f.calls.some(c => c[0] === 'save'), false);
});

test('failed persistence never returns a fabricated saved-register link', async () => {
  const f = fixture({ saveError: true });
  const out = await f.run({ confirmed: true });
  assert.equal(out.outcome, 'received_not_saved');
  assert.equal(out.success, false);
  assert.equal(out.registerUrl, undefined);
  assert.equal(out.reference, 'hmlr-1');
});

test('transport failure keeps billing/order outcome unknown', async () => {
  const f = fixture({ orderError: true });
  const out = await f.run({ confirmed: true });
  assert.equal(out.outcome, 'unknown');
  assert.match(out.note, /HMLR may have received it/);
  assert.equal(f.calls.filter(c => c[0] === 'order').length, 1);
});

test('unreadable PDF keeps the saved download and frees parser resources', async () => {
  const f = fixture({ pdfError: true });
  const out = await f.run({ confirmed: true });
  assert.equal(out.success, true);
  assert.equal(out.registerText, null);
  assert.match(out.note, /could not be read automatically/);
  assert.ok(out.registerUrl);
  assert.equal(f.pdfs[0].destroyed, true);
});

test('invalid title input causes no storage access or network operation', async () => {
  const f = fixture();
  const out = await f.run({ title_number: '../secret', confirmed: true });
  assert.match(out.error, /doesn't look like a title/);
  assert.deepEqual(f.calls, []);
});

test('real PDF bytes are extracted through the installed pdf-parse API', async () => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const pdfModule = await import('pdf-parse');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Test register proprietor: Example Property Limited', { x: 50, y: 600, font });
  const f = fixture({ cached: { data: Buffer.from(await pdf.save()) }, pdfModule });
  const out = await f.run();
  assert.match(out.registerText, /Example Property Limited/);
});

test('gateway transport uncertainty preserves the recovery ID without implying rejection', async () => {
  const f = fixture({ result: { ok: false, outcome: 'unknown', status: 0, requestMessageId: 'recover-1', summary: { message: 'Timed out' }, document: null } });
  const out = await f.run({ confirmed: true });
  assert.equal(out.outcome, 'unknown');
  assert.equal(out.requestMessageId, 'recover-1');
  assert.match(out.note, /HMLR may have received it/);
  assert.equal(out.registerUrl, undefined);
});

test('closed or unavailable title never becomes a paid order; continuation is retained', async () => {
  const f = fixture({ availability: { ok: true, authentication: 'verified', status: 200, titleStatus: 'CLOSED_AND_CONTINUED', registerAvailability: 'UNAVAILABLE', continuedUnderTitleNumber: 'GR519469' } });
  const out = await f.run({ confirmed: true });
  assert.equal(out.outcome, 'register_unavailable');
  assert.equal(out.orderSubmitted, false);
  assert.equal(out.availability.continuedUnderTitleNumber, 'GR519469');
  assert.equal(f.calls.some(c => c[0] === 'order'), false);
});

test('missing availability fields and backdated editions require review before a purchase', async () => {
  for (const availability of [
    { ok: true, authentication: 'verified', status: 200 },
    { ok: true, authentication: 'verified', status: 200, registerAvailability: 'IMMEDIATE', registerBackdated: true },
  ]) {
    const f = fixture({ availability });
    assert.equal((await f.run({ confirmed: true })).outcome, 'register_unavailable');
    assert.equal(f.calls.some(c => c[0] === 'order'), false);
  }
});

test('read-only check can explain a closed title without purchasing or requiring confirmation', async () => {
  const f = fixture({ availability: { ok: true, authentication: 'verified', status: 200, titleStatus: 'CLOSED', registerAvailability: 'UNAVAILABLE' } });
  const out = await f.run({ check_only: true });
  assert.equal(out.outcome, 'availability_checked');
  assert.equal(out.availability.titleStatus, 'CLOSED');
  assert.deepEqual(f.calls.map(c => c[0]), ['check']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, evaluate } = require('./source-harness.cjs');
const { verifyHmlrChatDelivery, shouldBufferHmlrDelivery } = evaluate(source('server/hmlr-chat-delivery-guard.ts'), { URL });
const pdf = Buffer.from('%PDF-1.7\nRegister\n%%EOF');
const title = 'NGL813653';
const canonical = `/api/lr-bg/register/${title}`;
const invented = `/api/file-storage/hmlr-orders/e6d48494-3e6b-43b6-b86c-cab95ca211f1-${title}-OC1.pdf`;
const messages = [{ role: 'assistant', content: `Order the HMLR official copy for ${title} at £7?` }, { role: 'user', content: 'Order it' }];
const success = { titleNumber: title, success: true, outcome: 'delivered', requestMessageId: 'real-request' };

function fixture({ stored = {}, receipts = [], storageError = false } = {}) {
  const reads = [];
  return {
    reads,
    run: (reply, context = messages) => verifyHmlrChatDelivery(reply, { messages: context, receipts, readStoredFile: async key => {
      reads.push(key);
      if (storageError) throw new Error('Database unavailable');
      return stored[key] ? { data: stored[key] } : null;
    } }),
  };
}

test('the actual zero-tool fabricated order and file URL cannot be delivered', async () => {
  const f = fixture();
  const out = await f.run(`Ordered — **${title}**.\n- **File:** [Download the Official Copy register (PDF)](${invented})\n- **Status:** Delivered\n- **Pages:** 16\n- **Also saved to SharePoint:** Investment/LandReg/${title}`);
  assert.equal(out.verification, 'blocked');
  assert.equal(out.reason, 'unconfirmed_order');
  assert.doesNotMatch(out.reply, /file-storage|Status:|Pages:|SharePoint/);
  assert.match(out.reply, /cannot confirm delivery/);
  assert.match(out.reply, /before placing another paid order/);
  assert.equal(f.reads.length, 0);
});

test('a delivered claim with a dead fabricated URL is blocked without a new-order phrase', async () => {
  const f = fixture();
  const out = await f.run(`The PDF for ${title} is real and delivered — [download it here](${invented}).`);
  assert.equal(out.verification, 'blocked');
  assert.equal(out.reason, 'missing_pdf');
  assert.doesNotMatch(out.reply, /file-storage|real and delivered/);
  assert.deepEqual(f.reads, [`lr-bg/${title}-OC1-Register.pdf`]);
});

test('an existing genuine PDF can be linked without purchasing or a new receipt', async () => {
  const f = fixture({ stored: { [`lr-bg/${title}-OC1-Register.pdf`]: pdf } });
  const reply = `Here is the saved register: [Download official register](${canonical}).`;
  const out = await f.run(reply);
  assert.equal(out.verification, 'verified');
  assert.equal(out.reply, reply);
  assert.equal(out.changed, false);
  assert.deepEqual(f.reads, [`lr-bg/${title}-OC1-Register.pdf`]);
});

test('a historical invented route is replaced only when the canonical PDF actually exists', async () => {
  const f = fixture({ stored: { [`lr-bg/${title}-OC1-Register.pdf`]: pdf } });
  const out = await f.run(`[Download official register](${invented})`);
  assert.equal(out.verification, 'verified');
  assert.equal(out.reply, `[Download official register](${canonical})`);
  assert.equal(out.changed, true);
});

test('HTML stored under a PDF name is not a verified register', async () => {
  const f = fixture({ stored: { [`lr-bg/${title}-OC1-Register.pdf`]: Buffer.from('<html>Error</html>') } });
  const out = await f.run(`Status: Delivered\n[Download](${canonical})`);
  assert.equal(out.verification, 'blocked');
  assert.equal(out.reason, 'missing_pdf');
  assert.doesNotMatch(out.reply, /\[Download\]/);
});

test('quoted historical claims, code samples and honest error discussions are untouched', async () => {
  const samples = [
    'Earlier I said "Ordered — delivered", but that was wrong. The register was not delivered.',
    'HMLR rejected the order. No register was delivered.',
    '> Ordered — delivered\n\nThat earlier statement was wrong.',
    `Example URL: \`${invented}\`. Do not invent this route.`,
    `\`\`\`text\nOrdered — delivered\n${invented}\n\`\`\``,
    'Can the official register be delivered after login is fixed?',
  ];
  for (const reply of samples) {
    const f = fixture();
    const out = await f.run(reply);
    assert.equal(out.verification, 'not_applicable', reply);
    assert.equal(out.reply, reply);
    assert.equal(f.reads.length, 0);
  }
});

test('error explanations retain their useful text while a dead clickable link is removed', async () => {
  const f = fixture();
  const out = await f.run(`My earlier [Download](${invented}) link was wrong. HMLR rejected the login.`);
  assert.equal(out.verification, 'blocked');
  assert.match(out.reply, /HMLR rejected the login/);
  assert.match(out.reply, /Download \(unavailable\)/);
  assert.doesNotMatch(out.reply, /\/api\/file-storage/);
});

test('a current provider rejection overrides a fabricated fresh delivery claim even with an older PDF', async () => {
  const f = fixture({ stored: { [`lr-bg/${title}-OC1-Register.pdf`]: pdf }, receipts: [
    success,
    { titleNumber: title, success: false, outcome: 'rejected', fault: 'Login details are invalid.', requestMessageId: 'actual-failure-reference' },
  ] });
  const out = await f.run(`Ordered — ${title}.\nStatus: Delivered\n[Download](${canonical})`);
  assert.equal(out.reason, 'provider_failure');
  assert.match(out.reply, /Login details are invalid/);
  assert.match(out.reply, /actual-failure-reference/);
  assert.doesNotMatch(out.reply, /\[Download\]/);
  assert.equal(f.reads.length, 0);
});

test('successful current receipt plus saved PDF supports the actual new-order claim', async () => {
  const f = fixture({ stored: { [`lr-bg/${title}-OC1-Register.pdf`]: pdf }, receipts: [success] });
  const reply = `Ordered — ${title}.\nStatus: Delivered\n[Download](${canonical})`;
  const out = await f.run(reply);
  assert.equal(out.verification, 'verified');
  assert.equal(out.reply, reply);
});

test('a receipt alone cannot make an unavailable download link usable', async () => {
  const f = fixture({ receipts: [success] });
  const out = await f.run(`Ordered — ${title}.\n[Download](${canonical})`);
  assert.equal(out.reason, 'missing_pdf');
  assert.doesNotMatch(out.reply, /\[Download\]/);
});

test('a stored historical PDF cannot prove that a fresh order happened', async () => {
  const f = fixture({ stored: { [`lr-bg/${title}-OC1-Register.pdf`]: pdf } });
  const out = await f.run(`I've ordered the official register for ${title}. [Download](${canonical})`);
  assert.equal(out.reason, 'unconfirmed_order');
});

test('storage failures remain uncertainty and do not imply an absent file or no charge', async () => {
  const f = fixture({ storageError: true });
  const out = await f.run(`The register is delivered. [Download](${canonical})`);
  assert.equal(out.reason, 'storage_unavailable');
  assert.match(out.reply, /saved-file check could not be completed/);
  assert.doesNotMatch(out.reply, /No verified saved PDF|nothing was charged/);
});

test('encoded canonical URLs are normalised and unsafe path traversal is never queried', async () => {
  const f = fixture({ stored: { [`lr-bg/${title}-OC1-Register.pdf`]: pdf } });
  const ok = await f.run('[Download](https://chatbgp.app/api/lr-bg/register/%4EGL813653)');
  assert.equal(ok.reply, `[Download](${canonical})`);
  const invalid = await fixture().run('[Download](/api/file-storage/hmlr-orders/../../secrets.pdf)');
  assert.equal(invalid.verification, 'blocked');
});

test('streaming is buffered for short follow-ups to HMLR turns, but ordinary app chat is unaffected', () => {
  assert.equal(shouldBufferHmlrDelivery(messages), true);
  assert.equal(shouldBufferHmlrDelivery([{ role: 'user', content: [{ type: 'text', text: 'Get the official copy' }] }]), true);
  assert.equal(shouldBufferHmlrDelivery([{ role: 'user', content: 'Show active leasing deals' }]), false);
  assert.equal(shouldBufferHmlrDelivery([...messages, ...Array.from({ length: 6 }, () => ({ role: 'user', content: 'Discuss a separate project' }))]), false);
});

test('non-HMLR document delivery is outside this guard', async () => {
  const f = fixture();
  const reply = 'I have saved the report. [Download](/api/chat-media/report.pdf)';
  const out = await f.run(reply, [{ role: 'user', content: 'Generate a report' }]);
  assert.equal(out.verification, 'not_applicable');
  assert.equal(out.reply, reply);
  assert.equal(f.reads.length, 0);
});

test('prior HMLR context does not block saving a separate presentation PDF', async () => {
  for (const reply of [
    "I've saved the presentation PDF. [Download](/api/chat-media/presentation.pdf)",
    "HMLR is unavailable. I've saved the presentation PDF. [Download](/api/chat-media/presentation.pdf)",
    'The presentation PDF has been saved. [Download](/api/chat-media/presentation.pdf)',
  ]) {
    const f = fixture();
    const out = await f.run(reply, [...messages, { role: 'user', content: 'Now create a separate presentation PDF' }]);
    assert.equal(out.verification, 'not_applicable');
    assert.equal(out.reply, reply);
    assert.equal(f.reads.length, 0);
  }
});

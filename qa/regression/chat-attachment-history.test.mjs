import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const helper = find('client/src/lib/chat-attachments.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'messageContentWithAttachments');
const { messageContentWithAttachments } = evaluate(helper);
const imageLinks = content => [...content.matchAll(/!\[([^\]]*)\]\((\/api\/chat-media\/[^)]+)\)/g)].map(m => m[2]);
const fileLinks = content => [...content.matchAll(/(?<!!)\[([^\]]*)\]\((\/api\/chat-media\/[^)]+)\)/g)].map(m => m[2]);
const attachment = (url, name = 'image.png', type = 'image/png') => JSON.stringify({ url, name, type, size: 1234 });

for (const component of ['mobile-app', 'chat-panel']) {
  const mapping = find(`client/src/components/${component}.tsx`, n => ts.isVariableDeclaration(n) && n.name.getText() === 'plainMessages');
  const { serialize } = evaluate(`export function serialize(newMessages: any[]) { const ${mapping}; return plainMessages; }`, { messageContentWithAttachments });

  test(`${component}: text-only follow-up retains earlier screenshots as vision references after reloading`, () => {
    const first = '/api/chat-media/1-first.png';
    const second = '/api/chat-media/2-second.jpg';
    // The DB saves the user's text and attachment JSON separately. No File
    // objects survive a reload, so the later request uses this saved history.
    const messages = JSON.parse(JSON.stringify([
      { role: 'user', content: 'See this error', attachments: [attachment(first)] },
      { role: 'assistant', content: 'I will check it.' },
      { role: 'user', content: 'And the next screen', attachments: [attachment(second, 'phone.jpg', 'image/jpeg')] },
      { role: 'user', content: 'What do those screenshots mean?' },
    ]));
    const out = serialize(messages);
    assert.equal(out.length, 4);
    assert.deepEqual(imageLinks(out[0].content), [first]);
    assert.deepEqual(imageLinks(out[1].content), []);
    assert.deepEqual(imageLinks(out[2].content), [second]);
    assert.equal(out[3].content, messages[3].content);
    assert.deepEqual(out.map(m => m.role).join(','), 'user,assistant,user,user');
    assert.equal(messages[0].content, 'See this error', 'Do not mutate the stored user message');
  });

  test(`${component}: mixed attachments retain file order and distinguish documents from photos`, () => {
    const image = '/api/chat-media/3-screenshot.png';
    const document = '/api/chat-media/4-register.pdf';
    const out = serialize([{ role: 'user', content: 'Compare these', attachments: [
      attachment(image), attachment(document, 'Official register.pdf', 'application/pdf'),
    ] }]);
    assert.deepEqual(imageLinks(out[0].content), [image]);
    assert.deepEqual(fileLinks(out[0].content), [document]);
    assert.ok(out[0].content.indexOf(image) < out[0].content.indexOf(document));
  });
}

test('legacy stored image paths are recognized without inventing an upload for bare filenames', () => {
  const url = '/api/chat-media/old-screenshot.PNG';
  const content = messageContentWithAttachments('Older message', [url, 'image.png']);
  assert.deepEqual(imageLinks(content), [url]);
  assert.match(content, /\nimage\.png$/);
  assert.doesNotMatch(content, /\/api\/chat-media\/image\.png/);
});

test('image MIME metadata supports extensionless storage URLs and labels with brackets', () => {
  const url = '/api/chat-media/opaque-image';
  const content = messageContentWithAttachments('See attached', [attachment(url, 'Screen [2]\ncopy.png')]);
  assert.deepEqual(imageLinks(content), [url]);
  assert.match(content, /Screen \(2\) copy\.png/);
});

test('external references are retained as text without creating new vision fetches', () => {
  const url = 'https://example.test/private-screenshot.png';
  const content = messageContentWithAttachments('See attached', [attachment(url)]);
  assert.ok(content.endsWith(url));
  assert.deepEqual(imageLinks(content), []);
  assert.doesNotMatch(content, /!\[/);
});

test('messages without attachments remain unchanged', () => {
  for (const attachments of [undefined, null, []]) {
    assert.equal(messageContentWithAttachments('What happened?', attachments), 'What happened?');
  }
});

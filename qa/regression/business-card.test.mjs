import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://unused@localhost/unused';
const cards = await import('../../server/business-cards.ts');

const card = {
  userId: 'u1', slug: 'woody-bruce', enabled: true, name: 'Woody Bruce', title: 'Managing Director',
  mobile: '+44 (0)7980 313 675', email: 'woody@brucegillinghampollard.com', linkedin: 'https://www.linkedin.com/in/example',
  photoUrl: 'https://chatbgp.app/card/woody-bruce/photo', specialisms: [], url: 'https://chatbgp.app/card/woody-bruce',
};

test('vCard carries name, firm, mobile without the (0), office and the card link', () => {
  const v = cards.vcardFor(card);
  assert.match(v, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
  assert.match(v, /\r\nN:Bruce;Woody;;;\r\n/);
  assert.match(v, /\r\nORG:Bruce Gillingham Pollard\r\n/);
  assert.match(v, /TEL;TYPE=CELL,VOICE:\+44 7980 313 675/);
  assert.match(v, /EMAIL;TYPE=INTERNET,WORK:woody@brucegillinghampollard\.com/);
  assert.match(v, /NOTE:Card: https:\/\/chatbgp\.app\/card\/woody-bruce/);
  assert.match(v, /END:VCARD\r\n$/);
});

test('signature is table-based with the real wordmark, a Save my contact link and escaped text', () => {
  const html = cards.signatureHtml({ ...card, name: 'A <b>& B' });
  assert.match(html, /^<table/);
  assert.match(html, /BGP_BlackWordmark_trimmed\.png/);
  assert.match(html, /href="https:\/\/chatbgp\.app\/card\/woody-bruce"[^>]*>Save my contact</);
  assert.match(html, /href="tel:\+447980313675"/);
  assert.match(html, /A &lt;b&gt;&amp; B/);
  assert.doesNotMatch(html, /<b>&/);
});

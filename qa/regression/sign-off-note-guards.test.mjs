// The sign-off note for a listed company, written from the file (Woody, 24
// November 2026: "Yes do the sign off note"). Source guards: the note is
// worked out on the server from the file, never taken from the request; it is
// kept with the approval; it never stands in for the person's own note when
// the client checks are not finished; and both Sign off boxes show it.
// Rules: server/sign-off-note.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const aml = read('server/deal-party-aml.ts');
const client = read('server/client-kyc.ts');

test('the note is worked out on the server, only for a company with no red flag on the full checks', () => {
  assert.match(aml, /const fileNote = await fileNoteFor\(party, \{ kind, trust, flags: partyFlags, unread: \(flags\?\.unchecked \|\| \[\]\)\.length > 0, people, requests, mainFinished \}\)\.catch\(\(\) => null\);/);
  assert.match(aml, /if \(f\.kind !== "company" \|\| f\.trust \|\| f\.unread \|\| f\.flags > 0 \|\| party\.regime !== "full" \|\| !f\.people\) return null;/);
  assert.match(aml, /const stored = await latestPrecheck\(party\.brandId, party\.entityId\)\.catch\(\(\) => null\);/);
  assert.match(aml, /fileNote: facts\.fileNote \?\? null,/, 'signOffView hands it to the screens');
  for (const src of [aml, client]) assert.doesNotMatch(src, /req\.body\?\.fileNote|req\.body\.fileNote/, 'never from the request');
});

test('it is kept with the approval and never counts as the person\'s own note', () => {
  assert.match(aml, /const denial = signOffDenial\(\{ \.\.\.facts, note \}\);/);
  assert.match(aml, /const note = typed \|\| \(sddNote \?/, 'the note checked is the typed one (or the saved SDD note)');
  assert.match(aml, /\$\{facts\.fileNote \? `\. Written from the file: \$\{facts\.fileNote\}` : ""\}/);
  assert.match(aml, /fileNote: facts\.fileNote \|\| null, level, regime: party\.regime/);
  assert.match(client, /const note = text\(req\.body\?\.note\)\.slice\(0, 1000\);\s*const denial = signOffDenial\(\{ \.\.\.facts, note \}\);/);
  assert.match(client, /\$\{facts\.fileNote \? `\. Written from the file: \$\{facts\.fileNote\}` : ""\}/);
  assert.match(client, /fileNote: facts\.fileNote \|\| null, level, regime: subject\.regime/);
});

test('both Sign off boxes show it', () => {
  const box = read('client/src/components/deal-party-aml.tsx');
  assert.match(box, /data-testid=\{`aml-sign-off-file-note-\$\{role\}`\}/);
  assert.equal((box.match(/fileNote=\{view\??\.fileNote \|\| null\}/g) || []).length, 2, 'from the Sign-off step and from the Next line');
  assert.match(read('client/src/components/client-kyc/client-kyc-dialog.tsx'), /data-testid="client-kyc-sign-off-file-note"/);
});

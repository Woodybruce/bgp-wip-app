import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A property's ONE shared conversation (Woody, 2026-11-14): Letting Tracker
// comments go into it, everyone who can open the property reads it.
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const record = read('server/record-conversation.ts');
const routes = read('server/routes.ts');

test('joining checks the property before anything is made or joined', () => {
  const join = record.slice(record.indexOf('router.post("/api/chat/threads/record/property/:propertyId"'));
  assert.ok(join.indexOf('propertyReadBlocked(req, propertyId)') > 0);
  assert.ok(join.indexOf('propertyReadBlocked(req, propertyId)') < join.indexOf('sharedPropertyThreadId(propertyId)'));
  assert.ok(join.indexOf('sharedPropertyThreadId(propertyId)') < join.indexOf('storage.addChatThreadMember'), 'members go through the one door');
});

test('the counts read only properties the caller may open', () => {
  const counts = record.slice(record.indexOf('router.get("/api/chat/threads/record/unit-comments"'));
  assert.match(counts, /for \(const id of asked\) if \(!\(await propertyReadBlocked\(req, id\)\)\) allowed\.push\(id\);/);
  assert.match(counts, /t\.linked_id = ANY\(\$2::text\[\]\)/);
  assert.match(counts, /\[RECORD_THREAD_CREATOR, allowed\]/);
});

test('the shared thread belongs to nobody, so nobody owns or deletes it', () => {
  assert.match(record, /export const RECORD_THREAD_CREATOR = "__record__";/);
  assert.match(record, /VALUES \(\$1, \$2, \$3, \$4, 'property', \$3, \$4, false, false\)/, 'never a ChatBGP member for good');
});

test('posting there is quiet, ChatBGP answers only by name, and a tag pulls in BGP staff only', () => {
  const post = routes.slice(routes.indexOf('app.post("/api/chat/threads/:id/messages"'), routes.indexOf('app.post("/api/chat/threads/:id/messages"') + 12000);
  assert.match(post, /if \(sharedRecord && !\(await mayBeTaggedIntoRecordThread\(uid\)\)\) continue;/);
  assert.match(post, /if \(sharedRecord && !mentionedIds\.includes\(m\.userId\)\) continue;/);
  assert.match(post, /if \(sharedRecord\) \{\s+if \(askedByName && !thread\.isAiChat\) \{/);
  assert.match(post, /\} else if \(!thread\.hasAiMember && !thread\.isAiChat && askedByName\) \{/);
  assert.match(post, /if \(!sharedRecord && thread\.hasAiMember && !thread\.isAiChat\) \{/);
});

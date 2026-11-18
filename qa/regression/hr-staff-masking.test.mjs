// The People & HR staff list (GET /api/hr/staff) masks each colleague's
// personal-tier fields exactly as one person's record (GET
// /api/hr/staff/:userId) does: only an admin or the person themselves is sent
// them. Until 16 November 2026 the list masked only DOB and address, so every
// signed-in login was sent each colleague's salary, emergency contact,
// holiday allowance, pension and contract / passport links.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { route } = require('./source-harness.cjs');

const FILE = 'server/hr-routes.ts';
const list = route(FILE, 'get', '/api/hr/staff');
const person = route(FILE, 'get', '/api/hr/staff/:userId');
const queries = text => [...text.matchAll(/pool\.query\(`([\s\S]*?)`/g)].map(m => m[1]);
const [listQuery, listFallback] = queries(list);
const [personQuery] = queries(person);

const masked = (sql, rule) => {
  const pattern = new RegExp(`CASE WHEN ${rule.replace(/[$.]/g, '\\$&')} THEN\\s+(?:sp\\.\\w+|\\(SELECT[\\s\\S]*?\\))\\s+ELSE NULL END AS (\\w+)`, 'g');
  return new Set([...sql.matchAll(pattern)].map(m => m[1]));
};
const OWN_OR_ADMIN = '$2::boolean OR u.id = $1';
const listMasked = masked(listQuery, OWN_OR_ADMIN);
const personMasked = masked(personQuery, '$2::boolean');

test('the list masks every field one person\'s record masks, for anyone but an admin or the person', () => {
  assert.ok(personMasked.size >= 13, `person record masks ${[...personMasked]}`);
  assert.deepEqual([...listMasked].sort(), [...personMasked].sort());
  for (const field of ['salary_current', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation',
    'holiday_entitlement', 'holiday_used', 'holiday_pending', 'pension_opt_in', 'pension_rate',
    'contract_sharepoint_url', 'passport_sharepoint_url', 'dob', 'address']) {
    assert.ok(listMasked.has(field), `${field} is not masked on the list`);
  }
});

test('no masked field is also selected bare on the list, in its query or its fallback', () => {
  const outsideMasks = listQuery.replace(/CASE WHEN[\s\S]*?ELSE NULL END AS \w+/g, '');
  for (const field of listMasked) {
    assert.doesNotMatch(outsideMasks, new RegExp(`\\bsp\\.${field}\\b`), `sp.${field} selected unmasked`);
    assert.doesNotMatch(outsideMasks, new RegExp(`\\bAS ${field}\\b`), `${field} selected unmasked`);
    assert.doesNotMatch(listFallback, new RegExp(`\\b${field}\\b`), `${field} in the fallback list`);
  }
});

test('the caller and the admin flag are what the masks read', () => {
  assert.match(list, /\[myId, isAdmin\]\);/);
  assert.match(list, /const \{ userId: myId, isAdmin \} = await getActor\(req\);/);
});

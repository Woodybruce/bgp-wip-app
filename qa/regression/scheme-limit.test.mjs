import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { landsecLoginSchemes } from '../../shared/landsec.ts';
import { runWithSchemeLimit, currentSchemeLimit, schemeLimitSql, inSchemeLimit } from '../../server/scheme-limit.ts';

// Woody, 2026-11-14: "log in for people from landsec with access only to their properties and the same
// for joint agents"; asked, "list or ALL" and "whole schemes".
test('a login sees the schemes ticked on it; none ticked = all, except a joint agent', () => {
  assert.equal(landsecLoginSchemes(null), null, 'a Landsec login with no role row sees every scheme');
  assert.equal(landsecLoginSchemes({ role: 'leasing_manager', schemes: [] }), null);
  assert.equal(landsecLoginSchemes({ role: 'asset_manager', schemes: null }), null);
  assert.deepEqual(landsecLoginSchemes({ role: 'leasing_manager', schemes: ['bluewater'] }), ['bluewater']);
  assert.deepEqual(landsecLoginSchemes({ role: 'asset_manager', schemes: ['bluewater', 'trinity'] }), ['bluewater', 'trinity']);
  assert.deepEqual(landsecLoginSchemes({ role: 'joint_agent', schemes: [] }), [], 'a joint agent with no scheme sees nothing');
});

test('the request-wide limit reaches the scope checks and the SQL helper, and nothing leaks outside it', async () => {
  assert.equal(currentSchemeLimit(), null);
  assert.equal(schemeLimitSql('p.id'), '');
  assert.equal(inSchemeLimit('anything'), true);
  await runWithSchemeLimit(new Set(['a1', "b'2"]), async () => {
    await Promise.resolve();
    assert.deepEqual([...currentSchemeLimit()], ['a1', "b'2"], 'the limit survives an await');
    assert.equal(inSchemeLimit('a1'), true);
    assert.equal(inSchemeLimit('zz'), false);
    assert.equal(inSchemeLimit(null), false);
    assert.equal(schemeLimitSql('p.id'), ` AND p.id = ANY('{"a1","b''2"}'::text[])`);
  });
  await runWithSchemeLimit(new Set(), async () => {
    assert.equal(schemeLimitSql('p.id'), ` AND p.id = ANY('{}'::text[])`, 'an empty limit matches nothing');
  });
  assert.equal(currentSchemeLimit(), null, 'the limit ends with the request');
});

test('the limit is set for every client request before the gateway, and fails closed', () => {
  const index = readFileSync(new URL('../../server/index.ts', import.meta.url), 'utf8');
  const at = index.indexOf('return runWithSchemeLimit(new Set(ids), () => next());');
  assert.ok(at > 0);
  assert.ok(at < index.indexOf('const landsecDecision = await restrictedLandsecApiDecision(req, resourcePath);'), 'set before the client gateway runs');
  assert.match(index, /try \{ ids = await schemeLimitedPropertyIds\(req\); \} catch \{ ids = \[\]; \}/, 'a failed read limits to nothing');
  const scope = readFileSync(new URL('../../server/company-scope.ts', import.meta.url), 'utf8');
  // A shared benchmark centre (2026-11-15) is the one thing answered ahead of the limit.
  assert.match(scope, /export async function isPropertyInScope\(scopeCompanyId: string, propertyId: string\): Promise<boolean> \{\n  if \(\(await sharedBenchmarkPropertyIds\(\)\)\.has\(propertyId\)\) return true;\n  const limit = currentSchemeLimit\(\);\n  if \(limit && !limit\.has\(propertyId\)\) return false;/);
  assert.match(scope, /export async function isDealInScope\([^)]*\): Promise<boolean> \{\n[^\n]*\n  const limit = currentSchemeLimit\(\);/);
});

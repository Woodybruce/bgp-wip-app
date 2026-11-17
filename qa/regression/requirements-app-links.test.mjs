// Requirements across the app, 17 November 2026. Woody: "check that the
// requirments function speaks properly to the whole app and it works
// properly". An audit of every link into the Requirements page and every
// reader of leasing requirements found dead links, a create form offered to
// client logins that cannot save it, and readers still treating any
// "status = Active" row as live. These guards hold the fixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, find, ts } = require('./source-harness.cjs');

test('the Requirements page opens a linked requirement and never offers a client the create form', () => {
  const page = source('client/src/pages/requirements.tsx');
  const table = find('client/src/pages/requirements.tsx', n => ts.isFunctionDeclaration(n) && n.name?.text === 'LeasingTable');
  assert.match(table, /requirementId\?: string \| null \}\)/);
  assert.match(table, /const linked = items\.find\(item => item\.id === requirementId\);/);
  assert.match(table, /\} else if \(clientShape\) \{\s*setSearch\(linked\.name \|\| ""\);\s*\} else \{\s*setEditItem\(linked\);/);
  assert.match(table, /\{createOpen && !clientShape && \(/);
  assert.match(page, /const requirementIdParam = urlParams\.get\("requirementId"\);/);
  assert.match(page, /initialList=\{listParam\} requirementId=\{requirementIdParam\} \/>/);
});

test('links into the page carry what the page reads', () => {
  const contacts = source('client/src/pages/contacts.tsx');
  assert.ok(!contacts.includes('/requirements?highlight='), 'the page never read ?highlight=');
  assert.match(contacts, /req\.requirementType === "investment" \? `\/investment\/requirements\?requirementId=\$\{encodeURIComponent\(req\.id\)\}` : `\/requirements\?requirementId=\$\{encodeURIComponent\(req\.id\)\}`/);
  // "Add a requirement" opens the form with the brand chosen.
  const panel = source('client/src/components/brand-profile-panel.tsx');
  const phone = source('client/src/components/mobile-brand-view.tsx');
  assert.match(panel, /href=\{`\/requirements\?companyId=\$\{c\.id\}&new=1`\} className=\{brandQuietLink\}>Add a requirement/);
  assert.equal([...phone.matchAll(/\/requirements\?companyId=\$\{c\.id\}&new=1`\}>Add a requirement/g)].length, 2);
  assert.ok(!/companyId=\$\{c\.id\}`\}[^>]*>Add a requirement/.test(panel + phone), 'no Add link without new=1');
  // The phone's suggestions alert keeps its list.
  assert.match(source('client/src/components/mobile-home.tsx'), /if \(a\.entityType === "requirement"\) return a\.href && a\.href\.startsWith\("\/requirements"\) \? a\.href : `\/requirements`;/);
  // Brand Gap offers Add requirement to BGP staff only.
  assert.match(source('client/src/components/brand-gap-panel.tsx'), /\{!noBrandPages && \(t\.requirement_note \|\| canWant\) && <Button/);
});

test('a client is never told a market listing is a BGP or live requirement', () => {
  const panel = source('client/src/components/brand-profile-panel.tsx');
  assert.equal([...panel.matchAll(/\{isClientViewer \? "Requirements" : "BGP requirements"\}/g)].length, 2);
  const phone = source('client/src/components/mobile-brand-view.tsx');
  assert.ok(!phone.includes('>Live requirements<'));
  assert.match(phone, /\{!isClientViewer && r\.state_label && <Badge/);
  assert.match(phone, /r\.state === "live" \? "border-l-emerald-400"/);
});

test('readers use the one live rule, never "status = Active"', () => {
  const plan = source('server/brand-scheme-plan.ts');
  const planQuery = plan.slice(plan.indexOf('/* brand-plan:requirements */'), plan.indexOf('/* brand-plan:actions */'));
  assert.match(planQuery, /\$\{requirementStateSql\("r"\)\} IN \('live', 'to_confirm'\)/);
  assert.doesNotMatch(planQuery, /status = 'Active'/);
  const kickoff = source('server/crm-kickoff.ts');
  assert.doesNotMatch(kickoff, /crm_requirements_leasing WHERE company_id=\$1 AND status='Active'/);
  assert.match(kickoff, /Requirement on file \(\$\{requirement\[0\]\.state === "live" \? "live" : "to confirm"\}\)/);
  const profile = source('server/brand-profile.ts');
  assert.ok(!profile.includes("IN ('', 'active')"), 'tenant rep agents come from live requirements');
  assert.match(profile, /THEN \$\{requirementStateSql\("q"\)\} IN \('live', 'to_confirm'\)/);
  assert.match(profile, /OR q\.company_id = \$2 OR \$\{requirementClientVisibleSql\("q"\)\}\)/);
});

test('ChatBGP sends investment requirements to Investment, not a view that is gone', () => {
  for (const file of ['server/chatbgp-requirements.ts', 'server/chatbgp-app-map.ts']) {
    assert.doesNotMatch(source(file), /Investment view/, file);
  }
  assert.match(source('server/chatbgp-requirements.ts'), /Investment → Requirements \(\/investment\/requirements\)/);
});

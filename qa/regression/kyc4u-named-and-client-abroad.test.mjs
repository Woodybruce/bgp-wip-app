// Two fixes of 25 November 2026 (Woody).
// 1. Sheet Anchor: "these guys should have been KYC4U but saying there isn't
//    one". KYC4U's REQ103894 was filed on the parent's record, so the company's
//    window said KYC4U held no check. A company's KYC4U past checks (the strip
//    and the Companies view's count) now include every request that names one
//    of its registered companies, wherever it was filed, saying where. Rules:
//    shared/kyc4u-names.ts, tests server/kyc4u-names.test.ts.
// 2. Federated Hermes: "suggesting find them on owners abroad but there isnt
//    anywhere to do it on this form". The client KYC window now has the
//    transaction box's Owners abroad section, reading and saving through the
//    client file's own addresses (server routes in server/kyc-abroad.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

test('the KYC4U strip and the Companies view count checks named for the company, wherever filed', () => {
  const route = read('server/kyc4u.ts');
  assert.match(route, /const \{ kyc4uRequestsNaming \} = await import\("\.\/kyc4u-named"\);/);
  assert.match(route, /filedOn: x\.filedOn && x\.filedOn\.id !== companyId \? x\.filedOn : null, unmatched: !x\.filedOn/);
  const feed = read('server/kyc-companies.ts');
  assert.match(feed, /const named = await kyc4uRequestsNaming\(ids\)/);
  assert.match(feed, /for \(const \[companyId, list\] of named\) for \(const r of list\) kyc4uAdd\(companyId, `\$\{r\.listId\}:\$\{r\.itemId\}`, r\.modifiedAt\);/);
  const named = read('server/kyc4u-named.ts');
  // Registered names only: the record's registered name and the companies filed under it, never its display name.
  assert.match(named, /SELECT c\.id, c\.uk_entity_name AS n FROM crm_companies c/);
  assert.match(named, /SELECT e\.parent_company_id, e\.name FROM crm_trading_entities e/);
  assert.doesNotMatch(named, /SELECT c\.id, c\.name AS n/);
  assert.match(read('client/src/components/kyc4u-panel.tsx'), /Names this company; filed on \$\{r\.filedOn\.name\}/);
});

test('the client KYC window shows Owners abroad, through the client file\'s addresses', () => {
  const dialog = read('client/src/components/client-kyc/client-kyc-dialog.tsx');
  assert.match(dialog, /function ClientFileAbroad\(/);
  assert.match(dialog, /const query = useDealAbroad\(scopeKey, "client", true\);/);
  assert.match(dialog, /\{showAbroad && <ClientFileAbroad scopeKey=\{scopeKey\}/);
  // Rendered inside the client file's AmlUrlsProvider, so its hook reads the client file's addresses.
  const provider = dialog.indexOf('<AmlUrlsProvider urls={urls}>');
  const used = dialog.indexOf('<ClientFileAbroad scopeKey');
  assert.ok(provider > 0 && used > provider, 'inside the provider');
  const ui = read('client/src/components/aml-abroad.tsx');
  assert.doesNotMatch(ui, /`\/api\/deals\/\$\{dealId\}\/parties\/\$\{role\}\/abroad/, 'no fixed transaction address');
  assert.match(ui, /fetch\(`\$\{urls\.party\(dealId, role\)\}\/abroad`/);
  assert.match(ui, /const base = `\$\{urls\.party\(dealId, role\)\}\/abroad`;/);
  assert.match(ui, /if \(urls\.clientFile\) queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/client-kyc", urls\.clientFile\.companyId\] \}\);/);
  // The server answers on the client file's path too.
  assert.match(read('server/kyc-abroad.ts'), /"\/api\/client-kyc\/:companyId\/subjects\/:entity\/abroad\/person"/);
  // The hint points at where the section is, and no longer sends anyone to KYC4U.
  assert.match(read('client/src/components/kyc-client-checks.tsx'), /Record them under Owners abroad, in The company \(step 1\)/);
  assert.doesNotMatch(read('shared/kyc-people.ts'), /by KYC4U, or by the officers/);
});

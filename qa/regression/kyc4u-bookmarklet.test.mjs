import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The Send to ChatBGP bookmark is code inside a template literal — escaping
// mistakes there turn a regex into a comment and the bookmark silently dies.
test('KYC4U bookmark is valid JavaScript and finds the CST1092 site from the page URL', () => {
  const src = fs.readFileSync(new URL('../../client/src/components/kyc4u-panel.tsx', import.meta.url), 'utf8');
  const start = src.indexOf('  const code = `');
  const end = src.indexOf('`;', start);
  const template = src.slice(start + '  const code = `'.length, end).replace('${JSON.stringify(app)}', '"https://chatbgp.app"');
  const code = eval('`' + template + '`').replace(/\n/g, '');
  assert.doesNotThrow(() => new Function(code));
  const re = eval(code.match(/var cut=(\/.*?\/i);/)[1]);
  assert.equal('/sites/customers/CST1092/SitePages/ViewRequestStatus.aspx'.split(re)[0], '/sites/customers/CST1092');
  assert.match(code, /kyc4u-import/);
  assert.equal('https://kyc4ultd.sharepoint.com/sites/customers/CST1092/Lists/Requests/AllItems.aspx'.split(re)[0], 'https://kyc4ultd.sharepoint.com/sites/customers/CST1092');
  // Reports what it saw when nothing has items, so the server can say where to look.
  assert.match(code, /diag:diag/);
});

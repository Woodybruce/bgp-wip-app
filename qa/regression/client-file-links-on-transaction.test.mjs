// Woody, 25 November 2026, on Tokoro Capital: "still not saying these have been
// sent?". Links sent from a company's own KYC window (its client file, no
// transaction) count on its transactions for the same contracting entity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

test('a transaction reads the client file requests for its contracting entities', () => {
  const shared = read('shared/kyc-request.ts');
  assert.match(shared, /export function dealOrClientFileTokensSql\(param: string/);
  assert.match(shared, /p0\.e IS NOT DISTINCT FROM \$\{tokens\}\.trading_entity_id/);
  assert.match(read('server/kyc-people.ts'), /WHERE \$\{dealOrClientFileTokensSql\("\$1"\)\} AND request IS NOT NULL/);
  assert.match(read('server/aml-portal.ts'), /WHERE \$\{dealOrClientFileTokensSql\("\$1"\)\} AND request IS NOT NULL AND is_test IS NOT TRUE/);
  assert.match(read('server/aml-portal.ts'), /async function rowInScope\(/);
  assert.match(read('server/aml-dashboard.ts'), /t\.deal_id \? String\(t\.deal_id\) === String\(p\.deal\.id\) : \(t\.trading_entity_id \|\| null\) === \(p\.entityId \|\| null\)/);
});

// Woody, 25 November 2026: "we need to send to joint agent ... the joint agent should
// upload the details", then "for agents we need the filter function so can bring up
// company and we can add agent company to our CRM", "same for brands", "and landlords".
test('the joint agent is offered from Send client checks and step 1, and firms search the CRM', () => {
  const box = read('client/src/components/deal-aml-status.tsx');
  const checks = read('client/src/components/kyc-client-checks.tsx');
  const joint = read('client/src/components/joint-agent-checks.tsx');
  assert.match(box, /const jointAsk = jointQ\.data && askParty && !currentJointRequest\(askParty\)/);
  assert.match(box, /data-testid=\{`aml-joint-ask-\$\{cp\.role\}`\}>Ask the joint agent<\/Button>/);
  assert.match(box, /<AskJointAgentDialog dealId=\{dealId\}/);
  assert.match(checks, /data-testid="client-checks-joint-agent">The joint agent, to upload the documents<\/Button>/);
  assert.match(checks, /<CrmFirmInput value=\{agentFirm\} companyId=\{agentFirmId\}/);
  assert.match(joint, /<CrmFirmInput value=\{firm\} companyId=\{firmId\}/);
  assert.match(read('client/src/components/crm-firm-input.tsx'), /apiRequest\("POST", "\/api\/crm\/companies", \{ name: typed, companyType \}\)/);
  assert.match(read('client/src/components/deal-aml-board.tsx'), /\.\.\.live\.filter\(c => !\(keep\(c\) \|\| c\.id === current\)\)/);
});

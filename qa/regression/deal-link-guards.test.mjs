// New Transaction onto a live transaction (Woody, 24 November 2026: "Can you
// allow for link to existing deal at this point? its easier", on the notice
// that One Clapham already had a live purchase). The rule is
// client/src/lib/deal-link.ts (tests: server/deal-link.test.ts); these hold the
// form to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const deals = read('client/src/pages/deals.tsx');
const lib = read('client/src/lib/deal-link.ts');

test('the live sale or purchase notice offers Use this transaction to BGP staff, keeping the link that opens it', () => {
  const notice = deals.slice(deals.indexOf('function LiveInvestmentDeals('), deals.indexOf('function DealLinkBanner('));
  assert.match(notice, /href=\{`\/deals\/\$\{d\.id\}`\} target="_blank"/);
  assert.match(notice, /\{onUse && \(/);
  assert.match(notice, /data-testid=\{`deal-live-investment-use-\$\{d\.id\}`\}/);
  assert.match(notice, /Use this transaction/);
  // Offered only on New Transaction, to BGP staff, before a link is made.
  assert.match(deals, /onUseLiveInvestment=\{!isClientCreate && !handover && !linked \? \(d\) => \{ void linkTo\(d\); \} : undefined\}/);
});

test('linking reads the transaction fresh and fills only its blanks; Back puts the form as it was', () => {
  const link = deals.slice(deals.indexOf('const linkTo = async'), deals.indexOf('const takeDifference'));
  assert.match(link, /queryClient\.fetchQuery<CrmDeal>\(\{ queryKey: \["\/api\/crm\/deals", target\.id\], staleTime: 0 \}\)/);
  assert.match(link, /linkToTransaction\(dealToForm\(existing\) as any, form as any, base as any\)/);
  // New Transaction's own defaults are the base, so they never count as given.
  assert.match(link, /const base: DealFormData = \{ \.\.\.emptyForm, team: freshForm\(\)\.team \};/);
  // The name stops following the parties: the transaction keeps its own.
  assert.match(link, /setNameAutoFilled\(false\);/);
  assert.match(link, /const unlink = \(\) => \{\s*if \(!linked\) return;\s*setForm\(linked\.before\.form\);/);
});

test('a linked transaction is saved through its own save, never made again', () => {
  const save = deals.slice(deals.indexOf('if (handover) return saveHandover(handover, finalForm);'), deals.indexOf('const payload = formToPayloadWithLearning('));
  assert.match(save, /if \(linked\) \{/);
  assert.match(save, /apiRequest\("PUT", `\/api\/crm\/deals\/\$\{linked\.deal\.id\}`, linkedPayload\)/);
  assert.doesNotMatch(save, /postDeal\(/);
  assert.match(save, /delete linkedPayload\.internalAgent;/);
  // Then Kick off AML, as New Transaction does.
  assert.match(deals, /if \(data\?\.linked\) \{[\s\S]{0,1200}if \(!showAmlStep\(data\.id, data\.dealRef\)\) onOpenChange\(false\);/);
});

test('while linked: the property is fixed, the full form is not offered, and the save names the transaction', () => {
  assert.match(deals, /\} : linked \? \{\s*propertyName: properties\.find\(p => p\.id === form\.propertyId\)\?\.name \|\| "Property",/);
  assert.match(deals, /\{!isEdit && !isClientCreate && !handover && !linked && \(\s*<Button\s+type="button"\s+variant="ghost"/);
  assert.match(deals, /onPickProperty=\{\(id\) => linked\s*\? toast\(\{ title: "This transaction stays on its property"/);
  assert.match(deals, /linked \? `Save to\$\{linked\.deal\.dealRef != null \? ` #\$\{linked\.deal\.dealRef\}` : " the transaction"\}`/);
});

test('the rule keeps what the transaction holds and never moves its stage by itself', () => {
  assert.match(lib, /const KEPT = new Set\(\["name", "team", "internalAgent", "propertyId", "amlCheckCompleted"\]\);/);
  assert.match(lib, /const OFFERED_STAGES = new Set<DealStatusCode>\(\["NEG", "HOT", "SOL"\]\);/);
  // A stage is only ever a difference to take, marked as a move.
  assert.match(lib, /patch: \{ status: to \}, move: true/);
  assert.doesNotMatch(lib, /form\.status =/);
});

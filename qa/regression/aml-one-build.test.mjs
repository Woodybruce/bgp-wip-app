// One build for AML (Woody, 24 November 2026: "can we use this as the template
// and make them match?", then "make sure this is pushed across the app we dont
// want loads of things looking differently or built separately one build for
// AML", and "can we have a cards view of the AML checks? like we do with CRM").
// Every AML and KYC screen draws with the shared pieces (client/src/components/
// aml-frame.tsx) and words each step by one rule (shared/aml-steps.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const frame = read('client/src/components/aml-frame.tsx');
const box = read('client/src/components/deal-aml-status.tsx');
const client = read('client/src/components/client-kyc/client-kyc-dialog.tsx');
const page = read('client/src/pages/aml-dashboard.tsx');
const companies = read('client/src/components/kyc-companies/companies-view.tsx');

test('the shared pieces live in one file', () => {
  for (const name of ['AmlNextBox', 'AmlStep', 'AmlStepIcon', 'AmlFactList', 'AmlFact', 'CompanyFactsList', 'AmlCheckLine', 'AmlCheckLines',
    'AmlScreeningHead', 'AmlChip', 'AmlStageChip', 'AmlLateChip', 'KycStatusChip', 'DealStatusChip', 'AmlLevelChip', 'RedFlagChip', 'AmlCard', 'AmlCardGrid']) {
    assert.match(frame, new RegExp(`export function ${name}\\b`), name);
  }
  assert.match(frame, /export const AML_STAGE_TONE: Record<AmlStage, string> = \{/);
  assert.match(frame, /export const KYC_CHIP_TONE: Record<KycChipTone, string> = \{/);
});

test('the transaction and the client KYC window use the same pieces and the same step rule', () => {
  for (const src of [box, client]) {
    assert.match(src, /import \{[^}]*\bAmlNextBox\b[^}]*\bAmlStep\b[^}]*\} from "@\/components\/aml-frame";/);
    assert.match(src, /import \{[^}]*\bcompanyStepLine\b[^}]*\bdocumentsStepLine\b[^}]*\bsanctionsStepLine\b[^}]*\bscreeningStepLine\b[^}]*\bsignOffStepLine\b[^}]*\} from "@shared\/aml-steps";/);
    assert.match(src, /import \{ RedFlagList(?:, RedFlagLists)? \}|import \{ RedFlagLists \} from "@\/components\/aml-red-flags";/);
    assert.match(src, /<CompanyFactsList company=\{/);
  }
  // No second copy of a step, a Next box or its colours on either screen.
  assert.doesNotMatch(box, /function StepRow\(|const NEXT_BOX|function BoxToneIcon\(|function StepIcon\(/);
  assert.doesNotMatch(client, /function Step\(|const TONE: Record|function CheckLine\(|function SetAsideButton\(/);
  // Step 1 is "The company" (or "The person") on both.
  assert.match(read('shared/aml-steps.ts'), /company: "The company",\s*person: "The person",/);
  assert.doesNotMatch(box, /label="Who signs"/);
});

test('the AML page has a Cards view on Transactions and Companies, like the CRM lists', () => {
  for (const [src, key] of [[page, 'checks'], [companies, 'companies']]) {
    assert.match(src, /import \{ ViewToggle \} from "@\/components\/mobile-card-view";/);
    assert.match(src, new RegExp(`storedAmlView\\("${key}"\\)`));
    assert.match(src, new RegExp(`storeAmlView\\("${key}", picked\\)`));
    // One card for the phone and the Cards view.
    assert.match(src, /isMobile \|\| view === "card" \? \(\s*<AmlCardGrid/);
  }
  assert.match(page, /function AmlPartyCard\(/);
  assert.match(companies, /function KycCompanyCard\(/);
  // Remembered in this browser, never relied on.
  assert.match(frame, /try \{ const v = window\.localStorage\.getItem\(`bgp_aml_view_\$\{key\}`\);/);
});

test('every other AML and KYC chip is the shared one', () => {
  assert.match(read('client/src/components/crm-hub/company-row.tsx'), /<KycStatusChip /);
  assert.doesNotMatch(read('client/src/components/crm-hub/company-row.tsx'), /const KYC_TONE/);
  assert.match(read('client/src/components/account-entities-panel.tsx'), /current: KYC_CHIP_TONE\.ok,/);
  assert.match(read('client/src/components/property-page/ownership-card.tsx'), /<AmlStageChip stage=\{r\.stage\}/);
  assert.doesNotMatch(companies, /const KYC_TONE/);
  assert.doesNotMatch(page, /AML_STAGE_TONE\[/);
  // The party lines inside "The company" use the shared label and value look.
  assert.match(read('client/src/components/deal-parties.tsx'), /<div className="grid grid-cols-\[8rem_minmax\(0,1fr\)\] gap-x-3 text-xs" data-testid=\{testId\}>/);
});

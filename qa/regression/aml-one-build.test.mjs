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
  assert.match(page, /function AmlTransactionCard\(/);
  assert.match(companies, /function KycCompanyCard\(/);
  // Remembered in this browser, never relied on.
  assert.match(frame, /try \{ const v = window\.localStorage\.getItem\(`bgp_aml_view_\$\{key\}`\);/);
});

// Woody, 24 November 2026: "can you sort the cards so they all the same size and add
// scroll within as required".
test('every AML card is one height on a computer, its rows scrolling inside', () => {
  const card = frame.slice(frame.indexOf('export function AmlCard('), frame.indexOf('export function AmlCardGrid'));
  // One height from two columns up; a phone keeps each card's own height.
  assert.match(card, /overflow-hidden rounded-xl [^"]*md:h-72/);
  assert.doesNotMatch(card, /[^:]h-72/, 'no fixed height on a phone');
  // The title and the footer stay put; the rows scroll, starting at the top.
  assert.match(card, /<div className="flex shrink-0 items-start gap-2">/);
  assert.match(card, /<div className="relative min-h-0 flex-1">\s*<dl ref=\{body\} className="grid h-full grid-cols-\[auto_minmax\(0,1fr\)\] content-start [^"]*overflow-y-auto/);
  assert.match(card, /<div className="shrink-0 border-t border-border pt-2/);
  // A fade while more is below, worked out after each render, on scroll and on resize.
  assert.match(card, /setMore\(el\.scrollHeight - el\.scrollTop - el\.clientHeight > 2\)/);
  assert.match(card, /useEffect\(check\);/);
  assert.match(card, /new ResizeObserver\(check\)/);
  assert.match(card, /\{more && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 /);
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

// Woody, 25 November 2026, on the grey "!" circles in Screening: "it looks like
// they are a problem but I think they are just actions? Maybe better just to be
// a green tick ... all we care about is a issue".
test('a screening line that only says what happened is a green tick; only an issue looks like one', () => {
  const line = frame.slice(frame.indexOf('export function AmlCheckLine('), frame.indexOf('export function AmlCheckLines('));
  assert.match(line, /line\.state === "attention" \? <Flag className="h-3\.5 w-3\.5 text-amber-600" \/>/);
  assert.match(line, /: line\.failed \? <AlertCircle className="h-3\.5 w-3\.5 text-amber-600" \/>/);
  assert.match(line, /: <CheckCircle2 className="h-3\.5 w-3\.5 text-emerald-600" \/>;/);
  assert.doesNotMatch(line, /<AlertCircle className="h-3\.5 w-3\.5 text-muted-foreground" \/>/, 'no grey warning circle for information');
});

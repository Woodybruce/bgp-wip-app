// The AML box, shortened (Woody, 20 November 2026, on the AML checks page:
// "minimise each section with the detail to pop out so people can clearly see
// whats happening and whats needed its pretty overwhelming for them but
// clearly we need that info displayed for the AML officers").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const box = read('client/src/components/deal-aml-status.tsx');

test('each party opens on its stage and one Next line, by the shared rule', () => {
  assert.match(box, /const step = amlNextStep\(facts\);/);
  // The stage is the AML dashboard's own, read for this deal, so the box and the dashboard agree.
  assert.match(box, /fetch\(`\/api\/aml-dashboard\?dealId=\$\{encodeURIComponent\(dealId\)\}`/);
  // The board's stage, except the full checks on a small letting, where a sanctions-only approval is not where they stand (23 November 2026).
  assert.match(box, /: row\?\.stage \?\? fallbackStage\(cp\);/);
  assert.match(box, /const stage: AmlStage \| null = fullOnSmall && cp\.approvalScope === "sanctions_only"/);
  const route = read('server/aml-dashboard.ts');
  // One deal's rows (the box), or one building's (its Ownership & KYC tab, 23 November 2026).
  assert.match(route, /const dealId = text\(req\.query\.dealId\);\s*const propertyId = text\(req\.query\.propertyId\);\s*res\.json\(await loadAmlDashboard\(me, new Date\(\), dealId \? \{ dealId \} : propertyId \? \{ propertyId \} : \{\}\)\);/);
  assert.match(route, /const which = opts\.dealId\s*\? `d\.id = \$1`/);
  // Still BGP staff signed in as themselves.
  assert.match(route, /router\.get\("\/api\/aml-dashboard", async[^]*?const me = await staffMe\(req\);\s*if \(!me\) return res\.status\(403\)/);
});

test('each party is four steps, each one line that opens its detail; nothing is dropped', () => {
  // Woody, 22 November 2026: "yes go ahead" to Who signs, Screening, Documents and Sign-off.
  for (const key of ['signs', 'screening', 'documents', 'decision']) {
    assert.match(box, new RegExp(`testId=\\{tid\\("${key}"\\)\\}`), key);
  }
  assert.match(box, /const tid = \(k: StepKey\) => `aml-step-\$\{cp\.role\}-\$\{k\}`;/);
  // The steps are the shared ones (aml-frame.tsx), in the client KYC window's look (24 November 2026).
  const frame = read('client/src/components/aml-frame.tsx');
  assert.match(frame, /\{open && <div className="space-y-3 pb-3 pl-7" data-testid=\{`\$\{testId\}-detail`\}>\{children\}<\/div>\}/);
  assert.match(box, /<AmlStep id=\{sid\("signs"\)\} testId=\{tid\("signs"\)\} n=\{1\}/);
  assert.doesNotMatch(box, /function StepRow\(/, 'no second copy of the step');
  // The detail each step opens is what the box showed before.
  // The level of due diligence now sits beside Run again in the screening step (24 November 2026).
  for (const piece of ['<PartyCompanyFacts data={data} companyId={cp.id} />', '<PartyPrechecks dealId={dealId} data={data} companyId={cp.id} level={cp.notRequired ? null : level} />',
    '<PartyNotRequiredBox cp={cp} />', '<PartyDecisions dealId={dealId} data={data} companyId={cp.id}',
    '<DealPartyLines dealId={dealId} role={cp.role as DealPartyRole} aml={aml} fullBilling />',
    '<AbroadTrace dealId={dealId} role={cp.role} query={abroadQ} sanctionsOnly={sanctionsOnly} />', '<PartyRedFlags dealId={dealId} data={data} companyId={cp.id} role={cp.role} only="flags" />',
    'part="people"', 'part="requests"', '<PartyRiskAssessment dealId={dealId} role={cp.role} />', '<SecondReadPanel dealId={dealId} role={cp.role}']) {
    assert.ok(box.includes(piece), piece);
  }
  // The Next line: a bold lead and a few words (shared/aml-box.ts).
  assert.match(frame, /<span className="font-semibold">\{lead\}<\/span>\{words \? <> · \{words\}<\/> : null\}/);
  assert.match(box, /<AmlNextBox tone=\{step\.tone\} lead=\{step\.lead\} words=\{step\.words\} action=\{nextAction\}/);
});

test('the officers can open everything, remembered per browser and never relied on', () => {
  assert.match(box, /const OPEN_ALL_KEY = "bgp:aml-box:open-all";/);
  assert.match(box, /const readOpenAll = \(\): boolean => \{ try \{ return window\.localStorage\.getItem\(OPEN_ALL_KEY\) === "1"; \} catch \{ return false; \} \};/);
  assert.match(box, /data-testid="aml-box-open-all"/);
});

test('the AML checks page opens the trail on its own party; on a deal a party still being checked opens on its steps', () => {
  const page = read('client/src/pages/aml-dashboard.tsx');
  assert.match(page, /<DealAmlStatusCard dealId=\{row\.dealId\} dealStatus=\{row\.dealStatus\} focusCompanyId=\{row\.brandId\} \/>/);
  assert.match(box, /startOpen=\{focusCompanyId \? cp\.id === focusCompanyId : !isSettled\(cp\)\}/);
  // Folded unless it starts open, all are open, or the address names it (?full=<role>, 23 November 2026).
  assert.match(box, /const \[folded, setFolded\] = useState\(\(\) => \{\n\s+if \(startOpen \|\| openAll\.all\) return false;\n\s+try \{ return new URLSearchParams\(window\.location\.search\)\.get\("full"\) !== cp\.role; \}/);
  // One set of stage colours for the page and the box.
  assert.match(page, /import \{ DealAmlStatusCard \} from "@\/components\/deal-aml-status";/);
  assert.match(page, /<AmlStageChip stage=\{row\.stage\} expiresAt=\{row\.expiresAt\} testId=\{`aml-stage-\$\{row\.key\}`\} \/>/);
  assert.doesNotMatch(page, /const STAGE_TONE/);
});

test('the Parties card is in the box for BGP staff: one card per party slot, BGP acts for in its heading', () => {
  const deal = read('client/src/components/deal-detail.tsx');
  assert.match(deal, /\{staffView \? \(\s*<div className="space-y-3" data-testid="deal-kyc">\s*<StaffPartiesAml/);
  assert.match(deal, /<DealAmlStatusCard dealId=\{dealId\} dealStatus=\{deal\.status\} slots=\{slots\} actingFor=\{actingForControl\} footer=\{footer\} \/>/);
  // Clients keep the read-only Parties card.
  assert.match(deal, /\) : \(\s*<DealPartiesCard/);
  // An unset slot shows its picker; a set one has its card.
  assert.match(box, /return cp \? box\(cp, slot\) : <UnsetPartyRow key=\{`unset-\$\{slot\.role\}`\} slot=\{slot\} \/>;/);
  // A party change refreshes the box.
  assert.match(deal, /function refreshDealAml\(dealId: string\) \{/);
});

test('a person and a request each open on one line', () => {
  const checks = read('client/src/components/kyc-client-checks.tsx');
  assert.match(checks, /data-testid=\{`person-toggle-\$\{testKey\}`\}/);
  assert.match(checks, /data-testid=\{`client-check-toggle-\$\{request\.ref\}`\}/);
  // A warning stays on the line, never hidden in the detail.
  assert.match(checks, /const warning = request\.idOtherPerson \?/);
  assert.match(checks, /\{person\.sanctions === "possible" && <span/);
});

// The simple sanctions-only view (Woody, 23 November 2026: "we have a sanctions only
// version for AML'S which is much simpler so not to confuse everyone").
test('a letting under £10,000 a month shows three steps, Who signs, Sanctions and Sign-off, with the full checks behind a link', () => {
  const box = read('client/src/components/deal-aml-status.tsx');
  assert.match(box, /const simple = smallLetting && !isTrust && !fullView;/);
  // Its full view is the full checks: client checks and a full sign-off (23 November 2026).
  assert.match(box, /const sanctionsOnly = smallLetting && !fullOnSmall;/);
  assert.match(box, /\{simple \? \(/);
  assert.match(box, /testId=\{`aml-step-\$\{cp\.role\}-sanctions`\} n=\{2\} label=\{AML_STEP_LABEL\.sanctions\}/);
  assert.match(box, /n=\{3\} label=\{AML_STEP_LABEL\.signOff\}/);
  assert.match(box, /only=\{\["sanctions"\]\}/);
  assert.match(box, /\{fullView \? "Show the simple view" : "Show the full checks"\}/);
  const board = read('client/src/pages/aml-dashboard.tsx');
  assert.match(board, /if \(row\.sanctionsOnly\) return \([\s\S]{0,300}>Sanctions only<\/span>[\s\S]{0,120}Letting under £10k a month/);
});

// The board's red flags as a count with a pop-up (Woody, 23 November 2026).
test('the board shows the red flags as a count that opens their explanations', () => {
  const board = read('client/src/pages/aml-dashboard.tsx');
  assert.match(board, /const flagCount = \(n: number\) => `\$\{n\} red flag\$\{n === 1 \? "" : "s"\}`;/);
  assert.match(board, /<PopoverTrigger asChild>\s*<button type="button" onClick=\{e => e\.stopPropagation\(\)\}/);
  assert.match(board, /<PopoverContent[^>]*onClick=\{e => e\.stopPropagation\(\)\}/);
  assert.match(board, /Open the checks<\/button>/);
  assert.match(board, /href=\{`\/deals\/\$\{row\.dealId\}\?section=parties`\}/);
  assert.doesNotMatch(board, /row\.redFlags\.length === 1 \? row\.redFlags\[0\]/, 'the flag itself is no longer written in the table');
  const server = read('server/aml-dashboard.ts');
  assert.match(server, /flagDetails: shownFlags,/);
});

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
  assert.match(box, /const stage = row\?\.stage \?\? fallbackStage\(cp\);/);
  const route = read('server/aml-dashboard.ts');
  assert.match(route, /const dealId = text\(req\.query\.dealId\);\s*res\.json\(await loadAmlDashboard\(me, new Date\(\), dealId \? \{ dealId \} : \{\}\)\);/);
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
  assert.match(box, /\{open && <div className="space-y-2\.5 pb-3 pl-\[2\.6rem\] pr-2\.5" data-testid=\{`\$\{testId\}-detail`\}>\{children\}<\/div>\}/);
  // The detail each step opens is what the box showed before.
  for (const piece of ['<PartyCompanyFacts data={data} companyId={cp.id} />', '<PartyPrechecks dealId={dealId} data={data} companyId={cp.id} />',
    '<PartyLevel data={data} companyId={cp.id} />', '<PartyNotRequiredBox cp={cp} />', '<PartyDecisions dealId={dealId} data={data} companyId={cp.id}',
    '<DealPartyLines dealId={dealId} role={cp.role as DealPartyRole} aml={aml} fullBilling />',
    '<AbroadTrace dealId={dealId} role={cp.role} query={abroadQ} sanctionsOnly={sanctionsOnly} />', '<PartyRedFlags dealId={dealId} data={data} companyId={cp.id} role={cp.role} only="flags" />',
    'part="people"', 'part="requests"', '<PartyRiskAssessment dealId={dealId} role={cp.role} />', '<SecondReadPanel dealId={dealId} role={cp.role}']) {
    assert.ok(box.includes(piece), piece);
  }
  // The Next line: a bold lead and a few words (shared/aml-box.ts).
  assert.match(box, /<span className="font-semibold">\{step\.lead\}<\/span>\{step\.words \? <> · \{step\.words\}<\/> : null\}/);
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
  assert.match(box, /const \[folded, setFolded\] = useState\(!startOpen && !openAll\.all\);/);
  // One set of stage colours for the page and the box.
  assert.match(page, /import \{ AML_STAGE_TONE, DealAmlStatusCard \} from "@\/components\/deal-aml-status";/);
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

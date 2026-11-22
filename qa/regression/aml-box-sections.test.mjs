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

test('every section is one line that opens its detail; nothing is dropped', () => {
  for (const key of ['company', 'checks', 'level', 'people', 'client', 'flags', 'kyc4u', 'decision']) {
    assert.match(box, new RegExp(`testId=\\{tid\\("${key}"\\)\\}`), key);
  }
  assert.match(box, /\{open && <div className="space-y-2 pb-3 pl-\[1\.375rem\]" data-testid=\{`\$\{testId\}-detail`\}>\{children\}<\/div>\}/);
  // The detail each line opens is what the box showed before.
  for (const piece of ['<PartyCompanyFacts data={data} companyId={cp.id} />', '<PartyPrechecks dealId={dealId} data={data} companyId={cp.id} />',
    '<PartyLevel data={data} companyId={cp.id} />', '<PartyNotRequiredBox cp={cp} />', '<PartyDecisions dealId={dealId} data={data} companyId={cp.id}',
    '<Kyc4uRequestButton dealId={dealId} companyId={cp.id} role={cp.role} partyName={partyName} />']) {
    assert.ok(box.includes(piece), piece);
  }
});

test('the officers can open everything, remembered per browser and never relied on', () => {
  assert.match(box, /const OPEN_ALL_KEY = "bgp:aml-box:open-all";/);
  assert.match(box, /const readOpenAll = \(\): boolean => \{ try \{ return window\.localStorage\.getItem\(OPEN_ALL_KEY\) === "1"; \} catch \{ return false; \} \};/);
  assert.match(box, /data-testid="aml-box-open-all"/);
});

test('the AML checks page opens the trail on its own party, the others folded to their Next line', () => {
  const page = read('client/src/pages/aml-dashboard.tsx');
  assert.match(page, /<DealAmlStatusCard dealId=\{row\.dealId\} dealStatus=\{row\.dealStatus\} focusCompanyId=\{row\.brandId\} \/>/);
  // One row per party; the trail's party (or the deal's only one) opens on its checks (22 November 2026).
  assert.match(box, /startOpen=\{focusCompanyId \? cp\.id === focusCompanyId : cps\.length === 1\}/);
  assert.match(box, /const \[folded, setFolded\] = useState\(!startOpen && !openAll\.all\);/);
  // One set of stage colours for the page and the box.
  assert.match(page, /import \{ AML_STAGE_TONE, DealAmlStatusCard \} from "@\/components\/deal-aml-status";/);
  assert.doesNotMatch(page, /const STAGE_TONE/);
});

test('a person and a request each open on one line', () => {
  const checks = read('client/src/components/kyc-client-checks.tsx');
  assert.match(checks, /data-testid=\{`person-toggle-\$\{testKey\}`\}/);
  assert.match(checks, /data-testid=\{`client-check-toggle-\$\{request\.ref\}`\}/);
  // A warning stays on the line, never hidden in the detail.
  assert.match(checks, /const warning = request\.idOtherPerson \?/);
  assert.match(checks, /\{person\.sanctions === "possible" && <span/);
});

// Heads of terms on the transaction page (Woody, 23 November 2026: "where is
// the upload HOTs place? so can populate?"). Source guards: who may read, the
// reader is Anthropic called directly and capped, the read saves nothing, and
// the screen saves only through the routes the party box and the deal form use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const server = read('server/deal-hots.ts');
const screen = read('client/src/components/deal-hots.tsx');
const amlBox = read('client/src/components/deal-aml-status.tsx');
const partyBox = read('client/src/components/deal-parties.tsx');
const index = read('server/index.ts');
const appMap = read('server/chatbgp-app-map.ts');

test('both routes are BGP staff only, the file taken only after the check, and mounted', () => {
  const readRoute = server.slice(server.indexOf('router.post("/api/deals/:id/heads-of-terms/read"'), server.indexOf('router.post("/api/deals/:id/heads-of-terms/match"'));
  assert.match(readRoute, /staffMe\(req\)\.then\(me => \{\s*if \(!me\) return res\.status\(403\)/);
  assert.ok(readRoute.indexOf('staffMe(req)') < readRoute.indexOf('upload.single("file")'), 'staff check before the upload');
  const matchRoute = server.slice(server.indexOf('router.post("/api/deals/:id/heads-of-terms/match"'));
  assert.match(matchRoute, /if \(!\(await staffMe\(req\)\)\) return res\.status\(403\)/);
  assert.match(server, /async function staffMe\(req: Request\)[\s\S]*contactViewer\(req\)\)\.staff/);
  assert.match(index, /import dealHotsRouter from "\.\/deal-hots";/);
  assert.match(index, /app\.use\(dealHotsRouter\);/);
  const allowed = index.slice(index.indexOf('const CLIENT_ALLOWED_API = ['), index.indexOf('const CLIENT_ALLOWED_WRITES = ['));
  assert.doesNotMatch(allowed, /heads-of-terms/);
});

test('the reader is Anthropic called directly, one forced tool, capped a day', () => {
  assert.match(server, /getAnthropicClient\(true\)\.messages\.create/);
  assert.match(server, /tool_choice: \{ type: "tool", name: HOTS_TOOL\.name \}/);
  assert.match(server, /claimDailyRead\(USAGE_KEY, hotsReaderDailyCap\(\)\)/);
  assert.match(server, /HOTS_READER_DAILY_CAP/);
  assert.doesNotMatch(server, /callClaude\(/);
  // Every value the provider gives is checked against the document's text.
  assert.match(server, /checkHotsAnswer\(reply\.input, text, opts\)/);
  // A typed note goes to the provider as the note alone.
  assert.match(server, /parts: \[\{ type: "text", text: `<note>/);
});

test('reading and matching save nothing', () => {
  assert.doesNotMatch(server, /\b(?:INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i);
  // The read and match routes never file a contact: only the contact route does.
  const readAndMatch = server.slice(server.indexOf('router.post("/api/deals/:id/heads-of-terms/read"'), server.indexOf('router.post("/api/deals/:id/heads-of-terms/contact"'));
  assert.doesNotMatch(readAndMatch, /fileHotsContact\(/);
});

test('a solicitor or agent from the heads of terms: staff only, never BGP, the CRM record only gains blanks (23 November 2026)', () => {
  const route = server.slice(server.indexOf('router.post("/api/deals/:id/heads-of-terms/contact"'));
  assert.match(route, /^router\.post\("\/api\/deals\/:id\/heads-of-terms\/contact", async \(req: Request, res: Response\) => \{\s*try \{\s*if \(!\(await staffMe\(req\)\)\) return res\.status\(403\)/);
  assert.match(route, /if \(isBgpContact\(c\)\) return res\.status\(400\)/);
  const filing = read('server/deal-hots-contact.ts');
  // Blank fields only: never overwrite what the CRM holds.
  assert.match(filing, /SET email = COALESCE\(NULLIF\(btrim\(email\), ''\), \$2\), phone = COALESCE\(NULLIF\(btrim\(phone\), ''\), \$3\)/);
  assert.match(filing, /company_id = COALESCE\(company_id, \$4\)/);
  assert.match(filing, /notes: `Added from the heads of terms of \$\{input\.dealName\}`/);
  assert.match(filing, /const type = input\.kind === "agent" \? "Agent" : "Solicitor";/);
  assert.doesNotMatch(filing, /DELETE FROM|UPDATE crm_deals/);
  // The transaction itself is set through its own save.
  assert.match(screen, /HOTS_AGENT_FIELDS\[v\.side\]/);
  assert.match(screen, /\{ firm: "jointAgentId", person: "jointAgentContactId" \}/);
  assert.match(screen, /solicitorFirm: v\.read\.firm/);
});

// Woody, 23 November 2026: "it pulled out the Landlord contact and wanted to add it as
// joint agent but its the client contact because they are the asset managers".
test('an asset manager, or someone at the party itself, is offered as the person to ask, never as an agent', () => {
  // The provider may call a contact a manager, and its own words decide over an "agent".
  assert.match(server, /kind: \{ type: "string", enum: \["solicitor", "agent", "manager"\]/);
  assert.match(read('shared/deal-hots.ts'), /hotsContactKind\(c\?\.kind\) === "agent" && MANAGER_WORDS\.test\(quote\) \? "manager"/);
  // The party's own people are found on the server; the screen offers who to ask before anything an agent gets.
  assert.match(server, /const forParty = !us && \(read\.kind === "manager" \|\| own\);/);
  assert.match(server, /if \(read\.kind === "agent" && !forParty\)/);
  assert.match(screen, /: v\.forParty\n\s+\? \(v\.askIsThem \? done\("Who to ask"\)/);
  // A manager is never filed as a firm by the contact route.
  assert.match(server, /if \(kind === "manager"\) return res\.status\(400\)/);
});

test('the screen saves only through the routes that already exist', () => {
  const writes = [...screen.matchAll(/apiRequest\("(POST|PUT|PATCH|DELETE)", `?([^`",]+)/g)].map(m => `${m[1]} ${m[2]}`);
  const allowed = [
    /^POST \/api\/deals\/\$\{dealId\}\/heads-of-terms\/match$/,
    /^PUT \/api\/deals\/\$\{dealId\}\/parties\/\$\{role\}$/,
    // The company that signs set by itself from a certain reading (23 November 2026).
    /^PUT \/api\/deals\/\$\{dealId\}\/parties\/\$\{p\.role\}$/,
    // A guarantor the heads of terms name, made the transaction's guarantor (23 November 2026).
    /^POST \/api\/deals\/\$\{dealId\}\/guarantors$/,
    /^POST \/api\/billing-entities$/,
    /^PUT \/api\/crm\/deals\/\$\{dealId\}$/,
    /^POST \/api\/crm\/companies$/,
    // Solicitors and agents (23 November 2026): the CRM filing, and the SRA check of the AML box.
    /^POST \/api\/deals\/\$\{dealId\}\/heads-of-terms\/contact$/,
    /^POST \/api\/deals\/\$\{dealId\}\/solicitors-aml\/check$/,
    // The party's asset manager made the person to ask, through the party box's own route (23 November 2026).
    /^POST \/api\/deals\/\$\{dealId\}\/parties\/\$\{v\.side\}\/person$/,
  ];
  assert.ok(writes.length >= 5, writes.join(', '));
  for (const w of writes) assert.ok(allowed.some(re => re.test(w)), `unexpected write: ${w}`);
  // The billing entity made here is the company that signs, not a Xero contact.
  assert.match(screen, /"\/api\/billing-entities", \{ brandId, companyNumber: number, xero: false \}/);
  assert.match(screen, /\/api\/unit-hots\/\$\{encodeURIComponent\(reply\.filing\.unitId\)\}\/final/);
});

test('the box is on the AML box for BGP staff and the button in the party box, which stays open under it', () => {
  // Type it out or drop the heads of terms (Woody, 23 November 2026).
  assert.match(amlBox, /\{staffView && slots && !mirror && <DealDescribeBox dealId=\{dealId\} \/>\}/);
  assert.match(screen, /export function DealDescribeBox/);
  // The box takes a dropped file itself and keeps it from the app-wide import (23 November 2026).
  assert.match(screen, /onDrop=\{e => \{ if \(!hasFiles\(e\)\) return; e\.preventDefault\(\); e\.stopPropagation\(\); setDragging\(false\); const f = e\.dataTransfer\.files\?\.\[0\]; if \(f\) void read\(\{ file: f \}\);/);
  assert.match(server, /typeof req\.body\?\.text === "string"/);
  assert.match(partyBox, /<DealHotsButton dealId=\{dealId\} label="Read the heads of terms"[^>]*inEditor onOpenChange=\{setHotsOpen\}/);
  assert.match(partyBox, /if \(!o && !finding && !hotsOpen && !guarantorFinding && !signerFinding\) onClose\(\);/);
  // No import cycle: the screen loads the party box only when asked for.
  assert.doesNotMatch(screen, /from "@\/components\/deal-parties"/);
  assert.match(screen, /lazy\(\(\) => import\("@\/components\/deal-parties"\)/);
});

test('a number that is another company\'s is never offered (live check, 23 November 2026)', () => {
  const look = server.slice(server.indexOf('async function lookUpRegister'), server.indexOf('interface DealRow'));
  assert.match(look, /hotsNamesClose\(hit\.name, read\.name\)/);
  assert.match(look, /previousNames/);
  assert.match(look, /other = \{ number: hit\.number, name: hit\.name/);
  assert.match(screen, /<NumberIsAnother other=\{match\.numberIsAnother\}/);
  assert.match(screen, /<NumberIsAnother other=\{g\.numberIsAnother\}/);
});

test('ChatBGP is told where it is', () => {
  assert.match(appMap, /\*\*Describe the transaction\*\* \(since 2026-11-23\)/);
});

// Woody, 23 November 2026: "read hots and click choose company and it went back to
// previous board nothing saved". The party line's buttons save: the Who signs
// dialog (Companies House, or a person) opens over the heads of terms, files the
// pick under the party with no Xero contact, and sets it as the one who signs.
test('a party not found or named with no company: every button saves the one who signs', () => {
  const line = screen.slice(screen.indexOf('case "not_found":'), screen.indexOf('case "no_party":'));
  assert.match(line, /hotsPersonName\(read\.name\)/);
  assert.match(line, /onFind\(role, "person", person\)/);
  assert.match(line, /onFind\(role, "company", person \? \(brand\?\.name \|\| ""\) : read\.name\)/);
  assert.match(line, /onFind\(role, "person", ""\)/);
  assert.doesNotMatch(line, />Choose the company</, 'the old button that saved nothing');
  assert.match(screen, /<Dialog open onOpenChange=\{o => \{ if \(!o && !editing && !finding\) onClose\(\); \}\}>/);
  const finder = screen.slice(screen.indexOf('{finding && ('), screen.indexOf('{finding && (') + 900);
  assert.match(finder, /<CreateBillingEntityDialog/);
  assert.match(finder, /xero=\{false\}/);
  assert.match(finder, /initialPersonName=\{finding\.mode === "person" \? finding\.name : ""\}/);
  assert.match(finder, /onSavedWithoutXero=\{company => signsFound\(finding\.role, company\)\}/);
  assert.match(screen, /const signsFound = \(role: DealPartyRole, company: SavedCompany\) => \{[\s\S]{0,200}apiRequest\("PUT", `\/api\/deals\/\$\{dealId\}\/parties\/\$\{role\}`, \{ companyId: company\.id \}\)/);
});

// A company abroad named with its home number is found by its name (Woody, 23 November
// 2026, AG Hondo Brixton Village B.V., Dutch number 71168974), and the heads of terms
// stay open in the party box once the company is set.
test('a company abroad is looked up by its name, and offered rather than set by itself', () => {
  assert.match(server, /const numberIsFromAbroad = \(read: \{ name: string; number: string \| null \}\): boolean =>\s*!!read\.number && looksOverseasName\(read\.name\) && !isOverseasEntityNumber\(read\.number\);/);
  assert.match(server, /if \(read\.number && !abroad\) \{/);
  assert.match(server, /if \(r\.byName\) base\.byName = true;/);
  assert.match(screen, /!p\.numberIsAnother && !p\.byName/);
  assert.match(partyBox, /\{\(!party\.company \|\| hotsOpen\) && \(/);
});

test('a sum whose figure and words disagree is read by the words, on both heads of terms readers (One Clapham, 24 November 2026)', () => {
  const rules = read('shared/deal-hots.ts');
  // The transaction page: the provider's answer and the rules both go through the words.
  const check = rules.slice(rules.indexOf('export function checkHotsAnswer('), rules.indexOf('// ── The rules reader'));
  assert.match(check, /sumByWords\(quote, value\)/);
  const byRules = rules.slice(rules.indexOf('export function readHotsByRules('), rules.indexOf('// ── A note a person typed'));
  assert.match(byRules, /sumByWords\(value, v\)/);
  // New Transaction's reader corrects the same sums.
  const crm = read('server/crm.ts');
  const parse = crm.slice(crm.indexOf('const parseHotsHandler = async'), crm.indexOf('app.post("/api/crm/deals/parse-hots"'));
  assert.match(parse, /sumByWords\(text, n\)/);
  assert.match(parse, /\["price", "rentPa", "capitalContribution", "fee"\]/);
  // The dialog says why the figure was not used.
  assert.match(screen, /data-testid=\{`deal-hots-term-note-\$\{t\.key\}`\}/);
});

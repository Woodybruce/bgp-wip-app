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
});

test('the screen saves only through the routes that already exist', () => {
  const writes = [...screen.matchAll(/apiRequest\("(POST|PUT|PATCH|DELETE)", `?([^`",]+)/g)].map(m => `${m[1]} ${m[2]}`);
  const allowed = [
    /^POST \/api\/deals\/\$\{dealId\}\/heads-of-terms\/match$/,
    /^PUT \/api\/deals\/\$\{dealId\}\/parties\/\$\{role\}$/,
    /^POST \/api\/billing-entities$/,
    /^PUT \/api\/crm\/deals\/\$\{dealId\}$/,
    /^POST \/api\/crm\/companies$/,
  ];
  assert.ok(writes.length >= 5, writes.join(', '));
  for (const w of writes) assert.ok(allowed.some(re => re.test(w)), `unexpected write: ${w}`);
  // The billing entity made here is the company that signs, not a Xero contact.
  assert.match(screen, /"\/api\/billing-entities", \{ brandId, companyNumber: number, xero: false \}/);
  assert.match(screen, /\/api\/unit-hots\/\$\{encodeURIComponent\(reply\.filing\.unitId\)\}\/final/);
});

test('the box is on the AML box for BGP staff and the button in the party box, which stays open under it', () => {
  // Type it out or drop the heads of terms (Woody, 23 November 2026).
  assert.match(amlBox, /\{staffView && slots && <DealDescribeBox dealId=\{dealId\} \/>\}/);
  assert.match(screen, /export function DealDescribeBox/);
  assert.match(screen, /onDrop=\{e => \{ const f = e\.dataTransfer\.files\?\.\[0\]/);
  assert.match(server, /typeof req\.body\?\.text === "string"/);
  assert.match(partyBox, /<DealHotsButton dealId=\{dealId\} label="Read the heads of terms"[^>]*inEditor onOpenChange=\{setHotsOpen\}/);
  assert.match(partyBox, /if \(!o && !finding && !hotsOpen\) onClose\(\);/);
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

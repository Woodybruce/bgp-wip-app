// Requirements centre (Woody, 2026-11-12): the rules the build must keep,
// checked against the source so a later change that breaks one fails here.
//   node --test qa/regression/requirements-centre-guards.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, find, ts } = require('./source-harness.cjs');

const CENTRE_FILES = [
  'server/requirement-intake.ts', 'server/requirement-intake-routes.ts', 'server/requirement-feeds.ts',
  'server/requirement-news.ts', 'server/chatbgp-requirements.ts', 'server/requirement-overlaps.ts',
  'server/requirements-health.ts',
];
// Comments describe what the code must not do, so they are left out of the checks.
const code = file => {
  const text = source(file);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  let out = '';
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) out += scanner.getTokenText() + ' ';
  return out;
};
const imports = file => [...source(file).matchAll(/(?:from\s+|import\()\s*["']([^"']+)["']/g)].map(m => m[1]);

test('the email reader is not built: no requirements-centre file reaches a mailbox', () => {
  const mailModules = /(^|\/)(interactions|archivist|shared-mailbox|private-mail-graph|viewing-sync|email-processor|insights-feed|graph|ms-graph|outlook)[^/]*$/i;
  for (const file of CENTRE_FILES) {
    for (const name of imports(file)) assert.doesNotMatch(name, mailModules, `${file} imports ${name}`);
    const text = code(file);
    assert.doesNotMatch(text, /graph\.microsoft\.com|\/mailFolders|\/messages\/|bodyPreview|uniqueBody|Mail\.Read|email_ingest|getGraphClient/i, `${file} reads mail`);
  }
  // "Add evidence -> email" is a line a person types: the route takes text, never a message id.
  const addEvidence = find('server/requirement-intake-routes.ts', (n, ast) => ts.isCallExpression(n) &&
    n.expression.getText(ast) === 'app.post' && n.arguments[0]?.getText(ast) === '"/api/requirement-centre/requirements/:id/evidence"');
  assert.doesNotMatch(addEvidence, /messageId|emailId|graph|fetch\(/i);
});

test('detection reads go to Anthropic directly, are capped per day and are quiet with no key', () => {
  for (const file of ['server/requirement-feeds.ts', 'server/requirement-news.ts']) {
    for (const name of imports(file)) assert.doesNotMatch(name, /ai-provider|openai|gemini/i, `${file} imports ${name}`);
    assert.doesNotMatch(code(file), /\bcallClaude\s*\(|\bcallAI\s*\(|\bgetAIClient\s*\(/, `${file} uses a switchable helper`);
  }
  const reader = find('server/requirement-feeds.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'readStatedRequirements');
  assert.match(reader, /if \(!deps\.hasKey\(\)\) return null/);
  assert.match(reader, /deps\.claim\(\)/);
  const defaults = find('server/requirement-feeds.ts', (n, ast) => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'defaultReaderDeps');
  assert.match(defaults, /claim: \(\) => claimDailyRead\(\)/);
  assert.match(defaults, /getAnthropicClient\(true\)\.messages\.create/);
  assert.match(source('server/requirement-feeds.ts'), /REQUIREMENT_READER_DAILY_CAP/);
  assert.match(source('server/requirement-news.ts'), /REQUIREMENT_NEWS_READER_DAILY_CAP/);
  // The newsletter reader's section call is the direct client too.
  const newsletter = source('server/news-brand-linking.ts');
  const start = newsletter.indexOf('export async function extractBrandSignalsFromNewsletter');
  const next = newsletter.indexOf('\nexport ', start + 10);
  assert.ok(start > 0);
  assert.doesNotMatch(newsletter.slice(start, next > 0 ? next : undefined).replace(/\/\/.*$/gm, ''), /\bcallClaude\s*\(/);
  assert.match(newsletter, /getAnthropicClient\(true\)\.messages\.create/);
});

test('nothing ages or back-fills requirements on a timer or at boot', () => {
  for (const file of CENTRE_FILES) assert.doesNotMatch(code(file), /\bsetInterval\s*\(|\bcron\b|node-cron|\bschedule\s*\(/, `${file} schedules work`);
  const boot = source('server/index.ts');
  for (const name of ['requirement-intake', 'requirement-feeds', 'requirement-news', 'requirement-overlaps', 'chatbgp-requirements', 'requirements-health'])
    assert.ok(!boot.includes(`./${name}"`) && !boot.includes(`./${name}'`), `server/index.ts loads ${name} at boot`);
  for (const column of ['last_confirmed_at', 'last_confirmed_by', 'confirmed_how'])
    assert.ok(!boot.includes(column), `server/index.ts writes ${column}`);
});

test('the imports never confirm a requirement', () => {
  for (const file of ['server/pipnet.ts', 'server/trl.ts']) {
    const text = code(file);
    assert.doesNotMatch(text, /lastConfirmedAt|last_confirmed_at|lastConfirmedBy|last_confirmed_by|confirmedHow|confirmed_how|bgpCreatedStamp/, `${file} sets a confirmation`);
    assert.match(text, /requirementListingUpdates/, `${file} does not stamp the listing`);
  }
});

test('every requirements-centre route answers BGP staff only', () => {
  const routes = source('server/requirement-intake-routes.ts');
  const registered = [...routes.matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"\s*,\s*([^\n]*)/g)];
  assert.ok(registered.length >= 15, `found ${registered.length} routes`);
  for (const [, method, url, rest] of registered) {
    assert.match(url, /^\/api\/requirement-(suggestions|centre)\b/, `${method} ${url} is outside the staff-only prefixes`);
    assert.match(rest, /^requireAuth,\s*handle\(/, `${method} ${url} skips requireAuth or the staff check`);
  }
  const handle = find('server/requirement-intake-routes.ts', (n, ast) => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'handle');
  assert.match(handle, /await staffActor\(req\)/);
  const staffActor = find('server/requirement-intake-routes.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'staffActor');
  assert.match(staffActor, /client_view_mode/);
  assert.match(staffActor, /!== "client"/);
  assert.match(staffActor, /resolveCompanyScope\(req\)/);
  assert.match(staffActor, /STAFF_ONLY/);
});

test('client logins cannot log or change requirements through ChatBGP, and sql_write cannot fake provenance', () => {
  const blocked = find('server/chatbgp.ts', (n, ast) => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'CLIENT_BLOCKED_TOOLS');
  assert.match(blocked, /"create_requirement"/);
  assert.match(blocked, /"update_requirement"/);
  const sqlTools = source('server/sql-tools.ts');
  assert.match(sqlTools, /"requirement_evidence"/);
  assert.match(sqlTools, /REQUIREMENT_PROVENANCE_COLUMNS/);
  assert.doesNotMatch(code('server/chatbgp.ts'), /INSERT INTO requirements\b/i, 'ChatBGP still writes the old requirements table');
});

test('migration 0056 is additive, idempotent and listed', () => {
  const sql = source('migrations/0056_requirements_centre.sql').replace(/--.*$/gm, '');
  const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
  assert.ok(statements.length > 10);
  for (const statement of statements)
    assert.match(statement, /^(CREATE TABLE IF NOT EXISTS |ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS |CREATE (UNIQUE )?INDEX IF NOT EXISTS )/, statement.slice(0, 80));
  assert.doesNotMatch(sql, /\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b/);
  // A column added to a table that already has rows must be nullable.
  for (const statement of statements.filter(s => s.startsWith('ALTER TABLE'))) assert.doesNotMatch(statement, /NOT NULL/, statement);
  assert.deepEqual([...new Set([...sql.matchAll(/(?:ALTER TABLE|CREATE TABLE IF NOT EXISTS) (\w+)/g)].map(m => m[1]))].sort(), ['crm_requirements_leasing', 'requirement_evidence']);
  assert.match(source('server/schema-drift.ts'), /"0056_requirements_centre\.sql"/);
  const schema = source('shared/schema.ts');
  assert.match(schema, /pgTable\("requirement_evidence"/);
  for (const column of ['last_confirmed_at', 'last_confirmed_by', 'last_confirmed_by_name', 'confirmed_how', 'origin', 'external_requirement_id', 'last_listed_at', 'last_listed_source'])
    assert.ok(schema.includes(`"${column}"`), `shared/schema.ts does not declare ${column}`);
});

test('the page keeps staff tools from client logins and has no Wipe & resync', () => {
  const page = source('client/src/pages/requirements.tsx');
  assert.doesNotMatch(page, /resync-pipnet|resync-trl|Wipe (&|and) resync PIPnet|Wipe (&|and) resync TRL/);
  assert.match(page, /const canUseCentre = !!reqUser && !clientShape && /);
  for (const component of ['SuggestionTray', 'RequirementEvidenceDrawer']) {
    const at = page.indexOf(`<${component}`);
    assert.ok(at > 0, `${component} is not on the page`);
    assert.match(page.slice(Math.max(0, at - 1000), at), /canUseCentre/, `${component} is not behind canUseCentre`);
  }
  for (const id of ['requirements-list-', 'requirements-scope-', 'button-still-live-', 'button-evidence-', 'button-requirements-health', 'requirements-suggestions-waiting'])
    assert.ok(page.includes(id), `missing data-testid ${id}`);
});

test("ChatBGP's app map describes the centre and how a phone user reaches it", () => {
  const map = source('server/chatbgp-app-map.ts');
  for (const phrase of ['Requirements centre', '**To confirm**', '**Still live**', 'evidence drawer', '**Health report**', 'Suggestions to answer', '/requirements?list=to_confirm', 'take me to requirements', 'does not read email for requirements'])
    assert.ok(map.includes(phrase), `app map does not mention: ${phrase}`);
  assert.doesNotMatch(map, /no screen (yet )?for the Expanding list|not built yet: the To confirm/i);
});

test('only a person asking makes a requirement live: an automated ChatBGP run is refused', () => {
  const tool = find('server/chatbgp-requirements.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'runChatRequirementTool');
  const guard = tool.indexOf('isInternalStaffRequest(req)');
  assert.ok(guard > 0, 'runChatRequirementTool does not check for a server-originated run');
  assert.ok(guard < tool.indexOf('staffActor(req)'), 'the automated-run check must come before anything else');
  assert.ok(guard < tool.indexOf('pool.connect()'), 'the automated-run check must come before any write');
  assert.match(tool.slice(guard, guard + 300), /return \{ data: fail\(/);
});

test('only a pure publisher newsletter feeds requirement suggestions, never an agent firm\'s email', () => {
  const reader = find('server/news-brand-linking.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'extractBrandSignalsFromNewsletter');
  assert.match(reader, /if \(stories\.length && opts\.publisher\) await newsStoriesRead\(/);
  assert.equal([...reader.matchAll(/newsStoriesRead\(/g)].length, 1);
  const leg = find('server/insights-feed.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'runReportLeg');
  assert.match(leg, /const publisher = isPublisherSender\(from\)/);
  assert.match(leg, /const fullText = publisher \? newsletterStoryText\(/);
  assert.match(leg, /extractBrandSignalsFromNewsletter\(\{[^}]*publisher \}\)/);
  const publisher = find('server/insights-feed.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'isPublisherSender');
  assert.match(publisher, /r\.scope === "any"/);
  // The firms whose mail may be real correspondence stay "shared": they are never publishers.
  const rules = find('server/insights-feed.ts', (n, ast) => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'REPORT_SENDER_RULES');
  for (const firm of ['knightfrank.com', 'savills.com', 'cbre.com', 'costar.com', 'greenstreet.com'])
    assert.match(rules, new RegExp(`domain: "${firm.replace('.', '\\.')}", scope: "shared"`), `${firm} must not be a publisher`);
});

test('a client login gets no BGP owner, confirmation trace or hand-entered requirement', () => {
  const crm = source('server/crm.ts');
  // The list, the single GET and a contact's requirements send the client copy.
  assert.ok([...crm.matchAll(/requirementClientCopy\(/g)].length >= 3);
  const contact = crm.slice(crm.indexOf('app.get("/api/crm/contacts/:id/requirements"'), crm.indexOf('app.post("/api/crm/contacts/:id/requirements"'));
  assert.match(contact, /r\.companyId === reqScope \|\| requirementClientVisible\(r\)/);
  const copy = find('shared/requirement-live.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'requirementClientCopy');
  for (const field of ['bgpContactUserId', 'bgpContactUserIds', 'updatedAt']) assert.ok(copy.includes(`"${field}"`), `client copy keeps ${field}`);
  // Who's hot: a client counts only rows its own list shows, dated by the listing.
  const hub = crm.slice(crm.indexOf('app.get("/api/brands/hub"'), crm.indexOf('// Super brands'));
  assert.match(hub, /clientScoped \? ` AND \$\{requirementClientVisibleSql\("rl"\)\}` : ""/);
  assert.match(hub, /clientScoped \? "coalesce\(rl\.last_listed_at, rl\.created_at\)" : "rl\.updated_at"/);
  // A confirmation never writes a date onto a row clients are shown.
  const patch = find('server/requirement-intake.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'confirmationPatch');
  assert.match(patch, /!requirementClientVisible\(\{ sources: existing\.sources \}\)\) patch\.requirement_date/);
  // A viewing tells a client the linked requirement's name only when its list shows that row.
  const viewings = source('server/leasing-viewings.ts');
  assert.match(viewings, /if \(scoped && !v\.requirementClientVisible\) v\.requirementName = null/);
  // Score why-lines pass through the client view on both brand endpoints.
  assert.match(source('server/expansion-intel.ts'), /resolveCompanyScope\(req\)\) \? clientScoreView\(result\) : result/);
  assert.match(source('server/brand-ai-take.ts'), /resolveCompanyScope\(req\)\) \? clientScoreView\(result\) : result/);
});

test('the tray never splits a size at its thousands comma, and a first Confirm asks how the person knows', () => {
  const tray = source('client/src/components/requirement-centre.tsx');
  assert.match(tray, /const sizeList = \(v: string\) => v\.split\(\/\[;\\n\]\/\)/);
  assert.match(tray, /fields\.size = sizeList\(size\)/);
  assert.doesNotMatch(tray, /fields\.size = textList\(/);
  const page = source('client/src/pages/requirements.tsx');
  assert.match(page, /if \(liveMap\.get\(item\.id\)\?\.confirmed\) return stillLiveMutation\.mutate\(\{ id: item\.id \}\)/);
  for (const id of ['dialog-confirm-how', 'confirm-how-submit', 'button-undo-dismiss-draft-', 'button-undo-dismiss-news-']) assert.ok(page.includes(id), `missing data-testid ${id}`);
});


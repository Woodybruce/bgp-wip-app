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

test('email reaches the centre through one file, which only suggests; no other centre file reaches a mailbox', () => {
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

  // The email feed (Woody, 2026-11-15: yes to reading BGP's emails for what brands want).
  const feedFile = 'server/requirement-email-feed.ts';
  // The source without its comments (they describe what the code must not do).
  const feed = source(feedFile).replace(/^\s*\/\/.*$/gm, '');
  // Its one door into the centre is suggest: never a requirement, a confirmation or a write of its own.
  assert.match(feed, /\bsuggest\(store,/);
  assert.doesNotMatch(feed, /\bconfirm\(|stillLive\(|setOwner\(|INSERT INTO|UPDATE crm_|crm_requirements_leasing|requirement_evidence/i);
  // The private side of the mail boundary is checked on the fetched email before its words are taken.
  const privateCheck = feed.indexOf('isPrivateEmailRecord(message, mailbox)');
  assert.ok(privateCheck > -1 && privateCheck < feed.indexOf('const text = ownWords(message)'));
  // Anthropic through the capped reader, with its own daily allowance; never the provider switch.
  for (const name of imports(feedFile)) assert.doesNotMatch(name, /ai-provider|openai|gemini|utils\/anthropic-client/i, `${feedFile} imports ${name}`);
  assert.match(feed, /readStatedRequirements\(/);
  assert.match(feed, /REQUIREMENT_EMAIL_READER_DAILY_CAP/);
  // The sync hands it only a newly filed email the contact wrote: never BGP's own outgoing mail.
  assert.match(source('server/interactions.ts'), /if \(r\.rowCount && match\.method === "email" && !isBgpSender && options\.captureSignals !== false\) queueRequirementEmail\(requirementReads, msg, match\.contact\);/);
  assert.match(feed, /sender !== String\(contact\.email/);
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
  for (const phrase of ['Requirements centre', '**To confirm**', '**Still live**', 'evidence drawer', '**Health report**', 'Suggestions to answer', '/requirements?list=to_confirm', 'take me to requirements', '**Emails** (since 15 November 2026)', 'never the private mailbox'])
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

// Since 17 November 2026 every leasing requirement is open to a client login,
// to read, add and amend (Woody: "keep all requirements open for clients and
// access to amend and add"). What it is never sent is BGP's own: the owner,
// who confirmed one and when (and so the last edit a confirmation moves), and
// the state.
test('a client login reads every requirement but no BGP owner or confirmation trace', () => {
  const crm = source('server/crm.ts');
  // The list, the single GET, a contact's requirements and the replies to a client's add and save send the client copy.
  assert.ok([...crm.matchAll(/requirementClientCopy\(/g)].length >= 5);
  const list = crm.slice(crm.indexOf('app.get("/api/crm/requirements-leasing", async'), crm.indexOf('app.get("/api/crm/requirements-leasing/:id"'));
  assert.match(list, /if \(scopeCompanyId === NO_ACCESS_SCOPE \|\| await requirementViewer\(req\) === "joint_agent"\) return res\.json\(\[\]\);\s+reqs = reqs\.map\(\(r: any\) => requirementClientCopy\(r\)\);/);
  assert.doesNotMatch(list, /PIPnet/);
  const contact = crm.slice(crm.indexOf('app.get("/api/crm/contacts/:id/requirements"'), crm.indexOf('app.post("/api/crm/contacts/:id/requirements"'));
  assert.match(contact, /r\.requirementType === "leasing" \? Promise\.resolve\(true\)/);
  assert.doesNotMatch(contact, /requirementClientVisible|PIPnet/);
  const copy = find('shared/requirement-live.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'requirementClientCopy');
  for (const field of ['bgpContactUserId', 'bgpContactUserIds', 'updatedAt']) assert.ok(copy.includes(`"${field}"`), `client copy keeps ${field}`);
  // Who's hot: a client counts every requirement, dated by the listing or the day it was added, never a confirmation.
  const hub = crm.slice(crm.indexOf('app.get("/api/brands/hub"'), crm.indexOf('// Super brands'));
  assert.doesNotMatch(hub, /requirementClientVisibleSql|PIPnet/);
  assert.match(hub, /clientScoped \? "coalesce\(rl\.last_listed_at, rl\.created_at\)" : "rl\.updated_at"/);
  // A confirmation never writes a date onto a requirement: every row is shown to clients.
  const patch = find('server/requirement-intake.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'confirmationPatch');
  assert.doesNotMatch(patch, /patch\.requirement_date/);
  // A viewing tells a client the linked requirement's name; a joint agent's copy takes it off.
  const viewings = source('server/leasing-viewings.ts');
  assert.doesNotMatch(viewings, /requirementClientVisible/);
  assert.match(viewings, /for \(const key of \["contactId", "contact_id", "agentContactId", "agent_contact_id", "requirementId", "requirement_id",\s+"requirementName", "requirement_name"/);
  // Score why-lines pass through the client view on both brand endpoints.
  assert.match(source('server/expansion-intel.ts'), /resolveCompanyScope\(req\)\) \? clientScoreView\(result\) : result/);
  assert.match(source('server/brand-ai-take.ts'), /resolveCompanyScope\(req\)\) \? clientScoreView\(result\) : result/);
});

test('a client login adds a requirement and amends any through its own fields; only BGP staff delete one', () => {
  const crm = source('server/crm.ts');
  // The CRM write guard lets a client's create and save through, and nothing else under the path.
  const guard = find('server/crm.ts', (n, ast) => ts.isCallExpression(n) && n.expression.getText(ast) === 'app.use' && n.arguments[0]?.getText(ast) === '"/api/crm"' && n.getText(ast).includes('isClientRequestUser'));
  assert.match(guard, /\["\/contacts", "\/deals", "\/companies", "\/requirements-leasing"\]\.includes\(p\)/);
  assert.match(guard, /\^\\\/\(contacts\|deals\|properties\|requirements-leasing\)\\\/\[\^\/\]\+\$/);
  // The outer gateway names the path among the client writes.
  const index = source('server/index.ts');
  const writes = index.slice(index.indexOf('const CLIENT_ALLOWED_WRITES = ['), index.indexOf('const CLIENT_BLOCKED_SUBPATHS = ['));
  assert.ok(writes.includes('"/api/crm/requirements-leasing"'));
  // A client's add and save go through one checked door: the form's fields only.
  const door = find('server/crm.ts', (n, ast) => ts.isFunctionDeclaration(n) && n.name?.text === 'clientRequirementWrite');
  assert.match(door, /const data = clientRequirementFields\(req\.body\);/);
  assert.match(door, /isClientVisibleBrand\(String\(companyId\), scopeCompanyId\)/);
  assert.match(door, /if \(await requirementViewer\(req\) === "joint_agent"\) return \{ status: 403/);
  const post = crm.slice(crm.indexOf('app.post("/api/crm/requirements-leasing", async'), crm.indexOf('app.put("/api/crm/requirements-leasing/:id"'));
  assert.match(post, /Object\.assign\(parsed, clientCreatedStamp\(await getScopeCompanyName\(scopeCompanyId\)\)\);/);
  // Never confirmed, never owned by BGP: BGP's stamp is for BGP's own rows, after the client path has returned.
  assert.ok(post.indexOf('clientCreatedStamp') < post.indexOf('bgpCreatedStamp(creator)'));
  assert.match(post, /return res\.status\(201\)\.json\(requirementClientCopy\(created\)\);/);
  // Deleting a requirement is BGP staff's, whatever the gateway lets through.
  const del = crm.slice(crm.indexOf('app.delete("/api/crm/requirements-leasing/:id"'), crm.indexOf('app.post("/api/crm/requirements-leasing/:id/landlord-pack"'));
  assert.match(del, /if \(await resolveCompanyScope\(req\)\) return res\.status\(403\)/);
  assert.ok(del.indexOf('resolveCompanyScope') < del.indexOf('deleteCrmRequirementLeasing'));
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


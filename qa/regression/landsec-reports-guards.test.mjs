// Landsec reports (Woody, 2026-11-19): source guards.
//
// The reports are built from the feeds the pages read, key by key. These
// guards fail the build when the builders name anything of BGP's own (what it
// earns, how that is shared, its remarks on a record, who at BGP runs it, its
// mail, its compliance working), when a query of their own reaches past the
// few tables they are allowed, or when the access checks are taken off.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LANDSEC_REPORTS } from '../../shared/landsec-reports.ts';

const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const BUILDERS = 'server/landsec-reports.ts';
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(line => line.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/ .*$/, '')).join('\n');
const builders = code(read(BUILDERS));
// The board report (the tenth report): its builder is held to the same words, and its market report to its own rules.
const BOARD = 'server/landsec-board-report.ts';
const board = code(read(BOARD));
const market = code(read('server/landsec-board-market.ts'));

// Each is tried as a whole word, as a snake_case part and as a camelCase part.
const NEVER_NAMED = [
  'fee', 'fees', 'commission', 'allocation', 'allocations', 'invoice', 'invoiced', 'invoicing', 'xero', 'wip',
  'note', 'notes', 'comment', 'comments', 'commentary',
  'internal', 'agent_ids', 'bgp_contact', 'covers',
  'email', 'emails', 'mailbox', 'interaction', 'interactions', 'attendees',
  'aml', 'kyc', 'pep', 'compliance',
  'landlord_pack', 'extract', 'source_details', 'take',
];

test('the report builders never name a fee, a split, BGP notes, an internal agent, mail or compliance field', () => {
  // "jointAgent" (the joint agent's name on a deal, which a Landsec login reads on its Deals page) is the one allowed "agent" word.
  const words = builders.replace(/jointAgent|joint_agent/g, 'JOINTAGENT');
  const tokens = new Set();
  for (const id of words.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
    tokens.add(id.toLowerCase());
    for (const part of id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split('_')) if (part) tokens.add(part);
  }
  const named = NEVER_NAMED.filter(word => tokens.has(word) || new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'i').test(words.toLowerCase().replace(/[^a-z_]+/g, ' ')));
  assert.deepEqual(named, [], `server/landsec-reports.ts names: ${named.join(', ')}`);
  // The board report's builder, by the same test.
  const boardWords = board.replace(/jointAgent|joint_agent/g, 'JOINTAGENT');
  const boardTokens = new Set();
  for (const id of boardWords.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
    boardTokens.add(id.toLowerCase());
    for (const part of id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split('_')) if (part) boardTokens.add(part);
  }
  const boardNamed = NEVER_NAMED.filter(word => boardTokens.has(word) || new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'i').test(boardWords.toLowerCase().replace(/[^a-z_]+/g, ' ')));
  assert.deepEqual(boardNamed, [], `${BOARD} names: ${boardNamed.join(', ')}`);
  assert.doesNotMatch(board, /\.\.\.\s*(d|u|v|o|row|b|l)\b(?!\.)/, 'a deal, unit, viewing, offer or plan line is never spread: every key is named');
  // The clock feed's row carries BGP's fee for staff. A row is never spread into a report.
  assert.doesNotMatch(builders, /\.\.\.\s*d\b/, 'a deal row is never spread: every key is named');
  assert.doesNotMatch(builders, /\.\.\.\s*(u|v|c)\b(?!\.)/, 'a unit, viewing or comparable is never spread: every key is named');
});

test('the queries of their own read only deal dates, company names and who is asking', () => {
  const sql = Array.from(builders.matchAll(/pool\.query\(\s*`([\s\S]*?)`/g)).map(m => m[1]);
  assert.equal(sql.length, 3, 'three queries: deal dates, brand names for requirements, the name of who made the report');
  const tables = new Set();
  for (const text of sql) for (const m of text.matchAll(/\b(?:FROM|JOIN)\s+(?:LATERAL\s*\(\s*SELECT[\s\S]*?FROM\s+)?([a-z_]+)/gi)) tables.add(m[1].toLowerCase());
  for (const table of tables) {
    // moves and stamps are the deal dates read's own two steps over deal_audit_log (each deal's status moves, and how many deals each minute stamped).
    assert.ok(['crm_deals', 'crm_companies', 'available_units', 'tenancy_schedule_units', 'deal_audit_log', 'users', 'moves', 'stamps'].includes(table), `a report query reads ${table}`);
  }
  assert.ok(tables.has('crm_deals') && tables.has('deal_audit_log'));
  for (const text of sql) {
    assert.doesNotMatch(text, /SELECT\s+\*|\b[a-z]+\.\*/i, 'named columns only');
    assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i, 'the reports write nothing');
  }
});

test('units, deals, viewings, requirements and the category count come from the pages\' own feeds', () => {
  for (const feed of ['propertyReadBlocked(ctx.req, property.id)', 'loadPropertyUnits(pool, property.id)', 'unitsForViewer(feed, viewer)', 'unitViewerFor(ctx.req)',
    'landsecDealsFeed(ctx.req)', 'listLeasingViewings({ companyId: viewer.companyId', 'requirementReason(r).clientText', 'storage.getCrmRequirementsLeasing(', 'storage.getCrmComps(', 'categoryMixByProperty(']) {
    assert.ok(builders.includes(feed), `the builders call ${feed}`);
  }
  // Viewings are read as a Landsec login reads them, never as BGP staff (no company = every landlord's viewings).
  assert.doesNotMatch(builders, /listLeasingViewings\(\s*(null|\{\s*companyId:\s*null)/);
  // A requirement goes out as the client wording of what it is: never its state or who confirmed it.
  for (const never of ['lastConfirmed', 'last_confirmed', 'confirmedHow', 'confirmed_how', 'bgpContactUser', '.text,', 'reason.text', 'requirementLive(']) {
    assert.ok(!builders.includes(never), `the builders do not use ${never}`);
  }
});

test('every route asks who is calling first, and a joint agent or another landlord\'s login gets nothing', () => {
  const routes = builders.slice(builders.indexOf('export function setupLandsecReportRoutes'));
  const handlers = routes.split(/app\.get\(/).slice(1);
  assert.equal(handlers.length, 2, 'the index and one report');
  for (const handler of handlers) {
    assert.match(handler, /^"\/api\/landsec\/reports(\/:key)?", requireAuth, async/);
    const first = handler.slice(handler.indexOf('try {') + 5).trim();
    assert.match(first, /^const viewer = await reportViewer\(req\);\s*if \(!viewer\) return res\.status\(403\)/, 'the viewer is resolved before anything else');
  }
  assert.match(builders, /export async function reportViewer\(req: Request\): Promise<LandsecViewer \| null> \{\s*const viewer = await landsecViewer\(req\);\s*if \(!viewer \|\| viewer\.role === "joint_agent"\) return null;/);
  // The schemes come from the login, and a key that is asked for only narrows them.
  assert.match(builders, /portfolio\.schemes\.filter\(s => viewerCanSeeScheme\(viewer, s\.key\)\)/);
  assert.match(builders, /return allowed\.filter\(s => want\.has\(s\.key\)\);/);
  assert.match(routes, /pickSchemes\(await reportSchemesFor\(viewer\), req\.query\.schemes\)/);
  // The period is the one rule.
  assert.match(routes, /parseReportPeriod\(req\.query\.from, req\.query\.to\)/);
  assert.doesNotMatch(routes, /app\.(post|put|patch|delete)\(/, 'reports are read only');
});

test('the gateways: a client login reaches the reports, a joint agent is refused in both lists', () => {
  const index = read('server/index.ts');
  const allowed = index.slice(index.indexOf('const CLIENT_ALLOWED_API = ['));
  assert.match(allowed.slice(0, allowed.indexOf('];')), /"\/api\/landsec\/"/, 'GET /api/landsec/reports passes the client gateway');
  assert.match(index, /import \{ setupLandsecReportRoutes \} from "\.\/landsec-reports";/);
  assert.match(index, /\n\s*setupLandsecReportRoutes\(app\);/);
  const landsec = read('shared/landsec.ts');
  const denied = landsec.slice(landsec.indexOf('export function jointAgentApiDenied'), landsec.indexOf('export function landsecLoginSchemes'));
  assert.match(denied, /if \(\/\^\\\/api\\\/landsec\\\/reports\(\\\/\|\$\)\/\.test\(p\)\) return true;/);
  const rule = landsec.slice(landsec.indexOf('export function restrictedLandsecApiRule'));
  assert.match(rule, /if \(jointAgent && \/\^\\\/api\\\/landsec\\\/reports\(\\\/\|\$\)\/\.test\(p\)\) return "deny";\s*return "allow";/, 'the shared /api/landsec/ prefix does not open reports to a joint agent');
});

test('the board report: the same feeds, a Landsec reading of the brand plan, and two named-column queries of its own', () => {
  for (const feed of ['unitsFor(ctx)', 'clockFor(ctx)', 'dealDatesFor(ctx)', 'listLeasingViewings({ companyId: viewer.companyId, propertyIds: new Set(propertyIds), jointAgent: false })',
    'clientBrandSliceSql(viewer.companyId, "c.id")', 'loadBoardMarket(ctx.period, ctx.schemes.map(s => s.key))']) {
    assert.ok(board.includes(feed), `the board report calls ${feed}`);
  }
  // The brand plan is read as a Landsec login reads it, whoever asks: never as BGP staff.
  assert.match(board, /const planViewer: PlanViewer = \{ kind: "landsec", clientCompanyId: viewer\.companyId, schemes: keys \};/);
  assert.doesNotMatch(board, /STAFF_VIEWER|kind: "staff"|nameMatches|alsoBrandIds/);
  assert.doesNotMatch(board, /listLeasingViewings\(\s*(null|\{\s*companyId:\s*null)/);
  // Of a plan line it names the scheme, the unit's label, the stage and its dates. Nothing else.
  for (const never of ['.owner', '.wish', '.nextStep', '.links', '.requirement', 'notProceedingReason', '.lead', '.aim', 'onHold', 'superBrand', 'openActions', 'nextAction']) {
    assert.ok(!board.includes(never), `the board report does not read ${never}`);
  }
  const sql = Array.from(board.matchAll(/pool\.query\(\s*`([\s\S]*?)`/g)).map(m => m[1]);
  assert.equal(sql.length, 2, 'two queries: offers by day, and brand names with their type');
  const tables = new Set();
  for (const text of sql) for (const m of text.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)) tables.add(m[1].toLowerCase());
  assert.deepEqual(Array.from(tables).sort(), ['available_units', 'crm_companies', 'unit_offers']);
  for (const text of sql) {
    assert.doesNotMatch(text, /SELECT\s+\*|\b[a-z]+\.\*/i, 'named columns only');
    assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i, 'the board report writes nothing');
    assert.doesNotMatch(text, /rent|premium|incentive|contribution|deposit|contact/i, 'an offer is counted, never priced');
  }
  // An offer nobody has confirmed is not counted, and every figure says how it is counted.
  assert.match(board, /\(o\.source IS NULL OR o\.confirmed_at IS NOT NULL\) AS logged/);
  for (const key of ['lettings', 'hots', 'instructions', 'viewings', 'offers', 'occupancy', 'bulk', 'growth', 'speed', 'brands']) assert.match(board, new RegExp(`\\b${key}: "`), `how ${key} is counted`);
  assert.match(board, /A letting Landsec did without BGP is in it only if it is on the app\./);
  // The rules are the shared file's: no second count here.
  assert.match(board, /activity: boardActivity\(\{ deals, viewings, offers \}, ctx\.period, today\),\s*growth: rentalGrowth\(deals, ctx\.period\),\s*speed: dealSpeed\(deals, ctx\.period\),/);
  // The market report prints only what a person saved.
  assert.match(board, /const saved = BOARD_MARKET_SECTIONS\.filter\(s => market\[s\.key\]\?\.text\);/);
  assert.doesNotMatch(board, /draftMarketSection|marketDraftPrompt|anthropic/i, 'the builder never drafts');
});

test('the market report: every route asks who is calling first, drafting is BGP staff only, and a draft is never saved by itself', () => {
  const routes = market.slice(market.indexOf('export function setupLandsecBoardMarketRoutes'));
  const handlers = routes.split(/app\.(?:get|put|post)\(/).slice(1);
  assert.equal(handlers.length, 3, 'read, save and draft');
  for (const handler of handlers) {
    assert.match(handler, /^"\/api\/landsec\/reports\/board-report\/market(\/draft)?", requireAuth, async/);
    const first = handler.slice(handler.indexOf('try {') + 5).trim();
    assert.match(first, /^const viewer = await reportViewer\(req\);\s*if \(!viewer\) return res\.status\(403\)/, 'the viewer is resolved before anything else');
    assert.match(handler, /await scopeOf\(viewer, /, 'the period and the schemes are cut to the caller');
  }
  assert.doesNotMatch(routes, /app\.(patch|delete)\(/);
  const draft = handlers[2];
  assert.match(draft.slice(draft.indexOf('try {') + 5).trim(), /^const viewer = await reportViewer\(req\);\s*if \(!viewer\) return res\.status\(403\)\.json\(REFUSED\);\s*if \(!\(await contactViewer\(req\)\)\.staff\) return res\.status\(403\)/, 'a draft is for BGP staff signed in as themselves');
  assert.doesNotMatch(draft, /saveBoardMarketSection|system_settings/, 'the draft route saves nothing');
  // The schemes a request names only narrow the caller's own.
  assert.match(market, /const schemes = pickSchemes\(await reportSchemesFor\(viewer\), asked\);/);
  // Anthropic, called directly, one call, under a daily allowance that 0 switches off.
  assert.match(market, /getAnthropicClient\(true\)\.messages\.create\(/);
  assert.equal((market.match(/messages\.create\(/g) || []).length, 1);
  assert.doesNotMatch(market, /callClaude|openai|perplexity|gemini/i);
  assert.match(market, /process\.env\.LANDSEC_BOARD_DRAFT_DAILY_CAP/);
  assert.match(market, /claimDailyRead\(USAGE_KEY, boardDraftDailyCap\(\)\)/);
  const draftFn = market.slice(market.indexOf('export async function draftMarketSection'), market.indexOf('// ── Routes'));
  assert.ok(draftFn.indexOf('hasKey()') < draftFn.indexOf('await claim()') && draftFn.indexOf('await claim()') < draftFn.indexOf('(deps.ask || askAnthropic)'), 'the key, then the allowance, then the call');
  // What it is sent: public signals with a link and no rumour, and research on centres that are not Landsec's own.
  assert.match(market, /s\.source ~\* '\^https\?:\/\/'/);
  assert.match(market, /COALESCE\(s\.signal_type, ''\) <> 'rumour' AND COALESCE\(s\.confidence, ''\) <> 'rumour'/);
  assert.match(market, /if \(ownPropertyIds\.has\(record\.id\)\) continue;/);
  const sql = Array.from(market.matchAll(/\.query\(\s*`([\s\S]*?)`/g)).map(m => m[1]);
  const tables = new Set();
  for (const text of sql) for (const m of text.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/gi)) tables.add(m[1].toLowerCase());
  assert.deepEqual(Array.from(tables).sort(), ['brand_signals', 'system_settings', 'users']);
  assert.doesNotMatch(sql.find(text => text.includes('brand_signals')), /\bdetail\b|SELECT\s+\*|[a-z]\.\*/i, 'a signal is its date, kind, headline and link');
  // Stored in system_settings under the period and scheme set: no table of its own.
  assert.match(read('shared/landsec-board-report.ts'), /`landsec_board_report:\$\{from\}:\$\{to\}:\$\{digest\}`/);
  // A save over somebody else's newer text is refused.
  assert.match(market, /FOR UPDATE/);
  assert.match(market, /if \(\(now\?\.savedAt \|\| ""\) !== String\(input\.loadedAt \|\| ""\)\) \{\s*throw new BoardMarketError\(409,/);
  // The gateway: a client login may save, and both routes files are mounted.
  const index = read('server/index.ts');
  const writes = index.slice(index.indexOf('const CLIENT_ALLOWED_WRITES = ['));
  assert.match(writes.slice(0, writes.indexOf('];')), /"\/api\/landsec\/reports\/board-report\/market"/);
  assert.match(index, /\n\s*setupLandsecBoardMarketRoutes\(app\);/);
});

test('every report on the registry has a builder, and no builder is off the registry', () => {
  const body = builders.slice(builders.indexOf('export async function buildLandsecReport'), builders.indexOf('export function setupLandsecReportRoutes'));
  const built = Array.from(body.matchAll(/case "([a-z-]+)":/g)).map(m => m[1]);
  assert.deepEqual(built.slice().sort(), LANDSEC_REPORTS.map(r => r.key).sort());
  assert.match(body, /default: throw new Error/);
  // Budgets are not held, so no sheet of that name is made.
  assert.doesNotMatch(builders, /budget/i);
});

test('every workbook opens on an About sheet that says what it holds', () => {
  assert.match(builders, /const about = wb\.addWorksheet\("About"\);/);
  for (const line of ['["Period", ctx.period.label]', '["Schemes", ctx.schemes.map(s => s.name).join(", ")]', '["Made by", ctx.madeBy]', '["Made on", longDay(ctx.madeAt)]', '["Source", `ChatBGP. ${HELD}`]']) {
    assert.ok(builders.includes(line), line);
  }
  assert.match(builders, /const HELD = "It holds what is recorded in ChatBGP on the day it was made\./);
});

test('the page only asks: the list and the rule come from the shared file, and it calls the reports addresses alone', () => {
  const page = code(read('client/src/pages/landsec-reports.tsx'));
  assert.match(page, /from "@shared\/landsec-reports";/);
  assert.match(page, /parseReportPeriod\(from, to\)/);
  assert.match(page, /const others = data\.reports\.filter\(def => def\.card !== "board"\);/);
  assert.match(page, /others\.map\(def =>/);
  // The board report's card leads the list, and its editor asks only the market report's addresses.
  assert.ok(page.indexOf('data-testid="landsec-report-board"') > 0 && page.indexOf('data-testid="landsec-report-board"') < page.indexOf('others.map(def =>'));
  const editor = code(read('client/src/components/landsec/board-market-editor.tsx'));
  const asked = Array.from(editor.matchAll(/["`](\/api\/[^"`?$]*)/g)).map(m => m[1]);
  assert.deepEqual(Array.from(new Set(asked)).sort(), ['/api/landsec/reports/board-report/market', '/api/landsec/reports/board-report/market/draft']);
  assert.match(editor, /\{data\.canDraft && \(/, 'Draft is offered only where the server says so');
  assert.doesNotMatch(editor, /landsecRole|joint_agent|isStaff/, 'who may save or draft is decided on the server');
  const called = Array.from(page.matchAll(/["`](\/api\/[^"`?$]*)/g)).map(m => m[1]);
  assert.ok(called.length >= 2);
  for (const address of called) assert.match(address, /^\/api\/landsec\/reports(\/|\/board-report\/market(\/draft)?)?$/, address);
  assert.doesNotMatch(page, /landsecRole|joint_agent|isStaff/, 'who may run a report is decided on the server');
  const app = read('client/src/App.tsx');
  assert.match(app, /<Route path="\/landsec\/reports" component=\{LandsecReports\} \/>/);
});

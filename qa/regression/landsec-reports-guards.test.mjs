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
// The decks (Woody, 2026-11-19: "we dont need complicated excels just visual PDF which can also be power point"):
// the slide model, what is on each slide, the gathering, and the two renderers.
const MODEL = 'shared/landsec-deck.ts', COMPOSE = 'shared/landsec-decks.ts', GATHER = 'server/landsec-decks.ts', PDF = 'server/landsec-deck-pdf.ts', PPTX = 'server/landsec-deck-pptx.ts', LOGO = 'server/landsec-report-logo.ts';
const marketDeckCode = code(read('shared/landsec-market-deck.ts'));
const model = code(read(MODEL)), compose = code(read(COMPOSE)), gather = code(read(GATHER)), pdf = code(read(PDF)), pptx = code(read(PPTX)), logo = code(read(LOGO));
const namedIn = text => {
  const words = text.replace(/jointAgent|joint_agent/g, 'JOINTAGENT');
  const tokens = new Set();
  for (const id of words.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
    tokens.add(id.toLowerCase());
    for (const part of id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split('_')) if (part) tokens.add(part);
  }
  return NEVER_NAMED.filter(word => tokens.has(word) || new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'i').test(words.toLowerCase().replace(/[^a-z_]+/g, ' ')));
};

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
  // The decks, by the same test: the slide model, what is on each slide, the gathering and both renderers.
  for (const [file, text] of [[MODEL, model], [COMPOSE, compose], [GATHER, gather], [PDF, pdf], [LOGO, logo]]) assert.deepEqual(namedIn(text), [], `${file} names: ${namedIn(text).join(', ')}`);
  // The PowerPoint renderer calls pptxgenjs's own addNotes to put a slide's rule under it: its one use of the word.
  assert.deepEqual(namedIn(pptx.replace(/slide\.addNotes\(/g, 'slide.addUnder(')), [], `${PPTX} names a word it should not`);
  assert.equal((pptx.match(/addNotes\(/g) || []).length, 1);
  assert.doesNotMatch(gather, /\.\.\.\s*(d|u|v|r|row|s)\b(?!\.)/, 'a unit, viewing, letting or scheme row is never spread into a deck: every key is named');
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
    'landsecDealsFeed(ctx.req)', 'listLeasingViewings({ companyId: viewer.companyId', 'requirementReason(r).clientText', 'storage.getCrmRequirementsLeasing(', 'storage.getCrmComps(']) {
    assert.ok(builders.includes(feed), `the builders call ${feed}`);
  }
  // The decks gather through the reports' own reads and the pages' feeds: no query of their own anywhere.
  for (const feed of ['boardData(ctx, viewer)', 'unitsFor(ctx)', 'activityRows(ctx)', 'categoryMixByProperty(scheme.properties.map(p => p.id))',
    'listLeasingViewings({ companyId: viewer.companyId, propertyIds: new Set(schemeOfProperty.keys()), jointAgent: false })', 'loadBoardMarket(ctx.period, ctx.schemes.map(s => s.key))',
    '.filter(v => viewingHeld(v, ctx.period, today))']) {
    assert.ok(gather.includes(feed), `the decks call ${feed}`);
  }
  for (const [file, text] of [[MODEL, model], [COMPOSE, compose], [GATHER, gather], [PDF, pdf], [PPTX, pptx]]) {
    assert.doesNotMatch(text, /\.query\(|from "\.\/db"|from "\.\/storage"|\bpool\b/, `${file} reads no table itself`);
    assert.doesNotMatch(text, /anthropic|openai|perplexity|callClaude|\bfetch\(/i, `${file} asks nothing outside the app`);
    assert.doesNotMatch(text, /setInterval|setTimeout|cron|registerJob/i, `${file} runs only when a deck is asked for`);
  }
  assert.doesNotMatch(gather, /listLeasingViewings\(\s*(null|\{\s*companyId:\s*null)/);
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
  // Of a plan line it names the scheme, the unit's label, the stage and its dates, and for the target tenants its
  // dated records as events, its next step and whether a requirement is held, each as the Landsec reading of the
  // plan sends it (Woody, 2026-11-19: "should be a section on leasing activity on target tenants"). Nothing else.
  for (const never of ['.owner', '.wish', '.links', '.notes', 'notProceedingReason', '.lead', '.aim', 'onHold', 'superBrand', 'openActions', 'nextAction', '.daysWaiting', '.refId', '.requirementId', '.range', '.byName']) {
    assert.ok(!board.includes(never), `the board report does not read ${never}`);
  }
  assert.equal((board.match(/row\.nextStep/g) || []).length, 4, 'the next step is read in one place');
  assert.match(board, /next: row\.nextStep \? \{ title: row\.nextStep\.title, due: reportDay\(row\.nextStep\.dueAt\), who: row\.nextStep\.who \} : null,/);
  assert.deepEqual(board.match(/\.requirement\b[^,;\n]*/g), ['.requirement.chip !== "no_requirement"'], 'of a requirement, only whether one is held');
  // An evidence line is read as an event by the shared rule, from its source and the plan's own label: its label is never printed.
  assert.match(board, /for \(const e of row\.evidence\) \{ const kind = targetEvent\(e\.src, e\.label\); if \(kind\) events\.push\(\{ kind, day: reportDay\(e\.at\) \}\); \}/);
  assert.equal((board.match(/e\.label/g) || []).length, 1);
  assert.match(board, /targets: plan \? targetTenants\(plan\.lines, ctx\.period, today\) : null,/);
  // The asset profile reads the same plan the same way, whoever asks.
  assert.match(gather, /const plan = await brandLinesFor\(ctx, viewer\)\.catch\(/);
  assert.match(gather, /targets: plan \? targetTenants\(plan\.lines, ctx\.period, londonDay\(ctx\.madeAt\)\) : null,/);
  assert.doesNotMatch(gather + compose, /STAFF_VIEWER|kind: "staff"|loadPlan\(|brandGrid\(/, 'the decks never read the plan themselves');
  // The counting is the shared rule's: a target is a brand between Wanted and Let, and the period is counted from dated records only.
  const rules = read('shared/landsec-board-report.ts');
  assert.match(rules, /export const TARGET_STAGES: BrandStage\[\] = \["wanted", "unit_identified", "approached", "viewed", "negotiating", "hots", "solicitors", "let"\];/);
  assert.match(rules, /const inPeriod = \(day: string \| null \| undefined\): day is string => !!day && inReportPeriod\(day, period\) && day\.slice\(0, 10\) <= today;/);
  assert.match(rules, /if \(dated\.length === 0\) out\.undated \+= 1;/);
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
  // The market report's words on a slide are only what a person saved: the deck reads them from the store and writes none.
  assert.match(compose, /slides\.push\(\.\.\.boardMarketSlides\(\{ period: input\.period, schemes: input\.schemes, footer: input\.footer, data: input\.marketData, words: input\.market \}\)\);/);
  assert.match(marketDeckCode, /if \(!o\.saved\?\.text\) \{/, 'a sector with nothing saved shows its items and no words');
  assert.match(marketDeckCode, /pageWords\(text\.split\(/);
  assert.doesNotMatch(compose + gather + marketDeckCode, /draftMarketSection|marketDraftRequest|anthropic/i, 'a deck never drafts');
  assert.doesNotMatch(board, /draftMarketSection|marketDraftRequest|anthropic/i, 'the builder never drafts');
});

test('the market report: every route asks who is calling first, drafting is BGP staff only, and a draft is never saved by itself', () => {
  const routes = market.slice(market.indexOf('export function setupLandsecBoardMarketRoutes'));
  const handlers = routes.split(/app\.(?:get|put|post)\(/).slice(1);
  assert.equal(handlers.length, 4, 'read, what the sections are written from, save and draft');
  for (const handler of handlers) {
    assert.match(handler, /^"\/api\/landsec\/reports\/board-report\/market(\/draft|\/material)?", requireAuth, async/);
    const first = handler.slice(handler.indexOf('try {') + 5).trim();
    assert.match(first, /^const viewer = await reportViewer\(req\);\s*if \(!viewer\) return res\.status\(403\)/, 'the viewer is resolved before anything else');
    assert.match(handler, /await scopeOf\(viewer, /, 'the period and the schemes are cut to the caller');
  }
  assert.doesNotMatch(routes, /app\.(patch|delete)\(/);
  const draft = handlers[3];
  // BGP's team posts go to BGP staff signed in as themselves and nobody else: the one door for them asks first.
  assert.match(market, /async function postsFor\(req: Request, period: ReportPeriod\): Promise<MarketTeamPost\[\]> \{\s*if \(!\(await contactViewer\(req\)\)\.staff\) return \[\];/);
  assert.equal((market.match(/teamPosts\(/g) || []).length, 1, 'the posts are read in one place');
  assert.equal((market.match(/postsFor\(req, period\)/g) || []).length, 2, 'the list for the editor, and the draft');
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
  // What it is sent is the section's own material, the same lines the editor lists: nothing is read here for the draft alone.
  assert.match(draft, /const sheet = sheetOf\(material\)\.find\(s => s\.key === section\.key\)!;/);
  assert.match(draft, /res\.json\(await draftMarketSection\(\{ section: \{ key: section\.key, title: section\.title \}, periodLabel: period\.label, schemes: schemes\.map\(s => s\.name\), facts: sheet\.facts, items: sheet\.items, movers: sheet\.movers, research: sheet\.research, themes: sheet\.themes, posts: about \}\)\);/);
  const sql = Array.from(market.matchAll(/\.query\(\s*`([\s\S]*?)`/g)).map(m => m[1]);
  const tables = new Set();
  for (const text of sql) for (const m of text.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/gi)) tables.add(m[1].toLowerCase());
  assert.deepEqual(Array.from(tables).sort(), ['system_settings', 'users']);
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

// Woody, 2026-11-19: "what abiut marklet reports and insigts of the industry generally?", then "yes do that as suggested".
test('the industry figures: four public reads across the brand directory, none of BGP\'s own, each allowed to fail', () => {
  const industry = code(read('server/landsec-board-industry.ts'));
  const tokens = new Set();
  for (const id of industry.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
    tokens.add(id.toLowerCase());
    for (const part of id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split('_')) if (part) tokens.add(part);
  }
  const named = NEVER_NAMED.filter(word => tokens.has(word));
  assert.deepEqual(named, [], `server/landsec-board-industry.ts names: ${named.join(', ')}`);
  const sql = Array.from(industry.matchAll(/db\.query\(\s*`([\s\S]*?)`/g)).map(m => m[1]);
  assert.equal(sql.length, 4, 'signals, store counts, planning and jobs, requirements: no query per brand');
  assert.doesNotMatch(industry, /for \([^)]*\)\s*\{[^}]*await db\.query/, 'never a query inside a loop');
  const tables = new Set();
  for (const text of sql) for (const m of text.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)) tables.add(m[1].toLowerCase());
  assert.deepEqual(Array.from(tables).sort(), ['brand_pipeline_items', 'brand_signals', 'brand_store_counts', 'crm_companies', 'crm_requirements_leasing']);
  for (const text of sql) {
    assert.doesNotMatch(text, /SELECT\s+\*|\b[a-z]\.\*/i, 'named columns only');
    assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i, 'it writes nothing');
    assert.match(text, /\$\{BRAND\}/, 'every read is held to brands on the directory');
    // Nothing of BGP's own: no star, no hold, no owner at BGP, no score, no confirmation, no remark.
    assert.doesNotMatch(text, /hunter|concept_status|bgp_|confirmed|score|description|ai_generated/i);
  }
  assert.match(industry, /const BRAND = `c\.company_type ILIKE 'tenant%' AND c\.archived_at IS NULL AND c\.merged_into_id IS NULL`;/, 'a hidden brand is left out');
  assert.match(industry, /isJunkBrand\(\{ name: row\.name, companyType: row\.company_type \}\) \? null/, 'a junk brand is left out');
  // A signal is a public report: one with a link, or one out of a trade publisher's newsletter. Never a rumour, and never a line
  // BGP typed about its own deal (those carry neither). Of its stored detail only what the story states about space is handed on.
  const signals = sql.find(text => text.includes('brand_signals'));
  assert.doesNotMatch(signals, /s\.sentiment|s\.dedupe/);
  assert.match(signals, /AND \(s\.source ~\* '\^https\?:\/\/' OR s\.source ILIKE 'newsletter:%'\)/);
  assert.match(signals, /COALESCE\(s\.signal_type, ''\) <> 'rumour' AND COALESCE\(s\.confidence, ''\) <> 'rumour'/);
  assert.match(industry, /const publisher = letter \? newsletterPublisherOf\(r\.detail\) : null;\s*if \(letter && !publisher\) continue;/, 'a newsletter from anyone but a trade publisher is not read');
  assert.match(industry, /const stated = \/\^Stated: \/\.test\(String\(r\.detail \|\| ""\)\) \? String\(r\.detail\)\.split\(\/\\s\+Via newsletter:\/\)\[0\] : null;/);
  assert.match(industry, /detail: stated, source, publisher,/);
  // A requirement is what it is and its own date, as every client screen words it: never its state, who holds it at BGP, or a confirmation.
  const requirements = sql.find(text => text.includes('crm_requirements_leasing'));
  assert.doesNotMatch(requirements, /last_confirmed|confirmed_how|bgp_contact|landlord_pack|principal_contact|deal_id/);
  assert.match(industry, /record: requirementReason\(r, today\)\.clientText \}\);/);
  // Only good store counts, and no tree or telecoms application (the Expansion card's own exclusion).
  assert.match(sql.find(text => text.includes('brand_store_counts')), /n\.error IS NULL/);
  assert.match(industry, /NOT IN \(\$\{NEVER_AN_OCCUPIER_TYPES\.map\(t => `'\$\{t\}'`\)\.join\(", "\)\}\)/);
  // Each read fails on its own to "not available".
  assert.equal((industry.match(/attempt\("/g) || []).length, 4);
  assert.match(industry, /try \{ return await run\(\); \} catch \(e: any\) \{ console\.warn\(.*\); return null; \}/);
  assert.doesNotMatch(industry, /anthropic|perplexity|openai|fetch\(/i, 'counted from what the app holds: no outside call');
  // The research library and the Insights cards are read elsewhere (server/landsec-market-report.ts), not here.
  // The counting, and the line saying what it does not hold, are the shared file's.
  const shared = read('shared/landsec-board-report.ts');
  assert.match(shared, /It holds no footfall, sales, turnover, consumer spending or rental index: the app holds none\./);
  assert.match(board, /industry: BOARD_MARKET_SECTIONS\.map\(s => \(\{ key: s\.key, title: s\.title, figures: industryFigures\(industryCountInput\(industryRows\), s\.group, ctx\.period\) \}\)\),/);
  assert.match(shared, /if \(site !== "news\.google\.com"\) return \{ headline: words, site \};/);
});

// Woody, 2026-11-19: "The market analysis reports need to be surrounding the brands and who's doing what news etc including all
// the info we get each month from the team news propel etc needs to give a comprehensive market report broken into sectors
// similar to our brands page. But also to include any competition news such as buying shopping centres or their leasing ie
// Hammerson and Canary Wharf". On what Landsec may be shown: "Ignore Jack! This is landsec they should have intel that we do
// including other schemes"; and, asked whether live deals at other clients' schemes should show: "Switch on".
test('the market report: a fixed set of named reads, public news by headline only, and of another landlord\'s letting only who, where and how far', () => {
  const FILE = 'server/landsec-market-report.ts';
  const report = code(read(FILE));
  assert.deepEqual(namedIn(report), [], `${FILE} names: ${namedIn(report).join(', ')}`);
  assert.deepEqual(namedIn(marketDeckCode), [], `shared/landsec-market-deck.ts names: ${namedIn(marketDeckCode).join(', ')}`);
  const rules = code(read('shared/landsec-market-report.ts'));
  assert.deepEqual(namedIn(rules), [], `shared/landsec-market-report.ts names: ${namedIn(rules).join(', ')}`);
  const sql = Array.from(report.matchAll(/db\.query\(\s*`([\s\S]*?)`/g)).map(m => m[1]);
  assert.equal(sql.length, 8, 'owners, landlord names, news, themes, research, lettings, sales, tracker: no query per brand or per landlord');
  assert.doesNotMatch(report, /for \([^)]*\)\s*\{[^}]*await db\.query/, 'never a query inside a loop');
  const tables = new Set();
  for (const text of sql) for (const m of text.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)) tables.add(m[1].toLowerCase());
  // The catalogue of landlords is a list of names: its own test of who is a landlord looks at deals and properties, and reads nothing from them.
  assert.deepEqual(Array.from(tables).sort(), ['crm_companies', 'crm_deals', 'crm_properties', 'insights', 'investment_comps', 'investment_research_reads', 'investment_tracker', 'knowledge_base', 'news_articles', 'news_sources']);
  for (const text of sql) {
    assert.doesNotMatch(text, /SELECT\s+\*|\b[a-z]+\.\*/i, 'named columns only');
    assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i, 'it writes nothing');
  }
  // Another landlord's letting: the brand, the scheme, its landlord, the two dates and the status. Nothing else of the deal.
  const lettings = sql.find(text => text.includes('FROM crm_deals d'));
  assert.match(lettings, /SELECT d\.tenant_id, c\.name, c\.company_type, p\.name AS scheme, l\.name AS landlord, d\.status, d\.exchanged_at, d\.completed_at\s+FROM crm_deals d/);
  assert.doesNotMatch(lettings, /rent|premium|incentive|capital|break|lease_length|term|area|sqft|ref|d\.name|d\.id\b|target_date|solicitor|team/i, 'never a rent, an incentive, lease terms, a reference or who runs it');
  assert.match(lettings, /AND NOT \(d\.property_id = ANY\(\$2::varchar\[\]\)\) AND COALESCE\(p\.landlord_id, d\.landlord_id, ''\) <> \$3/, 'the viewer\'s own schemes are not "other schemes"');
  assert.match(lettings, /d\.deal_type IN \(\$\{lettingTypeSqlList\(\)\}\) AND d\.status = ANY\(\$1::text\[\]\)/);
  // A letting that is not done is read only at "live": the statuses asked for are the level's.
  assert.match(report, /const stages = level === "live" \? \[\.\.\.DONE, \.\.\.RUNNING\] : DONE;/);
  assert.match(report, /const DONE = \["EXC", "COM", "INV"\], RUNNING = \["NEG", "HOT", "SOL"\];/);
  // A sale: a completed comparable in the period; an asset still on the tracker only at "live", with its stage and never a price.
  const sales = sql.find(text => text.includes('FROM investment_comps'));
  assert.match(sales, /SELECT s\.property_name, s\.city, s\.buyer, s\.seller, s\.price, s\.cap_rate, s\.transaction_date\s+FROM investment_comps s/);
  assert.match(sales, /!~\* '\(terminat\|withdraw\|pending\|under offer\|quoting\|on the market\|refinanc\)'/);
  const tracker = sql.find(text => text.includes('FROM investment_tracker'));
  assert.match(tracker, /SELECT t\.asset_name, t\.asset_type, t\.status\s+FROM investment_tracker t/);
  assert.doesNotMatch(tracker, /price|niy|eqy|rent|client|vendor|buyer|guide/i, 'a live investment deal is its asset and its stage');
  assert.match(report, /if \(level !== "live"\) return out;/);
  assert.match(report, /price: null, yieldPct: null, day: null, live: true,/);
  // Public news: public sources only, by headline, link, publisher and day. Never a story's summary or text.
  const news = sql.find(text => text.includes('FROM news_articles'));
  assert.match(news, /SELECT n\.title, n\.url, COALESCE\(n\.source_name, ns\.name\) AS source_name, n\.published_at\s+FROM news_articles n JOIN news_sources ns/);
  assert.match(news, /WHERE \$\{publicNewsSourceSql\("ns"\)\}/);
  assert.doesNotMatch(news, /summary|content|ai_/);
  // The Insights cards any client login is shown, and no other; a paper is its publisher, month, headline and checked figures.
  const themes = sql.find(text => text.includes('FROM insights'));
  assert.match(themes, /WHERE i\.audience = 'all' AND i\.source_kind IN \('news', 'market-report'\)/);
  assert.match(report, /\|\| !isPublishableInsight\(r\)\) continue;/);
  const research = sql.find(text => text.includes('FROM investment_research_reads'));
  assert.match(research, /SELECT k\.category, r\.published, r\.publisher, r\.headline, r\.facts, r\.read_at\s+FROM investment_research_reads r JOIN knowledge_base k/);
  assert.doesNotMatch(research, /extracted|file_|k\.content|r\.summary|r\.outlook/, 'never the paper');
  assert.match(report, /figures: \(Array\.isArray\(r\.facts\) \? r\.facts : \[\]\)\.map\(\(f: any\) => \(\{ topic: String\(f\?\.topic \|\| ""\), figure: String\(f\?\.figure \|\| ""\), place: /, 'a figure without the sentence it was read from: the quote is the paper\'s');
  // The viewer's own name, schemes and centres are not the competition.
  assert.match(report, /own: \[\.\.\.\(landlords\?\.own \|\| \[\]\), "Landsec", "Land Securities", \.\.\.portfolio\.schemes\.map\(s => s\.name\), /);
  assert.match(report, /if \(record && !own\) for \(const item of /);
  // Each read fails on its own, and what failed is said on the last slide.
  assert.equal((report.match(/attempt\("/g) || []).length, 8);
  assert.match(report, /notAvailable: failed,/);
  assert.match(marketDeckCode, /Not available when this was made: \$\{failed\.join\(", "\)\}\. Nothing was put in their place\./);
  assert.doesNotMatch(report + marketDeckCode + rules, /anthropic|perplexity|openai|fetch\(|setInterval|setTimeout|cron/i, 'no outside call and no timer: the decks stay free of AI');
  // The switch is one word, and it ships at "live".
  assert.match(rules, /export const OTHER_SCHEMES_LEVEL: OtherSchemesLevel = "live";/);
  assert.match(rules, /stage === "exchanged" \|\| stage === "completed" \|\| level === "live";/);
  assert.match(rules, /line: cut\(`\$\{live \? `Live, \$\{live\}: ` : ""\}/, 'a row that is not done says so first');
  // A news item is its headline, never the story; a line BGP typed about its own deal is not a public report.
  assert.match(rules, /if \(\/\^https\?:\\\/\\\/\/i\.test\(source\)\) \{/);
  assert.match(rules, /\} else if \(\/\^newsletter:\/i\.test\(source\) && row\.publisher\) named = one\(row\.publisher\);\s*if \(!headline \|\| !named/);
  assert.match(read('shared/landsec-market-report.ts'), /It holds no footfall, sales, turnover, consumer spending or rental index: the app holds none\./);
});

test('BGP\'s team posts: staff-only conversations, read in two queries, and never printed by themselves', () => {
  const posts = code(read('server/landsec-market-posts.ts'));
  const sql = Array.from(posts.matchAll(/db\.query\(\s*`([\s\S]*?)`/g)).map(m => m[1]);
  assert.equal(sql.length, 2);
  const tables = new Set();
  for (const text of sql) for (const m of text.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)) tables.add(m[1].toLowerCase());
  assert.deepEqual(Array.from(tables).sort(), ['chat_messages', 'chat_thread_members', 'chat_threads', 'crm_companies', 'users']);
  const read1 = sql[0];
  assert.match(read1, /m\.role = 'user'/);
  assert.match(read1, /t\.is_ai_chat IS NOT TRUE AND t\.created_by <> '__record__'/, 'never a ChatBGP chat or a record\'s shared conversation');
  assert.match(read1, /COALESCE\(t\.linked_type, ''\) IN \('', 'channel'\)/, 'never a conversation linked to a property, a deal or a company');
  assert.match(read1, /WHERE who\.person IS NULL OR u\.id IS NULL\s+OR lower\(trim\(COALESCE\(u\.email, ''\)\)\) NOT LIKE '%\$\{STAFF_DOMAIN\}'\s+OR lower\(trim\(COALESCE\(u\.role, ''\)\)\) = 'client'\)/, 'one person who is not BGP staff, or cannot be found, and the conversation is left alone');
  assert.match(sql[1], /c\.company_type ILIKE 'tenant%' AND c\.archived_at IS NULL AND c\.merged_into_id IS NULL/);
  assert.doesNotMatch(posts, /anthropic|fetch\(/i);
  // A deck, the workbook and the gathering never read them: only the editor's list and the draft do.
  for (const file of ['server/landsec-market-report.ts', 'server/landsec-decks.ts', 'shared/landsec-market-deck.ts', 'shared/landsec-decks.ts', 'server/landsec-reports.ts', 'server/landsec-board-report.ts']) {
    assert.doesNotMatch(code(read(file)), /landsec-market-posts|teamPosts|MarketTeamPost/, `${file} does not read the team's posts`);
  }
  assert.doesNotMatch(code(read('shared/landsec-market-report.ts')).split('export interface MarketData')[1].split('}')[0], /post/i, 'a deck\'s data holds no post');
});

// Woody, 2026-11-19: "also can you use the bluewater colours and juts have the landsec logo", "not BGP".
test('the Landsec reports carry Landsec\'s logo and the Landsec report palette: never BGP\'s wordmark or BGP\'s colours', async () => {
  const { LANDSEC_REPORT_PALETTE } = await import('../../shared/landsec-reports.ts');
  assert.deepEqual(LANDSEC_REPORT_PALETTE, { navy: '#082862', paleBlue: '#dbe5fe', sand: '#eeeae4', gold: '#c0b283', text: '#141414', muted: '#525252' });
  for (const [file, text] of [[BUILDERS, builders], [BOARD, board], [MODEL, model], [COMPOSE, compose], [GATHER, gather], [PDF, pdf], [PPTX, pptx], [LOGO, logo]]) {
    for (const never of ['wordmarkBytes', 'BGP_WhiteHolder', 'BGP_BlackHolder', 'BGP_BRAND', 'BORDEAUX', 'NECTAR', 'BLUSH', 'CREAM', 'STONE', 'doc-engine', 'unit-info-sheet', 'deck-engine']) assert.ok(!text.includes(never), `${file} uses ${never}`);
    assert.doesNotMatch(text, /6e0c25|fc9f8d|fcf8f4|e4d8d3|c2baa3/i, `${file} holds one of BGP's colours`);
  }
  // Every colour comes from the one palette: the workbooks', the PDF's, the PowerPoint's, and the chart series (mixed from it).
  assert.match(builders, /fgColor: \{ argb: argb\(LANDSEC_REPORT_PALETTE\.navy\) \}/);
  assert.equal((builders.match(/#[0-9a-f]{6}\b/gi) || []).length + (builders.match(/argb: "FF(?!FFFFFF")/g) || []).length, 0, 'no colour but white is written into the builders');
  assert.doesNotMatch(board + gather + compose, /rgb\(|#[0-9a-f]{6}\b|argb/i, 'the board report, the gathering and the slides hold no colour of their own');
  assert.match(pdf, /const NAVY = colour\(LANDSEC_REPORT_PALETTE\.navy\), PALE = colour\(LANDSEC_REPORT_PALETTE\.paleBlue\), SAND = colour\(LANDSEC_REPORT_PALETTE\.sand\), GOLD = colour\(LANDSEC_REPORT_PALETTE\.gold\);/);
  assert.match(pptx, /const NAVY = hex\(LANDSEC_REPORT_PALETTE\.navy\), PALE = hex\(LANDSEC_REPORT_PALETTE\.paleBlue\), SAND = hex\(LANDSEC_REPORT_PALETTE\.sand\), GOLD = hex\(LANDSEC_REPORT_PALETTE\.gold\);/);
  assert.equal((pdf.match(/#[0-9a-f]{6}\b/gi) || []).length, 0, 'the PDF renderer writes no colour of its own');
  assert.deepEqual(pptx.match(/"[0-9A-F]{6}"/g), ['"FFFFFF"'], 'the PowerPoint renderer writes no colour but white');
  assert.equal((model.match(/#[0-9a-f]{6}\b/gi) || []).filter(c => c.toLowerCase() !== '#ffffff').length, 0, 'the chart colours are the palette, or mixed from it');
  assert.match(model, /navy: LANDSEC_REPORT_PALETTE\.navy,\s*blue: mix\(LANDSEC_REPORT_PALETTE\.navy, LANDSEC_REPORT_PALETTE\.paleBlue, 0\.48\),\s*gold: LANDSEC_REPORT_PALETTE\.gold,\s*pale: LANDSEC_REPORT_PALETTE\.paleBlue,/);
  // The logo is Landsec's own file, read from server/assets (and from dist after a build). No file, no logo: none is typeset in its place.
  assert.match(logo, /const file = kind === "light" \? "landsec-logo-light\.png" : "landsec-logo-dark\.png";/);
  assert.match(pdf, /const light = landsecLogoBytes\("light"\), dark = landsecLogoBytes\("dark"\);/);
  assert.match(pptx, /const light = landsecLogoBytes\("light"\), dark = landsecLogoBytes\("dark"\);/);
  assert.equal((pdf.match(/doc\.embedPng\(/g) || []).length, 2, 'the PDF embeds the two logo files and no other picture');
  assert.deepEqual(pptx.match(/slide\.addImage\(\{ data: image\((light|dark)\)/g), ['slide.addImage({ data: image(light)', 'slide.addImage({ data: image(dark)'], 'the PowerPoint places the two logo files and no other picture');
  assert.match(pptx, /if \(light\) slide\.addImage\(/);
  assert.match(pptx, /if \(dark\) slide\.addImage\(/);
  for (const file of ['server/assets/landsec-logo-light.png', 'server/assets/landsec-logo-dark.png']) {
    const bytes = fs.readFileSync(new URL(`../../${file}`, import.meta.url));
    assert.deepEqual(Array.from(bytes.subarray(0, 4)), [0x89, 0x50, 0x4e, 0x47], `${file} is a PNG`);
  }
  assert.match(read('script/build.ts'), /"landsec-logo-light\.png", "landsec-logo-dark\.png"/, 'the build copies both logo files to dist/server/assets');
  // The line at the foot is words, and stays.
  assert.match(gather, /`Made in ChatBGP on \$\{longDay\(ctx\.madeAt\)\} by \$\{ctx\.madeBy\}\. It holds what is recorded in ChatBGP on that day\.`/);
  assert.match(pdf, /write\(cutTo\(deck\.footer, /);
  assert.match(pptx, /text\(slide, deck\.footer, /);
});

// Woody, 2026-11-19, on the first populated samples: "we dont need complicated excels just visual PDF which can also be power point".
test('the reports to present are decks: one slide model, drawn as a PDF and as a PowerPoint of the same slides', () => {
  // The three decks are on the registry, and each is built through the one door.
  assert.deepEqual(LANDSEC_REPORTS.filter(r => r.deck).map(r => r.key), ['board-report', 'market-report', 'leasing-activity-pdf', 'asset-profile']);
  const body = builders.slice(builders.indexOf('export async function buildLandsecReport'), builders.indexOf('export function setupLandsecReportRoutes'));
  for (const key of ['board-report', 'market-report', 'leasing-activity-pdf', 'asset-profile']) assert.match(body, new RegExp(`case "${key}": return deck\\(\\);`));
  assert.match(body, /const slides = await \(await import\("\.\/landsec-decks"\)\)\.landsecDeck\(def\.key, full, viewer\);\s*return format === "pptx" \? \(await import\("\.\/landsec-deck-pptx"\)\)\.deckPptx\(slides\) : Buffer\.from\(await \(await import\("\.\/landsec-deck-pdf"\)\)\.deckPdf\(slides\)\);/, 'the same slides go to either renderer');
  for (const key of ['board-report', 'market-report', 'asset-profile', 'leasing-activity-pdf']) assert.match(gather, new RegExp(`case "${key}": return `));
  // The route: a PowerPoint only of a deck, and only one of the two formats.
  const routes = builders.slice(builders.indexOf('export function setupLandsecReportRoutes'));
  assert.match(routes, /const format = deckFormat\(req\.query\.format\);\s*if \(!format \|\| \(format === "pptx" && !def\.deck\)\) return res\.status\(400\)/);
  assert.match(routes, /res\.setHeader\("Content-Type", def\.deck \? DECK_MIME\[format\] : "application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet"\);/);
  // Both renderers draw from the one layout, and know nothing of what is on a slide.
  for (const [file, text] of [[PDF, pdf], [PPTX, pptx]]) {
    assert.match(text, /for \(const placed of layoutSlide\(s(lide)?\)\) \{/, `${file} places blocks by the shared layout`);
    assert.match(text, /tileBoxes\(t, b\)/);
    assert.match(text, /tileValueSize\(tile\.value, /);
    assert.match(text, /fitCell\(cells\[i\] \?\? "", widths\[i\](, 9\.5, (2|t\.lines === 2 \? 2 : 1))?\)/, `${file} cuts a cell to its lines by the shared rule`);
    assert.match(text, /tableRowHeight\(t\.lines\)/, `${file} draws a row of two lines at the shared height`);
    assert.doesNotMatch(text, /from "\.\/landsec-(decks|board-[a-z]+|reports)"|from "@shared\/landsec-(decks|board-report)"|lettings|scheme/i, `${file} draws the deck it is given and nothing else`);
  }
  // The PowerPoint's charts and tables are native, so they can be edited: never a picture of a chart.
  assert.match(pptx, /slide\.addChart\(pptx\.ChartType\.bar, data, \{/);
  assert.match(pptx, /slide\.addTable\(rows, \{/);
  assert.match(pptx, /pptx\.layout = "LAYOUT_WIDE";/);
  // The PDF is 16:9 pages, one a slide.
  assert.match(pdf, /const size: \[number, number\] = \[P\.w \* PT, P\.h \* PT\];/);
  assert.match(pdf, /deck\.slides\.forEach\(\(slide, i\) => \{\s*page = doc\.addPage\(size\);/);
  // A chart with nothing to draw is a card, by the shared rule: the composers never push a bare chart of activity.
  assert.match(model, /return chartHasData\(chart\) \? chart : \{ kind: "card", title: empty\.title, lines: empty\.lines \};/);
  assert.ok((compose.match(/chartOrCard\(/g) || []).length >= 12, 'every chart on a slide goes through chartOrCard');
  for (const m of compose.matchAll(/blocks: \[(withoutEmptyCategories\([a-zA-Z]+\))\]/g)) assert.match(compose, /if \(cats\.some\(/, `${m[1]} is pushed only inside a check that it has something to draw`);
  // A figure that is not held says so.
  assert.match(compose, /const money = \(n: number \| null \| undefined\): string => \(n == null \? "Not held" : deckValue\(n, "money"\)\);/);
  assert.match(compose, /title: `Not held for \$\{count\(unheld\.length\)\} of \$\{plural\(g\.lettings, "letting", "lettings"\)\}`/);
  // The old PDF documents are gone: no second layout to drift from the decks.
  assert.doesNotMatch(builders + board, /pdfDocument|activityPdf|assetProfilePdf|boardReportPdf|from "pdf-lib"/);
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
  // The page leads with the decks, each with a PDF and a PowerPoint button; the Excel exports are under one fold, closed until opened.
  assert.match(page, /const decks = data\.reports\.filter\(def => def\.deck\);\s*const exports = data\.reports\.filter\(def => !def\.deck\);/);
  assert.match(page, /decks\.map\(def =>/);
  assert.match(page, /\(\["pdf", "pptx"\] as const\)\.map\(as =>/);
  assert.match(page, /\{working \? "Making it" : as === "pdf" \? "PDF" : "PowerPoint"\}/);
  assert.match(page, /if \(as === "pptx"\) params\.set\("format", "pptx"\);/);
  assert.match(page, /<details className="[^"]*" data-testid="landsec-reports-exports">/);
  assert.doesNotMatch(page, /<details[^>]*\bopen\b/, 'the Excel fold is closed by default');
  assert.match(page, /Data exports \(Excel\)/);
  assert.ok(page.indexOf('decks.map(def =>') < page.indexOf('data-testid="landsec-reports-exports"'), 'the decks lead the page');
  assert.ok(page.indexOf('exports.map(def =>') > page.indexOf('data-testid="landsec-reports-exports"'), 'every Excel export is inside the fold');
  // The board report's card carries the market report's editor, which asks only the market report's addresses.
  assert.match(page, /\{board && \(\s*<Button [^\n]*data-testid="landsec-report-board-market">/);
  const editor = code(read('client/src/components/landsec/board-market-editor.tsx'));
  const asked = Array.from(editor.matchAll(/["`](\/api\/[^"`?$]*)/g)).map(m => m[1]);
  assert.deepEqual(Array.from(new Set(asked)).sort(), ['/api/landsec/reports/board-report/market', '/api/landsec/reports/board-report/market/draft', '/api/landsec/reports/board-report/market/material']);
  // A team post is only ever put in the box for a person to edit and save; and the market report's card opens the same editor.
  assert.match(editor, /const addPost = \(key: BoardMarketKey, held: string, post: MarketTeamPost\) => \{/);
  assert.doesNotMatch(editor.slice(editor.indexOf('const addPost'), editor.indexOf('return (')), /apiRequest/, 'adding a post saves nothing');
  assert.match(page, /\{market && \(\s*<Button [^\n]*data-testid="landsec-report-market-words">/);
  assert.match(editor, /\{data\.canDraft && \(/, 'Draft is offered only where the server says so');
  assert.doesNotMatch(editor, /landsecRole|joint_agent|isStaff/, 'who may save or draft is decided on the server');
  const called = Array.from(page.matchAll(/["`](\/api\/[^"`?$]*)/g)).map(m => m[1]);
  assert.ok(called.length >= 2);
  for (const address of called) assert.match(address, /^\/api\/landsec\/reports(\/|\/board-report\/market(\/draft)?)?$/, address);
  assert.doesNotMatch(page, /landsecRole|joint_agent|isStaff/, 'who may run a report is decided on the server');
  const app = read('client/src/App.tsx');
  assert.match(app, /<Route path="\/landsec\/reports" component=\{LandsecReports\} \/>/);
});

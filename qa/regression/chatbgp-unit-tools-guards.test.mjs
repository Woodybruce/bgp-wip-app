// ChatBGP's unit and waiting-on tools (server/chatbgp-unit-tools.ts) answer
// from the same feeds as the pages. These hold that in the source: who may
// run them, where they are wired in, and that the file reads the feeds'
// own functions and not the tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, find, route, evaluate, ts } = require('./source-harness.cjs');

const NAMES = ['get_property_units', 'get_deal_waiting_on'];
const tools = source('server/chatbgp-unit-tools.ts');
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fn = (file, name) => find(file, n => ts.isFunctionDeclaration(n) && n.name?.text === name);

test('a client login may run both tools: neither is on the client block-list', () => {
  const blocked = find('server/chatbgp.ts', n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === 'CLIENT_BLOCKED_TOOLS'));
  const allowed = fn('server/chatbgp.ts', 'isToolAllowedForClient');
  const { isToolAllowedForClient } = evaluate(blocked + '\n' + allowed);
  for (const name of NAMES) {
    assert.equal(isToolAllowedForClient(name), true, name);
    assert.doesNotMatch(blocked, new RegExp(`"${name}"`));
  }
  assert.equal(isToolAllowedForClient('sql_query'), false, 'the block-list itself still stands');
});

test('a joint agent is not given them: its allow-list and its file do not name them', () => {
  const jointAgent = source('server/chatbgp-joint-agent.ts');
  for (const name of [...NAMES, 'chatbgp-unit-tools', 'runUnitTool', 'UNIT_TOOL_DEFINITIONS']) assert.equal(jointAgent.includes(name), false, name);
  // Its gate still answers first in the executor these tools run in.
  const raw = fn('server/chatbgp.ts', 'executeCrmToolRaw');
  const gate = raw.indexOf('jointAgentToolGate(fnName, fnArgs, req)');
  const clientGate = raw.indexOf('isToolAllowedForClient(fnName)');
  const run = raw.indexOf('runUnitTool(fnName, fnArgs, req)');
  assert.ok(gate > 0 && clientGate > gate && run > clientGate, 'the joint agent gate, then the client gate, then the tools');
});

test('both tools are declared to the model from the one file and run through its one door', () => {
  const chat = source('server/chatbgp.ts');
  assert.match(fn('server/chatbgp.ts', 'getAvailableTools'), /tools\.push\(\.\.\.\(await import\("\.\/chatbgp-unit-tools"\)\)\.UNIT_TOOL_DEFINITIONS\)/);
  assert.match(fn('server/chatbgp.ts', 'executeCrmToolRaw'), /fnName === "get_property_units" \|\| fnName === "get_deal_waiting_on"/);
  for (const name of NAMES) {
    assert.match(tools, new RegExp(`name: "${name}"`));
    assert.match(chat, new RegExp(`\\b${name}\\b`), `${name} is not named in ChatBGP's prompts`);
  }
  // The staff prompt and the client prompt both send such questions here.
  assert.match(fn('server/chatbgp.ts', 'buildSystemPrompt'), /get_property_units[\s\S]*get_deal_waiting_on/);
  const clientPrompt = find('server/chatbgp.ts', n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === 'CLIENT_SYSTEM_PROMPT'));
  assert.match(clientPrompt, /get_property_units[\s\S]*get_deal_waiting_on/);
});

test('the answers come from the feeds the pages read, checked and cut by the feeds themselves', () => {
  assert.match(tools, /import \{ propertyReadBlocked, unitViewerFor, loadPropertyUnits, loadPropertyUnitDetail, unitsForViewer \} from "\.\/property-units";/);
  assert.match(tools, /import \{ landsecDealsFeed \} from "\.\/landsec-unit";/);
  assert.match(tools, /import \{ waitingOptionsForDeal \} from "\.\/deal-checklist";/);
  // One place loads a property's units: the read check first, the viewer's cut last.
  const body = code(tools);
  assert.equal(body.split('deps.loadPropertyUnits(').length - 1, 1);
  const feedFor = fn('server/chatbgp-unit-tools.ts', 'unitsFeedFor');
  const check = feedFor.indexOf('deps.propertyReadBlocked(req, propertyId)');
  const load = feedFor.indexOf('deps.loadPropertyUnits(');
  const cut = feedFor.indexOf('deps.unitsForViewer(feed, viewer)');
  assert.ok(check > 0 && load > check && cut > load);
  assert.match(feedFor, /deps\.unitViewerFor\(req\)/);
  // A property found by name is offered only once the same check has passed.
  assert.match(fn('server/chatbgp-unit-tools.ts', 'openProperties'), /if \(!\(await deps\.propertyReadBlocked\(req, row\.id\)\)\) open\.push/);
  // The unit panel's detail is read for the viewer the feed named.
  assert.match(fn('server/chatbgp-unit-tools.ts', 'unitPicture'), /deps\.loadPropertyUnitDetail\(deps\.db, read\.feed\.property\.id, unit\.id, read\.viewer\)/);
  assert.match(body, /deps\.landsecDealsFeed\(req\)/);
  assert.match(body, /deps\.waitingOptionsForDeal\(req, row\.id\)/);
  // The live functions are the real ones.
  assert.match(tools, /const LIVE: UnitToolDeps = \{ db: pool, propertyReadBlocked, unitViewerFor, loadPropertyUnits, loadPropertyUnitDetail, unitsForViewer, landsecDealsFeed, waitingOptionsForDeal \};/);
});

test('it has no query of its own over the schedule, the tracker, the clock or the checklist, and names no fee', () => {
  const body = code(tools);
  for (const table of ['tenancy_schedule_units', 'available_units', 'leasing_schedule_units', 'landsec_deal_clock', 'deal_checklist', 'unit_offers', 'unit_viewings', 'unit_briefs', 'unit_target_operators']) {
    assert.equal(body.includes(table), false, `${table} is read here and not through the feed`);
  }
  assert.doesNotMatch(body, /\bfee\b|bgp_contact|internal_agent|\.notes\b|\.email\b/i);
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE)\b/, 'these tools only read');
});

test('the Deals page and the tool read one clock feed', () => {
  const handler = route('server/landsec-unit.ts', 'get', '/api/landsec/deals');
  assert.match(handler, /const feed = await landsecDealsFeed\(req\);/);
  assert.match(handler, /if \(!feed\) return res\.status\(403\)/);
  const feed = fn('server/landsec-unit.ts', 'landsecDealsFeed');
  assert.match(feed, /waitingClockFor\(clocks\.get\(d\.id\) \|\| null, checklists\.get\(d\.id\) \|\| null, d\.id\)/);
  assert.match(feed, /viewerCanSeeScheme\(scope, s\.key\)/);
  assert.match(feed, /fee: scope\.isClient \? undefined : d\.fee/);
});

// The lock on a Landsec joint agent's ChatBGP (server/chatbgp-joint-agent.ts).
// No AI key and no database rows are needed: the tools take an injected
// reader, and the run takes an injected model that records what it is sent.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  JOINT_AGENT_TOOLS, JOINT_AGENT_TOOL_NAMES, JOINT_AGENT_TOOL_REFUSAL, JOINT_AGENT_SYSTEM_PROMPT,
  jointAgentToolRefusal, jointAgentToolGate, runJointAgentTool, buildJointAgentRun, runJointAgentChat, isJointAgentChat, projectFields,
} from "./chatbgp-joint-agent";
import { restrictedLandsecApiRule } from "../shared/landsec";

const U = "36c81e04-6f16-4951-8ea7-cbaf16b83741";
const JA = { userId: "e9c13456-ce19-462c-8996-84a059b900a1", firm: "CBRE", schemeKeys: ["westgate-oxford"], propertyIds: ["prop-1"] };
const req = (headers: Record<string, string> = { authorization: "Bearer t" }) => ({ headers, session: { userId: JA.userId } }) as any;
const chatbgpSource = readFileSync(new URL("./chatbgp.ts", import.meta.url), "utf8");

// Everything a careless reply could carry. None of it may come back.
const PLANTED = {
  contactName: "PLANTED-CONTACT", contact_name: "PLANTED-CONTACT", brandContactName: "PLANTED-CONTACT", agentContactName: "PLANTED-CONTACT",
  attendees: "PLANTED-GUEST", email: "planted@example.com", phone: "PLANTED-PHONE", fee: 99123, feedback: "PLANTED-BGP-NOTE", company_id: "PLANTED-COMPANY-ID",
  companyId: "PLANTED-COMPANY-ID", contactId: "PLANTED-CONTACT-ID", internal_agent: "PLANTED-AGENT", agents: ["PLANTED-AGENT"], website: "planted.example",
  notes: "PLANTED-BGP-NOTE", description: "PLANTED-BGP-NOTE", leasing: { updates: "PLANTED-BGP-NOTE" }, plans: [{ url: "PLANTED-URL" }], surprise: "PLANTED-SURPRISE",
  people: { landsec: [{ name: "PLANTED-CONTACT", email: "planted@example.com" }], bgp: [{ name: "Vic", email: "planted@example.com", role: "Agent" }] },
};
const PLANTED_WORDS = ["PLANTED", "planted@", "99123"];
const plant = (v: any): any => {
  if (Array.isArray(v)) return v.map(plant);
  if (v && typeof v === "object") { const o: any = { ...PLANTED }; for (const k of Object.keys(v)) o[k] = plant(v[k]); return o; }
  return v;
};

// A reply shaped like each address's real one (keys as the live app sends them).
const REPLIES: Record<string, any> = {
  "/api/landsec/home": { companyId: "c1", groups: [{ group: "South", schemes: [{ key: "westgate-oxford", name: "Westgate Oxford", town: "Oxford", propertyId: "p", passingRent: 5, units: 10, vacant: 2, pipeline: { tracker: { AVA: 1 }, liveLettings: 1, liveDeals: 1, stuck: 0, oldestLiveDays: 3 } }] }], totals: { units: 10, vacant: 2, liveLettings: 1, liveDeals: 1, stuck: 0, tracker: { AVA: 1 } }, viewer: { role: "joint_agent" } },
  "/api/landsec/tracker": { viewer: { userId: "x" }, schemes: [{ key: "westgate-oxford", name: "Westgate Oxford", properties: [{ id: "p", name: "P" }] }], units: [{ id: U, unitName: "RU9", propertyId: "p", propertyName: "Westgate", schemeName: "Westgate Oxford", statusCode: "AVA", askingRent: 1, brief: { id: U, agreed: false, agreedAt: null, signoff: { total: 1, agreed: 0, complete: false } }, interest: { count: 1, lines: [{ contactName: "x" }] }, viewings: { count: 1, lines: [{ contactName: "x", companyName: "B" }] }, offers: { count: 0, lines: [] }, checklist: { total: 3, done: 1, stage: "hots", responsibleName: "Vic" }, recommendation: null, hots: { stage: "draft", version: 1, issuedAt: null }, monitor: { offers: [{ companyName: "B" }] } }] },
  [`/api/landsec/unit/${U}`]: { unit: { id: U, unit: "RU9", erv: 1, areas: { niaSqft: 1 }, comments: "c" }, leasing: { updates: "u" }, tracker: { id: U, files: [{ url: "f" }], viewings: [{ company_name: "B", contact_name: "x", viewing_date: "d" }], offers: [{ id: "o", company_name: "B", ner: { nerPa: 1 } }] }, schemeLiveDeals: [{ id: "d", ref: 1, name: "n", unit: null }], brief: { id: U, title: "t", targets: [{ id: "t", operator_name: "B", company_id: "c", category: "c", priority: "p", status: "s", feedback: "f" }], signoff: { total: 1, agreed: 0 } }, deal: { id: "d", ref: 1, name: "n", clock: { waitingOnParty: "bgp", dependsOn: { id: "d2", ref: 2, name: "n2", unit: null } }, terms: { rentPa: 1 }, solicitors: { firm: "f", contact: "PLANTED-CONTACT" }, fee: 99123, agents: ["a"] }, people: { bgp: [{ id: "u", name: "Vic", email: null, role: "Agent" }], landsec: [{ name: "x" }] }, plans: [{ id: "p" }], agreedBrief: { use: "u", nerFloor: 1, notes: "n", leasing: { by: "a", at: "b" } }, landsec: { reportToContactId: "c", reportToName: "n" } },
  "/api/landsec/deals": { deals: [{ id: "d", ref: 1, name: "n", tenant: "B", scheme: { key: "k", name: "Westgate Oxford" }, propertyId: "p", unitId: "u", unit: "RU9", code: "NEG", days: 3, clock: { waitingOnParty: "bgp" }, ner: { nerPa: 1 } }], parties: { bgp: 1 }, canSetStage: true },
  [`/api/unit-briefs/${U}/workspace`]: { brief: { id: U, title: "t", clientCompanyId: "c", commercials: { quotingRentPa: 1 }, documentFileId: "f" }, unit: { id: U, unitName: "RU9", tenancy: { unitName: "RU9" } }, people: [{ id: "p", name: "Ann", email: "planted@example.com", contactId: "c", userId: "u", role: "client_leasing", agreedAt: null }], comments: [{ id: "c", userId: "u", userName: "Ann", body: "ok", kind: "comment" }], approval: { state: "draft", total: 1, agreed: 0, stale: 0, missing: [], label: "l" }, files: [{ url: "f" }], viewer: { userId: "u" } },
  [`/api/unit-offers/unit/${U}/summary`]: [{ offerId: "o", companyName: "B", status: "Pending", rounds: 1 }],
  [`/api/unit-offers/${U}/negotiation`]: { offer: { id: "o", unitId: U, companyId: "c", companyName: "B", contactName: "x", comments: "c", source: "s", rentPa: 1 }, rounds: [{ id: "r", roundNo: 1, party: "tenant", note: "n", rentPa: 1 }], canEdit: true },
  [`/api/unit-hots/${U}`]: { unit: { id: U, unitName: "RU9", propertyId: "p", dealId: "d" }, stage: "draft", content: "text", version: 1, gaps: ["g"], signers: [{ briefPersonId: "b", userId: "u", name: "Ann", role: "r", agreedAt: null }], approval: { total: 1, agreed: 0, complete: false }, events: [{ id: "e", kind: "k", body: "b" }], template: { text: "t" }, convertDefaults: { tenantContactId: "c" }, viewer: { isStaff: false } },
  [`/api/deal-checklists/unit/${U}`]: { started: true, checklist: { id: "c", unit: { id: U, unitName: "RU9" }, templateName: "t", stage: "hots", responsible: { userId: "u", name: "Vic", email: "planted@example.com", side: "bgp" }, items: [{ id: "i", stage: "hots", label: "l", note: "n", assignee: { userId: "u", name: "Vic", email: "planted@example.com", side: "bgp" }, doneAt: null }], people: [{ userId: "u", name: "Vic", email: "planted@example.com" }], summary: { total: 1, done: 0 }, viewer: {} } },
  [`/api/unit-recommendations/${U}`]: { id: null, unit: { id: U, unitName: "RU9", clientName: "Landsec" }, stage: "draft", ready: { agreedOffer: true }, offer: { id: "o", companyName: "B" }, version: 1, terms: { tenant: "B" }, measure: { nerPa: 1 }, comparables: [{ id: "c", tenant: "T", dealId: "d" }], rounds: [{ roundNo: 1, note: "n" }], facts: { viewingsHeld: 1 }, commentary: { covenant: "c" }, deciders: [{ briefPersonId: "b", userId: "u", name: "Ann", decision: null }], approval: { total: 1 }, events: [], viewer: {} },
  "/api/leasing-viewings": { viewings: [{ id: "v", unitId: U, companyName: "B", contactName: "x", contactId: "c", companyId: "c", viewingDate: "d", viewingTime: "t", attendees: "a", notes: "n", bookingId: "b", agentContactName: "x", ownerUserId: "u", ownerName: "Vic", unitName: "RU9", propertyName: "Westgate", status: "scheduled", outcome: null, issues: ["i"], offers: [] }], emailRemindersEnabled: true },
  "/api/tasks": [{ id: "t", title: "Do it", description: "d", due_date: "d", status: "todo", assigned_by_name: "Vic", source_ref: "r", unit_id: U, unit_name: "RU9", link: "/landsec/tracker" }],
  "/api/landsec/brand-crm/plan": { schemes: [{ key: "k", name: "Westgate Oxford", group: "South" }], brands: [{ key: "b", id: null, name: "B", logoUrl: null, furthest: "viewed", cells: {}, rows: [{ key: "r", companyId: null, brandName: "B", scheme: { key: "k", name: "Westgate Oxford", propertyId: "p" }, unit: { label: "RU9", trackerId: U }, stage: "viewed", stageLabel: "Viewed", evidence: [{ label: "e" }], notes: ["n"], nextStep: { kind: "viewing_booked", title: "t", refId: "r", who: "Vic" }, owner: { id: "u", name: "Vic" }, links: { tracker: "/x" }, wish: { note: "n" } }] }], canEdit: false },
  "/api/landsec/diary": { items: [{ id: "i", kind: "deal_waiting", title: "t", date: "d", brand: { id: null, name: "B" }, scheme: { key: "k", name: "Westgate Oxford" }, unitLabel: "RU9", owner: "Vic", waitingOn: { side: "bgp", name: "Vic" }, url: "/x", actionId: null }], counts: { overdue: 0 }, today: "d" },
};
const ARGS: Record<string, any> = {
  ja_get_unit: { unitId: U }, ja_get_brief: { briefId: U }, ja_get_offers: { unitId: U }, ja_get_negotiation: { offerId: U },
  ja_get_heads_of_terms: { unitId: U }, ja_get_deal_checklist: { unitId: U }, ja_get_recommendation: { unitId: U },
};

function reader(replies: Record<string, any> = REPLIES) {
  const calls: Array<{ url: string; init: any }> = [];
  const fetcher = async (url: string, init: any) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    return path in replies ? { status: 200, json: async () => replies[path] } : { status: 404, json: async () => ({}) };
  };
  return { calls, fetcher };
}
const deps = (r = reader(), inScope = async () => true) => ({ jointAgent: JA, fetcher: r.fetcher, inScope });

test("the tool list is the fixed fourteen and nothing in the registry shares a name with it", () => {
  assert.equal(JOINT_AGENT_TOOLS.length, 14);
  assert.equal(JOINT_AGENT_TOOL_NAMES.size, 14);
  for (const t of JOINT_AGENT_TOOLS) {
    assert.match(t.function.name, /^ja_[a-z_]+$/);
    assert.ok(!chatbgpSource.includes(`"${t.function.name}"`), `${t.function.name} is in the staff registry`);
    assert.ok(Object.isFrozen(t) && Object.isFrozen(t.function));
  }
  assert.ok(Object.isFrozen(JOINT_AGENT_TOOLS));
  for (const word of ["create", "update", "delete", "send", "write", "search", "sql", "email", "web", "file", "memory"]) {
    for (const t of JOINT_AGENT_TOOLS) assert.ok(!t.function.name.includes(word), `${t.function.name} reads as a ${word} tool`);
  }
});

test("every tool name in the registry is refused for a joint agent, and nothing is read", async () => {
  const names = new Set<string>();
  for (const m of chatbgpSource.matchAll(/\bname:\s*"([A-Za-z0-9_]+)"/g)) names.add(m[1]);
  for (const m of chatbgpSource.matchAll(/(?:fnName|tcName|toolName|name)\s*===\s*"([A-Za-z0-9_]+)"/g)) names.add(m[1]);
  const blockList = (() => { const at = chatbgpSource.indexOf("export const CLIENT_BLOCKED_TOOLS"); return chatbgpSource.slice(at, chatbgpSource.indexOf("]);", at)); })();
  for (const m of blockList.matchAll(/"([A-Za-z0-9_]+)"/g)) names.add(m[1]);
  for (const extra of ["sql_query", "sql_write", "search_crm", "send_email", "web_search", "read_file", "search_emails", "search_app_guide", "manage_chat_members", "generate_document", "__proto__", "constructor", "toString", "", "JA_MY_SCHEMES", "ja_my_schemes ", " ja_my_schemes", "ja_", "ja_get_unit2"]) names.add(extra);
  for (let i = 0; i < 50; i++) names.add(randomBytes(6).toString("hex"));
  assert.ok(names.size > 150, `only ${names.size} names were found in the registry`);
  const r = reader();
  let refused = 0;
  for (const name of names) {
    if (JOINT_AGENT_TOOL_NAMES.has(name)) continue;
    assert.equal(jointAgentToolRefusal(name), JOINT_AGENT_TOOL_REFUSAL, name);
    const out = await jointAgentToolGate(name, { unitId: U, query: "x" }, req(), deps(r));
    assert.deepEqual(out, { data: { success: false, error: JOINT_AGENT_TOOL_REFUSAL } }, name);
    refused++;
  }
  assert.ok(refused > 150);
  assert.equal(r.calls.length, 0, "a refused tool read something");
  for (const bad of [null, undefined, 5, {}, ["ja_my_schemes"]]) assert.equal(jointAgentToolRefusal(bad), JOINT_AGENT_TOOL_REFUSAL);
});

test("a login that is not a joint agent is not answered by the gate at all", async () => {
  assert.equal(await jointAgentToolGate("search_crm", {}, req(), { jointAgent: null }), null);
  assert.equal(await jointAgentToolGate("ja_my_schemes", {}, req(), { jointAgent: null }), null);
  const out = await runJointAgentTool("ja_my_schemes", {}, req(), { jointAgent: null, fetcher: reader().fetcher });
  assert.equal(out.data.success, false);
});

test("each tool reads one address the gateway opens to a joint agent: GET, this machine, no internal header", async () => {
  process.env.PORT = "5999";
  for (const t of JOINT_AGENT_TOOLS) {
    const name = t.function.name;
    const r = reader();
    const out = await runJointAgentTool(name, ARGS[name] || {}, req({ authorization: "Bearer t", cookie: "sid=1", "x-bgp-internal": "secret", "x-forwarded-host": "evil.example", host: "evil.example" }), deps(r));
    assert.ok(!out.data?.error, `${name}: ${out.data?.error}`);
    assert.ok(r.calls.length >= 1, name);
    for (const c of r.calls) {
      const url = new URL(c.url);
      assert.equal(url.origin, "http://127.0.0.1:5999", name);
      assert.equal(url.search, "", name);
      assert.equal(c.init.method, "GET", name);
      assert.deepEqual(Object.keys(c.init.headers).sort(), ["Authorization", "Cookie"], name);
      assert.equal(restrictedLandsecApiRule("joint_agent", "GET", url.pathname), "allow", `${name} ${url.pathname}`);
    }
  }
});

test("an id that is not an id never reaches an address", async () => {
  for (const name of Object.keys(ARGS)) {
    const key = Object.keys(ARGS[name])[0];
    for (const bad of ["", "x", "../../crm/companies", `${U}/../x`, `${U}#`, `${U}?all=1`, "%2f", `${U}%2f..`, U.toUpperCase(), `${U} `, "all-files", 5, null, undefined, { id: U }, [U]]) {
      const r = reader();
      const out = await runJointAgentTool(name, { [key]: bad }, req(), deps(r));
      assert.equal(out.data.success, false, `${name} ${String(bad)}`);
      assert.equal(r.calls.length, 0, `${name} read an address for ${String(bad)}`);
    }
    const r = reader();
    assert.equal((await runJointAgentTool(name, {}, req(), deps(r))).data.success, false);
    assert.equal((await runJointAgentTool(name, null, req(), deps(r))).data.success, false);
    assert.equal(r.calls.length, 0);
  }
});

test("a unit, brief or offer that is not at the login's schemes is refused before anything is read", async () => {
  for (const name of Object.keys(ARGS)) {
    const r = reader();
    const asked: string[] = [];
    const out = await runJointAgentTool(name, ARGS[name], req(), { jointAgent: JA, fetcher: r.fetcher, inScope: async (_ja, kind, id) => { asked.push(`${kind}:${id}`); return false; } });
    assert.equal(out.data.success, false, name);
    assert.match(out.data.error, /not at one of your schemes/);
    assert.equal(asked.length, 1, name);
    assert.equal(r.calls.length, 0, `${name} read an address`);
  }
});

test("an address that refuses (403, 404, 500) gives an error and never its body", async () => {
  for (const status of [401, 403, 404, 500]) {
    const fetcher = async () => ({ status, json: async () => ({ error: "PLANTED-BODY", units: [{ id: U, checklist: {} }] }) });
    for (const t of JOINT_AGENT_TOOLS) {
      const out = await runJointAgentTool(t.function.name, ARGS[t.function.name] || {}, req(), { jointAgent: JA, fetcher, inScope: async () => true });
      assert.equal(out.data.success, false, `${t.function.name} ${status}`);
      assert.ok(!JSON.stringify(out).includes("PLANTED"), `${t.function.name} ${status}`);
    }
  }
});

test("a request with no login to forward reads nothing", async () => {
  const r = reader();
  const out = await runJointAgentTool("ja_my_schemes", {}, req({}), deps(r));
  assert.equal(out.data.success, false);
  assert.equal(r.calls.length, 0);
});

test("what comes back is the named fields only: a planted field never passes, known or unknown", async () => {
  const planted: Record<string, any> = {};
  for (const k of Object.keys(REPLIES)) planted[k] = plant(REPLIES[k]);
  for (const t of JOINT_AGENT_TOOLS) {
    const name = t.function.name;
    const out = await runJointAgentTool(name, ARGS[name] || {}, req(), deps(reader(planted)));
    const text = JSON.stringify(out.data);
    assert.ok(text.length > 20, `${name} came back empty: ${text}`);
    for (const w of PLANTED_WORDS) assert.ok(!text.includes(w), `${name} leaked ${w}: ${text.slice(Math.max(0, text.indexOf(w) - 80), text.indexOf(w) + 40)}`);
    for (const key of ["contactName", "contact_name", "email", "phone", "fee", "feedback", "company_id", "companyId", "contactId", "notes", "description", "surprise", "attendees", "website", "plans", "leasing\":{\"updates", "userId", "propertyId"]) {
      assert.ok(!text.includes(`"${key}`), `${name} kept ${key}`);
    }
  }
});

test("each tool keeps what its page shows", async () => {
  const get = async (name: string) => (await runJointAgentTool(name, ARGS[name] || {}, req(), deps())).data;
  assert.deepEqual((await get("ja_my_schemes")).groups[0].schemes[0], { key: "westgate-oxford", name: "Westgate Oxford", town: "Oxford", units: 10, vacant: 2, pipeline: { tracker: { AVA: 1 }, liveLettings: 1, liveDeals: 1, stuck: 0, oldestLiveDays: 3 } });
  const units = await get("ja_list_units");
  assert.equal(units.units[0].id, U);
  assert.deepEqual(units.units[0].viewings, { count: 1 });
  assert.equal(units.units[0].monitor, undefined);
  const unit = await get("ja_get_unit");
  assert.deepEqual(unit.brief.targets, [{ operator_name: "B", category: "c", priority: "p", status: "s" }]);
  assert.deepEqual(unit.tracker.viewings, [{ company_name: "B", viewing_date: "d" }]);
  assert.deepEqual(unit.deal.solicitors, { firm: "f" });
  assert.deepEqual(unit.people, { bgp: [{ name: "Vic", role: "Agent" }] });
  assert.equal(unit.leasing, undefined);
  assert.equal(unit.landsec, undefined);
  assert.deepEqual((await get("ja_list_viewings")).viewings, [{ viewingDate: "d", viewingTime: "t", unitName: "RU9", propertyName: "Westgate", companyName: "B", status: "scheduled", outcome: null, ownerName: "Vic" }]);
  assert.deepEqual(await get("ja_my_tasks"), [{ title: "Do it", due_date: "d", status: "todo", unit_name: "RU9", link: "/landsec/tracker" }]);
  assert.deepEqual((await get("ja_get_negotiation")).offer, { id: "o", unitId: U, companyName: "B", rentPa: 1 });
  assert.deepEqual((await get("ja_get_brief")).people, [{ role: "client_leasing", name: "Ann", agreedAt: null }]);
  assert.deepEqual((await get("ja_brand_crm_lines")).brands[0].rows[0].nextStep, { kind: "viewing_booked", title: "t", who: "Vic" });
  assert.deepEqual((await get("ja_diary")).items[0].brand, { name: "B" });
});

test("projectFields keeps plain values only where a plain value is named", () => {
  assert.deepEqual(projectFields({ a: { nested: 1 }, b: [1], c: "x" }, { a: true, b: true, c: true } as any), { c: "x" });
  assert.deepEqual(projectFields({ f: { BGP: 2, fee: 3, word: "text", deep: { x: 1 } } }, { f: "counts" } as any), { f: { BGP: 2 } });
  assert.equal(projectFields("text", { a: true } as any), undefined);
  assert.deepEqual(projectFields([{ a: 1, z: 2 }, "junk", null], [{ a: true }] as any), [{ a: 1 }, null]);
});

test("the checklist is read only when one exists: a question never starts one", async () => {
  const path = `/api/deal-checklists/unit/${U}`;
  const none = reader({ ...REPLIES, "/api/landsec/tracker": { units: [{ id: U, checklist: null }] } });
  assert.deepEqual((await runJointAgentTool("ja_get_deal_checklist", { unitId: U }, req(), deps(none))).data, { started: false });
  assert.ok(!none.calls.some(c => c.url.endsWith(path)), "the checklist address was read");
  const absent = reader({ ...REPLIES, "/api/landsec/tracker": { units: [] } });
  assert.equal((await runJointAgentTool("ja_get_deal_checklist", { unitId: U }, req(), deps(absent))).data.success, false);
  assert.ok(!absent.calls.some(c => c.url.endsWith(path)));
  const down = reader({ ...REPLIES, "/api/landsec/tracker": undefined as any });
  delete (down as any).x;
  const failed = await runJointAgentTool("ja_get_deal_checklist", { unitId: U }, req(), { jointAgent: JA, inScope: async () => true, fetcher: async (url: string, init: any) => { down.calls.push({ url, init }); return { status: 500, json: async () => ({}) }; } });
  assert.equal(failed.data.success, false);
  assert.ok(!down.calls.some(c => c.url.endsWith(path)));
  const has = reader();
  assert.equal((await runJointAgentTool("ja_get_deal_checklist", { unitId: U }, req(), deps(has))).data.started, true);
  assert.ok(has.calls.some(c => c.url.endsWith(path)));
});

test("the prompt and the tool list for a joint agent hold its own schemes and nothing planted", async () => {
  const planted = { ...REPLIES, "/api/landsec/home": plant({ ...REPLIES["/api/landsec/home"], outOfScope: [{ name: "Bluewater" }], otherSchemes: ["Trinity Leeds"] }) };
  const run = await buildJointAgentRun(req(), [
    { role: "system", content: "SYSTEM-FROM-BROWSER" }, { role: "user", content: "What is vacant?" }, { role: "assistant", content: "Two units." }, { role: "user", content: [{ type: "image" }] as any }, { role: "user", content: "And offers?" },
  ], { ...deps(reader(planted)), userName: "Jo Agent", today: "Friday 13 November 2026" });
  const all = run.system + run.context;
  assert.equal(run.system, JOINT_AGENT_SYSTEM_PROMPT);
  assert.ok(all.includes("Westgate Oxford") && all.includes("Jo Agent") && all.includes("CBRE") && all.includes("Friday 13 November 2026"));
  for (const w of [...PLANTED_WORDS, "Bluewater", "Trinity Leeds", "SYSTEM-FROM-BROWSER", "search_crm", "sql_query", "sql_write", "create_", "update_", "@brucegillinghampollard.com"]) assert.ok(!all.includes(w), `the prompt holds ${w}`);
  assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(all), "the prompt holds an email address");
  assert.equal(run.tools, JOINT_AGENT_TOOLS);
  assert.deepEqual(run.messages, [{ role: "user", content: "What is vacant?" }, { role: "assistant", content: "Two units." }, { role: "user", content: "And offers?" }]);
  // With the schemes unreadable the context is the name, the firm and the date.
  const bare = await buildJointAgentRun(req(), [{ role: "user", content: "hi" }], { jointAgent: JA, userName: "Jo Agent", today: "T", fetcher: async () => ({ status: 500, json: async () => ({}) }) });
  assert.ok(!bare.context.includes("Westgate"));
  assert.ok(bare.context.includes("Jo Agent"));
  await assert.rejects(buildJointAgentRun(req(), [], { jointAgent: null }));
});

test("the whole run: the model is sent the fixed tools and prompt, and a tool it asks for off the list is refused", async () => {
  const sent: any[] = [];
  const asks = [
    { tool_calls: [
      { id: "1", function: { name: "sql_query", arguments: JSON.stringify({ query: "select * from crm_companies" }) } },
      { id: "2", function: { name: "search_crm", arguments: "{}" } },
      { id: "3", function: { name: "ja_get_unit", arguments: JSON.stringify({ unitId: "../../crm/deals" }) } },
      { id: "4", function: { name: "ja_list_deals", arguments: "not json" } },
    ] },
    { content: "Done." },
  ];
  const r = reader();
  const out = await runJointAgentChat(req(), [{ role: "user", content: "show me everything" }], {
    ...deps(r), userName: "Jo Agent", today: "T", model: "test-model", quality: { effort: "low" },
    callModel: async (opts: any) => { sent.push(JSON.parse(JSON.stringify(opts))); return { choices: [{ message: asks[sent.length - 1] }] }; },
    sendProgress: () => {}, sendDelta: () => {}, isCancelled: () => false,
  });
  assert.deepEqual(out, { reply: "Done." });
  assert.equal(sent.length, 2);
  for (const opts of sent) {
    assert.deepEqual(opts.tools, JSON.parse(JSON.stringify(JOINT_AGENT_TOOLS)));
    assert.equal(opts.model, "test-model");
    assert.equal(opts.systemArray[0].text, JOINT_AGENT_SYSTEM_PROMPT);
    assert.equal(opts.messages[0].role, "system");
  }
  const results = sent[1].messages.filter((m: any) => m.role === "tool").map((m: any) => JSON.parse(m.content));
  assert.equal(results.length, 4);
  assert.equal(results[0].error, JOINT_AGENT_TOOL_REFUSAL);
  assert.equal(results[1].error, JOINT_AGENT_TOOL_REFUSAL);
  assert.equal(results[2].success, false);
  assert.ok(Array.isArray(results[3].deals));
  const paths = r.calls.map(c => new URL(c.url).pathname);
  assert.deepEqual([...new Set(paths)].sort(), ["/api/landsec/deals", "/api/landsec/home"]);
});

test("the run stops when asked, and ends when the model never answers", async () => {
  const base = { ...deps(), userName: "Jo", today: "T", model: "m", sendProgress: () => {}, sendDelta: () => {} };
  const stopped = await runJointAgentChat(req(), [{ role: "user", content: "x" }], { ...base, isCancelled: () => true, callModel: async () => { throw new Error("must not be called"); } });
  assert.equal(stopped.stopped, true);
  let n = 0;
  const looping = await runJointAgentChat(req(), [{ role: "user", content: "x" }], { ...base, isCancelled: () => false, callModel: async (opts: any) => { n++; return { choices: [{ message: opts.tools ? { tool_calls: [{ id: String(n), function: { name: "ja_my_tasks", arguments: "{}" } }] } : {} }] }; } });
  assert.equal(looping.partial, true);
  assert.equal(n, 12);
  let late = 0;
  const slow = await runJointAgentChat(req(), [{ role: "user", content: "x" }], { ...base, isCancelled: () => false, now: () => (late++ === 0 ? 0 : 11 * 60 * 1000), deadlineMs: 60 * 60 * 1000, callModel: async () => { throw new Error("past the ten minutes"); } });
  assert.equal(slow.partial, true);
});

test("a role that cannot be read is never read as 'not a joint agent'", async () => {
  const broken: any = { headers: {} };
  Object.defineProperty(broken, "session", { get() { throw new Error("session store down"); } });
  await assert.rejects(isJointAgentChat(broken));
  await assert.rejects(jointAgentToolGate("ja_my_schemes", {}, broken));
  await assert.rejects(jointAgentToolGate("search_crm", {}, broken));
});

test("a role row with a value nobody recognises is refused, never served as a full Landsec login", async () => {
  const { getLandsecAccess, restrictedLandsecApiDecision } = await import("./landsec-access");
  const { isKnownLandsecRole } = await import("../shared/landsec");
  const held = (role: any): any => ({ method: "GET", headers: {}, session: { userId: JA.userId }, _landsecAccessResolved: true, _landsecAccess: { role, schemes: ["westgate-oxford"], firm: "CBRE" } });
  for (const role of ["joint-agent", "JOINT_AGENT", "Joint_Agent", " joint_agent", "jointagent", "", "admin", 7, {}]) {
    assert.equal(isKnownLandsecRole(role), false, String(role));
    if (role === "") continue; // an empty cached role is still a row: checked below
    await assert.rejects(getLandsecAccess(held(role)), `getLandsecAccess ${String(role)}`);
    await assert.rejects(restrictedLandsecApiDecision(held(role), "/api/crm/companies"), `gateway ${String(role)}`);
    await assert.rejects(isJointAgentChat(held(role)), `isJointAgentChat ${String(role)}`);
    await assert.rejects(jointAgentToolGate("search_crm", { query: "Jersey" }, held(role)), `gate ${String(role)}`);
  }
  await assert.rejects(getLandsecAccess(held("")));
  for (const role of ["leasing_manager", "asset_manager", "joint_agent"]) {
    assert.equal(isKnownLandsecRole(role), true);
    assert.equal((await getLandsecAccess(held(role)))?.role, role);
  }
  assert.equal(await restrictedLandsecApiDecision(held("joint_agent"), "/api/crm/companies"), "deny");
  assert.equal(await restrictedLandsecApiDecision(held("asset_manager"), "/api/crm/companies"), null);
});

test("in chatbgp.ts the joint agent gate is the first thing each tool executor does", () => {
  const first = (start: string, needle: string, before: string[]) => {
    const at = chatbgpSource.indexOf(start);
    assert.ok(at > 0, start);
    const body = chatbgpSource.slice(at, at + 4000);
    const gate = body.indexOf(needle);
    assert.ok(gate > 0, `${start}: no ${needle}`);
    for (const b of before) { const i = body.indexOf(b); assert.ok(i > gate, `${start}: ${b} comes before the joint agent gate`); }
    assert.ok(body.slice(gate, gate + 400).includes("JOINT_AGENT_UNVERIFIED"), `${start}: a failed role read is not refused`);
  };
  first("export async function executeCrmToolRaw(", "jointAgentToolGate(fnName, fnArgs, req)", ["isInternalStaffRequest", "search_app_guide", "isClientRequestUser"]);
  first("export async function handleCrmToolCall(", "isJointAgentChat(req)", ["isInternalStaffRequest", "isClientRequestUser"]);
  first("  async function executeAnyTool(", "jointAgentToolGate(tcName, tcArgs, req)", ["isInternalStaffRequest", "isClientRequestUser", "msToken)"]);
});

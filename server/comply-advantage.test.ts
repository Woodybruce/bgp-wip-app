// ComplyAdvantage Mesh client (2026-11-18). Every reply below follows Mesh's
// own documentation (docs.mesh.complyadvantage.com: createTokenV3,
// createCustomerAndScreenSync, alertServiceGetRisks, getWorkflowState,
// entityScreeningGetConfigurations); nothing here talks to Mesh.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as ca from "./comply-advantage";

const API_ENV = { COMPLY_ADVANTAGE_ACCESS_KEY: "test-access-key", COMPLY_ADVANTAGE_SECRET: "test-secret" };
const OLD_ENV = { COMPLY_ADVANTAGE_USERNAME: "api-user", COMPLY_ADVANTAGE_PASSWORD: "old-login-word", COMPLY_ADVANTAGE_REALM: "bgp-realm" };
const NOW = Date.parse("2026-11-18T15:00:00Z");

interface Call { method: string; path: string; body: any; auth: string | null }
interface Reply { status: number; body?: unknown; headers?: Record<string, string> }

function mesh(handler: (call: Call, calls: Call[]) => Reply, env: Record<string, string> = API_ENV, clock = { now: NOW }) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const deps: ca.MeshDeps = {
    fetch: async (url: string, init: any = {}) => {
      const u = new URL(url);
      const call: Call = {
        method: init.method || "GET", path: u.pathname + u.search,
        body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization || null,
      };
      calls.push(call);
      const r = handler(call, calls);
      return {
        ok: r.status >= 200 && r.status < 300, status: r.status,
        headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null },
        text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {})),
      };
    },
    now: () => clock.now,
    sleep: async (ms: number) => { sleeps.push(ms); },
    env,
  };
  return { deps, calls, sleeps, clock };
}

const TOKEN: Reply = { status: 200, body: { access_token: "tok-1", expires_in: 86400, token_type: "Bearer", scope: "read:api write:api" } };

const workflow = (screening: Record<string, unknown>, alerts: string[] = [], screeningStatus = "COMPLETED"): Reply => ({
  status: 200,
  body: {
    workflow_instance_identifier: "95913b76-050c-40f3-9075-25f0737ac7d3",
    workflow_type: "create-and-screen",
    status: "COMPLETED",
    steps: ["customer-creation", "initial-risk-scoring", "customer-screening", "alerting"],
    step_details: {
      "customer-creation": { identifier: "s1", status: "COMPLETED", step_output: { customer_identifier: "c0ffee00-0000-4000-8000-000000000001" } },
      "initial-risk-scoring": { identifier: "s2", status: "COMPLETED", step_output: { overall_level: "LOW-RISK", overall_value: 10 } },
      "customer-screening": { identifier: "s3", status: screeningStatus, step_output: screening },
      alerting: { identifier: "s4", status: "COMPLETED", step_output: { alerts: alerts.map(identifier => ({ identifier })) } },
    },
  },
});

const risk = (opts: { name: string; types: string[]; score?: number; dob?: string[]; sanctions?: string[]; peps?: string[] }) => ({
  identifier: `risk-${opts.name}`,
  type: "ENTITY_SCREENING",
  decision: "NOT_REVIEWED",
  detail: {
    change_type: "ADDED",
    profile: {
      identifier: `profile-${opts.name}`,
      matching_name: opts.name,
      match_score: opts.score,
      match_types: ["name_exact"],
      person: opts.dob ? { dates_of_birth: opts.dob.map(value => ({ value, source: "list" })) } : undefined,
      risk_indicators: {
        aml_types: opts.types,
        sanctions: (opts.sanctions || []).map(name => ({ name })),
        peps: (opts.peps || []).map(name => ({ name })),
        lists: [], media: [],
      },
    },
  },
});

const isToken = (c: Call) => c.path === "/v3/token" || c.path === "/v2/token";
const isScreen = (c: Call) => c.method === "POST" && c.path.startsWith("/v2/workflows/sync/create-and-screen");

test("API credentials come first; the older login is used only without them", () => {
  assert.deepEqual(ca.meshCredentials({ ...OLD_ENV, ...API_ENV }), { kind: "api", accessKey: "test-access-key", secret: "test-secret" });
  assert.equal(ca.meshCredentials(OLD_ENV)?.kind, "legacy");
  assert.equal(ca.meshCredentials({ COMPLY_ADVANTAGE_ACCESS_KEY: "half" }), null);
  assert.equal(ca.meshCredentials({ COMPLY_ADVANTAGE_USERNAME: "u", COMPLY_ADVANTAGE_PASSWORD: "p" }), null);
});

test("signs in at /v3/token with the access key and secret, once a day", async () => {
  ca.resetComplyAdvantageState();
  const m = mesh(c => (isToken(c) ? TOKEN : workflow({ screening_result: "NO_PROFILES", aml_types: [] })));
  await ca.screenNames([{ name: "Jane Doe", kind: "person" }], m.deps);
  await ca.screenNames([{ name: "Acme Holdings Limited", kind: "company" }], m.deps);
  const signIns = m.calls.filter(isToken);
  assert.equal(signIns.length, 1);
  assert.equal(signIns[0].path, "/v3/token");
  assert.deepEqual(signIns[0].body, { access_key: "test-access-key", secret: "test-secret" });
  assert.ok(m.calls.filter(isScreen).every(c => c.auth === "Bearer tok-1"));
});

test("the older login signs in at /v2/token with username, password and realm", async () => {
  ca.resetComplyAdvantageState();
  const m = mesh(c => (isToken(c) ? TOKEN : workflow({ screening_result: "NO_PROFILES" })), OLD_ENV);
  await ca.getToken(m.deps);
  assert.equal(m.calls[0].path, "/v2/token");
  assert.deepEqual(m.calls[0].body, { username: "api-user", password: "old-login-word", realm: "bgp-realm" });
});

test("a refused sign-in pauses every sign-in, and new keys start afresh", async () => {
  ca.resetComplyAdvantageState();
  const m = mesh(c => (isToken(c) ? { status: 400, body: { error: "invalid_client", error_description: "Invalid access key or secret" } } : TOKEN));
  const first = await ca.screenNames([{ name: "Jane Doe" }, { name: "John Roe" }], m.deps);
  assert.deepEqual(first.map(r => r.status), ["error", "error"]);
  assert.equal(first[0].errorKind, "sign_in");
  assert.match(first[0].error || "", /refused the sign-in \(400 on \/v3\/token: Invalid access key or secret\)/);
  const again = await ca.screenNames([{ name: "Jane Doe" }], m.deps);
  assert.match(again[0].error || "", /sign-in paused/);
  assert.equal(m.calls.length, 1, "no second sign-in while paused");
  m.deps.env = { COMPLY_ADVANTAGE_ACCESS_KEY: "new-key", COMPLY_ADVANTAGE_SECRET: "new-secret" };
  await assert.rejects(ca.getToken(m.deps), /refused the sign-in/);
  assert.equal(m.calls.length, 2, "new keys are tried at once");
});

test("the older login's 429 lockout pauses for an hour; API keys' 429 for five minutes", async () => {
  ca.resetComplyAdvantageState();
  const old = mesh(() => ({ status: 429, body: { title: "Too Many Requests" } }), OLD_ENV);
  await assert.rejects(ca.getToken(old.deps));
  old.clock.now += 59 * 60_000;
  await assert.rejects(ca.getToken(old.deps), /paused/);
  assert.equal(old.calls.length, 1);
  old.clock.now += 2 * 60_000;
  await assert.rejects(ca.getToken(old.deps), /refused/);
  assert.equal(old.calls.length, 2);

  ca.resetComplyAdvantageState();
  const api = mesh(() => ({ status: 429, body: { code: "INFRA_RATE_LIMIT_EXCEEDED", detail: "Rate limit exceeded." } }));
  await assert.rejects(ca.getToken(api.deps));
  api.clock.now += 6 * 60_000;
  await assert.rejects(ca.getToken(api.deps), /refused/);
  assert.equal(api.calls.length, 2);
});

test("the screen request: a person by surname and given names, a company by legal name, monitoring off", () => {
  const person = ca.meshScreenBody({ name: "DOE, Jane Mary", role: "director" }, "bgp-p-x", null);
  // Mesh takes exactly one of full_name or last_name (22 November 2026: sending both was refused for every person).
  assert.deepEqual(person.customer.person, { last_name: "DOE", first_name: "Jane", middle_name: "Mary" });
  assert.equal("full_name" in person.customer.person, false);
  assert.deepEqual(person.monitoring, { entity_screening: { enabled: false } });
  assert.equal(person.configuration, undefined);
  assert.deepEqual(ca.meshScreenBody({ name: "Mrs Jane Doe", kind: "person" }, "id", null).customer.person, { last_name: "Doe", first_name: "Jane" });
  assert.deepEqual(ca.meshScreenBody({ name: "Madonna", kind: "person" }, "id", null).customer.person, { last_name: "Madonna" });
  const company = ca.meshScreenBody({ name: "ACME HOLDINGS LIMITED", role: "owner" }, "bgp-c-x", "cfg-1");
  assert.deepEqual(company.customer.company, { legal_name: "ACME HOLDINGS LIMITED" });
  assert.deepEqual(company.configuration, { screening_configuration_identifier: "cfg-1" });
  assert.deepEqual(ca.meshScreenBody({ name: "Landsec" }, "id", null).customer.undefined, { name: "Landsec" });
  assert.equal(ca.subjectKind({ name: "Landsec", role: "company" }), "company");
  assert.equal(ca.subjectKind({ name: "Jane Doe", role: "contact" }), "person");
  assert.equal(ca.subjectKind({ name: "Jane Doe" }), null);
});

test("one Mesh record per name per London day", () => {
  const a = ca.meshExternalId({ name: "DOE, Jane", kind: "person" }, "person", NOW);
  const b = ca.meshExternalId({ name: "Mrs Jane Doe", kind: "person" }, "person", NOW);
  assert.equal(a, b);
  assert.match(a, /^bgp-p-[0-9a-f]{20}-20261118$/);
  assert.notEqual(a, ca.meshExternalId({ name: "Jane Doe", kind: "person" }, "person", NOW + 86_400_000));
  assert.notEqual(a, ca.meshExternalId({ name: "Jane Doe", kind: "person", birthYear: 1980 }, "person", NOW));
  assert.notEqual(a, ca.meshExternalId({ name: "Jane Doe" }, "company", NOW));
  // 23:30 GMT on 18 November is still the 18th in London; 00:30 BST is the next day.
  assert.match(ca.meshExternalId({ name: "x" }, null, Date.parse("2026-11-18T23:30:00Z")), /-20261118$/);
  assert.match(ca.meshExternalId({ name: "x" }, null, Date.parse("2026-06-30T23:30:00Z")), /-20260701$/);
});

test("NO_PROFILES is clear; the screen waits for alerting", async () => {
  ca.resetComplyAdvantageState();
  const m = mesh(c => (isToken(c) ? TOKEN : workflow({ screening_result: "NO_PROFILES", aml_types: [] })));
  const [r] = await ca.screenNames([{ name: "Jane Doe", role: "director" }], m.deps);
  assert.equal(r.status, "clear");
  assert.deepEqual(r.matches, []);
  assert.equal(r.customerId, "c0ffee00-0000-4000-8000-000000000001");
  assert.equal(m.calls.find(isScreen)?.path, "/v2/workflows/sync/create-and-screen?last_sync_step=ALERTING");
});

test("HAS_PROFILES reads the alert's matched profiles: one match per kind", async () => {
  ca.resetComplyAdvantageState();
  const m = mesh(c => {
    if (isToken(c)) return TOKEN;
    if (isScreen(c)) return workflow({ screening_result: "HAS_PROFILES", aml_types: ["SANCTION", "PEP_CLASS_1"] }, ["a1"]);
    if (c.path.startsWith("/v2/alerts/a1/risks")) {
      return { status: 200, body: { total_count: 1, risks: [risk({ name: "Ivan Example", types: ["SANCTION", "PEP_CLASS_1"], score: 0.97, sanctions: ["UK Sanctions List"], peps: ["Duma members"] })] } };
    }
    return { status: 404 };
  });
  const [r] = await ca.screenNames([{ name: "Ivan Example", kind: "person" }], m.deps);
  assert.equal(r.status, "potential_match");
  assert.deepEqual(r.matches.map(x => [x.matchType, x.listName, x.score]), [["sanctions", "UK Sanctions List", 0.97], ["pep", "Duma members", 0.97]]);
  assert.equal(r.matches[0].name, "Ivan Example");
});

test("a score is read on Mesh's 0 to 100 scale, or as a fraction; anything else is not passed on", () => {
  const read = (score: number) => ca.matchesFromRisks([risk({ name: "A", types: ["ADVERSE-MEDIA-V2-FRAUD-LINKED"], score })], { name: "A" }, null).matches[0];
  assert.equal(read(87).matchType, "adverse_media");
  assert.equal(read(87).score, 0.87, "Mesh's screens score 0 to 100 (19 November 2026)");
  assert.equal(read(0.42).score, 0.42);
  assert.equal(read(250).score, undefined);
  assert.equal(read(-1).score, undefined);
});

test("each profile says whether its birth year agrees with the person's", () => {
  const near = ca.matchesFromRisks([risk({ name: "Jane Doe", types: ["PEP_CLASS_2"], dob: ["1984-05-01"] })], { name: "Jane Doe", birthYear: 1985 }, "person");
  assert.equal(near.matches[0].details.birthYearAgrees, true);
  const unknown = ca.matchesFromRisks([risk({ name: "Jane Doe", types: ["PEP_CLASS_2"] })], { name: "Jane Doe", birthYear: 1985 }, "person");
  assert.equal(unknown.matches[0].details.birthYearAgrees, null, "no date on the profile: not known");
  const noYear = ca.matchesFromRisks([risk({ name: "Jane Doe", types: ["PEP_CLASS_2"], dob: ["1984"] })], { name: "Jane Doe" }, "person");
  assert.equal(noYear.matches[0].details.birthYearAgrees, null, "no birth year for the person: not known");
});

test("a person goes to Mesh with their birth month and year and a UK nationality; Mesh refusing them screens the bare name", async () => {
  ca.resetComplyAdvantageState();
  assert.deepEqual(ca.meshPersonDetails({ name: "Jane Doe", birthYear: 1985, birthMonth: 4, nationality: "GB" }), { date_of_birth: { year: 1985, month: 4, day: null }, nationality: ["GB"] });
  assert.deepEqual(ca.meshPersonDetails({ name: "Jane Doe", birthYear: 1985, birthMonth: 13, nationality: "British" }), { date_of_birth: { year: 1985, month: null, day: null } });
  assert.deepEqual(ca.meshPersonDetails({ name: "Jane Doe" }), {});
  const body = ca.meshScreenBody({ name: "Jane Doe", kind: "person", birthYear: 1985, nationality: "GB" }, "x");
  assert.deepEqual(body.customer.person, { last_name: "Doe", first_name: "Jane", date_of_birth: { year: 1985, month: null, day: null }, nationality: ["GB"] });
  assert.deepEqual(ca.meshScreenBody({ name: "Jane Doe", kind: "person", birthYear: 1985 }, "x", null, { bare: true }).customer.person, { last_name: "Doe", first_name: "Jane" });
  assert.deepEqual(ca.meshScreenBody({ name: "Acme Limited", kind: "company", birthYear: 1985 }, "x").customer.company, { legal_name: "Acme Limited" });
  // Mesh refuses the details: the same screen goes again on the name alone, and the next one starts bare.
  const m = mesh(c => {
    if (isToken(c)) return TOKEN;
    if (isScreen(c)) return c.body.customer.person?.date_of_birth ? { status: 400, body: { message: "date_of_birth.day is required" } } : workflow({ screening_result: "NO_PROFILES" });
    return { status: 404 };
  });
  const [r] = await ca.screenNames([{ name: "Jane Doe", kind: "person", birthYear: 1985, nationality: "GB" }], m.deps);
  assert.equal(r.status, "clear");
  const screens = m.calls.filter(isScreen);
  assert.equal(screens.length, 2);
  assert.ok(screens[0].body.customer.person.date_of_birth && !screens[1].body.customer.person.date_of_birth);
  assert.equal(ca.meshRefusedDetailsRecently(NOW + 1000), true);
  assert.equal(ca.meshRefusedDetails()?.words, "date_of_birth.day is required", "Mesh's own words are kept for the connection check");
  await ca.screenNames([{ name: "John Roe", kind: "person", birthYear: 1970 }], m.deps);
  assert.ok(!m.calls.filter(isScreen).at(-1)!.body.customer.person.date_of_birth, "the next screen starts bare");
  assert.equal(m.calls.filter(isScreen).at(-1)!.body.customer.person.last_name, "Roe", "a bare screen still carries the last name Mesh requires");
  ca.resetComplyAdvantageState();
  assert.equal(ca.meshRefusedDetails(), null);
});

test("a person's name parts: the register's surname first, else the last word; titles dropped", () => {
  assert.deepEqual(ca.meshNameParts({ name: "BARRATT, Jack" }), { last_name: "BARRATT", first_name: "Jack" });
  assert.deepEqual(ca.meshNameParts({ name: "BENTLEY-SMITH, Rupert" }), { last_name: "BENTLEY-SMITH", first_name: "Rupert" });
  assert.deepEqual(ca.meshNameParts({ name: "ROBERTS, Charlotte Caroline" }), { last_name: "ROBERTS", first_name: "Charlotte", middle_name: "Caroline" });
  assert.deepEqual(ca.meshNameParts({ name: "Mr David Bruce" }), { last_name: "Bruce", first_name: "David" });
  assert.deepEqual(ca.meshNameParts({ name: "Madonna" }), { last_name: "Madonna" });
});

test("dates of birth: month and year when both give a month, within a year when one gives the year alone", () => {
  assert.deepEqual(ca.profileDobs([{ value: "1965-03-12T00:00:00.000Z" }, { value: "1960-01-01T00:00:00.000Z" }, "1971", { year: 1980, month: 7 }]),
    [{ year: 1965, month: 3 }, { year: 1960, month: null }, { year: 1971, month: null }, { year: 1980, month: 7 }]);
  const born = { birthYear: 1965, birthMonth: 3 };
  assert.equal(ca.profileDobAgrees({ year: 1965, month: 3 }, born), true);
  assert.equal(ca.profileDobAgrees({ year: 1965, month: 7 }, born), false, "same year, another month: someone else");
  assert.equal(ca.profileDobAgrees({ year: 1966, month: null }, born), true, "a year alone: within a year");
  assert.equal(ca.profileDobAgrees({ year: 1966, month: 3 }, { birthYear: 1965 }), true, "no month for the person: within a year");
  // A profile born in another month of the same year is set aside before it is kept.
  const other = ca.matchesFromRisks([risk({ name: "John Smith", types: ["PEP_CLASS_2"], dob: ["1965-07-14"] })], { name: "John Smith", birthYear: 1965, birthMonth: 3 }, "person");
  assert.equal(other.setAside, 1);
  const same = ca.matchesFromRisks([risk({ name: "John Smith", types: ["PEP_CLASS_2"], dob: ["1965-03-02"] })], { name: "John Smith", birthYear: 1965, birthMonth: 3 }, "person");
  assert.equal(same.matches[0].details.birthYearAgrees, true);
});

test("a hit whose profiles cannot be read is marked unread", async () => {
  ca.resetComplyAdvantageState();
  const m = mesh(c => {
    if (isToken(c)) return TOKEN;
    if (isScreen(c)) return workflow({ screening_result: "HAS_PROFILES", aml_types: ["PEP_CLASS_2"] }, ["a1"]);
    return { status: 500, body: {} };
  });
  const [r] = await ca.screenNames([{ name: "John Smith", kind: "person" }], m.deps);
  assert.equal(r.status, "potential_match");
  assert.equal(r.matches[0].details?.unread, true);
});

test("a profile whose every date of birth is over a year out is set aside", async () => {
  ca.resetComplyAdvantageState();
  const m = mesh(c => {
    if (isToken(c)) return TOKEN;
    if (isScreen(c)) return workflow({ screening_result: "HAS_PROFILES", aml_types: ["PEP_CLASS_2"] }, ["a1"]);
    return { status: 200, body: { total_count: 1, risks: [risk({ name: "John Smith", types: ["PEP_CLASS_2"], dob: ["1961-03-02"] })] } };
  });
  const [r] = await ca.screenNames([{ name: "John Smith", kind: "person", birthYear: 1985 }], m.deps);
  assert.equal(r.status, "clear");
  assert.equal(r.setAside, 1);
  const near = ca.matchesFromRisks([risk({ name: "John Smith", types: ["PEP_CLASS_2"], dob: ["1984"] })], { name: "John Smith", birthYear: 1985 }, "person");
  assert.equal(near.setAside, 0);
  const noDob = ca.matchesFromRisks([risk({ name: "John Smith", types: ["PEP_CLASS_2"] })], { name: "John Smith", birthYear: 1985 }, "person");
  assert.equal(noDob.matches.length, 1, "no date of birth on the profile: kept");
});

test("when the matched profiles cannot be read, Mesh's AML types still count", async () => {
  ca.resetComplyAdvantageState();
  const m = mesh(c => {
    if (isToken(c)) return TOKEN;
    if (isScreen(c)) return workflow({ screening_result: "HAS_PROFILES", aml_types: ["SANCTION", "WARNINGS"] }, ["a1"]);
    return { status: 403, body: { detail: "You do not have the permissions needed to access the resource." } };
  });
  const [r] = await ca.screenNames([{ name: "Jane Doe", kind: "person" }], m.deps);
  assert.equal(r.status, "potential_match");
  assert.deepEqual(r.matches.map(x => x.matchType), ["sanctions", "warning"]);
});

test("a 409 reads the earlier screen it points to, else screens under a fresh record", async () => {
  ca.resetComplyAdvantageState();
  const earlier = "11111111-2222-4333-8444-555555555555";
  const m = mesh(c => {
    if (isToken(c)) return TOKEN;
    if (isScreen(c)) return { status: 409, body: { title: "Conflict", status: 409, detail: "A workflow already exists", instance: `/v2/workflows/${earlier}` } };
    if (c.path === `/v2/workflows/${earlier}`) return workflow({ screening_result: "NO_PROFILES" });
    return { status: 404 };
  });
  const [r] = await ca.screenNames([{ name: "Jane Doe", kind: "person" }], m.deps);
  assert.equal(r.status, "clear");
  assert.equal(m.calls.filter(isScreen).length, 1);

  ca.resetComplyAdvantageState();
  let screens = 0;
  const n = mesh(c => {
    if (isToken(c)) return TOKEN;
    if (isScreen(c)) return ++screens === 1 ? { status: 409, body: { title: "Conflict", detail: "duplicate external identifier" } } : workflow({ screening_result: "NO_PROFILES" });
    return { status: 404 };
  });
  const [s] = await ca.screenNames([{ name: "Jane Doe", kind: "person" }], n.deps);
  assert.equal(s.status, "clear");
  const ids = n.calls.filter(isScreen).map(c => c.body.customer.external_identifier);
  assert.equal(ids.length, 2);
  assert.ok(ids[1].startsWith(`${ids[0]}-`), "the second try is a fresh record for the same name");
});

test("an expired token is replaced once; a rate limit is waited out", async () => {
  ca.resetComplyAdvantageState();
  let screens = 0;
  const m = mesh(c => {
    if (isToken(c)) return TOKEN;
    screens++;
    if (screens === 1) return { status: 401, body: { title: "Unauthorized", detail: "Invalid authentication for resource." } };
    if (screens === 2) return { status: 429, headers: { "retry-after": "3" }, body: { code: "INFRA_RATE_LIMIT_EXCEEDED" } };
    return workflow({ screening_result: "NO_PROFILES" });
  });
  const [r] = await ca.screenNames([{ name: "Jane Doe", kind: "person" }], m.deps);
  assert.equal(r.status, "clear");
  assert.equal(m.calls.filter(isToken).length, 2, "signed in again after the 401");
  assert.deepEqual(m.sleeps, [3000]);
});

test("a login without permission to screen stops the batch and pauses screening", async () => {
  ca.resetComplyAdvantageState();
  const m = mesh(c => (isToken(c) ? TOKEN : { status: 403, body: { detail: "You do not have the permissions needed to access the resource." } }));
  const results = await ca.screenNames([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }, { name: "F" }], m.deps);
  assert.ok(results.every(r => r.status === "error" && r.errorKind === "permission"));
  assert.match(results[5].error || "", /may not create and screen customers \(403/);
  assert.ok(m.calls.filter(isScreen).length <= 4, "no new screen starts once one is refused");
  const before = m.calls.length;
  const again = await ca.screenNames([{ name: "A" }], m.deps);
  assert.match(again[0].error || "", /^Screening paused/);
  assert.equal(m.calls.length, before);
});

test("a screen Mesh skipped or did not finish is an error, never clear", () => {
  assert.equal(ca.readScreen(workflow({}, [], "SKIPPED").body).outcome, "unfinished");
  assert.match(ca.readScreen(workflow({}, [], "SKIPPED").body).reason || "", /prohibited/);
  assert.equal(ca.readScreen(workflow({ screening_result: "NO_PROFILES" }, [], "IN-PROGRESS").body).outcome, "unfinished");
  assert.equal(ca.readScreen({}).outcome, "unfinished");
});

test("Mesh's AML types in the app's words", () => {
  assert.equal(ca.amlKind("SANCTION"), "sanctions");
  assert.equal(ca.amlKind("PEP_CLASS_4"), "pep");
  assert.equal(ca.amlKind("ADVERSE_MEDIA"), "adverse_media");
  assert.equal(ca.amlKind("ADVERSE-MEDIA-V2-TERRORISM"), "adverse_media");
  assert.equal(ca.amlKind("WARNINGS"), "warning");
  assert.equal(ca.amlKind("FITNESS-PROBITY"), "fitness_probity");
});

test("the 409's earlier workflow is read from its body", () => {
  assert.equal(ca.conflictWorkflowId('{"instance":"/v2/workflows/95913b76-050c-40f3-9075-25f0737ac7d3"}'), "95913b76-050c-40f3-9075-25f0737ac7d3");
  assert.equal(ca.conflictWorkflowId('{"detail":"workflow 95913b76-050c-40f3-9075-25f0737ac7d3 is running"}'), "95913b76-050c-40f3-9075-25f0737ac7d3");
  assert.equal(ca.conflictWorkflowId('{"detail":"duplicate"}'), null);
});

test("the connection check reads the screening configurations and creates nothing", async () => {
  ca.resetComplyAdvantageState();
  const m = mesh(c => {
    if (isToken(c)) return TOKEN;
    if (c.path === "/v2/entity-screening/configurations") {
      return { status: 200, body: { configurations: [
        { configuration_identifier: "cfg-1", version: 1, configuration: { name: "Default", is_archived: false } },
        { configuration_identifier: "cfg-2", version: 3, configuration: { name: "Old", is_archived: true } },
      ] } };
    }
    return { status: 500 };
  }, { ...API_ENV, COMPLY_ADVANTAGE_SCREENING_CONFIG_ID: "cfg-9" });
  const check = await ca.checkComplyAdvantage(m.deps);
  assert.equal(check.credentials, "api");
  assert.equal(check.ok, false, "the configuration named on Railway is not in Mesh");
  assert.equal(check.screeningConfigFound, false);
  assert.match(check.message, /Signed in with API credentials\. 1 screening configuration \(Default\)/);
  assert.ok(m.calls.every(c => c.method === "GET" || isToken(c)), "only reads");

  ca.resetComplyAdvantageState();
  const none = mesh(c => (isToken(c) ? TOKEN : { status: 404, body: { title: "No configurations found" } }));
  assert.match((await ca.checkComplyAdvantage(none.deps)).message, /no screening configurations yet/);

  const unset = await ca.checkComplyAdvantage({ ...m.deps, env: {} });
  assert.equal(unset.ok, false);
  assert.match(unset.message, /COMPLY_ADVANTAGE_ACCESS_KEY/);
});

test("an account on Mesh's newer pipeline lists its configurations at /v3", async () => {
  ca.resetComplyAdvantageState();
  const m = mesh(c => {
    if (isToken(c)) return TOKEN;
    if (c.path === "/v2/entity-screening/configurations") return { status: 404, body: { title: "No configurations found" } };
    if (c.path === "/v3/entity-screening/configurations") {
      return { status: 200, body: { configurations: [{ configuration_identifier: "cfg-v3", version: 2, configuration: { name: "Onboarding", is_archived: false } }] } };
    }
    return { status: 500 };
  });
  const check = await ca.checkComplyAdvantage(m.deps);
  assert.deepEqual(check.configurations, [{ identifier: "cfg-v3", name: "Onboarding", archived: false }]);
  assert.match(check.message, /1 screening configuration \(Onboarding\); none is named on Railway, so Mesh picks one/);
  assert.deepEqual(m.calls.filter(c => !isToken(c)).map(c => c.path), ["/v2/entity-screening/configurations", "/v3/entity-screening/configurations"]);
});

test("the check says what each configuration screens and how closely", async () => {
  // A newer (match threshold) configuration, as Mesh's v3 list gives it.
  assert.equal(ca.describeMeshConfiguration({
    name: "chat bgp", results_limit: 50,
    source_collections: [
      { match_threshold: 0.5, method: "RISKS", risks: [{ taxonomy: "r_sanctions_exposure.r_direct_sanctions_exposure", source_types: [] }] },
      { name: "PEPs", match_threshold: 0.6, risks: [{ taxonomy: "r_political_exposure", source_types: [] }],
        exclusion_filters: [{ key: "FILTER_ATTRIBUTE_YEAR_OF_BIRTH", mismatch: { tolerance: "P1Y" } }] },
    ],
  }), "sanctions exposure: match threshold 50; PEPs [political exposure]: match threshold 60 (leaves out year of birth mismatch over 1 year); up to 50 results");
  // An older (fuzziness) configuration, as Mesh's v2 list gives it.
  assert.equal(ca.describeMeshConfiguration({
    name: "Default", country_filters: ["GB"],
    source_collections: [{ name: "Sanctions", fuzziness: 0.5, aml_types: ["sanction"], options: ["remove_deceased"], source_identifiers: [], description: "" }],
  }), "Sanctions [sanction]: fuzziness 50% (options remove_deceased); countries GB");
  // A named collection still says what it screens, so a collection that holds every risk shows as one.
  assert.equal(ca.describeMeshConfiguration({
    source_collections: [
      { name: "Chat", match_threshold: 0.5, risks: [
        { taxonomy: "r_sanctions_exposure.r_direct_sanctions_exposure" }, { taxonomy: "r_sanctions_exposure.r_indirect_sanctions_exposure" },
        { taxonomy: "r_political_exposure" }, { taxonomy: "r_adverse_media.r_financial_crime" },
      ] },
      { name: "rest", match_threshold: 0.9, risks: [{ taxonomy: "r_adverse_media" }], exclusion_filters: [
        { key: "FILTER_ATTRIBUTE_YEAR_OF_BIRTH", mismatch: { tolerance: "P0Y" } },
        { key: "FILTER_ATTRIBUTE_COUNTRY", mismatch: {} },
        { key: "FILTER_ATTRIBUTE_YEAR_OF_BIRTH", absent: {} },
      ] },
    ],
  }), "Chat [sanctions exposure, political exposure, adverse media]: match threshold 50; rest [adverse media]: match threshold 90 (leaves out year of birth mismatch; leaves out country mismatch; leaves out year of birth missing)");
  assert.equal(ca.describeMeshConfiguration({ name: "Empty" }), "");
  assert.equal(ca.describeMeshConfiguration(null), "");

  ca.resetComplyAdvantageState();
  const m = mesh(c => {
    if (isToken(c)) return TOKEN;
    if (c.path === "/v2/entity-screening/configurations") return { status: 404, body: { title: "No configurations found" } };
    if (c.path === "/v3/entity-screening/configurations") {
      return { status: 200, body: { configurations: [{ configuration_identifier: "cfg-b", version: 1, configuration: {
        name: "chat bgp", is_archived: false, source_collections: [{ match_threshold: 0.5, risks: [{ taxonomy: "r_adverse_media", source_types: [] }] }],
      } }] } };
    }
    return { status: 500 };
  });
  const check = await ca.checkComplyAdvantage(m.deps);
  assert.equal(check.configurations[0].settings, "adverse media: match threshold 50");
  assert.match(check.message, /1 screening configuration \(chat bgp: adverse media: match threshold 50\)/);
  assert.ok(m.calls.every(c => c.method === "GET" || isToken(c)), "only reads");
});

test("without keys nothing is screened and nothing is called", async () => {
  ca.resetComplyAdvantageState();
  const m = mesh(() => TOKEN, {});
  assert.deepEqual(await ca.screenNames([{ name: "Jane Doe" }], m.deps), []);
  assert.equal(m.calls.length, 0);
});

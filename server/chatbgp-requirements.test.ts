// ChatBGP's requirement tools, run against an in-memory intake store.
//   node --import tsx --test server/chatbgp-requirements.test.ts
// The SQL (search, context, the old-table back-fill) runs only on request, on
// a disposable PostgreSQL cluster that never reads the app's database:
//   RUN_DISPOSABLE_REQ_POSTGRES=1 node --import tsx --test server/chatbgp-requirements.test.ts
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { requirementLive } from "@shared/requirement-live";
import { brandKey, DIRECT_REASON, pgIntakeStore, type IntakeStore, type EvidenceRow, type RequirementRow, type Actor } from "./requirement-intake";
import {
  logRequirementFromChat, updateRequirementFromChat, sizeText, sameArea, splitPlaces,
  searchRequirementsForChat, OPEN_REQUIREMENTS_CONTEXT_SQL, propertyRequirementsContextSql, requirementContextTag,
  legacyRequirementsPreview, legacyRequirementsApply,
} from "./chatbgp-requirements";

const NOW = new Date("2026-11-12T10:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86400000);
const EMILY: Actor = { id: "u-emily", name: "Emily Stone" };
const TOM: Actor = { id: "u-tom", name: "Tom Reed" };

interface Company { id: string; name: string; otherNames?: string[] }
const PRET: Company = { id: "c-pret", name: "Pret A Manger", otherNames: ["Pret"] };
const WING_A: Company = { id: "c-wing-a", name: "Wingstop" };
const WING_B: Company = { id: "c-wing-b", name: "Wingstop" };

function fakeStore(seed: { companies?: Company[]; requirements?: RequirementRow[] } = {}) {
  const companies = seed.companies || [PRET];
  const evidence: EvidenceRow[] = [];
  const requirements: RequirementRow[] = (seed.requirements || []).map(r => ({ ...r }));
  let n = 0;
  const ref = (c: Company) => ({ id: c.id, name: c.name, hidden: false, brandType: true });
  const store = {
    async lock() {},
    async brandsForContacts() { return []; },
    async brandsByIds(ids: string[]) { return companies.filter(c => ids.includes(c.id)).map(ref); },
    async brandsNamedLike(name: string) {
      const word = brandKey(name).split(" ").sort((a, b) => b.length - a.length)[0] || "";
      return companies.filter(c => [c.name, ...(c.otherNames || [])].some(x => x.toLowerCase().includes(word))).map(c => ({ ...ref(c), otherNames: [c.name, ...(c.otherNames || [])] }));
    },
    async evidenceById(id: string) { return evidence.find(e => e.id === id) || null; },
    async evidenceByDedupeKey(key: string) { return evidence.find(e => e.dedupe_key === key) || null; },
    async openHeads(kind: string, companyId: string | null) { return evidence.filter(e => e.status === "open" && !e.suggestion_id && e.kind === kind && (companyId ? e.company_id === companyId : !e.company_id)); },
    async personDismissalsSince() { return []; },
    async suggestionLines(headId: string) { return evidence.filter(e => e.id === headId || e.suggestion_id === headId); },
    async insertEvidence(values: Partial<EvidenceRow>) {
      if (values.dedupe_key && evidence.some(e => e.dedupe_key === values.dedupe_key)) return null;
      const row = { requirement_id: null, company_id: null, candidate_company_ids: null, suggestion_id: null, status: "open", details: null, ...values, id: `e${++n}`, created_at: NOW, updated_at: NOW } as EvidenceRow;
      evidence.push(row);
      return row;
    },
    async updateEvidence(ids: string[], patch: Partial<EvidenceRow>) { for (const e of evidence) if (ids.includes(e.id)) Object.assign(e, patch); },
    async requirementById(id: string) { return requirements.find(r => r.id === id) || null; },
    async requirementsForCompanies(companyIds: string[]) { return requirements.filter(r => !!r.company_id && companyIds.includes(r.company_id)); },
    async insertRequirement(values: Record<string, any>) {
      const row = { id: `r${++n}`, created_at: NOW, updated_at: NOW, ...values } as RequirementRow;
      requirements.push(row);
      return row;
    },
    async updateRequirement(id: string, patch: Record<string, any>) { const r = requirements.find(x => x.id === id)!; Object.assign(r, patch); return r; },
  } as unknown as IntakeStore;
  return { store, evidence, requirements };
}

const bgpRow = (over: Partial<RequirementRow> = {}): RequirementRow => ({
  id: "r-leeds", name: "Pret A Manger", company_id: "c-pret", status: "Active", origin: "bgp", sources: null,
  size: ["1,000 - 2,000 sq ft"], requirement_locations: ["Leeds"], use: null, comments: "Called in March.",
  last_confirmed_at: days(-200), last_confirmed_by: "u-tom", last_confirmed_by_name: "Tom Reed", confirmed_how: "call",
  created_at: days(-300), updated_at: days(-200), ...over,
});

test("the pieces of a brief: size text, places, and whether two areas are the same search", () => {
  assert.equal(sizeText("2,000 sq ft", "5,000 sq ft"), "2,000 - 5,000 sq ft");
  assert.equal(sizeText("2000", "5000"), "2000 - 5000 sq ft");
  assert.equal(sizeText("2,000 sq ft", null), "From 2,000 sq ft");
  assert.equal(sizeText(null, "5,000 sq ft"), "Up to 5,000 sq ft");
  assert.equal(sizeText("200 sq m", "400 sq m"), "200 sq m - 400 sq m");
  assert.equal(sizeText("", undefined), null);
  assert.deepEqual(splitPlaces("Mayfair, Soho; Brighton & Hove"), ["Mayfair", "Soho", "Brighton & Hove"]);
  assert.deepEqual(splitPlaces(["Leeds", "leeds", " "]), ["Leeds"]);
  assert.equal(sameArea(["Leeds"], ["Leeds city centre"]), true);
  assert.equal(sameArea(["W1"], ["W12"]), false);
  assert.equal(sameArea(["Mayfair"], ["Leeds"]), false);
  assert.equal(sameArea([], ["Leeds"]), true, "no area said: nothing to tell them apart");
  assert.equal(sameArea(["Leeds"], null), true);
});

test("a staff member's word is the confirmation: a matched brand gets a live requirement owned by them", async () => {
  const { store, evidence, requirements } = fakeStore();
  const out = await logRequirementFromChat(store, { category: "Leasing", companyName: "Pret", sizeMin: "2,000 sq ft", sizeMax: "5,000 sq ft", location: "Leeds, York", budget: "£50 psf", notes: "Wants a corner site.", priority: "high", contactName: "Anna" }, EMILY, NOW);
  assert.equal(out.success, true);
  assert.equal(out.action, "created");
  assert.equal(requirements.length, 1);
  const r = requirements[0];
  assert.deepEqual([r.company_id, r.name, r.status, r.origin, r.confirmed_how, r.last_confirmed_by, r.bgp_contact_user_id], ["c-pret", "Pret A Manger", "Active", "bgp", "chat", "u-emily", "u-emily"]);
  assert.deepEqual([r.size, r.requirement_locations, r.sources], [["2,000 - 5,000 sq ft"], ["Leeds", "York"], ["ChatBGP"]]);
  assert.match(r.comments, /Wants a corner site\.\nBudget: £50 psf\nPriority: high\nContact: Anna/);
  assert.equal(requirementLive(r, NOW).state, "live");
  assert.equal(out.state, "Live");
  assert.match(out.message, /Live, confirmed today by Emily Stone/);
  assert.deepEqual([evidence.length, evidence[0].kind, evidence[0].status, evidence[0].resolved_reason, evidence[0].requirement_id, evidence[0].created_by_kind, evidence[0].source_label],
    [1, "chat", "confirmed", DIRECT_REASON, r.id, "person", "ChatBGP"]);
});

test("an unmatched or ambiguous brand is never invented: it waits as a suggestion and nothing is live", async () => {
  const { store, evidence, requirements } = fakeStore({ companies: [PRET, WING_A, WING_B] });
  const out = await logRequirementFromChat(store, { companyName: "Farmer J", location: "Soho" }, EMILY, NOW);
  assert.deepEqual([out.success, out.action, out.requirementSaved, out.reason], [true, "suggested", false, "unmatched"]);
  assert.match(out.message, /not matched to a brand in the CRM, so no requirement was made and nothing is live.*waiting in To confirm/);
  assert.equal(requirements.length, 0);
  assert.deepEqual([evidence[0].status, evidence[0].company_id, evidence[0].brand_name, evidence[0].created_by_user_id], ["open", null, "Farmer J", "u-emily"]);
  const tie = await logRequirementFromChat(store, { companyName: "Wingstop" }, EMILY, NOW);
  assert.deepEqual([tie.action, tie.reason], ["suggested", "ambiguous"]);
  assert.equal(requirements.length, 0);
  // Once the user gives the brand, the same suggestion is confirmed: no second evidence line, no stray suggestion.
  const fixed = await logRequirementFromChat(store, { companyName: "Wingstop", companyId: "c-wing-a", suggestionId: tie.suggestionId }, EMILY, NOW);
  assert.equal(fixed.action, "created");
  assert.deepEqual([requirements.length, requirements[0].company_id], [1, "c-wing-a"]);
  assert.equal(evidence.filter(e => e.status === "open").length, 1, "only the Farmer J suggestion is still waiting");
  const bad = await logRequirementFromChat(store, { companyName: "Pret", companyId: "c-nope" }, EMILY, NOW);
  assert.equal(bad.success, false);
});

test("same brand and area: the existing requirement is confirmed and added to, never a second row", async () => {
  const { store, evidence, requirements } = fakeStore({ requirements: [bgpRow()] });
  assert.equal(requirementLive(requirements[0], NOW).state, "to_confirm");
  const out = await logRequirementFromChat(store, { companyName: "Pret A Manger", sizeMin: "2,000 sq ft", sizeMax: "3,000 sq ft", location: "Leeds city centre", use: ["Restaurant"], notes: "Spoke to Anna today." }, EMILY, NOW);
  assert.deepEqual([out.success, out.action, out.alreadyExisted], [true, "updated", true]);
  assert.equal(requirements.length, 1);
  const r = requirements[0];
  assert.deepEqual([r.last_confirmed_by, r.confirmed_how, requirementLive(r, NOW).state], ["u-emily", "chat", "live"]);
  assert.deepEqual(r.size, ["1,000 - 2,000 sq ft"], "a saved size is not overwritten");
  assert.deepEqual(r.requirement_locations, ["Leeds"]);
  assert.deepEqual(r.use, ["Restaurant"], "an empty field is filled");
  assert.match(r.comments, /^Called in March\.\n\n\[12 Nov 2026, Emily Stone via ChatBGP\] 2,000 - 3,000 sq ft; Leeds city centre; Restaurant\. Spoke to Anna today\.$/);
  assert.deepEqual(out.notChanged.map((x: any) => x.field), ["size", "locations"]);
  assert.match(out.message, /did not add a second one.*saved size \(1,000 - 2,000 sq ft\) differs/);
  assert.deepEqual([evidence.length, evidence[0].requirement_id, evidence[0].status], [1, "r-leeds", "confirmed"]);
  // The same instruction again that day changes nothing.
  const again = await logRequirementFromChat(store, { companyName: "Pret A Manger", sizeMin: "2,000 sq ft", sizeMax: "3,000 sq ft", location: "Leeds city centre", use: ["Restaurant"], notes: "Spoke to Anna today." }, EMILY, NOW);
  assert.equal(again.action, "already_logged");
  assert.deepEqual([requirements.length, evidence.length], [1, 1]);
  assert.equal((r.comments.match(/via ChatBGP/g) || []).length, 1);
});

test("a different area, or several requirements: nothing is saved until the user says which", async () => {
  const { store, evidence, requirements } = fakeStore({ requirements: [bgpRow(), bgpRow({ id: "r-past", status: "Past", requirement_locations: ["Mayfair"] })] });
  const ask = await logRequirementFromChat(store, { companyName: "Pret", location: "Mayfair" }, EMILY, NOW);
  assert.deepEqual([ask.success, ask.needsChoice, ask.existing.length], [false, true, 1], "the closed Mayfair one is not offered");
  assert.match(ask.message, /already has a requirement.*Nothing was saved.*same search.*separate new search/);
  assert.deepEqual([requirements.length, evidence.length], [2, 0]);
  const fresh = await logRequirementFromChat(store, { companyName: "Pret", location: "Mayfair", newSearch: true }, EMILY, NOW);
  assert.equal(fresh.action, "created");
  assert.equal(requirements.length, 3);
  // Two open now and no area said: ask again.
  const vague = await logRequirementFromChat(store, { companyName: "Pret", notes: "Still keen." }, EMILY, NOW);
  assert.deepEqual([vague.needsChoice, vague.existing.length], [true, 2]);
  const picked = await logRequirementFromChat(store, { companyName: "Pret", notes: "Still keen.", requirementId: "r-leeds" }, EMILY, NOW);
  assert.equal(picked.action, "updated");
  assert.equal(requirements.find(r => r.id === "r-leeds")!.last_confirmed_by, "u-emily");
  assert.equal(requirements.length, 3);
});

test("a PIPnet row clients can see is confirmed, but what staff said is not copied onto it", async () => {
  const listing = bgpRow({ id: "r-pip", origin: "pipnet", sources: ["PIPnet"], comments: "Source: PIPnet", last_confirmed_at: null, last_confirmed_by: null, last_confirmed_by_name: null, confirmed_how: null });
  const { store, evidence, requirements } = fakeStore({ requirements: [listing] });
  const out = await logRequirementFromChat(store, { companyName: "Pret", location: "Leeds", budget: "£60 psf", notes: "Their agent says the board has signed off 10 sites." }, EMILY, NOW);
  assert.deepEqual([out.action, out.briefKeptAsEvidenceOnly], ["updated", true]);
  const r = requirements[0];
  assert.equal(r.comments, "Source: PIPnet");
  assert.deepEqual([r.last_confirmed_by, r.origin, requirementLive(r, NOW).state], ["u-emily", "pipnet", "live"]);
  assert.match(evidence[0].excerpt || "", /board has signed off/);
  assert.match(out.message, /PIPnet listing, which client logins can see/);
  // The update tool keeps to the same rule: status and "still live" only.
  const note = await updateRequirementFromChat(store, { id: "r-pip", notes: "Private note.", sizeMin: "5,000 sq ft" }, EMILY, NOW);
  assert.deepEqual([note.success, note.withheldFromClientVisibleRow], [false, true]);
  const still = await updateRequirementFromChat(store, { id: "r-pip", notes: "Private note.", stillLive: true }, TOM, NOW);
  assert.deepEqual([still.success, still.withheldFromClientVisibleRow, r.last_confirmed_by], [true, true, "u-tom"]);
  assert.deepEqual([r.comments, r.size], ["Source: PIPnet", ["1,000 - 2,000 sq ft"]]);
});

test("press only: the requirement is press-reported until someone records speaking to the brand", async () => {
  const { store, requirements } = fakeStore();
  const out = await logRequirementFromChat(store, { companyName: "Pret", notes: "Propel says 20 new UK shops.", how: "press" }, EMILY, NOW);
  assert.equal(out.action, "created");
  assert.equal(requirements[0].confirmed_how, "press");
  assert.equal(out.pressReported, true);
  assert.match(out.message, /press-reported until someone records speaking to the brand/);
});

test("investment requirements and nameless briefs are refused, and nothing is written", async () => {
  const { store, evidence, requirements } = fakeStore();
  const inv = await logRequirementFromChat(store, { category: "Investment", companyName: "Pret", budget: "£5m" }, EMILY, NOW);
  assert.equal(inv.success, false);
  assert.match(inv.message, /Investment \(buyer\) requirements are not logged with this tool/);
  assert.equal((await logRequirementFromChat(store, { notes: "someone wants space" }, EMILY, NOW)).success, false);
  assert.deepEqual([requirements.length, evidence.length], [0, 0]);
});

test("update: notes are added, saved details are replaced only on request, and an edit is not a confirmation", async () => {
  const { store, requirements } = fakeStore({ requirements: [bgpRow()] });
  const r = requirements[0];
  const held = await updateRequirementFromChat(store, { id: "r-leeds", sizeMin: "3,000 sq ft", sizeMax: "4,000 sq ft" }, EMILY, NOW);
  assert.deepEqual([held.success, held.needsConfirmation.length], [false, 1]);
  assert.deepEqual(r.size, ["1,000 - 2,000 sq ft"]);
  const edit = await updateRequirementFromChat(store, { id: "r-leeds", sizeMin: "3,000 sq ft", sizeMax: "4,000 sq ft", replaceSaved: true, notes: "Now want bigger.", use: ["Restaurant"] }, EMILY, NOW);
  assert.equal(edit.success, true);
  assert.deepEqual([r.size, r.use], [["3,000 - 4,000 sq ft"], ["Restaurant"]]);
  assert.match(r.comments, /^Called in March\.\n\n\[12 Nov 2026, Emily Stone via ChatBGP\] Now want bigger\.$/);
  assert.equal(r.last_confirmed_by, "u-tom", "the edit did not confirm it");
  assert.equal(requirementLive(r, NOW).state, "to_confirm");
  assert.match(edit.message, /an edit is not a confirmation/);
  const live = await updateRequirementFromChat(store, { id: "r-leeds", stillLive: true, how: "call" }, EMILY, NOW);
  assert.deepEqual([live.success, live.confirmedStillLive, r.last_confirmed_by, r.confirmed_how, live.state], [true, true, "u-emily", "call", "Live"]);
  const closed = await updateRequirementFromChat(store, { id: "r-leeds", status: "fulfilled" }, EMILY, NOW);
  assert.deepEqual([closed.success, r.status, closed.state], [true, "Past", "Closed"]);
  const hold = await updateRequirementFromChat(store, { id: "r-leeds", status: "on_hold" }, EMILY, NOW);
  assert.equal(r.status, "Archived");
  assert.match(hold.message, /no On hold status/);
  assert.match(r.comments, /On hold$/);
  assert.equal((await updateRequirementFromChat(store, { id: "r-leeds", status: "banana" }, EMILY, NOW)).success, false);
  assert.equal((await updateRequirementFromChat(store, { id: "r-nope", notes: "x" }, EMILY, NOW)).success, false);
  assert.equal((await updateRequirementFromChat(store, { id: "r-leeds" }, EMILY, NOW)).success, false);
  // A closed requirement cannot be confirmed as still live.
  await assert.rejects(updateRequirementFromChat(store, { id: "r-leeds", stillLive: true }, TOM, NOW), (e: any) => e.code === "REQUIREMENT_CLOSED");
});

test("both tools are refused for client logins, and no ChatBGP code writes or reads the old requirements table", async () => {
  const source = await readFile(path.join(process.cwd(), "server", "chatbgp.ts"), "utf8");
  const blocked = source.slice(source.indexOf("export const CLIENT_BLOCKED_TOOLS = new Set(["), source.indexOf("export function isToolAllowedForClient"));
  assert.match(blocked, /"create_requirement"/);
  assert.match(blocked, /"update_requirement"/);
  for (const file of ["chatbgp.ts", "mcp-server.ts"]) {
    const text = await readFile(path.join(process.cwd(), "server", file), "utf8");
    assert.doesNotMatch(text, /(?:FROM|INTO|UPDATE)\s+requirements\b/i, `${file} still touches the old table`);
  }
});

test("search, context and the old-table back-fill run on real PostgreSQL", { skip: process.env.RUN_DISPOSABLE_REQ_POSTGRES !== "1" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bgp-req-chat-test-"));
  const data = path.join(directory, "data"), socket = path.join(directory, "socket");
  const run = (command: string, args: string[]) => execFileSync(command, args, { stdio: "pipe", timeout: 60_000 });
  let started = false, pool: pg.Pool | undefined;
  try {
    await mkdir(socket, { mode: 0o700 });
    run("initdb", ["-D", data, "-A", "trust", "-U", "qa_req", "--no-locale", "-E", "UTF8"]);
    run("pg_ctl", ["-D", data, "-l", path.join(directory, "postgres.log"), "-w", "-t", "30", "-o",
      `-k ${socket} -c listen_addresses='' -c fsync=off -c synchronous_commit=off -c shared_buffers=16MB -c timezone=UTC`, "start"]);
    started = true;
    pool = new pg.Pool({ host: socket, port: 5432, database: "postgres", user: "qa_req", password: "", ssl: false, max: 4 });
    await pool.query(`
      CREATE TABLE users (id varchar PRIMARY KEY, name text, email text, role text, is_active boolean DEFAULT true);
      CREATE TABLE crm_companies (id varchar PRIMARY KEY, name text NOT NULL, company_type text, merged_into_id varchar, archived_at timestamp,
        uk_entity_name text, trading_entities jsonb, ai_generated_fields jsonb);
      CREATE TABLE crm_contacts (id varchar PRIMARY KEY, name text, email text, company_id varchar);
      CREATE TABLE brand_agent_representations (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), brand_company_id varchar NOT NULL, agent_company_id varchar,
        agent_type text NOT NULL, primary_contact_id varchar, start_date timestamp, end_date timestamp);
      CREATE TABLE crm_properties (id varchar PRIMARY KEY, name text);
      CREATE TABLE requirements (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), category text NOT NULL, company_name text NOT NULL, contact_name text, size_min text, size_max text,
        budget text, location text, status text NOT NULL DEFAULT 'active', notes text, priority text DEFAULT 'medium');
      CREATE TABLE crm_requirements_leasing (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, monday_item_id text, group_name text, status text,
        company_id varchar, use text[], requirement_type text[], size text[], requirement_locations text[], location_data text, principal_contact_id varchar,
        agent_contact_id varchar, bgp_contact_user_id varchar, bgp_contact_user_ids text[], deal_id varchar, landlord_pack text, extract text, comments text,
        requirement_date text, contacted boolean DEFAULT false, details_sent boolean DEFAULT false, viewing boolean DEFAULT false, shortlisted boolean DEFAULT false,
        under_offer boolean DEFAULT false, sources text[], created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
      INSERT INTO crm_companies (id, name, company_type, ai_generated_fields) VALUES ('c-pret','Pret A Manger','Tenant - Café','{"brand_identity":{"status":"verified","aliases":["Pret"]}}'), ('c-gails','Gail''s Bakery','Tenant - Bakery',NULL);
      INSERT INTO crm_properties VALUES ('p1','Trinity Leeds');`);
    await pool.query(await readFile(path.join(process.cwd(), "migrations", "0056_requirements_centre.sql"), "utf8"));
    await pool.query(`INSERT INTO crm_requirements_leasing (id, name, company_id, status, origin, sources, size, requirement_locations, comments, last_confirmed_at, last_confirmed_by, last_confirmed_by_name, confirmed_how, last_listed_at, last_listed_source, created_at, updated_at) VALUES
      ('q-listing','Pret A Manger','c-pret','Active','pipnet','{PIPnet}','{"1,000 - 2,000 sq ft"}','{Trinity Leeds}','Source: PIPnet',NULL,NULL,NULL,NULL,$2,'PIPnet',$2,$2),
      ('q-live','Pret A Manger','c-pret','Active','bgp',NULL,'{"2,000 - 3,000 sq ft"}','{Trinity Leeds,York}','BGP note',$1,'u-emily','Emily Stone','call',NULL,NULL,$2,$2),
      ('q-past','Pret A Manger','c-pret','Past','bgp',NULL,NULL,'{Trinity Leeds}',NULL,$1,'u-emily','Emily Stone','call',NULL,NULL,$2,$2),
      ('q-own','Gail''s Bakery','c-gails','Active','bgp',NULL,NULL,'{York}','100% not a pret_ row',NULL,NULL,NULL,NULL,NULL,NULL,$2,$2)`, [days(-10), days(-40)]);

    // Search: Live first, each row says how it is known; LIKE wildcards in the words are literal.
    const found = await searchRequirementsForChat(pool, "pret", 100, NOW);
    assert.deepEqual(found.map(r => [r.id, r.state]), [["q-live", "Live"], ["q-own", "To confirm"], ["q-listing", "Background"], ["q-past", "Closed"]], "q-own matches on its comment");
    assert.deepEqual([found[0].howKnown, found[0].lastConfirmed, found[2].howKnown, found[2].lastConfirmed, found[2].marketListing], ["confirmed 2 Nov by Emily", "2026-11-02", "listed on PIPnet 3 Oct", null, true]);
    assert.deepEqual([found[1].lastConfirmed, found[1].why], [null, "Nobody has confirmed this with the brand yet"]);
    assert.deepEqual((await searchRequirementsForChat(pool, "york", 100, NOW)).map(r => r.id).sort(), ["q-live", "q-own"]);
    assert.deepEqual((await searchRequirementsForChat(pool, "pret_", 100, NOW)).map(r => r.id), ["q-own"]);
    assert.deepEqual(await searchRequirementsForChat(pool, "p", 100, NOW), []);

    // Context: Live and To confirm only; a client's property thread gets only PIPnet-labelled rows, never closed ones.
    const ctx = (await pool.query(OPEN_REQUIREMENTS_CONTEXT_SQL)).rows;
    assert.deepEqual(ctx.map(r => r.company_name), ["Pret A Manger", "Gail's Bakery"]);
    assert.match(requirementContextTag(ctx[0], NOW), /^ \[Live: confirmed 2 Nov by Emily\]$/);
    const forStaff = (await pool.query(propertyRequirementsContextSql(false), ["p1"])).rows;
    const forClient = (await pool.query(propertyRequirementsContextSql(true), ["p1"])).rows;
    assert.deepEqual([forStaff.map(r => r.size?.[0]), forClient.map(r => r.size?.[0])], [["2,000 - 3,000 sq ft", "1,000 - 2,000 sq ft"], ["1,000 - 2,000 sq ft"]]);

    // The old table: preview is read-only; Apply only ever opens suggestions, once.
    await pool.query(`INSERT INTO requirements (id, category, company_name, contact_name, size_min, size_max, budget, location, status, notes) VALUES
      ('l1','Leasing','Pret','Anna','2,000 sq ft','3,000 sq ft','£50 psf','Leeds','active','Old chat note'),
      ('l2','Leasing','Farmer J',NULL,NULL,NULL,NULL,'Soho','on_hold',NULL),
      ('l3','Investment','Big Fund',NULL,NULL,NULL,'£5m',NULL,'active',NULL),
      ('l4','Leasing','Gail''s Bakery',NULL,NULL,NULL,NULL,NULL,'fulfilled',NULL)`);
    const preview = await legacyRequirementsPreview(pool, NOW);
    assert.deepEqual([preview.total, preview.wouldSuggest, preview.wouldSkip], [4, 2, 2]);
    const byId = Object.fromEntries(preview.rows.map(r => [r.id, r]));
    assert.deepEqual([byId.l1.plan, byId.l1.brand?.matched, byId.l1.brand?.existingRequirements.length, byId.l2.brand?.matched, byId.l3.plan, byId.l4.plan], ["suggestion", true, 2, false, "skip", "skip"]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM requirement_evidence`)).rows[0].n, 0, "the preview wrote nothing");
    const before = (await pool.query(`SELECT count(*)::int AS n FROM crm_requirements_leasing`)).rows[0].n;
    const applied = await legacyRequirementsApply(pool, ["l1", "l2", "l3", "missing"], EMILY, NOW);
    assert.deepEqual([applied.suggestionsOpened, applied.skipped, applied.failed], [2, 2, 0]);
    const lines = (await pool.query(`SELECT status, kind, company_id, brand_name, requirement_id, created_by_kind, created_by_name, source_ref FROM requirement_evidence ORDER BY source_ref`)).rows;
    assert.deepEqual(lines, [
      { status: "open", kind: "chat", company_id: "c-pret", brand_name: "Pret", requirement_id: null, created_by_kind: "machine", created_by_name: "Old ChatBGP log", source_ref: "l1" },
      { status: "open", kind: "chat", company_id: null, brand_name: "Farmer J", requirement_id: null, created_by_kind: "machine", created_by_name: "Old ChatBGP log", source_ref: "l2" },
    ]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM crm_requirements_leasing`)).rows[0].n, before, "no requirement was made");
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM requirements`)).rows[0].n, 4, "the old rows are left where they are");
    const again = await legacyRequirementsApply(pool, ["l1", "l2"], EMILY, NOW);
    assert.deepEqual([again.suggestionsOpened, again.skipped], [0, 2]);
    assert.equal((await legacyRequirementsPreview(pool, NOW)).wouldSuggest, 0);

    // The tools against the real store: same area re-confirms, a new search is BGP's own row labelled ChatBGP.
    const store = pgIntakeStore(pool);
    const same = await logRequirementFromChat(store, { companyName: "Pret A Manger", location: "York", notes: "Still looking." }, TOM, NOW);
    assert.deepEqual([same.action, same.id], ["updated", "q-live"]);
    const live = (await pool.query(`SELECT last_confirmed_by, comments FROM crm_requirements_leasing WHERE id = 'q-live'`)).rows[0];
    assert.deepEqual([live.last_confirmed_by, live.comments], ["u-tom", "BGP note\n\n[12 Nov 2026, Tom Reed via ChatBGP] York. Still looking."]);
    assert.equal((await logRequirementFromChat(store, { companyName: "Gail's Bakery", location: "Bath" }, TOM, NOW)).needsChoice, true);
    const made = await logRequirementFromChat(store, { companyName: "Gail's Bakery", location: "Bath", sizeMin: "1,000", sizeMax: "1,500", newSearch: true }, TOM, NOW);
    const row = (await pool.query(`SELECT * FROM crm_requirements_leasing WHERE id = $1`, [made.id])).rows[0];
    assert.deepEqual([made.action, row.origin, row.sources, row.size, row.requirement_locations, row.bgp_contact_user_ids, row.confirmed_how, requirementLive(row, NOW).state],
      ["created", "bgp", ["ChatBGP"], ["1,000 - 1,500 sq ft"], ["Bath"], ["u-tom"], "chat", "live"]);
    const edited = await updateRequirementFromChat(store, { id: made.id, status: "withdrawn", notes: "Pulled out." }, TOM, NOW);
    assert.deepEqual([edited.success, edited.state], [true, "Closed"]);
  } finally {
    await pool?.end().catch(() => {});
    if (started) { try { run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]); } catch {} }
    await rm(directory, { recursive: true, force: true });
  }
});

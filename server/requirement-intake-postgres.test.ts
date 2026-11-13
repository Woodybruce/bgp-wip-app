// Explicitly opt-in: starts a new disposable Unix-socket-only PostgreSQL cluster
// and runs migration 0056, the intake's Postgres store and the live rule's SQL
// against it. Never reads the app's DATABASE_URL, app configuration or existing
// database credentials: for the feeds (server/requirement-feeds.ts, which use
// the app's pool) it points DATABASE_URL at the disposable cluster itself.
//   RUN_DISPOSABLE_REQ_POSTGRES=1 node --import tsx --test server/requirement-intake-postgres.test.ts
// (initdb and pg_ctl must be on PATH and the caller must not be root.)
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { requirementLive, requirementStateSql } from "@shared/requirement-live";
import { expandingBrands, dismissFromNews } from "./requirement-news";
import { pgIntakeStore, suggest, confirm, attach, dismiss, markSatisfied, stillLive, setOwner, setSuggestionBrand, matchBrand, listSuggestions, requirementEvidence, IntakeError, type Actor } from "./requirement-intake";

const NOW = new Date("2026-11-12T10:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86400000);
const EMILY: Actor = { id: "u-emily", name: "Emily Stone" };

test("the intake's Postgres store, migration 0056 and the live rule's SQL run on real PostgreSQL", { skip: process.env.RUN_DISPOSABLE_REQ_POSTGRES !== "1" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bgp-req-intake-test-"));
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
    // Only the columns the intake reads; crm_requirements_leasing as it stood before 0056.
    await pool.query(`
      CREATE TABLE users (id varchar PRIMARY KEY, name text, email text, role text, is_active boolean DEFAULT true);
      CREATE TABLE crm_companies (id varchar PRIMARY KEY, name text NOT NULL, company_type text, merged_into_id varchar, archived_at timestamp,
        uk_entity_name text, trading_entities jsonb, ai_generated_fields jsonb);
      CREATE TABLE crm_contacts (id varchar PRIMARY KEY, name text, email text, company_id varchar);
      CREATE TABLE brand_agent_representations (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), brand_company_id varchar NOT NULL, agent_company_id varchar,
        agent_type text NOT NULL, primary_contact_id varchar, start_date timestamp, end_date timestamp);
      CREATE TABLE crm_properties (id varchar PRIMARY KEY, name text);
      CREATE TABLE available_units (id varchar PRIMARY KEY, unit_name text, property_id varchar);
      CREATE TABLE unit_viewings (id varchar PRIMARY KEY, unit_id varchar, requirement_id varchar, viewing_date text NOT NULL, status text NOT NULL DEFAULT 'scheduled',
        company_id varchar, company_name text, details_confirmed_at timestamptz, deleted_at timestamptz, updated_at timestamptz);
      CREATE TABLE unit_offers (id varchar PRIMARY KEY, unit_id varchar NOT NULL, company_id varchar, company_name text, offer_date text NOT NULL, status text, confirmed_at timestamptz);
      CREATE TABLE property_units (id varchar PRIMARY KEY, property_id varchar, unit_name text);
      CREATE TABLE crm_deals (id varchar PRIMARY KEY, deal_ref integer, name text NOT NULL, deal_type text, status text, tenant_id varchar, property_id varchar, unit_id varchar);
      CREATE TABLE system_settings (key text PRIMARY KEY, value jsonb, updated_at timestamp DEFAULT now());
      CREATE TABLE crm_requirements_leasing (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, monday_item_id text, group_name text, status text,
        company_id varchar, use text[], requirement_type text[], size text[], requirement_locations text[], location_data text, principal_contact_id varchar,
        agent_contact_id varchar, bgp_contact_user_id varchar, bgp_contact_user_ids text[], deal_id varchar, landlord_pack text, extract text, comments text,
        requirement_date text, contacted boolean DEFAULT false, details_sent boolean DEFAULT false, viewing boolean DEFAULT false, shortlisted boolean DEFAULT false,
        under_offer boolean DEFAULT false, sources text[], created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
      INSERT INTO users VALUES ('u-emily','Emily Stone','emily@brucegillinghampollard.com','Staff',true), ('u-tom','Tom Reed','tom@brucegillinghampollard.com','Staff',true),
        ('u-left','Left Staff','left@brucegillinghampollard.com','Staff',false), ('u-client','Client Person','someone@landsec.com','Client',true);
      INSERT INTO crm_companies (id,name,company_type,merged_into_id,archived_at,uk_entity_name,trading_entities,ai_generated_fields) VALUES
        ('c-pret','Pret A Manger','Tenant - Café',NULL,NULL,'Pret A Manger (Europe) Limited',NULL,'{"brand_identity":{"status":"verified","aliases":["Pret"]}}'),
        ('c-gails','Gail''s Bakery','Tenant - Bakery',NULL,NULL,NULL,'[{"name":"Gail''s Limited"}]',NULL),
        ('c-old','Pret Old','Tenant - Café','c-pret',NULL,NULL,NULL,NULL),
        ('c-agent','Shelley Sandzer','Agent',NULL,NULL,NULL,NULL,NULL),
        ('c-wing-a','Wingstop','Tenant - Quick Service',NULL,NULL,NULL,NULL,NULL),
        ('c-wing-b','Wingstop','Tenant - Restaurant',NULL,now(),NULL,NULL,NULL);
      INSERT INTO crm_contacts VALUES ('ct-1','Anna','Anna@Pret.com','c-pret'), ('ct-2','Agent','agent@firm.com','c-agent');
      INSERT INTO brand_agent_representations (brand_company_id,agent_type,primary_contact_id) VALUES ('c-pret','tenant_rep','ct-2'), ('c-gails','tenant_rep','ct-2');
      INSERT INTO crm_properties VALUES ('p1','Trinity Leeds');
      INSERT INTO available_units VALUES ('au1','Unit 4','p1');`);
    // Migration 0056 as shipped, twice: additive and safe to run again.
    const migration = await readFile(path.join(process.cwd(), "migrations", "0056_requirements_centre.sql"), "utf8");
    await pool.query(migration);
    await pool.query(migration);

    const store = pgIntakeStore(pool);
    // Brand matching.
    assert.deepEqual(await matchBrand(store, { emails: ["anna@pret.com"], name: "Gail's Bakery" }).then(m => [m.companyId, m.by]), ["c-pret", "contact"]);
    assert.deepEqual(await matchBrand(store, { companyIds: ["c-old"] }).then(m => [m.companyId, m.by]), ["c-pret", "tag"]);
    assert.deepEqual(await matchBrand(store, { name: "Pret" }).then(m => [m.companyId, m.by]), ["c-pret", "alias"]);
    assert.deepEqual(await matchBrand(store, { name: "Gail's Limited" }).then(m => [m.companyId, m.by]), ["c-gails", "alias"]);
    assert.deepEqual(await matchBrand(store, { name: "PRET A MANGER LTD" }).then(m => [m.companyId, m.by]), ["c-pret", "name"]);
    assert.equal((await matchBrand(store, { name: "Wingstop" })).companyId, "c-wing-a", "the hidden twin loses the tie");
    const tie = await matchBrand(store, { contactIds: ["ct-2"] });
    assert.deepEqual([tie.companyId, tie.candidates.map(c => c.id).sort()], [null, ["c-gails", "c-pret"]]);
    assert.equal((await matchBrand(store, { contactIds: ["ct-2"], name: "Gail's Bakery" })).companyId, "c-gails");
    assert.equal((await matchBrand(store, { name: "Farmer J" })).companyId, null);

    // Suggest, join, de-duplicate.
    const first = await suggest(store, { kind: "press", brand: { name: "Pret A Manger" }, sourceLabel: "Propel", headline: "Pret to open 20", evidenceDate: NOW,
      details: { sites: 20, locations: ["Leeds"] }, dedupeKey: "propel:1", detectedBy: "News reader" }, { now: NOW });
    assert.deepEqual([first.outcome, first.evidence.company_id, first.evidence.status, first.evidence.details?.sites], ["opened", "c-pret", "open", 20]);
    const second = await suggest(store, { kind: "press", brand: { name: "Pret" }, headline: "More Pret", dedupeKey: "propel:2" }, { now: NOW });
    assert.deepEqual([second.outcome, second.evidence.suggestion_id], ["joined", first.evidence.id]);
    assert.equal((await suggest(store, { kind: "press", brand: { name: "Pret" }, dedupeKey: "propel:2" }, { now: NOW })).outcome, "duplicate");
    const unknown = await suggest(store, { kind: "press", brand: { name: "Farmer J" }, headline: "Farmer J expands" }, { now: NOW });
    assert.equal(unknown.evidence.company_id, null);
    assert.equal((await suggest(store, { kind: "press", brand: { name: "FARMER J LTD" }, headline: "Again" }, { now: NOW })).outcome, "joined");
    const wing = await suggest(store, { kind: "gossip", brand: { contactIds: ["ct-2"] }, headline: "Agent says a client is looking" }, { now: NOW });
    assert.deepEqual(wing.evidence.candidate_company_ids?.slice().sort(), ["c-gails", "c-pret"]);

    const listed = await listSuggestions(store, {}, NOW);
    assert.deepEqual([listed.counts.open, listed.counts.unmatched, listed.counts.byKind.press, listed.counts.byKind.gossip], [3, 2, 2, 1]);
    assert.equal(listed.suggestions.find(s => s.brand.companyId === "c-pret")!.lineCount, 2);
    assert.deepEqual(listed.suggestions.find(s => s.kind === "gossip")!.brand.candidates.map(c => c.name).sort(), ["Gail's Bakery", "Pret A Manger"]);
    assert.equal((await listSuggestions(store, { q: "farmer" }, NOW)).suggestions.length, 1);
    assert.equal((await listSuggestions(store, { q: "pret a" }, NOW)).suggestions.length, 2, "the Pret suggestion, and the tie that names Pret as a candidate");
    assert.equal((await listSuggestions(store, { q: "100%" }, NOW)).suggestions.length, 0);
    assert.equal((await listSuggestions(store, { unmatched: true, kind: "press" }, NOW)).suggestions.length, 1);

    // Confirm inside a transaction, as the routes do.
    const client = await pool.connect();
    let made: any;
    try {
      await client.query("BEGIN");
      made = await confirm(pgIntakeStore(client), { suggestionId: first.evidence.id, fields: { size: ["1,000-2,000 sq ft"], use: ["Restaurant"] } }, EMILY, NOW);
      await client.query("COMMIT");
    } finally { client.release(); }
    assert.equal(made.outcome, "created");
    const row = (await pool.query(`SELECT * FROM crm_requirements_leasing WHERE id = $1`, [made.requirement.id])).rows[0];
    assert.deepEqual([row.name, row.company_id, row.status, row.origin, row.confirmed_how, row.last_confirmed_by, row.last_confirmed_by_name, row.requirement_date],
      ["Pret A Manger", "c-pret", "Active", "bgp", "press", "u-emily", "Emily Stone", "2026-11-12"]);
    // Made from a press story: labelled News (never PIPnet, the label client logins are shown).
    assert.deepEqual([row.size, row.use, row.requirement_locations, row.bgp_contact_user_ids, row.sources], [["1,000-2,000 sq ft"], ["Restaurant"], ["Leeds"], ["u-emily"], ["News"]]);
    assert.equal(new Date(row.last_confirmed_at).getTime(), NOW.getTime());
    const lines = (await pool.query(`SELECT status, requirement_id, resolved_by_name FROM requirement_evidence WHERE id = ANY($1::text[])`, [made.evidenceIds])).rows;
    assert.equal(lines.length, 2);
    assert.ok(lines.every(l => l.status === "confirmed" && l.requirement_id === row.id && l.resolved_by_name === "Emily Stone"));

    // The brand now has a requirement: a new suggestion proposes it, and confirm refuses to guess.
    const third = await suggest(store, { kind: "team_chat", brand: { companyIds: ["c-pret"] }, headline: "Pret want Bath" }, { now: days(1) });
    assert.equal((await listSuggestions(store, { kind: "team_chat" }, days(1))).suggestions[0].proposed, "confirm_existing");
    await assert.rejects(confirm(store, { suggestionId: third.evidence.id }, EMILY, days(1)), (e: any) => e instanceof IntakeError && e.code === "EXISTING_REQUIREMENT");
    assert.equal((await attach(store, { suggestionId: third.evidence.id, requirementId: row.id }, EMILY, days(1))).outcome, "attached");

    // The reviewer picks a brand for the tie; dismiss; the quiet period.
    assert.deepEqual(await setSuggestionBrand(store, { suggestionId: wing.evidence.id, companyId: "c-gails" }, EMILY, NOW).then(o => [o.companyId, o.joined]), ["c-gails", false]);
    assert.deepEqual((await pool.query(`SELECT company_id, candidate_company_ids, details->>'_matchedBy' AS by FROM requirement_evidence WHERE id = $1`, [wing.evidence.id])).rows[0],
      { company_id: "c-gails", candidate_company_ids: null, by: "reviewer" });
    const gails = await suggest(store, { kind: "press", brand: { name: "Gail's Bakery" }, headline: "Gail's to open 10" }, { now: NOW });
    await dismiss(store, { suggestionId: gails.evidence.id, reason: "not_a_requirement" }, EMILY, NOW);
    assert.equal((await suggest(store, { kind: "press", brand: { name: "Gail's Bakery" }, headline: "Gail's again", dedupeKey: "g:2" }, { now: days(10) })).outcome, "quiet");
    assert.equal((await suggest(store, { kind: "press", brand: { name: "Gail's Bakery" }, headline: "Gail's day 31", dedupeKey: "g:3" }, { now: days(31) })).outcome, "opened");
    assert.equal((await listSuggestions(store, { status: "dismissed" }, NOW)).suggestions.length, 1, "the quiet line is not listed as a dismissed suggestion");

    // Still live, owner, and the evidence page with a live viewing.
    await pool.query(`INSERT INTO unit_viewings (id, unit_id, requirement_id, viewing_date, status, company_name, details_confirmed_at) VALUES
      ('v1','au1',$1,'2026-11-01','completed','Pret', now()), ('v2','au1',$1,'2026-11-02','cancelled','Pret', now()), ('v3','au1',$1,'2026-11-03','scheduled','Pret', NULL)`, [row.id]);
    const again = await stillLive(store, row.id, { id: "u-tom", name: "Tom Reed" }, "call", days(5));
    assert.deepEqual([again.confirmed_how, again.last_confirmed_by], ["call", "u-tom"]);
    await assert.rejects(setOwner(store, row.id, ["u-client"], EMILY, NOW), (e: any) => e.code === "NOT_STAFF");
    await assert.rejects(setOwner(store, row.id, ["u-left"], EMILY, NOW), (e: any) => e.code === "NOT_STAFF");
    assert.deepEqual((await setOwner(store, row.id, ["u-tom", "u-emily"], EMILY, NOW)).bgp_contact_user_ids, ["u-tom", "u-emily"]);
    const page = await requirementEvidence(store, row.id, days(5));
    assert.deepEqual([page.howSure.key, page.requirement.live.state, page.requirement.ownerUserIds], ["conversation", "live", ["u-tom", "u-emily"]]);
    assert.deepEqual(page.evidence.filter(e => e.kind === "viewing").map(e => e.headline), ["Viewed: Unit 4, Trinity Leeds"]);
    assert.deepEqual(page.evidence.map(e => e.kind).sort(), ["note", "note", "press", "press", "team_chat", "viewing"]);

    // Viewings and offers by the brand are read live onto its requirement: a
    // viewing linked to no requirement, and a confirmed offer; never an
    // unconfirmed offer, a no-show or another brand's.
    await pool.query(`INSERT INTO unit_viewings (id, unit_id, requirement_id, company_id, viewing_date, status, company_name, details_confirmed_at) VALUES
      ('v4','au1',NULL,'c-pret','2026-11-04','completed','Pret', now()), ('v5','au1',NULL,'c-pret','2026-11-05','no_show','Pret', now()),
      ('v6','au1',NULL,'c-gails','2026-11-06','completed','Gail''s', now())`);
    await pool.query(`INSERT INTO unit_offers (id, unit_id, company_id, company_name, offer_date, status, confirmed_at) VALUES
      ('o1','au1','c-pret','Pret','2026-11-07','Pending', now()), ('o2','au1','c-pret','Pret','2026-11-08','Pending', NULL), ('o3','au1','c-gails','Gail''s','2026-11-08','Pending', now())`);
    const byBrand = await requirementEvidence(store, row.id, days(5));
    assert.deepEqual(byBrand.evidence.filter(e => e.kind === "viewing" || e.kind === "offer").map(e => e.id).sort(), ["offer:o1", "viewing:v1", "viewing:v4"]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM requirement_evidence WHERE kind IN ('viewing','offer')`)).rows[0].n, 0, "read live: nothing copied");

    // The feeds use the app's pool: point it at this disposable cluster.
    process.env.DATABASE_URL = `postgresql:///postgres?host=${encodeURIComponent(socket)}&user=qa_req`;
    const feeds = await import("./requirement-feeds");
    const appDb = await import("./db");
    try {
      // Rule 1: Gail's has no requirement. One completed viewing is not enough; the second raises both.
      assert.deepEqual(await feeds.viewingRecorded("c-gails", NOW), { ran: true, suggestions: 0 });
      await pool.query(`INSERT INTO unit_viewings (id, unit_id, company_id, viewing_date, status, company_name, details_confirmed_at) VALUES
        ('v7','au1','c-gails','2026-10-20','completed','Gail''s', now()), ('v8','au1','c-gails','2026-07-01','completed','Gail''s', now())`);
      assert.deepEqual(await feeds.viewingRecorded("c-gails", NOW), { ran: true, suggestions: 2 });
      assert.deepEqual(await feeds.viewingRecorded("c-gails", NOW), { ran: true, suggestions: 0 }, "the same viewings are never raised twice");
      const raised = (await listSuggestions(store, { kind: "viewing" }, NOW)).suggestions;
      assert.deepEqual([raised.length, raised[0].brand.companyId, raised[0].lineCount, raised[0].proposed, raised[0].createdBy.name], [1, "c-gails", 2, "new", "Viewing rule"]);
      assert.deepEqual(raised[0].lines.map(l => l.sourceRef).sort(), ["v6", "v7"]);
      // Pret has a requirement: its viewings never raise a suggestion.
      assert.deepEqual(await feeds.viewingRecorded("c-pret", NOW), { ran: true, suggestions: 0 });
      // A person confirms: the requirement is theirs, and the viewings now point at it.
      const fromViewings = await confirm(store, { suggestionId: raised[0].id, how: "viewing" }, EMILY, NOW);
      assert.deepEqual([fromViewings.outcome, fromViewings.requirement!.confirmed_how, fromViewings.requirement!.last_confirmed_by_name], ["created", "viewing", "Emily Stone"]);
      assert.deepEqual((await pool.query(`SELECT id, requirement_id FROM unit_viewings WHERE company_id = 'c-gails' ORDER BY id`)).rows,
        [{ id: "v6", requirement_id: fromViewings.requirement!.id }, { id: "v7", requirement_id: fromViewings.requirement!.id }, { id: "v8", requirement_id: null }]);

      // Rule 2: a letting for Pret reaches solicitors and asks about its one open requirement.
      await pool.query(`INSERT INTO property_units VALUES ('pu1','p1','Unit 4')`);
      await pool.query(`INSERT INTO crm_deals (id, deal_ref, name, deal_type, status, tenant_id, property_id, unit_id) VALUES
        ('d1', 412, 'Unit 4 letting', 'New Letting', 'SOL', 'c-pret', 'p1', 'pu1'), ('d2', 413, 'Assignment', 'Lease Disposal', 'SOL', 'c-pret', 'p1', 'pu1'),
        ('d3', 414, 'No tenant yet', 'New Letting', 'SOL', NULL, 'p1', 'pu1')`);
      assert.equal((await feeds.dealStatusChanged("d1", "NEG", "HOT", NOW)).ran, false);
      assert.equal((await feeds.dealStatusChanged("d2", "HOT", "SOL", NOW)).ran, false);
      assert.equal((await feeds.dealStatusChanged("d3", "HOT", "SOL", NOW)).ran, false);
      assert.deepEqual(await feeds.dealStatusChanged("d1", "HOT", "SOL", NOW), { ran: true, suggestions: 1 });
      assert.deepEqual(await feeds.dealStatusChanged("d1", "HOT", "SOL", NOW), { ran: true, suggestions: 0 }, "once per deal");
      const question = (await listSuggestions(store, { kind: "deal" }, NOW)).suggestions[0];
      assert.deepEqual([question.proposed, question.details?.requirementId, question.url, question.headline],
        ["mark_satisfied", row.id, "/deals/d1", "Deal #412 for Pret A Manger at Unit 4, Trinity Leeds reached solicitors. Mark the requirement as satisfied?"]);
      assert.equal((await pool.query(`SELECT status FROM crm_requirements_leasing WHERE id = $1`, [row.id])).rows[0].status, "Active", "the machine only asks");
      await assert.rejects(confirm(store, { suggestionId: question.id, requirementId: row.id }, EMILY, NOW), (e: any) => e.code === "SATISFIED_QUESTION");
      const closed = await markSatisfied(store, { suggestionId: question.id }, EMILY, NOW);
      assert.equal(closed.requirement.status, "Past");
      assert.equal((await pool.query(`SELECT ${requirementStateSql("r", "$2")} AS state FROM crm_requirements_leasing r WHERE r.id = $1`, [row.id, NOW])).rows[0].state, "closed");

      // A meeting summary through the reader (faked here): a tenant brand is suggested, a landlord's name is not.
      const reader = (items: unknown) => ({ hasKey: () => true, claim: async () => true, log: () => {}, call: async () => ({ text: JSON.stringify(items), model: "test" }) });
      const summary = "- Gail's Bakery want four more sites in Yorkshire next year.\n- Shelley Sandzer want a bigger office.";
      const meeting = await feeds.transcriptNoteSaved({ noteId: 7, title: "Teams: catch up (12 Nov)", summary, companyId: "c-agent", meetingDate: NOW }, reader([
        { brand: "Gail's Bakery", quote: "Gail's Bakery want four more sites in Yorkshire next year", sites: 4, locations: ["Yorkshire"], timing: "next year", confidence: "high" },
        { brand: "Shelley Sandzer", quote: "Shelley Sandzer want a bigger office", confidence: "medium" },
      ]));
      assert.deepEqual(meeting, { ran: true, suggestions: 1 });
      const fromMeeting = (await listSuggestions(store, { kind: "meeting" }, NOW)).suggestions;
      assert.deepEqual([fromMeeting.length, fromMeeting[0].brand.companyId, fromMeeting[0].excerpt, fromMeeting[0].details?.sites, fromMeeting[0].proposed],
        [1, "c-gails", "Gail's Bakery want four more sites in Yorkshire next year", 4, "confirm_existing"]);
      assert.deepEqual(await feeds.transcriptNoteSaved({ noteId: 7, title: "Teams: catch up (12 Nov)", summary, companyId: "c-agent", meetingDate: NOW }, reader([
        { brand: "Gail's Bakery", quote: "Gail's Bakery want four more sites in Yorkshire next year", confidence: "high" }])), { ran: true, suggestions: 0 }, "a note is read once");

      // The daily allowance is kept in system_settings and stops at the cap.
      const capBefore = process.env.REQUIREMENT_READER_DAILY_CAP;
      process.env.REQUIREMENT_READER_DAILY_CAP = "2";
      try {
        assert.deepEqual([await feeds.claimDailyRead(), await feeds.claimDailyRead(), await feeds.claimDailyRead()], [true, true, false]);
        assert.equal((await pool.query(`SELECT value->>'calls' AS calls FROM system_settings WHERE key = 'requirement_reader_usage'`)).rows[0].calls, "2");
        // A new day starts a new count.
        await pool.query(`UPDATE system_settings SET value = jsonb_build_object('day', '2020-01-01', 'calls', 99) WHERE key = 'requirement_reader_usage'`);
        assert.equal(await feeds.claimDailyRead(), true);
      } finally {
        if (capBefore === undefined) delete process.env.REQUIREMENT_READER_DAILY_CAP; else process.env.REQUIREMENT_READER_DAILY_CAP = capBefore;
      }
    } finally {
      await appDb.pool.end().catch(() => {});
    }

    // The evidence drawer and the Expanding list's Dismiss, on a brand nothing above has touched.
    await pool.query(`CREATE TABLE external_requirements (id varchar PRIMARY KEY, source text NOT NULL, source_url text, company_name text NOT NULL);
      INSERT INTO external_requirements VALUES ('x1','PIPnet','https://www.pipnet.co.uk/requirement/1','Dishoom'), ('x2','TRL','not a link','Dishoom');
      INSERT INTO crm_companies (id, name, company_type) VALUES ('c-dish','Dishoom','Tenant - Restaurant')`);
    const dish = (await pool.query(`INSERT INTO crm_requirements_leasing (name, company_id, status, origin, sources, external_requirement_id, last_listed_at, last_listed_source)
      VALUES ('Dishoom','c-dish','Active','pipnet','{PIPnet}','x1',$1,'PIPnet') RETURNING id`, [days(-20)])).rows[0].id;
    const dishPage = await requirementEvidence(store, dish, NOW);
    assert.deepEqual(dishPage.evidence.map(e => [e.id, e.kind, e.sourceLabel, e.headline, e.url]), [[`listing:${dish}`, "listing", "PIPnet", "Listed on PIPnet", "https://www.pipnet.co.uk/requirement/1"]]);
    assert.equal(dishPage.howSure.label, "Market listing only");
    assert.equal(await store.listingUrl!("x2"), null, "only a real link is passed on");
    assert.equal(await store.listingUrl!("x-missing"), null);
    // "Add evidence": a person's dated line. It confirms nothing by itself.
    const noted = await attach(store, { requirementId: dish, evidence: { kind: "call", brand: {}, sourceLabel: "Call", headline: "Their agent says they are still looking in Leeds", evidenceDate: NOW } }, EMILY, NOW);
    assert.equal(noted.outcome, "attached");
    const afterNote = await requirementEvidence(store, dish, NOW);
    assert.deepEqual(afterNote.evidence.map(e => [e.kind, e.createdBy.kind, e.createdBy.name, e.status]), [["call", "person", "Emily Stone", "attached"], ["listing", "machine", "PIPnet import", "attached"]]);
    assert.deepEqual([afterNote.requirement.live.state, afterNote.howSure.label], ["background", "Market listing only"]);
    // "Dismiss" on the Expanding list: a person's dismissal, which takes the brand off the list for 30 days.
    await pool.query(`CREATE TABLE brand_signals (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), brand_company_id varchar NOT NULL, signal_type text NOT NULL, headline text NOT NULL,
        detail text, source text, signal_date timestamp, magnitude text, sentiment text, ai_generated boolean DEFAULT false, geography text, confidence text,
        dedupe_key text, ai_relevant boolean, created_at timestamp DEFAULT now());
      CREATE TABLE news_articles (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), source_name text, title text NOT NULL, url text NOT NULL)`);
    await pool.query(`INSERT INTO brand_signals (brand_company_id, signal_type, headline, source, signal_date, created_at) VALUES ('c-dish','opening','Dishoom to open 20 UK sites','https://www.propelinfo.com/d',$1,$1)`, [days(-2)]);
    const onList = async (at: Date) => (await expandingBrands(pool, { now: at })).brands.some(b => b.companyId === "c-dish");
    assert.equal(await onList(NOW), true, "listed: its only requirement is an unconfirmed market listing");
    const gone = await dismissFromNews(store, { companyId: "c-dish", headline: "Dishoom to open 20 UK sites", url: "https://www.propelinfo.com/d", source: "Propel", date: days(-2).toISOString() }, EMILY, NOW);
    assert.equal(gone.quietUntil!.getTime(), days(30).getTime());
    assert.deepEqual((await pool.query(`SELECT kind, status, resolved_reason, resolved_by_user_id, created_by_kind FROM requirement_evidence WHERE company_id = 'c-dish' AND kind = 'press'`)).rows,
      [{ kind: "press", status: "dismissed", resolved_reason: "not_a_requirement", resolved_by_user_id: "u-emily", created_by_kind: "person" }]);
    assert.equal(await onList(NOW), false, "off the list after the dismissal");
    assert.equal(await onList(days(31)), true, "back after the 30 days");
    assert.equal((await suggest(store, { kind: "press", brand: { companyIds: ["c-dish"] }, headline: "Dishoom again", dedupeKey: "dish:2" }, { now: days(3) })).outcome, "quiet");

    // The live rule: the SQL and the function agree on every shape of row.
    await pool.query(`INSERT INTO crm_requirements_leasing (name, status, origin, sources, requirement_date, last_confirmed_at, last_confirmed_by, last_confirmed_by_name, confirmed_how, last_listed_at, created_at, updated_at) VALUES
      ('live','Active','bgp',NULL,NULL,'2026-10-01','u1','A','created',NULL,'2025-01-01','2025-01-01'),
      ('edge 90','Active','bgp',NULL,NULL,'2026-08-14 10:00:00','u1','A','call',NULL,'2025-01-01','2025-01-01'),
      ('past 90','Active','bgp',NULL,NULL,'2026-08-14 09:59:59','u1','A','call',NULL,'2025-01-01','2025-01-01'),
      ('old confirm','Active','bgp',NULL,NULL,'2025-06-01','u1','A','call',NULL,'2025-01-01','2025-01-01'),
      ('no person',' active ','bgp',NULL,NULL,'2026-11-01',NULL,' ',NULL,NULL,'2026-11-01','2026-11-01'),
      ('name only','Active',NULL,NULL,NULL,'2026-11-01','','Emily','press',NULL,'2026-11-01','2026-11-01'),
      ('import','Active','pipnet','{PIPnet}','2026-11-01',NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01','2026-11-01'),
      ('import confirmed','Active','trl','{TRL}',NULL,'2026-11-01','u1','A','still_live',NULL,'2026-11-01','2026-11-01'),
      ('legacy import','Active',NULL,'{PIPnet,"The Requirement List"}',NULL,NULL,NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01'),
      ('legacy mixed','Active',NULL,'{PIPnet,Emily}',NULL,NULL,NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01'),
      ('legacy own old','Active',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2024-01-01','2024-01-01'),
      ('dated uk','Active','bgp',NULL,'01/10/2026',NULL,NULL,NULL,NULL,NULL,'2020-01-01','2020-01-01'),
      ('dated old iso',NULL,'bgp',NULL,'2024-02-30',NULL,NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01'),
      ('unreadable date','Active','bgp',NULL,'Q3 2026',NULL,NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01'),
      ('draft','Draft','bgp','{Viewing}',NULL,NULL,NULL,NULL,NULL,NULL,'2020-01-01','2020-01-01'),
      ('hold','On Hold','bgp',NULL,NULL,'2026-11-01','u1','A','call',NULL,'2026-11-01','2026-11-01'),
      ('past','Past','bgp',NULL,NULL,'2026-11-01','u1','A','call',NULL,'2026-11-01','2026-11-01'),
      ('archived','ARCHIVED','pipnet','{PIPnet}',NULL,NULL,NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01')`);
    const states = (await pool.query(`SELECT r.*, ${requirementStateSql("r", "$1")} AS sql_state FROM crm_requirements_leasing r ORDER BY r.name`, [NOW])).rows;
    assert.ok(states.length >= 19);
    for (const r of states) assert.equal(r.sql_state, requirementLive(r, NOW).state, `state of "${r.name}"`);
    const byName = Object.fromEntries(states.map(r => [r.name, r.sql_state]));
    assert.deepEqual([byName["live"], byName["edge 90"], byName["past 90"], byName["old confirm"], byName["no person"], byName["name only"], byName["import"], byName["import confirmed"],
      byName["legacy import"], byName["legacy mixed"], byName["legacy own old"], byName["dated uk"], byName["dated old iso"], byName["draft"], byName["hold"], byName["past"], byName["archived"]],
      ["live", "live", "to_confirm", "background", "to_confirm", "live", "background", "live", "background", "to_confirm", "background", "to_confirm", "background", "to_confirm", "background", "closed", "closed"]);
  } finally {
    await pool?.end().catch(() => {});
    if (started) { try { run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]); } catch {} }
    await rm(directory, { recursive: true, force: true });
  }
});

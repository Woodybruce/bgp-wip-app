// Explicitly opt-in: starts a new disposable Unix-socket-only PostgreSQL cluster
// and runs the "Expanding now, nothing on our books" list query, "Add
// requirement" from it, and the news feed's suggestions against it, with
// migration 0056 as shipped. Never reads the app's DATABASE_URL, app
// configuration or existing database credentials: for the feed (which uses the
// app's pool) it points DATABASE_URL at the disposable cluster itself.
//   RUN_DISPOSABLE_REQ_POSTGRES=1 node --import tsx --test server/requirement-news-postgres.test.ts
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
import { pgIntakeStore, confirm, markNotLive, listSuggestions, IntakeError, type Actor } from "./requirement-intake";
import { expandingBrands, addRequirementFromNews, newsStoriesRead, claimNewsSection, type NewsStory, type StoryRead } from "./requirement-news";

const NOW = new Date("2026-11-12T10:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86400000);
const EMILY: Actor = { id: "u-emily", name: "Emily Stone" };

test("the Expanding list, Add requirement and the news feed run on real PostgreSQL", { skip: process.env.RUN_DISPOSABLE_REQ_POSTGRES !== "1" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bgp-req-news-test-"));
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
    // Only the columns these queries read; crm_requirements_leasing as it stood before 0056.
    await pool.query(`
      CREATE TABLE users (id varchar PRIMARY KEY, name text, email text, role text, is_active boolean DEFAULT true);
      CREATE TABLE crm_companies (id varchar PRIMARY KEY, name text NOT NULL, company_type text, merged_into_id varchar, archived_at timestamp,
        uk_entity_name text, trading_entities jsonb, ai_generated_fields jsonb);
      CREATE TABLE brand_signals (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), brand_company_id varchar NOT NULL, signal_type text NOT NULL, headline text NOT NULL,
        detail text, source text, signal_date timestamp, magnitude text, sentiment text, ai_generated boolean DEFAULT false, geography text, confidence text,
        dedupe_key text, ai_relevant boolean, created_at timestamp DEFAULT now());
      CREATE TABLE news_articles (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), source_name text, title text NOT NULL, url text NOT NULL);
      CREATE TABLE system_settings (key text PRIMARY KEY, value jsonb, updated_at timestamp DEFAULT now());
      CREATE TABLE crm_requirements_leasing (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, monday_item_id text, group_name text, status text,
        company_id varchar, use text[], requirement_type text[], size text[], requirement_locations text[], location_data text, principal_contact_id varchar,
        agent_contact_id varchar, bgp_contact_user_id varchar, bgp_contact_user_ids text[], deal_id varchar, landlord_pack text, extract text, comments text,
        requirement_date text, contacted boolean DEFAULT false, details_sent boolean DEFAULT false, viewing boolean DEFAULT false, shortlisted boolean DEFAULT false,
        under_offer boolean DEFAULT false, sources text[], created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
      INSERT INTO users VALUES ('u-emily','Emily Stone','emily@brucegillinghampollard.com','Staff',true);
      INSERT INTO crm_companies (id, name, company_type, merged_into_id, archived_at) VALUES
        ('c-pret','Pret A Manger','Tenant - Café',NULL,NULL), ('c-gails','Gail''s Bakery','Tenant - Bakery',NULL,NULL), ('c-leon','Leon','Tenant - Quick Service',NULL,NULL),
        ('c-wing','Wingstop','Tenant - Quick Service',NULL,NULL), ('c-dish','Dishoom','Tenant - Restaurant',NULL,NULL), ('c-itsu','Itsu','Tenant - Restaurant',NULL,NULL),
        ('c-none','Nothing Counts','Tenant - Retail',NULL,NULL), ('c-hidden','Hidden Brand','Tenant - Retail',NULL,now()), ('c-survivor','Survivor','Tenant - Retail',NULL,NULL),
        ('c-merged','Merged Away','Tenant - Retail','c-survivor',NULL), ('c-landlord','Landsec','Landlord',NULL,NULL), ('c-sugg','Waiting Brand','Tenant - Retail',NULL,NULL),
        ('c-dism','Dismissed Brand','Tenant - Retail',NULL,NULL), ('c-dism2','Wrong Brand Dismissal','Tenant - Retail',NULL,NULL), ('c-future','Future Opening','Brand',NULL,NULL);`);
    const migration = await readFile(path.join(process.cwd(), "migrations", "0056_requirements_centre.sql"), "utf8");
    await pool.query(migration);

    const signal = (brand: string, type: string, headline: string, at: Date, extra: Record<string, any> = {}) => pool!.query(
      `INSERT INTO brand_signals (brand_company_id, signal_type, headline, detail, source, signal_date, magnitude, sentiment, geography, confidence, ai_relevant, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [brand, type, headline, extra.detail ?? null, extra.source ?? null, extra.noDate ? null : at, extra.magnitude ?? "medium", extra.sentiment ?? "positive",
        extra.geography ?? null, extra.confidence ?? null, extra.relevant ?? null, extra.created ?? at]);
    await pool.query(`INSERT INTO news_articles (source_name, title, url) VALUES ('The Caterer', 'Pret to open 20', 'https://www.thecaterer.com/news/pret-20')`);
    // Pret: a new-site story with a link, and an older funding story. Nothing on the books.
    await signal("c-pret", "opening", "Pret to open 20 UK shops", days(-10), { source: "https://www.thecaterer.com/news/pret-20", detail: "Stated: 20 UK sites." });
    await signal("c-pret", "funding", "Pret raises £100m", days(-90), { source: "https://example.com/pret-raise", magnitude: "large" });
    // Gail's: a stated requirement from a Propel newsletter, two days ago, with no date of its own (created date is used).
    await signal("c-gails", "requirement", "Gail's seeking 2,000 sq ft units in Yorkshire", days(-2), { source: "newsletter:2026-11-10:Propel Morning Briefing", detail: "Via newsletter: Propel Morning Briefing (news@propelinfo.com)", noDate: true, geography: "uk", confidence: "reported" });
    // Leon has a LIVE requirement; Wingstop one BGP made and nobody has confirmed (to confirm). Neither is listed.
    await signal("c-leon", "opening", "Leon to open 10 sites", days(-5));
    await signal("c-wing", "funding", "Wingstop UK secures funding", days(-20));
    // Dishoom has only a PIPnet market listing; Itsu a closed one and one confirmed long ago. Both listed.
    await signal("c-dish", "opening", "Dishoom to open in Leeds", days(-6));
    await signal("c-itsu", "hiring", "Itsu recruiting for five new shops", days(-7));
    // Signals that do not count, all on one brand: too old, one small branch, negative, abroad, a rumour, judged not about the brand, BGP's own deal, the wrong type.
    await signal("c-none", "opening", "Thirteen months ago", days(-400));
    await signal("c-none", "opening", "One small branch", days(-3), { magnitude: "small" });
    await signal("c-none", "opening", "Opening delayed", days(-3), { sentiment: "negative" });
    await signal("c-none", "opening", "Opens in Dubai", days(-3), { geography: "row" });
    await signal("c-none", "funding", "Said to be in talks", days(-3), { confidence: "rumour" });
    await signal("c-none", "opening", "A different company", days(-3), { relevant: false });
    await signal("c-none", "opening", "BGP let a unit", days(-3), { source: "bgp-deal:d1" });
    await signal("c-none", "news", "General mention", days(-3));
    await signal("c-none", "closure", "Closes two", days(-3));
    // Brands that are never listed whatever the news: hidden, merged away, not a tenant brand.
    await signal("c-hidden", "opening", "Hidden opens", days(-1));
    await signal("c-merged", "opening", "Merged opens", days(-1));
    await signal("c-landlord", "funding", "Landsec raises", days(-1));
    // Already waiting in To confirm; press dismissed by a person 10 days ago; dismissed only as "wrong brand" (listed).
    await signal("c-sugg", "opening", "Waiting opens 12", days(-3));
    await signal("c-dism", "opening", "Dismissed opens 12", days(-4));
    await signal("c-dism2", "opening", "Wrong brand opens 12", days(-4));
    // A planned opening dated next year, read today: sorts as today, not at the top for months.
    await signal("c-future", "opening", "Opening in Bath next spring", days(150), { created: days(-1) });

    await pool.query(`INSERT INTO crm_requirements_leasing (id, name, company_id, status, origin, sources, last_confirmed_at, last_confirmed_by, last_confirmed_by_name, confirmed_how, last_listed_at, created_at, updated_at) VALUES
      ('r-leon','Leon','c-leon','Active','bgp',NULL,$1,'u-emily','Emily Stone','call',NULL,$1,$1),
      ('r-wing','Wingstop','c-wing','Active','bgp',NULL,NULL,NULL,NULL,NULL,NULL,$2,$2),
      ('r-dish','Dishoom','c-dish','Active','pipnet','{PIPnet}',NULL,NULL,NULL,NULL,$2,$2,$2),
      ('r-itsu-past','Itsu','c-itsu','Past','bgp',NULL,$1,'u-emily','Emily Stone','call',NULL,$1,$1),
      ('r-itsu-old','Itsu old','c-itsu','Active','bgp',NULL,$3,'u-emily','Emily Stone','call',NULL,$3,$3)`, [days(-10), days(-30), days(-400)]);
    await pool.query(`INSERT INTO requirement_evidence (company_id, brand_name, kind, headline, status, resolved_by_user_id, resolved_by_name, resolved_at, resolved_reason) VALUES
      ('c-sugg','Waiting Brand','press','Waiting opens 12','open',NULL,NULL,NULL,NULL),
      ('c-dism','Dismissed Brand','press','Dismissed opens 12','dismissed','u-emily','Emily Stone',$1,'not_a_requirement'),
      ('c-dism2','Wrong Brand Dismissal','press','Wrong brand','dismissed','u-emily','Emily Stone',$1,'wrong_brand')`, [days(-10)]);

    // ── The list ────────────────────────────────────────────────────────────
    const list = await expandingBrands(pool, { now: NOW });
    assert.deepEqual(list.brands.map(b => b.companyId), ["c-future", "c-gails", "c-dism2", "c-dish", "c-itsu", "c-pret"], "newest story first; brands with a live or to-confirm requirement, a waiting suggestion or a dismissed story are left out");
    assert.deepEqual([list.total, list.windowMonths, list.signalTypes], [6, 12, ["opening", "funding", "requirement", "hiring"]]);
    const pret = list.brands.find(b => b.companyId === "c-pret")!;
    assert.deepEqual([pret.name, pret.companyType, pret.signalCount, pret.backgroundRequirements], ["Pret A Manger", "Tenant - Café", 2, 0]);
    assert.deepEqual([pret.latest.headline, pret.latest.type, pret.latest.source, pret.latest.link, pret.latest.detail, pret.latest.date?.getTime()],
      ["Pret to open 20 UK shops", "opening", "The Caterer", "https://www.thecaterer.com/news/pret-20", "Stated: 20 UK sites.", days(-10).getTime()]);
    assert.deepEqual(pret.signals.map(s => [s.type, s.source, s.link]), [["opening", "The Caterer", "https://www.thecaterer.com/news/pret-20"], ["funding", "example.com", "https://example.com/pret-raise"]]);
    const gails = list.brands.find(b => b.companyId === "c-gails")!;
    assert.deepEqual([gails.latest.type, gails.latest.source, gails.latest.link, gails.latest.date?.getTime(), gails.latest.confidence], ["requirement", "Propel", null, days(-2).getTime(), "reported"],
      "a newsletter item names its publisher and has no link");
    assert.deepEqual([list.brands.find(b => b.companyId === "c-dish")!.backgroundRequirements, list.brands.find(b => b.companyId === "c-itsu")!.backgroundRequirements], [1, 1]);
    assert.equal(list.brands[0].latest.date?.getTime(), days(150).getTime(), "the planned date is shown as it is, though it sorts as today");
    // Search, paging and the count.
    assert.deepEqual((await expandingBrands(pool, { now: NOW, q: "pret a" })).brands.map(b => b.companyId), ["c-pret"]);
    assert.equal((await expandingBrands(pool, { now: NOW, q: "100%" })).brands.length, 0);
    const page = await expandingBrands(pool, { now: NOW, limit: 2, offset: 2 });
    assert.deepEqual([page.brands.map(b => b.companyId), page.total], [["c-dism2", "c-dish"], 6]);
    // A year on, every story is outside the 12 months.
    assert.equal((await expandingBrands(pool, { now: days(400) })).brands.filter(b => b.companyId !== "c-future").length, 0);

    // ── Add requirement: press-reported, confirmed by the person who added it ──
    const store = pgIntakeStore(pool);
    const added = await addRequirementFromNews(store, { companyId: "c-pret", headline: pret.latest.headline, url: pret.latest.link, source: pret.latest.source, date: pret.latest.date }, EMILY, NOW);
    assert.equal(added.outcome, "created");
    const row = (await pool.query(`SELECT r.*, ${requirementStateSql("r", "$2")} AS state FROM crm_requirements_leasing r WHERE r.id = $1`, [added.requirement!.id, NOW])).rows[0];
    assert.deepEqual([row.name, row.company_id, row.status, row.origin, row.confirmed_how, row.last_confirmed_by_name, row.sources, row.bgp_contact_user_ids, row.state],
      ["Pret A Manger", "c-pret", "Active", "bgp", "press", "Emily Stone", ["News"], ["u-emily"], "live"]);
    assert.equal(row.comments, "Press-reported (The Caterer, 2026-11-02): Pret to open 20 UK shops. Nobody at BGP has recorded speaking to the brand.");
    const live = requirementLive(row, NOW);
    assert.deepEqual([live.pressReported, live.dateLabel], [true, "press-reported, logged 12 Nov by Emily"]);
    const line = (await pool.query(`SELECT kind, status, requirement_id, url, source_label, headline, created_by_kind, created_by_name, resolved_reason FROM requirement_evidence WHERE id = $1`, [added.evidenceIds[0]])).rows[0];
    assert.deepEqual(line, { kind: "press", status: "confirmed", requirement_id: row.id, url: "https://www.thecaterer.com/news/pret-20", source_label: "The Caterer",
      headline: "Pret to open 20 UK shops", created_by_kind: "person", created_by_name: "Emily Stone", resolved_reason: "direct" });
    assert.equal((await addRequirementFromNews(store, { companyId: "c-pret", headline: pret.latest.headline, url: pret.latest.link }, EMILY, NOW)).outcome, "duplicate");
    assert.ok(!(await expandingBrands(pool, { now: NOW })).brands.some(b => b.companyId === "c-pret"), "Pret is on the books now");
    // The expansion score's count of BGP's own requirements leaves the press-reported row out (the SQL in server/expansion-intel.ts gatherBgpEvidence).
    assert.equal((await pool.query(`SELECT count(*) FILTER (WHERE (NOT (COALESCE(sources, '{}') <@ ARRAY['PIPnet']::text[]) OR sources IS NULL) AND confirmed_how IS DISTINCT FROM 'press')::int AS bgp
      FROM crm_requirements_leasing WHERE company_id = 'c-pret' AND status = 'Active'`)).rows[0].bgp, 0);
    // Dishoom already has a market listing: the person says which, and that row becomes press-reported without changing whose record it is.
    await assert.rejects(addRequirementFromNews(store, { companyId: "c-dish", headline: "Dishoom to open in Leeds" }, EMILY, NOW), (e: any) => e instanceof IntakeError && e.code === "EXISTING_REQUIREMENT" && e.extra.existing[0].id === "r-dish");
    const onListing = await addRequirementFromNews(store, { companyId: "c-dish", headline: "Dishoom to open in Leeds", requirementId: "r-dish" }, EMILY, NOW);
    assert.deepEqual([onListing.outcome, onListing.requirement!.origin, onListing.requirement!.confirmed_how, onListing.requirement!.sources], ["confirmed_existing", "pipnet", "press", ["PIPnet"]]);
    await assert.rejects(addRequirementFromNews(store, { companyId: "c-nope", headline: "x" }, EMILY, NOW), (e: any) => e instanceof IntakeError && e.code === "BRAND_NOT_FOUND");

    // ── The news feed: suggestions only, through the app's pool ─────────────
    process.env.DATABASE_URL = `postgresql:///postgres?host=${encodeURIComponent(socket)}&user=qa_req`;
    const appDb = await import("./db");
    try {
      const read = (extra: Partial<StoryRead> = {}): StoryRead => ({ sites: null, uk: null, size: null, places: [], timing: null, ...extra });
      const strong = (extra: Partial<NewsStory> = {}): NewsStory => ({
        companyId: "c-gails", knownBrand: true, signalType: "opening", headline: "Gail's to open 10 UK bakeries", detail: "Stated: 10 UK sites; Leeds, York.", sentiment: "positive",
        read: read({ sites: 10, uk: true, places: ["Leeds", "York"], timing: "next year" }), storyDate: days(-1), sourceLabel: "Propel", sourceRef: "newsletter:2026-11-11:Propel",
        storyKey: "newsletter:2026-11-11:Propel:opening", ...extra,
      });
      const before = (await pool.query(`SELECT count(*)::int AS n FROM crm_requirements_leasing`)).rows[0].n;
      assert.deepEqual(await newsStoriesRead([strong()], NOW), { suggestions: 1, questions: 0 });
      assert.deepEqual(await newsStoriesRead([strong()], NOW), { suggestions: 0, questions: 0 }, "the same story is never raised twice");
      const raised = (await listSuggestions(store, { kind: "press", companyId: "c-gails" }, NOW)).suggestions;
      assert.deepEqual([raised.length, raised[0].proposed, raised[0].sourceLabel, raised[0].headline, raised[0].excerpt, raised[0].confidence, raised[0].createdBy.kind, raised[0].createdBy.name],
        [1, "new", "Propel", "Gail's to open 10 UK bakeries", "Stated: 10 UK sites; Leeds, York; next year.", "high", "machine", "News reader"]);
      assert.deepEqual(raised[0].details, { rule: "strong_story", why: "states 10 UK sites", signalType: "opening", sites: 10, uk: true, locations: ["Leeds", "York"], timing: "next year" });
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM crm_requirements_leasing`)).rows[0].n, before, "news never writes a requirement");
      assert.ok(!(await expandingBrands(pool, { now: NOW })).brands.some(b => b.companyId === "c-gails"), "Gail's is waiting in To confirm, so it leaves the Expanding list");
      // Never for a hidden brand, a landlord, a brand the reader has only just added, or an old story.
      assert.deepEqual(await newsStoriesRead([strong({ companyId: "c-hidden", storyKey: "k1" }), strong({ companyId: "c-landlord", storyKey: "k2" }),
        strong({ companyId: "c-itsu", knownBrand: false, storyKey: "k3" }), strong({ companyId: "c-itsu", storyDate: days(-60), storyKey: "k4" })], NOW), { suggestions: 0, questions: 0 });
      // A person confirms: the requirement is theirs and press-reported, with the stated places. The story did not do it.
      const confirmed = await confirm(store, { suggestionId: raised[0].id }, EMILY, NOW);
      assert.deepEqual([confirmed.outcome, confirmed.requirement!.confirmed_how, confirmed.requirement!.last_confirmed_by_name, confirmed.requirement!.requirement_locations], ["created", "press", "Emily Stone", ["Leeds", "York"]]);
      // The nightly pass reads old stories again: within 30 days of a person's answer it raises nothing; a new Propel story still does.
      assert.deepEqual(await newsStoriesRead([strong({ storyKey: "fact:opening-gails-2026-11", reread: true })], days(5)), { suggestions: 0, questions: 0 });
      assert.deepEqual(await newsStoriesRead([strong({ storyKey: "newsletter:2026-11-16:Propel:opening", storyDate: days(4) })], days(5)), { suggestions: 1, questions: 0 });
      assert.equal((await listSuggestions(store, { kind: "press", companyId: "c-gails" }, days(5))).suggestions[0].proposed, "confirm_existing");

      // A closure story about Leon, which has a live requirement confirmed before the story: "still live?".
      const closure = (extra: Partial<NewsStory> = {}): NewsStory => ({
        companyId: "c-leon", knownBrand: true, signalType: "closure", headline: "Leon launches CVA and will close 20 restaurants", detail: "Leon has proposed a CVA.", magnitude: "large",
        sentiment: "negative", read: null, storyDate: days(-1), sourceLabel: "Propel", url: "https://example.com/leon-cva?utm_source=x", storyKey: "https://example.com/leon-cva", ...extra,
      });
      assert.deepEqual(await newsStoriesRead([closure()], NOW), { suggestions: 0, questions: 1 });
      assert.deepEqual(await newsStoriesRead([closure()], NOW), { suggestions: 0, questions: 0 });
      const question = (await listSuggestions(store, { kind: "press", companyId: "c-leon" }, NOW)).suggestions;
      assert.deepEqual([question.length, question[0].proposed, question[0].headline, question[0].url, question[0].details?.requirementId, question[0].details?.proposal],
        [1, "still_live", "Still live? Leon: Leon launches CVA and will close 20 restaurants", "https://example.com/leon-cva", "r-leon", "still_live"]);
      const leon = (await pool.query(`SELECT status, last_confirmed_at, last_confirmed_by_name FROM crm_requirements_leasing WHERE id = 'r-leon'`)).rows[0];
      assert.deepEqual([leon.status, new Date(leon.last_confirmed_at).getTime(), leon.last_confirmed_by_name], ["Active", days(-10).getTime(), "Emily Stone"], "the story only asks");
      // A second closure story joins the open question. No question for one small branch, a brand with no live requirement, or a requirement confirmed after the story.
      assert.deepEqual(await newsStoriesRead([closure({ storyKey: "fact:closure-leon-cva" })], NOW), { suggestions: 0, questions: 1 });
      assert.deepEqual(await newsStoriesRead([closure({ headline: "Leon closes its Leeds branch", magnitude: "small", storyKey: "k5" }), closure({ companyId: "c-wing", storyKey: "k6" }),
        closure({ companyId: "c-pret", storyKey: "k7" })], NOW), { suggestions: 0, questions: 0 });
      // "No": a person archives it. Asked and answered: the same news does not ask again inside 30 days.
      const no = await markNotLive(store, { suggestionId: question[0].id }, EMILY, NOW);
      assert.deepEqual([no.requirement.id, no.requirement.status, no.evidenceIds.length], ["r-leon", "Archived", 2]);
      await pool.query(`UPDATE crm_requirements_leasing SET status = 'Active' WHERE id = 'r-leon'`);
      assert.deepEqual(await newsStoriesRead([closure({ storyKey: "k8" })], days(1)), { suggestions: 0, questions: 0 });

      // The allowance for extra newsletter sections has its own count in system_settings.
      const capBefore = process.env.REQUIREMENT_NEWS_READER_DAILY_CAP;
      process.env.REQUIREMENT_NEWS_READER_DAILY_CAP = "2";
      try {
        assert.deepEqual([await claimNewsSection(), await claimNewsSection(), await claimNewsSection()], [true, true, false]);
        assert.equal((await pool.query(`SELECT value->>'calls' AS calls FROM system_settings WHERE key = 'requirement_news_reader_usage'`)).rows[0].calls, "2");
        assert.equal((await pool.query(`SELECT count(*)::int AS n FROM system_settings WHERE key = 'requirement_reader_usage'`)).rows[0].n, 0, "the chat and meeting reader's allowance is untouched");
      } finally {
        if (capBefore === undefined) delete process.env.REQUIREMENT_NEWS_READER_DAILY_CAP; else process.env.REQUIREMENT_NEWS_READER_DAILY_CAP = capBefore;
      }
    } finally {
      await appDb.pool.end().catch(() => {});
    }
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (started) { try { run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]); } catch {} }
    await rm(directory, { recursive: true, force: true });
  }
});

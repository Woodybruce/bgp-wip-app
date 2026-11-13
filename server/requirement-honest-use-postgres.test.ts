// Explicitly opt-in: starts a new disposable Unix-socket-only PostgreSQL cluster
// and runs the "honest use" reads against it with migration 0056 as shipped:
// the expansion score's requirement counts, space that fits a requirement,
// news joined to requirements by brand, the reconfirm count, and the SQL
// shapes the Brand Explorer flag, the Brands hub and the target engine use.
// Never reads the app's DATABASE_URL, app configuration or existing database
// credentials: for the reads that use the app's pool it points DATABASE_URL at
// the disposable cluster itself.
//   RUN_DISPOSABLE_REQ_POSTGRES=1 node --import tsx --test server/requirement-honest-use-postgres.test.ts
// (initdb and pg_ctl must be on PATH and the caller must not be root.)
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { requirementLive, requirementReason, requirementStateSql, requirementClientVisibleSql, requirementImportOnlySql, requirementLiveColumnsSql, requirementIsImportOnly } from "@shared/requirement-live";
import { requirementNewsOverlaps, requirementsToReconfirm } from "./requirement-overlaps";

const days = (n: number) => new Date(Date.now() + n * 86400000);

test("the honest-use reads run on real PostgreSQL", { skip: process.env.RUN_DISPOSABLE_REQ_POSTGRES !== "1" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bgp-req-use-test-"));
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
    // Only the columns these reads use; crm_requirements_leasing as it stood before 0056.
    await pool.query(`
      CREATE TABLE crm_companies (id varchar PRIMARY KEY, name text NOT NULL, company_type text, domain text, merged_into_id varchar, archived_at timestamp);
      CREATE TABLE crm_contacts (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), company_id varchar, name text);
      CREATE TABLE brand_signals (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), brand_company_id varchar NOT NULL, signal_type text NOT NULL, headline text NOT NULL,
        detail text, source text, signal_date timestamp, sentiment text, ai_relevant boolean, created_at timestamp DEFAULT now());
      CREATE TABLE crm_properties (id varchar PRIMARY KEY, name text, address jsonb, postcode text);
      CREATE TABLE available_units (id varchar PRIMARY KEY, property_id varchar, unit_name text, sqft numeric, asking_rent numeric, marketing_status text, use_class text, leasing_schedule_unit_id varchar);
      CREATE TABLE leasing_schedule_units (id varchar PRIMARY KEY, property_id varchar, unit_name text, sqft numeric, status text);
      CREATE TABLE crm_deals (id varchar PRIMARY KEY, tenant_id varchar, bgp_acting_for text, status text);
      CREATE TABLE tenant_rep_searches (id varchar PRIMARY KEY, company_id varchar, status text);
      CREATE TABLE crm_requirements_leasing (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, monday_item_id text, group_name text, status text,
        company_id varchar, use text[], requirement_type text[], size text[], requirement_locations text[], location_data text, principal_contact_id varchar,
        agent_contact_id varchar, bgp_contact_user_id varchar, bgp_contact_user_ids text[], deal_id varchar, landlord_pack text, extract text, comments text,
        requirement_date text, contacted boolean DEFAULT false, details_sent boolean DEFAULT false, viewing boolean DEFAULT false, shortlisted boolean DEFAULT false,
        under_offer boolean DEFAULT false, sources text[], created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
      INSERT INTO crm_companies (id, name, company_type) VALUES
        ('c-live','Live Brand','Tenant - Restaurant'), ('c-stale','Stale Brand','Tenant - Restaurant'), ('c-own','Own Brand','Tenant - Restaurant'),
        ('c-pip','Pipnet Brand','Tenant - Restaurant'), ('c-trl','Trl Brand','Tenant - Restaurant'), ('c-both','Confirmed Listing','Tenant - Restaurant'),
        ('c-press','Press Brand','Tenant - Restaurant'), ('c-draft','Draft Brand','Tenant - Restaurant'), ('c-past','Past Brand','Tenant - Restaurant'),
        ('c-old','Old Monday Brand','Tenant - Restaurant'), ('c-none','No Requirement','Tenant - Restaurant');
      INSERT INTO crm_properties (id, name, address, postcode) VALUES ('p1','Trinity Leeds','"Albion Street, Leeds"','LS1 5AT');
      INSERT INTO available_units (id, property_id, unit_name, sqft, marketing_status, use_class) VALUES ('u1','p1','Unit 12',2000,'AVA','Restaurant');`);
    await pool.query(await readFile(path.join(process.cwd(), "migrations", "0056_requirements_centre.sql"), "utf8"));
    const SIZE = `'{"1500 - 3000 sq ft"}'`, USE = `'{Restaurant}'`, LOC = `'{Leeds}'`;
    await pool.query(`INSERT INTO crm_requirements_leasing (id, name, company_id, status, origin, sources, last_confirmed_at, last_confirmed_by, last_confirmed_by_name, confirmed_how, last_listed_at, last_listed_source, size, use, requirement_locations, created_at, updated_at) VALUES
      ('r-live','Live','c-live','Active','bgp',NULL,$1,'u1','Emily Stone','call',NULL,NULL,${SIZE},${USE},${LOC},$1,$1),
      ('r-stale','Stale','c-stale','Active','bgp',NULL,$2,'u1','Emily Stone','call',NULL,NULL,${SIZE},${USE},${LOC},$2,$2),
      ('r-own','Own','c-own','Active','bgp','{ChatBGP}',NULL,NULL,NULL,NULL,NULL,NULL,${SIZE},${USE},${LOC},$3,$3),
      ('r-pip','Pipnet','c-pip','Active','pipnet','{PIPnet}',NULL,NULL,NULL,NULL,$3,'PIPnet',${SIZE},${USE},${LOC},$3,$3),
      ('r-trl','Trl','c-trl','Active','trl','{TRL}',NULL,NULL,NULL,NULL,$3,'TRL',${SIZE},${USE},${LOC},$3,$3),
      ('r-both','Both','c-both','Active','pipnet','{PIPnet}',$1,'u1','Emily Stone','call',$3,'PIPnet',${SIZE},${USE},${LOC},$3,$1),
      ('r-press','Press','c-press','Active','bgp','{News}',$1,'u1','Emily Stone','press',NULL,NULL,${SIZE},${USE},${LOC},$1,$1),
      ('r-draft','Draft','c-draft','Draft','bgp',NULL,NULL,NULL,NULL,NULL,NULL,NULL,${SIZE},${USE},${LOC},$1,$1),
      ('r-past','Past','c-past','Past','bgp',NULL,$1,'u1','Emily Stone','call',NULL,NULL,${SIZE},${USE},${LOC},$1,$1),
      ('r-old','Old Monday TRL','c-old','Active',NULL,'{TRL}',NULL,NULL,NULL,NULL,NULL,NULL,${SIZE},${USE},${LOC},$4,$4),
      ('r-nolink','No brand','','Active','bgp',NULL,NULL,NULL,NULL,NULL,NULL,NULL,${SIZE},${USE},${LOC},$3,$3)`, [days(-9), days(-150), days(-30), days(-200)]);
    await pool.query(`UPDATE crm_requirements_leasing SET company_id = NULL WHERE id = 'r-nolink'`);

    // ── The SQL rule and the code rule agree on every row, and so does import-only ──
    const all = (await pool.query(`SELECT r.id, ${requirementLiveColumnsSql("r")}, ${requirementStateSql("r")} AS st, ${requirementImportOnlySql("r")} AS import_only FROM crm_requirements_leasing r ORDER BY r.id`)).rows;
    for (const r of all) {
      assert.equal(r.st, requirementLive(r).state, r.id);
      assert.equal(r.import_only, requirementIsImportOnly(r), r.id);
    }
    assert.deepEqual(Object.fromEntries(all.map((r: any) => [r.id, r.st])), {
      "r-both": "live", "r-draft": "to_confirm", "r-live": "live", "r-nolink": "to_confirm", "r-old": "background", "r-own": "to_confirm",
      "r-past": "closed", "r-pip": "background", "r-press": "live", "r-stale": "to_confirm", "r-trl": "background",
    });

    // ── What a client viewer's read loads (the target engine, tracker targets, brand gap): PIPnet listings only ──
    const clientRows = (await pool.query(`SELECT r.id, ${requirementLiveColumnsSql("r")} FROM crm_requirements_leasing r
      WHERE ${requirementStateSql("r")} <> 'closed' AND ${requirementClientVisibleSql("r")} ORDER BY r.id`)).rows;
    assert.deepEqual(clientRows.map((r: any) => r.id), ["r-both", "r-pip"]);
    for (const r of clientRows) assert.match(requirementReason(r).clientText || "", /^PIPnet listing from [A-Z][a-z]{2}( \d{4})?$/);

    // ── Brand Explorer's "Live requirement" flag: live or to confirm, never an unconfirmed import ──
    const flags = (await pool.query(`SELECT c.id, EXISTS (SELECT 1 FROM crm_requirements_leasing rl
        WHERE rl.company_id = c.id AND ${requirementStateSql("rl")} IN ('live', 'to_confirm')) AS "liveRequirement" FROM crm_companies c ORDER BY c.id`)).rows;
    assert.deepEqual(flags.filter((f: any) => f.liveRequirement).map((f: any) => f.id), ["c-both", "c-draft", "c-live", "c-own", "c-press", "c-stale"]);

    // ── The Brands hub list and tile, in the shape server/crm.ts builds them (GROUP BY with the rule in ORDER BY) ──
    const hub = (clientScoped: boolean) => {
      const filter = (alias: string) => clientScoped
        ? `${requirementClientVisibleSql(alias)} AND ${requirementStateSql(alias)} <> 'closed'`
        : `${requirementStateSql(alias)} IN ('live', 'to_confirm')`;
      return pool!.query(`
        SELECT rl.id, rl.company_id, c.name AS company_name, c.company_type, c.domain,
               rl.size, rl.use, rl.requirement_locations, rl.comments, rl.created_at, COUNT(ct.id) AS contact_count,
               (SELECT COUNT(*) FROM crm_companies WHERE id IN (SELECT DISTINCT rq.company_id FROM crm_requirements_leasing rq WHERE ${filter("rq")} AND rq.company_id IS NOT NULL)) AS brands
        FROM crm_requirements_leasing rl
        JOIN crm_companies c ON c.id = rl.company_id
        LEFT JOIN crm_contacts ct ON ct.company_id = c.id
        WHERE ${filter("rl")} AND c.company_type ILIKE 'Tenant -%'
        GROUP BY rl.id, rl.company_id, c.name, c.company_type, c.domain, rl.size, rl.use, rl.requirement_locations, rl.comments, rl.created_at
        ORDER BY ${clientScoped ? "" : `(${requirementStateSql("rl")} = 'live') DESC, `}rl.created_at DESC
        LIMIT 30`);
    };
    const staffHub = (await hub(false)).rows;
    assert.deepEqual(staffHub.map((r: any) => r.id).slice(0, 3).sort(), ["r-both", "r-live", "r-press"], "live first");
    assert.deepEqual(staffHub.map((r: any) => r.id).sort(), ["r-both", "r-draft", "r-live", "r-own", "r-press", "r-stale"]);
    assert.equal(Number(staffHub[0].brands), 6);
    assert.deepEqual((await hub(true)).rows.map((r: any) => r.id).sort(), ["r-both", "r-pip"]);

    // ── News joined to requirements by brand, and the reconfirm count ──
    await pool.query(`INSERT INTO brand_signals (brand_company_id, signal_type, headline, source, signal_date, ai_relevant) VALUES
      ('c-live','opening','Live Brand to open 10 sites','https://www.thecaterer.com/a',$1,NULL),
      ('c-pip','funding','Pipnet Brand raises','newsletter:2026-11-10:Propel Morning Briefing',$1,true),
      ('c-past','opening','Past Brand opens',NULL,$1,NULL),
      ('c-none','opening','No Requirement opens',NULL,$1,NULL),
      ('c-own','opening','Own Brand, not about them',NULL,$1,false),
      ('c-stale','opening','Stale Brand old story',NULL,$2,NULL),
      ('c-trl','opening','BGP let a unit','bgp-deal:d1',$1,NULL),
      ('c-draft','news','General mention',NULL,$1,NULL)`, [days(-2), days(-30)]);
    const joined = await requirementNewsOverlaps(pool, { days: 7 });
    assert.deepEqual(joined.overlaps.map(o => [o.brand, o.requirements[0].stateLabel, o.signals[0].source]), [["Live Brand", "Live", "thecaterer.com"], ["Pipnet Brand", "Background", "Propel"]]);
    assert.equal(joined.unlinkedRequirements, 1);
    assert.deepEqual((await requirementNewsOverlaps(pool, { days: 45 })).overlaps.map(o => o.brand).sort(), ["Live Brand", "Pipnet Brand", "Stale Brand"]);
    assert.deepEqual(await requirementsToReconfirm(pool), { toConfirm: 4, drafts: 1, lapsed: 1, goingStale: 0 });
    await pool.query(`UPDATE crm_requirements_leasing SET last_confirmed_at = $1 WHERE id = 'r-live'`, [days(-80)]);
    assert.equal((await requirementsToReconfirm(pool)).goingStale, 1);
    await pool.query(`UPDATE crm_requirements_leasing SET last_confirmed_at = $1 WHERE id = 'r-live'`, [days(-9)]);

    // ── Reads that use the app's pool ────────────────────────────────────────
    process.env.DATABASE_URL = `postgresql:///postgres?host=${encodeURIComponent(socket)}&user=qa_req`;
    const appDb = await import("./db");
    try {
      // The expansion score's counts: an unconfirmed import is a market listing, never BGP's own.
      const { gatherBgpEvidence } = await import("./expansion-intel");
      const counts = async (id: string) => { const e = await gatherBgpEvidence(id, { domainThreads: new Map() }); return [e.activeRequirements, e.pipnetRequirements]; };
      assert.deepEqual(await counts("c-live"), [1, 0]);
      assert.deepEqual(await counts("c-stale"), [1, 0]);
      assert.deepEqual(await counts("c-own"), [1, 0]);
      assert.deepEqual(await counts("c-pip"), [0, 1]);
      assert.deepEqual(await counts("c-trl"), [0, 1], "a Requirement List import used to score as BGP's own");
      assert.deepEqual(await counts("c-old"), [0, 1], "an old row labelled only TRL, made before origin existed");
      assert.deepEqual(await counts("c-both"), [1, 0], "a listing a BGP person confirmed is BGP's");
      assert.deepEqual(await counts("c-press"), [0, 0], "press-reported: the story already scores");
      assert.deepEqual(await counts("c-draft"), [0, 0]);
      assert.deepEqual(await counts("c-past"), [0, 0]);
      await pool.query(`UPDATE crm_requirements_leasing SET last_listed_at = $1, updated_at = $1, created_at = $1 WHERE id = 'r-trl'`, [days(-400)]);
      assert.deepEqual(await counts("c-trl"), [0, 0], "a listing not seen for over 12 months");

      // Space that fits a requirement: every open requirement, confirmed first, each with its state and dated reason.
      const { spaceFitsFor } = await import("./account-teams");
      const fits = await spaceFitsFor(pool, ["p1"]);
      assert.equal(fits.space.length, 1);
      const unit = fits.space[0];
      assert.equal(unit.fitCount, 10, "every open row fits; the closed one is not read");
      assert.deepEqual(unit.fits.map((f: any) => f.state).slice(0, 3), ["live", "live", "live"]);
      assert.ok(unit.fits.every((f: any) => typeof f.reason === "string" && !/\blive\b/i.test(f.reason) && !("weight" in f)));
      assert.deepEqual([fits.liveRequirements, fits.openRequirements], [3, 10]);
    } finally {
      await appDb.pool.end().catch(() => {});
    }
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (started) { try { run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]); } catch {} }
    await rm(directory, { recursive: true, force: true });
  }
});

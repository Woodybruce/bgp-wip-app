// Loads the DEMO copy of the app (a local database, never the live one) with
// records read from the live app through its own read-only API, so the
// Landsec pitch video is filmed on real schemes, schedules and brands while
// everything made up for the film stays off the live app.
//
//   DEMO_DATABASE_URL=postgresql://.../bgpdemo LIVE_DIR=<folder of saved API replies> \
//     node script/pitch-video/seed-demo.cjs
//
// LIVE_DIR holds the JSON saved from GET requests (companies.json, props.json,
// deals.json, units.json, reqs.json, home.json, sched/<propertyId>.json,
// stores/<companyId>.json, jmprofile.json, gaps.json). The saved replies are
// client data: they are never committed.
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const url = process.env.DEMO_DATABASE_URL || "";
if (!/\/bgpdemo(\?|$)/.test(url)) { console.error("DEMO_DATABASE_URL must name the bgpdemo database"); process.exit(1); }
const LIVE = process.env.LIVE_DIR;
if (!LIVE || !fs.existsSync(LIVE)) { console.error("LIVE_DIR not found"); process.exit(1); }
const pool = new Pool({ connectionString: url });
const read = f => JSON.parse(fs.readFileSync(path.join(LIVE, f), "utf8"));
const list = (v, key) => Array.isArray(v) ? v : (v && v[key]) || [];
const snake = k => k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toLowerCase();

const columnsOf = new Map();
async function columns(table) {
  if (!columnsOf.has(table)) {
    const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table]);
    columnsOf.set(table, new Set(r.rows.map(x => x.column_name)));
  }
  return columnsOf.get(table);
}

// One row at a time, only the columns the row has a value for, so column
// defaults apply and an unknown key is reported, not guessed.
async function insertRows(table, rows, { camel = false, drop = [], set = {} } = {}) {
  const cols = await columns(table);
  const unknown = new Set();
  let ok = 0, failed = 0, firstError = null;
  for (const raw of rows) {
    const row = {};
    for (const [k, v] of Object.entries(raw)) {
      const c = camel ? snake(k) : k;
      if (drop.includes(c)) continue;
      if (!cols.has(c)) { unknown.add(c); continue; }
      if (v === null || v === undefined) continue;
      row[c] = v;
    }
    Object.assign(row, set);
    for (const [k, v] of Object.entries(row)) if (v === null) delete row[k];
    const names = Object.keys(row);
    if (!names.length) continue;
    try {
      await pool.query(
        `INSERT INTO ${table} (${names.map(n => `"${n}"`).join(", ")})
         SELECT ${names.map(n => `"${n}"`).join(", ")} FROM json_populate_record(null::${table}, $1::json)
         ON CONFLICT DO NOTHING`, [JSON.stringify(row)]);
      ok++;
    } catch (e) { failed++; if (!firstError) firstError = `${e.message} (${JSON.stringify(row).slice(0, 160)})`; }
  }
  console.log(`${table}: ${ok} in, ${failed} failed${unknown.size ? `, keys with no column: ${[...unknown].slice(0, 12).join(", ")}` : ""}${firstError ? `\n   first error: ${firstError}` : ""}`);
}

const FEE_FIELDS = ["fee", "fee_agreement", "fee_agreement_url", "fee_currency", "po_number", "xero_contact_id", "xero_contact_name", "xero_account_number", "xero_billing_address", "invoicing_email", "invoicing_notes", "comments", "aml_check_completed", "sharepoint_link"];

(async () => {
  const home = read("home.json");
  const schemeProps = [];
  for (const g of home.groups) for (const s of g.schemes) for (const r of s.records) schemeProps.push(r.id);
  const landsecId = home.companyId;
  const liveBluewater = "23b98b43-c5a4-4c16-9eaa-a674f7139749";
  const localBluewater = "cccccccc-0000-0000-0000-000000000001";
  console.log("Landsec", landsecId, "scheme records", schemeProps.length);

  // Which unit each plan outline was drawn for, by unit number, before the
  // old schedule goes.
  const drawn = (await pool.query(
    `SELECT pu.id, t.unit_number FROM property_plan_units pu JOIN tenancy_schedule_units t ON t.id = pu.tenancy_unit_id`)).rows;

  // The fixture records the local database was built with are not for film.
  const wipe = ["crm_deals", "available_units", "tenancy_schedule_units", "brand_stores", "crm_requirements_leasing",
    "crm_companies", "crm_contacts", "brand_signals", "brand_score_history", "brand_store_counts",
    "chat_messages", "chat_thread_members", "chat_threads", "user_tasks", "unit_briefs", "unit_brief_people",
    "unit_brief_comments", "unit_offers", "unit_offer_rounds", "unit_viewings", "leasing_viewings", "letting_suggestions",
    "deal_audit_log", "crm_engagement_actions", "brand_scheme_targets", "crm_company_properties", "crm_interactions"];
  for (const t of wipe) await pool.query(`DELETE FROM ${t}`).then(r => console.log("cleared", t, r.rowCount)).catch(e => console.log("skip", t, e.message.slice(0, 60)));

  // Plans keep their images and outlines; they move to the live Bluewater id.
  await pool.query(`UPDATE property_plans SET property_id = $1 WHERE property_id = $2`, [liveBluewater, localBluewater]);
  await pool.query(`DELETE FROM crm_properties WHERE landlord_id IS NOT NULL OR name ~* '(test|rival)' OR name LIKE 'centre:%'`);

  await insertRows("crm_companies", list(read("companies.json"), "companies").filter(c => !c.mergedIntoId), { camel: true, drop: ["bgp_contact_crm", "aml_notes", "aml_cdd_form", "aml_source_of_wealth_notes"] });
  const props = list(read("props.json"), "properties").filter(p => schemeProps.includes(p.id));
  await insertRows("crm_properties", props, { camel: true, drop: ["bgp_commentary", "notes", "sharepoint_folder_url", "folder_teams"] });
  await pool.query(`UPDATE crm_properties SET landlord_id = $1 WHERE id = ANY($2::text[]) AND landlord_id IS NULL`, [landsecId, schemeProps]);

  let sched = [];
  for (const id of schemeProps) {
    const f = path.join(LIVE, "sched", `${id}.json`);
    if (!fs.existsSync(f)) { console.log("no schedule saved for", id); continue; }
    const rows = list(JSON.parse(fs.readFileSync(f, "utf8")), "units");
    if (!Array.isArray(rows)) { console.log("schedule not a list for", id); continue; }
    sched = sched.concat(rows);
  }
  await insertRows("tenancy_schedule_units", sched, { drop: ["tenant_entity_id", "property_unit_id", "leasing_comments", "underwriting_comments", "target_tenants", "target_company_ids"] });

  const deals = list(read("deals.json"), "deals").filter(d => schemeProps.includes(d.propertyId));
  await insertRows("crm_deals", deals, { camel: true, drop: FEE_FIELDS });
  const units = list(read("units.json"), "units").filter(u => schemeProps.includes(u.propertyId));
  await insertRows("available_units", units, { camel: true, drop: ["fee"] });
  await insertRows("crm_requirements_leasing", list(read("reqs.json"), "requirements"), { camel: true });

  let stores = [];
  const dir = path.join(LIVE, "stores");
  for (const f of fs.readdirSync(dir)) {
    try { stores = stores.concat(list(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")), "stores")); } catch {}
  }
  await insertRows("brand_stores", stores, { drop: ["crm_property_id"] });

  // Jersey Mike's: the full record and its signals, as the live brand page holds them.
  const jm = read("jmprofile.json");
  if (jm.company?.id) {
    await pool.query(`DELETE FROM crm_companies WHERE id = $1`, [jm.company.id]);
    await insertRows("crm_companies", [jm.company], { drop: ["bgp_contact_crm", "aml_notes"] });
    await insertRows("brand_signals", (jm.signals || []).map(s => ({ ...s, brand_company_id: jm.company.id })));
  }

  // Expansion scores for the Brand gap board, as the live board showed them.
  const gaps = read("gaps.json");
  const scored = (gaps.targets || []).filter(t => Number.isFinite(t.score));
  for (const t of scored) {
    await pool.query(
      `INSERT INTO brand_score_history (brand_company_id, hunter_score, flags, checked_at, score_version, sub_scores)
       VALUES ($1, $2, '{}', now(), 5, $3::jsonb)`,
      [t.brand_company_id, t.score, JSON.stringify({ ukMomentum: Math.min(25, t.score), pipeline: Math.max(0, Math.min(25, t.score - 25)), capacity: Math.max(0, Math.min(25, t.score - 50)), intent: Math.max(0, t.score - 75), engagement: 0 })]);
  }
  console.log("scores", scored.length);

  // The Bluewater plan's outlines follow their units by unit number.
  let relinked = 0;
  for (const d of drawn) {
    const hit = await pool.query(`SELECT id FROM tenancy_schedule_units WHERE property_id = $1 AND unit_number = $2`, [liveBluewater, d.unit_number]);
    await pool.query(`UPDATE property_plan_units SET tenancy_unit_id = $2 WHERE id = $1`, [d.id, hit.rows.length === 1 ? hit.rows[0].id : null]);
    if (hit.rows.length === 1) relinked++;
  }
  console.log("plan outlines", drawn.length, "relinked", relinked);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });

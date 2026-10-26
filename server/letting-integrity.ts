// Letting integrity — Phase 0 of the lettings cleanup (Woody, 2026-10-26,
// docs/letting-cleanup-thoughts.md). Read-only: counts and the first ids of
// every way the Letting Tracker (available_units) and the letting deals
// (crm_deals) disagree today. Integrity is REPORTED here, never repaired at
// boot (CLAUDE.md "Lettings: units, deals and the Letting Tracker").
//
//   GET  /api/admin/letting-integrity  → lettingIntegrityReport
//   POST /api/admin/letting-snapshot   → takeLettingSnapshot
//
// Every section runs in its own try/catch so one missing table or column
// never hides the rest; a failed section carries { error } instead.
import type { Pool } from "pg";
import { gzipSync } from "zlib";
import { DEAL_STATUS_CODES, legacyToCode } from "@shared/deal-status";
import { saveFile } from "./file-storage";

// Letting deal types per CLAUDE.md (New Letting, Lease Disposal, Temp Lease,
// Licence, Sub-Letting) plus the two legacy labels still stored on old rows.
export const LETTING_DEAL_TYPES = ["New Letting", "Lease Disposal", "Temp Lease", "Licence", "Sub-Letting", "Letting", "Leasing"];
// Live on the tracker: Marketing (AVA), Negotiating (NEG), HOTs (HOT),
// Solicitors (SOL); OPP is the tracker's pre-marketing row.
const LIVE_TRACKER_CODES = ["OPP", "AVA", "NEG", "HOT", "SOL"];
const HISTORIC_CODES = ["EXC", "COM", "WIT", "INV"];
const TENANT_SIDE_TYPES = ["Lease Disposal", "Sub-Letting", "Lease Acquisition", "Tenant Acquisition"];
const LIST_CAP = 200;
const SNAPSHOT_ROW_CAP = 50_000;

// What deriving the side from the type would give (CLAUDE.md: Lease Disposal
// and Sub-Letting are tenant-side; New Letting / Temp Lease / Licence are
// landlord-side). Not wired into any create path yet — Woody sees the list
// (section g) before anything moves.
export function actingForFromType(dealType: string | null | undefined): "landlord" | "tenant" {
  return TENANT_SIDE_TYPES.includes(String(dealType || "").trim()) ? "tenant" : "landlord";
}

function isHistoricRaw(raw: string | null | undefined): boolean {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "arch" || s === "archived") return true;
  const code = legacyToCode(raw);
  return !!code && HISTORIC_CODES.includes(code);
}

function isLiveCode(raw: string | null | undefined): boolean {
  const code = legacyToCode(raw);
  return !!code && LIVE_TRACKER_CODES.includes(code);
}

function unitKey(propertyId: string | null, unitName: string | null): string {
  return `${propertyId || ""}::${String(unitName || "").trim().toLowerCase()}`;
}

type Section = { counts: any; list?: any };

async function section(fn: () => Promise<Section>): Promise<Section> {
  try {
    return await fn();
  } catch (e: any) {
    return { counts: { error: e?.message || String(e) } };
  }
}

const cap = <T,>(rows: T[]) => rows.slice(0, LIST_CAP);

export async function lettingIntegrityReport(pool: Pool) {
  const checkedAt = new Date().toISOString();

  // (a) tracker rows with NULL or dangling deal_id, split by historic status
  const a = await section(async () => {
    const { rows } = await pool.query(
      `SELECT au.id, au.unit_name, au.property_id, p.name AS property_name, au.marketing_status, au.deal_id, au.created_at,
              (au.deal_id IS NOT NULL) AS dangling
         FROM available_units au
         LEFT JOIN crm_deals d ON d.id = au.deal_id
         LEFT JOIN crm_properties p ON p.id = au.property_id
        WHERE au.deal_id IS NULL OR d.id IS NULL
        ORDER BY au.created_at DESC NULLS LAST`);
    const bucket = (historic: boolean, dangling: boolean) => rows.filter((r: any) => isHistoricRaw(r.marketing_status) === historic && !!r.dangling === dangling);
    const live_null = bucket(false, false), live_dangling = bucket(false, true);
    const historic_null = bucket(true, false), historic_dangling = bucket(true, true);
    return {
      counts: { total: rows.length, live_null: live_null.length, live_dangling: live_dangling.length, historic_null: historic_null.length, historic_dangling: historic_dangling.length },
      list: { live_null: cap(live_null), live_dangling: cap(live_dangling), historic_null: cap(historic_null), historic_dangling: cap(historic_dangling) },
    };
  });

  // (b) live letting deals with no tracker row, with a best-guess door
  const b = await section(async () => {
    const { rows } = await pool.query(
      `SELECT d.id, d.deal_ref, d.name, d.deal_type, d.status, d.bgp_acting_for, d.fee, d.property_id, p.name AS property_name,
              d.unit_id, d.tenancy_unit_id, d.monday_item_id, d.created_at
         FROM crm_deals d
         LEFT JOIN crm_properties p ON p.id = d.property_id
        WHERE d.deal_type = ANY($1::text[])
          AND NOT EXISTS (SELECT 1 FROM available_units au WHERE au.deal_id = d.id)
        ORDER BY d.created_at DESC NULLS LAST`, [LETTING_DEAL_TYPES]);
    const live = rows.filter((r: any) => isLiveCode(r.status)).map((r: any) => {
      const name = String(r.name || "");
      // unit-mirror names a backing deal "<Property> – <Unit>" (with or without a
      // unit_id); the deal form names its deals "<Counterparty> – <Property>", so
      // the property-first prefix is the tracker signature.
      const fromTracker = !!r.property_name && name.startsWith(`${r.property_name} – `);
      const door =
        r.monday_item_id ? "Monday import" :
        fromTracker ? "Add Unit / backing deal (tracker row since removed)" :
        r.unit_id ? "Deal form (unit picked)" :
        r.property_id ? "Deal form or ChatBGP (property, no unit)" :
        "ChatBGP, WIP import or import-anything (no property)";
      return { ...r, status_code: legacyToCode(r.status), door };
    });
    const byDoor: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const r of live) {
      byDoor[r.door] = (byDoor[r.door] || 0) + 1;
      byStatus[r.status_code || "?"] = (byStatus[r.status_code || "?"] || 0) + 1;
    }
    return { counts: { total: live.length, byDoor, byStatus }, list: cap(live) };
  });

  // (c) tracker rows whose deal is a non-letting type (NULL type counts as letting, as unit-mirror does)
  const c = await section(async () => {
    const { rows } = await pool.query(
      `SELECT au.id, au.unit_name, au.property_id, p.name AS property_name, au.marketing_status,
              d.id AS deal_id, d.deal_ref, d.deal_type, d.status AS deal_status, d.bgp_acting_for
         FROM available_units au
         JOIN crm_deals d ON d.id = au.deal_id
         LEFT JOIN crm_properties p ON p.id = au.property_id
        WHERE d.deal_type IS NOT NULL AND NOT (d.deal_type = ANY($1::text[]))
        ORDER BY d.deal_type, au.unit_name`, [LETTING_DEAL_TYPES]);
    const untyped = await pool.query(`SELECT count(*)::int AS n FROM available_units au JOIN crm_deals d ON d.id = au.deal_id WHERE d.deal_type IS NULL`);
    const byType: Record<string, number> = {};
    for (const r of rows) byType[r.deal_type] = (byType[r.deal_type] || 0) + 1;
    return { counts: { total: rows.length, byType, dealTypeNull: untyped.rows[0]?.n ?? 0 }, list: cap(rows) };
  });

  // (d) deals pointed at by more than one tracker row
  const d = await section(async () => {
    const { rows } = await pool.query(
      `SELECT d.id, d.deal_ref, d.name, d.deal_type, d.status, count(*)::int AS tracker_rows,
              array_agg(au.id ORDER BY au.created_at) AS tracker_ids,
              array_agg(au.unit_name ORDER BY au.created_at) AS tracker_unit_names
         FROM available_units au
         JOIN crm_deals d ON d.id = au.deal_id
        GROUP BY d.id, d.deal_ref, d.name, d.deal_type, d.status
       HAVING count(*) > 1
        ORDER BY count(*) DESC, d.deal_ref`);
    return { counts: { total: rows.length, live: rows.filter((r: any) => isLiveCode(r.status)).length }, list: cap(rows) };
  });

  // (e) units with both a £0 AVA stub and another live letting deal
  const e = await section(async () => {
    const { rows } = await pool.query(
      `SELECT d.id, d.deal_ref, d.name, d.deal_type, d.status, d.fee, d.property_id, p.name AS property_name, d.unit_id, d.created_at,
              coalesce(pu.unit_name, au.unit_name) AS unit_name,
              au.id AS tracker_row_id
         FROM crm_deals d
         LEFT JOIN property_units pu ON pu.id = d.unit_id
         LEFT JOIN LATERAL (SELECT a.id, a.unit_name FROM available_units a WHERE a.deal_id = d.id ORDER BY a.created_at LIMIT 1) au ON true
         LEFT JOIN crm_properties p ON p.id = d.property_id
        WHERE d.deal_type = ANY($1::text[]) AND d.property_id IS NOT NULL`, [LETTING_DEAL_TYPES]);
    const groups = new Map<string, any[]>();
    for (const r of rows) {
      if (!isLiveCode(r.status) || !String(r.unit_name || "").trim()) continue;
      const k = unitKey(r.property_id, r.unit_name);
      const g = groups.get(k) || [];
      g.push({ ...r, status_code: legacyToCode(r.status) });
      groups.set(k, g);
    }
    const pairs: any[] = [];
    for (const g of groups.values()) {
      const stubs = g.filter((x) => x.status_code === "AVA" && !(Number(x.fee) > 0));
      const reals = g.filter((x) => !stubs.includes(x));
      if (stubs.length && reals.length) {
        pairs.push({ property_id: g[0].property_id, property_name: g[0].property_name, unit_name: g[0].unit_name, stubs, real: reals });
      }
    }
    return { counts: { total: pairs.length }, list: cap(pairs) };
  });

  // (f) tracker rows whose marketing_status disagrees with the deal's status code
  const f = await section(async () => {
    const { rows } = await pool.query(
      `SELECT au.id, au.unit_name, au.property_id, p.name AS property_name, au.marketing_status,
              d.id AS deal_id, d.deal_ref, d.status AS deal_status
         FROM available_units au
         JOIN crm_deals d ON d.id = au.deal_id
         LEFT JOIN crm_properties p ON p.id = au.property_id`);
    const off = rows
      .map((r: any) => ({ ...r, tracker_code: legacyToCode(r.marketing_status), deal_code: legacyToCode(r.deal_status) }))
      .filter((r: any) => r.tracker_code !== r.deal_code);
    const byPair: Record<string, number> = {};
    for (const r of off) {
      const k = `${r.tracker_code || "?"}→${r.deal_code || "?"}`;
      byPair[k] = (byPair[k] || 0) + 1;
    }
    return { counts: { total: off.length, of: rows.length, byPair }, list: cap(off) };
  });

  // (g) the side backfill list: stored bgp_acting_for vs what the type would derive
  const g = await section(async () => {
    const { rows } = await pool.query(
      `SELECT d.id, d.deal_ref, d.name, d.deal_type, d.status, d.bgp_acting_for, d.property_id, p.name AS property_name,
              d.landlord_id, d.tenant_id, d.created_at
         FROM crm_deals d
         LEFT JOIN crm_properties p ON p.id = d.property_id
        WHERE d.deal_type = ANY($1::text[])
        ORDER BY d.deal_type, d.deal_ref`, [TENANT_SIDE_TYPES]);
    const list = rows.map((r: any) => {
      const derived = actingForFromType(r.deal_type);
      const stored = (r.bgp_acting_for || "landlord").toLowerCase();
      return { ...r, status_code: legacyToCode(r.status), live: isLiveCode(r.status), stored_effective: stored, derived, would_change: stored !== derived };
    });
    const byType: Record<string, { total: number; would_change: number; live_would_change: number }> = {};
    for (const r of list) {
      const t = byType[r.deal_type] || (byType[r.deal_type] = { total: 0, would_change: 0, live_would_change: 0 });
      t.total++;
      if (r.would_change) { t.would_change++; if (r.live) t.live_would_change++; }
    }
    return {
      counts: { total: list.length, would_change: list.filter((r) => r.would_change).length, live_would_change: list.filter((r) => r.would_change && r.live).length, byType },
      list: cap(list.filter((r) => r.would_change).concat(list.filter((r) => !r.would_change))),
    };
  });

  // (h) the one-live-landlord-deal-per-unit index, and bgp_acting_for NULLs
  const h = await section(async () => {
    const idx = await pool.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'crm_deals_one_live_landlord_per_unit_idx'`);
    const nulls = await pool.query(`SELECT count(*)::int AS n FROM crm_deals WHERE bgp_acting_for IS NULL`);
    return {
      counts: {
        index_exists: idx.rows.length > 0,
        index_def: idx.rows[0]?.indexdef || null,
        // migrations/0034 is applied by no boot path — if it exists it was run by hand.
        applied_at_boot: false,
        acting_for_null: nulls.rows[0]?.n ?? 0,
      },
    };
  });

  // (i) available_units.marketing_status values outside the 12 codes
  const i = await section(async () => {
    const { rows } = await pool.query(`SELECT marketing_status, count(*)::int AS n FROM available_units GROUP BY marketing_status ORDER BY n DESC`);
    const codes = DEAL_STATUS_CODES as readonly string[];
    const outside = rows
      .filter((r: any) => !codes.includes(String(r.marketing_status ?? "")))
      .map((r: any) => ({ value: r.marketing_status, count: r.n, maps_to: legacyToCode(r.marketing_status) }));
    return { counts: { distinct_outside: outside.length, rows_outside: outside.reduce((s: number, r: any) => s + r.count, 0) }, list: outside };
  });

  // (j) per-table counts for the seven unit tables, and how many are unlinked
  const count = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows[0]?.n ?? 0;
  const tableCounts: Record<string, any> = {};
  const tableSection = async (name: string, fn: () => Promise<any>) => {
    try { tableCounts[name] = await fn(); } catch (e: any) { tableCounts[name] = { error: e?.message || String(e) }; }
  };
  await tableSection("property_units", async () => ({
    total: await count(`SELECT count(*)::int AS n FROM property_units`),
    no_tenancy_row_points_here: await count(`SELECT count(*)::int AS n FROM property_units pu WHERE NOT EXISTS (SELECT 1 FROM tenancy_schedule_units t WHERE t.property_unit_id = pu.id)`),
  }));
  await tableSection("tenancy_schedule_units", async () => ({
    total: await count(`SELECT count(*)::int AS n FROM tenancy_schedule_units`),
    property_unit_id_null: await count(`SELECT count(*)::int AS n FROM tenancy_schedule_units WHERE property_unit_id IS NULL`),
  }));
  await tableSection("available_units", async () => ({
    total: await count(`SELECT count(*)::int AS n FROM available_units`),
    tenancy_unit_id_null: await count(`SELECT count(*)::int AS n FROM available_units WHERE tenancy_unit_id IS NULL`),
    unit_id_null: await count(`SELECT count(*)::int AS n FROM available_units WHERE unit_id IS NULL`),
    deal_id_null: await count(`SELECT count(*)::int AS n FROM available_units WHERE deal_id IS NULL`),
  }));
  await tableSection("leasing_schedule_units", async () => ({
    total: await count(`SELECT count(*)::int AS n FROM leasing_schedule_units`),
    tenancy_unit_id_null: await count(`SELECT count(*)::int AS n FROM leasing_schedule_units WHERE tenancy_unit_id IS NULL`),
  }));
  await tableSection("crm_deals_letting", async () => ({
    total: await count(`SELECT count(*)::int AS n FROM crm_deals WHERE deal_type = ANY($1::text[])`, [LETTING_DEAL_TYPES]),
    tenancy_unit_id_null: await count(`SELECT count(*)::int AS n FROM crm_deals WHERE deal_type = ANY($1::text[]) AND tenancy_unit_id IS NULL`, [LETTING_DEAL_TYPES]),
    unit_id_null: await count(`SELECT count(*)::int AS n FROM crm_deals WHERE deal_type = ANY($1::text[]) AND unit_id IS NULL`, [LETTING_DEAL_TYPES]),
    property_id_null: await count(`SELECT count(*)::int AS n FROM crm_deals WHERE deal_type = ANY($1::text[]) AND property_id IS NULL`, [LETTING_DEAL_TYPES]),
  }));
  await tableSection("evidence_plan_units", async () => ({
    total: await count(`SELECT count(*)::int AS n FROM evidence_plan_units`),
    tenancy_unit_id_null: await count(`SELECT count(*)::int AS n FROM evidence_plan_units WHERE tenancy_unit_id IS NULL`),
  }));
  await tableSection("property_plan_units", async () => ({
    total: await count(`SELECT count(*)::int AS n FROM property_plan_units`),
    tenancy_unit_id_null: await count(`SELECT count(*)::int AS n FROM property_plan_units WHERE tenancy_unit_id IS NULL`),
    unit_id_null: await count(`SELECT count(*)::int AS n FROM property_plan_units WHERE unit_id IS NULL`),
    status_override_set: await count(`SELECT count(*)::int AS n FROM property_plan_units WHERE status_override IS NOT NULL`),
  }));

  const sections = {
    trackerRowsWithoutDeal: a,
    liveLettingDealsWithoutTrackerRow: b,
    trackerRowsOnNonLettingDeal: c,
    dealsOnMultipleTrackerRows: d,
    stubAndRealPairs: e,
    statusDisagreements: f,
    actingForDerivation: g,
    liveLandlordIndex: h,
    marketingStatusOutsideCodes: i,
  };
  const counts: Record<string, any> = {};
  const lists: Record<string, any> = {};
  for (const [k, v] of Object.entries(sections)) {
    counts[k] = v.counts;
    if (v.list !== undefined) lists[k] = v.list;
  }
  counts.tableCounts = tableCounts;
  return { checkedAt, listCap: LIST_CAP, counts, lists };
}

const SNAPSHOT_TABLES = [
  "property_units", "tenancy_schedule_units", "available_units", "leasing_schedule_units", "crm_deals",
  "deal_fee_allocations", "deal_hots", "unit_viewings", "unit_offers", "unit_interest", "unit_marketing_files",
  "unit_briefs", "unit_target_operators", "evidence_plan_units", "property_plan_units",
];

// Dumps the unit and deal tables as gzipped JSON into file storage and
// records the key + row counts in system_settings — the backout baseline
// for every later phase. Each table is capped at SNAPSHOT_ROW_CAP rows and
// the record says so when a table hit the cap.
export async function takeLettingSnapshot(pool: Pool) {
  const takenAt = new Date().toISOString();
  const tables: Record<string, { rows: any[]; count: number; capped: boolean; error?: string }> = {};
  for (const t of SNAPSHOT_TABLES) {
    try {
      const { rows } = await pool.query(`SELECT * FROM ${t} LIMIT ${SNAPSHOT_ROW_CAP + 1}`);
      const capped = rows.length > SNAPSHOT_ROW_CAP;
      tables[t] = { rows: capped ? rows.slice(0, SNAPSHOT_ROW_CAP) : rows, count: Math.min(rows.length, SNAPSHOT_ROW_CAP), capped };
    } catch (e: any) {
      tables[t] = { rows: [], count: 0, capped: false, error: e?.message || String(e) };
    }
  }
  const key = `snapshots/letting-${takenAt}.json.gz`;
  const gz = gzipSync(Buffer.from(JSON.stringify({ takenAt, rowCap: SNAPSHOT_ROW_CAP, tables }), "utf8"));
  await saveFile(key, gz, "application/gzip", `letting-${takenAt}.json.gz`);
  const counts: Record<string, { count: number; capped: boolean; error?: string }> = {};
  for (const [t, v] of Object.entries(tables)) counts[t] = { count: v.count, capped: v.capped, ...(v.error ? { error: v.error } : {}) };
  const record = { key, takenAt, bytes: gz.length, counts };
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [`letting_snapshot:${takenAt}`, JSON.stringify(record)]);
  return record;
}

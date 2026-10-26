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
import { ALL_LETTING_TYPES, TENANT_SIDE_TYPES, actingForFromType, isHistoricStatus, isLettingType, isTrackerLiveStatus } from "@shared/letting-rules";
import { classifyDealForAccount, type AccountDealRow, type DealClassification } from "./account-resolver";
import { saveFile } from "./file-storage";

// Letting types (current + legacy labels), tracker-live and historic codes
// and the tenant-side list all come from shared/letting-rules.ts.
// Deal codes past HOTs: the unit is spoken for, so a tenancy row still
// reading Vacant / Marketing is stale (section n).
const SOL_PLUS_CODES = ["SOL", "EXC", "COM", "INV"];
// The tenancy schedule's "not let" vocabulary: unit-mirror maps vacant /
// void / marketing to AVA and tenancy-schedule-display's Vacant filter adds
// available / ava. The archived label is deliberately not here.
const VACANT_LIKE_TENANCY = ["vacant", "void", "marketing", "available", "ava"];
// A deal code stored where the leasing schedule's own enum (Vacant / In
// Negotiation / Under Offer / Occupied / Trading / Lease Event / Archived)
// belongs; unit-mirror writes "Marketing" for a tenancy row at Marketing.
const LEASING_MARKETING_LABELS = ["ava", "available", "marketing"];
const LIST_CAP = 200;
const SNAPSHOT_ROW_CAP = 50_000;

function unitKey(propertyId: string | null, unitName: string | null): string {
  return `${propertyId || ""}::${String(unitName || "").trim().toLowerCase()}`;
}


// What else moves when a deal's side flips (section g, Phase 0 impact list):
//  - the account classification (server/account-resolver.ts
//    classifyDealForAccount is pure, but it takes the account's entity and
//    portfolio sets, which come from the DB per account). Two stand-in
//    accounts are run instead: the landlord-side account (owns the deal's
//    landlord / vendor / purchaser and the property — the Landsec shape) and
//    the tenant's own account (owns tenant_id). The per-account answer in
//    prod follows the same rules with the real sets.
//  - the PO party (server/deal-po.ts bills tenant_id only when
//    bgp_acting_for = 'tenant'; the scheme's billing entity needs
//    property_schemes and is not shown here).
//  - the WIP client column (server/crm.ts WIP report: clientByRole chain,
//    where isTenantRepTeam = team contains "tenant rep" OR bgp_acting_for =
//    'tenant', then landlord → tenant → vendor → purchaser → property
//    landlord fallbacks).
function wipClientFor(r: any, actingFor: string): string | null {
  const dt = String(r.deal_type || "");
  const team = Array.isArray(r.team) ? r.team.join(",").toLowerCase() : String(r.team || "").toLowerCase();
  const isTenantRepTeam = /tenant\s*rep/.test(team) || actingFor === "tenant";
  const byRole =
    dt === "Sale"              ? r.vendor_name :
    dt === "Purchase"          ? r.purchaser_name :
    dt === "Lease Acquisition" ? r.tenant_name :
    dt === "Lease Disposal"    ? r.tenant_name :
    isTenantRepTeam            ? r.tenant_name :
                                 r.landlord_name;
  return byRole || r.landlord_name || r.tenant_name || r.vendor_name || r.purchaser_name || r.property_landlord_name || null;
}

function classificationLabel(c: DealClassification): string {
  if (!c) return "none";
  return c.bucket === "instruction" ? "instruction" : `related:${c.activityKind}`;
}

function actingForImpact(r: any) {
  const asRow = (actingFor: string): AccountDealRow => ({ ...r, bgp_acting_for: actingFor });
  const landlordSide = new Set<string>([r.landlord_id, r.vendor_id, r.purchaser_id].filter(Boolean));
  const portfolio = new Set<string>(r.property_id ? [r.property_id] : []);
  const tenantSide = new Set<string>(r.tenant_id ? [r.tenant_id] : []);
  const account_landlord_before = classificationLabel(classifyDealForAccount(asRow(r.stored_effective), landlordSide, portfolio));
  const account_landlord_after = classificationLabel(classifyDealForAccount(asRow(r.derived), landlordSide, portfolio));
  const account_tenant_before = classificationLabel(classifyDealForAccount(asRow(r.stored_effective), tenantSide, new Set()));
  const account_tenant_after = classificationLabel(classifyDealForAccount(asRow(r.derived), tenantSide, new Set()));
  const po_billed_before = [r.landlord_id, r.vendor_id, r.purchaser_id, r.property_landlord_id].filter(Boolean);
  const po_billed_after = r.derived === "tenant" && r.tenant_id && !po_billed_before.includes(r.tenant_id) ? [...po_billed_before, r.tenant_id] : po_billed_before;
  const wip_client_before = wipClientFor(r, r.stored_effective);
  const wip_client_after = wipClientFor(r, r.derived);
  return {
    account_landlord_before, account_landlord_after, account_landlord_changes: account_landlord_before !== account_landlord_after,
    account_tenant_before, account_tenant_after, account_tenant_changes: account_tenant_before !== account_tenant_after,
    po_landlord_id: r.landlord_id || null, po_tenant_id: r.tenant_id || null, po_both_set: !!(r.landlord_id && r.tenant_id),
    po_billed_before, po_billed_after, po_tenant_joins_billing: po_billed_after.length !== po_billed_before.length,
    wip_client_before, wip_client_after, wip_client_changes: (wip_client_before || null) !== (wip_client_after || null),
  };
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
    const bucket = (historic: boolean, dangling: boolean) => rows.filter((r: any) => isHistoricStatus(r.marketing_status) === historic && !!r.dangling === dangling);
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
        ORDER BY d.created_at DESC NULLS LAST`, [ALL_LETTING_TYPES]);
    const live = rows.filter((r: any) => isTrackerLiveStatus(r.status)).map((r: any) => {
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
        ORDER BY d.deal_type, au.unit_name`, [ALL_LETTING_TYPES]);
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
    return { counts: { total: rows.length, live: rows.filter((r: any) => isTrackerLiveStatus(r.status)).length }, list: cap(rows) };
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
        WHERE d.deal_type = ANY($1::text[]) AND d.property_id IS NOT NULL`, [ALL_LETTING_TYPES]);
    const groups = new Map<string, any[]>();
    for (const r of rows) {
      if (!isTrackerLiveStatus(r.status) || !String(r.unit_name || "").trim()) continue;
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

  // (g) the side backfill list: stored bgp_acting_for vs what the type would
  // derive, and — for each deal that would change — what else moves with it
  // (account classification, PO party, WIP client; see actingForImpact).
  const g = await section(async () => {
    const { rows } = await pool.query(
      `SELECT d.id, d.deal_ref, d.name, d.deal_type, d.status, d.bgp_acting_for, d.property_id, p.name AS property_name,
              d.landlord_id, d.tenant_id, d.vendor_id, d.purchaser_id, d.team, d.created_at, d.completed_at,
              p.landlord_id AS property_landlord_id,
              lc.name AS landlord_name, tc.name AS tenant_name, vc.name AS vendor_name, pc.name AS purchaser_name,
              plc.name AS property_landlord_name
         FROM crm_deals d
         LEFT JOIN crm_properties p ON p.id = d.property_id
         LEFT JOIN crm_companies lc ON lc.id = d.landlord_id
         LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
         LEFT JOIN crm_companies vc ON vc.id = d.vendor_id
         LEFT JOIN crm_companies pc ON pc.id = d.purchaser_id
         LEFT JOIN crm_companies plc ON plc.id = p.landlord_id
        WHERE d.deal_type = ANY($1::text[])
        ORDER BY d.deal_type, d.deal_ref`, [TENANT_SIDE_TYPES]);
    const list = rows.map((r: any) => {
      const derived = actingForFromType(r.deal_type);
      const stored = (r.bgp_acting_for || "landlord").toLowerCase();
      const base = { ...r, status_code: legacyToCode(r.status), live: isTrackerLiveStatus(r.status), stored_effective: stored, derived, would_change: stored !== derived };
      return base.would_change ? { ...base, ...actingForImpact(base) } : base;
    });
    const byType: Record<string, { total: number; would_change: number; live_would_change: number }> = {};
    for (const r of list) {
      const t = byType[r.deal_type] || (byType[r.deal_type] = { total: 0, would_change: 0, live_would_change: 0 });
      t.total++;
      if (r.would_change) { t.would_change++; if (r.live) t.live_would_change++; }
    }
    const changing = list.filter((r) => r.would_change);
    const impact = {
      account_landlord_changes: changing.filter((r) => r.account_landlord_changes).length,
      account_tenant_changes: changing.filter((r) => r.account_tenant_changes).length,
      po_tenant_joins_billing: changing.filter((r) => r.po_tenant_joins_billing).length,
      po_both_parties_set: changing.filter((r) => r.po_both_set).length,
      wip_client_changes: changing.filter((r) => r.wip_client_changes).length,
    };
    return {
      counts: { total: list.length, would_change: changing.length, live_would_change: changing.filter((r) => r.live).length, byType, impact },
      list: cap(changing.concat(list.filter((r) => !r.would_change))),
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

  // (k) units (crm_deals.unit_id) carrying more than one live landlord-side
  // deal, by deal-type pair — sizes the one-live-landlord-deal-per-unit
  // index: letting+letting pairs must be zero before it is created;
  // letting+advisory and advisory+advisory are expected and untouched.
  // "Live" is the index's own test — any status outside its closed list
  // (EXC / COM / WIT / INV, ARCH) — so NULL, REP / SPEC / LIVE and unmapped
  // free text count as live, exactly as CREATE UNIQUE INDEX would count them.
  const k = await section(async () => {
    const { rows } = await pool.query(
      `SELECT d.id, d.deal_ref, d.name, d.deal_type, d.status, d.bgp_acting_for, d.fee, d.unit_id, d.property_id, p.name AS property_name,
              pu.unit_name, d.created_at
         FROM crm_deals d
         LEFT JOIN property_units pu ON pu.id = d.unit_id
         LEFT JOIN crm_properties p ON p.id = d.property_id
        WHERE d.unit_id IS NOT NULL AND (d.bgp_acting_for IS NULL OR d.bgp_acting_for = 'landlord')
        ORDER BY d.unit_id, d.created_at`);
    const byUnit = new Map<string, any[]>();
    for (const r of rows) {
      if (isHistoricStatus(r.status)) continue;
      const g = byUnit.get(r.unit_id) || [];
      g.push({ id: r.id, deal_ref: r.deal_ref, name: r.name, deal_type: r.deal_type, status: r.status, status_code: legacyToCode(r.status), fee: r.fee, letting: isLettingType(r.deal_type), type_null: r.deal_type == null });
      byUnit.set(r.unit_id, g);
    }
    const units: any[] = [];
    const byPair: Record<string, number> = { "letting+letting": 0, "letting+advisory": 0, "advisory+advisory": 0 };
    let nullTypeDeals = 0;
    let statusOutsideCodes = 0;
    for (const [unit_id, deals] of byUnit) {
      if (deals.length < 2) continue;
      const letting = deals.filter((d) => d.letting).length;
      const pair = letting >= 2 ? "letting+letting" : letting === 1 ? "letting+advisory" : "advisory+advisory";
      byPair[pair]++;
      nullTypeDeals += deals.filter((d) => d.type_null).length;
      statusOutsideCodes += deals.filter((d) => !d.status_code).length;
      const first = rows.find((r: any) => r.unit_id === unit_id);
      units.push({ id: unit_id, unit_id, unit_name: first?.unit_name ?? null, property_id: first?.property_id ?? null, property_name: first?.property_name ?? null, pair, letting_deals: letting, advisory_deals: deals.length - letting, deals });
    }
    // letting+letting first — the pair the index needs at zero — then the expected pairs.
    const pairRank: Record<string, number> = { "letting+letting": 0, "letting+advisory": 1, "advisory+advisory": 2 };
    units.sort((a, b) => (a.pair === b.pair ? b.deals.length - a.deals.length : pairRank[a.pair] - pairRank[b.pair]));
    return {
      counts: { units: units.length, byPair, deals_involved: units.reduce((s, u) => s + u.deals.length, 0), deal_type_null_counted_as_advisory: nullTypeDeals, deal_status_not_in_12_codes: statusOutsideCodes },
      list: cap(units),
    };
  });

  // (l) ARCH / Archived deals: declared a closed code in shared/deal-status.ts
  // (Phase 1), yet the 0034 index predicate, the stub check's live-on-spine
  // query (unit-mirror ensureBackingDealForUnit) and relinkOffSpineDeals
  // still use a hand-typed closed list that omits it — so to them an ARCH
  // deal is still live.
  const l = await section(async () => {
    const { rows } = await pool.query(
      `SELECT d.id, d.deal_ref, d.name, d.deal_type, d.status, d.bgp_acting_for, d.unit_id, d.tenancy_unit_id, d.property_id, p.name AS property_name, d.updated_at,
              (SELECT au.id FROM available_units au WHERE au.deal_id = d.id ORDER BY au.created_at LIMIT 1) AS tracker_row_id
         FROM crm_deals d
         LEFT JOIN crm_properties p ON p.id = d.property_id
        WHERE lower(trim(coalesce(d.status, ''))) IN ('arch', 'archived')
        ORDER BY d.deal_ref`);
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    return {
      counts: {
        total: rows.length,
        byStatus,
        with_unit_id: rows.filter((r: any) => r.unit_id).length,
        with_tenancy_unit_id: rows.filter((r: any) => r.tenancy_unit_id).length,
        with_tracker_row: rows.filter((r: any) => r.tracker_row_id).length,
        letting_type: rows.filter((r: any) => isLettingType(r.deal_type)).length,
      },
      list: cap(rows.map((r: any) => ({ ...r, deal_id: r.id, treated_as_live: true }))),
    };
  });

  // (m) leasing_schedule_units rows holding a deal code (AVA / Available /
  // Marketing) where the leasing enum belongs.
  const m = await section(async () => {
    const { rows } = await pool.query(
      `SELECT l.id, l.unit_name, l.property_id, p.name AS property_name, l.status, l.tenancy_unit_id, l.tenant_name, l.updated_at
         FROM leasing_schedule_units l
         LEFT JOIN crm_properties p ON p.id = l.property_id
        WHERE lower(trim(coalesce(l.status, ''))) = ANY($1::text[])
        ORDER BY p.name, l.unit_name`, [LEASING_MARKETING_LABELS]);
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    return {
      counts: { total: rows.length, byStatus, tenancy_unit_id_null: rows.filter((r: any) => !r.tenancy_unit_id).length, tenancy_unit_id_set: rows.filter((r: any) => r.tenancy_unit_id).length },
      list: cap(rows.map((r: any) => ({ ...r, maps_to_code: legacyToCode(r.status), spine_linked: !!r.tenancy_unit_id }))),
    };
  });

  // (n) tenancy rows still Vacant / Marketing while their linked deal is at
  // Solicitors or beyond — and whether the tracker row is on bgp.uk.com
  // (show_on_website), the regression that leaks let units to the website.
  // Linked via crm_deals.tenancy_unit_id, the tracker row's tenancy_unit_id
  // → deal_id, or the tenancy row's own letting_tracker_unit_id back-pointer
  // (the schedule's "let by" join in tenancy-schedule.ts honours it).
  // Effective tenancy status = occupancy_status when set, else status (as
  // property-asset-brief reads it).
  const n = await section(async () => {
    const { rows } = await pool.query(
      `SELECT t.id, t.property_id, p.name AS property_name, coalesce(t.unit_number, t.premises) AS unit_name,
              t.status AS tenancy_status, t.occupancy_status, t.letting_tracker_unit_id, t.tenant_name,
              d.id AS deal_id, d.deal_ref, d.deal_type, d.status AS deal_status, link.via,
              au.id AS tracker_row_id, au.show_on_website, au.marketing_status
         FROM tenancy_schedule_units t
         JOIN LATERAL (
           SELECT d1.id AS deal_id, 'crm_deals.tenancy_unit_id' AS via FROM crm_deals d1 WHERE d1.tenancy_unit_id = t.id
           UNION
           SELECT a.deal_id, 'available_units.tenancy_unit_id' FROM available_units a WHERE a.tenancy_unit_id = t.id AND a.deal_id IS NOT NULL
           UNION
           SELECT a.deal_id, 'tenancy.letting_tracker_unit_id' FROM available_units a WHERE a.id = t.letting_tracker_unit_id AND a.deal_id IS NOT NULL
         ) link ON true
         JOIN crm_deals d ON d.id = link.deal_id
         LEFT JOIN crm_properties p ON p.id = t.property_id
         LEFT JOIN LATERAL (
           SELECT a.id, a.show_on_website, a.marketing_status FROM available_units a
            WHERE a.deal_id = d.id OR a.tenancy_unit_id = t.id
            ORDER BY (a.deal_id = d.id) DESC NULLS LAST, a.created_at LIMIT 1
         ) au ON true`);
    const seen = new Set<string>();
    const stale = rows
      .map((r: any) => ({ ...r, effective_status: String(r.occupancy_status || "").trim() || r.tenancy_status, deal_code: legacyToCode(r.deal_status) }))
      .filter((r: any) => VACANT_LIKE_TENANCY.includes(String(r.effective_status || "").trim().toLowerCase()) && !!r.deal_code && SOL_PLUS_CODES.includes(r.deal_code))
      .filter((r: any) => { const key = `${r.id}::${r.deal_id}`; if (seen.has(key)) return false; seen.add(key); return true; });
    const byDealCode: Record<string, number> = {};
    const byVia: Record<string, number> = {};
    for (const r of stale) {
      byDealCode[r.deal_code] = (byDealCode[r.deal_code] || 0) + 1;
      byVia[r.via] = (byVia[r.via] || 0) + 1;
    }
    return {
      counts: { total: stale.length, tenancy_rows: new Set(stale.map((r: any) => r.id)).size, on_website: stale.filter((r: any) => r.show_on_website === true).length, byDealCode, byVia },
      list: { on_website: cap(stale.filter((r: any) => r.show_on_website === true)), not_on_website: cap(stale.filter((r: any) => r.show_on_website !== true)) },
    };
  });

  // (o) tracker rows that look born from the deleted deploy-time loop
  // (routes.ts, removed 2026-10-26): it named the row after the deal, stored
  // marketing_status 'Available', property_id '' when the deal had none, and
  // copied deal.internal_agent (display names) into agent_user_ids (an id
  // column). Any one structural signal lists the row; "strong" = the name
  // matches plus at least one other signal.
  const o = await section(async () => {
    const { rows } = await pool.query(
      `SELECT au.id, au.unit_name, au.property_id, p.name AS property_name, au.marketing_status, au.agent_user_ids, au.created_at,
              d.id AS deal_id, d.deal_ref, d.name AS deal_name, d.status AS deal_status,
              (d.id IS NOT NULL AND au.unit_name = d.name) AS name_is_deal_name,
              (au.property_id IS NULL OR trim(au.property_id) = '') AS property_blank,
              EXISTS (SELECT 1 FROM unnest(coalesce(au.agent_user_ids, '{}'::text[])) e
                       WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = e)) AS agent_ids_not_users
         FROM available_units au
         LEFT JOIN crm_deals d ON d.id = au.deal_id
         LEFT JOIN crm_properties p ON p.id = au.property_id
        WHERE (d.id IS NOT NULL AND au.unit_name = d.name)
           OR au.property_id IS NULL OR trim(au.property_id) = ''
           OR EXISTS (SELECT 1 FROM unnest(coalesce(au.agent_user_ids, '{}'::text[])) e
                       WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = e))
        ORDER BY au.created_at`);
    const list = rows.map((r: any) => {
      const status_raw_available = String(r.marketing_status || "").trim() === "Available";
      const signals = [
        r.name_is_deal_name ? "name = deal name" : null,
        r.property_blank ? "property blank" : null,
        r.agent_ids_not_users ? "agent_user_ids not user ids" : null,
        status_raw_available ? "status 'Available'" : null,
      ].filter(Boolean) as string[];
      return { ...r, status_code: legacyToCode(r.marketing_status), status_raw_available, signals, strong: !!r.name_is_deal_name && signals.length >= 2 };
    });
    return {
      counts: {
        total: list.length,
        strong: list.filter((r) => r.strong).length,
        name_is_deal_name: list.filter((r) => r.name_is_deal_name).length,
        property_blank: list.filter((r) => r.property_blank).length,
        agent_ids_not_users: list.filter((r) => r.agent_ids_not_users).length,
        status_raw_available: list.filter((r) => r.status_raw_available).length,
        live: list.filter((r) => isTrackerLiveStatus(r.marketing_status)).length,
      },
      list: cap(list.filter((r) => r.strong).concat(list.filter((r) => !r.strong))),
    };
  });

  // (p) tracker rows carrying a Heads of Terms document (hots_content, a
  // runtime-only column from server/index.ts) and how many of those sit on
  // a closed deal (EXC / COM / INV / WIT / ARCH).
  const p = await section(async () => {
    const { rows } = await pool.query(
      `SELECT au.id, au.unit_name, au.property_id, p.name AS property_name, au.marketing_status, au.hots_updated_at,
              length(au.hots_content) AS hots_chars,
              d.id AS deal_id, d.deal_ref, d.status AS deal_status, d.deal_type
         FROM available_units au
         LEFT JOIN crm_deals d ON d.id = au.deal_id
         LEFT JOIN crm_properties p ON p.id = au.property_id
        WHERE au.hots_content IS NOT NULL AND au.hots_content <> ''
        ORDER BY au.hots_updated_at DESC NULLS LAST`);
    const list = rows.map((r: any) => ({ ...r, deal_code: legacyToCode(r.deal_status), on_closed_deal: !!r.deal_id && isHistoricStatus(r.deal_status), no_deal: !r.deal_id }));
    const byDealCode: Record<string, number> = {};
    for (const r of list) byDealCode[r.deal_id ? (r.deal_code || r.deal_status || "?") : "no deal"] = (byDealCode[r.deal_id ? (r.deal_code || r.deal_status || "?") : "no deal"] || 0) + 1;
    return {
      counts: { total: list.length, on_closed_deal: list.filter((r) => r.on_closed_deal).length, no_deal: list.filter((r) => r.no_deal).length, byDealCode },
      list: cap(list.filter((r) => r.on_closed_deal).concat(list.filter((r) => !r.on_closed_deal))),
    };
  });

  // (q) live letting deals with no spine link whose property has a tenancy
  // row of the same unit name — the tenancy import's clearExisting NULLs
  // crm_deals.tenancy_unit_id for the whole property; the nightly
  // relinkOffSpineDeals only re-links deals that carry a unit_id. The unit
  // name comes from property_units via unit_id, else from the tracker row
  // pointing at the deal; the candidate is the first same-name spine row.
  const q = await section(async () => {
    const { rows } = await pool.query(
      `SELECT d.id, d.deal_ref, d.name, d.deal_type, d.status, d.property_id, p.name AS property_name, d.unit_id,
              coalesce(pu.unit_name, au.unit_name) AS unit_name,
              CASE WHEN pu.unit_name IS NOT NULL THEN 'property_units' WHEN au.unit_name IS NOT NULL THEN 'available_units' END AS unit_name_source,
              au.id AS tracker_row_id, au.tenancy_unit_id AS tracker_tenancy_unit_id,
              t.id AS spine_candidate_id, t.status AS spine_status, t.occupancy_status AS spine_occupancy_status, t.tenant_name AS spine_tenant_name,
              t.deal_id AS spine_deal_id, t.letting_tracker_unit_id AS spine_tracker_id,
              (SELECT count(*)::int FROM tenancy_schedule_units t2
                WHERE t2.property_id = d.property_id
                  AND lower(trim(coalesce(t2.unit_number, t2.premises, ''))) = lower(trim(coalesce(pu.unit_name, au.unit_name, '')))) AS spine_matches
         FROM crm_deals d
         LEFT JOIN property_units pu ON pu.id = d.unit_id
         LEFT JOIN LATERAL (SELECT a.id, a.unit_name, a.tenancy_unit_id FROM available_units a WHERE a.deal_id = d.id ORDER BY a.created_at LIMIT 1) au ON true
         LEFT JOIN crm_properties p ON p.id = d.property_id
         JOIN LATERAL (
           SELECT t.id, t.status, t.occupancy_status, t.tenant_name, t.deal_id, t.letting_tracker_unit_id FROM tenancy_schedule_units t
            WHERE t.property_id = d.property_id
              AND trim(coalesce(t.unit_number, t.premises, '')) <> ''
              AND lower(trim(coalesce(t.unit_number, t.premises, ''))) = lower(trim(coalesce(pu.unit_name, au.unit_name, '')))
            ORDER BY t.created_at LIMIT 1
         ) t ON true
        WHERE d.deal_type = ANY($1::text[]) AND d.tenancy_unit_id IS NULL AND d.property_id IS NOT NULL
        ORDER BY p.name, coalesce(pu.unit_name, au.unit_name)`, [ALL_LETTING_TYPES]);
    const list = rows
      .filter((r: any) => isTrackerLiveStatus(r.status))
      .map((r: any) => ({ ...r, status_code: legacyToCode(r.status), ambiguous: Number(r.spine_matches) > 1, tracker_row_linked_to_candidate: !!r.tracker_tenancy_unit_id && r.tracker_tenancy_unit_id === r.spine_candidate_id, spine_points_back: r.spine_deal_id === r.id }));
    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const r of list) {
      byStatus[r.status_code || "?"] = (byStatus[r.status_code || "?"] || 0) + 1;
      bySource[r.unit_name_source || "?"] = (bySource[r.unit_name_source || "?"] || 0) + 1;
    }
    return {
      counts: {
        total: list.length, byStatus, bySource,
        no_unit_id_so_nightly_relink_skips: list.filter((r) => !r.unit_id).length,
        ambiguous_name: list.filter((r) => r.ambiguous).length,
        tracker_row_already_on_candidate: list.filter((r) => r.tracker_row_linked_to_candidate).length,
        spine_row_points_back_at_deal: list.filter((r) => r.spine_points_back).length,
      },
      list: cap(list),
    };
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
    total: await count(`SELECT count(*)::int AS n FROM crm_deals WHERE deal_type = ANY($1::text[])`, [ALL_LETTING_TYPES]),
    tenancy_unit_id_null: await count(`SELECT count(*)::int AS n FROM crm_deals WHERE deal_type = ANY($1::text[]) AND tenancy_unit_id IS NULL`, [ALL_LETTING_TYPES]),
    unit_id_null: await count(`SELECT count(*)::int AS n FROM crm_deals WHERE deal_type = ANY($1::text[]) AND unit_id IS NULL`, [ALL_LETTING_TYPES]),
    property_id_null: await count(`SELECT count(*)::int AS n FROM crm_deals WHERE deal_type = ANY($1::text[]) AND property_id IS NULL`, [ALL_LETTING_TYPES]),
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
    unitsWithMultipleLiveLandlordDeals: k,
    archDeals: l,
    leasingRowsAtMarketingCode: m,
    tenancyRowsVacantWithClosedDeal: n,
    bootLoopBornTrackerRows: o,
    hotsContent: p,
    dealsUnlinkedFromSpine: q,
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

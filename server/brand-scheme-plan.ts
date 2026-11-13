// Brand CRM: a brand's plan by scheme and unit (docs/brand-crm-spec-2026-11-12.md,
// 2.1, 2.2 and 2.4). One line per brand, scheme and unit, with its stage read
// from the records the app already holds: tenancies, deals, heads of terms,
// offers, viewings, interest, units sent to the brand, the targets on a unit's
// brief and on the leasing schedule, the Landsec brand case, and the "Wanted"
// lines in brand_scheme_targets. Nothing here writes a deal: a real letting
// only ever comes from server/letting-service.ts.
//
// Two front doors. BGP staff use /api/brand-crm/* (all brands, all
// landlords). Every Landsec login, and staff viewing as Landsec, uses
// /api/landsec/brand-crm/*: the 14 schemes only, brands in the client slice
// only, and nothing of BGP's own (lead, aim, on hold, next action, notes,
// name-only matches, units sent to a brand, hidden Wanted lines, draft brand
// cases). Asset managers and joint agents get their own schemes with a count
// of the others; a joint agent gets brand names with no company id. The
// stage a client sees is worked out from the evidence that client may see.
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { resolveCompanyScope, isClientRequestUser, isClientVisibleBrand, clientBrandSliceSql } from "./company-scope";
import { landsecViewer } from "./landsec-access";
import { resolveLandsecPortfolio, landsecCompanyId, type LandsecPortfolio } from "./landsec-schemes";
import { key as nameKeySql } from "./brand-relevance";
import { legacyToCode } from "@shared/deal-status";
import { isLettingType } from "@shared/letting-rules";
import { formatSizeList } from "@shared/format-size";
import {
  BRAND_STAGE_LABELS, askedNoTarget, brandStageRank, daysSince, furthestStage, isAgreedOfferStatus, isOnHold, planHeadline,
  requirementChip, resolveStage,
  type BrandGrid, type BrandGridBrand, type BrandPlan, type ChipRequirement, type PlanRow, type StageEvidence, type UnitLettingContext,
} from "@shared/brand-stage";

export type Queryable = { query: (sql: string, values?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export type PlanViewerKind = "staff" | "landsec" | "asset_manager" | "joint_agent";
export interface PlanViewer {
  kind: PlanViewerKind;              // "landsec" = a full Landsec login, a leasing manager, or staff viewing as Landsec
  clientCompanyId: string | null;    // the client company whose view this is; null for staff
  schemes: Set<string> | null;       // an asset manager's or joint agent's own schemes
}
export const STAFF_VIEWER: PlanViewer = { kind: "staff", clientCompanyId: null, schemes: null };

export interface PlanScheme { key: string; name: string; town: string; group: string; regions: string[]; canonicalId: string | null; propertyIds: string[] }

export function planSchemes(portfolio: LandsecPortfolio): PlanScheme[] {
  return portfolio.schemes.map(s => ({ key: s.key, name: s.name, town: s.town, group: s.group, regions: s.regions || [], canonicalId: s.canonicalId, propertyIds: s.properties.map(p => p.id) }));
}

// ── SQL ──────────────────────────────────────────────────────────────────
const iso = (expr: string) => `to_char(${expr}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const BRANDS = (col: string) => `($1::text[] IS NULL OR ${col} = ANY($1))`;
const PROPS = (col: string) => `($2::text[] IS NULL OR ${col} = ANY($2))`;

// Each branch gives: company_id, property_id, spine_id, tracker_id, lsu_id, deal_id, src, st, at, x.
const CORE_BRANCHES = [
  `SELECT t.tenant_company_id AS company_id, t.property_id, t.id AS spine_id, NULL::varchar AS tracker_id, NULL::varchar AS lsu_id,
          NULL::varchar AS deal_id, 'trading'::text AS src, t.status AS st, t.lease_start::text AS at, NULL::jsonb AS x
     FROM tenancy_schedule_units t
    WHERE t.tenant_company_id IS NOT NULL AND ${BRANDS("t.tenant_company_id")} AND ${PROPS("t.property_id")}
      AND COALESCE(t.status, '') NOT IN ('Vacant', 'Void', 'Available')`,
  `SELECT u.tenant_company_id, u.property_id, u.tenancy_unit_id, NULL, u.id, NULL, 'trading', u.status, NULL, NULL
     FROM leasing_schedule_units u
    WHERE u.tenant_company_id IS NOT NULL AND ${BRANDS("u.tenant_company_id")} AND ${PROPS("u.property_id")}`,
  `SELECT d.tenant_id, d.property_id, d.tenancy_unit_id, NULL, NULL, d.id, 'deal', d.status,
          ${iso("COALESCE(d.stage_entered_at, d.updated_at, d.created_at)")},
          jsonb_build_object('dealType', d.deal_type, 'ref', d.deal_ref, 'unitId', d.unit_id, 'agent', d.internal_agent, 'agentIds', d.internal_agent_ids,
                             'exchangedAt', ${iso("d.exchanged_at")}, 'completedAt', ${iso("d.completed_at")})
     FROM crm_deals d
    WHERE d.tenant_id IS NOT NULL AND ${BRANDS("d.tenant_id")} AND ${PROPS("d.property_id")}`,
  `SELECT o.company_id, au.property_id, au.tenancy_unit_id, au.id, au.leasing_schedule_unit_id, NULL, 'offer', o.status, o.offer_date,
          jsonb_build_object('offerId', o.id, 'createdAt', ${iso("o.created_at")})
     FROM unit_offers o JOIN available_units au ON au.id = o.unit_id
    WHERE o.company_id IS NOT NULL AND ${BRANDS("o.company_id")} AND ${PROPS("au.property_id")}`,
  // Inner join: a viewing with no unit cannot be placed at a scheme, so it is left out.
  `SELECT v.company_id, au.property_id, au.tenancy_unit_id, au.id, au.leasing_schedule_unit_id, NULL, 'viewing', v.status, v.viewing_date,
          jsonb_build_object('viewingId', v.id, 'requirementId', v.requirement_id, 'followUp', v.follow_up_date, 'nextAction', v.next_action, 'ownerId', v.owner_user_id)
     FROM unit_viewings v JOIN available_units au ON au.id = v.unit_id
    WHERE v.company_id IS NOT NULL AND v.deleted_at IS NULL AND COALESCE(v.status, '') NOT IN ('cancelled', 'not_leasing')
      AND ${BRANDS("v.company_id")} AND ${PROPS("au.property_id")}`,
  `SELECT i.company_id, au.property_id, au.tenancy_unit_id, au.id, au.leasing_schedule_unit_id, NULL, 'interest', NULL, i.interest_date, NULL
     FROM unit_interest i JOIN available_units au ON au.id = i.unit_id
    WHERE i.company_id IS NOT NULL AND ${BRANDS("i.company_id")} AND ${PROPS("au.property_id")}`,
  `SELECT t.company_id, au.property_id, au.tenancy_unit_id, au.id, au.leasing_schedule_unit_id, NULL, 'tracker_target', t.status,
          ${iso("COALESCE(t.updated_at, t.created_at)")}, jsonb_build_object('agentIds', t.agent_user_ids)
     FROM unit_target_operators t JOIN unit_briefs b ON b.id = t.brief_id JOIN available_units au ON au.id = b.unit_id
    WHERE t.company_id IS NOT NULL AND ${BRANDS("t.company_id")} AND ${PROPS("au.property_id")}`,
  // AI suggestions nobody approved, and rejected ones, never make a line.
  `SELECT tt.company_id, COALESCE(u.property_id, tt.property_id), u.tenancy_unit_id, NULL, tt.unit_id, NULL, 'schedule_target', tt.status,
          ${iso("COALESCE(tt.updated_at, tt.created_at)")}, jsonb_build_object('outcome', tt.outcome)
     FROM target_tenants tt LEFT JOIN leasing_schedule_units u ON u.id = tt.unit_id
    WHERE tt.company_id IS NOT NULL AND COALESCE(tt.status, '') NOT IN ('rejected', 'suggested')
      AND ${BRANDS("tt.company_id")} AND ${PROPS("COALESCE(u.property_id, tt.property_id)")}`,
  `SELECT cid, u.property_id, u.tenancy_unit_id, NULL, u.id, NULL, 'target_list', NULL, NULL, NULL
     FROM leasing_schedule_units u, unnest(u.target_company_ids) cid
    WHERE ${BRANDS("cid")} AND ${PROPS("u.property_id")} AND u.tenant_company_id IS DISTINCT FROM cid`,
  `SELECT cid, t.property_id, t.id, NULL, NULL, NULL, 'target_list', NULL, NULL, NULL
     FROM tenancy_schedule_units t, unnest(t.target_company_ids) cid
    WHERE ${BRANDS("cid")} AND ${PROPS("t.property_id")} AND t.tenant_company_id IS DISTINCT FROM cid`,
];

// The unit was sent to the brand (server/unit-share.ts). BGP only.
const SHARE_BRANCH =
  `SELECT s.company_id, au.property_id, au.tenancy_unit_id, au.id, au.leasing_schedule_unit_id, NULL, 'share', s.mode, ${iso("s.created_at")}, NULL
     FROM unit_shares s JOIN available_units au ON au.id = s.unit_id
    WHERE s.company_id IS NOT NULL AND ${BRANDS("s.company_id")} AND ${PROPS("au.property_id")}`;

// The brand's name typed into a target list with no link to its record.
// One brand at a time ($1 holds its id), matched on $3, the name keys.
const NAME_KEY = (expr: string) => `${nameKeySql(expr)} = ANY($3::text[])`;
const SPLIT = `'[,;/|•\\n\\r]+'`;
const NAME_BRANCHES = [
  `SELECT ($1::text[])[1], au.property_id, au.tenancy_unit_id, au.id, au.leasing_schedule_unit_id, NULL, 'name_match', NULL,
          ${iso("COALESCE(t.updated_at, t.created_at)")}, jsonb_build_object('via', 'the unit''s brief')
     FROM unit_target_operators t JOIN unit_briefs b ON b.id = t.brief_id JOIN available_units au ON au.id = b.unit_id
    WHERE t.company_id IS NULL AND ${PROPS("au.property_id")} AND ${NAME_KEY("t.operator_name")}`,
  `SELECT ($1::text[])[1], u.property_id, u.tenancy_unit_id, NULL, u.id, NULL, 'name_match', NULL, NULL, jsonb_build_object('via', 'the leasing schedule')
     FROM leasing_schedule_units u
    WHERE ${PROPS("u.property_id")} AND EXISTS (
      SELECT 1 FROM regexp_split_to_table(COALESCE(u.target_brands, '') || ';' || COALESCE(u.optimum_target, ''), ${SPLIT}) n WHERE ${NAME_KEY("n")})`,
  `SELECT ($1::text[])[1], t.property_id, t.id, NULL, NULL, NULL, 'name_match', NULL, NULL, jsonb_build_object('via', 'the tenancy schedule')
     FROM tenancy_schedule_units t
    WHERE t.target_tenants IS NOT NULL AND ${PROPS("t.property_id")} AND EXISTS (
      SELECT 1 FROM regexp_split_to_table(t.target_tenants, ${SPLIT}) n WHERE ${NAME_KEY("n")})`,
  `SELECT ($1::text[])[1], lu.property_id, lu.tenancy_unit_id, NULL, NULL, NULL, 'name_match', NULL, ${iso("lu.brief_updated_at")}, jsonb_build_object('via', 'the agreed brief')
     FROM landsec_units lu
    WHERE lu.brief_target_brands IS NOT NULL AND ${PROPS("lu.property_id")} AND EXISTS (
      SELECT 1 FROM regexp_split_to_table(lu.brief_target_brands, ${SPLIT}) n WHERE ${NAME_KEY("n")})`,
];

// One physical unit is known by up to four ids: the tenancy schedule row
// (the spine), the Letting Tracker row, the leasing schedule row and the
// deal (which also carries the master property_units id). Every record is
// walked to the spine through each of those before the lines are grouped.
// Three of those walks have no index behind them (the tracker row by its
// tenancy unit, the tenancy row by its tracker unit and by its deal), so
// each is read once and joined, never looked up once per record.
export function evidenceSql(branches: string[], tag = "evidence"): string {
  return `/* brand-plan:${tag} */
WITH ev(company_id, property_id, spine_id, tracker_id, lsu_id, deal_id, src, st, at, x) AS (
  ${branches.join("\n  UNION ALL\n  ")}
), au_of_unit AS MATERIALIZED (
  SELECT DISTINCT ON (tenancy_unit_id) tenancy_unit_id AS k, id FROM available_units
   WHERE tenancy_unit_id IS NOT NULL ORDER BY tenancy_unit_id, updated_at DESC NULLS LAST
), unit_of_tracker AS MATERIALIZED (
  SELECT DISTINCT ON (letting_tracker_unit_id) letting_tracker_unit_id AS k, id FROM tenancy_schedule_units
   WHERE letting_tracker_unit_id IS NOT NULL ORDER BY letting_tracker_unit_id, id
), unit_of_deal AS MATERIALIZED (
  SELECT DISTINCT ON (deal_id) deal_id AS k, id FROM tenancy_schedule_units
   WHERE deal_id IS NOT NULL ORDER BY deal_id, id
), r AS (
  SELECT ev.*, COALESCE(ev.tracker_id,
           (SELECT au.id FROM available_units au WHERE ev.deal_id IS NOT NULL AND au.deal_id = ev.deal_id ORDER BY au.updated_at DESC NULLS LAST LIMIT 1),
           aou.id,
           (SELECT au.id FROM available_units au WHERE ev.lsu_id IS NOT NULL AND au.leasing_schedule_unit_id = ev.lsu_id ORDER BY au.updated_at DESC NULLS LAST LIMIT 1)) AS tracker2
    FROM ev LEFT JOIN au_of_unit aou ON aou.k = ev.spine_id
), k AS (
  SELECT r.*, au.unit_name AS tracker_unit, au.sqft AS tracker_sqft, au.deal_id AS tracker_deal_id, au.leasing_schedule_unit_id AS tracker_lsu,
         au.property_id AS tracker_property_id,
         COALESCE(r.spine_id, au.tenancy_unit_id,
           uot.id,
           (SELECT l.tenancy_unit_id FROM leasing_schedule_units l WHERE l.id = COALESCE(r.lsu_id, au.leasing_schedule_unit_id)),
           (SELECT d.tenancy_unit_id FROM crm_deals d WHERE d.id = COALESCE(r.deal_id, au.deal_id)),
           uod.id,
           (SELECT t.id FROM tenancy_schedule_units t WHERE t.property_unit_id = COALESCE(r.x->>'unitId', au.unit_id) LIMIT 1)) AS spine
    FROM r LEFT JOIN available_units au ON au.id = r.tracker2
           LEFT JOIN unit_of_tracker uot ON uot.k = au.id
           LEFT JOIN unit_of_deal uod ON uod.k = COALESCE(r.deal_id, au.deal_id)
)
SELECT k.company_id, COALESCE(k.property_id, k.tracker_property_id, ts.property_id) AS property_id, p.name AS property_name,
       p.address::text AS property_address, p.postcode AS property_postcode,
       k.spine, k.tracker2 AS tracker_id, COALESCE(k.lsu_id, k.tracker_lsu) AS lsu_id, k.deal_id, k.tracker_deal_id, k.src, k.st, k.at, k.x,
       ts.premises, ts.unit_number, ts.status AS unit_status, ts.tenant_name AS occupier, ts.lease_expiry::text AS lease_expiry,
       COALESCE(ts.nia_sqft, ts.gia_sqft, k.tracker_sqft, ls.sqft) AS sqft, k.tracker_unit, ls.unit_name AS lsu_unit
  FROM k
  LEFT JOIN tenancy_schedule_units ts ON ts.id = k.spine
  LEFT JOIN leasing_schedule_units ls ON ls.id = COALESCE(k.lsu_id, k.tracker_lsu)
  LEFT JOIN crm_properties p ON p.id = COALESCE(k.property_id, k.tracker_property_id, ts.property_id)`;
}

// The evidence query has many branches and subplans. On real table sizes
// Postgres chooses to JIT-compile it, which costs seconds on every call and
// saves nothing, so it runs with JIT off for that one statement. A plain
// query runner with no connections of its own (a test's) runs it as it is.
async function runEvidence(q: Queryable, sql: string, values: any[]): Promise<any[]> {
  const connect = (q as any).connect;
  if (typeof connect !== "function") return (await q.query(sql, values)).rows;
  const client = await connect.call(q);
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL jit = off");
    const rows = (await client.query(sql, values)).rows;
    await client.query("COMMIT");
    return rows;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
}

// ── Reading the raw rows ─────────────────────────────────────────────────
// The date columns on offers, viewings and interest are free text.
const textDate = (v: any): string | null => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return Number.isFinite(Date.parse(s)) ? s : null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const isoDay = (v: any): string | null => { const s = textDate(v); return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; };
const shortDate = (v: any): string | null => {
  const s = textDate(v);
  return s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;
};
const uniq = <T,>(list: T[]) => Array.from(new Set(list));
const DISPOSAL_OR_REP = ["Lease Disposal", "Sub-Letting", "Lease Acquisition", "Tenant Acquisition"];

interface Ev {
  companyId: string;
  propertyId: string;
  unitKey: string;                 // spine id, au:<tracker>, lsu:<id>, wish:<id> or "none"
  spine: string | null;
  trackerId: string | null;
  trackerDealId: string | null;
  dealId: string | null;           // the brand's own deal, when the record is a deal
  e: StageEvidence;
  x: any;
}

interface UnitInfo {
  label: string; sqft: number | null; occupier: string | null; leaseExpiry: string | null; trackerId: string | null; trackerDealId: string | null;
}

interface PropertyInfo { name: string; text: string }

export interface PlanInput {
  brandIds: string[] | null;       // one brand's page
  propertyIds: string[] | null;    // the grid: the scheme properties
  schemes: PlanScheme[];
  viewer: PlanViewer;
  nameMatches?: boolean;           // one brand, staff only
  alsoBrandIds?: string[];         // brands to read requirements and actions for even with no line
  now?: Date;
}

export interface PlanData {
  rowsByBrand: Map<string, PlanRow[]>;
  otherSchemes: Map<string, Set<string>>;       // per brand: schemes with lines outside the viewer's own
  requirements: Map<string, any[]>;             // live requirements per brand (raw rows)
  actions: Map<string, any[]>;                  // open CRM actions per brand (staff only)
  caseStatus: Map<string, string>;              // brand → its brand case status
  warnings: string[];
}

const isStaff = (v: PlanViewer) => v.kind === "staff";
const isRestricted = (v: PlanViewer) => v.kind === "asset_manager" || v.kind === "joint_agent";

// Requirement detail follows the Requirements page rule for client logins
// (server/crm.ts): PIPnet listings and the client's own.
export function requirementDetailHidden(req: any, viewer: PlanViewer): boolean {
  if (isStaff(viewer)) return false;
  if (viewer.kind === "joint_agent") return true;
  return !(req.company_id === viewer.clientCompanyId || (Array.isArray(req.sources) && req.sources.includes("PIPnet")));
}

function requirementSummary(req: any): string {
  const list = (v: any) => (Array.isArray(v) ? v : v ? [v] : []).map((x: any) => String(x).trim()).filter(Boolean).join(", ");
  // The size goes through the one size rule (shared/format-size.ts): joined
  // as a plain list, a size split at its thousands commas read "5, 000 - 10, 000 sq ft".
  return [formatSizeList(req.size), list(req.use), list(req.requirement_locations)].filter(Boolean).join(" · ") || String(req.name || "Requirement");
}

/** Every line of the plan for the brands or properties asked for, already cut to what the viewer may see. */
export async function loadPlan(q: Queryable, input: PlanInput): Promise<PlanData> {
  const { viewer, schemes } = input;
  const now = input.now || new Date();
  const staff = isStaff(viewer);
  const warnings: string[] = [];
  const brandIds = input.brandIds && input.brandIds.length ? input.brandIds : null;
  // A client viewer never reads beyond the scheme registry, whatever was asked for.
  const schemeProps = uniq(schemes.flatMap(s => s.propertyIds));
  const propertyIds = staff ? input.propertyIds : schemeProps;
  if (!brandIds && !propertyIds) throw new Error("A brand or a set of properties is needed");
  const params = [brandIds, propertyIds];

  const guarded = async <T,>(label: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await run(); }
    catch (e: any) {
      warnings.push(`${label} could not be read and are left out of this view.`);
      console.warn(`[brand-plan] ${label}: ${e?.message}`);
      return fallback;
    }
  };

  const schemeOfProperty = new Map<string, PlanScheme>();
  for (const s of schemes) for (const id of s.propertyIds) schemeOfProperty.set(id, s);

  // 1. The linked evidence. Units sent to a brand are BGP's own record; the
  //    table is newer than the rest, so its absence costs that one source.
  let raw: any[];
  if (staff) {
    try { raw = await runEvidence(q, evidenceSql([...CORE_BRANCHES, SHARE_BRANCH]), params); }
    catch (e: any) {
      if (e?.code !== "42P01" && !/unit_shares/.test(String(e?.message))) throw e;
      warnings.push("Units sent to brands could not be read and are left out of this view.");
      raw = await runEvidence(q, evidenceSql(CORE_BRANCHES), params);
    }
  } else {
    raw = await runEvidence(q, evidenceSql(CORE_BRANCHES), params);
  }

  // 2. Name-only matches: one brand, BGP only, never in the grid.
  if (staff && input.nameMatches && brandIds?.length === 1) {
    const names = await guarded("Target lists that name the brand without a link", async () => {
      const keys = (await q.query(
        `/* brand-plan:name-keys */ SELECT DISTINCT k FROM (
           SELECT ${nameKeySql("c.name")} AS k FROM crm_companies c WHERE c.id = $1
           UNION SELECT ${nameKeySql("entity->>'name'")} FROM crm_companies c,
             jsonb_array_elements(CASE WHEN jsonb_typeof(c.trading_entities) = 'array' THEN c.trading_entities ELSE '[]'::jsonb END) AS entity
            WHERE c.id = $1 AND entity->>'name' IS NOT NULL) x WHERE length(k) >= 3`, [brandIds[0]])).rows.map((r: any) => r.k);
      if (keys.length === 0) return [];
      return runEvidence(q, evidenceSql(NAME_BRANCHES, "name-matches"), [brandIds, propertyIds, keys]);
    }, [] as any[]);
    raw.push(...names);
  }

  // 3. Side records, each guarded so one missing table cannot take the plan down.
  const offerTrackers = uniq(raw.filter(r => r.src === "offer" && r.tracker_id).map(r => r.tracker_id as string));
  const offerIds = uniq(raw.filter(r => r.src === "offer" && r.x?.offerId).map(r => r.x.offerId as string));
  const [hotsRows, roundRows, caseRows, wishRows] = await Promise.all([
    offerTrackers.length === 0 ? [] : guarded("Heads of terms", async () => (await q.query(
      `/* brand-plan:hots */ SELECT id, hots_offer_id, ${iso("hots_issued_at")} AS hots_issued_at, ${iso("hots_final_at")} AS hots_final_at
         FROM available_units WHERE id = ANY($1)`, [offerTrackers])).rows, [] as any[]),
    offerIds.length === 0 ? [] : guarded("Offer rounds", async () => (await q.query(
      `/* brand-plan:rounds */ SELECT DISTINCT ON (offer_id) offer_id, party, round_date, round_no
         FROM unit_offer_rounds WHERE offer_id = ANY($1) ORDER BY offer_id, round_no DESC`, [offerIds])).rows, [] as any[]),
    // Brand cases are BGP's brand work: never for a joint agent.
    viewer.kind === "joint_agent" ? [] : guarded("Landsec brand cases", async () => (await q.query(
      `/* brand-plan:case-units */ SELECT bc.company_id, bc.status AS case_status, ${iso("COALESCE(bc.sent_at, bc.updated_at, bc.created_at)")} AS at, pu
         FROM landsec_brand_cases bc
         LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(bc.proposed_units) = 'array' THEN bc.proposed_units ELSE '[]'::jsonb END) pu ON TRUE
        WHERE ($1::text[] IS NULL OR bc.company_id = ANY($1))`, [brandIds])).rows, [] as any[]),
    guarded("Wanted lines", async () => (await q.query(
      `/* brand-plan:wishes */ SELECT w.id, w.company_id, w.property_id, w.tenancy_unit_id, w.unit_label, w.note, w.requirement_id, w.visible_to_client,
              ${iso("w.ruled_out_at")} AS ruled_out_at, w.ruled_out_reason, w.created_by, w.created_by_name, ${iso("w.created_at")} AS created_at
         FROM brand_scheme_targets w
        WHERE ${BRANDS("w.company_id")} AND ${PROPS("w.property_id")}`, params)).rows, [] as any[]),
  ]);
  const hotsByTracker = new Map<string, any>(hotsRows.map((r: any) => [r.id, r]));
  const roundByOffer = new Map<string, any>(roundRows.map((r: any) => [r.offer_id, r]));

  // 4. Every record as one evidence item at a unit.
  const evs: Ev[] = [];
  const units = new Map<string, UnitInfo>();           // by unit key
  const properties = new Map<string, PropertyInfo>();
  // A record that cannot be walked to the tenancy schedule keeps its own key
  // (and the line says so) rather than being merged on a guess.
  const unitKeyOf = (r: any): string => r.spine ? String(r.spine) : r.tracker_id ? `au:${r.tracker_id}` : r.lsu_id ? `lsu:${r.lsu_id}` : "none";
  const agreedBrandByDeal = new Map<string, string>(); // the unit's deal → the brand whose offer is agreed

  for (const r of raw) {
    if (!r.company_id || !r.property_id) continue;     // nothing to place it at
    const unitKey = unitKeyOf(r);
    const x = r.x || {};
    if (!properties.has(r.property_id)) {
      properties.set(r.property_id, { name: r.property_name || "Property", text: [r.property_name, r.property_address, r.property_postcode].filter(Boolean).join(" ") });
    }
    if (unitKey !== "none") {
      const known = units.get(unitKey);
      units.set(unitKey, {
        label: known?.label || r.premises || r.unit_number || r.tracker_unit || r.lsu_unit || "Unit",
        sqft: known?.sqft ?? (r.sqft != null && Number(r.sqft) > 0 ? Number(r.sqft) : null),
        occupier: known?.occupier ?? r.occupier ?? null,
        leaseExpiry: known?.leaseExpiry ?? isoDay(r.lease_expiry),
        trackerId: known?.trackerId ?? r.tracker_id ?? null,
        trackerDealId: known?.trackerDealId ?? r.tracker_deal_id ?? null,
      });
    }
    const base = { companyId: String(r.company_id), propertyId: String(r.property_id), unitKey, spine: r.spine || null, trackerId: r.tracker_id || null, trackerDealId: r.tracker_deal_id || null, x };
    const push = (e: StageEvidence, dealId: string | null = null) => evs.push({ ...base, dealId, e });
    switch (r.src) {
      case "trading":
        push({ src: "trading", status: r.st, at: textDate(r.at) });
        break;
      case "deal": {
        const code = legacyToCode(r.st);
        const closedAt = code && ["EXC", "COM", "INV"].includes(code) ? (x.completedAt || x.exchangedAt) : null;
        push({ src: "deal", status: r.st, dealType: x.dealType, dealRef: x.ref, at: closedAt || textDate(r.at), refId: r.deal_id }, r.deal_id);
        break;
      }
      case "offer": {
        const round = roundByOffer.get(x.offerId);
        const moved = round ? `${round.party === "landlord" ? "landlord countered" : "tenant offered"}${shortDate(round.round_date) ? ` ${shortDate(round.round_date)}` : ""}` : null;
        const st = String(r.st || "").trim().toLowerCase();
        const open = !["closed", "rejected", "withdrawn"].includes(st);
        push({ src: "offer", status: r.st, at: textDate(r.at) || x.createdAt || null, detail: open && Number(round?.round_no) > 1 ? moved : null, refId: x.offerId });
        if (!open) break;
        const agreed = isAgreedOfferStatus(r.st);
        if (agreed && r.tracker_deal_id) agreedBrandByDeal.set(r.tracker_deal_id, base.companyId);
        // Issuing heads of terms moves the unit to HOTs before the deal names
        // its tenant: until then the brand is named only by the offer.
        const h = r.tracker_id ? hotsByTracker.get(r.tracker_id) : null;
        if (h?.hots_issued_at && (h.hots_offer_id ? h.hots_offer_id === x.offerId : agreed)) {
          push({ src: "hots", status: h.hots_final_at ? "final" : "issued", at: h.hots_issued_at, refId: x.offerId });
        }
        break;
      }
      case "viewing":
        push({ src: "viewing", status: r.st, at: textDate(r.at), refId: x.viewingId });
        break;
      case "interest":
        push({ src: "interest", at: textDate(r.at) });
        break;
      case "share":
        push({ src: "share", status: r.st, at: r.at, internal: true });
        break;
      case "tracker_target":
        push({ src: "tracker_target", status: r.st, at: r.at });
        break;
      case "schedule_target":
        push({ src: "schedule_target", status: r.st, outcome: x.outcome, at: r.at });
        break;
      case "target_list":
        push({ src: "target_list" });
        break;
      case "name_match":
        push({ src: "name_match", at: r.at, detail: x.via ? `in ${x.via}` : null, byName: true, internal: true });
        break;
    }
  }

  // Wanted lines and brand case units name a tenancy unit by id (or no unit).
  const pinnedUnitIds = uniq([
    ...wishRows.map((w: any) => w.tenancy_unit_id),
    ...caseRows.map((c: any) => c.pu?.tenancyUnitId),
  ].filter((id): id is string => !!id && !units.has(id)));
  const pinnedUnits = pinnedUnitIds.length === 0 ? [] : await guarded("Units named on Wanted lines and brand cases", async () => (await q.query(
    `/* brand-plan:pinned-units */ SELECT t.id, t.property_id, t.premises, t.unit_number, t.tenant_name, t.lease_expiry::text AS lease_expiry,
            COALESCE(t.nia_sqft, t.gia_sqft) AS sqft,
            (SELECT au.id FROM available_units au WHERE au.tenancy_unit_id = t.id ORDER BY au.updated_at DESC NULLS LAST LIMIT 1) AS tracker_id,
            (SELECT au.deal_id FROM available_units au WHERE au.tenancy_unit_id = t.id ORDER BY au.updated_at DESC NULLS LAST LIMIT 1) AS tracker_deal_id
       FROM tenancy_schedule_units t WHERE t.id = ANY($1)`, [pinnedUnitIds])).rows, [] as any[]);
  const pinnedProperty = new Map<string, string>();
  for (const t of pinnedUnits) {
    pinnedProperty.set(t.id, t.property_id);
    units.set(t.id, {
      label: t.premises || t.unit_number || "Unit", sqft: t.sqft != null && Number(t.sqft) > 0 ? Number(t.sqft) : null, occupier: t.tenant_name || null,
      leaseExpiry: isoDay(t.lease_expiry), trackerId: t.tracker_id || null, trackerDealId: t.tracker_deal_id || null,
    });
  }
  const wishById = new Map<string, any>();
  const linkedRequirements = new Map<string, Set<string>>();   // row key → requirement ids pinned by a viewing or a Wanted line
  const caseStatus = new Map<string, string>();
  const schemeByKey = new Map(schemes.map(s => [s.key, s]));

  for (const w of wishRows) {
    const unitKey = w.tenancy_unit_id ? String(w.tenancy_unit_id) : w.unit_label ? `wish:${w.id}` : "none";
    if (unitKey.startsWith("wish:")) units.set(unitKey, { label: String(w.unit_label), sqft: null, occupier: null, leaseExpiry: null, trackerId: null, trackerDealId: null });
    const info = units.get(unitKey);
    wishById.set(w.id, w);
    evs.push({
      companyId: w.company_id, propertyId: w.property_id, unitKey, spine: w.tenancy_unit_id || null, trackerId: info?.trackerId || null, trackerDealId: info?.trackerDealId || null,
      dealId: null, x: { wishId: w.id, requirementId: w.requirement_id, createdBy: w.created_by, createdByName: w.created_by_name },
      // The reason is BGP's own typed words: a joint agent gets a fixed line.
      e: { src: "wish", hasUnit: unitKey !== "none", ruledOut: !!w.ruled_out_at, reason: viewer.kind === "joint_agent" ? "Ruled out by BGP" : w.ruled_out_reason, at: w.ruled_out_at || w.created_at, internal: !w.visible_to_client, refId: w.id },
    });
  }
  for (const c of caseRows) {
    if (c.case_status) caseStatus.set(c.company_id, c.case_status);
    const pu = c.pu;
    const scheme = pu?.schemeKey ? schemeByKey.get(String(pu.schemeKey)) : null;
    if (!pu || !scheme) continue;
    const unitId = pu.tenancyUnitId ? String(pu.tenancyUnitId) : null;
    const propertyId = (unitId && (pinnedProperty.get(unitId) || evs.find(x => x.spine === unitId)?.propertyId)) || scheme.canonicalId;
    if (!propertyId) continue;
    const info = unitId ? units.get(unitId) : null;
    evs.push({
      companyId: c.company_id, propertyId, unitKey: unitId || "none", spine: unitId, trackerId: info?.trackerId || null, trackerDealId: info?.trackerDealId || null,
      dealId: null, x: {},
      e: { src: "case_unit", status: pu.status, hasUnit: !!unitId, at: c.at, detail: !unitId && pu.unitLabel ? String(pu.unitLabel) : null, internal: c.case_status !== "sent" },
    });
  }

  const unnamed = uniq(evs.map(ev => ev.propertyId).filter(id => !properties.has(id)));
  if (unnamed.length) {
    const rows = await guarded("Property names", async () => (await q.query(
      `/* brand-plan:properties */ SELECT id, name, address::text AS address, postcode FROM crm_properties WHERE id = ANY($1)`, [unnamed])).rows, [] as any[]);
    for (const p of rows) properties.set(p.id, { name: p.name || "Property", text: [p.name, p.address, p.postcode].filter(Boolean).join(" ") });
  }

  // 5. What the viewer may not see is removed BEFORE any stage is worked
  //    out, so a client's stage never reflects a record it cannot see.
  const visible = evs.filter(ev => {
    if (staff) return true;
    if (ev.e.internal) return false;
    return schemeOfProperty.has(ev.propertyId);
  });

  // 6. The unit's lettings, for the two corrections (shared/brand-stage.ts).
  const spines = uniq(visible.map(ev => ev.spine).filter((s): s is string => !!s));
  const trackerDeals = uniq(visible.map(ev => ev.trackerDealId).filter((s): s is string => !!s));
  const unitDeals = spines.length + trackerDeals.length === 0 ? [] : await guarded("The units' lettings", async () => (await q.query(
    `/* brand-plan:unit-deals */ SELECT d.id, d.tenant_id, d.status, d.deal_type, d.deal_ref, d.tenancy_unit_id, d.internal_agent, d.internal_agent_ids,
            ${iso("COALESCE(d.completed_at, d.exchanged_at, d.stage_entered_at, d.updated_at)")} AS closed_at,
            ${iso("COALESCE(d.stage_entered_at, d.updated_at, d.created_at)")} AS stage_at
       FROM crm_deals d WHERE d.tenancy_unit_id = ANY($1) OR d.id = ANY($2)`, [spines, trackerDeals])).rows, [] as any[]);
  const dealById = new Map<string, any>(unitDeals.map((d: any) => [d.id, d]));
  const dealsOfUnit = new Map<string, any[]>();
  const addDeal = (unitKey: string, d: any) => {
    const list = dealsOfUnit.get(unitKey) || [];
    if (!list.includes(d)) list.push(d);
    dealsOfUnit.set(unitKey, list);
  };
  for (const d of unitDeals) if (d.tenancy_unit_id && units.has(d.tenancy_unit_id)) addDeal(d.tenancy_unit_id, d);
  for (const ev of visible) if (ev.trackerDealId && dealById.has(ev.trackerDealId) && ev.unitKey !== "none") addDeal(ev.unitKey, dealById.get(ev.trackerDealId));
  const tenantOf = (d: any): string | null => d.tenant_id || agreedBrandByDeal.get(d.id) || null;
  const lettingsOf = (unitKey: string) => (dealsOfUnit.get(unitKey) || []).filter((d: any) => {
    const type = String(d.deal_type || "").trim();
    return !DISPOSAL_OR_REP.includes(type) && (!type || isLettingType(type));
  });

  // 7. Group into lines and read the stage of each.
  type Group = { companyId: string; scheme: PlanScheme | null; propertyId: string; unitKey: string; evs: Ev[] };
  const groups = new Map<string, Group>();
  for (const ev of visible) {
    const scheme = schemeOfProperty.get(ev.propertyId) || null;
    const k = `${ev.companyId}|${scheme ? scheme.key : ev.propertyId}|${ev.unitKey}`;
    const g = groups.get(k) || { companyId: ev.companyId, scheme, propertyId: scheme?.canonicalId || ev.propertyId, unitKey: ev.unitKey, evs: [] };
    g.evs.push(ev);
    groups.set(k, g);
  }

  // An agreed offer on a unit whose deal names no tenant yet: the deal's
  // stage is the brand's (one agreed offer per unit).
  for (const g of groups.values()) {
    if (g.unitKey === "none") continue;
    const info = units.get(g.unitKey);
    const d = info?.trackerDealId ? dealById.get(info.trackerDealId) : null;
    if (!d || d.tenant_id || agreedBrandByDeal.get(d.id) !== g.companyId) continue;
    const code = legacyToCode(d.status);
    if (!code || !["HOT", "SOL", "EXC", "COM", "INV"].includes(code)) continue;
    const closed = ["EXC", "COM", "INV"].includes(code);
    g.evs.push({
      companyId: g.companyId, propertyId: g.propertyId, unitKey: g.unitKey, spine: g.evs[0].spine, trackerId: info!.trackerId, trackerDealId: d.id, dealId: d.id, x: { agent: d.internal_agent, agentIds: d.internal_agent_ids },
      e: { src: "deal", status: d.status, dealType: d.deal_type, dealRef: d.deal_ref, at: closed ? d.closed_at : d.stage_at, detail: "tenant taken from the agreed offer", refId: d.id },
    });
  }

  // Side records for the lines: deal clocks, requirements, actions, names.
  const dealIds = uniq(Array.from(groups.values()).flatMap(g => [...g.evs.map(ev => ev.dealId), units.get(g.unitKey)?.trackerDealId]).filter((id): id is string => !!id));
  const groupBrandIds = uniq(Array.from(groups.values()).map(g => g.companyId));
  const requirementBrandIds = brandIds || uniq([...groupBrandIds, ...(input.alsoBrandIds || [])]);
  const [clockRows, requirementRows, actionRows] = await Promise.all([
    dealIds.length === 0 ? [] : guarded("Deal clocks", async () => (await q.query(
      `/* brand-plan:clocks */ SELECT deal_id, waiting_on_party, waiting_on_name, ${iso("waiting_since")} AS waiting_since FROM landsec_deal_clock
        WHERE deal_id = ANY($1) AND waiting_on_party IS NOT NULL`, [dealIds])).rows, [] as any[]),
    requirementBrandIds.length === 0 ? [] : guarded("Requirements", async () => (await q.query(
      `/* brand-plan:requirements */ SELECT id, company_id, name, size, use, requirement_locations, status, sources, deal_id,
              ${iso("COALESCE(updated_at, created_at)")} AS at
         FROM crm_requirements_leasing WHERE company_id = ANY($1) AND (status IS NULL OR status = 'Active')
        ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST`, [requirementBrandIds])).rows, [] as any[]),
    // The scheme, unit and share columns are read through to_jsonb so the
    // query holds before they exist.
    requirementBrandIds.length === 0 ? [] : guarded("CRM actions", async () => (await q.query(
      `/* brand-plan:actions */ SELECT l.company_id, to_jsonb(l) AS link, t.id, t.title, ${iso("t.due_date")} AS due_at, t.status, u.name AS owner_name,
              ab.role AS raised_by_role
         FROM crm_engagement_actions l JOIN user_tasks t ON t.id = l.task_id LEFT JOIN users u ON u.id = t.user_id
         LEFT JOIN users ab ON ab.id = t.assigned_by_user_id
        WHERE l.company_id = ANY($1) AND COALESCE(t.status, '') <> 'done'
        ORDER BY t.due_date ASC NULLS LAST, t.created_at`, [requirementBrandIds])).rows, [] as any[]),
  ]);
  const clockByDeal = new Map<string, any>(clockRows.map((c: any) => [c.deal_id, c]));
  const requirements = new Map<string, any[]>();
  for (const r of requirementRows) requirements.set(r.company_id, [...(requirements.get(r.company_id) || []), r]);
  // An action reaches a client only when BGP raised it and its share marker
  // names that client's company; an asset manager or joint agent only when
  // it also sits at one of their own schemes. What arrives is the title, the
  // due date and the owner's name on that line, never the notes.
  const ownSchemeProperties = new Set(schemes.filter(s => viewer.schemes?.has(s.key)).flatMap(s => s.propertyIds));
  const actions = new Map<string, any[]>();
  for (const a of actionRows) {
    if (!staff) {
      if (!viewer.clientCompanyId || a.link?.shared_with_company_id !== viewer.clientCompanyId) continue;
      if (String(a.raised_by_role || "").toLowerCase() === "client") continue;
      if (isRestricted(viewer) && !ownSchemeProperties.has(a.link?.property_id)) continue;
    }
    actions.set(a.company_id, [...(actions.get(a.company_id) || []), a]);
  }
  const userIds = uniq(Array.from(groups.values()).flatMap(g => g.evs.flatMap(ev => [...(Array.isArray(ev.x?.agentIds) ? ev.x.agentIds : []), ev.x?.ownerId, ev.x?.createdBy])).filter((id): id is string => !!id));
  const userRows = userIds.length === 0 ? [] : await guarded("People's names", async () => (await q.query(`/* brand-plan:users */ SELECT id, name FROM users WHERE id = ANY($1)`, [userIds])).rows, [] as any[]);
  const userName = new Map<string, string>(userRows.map((u: any) => [u.id, u.name]));
  const brandRows = groupBrandIds.length === 0 ? [] : await guarded("Brand names", async () => (await q.query(`/* brand-plan:brand-names */ SELECT id, name FROM crm_companies WHERE id = ANY($1)`, [groupBrandIds])).rows, [] as any[]);
  const brandName = new Map<string, string>(brandRows.map((b: any) => [b.id, b.name]));

  const today = now.toISOString().slice(0, 10);
  const restricted = isRestricted(viewer);
  const rowsByBrand = new Map<string, PlanRow[]>();
  const otherSchemes = new Map<string, Set<string>>();

  for (const [key, g] of groups) {
    const info = g.unitKey === "none" ? null : units.get(g.unitKey) || null;
    const lettings = info ? lettingsOf(g.unitKey) : [];
    const closed = lettings.map((d: any) => ({ d, code: legacyToCode(d.status) })).filter(x => x.code && ["EXC", "COM", "INV"].includes(x.code))
      .sort((a, b) => String(b.d.closed_at || "").localeCompare(String(a.d.closed_at || "")))[0]?.d;
    const liveDeal = lettings.map((d: any) => ({ d, code: legacyToCode(d.status) })).filter(x => x.code && ["NEG", "HOT", "SOL"].includes(x.code))
      .sort((a, b) => String(b.d.stage_at || "").localeCompare(String(a.d.stage_at || "")))[0]?.d;
    const ctx: UnitLettingContext = {
      brandId: g.companyId,
      lastClosedLetting: closed ? { at: closed.closed_at || null, tenantId: tenantOf(closed) } : null,
      liveDealTenantId: liveDeal ? tenantOf(liveDeal) : null,
    };
    const result = resolveStage(g.evs.map(ev => ev.e), ctx);
    if (!result) continue;

    const scheme = g.scheme;
    // Own schemes only for an asset manager or joint agent; the rest are counted.
    if (restricted && !(scheme && viewer.schemes?.has(scheme.key))) {
      if (scheme && result.stage !== "not_proceeding") otherSchemes.set(g.companyId, (otherSchemes.get(g.companyId) || new Set<string>()).add(scheme.key));
      continue;
    }

    const property = properties.get(g.propertyId) || properties.get(g.evs[0].propertyId);
    const ownDeals = g.evs.filter(ev => ev.e.src === "deal" && ev.dealId);
    const liveOwn = ownDeals.find(ev => { const c = legacyToCode(ev.e.status); return !!c && !["WIT", "ARCH", "EXC", "COM", "INV"].includes(c); }) || ownDeals[0];
    const dealId = liveOwn?.dealId || info?.trackerDealId || null;
    const trackerId = info?.trackerId || null;
    const tenancyUnitId = g.unitKey !== "none" && !/^(au|lsu|wish):/.test(g.unitKey) ? g.unitKey : null;

    // Requirement chip: the brand's live requirements against this place.
    const reqs = requirements.get(g.companyId) || [];
    const linked = uniq(g.evs.map(ev => ev.x?.requirementId).filter((id): id is string => !!id));
    const chipReqs: ChipRequirement[] = reqs.map((r: any) => ({ id: r.id, size: r.size, locations: r.requirement_locations, dealId: r.deal_id }));
    const chip = requirementChip(chipReqs, {
      regions: scheme ? scheme.regions : null,
      text: [scheme?.name, scheme?.town, property?.text].filter(Boolean).join(" "),
      sqft: info?.sqft ?? null, dealId, linkedRequirementIds: linked,
    });
    const chipReq = chip.requirementId ? reqs.find((r: any) => r.id === chip.requirementId) : null;
    if (chipReq && requirementDetailHidden(chipReq, viewer)) { chip.requirementId = null; chip.range = null; }

    // Next step: the earliest dated thing first, else whoever the deal waits on.
    const dated: NonNullable<PlanRow["nextStep"]>[] = [];
    for (const ev of g.evs) {
      if (ev.e.src !== "viewing") continue;
      const st = String(ev.e.status || "").toLowerCase();
      const day = isoDay(ev.e.at);
      const who = ev.x?.ownerId ? userName.get(ev.x.ownerId) || null : null;
      if (st === "scheduled" && day && day >= today) dated.push({ kind: "viewing_booked", title: "Viewing booked", dueAt: day, daysWaiting: null, who, refId: String(ev.x?.viewingId || "") });
      const follow = isoDay(ev.x?.followUp);
      // What the agent typed as the next action is BGP's own note.
      if (follow) dated.push({ kind: "viewing_followup", title: staff && ev.x?.nextAction ? String(ev.x.nextAction) : "Follow up the viewing", dueAt: follow, daysWaiting: null, who, refId: String(ev.x?.viewingId || "") });
    }
    for (const a of actions.get(g.companyId) || []) {
      const place = a.link || {};
      const onUnit = place.tenancy_unit_id && place.tenancy_unit_id === tenancyUnitId;
      const onScheme = !place.tenancy_unit_id && place.property_id && (scheme ? scheme.propertyIds.includes(place.property_id) : place.property_id === g.propertyId);
      if (onUnit || onScheme) dated.push({ kind: "action", title: String(a.title || "Action"), dueAt: a.due_at || null, daysWaiting: null, who: a.owner_name || null, refId: a.id });
    }
    const upcoming = dated.filter(s => s.dueAt && s.dueAt.slice(0, 10) >= today).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
    const overdue = dated.filter(s => s.dueAt && s.dueAt.slice(0, 10) < today).sort((a, b) => String(b.dueAt).localeCompare(String(a.dueAt)));
    const clock = dealId ? clockByDeal.get(dealId) : null;
    const live = !["not_proceeding", "trading"].includes(result.stage);
    const nextStep: PlanRow["nextStep"] = !live ? null
      : upcoming[0] || overdue[0] || dated[0]
      || (clock ? { kind: "deal_waiting" as const, title: `Waiting on ${clock.waiting_on_party}`, dueAt: null, daysWaiting: daysSince(clock.waiting_since, now), who: viewer.kind === "joint_agent" ? null : clock.waiting_on_name || null, refId: dealId! } : null);

    // Owner: the deal's agent, else the target's, else the viewing's, else whoever wrote the Wanted line.
    const firstUser = (ids: any): { id: string; name: string | null } | null => {
      const id = (Array.isArray(ids) ? ids : []).find((x: any) => !!x);
      return id ? { id, name: userName.get(id) || null } : null;
    };
    let owner: PlanRow["owner"] = null;
    const dealEv = liveOwn || g.evs.find(ev => ev.e.src === "deal");
    const dealAgent = dealEv && (firstUser(dealEv.x?.agentIds) || (Array.isArray(dealEv.x?.agent) && dealEv.x.agent[0] ? { id: null, name: String(dealEv.x.agent[0]) } : null));
    const targetEv = g.evs.find(ev => ev.e.src === "tracker_target" && firstUser(ev.x?.agentIds));
    const viewingEv = g.evs.find(ev => ev.e.src === "viewing" && ev.x?.ownerId);
    const wishEv = g.evs.find(ev => ev.e.src === "wish");
    if (dealAgent) owner = { ...dealAgent, source: "deal" };
    else if (targetEv) owner = { ...firstUser(targetEv.x.agentIds)!, source: "target" };
    else if (viewingEv) owner = { id: viewingEv.x.ownerId, name: userName.get(viewingEv.x.ownerId) || null, source: "viewing" };
    else if (wishEv && (wishEv.x?.createdBy || wishEv.x?.createdByName)) owner = { id: wishEv.x.createdBy || null, name: wishEv.x.createdByName || userName.get(wishEv.x.createdBy) || null, source: "wish" };

    const w = wishEv ? wishById.get(wishEv.x.wishId) : null;
    const wishReq = w?.requirement_id ? reqs.find((r: any) => r.id === w.requirement_id) : null;
    const inScheme = !!scheme;
    const canOpenRecords = !restricted;      // an asset manager or joint agent has no tracker, deal or property pages
    const hasCase = caseStatus.has(g.companyId) && (staff || caseStatus.get(g.companyId) === "sent") && viewer.kind !== "joint_agent";
    const row: PlanRow = {
      key,
      companyId: g.companyId,
      brandName: brandName.get(g.companyId) || "Brand",
      scheme: scheme
        ? { key: scheme.key, name: scheme.name, group: scheme.group, propertyId: scheme.canonicalId }
        : { key: null, name: property?.name || "Property", group: null, propertyId: g.propertyId },
      unit: info ? {
        key: g.unitKey, tenancyUnitId, trackerId, label: info.label, sqft: info.sqft, occupier: info.occupier, leaseExpiry: info.leaseExpiry, splitKey: !tenancyUnitId,
      } : null,
      stage: result.stage,
      stageLabel: BRAND_STAGE_LABELS[result.stage],
      stageSince: result.stageSince,
      daysAtStage: daysSince(result.stageSince, now),
      evidence: result.evidence,
      notes: result.notes,
      notProceedingReason: result.notProceedingReason,
      requirement: chip,
      nextStep,
      owner,
      links: {
        tracker: canOpenRecords && trackerId ? `/available?propertyId=${encodeURIComponent(g.evs[0].propertyId)}&unitId=${encodeURIComponent(trackerId)}` : null,
        deal: canOpenRecords && dealId ? `/deals/${dealId}` : null,
        unitPage: inScheme && tenancyUnitId ? `/landsec/unit/${tenancyUnitId}` : null,
        property: canOpenRecords ? `/properties/${g.evs[0].propertyId}` : null,
        scheme: inScheme ? `/landsec/scheme/${scheme!.key}` : null,
        brandCase: hasCase ? `/landsec/brand-case/${g.companyId}` : null,
      },
      // The note on a Wanted line is BGP's own: staff only.
      wish: w ? {
        id: w.id, note: staff ? w.note || null : null, visibleToClient: !!w.visible_to_client, ruledOut: !!w.ruled_out_at, createdByName: w.created_by_name || null,
        requirementId: wishReq && !requirementDetailHidden(wishReq, viewer) ? w.requirement_id : staff ? w.requirement_id || null : null,
      } : null,
    };
    rowsByBrand.set(g.companyId, [...(rowsByBrand.get(g.companyId) || []), row]);
  }

  const groupOrder = (r: PlanRow) => `${r.scheme.group || "~"}|${r.scheme.name}`;
  for (const rows of rowsByBrand.values()) {
    rows.sort((a, b) => groupOrder(a).localeCompare(groupOrder(b)) || (brandStageRank(b.stage) - brandStageRank(a.stage)) || String(a.unit?.label || "").localeCompare(String(b.unit?.label || "")));
  }
  return { rowsByBrand, otherSchemes, requirements, actions, caseStatus, warnings };
}

// A joint agent holds no brand ids: its lines carry the brand's name only.
function withoutCompany(row: PlanRow, token: string): PlanRow {
  return { ...row, key: [token, ...row.key.split("|").slice(1)].join("|"), companyId: null, links: { ...row.links, brandCase: null } };
}

const nextActionOf = (list: any[] | undefined) => {
  const a = (list || [])[0];
  return a ? { id: a.id, title: String(a.title || "Action"), dueAt: a.due_at || null, ownerName: a.owner_name || null } : null;
};

/** One brand's plan. The caller has already checked the viewer may see the brand. */
export async function brandPlan(q: Queryable, companyId: string, viewer: PlanViewer, schemes: PlanScheme[], now: Date = new Date()): Promise<BrandPlan | null> {
  const brand = (await q.query(
    `/* brand-plan:brand */ SELECT c.id, c.name, c.logo_url, c.concept_status, c.bgp_contact_user_ids FROM crm_companies c WHERE c.id = $1`, [companyId])).rows[0];
  if (!brand) return null;
  const staff = isStaff(viewer);
  const data = await loadPlan(q, { brandIds: [companyId], propertyIds: null, schemes, viewer, nameMatches: staff, now });
  const jointAgent = viewer.kind === "joint_agent";
  const all = (data.rowsByBrand.get(companyId) || []).map(r => (jointAgent ? withoutCompany(r, "b1") : r));
  const rows = all.filter(r => r.stage !== "not_proceeding");
  const notProceeding = all.filter(r => r.stage === "not_proceeding");
  const reqs = data.requirements.get(companyId) || [];
  const seen = reqs.filter(r => !requirementDetailHidden(r, viewer));
  // A scheme with a line, live or not proceeding, is not "no target yet".
  const withRows = new Set(all.map(r => r.scheme.key).filter((k): k is string => !!k));
  const noRecord = new Set(schemes.filter(s => !s.canonicalId).map(s => s.key));
  const ownSchemes = schemes.filter(s => !viewer.schemes || viewer.schemes.has(s.key));
  const plan: BrandPlan = {
    brand: {
      id: jointAgent ? null : brand.id, name: brand.name, logoUrl: brand.logo_url || null,
      headline: planHeadline(rows.map(r => ({ stage: r.stage, schemeId: r.scheme.key || r.scheme.propertyId || r.key }))),
    },
    requirements: reqs.map((r: any, i: number) => {
      const hidden = requirementDetailHidden(r, viewer);
      return {
        id: hidden ? `held-${i + 1}` : r.id, summary: hidden ? "Requirement held" : requirementSummary(r), ageDays: hidden ? null : daysSince(r.at, now),
        source: hidden ? null : (Array.isArray(r.sources) && r.sources.length ? r.sources.join(", ") : null), detailHidden: hidden,
      };
    }),
    rows, notProceeding,
    // Places come from requirement detail, so only from the ones the viewer may read.
    askedNoTarget: askedNoTarget(
      seen.map((r: any) => ({ id: r.id, size: r.size, locations: r.requirement_locations })),
      ownSchemes.map(s => ({ key: s.key, name: s.name, regions: s.regions, text: `${s.name} ${s.town}` })),
      withRows).map(asked => ({ ...asked, schemes: asked.schemes.map(sc => (staff && noRecord.has(sc.key) ? { ...sc, noProperty: true as const } : sc)) })),
    canEdit: staff,
    warnings: data.warnings,
  };
  if (isRestricted(viewer)) plan.otherSchemeCount = data.otherSchemes.get(companyId)?.size || 0;
  if (staff) {
    // BGP's own header: on hold, the lead, the aim and the next action.
    plan.brand.onHold = isOnHold(brand.concept_status);
    const leadId = (Array.isArray(brand.bgp_contact_user_ids) ? brand.bgp_contact_user_ids : []).find((x: any) => !!x);
    const [lead, aim] = await Promise.all([
      leadId ? q.query(`/* brand-plan:lead */ SELECT id, name FROM users WHERE id = $1`, [leadId]).then(r => r.rows[0] || null).catch(() => null) : null,
      q.query(`/* brand-plan:aim */ SELECT st.reason FROM crm_strategy_targets st JOIN marketing_campaigns mc ON mc.id = st.strategy_id
                WHERE st.company_id = $1 ORDER BY mc.updated_at DESC NULLS LAST, mc.created_at DESC NULLS LAST LIMIT 1`, [companyId]).then(r => r.rows[0]?.reason || null).catch(() => null),
    ]);
    plan.brand.lead = lead ? { id: lead.id, name: lead.name } : null;
    plan.brand.aim = aim;
    plan.brand.nextAction = nextActionOf(data.actions.get(companyId));
  }
  return plan;
}

/** The grid: brands down, the schemes across. `brandFilterSql` is the client slice (c.id based) for a client viewer. */
export async function brandGrid(q: Queryable, viewer: PlanViewer, schemes: PlanScheme[], brandFilterSql: string | null, now: Date = new Date()): Promise<BrandGrid> {
  const staff = isStaff(viewer);
  const propertyIds = uniq(schemes.flatMap(s => s.propertyIds));
  const shown = schemes.filter(s => !viewer.schemes || viewer.schemes.has(s.key));
  const early: string[] = [];

  // Staff also see brands a strategy targets, before they have a line.
  const strategyBrandIds: string[] = !staff ? [] : await q.query(
    `/* brand-plan:strategy-brands */ SELECT DISTINCT st.company_id FROM crm_strategy_targets st JOIN crm_companies c ON c.id = st.company_id
      WHERE c.company_type ILIKE 'tenant%'`).then(r => r.rows.map((x: any) => x.company_id as string)).catch((e: any) => {
    early.push("Brands on a strategy could not be read, so only brands with a line are listed.");
    console.warn(`[brand-plan] strategy brands: ${e?.message}`);
    return [];
  });
  const data = await loadPlan(q, { brandIds: null, propertyIds, schemes, viewer, now, alsoBrandIds: strategyBrandIds });
  const warnings = [...early, ...data.warnings];
  const ids = uniq([...data.rowsByBrand.keys(), ...strategyBrandIds]);
  const brands = ids.length === 0 ? [] : (await q.query(
    `/* brand-plan:brands */ SELECT c.id, c.name, c.logo_url, c.concept_status, c.bgp_contact_user_ids FROM crm_companies c
      WHERE c.id = ANY($1) AND c.company_type ILIKE 'tenant%' AND c.archived_at IS NULL AND c.merged_into_id IS NULL
        ${brandFilterSql ? `AND ${brandFilterSql}` : ""}
      ORDER BY lower(c.name)`, [ids])).rows;

  let leadNames = new Map<string, string>();
  if (staff) {
    const leadIds = uniq(brands.map((b: any) => (Array.isArray(b.bgp_contact_user_ids) ? b.bgp_contact_user_ids : []).find((x: any) => !!x)).filter((x: any): x is string => !!x));
    if (leadIds.length) leadNames = new Map((await q.query(`/* brand-plan:leads */ SELECT id, name FROM users WHERE id = ANY($1)`, [leadIds]).catch(() => ({ rows: [] as any[] }))).rows.map((u: any) => [u.id, u.name]));
  }

  const out: BrandGridBrand[] = [];
  brands.forEach((b: any, i: number) => {
    const all = data.rowsByBrand.get(b.id) || [];
    const other = data.otherSchemes.get(b.id)?.size || 0;
    // A restricted viewer's grid lists a brand only for its own schemes.
    if (!staff && all.length === 0) return;
    const token = `b${i + 1}`;
    const jointAgent = viewer.kind === "joint_agent";
    const rows = jointAgent ? all.map(r => withoutCompany(r, token)) : all;
    const cells: BrandGridBrand["cells"] = {};
    for (const r of rows) {
      if (!r.scheme.key) continue;
      const cell = cells[r.scheme.key] || { stage: r.stage, count: 0, rowKeys: [], wanted: 0, ...(staff ? { owners: [], noNextStep: 0 } : {}) };
      // The number is the live lines; lines not proceeding are counted only when nothing else is there.
      if (r.stage !== "not_proceeding") cell.count += 1;
      cell.rowKeys.push(r.key);
      if (r.stage === "wanted") cell.wanted += 1;
      // The board's owner and "No next step" filters are BGP's own.
      if (staff && r.stage !== "not_proceeding") {
        if (r.owner?.name && !cell.owners!.includes(r.owner.name)) cell.owners!.push(r.owner.name);
        if (!r.nextStep && brandStageRank(r.stage) > 0 && brandStageRank(r.stage) <= brandStageRank("solicitors")) cell.noNextStep! += 1;
      }
      cell.stage = furthestStage([cell.stage, r.stage])!;
      cells[r.scheme.key] = cell;
    }
    for (const cell of Object.values(cells)) if (cell.count === 0) cell.count = cell.rowKeys.length;
    const liveStages = rows.filter(r => r.stage !== "not_proceeding").map(r => r.stage);
    const entry: BrandGridBrand = {
      key: jointAgent ? token : b.id,
      id: jointAgent ? null : b.id,
      name: b.name, logoUrl: b.logo_url || null,
      requirementHeld: data.requirements.has(b.id),
      furthest: furthestStage(liveStages.length ? liveStages : rows.map(r => r.stage)),
      wantedNoUnit: rows.filter(r => r.stage === "wanted").length,
      cells,
    };
    // A joint agent is told nothing about schemes outside its own, not even how many.
    if (viewer.kind === "asset_manager") entry.otherSchemeCount = other;
    if (jointAgent) entry.rows = rows;
    if (staff) {
      const leadId = (Array.isArray(b.bgp_contact_user_ids) ? b.bgp_contact_user_ids : []).find((x: any) => !!x);
      entry.onHold = isOnHold(b.concept_status);
      entry.lead = leadId && leadNames.has(leadId) ? { id: leadId, name: leadNames.get(leadId)! } : null;
      entry.openActions = (data.actions.get(b.id) || []).length;
      entry.nextAction = nextActionOf(data.actions.get(b.id));
    }
    out.push(entry);
  });

  return { schemes: shown.map(s => ({ key: s.key, name: s.name, group: s.group })), brands: out, canEdit: staff, warnings };
}

// ── Wanted lines (BGP staff only for now) ────────────────────────────────
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalId = z.string().trim().min(1).max(100).nullable().optional();
export const wishCreateSchema = z.object({
  companyId: z.string().trim().min(1).max(100),
  schemeKey: optionalId,
  propertyId: optionalId,
  tenancyUnitId: optionalId,
  unitLabel: optionalText(200),
  note: optionalText(2000),
  requirementId: optionalId,
  visibleToClient: z.boolean().optional(),
}).strict();
export const wishUpdateSchema = z.object({
  tenancyUnitId: optionalId,
  unitLabel: optionalText(200),
  note: optionalText(2000),
  requirementId: optionalId,
  visibleToClient: z.boolean().optional(),
  ruledOut: z.object({ reason: z.string().trim().min(1, "Say why it is ruled out").max(500) }).strict().nullable().optional(),
}).strict();

class PlanError extends Error { constructor(public status: number, message: string) { super(message); } }
const blank = (v: string | null | undefined) => (v == null || v === "" ? null : v);
const DUPLICATE = "This brand already has a Wanted line for that scheme and unit.";

// The unit must sit on the property, or on another record of the same scheme.
async function placeFor(q: Queryable, schemes: PlanScheme[], propertyId: string | null, tenancyUnitId: string | null): Promise<string> {
  if (tenancyUnitId) {
    const unit = (await q.query(`SELECT id, property_id FROM tenancy_schedule_units WHERE id = $1`, [tenancyUnitId])).rows[0];
    if (!unit) throw new PlanError(400, "That unit is not on the tenancy schedule");
    if (propertyId && unit.property_id !== propertyId) {
      const scheme = schemes.find(s => s.propertyIds.includes(propertyId));
      if (!scheme || !scheme.propertyIds.includes(unit.property_id)) throw new PlanError(400, "That unit is not in the scheme or property chosen");
    }
    return unit.property_id;
  }
  if (!propertyId) throw new PlanError(400, "Choose a scheme or a property");
  if (!(await q.query(`SELECT 1 FROM crm_properties WHERE id = $1`, [propertyId])).rows[0]) throw new PlanError(400, "Property not found");
  return propertyId;
}

export async function createWish(q: Queryable, schemes: PlanScheme[], body: unknown, actor: { id: string | null; name: string | null }): Promise<{ ok: true; id: string }> {
  const parsed = wishCreateSchema.safeParse(body);
  if (!parsed.success) throw new PlanError(400, parsed.error.issues[0]?.message || "Check the Wanted line");
  const b = parsed.data;
  const brand = (await q.query(`SELECT id, company_type, merged_into_id FROM crm_companies WHERE id = $1`, [b.companyId])).rows[0];
  if (!brand || brand.merged_into_id) throw new PlanError(404, "Brand not found");
  if (!/^tenant/i.test(String(brand.company_type || ""))) throw new PlanError(400, "A Wanted line is for a brand. Plan landlords in the Landlord CRM.");
  let propertyId = blank(b.propertyId);
  if (blank(b.schemeKey)) {
    const scheme = schemes.find(s => s.key === b.schemeKey);
    if (!scheme) throw new PlanError(400, "Unknown scheme");
    if (!scheme.canonicalId) throw new PlanError(400, `${scheme.name} has no property record yet. Add the property first.`);
    propertyId = scheme.canonicalId;
  }
  const place = await placeFor(q, schemes, propertyId, blank(b.tenancyUnitId));
  if (blank(b.requirementId) && !(await q.query(`SELECT 1 FROM crm_requirements_leasing WHERE id = $1 AND company_id = $2`, [b.requirementId, b.companyId])).rows[0]) {
    throw new PlanError(400, "That requirement is not this brand's");
  }
  try {
    const r = await q.query(
      `INSERT INTO brand_scheme_targets (company_id, property_id, tenancy_unit_id, unit_label, note, requirement_id, visible_to_client, created_by, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [b.companyId, place, blank(b.tenancyUnitId), blank(b.unitLabel), blank(b.note), blank(b.requirementId), !!b.visibleToClient, actor.id, actor.name]);
    return { ok: true, id: r.rows[0].id };
  } catch (e: any) {
    if (e?.code === "23505") throw new PlanError(409, DUPLICATE);
    throw e;
  }
}

export async function updateWish(q: Queryable, schemes: PlanScheme[], id: string, body: unknown): Promise<{ ok: true; id: string }> {
  const parsed = wishUpdateSchema.safeParse(body);
  if (!parsed.success) throw new PlanError(400, parsed.error.issues[0]?.message || "Check the Wanted line");
  const b = parsed.data;
  const wish = (await q.query(`SELECT id, company_id, property_id FROM brand_scheme_targets WHERE id = $1`, [id])).rows[0];
  if (!wish) throw new PlanError(404, "Wanted line not found");
  const sets: string[] = []; const values: any[] = [id];
  const set = (col: string, value: any) => { values.push(value); sets.push(`${col} = $${values.length}`); };
  if (b.tenancyUnitId !== undefined) {
    const unitId = blank(b.tenancyUnitId);
    if (unitId) set("property_id", await placeFor(q, schemes, wish.property_id, unitId));
    set("tenancy_unit_id", unitId);
  }
  if (b.unitLabel !== undefined) set("unit_label", blank(b.unitLabel));
  if (b.note !== undefined) set("note", blank(b.note));
  if (b.requirementId !== undefined) {
    if (blank(b.requirementId) && !(await q.query(`SELECT 1 FROM crm_requirements_leasing WHERE id = $1 AND company_id = $2`, [b.requirementId, wish.company_id])).rows[0]) {
      throw new PlanError(400, "That requirement is not this brand's");
    }
    set("requirement_id", blank(b.requirementId));
  }
  if (b.visibleToClient !== undefined) set("visible_to_client", b.visibleToClient);
  if (b.ruledOut !== undefined) {
    // Retiring a line keeps it, with its reason; null brings it back.
    sets.push(b.ruledOut ? "ruled_out_at = COALESCE(ruled_out_at, now())" : "ruled_out_at = NULL");
    set("ruled_out_reason", b.ruledOut ? b.ruledOut.reason : null);
  }
  if (sets.length === 0) throw new PlanError(400, "Nothing to change");
  try {
    await q.query(`UPDATE brand_scheme_targets SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, values);
    return { ok: true, id };
  } catch (e: any) {
    if (e?.code === "23505") throw new PlanError(409, DUPLICATE);
    throw e;
  }
}

// ── Routes ───────────────────────────────────────────────────────────────
const fail = (res: Response, e: any, fallback: string) => res.status(e instanceof PlanError ? e.status : 500).json({ error: e instanceof PlanError ? e.message : e?.message || fallback });

// The staff door: a client login never reaches /api/brand-crm (it is on no
// client allowlist), and staff viewing as a client are turned away here.
export async function staffDoor(req: Request, res: Response): Promise<boolean> {
  if ((await isClientRequestUser(req)) || (await resolveCompanyScope(req))) {
    res.status(403).json({ error: "This is BGP's own Brand CRM view. Switch back to your own team to use it." });
    return false;
  }
  return true;
}

// The Landsec door is always a client's view, whoever is asking: a Landsec
// login by its role, and BGP staff as the full Landsec login would see it.
export async function landsecPlanViewer(req: Request): Promise<PlanViewer | null> {
  const v = await landsecViewer(req);
  if (!v) return null;
  const kind: PlanViewerKind = v.role === "asset_manager" ? "asset_manager" : v.role === "joint_agent" ? "joint_agent" : "landsec";
  return { kind, clientCompanyId: v.companyId, schemes: kind === "landsec" ? null : v.schemes || new Set<string>() };
}

async function landsecSchemes(): Promise<{ companyId: string | null; schemes: PlanScheme[] }> {
  const companyId = await landsecCompanyId();
  return { companyId, schemes: companyId ? planSchemes(await resolveLandsecPortfolio(companyId)) : [] };
}

export function setupBrandCrmPlanRoutes(app: Express) {
  // The grid of brands against the Landsec schemes (staff).
  app.get("/api/brand-crm/plan", requireAuth, async (req, res) => {
    try {
      if (!(await staffDoor(req, res))) return;
      const landlord = String(req.query.landlord || "landsec");
      if (landlord !== "landsec") return res.status(400).json({ error: "The grid is built for the Landsec schemes only so far." });
      const { schemes } = await landsecSchemes();
      res.json(await brandGrid(pool, STAFF_VIEWER, schemes, null));
    } catch (e: any) { fail(res, e, "Failed to load the Brand CRM grid"); }
  });

  // One brand's plan, every landlord (staff).
  app.get("/api/brand-crm/plan/:companyId", requireAuth, async (req, res) => {
    try {
      if (!(await staffDoor(req, res))) return;
      const { schemes } = await landsecSchemes();
      const plan = await brandPlan(pool, String(req.params.companyId), STAFF_VIEWER, schemes);
      if (!plan) return res.status(404).json({ error: "Brand not found" });
      res.json(plan);
    } catch (e: any) { fail(res, e, "Failed to load the brand's plan"); }
  });

  // Add a Wanted line (staff). Never a deal.
  app.post("/api/brand-crm/targets", requireAuth, async (req: any, res) => {
    try {
      if (!(await staffDoor(req, res))) return;
      const userId = req.session?.userId || req.tokenUserId || null;
      const name = userId ? (await pool.query(`SELECT name, email FROM users WHERE id = $1`, [userId])).rows[0] : null;
      const { schemes } = await landsecSchemes();
      res.status(201).json(await createWish(pool, schemes, req.body, { id: userId, name: name?.name || name?.email || null }));
    } catch (e: any) { fail(res, e, "Failed to add the Wanted line"); }
  });

  // Change a Wanted line, tick "show to Landsec", rule it out or bring it back (staff). There is no delete.
  app.patch("/api/brand-crm/targets/:id", requireAuth, async (req, res) => {
    try {
      if (!(await staffDoor(req, res))) return;
      const { schemes } = await landsecSchemes();
      res.json(await updateWish(pool, schemes, String(req.params.id), req.body));
    } catch (e: any) { fail(res, e, "Failed to change the Wanted line"); }
  });

  // The grid for a Landsec login: its slice of brands, its schemes.
  app.get("/api/landsec/brand-crm/plan", requireAuth, async (req, res) => {
    try {
      const viewer = await landsecPlanViewer(req);
      if (!viewer) return res.status(403).json({ error: "Not available for this account" });
      const schemes = planSchemes(await resolveLandsecPortfolio(viewer.clientCompanyId!));
      res.json(await brandGrid(pool, viewer, schemes, await clientBrandSliceSql(viewer.clientCompanyId, "c.id")));
    } catch (e: any) { fail(res, e, "Failed to load the Brand CRM grid"); }
  });

  // One brand's plan for a Landsec login. A joint agent holds no brand ids: its lines come with the grid.
  app.get("/api/landsec/brand-crm/plan/:companyId", requireAuth, async (req, res) => {
    try {
      const viewer = await landsecPlanViewer(req);
      if (!viewer) return res.status(403).json({ error: "Not available for this account" });
      if (viewer.kind === "joint_agent") return res.status(403).json({ error: "Not available for this login" });
      const companyId = String(req.params.companyId);
      if (!(await isClientVisibleBrand(companyId, viewer.clientCompanyId))) return res.status(403).json({ error: "Not available for this account" });
      const schemes = planSchemes(await resolveLandsecPortfolio(viewer.clientCompanyId!));
      const plan = await brandPlan(pool, companyId, viewer, schemes);
      if (!plan) return res.status(404).json({ error: "Brand not found" });
      res.json(plan);
    } catch (e: any) { fail(res, e, "Failed to load the brand's plan"); }
  });

  // Landsec does not write Wanted lines yet (Woody: after the pitch). The
  // gateway lets every Landsec role reach /api/landsec/, so say so here.
  app.all(/^\/api\/landsec\/brand-crm\/targets(\/.*)?$/i, requireAuth, (_req, res) => {
    res.status(403).json({ error: "Wanted lines are added by BGP for now" });
  });
}

// The letting transaction recommendation (Woody, 2026-11-12: "we also need
// to provide letting transaction recommendation once the HOTs are issued to
// a tenant"; shared/unit-recommendation.ts, migration 0054). Routes are
// registered from server/index.ts.
//
// Once Heads of Terms have gone to the tenant, BGP recommends the
// transaction to the client in the form Landsec asked for (the "Land
// Securities x BGP - Offer template"), and the client's leasing and asset
// managers decide. One recommendation per letting: the tracker unit and its
// current deal. BGP staff write and issue it. The deciders are the
// client-side people on the unit's Targeting Brief; each decides as
// themselves, and BGP staff record a decision only for a decider with no
// login. After issue any change raises the version, and a decision given on
// an earlier version stops counting.
//
// Who may open it is briefAccess() (server/unit-brief-workspace.ts). A joint
// agent reads it only once it has been issued, and never edits or decides.
import type { Express, Request, Response } from "express";
import { PDFDocument, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { contentDispositionFor } from "./utils/http-headers";
import { resolveCompanyScope, isClientRequestUser } from "./company-scope";
import { briefAccess, briefSchemePropertyIds } from "./unit-brief-workspace";
import { A4, MARGIN, BORDEAUX, INK, CREAM, BLUSH, STONE, WHITE, wordmarkBytes, fetchLogoBytes, wrapText, fmtMoney } from "./unit-info-sheet";
import { briefRoleLabel, isPlainObject, normaliseCommercials, parseMoney } from "@shared/unit-brief";
import { legacyToCode, statusSpellingsFor } from "@shared/deal-status";
import {
  RECOMMENDATION_COMMENTARY, RECOMMENDATION_DECISIONS, RECOMMENDATION_OPTIONS, RECOMMENDATION_TERM_FIELDS,
  recommendationMeasure, recommendationMissing, recommendationNer,
  type RecommendationCommentary, type RecommendationComparable, type RecommendationDecider,
  type RecommendationDecision, type RecommendationEvent, type RecommendationOption, type RecommendationStage,
  type RecommendationSummary, type RecommendationTermKey, type RecommendationTerms, type RecommendationWorkspace,
} from "@shared/unit-recommendation";

type Access = NonNullable<Awaited<ReturnType<typeof briefAccess>>>;
type Db = { query: (sql: string, params?: any[]) => Promise<any> };
type TermField = (typeof RECOMMENDATION_TERM_FIELDS)[number];

// The client-side people on the brief decide.
const DECIDER_ROLES = ["client_leasing", "senior_asset_manager", "asset_manager"];
const AGREED_OFFER_SQL = `lower(trim(coalesce(status, ''))) IN ('agreed', 'accepted')`;
// Not a live bid on this letting: turned down, taken back, or left over from an earlier letting of the unit ("Closed").
const DEAD_OFFER_SQL = `lower(trim(coalesce(status, ''))) IN ('rejected', 'withdrawn', 'closed')`;
// The Heads of Terms have gone to the tenant at these statuses, whatever the date column says.
const HOTS_ISSUED_CODES = ["HOT", "SOL", "EXC", "COM"];
const TEXT_MAX = 300, LONGTEXT_MAX = 4000, COMMENTARY_MAX = 4000, SUMMARY_MAX = 3000, DECISION_COMMENT_MAX = 2000, COMPARABLES_MAX = 20;
// The most a plain number may be: a typing slip beyond it.
const NUMBER_MAX: Partial<Record<RecommendationTermKey, number>> = { areaSqFt: 10_000_000, turnoverPct: 100, rentFreeMonths: 600, termYears: 999 };
const COMPARABLE_KEYS: (keyof RecommendationComparable)[] = [
  "transaction", "date", "tenant", "unit", "areaSqFt", "use", "rentPa", "turnoverPct", "rentFreeMonths", "capitalContribution", "termYears", "breaks", "rentReview", "comment", "dealId",
];
// The terms that come from the agreed offer ("Refresh from the agreed offer" re-reads these and no others).
const OFFER_TERM_KEYS: RecommendationTermKey[] = [
  "tenant", "tenantWebsite", "rentPa", "turnoverPct", "rentFreeMonths", "capitalContribution", "termYears", "breaks", "rentReview", "otherIncentives", "depositGuarantor",
];
const STAFF_ONLY = "This is done by BGP";
const AI_UNAVAILABLE = "AI help is not available on this server. Write the section yourself.";

const iso = (d: any): string | null => (d ? new Date(d).toISOString() : null);
const hasText = (v: any): boolean => v !== null && v !== undefined && String(v).trim() !== "";
const sameEmail = (a: any, b: any) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const numOrNull = (v: any): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const listNames = (names: string[]): string =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
const gbp = (n: any): string => `£${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
const plainNum = (n: any): string => Number(n).toLocaleString("en-GB", { maximumFractionDigits: 2 });
const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const oneLine = (v: any) => String(v ?? "").replace(/\s+/g, " ").trim();
const lowerFirst = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
const longDate = (d: Date): string => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
const shortDay = (d: any): string => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
// "2026-11-10" -> "10 Nov 2026", "2026-11" -> "Nov 2026"; anything else as written.
const shortDate = (s: any): string => {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(s || ""));
  if (!m) return String(s || "");
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1));
  return d.toLocaleDateString("en-GB", m[3] ? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } : { month: "short", year: "numeric", timeZone: "UTC" });
};
const optionLabel = (key: any): string => RECOMMENDATION_OPTIONS.find(o => o.key === key)?.label || "";
const decisionLabel = (key: any): string => RECOMMENDATION_DECISIONS.find(d => d.key === key)?.label || String(key || "");
function appBaseUrl(): string {
  return (process.env.PUBLIC_APP_URL || "https://chatbgp.app").replace(/\/+$/, "");
}

// A term as a person reads it: "£110,000", "2,450 sq ft", "6 months".
function termText(f: TermField, v: unknown): string {
  if (!hasText(v)) return "";
  if (f.kind === "money") return gbp(v);
  if (f.kind === "number") {
    const n = Number(v);
    if (f.key === "areaSqFt") return `${plainNum(n)} sq ft`;
    if (f.key === "turnoverPct") return `${plainNum(n)}%`;
    if (f.key === "rentFreeMonths") return `${plainNum(n)} ${n === 1 ? "month" : "months"}`;
    if (f.key === "termYears") return `${plainNum(n)} ${n === 1 ? "year" : "years"}`;
    return plainNum(n);
  }
  return String(v).trim();
}
// What a term is called in the history: "the headline rent", "the unit area".
const termName = (f: TermField): string =>
  f.key === "rentPa" ? "headline rent" : lowerFirst(f.label.replace(/\s*\(.*\)\s*$/, ""));

async function loadUnit(unitId: string, db: Db = pool): Promise<any | null> {
  return (await db.query(
    `SELECT au.id, au.unit_name, au.property_id, au.sqft, au.use_class, au.asking_rent, au.service_charge_pa, au.rates_pa,
            au.marketing_status, au.deal_id, au.hots_issued_at,
            p.name AS property_name, p.postcode AS property_postcode, lc.name AS landlord_name, lc.logo_url AS landlord_logo_url,
            d.deal_ref, d.tenant_entity_name
       FROM available_units au
       LEFT JOIN crm_properties p ON p.id = au.property_id
       LEFT JOIN crm_companies lc ON lc.id = p.landlord_id
       LEFT JOIN crm_deals d ON d.id = au.deal_id
      WHERE au.id = $1`, [unitId])).rows[0] || null;
}

// The unit, and whether the person asking may open it. Answers 404 / 403
// itself and returns null when they may not.
async function openUnit(req: Request, res: Response): Promise<{ unit: any; access: Access } | null> {
  const unit = await loadUnit(String(req.params.unitId));
  if (!unit) { res.status(404).json({ message: "That unit is not on the tracker" }); return null; }
  const access = await briefAccess(req, unit.property_id);
  if (!access) { res.status(403).json({ message: "This unit is outside your access" }); return null; }
  return { unit, access };
}

// The recommendation for the unit's CURRENT letting (its current deal).
async function loadRec(unit: any, db: Db = pool): Promise<any | null> {
  return (await db.query(
    `SELECT * FROM unit_recommendations WHERE unit_id = $1 AND COALESCE(deal_id, '') = COALESCE($2, '')`, [unit.id, unit.deal_id || null])).rows[0] || null;
}

// The unit's Targeting Brief and the people on it (with a login's own email
// where the brief row has none).
async function briefAndPeople(unitId: string): Promise<{ brief: any | null; people: any[] }> {
  const brief = (await pool.query(
    `SELECT id, commercials, objective, target_criteria, agreed_at FROM unit_briefs WHERE unit_id = $1 ORDER BY created_at DESC LIMIT 1`, [unitId])).rows[0] || null;
  if (!brief) return { brief: null, people: [] };
  const people = (await pool.query(
    `SELECT p.id, p.role, p.user_id, p.name, COALESCE(NULLIF(trim(p.email), ''), u.email) AS email, p.firm, p.sort_order, p.created_at,
            (SELECT a.landsec_role FROM landsec_access a WHERE a.user_id = p.user_id LIMIT 1) AS landsec_role
       FROM unit_brief_people p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.brief_id = $1 ORDER BY p.sort_order, p.created_at`, [brief.id])).rows;
  return { brief, people };
}
// The client-side people on the brief, in the order leasing, senior asset manager, asset manager.
const decidersOf = (people: any[]): any[] =>
  people.filter(p => DECIDER_ROLES.includes(p.role)).sort((a, b) => DECIDER_ROLES.indexOf(a.role) - DECIDER_ROLES.indexOf(b.role));

const isSelfPerson = (p: any, access: Access): boolean => (p.user_id ? p.user_id === access.userId : sameEmail(p.email, access.email));
const isJointAgent = (access: Access): boolean => access.landsecRole === "joint_agent";
// Who writes the recommendation: BGP, and the joint agent on the scheme
// (Woody, 2026-11-12: joint agents "can see draft and amend, it's theirs
// too"). Issuing it to the client stays with BGP, and nobody but the
// client's own people decides.
const canWrite = (access: Access): boolean => access.isStaff || isJointAgent(access);

function roleLabelFor(people: any[], access: Access): string {
  const mine = people.find(p => isSelfPerson(p, access));
  if (mine) return mine.role === "joint_agent" && mine.firm ? `Joint agent · ${mine.firm}` : briefRoleLabel(mine.role);
  if (access.isStaff) return "BGP";
  if (access.landsecRole === "asset_manager") return "Asset manager";
  if (access.landsecRole === "joint_agent") return "Joint agent";
  return access.scopeName || "Client";
}

async function logEvent(recId: string, access: Access, people: any[], kind: string, body: string, version: number | null) {
  await pool.query(
    `INSERT INTO unit_recommendation_events (recommendation_id, kind, body, version, author_user_id, author_name, author_role) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [recId, kind, body.slice(0, 3900), version, access.userId, access.name, roleLabelFor(people, access)],
  ).catch((e: any) => console.warn("[unit-recommendation] event log failed:", e?.message));
}

// One recommendation write on a unit at a time. The connection holds only
// the lock; the work runs on the pool.
async function withUnitLock<T>(unitId: string, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`unit_recommendation:${unitId}`]);
    return await fn();
  } finally {
    await client.query("COMMIT").catch(() => undefined);
    client.release();
  }
}

// unit_recommendations.decided_at follows the decisions: set while it is
// issued, at least one client decision-maker is on the brief and every one
// of them has approved the current version; cleared otherwise. One statement.
async function refreshDecided(recId: string, unitId: string): Promise<void> {
  await pool.query(
    `UPDATE unit_recommendations r SET decided_at = CASE
        WHEN r.issued_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM unit_brief_people p WHERE p.brief_id = b.id AND p.role = ANY($3::text[]))
         AND NOT EXISTS (
               SELECT 1 FROM unit_brief_people p WHERE p.brief_id = b.id AND p.role = ANY($3::text[])
                  AND NOT EXISTS (SELECT 1 FROM unit_recommendation_decisions d
                                   WHERE d.recommendation_id = r.id AND d.brief_person_id = p.id AND d.version = r.version AND d.decision = 'approved'))
        THEN COALESCE(r.decided_at, NOW())
        ELSE NULL END
       FROM (SELECT (SELECT id FROM unit_briefs WHERE unit_id = $2 ORDER BY created_at DESC LIMIT 1) AS id) b
      WHERE r.id = $1`, [recId, unitId, DECIDER_ROLES]);
}

async function agreedOfferFor(unitId: string): Promise<any | null> {
  return (await pool.query(
    `SELECT * FROM unit_offers WHERE unit_id = $1 AND ${AGREED_OFFER_SQL}
      ORDER BY agreed_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1`, [unitId])).rows[0] || null;
}
async function offerById(id: string | null | undefined): Promise<any | null> {
  return id ? (await pool.query(`SELECT * FROM unit_offers WHERE id = $1`, [id])).rows[0] || null : null;
}

const hotsIssued = (unit: any): boolean => !!unit.hots_issued_at || HOTS_ISSUED_CODES.includes(legacyToCode(unit.marketing_status) || "");

const storedTerms = (rec: any): RecommendationTerms => (isPlainObject(rec?.terms) ? (rec.terms as RecommendationTerms) : {});
const storedCommentary = (rec: any): RecommendationCommentary => (isPlainObject(rec?.commentary) ? (rec.commentary as RecommendationCommentary) : {});
const storedComparables = (rec: any): RecommendationComparable[] => (Array.isArray(rec?.comparables) ? (rec.comparables as RecommendationComparable[]) : []);

// The terms the offer gives. Only what the offer holds: nothing is invented.
async function offerTerms(offer: any): Promise<RecommendationTerms> {
  const out: RecommendationTerms = {};
  const put = (key: RecommendationTermKey, v: unknown) => { if (hasText(v)) out[key] = typeof v === "string" ? v.trim() : (v as number); };
  put("tenant", offer.company_name);
  if (offer.company_id) put("tenantWebsite", (await pool.query(`SELECT website FROM crm_companies WHERE id = $1`, [offer.company_id])).rows[0]?.website);
  put("rentPa", numOrNull(offer.rent_pa));
  put("turnoverPct", numOrNull(offer.turnover_rent_pct));
  put("rentFreeMonths", numOrNull(offer.rent_free_months));
  put("capitalContribution", numOrNull(offer.fitting_out_contribution));
  put("termYears", numOrNull(offer.term_years));
  put("breaks", offer.break_option);
  put("rentReview", offer.rent_review);
  const premium = numOrNull(offer.premium);
  put("otherIncentives", [hasText(offer.incentives) ? String(offer.incentives).trim() : "", premium !== null && premium > 0 ? `Premium of ${gbp(premium)}.` : ""].filter(Boolean).join("\n"));
  put("depositGuarantor", offer.rent_deposit);
  return out;
}

// What the recommendation starts with: the agreed offer, the deal, the unit
// and the brief. The rest is for a person to write.
async function startingTerms(unit: any, offer: any, brief: any | null): Promise<RecommendationTerms> {
  const out = await offerTerms(offer);
  if (hasText(unit.tenant_entity_name)) out.tenantEntity = String(unit.tenant_entity_name).trim();
  out.unit = [unit.unit_name, unit.property_name].filter(hasText).join(", ");
  const area = numOrNull(unit.sqft);
  if (area !== null && area > 0) out.areaSqFt = area;
  const use = normaliseCommercials(brief?.commercials).value.permittedUse || unit.use_class;
  if (hasText(use)) out.use = String(use).trim();
  return out;
}

function stageOf(rec: any | null, agreedOffer: boolean, deciders: RecommendationDecider[]): RecommendationStage {
  if (!rec) return agreedOffer ? "draft" : "not_ready";
  if (rec.issued_at && rec.decided_at) return "approved";
  if (rec.issued_at && deciders.some(d => d.decision === "declined")) return "declined";
  return rec.issued_at ? "issued" : "draft";
}

// Everything the dialog shows, in one read.
async function buildWorkspace(unitId: string, access: Access): Promise<RecommendationWorkspace> {
  const unit = await loadUnit(unitId);
  if (!unit) throw new Error("That unit is no longer on the tracker");
  let rec = await loadRec(unit);
  const [{ brief, people }, agreedOffer] = await Promise.all([briefAndPeople(unitId), agreedOfferFor(unitId)]);
  const jointAgent = isJointAgent(access);
  const unitOut: RecommendationWorkspace["unit"] = {
    id: unit.id, unitName: unit.unit_name, propertyId: unit.property_id || null, propertyName: unit.property_name || null,
    marketingStatus: unit.marketing_status || null, dealId: unit.deal_id || null, dealRef: unit.deal_ref ?? null, clientName: unit.landlord_name || null,
  };
  const ready = { agreedOffer: !!agreedOffer, hotsIssued: hotsIssued(unit) };
  const noFacts = { onTargetList: false, targetPriority: null, otherOffers: 0, viewingsHeld: 0, interestLogged: 0, briefAgreed: false, hotsIssuedAt: null };
  const noMeasure = recommendationMeasure({}, null, {});

  const offer = (rec?.offer_id ? await offerById(rec.offer_id) : null) || agreedOffer;
  const offerOk = offer && offer.unit_id === unitId ? offer : null;
  const deciderPeople = decidersOf(people);
  const [decisionQ, eventsQ, roundsQ, countsQ] = await Promise.all([
    rec ? pool.query(`SELECT * FROM unit_recommendation_decisions WHERE recommendation_id = $1`, [rec.id]) : Promise.resolve({ rows: [] as any[] }),
    rec ? pool.query(`SELECT * FROM unit_recommendation_events WHERE recommendation_id = $1 ORDER BY created_at ASC, id ASC LIMIT 500`, [rec.id]) : Promise.resolve({ rows: [] as any[] }),
    offerOk ? pool.query(`SELECT round_no, party, round_date, rent_pa, rent_free_months, term_years, fitting_out_contribution, note FROM unit_offer_rounds WHERE offer_id = $1 ORDER BY round_no ASC, created_at ASC`, [offerOk.id]) : Promise.resolve({ rows: [] as any[] }),
    pool.query(
      `SELECT (SELECT COUNT(*)::int FROM unit_offers o WHERE o.unit_id = $1 AND o.id <> COALESCE($2, '') AND NOT (${DEAD_OFFER_SQL.replace(/status/g, "o.status")})) AS other_offers,
              (SELECT COUNT(*)::int FROM unit_viewings v WHERE v.unit_id = $1 AND v.status = 'completed' AND v.deleted_at IS NULL) AS viewings,
              (SELECT COUNT(*)::int FROM unit_interest i WHERE i.unit_id = $1) AS interest`, [unitId, offerOk?.id || null]),
  ]);
  const recorderIds = [...new Set(decisionQ.rows.map((d: any) => d.decided_by_user_id).filter(Boolean))];
  const recorderEmails = new Map<string, string>(recorderIds.length
    ? (await pool.query(`SELECT id, email FROM users WHERE id = ANY($1::varchar[])`, [recorderIds])).rows.map((u: any) => [u.id, u.email || ""] as [string, string])
    : []);
  const version = rec ? Number(rec.version) || 1 : 1;
  const deciders: RecommendationDecider[] = deciderPeople.map((p: any) => {
    const d = decisionQ.rows.find((x: any) => x.brief_person_id === p.id);
    const current = !!d && !!rec?.issued_at && d.version === version;
    const bySelf = !!d && (p.user_id ? d.decided_by_user_id === p.user_id : sameEmail(recorderEmails.get(d.decided_by_user_id), p.email));
    return {
      briefPersonId: p.id, role: p.role, name: p.name, firm: p.firm || null, userId: p.user_id || null, isMe: isSelfPerson(p, access),
      decision: current ? (d.decision as RecommendationDecision) : null,
      comment: current ? d.comment || null : null,
      decidedAt: current ? iso(d.decided_at) : null,
      decidedByName: d ? d.decided_by_name || null : null,
      recordedOnBehalf: !!d && !bySelf,
      staleDecision: d && !current ? (d.decision as RecommendationDecision) : null,
    };
  });
  const approved = deciders.filter(d => d.decision === "approved").length;
  const declined = deciders.filter(d => d.decision === "declined").length;
  const complete = !!rec?.issued_at && deciders.length > 0 && approved === deciders.length;
  // The stored date follows the people on the brief, who can change without
  // this module hearing of it: heal it here so the stage is never stale.
  if (rec && complete !== !!rec.decided_at) {
    await refreshDecided(rec.id, unitId);
    rec = (await loadRec(unit)) || rec;
  }

  const terms: RecommendationTerms = { ...storedTerms(rec) };
  // The tenant's website comes from BGP's brand record: not for a joint agent.
  if (jointAgent) delete terms.tenantWebsite;
  const commentary = storedCommentary(rec);
  const c = normaliseCommercials(brief?.commercials).value;
  const measure = recommendationMeasure(terms,
    { quotingRentPa: c.quotingRentPa, ervPa: c.ervPa, nerFloorPa: c.nerFloorPa, insurancePa: c.insurancePa },
    { askingRent: numOrNull(unit.asking_rent), serviceChargePa: numOrNull(unit.service_charge_pa), ratesPa: numOrNull(unit.rates_pa) });

  // Is the tenant on the unit's target list?
  const tenantName = String(terms.tenant || offerOk?.company_name || "").trim();
  const target = brief && (tenantName || offerOk?.company_id)
    ? (await pool.query(
        `SELECT priority FROM unit_target_operators
          WHERE brief_id = $1 AND (($2::text IS NOT NULL AND company_id = $2) OR ($3 <> '' AND lower(trim(operator_name)) = lower($3)))
          ORDER BY sort_order, created_at LIMIT 1`, [brief.id, offerOk?.company_id || null, tenantName])).rows[0] || null
    : null;

  const events: RecommendationEvent[] = eventsQ.rows
    // Who could not be emailed is BGP's to chase, not the client's to read.
    .filter((e: any) => access.isStaff || e.kind !== "email_failed")
    .map((e: any) => ({ id: e.id, kind: e.kind, body: e.body, version: e.version, authorName: e.author_name, authorRole: e.author_role, createdAt: iso(e.created_at) }));
  const recommendation = RECOMMENDATION_OPTIONS.some(o => o.key === rec?.recommendation) ? (rec.recommendation as RecommendationOption) : null;
  const summary = hasText(rec?.summary) ? String(rec.summary) : null;
  const issued = !!rec?.issued_at;
  return {
    id: rec?.id || null,
    unit: unitOut,
    stage: stageOf(rec, !!agreedOffer, deciders),
    ready,
    offer: offerOk ? { id: offerOk.id, companyName: offerOk.company_name || null, offerDate: offerOk.offer_date, rentPa: numOrNull(offerOk.rent_pa) } : null,
    version,
    terms, measure,
    comparables: storedComparables(rec),
    rounds: roundsQ.rows.map((r: any) => ({
      roundNo: r.round_no, party: r.party, roundDate: r.round_date, rentPa: numOrNull(r.rent_pa), rentFreeMonths: numOrNull(r.rent_free_months),
      termYears: numOrNull(r.term_years), capitalContribution: numOrNull(r.fitting_out_contribution), note: r.note || null,
    })),
    facts: {
      onTargetList: !!target, targetPriority: target?.priority || null,
      otherOffers: countsQ.rows[0].other_offers, viewingsHeld: countsQ.rows[0].viewings, interestLogged: countsQ.rows[0].interest,
      briefAgreed: !!brief?.agreed_at, hotsIssuedAt: iso(unit.hots_issued_at),
    },
    commentary, recommendation, summary,
    missing: rec ? recommendationMissing({ terms: storedTerms(rec), commentary, recommendation, summary }) : [],
    issuedAt: iso(rec?.issued_at), issuedByName: rec?.issued_by_name || null, issuedVersion: rec?.issued_version ?? null,
    deciders,
    approval: { total: deciders.length, approved, declined, complete },
    decidedAt: iso(rec?.decided_at),
    events,
    viewer: {
      isStaff: access.isStaff, canEdit: canWrite(access), canIssue: access.isStaff,
      canDecide: issued && !jointAgent && deciders.some(d => d.isMe || (access.isStaff && !d.userId)),
    },
  };
}

// ── Saving ───────────────────────────────────────────────────────────────
interface Stored {
  terms: RecommendationTerms; comparables: RecommendationComparable[]; commentary: RecommendationCommentary;
  recommendation: RecommendationOption | null; summary: string | null;
}
interface Patch {
  terms?: RecommendationTerms; comparables?: RecommendationComparable[]; commentary?: RecommendationCommentary;
  recommendation?: RecommendationOption | null; summary?: string | null;
}
const storedOf = (rec: any): Stored => ({
  terms: storedTerms(rec), comparables: storedComparables(rec), commentary: storedCommentary(rec),
  recommendation: RECOMMENDATION_OPTIONS.some(o => o.key === rec.recommendation) ? rec.recommendation : null,
  summary: hasText(rec.summary) ? String(rec.summary) : null,
});

const tidy = (v: string) => v.replace(/\r\n/g, "\n").trim();

// A plain number from a form: a number, or digits typed as text. Undefined
// when it is neither; null when blank.
function parsePlainNumber(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const s = v.trim().replace(/,/g, "").replace(/%$/, "");
  if (!s) return null;
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : undefined;
}

// yyyy-mm-dd or yyyy-mm, and a real date.
function validComparableDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = m[3] ? +m[3] : 1;
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// One comparable row from a request. A message in plain words when it will not do.
function parseComparable(raw: unknown, n: number): { ok: true; row: RecommendationComparable } | { ok: false; message: string } {
  const where = `Comparable ${n}`;
  if (!isPlainObject(raw)) return { ok: false, message: `${where} is not a row of figures` };
  const bad = (message: string) => ({ ok: false as const, message: `${where}: ${message}` });
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id || id.length > 64) return bad("it has no id");
  let tooLong = "";
  const str = (key: string, label: string, max: number): string | null | undefined => {
    const v = raw[key];
    if (v === null || v === undefined) return null;
    if (typeof v !== "string") return undefined;
    const t = tidy(v);
    if (t.length > max) { tooLong = `${label} is too long (the limit is ${plainNum(max)} characters)`; return undefined; }
    return t || null;
  };
  const figure = (key: string, money: boolean, max: number): number | null | undefined => {
    const n2 = money ? parseMoney(raw[key]) : parsePlainNumber(raw[key]);
    return n2 === undefined || (n2 !== null && (n2 < 0 || n2 > max)) ? undefined : n2;
  };
  const row: Record<string, unknown> = { id };
  const texts: [keyof RecommendationComparable, string, number][] = [
    ["transaction", "the type of transaction", 120], ["date", "the date", 10], ["tenant", "the tenant", 200], ["unit", "the unit", 300],
    ["use", "the use", 200], ["breaks", "the breaks", 300], ["rentReview", "the rent review", 300], ["comment", "the comment", 1000], ["dealId", "the deal", 64],
  ];
  for (const [key, label, max] of texts) {
    const v = str(key, label, max);
    if (v === undefined) return bad(tooLong || `${label} must be text`);
    row[key] = v;
  }
  if (row.date && !validComparableDate(row.date as string)) return bad("the date must be a month or a day, like 2026-03 or 2026-03-25");
  const figures: [keyof RecommendationComparable, string, boolean, number][] = [
    ["areaSqFt", "the area", false, 10_000_000], ["rentPa", "the rent a year", true, 10_000_000_000], ["turnoverPct", "the turnover rent %", false, 100],
    ["rentFreeMonths", "the rent free", false, 600], ["capitalContribution", "the capital contribution", true, 10_000_000_000], ["termYears", "the term", false, 999],
  ];
  for (const [key, label, money, max] of figures) {
    const v = figure(key, money, max);
    if (v === undefined) return bad(`${label} must be a number${money ? " of pounds a year, like 95000 or £95,000" : ` between 0 and ${plainNum(max)}`}`);
    row[key] = v;
  }
  if (!row.tenant && !row.unit) return bad("give the tenant or the unit");
  return { ok: true, row: row as unknown as RecommendationComparable };
}

// The body of a save, checked field by field.
function parsePatch(body: any): { ok: true; patch: Patch } | { ok: false; message: string } {
  const patch: Patch = {};
  const bad = (message: string) => ({ ok: false as const, message });
  if (body?.terms !== undefined) {
    if (!isPlainObject(body.terms)) return bad("The terms must be a set of fields");
    const terms: RecommendationTerms = {};
    for (const [key, raw] of Object.entries(body.terms)) {
      const f = RECOMMENDATION_TERM_FIELDS.find(x => x.key === key);
      if (!f) return bad(`"${key}" is not one of the recommendation's terms`);
      if (f.kind === "money") {
        const n = parseMoney(raw);
        if (n === undefined || (n !== null && n < 0)) return bad(`${f.label} must be an amount in pounds, like 95000 or £95,000`);
        terms[f.key] = n;
      } else if (f.kind === "number") {
        const n = parsePlainNumber(raw);
        const max = NUMBER_MAX[f.key] ?? 1_000_000_000;
        if (n === undefined || (n !== null && (n < 0 || n > max))) return bad(`${f.label} must be a number between 0 and ${plainNum(max)}`);
        terms[f.key] = n;
      } else {
        if (raw !== null && typeof raw !== "string") return bad(`${f.label} must be text`);
        const t = raw === null ? "" : tidy(raw as string);
        const max = f.kind === "longtext" ? LONGTEXT_MAX : TEXT_MAX;
        if (t.length > max) return bad(`${f.label} is too long (${plainNum(t.length)} characters). The limit is ${plainNum(max)}.`);
        terms[f.key] = t || null;
      }
    }
    patch.terms = terms;
  }
  if (body?.commentary !== undefined) {
    if (!isPlainObject(body.commentary)) return bad("The commentary must be a set of headings");
    const commentary: RecommendationCommentary = {};
    for (const [key, raw] of Object.entries(body.commentary)) {
      const h = RECOMMENDATION_COMMENTARY.find(x => x.key === key);
      if (!h) return bad(`"${key}" is not one of the commentary headings`);
      if (raw !== null && typeof raw !== "string") return bad(`The commentary on "${h.label}" must be text`);
      const t = raw === null ? "" : tidy(raw as string);
      if (t.length > COMMENTARY_MAX) return bad(`The commentary on "${h.label}" is too long (${plainNum(t.length)} characters). The limit is ${plainNum(COMMENTARY_MAX)}.`);
      commentary[h.key] = t || null;
    }
    patch.commentary = commentary;
  }
  if (body?.comparables !== undefined) {
    if (!Array.isArray(body.comparables)) return bad("The comparables must be a list");
    if (body.comparables.length > COMPARABLES_MAX) return bad(`A recommendation holds at most ${COMPARABLES_MAX} comparables. Remove one before adding another.`);
    const rows: RecommendationComparable[] = [];
    for (let i = 0; i < body.comparables.length; i++) {
      const r = parseComparable(body.comparables[i], i + 1);
      if (!r.ok) return bad(r.message);
      if (rows.some(x => x.id === r.row.id)) return bad(`Comparable ${i + 1} has the same id as another row`);
      rows.push(r.row);
    }
    patch.comparables = rows;
  }
  if (body?.recommendation !== undefined) {
    const v = body.recommendation;
    if (v === null || v === "") patch.recommendation = null;
    else if (typeof v === "string" && RECOMMENDATION_OPTIONS.some(o => o.key === v)) patch.recommendation = v as RecommendationOption;
    else return bad(`The recommendation is one of: ${RECOMMENDATION_OPTIONS.map(o => o.label).join("; ")}`);
  }
  if (body?.summary !== undefined) {
    if (body.summary !== null && typeof body.summary !== "string") return bad("The summary must be text");
    const t = body.summary === null ? "" : tidy(body.summary);
    if (t.length > SUMMARY_MAX) return bad(`The summary is too long (${plainNum(t.length)} characters). The limit is ${plainNum(SUMMARY_MAX)}.`);
    patch.summary = t || null;
  }
  return { ok: true, patch };
}

// A key sent as null or "" clears it; a key not sent is untouched.
function applyPatch(before: Stored, patch: Patch): Stored {
  const merge = <T extends Record<string, unknown>>(a: T, b: T | undefined): T => {
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b || {})) { if (v === null || v === undefined || v === "") delete out[k]; else out[k] = v; }
    return out as T;
  };
  return {
    terms: merge(before.terms, patch.terms),
    commentary: merge(before.commentary, patch.commentary),
    comparables: patch.comparables !== undefined ? patch.comparables : before.comparables,
    recommendation: patch.recommendation !== undefined ? patch.recommendation : before.recommendation,
    summary: patch.summary !== undefined ? patch.summary : before.summary,
  };
}

// What changed between two saved states, in words a person can scan. An
// empty list means nothing changed. Exported so it can be checked on its own.
export function describeRecommendationChange(before: Stored, after: Stored): string[] {
  const out: string[] = [];
  const same = (a: unknown, b: unknown) => (hasText(a) ? String(a) : "") === (hasText(b) ? String(b) : "");
  for (const f of RECOMMENDATION_TERM_FIELDS) {
    const a = before.terms[f.key], b = after.terms[f.key];
    if (same(a, b)) continue;
    const name = termName(f);
    if (f.kind === "longtext") out.push(!hasText(a) ? `wrote the ${name}` : !hasText(b) ? `cleared the ${name}` : `rewrote the ${name}`);
    else if (!hasText(a)) out.push(`set the ${name} to ${termText(f, b)}`);
    else if (!hasText(b)) out.push(`cleared the ${name} (was ${termText(f, a)})`);
    else out.push(`changed the ${name} from ${termText(f, a)} to ${termText(f, b)}`);
  }
  if (before.recommendation !== after.recommendation) {
    out.push(!before.recommendation ? `set the recommendation to "${optionLabel(after.recommendation)}"`
      : !after.recommendation ? `cleared the recommendation (was "${optionLabel(before.recommendation)}")`
      : `changed the recommendation from "${optionLabel(before.recommendation)}" to "${optionLabel(after.recommendation)}"`);
  }
  if (!same(before.summary, after.summary)) out.push(!hasText(before.summary) ? "wrote the summary" : !hasText(after.summary) ? "cleared the summary" : "rewrote the summary");
  for (const h of RECOMMENDATION_COMMENTARY) {
    const a = before.commentary[h.key], b = after.commentary[h.key];
    if (same(a, b)) continue;
    out.push(`${!hasText(a) ? "wrote" : !hasText(b) ? "cleared" : "rewrote"} the commentary on ${lowerFirst(h.label)}`);
  }
  const called = (r: RecommendationComparable) => oneLine(r.tenant || r.unit || "a row").slice(0, 80);
  const added = after.comparables.filter(r => !before.comparables.some(x => x.id === r.id));
  const removed = before.comparables.filter(r => !after.comparables.some(x => x.id === r.id));
  // Field by field: the database does not keep a row's keys in the order they were sent.
  const rowChanged = (a: RecommendationComparable, b: RecommendationComparable) => COMPARABLE_KEYS.some(k => !same(a[k], b[k]));
  const edited = after.comparables.filter(r => { const was = before.comparables.find(x => x.id === r.id); return !!was && rowChanged(was, r); });
  const phrase = (verb: string, rows: RecommendationComparable[]) =>
    rows.length === 0 ? null : rows.length <= 3 ? `${verb} the ${rows.length === 1 ? "comparable" : "comparables"} for ${listNames(rows.map(called))}` : `${verb} ${rows.length} comparables`;
  for (const p of [phrase("added", added), phrase("removed", removed), phrase("changed", edited)]) if (p) out.push(p);
  if (!added.length && !removed.length && !edited.length && before.comparables.map(r => r.id).join("|") !== after.comparables.map(r => r.id).join("|")) out.push("reordered the comparables");
  return out;
}

// Write a change. Before issue the version stays; after issue it rises, the
// approval is cleared and the history says what changed. Returns false when
// nothing changed.
async function writeChange(rec: any, unit: any, next: Stored, access: Access, lead: string | null): Promise<boolean> {
  const changes = describeRecommendationChange(storedOf(rec), next);
  if (changes.length === 0) return false;
  const issued = !!rec.issued_at;
  const version = issued ? rec.version + 1 : rec.version;
  await pool.query(
    `UPDATE unit_recommendations
        SET terms = $2::jsonb, comparables = $3::jsonb, commentary = $4::jsonb, recommendation = $5, summary = $6,
            version = $7, decided_at = CASE WHEN $8 THEN NULL ELSE decided_at END, updated_by_name = $9, updated_at = NOW()
      WHERE id = $1`,
    [rec.id, JSON.stringify(next.terms), JSON.stringify(next.comparables), JSON.stringify(next.commentary), next.recommendation, next.summary, version, issued, access.name]);
  if (issued || lead) {
    const { people } = await briefAndPeople(unit.id);
    let body = `${lead ? `${lead}: ` : ""}${changes.join("; ")}`;
    if (issued) {
      const given = (await pool.query(
        `SELECT COUNT(*)::int AS n FROM unit_recommendation_decisions WHERE recommendation_id = $1 AND version = $2 AND brief_person_id = ANY($3::varchar[])`,
        [rec.id, rec.version, decidersOf(people).map(p => p.id)])).rows[0].n;
      if (given) body += `\n${given === 1 ? "The decision" : `The ${given} decisions`} already given ${given === 1 ? "is" : "are"} on the earlier version, so the client is asked to decide again`;
    }
    await logEvent(rec.id, access, people, issued ? "changed" : "refreshed", body, version);
  }
  return true;
}

// ── Email ────────────────────────────────────────────────────────────────
function plainEmailReason(e: any): string {
  const m = String(e?.message || e || "");
  if (/timed out/i.test(m)) return "the email service did not answer in time";
  if (/authenticat|token|credential|client.?id|tenant|secret|AADSTS|not configured|missing/i.test(m)) return "the email service is not connected on this server";
  if (/Graph API/i.test(m)) return "the email service refused the message";
  return "the email service is not available";
}

// Never throws: an email that could not be sent is reported, not fatal.
async function sendEmail(to: string, subject: string, html: string, landlordName?: string | null): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const { sendWorkspaceEmail } = await import("./shared-mailbox");
    await Promise.race([
      sendWorkspaceEmail({ to, subject: oneLine(subject).slice(0, 250), body: html, landlordName }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timed out")), 20000); }),
    ]);
    return null;
  } catch (e: any) {
    console.warn("[unit-recommendation] email not sent:", e?.message);
    return plainEmailReason(e);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// The email to a decider when the recommendation is issued (exported so it
// can be checked without sending anything).
export function recommendationEmail(
  ws: Pick<RecommendationWorkspace, "unit" | "terms" | "recommendation" | "version">,
  person: { name: string; way: "tracker" | "landsec_unit" | null }, issuerName: string | null, reissue: boolean,
): { subject: string; html: string } {
  const who = issuerName || "Bruce Gillingham Pollard";
  const t = ws.terms;
  const place = [ws.unit.unitName, ws.unit.propertyName].filter(hasText).join(", ");
  const field = (key: RecommendationTermKey) => termText(RECOMMENDATION_TERM_FIELDS.find(f => f.key === key)!, t[key]);
  const incentives = [field("rentFreeMonths") ? `${field("rentFreeMonths")} rent free` : "", field("capitalContribution") ? `${field("capitalContribution")} capital contribution` : ""].filter(Boolean).join(", ");
  const rows: [string, string][] = [
    ["Tenant", hasText(t.tenant) ? String(t.tenant) : "Not named"],
    ["Rent", [field("rentPa") ? `${field("rentPa")} a year` : "Not stated", field("turnoverPct") ? `turnover rent ${field("turnoverPct")}` : ""].filter(Boolean).join(", ")],
    ["Term", [field("termYears") || "Not stated", hasText(t.breaks) ? `breaks: ${oneLine(t.breaks)}` : ""].filter(Boolean).join(", ")],
    ["Incentives", incentives || "None stated"],
    ["Recommendation", optionLabel(ws.recommendation) || "Not stated"],
  ];
  // A login that has the Letting Tracker goes to it. Landsec asset managers
  // do not: their way in is the Landsec unit page (as the checklist email
  // does). Someone with no login gets the terms and replies to BGP.
  const link = person.way === "tracker" ? `${appBaseUrl()}/deals/letting?unit=${encodeURIComponent(ws.unit.id)}&recommendation=1`
    : person.way === "landsec_unit" ? `${appBaseUrl()}/landsec/unit/${encodeURIComponent(ws.unit.id)}?recommendation=1` : null;
  const table = rows.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;vertical-align:top"><strong>${esc(k)}</strong></td><td style="padding:2px 0">${esc(v)}</td></tr>`).join("");
  const lead = reissue
    ? `${who} at Bruce Gillingham Pollard has changed the letting transaction recommendation for ${place} and issued it again (version ${ws.version}). A decision given on the earlier version no longer counts.`
    : `${who} at Bruce Gillingham Pollard has issued the letting transaction recommendation for ${place}. It is waiting for your decision.`;
  return {
    subject: `${reissue ? "Changed recommendation" : "Recommendation"} for your decision: ${place}${hasText(t.tenant) ? ` (${oneLine(t.tenant)})` : ""}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">
<p>Hello ${esc(person.name.split(" ")[0] || person.name)},</p>
<p>${esc(lead)}</p>
<table style="border-collapse:collapse;font-size:14px">${table}</table>
${link ? `<p><a href="${esc(link)}">Open the recommendation</a></p>
<p>Open it to approve it, raise a query or decline it.</p>` : `<p>Reply to ${esc(who)} with your decision and BGP will record it.</p>`}
<p>Subject to contract.</p>
</div>`,
  };
}

// ── Help me write it ─────────────────────────────────────────────────────
const DRAFT_SYSTEM = `You help a surveyor at Bruce Gillingham Pollard (BGP), a UK retail and leisure leasing agency, write one section of a letting transaction recommendation to the landlord client. The client's leasing manager and asset manager read it and decide whether to proceed.

Rules:
- British English. Short factual sentences. Figures first, then what they mean.
- No em-dashes. No sales language, no adjectives of praise, no exclamation marks.
- Use ONLY the facts in the material given. Never invent a figure, a comparable, a name, a date or a fact that is not given.
- Where the facts given do not cover something the heading needs, write "not provided" for that point instead of guessing.
- Money as £95,000. Rent per square foot to two decimal places.
- No heading, no bullet symbols, no sign-off. Short paragraphs.
- Length: 60 to 140 words for a commentary heading, 80 to 160 words for the summary.
Return ONLY the text of the section.`;

// The prompt for one section, built from the workspace's own facts and
// nothing else (exported so it can be checked without calling the AI).
export function recommendationDraftPrompt(ws: RecommendationWorkspace, brief: { objective: string | null; targetCriteria: string | null }, section: string): { system: string; user: string } {
  const heading = RECOMMENDATION_COMMENTARY.find(c => c.key === section);
  const money = (n: number | null) => (n === null ? "not provided" : gbp(n));
  const pct = (n: number | null) => (n === null ? "not provided" : `${plainNum(n)}%`);
  const terms = RECOMMENDATION_TERM_FIELDS.filter(f => hasText(ws.terms[f.key])).map(f => `${f.label}: ${termText(f, ws.terms[f.key])}`);
  const m = ws.measure;
  const measure = [
    `Quoting rent a year: ${money(m.quotingRentPa)}`, `ERV a year: ${money(m.ervPa)}`,
    `Headline rent per sq ft: ${m.headlinePsf === null ? "not provided" : `£${m.headlinePsf.toFixed(2)}`}`,
    `Headline rent as a percentage of ERV: ${pct(m.headlineVsErvPct)}`,
    `Net effective rent a year: ${money(m.nerPa)}`, `Net effective rent less three months' fit-out: ${money(m.nerLessFitOutPa)}`,
    `Net effective rent floor in the brief: ${money(m.nerFloorPa)}`,
    `Net effective rent as a percentage of the floor: ${pct(m.nerVsFloorPct)}`,
    `Total occupational cost a year: ${money(m.occupancyCostPa)}${m.occupancyCostPsf === null ? "" : ` (£${m.occupancyCostPsf.toFixed(2)} per sq ft)`}`,
  ];
  const comps = ws.comparables.map(c => {
    const ner = recommendationNer({ rentPa: c.rentPa, termYears: c.termYears, rentFreeMonths: c.rentFreeMonths, capitalContribution: c.capitalContribution }, 3);
    return `- ${[c.tenant, c.unit, c.transaction, c.date ? shortDate(c.date) : "", c.areaSqFt ? `${plainNum(c.areaSqFt)} sq ft` : "", c.rentPa !== null ? `${gbp(c.rentPa)} a year` : "",
      c.rentPa !== null && c.areaSqFt ? `£${(c.rentPa / c.areaSqFt).toFixed(2)} per sq ft` : "", c.turnoverPct !== null ? `turnover ${plainNum(c.turnoverPct)}%` : "",
      c.rentFreeMonths !== null ? `${plainNum(c.rentFreeMonths)} months rent free` : "", c.capitalContribution !== null ? `${gbp(c.capitalContribution)} capital contribution` : "",
      c.termYears !== null ? `${plainNum(c.termYears)} year term` : "", c.breaks ? `breaks: ${c.breaks}` : "", c.rentReview ? `review: ${c.rentReview}` : "",
      ner !== null ? `net effective less fit-out ${gbp(ner)}` : "", c.comment || ""].filter(Boolean).join("; ")}`;
  });
  const rounds = ws.rounds.map(r => `- Round ${r.roundNo}, ${shortDate(r.roundDate)}, ${r.party}: ${[r.rentPa !== null ? `${gbp(r.rentPa)} a year` : "", r.rentFreeMonths !== null ? `${plainNum(r.rentFreeMonths)} months rent free` : "",
    r.termYears !== null ? `${plainNum(r.termYears)} year term` : "", r.capitalContribution !== null ? `${gbp(r.capitalContribution)} capital contribution` : "", r.note || ""].filter(Boolean).join("; ")}`);
  const f = ws.facts;
  const tenant = hasText(ws.terms.tenant) ? String(ws.terms.tenant) : "The tenant";
  const facts = [
    f.onTargetList ? `${tenant} is on this unit's target list${f.targetPriority ? `, priority ${f.targetPriority}` : ""}.` : `${tenant} is not on this unit's target list.`,
    `${plural(f.otherOffers, "other offer", "other offers")} on this unit. ${plural(f.viewingsHeld, "viewing", "viewings")} held. ${plural(f.interestLogged, "enquiry", "enquiries")} logged.`,
    f.briefAgreed ? "The Targeting Brief is agreed." : "The Targeting Brief is not yet agreed.",
    f.hotsIssuedAt ? `Heads of Terms were issued to the tenant on ${shortDay(f.hotsIssuedAt)}.` : "",
  ].filter(Boolean);
  const written = RECOMMENDATION_COMMENTARY.filter(c => c.key !== section && hasText(ws.commentary[c.key])).map(c => `${c.label}:\n${String(ws.commentary[c.key]).slice(0, 1200)}`);
  const user = [
    heading ? `Write the commentary under this heading: "${heading.label}"${"hint" in heading && heading.hint ? ` (${heading.hint})` : ""}.` : "Write the summary paragraph: what BGP recommends and the two or three reasons that carry it.",
    `Unit: ${ws.unit.unitName}${ws.unit.propertyName ? `, ${ws.unit.propertyName}` : ""}. Client: ${ws.unit.clientName || "not provided"}.`,
    `BGP's recommendation: ${optionLabel(ws.recommendation) || "not chosen yet"}.`,
    terms.length ? `The transaction:\n${terms.join("\n")}` : "The transaction: no terms entered.",
    `Against the brief:\n${measure.join("\n")}`,
    comps.length ? `Comparable evidence:\n${comps.join("\n")}` : "Comparable evidence: none entered.",
    rounds.length ? `How the bid moved:\n${rounds.join("\n")}` : "How the bid moved: no rounds logged.",
    `What the app knows:\n${facts.join("\n")}`,
    `The brief's objective: ${hasText(brief.objective) ? String(brief.objective).slice(0, 1500) : "not provided"}`,
    `The brief's target criteria: ${hasText(brief.targetCriteria) ? String(brief.targetCriteria).slice(0, 1500) : "not provided"}`,
    written.length ? `Commentary already written (do not repeat it):\n${written.join("\n\n")}` : "",
    !heading && hasText(ws.summary) ? `The summary as it stands (improve it, keep its points):\n${String(ws.summary).slice(0, 2000)}` : "",
    heading && hasText(ws.commentary[heading.key]) ? `This section as it stands (improve it, keep its points):\n${String(ws.commentary[heading.key]).slice(0, 2500)}` : "",
  ].filter(Boolean).join("\n\n");
  return { system: DRAFT_SYSTEM, user };
}

// ── The PDF ──────────────────────────────────────────────────────────────
// Text the standard PDF fonts can draw: anything outside Latin-1 becomes a space.
const pdfSafe = (v: unknown): string =>
  String(v ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/•/g, "-")
    .replace(/\t/g, " ").replace(/[^\x20-\x7E\xA0-\xFF\n]/g, " ");

// Wrap text to a width, keeping the person's line breaks and breaking a
// word that is wider than the column.
function wrapBlock(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    if (!para.trim()) { out.push(""); continue; }
    for (const line of wrapText(para.trim(), font, size, width)) {
      let rest = line;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      out.push(rest);
    }
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

async function buildRecommendationPdf(ws: RecommendationWorkspace, logoUrl: string | null): Promise<{ bytes: Uint8Array; pages: number }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
  const [pw, ph] = A4;
  const contentW = pw - MARGIN * 2;
  const FOOT = 62;                    // nothing is drawn below this but the footer
  const QUIET = 0.62;                 // secondary text: ink, lighter
  const unitName = oneLine(pdfSafe(ws.unit.unitName));
  const propertyName = oneLine(pdfSafe(ws.unit.propertyName));
  const today = longDate(new Date());
  doc.setTitle(`Letting transaction recommendation: ${unitName}${propertyName ? `, ${propertyName}` : ""}`);
  doc.setAuthor("Bruce Gillingham Pollard");

  const markLight = wordmarkBytes("light"), markDark = wordmarkBytes("dark");
  const logoLight = markLight ? await doc.embedPng(markLight) : null;
  const logoDark = markDark ? await doc.embedPng(markDark) : null;
  const drawMark = (pg: PDFPage, img: PDFImage | null, x: number, y: number, h: number) => {
    if (img) pg.drawImage(img, { x, y, width: (img.width / img.height) * h, height: h });
  };
  // Letter-spaced capitals, as on the unit info sheet.
  const drawLabel = (pg: PDFPage, text: string, x: number, y: number, size: number, color = STONE, align: "left" | "right" = "left") => {
    const t = pdfSafe(text).toUpperCase();
    const gap = size * 0.14;
    const width = bold.widthOfTextAtSize(t, size) + gap * (t.length - 1);
    let cx = align === "right" ? x - width : x;
    for (const ch of t) {
      pg.drawText(ch, { x: cx, y, size, font: bold, color });
      cx += bold.widthOfTextAtSize(ch, size) + gap;
    }
    return width;
  };

  let page = doc.addPage(A4);
  let y = 0;
  const newPage = () => {
    page = doc.addPage(A4);
    drawMark(page, logoDark, MARGIN, ph - 50, 16);
    drawLabel(page, "Letting transaction recommendation", pw - MARGIN, ph - 46, 7.5, STONE, "right");
    y = ph - 84;
  };
  const room = (h: number) => { if (y - h < FOOT) newPage(); };
  const lines = (list: string[], x: number, size: number, f: PDFFont, lh: number, opacity = 1) => {
    for (const l of list) {
      room(lh);
      if (l) page.drawText(l, { x, y: y - size, size, font: f, color: INK, opacity });
      y -= lh;
    }
  };
  const para = (text: string, size = 10, opacity = 1) => lines(wrapBlock(text, font, size, contentW), MARGIN, size, font, size * 1.45, opacity);
  const heading = (text: string) => {
    room(64);
    y -= 14;
    page.drawText(pdfSafe(text), { x: MARGIN, y: y - 12.5, size: 12.5, font: bold, color: BORDEAUX });
    y -= 19;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: pw - MARGIN, y }, thickness: 0.8, color: BLUSH });
    y -= 9;
  };
  // Label on the left, value on the right; a long value runs on, page to page.
  const pairs = (rows: [string, string][]) => {
    const labelW = 172, valueW = contentW - labelW - 10, size = 9.5, lh = 13.5;
    for (const [label, value] of rows) {
      const ll = wrapBlock(label, font, size, labelW - 6), vl = wrapBlock(value, bold, size, valueW);
      room(Math.min(Math.max(ll.length, vl.length), 3) * lh + 7);
      const n = Math.max(ll.length, vl.length);
      for (let i = 0; i < n; i++) {
        room(lh);
        if (ll[i]) page.drawText(ll[i], { x: MARGIN, y: y - size, size, font, color: INK, opacity: QUIET });
        if (vl[i]) page.drawText(vl[i], { x: MARGIN + labelW + 10, y: y - size, size, font: bold, color: INK });
        y -= lh;
      }
      y -= 3.5;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: pw - MARGIN, y }, thickness: 0.4, color: BLUSH });
      y -= 3.5;
    }
  };
  // A small table: a cream header row (drawn again on a new page), cells
  // wrapped to their column, and an optional quiet line under a row.
  const table = (cols: { title: string; w: number; right?: boolean }[], rows: { cells: string[]; under?: string }[]) => {
    const size = 8, lh = 10.5, pad = 4;
    const header = () => {
      const titles = cols.map(c => wrapBlock(c.title, bold, 7, c.w - pad * 2));
      const h = Math.max(...titles.map(t => t.length)) * 9 + 8;
      page.drawRectangle({ x: MARGIN, y: y - h, width: contentW, height: h, color: CREAM });
      let x = MARGIN;
      cols.forEach((c, i) => {
        titles[i].forEach((t, k) => {
          const tw = bold.widthOfTextAtSize(t, 7);
          page.drawText(t, { x: c.right ? x + c.w - pad - tw : x + pad, y: y - 11 - k * 9, size: 7, font: bold, color: BORDEAUX });
        });
        x += c.w;
      });
      y -= h + 3;
    };
    room(60);
    header();
    for (const r of rows) {
      // A cell is a figure or a short note: a very long one is cut, so a row always fits a page.
      const cells = cols.map((c, i) => {
        const l = wrapBlock(r.cells[i] || "", font, size, c.w - pad * 2);
        return l.length > 14 ? [...l.slice(0, 13), "..."] : l;
      });
      const under = r.under ? wrapBlock(r.under, font, 7.5, contentW - pad * 2) : [];
      const h = Math.max(1, ...cells.map(c => c.length)) * lh + under.length * 9.5 + 7;
      if (y - h < FOOT) { newPage(); header(); }
      let x = MARGIN;
      cols.forEach((c, i) => {
        cells[i].forEach((t, k) => {
          const tw = font.widthOfTextAtSize(t, size);
          page.drawText(t, { x: c.right ? x + c.w - pad - tw : x + pad, y: y - size - 1 - k * lh, size, font, color: INK });
        });
        x += c.w;
      });
      const top = y - Math.max(1, ...cells.map(c => c.length)) * lh - 2;
      under.forEach((t, k) => page.drawText(t, { x: MARGIN + pad, y: top - 7.5 - k * 9.5, size: 7.5, font, color: INK, opacity: QUIET }));
      y -= h;
      page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: pw - MARGIN, y: y + 2 }, thickness: 0.4, color: BLUSH });
    }
    y -= 4;
  };

  // Page one. Bordeaux band: the wordmark, "Subject to contract", the client's logo.
  const bandH = 92;
  page.drawRectangle({ x: 0, y: ph - bandH, width: pw, height: bandH, color: BORDEAUX });
  drawMark(page, logoLight, MARGIN, ph - bandH + (bandH - 30) / 2, 30);
  const stcW = drawLabel(page, "Subject to contract", pw - MARGIN, ph - bandH / 2 - 4, 10.5, WHITE, "right");
  const clientLogo = await fetchLogoBytes(logoUrl);
  if (clientLogo) {
    try {
      const img = clientLogo.kind === "png" ? await doc.embedPng(clientLogo.bytes) : await doc.embedJpg(clientLogo.bytes);
      const lh = 26, lw = Math.min((img.width / img.height) * lh, 120);
      const lx = pw - MARGIN - stcW - 22 - lw;
      page.drawRectangle({ x: lx - 8, y: ph - bandH + (bandH - lh) / 2 - 6, width: lw + 16, height: lh + 12, color: WHITE, opacity: 0.92 });
      page.drawImage(img, { x: lx, y: ph - bandH + (bandH - lh) / 2, width: lw, height: lh });
    } catch {/* no co-brand */}
  }
  y = ph - bandH - 26;
  drawLabel(page, "Letting transaction recommendation", MARGIN, y - 8, 8.5, STONE);
  y -= 22;
  for (const l of wrapBlock(unitName, serif, 23, contentW).slice(0, 2)) { page.drawText(l, { x: MARGIN, y: y - 23, size: 23, font: serif, color: BORDEAUX }); y -= 28; }
  if (propertyName) { for (const l of wrapBlock(propertyName, font, 12, contentW).slice(0, 2)) { page.drawText(l, { x: MARGIN, y: y - 12, size: 12, font, color: INK }); y -= 16; } }
  y -= 10;
  const status = ws.issuedAt
    ? `Issued ${shortDay(ws.issuedAt)}${ws.issuedByName ? ` by ${ws.issuedByName}` : ""}${ws.issuedVersion !== null && ws.issuedVersion !== ws.version ? `, changed since (version ${ws.issuedVersion} was issued)` : ""}`
    : "Draft, not yet issued to the client";
  const meta: [string, string][] = [["Client", ws.unit.clientName || "Not recorded"], ["Date", today], ["Version", String(ws.version)], ["Status", status]];
  const colW = [contentW * 0.27, contentW * 0.21, contentW * 0.12, contentW * 0.40];
  const metaLines = meta.map(([, v], i) => wrapBlock(v, bold, 9.5, colW[i] - 8).slice(0, 3));
  const metaH = Math.max(...metaLines.map(l => l.length)) * 12.5 + 28;
  page.drawRectangle({ x: MARGIN, y: y - metaH, width: contentW, height: metaH, color: CREAM });
  let mx = MARGIN;
  meta.forEach(([k], i) => {
    drawLabel(page, k, mx + 8, y - 15, 6.5, STONE);
    metaLines[i].forEach((l, n) => page.drawText(l, { x: mx + 8, y: y - 30 - n * 12.5, size: 9.5, font: bold, color: INK }));
    mx += colW[i];
  });
  y -= metaH + 6;

  // 1. The recommendation, first, so a busy reader gets it.
  heading("The recommendation");
  const option = optionLabel(ws.recommendation);
  room(26);
  page.drawText(pdfSafe(option || "No recommendation chosen yet"), { x: MARGIN, y: y - 15, size: 15, font: serif, color: option ? BORDEAUX : INK });
  y -= 25;
  if (hasText(ws.summary)) para(String(ws.summary), 10.5);
  else para("The summary has not been written yet.", 10, QUIET);

  // 2. The transaction: only the fields that have a value.
  heading("The transaction");
  const termRows = RECOMMENDATION_TERM_FIELDS.filter(f => hasText(ws.terms[f.key])).map(f => [f.label, termText(f, ws.terms[f.key])] as [string, string]);
  if (termRows.length) pairs(termRows); else para("No terms have been entered yet.", 10, QUIET);

  // 3. Against the brief.
  heading("Against the brief");
  const m = ws.measure;
  const money = (n: number | null) => (n === null ? "Not provided" : fmtMoney(n) || gbp(n));
  const psf = (n: number | null) => (n === null ? "Not provided" : `£${n.toFixed(2)} per sq ft`);
  pairs([
    ["Quoting rent a year", money(m.quotingRentPa)],
    ["ERV a year", money(m.ervPa)],
    ["Headline rent a year", `${money(numOrNull(ws.terms.rentPa))}${m.headlineVsErvPct !== null ? ` (${plainNum(m.headlineVsErvPct)}% of ERV)` : ""}`],
    ["Rent per sq ft", psf(m.headlinePsf)],
    ["Net effective rent a year", money(m.nerPa)],
    ["Net effective rent less three months' fit-out", money(m.nerLessFitOutPa)],
    ["Net effective rent floor", `${money(m.nerFloorPa)}${m.nerVsFloorPct !== null ? ` (net effective rent is ${plainNum(m.nerVsFloorPct)}% of the floor)` : ""}`],
    ["Total occupational cost a year", `${money(m.occupancyCostPa)}${m.occupancyCostPsf !== null ? ` (${psf(m.occupancyCostPsf)})` : ""}`],
  ]);
  y -= 2;
  para("Net effective rent is the headline rent less the rent free and the capital contribution, spread over the term. Total occupational cost is rent, service charge, rates and insurance.", 8, QUIET);

  // 4. How the bid moved.
  heading("How the bid moved");
  if (ws.rounds.length) {
    table(
      [{ title: "Round", w: 36 }, { title: "Date", w: 62 }, { title: "Who", w: 58 }, { title: "Rent a year", w: 62, right: true }, { title: "Rent free", w: 52, right: true },
       { title: "Term", w: 46, right: true }, { title: "Capital contribution", w: 66, right: true }, { title: "Note", w: contentW - 382 }],
      ws.rounds.map(r => ({ cells: [
        String(r.roundNo), shortDate(r.roundDate), `${String(r.party || "").charAt(0).toUpperCase()}${String(r.party || "").slice(1)}`,
        r.rentPa === null ? "-" : gbp(r.rentPa), r.rentFreeMonths === null ? "-" : `${plainNum(r.rentFreeMonths)} mo`, r.termYears === null ? "-" : `${plainNum(r.termYears)} yr`,
        r.capitalContribution === null ? "-" : gbp(r.capitalContribution), r.note || "",
      ] })));
  } else para("No negotiation rounds are logged for this offer.", 10, QUIET);

  // 5. Comparable evidence.
  heading("Comparable evidence");
  if (ws.comparables.length) {
    table(
      [{ title: "Tenant and unit", w: 118 }, { title: "Date", w: 60 }, { title: "Area sq ft", w: 44, right: true }, { title: "Rent a year", w: 58, right: true },
       { title: "Rent per sq ft", w: 46, right: true }, { title: "Incentive", w: 62 }, { title: "Term and breaks", w: 50 }, { title: "Net effective less fit-out", w: contentW - 438, right: true }],
      ws.comparables.map(c => {
        const ner = recommendationNer({ rentPa: c.rentPa, termYears: c.termYears, rentFreeMonths: c.rentFreeMonths, capitalContribution: c.capitalContribution }, 3);
        const incentive = [c.rentFreeMonths !== null ? `${plainNum(c.rentFreeMonths)} mo rent free` : "", c.capitalContribution !== null && c.capitalContribution > 0 ? gbp(c.capitalContribution) : ""].filter(Boolean).join(", ");
        const under = [c.transaction, c.use, c.turnoverPct !== null ? `Turnover rent ${plainNum(c.turnoverPct)}%` : "", c.rentReview ? `Rent review: ${c.rentReview}` : "", c.comment].filter(hasText).map(v => oneLine(v)).join(" · ");
        return {
          cells: [
            [c.tenant, c.unit].filter(hasText).join("\n"), c.date ? shortDate(c.date) : "-", c.areaSqFt !== null ? plainNum(c.areaSqFt) : "-", c.rentPa !== null ? gbp(c.rentPa) : "-",
            c.rentPa !== null && c.areaSqFt ? `£${(c.rentPa / c.areaSqFt).toFixed(2)}` : "-", incentive || "-",
            [c.termYears !== null ? `${plainNum(c.termYears)} yr` : "", c.breaks || ""].filter(Boolean).join(", ") || "-", ner !== null ? gbp(ner) : "-",
          ],
          under: under || undefined,
        };
      }));
    para("Net effective rent is shown less three months' fit-out, as the client's template asks.", 8, QUIET);
  } else para("No comparable evidence has been added.", 10, QUIET);

  // 6. Commentary: each heading that has text.
  heading("Commentary");
  const written = RECOMMENDATION_COMMENTARY.filter(c => hasText(ws.commentary[c.key]));
  if (!written.length) para("No commentary has been written yet.", 10, QUIET);
  for (const c of written) {
    room(42);
    y -= 4;
    lines(wrapBlock(c.label, bold, 10, contentW), MARGIN, 10, bold, 14);
    y -= 1;
    para(String(ws.commentary[c.key]), 10);
    y -= 7;
  }

  // 7. Decision.
  heading("Decision");
  if (!ws.deciders.length) para("Nobody from the client is listed on this unit's Targeting Brief to decide.", 10, QUIET);
  else pairs(ws.deciders.map(d => {
    const by = d.recordedOnBehalf && d.decidedByName ? `, recorded by ${d.decidedByName}` : "";
    const value = d.decision
      ? `${decisionLabel(d.decision)} ${shortDay(d.decidedAt)}${by}${d.comment ? `: ${d.comment}` : ""}`
      : d.staleDecision ? "Decided an earlier version. Awaiting a decision on this version" : "Awaiting decision";
    return [`${briefRoleLabel(d.role)}: ${d.name}`, value] as [string, string];
  }));

  // The footer, on every page, once the page count is known.
  const pages = doc.getPages();
  const foot = `Bruce Gillingham Pollard. Version ${ws.version}, ${today}. Marketing advice, not a formal valuation.`;
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: MARGIN, y: 44 }, end: { x: pw - MARGIN, y: 44 }, thickness: 0.6, color: BLUSH });
    pg.drawText(foot, { x: MARGIN, y: 29, size: 7.5, font, color: INK, opacity: QUIET });
    const n = `Page ${i + 1} of ${pages.length}`;
    pg.drawText(n, { x: pw - MARGIN - font.widthOfTextAtSize(n, 7.5), y: 29, size: 7.5, font, color: INK, opacity: QUIET });
  });
  return { bytes: await doc.save(), pages: pages.length };
}

const fail = (res: Response, e: any, fallback: string) => {
  console.error("[unit-recommendation]", e?.message);
  if (!res.headersSent) res.status(500).json({ message: e?.message || fallback });
};
const NOT_STARTED = { message: "BGP has not started the recommendation for this letting yet.", code: "NOT_STARTED" };

// Remove a unit's recommendations, their decisions and history (called when the unit is deleted).
export async function deleteUnitRecommendations(unitId: string, db: Db = pool): Promise<void> {
  await db.query(`DELETE FROM unit_recommendation_decisions WHERE recommendation_id IN (SELECT id FROM unit_recommendations WHERE unit_id = $1)`, [unitId]);
  await db.query(`DELETE FROM unit_recommendation_events WHERE recommendation_id IN (SELECT id FROM unit_recommendations WHERE unit_id = $1)`, [unitId]);
  await db.query(`DELETE FROM unit_recommendations WHERE unit_id = $1`, [unitId]);
}

export function setupUnitRecommendationRoutes(app: Express) {
  // Where every recommendation the caller may see stands, by unit: the chip
  // on each tracker row. One query. A joint agent gets only issued ones.
  app.get("/api/unit-recommendations/summary", requireAuth, async (req, res) => {
    try {
      const scope = await resolveCompanyScope(req);
      const isClient = await isClientRequestUser(req);
      if (!scope && isClient) return res.json({});
      let propertyIds: string[] | null = null;
      // Everyone who may open the unit sees its recommendation, drafts
      // included (a joint agent writes it with BGP).
      const issuedOnly = false;
      if (scope) {
        propertyIds = (await pool.query(
          `SELECT id FROM crm_properties WHERE landlord_id = $1
           UNION
           SELECT property_id FROM crm_company_properties WHERE company_id = $1`, [scope])).rows.map((r: any) => r.id);
        const schemeIds = await briefSchemePropertyIds(req);
        if (schemeIds) propertyIds = propertyIds!.filter(id => schemeIds.has(id));
        if (propertyIds!.length === 0) return res.json({});
      }
      const rows = (await pool.query(
        `SELECT r.unit_id, r.issued_at,
                (SELECT COUNT(*)::int FROM unit_brief_people p WHERE p.brief_id = b.id AND p.role = ANY($2::text[])) AS total,
                (SELECT COUNT(*)::int FROM unit_brief_people p
                   JOIN unit_recommendation_decisions d ON d.recommendation_id = r.id AND d.brief_person_id = p.id AND d.version = r.version
                  WHERE p.brief_id = b.id AND p.role = ANY($2::text[]) AND d.decision = 'approved') AS approved,
                (SELECT COUNT(*)::int FROM unit_brief_people p
                   JOIN unit_recommendation_decisions d ON d.recommendation_id = r.id AND d.brief_person_id = p.id AND d.version = r.version
                  WHERE p.brief_id = b.id AND p.role = ANY($2::text[]) AND d.decision = 'declined') AS declined
           FROM unit_recommendations r
           JOIN available_units au ON au.id = r.unit_id AND COALESCE(au.deal_id, '') = COALESCE(r.deal_id, '')
           LEFT JOIN LATERAL (SELECT id FROM unit_briefs ub WHERE ub.unit_id = au.id ORDER BY ub.created_at DESC LIMIT 1) b ON true
          WHERE ($1::text[] IS NULL OR au.property_id = ANY($1::text[]))
            AND (NOT $3::boolean OR r.issued_at IS NOT NULL)`, [propertyIds, DECIDER_ROLES, issuedOnly])).rows;
      const out: Record<string, RecommendationSummary> = {};
      for (const r of rows) {
        const issued = !!r.issued_at;
        const stage: RecommendationStage = !issued ? "draft" : r.total > 0 && r.approved === r.total ? "approved" : r.declined > 0 ? "declined" : "issued";
        out[r.unit_id] = { stage, approved: issued ? r.approved : 0, total: r.total, issuedAt: iso(r.issued_at) };
      }
      res.json(out);
    } catch (e: any) { fail(res, e, "Failed to load the recommendations"); }
  });

  // Everything the dialog shows.
  app.get("/api/unit-recommendations/:unitId", requireAuth, async (req, res) => {
    try {
      const ctx = await openUnit(req, res);
      if (!ctx) return;
      res.json(await buildWorkspace(ctx.unit.id, ctx.access));
    } catch (e: any) { fail(res, e, "Failed to load the recommendation"); }
  });

  // Start it from the agreed offer. Two starts at once make one recommendation.
  app.post("/api/unit-recommendations/:unitId/start", requireAuth, async (req, res) => {
    try {
      const ctx = await openUnit(req, res);
      if (!ctx) return;
      const { access } = ctx;
      if (!canWrite(access)) return res.status(403).json({ message: "BGP and the joint agent write the recommendation" });
      await withUnitLock(ctx.unit.id, async () => {
        const unit = await loadUnit(ctx.unit.id);
        if (!unit) return void res.status(404).json({ message: "That unit is not on the tracker" });
        if (await loadRec(unit)) return void res.json(await buildWorkspace(unit.id, access));
        const offer = await agreedOfferFor(unit.id);
        if (!offer) return void res.status(409).json({ message: "No offer on this unit has agreed terms yet. Agree the terms on an offer first.", code: "NO_AGREED_OFFER" });
        const { brief, people } = await briefAndPeople(unit.id);
        const terms = await startingTerms(unit, offer, brief);
        const made = (await pool.query(
          `INSERT INTO unit_recommendations (unit_id, deal_id, offer_id, version, terms, comparables, commentary, created_by_user_id, created_by_name, updated_by_name)
           VALUES ($1, $2, $3, 1, $4::jsonb, '[]'::jsonb, '{}'::jsonb, $5, $6, $6)
           ON CONFLICT (unit_id, COALESCE(deal_id, '')) DO NOTHING RETURNING id`,
          [unit.id, unit.deal_id || null, offer.id, JSON.stringify(terms), access.userId, access.name])).rows[0];
        if (made) await logEvent(made.id, access, people, "started", `started the recommendation from ${offer.company_name || "the tenant"}'s agreed offer of ${shortDate(offer.offer_date)}`, 1);
        res.json(await buildWorkspace(unit.id, access));
      });
    } catch (e: any) { fail(res, e, "Failed to start the recommendation"); }
  });

  // Save the terms, the comparables, the commentary, the recommendation and
  // the summary. After issue a change raises the version.
  app.put("/api/unit-recommendations/:unitId/content", requireAuth, async (req, res) => {
    try {
      const ctx = await openUnit(req, res);
      if (!ctx) return;
      const { access } = ctx;
      if (!canWrite(access)) return res.status(403).json({ message: "BGP and the joint agent write the recommendation" });
      const baseVersion = Number(req.body?.baseVersion);
      if (!Number.isInteger(baseVersion)) return res.status(400).json({ message: "Say which version you were editing (baseVersion)" });
      const parsed = parsePatch(req.body);
      if (!parsed.ok) return res.status(400).json({ message: parsed.message });
      await withUnitLock(ctx.unit.id, async () => {
        const unit = await loadUnit(ctx.unit.id);
        if (!unit) return void res.status(404).json({ message: "That unit is not on the tracker" });
        const rec = await loadRec(unit);
        if (!rec) return void res.status(409).json(NOT_STARTED);
        if (baseVersion !== rec.version) {
          return void res.status(409).json({ message: "Someone else changed the recommendation while you were editing. Load the latest version, then make your changes again.", code: "STALE", workspace: await buildWorkspace(unit.id, access) });
        }
        await writeChange(rec, unit, applyPatch(storedOf(rec), parsed.patch), access, null);
        res.json(await buildWorkspace(unit.id, access));
      });
    } catch (e: any) { fail(res, e, "Failed to save the recommendation"); }
  });

  // Re-read the terms the agreed offer gives. What a person wrote stays.
  app.post("/api/unit-recommendations/:unitId/refresh", requireAuth, async (req, res) => {
    try {
      const ctx = await openUnit(req, res);
      if (!ctx) return;
      const { access } = ctx;
      if (!canWrite(access)) return res.status(403).json({ message: "BGP and the joint agent write the recommendation" });
      await withUnitLock(ctx.unit.id, async () => {
        const unit = await loadUnit(ctx.unit.id);
        if (!unit) return void res.status(404).json({ message: "That unit is not on the tracker" });
        const rec = await loadRec(unit);
        if (!rec) return void res.status(409).json(NOT_STARTED);
        const offer = await agreedOfferFor(unit.id);
        if (!offer) return void res.status(409).json({ message: "No offer on this unit has agreed terms now, so there is nothing to refresh from.", code: "NO_AGREED_OFFER" });
        // Only what the offer holds is written: a term the offer does not
        // give is left as the person has it.
        const fresh = await offerTerms(offer);
        const before = storedOf(rec);
        const terms: RecommendationTerms = { ...before.terms };
        for (const key of OFFER_TERM_KEYS) if (hasText(fresh[key])) terms[key] = fresh[key];
        const changed = await writeChange(rec, unit, { ...before, terms }, access, `refreshed the terms from ${offer.company_name || "the tenant"}'s agreed offer of ${shortDate(offer.offer_date)}`);
        if (rec.offer_id !== offer.id) await pool.query(`UPDATE unit_recommendations SET offer_id = $2 WHERE id = $1`, [rec.id, offer.id]);
        res.json({ ...(await buildWorkspace(unit.id, access)), refreshed: changed });
      });
    } catch (e: any) { fail(res, e, "Failed to refresh the recommendation"); }
  });

  // Lettings already in the app at the same property, to copy into a
  // comparable row. Picking one copies the figures; it is then just a row.
  app.get("/api/unit-recommendations/:unitId/comparable-candidates", requireAuth, async (req, res) => {
    try {
      const ctx = await openUnit(req, res);
      if (!ctx) return;
      const { unit, access } = ctx;
      if (!canWrite(access)) return res.status(403).json({ message: "BGP and the joint agent add the comparable evidence" });
      if (!unit.property_id) return res.json({ candidates: [] });
      const day = (d: any): string | null => (d ? new Date(d).toISOString().slice(0, 10) : null);
      const deals = (await pool.query(
        `SELECT d.id, d.deal_type, d.total_area_sqft, d.rent_pa, d.rent_free, d.lease_length, d.break_option, d.capital_contribution,
                COALESCE(d.completed_at, d.exchanged_at) AS done_at, tc.name AS tenant_name, d.name AS deal_name,
                (SELECT au.unit_name FROM available_units au WHERE au.deal_id = d.id ORDER BY au.created_at LIMIT 1) AS unit_name,
                (SELECT au.use_class FROM available_units au WHERE au.deal_id = d.id ORDER BY au.created_at LIMIT 1) AS use_class
           FROM crm_deals d LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
          WHERE d.property_id = $1 AND d.id <> COALESCE($2, '') AND d.rent_pa > 0
            AND lower(trim(coalesce(d.status, ''))) = ANY($3::text[])
          ORDER BY COALESCE(d.completed_at, d.exchanged_at) DESC NULLS LAST, d.updated_at DESC NULLS LAST LIMIT 30`,
        [unit.property_id, unit.deal_id || null, statusSpellingsFor(["EXC", "COM", "INV"])])).rows;
      const candidates: (Omit<RecommendationComparable, "id"> & { key: string; source: "deal" | "comps"; sourceLabel: string })[] = deals.map((d: any) => ({
        key: `deal:${d.id}`, source: "deal" as const, sourceLabel: "A letting on this scheme",
        transaction: d.deal_type || null, date: day(d.done_at), tenant: d.tenant_name || null,
        unit: [d.unit_name || d.deal_name, unit.property_name].filter(hasText).join(", ") || null,
        areaSqFt: numOrNull(d.total_area_sqft), use: d.use_class || null, rentPa: numOrNull(d.rent_pa), turnoverPct: null,
        rentFreeMonths: numOrNull(d.rent_free), capitalContribution: numOrNull(d.capital_contribution), termYears: numOrNull(d.lease_length),
        breaks: d.break_option || null, rentReview: null, comment: null, dealId: d.id,
      }));
      // The comps schedule has no property link: a row is offered when its
      // address names the scheme or carries the property's postcode.
      const name = String(unit.property_name || "").trim();
      const postcode = String(unit.property_postcode || "").replace(/\s+/g, "").toLowerCase();
      if (name.length >= 4 || postcode) {
        const comps = (await pool.query(
          `SELECT id, address, tenant, use_class, rent_pa, area_sqft, premium, rent_free_months, lease_date, term_years, break_years, notes
             FROM retail_leasing_comps
            WHERE rent_pa > 0 AND (($1 <> '' AND (address ILIKE '%' || $1 || '%' OR submarket ILIKE '%' || $1 || '%'))
                                OR ($2 <> '' AND lower(replace(coalesce(postcode, ''), ' ', '')) = $2))
            ORDER BY lease_date DESC NULLS LAST, created_at DESC LIMIT 30`,
          [name.length >= 4 ? name.replace(/[%_\\]/g, m => `\\${m}`) : "", postcode])).rows;
        for (const c of comps) {
          const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(c.lease_date || ""));
          const date = m ? (m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`) : null;
          const premium = numOrNull(c.premium);
          candidates.push({
            key: `comps:${c.id}`, source: "comps", sourceLabel: "From the comps schedule",
            transaction: null, date: date && validComparableDate(date) ? date : null, tenant: c.tenant || null, unit: c.address || null,
            areaSqFt: numOrNull(c.area_sqft), use: c.use_class || null, rentPa: numOrNull(c.rent_pa), turnoverPct: null,
            rentFreeMonths: numOrNull(c.rent_free_months), capitalContribution: null, termYears: numOrNull(c.term_years),
            breaks: numOrNull(c.break_years) !== null ? `Break at year ${plainNum(c.break_years)}` : null, rentReview: null,
            comment: [premium !== null && premium > 0 ? `Premium of ${gbp(premium)}.` : "", hasText(c.notes) ? String(c.notes).trim() : ""].filter(Boolean).join(" ").slice(0, 1000) || null,
            dealId: null,
          });
        }
      }
      res.json({ candidates });
    } catch (e: any) { fail(res, e, "Failed to load lettings on this scheme"); }
  });

  // Help me write it: a draft of one section for the person to edit.
  // Nothing is saved here.
  app.post("/api/unit-recommendations/:unitId/draft-ai", requireAuth, async (req, res) => {
    try {
      const ctx = await openUnit(req, res);
      if (!ctx) return;
      const { unit, access } = ctx;
      if (!canWrite(access)) return res.status(403).json({ message: "BGP and the joint agent write the recommendation" });
      const section = req.body?.section;
      if (typeof section !== "string" || (section !== "summary" && !RECOMMENDATION_COMMENTARY.some(c => c.key === section))) {
        return res.status(400).json({ message: "Say which section to draft: the summary or one of the commentary headings" });
      }
      const ws = await buildWorkspace(unit.id, access);
      if (!ws.id) return res.status(409).json(NOT_STARTED);
      if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) return res.status(503).json({ message: AI_UNAVAILABLE, code: "AI_UNAVAILABLE" });
      const { brief } = await briefAndPeople(unit.id);
      const prompt = recommendationDraftPrompt(ws, { objective: brief?.objective || null, targetCriteria: brief?.target_criteria || null }, section);
      try {
        // Anthropic, the one provider Landsec data may go to.
        const { getAnthropicClient } = await import("./utils/anthropic-client");
        const response = await getAnthropicClient().messages.create({
          model: "claude-sonnet-4-6", max_tokens: 700, system: prompt.system, messages: [{ role: "user", content: prompt.user }],
        });
        const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
        if (!text) throw new Error("AI returned nothing");
        const max = section === "summary" ? SUMMARY_MAX : COMMENTARY_MAX;
        res.json({ text: text.replace(/\s*[—–]\s*/g, ", ").slice(0, max) });
      } catch (e: any) {
        console.warn("[unit-recommendation] draft failed:", e?.message);
        res.status(503).json({ message: "AI help could not draft this section just now. Write it yourself, or try again in a moment.", code: "AI_FAILED" });
      }
    } catch (e: any) { fail(res, e, "Failed to draft the section"); }
  });

  // Issue it to the client: the deciders are emailed. A failed email never
  // fails the issue. Re-issuing after a change is the same action.
  app.post("/api/unit-recommendations/:unitId/issue", requireAuth, async (req, res) => {
    try {
      const ctx = await openUnit(req, res);
      if (!ctx) return;
      const { access } = ctx;
      if (!access.isStaff) return res.status(403).json({ message: `${STAFF_ONLY}: BGP issues the recommendation to the client` });
      const refuse = (status: number, body: Record<string, unknown>): null => { res.status(status).json(body); return null; };
      const issued = await withUnitLock(ctx.unit.id, async (): Promise<{ rec: any; unit: any; reissue: boolean } | null> => {
        const unit = await loadUnit(ctx.unit.id);
        if (!unit) return refuse(404, { message: "That unit is not on the tracker" });
        const rec = await loadRec(unit);
        if (!rec) return refuse(409, NOT_STARTED);
        // Pressed twice on the same version: nothing more to do.
        if (rec.issued_at && rec.issued_version === rec.version) {
          return refuse(200, { ...(await buildWorkspace(unit.id, access)), emailed: 0, emailFailed: [], emailReason: null, alreadyIssued: true });
        }
        if (!hotsIssued(unit)) {
          return refuse(409, { message: "The Heads of Terms have not been issued to the tenant yet. Issue them first, then issue the recommendation.", code: "HOTS_NOT_ISSUED" });
        }
        const missing = recommendationMissing(storedOf(rec));
        if (missing.length) {
          return refuse(409, { message: `Still to write before this can be issued: ${missing.join("; ")}.`, code: "INCOMPLETE", missing });
        }
        const reissue = !!rec.issued_at;
        await pool.query(
          `UPDATE unit_recommendations SET issued_at = NOW(), issued_version = version, issued_by_user_id = $2, issued_by_name = $3, updated_at = NOW() WHERE id = $1`,
          [rec.id, access.userId, access.name]);
        const { people } = await briefAndPeople(unit.id);
        await logEvent(rec.id, access, people, "issued",
          `${reissue ? `issued version ${rec.version} of the recommendation` : "issued the recommendation"} to ${unit.landlord_name || "the client"}${decidersOf(people).length ? "" : ". Nobody from the client is on the brief to decide it"}`, rec.version);
        await refreshDecided(rec.id, unit.id);
        return { rec, unit, reissue };
      });
      if (!issued) return;
      const { rec, unit, reissue } = issued;
      const ws = await buildWorkspace(unit.id, access);
      const { people } = await briefAndPeople(unit.id);
      const results = await Promise.all(decidersOf(people).map(async (p: any) => {
        if (!hasText(p.email)) return { name: p.name as string, reason: "no email address is recorded" };
        const way = !p.user_id ? null : ["asset_manager", "joint_agent"].includes(String(p.landsec_role || "")) ? "landsec_unit" as const : "tracker" as const;
        const mail = recommendationEmail(ws, { name: p.name, way }, access.name, reissue);
        return { name: p.name as string, reason: await sendEmail(String(p.email).trim(), mail.subject, mail.html, unit.landlord_name) };
      }));
      const failed = results.filter(r => r.reason);
      const reasons = [...new Set(failed.map(r => r.reason as string))];
      const emailReason = failed.length === 0 ? null
        : reasons.length === 1 ? `${failed.length === 1 ? "The email" : "The emails"} could not be sent: ${reasons[0]}.`
        : failed.map(r => `${r.name}: ${r.reason}`).join("; ");
      if (failed.length) {
        await logEvent(rec.id, access, people, "email_failed",
          `could not email ${listNames(failed.map(r => r.name))}: ${reasons.length === 1 ? reasons[0] : failed.map(r => `${r.name}, ${r.reason}`).join("; ")}. Tell them yourself`, rec.version);
      }
      res.json({ ...(failed.length ? await buildWorkspace(unit.id, access) : ws), emailed: results.length - failed.length, emailFailed: failed.map(r => r.name), emailReason });
    } catch (e: any) { fail(res, e, "Failed to issue the recommendation"); }
  });

  // Decide: approve, raise a query or decline, on the current version. A
  // decider decides as themselves; BGP staff record a decision only for a
  // decider with no login, and the record says who recorded it.
  app.post("/api/unit-recommendations/:unitId/decide", requireAuth, async (req, res) => {
    try {
      const ctx = await openUnit(req, res);
      if (!ctx) return;
      const { access } = ctx;
      if (isJointAgent(access)) return res.status(403).json({ message: "The client's leasing and asset managers decide the recommendation." });
      const b = req.body || {};
      const briefPersonId = b.briefPersonId;
      if (briefPersonId !== undefined && briefPersonId !== null && typeof briefPersonId !== "string") return res.status(400).json({ message: "Pick the person whose decision this is" });
      if (typeof b.decision !== "string" || !RECOMMENDATION_DECISIONS.some(d => d.key === b.decision)) {
        return res.status(400).json({ message: "The decision is one of: approved, query or declined" });
      }
      const decision = b.decision as RecommendationDecision;
      if (b.comment !== undefined && b.comment !== null && typeof b.comment !== "string") return res.status(400).json({ message: "The comment must be text" });
      const comment = typeof b.comment === "string" ? tidy(b.comment) : "";
      if (comment.length > DECISION_COMMENT_MAX) return res.status(400).json({ message: `The comment is too long (${plainNum(comment.length)} characters). The limit is ${plainNum(DECISION_COMMENT_MAX)}.` });
      if (decision !== "approved" && !comment) return res.status(400).json({ message: decision === "query" ? "Say what the query is" : "Say why the recommendation is declined" });
      await withUnitLock(ctx.unit.id, async () => {
        const unit = await loadUnit(ctx.unit.id);
        if (!unit) return void res.status(404).json({ message: "That unit is not on the tracker" });
        const rec = await loadRec(unit);
        if (!rec) return void res.status(409).json(NOT_STARTED);
        const { people } = await briefAndPeople(unit.id);
        const deciders = decidersOf(people);
        const person = briefPersonId ? deciders.find(p => p.id === briefPersonId) : deciders.find(p => isSelfPerson(p, access));
        if (!person) {
          return void (briefPersonId
            ? res.status(400).json({ message: "That person is not one of the client's decision-makers on this unit's Targeting Brief" })
            : res.status(403).json({ message: "You are not listed on this unit's Targeting Brief as a decision-maker for the client, so you can read the recommendation but not decide it." }));
        }
        const isSelf = isSelfPerson(person, access);
        if (!isSelf && !access.isStaff) return void res.status(403).json({ message: `Only ${person.name} can decide as ${person.name}` });
        if (!isSelf && person.user_id) return void res.status(403).json({ message: `${person.name} has a login and decides for themselves` });
        if (!rec.issued_at) return void res.status(409).json({ message: "The recommendation has not been issued yet, so there is nothing to decide.", code: "NOT_ISSUED" });
        const seen = Number(b.version);
        if (!Number.isInteger(seen) || seen !== rec.version) return void res.status(409).json({ message: "The recommendation changed. Read the latest version before deciding.", code: "STALE" });
        const was = (await pool.query(`SELECT version, decision, comment FROM unit_recommendation_decisions WHERE recommendation_id = $1 AND brief_person_id = $2`, [rec.id, person.id])).rows[0] || null;
        const stored = comment || null;
        // The same decision again on the same version keeps the first date.
        if (!was || was.version !== rec.version || was.decision !== decision || (was.comment || null) !== stored) {
          await pool.query(
            `INSERT INTO unit_recommendation_decisions (recommendation_id, brief_person_id, version, decision, comment, decided_at, decided_by_user_id, decided_by_name)
             VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
             ON CONFLICT (recommendation_id, brief_person_id) DO UPDATE
                SET version = EXCLUDED.version, decision = EXCLUDED.decision, comment = EXCLUDED.comment, decided_at = EXCLUDED.decided_at,
                    decided_by_user_id = EXCLUDED.decided_by_user_id, decided_by_name = EXCLUDED.decided_by_name`,
            [rec.id, person.id, rec.version, decision, stored, access.userId, access.name]);
          const said = decision === "approved" ? "approved the recommendation" : decision === "query" ? "raised a query" : "declined the recommendation";
          const changedMind = !!was && was.version === rec.version && was.decision !== decision;
          const body = isSelf
            ? `${changedMind ? `changed their decision from "${decisionLabel(was.decision)}" to "${decisionLabel(decision)}"` : said}${stored ? `: ${stored}` : ""}`
            : `recorded ${person.name}'s decision (${briefRoleLabel(person.role)}): ${changedMind ? `changed from "${decisionLabel(was.decision)}" to "${decisionLabel(decision)}"` : decisionLabel(decision).toLowerCase()}${stored ? `: ${stored}` : ""}`;
          await logEvent(rec.id, access, people, "decided", body, rec.version);
        }
        await refreshDecided(rec.id, unit.id);
        res.json(await buildWorkspace(unit.id, access));
      });
    } catch (e: any) { fail(res, e, "Failed to record the decision"); }
  });

  // The recommendation as a BGP document. Anyone who may read it; a joint
  // agent only once it has been issued.
  app.get("/api/unit-recommendations/:unitId/pdf", requireAuth, async (req, res) => {
    try {
      const ctx = await openUnit(req, res);
      if (!ctx) return;
      const { unit, access } = ctx;
      const ws = await buildWorkspace(unit.id, access);
      if (!ws.id) {
        return res.status(404).json({ message: "There is no recommendation for this letting yet" });
      }
      const { bytes } = await buildRecommendationPdf(ws, unit.landlord_logo_url || null);
      const clean = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ._&'()-]/g, " ").replace(/\s+/g, " ").trim();
      const name = `Recommendation - ${clean([unit.unit_name, unit.property_name || ""].join(" ")).slice(0, 110).trim() || "Unit"}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", String(bytes.length));
      res.setHeader("Content-Disposition", contentDispositionFor(name, req.query.view === "1" ? "inline" : "attachment"));
      res.setHeader("Cache-Control", "private, no-store");
      res.end(Buffer.from(bytes));
    } catch (e: any) { fail(res, e, "Failed to make the PDF"); }
  });
}

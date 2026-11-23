// BGP's sign-off on a deal party, and KYC4U's result added by hand (Woody,
// 18 November 2026: step 2 of docs/deal-page-review-2026-11-18.md, "Ok go
// ahead with your suggestions I will do the requests"). The rules are
// shared/party-kyc.ts and shared/aml-policy.ts.
//
// Who decides (BGP's AML policy, Issue 2; Woody, 19 November 2026): a
// standard or simplified party is signed off by the deal's agents, the
// Nominated Officer or the Deputy; KYC4U's result, a red flag set aside, and
// a party marked Not required are the Nominated Officer's or the Deputy's
// (admins until a Nominated Officer is set: amlActor), signed in as
// themselves.
//
//   POST /api/deals/:id/parties/:role/sign-off            { note }: signs the party off for the policy's re-check period
//   POST /api/deals/:id/parties/:role/kyc4u-result        multipart: verdict, date, reference, note, files[] (KYC4U's zip opened)
//   POST /api/deals/:id/parties/:role/kyc4u-result/read   multipart: files[]: where each will be filed and what KYC4U's report says (saves nothing)
//   POST /api/deals/:id/parties/:role/public-figure       multipart: key, note, links, files[]: a person verified from public sources
//   POST /api/deals/:id/parties/:role/public-figure/:checkId/withdraw
//   POST /api/deals/:id/parties/:role/reliance            multipart: the firm, its supervisor, the date it agreed, the confirmations, note, files[]
//   POST /api/deals/:id/parties/:role/reliance/:relianceId/withdraw
//   POST /api/deals/:id/parties/:role/not-required        { reason, comment }: no checks needed on this party
//   POST /api/deals/:id/parties/:role/not-required/undo   takes the marker off
//
// Each acts on the company that signs when the deal names one (its own
// crm_entity_kyc record), else on the brand (crm_companies.kyc_*), and
// re-derives every deal that carries it. A routine party is signed off by
// BGP; one with a red flag, a higher-risk file or a request already with
// KYC4U goes to KYC4U, whose result is added here (Woody, 17 November 2026:
// "basically we do the normal checks expected and if there is a red flag
// then we get KYC4U"). KYC4U's result is a request row like the ones the
// bookmark brings in (list "manual"), applied by the KYC4U mirror, so a
// later KYC4U status for the same party replaces it as before.

import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import crypto from "crypto";
import { pool } from "./db";
import { DEAL_PARTY_COLUMNS, DEAL_PARTY_LABEL, isDealPartyRole, partySubjectKind, type DealPartyRole } from "@shared/deal-parties";
import {
  IN_HOUSE_EDD_NOTE_MIN, KYC4U_RESULTS, KYC4U_RESULT_MAX_BYTES, KYC4U_RESULT_MAX_FILES, SIGN_OFF_NOTE_MIN,
  isKyc4uResultKey, kyc4uResultDate, kycVerdict, sameLegalCompany, signOffDenial, signOffEnhanced,
  type PartyKycState, type SignOffFacts,
} from "@shared/party-kyc";
import { isSanctionsFlag } from "@shared/kyc-red-flags";
import {
  DUE_DILIGENCE_LABEL, NOT_REQUIRED_REASONS, RECHECK_YEARS, amlRegime, deputyNames, isDealAgent, jointAgentRule, jointAskWords, notRequiredInput, officerWords,
  type AmlOfficers, type AmlRegime, type JointAgentRule, type PartyDueDiligence,
} from "@shared/aml-policy";
import { KYC4U_PACK_MAX_ZIP_BYTES, kyc4uAssessmentRecord, kyc4uResultPrefill, kyc4uRiskLevel } from "@shared/kyc4u-result-pack";
import { amlFileDocWords } from "@shared/aml-file";
import { PUBLIC_FIGURE_MAX_LINKS, PUBLIC_FIGURE_NOTE_MIN } from "@shared/kyc-people";
import { relianceInput, relianceWords } from "@shared/aml-reliance";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

export interface AmlParty {
  dealId: string;
  dealName: string;
  role: DealPartyRole;
  brandId: string;
  brandName: string;
  entityId: string | null;   // the company that signs, when the deal names one filed under the brand
  entityName: string | null;
  sameCompany: boolean;      // that company is the brand's own legal company
  state: PartyKycState;
  regime: AmlRegime;         // which checks the deal needs (AML policy A)
  jointRule: JointAgentRule; // HMRC's joint agent route for the deal (22 November 2026)
  agents: { ids: string[]; names: string[] }; // the deal's agents (internal_agent_ids / internal_agent)
}

/** One party of a deal, with its AML state read the gate's way (loadPartyKyc). */
export async function loadAmlParty(db: Db, dealId: string, role: DealPartyRole): Promise<AmlParty | null> {
  const col = DEAL_PARTY_COLUMNS[role];
  const deal = (await db.query(
    `SELECT id, name, ${col.brand} AS brand_id, ${col.company} AS entity_id, deal_type, team, rent_pa, internal_agent_ids, internal_agent
       FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
  if (!deal?.brand_id) return null;
  const entity = deal.entity_id ? (await db.query(
    `SELECT e.id, e.name, e.companies_house_number, c.name AS brand_name, c.companies_house_number AS brand_number,
            c.uk_entity_name, c.companies_house_data->>'company_name' AS ch_name
       FROM crm_trading_entities e JOIN crm_companies c ON c.id = e.parent_company_id
      WHERE e.id = $1 AND e.parent_company_id = $2`, [deal.entity_id, deal.brand_id])).rows[0] || null : null;
  const { loadPartyKyc } = await import("./deal-gates");
  const state = (await loadPartyKyc(db, [{ role, brandId: deal.brand_id, entityId: entity?.id || null }]))[role];
  if (!state?.brandName) return null;
  const sameCompany = !!entity && sameLegalCompany(
    { id: deal.brand_id, name: entity.brand_name, companiesHouseNumber: entity.brand_number || null, legalName: entity.uk_entity_name || entity.ch_name || null, status: null, expiresAt: null, approvedBy: null },
    { id: entity.id, name: entity.name, companiesHouseNumber: entity.companies_house_number || null, kyc: null });
  return {
    dealId: deal.id, dealName: text(deal.name) || "this transaction", role,
    brandId: String(deal.brand_id), brandName: state.brandName,
    entityId: entity ? String(entity.id) : null, entityName: entity ? text(entity.name) : null,
    sameCompany, state,
    regime: amlRegime({ dealType: deal.deal_type, team: deal.team, rentPa: deal.rent_pa }).regime,
    jointRule: jointAgentRule({ dealType: deal.deal_type, team: deal.team, rentPa: deal.rent_pa }),
    agents: {
      ids: Array.isArray(deal.internal_agent_ids) ? deal.internal_agent_ids.filter(Boolean).map(String) : [],
      names: Array.isArray(deal.internal_agent) ? deal.internal_agent.map(text).filter(Boolean) : [],
    },
  };
}

// Raised with KYC4U from this deal and not answered yet: a request submitted
// on KYC4U's portal for this party in the last 180 days (one only prepared in
// the app is not with them: Jack, 20 November 2026), whose
// KYC4U request is not linked yet or still reads as with KYC4U.
async function raisedWithKyc4u(db: Db, party: AmlParty): Promise<boolean> {
  const rows = (await db.query(
    `SELECT d.status, q.status AS request_status, d.request_item_id
       FROM kyc4u_drafts d
       LEFT JOIN kyc4u_requests q ON q.list_id = d.request_list_id AND q.item_id = d.request_item_id
      WHERE d.deal_id = $1 AND d.company_id = $2 AND d.status IN ('filled', 'submitted')
        AND d.created_at > now() - interval '180 days'`, [party.dealId, party.brandId]).catch(() => ({ rows: [] as any[] }))).rows;
  if (!rows.length) return false;
  const { kyc4uVerdict } = await import("./kyc4u");
  return rows.some((r: any) => !r.request_item_id || kyc4uVerdict(r.request_status) === "in_review");
}

export interface KnownFacts {
  redFlags?: {
    parties: Record<string, unknown[]>; deal: unknown[]; unchecked: string[];
    setAside?: Record<string, Array<{ flag: { key: string } }>>;
    levels?: Record<string, PartyDueDiligence>;
  } | null;
  precheck?: { ranAt: string | null; running: boolean; ownersAbroad?: string[] } | null;
}

/** What BGP's sign-off rule needs, read from the records (the note aside), and the party's level under the policy. */
export async function signOffFacts(db: Db, party: AmlParty, known: KnownFacts = {}): Promise<Omit<SignOffFacts, "note"> & { level: PartyDueDiligence | null }> {
  const verdict = kycVerdict(party.state);
  const flags = known.redFlags ?? await (await import("./kyc-red-flags"))
    .loadDealRedFlags(party.dealId, [party.brandId], party.entityId ? { [party.brandId]: party.entityId } : {});
  const held = (await db.query(
    `SELECT aml_risk_level, aml_edd_required, aml_pep_status, aml_cdd_form, aml_subject_type FROM crm_companies WHERE id = $1`, [party.brandId])).rows[0] || null;
  // A record field whose flag the MLRO set aside with a comment does not make
  // the file higher risk either (the old automatic screening's marks).
  const aside = new Set((flags?.setAside?.[party.brandId] || []).map((x: any) => String(x?.flag?.key || "")));
  const brand = held ? {
    ...held,
    aml_risk_level: aside.has("record:high_risk") ? null : held.aml_risk_level,
    aml_edd_required: aside.has("record:edd") ? false : held.aml_edd_required,
    aml_pep_status: aside.has("record:screening") ? null : held.aml_pep_status,
  } : null;
  const { isHigherRisk } = await import("@shared/aml-checklist");
  let precheck = known.precheck ?? null;
  if (!precheck) {
    const { latestPrecheck, precheckRunning } = await import("./kyc-prechecks");
    const stored = await latestPrecheck(party.brandId, party.entityId).catch(() => null);
    const { ownersAbroadOf } = await import("@shared/kyc-prechecks");
    precheck = {
      ranAt: stored?.ranAt || null, running: !!precheckRunning(party.brandId, party.entityId),
      ownersAbroad: ownersAbroadOf(stored?.result?.companiesHouse).map(a => `${a.name}, ${a.country}`),
    };
  }
  // The request to the person acting finished, and every person to check
  // has sent what they owe (Woody, 19 November 2026: the owners and the
  // person acting each do their own identity check and proof of address).
  // A person's own request finishing is not the party's checks finishing.
  const mainFinished = (await db.query(
    `SELECT 1 FROM kyc_upload_tokens
      WHERE deal_id = $1 AND company_id = $2 AND trading_entity_id IS NOT DISTINCT FROM $3
        AND completed_at IS NOT NULL AND COALESCE(is_test, false) = false
        AND COALESCE(jsonb_typeof(request->'person'), 'null') <> 'object'
        AND COALESCE(request->>'audience', 'client') <> 'joint_agent' LIMIT 1`,
    [party.dealId, party.brandId, party.entityId]).catch(() => ({ rows: [] as any[] }))).rows.length > 0;
  const signer = party.entityId ? (await db.query(`SELECT entity_kind FROM crm_trading_entities WHERE id = $1`, [party.entityId]).catch(() => ({ rows: [] as any[] }))).rows[0] || { entity_kind: null } : null;
  const kind = partySubjectKind(held?.aml_subject_type, signer ? { kind: signer.entity_kind } : null);
  const people = await import("./kyc-people")
    .then(async m => m.partyPeopleFor({ companyId: party.brandId, entityId: party.entityId, kind, dealId: party.dealId }, await m.dealPeopleRequests(party.dealId, db)))
    .catch(() => null);
  // People that could not be read count as outstanding: a note is asked for.
  const outstanding = people ? people.outstanding : ["the people to check could not be read"];
  // Another firm's checks the officers rely on (reg 39) stand in for the client checks.
  const reliance = people?.reliance?.words || null;
  const finished = mainFinished && !outstanding.length;
  return {
    rejected: party.state.status === "rejected",
    current: verdict.approved ? { by: party.state.approvedBy, until: party.state.expiresAt ? new Date(party.state.expiresAt).toISOString() : null } : null,
    withKyc4u: await raisedWithKyc4u(db, party),
    redFlags: (flags?.parties?.[party.brandId] || []).length,
    dealRedFlags: (flags?.deal || []).length,
    unchecked: flags?.unchecked || [],
    higherRisk: isHigherRisk(brand),
    precheck: precheck.ranAt ? { ranAt: precheck.ranAt } : null,
    precheckRunning: precheck.running,
    clientChecksFinished: finished,
    clientChecksOutstanding: mainFinished ? outstanding : [],
    sanctionsOnly: party.regime === "sanctions_only",
    ownersAbroad: precheck.ownersAbroad || [],
    reliance,
    inHouseEdd: (await (await import("./aml-authority")).readInHouseEdd()).on,
    sanctionsFlags: [...(flags?.parties?.[party.brandId] || []), ...(flags?.deal || [])].filter((f: any) => isSanctionsFlag(f)).length,
    level: flags?.levels?.[party.brandId] || null,
  };
}

/** For the deal's AML card: may the party be signed off now, and is a note needed. edd: enhanced due diligence by BGP, the officers' to sign off. */
export function signOffView(facts: Omit<SignOffFacts, "note">): { blocked: string | null; needsNote: boolean; edd: boolean; outstanding: string[] } {
  const edd = signOffEnhanced(facts) && !!facts.inHouseEdd;
  return {
    blocked: signOffDenial({ ...facts, note: "x".repeat(Math.max(SIGN_OFF_NOTE_MIN, IN_HOUSE_EDD_NOTE_MIN)) }),
    needsNote: edd || (!facts.clientChecksFinished && !facts.sanctionsOnly && !facts.reliance),
    edd,
    outstanding: facts.sanctionsOnly || facts.reliance ? [] : facts.clientChecksOutstanding || [],
  };
}

type Decider = { id: string; name: string; mlroAppointed: boolean; as: "officer" | "agent"; officerRole: string | null };

// The Nominated Officer or the Deputy (admins until a Nominated Officer is set).
export async function decider(req: Request): Promise<Decider | { refusal: string; status: number }> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return { refusal: "Not signed in.", status: 401 };
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return { refusal: "BGP staff only, signed in as themselves.", status: 403 };
  const { amlActor, officerRefusal } = await import("./aml-authority");
  const actor = await amlActor(req);
  if (!actor.isMlro) return { refusal: officerRefusal(actor, "decide this"), status: 403 };
  return { id: String(userId), name: text(actor.name) || text(actor.email) || "an admin", mlroAppointed: actor.mlroAppointed, as: "officer", officerRole: actor.officerRole };
}

// Who may sign a standard or simplified party off: the officers, or one of the
// deal's agents (the AML policy: fee earners approve standard checks).
async function signOffActor(req: Request, party: AmlParty): Promise<Decider | { refusal: string; status: number }> {
  const officer = await decider(req);
  if ("id" in officer) return officer;
  if (officer.status === 401) return officer;
  const userId = String((req as any).session?.userId || (req as any).tokenUserId || "");
  const { contactViewer } = await import("./contact-viewer");
  if (!userId || !(await contactViewer(req)).staff) return officer;
  const me = (await pool.query(`SELECT id, name, email FROM users WHERE id = $1 AND COALESCE(is_active, true) = true`, [userId])).rows[0];
  if (me && isDealAgent({ id: String(me.id), name: me.name }, { internal_agent_ids: party.agents.ids, internal_agent: party.agents.names })) {
    const { amlActor } = await import("./aml-authority");
    const actor = await amlActor(req);
    return { id: String(me.id), name: text(me.name) || text(me.email), mlroAppointed: actor.mlroAppointed, as: "agent", officerRole: null };
  }
  return { refusal: "Only an agent on this transaction, the Nominated Officer or the Deputy can sign this party off.", status: 403 };
}

/** What the person asking may do on a deal's AML: decide (the officers), sign off (the officers and the deal's agents). */
export async function canDecideAml(req: Request, deal?: { internal_agent_ids?: unknown; internal_agent?: unknown } | null): Promise<{
  canDecide: boolean; canSignOff: boolean; mlroAppointed: boolean; officers: { nominated: string | null; deputy: string | null }; officerWords: string;
}> {
  const { amlActor } = await import("./aml-authority");
  const actor = await amlActor(req).catch(() => null);
  const officers: AmlOfficers = actor?.officers || { nominated: null, deputies: [] };
  const names = { nominated: officers.nominated?.name || null, deputy: deputyNames(officers) || null };
  const d = await decider(req).catch(() => null);
  if (d && "id" in d) return { canDecide: true, canSignOff: true, mlroAppointed: d.mlroAppointed, officers: names, officerWords: officerWords(officers) };
  const { contactViewer } = await import("./contact-viewer");
  const staff = await contactViewer(req).then(v => v.staff).catch(() => false);
  const agent = !!(staff && actor?.id && deal && isDealAgent({ id: String(actor.id), name: actor.name }, deal));
  return { canDecide: false, canSignOff: agent, mlroAppointed: !!actor?.mlroAppointed, officers: names, officerWords: officerWords(officers) };
}

async function dealAudit(dealId: string, field: string, oldValue: string | null, newValue: string, reason: string, me: { id: string; name: string }) {
  await pool.query(
    `INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by, changed_by_name) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [dealId, field, oldValue, newValue, reason.slice(0, 2000), me.id, me.name]).catch((e: any) => console.warn(`[deal-party-aml] audit line not written: ${e?.message}`));
}

const partyName = (p: AmlParty) => p.entityName || p.brandName;
// The officer's note when recording a reliance with gaps in the joint agent's files.
const JOINT_BY_HAND_MIN = 20;

// The brand's own approval: the columns the company approval writes, the
// re-check reminder on the AML policy's cycle for the party's level, the KYC
// audit line.
async function approveBrand(party: AmlParty, by: { name: string }, line: string, years: number): Promise<Date> {
  const expires = new Date();
  expires.setUTCFullYear(expires.getUTCFullYear() + years);
  await pool.query(
    `UPDATE crm_companies SET kyc_status = 'approved', kyc_checked_at = NOW(), kyc_approved_by = $2, kyc_expires_at = $3, updated_at = NOW() WHERE id = $1`,
    [party.brandId, by.name, expires]);
  await pool.query(`UPDATE aml_recheck_reminders SET completed_at = NOW(), completed_by = $2 WHERE company_id = $1 AND completed_at IS NULL`, [party.brandId, by.name]).catch(() => {});
  await pool.query(`INSERT INTO aml_recheck_reminders (company_id, entity_name, recheck_type, due_date, notes) VALUES ($1, $2, 'periodic_cdd', $3, $4)`,
    [party.brandId, party.brandName, expires, `BGP sign-off on ${party.dealName} — ${years}-year re-check (AML policy)`]).catch(() => {});
  await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'kyc_approved', $2, $3)`,
    [party.brandId, by.name, `${line} · re-check due ${expires.toISOString().slice(0, 10)} (${years}-year cycle, AML policy)`]).catch(() => {});
  return expires;
}

const router = Router();

router.post("/api/deals/:id/parties/:role/sign-off", async (req: Request, res: Response) => {
  try {
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party." });
    const party = await loadAmlParty(pool, String(req.params.id), role);
    if (!party) return res.status(404).json({ message: `This transaction has no ${DEAL_PARTY_LABEL[role].toLowerCase()}.` });
    const me = await signOffActor(req, party);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const note = text(req.body?.note).slice(0, 1000);
    const facts = await signOffFacts(pool, party);
    const denial = signOffDenial({ ...facts, note });
    if (denial) return res.status(409).json({ message: denial, code: "SIGN_OFF_REFUSED" });
    // Enhanced due diligence by BGP, with the officers' setting on (21
    // November 2026): the Nominated Officer or a Deputy only, and a year.
    const edd = signOffEnhanced(facts) && !!facts.inHouseEdd;
    if (edd && me.as !== "officer") return res.status(403).json({ message: "Enhanced due diligence is signed off by the Nominated Officer or a Deputy.", code: "SIGN_OFF_REFUSED" });
    // A party with nothing that counts reads standard or simplified (an
    // enhanced one is refused above unless done in-house); its approval lasts
    // the policy's 3 years, an enhanced one's 1.
    const level = edd ? "enhanced" : facts.level && facts.level.level !== "enhanced" ? facts.level.level : "standard";
    const years = RECHECK_YEARS[level];

    const relied = [
      DUE_DILIGENCE_LABEL[level].toLowerCase(),
      edd ? "done by BGP's officers" : null,
      party.regime === "sanctions_only" ? "sanctions checks only (a letting under £10,000 a month)" : null,
      facts.precheck ? `BGP's checks before asking ${facts.precheck.ranAt.slice(0, 10)}` : null,
      party.regime === "sanctions_only" ? null : facts.reliance ? `${facts.reliance} (MLR 2017 reg 39)` : facts.clientChecksFinished ? "client checks finished" : `client checks not finished${facts.clientChecksOutstanding?.length ? ` (still to come: ${facts.clientChecksOutstanding.join("; ")})` : ""}`,
      note ? `note: ${note}` : null,
    ].filter(Boolean).join("; ");
    const who = me.as === "agent" ? `${me.name} (agent on the transaction)` : `${me.name}${me.officerRole === "nominated" ? " (Nominated Officer)" : me.officerRole === "deputy" ? " (Deputy Nominated Officer)" : ""}`;
    const line = `BGP sign-off on ${party.dealName} (${DEAL_PARTY_LABEL[role].toLowerCase()}) by ${who}: ${relied}`;
    const before = party.state.status || "no checks";
    if (party.entityId) {
      const { approveEntityKyc } = await import("./account-entities");
      const r = await approveEntityKyc("trading_entity", party.entityId, me.name, {
        reminderCompanyId: party.brandId, notes: line, recheckYears: years,
        evidence: { bgpSignOff: { by: me.name, userId: me.id, as: me.as, at: new Date().toISOString(), dealId: party.dealId, role, note: note || null,
          level, regime: party.regime, precheckRanAt: facts.precheck?.ranAt || null, clientChecksFinished: facts.clientChecksFinished } },
      });
      if (r.status !== 200) return res.status(r.status).json({ message: "The company that signs was not found." });
      const { recomputeDealsForTradingEntity } = await import("./deal-gates");
      await recomputeDealsForTradingEntity(party.entityId, me.name).catch((e: any) => console.warn("[deal-party-aml] deal recompute failed:", e?.message));
    } else {
      await approveBrand(party, me, line, years);
      const { recomputeDealKycApproved } = await import("./deal-gates");
      await recomputeDealKycApproved(party.brandId, me.name).catch((e: any) => console.warn("[deal-party-aml] deal recompute failed:", e?.message));
    }
    await dealAudit(party.dealId, "aml_sign_off", before, `approved by ${who}`, `${DEAL_PARTY_LABEL[role]}: ${partyName(party)} · ${relied} · re-check in ${years} year${years === 1 ? "" : "s"}`, me);
    const after = await loadAmlParty(pool, party.dealId, role);
    res.json({ ok: true, state: after?.state || null });
  } catch (err: any) {
    console.error("[deal-party-aml] sign-off failed:", err?.message);
    res.status(500).json({ message: "The sign-off could not be saved." });
  }
});

// A red flag set aside with a comment, or put back (Woody, 19 November 2026:
// "have the option to ignore with a comment as comply advantage is picking
// up things that are not really a massive problem"). The MLRO's, as the
// sign-off is: it decides whether a finding matters.
//   POST /api/deals/:id/red-flags/set-aside  { role?: party, key, comment } (no role: a flag on the deal record)
//   POST /api/deals/:id/red-flags/put-back   { reviewId }
router.post("/api/deals/:id/red-flags/set-aside", async (req: Request, res: Response) => {
  try {
    const me = await decider(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const { flagReviewComment } = await import("@shared/kyc-red-flags");
    const said = flagReviewComment(req.body?.comment);
    if ("problem" in said) return res.status(400).json({ message: said.problem });
    const key = text(req.body?.key).slice(0, 300);
    if (!key) return res.status(400).json({ message: "Which red flag?" });
    const roleRaw = req.body?.role == null || req.body.role === "" ? null : String(req.body.role);
    let brandId: string | null = null;
    let entityId: string | null = null;
    let partyWords = "the transaction record";
    if (roleRaw) {
      if (!isDealPartyRole(roleRaw)) return res.status(400).json({ message: "Unknown party." });
      const party = await loadAmlParty(pool, String(req.params.id), roleRaw);
      if (!party) return res.status(404).json({ message: `This transaction has no ${DEAL_PARTY_LABEL[roleRaw].toLowerCase()}.` });
      brandId = party.brandId;
      entityId = party.entityId;
      partyWords = `${DEAL_PARTY_LABEL[roleRaw]}: ${partyName(party)}`;
    } else {
      const deal = (await pool.query(`SELECT id FROM crm_deals WHERE id = $1`, [String(req.params.id)])).rows[0];
      if (!deal) return res.status(404).json({ message: "Transaction not found." });
    }
    const { setFlagAside } = await import("./kyc-red-flags");
    const done = await setFlagAside({ dealId: String(req.params.id), brandId, entityId, key, comment: said.comment, me });
    await dealAudit(String(req.params.id), "aml_red_flag", done.flag.label, `set aside by ${me.name}`, `${partyWords} · ${done.flag.label} · why: ${said.comment}`, me);
    res.json({ ok: true, review: done.review });
  } catch (err: any) {
    if (err?.name === "FlagReviewRefusal") return res.status(err.status || 409).json({ message: err.message });
    console.error("[deal-party-aml] set aside failed:", err?.message);
    res.status(500).json({ message: "The red flag could not be set aside." });
  }
});

router.post("/api/deals/:id/red-flags/put-back", async (req: Request, res: Response) => {
  try {
    const me = await decider(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const reviewId = Number(req.body?.reviewId);
    if (!Number.isInteger(reviewId) || reviewId <= 0) return res.status(400).json({ message: "Which red flag?" });
    const deal = (await pool.query(`SELECT id, landlord_id, tenant_id, vendor_id, purchaser_id FROM crm_deals WHERE id = $1`, [String(req.params.id)])).rows[0];
    if (!deal) return res.status(404).json({ message: "Transaction not found." });
    const partyIds = [deal.landlord_id, deal.tenant_id, deal.vendor_id, deal.purchaser_id].filter(Boolean).map(String);
    const { putFlagBack } = await import("./kyc-red-flags");
    const back = await putFlagBack({ dealId: deal.id, partyIds, reviewId, me });
    await dealAudit(deal.id, "aml_red_flag", `set aside`, `put back by ${me.name}`, `${back.label}: counts as a red flag again`, me);
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.name === "FlagReviewRefusal") return res.status(err.status || 409).json({ message: err.message });
    console.error("[deal-party-aml] put back failed:", err?.message);
    res.status(500).json({ message: "The red flag could not be put back." });
  }
});

// KYC4U's result: who may add it is checked before any file is read. A zip
// (KYC4U's whole pack) may be up to 100MB; every other file, and every file
// inside a zip, 25MB (checked as the files are unpacked).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: KYC4U_PACK_MAX_ZIP_BYTES, files: KYC4U_RESULT_MAX_FILES } });
async function deciderFirst(req: Request, res: Response, next: NextFunction) {
  const me = await decider(req).catch(() => ({ refusal: "Could not check who you are.", status: 500 }));
  if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
  (req as any).amlDecider = me;
  next();
}
function takeFiles(req: Request, res: Response, next: NextFunction) {
  upload.array("files", KYC4U_RESULT_MAX_FILES)(req, res, (err: any) => {
    if (!err) return next();
    const message = err?.code === "LIMIT_FILE_SIZE" ? `A zip can be up to ${KYC4U_PACK_MAX_ZIP_BYTES / (1024 * 1024)}MB and any other file ${KYC4U_RESULT_MAX_BYTES / (1024 * 1024)}MB.`
      : err?.code === "LIMIT_FILE_COUNT" || err?.code === "LIMIT_UNEXPECTED_FILE" ? `Add up to ${KYC4U_RESULT_MAX_FILES} files, or KYC4U's zip.`
      : "The files could not be read.";
    res.status(400).json({ message });
  });
}

const safeFileName = (name: string) => String(name || "file").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-120) || "file";

type UploadedFile = { originalname: string; mimetype: string; buffer: Buffer; size: number };

/** The files as they will be filed: a zip opened, each with the heading of its folder in KYC4U's pack. */
async function packFrom(req: Request) {
  const files = ((req as any).files || []) as UploadedFile[];
  const { unpackKyc4uFiles, readKyc4uPack } = await import("./kyc4u-result-pack");
  const { entries, skipped } = await unpackKyc4uFiles(files);
  const read = await readKyc4uPack(entries).catch(() => ({ report: null, reportPath: null, fileReference: null }));
  return { chosen: files.length, entries, skipped, ...read };
}

// What KYC4U's pack holds and what its risk report says, before anything is
// saved: the dialog fills the result from it for the officer to check.
router.post("/api/deals/:id/parties/:role/kyc4u-result/read", deciderFirst, takeFiles, async (req: Request, res: Response) => {
  try {
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party." });
    const party = await loadAmlParty(pool, String(req.params.id), role);
    if (!party) return res.status(404).json({ message: `This transaction has no ${DEAL_PARTY_LABEL[role].toLowerCase()}.` });
    const pack = await packFrom(req);
    res.json({
      files: pack.entries.map(e => ({ path: e.path, name: e.name, size: e.buffer.length, heading: e.place.heading, kind: e.place.kind, docType: e.place.docType, docWords: amlFileDocWords(e.place.docType) })),
      skipped: pack.skipped,
      report: pack.report,
      reportPath: pack.reportPath,
      prefill: kyc4uResultPrefill(pack.report, pack.fileReference),
    });
  } catch (err: any) {
    console.error("[deal-party-aml] KYC4U pack read failed:", err?.message);
    res.status(500).json({ message: "KYC4U's files could not be read." });
  }
});

router.post("/api/deals/:id/parties/:role/kyc4u-result", deciderFirst, takeFiles, async (req: Request, res: Response) => {
  try {
    const me = (req as any).amlDecider as { id: string; name: string };
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party." });
    const verdict = req.body?.verdict;
    if (!isKyc4uResultKey(verdict)) return res.status(400).json({ message: "Choose KYC4U's result." });
    const day = kyc4uResultDate(req.body?.date);
    if (!day) return res.status(400).json({ message: "Give the date of KYC4U's result (not in the future)." });
    // A result dated today is timed as it is recorded, so it follows anything
    // KYC4U's list showed earlier today; an earlier date is midday that day.
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    const on = day.toISOString().slice(0, 10) === today ? new Date() : day;
    const note = text(req.body?.note).slice(0, 1000);
    const reference = text(req.body?.reference).slice(0, 60);
    const pack = await packFrom(req);
    const files = pack.entries;
    if (pack.chosen && !files.length) {
      return res.status(400).json({ message: `None of the files can be filed: ${pack.skipped.slice(0, 3).map(sk => `${sk.path} (${sk.reason})`).join("; ")}.` });
    }
    // An approval is evidenced by KYC4U's own report or email; any other
    // result by a file or a note that says what KYC4U asked for.
    if (verdict === "approved" && !files.length) return res.status(400).json({ message: "Attach KYC4U's report or their email approving the party." });
    if (verdict !== "approved" && !files.length && note.length < SIGN_OFF_NOTE_MIN) return res.status(400).json({ message: "Attach KYC4U's email or say what they said." });
    const party = await loadAmlParty(pool, String(req.params.id), role);
    if (!party) return res.status(404).json({ message: `This transaction has no ${DEAL_PARTY_LABEL[role].toLowerCase()}.` });
    // The re-check the approval carries: the policy's years for the party's
    // level now (1 when it needs enhanced due diligence, else 3), and 1 when
    // KYC4U's own report rates it high risk.
    const flagsNow = await (await import("./kyc-red-flags"))
      .loadDealRedFlags(party.dealId, [party.brandId], party.entityId ? { [party.brandId]: party.entityId } : {}).catch(() => null);
    const levelNow = flagsNow?.levels?.[party.brandId]?.level || "enhanced";
    const kyc4uHigh = kyc4uRiskLevel(pack.report?.levelOfRisk) === "high";
    const recheckYears = kyc4uHigh ? RECHECK_YEARS.enhanced : RECHECK_YEARS[levelNow];
    const ref = reference || pack.report?.jobId || pack.fileReference || "";

    // The files, filed on the party's KYC record (the company that signs when
    // set), each under the heading of its folder in KYC4U's pack. A file
    // already on the record (the same name and size) is not filed again.
    const { saveFile } = await import("./file-storage");
    const label = KYC4U_RESULTS[verdict];
    const onFile = new Set((await pool.query(
      `SELECT lower(file_name) AS name, file_size FROM kyc_documents
        WHERE company_id = $1 AND trading_entity_id IS NOT DISTINCT FROM $2::varchar AND deleted_at IS NULL`,
      [party.brandId, party.entityId])).rows.map((r: any) => `${r.name}|${r.file_size}`));
    const already: string[] = [];
    let filed = 0;
    for (const f of files) {
      const seen = `${f.name.toLowerCase()}|${f.buffer.length}`;
      if (onFile.has(seen)) { already.push(f.path); continue; }
      onFile.add(seen);
      const stored = `kyc4u-${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safeFileName(f.name)}`;
      await saveFile(`chat-media/${stored}`, f.buffer, f.mime, f.name);
      const under = f.place.kind === "report" || f.place.heading === "KYC4U's pack" ? "" : `: ${f.place.heading}`;
      await pool.query(
        `INSERT INTO kyc_documents (company_id, trading_entity_id, deal_id, doc_type, file_url, file_name, file_size, mime_type, notes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [party.brandId, party.entityId, party.dealId, f.place.docType, `/api/chat-media/${stored}`, f.name, f.buffer.length,
          f.mime, `KYC4U result (${label}, ${day.toISOString().slice(0, 10)}${ref ? `, ${ref}` : ""}) on ${partyName(party)}${under}, added by ${me.name}`, me.id]);
      filed += 1;
    }

    // The result as a KYC4U request row, applied by the mirror. A result about
    // a company that is not the brand's own legal company is filed on that
    // company only (no company_id), never on the brand. KYC4U's own reading
    // of the party (their risk assessment report) is kept on it.
    const itemId = `${party.brandId}:${party.entityId || "brand"}:${Date.now()}`;
    await pool.query(
      `INSERT INTO kyc4u_requests (list_id, item_id, list_name, title, status, entity_name, company_id, company_id_manual, trading_entity_id,
                                   fields, created_at_source, modified_at_source, synced_at)
       VALUES ('manual', $1, 'Recorded in the app', $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $9, NOW())`,
      [itemId, `${ref || "KYC4U result"} ${partyName(party)}`.trim(), label, partyName(party),
        party.entityId && !party.sameCompany ? null : party.brandId, party.brandId, party.entityId,
        JSON.stringify({ "Recorded by": me.name, Note: note || null, Reference: ref || null, Deal: party.dealName, Files: filed,
          "Due diligence": DUE_DILIGENCE_LABEL[levelNow], "Re-check years": recheckYears,
          ...(pack.report ? { "Level of risk": pack.report.levelOfRisk, "KYC4U assessment": kyc4uAssessmentRecord(pack.report) } : {}) }), on]);
    // A request prepared on this deal and sent to KYC4U is answered by it.
    await pool.query(
      `UPDATE kyc4u_drafts SET request_list_id = 'manual', request_item_id = $3, status = 'submitted'
        WHERE deal_id = $1 AND company_id = $2 AND status IN ('filled', 'submitted') AND request_item_id IS NULL`,
      [party.dealId, party.brandId, itemId]).catch(() => {});
    const { mirrorKyc4uStatuses } = await import("./kyc4u");
    await mirrorKyc4uStatuses().catch((e: any) => console.warn("[deal-party-aml] KYC4U mirror failed:", e?.message));

    await dealAudit(party.dealId, "kyc4u_result", party.state.status || "no checks", label,
      `${DEAL_PARTY_LABEL[role]}: ${partyName(party)} · KYC4U ${label.toLowerCase()} on ${day.toISOString().slice(0, 10)}${ref ? ` (${ref})` : ""}${pack.report?.levelOfRisk ? ` · KYC4U rate it ${pack.report.levelOfRisk.toLowerCase()} risk` : ""}${filed ? ` · ${filed} file${filed === 1 ? "" : "s"}` : ""}${note ? ` · ${note}` : ""}`, me);
    const after = await loadAmlParty(pool, party.dealId, role);
    const want = verdict === "approved" ? "approved" : verdict === "rejected" ? "rejected" : null;
    // A later KYC4U request for the party decides its status, as for any
    // result: say so rather than claim this one took effect.
    const applied = !want || after?.state.status === want;
    const notes = [
      applied ? null : "Saved and filed, but KYC4U's list has a later request for this party, which decides its status.",
      already.length ? `${already.length} file${already.length === 1 ? " was" : "s were"} already on the party's record and not filed again.` : null,
      pack.skipped.length ? `Not filed: ${pack.skipped.slice(0, 4).map(sk => `${sk.path} (${sk.reason})`).join("; ")}${pack.skipped.length > 4 ? ` and ${pack.skipped.length - 4} more` : ""}.` : null,
    ].filter(Boolean);
    res.json({
      ok: true, state: after?.state || null, applied, filed, already, skipped: pack.skipped,
      message: notes.length ? notes.join(" ") : null,
    });
  } catch (err: any) {
    console.error("[deal-party-aml] KYC4U result failed:", err?.message);
    res.status(500).json({ message: "KYC4U's result could not be saved." });
  }
});

// A person to check verified from public sources (Woody, 21 November 2026:
// KYC4U's "Public figure" method, "yes lets do 1 to 4"). The Nominated
// Officer or a Deputy records what makes them a public figure, with the pages
// (each copied to PDF on the party's KYC record) and any files; it then counts
// for that person's identity check and proof of address, on every deal with
// the party (server/kyc-people.ts). It can be withdrawn.
async function partyKindOf(db: Db, party: AmlParty) {
  const held = (await db.query(`SELECT aml_subject_type FROM crm_companies WHERE id = $1`, [party.brandId]).catch(() => ({ rows: [] as any[] }))).rows[0] || null;
  const signer = party.entityId ? (await db.query(`SELECT entity_kind FROM crm_trading_entities WHERE id = $1`, [party.entityId]).catch(() => ({ rows: [] as any[] }))).rows[0] || { entity_kind: null } : null;
  return partySubjectKind(held?.aml_subject_type, signer ? { kind: signer.entity_kind } : null);
}

router.post("/api/deals/:id/parties/:role/public-figure", deciderFirst, takeFiles, async (req: Request, res: Response) => {
  try {
    const me = (req as any).amlDecider as { id: string; name: string };
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party." });
    const party = await loadAmlParty(pool, String(req.params.id), role);
    if (!party) return res.status(404).json({ message: `This transaction has no ${DEAL_PARTY_LABEL[role].toLowerCase()}.` });
    const note = text(req.body?.note).slice(0, 1000);
    if (note.length < PUBLIC_FIGURE_NOTE_MIN) return res.status(400).json({ message: "Say what makes them a public figure and what the sources show (at least a sentence)." });
    const { copyAddress, fileWebCopies } = await import("./web-page-copy");
    const rawLinks = String(req.body?.links || "").split(/[\s,]+/).map(l => l.trim()).filter(Boolean);
    const links = [...new Set(rawLinks.map(copyAddress).filter((l): l is string => !!l))];
    if (rawLinks.length && links.length < new Set(rawLinks).size) return res.status(400).json({ message: "Each link must be a web address (http or https)." });
    if (links.length > PUBLIC_FIGURE_MAX_LINKS) return res.status(400).json({ message: `Give up to ${PUBLIC_FIGURE_MAX_LINKS} links.` });
    const { unpackKyc4uFiles } = await import("./kyc4u-result-pack");
    const { entries, skipped } = await unpackKyc4uFiles(((req as any).files || []) as UploadedFile[]);
    if (skipped.length) return res.status(400).json({ message: `Not a file that can be kept: ${skipped.slice(0, 3).map(sk => `${sk.path} (${sk.reason})`).join("; ")}.` });
    if (!links.length && !entries.length) return res.status(400).json({ message: "Give the pages or files that show who they are." });

    const kind = await partyKindOf(pool, party);
    const { dealPeopleRequests, partyPeopleFor } = await import("./kyc-people");
    const people = await partyPeopleFor({ companyId: party.brandId, entityId: party.entityId, kind, dealId: party.dealId }, await dealPeopleRequests(party.dealId));
    const person = people.people.find(p => p.key === String(req.body?.key || ""));
    if (!person) return res.status(404).json({ message: `That person is not on the list of people to check for ${partyName(party)}.` });
    if (person.publicFigure) return res.status(409).json({ message: `${person.name} is already verified from public sources (by ${person.publicFigure.by}).` });

    const { saveFile } = await import("./file-storage");
    const documentIds: string[] = [];
    for (const f of entries) {
      const stored = `kyc-public-${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safeFileName(f.name)}`;
      await saveFile(`chat-media/${stored}`, f.buffer, f.mime, f.name);
      const row = (await pool.query(
        `INSERT INTO kyc_documents (company_id, trading_entity_id, deal_id, doc_type, file_url, file_name, file_size, mime_type, notes, uploaded_by)
         VALUES ($1, $2, $3, 'public_source', $4, $5, $6, $7, $8, $9) RETURNING id`,
        [party.brandId, party.entityId, party.dealId, `/api/chat-media/${stored}`, f.name, f.buffer.length, f.mime,
          `Public source for ${person.name}, verified from public sources by ${me.name}`, me.id])).rows[0];
      documentIds.push(String(row.id));
    }
    const check = (await pool.query(
      `INSERT INTO kyc_public_figure_checks (deal_id, company_id, trading_entity_id, person_key, person_name, note, links, document_ids, verified_by, verified_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10) RETURNING id`,
      [party.dealId, party.brandId, party.entityId, person.key, person.name, note, JSON.stringify(links), JSON.stringify(documentIds), me.id, me.name])).rows[0];
    await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes, entity_kind, entity_id) VALUES ($1, 'public_figure', $2, $3, $4, $5)`,
      [party.brandId, me.name, `${person.name} verified from public sources on ${party.dealName}: ${note}${links.length ? ` (${links.length} page${links.length === 1 ? "" : "s"})` : ""}${documentIds.length ? ` (${documentIds.length} file${documentIds.length === 1 ? "" : "s"})` : ""}`,
        party.entityId ? "trading_entity" : null, party.entityId]).catch(() => {});
    await dealAudit(party.dealId, "aml_public_figure", null, `verified by ${me.name}`, `${DEAL_PARTY_LABEL[role]}: ${partyName(party)} · ${person.name} verified from public sources · ${note}`, me);
    // The pages, copied to PDF on the party's record after the reply.
    if (links.length) {
      void fileWebCopies({ companyId: party.brandId, entityId: party.entityId, dealId: party.dealId, pages: links.map(url => ({ url, about: `public source for ${person.name}` })),
        by: { id: me.id, name: me.name }, source: `Public figure: ${person.name}, verified by ${me.name}` })
        .then(async done => {
          if (done.filed.length) await pool.query(`UPDATE kyc_public_figure_checks SET document_ids = document_ids || $2::jsonb WHERE id = $1`, [check.id, JSON.stringify(done.filed.map(f => f.documentId))]);
          if (done.failed.length) console.warn(`[deal-party-aml] public figure pages not copied: ${done.failed.map(f => `${f.url} (${f.reason})`).join("; ").slice(0, 400)}`);
        })
        .catch((e: any) => console.warn("[deal-party-aml] public figure copies:", e?.message));
    }
    res.json({ ok: true, id: String(check.id), copying: links.length });
  } catch (err: any) {
    console.error("[deal-party-aml] public figure failed:", err?.message);
    res.status(500).json({ message: "It could not be recorded." });
  }
});

router.post("/api/deals/:id/parties/:role/public-figure/:checkId/withdraw", async (req: Request, res: Response) => {
  try {
    const me = await decider(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party." });
    const party = await loadAmlParty(pool, String(req.params.id), role);
    if (!party) return res.status(404).json({ message: `This transaction has no ${DEAL_PARTY_LABEL[role].toLowerCase()}.` });
    const row = (await pool.query(
      `UPDATE kyc_public_figure_checks SET withdrawn_at = now(), withdrawn_by = $4, withdrawn_by_name = $5
        WHERE id = $1 AND company_id = $2 AND trading_entity_id IS NOT DISTINCT FROM $3::varchar AND withdrawn_at IS NULL
        RETURNING person_name`, [Number(req.params.checkId) || 0, party.brandId, party.entityId, me.id, me.name])).rows[0];
    if (!row) return res.status(404).json({ message: "That verification was not found on this party, or was already withdrawn." });
    await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes, entity_kind, entity_id) VALUES ($1, 'public_figure_withdrawn', $2, $3, $4, $5)`,
      [party.brandId, me.name, `${row.person_name}: verification from public sources withdrawn on ${party.dealName}`, party.entityId ? "trading_entity" : null, party.entityId]).catch(() => {});
    await dealAudit(party.dealId, "aml_public_figure", "verified", `withdrawn by ${me.name}`, `${DEAL_PARTY_LABEL[role]}: ${partyName(party)} · ${row.person_name}: verification from public sources withdrawn`, me);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[deal-party-aml] public figure withdraw failed:", err?.message);
    res.status(500).json({ message: "It could not be withdrawn." });
  }
});

// Relying on another firm's checks (Woody, 21 November 2026: MLR 2017 reg 39,
// "Yes go ahead"). The Nominated Officer or a Deputy records, for a party on
// this deal, the firm whose customer due diligence BGP relies on (the client's
// UK solicitors, say), its anti-money laundering supervisor, the day it agreed,
// what it checked, the regulation's conditions confirmed one by one
// (shared/aml-reliance.ts), and the firm's letter or email agreeing, filed on
// the party's KYC record. While it stands the people to check owe nothing
// (server/kyc-people.ts) and BGP's sign-off needs no note. BGP stays
// responsible (reg 39(1)), and reliance does not cover enhanced due diligence
// (HMRC), so a party with red flags still goes to KYC4U. It can be withdrawn;
// a new one on the same party replaces the last.
router.post("/api/deals/:id/parties/:role/reliance", deciderFirst, takeFiles, async (req: Request, res: Response) => {
  try {
    const me = (req as any).amlDecider as { id: string; name: string };
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party." });
    const party = await loadAmlParty(pool, String(req.params.id), role);
    if (!party) return res.status(404).json({ message: `This transaction has no ${DEAL_PARTY_LABEL[role].toLowerCase()}.` });
    // The joint agent agreed to the reliance terms on its page (22 November
    // 2026): that agreement, as a PDF, is the firm's agreement in writing, and
    // what it says fills what the officer left blank.
    const jointRef = String(req.body?.jointRef || "").trim();
    let jointPdf: { name: string; mime: string; buffer: Buffer } | null = null;
    let body: Record<string, unknown> = req.body || {};
    // Their files must cover everyone first (MLR 2017 reg 39(2)(a); Woody, 22
    // November 2026: "we need to explain whats missing"): an officer who has
    // checked the gaps by hand says how, and that is kept with the reliance.
    let byHand: string | null = null;
    if (jointRef) {
      const { jointRelianceForRecord } = await import("./joint-agent-checks");
      const joint = await jointRelianceForRecord(pool, party.dealId, party.brandId, jointRef);
      if ("problem" in joint) return res.status(400).json({ message: joint.problem });
      if (joint.gaps.length) {
        const handNote = String(req.body?.checkedByHand || "").replace(/\s+/g, " ").trim().slice(0, 1000);
        if (handNote.length < JOINT_BY_HAND_MIN) {
          return res.status(409).json({ message: `Their files do not cover everything BGP needs to rely on them: ${joint.gaps.join("; ")}. Ask them for what's missing, or say how you checked these by hand.`, gaps: joint.gaps });
        }
        byHand = `Recorded with gaps in their files (${joint.gaps.join("; ")}); checked by hand: ${handNote}`;
      }
      jointPdf = joint.pdf;
      body = { ...joint.defaults, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v != null && String(v).trim() !== "")) };
    }
    const said = relianceInput(body);
    if (!said.ok) return res.status(400).json({ message: said.message });
    const { unpackKyc4uFiles } = await import("./kyc4u-result-pack");
    const { entries, skipped } = await unpackKyc4uFiles(((req as any).files || []) as UploadedFile[]);
    if (skipped.length) return res.status(400).json({ message: `Not a file that can be kept: ${skipped.slice(0, 3).map(sk => `${sk.path} (${sk.reason})`).join("; ")}.` });
    const filed = jointPdf ? [jointPdf, ...entries] : entries;
    if (!filed.length) return res.status(400).json({ message: "Add the firm's letter or email agreeing to BGP relying on its checks (a PDF of the email is fine)." });

    const v = byHand ? { ...said.value, note: `${said.value.note} ${byHand}`.slice(0, 3000) } : said.value;
    const { saveFile } = await import("./file-storage");
    const documentIds: string[] = [];
    for (const f of filed) {
      const stored = `kyc-reliance-${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safeFileName(f.name)}`;
      await saveFile(`chat-media/${stored}`, f.buffer, f.mime, f.name);
      const row = (await pool.query(
        `INSERT INTO kyc_documents (company_id, trading_entity_id, deal_id, doc_type, file_url, file_name, file_size, mime_type, notes, uploaded_by)
         VALUES ($1, $2, $3, 'reliance_letter', $4, $5, $6, $7, $8, $9) RETURNING id`,
        [party.brandId, party.entityId, party.dealId, `/api/chat-media/${stored}`, f.name, f.buffer.length, f.mime,
          `${v.firm} agreeing to BGP relying on its checks (MLR 2017 reg 39), recorded by ${me.name}`, me.id])).rows[0];
      documentIds.push(String(row.id));
    }
    const saved = (await pool.query(
      `INSERT INTO kyc_reliance (deal_id, company_id, trading_entity_id, firm, firm_kind, firm_where, firm_country, regulator, regulator_ref, contact, agreed_on, note,
                                 document_ids, recorded_by, recorded_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $13::jsonb, $14, $15) RETURNING id`,
      [party.dealId, party.brandId, party.entityId, v.firm, v.kind, v.where, v.country, v.regulator, v.regulatorRef, v.contact, v.agreedOn, v.note,
        JSON.stringify(documentIds), me.id, me.name])).rows[0];
    // One reliance stands for a party on a deal: a new one replaces the last.
    await pool.query(
      `UPDATE kyc_reliance SET withdrawn_at = now(), withdrawn_by = $5, withdrawn_by_name = $6
        WHERE deal_id = $1 AND company_id = $2 AND trading_entity_id IS NOT DISTINCT FROM $3::varchar AND withdrawn_at IS NULL AND id <> $4`,
      [party.dealId, party.brandId, party.entityId, saved.id, me.id, me.name]);
    const words = relianceWords(v);
    await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes, entity_kind, entity_id) VALUES ($1, 'reliance', $2, $3, $4, $5)`,
      [party.brandId, me.name, `${words}, on ${party.dealName} (${DEAL_PARTY_LABEL[role].toLowerCase()}), recorded by ${me.name} under MLR 2017 reg 39: ${v.note}`,
        party.entityId ? "trading_entity" : null, party.entityId]).catch(() => {});
    await dealAudit(party.dealId, "aml_reliance", null, `recorded by ${me.name}`, `${DEAL_PARTY_LABEL[role]}: ${partyName(party)} · ${words} · ${v.note}`, me);
    res.json({ ok: true, id: String(saved.id), words });
  } catch (err: any) {
    console.error("[deal-party-aml] reliance failed:", err?.message);
    res.status(500).json({ message: "It could not be recorded." });
  }
});

router.post("/api/deals/:id/parties/:role/reliance/:relianceId/withdraw", async (req: Request, res: Response) => {
  try {
    const me = await decider(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party." });
    const party = await loadAmlParty(pool, String(req.params.id), role);
    if (!party) return res.status(404).json({ message: `This transaction has no ${DEAL_PARTY_LABEL[role].toLowerCase()}.` });
    const row = (await pool.query(
      `UPDATE kyc_reliance SET withdrawn_at = now(), withdrawn_by = $5, withdrawn_by_name = $6
        WHERE id = $1 AND deal_id = $2 AND company_id = $3 AND trading_entity_id IS NOT DISTINCT FROM $4::varchar AND withdrawn_at IS NULL
        RETURNING firm`, [Number(req.params.relianceId) || 0, party.dealId, party.brandId, party.entityId, me.id, me.name])).rows[0];
    if (!row) return res.status(404).json({ message: "That reliance was not found on this party, or was already withdrawn." });
    await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes, entity_kind, entity_id) VALUES ($1, 'reliance_withdrawn', $2, $3, $4, $5)`,
      [party.brandId, me.name, `Reliance on ${row.firm}'s checks withdrawn on ${party.dealName} by ${me.name}: the client checks are needed again`,
        party.entityId ? "trading_entity" : null, party.entityId]).catch(() => {});
    await dealAudit(party.dealId, "aml_reliance", "relying", `withdrawn by ${me.name}`, `${DEAL_PARTY_LABEL[role]}: ${partyName(party)} · reliance on ${row.firm}'s checks withdrawn`, me);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[deal-party-aml] reliance withdraw failed:", err?.message);
    res.status(500).json({ message: "It could not be withdrawn." });
  }
});

// A party marked Not required (Woody, 19 November 2026; BGP's AML policy, G
// and F.f): no checks are needed on the other side of a deal a joint agent
// found and negotiated, or when no deal was done with it. The Nominated
// Officer or the Deputy marks it, with why. It stays on the deal with who and
// when, holds only while that party is on the role, and the party then needs
// nothing: the AML gate, the deal's approval and the AML dashboard read it
// (server/aml-policy.ts, loadNotRequired).
// HMRC's rules (Woody, 22 November 2026: "We have to do what HMRC say"): the
// joint agent reason holds on a sale only with the record of asking the joint
// agent for their checks and what came back (AMLG2200, section 21), and is
// refused on a letting at £10,000 a month or more, where every party to the
// lease is verified (AMLG2300).
router.post("/api/deals/:id/parties/:role/not-required", async (req: Request, res: Response) => {
  try {
    const me = await decider(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party." });
    const party = await loadAmlParty(pool, String(req.params.id), role);
    if (!party) return res.status(404).json({ message: `This transaction has no ${DEAL_PARTY_LABEL[role].toLowerCase()}.` });
    const { jointRequestsForRecord } = await import("./joint-agent-checks");
    const said = notRequiredInput(req.body, { rule: party.jointRule, requests: await jointRequestsForRecord(pool, party.dealId, party.brandId).catch(() => []) });
    if ("problem" in said) return res.status(400).json({ message: said.problem });
    const askedWords = said.asked ? ` ${jointAskWords(said.asked)}.${said.asked.note ? ` ${said.asked.note}` : ""}` : "";
    await pool.query(
      `UPDATE kyc_party_exemptions SET undone_at = now(), undone_by = $3, undone_by_name = $4 WHERE deal_id = $1 AND role = $2 AND undone_at IS NULL`,
      [party.dealId, role, me.id, me.name]);
    await pool.query(
      `INSERT INTO kyc_party_exemptions (deal_id, role, company_id, trading_entity_id, reason, comment, set_by, set_by_name, asked_on, asked_how, asked_whom, asked_outcome, joint_ref, asked_missing, asked_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12, $13, $14, $15)`,
      [party.dealId, role, party.brandId, party.entityId, said.reason, said.comment, me.id, me.name,
        said.asked?.askedOn || null, said.asked?.how || null, said.asked?.whom || null, said.asked?.outcome || null, said.asked?.ref || null,
        said.asked?.missing?.length ? said.asked.missing.join("; ") : null, said.asked?.note || null]);
    await pool.query(
      `INSERT INTO kyc_audit_log (company_id, action, performed_by, notes, entity_kind, entity_id) VALUES ($1, 'party_not_required', $2, $3, $4, $5)`,
      [party.brandId, me.name, `Not required on ${party.dealName} (${DEAL_PARTY_LABEL[role].toLowerCase()}), marked by ${me.name}: ${NOT_REQUIRED_REASONS[said.reason]}.${askedWords} ${said.comment}`,
        party.entityId ? "trading_entity" : null, party.entityId]).catch(() => {});
    await dealAudit(party.dealId, "aml_not_required", party.state.status || "no checks", `not required, marked by ${me.name}`,
      `${DEAL_PARTY_LABEL[role]}: ${partyName(party)} · ${NOT_REQUIRED_REASONS[said.reason]}${said.asked ? ` · ${jointAskWords(said.asked)}${said.asked.note ? ` · ${said.asked.note}` : ""}` : ""} · ${said.comment}`, me);
    const { recomputeDealKycApproved } = await import("./deal-gates");
    await recomputeDealKycApproved(party.brandId, me.name).catch((e: any) => console.warn("[deal-party-aml] deal recompute failed:", e?.message));
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[deal-party-aml] not required failed:", err?.message);
    res.status(500).json({ message: "The party could not be marked Not required." });
  }
});

router.post("/api/deals/:id/parties/:role/not-required/undo", async (req: Request, res: Response) => {
  try {
    const me = await decider(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party." });
    const undone = (await pool.query(
      `UPDATE kyc_party_exemptions SET undone_at = now(), undone_by = $3, undone_by_name = $4
        WHERE deal_id = $1 AND role = $2 AND undone_at IS NULL RETURNING company_id, reason`,
      [String(req.params.id), role, me.id, me.name])).rows;
    if (!undone.length) return res.status(409).json({ message: "This party is not marked Not required. Reload the box." });
    const companyId = String(undone[0].company_id);
    await pool.query(
      `INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'party_not_required_undone', $2, $3)`,
      [companyId, me.name, `Not required taken off by ${me.name} (${DEAL_PARTY_LABEL[role].toLowerCase()} on deal ${String(req.params.id)}): the checks are needed again`]).catch(() => {});
    await dealAudit(String(req.params.id), "aml_not_required", "not required", `taken off by ${me.name}`, `${DEAL_PARTY_LABEL[role]}: the checks are needed again`, me);
    const { recomputeDealKycApproved } = await import("./deal-gates");
    await recomputeDealKycApproved(companyId, me.name).catch((e: any) => console.warn("[deal-party-aml] deal recompute failed:", e?.message));
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[deal-party-aml] not required undo failed:", err?.message);
    res.status(500).json({ message: "The marker could not be taken off." });
  }
});

export default router;

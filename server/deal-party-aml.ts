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
//   POST /api/deals/:id/parties/:role/kyc4u-result        multipart: verdict, date, reference, note, files[]
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
import { DEAL_PARTY_COLUMNS, DEAL_PARTY_LABEL, isDealPartyRole, type DealPartyRole } from "@shared/deal-parties";
import {
  KYC4U_RESULTS, KYC4U_RESULT_MAX_BYTES, KYC4U_RESULT_MAX_FILES, SIGN_OFF_NOTE_MIN,
  isKyc4uResultKey, kyc4uResultDate, kycVerdict, sameLegalCompany, signOffDenial,
  type PartyKycState, type SignOffFacts,
} from "@shared/party-kyc";
import {
  DUE_DILIGENCE_LABEL, NOT_REQUIRED_REASONS, RECHECK_YEARS, amlRegime, deputyNames, isDealAgent, notRequiredInput, officerWords,
  type AmlOfficers, type AmlRegime, type PartyDueDiligence,
} from "@shared/aml-policy";

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
    dealId: deal.id, dealName: text(deal.name) || "this deal", role,
    brandId: String(deal.brand_id), brandName: state.brandName,
    entityId: entity ? String(entity.id) : null, entityName: entity ? text(entity.name) : null,
    sameCompany, state,
    regime: amlRegime({ dealType: deal.deal_type, team: deal.team, rentPa: deal.rent_pa }).regime,
    agents: {
      ids: Array.isArray(deal.internal_agent_ids) ? deal.internal_agent_ids.filter(Boolean).map(String) : [],
      names: Array.isArray(deal.internal_agent) ? deal.internal_agent.map(text).filter(Boolean) : [],
    },
  };
}

// Raised with KYC4U from this deal and not answered yet: a request prepared
// on the deal for this party in the last 180 days, not cancelled, whose
// KYC4U request is not linked yet or still reads as with KYC4U.
async function raisedWithKyc4u(db: Db, party: AmlParty): Promise<boolean> {
  const rows = (await db.query(
    `SELECT d.status, q.status AS request_status, d.request_item_id
       FROM kyc4u_drafts d
       LEFT JOIN kyc4u_requests q ON q.list_id = d.request_list_id AND q.item_id = d.request_item_id
      WHERE d.deal_id = $1 AND d.company_id = $2 AND d.status IN ('queued', 'filled', 'submitted')
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
  precheck?: { ranAt: string | null; running: boolean } | null;
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
    precheck = { ranAt: stored?.ranAt || null, running: !!precheckRunning(party.brandId, party.entityId) };
  }
  // The request to the person acting finished, and every person to check
  // has sent what they owe (Woody, 19 November 2026: the owners and the
  // person acting each do their own identity check and proof of address).
  // A person's own request finishing is not the party's checks finishing.
  const mainFinished = (await db.query(
    `SELECT 1 FROM kyc_upload_tokens
      WHERE deal_id = $1 AND company_id = $2 AND trading_entity_id IS NOT DISTINCT FROM $3
        AND completed_at IS NOT NULL AND COALESCE(is_test, false) = false
        AND COALESCE(jsonb_typeof(request->'person'), 'null') <> 'object' LIMIT 1`,
    [party.dealId, party.brandId, party.entityId]).catch(() => ({ rows: [] as any[] }))).rows.length > 0;
  const kind = !party.entityId && String(held?.aml_subject_type || "").toLowerCase() === "individual" ? "individual" : "company";
  const people = await import("./kyc-people")
    .then(async m => m.partyPeopleFor({ companyId: party.brandId, entityId: party.entityId, kind }, await m.dealPeopleRequests(party.dealId, db)))
    .catch(() => null);
  // People that could not be read count as outstanding: a note is asked for.
  const outstanding = people ? people.outstanding : ["the people to check could not be read"];
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
    level: flags?.levels?.[party.brandId] || null,
  };
}

/** For the deal's AML card: may the party be signed off now, and is a note needed. */
export function signOffView(facts: Omit<SignOffFacts, "note">): { blocked: string | null; needsNote: boolean; outstanding: string[] } {
  return {
    blocked: signOffDenial({ ...facts, note: "x".repeat(SIGN_OFF_NOTE_MIN) }),
    needsNote: !facts.clientChecksFinished && !facts.sanctionsOnly,
    outstanding: facts.sanctionsOnly ? [] : facts.clientChecksOutstanding || [],
  };
}

type Decider = { id: string; name: string; mlroAppointed: boolean; as: "officer" | "agent"; officerRole: string | null };

// The Nominated Officer or the Deputy (admins until a Nominated Officer is set).
async function decider(req: Request): Promise<Decider | { refusal: string; status: number }> {
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
  return { refusal: "Only an agent on this deal, the Nominated Officer or the Deputy can sign this party off.", status: 403 };
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
    if (!party) return res.status(404).json({ message: `This deal has no ${DEAL_PARTY_LABEL[role].toLowerCase()}.` });
    const me = await signOffActor(req, party);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const note = text(req.body?.note).slice(0, 1000);
    const facts = await signOffFacts(pool, party);
    const denial = signOffDenial({ ...facts, note });
    if (denial) return res.status(409).json({ message: denial, code: "SIGN_OFF_REFUSED" });
    // A party with nothing that counts reads standard or simplified (an
    // enhanced one is refused above); its approval lasts the policy's 3 years.
    const level = facts.level && facts.level.level !== "enhanced" ? facts.level.level : "standard";
    const years = RECHECK_YEARS[level];

    const relied = [
      DUE_DILIGENCE_LABEL[level].toLowerCase(),
      party.regime === "sanctions_only" ? "sanctions checks only (a letting under £10,000 a month)" : null,
      facts.precheck ? `BGP's checks before asking ${facts.precheck.ranAt.slice(0, 10)}` : null,
      party.regime === "sanctions_only" ? null : facts.clientChecksFinished ? "client checks finished" : `client checks not finished${facts.clientChecksOutstanding?.length ? ` (still to come: ${facts.clientChecksOutstanding.join("; ")})` : ""}`,
      note ? `note: ${note}` : null,
    ].filter(Boolean).join("; ");
    const who = me.as === "agent" ? `${me.name} (agent on the deal)` : `${me.name}${me.officerRole === "nominated" ? " (Nominated Officer)" : me.officerRole === "deputy" ? " (Deputy Nominated Officer)" : ""}`;
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
    let partyWords = "the deal record";
    if (roleRaw) {
      if (!isDealPartyRole(roleRaw)) return res.status(400).json({ message: "Unknown party." });
      const party = await loadAmlParty(pool, String(req.params.id), roleRaw);
      if (!party) return res.status(404).json({ message: `This deal has no ${DEAL_PARTY_LABEL[roleRaw].toLowerCase()}.` });
      brandId = party.brandId;
      entityId = party.entityId;
      partyWords = `${DEAL_PARTY_LABEL[roleRaw]}: ${partyName(party)}`;
    } else {
      const deal = (await pool.query(`SELECT id FROM crm_deals WHERE id = $1`, [String(req.params.id)])).rows[0];
      if (!deal) return res.status(404).json({ message: "Deal not found." });
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
    if (!deal) return res.status(404).json({ message: "Deal not found." });
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

// KYC4U's result: who may add it is checked before any file is read.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: KYC4U_RESULT_MAX_BYTES, files: KYC4U_RESULT_MAX_FILES } });
async function deciderFirst(req: Request, res: Response, next: NextFunction) {
  const me = await decider(req).catch(() => ({ refusal: "Could not check who you are.", status: 500 }));
  if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
  (req as any).amlDecider = me;
  next();
}
function takeFiles(req: Request, res: Response, next: NextFunction) {
  upload.array("files", KYC4U_RESULT_MAX_FILES)(req, res, (err: any) => {
    if (!err) return next();
    const message = err?.code === "LIMIT_FILE_SIZE" ? "Each file must be 25MB or less."
      : err?.code === "LIMIT_FILE_COUNT" || err?.code === "LIMIT_UNEXPECTED_FILE" ? `Add up to ${KYC4U_RESULT_MAX_FILES} files.`
      : "The files could not be read.";
    res.status(400).json({ message });
  });
}

const safeFileName = (name: string) => String(name || "file").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-120) || "file";

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
    const files = ((req as any).files || []) as Array<{ originalname: string; mimetype: string; buffer: Buffer; size: number }>;
    // An approval is evidenced by KYC4U's own report or email; any other
    // result by a file or a note that says what KYC4U asked for.
    if (verdict === "approved" && !files.length) return res.status(400).json({ message: "Attach KYC4U's report or their email approving the party." });
    if (verdict !== "approved" && !files.length && note.length < SIGN_OFF_NOTE_MIN) return res.status(400).json({ message: "Attach KYC4U's email or say what they said." });
    const party = await loadAmlParty(pool, String(req.params.id), role);
    if (!party) return res.status(404).json({ message: `This deal has no ${DEAL_PARTY_LABEL[role].toLowerCase()}.` });
    // The re-check the approval carries: the policy's years for the party's
    // level now (1 when it needs enhanced due diligence, else 3).
    const flagsNow = await (await import("./kyc-red-flags"))
      .loadDealRedFlags(party.dealId, [party.brandId], party.entityId ? { [party.brandId]: party.entityId } : {}).catch(() => null);
    const levelNow = flagsNow?.levels?.[party.brandId]?.level || "enhanced";
    const recheckYears = RECHECK_YEARS[levelNow];

    // The files, filed on the party's KYC record (the company that signs when set).
    const { saveFile } = await import("./file-storage");
    let classify: (name: string) => string = () => "other";
    try { classify = (await import("./kyc-pack-intake")).classifyPackFile; } catch {}
    const label = KYC4U_RESULTS[verdict];
    for (const f of files) {
      const stored = `kyc4u-${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safeFileName(f.originalname)}`;
      await saveFile(`chat-media/${stored}`, f.buffer, f.mimetype || "application/octet-stream", f.originalname);
      const kind = classify(f.originalname);
      await pool.query(
        `INSERT INTO kyc_documents (company_id, trading_entity_id, deal_id, doc_type, file_url, file_name, file_size, mime_type, notes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [party.brandId, party.entityId, party.dealId, kind && kind !== "other" ? kind : "kyc4u_report", `/api/chat-media/${stored}`, f.originalname, f.size || f.buffer.length,
          f.mimetype || null, `KYC4U result (${label}, ${day.toISOString().slice(0, 10)}${reference ? `, ${reference}` : ""}) on ${partyName(party)}, added by ${me.name}`, me.id]);
    }

    // The result as a KYC4U request row, applied by the mirror. A result about
    // a company that is not the brand's own legal company is filed on that
    // company only (no company_id), never on the brand.
    const itemId = `${party.brandId}:${party.entityId || "brand"}:${Date.now()}`;
    await pool.query(
      `INSERT INTO kyc4u_requests (list_id, item_id, list_name, title, status, entity_name, company_id, company_id_manual, trading_entity_id,
                                   fields, created_at_source, modified_at_source, synced_at)
       VALUES ('manual', $1, 'Recorded in the app', $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $9, NOW())`,
      [itemId, `${reference || "KYC4U result"} ${partyName(party)}`.trim(), label, partyName(party),
        party.entityId && !party.sameCompany ? null : party.brandId, party.brandId, party.entityId,
        JSON.stringify({ "Recorded by": me.name, Note: note || null, Reference: reference || null, Deal: party.dealName, Files: files.length,
          "Due diligence": DUE_DILIGENCE_LABEL[levelNow], "Re-check years": recheckYears }), on]);
    // A request prepared on this deal and sent to KYC4U is answered by it.
    await pool.query(
      `UPDATE kyc4u_drafts SET request_list_id = 'manual', request_item_id = $3, status = 'submitted'
        WHERE deal_id = $1 AND company_id = $2 AND status IN ('filled', 'submitted') AND request_item_id IS NULL`,
      [party.dealId, party.brandId, itemId]).catch(() => {});
    const { mirrorKyc4uStatuses } = await import("./kyc4u");
    await mirrorKyc4uStatuses().catch((e: any) => console.warn("[deal-party-aml] KYC4U mirror failed:", e?.message));

    await dealAudit(party.dealId, "kyc4u_result", party.state.status || "no checks", label,
      `${DEAL_PARTY_LABEL[role]}: ${partyName(party)} · KYC4U ${label.toLowerCase()} on ${day.toISOString().slice(0, 10)}${reference ? ` (${reference})` : ""}${files.length ? ` · ${files.length} file${files.length === 1 ? "" : "s"}` : ""}${note ? ` · ${note}` : ""}`, me);
    const after = await loadAmlParty(pool, party.dealId, role);
    const want = verdict === "approved" ? "approved" : verdict === "rejected" ? "rejected" : null;
    // A later KYC4U request for the party decides its status, as for any
    // result: say so rather than claim this one took effect.
    const applied = !want || after?.state.status === want;
    res.json({
      ok: true, state: after?.state || null, applied,
      message: applied ? null : "Saved and filed, but KYC4U's list has a later request for this party, which decides its status.",
    });
  } catch (err: any) {
    console.error("[deal-party-aml] KYC4U result failed:", err?.message);
    res.status(500).json({ message: "KYC4U's result could not be saved." });
  }
});

// A party marked Not required (Woody, 19 November 2026; BGP's AML policy, G
// and F.f): no checks are needed on the other side of a deal a joint agent
// found and negotiated, or when no deal was done with it. The Nominated
// Officer or the Deputy marks it, with why. It stays on the deal with who and
// when, holds only while that party is on the role, and the party then needs
// nothing: the AML gate, the deal's approval and the AML dashboard read it
// (server/aml-policy.ts, loadNotRequired).
router.post("/api/deals/:id/parties/:role/not-required", async (req: Request, res: Response) => {
  try {
    const me = await decider(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Unknown party." });
    const said = notRequiredInput(req.body);
    if ("problem" in said) return res.status(400).json({ message: said.problem });
    const party = await loadAmlParty(pool, String(req.params.id), role);
    if (!party) return res.status(404).json({ message: `This deal has no ${DEAL_PARTY_LABEL[role].toLowerCase()}.` });
    await pool.query(
      `UPDATE kyc_party_exemptions SET undone_at = now(), undone_by = $3, undone_by_name = $4 WHERE deal_id = $1 AND role = $2 AND undone_at IS NULL`,
      [party.dealId, role, me.id, me.name]);
    await pool.query(
      `INSERT INTO kyc_party_exemptions (deal_id, role, company_id, trading_entity_id, reason, comment, set_by, set_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [party.dealId, role, party.brandId, party.entityId, said.reason, said.comment, me.id, me.name]);
    await pool.query(
      `INSERT INTO kyc_audit_log (company_id, action, performed_by, notes, entity_kind, entity_id) VALUES ($1, 'party_not_required', $2, $3, $4, $5)`,
      [party.brandId, me.name, `Not required on ${party.dealName} (${DEAL_PARTY_LABEL[role].toLowerCase()}), marked by ${me.name}: ${NOT_REQUIRED_REASONS[said.reason]}. ${said.comment}`,
        party.entityId ? "trading_entity" : null, party.entityId]).catch(() => {});
    await dealAudit(party.dealId, "aml_not_required", party.state.status || "no checks", `not required, marked by ${me.name}`,
      `${DEAL_PARTY_LABEL[role]}: ${partyName(party)} · ${NOT_REQUIRED_REASONS[said.reason]} · ${said.comment}`, me);
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

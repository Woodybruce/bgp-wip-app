// The AML dashboard's feed (Woody, 18 November 2026: step 6 of
// docs/deal-page-review-2026-11-18.md; the rules are shared/aml-dashboard.ts).
// BGP staff signed in as themselves only: the parties' checks, red flags and
// documents are BGP's.
//
//   GET /api/aml-dashboard                             one row per party of every live deal
//   GET /api/aml-dashboard/party?dealId=&role=         the party's documents and history
//
// Live deals: every deal not withdrawn or archived, and completed or
// invoiced ones changed in the last 90 days; an investment deal only from
// Solicitors, as everywhere off the Investment Tracker (dealLeftTrackerSql).
// Each party is read the deal card's way: its state on the company that signs
// when the deal names one (loadPartyKyc), and the red flags by the same rules
// on the same records (shared/kyc-red-flags.ts), read for all the deals at
// once instead of a deal at a time.

import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import { DEAL_PARTY_COLUMNS, DEAL_PARTY_LABEL, DEAL_PARTY_ROLES, isDealPartyRole } from "@shared/deal-parties";
import { CLOSED_STATUSES, TERMINAL_STATUSES, dealLeftTrackerSql, statusSpellingsFor } from "@shared/deal-status";
import { amlBucket, amlDealClosed, amlDue, amlStage, amlWaitingOn, daysSince, type AmlDashboardRow } from "@shared/aml-dashboard";
import { applyFlagReviews, dealRedFlags, partyRedFlags } from "@shared/kyc-red-flags";
import { isPrecheckResult } from "@shared/kyc-prechecks";
import { SCREENED_INVESTIGATION_SQL } from "./kyc-prechecks";

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const sqlList = (codes: readonly any[]) => statusSpellingsFor(codes).map(s => `'${s.replace(/'/g, "''")}'`).join(", ");
export const AML_DASHBOARD_CLOSED_DAYS = 90;

async function staffMe(req: Request): Promise<{ id: string; name: string } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await pool.query(`SELECT id, name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return u ? { id: String(u.id), name: text(u.name) || text(u.email) } : null;
}

export async function loadAmlDashboard(me: { id: string; name: string }, now: Date = new Date()): Promise<{ rows: AmlDashboardRow[]; unchecked: string[] }> {
  const partyCols = DEAL_PARTY_ROLES.flatMap(r => [`d.${DEAL_PARTY_COLUMNS[r].brand}`, `d.${DEAL_PARTY_COLUMNS[r].company}`]);
  const closedOnly = CLOSED_STATUSES.filter(c => !TERMINAL_STATUSES.includes(c));
  const st = `lower(btrim(coalesce(d.status, '')))`;
  const deals = (await pool.query(
    `SELECT d.id, d.name, d.deal_ref, d.status, d.deal_type, d.team, d.updated_at, d.internal_agent_ids, d.internal_agent,
            d.aml_pep_status, d.aml_risk_level, d.aml_edd_required, d.aml_edd_reason, d.aml_edd_completed_at, d.aml_sof_analysis,
            ${partyCols.join(", ")}, p.name AS property_name
       FROM crm_deals d LEFT JOIN crm_properties p ON p.id = d.property_id
      WHERE ${st} NOT IN (${sqlList(TERMINAL_STATUSES)})
        AND (${st} NOT IN (${sqlList(closedOnly)}) OR d.updated_at > now() - interval '${AML_DASHBOARD_CLOSED_DAYS} days')
        AND ${dealLeftTrackerSql("d")}
        AND (d.landlord_id IS NOT NULL OR d.tenant_id IS NOT NULL OR d.vendor_id IS NOT NULL OR d.purchaser_id IS NOT NULL)
      ORDER BY d.updated_at DESC NULLS LAST
      LIMIT 2000`)).rows;
  if (!deals.length) return { rows: [], unchecked: [] };

  type Party = { key: string; deal: any; role: typeof DEAL_PARTY_ROLES[number]; brandId: string; entityId: string | null };
  const parties: Party[] = [];
  for (const deal of deals) {
    for (const role of DEAL_PARTY_ROLES) {
      const brandId = text(deal[DEAL_PARTY_COLUMNS[role].brand]);
      if (!brandId) continue;
      parties.push({ key: `${deal.id}:${role}`, deal, role, brandId, entityId: text(deal[DEAL_PARTY_COLUMNS[role].company]) || null });
    }
  }
  const dealIds = deals.map((d: any) => String(d.id));
  const brandIds = [...new Set(parties.map(p => p.brandId))];
  const unchecked: string[] = [];
  const read = async <T,>(what: string, run: () => Promise<T>, empty: T): Promise<T> => {
    try { return await run(); } catch (e: any) { unchecked.push(what); console.warn(`[aml-dashboard] could not read ${what}: ${e?.message}`); return empty; }
  };
  const none: any[] = [];
  const { loadPartyKyc } = await import("./deal-gates");
  const { loadFlagReviews, reviewsForDeal, reviewsForParty } = await import("./kyc-red-flags");
  const [states, companies, investigations, prechecks, tokens, idChecks, drafts, kyc4uLatest, agentUsers, reviews] = await Promise.all([
    loadPartyKyc(pool, parties.map(p => ({ role: p.key, brandId: p.brandId, entityId: p.entityId }))),
    read("KYC records", async () => (await pool.query(
      `SELECT id, aml_pep_status, aml_risk_level, aml_edd_required, aml_edd_reason, aml_subject_type FROM crm_companies WHERE id = ANY($1::varchar[])`, [brandIds])).rows, none),
    read("screening records", async () => (await pool.query(
      `SELECT DISTINCT ON (crm_company_id, trading_entity_id) crm_company_id, trading_entity_id, id, sanctions_match, conducted_at, (result->>'kind' = 'precheck') AS precheck
         FROM kyc_investigations WHERE crm_company_id = ANY($1::varchar[]) AND ${SCREENED_INVESTIGATION_SQL}
        ORDER BY crm_company_id, trading_entity_id, conducted_at DESC NULLS LAST, id DESC`, [brandIds])).rows, none),
    read("BGP's checks before asking", async () => (await pool.query(
      `SELECT DISTINCT ON (crm_company_id, trading_entity_id) crm_company_id, trading_entity_id, id, conducted_at, result
         FROM kyc_investigations WHERE crm_company_id = ANY($1::varchar[]) AND result->>'kind' = 'precheck'
        ORDER BY crm_company_id, trading_entity_id, conducted_at DESC NULLS LAST, id DESC`, [brandIds])).rows, none),
    read("client checks", async () => (await pool.query(
      `SELECT deal_id, company_id, request, created_at, completed_at, last_used_at, revoked_at FROM kyc_upload_tokens
        WHERE deal_id = ANY($1::varchar[]) AND is_test IS NOT TRUE AND request IS NOT NULL
        ORDER BY created_at DESC`, [dealIds])).rows, none),
    read("identity checks", async () => (await pool.query(
      `SELECT company_id, status, decision_reason, received_at, first_name, last_name FROM veriff_sessions
        WHERE company_id = ANY($1::varchar[]) AND lower(COALESCE(status, '')) = 'declined'
        ORDER BY received_at DESC NULLS LAST`, [brandIds])).rows, none),
    read("KYC4U requests", async () => (await pool.query(
      `SELECT d.deal_id, d.company_id, d.status, d.created_at, d.filled_at, d.request_item_id, q.status AS request_status
         FROM kyc4u_drafts d LEFT JOIN kyc4u_requests q ON q.list_id = d.request_list_id AND q.item_id = d.request_item_id
        WHERE d.deal_id = ANY($1::varchar[]) AND d.status IN ('queued', 'filled', 'submitted')
          AND d.created_at > now() - interval '180 days'`, [dealIds])).rows, none),
    // KYC4U's own latest status for each brand and each company that signs,
    // the KYC4U mirror's reading (the latest row by date, then the latest recorded).
    read("KYC4U statuses", async () => (await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (company_id) 'brand' AS kind, company_id AS id, status FROM kyc4u_requests
          WHERE company_id = ANY($1::varchar[]) AND list_id NOT LIKE '%:requests'
          ORDER BY company_id, COALESCE(modified_at_source, created_at_source, synced_at) DESC NULLS LAST, synced_at DESC NULLS LAST) b
       UNION ALL
       SELECT * FROM (
         SELECT DISTINCT ON (trading_entity_id) 'company' AS kind, trading_entity_id AS id, status FROM kyc4u_requests
          WHERE trading_entity_id = ANY($2::varchar[]) AND list_id NOT LIKE '%:requests'
          ORDER BY trading_entity_id, COALESCE(modified_at_source, created_at_source, synced_at) DESC NULLS LAST, synced_at DESC NULLS LAST) e`,
      [brandIds, [...new Set(parties.map(p => p.entityId).filter((x): x is string => !!x))]])).rows, none),
    read("the deals' agents", async () => {
      const ids = [...new Set(deals.flatMap((d: any) => Array.isArray(d.internal_agent_ids) ? d.internal_agent_ids : []).filter(Boolean))];
      return ids.length ? (await pool.query(`SELECT id, name FROM users WHERE id = ANY($1::varchar[])`, [ids])).rows : none;
    }, none),
    // Flags the MLRO set aside with a comment: listed on the deal, not counted here.
    read("flags set aside", () => loadFlagReviews(pool, brandIds, dealIds), [] as Awaited<ReturnType<typeof loadFlagReviews>>),
  ]);
  const { kyc4uVerdict } = await import("./kyc4u");
  const meName = me.name.toLowerCase();
  const dealFlags = new Map<string, string[]>();
  for (const deal of deals) dealFlags.set(String(deal.id), applyFlagReviews(dealRedFlags(deal), reviewsForDeal(reviews, String(deal.id))).live.map(f => `Deal: ${f.label}`));

  const rows: AmlDashboardRow[] = [];
  for (const p of parties) {
    const state = states[p.key];
    if (!state?.brandName) continue;
    // The deal card's reading: the screening of the company the deal names
    // (its "signs", server/deal-parties.ts), else the brand's.
    const own = (r: any) => r.crm_company_id === p.brandId && (r.trading_entity_id || null) === (p.entityId || null);
    const latest = investigations.find(own) || null;
    const companyRow = companies.find((c: any) => c.id === p.brandId) || null;
    // No company that signs: no checks before asking to read (the deal card's rule).
    const needsCompany = !p.entityId && String(companyRow?.aml_subject_type || "").toLowerCase() !== "individual";
    const pre = needsCompany ? null : prechecks.find((r: any) => own(r) && isPrecheckResult(r.result)) || null;
    const partyTokens = tokens.filter((t: any) => String(t.deal_id) === String(p.deal.id) && t.company_id === p.brandId);
    const live = partyTokens.filter((t: any) => !t.revoked_at);
    const flags = applyFlagReviews(partyRedFlags({
      company: companyRow,
      latestInvestigation: latest ? { sanctions_match: latest.sanctions_match, conducted_at: latest.conducted_at, precheck: !!latest.precheck } : null,
      precheck: pre ? { result: pre.result, current: !!latest && String(latest.id) === String(pre.id) } : null,
      requests: partyTokens.map((t: any) => ({ ref: t.request?.ref || "", answers: t.request?.answers || null, ownersAnswer: t.request?.ownersAnswer || null })),
      idChecks: idChecks.filter((s: any) => s.company_id === p.brandId).map((s: any) => ({
        status: s.status, decision_reason: s.decision_reason, received_at: s.received_at,
        name: [s.first_name, s.last_name].filter(Boolean).join(" ") || null,
      })),
    }), reviewsForParty(reviews, p.brandId, p.entityId)).live.map(f => f.label);
    const openDrafts = drafts.filter((d: any) => String(d.deal_id) === String(p.deal.id) && d.company_id === p.brandId);
    const kyc4uOpen = openDrafts.some((d: any) => !d.request_item_id || kyc4uVerdict(d.request_status) === "in_review");
    const kyc4uLast = state.source === "company"
      ? kyc4uLatest.find((k: any) => k.kind === "company" && k.id === p.entityId)
      : kyc4uLatest.find((k: any) => k.kind === "brand" && k.id === p.brandId);
    const kyc4uInReview = !!kyc4uLast && kyc4uVerdict(kyc4uLast.status) === "in_review";
    const finished = live.map((t: any) => t.completed_at).filter(Boolean).sort().pop() || null;
    const sent = live.map((t: any) => t.created_at).filter(Boolean).sort().pop() || null;
    const stage = amlStage({
      role: p.role, dealStatus: p.deal.status, kyc: { status: state.status, expiresAt: state.expiresAt },
      precheckAt: pre?.conducted_at || null, clientSentAt: sent, clientFinishedAt: finished, kyc4uOpen, kyc4uInReview,
    }, now);
    const due = amlDue(p.role, p.deal.status);
    const allFlags = [...flags, ...(dealFlags.get(String(p.deal.id)) || [])];
    const agentIds: string[] = Array.isArray(p.deal.internal_agent_ids) ? p.deal.internal_agent_ids.filter(Boolean) : [];
    const agentNames: string[] = Array.isArray(p.deal.internal_agent) ? p.deal.internal_agent.map(text).filter(Boolean) : [];
    const agents = [...new Set([...agentNames, ...agentIds.map(id => text(agentUsers.find((u: any) => String(u.id) === String(id))?.name)).filter(Boolean)])];
    rows.push({
      key: p.key,
      dealId: String(p.deal.id),
      dealName: text(p.deal.name) || "Untitled deal",
      dealRef: p.deal.deal_ref ?? null,
      dealStatus: p.deal.status || null,
      propertyName: text(p.deal.property_name) || null,
      role: p.role,
      brandId: p.brandId,
      brandName: state.brandName,
      signsAs: state.source === "company" || state.source === "same_company" ? state.name : null,
      stage,
      bucket: amlBucket(stage, due, amlDealClosed(p.deal.status)),
      due,
      redFlags: allFlags,
      waitingOn: amlWaitingOn(stage, allFlags.length),
      movedDays: daysSince([
        pre?.conducted_at, ...partyTokens.flatMap((t: any) => [t.created_at, t.last_used_at, t.completed_at]),
        ...openDrafts.flatMap((d: any) => [d.created_at, d.filled_at]), state.approvedAt,
      ], now),
      approvedBy: state.status === "approved" ? state.approvedBy : null,
      expiresAt: state.expiresAt ? new Date(state.expiresAt).toISOString() : null,
      agents,
      mine: agentIds.includes(me.id) || agentNames.some(n => n.toLowerCase() === meName),
    });
  }
  return { rows, unchecked };
}

const router = Router();

router.get("/api/aml-dashboard", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    res.json(await loadAmlDashboard(me));
  } catch (err: any) {
    console.error("[aml-dashboard] feed failed:", err?.message);
    res.status(500).json({ message: "The AML dashboard could not be read." });
  }
});

// One party's documents and history, for the row's trail.
router.get("/api/aml-dashboard/party", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const dealId = text(req.query.dealId);
    const role = text(req.query.role);
    if (!dealId || !isDealPartyRole(role)) return res.status(400).json({ message: "Which deal and party?" });
    const col = DEAL_PARTY_COLUMNS[role];
    const deal = (await pool.query(`SELECT id, ${col.brand} AS brand_id, ${col.company} AS entity_id FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
    if (!deal?.brand_id) return res.status(404).json({ message: `This deal has no ${DEAL_PARTY_LABEL[role].toLowerCase()}.` });
    const entityId = deal.entity_id
      ? (await pool.query(`SELECT id FROM crm_trading_entities WHERE id = $1 AND parent_company_id = $2`, [deal.entity_id, deal.brand_id])).rows[0]?.id || null
      : null;
    const [documents, history, dealLines] = await Promise.all([
      pool.query(
        `SELECT id, doc_type, file_name, file_url, uploaded_at, notes, trading_entity_id
           FROM kyc_documents
          WHERE deleted_at IS NULL AND company_id = $1 AND (trading_entity_id IS NULL OR trading_entity_id = $2)
          ORDER BY uploaded_at DESC NULLS LAST LIMIT 100`, [deal.brand_id, entityId]),
      pool.query(
        `SELECT action, performed_by, notes, created_at FROM kyc_audit_log
          WHERE company_id = $1 OR (entity_kind = 'trading_entity' AND entity_id = $2)
          ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 60`, [deal.brand_id, entityId || ""]),
      pool.query(
        `SELECT field, new_value, reason, changed_by_name, created_at FROM deal_audit_log
          WHERE deal_id = $1 AND field IN ('aml_sign_off', 'kyc4u_result', '${col.company}', '${col.person}')
          ORDER BY created_at DESC NULLS LAST LIMIT 40`, [dealId]),
    ]);
    res.json({
      documents: documents.rows.map((d: any) => ({
        id: String(d.id), type: d.doc_type, name: d.file_name, url: d.file_url, at: d.uploaded_at, note: d.notes,
        onCompany: !!d.trading_entity_id,
      })),
      history: [
        ...history.rows.map((h: any) => ({ at: h.created_at, who: h.performed_by || null, what: h.action, detail: h.notes || null })),
        ...dealLines.rows.map((h: any) => ({ at: h.created_at, who: h.changed_by_name || null, what: h.field, detail: h.reason || h.new_value || null })),
      ].sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime()).slice(0, 80),
    });
  } catch (err: any) {
    console.error("[aml-dashboard] party trail failed:", err?.message);
    res.status(500).json({ message: "The party's trail could not be read." });
  }
});

export default router;

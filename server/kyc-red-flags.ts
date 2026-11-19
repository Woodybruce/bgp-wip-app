// Red flags for a deal's parties, and the alert to the deal's agents when
// the client checks raise one. The rules are shared/kyc-red-flags.ts; this
// file only reads the records and sends. Woody, 17 November 2026:
// "basically we do the normal checks expected and if there is a red flag
// then we get KYC4U".

import { pool } from "./db";
import {
  applyFlagReviews, dealRedFlags, partyRedFlags, redFlagAlertKey,
  type KycFlagReview, type KycRedFlag, type KycRedFlagKind, type PartyRedFlagFacts, type SetAsideFlag,
} from "@shared/kyc-red-flags";
import { kycRedFlagEmail, kycReplyAddresses } from "@shared/kyc-request";
import { isPrecheckResult } from "@shared/kyc-prechecks";
import { SCREENED_INVESTIGATION_SQL } from "./kyc-prechecks";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export interface DealRedFlags {
  // The flags that count: what sends a party to KYC4U and stops BGP's sign-off.
  parties: Record<string, KycRedFlag[]>;
  deal: KycRedFlag[];
  // Flags the MLRO set aside with a comment, listed but no longer counted.
  setAside: Record<string, SetAsideFlag[]>;
  dealSetAside: SetAsideFlag[];
  // A record that could not be read: the screens say so, never "no red flags".
  unchecked: string[];
}

// ── Flags set aside (Woody, 19 November 2026) ──────────────────────────────

export interface FlagReviewRow extends KycFlagReview { companyId: string | null; entityId: string | null; dealId: string | null }

/** The live set-aside decisions for some brands and deals. */
export async function loadFlagReviews(db: Db, brandIds: string[], dealIds: string[]): Promise<FlagReviewRow[]> {
  if (!brandIds.length && !dealIds.length) return [];
  const { rows } = await db.query(
    `SELECT id, company_id, trading_entity_id, deal_id, flag_key, evidence, comment, set_aside_by_name, set_aside_at
       FROM kyc_flag_reviews
      WHERE restored_at IS NULL AND (company_id = ANY($1::varchar[]) OR (company_id IS NULL AND deal_id = ANY($2::varchar[])))
      ORDER BY set_aside_at DESC`, [brandIds, dealIds]);
  return rows.map((r: any) => ({
    id: Number(r.id), flagKey: String(r.flag_key), evidence: Array.isArray(r.evidence) ? r.evidence.map(String) : [],
    comment: String(r.comment || ""), by: r.set_aside_by_name || null, at: r.set_aside_at ? new Date(r.set_aside_at).toISOString() : null,
    companyId: r.company_id || null, entityId: r.trading_entity_id || null, dealId: r.deal_id || null,
  }));
}

// A party's decisions: the brand's own (no company), and the company that
// signs for it now.
export const reviewsForParty = (rows: FlagReviewRow[], brandId: string, entityId: string | null): KycFlagReview[] =>
  rows.filter(r => r.companyId === brandId && (!r.entityId || r.entityId === entityId));
export const reviewsForDeal = (rows: FlagReviewRow[], dealId: string): KycFlagReview[] =>
  rows.filter(r => !r.companyId && r.dealId === dealId);

// The brand's KYC record history about the fields a record flag reads (who
// wrote the risk, the PEP status, enhanced due diligence, and when), newest
// first, a few per brand: the facts behind a flag from the record.
export async function loadRecordHistory(db: Db, brandIds: string[]): Promise<Record<string, NonNullable<PartyRedFlagFacts["recordHistory"]>>> {
  const out: Record<string, NonNullable<PartyRedFlagFacts["recordHistory"]>> = {};
  if (!brandIds.length) return out;
  const { rows } = await db.query(
    `SELECT k.company_id, k.action, k.notes, k.created_at, COALESCE(u.name, k.performed_by) AS who
       FROM kyc_audit_log k LEFT JOIN users u ON u.id::text = k.performed_by
      WHERE k.company_id = ANY($1::varchar[])
        AND k.action <> 'precheck'
        AND (k.action ~* '(pep|risk|edd|sanction|screen|auto_decision)' OR k.notes ~* '(pep|risk rated|enhanced due diligence|edd|sanction)')
      ORDER BY k.created_at DESC
      LIMIT 200`, [brandIds]);
  for (const r of rows) {
    const list = (out[r.company_id] ||= []);
    if (list.length >= 4) continue;
    list.push({ at: r.created_at ? new Date(r.created_at).toISOString() : null, what: String(r.notes || r.action || "").replace(/\s+/g, " ").trim().slice(0, 300), who: r.who ? String(r.who).slice(0, 80) : null });
  }
  return out;
}

// `signs`: the company that signs for a party (by brand id), when the deal
// names one: its screening is read, not the brand's (server/deal-parties.ts).
// A company party with none has no checks before asking to read: they are
// about the company that signs (Woody, 19 November 2026), so a brand-level
// check's findings are not its red flags.
export async function loadDealRedFlags(dealId: string, companyIds: string[], signs: Record<string, string> = {}): Promise<DealRedFlags> {
  const ids = [...new Set(companyIds.filter(Boolean))];
  const unchecked: string[] = [];
  async function read<T>(what: string, query: () => Promise<T>, empty: T): Promise<T> {
    try {
      return await query();
    } catch (e: any) {
      unchecked.push(what);
      console.warn(`[kyc-red-flags] could not read ${what}: ${e?.message}`);
      return empty;
    }
  }
  const none: any[] = [];
  const companies = ids.length ? await read("KYC records", async () => (await pool.query(
    `SELECT id, aml_pep_status, aml_risk_level, aml_edd_required, aml_edd_reason, aml_subject_type FROM crm_companies WHERE id = ANY($1::varchar[])`, [ids])).rows, none) : none;
  const reviews = await read("flags set aside", () => loadFlagReviews(pool, ids, [dealId]), [] as FlagReviewRow[]);
  const history = ids.length ? await read("the KYC records' history", () => loadRecordHistory(pool, ids), {} as Record<string, NonNullable<PartyRedFlagFacts["recordHistory"]>>) : {};
  // The latest record that screened anyone: a Companies House lookup that
  // screened nothing (the nightly refresh) never reads as "no match".
  // One row per brand and company: the party's own is picked below.
  const investigations = ids.length ? await read("screening records", async () => (await pool.query(
    `SELECT DISTINCT ON (crm_company_id, trading_entity_id) crm_company_id, trading_entity_id, id, sanctions_match, conducted_at, (result->>'kind' = 'precheck') AS precheck
       FROM kyc_investigations WHERE crm_company_id = ANY($1::varchar[]) AND ${SCREENED_INVESTIGATION_SQL}
      ORDER BY crm_company_id, trading_entity_id, conducted_at DESC NULLS LAST, id DESC`, [ids])).rows, none) : none;
  const prechecks = ids.length ? await read("BGP's checks before asking", async () => (await pool.query(
    `SELECT DISTINCT ON (crm_company_id, trading_entity_id) crm_company_id, trading_entity_id, id, result
       FROM kyc_investigations WHERE crm_company_id = ANY($1::varchar[]) AND result->>'kind' = 'precheck'
      ORDER BY crm_company_id, trading_entity_id, conducted_at DESC NULLS LAST, id DESC`, [ids])).rows, none) : none;
  const requests = ids.length ? await read("client checks", async () => (await pool.query(
    `SELECT company_id, request FROM kyc_upload_tokens
      WHERE deal_id = $1 AND company_id = ANY($2::varchar[]) AND is_test IS NOT TRUE AND request IS NOT NULL
      ORDER BY created_at DESC`, [dealId, ids])).rows, none) : none;
  const idChecks = ids.length ? await read("identity checks", async () => (await pool.query(
    `SELECT company_id, status, decision_reason, received_at, first_name, last_name FROM veriff_sessions
      WHERE company_id = ANY($1::varchar[]) AND lower(COALESCE(status, '')) = 'declined'
      ORDER BY received_at DESC NULLS LAST`, [ids])).rows, none) : none;
  const deal = await read("the deal's AML fields", async () => (await pool.query(
    `SELECT aml_pep_status, aml_risk_level, aml_edd_required, aml_edd_reason, aml_edd_completed_at, aml_sof_analysis
       FROM crm_deals WHERE id = $1`, [dealId])).rows[0] || null, null as any);

  const parties: Record<string, KycRedFlag[]> = {};
  const setAside: Record<string, SetAsideFlag[]> = {};
  for (const id of ids) {
    const own = (r: any) => r.crm_company_id === id && (r.trading_entity_id || null) === (signs[id] || null);
    const latest = investigations.find(own) || null;
    const companyRow = companies.find((c: any) => c.id === id) || null;
    const needsCompany = !signs[id] && String(companyRow?.aml_subject_type || "").toLowerCase() !== "individual";
    const pre = needsCompany ? null : prechecks.find((p: any) => own(p) && isPrecheckResult(p.result)) || null;
    const all = partyRedFlags({
      company: companyRow,
      recordHistory: history[id] || [],
      latestInvestigation: latest ? { sanctions_match: latest.sanctions_match, conducted_at: latest.conducted_at, precheck: !!latest.precheck } : null,
      precheck: pre ? { result: pre.result, current: !!latest && String(latest.id) === String(pre.id) } : null,
      requests: requests.filter((r: any) => r.company_id === id).map((r: any) => ({ ref: r.request?.ref || "", answers: r.request?.answers || null, ownersAnswer: r.request?.ownersAnswer || null })),
      idChecks: idChecks.filter((s: any) => s.company_id === id).map((s: any) => ({
        status: s.status, decision_reason: s.decision_reason, received_at: s.received_at,
        name: [s.first_name, s.last_name].filter(Boolean).join(" ") || null,
      })),
    });
    const split = applyFlagReviews(all, reviewsForParty(reviews, id, signs[id] || null));
    parties[id] = split.live;
    setAside[id] = split.setAside;
  }
  const dealSplit = applyFlagReviews(dealRedFlags(deal), reviewsForDeal(reviews, dealId));
  return { parties, deal: dealSplit.live, setAside, dealSetAside: dealSplit.setAside, unchecked };
}

// ── Setting a flag aside, and putting it back ──────────────────────────────

export class FlagReviewRefusal extends Error {
  constructor(message: string, public status = 409) { super(message); this.name = "FlagReviewRefusal"; }
}

/**
 * Sets one flag aside for a party (role) or on the deal record (no role).
 * The flag is read again here, so only a flag the party has now can be set
 * aside, with the words the app wrote, never the request's.
 */
export async function setFlagAside(input: {
  dealId: string; brandId: string | null; entityId: string | null; key: string; comment: string; me: { id: string; name: string };
}): Promise<{ review: KycFlagReview; flag: KycRedFlag }> {
  const flags = await loadDealRedFlags(input.dealId, input.brandId ? [input.brandId] : [], input.brandId && input.entityId ? { [input.brandId]: input.entityId } : {});
  if (flags.unchecked.length) throw new FlagReviewRefusal(`Not set aside: the app could not read ${flags.unchecked.join(", ")}. Try again in a moment.`);
  const live = input.brandId ? flags.parties[input.brandId] || [] : flags.deal;
  const flag = live.find(f => f.key === input.key);
  if (!flag) throw new FlagReviewRefusal("That red flag is not there any more (it may have been set aside already). Reload the box.");
  // A flag read from the brand's own KYC record holds for the brand, whoever
  // signs; any other holds for the company that signs now.
  const entityId = input.brandId && !flag.key.startsWith("record:") ? input.entityId : null;
  const row = (await pool.query(
    `INSERT INTO kyc_flag_reviews (company_id, trading_entity_id, deal_id, flag_key, flag_label, flag_source, evidence, comment, set_aside_by, set_aside_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10) RETURNING id, set_aside_at`,
    [input.brandId, entityId, input.dealId, flag.key, flag.label.slice(0, 500), flag.source.slice(0, 500), JSON.stringify(flag.evidence), input.comment, input.me.id, input.me.name])).rows[0];
  if (input.brandId) {
    await pool.query(
      `INSERT INTO kyc_audit_log (company_id, action, performed_by, notes, entity_kind, entity_id) VALUES ($1, 'red_flag_set_aside', $2, $3, $4, $5)`,
      [input.brandId, input.me.name, `Red flag set aside by ${input.me.name}: ${flag.label}. Why: ${input.comment}`, entityId ? "trading_entity" : null, entityId]).catch(() => {});
  }
  return {
    flag,
    review: { id: Number(row.id), flagKey: flag.key, evidence: flag.evidence, comment: input.comment, by: input.me.name, at: new Date(row.set_aside_at).toISOString() },
  };
}

/** Puts a set-aside flag back: it counts again. The decision stays on the record. Only one about the deal's own parties or record. */
export async function putFlagBack(input: { dealId: string; partyIds: string[]; reviewId: number; me: { id: string; name: string } }): Promise<{ label: string; companyId: string | null }> {
  const row = (await pool.query(
    `UPDATE kyc_flag_reviews SET restored_at = now(), restored_by = $2, restored_by_name = $3
      WHERE id = $1 AND restored_at IS NULL AND (company_id = ANY($4::varchar[]) OR (company_id IS NULL AND deal_id = $5))
      RETURNING company_id, trading_entity_id, flag_label`,
    [input.reviewId, input.me.id, input.me.name, input.partyIds, input.dealId])).rows[0];
  if (!row) throw new FlagReviewRefusal("That flag is not set aside any more. Reload the box.");
  if (row.company_id) {
    await pool.query(
      `INSERT INTO kyc_audit_log (company_id, action, performed_by, notes, entity_kind, entity_id) VALUES ($1, 'red_flag_put_back', $2, $3, $4, $5)`,
      [row.company_id, input.me.name, `Red flag put back by ${input.me.name}: ${row.flag_label}`, row.trading_entity_id ? "trading_entity" : null, row.trading_entity_id || null]).catch(() => {});
  }
  return { label: String(row.flag_label), companyId: row.company_id || null };
}

// A request's own identity checks, for a request with no party record (a
// test, which runs a real Veriff check since 17 November 2026, or one not
// tied to a company): a check Veriff declined there is a red flag as it is
// on a party.
export async function requestIdChecks(sessionIds: unknown): Promise<PartyRedFlagFacts["idChecks"]> {
  const ids = Array.isArray(sessionIds) ? sessionIds.filter((id): id is string => typeof id === "string") : [];
  if (!ids.length) return [];
  const { rows } = await pool.query(
    `SELECT status, decision_reason, received_at, first_name, last_name FROM veriff_sessions WHERE session_id = ANY($1::text[])`, [ids]);
  return rows.map((s: any) => ({
    status: s.status, decision_reason: s.decision_reason, received_at: s.received_at,
    name: [s.first_name, s.last_name].filter(Boolean).join(" ") || null,
  }));
}

// The flags the client checks themselves raise: an alert goes for these the
// moment they happen. The rest come from screening and the MLRO's records,
// which the deal's AML card shows.
const ALERTED: KycRedFlagKind[] = ["client_pep", "id_declined"];

// Emails the agents copied on the request (on a test, the admin who sent
// it) about each red flag the request has not alerted yet, and remembers it.
export async function alertRedFlags(token: string): Promise<{ sent: number }> {
  const row = (await pool.query(
    `SELECT token, deal_id, company_id, trading_entity_id, contact_name, contact_email, request, is_test FROM kyc_upload_tokens WHERE token = $1`, [token])).rows[0];
  const request = row?.request;
  if (!row || !request?.ref) return { sent: 0 };
  let flags: KycRedFlag[];
  if (row.is_test || !row.company_id) {
    flags = partyRedFlags({ company: null, latestInvestigation: null, requests: [{ ref: request.ref, answers: request.answers || null, ownersAnswer: request.ownersAnswer || null }], idChecks: await requestIdChecks(request.veriffSessionIds) });
  } else {
    flags = (await loadDealRedFlags(row.deal_id, [row.company_id], row.trading_entity_id ? { [row.company_id]: row.trading_entity_id } : {})).parties[row.company_id] || [];
  }
  const done: string[] = Array.isArray(request.redFlagAlerts) ? request.redFlagAlerts : [];
  const fresh = flags.filter(f => ALERTED.includes(f.kind) && !done.includes(redFlagAlertKey(f)));
  if (!fresh.length) return { sent: 0 };
  const to = kycReplyAddresses(row, request.cc);
  const { sendKycEmail } = await import("./aml-portal");
  const linkBase = (process.env.PUBLIC_APP_URL || "https://chatbgp.app").replace(/\/+$/, "");
  const sent = await sendKycEmail({
    to,
    build: sentFrom => kycRedFlagEmail({
      partyName: request.partyName, recipientName: row.contact_name, dealName: request.dealName, ref: request.ref,
      dealLink: row.is_test ? linkBase : `${linkBase}/deals/${encodeURIComponent(row.deal_id)}`,
      flags: fresh, sentFrom, test: !!row.is_test,
    }),
  });
  if (!sent.ok) {
    console.warn(`[kyc-red-flags] the red flag alert for ${request.ref} was not sent: ${sent.error}`);
    return { sent: 0 };
  }
  // Only the keys this send covered, added to whatever is stored now.
  await pool.query(
    `UPDATE kyc_upload_tokens
        SET request = jsonb_set(request, '{redFlagAlerts}',
              COALESCE(request->'redFlagAlerts', '[]'::jsonb) || $2::jsonb)
      WHERE token = $1`,
    [token, JSON.stringify(fresh.map(redFlagAlertKey))],
  );
  if (row.company_id && !row.is_test) {
    await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'red_flag_alert', 'ChatBGP', $2)`,
      [row.company_id, `Red flag on ref ${request.ref}, the agents told to raise it with KYC4U: ${fresh.map(f => f.label).join("; ")}`]).catch(() => {});
  }
  return { sent: fresh.length };
}

// A decision from Veriff: the requests that started that session.
export async function alertRedFlagsForSession(sessionId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT token FROM kyc_upload_tokens WHERE request->'veriffSessionIds' ? $1`, [sessionId]);
  for (const r of rows) await alertRedFlags(r.token);
}

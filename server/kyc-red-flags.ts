// Red flags for a deal's parties, and the alert to the deal's agents when
// the client checks raise one. The rules are shared/kyc-red-flags.ts; this
// file only reads the records and sends. Woody, 17 November 2026:
// "basically we do the normal checks expected and if there is a red flag
// then we get KYC4U".

import { pool } from "./db";
import { dealRedFlags, partyRedFlags, redFlagAlertKey, type KycRedFlag, type KycRedFlagKind, type PartyRedFlagFacts } from "@shared/kyc-red-flags";
import { kycRedFlagEmail, kycReplyAddresses } from "@shared/kyc-request";
import { isPrecheckResult } from "@shared/kyc-prechecks";
import { SCREENED_INVESTIGATION_SQL } from "./kyc-prechecks";

export interface DealRedFlags {
  parties: Record<string, KycRedFlag[]>;
  deal: KycRedFlag[];
  // A record that could not be read: the screens say so, never "no red flags".
  unchecked: string[];
}

// `signs`: the company that signs for a party (by brand id), when the deal
// names one: its screening is read, not the brand's (server/deal-parties.ts).
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
    `SELECT id, aml_pep_status, aml_risk_level, aml_edd_required, aml_edd_reason FROM crm_companies WHERE id = ANY($1::varchar[])`, [ids])).rows, none) : none;
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
  for (const id of ids) {
    const own = (r: any) => r.crm_company_id === id && (r.trading_entity_id || null) === (signs[id] || null);
    const latest = investigations.find(own) || null;
    const pre = prechecks.find((p: any) => own(p) && isPrecheckResult(p.result)) || null;
    parties[id] = partyRedFlags({
      company: companies.find((c: any) => c.id === id) || null,
      latestInvestigation: latest ? { sanctions_match: latest.sanctions_match, conducted_at: latest.conducted_at, precheck: !!latest.precheck } : null,
      precheck: pre ? { result: pre.result, current: !!latest && String(latest.id) === String(pre.id) } : null,
      requests: requests.filter((r: any) => r.company_id === id).map((r: any) => ({ ref: r.request?.ref || "", answers: r.request?.answers || null, ownersAnswer: r.request?.ownersAnswer || null })),
      idChecks: idChecks.filter((s: any) => s.company_id === id).map((s: any) => ({
        status: s.status, decision_reason: s.decision_reason, received_at: s.received_at,
        name: [s.first_name, s.last_name].filter(Boolean).join(" ") || null,
      })),
    });
  }
  return { parties, deal: dealRedFlags(deal), unchecked };
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

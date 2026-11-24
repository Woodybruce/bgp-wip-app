// Client KYC with no transaction (Woody, 24 November 2026: "Yes build it
// within companies and show in the CRM boards and we will want to be able to
// aml all the sub companies within each company, tenants have lots of spv
// when taking leases as example and some landlords have lots of spvs to own
// buildings so we need to be able to aml as many sub companies as we can and
// use those for xero invoicing too").
//
// A client file is BGP's checks on one of its clients, opened when BGP is
// instructed and before any transaction exists: a leasing or sale
// instruction, advice on a purchase, or a tenant BGP acts for to find sites.
// It is about one company that signs (a sub company filed under the account,
// crm_trading_entities), or the account's own record when that record is a
// private individual, a trust or a UK public body. The steps are a
// transaction party's (BGP's checks before asking, the client checks, the
// people to check, the documents, the sign-off) and the sign-off writes the
// same approval every transaction reads, so a transaction with that company
// is cleared when it comes.

import { brandSignOffScope, entitySignOffScope } from "./party-kyc";

// ── A sub company's KYC, as the CRM chip and the Companies view read it ─────
//
// Its own record (crm_entity_kyc); with none, the account's decision when the
// sub company is the account's own legal company (the same Companies House
// number) and the account was approved or rejected, as a transaction reads it
// (partyKycState's sameLegalCompany). A bare "in review" the retired in-app
// screening left on the account is not read (24 November 2026), as the AML
// board does not.
const chSql = (col: string) => {
  const v = `regexp_replace(upper(COALESCE(${col}, '')), '\\s', '', 'g')`;
  return `(CASE WHEN ${v} ~ '^[0-9]{1,7}$' THEN lpad(${v}, 8, '0') ELSE ${v} END)`;
};

/** Joins and columns for a sub company's KYC (alias e: crm_trading_entities; adds k, ob, obl). */
export function subCompanyKycSql(e = "e"): { joins: string; columns: string } {
  // Only a sign-off counts (24 November 2026): the sub company's own when it has one,
  // else the account's when it is the account's own legal company.
  const signed = (col: string) => `lower(COALESCE(${col}, '')) IN ('approved', 'rejected', 'expired')`;
  const own = signed("k.kyc_status");
  return {
    joins: `LEFT JOIN crm_entity_kyc k ON k.entity_kind = 'trading_entity' AND k.entity_id = ${e}.id
         LEFT JOIN crm_companies ob ON ob.id = ${e}.parent_company_id AND NOT (${own})
               AND ${signed("ob.kyc_status")}
               AND ${chSql(`${e}.companies_house_number`)} <> '' AND ${chSql(`${e}.companies_house_number`)} = ${chSql("ob.companies_house_number")}
         LEFT JOIN LATERAL (SELECT notes, created_at FROM kyc_audit_log WHERE company_id = ob.id AND action = 'kyc_approved'
                             ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1) obl ON ob.id IS NOT NULL`,
    columns: `CASE WHEN ${own} THEN k.kyc_status ELSE ob.kyc_status END AS kyc_status,
              CASE WHEN ${own} THEN k.expires_at ELSE ob.kyc_expires_at END AS expires_at,
              CASE WHEN ${own} THEN k.approved_at ELSE ob.kyc_checked_at END AS approved_at,
              CASE WHEN ${own} THEN k.evidence->'bgpSignOff'->>'regime' END AS regime,
              CASE WHEN ${own} THEN k.evidence->'bgpSignOff'->>'at' END AS signoff_at,
              obl.notes AS acct_notes, obl.created_at AS acct_logged, (ob.id IS NOT NULL) AS from_account`,
  };
}

/** The scope of an approval read by subCompanyKycSql: the sub company's own sign-off, or the account's approval line. */
export function subCompanyScope(r: { kyc_status?: unknown; from_account?: unknown; acct_notes?: unknown; acct_logged?: unknown; approved_at?: unknown; regime?: unknown; signoff_at?: unknown }): "sanctions_only" | null {
  if (String(r.kyc_status || "").toLowerCase() !== "approved") return null;
  return r.from_account
    ? brandSignOffScope({ notes: r.acct_notes, loggedAt: r.acct_logged, checkedAt: r.approved_at })
    : entitySignOffScope({ regime: r.regime, signedOffAt: r.signoff_at, approvedAt: r.approved_at });
}

export const CLIENT_INSTRUCTIONS = [
  { key: "letting", label: "A leasing instruction" },
  { key: "sale", label: "A sale instruction" },
  { key: "purchase", label: "Advising on a purchase" },
  { key: "tenant_rep", label: "Acting for a tenant to find sites" },
  { key: "other", label: "Other work for them" },
] as const;
export type ClientInstruction = typeof CLIENT_INSTRUCTIONS[number]["key"];

export const isClientInstruction = (v: unknown): v is ClientInstruction =>
  typeof v === "string" && CLIENT_INSTRUCTIONS.some(i => i.key === v);

export const clientInstructionLabel = (v: string | null | undefined): string | null =>
  CLIENT_INSTRUCTIONS.find(i => i.key === v)?.label || null;

const clean = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * What the emails, the client's page and the history call the work where a
 * transaction's name goes ("Before our instruction from Landsec can go ahead").
 */
export const clientFileName = (accountName: string | null | undefined): string =>
  `our instruction from ${clean(accountName) || "you"}`;

/** The side BGP's client is on, from what BGP is instructed on: what a transaction party's role would be ("client" when not known). */
export const clientFileRole = (instruction: string | null | undefined): "landlord" | "vendor" | "purchaser" | "tenant" | "client" =>
  instruction === "letting" ? "landlord" : instruction === "sale" ? "vendor" : instruction === "purchase" ? "purchaser" : instruction === "tenant_rep" ? "tenant" : "client";

/** The route segment for a subject: a sub company's id, or "self" for the account's own record. */
export const CLIENT_SELF = "self";
export const clientSubjectParam = (entityId: string | null | undefined): string => entityId || CLIENT_SELF;
export const clientSubjectEntity = (param: string | null | undefined): string | null => {
  const p = clean(param);
  return !p || p === CLIENT_SELF ? null : p;
};

/** The account's own record is a subject only when it is a person, a trust or a UK public body (it has no company that signs). */
export const recordIsOwnSubject = (amlSubjectType: string | null | undefined): boolean =>
  ["individual", "trust", "public_body"].includes(clean(amlSubjectType).toLowerCase());

// ── A company's KYC on its CRM row ──────────────────────────────────────────

export type ClientKycTone = "ok" | "warn" | "bad" | "none";

export interface ClientKycCompanyRow {
  // The company's own approval state (crm_entity_kyc for a sub company, the record's for the account itself).
  status: string | null;
  expiresAt: string | null;
  scope?: "sanctions_only" | null;
  // Work started on it: a client file open, a request sent, or BGP's checks run.
  started?: boolean;
}

export interface ClientKycSummary {
  total: number;
  cleared: number;
  expiring: number;
  expired: number;
  rejected: number;
  inProgress: number;
  notChecked: number;
  sanctionsOnly: number;
  /** The soonest re-check date among the cleared ones. */
  nextExpiry: string | null;
}

export const CLIENT_KYC_EXPIRING_DAYS = 30;

/** One row's bucket: cleared (in date, full checks), expiring, expired, rejected, in progress or not checked. */
export function clientKycBucket(row: ClientKycCompanyRow, now: Date): "cleared" | "expiring" | "expired" | "rejected" | "in_progress" | "not_checked" | "sanctions_only" {
  const status = clean(row.status).toLowerCase();
  if (status === "rejected") return "rejected";
  if (status === "expired") return "expired";
  if (status === "approved") {
    const until = row.expiresAt ? Date.parse(row.expiresAt) : NaN;
    if (Number.isFinite(until) && until < now.getTime()) return "expired";
    if (row.scope === "sanctions_only") return "sanctions_only";
    if (Number.isFinite(until) && until - now.getTime() <= CLIENT_KYC_EXPIRING_DAYS * 86400000) return "expiring";
    return "cleared";
  }
  // Only a sign-off counts (24 November 2026): "in review" or "pending" on a record is not
  // progress; work under way is (BGP's checks run, a client file open, a request sent).
  if (row.started) return "in_progress";
  return "not_checked";
}

export function clientKycSummary(rows: ClientKycCompanyRow[], now: Date): ClientKycSummary {
  const out: ClientKycSummary = { total: rows.length, cleared: 0, expiring: 0, expired: 0, rejected: 0, inProgress: 0, notChecked: 0, sanctionsOnly: 0, nextExpiry: null };
  for (const r of rows) {
    const b = clientKycBucket(r, now);
    if (b === "cleared") out.cleared++;
    else if (b === "expiring") out.expiring++;
    else if (b === "expired") out.expired++;
    else if (b === "rejected") out.rejected++;
    else if (b === "in_progress") out.inProgress++;
    else if (b === "sanctions_only") out.sanctionsOnly++;
    else out.notChecked++;
    if ((b === "cleared" || b === "expiring") && r.expiresAt && (!out.nextExpiry || r.expiresAt < out.nextExpiry)) out.nextExpiry = r.expiresAt;
  }
  return out;
}

/** The KYC chip on a CRM row: a few words and a tone. Expiring counts as cleared until its date. */
export function clientKycWords(s: ClientKycSummary): { label: string; tone: ClientKycTone; title: string } {
  const done = s.cleared + s.expiring;
  const parts = [
    done ? `${done} cleared` : null,
    s.expiring ? `${s.expiring} due for a re-check within ${CLIENT_KYC_EXPIRING_DAYS} days` : null,
    s.sanctionsOnly ? `${s.sanctionsOnly} sanctions checks only` : null,
    s.inProgress ? `${s.inProgress} in progress` : null,
    s.expired ? `${s.expired} expired` : null,
    s.rejected ? `${s.rejected} rejected` : null,
    s.notChecked ? `${s.notChecked} not checked` : null,
  ].filter(Boolean).join(", ");
  const title = s.total ? `KYC on ${s.total} compan${s.total === 1 ? "y" : "ies"}: ${parts}` : "No companies recorded for KYC";
  if (!s.total) return { label: "No KYC", tone: "none", title };
  if (s.rejected) return { label: "KYC rejected", tone: "bad", title };
  if (done === s.total) return { label: s.expiring ? "KYC due soon" : "KYC cleared", tone: s.expiring ? "warn" : "ok", title };
  // Every company signed off, some or all for the sanctions checks only: said as such, the
  // same words on the CRM boards, the Companies view and the company page (24 November 2026).
  if (s.sanctionsOnly && done + s.sanctionsOnly === s.total) return { label: done ? "Cleared, some sanctions only" : "Sanctions only", tone: "ok", title: `${title}. Sanctions checks only cover lettings under £10,000 a month, not a sale or a bigger letting.` };
  if (s.expired && !done) return { label: "KYC expired", tone: "bad", title };
  if (!done && !s.inProgress && !s.sanctionsOnly) return { label: s.expired ? "KYC expired" : "No KYC", tone: s.expired ? "bad" : "none", title };
  if (!done && s.inProgress && !s.sanctionsOnly) return { label: "KYC in progress", tone: "warn", title };
  return { label: `KYC ${done} of ${s.total}`, tone: "warn", title };
}

// ── The client file's Next line ─────────────────────────────────────────────

export interface ClientKycNextFacts {
  rejected: boolean;
  cleared: { until: string | null } | null;
  sanctionsOnly: boolean;           // signed off for sanctions checks only
  precheck: "not_run" | "running" | "done" | "off";
  redFlags: number;                 // live red flags and higher-risk factors on it
  canDecide: boolean;               // the person reading is an officer
  whoToAsk: string | null;          // the person the checks go to
  request: "none" | "not_sent" | "sent" | "opened" | "in_progress" | "finished" | "expired" | "cancelled";
  waitingOn: string[];              // people still owing their checks
  signOffBlocked: string | null;
  // The company's sanctions-only switch is on: lettings under £10,000 a month, so nothing is asked of the client.
  sanctionsChecks?: boolean;
  // A private individual's date of birth, before a sanctions-only sign-off (24 November 2026).
  dobNeeded?: boolean;
}

export interface ClientKycNext {
  tone: "ok" | "act" | "wait" | "bad";
  lead: string;
  words: string;
  action: "run_checks" | "pick_person" | "send_checks" | "remind" | "sign_off" | "full_checks" | "person_details" | null;
}

const step = (tone: ClientKycNext["tone"], lead: string, words: string, action: ClientKycNext["action"] = null): ClientKycNext => ({ tone, lead, words, action });

/** What happens next on a client file, in a few words, with at most one button. */
export function clientKycNextStep(f: ClientKycNextFacts, fmt: (iso: string) => string = iso => iso.slice(0, 10)): ClientKycNext {
  if (f.rejected) return step("bad", "Rejected", "by the officers");
  if (f.cleared) return step("ok", "Cleared", f.cleared.until ? `until ${fmt(f.cleared.until)}` : "");
  if (f.sanctionsOnly) return step("act", "To do", "signed off for sanctions checks only: run the full checks", "full_checks");
  if (f.sanctionsChecks && f.dobNeeded) return step("act", "To do", "add their date of birth", "person_details");
  if (f.precheck === "running") return step("wait", "Checking", "BGP's checks are running");
  if (f.precheck === "not_run") return step("act", "To do", "run BGP's checks", "run_checks");
  if (f.redFlags) return step("act", "Red flag", `${f.redFlags} to review: for the officers`, f.canDecide && !f.signOffBlocked ? "sign_off" : null);
  if (f.sanctionsChecks) return f.signOffBlocked ? step("wait", "Not ready to sign off", f.signOffBlocked.replace(/\.$/, "")) : step("act", "Ready to sign off", "sanctions checks only", "sign_off");
  if (f.request === "none" || f.request === "cancelled" || f.request === "expired") {
    return f.whoToAsk ? step("act", "To do", `send the client checks to ${f.whoToAsk}`, "send_checks") : step("act", "To do", "pick who to ask", "pick_person");
  }
  if (f.request === "not_sent") return step("act", "To do", "the email didn't go: send it again", "send_checks");
  if (f.request !== "finished") return step("wait", `Waiting on ${f.whoToAsk || "the client"}`, f.request === "opened" ? "opened, not finished" : f.request === "in_progress" ? "started, not finished" : "for the checks", "remind");
  if (f.waitingOn.length) return step("wait", `Waiting on ${f.waitingOn.slice(0, 2).join(" and ")}${f.waitingOn.length > 2 ? ` and ${f.waitingOn.length - 2} more` : ""}`, "for their own checks");
  if (f.signOffBlocked) return step("wait", "Not ready to sign off", f.signOffBlocked.replace(/\.$/, ""));
  return step("act", "Ready to sign off", "the checks are in", "sign_off");
}

// ── Many sub companies at once ──────────────────────────────────────────────

export const CLIENT_KYC_BULK_MAX = 60;

/** The sub companies picked for BGP's checks, without repeats, capped. */
export function bulkCheckList(ids: unknown, allowed: string[]): { ids: string[]; unknown: number; over: number } {
  const want = [...new Set((Array.isArray(ids) ? ids : []).map(v => clean(v)).filter(Boolean))];
  const allowedSet = new Set(allowed);
  const known = want.filter(id => allowedSet.has(id));
  return { ids: known.slice(0, CLIENT_KYC_BULK_MAX), unknown: want.length - known.length, over: Math.max(0, known.length - CLIENT_KYC_BULK_MAX) };
}

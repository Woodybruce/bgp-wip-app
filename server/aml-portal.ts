// The client checks request (in-app AML). An agent asks a party's contact
// for an identity check and documents; the contact gets one email and one
// page of their own; reminders follow; replies with documents are filed;
// the deal's agents hear when the contact has finished. Rebuilt on
// 17 November 2026 (Woody: emails "from kyc@chatbgp.app", "copy the agent
// that has done the deal", "BGP logo", "check the whole system because it
// was built ages ago and wasnt working properly", "not that clear or user
// friendly"). What the old one did wrong, and the rule now:
//   - it sent from BGP_AML_MAILBOX, which was never set, so nothing went:
//     KYC_MAILBOX (default kyc@brucegillinghampollard.com since 23 November
//     2026), and BGP's shared mailbox when Microsoft will not send as it,
//     never the app's own address;
//   - its link opened a "no longer in use" page: the client page is back;
//   - an upload was read by the AI and then deleted: every file is now
//     stored and filed on the party's KYC record;
//   - reminders and the reply reader were never run: they run on a timer
//     while in-app AML is on;
//   - the agents were never copied: the deal's agents and the sender are.
// The words of every email are in shared/kyc-request.ts.

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import multer from "./utils/upload";
import { pool } from "./db";
import { graphRequest, sendFromFirstMailbox, senderOrder, type EmailAttachment } from "./shared-mailbox";
import {
  KYC_DOCS, KYC_LOGO_CID, KYC_MAX_FILE_MB, KYC_MAX_FILES_PER_REQUEST, KYC_REF_ALPHABET,
  KYC_OWNERS_QUESTION, KYC_OWNER_LINKS_TITLE, KYC_PEP_QUESTION, TRUST_PERSON_ROLES, clientChecksSwitchOn, defaultKycDocs, isKycDocKey, isKycOwnersAnswer, isKycPepAnswer, kycDocDetail, kycFinishedEmail, kycIdCheckEmail, kycIdStateFor, trustDocsReadyEmail, kycOwnersWords, kycPepWords, kycPersonRoleWords,
  kycRedFlagEmail, kycRefFromSubject, kycReminderEmail, kycReplyAddresses, kycRequestEmail, kycUploadAllowed, kycViaAgentReminderEmail, kycViaAgentRequestEmail, kycWhatsAppHref, kycWhatsAppText,
  type KycAgent, type KycAnswers, type KycDocKey, type KycIdState, type KycOwnersReply, type KycPartyKind, type KycPortalView, type KycProgress, type KycRequestPerson,
} from "@shared/kyc-request";
import { idCheckIsThePerson, personNamesMatch, precheckAsks, verifiedPersonName } from "@shared/kyc-prechecks";
import { personKey, personRequestAsks, type KycPartyPerson, type PartyPeople } from "@shared/kyc-people";
import { CLOSED_STATUSES, statusSpellingsFor } from "@shared/deal-status";
import { dealClientRole, partySubjectKind } from "@shared/deal-parties";
import { clientFileName, clientFileRole, clientSubjectEntity, recordIsOwnSubject } from "@shared/client-kyc";
import { ADDRESS_PROOF_ACCEPT_NOTE_MIN } from "@shared/kyc-address-proof";
import { officerWords } from "@shared/aml-policy";
import type { KycRedFlag } from "@shared/kyc-red-flags";
import { jointAgentAsks, jointAgentFinishedEmail, TRUST_OPTIONAL_DOCS, certifiedWords, kycCopyList, kycChecksRunningWords, KYC_CHECKS_UPDATED_WORDS, listMadeBeforeChecks } from "@shared/kyc-request";
import { agentWords, jointRelianceInput, jointRelianceTerms, type JointAgentRequestDetails } from "@shared/joint-agent-checks";

// AML emails come from BGP's own KYC mailbox (Woody, 2026-11-23: "the email
// should come from KYC@brucegillinghampollard.com"), whatever Railway holds.
export const KYC_MAILBOX = (process.env.KYC_MAILBOX || process.env.BGP_AML_MAILBOX || "kyc@brucegillinghampollard.com").trim();
const LINK_BASE = (process.env.PUBLIC_APP_URL || "https://chatbgp.app").replace(/\/+$/, "");
const STAFF_DOMAIN = "@brucegillinghampollard.com";
const TOKEN_TTL_DAYS = 14;
// A reminder three days after the request and another four days after that.
const REMINDER_DAYS = [3, 7];
// A new identity check is started at most this many times on one request.
const MAX_ID_SESSIONS = 3;
const FILED = "BGP-KYC-Filed", UNMATCHED = "BGP-KYC-Unmatched", OLD_FILED = "BGP-AML-Processed";

// The client checks follow their own switch, not the old in-app AML one
// (Woody, 18 November 2026: "client checks only"): KYC_CLIENT_CHECKS=off
// stops sending, reminders and the reply reader.
export const clientChecksOn = () => clientChecksSwitchOn(process.env.KYC_CLIENT_CHECKS);
const CHECKS_OFF = "The client checks are switched off (KYC_CLIENT_CHECKS on Railway).";
export const kycLinkFor = (token: string) => `${LINK_BASE}/kyc-upload/${token}`;
const dealLinkFor = (dealId: string) => `${LINK_BASE}/deals/${encodeURIComponent(dealId)}`;
// Where the agents open a request: its transaction, or for a client file the
// company's page at its checks.
const linkForRow = (row: Pick<TokenRow, "deal_id" | "company_id" | "is_test">) =>
  row.is_test ? LINK_BASE : row.deal_id ? dealLinkFor(row.deal_id) : row.company_id ? `${LINK_BASE}/companies/${encodeURIComponent(row.company_id)}?section=people` : LINK_BASE;

export interface KycRequestDetails {
  ref: string;
  kind: KycPartyKind;
  role: string | null;
  partyName: string;
  dealName: string;
  needsIdCheck: boolean;
  docs: KycDocKey[];
  note: string | null;
  mobile: string | null;
  agents: KycAgent[];
  cc: string[];
  sentBy: { id: string | null; name: string | null };
  sentFrom: string | null;
  sentAt: string | null;
  sendError: string | null;
  openedAt: string | null;
  veriffSessionIds: string[];
  idCheckNote: string | null;
  // The question about public roles (HMRC, AMLG11650: asking the customer).
  // Requests made before it was added do not ask it.
  askPep?: boolean;
  answers?: KycAnswers | null;
  // The red flags already sent to the agents, so each goes once
  // (server/kyc-red-flags.ts).
  redFlagAlerts?: string[];
  // From BGP's checks before asking (server/kyc-prechecks.ts): the owners on
  // the register for the client to confirm, the owners whose ID is asked
  // for, the client's reply, what was not asked and why, and the run used.
  confirmOwners?: Array<{ name: string; detail: string }> | null;
  ownerNames?: string[];
  // Companies registered abroad that own the party: the structure chart step
  // names them (20 November 2026).
  ownersAbroad?: Array<{ name: string; country: string }> | null;
  ownersAnswer?: KycOwnersReply | null;
  notAsked?: Array<{ key: KycDocKey; reason: string }>;
  precheckId?: number | null;
  // A person's own request (Woody, 19 November 2026: "the owners and the
  // person acting, each with their own Veriff link and a proof-of-address
  // upload"): who it is for. Absent on the request to the person acting.
  person?: KycRequestPerson | null;
  // On the request to the person acting: the owners they are asked to pass
  // a link of their own to (shared/kyc-people.ts keys and names).
  ownLinksFor?: Array<{ key: string; name: string }>;
  // A person's own request emailed from the person acting's page: when, so
  // one page cannot send it more than a few times.
  clientSends?: string[];
  // Who the request is to (22 November 2026): the party's own people (absent,
  // "client"), or the joint agent asked for their checks on the party
  // (server/joint-agent-checks.ts). A joint agent's request is never the
  // party's client checks: the people to check, the sign-off and the AML
  // board read it apart.
  audience?: "client" | "joint_agent";
  jointAgent?: JointAgentRequestDetails;
  // Files the joint agent emailed to someone at BGP, added by BGP: no email
  // went from the app.
  manual?: boolean;
  // A request for a trust's documents (Jack, 23 November 2026: "Request Trust
  // Structure"): no identity check or question, and when the documents are in
  // the agents and the officers hear it is ready for due diligence.
  purpose?: "trust_structure" | null;
  // Sent through the party's own agent to pass on to their client (Woody,
  // 23 November 2026: "with the agent acting for the tenant or against us we
  // need them to pass on the standard KYC requests for their clients to
  // complete"). The request went to the agent (contact_email); the person who
  // completes it is contact_name once named. passedOn: the people at the
  // party the agent sent it to from the page.
  viaAgent?: KycViaAgent | null;
}

export interface KycViaAgent {
  firm: string;
  firmCompanyId: string | null;
  contactId: string | null;
  name: string;
  email: string;
  clientRole: string | null;
  clientName: string | null;
  passedOn?: Array<{ name: string; email: string; at: string }>;
}

/** A request for a trust's documents, not identity checks. */
export const isTrustDocsRequest = (request: Pick<KycRequestDetails, "purpose"> | null | undefined): boolean => request?.purpose === "trust_structure";

/** A joint agent's request (server/joint-agent-checks.ts), not the party's own client checks. */
export const isJointRequest = (request: Pick<KycRequestDetails, "audience"> | null | undefined): boolean => request?.audience === "joint_agent";
/** SQL: a request row that is not a joint agent's (u is the kyc_upload_tokens alias, or none). */
export const NOT_JOINT_SQL = (alias = "") => `COALESCE(${alias ? `${alias}.` : ""}request->>'audience', 'client') <> 'joint_agent'`;

export interface TokenRow {
  token: string;
  // null: a client file, BGP's client checked with no transaction (24 November 2026).
  deal_id: string | null;
  contact_email: string | null;
  contact_name: string | null;
  created_at: Date;
  created_by: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
  use_count: number | null;
  company_id: string | null;
  // The company that signs for the party, when the deal names one (2026-11-18).
  trading_entity_id: string | null;
  contact_id: string | null;
  request: KycRequestDetails | null;
  completed_at: Date | null;
  reminders_sent: number | null;
  last_reminded_at: Date | null;
  is_test: boolean | null;
}

// ── Sending ─────────────────────────────────────────────────────────────────

let logoCache: string | null = null;
// The BGP wordmark (black holder, for a white ground) as base64, sent as an
// inline image so it shows without the reader loading pictures from the web.
export function kycLogoBase64(): string {
  if (logoCache !== null) return logoCache;
  for (const p of [path.join(process.cwd(), "server/assets/BGP_BlackHolder.png"), path.join(process.cwd(), "dist/server/assets/BGP_BlackHolder.png")]) {
    try {
      if (fs.existsSync(p)) { logoCache = fs.readFileSync(p).toString("base64"); return logoCache; }
    } catch {}
  }
  logoCache = "";
  return logoCache;
}

const cleanEmail = (value: unknown): string => String(value || "").trim().toLowerCase();
const isEmail = (value: string) => /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(value);

// Free mail services: two people on one of these are not one firm.
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "live.co.uk", "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "aol.com", "btinternet.com", "protonmail.com", "proton.me", "msn.com", "mail.com", "gmx.com", "gmx.co.uk", "sky.com", "virginmedia.com", "talktalk.net"]);
/** Two addresses at the same firm: the same domain, not a free mail service. */
export function sameFirmDomain(a: string, b: string): boolean {
  const da = cleanEmail(a).split("@")[1] || "", db = cleanEmail(b).split("@")[1] || "";
  return !!da && da === db && !FREE_MAIL.has(da);
}

export interface KycSendResult { ok: boolean; from: string | null; fellBack: boolean; error: string | null; cc?: string[] }

// One door for every client checks email: from the KYC mailbox, else the
// app's address, else the shared mailbox (the footer names whichever sent
// it), with the logo inline.
// Who a client or another agent is told to speak to: the Nominated Officer
// alone, on every AML email and page (Jack, 23 November 2026: "For every deal
// across the whole business I need to be the only person referenced under
// 'Questions?' please as the AML officer"). The transaction's agents are
// still copied on the emails. With no Nominated Officer set, or when they
// cannot be read, the people the request holds are used.
let contactCache: { at: number; agent: KycAgent | null } | null = null;
export async function primeAmlContact(): Promise<void> {
  if (contactCache && Date.now() - contactCache.at < 5 * 60_000) return;
  try {
    const { amlOfficers } = await import("./aml-authority");
    const o = (await amlOfficers()).nominated;
    if (!o) { contactCache = { at: Date.now(), agent: null }; return; }
    const u = (await pool.query(
      `SELECT name, email, phone FROM users WHERE is_active IS NOT FALSE AND (id = $1 OR lower(email) = lower($2)) ORDER BY (id = $1) DESC LIMIT 1`,
      [o.id || "", o.email || ""])).rows[0];
    const name = u?.name || o.name, email = u?.email || o.email;
    contactCache = { at: Date.now(), agent: name && email ? { name, email, phone: u?.phone || null } : null };
  } catch (e: any) {
    console.warn("[kyc] AML contact not read:", e?.message);
    if (!contactCache) contactCache = { at: Date.now() - 4 * 60_000, agent: null };
  }
}
/** The contact as last read: call primeAmlContact first (sendKycEmail does). */
export function amlContact(fallback: KycAgent[] | null | undefined): KycAgent[] {
  return contactCache?.agent ? [contactCache.agent] : (fallback || []);
}
export function resetAmlContactForTests(agent?: KycAgent | null) { contactCache = agent === undefined ? null : { at: Date.now(), agent }; }

export async function sendKycEmail(opts: {
  to: string[];
  cc?: string[];
  build: (sentFrom: string) => { subject: string; html: string };
  // An admin's test, or an email about a test request: the AML officers are
  // not copied on it (every other AML email copies them, kycCopyList).
  test?: boolean;
}): Promise<KycSendResult> {
  await primeAmlContact();
  const to = [...new Set(opts.to.map(cleanEmail).filter(isEmail))];
  if (!to.length) return { ok: false, from: null, fellBack: false, error: "No address to send to" };
  const officers = opts.test ? [] : await import("./aml-authority").then(m => m.amlOfficerEmails()).catch(() => [] as string[]);
  const cc = kycCopyList(to, opts.cc || [], officers);
  const logo = kycLogoBase64();
  const attachments: EmailAttachment[] = logo
    ? [{ name: "bgp-logo.png", contentType: "image/png", contentBytes: logo, isInline: true, contentId: KYC_LOGO_CID }]
    : [];
  try {
    const sent = await sendFromFirstMailbox({ mailboxes: [KYC_MAILBOX], to, cc: cc.length ? cc : undefined, attachments, build: opts.build, appMailbox: false });
    const fellBack = cleanEmail(sent.from) !== cleanEmail(KYC_MAILBOX);
    return { ok: true, from: sent.from, fellBack, error: fellBack ? (sent.refused[0]?.error || `${KYC_MAILBOX} was refused within the hour`) : null, cc };
  } catch (e: any) {
    return { ok: false, from: null, fellBack: false, error: String(e?.message || e).slice(0, 300), cc };
  }
}

// ── Who is on the deal ──────────────────────────────────────────────────────

// The BGP people on a deal, the deal's own agents first, then the agents on
// its fee split (never BGP House). BGP addresses only, so a client is never
// copied by mistake.
export async function dealAgents(dealId: string): Promise<Array<KycAgent & { id: string }>> {
  const { rows } = await pool.query(
    `WITH d AS (SELECT internal_agent_ids, internal_agent FROM crm_deals WHERE id = $1)
     SELECT u.id, u.name, u.email, u.phone,
            (u.id = ANY(COALESCE(d.internal_agent_ids, '{}'::varchar[]))
              OR lower(u.name) = ANY(SELECT lower(x) FROM unnest(COALESCE(d.internal_agent, '{}'::text[])) x)) AS on_deal
       FROM users u, d
      WHERE u.is_active IS NOT FALSE AND COALESCE(u.email, '') <> ''
        AND (u.id = ANY(COALESCE(d.internal_agent_ids, '{}'::varchar[]))
             OR lower(u.name) = ANY(SELECT lower(x) FROM unnest(COALESCE(d.internal_agent, '{}'::text[])) x)
             OR u.id IN (SELECT agent_user_id FROM deal_fee_allocations
                          WHERE deal_id = $1 AND agent_user_id IS NOT NULL AND is_bgp_house IS NOT TRUE))`,
    [dealId],
  );
  return rows
    .filter((r: any) => cleanEmail(r.email).endsWith(STAFF_DOMAIN))
    .sort((a: any, b: any) => Number(b.on_deal) - Number(a.on_deal) || String(a.name).localeCompare(String(b.name)))
    .map((r: any) => ({ id: r.id, name: r.name || r.email, email: r.email, phone: r.phone || null }));
}

// The BGP people on a client file (no transaction): the company's own BGP
// people (crm_companies.bgp_contact_user_ids). BGP addresses only.
export async function clientFileAgents(companyId: string): Promise<Array<KycAgent & { id: string }>> {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone FROM users u
      WHERE u.is_active IS NOT FALSE AND COALESCE(u.email, '') <> ''
        AND u.id = ANY(COALESCE((SELECT bgp_contact_user_ids FROM crm_companies WHERE id = $1), '{}'::varchar[]))`, [companyId]).catch(() => ({ rows: [] as any[] }));
  return rows
    .filter((r: any) => cleanEmail(r.email).endsWith(STAFF_DOMAIN))
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)))
    .map((r: any) => ({ id: r.id, name: r.name || r.email, email: r.email, phone: r.phone || null }));
}

const agentsFor = (dealId: string | null, companyId: string) => (dealId ? dealAgents(dealId) : clientFileAgents(companyId));

async function staffMe(req: Request): Promise<{ id: string; name: string | null; email: string | null; phone: string | null } | null> {
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const id = (req.session as any)?.userId || (req as any).tokenUserId;
  if (!id) return null;
  const r = await pool.query(`SELECT id, name, email, phone FROM users WHERE id = $1`, [id]);
  return r.rows[0] ? { id: r.rows[0].id, name: r.rows[0].name || null, email: r.rows[0].email || null, phone: r.rows[0].phone || null } : null;
}

const STAFF_ONLY = "Only BGP staff, signed in as themselves, send client checks.";

// ── Tokens ──────────────────────────────────────────────────────────────────

export async function newRef(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = crypto.randomBytes(6);
    const ref = Array.from(bytes, b => KYC_REF_ALPHABET[b % KYC_REF_ALPHABET.length]).join("");
    const taken = await pool.query(`SELECT 1 FROM kyc_upload_tokens WHERE request->>'ref' = $1 LIMIT 1`, [ref]);
    if (!taken.rowCount) return ref;
  }
  throw new Error("Could not make a reference for the request");
}

export async function tokenRow(token: string): Promise<TokenRow | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const r = await pool.query(`SELECT * FROM kyc_upload_tokens WHERE token = $1`, [token]);
  return (r.rows[0] as TokenRow) || null;
}

export async function saveRequest(token: string, request: KycRequestDetails): Promise<void> {
  await pool.query(`UPDATE kyc_upload_tokens SET request = $2 WHERE token = $1`, [token, JSON.stringify(request)]);
}

// Why a link no longer opens, in the words the client page shows.
export function closedReason(row: TokenRow | null): string | null {
  if (!row || !row.request) return "This link is not recognised. Please check you have the whole address, or ask your contact at Bruce Gillingham Pollard for a new one.";
  if (row.revoked_at) return "This link has been cancelled. If you still need to send something, please contact Bruce Gillingham Pollard.";
  if (new Date(row.expires_at) < new Date()) return "This link has expired. Please ask your contact at Bruce Gillingham Pollard for a new one.";
  return null;
}

// ── The identity check ──────────────────────────────────────────────────────

function veriffConfigured(): boolean {
  const key = process.env.VERIFF_API_KEY || process.env.VERIFF_PUBLIC_KEY || process.env.VERIFF_KEY || process.env.VERIFF_INTEGRATION_ID;
  const secret = process.env.VERIFF_SECRET || process.env.VERIFF_PRIVATE_KEY || process.env.VERIFF_SHARED_SECRET;
  return !!(key && secret);
}

async function latestSession(request: KycRequestDetails): Promise<{ session_id: string; status: string | null; verification_url: string | null; verdict_person: unknown } | null> {
  const id = request.veriffSessionIds[request.veriffSessionIds.length - 1];
  if (!id) return null;
  const r = await pool.query(`SELECT session_id, status, verification_url, verdict_person FROM veriff_sessions WHERE session_id = $1`, [id]);
  return r.rows[0] || null;
}

// Who Veriff checked, set against the person the request was for (Woody,
// 19 November 2026: "its actually after woody bruce did the check so its got
// confused jack hasnt done his yet"). The agents are copied on the request,
// so a copy of the client's link can be opened by someone else; a check
// passed by another person is never reported as the client's.
export interface KycIdPerson { verifiedName: string | null; isThePerson: boolean | null }
function idPersonOf(row: TokenRow, session: { verdict_person: unknown } | null): KycIdPerson {
  const verifiedName = verifiedPersonName(session?.verdict_person);
  return { verifiedName, isThePerson: idCheckIsThePerson(row.contact_name, verifiedName) };
}

async function startIdSession(row: TokenRow, request: KycRequestDetails): Promise<{ sessionId: string; url: string }> {
  const { createVeriffSession } = await import("./veriff");
  const parts = String(row.contact_name || "").trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "Client";
  const lastName = parts.slice(1).join(" ") || firstName;
  const session = await createVeriffSession({
    firstName, lastName,
    email: row.contact_email || undefined,
    companyId: row.company_id || undefined,
    contactId: row.contact_id || undefined,
    dealId: row.deal_id || undefined,
    userId: row.created_by || undefined,
    callbackUrl: kycLinkFor(row.token),
  });
  await pool.query(
    `INSERT INTO veriff_sessions (session_id, company_id, contact_id, deal_id, first_name, last_name, email, status, verification_url, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (session_id) DO NOTHING`,
    [session.sessionId, row.company_id, row.contact_id, row.deal_id, firstName, lastName, row.contact_email, session.status, session.verificationUrl, row.created_by],
  );
  request.veriffSessionIds = [...request.veriffSessionIds, session.sessionId];
  await saveRequest(row.token, request);
  return { sessionId: session.sessionId, url: session.verificationUrl };
}

// ── What the client has done ────────────────────────────────────────────────

interface UploadedFile { name: string; docKey: KycDocKey | null; uploadedAt: string; url: string | null; documentId: string | null }

async function uploadedFiles(token: string): Promise<UploadedFile[]> {
  const r = await pool.query(
    `SELECT f.original_filename, f.doc_type, f.uploaded_at, d.file_url, f.kyc_document_id
       FROM kyc_upload_files f LEFT JOIN kyc_documents d ON d.id::text = f.kyc_document_id
      WHERE f.token = $1 ORDER BY f.uploaded_at`,
    [token],
  );
  return r.rows.map((f: any) => ({
    name: f.original_filename,
    docKey: isKycDocKey(f.doc_type) ? f.doc_type : null,
    uploadedAt: new Date(f.uploaded_at).toISOString(),
    url: f.file_url || null,
    documentId: f.kyc_document_id ? String(f.kyc_document_id) : null,
  }));
}

// The people on the deal's party who have a link of their own (a person's
// own request, not cancelled), by their key in shared/kyc-people.ts.
async function linkedPeople(row: TokenRow): Promise<Set<string>> {
  // A client file's people are its own sub company's (no transaction to tie them).
  const r = await pool.query(
    `SELECT request->'person'->>'key' AS key FROM kyc_upload_tokens
      WHERE deal_id IS NOT DISTINCT FROM $1::varchar AND company_id IS NOT DISTINCT FROM $2 AND jsonb_typeof(request->'person') = 'object'
        AND ($1::varchar IS NOT NULL OR trading_entity_id IS NOT DISTINCT FROM $3::varchar)
        AND revoked_at IS NULL AND is_test IS NOT TRUE`, [row.deal_id, row.company_id, row.trading_entity_id || null]);
  return new Set(r.rows.map((x: any) => x.key).filter(Boolean));
}

// The people to check for the request's party (a company's request only).
async function partyPeopleForRow(row: TokenRow): Promise<PartyPeople | null> {
  // The request to the party itself (a company's person acting, or a private
  // individual), never a person's own request or the joint agent's.
  if (!row.company_id || row.is_test || !row.request || row.request.person || isJointRequest(row.request)) return null;
  const { dealPeopleRequests, partyPeopleFor } = await import("./kyc-people");
  return partyPeopleFor({ companyId: row.company_id, entityId: row.trading_entity_id, kind: row.request.kind === "company" ? "company" : "individual", dealId: row.deal_id },
    await dealPeopleRequests(row.deal_id, pool, row.deal_id ? undefined : { companyId: row.company_id, entityId: row.trading_entity_id || null }));
}

async function progressOf(row: TokenRow, files?: UploadedFile[]): Promise<KycProgress & { idState: KycIdState | null; idPerson: KycIdPerson | null; files: UploadedFile[] }> {
  const request = row.request!;
  const list = files || await uploadedFiles(row.token);
  const session = request.needsIdCheck ? await latestSession(request) : null;
  const idState = request.needsIdCheck ? kycIdStateFor(session?.status) : null;
  const idPerson = request.needsIdCheck && session ? idPersonOf(row, session) : null;
  const docsDone = request.docs.filter(key => list.some(f => f.docKey === key));
  const pepAnswered = !request.askPep || !!request.answers?.pep;
  const ownersAnswered = !request.confirmOwners?.length || !!request.ownersAnswer;
  // Someone else's identity check is not the client's.
  // An officer accepted their certified documents (or verified them from
  // public sources): nothing more is owed on the identity check or address.
  const accepted = !!row.company_id && !!row.contact_name && !isTrustDocsRequest(request) && !isJointRequest(request)
    && await import("./kyc-people").then(async m => (await m.publicFiguresFor(row.company_id!, row.trading_entity_id || null)).some(f => personNamesMatch(f.name, row.contact_name!))).catch(() => false);
  if (accepted) for (const k of ["photo_id", "proof_of_address"] as KycDocKey[]) if (request.docs.includes(k) && !docsDone.includes(k)) docsDone.push(k);
  const idDone = accepted || ((idState === "approved" || idState === "submitted") && idPerson?.isThePerson !== false);
  const ownersLinked = !request.ownLinksFor?.length
    || await linkedPeople(row).then(keys => request.ownLinksFor!.every(o => keys.has(o.key))).catch(() => false);
  return { idDone, docsDone, pepAnswered, ownersAnswered, ownersLinked, idState, idPerson, files: list };
}

export async function portalView(row: TokenRow): Promise<KycPortalView> {
  await primeAmlContact();
  const request = row.request!;
  const progress = await progressOf(row);
  // The joint agent's page (22 November 2026): what to send, and on a
  // letting the reliance terms to agree.
  if (isJointRequest(request)) {
    const joint = request.jointAgent;
    const letting = joint?.rule === "letting" || joint?.rule === "other";
    // What their files do not cover yet, in their words (22 November 2026).
    const needs = await import("./joint-agent-checks").then(m => m.pageNeedsForToken(row.token)).catch(() => ({ missing: [] as string[], reading: 0 }));
    return {
      test: !!row.is_test, ref: request.ref, recipientName: row.contact_name, partyName: request.partyName, kind: request.kind,
      dealName: request.dealName, expiresAt: new Date(row.expires_at).toISOString(),
      idCheck: null, question: null, owners: null, docs: [],
      otherFiles: progress.files.map(f => ({ name: f.name, uploadedAt: f.uploadedAt })),
      person: null, people: null, note: request.note, noteFrom: request.sentBy?.name || null, agents: amlContact(request.agents),
      finishedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null, maxFileMb: KYC_MAX_FILE_MB,
      joint: {
        firm: joint?.firm || "your firm", partyRole: request.role, letting,
        relation: joint?.relation === "own" ? "own" : "joint", clientRole: joint?.clientRole || null, clientName: joint?.clientName || null,
        asks: jointAgentAsks({ kind: request.kind, letting }),
        // No reliance terms are asked for (Woody, 23 November 2026); one agreed before still shows.
        terms: letting && joint?.reliance ? jointRelianceTerms(request.partyName) : null,
        reliance: joint?.reliance ? { name: joint.reliance.name, position: joint.reliance.position, supervisor: joint.reliance.supervisor, registration: joint.reliance.registration, agreedAt: joint.reliance.agreedAt } : null,
        missing: needs.missing, reading: needs.reading,
      },
    };
  }
  let idCheck: KycPortalView["idCheck"] = null;
  if (request.needsIdCheck) {
    const state = progress.idState || "not_started";
    // A test page runs a real Veriff check when Veriff is set up (Woody,
    // 2026-11-17: "can you do the test page a real identity check with
    // veriff"), under the same three-session cap as a client's.
    const real = !row.is_test || veriffConfigured();
    const otherPerson = progress.idPerson?.isThePerson === false;
    const canStart = !real ? true
      : state === "restart" || otherPerson ? request.veriffSessionIds.length < MAX_ID_SESSIONS
      : state !== "approved" && state !== "submitted";
    idCheck = { state, canStart, real, ...(otherPerson ? { verifiedName: progress.idPerson!.verifiedName, otherPerson: true } : {}) };
  }
  const requested = new Set(request.docs);
  // The owners other than the person acting, each with a link of their own
  // (Woody, 19 November 2026). Read live, so an owner the register gains
  // later is listed too.
  let people: KycPortalView["people"] = null;
  if (!request.person) {
    const found = await partyPeopleForRow(row).catch(() => null);
    // A guarantor, and the owners of a company that guarantees, are passed on the same way (23 November 2026).
    const owners = (found?.people || []).filter(p => (p.roles.includes("owner") || p.roles.includes("guarantor") || p.roles.includes("guarantor_owner")) && !personNamesMatch(p.name, row.contact_name || ""));
    if (owners.length) {
      people = owners.map(p => {
        const ownLink = !!p.own && !p.own.isMain;
        return { key: p.key, name: p.name, detail: p.ownerDetail, done: !p.outstanding.length, linked: ownLink || !p.outstanding.length, emailedAt: ownLink ? p.own!.sentAt : null };
      });
    }
  }
  return {
    test: !!row.is_test,
    ref: request.ref,
    recipientName: row.contact_name,
    partyName: request.partyName,
    kind: request.kind,
    dealName: request.dealName,
    expiresAt: new Date(row.expires_at).toISOString(),
    idCheck,
    question: request.askPep ? { pep: request.answers?.pep ?? null, pepDetail: request.answers?.pepDetail ?? null } : null,
    owners: request.confirmOwners?.length ? { list: request.confirmOwners, answer: request.ownersAnswer?.answer ?? null, detail: request.ownersAnswer?.detail ?? null } : null,
    docs: request.docs.map(key => ({
      key, title: KYC_DOCS[key].title, detail: kycDocDetail(key, request.ownerNames, request.ownersAbroad),
      files: progress.files.filter(f => f.docKey === key).map(f => ({ name: f.name, uploadedAt: f.uploadedAt })),
    })),
    otherFiles: progress.files.filter(f => !f.docKey || !(requested.has(f.docKey) || (!isJointRequest(request) && TRUST_OPTIONAL_DOCS.includes(f.docKey)))).map(f => ({ name: f.name, uploadedAt: f.uploadedAt })),
    person: request.person ? { roles: request.person.roles, words: kycPersonRoleWords(request.person.roles, request.partyName) } : null,
    people,
    note: request.note,
    noteFrom: request.sentBy?.name || null,
    agents: amlContact(request.agents),
    finishedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    maxFileMb: KYC_MAX_FILE_MB,
    viaAgent: request.viaAgent ? {
      firm: request.viaAgent.firm, agentName: request.viaAgent.name,
      passedOn: (request.viaAgent.passedOn || []).map(x => ({ name: x.name, at: x.at })),
      personNamed: !!String(row.contact_name || "").trim(),
    } : null,
    ...(isTrustDocsRequest(request) ? { trustDocs: true } : {}),
    // Certified copies in place of the online check, on every request but the joint agent's (23 November 2026).
    ...(isJointRequest(request) ? {} : {
      certifiedWords: certifiedWords({ kind: request.kind, person: request.person, purpose: request.purpose }),
      optionalDocs: TRUST_OPTIONAL_DOCS.filter(k => !request.docs.includes(k)).map(key => ({
        key, title: KYC_DOCS[key].title, detail: KYC_DOCS[key].detail,
        files: progress.files.filter(f => f.docKey === key).map(f => ({ name: f.name, uploadedAt: f.uploadedAt })),
      })),
    }),
  };
}

// ── Creating a request ──────────────────────────────────────────────────────

export const clientCheckBody = z.object({
  companyId: z.string().min(1).max(200),
  contactId: z.string().min(1).max(200).nullish(),
  // The person to ask; through an agent, who at the party will complete it
  // when known (blank otherwise), and the email is the agent's.
  name: z.string().trim().max(120),
  email: z.string().trim().max(200),
  mobile: z.string().trim().max(40).nullish(),
  kind: z.enum(["individual", "company"]),
  needsIdCheck: z.boolean(),
  docs: z.array(z.string()).max(10),
  note: z.string().max(2000).nullish(),
  // Through the party's own agent, to pass on (23 November 2026).
  viaAgent: z.object({
    firm: z.string().trim().min(2).max(160),
    firmCompanyId: z.string().min(1).max(200).nullish(),
    contactId: z.string().min(1).max(200).nullish(),
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().max(200),
  }).strict().nullish(),
  // When BGP's checks before asking last finished, as the send window saw it
  // (null: none had). A list made before a newer read of the register is
  // refused (24 November 2026). Absent from a window loaded before then.
  basedOn: z.string().max(40).nullable().optional(),
}).strict();

// Each party: its brand, the company that signs for it when the deal names
// one (server/deal-parties.ts: the request is then about that company), and
// the person to ask (set for the party, else the deal's client contact when
// filed under the brand).
const PARTY_COLUMNS: Array<{ role: string; company: string; contact: string; entity: string }> = [
  { role: "landlord", company: "landlord_id", contact: "landlord_contact_id", entity: "landlord_trading_entity_id" },
  { role: "tenant", company: "tenant_id", contact: "tenant_contact_id", entity: "tenant_trading_entity_id" },
  { role: "vendor", company: "vendor_id", contact: "vendor_contact_id", entity: "vendor_trading_entity_id" },
  { role: "purchaser", company: "purchaser_id", contact: "purchaser_contact_id", entity: "purchaser_trading_entity_id" },
];

async function dealParties(dealId: string) {
  const d = (await pool.query(
    `SELECT id, name, client_contact_id, landlord_id, landlord_contact_id, tenant_id, tenant_contact_id, vendor_id, vendor_contact_id, purchaser_id, purchaser_contact_id,
            landlord_trading_entity_id, tenant_trading_entity_id, vendor_trading_entity_id, purchaser_trading_entity_id, deal_type, bgp_acting_for, team
       FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
  if (!d) return null;
  const parties: Array<{ companyId: string; name: string; brandName: string; role: string; kind: KycPartyKind; contactId: string | null;
    entityId: string | null; entityNumber: string | null; personField: string;
    // Recorded as a trust or foundation: checked on its own record, so no company that signs is needed (21 November 2026).
    trust: boolean;
    publicBody?: boolean;
    contacts: Array<{ id: string; name: string; email: string | null; mobile: string | null }> }> = [];
  for (const col of PARTY_COLUMNS) {
    const companyId = d[col.company];
    if (!companyId || parties.some(p => p.companyId === companyId)) continue;
    const c = (await pool.query(`SELECT id, name, aml_subject_type FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
    if (!c) continue;
    const entity = d[col.entity] ? (await pool.query(
      `SELECT id, name, companies_house_number, entity_kind, contact_id FROM crm_trading_entities WHERE id = $1 AND parent_company_id = $2`, [d[col.entity], companyId])).rows[0] || null : null;
    const client = d.client_contact_id ? (await pool.query(`SELECT company_id FROM crm_contacts WHERE id = $1`, [d.client_contact_id])).rows[0] : null;
    // A person who signs is asked themselves when nobody else is named.
    const person = d[col.contact] || (client?.company_id === companyId ? d.client_contact_id : null)
      || (String(entity?.entity_kind || "").toLowerCase() === "individual" ? entity?.contact_id || null : null);
    const contacts = (await pool.query(
      `SELECT id, name, email, COALESCE(NULLIF(phone_mobile, ''), NULLIF(phone, '')) AS mobile
         FROM crm_contacts WHERE company_id = $1 AND COALESCE(email, '') <> ''
        ORDER BY (id = $2) DESC, name LIMIT 60`, [companyId, person || ""])).rows;
    parties.push({
      companyId, name: entity?.name || c.name, brandName: c.name, role: col.role,
      kind: partySubjectKind(c.aml_subject_type, entity ? { kind: entity.entity_kind } : null),
      contactId: person && contacts.some((x: any) => x.id === person) ? person : null,
      entityId: entity ? String(entity.id) : null, entityNumber: entity?.companies_house_number || null, personField: col.contact,
      trust: String(c.aml_subject_type || "").trim().toLowerCase() === "trust",
      publicBody: !entity && String(c.aml_subject_type || "").trim().toLowerCase() === "public_body",
      contacts: contacts.map((x: any) => ({ id: x.id, name: x.name, email: x.email, mobile: x.mobile || null })),
    });
  }
  const clientRole = dealClientRole({ dealType: d.deal_type, bgpActingFor: d.bgp_acting_for, team: d.team });
  return { deal: { id: d.id as string, name: d.name as string, clientRole, clientName: parties.find(x => x.role === clientRole)?.name || null }, parties };
}

// dealId null: a client file, BGP's client checked with no transaction (Woody,
// 24 November 2026: "build it within companies"); opts.entityId is the sub
// company checked (null: the record itself, a person, trust or public body).
// A client file (Woody, 24 November 2026: BGP's client checked with no
// transaction): one party, BGP's client, the sub company checked (entityId),
// or the account's own record when it is a person, trust or public body. In
// the emails and the client's page its "transaction" is "our instruction from
// <account>".
export async function clientFileParties(companyId: string, entityId: string | null) {
  const c = (await pool.query(`SELECT id, name, aml_subject_type, merged_into_id FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
  if (!c || c.merged_into_id) return null;
  const entity = entityId ? (await pool.query(
    `SELECT id, name, companies_house_number, entity_kind, contact_id FROM crm_trading_entities WHERE id = $1 AND parent_company_id = $2`, [entityId, companyId])).rows[0] || null : null;
  if (entityId && !entity) return null;
  if (!entity && !recordIsOwnSubject(c.aml_subject_type)) return null;
  const subject = String(c.aml_subject_type || "").trim().toLowerCase();
  const file = (await pool.query(
    `SELECT contact_id, instruction FROM kyc_client_files WHERE company_id = $1 AND trading_entity_id IS NOT DISTINCT FROM $2::varchar AND closed_at IS NULL
      ORDER BY opened_at DESC LIMIT 1`, [companyId, entityId]).catch(() => ({ rows: [] as any[] }))).rows[0];
  // The side BGP's client is on, from what BGP is instructed on: a buyer or a
  // tenant BGP acts for is asked where the money comes from, as on a transaction.
  const role = clientFileRole(file?.instruction);
  const person = file?.contact_id || (String(entity?.entity_kind || "").toLowerCase() === "individual" ? entity?.contact_id || null : null);
  const contacts = (await pool.query(
    `SELECT id, name, email, COALESCE(NULLIF(phone_mobile, ''), NULLIF(phone, '')) AS mobile
       FROM crm_contacts WHERE company_id = $1 AND COALESCE(email, '') <> ''
      ORDER BY (id = $2) DESC, name LIMIT 60`, [companyId, person || ""])).rows;
  const name = String(entity?.name || c.name);
  return {
    deal: { id: null as string | null, name: clientFileName(c.name), clientRole: role, clientName: name },
    parties: [{
      companyId, name, brandName: String(c.name), role,
      kind: partySubjectKind(c.aml_subject_type, entity ? { kind: entity.entity_kind } : null),
      contactId: person && contacts.some((x: any) => x.id === person) ? String(person) : null,
      entityId: entity ? String(entity.id) : null, entityNumber: entity?.companies_house_number || null, personField: "",
      trust: !entity && subject === "trust",
      publicBody: !entity && subject === "public_body",
      contacts: contacts.map((x: any) => ({ id: x.id, name: x.name, email: x.email, mobile: x.mobile || null })),
    }],
  };
}

// A route's scope: a transaction (:id), or a client file (:companyId, :entity).
type CheckScope = { dealId: string; client: null } | { dealId: null; client: { companyId: string; entityId: string | null } };
const scopeOf = (req: Request): CheckScope => req.params.companyId
  ? { dealId: null, client: { companyId: String(req.params.companyId), entityId: clientSubjectEntity(String(req.params.entity || "")) } }
  : { dealId: String(req.params.id), client: null };
const partiesFor = (scope: CheckScope) => (scope.dealId ? dealParties(scope.dealId) : clientFileParties(scope.client!.companyId, scope.client!.entityId));

export async function createClientCheck(dealId: string | null, input: z.infer<typeof clientCheckBody>, me: { id: string; name: string | null; email: string | null }, opts: { purpose?: "trust_structure"; entityId?: string | null } = {}): Promise<{
  token: string; ref: string; link: string; sent: KycSendResult; idCheck: boolean; idCheckNote: string | null; cc: string[];
}> {
  const found = dealId ? await dealParties(dealId) : await clientFileParties(input.companyId, opts.entityId ?? null);
  if (!found) throw Object.assign(new Error(dealId ? "Transaction not found" : "Company not found"), { status: 404 });
  const party = found.parties.find(p => p.companyId === input.companyId);
  if (!party) throw Object.assign(new Error("That company is not a party to this transaction. Set it on the transaction first."), { status: 400 });
  // The checks are about the company that signs, not the brand (Woody,
  // 19 November 2026: "We must have the company taking the lease or who owns
  // the property to be able to do a check").
  if (input.kind === "company" && !party.entityId && !party.trust) {
    const what = party.role === "tenant" ? "the company taking the lease" : party.role === "landlord" ? "the company that owns the property" : party.role === "vendor" ? "the company selling" : "the company buying";
    throw Object.assign(new Error(`Set ${what} on the transaction first: the client checks are about that company, not ${party.name}.`), { status: 409 });
  }
  // Through the party's own agent (23 November 2026): the email is the
  // agent's, and the person is who at the party will complete it, when known.
  const via = input.viaAgent || null;
  const email = cleanEmail(via ? via.email : input.email);
  if (!isEmail(email)) throw Object.assign(new Error(via ? "Enter a valid email address for the agent." : "Enter a valid email address for the person to ask."), { status: 400 });
  const personName = input.name.replace(/\s+/g, " ").trim();
  if (!via && !personName) throw Object.assign(new Error("Enter the name of the person to ask."), { status: 400 });
  if (input.contactId && !party.contacts.some(c => c.id === input.contactId)) throw Object.assign(new Error("That contact is not at this company."), { status: 400 });
  const trustDocs = opts.purpose === "trust_structure";
  if (trustDocs && !party.trust) throw Object.assign(new Error("Record it as a trust first."), { status: 409 });
  let viaAgent: KycViaAgent | null = null;
  if (via) {
    if (email.endsWith(STAFF_DOMAIN)) throw Object.assign(new Error("That is a BGP address: enter the agent's contact."), { status: 400 });
    if (party.role === found.deal.clientRole) throw Object.assign(new Error(`BGP acts for ${party.name}: send the checks to them, not through an agent.`), { status: 400 });
    const firmRow = via.firmCompanyId ? (await pool.query(`SELECT id, name FROM crm_companies WHERE id = $1`, [via.firmCompanyId])).rows[0] : null;
    if (via.firmCompanyId && !firmRow) throw Object.assign(new Error("That firm is not in the CRM."), { status: 400 });
    if (via.contactId) {
      const at = (await pool.query(`SELECT company_id FROM crm_contacts WHERE id = $1`, [via.contactId])).rows[0];
      if (!at || (firmRow && String(at.company_id) !== String(firmRow.id))) throw Object.assign(new Error("That contact is not at the agent's firm."), { status: 400 });
    }
    viaAgent = {
      firm: via.firm.trim(), firmCompanyId: firmRow ? String(firmRow.id) : null, contactId: via.contactId || null,
      name: via.name.trim(), email, clientRole: found.deal.clientRole, clientName: found.deal.clientName, passedOn: [],
    };
  }
  const contactName = personName || (via && input.contactId ? party.contacts.find(c => c.id === input.contactId)?.name || "" : "") || null;
  let docs = [...new Set(input.docs.filter(isKycDocKey))];
  let needsIdCheck = input.needsIdCheck;
  let idCheckNote: string | null = null;
  if (needsIdCheck && !veriffConfigured()) {
    needsIdCheck = false;
    idCheckNote = "The online identity check is not set up, so photo ID is asked for as a document instead.";
  }
  if (!needsIdCheck && !docs.includes("photo_id") && input.needsIdCheck) docs = ["photo_id", ...docs];
  if (!needsIdCheck && !docs.length) throw Object.assign(new Error("Ask for at least one thing: the identity check or a document."), { status: 400 });

  // What to ask follows from what BGP's checks read on the register, so a
  // list is never sent while they are still reading it, nor one made before
  // their latest read (#4664, 24 November 2026: sent while the landlord's
  // register was being read, the request asked the person acting for each
  // owner's ID as documents and gave the owner no identity check of their own).
  const prechecks = await import("./kyc-prechecks");
  if (!trustDocs && prechecks.precheckRunning(party.companyId, party.entityId)) {
    await prechecks.awaitPrecheck(party.companyId, 20_000, party.entityId).catch(() => null);
    if (prechecks.precheckRunning(party.companyId, party.entityId)) {
      throw Object.assign(new Error(kycChecksRunningWords(party.name)), { status: 409, code: "CHECKS_RUNNING" });
    }
  }
  // What BGP's checks before asking found (the agent's ticks decide what is
  // asked; this records why the rest was not, and the owners to confirm).
  const pre = await prechecks.partyAskInput(party.companyId, party.entityId).catch(() => null);
  if (!trustDocs && input.basedOn !== undefined && listMadeBeforeChecks(input.basedOn, pre?.ranAt || null)) {
    throw Object.assign(new Error(KYC_CHECKS_UPDATED_WORDS), { status: 409, code: "CHECKS_UPDATED" });
  }
  const trustAsk = party.trust && input.kind === "company" ? await import("./trust-structure").then(m => m.trustAskFor(party.companyId)).catch(() => null) : null;
  const asks = precheckAsks(pre?.input || null, { kind: input.kind, role: party.role, idCheck: needsIdCheck, contactName, trust: trustAsk, publicBody: !!party.publicBody && input.kind === "company" });
  const confirmOwners = !trustDocs && input.kind === "company" && !docs.includes("ownership") && asks.confirmOwners?.length ? asks.confirmOwners : null;
  // The owners other than the person asked, who each get a link of their own
  // (19 November 2026): the person asked can pass them on from their page.
  let ownLinksFor: Array<{ key: string; name: string }> = [];
  if (!trustDocs && input.kind === "company" && !docs.includes("owner_ids")) {
    const { dealPeopleRequests, partyPeopleFor } = await import("./kyc-people");
    const people = await partyPeopleFor({ companyId: party.companyId, entityId: party.entityId, kind: "company", dealId },
      await dealPeopleRequests(dealId, pool, dealId ? undefined : { companyId: party.companyId, entityId: party.entityId })).catch(() => null);
    ownLinksFor = (people?.people || [])
      .filter(p => (p.roles.includes("owner") || p.roles.includes("guarantor") || p.roles.includes("guarantor_owner")) && p.outstanding.length && !(p.own && !p.own.isMain) && !personNamesMatch(p.name, contactName || ""))
      .map(p => ({ key: p.key, name: p.name }));
  }

  const agents = await agentsFor(dealId, party.companyId);
  const agentList: KycAgent[] = agents.map(a => ({ name: a.name, email: a.email, phone: a.phone }));
  const meEmail = cleanEmail(me.email);
  const cc = [...new Set([...agents.map(a => cleanEmail(a.email)), meEmail].filter(e => e.endsWith(STAFF_DOMAIN)))];
  // The sender is the client's contact too when the deal names no agent.
  if (!agentList.length && me.name) {
    const meRow = (await pool.query(`SELECT phone FROM users WHERE id = $1`, [me.id])).rows[0];
    agentList.push({ name: me.name, email: me.email, phone: meRow?.phone || null });
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const ref = await newRef();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400000);
  const request: KycRequestDetails = {
    ref, kind: input.kind, role: party.role, partyName: party.name, dealName: found.deal.name,
    needsIdCheck, docs, note: input.note?.trim() || null, mobile: via ? null : input.mobile?.trim() || null,
    agents: agentList, cc, sentBy: { id: me.id, name: me.name }, sentFrom: null, sentAt: null, sendError: null,
    openedAt: null, veriffSessionIds: [], idCheckNote, askPep: !trustDocs, answers: null,
    confirmOwners, ownerNames: docs.includes("owner_ids") ? asks.ownerNames : [], ownersAnswer: null,
    ownersAbroad: input.kind === "company" && docs.includes("ownership") && asks.ownersAbroad?.length ? asks.ownersAbroad : null,
    notAsked: trustDocs ? [] : asks.notAsked.filter(n => !docs.includes(n.key)), precheckId: pre?.precheckId ?? null,
    ownLinksFor, ...(trustDocs ? { purpose: "trust_structure" as const } : {}),
    ...(viaAgent ? { viaAgent } : {}),
  };
  // Someone typed rather than picked is saved to the CRM under the brand
  // (Woody, 2026-11-18: "need the ability to add in all the info"), and
  // becomes the party's person to ask when the deal names nobody.
  let contactId = input.contactId || null;
  // Nothing typed for the agent's route goes into the party's CRM record.
  if (!contactId && !via) {
    try {
      const { findOrAddPartyPerson } = await import("./deal-parties");
      const added = await findOrAddPartyPerson(pool, party.companyId, { name: input.name.trim(), email, mobile: input.mobile?.trim() || null, jobTitle: null },
        `Added by ${me.name || "BGP"} when ${trustDocs ? "asking for the trust's documents" : "sending the client checks"} for ${found.deal.name}.`);
      contactId = added.id;
      // A client file keeps who to ask on the file (no transaction to hold it).
      if (!dealId) {
        await pool.query(`UPDATE kyc_client_files SET contact_id = $3 WHERE company_id = $1 AND trading_entity_id IS NOT DISTINCT FROM $2::varchar AND closed_at IS NULL AND contact_id IS NULL`,
          [party.companyId, party.entityId, contactId]).catch(() => {});
      }
      const set = dealId ? await pool.query(`UPDATE crm_deals SET ${party.personField} = $2 WHERE id = $1 AND ${party.personField} IS NULL RETURNING id`, [dealId, contactId]) : { rows: [] as any[] };
      if (set.rows.length) {
        await pool.query(`INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by, changed_by_name) VALUES ($1, $2, NULL, $3, $4, $5, $6)`,
          [dealId, party.personField, contactId, `Ask ${input.name.trim()} for the ${party.role}'s checks${added.created ? " (added to the CRM)" : ""}`, me.id, me.name]).catch(() => {});
      }
    } catch (e: any) {
      console.warn(`[kyc-request] the person typed for ${party.companyId} was not saved to the CRM: ${e?.message}`);
    }
  }
  await pool.query(
    `INSERT INTO kyc_upload_tokens (token, deal_id, contact_email, contact_name, created_by, expires_at, company_id, contact_id, request, is_test, trading_entity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10)`,
    [token, dealId, email, contactName, me.id, expiresAt, party.companyId, contactId, JSON.stringify(request), party.entityId],
  );
  const row = (await tokenRow(token))!;

  // Through the agent, the identity check starts on the page, once the person doing it is named.
  if (needsIdCheck && !viaAgent) {
    try {
      await startIdSession(row, request);
    } catch (e: any) {
      // The request still goes: the client uploads photo ID instead.
      request.needsIdCheck = false;
      if (!request.docs.includes("photo_id")) request.docs = ["photo_id", ...request.docs];
      request.idCheckNote = `The identity check could not be started (${String(e?.message || e).slice(0, 160)}), so photo ID is asked for as a document instead.`;
      await saveRequest(token, request);
    }
  }

  const link = kycLinkFor(token);
  await primeAmlContact();
  const common = {
    partyName: party.name, kind: input.kind, dealName: found.deal.name, ref, link, expiresAt,
    needsIdCheck: request.needsIdCheck, docs: request.docs, note: request.note, noteFrom: request.sentBy?.name || null, agents: amlContact(agentList), askPep: !!request.askPep,
    confirmOwners: request.confirmOwners, ownerNames: request.ownerNames, ownersAbroad: request.ownersAbroad, ownLinksFor: ownLinksFor.map(o => o.name),
    purpose: request.purpose || null,
  };
  const sent = await sendKycEmail({
    to: [email], cc,
    build: sentFrom => viaAgent
      ? kycViaAgentRequestEmail({
        ...common, sentFrom, recipientName: viaAgent.name, agentFirm: viaAgent.firm, partyRole: party.role,
        clientRole: viaAgent.clientRole, clientName: viaAgent.clientName, personName: contactName,
      })
      : kycRequestEmail({ ...common, sentFrom, recipientName: input.name }),
  });
  request.sentFrom = sent.from;
  request.sentAt = sent.ok ? new Date().toISOString() : null;
  request.sendError = sent.ok ? (sent.fellBack ? `Sent from ${sent.from}: Microsoft would not send as ${KYC_MAILBOX}` : null) : sent.error;
  await saveRequest(token, request);
  await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, $2, $3, $4)`,
    [party.companyId, trustDocs ? "trust_documents_requested" : "client_checks_sent", me.name || me.id, `${trustDocs ? "Trust documents asked for: " : ""}${sent.ok ? "Sent" : "Not sent"} ${viaAgent ? `through ${viaAgent.name} of ${viaAgent.firm} <${email}>, to pass on to ${contactName || party.name},` : `to ${input.name} <${email}>`} for ${found.deal.name} (ref ${ref})${sent.ok ? `, from ${sent.from}, copied to ${(sent.cc || cc).join(", ") || "nobody"}` : `: ${sent.error}`}`]).catch(() => {});
  return { token, ref, link, sent, idCheck: request.needsIdCheck, idCheckNote: request.idCheckNote, cc: sent.cc || cc };
}

// ── A person's own request ──────────────────────────────────────────────────
//
// Woody, 19 November 2026, agreeing "a list of people to check for each
// party: the owners and the person acting, each with their own Veriff link
// and a proof-of-address upload". Each person on the party's list
// (shared/kyc-people.ts) can be given a link of their own: by BGP staff from
// the deal's AML card, or by the person acting from their own page (owners
// only). It asks only what is still outstanding for them. The identity check
// starts when they press the button on their page, not before.

export const personCheckBody = z.object({
  companyId: z.string().min(1).max(200),
  key: z.string().min(1).max(300),
  // Someone added by name alongside a private individual (Jack, 20 November
  // 2026: more than one person buying before any company is set up). With a
  // name, key is ignored.
  name: z.string().trim().min(2).max(200).nullish(),
  email: z.string().trim().max(200).nullish(),
  mobile: z.string().trim().max(40).nullish(),
  send: z.boolean(),
  note: z.string().max(2000).nullish(),
}).strict();

type PersonAsker =
  | { agent: { id: string; name: string | null; email: string | null; phone: string | null } }
  | { client: TokenRow };

const CLIENT_SENDS_A_DAY = 3;
const CLIENT_SEND_GAP_MS = 2 * 60 * 1000;

// dealId null: a person on a client file (no transaction); opts.entityId the sub company.
export async function createPersonCheck(dealId: string | null, input: z.infer<typeof personCheckBody>, by: PersonAsker, opts: { entityId?: string | null } = {}): Promise<{
  token: string; ref: string; link: string; sent: KycSendResult | null; created: boolean; person: string;
}> {
  const found = dealId ? await dealParties(dealId)
    : await clientFileParties(input.companyId, opts.entityId !== undefined ? opts.entityId : "client" in by ? by.client.trading_entity_id || null : null);
  if (!found) throw Object.assign(new Error(dealId ? "Transaction not found" : "Company not found"), { status: 404 });
  const party = found.parties.find(p => p.companyId === input.companyId);
  if (!party) throw Object.assign(new Error("That company is not a party to this transaction."), { status: 400 });
  if (party.kind === "company" && !party.entityId && !party.trust) {
    throw Object.assign(new Error("Set the company that signs on the transaction first: the people to check are read from its register."), { status: 409 });
  }
  const { dealPeopleRequests, partyPeopleFor } = await import("./kyc-people");
  const people = await partyPeopleFor({ companyId: party.companyId, entityId: party.entityId, kind: party.kind, dealId },
    await dealPeopleRequests(dealId, pool, dealId ? undefined : { companyId: party.companyId, entityId: party.entityId }));
  let person: KycPartyPerson | undefined;
  if (input.name) {
    // Adding someone by name is for a private individual's side only: a
    // company's people come from its register.
    if (party.kind !== "individual") throw Object.assign(new Error("People are added by hand only alongside a private individual. A company's people come from its register."), { status: 400 });
    if ("client" in by) throw Object.assign(new Error("Only BGP adds people to a transaction."), { status: 403 });
    const name = input.name.replace(/\s+/g, " ").trim();
    if (!personKey(name)) throw Object.assign(new Error("Enter their full name."), { status: 400 });
    person = people.people.find(p => personNamesMatch(p.name, name)) || {
      key: personKey(name), name, roles: ["joint"], ownerDetail: null, born: null,
      id: { state: "not_started", ref: null, elsewhere: null, someoneElse: null, asked: false },
      address: { done: false, ref: null, asked: false, proof: null },
      sanctions: "not_screened", publicFigure: null, own: null, outstanding: ["identity check", "proof of address"], canSend: true,
    };
  } else {
    person = people.people.find(p => p.key === input.key);
  }
  if (!person) throw Object.assign(new Error(`That person is not on the list of people to check for ${party.name}.`), { status: 404 });
  const main = "client" in by ? by.client : null;
  if (main) {
    if (!person.roles.some(r => r === "owner" || (TRUST_PERSON_ROLES as readonly string[]).includes(r))) throw Object.assign(new Error("Only the owners' and the trust's people's links are passed on from this page."), { status: 400 });
    if (personNamesMatch(person.name, main.contact_name || "")) throw Object.assign(new Error("Your own checks are on this page."), { status: 400 });
  }
  const email = cleanEmail(input.email);
  if (input.send && !isEmail(email)) throw Object.assign(new Error(`Enter a valid email address for ${person.name}.`), { status: 400 });

  const veriff = veriffConfigured();
  const asks = personRequestAsks(person, veriff);
  const held = person.own && !person.own.isMain ? await tokenRow(person.own.token) : null;
  let row = held && !held.completed_at && !closedReason(held) ? held : null;
  if (!row && !asks.needsIdCheck && !asks.docs.length) throw Object.assign(new Error(`Nothing is outstanding for ${person.name}.`), { status: 409 });

  let created = false;
  if (!row) {
    const agents = main ? main.request!.agents : (await agentsFor(dealId, party.companyId)).map(a => ({ name: a.name, email: a.email, phone: a.phone }));
    const me = "agent" in by ? by.agent : null;
    if (me && !agents.length && me.name) agents.push({ name: me.name, email: me.email, phone: me.phone });
    const cc = main ? main.request!.cc
      : [...new Set([...(await agentsFor(dealId, party.companyId)).map(a => cleanEmail(a.email)), cleanEmail(me?.email)].filter(e => e.endsWith(STAFF_DOMAIN)))];
    const token = crypto.randomBytes(32).toString("base64url");
    const ref = await newRef();
    const request: KycRequestDetails = {
      ref, kind: "individual", role: party.role, partyName: party.name, dealName: found.deal.name,
      needsIdCheck: asks.needsIdCheck, docs: asks.docs, note: input.note?.trim() || null, mobile: input.mobile?.trim() || null,
      agents, cc, sentBy: main ? { id: null, name: main.contact_name } : { id: me!.id, name: me!.name },
      sentFrom: null, sentAt: null, sendError: null, openedAt: null, veriffSessionIds: [],
      idCheckNote: !veriff && asks.docs.includes("photo_id") ? "The online identity check is not set up, so photo ID is asked for as a document instead." : null,
      askPep: true, answers: null,
      person: { key: person.key, name: person.name, roles: person.roles, detail: person.ownerDetail },
    };
    await pool.query(
      `INSERT INTO kyc_upload_tokens (token, deal_id, contact_email, contact_name, created_by, expires_at, company_id, contact_id, request, is_test, trading_entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, false, $9)`,
      [token, dealId, email || null, person.name, me ? me.id : main!.created_by, new Date(Date.now() + TOKEN_TTL_DAYS * 86400000),
        party.companyId, JSON.stringify(request), party.entityId],
    );
    row = (await tokenRow(token))!;
    created = true;
    // Someone added alongside a private individual is screened on a fresh run
    // of BGP's checks at once (22 November 2026).
    if (input.name) {
      const { startPrecheck } = await import("./kyc-prechecks");
      void startPrecheck(party.companyId, { dealId, userId: me ? me.id : null, force: true, entityId: party.entityId }).catch(() => {});
    }
  }

  let sent: KycSendResult | null = null;
  if (input.send) {
    const request = row.request!;
    if (main) {
      const recent = (request.clientSends || []).filter(t => Date.now() - Date.parse(t) < 86400000);
      if (recent.length >= CLIENT_SENDS_A_DAY) throw Object.assign(new Error("That link has been emailed three times today. Copy it and send it yourself, or ask your agent."), { status: 429 });
      const last = recent[recent.length - 1];
      if (last && Date.now() - Date.parse(last) < CLIENT_SEND_GAP_MS) throw Object.assign(new Error("Just sent. Give it a couple of minutes before sending it again."), { status: 429 });
      request.clientSends = [...recent, new Date().toISOString()];
    }
    if (email !== cleanEmail(row.contact_email)) {
      await pool.query(`UPDATE kyc_upload_tokens SET contact_email = $2 WHERE token = $1`, [row.token, email]);
      row.contact_email = email;
    }
    if (input.mobile?.trim()) request.mobile = input.mobile.trim();
    // Someone BGP staff email is saved to the CRM under the brand, as the
    // person asked on the main request is. A client's typing is not.
    if (!main && !row.contact_id) {
      try {
        const { findOrAddPartyPerson } = await import("./deal-parties");
        const added = await findOrAddPartyPerson(pool, party.companyId, { name: person.name, email, mobile: request.mobile, jobTitle: null },
          `Added by ${("agent" in by && by.agent.name) || "BGP"} when sending ${person.name} their identity check for ${found.deal.name}, as ${kycPersonRoleWords(person.roles, party.name)}.`);
        await pool.query(`UPDATE kyc_upload_tokens SET contact_id = $2 WHERE token = $1`, [row.token, added.id]);
        row.contact_id = added.id;
      } catch (e: any) {
        console.warn(`[kyc-request] ${person.name} was not saved to the CRM: ${e?.message}`);
      }
    }
    const link = kycLinkFor(row.token);
    sent = await sendKycEmail({
      to: [email], cc: request.cc,
      build: sentFrom => kycRequestEmail({
        recipientName: person.name, partyName: party.name, kind: "individual", dealName: found.deal.name, ref: request.ref, link, expiresAt: row!.expires_at,
        needsIdCheck: request.needsIdCheck, docs: request.docs, note: request.note, noteFrom: request.sentBy?.name || null, agents: amlContact(request.agents), sentFrom, askPep: true,
        person: { roles: person.roles },
      }),
    });
    request.sentFrom = sent.from;
    if (sent.ok) request.sentAt = new Date().toISOString();
    request.sendError = sent.ok ? (sent.fellBack ? `Sent from ${sent.from}: Microsoft would not send as ${KYC_MAILBOX}` : null) : sent.error;
    await saveRequest(row.token, request);
  }
  const who = main ? `${main.contact_name || "the client"} (from their page, ref ${main.request!.ref})` : (("agent" in by && by.agent.name) || "BGP");
  await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, $2, $3, $4)`,
    [party.companyId, input.send ? "client_checks_sent" : "client_checks_link", who,
      `${person.name}'s own checks, as ${kycPersonRoleWords(person.roles, party.name)}, for ${found.deal.name} (ref ${row.request!.ref}): ${input.send ? (sent?.ok ? `emailed to ${email} from ${sent.from}` : `not emailed: ${sent?.error}`) : "link given"}`]).catch(() => {});
  return { token: row.token, ref: row.request!.ref, link: kycLinkFor(row.token), sent, created, person: person.name };
}

// ── What the agents see on the deal ─────────────────────────────────────────

export type ClientCheckStatus = "not_sent" | "sent" | "opened" | "in_progress" | "finished" | "expired" | "cancelled";

// dealId null: a client file's requests (no transaction) for that company and sub company.
export async function clientChecksForDeal(dealId: string | null, client?: { companyId: string; entityId: string | null }) {
  // The joint agent's requests are listed apart (server/joint-agent-checks.ts).
  const rows = (dealId
    ? await pool.query(
      `SELECT * FROM kyc_upload_tokens WHERE deal_id = $1 AND request IS NOT NULL AND is_test IS NOT TRUE AND ${NOT_JOINT_SQL()} ORDER BY created_at DESC`, [dealId])
    : client ? await pool.query(
      `SELECT * FROM kyc_upload_tokens WHERE deal_id IS NULL AND company_id = $1 AND trading_entity_id IS NOT DISTINCT FROM $2::varchar
          AND request IS NOT NULL AND is_test IS NOT TRUE AND ${NOT_JOINT_SQL()} ORDER BY created_at DESC`, [client.companyId, client.entityId])
    : { rows: [] as any[] }).rows as TokenRow[];
  const out = [];
  for (const row of rows) {
    const request = row.request!;
    const progress = await progressOf(row);
    const expired = new Date(row.expires_at) < new Date();
    const status: ClientCheckStatus = row.revoked_at ? "cancelled"
      : row.completed_at ? "finished"
      : expired ? "expired"
      : !request.sentAt ? "not_sent"
      : progress.files.length || (progress.idState && progress.idState !== "not_started") ? "in_progress"
      : request.openedAt ? "opened" : "sent";
    const link = kycLinkFor(row.token);
    out.push({
      token: row.token, ref: request.ref, companyId: row.company_id, partyName: request.partyName, role: request.role,
      recipientName: row.contact_name, recipientEmail: row.contact_email, mobile: request.mobile,
      sentAt: request.sentAt, sentFrom: request.sentFrom, sendError: request.sendError, sentBy: request.sentBy.name,
      cc: request.cc, openedAt: request.openedAt, expiresAt: new Date(row.expires_at).toISOString(),
      finishedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      status, needsIdCheck: request.needsIdCheck, idState: progress.idState, idCheckNote: request.idCheckNote,
      idVerifiedName: progress.idPerson?.verifiedName ?? null, idOtherPerson: progress.idPerson?.isThePerson === false,
      askPep: !!request.askPep, pep: request.answers?.pep ?? null, pepDetail: request.answers?.pepDetail ?? null,
      owners: request.confirmOwners?.length ? { list: request.confirmOwners, answer: request.ownersAnswer?.answer ?? null, detail: request.ownersAnswer?.detail ?? null } : null,
      notAsked: request.notAsked || [],
      person: request.person ? { key: request.person.key, name: request.person.name, roles: request.person.roles } : null,
      viaAgent: request.viaAgent ? { firm: request.viaAgent.firm, name: request.viaAgent.name, email: request.viaAgent.email, passedOn: request.viaAgent.passedOn || [] } : null,
      ownLinksFor: (request.ownLinksFor || []).map(o => o.name),
      // The old single step for every owner's ID: files there do not say
      // whose they are (Woody, 19 November 2026), so it is never ticked here.
      docs: request.docs.map(key => {
        const names = request.ownerNames || [];
        if (key !== "owner_ids" || !names.length) return { key, title: KYC_DOCS[key].title, done: progress.docsDone.includes(key), note: null as string | null };
        const count = progress.files.filter(f => f.docKey === "owner_ids").length;
        return { key, title: KYC_DOCS[key].title, done: false, note: count ? `${count} file${count === 1 ? "" : "s"} for ${names.length} owner${names.length === 1 ? "" : "s"}: whose is not known. Each owner's own check is under People to check.` : null };
      }),
      files: progress.files, remindersSent: row.reminders_sent || 0,
      link,
      whatsapp: request.mobile ? kycWhatsAppHref(request.mobile, kycWhatsAppText({ recipientName: row.contact_name, dealName: request.dealName, link, expiresAt: row.expires_at, senderName: request.sentBy.name })) : null,
      canRemind: !row.revoked_at && !row.completed_at && !expired && !!request.sentAt,
    });
  }
  return out;
}

// ── Reminders ───────────────────────────────────────────────────────────────

export async function sendReminder(row: TokenRow, by?: string | null): Promise<KycSendResult> {
  const request = row.request!;
  const progress = await progressOf(row);
  const link = kycLinkFor(row.token);
  // The joint agent is asked for what is still missing (22 November 2026).
  if (isJointRequest(request)) {
    const r = await import("./joint-agent-checks").then(m => m.chaseJointRequest(pool, row, { name: by || "BGP", auto: false }));
    return { ok: r.ok, from: null, fellBack: false, error: r.error };
  }
  // Through the party's own agent (23 November 2026): the person the agent
  // passed it on to, with the agent copied; else the agent, in their words.
  const via = request.viaAgent || null;
  const passed = via?.passedOn?.length ? via.passedOn[via.passedOn.length - 1] : null;
  await primeAmlContact();
  const common = {
    partyName: request.partyName, kind: request.kind, dealName: request.dealName,
    ref: request.ref, link, expiresAt: row.expires_at, needsIdCheck: request.needsIdCheck, docs: request.docs,
    agents: amlContact(request.agents), progress, test: !!row.is_test, askPep: !!request.askPep,
    confirmOwners: request.confirmOwners, ownerNames: request.ownerNames, ownersAbroad: request.ownersAbroad, ownLinksFor: (request.ownLinksFor || []).map(o => o.name),
    person: request.person ? { roles: request.person.roles } : null, purpose: request.purpose || null,
  };
  const sent = await sendKycEmail({
    to: [passed ? passed.email : row.contact_email || ""],
    cc: passed ? [cleanEmail(row.contact_email), ...request.cc] : request.cc,
    test: !!row.is_test,
    build: sentFrom => via && !passed
      ? kycViaAgentReminderEmail({
        ...common, sentFrom, recipientName: via.name, agentFirm: via.firm, partyRole: request.role,
        clientRole: via.clientRole, clientName: via.clientName, personName: row.contact_name,
      })
      : kycReminderEmail({ ...common, sentFrom, recipientName: passed ? passed.name : row.contact_name }),
  });
  if (sent.ok) await pool.query(`UPDATE kyc_upload_tokens SET reminders_sent = COALESCE(reminders_sent, 0) + 1, last_reminded_at = now() WHERE token = $1`, [row.token]);
  return sent;
}

// Due when the request went out, has not been finished, cancelled or run
// out, and the next reminder's day has come. Nothing is sent once every
// step is done (the client only forgot to press Finish).
export function reminderDue(row: Pick<TokenRow, "revoked_at" | "completed_at" | "expires_at" | "reminders_sent" | "is_test"> & { request: Pick<KycRequestDetails, "sentAt"> | null }, now: Date): boolean {
  if (!row.request?.sentAt || row.revoked_at || row.completed_at || row.is_test) return false;
  if (new Date(row.expires_at) <= now) return false;
  const count = row.reminders_sent || 0;
  if (count >= REMINDER_DAYS.length) return false;
  return now.getTime() >= new Date(row.request.sentAt).getTime() + REMINDER_DAYS[count] * 86400000;
}

export async function sendKycReminders(now = new Date()): Promise<{ sent: number; failed: number; skipped: number }> {
  if (!clientChecksOn()) return { sent: 0, failed: 0, skipped: 0 };
  // Only a live deal is chased (Woody, 19 November 2026: "Yes don't chase",
  // of a deleted deal; 20 November: "only chase live deals"): never one that
  // has been deleted, withdrawn, completed, invoiced or archived
  // (CLOSED_STATUSES). Its requests are left as they are.
  const rows = (await pool.query(
    `SELECT * FROM kyc_upload_tokens
      WHERE request IS NOT NULL AND is_test IS NOT TRUE AND revoked_at IS NULL AND completed_at IS NULL
        AND expires_at > now() AND COALESCE(reminders_sent, 0) < $1 AND ${NOT_JOINT_SQL()}
        AND (kyc_upload_tokens.deal_id IS NULL
             OR EXISTS (SELECT 1 FROM crm_deals d WHERE d.id = kyc_upload_tokens.deal_id
                     AND NOT (lower(btrim(coalesce(d.status, ''))) = ANY($2::text[]))))`,
    [REMINDER_DAYS.length, statusSpellingsFor(CLOSED_STATUSES)])).rows as TokenRow[];
  let sent = 0, failed = 0, skipped = 0;
  for (const row of rows) {
    if (!reminderDue(row, now)) continue;
    const progress = await progressOf(row);
    if ((!row.request!.needsIdCheck || progress.idDone) && progress.docsDone.length === row.request!.docs.length && progress.pepAnswered && progress.ownersAnswered && progress.ownersLinked !== false) { skipped++; continue; }
    const result = await sendReminder(row);
    if (result.ok) sent++; else { failed++; console.warn(`[kyc] reminder for ${row.request!.ref} failed: ${result.error}`); }
  }
  if (sent || failed) console.log(`[kyc] reminders: ${sent} sent, ${failed} failed, ${skipped} with nothing left to send`);
  // The joint agent is chased for what is missing, every three days (22 November 2026).
  const joint = await import("./joint-agent-checks").then(m => m.chaseJointAgents(now)).catch((e: any) => { console.warn(`[kyc] joint agent chase failed: ${e?.message}`); return { chased: 0, stopped: 0, failed: 1 }; });
  return { sent: sent + joint.chased, failed: failed + joint.failed, skipped };
}

// ── Filing a file ───────────────────────────────────────────────────────────

const safeFileName = (name: string) => path.basename(String(name || "file")).replace(/[^a-zA-Z0-9_.\-]/g, "_").slice(-120) || "file";

// Store a file the client sent and file it on the party's KYC record (a
// test request records the name only and keeps nothing). A joint agent's
// file (22 November 2026) is filed the same way, said to be theirs, and read
// against the people the checks need (server/joint-agent-checks.ts).
export async function fileClientDocument(row: TokenRow, file: { name: string; mime: string; buffer: Buffer }, docKey: KycDocKey | null, how: string, addedBy?: { id: string; name: string | null }): Promise<string | null> {
  const request = row.request!;
  const joint = isJointRequest(request);
  // The joint agent, or the party's own agent (the landlord's agent; 22 November 2026).
  const who = request.jointAgent?.relation === "own" ? agentWords("own", request.role) : "joint agent";
  const sender = addedBy
    ? `${addedBy.name || "BGP"}, from ${request.jointAgent?.firm || "the joint agent"}`
    : joint ? `${row.contact_name || "the joint agent"} of ${request.jointAgent?.firm || "the joint agent"} <${row.contact_email || "unknown"}>`
    : request.viaAgent ? `the link sent through ${request.viaAgent.firm} <${row.contact_email || "unknown"}> (the client or their agent)`
    : `${row.contact_name || "the client"} <${row.contact_email || "unknown"}>`;
  if (row.is_test) {
    await pool.query(
      `INSERT INTO kyc_upload_files (token, deal_id, original_filename, content_type, size_bytes, doc_type) VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.token, row.deal_id, file.name, file.mime || null, file.buffer.length, docKey],
    );
    return null;
  }
  const { saveFile } = await import("./file-storage");
  const safeName = `kyc-${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safeFileName(file.name)}`;
  await saveFile(`chat-media/${safeName}`, file.buffer, file.mime || "application/octet-stream", file.name);
  let docType = docKey ? KYC_DOCS[docKey].docType : "other";
  if (!docKey) {
    try { docType = (await import("./kyc-pack-intake")).classifyPackFile(file.name); } catch {}
  }
  const doc = await pool.query(
    `INSERT INTO kyc_documents (company_id, trading_entity_id, contact_id, deal_id, doc_type, file_url, file_name, file_size, mime_type, notes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [row.company_id, row.trading_entity_id || null, joint ? null : row.contact_id, row.deal_id, docType, `/api/chat-media/${safeName}`, file.name, file.buffer.length, file.mime || null,
      `${how} by ${sender} (${joint ? `the ${who}'s checks` : "client checks"}, ref ${request.ref}${docKey ? `, as ${KYC_DOCS[docKey].title}` : ""})`, addedBy?.id || null],
  );
  await pool.query(
    `INSERT INTO kyc_upload_files (token, deal_id, original_filename, content_type, size_bytes, doc_type, kyc_document_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.token, row.deal_id, file.name, file.mime || null, file.buffer.length, docKey, String(doc.rows[0].id)],
  );
  await pool.query(`UPDATE kyc_upload_tokens SET last_used_at = now(), use_count = COALESCE(use_count, 0) + 1 WHERE token = $1`, [row.token]);

  if (row.company_id) {
    // The checklist items the file evidences, for the MLRO to confirm (the
    // KYC pack intake's rule). A failure here never loses the file.
    try {
      const { packEvidence } = await import("./kyc-pack-intake");
      const types = (await pool.query(`SELECT doc_type FROM kyc_documents WHERE company_id = $1 AND deleted_at IS NULL`, [row.company_id])).rows.map((r: any) => r.doc_type);
      const evidence = packEvidence(types);
      if (Object.keys(evidence).length) {
        const { tickChecklistItems } = await import("./kyc-orchestrator");
        await tickChecklistItems(row.company_id, Object.fromEntries(Object.entries(evidence).map(([key, list]) => [key, {
          source: "system" as const, tickedBy: null,
          evidence: { documents: list, source: `${joint ? `${who}'s checks` : "client checks"} ${request.ref}` },
          notes: `Evidence sent ${joint ? `by the ${who}, ${request.jointAgent?.firm || `the ${who}`},` : "by the client through client checks"} (ref ${request.ref}): ${list.join(", ").replace(/_/g, " ")}. MLRO to confirm.`,
        }])));
      }
    } catch (e: any) { console.warn(`[kyc] checklist update after an upload failed: ${e?.message}`); }
    await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, $2, $3, $4)`,
      [row.company_id, joint ? "joint_agent_document_received" : "client_document_received", addedBy?.name || row.contact_name || row.contact_email,
        `${file.name} (${docType}) ${how.toLowerCase()}${joint ? ` from ${request.jointAgent?.firm || "the joint agent"}` : ""}, ref ${request.ref}`]).catch(() => {});
  }

  if (joint) {
    // Read and set against the people the checks need (22 November 2026).
    // After the file is safe; a failed read only says so.
    const documentId = String(doc.rows[0].id);
    void import("./joint-agent-checks")
      .then(async m => m.recordJointReading(pool, row.token, documentId, await m.readJointFile({ buffer: file.buffer, mime: file.mime || null, name: file.name })))
      .catch((e: any) => console.warn(`[kyc] joint agent file reading not kept: ${e?.message}`));
    return documentId;
  }

  if (docKey === "company_documents" && row.company_id) {
    // A company registered abroad sends its own register's extract (HMRC
    // AMLG11400 14.6). It is read in the app, in any language, translated into
    // English, and checked against the company (23 November 2026, Woody: no
    // outside providers, "all happen in the app including translation").
    const documentId = String(doc.rows[0].id);
    await pool.query(
      `INSERT INTO kyc_document_readings (document_id, deal_id, company_id, trading_entity_id, seen_original, uploaded_by_name)
       VALUES ($1, $2, $3, $4, false, $5) ON CONFLICT (document_id) DO NOTHING`,
      [documentId, row.deal_id, row.company_id, row.trading_entity_id || null, `${sender} (client checks, ref ${request.ref})`.slice(0, 300)])
      .catch((e: any) => console.warn(`[kyc] company document not queued for reading: ${e?.message}`));
    void import("./kyc-documents").then(m => m.readUpload(pool, documentId)).catch((e: any) => console.warn(`[kyc] company document not read: ${e?.message}`));
  }

  if (docKey === "certified_ids" && row.company_id) {
    // Certified copies a client sends (23 November 2026) are read and checked
    // as a document BGP uploads is (server/kyc-documents.ts): whose it is, in
    // date, and who certified it and when. One that passes counts for that
    // person; one that does not waits for an officer. Never seen in the original.
    const documentId = String(doc.rows[0].id);
    await pool.query(
      `INSERT INTO kyc_document_readings (document_id, deal_id, company_id, trading_entity_id, seen_original, uploaded_by_name)
       VALUES ($1, $2, $3, $4, false, $5) ON CONFLICT (document_id) DO NOTHING`,
      [documentId, row.deal_id, row.company_id, row.trading_entity_id || null, `${sender} (client checks, ref ${request.ref})`.slice(0, 300)])
      .catch((e: any) => console.warn(`[kyc] certified copy not queued for reading: ${e?.message}`));
    // Read after the reply; one not read here is read when BGP opens the party's documents.
    void import("./kyc-documents").then(m => m.readUpload(pool, documentId)).catch((e: any) => console.warn(`[kyc] certified copy not read: ${e?.message}`));
  }

  if (isTrustDocsRequest(request) || docKey === "trust_deed") {
    // A trust's documents (23 November 2026): the deed is read into a draft
    // structure, and once everything asked for is in, the request finishes
    // itself and the agents and officers hear it is ready.
    const documentId = String(doc.rows[0].id);
    void (async () => {
      if (docKey === "trust_deed" && row.company_id) {
        await import("./trust-structure").then(m => m.readDeedDocument(documentId, row.company_id!, request.partyName, file)).catch(() => null);
      }
      if (isTrustDocsRequest(request)) {
        const fresh = await tokenRow(row.token);
        if (fresh && !fresh.completed_at && !fresh.revoked_at) {
          const progress = await progressOf(fresh);
          if (fresh.request!.docs.every(k => progress.docsDone.includes(k))) await finishRequest(fresh);
        }
      }
    })().catch((e: any) => console.warn(`[kyc] trust document follow-up failed: ${e?.message}`));
  }

  if (docKey === "proof_of_address") {
    // Read and set against the person it is for (20 November 2026): the
    // people to check count it only when it reads right or an officer
    // accepts it. After the file is safe; a failed read only says so.
    const documentId = String(doc.rows[0].id);
    void import("./kyc-address-proof")
      .then(async m => m.recordAddressProof(pool, row.token, documentId, await m.readAddressProof({ buffer: file.buffer, mime: file.mime || null, name: file.name })))
      .catch((e: any) => console.warn(`[kyc] proof of address reading not kept: ${e?.message}`));
  }

  if (docKey === "source_of_funds") {
    // The AI reading of a source of funds document, as before. After the
    // file is safe; a temporary copy under a name the app chose.
    void (async () => {
      const tmp = path.join(os.tmpdir(), `bgp_kyc_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${path.extname(safeFileName(file.name))}`);
      try {
        fs.writeFileSync(tmp, file.buffer);
        const { extractTextFromFile } = await import("./utils/file-extractor");
        const text = await extractTextFromFile(tmp, file.name);
        if (text && text.length > 30) {
          const { analyseSourceOfFundsDoc, saveSofAnalysis } = await import("./aml-ai");
          // A client file has no transaction to read the declared source from, or to save to.
          const deal = row.deal_id ? (await pool.query(`SELECT name, aml_source_of_funds FROM crm_deals WHERE id = $1`, [row.deal_id])).rows[0] : null;
          const analysis = await analyseSourceOfFundsDoc({ dealName: deal?.name || request.dealName, declaredSource: deal?.aml_source_of_funds, documentText: text, filename: file.name });
          if (row.deal_id && ["bank_statement", "payslip", "tax_return"].includes(String(analysis.documentType))) await saveSofAnalysis(row.deal_id, analysis, deal?.aml_source_of_funds);
          await pool.query(`UPDATE kyc_upload_files SET ai_classification = $2 WHERE token = $1 AND original_filename = $3 AND ai_classification IS NULL`, [row.token, analysis, file.name]);
        }
      } catch (e: any) {
        console.warn(`[kyc] source of funds reading failed: ${e?.message}`);
      } finally {
        try { fs.unlinkSync(tmp); } catch {}
      }
    })();
  }
  return String(doc.rows[0].id);
}

// The files in a joint agent's zip that can be kept: documents and photos,
// none over the size limit (the KYC4U pack reader opens it).
async function jointZipFiles(name: string, mime: string | null | undefined, buffer: Buffer): Promise<Array<{ name: string; mime: string; buffer: Buffer }>> {
  const { unpackKyc4uFiles } = await import("./kyc4u-result-pack");
  const { entries } = await unpackKyc4uFiles([{ originalname: name, mimetype: mime || "application/zip", buffer }]);
  return entries
    .filter(e => e.buffer.length <= KYC_MAX_FILE_MB * 1024 * 1024 && kycUploadAllowed(e.name, e.mime))
    .slice(0, KYC_MAX_FILES_PER_REQUEST)
    .map(e => ({ name: e.name, mime: e.mime || "application/octet-stream", buffer: e.buffer }));
}

// ── Finishing ───────────────────────────────────────────────────────────────

async function finishRequest(row: TokenRow): Promise<void> {
  if (row.completed_at) return;
  // Claimed once: two uploads finishing a trust's documents together send one note.
  const claimed = await pool.query(`UPDATE kyc_upload_tokens SET completed_at = now() WHERE token = $1 AND completed_at IS NULL RETURNING token`, [row.token]);
  if (!claimed.rows.length) return;
  const request = row.request!;
  const progress = await progressOf(row);
  // A trust's documents are in (23 November 2026): the agents and the
  // officers hear it is ready for due diligence, with the deed read first.
  if (isTrustDocsRequest(request)) {
    const deedFiles = progress.files.filter(f => f.docKey === "trust_deed");
    const deed = deedFiles.length && row.company_id && !row.is_test
      ? await import("./trust-structure").then(m => m.ensureRequestDeedRead(row.token, row.company_id!, request.partyName)).catch(() => null)
      : null;
    const missing = request.docs.filter(key => !progress.docsDone.includes(key)).map(key => KYC_DOCS[key].title);
    const officers = row.is_test ? [] : await import("./aml-authority").then(m => m.amlOfficerEmails()).catch(() => [] as string[]);
    const to = [...new Set([...kycReplyAddresses(row, request.cc), ...officers.filter(e => cleanEmail(e).endsWith(STAFF_DOMAIN))])];
    const sent = await sendKycEmail({
      to, test: !!row.is_test,
      build: sentFrom => trustDocsReadyEmail({
        recipientName: row.contact_name, partyName: request.partyName, dealName: request.dealName, ref: request.ref,
        dealLink: linkForRow(row), sentFrom, test: !!row.is_test,
        files: progress.files.map(f => ({ name: f.name, docKey: f.docKey })), missing,
        deed: deed ? { read: deed.read, values: deed.lines.length, people: deed.people.length, why: deed.why } : null,
      }),
    });
    if (!sent.ok) console.warn(`[kyc] the trust documents note for ${request.ref} was not sent: ${sent.error}`);
    if (row.company_id && !row.is_test) {
      await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'trust_documents_in', $2, $3)`,
        [row.company_id, row.contact_name || row.contact_email, `Trust documents in, ref ${request.ref}: ${progress.files.length} file(s)${missing.length ? `; not sent: ${missing.join(", ")}` : ""}; ready for due diligence${sent.ok ? `, emailed to ${to.join(", ")}` : ""}`]).catch(() => {});
    }
    return;
  }
  // The joint agent finished (22 November 2026): the deal's agents hear what
  // came in, what it does not cover yet, and what happens next.
  if (isJointRequest(request)) {
    const letting = request.jointAgent?.rule === "letting" || request.jointAgent?.rule === "other";
    const missing = await import("./joint-agent-checks").then(m => m.gapsForToken(row.token, { you: false })).catch(() => [] as string[]);
    const sent = await sendKycEmail({
      to: kycReplyAddresses(row, request.cc), test: !!row.is_test,
      build: sentFrom => jointAgentFinishedEmail({
        firm: request.jointAgent?.firm || "The joint agent", recipientName: row.contact_name, partyName: request.partyName, dealName: request.dealName,
        ref: request.ref, dealLink: linkForRow(row), files: progress.files.map(f => f.name), letting,
        reliance: request.jointAgent?.reliance ? { name: request.jointAgent.reliance.name, at: request.jointAgent.reliance.agreedAt } : null,
        missing, sentFrom,
      }),
    });
    if (!sent.ok) console.warn(`[kyc] the joint agent's finished note for ${request.ref} was not sent: ${sent.error}`);
    if (row.company_id && !row.is_test) {
      await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'joint_agent_finished', $2, $3)`,
        [row.company_id, row.contact_name || row.contact_email, `${request.jointAgent?.firm || "The joint agent"} finished, ref ${request.ref}: ${progress.files.length} file(s)${letting ? (request.jointAgent?.reliance ? "; reliance terms agreed" : "; reliance terms not agreed") : ""}`]).catch(() => {});
    }
    return;
  }
  const otherPerson = progress.idPerson?.isThePerson === false;
  const missing = [
    ...(request.needsIdCheck && !progress.idDone ? [otherPerson ? `${row.contact_name || "The client"}'s own identity check` : "Identity check"] : []),
    ...(progress.ownersAnswered ? [] : [KYC_OWNERS_QUESTION.title]),
    ...(progress.ownersLinked === false ? [KYC_OWNER_LINKS_TITLE] : []),
    ...request.docs.filter(key => !progress.docsDone.includes(key)).map(key => KYC_DOCS[key].title),
    ...(progress.pepAnswered ? [] : [KYC_PEP_QUESTION.title]),
  ];
  // The agents hear it; on a test, the admin who sent it.
  const to = kycReplyAddresses(row, request.cc);
  // The other people to check for the party, with what is still to come.
  const peopleOutstanding = request.person ? [] : await partyPeopleForRow(row)
    .then(found => (found?.people || []).filter(p => p.outstanding.length && !personNamesMatch(p.name, row.contact_name || "")).map(p => `${p.name}: ${p.outstanding.join(" and ")}${p.own && !p.own.isMain ? (p.own.sentAt ? " (link emailed)" : " (link given)") : ""}`))
    .catch(() => []);
  const { loadDealRedFlags, requestIdChecks } = await import("./kyc-red-flags");
  const { partyRedFlags } = await import("@shared/kyc-red-flags");
  const redFlags = row.is_test || !row.company_id
    ? partyRedFlags({ company: null, latestInvestigation: null, requests: [{ ref: request.ref, answers: request.answers || null, ownersAnswer: request.ownersAnswer || null, person: request.person?.name || null }], idChecks: await requestIdChecks(request.veriffSessionIds) })
    : await loadDealRedFlags(row.deal_id, [row.company_id], row.trading_entity_id ? { [row.company_id]: row.trading_entity_id } : {}).then(r => r.parties[row.company_id!] || []).catch(() => []);
  const inHouse = await import("./aml-authority").then(m => m.readInHouseEdd()).then(v => !!v.on).catch(() => true);
  const sent = await sendKycEmail({
    to, test: !!row.is_test,
    build: sentFrom => kycFinishedEmail({
      inHouse,
      recipientName: row.contact_name, partyName: request.partyName, dealName: request.dealName, ref: request.ref,
      dealLink: linkForRow(row), idState: progress.idState, idPerson: progress.idPerson,
      files: progress.files.map(f => ({ name: f.name, docKey: f.docKey })), missing, sentFrom, test: !!row.is_test,
      kind: request.kind, ...(request.askPep ? { pep: request.answers?.pep ?? null, pepDetail: request.answers?.pepDetail ?? null } : {}),
      redFlags, owners: request.confirmOwners?.length ? { list: request.confirmOwners, reply: request.ownersAnswer || null } : null,
      person: request.person ? { roles: request.person.roles } : null,
      peopleOutstanding,
    }),
  });
  if (!sent.ok) console.warn(`[kyc] the finished note for ${request.ref} was not sent: ${sent.error}`);
  if (row.company_id && !row.is_test) {
    await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'client_checks_finished', $2, $3)`,
      [row.company_id, row.contact_name || row.contact_email, `Finished, ref ${request.ref}: ${progress.files.length} file(s)${otherPerson ? `; the identity check on this link was passed by ${progress.idPerson!.verifiedName}, not ${row.contact_name || "the person it was for"}` : ""}${missing.length ? `; not sent: ${missing.join(", ")}` : ""}`]).catch(() => {});
  }
}

// ── Replies with documents ──────────────────────────────────────────────────

// Reads the KYC mailbox for replies with attachments. A reply is filed only
// when its subject carries a request's reference AND it comes from the
// address that request was sent to; anything else is marked for a person
// to look at in the mailbox, and never filed.
export async function pollKycMailbox(): Promise<{ scanned: number; filed: number; unmatched: number; warnings: string[] }> {
  const warnings: string[] = [];
  let scanned = 0, filed = 0, unmatched = 0;
  const mailbox = encodeURIComponent(KYC_MAILBOX);
  const tag = async (msg: any, category: string) => {
    await graphRequest(`/users/${mailbox}/messages/${msg.id}`, {
      method: "PATCH", body: JSON.stringify({ categories: [...(msg.categories || []), category] }),
    }).catch((e: any) => warnings.push(`could not mark "${msg.subject}": ${String(e?.message).slice(0, 120)}`));
  };
  let messages: any[] = [];
  try {
    // Microsoft takes a sort only on a property the filter names first.
    const since = new Date(Date.now() - 45 * 86400000).toISOString();
    const data: any = await graphRequest(`/users/${mailbox}/mailFolders/Inbox/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${since} and hasAttachments eq true`)}&$orderby=receivedDateTime desc&$top=50&$select=id,subject,from,categories,receivedDateTime`);
    messages = data?.value || [];
  } catch (e: any) {
    return { scanned: 0, filed: 0, unmatched: 0, warnings: [`Could not read ${KYC_MAILBOX}: ${String(e?.message).slice(0, 200)}`] };
  }
  for (const msg of messages) {
    const categories: string[] = msg.categories || [];
    if (categories.includes(FILED) || categories.includes(UNMATCHED) || categories.includes(OLD_FILED)) continue;
    scanned++;
    try {
      const ref = kycRefFromSubject(msg.subject);
      const row = ref ? (await pool.query(`SELECT * FROM kyc_upload_tokens WHERE request->>'ref' = $1 LIMIT 1`, [ref])).rows[0] as TokenRow | undefined : undefined;
      const from = cleanEmail(msg.from?.emailAddress?.address);
      if (!row || !row.request || row.revoked_at || row.is_test) {
        unmatched++; warnings.push(`"${msg.subject}" from ${from}: no open request with that reference`); await tag(msg, UNMATCHED); continue;
      }
      // A joint agent's colleague at the same firm may send it (22 November
      // 2026): the same domain, never a free mail service.
      const viaAgent = row.request.viaAgent || null;
      const sameFirm = (isJointRequest(row.request) || !!viaAgent) && sameFirmDomain(from, cleanEmail(row.contact_email));
      // Through the agent (23 November 2026): whoever they passed it on to may reply too.
      const passedTo = !!viaAgent?.passedOn?.some(x => cleanEmail(x.email) === from);
      if (!from || (from !== cleanEmail(row.contact_email) && !sameFirm && !passedTo)) {
        unmatched++; warnings.push(`"${msg.subject}" came from ${from}, not the address the request went to`); await tag(msg, UNMATCHED); continue;
      }
      const list: any = await graphRequest(`/users/${mailbox}/messages/${msg.id}/attachments?$select=id,name,contentType,size,isInline`);
      for (const a of list?.value || []) {
        if (a.isInline || a["@odata.type"] === "#microsoft.graph.itemAttachment") continue;
        if (a.size > KYC_MAX_FILE_MB * 1024 * 1024) { warnings.push(`${a.name} is over ${KYC_MAX_FILE_MB}MB`); continue; }
        const zip = isJointRequest(row.request) && /\.zip$/i.test(a.name || "");
        if (!zip && !kycUploadAllowed(a.name || "", a.contentType)) { warnings.push(`${a.name}: not a document or photo`); continue; }
        // A message whose mark could not be saved is read again next time:
        // a file already filed from it is not filed twice.
        const already = await pool.query(`SELECT 1 FROM kyc_upload_files WHERE token = $1 AND original_filename = $2 AND size_bytes = $3 LIMIT 1`, [row.token, a.name, a.size]);
        if (already.rowCount) continue;
        const att: any = await graphRequest(`/users/${mailbox}/messages/${msg.id}/attachments/${a.id}`);
        if (!att?.contentBytes) continue;
        const how = from === cleanEmail(row.contact_email) ? "Emailed" : `Emailed from ${from}`;
        if (zip) {
          // The joint agent's zip: each file in it, once.
          for (const f of await jointZipFiles(a.name, a.contentType, Buffer.from(att.contentBytes, "base64"))) {
            const dup = await pool.query(`SELECT 1 FROM kyc_upload_files WHERE token = $1 AND original_filename = $2 AND size_bytes = $3 LIMIT 1`, [row.token, f.name, f.buffer.length]);
            if (dup.rowCount) continue;
            await fileClientDocument(row, f, null, `${how} (in ${a.name})`);
            filed++;
          }
          continue;
        }
        await fileClientDocument(row, { name: a.name, mime: a.contentType, buffer: Buffer.from(att.contentBytes, "base64") }, null, how);
        filed++;
      }
      await tag(msg, FILED);
    } catch (e: any) {
      warnings.push(`${msg.subject}: ${String(e?.message).slice(0, 200)}`);
    }
  }
  return { scanned, filed, unmatched, warnings };
}

// ── Routes ──────────────────────────────────────────────────────────────────

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: KYC_MAX_FILE_MB * 1024 * 1024, files: 1 } });
const portalUpload = (req: Request, res: Response, next: NextFunction) => upload.single("file")(req, res, (err: any) => {
  if (!err) return next();
  if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: `That file is over ${KYC_MAX_FILE_MB}MB. Please send a smaller copy, or a photo of the page.` });
  return res.status(400).json({ message: "That file could not be read. Please try again." });
});

export const kycRequestRouter = Router();

const signedIn = (req: Request, res: Response, next: NextFunction) => {
  import("./auth").then(m => m.requireAuth(req, res, next)).catch(next);
};
const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  import("./auth").then(m => m.requireAdmin(req, res, next)).catch(next);
};

// The deal's requests, its parties and their contacts, who would be copied.
// A client file's own (24 November 2026): the same answer, about its one party.
kycRequestRouter.get(["/api/aml/deal/:id/client-checks", "/api/client-kyc/:companyId/subjects/:entity/client-checks"], signedIn, async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: STAFF_ONLY });
    const scope = scopeOf(req);
    const dealId = scope.dealId;
    const found = await partiesFor(scope);
    if (!found) return res.status(404).json({ message: dealId ? "Transaction not found" : "Company not found" });
    const agents = await agentsFor(dealId, found.parties[0]?.companyId || "");
    const veriff = veriffConfigured();
    // Any proof of address not read yet is read in the background (20 November 2026).
    if (dealId) void import("./kyc-address-proof").then(m => m.readUnreadAddressProofs(pool, dealId)).catch(() => {});
    // The people to check per party (19 November 2026).
    const { dealPeopleRequests, partyPeopleFor } = await import("./kyc-people");
    const peopleRequests = await dealPeopleRequests(dealId, pool, scope.client || undefined).catch(() => null);
    const people: Record<string, PartyPeople | null> = {};
    for (const p of found.parties) {
      people[p.companyId] = peopleRequests ? await partyPeopleFor({ companyId: p.companyId, entityId: p.entityId, kind: p.kind, dealId }, peopleRequests).catch(() => null) : null;
    }
    res.json({
      dealName: found.deal.name,
      // BGP's client, for the email to the other side's agent (23 November 2026).
      clientRole: found.deal.clientRole, clientName: found.deal.clientName,
      mailbox: KYC_MAILBOX,
      veriff,
      agents: agents.map(a => ({ name: a.name, email: a.email })),
      parties: await Promise.all(found.parties.map(async ({ personField: _column, ...p }) => {
        const pre = await import("./kyc-prechecks").then(m => m.partyAskInput(p.companyId, p.entityId)).catch(() => null);
        const contact = p.contacts.find(c => c.id === p.contactId) || p.contacts[0] || null;
        const trustAsk = p.trust ? await import("./trust-structure").then(m => m.trustAskFor(p.companyId)).catch(() => null) : null;
        const asks = precheckAsks(pre?.input || null, { kind: p.kind, role: p.role, idCheck: veriff && !p.publicBody, contactName: contact?.name || null, trust: trustAsk, publicBody: !!p.publicBody });
        // While BGP's checks are reading the register, the send window waits (24 November 2026).
        const precheckRunning = !!(await import("./kyc-prechecks").then(m => m.precheckRunning(p.companyId, p.entityId)).catch(() => null));
        return { ...p, defaultDocs: asks.docs, askInput: pre?.input || null, precheckRanAt: pre?.ranAt || null, precheckRunning, trustAsk };
      })),
      requests: await clientChecksForDeal(dealId, scope.client || undefined),
      people,
    });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not load the client checks" });
  }
});

// A person's own link: given (send false) or emailed (send true), by BGP staff.
kycRequestRouter.post(["/api/aml/deal/:id/client-checks/people", "/api/client-kyc/:companyId/subjects/:entity/client-checks/people"], signedIn, async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    if (!clientChecksOn()) return res.status(410).json({ message: CHECKS_OFF });
    const parsed = personCheckBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the form and try again" });
    const scope = scopeOf(req);
    if (scope.client && parsed.data.companyId !== scope.client.companyId) return res.status(400).json({ message: "That person is not on this company's checks." });
    res.json(await createPersonCheck(scope.dealId, parsed.data, { agent: me }, scope.client ? { entityId: scope.client.entityId } : {}));
  } catch (err: any) {
    res.status(err?.status || 500).json({ message: err?.message || "Could not make their link" });
  }
});

// The name a person was asked under, put right (Jack, 20 November 2026: added
// as "Jonny Miller", his passport and bill say Jonathan Miller). Only for a
// name BGP typed: someone added alongside a private individual, or the person
// a private individual's request went to. A name from Companies House stays
// the register's. Their identity check and proof of address are read against
// the name on every view, so what they sent counts at once.
kycRequestRouter.post(["/api/aml/deal/:id/client-checks/people/rename", "/api/client-kyc/:companyId/subjects/:entity/client-checks/people/rename"], signedIn, async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    if (!clientChecksOn()) return res.status(410).json({ message: CHECKS_OFF });
    const name = String(req.body?.name || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (name.split(" ").length < 2 || !personKey(name)) return res.status(400).json({ message: "Enter their full name, first and last." });
    const row = await tokenRow(String(req.body?.token || ""));
    const scope = scopeOf(req);
    if (!row || !row.request || row.is_test || !rowInScope(row, scope)) return res.status(404).json({ message: scope.dealId ? "That request is not on this transaction." : "That request is not on this company's checks." });
    const person = (row.request as any).person as KycRequestPerson | undefined;
    const typedByBgp = person ? (person.roles || []).every(r => r === "joint") : row.request.kind === "individual";
    if (!typedByBgp) return res.status(409).json({ message: "This name comes from Companies House and is kept as the register gives it." });
    const before = person ? person.name : row.contact_name || "";
    const request = person ? { ...row.request, person: { ...person, name, key: personKey(name) } } : row.request;
    await pool.query(`UPDATE kyc_upload_tokens SET contact_name = $2, request = $3::jsonb WHERE token = $1`, [row.token, name, JSON.stringify(request)]);
    if (row.company_id) await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'client_checks_renamed', $2, $3)`,
      [row.company_id, me.name || me.id, `Name on client checks ref ${row.request.ref} changed from ${before} to ${name}`]).catch(() => {});
    // The name put right is screened on a fresh run (22 November 2026).
    if (row.company_id) {
      const { startPrecheck } = await import("./kyc-prechecks");
      void startPrecheck(String(row.company_id), { dealId: scope.dealId, userId: me.id, force: true, entityId: row.trading_entity_id || null }).catch(() => {});
    }
    res.json({ ok: true, name });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not change the name" });
  }
});

// A proof of address read again (BGP staff), or accepted by the Nominated
// Officer or a Deputy with a note when its reading did not pass (Woody,
// 20 November 2026: "is the app checking its actually for that person and
// acceptable?"). Both keep what they did on the request the file came in on.
// A request belongs to the route's transaction, or to its client file (no transaction, that company and sub company).
function rowInScope(row: Pick<TokenRow, "deal_id" | "company_id" | "trading_entity_id">, scope: CheckScope): boolean {
  if (scope.dealId) return String(row.deal_id || "") === scope.dealId;
  return !row.deal_id && String(row.company_id || "") === scope.client!.companyId && (row.trading_entity_id || null) === scope.client!.entityId;
}

async function addressProofRow(scope: CheckScope, token: unknown, documentId: unknown) {
  const t = String(token || "").slice(0, 200), d = String(documentId || "").slice(0, 100);
  if (!t || !d) return null;
  const row = (await pool.query(
    `SELECT u.token, u.company_id, u.trading_entity_id, u.deal_id, u.request FROM kyc_upload_tokens u
       JOIN kyc_upload_files f ON f.token = u.token AND f.kyc_document_id = $2 AND f.doc_type = 'proof_of_address'
      WHERE u.token = $1 AND u.is_test IS NOT TRUE`, [t, d])).rows[0];
  if (!row || !rowInScope(row, scope)) return null;
  return { token: t, documentId: d, companyId: row.company_id as string | null, ref: String(row.request?.ref || "") };
}

kycRequestRouter.post(["/api/aml/deal/:id/client-checks/address-proof/read", "/api/client-kyc/:companyId/subjects/:entity/client-checks/address-proof/read"], signedIn, async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    if (!clientChecksOn()) return res.status(410).json({ message: CHECKS_OFF });
    const found = await addressProofRow(scopeOf(req), req.body?.token, req.body?.documentId);
    if (!found) return res.status(404).json({ message: "That proof of address is not on this transaction." });
    const { rereadAddressProof } = await import("./kyc-address-proof");
    const reading = await rereadAddressProof(pool, found.token, found.documentId);
    res.json({ ok: true, reading });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not read it again" });
  }
});

kycRequestRouter.post(["/api/aml/deal/:id/client-checks/address-proof/accept", "/api/client-kyc/:companyId/subjects/:entity/client-checks/address-proof/accept"], signedIn, async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    if (!clientChecksOn()) return res.status(410).json({ message: CHECKS_OFF });
    const { amlActor } = await import("./aml-authority");
    const actor = await amlActor(req);
    if (!actor.isMlro) return res.status(403).json({ message: `Only ${officerWords(actor.officers)} can accept a proof of address the reading did not pass.` });
    const note = String(req.body?.note || "").replace(/\s+/g, " ").trim().slice(0, 1000);
    if (note.length < ADDRESS_PROOF_ACCEPT_NOTE_MIN) return res.status(400).json({ message: "Say why it is acceptable (at least 10 characters)." });
    const found = await addressProofRow(scopeOf(req), req.body?.token, req.body?.documentId);
    if (!found) return res.status(404).json({ message: "That proof of address is not on this transaction." });
    const accepted = { by: me.name || me.email || "BGP", at: new Date().toISOString(), note };
    await pool.query(
      `UPDATE kyc_upload_tokens
          SET request = jsonb_set(COALESCE(request, '{}'::jsonb), '{addressAccepted}',
                                  COALESCE(request->'addressAccepted', '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb))
        WHERE token = $1`, [found.token, found.documentId, JSON.stringify(accepted)]);
    if (found.companyId) {
      await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'address_proof_accepted', $2, $3)`,
        [found.companyId, accepted.by, `Proof of address accepted on client checks ref ${found.ref}: ${note}`]).catch(() => {});
    }
    res.json({ ok: true, accepted });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not accept it" });
  }
});

kycRequestRouter.post(["/api/aml/deal/:id/client-checks", "/api/client-kyc/:companyId/subjects/:entity/client-checks"], signedIn, async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    if (!clientChecksOn()) return res.status(410).json({ message: CHECKS_OFF });
    const parsed = clientCheckBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the form and try again" });
    const scope = scopeOf(req);
    if (scope.client && parsed.data.companyId !== scope.client.companyId) return res.status(400).json({ message: "Those checks are not about this company." });
    // A client file's agents are BGP's client's own, never through an agent.
    if (scope.client && parsed.data.viaAgent) return res.status(400).json({ message: "BGP acts for this client: send the checks to them, not through an agent." });
    const result = await createClientCheck(scope.dealId, parsed.data, me, scope.client ? { entityId: scope.client.entityId } : {});
    res.json(result);
  } catch (err: any) {
    res.status(err?.status || 500).json({ message: err?.message || "Could not send the client checks", ...(err?.code ? { code: err.code } : {}) });
  }
});

kycRequestRouter.post("/api/aml/client-checks/:token/remind", signedIn, async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    if (!clientChecksOn()) return res.status(410).json({ message: CHECKS_OFF });
    const row = await tokenRow(String(req.params.token));
    if (!row || !row.request || row.is_test) return res.status(404).json({ message: "Request not found" });
    if (closedReason(row) || row.completed_at) return res.status(409).json({ message: "That request is finished, cancelled or has run out. Send a new one." });
    const sent = await sendReminder(row, me.name);
    if (!sent.ok) return res.status(502).json({ message: `The reminder was not sent: ${sent.error}` });
    res.json({ ok: true, from: sent.from });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not send the reminder" });
  }
});

kycRequestRouter.delete("/api/aml/client-checks/:token", signedIn, async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: STAFF_ONLY });
    const row = await tokenRow(String(req.params.token));
    if (!row || !row.request || row.is_test) return res.status(404).json({ message: "Request not found" });
    await pool.query(`UPDATE kyc_upload_tokens SET revoked_at = now() WHERE token = $1 AND revoked_at IS NULL`, [row.token]);
    if (row.company_id) await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'client_checks_cancelled', $2, $3)`,
      [row.company_id, me.name || me.id, `Request ${row.request.ref} to ${row.contact_email} cancelled`]).catch(() => {});
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not cancel the request" });
  }
});

// Read the KYC mailbox now (the timer does it every 15 minutes).
kycRequestRouter.post("/api/aml/poll-mailbox", adminOnly, async (_req: Request, res: Response) => {
  try { res.json(await pollKycMailbox()); }
  catch (err: any) { res.status(500).json({ message: err?.message }); }
});

// ── The client's page (public: the token is the key) ───────────────────────

async function openRow(req: Request, res: Response): Promise<TokenRow | null> {
  const row = await tokenRow(String(req.params.token));
  const reason = closedReason(row);
  if (reason) {
    res.status(410).json({ message: reason, agents: (await primeAmlContact(), amlContact(row?.request?.agents?.slice(0, 2))) });
    return null;
  }
  return row;
}

kycRequestRouter.get("/api/kyc-upload/:token", async (req: Request, res: Response) => {
  try {
    res.set("Cache-Control", "no-store");
    const row = await openRow(req, res);
    if (!row) return;
    if (!row.request!.openedAt) {
      // Only that key: a file's reading may be saved on the request meanwhile.
      row.request!.openedAt = new Date().toISOString();
      await pool.query(`UPDATE kyc_upload_tokens SET request = jsonb_set(request, '{openedAt}', to_jsonb($2::text)) WHERE token = $1 AND request->>'openedAt' IS NULL`,
        [row.token, row.request!.openedAt]);
    }
    res.json(await portalView(row));
  } catch (err: any) {
    res.status(500).json({ message: "Something went wrong. Please try again in a minute." });
  }
});

kycRequestRouter.post("/api/kyc-upload/:token/file", portalUpload, async (req: Request, res: Response) => {
  try {
    const row = await openRow(req, res);
    if (!row) return;
    const file = (req as any).file as { originalname: string; mimetype: string; buffer: Buffer } | undefined;
    if (!file?.buffer?.length) return res.status(400).json({ message: "Choose a file to upload." });
    // A joint agent may send a zip of its checks (22 November 2026): each file in it is filed.
    if (isJointRequest(row.request) && /\.zip$/i.test(file.originalname)) {
      const keep = await jointZipFiles(file.originalname, file.mimetype, file.buffer);
      if (!keep.length) return res.status(400).json({ message: "Nothing in that zip could be read. Please send PDFs, photos or Word documents." });
      const held = (await pool.query(`SELECT count(*)::int AS n FROM kyc_upload_files WHERE token = $1`, [row.token])).rows[0].n;
      if (held + keep.length > KYC_MAX_FILES_PER_REQUEST) return res.status(409).json({ message: "That's more files than this link takes. Please email the rest to your contact." });
      for (const f of keep) await fileClientDocument(row, f, null, "Uploaded on the joint agent's page (from a zip)");
      return res.json(await portalView((await tokenRow(row.token))!));
    }
    if (!kycUploadAllowed(file.originalname, file.mimetype)) {
      return res.status(400).json({ message: "That type of file can't be uploaded. Please send a PDF, a photo (JPG, PNG or HEIC) or a Word document." });
    }
    const count = (await pool.query(`SELECT count(*)::int AS n FROM kyc_upload_files WHERE token = $1`, [row.token])).rows[0].n;
    if (count >= KYC_MAX_FILES_PER_REQUEST) return res.status(409).json({ message: "That's the most files this link takes. Please email anything else to your contact." });
    const key = String(req.body?.docKey || "");
    const docKey = isKycDocKey(key) ? key : null;
    await fileClientDocument(row, { name: file.originalname, mime: file.mimetype, buffer: file.buffer }, docKey, "Uploaded on the client checks page");
    res.json(await portalView((await tokenRow(row.token))!));
  } catch (err: any) {
    console.error(`[kyc] upload failed: ${err?.message}`);
    res.status(500).json({ message: "The upload didn't work. Please try again." });
  }
});

kycRequestRouter.post("/api/kyc-upload/:token/id-check", async (req: Request, res: Response) => {
  let isTest = false;
  try {
    const row = await openRow(req, res);
    if (!row) return;
    isTest = !!row.is_test;
    const request = row.request!;
    if (!request.needsIdCheck) return res.status(400).json({ message: "No identity check is needed on this request." });
    if (row.is_test && !veriffConfigured()) return res.json({ url: null, test: true });
    const session = await latestSession(request);
    const state = kycIdStateFor(session?.status);
    if (session?.verification_url && (state === "not_started" || state === "started" || state === "retry")) return res.json({ url: session.verification_url });
    const otherPerson = idPersonOf(row, session).isThePerson === false;
    if ((state === "approved" || state === "submitted") && !otherPerson) return res.status(409).json({ message: "Your identity check is done. Thank you." });
    if (session && request.veriffSessionIds.length >= MAX_ID_SESSIONS) {
      return res.status(409).json({ message: "The identity check can't be started again from here. Please contact your agent." });
    }
    // Sent through the party's agent with nobody named (23 November 2026):
    // who is doing the check, so it is set against the right person.
    if (request.viaAgent && !String(row.contact_name || "").trim()) {
      const name = String(req.body?.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (name.split(" ").length < 2) return res.status(400).json({ message: "Enter your full name first." });
      await pool.query(`UPDATE kyc_upload_tokens SET contact_name = $2 WHERE token = $1 AND COALESCE(contact_name, '') = ''`, [row.token, name]);
      row.contact_name = (await tokenRow(row.token))?.contact_name || name;
    }
    const started = await startIdSession(row, request);
    res.json({ url: started.url });
  } catch (err: any) {
    console.error(`[kyc] identity check start failed: ${err?.message}`);
    // A test page is BGP's own: it shows the tester what Veriff said, so a
    // setting can be fixed. A client sees the plain message.
    res.status(502).json({ message: isTest
      ? `Test page: Veriff did not start the check (${String(err?.message || "no reason given").slice(0, 300)}).`
      : "The identity check couldn't be started just now. Please try again in a few minutes." });
  }
});

// The client's answer to the question about public roles. A yes or a not
// sure goes on the party's KYC trail for the MLRO (enhanced due diligence).
kycRequestRouter.post("/api/kyc-upload/:token/answers", async (req: Request, res: Response) => {
  try {
    const row = await openRow(req, res);
    if (!row) return;
    const request = row.request!;
    if (!request.askPep) return res.status(400).json({ message: "There's no question on this request." });
    const pep = req.body?.pep;
    if (!isKycPepAnswer(pep)) return res.status(400).json({ message: "Choose No, Yes or Not sure." });
    const pepDetail = pep === "no" ? null : String(req.body?.pepDetail || "").trim().slice(0, 1000) || null;
    request.answers = { pep, pepDetail, answeredAt: new Date().toISOString() };
    await saveRequest(row.token, request);
    // A yes or a not sure is a red flag: the agents hear at once, without
    // the client's page waiting for the email.
    if (pep !== "no") {
      import("./kyc-red-flags").then(m => m.alertRedFlags(row.token))
        .catch((e: any) => console.warn(`[kyc] red flag alert for ${request.ref} failed: ${e?.message}`));
    }
    if (row.company_id && !row.is_test) {
      await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'client_pep_declaration', $2, $3)`,
        [row.company_id, row.contact_name || row.contact_email, `Asked about public roles (ref ${request.ref}): ${kycPepWords(pep)}${pepDetail ? `. ${pepDetail}` : ""}${pep === "no" ? "" : ". Enhanced due diligence: MLRO approval, source of wealth and funds."}`]).catch(() => {});
    }
    res.json(await portalView((await tokenRow(row.token))!));
  } catch (err: any) {
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

// The client's reply about the owners Companies House lists. A "no" is a
// difference from the register: it goes on the party's KYC trail, and the
// agents see it on the deal and in the finished note (HMRC, AMLG11400 14.8:
// report it to Companies House).
kycRequestRouter.post("/api/kyc-upload/:token/owners", async (req: Request, res: Response) => {
  try {
    const row = await openRow(req, res);
    if (!row) return;
    const request = row.request!;
    if (!request.confirmOwners?.length) return res.status(400).json({ message: "There's no list of owners on this request." });
    const answer = req.body?.answer;
    if (!isKycOwnersAnswer(answer)) return res.status(400).json({ message: "Choose Yes or No." });
    const detail = answer === "no" ? String(req.body?.detail || "").trim().slice(0, 2000) || null : null;
    if (answer === "no" && !detail) return res.status(400).json({ message: KYC_OWNERS_QUESTION.no });
    request.ownersAnswer = { answer, detail, answeredAt: new Date().toISOString() };
    await saveRequest(row.token, request);
    if (row.company_id && !row.is_test) {
      await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'client_owners_confirmation', $2, $3)`,
        [row.company_id, row.contact_name || row.contact_email, `Owners on the register (ref ${request.ref}): ${kycOwnersWords(answer)}${detail ? `. ${detail}` : ""}${answer === "no" ? ". A difference from the register: report it to Companies House." : ""}`]).catch(() => {});
    }
    res.json(await portalView((await tokenRow(row.token))!));
  } catch (err: any) {
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

// The person acting gives an owner their own link: shown to copy, or emailed
// to the address they type (a few times a day at most). Owners only, never
// themselves; the link asks only what is still outstanding for that owner.
kycRequestRouter.post("/api/kyc-upload/:token/people", async (req: Request, res: Response) => {
  try {
    const row = await openRow(req, res);
    if (!row) return;
    const request = row.request!;
    if (row.is_test || request.person || isJointRequest(request) || request.kind !== "company" || !row.company_id) {
      return res.status(400).json({ message: "There's no one to pass a link to from this page." });
    }
    if (!clientChecksOn()) return res.status(409).json({ message: "Please ask your contact at Bruce Gillingham Pollard to send it." });
    const key = String(req.body?.key || "").slice(0, 300);
    const email = String(req.body?.email || "").trim().slice(0, 200);
    const result = await createPersonCheck(row.deal_id, { companyId: row.company_id, key, email: email || null, send: !!email }, { client: row }, { entityId: row.trading_entity_id || null });
    if (result.sent && !result.sent.ok) return res.status(502).json({ message: "The email didn't go. Copy the link and send it yourself, or try again later.", link: result.link });
    res.json({ link: result.link, emailed: !!result.sent?.ok, view: await portalView((await tokenRow(row.token))!) });
  } catch (err: any) {
    const status = Number(err?.status) || 500;
    res.status(status).json({ message: status < 500 ? err.message : "Something went wrong. Please try again." });
  }
});

// Through the party's own agent (23 November 2026): the agent passes the
// checks on to someone at the party from the page. Emailed from the KYC
// mailbox with the same link, copying the agent and BGP's agents; three times
// a day at most and not twice in two minutes. What the agent types is kept on
// the request only, never in the CRM. Until an identity check has started,
// the person it is passed on to is the person who does it.
kycRequestRouter.post("/api/kyc-upload/:token/pass-on", async (req: Request, res: Response) => {
  try {
    const row = await openRow(req, res);
    if (!row) return;
    const request = row.request!;
    const via = request.viaAgent;
    if (row.is_test || !via || request.person || isJointRequest(request)) return res.status(400).json({ message: "There's no one to pass this on to from this page." });
    if (row.completed_at) return res.status(409).json({ message: "These checks are finished." });
    if (!clientChecksOn()) return res.status(409).json({ message: "Please ask your contact at Bruce Gillingham Pollard to send it." });
    const name = String(req.body?.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const email = cleanEmail(String(req.body?.email || "").slice(0, 200));
    if (name.split(" ").length < 2) return res.status(400).json({ message: "Enter their full name." });
    if (!isEmail(email)) return res.status(400).json({ message: "Enter a valid email address." });
    if (email.endsWith(STAFF_DOMAIN)) return res.status(400).json({ message: "That is a Bruce Gillingham Pollard address: enter your client's." });
    const recent = (request.clientSends || []).filter(t => Date.now() - Date.parse(t) < 86400000);
    if (recent.length >= CLIENT_SENDS_A_DAY) return res.status(429).json({ message: "This has been sent three times today. Forward our email to them instead." });
    const last = recent[recent.length - 1];
    if (last && Date.now() - Date.parse(last) < CLIENT_SEND_GAP_MS) return res.status(429).json({ message: "Just sent. Give it a couple of minutes before sending it again." });
    const session = request.needsIdCheck ? await latestSession(request) : null;
    const person = !String(row.contact_name || "").trim() || !session ? name : row.contact_name;
    const link = kycLinkFor(row.token);
    const sent = await sendKycEmail({
      to: [email], cc: [cleanEmail(row.contact_email), ...request.cc], test: !!row.is_test,
      build: sentFrom => kycRequestEmail({
        recipientName: name, partyName: request.partyName, kind: request.kind, dealName: request.dealName, ref: request.ref, link,
        expiresAt: row.expires_at, needsIdCheck: request.needsIdCheck, docs: request.docs, note: request.note, noteFrom: request.sentBy?.name || null, agents: amlContact(request.agents), sentFrom,
        askPep: !!request.askPep, confirmOwners: request.confirmOwners, ownerNames: request.ownerNames, ownersAbroad: request.ownersAbroad,
        ownLinksFor: (request.ownLinksFor || []).map(o => o.name), passedOnBy: { name: via.name, firm: via.firm },
      }),
    });
    if (!sent.ok) return res.status(502).json({ message: "The email didn't go. Forward our email to them instead, or try again later." });
    const at = new Date().toISOString();
    request.clientSends = [...recent, at];
    request.viaAgent = { ...via, passedOn: [...(via.passedOn || []), { name, email, at }] };
    await pool.query(`UPDATE kyc_upload_tokens SET contact_name = $2, request = $3::jsonb WHERE token = $1`, [row.token, person, JSON.stringify(request)]);
    if (row.company_id) {
      await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'client_checks_passed_on', $2, $3)`,
        [row.company_id, `${via.name} of ${via.firm}`, `Passed the checks on to ${name} <${email}> (ref ${request.ref}), from ${sent.from}`]).catch(() => {});
    }
    res.json(await portalView((await tokenRow(row.token))!));
  } catch (err: any) {
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

// The joint agent agrees to BGP relying on its checks (22 November 2026: a
// letting at £10,000 a month or more; MLR 2017 reg 39). Kept on the request
// with who agreed and when; the officers then record the reliance on the
// deal (server/deal-party-aml.ts, with this request's reference).
kycRequestRouter.post("/api/kyc-upload/:token/reliance", async (req: Request, res: Response) => {
  try {
    const row = await openRow(req, res);
    if (!row) return;
    const request = row.request!;
    if (!isJointRequest(request) || !request.jointAgent) return res.status(400).json({ message: "There are no reliance terms on this page." });
    const said = jointRelianceInput(req.body || {}, request.jointAgent.firm);
    if (!said.ok) return res.status(400).json({ message: said.message });
    request.jointAgent = { ...request.jointAgent, reliance: said.value };
    // Only that key: a file's reading may be saved on the request meanwhile.
    await pool.query(`UPDATE kyc_upload_tokens SET request = jsonb_set(request, '{jointAgent,reliance}', $2::jsonb) WHERE token = $1`, [row.token, JSON.stringify(said.value)]);
    if (row.company_id && !row.is_test) {
      await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'joint_agent_reliance_agreed', $2, $3)`,
        [row.company_id, said.value.name, `${said.value.name}${said.value.position ? `, ${said.value.position},` : ""} of ${said.value.firm} agreed to BGP relying on its checks on ${request.partyName} (ref ${request.ref}; supervised by ${said.value.supervisor}${said.value.registration ? `, ${said.value.registration}` : ""})`]).catch(() => {});
    }
    res.json(await portalView((await tokenRow(row.token))!));
  } catch (err: any) {
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

kycRequestRouter.post("/api/kyc-upload/:token/finish", async (req: Request, res: Response) => {
  try {
    const row = await openRow(req, res);
    if (!row) return;
    await finishRequest(row);
    res.json(await portalView((await tokenRow(row.token))!));
  } catch (err: any) {
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

// ── Admin: see every email, and send each one to yourself ──────────────────

const SAMPLE = { dealName: "12 Example Street (sample)", partyName: "Example Trading Ltd", recipientName: "Jane Smith" };
const SAMPLE_RED_FLAGS: KycRedFlag[] = [
  { kind: "client_pep", label: "Said yes to the question about public roles", detail: "My father is a serving member of a foreign parliament.", source: "Client checks, ref 7K2Q9M", at: null, key: "client_pep:7k2q9m", evidence: ["answer:yes"] },
];

async function adminMe(req: Request) {
  const id = (req.session as any)?.userId || (req as any).tokenUserId;
  const r = await pool.query(`SELECT id, name, email, phone FROM users WHERE id = $1`, [id]);
  return r.rows[0] as { id: string; name: string | null; email: string | null; phone: string | null } | undefined;
}

export function kycPreviews(agent: KycAgent, now = new Date()) {
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_DAYS * 86400000);
  const link = `${LINK_BASE}/kyc-upload/sample`;
  const base = { recipientName: SAMPLE.recipientName, partyName: SAMPLE.partyName, dealName: SAMPLE.dealName, ref: "7K2Q9M", link, expiresAt, agents: [agent], sentFrom: KYC_MAILBOX, askPep: true };
  const veriff = veriffConfigured();
  const company = kycRequestEmail({ ...base, kind: "company", needsIdCheck: veriff, docs: defaultKycDocs("company", "tenant", veriff), note: "Thanks for your help with this. Any questions, just call me." });
  const individual = kycRequestEmail({ ...base, kind: "individual", needsIdCheck: veriff, docs: defaultKycDocs("individual", "purchaser", veriff), note: null });
  const reminder = kycReminderEmail({ ...base, kind: "company", needsIdCheck: true, docs: ["ownership", "owner_ids", "authority"], progress: { idDone: true, docsDone: ["ownership"], pepAnswered: true } });
  const idCheck = kycIdCheckEmail({ recipientName: SAMPLE.recipientName, partyName: SAMPLE.partyName, kind: "company", dealName: SAMPLE.dealName, link: "https://example.veriff.me/v/sample", agents: [agent], sentFrom: KYC_MAILBOX });
  const finished = kycFinishedEmail({ recipientName: SAMPLE.recipientName, partyName: SAMPLE.partyName, dealName: SAMPLE.dealName, ref: "7K2Q9M", dealLink: LINK_BASE, idState: "approved",
    files: [{ name: "ownership-structure.pdf", docKey: "ownership" }, { name: "passport-john-smith.jpg", docKey: "owner_ids" }], missing: [], sentFrom: KYC_MAILBOX, kind: "company", pep: "no", pepDetail: null });
  const redFlag = kycRedFlagEmail({ partyName: SAMPLE.partyName, recipientName: SAMPLE.recipientName, dealName: SAMPLE.dealName, ref: "7K2Q9M", dealLink: LINK_BASE,
    flags: SAMPLE_RED_FLAGS, sentFrom: KYC_MAILBOX });
  // Through the other side's agent, to pass on (23 November 2026).
  const viaAgent = kycViaAgentRequestEmail({ ...base, recipientName: "Sam Agent", kind: "company", needsIdCheck: veriff, docs: defaultKycDocs("company", "tenant", veriff), note: null,
    agentFirm: "Knight Frank", partyRole: "tenant", clientRole: "landlord", clientName: "Example Estates Ltd", personName: null });
  return [
    { kind: "request_company", title: "Request to a company's contact", to: "The person dealing for the party", ...company },
    { kind: "request_individual", title: "Request to a private individual", to: "The person", ...individual },
    { kind: "request_via_agent", title: "Request through the other side's agent", to: "The party's own agent, to pass on to their client", ...viaAgent },
    { kind: "reminder", title: "Reminder (3 and 7 days on)", to: "The person, while anything is outstanding", ...reminder },
    { kind: "finished", title: "To the agents when the client finishes", to: "The deal's agents and whoever sent it", ...finished },
    { kind: "id_check", title: "Identity check on its own", to: "One person, from a company's record", ...idCheck },
    { kind: "red_flag", title: "Red flag: enhanced checks by the officers", to: "The deal's agents, the moment a client's answer or identity check raises one", ...redFlag },
  ];
}

kycRequestRouter.get("/api/admin/kyc-emails", adminOnly, async (req: Request, res: Response) => {
  try {
    const me = await adminMe(req);
    const agent: KycAgent = { name: me?.name || "Your name", email: me?.email || null, phone: me?.phone || null };
    const logo = kycLogoBase64();
    const withLogo = (html: string) => logo ? html.split(`cid:${KYC_LOGO_CID}`).join(`data:image/png;base64,${logo}`) : html;
    res.json({
      mailbox: KYC_MAILBOX,
      // The addresses after the KYC mailbox, in the order they are tried.
      fallback: senderOrder([KYC_MAILBOX], Number.POSITIVE_INFINITY, { appMailbox: false }).slice(1).join(", then "),
      clientChecks: clientChecksOn(),
      veriff: veriffConfigured(),
      previews: kycPreviews(agent).map(p => ({ ...p, html: withLogo(p.html) })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not build the previews" });
  }
});

// Sends one email to the admin who pressed it, and nobody else. The request
// and the reminder carry a real test link: the client page opens on it,
// uploads are recorded by name only, and Finish sends the agents' note back
// to the same admin. Works whether in-app AML is on or off.
// The request can instead go to one colleague, to try the page as a client
// would (Woody, 17 November 2026: a test for Jack to do KYC for Bruce
// Gillingham Pollard Ltd): an active BGP login only, never an outside
// address, copied to the admin as the agent, who gets the Finished note and
// any red-flag alert. The party being checked can be named; it is only
// words on the test.
kycRequestRouter.post("/api/admin/kyc-emails/test", adminOnly, async (req: Request, res: Response) => {
  try {
    const kind = String(req.body?.kind || "");
    if (!["request", "reminder", "finished", "id_check", "red_flag"].includes(kind)) return res.status(400).json({ message: "Unknown email" });
    const me = await adminMe(req);
    const email = cleanEmail(me?.email);
    if (!me || !isEmail(email)) return res.status(400).json({ message: "Your login has no email address to send to." });
    const agent: KycAgent = { name: me.name || "BGP", email: me.email, phone: me.phone };
    const veriff = veriffConfigured();
    const toUserId = typeof req.body?.toUserId === "string" ? req.body.toUserId.trim() : "";
    let colleague: { name: string | null; email: string } | null = null;
    if (toUserId && toUserId !== me.id) {
      if (kind !== "request") return res.status(400).json({ message: "Only the request can be sent to a colleague." });
      const found = (await pool.query(`SELECT name, email FROM users WHERE id = $1 AND is_active IS NOT FALSE`, [toUserId])).rows[0];
      const address = cleanEmail(found?.email);
      if (!found || !isEmail(address) || !address.endsWith(STAFF_DOMAIN)) return res.status(400).json({ message: "A test goes only to a colleague with an active BGP login." });
      colleague = { name: found.name || null, email: address };
    }
    const recipient = colleague || { name: me.name, email };
    let link = "";
    let cc: string[] = [];
    let sent: KycSendResult;
    if (kind === "request" || kind === "reminder") {
      const partyKind: KycPartyKind = req.body?.partyKind === "individual" ? "individual" : "company";
      const partyName = String(req.body?.partyName ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || SAMPLE.partyName;
      cc = colleague ? [email] : [];
      const token = crypto.randomBytes(32).toString("base64url");
      const ref = await newRef();
      const expiresAt = new Date(Date.now() + 2 * 86400000);
      const request: KycRequestDetails = {
        ref, kind: partyKind, role: "tenant", partyName, dealName: SAMPLE.dealName,
        needsIdCheck: true, docs: defaultKycDocs(partyKind, "tenant", true), note: veriff ? "This is a test request. Try the page as a client would: the identity check is a real one, run by Veriff." : "This is a test request. Try the page as a client would.",
        mobile: null, agents: [agent], cc, sentBy: { id: me.id, name: me.name }, sentFrom: null, sentAt: null, sendError: null,
        openedAt: null, veriffSessionIds: [], idCheckNote: veriff ? null : "The identity check is not set up, so the test shows the step only.",
        askPep: true, answers: null,
      };
      await pool.query(
        `INSERT INTO kyc_upload_tokens (token, deal_id, contact_email, contact_name, created_by, expires_at, request, is_test)
         VALUES ($1, 'test', $2, $3, $4, $5, $6, true)`,
        [token, recipient.email, recipient.name || "Test", me.id, expiresAt, JSON.stringify(request)],
      );
      link = kycLinkFor(token);
      const ctx = { recipientName: recipient.name, partyName, kind: partyKind, dealName: SAMPLE.dealName, ref, link, expiresAt,
        needsIdCheck: true, docs: request.docs, note: request.note, agents: [agent], test: true, testBy: colleague ? (me.name || "A BGP admin") : null, askPep: true };
      sent = await sendKycEmail({
        to: [recipient.email],
        cc, test: true,
        build: sentFrom => kind === "request"
          ? kycRequestEmail({ ...ctx, sentFrom })
          : kycReminderEmail({ ...ctx, sentFrom, progress: { idDone: true, docsDone: [request.docs[0]], pepAnswered: true } }),
      });
      if (sent.ok) {
        request.sentAt = new Date().toISOString();
        request.sentFrom = sent.from;
        await saveRequest(token, request);
      }
    } else if (kind === "finished") {
      sent = await sendKycEmail({
        to: [email], test: true,
        build: sentFrom => kycFinishedEmail({ recipientName: SAMPLE.recipientName, partyName: SAMPLE.partyName, dealName: SAMPLE.dealName, ref: "7K2Q9M", dealLink: LINK_BASE, idState: "approved",
          files: [{ name: "ownership-structure.pdf", docKey: "ownership" }, { name: "passport.jpg", docKey: "owner_ids" }], missing: [], sentFrom, test: true, kind: "company", pep: "no", pepDetail: null }),
      });
    } else if (kind === "red_flag") {
      sent = await sendKycEmail({
        to: [email], test: true,
        build: sentFrom => kycRedFlagEmail({ partyName: SAMPLE.partyName, recipientName: SAMPLE.recipientName, dealName: SAMPLE.dealName, ref: "7K2Q9M", dealLink: LINK_BASE,
          flags: SAMPLE_RED_FLAGS, sentFrom, test: true }),
      });
    } else {
      sent = await sendKycEmail({
        to: [email], test: true,
        build: sentFrom => kycIdCheckEmail({ recipientName: me.name, partyName: SAMPLE.partyName, kind: "company", dealName: SAMPLE.dealName, link: `${LINK_BASE}/kyc-upload/sample`, agents: [agent], sentFrom, test: true }),
      });
    }
    // A failed send still hands back the test page's link, so the page can
    // be tried while the mailbox is being set up.
    res.json({ ok: sent.ok, error: sent.ok ? null : sent.error, to: recipient.email, cc, from: sent.from, fellBack: sent.fellBack, firstError: sent.fellBack ? sent.error : null, link: link || null });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not send the test" });
  }
});

export default kycRequestRouter;

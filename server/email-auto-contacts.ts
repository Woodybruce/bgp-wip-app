// Keep the email, save the person (Woody, 2026-09-29: "keep emails — should
// assume that if someone is emailing us they are a worthwhile CRM").
//
// The mailbox sync only filed an email when a participant was already a saved
// CRM contact (crm_interactions.contact_id is NOT NULL), so correspondence
// with firms nobody had saved was dropped — the app never saw that BGP was
// working for Ares Management on The Royal Exchange because no one at
// aresmgmt.com was a contact. Now the external people on a real
// correspondence email become contacts, filed under their company by email
// domain, and the email is stored against them as normal.
//
// Real correspondence only: drafts, junk, calendar traffic, automated
// senders (no-reply, notifications, mailing platforms), bulk mail (list /
// precedence / auto-submitted headers), mail that reached BGP only by BCC or
// through a list, and anything sent to more than MAX_EXTERNAL_RECIPIENTS
// outside people are skipped. BGP's own domains and staff never qualify.
import type { Querier } from "./account-resolver";
import { GENERIC_EMAIL_DOMAINS, INTERNAL_DOMAIN_RE, emailDomain } from "./tracker-correspondence";
import { isGenericMailbox, placeholderNamesFor } from "./signature-contact-sync";
import { realSenderName } from "./email-signature-enrich";

export const AUTO_CONTACT_SOURCE = "email-sync";
export const MAX_EXTERNAL_RECIPIENTS = 15;

const FREE_MAIL_DOMAINS = new Set([
  ...GENERIC_EMAIL_DOMAINS,
  "hotmail.fr", "outlook.co.uk", "mac.com", "sky.com", "virginmedia.com", "blueyonder.co.uk", "ntlworld.com",
  "talktalk.net", "aol.co.uk", "ymail.com", "rocketmail.com", "protonmail.com", "proton.me", "pm.me", "gmx.com",
  "gmx.co.uk", "gmx.de", "mail.com", "tiscali.co.uk", "orange.fr", "free.fr", "web.de", "qq.com", "163.com",
]);

const AUTOMATED_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|noreply|mailer-?daemon|postmaster|bounces?|notifications?|notify|alerts?|news|newsletters?|marketing|mailer|mailings?|updates?|digest|calendar|invites?|invitations?|automated|automailer|system|daemon|unsubscribe|feedback|surveys?|reply|receipts?|billing|invoices?|orders?|e-?news|comms|communications|messages-noreply|jobs-listings|security|verify|verification)([+._-].*)?$/i;
const AUTOMATED_ANYWHERE = /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|noreply|bounces?|mailer-daemon)([._+-]|$)/i;

// Mail and notification platforms: nobody at these addresses is a
// correspondent (suffix match, so em.mailchimp.com etc. count).
const PLATFORM_DOMAINS = [
  "mailchimp.com", "mcsv.net", "mcdlv.net", "list-manage.com", "mandrillapp.com", "sendgrid.net", "sendgrid.com",
  "amazonses.com", "mailgun.org", "mailgun.net", "sparkpostmail.com", "hubspotemail.net", "hs-email.net",
  "exacttarget.com", "marketingcloudapps.com", "mktomail.com", "createsend.com", "cmail19.com", "cmail20.com",
  "constantcontact.com", "ccsend.com", "mailjet.com", "sendinblue.com", "brevo.com", "klaviyomail.com",
  "emarsys.net", "dotdigital.com", "dotmailer.com", "pardot.com", "mailerlite.com", "substack.com", "beehiiv.com",
  "linkedin.com", "facebookmail.com", "docusign.net", "echosign.com", "adobesign.com", "calendly.com",
  "eventbrite.com", "zoom.us", "typeform.com", "surveymonkey.com", "zendesk.com", "freshdesk.com",
  "intercom-mail.com", "atlassian.net", "slack.com", "github.com", "microsoftonline.com", "sharepointonline.com",
  "pipdistribution.co.uk",
];
// A sending subdomain (email.brand.com, news.retailweek.com, e.shop.co.uk).
const SENDING_SUBDOMAIN = /^(email|e|em|mail|mailer|mailing|mailings|news|newsletter|newsletters|marketing|mkt|go|click|comms|communications|updates|notification|notifications|alerts|bounce|bounces|reply|send|mg|mta|t|trk|track|crm)\./i;

const VALID_EMAIL = /^[^\s@<>()"',;:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function normaliseAddress(value: unknown): string | null {
  const s = String(value || "").trim().toLowerCase();
  return VALID_EMAIL.test(s) ? s : null;
}

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  return !!domain && FREE_MAIL_DOMAINS.has(domain.toLowerCase());
}

export function isInternalAddress(email: string, staffEmails: Set<string> = new Set()): boolean {
  const e = email.toLowerCase();
  const domain = emailDomain(e) || "";
  return INTERNAL_DOMAIN_RE.test(domain) || domain === "bgp.uk.com" || domain.endsWith(".bgp.uk.com") || staffEmails.has(e);
}

/** Why an address is a system rather than a person (null = could be a person). */
export function automatedAddressReason(email: string): string | null {
  const e = email.toLowerCase();
  const at = e.lastIndexOf("@");
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (AUTOMATED_LOCAL.test(local) || AUTOMATED_ANYWHERE.test(local)) return `automated address (${local}@)`;
  if (local.includes("=") || /^[a-z0-9]{28,}$/.test(local) || /^[0-9a-f-]{20,}$/.test(local)) return "machine-generated address";
  if (PLATFORM_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`))) return `mail platform (${domain})`;
  if (domain.split(".").length >= 3 && SENDING_SUBDOMAIN.test(domain)) return `sending subdomain (${domain})`;
  return null;
}

type Header = { name?: string; value?: string };

/** Why the message headers mark bulk / automated mail (null = looks personal). */
export function bulkHeaderReason(headers: Header[] | null | undefined): string | null {
  const h = new Map<string, string>();
  for (const x of headers || []) if (x?.name) h.set(x.name.toLowerCase(), String(x.value || ""));
  if (h.has("list-unsubscribe") || h.has("list-unsubscribe-post")) return "List-Unsubscribe";
  if (h.has("list-id")) return "List-Id";
  if (/^(bulk|list|junk)$/i.test((h.get("precedence") || "").trim())) return `Precedence: ${h.get("precedence")!.trim()}`;
  const auto = (h.get("auto-submitted") || "").trim();
  if (auto && !/^no$/i.test(auto)) return `Auto-Submitted: ${auto}`;
  if (/\b(all|oof|autoreply)\b/i.test(h.get("x-auto-response-suppress") || "")) return "X-Auto-Response-Suppress";
  if (h.has("x-autoreply") || h.has("x-autorespond")) return "auto-reply";
  for (const name of h.keys()) {
    if (/^(x-mc-user|x-mailchimp|x-mandrill|x-sg-eid|x-sg-id|x-sendgrid|x-mailgun|x-ses-outgoing|x-campaign|x-hs-|x-hubspot|x-sfmc|x-marketo|x-mailjet|x-sib-|x-csa-complaints|feedback-id)/.test(name)) {
      return `mail platform header (${name})`;
    }
  }
  if (/mailchimp|sendgrid|hubspot|marketo|mailjet|sendinblue|constant ?contact|campaign ?monitor|dotdigital/i.test(h.get("x-mailer") || "")) {
    return `X-Mailer: ${h.get("x-mailer")}`;
  }
  return null;
}

const CALENDAR_SUBJECT = /^(accepted|declined|tentative|tentatively accepted|canceled|cancelled|updated invitation|invitation|new time proposed|meeting forward notification)\s*(:|\b)/i;

export interface SyncedMessage {
  id: string;
  subject?: string | null;
  receivedDateTime?: string | null;
  isDraft?: boolean | null;
  parentFolderId?: string | null;
  "@odata.type"?: string;
  from?: { emailAddress?: { name?: string; address?: string } } | null;
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[] | null;
  ccRecipients?: { emailAddress?: { name?: string; address?: string } }[] | null;
}

export interface MailParticipant { email: string; name: string }
export interface AutoContactPlan {
  eligible: boolean;
  reason?: string;
  inbound: boolean;
  externals: MailParticipant[];
  unknown: MailParticipant[];
}

/** Which unknown external people on this message should become contacts. */
export function planMessage(msg: SyncedMessage, ctx: {
  isKnown: (email: string) => boolean;
  staffEmails?: Set<string>;
  junkFolderId?: string | null;
}): AutoContactPlan {
  const staff = ctx.staffEmails || new Set<string>();
  const from = normaliseAddress(msg.from?.emailAddress?.address);
  const inbound = !!from && !isInternalAddress(from, staff);
  const none = (reason: string): AutoContactPlan => ({ eligible: false, reason, inbound, externals: [], unknown: [] });
  if (msg.isDraft) return none("draft");
  if (ctx.junkFolderId && msg.parentFolderId === ctx.junkFolderId) return none("junk folder");
  if (/eventMessage/i.test(msg["@odata.type"] || "") || CALENDAR_SUBJECT.test((msg.subject || "").trim())) return none("calendar message");
  if (!from) return none("no sender");

  const seen = new Map<string, MailParticipant>();
  let internalRecipient = false;
  const add = (r: { emailAddress?: { name?: string; address?: string } } | null | undefined, recipient: boolean) => {
    const email = normaliseAddress(r?.emailAddress?.address);
    if (!email) return;
    if (isInternalAddress(email, staff)) { if (recipient) internalRecipient = true; return; }
    if (!seen.has(email)) seen.set(email, { email, name: String(r?.emailAddress?.name || "").trim() });
  };
  add(msg.from, false);
  for (const r of msg.toRecipients || []) add(r, true);
  for (const r of msg.ccRecipients || []) add(r, true);
  const externals = [...seen.values()];

  if (externals.length > MAX_EXTERNAL_RECIPIENTS) return none(`${externals.length} external recipients (distribution)`);
  // Inbound mail that names nobody at BGP reached the mailbox by BCC or a
  // list — a mailshot, not a conversation.
  if (inbound && !internalRecipient) return none("BGP not addressed (BCC / list)");
  if (inbound) {
    const why = automatedAddressReason(from);
    if (why) return none(`sender is ${why}`);
  }
  const unknown = externals.filter(p => !ctx.isKnown(p.email) && !automatedAddressReason(p.email));
  return { eligible: true, inbound, externals, unknown };
}

function titleWord(w: string): string {
  return w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1);
}

/** The registrable domain ("eur.cushwake.com" → "cushwake.com", "a.shw.co.uk" → "shw.co.uk"). */
export function registrableDomain(domain: string): string {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const sld = labels[labels.length - 2];
  const tld = labels[labels.length - 1];
  // Shared parents (tenant defaults, NHS trusts) where each subdomain is its own organisation.
  const shared = /^(onmicrosoft\.com|nhs\.net|amazonaws\.com|azurewebsites\.net|herokuapp\.com)$/.test(`${sld}.${tld}`);
  const keep = shared || (tld.length === 2 && /^(co|org|ac|gov|ltd|plc|net|com|me|sch|nhs|police)$/.test(sld)) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

/** Placeholder firm name from a domain ("hondo-enterprises.com" → "Hondo Enterprises", "jll.com" → "JLL"). */
export function companyNameFromDomain(domain: string): string {
  const label = registrableDomain(domain).split(".")[0] || domain;
  return label.split(/[-_]+/).filter(Boolean).map(titleWord).join(" ");
}

/** A person's name from "Display Name <email>", else from the address. */
export function contactNameFor(displayName: string, email: string): string {
  const real = realSenderName(displayName, email);
  if (real) return real;
  if (isGenericMailbox(email)) {
    const label = String(displayName || "").replace(/["']/g, "").replace(/\s+/g, " ").trim();
    if (label && !label.includes("@")) return label.slice(0, 200);
    const domain = emailDomain(email) || "";
    return `${companyNameFromDomain(domain)} (${email.split("@")[0]}@)`;
  }
  const oneWord = String(displayName || "").replace(/["']/g, "").trim();
  if (/^[\p{L}][\p{L}'-]{1,30}$/u.test(oneWord) && oneWord.toLowerCase() !== email.split("@")[0]) {
    return oneWord.charAt(0).toUpperCase() + oneWord.slice(1);
  }
  // The same shape the other auto-creators use, so signature enrichment
  // recognises it as a placeholder and fills the real name later.
  return placeholderNamesFor(email)[0] || email;
}

export function autoMarker(staffName: string, date: Date): string {
  return `Auto-added from email — ${staffName}, ${date.toISOString().slice(0, 10)}`;
}

// ── Database ──────────────────────────────────────────────────────────────
export type TxClient = Querier & { release(): void };
export type TxPool = Querier & { connect(): Promise<TxClient> };

const normSql = (col: string) =>
  `regexp_replace(regexp_replace(lower(trim(COALESCE(${col}, ''))), '^(https?://)?(www\\.)?', ''), '[/?#:].*$', '')`;

export interface DomainCompany { id: string; name: string }

/** The CRM company for an email domain: its domain / website fields, else a
 *  clear majority of the saved contacts with that domain. */
export async function findCompanyForDomain(q: Querier, domain: string): Promise<DomainCompany | null> {
  const d = domain.toLowerCase();
  const candidates = [...new Set([d, registrableDomain(d)])];
  const { rows } = await q.query(
    `SELECT id, name FROM crm_companies
      WHERE merged_into_id IS NULL
        AND (${normSql("domain")} = ANY($1::text[]) OR ${normSql("domain_url")} = ANY($1::text[]) OR ${normSql("website")} = ANY($1::text[]))
      ORDER BY (${normSql("domain")} = $2 OR ${normSql("domain_url")} = $2 OR ${normSql("website")} = $2) DESC,
               (parent_company_id IS NULL) DESC, created_at ASC NULLS LAST
      LIMIT 1`,
    [candidates, d]);
  if (rows[0]) return { id: rows[0].id, name: rows[0].name };
  const byPeople = await q.query(
    `SELECT c.company_id AS id, co.name, count(*)::int AS n
       FROM crm_contacts c JOIN crm_companies co ON co.id = c.company_id AND co.merged_into_id IS NULL
      WHERE c.email IS NOT NULL AND lower(split_part(trim(c.email), '@', 2)) = ANY($1::text[])
      GROUP BY c.company_id, co.name ORDER BY n DESC LIMIT 2`,
    [candidates]);
  const [top, next] = byPeople.rows;
  if (top && Number(top.n) >= 2 && (!next || Number(top.n) >= 3 * Number(next.n))) return { id: top.id, name: top.name };
  return null;
}

async function inTransaction<T>(pool: TxPool, lockKey: string, fn: (c: TxClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** The company for a business domain, creating a clearly-marked one (named
 *  from the domain, no type) when none has it. */
export async function ensureCompanyForDomain(pool: TxPool, domain: string, marker: string): Promise<DomainCompany & { created: boolean }> {
  const registrable = registrableDomain(domain);
  return inTransaction(pool, `email-auto-company:${registrable}`, async (c) => {
    const existing = await findCompanyForDomain(c, domain);
    if (existing) return { ...existing, created: false };
    const name = companyNameFromDomain(registrable);
    const { rows } = await c.query(
      `INSERT INTO crm_companies (name, domain, description, enrichment_source)
       VALUES ($1, $2, $3, $4) RETURNING id, name`,
      [name, registrable, `${marker}. Named from its ${registrable} email address — confirm the firm's name and type.`, AUTO_CONTACT_SOURCE]);
    return { id: rows[0].id, name: rows[0].name, created: true };
  });
}

export interface EnsuredContact { id: string; name: string; email: string; companyId: string | null; companyName: string | null; created: boolean }

/** The contact for this address (case-insensitive), created if nobody has it.
 *  Shares the contact-import lock with promote-sender / RocketReach so two
 *  creators can't add the same person at once. */
export async function ensureContactForEmail(pool: TxPool, input: {
  email: string; name: string; companyId: string | null; companyName: string | null; notes: string;
}): Promise<EnsuredContact> {
  const email = input.email.trim().toLowerCase();
  return inTransaction(pool, "rocketreach-contact-import", async (c) => {
    const found = await c.query(
      `SELECT id, name, email, company_id, company_name FROM crm_contacts
        WHERE lower(trim(email)) = $1 ORDER BY created_at ASC NULLS LAST LIMIT 1`, [email]);
    const f = found.rows[0];
    if (f) return { id: f.id, name: f.name, email, companyId: f.company_id || null, companyName: f.company_name || null, created: false };
    const { rows } = await c.query(
      `INSERT INTO crm_contacts (name, email, company_id, company_name, notes, enrichment_source)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.name.slice(0, 200), email, input.companyId, input.companyName, input.notes, AUTO_CONTACT_SOURCE]);
    return { id: rows[0].id, name: input.name, email, companyId: input.companyId, companyName: input.companyName, created: true };
  });
}

// ── Graph ─────────────────────────────────────────────────────────────────
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Header verdicts survive between hourly sweeps so a newsletter is only
// inspected once per process.
const bulkVerdicts = new Map<string, string | null>();
const junkFolderIds = new Map<string, string | null>();

async function junkFolderIdFor(token: string, mailbox: string): Promise<string | null> {
  if (junkFolderIds.has(mailbox)) return junkFolderIds.get(mailbox)!;
  try {
    const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/mailFolders/junkemail?$select=id`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const id = res.ok ? ((await res.json()) as any)?.id || null : null;
    junkFolderIds.set(mailbox, id);
    return id;
  } catch {
    return null;
  }
}

/** internetMessageHeaders for many messages via Graph $batch (20 per call).
 *  Messages whose headers could not be read are left out. */
async function fetchHeaders(token: string, mailbox: string, ids: string[], delayMs: number): Promise<Map<string, Header[]>> {
  const out = new Map<string, Header[]>();
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const body = JSON.stringify({
      requests: chunk.map((id, n) => ({
        id: String(n), method: "GET",
        url: `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}?$select=internetMessageHeaders`,
      })),
    });
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`${GRAPH_BASE}/$batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
      }).catch(() => null);
      if (res && (res.status === 429 || res.status === 503)) {
        await sleep(Math.min(60, Number(res.headers.get("retry-after")) || 5 * (attempt + 1)) * 1000);
        continue;
      }
      if (!res || !res.ok) break;
      const data: any = await res.json().catch(() => null);
      for (const r of data?.responses || []) {
        if (r?.status === 200) out.set(chunk[Number(r.id)], r.body?.internetMessageHeaders || []);
      }
      break;
    }
    if (delayMs) await sleep(delayMs);
  }
  return out;
}

export interface ContactRef { id: string; name: string; email: string | null; companyId: string | null; companyName: string | null }

export interface AutoContactRun {
  token: string;
  pool: TxPool;
  contactsByEmail: Map<string, ContactRef>;
  staffEmails: Set<string>;
  creators: Map<string, string>;          // mailbox → staff name; only these mailboxes may create
  capPerMailbox: number;
  delayMs: number;
  companyCache: Map<string, DomainCompany | null>;
  stats: { contactsCreated: number; companiesCreated: number; skippedMessages: Record<string, number>; errors: number };
  created: Array<{ email: string; name: string; company: string | null; mailbox: string }>;
}

export function newAutoContactRun(init: Omit<AutoContactRun, "companyCache" | "stats" | "created">): AutoContactRun {
  return { ...init, companyCache: new Map(), stats: { contactsCreated: 0, companiesCreated: 0, skippedMessages: {}, errors: 0 }, created: [] };
}

function skip(run: AutoContactRun, reason: string) {
  const key = reason.replace(/\s*\(.*\)$/, "").replace(/^\d+ /, "");
  run.stats.skippedMessages[key] = (run.stats.skippedMessages[key] || 0) + 1;
}

async function companyFor(run: AutoContactRun, domain: string, marker: string): Promise<DomainCompany | null> {
  const key = registrableDomain(domain);
  if (run.companyCache.has(domain)) return run.companyCache.get(domain)!;
  if (key !== domain && run.companyCache.has(key)) return run.companyCache.get(key)!;
  const co = await ensureCompanyForDomain(run.pool, domain, marker);
  if (co.created) run.stats.companiesCreated++;
  run.companyCache.set(domain, { id: co.id, name: co.name });
  run.companyCache.set(key, { id: co.id, name: co.name });
  return co;
}

/** Create contacts for the unknown external people on this mailbox's real
 *  correspondence. Returns, per message id, the contacts this run added (or
 *  found under the lock) that the message should be filed against. */
export async function resolveAutoContacts(run: AutoContactRun, mailbox: string, messages: SyncedMessage[]): Promise<Map<string, ContactRef[]>> {
  const result = new Map<string, ContactRef[]>();
  const staffName = run.creators.get(mailbox.toLowerCase());
  if (!staffName) return result;
  const junkFolderId = await junkFolderIdFor(run.token, mailbox);
  const plans = new Map<string, AutoContactPlan>();
  for (const msg of messages) {
    const plan = planMessage(msg, { isKnown: e => run.contactsByEmail.has(e), staffEmails: run.staffEmails, junkFolderId });
    if (!plan.eligible) { skip(run, plan.reason || "ineligible"); continue; }
    if (plan.unknown.length) plans.set(msg.id, plan);
  }
  const needHeaders = messages.filter(m => plans.get(m.id)?.inbound && !bulkVerdicts.has(m.id)).map(m => m.id);
  if (needHeaders.length) {
    const headers = await fetchHeaders(run.token, mailbox, needHeaders, run.delayMs);
    for (const [id, h] of headers) {
      if (bulkVerdicts.size > 200_000) bulkVerdicts.clear();
      bulkVerdicts.set(id, bulkHeaderReason(h));
    }
  }

  const addedHere = new Map<string, ContactRef>();
  let createdHere = 0;
  for (const msg of messages) {
    const plan = plans.get(msg.id);
    if (!plan) continue;
    if (plan.inbound) {
      if (!bulkVerdicts.has(msg.id)) { skip(run, "headers unavailable"); continue; }
      const bulk = bulkVerdicts.get(msg.id);
      if (bulk) { skip(run, `bulk mail`); continue; }
    }
    const date = msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date();
    const marker = autoMarker(staffName, isNaN(date.getTime()) ? new Date() : date);
    for (const p of plan.unknown) {
      if (run.contactsByEmail.has(p.email)) continue;
      if (createdHere >= run.capPerMailbox) { skip(run, "mailbox cap reached"); break; }
      try {
        const domain = emailDomain(p.email);
        const company = domain && !isFreeMailDomain(domain) ? await companyFor(run, domain, marker) : null;
        const contact = await ensureContactForEmail(run.pool, {
          email: p.email,
          name: contactNameFor(p.name, p.email),
          companyId: company?.id || null,
          companyName: company?.name || null,
          notes: marker,
        });
        const ref: ContactRef = { id: contact.id, name: contact.name, email: p.email, companyId: contact.companyId, companyName: contact.companyName };
        run.contactsByEmail.set(p.email, ref);
        addedHere.set(p.email, ref);
        if (contact.created) {
          createdHere++;
          run.stats.contactsCreated++;
          if (run.created.length < 500) run.created.push({ email: p.email, name: contact.name, company: contact.companyName, mailbox });
        }
      } catch (e: any) {
        run.stats.errors++;
        console.warn(`[email-auto-contacts] ${p.email}: ${e?.message}`);
      }
    }
  }

  // File every eligible message against the people added in this run, not
  // just the one that introduced them.
  if (addedHere.size) {
    for (const msg of messages) {
      const plan = planMessage(msg, { isKnown: () => false, staffEmails: run.staffEmails, junkFolderId });
      if (!plan.eligible || (plan.inbound && (!bulkVerdicts.has(msg.id) || bulkVerdicts.get(msg.id)))) continue;
      const refs = plan.externals.map(p => addedHere.get(p.email)).filter((r): r is ContactRef => !!r);
      if (refs.length) result.set(msg.id, refs);
    }
  }
  return result;
}

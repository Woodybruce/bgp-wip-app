// Emails as a source of requirement suggestions (Woody, 2026-11-15: yes to
// reading BGP's own emails for what brands say they want; item 8 of
// docs/expansion-review-2026-11-14.md, parked until then).
//
// The hourly mailbox sync (server/interactions.ts) hands this file an email
// it has just filed against a contact, when the contact wrote it. Here it is
// read once, and only if:
//   - the writer's company is a tenant brand, or an agent firm (an agent
//     writes "my client wants 2,000 sq ft in Leeds");
//   - its subject or opening lines read like a requirement (a rule, no AI);
//   - it is not on the private side of the mail boundary.
// Only the writer's own words are read: earlier messages quoted under them
// are cut off. The reader is the one the chat and meeting feeds use
// (readStatedRequirements: Anthropic, called directly, every result must
// quote words that are in the text), under its own daily allowance.
//
// It only ever SUGGESTS (the intake's suggest): a named BGP person confirms
// or dismisses it in the Requirements centre. The email's text is read in
// memory; the quote on the suggestion (300 characters at most) is all that
// is kept. Staff only, as every suggestion is.
import { isPrivateEmailRecord } from "./private-mail";
import { emailBodyText, splitThread } from "./email-contact-reader";
import type { GraphGet } from "./email-contact-details";
import type { ReaderDeps, StatedRequirement } from "./requirement-feeds";

const USAGE_KEY = "requirement_email_reader_usage";
// The fields the contact reader fetches (SELECT_FOR_READING in email-contact-details.ts).
const SELECT_FOR_READING = "id,subject,receivedDateTime,from,toRecipients,ccRecipients,body";
// A brand's property@ or acquisitions@ address is a fair source; a machine's address is not.
const MACHINE_ADDRESS_RE = /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|newsletter|news|marketing|notifications?)@/i;
const READ_MAX_CHARS = 6000;

const envInt = (name: string, fallback: number) => {
  const raw = process.env[name];
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};
/** Emails read a day across every mailbox. REQUIREMENT_EMAIL_READER_DAILY_CAP, 0 = off. */
export const emailReaderDailyCap = () => envInt("REQUIREMENT_EMAIL_READER_DAILY_CAP", 60);
/** Emails read from one mailbox in one sync run. */
export const emailReadsPerRun = () => envInt("REQUIREMENT_EMAIL_READS_PER_RUN", 8);

// Words that make an email worth one read. Deliberately narrow: most mail
// about a deal in hand is not a new requirement.
const HINT_RE = /\b(requirements?|looking (?:for|to (?:open|take|acquire|expand))|seeking|in the market for|on the hunt for|search(?:ing)? for (?:a |new )?(?:sites?|units?|space|premises|stores?|shops?)|new (?:sites?|stores?|restaurants?|locations?|openings)|target (?:towns?|locations?|cities|list)|expansion plans?|roll[- ]?out|acquisition (?:brief|strategy|criteria)|site criteria|sq\.? ?ft|sqft|square f(?:oo|ee)t)\b/i;
const NOT_A_PERSON_RE = /\b(newsletter|unsubscribe|no-?reply|do not reply|out of office|automatic reply|webinar|invitation:|accepted:|declined:)\b/i;

export interface QueuedRequirementEmail { msg: any; contactId: string; contactName: string; contactEmail: string; companyId: string }

/** Is this newly filed email worth a read? The contact must have written it. */
export function emailWorthReading(msg: any, contact: { email: string | null; companyId: string | null }): boolean {
  const sender = String(msg?.from?.emailAddress?.address || "").trim().toLowerCase();
  if (!sender || !contact.companyId || sender !== String(contact.email || "").trim().toLowerCase()) return false;
  if (MACHINE_ADDRESS_RE.test(sender)) return false;
  const head = `${msg?.subject || ""} ${msg?.bodyPreview || ""}`;
  return HINT_RE.test(head) && !NOT_A_PERSON_RE.test(head);
}

export function queueRequirementEmail(queue: Map<string, QueuedRequirementEmail>, msg: any, contact: { id: string; name: string; email: string | null; companyId: string | null }) {
  if (!msg?.id || queue.has(msg.id) || !emailWorthReading(msg, contact)) return;
  queue.set(msg.id, { msg, contactId: contact.id, contactName: contact.name, contactEmail: String(contact.email).toLowerCase(), companyId: String(contact.companyId) });
}

/** The writer's own words: the newest message, without the thread quoted under it or a legal footer. */
export function ownWords(message: any): string {
  const from = message?.from?.emailAddress ? { email: String(message.from.emailAddress.address || ""), name: message.from.emailAddress.name || null } : null;
  const text = emailBodyText(String(message?.body?.content || ""));
  const top = splitThread(text, from as any)[0]?.lines.join("\n") || "";
  return top.split(/\n\s*(?:_{6,}|-{6,}|this (?:e-?mail|message) (?:and any|is|may)|confidentiality notice|disclaimer)\b/i)[0]
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, READ_MAX_CHARS);
}

export interface EmailFeedDeps {
  /** The sender's company: its name, and whether it is a tenant brand or an agent firm. */
  company?: (companyId: string) => Promise<{ id: string; name: string; kind: "brand" | "agent" } | null>;
  read?: (input: { text: string; what: string; brands: string[] | null }) => Promise<StatedRequirement[] | null>;
  suggest?: (found: StatedRequirement, source: { item: QueuedRequirementEmail; company: { id: string; name: string; kind: "brand" | "agent" }; message: any; mailbox: string; mailboxName: string | null }) => Promise<boolean>;
  readerDeps?: ReaderDeps;
}

async function senderCompany(companyId: string) {
  const { pool } = await import("./db");
  const row = (await pool.query(
    `SELECT id, name, company_type FROM crm_companies WHERE id = $1 AND merged_into_id IS NULL AND archived_at IS NULL`, [companyId])).rows[0];
  if (!row) return null;
  const type = String(row.company_type || "");
  const kind = /^tenant/i.test(type) ? "brand" as const : /agent/i.test(type) ? "agent" as const : null;
  return kind ? { id: String(row.id), name: String(row.name), kind } : null;
}

async function raise(found: StatedRequirement, source: { item: QueuedRequirementEmail; company: { id: string; name: string; kind: "brand" | "agent" }; message: any; mailbox: string; mailboxName: string | null }): Promise<boolean> {
  const { suggest } = await import("./requirement-intake");
  const { withStore } = await import("./requirement-feeds");
  const { item, company, message, mailboxName } = source;
  const to = mailboxName || "BGP";
  return withStore(async store => {
    const out = await suggest(store, {
      kind: "email",
      // The brand's own person: the brand is theirs. An agent: the brand is the one the email names.
      brand: company.kind === "brand" ? { companyIds: [company.id], name: company.name } : { name: found.brand },
      sourceLabel: "Email", sourceRef: `email_${item.msg.id}`, evidenceDate: message?.receivedDateTime ? new Date(message.receivedDateTime) : new Date(),
      headline: `${item.contactName}${company.kind === "agent" ? ` (${company.name})` : ""} by email to ${to}`,
      excerpt: found.quote, saidBy: item.contactName,
      details: {
        ...(found.sites ? { sites: found.sites } : {}), ...(found.size ? { size: [found.size] } : {}), ...(found.locations.length ? { locations: found.locations } : {}),
        ...(found.use ? { use: [found.use] } : {}), ...(found.timing ? { timing: found.timing } : {}),
      },
      confidence: found.confidence, dedupeKey: `email:${item.msg.id}:${company.kind === "brand" ? company.id : found.brand.toLowerCase()}`, detectedBy: "Email reader",
    });
    return out.outcome === "opened" || out.outcome === "joined";
  });
}

/** Fetches and reads the queued emails of one mailbox. Never throws. */
export async function readQueuedRequirementEmails(get: GraphGet, mailbox: string, queue: Map<string, QueuedRequirementEmail>, opts: { mailboxName?: string | null } & EmailFeedDeps = {}): Promise<{ read: number; suggestions: number }> {
  const out = { read: 0, suggestions: 0 };
  if (!queue.size || emailReaderDailyCap() <= 0) return out;
  const { readStatedRequirements, readerDepsWith, claimDailyRead } = await import("./requirement-feeds");
  const readerDeps = opts.readerDeps || readerDepsWith(() => claimDailyRead(USAGE_KEY, emailReaderDailyCap()));
  const newest = [...queue.values()].sort((a, b) => Date.parse(b.msg.receivedDateTime || 0) - Date.parse(a.msg.receivedDateTime || 0)).slice(0, emailReadsPerRun());
  for (const item of newest) {
    try {
      const company = await (opts.company || senderCompany)(item.companyId);
      if (!company) continue;
      const message = await get(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(item.msg.id)}?$select=${SELECT_FOR_READING}`, { Prefer: 'IdType="ImmutableId"' });
      if (!message || isPrivateEmailRecord(message, mailbox)) continue;
      const text = ownWords(message);
      if (text.length < 40) continue;
      const day = String(message.receivedDateTime || "").slice(0, 10);
      const input = {
        text,
        what: `email from ${item.contactName} of ${company.name}${company.kind === "agent" ? " (an agent firm)" : ""} to BGP${day ? `, ${day}` : ""}`,
        brands: company.kind === "brand" ? [company.name] : null,
      };
      const found = opts.read ? await opts.read(input) : await readStatedRequirements(input, readerDeps);
      if (!found) break; // no key, or today's allowance is used
      out.read++;
      for (const r of found.slice(0, company.kind === "brand" ? 1 : 3)) {
        // An agent's own firm is not a brand looking for space.
        if (company.kind === "agent" && r.brand.trim().toLowerCase() === company.name.trim().toLowerCase()) continue;
        if (await (opts.suggest || raise)(r, { item, company, message, mailbox, mailboxName: opts.mailboxName || null })) out.suggestions++;
      }
    } catch (e: any) {
      console.warn(`[requirement-email-feed] ${mailbox}: an email was not read: ${String(e?.message || e).slice(0, 160)}`);
    }
  }
  if (out.read) console.log(`[requirement-email-feed] ${mailbox}: ${out.read} read, ${out.suggestions} suggestion${out.suggestions === 1 ? "" : "s"} raised`);
  return out;
}

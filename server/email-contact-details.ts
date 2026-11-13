// Job title and phone from email, saved on the contact (Woody, 2026-11-13:
// "its really important we capture contact details from emails", read
// automatically, no button).
//
// The hourly mailbox sync calls this in two places:
//   1. New mail. When the sync adds a person from an email, or files a new
//      email for a saved person whose job title or phone is still blank, the
//      email's full text is fetched from Microsoft and read by
//      email-contact-reader.ts.
//   2. The backlog. People already added from email who still have no title
//      or phone are worked through a few at a time, oldest first, from the
//      emails already filed against them. Each person is tried once (one read
//      per thread, up to three threads); a cursor in system_settings keeps
//      the place, so it cannot loop.
//
// Blank fields only: a value a person typed, or an earlier read set, is never
// replaced. Where each value came from is added to the contact's notes (there
// is no column for it). An employer is never set or changed here. The email's
// text is read in memory and is not stored.
import type { Querier } from "./account-resolver";
import { readEmailContactDetails, type PersonDetails, type ReaderPerson, type ContactReaderDeps } from "./email-contact-reader";
import { isGenericMailbox } from "./signature-contact-sync";
import { isPrivateEmailRecord } from "./private-mail";

export type GraphGet = (path: string, headers?: Record<string, string>) => Promise<any>;

const blank = (v: unknown) => !String(v ?? "").trim();
const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "").replace(/^(?:0044|44)0?/, "0");
const envInt = (name: string, fallback: number) => {
  const raw = process.env[name];
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

/** Full emails fetched in one sync run for saved people with a blank title or phone. CONTACT_DETAILS_READS_PER_RUN, 0 = off (people the run adds are then not read either). */
export const newMailReadsPerRun = () => envInt("CONTACT_DETAILS_READS_PER_RUN", 120);
// People the run has just added have their own allowance, so a busy hour of
// ordinary mail cannot crowd them out.
const ADDED_READS_PER_RUN = 200;
// Someone whose emails keep giving nothing (no signature, or none with a phone)
// is left alone for a week after five tries, kept in memory.
const FRUITLESS_TRIES = 5;
const FRUITLESS_REST_MS = 7 * 24 * 60 * 60 * 1000;
const FRUITLESS = new Map<string, { tries: number; at: number }>();
const resting = (email: string, now = Date.now()) => {
  const f = FRUITLESS.get(email);
  if (!f || f.tries < FRUITLESS_TRIES) return false;
  if (now - f.at < FRUITLESS_REST_MS) return true;
  FRUITLESS.delete(email);
  return false;
};
/** People taken from the backlog in one sync run. CONTACT_DETAILS_BACKLOG_PER_RUN, 0 = off. */
export const backlogPerRun = () => envInt("CONTACT_DETAILS_BACKLOG_PER_RUN", 25);
const READS_PER_PERSON = 3;

// ── What to fill ───────────────────────────────────────────────────────────

export interface ContactBlanksRow {
  id: string;
  role: string | null;
  phone: string | null;
  phone_mobile: string | null;
  company_id?: string | null;
  company_name?: string | null;
}
export interface DetailFill { role?: string; phone?: string; phone_mobile?: string }

/** Which blank fields this read fills. A field that holds anything is left alone. */
export function decideDetailFill(contact: ContactBlanksRow, found: Pick<PersonDetails, "title" | "phone" | "mobile">): DetailFill {
  const fill: DetailFill = {};
  if (blank(contact.role) && !blank(found.title)) fill.role = String(found.title).trim().slice(0, 120);
  // The same number is never written into both phone fields.
  if (blank(contact.phone) && !blank(found.phone) && digits(found.phone) !== digits(contact.phone_mobile)) fill.phone = String(found.phone).trim();
  if (blank(contact.phone_mobile) && !blank(found.mobile) && digits(found.mobile) !== digits(contact.phone) && digits(found.mobile) !== digits(fill.phone)) {
    fill.phone_mobile = String(found.mobile).trim();
  }
  return fill;
}

export interface DetailSource {
  subject: string | null;
  date: Date | string | null;
  /** Whose mailbox the email is in (a staff name). */
  mailboxName: string | null;
  where: "message" | "quoted";
}

const FIELD_WORDS: Record<keyof DetailFill, string> = { role: "job title", phone: "phone", phone_mobile: "mobile" };
const dayText = (d: Date | string | null) => {
  const date = d ? new Date(d) : null;
  return date && !isNaN(date.getTime()) ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null;
};

/** The line added to a contact's notes saying where the values came from. */
export function provenanceLine(fill: DetailFill, source: DetailSource, signatureCompany?: string | null): string {
  const names = (Object.keys(FIELD_WORDS) as Array<keyof DetailFill>).filter(k => fill[k]).map(k => FIELD_WORDS[k]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] || "details";
  const subject = String(source.subject || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const bits = [dayText(source.date), source.mailboxName ? `${source.mailboxName}'s mailbox` : null].filter(Boolean).join(", ");
  const from = source.where === "quoted" ? "their signature in an earlier message quoted in the email" : "their signature in the email";
  const line = `${list.charAt(0).toUpperCase()}${list.slice(1)} read from ${from}${subject ? ` "${subject}"` : ""}${bits ? ` (${bits})` : ""}.`;
  const firm = String(signatureCompany || "").replace(/\s+/g, " ").trim().slice(0, 80);
  return firm ? `${line} The signature names ${firm}.` : line;
}

/** Fills the blank fields of every saved person with this address. Returns the
 *  fields filled. The UPDATE re-checks each field is still blank, so an edit a
 *  person made in the meantime wins. */
export async function applyDetailsToContact(q: Querier, found: PersonDetails, source: DetailSource): Promise<string[]> {
  const email = lower(found.email);
  if (!email || isGenericMailbox(email)) return [];
  const { rows } = await q.query(
    `SELECT id, role, phone, phone_mobile, company_id, company_name FROM crm_contacts WHERE lower(btrim(email)) = $1`, [email]);
  const filled = new Set<string>();
  for (const contact of rows as ContactBlanksRow[]) {
    const fill = decideDetailFill(contact, found);
    const keys = Object.keys(fill) as Array<keyof DetailFill>;
    if (!keys.length) continue;
    // The firm in the signature is noted only for a person with no company on record; it is never attached.
    const note = provenanceLine(fill, source, blank(contact.company_id) && blank(contact.company_name) ? found.company : null);
    const params: unknown[] = [contact.id, note];
    const sets: string[] = [];
    const guards: string[] = [];
    for (const k of keys) {
      params.push(fill[k]);
      sets.push(`${k} = $${params.length}`);
      guards.push(`(${k} IS NULL OR btrim(${k}) = '')`);
    }
    const result = await q.query(
      `UPDATE crm_contacts
          SET ${sets.join(", ")},
              notes = CASE WHEN notes IS NULL OR btrim(notes) = '' THEN $2 ELSE notes || E'\\n' || $2 END,
              updated_at = now()
        WHERE id = $1 AND ${guards.join(" AND ")}`, params);
    if ((result.rowCount ?? 0) > 0) for (const k of keys) filled.add(k);
  }
  return [...filled];
}

// ── A stored email, found again in Microsoft ───────────────────────────────

export interface StoredEmailRef {
  mailbox: string;
  /** Graph ids on file for this email (the same email can be filed under two). */
  ids: string[];
  subject: string | null;
  date: Date | string | null;
}

const SELECT_HEAD = "id,subject,receivedDateTime";
export const SELECT_FOR_READING = "id,subject,receivedDateTime,from,toRecipients,ccRecipients,body";
const subjectKey = (s: unknown) => String(s || "").replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().toLowerCase();
const notFound = (e: any) => /Graph API (?:error )?(?:404|400)\b|ErrorItemNotFound|ErrorInvalidIdMalformed|ObjectNotFound/i.test(String(e?.message || e));

/** The message in Microsoft for an email the app has on file. In order: by
 *  its stored id; by its received time and subject in the same mailbox (an id
 *  stored before ids became permanent stops working when the email is moved
 *  to a folder); then by its stored id sent as a permanent id. The first two
 *  give an id the email viewer opens as it is. `gone` = Microsoft answered
 *  and it is not there; `unavailable` = Microsoft could not be asked. */
export async function findStoredEmail(get: GraphGet, ref: StoredEmailRef, select = SELECT_HEAD): Promise<{ message: any | null; reason?: "gone" | "unavailable" }> {
  const mailbox = encodeURIComponent(ref.mailbox);
  const headers = { "X-AnchorMailbox": ref.mailbox };
  let unavailable = false;
  // The search was refused (a 400): Microsoft answered, but not about whether
  // the email is there, so the answer can never be "gone".
  let searchRefused = false;
  const byId = async (extra: Record<string, string> = {}) => {
    for (const id of ref.ids) {
      try {
        const message = await get(`/users/${mailbox}/messages/${encodeURIComponent(id)}?$select=${select}`, { ...headers, ...extra });
        if (message?.id) return message;
      } catch (e: any) {
        if (!notFound(e)) unavailable = true;
      }
    }
    return null;
  };
  const plain = await byId();
  if (plain) return { message: plain };
  const at = ref.date ? new Date(ref.date) : null;
  if (at && !isNaN(at.getTime())) {
    try {
      const from = new Date(at.getTime() - 2000).toISOString(), to = new Date(at.getTime() + 2000).toISOString();
      const data = await get(`/users/${mailbox}/messages?$filter=receivedDateTime ge ${from} and receivedDateTime le ${to}&$select=${select}&$top=10`, headers);
      const hit = (data?.value || []).find((m: any) => subjectKey(m.subject) === subjectKey(ref.subject));
      if (hit?.id) return { message: hit };
    } catch (e: any) {
      if (/Graph API (?:error )?400\b/i.test(String(e?.message || e))) searchRefused = true;
      else if (!notFound(e)) unavailable = true;
    }
  }
  // Nothing more to try when Microsoft is not answering at all.
  if (unavailable) return { message: null, reason: "unavailable" };
  const permanent = await byId({ Prefer: 'IdType="ImmutableId"' });
  if (permanent) return { message: permanent };
  return { message: null, reason: unavailable || searchRefused ? "unavailable" : "gone" };
}

// ── Reading one fetched message ────────────────────────────────────────────

const person = (r: any): ReaderPerson | null => {
  const email = lower(r?.emailAddress?.address);
  return email ? { email, name: String(r?.emailAddress?.name || "").trim() || null } : null;
};

export function peopleOnMessage(message: any): { from: ReaderPerson | null; people: ReaderPerson[] } {
  const from = person(message?.from);
  const seen = new Map<string, ReaderPerson>();
  for (const r of [message?.from, ...(message?.toRecipients || []), ...(message?.ccRecipients || [])]) {
    const p = person(r);
    if (p && !seen.has(p.email)) seen.set(p.email, p);
  }
  return { from, people: [...seen.values()] };
}

// The model is asked about one person's block at most once a fortnight (kept
// in memory), so somebody whose signature the rules cannot read does not use
// the day's allowance on every email they send.
const MODEL_ASKED = new Map<string, number>();
const MODEL_REST_MS = 14 * 24 * 60 * 60 * 1000;

/** Reads a fetched message for the wanted people and saves what it finds. */
export async function readMessageForContacts(q: Querier, message: any, wanted: string[], source: Omit<DetailSource, "where" | "subject" | "date">, readerDeps?: ContactReaderDeps): Promise<Array<{ email: string; fields: string[] }>> {
  const body = String(message?.body?.content || "");
  if (!body.trim() || !wanted.length) return [];
  const { from, people } = peopleOnMessage(message);
  const now = Date.now();
  const found = await readEmailContactDetails({
    body, from, people,
    wanted,
    rulesOnly: wanted.filter(e => now - (MODEL_ASKED.get(lower(e)) || 0) < MODEL_REST_MS),
    onModel: emails => { if (MODEL_ASKED.size > 50_000) MODEL_ASKED.clear(); for (const e of emails) MODEL_ASKED.set(lower(e), now); },
  }, readerDeps);
  const out: Array<{ email: string; fields: string[] }> = [];
  for (const details of found) {
    const fields = await applyDetailsToContact(q, details, { ...source, subject: message?.subject || null, date: message?.receivedDateTime || null, where: details.where });
    if (fields.length) out.push({ email: details.email, fields });
  }
  return out;
}

// ── 1. New mail, inside the sync ───────────────────────────────────────────

export interface ContactNeed { title: boolean; phone: boolean }

export interface ContactDetailsRun {
  q: Querier;
  /** Saved people (by address) whose job title or phone is still blank. */
  needs: Map<string, ContactNeed>;
  staffNames: Map<string, string>;
  readsLeft: number;
  addedReadsLeft: number;
  readsByPerson: Map<string, number>;
  readerDeps?: ContactReaderDeps;
  stats: { messagesRead: number; contactsFilled: number; errors: number };
}

export async function newContactDetailsRun(q: Querier, staffNames: Map<string, string>, readsPerRun = newMailReadsPerRun()): Promise<ContactDetailsRun> {
  const needs = new Map<string, ContactNeed>();
  if (readsPerRun > 0) {
    const { rows } = await q.query(
      `SELECT lower(btrim(email)) AS email,
              bool_or(role IS NULL OR btrim(role) = '') AS title,
              bool_or((phone IS NULL OR btrim(phone) = '') AND (phone_mobile IS NULL OR btrim(phone_mobile) = '')) AS phone
         FROM crm_contacts
        WHERE email IS NOT NULL AND btrim(email) <> ''
          AND ((role IS NULL OR btrim(role) = '') OR ((phone IS NULL OR btrim(phone) = '') AND (phone_mobile IS NULL OR btrim(phone_mobile) = '')))
        GROUP BY 1`);
    for (const r of rows) if (!isGenericMailbox(r.email)) needs.set(r.email, { title: !!r.title, phone: !!r.phone });
  }
  return { q, needs, staffNames, readsLeft: readsPerRun, addedReadsLeft: readsPerRun > 0 ? ADDED_READS_PER_RUN : 0, readsByPerson: new Map(), stats: { messagesRead: 0, contactsFilled: 0, errors: 0 } };
}

export interface QueuedRead { msg: any; wanted: Set<string>; added: boolean; addedPeople?: Set<string> }

// People read as the sync added them (this process): the backlog passes over
// them, so the same emails are not fetched twice an hour apart. A person goes
// in only once their email has been fetched, never when the read is queued: a
// read skipped for the run's allowance, or failed, leaves them to the backlog.
const READ_AT_ADD = new Set<string>();

/** Notes that this message should be read for this person, if they still need anything. */
export function queueDetailRead(run: ContactDetailsRun, queue: Map<string, QueuedRead>, msg: any, email: string | null | undefined, justAdded = false) {
  const address = lower(email);
  if (!address || !msg?.id || isGenericMailbox(address)) return;
  if ((justAdded ? run.addedReadsLeft : run.readsLeft) <= 0) return;
  if (justAdded) {
    run.needs.set(address, { title: true, phone: true });
  } else if (resting(address)) return;
  if (!run.needs.has(address)) return;
  const entry = queue.get(msg.id) || { msg, wanted: new Set<string>(), added: false };
  entry.wanted.add(address);
  entry.added = entry.added || justAdded;
  if (justAdded) (entry.addedPeople ||= new Set<string>()).add(address);
  queue.set(msg.id, entry);
}

/** Fetches and reads the queued messages of one mailbox: people the run has
 *  just added first, then a message the person wrote, then the newest; at
 *  most three per person in a run. */
export async function readQueuedMessages(run: ContactDetailsRun, get: GraphGet, mailbox: string, queue: Map<string, QueuedRead>): Promise<void> {
  const sender = (m: any) => lower(m?.from?.emailAddress?.address);
  const entries = [...queue.values()].sort((a, b) =>
    Number(b.added) - Number(a.added)
    || Number(b.wanted.has(sender(b.msg))) - Number(a.wanted.has(sender(a.msg)))
    || Date.parse(b.msg.receivedDateTime || 0) - Date.parse(a.msg.receivedDateTime || 0));
  for (const entry of entries) {
    const wanted = [...entry.wanted].filter(e => run.needs.has(e) && (run.readsByPerson.get(e) || 0) < READS_PER_PERSON);
    if (!wanted.length) continue;
    if (entry.added ? run.addedReadsLeft <= 0 : run.readsLeft <= 0) continue;
    if (entry.added) run.addedReadsLeft--; else run.readsLeft--;
    for (const e of wanted) run.readsByPerson.set(e, (run.readsByPerson.get(e) || 0) + 1);
    try {
      // The sync lists messages with permanent ids, so the same header is sent here.
      const message = await get(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(entry.msg.id)}?$select=${SELECT_FOR_READING}`, { Prefer: 'IdType="ImmutableId"' });
      if (!message || isPrivateEmailRecord(message, mailbox)) continue;
      run.stats.messagesRead++;
      for (const e of wanted) {
        if (!entry.addedPeople?.has(e)) continue;
        if (READ_AT_ADD.size > 20_000) READ_AT_ADD.clear();
        READ_AT_ADD.add(e);
      }
      const filled = await readMessageForContacts(run.q, message, wanted, { mailboxName: run.staffNames.get(mailbox.toLowerCase()) || null }, run.readerDeps);
      const got = new Set(filled.map(f => f.email));
      const now = Date.now();
      for (const e of wanted) {
        if (got.has(e)) { FRUITLESS.delete(e); continue; }
        if (FRUITLESS.size > 50_000) FRUITLESS.clear();
        FRUITLESS.set(e, { tries: (FRUITLESS.get(e)?.tries || 0) + 1, at: now });
      }
      for (const f of filled) {
        run.stats.contactsFilled++;
        const need = run.needs.get(f.email);
        if (!need) continue;
        if (f.fields.includes("role")) need.title = false;
        if (f.fields.includes("phone") || f.fields.includes("phone_mobile")) need.phone = false;
        if (!need.title && !need.phone) run.needs.delete(f.email);
      }
    } catch (e: any) {
      run.stats.errors++;
      console.warn(`[contact-details] ${mailbox}: a message could not be read: ${String(e?.message || e).slice(0, 160)}`);
    }
  }
}

// ── 2. The backlog ─────────────────────────────────────────────────────────

export const BACKLOG_KEY = "contact_details_from_email";
const STUCK_TRIES = 3;

export interface BacklogState {
  cursor: { at: string; id: string } | null;
  stuck: { id: string; tries: number } | null;
  backlog: { tried: number; filled: number };
  newMail: { read: number; filled: number };
  lastRunAt: string | null;
}
const emptyState = (): BacklogState => ({ cursor: null, stuck: null, backlog: { tried: 0, filled: 0 }, newMail: { read: 0, filled: 0 }, lastRunAt: null });

async function loadState(q: Querier): Promise<BacklogState> {
  const row = (await q.query(`SELECT value FROM system_settings WHERE key = $1`, [BACKLOG_KEY])).rows[0]?.value;
  const base = emptyState();
  return row && typeof row === "object" ? { ...base, ...row, backlog: { ...base.backlog, ...row.backlog }, newMail: { ...base.newMail, ...row.newMail } } : base;
}
async function saveState(q: Querier, state: BacklogState) {
  await q.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [BACKLOG_KEY, JSON.stringify(state)]);
}

const WAITING_WHERE = `enrichment_source = 'email-sync' AND email IS NOT NULL AND btrim(email) <> ''
  AND ((role IS NULL OR btrim(role) = '') OR ((phone IS NULL OR btrim(phone) = '') AND (phone_mobile IS NULL OR btrim(phone_mobile) = '')))`;
const AFTER_CURSOR = `($1::timestamp IS NULL OR (coalesce(created_at, 'epoch'::timestamp), id) > ($1::timestamp, $2::varchar))`;

export interface FiledEmailRow { microsoft_id: string; bgp_user: string; subject: string | null; interaction_date: Date | string; participants: unknown }

/** Which filed emails to re-read for one person: one per thread (the newest
 *  message of a thread quotes the rest), a thread they wrote in first, then
 *  the most recent, up to three. */
export function emailsToReRead(rows: FiledEmailRow[], email: string, max = READS_PER_PERSON): StoredEmailRef[] {
  const address = lower(email);
  const list = (p: unknown): string[] => {
    let v = p;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = []; } }
    return Array.isArray(v) ? v.map(lower) : [];
  };
  const usable = rows.filter(r => r.bgp_user && /^email_/.test(r.microsoft_id || "") && !isPrivateEmailRecord({ participants: r.participants }, r.bgp_user));
  const time = (r: FiledEmailRow) => new Date(r.interaction_date).getTime() || 0;
  // Per thread: the newest message they wrote (it carries their signature), else the newest of all.
  const threads = new Map<string, { own: FiledEmailRow | null; newest: FiledEmailRow }>();
  for (const r of usable) {
    const key = `${lower(r.bgp_user)}|${subjectKey(r.subject)}`;
    const own = list(r.participants)[0] === address;
    const t = threads.get(key) || { own: null, newest: r };
    if (time(r) > time(t.newest)) t.newest = r;
    if (own && (!t.own || time(r) > time(t.own))) t.own = r;
    threads.set(key, t);
  }
  return [...threads.values()]
    .sort((a, b) => Number(!!b.own) - Number(!!a.own) || time(b.newest) - time(a.newest))
    .slice(0, max)
    .map(t => {
      const pick = t.own || t.newest;
      return {
        mailbox: pick.bgp_user,
        // The same email filed under two ids (moved in the mailbox between sweeps): try each.
        ids: [...new Set(usable.filter(r => lower(r.bgp_user) === lower(pick.bgp_user) && r.subject === pick.subject && time(r) === time(pick)).map(r => r.microsoft_id.replace(/^email_/, "")))],
        subject: pick.subject,
        date: pick.interaction_date,
      };
    });
}

export interface BacklogResult { tried: number; filled: number; waiting: number; stopped?: string }

/** One small batch of the backlog. Run by the hourly sync after the mailboxes. */
export async function runContactDetailsBacklog(deps: {
  q: Querier; get: GraphGet; staffNames: Map<string, string>; limit?: number; readerDeps?: ContactReaderDeps;
  newMail?: { read: number; filled: number };
}): Promise<BacklogResult> {
  const { q, get } = deps;
  const limit = deps.limit ?? backlogPerRun();
  const state = await loadState(q);
  if (deps.newMail) { state.newMail.read += deps.newMail.read; state.newMail.filled += deps.newMail.filled; }
  let tried = 0, filled = 0, stopped: string | undefined;
  if (limit > 0) {
    const { rows } = await q.query(
      `SELECT id, name, lower(btrim(email)) AS email,
              to_char(coalesce(created_at, 'epoch'::timestamp), 'YYYY-MM-DD"T"HH24:MI:SS.US') AS at
         FROM crm_contacts
        WHERE ${WAITING_WHERE} AND ${AFTER_CURSOR}
        ORDER BY coalesce(created_at, 'epoch'::timestamp) ASC, id ASC LIMIT $3`,
      [state.cursor?.at || null, state.cursor?.id || "", limit]);
    for (const contact of rows) {
      const done = () => { state.cursor = { at: contact.at, id: contact.id }; state.stuck = null; };
      if (isGenericMailbox(contact.email) || READ_AT_ADD.has(contact.email)) { done(); continue; }
      const filed = (await q.query(
        `SELECT microsoft_id, bgp_user, subject, interaction_date, participants FROM crm_interactions
          WHERE contact_id = $1 AND type = 'email' AND microsoft_id LIKE 'email\\_%' AND bgp_user IS NOT NULL
          ORDER BY interaction_date DESC LIMIT 80`, [contact.id])).rows as FiledEmailRow[];
      let unavailable = 0, read = 0, got: string[] = [];
      for (const ref of emailsToReRead(filed, contact.email)) {
        const { message, reason } = await findStoredEmail(get, ref, SELECT_FOR_READING);
        if (!message) { if (reason === "unavailable") unavailable++; continue; }
        if (isPrivateEmailRecord(message, ref.mailbox)) continue;
        read++;
        try {
          const out = await readMessageForContacts(q, message, [contact.email], { mailboxName: deps.staffNames.get(lower(ref.mailbox)) || null }, deps.readerDeps);
          got = [...got, ...out.flatMap(o => o.fields)];
        } catch (e: any) {
          console.warn(`[contact-details] backlog: ${contact.id} could not be read: ${String(e?.message || e).slice(0, 160)}`);
        }
        if (got.includes("role") && (got.includes("phone") || got.includes("phone_mobile"))) break;
      }
      // Microsoft could not be asked about any of this person's emails: stop
      // here and try them again next hour, three times at most, so an outage
      // does not use up everyone's one try.
      if (unavailable > 0 && read === 0) {
        const before: { id: string; tries: number } | null = state.stuck;
        const tries = before && before.id === contact.id ? before.tries + 1 : 1;
        if (tries < STUCK_TRIES) { state.stuck = { id: contact.id, tries }; stopped = "Microsoft could not be reached"; break; }
        console.warn(`[contact-details] backlog: ${contact.id} skipped after ${STUCK_TRIES} tries (its emails could not be fetched)`);
      }
      done();
      tried++;
      if (got.length) filled++;
    }
  }
  state.backlog.tried += tried;
  state.backlog.filled += filled;
  state.lastRunAt = new Date().toISOString();
  await saveState(q, state);
  const waiting = Number((await q.query(`SELECT count(*)::int AS n FROM crm_contacts WHERE ${WAITING_WHERE} AND ${AFTER_CURSOR}`,
    [state.cursor?.at || null, state.cursor?.id || ""])).rows[0]?.n || 0);
  return { tried, filled, waiting, stopped };
}

/** For the admin Sync Health tab: how far the reading has got. */
export async function contactDetailsProgress(q: Querier): Promise<{
  waiting: number; backlogTried: number; backlogFilled: number; newMailRead: number; newMailFilled: number; lastRunAt: string | null;
}> {
  const state = await loadState(q);
  const waiting = Number((await q.query(`SELECT count(*)::int AS n FROM crm_contacts WHERE ${WAITING_WHERE} AND ${AFTER_CURSOR}`,
    [state.cursor?.at || null, state.cursor?.id || ""])).rows[0]?.n || 0);
  return {
    waiting, backlogTried: state.backlog.tried, backlogFilled: state.backlog.filled,
    newMailRead: state.newMail.read, newMailFilled: state.newMail.filled, lastRunAt: state.lastRunAt,
  };
}

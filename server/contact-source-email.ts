// The email a contact was added from (Woody, 2026-11-13: "should be able to
// click on the auto added comment and see the email").
//
// The mailbox sync writes "Auto-added from email — <staff name>, <date>" in a
// new contact's notes and files that email against them, but stores no link
// between the two. This finds the email again from what is stored: the
// contact's own filed emails on the note's date, in that staff member's
// mailbox, nearest to the moment the contact was created.
//
// BGP staff only (the route is in interactions.ts). A client login, staff
// viewing as a client, an asset manager and a joint agent are all refused: it
// opens BGP's email.
import { isPrivateEmailRecord } from "./private-mail";
import { findStoredEmail, type GraphGet } from "./email-contact-details";

export interface AutoMarker { staffName: string; date: string }

/** The sync's note, read back. Must stay in step with autoMarker() in email-auto-contacts.ts. */
export function parseAutoMarker(notes: unknown): AutoMarker | null {
  const first = String(notes || "").split("\n")[0].trim();
  const m = first.match(/^Auto-added from email — (.+), (\d{4}-\d{2}-\d{2})$/);
  return m ? { staffName: m[1].trim(), date: m[2] } : null;
}

export interface FiledRow {
  microsoft_id: string;
  bgp_user: string;
  mailbox_name: string | null;
  subject: string | null;
  interaction_date: Date | string;
  created_at: Date | string | null;
  participants: unknown;
}

const time = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : NaN);
const day = (v: Date | string) => { const t = time(v); return isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10); };
const same = (a: unknown, b: unknown) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/** The filed emails most likely to be the one the contact was added from, best
 *  first: on the note's date, in the named person's mailbox, filed nearest to
 *  the contact's creation. With nothing on that date, the first email filed. */
export function sourceEmailCandidates(rows: FiledRow[], marker: AutoMarker, contactCreatedAt: Date | string | null): FiledRow[] {
  const usable = rows.filter(r => r.bgp_user && /^email_/.test(r.microsoft_id || "") && !isPrivateEmailRecord({ participants: r.participants }, r.bgp_user));
  const created = time(contactCreatedAt);
  const gap = (r: FiledRow) => { const t = time(r.created_at); return isNaN(t) || isNaN(created) ? Number.MAX_SAFE_INTEGER : Math.abs(t - created); };
  const onDay = usable.filter(r => day(r.interaction_date) === marker.date);
  const pool_ = onDay.length ? onDay : usable;
  return [...pool_].sort((a, b) =>
    Number(same(b.mailbox_name, marker.staffName)) - Number(same(a.mailbox_name, marker.staffName))
    || gap(a) - gap(b)
    || (time(a.created_at) || 0) - (time(b.created_at) || 0));
}

export type SourceEmailAnswer =
  | { found: true; msgId: string; mailboxEmail: string; mailboxName: string | null; subject: string | null; date: string | null; wrote: boolean }
  | { found: false; reason: "not_from_email" | "no_record" | "gone" | "unavailable"; mailboxName?: string | null; subject?: string | null; date?: string | null };

/** Finds the source email for one contact. `q` and `get` are passed in so this can be tested without Postgres or Microsoft. */
export async function findContactSourceEmail(q: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }, get: GraphGet, contactId: string): Promise<SourceEmailAnswer | null> {
  const contact = (await q.query(`SELECT id, email, notes, created_at FROM crm_contacts WHERE id = $1`, [contactId])).rows[0];
  if (!contact) return null;
  const marker = parseAutoMarker(contact.notes);
  if (!marker) return { found: false, reason: "not_from_email" };
  const { rows } = await q.query(
    `SELECT i.microsoft_id, i.bgp_user, i.subject, i.interaction_date, i.created_at, i.participants,
            (SELECT u.name FROM users u WHERE lower(u.email) = lower(i.bgp_user) ORDER BY u.id LIMIT 1) AS mailbox_name
       FROM crm_interactions i
      WHERE i.contact_id = $1 AND i.type = 'email' AND i.microsoft_id LIKE 'email\\_%' AND i.bgp_user IS NOT NULL
      ORDER BY i.created_at ASC NULLS LAST LIMIT 200`, [contactId]);
  const candidates = sourceEmailCandidates(rows as FiledRow[], marker, contact.created_at);
  const best = candidates[0];
  if (!best) return { found: false, reason: "no_record", mailboxName: marker.staffName };
  // The same email is sometimes on file under two ids (it was moved between sweeps): try each.
  const ids = candidates
    .filter(r => same(r.bgp_user, best.bgp_user) && r.subject === best.subject && time(r.interaction_date) === time(best.interaction_date))
    .map(r => r.microsoft_id.replace(/^email_/, ""));
  const iso = (v: Date | string | null) => { const t = time(v); return isNaN(t) ? null : new Date(t).toISOString(); };
  const { message, reason } = await findStoredEmail(get, { mailbox: best.bgp_user, ids: [...new Set(ids)], subject: best.subject, date: best.interaction_date });
  if (!message?.id) {
    return { found: false, reason: reason || "gone", mailboxName: best.mailbox_name || marker.staffName, subject: best.subject, date: iso(best.interaction_date) };
  }
  let participants: unknown = best.participants;
  if (typeof participants === "string") { try { participants = JSON.parse(participants); } catch { participants = []; } }
  return {
    found: true,
    msgId: message.id,
    mailboxEmail: best.bgp_user,
    mailboxName: best.mailbox_name || marker.staffName,
    subject: message.subject ?? best.subject,
    date: message.receivedDateTime || iso(best.interaction_date),
    wrote: Array.isArray(participants) && same(participants[0], contact.email),
  };
}

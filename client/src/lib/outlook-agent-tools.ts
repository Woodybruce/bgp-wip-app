// The Outlook pane's half of ChatBGP-in-Outlook (server/outlook-agent.ts):
// each outlook_* tool call is carried out on the open email with Office.js.
import { isPrivateEmailRecord } from "../../../shared/private-mail";

export const PRIVATE_OUTLOOK_ITEM_MESSAGE = "This private mailbox or item is not available to ChatBGP.";
export class PrivateOutlookItemError extends Error {
  readonly code = "PRIVATE_OUTLOOK_ITEM";
  constructor() { super(PRIVATE_OUTLOOK_ITEM_MESSAGE); }
}

const office = () => (window as any).Office;
const item = () => office()?.context?.mailbox?.item;

function asyncCall<T>(fn: (cb: (r: any) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      fn((r: any) => (r?.status === "succeeded" || r?.status === office()?.AsyncResultStatus?.Succeeded) ? resolve(r.value) : reject(new Error(r?.error?.message || "Outlook didn't allow that")));
    } catch (e) { reject(e); }
  });
}

export const isCompose = () => {
  const it = item();
  return !!it && typeof it.subject === "object" && typeof it.subject?.getAsync === "function";
};
// A calendar item (meeting / appointment) rather than an email (Woody,
// 2026-10-15: "does it do calendar too?").
export const isAppointment = () => {
  const it = item();
  const t = String(it?.itemType || "").toLowerCase();
  return t === "appointment" || (!!it && !("from" in it) && ("start" in it || "organizer" in it));
};

const people = (list: any) => (Array.isArray(list) ? list : []).map((p: any) => p?.displayName ? `${p.displayName} <${p.emailAddress}>` : p?.emailAddress).filter(Boolean);

export interface OpenEmail {
  mode: "read" | "compose";
  kind?: "message" | "appointment";
  start?: string;
  end?: string;
  location?: string;
  organizer?: string;
  required?: string[];
  optional?: string[];
  subject: string;
  from?: string;
  fromEmail?: string;
  to: string[];
  cc: string[];
  bcc?: string[];
  mailboxEmail?: string;
  date?: string;
  body: string;
  attachments: string[];
  conversationId?: string;
  itemId?: string;
}

const iso = (d: any) => { try { const x = d instanceof Date ? d : new Date(d); return isNaN(x.getTime()) ? undefined : x.toISOString(); } catch { return undefined; } };

// Check address metadata before reading the body. Failed recipient reads must
// not silently become empty lists and authorise a private composed message.
async function assertOutlookItemAllowed(it: any): Promise<{ mailboxEmail: string; bcc: string[] }> {
  const mailboxEmail = office()?.context?.mailbox?.userProfile?.emailAddress || "";
  const readPeople = async (value: any) => value?.getAsync
    ? asyncCall<any[]>(cb => value.getAsync(cb)) : (Array.isArray(value) ? value : []);
  const [to, cc, bcc, required, optional] = await Promise.all([
    readPeople(it.to), readPeople(it.cc), readPeople(it.bcc), readPeople(it.requiredAttendees), readPeople(it.optionalAttendees),
  ]);
  if (isPrivateEmailRecord({ mailboxEmail, from: it.from, sender: it.sender, organizer: it.organizer,
    to, cc, bcc, attendees: [...required, ...optional] })) throw new PrivateOutlookItemError();
  return { mailboxEmail, bcc: people(bcc) };
}

async function checkedOutlookEmail(email: OpenEmail, openedItem: any): Promise<OpenEmail> {
  if (item() !== openedItem) throw new Error("The open item changed. Please try again.");
  const privacy = await assertOutlookItemAllowed(openedItem);
  if (isPrivateEmailRecord(email)) throw new PrivateOutlookItemError();
  return { ...email, ...privacy };
}

export async function readOpenEmail(maxBody = 30000): Promise<OpenEmail | null> {
  const it = item();
  if (!it) return null;
  const privacy = await assertOutlookItemAllowed(it);
  const Office = office();
  if (isAppointment()) {
    if (isCompose()) {
      const [subject, start, end, location, required, optional, body] = await Promise.all([
        asyncCall<string>(cb => it.subject.getAsync(cb)).catch(() => ""),
        asyncCall<any>(cb => it.start.getAsync(cb)).catch(() => null),
        asyncCall<any>(cb => it.end.getAsync(cb)).catch(() => null),
        asyncCall<string>(cb => it.location.getAsync(cb)).catch(() => ""),
        asyncCall<any[]>(cb => it.requiredAttendees.getAsync(cb)).catch(() => []),
        asyncCall<any[]>(cb => it.optionalAttendees.getAsync(cb)).catch(() => []),
        asyncCall<string>(cb => it.body.getAsync(Office.CoercionType.Text, cb)).catch(() => ""),
      ]);
      return checkedOutlookEmail({ ...privacy, mode: "compose", kind: "appointment", subject, start: iso(start), end: iso(end), location: String(location || ""), required: people(required), optional: people(optional),
        to: people(required), cc: people(optional), body: String(body || "").slice(0, maxBody), attachments: [], conversationId: it.conversationId || undefined }, it);
    }
    const body = await asyncCall<string>(cb => it.body.getAsync(Office.CoercionType.Text, cb)).catch(() => "");
    const org = it.organizer;
    return checkedOutlookEmail({
      ...privacy,
      mode: "read", kind: "appointment",
      subject: it.subject || "",
      start: iso(it.start), end: iso(it.end), location: typeof it.location === "string" ? it.location : "",
      organizer: org?.displayName ? `${org.displayName} <${org.emailAddress}>` : org?.emailAddress || "",
      from: org?.displayName || org?.emailAddress || "", fromEmail: org?.emailAddress || "",
      required: people(it.requiredAttendees), optional: people(it.optionalAttendees),
      to: people(it.requiredAttendees), cc: people(it.optionalAttendees),
      date: iso(it.start),
      body: String(body || "").slice(0, maxBody),
      attachments: (it.attachments || []).map((a: any) => a.name).filter(Boolean),
      conversationId: it.conversationId || undefined,
      itemId: it.itemId || undefined,
    }, it);
  }
  if (isCompose()) {
    const [subject, to, cc, body] = await Promise.all([
      asyncCall<string>(cb => it.subject.getAsync(cb)).catch(() => ""),
      asyncCall<any[]>(cb => it.to.getAsync(cb)).catch(() => []),
      asyncCall<any[]>(cb => it.cc.getAsync(cb)).catch(() => []),
      asyncCall<string>(cb => it.body.getAsync(Office.CoercionType.Text, cb)).catch(() => ""),
    ]);
    return checkedOutlookEmail({ ...privacy, mode: "compose", subject, to: people(to), cc: people(cc), body: String(body || "").slice(0, maxBody), attachments: [], conversationId: it.conversationId || undefined }, it);
  }
  const body = await asyncCall<string>(cb => it.body.getAsync(Office.CoercionType.Text, cb)).catch(() => "");
  return checkedOutlookEmail({
    ...privacy,
    mode: "read",
    subject: it.subject || "",
    from: it.from?.displayName || it.from?.emailAddress || "",
    fromEmail: it.from?.emailAddress || "",
    to: people(it.to), cc: people(it.cc),
    date: it.dateTimeCreated ? new Date(it.dateTimeCreated).toISOString() : undefined,
    body: String(body || "").slice(0, maxBody),
    attachments: (it.attachments || []).map((a: any) => a.name).filter(Boolean),
    conversationId: it.conversationId || undefined,
    itemId: it.itemId || undefined,
  }, it);
}

const when = (e: OpenEmail) => {
  if (!e.start) return "";
  const s = new Date(e.start), en = e.end ? new Date(e.end) : null;
  const d = s.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const t = (x: Date) => x.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${d}, ${t(s)}${en ? `–${t(en)}` : ""}`;
};

export function emailContext(e: OpenEmail | null): string {
  if (!e) return "";
  if (isPrivateEmailRecord(e)) throw new PrivateOutlookItemError();
  if (e.kind === "appointment") {
    return [
      `Mode: ${e.mode === "compose" ? "the user is ORGANISING this meeting (writing the invite)" : "the user has this MEETING open in their calendar"}`,
      `Meeting: ${e.subject || "(no title)"}`,
      e.start ? `When: ${when(e)}` : "",
      e.location ? `Where: ${e.location}` : "",
      e.organizer ? `Organiser: ${e.organizer}` : "",
      e.required?.length ? `Attendees: ${e.required.join(", ")}` : "",
      e.optional?.length ? `Optional: ${e.optional.join(", ")}` : "",
      e.attachments.length ? `Attachments: ${e.attachments.join(", ")}` : "",
      `Invite text:\n${e.body.slice(0, 12000)}${e.body.length > 12000 ? "\n…(more — call outlook_read_email)" : ""}`,
    ].filter(Boolean).join("\n");
  }
  return [
    `Mode: ${e.mode === "compose" ? "the user is WRITING this message" : "the user is reading this email"}`,
    `Subject: ${e.subject || "(none)"}`,
    e.from ? `From: ${e.from}${e.fromEmail && e.fromEmail !== e.from ? ` <${e.fromEmail}>` : ""}` : "",
    e.to.length ? `To: ${e.to.join(", ")}` : "",
    e.cc.length ? `Cc: ${e.cc.join(", ")}` : "",
    e.date ? `Date: ${new Date(e.date).toLocaleString("en-GB")}` : "",
    e.attachments.length ? `Attachments: ${e.attachments.join(", ")}` : "",
    `Body:\n${e.body.slice(0, 12000)}${e.body.length > 12000 ? "\n…(more — call outlook_read_email)" : ""}`,
  ].filter(Boolean).join("\n");
}

const recipients = (list?: string[]) => (list || []).map(a => String(a).trim()).filter(Boolean);

export async function runOutlookTool(name: string, args: any): Promise<any> {
  try {
    const it = item();
    if (it) await assertOutlookItemAllowed(it);
    const Office = office();
    const mailbox = Office?.context?.mailbox;
    switch (name) {
      case "outlook_read_email": {
        const e = await readOpenEmail();
        return e || { error: "No email is open." };
      }
      case "outlook_draft_reply": {
        if (!it) return { error: "No email is open." };
        if (isCompose()) {
          await asyncCall(cb => it.body.setSelectedDataAsync(args.html, { coercionType: Office.CoercionType.Html }, cb));
          return { done: "Inserted into the message you're writing." };
        }
        if (args.replyAll) it.displayReplyAllForm({ htmlBody: args.html });
        else it.displayReplyForm({ htmlBody: args.html });
        return { done: `Opened a ${args.replyAll ? "reply-all" : "reply"} with the draft — the user reviews and sends.` };
      }
      case "outlook_write_compose": {
        if (!isCompose()) return { error: "The user isn't writing a message — use outlook_draft_reply or outlook_new_email." };
        if (args.subject) await asyncCall(cb => it.subject.setAsync(args.subject, cb));
        if (recipients(args.to).length) await asyncCall(cb => it.to.addAsync(recipients(args.to), cb));
        if (recipients(args.cc).length) await asyncCall(cb => it.cc.addAsync(recipients(args.cc), cb));
        if (args.html) {
          const opts = { coercionType: Office.CoercionType.Html };
          if (args.mode === "replace") await asyncCall(cb => it.body.setAsync(args.html, opts, cb));
          else if (args.mode === "prepend") await asyncCall(cb => it.body.prependAsync(args.html, opts, cb));
          else await asyncCall(cb => it.body.setSelectedDataAsync(args.html, opts, cb));
        }
        return { done: "Updated the message." };
      }
      case "outlook_new_email": {
        mailbox.displayNewMessageForm({ toRecipients: recipients(args.to), ccRecipients: recipients(args.cc), subject: args.subject || "", htmlBody: args.html || "" });
        return { done: "Opened a new email for the user to review and send." };
      }
      case "outlook_new_meeting": {
        mailbox.displayNewAppointmentForm({
          requiredAttendees: recipients(args.attendees), subject: args.subject || "", location: args.location || "",
          start: new Date(args.start), end: new Date(args.end), body: args.body || "",
        });
        return { done: "Opened a calendar invite for the user to check and send." };
      }
      default:
        return { error: `Unknown Outlook tool ${name}` };
    }
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

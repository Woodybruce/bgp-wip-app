// The Outlook pane's half of ChatBGP-in-Outlook (server/outlook-agent.ts):
// each outlook_* tool call is carried out on the open email with Office.js.
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

const people = (list: any) => (Array.isArray(list) ? list : []).map((p: any) => p?.displayName ? `${p.displayName} <${p.emailAddress}>` : p?.emailAddress).filter(Boolean);

export interface OpenEmail {
  mode: "read" | "compose";
  subject: string;
  from?: string;
  fromEmail?: string;
  to: string[];
  cc: string[];
  date?: string;
  body: string;
  attachments: string[];
  conversationId?: string;
  itemId?: string;
}

export async function readOpenEmail(maxBody = 30000): Promise<OpenEmail | null> {
  const it = item();
  if (!it) return null;
  const Office = office();
  if (isCompose()) {
    const [subject, to, cc, body] = await Promise.all([
      asyncCall<string>(cb => it.subject.getAsync(cb)).catch(() => ""),
      asyncCall<any[]>(cb => it.to.getAsync(cb)).catch(() => []),
      asyncCall<any[]>(cb => it.cc.getAsync(cb)).catch(() => []),
      asyncCall<string>(cb => it.body.getAsync(Office.CoercionType.Text, cb)).catch(() => ""),
    ]);
    return { mode: "compose", subject, to: people(to), cc: people(cc), body: String(body || "").slice(0, maxBody), attachments: [], conversationId: it.conversationId || undefined };
  }
  const body = await asyncCall<string>(cb => it.body.getAsync(Office.CoercionType.Text, cb)).catch(() => "");
  return {
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
  };
}

export function emailContext(e: OpenEmail | null): string {
  if (!e) return "";
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

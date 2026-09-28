// ChatBGP in Outlook (Woody, 2026-09-28: "make both as good as the Claude
// add-ins"). Same bridge as Excel (server/excel-agent.ts): the model calls
// outlook_* tools, the task pane carries them out with Office.js on the open
// email and returns the result.
export const OUTLOOK_TOOL_DEFS: any[] = [
  {
    name: "outlook_read_email",
    description: "The email open in Outlook: subject, sender, recipients, date, full body text, attachment names, and whether the user is reading or composing it.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "outlook_draft_reply",
    description: "Open Outlook's reply (or reply-all) window to the open email with your drafted text in it, ready for the user to review and send. Use for replies to an email the user is reading.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string", description: "Reply body as simple HTML (<p>, <br>, <ul>, <b>). No signature — Outlook adds the user's own." },
        replyAll: { type: "boolean" },
      },
      required: ["html"],
    },
  },
  {
    name: "outlook_write_compose",
    description: "When the user is composing a message: insert text at the cursor, or replace the body, and optionally set the subject or add recipients.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string" },
        mode: { type: "string", enum: ["insert", "replace", "prepend"] },
        subject: { type: "string" },
        to: { type: "array", items: { type: "string" } },
        cc: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "outlook_new_email",
    description: "Open a new email window with recipients, subject and body filled in, for the user to review and send.",
    parameters: {
      type: "object",
      properties: { to: { type: "array", items: { type: "string" } }, cc: { type: "array", items: { type: "string" } }, subject: { type: "string" }, html: { type: "string" } },
      required: ["subject", "html"],
    },
  },
  {
    name: "outlook_new_meeting",
    description: "Open a new calendar invitation with attendees, time, location and agenda filled in, for the user to check and send.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string" }, attendees: { type: "array", items: { type: "string" } },
        start: { type: "string", description: "ISO date-time, UK time" }, end: { type: "string" },
        location: { type: "string" }, body: { type: "string" },
      },
      required: ["subject", "start", "end"],
    },
  },
].map(t => ({ type: "function", function: t }));

export const OUTLOOK_TOOL_NAMES = new Set(OUTLOOK_TOOL_DEFS.map((t: any) => t.function.name));

export const OUTLOOK_AGENT_PROMPT = `

## OUTLOOK — you are ChatBGP working on the email the user has open
You are the full ChatBGP (CRM, deals, properties, comps, requirements, SharePoint, knowledge bank, email and calendar search, tasks, memory) AND you work the open email through the outlook_* tools, which the Outlook pane carries out live.

How to work:
- The open email is summarised below; call outlook_read_email when you need the full body or it may have changed.
- Ground every answer in BGP's own records: look the sender and their company up in the CRM, check live deals, requirements, recent emails and meetings with them before advising or drafting. Say what you found ("They're on the Brixton Village deal at HoTs…").
- Drafting: write in the user's voice — warm, brief, direct, UK English, no corporate filler, no sign-off block (Outlook adds the signature). Use outlook_draft_reply to put the reply into Outlook's reply window (reply-all when others are copied and it matters), or outlook_write_compose when the user is already writing. Never send anything yourself — the user reviews and sends.
- Follow-ups: offer to create a task, a calendar invite (outlook_new_meeting), log the email to the CRM, or update a deal / requirement when the email changes something.
- Keep your chat reply short: what you did or found, and anything the user must decide.
`;

export function outlookToolLabel(name: string, a: any): string {
  switch (name) {
    case "outlook_read_email": return "Reading the email…";
    case "outlook_draft_reply": return a?.replyAll ? "Drafting a reply-all…" : "Drafting a reply…";
    case "outlook_write_compose": return "Writing into your message…";
    case "outlook_new_email": return "Opening a new email…";
    case "outlook_new_meeting": return "Opening a calendar invite…";
    default: return "Working in Outlook…";
  }
}

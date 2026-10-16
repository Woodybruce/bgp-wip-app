import { useCallback } from "react";
import { AddinAgentChat } from "@/components/addin-agent-chat";
import { readOpenEmail, emailContext, runOutlookTool, isCompose, isAppointment } from "@/lib/outlook-agent-tools";

const READ_PROMPTS = [
  { label: "Summarise", prompt: "Summarise this email thread and tell me what they want from us." },
  { label: "Draft a reply", prompt: "Draft a reply to this, using what we know about them from the CRM." },
  { label: "Who is this?", prompt: "Who is this sender — what's our relationship, live deals, requirements and last contact?" },
  { label: "Follow-ups", prompt: "What follow-ups come out of this email? Offer tasks, a meeting or CRM updates." },
];
const COMPOSE_PROMPTS = [
  { label: "Improve my draft", prompt: "Tighten and improve what I've written so far, keeping my voice." },
  { label: "Write this for me", prompt: "Write this email for me based on the subject and recipients, using what we know from the CRM." },
  { label: "Add BGP facts", prompt: "Check the facts in my draft against the CRM (deal terms, dates, names) and correct anything wrong." },
];

// Calendar items (Woody, 2026-10-15).
const MEETING_PROMPTS = [
  { label: "Brief me", prompt: "Brief me for this meeting: who's attending, our relationship with each of them and their company, live deals, requirements and recent emails, and what I should raise." },
  { label: "Who's coming?", prompt: "Who are the attendees — role, company, what we know about them in the CRM and when we last spoke?" },
  { label: "Prep notes", prompt: "Draft short prep notes for this meeting: objectives, points to raise, questions to ask, and anything to watch, from the CRM and recent emails." },
  { label: "Follow-ups", prompt: "After this meeting, what should happen? Offer to log it to the CRM, create tasks and send a follow-up email." },
];
const MEETING_COMPOSE_PROMPTS = [
  { label: "Write the invite", prompt: "Write the invite text for this meeting — purpose and a short agenda — using what we know about the attendees from the CRM." },
  { label: "Suggest agenda", prompt: "Suggest an agenda for this meeting based on the attendees, our live deals with them and recent emails." },
  { label: "Who to include", prompt: "Looking at the attendees and what we have with their company, is anyone missing from this invite?" },
];

// ChatBGP inside Outlook, remembered per email thread (or per meeting).
export function OutlookChat({ token, onUnauthorised }: { token: string; onUnauthorised: () => void }) {
  const readDoc = useCallback(async () => {
    const e = await readOpenEmail();
    if (!e) return null;
    if (e.kind === "appointment") {
      const start = e.start ? new Date(e.start).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
      return {
        key: `outlook-meeting:${e.itemId || e.conversationId || e.subject || "meeting"}`,
        context: emailContext(e),
        label: `${e.mode === "compose" ? "Organising" : "Meeting"}: ${e.subject || "(no title)"}${start ? ` · ${start}` : ""}`,
      };
    }
    return {
      key: `outlook:${e.conversationId || e.subject || "email"}`,
      context: emailContext(e),
      label: `${e.mode === "compose" ? "Writing" : "Reading"}: ${e.subject || "(no subject)"}${e.from ? ` · from ${e.from}` : ""}`,
    };
  }, []);
  const watch = useCallback((reload: () => void) => {
    const Office = (window as any).Office;
    try { Office.context.mailbox.addHandlerAsync(Office.EventType.ItemChanged, () => reload()); } catch {}
  }, []);
  return (
    <AddinAgentChat
      host="outlook" token={token} onUnauthorised={onUnauthorised}
      readDoc={readDoc} runTool={runOutlookTool} watch={watch}
      prompts={isAppointment() ? (isCompose() ? MEETING_COMPOSE_PROMPTS : MEETING_PROMPTS) : isCompose() ? COMPOSE_PROMPTS : READ_PROMPTS}
      intro={isAppointment() ? "ChatBGP works on this meeting — who's coming, what we have with them, prep and follow-ups." : "ChatBGP works on this email with BGP's CRM, deals and your memory behind it."}
      placeholder={isAppointment() ? "Ask ChatBGP about this meeting…" : "Ask ChatBGP about this email…"}
    />
  );
}

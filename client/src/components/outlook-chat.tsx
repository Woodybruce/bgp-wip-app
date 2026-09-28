import { useCallback } from "react";
import { AddinAgentChat } from "@/components/addin-agent-chat";
import { readOpenEmail, emailContext, runOutlookTool, isCompose } from "@/lib/outlook-agent-tools";

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

// ChatBGP inside Outlook, remembered per email thread.
export function OutlookChat({ token, onUnauthorised }: { token: string; onUnauthorised: () => void }) {
  const readDoc = useCallback(async () => {
    const e = await readOpenEmail();
    if (!e) return null;
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
      prompts={isCompose() ? COMPOSE_PROMPTS : READ_PROMPTS}
      intro="ChatBGP works on this email with BGP's CRM, deals and your memory behind it."
      placeholder="Ask ChatBGP about this email…"
    />
  );
}

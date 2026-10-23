import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bold, Check, Copy, Download, Italic, List, Loader2, Mail, Pencil } from "lucide-react";
import DOMPurify from "dompurify";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { extractChatEmailDraft } from "@shared/chat-email-draft";
import { exportRichTextText, renderEmailHtml } from "@shared/chat-rich-text";
import { ChatBGPMarkdown } from "@/components/chatbgp-markdown";
import { copyChatContent } from "@/lib/chat-clipboard";
import { getAuthHeaders } from "@/lib/queryClient";

class DraftRequestError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

const converter = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
converter.use(gfm);

function safeOutlookLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && ["outlook.office.com", "outlook.office365.com", "outlook.live.com", "outlook.cloud.microsoft"].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

async function draftRequest(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST", credentials: "include",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new DraftRequestError(error.error || "The draft could not be saved. Please try again.", error.code);
  }
  return response;
}

export function ChatResponse({ content, threadId, messageId, originalContent = content, onDraftSaved, renderBefore, children, actions = true }: {
  content: string; threadId?: string | null; messageId?: string; originalContent?: string;
  onDraftSaved?: (content: string) => void; renderBefore?: (content: string) => ReactNode;
  children?: ReactNode; actions?: boolean;
}) {
  const draft = useMemo(() => extractChatEmailDraft(content), [content]);
  if (draft && actions) return <>
    {draft.before && (renderBefore ? renderBefore(draft.before) : <ChatBGPMarkdown content={draft.before} />)}
    <EmailDraftCard key={`${draft.subject}\n${draft.bodyMarkdown}`} subject={draft.subject} body={draft.bodyMarkdown} threadId={threadId} messageId={messageId} originalContent={originalContent} onSaved={onDraftSaved} />
  </>;
  return <>
    {children ?? <ChatBGPMarkdown content={content} />}
    {actions && content.trim() && <ResponseActions markdown={content} threadId={threadId} />}
  </>;
}

function ResponseActions({ markdown, subject, threadId, disabled = false }: { markdown: string; subject?: string; threadId?: string | null; disabled?: boolean }) {
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [outlook, setOutlook] = useState<{ link: string | null; fingerprint: string } | null>(null);
  const [needsConnection, setNeedsConnection] = useState(false);
  const connectionWindow = useRef<Window | null>(null);
  const fingerprint = `${subject || ""}\n${markdown}`;
  useEffect(() => { setStatus(""); setError(false); }, [fingerprint]);
  useEffect(() => {
    const connected = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !connectionWindow.current || event.source !== connectionWindow.current) return;
      if (event.data?.type === "microsoft_draft_connection_failed") {
        connectionWindow.current = null; setError(true);
        setStatus("Outlook draft access was not connected. You can try again, or copy the email into Outlook yourself.");
        return;
      }
      if (event.data?.type !== "microsoft_connected" || event.data?.purpose !== "chat-drafts") return;
      connectionWindow.current = null;
      setNeedsConnection(false); setError(false);
      setStatus("Outlook connected. Choose Create Outlook draft when you are ready.");
    };
    window.addEventListener("message", connected);
    return () => window.removeEventListener("message", connected);
  }, []);
  const run = async (name: string, work: () => Promise<string>) => {
    if (busy || disabled) return;
    setBusy(name); setStatus(""); setError(false);
    try { setStatus(await work()); } catch (e) {
      setError(true); setStatus(e instanceof Error ? e.message : "That action could not be completed.");
      if (e instanceof DraftRequestError && e.code === "MICROSOFT_DRAFT_PERMISSION_REQUIRED") setNeedsConnection(true);
    }
    finally { setBusy(null); }
  };
  const buttonClass = "inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50";
  return <div className="mt-2 whitespace-normal" data-testid="chat-response-actions">
    <div className="flex flex-wrap items-center gap-1">
      <button type="button" className={buttonClass} disabled={!!busy || disabled} onClick={() => run("copy", async () => {
        const format = await copyChatContent(markdown);
        return format === "formatted" ? "Copied with formatting. Paste directly into your email." : "Copied as plain text — this browser did not allow formatted copying. Word download preserves the layout.";
      })} data-testid="copy-formatted-reply"><Copy className="h-3.5 w-3.5" />{subject ? "Copy email" : "Copy formatted"}</button>
      <button type="button" className={buttonClass} disabled={!!busy || disabled} onClick={() => run("plain", async () => {
        await copyChatContent(markdown, false); return "Plain text copied.";
      })}>Copy plain text</button>
      <button type="button" className={buttonClass} disabled={!!busy || disabled} onClick={() => run("word", async () => {
        const response = await draftRequest("/api/chat-drafts/word", { subject: subject || "BGP note", bodyMarkdown: markdown, ...(threadId ? { threadId } : {}) });
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url; link.download = `${exportRichTextText(subject || "BGP note").replace(/[^a-z0-9 -]/gi, "").slice(0, 80) || "BGP note"}.docx`;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return "Word document downloaded.";
      })} data-testid="download-chat-word"><Download className="h-3.5 w-3.5" />Word</button>
      {subject && <button type="button" className={buttonClass} disabled={!!busy || disabled || outlook?.fingerprint === fingerprint} onClick={() => run("outlook", async () => {
        // Stable across a reload or a lost response. The server additionally
        // scopes this key to the authenticated user and checks the payload.
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bgp-chat-draft\n${threadId || ""}\n${fingerprint}`)));
        const hex = Array.from(digest.slice(0, 16), value => value.toString(16).padStart(2, "0"));
        const raw = hex.join("");
        const idempotencyKey = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-${((parseInt(raw[16], 16) & 3) | 8).toString(16)}${raw.slice(17, 20)}-${raw.slice(20)}`;
        const response = await draftRequest("/api/chat-drafts/outlook", { subject, bodyMarkdown: markdown, idempotencyKey, ...(threadId ? { threadId } : {}) });
        const saved = await response.json();
        setOutlook({ link: safeOutlookLink(saved.webLink), fingerprint });
        return "Saved in your Outlook Drafts. Nothing has been sent.";
      })} data-testid="create-outlook-draft">{outlook?.fingerprint === fingerprint ? <Check className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}{outlook?.fingerprint === fingerprint ? "Draft saved" : outlook ? "Create revised Outlook draft" : "Create Outlook draft"}</button>}
      {outlook?.link && <a href={outlook.link} target="_blank" rel="noopener noreferrer" className={buttonClass}>Open Outlook draft</a>}
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Working" />}
    </div>
    {status && <p className={`mt-1 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`} role={error ? "alert" : "status"}>{status}</p>}
    {needsConnection && <div className="mt-2 rounded-md border p-3 text-xs">
      <p>Microsoft will ask you to allow BGP to read and write mail in your own account so it can save drafts. This action does not send emails.</p>
      <button type="button" className={buttonClass} disabled={!!busy || disabled} onClick={() => {
        const popup = window.open("about:blank", "bgp-outlook-draft-connect", "width=600,height=760");
        connectionWindow.current = popup;
        void run("connect", async () => {
          try {
            const response = await fetch("/api/microsoft/auth?purpose=chat-drafts", { credentials: "include", headers: getAuthHeaders() });
            if (!response.ok) throw new Error("Could not start Outlook connection. Please sign in to BGP and try again.");
            const data = await response.json();
            const url = new URL(data.authUrl);
            if (url.protocol !== "https:" || url.hostname !== "login.microsoftonline.com") throw new Error("Microsoft returned an unexpected sign-in address.");
            if (!popup) throw new Error("Allow pop-ups for BGP, then choose Connect Outlook drafts again.");
            popup.location.href = url.href;
            return "Complete the Microsoft sign-in window, then return here.";
          } catch (e) { popup?.close(); connectionWindow.current = null; throw e; }
        });
      }}>Connect Outlook drafts</button>
    </div>}
  </div>;
}

function EmailDraftCard({ subject: initialSubject, body: initialBody, threadId, messageId, originalContent, onSaved }: {
  subject: string; body: string; threadId?: string | null; messageId?: string; originalContent: string; onSaved?: (content: string) => void;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const canSave = Boolean(threadId && messageId && onSaved);
  const editor = useRef<HTMLDivElement>(null);
  const initialHtml = useRef("");
  useEffect(() => {
    if (editing && editor.current) editor.current.innerHTML = initialHtml.current;
  }, [editing]);
  const readEditor = () => {
    if (!editor.current) return body;
    return converter.turndown(DOMPurify.sanitize(editor.current.innerHTML, {
      ALLOWED_TAGS: ["p", "div", "br", "strong", "b", "em", "i", "u", "s", "del", "ul", "ol", "li", "h1", "h2", "h3", "h4", "blockquote", "a", "table", "thead", "tbody", "tr", "th", "td", "code", "pre", "hr"],
      ALLOWED_ATTR: ["href", "start"],
    }));
  };
  const format = (command: string) => {
    editor.current?.focus();
    document.execCommand(command);
  };
  return <section className="my-3 min-w-0 overflow-hidden rounded-xl border border-border bg-background text-foreground whitespace-normal" data-testid="email-draft-card" aria-label="Email draft">
    <div className="flex items-center justify-between border-b border-border px-4 py-2">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Mail className="h-4 w-4" />Email draft</span>
      <div className="flex items-center gap-3">
      {editing && <button type="button" disabled={saving} className="min-h-[44px] text-xs text-muted-foreground" onClick={() => {
        setSubject(initialSubject); setBody(initialBody); setSaveError(""); setEditing(false);
      }}>Cancel</button>}
      <button type="button" disabled={saving || (editing && !subject.trim())} className="inline-flex min-h-[44px] items-center gap-1.5 text-xs hover:text-primary disabled:opacity-50" onClick={async () => {
        if (!editing) { initialHtml.current = renderEmailHtml(body); setSaveError(""); setEditing(true); return; }
        const editedBody = readEditor();
        if (!editedBody.trim()) { setSaveError("Add the email body before saving."); return; }
        if (!canSave) { setBody(editedBody); setEditing(false); return; }
        setSaving(true); setSaveError("");
        try {
          const response = await draftRequest("/api/chat-drafts/edit", { threadId, messageId, expectedContent: originalContent, subject, bodyMarkdown: editedBody });
          const saved = await response.json();
          onSaved?.(saved.content); setBody(editedBody); setEditing(false);
        } catch (e) { setSaveError(e instanceof Error ? e.message : "Could not save your edits. They are still in the editor."); }
        finally { setSaving(false); }
      }} data-testid="edit-email-draft">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}{saving ? "Saving" : editing ? (canSave ? "Save edits" : "Apply edits") : "Edit draft"}</button>
      </div>
    </div>
    <div className="border-b border-border px-4 py-3">
      <div className="block text-[11px] font-medium text-muted-foreground">Subject</div>
      {editing ? <input aria-label="Email subject" value={subject} disabled={saving} onChange={e => setSubject(e.target.value)} maxLength={200} className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm" /> : <div className="mt-1 text-sm font-medium" data-testid="email-subject">{subject}</div>}
    </div>
    <div className="px-4 py-3">
      {editing ? <>
        <div className="mb-2 flex gap-1 border-b pb-2">
          {[["bold", Bold, "Bold"], ["italic", Italic, "Italic"], ["insertUnorderedList", List, "Bullet list"]].map(([command, Icon, label]) => {
            const Glyph = Icon as typeof Bold;
            return <button key={command as string} type="button" disabled={saving} title={label as string} aria-label={label as string} className="rounded p-2 hover:bg-muted" onMouseDown={e => e.preventDefault()} onClick={() => format(command as string)}><Glyph className="h-4 w-4" /></button>;
          })}
        </div>
        <div ref={editor} contentEditable={!saving} suppressContentEditableWarning role="textbox" aria-label="Email body" aria-multiline="true" className="min-h-[180px] max-h-[60vh] overflow-auto rounded border bg-white p-3 text-sm text-black outline-none focus:ring-2 focus:ring-primary/30" onPaste={e => {
          // Strip external styling and executable content before it reaches the editor.
          const html = e.clipboardData.getData("text/html");
          if (html) { e.preventDefault(); document.execCommand("insertHTML", false, DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "img", "iframe", "form"], FORBID_ATTR: ["style", "class", "id"] })); }
        }} />
        <p className="mt-2 text-xs text-muted-foreground">{canSave ? "Save edits to keep this draft in the conversation before copying or exporting." : "This preview keeps edits in this view only. Copy or export them before leaving."}</p>
      </> : <div className="text-sm leading-relaxed"><ChatBGPMarkdown content={body} /></div>}
      {saveError && <p role="alert" className="mt-2 text-xs text-destructive">{saveError}</p>}
      <ResponseActions markdown={body} subject={subject} threadId={threadId} disabled={editing || !subject.trim() || !body.trim()} />
    </div>
  </section>;
}

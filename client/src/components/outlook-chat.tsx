import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatBGPMarkdown } from "@/components/chatbgp-markdown";
import { readOpenEmail, emailContext, runOutlookTool, isCompose, type OpenEmail } from "@/lib/outlook-agent-tools";

interface ChatMessage { id: string; role: "user" | "assistant"; content: string; steps?: string[] }

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

const threadKey = (e: OpenEmail | null) => e ? `outlook:${e.conversationId || e.subject || "email"}` : "";

// ChatBGP inside Outlook: the full brain, working on the open email through
// the outlook_* tools (server/outlook-agent.ts), with a remembered
// conversation per email thread.
export function OutlookChat({ token, onUnauthorised }: { token: string; onUnauthorised: () => void }) {
  const [email, setEmail] = useState<OpenEmail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const [liveSteps, setLiveSteps] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headers = useCallback((): Record<string, string> => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` }), [token]);

  const loadEmail = useCallback(async () => {
    const e = await readOpenEmail().catch(() => null);
    setEmail(e);
    setMessages([]);
    const key = threadKey(e);
    if (!key) return;
    try {
      const r = await fetch(`/api/chatbgp/excel-session?workbook=${encodeURIComponent(key)}`, { headers: headers() });
      if (r.ok) {
        const saved = await r.json();
        const prior = (saved?.messages || []).filter((m: any) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
        if (prior.length) setMessages(prior.map((m: any) => ({ id: crypto.randomUUID(), role: m.role, content: m.content })));
      }
    } catch {}
  }, [headers]);

  useEffect(() => {
    const Office = (window as any).Office;
    if (!Office) return;
    Office.onReady((info: any) => {
      if (info.host !== "Outlook") return;
      loadEmail();
      try { Office.context.mailbox.addHandlerAsync(Office.EventType.ItemChanged, () => loadEmail()); } catch {}
    });
  }, [loadEmail]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, liveText, liveSteps]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: msg };
    const history = [...messages, userMsg];
    setMessages(history);
    setLoading(true);
    setLiveText("");
    setLiveSteps([]);
    setProgress("Thinking…");
    const fresh = await readOpenEmail().catch(() => email);
    if (fresh) setEmail(fresh);
    const steps: string[] = [];
    let reply = "";
    let streamed = "";
    try {
      const res = await fetch("/api/chatbgp/addin-chat", {
        method: "POST", headers: headers(),
        body: JSON.stringify({
          host: "outlook", clientTools: "1",
          messages: history.map(m => ({ role: m.role, content: m.content })),
          excelContext: emailContext(fresh),
          workbookName: threadKey(fresh) || undefined,
        }),
      });
      if (res.status === 401) { onUnauthorised(); return; }
      if (!res.ok || !res.body) throw new Error(`Server error ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handle = async (data: any) => {
        if (data.progress) setProgress(String(data.progress));
        if (data.roundStart) { streamed = ""; setLiveText(""); }
        if (typeof data.delta === "string") { streamed += data.delta; setLiveText(streamed); }
        if (data.reply) reply = data.reply;
        if (data.excelTool) {
          const { runId, callId, name, args } = data.excelTool;
          const result = await runOutlookTool(name, args || {});
          steps.push(result?.error ? `${name.replace("outlook_", "").replace(/_/g, " ")} — ${result.error}` : String(result?.done || name.replace("outlook_", "Read ").replace(/_/g, " ")));
          setLiveSteps([...steps]);
          await fetch("/api/chatbgp/excel-tool-result", { method: "POST", headers: headers(), body: JSON.stringify({ runId, callId, result }) }).catch(() => {});
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let data: any = null;
          try { data = JSON.parse(line.slice(6)); } catch {}
          if (data) await handle(data);
        }
      }
      if (buffer.startsWith("data: ")) { try { await handle(JSON.parse(buffer.slice(6))); } catch {} }
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: "assistant", content: reply || streamed || "Sorry, no answer came back.", steps: steps.length ? steps : undefined }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: "assistant", content: `Sorry — ${e?.message || "that didn't work"}. Try again.` }]);
    } finally {
      setLoading(false);
      setProgress(null);
      setLiveText("");
      setLiveSteps([]);
    }
  };

  const clear = async () => {
    setMessages([]);
    const key = threadKey(email);
    if (key) fetch(`/api/chatbgp/excel-session?workbook=${encodeURIComponent(key)}`, { method: "DELETE", headers: headers() }).catch(() => {});
  };

  const prompts = email?.mode === "compose" || isCompose() ? COMPOSE_PROMPTS : READ_PROMPTS;

  return (
    <div className="flex flex-col h-[calc(100vh-112px)]" data-testid="outlook-chat">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {email && (
          <p className="text-[11px] text-muted-foreground truncate" title={email.subject}>
            {email.mode === "compose" ? "Writing" : "Reading"}: <span className="text-foreground">{email.subject || "(no subject)"}</span>
            {email.from ? ` · from ${email.from}` : ""}
          </p>
        )}
        {messages.length === 0 && !loading && (
          <div className="pt-4 text-center">
            <Sparkles className="w-6 h-6 text-primary mx-auto mb-2" />
            <p className="text-[12px] text-muted-foreground mb-3">ChatBGP works on this email with BGP's CRM, deals and your memory behind it.</p>
            <div className="grid grid-cols-2 gap-1.5">
              {prompts.map(p => (
                <button key={p.label} type="button" onClick={() => send(p.prompt)} className="rounded-lg border px-2 py-2 text-[11px] font-medium text-left hover:bg-muted/50">{p.label}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map(m => m.role === "user" ? (
          <div key={m.id} className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-[13px] bg-primary text-primary-foreground">{m.content}</div></div>
        ) : (
          <div key={m.id} className="text-[13px] leading-relaxed">
            {m.steps && <ul className="mb-1 text-[11px] text-muted-foreground space-y-0.5">{m.steps.map((s, i) => <li key={i}>✓ {s}</li>)}</ul>}
            <ChatBGPMarkdown content={m.content} />
          </div>
        ))}
        {loading && (
          <div className="text-[13px] leading-relaxed">
            {liveSteps.length > 0 && <ul className="mb-1 text-[11px] text-muted-foreground space-y-0.5">{liveSteps.map((s, i) => <li key={i}>✓ {s}</li>)}</ul>}
            {liveText && <ChatBGPMarkdown content={liveText} />}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1"><Loader2 className="w-3 h-3 animate-spin" />{progress || "Thinking…"}</p>
          </div>
        )}
      </div>
      <div className="border-t px-3 py-2 space-y-1.5">
        <div className="flex items-end gap-1.5">
          <Textarea value={input} onChange={e => setInput(e.target.value)} rows={2} placeholder="Ask ChatBGP about this email…"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); send(); } }}
            className="text-[13px] min-h-[44px] resize-none" data-testid="input-outlook-chat" />
          <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => send()} disabled={loading || !input.trim()} aria-label="Send"><Send className="w-4 h-4" /></Button>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={clear} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" />New conversation for this thread</button>
        )}
      </div>
    </div>
  );
}

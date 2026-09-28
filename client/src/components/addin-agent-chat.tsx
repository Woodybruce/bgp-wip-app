import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatBGPMarkdown } from "@/components/chatbgp-markdown";

interface ChatMessage { id: string; role: "user" | "assistant"; content: string; steps?: string[] }

export interface AgentDoc {
  key: string;        // conversation memory key (per email thread / document)
  context: string;    // snapshot sent with each turn
  label: string;      // one line shown above the chat
}

export interface AgentChatProps {
  host: "outlook" | "word" | "powerpoint";
  token: string;
  onUnauthorised: () => void;
  readDoc: () => Promise<AgentDoc | null>;
  runTool: (name: string, args: any) => Promise<any>;
  prompts: Array<{ label: string; prompt: string }>;
  intro: string;
  placeholder: string;
  // Called with a reload function for hosts that change document under the pane.
  watch?: (reload: () => void) => void;
  // Extra top-bar controls (e.g. Word's tracked-changes switch).
  toolbar?: React.ReactNode;
  heightOffset?: number;
}

const stepText = (name: string, result: any) =>
  result?.error ? `${name.replace(/^(outlook|word|ppt)_/, "").replace(/_/g, " ")} — ${result.error}` : String(result?.done || name.replace(/^(outlook|word|ppt)_/, "").replace(/_/g, " "));

// ChatBGP in an Office pane: the full brain working on the open item through
// host tools (server/outlook-agent.ts, server/office-agents.ts), streamed,
// with the conversation remembered per document / email thread.
export function AddinAgentChat({ host, token, onUnauthorised, readDoc, runTool, prompts, intro, placeholder, watch, toolbar, heightOffset = 112 }: AgentChatProps) {
  const [doc, setDoc] = useState<AgentDoc | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const [liveSteps, setLiveSteps] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headers = useCallback((): Record<string, string> => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    const d = await readDoc().catch(() => null);
    setDoc(d);
    setMessages([]);
    if (!d?.key) return;
    try {
      const r = await fetch(`/api/chatbgp/excel-session?workbook=${encodeURIComponent(d.key)}`, { headers: headers() });
      if (r.status === 401) { onUnauthorised(); return; }
      if (r.ok) {
        const saved = await r.json();
        const prior = (saved?.messages || []).filter((m: any) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
        if (prior.length) setMessages(prior.map((m: any) => ({ id: crypto.randomUUID(), role: m.role, content: m.content })));
      }
    } catch {}
  }, [headers, readDoc, onUnauthorised]);

  useEffect(() => {
    const Office = (window as any).Office;
    if (!Office?.onReady) { load(); return; }
    Office.onReady(() => { load(); watch?.(load); });
  }, [load, watch]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, liveText, liveSteps]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    const history = [...messages, { id: crypto.randomUUID(), role: "user" as const, content: msg }];
    setMessages(history);
    setLoading(true);
    setLiveText("");
    setLiveSteps([]);
    setProgress("Thinking…");
    const fresh = await readDoc().catch(() => doc);
    if (fresh) setDoc(fresh);
    const steps: string[] = [];
    let reply = "";
    let streamed = "";
    try {
      const res = await fetch("/api/chatbgp/addin-chat", {
        method: "POST", headers: headers(),
        body: JSON.stringify({
          host, clientTools: "1",
          messages: history.map(m => ({ role: m.role, content: m.content })),
          excelContext: fresh?.context || undefined,
          workbookName: fresh?.key || undefined,
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
          const result = await runTool(name, args || {});
          steps.push(stepText(name, result));
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

  const clear = () => {
    setMessages([]);
    if (doc?.key) fetch(`/api/chatbgp/excel-session?workbook=${encodeURIComponent(doc.key)}`, { method: "DELETE", headers: headers() }).catch(() => {});
  };

  return (
    <div className="flex flex-col" style={{ height: `calc(100vh - ${heightOffset}px)` }} data-testid={`${host}-agent-chat`}>
      {toolbar}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {doc?.label && <p className="text-[11px] text-muted-foreground truncate" title={doc.label}>{doc.label}</p>}
        {messages.length === 0 && !loading && (
          <div className="pt-4 text-center">
            <Sparkles className="w-6 h-6 text-primary mx-auto mb-2" />
            <p className="text-[12px] text-muted-foreground mb-3">{intro}</p>
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
            {m.steps && (
              <details className="mb-1 text-[11px] text-muted-foreground">
                <summary className="cursor-pointer select-none">{m.steps.length} step{m.steps.length === 1 ? "" : "s"}</summary>
                <ul className="mt-1 space-y-0.5 pl-3">{m.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </details>
            )}
            <ChatBGPMarkdown content={m.content} />
          </div>
        ))}
        {loading && (
          <div className="text-[13px] leading-relaxed">
            {liveSteps.length > 0 && <p className="mb-1 text-[11px] text-muted-foreground truncate">{liveSteps.length} step{liveSteps.length === 1 ? "" : "s"} · {liveSteps[liveSteps.length - 1]}</p>}
            {liveText && <ChatBGPMarkdown content={liveText} />}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1"><Loader2 className="w-3 h-3 animate-spin" />{progress || "Thinking…"}</p>
          </div>
        )}
      </div>
      <div className="border-t px-3 py-2 space-y-1.5">
        <div className="flex items-end gap-1.5">
          <Textarea value={input} onChange={e => setInput(e.target.value)} rows={2} placeholder={placeholder}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); send(); } }}
            className="text-[13px] min-h-[44px] resize-none" data-testid={`input-${host}-chat`} />
          <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => send()} disabled={loading || !input.trim()} aria-label="Send"><Send className="w-4 h-4" /></Button>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={clear} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" />Start a new conversation</button>
        )}
      </div>
    </div>
  );
}

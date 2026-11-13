// Chat for a Landsec joint agent (Woody, 13 November 2026: "yes go ahead").
// A joint agent is another agency, so this is its own small chat and not the
// staff chat panel: it calls only the addresses the gateway opens to it
// (shared/landsec.ts) and offers no control the server refuses. Two tabs:
// Messages (conversations with BGP and the Landsec people at its schemes)
// and ChatBGP (its own chats, answered from its own schemes only). The rules
// are on the server (server/chat-joint-agent.ts, server/chatbgp-joint-agent.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Paperclip, Plus, Send, Sparkles, Square, Trash2, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pill, PillCount } from "@/components/ui/pill";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { getSocket } from "@/lib/socket";
import { useToast } from "@/hooks/use-toast";

export const JOINT_AGENT_CHATBGP_LINE = "ChatBGP answers from your schemes: units, viewings, offers, heads of terms, checklists and tasks.";

type Kind = "team" | "own_ai";
interface Member { id: string; name: string; seen: boolean }
interface Message { id: string; threadId: string; role: string; userId: string | null; createdAt: string; content: string; attachments: string[] | null }
interface Thread {
  id: string; title: string | null; createdBy: string; kind: Kind; creatorName: string; updatedAt: string;
  members: Member[]; lastMessage?: { content: string; senderName: string; createdAt: string } | null; messages?: Message[];
}
interface TagResult { type: "user" | "unit" | "deal"; id: string; name: string }
interface PendingTag { label: string; token: string }
interface Attachment { url: string; name: string | null; size: number | null; type: string | null }

const TAG = /@\[([^\]]*)\]\(tag:([a-z_]+)\/([^)\s]*)\)/gi;

async function getJson<T>(url: string): Promise<T> {
  return (await apiRequest("GET", url)).json();
}
// The server's own words, without the status code apiRequest puts in front.
function plainError(e: any, fallback: string): string {
  const m = String(e?.message || "").replace(/^\d{3}:\s*/, "").trim();
  return m || fallback;
}
function when(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function parseAttachment(raw: string): Attachment | null {
  try {
    const a = JSON.parse(raw);
    return a && typeof a.url === "string" && /^\/api\/chat-media\/[^/]+$/.test(a.url) ? a : null;
  } catch { return null; }
}

// A message's text. A unit opens the joint agent's own tracker and a deal
// its own Deals page; a person is plain text. Nothing here links to a BGP
// page: the staff chat's tag links are never used.
function MessageText({ text, onOpen }: { text: string; onOpen: (path: string) => void }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TAG)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(<BoldText key={`t${i}`} text={text.slice(last, at)} />);
    const type = m[2].toLowerCase();
    const name = m[1];
    const path = type === "unit" ? `/landsec/tracker?unit=${encodeURIComponent(m[3])}` : type === "deal" ? "/landsec/deals" : null;
    parts.push(path
      ? <button key={`c${i}`} type="button" data-no-min-touch onClick={() => onOpen(path)} data-testid={`ja-chat-tag-${type}`}
          className="inline rounded bg-muted px-1 py-px text-[0.92em] font-medium text-foreground underline-offset-2 hover:underline">{name}</button>
      : <span key={`c${i}`} className="font-semibold">@{name}</span>);
    last = at + m[0].length;
    i++;
  }
  if (last < text.length) parts.push(<BoldText key="end" text={text.slice(last)} />);
  return <span className="whitespace-pre-wrap break-words">{parts}</span>;
}
function BoldText({ text }: { text: string }) {
  const bits = text.split(/(\*\*[^*\n]+\*\*)/g);
  return <>{bits.map((b, i) => (b.startsWith("**") && b.endsWith("**") && b.length > 4 ? <strong key={i}>{b.slice(2, -2)}</strong> : b))}</>;
}

function AttachmentChip({ a }: { a: Attachment }) {
  const { toast } = useToast();
  const open = async () => {
    try {
      const res = await fetch(a.url, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url; link.download = a.name || "file";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch { toast({ title: "That file could not be opened", variant: "destructive" }); }
  };
  return (
    <button type="button" onClick={open} data-no-min-touch data-testid="ja-chat-attachment"
      className="mt-1 inline-flex max-w-full items-center gap-1 rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground hover:bg-muted">
      <FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{a.name || "File"}</span>
    </button>
  );
}

export function JointAgentChat({ variant, onClose }: { variant: "page" | "rail"; onClose?: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const myId: string = me?.id || "";
  const [tab, setTab] = useState<"messages" | "chatbgp">("messages");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // A new ChatBGP chat that has no thread yet: one is made on the first send.
  const [newAi, setNewAi] = useState(false);
  // One conversation view per conversation opened. A new ChatBGP chat keeps
  // its view when its thread is made, so the answer being read is not lost.
  const [viewKey, setViewKey] = useState(0);
  const openThread = (id: string) => { setViewKey(k => k + 1); setActiveId(id); };

  const threads = useQuery<Thread[]>({ queryKey: ["/api/chat/threads"], queryFn: () => getJson("/api/chat/threads"), refetchInterval: 8000 });
  const thread = useQuery<Thread>({
    queryKey: ["/api/chat/threads", activeId],
    queryFn: () => getJson(`/api/chat/threads/${activeId}`),
    enabled: !!activeId, refetchInterval: 5000, retry: false,
  });

  // A link from a notification or the old chat addresses names its thread.
  const linkDone = useRef(false);
  useEffect(() => {
    if (linkDone.current || variant !== "page" || !threads.data) return;
    let id: string | null = null;
    try { id = new URLSearchParams(window.location.search).get("thread"); } catch {}
    const t = id ? threads.data.find(x => x.id === id) : null;
    // The list can first come from the browser's saved copy, which may be
    // older than the conversation: keep looking until it has been read afresh.
    if (t || !id || threads.isFetchedAfterMount) linkDone.current = true;
    if (t) { setTab(t.kind === "own_ai" ? "chatbgp" : "messages"); openThread(t.id); }
  }, [threads.data, threads.isFetchedAfterMount, variant]);

  // A joint agent's socket is sent only the notification: a nudge to read again.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const nudge = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/notifications"] });
    };
    socket.on("notification", nudge);
    return () => { socket.off("notification", nudge); };
  }, [myId]);

  // Reading a conversation marks it seen on the server.
  useEffect(() => {
    if (thread.data) queryClient.invalidateQueries({ queryKey: ["/api/chat/notifications"] });
  }, [thread.data?.id, thread.data?.messages?.length]);

  const kind: Kind = tab === "chatbgp" ? "own_ai" : "team";
  const list = useMemo(() => (threads.data || []).filter(t => t.kind === kind), [threads.data, kind]);
  const unreadTeam = (threads.data || []).filter(t => t.kind === "team" && t.members.some(m => m.id === myId && !m.seen)).length;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    queryClient.invalidateQueries({ queryKey: ["/api/chat/notifications"] });
  };
  const switchTab = (next: "messages" | "chatbgp") => { setTab(next); setActiveId(null); setPicking(false); setNewAi(false); };
  const titleOf = (t: Thread) => {
    if (t.title) return t.title;
    if (t.kind === "own_ai") return "ChatBGP chat";
    const others = [...t.members.filter(m => m.id !== myId).map(m => m.name), ...(t.createdBy !== myId && !t.members.some(m => m.id === t.createdBy) ? [t.creatorName] : [])];
    return others.join(", ") || "Conversation";
  };

  const removeAiChat = async (t: Thread) => {
    if (!window.confirm("Delete this ChatBGP chat? This cannot be undone.")) return;
    try {
      await apiRequest("DELETE", `/api/chat/threads/${t.id}`);
      if (activeId === t.id) setActiveId(null);
      refresh();
    } catch (e) { toast({ title: "The chat could not be deleted", description: plainError(e, ""), variant: "destructive" }); }
  };

  const open = !!activeId || newAi;
  const shell = variant === "rail" ? "flex h-full w-[340px] flex-col border-l bg-background" : "flex h-full min-h-0 flex-col";

  return (
    <div className={shell} data-testid="joint-agent-chat">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {open ? (
          <button type="button" className="p-1" onClick={() => { setActiveId(null); setNewAi(false); refresh(); }} title="Back to the list" data-testid="ja-chat-back">
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : null}
        <div className="flex flex-1 items-center gap-1.5">
          <Pill active={tab === "messages"} onClick={() => switchTab("messages")} data-testid="ja-chat-tab-messages">
            Messages{unreadTeam > 0 && <PillCount n={unreadTeam} active={tab === "messages"} />}
          </Pill>
          <Pill active={tab === "chatbgp"} onClick={() => switchTab("chatbgp")} data-testid="ja-chat-tab-chatbgp">
            <Sparkles className="h-3 w-3" />ChatBGP
          </Pill>
        </div>
        {onClose && (
          <button type="button" className="p-1 text-muted-foreground hover:text-foreground" onClick={onClose} title="Close chat" data-testid="ja-chat-close">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {picking ? (
        <PeoplePicker
          onCancel={() => setPicking(false)}
          onMade={t => { setPicking(false); openThread(t.id); refresh(); }}
        />
      ) : open ? (
        <Conversation
          key={viewKey}
          kind={kind}
          thread={activeId ? thread.data : undefined}
          loading={!!activeId && thread.isLoading}
          failed={!!activeId && thread.isError}
          myId={myId}
          title={activeId && thread.data ? titleOf(thread.data) : kind === "own_ai" ? "New ChatBGP chat" : ""}
          onThread={id => { setNewAi(false); setActiveId(id); refresh(); }}
          onChanged={() => { if (activeId) queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", activeId] }); refresh(); }}
          onOpen={path => { navigate(path); onClose?.(); }}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-2 border-b px-3 py-2">
            {tab === "chatbgp" && <p className="text-xs text-muted-foreground" data-testid="ja-chatbgp-line">{JOINT_AGENT_CHATBGP_LINE}</p>}
            {tab === "messages" && <p className="text-xs text-muted-foreground">Conversations with BGP and the Landsec team at your schemes.</p>}
            <Button size="sm" className="w-full" onClick={() => { if (tab === "chatbgp") { setViewKey(k => k + 1); setNewAi(true); } else setPicking(true); }} data-testid={tab === "chatbgp" ? "ja-chatbgp-new" : "ja-chat-new"}>
              <Plus className="mr-1 h-4 w-4" />{tab === "chatbgp" ? "New ChatBGP chat" : "New conversation"}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="ja-chat-list">
            {threads.isLoading && <p className="p-4 text-sm text-muted-foreground">Loading...</p>}
            {threads.isError && <p className="p-4 text-sm text-muted-foreground" data-testid="ja-chat-list-error">Your conversations could not be loaded. Try again in a moment.</p>}
            {!threads.isLoading && !threads.isError && list.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground" data-testid="ja-chat-empty">
                {tab === "chatbgp" ? "No ChatBGP chats yet. Start one to ask about your schemes." : "No conversations yet. Start one with BGP or the Landsec team."}
              </p>
            )}
            {list.map(t => {
              const unread = t.kind === "team" && t.members.some(m => m.id === myId && !m.seen);
              return (
                <div key={t.id} className="flex items-stretch border-b hover:bg-muted/50">
                  <button type="button" onClick={() => openThread(t.id)} className="min-w-0 flex-1 px-3 py-2.5 text-left" data-testid={`ja-chat-thread-${t.id}`}>
                    <div className="flex items-baseline gap-2">
                      <span className={`min-w-0 flex-1 truncate text-sm ${unread ? "font-bold" : "font-medium"}`}>{titleOf(t)}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{when(t.lastMessage?.createdAt || t.updatedAt)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {t.lastMessage ? `${t.lastMessage.senderName}: ${t.lastMessage.content.replace(TAG, "$1")}` : "No messages yet"}
                      </span>
                      {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-foreground" data-testid="ja-chat-unread" />}
                    </div>
                  </button>
                  {t.kind === "own_ai" && (
                    <button type="button" className="px-3 text-muted-foreground hover:text-foreground" title="Delete this ChatBGP chat" onClick={() => removeAiChat(t)} data-testid={`ja-chat-delete-${t.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// The people a joint agent may start a conversation with, from the server's
// own list (names only): nobody is typed in and no directory is searched.
function PeoplePicker({ onCancel, onMade }: { onCancel: () => void; onMade: (t: Thread) => void }) {
  const { toast } = useToast();
  const people = useQuery<{ people: Array<{ id: string; name: string }> }>({ queryKey: ["/api/landsec/chat/people"], queryFn: () => getJson("/api/landsec/chat/people") });
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = (people.data?.people || []).filter(p => p.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const make = async () => {
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/chat/threads", { isAiChat: false, title: title.trim() || undefined, memberIds: picked });
      onMade(await res.json());
    } catch (e) {
      toast({ title: "The conversation could not be started", description: plainError(e, ""), variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="ja-chat-people">
      <div className="space-y-2 border-b px-3 py-2">
        <p className="text-sm font-semibold">New conversation</p>
        <p className="text-xs text-muted-foreground">Pick from BGP and the Landsec team at your schemes.</p>
        <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by name" data-testid="ja-chat-people-filter" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {people.isLoading && <p className="p-4 text-sm text-muted-foreground">Loading...</p>}
        {people.isError && <p className="p-4 text-sm text-muted-foreground">The people list could not be loaded. Try again in a moment.</p>}
        {!people.isLoading && !people.isError && shown.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nobody to show.</p>}
        {shown.map(p => {
          const on = picked.includes(p.id);
          return (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 border-b px-3 py-2.5 text-sm hover:bg-muted/50" data-testid={`ja-chat-person-${p.id}`}>
              <input type="checkbox" checked={on} onChange={() => setPicked(on ? picked.filter(x => x !== p.id) : [...picked, p.id])} />
              <span className="truncate">{p.name}</span>
            </label>
          );
        })}
      </div>
      <div className="space-y-2 border-t px-3 py-2">
        {picked.length > 1 && <Input value={title} onChange={e => setTitle(e.target.value.slice(0, 120))} placeholder="Name this conversation (optional)" data-testid="ja-chat-title" />}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={onCancel} data-testid="ja-chat-people-cancel">Cancel</Button>
          <Button size="sm" className="flex-1" disabled={!picked.length || busy} onClick={make} data-testid="ja-chat-people-start">Start</Button>
        </div>
      </div>
    </div>
  );
}

function Conversation({ kind, thread, loading, failed, myId, title, onThread, onChanged, onOpen }: {
  kind: Kind; thread: Thread | undefined; loading: boolean; failed: boolean; myId: string; title: string;
  onThread: (id: string) => void; onChanged: () => void; onOpen: (path: string) => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [tags, setTags] = useState<PendingTag[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<TagResult[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  // ChatBGP: what is streaming now, and a plain line when it could not answer.
  const [working, setWorking] = useState<{ progress: string; partial: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const messages = thread?.messages || [];
  const ai = kind === "own_ai";
  const memberIds = useMemo(() => new Set([thread?.createdBy, ...(thread?.members || []).map(m => m.id)].filter(Boolean) as string[]), [thread]);
  const nameOf = (m: Message) => (m.role === "assistant" ? "ChatBGP" : m.userId === myId ? "You" : thread?.members.find(x => x.id === m.userId)?.name || (m.userId === thread?.createdBy ? thread?.creatorName : "") || "Someone");

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages.length, working?.partial, notice]);

  // A run still going from before this screen opened (its reply is saved to
  // the chat when it lands; the conversation is read again every few seconds).
  const run = useQuery<{ active: boolean; progress?: string }>({
    queryKey: ["/api/chatbgp/threads", thread?.id, "active-run"],
    queryFn: () => getJson(`/api/chatbgp/threads/${thread!.id}/active-run`),
    enabled: ai && !!thread?.id && !working, refetchInterval: 5000,
  });
  const runElsewhere = ai && !working && !!run.data?.active;

  // The "@" menu: people in this conversation, and units and live deals at
  // the login's schemes, as the server lists them.
  const mention = ai ? null : text.match(/(?:^|\s)@([^\s@]{0,30})$/);
  const query = mention ? mention[1] : null;
  useEffect(() => {
    if (query === null) { setMenu(null); return; }
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const data = await getJson<{ results: TagResult[] }>(`/api/chat/tag-search?q=${encodeURIComponent(query)}`);
        // Only a person already in the conversation can be tagged.
        if (live) setMenu((data.results || []).filter(r => (r.type === "user" ? memberIds.has(r.id) && r.id !== myId : r.type === "unit" || r.type === "deal")));
      } catch { if (live) setMenu([]); }
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [query, memberIds, myId]);

  const pickTag = (r: TagResult) => {
    const label = `@${r.name}`;
    setText(t => t.replace(/@([^\s@]{0,30})$/, `${label} `));
    setTags(list => [...list, { label, token: `@[${r.name.replace(/[\[\]]/g, "")}](tag:${r.type}/${r.id})` }]);
    setMenu(null);
  };
  const withTokens = (raw: string) => {
    let out = raw;
    for (const t of tags) { const at = out.indexOf(t.label); if (at >= 0) out = out.slice(0, at) + t.token + out.slice(at + t.label.length); }
    return out;
  };

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    const form = new FormData();
    for (const f of Array.from(list)) form.append("files", f);
    setBusy(true);
    try {
      const res = await fetch("/api/chat/upload", { method: "POST", headers: getAuthHeaders(), credentials: "include", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.files)) throw new Error(data.message || "");
      setFiles(f => [...f, ...data.files]);
    } catch (e: any) {
      toast({ title: "The file could not be uploaded", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  };

  const askChatBgp = async (threadId: string, history: Array<{ role: string; content: string }>) => {
    setWorking({ progress: "Thinking...", partial: "" });
    try {
      const res = await fetch("/api/chatbgp/chat", {
        method: "POST", credentials: "include",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-40), threadId }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        if (data.code === "RUN_IN_PROGRESS") return;
        setNotice(/api key not configured/i.test(String(data.message || ""))
          ? "ChatBGP is not switched on here (no AI key is set), so it cannot answer. Your question is saved in this chat."
          : `ChatBGP could not answer. ${data.message || "Try again in a moment."}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let partial = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const line = block.split("\n").find(l => l.startsWith("data: "));
          if (!line) continue;
          let data: any;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }
          if (typeof data.delta === "string") { partial += data.delta; setWorking(w => (w ? { ...w, partial } : w)); }
          else if (typeof data.progress === "string") setWorking(w => (w ? { ...w, progress: data.progress } : w));
          else if (typeof data.reply === "string" && (data.error || data.savedToThread === false) && !data.duplicate) setNotice(data.error ? `ChatBGP could not answer. ${data.reply}` : data.reply);
        }
      }
    } catch {
      setNotice("The connection dropped. If ChatBGP was still working, its answer will appear here when it is done.");
    } finally {
      setWorking(null);
      onChanged();
    }
  };

  const send = async () => {
    const raw = text.trim();
    if (!raw || busy || working || runElsewhere) return;
    setBusy(true); setNotice(null);
    try {
      let id = thread?.id;
      if (!id) {
        const made: Thread = await (await apiRequest("POST", "/api/chat/threads", { isAiChat: true, title: raw.slice(0, 60) })).json();
        id = made.id;
      }
      const content = ai ? raw : withTokens(raw);
      await apiRequest("POST", `/api/chat/threads/${id}/messages`, { content, ...(files.length ? { attachments: files } : {}) });
      setText(""); setTags([]); setFiles([]);
      if (!thread?.id) onThread(id); else onChanged();
      if (ai) void askChatBgp(id, [...messages.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })).filter(m => m.content), { role: "user", content }]);
    } catch (e) {
      toast({ title: "The message was not sent", description: plainError(e, ""), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const stop = async () => {
    if (!thread?.id) return;
    try { await apiRequest("POST", `/api/chatbgp/threads/${thread.id}/cancel-run`); } catch {}
    queryClient.invalidateQueries({ queryKey: ["/api/chatbgp/threads", thread.id, "active-run"] });
  };
  const saveEdit = async () => {
    if (!editing || !thread) return;
    try {
      await apiRequest("PUT", `/api/chat/threads/${thread.id}/messages/${editing.id}`, { content: editing.text });
      setEditing(null); setSelected(null); onChanged();
    } catch (e) { toast({ title: "The message was not changed", description: plainError(e, ""), variant: "destructive" }); }
  };
  const remove = async (m: Message) => {
    if (!thread || !window.confirm("Delete this message?")) return;
    try { await apiRequest("DELETE", `/api/chat/threads/${thread.id}/messages/${m.id}`); setSelected(null); onChanged(); }
    catch (e) { toast({ title: "The message was not deleted", description: plainError(e, ""), variant: "destructive" }); }
  };

  if (failed) return <p className="p-4 text-sm text-muted-foreground" data-testid="ja-chat-gone">This conversation is not available.</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={ai ? "ja-chatbgp-conversation" : "ja-chat-conversation"}>
      <div className="border-b px-3 py-1.5">
        <p className="truncate text-sm font-semibold" data-testid="ja-chat-title-line">{title}</p>
        {!ai && thread && <p className="truncate text-[11px] text-muted-foreground">{thread.members.map(m => (m.id === myId ? "You" : m.name)).join(", ")}</p>}
        {ai && <p className="text-[11px] text-muted-foreground">{JOINT_AGENT_CHATBGP_LINE}</p>}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" data-testid="ja-chat-messages">
        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {!loading && messages.length === 0 && !working && (
          <p className="text-sm text-muted-foreground">{ai ? "Ask about a unit, a viewing, an offer, heads of terms, a checklist or your tasks." : "No messages yet."}</p>
        )}
        {messages.map(m => {
          const mine = m.role !== "assistant" && m.userId === myId;
          const attachments = (m.attachments || []).map(parseAttachment).filter((a): a is Attachment => !!a);
          return (
            <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`} data-testid={`ja-chat-message-${m.id}`}>
              <span className="mb-0.5 text-[10px] text-muted-foreground">{nameOf(m)} · {when(m.createdAt)}</span>
              {editing?.id === m.id ? (
                <div className="w-full space-y-1">
                  <Textarea value={editing.text} onChange={e => setEditing({ id: m.id, text: e.target.value })} rows={3} data-testid="ja-chat-edit-box" />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                    <Button size="sm" onClick={saveEdit} disabled={!editing.text.trim()} data-testid="ja-chat-edit-save">Save</Button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => { if (mine && !ai) setSelected(selected === m.id ? null : m.id); }}
                  className={`max-w-[88%] rounded-lg px-2.5 py-1.5 text-sm ${mine ? "bg-foreground text-background" : "bg-muted text-foreground"} ${mine && !ai ? "cursor-pointer" : ""}`}
                >
                  <MessageText text={m.content} onOpen={onOpen} />
                  {attachments.map((a, i) => <div key={i}><AttachmentChip a={a} /></div>)}
                </div>
              )}
              {selected === m.id && editing?.id !== m.id && (
                <div className="mt-0.5 flex gap-3 text-[11px] text-muted-foreground">
                  <button type="button" data-no-min-touch className="hover:text-foreground" onClick={() => setEditing({ id: m.id, text: m.content })} data-testid="ja-chat-edit">Edit</button>
                  <button type="button" data-no-min-touch className="hover:text-foreground" onClick={() => remove(m)} data-testid="ja-chat-delete-message">Delete</button>
                </div>
              )}
            </div>
          );
        })}
        {(working || runElsewhere) && (
          <div className="flex flex-col items-start" data-testid="ja-chatbgp-working">
            <span className="mb-0.5 text-[10px] text-muted-foreground">ChatBGP</span>
            <div className="max-w-[88%] rounded-lg bg-muted px-2.5 py-1.5 text-sm">
              {working?.partial ? <MessageText text={working.partial} onOpen={onOpen} /> : <span className="text-muted-foreground">{working?.progress || run.data?.progress || "Working..."}</span>}
            </div>
            <button type="button" data-no-min-touch className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={stop} data-testid="ja-chatbgp-stop">
              <Square className="h-3 w-3" />Stop
            </button>
          </div>
        )}
        {notice && <p className="rounded-md border border-border bg-muted/50 px-2.5 py-2 text-xs text-foreground" data-testid="ja-chatbgp-notice">{notice}</p>}
        <div ref={bottom} />
      </div>
      <div className="relative border-t px-2 py-2">
        {menu && (
          <div className="absolute bottom-full left-2 right-2 mb-1 max-h-56 overflow-y-auto rounded-md border bg-background shadow-md" data-testid="ja-chat-tag-menu">
            {menu.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Type a name: people in this conversation, and units and deals at your schemes.</p>}
            {menu.map(r => (
              <button key={`${r.type}-${r.id}`} type="button" onClick={() => pickTag(r)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted" data-testid={`ja-chat-tag-option-${r.type}`}>
                <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{r.type === "user" ? "Person" : r.type === "unit" ? "Unit" : "Deal"}</span>
                <span className="truncate">{r.name}</span>
              </button>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1">
            {files.map((f, i) => (
              <span key={i} className="inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-xs">
                <span className="truncate">{f.name || "File"}</span>
                <button type="button" data-no-min-touch onClick={() => setFiles(files.filter((_, x) => x !== i))} title="Remove"><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          {!ai && (
            <>
              <input ref={fileInput} type="file" multiple className="hidden" onChange={e => upload(e.target.files)} data-testid="ja-chat-file-input" />
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="Attach a file" onClick={() => fileInput.current?.click()} disabled={busy || !thread} data-testid="ja-chat-attach">
                <Paperclip className="h-4 w-4" />
              </Button>
            </>
          )}
          <Textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !menu?.length) { e.preventDefault(); void send(); } }}
            rows={1}
            placeholder={ai ? "Ask about your schemes" : "Message. @ tags a person, unit or deal"}
            className="max-h-32 min-h-[36px] flex-1 resize-none py-2 text-sm"
            data-testid="ja-chat-input"
          />
          <Button type="button" size="icon" className="h-9 w-9 shrink-0" onClick={() => void send()} disabled={!text.trim() || busy || !!working || runElsewhere || (!ai && !thread)} title="Send" data-testid="ja-chat-send">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

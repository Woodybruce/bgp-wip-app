// The deal page's conversation (Woody, 2026-11-18: "Needs a chat box too";
// docs/deal-page-review-2026-11-18.md, decision 3). It is the property's ONE
// shared conversation (server/record-conversation.ts), cut to the deal: the
// messages that tag the deal or its Letting Tracker unit, and a message
// written here is tagged with both, so the Letting Tracker's comments, the
// property page and the deal page read the same thread under the rules
// already written for clients and joint agents. Opening the box joins the
// conversation, as on the property page; the closed line only counts.
// The old Comments box (crm_deals.comments) is kept read only as "Earlier notes".
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronDown, ChevronUp, Loader2, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { buildTagToken, TAG_TOKEN_SOURCE } from "@/components/chat-tags";
import { cn } from "@/lib/utils";

const when = (iso: string) => {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "Europe/London" });
};

// Message text without the deal's and the unit's own tags; other tags read as "@name".
export function dealMessageText(text: string, dealId: string, unitId: string | null): string {
  return String(text || "")
    .replace(new RegExp(TAG_TOKEN_SOURCE, "g"), (_m, name, type, id) => ((type === "deal" && id === dealId) || (type === "unit" && id === unitId) ? "" : `@${name}`))
    .replace(/\s+/g, " ").trim();
}

// Append-only comments (UX #48) as they were stored on the deal:
// "[stamp · author]\ntext" blocks separated by blank lines.
export function parseDealComments(blob: string | null | undefined): Array<{ meta: string | null; text: string }> {
  if (!blob?.trim()) return [];
  const parts = blob.split(/\n\n(?=\[[^\]\n]+ · [^\]\n]+\]\n)/);
  return parts.map(p => {
    const m = p.match(/^\[([^\]\n]+ · [^\]\n]+)\]\n([\s\S]*)$/);
    return m ? { meta: m[1], text: m[2] } : { meta: null, text: p.trim() };
  }).filter(e => e.text);
}

type Summary = { count: number; last: { text: string; sender: string | null; at: string } | null };

export function DealConversation({ dealId, dealLabel, dealLive, propertyId, propertyName, unit, earlierNotes, jointAgent }: {
  dealId: string; dealLabel: string; dealLive: boolean;
  propertyId: string | null; propertyName: string | null;
  // The deal's Letting Tracker unit, when it has one.
  unit: { id: string; name: string } | null;
  earlierNotes: string | null | undefined;
  jointAgent: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const notes = parseDealComments(earlierNotes);
  const unitId = unit?.id || null;

  // The count and the latest message (a joint agent's gateway does not open
  // this read; its line shows without a count).
  const summaryKey = ["/api/chat/threads/record/deal-comments", propertyId, dealId, unitId];
  const summary = useQuery<Summary | null>({
    queryKey: summaryKey,
    enabled: !!propertyId && !jointAgent,
    staleTime: 60_000,
    queryFn: async () => {
      const qs = new URLSearchParams({ propertyId: propertyId!, dealId, ...(unitId ? { unitId } : {}) });
      const r = await fetch(`/api/chat/threads/record/deal-comments?${qs}`, { credentials: "include", headers: getAuthHeaders() });
      return r.ok ? r.json() : null;
    },
  });

  useEffect(() => {
    if (!open || threadId || !propertyId) return;
    let gone = false;
    apiRequest("POST", `/api/chat/threads/record/property/${encodeURIComponent(propertyId)}`)
      .then(r => r.json()).then(d => { if (!gone && d?.threadId) setThreadId(d.threadId); })
      .catch(() => { if (!gone) toast({ title: "The conversation could not be opened", variant: "destructive" }); });
    return () => { gone = true; };
  }, [open, threadId, propertyId]);

  const thread = useQuery<any>({
    queryKey: ["/api/chat/threads", threadId],
    enabled: open && !!threadId,
    refetchInterval: open ? 10_000 : false,
    queryFn: async () => {
      const r = await fetch(`/api/chat/threads/${threadId}`, { credentials: "include", headers: getAuthHeaders() });
      return r.ok ? r.json() : null;
    },
  });
  const tags = [`(tag:deal/${dealId})`, ...(unitId ? [`(tag:unit/${unitId})`] : [])];
  const nameOf = (id: string | null) => ((thread.data?.members || []) as any[]).find(m => m.id === id)?.name || "Someone";
  const messages = ((thread.data?.messages || []) as any[])
    .filter(m => m.role === "user" && tags.some(t => String(m.content || "").includes(t)))
    .slice(-30);

  const post = async () => {
    const text = draft.trim();
    if (!text || sending || !threadId) return;
    setSending(true);
    try {
      // Tagged with the deal and its unit. A joint agent tags a deal only
      // while it is live at its schemes (server/chat-joint-agent.ts).
      const lead = [jointAgent && !dealLive ? null : buildTagToken("deal", dealId, dealLabel), unit ? buildTagToken("unit", unit.id, unit.name) : null].filter(Boolean).join(" ");
      if (!lead) throw new Error("This transaction has closed and has no unit to tag the message with.");
      await apiRequest("POST", `/api/chat/threads/${threadId}/messages`, { content: `${lead} ${text}` });
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", threadId] });
      queryClient.invalidateQueries({ queryKey: summaryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads/record/unit-comments"] });
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (e: any) {
      toast({ title: "The message was not posted", description: e?.message, variant: "destructive" });
    } finally { setSending(false); }
  };

  const s = summary.data;
  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm min-w-0" data-testid="deal-conversation">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="deal-conversation-toggle" disabled={!propertyId}>
        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold shrink-0">Conversation</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {!propertyId ? "Link this transaction to a property to start its conversation."
            : s?.last ? <>{s.count} message{s.count === 1 ? "" : "s"} · <span className="text-foreground">{s.last.sender || "Someone"}</span>, {when(s.last.at)}: {dealMessageText(s.last.text, dealId, unitId)}</>
            : s ? "No messages yet. Write to the team about this transaction."
            : "Messages about this transaction, in the property's conversation."}
        </span>
        {propertyId && (open ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />)}
      </button>
      {open && propertyId && (
        <div className="border-t px-3 py-2 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Messages that name this transaction{unit ? ` or ${unit.name}` : ""}, in {propertyName ? <Link href={`/properties/${propertyId}`} className="text-primary hover:underline">{propertyName}</Link> : "the property"}'s conversation. Everyone who can open the property reads it.
          </p>
          <div className="max-h-80 overflow-y-auto space-y-1.5" data-testid="deal-conversation-messages">
            {!threadId || thread.isLoading ? <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Loading…</p>
              : messages.length === 0 ? <p className="text-xs text-muted-foreground">No messages about this transaction yet.</p>
              : messages.map(m => (
                <div key={m.id} className="rounded-md bg-muted/50 px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground">{nameOf(m.userId)} · {when(m.createdAt || m.created_at)}</p>
                  <p className="text-sm whitespace-pre-wrap break-words">{dealMessageText(m.content, dealId, unitId)}</p>
                </div>
              ))}
          </div>
          <form className="flex items-end gap-1.5" onSubmit={e => { e.preventDefault(); void post(); }}>
            <textarea ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)} rows={2}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void post(); } }}
              placeholder="Write a message (Enter sends, Shift+Enter for a new line)"
              className="min-w-0 flex-1 resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm" data-testid="deal-conversation-input" />
            <Button type="submit" size="sm" className="h-9 w-9 p-0" disabled={!draft.trim() || sending || !threadId} aria-label="Send">
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </Button>
          </form>
        </div>
      )}
      {notes.length > 0 && (
        <div className="border-t px-3 py-1.5" data-testid="deal-earlier-notes">
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setNotesOpen(o => !o)} aria-expanded={notesOpen}>
            Earlier notes on the transaction ({notes.length}){notesOpen ? "" : ": show"}
          </button>
          {notesOpen && (
            <div className="mt-1.5 space-y-1.5 pb-1">
              {notes.map((e, i) => (
                <div key={i} className={cn("rounded-md border px-2 py-1.5 text-xs")}>
                  <p className="text-[10px] text-muted-foreground mb-0.5">{e.meta ?? "Earlier note"}</p>
                  <p className="whitespace-pre-wrap">{e.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

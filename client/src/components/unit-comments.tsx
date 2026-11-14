import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { buildTagToken, TAG_TOKEN_SOURCE } from "@/components/chat-tags";
import { cn } from "@/lib/utils";

// Quick comments on a Letting Tracker unit (Woody, 2026-11-14: "nice and easy
// to add comments, those comments all just go into the property chat too").
// A comment is a message in the property's ONE shared conversation
// (server/record-conversation.ts), tagged with the unit, so it shows in the
// property's conversation as well. Type and press Enter; nothing else.

export type UnitCommentSummary = { count: number; last: { text: string; sender: string | null; at: string } };

export function unitCommentsKey(propertyIds: string[]) {
  return ["/api/chat/threads/record/unit-comments", [...new Set(propertyIds)].sort().join(",")];
}

export function useUnitCommentSummaries(propertyIds: string[]) {
  const key = unitCommentsKey(propertyIds.filter(Boolean));
  return useQuery<{ units: Record<string, UnitCommentSummary> }>({
    queryKey: key,
    enabled: !!key[1],
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(`/api/chat/threads/record/unit-comments?propertyIds=${encodeURIComponent(String(key[1]))}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return { units: {} };
      return r.json();
    },
  });
}

// Message text without its tag tokens: "@[Unit 4](tag:unit/…) Viewing went well" reads "Viewing went well".
export function plainComment(text: string, unitId?: string): string {
  return String(text || "").replace(new RegExp(TAG_TOKEN_SOURCE, "g"), (_m, name, type, id) => (type === "unit" && id === unitId ? "" : `@${name}`)).replace(/\s+/g, " ").trim();
}

const when = (iso: string) => {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
};

export function UnitCommentButton({ unitId, unitName, propertyId, summary, onPosted }: {
  unitId: string; unitName: string; propertyId: string | null | undefined; summary?: UnitCommentSummary; onPosted?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
  const tag = `(tag:unit/${unitId})`;
  const nameOf = (id: string | null) => ((thread.data?.members || []) as any[]).find(m => m.id === id)?.name || "Someone";
  const comments = ((thread.data?.messages || []) as any[]).filter(m => m.role === "user" && String(m.content || "").includes(tag)).slice(-12);

  const post = async () => {
    const text = draft.trim();
    if (!text || sending || !threadId) return;
    setSending(true);
    try {
      await apiRequest("POST", `/api/chat/threads/${threadId}/messages`, { content: `${buildTagToken("unit", unitId, unitName)} ${text}` });
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads/record/unit-comments"] });
      onPosted?.();
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (e: any) {
      toast({ title: "Couldn't post the comment", description: e?.message, variant: "destructive" });
    } finally { setSending(false); }
  };

  if (!propertyId) return null;
  const count = summary?.count || 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-no-min-touch onClick={e => e.stopPropagation()}
          className={cn("inline-flex items-center gap-1 text-[11px] rounded-full px-1.5 py-0.5 hover:bg-muted max-w-[14rem] min-w-0", count ? "text-foreground" : "text-muted-foreground")}
          title={summary ? `${summary.last.sender || "Someone"}, ${when(summary.last.at)}: ${plainComment(summary.last.text, unitId)}` : "Add a comment"}
          data-testid={`unit-comments-${unitId}`}>
          <MessageSquare className="w-3 h-3 shrink-0" />
          {count ? <><span className="font-mono tabular-nums">{count}</span><span className="truncate text-muted-foreground">{plainComment(summary!.last.text, unitId)}</span></> : <span>Comment</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2 space-y-2" onClick={e => e.stopPropagation()}>
        <p className="text-[11px] text-muted-foreground px-0.5">Comments on {unitName}. They go into the property's conversation, which everyone who can open the property reads.</p>
        <div className="max-h-60 overflow-y-auto space-y-1.5" data-testid={`unit-comments-list-${unitId}`}>
          {!threadId || thread.isLoading ? <p className="text-xs text-muted-foreground flex items-center gap-1 px-0.5"><Loader2 className="w-3 h-3 animate-spin" />Loading…</p>
            : comments.length === 0 ? <p className="text-xs text-muted-foreground px-0.5">No comments yet.</p>
            : comments.map(m => (
              <div key={m.id} className="rounded-md bg-muted/50 px-2 py-1.5">
                <p className="text-[10px] text-muted-foreground">{nameOf(m.userId)} · {when(m.createdAt || m.created_at)}</p>
                <p className="text-xs whitespace-pre-wrap break-words">{plainComment(m.content, unitId)}</p>
              </div>
            ))}
        </div>
        <form className="flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); void post(); }}>
          <input ref={inputRef} autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a comment and press Enter"
            className="flex-1 min-w-0 h-8 rounded-md border border-input bg-background px-2 text-xs" data-testid={`unit-comment-input-${unitId}`} />
          <button type="submit" disabled={!draft.trim() || sending || !threadId} className="h-8 w-8 inline-flex items-center justify-center rounded-md bg-foreground text-background disabled:opacity-40" aria-label="Post comment">
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

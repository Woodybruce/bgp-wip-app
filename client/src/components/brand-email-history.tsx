// The brand's email history with BGP as conversations — subject, who at BGP,
// who at the brand, other firms copied, dates and the latest line — with a
// short AI read at the top. Opened from "N email threads" under About.
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Mail, Sparkles } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AiCommentary, type CommentaryEntity } from "@/components/ai-commentary";

type Conversation = { subject: string; messages: number; first: string; last: string; bgp: string[]; brand: string[]; others: string[]; firms?: string[]; preview: string };
type ThreadsResponse = { domain: string; total: number; conversations: Conversation[]; summary: { text: string; at: string } | null };

const personName = (email: string) => email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
const firmOf = (email: string) => (email.split("@")[1] || "").replace(/\.(co\.uk|com|uk|net|org|io|es|pt|fr)$/i, "");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function BrandEmailHistory({ companyId, companyName, open, onOpenChange, entities }: {
  companyId: string; companyName: string; open: boolean; onOpenChange: (open: boolean) => void; entities?: CommentaryEntity[];
}) {
  const [search, setSearch] = useState("");
  const key = ["/api/brand", companyId, "email-threads"];
  const { data, isLoading, isError } = useQuery<ThreadsResponse>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/brand/${companyId}/email-threads`)).json(),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const summarise = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/brand/${companyId}/email-threads/summary`)).json(),
    onSuccess: (out: { summary: ThreadsResponse["summary"] }) => queryClient.setQueryData<ThreadsResponse>(key, prev => prev ? { ...prev, summary: out.summary } : prev),
  });
  // Build the AI read the first time the history opens (or when new mail has arrived).
  useEffect(() => {
    if (open && data && !data.summary && data.conversations.length && !summarise.isPending && !summarise.isError) summarise.mutate();
  }, [open, data]);
  const q = search.trim().toLowerCase();
  const rows = (data?.conversations || []).filter(conv => !q || conv.subject.toLowerCase().includes(q) || conv.preview.toLowerCase().includes(q)
    || [...conv.bgp, ...conv.brand, ...conv.others].some(p => p.includes(q)));
  const emails = (data?.conversations || []).reduce((n, conv) => n + conv.messages, 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="brand-email-history">
        <DialogTitle className="flex items-center gap-2"><Mail className="w-4 h-4" />Emails with {companyName}</DialogTitle>
        <DialogDescription>
          {data ? <><span className="font-mono tabular-nums">{data.total}</span> conversations · <span className="font-mono tabular-nums">{emails}</span> emails with @{data.domain}</> : "BGP's email history with the brand."}
        </DialogDescription>
        {isLoading ? <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading emails…</p>
          : isError ? <p className="text-sm text-muted-foreground">The email history couldn't be loaded.</p>
          : !data?.conversations.length ? <p className="text-sm text-muted-foreground">No emails with this brand's domain yet.</p>
          : <>
            <section className="rounded-lg border border-border bg-card p-3 space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Sparkles className="w-3 h-3 text-primary" />What the emails are about</h3>
              {data.summary ? <AiCommentary text={data.summary.text} entities={entities} />
                : summarise.isPending ? <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Reading the emails…</p>
                : summarise.isError ? <p className="text-xs text-muted-foreground">The summary isn't available right now — the conversations are below.</p>
                : null}
            </section>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search subject, person or firm" aria-label="Search emails" />
            <ul className="rounded-lg border border-border bg-card divide-y divide-border">
              {rows.map(conv => (
                <li key={conv.subject + conv.last} className="px-3 py-2.5 space-y-1" data-testid="brand-email-conversation">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium min-w-0 break-words">{conv.subject}</p>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{conv.first.slice(0, 10) === conv.last.slice(0, 10) ? day(conv.last) : `${day(conv.first)} – ${day(conv.last)}`}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    <span><span className="font-mono tabular-nums">{conv.messages}</span> {conv.messages === 1 ? "email" : "emails"}</span>
                    {conv.bgp.length > 0 && <span>BGP <span className="text-foreground">{conv.bgp.map(personName).join(", ")}</span></span>}
                    {conv.brand.length > 0 && <span>{companyName} <span className="text-foreground">{conv.brand.map(personName).join(", ")}</span></span>}
                    {conv.others.length > 0 && <span title={conv.others.join(", ")}>Also <span className="text-foreground">{(conv.firms?.length ? conv.firms : Array.from(new Set(conv.others.map(firmOf)))).join(", ")}</span></span>}
                  </div>
                  {conv.preview && <p className="text-xs text-muted-foreground line-clamp-2">“{conv.preview}”</p>}
                </li>
              ))}
              {!rows.length && <li className="px-3 py-2.5 text-sm text-muted-foreground">No emails match that search.</li>}
            </ul>
          </>}
      </DialogContent>
    </Dialog>
  );
}

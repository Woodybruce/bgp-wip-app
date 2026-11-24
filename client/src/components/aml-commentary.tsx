// Fable's written view of a party's AML file (Woody, 24 November 2026: "an AI
// led commentary with fable 5 giving a proper view on whats been found and
// given to date and the risk profile given the rules"). Written once for the
// file as it stands (server/aml-commentary.ts) and read again until the file
// changes; Write again asks for a fresh one. The full record folds under it.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import {
  COMMENTARY_PROFILE_WORDS, COMMENTARY_SECTION_TITLE, type AmlCommentary, type CommentaryFact, type CommentaryProfile,
} from "@shared/aml-commentary";

interface CommentaryReply {
  commentary: AmlCommentary | null;
  current: boolean;
  at: string | null;
  by: string | null;
  model: string | null;
  sources: CommentaryFact[];
  canWrite: boolean;
  why: string | null;
}

const keyFor = (dealId: string, role: string) => ["/api/deals", dealId, "aml-commentary", role];
const url = (dealId: string) => `/api/deals/${encodeURIComponent(dealId)}/aml-commentary`;

const PROFILE_CLS: Record<CommentaryProfile, string> = {
  lower: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  standard: "border-border bg-muted text-foreground",
  higher: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  unclear: "border-border bg-muted text-muted-foreground",
};

const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
  : "";

// The facts and rules a line rests on, as small references; each shows its words on hover.
function Cites({ ids, sources }: { ids: string[]; sources: CommentaryFact[] }) {
  if (!ids.length) return null;
  const words = new Map(sources.map(s => [s.id, s.text]));
  return (
    <span className="text-[10px] text-muted-foreground">
      {" "}[{ids.map((id, i) => <span key={id}>{i ? ", " : ""}<span title={words.get(id) || ""} className="cursor-help underline decoration-dotted underline-offset-2">{id}</span></span>)}]
    </span>
  );
}

export function AmlCommentaryView({ dealId, role }: { dealId: string; role: string }) {
  const [showSources, setShowSources] = useState(false);
  const { data, isLoading, error } = useQuery<CommentaryReply>({
    queryKey: keyFor(dealId, role),
    queryFn: async () => {
      const res = await fetch(`${url(dealId)}?role=${encodeURIComponent(role)}`, { credentials: "include", headers: getAuthHeaders() });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || "The written view could not be read.");
      return j;
    },
    staleTime: 30_000,
  });
  const write = useMutation({
    mutationFn: async (again: boolean) => {
      const res = await fetch(url(dealId), {
        method: "POST", credentials: "include", headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ role, again }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || "The view could not be written.");
      return j as CommentaryReply;
    },
    onSuccess: r => queryClient.setQueryData(keyFor(dealId, role), r),
  });
  // Written by itself the first time a file with none is opened (once a page
  // view). A view written before the file changed waits for Write again.
  const asked = useRef(false);
  useEffect(() => {
    if (!data || asked.current || write.isPending || data.commentary || !data.canWrite) return;
    asked.current = true;
    write.mutate(false);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Reading the file…</p>;
  if (error) return <p className="text-xs text-amber-800 dark:text-amber-300">{String((error as Error).message)}</p>;
  if (!data) return null;
  const c = data.commentary;
  if (write.isPending && !c) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid={`aml-commentary-writing-${role}`}>
        <Loader2 className="h-3 w-3 animate-spin" />Fable is reading the file and BGP's rules, and writing a view. This takes up to a minute.
      </p>
    );
  }
  if (!c) {
    return (
      <div className="space-y-1 text-xs" data-testid={`aml-commentary-none-${role}`}>
        {write.error ? <p className="text-amber-800 dark:text-amber-300">{String((write.error as Error).message)}</p> : data.why ? <p className="text-muted-foreground">{data.why}</p> : null}
        {data.canWrite && (
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => write.mutate(false)} data-testid={`aml-commentary-write-${role}`}>Write BGP's view</Button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-testid={`aml-commentary-${role}`}>
      <div className="flex flex-wrap items-start gap-2">
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${PROFILE_CLS[c.profile]}`} data-testid={`aml-commentary-profile-${role}`}>{COMMENTARY_PROFILE_WORDS[c.profile]}</span>
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{c.headline}</p>
      </div>
      {c.paragraphs.map(p => (
        <div key={p.section}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{COMMENTARY_SECTION_TITLE[p.section]}</p>
          <p className="text-xs leading-relaxed">{p.text}<Cites ids={[...p.facts, ...p.rules]} sources={data.sources} /></p>
        </div>
      ))}
      {c.queries.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid={`aml-commentary-queries-${role}`}>
          <p className="font-semibold">Worth a look</p>
          <ul className="mt-0.5 space-y-0.5">{c.queries.map(q => <li key={q.text}>{q.text}<Cites ids={q.facts} sources={data.sources} /></li>)}</ul>
        </div>
      )}
      {!data.current && (
        <p className="text-xs text-amber-800 dark:text-amber-300" data-testid={`aml-commentary-stale-${role}`}>The file has changed since this view was written.</p>
      )}
      {write.error && <p className="text-xs text-amber-800 dark:text-amber-300">{String((write.error as Error).message)}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <span>Written by Fable{data.at ? `, ${when(data.at)}` : ""}{data.by ? ` for ${data.by}` : ""}. It gives a view; it decides nothing.</span>
        {data.sources.length > 0 && (
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => setShowSources(v => !v)} data-testid={`aml-commentary-sources-toggle-${role}`}>
            {showSources ? "Hide sources" : `Sources (${data.sources.length})`}
          </button>
        )}
        {data.canWrite && (
          <button type="button" className="inline-flex items-center gap-1 underline-offset-2 hover:underline disabled:opacity-50" disabled={write.isPending} onClick={() => write.mutate(true)} data-testid={`aml-commentary-again-${role}`}>
            {write.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Write again
          </button>
        )}
      </div>
      {showSources && (
        <ol className="space-y-0.5 text-[11px] text-muted-foreground" data-testid={`aml-commentary-sources-${role}`}>
          {data.sources.map(s => <li key={s.id}><span className="font-medium text-foreground">{s.id}.</span> {s.text}</li>)}
        </ol>
      )}
    </div>
  );
}

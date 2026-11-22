// The deal's timeline (Woody, 2026-11-18: "need full time line of deal
// tracking from marketing to completion"): every event in date order, from
// GET /api/crm/deals/:id/timeline (server/deal-page.ts). An event that has
// more behind it opens it: an offer's negotiation, the Heads of Terms, the
// checklist, the recommendation or the brief, or one of the page's sections.
import { useState } from "react";
import {
  ArrowLeftRight, ArrowRight, Briefcase, CheckCircle2, ClipboardCheck, Eye, FileCheck, FileText, Handshake, ListChecks,
  Loader2, Plus, PoundSterling, Receipt, ShieldCheck, ThumbsUp,
} from "lucide-react";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import type { DealEvent, DealEventKind, DealEventOpen } from "@shared/deal-page";
import { useDealTimeline } from "./use-deal-page";

const ICONS: Record<DealEventKind, React.ElementType> = {
  created: Plus, instructed: Briefcase, stage: ArrowRight, brief: ClipboardCheck, viewing: Eye, offer: PoundSterling,
  round: ArrowLeftRight, offer_status: Handshake, hots: FileText, recommendation: ThumbsUp, checklist: ListChecks,
  aml: ShieldCheck, exchanged: FileCheck, completed: CheckCircle2, invoiced: Receipt, invoice: Receipt,
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
const month = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Europe/London" });

export function DealTimelinePanel({ dealId, onOpen }: { dealId: string; onOpen: (open: DealEventOpen) => void }) {
  const { data, isLoading, isError, refetch } = useDealTimeline(dealId);
  const [newestFirst, setNewestFirst] = useState(false);
  if (isLoading) return <p className="text-sm text-muted-foreground flex items-center gap-1.5 p-3"><Loader2 className="w-4 h-4 animate-spin" />Loading the timeline…</p>;
  if (isError || !data) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-3 text-sm text-muted-foreground" data-testid="deal-timeline-error">
        The timeline could not be loaded. <button type="button" className="underline underline-offset-2" onClick={() => refetch()}>Try again</button>
      </div>
    );
  }
  const events = newestFirst ? [...data.events].reverse() : data.events;
  const groups: { label: string; rows: DealEvent[] }[] = [];
  for (const e of events) {
    const label = month(e.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(e); else groups.push({ label, rows: [e] });
  }
  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm p-3 space-y-3 min-w-0" data-testid="deal-timeline">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Timeline</h3>
        <span className="text-xs text-muted-foreground font-mono tabular-nums">{data.events.length}</span>
        <div className="ml-auto flex gap-1.5">
          <Pill active={!newestFirst} onClick={() => setNewestFirst(false)} data-testid="deal-timeline-oldest">Oldest first</Pill>
          <Pill active={newestFirst} onClick={() => setNewestFirst(true)} data-testid="deal-timeline-newest">Newest first</Pill>
        </div>
      </div>
      {events.length === 0 && <p className="text-sm text-muted-foreground">Nothing has been recorded on this transaction yet.</p>}
      {groups.map(g => (
        <div key={g.label}>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">{g.label}</p>
          <ol className="relative border-l border-border ml-3 space-y-0.5">
            {g.rows.map(e => {
              const Icon = ICONS[e.kind] || ArrowRight;
              const body = (
                <>
                  <span className="absolute -left-[13px] top-1.5 flex h-6 w-6 items-center justify-center rounded-full border bg-background">
                    <Icon className="h-3 w-3 text-muted-foreground" />
                  </span>
                  <span className="block min-w-0">
                    <span className="block text-sm leading-snug break-words">{e.title}</span>
                    <span className={cn("block text-xs text-muted-foreground", !e.confirmed && "opacity-60")} title={e.confirmed ? undefined : "The date is not confirmed: a bulk update stamped it, not the day the transaction moved"}>
                      {[day(e.at), e.by, e.detail].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={e.id} className="relative pl-5" data-testid={`deal-event-${e.kind}`}>
                  {e.open
                    ? <button type="button" onClick={() => onOpen(e.open!)} className="w-full rounded-md px-1.5 py-1 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">{body}</button>
                    : <div className="px-1.5 py-1">{body}</div>}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

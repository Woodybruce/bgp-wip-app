// ActivitySummary — THE activity feed, everywhere. Fourth of the summary
// family (TrackerSummary / DealsSummary / PropertiesSummary): one row design
// for every board that shows diary events or relationship activity,
// replacing the drifted one-offs (Landsec "Upcoming Events", the staff
// Team Activity / Activity Alerts widget, the property page's Recent
// activity card — three implementations of the same two tables).
//
// Two sections in one board (Woody, 2026-08-03):
//   Upcoming — future team-diary events (meetings, viewings, calls)
//   Recent   — the last 14 days of emails / calls / meetings, sanitised
//              one-line summaries only (never message content)
//
// Scope with `propertyId` (property pages) or `companyId` (brand / landlord
// profiles); no scope = the viewer's book (client logins are forced to
// their own portfolio server-side). The AI relationship commentary strips
// are deliberately NOT part of this — they sit above the feed, unchanged.
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Mail, Phone, Users, Activity, CalendarDays, MapPin, Handshake, Sparkles, Plus, Loader2 } from "lucide-react";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type UpcomingEvent = {
  id: number; title: string; event_type: string | null;
  start_time: string; end_time: string | null; location: string | null;
  property_id: string | null; property_name: string | null; deal_id: string | null;
};
type RecentItem = {
  id: string; kind: string; date: string; summary: string;
  subject?: string | null; ai_summary?: string | null;
  contact_id: string | null; contact_email?: string | null;
  microsoft_id?: string | null;
  deal_id: string | null; deal_name: string | null;
};

function timeAgo(date: string): string {
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const KIND_ICON: Record<string, typeof Mail> = { email: Mail, call: Phone, meeting: Users, deal: Handshake };

// One feed row — the meeting/email REASON leads, the who-met-whom line
// sits under it, and each interaction can be AI-summarised inline, jumped
// to the contact, or turned into a follow-up task (Woody, 2026-08-04).
function RecentRow({ a, propertyId, summaries, setSummaries }: {
  a: RecentItem;
  propertyId?: string;
  summaries: Record<string, string>;
  setSummaries: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const { toast } = useToast();
  const Icon = KIND_ICON[a.kind] || Activity;
  const isDealMove = a.kind === "deal";
  const aiText = summaries[a.id] || a.ai_summary || null;

  const summarise = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/interactions/${a.id}/summarise`);
      return r.json();
    },
    onSuccess: (j: any) => {
      if (j.summary) setSummaries(prev => ({ ...prev, [a.id]: j.summary }));
      else if (j.skipped) toast({ title: "Nothing to summarise", description: j.reason || "No notes or transcript captured for this one." });
    },
    onError: (e: any) => toast({ title: "Couldn't summarise", description: e?.message, variant: "destructive" }),
  });
  const addTask = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/tasks", {
        title: `Follow up: ${a.subject || a.summary}`,
        priority: "medium",
        ...(propertyId ? { linkedPropertyId: propertyId } : {}),
        ...(a.contact_id ? { linkedContactId: a.contact_id } : {}),
        ...(a.deal_id ? { linkedDealId: a.deal_id } : {}),
      });
      return r.json();
    },
    onSuccess: () => toast({ title: "Task added", description: "It's on My Tasks and this property's weekly focus." }),
    onError: (e: any) => toast({ title: "Couldn't add task", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="px-1.5 py-1 rounded hover:bg-muted/40 min-w-0 group/row" data-testid={`activity-recent-${a.id}`}>
      <div className="flex items-start gap-2 min-w-0">
        <Icon className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
        {/* Radix tooltip, not the native title attr — the 30s live-refresh
            re-renders these rows, which killed the native tooltip after its
            first show (Woody, 2026-08-04). This one fires on every hover
            and carries the full untruncated detail. */}
        <Tooltip delayDuration={250}>
          <TooltipTrigger asChild>
            <div className="flex-1 min-w-0 cursor-default">
              {a.subject ? (
                <>
                  <div className="text-xs leading-snug font-medium truncate">{a.subject}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{a.summary} · {timeAgo(a.date)}</div>
                </>
              ) : (
                <>
                  <div className="text-xs leading-snug">{a.summary}</div>
                  <div className="text-[10px] text-muted-foreground">{timeAgo(a.date)}</div>
                </>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-[340px]">
            <div className="space-y-1">
              {a.subject && <p className="text-xs font-semibold leading-snug">{a.subject}</p>}
              <p className="text-[11px] leading-snug">{a.summary}</p>
              {aiText && <p className="text-[11px] leading-snug opacity-80">{aiText}</p>}
              <p className="text-[10px] opacity-60">
                {new Date(a.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                {" · "}
                {new Date(a.date).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                {" · "}
                {timeAgo(a.date)}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
        {!isDealMove && (
          <button
            onClick={() => summarise.mutate()}
            disabled={summarise.isPending}
            className="shrink-0 p-0.5 rounded hover:bg-muted opacity-60 md:opacity-0 md:group-hover/row:opacity-100 transition-opacity"
            title="AI summary — what was this about?"
            data-testid={`activity-summarise-${a.id}`}
          >
            {summarise.isPending ? <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /> : <Sparkles className="w-3 h-3 text-muted-foreground" />}
          </button>
        )}
        {!isDealMove && (
          <button
            onClick={() => addTask.mutate()}
            disabled={addTask.isPending}
            className="shrink-0 p-0.5 rounded hover:bg-muted opacity-60 md:opacity-0 md:group-hover/row:opacity-100 transition-opacity"
            title="Add a follow-up task for this"
            data-testid={`activity-task-${a.id}`}
          >
            <Plus className="w-3 h-3 text-muted-foreground" />
          </button>
        )}
        {a.kind === "email" && a.microsoft_id && (
          <button
            onClick={() => {
              window.open(`https://outlook.office365.com/owa/?ItemID=${encodeURIComponent(a.microsoft_id!)}&exvsurl=1&viewmodel=ReadMessageItem`, "_blank", "noopener");
            }}
            className="shrink-0 p-0.5 rounded hover:bg-muted opacity-60 md:opacity-0 md:group-hover/row:opacity-100 transition-opacity"
            title="Open this email in Outlook"
            data-testid={`activity-open-email-${a.id}`}
          >
            <Mail className="w-3 h-3 text-muted-foreground" />
          </button>
        )}
        {!isDealMove && (
          <button
            onClick={() => {
              const subject = encodeURIComponent(`Follow-up: ${a.subject || a.summary}`);
              const body = encodeURIComponent(aiText || a.summary || "");
              const to = a.contact_email ? `&to=${encodeURIComponent(a.contact_email)}` : "";
              window.open(`https://outlook.office.com/calendar/0/deeplink/compose?subject=${subject}&body=${body}${to}`, "_blank", "noopener");
            }}
            className="shrink-0 p-0.5 rounded hover:bg-muted opacity-60 md:opacity-0 md:group-hover/row:opacity-100 transition-opacity"
            title={`Book a follow-up in Outlook${a.contact_email ? ` with ${a.contact_email}` : ""}`}
            data-testid={`activity-book-${a.id}`}
          >
            <CalendarDays className="w-3 h-3 text-muted-foreground" />
          </button>
        )}
        {a.deal_id && (
          <Link href={`/deals/${a.deal_id}`}>
            <Badge variant="outline" className="text-[9px] shrink-0 cursor-pointer hover:bg-muted" title={a.deal_name || undefined}>deal →</Badge>
          </Link>
        )}
        {a.contact_id && (
          <Link href={`/contacts/${a.contact_id}`}>
            <Badge variant="outline" className="text-[9px] shrink-0 cursor-pointer hover:bg-muted">contact →</Badge>
          </Link>
        )}
      </div>
      {aiText && (
        <div className="ml-5 mt-0.5 text-[11px] leading-snug rounded border border-border bg-muted/40 px-2 py-1">
          <Sparkles className="w-2.5 h-2.5 inline mr-1 text-primary" />{aiText}
        </div>
      )}
    </div>
  );
}

export function ActivitySummary({ propertyId, companyId, variant = "both" }: {
  propertyId?: string;
  companyId?: string;
  variant?: "both" | "upcoming" | "recent";
}) {
  const params = new URLSearchParams();
  if (propertyId) params.set("propertyId", propertyId);
  if (companyId) params.set("companyId", companyId);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const { data, isLoading } = useQuery<{ upcoming: UpcomingEvent[]; recent: RecentItem[] }>({
    queryKey: ["/api/activity-summary", propertyId || null, companyId || null],
    queryFn: async () => {
      const r = await fetch(`/api/activity-summary${qs}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return { upcoming: [], recent: [] };
      return r.json();
    },
    staleTime: 60_000,
  });

  // Header filters (Woody, 2026-08-03: "similar to letting tracker can have
  // some filters or headings above") — section chips jump straight to
  // Upcoming or Recent without scrolling; kind chips narrow the feed.
  const [section, setSection] = useState<"all" | "upcoming" | "recent">("all");
  const [kind, setKind] = useState<string | null>(null);
  // On-demand AI summaries fetched this session, keyed by interaction id
  // (server also caches, so re-visits render them without a click).
  const [summaries, setSummaries] = useState<Record<string, string>>({});

  // Auto-summarise the top of a SCOPED feed so it reads as briefing lines
  // without clicking (Woody, 2026-08-04, "go ahead"). Reuses the same
  // cached endpoint — rows already summarised cost nothing, and one run
  // per data load keeps it from re-firing. Global (unscoped) feeds skip it.
  const autoRanFor = useRef<string | null>(null);
  useEffect(() => {
    if (!data || (!propertyId && !companyId)) return;
    const scopeKey = `${propertyId || ""}:${companyId || ""}:${data.recent?.length || 0}`;
    if (autoRanFor.current === scopeKey) return;
    autoRanFor.current = scopeKey;
    const targets = (data.recent || [])
      .filter(a => a.kind !== "deal" && !a.ai_summary)
      .slice(0, 5);
    (async () => {
      for (const a of targets) {
        try {
          const r = await apiRequest("POST", `/api/interactions/${a.id}/summarise`);
          const j = await r.json();
          if (j.summary) setSummaries(prev => ({ ...prev, [a.id]: j.summary }));
        } catch { /* quiet — the manual button still works */ }
      }
    })();
  }, [data, propertyId, companyId]);

  if (isLoading) {
    return (
      <div className="space-y-1.5" data-testid="activity-summary">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-7" />)}
      </div>
    );
  }

  const allUpcoming = variant === "recent" ? [] : (data?.upcoming || []);
  const allRecent = variant === "upcoming" ? [] : (data?.recent || []);
  const kindCounts: Record<string, number> = {};
  for (const a of allRecent) kindCounts[a.kind] = (kindCounts[a.kind] || 0) + 1;
  const upcoming = (section === "recent" ? [] : allUpcoming);
  const recent = (section === "upcoming" ? [] : allRecent).filter(a => !kind || a.kind === kind);

  if (allUpcoming.length === 0 && allRecent.length === 0) {
    return (
      <div className="text-center py-4" data-testid="activity-summary">
        <Activity className="w-6 h-6 mx-auto mb-1 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">
          {variant === "upcoming" ? "No upcoming events." : variant === "recent" ? "No emails / calls / meetings logged in the last 14 days." : "Nothing in the diary and no activity logged in the last 14 days."}
        </p>
      </div>
    );
  }

  const KIND_LABEL: Record<string, string> = { email: "emails", meeting: "meetings", call: "calls", deal: "deal moves" };
  return (
    <div className="space-y-2" data-testid="activity-summary">
      {variant === "both" && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setSection(s => s === "upcoming" ? "all" : "upcoming")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] hover:opacity-80 ${section === "upcoming" ? "border-primary bg-primary/5 font-semibold" : "bg-card"}`}
            data-testid="activity-chip-upcoming"
          >
            <CalendarDays className="w-3 h-3 text-muted-foreground" />
            <span className="font-semibold tabular-nums">{allUpcoming.length}</span>
            <span className="text-muted-foreground">upcoming</span>
          </button>
          <button
            onClick={() => setSection(s => s === "recent" ? "all" : "recent")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] hover:opacity-80 ${section === "recent" ? "border-primary bg-primary/5 font-semibold" : "bg-card"}`}
            data-testid="activity-chip-recent"
          >
            <Activity className="w-3 h-3 text-muted-foreground" />
            <span className="font-semibold tabular-nums">{allRecent.length}</span>
            <span className="text-muted-foreground">recent</span>
          </button>
          {(["email", "meeting", "call", "deal"] as const).filter(k => kindCounts[k]).map(k => {
            const Icon = KIND_ICON[k] || Activity;
            return (
              <button
                key={k}
                onClick={() => setKind(f => f === k ? null : k)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] hover:opacity-80 ${kind === k ? "border-primary bg-primary/5 font-semibold" : kind ? "opacity-40" : "bg-card"}`}
                data-testid={`activity-kind-${k}`}
              >
                <Icon className="w-3 h-3 text-muted-foreground" />
                <span className="font-semibold tabular-nums">{kindCounts[k]}</span>
                <span className="text-muted-foreground">{KIND_LABEL[k]}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
      {upcoming.length > 0 && (
        <div>
          {variant === "both" && (
            <div className="text-[10px] uppercase tracking-wide font-semibold mb-1 sticky top-0 bg-card text-muted-foreground">Upcoming · {upcoming.length}</div>
          )}
          <div className="space-y-0.5">
            {upcoming.map(ev => {
              const inner = (
                <>
                  <CalendarDays className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs leading-snug truncate">{ev.title}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1 flex-wrap">
                      {new Date(ev.start_time).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                      {" · "}
                      {new Date(ev.start_time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      {ev.location && <span className="inline-flex items-center gap-0.5 truncate"><MapPin className="w-2.5 h-2.5" />{ev.location}</span>}
                    </div>
                  </div>
                  {ev.event_type && <Badge variant="outline" className="text-[9px] shrink-0">{ev.event_type}</Badge>}
                  {ev.deal_id && (
                    <Link href={`/deals/${ev.deal_id}`} onClick={e => e.stopPropagation()}>
                      <Badge variant="outline" className="text-[9px] shrink-0 cursor-pointer hover:bg-muted">deal →</Badge>
                    </Link>
                  )}
                  {ev.property_name && !propertyId && (
                    ev.property_id
                      ? <Badge variant="outline" className="text-[9px] shrink-0 max-w-[110px] truncate cursor-pointer hover:bg-muted">{ev.property_name} →</Badge>
                      : <span className="text-[9px] text-muted-foreground shrink-0 max-w-[110px] truncate">{ev.property_name}</span>
                  )}
                </>
              );
              const cls = "flex items-start gap-2 px-1.5 py-1 rounded hover:bg-muted/40 min-w-0";
              const tip = (
                <div className="space-y-1">
                  <p className="text-xs font-semibold leading-snug">{ev.title}</p>
                  <p className="text-[10px] opacity-80">
                    {new Date(ev.start_time).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                    {" · "}
                    {new Date(ev.start_time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  {ev.location && <p className="text-[10px] opacity-80">{ev.location}</p>}
                  {ev.property_name && <p className="text-[10px] opacity-80">{ev.property_name}</p>}
                </div>
              );
              const row = ev.property_id && !propertyId ? (
                <Link href={`/properties/${ev.property_id}`} className={cls} data-testid={`activity-upcoming-${ev.id}`}>{inner}</Link>
              ) : (
                <div className={cls} data-testid={`activity-upcoming-${ev.id}`}>{inner}</div>
              );
              return (
                <Tooltip key={ev.id} delayDuration={250}>
                  <TooltipTrigger asChild>{row}</TooltipTrigger>
                  <TooltipContent side="top" align="start" className="max-w-[340px]">{tip}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}
      {recent.length > 0 && (
        <div>
          {variant === "both" && (
            <div className="text-[10px] uppercase tracking-wide font-semibold mb-1 sticky top-0 bg-card text-muted-foreground">Recent · {recent.length}</div>
          )}
          <div className="space-y-0.5">
            {recent.map(a => (
              <RecentRow key={a.id} a={a} propertyId={propertyId} summaries={summaries} setSummaries={setSummaries} />
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

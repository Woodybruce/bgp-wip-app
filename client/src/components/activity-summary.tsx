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
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Mail, Phone, Users, Activity, CalendarDays, MapPin, Handshake, Sparkles, Plus, Loader2, UserRound, Building, ChevronRight, ExternalLink } from "lucide-react";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CompanyChip } from "@/components/company-chip";
import { cn } from "@/lib/utils";

type UpcomingEvent = {
  id: number; title: string; event_type: string | null;
  start_time: string; end_time: string | null; location: string | null;
  property_id: string | null; property_name: string | null; deal_id: string | null;
};
type RecentItem = {
  id: string; kind: string; date: string; summary: string;
  subject?: string | null; ai_summary?: string | null; summary_skipped?: boolean;
  contact_id: string | null; contact_name?: string | null; contact_email?: string | null;
  company_id?: string | null; company_name?: string | null; company_domain?: string | null;
  bgp_user?: string | null; direction?: string | null;
  property_id?: string | null; property_name?: string | null;
  microsoft_id?: string | null;
  deal_id: string | null; deal_name: string | null; stage?: string | null;
};
type Opened = { type: "recent"; item: RecentItem } | { type: "upcoming"; item: UpcomingEvent };

function timeAgo(date: string): string {
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
const fullDate = (d: string) => `${new Date(d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} at ${new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
// The day heading a recent row sits under.
function dayBucket(date: string): string {
  const days = Math.round((dayStart(new Date()) - dayStart(new Date(date))) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 31) return "This month";
  return "Earlier";
}

const KIND_ICON: Record<string, typeof Mail> = { email: Mail, call: Phone, meeting: Users, deal: Handshake };
const KIND_WORD: Record<string, string> = { email: "Email", call: "Call", meeting: "Meeting", deal: "Deal move" };
const kindWord = (a: RecentItem) => a.kind === "email" ? (a.direction === "outbound" ? "Email sent" : a.direction === "inbound" ? "Email received" : "Email") : KIND_WORD[a.kind] || "Activity";

// One row shape for the whole feed (Woody, 2026-11-15: "bring the design up
// to speed"): an icon chip, what it was about, who and when under it, and
// the whole row opens the details box.
function FeedRow({ icon: Icon, title, sub, when, onOpen, testId }: {
  icon: typeof Mail; title: string; sub: React.ReactNode; when: string; onOpen: () => void; testId: string;
}) {
  return (
    <button type="button" data-no-min-touch onClick={onOpen}
      className="w-full flex items-center gap-2.5 px-1.5 py-1.5 rounded-md text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-w-0 group/row"
      data-testid={testId}>
      <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0"><Icon className="w-3.5 h-3.5 text-muted-foreground" /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm leading-snug font-medium truncate">{title}</span>
        <span className="block text-xs text-muted-foreground truncate">{sub}</span>
      </span>
      <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">{when}</span>
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 group-hover/row:text-foreground" />
    </button>
  );
}

function DetailLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2 text-sm min-w-0">
      <span className="text-xs text-muted-foreground pt-0.5">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}
const linkCls = "text-primary hover:underline";

// The details box: what it was, who was on it, what it is linked to, a short
// read of what it was about, and the next things to do with it.
function ActivityDetail({ opened, onClose, propertyId, feedDealId, summaries, setSummaries }: {
  opened: Opened | null;
  onClose: () => void;
  propertyId?: string;
  // The deal whose page the feed is on: it is not linked back to itself.
  feedDealId?: string;
  summaries: Record<string, string>;
  setSummaries: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const { toast } = useToast();
  const a = opened?.type === "recent" ? opened.item : null;
  const ev = opened?.type === "upcoming" ? opened.item : null;
  const isDealMove = a?.kind === "deal";
  const aiText = a ? summaries[a.id] || a.ai_summary || null : null;
  const [nothingToRead, setNothingToRead] = useState<Record<string, boolean>>({});

  const summarise = useMutation({
    mutationFn: async (id: string) => ({ id, body: await (await apiRequest("POST", `/api/interactions/${id}/summarise`)).json() }),
    onSuccess: ({ id, body }: any) => {
      if (body.summary) setSummaries(prev => ({ ...prev, [id]: body.summary }));
      else setNothingToRead(prev => ({ ...prev, [id]: true }));
    },
    onError: (_e: any, id: string) => setNothingToRead(prev => ({ ...prev, [id]: true })),
  });
  // Opening an email, call or meeting reads it once if nobody has yet.
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!a || isDealMove || aiText || a.summary_skipped || nothingToRead[a.id] || askedFor.current === a.id) return;
    askedFor.current = a.id;
    summarise.mutate(a.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id]);

  const addTask = useMutation({
    mutationFn: async () => {
      const title = a ? `Follow up: ${a.subject || a.summary}` : `Prepare: ${ev!.title}`;
      const linkedProperty = propertyId || a?.property_id || ev?.property_id || null;
      const r = await apiRequest("POST", "/api/tasks", {
        title, priority: "medium",
        ...(linkedProperty ? { linkedPropertyId: linkedProperty } : {}),
        ...(a?.contact_id ? { linkedContactId: a.contact_id } : {}),
        ...((a?.deal_id || ev?.deal_id) ? { linkedDealId: a?.deal_id || ev?.deal_id } : {}),
      });
      return r.json();
    },
    onSuccess: () => toast({ title: "Task added", description: "It is on your task list." }),
    onError: (e: any) => toast({ title: "Couldn't add task", description: e?.message, variant: "destructive" }),
  });

  const Icon = a ? KIND_ICON[a.kind] || Activity : CalendarDays;
  const title = a ? a.subject || a.summary : ev?.title || "";
  const itemDealId = a?.deal_id || ev?.deal_id || null;
  const dealId = itemDealId && itemDealId !== feedDealId ? itemDealId : null;
  const propId = a?.property_id || ev?.property_id || null;
  const propName = a?.property_name || ev?.property_name || null;
  const reading = !!a && summarise.isPending && summarise.variables === a.id;

  return (
    <Dialog open={!!opened} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="activity-detail">
        {opened && (
          <>
            <DialogHeader>
              <DialogDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold">
                <Icon className="w-3.5 h-3.5" />
                {a ? kindWord(a) : ev?.event_type || "In the diary"}
              </DialogDescription>
              <DialogTitle className="text-base leading-snug break-words">{title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <DetailLine label="When">
                {a ? <>{fullDate(a.date)} <span className="text-muted-foreground">· {timeAgo(a.date)}</span></> : fullDate(ev!.start_time)}
              </DetailLine>
              {ev?.location && <DetailLine label="Where"><span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3 text-muted-foreground" />{ev.location}</span></DetailLine>}
              {a && !isDealMove && a.bgp_user && <DetailLine label="BGP">{a.bgp_user}</DetailLine>}
              {a && !isDealMove && (a.contact_name || a.contact_email) && (
                <DetailLine label="With">
                  {a.contact_id
                    ? <Link href={`/contacts/${a.contact_id}`} className={linkCls} onClick={onClose} data-testid="activity-detail-contact">{a.contact_name || a.contact_email}</Link>
                    : a.contact_name || a.contact_email}
                </DetailLine>
              )}
              {a?.company_name && (
                <DetailLine label="Company">
                  <span onClick={a.company_id ? onClose : undefined}><CompanyChip id={a.company_id} name={a.company_name} domain={a.company_domain || null} size={16} className={a.company_id ? "text-primary" : undefined} testId="activity-detail-company" /></span>
                </DetailLine>
              )}
              {isDealMove && a?.stage && <DetailLine label="Stage">Now at {a.stage}</DetailLine>}
              {dealId && (
                <DetailLine label="Deal">
                  <Link href={`/deals/${dealId}`} className={linkCls} onClick={onClose} data-testid="activity-detail-deal">{a?.deal_name || "Open the deal"}</Link>
                </DetailLine>
              )}
              {propName && (
                <DetailLine label="Property">
                  {propId && propId !== propertyId
                    ? <Link href={`/properties/${propId}`} className={linkCls} onClick={onClose} data-testid="activity-detail-property">{propName}</Link>
                    : propName}
                </DetailLine>
              )}
              {a && !isDealMove && !a.subject && <DetailLine label="What">{a.summary}</DetailLine>}
            </div>
            {a && !isDealMove && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm leading-relaxed" data-testid="activity-detail-read">
                <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1 flex items-center gap-1"><Sparkles className="w-3 h-3" />What it was about</p>
                {aiText
                  ? <p>{aiText}</p>
                  : reading
                    ? <p className="text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Reading it…</p>
                    : <p className="text-muted-foreground">No notes or transcript were captured for this one, so there is nothing more to read.</p>}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button size="sm" variant="outline" onClick={() => addTask.mutate()} disabled={addTask.isPending} data-testid="activity-detail-task">
                {addTask.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}{a ? "Add follow-up task" : "Add task"}
              </Button>
              {a && !isDealMove && (
                <Button size="sm" variant="outline" data-testid="activity-detail-book" onClick={() => {
                  const subject = encodeURIComponent(`Follow-up: ${a.subject || a.summary}`);
                  const body = encodeURIComponent(aiText || a.summary || "");
                  const to = a.contact_email ? `&to=${encodeURIComponent(a.contact_email)}` : "";
                  window.open(`https://outlook.office.com/calendar/0/deeplink/compose?subject=${subject}&body=${body}${to}`, "_blank", "noopener");
                }}>
                  <CalendarDays className="w-3.5 h-3.5 mr-1" />Book follow-up
                </Button>
              )}
              {a?.kind === "email" && a.microsoft_id && (
                <Button size="sm" variant="outline" data-testid="activity-detail-outlook" onClick={() => window.open(`https://outlook.office365.com/owa/?ItemID=${encodeURIComponent(a.microsoft_id!)}&exvsurl=1&viewmodel=ReadMessageItem`, "_blank", "noopener")}>
                  <ExternalLink className="w-3.5 h-3.5 mr-1" />Open in Outlook
                </Button>
              )}
              {a?.contact_id && (
                <Button size="sm" variant="ghost" asChild><Link href={`/contacts/${a.contact_id}`} onClick={onClose}><UserRound className="w-3.5 h-3.5 mr-1" />Contact</Link></Button>
              )}
              {dealId && (
                <Button size="sm" variant="ghost" asChild><Link href={`/deals/${dealId}`} onClick={onClose}><Handshake className="w-3.5 h-3.5 mr-1" />Deal</Link></Button>
              )}
              {propId && propId !== propertyId && (
                <Button size="sm" variant="ghost" asChild><Link href={`/properties/${propId}`} onClick={onClose}><Building className="w-3.5 h-3.5 mr-1" />Property</Link></Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ActivitySummary({ propertyId, companyId, contactId, dealId, variant = "both" }: {
  propertyId?: string;
  companyId?: string;
  // One person's or one deal's feed: the last 12 months.
  contactId?: string;
  dealId?: string;
  variant?: "both" | "upcoming" | "recent";
}) {
  const params = new URLSearchParams();
  if (propertyId) params.set("propertyId", propertyId);
  if (companyId) params.set("companyId", companyId);
  if (contactId) params.set("contactId", contactId);
  if (dealId) params.set("dealId", dealId);
  const longWindow = !!(contactId || dealId);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const { data, isLoading } = useQuery<{ upcoming: UpcomingEvent[]; recent: RecentItem[] }>({
    queryKey: ["/api/activity-summary", propertyId || null, companyId || null, contactId || null, dealId || null],
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
  const [opened, setOpened] = useState<Opened | null>(null);
  const sectionHead = cn("text-[11px] uppercase tracking-wider font-semibold mb-1 py-0.5 sticky top-0 z-[1] bg-card text-muted-foreground");

  // Auto-summarise the top of a SCOPED feed so it reads as briefing lines
  // without clicking (Woody, 2026-08-04, "go ahead"). Reuses the same
  // cached endpoint — rows already summarised cost nothing, and one run
  // per data load keeps it from re-firing. Global (unscoped) feeds skip it.
  const autoRanFor = useRef<string | null>(null);
  useEffect(() => {
    if (!data || (!propertyId && !companyId && !contactId && !dealId)) return;
    const scopeKey = `${propertyId || ""}:${companyId || ""}:${contactId || ""}:${dealId || ""}:${data.recent?.length || 0}`;
    if (autoRanFor.current === scopeKey) return;
    autoRanFor.current = scopeKey;
    const targets = (data.recent || [])
      .filter(a => a.kind !== "deal" && !a.ai_summary && !(a as any).summary_skipped)
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
  }, [data, propertyId, companyId, contactId, dealId]);

  if (isLoading) {
    return (
      <div className="space-y-1.5" data-testid="activity-summary">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-7" />)}
      </div>
    );
  }

  const allUpcoming = variant === "recent" ? [] : (data?.upcoming || []);
  // On a deal's page its own moves are on the Timeline, not in this feed.
  const allRecent = (variant === "upcoming" ? [] : (data?.recent || [])).filter(a => !(dealId && a.kind === "deal" && (!a.deal_id || a.deal_id === dealId)));
  const kindCounts: Record<string, number> = {};
  for (const a of allRecent) kindCounts[a.kind] = (kindCounts[a.kind] || 0) + 1;
  const upcoming = (section === "recent" ? [] : allUpcoming);
  const recent = (section === "upcoming" ? [] : allRecent).filter(a => !kind || a.kind === kind);

  if (allUpcoming.length === 0 && allRecent.length === 0) {
    return (
      <div className="text-center py-4" data-testid="activity-summary">
        <Activity className="w-6 h-6 mx-auto mb-1 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">
          {variant === "upcoming" ? "No upcoming events." : variant === "recent" ? `No emails, calls or meetings logged in the last ${longWindow ? "12 months" : "14 days"}.` : `Nothing in the diary and no activity logged in the last ${longWindow ? "12 months" : "14 days"}.`}
        </p>
      </div>
    );
  }

  const KIND_LABEL: Record<string, string> = { email: "emails", meeting: "meetings", call: "calls", deal: "deal moves" };
  return (
    <div className="space-y-2" data-testid="activity-summary">
      {variant === "both" && (Object.keys(kindCounts).length > 1 || (allUpcoming.length > 0 && allRecent.length > 0)) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* "0 upcoming" was the only chip that showed at zero. */}
          {/* Filters are the standard pills (docs/DESIGN.md §3), counts in mono. */}
          {allUpcoming.length > 0 && allRecent.length > 0 && <Pill
            active={section === "upcoming"}
            onClick={() => setSection(s => s === "upcoming" ? "all" : "upcoming")}
            data-testid="activity-chip-upcoming"
          >
            <span className="font-mono tabular-nums">{allUpcoming.length}</span> upcoming
          </Pill>}
          {allUpcoming.length > 0 && allRecent.length > 0 && <Pill
            active={section === "recent"}
            onClick={() => setSection(s => s === "recent" ? "all" : "recent")}
            data-testid="activity-chip-recent"
          >
            <span className="font-mono tabular-nums">{allRecent.length}</span> recent
          </Pill>}
          {Object.keys(kindCounts).length > 1 && (["email", "meeting", "call", "deal"] as const).filter(k => kindCounts[k]).map(k => (
            <Pill
              key={k}
              active={kind === k}
              onClick={() => setKind(f => f === k ? null : k)}
              data-testid={`activity-kind-${k}`}
            >
              <span className="font-mono tabular-nums">{kindCounts[k]}</span> {kindCounts[k] === 1 ? KIND_LABEL[k].replace(/s$/, "").replace(/moves$/, "move") : KIND_LABEL[k]}
            </Pill>
          ))}
        </div>
      )}
      <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
      {upcoming.length > 0 && (
        <div>
          {variant === "both" && (
            <div className={sectionHead}>Upcoming <span className="font-mono tabular-nums font-normal">{upcoming.length}</span></div>
          )}
          <div className="space-y-0.5">
            {upcoming.map(ev => (
              <FeedRow key={ev.id} icon={CalendarDays} title={ev.title} testId={`activity-upcoming-${ev.id}`}
                onOpen={() => setOpened({ type: "upcoming", item: ev })}
                when={new Date(ev.start_time).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                sub={[
                  new Date(ev.start_time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
                  ev.event_type, ev.location, !propertyId ? ev.property_name : null,
                ].filter(Boolean).join(" · ")} />
            ))}
          </div>
        </div>
      )}
      {recent.length > 0 && (() => {
        const groups: { label: string; rows: RecentItem[] }[] = [];
        for (const a of recent) {
          const label = dayBucket(a.date);
          const last = groups[groups.length - 1];
          if (last && last.label === label) last.rows.push(a); else groups.push({ label, rows: [a] });
        }
        return groups.map(g => (
          <div key={g.label}>
            <div className={sectionHead}>{g.label} <span className="font-mono tabular-nums font-normal">{g.rows.length}</span></div>
            <div className="space-y-0.5">
              {g.rows.map(a => {
                const read = summaries[a.id] || a.ai_summary || null;
                return (
                  <FeedRow key={a.id} icon={KIND_ICON[a.kind] || Activity} title={a.subject || a.summary} testId={`activity-recent-${a.id}`}
                    onOpen={() => setOpened({ type: "recent", item: a })}
                    when={timeAgo(a.date)}
                    sub={a.subject ? (read ? `${a.summary} · ${read}` : a.summary) : read || kindWord(a)} />
                );
              })}
            </div>
          </div>
        ));
      })()}
      </div>
      <ActivityDetail opened={opened} onClose={() => setOpened(null)} propertyId={propertyId} feedDealId={dealId} summaries={summaries} setSummaries={setSummaries} />
    </div>
  );
}

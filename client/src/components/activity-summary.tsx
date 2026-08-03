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
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, Phone, Users, Activity, CalendarDays, MapPin } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";

type UpcomingEvent = {
  id: number; title: string; event_type: string | null;
  start_time: string; end_time: string | null; location: string | null;
  property_id: string | null; property_name: string | null; deal_id: string | null;
};
type RecentItem = {
  id: string; kind: string; date: string; summary: string;
  contact_id: string | null; deal_id: string | null; deal_name: string | null;
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

const KIND_ICON: Record<string, typeof Mail> = { email: Mail, call: Phone, meeting: Users };

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

  if (isLoading) {
    return (
      <div className="space-y-1.5" data-testid="activity-summary">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-7" />)}
      </div>
    );
  }

  const upcoming = variant === "recent" ? [] : (data?.upcoming || []);
  const recent = variant === "upcoming" ? [] : (data?.recent || []);

  if (upcoming.length === 0 && recent.length === 0) {
    return (
      <div className="text-center py-4" data-testid="activity-summary">
        <Activity className="w-6 h-6 mx-auto mb-1 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">
          {variant === "upcoming" ? "No upcoming events." : variant === "recent" ? "No emails / calls / meetings logged in the last 14 days." : "Nothing in the diary and no activity logged in the last 14 days."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1" data-testid="activity-summary">
      {upcoming.length > 0 && (
        <div>
          {variant === "both" && (
            <div className="text-[10px] uppercase tracking-wide font-semibold mb-1 sticky top-0 bg-card text-emerald-700">Upcoming · {upcoming.length}</div>
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
                  {ev.property_name && !propertyId && (
                    ev.property_id
                      ? <Badge variant="outline" className="text-[9px] shrink-0 max-w-[110px] truncate">{ev.property_name}</Badge>
                      : <span className="text-[9px] text-muted-foreground shrink-0 max-w-[110px] truncate">{ev.property_name}</span>
                  )}
                </>
              );
              const cls = "flex items-start gap-2 px-1.5 py-1 rounded hover:bg-muted/40 min-w-0";
              return ev.property_id && !propertyId ? (
                <Link key={ev.id} href={`/properties/${ev.property_id}`} className={cls} data-testid={`activity-upcoming-${ev.id}`}>{inner}</Link>
              ) : (
                <div key={ev.id} className={cls} data-testid={`activity-upcoming-${ev.id}`}>{inner}</div>
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
            {recent.map(a => {
              const Icon = KIND_ICON[a.kind] || Activity;
              return (
                <div key={a.id} className="flex items-start gap-2 px-1.5 py-1 rounded hover:bg-muted/40 min-w-0" data-testid={`activity-recent-${a.id}`}>
                  <Icon className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs leading-snug">{a.summary}</div>
                    <div className="text-[10px] text-muted-foreground">{timeAgo(a.date)}</div>
                  </div>
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

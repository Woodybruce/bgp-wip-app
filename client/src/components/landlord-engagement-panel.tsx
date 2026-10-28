import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import type { EngagementData } from "@shared/crm-engagement";
import { crmEngagementLink, landlordEngagementView, landlordEventGuestSummary } from "@shared/landlord-engagement-view";

const date = (value: string | null) => value && Number.isFinite(new Date(value).getTime())
  ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) : null;

export function LandlordEngagementPanel({ companyId }: { companyId: string }) {
  const query = useQuery<EngagementData>({
    queryKey: ["/api/crm/engagement", { companyId }],
    queryFn: async () => (await apiRequest("GET", `/api/crm/engagement?companyId=${encodeURIComponent(companyId)}`)).json(),
    staleTime: 60_000, retry: false, refetchInterval: false,
  });
  const view = query.data ? landlordEngagementView(query.data, companyId) : null;
  const empty = view && !view.strategies.length && !view.upcoming.length && !view.completed.length && !view.actions.length;
  return <section style={{ containerType: "inline-size" }} className="rounded-xl border border-card-border bg-card shadow-sm p-3 space-y-3" data-testid="landlord-engagement-panel">
    <div className="flex items-center justify-between flex-wrap gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-primary" />Events &amp; strategies</h3>
      <Link href={crmEngagementLink(companyId)} className="text-sm text-primary hover:underline">Open CRM plan</Link>
    </div>
    {query.isLoading ? <p className="text-sm text-muted-foreground">Loading the relationship plan…</p>
      : query.isError ? <p role="status" className="text-sm text-muted-foreground">The relationship plan could not be loaded. <button type="button" className="underline" onClick={() => query.refetch()}>Try again</button></p>
      : empty ? <p className="text-sm text-muted-foreground">No events, strategies or follow-ups linked yet. Add them in the CRM plan.</p>
      : view && <div className="grid grid-cols-1 [@container(min-width:760px)]:grid-cols-3 gap-4">
        <div className="min-w-0 space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">Active strategies</h4>
          {!view.strategies.length && <p className="text-sm text-muted-foreground">No active strategy linked.</p>}
          {view.strategies.slice(0, 2).map(strategy => <div key={strategy.id} className="space-y-1">
            <Link href={crmEngagementLink(companyId, { strategy: strategy.id })} className="text-sm font-semibold hover:text-primary">{strategy.name}</Link>
            <p className="text-sm leading-relaxed line-clamp-3">{strategy.targets.find(target => target.companyId === companyId)?.reason || strategy.objective}</p>
            {strategy.ownerName && <p className="text-xs text-muted-foreground">{strategy.ownerName}</p>}
          </div>)}
          {view.strategies.length > 2 && <Link href={crmEngagementLink(companyId)} className="block text-xs text-primary hover:underline">View all {view.strategies.length} strategies</Link>}
        </div>
        <div className="min-w-0 space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">Events</h4>
          {!view.upcoming.length && !view.completed.length && <p className="text-sm text-muted-foreground">No planned events or recorded outcomes.</p>}
          {view.upcoming.slice(0, 2).map(event => <div key={event.id} className="space-y-1">
            <Link href={crmEngagementLink(companyId, { event: event.id })} className="text-sm font-semibold hover:text-primary">{event.title}</Link>
            <p className="text-xs text-muted-foreground">{event.dateConfirmed ? date(event.startsAt) || "Date to confirm" : "Date to confirm"}{event.ownerName ? ` · ${event.ownerName}` : ""}{event.status === "draft" ? " · Draft" : ""}</p>
            <p className="text-sm leading-relaxed line-clamp-2">{event.companies.find(link => link.companyId === companyId)?.reason}</p>
            {landlordEventGuestSummary(event, companyId) && <p className="text-xs text-muted-foreground">{landlordEventGuestSummary(event, companyId)}</p>}
          </div>)}
          {view.completed.slice(0, 1).map(event => <div key={event.id} className="space-y-1 border-t border-border pt-2">
            <Link href={crmEngagementLink(companyId, { event: event.id })} className="text-sm font-semibold hover:text-primary">{event.title}</Link>
            <p className="text-xs text-muted-foreground">{date(event.startsAt)} · Recorded outcome</p>
            <p className="text-sm leading-relaxed line-clamp-2">{event.outcome}</p>
          </div>)}
          {view.events.length > view.upcoming.slice(0, 2).length + view.completed.slice(0, 1).length && <Link href={crmEngagementLink(companyId)} className="block text-xs text-primary hover:underline">View all {view.events.length} events</Link>}
        </div>
        <div className="min-w-0 space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">Follow-ups</h4>
          {!view.actions.length && <p className="text-sm text-muted-foreground">No open follow-ups.</p>}
          {view.actions.slice(0, 3).map(action => <div key={action.id} className="space-y-1">
            <Link href={crmEngagementLink(companyId, { action: action.id })} className="text-sm font-semibold hover:text-primary">{action.title}</Link>
            <p className="text-xs text-muted-foreground">{action.ownerName || "Owner not recorded"}{action.dueAt ? ` · Due ${date(action.dueAt)}` : " · No date set"}{action.status === "in_progress" ? " · In progress" : ""}</p>
          </div>)}
          {view.actions.length > 3 && <Link href={crmEngagementLink(companyId)} className="block text-xs text-primary hover:underline">View all {view.actions.length} follow-ups</Link>}
        </div>
      </div>}
  </section>;
}

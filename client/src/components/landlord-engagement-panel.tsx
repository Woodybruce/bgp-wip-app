import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Plus } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ActionEditor } from "@/components/crm-engagement/dialogs";
import { invalidateEngagement } from "@/components/crm-engagement/overview";
import { LandlordInterviewNotes } from "@/components/landlord-interview-notes";
import type { ActionInput, EngagementData, EngagementOptions } from "@shared/crm-engagement";
import { crmEngagementLink, landlordEngagementView, landlordEventGuestSummary } from "@shared/landlord-engagement-view";

const date = (value: string | null) => value && Number.isFinite(new Date(value).getTime())
  ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) : null;
type ActionDraft = { initial: Partial<ActionInput>; sourceNote?: { interviewee?: string | null; excerpt?: string | null; sourceUrl?: string | null } };

export function LandlordEngagementPanel({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<ActionDraft | null>(null);
  useEffect(() => setDraft(null), [companyId]);
  const query = useQuery<EngagementData>({
    queryKey: ["/api/crm/engagement", { companyId }],
    queryFn: async () => (await apiRequest("GET", `/api/crm/engagement?companyId=${encodeURIComponent(companyId)}`)).json(),
    staleTime: 60_000, retry: false, refetchInterval: false,
  });
  const optionsQuery = useQuery<EngagementOptions>({
    queryKey: ["/api/crm/engagement", "options"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/engagement/options")).json(),
    enabled: !!draft, staleTime: 5 * 60_000, retry: false, refetchInterval: false,
  });
  const view = query.data ? landlordEngagementView(query.data, companyId) : null;
  function addAction(eventId?: string) { setDraft({ initial: { companyId, eventId: eventId || null, title: "" } }); }
  async function saveAction(input: ActionInput) {
    try { await apiRequest("POST", "/api/crm/engagement/actions", input); }
    catch (error) {
      const message = error instanceof Error ? error.message : "The CRM action could not be saved.";
      const json = message.match(/\{.*\}$/s)?.[0];
      if (json) { let detail: string | undefined; try { detail = JSON.parse(json).error; } catch {} if (detail) throw new Error(detail); }
      throw new Error(message);
    }
    await invalidateEngagement();
    toast({ title: "CRM action saved" });
  }
  return <section style={{ containerType: "inline-size" }} className="rounded-xl border border-card-border bg-card shadow-sm p-3 space-y-3" data-testid="landlord-engagement-panel">
    <div className="flex items-center justify-between flex-wrap gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-primary" />CRM plan</h3>
      <div className="flex items-center flex-wrap gap-3">
        <Link href={crmEngagementLink(companyId)} className="text-xs text-muted-foreground hover:underline">Open full plan</Link>
        <Button type="button" size="sm" variant="outline" disabled={!query.data} onClick={() => addAction()}><Plus className="h-3.5 w-3.5 mr-1" />Add CRM action</Button>
      </div>
    </div>
    {query.isLoading ? <p className="text-sm text-muted-foreground">Loading the relationship plan…</p>
      : query.isError ? <p role="status" className="text-sm text-muted-foreground">The relationship plan could not be loaded. <button type="button" className="underline" onClick={() => query.refetch()}>Try again</button></p>
      : view && <div className="grid grid-cols-1 [@container(min-width:760px)]:grid-cols-3 gap-4">
        <div className="min-w-0 space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">CRM actions</h4>
          {!view.actions.length && <p className="text-sm text-muted-foreground">No open CRM actions. Add a clear next step and choose its owner and due date.</p>}
          {view.actions.slice(0, 3).map(action => {
            const event = view.events.find(event => event.id === action.eventId);
            return <div key={action.id} className="space-y-1">
              <Link href={crmEngagementLink(companyId, { action: action.id })} className="text-sm font-semibold hover:text-primary">{action.title}</Link>
              <p className="text-xs text-muted-foreground">{action.ownerName || "Owner not recorded"}{action.dueAt ? ` · Due ${date(action.dueAt)}` : " · No date set"} · {action.status === "in_progress" ? "In progress" : "To do"}</p>
              {event && <Link href={crmEngagementLink(companyId, { event: event.id })} className="block text-xs text-muted-foreground hover:underline">Event: {event.title}</Link>}
              {action.source && <Link href={action.source.url} className="block text-xs text-muted-foreground hover:underline">{action.source.label}</Link>}
            </div>;
          })}
          {view.actions.length > 3 && <Link href={crmEngagementLink(companyId)} className="block text-xs text-primary hover:underline">View all {view.actions.length} CRM actions</Link>}
        </div>
        <div className="min-w-0 space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">Events</h4>
          {!view.upcoming.length && !view.completed.length && <p className="text-sm text-muted-foreground">No planned events or recorded outcomes.</p>}
          {view.upcoming.slice(0, 2).map(event => <div key={event.id} className="space-y-1">
            <Link href={crmEngagementLink(companyId, { event: event.id })} className="text-sm font-semibold hover:text-primary">{event.title}</Link>
            <p className="text-xs text-muted-foreground">{event.dateConfirmed ? date(event.startsAt) || "Date to confirm" : "Date to confirm"}{event.ownerName ? ` · ${event.ownerName}` : ""}{event.status === "draft" ? " · Draft" : ""}</p>
            <p className="text-sm leading-relaxed line-clamp-2">{event.companies.find(link => link.companyId === companyId)?.reason}</p>
            {landlordEventGuestSummary(event, companyId) && <p className="text-xs text-muted-foreground">{landlordEventGuestSummary(event, companyId)}</p>}
            <button type="button" onClick={() => addAction(event.id)} className="text-xs text-primary hover:underline">Add CRM action</button>
          </div>)}
          {view.completed.slice(0, 1).map(event => <div key={event.id} className="space-y-1 border-t border-border pt-2">
            <Link href={crmEngagementLink(companyId, { event: event.id })} className="text-sm font-semibold hover:text-primary">{event.title}</Link>
            <p className="text-xs text-muted-foreground">{date(event.startsAt)} · Recorded outcome</p>
            <p className="text-sm leading-relaxed line-clamp-2">{event.outcome}</p>
            <button type="button" onClick={() => addAction(event.id)} className="text-xs text-primary hover:underline">Add CRM action</button>
          </div>)}
          {view.events.length > view.upcoming.slice(0, 2).length + view.completed.slice(0, 1).length && <Link href={crmEngagementLink(companyId)} className="block text-xs text-primary hover:underline">View all {view.events.length} events</Link>}
        </div>
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
      </div>}
    <LandlordInterviewNotes companyId={companyId} onCreateAction={query.data ? note => setDraft({
      initial: { companyId, title: "", notes: [note.questionLabel, note.excerpt].filter(Boolean).join("\n\n"), sourceInterviewId: note.interviewId, sourceQuestionId: note.questionId },
      sourceNote: { interviewee: note.interviewee || note.team, excerpt: [note.questionLabel, note.excerpt].filter(Boolean).join("\n\n"), sourceUrl: note.sourceUrl },
    }) : undefined} />
    {draft && optionsQuery.isLoading && <p role="status" className="text-sm text-muted-foreground">Loading the action form…</p>}
    {draft && optionsQuery.isError && <p role="status" className="text-sm text-muted-foreground">The action form could not be loaded. <button type="button" className="underline" onClick={() => optionsQuery.refetch()}>Try again</button></p>}
    {draft && optionsQuery.data && query.data && <ActionEditor key={`${draft.initial.eventId || ""}:${draft.initial.sourceInterviewId || ""}:${draft.initial.sourceQuestionId || ""}`} companyId={companyId} initial={draft.initial} sourceNote={draft.sourceNote} options={optionsQuery.data} data={query.data} onClose={() => setDraft(null)} onSave={saveAction} />}
  </section>;
}

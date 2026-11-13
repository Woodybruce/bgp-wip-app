import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Plus } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ActionEditor } from "@/components/crm-engagement/dialogs";
import { SharedMarker, actionPlanLine, invalidateEngagement } from "@/components/crm-engagement/overview";
import { LandlordInterviewNotes } from "@/components/landlord-interview-notes";
import { BandHeading } from "@/components/brand-page/brand-top";
import { BrandQuietLine, brandCardAction, brandCardClass, useBrandPagePattern } from "@/components/brand-page/brand-card";
import type { ActionInput, EngagementData, EngagementOptions } from "@shared/crm-engagement";
import { crmEngagementLink, landlordEngagementView, landlordEventGuestSummary } from "@shared/landlord-engagement-view";

const date = (value: string | null) => value && Number.isFinite(new Date(value).getTime())
  ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) : null;
type ActionDraft = { initial: Partial<ActionInput>; sourceNote?: { interviewee?: string | null; excerpt?: string | null; sourceUrl?: string | null } };

// kind="brand": the same plan on a brand page (no interview notes — those
// are landlord planning). client: a Landsec login — adds actions for a BGP
// owner and sees the ones its own company raised, plus any action BGP chose
// to show it (title, due date, owner, status and place only, under "From
// BGP"); BGP's strategies, events and other actions are not sent to it, so
// those columns are not drawn. BGP staff see a "Shared with" marker on an
// action a client is shown.
export function LandlordEngagementPanel({ companyId, kind = "landlord", client = false }: { companyId: string; kind?: "landlord" | "brand"; client?: boolean }) {
  const { toast } = useToast();
  const onBrandPage = useBrandPagePattern();
  const PlanLink = ({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) =>
    client ? <span className={className}>{children}</span> : <Link href={href} className={className}>{children}</Link>;
  const planLink = (record?: { event?: string; strategy?: string; action?: string }) => crmEngagementLink(companyId, record, kind);
  const [draft, setDraft] = useState<ActionDraft | null>(null);
  useEffect(() => setDraft(null), [companyId]);
  const query = useQuery<EngagementData>({
    queryKey: ["/api/crm/engagement", { companyId }],
    queryFn: async () => (await apiRequest("GET", `/api/crm/engagement?companyId=${encodeURIComponent(companyId)}`)).json(),
    staleTime: 60_000, retry: false, refetchInterval: false,
  });
  const optionsQuery = useQuery<EngagementOptions>({
    queryKey: ["/api/crm/engagement", "options", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/crm/engagement/options?companyId=${encodeURIComponent(companyId)}`)).json(),
    enabled: !!draft, staleTime: 5 * 60_000, retry: false, refetchInterval: false,
  });
  const view = query.data ? landlordEngagementView(query.data, companyId) : null;
  const ownActions = view ? (client ? view.actions.filter(action => action.raisedBy !== "bgp") : view.actions) : [];
  const fromBgp = view && client ? view.actions.filter(action => action.raisedBy === "bgp") : [];
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
  // The action form and its loading lines, drawn under the card or the quiet line.
  const actionForm = <>
    {draft && optionsQuery.isLoading && <p role="status" className="text-sm text-muted-foreground">Loading the action form…</p>}
    {draft && optionsQuery.isError && <p role="status" className="text-sm text-muted-foreground">The action form could not be loaded. <button type="button" className="underline" onClick={() => optionsQuery.refetch()}>Try again</button></p>}
    {draft && optionsQuery.data && query.data && <ActionEditor key={`${draft.initial.eventId || ""}:${draft.initial.sourceInterviewId || ""}:${draft.initial.sourceQuestionId || ""}`} companyId={companyId} kind={kind} initial={draft.initial} sourceNote={draft.sourceNote} options={optionsQuery.data} data={query.data} onClose={() => setDraft(null)} onSave={saveAction} />}
  </>;
  // A brand's page follows its one card pattern (Woody, 2026-11-12): a small
  // uppercase title with the open actions counted, small text actions, and a
  // plan with nothing in it is one quiet line with the action that starts it
  // (a client login's line adds its request for BGP). Landlord pages keep
  // their card, and so does the Brand tab of a deal.
  const brand = kind === "brand" && onBrandPage;
  if (brand && view && !view.actions.length && (client || (!view.events.length && !view.strategies.length))) {
    // In the Overview's card grid the line sits under the cards and takes the
    // row, and a card mounted after it there takes the width a plan card
    // would have shared with it.
    return <div className="space-y-2 min-w-0 col-span-full order-last [&~*]:col-span-full" data-testid="landlord-engagement-panel">
      <BrandQuietLine testId="brand-plan-empty">
        {client ? "Nothing open with BGP on this brand" : "No CRM actions, events or strategies yet"} · <button type="button" className={brandCardAction} onClick={() => addAction()} data-testid="button-brand-plan-add">{client ? "Add a request for BGP" : "Add CRM action"}</button>
        {!client && <> · <PlanLink href={planLink()} className={brandCardAction}>Open full plan</PlanLink></>}
      </BrandQuietLine>
      {actionForm}
    </div>;
  }
  const brandBlocks = view ? [ownActions.length, view.events.length, view.strategies.length].filter(count => count > 0).length : 0;
  const blockTitle = (label: string, count: number) => brand
    ? <BandHeading count={count || null}>{label}</BandHeading>
    : <h4 className="text-xs font-semibold text-muted-foreground">{label}</h4>;
  // A brand's page lists five actions, and a list only one or two over that in full.
  const actionCap = !brand ? 3 : view && view.actions.length <= 7 ? 7 : 5;
  const itemTitle = brand ? "text-[13px] font-medium leading-snug hover:text-primary" : "text-sm font-semibold hover:text-primary";
  const viewAll = (count: number, what: string) => brand ? <>Show all <span className="font-mono tabular-nums">{count}</span></> : `View all ${count} ${what}`;
  return <section style={{ containerType: "inline-size" }} className={brand ? `${brandCardClass} space-y-2.5` : "rounded-xl border border-card-border bg-card shadow-sm p-3 space-y-3"} data-testid="landlord-engagement-panel">
    <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-1">
      {brand
        ? <BandHeading count={client ? view?.actions.length || null : null}><CalendarDays className="h-3.5 w-3.5" />{client ? "Your requests to BGP" : "CRM plan"}</BandHeading>
        : <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-primary" />CRM plan</h3>}
      {brand ? <div className="flex items-center flex-wrap gap-3">
        <button type="button" className={brandCardAction} disabled={!query.data} onClick={() => addAction()} data-testid="button-brand-plan-add">{client ? "Add a request for BGP" : "Add CRM action"}</button>
        {!client && <PlanLink href={planLink()} className={brandCardAction}>Open full plan</PlanLink>}
      </div> : <div className="flex items-center flex-wrap gap-3">
        {!client && <PlanLink href={planLink()} className="text-xs text-muted-foreground hover:underline">Open full plan</PlanLink>}
        <Button type="button" size="sm" variant="outline" disabled={!query.data} onClick={() => addAction()}><Plus className="h-3.5 w-3.5 mr-1" />Add CRM action</Button>
      </div>}
    </div>
    {query.isLoading ? <p className="text-sm text-muted-foreground">Loading the relationship plan…</p>
      : query.isError ? <p role="status" className="text-sm text-muted-foreground">The relationship plan could not be loaded. <button type="button" className="underline" onClick={() => query.refetch()}>Try again</button></p>
      // Off a brand's own page (the Brand tab of a deal), a brand with no plan
      // at all gets one line, not an empty-state sentence in each column.
      : view && kind === "brand" && !brand && !client && !view.actions.length && !view.events.length && !view.strategies.length
        ? <p className="text-sm text-muted-foreground" data-testid="brand-plan-empty">No CRM actions, events or strategies yet — add a clear next step and choose its owner and due date.</p>
      // A brand's card draws only the blocks that hold something, side by side.
      : view && <div className={`grid grid-cols-1 gap-4 ${client ? "" : !brand || brandBlocks === 3 ? "[@container(min-width:760px)]:grid-cols-3" : brandBlocks === 2 ? "[@container(min-width:760px)]:grid-cols-2" : ""}`}>
        {(!brand || client || ownActions.length > 0) && <div className={`min-w-0 ${brand ? "space-y-1.5" : "space-y-2"}`}>
          {!(brand && client) && blockTitle(client ? "Your requests to BGP" : "CRM actions", ownActions.length)}
          {!ownActions.length && <p className="text-sm text-muted-foreground">{client ? "Nothing open. Add an action for BGP on this brand and choose who should pick it up." : "No open CRM actions. Add a clear next step and choose its owner and due date."}</p>}
          {ownActions.slice(0, actionCap).map(action => {
            const event = view.events.find(event => event.id === action.eventId);
            const meta = `${action.ownerName || "Owner not recorded"}${action.dueAt ? ` · Due ${date(action.dueAt)}` : " · No date set"} · ${action.status === "in_progress" ? "In progress" : "To do"}`;
            // A brand's page: one line per action, the size of the rows around
            // it: the title, then who, when and where it stands on the right.
            if (brand) return <div key={action.id} className="min-w-0 border-b border-border/30 pb-1.5 last:border-0 last:pb-0" data-testid={`brand-plan-action-${action.id}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <PlanLink href={planLink({ action: action.id })} className="min-w-0 text-[13px] font-medium leading-snug hover:text-primary">{action.title}</PlanLink>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">{meta}</span>
              </div>
              {!client && (actionPlanLine(action) || action.sharedWithCompanyId) && <p className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-1.5">{actionPlanLine(action)}<SharedMarker action={action} /></p>}
              {event && <PlanLink href={planLink({ event: event.id })} className="block text-[11px] text-muted-foreground hover:underline">Event: {event.title}</PlanLink>}
              {action.source && <Link href={action.source.url} className="block text-[11px] text-muted-foreground hover:underline">{action.source.label}</Link>}
            </div>;
            return <div key={action.id} className="space-y-1">
              <PlanLink href={planLink({ action: action.id })} className="text-sm font-semibold hover:text-primary">{action.title}</PlanLink>
              <p className="text-xs text-muted-foreground">{meta}</p>
              {!client && (actionPlanLine(action) || action.sharedWithCompanyId) && <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5">{actionPlanLine(action)}<SharedMarker action={action} /></p>}
              {event && <PlanLink href={planLink({ event: event.id })} className="block text-xs text-muted-foreground hover:underline">Event: {event.title}</PlanLink>}
              {action.source && <Link href={action.source.url} className="block text-xs text-muted-foreground hover:underline">{action.source.label}</Link>}
            </div>;
          })}
          {ownActions.length > actionCap && <PlanLink href={planLink()} className="block text-xs text-primary hover:underline">{viewAll(ownActions.length, "CRM actions")}</PlanLink>}
          {!!fromBgp.length && <div className="space-y-2 border-t border-border pt-2" data-testid="brand-plan-from-bgp">
            <h4 className="text-xs font-semibold text-muted-foreground">From BGP</h4>
            {fromBgp.slice(0, 5).map(action => <div key={action.id} className="space-y-1" data-testid={`brand-plan-from-bgp-${action.id}`}>
              <p className="text-sm font-semibold">{action.title}</p>
              <p className="text-xs text-muted-foreground">{action.ownerName || "BGP"}{action.dueAt ? ` · Due ${date(action.dueAt)}` : " · No date set"} · {action.status === "in_progress" ? "In progress" : "To do"}</p>
              {(action.schemeName || action.unitLabel) && <p className="text-xs text-muted-foreground">{[action.schemeName, action.unitLabel].filter(Boolean).join(" · ")}</p>}
            </div>)}
            {fromBgp.length > 5 && <p className="text-xs text-muted-foreground">and {fromBgp.length - 5} more from BGP</p>}
          </div>}
        </div>}
        {!client && (!brand || view.events.length > 0) && <div className="min-w-0 space-y-2">
          {blockTitle("Events", view.events.length)}
          {!view.upcoming.length && !view.completed.length && <p className="text-sm text-muted-foreground">No planned events or recorded outcomes.</p>}
          {view.upcoming.slice(0, 2).map(event => <div key={event.id} className="space-y-1">
            <PlanLink href={planLink({ event: event.id })} className={itemTitle}>{event.title}</PlanLink>
            <p className="text-xs text-muted-foreground">{event.dateConfirmed ? date(event.startsAt) || "Date to confirm" : "Date to confirm"}{event.ownerName ? ` · ${event.ownerName}` : ""}{event.status === "draft" ? " · Draft" : ""}</p>
            <p className="text-sm leading-relaxed line-clamp-2">{event.companies.find(link => link.companyId === companyId)?.reason}</p>
            {landlordEventGuestSummary(event, companyId) && <p className="text-xs text-muted-foreground">{landlordEventGuestSummary(event, companyId)}</p>}
            <button type="button" onClick={() => addAction(event.id)} className="text-xs text-primary hover:underline">Add CRM action</button>
          </div>)}
          {view.completed.slice(0, 1).map(event => <div key={event.id} className="space-y-1 border-t border-border pt-2">
            <PlanLink href={planLink({ event: event.id })} className={itemTitle}>{event.title}</PlanLink>
            <p className="text-xs text-muted-foreground">{date(event.startsAt)} · Recorded outcome</p>
            <p className="text-sm leading-relaxed line-clamp-2">{event.outcome}</p>
            <button type="button" onClick={() => addAction(event.id)} className="text-xs text-primary hover:underline">Add CRM action</button>
          </div>)}
          {view.events.length > view.upcoming.slice(0, 2).length + view.completed.slice(0, 1).length && <PlanLink href={planLink()} className="block text-xs text-primary hover:underline">{viewAll(view.events.length, "events")}</PlanLink>}
        </div>}
        {!client && (!brand || view.strategies.length > 0) && <div className="min-w-0 space-y-2">
          {blockTitle("Active strategies", view.strategies.length)}
          {!view.strategies.length && <p className="text-sm text-muted-foreground">No active strategy linked.</p>}
          {view.strategies.slice(0, 2).map(strategy => <div key={strategy.id} className="space-y-1">
            <PlanLink href={planLink({ strategy: strategy.id })} className={itemTitle}>{strategy.name}</PlanLink>
            <p className="text-sm leading-relaxed line-clamp-3">{strategy.targets.find(target => target.companyId === companyId)?.reason || strategy.objective}</p>
            {strategy.ownerName && <p className="text-xs text-muted-foreground">{strategy.ownerName}</p>}
          </div>)}
          {view.strategies.length > 2 && <PlanLink href={planLink()} className="block text-xs text-primary hover:underline">{viewAll(view.strategies.length, "strategies")}</PlanLink>}
        </div>}
      </div>}
    {kind === "landlord" && !client && <LandlordInterviewNotes companyId={companyId} onCreateAction={query.data ? note => setDraft({
      initial: { companyId, title: "", notes: [note.questionLabel, note.excerpt].filter(Boolean).join("\n\n"), sourceInterviewId: note.interviewId, sourceQuestionId: note.questionId },
      sourceNote: { interviewee: note.interviewee || note.team, excerpt: [note.questionLabel, note.excerpt].filter(Boolean).join("\n\n"), sourceUrl: note.sourceUrl },
    }) : undefined} />}
    {actionForm}
  </section>;
}

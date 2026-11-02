import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Plus, RefreshCw, Target } from "lucide-react";
import type { ActionInput, ActionStatus, EngagementAction, EngagementData, EngagementEvent, EngagementOptions, EngagementStrategy, EventInput, StrategyInput } from "@shared/crm-engagement";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmEntityPicker } from "@/components/crm-entity-picker";
import { ActionEditor, Choice, EventEditor, StrategyEditor } from "./dialogs";
import { CRM_ENGAGEMENT_KEY, EVENT_LABELS, LONDON, eventDate, eventMatchesCompany, eventOccursOn, londonDay, monthDays, moveMonth } from "./helpers";

const EMPTY: EngagementData = {events: [], strategies: [], actions: []};
const EMPTY_OPTIONS: EngagementOptions = {staff: [], companies: [], contacts: []};
type Editor = {kind: "event"; record?: EngagementEvent} | {kind: "strategy"; record?: EngagementStrategy} | {kind: "action"; record?: EngagementAction; initial?: Partial<ActionInput>};
const statusLabels = {todo: "To do", in_progress: "In progress", done: "Done"};

export async function invalidateEngagement() {
  await Promise.all([
    queryClient.invalidateQueries({queryKey: [CRM_ENGAGEMENT_KEY]}),
    queryClient.invalidateQueries({queryKey: ["/api/tasks"]}),
    queryClient.invalidateQueries({queryKey: ["/api/marketing/events"]}),
    queryClient.invalidateQueries({predicate: q => q.queryKey[0] === "/api/brand" && q.queryKey[2] === "ai-take"}),
  ]);
}
function cleanError(error: unknown) {
  const message = error instanceof Error ? error.message : "Could not load CRM planning.";
  const json = message.match(/\{.*\}$/s)?.[0];
  if (json) { try { return JSON.parse(json).error || message; } catch {} }
  return message;
}
function Empty({children}: {children: React.ReactNode}) { return <p className="text-sm text-muted-foreground py-5">{children}</p>; }
function statusPill(text: string) { return <span className="text-[11px] font-semibold uppercase tracking-wide border rounded-full px-2 py-0.5 whitespace-nowrap">{text}</span>; }
function EventRow({event, onOpen, companyId, actions, onAddAction, onOpenAction, writable}: {
  event: EngagementEvent; onOpen: () => void; companyId: string; actions: EngagementAction[];
  onAddAction: (companyId: string, event: EngagementEvent) => void;
  onOpenAction: (action: EngagementAction) => void; writable: boolean;
}) {
  const relevant = companyId ? event.companies.filter(c => c.companyId === companyId) : event.companies;
  function actionRow(action: EngagementAction) {
    return <div key={action.id} className="text-xs py-1" data-testid={`crm-event-action-${action.id}`}>
      <button type="button" className={`text-left font-medium hover:underline ${action.status === "done" ? "text-muted-foreground" : ""}`} onClick={() => onOpenAction(action)}>{action.title}</button>
      <p className="text-muted-foreground mt-0.5">{action.ownerName || "Owner not set"}{action.dueAt ? ` · Due ${eventDate(action.dueAt, false)}` : ""} · {statusLabels[action.status]}</p>
    </div>;
  }
  return <div className="py-3 space-y-2" data-testid={`crm-event-${event.id}`}>
    <div className="flex items-start justify-between gap-3"><button type="button" className="text-sm font-semibold text-left hover:underline" onClick={onOpen}>{event.title}</button>{statusPill(event.dateConfirmed ? EVENT_LABELS[event.status] || event.status : "Date to confirm")}</div>
    <p className="text-xs text-muted-foreground">{event.dateConfirmed ? eventDate(event.startsAt) : event.startsAt ? `Provisional: ${eventDate(event.startsAt)}` : "Date not set"}{event.location ? ` · ${event.location}` : ""}{event.ownerName ? ` · ${event.ownerName}` : ""}</p>
    {relevant.map(company => {
      const linkedActions = actions.filter(action => action.eventId === event.id && action.companyId === company.companyId)
        .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.dueAt || "9999").localeCompare(b.dueAt || "9999"));
      return <div key={company.companyId} className="border-l-2 pl-3 space-y-1" data-testid={`crm-event-company-${event.id}-${company.companyId}`}>
        <div className="flex items-start justify-between flex-wrap gap-x-3 gap-y-1">
          <Link className="text-sm font-medium hover:underline" href={`/companies/${company.companyId}`}>{company.companyName}</Link>
          <button type="button" className="text-xs underline disabled:opacity-50" disabled={!writable} onClick={() => onAddAction(company.companyId, event)}>Add CRM action</button>
        </div>
        {company.reason && <p className="text-xs text-muted-foreground leading-relaxed">{company.reason}</p>}
        {linkedActions.length ? <div>
          {linkedActions.slice(0, 2).map(actionRow)}
          {linkedActions.length > 2 && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground py-1">Show {linkedActions.length - 2} more action{linkedActions.length === 3 ? "" : "s"}</summary>{linkedActions.slice(2).map(actionRow)}</details>}
        </div> : <p className="text-xs text-muted-foreground">No CRM action yet.</p>}
      </div>;
    })}
    {!!event.guests.length && <p className="text-[11px] text-muted-foreground"><span className="font-mono tabular-nums">{event.guests.length}</span> guest{event.guests.length === 1 ? "" : "s"} · <span className="font-mono tabular-nums">{event.guests.filter(g => g.status === "accepted").length}</span> accepted · <span className="font-mono tabular-nums">{event.guests.filter(g => g.status === "attended").length}</span> attended</p>}
  </div>;
}

export function CrmEngagementPanel({companyId, compact = false}: {companyId?: string; compact?: boolean}) {
  const search = useSearch();
  const {toast} = useToast();
  const initial = useRef(new URLSearchParams(window.location.search));
  const [companyFilter, setCompanyFilter] = useState(companyId || initial.current.get("company") || "");
  const [strategyFilter, setStrategyFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [month, setMonth] = useState(() => londonDay(new Date()).slice(0, 7));
  const [view, setView] = useState<"month" | "list">(() => compact || window.innerWidth < 640 ? "list" : "month");
  const [selectedDay, setSelectedDay] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [updatingAction, setUpdatingAction] = useState("");
  const deepLinkHandled = useRef("");
  const dataQuery = useQuery<EngagementData>({
    queryKey: [CRM_ENGAGEMENT_KEY, companyId ? {companyId} : {}],
    queryFn: async () => (await apiRequest("GET", `${CRM_ENGAGEMENT_KEY}${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`)).json(),
    staleTime: 60_000, refetchInterval: false, retry: 1,
  });
  const optionsQuery = useQuery<EngagementOptions>({
    queryKey: [CRM_ENGAGEMENT_KEY, "options"], queryFn: async () => (await apiRequest("GET", `${CRM_ENGAGEMENT_KEY}/options`)).json(),
    staleTime: 5 * 60_000, refetchInterval: false, retry: 1,
  });
  const data = dataQuery.data || EMPTY;
  const options = optionsQuery.data || EMPTY_OPTIONS;
  useEffect(() => {
    if (!dataQuery.data) return;
    const params = new URLSearchParams(search);
    const focusKey = [params.get("event"), params.get("strategy"), params.get("action")].join(":");
    if (deepLinkHandled.current === focusKey) return;
    const event = data.events.find(e => e.id === params.get("event"));
    const strategy = data.strategies.find(s => s.id === params.get("strategy"));
    const action = data.actions.find(a => a.id === params.get("action"));
    if (event) { setEditor({kind: "event", record: event}); if (event.startsAt) setMonth(londonDay(event.startsAt).slice(0, 7)); }
    else if (strategy) setEditor({kind: "strategy", record: strategy});
    else if (action) setEditor({kind: "action", record: action});
    else if (params.get("event") || params.get("strategy") || params.get("action")) toast({title: "That planning record is no longer available", description: "The current CRM overview is shown below."});
    deepLinkHandled.current = focusKey;
  }, [dataQuery.data, search]);
  useEffect(() => { setCompanyFilter(companyId || new URLSearchParams(search).get("company") || ""); }, [search, companyId]);
  function closeEditor() {
    setEditor(null);
    const url = new URL(window.location.href);
    ["event", "strategy", "action"].forEach(key => url.searchParams.delete(key));
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }
  function filterCompany(id: string) {
    setCompanyFilter(id); setSelectedDay("");
    if (!companyId) { const url = new URL(window.location.href); if (id) url.searchParams.set("company", id); else url.searchParams.delete("company"); window.history.replaceState(null, "", `${url.pathname}${url.search}`); }
  }
  async function save(path: string, body: unknown, id?: string) {
    try { await apiRequest(id ? "PUT" : "POST", `${CRM_ENGAGEMENT_KEY}/${path}${id ? `/${encodeURIComponent(id)}` : ""}`, body); }
    catch (error) { throw new Error(cleanError(error)); }
    await invalidateEngagement(); toast({title: "CRM planning saved"});
  }
  function addEventAction(linkedCompanyId: string, event: EngagementEvent) {
    const linkedStrategies = data.strategies.filter(strategy => event.strategyIds.includes(strategy.id)
      && strategy.targets.some(target => target.companyId === linkedCompanyId));
    setEditor({kind: "action", initial: {companyId: linkedCompanyId, eventId: event.id,
      strategyId: linkedStrategies.length === 1 ? linkedStrategies[0].id : null}});
  }
  async function changeAction(action: EngagementAction, status: ActionStatus) {
    if (action.canEdit !== true) return;
    setUpdatingAction(action.id);
    try { await apiRequest("PATCH", `${CRM_ENGAGEMENT_KEY}/actions/${encodeURIComponent(action.id)}`, {status}); await invalidateEngagement(); setEditor(previous => previous?.kind === "action" && previous.record?.id === action.id ? {...previous, record: {...action, status}} : previous); }
    catch (error) { toast({title: "Could not update the CRM action", description: cleanError(error), variant: "destructive"}); }
    finally { setUpdatingAction(""); }
  }
  const events = useMemo(() => data.events.filter(e => eventMatchesCompany(e, companyFilter)
    && (!strategyFilter || e.strategyIds.includes(strategyFilter)) && (!ownerFilter || e.ownerId === ownerFilter)), [data.events, companyFilter, strategyFilter, ownerFilter]);
  const strategies = useMemo(() => data.strategies.filter(s => (!companyFilter || s.targets.some(t => t.companyId === companyFilter))
    && (!strategyFilter || s.id === strategyFilter) && (!ownerFilter || s.ownerId === ownerFilter) && (showClosed || s.status === "active")), [data.strategies, companyFilter, strategyFilter, ownerFilter, showClosed]);
  const actions = useMemo(() => data.actions.filter(a => (!companyFilter || a.companyId === companyFilter) && (!strategyFilter || a.strategyId === strategyFilter)
    && (!ownerFilter || a.ownerId === ownerFilter) && (showDone || a.status !== "done")).sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.dueAt || "9999").localeCompare(b.dueAt || "9999")), [data.actions, companyFilter, strategyFilter, ownerFilter, showDone]);
  const days = monthDays(month);
  const confirmed = events.filter(e => e.dateConfirmed && e.status !== "cancelled" && e.startsAt);
  const monthEvents = confirmed.filter(e => days.filter(day => day.startsWith(month)).some(day => eventOccursOn(e, day))).sort((a, b) => (a.startsAt || "").localeCompare(b.startsAt || ""));
  const undated = events.filter(e => !e.dateConfirmed && e.status !== "cancelled" && e.status !== "completed");
  const monthLabel = new Intl.DateTimeFormat("en-GB", {month: "long", year: "numeric", timeZone: "UTC"}).format(new Date(`${month}-01T12:00:00Z`));
  const today = londonDay(new Date());
  const visibleList = selectedDay ? confirmed.filter(e => eventOccursOn(e, selectedDay)) : monthEvents;
  const writable = !!optionsQuery.data;

  if (dataQuery.isLoading) return <div className="space-y-4" aria-label="Loading CRM overview"><Skeleton className="h-10 w-full" /><div className="grid lg:grid-cols-[2fr_1fr] gap-4"><Skeleton className="h-96" /><Skeleton className="h-96" /></div></div>;
  if (dataQuery.isError) return <Card className="p-5"><p role="alert" className="text-sm">CRM planning could not be loaded.</p><p className="text-xs text-muted-foreground mt-1">{cleanError(dataQuery.error)}</p><Button className="mt-3" variant="outline" size="sm" onClick={() => dataQuery.refetch()}>Try again</Button></Card>;

  return <div className="space-y-4" data-testid="crm-engagement-overview">
    <div className="flex items-start justify-between flex-wrap gap-3">
      <div><h2 className="text-base font-semibold">{compact ? "Events & strategies" : "Relationship planning"}</h2><p className="text-sm text-muted-foreground">Plan the activity, link the people and agree the next action.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!writable} onClick={() => setEditor({kind: "strategy"})}><Target className="h-4 w-4 mr-1.5" />New strategy</Button><Button variant="outline" size="sm" disabled={!writable} onClick={() => setEditor({kind: "action"})}>Add CRM action</Button><Button size="sm" disabled={!writable} onClick={() => setEditor({kind: "event"})}><Plus className="h-4 w-4 mr-1.5" />New event</Button></div>
    </div>
    {optionsQuery.isError && <p role="status" className="text-sm text-muted-foreground">The contact and owner lists could not be loaded. <button className="underline" onClick={() => optionsQuery.refetch()}>Try again</button></p>}
    {!compact && <div className="grid sm:grid-cols-3 gap-3 rounded-lg border bg-card p-3">
      {!companyId && <div className="space-y-1.5"><p className="text-sm font-medium">Landlord</p><CrmEntityPicker value={companyFilter} options={options.companies} onSelect={c => filterCompany(c.id)} onClear={() => filterCompany("")} emptyLabel="All landlords" className="border rounded-md px-3 py-2 min-h-9" testIdPrefix="crm-overview-company" /></div>}
      <Choice label="Strategy" value={strategyFilter} onChange={v => {setStrategyFilter(v); setSelectedDay("");}}><option value="">All strategies</option>{data.strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Choice>
      <Choice label="BGP owner" value={ownerFilter} onChange={v => {setOwnerFilter(v); setSelectedDay("");}}><option value="">All owners</option>{options.staff.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Choice>
    </div>}
    <div className={`grid gap-4 ${compact ? "" : "xl:grid-cols-[minmax(0,1.8fr)_minmax(300px,1fr)]"}`}>
      <Card className="p-4 min-w-0" data-testid="crm-events-calendar">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><CalendarDays className="h-4 w-4" />Events calendar</h3><div className="flex gap-1"><Pill active={view === "month"} onClick={() => {setView("month"); setSelectedDay("");}}>Month</Pill><Pill active={view === "list"} onClick={() => {setView("list"); setSelectedDay("");}}>List</Pill></div></div>
        <div className="flex items-center justify-between gap-2 mb-3"><div className="flex items-center gap-1"><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Previous month" onClick={() => {setMonth(moveMonth(month, -1)); setSelectedDay("");}}><ChevronLeft className="h-4 w-4" /></Button><h4 className="text-sm font-semibold min-w-32 text-center">{monthLabel}</h4><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Next month" onClick={() => {setMonth(moveMonth(month, 1)); setSelectedDay("");}}><ChevronRight className="h-4 w-4" /></Button></div><Button size="sm" variant="ghost" onClick={() => {setMonth(today.slice(0, 7)); setSelectedDay("");}}>Today</Button></div>
        {view === "month" && <div className="rounded-lg border overflow-hidden"><div className="grid grid-cols-7 bg-muted/30">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <div key={day} className="text-[11px] font-semibold text-center text-muted-foreground p-2">{day}</div>)}</div><div className="grid grid-cols-7">{days.map(day => {const dayEvents = confirmed.filter(event => eventOccursOn(event, day)); return <div key={day} className={`min-h-20 sm:min-h-24 border-t border-r last:border-r-0 p-1 sm:p-1.5 min-w-0 ${!day.startsWith(month) ? "bg-muted/20 text-muted-foreground" : ""} ${selectedDay === day ? "bg-primary/5" : ""}`}>
          <button type="button" className={`text-xs font-mono tabular-nums h-6 w-6 rounded-full hover:bg-muted ${today === day ? "bg-primary text-primary-foreground font-semibold" : ""}`} aria-label={`Show events on ${eventDate(`${day}T12:00:00Z`, false)}`} onClick={() => setSelectedDay(selectedDay === day ? "" : day)}>{Number(day.slice(-2))}</button>
          <div className="space-y-1 mt-1">{dayEvents.slice(0, 2).map(event => <button key={event.id} type="button" disabled={!writable} onClick={() => setEditor({kind: "event", record: event})} className="block w-full text-left text-[11px] leading-tight rounded bg-muted px-1 py-1 hover:bg-primary/10 truncate" title={event.title}>{event.title}</button>)}{dayEvents.length > 2 && <button className="text-[11px] text-primary" onClick={() => setSelectedDay(day)}>+{dayEvents.length - 2} more</button>}</div>
        </div>; })}</div></div>}
        {(view === "list" || selectedDay) && <div className="max-h-[410px] overflow-y-auto divide-y pr-1">{selectedDay && <div className="flex justify-between pt-3"><p className="text-sm font-medium">{eventDate(`${selectedDay}T12:00:00Z`, false)}</p><button className="text-xs underline" onClick={() => setSelectedDay("")}>Clear day</button></div>}{visibleList.length ? visibleList.map(event => <EventRow key={event.id} event={event} companyId={companyFilter} actions={data.actions} writable={writable} onAddAction={addEventAction} onOpenAction={record => setEditor({kind: "action", record})} onOpen={() => setEditor({kind: "event", record: event})} />) : <Empty>No confirmed events {selectedDay ? "on this date" : "this month"}{companyFilter || strategyFilter || ownerFilter ? " for these filters" : ""}.</Empty>}</div>}
        {view === "month" && !selectedDay && !monthEvents.length && <p className="text-xs text-muted-foreground mt-3">No confirmed events this month{companyFilter || strategyFilter || ownerFilter ? " for these filters" : ""}.</p>}
        {!!undated.length && <details className="border-t mt-4 pt-3"><summary className="text-sm cursor-pointer font-medium">Dates to confirm <span className="font-mono tabular-nums text-muted-foreground">({undated.length})</span></summary><p className="text-xs text-muted-foreground mt-2">Check the date before placing these events in the calendar.</p><div className="max-h-72 overflow-y-auto divide-y">{undated.map(event => <EventRow key={event.id} event={event} companyId={companyFilter} actions={data.actions} writable={writable} onAddAction={addEventAction} onOpenAction={record => setEditor({kind: "action", record})} onOpen={() => setEditor({kind: "event", record: event})} />)}</div></details>}
        <div className="flex items-center justify-between gap-2 border-t mt-4 pt-3 text-xs text-muted-foreground"><span>London time</span><Link href="/contacts?tab=meetings" className="underline">CRM Meetings</Link></div>
      </Card>
      <Card className="p-4 min-w-0" data-testid="crm-active-strategies"><div className="flex items-center justify-between gap-2 mb-3"><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Target className="h-4 w-4" />Strategies</h3><label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />Show all</label></div>
        <div className="max-h-[520px] overflow-y-auto space-y-3 pr-1">{strategies.length ? strategies.map(strategy => <div key={strategy.id} className="border rounded-lg p-3 space-y-2" data-testid={`crm-strategy-${strategy.id}`}><div className="flex items-start justify-between gap-2"><button type="button" disabled={!writable} className="text-sm font-semibold text-left hover:underline" onClick={() => setEditor({kind: "strategy", record: strategy})}>{strategy.name}</button>{statusPill(strategy.status)}</div><p className="text-sm leading-relaxed">{strategy.objective}</p><p className="text-xs text-muted-foreground">{strategy.ownerName || "Owner not set"}{strategy.team ? ` · ${strategy.team}` : ""}{strategy.endsOn ? ` · Review ${eventDate(`${strategy.endsOn.slice(0, 10)}T12:00:00Z`, false)}` : ""}</p>
          <div className="flex flex-wrap gap-x-2 gap-y-1">{strategy.targets.slice(0, 5).map(target => <Link key={target.companyId} className="text-xs underline" href={`/companies/${target.companyId}`}>{target.companyName}</Link>)}{strategy.targets.length > 5 && <span className="text-xs text-muted-foreground">+{strategy.targets.length - 5} more</span>}</div>
          {companyFilter && strategy.targets.find(t => t.companyId === companyFilter)?.reason && <p className="text-sm border-t pt-2">{strategy.targets.find(t => t.companyId === companyFilter)?.reason}</p>}
          <p className="text-[11px] text-muted-foreground"><span className="font-mono tabular-nums">{data.events.filter(e => e.strategyIds.includes(strategy.id)).length}</span> linked event{data.events.filter(e => e.strategyIds.includes(strategy.id)).length === 1 ? "" : "s"} · <span className="font-mono tabular-nums">{data.actions.filter(a => a.strategyId === strategy.id && a.status !== "done").length}</span> open action{data.actions.filter(a => a.strategyId === strategy.id && a.status !== "done").length === 1 ? "" : "s"}</p>
        </div>) : <Empty>{showClosed ? "No strategies match these filters." : "No active strategies yet. Add an objective and the landlords it concerns to start planning the activity."}</Empty>}</div>
      </Card>
    </div>
    <Card className="p-4" data-testid="crm-follow-ups"><div className="flex items-center justify-between flex-wrap gap-2 mb-3"><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />CRM actions</h3><div className="flex items-center gap-3"><label className="text-xs text-muted-foreground flex gap-1.5 items-center"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />Show completed</label><Button variant="outline" size="sm" disabled={!writable} onClick={() => setEditor({kind: "action"})}>Add CRM action</Button></div></div>
      <div className="max-h-96 overflow-y-auto divide-y">{actions.length ? actions.map(action => <div key={action.id} className="py-3 flex items-start justify-between flex-wrap gap-3" data-testid={`crm-action-${action.id}`}><div className="min-w-0 flex-1"><button type="button" className={`text-sm font-semibold text-left hover:underline ${action.status === "done" ? "text-muted-foreground" : ""}`} onClick={() => setEditor({kind: "action", record: action})}>{action.title}</button><p className="text-xs text-muted-foreground mt-1"><Link className="underline" href={`/companies/${action.companyId}`}>{action.companyName}</Link> · {action.ownerName || "Owner not set"}{action.dueAt ? ` · Due ${eventDate(action.dueAt, false)}` : " · No due date"}</p>{action.notes && <p className="text-sm mt-1 line-clamp-2">{action.notes}</p>}</div><div className="flex items-center gap-2">{action.dueAt && action.status !== "done" && new Date(action.dueAt).getTime() < Date.now() && <span className="text-xs text-destructive">Overdue</span>}<select aria-label={`Status of ${action.title}`} className="rounded-md border bg-background text-xs px-2 py-1.5" value={action.status} disabled={updatingAction === action.id || action.canEdit !== true} onChange={e => changeAction(action, e.target.value as ActionStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>) : <Empty>No open CRM actions{companyFilter || strategyFilter || ownerFilter ? " for these filters" : ""}. Add the next action from an event, meeting or strategy.</Empty>}</div>
      <p className="border-t pt-3 mt-3 text-xs text-muted-foreground">CRM actions are shared with the owner's My Tasks.</p>
    </Card>
    <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Objectives and invitation status are recorded by the team.</span><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => dataQuery.refetch()} disabled={dataQuery.isFetching}><RefreshCw className={`h-3 w-3 mr-1 ${dataQuery.isFetching ? "animate-spin" : ""}`} />Refresh</Button></div>
    {editor?.kind === "strategy" && writable && <StrategyEditor key={editor.record?.id || "new-strategy"} record={editor.record} options={options} companyId={companyFilter || undefined} onClose={closeEditor} onSave={(input: StrategyInput, id) => save("strategies", input, id)} />}
    {editor?.kind === "event" && writable && <EventEditor key={editor.record?.id || "new-event"} record={editor.record} options={options} strategies={data.strategies} companyId={companyFilter || undefined} onClose={closeEditor} onSave={(input: EventInput, id) => save("events", input, id)} />}
    {editor?.kind === "action" && !editor.record && writable && <ActionEditor options={options} data={data} companyId={companyFilter || undefined} initial={editor.initial} onClose={closeEditor} onSave={(input: ActionInput) => save("actions", input)} />}
    {editor?.kind === "action" && editor.record && <Dialog open onOpenChange={open => {if (!open) closeEditor();}}><DialogContent><DialogHeader><DialogTitle>{editor.record.title}</DialogTitle><DialogDescription>{editor.record.companyName} · {editor.record.ownerName || "Owner not set"}</DialogDescription></DialogHeader><div className="space-y-3 text-sm"><p>Due {eventDate(editor.record.dueAt)}</p>{editor.record.notes && <p className="whitespace-pre-wrap">{editor.record.notes}</p>}<div className="flex flex-wrap gap-3"><Link className="underline" href={`/companies/${editor.record.companyId}`}>Landlord page</Link>{editor.record.source && <Link className="underline" href={editor.record.source.url}>{editor.record.source.label}</Link>}{editor.record.strategyId && <button className="underline" onClick={() => {const record = data.strategies.find(s => s.id === (editor.record as EngagementAction).strategyId); if (record) setEditor({kind: "strategy", record});}}>Linked strategy</button>}{editor.record.eventId && <button className="underline" onClick={() => {const record = data.events.find(e => e.id === (editor.record as EngagementAction).eventId); if (record) setEditor({kind: "event", record});}}>Linked event</button>}</div><Choice label="Status" value={editor.record.status} disabled={editor.record.canEdit !== true || updatingAction === editor.record.id} onChange={status => changeAction(editor.record!, status as ActionStatus)}>{Object.entries(statusLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</Choice>{editor.record.canEdit !== true && <p className="text-xs text-muted-foreground">Only the owner or person who assigned this action can update it.</p>}</div></DialogContent></Dialog>}
  </div>;
}

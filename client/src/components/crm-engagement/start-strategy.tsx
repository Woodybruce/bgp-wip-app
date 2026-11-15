// Start strategy: turning a company on in the CRM (Woody, 2026-11-15: "we
// won't have a strategy for any of them till we turn them on ... could AI
// start it a bit? help kick it off?"). The dialog shows what the app holds
// about the company and a draft to edit: a name and objective, or a strategy
// already running to join, then people to meet, events to invite them to,
// places and first actions to tick. Nothing is saved until Start strategy.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { EngagementOptions } from "@shared/crm-engagement";
import { NOUN_WORDS } from "@shared/crm-engagement";
import type { CrmKickoff, KickoffApply } from "@shared/crm-kickoff";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill } from "@/components/ui/pill";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const KEY = "/api/crm/engagement";
const errorText = (error: any) => { const raw = String(error?.message || "").replace(/^\d{3}:\s*/, ""); try { return JSON.parse(raw)?.error || raw; } catch { return raw || "Something went wrong. Please try again."; } };
const day = (value: string | null) => { const d = value ? new Date(value) : null; return d && Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "Date to confirm"; };
const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(17, 0, 0, 0); return d; };
const dateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function Tick({ checked, onChange, title, detail, hint, testId }: { checked: boolean; onChange: (v: boolean) => void; title: string; detail?: string | null; hint?: string | null; testId?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm rounded-md border p-2 cursor-pointer hover:bg-muted/30">
      <input type="checkbox" className="mt-1 accent-primary" checked={checked} onChange={e => onChange(e.target.checked)} data-testid={testId} />
      <span className="min-w-0"><span className="font-medium break-words">{title}</span>{detail && <span className="text-muted-foreground"> · {detail}</span>}
        {hint && <span className="block text-xs text-muted-foreground break-words">{hint}</span>}</span>
    </label>
  );
}
const Heading = ({ children, count }: { children: React.ReactNode; count?: number }) => <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}{count != null && <span className="ml-1.5 font-mono tabular-nums">{count}</span>}</h3>;

export function StartStrategyDialog({ company, onClose, onStarted }: { company: { id: string; name: string }; onClose: () => void; onStarted?: (strategyId: string) => void }) {
  const { toast } = useToast();
  const draft = useQuery<CrmKickoff>({
    queryKey: [KEY, "kick-off", company.id],
    queryFn: async () => (await apiRequest("POST", `${KEY}/kick-off`, { companyId: company.id })).json(),
    staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false, retry: false,
  });
  const options = useQuery<EngagementOptions>({
    queryKey: [KEY, "options", "all"], queryFn: async () => (await apiRequest("GET", `${KEY}/options?kind=all`)).json(),
    staleTime: 5 * 60_000, refetchInterval: false, retry: 1,
  });
  const me = useQuery<{ id?: string }>({ queryKey: ["/api/auth/me"] });
  const [mode, setMode] = useState<"new" | "join">("new");
  const [joinId, setJoinId] = useState("");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [reason, setReason] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [endsOn, setEndsOn] = useState(() => dateInput(inDays(182)));
  const [people, setPeople] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<Set<string>>(new Set());
  const [actions, setActions] = useState<Array<{ title: string; due: string; on: boolean; why: string | null }>>([]);
  const [morePeople, setMorePeople] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const k = draft.data;
  // The draft arrives once: it fills the form, and the person takes it from there.
  useEffect(() => {
    if (!k) return;
    setName(k.draft.name); setObjective(k.draft.objective); setReason(k.draft.reason);
    setPeople(new Set(k.people.filter(p => p.suggested).map(p => p.contactId)));
    setEvents(new Set(k.events.filter(e => e.suggested).map(e => e.eventId)));
    setActions([
      ...k.actions.map(a => ({ title: a.title, due: dateInput(inDays(a.dueInDays)), on: true, why: a.why })),
      ...k.places.map(p => ({ title: `${k.company.noun === "brand" ? "Send" : "Talk through"} ${p.name}${k.company.noun === "brand" ? ` to ${k.company.name}` : ` with ${k.company.name}`}`.slice(0, 240), due: dateInput(inDays(14)), on: false, why: [p.detail, p.why].filter(Boolean).join(" · ") || null })),
    ]);
    const suggested = k.strategies.find(s => s.suggested);
    if (suggested) setJoinId(suggested.id);
  }, [k]);
  useEffect(() => { if (!ownerId && me.data?.id && options.data?.staff.some(p => p.id === me.data!.id)) setOwnerId(me.data.id); }, [me.data, options.data, ownerId]);
  const joinable = useMemo(() => (k?.strategies || []).filter(s => !s.already), [k]);
  const shownPeople = k ? (morePeople ? k.people : k.people.filter((p, i) => p.suggested || people.has(p.contactId) || i < 6)) : [];
  const words = k ? NOUN_WORDS[k.company.noun] : null;

  async function start() {
    if (!k) return;
    setError("");
    if (!ownerId) return setError("Choose the BGP owner.");
    if (mode === "join" && !joinId) return setError("Choose the strategy to add it to.");
    if (mode === "new" && (!name.trim() || !objective.trim())) return setError("Give the strategy a name and an objective.");
    const body: KickoffApply = {
      companyId: company.id, ownerId, reason: reason.trim(), contactIds: [...people], eventIds: [...events],
      strategyId: mode === "join" ? joinId : null,
      strategy: mode === "new" ? { name: name.trim(), objective: objective.trim(), team: null, startsOn: dateInput(new Date()), endsOn: endsOn || null } : null,
      actions: actions.filter(a => a.on && a.title.trim()).map(a => ({ title: a.title.trim(), dueAt: new Date(`${a.due || dateInput(inDays(14))}T17:00:00`).toISOString(), notes: a.why })),
    };
    setSaving(true);
    try {
      const result = await (await apiRequest("POST", `${KEY}/kick-off/apply`, body)).json();
      await Promise.all([queryClient.invalidateQueries({ queryKey: [KEY] }), queryClient.invalidateQueries({ queryKey: ["/api/crm/hub"] })]);
      toast({ title: mode === "join" ? `${company.name} added to the strategy` : "Strategy started", description: [`${result.actions} action${result.actions === 1 ? "" : "s"} added`, ...(result.events ? [`${result.events} event${result.events === 1 ? "" : "s"} updated`] : []), ...(result.warnings || [])].join(" · ") });
      onStarted?.(result.strategyId);
      onClose();
    } catch (e) { setError(errorText(e)); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden p-4 sm:p-6" data-testid="start-strategy-dialog">
        <DialogHeader>
          <DialogTitle>Start a strategy for {company.name}</DialogTitle>
          <DialogDescription>{words ? `Puts this ${words.one} on the CRM: a strategy, the people to meet and the first actions. ` : ""}Nothing is saved until you press Start strategy.</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto min-h-0 space-y-5 pr-1">
          {draft.isLoading && <div className="space-y-3" aria-label="Drawing up the strategy"><p className="text-sm text-muted-foreground flex items-center gap-2"><Sparkles className="h-4 w-4" /> Reading what we hold on {company.name} and drawing up a first draft…</p><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>}
          {draft.isError && <div className="rounded-lg border p-3 text-sm"><p role="alert">{errorText(draft.error)}</p><Button className="mt-2" variant="outline" size="sm" onClick={() => draft.refetch()}>Try again</Button></div>}
          {k && <>
            <section className="rounded-lg border bg-muted/20 p-3 space-y-1.5" data-testid="kickoff-facts">
              <Heading>What we know</Heading>
              <ul className="text-sm space-y-0.5">{k.facts.map((fact, i) => <li key={i} className="break-words">{fact}</li>)}</ul>
              {k.note && <p className="text-xs text-muted-foreground">{k.note}</p>}
              {k.usedAi && <p className="text-xs text-muted-foreground flex items-center gap-1"><Sparkles className="h-3 w-3" /> The draft below was drawn up from this. Change anything.</p>}
            </section>
            {joinable.length > 0 && <div className="flex flex-wrap items-center gap-1.5" data-testid="kickoff-mode">
              <Pill active={mode === "new"} onClick={() => setMode("new")}>New strategy</Pill>
              <Pill active={mode === "join"} onClick={() => setMode("join")}>Add to one already running</Pill>
              {mode === "new" && k.strategies.some(s => s.suggested) && <span className="text-xs text-muted-foreground">Fits “{k.strategies.find(s => s.suggested)!.name}”{k.strategies.find(s => s.suggested)!.why ? `: ${k.strategies.find(s => s.suggested)!.why}` : ""}</span>}
            </div>}
            {mode === "join" ? (
              <section className="space-y-2" data-testid="kickoff-join">
                {joinable.map(s => <label key={s.id} className="flex items-start gap-2 text-sm rounded-md border p-2 cursor-pointer hover:bg-muted/30">
                  <input type="radio" name="join-strategy" className="mt-1 accent-primary" checked={joinId === s.id} onChange={() => setJoinId(s.id)} />
                  <span className="min-w-0"><span className="font-medium">{s.name}</span>{s.suggested && <span className="text-xs text-muted-foreground"> · suggested{s.why ? `: ${s.why}` : ""}</span>}
                    <span className="block text-xs text-muted-foreground break-words">{s.objective}{s.companies.length ? ` · ${s.companies.slice(0, 5).join(", ")}${s.companies.length > 5 ? ` and ${s.companies.length - 5} more` : ""}` : ""}</span></span>
                </label>)}
              </section>
            ) : (
              <section className="space-y-3">
                <label className="block space-y-1.5 text-sm"><span className="font-medium">Strategy name</span><Input value={name} maxLength={200} onChange={e => setName(e.target.value)} data-testid="kickoff-name" /></label>
                <label className="block space-y-1.5 text-sm"><span className="font-medium">Objective</span><Textarea rows={3} maxLength={4000} value={objective} onChange={e => setObjective(e.target.value)} placeholder="What do we want from this relationship, and what would count as progress?" data-testid="kickoff-objective" /></label>
              </section>
            )}
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block space-y-1.5 text-sm sm:col-span-2"><span className="font-medium">Why this {words?.one}?</span><Input value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} placeholder="The specific relationship or work this should support" data-testid="kickoff-reason" /></label>
              <label className="block space-y-1.5 text-sm"><span className="font-medium">BGP owner</span>
                <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={ownerId} onChange={e => setOwnerId(e.target.value)} data-testid="kickoff-owner">
                  <option value="">Choose owner</option>{(options.data?.staff || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></label>
            </div>
            {mode === "new" && <label className="block space-y-1.5 text-sm max-w-[14rem]"><span className="font-medium">Review date</span><Input type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} /></label>}
            <section className="space-y-2" data-testid="kickoff-people">
              <Heading count={people.size}>People to meet</Heading>
              {k.people.length ? <div className="grid sm:grid-cols-2 gap-2">{shownPeople.map(p => <Tick key={p.contactId} checked={people.has(p.contactId)} title={p.name} detail={p.role} hint={p.why}
                onChange={on => setPeople(prev => { const next = new Set(prev); if (on) next.add(p.contactId); else next.delete(p.contactId); return next; })} />)}</div>
                : <p className="text-sm text-muted-foreground">No contacts on file for {company.name} yet. Add them on its page and they can be linked to the strategy afterwards.</p>}
              {k.people.length > shownPeople.length && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setMorePeople(true)}>Show all {k.people.length}</button>}
            </section>
            {k.events.length > 0 && <section className="space-y-2" data-testid="kickoff-events">
              <Heading count={events.size}>Events to invite them to</Heading>
              <div className="grid sm:grid-cols-2 gap-2">{k.events.slice(0, 8).map(e => <Tick key={e.eventId} checked={events.has(e.eventId)} title={e.title} detail={[day(e.startsAt), e.location].filter(Boolean).join(" · ")} hint={e.why}
                onChange={on => setEvents(prev => { const next = new Set(prev); if (on) next.add(e.eventId); else next.delete(e.eventId); return next; })} />)}</div>
              <p className="text-xs text-muted-foreground">Ticking an event links {company.name} to it and adds the people ticked above as suggested guests. No invitation is sent.</p>
            </section>}
            <section className="space-y-2" data-testid="kickoff-actions">
              <Heading count={actions.filter(a => a.on).length}>First actions</Heading>
              {actions.map((action, i) => <div key={i} className="flex flex-wrap items-start gap-2 rounded-md border p-2">
                <input type="checkbox" className="mt-2.5 accent-primary" checked={action.on} aria-label={`Add action: ${action.title}`} onChange={e => setActions(prev => prev.map((a, j) => j === i ? { ...a, on: e.target.checked } : a))} />
                <div className="min-w-0 flex-1 space-y-1"><Input value={action.title} maxLength={250} onChange={e => setActions(prev => prev.map((a, j) => j === i ? { ...a, title: e.target.value } : a))} />
                  {action.why && <p className="text-xs text-muted-foreground break-words">{action.why}</p>}</div>
                <Input type="date" className="w-[10.5rem]" value={action.due} aria-label="Due date" onChange={e => setActions(prev => prev.map((a, j) => j === i ? { ...a, due: e.target.value } : a))} />
              </div>)}
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => setActions(prev => [...prev, { title: "", due: dateInput(inDays(14)), on: true, why: null }])} data-testid="kickoff-add-action">Add an action</button>
              <p className="text-xs text-muted-foreground">Each action goes to the owner's My Tasks, due at 5pm on its date.</p>
            </section>
          </>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
        <DialogFooter className="gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={start} disabled={saving || !k} data-testid="kickoff-start">{saving ? "Starting…" : mode === "join" ? "Add to strategy" : "Start strategy"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

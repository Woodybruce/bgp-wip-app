// One watch list entry, opened from the CRM Overview's Watch list (Woody,
// 2026-11-23: a "pop out summary of the brand activity with BGP", the
// "actions needed" to "actually do something", and "a box to update strategy
// and see whats needed to do for each watch list entry"; the same for
// landlords, agents and lenders). Three pills: What's needed (each owed line
// with the button that does it, and the company's open actions), Strategy
// (this company's plan, the objective, status and review date of each
// strategy it is on) and Activity with BGP (GET /api/crm/engagement/watch/:id/summary).
// Every save goes through the CRM engine's own routes, through the Overview.
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, ExternalLink, Mail, Phone, Plus, Star, Target, UserPlus, Users } from "lucide-react";
import type { ActionInput, ActionStatus, EngagementAction, EngagementData, EngagementStrategy, StrategyInput } from "@shared/crm-engagement";
import { NOUN_WORDS } from "@shared/crm-engagement";
import type { CrmWatchRow, CrmWatchSummary } from "@shared/crm-watch";
import { lastContactShort } from "@shared/last-contact";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyLinks } from "@/components/crm-hub/company-links";

export type WatchTab = "needed" | "strategy" | "activity";
export interface WatchHandlers {
  data?: EngagementData;
  onOpenStrategy: (strategyId: string) => void;
  onAddAction: (row: CrmWatchRow, initial: Partial<ActionInput>) => void;
  onChangeAction: (action: EngagementAction, status: ActionStatus) => void;
  onSaveStrategy: (input: StrategyInput, id: string) => Promise<unknown>;
  onStartStrategy: (row: CrmWatchRow) => void;
  onAddPerson: (row: CrmWatchRow) => void;
  updatingAction?: string;
}

const STATUS_WORDS: Record<ActionStatus, string> = { todo: "To do", in_progress: "In progress", done: "Done" } as Record<ActionStatus, string>;
const day = (value: string | null | undefined, time = false) => {
  const d = value ? new Date(value) : null;
  if (!d || !Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric", timeZone: "Europe/London", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}) });
};
const overdue = (action: EngagementAction) => action.status !== "done" && !!action.dueAt && Date.parse(action.dueAt) < Date.now();

// The kind of each owed line (server/crm-watch-list.ts writes them).
export function owedKind(line: string): "strategy" | "overdue" | "next" | "people" | "contact" | "other" {
  if (/^No strategy yet/i.test(line)) return "strategy";
  if (/actions? overdue$/i.test(line)) return "overdue";
  if (/^No next step/i.test(line)) return "next";
  if (/^No people on record/i.test(line)) return "people";
  if (/^No contact/i.test(line)) return "contact";
  return "other";
}

function ActionLine({ action, handlers }: { action: EngagementAction; handlers: WatchHandlers }) {
  return (
    <li className="py-2 flex flex-wrap items-start justify-between gap-2" data-testid={`crm-watch-entry-action-${action.id}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words">{action.title}</p>
        <p className="text-xs text-muted-foreground">{action.ownerName || "Owner not set"}{action.dueAt ? <> · <span className={overdue(action) ? "text-destructive" : ""}>Due {day(action.dueAt)}{overdue(action) ? " (overdue)" : ""}</span></> : " · No due date"}</p>
      </div>
      <select aria-label={`Status of ${action.title}`} className="rounded-md border bg-background text-xs px-2 py-1.5" value={action.status}
        disabled={action.canEdit !== true || handlers.updatingAction === action.id} onChange={e => handlers.onChangeAction(action, e.target.value as ActionStatus)}>
        {Object.entries(STATUS_WORDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </li>
  );
}

function StrategyBox({ strategy, row, handlers }: { strategy: EngagementStrategy; row: CrmWatchRow; handlers: WatchHandlers }) {
  const target = strategy.targets.find(t => t.companyId === row.id);
  const [plan, setPlan] = useState(target?.reason || "");
  const [objective, setObjective] = useState(strategy.objective);
  const [status, setStatus] = useState(strategy.status);
  const [endsOn, setEndsOn] = useState(strategy.endsOn?.slice(0, 10) || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const changed = plan !== (target?.reason || "") || objective !== strategy.objective || status !== strategy.status || endsOn !== (strategy.endsOn?.slice(0, 10) || "");
  async function save() {
    setSaving(true); setError("");
    try {
      await handlers.onSaveStrategy({
        name: strategy.name, objective: objective.trim(), team: strategy.team, ownerId: strategy.ownerId, status,
        startsOn: strategy.startsOn?.slice(0, 10) || null, endsOn: endsOn || null,
        targets: strategy.targets.map(t => ({ companyId: t.companyId, contactIds: t.contactIds, reason: t.companyId === row.id ? plan.trim() : t.reason })),
        expectedUpdatedAt: strategy.updatedAt,
      } as StrategyInput, strategy.id);
    } catch (e: any) { setError(String(e?.message || "The strategy could not be saved")); }
    finally { setSaving(false); }
  }
  const others = strategy.targets.length - 1;
  return (
    <div className="border rounded-lg p-3 space-y-2.5" data-testid={`crm-watch-entry-strategy-${strategy.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button type="button" className="text-sm font-semibold text-left hover:underline" onClick={() => handlers.onOpenStrategy(strategy.id)}>{strategy.name}</button>
        <span className="text-xs text-muted-foreground">{strategy.ownerName || "Owner not set"}{others > 0 ? ` · with ${others} other compan${others === 1 ? "y" : "ies"}` : ""}</span>
      </div>
      <label className="block space-y-1"><span className="text-xs font-medium">The plan for {row.name}</span>
        <Textarea rows={3} maxLength={2000} value={plan} onChange={e => setPlan(e.target.value)} placeholder={`What we want from ${row.name} on this strategy, and what happens next`} data-testid={`crm-watch-entry-plan-${strategy.id}`} />
      </label>
      <label className="block space-y-1"><span className="text-xs font-medium">Objective{others > 0 ? " (shared with the other companies on it)" : ""}</span>
        <Textarea rows={2} maxLength={4000} value={objective} onChange={e => setObjective(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1"><span className="block text-xs font-medium">Status</span>
          <select className="rounded-md border bg-background text-sm px-2 py-1.5" value={status} onChange={e => setStatus(e.target.value as StrategyInput["status"])}>
            <option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option>
          </select>
        </label>
        <label className="space-y-1"><span className="block text-xs font-medium">Review date</span>
          <Input type="date" className="h-9" value={endsOn} min={strategy.startsOn?.slice(0, 10) || undefined} onChange={e => setEndsOn(e.target.value)} />
        </label>
        <Button size="sm" disabled={!changed || saving || !objective.trim() || !plan.trim()} onClick={save} data-testid={`crm-watch-entry-save-${strategy.id}`}>{saving ? "Saving…" : "Save"}</Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ActivityPart({ row }: { row: CrmWatchRow }) {
  const summary = useQuery<CrmWatchSummary>({
    queryKey: ["/api/crm/engagement", "watch", row.id, "summary"],
    queryFn: async () => (await apiRequest("GET", `/api/crm/engagement/watch/${encodeURIComponent(row.id)}/summary`)).json(),
    staleTime: 60_000, retry: 1,
  });
  if (summary.isLoading) return <div className="space-y-2" aria-label="Loading activity"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
  if (summary.isError || !summary.data) return <p className="text-sm text-muted-foreground">BGP's activity with {row.name} could not be loaded. <button type="button" className="underline" onClick={() => summary.refetch()}>Try again</button></p>;
  const s = summary.data;
  const missing = <span className="text-muted-foreground">could not be read</span>;
  const facts = [
    lastContactShort(s.lastContactAt) ? `Last contact ${lastContactShort(s.lastContactAt)}` : "No contact logged",
    s.nextMeetingAt ? `Next meeting ${day(s.nextMeetingAt)}` : null,
    s.people ? `${s.people.length} ${s.people.length === 1 ? "person" : "people"} on record` : null,
    s.deals ? `${s.deals.length} live deal${s.deals.length === 1 ? "" : "s"}` : null,
    s.openRequirements ? `${s.openRequirements} open requirement${s.openRequirements === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return (
    <div className="space-y-4" data-testid="crm-watch-entry-activity">
      <p className="text-sm">{facts.join(" · ")}</p>
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />People</h4>
        {!s.people ? missing : !s.people.length ? <p className="text-sm text-muted-foreground">Nobody is filed under {s.name} yet.</p> : (
          <ul className="divide-y">{s.people.slice(0, 8).map(p => (
            <li key={p.id} className="py-1.5 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0"><Link href={`/contacts/${p.id}`} className="font-medium hover:underline">{p.name}</Link>{p.role ? <span className="text-muted-foreground"> · {p.role}</span> : null}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {p.email && <a href={`mailto:${p.email}`} aria-label={`Email ${p.name}`} className="hover:text-foreground"><Mail className="h-3.5 w-3.5" /></a>}
                {p.phone && <a href={`tel:${p.phone.replace(/\s+/g, "")}`} aria-label={`Call ${p.name}`} className="hover:text-foreground"><Phone className="h-3.5 w-3.5" /></a>}
                {lastContactShort(p.lastContactAt) ? `Last ${lastContactShort(p.lastContactAt)}` : "No contact logged"}
              </span>
            </li>))}
            {s.people.length > 8 && <li className="py-1.5 text-xs text-muted-foreground">and {s.people.length - 8} more on the company page</li>}
          </ul>
        )}
      </section>
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Meetings in BGP diaries</h4>
        {!s.meetings ? missing : !s.meetings.past.length && !s.meetings.next.length ? <p className="text-sm text-muted-foreground">No meetings with {s.name} in BGP diaries (30 days back, 90 ahead).</p> : (
          <ul className="space-y-1 text-sm">{[...s.meetings.next.map(m => ({ ...m, ahead: true })), ...s.meetings.past.map(m => ({ ...m, ahead: false }))].map(m => (
            <li key={`${m.start}-${m.subject}`} className="break-words"><span className={`font-mono tabular-nums text-xs ${m.ahead ? "text-foreground" : "text-muted-foreground"}`}>{day(m.start, true)}</span> {m.subject}{m.bgp.length ? <span className="text-muted-foreground"> · {m.bgp.join(", ")}</span> : null}{m.ahead ? <span className="text-xs text-primary"> · coming up</span> : null}</li>))}
          </ul>
        )}
      </section>
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />Emails and meetings logged</h4>
        {!s.recent ? missing : !s.recent.length ? <p className="text-sm text-muted-foreground">Nothing filed against {s.name} or its people yet.</p> : (
          <ul className="space-y-1 text-sm">{s.recent.map(t => (
            <li key={t.id} className="break-words"><span className="font-mono tabular-nums text-xs text-muted-foreground">{day(t.at)}</span> <span className="capitalize text-muted-foreground">{t.type}</span> {t.subject || "(no subject)"}{t.contactName || t.bgpUser ? <span className="text-muted-foreground"> · {[t.contactName, t.bgpUser].filter(Boolean).join(" and ")}</span> : null}</li>))}
          </ul>
        )}
      </section>
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Linked to</h4>
        <CompanyLinks companyId={row.id} />
      </section>
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Live deals</h4>
        {!s.deals ? missing : !s.deals.length ? <p className="text-sm text-muted-foreground">No live deals with {s.name}.</p> : (
          <ul className="space-y-1 text-sm">{s.deals.map(d => (
            <li key={d.id} className="break-words"><Link href={`/deals/${d.id}`} className="hover:underline font-medium">{d.name}</Link><span className="text-muted-foreground">{[d.dealType, d.status, d.propertyName].filter(Boolean).length ? ` · ${[d.dealType, d.status, d.propertyName].filter(Boolean).join(" · ")}` : ""}</span></li>))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function WatchEntryDialog({ row, initialTab, handlers, onClose }: { row: CrmWatchRow; initialTab?: WatchTab; handlers: WatchHandlers; onClose: () => void }) {
  const [tab, setTab] = useState<WatchTab>(initialTab || (row.owed.length ? "needed" : "activity"));
  const actions = useMemo(() => (handlers.data?.actions || []).filter(a => a.companyId === row.id && a.status !== "done")
    .sort((a, b) => (a.dueAt || "9999").localeCompare(b.dueAt || "9999")), [handlers.data, row.id]);
  const strategies = useMemo(() => (handlers.data?.strategies || []).filter(s => s.status !== "completed" && s.targets.some(t => t.companyId === row.id)), [handlers.data, row.id]);
  const strategyId = strategies.length === 1 ? strategies[0].id : null;
  const late = actions.filter(overdue);
  const doFor = (line: string) => {
    switch (owedKind(line)) {
      case "strategy": return <Button size="sm" variant="outline" onClick={() => handlers.onStartStrategy(row)}><Target className="h-3.5 w-3.5 mr-1" />Start strategy</Button>;
      case "next": return <Button size="sm" variant="outline" onClick={() => handlers.onAddAction(row, { companyId: row.id, strategyId })}><Plus className="h-3.5 w-3.5 mr-1" />Add next step</Button>;
      case "people": return <Button size="sm" variant="outline" onClick={() => handlers.onAddPerson(row)}><UserPlus className="h-3.5 w-3.5 mr-1" />Add a person</Button>;
      case "contact": return <Button size="sm" variant="outline" onClick={() => handlers.onAddAction(row, { companyId: row.id, strategyId, title: `Get in touch with ${row.name}` })}><CalendarDays className="h-3.5 w-3.5 mr-1" />Plan a call or meeting</Button>;
      case "overdue": return <span className="text-xs text-muted-foreground">Tick or move them on below</span>;
      default: return null;
    }
  };
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" data-testid={`crm-watch-entry-${row.id}`}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">{row.superBrand && <Star className="w-4 h-4 fill-amber-400 text-amber-500" aria-label="Super Brand" />}{row.name}</DialogTitle>
          <DialogDescription>{row.superBrand ? "Super Brand" : NOUN_WORDS[row.noun].One}{row.strategies.length ? ` · ${row.strategies.join(", ")}` : " · on no strategy yet"} · <Link href={`/companies/${row.id}`} className="underline inline-flex items-center gap-1">Open page<ExternalLink className="h-3 w-3" /></Link></DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          <Pill active={tab === "needed"} onClick={() => setTab("needed")} data-testid="crm-watch-entry-tab-needed">What's needed{row.owed.length ? ` · ${row.owed.length}` : ""}</Pill>
          <Pill active={tab === "strategy"} onClick={() => setTab("strategy")} data-testid="crm-watch-entry-tab-strategy">Strategy</Pill>
          <Pill active={tab === "activity"} onClick={() => setTab("activity")} data-testid="crm-watch-entry-tab-activity">Activity with BGP</Pill>
        </div>
        {tab === "needed" && <div className="space-y-4">
          {row.owed.length ? <ul className="divide-y border rounded-lg">{row.owed.map(line => (
            <li key={line} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2" data-testid={`crm-watch-entry-owed-${owedKind(line)}`}><span className="text-sm font-medium">{line}</span>{doFor(line)}</li>))}
          </ul> : <p className="text-sm text-muted-foreground flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />Nothing owed: it has a next step and recent contact.</p>}
          {late.length > 0 && <section><h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Overdue</h4><ul className="divide-y">{late.map(a => <ActionLine key={a.id} action={a} handlers={handlers} />)}</ul></section>}
          <section>
            <div className="flex items-center justify-between gap-2 mb-1"><h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Open actions</h4>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handlers.onAddAction(row, { companyId: row.id, strategyId })}><Plus className="h-3.5 w-3.5 mr-1" />Add action</Button></div>
            {actions.filter(a => !overdue(a)).length ? <ul className="divide-y">{actions.filter(a => !overdue(a)).map(a => <ActionLine key={a.id} action={a} handlers={handlers} />)}</ul>
              : <p className="text-sm text-muted-foreground">{late.length ? "Nothing else open." : "No open actions."}</p>}
          </section>
          {row.news.length > 0 && <section><h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">New in 14 days</h4><ul className="space-y-1 text-sm">{row.news.map(line => <li key={line} className="break-words">{line}</li>)}</ul></section>}
        </div>}
        {tab === "strategy" && <div className="space-y-3">
          {strategies.length ? strategies.map(s => <StrategyBox key={`${s.id}:${s.updatedAt}`} strategy={s} row={row} handlers={handlers} />)
            : <div className="border rounded-lg p-3 space-y-2"><p className="text-sm">{row.name} is on no running strategy.</p><Button size="sm" variant="outline" onClick={() => handlers.onStartStrategy(row)}><Target className="h-3.5 w-3.5 mr-1" />Start strategy</Button></div>}
        </div>}
        {tab === "activity" && <ActivityPart row={row} />}
      </DialogContent>
    </Dialog>
  );
}

// "No people on record": add a person at the company here, through the CRM's
// own contact save (POST /api/crm/contacts).
export function AddPersonDialog({ company, onClose }: { company: { id: string; name: string }; onClose: () => void }) {
  const [name, setName] = useState(""), [role, setRole] = useState(""), [email, setEmail] = useState(""), [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  async function save() {
    setSaving(true); setError("");
    try {
      await apiRequest("POST", "/api/crm/contacts", { name: name.trim(), role: role.trim() || null, email: email.trim() || null, phoneMobile: phone.trim() || null, companyId: company.id });
      await queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/crm/hub"] });
      onClose();
    } catch (e: any) { setError(String(e?.message || "The person could not be added")); }
    finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="crm-watch-add-person">
        <DialogHeader><DialogTitle>Add a person at {company.name}</DialogTitle><DialogDescription>Filed under {company.name} in the CRM.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" aria-label="Name" autoFocus />
          <Input value={role} onChange={e => setRole(e.target.value)} placeholder="Job title" aria-label="Job title" />
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" aria-label="Email" />
          <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" aria-label="Phone" />
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={!name.trim() || saving} onClick={save}>{saving ? "Saving…" : "Add person"}</Button></div>
      </DialogContent>
    </Dialog>
  );
}

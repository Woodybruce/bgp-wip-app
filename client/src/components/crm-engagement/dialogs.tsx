import { useId, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { X } from "lucide-react";
import type { ActionInput, EngagementData, EngagementEvent, EngagementOptions, EngagementStrategy, EventInput, GuestStatus, StrategyInput } from "@shared/crm-engagement";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmEntityPicker } from "@/components/crm-entity-picker";
import { EVENT_LABELS, GUEST_LABELS, londonDateTimeInput, londonInputToIso } from "./helpers";

const SELECT_CLASS = "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
export function Choice({ value, onChange, children, label, required = false, disabled = false }: {value: string; onChange: (value: string) => void; children: ReactNode; label: string; required?: boolean; disabled?: boolean}) {
  const id = useId();
  return <div className="space-y-1.5"><label htmlFor={id} className="text-sm font-medium">{label}</label><select id={id} className={SELECT_CLASS} value={value} onChange={e => onChange(e.target.value)} required={required} disabled={disabled}>{children}</select></div>;
}
function Field({ label, children }: {label: string; children: ReactNode}) {
  return <label className="block space-y-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>;
}
function Owner({ value, onChange, options, required = false }: {value: string | null; onChange: (value: string | null) => void; options: EngagementOptions; required?: boolean}) {
  return <Choice label="BGP owner" value={value || ""} onChange={v => onChange(v || null)} required={required}><option value="">Choose owner</option>{options.staff.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Choice>;
}
function Editor({ title, description, children, onClose, onSubmit, submitLabel = "Save changes" }: {title: string; description: string; children: ReactNode; onClose: () => void; onSubmit: () => Promise<unknown>; submitLabel?: string}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent className="max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden p-4 sm:p-6" aria-describedby="engagement-editor-description">
    <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription id="engagement-editor-description">{description}</DialogDescription></DialogHeader>
    <form className="min-h-0 flex flex-col gap-4" onSubmit={async e => { e.preventDefault(); setError(""); setSaving(true); try { await onSubmit(); onClose(); } catch (err: any) { setError(err?.message || "Could not save. Please try again."); } finally { setSaving(false); } }}>
      <div className="overflow-y-auto min-h-0 space-y-5 pr-1">{children}</div>
      {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
      <DialogFooter className="gap-2 border-t pt-3"><Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : submitLabel}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

function Targets({ targets, onChange, options, contacts = true }: {targets: StrategyInput["targets"]; onChange: (targets: StrategyInput["targets"]) => void; options: EngagementOptions; contacts?: boolean}) {
  return <section className="space-y-3">
    <div><h3 className="text-sm font-semibold">Landlords and purpose</h3><p className="text-xs text-muted-foreground">Link each landlord and explain what we want to achieve with them.</p></div>
    {targets.map(target => <div key={target.companyId} className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2"><Link className="text-sm font-semibold hover:underline" href={`/companies/${target.companyId}`}>{options.companies.find(c => c.id === target.companyId)?.name || "Linked landlord"}</Link><Button variant="ghost" size="icon" type="button" className="h-7 w-7" aria-label={`Remove ${options.companies.find(c => c.id === target.companyId)?.name || "landlord"}`} onClick={() => onChange(targets.filter(t => t.companyId !== target.companyId))}><X className="h-4 w-4" /></Button></div>
      <Field label="Why this landlord?"><Textarea required rows={2} maxLength={2000} value={target.reason} onChange={e => onChange(targets.map(t => t.companyId === target.companyId ? {...t, reason: e.target.value} : t))} placeholder="The specific relationship or work this activity should support" /></Field>
      {contacts && <div className="space-y-1.5"><p className="text-sm font-medium">Relevant contacts</p><CrmEntityPicker kind="contact" multi value={target.contactIds} options={options.contacts.filter(c => c.companyId === target.companyId).map(c => ({id: c.id, name: c.name, meta: c.role}))} emptyLabel="Choose contacts" className="border rounded-md px-3 py-2 min-h-9" testIdPrefix={`strategy-contacts-${target.companyId}`} onSelect={c => onChange(targets.map(t => t.companyId === target.companyId ? {...t, contactIds: t.contactIds.includes(c.id) ? t.contactIds.filter(id => id !== c.id) : [...t.contactIds, c.id]} : t))} /></div>}
    </div>)}
    <CrmEntityPicker value={null} options={options.companies.filter(c => !targets.some(t => t.companyId === c.id))} onSelect={c => onChange([...targets, {companyId: c.id, reason: "", contactIds: []}])} emptyLabel="Add a landlord" searchPlaceholder="Search landlord accounts…" className="border rounded-md px-3 py-2 min-h-9" testIdPrefix="engagement-landlord" />
  </section>;
}

export function StrategyEditor({ record, options, companyId, onClose, onSave }: {record?: EngagementStrategy; options: EngagementOptions; companyId?: string; onClose: () => void; onSave: (input: StrategyInput, id?: string) => Promise<unknown>}) {
  const [form, setForm] = useState<StrategyInput>(() => record ? {
    name: record.name, objective: record.objective, team: record.team, ownerId: record.ownerId, status: record.status,
    startsOn: record.startsOn?.slice(0, 10) || null, endsOn: record.endsOn?.slice(0, 10) || null,
    targets: record.targets.map(({companyId, reason, contactIds}) => ({companyId, reason, contactIds})), expectedUpdatedAt: record.updatedAt,
  } : {name: "", objective: "", team: null, ownerId: null, status: "active", startsOn: null, endsOn: null, targets: companyId ? [{companyId, reason: "", contactIds: []}] : []});
  return <Editor title={record ? "Edit CRM strategy" : "New CRM strategy"} description="A shared objective, the relationships it concerns and the activity planned to support it." onClose={onClose} submitLabel={record ? "Save strategy" : "Create strategy"} onSubmit={async () => {
    if (form.startsOn && form.endsOn && form.endsOn < form.startsOn) throw new Error("The end date must be on or after the start date.");
    return onSave({...form, name: form.name.trim(), objective: form.objective.trim()}, record?.id);
  }}>
    <Field label="Strategy name"><Input required value={form.name} maxLength={200} onChange={e => setForm({...form, name: e.target.value})} placeholder="For example, shopping-centre food and beverage leasing" /></Field>
    <Field label="Objective"><Textarea required rows={3} maxLength={4000} value={form.objective} onChange={e => setForm({...form, objective: e.target.value})} placeholder="What do we want to achieve, and what would count as progress?" /></Field>
    <div className="grid sm:grid-cols-2 gap-3"><Owner required value={form.ownerId} onChange={ownerId => setForm({...form, ownerId})} options={options} /><Field label="Team"><Input value={form.team || ""} maxLength={100} onChange={e => setForm({...form, team: e.target.value || null})} placeholder="Team or cross-team programme" /></Field></div>
    <div className="grid sm:grid-cols-3 gap-3"><Field label="Start date"><Input type="date" value={form.startsOn || ""} onChange={e => setForm({...form, startsOn: e.target.value || null})} /></Field><Field label="Review / end date"><Input type="date" value={form.endsOn || ""} min={form.startsOn || undefined} onChange={e => setForm({...form, endsOn: e.target.value || null})} /></Field><Choice label="Status" value={form.status} onChange={v => setForm({...form, status: v as StrategyInput["status"]})}><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option></Choice></div>
    <Targets targets={form.targets} options={options} onChange={targets => setForm({...form, targets})} />
  </Editor>;
}

export function EventEditor({ record, options, strategies, companyId, onClose, onSave }: {record?: EngagementEvent; options: EngagementOptions; strategies: EngagementStrategy[]; companyId?: string; onClose: () => void; onSave: (input: EventInput, id?: string) => Promise<unknown>}) {
  const [form, setForm] = useState<EventInput>(() => record ? {
    title: record.title, kind: record.kind, startsAt: record.startsAt, endsAt: record.endsAt, location: record.location,
    description: record.description, ownerId: record.ownerId, status: record.status, sourceUrl: record.sourceUrl,
    dateConfirmed: record.dateConfirmed, outcome: record.outcome, strategyIds: [...record.strategyIds],
    companies: record.companies.map(({companyId, reason}) => ({companyId, reason})),
    guests: record.guests.map(({contactId, status}) => ({contactId, status})), expectedUpdatedAt: record.updatedAt,
  } : {title: "", kind: "bgp", startsAt: null, endsAt: null, location: null, description: null, ownerId: null, status: "draft", sourceUrl: null, dateConfirmed: false, outcome: null, strategyIds: [], companies: companyId ? [{companyId, reason: ""}] : [], guests: []});
  const [start, setStart] = useState(londonDateTimeInput(record?.startsAt || null));
  const [end, setEnd] = useState(londonDateTimeInput(record?.endsAt || null));
  const guestOptions = options.contacts.filter(c => form.companies.some(link => link.companyId === c.companyId));
  return <Editor title={record ? "Event details" : "New CRM event"} description="The same event appears in Marketing and on the linked landlord pages. Times are London time." onClose={onClose} submitLabel={record ? "Save event" : "Create event"} onSubmit={async () => {
    const startsAt = londonInputToIso(start), endsAt = londonInputToIso(end);
    if (endsAt && (!startsAt || endsAt <= startsAt)) throw new Error("The end time must be after the start time.");
    if (form.dateConfirmed && !startsAt) throw new Error("Add a start date before confirming it.");
    return onSave({...form, title: form.title.trim(), startsAt, endsAt}, record?.id);
  }}>
    <Field label="Event name"><Input required value={form.title} maxLength={200} onChange={e => setForm({...form, title: e.target.value})} /></Field>
    <div className="grid sm:grid-cols-2 gap-3"><Choice label="Type" value={form.kind || "bgp"} onChange={kind => setForm({...form, kind})}><option value="bgp">BGP event / hospitality</option><option value="industry">Industry event</option><option value="speaking">Speaking opportunity</option><option value="pitch">Pitch</option><option value="press">Press activity</option></Choice><Choice label="Status" value={form.status} onChange={v => setForm({...form, status: v as EventInput["status"]})}>{Object.entries(EVENT_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</Choice></div>
    <div className="grid sm:grid-cols-2 gap-3"><Field label="Starts · London time"><Input type="datetime-local" value={start} onChange={e => {setStart(e.target.value); setForm({...form, dateConfirmed: false});}} /></Field><Field label="Ends · London time"><Input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></Field></div>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-primary" checked={form.dateConfirmed} onChange={e => setForm({...form, dateConfirmed: e.target.checked})} /><span>Date checked and confirmed<span className="block text-xs text-muted-foreground">Unconfirmed dates stay in “Dates to confirm”, outside the calendar.</span></span></label>
    <div className="grid sm:grid-cols-2 gap-3"><Owner value={form.ownerId} required onChange={ownerId => setForm({...form, ownerId})} options={options} /><Field label="Location"><Input value={form.location || ""} maxLength={400} onChange={e => setForm({...form, location: e.target.value || null})} /></Field></div>
    <Field label="Purpose and format"><Textarea rows={2} maxLength={4000} value={form.description || ""} onChange={e => setForm({...form, description: e.target.value || null})} placeholder="What is planned and what should the conversation cover?" /></Field>
    <Field label="Event website (optional)"><Input type="url" value={form.sourceUrl || ""} onChange={e => setForm({...form, sourceUrl: e.target.value || null})} placeholder="https://…" /></Field>
    <div className="space-y-1.5"><p className="text-sm font-semibold">Linked strategies</p><CrmEntityPicker multi value={form.strategyIds} options={strategies.map(s => ({id: s.id, name: s.name, meta: s.status}))} emptyLabel="Choose strategies" className="border rounded-md px-3 py-2 min-h-9" testIdPrefix="event-strategies" onSelect={s => setForm({...form, strategyIds: form.strategyIds.includes(s.id) ? form.strategyIds.filter(id => id !== s.id) : [...form.strategyIds, s.id]})} /></div>
    <Targets contacts={false} targets={form.companies.map(c => ({...c, contactIds: []}))} options={options} onChange={targets => setForm({...form, companies: targets.map(({companyId, reason}) => ({companyId, reason})), guests: form.guests.filter(g => targets.some(t => t.companyId === options.contacts.find(c => c.id === g.contactId)?.companyId))})} />
    <section className="space-y-3"><div><h3 className="text-sm font-semibold">Guests</h3><p className="text-xs text-muted-foreground">Choose contacts from the linked landlords. Status records what happened; saving does not send an invitation.</p></div>
      {form.guests.map(guest => { const contact = options.contacts.find(c => c.id === guest.contactId); return <div key={guest.contactId} className="flex flex-wrap items-center gap-2 rounded-md border p-2.5"><div className="min-w-0 flex-1"><Link className="text-sm font-semibold hover:underline" href={`/contacts/${guest.contactId}`}>{contact?.name || record?.guests.find(g => g.contactId === guest.contactId)?.name || "Linked contact"}</Link><p className="text-xs text-muted-foreground">{options.companies.find(c => c.id === contact?.companyId)?.name}</p></div><select aria-label={`Invitation status for ${contact?.name || "contact"}`} className={`${SELECT_CLASS} w-auto`} value={guest.status} onChange={e => setForm({...form, guests: form.guests.map(g => g.contactId === guest.contactId ? {...g, status: e.target.value as GuestStatus} : g)})}>{Object.entries(GUEST_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select><Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${contact?.name || "guest"}`} onClick={() => setForm({...form, guests: form.guests.filter(g => g.contactId !== guest.contactId)})}><X className="h-4 w-4" /></Button></div>; })}
      <CrmEntityPicker kind="contact" value={null} options={guestOptions.filter(c => !form.guests.some(g => g.contactId === c.id)).map(c => ({id: c.id, name: c.name, meta: options.companies.find(company => company.id === c.companyId)?.name}))} emptyLabel={form.companies.length ? "Add a guest" : "Link a landlord to add guests"} disabled={!form.companies.length} className="border rounded-md px-3 py-2 min-h-9" testIdPrefix="event-guest" onSelect={c => setForm({...form, guests: [...form.guests, {contactId: c.id, status: "suggested"}]})} />
    </section>
    <Field label="Outcome / notes"><Textarea rows={3} maxLength={4000} value={form.outcome || ""} onChange={e => setForm({...form, outcome: e.target.value || null})} placeholder="Record what was discussed and agreed. Add owned follow-ups from the CRM Overview." /></Field>
  </Editor>;
}

export function ActionEditor({ options, data, companyId, eventId, strategyId, onClose, onSave }: {options: EngagementOptions; data: EngagementData; companyId?: string; eventId?: string; strategyId?: string; onClose: () => void; onSave: (input: ActionInput) => Promise<unknown>}) {
  const [form, setForm] = useState<ActionInput>({title: "", notes: null, dueAt: null, status: "todo", ownerId: "", companyId: companyId || "", eventId: eventId || null, strategyId: strategyId || null});
  const [due, setDue] = useState("");
  const linkedEvents = data.events.filter(e => !form.companyId || e.companies.some(c => c.companyId === form.companyId));
  const linkedStrategies = data.strategies.filter(s => !form.companyId || s.targets.some(t => t.companyId === form.companyId));
  return <Editor title="Add CRM follow-up" description="This action also appears in its owner's My Tasks. Completing it in either place updates the same task." onClose={onClose} submitLabel="Create follow-up" onSubmit={() => {
    if (!form.companyId || !form.ownerId) throw new Error("Choose a landlord and BGP owner.");
    return onSave({...form, title: form.title.trim(), dueAt: londonInputToIso(due)});
  }}>
    <Field label="Action"><Input required maxLength={200} value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="A clear next step" /></Field>
    <div className="space-y-1.5"><p className="text-sm font-medium">Landlord</p><CrmEntityPicker value={form.companyId} options={options.companies} className="border rounded-md px-3 py-2 min-h-9" emptyLabel="Choose landlord" testIdPrefix="action-landlord" onSelect={c => setForm({...form, companyId: c.id, strategyId: null, eventId: null})} /></div>
    <div className="grid sm:grid-cols-2 gap-3"><Owner value={form.ownerId} required onChange={ownerId => setForm({...form, ownerId: ownerId || ""})} options={options} /><Field label="Due · London time"><Input required type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></Field></div>
    <div className="grid sm:grid-cols-2 gap-3"><Choice label="Strategy (optional)" value={form.strategyId || ""} onChange={strategyId => setForm({...form, strategyId: strategyId || null})}><option value="">No strategy</option>{linkedStrategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Choice><Choice label="Event (optional)" value={form.eventId || ""} onChange={eventId => setForm({...form, eventId: eventId || null})}><option value="">No event</option>{linkedEvents.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}</Choice></div>
    <Field label="Notes"><Textarea rows={3} maxLength={4000} value={form.notes || ""} onChange={e => setForm({...form, notes: e.target.value || null})} /></Field>
  </Editor>;
}

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, ExternalLink, Plus, Search, UserRound } from "lucide-react";
import { calendarDateValue } from "@shared/calendar-date";
import type { ViewingConversionReport } from "@shared/viewing-report";
import type { AvailableUnit } from "@shared/schema";
import { VIEWING_OUTCOMES, VIEWING_STATUSES, viewingMissingDetails, viewingNeedsOutcome, type ViewingOptions, type ViewingPatch, type ViewingRecord } from "@shared/viewing-workflow";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EntityCombobox, type EntityComboboxItem } from "@/components/entity-combobox";

export type LeasingViewing = ViewingRecord;
type Filter = "week" | "upcoming" | "details" | "outcomes" | "all";
const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const statusLabels: Record<string, string> = { scheduled: "Scheduled", completed: "Attended", cancelled: "Cancelled", no_show: "No-show", not_leasing: "Not a leasing viewing" };
const emptyOptions: ViewingOptions = { units: [], brands: [], contacts: [], owners: [], requirements: [] };
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shiftDate = (value: string, days: number) => { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const weekOf = (value: string) => shiftDate(value, -((new Date(`${value}T12:00:00Z`).getUTCDay() + 6) % 7));
const dateLabel = (value: string, weekday = false) => calendarDateValue(value) === value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(value.slice(0, 4) !== londonToday().slice(0, 4) ? { year: "numeric" as const } : {}), ...(weekday ? { weekday: "short" as const } : {}), timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "Date needed";
const needsDetails = (v: ViewingRecord) => !["not_leasing", "cancelled", "no_show"].includes(v.status) && (viewingMissingDetails(v).length > 0 || v.issues.length > 0);
const formFor = (v: ViewingRecord): ViewingPatch => ({ unitId: v.unitId, companyId: v.companyId, contactId: v.contactId, agentContactId: v.agentContactId, ownerUserId: v.ownerUserId, requirementId: v.requirementId, viewingDate: v.viewingDate, viewingTime: v.viewingTime, status: v.status, outcome: v.outcome, notes: v.notes, nextAction: v.nextAction, followUpDate: v.followUpDate, ...(v.id ? { expectedUpdatedAt: v.updatedAt } : {}) });

// Scoped directories intentionally omit unrelated CRM entries. An existing
// accessible viewing can still retain those recorded links; show its saved
// identity without exposing any additional directory choices.
function withRecordedOption(items: EntityComboboxItem[], value: string | null | undefined, recordedId: string | null | undefined, recordedName: string | null | undefined, fallback: string): EntityComboboxItem[] {
  return value && value === recordedId && !items.some(item => item.id === value)
    ? [...items, { id: value, label: recordedName || fallback }]
    : items;
}

async function refreshViewings() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["/api/leasing-viewings"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/available-units"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-viewings"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-viewings-counts"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-offers"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-offers-counts"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-leasing"] }),
  ]);
}

export function LeasingViewings({ mode, units, isClient, currentUserId, initialPropertyId, initialBrandId, focusedViewingId, onFocusHandled, onRecordOffer }: {
  mode: "viewings" | "reports";
  units: AvailableUnit[];
  isClient: boolean;
  currentUserId?: string;
  initialPropertyId?: string;
  initialBrandId?: string;
  focusedViewingId: string | null;
  onFocusHandled: () => void;
  onRecordOffer: (viewing: ViewingRecord) => void;
}) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const today = londonToday();
  const [filter, setFilter] = useState<Filter>(initialBrandId ? "all" : "week");
  const [weekStart, setWeekStart] = useState(() => weekOf(today));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState(initialBrandId || "");
  const [propertyFilter, setPropertyFilter] = useState(initialPropertyId || "");
  const [limit, setLimit] = useState(40);
  const [selected, setSelected] = useState<ViewingRecord | null>(null);
  const [form, setForm] = useState<ViewingPatch>({});
  const [requirementId, setRequirementId] = useState("");
  const [tourUnitId, setTourUnitId] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newUnitId, setNewUnitId] = useState("");
  const viewingQuery = useQuery<{ viewings: ViewingRecord[]; emailRemindersEnabled: boolean }>({ queryKey: ["/api/leasing-viewings"], staleTime: 5_000, refetchInterval: 30_000 });
  const optionsQuery = useQuery<ViewingOptions>({ queryKey: ["/api/leasing-viewings", "options"], queryFn: async () => (await apiRequest("GET", "/api/leasing-viewings/options")).json() });
  const rows = viewingQuery.data?.viewings || [];
  const options = optionsQuery.data || emptyOptions;
  const openViewing = (v: ViewingRecord) => { setSelected(v); setForm(formFor(v)); setRequirementId(v.requirementId || ""); setTourUnitId(""); };
  useEffect(() => {
    if (!focusedViewingId || !viewingQuery.data) return;
    const row = viewingQuery.data.viewings.find(v => v.id === focusedViewingId);
    if (row) openViewing(row);
    else toast({ title: "Viewing unavailable", description: "It may have been removed or be outside your accessible properties." });
    onFocusHandled();
  }, [focusedViewingId, viewingQuery.data]);
  useEffect(() => { setLimit(40); }, [filter, search, propertyFilter, brandFilter, ownerFilter, selectedDay, weekStart]);

  const fail = (error: Error) => toast({ title: "Could not save viewing", description: error.message, variant: "destructive" });
  const save = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      if (!selected.id) {
        if (!form.unitId) throw new Error("Choose the tracker unit");
        return (await apiRequest("POST", `/api/available-units/${form.unitId}/viewings`, { ...form, confirmDetails: !["cancelled", "no_show", "not_leasing"].includes(form.status || "") && viewingMissingDetails(form).length === 0 })).json();
      }
      // Closing an imported booking must not require invented dates or
      // re-submit a legacy agency as the prospective brand. Status and notes
      // are sufficient; identity corrections remain a separate explicit save.
      const terminal = ["cancelled", "no_show", "not_leasing"].includes(form.status || "");
      const patch = terminal
        ? { status: form.status, notes: form.notes, outcome: null, expectedUpdatedAt: form.expectedUpdatedAt }
        : { ...form, confirmDetails: viewingMissingDetails(form).length === 0 };
      return (await apiRequest("PATCH", `/api/leasing-viewings/${selected.id}`, patch)).json();
    },
    onSuccess: async () => { setSelected(null); await refreshViewings(); toast({ title: "Viewing updated" }); }, onError: fail,
  });
  const linkRequirement = useMutation({
    mutationFn: async (create: boolean) => { if (!selected) return; return (await apiRequest("POST", `/api/leasing-viewings/${selected.id}/requirement`, create ? { create: true } : { requirementId })).json(); },
    onSuccess: async () => { setSelected(null); await refreshViewings(); toast({ title: "Requirement linked", description: "The viewing is linked without changing the brand's stated size or location requirements." }); }, onError: fail,
  });
  const addTourUnit = useMutation({
    mutationFn: async () => { if (!selected) return; return (await apiRequest("POST", `/api/leasing-viewings/${selected.id}/units`, { unitIds: [tourUnitId] })).json(); },
    onSuccess: async () => { setTourUnitId(""); setSelected(null); await refreshViewings(); toast({ title: "Unit added to this visit" }); }, onError: fail,
  });
  const confirmOffer = useMutation({
    mutationFn: async (offerId: string) => { if (!selected) return; return (await apiRequest("POST", `/api/leasing-viewings/${selected.id}/offers/${offerId}/confirm`, {})).json(); },
    onSuccess: async () => { setSelected(null); await refreshViewings(); toast({ title: "Offer confirmed" }); }, onError: fail,
  });

  const propertyOptions = useMemo(() => Array.from(new Map(options.units.map(u => [u.propertyId, u.propertyName])).entries()).map(([id, label]) => ({ id, label })), [options.units]);
  const baseRows = rows.filter(v => (!brandFilter || v.companyId === brandFilter) && (!ownerFilter || v.ownerUserId === ownerFilter) && (!propertyFilter || v.propertyId === propertyFilter));
  const counts = { details: baseRows.filter(needsDetails).length, outcomes: baseRows.filter(v => viewingNeedsOutcome(v, today)).length };
  const filtered = baseRows.filter(v => {
    const query = search.trim().toLowerCase();
    if (query && ![v.companyName, v.contactName, v.agentContactName, v.unitName, v.propertyName, v.ownerName, v.sourceDetails?.subject].some(s => s?.toLowerCase().includes(query))) return false;
    if (filter === "details") return needsDetails(v);
    if (filter === "outcomes") return viewingNeedsOutcome(v, today);
    if (filter === "upcoming") return v.status === "scheduled" && v.viewingDate >= today;
    if (filter === "week") return selectedDay ? v.viewingDate === selectedDay : v.viewingDate >= weekStart && v.viewingDate < shiftDate(weekStart, 7);
    return true;
  }).sort((a, b) => (a.viewingDate + (a.viewingTime || "")).localeCompare(b.viewingDate + (b.viewingTime || "")) || a.id.localeCompare(b.id));
  const groups = new Map<string, ViewingRecord[]>();
  for (const row of filtered.slice(0, limit)) groups.set(row.viewingDate, [...(groups.get(row.viewingDate) || []), row]);
  const relatedRequirements = options.requirements.filter(r => r.companyId && r.companyId === selected?.companyId);
  const formDirty = selected ? JSON.stringify(form) !== JSON.stringify(formFor(selected)) : false;
  const pending = save.isPending || linkRequirement.isPending || addTourUnit.isPending || confirmOffer.isPending;
  const field = (key: keyof ViewingPatch, value: unknown) => setForm(current => ({ ...current, [key]: value || null }));
  const closingExisting = !!selected?.id && ["cancelled", "no_show", "not_leasing"].includes(form.status || "");
  const selectedIssues = selected ? Array.from(new Set([...viewingMissingDetails(form), ...selected.issues])) : [];
  const createViewing = () => {
    const unit = options.units.find(u => u.id === newUnitId);
    if (!unit) return;
    const owner = options.owners.find(u => u.id === currentUserId);
    openViewing({ id: "", unitId: unit.id, propertyId: unit.propertyId, propertyName: unit.propertyName, unitName: unit.name, sqft: unit.sqft, companyId: null, companyName: null, contactId: null, contactName: null, agentContactId: null, agentContactName: null, ownerUserId: owner?.id || null, ownerName: owner?.name || null, team: owner?.team || null, requirementId: null, requirementName: null, viewingDate: today, viewingTime: null, status: "scheduled", outcome: null, notes: null, attendees: null, nextAction: null, followUpDate: null, source: null, calendarEventId: null, bookingId: null, detailsConfirmedAt: null, outcomeRecordedAt: null, updatedAt: "", issues: [] });
    setAddOpen(false);
  };
  const selectedBrandName = options.brands.find(b => b.id === selected?.companyId)?.name || selected?.companyName;

  const detail = selected && <div className="space-y-4">
    {selectedIssues.length > 0 && <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm" role="status"><p className="font-semibold">Check the viewing details</p><ul className="mt-1 list-disc pl-4 space-y-1">{selectedIssues.map(issue => <li key={issue}>{issue}</li>)}</ul><p className="mt-2 text-[11px] text-muted-foreground">Save complete details to confirm the brand, contact and space being viewed.</p></div>}
    {selected.sourceDetails?.subject && <div className="rounded-lg border p-3 text-sm"><div className={labelClass}>Outlook booking</div><p className="mt-1 break-words">{selected.sourceDetails.subject}</p>{selected.sourceDetails.location && <p className="text-[11px] text-muted-foreground mt-1">{selected.sourceDetails.location}</p>}{selected.attendees && <p className="text-[11px] text-muted-foreground mt-1 break-words">{selected.attendees}</p>}</div>}
    <div className="space-y-1.5"><Label className={labelClass}>Tracker unit</Label><EntityCombobox value={form.unitId} items={withRecordedOption(options.units.map(u => ({ id: u.id, label: u.name, subLabel: u.propertyName })), form.unitId, selected.unitId, selected.unitName, "Recorded tracker unit")} onChange={id => field("unitId", id)} placeholder="Choose the unit being viewed" ariaLabel="Tracker unit" testId="viewing-workflow-unit" /></div>
    <div className="space-y-1.5"><Label className={labelClass}>Brand viewing</Label><EntityCombobox value={form.companyId} items={withRecordedOption(options.brands.map(b => ({ id: b.id, label: b.name })), form.companyId, selected.companyId, selected.companyName, "Recorded brand")} onChange={id => setForm(current => current.companyId === (id || null) ? current : ({ ...current, companyId: id || null, contactId: null, requirementId: null, ...(isClient ? { agentContactId: null } : {}) }))} placeholder="Choose the brand" ariaLabel="Brand viewing" testId="viewing-workflow-brand" /><p className="text-[11px] text-muted-foreground">The prospective occupier. Record its representing agent separately below. Changing the brand removes any existing requirement link.</p></div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1.5 min-w-0"><Label className={labelClass}>Brand contact</Label><EntityCombobox value={form.contactId} items={withRecordedOption(options.contacts.filter(c => c.id === form.contactId || (form.companyId && c.companyId === form.companyId)).map(c => ({ id: c.id, label: c.name, subLabel: c.email || undefined })), form.contactId, selected.contactId, selected.contactName, "Recorded brand contact")} onChange={id => field("contactId", id)} placeholder="Choose brand contact" ariaLabel="Brand contact" testId="viewing-workflow-contact" /></div>
      <div className="space-y-1.5 min-w-0"><Label className={labelClass}>Representing agent</Label><EntityCombobox value={form.agentContactId} items={withRecordedOption(options.contacts.filter(c => !isClient || c.id === form.agentContactId || (form.companyId && (c.representedBrandIds || []).includes(form.companyId))).map(c => ({ id: c.id, label: c.name, subLabel: c.email || undefined })), form.agentContactId, selected.agentContactId, selected.agentContactName, "Recorded representing agent")} onChange={id => field("agentContactId", id)} placeholder="Choose representing agent" ariaLabel="Representing agent" testId="viewing-workflow-agent" /></div>
      <div className="space-y-1.5 min-w-0"><Label htmlFor="viewing-workflow-date" className={labelClass}>Viewing date</Label><Input id="viewing-workflow-date" type="date" className="min-w-0" value={form.viewingDate || ""} onChange={e => field("viewingDate", e.target.value)} /></div>
      <div className="space-y-1.5 min-w-0"><Label htmlFor="viewing-workflow-time" className={labelClass}>Time · UK</Label><Input id="viewing-workflow-time" type="time" className="min-w-0" value={form.viewingTime || ""} onChange={e => field("viewingTime", e.target.value)} /></div>
    </div>
    <div className="space-y-1.5"><Label className={labelClass}>Responsible BGP person</Label><EntityCombobox value={form.ownerUserId} items={withRecordedOption(options.owners.map(u => ({ id: u.id, label: u.name })), form.ownerUserId, selected.ownerUserId, selected.ownerName, "Recorded BGP owner")} onChange={id => field("ownerUserId", id)} placeholder="Assign the BGP owner" ariaLabel="Responsible BGP person" testId="viewing-workflow-owner" /></div>
    <div className="border-t pt-4 space-y-3"><h3 className="text-sm font-semibold">Report outcome</h3>
      <div className="flex flex-wrap gap-1.5">{VIEWING_STATUSES.map(status => <Pill key={status} active={form.status === status} aria-pressed={form.status === status} onClick={() => setForm(current => ({ ...current, status, ...(status !== "completed" ? { outcome: null } : {}) }))}>{statusLabels[status]}</Pill>)}</div>
      <div className="space-y-1.5"><Label htmlFor="viewing-workflow-outcome" className={labelClass}>Viewing outcome</Label><select id="viewing-workflow-outcome" className="w-full rounded-md border bg-background px-3 py-2 text-sm h-11" value={form.outcome || ""} onChange={e => setForm(current => ({ ...current, outcome: e.target.value || null, ...(e.target.value ? { status: "completed" } : {}) }))}><option value="">Choose outcome</option>{VIEWING_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}{form.outcome && !VIEWING_OUTCOMES.includes(form.outcome as any) && <option value={form.outcome}>{form.outcome}</option>}</select></div>
      <div className="space-y-1.5"><Label htmlFor="viewing-workflow-notes" className={labelClass}>Notes</Label><Textarea id="viewing-workflow-notes" value={form.notes || ""} onChange={e => field("notes", e.target.value)} placeholder="Feedback, objections and what was discussed" rows={3} /></div>
      <div className="space-y-1.5"><Label htmlFor="viewing-workflow-next-action" className={labelClass}>Next action</Label><Input id="viewing-workflow-next-action" value={form.nextAction || ""} onChange={e => field("nextAction", e.target.value)} placeholder="For example: send terms and follow up with the agent" /></div>
      <div className="space-y-1.5"><Label htmlFor="viewing-workflow-follow-up" className={labelClass}>Follow-up date</Label><Input id="viewing-workflow-follow-up" type="date" value={form.followUpDate || ""} onChange={e => field("followUpDate", e.target.value)} /></div>
    </div>
    {closingExisting && <p className="text-[11px] text-muted-foreground">Closing this viewing saves its status and notes. Booking details and links remain unchanged.</p>}
    <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" size="sm" onClick={() => setSelected(null)}>Back</Button><Button size="sm" disabled={pending || (!closingExisting && (!form.viewingDate || (!form.unitId && !selected.id))) || optionsQuery.isLoading} onClick={() => save.mutate()} data-testid="viewing-workflow-save">{save.isPending ? "Saving…" : "Save viewing"}</Button></div>
    {!!selected.id && <div className="border-t pt-4 space-y-3">
      <h3 className="text-sm font-semibold">Offers and requirements</h3>
      {formDirty && <p className="text-[11px] text-muted-foreground">Save the changes above before linking an offer, requirement or another unit.</p>}
      <Button variant="outline" size="sm" disabled={pending || formDirty || !selected.unitId || !selected.companyId} onClick={() => { setSelected(null); onRecordOffer(selected); }} data-testid="viewing-workflow-offer">Record offer</Button>
      {selected.offers?.map(offer => <div key={offer.id} className="rounded-lg border p-3 flex flex-wrap items-center justify-between gap-2 text-sm"><span>{offer.confirmedAt ? "Confirmed offer" : "Offer awaiting confirmation"} · {dateLabel(offer.offerDate)}</span>{!offer.confirmedAt && <Button variant="outline" size="sm" disabled={pending || formDirty} onClick={() => confirmOffer.mutate(offer.id)}>Confirm offer</Button>}</div>)}
      {selected.requirementId && <p className="text-sm">Linked requirement: <a href={`/requirements?companyId=${encodeURIComponent(selected.companyId || "")}`} className="text-primary underline">{selected.requirementName || selectedBrandName || "Open requirement"}</a></p>}
      {!isClient && <div className="space-y-2"><EntityCombobox value={requirementId} items={relatedRequirements.map(r => ({ id: r.id, label: r.name }))} onChange={setRequirementId} ariaLabel="Existing brand requirement" placeholder="Choose an existing brand requirement" disabled={!selected.companyId || formDirty} /><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={pending || formDirty || !requirementId} onClick={() => linkRequirement.mutate(false)}>Link requirement</Button><Button variant="outline" size="sm" disabled={pending || formDirty || !selected.companyId || !!selected.requirementId} onClick={() => linkRequirement.mutate(true)}>Create requirement draft</Button></div><p className="text-[11px] text-muted-foreground">A viewing is evidence of activity; it does not overwrite the brand's target size or locations.</p></div>}
      <div className="space-y-2"><h3 className="text-sm font-semibold">Another unit on the same visit</h3><EntityCombobox value={tourUnitId} items={options.units.filter(u => u.id !== selected.unitId).map(u => ({ id: u.id, label: u.name, subLabel: u.propertyName }))} onChange={setTourUnitId} ariaLabel="Another unit on this visit" placeholder="Choose another space viewed" disabled={pending || formDirty || !selected.unitId} /><Button variant="outline" size="sm" disabled={pending || formDirty || !tourUnitId} onClick={() => addTourUnit.mutate()}>Add unit to visit</Button></div>
    </div>}
  </div>;

  if (mode === "reports") return <ViewingReports options={options} isClient={isClient} />;
  return <div className="space-y-4 min-w-0" data-testid="leasing-viewings-workspace">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Viewing calendar</h2><p className="text-[11px] text-muted-foreground">Outlook bookings and tracker entries use the same viewing record. Times are UK local time.</p></div><Button size="sm" onClick={() => setAddOpen(v => !v)}><Plus className="h-4 w-4 mr-1" />Add viewing</Button></div>
    {addOpen && <Card><CardContent className="p-4 space-y-3"><Label className={labelClass}>Choose a tracker unit</Label><EntityCombobox value={newUnitId} items={options.units.map(u => ({ id: u.id, label: u.name, subLabel: u.propertyName }))} onChange={setNewUnitId} ariaLabel="Tracker unit for a new viewing" placeholder="Find the property and unit" /><div className="flex justify-end"><Button size="sm" disabled={!units.some(u => u.id === newUnitId)} onClick={createViewing}>Add viewing for this unit</Button></div></CardContent></Card>}
    <div className="flex flex-wrap gap-1.5">{([ ["week", "Week"], ["upcoming", "Upcoming"], ["details", "Needs details"], ["outcomes", "Outcomes due"], ["all", "All viewings"] ] as const).map(([value, label]) => <Pill key={value} active={filter === value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}{(value === "details" || value === "outcomes") && <span className="font-mono tabular-nums">{counts[value]}</span>}</Pill>)}</div>
    {brandFilter && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"><p className="text-sm">Brand: {options.brands.find(b => b.id === brandFilter)?.name || "Selected brand"}</p><Button variant="outline" size="sm" onClick={() => setBrandFilter("")}>Show all brands</Button></div>}
    <div className="grid gap-2 sm:grid-cols-3"><div className="relative min-w-0"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find brand, property or contact…" aria-label="Search viewings" /></div><select aria-label="Filter viewings by property" className="min-w-0 w-full rounded-md border bg-background px-3 py-2 text-sm" value={propertyFilter} onChange={e => setPropertyFilter(e.target.value)}><option value="">All properties</option>{propertyOptions.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select><select aria-label="Filter viewings by owner" className="min-w-0 w-full rounded-md border bg-background px-3 py-2 text-sm" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}><option value="">All BGP owners</option>{currentUserId && <option value={currentUserId}>My viewings</option>}{options.owners.filter(u => u.id !== currentUserId).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
    {filter === "week" && <Card><CardContent className="p-3 space-y-3"><div className="flex items-center justify-between gap-2"><Button variant="outline" size="sm" aria-label="Previous week" onClick={() => { setWeekStart(shiftDate(weekStart, -7)); setSelectedDay(null); }}><ChevronLeft className="h-4 w-4" /></Button><span className="text-sm font-semibold text-center">{dateLabel(weekStart)} – {dateLabel(shiftDate(weekStart, 6))}</span><Button variant="outline" size="sm" aria-label="Next week" onClick={() => { setWeekStart(shiftDate(weekStart, 7)); setSelectedDay(null); }}><ChevronRight className="h-4 w-4" /></Button></div><div className="grid grid-cols-7 gap-1">{Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i)).map(day => <button key={day} type="button" className={`min-w-0 rounded-lg border py-2 text-center ${selectedDay === day ? "bg-primary text-primary-foreground border-primary" : day === today ? "border-primary bg-muted/30" : "border-border"}`} aria-pressed={selectedDay === day} aria-label={`${dateLabel(day, true)}, ${baseRows.filter(v => v.viewingDate === day).length} viewings`} onClick={() => setSelectedDay(current => current === day ? null : day)}><span className="block text-[11px]">{new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}</span><span className="block text-sm font-mono tabular-nums">{Number(day.slice(-2))}</span><span className="block text-[11px] font-mono tabular-nums">{baseRows.filter(v => v.viewingDate === day).length}</span></button>)}</div><div className="flex justify-end"><Button variant="ghost" size="sm" onClick={() => { setWeekStart(weekOf(today)); setSelectedDay(null); }}>This week</Button></div></CardContent></Card>}
    {viewingQuery.isLoading ? <div className="space-y-3"><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div> : viewingQuery.isError || optionsQuery.isError ? <Card><CardContent className="p-6 text-center space-y-3"><p className="text-sm">The viewing records could not be loaded.</p><Button variant="outline" onClick={() => { void viewingQuery.refetch(); void optionsQuery.refetch(); }}>Refresh</Button></CardContent></Card> : filtered.length === 0 ? <Card><CardContent className="p-8 text-center space-y-3"><CalendarDays className="h-6 w-6 mx-auto text-muted-foreground" /><p className="text-sm">No viewings match this view.</p><Button variant="outline" size="sm" onClick={() => { setFilter("all"); setSearch(""); setOwnerFilter(""); setPropertyFilter(""); setBrandFilter(""); }}>Show all viewings</Button></CardContent></Card> : <div className="space-y-5">{Array.from(groups.entries()).map(([date, entries]) => <section key={date} className="space-y-2"><h3 className={labelClass}>{dateLabel(date, true)}</h3><div className="grid gap-3 lg:grid-cols-2">{entries.map(v => <Card key={v.id} className="rounded-2xl md:rounded-lg min-w-0" data-testid={`viewing-card-${v.id}`}><CardContent className="p-4 space-y-3"><div className="flex gap-3 justify-between"><div className="min-w-0"><h4 className="font-semibold text-sm break-words">{v.companyName || "Brand to confirm"}</h4><p className="text-[11px] text-muted-foreground mt-1 break-words">{v.propertyName ? `${v.propertyName} · ${v.unitName || "Unit to confirm"}` : v.sourceDetails?.subject || "Property and unit to confirm"}</p></div><span className="shrink-0 text-sm font-mono tabular-nums">{v.viewingTime || "Time needed"}</span></div><div className="flex flex-wrap gap-1.5 text-[11px]"><span className="border rounded-full px-2 py-1">{statusLabels[v.status]}</span>{v.outcome && <span className="border rounded-full px-2 py-1">{v.outcome}</span>}{v.sqft != null && <span className="font-mono tabular-nums px-1 py-1">{v.sqft.toLocaleString("en-GB")} sq ft</span>}{needsDetails(v) && <span className="border border-primary/40 rounded-full px-2 py-1">Needs details</span>}{viewingNeedsOutcome(v, today) && <span className="border border-primary/40 rounded-full px-2 py-1">Outcome due</span>}</div><p className="text-[11px] text-muted-foreground flex items-start gap-1.5"><UserRound className="h-3.5 w-3.5 shrink-0" /><span>{v.ownerName || "BGP owner needed"}{v.agentContactName ? ` · Agent: ${v.agentContactName}` : v.contactName ? ` · ${v.contactName}` : ""}</span></p>{v.nextAction && <p className="text-sm break-words">{v.nextAction}{v.followUpDate && <span className="text-muted-foreground"> · {dateLabel(v.followUpDate)}</span>}</p>}<div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => openViewing(v)}>{needsDetails(v) ? "Complete details" : viewingNeedsOutcome(v, today) ? "Report outcome" : "Open viewing"}</Button>{v.unitId && <Button variant="ghost" size="sm" asChild><a href={`/available?unitId=${encodeURIComponent(v.unitId)}&propertyId=${encodeURIComponent(v.propertyId || "")}`}><ExternalLink className="h-3.5 w-3.5 mr-1" />Tracker unit</a></Button>}</div></CardContent></Card>)}</div></section>)}<p className="text-[11px] text-muted-foreground">Showing <span className="font-mono tabular-nums">{Math.min(limit, filtered.length)}</span> of <span className="font-mono tabular-nums">{filtered.length}</span> viewing records. Multi-unit visits have one record per unit.</p>{filtered.length > limit && <Button variant="outline" size="sm" onClick={() => setLimit(n => n + 40)}>Show more viewings</Button>}</div>}
    <p className="text-[11px] text-muted-foreground"><Clock3 className="inline h-3 w-3 mr-1" />{viewingQuery.data?.emailRemindersEnabled ? "Missing details and outstanding outcomes are included in the BGP owner's reminder digest." : "Missing details and outstanding outcomes appear here. Automatic email reminders are not enabled."}</p>
    {isMobile ? <Drawer open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><DrawerContent className="max-h-[92dvh]"><DrawerHeader><DrawerTitle>{selected?.companyName || "Review viewing"}</DrawerTitle><DrawerDescription>Complete details and record what happened.</DrawerDescription></DrawerHeader><div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">{detail}</div></DrawerContent></Drawer> : <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{selected?.companyName || "Review viewing"}</DialogTitle><DialogDescription>Complete details and record what happened.</DialogDescription></DialogHeader>{detail}</DialogContent></Dialog>}
  </div>;
}

function ViewingReports({ options }: { options: ViewingOptions; isClient: boolean }) {
  const today = londonToday();
  const [from, setFrom] = useState(() => shiftDate(today, -90));
  const [to, setTo] = useState(today);
  const [ownerUserId, setOwnerUserId] = useState("");
  const [opportunityLimit, setOpportunityLimit] = useState(20);
  const validPeriod = !!from && !!to && from <= to;
  const reportQuery = useQuery<ViewingConversionReport>({
    queryKey: ["/api/leasing-viewings", "report", from, to, ownerUserId],
    queryFn: async () => {
      const params = new URLSearchParams({ from, to });
      if (ownerUserId) params.set("ownerUserId", ownerUserId);
      return (await apiRequest("GET", `/api/leasing-viewings/report?${params}`)).json();
    }, enabled: validPeriod,
  });
  const report = reportQuery.data;
  const percent = (value: number | null) => value == null ? "—" : `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`;
  const ownerName = (id: string | null) => options.owners.find(u => u.id === id)?.name || "Unassigned";
  return <div className="space-y-4 min-w-0" data-testid="leasing-viewing-reports">
    <div><h2 className="text-sm font-semibold">Viewing to offer conversion</h2><p className="text-[11px] text-muted-foreground">Distinct brand and unit opportunities, with repeat visits counted once. Only confirmed offers count towards conversion.</p></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5 min-w-0"><Label htmlFor="viewing-report-from" className={labelClass}>Viewing period from</Label><Input id="viewing-report-from" type="date" value={from} onChange={e => { setFrom(e.target.value); setOpportunityLimit(20); }} /></div>
      <div className="space-y-1.5 min-w-0"><Label htmlFor="viewing-report-to" className={labelClass}>Viewing period to</Label><Input id="viewing-report-to" type="date" value={to} onChange={e => { setTo(e.target.value); setOpportunityLimit(20); }} /></div>
      <div className="space-y-1.5 min-w-0"><Label htmlFor="viewing-report-owner" className={labelClass}>BGP owner</Label><select id="viewing-report-owner" className="w-full rounded-md border bg-background px-3 py-2 text-sm h-10" value={ownerUserId} onChange={e => { setOwnerUserId(e.target.value); setOpportunityLimit(20); }}><option value="">All BGP owners</option>{options.owners.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
    </div>
    {!validPeriod && <p className="text-sm" role="alert">Choose a valid start and end date.</p>}
    {validPeriod && reportQuery.isLoading && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[1, 2, 3, 4].map(n => <Skeleton key={n} className="h-24" />)}</div>}
    {reportQuery.isError && <Card><CardContent className="p-6 text-center space-y-3"><p className="text-sm">The report could not be loaded.</p><Button variant="outline" size="sm" onClick={() => void reportQuery.refetch()}>Refresh</Button></CardContent></Card>}
    {validPeriod && report && <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[
        ["Viewed opportunities", report.totals.completedOpportunities.toLocaleString("en-GB"), "Confirmed attended viewings"],
        ["Offered opportunities", report.totals.confirmedOfferOpportunities.toLocaleString("en-GB"), "Confirmed offers after a viewing"],
        ["Conversion to date", percent(report.totals.conversionRate), "Recent viewings may still convert"],
        ["Mature conversion", percent(report.totals.matureConversionRate), `${report.period.conversionWindowDays} days allowed for an offer`],
      ].map(([label, value, context]) => <Card key={label}><CardContent className="p-4"><p className={labelClass}>{label}</p><p className="text-2xl font-mono tabular-nums mt-2">{value}</p><p className="text-[11px] text-muted-foreground mt-1">{context}</p></CardContent></Card>)}</div>
      <Card><CardContent className="p-4 space-y-3"><h3 className="text-sm font-semibold">Coverage and outstanding work</h3><div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">{[
        ["Viewing records", report.totals.viewings], ["Repeat visits", report.totals.repeatViewings], ["Pending / not completed", report.totals.pending], ["Unresolved details", report.totals.unresolved], ["Cancelled", report.totals.cancelled], ["No-shows", report.totals.noShow], ["Not leasing", report.totals.notLeasing], ["Unconfirmed offers", report.coverage.unconfirmedOffers],
      ].map(([label, value]) => <div key={label}><p className="text-[11px] text-muted-foreground">{label}</p><p className="font-mono tabular-nums text-sm">{Number(value).toLocaleString("en-GB")}</p></div>)}</div><p className="text-[11px] text-muted-foreground">Missing brand or unit links, unconfirmed attended viewings, cancellations and no-shows do not count as converted opportunities. Offer revisions do not add extra conversions. One visit to several units produces an opportunity for each brand/unit pair.</p></CardContent></Card>
      <Card><CardContent className="p-4 space-y-3"><h3 className="text-sm font-semibold">By responsible BGP person</h3>{report.owners.length === 0 ? <p className="text-sm text-muted-foreground">No completed opportunities in this period.</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{report.owners.map(owner => <div key={owner.ownerUserId || "unassigned"} className="rounded-lg border p-3"><p className="text-sm font-semibold">{ownerName(owner.ownerUserId)}</p><p className="text-sm mt-2"><span className="font-mono tabular-nums">{owner.confirmedOfferOpportunities} / {owner.completedOpportunities}</span> offered <span className="font-mono tabular-nums">· {percent(owner.conversionRate)}</span></p></div>)}</div>}</CardContent></Card>
      <Card><CardContent className="p-4 space-y-3"><h3 className="text-sm font-semibold">Opportunities behind the figures</h3>{report.opportunities.length === 0 ? <p className="text-sm text-muted-foreground">No confirmed completed viewing opportunities in this period.</p> : <div className="space-y-2">{report.opportunities.slice(0, opportunityLimit).map(opportunity => <div key={opportunity.key} className="rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-sm break-words">{opportunity.companyName || options.brands.find(b => b.id === opportunity.companyId)?.name || "Brand"}</p><p className="text-[11px] text-muted-foreground break-words">{opportunity.propertyName || options.units.find(u => u.id === opportunity.unitId)?.propertyName} · {opportunity.unitName || options.units.find(u => u.id === opportunity.unitId)?.name || "Tracker unit"}</p><p className="text-[11px] text-muted-foreground">Viewed {dateLabel(opportunity.firstViewingDate)} · {ownerName(opportunity.ownerUserId)}{opportunity.repeatViewings > 0 ? ` · ${opportunity.repeatViewings} repeat visits` : ""}</p></div><div className="flex flex-wrap gap-2 items-center"><span className="text-[11px]">{opportunity.converted ? `Offer ${dateLabel(opportunity.firstOfferDate || "")}` : opportunity.mature ? "No offer in conversion window" : "Awaiting an offer"}</span>{opportunity.viewingIds[0] && <Button variant="outline" size="sm" asChild><a href={`/available?workspace=viewings&viewing=${encodeURIComponent(opportunity.viewingIds[0])}`}>Open viewing</a></Button>}</div></div>)}</div>}{report.opportunities.length > opportunityLimit && <Button variant="outline" size="sm" onClick={() => setOpportunityLimit(n => n + 20)}>Show more opportunities</Button>}<p className="text-[11px] text-muted-foreground">Period {dateLabel(report.period.from)} – {dateLabel(report.period.to)} · As of {dateLabel(report.period.asOf)}. Mature conversion includes opportunities with a full {report.period.conversionWindowDays}-day observation window.</p></CardContent></Card>
    </>}
  </div>;
}

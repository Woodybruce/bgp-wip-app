import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock3, Plus, Search, X } from "lucide-react";
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
import { ViewingSummary, ViewingsComingUp, ViewingsDayStrip, ViewingsFilterPill, ViewingsLegend, ViewingsMiniMonth, ViewingsMonthGrid, ViewingsTimeGrid, ViewingsToolbar, type CalendarView } from "@/components/leasing-viewings-calendar";

export type LeasingViewing = ViewingRecord;
// The queues that open as a compact list in place of the calendar.
type ListFilter = "details" | "outcomes" | "undated";
type PanelMode = "view" | "edit" | "outcome";
const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const statusLabels: Record<string, string> = { scheduled: "Scheduled", completed: "Attended", cancelled: "Cancelled", no_show: "No-show", not_leasing: "Not a leasing viewing" };
const listTitles: Record<ListFilter, string> = { details: "Needs details", outcomes: "Outcomes due", undated: "No date" };
const emptyOptions: ViewingOptions = { units: [], brands: [], contacts: [], owners: [], requirements: [] };
const noViewings: ViewingRecord[] = [];
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shiftDate = (value: string, days: number) => { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const weekOf = (value: string) => shiftDate(value, -((new Date(`${value}T12:00:00Z`).getUTCDay() + 6) % 7));
const validDay = (value: string) => calendarDateValue(value) === value;
const dateLabel = (value: string, weekday = false) => calendarDateValue(value) === value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(value.slice(0, 4) !== londonToday().slice(0, 4) ? { year: "numeric" as const } : {}), ...(weekday ? { weekday: "short" as const } : {}), timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "Date needed";
const needsDetails = (v: ViewingRecord) => !["not_leasing", "cancelled", "no_show"].includes(v.status) && (viewingMissingDetails(v).length > 0 || v.issues.length > 0);
const byDateAndTime = (a: ViewingRecord, b: ViewingRecord) => (a.viewingDate + (a.viewingTime || "")).localeCompare(b.viewingDate + (b.viewingTime || "")) || a.id.localeCompare(b.id);
const formFor = (v: ViewingRecord): ViewingPatch => ({ unitId: v.unitId, companyId: v.companyId, contactId: v.contactId, agentContactId: v.agentContactId, ownerUserId: v.ownerUserId, requirementId: v.requirementId, viewingDate: v.viewingDate, viewingTime: v.viewingTime, status: v.status, outcome: v.outcome, notes: v.notes, nextAction: v.nextAction, followUpDate: v.followUpDate, ...(v.id ? { expectedUpdatedAt: v.updatedAt } : {}) });

// Scoped directories intentionally omit unrelated CRM entries. An existing
// accessible viewing can still retain those recorded links; show its saved
// identity without exposing any additional directory choices.
type ViewingAgent = ViewingOptions["owners"][number];
// A joint agent is listed with their firm so two firms' people are told apart.
const agentLabel = (u: ViewingAgent) => u.jointAgent ? `${u.name} · ${u.firm || "Joint agent"}` : u.name;
// BGP agents always; a joint agent only on a unit at a scheme they act on.
function agentsForUnit(options: ViewingOptions, unitId: string | null | undefined, chosenId: string | null | undefined): ViewingAgent[] {
  const propertyId = options.units.find(u => u.id === unitId)?.propertyId;
  return options.owners.filter(u => !u.jointAgent || u.id === chosenId || (!!propertyId && (u.propertyIds || []).includes(propertyId)));
}

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
    queryClient.invalidateQueries({ queryKey: ["/api/accounts"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
  ]);
}

// The detail sits beside the grid from this width up; narrower desktop
// windows open it as a dialog and phones as a drawer.
function useWideScreen() {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
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
  const wide = useWideScreen();
  const today = londonToday();
  // As on the team calendar: a phone opens on Day, and a weekend opens on the
  // full week because the work week would hide today.
  const [view, setView] = useState<CalendarView>(() => isMobile ? "day" : [0, 6].includes(new Date(`${today}T12:00:00Z`).getUTCDay()) ? "week" : "workWeek");
  const [anchor, setAnchor] = useState(today);
  const [listFilter, setListFilter] = useState<ListFilter | null>(null);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState(initialBrandId || "");
  const [propertyFilter, setPropertyFilter] = useState(initialPropertyId || "");
  const [brandJumped, setBrandJumped] = useState(!initialBrandId);
  const [limit, setLimit] = useState(40);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ViewingRecord | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>("view");
  const [form, setForm] = useState<ViewingPatch>({});
  const [requirementId, setRequirementId] = useState("");
  const [tourUnitId, setTourUnitId] = useState("");
  const [tourOpen, setTourOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(!!(initialBrandId || initialPropertyId));
  const viewingQuery = useQuery<{ viewings: ViewingRecord[]; emailRemindersEnabled: boolean }>({ queryKey: ["/api/leasing-viewings"], staleTime: 5_000, refetchInterval: 30_000 });
  const optionsQuery = useQuery<ViewingOptions>({ queryKey: ["/api/leasing-viewings", "options"], queryFn: async () => (await apiRequest("GET", "/api/leasing-viewings/options")).json() });
  const rows = viewingQuery.data?.viewings || noViewings;
  const options = optionsQuery.data || emptyOptions;
  // The open viewing is read from the live list, so the panel shows what was
  // saved; a viewing not yet saved lives in `draft`.
  const selected = draft || rows.find(v => v.id === selectedId) || null;
  const openViewing = (v: ViewingRecord, next: PanelMode = "view") => { setDraft(null); setSelectedId(v.id); setForm(formFor(v)); setRequirementId(v.requirementId || ""); setTourUnitId(""); setTourOpen(false); setPanelMode(next); };
  const closePanel = () => { setSelectedId(null); setDraft(null); };
  useEffect(() => {
    if (!focusedViewingId || !viewingQuery.data) return;
    const row = viewingQuery.data.viewings.find(v => v.id === focusedViewingId);
    if (row) { openViewing(row); setListFilter(null); if (validDay(row.viewingDate)) setAnchor(row.viewingDate); }
    else toast({ title: "Viewing unavailable", description: "It may have been removed or be outside your accessible properties." });
    onFocusHandled();
  }, [focusedViewingId, viewingQuery.data]);
  // Arriving from a brand page: if the brand has nothing this week, open the
  // calendar on its next viewing (or its last) instead of an empty week.
  useEffect(() => {
    if (brandJumped || !viewingQuery.data) return;
    setBrandJumped(true);
    if (focusedViewingId) return;
    const days = viewingQuery.data.viewings.filter(v => v.companyId === initialBrandId && validDay(v.viewingDate)).map(v => v.viewingDate).sort();
    const monday = weekOf(today);
    if (days.some(day => day >= monday && day < shiftDate(monday, 7))) return;
    const target = days.find(day => day >= today) || days[days.length - 1];
    if (target) setAnchor(target);
  }, [brandJumped, viewingQuery.data]);
  useEffect(() => { setLimit(40); }, [listFilter, search, propertyFilter, brandFilter, ownerFilter]);
  // While the panel is only showing a viewing, keep the form in step with the
  // saved record so a later edit starts from, and is checked against, the
  // latest version.
  useEffect(() => { if (selected?.id && panelMode === "view") setForm(formFor(selected)); }, [selected?.id, selected?.updatedAt, panelMode]);

  const fail = (error: Error) => toast({ title: "Could not save viewing", description: error.message, variant: "destructive" });
  const save = useMutation({
    mutationFn: async (): Promise<{ id: string | null; day: string | null }> => {
      if (!selected) return { id: null, day: null };
      const saved = async (response: Response) => ({ id: ((await response.json()) as { id?: string } | null)?.id || selected.id || null, day: form.viewingDate || null });
      if (!selected.id) {
        if (!form.unitId) throw new Error("Choose the tracker unit");
        return saved(await apiRequest("POST", `/api/available-units/${form.unitId}/viewings`, { ...form, confirmDetails: !["cancelled", "no_show", "not_leasing"].includes(form.status || "") && viewingMissingDetails(form).length === 0 }));
      }
      // Closing an imported booking must not require invented dates or
      // re-submit a legacy agency as the prospective brand. Status and notes
      // are sufficient; identity corrections remain a separate explicit save.
      const terminal = ["cancelled", "no_show", "not_leasing"].includes(form.status || "");
      const patch = terminal
        ? { status: form.status, notes: form.notes, outcome: null, expectedUpdatedAt: form.expectedUpdatedAt }
        : { ...form, confirmDetails: viewingMissingDetails(form).length === 0 };
      return saved(await apiRequest("PATCH", `/api/leasing-viewings/${selected.id}`, patch));
    },
    onSuccess: async result => {
      await refreshViewings();
      setDraft(null);
      if (result.id) setSelectedId(result.id);
      setPanelMode("view");
      // Follow the viewing to the day it now sits on.
      if (result.day && validDay(result.day)) setAnchor(result.day);
      toast({ title: "Viewing updated" });
    }, onError: fail,
  });
  const linkRequirement = useMutation({
    mutationFn: async (create: boolean) => { if (!selected) return; return (await apiRequest("POST", `/api/leasing-viewings/${selected.id}/requirement`, create ? { create: true } : { requirementId })).json(); },
    onSuccess: async () => { setPanelMode("view"); await refreshViewings(); toast({ title: "Requirement linked", description: "The viewing is linked without changing the brand's stated size or location requirements." }); }, onError: fail,
  });
  const addTourUnit = useMutation({
    mutationFn: async () => { if (!selected) return; return (await apiRequest("POST", `/api/leasing-viewings/${selected.id}/units`, { unitIds: [tourUnitId] })).json(); },
    onSuccess: async () => { setTourUnitId(""); setTourOpen(false); setPanelMode("view"); await refreshViewings(); toast({ title: "Unit added to this visit" }); }, onError: fail,
  });
  const confirmOffer = useMutation({
    mutationFn: async (offerId: string) => { if (!selected) return; return (await apiRequest("POST", `/api/leasing-viewings/${selected.id}/offers/${offerId}/confirm`, {})).json(); },
    onSuccess: async () => { setPanelMode("view"); await refreshViewings(); toast({ title: "Offer confirmed" }); }, onError: fail,
  });

  const propertyOptions = useMemo(() => Array.from(new Map(options.units.map(u => [u.propertyId, u.propertyName])).entries()).map(([id, label]) => ({ id, label })), [options.units]);
  const ownerOptions = useMemo(() => [...(currentUserId && !isClient ? [{ id: currentUserId, label: "My viewings" }] : []), ...options.owners.filter(u => isClient || u.id !== currentUserId).map(u => ({ id: u.id, label: agentLabel(u) }))], [options.owners, currentUserId, isClient]);
  const brandOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const v of rows) if (v.companyId && v.companyName) names.set(v.companyId, v.companyName);
    if (brandFilter && !names.has(brandFilter)) names.set(brandFilter, options.brands.find(b => b.id === brandFilter)?.name || "Selected brand");
    return Array.from(names.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "en-GB"));
  }, [rows, brandFilter, options.brands]);
  const baseRows = useMemo(() => rows.filter(v => (!brandFilter || v.companyId === brandFilter) && (!ownerFilter || v.ownerUserId === ownerFilter) && (!propertyFilter || v.propertyId === propertyFilter)), [rows, brandFilter, ownerFilter, propertyFilter]);
  const counts = { details: baseRows.filter(needsDetails).length, outcomes: baseRows.filter(v => viewingNeedsOutcome(v, today)).length, undated: baseRows.filter(v => !validDay(v.viewingDate)).length };
  // What the calendar, the mini month and "Coming up" all show.
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? baseRows.filter(v => [v.companyName, v.contactName, v.agentContactName, v.unitName, v.propertyName, v.ownerName, v.sourceDetails?.subject].some(s => s?.toLowerCase().includes(query))) : baseRows;
  }, [baseRows, search]);
  const listRows = !listFilter ? noViewings : shown.filter(v => listFilter === "details" ? needsDetails(v) : listFilter === "outcomes" ? viewingNeedsOutcome(v, today) : !validDay(v.viewingDate)).sort(byDateAndTime);
  const filtersActive = !!(search.trim() || brandFilter || ownerFilter || propertyFilter);
  const clearFilters = () => { setSearch(""); setOwnerFilter(""); setPropertyFilter(""); setBrandFilter(""); };
  const toggleList = (value: ListFilter) => setListFilter(current => current === value ? null : value);
  const openDay = (day: string) => { setAnchor(day); setView("day"); setListFilter(null); };
  const reasonFor = (v: ViewingRecord) => {
    if (listFilter === "outcomes") return v.status === "completed" ? "Attended: choose the outcome" : "The date has passed: report what happened";
    const gaps = Array.from(new Set([...viewingMissingDetails(v), ...v.issues]));
    return gaps.slice(0, 2).join("; ") + (gaps.length > 2 ? `; ${gaps.length - 2} more` : "");
  };

  const relatedRequirements = options.requirements.filter(r => r.companyId && r.companyId === selected?.companyId);
  const formDirty = selected ? JSON.stringify(form) !== JSON.stringify(formFor(selected)) : false;
  const pending = save.isPending || linkRequirement.isPending || addTourUnit.isPending || confirmOffer.isPending;
  const field = (key: keyof ViewingPatch, value: unknown) => setForm(current => ({ ...current, [key]: value || null }));
  const closingExisting = !!selected?.id && ["cancelled", "no_show", "not_leasing"].includes(form.status || "");
  const selectedIssues = selected ? Array.from(new Set([...viewingMissingDetails(form), ...selected.issues])) : [];
  const trackerUnitIds = new Set(units.map(u => u.id));
  const createViewing = () => {
    const owner = options.owners.find(u => u.id === currentUserId);
    const record: ViewingRecord = { id: "", unitId: null, propertyId: null, propertyName: null, unitName: null, sqft: null, companyId: null, companyName: null, contactId: null, contactName: null, agentContactId: null, agentContactName: null, ownerUserId: owner?.id || null, ownerName: owner?.name || null, team: owner?.team || null, requirementId: null, requirementName: null, viewingDate: view === "day" && !listFilter ? anchor : today, viewingTime: null, status: "scheduled", outcome: null, notes: null, attendees: null, nextAction: null, followUpDate: null, source: null, calendarEventId: null, bookingId: null, detailsConfirmedAt: null, outcomeRecordedAt: null, updatedAt: "", issues: [] };
    setSelectedId(null); setDraft(record); setForm(formFor(record)); setRequirementId(""); setTourUnitId(""); setTourOpen(false); setPanelMode("edit");
  };
  const backToView = () => { if (!selected?.id) { closePanel(); return; } setForm(formFor(selected)); setPanelMode("view"); };
  const selectedBrandName = options.brands.find(b => b.id === selected?.companyId)?.name || selected?.companyName;
  const siblings = selected?.bookingId ? rows.filter(v => v.bookingId === selected.bookingId && v.id !== selected.id) : noViewings;
  const panelTitle = !selected ? "" : !selected.id ? "New viewing" : panelMode === "view" ? "Viewing" : selected.companyName || "Review viewing";
  const panelHint = !selected?.id ? "Choose the unit, the brand and who is coming." : panelMode === "view" ? "Who is viewing, what they are seeing and what happens next." : "Complete details and record what happened.";

  const issuesNote = selectedIssues.length > 0 && <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm" role="status"><p className="font-semibold">Check the viewing details</p><ul className="mt-1 list-disc pl-4 space-y-1">{selectedIssues.map(issue => <li key={issue}>{issue}</li>)}</ul><p className="mt-2 text-[11px] text-muted-foreground">Save complete details to confirm the brand, contact and space being viewed.</p></div>;
  const outcomeFields = selected && <>
    <div className="flex flex-wrap gap-1.5">{VIEWING_STATUSES.map(status => <Pill key={status} active={form.status === status} aria-pressed={form.status === status} onClick={() => setForm(current => ({ ...current, status, ...(status !== "completed" ? { outcome: null } : {}) }))} data-testid={`viewings-form-status-${status}`}>{statusLabels[status]}</Pill>)}</div>
    <div className="space-y-1.5"><Label htmlFor="viewing-workflow-outcome" className={labelClass}>Viewing outcome</Label><select id="viewing-workflow-outcome" className="w-full rounded-md border bg-background px-3 py-2 text-sm h-11" value={form.outcome || ""} onChange={e => setForm(current => ({ ...current, outcome: e.target.value || null, ...(e.target.value ? { status: "completed" } : {}) }))} data-testid="viewings-form-outcome"><option value="">Choose outcome</option>{VIEWING_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}{form.outcome && !VIEWING_OUTCOMES.includes(form.outcome as any) && <option value={form.outcome}>{form.outcome}</option>}</select></div>
    <div className="space-y-1.5"><Label htmlFor="viewing-workflow-notes" className={labelClass}>Notes</Label><Textarea id="viewing-workflow-notes" value={form.notes || ""} onChange={e => field("notes", e.target.value)} placeholder="Feedback, objections and what was discussed" rows={3} data-testid="viewings-form-notes" /></div>
    <div className="space-y-1.5"><Label htmlFor="viewing-workflow-next-action" className={labelClass}>Next action</Label><Input id="viewing-workflow-next-action" value={form.nextAction || ""} onChange={e => field("nextAction", e.target.value)} placeholder="For example: send terms and follow up with the agent" data-testid="viewings-form-next-action" /></div>
    <div className="space-y-1.5"><Label htmlFor="viewing-workflow-follow-up" className={labelClass}>Follow-up date</Label><Input id="viewing-workflow-follow-up" type="date" value={form.followUpDate || ""} onChange={e => field("followUpDate", e.target.value)} data-testid="viewings-form-follow-up" /></div>
  </>;
  const saveRow = selected && <>
    {closingExisting && <p className="text-[11px] text-muted-foreground">Closing this viewing saves its status and notes. Booking details and links remain unchanged.</p>}
    <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" size="sm" onClick={backToView} data-testid="viewings-form-back">Back</Button><Button size="sm" disabled={pending || (!closingExisting && (!form.viewingDate || (!form.unitId && !selected.id))) || optionsQuery.isLoading} onClick={() => save.mutate()} data-testid="viewing-workflow-save">{save.isPending ? "Saving…" : "Save viewing"}</Button></div>
  </>;
  const offerButton = selected && <Button variant="outline" size="sm" disabled={pending || formDirty || !selected.unitId || !selected.companyId} onClick={() => { closePanel(); onRecordOffer(selected); }} data-testid="viewing-workflow-offer">Record offer</Button>;
  const offerRows = selected?.offers?.map(offer => <div key={offer.id} className="rounded-lg border p-3 flex flex-wrap items-center justify-between gap-2 text-sm" data-testid={`viewings-offer-${offer.id}`}><span>{offer.confirmedAt ? "Confirmed offer" : "Offer awaiting confirmation"} · {dateLabel(offer.offerDate)}</span>{!offer.confirmedAt && <Button variant="outline" size="sm" disabled={pending || formDirty} onClick={() => confirmOffer.mutate(offer.id)} data-testid={`viewings-offer-confirm-${offer.id}`}>Confirm offer</Button>}</div>);
  const requirementBlock = selected && <>
    {selected.requirementId && <p className="text-sm">Linked requirement: <a href={`/requirements?companyId=${encodeURIComponent(selected.companyId || "")}`} className="text-primary underline" data-testid="viewings-requirement-link">{selected.requirementName || selectedBrandName || "Open requirement"}</a></p>}
    {!isClient && <div className="space-y-2"><EntityCombobox value={requirementId} items={relatedRequirements.map(r => ({ id: r.id, label: r.name }))} onChange={setRequirementId} ariaLabel="Existing brand requirement" placeholder="Choose an existing brand requirement" disabled={!selected.companyId || formDirty} testId="viewings-requirement-picker" /><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={pending || formDirty || !requirementId} onClick={() => linkRequirement.mutate(false)} data-testid="viewings-requirement-link-existing">Link requirement</Button><Button variant="outline" size="sm" disabled={pending || formDirty || !selected.companyId || !!selected.requirementId} onClick={() => linkRequirement.mutate(true)} data-testid="viewings-requirement-create">Create requirement draft</Button></div><p className="text-[11px] text-muted-foreground">A viewing is evidence of activity; it does not overwrite the brand's target size or locations.</p></div>}
  </>;
  const tourBlock = selected && <div className="space-y-2"><h3 className="text-sm font-semibold">Another unit on the same visit</h3><EntityCombobox value={tourUnitId} items={options.units.filter(u => u.id !== selected.unitId).map(u => ({ id: u.id, label: u.name, subLabel: u.propertyName }))} onChange={setTourUnitId} ariaLabel="Another unit on this visit" placeholder="Choose another space viewed" disabled={pending || formDirty || !selected.unitId} testId="viewings-tour-unit" /><Button variant="outline" size="sm" disabled={pending || formDirty || !tourUnitId} onClick={() => addTourUnit.mutate()} data-testid="viewings-tour-add">Add unit to visit</Button></div>;

  const panelBody = selected && (panelMode === "view" && selected.id ? <div className="space-y-4">
    {needsDetails(selected) && issuesNote}
    <ViewingSummary viewing={selected} today={today} options={options} siblings={siblings} onSelect={openViewing} />
    <div className="grid grid-cols-2 gap-2 border-t pt-4" data-testid="viewings-actions">
      <Button variant={needsDetails(selected) ? "default" : "outline"} size="sm" onClick={() => setPanelMode("edit")} data-testid="viewings-action-edit">{needsDetails(selected) ? "Complete details" : "Edit details"}</Button>
      <Button variant={!needsDetails(selected) && viewingNeedsOutcome(selected, today) ? "default" : "outline"} size="sm" onClick={() => setPanelMode("outcome")} data-testid="viewings-action-outcome">Report outcome</Button>
      {offerButton}
      <Button variant="outline" size="sm" disabled={pending || !selected.unitId} aria-expanded={tourOpen} onClick={() => setTourOpen(open => !open)} data-testid="viewings-action-add-unit">Add another unit</Button>
    </div>
    {tourOpen && tourBlock}
    {(!!selected.offers?.length || !!selected.requirementId || !isClient) && <div className="border-t pt-4 space-y-3"><h3 className="text-sm font-semibold">Offers and requirements</h3>{offerRows}{requirementBlock}</div>}
  </div> : panelMode === "outcome" && selected.id ? <div className="space-y-4">
    <div><p className="text-sm font-semibold break-words">{selected.companyName || "Brand to confirm"}</p><p className="text-[11px] text-muted-foreground break-words">{[selected.unitName, selected.propertyName].filter(Boolean).join(" · ") || "Unit to confirm"} · {dateLabel(selected.viewingDate, true)}{selected.viewingTime ? ` · ${selected.viewingTime}` : ""}</p></div>
    <div className="space-y-3"><h3 className="text-sm font-semibold">Report outcome</h3>{outcomeFields}</div>
    {saveRow}
  </div> : <div className="space-y-4">
    {issuesNote}
    {selected.sourceDetails?.subject && <div className="rounded-lg border p-3 text-sm"><div className={labelClass}>Outlook booking</div><p className="mt-1 break-words">{selected.sourceDetails.subject}</p>{selected.sourceDetails.location && <p className="text-[11px] text-muted-foreground mt-1">{selected.sourceDetails.location}</p>}{selected.attendees && <p className="text-[11px] text-muted-foreground mt-1 break-words">{selected.attendees}</p>}</div>}
    <div className="space-y-1.5"><Label className={labelClass}>Tracker unit</Label><EntityCombobox value={form.unitId} items={withRecordedOption(options.units.filter(u => !!selected.id || trackerUnitIds.has(u.id)).map(u => ({ id: u.id, label: u.name, subLabel: u.propertyName })), form.unitId, selected.unitId, selected.unitName, "Recorded tracker unit")} onChange={id => field("unitId", id)} placeholder="Choose the unit being viewed" ariaLabel="Tracker unit" testId="viewing-workflow-unit" /></div>
    <div className="space-y-1.5"><Label className={labelClass}>Brand viewing</Label><EntityCombobox value={form.companyId} items={withRecordedOption(options.brands.map(b => ({ id: b.id, label: b.name })), form.companyId, selected.companyId, selected.companyName, "Recorded brand")} onChange={id => setForm(current => current.companyId === (id || null) ? current : ({ ...current, companyId: id || null, contactId: null, requirementId: null, ...(isClient ? { agentContactId: null } : {}) }))} placeholder="Choose the brand" ariaLabel="Brand viewing" testId="viewing-workflow-brand" /><p className="text-[11px] text-muted-foreground">The prospective occupier. Record its representing agent separately below. Changing the brand removes any existing requirement link.</p></div>
    <div className="space-y-1.5 min-w-0"><Label className={labelClass}>Brand contact</Label><EntityCombobox value={form.contactId} items={withRecordedOption(options.contacts.filter(c => c.id === form.contactId || (form.companyId && c.companyId === form.companyId)).map(c => ({ id: c.id, label: c.name, subLabel: c.email || undefined })), form.contactId, selected.contactId, selected.contactName, "Recorded brand contact")} onChange={id => field("contactId", id)} placeholder="Choose brand contact" ariaLabel="Brand contact" testId="viewing-workflow-contact" /></div>
    <div className="space-y-1.5 min-w-0"><Label className={labelClass}>Representing agent</Label><EntityCombobox value={form.agentContactId} items={withRecordedOption(options.contacts.filter(c => !isClient || c.id === form.agentContactId || (form.companyId && (c.representedBrandIds || []).includes(form.companyId))).map(c => ({ id: c.id, label: c.name, subLabel: c.email || undefined })), form.agentContactId, selected.agentContactId, selected.agentContactName, "Recorded representing agent")} onChange={id => field("agentContactId", id)} placeholder="Choose representing agent" ariaLabel="Representing agent" testId="viewing-workflow-agent" /></div>
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5 min-w-0"><Label htmlFor="viewing-workflow-date" className={labelClass}>Viewing date</Label><Input id="viewing-workflow-date" type="date" className="min-w-0" value={form.viewingDate || ""} onChange={e => field("viewingDate", e.target.value)} data-testid="viewings-form-date" /></div>
      <div className="space-y-1.5 min-w-0"><Label htmlFor="viewing-workflow-time" className={labelClass}>Time · UK</Label><Input id="viewing-workflow-time" type="time" className="min-w-0" value={form.viewingTime || ""} onChange={e => field("viewingTime", e.target.value)} data-testid="viewings-form-time" /></div>
    </div>
    <div className="space-y-1.5"><Label className={labelClass}>Agent · BGP or joint agent</Label><EntityCombobox value={form.ownerUserId} items={withRecordedOption(agentsForUnit(options, form.unitId, form.ownerUserId).map(u => ({ id: u.id, label: u.name, subLabel: u.jointAgent ? `Joint agent${u.firm ? ` · ${u.firm}` : ""}` : "BGP" })), form.ownerUserId, selected.ownerUserId, selected.ownerName, "Recorded agent")} onChange={id => field("ownerUserId", id)} placeholder="Assign the agent" ariaLabel="Agent" testId="viewing-workflow-owner" /></div>
    <div className="border-t pt-4 space-y-3"><h3 className="text-sm font-semibold">Report outcome</h3>{outcomeFields}</div>
    {saveRow}
    {!!selected.id && <div className="border-t pt-4 space-y-3">
      <h3 className="text-sm font-semibold">Offers and requirements</h3>
      {formDirty && <p className="text-[11px] text-muted-foreground">Save the changes above before linking an offer, requirement or another unit.</p>}
      {offerButton}
      {offerRows}
      {requirementBlock}
      {tourBlock}
    </div>}
  </div>);

  if (mode === "reports") return <ViewingReports options={options} isClient={isClient} />;
  // On a phone the property, owner and brand filters and the search sit
  // behind one Filters pill so the calendar starts higher up the screen.
  const filterCount = [search.trim(), brandFilter, ownerFilter, propertyFilter].filter(Boolean).length;
  const filterControls = <>
    <ViewingsFilterPill label="Property" allLabel="All properties" value={propertyFilter} options={propertyOptions} onChange={setPropertyFilter} testId="viewings-filter-property" />
    <ViewingsFilterPill label="Agent" allLabel="All agents" value={ownerFilter} options={ownerOptions} onChange={setOwnerFilter} testId="viewings-filter-owner" />
    <ViewingsFilterPill label="Brand" allLabel="All brands" value={brandFilter} options={brandOptions} onChange={setBrandFilter} testId="viewings-filter-brand" />
    {filtersActive && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearFilters} data-testid="viewings-filter-clear">Clear filters</Button>}
    <div className="relative w-full min-w-0 sm:ml-auto sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="h-9 pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find brand, property or contact…" aria-label="Search viewings" data-testid="viewings-search" /></div>
  </>;
  const sidePanel = wide && !isMobile;
  // A new key remounts the scroller, so each viewing and each step opens at its top.
  const panelKey = selected ? `${selected.id || "new"}:${panelMode}` : "side";
  return <div className="space-y-3 min-w-0" data-testid="leasing-viewings-workspace">
    <ViewingsToolbar anchor={anchor} view={view} today={today} viewings={shown} list={listFilter ? { title: listTitles[listFilter], count: listRows.length } : null} compact={isMobile} onAnchor={day => { setAnchor(day); setListFilter(null); }} onView={next => { setView(next); setListFilter(null); }}>
      <Button size="sm" onClick={createViewing} data-testid="viewings-add"><Plus className="h-4 w-4 mr-1" />Add viewing</Button>
    </ViewingsToolbar>
    <div className="flex flex-wrap items-center gap-1.5" data-testid="viewings-filters">
      <Pill active={listFilter === "details"} aria-pressed={listFilter === "details"} onClick={() => toggleList("details")} data-testid="viewings-filter-details">Needs details<span className="font-mono tabular-nums">{counts.details}</span></Pill>
      <Pill active={listFilter === "outcomes"} aria-pressed={listFilter === "outcomes"} onClick={() => toggleList("outcomes")} data-testid="viewings-filter-outcomes">Outcomes due<span className="font-mono tabular-nums">{counts.outcomes}</span></Pill>
      {counts.undated > 0 && <Pill active={listFilter === "undated"} aria-pressed={listFilter === "undated"} onClick={() => toggleList("undated")} data-testid="viewings-filter-undated">No date<span className="font-mono tabular-nums">{counts.undated}</span></Pill>}
      {isMobile ? <Pill active={filtersOpen || filtersActive} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)} data-testid="viewings-filter-toggle">Filters{filterCount > 0 && <span className="font-mono tabular-nums">{filterCount}</span>}</Pill>
        : <><span className="mx-1 h-4 w-px bg-border" aria-hidden />{filterControls}</>}
    </div>
    {isMobile && filtersOpen && <div className="flex flex-wrap items-center gap-1.5" data-testid="viewings-filters-more">{filterControls}</div>}
    {isMobile && view === "day" && !listFilter && <ViewingsDayStrip anchor={anchor} today={today} viewings={shown} onSelectDate={setAnchor} />}
    <div className="overflow-hidden rounded-2xl border border-border bg-card md:rounded-lg lg:flex lg:min-h-[640px]" data-testid="viewings-calendar">
      <div className="flex min-w-0 flex-1 flex-col">
        {viewingQuery.isLoading ? <div className="space-y-3 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-72 w-full" /></div>
          : viewingQuery.isError || optionsQuery.isError ? <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"><p className="text-sm">The viewing records could not be loaded.</p><Button variant="outline" size="sm" onClick={() => { void viewingQuery.refetch(); void optionsQuery.refetch(); }} data-testid="viewings-refresh">Refresh</Button></div>
          : listFilter ? (listRows.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"><CalendarDays className="h-6 w-6 text-muted-foreground" /><p className="text-sm">No viewings match this view.</p><Button variant="outline" size="sm" onClick={() => setListFilter(null)} data-testid="viewings-list-back">Back to the calendar</Button></div>
            : <div className="min-w-0" data-testid="viewings-list">
              <div className="divide-y divide-border">{listRows.slice(0, limit).map(v => <div key={v.id} className={`flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center ${selectedId === v.id ? "bg-muted" : ""}`} data-testid={`viewings-list-row-${v.id}`}>
                <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => openViewing(v)} aria-label={`Open the viewing for ${v.companyName || "a brand to confirm"}`} data-testid={`viewings-list-open-${v.id}`}>
                  <span className="w-[84px] shrink-0"><span className="block text-[11px] font-semibold">{dateLabel(v.viewingDate, true)}</span><span className="block font-mono text-[11px] tabular-nums text-muted-foreground">{v.viewingTime || "No time set"}</span></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{v.companyName || "Brand to confirm"}</span><span className="block truncate text-[11px] text-muted-foreground">{[v.unitName, v.propertyName].filter(Boolean).join(" · ") || v.sourceDetails?.subject || "Property and unit to confirm"}</span><span className="block truncate text-[11px]">{[v.contactName, v.agentContactName ? `${v.agentContactName} (agent)` : null, v.ownerName ? `${v.ownerName} (BGP)` : "BGP owner needed"].filter(Boolean).join(" · ")}</span><span className="mt-0.5 block text-[11px] text-primary">{reasonFor(v)}</span></span>
                </button>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => openViewing(v, needsDetails(v) ? "edit" : viewingNeedsOutcome(v, today) ? "outcome" : "view")} data-testid={`viewings-list-action-${v.id}`}>{needsDetails(v) ? "Complete details" : viewingNeedsOutcome(v, today) ? "Report outcome" : "Open viewing"}</Button>
              </div>)}</div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2"><p className="text-[11px] text-muted-foreground">Showing <span className="font-mono tabular-nums">{Math.min(limit, listRows.length)}</span> of <span className="font-mono tabular-nums">{listRows.length}</span> viewing records. Multi-unit visits have one record per unit.</p>{listRows.length > limit && <Button variant="outline" size="sm" onClick={() => setLimit(n => n + 40)} data-testid="viewings-list-more">Show more viewings</Button>}</div>
            </div>)
          : view === "month" ? <ViewingsMonthGrid anchor={anchor} view={view} today={today} viewings={shown} selectedId={selectedId} onSelect={openViewing} onOpenDay={openDay} onAnchor={setAnchor} narrow={isMobile} filtered={filtersActive} onClearFilters={clearFilters} />
          : <ViewingsTimeGrid anchor={anchor} view={view} today={today} viewings={shown} selectedId={selectedId} onSelect={openViewing} onOpenDay={openDay} onAnchor={setAnchor} narrow={isMobile} filtered={filtersActive} onClearFilters={clearFilters} contained={!isMobile} />}
      </div>
      {sidePanel && <aside className="relative w-[360px] shrink-0 border-l border-border" data-testid="viewings-side"><div key={panelKey} className="absolute inset-0 overflow-y-auto">
        {selected ? <div data-testid="viewings-panel">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-2.5"><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{panelTitle}</h3><p className="truncate text-[11px] text-muted-foreground">{panelHint}</p></div><Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={closePanel} aria-label="Close viewing" data-testid="viewings-panel-close"><X className="h-4 w-4" /></Button></div>
          <div className="p-4">{panelBody}</div>
        </div> : <>
          <ViewingsMiniMonth anchor={anchor} today={today} viewings={shown} onSelectDate={day => { setAnchor(day); setListFilter(null); }} />
          <ViewingsComingUp viewings={shown} today={today} selectedId={selectedId} onSelect={v => { openViewing(v); setAnchor(v.viewingDate); setListFilter(null); }} />
        </>}
      </div></aside>}
    </div>
    <ViewingsLegend />
    <p className="text-[11px] text-muted-foreground"><Clock3 className="inline h-3 w-3 mr-1" />{viewingQuery.data?.emailRemindersEnabled ? "Missing details and outstanding outcomes are included in the BGP owner's reminder digest." : "Missing details and outstanding outcomes appear here. Automatic email reminders are not enabled."}</p>
    {isMobile ? <Drawer open={!!selected} onOpenChange={open => { if (!open) closePanel(); }}><DrawerContent className="max-h-[92dvh]"><DrawerHeader><DrawerTitle>{panelTitle || "Review viewing"}</DrawerTitle><DrawerDescription>{panelHint}</DrawerDescription></DrawerHeader><div key={panelKey} className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">{panelBody}</div></DrawerContent></Drawer>
      : !sidePanel && <Dialog open={!!selected} onOpenChange={open => { if (!open) closePanel(); }}><DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col"><DialogHeader><DialogTitle>{panelTitle || "Review viewing"}</DialogTitle><DialogDescription>{panelHint}</DialogDescription></DialogHeader><div key={panelKey} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">{panelBody}</div></DialogContent></Dialog>}
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
      <div className="space-y-1.5 min-w-0"><Label htmlFor="viewing-report-owner" className={labelClass}>Agent</Label><select id="viewing-report-owner" className="w-full rounded-md border bg-background px-3 py-2 text-sm h-10" value={ownerUserId} onChange={e => { setOwnerUserId(e.target.value); setOpportunityLimit(20); }}><option value="">All agents</option>{options.owners.map(u => <option key={u.id} value={u.id}>{agentLabel(u)}</option>)}</select></div>
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
      <Card><CardContent className="p-4 space-y-3"><h3 className="text-sm font-semibold">By agent</h3>{report.owners.length === 0 ? <p className="text-sm text-muted-foreground">No completed opportunities in this period.</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{report.owners.map(owner => <div key={owner.ownerUserId || "unassigned"} className="rounded-lg border p-3"><p className="text-sm font-semibold">{ownerName(owner.ownerUserId)}</p><p className="text-sm mt-2"><span className="font-mono tabular-nums">{owner.confirmedOfferOpportunities} / {owner.completedOpportunities}</span> offered <span className="font-mono tabular-nums">· {percent(owner.conversionRate)}</span></p></div>)}</div>}</CardContent></Card>
      <Card><CardContent className="p-4 space-y-3"><h3 className="text-sm font-semibold">Opportunities behind the figures</h3>{report.opportunities.length === 0 ? <p className="text-sm text-muted-foreground">No confirmed completed viewing opportunities in this period.</p> : <div className="space-y-2">{report.opportunities.slice(0, opportunityLimit).map(opportunity => <div key={opportunity.key} className="rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-sm break-words">{opportunity.companyName || options.brands.find(b => b.id === opportunity.companyId)?.name || "Brand"}</p><p className="text-[11px] text-muted-foreground break-words">{opportunity.propertyName || options.units.find(u => u.id === opportunity.unitId)?.propertyName} · {opportunity.unitName || options.units.find(u => u.id === opportunity.unitId)?.name || "Tracker unit"}</p><p className="text-[11px] text-muted-foreground">Viewed {dateLabel(opportunity.firstViewingDate)} · {ownerName(opportunity.ownerUserId)}{opportunity.repeatViewings > 0 ? ` · ${opportunity.repeatViewings} repeat visits` : ""}</p></div><div className="flex flex-wrap gap-2 items-center"><span className="text-[11px]">{opportunity.converted ? `Offer ${dateLabel(opportunity.firstOfferDate || "")}` : opportunity.mature ? "No offer in conversion window" : "Awaiting an offer"}</span>{opportunity.viewingIds[0] && <Button variant="outline" size="sm" asChild><a href={`/available?workspace=viewings&viewing=${encodeURIComponent(opportunity.viewingIds[0])}`}>Open viewing</a></Button>}</div></div>)}</div>}{report.opportunities.length > opportunityLimit && <Button variant="outline" size="sm" onClick={() => setOpportunityLimit(n => n + 20)}>Show more opportunities</Button>}<p className="text-[11px] text-muted-foreground">Period {dateLabel(report.period.from)} – {dateLabel(report.period.to)} · As of {dateLabel(report.period.asOf)}. Mature conversion includes opportunities with a full {report.period.conversionWindowDays}-day observation window.</p></CardContent></Card>
    </>}
  </div>;
}

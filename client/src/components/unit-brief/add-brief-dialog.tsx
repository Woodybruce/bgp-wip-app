// Add brief (Woody, 2026-11-12): the button at the top of the Letting
// Tracker. One step puts a unit on the tracker (with its deal reference,
// through the letting service) and starts its Targeting Brief; a unit that
// is already listed is reused, and so is its brief. For a client login this
// is how units are added. The client's brief document can be uploaded
// first so the unit and the brief are filled in from it.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Sparkles, Target } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DEAL_STATUS_LABELS, type DealStatusCode } from "@shared/deal-status";
import { normaliseCommercials, commercialsHaveContent } from "@shared/unit-brief";
import type { AvailableUnit } from "@shared/schema";
import { serverMessage, type SuggestedBriefPerson } from "./types";

const MICRO_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const NEW_UNIT = "__new__";
const TEXT_FIELDS = ["title", "clientCompany", "objective", "locationContext", "targetCriteria", "priorityCategories", "agentInstruction", "successMeasures", "instructedDate", "deadline1Date", "deadline1Deliverables", "deadline2Date", "deadline2Deliverables"] as const;

interface PropertyLite { id: string; name: string }
interface UnitHit {
  propertyId: string; unitName: string; trackerRowId: string | null; tenancyUnitId: string | null;
  dealRef: number | null; statusCode: string | null; occupancy: string | null; tenantName: string | null;
}
export interface AddBriefInfo { briefId: string; briefCreated: boolean; alreadyListed: boolean; dealRef: number | null; people: SuggestedBriefPerson[] }

const unitState = (u: UnitHit): string => {
  if (u.trackerRowId) return `On the tracker${u.statusCode ? `, ${DEAL_STATUS_LABELS[u.statusCode as DealStatusCode] || u.statusCode}` : ""}${u.dealRef ? `, Ref #${u.dealRef}` : ""}`;
  if (u.tenantName) return `Let to ${u.tenantName}`;
  return u.occupancy || "Not on the tracker";
};

export function AddBriefDialog({ open, onOpenChange, onStarted }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onStarted: (unit: AvailableUnit, info: AddBriefInfo) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [propertyId, setPropertyId] = useState("");
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [unitKey, setUnitKey] = useState(""); // a unit name from the list, or NEW_UNIT
  const [unitOpen, setUnitOpen] = useState(false);
  const [newUnit, setNewUnit] = useState({ unitName: "", floor: "", sqft: "" });
  const [extracted, setExtracted] = useState<Record<string, any> | null>(null);
  const [extractName, setExtractName] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPropertyId(""); setUnitKey(""); setNewUnit({ unitName: "", floor: "", sqft: "" });
    setExtracted(null); setExtractName(""); setError(null); setBusy(false); setReading(false);
  }, [open]);

  const { data: properties = [], isLoading: propertiesLoading } = useQuery<PropertyLite[]>({
    queryKey: ["/api/crm/properties"],
    queryFn: async () => {
      const r = await fetch("/api/crm/properties", { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      const json = await r.json();
      return Array.isArray(json) ? json : (json?.data || []);
    },
    enabled: open,
    staleTime: 60_000,
  });
  const sortedProperties = useMemo(() => [...properties].filter(p => p?.id && p?.name).sort((a, b) => a.name.localeCompare(b.name)), [properties]);
  const property = sortedProperties.find(p => p.id === propertyId) || null;

  const { data: units = [], isFetching: unitsLoading } = useQuery<UnitHit[]>({
    queryKey: ["/api/letting/unit-search", propertyId],
    queryFn: async () => {
      const r = await fetch(`/api/letting/unit-search?propertyId=${encodeURIComponent(propertyId)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      const json = await r.json();
      return Array.isArray(json) ? json : [];
    },
    enabled: open && !!propertyId,
    staleTime: 15_000,
  });
  const sortedUnits = useMemo(() => [...units].filter(u => u.unitName).sort((a, b) => a.unitName.localeCompare(b.unitName, "en-GB", { numeric: true })), [units]);
  const pickedUnit = unitKey && unitKey !== NEW_UNIT ? sortedUnits.find(u => u.unitName === unitKey) || null : null;
  const isNew = unitKey === NEW_UNIT;

  const sqftNumber = newUnit.sqft.trim() === "" ? null : Number(newUnit.sqft.replace(/[,\s]/g, ""));
  const sqftBad = sqftNumber !== null && (!Number.isFinite(sqftNumber) || sqftNumber < 0);
  const ready = !!propertyId && (pickedUnit ? true : isNew && !!newUnit.unitName.trim() && !sqftBad);

  // What the client's document gave us, in a few words.
  const extractSummary = useMemo(() => {
    if (!extracted) return "";
    const parts: string[] = [];
    if (extracted.objective) parts.push("objective");
    if (extracted.targetCriteria || extracted.priorityCategories) parts.push("target criteria");
    if (commercialsHaveContent(normaliseCommercials(extracted.commercials).value)) parts.push("commercials");
    if (Array.isArray(extracted.targets) && extracted.targets.length) parts.push(`${extracted.targets.length} target operator${extracted.targets.length === 1 ? "" : "s"}`);
    if (Array.isArray(extracted.people) && extracted.people.length) parts.push(`${extracted.people.length} ${extracted.people.length === 1 ? "person" : "people"} named`);
    return parts.length ? `Read: ${parts.join(", ")}.` : "The document was read, but little could be taken from it.";
  }, [extracted]);

  const readDocument = async (file: File) => {
    setReading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/unit-briefs/extract", { method: "POST", credentials: "include", headers: getAuthHeaders(), body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || "The document could not be read");
      const data = await res.json();
      setExtracted(data); setExtractName(file.name);
      // The scheme: only on one clear match by name.
      if (!propertyId && data.propertyName) {
        const want = String(data.propertyName).trim().toLowerCase();
        const hits = sortedProperties.filter(p => { const n = p.name.toLowerCase(); return n.includes(want) || want.includes(n); });
        if (hits.length === 1) setPropertyId(hits[0].id);
      }
      if (data.unitName) {
        setUnitKey(NEW_UNIT);
        setNewUnit({ unitName: String(data.unitName), floor: data.floor ? String(data.floor) : "", sqft: data.sqft ? String(data.sqft) : "" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The document could not be read");
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // A unit named in the document that is already on the scheme's list is
  // picked from the list, so its tracker row and brief are reused.
  useEffect(() => {
    if (!isNew || !extracted?.unitName || sortedUnits.length === 0) return;
    const want = String(extracted.unitName).trim().toLowerCase();
    const hit = sortedUnits.find(u => u.unitName.trim().toLowerCase() === want);
    if (hit) setUnitKey(hit.unitName);
  }, [sortedUnits, extracted, isNew]);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      const body = pickedUnit?.trackerRowId
        ? { trackerUnitId: pickedUnit.trackerRowId }
        : pickedUnit?.tenancyUnitId
          ? { propertyId, tenancyUnitId: pickedUnit.tenancyUnitId }
        : pickedUnit
          ? { propertyId, unitName: pickedUnit.unitName }
          : { propertyId, unitName: newUnit.unitName.trim(), floor: newUnit.floor.trim() || null, sqft: sqftNumber };
      const result = await (await apiRequest("POST", "/api/unit-briefs/start", body)).json();
      // People the document named are offered on People & sign-off, not added unseen.
      const people: SuggestedBriefPerson[] = Array.isArray(extracted?.people)
        ? extracted!.people.filter((p: any) => p?.name).map((p: any) => ({ name: String(p.name), role: p.role || null, firm: p.firm || null, email: p.email || null }))
        : [];
      const info: AddBriefInfo = { briefId: result.briefId, briefCreated: !!result.briefCreated, alreadyListed: !!result.alreadyListed, dealRef: result.dealRef ?? null, people };

      // The document's contents go onto a brief this step created, never
      // over one that was already there.
      let applied = false;
      if (extracted && info.briefCreated) {
        const patch: Record<string, any> = {};
        for (const k of TEXT_FIELDS) {
          const v = extracted[k];
          if (Array.isArray(v)) patch[k] = v.map(String).join(", ");
          else if (typeof v === "string" && v.trim()) patch[k] = v;
        }
        const commercials = normaliseCommercials(extracted.commercials).value;
        if (commercialsHaveContent(commercials)) patch.commercials = commercials;
        if (extracted.agencyBasis === "sole" || extracted.agencyBasis === "joint") patch.agencyBasis = extracted.agencyBasis;
        for (const k of ["minTargets", "priorityTargets"]) { const n = Number(extracted[k]); if (Number.isFinite(n) && n > 0) patch[k] = Math.round(n); }
        try {
          if (Object.keys(patch).length) await apiRequest("PATCH", `/api/unit-briefs/${info.briefId}`, patch);
          for (const t of Array.isArray(extracted.targets) ? extracted.targets : []) {
            if (t?.operatorName) { try { await apiRequest("POST", `/api/unit-briefs/${info.briefId}/targets`, t); } catch {} }
          }
          applied = true;
        } catch (e) {
          toast({ title: "The brief started, but the document's details were not all saved", description: serverMessage(e, "Open the brief and upload the document there."), variant: "destructive" });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      queryClient.invalidateQueries({ queryKey: ["/api/unit-briefs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      const title = !info.alreadyListed
        ? `Unit added to the tracker${info.dealRef ? `, Ref #${info.dealRef}` : ""}, and the brief started`
        : info.briefCreated ? "Brief started on the unit" : "That unit already has a brief. It is open now.";
      const description = extracted && !info.briefCreated ? "The uploaded document was not applied, so the existing brief is unchanged."
        : applied ? "The details from the client's document are on the brief. Check them, then add the people involved." : undefined;
      toast({ title, description });
      onStarted(result.unit as AvailableUnit, info);
      onOpenChange(false);
    } catch (e) {
      setError(serverMessage(e, "The brief could not be started."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="add-brief-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Target className="h-4 w-4" /> Add brief</DialogTitle>
          <DialogDescription>Puts the unit on the Letting Tracker and starts its targeting brief. The brief opens next, for the commercials, the people involved, plans and sign-off.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 min-w-0">
          <div className="rounded-lg border border-dashed p-3 space-y-2" data-testid="add-brief-document">
            <input ref={fileRef} type="file" accept=".pdf,.docx,.doc" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) readDocument(f); }} />
            {extracted ? (
              <div className="text-sm">
                <p className="font-medium break-words">{extractName}</p>
                <p className="text-xs text-muted-foreground" data-testid="add-brief-document-summary">{extractSummary}</p>
                <button type="button" className="text-xs underline text-muted-foreground hover:text-foreground" onClick={() => { setExtracted(null); setExtractName(""); }} data-testid="add-brief-document-remove">Remove the document</button>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Have the client's brief as a document? Upload it and the details below are filled in for you.</p>
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={reading || busy} data-testid="add-brief-upload">
                  {reading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                  {reading ? "Reading…" : "Upload the client's brief"}
                </Button>
              </>
            )}
          </div>

          <div className="space-y-1">
            <p className={MICRO_LABEL}>Scheme or property</p>
            <Popover open={propertyOpen} onOpenChange={setPropertyOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" role="combobox" aria-expanded={propertyOpen} className="w-full justify-between font-normal" disabled={busy} data-testid="add-brief-property">
                  <span className={`truncate ${property ? "" : "text-muted-foreground"}`}>{property?.name || (propertiesLoading ? "Loading…" : "Choose the scheme or property")}</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[min(28rem,calc(100vw-3rem))]" align="start">
                <Command>
                  <CommandInput placeholder="Search schemes and properties…" data-testid="add-brief-property-search" />
                  <CommandList className="max-h-[260px]">
                    <CommandEmpty>No property matches.</CommandEmpty>
                    <CommandGroup>
                      {sortedProperties.map(p => (
                        <CommandItem key={p.id} value={`${p.name} ${p.id}`} onSelect={() => { setPropertyId(p.id); setUnitKey(extracted?.unitName ? NEW_UNIT : ""); setPropertyOpen(false); }} data-testid={`add-brief-property-${p.id}`}>
                          <Check className={`h-3.5 w-3.5 mr-2 ${p.id === propertyId ? "opacity-100" : "opacity-0"}`} />
                          <span className="truncate">{p.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1">
            <p className={MICRO_LABEL}>Unit</p>
            <Popover open={unitOpen} onOpenChange={setUnitOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" role="combobox" aria-expanded={unitOpen} className="w-full justify-between font-normal" disabled={!propertyId || busy} data-testid="add-brief-unit">
                  <span className={`truncate ${unitKey ? "" : "text-muted-foreground"}`}>
                    {pickedUnit ? pickedUnit.unitName : isNew ? "A unit that is not listed" : !propertyId ? "Choose the scheme first" : unitsLoading ? "Loading units…" : "Choose the unit"}
                  </span>
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[min(28rem,calc(100vw-3rem))]" align="start">
                <Command>
                  <CommandInput placeholder="Search units…" data-testid="add-brief-unit-search" />
                  <CommandList className="max-h-[260px]">
                    <CommandEmpty>No unit matches. Use "A unit that is not listed".</CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="a unit that is not listed new" onSelect={() => { setUnitKey(NEW_UNIT); setUnitOpen(false); }} data-testid="add-brief-unit-new">
                        <Check className={`h-3.5 w-3.5 mr-2 ${isNew ? "opacity-100" : "opacity-0"}`} />
                        A unit that is not listed
                      </CommandItem>
                    </CommandGroup>
                    {sortedUnits.length > 0 && (
                      <CommandGroup heading={`On the tenancy schedule at ${property?.name || "this property"}`}>
                        {sortedUnits.map(u => (
                          <CommandItem key={u.unitName} value={`${u.unitName} ${u.tenantName || ""}`} onSelect={() => { setUnitKey(u.unitName); setUnitOpen(false); }} data-testid={`add-brief-unit-option-${u.unitName}`}>
                            <Check className={`h-3.5 w-3.5 mr-2 shrink-0 ${unitKey === u.unitName ? "opacity-100" : "opacity-0"}`} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{u.unitName}</span>
                              <span className="block text-[11px] text-muted-foreground truncate">{unitState(u)}</span>
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {isNew && (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_7rem_7rem] gap-2 pt-1.5" data-testid="add-brief-new-unit">
                <label className="block">
                  <span className={MICRO_LABEL}>Unit name</span>
                  <Input value={newUnit.unitName} onChange={e => setNewUnit(p => ({ ...p, unitName: e.target.value }))} placeholder="e.g. Unit L29A" disabled={busy} data-testid="add-brief-unit-name" />
                </label>
                <label className="block">
                  <span className={MICRO_LABEL}>Floor</span>
                  <Input value={newUnit.floor} onChange={e => setNewUnit(p => ({ ...p, floor: e.target.value }))} placeholder="Ground" disabled={busy} data-testid="add-brief-unit-floor" />
                </label>
                <label className="block">
                  <span className={MICRO_LABEL}>Size, sq ft</span>
                  <Input value={newUnit.sqft} onChange={e => setNewUnit(p => ({ ...p, sqft: e.target.value }))} inputMode="numeric" placeholder="2,500" className={`font-mono tabular-nums ${sqftBad ? "border-destructive" : ""}`} aria-invalid={sqftBad || undefined} disabled={busy} data-testid="add-brief-unit-sqft" />
                </label>
                {sqftBad && <p className="text-[11px] text-destructive sm:col-span-3">Size is a number of square feet, for example 2500.</p>}
              </div>
            )}

            {(pickedUnit || isNew) && (
              <p className="text-xs text-muted-foreground pt-1" data-testid="add-brief-outcome">
                {pickedUnit?.trackerRowId ? "This unit is already on the tracker; its brief opens."
                  : pickedUnit?.tenancyUnitId ? `The brief is tied to this unit on ${property?.name || "the property"}'s tenancy schedule. The unit goes on the tracker with a deal reference.`
                  : isNew ? `The unit is added to ${property?.name || "the property"}'s tenancy schedule and to the tracker with a deal reference, and its brief starts.`
                  : "The unit is added to the tracker with a deal reference, and its brief starts."}
              </p>
            )}
          </div>

          {error && <p className="text-sm text-destructive" role="alert" data-testid="add-brief-error">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={!ready || busy || reading} data-testid="add-brief-submit">
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Target className="h-4 w-4 mr-1" />}
            {busy ? "Adding…" : "Add brief"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

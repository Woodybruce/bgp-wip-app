// Add unit on the joint agent's tracker. One step puts a unit on the Letting
// Tracker (a BGP instruction with its deal reference, through the letting
// service) and starts its Targeting Brief: POST /api/unit-briefs/start, the
// same door the Add brief button on BGP's tracker uses. A unit already
// listed is reused, and so is its brief. The schemes and units offered are
// the caller's own (GET /api/landsec/tracker/pick-list).
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Target } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { LandsecTrackerPickList, LandsecTrackerPickUnit } from "@shared/landsec-tracker";
import { MICRO_LABEL, serverMessage, statusLabel, typedNumber, type TrackerUnitRef } from "./format";

const NEW_UNIT = "__new__";

const unitState = (u: LandsecTrackerPickUnit): string => {
  if (u.trackerUnitId) return `On the tracker, ${statusLabel(u.statusCode)}${u.dealRef ? `, Ref #${u.dealRef}` : ""}`;
  if (u.tenantName) return `Let to ${u.tenantName}`;
  return u.occupancy || "Not on the tracker";
};

export function AddUnitDialog({ open, onOpenChange, defaultPropertyId, onStarted }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultPropertyId?: string | null;
  onStarted: (unit: TrackerUnitRef) => void;   // the unit, to open its brief
}) {
  const { toast } = useToast();
  const [propertyId, setPropertyId] = useState("");
  const [unitKey, setUnitKey] = useState("");   // a unit name from the list, or NEW_UNIT
  const [search, setSearch] = useState("");
  const [newUnit, setNewUnit] = useState({ unitName: "", floor: "", sqft: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (id: string): Promise<LandsecTrackerPickList> => {
    const r = await fetch(`/api/landsec/tracker/pick-list${id ? `?propertyId=${encodeURIComponent(id)}` : ""}`, { credentials: "include", headers: getAuthHeaders() });
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || "The list could not be loaded");
    return r.json();
  };
  // The schemes, then the units of the one chosen.
  const { data: base, isLoading: propertiesLoading } = useQuery<LandsecTrackerPickList>({
    queryKey: ["/api/landsec/tracker/pick-list", ""], queryFn: () => load(""), enabled: open, staleTime: 60_000,
  });
  const { data: unitData, isLoading } = useQuery<LandsecTrackerPickList>({
    queryKey: ["/api/landsec/tracker/pick-list", propertyId], queryFn: () => load(propertyId), enabled: open && !!propertyId, staleTime: 15_000,
  });
  const properties = base?.properties || [];
  const units = propertyId ? unitData?.units || [] : [];

  useEffect(() => {
    if (!open) return;
    setPropertyId(defaultPropertyId || ""); setUnitKey(""); setSearch("");
    setNewUnit({ unitName: "", floor: "", sqft: "" }); setError(null); setBusy(false);
  }, [open, defaultPropertyId]);
  // One property on the login: it is the one.
  useEffect(() => {
    if (open && !propertyId && properties.length === 1) setPropertyId(properties[0].id);
  }, [open, propertyId, properties]);

  const property = properties.find(p => p.id === propertyId) || null;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? units.filter(u => `${u.unitName} ${u.tenantName || ""}`.toLowerCase().includes(q)) : units;
  }, [units, search]);
  const picked = unitKey && unitKey !== NEW_UNIT ? units.find(u => u.unitName === unitKey) || null : null;
  const isNew = unitKey === NEW_UNIT;
  const sqft = typedNumber(newUnit.sqft);
  const sqftBad = Number.isNaN(sqft);
  const ready = !!propertyId && (picked ? true : isNew && !!newUnit.unitName.trim() && !sqftBad);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      const body = picked?.trackerUnitId ? { trackerUnitId: picked.trackerUnitId }
        : picked?.tenancyUnitId ? { propertyId, tenancyUnitId: picked.tenancyUnitId }
        : picked ? { propertyId, unitName: picked.unitName }
        : { propertyId, unitName: newUnit.unitName.trim(), floor: newUnit.floor.trim() || null, sqft };
      const result = await (await apiRequest("POST", "/api/unit-briefs/start", body)).json();
      const ref = result?.dealRef ? `, Ref #${result.dealRef}` : "";
      toast({
        title: !result.alreadyListed ? `Unit added to the tracker${ref}, and the brief started`
          : result.briefCreated ? "Brief started on the unit" : "That unit already has a brief. It is open now.",
      });
      onStarted({ id: result.unit.id, unitName: result.unit.unitName, propertyId: result.unit.propertyId });
      onOpenChange(false);
    } catch (e) {
      setError(serverMessage(e, "The unit could not be added."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="ja-add-unit-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Target className="h-4 w-4" /> Add unit</DialogTitle>
          <DialogDescription>Puts the unit on the Letting Tracker with a deal reference and starts its targeting brief. The brief opens next, for the commercials, the people involved and sign-off.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 min-w-0">
          <div className="space-y-1">
            <p className={MICRO_LABEL}>Scheme</p>
            <Select value={propertyId} onValueChange={v => { setPropertyId(v); setUnitKey(""); setSearch(""); }} disabled={busy}>
              <SelectTrigger data-testid="ja-add-unit-property"><SelectValue placeholder={propertiesLoading ? "Loading…" : "Choose the scheme"} /></SelectTrigger>
              <SelectContent>
                {properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {propertyId && (
            <div className="space-y-1.5">
              <p className={MICRO_LABEL}>Unit</p>
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the tenancy schedule…" disabled={busy} data-testid="ja-add-unit-search" />
              <div className="max-h-56 overflow-y-auto rounded-md border border-border" role="listbox" aria-label="Units">
                <button type="button" role="option" aria-selected={isNew} onClick={() => setUnitKey(NEW_UNIT)} className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted ${isNew ? "bg-muted font-medium" : ""}`} data-testid="ja-add-unit-new">
                  A unit that is not listed
                </button>
                {isLoading && <p className="px-3 py-2 text-xs text-muted-foreground">Loading units…</p>}
                {shown.map(u => (
                  <button key={u.unitName} type="button" role="option" aria-selected={unitKey === u.unitName} onClick={() => setUnitKey(u.unitName)} className={`block w-full border-t border-border px-3 py-2 text-left hover:bg-muted ${unitKey === u.unitName ? "bg-muted" : ""}`} data-testid={`ja-add-unit-option-${u.unitName}`}>
                    <span className={`block truncate text-sm ${unitKey === u.unitName ? "font-medium" : ""}`}>{u.unitName}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{unitState(u)}</span>
                  </button>
                ))}
                {!isLoading && shown.length === 0 && search.trim() && <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">No unit matches. Use "A unit that is not listed".</p>}
              </div>

              {isNew && (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_7rem_7rem] gap-2 pt-1" data-testid="ja-add-unit-new-fields">
                  <label className="block">
                    <span className={MICRO_LABEL}>Unit name</span>
                    <Input value={newUnit.unitName} onChange={e => setNewUnit(p => ({ ...p, unitName: e.target.value }))} placeholder="e.g. Unit L29A" disabled={busy} data-testid="ja-add-unit-name" />
                  </label>
                  <label className="block">
                    <span className={MICRO_LABEL}>Floor</span>
                    <Input value={newUnit.floor} onChange={e => setNewUnit(p => ({ ...p, floor: e.target.value }))} placeholder="Ground" disabled={busy} data-testid="ja-add-unit-floor" />
                  </label>
                  <label className="block">
                    <span className={MICRO_LABEL}>Size, sq ft</span>
                    <Input value={newUnit.sqft} onChange={e => setNewUnit(p => ({ ...p, sqft: e.target.value }))} inputMode="numeric" placeholder="2,500" className={`font-mono tabular-nums ${sqftBad ? "border-destructive" : ""}`} aria-invalid={sqftBad || undefined} disabled={busy} data-testid="ja-add-unit-sqft" />
                  </label>
                  {sqftBad && <p className="text-[11px] text-destructive sm:col-span-3">Size is a number of square feet, for example 2500.</p>}
                </div>
              )}

              {(picked || isNew) && (
                <p className="text-xs text-muted-foreground" data-testid="ja-add-unit-outcome">
                  {picked?.trackerUnitId ? "This unit is already on the tracker; its brief opens."
                    : picked ? `The unit goes on the tracker with a deal reference, tied to its row on ${property?.name || "the property"}'s tenancy schedule, and its brief starts.`
                    : `The unit is added to ${property?.name || "the property"}'s tenancy schedule and to the tracker with a deal reference, and its brief starts.`}
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive" role="alert" data-testid="ja-add-unit-error">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={!ready || busy} data-testid="ja-add-unit-submit">
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Target className="h-4 w-4 mr-1" />}
            {busy ? "Adding…" : "Add unit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

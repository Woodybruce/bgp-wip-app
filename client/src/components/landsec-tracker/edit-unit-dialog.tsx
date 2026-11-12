// Edit unit on the joint agent's tracker: the unit's marketing fields and
// its status, through PATCH /api/available-units/:id. Only what was changed
// is sent, and only these fields: BGP's fee, the fee split, the landlord, the
// deal type and BGP's agents on the unit are not on this form in either
// direction. A status move runs the same gates and mirror as on BGP's tracker.
import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { LandsecTrackerUnit } from "@shared/landsec-tracker";
import { MICRO_LABEL, UNIT_STATUS_OPTIONS, serverMessage, statusLabel, typedNumber } from "./format";

interface Form {
  marketingStatus: string; unitName: string; floor: string; sqft: string;
  askingRent: string; rentPoa: boolean; serviceChargePa: string; ratesPa: string;
  availableDate: string; leaseTerms: string; useClass: string; condition: string; epcRating: string;
  notes: string; restrictions: string;
}
const NUMBER_FIELDS = ["sqft", "askingRent", "serviceChargePa", "ratesPa"] as const;
const TEXT_FIELDS = ["floor", "leaseTerms", "useClass", "condition", "epcRating", "notes", "restrictions"] as const;

const formOf = (u: LandsecTrackerUnit): Form => ({
  marketingStatus: u.statusCode, unitName: u.unitName, floor: u.floor || "", sqft: u.sqft != null ? String(u.sqft) : "",
  askingRent: u.askingRent != null ? String(u.askingRent) : "", rentPoa: u.rentPoa,
  serviceChargePa: u.serviceChargePa != null ? String(u.serviceChargePa) : "", ratesPa: u.ratesPa != null ? String(u.ratesPa) : "",
  availableDate: u.availableDate ? String(u.availableDate).slice(0, 7) : "", leaseTerms: u.leaseTerms || "",
  useClass: u.useClass || "", condition: u.condition || "", epcRating: u.epcRating || "",
  notes: u.notes || "", restrictions: u.restrictions || "",
});

export function EditUnitDialog({ unit, onClose, onSaved }: {
  unit: LandsecTrackerUnit | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setForm(unit ? formOf(unit) : null); setError(null); setBusy(false); }, [unit?.id]);
  if (!unit || !form) return null;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => (f ? { ...f, [k]: v } : f));
  const start = formOf(unit);
  const badNumber = NUMBER_FIELDS.find(k => Number.isNaN(typedNumber(form[k])));
  const statusOptions = UNIT_STATUS_OPTIONS.includes(unit.statusCode) ? UNIT_STATUS_OPTIONS : [unit.statusCode, ...UNIT_STATUS_OPTIONS];

  const save = async () => {
    if (busy || badNumber) return;
    if (!form.unitName.trim()) { setError("The unit needs a name."); return; }
    const patch: Record<string, unknown> = {};
    if (form.unitName.trim() !== start.unitName) patch.unitName = form.unitName.trim();
    for (const k of TEXT_FIELDS) if (form[k].trim() !== start[k]) patch[k] = form[k].trim() || null;
    for (const k of NUMBER_FIELDS) if (form[k].trim() !== start[k]) patch[k] = typedNumber(form[k]);
    if (form.rentPoa !== start.rentPoa) patch.rentPoa = form.rentPoa;
    if (form.availableDate !== start.availableDate) patch.availableDate = form.availableDate ? `${form.availableDate}-01` : null;
    if (form.marketingStatus !== start.marketingStatus) patch.marketingStatus = form.marketingStatus;
    if (Object.keys(patch).length === 0) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const saved = await (await apiRequest("PATCH", `/api/available-units/${unit.id}`, patch)).json();
      toast({ title: "Unit saved", description: saved?.mirrorWarning || undefined });
      onSaved();
      onClose();
    } catch (e) {
      setError(serverMessage(e, "The unit could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, node: ReactNode, className = "") => (
    <label className={`block min-w-0 ${className}`}><span className={MICRO_LABEL}>{label}</span>{node}</label>
  );
  const moneyInput = (k: (typeof NUMBER_FIELDS)[number], testId: string, placeholder = "0") => (
    <Input value={form[k]} onChange={e => set(k, e.target.value)} inputMode="decimal" placeholder={placeholder}
      className={`font-mono tabular-nums ${Number.isNaN(typedNumber(form[k])) ? "border-destructive" : ""}`} disabled={busy} data-testid={testId} />
  );

  return (
    <Dialog open onOpenChange={v => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" data-testid="ja-edit-unit-dialog">
        <DialogHeader>
          <DialogTitle>Edit unit</DialogTitle>
          <DialogDescription className="truncate">{unit.unitName} · {unit.propertyName}{unit.dealRef ? ` · Ref #${unit.dealRef}` : ""}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <span className={MICRO_LABEL}>Status</span>
              <Select value={form.marketingStatus} onValueChange={v => set("marketingStatus", v)} disabled={busy}>
                <SelectTrigger data-testid="ja-edit-unit-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statusOptions.map(c => <SelectItem key={c} value={c}>{statusLabel(c)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {field("Unit name", <Input value={form.unitName} onChange={e => set("unitName", e.target.value)} disabled={busy} data-testid="ja-edit-unit-name" />)}
          </div>
          {form.marketingStatus !== start.marketingStatus && (
            <p className="text-xs text-muted-foreground" data-testid="ja-edit-unit-status-note">
              {form.marketingStatus === "HOT" || form.marketingStatus === "SOL"
                ? "Heads of Terms and Solicitors are normally reached by issuing the Heads of Terms and converting them, which puts the agreed terms on the deal. Setting the status here moves the deal without them."
                : form.marketingStatus === "EXC" || form.marketingStatus === "COM" || form.marketingStatus === "WIT"
                  ? "This closes the letting: the unit moves under Historic."
                  : "The deal moves with the unit."}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            {field("Floor", <Input value={form.floor} onChange={e => set("floor", e.target.value)} placeholder="Ground" disabled={busy} data-testid="ja-edit-unit-floor" />)}
            {field("Size, sq ft", moneyInput("sqft", "ja-edit-unit-sqft", "2,500"))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {field("Quoting rent, £ a year", moneyInput("askingRent", "ja-edit-unit-rent"))}
            {field("Service charge, £ a year", moneyInput("serviceChargePa", "ja-edit-unit-service-charge"))}
            {field("Rates, £ a year", moneyInput("ratesPa", "ja-edit-unit-rates"))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.rentPoa} onCheckedChange={v => set("rentPoa", v === true)} disabled={busy} data-testid="ja-edit-unit-poa" />
            Rent on application
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field("Available from", <Input type="month" className="min-w-0" value={form.availableDate} onChange={e => set("availableDate", e.target.value)} disabled={busy} data-testid="ja-edit-unit-available" />)}
            {field("Lease terms", <Input value={form.leaseTerms} onChange={e => set("leaseTerms", e.target.value)} placeholder="e.g. New lease, terms by negotiation" disabled={busy} data-testid="ja-edit-unit-lease-terms" />)}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {field("Use class", <Input value={form.useClass} onChange={e => set("useClass", e.target.value)} placeholder="E(b)" disabled={busy} data-testid="ja-edit-unit-use-class" />)}
            {field("Condition", <Input value={form.condition} onChange={e => set("condition", e.target.value)} placeholder="Shell & Core" disabled={busy} data-testid="ja-edit-unit-condition" />)}
            {field("EPC", <Input value={form.epcRating} onChange={e => set("epcRating", e.target.value)} placeholder="B" disabled={busy} data-testid="ja-edit-unit-epc" />)}
          </div>

          {field("Notes", <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} disabled={busy} data-testid="ja-edit-unit-notes" />)}
          {field("Restrictions", <Textarea value={form.restrictions} onChange={e => set("restrictions", e.target.value)} rows={2} disabled={busy} data-testid="ja-edit-unit-restrictions" />)}

          {badNumber && <p className="text-xs text-destructive">Size, rent, service charge and rates are numbers, for example 95000.</p>}
          {error && <p className="text-sm text-destructive" role="alert" data-testid="ja-edit-unit-error">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={save} disabled={busy || !!badNumber} data-testid="ja-edit-unit-save">
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

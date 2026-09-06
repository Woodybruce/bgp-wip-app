import { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

// ============================================================================
// UnifiedAddUnitDialog — Stage 3b of the unit-spine cleanup.
//
// One dialog, two entry points (Letting Tracker + Tenancy Schedule). The form
// is deliberately SMALLER than the legacy UnitFormDialog: it captures only what
// matters at Add-time. Fee splits, AML and deal terms are gathered at
// Solicitors promotion (the existing WIP flow) — that's the whole point of the
// "deal at SOL" architecture.
//
// Marketing toggle drives the destination:
//   marketingActive = true   → POST /api/available-units      (Tracker pipeline)
//   marketingActive = false  → POST /api/tenancy-schedule/unit (lease-only row)
//
// Existing server endpoints; no new API surface for Stage 3b.
//
// Mounted behind VITE_UNIFIED_ADD_UNIT=1. When flag is off, callers fall back
// to the legacy UnitFormDialog (Tracker) and AddTenancyUnitForm (Tenancy).
// ============================================================================

type Mode = "tracker" | "tenancy";

interface PropertyLite {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: Mode;
  /** Lock the property picker to this id (e.g. on a property's tenancy schedule). */
  fixedPropertyId?: string;
  /** Called after a successful save. Use to invalidate caches and toast. */
  onSaved?: (result: { id: string; mode: Mode }) => void;
}

interface FormState {
  propertyId: string;
  unitName: string;
  floor: string;
  sqft: string;
  marketingActive: boolean;
  // marketing branch
  askingRent: string;
  useClass: string;
  epcRating: string;
  // tenancy branch (sitting tenant)
  tenantName: string;
  tradingName: string;
  leaseStart: string;
  leaseExpiry: string;
  passingRentPa: string;
  // shared notes
  notes: string;
}

const empty = (mode: Mode, fixedPropertyId?: string): FormState => ({
  propertyId: fixedPropertyId || "",
  unitName: "",
  floor: "",
  sqft: "",
  // Tracker default: marketing. Tenancy default: not marketing (lease record).
  marketingActive: mode === "tracker",
  askingRent: "",
  useClass: "",
  epcRating: "",
  tenantName: "",
  tradingName: "",
  leaseStart: "",
  leaseExpiry: "",
  passingRentPa: "",
  notes: "",
});

export function UnifiedAddUnitDialog({ open, onOpenChange, mode, fixedPropertyId, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(empty(mode, fixedPropertyId));
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Reset when re-opened so a previous draft doesn't leak across uses.
  useEffect(() => {
    if (open) setForm(empty(mode, fixedPropertyId));
  }, [open, mode, fixedPropertyId]);

  const upd = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Property picker — only shown when fixedPropertyId is absent. Lightweight
  // fetch; properties endpoint is already cached app-wide so this is usually
  // an instant hit.
  const { data: properties = [] } = useQuery<PropertyLite[]>({
    queryKey: ["/api/crm/properties"],
    queryFn: async () => {
      const r = await fetch("/api/crm/properties", { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      const json = await r.json();
      return Array.isArray(json) ? json : (json?.data || []);
    },
    enabled: open && !fixedPropertyId,
    staleTime: 60_000,
  });

  const propertyName = useMemo(() => {
    const id = form.propertyId;
    if (!id) return "";
    return properties.find((p) => p.id === id)?.name || "";
  }, [form.propertyId, properties]);

  const mutation = useMutation({
    mutationFn: async () => {
      const sqftNum = form.sqft ? parseFloat(form.sqft) : null;
      if (form.marketingActive) {
        // Tracker path: POST /api/available-units writes property_units +
        // available_units + leasing_schedule + mirrors to tenancy.
        // With UNIFIED_ADD_UNIT=1 on the server it does NOT auto-create a
        // deal — the deal is born at Solicitors promotion.
        const body: any = {
          propertyId: form.propertyId,
          unitName: form.unitName.trim(),
          floor: form.floor || null,
          sqft: sqftNum,
          askingRent: form.askingRent ? parseFloat(form.askingRent) : null,
          useClass: form.useClass || null,
          epcRating: form.epcRating || null,
          marketingStatus: "Available",
          notes: form.notes || null,
        };
        const res = await apiRequest("POST", "/api/available-units", body);
        const json = await res.json();
        return { id: json?.id, mode };
      } else {
        // Tenancy path: POST /api/tenancy-schedule/unit writes the spine row
        // directly. Auto-knits to sibling tables on the same property by
        // matching unit name. No deal, no available_units row.
        const body: any = {
          property_id: form.propertyId,
          unit_number: form.unitName.trim(),
          floor_level: form.floor || null,
          nia_sqft: sqftNum,
          permitted_use: form.useClass || null,
          epc_rating: form.epcRating || null,
          tenant_name: form.tenantName || null,
          trading_name: form.tradingName || null,
          lease_start: form.leaseStart || null,
          lease_expiry: form.leaseExpiry || null,
          passing_rent_pa: form.passingRentPa ? parseFloat(form.passingRentPa) : null,
          comments: form.notes || null,
          // occupancy_status follows the two-axis model from Stage 1: a row
          // with a sitting tenant is Trading, otherwise Vacant.
          status: form.tenantName && form.tenantName !== "Vacant" ? "Occupied" : "Vacant",
        };
        const res = await apiRequest("POST", "/api/tenancy-schedule/unit", body);
        const json = await res.json();
        return { id: json?.id, mode };
      }
    },
    onSuccess: (result) => {
      // Invalidate the caches both surfaces could be reading.
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property"] });
      queryClient.invalidateQueries({ queryKey: ["/api/property-units"] });
      toast({ title: "Unit added" });
      onOpenChange(false);
      onSaved?.(result as any);
    },
    onError: (e: any) => {
      toast({ title: "Couldn't save", description: e?.message || "Try again", variant: "destructive" });
    },
  });

  const canSubmit =
    !!form.propertyId && !!form.unitName.trim() && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Unit</DialogTitle>
          <DialogDescription>
            {form.marketingActive
              ? "Lands on the Letting Tracker. Deal is created at Solicitors promotion."
              : "Lands on the Tenancy Schedule. No deal until you mark it for marketing."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Marketing toggle — the single bit that picks which board this lives on. */}
          <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Being marketed</div>
              <div className="text-[11px] text-muted-foreground">
                {form.marketingActive
                  ? "On the Letting Tracker — visible to the agency team."
                  : "Tenancy record only — no marketing yet."}
              </div>
            </div>
            <Switch
              checked={form.marketingActive}
              onCheckedChange={(v) => upd("marketingActive", v)}
              data-testid="unified-add-marketing-toggle"
            />
          </div>

          {/* Property — locked when caller passed a fixedPropertyId. */}
          {fixedPropertyId ? (
            <div>
              <Label className="text-xs">Property</Label>
              <Input value={propertyName || "(this property)"} disabled className="h-9 mt-1" />
            </div>
          ) : (
            <div>
              <Label className="text-xs" htmlFor="unified-property">Property *</Label>
              <Select value={form.propertyId} onValueChange={(v) => upd("propertyId", v)}>
                <SelectTrigger className="h-9 mt-1" id="unified-property" data-testid="unified-property-select">
                  <SelectValue placeholder="Pick a property" />
                </SelectTrigger>
                <SelectContent>
                  {properties.slice(0, 200).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Core unit fields — shared between both modes. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs" htmlFor="unified-unitname">Unit name / number *</Label>
              <Input
                id="unified-unitname"
                value={form.unitName}
                onChange={(e) => upd("unitName", e.target.value)}
                placeholder="e.g. Unit 4"
                className="h-9 mt-1"
                data-testid="unified-unit-name"
              />
            </div>
            <div>
              <Label className="text-xs" htmlFor="unified-floor">Floor</Label>
              <Input
                id="unified-floor"
                value={form.floor}
                onChange={(e) => upd("floor", e.target.value)}
                placeholder="Ground / 1st / Bsmt"
                className="h-9 mt-1"
              />
            </div>
            <div>
              <Label className="text-xs" htmlFor="unified-sqft">Size (sq ft)</Label>
              <Input
                id="unified-sqft"
                type="number"
                value={form.sqft}
                onChange={(e) => upd("sqft", e.target.value)}
                className="h-9 mt-1"
              />
            </div>
            <div>
              <Label className="text-xs" htmlFor="unified-useclass">Use class</Label>
              <Input
                id="unified-useclass"
                value={form.useClass}
                onChange={(e) => upd("useClass", e.target.value)}
                placeholder="E / Sui Generis"
                className="h-9 mt-1"
              />
            </div>
            <div>
              <Label className="text-xs" htmlFor="unified-epc">EPC rating</Label>
              <Input
                id="unified-epc"
                value={form.epcRating}
                onChange={(e) => upd("epcRating", e.target.value)}
                placeholder="A–G"
                className="h-9 mt-1"
              />
            </div>
          </div>

          {/* Marketing branch — only when being marketed. Light: asking rent.
              Other marketing details (viewings, offers, fee split, agents) are
              captured on the Tracker row + the SOL promotion form. */}
          {form.marketingActive && (
            <div className="rounded-lg border p-3 space-y-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Marketing</div>
              <div>
                <Label className="text-xs" htmlFor="unified-asking">Asking rent (£ p.a.)</Label>
                <Input
                  id="unified-asking"
                  type="number"
                  value={form.askingRent}
                  onChange={(e) => upd("askingRent", e.target.value)}
                  className="h-9 mt-1"
                />
              </div>
            </div>
          )}

          {/* Tenancy branch — only when NOT being marketed. Captures the
              sitting tenant + lease dates so the spine row is born complete. */}
          {!form.marketingActive && (
            <div className="rounded-lg border p-3 space-y-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sitting tenant</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs" htmlFor="unified-tenant">Tenant name</Label>
                  <Input
                    id="unified-tenant"
                    value={form.tenantName}
                    onChange={(e) => upd("tenantName", e.target.value)}
                    placeholder="Leave blank if Vacant"
                    className="h-9 mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="unified-trading">Trading name</Label>
                  <Input
                    id="unified-trading"
                    value={form.tradingName}
                    onChange={(e) => upd("tradingName", e.target.value)}
                    className="h-9 mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="unified-lease-start">Lease start</Label>
                  <Input
                    id="unified-lease-start"
                    type="date"
                    value={form.leaseStart}
                    onChange={(e) => upd("leaseStart", e.target.value)}
                    className="h-9 mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="unified-lease-expiry">Lease expiry</Label>
                  <Input
                    id="unified-lease-expiry"
                    type="date"
                    value={form.leaseExpiry}
                    onChange={(e) => upd("leaseExpiry", e.target.value)}
                    className="h-9 mt-1"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor="unified-passing">Passing rent (£ p.a.)</Label>
                  <Input
                    id="unified-passing"
                    type="number"
                    value={form.passingRentPa}
                    onChange={(e) => upd("passingRentPa", e.target.value)}
                    className="h-9 mt-1"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Notes — shared. */}
          <div>
            <Label className="text-xs" htmlFor="unified-notes">Notes</Label>
            <Textarea
              id="unified-notes"
              value={form.notes}
              onChange={(e) => upd("notes", e.target.value)}
              className="mt-1 min-h-[60px]"
              placeholder="Anything worth recording at add-time."
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            data-testid="unified-add-save"
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Read the client-side feature flag. Server-side flag is UNIFIED_ADD_UNIT. */
export const UNIFIED_ADD_UNIT_ENABLED =
  // import.meta.env.VITE_UNIFIED_ADD_UNIT is set at build time by Vite.
  // Any truthy string ("1", "true") turns it on.
  !!import.meta.env.VITE_UNIFIED_ADD_UNIT &&
  String(import.meta.env.VITE_UNIFIED_ADD_UNIT) !== "0" &&
  String(import.meta.env.VITE_UNIFIED_ADD_UNIT).toLowerCase() !== "false";

// Convert to Solicitors, and what it made: the last step of the Heads of
// Terms workspace. The form starts from the agreed offer; BGP checks the
// tenant and the terms, then the deal moves to Solicitors and AML starts.
import { useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EntityCombobox } from "@/components/entity-combobox";
import { Kyc4uRequestButton } from "@/components/kyc4u-panel";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { HotsConversion, HotsConvertDefaults } from "@shared/unit-hots";
import { MICRO_LABEL, TONE_GOOD, TONE_WARN } from "./hots-api";

export interface HotsConvertBody {
  tenantCompanyId: string;
  rentPa: string;
  leaseLengthYears: string;
  rentFreeMonths: string;
  breakOption: string;
  capitalContribution: string;
}

const str = (n: number | null | undefined): string => (n === null || n === undefined ? "" : String(n));

export function HotsConvertForm({ defaults, busy, onConvert }: {
  defaults: HotsConvertDefaults;
  busy: boolean;
  onConvert: (body: HotsConvertBody) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<HotsConvertBody>({
    tenantCompanyId: defaults.tenantCompanyId || "",
    rentPa: str(defaults.rentPa),
    leaseLengthYears: str(defaults.leaseLengthYears),
    rentFreeMonths: str(defaults.rentFreeMonths),
    breakOption: defaults.breakOption || "",
    capitalContribution: str(defaults.capitalContribution),
  });
  const set = (k: keyof HotsConvertBody, v: string) => setForm(f => ({ ...f, [k]: v }));
  const companies = useQuery<{ id: string; name: string }[]>({ queryKey: ["/api/crm/companies"] });
  // A company made here is not in the list until it is read again.
  const created = useRef<{ id: string; label: string } | null>(null);
  const items = (companies.data || []).map(c => ({ id: String(c.id), label: c.name }));
  if (created.current && !items.some(i => i.id === created.current!.id)) items.push(created.current);
  if (defaults.tenantCompanyId && defaults.tenantName && !items.some(i => i.id === defaults.tenantCompanyId)) items.push({ id: defaults.tenantCompanyId, label: defaults.tenantName });

  const createCompany = async (name: string) => {
    try {
      const made = await (await apiRequest("POST", "/api/crm/companies", { name: name.trim() })).json();
      const item = { id: String(made.id), label: String(made.name) };
      created.current = item;
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      toast({ title: "Company added to the CRM", description: item.label });
      return item;
    } catch (e) {
      toast({ title: "Company not added", description: e instanceof Error ? e.message.replace(/^\d{3}:\s*/, "") : "Try again.", variant: "destructive" });
      throw e;
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !form.tenantCompanyId) return;
    onConvert(form);
  };
  const unlinked = !defaults.tenantCompanyId && !!defaults.tenantName;

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border p-3" data-testid="hots-convert-form">
      <div>
        <h3 className="text-sm font-semibold">Convert to Solicitors</h3>
        <p className="text-xs text-muted-foreground">
          This puts the agreed terms on the deal, moves the unit and the deal to Solicitors and starts AML. Check the figures against the final Heads of Terms.
        </p>
      </div>
      <div className="space-y-1">
        <Label className={MICRO_LABEL}>Tenant company</Label>
        <EntityCombobox
          items={items}
          value={form.tenantCompanyId}
          onChange={id => set("tenantCompanyId", id)}
          placeholder="Pick the tenant from the CRM"
          ariaLabel="Tenant company"
          searchPlaceholder="Search companies"
          loading={companies.isLoading}
          testId="hots-convert-tenant"
          onCreate={createCompany}
          createLabel="company"
        />
        {unlinked && !form.tenantCompanyId && (
          <p className={`text-xs ${TONE_WARN}`} data-testid="hots-convert-unlinked">
            The offer names {defaults.tenantName}, which is not linked to a CRM company. Pick the company, or type its name to add it.
          </p>
        )}
        {!unlinked && !form.tenantCompanyId && <p className="text-xs text-muted-foreground">Pick the tenant so AML can start.</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="hots-convert-rent" className={MICRO_LABEL}>Rent a year</Label>
          <Input id="hots-convert-rent" inputMode="decimal" className="font-mono tabular-nums" value={form.rentPa} onChange={e => set("rentPa", e.target.value)} placeholder="110000" data-testid="hots-convert-rent" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hots-convert-capital" className={MICRO_LABEL}>Capital contribution</Label>
          <Input id="hots-convert-capital" inputMode="decimal" className="font-mono tabular-nums" value={form.capitalContribution} onChange={e => set("capitalContribution", e.target.value)} placeholder="0" data-testid="hots-convert-capital" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hots-convert-term" className={MICRO_LABEL}>Lease length, years</Label>
          <Input id="hots-convert-term" inputMode="decimal" className="font-mono tabular-nums" value={form.leaseLengthYears} onChange={e => set("leaseLengthYears", e.target.value)} placeholder="10" data-testid="hots-convert-term" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hots-convert-rent-free" className={MICRO_LABEL}>Rent free, months</Label>
          <Input id="hots-convert-rent-free" inputMode="decimal" className="font-mono tabular-nums" value={form.rentFreeMonths} onChange={e => set("rentFreeMonths", e.target.value)} placeholder="0" data-testid="hots-convert-rent-free" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="hots-convert-break" className={MICRO_LABEL}>Break</Label>
          <Input id="hots-convert-break" value={form.breakOption} maxLength={500} onChange={e => set("breakOption", e.target.value)} placeholder="For example: tenant break at year 5" data-testid="hots-convert-break" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">A figure left blank is taken from the agreed offer. Where the offer has none, the deal keeps what it has. Fees are not changed.</p>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || !form.tenantCompanyId} data-testid="hots-convert-submit">
          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Convert to Solicitors
        </Button>
      </div>
    </form>
  );
}

export function HotsConversionResult({ conversion, isStaff }: { conversion: HotsConversion; isStaff: boolean }) {
  const ref = conversion.dealRef !== null && conversion.dealRef !== undefined ? `#${conversion.dealRef}` : "";
  return (
    <div className="space-y-2.5 rounded-lg border p-3" data-testid="hots-conversion">
      <p className={`flex items-start gap-1.5 text-sm font-semibold ${TONE_GOOD}`} data-testid="hots-conversion-title">
        <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Deal <span className="font-mono tabular-nums">{ref}</span> is now at Solicitors</span>
      </p>
      {conversion.tenantName && <p className="text-sm">Tenant: {conversion.tenantName}</p>}
      {conversion.dealUrl && (
        <a href={conversion.dealUrl} className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline" data-testid="hots-conversion-deal-link">
          Open the deal page <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      {conversion.statusWarning && (
        <p className={`flex items-start gap-1.5 text-xs ${TONE_WARN}`} data-testid="hots-conversion-warning">
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> {conversion.statusWarning}
        </p>
      )}
      <div className="space-y-1.5 border-t pt-2.5">
        <p className={MICRO_LABEL}>AML</p>
        {conversion.aml.ok ? (
          <p className={`flex items-start gap-1.5 text-sm ${TONE_GOOD}`} data-testid="hots-conversion-aml">
            <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> AML is complete for the landlord and the tenant.
          </p>
        ) : (
          <p className={`flex items-start gap-1.5 text-sm ${TONE_WARN}`} data-testid="hots-conversion-aml">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {conversion.aml.message || "AML is not complete yet."}
          </p>
        )}
        {isStaff && conversion.tenantCompanyId && conversion.tenantName && (
          <Kyc4uRequestButton dealId={conversion.dealId} companyId={conversion.tenantCompanyId} role="tenant" partyName={conversion.tenantName} />
        )}
      </div>
    </div>
  );
}

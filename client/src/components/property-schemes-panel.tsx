// Schemes editor on a property page (staff). An estate or centre split into
// named schemes — Canary Wharf: Jubilee Place, Cabot Place, Crossrail
// Place… — each with the landlord entity its invoices go to, the inbox
// they're sent to, the landlord's own property code and its SharePoint
// folder. Units carry the scheme name as their zone; renaming a scheme here
// relabels them. Labels already on the schedule but not yet a scheme are
// offered as one-click adds.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineText } from "@/components/inline-edit";
import { CrmEntityPicker } from "@/components/crm-entity-picker";
import { ExternalLink, Layers, Plus, Trash2 } from "lucide-react";
import { unitScheme } from "@shared/property-schemes";

export type PropertySchemeRow = {
  id: string; name: string; code?: string | null; billingEntityId?: string | null; billingEntityName?: string | null;
  invoicingEmail?: string | null; sharepointFolderUrl?: string | null; sortOrder?: number | null; unitCount?: number;
};

export function usePropertySchemeList(propertyId: string | null | undefined) {
  return useQuery<{ schemes: PropertySchemeRow[]; unmatchedLabels: Array<{ label: string; count: number }> }>({
    queryKey: ["/api/properties", propertyId, "schemes"],
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/schemes`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return { schemes: [], unmatchedLabels: [] };
      return r.json();
    },
    enabled: !!propertyId,
    staleTime: 60_000,
  });
}

const microLabel = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

export function PropertySchemesPanel({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const { data, isLoading } = usePropertySchemeList(propertyId);
  const [newName, setNewName] = useState("");
  const { data: companies = [] } = useQuery<Array<{ id: string; name: string; meta: string | null }>>({
    queryKey: ["/api/crm/companies-basic"],
    queryFn: async () => {
      const res = await fetch("/api/crm/companies?limit=5000", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const d = await res.json();
      return (Array.isArray(d) ? d : (d.companies || [])).map((c: any) => ({ id: String(c.id), name: c.name, meta: c.companyType || c.company_type || null }));
    },
    staleTime: 120_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "schemes"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
    queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
  };
  const add = useMutation({
    mutationFn: async (name: string) => (await apiRequest("POST", `/api/properties/${propertyId}/schemes`, { name })).json(),
    onSuccess: (s: any) => { setNewName(""); refresh(); toast({ title: `Added ${s.name}` }); },
    onError: (e: any) => toast({ title: "Couldn't add the scheme", description: e?.message, variant: "destructive" }),
  });
  const save = async (id: string, patch: Record<string, unknown>) => {
    try {
      const out = await (await apiRequest("PUT", `/api/properties/${propertyId}/schemes/${id}`, patch)).json();
      refresh();
      if (out?.relabelled) toast({ title: "Scheme renamed", description: `${out.relabelled} unit and deal labels updated.` });
    } catch (e: any) {
      toast({ title: "Couldn't save", description: e?.message, variant: "destructive" });
      throw e;
    }
  };
  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/properties/${propertyId}/schemes/${id}`),
    onSuccess: () => { refresh(); toast({ title: "Scheme removed", description: "Units keep their zone label." }); },
    onError: (e: any) => toast({ title: "Couldn't remove the scheme", description: e?.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>;
  const schemes = data?.schemes || [];
  const suggestions = data?.unmatchedLabels || [];

  return (
    <div className="space-y-3" data-testid="property-schemes-panel">
      {schemes.length === 0 && (
        <div className="text-center py-3">
          <Layers className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
          <p className="text-xs text-muted-foreground">No schemes yet — add one if this estate invoices each part to its own landlord entity.</p>
        </div>
      )}
      {schemes.map(s => (
        <div key={s.id} className="rounded-lg border border-border p-2.5 space-y-2" data-testid={`scheme-${s.id}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <InlineText value={s.name} onSave={(v) => save(s.id, { name: v })} label="Scheme name" className="text-sm font-semibold" />
              <p className="text-[11px] text-muted-foreground"><span className="font-mono tabular-nums">{s.unitCount || 0}</span> units</p>
            </div>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground" title="Remove scheme" aria-label="Remove scheme"
              onClick={() => { if (confirm(`Remove ${s.name}? Units keep their zone label.`)) remove.mutate(s.id); }} data-testid={`scheme-delete-${s.id}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="min-w-0">
              <div className={microLabel}>Invoices to</div>
              <CrmEntityPicker
                value={s.billingEntityId || null}
                valueName={s.billingEntityName || null}
                options={companies}
                kind="company"
                searchPlaceholder="Search landlord entity…"
                emptyLabel="Set landlord entity"
                testIdPrefix={`scheme-entity-${s.id}`}
                onSelect={(opt) => { save(s.id, { billingEntityId: opt.id }).catch(() => {}); }}
                onClear={s.billingEntityId ? () => { save(s.id, { billingEntityId: null }).catch(() => {}); } : undefined}
              />
            </div>
            <div className="min-w-0">
              <div className={microLabel}>Invoicing email</div>
              <InlineText value={s.invoicingEmail || ""} onSave={(v) => save(s.id, { invoicingEmail: v })} label="Invoicing email" placeholder="Set email" className="text-sm truncate block" />
            </div>
            <div className="min-w-0">
              <div className={microLabel}>Landlord code</div>
              <InlineText value={s.code || ""} onSave={(v) => save(s.id, { code: v })} label="Landlord property code" placeholder="e.g. Yardi 294" className="text-sm font-mono" />
            </div>
            <div className="min-w-0">
              <div className={`${microLabel} flex items-center gap-1`}>
                SharePoint folder
                {s.sharepointFolderUrl && <a href={s.sharepointFolderUrl} target="_blank" rel="noopener noreferrer" title="Open in SharePoint"><ExternalLink className="w-3 h-3" /></a>}
              </div>
              <InlineText value={s.sharepointFolderUrl || ""} display={s.sharepointFolderUrl ? "Linked" : ""} onSave={(v) => save(s.id, { sharepointFolderUrl: v })} label="SharePoint folder link" placeholder="Paste folder link" className="text-sm truncate block" />
            </div>
          </div>
        </div>
      ))}
      {suggestions.length > 0 && (
        <div className="space-y-1">
          <div className={microLabel}>On the schedule, not yet a scheme</div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.slice(0, 12).map(sug => (
              <Pill key={sug.label} onClick={() => add.mutate(sug.label)} disabled={add.isPending} data-testid="scheme-suggestion">
                <Plus className="w-3 h-3" />{sug.label} <span className="font-mono tabular-nums">{sug.count}</span>
              </Pill>
            ))}
          </div>
        </div>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) add.mutate(newName.trim()); }}>
        <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New scheme, e.g. Jubilee Place" className="h-8 text-sm" data-testid="input-new-scheme" />
        <Button type="submit" size="sm" variant="outline" disabled={!newName.trim() || add.isPending} data-testid="button-add-scheme"><Plus className="w-3.5 h-3.5 mr-1" />Add scheme</Button>
      </form>
    </div>
  );
}

/** Does a unit / deal pass the scheme filter? Its scheme is its label, else
 *  the scheme its name mentions. `value` is a scheme name, "" for all,
 *  "__none__" for units in no scheme. */
export function schemeFilterMatches(schemes: Array<{ name: string }>, label: string | null | undefined, value: string, unitName?: string | null): boolean {
  if (!value) return true;
  const hit = unitScheme(schemes, label, unitName);
  return value === "__none__" ? !hit : hit?.name === value;
}

/** Pill row of a property's schemes with counts: the filter every board on
 *  an estate shares. Renders nothing on a property without schemes. */
export function SchemePillRow({ schemes, items, value, onChange, testId = "scheme-pills" }: {
  schemes: Array<{ name: string }>;
  items: Array<{ label: string | null | undefined; name?: string | null }>;
  value: string;
  onChange: (v: string) => void;
  testId?: string;
}) {
  if (!schemes.length) return null;
  const counts = new Map<string, number>();
  let none = 0;
  for (const item of items) {
    const hit = unitScheme(schemes, item.label, item.name);
    if (hit) counts.set(hit.name, (counts.get(hit.name) || 0) + 1); else none++;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Scheme filter" data-testid={testId}>
      <Pill active={!value} onClick={() => onChange("")}>All schemes <span className="font-mono tabular-nums">{items.length}</span></Pill>
      {schemes.map(s => (
        <Pill key={s.name} active={value === s.name} onClick={() => onChange(value === s.name ? "" : s.name)}>
          {s.name} <span className="font-mono tabular-nums">{counts.get(s.name) || 0}</span>
        </Pill>
      ))}
      {none > 0 && (
        <Pill active={value === "__none__"} onClick={() => onChange(value === "__none__" ? "" : "__none__")}>No scheme <span className="font-mono tabular-nums">{none}</span></Pill>
      )}
    </div>
  );
}


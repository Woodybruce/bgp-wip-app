import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Landmark, Loader2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";

type CrmHit = { id: string; name: string; companyType?: string | null };
type ChHit = { companyNumber: string; title: string; companyStatus?: string | null; addressSnippet?: string | null };

// Find a company to link (Woody, 2026-11-14: "all of these pills need search
// and then add / look up"). Three steps in one box: the CRM, searched on the
// server (so a long directory is searched, not the first page of it); then
// Companies House; then "Add as a new company". A pick from Companies House
// or a new name is made a CRM company of `companyType` first, then linked.
// A client login searches its own list only: the server refuses it a
// landlord or lender company, so it is not offered one.
export function CompanyLinkPicker({ companyType, onPick, initial = [], placeholder = "Search companies…" }: {
  companyType: string;
  onPick: (companyId: string, name: string) => void;
  initial?: CrmHit[];
  placeholder?: string;
}) {
  const { toast } = useToast();
  const [term, setTerm] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setQ(term.trim()), 250); return () => clearTimeout(t); }, [term]);
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const staff = !!me && me.role !== "Client" && !me.companyScopeId;

  const crm = useQuery<CrmHit[]>({
    queryKey: ["/api/crm/companies", "picker", q],
    enabled: q.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const r = await fetch(`/api/crm/companies?search=${encodeURIComponent(q)}&limit=12&fields=id,name,companyType`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      const d = await r.json();
      const rows = Array.isArray(d) ? d : (d.companies || d.items || []);
      return rows.map((c: any) => ({ id: String(c.id), name: c.name, companyType: c.companyType ?? c.company_type ?? null }));
    },
  });
  const ch = useQuery<ChHit[]>({
    queryKey: ["/api/companies-house/search", q],
    enabled: staff && q.length >= 3,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const r = await fetch(`/api/companies-house/search?q=${encodeURIComponent(q)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      return (await r.json()).items || [];
    },
  });

  const create = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    try {
      const res = await apiRequest("POST", "/api/crm/companies", { companyType, ...body });
      const made = await res.json();
      onPick(String(made.id), String(made.name || body.name));
    } catch (e: any) {
      toast({ title: "Couldn't add the company", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const crmRows = q.length >= 2 ? (crm.data || []) : initial.slice(0, 20);
  const crmNames = new Set(crmRows.map(c => c.name.trim().toLowerCase()));
  const chRows = (ch.data || []).filter(c => !crmNames.has(c.title.trim().toLowerCase())).slice(0, 6);
  const exact = crmNames.has(q.toLowerCase());
  const row = "w-full text-left px-2 py-1.5 text-xs hover:bg-muted rounded flex items-start gap-2 disabled:opacity-50";

  return (
    <div className="w-72 space-y-1" onKeyDown={e => e.stopPropagation()} data-testid="company-link-picker">
      <div className="p-1.5"><Input autoFocus value={term} onChange={e => setTerm(e.target.value)} placeholder={placeholder} className="h-8 text-xs" data-testid="company-link-picker-input" /></div>
      <div className="max-h-72 overflow-y-auto px-1 pb-1 space-y-0.5">
        {q.length >= 2 && <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">In the CRM</p>}
        {crm.isFetching && q.length >= 2 && !crm.data ? <p className="px-2 py-1 text-xs text-muted-foreground">Searching…</p>
          : crmRows.length === 0 ? (q.length >= 2 ? <p className="px-2 py-1 text-xs text-muted-foreground">Nothing in the CRM by that name</p> : null)
          : crmRows.map(c => (
            <button key={c.id} type="button" className={row} disabled={!!busy} onClick={() => onPick(c.id, c.name)}>
              <Building2 className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
              <span className="min-w-0"><span className="block truncate font-medium">{c.name}</span>{c.companyType && <span className="block text-[10px] text-muted-foreground truncate">{c.companyType}</span>}</span>
            </button>
          ))}
        {staff && q.length >= 3 && (ch.isFetching || chRows.length > 0) && <p className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Companies House</p>}
        {staff && q.length >= 3 && ch.isFetching && !ch.data && <p className="px-2 py-1 text-xs text-muted-foreground">Looking up…</p>}
        {staff && chRows.map(c => (
          <button key={c.companyNumber} type="button" className={row} disabled={!!busy}
            onClick={() => create(`ch:${c.companyNumber}`, { name: c.title, companiesHouseNumber: c.companyNumber })}
            title="Add to the CRM with its Companies House number, then link it">
            {busy === `ch:${c.companyNumber}` ? <Loader2 className="w-3.5 h-3.5 mt-0.5 animate-spin shrink-0" /> : <Landmark className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />}
            <span className="min-w-0"><span className="block truncate font-medium">{c.title}</span><span className="block text-[10px] text-muted-foreground truncate">{[c.companyNumber, c.companyStatus, c.addressSnippet].filter(Boolean).join(" · ")}</span></span>
          </button>
        ))}
        {staff && q.length >= 2 && !exact && (
          <button type="button" className={`${row} text-primary border-t border-border mt-1 pt-2`} disabled={!!busy} onClick={() => create("new", { name: term.trim() })} data-testid="company-link-picker-add">
            {busy === "new" ? <Loader2 className="w-3.5 h-3.5 mt-0.5 animate-spin shrink-0" /> : <Plus className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
            <span>Add “{term.trim()}” as a new company</span>
          </button>
        )}
        {!staff && q.length >= 2 && <p className="px-2 pt-1 text-[11px] text-muted-foreground">Not listed? Ask BGP to add it.</p>}
      </div>
    </div>
  );
}

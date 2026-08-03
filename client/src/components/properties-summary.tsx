// PropertiesSummary — THE property grouping, everywhere. Third of the family
// with TrackerSummary (lettings) and DealsSummary (deals): one row design for
// every board that lists properties for a company or portfolio, replacing the
// drifted one-offs (Landsec "Linked Properties" cards, the staff Properties &
// Deals widget, My Portfolio, the companies-page grouping — each had its own
// look and none carried live counts).
//
// Each row: property name → property page, then canonical count chips that
// deep-link into the two boards pre-filtered by property:
//   lettings → Letting Tracker (/deals/letting?propertyId=…)
//   deals    → Deals board (/deals/list?propertyId=…)
//   units    → the property's tenancy schedule (tenant scope only)
//
// Scopes (Woody, 2026-08-03):
//   companyId + role="landlord" — their portfolio (ownership + links)
//   companyId + role="tenant"   — properties where the brand is in
//     occupation off the tenancy schedule (same evidence rule as Linked
//     Contacts) plus properties carrying one of their deals
//   propertyIds                 — explicit list (dashboard widgets)
//   no scope + onlyActive       — every property with something live
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Building2, Store, Handshake, ChevronRight } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { legacyToCode, type DealStatusCode } from "@shared/deal-status";

const LIVE_LETTING = new Set<DealStatusCode>(["OPP", "REP", "AVA", "NEG", "SOL", "EXC"]);
const LIVE_DEAL = new Set<DealStatusCode>(["REP", "AVA", "NEG", "SOL", "EXC"]);

type SummaryRow = { id: string; name: string; asset_class: string | null; units_occupied: number | null };

export function PropertiesSummary({ companyId, role = "landlord", propertyIds, onlyActive }: {
  companyId?: string;
  role?: "landlord" | "tenant";
  propertyIds?: string[];
  onlyActive?: boolean;
}) {
  const { data: companyRows = [], isLoading: companyLoading } = useQuery<SummaryRow[]>({
    queryKey: ["/api/crm/companies", companyId, "property-summary", role],
    queryFn: async () => {
      const r = await fetch(`/api/crm/companies/${companyId}/property-summary?role=${role}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!companyId,
  });

  const { data: allProperties = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/properties", { excludeComps: true }],
    queryFn: async () => {
      const r = await fetch("/api/crm/properties?excludeComps=true", { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : (d?.data ?? []);
    },
    enabled: !companyId,
  });

  // Same canonical feeds (and queryKeys) as TrackerSummary / DealsSummary —
  // React Query dedupes, so rows sharing a page cost no extra requests.
  const { data: units = [] } = useQuery<any[]>({
    queryKey: ["/api/available-units"],
    queryFn: async () => {
      const r = await fetch("/api/available-units", { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
  });
  const { data: deals = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/deals", { excludeTracker: true }],
    queryFn: async () => {
      const r = await fetch("/api/crm/deals?excludeTrackerDeals=true", { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const lettingCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of units) {
      const code = legacyToCode(u.marketingStatus) || "AVA";
      if (LIVE_LETTING.has(code) && u.propertyId) m.set(u.propertyId, (m.get(u.propertyId) || 0) + 1);
    }
    return m;
  }, [units]);
  const dealCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deals) {
      const code = legacyToCode(d.status);
      if (code && LIVE_DEAL.has(code) && d.propertyId) m.set(d.propertyId, (m.get(d.propertyId) || 0) + 1);
    }
    return m;
  }, [deals]);

  const rows: SummaryRow[] = useMemo(() => {
    if (companyId) return companyRows;
    let base: SummaryRow[] = allProperties.map((p: any) => ({
      id: p.id, name: p.name, asset_class: p.assetClass ?? p.asset_class ?? null, units_occupied: null,
    }));
    if (propertyIds && propertyIds.length) base = base.filter(p => propertyIds.includes(p.id));
    if (onlyActive) base = base.filter(p => (lettingCounts.get(p.id) || 0) > 0 || (dealCounts.get(p.id) || 0) > 0);
    return base.sort((a, b) =>
      ((lettingCounts.get(b.id) || 0) + (dealCounts.get(b.id) || 0)) -
      ((lettingCounts.get(a.id) || 0) + (dealCounts.get(a.id) || 0)) || a.name.localeCompare(b.name));
  }, [companyId, companyRows, allProperties, propertyIds, onlyActive, lettingCounts, dealCounts]);

  const totalLettings = rows.reduce((n, r) => n + (lettingCounts.get(r.id) || 0), 0);
  const totalDeals = rows.reduce((n, r) => n + (dealCounts.get(r.id) || 0), 0);

  if (companyId && companyLoading) {
    return <p className="text-xs text-muted-foreground italic" data-testid="properties-summary">Loading properties…</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="text-center py-3" data-testid="properties-summary">
        <Building2 className="w-6 h-6 mx-auto mb-1 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">
          {role === "tenant" && companyId ? "No known occupation or live deals at any property." : "No properties here yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="properties-summary">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs">
          <span className="font-semibold tabular-nums">{rows.length}</span>
          <span className="text-muted-foreground"> propert{rows.length === 1 ? "y" : "ies"}</span>
          {totalLettings > 0 && <span className="text-muted-foreground"> · {totalLettings} live letting{totalLettings === 1 ? "" : "s"}</span>}
          {totalDeals > 0 && <span className="text-muted-foreground"> · {totalDeals} live deal{totalDeals === 1 ? "" : "s"}</span>}
        </div>
        <Link href="/properties" className="text-[11px] text-primary hover:underline inline-flex items-center shrink-0">
          Properties <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="space-y-1 max-h-[340px] overflow-y-auto pr-1">
        {rows.map(p => {
          const lettings = lettingCounts.get(p.id) || 0;
          const liveDeals = dealCounts.get(p.id) || 0;
          return (
            <div key={p.id} className="flex items-center justify-between gap-2 p-1.5 rounded border bg-card min-w-0" data-testid={`properties-summary-row-${p.id}`}>
              <Link href={`/properties/${p.id}`} className="flex items-center gap-1.5 min-w-0 flex-1 hover:underline">
                <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium truncate">{p.name}</span>
                {p.asset_class && <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">{p.asset_class}</span>}
              </Link>
              <span className="flex items-center gap-1 shrink-0">
                {role === "tenant" && (p.units_occupied || 0) > 0 && (
                  <Link href={`/properties/${p.id}`}>
                    <Badge variant="outline" className="text-[9px] cursor-pointer">{p.units_occupied} unit{p.units_occupied === 1 ? "" : "s"}</Badge>
                  </Link>
                )}
                {lettings > 0 && (
                  <Link href={`/deals/letting?propertyId=${encodeURIComponent(p.id)}`}>
                    <Badge variant="outline" className="text-[9px] cursor-pointer gap-0.5"><Store className="w-2.5 h-2.5" />{lettings}</Badge>
                  </Link>
                )}
                {liveDeals > 0 && (
                  <Link href={`/deals/list?propertyId=${encodeURIComponent(p.id)}`}>
                    <Badge variant="outline" className="text-[9px] cursor-pointer gap-0.5"><Handshake className="w-2.5 h-2.5" />{liveDeals}</Badge>
                  </Link>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

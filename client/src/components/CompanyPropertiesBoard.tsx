import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, ChevronDown, ChevronRight, Plus, Loader2, ExternalLink, X, Unlink, ArrowRightLeft, Trash2 } from "lucide-react";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { buildUserColorMap } from "@/lib/agent-colors";
import { BrandPortfolioMap } from "@/components/brand-portfolio-map";
import type { CrmDeal, CrmProperty } from "@shared/schema";

// Unified Properties board — single property-centric view that merges what
// used to be four separate sections on the company detail page: the brand
// panel's Ownership block (map + scraped/Land-Registry discovery), Linked
// Properties, the company Leasing Schedule, and Properties & Deals. The map
// is the discovery surface: teal markers are CRM properties, slate markers
// are portfolio found on the landlord's website / Land Registry that aren't
// in the CRM yet — click to promote. Each in-CRM row expands to show its
// units, deals, agents and ownership source.
//
// Parameterised by kind: landlords resolve their portfolio via landlord_id +
// company links + deal FKs + leasing units, and auto-scrape their website.
// Lenders mirror the same board but resolve via secured properties + Land
// Registry charges (their "ownership" is security over the asset).

interface LeasingUnit {
  id: string;
  property_id: string;
  property_name?: string;
  zone: string;
  unit_name: string;
  tenant_name: string;
  lease_expiry: string | null;
  rent_pa: number | null;
  sqft: number | null;
  status: string;
}

interface OwnedProperty {
  id: string;
  name: string;
  address: any;
  postcode: string | null;
  status: string | null;
  lat: number | null;
  lng: number | null;
}

interface LandRegistryTitle {
  title_number: string;
  property_address: string | null;
  postcode: string | null;
  lat?: number | null;
  lng?: number | null;
}

interface ScrapedProperty {
  name: string;
  address?: string;
  postcode?: string;
  sector?: string;
  lat?: number | null;
  lng?: number | null;
  formatted_address?: string;
}

interface BrandProfileSlice {
  ownedProperties: OwnedProperty[];
  landRegistryTitles: LandRegistryTitle[];
  landlordWebsiteFindings: {
    scraped_at: string;
    properties: ScrapedProperty[];
  } | null;
  dismissedDiscoveries?: string[];
}

interface SecuredProperty {
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  interestType: "senior" | "junior";
  dealId?: string;
  dealName?: string;
}

interface LrCharge {
  titleNumber: string;
  propertyId?: string;
  propertyName?: string;
  chargeDate: string;
  amount?: number;
  notes?: string;
}

type DealLite = Pick<CrmDeal, "id" | "name" | "status" | "dealType" | "groupName">;

interface BoardProperty {
  id: string;
  name: string;
  address: string | null;
  postcode: string | null;
  status: string | null;
  lat: number | null;
  lng: number | null;
  units: LeasingUnit[];
  deals: DealLite[];
  agentNames: string[];
  sourceTags: string[];
}

interface DiscoveredItem {
  key: string;
  name: string;
  address: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  source: string;
  seed: { name: string; address?: string; postcode?: string; sector?: string };
}

function isExpiringSoon(d: string | null): boolean {
  if (!d) return false;
  const monthsAway = (new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30);
  return monthsAway >= 0 && monthsAway <= 12;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function addressText(addr: any, postcode?: string | null): string | null {
  if (typeof addr === "string") return addr;
  if (addr && typeof addr === "object") return addr.formatted || addr.line1 || postcode || null;
  return postcode || null;
}

function normName(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Per-row management for an in-CRM property: detach it from this
// landlord, reallocate it to a different landlord, or delete it from
// the CRM entirely. Lives in its own component so each row owns its
// reallocate-search and confirm-dialog state independently.
function PropertyManageActions({ companyId, property }: { companyId: string; property: BoardProperty }) {
  const { toast } = useToast();
  const [reallocOpen, setReallocOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/company-property-links"] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
  };

  const { data: results = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/crm/companies/search", debounced],
    queryFn: async () => {
      if (!debounced || debounced.length < 2) return [];
      const r = await fetch(`/api/crm/companies?q=${encodeURIComponent(debounced)}&limit=8`, { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      const arr = Array.isArray(d) ? d : (d.companies || []);
      return arr.map((c: any) => ({ id: String(c.id), name: c.name })).filter((c: any) => c.id !== companyId);
    },
    staleTime: 30_000,
    enabled: reallocOpen,
  });

  const unlinkMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", `/api/landlord/${companyId}/unlink-property`, { propertyId: property.id }); },
    onSuccess: () => { toast({ title: "Removed", description: `${property.name} is no longer linked to this landlord.` }); invalidate(); },
    onError: (e: any) => toast({ title: "Couldn't remove", description: e?.message, variant: "destructive" }),
  });

  const reallocateMutation = useMutation({
    mutationFn: async (target: { id: string; name: string }) => {
      await apiRequest("PUT", `/api/crm/properties/${property.id}`, { landlordId: target.id });
      return target;
    },
    onSuccess: (target) => { toast({ title: "Reallocated", description: `${property.name} → ${target.name}.` }); setReallocOpen(false); setQuery(""); invalidate(); },
    onError: (e: any) => toast({ title: "Couldn't reallocate", description: e?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/crm/properties/${property.id}`); },
    onSuccess: () => { toast({ title: "Deleted", description: `${property.name} removed from the CRM.` }); invalidate(); },
    onError: (e: any) => toast({ title: "Couldn't delete", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="flex items-center gap-2 pt-1.5 border-t border-border/40 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Manage</span>
      <Button
        size="sm" variant="ghost" className="h-6 text-[10px]"
        disabled={unlinkMutation.isPending}
        onClick={() => unlinkMutation.mutate()}
        data-testid={`btn-unlink-property-${property.id}`}
      >
        <Unlink className="w-3 h-3 mr-1" />Remove from landlord
      </Button>
      <Popover open={reallocOpen} onOpenChange={setReallocOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" data-testid={`btn-reallocate-property-${property.id}`}>
            <ArrowRightLeft className="w-3 h-3 mr-1" />Reallocate
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <Input
            autoFocus
            placeholder="Search landlord…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="h-7 text-xs mb-1"
          />
          <div className="max-h-48 overflow-y-auto">
            {results.length === 0 && (
              <p className="text-[10px] text-muted-foreground px-1 py-1">{query.length < 2 ? "Type at least 2 characters" : "No matches"}</p>
            )}
            {results.map(c => (
              <button
                key={c.id}
                onClick={() => reallocateMutation.mutate(c)}
                disabled={reallocateMutation.isPending}
                className="w-full text-left text-xs px-2 py-1 rounded hover:bg-muted truncate disabled:opacity-50"
              >
                {c.name}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive hover:text-destructive ml-auto" data-testid={`btn-delete-property-${property.id}`}>
            <Trash2 className="w-3 h-3 mr-1" />Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {property.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the property from the CRM. Any deals stay but are detached from it; units, agent and company links are removed. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function CompanyPropertiesBoard({
  companyId,
  kind,
}: {
  companyId: string;
  kind: "landlord" | "lender";
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "crm" | "discovered" | "expiring">("all");
  const autoSyncRan = useRef(false);

  // ── Shared queries (deduped with the page / brand panel by queryKey) ──
  const { data: brand } = useQuery<BrandProfileSlice>({
    queryKey: ["/api/brand", companyId, "profile"],
    queryFn: async () => {
      const res = await fetch(`/api/brand/${companyId}/profile`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: kind === "landlord" && !!companyId,
  });

  const { data: allPropertiesRaw } = useQuery<CrmProperty[]>({ queryKey: ["/api/crm/properties"] });
  const allProperties = Array.isArray(allPropertiesRaw) ? allPropertiesRaw : [];
  const propertyMap = useMemo(() => new Map(allProperties.map(p => [p.id, p])), [allProperties]);

  const { data: allDealsRaw } = useQuery<CrmDeal[]>({ queryKey: ["/api/crm/deals"] });
  const allDeals = Array.isArray(allDealsRaw) ? allDealsRaw : [];

  const { data: companyPropertyLinksRaw } = useQuery<{ companyId: string; propertyId: string }[]>({
    queryKey: ["/api/crm/company-property-links"],
  });
  const companyPropertyLinks = Array.isArray(companyPropertyLinksRaw) ? companyPropertyLinksRaw : [];

  const { data: propertyAgentLinks = [] } = useQuery<{ propertyId: string; userId: string }[]>({
    queryKey: ["/api/crm/property-agents"],
  });

  const { data: allUsersRaw } = useQuery<{ id: string; name: string }[]>({ queryKey: ["/api/users"] });
  const allUsers = Array.isArray(allUsersRaw) ? allUsersRaw : [];
  const userColorMap = useMemo(() => buildUserColorMap(allUsers), [allUsers]);
  const userIdToName = useMemo(() => new Map(allUsers.map(u => [u.id, u.name])), [allUsers]);

  const { data: units = [] } = useQuery<LeasingUnit[]>({
    queryKey: ["/api/leasing-schedule/company", companyId],
    queryFn: () => fetch(`/api/leasing-schedule/company/${companyId}`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()),
    enabled: !!companyId,
  });

  // ── Lender-only sources ──
  const { data: securedProperties = [] } = useQuery<SecuredProperty[]>({
    queryKey: ["/api/lenders/secured-properties", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/lenders/secured-properties?companyId=${companyId}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: kind === "lender" && !!companyId,
  });

  const { data: lrCharges = [] } = useQuery<LrCharge[]>({
    queryKey: ["/api/lenders/lr-charges", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/lenders/lr-charges?companyId=${companyId}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: kind === "lender" && !!companyId,
  });

  // ── Discovery auto-scrape — fires the website portfolio scrape the first
  //    time a landlord profile opens with stale/missing findings, then polls
  //    until it lands so the new portfolio + auto-linked properties appear.
  //    (Moved here from the brand panel's old Ownership block.) ──
  const findingsAreFresh = !!brand?.landlordWebsiteFindings?.scraped_at && (
    Date.now() - new Date(brand.landlordWebsiteFindings.scraped_at).getTime() < 14 * 24 * 60 * 60 * 1000
  );
  // Who's looking — the auto-scrape is a BGP enrichment job, so it must not
  // fire on a client login (it 403s on every client visit to the profile).
  const { data: cpbViewer } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const cpbIsClient = cpbViewer?.role === "Client" || !!cpbViewer?.companyScopeId;

  useEffect(() => {
    if (kind !== "landlord") return;
    if (cpbIsClient) return;
    if (autoSyncRan.current) return;
    if (!brand) return;
    if (findingsAreFresh) return;
    autoSyncRan.current = true;
    (async () => {
      try {
        await apiRequest("POST", `/api/landlord/${companyId}/scrape-portfolio`, {});
        const start = Date.now();
        const poll = async () => {
          if (Date.now() - start > 5 * 60_000) return;
          const r = await fetch(`/api/landlord/${companyId}/scrape-portfolio/status`, { credentials: "include" });
          if (r.ok) {
            const s = await r.json();
            if (s.progress?.state === "done") {
              queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
              return;
            }
            if (s.progress?.state === "error") return;
          }
          setTimeout(poll, 5000);
        };
        setTimeout(poll, 5000);
      } catch {
        /* swallow — manual refresh available via /chatbgp */
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, kind, brand, findingsAreFresh, cpbIsClient]);

  const createPropertyMutation = useMutation({
    mutationFn: async (item: { name: string; address?: string; postcode?: string; sector?: string }) => {
      const res = await apiRequest("POST", `/api/landlord/${companyId}/create-property`, item);
      return res.json() as Promise<{ id: string }>;
    },
    onSuccess: (_out, item) => {
      toast({ title: "Created CRM property", description: `${item.name} linked.` });
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/company-property-links"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
    },
    onError: (e: any) => toast({ title: "Couldn't create", description: e?.message, variant: "destructive" }),
  });

  const dismissDiscoveryMutation = useMutation({
    mutationFn: async (item: { key: string; name: string }) => {
      await apiRequest("POST", `/api/landlord/${companyId}/dismiss-discovery`, { key: item.key });
      return item;
    },
    onSuccess: (item) => {
      toast({
        title: "Hidden from board",
        description: `${item.name} won't show as a discovery again.`,
        action: (
          <ToastAction
            altText="Undo"
            onClick={() => restoreDiscoveryMutation.mutate(item.key)}
          >
            Undo
          </ToastAction>
        ),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    },
    onError: (e: any) => toast({ title: "Couldn't hide", description: e?.message, variant: "destructive" }),
  });

  const restoreDiscoveryMutation = useMutation({
    mutationFn: async (key: string) => {
      await apiRequest("POST", `/api/landlord/${companyId}/dismiss-discovery`, { key, restore: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    },
    onError: (e: any) => toast({ title: "Couldn't restore", description: e?.message, variant: "destructive" }),
  });

  // ── Build the unioned in-CRM property set ──
  const boardProperties = useMemo<BoardProperty[]>(() => {
    const byId = new Map<string, BoardProperty>();
    const ensure = (id: string, seed?: Partial<BoardProperty>): BoardProperty | null => {
      const crm = propertyMap.get(id);
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          name: seed?.name || crm?.name || "Untitled property",
          address: seed?.address ?? addressText(crm?.address, crm?.postcode),
          postcode: seed?.postcode ?? crm?.postcode ?? null,
          status: seed?.status ?? crm?.status ?? null,
          lat: seed?.lat ?? toNum(crm?.latitude),
          lng: seed?.lng ?? toNum(crm?.longitude),
          units: [],
          deals: [],
          agentNames: [],
          sourceTags: [],
        });
      }
      return byId.get(id)!;
    };
    const tag = (p: BoardProperty, t: string) => { if (!p.sourceTags.includes(t)) p.sourceTags.push(t); };

    if (kind === "landlord") {
      // landlord_id FK (from brand profile — carries geocoded lat/lng)
      for (const p of brand?.ownedProperties || []) {
        const bp = ensure(p.id, { name: p.name, address: addressText(p.address, p.postcode), postcode: p.postcode, status: p.status, lat: p.lat, lng: p.lng });
        if (bp) tag(bp, "Owner");
      }
      // explicit company → property links
      for (const l of companyPropertyLinks) {
        if (l.companyId !== companyId) continue;
        const bp = ensure(l.propertyId);
        if (bp) tag(bp, "Linked");
      }
    } else {
      // lender: secured properties are the "ownership" equivalent
      for (const sp of securedProperties) {
        const bp = ensure(sp.propertyId, { name: sp.propertyName, address: sp.propertyAddress });
        if (bp) tag(bp, sp.interestType === "junior" ? "Junior charge" : "Senior charge");
      }
      for (const ch of lrCharges) {
        if (!ch.propertyId) continue;
        const bp = ensure(ch.propertyId, { name: ch.propertyName });
        if (bp) tag(bp, "LR charge");
      }
    }

    // deals referencing this company, grouped onto their property
    for (const d of allDeals) {
      const involved = d.landlordId === companyId || d.tenantId === companyId || d.vendorId === companyId || d.purchaserId === companyId;
      if (!involved || !d.propertyId) continue;
      const bp = ensure(d.propertyId);
      if (bp) bp.deals.push({ id: d.id, name: d.name, status: d.status, dealType: d.dealType, groupName: d.groupName });
    }

    // leasing units by property
    for (const u of units) {
      const bp = ensure(u.property_id);
      if (bp) bp.units.push(u);
    }

    // agents per property
    for (const bp of byId.values()) {
      const ids = propertyAgentLinks.filter(l => l.propertyId === bp.id).map(l => l.userId);
      bp.agentNames = ids.map(uid => userIdToName.get(uid)).filter(Boolean) as string[];
    }

    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [kind, brand, companyId, companyPropertyLinks, securedProperties, lrCharges, allDeals, units, propertyAgentLinks, propertyMap, userIdToName]);

  // ── Discovered (not-yet-in-CRM) portfolio — landlords only ──
  const discovered = useMemo<DiscoveredItem[]>(() => {
    if (kind !== "landlord") return [];
    const dismissed = new Set(brand?.dismissedDiscoveries || []);
    const linkedSigs = new Set<string>();
    for (const bp of boardProperties) {
      if (normName(bp.name)) linkedSigs.add(`name:${normName(bp.name)}`);
      const pc = (bp.postcode || "").toUpperCase().replace(/\s+/g, "");
      if (pc) linkedSigs.add(`pc:${pc}`);
    }
    const alreadyLinked = (name?: string | null, postcode?: string | null) => {
      if (normName(name) && linkedSigs.has(`name:${normName(name)}`)) return true;
      const pc = (postcode || "").toUpperCase().replace(/\s+/g, "");
      return !!(pc && linkedSigs.has(`pc:${pc}`));
    };
    const out: DiscoveredItem[] = [];
    for (const p of brand?.landlordWebsiteFindings?.properties || []) {
      if (alreadyLinked(p.name, p.postcode)) continue;
      out.push({
        key: `scraped:${p.name}`,
        name: p.name,
        address: p.formatted_address || p.address || p.postcode || null,
        postcode: p.postcode || null,
        lat: toNum(p.lat), lng: toNum(p.lng),
        source: "website",
        seed: { name: p.name, address: p.address, postcode: p.postcode, sector: p.sector },
      });
    }
    for (const t of brand?.landRegistryTitles || []) {
      if (alreadyLinked(t.property_address, t.postcode)) continue;
      out.push({
        key: `lr:${t.title_number}`,
        name: t.property_address || `Title ${t.title_number}`,
        address: t.property_address || t.postcode || null,
        postcode: t.postcode || null,
        lat: toNum(t.lat), lng: toNum(t.lng),
        source: "land-registry",
        seed: { name: t.property_address || `Title ${t.title_number}`, address: t.property_address || undefined, postcode: t.postcode || undefined },
      });
    }
    return out.filter(d => !dismissed.has(d.key));
  }, [kind, brand, boardProperties]);

  // ── Map markers ──
  const mapStores = useMemo(() => {
    const stores: Array<{ id: string; name: string; address: string | null; lat: number | null; lng: number | null; status: string | null; tone: "linked" | "unlinked"; href?: string; seed?: any }> = [];
    for (const bp of boardProperties) {
      if (bp.lat == null || bp.lng == null) continue;
      stores.push({ id: `crm:${bp.id}`, name: bp.name, address: bp.address, lat: bp.lat, lng: bp.lng, status: bp.status, tone: "linked", href: `/properties/${bp.id}` });
    }
    for (const d of discovered) {
      if (d.lat == null || d.lng == null) continue;
      stores.push({ id: d.key, name: d.name, address: d.address, lat: d.lat, lng: d.lng, status: null, tone: "unlinked", seed: d.seed });
    }
    return stores;
  }, [boardProperties, discovered]);

  const totalUnits = boardProperties.reduce((n, p) => n + p.units.length, 0);
  const totalDeals = boardProperties.reduce((n, p) => n + p.deals.length, 0);
  const scrapedCount = brand?.landlordWebsiteFindings?.properties?.length || 0;
  const lrCount = kind === "landlord" ? (brand?.landRegistryTitles?.length || 0) : lrCharges.length;

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const visibleProps = boardProperties.filter(p => {
    if (filter === "crm" || filter === "all") return true;
    if (filter === "expiring") return p.units.some(u => isExpiringSoon(u.lease_expiry));
    return false;
  });
  const showDiscovered = filter === "all" || filter === "discovered";

  if (boardProperties.length === 0 && discovered.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-3 space-y-3" data-testid="company-properties-board">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-xs flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-teal-500" />
            Properties
            <span className="font-normal text-muted-foreground">
              {boardProperties.length} in CRM{discovered.length > 0 ? ` · ${discovered.length} discovered` : ""}
            </span>
          </h3>
          <span className="text-[10px] text-muted-foreground">
            CRM {boardProperties.length}{kind === "landlord" ? ` · Website ${scrapedCount}` : ""} · {kind === "landlord" ? "Land Registry" : "LR charges"} {lrCount}
          </span>
        </div>

        {mapStores.length > 0 && (
          <div className="rounded-lg overflow-hidden border">
            <BrandPortfolioMap
              stores={mapStores as any}
              height={300}
              alwaysRender
              onSelect={(s: any) => {
                if (s.href) { window.location.href = s.href; return; }
                if (s.seed && kind === "landlord") createPropertyMutation.mutate(s.seed);
              }}
            />
          </div>
        )}

        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          {([
            ["all", `All ${boardProperties.length + discovered.length}`],
            ["crm", `In CRM ${boardProperties.length}`],
            discovered.length > 0 ? ["discovered", `Discovered ${discovered.length}`] : null,
            ["expiring", `Expiring soon ${boardProperties.filter(p => p.units.some(u => isExpiringSoon(u.lease_expiry))).length}`],
          ].filter(Boolean) as [string, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key as any)}
              className={`px-2.5 py-0.5 rounded-full border transition-colors ${filter === key ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}
              data-testid={`filter-${key}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* The property list is capped with its own scroll — on landlords
            with a real portfolio (Landsec) it ran on for screens under the
            map ("lots under the map", Woody 2026-07-30). */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[560px] overflow-y-auto pr-1">
          {visibleProps.map(p => {
            const isOpen = expanded.has(p.id);
            const occ = p.units.filter(u => u.status === "Occupied").length;
            const exp = p.units.filter(u => isExpiringSoon(u.lease_expiry)).length;
            return (
              <div key={p.id} className={`border rounded-lg overflow-hidden ${isOpen ? "md:col-span-2" : ""}`} data-testid={`board-property-${p.id}`}>
                <button
                  onClick={() => toggle(p.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-background hover:bg-muted/40 transition-colors text-left"
                >
                  {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                  <span className="w-2 h-2 rounded-full bg-teal-500 shrink-0" />
                  <Link href={`/properties/${p.id}`} className="text-sm font-medium truncate hover:underline" onClick={e => e.stopPropagation()}>
                    {p.name}
                  </Link>
                  <div className="flex items-center gap-1 ml-auto shrink-0">
                    {p.units.length > 0 && (
                      <Badge className="text-[9px] bg-teal-100 text-teal-700 dark:bg-teal-800 dark:text-teal-300 border-0">{p.units.length} unit{p.units.length !== 1 ? "s" : ""} · {occ} occ</Badge>
                    )}
                    {exp > 0 && <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-600">{exp} exp</Badge>}
                    {p.deals.length > 0 && (
                      <Badge className="text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-0">{p.deals.length} deal{p.deals.length !== 1 ? "s" : ""}</Badge>
                    )}
                    {p.agentNames.map(name => (
                      <Badge key={name} className={`text-[9px] px-1 py-0 text-white ${userColorMap[name] || "bg-zinc-500"}`}>{name.split(" ")[0]}</Badge>
                    ))}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t px-3 py-2 bg-muted/30 space-y-2.5">
                    {p.units.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Leasing schedule</div>
                        <div className="space-y-0.5">
                          {p.units.slice(0, 12).map(u => (
                            <div key={u.id} className="flex items-center gap-2 text-xs py-0.5">
                              <span className="truncate flex-1">{u.unit_name}{u.tenant_name ? ` · ${u.tenant_name}` : ""}</span>
                              <span className={`shrink-0 ${u.status === "Occupied" ? "text-emerald-600" : "text-amber-600"}`}>{u.status}</span>
                              {u.lease_expiry && <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{new Date(u.lease_expiry).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</span>}
                            </div>
                          ))}
                          {p.units.length > 12 && <p className="text-[10px] text-muted-foreground">+{p.units.length - 12} more units</p>}
                        </div>
                      </div>
                    )}
                    {p.deals.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Deals</div>
                        <div className="space-y-0.5">
                          {p.deals.map(d => (
                            <Link key={d.id} href={`/deals/${d.id}`} className="flex items-center gap-2 text-xs py-0.5 hover:bg-muted/50 rounded px-1 -mx-1">
                              <span className="truncate flex-1">{d.name}</span>
                              {d.dealType && <Badge variant="secondary" className="text-[9px] shrink-0">{d.dealType}</Badge>}
                              <span className="text-[10px] text-muted-foreground shrink-0">{d.status || d.groupName}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                    {p.sourceTags.length > 0 && (
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span>Source:</span>
                        {p.sourceTags.map(t => <Badge key={t} variant="outline" className="text-[9px]">{t}</Badge>)}
                      </div>
                    )}
                    {p.units.length === 0 && p.deals.length === 0 && (
                      <p className="text-[10px] text-muted-foreground">No units or deals recorded yet.</p>
                    )}
                    {kind === "landlord" && <PropertyManageActions companyId={companyId} property={p} />}
                  </div>
                )}
              </div>
            );
          })}

          {showDiscovered && discovered.map(d => (
            <div key={d.key} className="flex items-center gap-2 px-3 py-2 border border-dashed rounded-lg bg-muted/30" data-testid={`board-discovered-${d.key}`}>
              <span className="w-2 h-2 rounded-full bg-zinc-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{d.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{[d.address, d.source === "website" ? "found on website" : "Land Registry"].filter(Boolean).join(" · ")}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] shrink-0"
                disabled={createPropertyMutation.isPending}
                onClick={() => createPropertyMutation.mutate(d.seed)}
                data-testid={`btn-add-to-crm-${d.key}`}
              >
                <Plus className="w-3 h-3 mr-1" />Add to CRM
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                disabled={dismissDiscoveryMutation.isPending}
                onClick={() => dismissDiscoveryMutation.mutate({ key: d.key, name: d.name })}
                title="Hide this — wrong match or already in the CRM"
                data-testid={`btn-dismiss-discovery-${d.key}`}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>

        {(totalUnits > 0 || totalDeals > 0) && (
          <Link href="/leasing-schedule" className="text-[10px] text-indigo-500 hover:underline flex items-center gap-1 w-fit">
            <ExternalLink className="w-3 h-3" />Open leasing board
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

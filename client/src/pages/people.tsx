import { lazy, Suspense, useState, useMemo, useEffect, useRef } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTeam } from "@/lib/team-context";
import type { User } from "@shared/schema";
import {
  Building2, Users, Store, Crown, Search, Globe, MapPin,
  ChevronRight, ChevronDown, Building, Briefcase,
  Phone, Mail, X, TrendingUp, Trash2,
  Handshake, ShoppingBag,
  Utensils, Clapperboard, ClipboardList, Dumbbell,
  Sparkles, Shirt, Flower2,
  Gem, Watch, Footprints, ShoppingCart, Smartphone, BookOpen,
  Coffee, Wine, UtensilsCrossed, Soup, CakeSlice,
  Tv, Gamepad2, Baby, Palette, PartyPopper,
  HeartPulse, Bath,
  Diamond, Car, Wifi, Landmark, Gift, Home, Activity, Zap,
  Tag, Wrench,
} from "lucide-react";
import { ViewToggle } from "@/components/mobile-card-view";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CRM_OPTIONS } from "@/lib/crm-options";
import { guessDomain, extractDomain } from "@/lib/company-logos";
import type { CrmCompany, CrmContact, CrmDeal, CrmProperty, CrmRequirementsLeasing, CrmRequirementsInvestment, InvestmentTracker } from "@shared/schema";

const CompanyDetailPage = lazy(() => import("@/pages/companies"));
const ContactDetailPage = lazy(() => import("@/pages/contacts"));

function PageLoader() {
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function CompanyLogo({ company, size = "md" }: { company: CrmCompany; size?: "sm" | "md" | "lg" }) {
  const [failCount, setFailCount] = useState(0);

  const sizeClass = size === "sm" ? "w-8 h-8" : size === "lg" ? "w-14 h-14" : "w-10 h-10";
  const textSize = size === "sm" ? "text-xs" : size === "lg" ? "text-lg" : "text-sm";
  const px = size === "sm" ? 32 : size === "lg" ? 56 : 40;

  const domain = company.domainUrl || company.logoUrl || company.domain;
  const d = extractDomain(domain || null);
  const guessed = guessDomain(company.name);

  // Build ordered list of logo URLs to try
  const logoSources: string[] = [];
  if (d) {
    logoSources.push(`https://logo.clearbit.com/${d}?size=${Math.min(px * 3, 512)}`);
    logoSources.push(`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${d}&size=128`);
  }
  if (guessed && guessed !== d) {
    logoSources.push(`https://logo.clearbit.com/${guessed}?size=${Math.min(px * 3, 512)}`);
    logoSources.push(`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${guessed}&size=128`);
  }

  if (failCount >= logoSources.length) {
    const initials = (company.name || "?").split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
    return (
      <div className={`${sizeClass} rounded-lg bg-muted flex items-center justify-center ${textSize} font-semibold text-muted-foreground border shrink-0`}>
        {initials}
      </div>
    );
  }

  return (
    <img
      src={logoSources[failCount]}
      alt={company.name}
      className={`${sizeClass} rounded-lg object-contain bg-white border shrink-0`}
      onError={() => setFailCount(c => c + 1)}
    />
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: any; color: string }) {
  return (
    <div className="flex items-center gap-3 bg-card border rounded-lg px-4 py-3">
      <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div>
        <p className="text-xl font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function LandlordsTab({
  companies,
  contacts,
  properties,
  deals,
  onScopeLandlord,
  onDeleteCompany,
  viewMode = "card",
}: {
  companies: CrmCompany[];
  contacts: CrmContact[];
  properties: CrmProperty[];
  deals: CrmDeal[];
  onScopeLandlord?: (id: string) => void;
  onDeleteCompany?: (id: string, name: string) => void;
  viewMode?: "table" | "card" | "board";
}) {
  const [search, setSearch] = useState("");
  const [landlordFilter, setLandlordFilter] = useState<"all" | "clients" | "non-clients">("all");

  const landlords = useMemo(() => {
    return companies.filter((c) => {
      const t = (c.companyType || "").toLowerCase().trim();
      return t === "landlord" || t === "client" || t === "landlord / client" || c.isPortfolioAccount;
    });
  }, [companies]);

  const clientLandlords = useMemo(() => landlords.filter((c) => {
    const t = (c.companyType || "").toLowerCase();
    return t === "client" || t === "landlord / client" || c.isPortfolioAccount;
  }), [landlords]);

  const nonClientLandlords = useMemo(() => landlords.filter((c) => !clientLandlords.find((cl) => cl.id === c.id)), [landlords, clientLandlords]);

  const displayList = landlordFilter === "clients" ? clientLandlords : landlordFilter === "non-clients" ? nonClientLandlords : landlords;

  const filtered = useMemo(() => {
    if (!search.trim()) return displayList;
    const s = search.toLowerCase();
    return displayList.filter((c) =>
      c.name.toLowerCase().includes(s) ||
      (c.description || "").toLowerCase().includes(s) ||
      (c.companyType || "").toLowerCase().includes(s)
    );
  }, [displayList, search]);

  const contactsByCompany = useMemo(() => {
    const map: Record<string, CrmContact[]> = {};
    contacts.forEach((c) => {
      if (c.companyId) {
        if (!map[c.companyId]) map[c.companyId] = [];
        map[c.companyId].push(c);
      }
    });
    return map;
  }, [contacts]);

  const propertiesByLandlord = useMemo(() => {
    const map: Record<string, CrmProperty[]> = {};
    properties.forEach((p) => {
      if (p.landlordId) {
        if (!map[p.landlordId]) map[p.landlordId] = [];
        map[p.landlordId].push(p);
      }
    });
    return map;
  }, [properties]);

  const dealsByLandlord = useMemo(() => {
    const map: Record<string, CrmDeal[]> = {};
    deals.forEach((d) => {
      if (d.landlordId) {
        if (!map[d.landlordId]) map[d.landlordId] = [];
        map[d.landlordId].push(d);
      }
    });
    return map;
  }, [deals]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="cursor-pointer" onClick={() => setLandlordFilter("all")} data-testid="stat-total-landlords">
          <StatCard label="Total Landlords" value={landlords.length} icon={Building2} color={landlordFilter === "all" ? "bg-slate-900 ring-2 ring-slate-400" : "bg-slate-700"} />
        </div>
        <div className="cursor-pointer" onClick={() => setLandlordFilter(landlordFilter === "clients" ? "all" : "clients")} data-testid="stat-bgp-clients">
          <StatCard label="BGP Clients" value={clientLandlords.length} icon={Crown} color={landlordFilter === "clients" ? "bg-amber-800 ring-2 ring-amber-400" : "bg-amber-600"} />
        </div>
        <div className="cursor-pointer" onClick={() => setLandlordFilter(landlordFilter === "non-clients" ? "all" : "non-clients")} data-testid="stat-non-clients">
          <StatCard label="Non-Clients" value={nonClientLandlords.length} icon={Building} color={landlordFilter === "non-clients" ? "bg-slate-700 ring-2 ring-slate-400" : "bg-slate-500"} />
        </div>
        <StatCard label="Total Contacts" value={contacts.filter(c => landlords.find(l => l.id === c.companyId)).length} icon={Users} color="bg-blue-600" />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search landlords..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
            data-testid="input-search-landlords"
          />
          {search && (
            <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearch("")}>
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{filtered.length} results</p>
      </div>

      {viewMode === "table" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-center">Properties</TableHead>
                  <TableHead className="text-center">Deals</TableHead>
                  <TableHead className="text-center">Contacts</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((company) => {
                  const compContacts = contactsByCompany[company.id] || [];
                  const compProps = propertiesByLandlord[company.id] || [];
                  const compDeals = dealsByLandlord[company.id] || [];
                  const isClient = clientLandlords.some((cl) => cl.id === company.id);
                  return (
                    <TableRow key={company.id} className="cursor-pointer hover:bg-muted/50 group" onClick={() => window.location.href = `/companies/${company.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <CompanyLogo company={company} size="sm" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-sm truncate">{company.name}</span>
                              {isClient && <Crown className="w-3 h-3 text-amber-500 shrink-0" />}
                            </div>
                            {company.description && <p className="text-xs text-muted-foreground truncate max-w-[250px]">{company.description}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{company.companyType || "Landlord"}</TableCell>
                      <TableCell className="text-center text-sm">{compProps.length}</TableCell>
                      <TableCell className="text-center text-sm">{compDeals.length}</TableCell>
                      <TableCell className="text-center text-sm">{compContacts.length}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center gap-1 justify-end">
                          {onScopeLandlord && (
                            <button onClick={(e) => { e.stopPropagation(); onScopeLandlord(company.id); }} className="text-xs text-primary hover:text-primary/80 font-medium whitespace-nowrap">View People</button>
                          )}
                          {onDeleteCompany && (
                            <button onClick={(e) => { e.stopPropagation(); onDeleteCompany(company.id, company.name); }} className="p-1 rounded-full opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map((company) => {
          const compContacts = contactsByCompany[company.id] || [];
          const compProps = propertiesByLandlord[company.id] || [];
          const compDeals = dealsByLandlord[company.id] || [];
          const isClient = clientLandlords.some((cl) => cl.id === company.id);
          return (
            <Link key={company.id} href={`/companies/${company.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full relative group" data-testid={`card-landlord-${company.id}`}>
                {onDeleteCompany && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteCompany(company.id, company.name); }}
                    className="absolute top-2 right-2 p-1 rounded-full opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all z-10"
                    title="Delete"
                    data-testid={`button-delete-landlord-${company.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <CompanyLogo company={company} size="lg" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm truncate">{company.name}</h3>
                        {isClient && <Crown className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {company.companyType || "Landlord"}
                      </p>
                      {company.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{company.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 shrink-0">
                      <Building className="w-3 h-3" />
                      {compProps.length} {compProps.length === 1 ? "property" : "properties"}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <Handshake className="w-3 h-3" />
                      {compDeals.length} {compDeals.length === 1 ? "deal" : "deals"}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <Users className="w-3 h-3" />
                      {compContacts.length} {compContacts.length === 1 ? "contact" : "contacts"}
                    </span>
                    {onScopeLandlord && (
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onScopeLandlord(company.id); }}
                        className="ml-auto flex items-center gap-1 text-primary hover:text-primary/80 font-medium shrink-0 whitespace-nowrap"
                        data-testid={`button-scope-${company.id}`}
                      >
                        <Users className="w-3 h-3" />
                        View People
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
      )}
    </div>
  );
}

function AgentsTab({
  companies,
  contacts,
  defaultTenantRep,
  onDeleteCompany,
}: {
  companies: CrmCompany[];
  contacts: CrmContact[];
  defaultTenantRep?: boolean;
  onDeleteCompany?: (id: string, name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [specialtyFilter, setSpecialtyFilter] = useState<string | null>(defaultTenantRep ? "Tenant Rep" : null);
  const [locationFilter, setLocationFilter] = useState<string | null>(null);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);

  const { data: leasingReqs = [] } = useQuery<CrmRequirementsLeasing[]>({
    queryKey: ["/api/crm/requirements-leasing"],
  });
  const { data: investmentReqs = [] } = useQuery<CrmRequirementsInvestment[]>({
    queryKey: ["/api/crm/requirements-investment"],
  });

  const { data: allDeals = [] } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals"],
  });

  const { data: investmentItems = [] } = useQuery<InvestmentTracker[]>({
    queryKey: ["/api/investment-tracker"],
  });

  const agentReqCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of leasingReqs) {
      if (r.agentContactId) map[r.agentContactId] = (map[r.agentContactId] || 0) + 1;
    }
    for (const r of investmentReqs) {
      if (r.agentContactId) map[r.agentContactId] = (map[r.agentContactId] || 0) + 1;
    }
    return map;
  }, [leasingReqs, investmentReqs]);

  const agentReqsByContact = useMemo(() => {
    const map: Record<string, { id: string; name: string; type: string; status?: string | null; use?: string[]; size?: string[]; locations?: string[] }[]> = {};
    for (const r of leasingReqs) {
      if (r.agentContactId) {
        if (!map[r.agentContactId]) map[r.agentContactId] = [];
        map[r.agentContactId].push({ id: r.id, name: r.name, type: "leasing", status: r.status, use: r.use || [], size: r.size || [], locations: r.requirementLocations || [] });
      }
    }
    for (const r of investmentReqs) {
      if (r.agentContactId) {
        if (!map[r.agentContactId]) map[r.agentContactId] = [];
        map[r.agentContactId].push({ id: r.id, name: r.name, type: "investment", status: r.status, use: r.use || [], size: r.size || [], locations: r.requirementLocations || [] });
      }
    }
    return map;
  }, [leasingReqs, investmentReqs]);

  const agentDealsByContact = useMemo(() => {
    const map: Record<string, { id: string; name: string; roles: string[]; status?: string | null; dealType?: string | null }[]> = {};
    for (const d of allDeals) {
      const addFor = (contactId: string, role: string) => {
        if (!map[contactId]) map[contactId] = [];
        const existing = map[contactId].find(e => e.id === d.id);
        if (existing) { existing.roles.push(role); }
        else { map[contactId].push({ id: d.id, name: d.name, roles: [role], status: d.status, dealType: d.dealType }); }
      };
      if (d.vendorAgentId) addFor(d.vendorAgentId, "Vendor Agent");
      if (d.acquisitionAgentId) addFor(d.acquisitionAgentId, "Acquisition Agent");
      if (d.purchaserAgentId) addFor(d.purchaserAgentId, "Purchaser Agent");
      if (d.leasingAgentId) addFor(d.leasingAgentId, "Leasing Agent");
    }
    return map;
  }, [allDeals]);

  const agentInvestmentByContact = useMemo(() => {
    const map: Record<string, { id: string; name: string; role: string; status?: string | null; guidePrice?: number | null }[]> = {};
    for (const item of investmentItems) {
      if (item.vendorAgentId) {
        if (!map[item.vendorAgentId]) map[item.vendorAgentId] = [];
        map[item.vendorAgentId].push({ id: item.id, name: item.assetName, role: "Vendor Agent", status: item.status, guidePrice: item.guidePrice });
      }
    }
    return map;
  }, [investmentItems]);

  const companyMap = useMemo(() => {
    const m: Record<string, CrmCompany> = {};
    for (const c of companies) m[c.id] = c;
    return m;
  }, [companies]);

  const agentCompanies = useMemo(() => {
    return companies.filter((c) => (c.companyType || "").toLowerCase() === "agent");
  }, [companies]);

  const agentContacts = useMemo(() => {
    return contacts.filter((c) => {
      const t = (c.contactType || "").toLowerCase();
      return t === "agent" || (c.companyId && agentCompanies.find((a) => a.id === c.companyId));
    });
  }, [contacts, agentCompanies]);

  const contactsByCompany = useMemo(() => {
    const map: Record<string, CrmContact[]> = {};
    agentContacts.forEach((c) => {
      if (c.companyId) {
        if (!map[c.companyId]) map[c.companyId] = [];
        map[c.companyId].push(c);
      }
    });
    return map;
  }, [agentContacts]);

  const locations = useMemo(() => {
    const locs = new Set<string>();
    agentCompanies.forEach((c) => {
      const addr = c.headOfficeAddress as any;
      if (addr?.city) locs.add(addr.city);
    });
    return Array.from(locs).sort();
  }, [agentCompanies]);

  const specialties = CRM_OPTIONS.agentSpecialty;

  const filtered = useMemo(() => {
    let list = agentCompanies;

    if (specialtyFilter) {
      const filterLower = specialtyFilter.toLowerCase().trim();
      const companiesWithSpecialty = new Set<string>();
      if (filterLower === "tenant rep") {
        agentContacts.forEach((c) => {
          if (agentReqCounts[c.id] > 0 && c.companyId) {
            companiesWithSpecialty.add(c.companyId);
          }
        });
      } else {
        agentContacts.forEach((c) => {
          if ((c.agentSpecialty || "").toLowerCase().trim() === filterLower && c.companyId) {
            companiesWithSpecialty.add(c.companyId);
          }
        });
      }
      list = list.filter((c) => companiesWithSpecialty.has(c.id));
    }

    if (locationFilter) {
      list = list.filter((c) => {
        const addr = c.headOfficeAddress as any;
        return addr?.city === locationFilter;
      });
    }

    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(s) ||
        (c.description || "").toLowerCase().includes(s) ||
        (contactsByCompany[c.id] || []).some((ct) =>
          (ct.name || "").toLowerCase().includes(s)
        )
      );
    }

    return list.sort((a, b) => {
      const ca = (contactsByCompany[a.id] || []).length;
      const cb = (contactsByCompany[b.id] || []).length;
      return cb - ca;
    });
  }, [agentCompanies, agentContacts, contactsByCompany, agentReqCounts, search, specialtyFilter, locationFilter]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="cursor-pointer" onClick={() => { setSpecialtyFilter(null); setLocationFilter(null); setSearch(""); }} data-testid="stat-agent-firms">
          <StatCard label="Agent Firms" value={agentCompanies.length} icon={Briefcase} color={!specialtyFilter ? "bg-blue-800 ring-2 ring-blue-400" : "bg-blue-600"} />
        </div>
        <div className="cursor-pointer" onClick={() => { setSpecialtyFilter(null); setLocationFilter(null); setSearch(""); }} data-testid="stat-individual-agents">
          <StatCard label="Individual Agents" value={agentContacts.length} icon={Users} color={!specialtyFilter ? "bg-indigo-800 ring-2 ring-indigo-400" : "bg-indigo-600"} />
        </div>
        <div className="cursor-pointer" onClick={() => setSpecialtyFilter(specialtyFilter === "Leasing" ? null : "Leasing")} data-testid="stat-leasing">
          <StatCard label="Leasing" value={agentContacts.filter(c => (c.agentSpecialty || "").toLowerCase() === "leasing").length} icon={Building} color={specialtyFilter === "Leasing" ? "bg-sky-800 ring-2 ring-sky-400" : "bg-sky-600"} />
        </div>
        <div className="cursor-pointer" onClick={() => setSpecialtyFilter(specialtyFilter === "Investment" ? null : "Investment")} data-testid="stat-investment">
          <StatCard label="Investment" value={agentContacts.filter(c => (c.agentSpecialty || "").toLowerCase() === "investment").length} icon={TrendingUp} color={specialtyFilter === "Investment" ? "bg-emerald-800 ring-2 ring-emerald-400" : "bg-emerald-600"} />
        </div>
        <div className="cursor-pointer" onClick={() => setSpecialtyFilter(specialtyFilter === "Tenant Rep" ? null : "Tenant Rep")} data-testid="stat-tenant-rep">
          <StatCard label="Tenant Rep" value={agentContacts.filter(c => agentReqCounts[c.id] > 0).length} icon={Handshake} color={specialtyFilter === "Tenant Rep" ? "bg-purple-800 ring-2 ring-purple-400" : "bg-purple-600"} />
        </div>
        <div className="cursor-pointer" onClick={() => setSpecialtyFilter(specialtyFilter === "Lease Advisory" ? null : "Lease Advisory")} data-testid="stat-lease-advisory">
          <StatCard label="Lease Advisory" value={agentContacts.filter(c => (c.agentSpecialty || "").toLowerCase() === "lease advisory").length} icon={Crown} color={specialtyFilter === "Lease Advisory" ? "bg-amber-800 ring-2 ring-amber-400" : "bg-amber-600"} />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search agents, firms, or people..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
            data-testid="input-search-agents"
          />
          {search && (
            <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearch("")}>
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border bg-muted p-0.5">
            <button
              onClick={() => setSpecialtyFilter(null)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                !specialtyFilter ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="filter-specialty-all"
            >
              All
            </button>
            {specialties.map((s) => (
              <button
                key={s}
                onClick={() => setSpecialtyFilter(specialtyFilter === s ? null : s)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  specialtyFilter === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`filter-specialty-${s.toLowerCase().replace(/\s/g, "-")}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {locations.length > 0 && (
          <select
            value={locationFilter || ""}
            onChange={(e) => setLocationFilter(e.target.value || null)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
            data-testid="select-location-filter"
          >
            <option value="">All Locations</option>
            {locations.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        )}

        <p className="text-sm text-muted-foreground">{filtered.length} firms</p>
      </div>

      <div className="space-y-2">
        {filtered.map((company) => {
          const compContacts = contactsByCompany[company.id] || [];
          const isExpanded = expandedCompany === company.id;

          return (
            <Card key={company.id} className="overflow-hidden group" data-testid={`card-agent-${company.id}`}>
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors relative"
                onClick={() => setExpandedCompany(isExpanded ? null : company.id)}
              >
                {onDeleteCompany && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteCompany(company.id, company.name); }}
                    className="absolute top-2 right-2 p-1 rounded-full opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all z-10"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <CompanyLogo company={company} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/companies/${company.id}`} onClick={(e: any) => e.stopPropagation()}>
                      <h3 className="font-semibold text-sm hover:underline truncate">{company.name}</h3>
                    </Link>
                    {company.domainUrl && (
                      <a
                        href={company.domainUrl.startsWith("http") ? company.domainUrl : `https://${company.domainUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Globe className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {(() => {
                      const addr = company.headOfficeAddress as any;
                      return addr?.city ? (
                        <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                          <MapPin className="w-3 h-3" />
                          {addr.city}
                        </span>
                      ) : null;
                    })()}
                    {company.description && (
                      <span className="text-xs text-muted-foreground truncate flex-1">{company.description}</span>
                    )}
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs">
                  <Users className="w-3 h-3 mr-1" />
                  {compContacts.length}
                </Badge>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </div>

              {isExpanded && compContacts.length > 0 && (
                <div className="border-t bg-muted/20">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
                    {compContacts.map((contact) => (
                      <Link key={contact.id} href={`/contacts/${contact.id}`}>
                        <div className="bg-background px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                              {(contact.name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{contact.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{contact.role || "Agent"}</p>
                            </div>
                            {contact.agentSpecialty && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {contact.agentSpecialty}
                              </Badge>
                            )}
                            {agentReqCounts[contact.id] > 0 && (
                              <Badge className="text-[10px] px-1.5 py-0 bg-purple-100 text-purple-700 hover:bg-purple-200" data-testid={`badge-agent-reqs-${contact.id}`}>
                                <ClipboardList className="w-3 h-3 mr-0.5" />
                                {agentReqCounts[contact.id]}
                              </Badge>
                            )}
                            {(agentDealsByContact[contact.id] || []).length > 0 && (
                              <Badge className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 hover:bg-emerald-200" data-testid={`badge-agent-deals-${contact.id}`}>
                                <Handshake className="w-3 h-3 mr-0.5" />
                                {(agentDealsByContact[contact.id] || []).length}
                              </Badge>
                            )}
                            {(agentInvestmentByContact[contact.id] || []).length > 0 && (
                              <Badge className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 hover:bg-blue-200" data-testid={`badge-agent-inv-${contact.id}`}>
                                <TrendingUp className="w-3 h-3 mr-0.5" />
                                {(agentInvestmentByContact[contact.id] || []).length}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            {contact.email && (
                              <span className="flex items-center gap-1 truncate">
                                <Mail className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{contact.email}</span>
                              </span>
                            )}
                            {contact.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{contact.phone}</span>
                              </span>
                            )}
                          </div>
                          {((agentReqsByContact[contact.id] || []).length > 0 || (agentDealsByContact[contact.id] || []).length > 0 || (agentInvestmentByContact[contact.id] || []).length > 0) && (
                            <div className="mt-2 pt-2 border-t border-dashed space-y-2">
                              {(agentReqsByContact[contact.id] || []).length > 0 && (
                                <div className="space-y-1" data-testid={`agent-reqs-summary-${contact.id}`}>
                                  <p className="text-[10px] font-medium text-purple-600 uppercase tracking-wide">Client Requirements</p>
                                  {(agentReqsByContact[contact.id] || []).map((req) => (
                                    <div key={req.id} className="flex items-center gap-1.5 text-[11px]">
                                      <ClipboardList className="w-3 h-3 text-purple-400 shrink-0" />
                                      <span className="truncate font-medium">{req.name}</span>
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">{req.type}</Badge>
                                      {req.status && <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">{req.status}</Badge>}
                                      {req.use && req.use.length > 0 && <span className="text-muted-foreground truncate">{req.use.join(", ")}</span>}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {(agentDealsByContact[contact.id] || []).length > 0 && (
                                <div className="space-y-1" data-testid={`agent-deals-summary-${contact.id}`}>
                                  <p className="text-[10px] font-medium text-emerald-600 uppercase tracking-wide">Deals</p>
                                  {(agentDealsByContact[contact.id] || []).map((deal) => (
                                    <div key={deal.id} className="flex items-center gap-1.5 text-[11px]">
                                      <Handshake className="w-3 h-3 text-emerald-400 shrink-0" />
                                      <span className="truncate font-medium">{deal.name}</span>
                                      {deal.roles.map((r) => <Badge key={r} className="text-[9px] px-1 py-0 bg-emerald-100 text-emerald-700 shrink-0">{r}</Badge>)}
                                      {deal.status && <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">{deal.status}</Badge>}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {(agentInvestmentByContact[contact.id] || []).length > 0 && (
                                <div className="space-y-1" data-testid={`agent-inv-summary-${contact.id}`}>
                                  <p className="text-[10px] font-medium text-blue-600 uppercase tracking-wide">Investment Tracker</p>
                                  {(agentInvestmentByContact[contact.id] || []).map((item) => (
                                    <div key={item.id} className="flex items-center gap-1.5 text-[11px]">
                                      <TrendingUp className="w-3 h-3 text-blue-400 shrink-0" />
                                      <span className="truncate font-medium">{item.name}</span>
                                      <Badge className="text-[9px] px-1 py-0 bg-blue-100 text-blue-700 shrink-0">{item.role}</Badge>
                                      {item.status && <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">{item.status}</Badge>}
                                      {item.guidePrice && <span className="text-muted-foreground">£{Number(item.guidePrice).toLocaleString()}</span>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {isExpanded && compContacts.length === 0 && (
                <div className="border-t px-4 py-4 text-center text-sm text-muted-foreground">
                  No contacts recorded for this firm
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// TenantsTab has been moved to Brand Intelligence (/brands?tab=explorer)
// TODO: Remove dead TenantsTab code below (~370 lines) — no longer rendered
type SubCategory = { key: string; label: string; icon: any; match: string[] };
type TopCategory = { key: string; label: string; icon: any; color: string; gradient: string; subs: SubCategory[] };

const TENANT_CATEGORIES: TopCategory[] = [
  {
    key: "luxury", label: "Luxury", icon: Diamond, color: "bg-yellow-600", gradient: "from-yellow-500 to-amber-600",
    subs: [
      { key: "luxury-fashion", label: "Luxury Fashion", icon: Crown, match: ["Tenant - Luxury", "Tenant - Luxury Fashion"] },
      { key: "luxury-accessories", label: "Luxury Accessories", icon: Gem, match: ["Tenant - Luxury Accessories"] },
      { key: "luxury-beauty", label: "Luxury Beauty", icon: Sparkles, match: ["Tenant - Luxury Beauty"] },
      { key: "watches-jewellery", label: "Watches & Jewellery", icon: Watch, match: ["Tenant - Jewellery & Watches", "Tenant - Jewellery", "Tenant - Watches"] },
    ],
  },
  {
    key: "retail", label: "Fashion & Retail", icon: Store, color: "bg-pink-600", gradient: "from-pink-500 to-rose-600",
    subs: [
      { key: "flagship-fashion", label: "Flagship Fashion", icon: Crown, match: ["Tenant - Flagship Fashion"] },
      { key: "fashion", label: "Fashion", icon: Shirt, match: ["Tenant - Fashion", "Tenant - Clothing", "Tenant - Apparel", "Tenant - Womenswear", "Tenant - Menswear", "Tenant - Kidswear", "Tenant - Lingerie"] },
      { key: "athleisure", label: "Athleisure", icon: Activity, match: ["Tenant - Athleisure", "Tenant - Sportswear"] },
      { key: "footwear", label: "Footwear", icon: Footprints, match: ["Tenant - Footwear", "Tenant - Shoes"] },
      { key: "accessories", label: "Accessories", icon: ShoppingBag, match: ["Tenant - Accessories & Footwear", "Tenant - Accessories"] },
      { key: "beauty", label: "Beauty / Skincare / Fragrance", icon: Sparkles, match: ["Tenant - Beauty", "Tenant - Skincare", "Tenant - Fragrance", "Tenant - Beauty & Wellness", "Tenant - Cosmetics"] },
      { key: "homewares", label: "Homewares", icon: Home, match: ["Tenant - Homewares", "Tenant - Home", "Tenant - Interiors"] },
      { key: "lifestyle", label: "Lifestyle & Home", icon: Flower2, match: ["Tenant - Lifestyle & Home", "Tenant - Lifestyle", "Tenant - Art"] },
      { key: "gifts", label: "Gifts & Perfumes", icon: Gift, match: ["Tenant - Gifts & Perfumes", "Tenant - Gifts", "Tenant - Gifts & Speciality"] },
      { key: "department", label: "Department Stores", icon: Building2, match: ["Tenant - Department Store"] },
      { key: "technology", label: "Technology & Electronics", icon: Smartphone, match: ["Tenant - Technology", "Tenant - Electronics", "Tenant - Tech"] },
      { key: "automotive", label: "Automotive", icon: Car, match: ["Tenant - Automotive", "Tenant - Cars"] },
      { key: "telecoms", label: "Telecoms", icon: Wifi, match: ["Tenant - Telecoms", "Tenant - Telecommunications"] },
      { key: "books", label: "Books & Stationery", icon: BookOpen, match: ["Tenant - Books", "Tenant - Stationery", "Tenant - Books & Stationery"] },
      { key: "financial", label: "Financial Services", icon: Landmark, match: ["Tenant - Financial Services", "Tenant - Bank", "Tenant - Finance"] },
      { key: "services", label: "Services", icon: Briefcase, match: ["Tenant - Services", "Tenant - Optician", "Tenant - Travel", "Tenant - Other Services"] },
      { key: "other-retail", label: "Other Retail", icon: Store, match: ["Tenant - Retail", "Tenant - General Retail"] },
    ],
  },
  {
    key: "restaurants", label: "Food & Drink", icon: Utensils, color: "bg-rose-600", gradient: "from-rose-500 to-red-600",
    subs: [
      { key: "fine-dining", label: "Fine Dining", icon: UtensilsCrossed, match: ["Tenant - Fine Dining"] },
      { key: "casual-dining", label: "Casual Dining", icon: Utensils, match: ["Tenant - Casual Dining", "Tenant - Restaurant", "Tenant - Food & Drink"] },
      { key: "quick-service", label: "Quick Service", icon: Soup, match: ["Tenant - Quick Service", "Tenant - Fast Casual", "Tenant - Fast Food", "Tenant - QSR"] },
      { key: "cafes", label: "Cafés & Coffee", icon: Coffee, match: ["Tenant - Café", "Tenant - Coffee", "Tenant - Café & Coffee", "Tenant - F&B"] },
      { key: "bars", label: "Bars & Pubs", icon: Wine, match: ["Tenant - Bar", "Tenant - Pub", "Tenant - Wine Bar"] },
      { key: "bakery", label: "Bakery & Patisserie", icon: CakeSlice, match: ["Tenant - Bakery", "Tenant - Patisserie"] },
    ],
  },
  {
    key: "national", label: "National & Regional", icon: MapPin, color: "bg-teal-600", gradient: "from-teal-500 to-emerald-600",
    subs: [
      { key: "grocery", label: "Grocery & Convenience", icon: ShoppingCart, match: ["Tenant - Grocery", "Tenant - Convenience", "Tenant - Supermarket"] },
      { key: "value-retail", label: "Value & Discount", icon: Tag, match: ["Tenant - Value Retail", "Tenant - Discount", "Tenant - Pound Store"] },
      { key: "trade-diy", label: "Trade & DIY", icon: Wrench, match: ["Tenant - Trade", "Tenant - DIY", "Tenant - Hardware", "Tenant - Builders Merchants"] },
      { key: "national-other", label: "Other National", icon: Building2, match: ["Tenant - National Retail", "Tenant - High Street"] },
    ],
  },
  {
    key: "leisure", label: "Leisure & Experience", icon: Clapperboard, color: "bg-purple-600", gradient: "from-purple-500 to-violet-600",
    subs: [
      { key: "cinema", label: "Cinema", icon: Tv, match: ["Tenant - Cinema", "Tenant - Cinema & Film"] },
      { key: "experiential", label: "Experiential", icon: PartyPopper, match: ["Tenant - Experiential", "Tenant - Activation", "Tenant - Entertainment"] },
      { key: "immersive", label: "Immersive Experience", icon: Zap, match: ["Tenant - Immersive Experience", "Tenant - Immersive"] },
      { key: "gaming", label: "Gaming & Escape Rooms", icon: Gamepad2, match: ["Tenant - Gaming", "Tenant - Escape Room", "Tenant - Bowling", "Tenant - Arcade"] },
      { key: "family", label: "Family Entertainment", icon: Baby, match: ["Tenant - Family Entertainment", "Tenant - Family", "Tenant - Soft Play", "Tenant - Kids Entertainment"] },
      { key: "leisure-other", label: "Other Leisure", icon: Clapperboard, match: ["Tenant - Leisure"] },
      { key: "arts", label: "Arts & Culture", icon: Palette, match: ["Tenant - Arts", "Tenant - Culture", "Tenant - Gallery"] },
    ],
  },
  {
    key: "health", label: "Health & Wellness", icon: Dumbbell, color: "bg-orange-600", gradient: "from-orange-500 to-amber-600",
    subs: [
      { key: "gym", label: "Gym & Fitness", icon: Dumbbell, match: ["Tenant - Gym", "Tenant - Fitness", "Tenant - Gym & Fitness", "Tenant - Health & Fitness"] },
      { key: "wellness", label: "Wellness & Spa", icon: Bath, match: ["Tenant - Wellness", "Tenant - Spa", "Tenant - Hair", "Tenant - Nails", "Tenant - Aesthetics"] },
      { key: "yoga", label: "Yoga & Pilates", icon: HeartPulse, match: ["Tenant - Yoga", "Tenant - Pilates"] },
    ],
  },
];

// Flat list of every match string across all subcategories — used for
// "does this company belong to ANY category" and top-level counting.
const ALL_SUB_MATCHES = TENANT_CATEGORIES.flatMap(cat => cat.subs.flatMap(s => s.match));

function companyMatchesSub(c: CrmCompany, sub: SubCategory): boolean {
  const t = (c.companyType || "").toLowerCase().trim();
  return sub.match.some(m => m.toLowerCase() === t);
}
function companyMatchesCat(c: CrmCompany, cat: TopCategory): boolean {
  return cat.subs.some(sub => companyMatchesSub(c, sub));
}

function TenantsTab({
  companies,
  contacts,
  onDeleteCompany,
  viewMode = "card",
}: {
  companies: CrmCompany[];
  contacts: CrmContact[];
  onDeleteCompany?: (id: string, name: string) => void;
  viewMode?: "table" | "card" | "board";
}) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeSub, setActiveSub] = useState<string | null>(null);

  const { data: leasingReqs = [] } = useQuery<CrmRequirementsLeasing[]>({
    queryKey: ["/api/crm/requirements-leasing"],
  });
  const { data: investmentReqs = [] } = useQuery<CrmRequirementsInvestment[]>({
    queryKey: ["/api/crm/requirements-investment"],
  });

  const reqCountsByCompany = useMemo(() => {
    const counts: Record<string, { leasing: number; investment: number }> = {};
    leasingReqs.forEach((r) => {
      if (r.companyId) {
        if (!counts[r.companyId]) counts[r.companyId] = { leasing: 0, investment: 0 };
        counts[r.companyId].leasing++;
      }
    });
    investmentReqs.forEach((r) => {
      if (r.companyId) {
        if (!counts[r.companyId]) counts[r.companyId] = { leasing: 0, investment: 0 };
        counts[r.companyId].investment++;
      }
    });
    return counts;
  }, [leasingReqs, investmentReqs]);

  const tenantCompanies = useMemo(() => {
    return companies.filter((c) => {
      const t = (c.companyType || "").toLowerCase();
      return t.startsWith("tenant");
    });
  }, [companies]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    TENANT_CATEGORIES.forEach(cat => {
      counts[cat.key] = tenantCompanies.filter(c => companyMatchesCat(c, cat)).length;
      cat.subs.forEach(sub => {
        counts[sub.key] = tenantCompanies.filter(c => companyMatchesSub(c, sub)).length;
      });
    });
    return counts;
  }, [tenantCompanies]);

  const contactsByCompany = useMemo(() => {
    const map: Record<string, CrmContact[]> = {};
    contacts.forEach((c) => {
      if (c.companyId) {
        if (!map[c.companyId]) map[c.companyId] = [];
        map[c.companyId].push(c);
      }
    });
    return map;
  }, [contacts]);

  const activeCatObj = TENANT_CATEGORIES.find(c => c.key === activeCategory);

  const filtered = useMemo(() => {
    let list = tenantCompanies;

    if (activeSub && activeCatObj) {
      const sub = activeCatObj.subs.find(s => s.key === activeSub);
      if (sub) list = list.filter(c => companyMatchesSub(c, sub));
    } else if (activeCatObj) {
      list = list.filter(c => companyMatchesCat(c, activeCatObj));
    }

    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(s) ||
        (c.description || "").toLowerCase().includes(s)
      );
    }

    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [tenantCompanies, activeCategory, activeSub, activeCatObj, search]);

  return (
    <div className="space-y-4">
      {/* Top-level category cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div
          className={`cursor-pointer rounded-xl p-4 text-white transition-all hover:scale-[1.02] active:scale-[0.98] ${
            activeCategory === null
              ? "bg-gradient-to-br from-teal-500 to-teal-700 shadow-lg ring-2 ring-teal-400 ring-offset-2"
              : "bg-gradient-to-br from-teal-500 to-teal-700 opacity-80 hover:opacity-100"
          }`}
          onClick={() => { setActiveCategory(null); setActiveSub(null); }}
          data-testid="stat-all"
        >
          <Store className="w-6 h-6 mb-2 opacity-90" />
          <div className="text-2xl font-bold">{tenantCompanies.length}</div>
          <div className="text-xs font-medium opacity-90 mt-0.5">All Brands</div>
        </div>
        {TENANT_CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat.key;
          const Icon = cat.icon;
          return (
            <div
              key={cat.key}
              className={`cursor-pointer rounded-xl p-4 text-white transition-all hover:scale-[1.02] active:scale-[0.98] bg-gradient-to-br ${cat.gradient} ${
                isActive ? "shadow-lg ring-2 ring-white/40 ring-offset-2" : "opacity-80 hover:opacity-100"
              }`}
              onClick={() => { setActiveCategory(isActive ? null : cat.key); setActiveSub(null); }}
              data-testid={`stat-${cat.key}`}
            >
              <Icon className="w-6 h-6 mb-2 opacity-90" />
              <div className="text-2xl font-bold">{categoryCounts[cat.key] || 0}</div>
              <div className="text-xs font-medium opacity-90 mt-0.5">{cat.label}</div>
            </div>
          );
        })}
      </div>

      {/* Subcategory pills — only show when a top-level category is selected */}
      {activeCatObj && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveSub(null)}
            className={`text-sm px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all border ${
              activeSub === null
                ? `${activeCatObj.color} text-white border-transparent shadow-sm`
                : "bg-muted/50 hover:bg-muted border-border text-foreground"
            }`}
          >
            All {activeCatObj.label} <span className="text-xs opacity-75">({categoryCounts[activeCatObj.key] || 0})</span>
          </button>
          {activeCatObj.subs.map(sub => {
            const count = categoryCounts[sub.key] || 0;
            const isActive = activeSub === sub.key;
            const Icon = sub.icon;
            return (
              <button
                key={sub.key}
                onClick={() => setActiveSub(isActive ? null : sub.key)}
                className={`text-sm px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all border ${
                  isActive
                    ? `${activeCatObj.color} text-white border-transparent shadow-sm`
                    : "bg-muted/50 hover:bg-muted border-border text-foreground"
                }`}
                data-testid={`sub-${sub.key}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {sub.label} <span className="text-xs opacity-75">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search brands..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
            data-testid="input-search-tenants"
          />
          {search && (
            <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearch("")}>
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{filtered.length} results</p>
      </div>

      {viewMode === "table" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead className="text-center">Contacts</TableHead>
                  <TableHead className="text-center">Requirements</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((company) => {
                  const compContacts = contactsByCompany[company.id] || [];
                  const reqs = reqCountsByCompany[company.id];
                  const totalReqs = reqs ? reqs.leasing + reqs.investment : 0;
                  return (
                    <TableRow key={company.id} className="cursor-pointer hover:bg-muted/50 group" onClick={() => window.location.href = `/companies/${company.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <CompanyLogo company={company} size="sm" />
                          <div className="min-w-0">
                            <span className="font-medium text-sm truncate">{company.name}</span>
                            {company.description && <p className="text-xs text-muted-foreground truncate max-w-[250px]">{company.description}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{company.companyType?.replace("Tenant - ", "") || "Tenant"}</TableCell>
                      <TableCell className="text-center text-sm">{compContacts.length}</TableCell>
                      <TableCell className="text-center text-sm">{totalReqs > 0 ? totalReqs : "—"}</TableCell>
                      <TableCell className="text-right">
                        {onDeleteCompany && (
                          <button onClick={(e) => { e.stopPropagation(); onDeleteCompany(company.id, company.name); }} className="p-1 rounded-full opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map((company) => {
          const compContacts = contactsByCompany[company.id] || [];
          const matchedCat = TENANT_CATEGORIES.find(cat => companyMatchesCat(company, cat));
          const sectorColor = matchedCat?.key === "retail"
            ? "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300"
            : matchedCat?.key === "restaurants"
              ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
              : matchedCat?.key === "leisure"
                ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                : matchedCat?.key === "health"
                  ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                  : "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300";

          return (
            <Link key={company.id} href={`/companies/${company.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full relative group" data-testid={`card-tenant-${company.id}`}>
                {onDeleteCompany && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteCompany(company.id, company.name); }}
                    className="absolute top-2 right-2 p-1 rounded-full opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all z-10"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <CardContent className="p-3.5">
                  <div className="flex items-center gap-2.5">
                    <CompanyLogo company={company} size="md" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm truncate">{company.name}</h3>
                      <Badge className={`text-[10px] px-1.5 py-0 mt-0.5 ${sectorColor} border-0`}>
                        {company.companyType?.replace("Tenant - ", "") || "Tenant"}
                      </Badge>
                    </div>
                  </div>
                  {company.description && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{company.description}</p>
                  )}
                  {(compContacts.length > 0 || reqCountsByCompany[company.id]) && (
                    <div className="mt-2 pt-2 border-t flex items-center gap-3 flex-wrap">
                      {compContacts.length > 0 && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {compContacts.length} {compContacts.length === 1 ? "contact" : "contacts"}
                        </p>
                      )}
                      {reqCountsByCompany[company.id] && (
                        <p className="text-xs flex items-center gap-1">
                          <ClipboardList className="w-3 h-3 text-blue-500" />
                          <span className="text-blue-600 dark:text-blue-400 font-medium">
                            {(reqCountsByCompany[company.id].leasing + reqCountsByCompany[company.id].investment)} {(reqCountsByCompany[company.id].leasing + reqCountsByCompany[company.id].investment) === 1 ? "requirement" : "requirements"}
                          </span>
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
      )}
    </div>
  );
}

const ContactsList = lazy(() => import("@/pages/contacts"));
const CompaniesList = lazy(() => import("@/pages/companies"));

type PeopleTab = "landlords" | "agents" | "tenants" | "contacts" | "all-companies";

const ALL_TABS: { key: PeopleTab; label: string; icon: any }[] = [
  { key: "landlords", label: "Landlords", icon: Building2 },
  { key: "agents", label: "Agents", icon: Briefcase },
  { key: "tenants", label: "Tenant Brands", icon: Store },
  { key: "contacts", label: "All Contacts", icon: Users },
  { key: "all-companies", label: "All Companies", icon: Building },
];

const SCOPED_TABS: { key: PeopleTab; label: string; icon: any }[] = [
  { key: "agents", label: "Agents", icon: Briefcase },
  { key: "tenants", label: "Tenant Brands", icon: Store },
];

const LANDSEC_TABS: { key: PeopleTab; label: string; icon: any }[] = [
  { key: "agents", label: "Agents", icon: Briefcase },
  { key: "tenants", label: "Tenant Brands", icon: Store },
  { key: "contacts", label: "All Contacts", icon: Users },
  { key: "all-companies", label: "All Companies", icon: Building },
];

export default function PeoplePage() {
  const [, companyParams] = useRoute("/companies/:id");
  const [, contactParams] = useRoute("/contacts/:id");

  if (companyParams?.id) {
    return (
      <Suspense fallback={<PageLoader />}>
        <CompanyDetailPage />
      </Suspense>
    );
  }

  if (contactParams?.id) {
    return (
      <Suspense fallback={<PageLoader />}>
        <ContactDetailPage />
      </Suspense>
    );
  }

  return <PeopleHub />;
}

function PeopleHub() {
  const { activeTeam } = useTeam();
  const { toast } = useToast();
  const { data: user } = useQuery<User>({ queryKey: ["/api/auth/me"] });
  const effectiveTeam = activeTeam && activeTeam !== "all" ? activeTeam : user?.team;
  const isLandsec = effectiveTeam === "Landsec";

  const [tab, setTab] = useState<PeopleTab>(isLandsec ? "agents" : "landlords");
  const [viewMode, setViewMode] = useState<"table" | "card" | "board">("card");
  const [scopedLandlord, setScopedLandlord] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "company" | "contact"; id: string; name: string } | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async ({ type, id }: { type: "company" | "contact"; id: string }) => {
      await apiRequest("DELETE", `/api/crm/${type === "company" ? "companies" : "contacts"}/${id}`);
    },
    onSuccess: () => {
      toast({ title: `${deleteTarget?.type === "company" ? "Company" : "Contact"} deleted` });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const onDeleteCompany = (id: string, name: string) => setDeleteTarget({ type: "company", id, name });
  const onDeleteContact = (id: string, name: string) => setDeleteTarget({ type: "contact", id, name });
  const landsecAppliedRef = useRef(false);
  useEffect(() => {
    if (isLandsec && !landsecAppliedRef.current && tab === "landlords") {
      setTab("agents");
      landsecAppliedRef.current = true;
    }
  }, [isLandsec]);

  const { data: companies = [], isLoading: companiesLoading } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
  });

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
  });

  const { data: properties = [] } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });

  const { data: deals = [] } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals"],
  });

  const isLoading = companiesLoading || contactsLoading;

  const landlordCompanies = useMemo(() => {
    return companies.filter((c) => {
      const t = (c.companyType || "").toLowerCase().trim();
      return t === "landlord" || t === "client" || t === "landlord / client" || c.isPortfolioAccount;
    });
  }, [companies]);

  const scopedLandlordCompany = scopedLandlord ? companies.find(c => c.id === scopedLandlord) : null;
  const tabs = scopedLandlord ? SCOPED_TABS : isLandsec ? LANDSEC_TABS : ALL_TABS;

  const handleScopeLandlord = (id: string) => {
    setScopedLandlord(id);
    setTab("agents");
  };

  const handleClearScope = () => {
    setScopedLandlord(null);
    setTab(isLandsec ? "agents" : "landlords");
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            {scopedLandlordCompany ? `${scopedLandlordCompany.name} — People Hub` : "People Hub"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {scopedLandlordCompany
              ? "Agents & tenants relevant to this landlord"
              : `${companies.length.toLocaleString()} companies · ${contacts.length.toLocaleString()} contacts`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle view={viewMode} onToggle={setViewMode} />
          {scopedLandlord && (
          <button
            onClick={handleClearScope}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground border rounded-md px-3 py-1.5 hover:bg-muted transition-colors"
            data-testid="button-clear-scope"
          >
            <X className="w-3.5 h-3.5" />
            Show all
          </button>
        )}
        </div>
      </div>

      <div className="flex items-center gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
            }`}
            data-testid={`tab-${t.key}`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <PageLoader />
      ) : (
        <>
          {tab === "landlords" && !scopedLandlord && (
            <LandlordsTab
              companies={companies}
              contacts={contacts}
              properties={properties}
              deals={deals}
              onScopeLandlord={handleScopeLandlord}
              onDeleteCompany={onDeleteCompany}
              viewMode={viewMode}
            />
          )}
          {tab === "agents" && (
            <AgentsTab companies={companies} contacts={contacts} defaultTenantRep={isLandsec} onDeleteCompany={onDeleteCompany} />
          )}
          {tab === "tenants" && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center">
                <Store className="w-8 h-8 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Brand Explorer has moved</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  The full brand board with category filters, subcategories, and turnover data is now in Brand Intelligence.
                </p>
              </div>
              <Link href="/brands?tab=explorer">
                <Button className="bg-gradient-to-r from-pink-500 to-rose-600 hover:from-pink-600 hover:to-rose-700 text-white">
                  Open Brand Explorer <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          )}
          {tab === "contacts" && !scopedLandlord && (
            <Suspense fallback={<PageLoader />}>
              <ContactsList />
            </Suspense>
          )}
          {tab === "all-companies" && !scopedLandlord && (
            <Suspense fallback={<PageLoader />}>
              <CompaniesList />
            </Suspense>
          )}
        </>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.type === "company" ? "Company" : "Contact"}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate({ type: deleteTarget.type, id: deleteTarget.id })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

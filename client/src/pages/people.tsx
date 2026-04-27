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
  Building2, Users, Crown, Search, Globe, MapPin,
  ChevronRight, ChevronDown, Building, Briefcase,
  Phone, Mail, X, TrendingUp, Trash2,
  Handshake, ClipboardList,
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

type PeopleTab = "landlords" | "agents";

const ALL_TABS: { key: PeopleTab; label: string; icon: any }[] = [
  { key: "landlords", label: "Landlords", icon: Building2 },
  { key: "agents", label: "Agents", icon: Briefcase },
];

const SCOPED_TABS: { key: PeopleTab; label: string; icon: any }[] = [
  { key: "agents", label: "Agents", icon: Briefcase },
];

const LANDSEC_TABS: { key: PeopleTab; label: string; icon: any }[] = [
  { key: "agents", label: "Agents", icon: Briefcase },
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

  const agentCompaniesCount = useMemo(() => {
    return companies.filter((c) => (c.companyType || "").toLowerCase().trim() === "agent").length;
  }, [companies]);

  // Contacts visible in this hub = those tied to a landlord or agent company.
  // Excludes brand/tenant contacts (which live in Brands Hub).
  const hubContactCount = useMemo(() => {
    const hubCompanyIds = new Set<string>([
      ...landlordCompanies.map((c) => c.id),
      ...companies.filter((c) => (c.companyType || "").toLowerCase().trim() === "agent").map((c) => c.id),
    ]);
    return contacts.filter((c) => c.companyId && hubCompanyIds.has(c.companyId)).length;
  }, [contacts, companies, landlordCompanies]);

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
              : `${landlordCompanies.length.toLocaleString()} landlords · ${agentCompaniesCount.toLocaleString()} agents · ${hubContactCount.toLocaleString()} contacts`}
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

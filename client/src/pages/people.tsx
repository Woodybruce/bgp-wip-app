import { lazy, Suspense, useState, useMemo, useEffect, useRef } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useTeam } from "@/lib/team-context";
import type { User } from "@shared/schema";
import {
  Building2, Users, Store, Crown, Search, Globe, MapPin,
  ChevronRight, ChevronDown, Building, Briefcase,
  Phone, Mail, X, TrendingUp,
  Handshake, ShoppingBag,
  Utensils, Clapperboard, ClipboardList, Dumbbell,
} from "lucide-react";
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
  const [primaryFailed, setPrimaryFailed] = useState(false);
  const [guessedFailed, setGuessedFailed] = useState(false);

  const sizeClass = size === "sm" ? "w-8 h-8" : size === "lg" ? "w-14 h-14" : "w-10 h-10";
  const textSize = size === "sm" ? "text-xs" : size === "lg" ? "text-lg" : "text-sm";
  const px = size === "sm" ? 32 : size === "lg" ? 56 : 40;

  const domain = company.domainUrl || company.logoUrl || company.domain;
  const d = extractDomain(domain || null);
  const guessed = (!d || primaryFailed) ? guessDomain(company.name) : null;

  if ((!d || primaryFailed) && (!guessed || guessedFailed)) {
    const initials = (company.name || "?").split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
    return (
      <div className={`${sizeClass} rounded-lg bg-muted flex items-center justify-center ${textSize} font-semibold text-muted-foreground border`}>
        {initials}
      </div>
    );
  }

  // Use Clearbit Logo API for crisp HD logos (up to 512px)
  // Falls back to Google Favicons if Clearbit doesn't have the logo
  const targetDomain = d && !primaryFailed ? d : guessed;
  const logoUrl = `https://logo.clearbit.com/${targetDomain}?size=${Math.min(px * 3, 512)}`;

  return (
    <img
      src={logoUrl}
      alt={company.name}
      className={`${sizeClass} rounded-lg object-contain bg-white border`}
      onError={() => {
        if (d && !primaryFailed) setPrimaryFailed(true);
        else setGuessedFailed(true);
      }}
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
}: {
  companies: CrmCompany[];
  contacts: CrmContact[];
  properties: CrmProperty[];
  deals: CrmDeal[];
  onScopeLandlord?: (id: string) => void;
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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map((company) => {
          const compContacts = contactsByCompany[company.id] || [];
          const compProps = propertiesByLandlord[company.id] || [];
          const compDeals = dealsByLandlord[company.id] || [];
          const isClient = clientLandlords.some((cl) => cl.id === company.id);
          return (
            <Link key={company.id} href={`/companies/${company.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full" data-testid={`card-landlord-${company.id}`}>
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
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Building className="w-3 h-3" />
                      {compProps.length} {compProps.length === 1 ? "property" : "properties"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Handshake className="w-3 h-3" />
                      {compDeals.length} {compDeals.length === 1 ? "deal" : "deals"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {compContacts.length} {compContacts.length === 1 ? "contact" : "contacts"}
                    </span>
                    {onScopeLandlord && (
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onScopeLandlord(company.id); }}
                        className="ml-auto flex items-center gap-1 text-primary hover:text-primary/80 font-medium"
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
    </div>
  );
}

function AgentsTab({
  companies,
  contacts,
  defaultTenantRep,
}: {
  companies: CrmCompany[];
  contacts: CrmContact[];
  defaultTenantRep?: boolean;
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
            <Card key={company.id} className="overflow-hidden" data-testid={`card-agent-${company.id}`}>
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedCompany(isExpanded ? null : company.id)}
              >
                <CompanyLogo company={company} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/companies/${company.id}`} onClick={(e: any) => e.stopPropagation()}>
                      <h3 className="font-semibold text-sm hover:underline">{company.name}</h3>
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
                      <span className="text-xs text-muted-foreground truncate max-w-[200px]">{company.description}</span>
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

const TENANT_SECTORS = [
  { key: "all", label: "All Tenants", icon: Store },
  { key: "retail", label: "Retail", icon: ShoppingBag, match: ["Tenant - Retail", "Tenant"] },
  { key: "restaurant", label: "Restaurants", icon: Utensils, match: ["Tenant - Restaurant"] },
  { key: "leisure", label: "Leisure", icon: Clapperboard, match: ["Tenant - Leisure"] },
  { key: "gym", label: "Gym / Fitness", icon: Dumbbell, match: ["Tenant - Gym", "Tenant - Fitness", "Tenant - Health & Fitness"] },
];

function TenantsTab({
  companies,
  contacts,
}: {
  companies: CrmCompany[];
  contacts: CrmContact[];
}) {
  const [search, setSearch] = useState("");
  const [activeSector, setActiveSector] = useState("all");

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

  const sectorCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tenantCompanies.length };
    TENANT_SECTORS.forEach((s) => {
      if (s.key === "all") return;
      counts[s.key] = tenantCompanies.filter((c) =>
        s.match?.some((m) => (c.companyType || "").toLowerCase().trim() === m.toLowerCase())
      ).length;
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

  const filtered = useMemo(() => {
    let list = tenantCompanies;

    if (activeSector !== "all") {
      const sector = TENANT_SECTORS.find((s) => s.key === activeSector);
      if (sector?.match) {
        list = list.filter((c) => sector.match!.some((m) => (c.companyType || "").toLowerCase().trim() === m.toLowerCase()));
      }
    }

    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(s) ||
        (c.description || "").toLowerCase().includes(s)
      );
    }

    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [tenantCompanies, activeSector, search]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="cursor-pointer" onClick={() => setActiveSector("all")} data-testid="stat-all-tenants">
          <StatCard label="All Tenants" value={sectorCounts.all} icon={Store} color={activeSector === "all" ? "bg-teal-800 ring-2 ring-teal-400" : "bg-teal-600"} />
        </div>
        <div className="cursor-pointer" onClick={() => setActiveSector(activeSector === "retail" ? "all" : "retail")} data-testid="stat-retail">
          <StatCard label="Retail" value={sectorCounts.retail} icon={ShoppingBag} color={activeSector === "retail" ? "bg-sky-800 ring-2 ring-sky-400" : "bg-sky-600"} />
        </div>
        <div className="cursor-pointer" onClick={() => setActiveSector(activeSector === "restaurant" ? "all" : "restaurant")} data-testid="stat-restaurants">
          <StatCard label="Restaurants" value={sectorCounts.restaurant} icon={Utensils} color={activeSector === "restaurant" ? "bg-rose-800 ring-2 ring-rose-400" : "bg-rose-600"} />
        </div>
        <div className="cursor-pointer" onClick={() => setActiveSector(activeSector === "leisure" ? "all" : "leisure")} data-testid="stat-leisure">
          <StatCard label="Leisure" value={sectorCounts.leisure} icon={Clapperboard} color={activeSector === "leisure" ? "bg-purple-800 ring-2 ring-purple-400" : "bg-purple-600"} />
        </div>
        <div className="cursor-pointer" onClick={() => setActiveSector(activeSector === "gym" ? "all" : "gym")} data-testid="stat-gym">
          <StatCard label="Gym / Fitness" value={sectorCounts.gym || 0} icon={Dumbbell} color={activeSector === "gym" ? "bg-orange-800 ring-2 ring-orange-400" : "bg-orange-600"} />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search tenants..."
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map((company) => {
          const compContacts = contactsByCompany[company.id] || [];
          const ct = (company.companyType || "").toLowerCase();
          const sectorColor = ct.includes("restaurant")
            ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
            : ct.includes("leisure")
              ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
              : ct.includes("gym") || ct.includes("fitness") || ct.includes("health")
                ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                : "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300";

          return (
            <Link key={company.id} href={`/companies/${company.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full" data-testid={`card-tenant-${company.id}`}>
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
    </div>
  );
}

const ContactsList = lazy(() => import("@/pages/contacts"));
const CompaniesList = lazy(() => import("@/pages/companies"));

type PeopleTab = "landlords" | "agents" | "tenants" | "contacts" | "all-companies";

const ALL_TABS: { key: PeopleTab; label: string; icon: any }[] = [
  { key: "landlords", label: "Landlords", icon: Building2 },
  { key: "agents", label: "Agents", icon: Briefcase },
  { key: "tenants", label: "Tenants", icon: Store },
  { key: "contacts", label: "All Contacts", icon: Users },
  { key: "all-companies", label: "All Companies", icon: Building },
];

const SCOPED_TABS: { key: PeopleTab; label: string; icon: any }[] = [
  { key: "agents", label: "Agents", icon: Briefcase },
  { key: "tenants", label: "Tenants", icon: Store },
];

const LANDSEC_TABS: { key: PeopleTab; label: string; icon: any }[] = [
  { key: "agents", label: "Agents", icon: Briefcase },
  { key: "tenants", label: "Tenants", icon: Store },
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
  const { data: user } = useQuery<User>({ queryKey: ["/api/auth/me"] });
  const effectiveTeam = activeTeam && activeTeam !== "all" ? activeTeam : user?.team;
  const isLandsec = effectiveTeam === "Landsec";

  const [tab, setTab] = useState<PeopleTab>(isLandsec ? "agents" : "landlords");
  const [scopedLandlord, setScopedLandlord] = useState<string | null>(null);
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
            />
          )}
          {tab === "agents" && (
            <AgentsTab companies={companies} contacts={contacts} defaultTenantRep={isLandsec} />
          )}
          {tab === "tenants" && (
            <TenantsTab companies={companies} contacts={contacts} />
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
    </div>
  );
}

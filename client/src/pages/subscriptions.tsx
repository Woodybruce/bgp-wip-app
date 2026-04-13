import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ExternalLink, Search, Building2, FileText, MapPin, Newspaper, ShieldCheck, Mail, HardDrive, Rocket, Presentation, LineChart, Palette, Globe, ChevronDown, ChevronUp, KeyRound, CheckCircle2, XCircle, RefreshCw, Zap, Loader2 } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

type IntegrationItem = {
  key: string;
  label: string;
  group: string;
  configured: boolean;
  resolvedFrom: string | null;
  masked: string | null;
  fallbacks: string[];
};
type IntegrationsStatus = {
  total: number;
  configured: number;
  missing: number;
  items: IntegrationItem[];
  grouped: Record<string, IntegrationItem[]>;
};
type PingResult = { ok: boolean; status?: number; message: string };
type PingResponse = { apollo: PingResult; companiesHouse: PingResult; xero: PingResult };

interface Subscription {
  name: string;
  category: string;
  description: string;
  url: string;
  icon: any;
  color: string;
  hasApi: boolean;
  apiNote?: string;
}

const subscriptions: Subscription[] = [
  {
    name: "Dun & Bradstreet",
    category: "Business Intelligence",
    description: "Company credit reports, financial data, and business intelligence for tenant and counterparty due diligence.",
    url: "https://www.dnb.co.uk",
    icon: ShieldCheck,
    color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    hasApi: true,
    apiNote: "D&B Direct API available for company lookups and credit checks",
  },
  {
    name: "Edozo / GOAD",
    category: "Property Data",
    description: "Retail location mapping and GOAD plans. 100 GOAD tokens included in subscription.",
    url: "https://www.edozo.com",
    icon: MapPin,
    color: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    hasApi: false,
  },
  {
    name: "Green Street / React News",
    category: "News & Research",
    description: "Property market news, research, and analysis covering UK and European real estate.",
    url: "https://www.reactnews.com",
    icon: Newspaper,
    color: "bg-green-500/10 text-green-600 dark:text-green-400",
    hasApi: false,
  },
  {
    name: "KYC4U",
    category: "Compliance",
    description: "Know Your Customer checks and anti-money laundering compliance for property transactions.",
    url: "https://www.kyc4u.com",
    icon: ShieldCheck,
    color: "bg-red-500/10 text-red-600 dark:text-red-400",
    hasApi: false,
  },
  {
    name: "Land Registry",
    category: "Property Data",
    description: "HM Land Registry — title searches, ownership records, and transaction data for England and Wales.",
    url: "https://www.gov.uk/government/organisations/land-registry",
    icon: FileText,
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    hasApi: true,
    apiNote: "Land Registry Business Gateway API for title searches",
  },
  {
    name: "Propel Hospitality",
    category: "News & Research",
    description: "Hospitality industry news, data, and networking for the UK food and beverage sector.",
    url: "https://www.propelhospitality.com",
    icon: Newspaper,
    color: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    hasApi: false,
  },
  {
    name: "PIPNET",
    category: "Property Data",
    description: "Property Industry Protocol Network — property listing and matching platform.",
    url: "https://www.pipnet.com",
    icon: Globe,
    color: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    hasApi: false,
  },
  {
    name: "Requirement List",
    category: "Property Data",
    description: "Tenant requirement and property availability listing platform.",
    url: "https://www.requirementlist.com",
    icon: FileText,
    color: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    hasApi: false,
  },
  {
    name: "Business in Fashion",
    category: "News & Research",
    description: "Fashion and retail industry news and intelligence for retail property decisions.",
    url: "https://www.businessoffashion.com",
    icon: Newspaper,
    color: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
    hasApi: false,
  },
  {
    name: "Campaign Monitor",
    category: "Marketing",
    description: "Email marketing platform for property mailouts, newsletters, and client communications.",
    url: "https://www.campaignmonitor.com",
    icon: Mail,
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    hasApi: true,
    apiNote: "Full REST API for campaigns, lists, and analytics",
  },
  {
    name: "ChatGPT",
    category: "AI Tools",
    description: "OpenAI's ChatGPT — already integrated as Chat BGP within this dashboard.",
    url: "https://chat.openai.com",
    icon: Globe,
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    hasApi: true,
    apiNote: "Already integrated as Chat BGP",
  },
  {
    name: "Dropbox",
    category: "File Storage",
    description: "Cloud file storage and sharing for documents, presentations, and team files.",
    url: "https://www.dropbox.com",
    icon: HardDrive,
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    hasApi: true,
    apiNote: "Dropbox API v2 for file browsing and uploads",
  },
  {
    name: "RocketReach",
    category: "Business Intelligence",
    description: "Contact and lead enrichment — find email addresses and phone numbers for prospects.",
    url: "https://rocketreach.co",
    icon: Rocket,
    color: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    hasApi: true,
    apiNote: "REST API for contact lookups and enrichment",
  },
  {
    name: "Gamma",
    category: "Presentations",
    description: "AI-powered presentation and document creation tool.",
    url: "https://gamma.app",
    icon: Presentation,
    color: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    hasApi: false,
  },
  {
    name: "Real Capital Analytics",
    category: "Property Data",
    description: "Global commercial real estate transaction data, analytics, and market trends.",
    url: "https://www.rcanalytics.com",
    icon: LineChart,
    color: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
    hasApi: true,
    apiNote: "RCA API available for transaction data queries",
  },
  {
    name: "Property Week",
    category: "News & Research",
    description: "UK commercial property news, deals, and market intelligence.",
    url: "https://www.propertyweek.com",
    icon: Newspaper,
    color: "bg-red-500/10 text-red-600 dark:text-red-400",
    hasApi: false,
  },
  {
    name: "Canva",
    category: "Design",
    description: "Design platform for marketing materials, presentations, and social media graphics.",
    url: "https://www.canva.com",
    icon: Palette,
    color: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    hasApi: true,
    apiNote: "Canva Connect API for design workflows",
  },
];

const categories = Array.from(new Set(subscriptions.map((s) => s.category)));

export default function Subscriptions() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [keysExpanded, setKeysExpanded] = useState(false);

  const { data: keyStatus, isLoading: keysLoading, refetch: refetchKeys, isFetching: keysFetching } = useQuery<IntegrationsStatus>({
    queryKey: ["/api/integrations/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/integrations/status");
      return res.json();
    },
  });

  const [pingResult, setPingResult] = useState<PingResponse | null>(null);
  const [pinging, setPinging] = useState(false);
  const runPing = async () => {
    setPinging(true);
    try {
      const res = await apiRequest("GET", "/api/integrations/ping");
      setPingResult(await res.json());
    } catch (err: any) {
      setPingResult({
        apollo: { ok: false, message: "Request failed" },
        companiesHouse: { ok: false, message: "Request failed" },
        xero: { ok: false, message: "Request failed" },
      });
    } finally {
      setPinging(false);
    }
  };

  const filtered = subscriptions.filter((s) => {
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase());
    const matchCategory = !selectedCategory || s.category === selectedCategory;
    return matchSearch && matchCategory;
  });

  const apiCount = subscriptions.filter((s) => s.hasApi).length;
  const totalCount = subscriptions.length;

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="subscriptions-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Subscriptions & Tools</h1>
          <p className="text-sm text-muted-foreground">
            {totalCount} services · {apiCount} with API integration potential
          </p>
        </div>
      </div>

      <Card data-testid="integrations-status-panel">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <KeyRound className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">API Keys & Environment</h2>
                <p className="text-xs text-muted-foreground">
                  {keysLoading ? (
                    "Checking configured keys…"
                  ) : keyStatus ? (
                    <>
                      <span className="text-primary font-medium">{keyStatus.configured}</span> configured
                      {keyStatus.missing > 0 ? (
                        <>
                          {" · "}
                          <span className="text-destructive font-medium">{keyStatus.missing}</span> missing
                        </>
                      ) : null}
                      {" · "}
                      {keyStatus.total} total
                    </>
                  ) : (
                    "Status unavailable"
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={runPing}
                disabled={pinging}
                data-testid="button-ping-integrations"
              >
                {pinging ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 mr-1.5" />}
                Test Apollo / Xero / CH
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => refetchKeys()}
                disabled={keysFetching}
                data-testid="button-refresh-key-status"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${keysFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setKeysExpanded((v) => !v)}
                data-testid="button-toggle-key-status"
              >
                {keysExpanded ? <ChevronUp className="w-3.5 h-3.5 mr-1.5" /> : <ChevronDown className="w-3.5 h-3.5 mr-1.5" />}
                {keysExpanded ? "Hide" : "Show"}
              </Button>
            </div>
          </div>

          {pingResult && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
              {([
                { label: "Apollo.io", result: pingResult.apollo, testId: "ping-apollo" },
                { label: "Companies House", result: pingResult.companiesHouse, testId: "ping-companies-house" },
                { label: "Xero", result: pingResult.xero, testId: "ping-xero" },
              ] as const).map(({ label, result, testId }) => (
                <div
                  key={label}
                  className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                    result.ok
                      ? "border-primary/30 bg-primary/5"
                      : "border-destructive/30 bg-destructive/5"
                  }`}
                  data-testid={testId}
                >
                  {result.ok ? (
                    <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {label}
                      {result.status ? <span className="text-muted-foreground font-normal ml-1">({result.status})</span> : null}
                    </p>
                    <p className="text-muted-foreground leading-snug">{result.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {keysExpanded && keyStatus && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 pt-1">
              {Object.entries(keyStatus.grouped).map(([group, items]) => (
                <div key={group} className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{group}</p>
                  {items.map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between gap-2 text-xs"
                      data-testid={`key-status-${item.key}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {item.configured ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                        )}
                        <span className="truncate">{item.label}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground shrink-0 font-mono">
                        {item.configured ? (
                          <>
                            {item.resolvedFrom && item.resolvedFrom !== item.key ? (
                              <span className="text-amber-600 dark:text-amber-400 mr-1" title={`Resolved from fallback: ${item.resolvedFrom}`}>
                                ↻
                              </span>
                            ) : null}
                            {item.masked}
                          </>
                        ) : (
                          "not set"
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search subscriptions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-subscriptions"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            variant={!selectedCategory ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setSelectedCategory(null)}
            data-testid="filter-category-all"
          >
            All
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat}
              variant={selectedCategory === cat ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setSelectedCategory(cat)}
              data-testid={`filter-category-${cat.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((sub) => {
          const Icon = sub.icon;
          const isExpanded = expandedCard === sub.name;
          return (
            <Card
              key={sub.name}
              className="hover:border-primary/30 transition-colors"
              data-testid={`subscription-card-${sub.name.toLowerCase().replace(/[\s\/]+/g, "-")}`}
            >
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${sub.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold truncate">{sub.name}</h3>
                      {sub.hasApi && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                          API
                        </Badge>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 mt-1">
                      {sub.category}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{sub.description}</p>
                    {sub.apiNote && isExpanded && (
                      <p className="text-xs text-primary/80 mt-1.5 italic">{sub.apiNote}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-4 pt-3 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setExpandedCard(isExpanded ? null : sub.name)}
                    data-testid={`button-expand-${sub.name.toLowerCase().replace(/[\s\/]+/g, "-")}`}
                  >
                    {isExpanded ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
                    {isExpanded ? "Less" : "More"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => window.open(sub.url, "_blank", "noopener,noreferrer")}
                    data-testid={`button-open-${sub.name.toLowerCase().replace(/[\s\/]+/g, "-")}`}
                  >
                    <ExternalLink className="w-3 h-3 mr-1" />
                    Open
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Search className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-30" />
            <p className="text-sm text-muted-foreground">No subscriptions match your search</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

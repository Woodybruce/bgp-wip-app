import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  User,
  Building2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  ChevronDown,
  FileText,
  Link as LinkIcon,
  Eye,
  Scale,
  Landmark,
  MapPin,
  RefreshCw,
  Clock,
  Home,
  UserSearch,
  ListChecks,
  CalendarClock,
} from "lucide-react";
import { PageLayout } from "@/components/page-layout";
import { AddressAutocomplete } from "@/components/address-autocomplete";

interface InvestigationResult {
  subject: { name: string; companyNumber?: string; type: string };
  companyProfile?: any;
  officers?: any[];
  pscs?: any[];
  ownershipChain?: any;
  filingHistory?: any[];
  insolvencyHistory?: any[];
  sanctionsScreening?: any[];
  aiAnalysis?: string;
  riskScore?: number;
  riskLevel?: string;
  flags?: string[];
  charges?: any[];
  propertyContext?: any;
  propertiesOwned?: any;
  timestamp: string;
}

interface IndividualResult {
  subject: { name: string; type: string; dateOfBirth?: string };
  officerMatches?: any[];
  associatedCompanies?: any[];
  sanctionsScreening?: any[];
  aiAnalysis?: string;
  riskScore?: number;
  riskLevel?: string;
  flags?: string[];
  timestamp: string;
}

interface SearchResult {
  source: string;
  companyNumber?: string;
  name: string;
  status?: string;
  incorporatedDate?: string;
  address?: string;
  crmId?: number;
  kycStatus?: string;
}

interface HistoryItem {
  id: string;
  subject_type: string;
  subject_name: string;
  company_number: string;
  risk_level: string;
  risk_score: number;
  sanctions_match: boolean;
  conducted_by: string;
  conducted_at: string;
  notes: string;
  sources?: string[];
}

// Friendly labels + tones for the investigation sources returned by
// /api/kyc-clouseau/recent (derived from the result JSON).
const CLOUSEAU_SOURCE_META: Record<string, { label: string; tone: string; title: string }> = {
  companies_house: { label: "CH", tone: "border-blue-300 text-blue-700 bg-blue-50", title: "Companies House filings, officers, PSCs" },
  sanctions: { label: "OFSI/OFAC", tone: "border-red-300 text-red-700 bg-red-50", title: "UK OFSI + US OFAC sanctions screening" },
  perplexity: { label: "Adverse media", tone: "border-purple-300 text-purple-700 bg-purple-50", title: "Perplexity adverse media web scan" },
  land_registry: { label: "Land Registry", tone: "border-emerald-300 text-emerald-700 bg-emerald-50", title: "HM Land Registry / PropertyData titles" },
  ai: { label: "AI", tone: "border-amber-300 text-amber-700 bg-amber-50", title: "Claude AI analysis" },
};

function cloustauSourcesFromResult(result: any): string[] {
  if (!result || typeof result !== "object") return [];
  const seen = new Set<string>();
  if (result.companyProfile?.company_number || Array.isArray(result.officers) || Array.isArray(result.pscs)) seen.add("companies_house");
  if (Array.isArray(result.sanctionsScreening)) seen.add("sanctions");
  if (result.adverseMedia || Array.isArray(result.perplexityResults) || Array.isArray(result.adverseMediaFindings)) seen.add("perplexity");
  if (result.propertiesOwned || result.propertyContext || result.landRegistry || result.matched) seen.add("land_registry");
  if (typeof result.aiAnalysis === "string" && result.aiAnalysis.length > 10) seen.add("ai");
  const order = ["companies_house", "sanctions", "perplexity", "land_registry", "ai"];
  return order.filter(s => seen.has(s));
}

interface PropertyResolveResult {
  resolvedAddress: string;
  resolvedPostcode: string;
  buildingName?: string;
  matched: { freeholds: any[]; leaseholds: any[]; exact: boolean };
  fallback: { freeholds: any[]; leaseholds: any[]; usedStreetNumberMatch: boolean };
  context: { freeholds: any[]; leaseholds: any[] };
  source: string;
}

function RiskBadge({ level, score }: { level?: string; score?: number }) {
  const config: Record<string, { color: string; icon: any; label: string }> = {
    low: { color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400", icon: ShieldCheck, label: "Low Risk" },
    medium: { color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400", icon: Shield, label: "Medium Risk" },
    high: { color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400", icon: ShieldAlert, label: "High Risk" },
    critical: { color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400", icon: ShieldX, label: "Critical Risk" },
  };
  const c = config[level || "low"] || config.low;
  const Icon = c.icon;
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${c.color}`}>
      <Icon className="h-4 w-4" />
      {c.label}{score !== undefined ? ` (${score}/100)` : ""}
    </div>
  );
}

function SanctionsBadge({ status }: { status: string }) {
  if (status === "clear") return <Badge variant="outline" className="text-emerald-600 border-emerald-300"><CheckCircle className="h-3 w-3 mr-1" />Clear</Badge>;
  if (status === "strong_match") return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Match</Badge>;
  return <Badge variant="outline" className="text-amber-600 border-amber-300"><AlertTriangle className="h-3 w-3 mr-1" />Potential</Badge>;
}

// Renders the list of data providers that ran for a given investigation —
// Companies House, OFSI/OFAC sanctions, Perplexity adverse media, Land
// Registry, AI. Used on both Clouseau investigation detail views so the
// analyst can see at a glance which sources were actually consulted.
function SourcesStrip({ result }: { result: any }) {
  const sources = cloustauSourcesFromResult(result);
  if (sources.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="investigation-sources">
      <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Sources checked</span>
      <div className="flex flex-wrap gap-1">
        {sources.map((s) => {
          const meta = CLOUSEAU_SOURCE_META[s] || { label: s, tone: "border-slate-300 text-slate-700 bg-slate-50", title: s };
          return (
            <span
              key={s}
              title={meta.title}
              className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.tone} font-medium`}
            >
              {meta.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith("## ")) return <h2 key={i} className="text-lg font-semibold mt-4 mb-1">{line.replace("## ", "")}</h2>;
        if (line.startsWith("### ")) return <h3 key={i} className="text-base font-semibold mt-3 mb-1">{line.replace("### ", "")}</h3>;
        if (line.match(/^\*\*.*\*\*$/)) return <h3 key={i} className="text-base font-semibold mt-3 mb-1">{line.replace(/\*\*/g, "")}</h3>;
        if (line.match(/^\d+\.\s+\*\*/)) {
          const cleaned = line.replace(/\*\*/g, "");
          const [num, ...rest] = cleaned.split(". ");
          return <h3 key={i} className="text-base font-semibold mt-4 mb-1">{num}. {rest.join(". ")}</h3>;
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          const text = line.replace(/^[-*]\s+/, "");
          const boldMatch = text.match(/^\*\*(.*?)\*\*(.*)$/);
          if (boldMatch) return <div key={i} className="ml-4 flex gap-1"><span className="text-muted-foreground">•</span><span><strong>{boldMatch[1]}</strong>{boldMatch[2]}</span></div>;
          return <div key={i} className="ml-4 flex gap-1"><span className="text-muted-foreground">•</span><span>{text}</span></div>;
        }
        if (line.trim() === "") return <div key={i} className="h-1" />;
        const parts = line.split(/\*\*(.*?)\*\*/g);
        return (
          <p key={i}>
            {parts.map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : <span key={j}>{part}</span>)}
          </p>
        );
      })}
    </div>
  );
}

function InvestigationHistory({ companyNumber }: { companyNumber: string }) {
  const [expanded, setExpanded] = useState(false);
  const [viewingReport, setViewingReport] = useState<string | null>(null);
  const [reportData, setReportData] = useState<any>(null);

  const { data: historyData, isLoading } = useQuery({
    queryKey: ["kyc-history", companyNumber],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/kyc-clouseau/history/${encodeURIComponent(companyNumber)}`);
      return res.json();
    },
    enabled: !!companyNumber,
  });

  const investigations: HistoryItem[] = historyData?.investigations || [];

  const loadReport = async (id: string) => {
    try {
      const res = await apiRequest("GET", `/api/kyc-clouseau/investigation/${id}`);
      const data = await res.json();
      setReportData(data);
      setViewingReport(id);
    } catch {
      setReportData(null);
    }
  };

  if (isLoading || investigations.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="h-4 w-4" />
          {investigations.length} Previous Investigation{investigations.length !== 1 ? "s" : ""}
          <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`} />
        </CardTitle>
      </CardHeader>
      {expanded && (
        <CardContent>
          <div className="space-y-3">
            {investigations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 text-sm py-2 border-b last:border-0">
                <div className="flex-shrink-0 w-24 text-xs text-muted-foreground">
                  {new Date(inv.conducted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </div>
                <RiskBadge level={inv.risk_level} score={inv.risk_score} />
                <DaysSinceBadge dateStr={inv.conducted_at} />
                {inv.sanctions_match && (
                  <Badge variant="destructive" className="text-xs">Sanctions</Badge>
                )}
                <div className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadReport(inv.id)}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  View Full Report
                </Button>
              </div>
            ))}
          </div>
          {viewingReport && reportData?.result && (
            <div className="mt-4 pt-4 border-t">
              <h4 className="text-sm font-semibold mb-2">Full Report — {new Date(reportData.conducted_at).toLocaleDateString("en-GB")}</h4>
              <div className="max-h-96 overflow-auto">
                {reportData.result.aiAnalysis && (
                  <MarkdownContent content={reportData.result.aiAnalysis} />
                )}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function PropertiesOwnedSection({ propertiesOwned }: { propertiesOwned: any }) {
  if (!propertiesOwned) return null;

  const properties = propertiesOwned.data || propertiesOwned.properties || propertiesOwned.freeholds || [];
  if (!Array.isArray(properties) || properties.length === 0) {
    if (propertiesOwned.status === "error" || propertiesOwned.error) return null;
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Home className="h-4 w-4" />
            Properties Owned
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No properties found for this company</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Home className="h-4 w-4" />
          Properties Owned ({properties.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Address</th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Title Number</th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Tenure</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((prop: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 pr-4">{prop.address || prop.property_address || "Unknown"}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{prop.title_number || prop.titleNumber || "-"}</td>
                  <td className="py-2 pr-4">
                    <Badge variant="outline" className="text-xs">
                      {prop.tenure || prop.tenure_type || "Unknown"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function daysSince(dateStr: string): number {
  const then = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}

function DaysSinceBadge({ dateStr }: { dateStr: string }) {
  const days = daysSince(dateStr);
  let color = "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (days > 365) color = "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  else if (days > 180) color = "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${color}`}>
      <CalendarClock className="h-3 w-3" />
      {days}d ago
    </span>
  );
}

// Global recent investigations — queries /api/kyc-clouseau/recent and shows a
// compact clickable list in the sidebar so the whole team can see (and reopen)
// every company / individual / property search that's been run.
function RecentInvestigations({
  onSelect,
}: {
  onSelect: (investigation: any) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<"all" | "company" | "individual" | "property_intelligence">("all");
  const [searchQ, setSearchQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [expanded, setExpanded] = useState(true);

  // Debounce the search input so we don't hit the server on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchQ), 300);
    return () => clearTimeout(t);
  }, [searchQ]);

  const { data, isLoading } = useQuery({
    queryKey: ["kyc-recent", typeFilter, debouncedQ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "200");
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (debouncedQ) params.set("q", debouncedQ);
      const res = await apiRequest("GET", `/api/kyc-clouseau/recent?${params.toString()}`);
      return res.json();
    },
    refetchInterval: 60000,
  });

  const investigations: HistoryItem[] = data?.investigations || [];

  const loadReport = async (id: string) => {
    try {
      const res = await apiRequest("GET", `/api/kyc-clouseau/investigation/${id}`);
      const row = await res.json();
      if (row?.result) onSelect({ ...row.result, subject_type: row.subject_type, _investigationId: row.id });
    } catch (err) {
      console.warn("Failed to load investigation:", err);
    }
  };

  const typeLabel = (t: string) => {
    if (t === "property_intelligence") return "Property";
    if (t === "individual") return "Individual";
    return "Company";
  };
  const typeColor = (t: string) => {
    if (t === "property_intelligence") return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400";
    if (t === "individual") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  };

  return (
    <div className="border-t">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          Investigation History {!isLoading && investigations.length > 0 && `(${investigations.length})`}
        </span>
        <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <>
          <div className="px-3 pb-2 space-y-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search investigations..."
                className="w-full pl-7 pr-2 py-1 text-[11px] rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid="investigation-search"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {(["all", "company", "individual", "property_intelligence"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    typeFilter === t ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
                  }`}
                >
                  {t === "all" ? "All" : t === "property_intelligence" ? "Property" : t === "individual" ? "Individual" : "Company"}
                </button>
              ))}
            </div>
          </div>
          <ScrollArea className="max-h-[50vh]">
            <div className="px-2 pb-2 space-y-0.5">
              {isLoading && (
                <div className="text-[11px] text-muted-foreground text-center py-4">Loading...</div>
              )}
              {!isLoading && investigations.length === 0 && (
                <div className="text-[11px] text-muted-foreground text-center py-4">
                  {debouncedQ ? "No matching investigations" : "No investigations yet"}
                </div>
              )}
              {investigations.map((inv) => (
                <button
                  key={inv.id}
                  onClick={() => loadReport(inv.id)}
                  className="w-full text-left p-2 rounded hover:bg-accent transition-colors"
                  data-testid={`recent-${inv.id}`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{inv.subject_name}</p>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        <span className={`text-[9px] px-1.5 py-0 rounded ${typeColor(inv.subject_type)}`}>
                          {typeLabel(inv.subject_type)}
                        </span>
                        {inv.company_number && (
                          <span className="text-[9px] text-muted-foreground">{inv.company_number}</span>
                        )}
                        {inv.sanctions_match && (
                          <span className="text-[9px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1 rounded">
                            Sanctions
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] text-muted-foreground">
                          {new Date(inv.conducted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                        {inv.risk_level && (
                          <span className={`text-[9px] px-1 rounded ${
                            inv.risk_level === "critical" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                            inv.risk_level === "high" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" :
                            inv.risk_level === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                            "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          }`}>
                            {inv.risk_level} {inv.risk_score}
                          </span>
                        )}
                      </div>
                      {inv.sources && inv.sources.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-1" data-testid={`recent-sources-${inv.id}`}>
                          {inv.sources.map((s) => {
                            const meta = CLOUSEAU_SOURCE_META[s] || { label: s, tone: "border-slate-300 text-slate-700 bg-slate-50", title: s };
                            return (
                              <span
                                key={s}
                                title={meta.title}
                                className={`text-[8px] px-1 py-0 rounded border ${meta.tone} font-medium leading-tight`}
                              >
                                {meta.label}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}

interface BulkScreenResult {
  name?: string;
  companyNumber?: string;
  riskLevel?: string | null;
  riskScore?: number;
  flags?: string[];
  sanctionsMatch?: boolean;
  error?: string;
}

function BulkScreenDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [companyNamesText, setCompanyNamesText] = useState("");
  const [results, setResults] = useState<BulkScreenResult[]>([]);

  const bulkMutation = useMutation({
    mutationFn: async (companyNames: string[]) => {
      const res = await apiRequest("POST", "/api/kyc-clouseau/bulk-screen", { companyNames });
      return res.json();
    },
    onSuccess: (data) => {
      setResults(data.results || []);
      toast({ title: "Bulk Screen Complete", description: `${data.results?.length || 0} companies processed` });
    },
    onError: (err) => {
      toast({ title: "Bulk Screen Failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    },
  });

  const handleRun = () => {
    const names = companyNamesText
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.length === 0) {
      toast({ title: "No companies", description: "Paste at least one company name", variant: "destructive" });
      return;
    }
    if (names.length > 20) {
      toast({ title: "Too many companies", description: "Maximum 20 companies per bulk screen", variant: "destructive" });
      return;
    }
    setResults([]);
    bulkMutation.mutate(names);
  };

  const riskColors: Record<string, string> = {
    low: "text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400",
    medium: "text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400",
    high: "text-orange-700 bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400",
    critical: "text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ListChecks className="h-4 w-4 mr-1.5" />
          Bulk Screen
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            Bulk KYC Screening
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Company names (one per line)</label>
            <Textarea
              rows={6}
              placeholder={"Acme Holdings Ltd\nFoo Property Investments\nBar Capital Partners"}
              value={companyNamesText}
              onChange={(e) => setCompanyNamesText(e.target.value)}
              disabled={bulkMutation.isPending}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Each company will be looked up on Companies House and screened against sanctions lists. Max 20 per run.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={handleRun} disabled={bulkMutation.isPending || !companyNamesText.trim()}>
              {bulkMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Screening {companyNamesText.split("\n").filter(Boolean).length} companies...
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4 mr-2" />
                  Run Bulk Screen
                </>
              )}
            </Button>
          </DialogFooter>
          {results.length > 0 && (
            <div className="space-y-2 pt-2 border-t">
              <h4 className="text-sm font-semibold">Results ({results.length})</h4>
              {results.map((r, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg border text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{r.name || "Unknown"}</p>
                    {r.companyNumber && <p className="text-xs text-muted-foreground">{r.companyNumber}</p>}
                    {r.error && <p className="text-xs text-destructive">{r.error}</p>}
                    {r.flags && r.flags.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">{r.flags.length} flag(s)</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    {r.sanctionsMatch && (
                      <Badge variant="destructive" className="text-xs">Sanctions</Badge>
                    )}
                    {r.riskLevel ? (
                      <Badge className={`text-xs ${riskColors[r.riskLevel] || ""}`}>
                        {r.riskLevel} {r.riskScore !== undefined ? `(${r.riskScore})` : ""}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">N/A</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExpiringSection() {
  const { data, isLoading } = useQuery({
    queryKey: ["kyc-expiring"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/kyc-clouseau/expiring");
      return res.json();
    },
  });

  const count = data?.count || 0;
  const investigations = data?.investigations || [];

  if (isLoading) return null;

  if (count === 0) return null;

  return (
    <Card className="border-amber-200 dark:border-amber-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-amber-500" />
          Expiring Investigations
          <Badge variant="outline" className="text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700 ml-1">
            {count}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">
          These investigations are older than 12 months and should be re-screened.
        </p>
        <div className="space-y-2 max-h-60 overflow-auto">
          {investigations.slice(0, 15).map((inv: any) => (
            <div key={inv.id} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-0">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{inv.subjectName}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {inv.companyNumber && (
                    <span className="text-xs text-muted-foreground">{inv.companyNumber}</span>
                  )}
                  <DaysSinceBadge dateStr={inv.conductedAt} />
                  {inv.deal && (
                    <span className="text-xs text-muted-foreground">Deal: {inv.deal.name}</span>
                  )}
                </div>
              </div>
              <RiskBadge level={inv.riskLevel} score={inv.riskScore} />
            </div>
          ))}
          {count > 15 && (
            <p className="text-xs text-muted-foreground text-center pt-1">
              + {count - 15} more
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Cross-link: after an investigation completes, check the CRM for a matching
// company by Companies House number. If there's a hit, offer a link to the
// Company detail page (where the KycPanel lives). If not, offer a 'Add to
// CRM' button so the MLRO can start the compliance workflow one click later.
function CrmMatchStrip({
  companyNumber,
  companyName,
  companyType,
  address,
}: {
  companyNumber: string;
  companyName: string;
  companyType?: string;
  address?: any;
}) {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const { data: match, refetch } = useQuery<{ id: string; name: string; kyc_status: string | null } | null>({
    queryKey: ["/api/kyc/match-company", companyNumber],
    queryFn: async () => {
      const res = await fetch(`/api/kyc/match-company?companyNumber=${encodeURIComponent(companyNumber)}`, { credentials: "include" });
      if (!res.ok) return null;
      const data = await res.json();
      return data || null;
    },
  });

  async function addToCrm() {
    setCreating(true);
    try {
      const res = await fetch("/api/kyc/create-company-from-investigation", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyNumber, companyName, companyType, address }),
      });
      if (!res.ok) throw new Error("Failed to create");
      await refetch();
      toast({ title: "Added to CRM", description: "KYC profile ready — open it to upload documents and run the checklist." });
    } catch (e: any) {
      toast({ title: "Couldn't add", description: e?.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20" data-testid="crm-match-strip">
      <CardContent className="p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          {match ? (
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                In CRM as <span className="font-semibold">{match.name}</span>
                {match.kyc_status && (
                  <Badge variant="outline" className={`ml-2 text-[10px] ${
                    match.kyc_status === "approved" ? "border-emerald-300 text-emerald-700" :
                    match.kyc_status === "rejected" ? "border-red-300 text-red-700" :
                    match.kyc_status === "in_review" ? "border-blue-300 text-blue-700" :
                    "border-amber-300 text-amber-700"
                  }`}>{match.kyc_status}</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">Open the compliance profile to upload docs, run the checklist, and MLRO-approve.</div>
            </div>
          ) : (
            <div className="min-w-0">
              <div className="text-sm font-medium">Not in CRM yet</div>
              <div className="text-xs text-muted-foreground">Add to the CRM to start the KYC document workflow and lock the deal invoice gate.</div>
            </div>
          )}
        </div>
        {match ? (
          <Button asChild size="sm" variant="outline" className="shrink-0" data-testid="crm-match-open">
            <a href={`/companies/${match.id}`}>
              Manage compliance profile
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </a>
          </Button>
        ) : (
          <Button size="sm" onClick={addToCrm} disabled={creating} className="shrink-0" data-testid="crm-match-create">
            {creating && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
            Add to CRM
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function KycClouseau() {
  const { toast } = useToast();
  const params = new URLSearchParams(window.location.search);
  const landRegName = params.get("name") || "";
  const landRegAddress = params.get("address") || "";
  const landRegMortgage = params.get("mortgage") || "";
  const landRegPrice = params.get("price") || "";
  const hasPropertyContext = !!landRegName;

  const [propertyContext] = useState(hasPropertyContext ? {
    ownerName: landRegName,
    propertyAddress: landRegAddress,
    mortgageLender: landRegMortgage,
    pricePaid: landRegPrice,
  } : null);

  const [searchMode, setSearchMode] = useState<"company" | "individual" | "property">("company");
  const [searchQuery, setSearchQuery] = useState(landRegName);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [investigation, setInvestigation] = useState<InvestigationResult | null>(null);
  const [individualResult, setIndividualResult] = useState<IndividualResult | null>(null);
  const [selectedOfficer, setSelectedOfficer] = useState<any>(null);
  const [officerDeepDive, setOfficerDeepDive] = useState<any>(null);
  const [lastInvestigateParams, setLastInvestigateParams] = useState<{ companyNumber?: string; companyName?: string; propertyContext?: any } | null>(null);
  const autoSearched = useRef(false);

  // Individual search fields
  const [individualName, setIndividualName] = useState("");
  const [individualDob, setIndividualDob] = useState("");
  const [individualCompanyNumbers, setIndividualCompanyNumbers] = useState("");

  // Property search fields
  const [propertyAddressInput, setPropertyAddressInput] = useState("");
  const [propertyPostcodeInput, setPropertyPostcodeInput] = useState("");
  const [propertyResolve, setPropertyResolve] = useState<PropertyResolveResult | null>(null);

  // Background AI polling for property-intelligence investigations. The server
  // returns the raw data fast and runs the Claude analysis in the background;
  // this hook polls the investigation record until aiStatus becomes "complete"
  // or "failed", then merges the narrative into state.
  const [aiPollingId, setAiPollingId] = useState<number | null>(null);
  useEffect(() => {
    if (!aiPollingId) return;
    let cancelled = false;
    const start = Date.now();
    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - start > 240000) return; // 4 min cap
      try {
        const res = await apiRequest("GET", `/api/kyc-clouseau/investigation/${aiPollingId}`);
        const row = await res.json();
        const result = row?.result;
        if (result && (result.aiStatus === "complete" || result.aiStatus === "failed")) {
          setInvestigation((prev) => prev ? { ...prev, aiAnalysis: result.aiAnalysis, ...(result.aiStatus ? { aiStatus: result.aiStatus } : {}) } as any : prev);
          setAiPollingId(null);
          return;
        }
      } catch {}
      setTimeout(poll, 4000);
    };
    const t = setTimeout(poll, 4000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [aiPollingId]);

  function extractErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error) {
      const msg = err.message || fallback;
      const jsonMatch = msg.match(/^\d+:\s*(.+)$/s);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.error) return parsed.error;
        } catch {
          return jsonMatch[1];
        }
      }
      return msg;
    }
    return fallback;
  }

  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      const res = await apiRequest("GET", `/api/kyc-clouseau/search?q=${encodeURIComponent(query)}`);
      return res.json();
    },
    onSuccess: (data) => setSearchResults(data.items || []),
    onError: (err) => {
      const message = extractErrorMessage(err, "Search failed. Please try again.");
      toast({ title: "Search Error", description: message, variant: "destructive" });
    },
  });

  const investigateMutation = useMutation({
    mutationFn: async (params: { companyNumber?: string; companyName?: string; propertyContext?: any }) => {
      setLastInvestigateParams(params);
      const res = await apiRequest("POST", "/api/kyc-clouseau/investigate", params);
      return res.json();
    },
    onSuccess: (data) => {
      setInvestigation(data);
      setIndividualResult(null);
      setSelectedOfficer(null);
      setOfficerDeepDive(null);
    },
    onError: (err) => {
      const message = extractErrorMessage(err, "Investigation failed. Please try again.");
      toast({ title: "Investigation Error", description: message, variant: "destructive" });
    },
  });

  const individualMutation = useMutation({
    mutationFn: async (params: { name: string; dateOfBirth?: string; companyNumbers?: string[] }) => {
      const res = await apiRequest("POST", "/api/kyc-clouseau/investigate-individual", params);
      return res.json();
    },
    onSuccess: (data) => {
      setIndividualResult(data);
      setInvestigation(null);
      setSelectedOfficer(null);
      setOfficerDeepDive(null);
    },
    onError: (err) => {
      const message = extractErrorMessage(err, "Individual investigation failed. Please try again.");
      toast({ title: "Investigation Error", description: message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (landRegName && !autoSearched.current) {
      autoSearched.current = true;
      searchMutation.mutate(landRegName);
    }
  }, []);

  const officerMutation = useMutation({
    mutationFn: async (params: { officerId: string; officerName: string }) => {
      const res = await apiRequest("POST", "/api/kyc-clouseau/officer-deep-dive", params);
      return res.json();
    },
    onSuccess: (data) => setOfficerDeepDive(data),
    onError: (err) => {
      const message = extractErrorMessage(err, "Officer deep-dive failed. Please try again.");
      toast({ title: "Officer Deep-Dive Error", description: message, variant: "destructive" });
    },
  });

  const propertyIntelMutation = useMutation({
    mutationFn: async (params: { companyNumber?: string; companyName?: string; propertyAddress?: string; propertyName?: string }) => {
      const res = await apiRequest("POST", "/api/kyc-clouseau/property-intelligence", params);
      return res.json();
    },
    onSuccess: (data) => {
      setInvestigation(data);
      setIndividualResult(null);
      setSelectedOfficer(null);
      setOfficerDeepDive(null);
      // Server returns raw data fast and runs AI in the background — poll the
      // investigation record until aiStatus transitions to complete/failed.
      if (data?.investigationId && data?.aiStatus === "pending") {
        setAiPollingId(data.investigationId);
      }
    },
    onError: (err) => {
      const message = extractErrorMessage(err, "Property intelligence investigation failed.");
      toast({ title: "Property Intelligence Error", description: message, variant: "destructive" });
    },
  });

  const propertyResolveMutation = useMutation({
    mutationFn: async (params: { address?: string; postcode?: string }) => {
      const res = await apiRequest("POST", "/api/land-registry/resolve", params);
      return res.json();
    },
    onSuccess: (data: PropertyResolveResult) => setPropertyResolve(data),
    onError: (err) => {
      const message = extractErrorMessage(err, "Could not resolve property.");
      toast({ title: "Property Lookup Error", description: message, variant: "destructive" });
    },
  });

  const handleSearch = useCallback(() => {
    if (searchQuery.length >= 2) searchMutation.mutate(searchQuery);
  }, [searchQuery]);

  const handleInvestigate = useCallback((result: SearchResult) => {
    investigateMutation.mutate({
      companyNumber: result.companyNumber,
      companyName: result.name,
      ...(propertyContext ? { propertyContext } : {}),
    });
  }, [propertyContext]);

  // Auto-run when coming from a cross-link (Compliance Board → Investigate).
  // Reads ?run=<CHnumber>&name=<name> once per mount.
  // Also reads ?investigation=<id> to re-open a persisted investigation
  // (e.g. Property Pathway's Stage 4 links here with the investigationId
  // it saved to kyc_investigations, so the full report opens in place).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const run = params.get("run");
    const name = params.get("name");
    const investigationId = params.get("investigation");

    if (investigationId) {
      (async () => {
        try {
          const res = await apiRequest("GET", `/api/kyc-clouseau/investigation/${encodeURIComponent(investigationId)}`);
          const row = await res.json();
          const payload = typeof row.result === "string" ? JSON.parse(row.result) : row.result;
          if (payload) {
            setInvestigation(payload);
            setIndividualResult(null);
            setSelectedOfficer(null);
            setOfficerDeepDive(null);
          }
        } catch (err: any) {
          toast({ title: "Could not open investigation", description: err?.message || "Unknown error", variant: "destructive" });
        }
      })();
    } else if (run || name) {
      investigateMutation.mutate({
        companyNumber: run || undefined,
        companyName: name || undefined,
      } as any);
    }

    if (run || name || investigationId) {
      params.delete("run");
      params.delete("name");
      params.delete("investigation");
      const clean = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${clean ? "?" + clean : ""}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleIndividualSearch = useCallback(() => {
    if (!individualName.trim()) return;
    const companyNums = individualCompanyNumbers
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    individualMutation.mutate({
      name: individualName.trim(),
      dateOfBirth: individualDob || undefined,
      companyNumbers: companyNums.length > 0 ? companyNums : undefined,
    });
  }, [individualName, individualDob, individualCompanyNumbers]);

  const handleOfficerDive = useCallback((officer: any) => {
    setSelectedOfficer(officer);
    const officerId = officer.links?.officer?.appointments?.replace("/officers/", "").replace("/appointments", "") || "";
    if (officerId) {
      officerMutation.mutate({ officerId, officerName: officer.name });
    }
  }, []);

  const isInvestigating = investigateMutation.isPending || individualMutation.isPending || propertyIntelMutation.isPending;

  return (
    <PageLayout
      title="KYC Clouseau"
      icon={ShieldCheck}
      subtitle="AI-Powered KYC & AML Investigation Tool"
      actions={<BulkScreenDialog />}
      fullHeight
    >

      {propertyContext && (
        <div className="border-b bg-amber-50 dark:bg-amber-950/30 px-6 py-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Landmark className="h-4 w-4 text-amber-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Property Acquisition Investigation
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                {propertyContext.propertyAddress && (
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{propertyContext.propertyAddress}</span>
                )}
                {propertyContext.pricePaid && !isNaN(Number(propertyContext.pricePaid)) && (
                  <span>Last sold: £{Number(propertyContext.pricePaid).toLocaleString()}</span>
                )}
                {propertyContext.mortgageLender && (
                  <span>Lender: {propertyContext.mortgageLender}</span>
                )}
              </div>
            </div>
            <Badge variant="outline" className="text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-700 text-xs">
              From Land Registry
            </Badge>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden flex">
        {/* Left sidebar — search */}
        <div className="w-80 border-r flex flex-col flex-shrink-0">
          <div className="p-4 border-b space-y-3">
            {/* Search mode tabs */}
            <div className="flex gap-1 p-0.5 bg-muted rounded-lg">
              <button
                className={`flex-1 text-[11px] font-medium py-1.5 px-2 rounded-md transition-colors flex items-center justify-center gap-1 ${searchMode === "company" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setSearchMode("company")}
                data-testid="mode-company"
              >
                <Building2 className="h-3 w-3" />
                Company
              </button>
              <button
                className={`flex-1 text-[11px] font-medium py-1.5 px-2 rounded-md transition-colors flex items-center justify-center gap-1 ${searchMode === "individual" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setSearchMode("individual")}
                data-testid="mode-individual"
              >
                <UserSearch className="h-3 w-3" />
                Individual
              </button>
              <button
                className={`flex-1 text-[11px] font-medium py-1.5 px-2 rounded-md transition-colors flex items-center justify-center gap-1 ${searchMode === "property" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setSearchMode("property")}
                data-testid="mode-property"
              >
                <Home className="h-3 w-3" />
                Property
              </button>
            </div>

            {searchMode === "company" && (
              <div className="flex gap-2">
                <Input
                  data-testid="input-search"
                  placeholder="Company name or number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                <Button
                  data-testid="button-search"
                  size="icon"
                  onClick={handleSearch}
                  disabled={searchMutation.isPending}
                >
                  {searchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
            )}
            {searchMode === "individual" && (
              <div className="space-y-2">
                <Input
                  data-testid="input-individual-name"
                  placeholder="Full name..."
                  value={individualName}
                  onChange={(e) => setIndividualName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleIndividualSearch()}
                />
                <Input
                  data-testid="input-individual-dob"
                  placeholder="Date of birth (optional, YYYY-MM-DD)"
                  value={individualDob}
                  onChange={(e) => setIndividualDob(e.target.value)}
                />
                <Input
                  data-testid="input-individual-companies"
                  placeholder="Known company numbers (comma-separated)"
                  value={individualCompanyNumbers}
                  onChange={(e) => setIndividualCompanyNumbers(e.target.value)}
                />
                <Button
                  data-testid="button-individual-search"
                  className="w-full"
                  onClick={handleIndividualSearch}
                  disabled={individualMutation.isPending || !individualName.trim()}
                >
                  {individualMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <UserSearch className="h-4 w-4 mr-2" />
                  )}
                  Investigate Individual
                </Button>
              </div>
            )}
            {searchMode === "property" && (
              <div className="space-y-2">
                <AddressAutocomplete
                  value={propertyAddressInput ? { formatted: propertyAddressInput, placeId: "", postcode: propertyPostcodeInput } : null}
                  onChange={(addr) => {
                    if (!addr) {
                      setPropertyAddressInput("");
                      setPropertyPostcodeInput("");
                      return;
                    }
                    setPropertyAddressInput(addr.formatted);
                    setPropertyPostcodeInput(addr.postcode || "");
                    // Auto-fire lookup once Google/server has given us both pieces
                    if (addr.postcode) {
                      propertyResolveMutation.mutate({ address: addr.formatted, postcode: addr.postcode });
                    }
                  }}
                  placeholder="Start typing an address (e.g. 18-22 Haymarket)..."
                />
                <Input
                  data-testid="input-property-postcode"
                  placeholder="Postcode (override if needed)"
                  value={propertyPostcodeInput}
                  onChange={(e) => setPropertyPostcodeInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && propertyResolveMutation.mutate({ address: propertyAddressInput, postcode: propertyPostcodeInput })}
                />
                <Button
                  data-testid="button-property-lookup"
                  className="w-full"
                  onClick={() => propertyResolveMutation.mutate({ address: propertyAddressInput, postcode: propertyPostcodeInput })}
                  disabled={propertyResolveMutation.isPending || (!propertyAddressInput.trim() && !propertyPostcodeInput.trim())}
                >
                  {propertyResolveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Home className="h-4 w-4 mr-2" />
                  )}
                  Look up Property
                </Button>
                <p className="text-[10px] text-muted-foreground">
                  Google Places → Land Registry → proprietor → full intelligence. Postcode auto-fills on select.
                </p>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-hidden flex flex-col">
            {searchMode === "company" && (
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-1">
                  {searchResults.map((result, i) => (
                    <button
                      key={`${result.source}-${result.companyNumber}-${i}`}
                      data-testid={`button-result-${i}`}
                      className="w-full text-left p-3 rounded-lg hover:bg-accent transition-colors"
                      onClick={() => handleInvestigate(result)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{result.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {result.companyNumber && (
                              <span className="text-xs text-muted-foreground">{result.companyNumber}</span>
                            )}
                            {result.source === "crm" && (
                              <Badge variant="outline" className="text-xs px-1 py-0">CRM</Badge>
                            )}
                          </div>
                          {result.address && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{result.address}</p>
                          )}
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      </div>
                    </button>
                  ))}
                  {searchMutation.isError && (
                    <div className="p-4 text-center space-y-2" data-testid="error-search">
                      <div className="inline-flex items-center gap-2 text-sm text-destructive">
                        <XCircle className="h-4 w-4 flex-shrink-0" />
                        <span>{extractErrorMessage(searchMutation.error, "Search failed. Please try again.")}</span>
                      </div>
                      <div>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="button-retry-search"
                          onClick={handleSearch}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Retry
                        </Button>
                      </div>
                    </div>
                  )}
                  {searchResults.length === 0 && !searchMutation.isPending && !searchMutation.isError && (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      Search for a company to begin your investigation
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}

            {searchMode === "individual" && (
              <ScrollArea className="flex-1">
                <div className="p-4 text-center text-xs text-muted-foreground">
                  Enter an individual's name above to search officer records, appointments, sanctions, and generate a full compliance profile.
                </div>
              </ScrollArea>
            )}

            {searchMode === "property" && (
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-2">
                  {propertyResolve && (
                    <div className="rounded-lg border p-3 space-y-2">
                      <div>
                        <p className="text-[11px] font-medium">{propertyResolve.resolvedAddress || "Postcode only"}</p>
                        {propertyResolve.resolvedPostcode && (
                          <p className="text-[10px] text-muted-foreground">{propertyResolve.resolvedPostcode}</p>
                        )}
                        <Badge variant="outline" className="text-[9px] mt-1">{propertyResolve.source}</Badge>
                      </div>

                      {(propertyResolve.matched.freeholds.length > 0 || propertyResolve.matched.leaseholds.length > 0) && (
                        <div>
                          <p className="text-[10px] font-medium text-muted-foreground uppercase mt-2 mb-1">Matched Titles</p>
                          {[...propertyResolve.matched.freeholds, ...propertyResolve.matched.leaseholds].map((t: any, i: number) => (
                            <button
                              key={`m-${i}`}
                              onClick={() => {
                                const name = t.proprietor_name_1 || t.proprietor_name || t.proprietor;
                                if (!name) return;
                                propertyIntelMutation.mutate({
                                  companyName: name,
                                  propertyAddress: propertyResolve.resolvedAddress || propertyAddressInput,
                                  propertyName: t.property || propertyResolve.buildingName,
                                });
                              }}
                              className="w-full text-left p-2 rounded border hover:bg-accent mb-1"
                            >
                              <p className="text-[11px] font-medium truncate">{t.proprietor_name_1 || t.proprietor_name || "Unknown"}</p>
                              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                <Badge variant="outline" className="text-[9px]">{t.title_number || "—"}</Badge>
                                <Badge variant="outline" className="text-[9px]">{t.tenure || (propertyResolve.matched.freeholds.includes(t) ? "FH" : "LH")}</Badge>
                                {t.price_paid && <span className="text-[9px] text-muted-foreground">£{Number(t.price_paid).toLocaleString()}</span>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {(propertyResolve.fallback.freeholds.length > 0 || propertyResolve.fallback.leaseholds.length > 0) && (
                        <div>
                          <p className="text-[10px] font-medium text-muted-foreground uppercase mt-2 mb-1">Street-number Match</p>
                          {[...propertyResolve.fallback.freeholds, ...propertyResolve.fallback.leaseholds].map((t: any, i: number) => (
                            <button
                              key={`f-${i}`}
                              onClick={() => {
                                const name = t.proprietor_name_1 || t.proprietor_name || t.proprietor;
                                if (!name) return;
                                propertyIntelMutation.mutate({
                                  companyName: name,
                                  propertyAddress: propertyResolve.resolvedAddress || propertyAddressInput,
                                });
                              }}
                              className="w-full text-left p-2 rounded border hover:bg-accent mb-1"
                            >
                              <p className="text-[11px] font-medium truncate">{t.proprietor_name_1 || "Unknown"}</p>
                              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                <Badge variant="outline" className="text-[9px]">{t.title_number || "—"}</Badge>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {propertyResolve.matched.freeholds.length === 0 && propertyResolve.matched.leaseholds.length === 0 &&
                       propertyResolve.fallback.freeholds.length === 0 && propertyResolve.fallback.leaseholds.length === 0 &&
                       (propertyResolve.context.freeholds.length > 0 || propertyResolve.context.leaseholds.length > 0) && (
                        <div>
                          <p className="text-[10px] font-medium text-muted-foreground uppercase mt-2 mb-1">Postcode Titles ({propertyResolve.context.freeholds.length + propertyResolve.context.leaseholds.length})</p>
                          {[...propertyResolve.context.freeholds, ...propertyResolve.context.leaseholds].slice(0, 10).map((t: any, i: number) => (
                            <button
                              key={`c-${i}`}
                              onClick={() => {
                                const name = t.proprietor_name_1 || t.proprietor_name || t.proprietor;
                                if (!name) return;
                                propertyIntelMutation.mutate({
                                  companyName: name,
                                  propertyAddress: propertyResolve.resolvedAddress || propertyAddressInput,
                                });
                              }}
                              className="w-full text-left p-2 rounded border hover:bg-accent mb-1"
                            >
                              <p className="text-[11px] font-medium truncate">{t.proprietor_name_1 || "Unknown"}</p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {(Array.isArray(t.property) ? t.property.join(", ") : t.property) || "—"}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {propertyResolveMutation.isError && (
                    <div className="p-3 text-center text-[11px] text-destructive">
                      {extractErrorMessage(propertyResolveMutation.error, "Could not resolve property.")}
                    </div>
                  )}
                  {!propertyResolve && !propertyResolveMutation.isPending && !propertyResolveMutation.isError && (
                    <div className="p-4 text-center text-[11px] text-muted-foreground">
                      Enter a property address / postcode to see registered owners. Click an owner to run full property intelligence.
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}

            <RecentInvestigations
              onSelect={(inv) => {
                // Route reopened results to the right view state
                if (inv?.subject?.type === "property_intelligence" || inv?.subject_type === "property_intelligence") {
                  setInvestigation(inv);
                  setIndividualResult(null);
                } else if (inv?.subject?.type === "individual" || inv?.subject_type === "individual") {
                  setIndividualResult(inv);
                  setInvestigation(null);
                } else {
                  setInvestigation(inv);
                  setIndividualResult(null);
                }
                setSelectedOfficer(null);
                setOfficerDeepDive(null);
              }}
            />
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 overflow-auto">
          {isInvestigating && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="relative">
                <Scale className="h-12 w-12 text-primary animate-pulse" />
              </div>
              <div className="text-center">
                <p className="font-medium">Investigating...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {propertyIntelMutation.isPending
                    ? "Full property intelligence: tracing UBO chain, deep-diving decision makers, mapping associates. AI narrative will follow once data lands."
                    : individualMutation.isPending
                    ? "Searching officer records, appointments, sanctions screening, and generating AI analysis"
                    : "Running Companies House lookup, sanctions screening, ownership trace, and AI analysis"}
                </p>
              </div>
            </div>
          )}

          {(investigateMutation.isError || individualMutation.isError) && !isInvestigating && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8" data-testid="error-investigation">
              <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="h-8 w-8 text-destructive" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Investigation Failed</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  {extractErrorMessage(
                    investigateMutation.error || individualMutation.error,
                    "Something went wrong while running the investigation. Please try again."
                  )}
                </p>
              </div>
              {lastInvestigateParams && (
                <Button
                  data-testid="button-retry-investigation"
                  variant="outline"
                  onClick={() => investigateMutation.mutate(lastInvestigateParams)}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry Investigation
                </Button>
              )}
            </div>
          )}

          {/* Individual investigation result */}
          {individualResult && !isInvestigating && !individualMutation.isError && (
            <div className="p-6 space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <UserSearch className="h-6 w-6 text-muted-foreground" />
                    <h2 className="text-2xl font-bold">{individualResult.subject.name}</h2>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <Badge variant="outline">Individual</Badge>
                    {individualResult.subject.dateOfBirth && (
                      <span className="text-sm text-muted-foreground">DOB: {individualResult.subject.dateOfBirth}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {individualResult.officerMatches?.length || 0} officer match(es)
                    </span>
                  </div>
                </div>
                <RiskBadge level={individualResult.riskLevel} score={individualResult.riskScore} />
              </div>

              <SourcesStrip result={individualResult} />

              {/* Risk flags */}
              {(individualResult.flags?.length || 0) > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      Risk Flags ({individualResult.flags?.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      {individualResult.flags?.map((flag, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <span className="text-amber-500 mt-0.5">•</span>
                          <span>{flag}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Sanctions screening */}
              {individualResult.sanctionsScreening && individualResult.sanctionsScreening.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Sanctions Screening
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {individualResult.sanctionsScreening.map((s: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span>{s.name}</span>
                          <SanctionsBadge status={s.status} />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Associated companies as clickable cards */}
              {individualResult.associatedCompanies && individualResult.associatedCompanies.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      Associated Companies ({individualResult.associatedCompanies.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {individualResult.associatedCompanies.map((co: any, i: number) => (
                        <button
                          key={i}
                          className="text-left p-3 rounded-lg border hover:bg-accent transition-colors"
                          onClick={() => {
                            setSearchMode("company");
                            investigateMutation.mutate({
                              companyNumber: co.companyNumber,
                              companyName: co.profile?.company_name,
                            });
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">
                                {co.profile?.company_name || co.companyNumber}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-muted-foreground">{co.companyNumber}</span>
                                {co.profile?.company_status && (
                                  <Badge
                                    variant={co.profile.company_status === "active" ? "outline" : "destructive"}
                                    className="text-xs"
                                  >
                                    {co.profile.company_status}
                                  </Badge>
                                )}
                              </div>
                              {co.charges && co.charges.length > 0 && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {co.charges.length} charge(s) — {co.charges.filter((c: any) => c.status === "outstanding").length} outstanding
                                </p>
                              )}
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* AI analysis */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">AI Analysis</CardTitle>
                </CardHeader>
                <CardContent>
                  {individualResult.aiAnalysis ? (
                    <MarkdownContent content={individualResult.aiAnalysis} />
                  ) : (
                    <p className="text-sm text-muted-foreground">No AI analysis available</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Company investigation result */}
          {investigation && !isInvestigating && !investigateMutation.isError && !propertyIntelMutation.isPending && (
            <div className="p-6 space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold" data-testid="text-subject-name">{investigation.subject.name}</h2>
                  <div className="flex items-center gap-3 mt-1">
                    {investigation.companyProfile?.company_number && (
                      <span className="text-sm text-muted-foreground">#{investigation.companyProfile.company_number}</span>
                    )}
                    {investigation.companyProfile?.company_status && (
                      <Badge variant={investigation.companyProfile.company_status === "active" ? "outline" : "destructive"}>
                        {investigation.companyProfile.company_status}
                      </Badge>
                    )}
                    {investigation.companyProfile?.type && (
                      <span className="text-xs text-muted-foreground">{investigation.companyProfile.type}</span>
                    )}
                    {investigation.timestamp && (
                      <DaysSinceBadge dateStr={investigation.timestamp} />
                    )}
                    {(investigation as any).subject?.type === "property_intelligence" && (
                      <Badge className="bg-purple-600 text-white text-[9px]">Property Intelligence</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(investigation as any).subject?.type !== "property_intelligence" && investigation.companyProfile?.company_number && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs border-purple-300 text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-950"
                      onClick={() => propertyIntelMutation.mutate({
                        companyNumber: investigation.companyProfile?.company_number,
                        companyName: investigation.subject.name,
                        propertyAddress: investigation.propertyContext?.propertyAddress,
                        propertyName: investigation.propertyContext?.propertyAddress,
                      })}
                      disabled={propertyIntelMutation.isPending}
                    >
                      {propertyIntelMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Home className="h-3 w-3 mr-1" />}
                      Full Property Intelligence
                    </Button>
                  )}
                  <RiskBadge level={investigation.riskLevel} score={investigation.riskScore} />
                </div>
              </div>

              <SourcesStrip result={investigation} />

              {investigation.companyProfile?.company_number && (
                <CrmMatchStrip
                  companyNumber={investigation.companyProfile.company_number}
                  companyName={investigation.subject.name}
                  companyType={investigation.companyProfile.type}
                  address={investigation.companyProfile.registered_office_address}
                />
              )}

              {/* UBO & Decision Makers section (from Property Intelligence) */}
              {(investigation as any).decisionMakers?.length > 0 && (
                <Card className="border-purple-200 dark:border-purple-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <UserSearch className="h-4 w-4 text-purple-600" />
                      Ultimate Beneficial Owners & Decision Makers ({(investigation as any).decisionMakers.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(investigation as any).decisionMakers.map((dm: any, i: number) => (
                        <div key={i} className="rounded-lg border p-3 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{dm.name}</span>
                            <Badge variant="outline" className="text-[9px]">{dm.level === "direct" ? "Direct UBO" : dm.level === "chain" ? "Chain UBO" : "Director"}</Badge>
                          </div>
                          {dm.nationality && <p className="text-xs text-muted-foreground">Nationality: {dm.nationality}</p>}
                          {dm.source && <p className="text-xs text-muted-foreground">Via: {dm.source}</p>}
                          {dm.totalAppointments > 0 && (
                            <p className="text-xs text-muted-foreground">{dm.totalAppointments} appointments ({dm.activeAppointments} active)</p>
                          )}
                          {dm.companies?.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              <p className="text-[10px] font-medium text-muted-foreground uppercase">Other Companies:</p>
                              {dm.companies.slice(0, 5).map((c: any, j: number) => (
                                <button key={j} className="block text-left text-[11px] text-primary hover:underline"
                                  onClick={() => investigateMutation.mutate({ companyNumber: c.number, companyName: c.name })}>
                                  {c.name} ({c.role})
                                </button>
                              ))}
                              {dm.companies.length > 5 && <p className="text-[10px] text-muted-foreground">+{dm.companies.length - 5} more</p>}
                            </div>
                          )}
                          <Button variant="ghost" size="sm" className="text-[10px] h-6 px-2 mt-1"
                            onClick={() => individualMutation.mutate({ name: dm.name })}>
                            <UserSearch className="h-3 w-3 mr-1" /> Investigate Individual
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Ownership Chain Details (from Property Intelligence) */}
              {(investigation as any).chainDetails?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <LinkIcon className="h-4 w-4" />
                      Full Ownership Chain ({(investigation as any).chainDetails.length} levels)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {(investigation as any).chainDetails.map((link: any, i: number) => (
                        <div key={i} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs bg-muted rounded-full w-5 h-5 flex items-center justify-center font-mono">{i + 1}</span>
                              <button className="font-medium text-sm text-primary hover:underline"
                                onClick={() => investigateMutation.mutate({ companyNumber: link.number, companyName: link.name })}>
                                {link.name}
                              </button>
                            </div>
                            <span className="text-xs text-muted-foreground">{link.number}</span>
                          </div>
                          {link.profile && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {link.profile.company_status} — {link.profile.type} — inc. {link.profile.date_of_creation}
                            </p>
                          )}
                          {link.officers?.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {link.officers.slice(0, 4).map((o: any, j: number) => (
                                <Badge key={j} variant="outline" className="text-[9px]">{o.name} ({o.officer_role})</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {(investigation.flags?.length || 0) > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      Risk Flags ({investigation.flags?.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      {investigation.flags?.map((flag, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <span className="text-amber-500 mt-0.5">•</span>
                          <span>{flag}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Investigation History */}
              {investigation.subject.companyNumber && (
                <InvestigationHistory companyNumber={investigation.subject.companyNumber} />
              )}

              <Tabs defaultValue="analysis" className="w-full">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="analysis" data-testid="tab-analysis">AI Analysis</TabsTrigger>
                  <TabsTrigger value="officers" data-testid="tab-officers">Officers ({investigation.officers?.length || 0})</TabsTrigger>
                  <TabsTrigger value="pscs" data-testid="tab-pscs">PSCs ({investigation.pscs?.length || 0})</TabsTrigger>
                  <TabsTrigger value="ownership" data-testid="tab-ownership">Ownership</TabsTrigger>
                  <TabsTrigger value="charges" data-testid="tab-charges">Charges ({investigation.charges?.length || 0})</TabsTrigger>
                  <TabsTrigger value="sanctions" data-testid="tab-sanctions">Sanctions</TabsTrigger>
                  <TabsTrigger value="filings" data-testid="tab-filings">Filings</TabsTrigger>
                </TabsList>

                <TabsContent value="analysis" className="mt-4">
                  <Card>
                    <CardContent className="pt-6">
                      {investigation.aiAnalysis ? (
                        <MarkdownContent content={investigation.aiAnalysis} />
                      ) : (investigation as any).aiStatus === "pending" || aiPollingId ? (
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>AI analysis running in the background — raw intelligence is ready below, narrative will appear here when complete.</span>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No AI analysis available</p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="officers" className="mt-4">
                  <div className="grid gap-3">
                    {investigation.officers?.map((officer, i) => {
                      const officerId = officer.links?.officer?.appointments?.replace("/officers/", "").replace("/appointments", "") || "";
                      return (
                        <Card key={i} className={selectedOfficer?.name === officer.name ? "ring-2 ring-primary" : ""}>
                          <CardContent className="pt-4 pb-4">
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <User className="h-4 w-4 text-muted-foreground" />
                                  <span className="font-medium text-sm" data-testid={`text-officer-${i}`}>{officer.name}</span>
                                </div>
                                <div className="ml-6 mt-1 space-y-0.5">
                                  <p className="text-xs text-muted-foreground">Role: {officer.officer_role?.replace(/-/g, " ")}</p>
                                  {officer.nationality && <p className="text-xs text-muted-foreground">Nationality: {officer.nationality}</p>}
                                  {officer.appointed_on && <p className="text-xs text-muted-foreground">Appointed: {officer.appointed_on}</p>}
                                  {officer.date_of_birth && (
                                    <p className="text-xs text-muted-foreground">DOB: {officer.date_of_birth.month}/{officer.date_of_birth.year}</p>
                                  )}
                                </div>
                              </div>
                              {officerId && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  data-testid={`button-dive-officer-${i}`}
                                  onClick={() => handleOfficerDive(officer)}
                                  disabled={officerMutation.isPending}
                                >
                                  {officerMutation.isPending && selectedOfficer?.name === officer.name ? (
                                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                  ) : (
                                    <Eye className="h-3 w-3 mr-1" />
                                  )}
                                  Deep Dive
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}

                    {officerMutation.isError && !officerMutation.isPending && (
                      <Card className="border-destructive/30" data-testid="error-officer-dive">
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-center gap-3">
                            <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm font-medium">Officer deep-dive failed</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {extractErrorMessage(officerMutation.error, "Something went wrong. Please try again.")}
                              </p>
                            </div>
                            {selectedOfficer && (
                              <Button
                                variant="outline"
                                size="sm"
                                data-testid="button-retry-officer-dive"
                                onClick={() => handleOfficerDive(selectedOfficer)}
                              >
                                <RefreshCw className="h-3 w-3 mr-1" />
                                Retry
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {officerDeepDive && (
                      <Card className="border-primary/30">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Eye className="h-4 w-4" />
                            Deep Dive: {officerDeepDive.officerName}
                            <Badge variant="outline" className="ml-2">{officerDeepDive.totalAppointments} appointments</Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {officerDeepDive.activeAppointments?.length > 0 && (
                            <div className="mb-4">
                              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Active Appointments ({officerDeepDive.activeAppointments.length})</h4>
                              <div className="space-y-1">
                                {officerDeepDive.activeAppointments.map((a: any, i: number) => (
                                  <div key={i} className="flex items-center gap-2 text-sm">
                                    <Building2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                    <span className="truncate">{a.appointed_to?.company_name || "Unknown"}</span>
                                    <span className="text-xs text-muted-foreground flex-shrink-0">({a.officer_role})</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {officerDeepDive.aiInsight && (
                            <div className="mt-4 pt-4 border-t">
                              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">AI Analysis</h4>
                              <MarkdownContent content={officerDeepDive.aiInsight} />
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="pscs" className="mt-4">
                  <div className="grid gap-3">
                    {investigation.pscs?.map((psc, i) => (
                      <Card key={i}>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-center gap-2">
                            {psc.kind?.includes("corporate") ? (
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <User className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span className="font-medium text-sm" data-testid={`text-psc-${i}`}>{psc.name}</span>
                          </div>
                          <div className="ml-6 mt-1 space-y-0.5">
                            <p className="text-xs text-muted-foreground">Type: {psc.kind?.replace(/-/g, " ")}</p>
                            {psc.natures_of_control?.map((c: string, j: number) => (
                              <p key={j} className="text-xs text-muted-foreground">Control: {c.replace(/-/g, " ")}</p>
                            ))}
                            {psc.nationality && <p className="text-xs text-muted-foreground">Nationality: {psc.nationality}</p>}
                            {psc.country_of_residence && <p className="text-xs text-muted-foreground">Residence: {psc.country_of_residence}</p>}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {(!investigation.pscs || investigation.pscs.length === 0) && (
                      <p className="text-sm text-muted-foreground p-4">No PSCs found</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="ownership" className="mt-4">
                  <Card>
                    <CardContent className="pt-6">
                      {investigation.ownershipChain?.chain?.length > 0 ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 p-2 bg-accent/50 rounded">
                            <Building2 className="h-4 w-4" />
                            <span className="text-sm font-medium">{investigation.subject.name}</span>
                            <Badge variant="outline" className="text-xs">Subject</Badge>
                          </div>
                          {investigation.ownershipChain.chain.map((link: any, i: number) => (
                            <div key={i}>
                              <div className="flex justify-center">
                                <div className="h-6 w-px bg-border" />
                              </div>
                              <div className="flex items-center gap-2 p-2 bg-accent/30 rounded">
                                <Building2 className="h-4 w-4" />
                                <span className="text-sm">{link.name}</span>
                                <span className="text-xs text-muted-foreground">({link.number})</span>
                                {i === investigation.ownershipChain.chain.length - 1 && (
                                  <Badge className="text-xs">Ultimate Parent</Badge>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No corporate ownership chain discovered — this may be the ultimate parent entity</p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="charges" className="mt-4">
                  <div className="grid gap-3">
                    {(investigation.charges?.length || 0) === 0 && (
                      <Card>
                        <CardContent className="pt-4 pb-4 text-sm text-muted-foreground text-center">
                          No charges or mortgages registered
                        </CardContent>
                      </Card>
                    )}
                    {investigation.charges?.map((charge: any, i: number) => (
                      <Card key={i}>
                        <CardContent className="pt-4 pb-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm font-medium">
                                {charge.classification?.description || charge.particulars?.description || "Charge"}
                              </span>
                            </div>
                            <Badge variant={charge.status === "fully-satisfied" ? "outline" : "default"} className={`text-xs ${charge.status === "fully-satisfied" ? "text-muted-foreground" : charge.status === "outstanding" ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" : ""}`}>
                              {charge.status || "unknown"}
                            </Badge>
                          </div>
                          {(charge.persons_entitled || []).length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              <span className="font-medium">Lender: </span>
                              {charge.persons_entitled.map((p: any) => p.name).join(", ")}
                            </p>
                          )}
                          <div className="flex gap-4 text-xs text-muted-foreground">
                            {charge.created_on && <span>Created: {charge.created_on}</span>}
                            {charge.delivered_on && <span>Delivered: {charge.delivered_on}</span>}
                            {charge.satisfied_on && <span>Satisfied: {charge.satisfied_on}</span>}
                          </div>
                          {charge.particulars?.contains_negative_pledge && (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Negative Pledge</Badge>
                          )}
                          {charge.particulars?.floating_charge_covers_all && (
                            <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">Floating Charge — All Assets</Badge>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="sanctions" className="mt-4">
                  <div className="grid gap-3">
                    {investigation.sanctionsScreening?.map((result: any, i: number) => (
                      <Card key={i}>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm font-medium">{result.name}</span>
                            </div>
                            <SanctionsBadge status={result.status} />
                          </div>
                          {result.matches?.length > 0 && (
                            <div className="ml-6 mt-2 space-y-1">
                              {result.matches.map((m: any, j: number) => (
                                <div key={j} className="text-xs text-muted-foreground">
                                  Matched: <strong>{m.sanctionedName}</strong> (score: {(m.score * 100).toFixed(0)}%, regime: {m.regime})
                                </div>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                    {(!investigation.sanctionsScreening || investigation.sanctionsScreening.length === 0) && (
                      <p className="text-sm text-muted-foreground p-4">Sanctions screening data unavailable</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="filings" className="mt-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-2">
                        {investigation.filingHistory?.map((filing: any, i: number) => {
                          const docMeta = filing.links?.document_metadata || filing.documentMetadata;
                          const docId = typeof docMeta === "string" ? docMeta.split("/").filter(Boolean).pop() : null;
                          return (
                            <div key={i} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-0">
                              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              <span className="text-xs text-muted-foreground flex-shrink-0 w-20">{filing.date}</span>
                              <span className="flex-1 truncate">{filing.description || filing.type}</span>
                              {docId && (
                                <a
                                  href={`/api/companies-house/document/${docId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-primary hover:underline flex-shrink-0"
                                  title="Download filing PDF from Companies House"
                                >
                                  PDF
                                </a>
                              )}
                            </div>
                          );
                        })}
                        {(!investigation.filingHistory || investigation.filingHistory.length === 0) && (
                          <p className="text-sm text-muted-foreground">No recent filings</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              {/* Properties Owned section */}
              <PropertiesOwnedSection propertiesOwned={(investigation as any).propertiesOwned} />
            </div>
          )}

          {!investigation && !individualResult && !isInvestigating && !investigateMutation.isError && !individualMutation.isError && (
            <div className="p-6 space-y-6">
              <ExpiringSection />
              <div className="flex flex-col items-center justify-center gap-4 text-center py-12">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Scale className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">KYC Clouseau</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-md">
                    Your AI-powered KYC investigation tool. Search for any company or individual to get a comprehensive compliance analysis
                    including ownership chains, sanctions screening, officer networks, and AI risk assessment.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

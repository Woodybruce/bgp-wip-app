import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { ScrollableTable } from "@/components/scrollable-table";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Search,
  Minus,
  PoundSterling,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  MapPin,
  FileText,
  Download,
  Loader2,
  Building,
  Shield,
  Landmark,
  AlertTriangle,
  Zap,
  Users,
  TreePine,
  ExternalLink,
  ChevronRight,
  X,
  Scale,
  TrendingUp,
  Home,
  ShieldCheck,
  Warehouse,
  Train,
  Activity,
  Link2,
  Check,
} from "lucide-react";
import { PageLayout } from "@/components/page-layout";
import { EmptyState } from "@/components/empty-state";

interface Transaction {
  id: string;
  pricePaid: number;
  date: string;
  address: {
    paon: string;
    saon: string;
    street: string;
    town: string;
    district: string;
    county: string;
    postcode: string;
  } | null;
  propertyType: string;
  estateType: string;
  newBuild: boolean;
  category: string;
}

interface PricePaidResult {
  items: Transaction[];
  total: number;
}

interface UKHPIData {
  month: string;
  averagePrice: number;
  housePriceIndex: number;
  annualChange: number;
  monthlyChange: number;
  averagePriceFlat: number | null;
  averagePriceDetached: number | null;
  averagePriceSemiDetached: number | null;
  averagePriceTerraced: number | null;
  averagePriceCash: number | null;
  averagePriceMortgage: number | null;
  averagePriceFirstTimeBuyer: number | null;
  region: string;
}

interface UKHPIResult {
  region: string;
  data: UKHPIData[];
}

interface Region {
  slug: string;
  name: string;
}

interface AddressResult {
  label: string;
  postcode: string;
  type: string;
  addressType?: string;
  lat?: number;
  lng?: number;
}

function formatPrice(price: number | null | undefined): string {
  if (price == null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(price);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatAddress(addr: Transaction["address"]): string {
  if (!addr) return "—";
  const parts = [addr.saon, addr.paon, addr.street, addr.town, addr.postcode].filter(Boolean);
  return parts.join(", ");
}

function ChangeIndicator({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  if (value > 0)
    return (
      <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
        <ArrowUpRight className="w-3.5 h-3.5" />
        +{value.toFixed(1)}%
      </span>
    );
  if (value < 0)
    return (
      <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400 font-medium">
        <ArrowDownRight className="w-3.5 h-3.5" />
        {value.toFixed(1)}%
      </span>
    );
  return (
    <span className="flex items-center gap-0.5 text-muted-foreground font-medium">
      <Minus className="w-3.5 h-3.5" />
      0.0%
    </span>
  );
}

async function fetchPD(endpoint: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/propertydata/${endpoint}?${qs}`, { credentials: "include", headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

interface OwnershipData {
  freeholders: Array<{
    name: string;
    titleNumber: string;
    type: string;
    companyReg?: string | null;
    registeredSince?: string | null;
    pricePaid?: string | null;
    leaseholdsUnder?: number | null;
  }>;
  leaseholders: Array<{
    name: string;
    titleNumbers: string[];
    type: string;
    registeredSince?: string | null;
  }>;
  summary: string;
}

interface PropertySummaryData {
  summary: string;
  ownership: OwnershipData | null;
  recommendedTitles: Array<{ titleNumber: string; priority: string; reason: string }>;
  flags: string[];
  investmentAngle: string;
}

interface SavedSearch {
  id: number;
  address: string;
  postcode: string | null;
  freeholdsCount: number;
  leaseholdsCount: number;
  freeholds: any[];
  leaseholds: any[];
  intelligence: Record<string, any>;
  aiSummary: PropertySummaryData | null;
  ownership: OwnershipData | null;
  crmPropertyId: string | null;
  notes: string | null;
  tags: string[];
  status: string | null;
  createdAt: string;
  linked_property?: { id: string; name: string; address: string; postcode: string } | null;
}

const SEARCH_STATUSES = ["New", "Investigating", "Contacted Owner", "No Interest", "Acquired"] as const;

function statusColor(status: string | null): string {
  switch (status) {
    case "Investigating": return "bg-blue-500 text-white";
    case "Contacted Owner": return "bg-amber-500 text-white";
    case "No Interest": return "bg-gray-400 text-white";
    case "Acquired": return "bg-emerald-500 text-white";
    default: return "bg-gray-200 text-gray-700";
  }
}

function PropertySearch({ onSelectPostcode }: { onSelectPostcode: (pc: string, label: string) => void }) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddressResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<AddressResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const { toast } = useToast();

  const [freeholds, setFreeholds] = useState<any[] | null>(null);
  const [leaseholds, setLeaseholds] = useState<any[] | null>(null);
  const [freeholdsLoading, setFreeholdsLoading] = useState(false);
  const [titleDetails, setTitleDetails] = useState<Record<string, any>>({});
  const [titleLoading, setTitleLoading] = useState<Record<string, boolean>>({});
  const [docPurchasing, setDocPurchasing] = useState<Record<string, boolean>>({});
  const [docResults, setDocResults] = useState<Record<string, any>>({});

  const [intelligence, setIntelligence] = useState<Record<string, any>>({});
  const [intelLoading, setIntelLoading] = useState(false);

  const [aiSummary, setAiSummary] = useState<PropertySummaryData | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState(false);
  const [showAllTitles, setShowAllTitles] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("overview");
  const requestIdRef = useRef(0);

  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [searchesLoading, setSearchesLoading] = useState(true);
  const searchSavedRef = useRef(false);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState<number | null>(null);
  const [crmPropertySearch, setCrmPropertySearch] = useState("");
  const [linkingSearchId, setLinkingSearchId] = useState<number | null>(null);

  const { data: allCrmProperties = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/properties"],
    queryFn: async () => {
      const res = await fetch("/api/crm/properties", { credentials: "include", headers: getAuthHeaders() });
      const data = await res.json();
      return Array.isArray(data) ? data : (data.data ?? []);
    },
  });

  const linkPropertyMutation = useMutation({
    mutationFn: async ({ searchId, crmPropertyId }: { searchId: number; crmPropertyId: string | null }) => {
      const res = await fetch(`/api/land-registry/searches/${searchId}/link-property`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ crmPropertyId }),
      });
      if (!res.ok) throw new Error("Failed to link property");
      return res.json();
    },
    onSuccess: (updated: SavedSearch) => {
      setSavedSearches(prev => prev.map(s => s.id === updated.id ? { ...s, crmPropertyId: updated.crmPropertyId } : s));
      setLinkPopoverOpen(null);
      setCrmPropertySearch("");
    },
  });

  const updateSearchStatus = async (searchId: number, status: string) => {
    try {
      const res = await fetch(`/api/land-registry/searches/${searchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setSavedSearches(prev => prev.map(s => s.id === searchId ? { ...s, status } : s));
        toast({ title: "Status updated", description: `Search marked as "${status}"` });
      }
    } catch {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  useEffect(() => {
    fetch("/api/land-registry/searches/recent", { credentials: "include", headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(data => setSavedSearches(Array.isArray(data) ? data : []))
      .catch(() => {
        // Fallback to original endpoint
        fetch("/api/land-registry/searches", { credentials: "include", headers: getAuthHeaders() })
          .then(r => r.ok ? r.json() : [])
          .then(data => setSavedSearches(Array.isArray(data) ? data : []))
          .catch(() => {});
      })
      .finally(() => setSearchesLoading(false));
  }, []);

  // Deep-link from Property Pathway's Title link:
  // /property-intelligence?tab=land-registry&postcode=<pc> should auto-open
  // the most recent saved search for that postcode (preferring source=pathway
  // rows so clicking the Title number surfaces the Stage 1 results directly).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (typeof window === "undefined") return;
    if (savedSearches.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const pc = (params.get("postcode") || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!pc) return;
    const match =
      savedSearches.find(s => (s.postcode || "").toUpperCase().replace(/\s+/g, "") === pc && (s as any).source === "pathway")
      || savedSearches.find(s => (s.postcode || "").toUpperCase().replace(/\s+/g, "") === pc);
    if (match) {
      autoOpenedRef.current = true;
      loadSavedSearch(match);
      params.delete("postcode");
      const clean = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${clean ? "?" + clean : ""}`);
    }
    // loadSavedSearch identity is stable via useCallback; exclude from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSearches]);

  const saveSearch = useCallback(async (addr: string, pc: string, fh: any[], lh: any[], intel: Record<string, any>, summary: PropertySummaryData) => {
    try {
      const res = await fetch("/api/land-registry/searches", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({
          address: addr,
          postcode: pc,
          freeholds: fh,
          leaseholds: lh,
          intelligence: intel,
          aiSummary: summary,
          ownership: summary.ownership,
        }),
      });
      if (res.ok) {
        const row = await res.json();
        setSavedSearches(prev => [row, ...prev]);
      }
    } catch {}
  }, []);

  const loadSavedSearch = useCallback((search: SavedSearch) => {
    const addr: AddressResult = { label: search.address, postcode: search.postcode || "", type: "place" };
    setSelectedAddress(addr);
    setQuery(search.address);
    setResults([]);
    setFreeholds(search.freeholds || []);
    setLeaseholds(search.leaseholds || []);
    setIntelligence(search.intelligence || {});
    setAiSummary(search.aiSummary || null);
    setAiSummaryError(false);
    setAiSummaryLoading(false);
    setFreeholdsLoading(false);
    setIntelLoading(false);
    setTitleDetails({});
    setDocResults({});
    setShowAllTitles(false);
    setActiveSection("overview");
    searchSavedRef.current = true;
    if (search.postcode) onSelectPostcode(search.postcode, search.address);
  }, [onSelectPostcode]);

  const searchAddress = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/address-search?q=${encodeURIComponent(q)}`, { credentials: "include", headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch {} finally { setSearching(false); }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchAddress(value), 300);
  };

  const fetchAiSummary = async (reqId: number, addr: string, pc: string, fh: any[], lh: any[], intel: Record<string, any>) => {
    setAiSummaryLoading(true);
    setAiSummaryError(false);
    searchSavedRef.current = false;
    try {
      const res = await fetch("/api/property-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({
          propertyAddress: addr,
          postcode: pc,
          freeholds: fh,
          leaseholds: lh,
          intelligence: intel,
        }),
      });
      if (reqId !== requestIdRef.current) return;
      if (res.ok) {
        const data = await res.json();
        setAiSummary(data);
        if (!searchSavedRef.current) {
          searchSavedRef.current = true;
          saveSearch(addr, pc, fh, lh, intel, data);
        }
      } else {
        setAiSummaryError(true);
      }
    } catch (e: any) {
      if (reqId !== requestIdRef.current) return;
      console.error("AI summary error:", e);
      setAiSummaryError(true);
    } finally {
      if (reqId === requestIdRef.current) setAiSummaryLoading(false);
    }
  };

  const selectAddress = async (addr: AddressResult) => {
    const thisReqId = ++requestIdRef.current;
    setSelectedAddress(addr);
    setResults([]);
    setQuery(addr.label);
    setFreeholds(null);
    setLeaseholds(null);
    setTitleDetails({});
    setDocResults({});
    setIntelligence({});
    setAiSummary(null);
    setAiSummaryError(false);
    setShowAllTitles(false);
    setActiveSection("overview");

    const pc = addr.postcode;
    if (pc) {
      onSelectPostcode(pc, addr.label);
      const cleanPc = pc.replace(/\s+/g, "");

      setFreeholdsLoading(true);
      setIntelLoading(true);

      let fetchedFreeholds: any[] = [];
      let fetchedLeaseholds: any[] = [];

      const extract = (r: PromiseSettledResult<any>) => r.status === "fulfilled" && r.value?.status === "success" ? (r.value.data || r.value) : null;

      try {
        // UPRN-accurate title resolution: Google address → PropertyData
        // address-match-uprn → uprn-title. Wider postcode data follows.
        const resolvePromise = fetch("/api/land-registry/resolve", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({
            address: addr.label?.split(" — ")[0].trim() || "",
            postcode: cleanPc,
            lat: addr.lat,
            lng: addr.lng,
          }),
        }).then(r => r.ok ? r.json() : null).catch(() => null);

        const [resolved, planningData, demoData, yieldsData, demandData, rentsData, growthData, conservationData, listedData, soldData, floodData, energyData, floorData] = await Promise.allSettled([
          resolvePromise,
          fetchPD("planning-applications", { postcode: cleanPc }),
          fetchPD("demographics", { postcode: cleanPc }),
          fetchPD("yields", { postcode: cleanPc }),
          fetchPD("demand", { postcode: cleanPc }),
          fetchPD("rents-commercial", { postcode: cleanPc, type: "offices" }),
          fetchPD("growth", { postcode: cleanPc }),
          fetchPD("conservation-area", { postcode: cleanPc }),
          fetchPD("listed-buildings", { postcode: cleanPc }),
          fetchPD("sold-prices", { postcode: cleanPc }),
          fetchPD("flood-risk", { postcode: cleanPc }),
          fetchPD("energy-efficiency", { postcode: cleanPc }),
          fetchPD("floor-areas", { postcode: cleanPc }),
        ]);

        if (thisReqId !== requestIdRef.current) return;

        // Resolver tells us which titles are THIS property vs neighbours.
        // Prefer UPRN matches, fall back to street-number match, final
        // fallback is the whole postcode (same as before — labelled clearly).
        const resolvedPayload = resolved.status === "fulfilled" ? resolved.value : null;
        const matchedFh = resolvedPayload?.matched?.freeholds || [];
        const matchedLh = resolvedPayload?.matched?.leaseholds || [];
        const fallbackFh = resolvedPayload?.fallback?.freeholds || [];
        const fallbackLh = resolvedPayload?.fallback?.leaseholds || [];
        const contextFh = resolvedPayload?.context?.freeholds || [];
        const contextLh = resolvedPayload?.context?.leaseholds || [];

        // Tag rows so the UI can style matched vs context differently.
        const tag = (rows: any[], matchSource: "uprn" | "street" | "postcode") =>
          rows.map(r => ({ ...r, _match: matchSource }));

        if (matchedFh.length > 0 || matchedLh.length > 0) {
          fetchedFreeholds = [...tag(matchedFh, "uprn"), ...tag(contextFh, "postcode")];
          fetchedLeaseholds = [...tag(matchedLh, "uprn"), ...tag(contextLh, "postcode")];
        } else if (fallbackFh.length > 0 || fallbackLh.length > 0) {
          fetchedFreeholds = [...tag(fallbackFh, "street"), ...tag(contextFh, "postcode")];
          fetchedLeaseholds = [...tag(fallbackLh, "street"), ...tag(contextLh, "postcode")];
        } else {
          fetchedFreeholds = tag(contextFh, "postcode");
          fetchedLeaseholds = tag(contextLh, "postcode");
        }

        setFreeholds(fetchedFreeholds);
        setLeaseholds(fetchedLeaseholds);

        const intel: Record<string, any> = {};
        if (extract(planningData)) intel.planning = planningData.status === "fulfilled" ? planningData.value : null;
        if (extract(demoData)) intel.demographics = extract(demoData);
        if (extract(yieldsData)) intel.yields = extract(yieldsData);
        if (extract(demandData)) intel.demand = extract(demandData);
        if (extract(rentsData)) intel.rents = extract(rentsData);
        if (extract(growthData)) intel.growth = extract(growthData);
        if (extract(conservationData)) intel.conservation = extract(conservationData);
        if (extract(listedData)) intel.listed = extract(listedData);
        if (extract(floodData)) intel.flood = extract(floodData);
        if (extract(energyData)) intel.energy = extract(energyData);
        if (extract(floorData)) intel.floorAreas = extract(floorData);
        if (extract(soldData)) {
          intel.sold = extract(soldData);
          if (intel.sold?.average) {
            intel.stats = {
              average_price: intel.sold.average,
              points_analysed: intel.sold.points_analysed,
              radius: intel.sold.radius,
              date_range: intel.sold.date_earliest && intel.sold.date_latest ? `${intel.sold.date_earliest} to ${intel.sold.date_latest}` : null,
            };
          }
        }
        setIntelligence(intel);

        fetchAiSummary(thisReqId, addr.label, pc, fetchedFreeholds, fetchedLeaseholds, intel);
      } catch {} finally {
        setFreeholdsLoading(false);
        setIntelLoading(false);
      }
    }
  };

  const lookupTitle = async (titleNumber: string) => {
    setTitleLoading(prev => ({ ...prev, [titleNumber]: true }));
    try {
      const data = await fetchPD("analyse-buildings", { title: titleNumber });
      setTitleDetails(prev => ({ ...prev, [titleNumber]: data }));
    } catch (e: any) {
      toast({ title: "Title lookup failed", description: e.message, variant: "destructive" });
    } finally { setTitleLoading(prev => ({ ...prev, [titleNumber]: false })); }
  };

  const purchaseDocuments = async (titleNumber: string, docType: "register" | "plan" | "both") => {
    setDocPurchasing(prev => ({ ...prev, [titleNumber + docType]: true }));
    try {
      const data = await fetchPD("land-registry-documents", { title: titleNumber, documents: docType, extract_proprietor_data: "true" });
      if (data.status === "success" || data.document_url) {
        setDocResults(prev => ({ ...prev, [titleNumber + docType]: data }));
        toast({ title: "Document purchased", description: `${docType === "both" ? "Title Register & Plan" : docType === "register" ? "Title Register" : "Title Plan"} ready for download` });
      } else {
        toast({ title: "Purchase failed", description: data.message || "Could not purchase document", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Purchase failed", description: e.message, variant: "destructive" });
    } finally { setDocPurchasing(prev => ({ ...prev, [titleNumber + docType]: false })); }
  };

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    setSelectedAddress(null);
    setFreeholds(null);
    setLeaseholds(null);
    setTitleDetails({});
    setDocResults({});
    setIntelligence({});
    setAiSummary(null);
    setShowAllTitles(false);
  };

  const recommendedTitleNumbers = new Set((aiSummary?.recommendedTitles || []).map(t => t.titleNumber));

  const renderTitleRow = (f: any, i: number, isLeasehold?: boolean) => {
    const tn = f.title_number || f.title || "";
    const recommendation = aiSummary?.recommendedTitles?.find(r => r.titleNumber === tn);
    const priorityColor = recommendation?.priority === "high" ? "border-amber-400 bg-amber-50/50 dark:bg-amber-950/20" : recommendation?.priority === "medium" ? "border-blue-300 bg-blue-50/30 dark:bg-blue-950/20" : "";

    // _match comes from /api/land-registry/resolve — 'uprn' means exact
    // match on the Ordnance Survey UPRN, 'street' is a street-number
    // fallback, 'postcode' is a wider-area neighbour not specifically
    // tied to the searched property.
    const matchSource: "uprn" | "street" | "postcode" | undefined = (f as any)._match;
    const matchClass = matchSource === "uprn"
      ? "border-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20 ring-1 ring-emerald-300/60"
      : matchSource === "street"
      ? "border-blue-300 bg-blue-50/30 dark:bg-blue-950/20"
      : matchSource === "postcode"
      ? "border-border/60 bg-muted/10 opacity-80"
      : "";

    return (
      <div key={tn || i} className={`border rounded-lg p-3 space-y-2 ${recommendation ? priorityColor : matchClass}`} data-testid={`title-${tn}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="font-mono text-xs shrink-0">{tn}</Badge>
              <Badge variant={isLeasehold ? "secondary" : "outline"} className="text-[10px]">
                {isLeasehold ? "Leasehold" : "Freehold"}
              </Badge>
              {matchSource === "uprn" && (
                <Badge className="text-[10px] bg-emerald-600 text-white" title="Matched via Ordnance Survey UPRN — this IS the property you searched for">
                  This property
                </Badge>
              )}
              {matchSource === "street" && (
                <Badge className="text-[10px] bg-blue-500 text-white" title="Matched by street number — likely this property">
                  Likely this property
                </Badge>
              )}
              {matchSource === "postcode" && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground" title="Not specifically tied to the searched property — another title at the same postcode">
                  Postcode neighbour
                </Badge>
              )}
              {recommendation && (
                <Badge className={`text-[10px] ${recommendation.priority === "high" ? "bg-amber-500 text-white" : recommendation.priority === "medium" ? "bg-blue-500 text-white" : "bg-gray-400 text-white"}`}>
                  {recommendation.priority === "high" ? "Recommended" : recommendation.priority === "medium" ? "Worth investigating" : "Low priority"}
                </Badge>
              )}
            </div>
            {f.proprietor_name_1 && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <Users className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium truncate">{f.proprietor_name_1}</span>
                {f.proprietor_category && (
                  <Badge variant="outline" className="text-[9px] shrink-0">{f.proprietor_category}</Badge>
                )}
                <button
                  className="inline-flex items-center text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 shrink-0"
                  onClick={(e) => { e.stopPropagation(); navigate(`/kyc-clouseau?name=${encodeURIComponent(f.proprietor_name_1)}&address=${encodeURIComponent(selectedAddress?.label || "")}`); }}
                  title="Investigate owner"
                  data-testid={`button-investigate-prelim-${tn}`}
                >
                  <Scale className="w-3 h-3" />
                </button>
              </div>
            )}
            {f.address && (
              <p className="text-xs text-muted-foreground mt-1 truncate">{f.address}</p>
            )}
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              {f.polygons?.[0]?.leaseholds != null && (
                <span>{f.polygons[0].leaseholds} leaseholds</span>
              )}
              {f.date_proprietor_added && <span>Reg: {f.date_proprietor_added}</span>}
              {f.price_paid && <span>Paid: {formatPrice(Number(f.price_paid))}</span>}
              {f.plot_size && <span>Plot: {f.plot_size}</span>}
            </div>
            {recommendation && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1.5 italic">{recommendation.reason}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!titleDetails[tn] && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => lookupTitle(tn)}
                disabled={titleLoading[tn]}
                className="text-xs h-7"
                data-testid={`button-lookup-${tn}`}
              >
                {titleLoading[tn] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                <span className="ml-1">Analyse</span>
              </Button>
            )}
          </div>
        </div>

        {titleDetails[tn] && (
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 text-xs space-y-1">
            {titleDetails[tn]?.data?.buildings && (
              <p>Buildings: {titleDetails[tn].data.buildings.length} found</p>
            )}
            {titleDetails[tn]?.data?.plot_area_sqm && (
              <p>Plot area: {Number(titleDetails[tn].data.plot_area_sqm).toLocaleString()} sqm ({(Number(titleDetails[tn].data.plot_area_sqm) * 10.764).toFixed(0)} sqft)</p>
            )}
            {titleDetails[tn]?.data?.uprns?.length > 0 && (
              <p>UPRNs on title: {titleDetails[tn].data.uprns.length}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {["register", "plan", "both"].map(docType => {
            const key = tn + docType;
            const result = docResults[key];
            const buying = docPurchasing[key];
            if (result?.data?.document_url || result?.document_url) {
              const url = result?.data?.document_url || result?.document_url;
              return (
                <a key={docType} href={url} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="text-xs h-7 gap-1 text-emerald-600" data-testid={`button-download-${tn}-${docType}`}>
                    <Download className="w-3 h-3" />
                    {docType === "both" ? "Register & Plan" : docType === "register" ? "Register" : "Plan"}
                  </Button>
                </a>
              );
            }
            return (
              <Button
                key={docType}
                variant="outline"
                size="sm"
                className="text-xs h-7 gap-1"
                onClick={() => purchaseDocuments(tn, docType as any)}
                disabled={buying}
                data-testid={`button-purchase-${tn}-${docType}`}
              >
                {buying ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                {docType === "both" ? "Buy Both (£15+VAT)" : docType === "register" ? "Buy Register (£7.50)" : "Buy Plan (£7.50)"}
              </Button>
            );
          })}
        </div>

        {Object.entries(docResults).filter(([k]) => k.startsWith(tn)).map(([key, result]) => {
          const propData = result?.data?.proprietor_data || result?.proprietor_data;
          if (!propData) return null;
          return (
            <div key={key} className="bg-blue-50 dark:bg-blue-950 rounded-lg p-3 text-xs space-y-2">
              <p className="font-semibold text-blue-700 dark:text-blue-300">Proprietor Data (from Title Register)</p>
              {propData.proprietor_name && <p>Name: {propData.proprietor_name}</p>}
              {propData.proprietor_address && <p>Address: {propData.proprietor_address}</p>}
              {propData.price_paid && <p>Price paid: {formatPrice(propData.price_paid)}</p>}
              {propData.date_of_purchase && <p>Date: {propData.date_of_purchase}</p>}
              {propData.mortgage_lender && <p>Mortgage: {propData.mortgage_lender}</p>}
              {propData.proprietor_name && (
                <Button
                  variant="default"
                  size="sm"
                  className="text-xs h-7 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white mt-1"
                  onClick={() => navigate(`/kyc-clouseau?name=${encodeURIComponent(propData.proprietor_name)}&address=${encodeURIComponent(selectedAddress?.label || "")}&mortgage=${encodeURIComponent(propData.mortgage_lender || "")}&price=${encodeURIComponent(propData.price_paid || "")}`)}
                  data-testid={`button-investigate-owner-${key}`}
                >
                  <Scale className="w-3 h-3" />
                  Investigate Owner
                </Button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <div className="relative flex items-center">
          <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by address, building name, or postcode..."
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            className="pl-9 pr-9"
            data-testid="input-address-search"
          />
          {query && (
            <button onClick={clearSearch} className="absolute right-3 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {searching && (
          <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white dark:bg-gray-900 border rounded-lg shadow-lg p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching...
            </div>
          </div>
        )}
        {!searching && results.length > 0 && !selectedAddress && (
          <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white dark:bg-gray-900 border rounded-lg shadow-lg max-h-[300px] overflow-y-auto">
            {results.map((r, i) => (
              <button
                key={i}
                onClick={() => selectAddress(r)}
                className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-3 text-sm border-b last:border-b-0"
                data-testid={`address-result-${i}`}
              >
                <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="block truncate">{r.label}</span>
                  {r.postcode && <span className="text-xs text-muted-foreground">{r.postcode}</span>}
                </div>
                {r.addressType === "address" && (
                  <Badge variant="secondary" className="text-[10px] shrink-0">Exact</Badge>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {!selectedAddress && !searching && results.length === 0 && (
        <div className="space-y-6">
          <div className="text-center py-8 text-muted-foreground">
            <Building className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">Search for any UK property</p>
            <p className="text-xs mt-2 max-w-md mx-auto">
              Get ownership analysis, market intelligence, and title register recommendations. Searches run in the background and are saved automatically.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {["Ownership", "Freeholder", "Leaseholders", "Yields", "Rents", "Planning", "EPC", "Flood Risk", "Title Register", "KYC"].map(tag => (
                <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
              ))}
            </div>
          </div>

          {savedSearches.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-muted-foreground" />
                Recent Searches ({savedSearches.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {savedSearches.slice(0, 20).map((s) => {
                  const linkedProperty = s.linked_property || (s.crmPropertyId ? allCrmProperties.find((p: any) => p.id === s.crmPropertyId) : null);
                  const filteredProperties = allCrmProperties.filter((p: any) =>
                    !crmPropertySearch || (p.name || "").toLowerCase().includes(crmPropertySearch.toLowerCase())
                  );
                  const ownerName = s.ownership && typeof s.ownership === "object"
                    ? ((s.ownership as OwnershipData).freeholders?.[0]?.name || null)
                    : null;
                  return (
                    <Card key={s.id} className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer group">
                      <button
                        onClick={() => loadSavedSearch(s)}
                        className="w-full text-left p-3"
                        data-testid={`saved-search-${s.id}`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <p className="text-sm font-medium truncate">{s.address}</p>
                          </div>
                          <Badge className={`text-[9px] shrink-0 ${statusColor(s.status)}`}>
                            {s.status || "New"}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          {s.postcode && <span className="text-xs text-muted-foreground font-mono">{s.postcode}</span>}
                          {s.freeholdsCount > 0 && <Badge variant="secondary" className="text-[10px]">{s.freeholdsCount} freeholds</Badge>}
                          {s.leaseholdsCount > 0 && <Badge variant="secondary" className="text-[10px]">{s.leaseholdsCount} leaseholds</Badge>}
                        </div>
                        {ownerName && (
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Users className="w-3 h-3 text-blue-500 shrink-0" />
                            <span className="text-xs text-muted-foreground truncate">{ownerName}</span>
                          </div>
                        )}
                        {s.ownership && typeof s.ownership === "object" && (s.ownership as OwnershipData).summary && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{(s.ownership as OwnershipData).summary}</p>
                        )}
                        <div className="text-[10px] text-muted-foreground mt-2">
                          {new Date(s.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </div>
                      </button>
                      <div className="px-3 pb-2 flex items-center gap-2 border-t bg-muted/20 pt-2">
                        <div className="flex-1 min-w-0">
                          {linkedProperty ? (
                            <div className="flex items-center gap-1.5">
                              <Check className="w-3 h-3 text-green-600 shrink-0" />
                              <Link href={`/properties/${(linkedProperty as any).id}`} className="text-xs font-medium text-primary hover:underline truncate">
                                {(linkedProperty as any).name}
                              </Link>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">Not linked</span>
                          )}
                        </div>
                        <Select
                          value={s.status || "New"}
                          onValueChange={(val) => updateSearchStatus(s.id, val)}
                        >
                          <SelectTrigger className="h-6 w-auto text-[10px] px-2 border-none bg-transparent gap-1" onClick={(e) => e.stopPropagation()}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SEARCH_STATUSES.map((st) => (
                              <SelectItem key={st} value={st} className="text-xs">{st}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Popover open={linkPopoverOpen === s.id} onOpenChange={(open) => {
                          setLinkPopoverOpen(open ? s.id : null);
                          if (!open) setCrmPropertySearch("");
                        }}>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-6 text-xs px-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <Link2 className="w-3 h-3" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-72 p-2" align="end">
                            <p className="text-xs font-semibold mb-2 px-1">Link to CRM Property</p>
                            <Input
                              placeholder="Search properties..."
                              value={crmPropertySearch}
                              onChange={(e) => setCrmPropertySearch(e.target.value)}
                              className="h-7 text-xs mb-2"
                            />
                            <div className="max-h-48 overflow-y-auto space-y-0.5">
                              {linkedProperty && (
                                <button
                                  className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted transition-colors text-muted-foreground"
                                  onClick={() => {
                                    setLinkingSearchId(s.id);
                                    linkPropertyMutation.mutate({ searchId: s.id, crmPropertyId: null });
                                  }}
                                  disabled={linkingSearchId === s.id && linkPropertyMutation.isPending}
                                >
                                  Remove link
                                </button>
                              )}
                              {filteredProperties.slice(0, 30).map((p: any) => (
                                <button
                                  key={p.id}
                                  className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted transition-colors flex items-center gap-2 ${p.id === s.crmPropertyId ? "bg-muted font-medium" : ""}`}
                                  onClick={() => {
                                    setLinkingSearchId(s.id);
                                    linkPropertyMutation.mutate({ searchId: s.id, crmPropertyId: p.id });
                                  }}
                                  disabled={linkingSearchId === s.id && linkPropertyMutation.isPending}
                                >
                                  {p.id === s.crmPropertyId && <Check className="w-3 h-3 text-green-600 shrink-0" />}
                                  <span className="truncate">{p.name}</span>
                                </button>
                              ))}
                              {filteredProperties.length === 0 && (
                                <p className="text-xs text-muted-foreground px-2 py-2">No properties found</p>
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
          {searchesLoading && (
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          )}
          {!searchesLoading && savedSearches.length === 0 && (
            <EmptyState
              icon={MapPin}
              title="No searches yet"
              description="Search for a property to get started"
            />
          )}
        </div>
      )}

      {selectedAddress && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Building className="w-4 h-4 text-muted-foreground" />
                    <h3 className="font-semibold text-sm">{selectedAddress.label}</h3>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {selectedAddress.postcode && (
                      <Badge variant="outline" className="text-xs">{selectedAddress.postcode}</Badge>
                    )}
                    {freeholds && <Badge variant="secondary" className="text-[10px]">{freeholds.length} freeholds</Badge>}
                    {leaseholds && leaseholds.length > 0 && <Badge variant="secondary" className="text-[10px]">{leaseholds.length} leaseholds</Badge>}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={clearSearch} data-testid="button-clear-search">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {(freeholdsLoading || intelLoading) && !aiSummary && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Gathering property data and market intelligence...
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            </div>
          )}

          {aiSummaryLoading && !aiSummary && !freeholdsLoading && !intelLoading && (
            <Card className="border-amber-200 dark:border-amber-800">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                  <span className="text-muted-foreground">AI is analysing property data and preparing recommendations...</span>
                </div>
              </CardContent>
            </Card>
          )}

          {aiSummaryError && !aiSummaryLoading && !aiSummary && (
            <Card className="border-red-200 dark:border-red-800">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Could not generate AI analysis</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => {
                      if (selectedAddress?.postcode) {
                        fetchAiSummary(requestIdRef.current, selectedAddress.label, selectedAddress.postcode, freeholds || [], leaseholds || [], intelligence);
                      }
                    }}
                    data-testid="button-retry-summary"
                  >
                    Retry
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {aiSummary?.ownership && (
            <Card className="border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50/50 to-white dark:from-blue-950/20 dark:to-gray-950">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-500" />
                  Ownership Structure
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-relaxed font-medium" data-testid="text-ownership-summary">{aiSummary.ownership.summary}</p>

                {aiSummary.ownership.freeholders?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1.5 flex items-center gap-1">
                      <Landmark className="w-3 h-3" /> Freeholder{aiSummary.ownership.freeholders.length > 1 ? "s" : ""}
                    </p>
                    <div className="space-y-1.5">
                      {aiSummary.ownership.freeholders.map((fh, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs bg-white dark:bg-gray-900 rounded-md p-2 border">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold">{fh.name}</span>
                              <Badge variant="outline" className="text-[9px]">{fh.type}</Badge>
                              <Badge className="font-mono text-[9px]">{fh.titleNumber}</Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-muted-foreground flex-wrap">
                              {fh.companyReg && <span>Co. {fh.companyReg}</span>}
                              {fh.registeredSince && <span>Since {fh.registeredSince}</span>}
                              {fh.pricePaid && <span>Paid {fh.pricePaid}</span>}
                              {fh.leaseholdsUnder != null && <span>{fh.leaseholdsUnder} leaseholds</span>}
                            </div>
                          </div>
                          <button
                            className="inline-flex items-center text-amber-600 hover:text-amber-800 dark:text-amber-400 shrink-0 mt-0.5"
                            onClick={() => navigate(`/kyc-clouseau?name=${encodeURIComponent(fh.name)}&address=${encodeURIComponent(selectedAddress?.label || "")}`)}
                            title="Investigate owner"
                            data-testid={`button-investigate-fh-${i}`}
                          >
                            <Scale className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {aiSummary.ownership.leaseholders?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1.5 flex items-center gap-1">
                      <Users className="w-3 h-3" /> Leaseholders ({aiSummary.ownership.leaseholders.length})
                    </p>
                    <div className="space-y-1">
                      {aiSummary.ownership.leaseholders.slice(0, showAllTitles ? 50 : 5).map((lh, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs bg-white dark:bg-gray-900 rounded-md px-2 py-1.5 border">
                          <span className="font-medium flex-1 min-w-0 truncate">{lh.name}</span>
                          <Badge variant="outline" className="text-[9px]">{lh.type}</Badge>
                          <span className="text-muted-foreground font-mono text-[10px]">{lh.titleNumbers.join(", ")}</span>
                        </div>
                      ))}
                      {aiSummary.ownership.leaseholders.length > 5 && !showAllTitles && (
                        <button
                          onClick={() => setShowAllTitles(true)}
                          className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400"
                          data-testid="button-show-all-leaseholders"
                        >
                          Show all {aiSummary.ownership.leaseholders.length} leaseholders
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {aiSummary && (
            <Card className="border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50/50 to-white dark:from-amber-950/20 dark:to-gray-950">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  Property Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-relaxed" data-testid="text-ai-summary">{aiSummary.summary}</p>

                {aiSummary.investmentAngle && (
                  <div className="bg-white dark:bg-gray-900 rounded-lg p-3 border border-amber-200 dark:border-amber-800">
                    <div className="flex items-center gap-1.5 mb-1">
                      <TrendingUp className="w-3.5 h-3.5 text-amber-600" />
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Investment Angle</span>
                    </div>
                    <p className="text-xs leading-relaxed" data-testid="text-investment-angle">{aiSummary.investmentAngle}</p>
                  </div>
                )}

                {aiSummary.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {aiSummary.flags.map((flag, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:text-amber-400" data-testid={`badge-flag-${i}`}>
                        <AlertTriangle className="w-2.5 h-2.5 mr-1" />
                        {flag}
                      </Badge>
                    ))}
                  </div>
                )}

                {aiSummary.recommendedTitles.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-2">Recommended Title Purchases:</p>
                    <div className="space-y-1.5">
                      {aiSummary.recommendedTitles.map((rec, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <Badge className={`shrink-0 text-[10px] ${rec.priority === "high" ? "bg-amber-500 text-white" : rec.priority === "medium" ? "bg-blue-500 text-white" : "bg-gray-400 text-white"}`}>
                            {rec.titleNumber}
                          </Badge>
                          <span className="text-muted-foreground">{rec.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {(freeholds || leaseholds || Object.keys(intelligence).length > 0) && !freeholdsLoading && (
            <div className="flex gap-1 border-b pb-2">
              {[
                { id: "overview", label: "Market Data", icon: BarChart3 },
                { id: "titles", label: `Titles (${(freeholds?.length || 0) + (leaseholds?.length || 0)})`, icon: Landmark },
                { id: "sold", label: "Sales", icon: PoundSterling },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveSection(tab.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${activeSection === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                  data-testid={`tab-section-${tab.id}`}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {activeSection === "overview" && Object.keys(intelligence).length > 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {intelligence.stats && (
                  <Card className="border-primary/20">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <PoundSterling className="w-4 h-4 text-emerald-500" />
                        <p className="text-xs font-semibold">Market Overview</p>
                      </div>
                      <div className="space-y-1 text-xs">
                        {intelligence.stats.average_price != null && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Avg Price</span>
                            <span className="font-semibold">{formatPrice(intelligence.stats.average_price)}</span>
                          </div>
                        )}
                        {intelligence.stats.points_analysed != null && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Sales Analysed</span>
                            <span className="font-medium">{intelligence.stats.points_analysed}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {intelligence.rents && (
                  <Card className="border-primary/20">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Warehouse className="w-4 h-4 text-blue-500" />
                        <p className="text-xs font-semibold">Commercial Rents</p>
                      </div>
                      <div className="space-y-1 text-xs">
                        {intelligence.rents.avg_quoting_rent_per_sqft != null && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Avg Rent</span>
                            <span className="font-semibold">{"\u00A3"}{Number(intelligence.rents.avg_quoting_rent_per_sqft).toLocaleString()}/sqft</span>
                          </div>
                        )}
                        {intelligence.rents.avg_quoting_rent != null && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Avg Total</span>
                            <span className="font-medium">{"\u00A3"}{Number(intelligence.rents.avg_quoting_rent).toLocaleString()}/yr</span>
                          </div>
                        )}
                        {intelligence.rents.points_analysed != null && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Sample</span>
                            <span className="font-medium">{intelligence.rents.points_analysed} offices</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {intelligence.yields && (
                  <Card className="border-primary/20">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="w-4 h-4 text-violet-500" />
                        <p className="text-xs font-semibold">Yields</p>
                      </div>
                      <div className="space-y-1 text-xs">
                        {intelligence.yields.long_let?.gross_yield && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Long Let Gross</span>
                            <span className="font-semibold">{intelligence.yields.long_let.gross_yield}</span>
                          </div>
                        )}
                        {intelligence.yields.area_yield != null && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Area Yield</span>
                            <span className="font-medium">{intelligence.yields.area_yield}%</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {intelligence.demand && (
                  <Card>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <BarChart3 className="w-4 h-4 text-orange-500" />
                        <p className="text-xs font-semibold">Market Demand</p>
                      </div>
                      <div className="space-y-1 text-xs">
                        {intelligence.demand.demand_rating != null && (
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Rating</span>
                            <Badge className={`text-[10px] ${
                              String(intelligence.demand.demand_rating).toLowerCase().includes("seller") || String(intelligence.demand.demand_rating).toLowerCase().includes("hot")
                              ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              : String(intelligence.demand.demand_rating).toLowerCase().includes("balanced")
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                            }`}>
                              {intelligence.demand.demand_rating}
                            </Badge>
                          </div>
                        )}
                        {intelligence.demand.months_of_inventory != null && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Inventory</span>
                            <span className="font-medium">{intelligence.demand.months_of_inventory} months</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {intelligence.growth && (() => {
                  const rows = Array.isArray(intelligence.growth) ? intelligence.growth : [];
                  const latest = rows.length > 0 ? rows[rows.length - 1] : null;
                  const oneYearAgo = rows.length >= 2 ? rows[rows.length - 2] : null;
                  const latestPrice = latest?.[1];
                  const oneYrGrowth = oneYearAgo?.[1] && latestPrice ? (((latestPrice - oneYearAgo[1]) / oneYearAgo[1]) * 100).toFixed(1) : null;
                  if (!latestPrice) return null;
                  return (
                    <Card className="border-primary/20">
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Activity className="w-4 h-4 text-cyan-500" />
                          <p className="text-xs font-semibold">Capital Growth</p>
                        </div>
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Current Avg</span>
                            <span className="font-semibold">{formatPrice(latestPrice)}</span>
                          </div>
                          {oneYrGrowth != null && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">1 Year</span>
                              <span className={`font-semibold ${Number(oneYrGrowth) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {Number(oneYrGrowth) >= 0 ? "+" : ""}{oneYrGrowth}%
                              </span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                {intelligence.flood && (
                  <Card>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Shield className="w-4 h-4 text-blue-600" />
                        <p className="text-xs font-semibold">Flood Risk</p>
                      </div>
                      <div className="text-xs">
                        {intelligence.flood.flood_risk ? (
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Risk Level</span>
                            <Badge variant={intelligence.flood.flood_risk === "Very Low" || intelligence.flood.flood_risk === "Low" ? "secondary" : "destructive"} className="text-[10px]">
                              {intelligence.flood.flood_risk}
                            </Badge>
                          </div>
                        ) : (
                          <p className="text-muted-foreground">Data unavailable</p>
                        )}
                        {intelligence.flood.surface_water && (
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-muted-foreground">Surface Water</span>
                            <span className="font-medium">{intelligence.flood.surface_water}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {intelligence.conservation && (
                  <Card>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <ShieldCheck className="w-4 h-4 text-teal-500" />
                        <p className="text-xs font-semibold">Conservation</p>
                      </div>
                      <div className="text-xs">
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Conservation Area</span>
                          <Badge variant={intelligence.conservation.conservation_area ? "default" : "secondary"} className="text-[10px]">
                            {intelligence.conservation.conservation_area ? "Yes" : "No"}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {intelligence.energy && (
                  <Card>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-yellow-500" />
                        <p className="text-xs font-semibold">Energy / EPC</p>
                      </div>
                      <div className="text-xs">
                        {intelligence.energy.energy_efficiency?.length > 0 ? (
                          <div className="space-y-1">
                            {intelligence.energy.energy_efficiency.slice(0, 3).map((e: any, i: number) => (
                              <div key={i} className="flex justify-between">
                                <span className="text-muted-foreground truncate max-w-[100px]">{e.address || "Unit"}</span>
                                <Badge variant="outline" className="text-[10px]">{e.current_energy_rating || e.rating || "?"}</Badge>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground">No EPC data</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {intelligence.demographics && (
                  <Card>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="w-4 h-4 text-purple-500" />
                        <p className="text-xs font-semibold">Demographics</p>
                      </div>
                      <div className="space-y-1 text-xs">
                        {intelligence.demographics.population != null && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Population</span>
                            <span className="font-medium">{Number(intelligence.demographics.population).toLocaleString()}</span>
                          </div>
                        )}
                        {intelligence.demographics.average_income != null && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Avg Income</span>
                            <span className="font-medium">{formatPrice(intelligence.demographics.average_income)}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {intelligence.listed && (
                  <Card>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Landmark className="w-4 h-4 text-rose-500" />
                        <p className="text-xs font-semibold">Listed Buildings</p>
                      </div>
                      <div className="text-xs">
                        <p className="font-medium">{(intelligence.listed.listed_buildings || intelligence.listed.buildings || []).length} nearby</p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {intelligence.planning && (() => {
                  const apps = intelligence.planning.planning_applications || intelligence.planning.data?.planning_applications || [];
                  return (
                    <Card>
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          <p className="text-xs font-semibold">Planning</p>
                        </div>
                        <div className="text-xs">
                          <p className="font-medium">{apps.length} applications</p>
                          {apps.slice(0, 1).map((a: any, ai: number) => (
                            <p key={ai} className="text-muted-foreground truncate mt-0.5">{a.description || a.proposal || a.status || "Application"}</p>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}
              </div>
            </div>
          )}

          {activeSection === "titles" && (
            <div className="space-y-3">
              {aiSummary && aiSummary.recommendedTitles.length > 0 && !showAllTitles && (
                <>
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5" />
                      Recommended Titles
                    </h4>
                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setShowAllTitles(true)} data-testid="button-show-all-titles">
                      Show all {(freeholds?.length || 0) + (leaseholds?.length || 0)} titles
                      <ChevronRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {[...(freeholds || []), ...(leaseholds || [])].filter(f => recommendedTitleNumbers.has(f.title_number || f.title || "")).map((f, i) => renderTitleRow(f, i, leaseholds?.includes(f)))}
                  </div>
                </>
              )}

              {(showAllTitles || !aiSummary || aiSummary.recommendedTitles.length === 0) && (
                <>
                  {freeholds && freeholds.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold flex items-center gap-1.5">
                          <Landmark className="w-3.5 h-3.5" />
                          Freehold Titles ({freeholds.length})
                        </h4>
                        {showAllTitles && aiSummary && aiSummary.recommendedTitles.length > 0 && (
                          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setShowAllTitles(false)} data-testid="button-show-recommended">
                            Show recommended only
                          </Button>
                        )}
                      </div>
                      <div className="space-y-2">
                        {freeholds.map((f, i) => renderTitleRow(f, i, false))}
                      </div>
                    </div>
                  )}

                  {leaseholds && leaseholds.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold flex items-center gap-1.5 mb-2 mt-4">
                        <FileText className="w-3.5 h-3.5" />
                        Leasehold Titles ({leaseholds.length})
                      </h4>
                      <div className="space-y-2">
                        {leaseholds.map((l, i) => renderTitleRow(l, i, true))}
                      </div>
                    </div>
                  )}

                  {freeholds && freeholds.length === 0 && (!leaseholds || leaseholds.length === 0) && (
                    <Card>
                      <CardContent className="p-6 text-center text-sm text-muted-foreground">
                        <Landmark className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        No titles found for this postcode
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </div>
          )}

          {activeSection === "sold" && (() => {
            const soldData = intelligence.sold;
            const soldRows = soldData ? (Array.isArray(soldData.raw_data) ? soldData.raw_data : Array.isArray(soldData.sold_prices) ? soldData.sold_prices : Array.isArray(soldData.prices) ? soldData.prices : []) : [];
            return (
              <div className="space-y-3">
                {soldRows.length > 0 ? (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Home className="w-4 h-4" />
                        Recent Sales — {selectedAddress.postcode}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Address</TableHead>
                              <TableHead className="text-xs text-right">Price</TableHead>
                              <TableHead className="text-xs">Date</TableHead>
                              <TableHead className="text-xs">Type</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {soldRows.slice(0, 15).map((s: any, si: number) => (
                              <TableRow key={si}>
                                <TableCell className="text-xs max-w-[200px] truncate">{s.address || s.full_address || "\u2014"}</TableCell>
                                <TableCell className="text-xs text-right font-medium">{formatPrice(s.price || s.amount)}</TableCell>
                                <TableCell className="text-xs">{s.date || s.sold_date || "\u2014"}</TableCell>
                                <TableCell className="text-xs">
                                  <Badge variant="outline" className="text-[10px]">
                                    {s.type || s.property_type || "\u2014"}{s.tenure ? ` \u00B7 ${s.tenure}` : ""}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="p-6 text-center text-sm text-muted-foreground">
                      <PoundSterling className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      No recent sales data available for this postcode
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function PricePaidSearch() {
  const [street, setStreet] = useState("");
  const [postcode, setPostcode] = useState("");
  const [town, setTown] = useState("LONDON");
  const [searchParams, setSearchParams] = useState<{
    street?: string;
    postcode?: string;
    town?: string;
  } | null>(null);

  const queryString = searchParams
    ? "?" + new URLSearchParams(searchParams).toString()
    : "";

  const { data, isLoading } = useQuery<PricePaidResult>({
    queryKey: ["/api/land-registry/price-paid", searchParams],
    queryFn: async () => {
      const res = await fetch(`/api/land-registry/price-paid${queryString}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!searchParams,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params: any = {};
    if (street.trim()) params.street = street.trim();
    if (postcode.trim()) params.postcode = postcode.trim();
    if (town.trim()) params.town = town.trim();
    if (Object.keys(params).length === 0) return;
    setSearchParams(params);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3" data-testid="form-price-paid-search">
        <div className="flex-1">
          <Input
            placeholder="Street name (e.g. Eaton Square)"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            data-testid="input-street"
          />
        </div>
        <div className="w-full sm:w-40">
          <Input
            placeholder="Postcode"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            data-testid="input-postcode"
          />
        </div>
        <div className="w-full sm:w-40">
          <Input
            placeholder="Town"
            value={town}
            onChange={(e) => setTown(e.target.value)}
            data-testid="input-town"
          />
        </div>
        <Button type="submit" disabled={isLoading} className="gap-1.5" data-testid="button-search-price-paid">
          <Search className="w-4 h-4" />
          Search
        </Button>
      </form>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {data && !isLoading && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground" data-testid="text-result-count">
              {data.total.toLocaleString()} transaction{data.total !== 1 ? "s" : ""} found
            </p>
          </div>

          {data.items.length > 0 && (
            <SummaryStats transactions={data.items} />
          )}

          <ScrollableTable minWidth={900}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">Price Paid</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Tenure</TableHead>
                  <TableHead>New Build</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((tx) => (
                  <TableRow key={tx.id} data-testid={`row-transaction-${tx.id}`}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDate(tx.date)}
                    </TableCell>
                    <TableCell className="text-sm min-w-[200px]">
                      {formatAddress(tx.address)}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-sm whitespace-nowrap">
                      {formatPrice(tx.pricePaid)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {tx.propertyType || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">
                        {tx.estateType || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {tx.newBuild ? (
                        <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                          Yes
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">No</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                      No transactions found. Try adjusting your search.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollableTable>
        </>
      )}

      {!searchParams && !isLoading && (
        <div className="text-center py-12 text-muted-foreground" data-testid="text-price-paid-empty">
          <PoundSterling className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Search by street, postcode, or town to see transaction history</p>
          <p className="text-xs mt-1">Data from HM Land Registry Price Paid dataset</p>
        </div>
      )}
    </div>
  );
}

function SummaryStats({ transactions }: { transactions: Transaction[] }) {
  const prices = transactions.map((t) => t.pricePaid).filter(Boolean);
  if (prices.length === 0) return null;

  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const median = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];

  const typeCounts: Record<string, number> = {};
  transactions.forEach((t) => {
    const type = t.propertyType || "Unknown";
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });
  const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="stats-price-paid">
      <Card>
        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Average Price</p>
          <p className="text-lg font-bold" data-testid="text-avg-price">{formatPrice(avg)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Median Price</p>
          <p className="text-lg font-bold" data-testid="text-median-price">{formatPrice(median)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Price Range</p>
          <p className="text-sm font-semibold" data-testid="text-price-range">
            {formatPrice(min)} — {formatPrice(max)}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Most Common Type</p>
          <p className="text-sm font-semibold capitalize" data-testid="text-common-type">
            {topType ? `${topType[0]} (${topType[1]})` : "—"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function HousePriceIndex() {
  const [selectedRegion, setSelectedRegion] = useState("city-of-westminster");

  const { data: regions } = useQuery<Region[]>({
    queryKey: ["/api/land-registry/regions"],
    queryFn: async () => {
      const res = await fetch("/api/land-registry/regions", { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data, isLoading } = useQuery<UKHPIResult>({
    queryKey: ["/api/land-registry/ukhpi", selectedRegion],
    queryFn: async () => {
      const res = await fetch(`/api/land-registry/ukhpi?region=${selectedRegion}&months=12`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const latest = data?.data?.[data.data.length - 1];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Select value={selectedRegion} onValueChange={setSelectedRegion}>
          <SelectTrigger className="w-full sm:w-[280px]" data-testid="select-region">
            <SelectValue placeholder="Select region" />
          </SelectTrigger>
          <SelectContent>
            {(regions || []).map((r) => (
              <SelectItem key={r.slug} value={r.slug}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Last 12 months of UK House Price Index data</p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {latest && !isLoading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="stats-ukhpi">
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">Average Price</p>
                <p className="text-lg font-bold" data-testid="text-ukhpi-avg-price">
                  {formatPrice(latest.averagePrice)}
                </p>
                <p className="text-xs text-muted-foreground">{latest.month}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">Annual Change</p>
                <div className="text-lg font-bold" data-testid="text-ukhpi-annual-change">
                  <ChangeIndicator value={latest.annualChange} />
                </div>
                <p className="text-xs text-muted-foreground">Year on year</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">House Price Index</p>
                <p className="text-lg font-bold" data-testid="text-ukhpi-index">
                  {latest.housePriceIndex?.toFixed(1) || "—"}
                </p>
                <p className="text-xs text-muted-foreground">Base: Jan 2015 = 100</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">Monthly Change</p>
                <div className="text-lg font-bold" data-testid="text-ukhpi-monthly-change">
                  <ChangeIndicator value={latest.monthlyChange} />
                </div>
                <p className="text-xs text-muted-foreground">Month on month</p>
              </CardContent>
            </Card>
          </div>

          {(latest.averagePriceFlat != null || latest.averagePriceDetached != null) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Average Prices by Property Type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Flat / Maisonette</p>
                    <p className="text-sm font-semibold">{formatPrice(latest.averagePriceFlat)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Terraced</p>
                    <p className="text-sm font-semibold">{formatPrice(latest.averagePriceTerraced)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Semi-Detached</p>
                    <p className="text-sm font-semibold">{formatPrice(latest.averagePriceSemiDetached)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Detached</p>
                    <p className="text-sm font-semibold">{formatPrice(latest.averagePriceDetached)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Buyer Type Breakdown — {latest.month}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Cash Buyers</p>
                  <p className="text-sm font-semibold">{formatPrice(latest.averagePriceCash)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Mortgage Buyers</p>
                  <p className="text-sm font-semibold">{formatPrice(latest.averagePriceMortgage)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">First Time Buyers</p>
                  <p className="text-sm font-semibold">{formatPrice(latest.averagePriceFirstTimeBuyer)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {data && !isLoading && data.data.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Monthly Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Avg Price</TableHead>
                    <TableHead className="text-right">HPI</TableHead>
                    <TableHead className="text-right">Annual Change</TableHead>
                    <TableHead className="text-right">Monthly Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...data.data].reverse().map((row) => (
                    <TableRow key={row.month} data-testid={`row-ukhpi-${row.month}`}>
                      <TableCell className="font-medium text-sm">{row.month}</TableCell>
                      <TableCell className="text-right text-sm">{formatPrice(row.averagePrice)}</TableCell>
                      <TableCell className="text-right text-sm">{row.housePriceIndex?.toFixed(1) || "—"}</TableCell>
                      <TableCell className="text-right">
                        <ChangeIndicator value={row.annualChange} />
                      </TableCell>
                      <TableCell className="text-right">
                        <ChangeIndicator value={row.monthlyChange} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function LandRegistry() {
  const [activeTab, setActiveTab] = useState("property-search");

  return (
    <PageLayout
      title="Land Registry & Property Intelligence"
      icon={Landmark}
      subtitle="Address search, free market intelligence, title documents, yields, rents, planning & KYC investigation"
      tabs={[
        { label: "Property Search", value: "property-search" },
        { label: "Price Paid", value: "price-paid" },
        { label: "House Price Index", value: "hpi" },
      ]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      className="space-y-6"
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsContent value="property-search">
          <PropertySearch onSelectPostcode={() => {}} />
        </TabsContent>

        <TabsContent value="price-paid">
          <PricePaidSearch />
        </TabsContent>

        <TabsContent value="hpi">
          <HousePriceIndex />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}

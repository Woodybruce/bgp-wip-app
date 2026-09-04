import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { Pill } from "@/components/ui/pill";
import {
  TrendingUp, Search, Plus, Trash2, X, Check, Loader2,
  Building2, MapPin, BarChart3, ArrowUpDown,
  ChevronDown, ChevronRight, Store, ExternalLink,
} from "lucide-react";

interface TurnoverEntry {
  id: string;
  company_id: string | null;
  company_name: string;
  property_id: string | null;
  property_name: string | null;
  store_name: string | null;
  location: string | null;
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
  period: string;
  turnover: number | null;
  sqft: number | null;
  turnover_per_sqft: number | null;
  source: string;
  confidence: string;
  category: string | null;
  notes: string | null;
  is_draft: boolean;
  linked_requirement_id: string | null;
  added_by: string | null;
  added_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

const SOURCES = ["Annual Accounts", "Landlord Report", "Conversation", "News", "Industry Report", "Companies House", "OpenStreetMap", "CRM Comp", "Other"];
const CONFIDENCES = ["High", "Medium", "Low"];
const CATEGORIES = ["F&B", "Retail", "Leisure", "Services", "Health & Beauty", "Grocery", "Fashion", "Technology", "Hospitality", "Other"];

function categoryFromCompanyType(t?: string | null): string {
  const s = (t || "").toLowerCase();
  if (!s) return "";
  if (/restaurant|caf|coffee|food|bakery|pub|bar|f&b/.test(s)) return "F&B";
  if (/fashion|apparel|clothing/.test(s)) return "Fashion";
  if (/leisure|gym|fitness|cinema|entertainment/.test(s)) return "Leisure";
  if (/grocery|supermarket|convenience/.test(s)) return "Grocery";
  if (/health|beauty|pharmacy|salon/.test(s)) return "Health & Beauty";
  if (/tech|electronic|phone/.test(s)) return "Technology";
  if (/hotel|hospitality/.test(s)) return "Hospitality";
  if (/service/.test(s)) return "Services";
  if (/retail|tenant/.test(s)) return "Retail";
  return "";
}

function formatCurrency(val: number | null) {
  if (val == null) return "—";
  // Round before picking the unit so 999,999 shows as £1.0m, not £1000k.
  if (Math.round(val / 1_000) >= 1_000) return `£${(val / 1_000_000).toFixed(1)}m`;
  if (Math.round(val) >= 1_000) return `£${(val / 1_000).toFixed(0)}k`;
  return `£${val.toFixed(0)}`;
}

function confidenceBadge(c: string) {
  const colors: Record<string, string> = {
    High: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    Medium: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    Low: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200",
  };
  return colors[c] || "bg-gray-100 text-gray-700";
}

function sourceBadge(s: string) {
  const colors: Record<string, string> = {
    "Annual Accounts": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    "Landlord Report": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    "Conversation": "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
    "News": "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    "Industry Report": "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
    "Companies House": "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
    "OpenStreetMap": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
    "CRM Comp": "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
    "Other": "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };
  return colors[s] || "bg-gray-100 text-gray-700";
}

export default function TurnoverBoard({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sortField, setSortField] = useState<string>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [form, setForm] = useState({
    company_name: "", company_id: "", property_name: "", property_id: "",
    store_name: "", period: "", turnover: "", sqft: "",
    source: "Conversation", confidence: "Medium", category: "", notes: "",
  });
  const [formAddress, setFormAddress] = useState<{ formatted: string; placeId: string; lat?: number; lng?: number } | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "brands">("table");
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());
  const [findingStores, setFindingStores] = useState<string | null>(null); // brand name being queried
  const [foundStores, setFoundStores] = useState<Record<string, any[]>>({}); // brand -> stores
  const [populatingComps, setPopulatingComps] = useState(false);

  // Client logins (e.g. Landsec) get the board read-only — edit POSTs are 403 for them.
  const { data: viewer } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClientViewer = viewer?.role === "Client" || !!viewer?.companyScopeId;

  const { data: entries = [], isLoading } = useQuery<TurnoverEntry[]>({
    queryKey: ["/api/turnover"],
    queryFn: async () => {
      const res = await fetch("/api/turnover", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/companies"],
    queryFn: async () => {
      const res = await fetch("/api/crm/companies", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : data.companies || [];
    },
  });

  const { data: properties = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/properties"],
    queryFn: async () => {
      const res = await fetch("/api/crm/properties", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : data.properties || [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/turnover", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/turnover"] });
      setShowAdd(false);
      setForm({ company_name: "", company_id: "", property_name: "", property_id: "",
        store_name: "", period: "", turnover: "", sqft: "",
        source: "Conversation", confidence: "Medium", category: "", notes: "" });
      setFormAddress(null);
      toast({ title: "Entry added" });
    },
    onError: () => toast({ title: "Failed to add entry", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...body }: any) => {
      const res = await apiRequest("PATCH", `/api/turnover/${id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/turnover"] });
      setEditingCell(null);
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/turnover/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/turnover"] });
      toast({ title: "Entry deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const confirmMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/turnover/${id}/confirm`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/turnover"] });
      toast({ title: "Store confirmed" });
    },
    onError: () => toast({ title: "Failed to confirm", variant: "destructive" }),
  });

  async function handleFindStores(brandName: string) {
    setFindingStores(brandName);
    try {
      const res = await fetch(`/api/turnover/find-stores?brand=${encodeURIComponent(brandName)}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setFoundStores(prev => ({ ...prev, [brandName]: data.stores || [] }));
      setExpandedBrands(prev => new Set([...prev, brandName]));
      if (!data.stores?.length) toast({ title: `No stores found for ${brandName}` });
    } catch {
      toast({ title: "Failed to find stores", variant: "destructive" });
    } finally {
      setFindingStores(null);
    }
  }

  async function handlePopulateStores(brandName: string, companyId: string | null) {
    try {
      const res = await apiRequest("POST", "/api/turnover/populate-stores", {
        company_name: brandName, brand_name: brandName, company_id: companyId,
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/turnover"] });
      toast({ title: `Added ${data.created} draft stores (${data.skipped} skipped)` });
      setFoundStores(prev => { const n = { ...prev }; delete n[brandName]; return n; });
    } catch {
      toast({ title: "Failed to populate stores", variant: "destructive" });
    }
  }

  async function handlePopulateFromComps() {
    setPopulatingComps(true);
    try {
      const res = await apiRequest("POST", "/api/turnover/populate-from-comps", {});
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/turnover"] });
      if (data.created === 0) {
        toast({
          title: "No entries created from CRM comps",
          description: "Comps match brands by exact tenant name — check tenant spellings on the Comps board against the brand book.",
        });
      } else {
        toast({ title: `Created ${data.created} draft entries from CRM comps (${data.skipped} skipped)` });
      }
    } catch {
      toast({ title: "Failed to populate from comps", variant: "destructive" });
    } finally {
      setPopulatingComps(false);
    }
  }

  const filtered = useMemo(() => {
    let result = entries;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        e.company_name.toLowerCase().includes(q) ||
        (e.store_name || "").toLowerCase().includes(q) ||
        (e.property_name || "").toLowerCase().includes(q) ||
        (e.location || "").toLowerCase().includes(q) ||
        (e.notes || "").toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== "all") result = result.filter(e => e.category === categoryFilter);
    if (sourceFilter !== "all") result = result.filter(e => e.source === sourceFilter);

    result = [...result].sort((a, b) => {
      const av = (a as any)[sortField];
      const bv = (b as any)[sortField];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [entries, search, categoryFilter, sourceFilter, sortField, sortDir]);

  const stats = useMemo(() => {
    const total = entries.length;
    const brands = new Set(entries.map(e => e.company_name)).size;
    const avgTurnover = entries.filter(e => e.turnover).reduce((s, e) => s + (e.turnover || 0), 0) / (entries.filter(e => e.turnover).length || 1);
    const avgPsf = entries.filter(e => e.turnover_per_sqft).reduce((s, e) => s + (e.turnover_per_sqft || 0), 0) / (entries.filter(e => e.turnover_per_sqft).length || 1);
    return { total, brands, avgTurnover, avgPsf };
  }, [entries]);

  const brandGroups = useMemo(() => {
    const groups: Record<string, TurnoverEntry[]> = {};
    filtered.forEach(e => {
      if (!groups[e.company_name]) groups[e.company_name] = [];
      groups[e.company_name].push(e);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function startEdit(id: string, field: string, currentValue: any) {
    if (isClientViewer) return;
    setEditingCell({ id, field });
    setEditValue(currentValue?.toString() || "");
  }

  function saveEdit() {
    if (!editingCell) return;
    updateMutation.mutate({ id: editingCell.id, [editingCell.field]: editValue });
  }

  function handleCompanySelect(companyId: string) {
    const company = companies.find((c: any) => c.id === companyId);
    if (company) {
      setForm(f => ({
        ...f,
        company_id: companyId,
        company_name: company.name,
        // Default the category from the brand's type so hand-added rows
        // land in the same filter bucket as the AI-estimate rows.
        category: f.category || categoryFromCompanyType(company.companyType || company.company_type),
      }));
    }
  }

  function handlePropertySelect(propertyId: string) {
    const prop = properties.find((p: any) => p.id === propertyId);
    if (prop) {
      setForm(f => ({ ...f, property_id: propertyId, property_name: prop.name }));
    }
  }

  const SortHeader = ({ field, label }: { field: string; label: string }) => (
    <th
      className="px-3 py-2 text-left text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
      onClick={() => handleSort(field)}
      data-testid={`sort-${field}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortField === field && <ArrowUpDown className="w-3 h-3" />}
      </span>
    </th>
  );

  return (
    <div className={embedded ? "space-y-4" : "p-4 sm:p-6 space-y-4"} data-testid="turnover-board-page">
        {!embedded && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
                Turnover Data
              </h1>
              <p className="text-sm text-muted-foreground">Brand revenue intelligence across your portfolio</p>
            </div>
            {!isClientViewer && (
              <Button onClick={() => setShowAdd(true)} data-testid="button-add-entry">
                <Plus className="w-4 h-4 mr-1" /> Add entry
              </Button>
            )}
          </div>
        )}
        {embedded && !isClientViewer && (
          <div className="flex justify-end">
            <Button onClick={() => setShowAdd(true)} data-testid="button-add-entry">
              <Plus className="w-4 h-4 mr-1" /> Add entry
            </Button>
          </div>
        )}

        {/* 2-up grid on phone so the third tile doesn't clip at the edge. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card data-testid="stat-total-entries">
            <CardContent className="p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Entries</p>
              <p className="text-2xl font-bold font-mono tabular-nums">{stats.total}</p>
            </CardContent>
          </Card>
          <Card data-testid="stat-unique-brands">
            <CardContent className="p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Brands</p>
              <p className="text-2xl font-bold font-mono tabular-nums">{stats.brands}</p>
            </CardContent>
          </Card>
          <Card data-testid="stat-avg-turnover">
            <CardContent className="p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Avg Turnover</p>
              <p className="text-2xl font-bold font-mono tabular-nums">{stats.avgTurnover ? formatCurrency(stats.avgTurnover) : "—"}</p>
            </CardContent>
          </Card>
          <Card data-testid="stat-avg-psf">
            <CardContent className="p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Avg £/sqft</p>
              <p className="text-2xl font-bold font-mono tabular-nums">{stats.avgPsf ? `£${stats.avgPsf.toFixed(0)}` : "—"}</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search brands, properties, notes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-category-filter">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-source-filter">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              {SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5 ml-auto">
            <Pill active={viewMode === "table"} onClick={() => setViewMode("table")} data-testid="pill-view-table">
              <BarChart3 className="w-3 h-3" />Table
            </Pill>
            <Pill active={viewMode === "brands"} onClick={() => setViewMode("brands")} data-testid="pill-view-brands">
              <Building2 className="w-3 h-3" />By Brand
            </Pill>
          </div>
          {!isClientViewer && (
            <Button variant="outline" size="sm" onClick={handlePopulateFromComps} disabled={populatingComps} data-testid="button-populate-comps">
              {populatingComps ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Store className="w-3.5 h-3.5 mr-1" />}
              From CRM Comps
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <BarChart3 className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              {entries.length === 0 ? (
                isClientViewer ? (
                  <h3 className="font-medium mb-1">No turnover data yet.</h3>
                ) : (
                <>
                  <h3 className="font-medium mb-1">No turnover data yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">Add your first entry to start tracking brand revenue</p>
                  {/* Outline: the header already carries the one filled primary (§5). */}
                  <Button variant="outline" onClick={() => setShowAdd(true)} data-testid="button-add-first">
                    <Plus className="w-4 h-4 mr-1" /> Add entry
                  </Button>
                </>
                )
              ) : (
                <>
                  <h3 className="font-medium mb-1">No matching entries</h3>
                  <p className="text-sm text-muted-foreground mb-4">Try adjusting your search or filters</p>
                  <Button variant="outline" onClick={() => { setSearch(""); setCategoryFilter("all"); setSourceFilter("all"); }}>
                    Clear Filters
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        ) : viewMode === "table" ? (
          <>
            {/* Phone: one card per entry (docs/DESIGN.md §7) — the wide table
                below is desktop-only (§6/§13). Cards are a read-only summary;
                staff keep the draft-confirm / delete actions. */}
            <div className="md:hidden space-y-2" data-testid="turnover-mobile-cards">
              {filtered.map(entry => (
                <div
                  key={entry.id}
                  className={`rounded-2xl bg-card border border-border p-3 shadow-sm ${entry.is_draft ? "opacity-60" : ""}`}
                  data-testid={`row-entry-${entry.id}-card`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{entry.company_name}</p>
                      {entry.is_draft && <Badge variant="secondary" className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0 shrink-0">Draft</Badge>}
                    </div>
                    <span className="shrink-0 text-sm font-mono tabular-nums font-semibold">{formatCurrency(entry.turnover)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {[entry.store_name || entry.property_name || entry.location, entry.period].filter(Boolean).join(" · ") || "—"}
                    {entry.lat && entry.lng ? (
                      <a href={`https://www.google.com/maps?q=${entry.lat},${entry.lng}`} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex align-middle text-muted-foreground hover:text-primary">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : null}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <Badge variant="secondary" className={`text-[10px] ${sourceBadge(entry.source)}`}>{entry.source}</Badge>
                    <Badge variant="secondary" className={`text-[10px] ${confidenceBadge(entry.confidence)}`}>{entry.confidence}</Badge>
                    {entry.category && <span className="text-[10px] text-muted-foreground">{entry.category}</span>}
                    {entry.turnover_per_sqft ? (
                      <span className="text-[10px] text-muted-foreground font-mono tabular-nums">£{entry.turnover_per_sqft.toFixed(0)}/sqft</span>
                    ) : null}
                    {!isClientViewer && (
                      <span className="ml-auto flex items-center gap-0.5">
                        {entry.is_draft && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:text-green-700" onClick={() => confirmMutation.mutate(entry.id)} title="Confirm store" data-testid={`button-confirm-${entry.id}-card`}>
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-600" onClick={() => { if (confirm("Delete this entry?")) deleteMutation.mutate(entry.id); }} data-testid={`button-delete-${entry.id}-card`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div className="px-1 text-xs text-muted-foreground" data-testid="text-results-count-mobile">
                {filtered.length} {filtered.length === 1 ? "entry" : "entries"}{search || categoryFilter !== "all" || sourceFilter !== "all" ? " (filtered)" : ""}
              </div>
            </div>
          <Card className="overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="table-turnover">
                <thead className="border-b">
                  <tr>
                    <SortHeader field="company_name" label="Brand" />
                    <SortHeader field="category" label="Category" />
                    <SortHeader field="location" label="Location" />
                    <SortHeader field="period" label="Period" />
                    <SortHeader field="turnover" label="Turnover" />
                    <SortHeader field="sqft" label="Sqft" />
                    <SortHeader field="turnover_per_sqft" label="£/sqft" />
                    <SortHeader field="source" label="Source" />
                    <SortHeader field="confidence" label="Confidence" />
                    <th className="px-3 py-2 text-left text-sm font-medium text-muted-foreground">Notes</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y text-xs">
                  {filtered.map(entry => (
                    <tr key={entry.id} className={`hover:bg-muted/50 transition-colors ${entry.is_draft ? "opacity-60" : ""}`} data-testid={`row-entry-${entry.id}`}>
                      <td className="px-3 py-2.5">
                        {editingCell?.id === entry.id && editingCell.field === "company_name" ? (
                          <div className="flex items-center gap-1">
                            <Input value={editValue} onChange={e => setEditValue(e.target.value)} className="h-7 text-sm w-32" autoFocus onKeyDown={e => e.key === "Enter" && saveEdit()} />
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={saveEdit}><Check className="w-3 h-3" /></Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingCell(null)}><X className="w-3 h-3" /></Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium cursor-pointer hover:text-primary" onClick={() => startEdit(entry.id, "company_name", entry.company_name)} data-testid={`cell-brand-${entry.id}`}>
                              {entry.company_name}
                            </span>
                            {entry.is_draft && <Badge variant="secondary" className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0">Draft</Badge>}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {editingCell?.id === entry.id && editingCell.field === "category" ? (
                          <Select value={editValue} onValueChange={v => { setEditValue(v); updateMutation.mutate({ id: entry.id, category: v }); }}>
                            <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-xs text-muted-foreground cursor-pointer" onClick={() => startEdit(entry.id, "category", entry.category || "")} data-testid={`cell-category-${entry.id}`}>
                            {entry.category || <span className="text-muted-foreground/60 italic">—</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {editingCell?.id === entry.id && editingCell.field === "location" ? (
                          <div className="flex items-center gap-1">
                            <Input value={editValue} onChange={e => setEditValue(e.target.value)} className="h-7 text-sm w-32" autoFocus onKeyDown={e => e.key === "Enter" && saveEdit()} />
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={saveEdit}><Check className="w-3 h-3" /></Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingCell(null)}><X className="w-3 h-3" /></Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="text-xs cursor-pointer" onClick={() => startEdit(entry.id, "location", entry.location || "")} data-testid={`cell-location-${entry.id}`}>
                              {entry.store_name || entry.property_name || entry.location || <span className="text-muted-foreground/60 italic">—</span>}
                            </span>
                            {entry.lat && entry.lng && (
                              <a href={`https://www.google.com/maps?q=${entry.lat},${entry.lng}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {editingCell?.id === entry.id && editingCell.field === "period" ? (
                          <div className="flex items-center gap-1">
                            <Input value={editValue} onChange={e => setEditValue(e.target.value)} className="h-7 text-sm w-24" autoFocus onKeyDown={e => e.key === "Enter" && saveEdit()} />
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={saveEdit}><Check className="w-3 h-3" /></Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingCell(null)}><X className="w-3 h-3" /></Button>
                          </div>
                        ) : (
                          <span className="text-xs cursor-pointer" onClick={() => startEdit(entry.id, "period", entry.period)} data-testid={`cell-period-${entry.id}`}>
                            {entry.period}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {editingCell?.id === entry.id && editingCell.field === "turnover" ? (
                          <div className="flex items-center gap-1">
                            <Input type="number" value={editValue} onChange={e => setEditValue(e.target.value)} className="h-7 text-sm w-24" autoFocus onKeyDown={e => e.key === "Enter" && saveEdit()} />
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={saveEdit}><Check className="w-3 h-3" /></Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingCell(null)}><X className="w-3 h-3" /></Button>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold cursor-pointer tabular-nums" onClick={() => startEdit(entry.id, "turnover", entry.turnover)} data-testid={`cell-turnover-${entry.id}`}>
                            {formatCurrency(entry.turnover)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {editingCell?.id === entry.id && editingCell.field === "sqft" ? (
                          <div className="flex items-center gap-1">
                            <Input type="number" value={editValue} onChange={e => setEditValue(e.target.value)} className="h-7 text-sm w-20" autoFocus onKeyDown={e => e.key === "Enter" && saveEdit()} />
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={saveEdit}><Check className="w-3 h-3" /></Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingCell(null)}><X className="w-3 h-3" /></Button>
                          </div>
                        ) : (
                          <span className="text-xs cursor-pointer tabular-nums" onClick={() => startEdit(entry.id, "sqft", entry.sqft)} data-testid={`cell-sqft-${entry.id}`}>
                            {entry.sqft ? entry.sqft.toLocaleString() : "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-medium tabular-nums" data-testid={`cell-psf-${entry.id}`}>
                          {entry.turnover_per_sqft ? `£${entry.turnover_per_sqft.toFixed(0)}` : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {editingCell?.id === entry.id && editingCell.field === "source" ? (
                          <Select value={editValue} onValueChange={v => { setEditValue(v); updateMutation.mutate({ id: entry.id, source: v }); }}>
                            <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="cursor-pointer" onClick={() => startEdit(entry.id, "source", entry.source)} data-testid={`cell-source-${entry.id}`}>
                            <Badge variant="secondary" className={`text-[10px] ${sourceBadge(entry.source)}`}>{entry.source}</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {editingCell?.id === entry.id && editingCell.field === "confidence" ? (
                          <Select value={editValue} onValueChange={v => { setEditValue(v); updateMutation.mutate({ id: entry.id, confidence: v }); }}>
                            <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {CONFIDENCES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="cursor-pointer" onClick={() => startEdit(entry.id, "confidence", entry.confidence)} data-testid={`cell-confidence-${entry.id}`}>
                            <Badge variant="secondary" className={`text-[10px] ${confidenceBadge(entry.confidence)}`}>{entry.confidence}</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 max-w-[200px]">
                        {editingCell?.id === entry.id && editingCell.field === "notes" ? (
                          <div className="flex items-center gap-1">
                            <Input value={editValue} onChange={e => setEditValue(e.target.value)} className="h-7 text-sm w-40" autoFocus onKeyDown={e => e.key === "Enter" && saveEdit()} />
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={saveEdit}><Check className="w-3 h-3" /></Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingCell(null)}><X className="w-3 h-3" /></Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground cursor-pointer truncate block" onClick={() => startEdit(entry.id, "notes", entry.notes || "")} title={entry.notes || ""} data-testid={`cell-notes-${entry.id}`}>
                            {entry.notes || <span className="italic">{isClientViewer ? "—" : "Click to add"}</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5">
                        {!isClientViewer && (
                          <div className="flex items-center gap-0.5">
                            {entry.is_draft && (
                              <Button size="icon" variant="ghost" className="h-6 w-6 text-green-600 hover:text-green-700" onClick={() => confirmMutation.mutate(entry.id)} title="Confirm store" data-testid={`button-confirm-${entry.id}`}>
                                <Check className="w-3 h-3" />
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-red-600" onClick={() => { if (confirm("Delete this entry?")) deleteMutation.mutate(entry.id); }} data-testid={`button-delete-${entry.id}`}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 border-t text-xs text-muted-foreground" data-testid="text-results-count">
              {filtered.length} {filtered.length === 1 ? "entry" : "entries"}{search || categoryFilter !== "all" || sourceFilter !== "all" ? " (filtered)" : ""}
            </div>
          </Card>
          </>
        ) : (
          // Brand grouped view
          <div className="space-y-2">
            {brandGroups.map(([brandName, brandEntries]) => {
              const isExpanded = expandedBrands.has(brandName);
              const draftCount = brandEntries.filter(e => e.is_draft).length;
              const confirmedEntries = brandEntries.filter(e => !e.is_draft);
              const totalTurnover = confirmedEntries.reduce((s, e) => s + (e.turnover || 0), 0);
              const storesWithPsf = confirmedEntries.filter(e => e.turnover_per_sqft);
              const avgPsf = storesWithPsf.length ? storesWithPsf.reduce((s, e) => s + (e.turnover_per_sqft || 0), 0) / storesWithPsf.length : null;
              const previewStores = foundStores[brandName];
              return (
                <Card key={brandName} className="overflow-hidden">
                  <div
                    className="flex items-center gap-x-3 gap-y-1 flex-wrap px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedBrands(prev => {
                      const n = new Set(prev);
                      if (n.has(brandName)) n.delete(brandName); else n.add(brandName);
                      return n;
                    })}
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                    <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium text-sm flex-1 min-w-[8rem] truncate" data-testid="text-brand-group-name">{brandName}</span>
                    {draftCount > 0 && <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-700">{draftCount} draft</Badge>}
                    <span className="text-xs text-muted-foreground">{brandEntries.length} store{brandEntries.length !== 1 ? "s" : ""}</span>
                    {totalTurnover > 0 && <span className="text-xs font-semibold tabular-nums">{formatCurrency(totalTurnover)}</span>}
                    {avgPsf && <span className="text-xs text-muted-foreground tabular-nums">£{avgPsf.toFixed(0)}/sqft avg</span>}
                    {!isClientViewer && (
                      <div className="flex items-center gap-1 ml-2" onClick={e => e.stopPropagation()}>
                        <Button
                          size="sm" variant="outline"
                          className="h-7 text-xs"
                          disabled={findingStores === brandName}
                          onClick={() => handleFindStores(brandName)}
                        >
                          {findingStores === brandName ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <MapPin className="w-3 h-3 mr-1" />}
                          Find Stores
                        </Button>
                      </div>
                    )}
                  </div>

                  {!isClientViewer && previewStores && previewStores.length > 0 && (
                    <div className="px-4 pb-2 border-t bg-muted/40">
                      <div className="flex items-center justify-between py-2">
                        <span className="text-xs font-medium">{previewStores.length} stores found via OpenStreetMap</span>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setFoundStores(prev => { const n = { ...prev }; delete n[brandName]; return n; })}>
                            Dismiss
                          </Button>
                          <Button size="sm" className="h-6 text-xs" onClick={() => handlePopulateStores(brandName, brandEntries[0]?.company_id || null)}>
                            Import as Drafts
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {previewStores.slice(0, 8).map((s: any, i: number) => (
                          <div key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Store className="w-3 h-3 flex-shrink-0" />
                            <span>{s.address || s.name || "Unknown address"}</span>
                          </div>
                        ))}
                        {previewStores.length > 8 && <p className="text-xs text-muted-foreground">+ {previewStores.length - 8} more</p>}
                      </div>
                    </div>
                  )}

                  {isExpanded && (<>
                    {/* Phone: card per store (§7) — the per-store table below
                        is desktop-only. */}
                    <div className="md:hidden border-t p-3 space-y-2 bg-muted/10">
                      {brandEntries.map(entry => (
                        <div
                          key={entry.id}
                          className={`rounded-2xl bg-card border border-border p-3 shadow-sm ${entry.is_draft ? "opacity-60" : ""}`}
                          data-testid={`row-entry-${entry.id}-brandcard`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex items-center gap-1.5">
                              <p className="text-sm font-medium truncate">{entry.store_name || entry.property_name || entry.location || "—"}</p>
                              {entry.is_draft && <Badge variant="secondary" className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0 shrink-0">Draft</Badge>}
                            </div>
                            <span className="shrink-0 text-sm font-mono tabular-nums font-semibold">
                              {entry.is_draft && !entry.turnover ? <span className="text-muted-foreground italic font-sans font-normal text-xs">No turnover</span> : formatCurrency(entry.turnover)}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            {[entry.period, entry.sqft ? `${entry.sqft.toLocaleString()} sqft` : null].filter(Boolean).join(" · ") || "—"}
                            {entry.lat && entry.lng ? (
                              <a href={`https://www.google.com/maps?q=${entry.lat},${entry.lng}`} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex align-middle text-muted-foreground hover:text-primary">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : null}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <Badge variant="secondary" className={`text-[10px] ${sourceBadge(entry.source)}`}>{entry.source}</Badge>
                            {entry.turnover_per_sqft ? (
                              <span className="text-[10px] text-muted-foreground font-mono tabular-nums">£{entry.turnover_per_sqft.toFixed(0)}/sqft</span>
                            ) : null}
                            {!isClientViewer && (
                              <span className="ml-auto flex items-center gap-0.5">
                                {entry.is_draft && (
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:text-green-700" onClick={() => confirmMutation.mutate(entry.id)} title="Confirm store">
                                    <Check className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-600" onClick={() => { if (confirm("Delete?")) deleteMutation.mutate(entry.id); }}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="border-t hidden md:block">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/30">
                          <tr>
                            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Store / Location</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Period</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Turnover</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Sqft</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">£/sqft</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Source</th>
                            <th className="px-3 py-2 w-16"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {brandEntries.map(entry => (
                            <tr key={entry.id} className={`hover:bg-muted/30 transition-colors ${entry.is_draft ? "opacity-60" : ""}`}>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  <MapPin className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                                  <span className="font-medium">{entry.store_name || entry.property_name || entry.location || "—"}</span>
                                  {entry.lat && entry.lng && (
                                    <a href={`https://www.google.com/maps?q=${entry.lat},${entry.lng}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                  {entry.is_draft && <Badge variant="secondary" className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0">Draft</Badge>}
                                </div>
                              </td>
                              <td className="px-3 py-2.5">{entry.period}</td>
                              <td className="px-3 py-2.5 font-semibold tabular-nums">
                                {entry.is_draft && !entry.turnover ? (
                                  <span className="text-muted-foreground italic">Add turnover</span>
                                ) : formatCurrency(entry.turnover)}
                              </td>
                              <td className="px-3 py-2.5 tabular-nums">{entry.sqft ? entry.sqft.toLocaleString() : "—"}</td>
                              <td className="px-3 py-2.5 tabular-nums">{entry.turnover_per_sqft ? `£${entry.turnover_per_sqft.toFixed(0)}` : "—"}</td>
                              <td className="px-3 py-2.5">
                                <Badge variant="secondary" className={`text-[10px] ${sourceBadge(entry.source)}`}>{entry.source}</Badge>
                              </td>
                              <td className="px-2 py-2.5">
                                {!isClientViewer && (
                                  <div className="flex items-center gap-0.5">
                                    {entry.is_draft && (
                                      <Button size="icon" variant="ghost" className="h-6 w-6 text-green-600 hover:text-green-700" onClick={() => confirmMutation.mutate(entry.id)} title="Confirm store">
                                        <Check className="w-3 h-3" />
                                      </Button>
                                    )}
                                    <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-red-600" onClick={() => { if (confirm("Delete?")) deleteMutation.mutate(entry.id); }}>
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>)}
                </Card>
              );
            })}
            <div className="text-xs text-muted-foreground px-1">
              {brandGroups.length} brand{brandGroups.length !== 1 ? "s" : ""}{search || categoryFilter !== "all" || sourceFilter !== "all" ? " (filtered)" : ""}
            </div>
          </div>
        )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" /> Add Turnover Entry
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Brand / Company *</label>
              <Select value={form.company_id} onValueChange={handleCompanySelect}>
                <SelectTrigger data-testid="select-company"><SelectValue placeholder="Select company..." /></SelectTrigger>
                <SelectContent>
                  {companies.slice(0, 100).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!form.company_id && (
                <Input
                  placeholder="Or type company name..."
                  value={form.company_name}
                  onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
                  className="mt-1.5"
                  data-testid="input-company-name"
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Property (optional)</label>
                <Select value={form.property_id} onValueChange={handlePropertySelect}>
                  <SelectTrigger data-testid="select-property"><SelectValue placeholder="Link to property" /></SelectTrigger>
                  <SelectContent>
                    {properties.slice(0, 100).map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Store Name</label>
                <Input placeholder="e.g. Oxford Street" value={form.store_name} onChange={e => setForm(f => ({ ...f, store_name: e.target.value }))} data-testid="input-store-name" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Address (Google linked)</label>
              <AddressAutocomplete
                value={formAddress}
                onChange={setFormAddress}
                placeholder="Search for store address..."
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Period *</label>
                <Input placeholder="e.g. FY 2025" value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))} data-testid="input-period" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Turnover (£)</label>
                <Input type="number" placeholder="e.g. 2500000" value={form.turnover} onChange={e => setForm(f => ({ ...f, turnover: e.target.value }))} data-testid="input-turnover" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Sqft</label>
                <Input type="number" placeholder="e.g. 3500" value={form.sqft} onChange={e => setForm(f => ({ ...f, sqft: e.target.value }))} data-testid="input-sqft" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Category</label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger data-testid="select-category"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Source</label>
                <Select value={form.source} onValueChange={v => setForm(f => ({ ...f, source: v }))}>
                  <SelectTrigger data-testid="select-source"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Confidence</label>
                <Select value={form.confidence} onValueChange={v => setForm(f => ({ ...f, confidence: v }))}>
                  <SelectTrigger data-testid="select-confidence"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONFIDENCES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
              <Textarea
                placeholder="Context — where did this number come from? Any caveats?"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                data-testid="input-notes"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAdd(false)} data-testid="button-cancel">Cancel</Button>
              <Button
                className="bg-[#232323] hover:bg-[#333] text-white"
                disabled={!form.company_name || !form.period || addMutation.isPending}
                onClick={() => addMutation.mutate({
                  ...form,
                  location: formAddress?.formatted || "",
                  google_place_id: formAddress?.placeId || null,
                  lat: formAddress?.lat || null,
                  lng: formAddress?.lng || null,
                })}
                data-testid="button-save"
              >
                {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Add entry
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

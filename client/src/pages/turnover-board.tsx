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
import {
  TrendingUp, Search, Plus, Trash2, X, Check, Edit2, Loader2,
  Building2, MapPin, PoundSterling, BarChart3, Filter, ArrowUpDown,
} from "lucide-react";

interface TurnoverEntry {
  id: string;
  company_id: string | null;
  company_name: string;
  property_id: string | null;
  property_name: string | null;
  location: string | null;
  period: string;
  turnover: number | null;
  sqft: number | null;
  turnover_per_sqft: number | null;
  source: string;
  confidence: string;
  category: string | null;
  notes: string | null;
  linked_requirement_id: string | null;
  added_by: string | null;
  added_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

const SOURCES = ["Annual Accounts", "Landlord Report", "Conversation", "News", "Industry Report", "Companies House", "Other"];
const CONFIDENCES = ["High", "Medium", "Low"];
const CATEGORIES = ["F&B", "Retail", "Leisure", "Services", "Health & Beauty", "Grocery", "Fashion", "Technology", "Hospitality", "Other"];

function formatCurrency(val: number | null) {
  if (!val) return "—";
  if (val >= 1_000_000) return `£${(val / 1_000_000).toFixed(1)}m`;
  if (val >= 1_000) return `£${(val / 1_000).toFixed(0)}k`;
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
    location: "", period: "", turnover: "", sqft: "",
    source: "Conversation", confidence: "Medium", category: "", notes: "",
  });

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
        location: "", period: "", turnover: "", sqft: "",
        source: "Conversation", confidence: "Medium", category: "", notes: "" });
      toast({ title: "Entry added" });
    },
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
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/turnover/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/turnover"] });
      toast({ title: "Entry deleted" });
    },
  });

  const filtered = useMemo(() => {
    let result = entries;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        e.company_name.toLowerCase().includes(q) ||
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

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function startEdit(id: string, field: string, currentValue: any) {
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
      setForm(f => ({ ...f, company_id: companyId, company_name: company.name }));
    }
  }

  function handlePropertySelect(propertyId: string) {
    const prop = properties.find((p: any) => p.id === propertyId);
    if (prop) {
      const addr = typeof prop.address === "object" ? (prop.address?.line1 || prop.address?.postcode || "") : (prop.address || "");
      setForm(f => ({ ...f, property_id: propertyId, property_name: prop.name, location: addr }));
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
            <Button onClick={() => setShowAdd(true)} data-testid="button-add-entry">
              <Plus className="w-4 h-4 mr-1" /> Add Entry
            </Button>
          </div>
        )}
        {embedded && (
          <div className="flex justify-end">
            <Button onClick={() => setShowAdd(true)} data-testid="button-add-entry">
              <Plus className="w-4 h-4 mr-1" /> Add Entry
            </Button>
          </div>
        )}

        <div className="flex items-center gap-3 overflow-x-auto pb-1">
          <Card className="flex-shrink-0 min-w-[120px]" data-testid="stat-total-entries">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-primary/60" />
                <div>
                  <p className="text-lg font-bold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">Entries</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-shrink-0 min-w-[120px]" data-testid="stat-unique-brands">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <div>
                  <p className="text-lg font-bold">{stats.brands}</p>
                  <p className="text-xs text-muted-foreground">Brands</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-shrink-0 min-w-[120px]" data-testid="stat-avg-turnover">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <div>
                  <p className="text-lg font-bold">{formatCurrency(stats.avgTurnover)}</p>
                  <p className="text-xs text-muted-foreground">Avg Turnover</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-shrink-0 min-w-[120px]" data-testid="stat-avg-psf">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <div>
                  <p className="text-lg font-bold">{stats.avgPsf ? `£${stats.avgPsf.toFixed(0)}` : "—"}</p>
                  <p className="text-xs text-muted-foreground">Avg £/sqft</p>
                </div>
              </div>
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
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <BarChart3 className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <h3 className="font-medium mb-1">No turnover data yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Add your first entry to start tracking brand revenue</p>
              <Button onClick={() => setShowAdd(true)} data-testid="button-add-first">
                <Plus className="w-4 h-4 mr-1" /> Add Entry
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
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
                    <tr key={entry.id} className="hover:bg-muted/50 transition-colors" data-testid={`row-entry-${entry.id}`}>
                      <td className="px-3 py-2.5">
                        {editingCell?.id === entry.id && editingCell.field === "company_name" ? (
                          <div className="flex items-center gap-1">
                            <Input value={editValue} onChange={e => setEditValue(e.target.value)} className="h-7 text-sm w-32" autoFocus onKeyDown={e => e.key === "Enter" && saveEdit()} />
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={saveEdit}><Check className="w-3 h-3" /></Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingCell(null)}><X className="w-3 h-3" /></Button>
                          </div>
                        ) : (
                          <span className="text-xs font-medium cursor-pointer hover:text-blue-600" onClick={() => startEdit(entry.id, "company_name", entry.company_name)} data-testid={`cell-brand-${entry.id}`}>
                            {entry.company_name}
                          </span>
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
                          <span className="text-xs cursor-pointer" onClick={() => startEdit(entry.id, "location", entry.location || "")} data-testid={`cell-location-${entry.id}`}>
                            {entry.property_name || entry.location || <span className="text-muted-foreground/60 italic">—</span>}
                          </span>
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
                            {entry.notes || <span className="italic">Click to add</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5">
                        <Button
                          size="icon" variant="ghost"
                          className="h-6 w-6 text-muted-foreground hover:text-red-600"
                          onClick={() => { if (confirm("Delete this entry?")) deleteMutation.mutate(entry.id); }}
                          data-testid={`button-delete-${entry.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
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
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Location</label>
                <Input placeholder="e.g. Oxford Street" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} data-testid="input-location" />
              </div>
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
                onClick={() => addMutation.mutate(form)}
                data-testid="button-save"
              >
                {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Add Entry
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

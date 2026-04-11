import { useState, useMemo, useRef, useCallback, useEffect } from "react";
// TODO: Deduplicate — this file shares ~60% of its code structure with comps.tsx.
// Consider extracting shared table logic, filter dropdowns, and inline-edit patterns
// into a shared CompsTableCore component. See comps.tsx for the same note.
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { InlineText, InlineNumber, InlineLabelSelect, InlineLinkSelect } from "@/components/inline-edit";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Upload, Search, Trash2, Columns3, X, ChevronUp, ChevronDown, FilterX,
  TrendingUp, Building2, MapPin, DollarSign, Percent,
} from "lucide-react";
import type { InvestmentComp, CrmProperty, CrmCompany } from "@shared/schema";

const STATUS_COLORS: Record<string, string> = {
  "Sale": "bg-green-600 text-white",
  "Sale - Pending": "bg-amber-500 text-white",
  "Refinance": "bg-blue-600 text-white",
  "Entity": "bg-purple-600 text-white",
  "Terminated": "bg-red-600 text-white",
};

const STATUS_OPTIONS = ["Sale", "Sale - Pending", "Refinance", "Entity", "Terminated"];
const SUBTYPE_OPTIONS = ["Centers", "Shops"];
const TYPE_OPTIONS = ["Retail", "Mixed", "Office", "Industrial", "Hotel", "Residential"];

const TYPE_COLORS: Record<string, string> = {
  Retail: "bg-blue-600",
  Mixed: "bg-purple-600",
  Office: "bg-slate-600",
  Industrial: "bg-amber-600",
  Hotel: "bg-rose-600",
  Residential: "bg-emerald-600",
};

const SUBTYPE_COLORS: Record<string, string> = {
  Centers: "bg-indigo-500",
  Shops: "bg-teal-500",
};

const formatCurrency = (v: number | null | undefined) => {
  if (v == null) return "—";
  return "£" + v.toLocaleString("en-GB", { maximumFractionDigits: 0 });
};

const formatPsf = (v: number | null | undefined) => {
  if (v == null) return "—";
  return "£" + v.toLocaleString("en-GB", { maximumFractionDigits: 2 });
};

const formatPercent = (v: number | null | undefined) => {
  if (v == null) return "—";
  return (v * 100).toFixed(2) + "%";
};

const formatDate = (v: string | null | undefined) => {
  if (!v) return "—";
  try {
    const d = new Date(v);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return v; }
};

const formatOccupancy = (v: number | null | undefined) => {
  if (v == null) return "—";
  return (v * 100).toFixed(0) + "%";
};

const ALL_COLUMNS = [
  { key: "propertyName", label: "Property", default: true },
  { key: "address", label: "Address", default: false },
  { key: "city", label: "City", default: true },
  { key: "market", label: "Market", default: true },
  { key: "region", label: "Region", default: false },
  { key: "status", label: "Status", default: true },
  { key: "transactionType", label: "Type", default: true },
  { key: "subtype", label: "Subtype", default: true },
  { key: "transactionDate", label: "Date", default: true },
  { key: "price", label: "Price (£)", default: true },
  { key: "pricePsf", label: "£/sf", default: true },
  { key: "capRate", label: "Cap Rate", default: true },
  { key: "areaSqft", label: "Area (sqft)", default: true },
  { key: "yearBuilt", label: "Year Built", default: false },
  { key: "occupancy", label: "Occupancy", default: true },
  { key: "buyer", label: "Buyer", default: true },
  { key: "seller", label: "Seller", default: true },
  { key: "buyerBroker", label: "Buyer Broker", default: false },
  { key: "sellerBroker", label: "Seller Broker", default: false },
  { key: "lender", label: "Lender", default: false },
  { key: "features", label: "Features", default: false },
  { key: "priceQualifier", label: "Price Qualifier", default: false },
  { key: "capRateQualifier", label: "Cap Rate Qualifier", default: false },
  { key: "partialInterest", label: "Partial Interest", default: false },
  { key: "pricePerUnit", label: "£/Unit", default: false },
  { key: "postalCode", label: "Postcode", default: false },
  { key: "numBuildings", label: "# Buildings", default: false },
  { key: "numFloors", label: "# Floors", default: false },
  { key: "landAreaAcres", label: "Land (acres)", default: false },
  { key: "submarket", label: "Submarket", default: false },
  { key: "comments", label: "Comments", default: false },
  { key: "source", label: "Source", default: false },
];

const defaultCols = Object.fromEntries(ALL_COLUMNS.map(c => [c.key, c.default]));

function FilterDropdown({ value, onChange, options, label, searchable = false }: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const displayOptions = useMemo(() => {
    if (!searchable || !filterText) return options;
    const q = filterText.toLowerCase();
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, filterText, searchable]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilterText("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => { setOpen(!open); setFilterText(""); }}
        className={`h-7 w-full text-xs border rounded-md px-2 bg-background flex items-center justify-between gap-1 hover:bg-muted transition-colors ${value ? "border-foreground font-medium" : "text-muted-foreground"}`}
        data-testid={`filter-btn-${label}`}
      >
        <span className="truncate">{value || `All ${label}`}</span>
        {value ? (
          <span
            onClick={(e) => { e.stopPropagation(); onChange(""); setOpen(false); }}
            className="shrink-0 hover:text-red-500"
          >
            <X className="w-3 h-3" />
          </span>
        ) : (
          <ChevronDown className="w-3 h-3 shrink-0" />
        )}
      </button>
      {open && (
        <div className="absolute z-[60] top-full left-0 mt-1 w-56 bg-popover border rounded-lg shadow-xl" data-testid={`filter-dropdown-${label}`}>
          {searchable && (
            <div className="p-1.5 border-b">
              <Input
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                className="h-7 text-xs"
                autoFocus
                data-testid={`filter-search-${label}`}
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto p-1">
            {displayOptions.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">No matches</div>
            ) : (
              displayOptions.map(opt => (
                <button
                  key={opt}
                  onClick={() => { onChange(opt); setOpen(false); setFilterText(""); }}
                  className={`w-full text-left px-2.5 py-1.5 text-xs rounded-md truncate transition-colors ${
                    opt === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                  data-testid={`filter-opt-${opt}`}
                >
                  {opt}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function InvestmentCompsPage() {
  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isAdmin = ["woody@brucegillinghampollard.com", "accounts@brucegillinghampollard.com"].includes(currentUser?.email || "");
  const isInvestment = currentUser?.team === "Investment";

  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(defaultCols);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortCol, setSortCol] = useState<string>("transactionDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterSubtype, setFilterSubtype] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterMarket, setFilterMarket] = useState("");
  const [filterProperty, setFilterProperty] = useState("");
  const [filterBuyer, setFilterBuyer] = useState("");
  const [filterSeller, setFilterSeller] = useState("");

  const hasActiveFilters = filterStatus || filterType || filterSubtype || filterCity || filterMarket || filterProperty || filterBuyer || filterSeller;

  const clearAllFilters = useCallback(() => {
    setFilterStatus("");
    setFilterType("");
    setFilterSubtype("");
    setFilterCity("");
    setFilterMarket("");
    setFilterProperty("");
    setFilterBuyer("");
    setFilterSeller("");
  }, []);

  const { data: comps = [], isLoading } = useQuery<InvestmentComp[]>({
    queryKey: ["/api/investment-comps"],
  });

  const { data: properties = [] } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });

  const { data: companies = [] } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
  });

  const propertyOptions = useMemo(() =>
    properties.map(p => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [properties]
  );

  const companyOptions = useMemo(() =>
    companies.map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [companies]
  );

  const uniqueCities = useMemo(() =>
    [...new Set(comps.map(c => c.city).filter(Boolean) as string[])].sort(),
    [comps]
  );
  const uniqueMarkets = useMemo(() =>
    [...new Set(comps.map(c => c.market).filter(Boolean) as string[])].sort(),
    [comps]
  );
  const uniqueProperties = useMemo(() =>
    [...new Set(comps.map(c => c.propertyName).filter(Boolean) as string[])].sort(),
    [comps]
  );
  const uniqueBuyers = useMemo(() =>
    [...new Set(comps.map(c => c.buyer).filter(Boolean) as string[])].sort(),
    [comps]
  );
  const uniqueSellers = useMemo(() =>
    [...new Set(comps.map(c => c.seller).filter(Boolean) as string[])].sort(),
    [comps]
  );

  const updateMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: any }) => {
      await apiRequest("PUT", `/api/investment-comps/${id}`, { [field]: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-comps"] });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await apiRequest("POST", "/api/investment-comps/bulk-delete", { ids });
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/investment-comps"] });
      toast({ title: "Deleted", description: "Records removed" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/investment-comps/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-comps"] });
      toast({ title: "Import complete", description: `${data.imported} records imported` });
    },
    onError: (err: any) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const filtered = useMemo(() => {
    let items = comps;

    if (filterStatus) items = items.filter(c => c.status === filterStatus);
    if (filterType) items = items.filter(c => c.transactionType === filterType);
    if (filterSubtype) items = items.filter(c => c.subtype === filterSubtype);
    if (filterCity) items = items.filter(c => c.city === filterCity);
    if (filterMarket) items = items.filter(c => c.market === filterMarket);
    if (filterProperty) items = items.filter(c => c.propertyName === filterProperty);
    if (filterBuyer) items = items.filter(c => c.buyer === filterBuyer);
    if (filterSeller) items = items.filter(c => c.seller === filterSeller);

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      items = items.filter(c =>
        (c.propertyName || "").toLowerCase().includes(q) ||
        (c.city || "").toLowerCase().includes(q) ||
        (c.buyer || "").toLowerCase().includes(q) ||
        (c.seller || "").toLowerCase().includes(q) ||
        (c.address || "").toLowerCase().includes(q) ||
        (c.market || "").toLowerCase().includes(q) ||
        (c.comments || "").toLowerCase().includes(q)
      );
    }
    items = [...items].sort((a: any, b: any) => {
      let aVal = a[sortCol];
      let bVal = b[sortCol];
      if (aVal == null) aVal = "";
      if (bVal == null) bVal = "";
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
    return items;
  }, [comps, debouncedSearch, sortCol, sortDir, filterStatus, filterType, filterSubtype, filterCity, filterMarket, filterProperty, filterBuyer, filterSeller]);

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(c => c.id)));
    }
  };

  const activeColumns = ALL_COLUMNS.filter(c => visibleColumns[c.key]);

  const totalPrice = useMemo(() =>
    filtered.reduce((s, c) => s + (c.price || 0), 0),
    [filtered]
  );

  const avgCapRate = useMemo(() => {
    const withCap = filtered.filter(c => c.capRate != null);
    if (withCap.length === 0) return null;
    return withCap.reduce((s, c) => s + (c.capRate || 0), 0) / withCap.length;
  }, [filtered]);

  const handleFileUpload = () => {
    if (fileInputRef.current?.files?.[0]) {
      importMutation.mutate(fileInputRef.current.files[0]);
      fileInputRef.current.value = "";
    }
  };

  const handleUpdate = (id: string, field: string, value: any) => {
    updateMutation.mutate({ id, field, value });
  };

  const renderCell = (comp: InvestmentComp, col: typeof ALL_COLUMNS[0]) => {
    const id = comp.id;
    const key = col.key as keyof InvestmentComp;
    const val = comp[key];

    switch (col.key) {
      case "propertyName":
        return (
          <div className="flex items-center gap-1">
            <InlineText
              value={val as string}
              onSave={(v) => handleUpdate(id, col.key, v)}
              placeholder="—"
            />
            <InlineLinkSelect
              value={comp.propertyId}
              options={propertyOptions}
              href={comp.propertyId ? `/properties/${comp.propertyId}` : undefined}
              onSave={(v) => handleUpdate(id, "propertyId", v)}
              compact
            />
          </div>
        );

      case "buyer":
        return (
          <div className="flex items-center gap-1">
            <InlineText
              value={val as string}
              onSave={(v) => handleUpdate(id, col.key, v)}
              placeholder="—"
            />
            <InlineLinkSelect
              value={comp.buyerCompanyId}
              options={companyOptions}
              href={comp.buyerCompanyId ? `/companies?highlight=${comp.buyerCompanyId}` : undefined}
              onSave={(v) => handleUpdate(id, "buyerCompanyId", v)}
              compact
            />
          </div>
        );

      case "seller":
        return (
          <div className="flex items-center gap-1">
            <InlineText
              value={val as string}
              onSave={(v) => handleUpdate(id, col.key, v)}
              placeholder="—"
            />
            <InlineLinkSelect
              value={comp.sellerCompanyId}
              options={companyOptions}
              href={comp.sellerCompanyId ? `/companies?highlight=${comp.sellerCompanyId}` : undefined}
              onSave={(v) => handleUpdate(id, "sellerCompanyId", v)}
              compact
            />
          </div>
        );

      case "address":
      case "city":
      case "market":
      case "region":
      case "postalCode":
      case "buyerBroker":
      case "sellerBroker":
      case "lender":
      case "features":
      case "submarket":
      case "source":
      case "priceQualifier":
      case "capRateQualifier":
      case "partialInterest":
        return (
          <InlineText
            value={val as string}
            onSave={(v) => handleUpdate(id, col.key, v)}
            placeholder="—"
          />
        );

      case "comments":
        return (
          <InlineText
            value={val as string}
            onSave={(v) => handleUpdate(id, col.key, v)}
            placeholder="—"
            multiline
          />
        );

      case "status":
        return (
          <InlineLabelSelect
            value={val as string}
            options={STATUS_OPTIONS}
            colorMap={STATUS_COLORS}
            onSave={(v) => handleUpdate(id, "status", v)}
          />
        );

      case "transactionType":
        return (
          <InlineLabelSelect
            value={val as string}
            options={TYPE_OPTIONS}
            colorMap={TYPE_COLORS}
            onSave={(v) => handleUpdate(id, "transactionType", v)}
          />
        );

      case "subtype":
        return (
          <InlineLabelSelect
            value={val as string}
            options={SUBTYPE_OPTIONS}
            colorMap={SUBTYPE_COLORS}
            onSave={(v) => handleUpdate(id, "subtype", v)}
          />
        );

      case "price":
        return (
          <InlineNumber
            value={val as number}
            onSave={(v) => handleUpdate(id, "price", v)}
            format={formatCurrency}
          />
        );

      case "pricePsf":
      case "pricePerUnit":
        return (
          <InlineNumber
            value={val as number}
            onSave={(v) => handleUpdate(id, col.key, v)}
            format={formatPsf}
          />
        );

      case "capRate":
        return (
          <span className="text-xs font-mono">{formatPercent(val as number)}</span>
        );

      case "areaSqft":
        return (
          <InlineNumber
            value={val as number}
            onSave={(v) => handleUpdate(id, "areaSqft", v)}
            format={(v) => v != null ? v.toLocaleString("en-GB") : "—"}
          />
        );

      case "yearBuilt":
      case "numBuildings":
      case "numFloors":
        return (
          <InlineNumber
            value={val as number}
            onSave={(v) => handleUpdate(id, col.key, v)}
            format={(v) => v != null ? String(v) : "—"}
          />
        );

      case "occupancy":
        return <span className="text-xs font-mono">{formatOccupancy(val as number)}</span>;

      case "landAreaAcres":
        return (
          <InlineNumber
            value={val as number}
            onSave={(v) => handleUpdate(id, col.key, v)}
            format={(v) => v != null ? v.toFixed(2) : "—"}
          />
        );

      case "transactionDate":
        return <span className="text-xs whitespace-nowrap">{formatDate(val as string)}</span>;

      default:
        return <span className="text-xs">{val != null ? String(val) : "—"}</span>;
    }
  };

  if (currentUser && !isAdmin && !isInvestment) {
    return (
      <div className="p-4 sm:p-6 text-center space-y-4">
        <h2 className="text-lg font-semibold">Access Restricted</h2>
        <p className="text-sm text-muted-foreground">This page is only available to the Investment team.</p>
      </div>
    );
  }

  const stats = useMemo(() => {
    const total = comps.length;
    const cities = new Set(comps.map(c => c.city).filter(Boolean)).size;
    const sales = comps.filter(c => c.status === "Sale").length;
    return { total, cities, sales };
  }, [comps]);

  return (
    <div className="h-full flex flex-col" data-testid="investment-comps-page">
      <div className="border-b px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Investment Comps</h1>
              <p className="text-sm text-muted-foreground">Capital markets comparable transactions</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" data-testid="button-bulk-delete">
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete {selectedIds.size}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selectedIds.size} records?</AlertDialogTitle>
                    <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteMutation.mutate([...selectedIds])}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            <input
              type="file"
              ref={fileInputRef}
              accept=".xls,.xlsx,.csv"
              className="hidden"
              onChange={handleFileUpload}
              data-testid="input-file-upload"
            />
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8"
              onClick={() => fileInputRef.current?.click()}
              disabled={importMutation.isPending}
              data-testid="button-import"
            >
              <Upload className="w-3.5 h-3.5" />
              {importMutation.isPending ? "Importing..." : "Import RCA"}
            </Button>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-8" data-testid="button-columns">
                  <Columns3 className="w-3.5 h-3.5" /> Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 max-h-80 overflow-y-auto p-2" align="end">
                {ALL_COLUMNS.map(col => (
                  <label key={col.key} className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer text-xs">
                    <Checkbox
                      checked={visibleColumns[col.key]}
                      onCheckedChange={(checked) =>
                        setVisibleColumns(prev => ({ ...prev, [col.key]: !!checked }))
                      }
                      data-testid={`checkbox-col-${col.key}`}
                    />
                    {col.label}
                  </label>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-muted-foreground" /> <span className="font-semibold">{stats.total}</span> comps</span>
            <span className="flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5 text-green-600" /> <span className="font-semibold">{formatCurrency(totalPrice)}</span> total</span>
            {avgCapRate != null && <span className="flex items-center gap-1.5"><Percent className="w-3.5 h-3.5 text-blue-600" /> <span className="font-semibold">{formatPercent(avgCapRate)}</span> avg cap</span>}
            <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-muted-foreground" /> <span className="font-semibold">{stats.cities}</span> cities</span>
            <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-muted-foreground" /> <span className="font-semibold">{stats.sales}</span> completed</span>
          </div>
          <div className="flex-1" />
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search properties, buyers, sellers..."
              className="h-8 w-56 pl-8 text-xs"
              data-testid="input-search"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-8 gap-1 text-xs" data-testid="button-clear-filters">
              <FilterX className="w-3.5 h-3.5" /> Clear
            </Button>
          )}
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-muted/50 border-b text-xs shrink-0">
          <span className="font-medium">{selectedIds.size} selected</span>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full" data-testid="table-comps">
          <thead className="sticky top-0 bg-background border-b z-10 text-sm">
            <tr>
              <th className="px-2 py-1.5 w-8">
                <Checkbox
                  checked={selectedIds.size === filtered.length && filtered.length > 0}
                  onCheckedChange={toggleAll}
                  data-testid="checkbox-select-all"
                />
              </th>
              {activeColumns.map(col => {
                const filterConfig: Record<string, { value: string; onChange: (v: string) => void; options: string[]; label: string; searchable?: boolean }> = {
                  status: { value: filterStatus, onChange: setFilterStatus, options: STATUS_OPTIONS, label: "Status" },
                  transactionType: { value: filterType, onChange: setFilterType, options: TYPE_OPTIONS, label: "Type" },
                  subtype: { value: filterSubtype, onChange: setFilterSubtype, options: SUBTYPE_OPTIONS, label: "Subtype" },
                  city: { value: filterCity, onChange: setFilterCity, options: uniqueCities, label: "City", searchable: true },
                  market: { value: filterMarket, onChange: setFilterMarket, options: uniqueMarkets, label: "Market", searchable: true },
                  propertyName: { value: filterProperty, onChange: setFilterProperty, options: uniqueProperties, label: "Property", searchable: true },
                  buyer: { value: filterBuyer, onChange: setFilterBuyer, options: uniqueBuyers, label: "Buyer", searchable: true },
                  seller: { value: filterSeller, onChange: setFilterSeller, options: uniqueSellers, label: "Seller", searchable: true },
                };
                const fc = filterConfig[col.key];
                return (
                  <th
                    key={col.key}
                    className="px-2 py-1.5 text-left align-top"
                    data-testid={`th-${col.key}`}
                  >
                    <div
                      className="inline-flex items-center gap-1 font-semibold text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap select-none mb-1"
                      onClick={() => toggleSort(col.key)}
                    >
                      {col.label}
                      {sortCol === col.key && (
                        sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      )}
                    </div>
                    {fc && (
                      <FilterDropdown
                        value={fc.value}
                        onChange={fc.onChange}
                        options={fc.options}
                        label={fc.label}
                        searchable={fc.searchable}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="text-xs">
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} className="border-b">
                  <td className="px-2 py-2" colSpan={activeColumns.length + 1}>
                    <div className="h-5 bg-muted rounded animate-pulse" />
                  </td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={activeColumns.length + 1} className="px-4 py-12 text-center text-muted-foreground">
                  No records found
                </td>
              </tr>
            ) : (
              filtered.map(comp => (
                <tr
                  key={comp.id}
                  className={`border-b hover:bg-muted/30 transition-colors ${selectedIds.has(comp.id) ? "bg-primary/5" : ""}`}
                  data-testid={`row-comp-${comp.id}`}
                >
                  <td className="px-2 py-1.5">
                    <Checkbox
                      checked={selectedIds.has(comp.id)}
                      onCheckedChange={() => toggleSelect(comp.id)}
                      data-testid={`checkbox-row-${comp.id}`}
                    />
                  </td>
                  {activeColumns.map(col => (
                    <td
                      key={col.key}
                      className={`px-2 py-1.5 ${
                        col.key === "propertyName" ? "font-medium min-w-[160px] max-w-[220px]" :
                        col.key === "comments" ? "min-w-[200px] max-w-[300px]" :
                        col.key === "buyer" || col.key === "seller" ? "min-w-[140px] max-w-[200px]" :
                        col.key === "address" ? "min-w-[120px] max-w-[180px]" :
                        "whitespace-nowrap"
                      }`}
                      data-testid={`cell-${col.key}-${comp.id}`}
                    >
                      {renderCell(comp, col)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

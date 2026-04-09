import ReactDOM from "react-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ScrollableTable } from "@/components/scrollable-table";
import { useTeam } from "@/lib/team-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Search, Users, FileText, AlertCircle, X, Plus, Pencil, Trash2, Building2, Archive, User, Mail, Phone, Upload, Download, File, MapPin, Check, Circle, Loader2, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { CRM_OPTIONS } from "@/lib/crm-options";
import { InlineLabelSelect, InlineMultiSelect, InlineText, InlineDate } from "@/components/inline-edit";
import { buildUserIdColorMap } from "@/lib/agent-colors";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { ColumnFilterPopover } from "@/components/column-filter-popover";
import type { CrmRequirementsLeasing, CrmRequirementsInvestment, CrmCompany, CrmContact, CrmDeal, CrmProperty } from "@shared/schema";
import { Link } from "wouter";
import { RefreshCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface LocationEntry {
  formatted: string;
  placeId: string;
  lat?: number;
  lng?: number;
}

function parseLocationData(raw: string | null): LocationEntry[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

const PROGRESS_STAGES = [
  { key: "contacted" as const, label: "Contacted", color: "bg-emerald-500", borderColor: "border-emerald-500", hoverBorder: "hover:border-emerald-400" },
  { key: "detailsSent" as const, label: "Details Sent", color: "bg-blue-500", borderColor: "border-blue-500", hoverBorder: "hover:border-blue-400" },
  { key: "viewing" as const, label: "Viewing", color: "bg-amber-500", borderColor: "border-amber-500", hoverBorder: "hover:border-amber-400" },
  { key: "shortlisted" as const, label: "Shortlisted", color: "bg-purple-500", borderColor: "border-purple-500", hoverBorder: "hover:border-purple-400" },
  { key: "underOffer" as const, label: "Under Offer", color: "bg-red-500", borderColor: "border-red-500", hoverBorder: "hover:border-red-400" },
];

function ProgressTickCell({
  item,
  onUpdate,
  testIdPrefix,
}: {
  item: { contacted: boolean; detailsSent: boolean; viewing: boolean; shortlisted: boolean; underOffer: boolean };
  onUpdate: (data: Record<string, boolean>) => void;
  testIdPrefix: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const activeCount = PROGRESS_STAGES.filter((s) => item[s.key]).length;
  const activeStages = PROGRESS_STAGES.filter((s) => item[s.key]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs transition-colors ${
          activeCount > 0
            ? "border-gray-300 bg-white hover:bg-gray-50"
            : "border-dashed border-gray-300 text-muted-foreground hover:border-gray-400"
        }`}
        data-testid={`${testIdPrefix}-btn`}
      >
        {activeCount > 0 ? (
          <>
            {activeStages.map((s) => (
              <span key={s.key} className={`w-2 h-2 rounded-full ${s.color}`} title={s.label} />
            ))}
            <span className="ml-0.5 text-muted-foreground">{activeCount}/5</span>
          </>
        ) : (
          <span className="flex items-center gap-1">
            <Circle className="w-3 h-3" />
            0/5
          </span>
        )}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-1/2 -translate-x-1/2 bg-popover border rounded-lg shadow-lg p-1.5 min-w-[180px]">
          {PROGRESS_STAGES.map((stage) => {
            const active = item[stage.key];
            return (
              <button
                key={stage.key}
                type="button"
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-accent text-left text-sm transition-colors"
                onClick={() => onUpdate({ [stage.key]: !active })}
                data-testid={`${testIdPrefix}-${stage.key}`}
              >
                <div
                  className={`w-5 h-5 rounded border-2 inline-flex items-center justify-center transition-colors ${
                    active ? `${stage.color} ${stage.borderColor} text-white` : `border-gray-300 ${stage.hoverBorder}`
                  }`}
                >
                  {active && <Check className="w-3 h-3" />}
                </div>
                <span className={active ? "font-medium" : "text-muted-foreground"}>{stage.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MapLocationsCell({
  itemId,
  locationData,
  onSave,
  navigate,
}: {
  itemId: string;
  locationData: string | null;
  onSave: (data: string | null) => void;
  navigate: (to: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const locations = parseLocationData(locationData);

  const addLocation = (addr: { formatted: string; placeId: string; lat?: number; lng?: number } | null) => {
    if (!addr) return;
    if (locations.some((l) => l.placeId === addr.placeId)) {
      setAdding(false);
      return;
    }
    const updated = [...locations, addr];
    onSave(JSON.stringify(updated));
    setAdding(false);
  };

  const removeLocation = (placeId: string) => {
    const updated = locations.filter((l) => l.placeId !== placeId);
    onSave(updated.length > 0 ? JSON.stringify(updated) : null);
  };

  return (
    <div className="space-y-1">
      {locations.map((loc) => (
        <div key={loc.placeId} className="flex items-center gap-1 group">
          <button
            className="text-[11px] text-blue-600 hover:underline cursor-pointer flex items-center gap-0.5 truncate max-w-[160px]"
            onClick={() => {
              if (loc.lat && loc.lng) {
                navigate(`/map?lat=${loc.lat}&lng=${loc.lng}&zoom=15`);
              }
            }}
            title={loc.formatted}
            data-testid={`link-map-location-${itemId}-${loc.placeId}`}
          >
            <MapPin className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{loc.formatted.split(",")[0]}</span>
          </button>
          <button
            onClick={() => removeLocation(loc.placeId)}
            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity"
            data-testid={`button-remove-location-${itemId}-${loc.placeId}`}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      {adding ? (
        <div className="min-w-[200px]">
          <AddressAutocomplete
            value={null}
            onChange={addLocation}
            placeholder="Search location..."
          />
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 cursor-pointer"
          data-testid={`button-add-location-${itemId}`}
        >
          <Plus className="w-3 h-3" />
          {locations.length === 0 ? "Add location" : "Add more"}
        </button>
      )}
    </div>
  );
}

function LeasingTable({ teamFilter }: { teamFilter?: string | null }) {
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<CrmRequirementsLeasing | null>(null);
  const [deleteItem, setDeleteItem] = useState<CrmRequirementsLeasing | null>(null);
  const [matchItem, setMatchItem] = useState<CrmRequirementsLeasing | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: items = [], isLoading, error } = useQuery<CrmRequirementsLeasing[]>({
    queryKey: ["/api/crm/requirements-leasing"],
  });

  const { data: companies = [] } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
  });

  const { data: contacts = [] } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
  });

  const { data: deals = [] } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals"],
  });

  const { data: crmProperties = [] } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });

  const { data: users = [] } = useQuery<{ id: string; name: string; email: string; role: string; department: string; team: string | null }[]>({
    queryKey: ["/api/users"],
  });
  const userIdColorMap = useMemo(() => buildUserIdColorMap(users), [users]);

  const teamUserIds = useMemo(() => {
    if (!teamFilter) return null;
    const tf = teamFilter.toLowerCase();
    return new Set(users.filter(u => u.team?.toLowerCase().includes(tf)).map(u => u.id));
  }, [teamFilter, users]);

  const propertyMatchMap = useMemo(() => {
    const map = new Map<string, CrmProperty[]>();
    if (!crmProperties.length) return map;
    items.forEach(req => {
      const locs = Array.isArray(req.requirementLocations) ? req.requirementLocations : [];
      if (!locs.length) return;
      const locsLc = locs.map(l => l.toLowerCase());
      const matches = crmProperties.filter(p => {
        const addr = p.address as any;
        const addrStr = addr ? [addr.formatted, addr.street, addr.city, addr.area, addr.text, typeof addr === "string" ? addr : ""].filter(Boolean).join(" ").toLowerCase() : "";
        const pName = (p.name || "").toLowerCase();
        return locsLc.some(loc => addrStr.includes(loc) || pName.includes(loc));
      });
      if (matches.length > 0) map.set(req.id, matches);
    });
    return map;
  }, [items, crmProperties]);

  const companyMap = useMemo(() => {
    const map = new Map<string, CrmCompany>();
    companies.forEach((c) => map.set(c.id, c));
    return map;
  }, [companies]);

  const contactMap = useMemo(() => {
    const map = new Map<string, CrmContact>();
    contacts.forEach((c) => map.set(c.id, c));
    return map;
  }, [contacts]);

  const dealMap = useMemo(() => {
    const map = new Map<string, CrmDeal>();
    deals.forEach((d) => map.set(d.id, d));
    return map;
  }, [deals]);

  const userMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; email: string; role: string; department: string }>();
    users.forEach((u) => map.set(u.id, u));
    return map;
  }, [users]);

  const createMutation = useMutation({
    mutationFn: (data: Partial<CrmRequirementsLeasing>) =>
      apiRequest("POST", "/api/crm/requirements-leasing", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-leasing"] });
      setCreateOpen(false);
      toast({ title: "Requirement created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CrmRequirementsLeasing> }) =>
      apiRequest("PUT", `/api/crm/requirements-leasing/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-leasing"] });
      setEditItem(null);
      toast({ title: "Requirement updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const inlineUpdate = (id: string, data: Partial<CrmRequirementsLeasing>) => {
    apiRequest("PUT", `/api/crm/requirements-leasing/${id}`, data)
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-leasing"] }))
      .catch((e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }));
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/crm/requirements-leasing/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-leasing"] });
      setDeleteItem(null);
      toast({ title: "Requirement deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [importingSource, setImportingSource] = useState<string | null>(null);
  const runBulkImport = async (source: string) => {
    setImportingSource(source);
    try {
      const res = await apiRequest("POST", `/api/crm/bulk-import/${source}`);
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-leasing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      const created = data.requirements?.created || 0;
      const skipped = data.requirements?.skipped || 0;
      const companiesCreated = data.companies?.created || 0;
      const contactsCreated = data.contacts?.created || 0;
      const errorCount = data.errors?.length || 0;
      const hasErrors = errorCount > 0;
      toast({
        title: hasErrors ? "Import partially complete" : "Import complete",
        description: `${created} requirements, ${companiesCreated} companies, ${contactsCreated} contacts created. ${skipped} skipped.${hasErrors ? ` ${errorCount} error(s) encountered.` : ""}`,
        variant: hasErrors ? "destructive" : "default",
      });
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setImportingSource(null);
    }
  };

  const toggleColumnFilter = (col: string, value: string) => {
    setColumnFilters((prev) => {
      const current = prev[col] || [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      if (next.length === 0) {
        const { [col]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [col]: next };
    });
  };

  const leasingFilterOptions = useMemo(() => {
    const statusSet = new Set<string>();
    const useSet = new Set<string>();
    const typeSet = new Set<string>();
    const sizeSet = new Set<string>();
    const locSet = new Set<string>();
    items.forEach((i) => {
      if (i.status) statusSet.add(i.status);
      if (Array.isArray(i.use)) i.use.forEach((v) => useSet.add(v));
      if (Array.isArray(i.requirementType)) i.requirementType.forEach((v) => typeSet.add(v));
      if (Array.isArray(i.size)) i.size.forEach((v) => sizeSet.add(v));
      if (Array.isArray(i.requirementLocations)) i.requirementLocations.forEach((v) => locSet.add(v));
    });
    return {
      status: Array.from(statusSet).sort(),
      use: Array.from(useSet).sort(),
      requirementType: Array.from(typeSet).sort(),
      size: Array.from(sizeSet).sort(),
      requirementLocations: Array.from(locSet).sort(),
    };
  }, [items]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.groupName) set.add(i.groupName); });
    return Array.from(set).sort();
  }, [items]);

  const hasColumnFilters = Object.keys(columnFilters).length > 0;

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (teamUserIds) {
        const ids = item.bgpContactUserIds || (item.bgpContactUserId ? [item.bgpContactUserId] : []);
        if (ids.length > 0 && !ids.some(id => teamUserIds.has(id))) return false;
      }
      if (groupFilter !== "all" && item.groupName !== groupFilter) return false;
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (columnFilters.status?.length && !columnFilters.status.includes(item.status || "")) return false;
      if (columnFilters.use?.length) {
        const vals = Array.isArray(item.use) ? item.use : [];
        if (!columnFilters.use.some((f) => vals.includes(f))) return false;
      }
      if (columnFilters.requirementType?.length) {
        const vals = Array.isArray(item.requirementType) ? item.requirementType : [];
        if (!columnFilters.requirementType.some((f) => vals.includes(f))) return false;
      }
      if (columnFilters.size?.length) {
        const vals = Array.isArray(item.size) ? item.size : [];
        if (!columnFilters.size.some((f) => vals.includes(f))) return false;
      }
      if (columnFilters.requirementLocations?.length) {
        const vals = Array.isArray(item.requirementLocations) ? item.requirementLocations : [];
        if (!columnFilters.requirementLocations.some((f) => vals.includes(f))) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        return (
          item.name.toLowerCase().includes(s) ||
          (Array.isArray(item.use) ? item.use.join(" ") : (item.use || "")).toLowerCase().includes(s) ||
          (Array.isArray(item.requirementLocations) ? item.requirementLocations.join(" ") : (item.requirementLocations || "")).toLowerCase().includes(s) ||
          item.comments?.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [items, groupFilter, statusFilter, columnFilters, search, teamUserIds]);

  const activeItems = useMemo(() => filteredItems.filter((i) => i.status === "Active" || !i.status), [filteredItems]);
  const pastItems = useMemo(() => filteredItems.filter((i) => i.status === "Past"), [filteredItems]);
  const archivedItems = useMemo(() => filteredItems.filter((i) => i.status === "Archived"), [filteredItems]);
  const [showPast, setShowPast] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  const groupCounts = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((i) => {
      const g = i.groupName || "Ungrouped";
      map[g] = (map[g] || 0) + 1;
    });
    return map;
  }, [items]);

  if (error) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-medium mb-1">Could not load Leasing Requirements</h3>
          <p className="text-sm text-muted-foreground">Please check the API connection.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        {Object.entries(groupCounts).map(([group, count]) => {
          const groupColor = group === "Active" ? "bg-emerald-500" :
            group === "Prospect" ? "bg-blue-500" :
            group === "Target" ? "bg-amber-500" :
            group === "Under Offer" ? "bg-purple-500" :
            group === "Completed" ? "bg-slate-500" :
            "bg-gray-500";
          return (
            <Card
              key={group}
              className={`flex-1 min-w-[130px] cursor-pointer transition-colors ${
                groupFilter === group ? "border-primary" : ""
              }`}
              onClick={() => setGroupFilter(groupFilter === group ? "all" : group)}
              data-testid={`card-leasing-group-${group}`}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <Badge className={`${groupColor} text-white text-[10px] px-1.5 py-0 shrink-0`}>{group}</Badge>
                  <div>
                    <p className="text-lg font-bold">{count}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        <Card
          className={`flex-1 min-w-[130px] cursor-pointer transition-colors ${
            groupFilter === "all" ? "border-primary" : ""
          }`}
          onClick={() => setGroupFilter("all")}
          data-testid="card-leasing-group-all"
        >
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-lg font-bold">{items.length}</p>
                <p className="text-xs text-muted-foreground">All</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search leasing requirements..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-leasing"
          />
        </div>
        {(search || groupFilter !== "all" || hasColumnFilters) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setSearch(""); setGroupFilter("all"); setStatusFilter("all"); setColumnFilters({}); }}
            data-testid="button-clear-leasing-filters"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Clear
          </Button>
        )}
        <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-leasing">
          <Plus className="w-4 h-4 mr-1" />
          Add Requirement
        </Button>
      </div>

      <LeasingSection
        title="Active Requirements"
        items={activeItems}
        isLoading={isLoading}
        companies={companies}
        contacts={contacts}
        companyMap={companyMap}
        contactMap={contactMap}
        dealMap={dealMap}
        users={users}
        userMap={userMap}
        navigate={navigate}
        inlineUpdate={inlineUpdate}
        onEdit={setEditItem}
        onDelete={setDeleteItem}
        onMatch={setMatchItem}
        columnFilters={columnFilters}
        filterOptions={leasingFilterOptions}
        onToggleFilter={toggleColumnFilter}
        colorMap={userIdColorMap}
        propertyMatchMap={propertyMatchMap}
      />

      {pastItems.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowPast(!showPast)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            data-testid="button-toggle-past"
          >
            <Archive className="w-4 h-4" />
            <span className="font-medium">BGP Requirements ({pastItems.length})</span>
            <span className="text-xs">{showPast ? "▼" : "▶"}</span>
          </button>
          {showPast && (
            <LeasingSection
              title=""
              items={pastItems}
              isLoading={false}
              companies={companies}
              contacts={contacts}
              companyMap={companyMap}
              contactMap={contactMap}
              dealMap={dealMap}
              users={users}
              userMap={userMap}
              navigate={navigate}
              inlineUpdate={inlineUpdate}
              onEdit={setEditItem}
              onDelete={setDeleteItem}
              onMatch={setMatchItem}
              isArchived
              columnFilters={columnFilters}
              filterOptions={leasingFilterOptions}
              onToggleFilter={toggleColumnFilter}
              colorMap={userIdColorMap}
              propertyMatchMap={propertyMatchMap}
            />
          )}
        </div>
      )}

      {archivedItems.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            data-testid="button-toggle-archived"
          >
            <Archive className="w-4 h-4" />
            <span className="font-medium">Archived Requirements ({archivedItems.length})</span>
            <span className="text-xs">{showArchived ? "▼" : "▶"}</span>
          </button>
          {showArchived && (
            <LeasingSection
              title=""
              items={archivedItems}
              isLoading={false}
              companies={companies}
              contacts={contacts}
              companyMap={companyMap}
              contactMap={contactMap}
              dealMap={dealMap}
              users={users}
              userMap={userMap}
              navigate={navigate}
              inlineUpdate={inlineUpdate}
              onEdit={setEditItem}
              onDelete={setDeleteItem}
              onMatch={setMatchItem}
              isArchived
              columnFilters={columnFilters}
              filterOptions={leasingFilterOptions}
              onToggleFilter={toggleColumnFilter}
              colorMap={userIdColorMap}
              propertyMatchMap={propertyMatchMap}
            />
          )}
        </div>
      )}

      <LeasingFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(data) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
        title="Create Leasing Requirement"
        groups={groups}
        companies={companies}
        contacts={contacts}
        deals={deals}
      />

      {editItem && (
        <LeasingFormDialog
          open={!!editItem}
          onOpenChange={(open) => { if (!open) setEditItem(null); }}
          onSubmit={(data) => updateMutation.mutate({ id: editItem.id, data })}
          isPending={updateMutation.isPending}
          title="Edit Leasing Requirement"
          defaultValues={editItem}
          companies={companies}
          contacts={contacts}
          deals={deals}
          groups={groups}
        />
      )}

      <Dialog open={!!deleteItem} onOpenChange={(open) => { if (!open) setDeleteItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Requirement</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteItem?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)} data-testid="button-cancel-delete">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RequirementMatchesDialog
        requirement={matchItem}
        onClose={() => setMatchItem(null)}
      />
    </div>
  );
}

function RequirementMatchesDialog({ requirement, onClose }: { requirement: any | null; onClose: () => void }) {
  const { data: matches = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/requirements/matches", requirement?.id],
    queryFn: async () => {
      if (!requirement?.id) return [];
      const res = await fetch(`/api/requirements/matches/${requirement.id}?type=leasing`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!requirement?.id,
  });

  return (
    <Dialog open={!!requirement} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Matching Available Units</DialogTitle>
          <DialogDescription>
            Units matching "{requirement?.name}" by use class and location
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[400px]">
          {isLoading ? (
            <div className="space-y-2 p-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : matches.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">No matching units found</p>
              <p className="text-xs text-muted-foreground mt-1">Try broadening the requirement criteria</p>
            </div>
          ) : (
            <div className="space-y-1 p-1">
              {matches.map((unit: any) => (
                <div key={unit.id} className="flex items-center justify-between p-3 rounded-md border hover:bg-muted/50 transition-colors" data-testid={`match-unit-${unit.id}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{unit.unit_name}</p>
                    <p className="text-xs text-muted-foreground">{unit.property_name || ""} · {unit.use_class || ""}</p>
                    {unit.location && <p className="text-[10px] text-muted-foreground">{unit.location}</p>}
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    {unit.sqft && <p className="text-xs font-medium">{Number(unit.sqft).toLocaleString()} sqft</p>}
                    {unit.asking_rent && <p className="text-[10px] text-muted-foreground">£{Number(unit.asking_rent).toLocaleString()} psf</p>}
                    <Badge variant="outline" className="text-[9px] mt-0.5">{unit.marketing_status || "Available"}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function FormMultiLocationPicker({
  locationData,
  onChange,
}: {
  locationData: string | null;
  onChange: (data: string | null) => void;
}) {
  const locations = parseLocationData(locationData);

  const addLocation = (addr: { formatted: string; placeId: string; lat?: number; lng?: number } | null) => {
    if (!addr) return;
    if (locations.some((l) => l.placeId === addr.placeId)) return;
    const updated = [...locations, addr];
    onChange(JSON.stringify(updated));
  };

  const removeLocation = (placeId: string) => {
    const updated = locations.filter((l) => l.placeId !== placeId);
    onChange(updated.length > 0 ? JSON.stringify(updated) : null);
  };

  return (
    <div className="border rounded-md p-2 space-y-2">
      {locations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {locations.map((loc) => (
            <div
              key={loc.placeId}
              className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1 text-[11px]"
            >
              <MapPin className="w-2.5 h-2.5 text-blue-500 shrink-0" />
              <span className="text-blue-700 max-w-[180px] truncate" title={loc.formatted}>{loc.formatted.split(",")[0]}</span>
              <button
                type="button"
                onClick={() => removeLocation(loc.placeId)}
                className="text-blue-400 hover:text-red-500 ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <AddressAutocomplete
        value={null}
        onChange={addLocation}
        placeholder="Search and add a location..."
      />
    </div>
  );
}

function LandlordPackCell({ itemId, landlordPack }: { itemId: string; landlordPack: string | null }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const uploadMutation = useMutation({
    mutationFn: async (file: globalThis.File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/crm/requirements-leasing/${itemId}/landlord-pack`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("bgp_auth_token")}` },
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-leasing"] });
      toast({ title: "Landlord pack uploaded" });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/crm/requirements-leasing/${itemId}/landlord-pack`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-leasing"] });
      toast({ title: "Landlord pack removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  let pack: { url?: string; name?: string; size?: number } | null = null;
  if (landlordPack) {
    try { pack = JSON.parse(landlordPack); } catch {}
  }

  if (pack?.url) {
    const displayName = pack.name || "Document";
    return (
      <div className="space-y-0.5">
        <a
          href={pack.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline flex items-center gap-1 cursor-pointer"
          data-testid={`link-landlord-pack-${itemId}`}
        >
          <File className="w-3 h-3 shrink-0" />
          <span className="truncate max-w-[80px]">{displayName}</span>
        </a>
        <button
          onClick={() => deleteMutation.mutate()}
          className="text-[10px] text-red-500 hover:text-red-700 cursor-pointer"
          data-testid={`button-remove-pack-${itemId}`}
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadMutation.mutate(file);
          e.target.value = "";
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        className="text-xs h-7 px-2"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploadMutation.isPending}
        data-testid={`button-upload-pack-${itemId}`}
      >
        <Upload className="w-3 h-3 mr-1" />
        {uploadMutation.isPending ? "Uploading..." : "Upload"}
      </Button>
    </>
  );
}

const USE_OPTIONS = CRM_OPTIONS.reqLeasingUse.map((u) => ({ label: u, value: u }));
const TYPE_OPTIONS = CRM_OPTIONS.reqLeasingType.map((t) => ({ label: t, value: t }));
const SIZE_OPTIONS = CRM_OPTIONS.reqLeasingSize.map((s) => ({ label: s, value: s }));
const LOCATION_OPTIONS = CRM_OPTIONS.reqLeasingLocations.map((l) => ({ label: l, value: l }));

const INVEST_USE_OPTIONS = CRM_OPTIONS.reqInvestmentUse.map((u) => ({ label: u, value: u }));
const INVEST_TYPE_OPTIONS = CRM_OPTIONS.reqInvestmentType.map((t) => ({ label: t, value: t }));
const INVEST_SIZE_OPTIONS = CRM_OPTIONS.reqInvestmentSize.map((s) => ({ label: s, value: s }));
const INVEST_LOCATION_OPTIONS = CRM_OPTIONS.reqInvestmentLocations.map((l) => ({ label: l, value: l }));

function InlineCompanyPicker({
  companies,
  currentCompanyId,
  currentName,
  companyMap,
  onSelect,
  navigate,
  testIdPrefix,
}: {
  companies: CrmCompany[];
  currentCompanyId: string | null;
  currentName: string;
  companyMap: Map<string, CrmCompany>;
  onSelect: (companyId: string | null, name: string) => void;
  navigate: (to: string) => void;
  testIdPrefix: string;
}) {
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!editing) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node) &&
          dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setEditing(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 220) });
    }
  }, [editing]);

  const filtered = useMemo(() => {
    const list = companies || [];
    if (!search) return list.slice(0, 20);
    const s = search.toLowerCase();
    return list.filter((c) =>
      c.name.toLowerCase().includes(s) ||
      (c.companyType || "").toLowerCase().includes(s)
    ).slice(0, 20);
  }, [companies, search]);

  const company = currentCompanyId ? companyMap.get(currentCompanyId) : null;

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5 group">
        {company ? (
          <Building2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
        ) : (
          <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
        {company ? (
          <button
            className="text-left text-blue-600 hover:text-blue-800 hover:underline cursor-pointer font-medium truncate"
            onClick={() => navigate(`/companies/${currentCompanyId}`)}
            data-testid={`${testIdPrefix}-link`}
          >
            {currentName}
          </button>
        ) : (
          <span className="truncate">{currentName || "—"}</span>
        )}
        <button
          type="button"
          onClick={() => { setEditing(true); setSearch(""); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
          data-testid={`${testIdPrefix}-edit`}
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search companies..."
          className="w-full pl-7 pr-2 py-1 text-sm border rounded-md bg-background"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid={`${testIdPrefix}-search`}
        />
      </div>
      {dropdownPos && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, minWidth: 220 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {currentCompanyId && (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-accent text-xs text-red-600 border-b"
              onClick={() => { onSelect(null, ""); setEditing(false); }}
              data-testid={`${testIdPrefix}-clear`}
            >
              <X className="w-3 h-3 inline mr-1" /> Remove company link
            </button>
          )}
          {filtered.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">No companies found</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-sm"
                onClick={() => { onSelect(c.id, c.name); setEditing(false); }}
                data-testid={`${testIdPrefix}-option-${c.id}`}
              >
                <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{c.name}</span>
                {c.companyType && (
                  <Badge variant="outline" className="text-[10px] shrink-0">{c.companyType}</Badge>
                )}
              </button>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

function InlineUserPicker({
  users,
  currentUserId,
  userMap,
  onSelect,
  testIdPrefix,
}: {
  users: BgpUser[];
  currentUserId: string | null;
  userMap: Map<string, BgpUser>;
  onSelect: (userId: string | null) => void;
  testIdPrefix: string;
}) {
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!editing) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node) &&
          dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setEditing(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 200) });
    }
  }, [editing]);

  const filtered = useMemo(() => {
    const list = users || [];
    if (!search) return list.slice(0, 20);
    const s = search.toLowerCase();
    return list.filter((u) =>
      u.name.toLowerCase().includes(s) ||
      (u.department || "").toLowerCase().includes(s) ||
      (u.role || "").toLowerCase().includes(s)
    ).slice(0, 20);
  }, [users, search]);

  const user = currentUserId ? userMap.get(currentUserId) : null;

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5 group">
        {user ? (
          <>
            <User className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <div className="min-w-0">
              <span className="text-xs font-medium truncate block max-w-[120px]">{user.name}</span>
              {user.department && (
                <span className="text-[10px] text-muted-foreground truncate block">{user.department}</span>
              )}
            </div>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        <button
          type="button"
          onClick={() => { setEditing(true); setSearch(""); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
          data-testid={`${testIdPrefix}-edit`}
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search team..."
          className="w-full pl-7 pr-2 py-1 text-sm border rounded-md bg-background"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid={`${testIdPrefix}-search`}
        />
      </div>
      {dropdownPos && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, minWidth: 200 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {currentUserId && (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-accent text-xs text-red-600 border-b"
              onClick={() => { onSelect(null); setEditing(false); }}
              data-testid={`${testIdPrefix}-clear`}
            >
              <X className="w-3 h-3 inline mr-1" /> Remove BGP contact
            </button>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No team members found</div>
          ) : (
            filtered.map((u) => (
              <button
                key={u.id}
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"
                onClick={() => { onSelect(u.id); setEditing(false); }}
                data-testid={`${testIdPrefix}-option-${u.id}`}
              >
                <User className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-medium truncate block">{u.name}</span>
                  {u.department && <span className="text-[10px] text-muted-foreground">{u.department}</span>}
                </div>
              </button>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

function InlineMultiUserPicker({
  users,
  currentUserIds,
  userMap,
  onSelect,
  testIdPrefix,
  colorMap,
}: {
  users: BgpUser[];
  currentUserIds: string[];
  userMap: Map<string, BgpUser>;
  onSelect: (userIds: string[]) => void;
  testIdPrefix: string;
  colorMap?: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!editing) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node) &&
          dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setEditing(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 200) });
    }
  }, [editing]);

  const filtered = useMemo(() => {
    const list = users || [];
    if (!search) return list.slice(0, 20);
    const s = search.toLowerCase();
    return list.filter((u) =>
      u.name.toLowerCase().includes(s) ||
      (u.department || "").toLowerCase().includes(s)
    ).slice(0, 20);
  }, [users, search]);

  const selectedUsers = currentUserIds.map(id => userMap.get(id)).filter(Boolean) as BgpUser[];

  const toggleUser = (userId: string) => {
    if (currentUserIds.includes(userId)) {
      onSelect(currentUserIds.filter(id => id !== userId));
    } else {
      onSelect([...currentUserIds, userId]);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-1 group flex-wrap">
        {selectedUsers.length > 0 ? (
          selectedUsers.map(u => {
            const bg = colorMap?.[u.id] || "bg-zinc-500";
            return (
            <span key={u.id} className={`inline-flex items-center gap-1 text-xs text-white px-1.5 py-0.5 rounded-full ${bg}`}>
              <span className="truncate max-w-[80px]">{u.name.split(" ")[0]}</span>
            </span>
            );
          })
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        <button
          type="button"
          onClick={() => { setEditing(true); setSearch(""); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
          data-testid={`${testIdPrefix}-edit`}
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search team..."
          className="w-full pl-7 pr-2 py-1 text-sm border rounded-md bg-background"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid={`${testIdPrefix}-search`}
        />
      </div>
      {dropdownPos && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, minWidth: 200 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {currentUserIds.length > 0 && (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-accent text-xs text-red-600 border-b"
              onClick={() => { onSelect([]); setEditing(false); }}
              data-testid={`${testIdPrefix}-clear`}
            >
              <X className="w-3 h-3 inline mr-1" /> Clear all
            </button>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No team members found</div>
          ) : (
            filtered.map((u) => {
              const isActive = currentUserIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  className={`w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 ${isActive ? "bg-accent/50" : ""}`}
                  onClick={() => toggleUser(u.id)}
                  data-testid={`${testIdPrefix}-option-${u.id}`}
                >
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${isActive ? (colorMap?.[u.id] || "bg-emerald-500") + " border-transparent" : "border-muted-foreground/30"}`}>
                    {isActive && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <User className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium truncate block">{u.name}</span>
                    {u.department && <span className="text-[10px] text-muted-foreground">{u.department}</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

function InlineContactPicker({
  contacts,
  currentContactId,
  contactMap,
  companyId,
  onSelect,
  navigate,
  testIdPrefix,
}: {
  contacts: CrmContact[];
  currentContactId: string | null;
  contactMap: Map<string, CrmContact>;
  companyId: string | null;
  onSelect: (contactId: string | null) => void;
  navigate: (to: string) => void;
  testIdPrefix: string;
}) {
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!editing) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node) &&
          dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setEditing(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 220) });
    }
  }, [editing]);

  const baseContacts = useMemo(() => {
    const list = contacts || [];
    if (companyId) return list.filter((c) => c.companyId === companyId);
    return list;
  }, [contacts, companyId]);

  const filtered = useMemo(() => {
    if (!search) return baseContacts.slice(0, 20);
    const s = search.toLowerCase();
    return baseContacts.filter((c) =>
      c.name.toLowerCase().includes(s) ||
      (c.email || "").toLowerCase().includes(s) ||
      (c.phone || "").toLowerCase().includes(s) ||
      (c.companyName || "").toLowerCase().includes(s)
    ).slice(0, 20);
  }, [baseContacts, search]);

  const contact = currentContactId ? contactMap.get(currentContactId) : null;

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5 group">
        {contact ? (
          <>
            <User className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <div className="min-w-0">
              <button
                className="text-left text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer truncate block max-w-[140px]"
                onClick={() => navigate(`/contacts/${contact.id}`)}
                data-testid={`${testIdPrefix}-link`}
              >
                {contact.name}
              </button>
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 truncate" data-testid={`${testIdPrefix}-email`}>
                  <Mail className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate max-w-[140px]">{contact.email}</span>
                </a>
              )}
              {contact.phone && (
                <a href={`tel:${contact.phone}`} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1" data-testid={`${testIdPrefix}-phone`}>
                  <Phone className="w-2.5 h-2.5 shrink-0" />
                  <span>{contact.phone}</span>
                </a>
              )}
            </div>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        <button
          type="button"
          onClick={() => { setEditing(true); setSearch(""); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
          data-testid={`${testIdPrefix}-edit`}
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          placeholder={companyId ? "Search company contacts..." : "Search all contacts..."}
          className="w-full pl-7 pr-2 py-1 text-sm border rounded-md bg-background"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid={`${testIdPrefix}-search`}
        />
      </div>
      {dropdownPos && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, minWidth: 220 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {currentContactId && (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-accent text-xs text-red-600 border-b"
              onClick={() => { onSelect(null); setEditing(false); }}
              data-testid={`${testIdPrefix}-clear`}
            >
              <X className="w-3 h-3 inline mr-1" /> Remove contact
            </button>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No contacts found</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"
                onClick={() => { onSelect(c.id); setEditing(false); }}
                data-testid={`${testIdPrefix}-option-${c.id}`}
              >
                <User className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-medium truncate block">{c.name}</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.email && <span className="text-[10px] text-muted-foreground truncate">{c.email}</span>}
                    {c.companyName && <Badge variant="outline" className="text-[10px] shrink-0">{c.companyName}</Badge>}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

type BgpUser = { id: string; name: string; email: string; role: string; department: string; team: string | null };

function LeasingSection({
  title,
  items,
  isLoading,
  companies,
  contacts,
  companyMap,
  contactMap,
  dealMap,
  users,
  userMap,
  navigate,
  inlineUpdate,
  onEdit,
  onDelete,
  onMatch,
  isArchived,
  columnFilters,
  filterOptions,
  onToggleFilter,
  colorMap,
  propertyMatchMap = new Map(),
}: {
  title: string;
  items: CrmRequirementsLeasing[];
  isLoading: boolean;
  companies: CrmCompany[];
  contacts: CrmContact[];
  companyMap: Map<string, CrmCompany>;
  contactMap: Map<string, CrmContact>;
  dealMap: Map<string, CrmDeal>;
  users: BgpUser[];
  userMap: Map<string, BgpUser>;
  navigate: (to: string) => void;
  inlineUpdate: (id: string, data: Partial<CrmRequirementsLeasing>) => void;
  onEdit: (item: CrmRequirementsLeasing) => void;
  onDelete: (item: CrmRequirementsLeasing) => void;
  onMatch?: (item: CrmRequirementsLeasing) => void;
  isArchived?: boolean;
  columnFilters?: Record<string, string[]>;
  filterOptions?: { status: string[]; use: string[]; requirementType: string[]; size: string[]; requirementLocations: string[] };
  onToggleFilter?: (col: string, value: string) => void;
  colorMap?: Record<string, string>;
  propertyMatchMap?: Map<string, CrmProperty[]>;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        {title && (
          <div className={`px-4 py-2 border-b ${isArchived ? "bg-muted/30" : "bg-emerald-500/5"}`}>
            <h3 className={`text-sm font-semibold ${isArchived ? "text-muted-foreground" : "text-emerald-700"}`} data-testid={`text-section-${isArchived ? "archived" : "active"}`}>
              {title} ({items.length})
            </h3>
          </div>
        )}
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : (
          <ScrollableTable minWidth={2400}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[120px] sticky left-0 bg-background z-10">Name</TableHead>
                  <TableHead className="min-w-[100px]">Date</TableHead>
                  <TableHead className="min-w-[100px]">
                    {filterOptions && onToggleFilter ? (
                      <ColumnFilterPopover
                        label="Status"
                        options={filterOptions.status}
                        activeFilters={columnFilters?.status || []}
                        onToggleFilter={(v) => onToggleFilter("status", v)}
                      />
                    ) : "Status"}
                  </TableHead>
                  <TableHead className="min-w-[100px] text-center">Progress</TableHead>
                  <TableHead className="min-w-[140px]">
                    {filterOptions && onToggleFilter ? (
                      <ColumnFilterPopover
                        label="Use"
                        options={filterOptions.use}
                        activeFilters={columnFilters?.use || []}
                        onToggleFilter={(v) => onToggleFilter("use", v)}
                      />
                    ) : "Use"}
                  </TableHead>
                  <TableHead className="min-w-[100px]">
                    {filterOptions && onToggleFilter ? (
                      <ColumnFilterPopover
                        label="Requirement Type"
                        options={filterOptions.requirementType}
                        activeFilters={columnFilters?.requirementType || []}
                        onToggleFilter={(v) => onToggleFilter("requirementType", v)}
                      />
                    ) : "Requirement Type"}
                  </TableHead>
                  <TableHead className="min-w-[100px]">
                    {filterOptions && onToggleFilter ? (
                      <ColumnFilterPopover
                        label="Size"
                        options={filterOptions.size}
                        activeFilters={columnFilters?.size || []}
                        onToggleFilter={(v) => onToggleFilter("size", v)}
                      />
                    ) : "Size"}
                  </TableHead>
                  <TableHead className="min-w-[150px]">
                    {filterOptions && onToggleFilter ? (
                      <ColumnFilterPopover
                        label="Req. Locations"
                        options={filterOptions.requirementLocations}
                        activeFilters={columnFilters?.requirementLocations || []}
                        onToggleFilter={(v) => onToggleFilter("requirementLocations", v)}
                      />
                    ) : "Req. Locations"}
                  </TableHead>
                  <TableHead className="min-w-[220px]">Map Locations</TableHead>
                  <TableHead className="min-w-[220px]">Principal Contact</TableHead>
                  <TableHead className="min-w-[220px]">Agent Contact</TableHead>
                  <TableHead className="min-w-[160px]">BGP Contact</TableHead>
                  <TableHead className="min-w-[180px]">Deal</TableHead>
                  <TableHead className="min-w-[120px]">Landlord Pack</TableHead>
                  <TableHead className="min-w-[120px]">Extract</TableHead>
                  <TableHead className="min-w-[150px]">Comments</TableHead>
                  <TableHead className="min-w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id} className={`text-xs ${isArchived ? "opacity-60" : ""}`} data-testid={`row-leasing-${item.id}`}>
                    <TableCell className="px-1.5 py-1 font-medium text-sm sticky left-0 bg-background z-10">
                      <InlineCompanyPicker
                        companies={companies}
                        currentCompanyId={item.companyId}
                        currentName={item.name}
                        companyMap={companyMap}
                        onSelect={(companyId, name) => {
                          const updates: Partial<CrmRequirementsLeasing> = { companyId: companyId as any, name };
                          if (companyId !== item.companyId) updates.principalContactId = null;
                          inlineUpdate(item.id, updates);
                        }}
                        navigate={navigate}
                        testIdPrefix={`name-leasing-${item.id}`}
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineDate
                        value={item.requirementDate || null}
                        onSave={(v) => inlineUpdate(item.id, { requirementDate: v || null })}
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineLabelSelect
                        value={item.status}
                        options={CRM_OPTIONS.reqLeasingStatus}
                        colorMap={CRM_OPTIONS.reqLeasingStatusColors}
                        onSave={(v) => inlineUpdate(item.id, { status: v || null })}
                        placeholder="Set status"
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1 text-center">
                      <ProgressTickCell
                        item={item}
                        onUpdate={(data) => inlineUpdate(item.id, data)}
                        testIdPrefix={`tick-leasing-${item.id}`}
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineMultiSelect
                        value={item.use}
                        options={USE_OPTIONS}
                        colorMap={CRM_OPTIONS.reqLeasingUseColors}
                        onSave={(v) => inlineUpdate(item.id, { use: v })}
                        placeholder="Set use"
                        testId={`select-use-${item.id}`}
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineMultiSelect
                        value={item.requirementType}
                        options={TYPE_OPTIONS}
                        colorMap={CRM_OPTIONS.reqLeasingTypeColors}
                        onSave={(v) => inlineUpdate(item.id, { requirementType: v })}
                        placeholder="Set type"
                        testId={`select-type-${item.id}`}
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineMultiSelect
                        value={item.size}
                        options={SIZE_OPTIONS}
                        colorMap={CRM_OPTIONS.reqLeasingSizeColors}
                        onSave={(v) => inlineUpdate(item.id, { size: v })}
                        placeholder="Set size"
                        testId={`select-size-${item.id}`}
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineMultiSelect
                        value={item.requirementLocations}
                        options={LOCATION_OPTIONS}
                        colorMap={CRM_OPTIONS.reqLeasingLocationsColors}
                        onSave={(v) => inlineUpdate(item.id, { requirementLocations: v })}
                        placeholder="Set locations"
                        testId={`select-locations-${item.id}`}
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <MapLocationsCell
                        itemId={item.id}
                        locationData={item.locationData}
                        onSave={(data) => inlineUpdate(item.id, { locationData: data })}
                        navigate={navigate}
                      />
                      {propertyMatchMap.has(item.id) && (
                        <div className="flex flex-wrap gap-0.5 mt-1">
                          {propertyMatchMap.get(item.id)!.slice(0, 3).map(p => (
                            <Link key={p.id} href={`/properties/${p.id}`}>
                              <Badge variant="outline" className="text-[8px] gap-0.5 cursor-pointer hover:bg-muted border-blue-300 dark:border-blue-700" data-testid={`req-prop-match-${item.id}-${p.id}`}>
                                <Building2 className="w-2 h-2 text-blue-500" />{p.name}
                              </Badge>
                            </Link>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineContactPicker
                        contacts={contacts}
                        currentContactId={item.principalContactId || null}
                        contactMap={contactMap}
                        companyId={item.companyId || null}
                        onSelect={(contactId) => inlineUpdate(item.id, { principalContactId: contactId })}
                        navigate={navigate}
                        testIdPrefix={`contact-${item.id}`}
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineContactPicker
                        contacts={contacts}
                        currentContactId={item.agentContactId || null}
                        contactMap={contactMap}
                        companyId={null}
                        onSelect={(contactId) => inlineUpdate(item.id, { agentContactId: contactId })}
                        navigate={navigate}
                        testIdPrefix={`agent-contact-${item.id}`}
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineMultiUserPicker
                        users={users}
                        currentUserIds={item.bgpContactUserIds || (item.bgpContactUserId ? [item.bgpContactUserId] : [])}
                        userMap={userMap}
                        onSelect={(userIds) => inlineUpdate(item.id, { bgpContactUserIds: userIds })}
                        testIdPrefix={`bgp-contact-${item.id}`}
                        colorMap={colorMap}
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      {(() => {
                        const deal = item.dealId ? dealMap.get(item.dealId) : null;
                        if (!deal) return <span className="text-muted-foreground">—</span>;
                        return (
                          <button
                            className="font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer flex items-center gap-1"
                            onClick={() => navigate(`/deals/${deal.id}`)}
                            data-testid={`link-deal-${item.id}`}
                          >
                            <FileText className="w-3 h-3 shrink-0" />
                            <span className="truncate max-w-[140px]">{deal.name}</span>
                            {deal.status && (
                              <Badge variant="outline" className="text-[10px] shrink-0 ml-1">{deal.status}</Badge>
                            )}
                          </button>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <LandlordPackCell itemId={item.id} landlordPack={item.landlordPack} />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineLabelSelect
                        value={item.extract}
                        options={CRM_OPTIONS.reqLeasingExtract}
                        colorMap={CRM_OPTIONS.reqLeasingExtractColors}
                        onSave={(v) => inlineUpdate(item.id, { extract: v || null })}
                        placeholder="Set"
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineText
                        value={item.comments || ""}
                        onSave={(v) => inlineUpdate(item.id, { comments: v || null })}
                        placeholder="Add comment..."
                        maxLines={2}
                        multiline
                      />
                    </TableCell>
                    <TableCell className="px-1 py-1">
                      <div className="flex items-center gap-0.5">
                        {onMatch && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-purple-500 hover:text-purple-700"
                            onClick={() => onMatch(item)}
                            data-testid={`button-match-leasing-${item.id}`}
                            title="Find matching units"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => onEdit(item)}
                          data-testid={`button-edit-leasing-${item.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => onDelete(item)}
                          data-testid={`button-delete-leasing-${item.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={20} className="text-center py-8 text-muted-foreground">
                      <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">{isArchived ? "No archived requirements" : "No active requirements found"}</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollableTable>
        )}
      </CardContent>
    </Card>
  );
}

function CompanySearchPicker({
  companies,
  selectedId,
  selectedName,
  onSelect,
  onClear,
}: {
  companies: CrmCompany[];
  selectedId: string;
  selectedName: string;
  onSelect: (company: CrmCompany) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    if (!search) return companies.slice(0, 20);
    const s = search.toLowerCase();
    return companies.filter((c) =>
      c.name.toLowerCase().includes(s) ||
      (c.companyType || "").toLowerCase().includes(s)
    ).slice(0, 20);
  }, [companies, search]);

  if (selectedId && selectedName) {
    const company = companies.find((c) => c.id === selectedId);
    return (
      <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-muted/30">
        <Building2 className="w-4 h-4 text-blue-500 shrink-0" />
        <span className="text-sm font-medium flex-1 truncate">{selectedName}</span>
        {company?.companyType && (
          <Badge variant="outline" className="text-[10px] shrink-0">{company.companyType}</Badge>
        )}
        <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="Search companies to link..."
          className="pl-9"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          data-testid="input-leasing-company-search"
        />
      </div>
      {open && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">No companies found</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2 text-sm"
                onClick={() => { onSelect(c); setSearch(""); setOpen(false); }}
                data-testid={`option-company-${c.id}`}
              >
                <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{c.name}</span>
                {c.companyType && (
                  <Badge variant="outline" className="text-[10px] shrink-0">{c.companyType}</Badge>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ContactSearchPicker({
  contacts,
  selectedId,
  onSelect,
  onClear,
  filterCompanyId,
  filterContactType,
  placeholder,
}: {
  contacts: CrmContact[];
  selectedId: string;
  onSelect: (contact: CrmContact) => void;
  onClear: () => void;
  filterCompanyId?: string;
  filterContactType?: string;
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const baseContacts = useMemo(() => {
    let list = contacts;
    if (filterCompanyId) {
      list = list.filter((c) => c.companyId === filterCompanyId);
    }
    if (filterContactType) {
      list = list.filter((c) => c.contactType?.toLowerCase() === filterContactType.toLowerCase());
    }
    return list;
  }, [contacts, filterCompanyId, filterContactType]);

  const filtered = useMemo(() => {
    if (!search) return baseContacts.slice(0, 20);
    const s = search.toLowerCase();
    return baseContacts.filter((c) =>
      c.name.toLowerCase().includes(s) ||
      (c.email || "").toLowerCase().includes(s) ||
      (c.phone || "").toLowerCase().includes(s) ||
      (c.companyName || "").toLowerCase().includes(s)
    ).slice(0, 20);
  }, [baseContacts, search]);

  if (selectedId) {
    const contact = contacts.find((c) => c.id === selectedId);
    if (contact && (!filterCompanyId || contact.companyId === filterCompanyId) && (!filterContactType || contact.contactType?.toLowerCase() === filterContactType.toLowerCase())) {
      return (
        <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-muted/30">
          <User className="w-4 h-4 text-blue-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium truncate block">{contact.name}</span>
            <div className="flex items-center gap-2 flex-wrap">
              {contact.email && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Mail className="w-2.5 h-2.5 shrink-0" />{contact.email}
                </span>
              )}
              {contact.phone && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Phone className="w-2.5 h-2.5 shrink-0" />{contact.phone}
                </span>
              )}
            </div>
          </div>
          {contact.companyName && (
            <Badge variant="outline" className="text-[10px] shrink-0">{contact.companyName}</Badge>
          )}
          <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder={placeholder || "Search contacts..."}
          className="pl-9"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          data-testid="input-leasing-contact-search"
        />
      </div>
      {open && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">
              {filterCompanyId && baseContacts.length === 0
                ? "No contacts linked to this company"
                : filterContactType && baseContacts.length === 0
                ? `No ${filterContactType.toLowerCase()} contacts found`
                : "No contacts found"}
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2 text-sm"
                onClick={() => { onSelect(c); setSearch(""); setOpen(false); }}
                data-testid={`option-contact-${c.id}`}
              >
                <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="truncate block font-medium">{c.name}</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.email && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <Mail className="w-2 h-2" />{c.email}
                      </span>
                    )}
                    {c.phone && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <Phone className="w-2 h-2" />{c.phone}
                      </span>
                    )}
                  </div>
                </div>
                {c.companyName && (
                  <Badge variant="outline" className="text-[10px] shrink-0">{c.companyName}</Badge>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DealSearchPicker({
  deals,
  selectedId,
  onSelect,
  onClear,
}: {
  deals: CrmDeal[];
  selectedId: string;
  onSelect: (deal: CrmDeal) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    if (!search) return deals.slice(0, 20);
    const s = search.toLowerCase();
    return deals.filter((d) =>
      d.name.toLowerCase().includes(s) ||
      (d.status || "").toLowerCase().includes(s) ||
      (d.dealType || "").toLowerCase().includes(s)
    ).slice(0, 20);
  }, [deals, search]);

  if (selectedId) {
    const deal = deals.find((d) => d.id === selectedId);
    if (deal) {
      return (
        <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-muted/30">
          <FileText className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="text-sm font-medium flex-1 truncate">{deal.name}</span>
          {deal.status && (
            <Badge variant="outline" className="text-[10px] shrink-0">{deal.status}</Badge>
          )}
          <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="Search deals..."
          className="pl-9"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          data-testid="input-leasing-deal-search"
        />
      </div>
      {open && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">No deals found</div>
          ) : (
            filtered.map((d) => (
              <button
                key={d.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2 text-sm"
                onClick={() => { onSelect(d); setSearch(""); setOpen(false); }}
                data-testid={`option-deal-${d.id}`}
              >
                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{d.name}</span>
                {d.status && (
                  <Badge variant="outline" className="text-[10px] shrink-0">{d.status}</Badge>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function LeasingFormDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending,
  title,
  defaultValues,
  groups,
  companies,
  contacts,
  deals,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  isPending: boolean;
  title: string;
  defaultValues?: Partial<CrmRequirementsLeasing>;
  groups: string[];
  companies: CrmCompany[];
  contacts: CrmContact[];
  deals: CrmDeal[];
}) {
  const [form, setForm] = useState({
    name: defaultValues?.name || "",
    companyId: defaultValues?.companyId || "",
    groupName: defaultValues?.groupName || "",
    status: defaultValues?.status || "Active",
    principalContactId: defaultValues?.principalContactId || "",
    agentContactId: defaultValues?.agentContactId || "",
    dealId: defaultValues?.dealId || "",
    use: Array.isArray(defaultValues?.use) ? defaultValues.use : defaultValues?.use ? [defaultValues.use] : [],
    requirementType: Array.isArray(defaultValues?.requirementType) ? defaultValues.requirementType : defaultValues?.requirementType ? [defaultValues.requirementType as string] : [],
    size: Array.isArray(defaultValues?.size) ? defaultValues.size : defaultValues?.size ? [defaultValues.size as string] : [],
    requirementLocations: Array.isArray(defaultValues?.requirementLocations) ? defaultValues.requirementLocations : defaultValues?.requirementLocations ? [defaultValues.requirementLocations as string] : [],
    locationData: defaultValues?.locationData || null,
    extract: defaultValues?.extract || "",
    comments: defaultValues?.comments || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      companyId: form.companyId || null,
      principalContactId: form.principalContactId || null,
      agentContactId: form.agentContactId || null,
      dealId: form.dealId || null,
      use: form.use.length > 0 ? form.use : null,
      requirementType: form.requirementType.length > 0 ? form.requirementType : null,
      size: form.size.length > 0 ? form.size : null,
      requirementLocations: form.requirementLocations.length > 0 ? form.requirementLocations : null,
      locationData: form.locationData,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name / Company</Label>
            <CompanySearchPicker
              companies={companies}
              selectedId={form.companyId}
              selectedName={form.name}
              onSelect={(c) => setForm({ ...form, name: c.name, companyId: c.id, principalContactId: "" })}
              onClear={() => setForm({ ...form, name: "", companyId: "", principalContactId: "" })}
            />
            {!form.companyId && (
              <Input
                placeholder="Or type a name manually..."
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="input-leasing-name"
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Group</Label>
              <Input
                value={form.groupName}
                onChange={(e) => setForm({ ...form, groupName: e.target.value })}
                data-testid="input-leasing-group"
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status || undefined} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="select-leasing-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {CRM_OPTIONS.reqLeasingStatus.map((s) => (
                    <SelectItem key={s} value={s}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${CRM_OPTIONS.reqLeasingStatusColors[s] || "bg-gray-400"}`} />
                        {s}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Principal Contact</Label>
            {form.companyId ? (
              <ContactSearchPicker
                contacts={contacts}
                selectedId={form.principalContactId}
                onSelect={(c) => setForm({ ...form, principalContactId: c.id })}
                onClear={() => setForm({ ...form, principalContactId: "" })}
                filterCompanyId={form.companyId}
                placeholder="Search company contacts..."
              />
            ) : (
              <p className="text-xs text-muted-foreground italic py-2">Select a company first to choose a principal contact</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Agent Contact</Label>
            <ContactSearchPicker
              contacts={contacts}
              selectedId={form.agentContactId}
              onSelect={(c) => setForm({ ...form, agentContactId: c.id })}
              onClear={() => setForm({ ...form, agentContactId: "" })}
              filterContactType="Agent"
              placeholder="Search agent contacts..."
            />
          </div>
          <div className="space-y-2">
            <Label>Deal</Label>
            <DealSearchPicker
              deals={deals}
              selectedId={form.dealId}
              onSelect={(d) => setForm({ ...form, dealId: d.id })}
              onClear={() => setForm({ ...form, dealId: "" })}
            />
          </div>
          <div className="space-y-2">
            <Label>Use</Label>
            <div className="flex flex-wrap gap-1.5 border rounded-md p-2 min-h-[38px]">
              {CRM_OPTIONS.reqLeasingUse.map((u) => {
                const isSelected = form.use.includes(u);
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setForm({
                      ...form,
                      use: isSelected ? form.use.filter((v: string) => v !== u) : [...form.use, u],
                    })}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-all ${
                      isSelected
                        ? `${CRM_OPTIONS.reqLeasingUseColors[u] || "bg-zinc-500"} text-white`
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                    data-testid={`toggle-use-${u}`}
                  >
                    {u}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Requirement Type</Label>
            <div className="flex flex-wrap gap-1.5 border rounded-md p-2 min-h-[38px]">
              {CRM_OPTIONS.reqLeasingType.map((t) => {
                const isSelected = form.requirementType.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({
                      ...form,
                      requirementType: isSelected ? form.requirementType.filter((v: string) => v !== t) : [...form.requirementType, t],
                    })}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-all ${
                      isSelected
                        ? `${CRM_OPTIONS.reqLeasingTypeColors[t] || "bg-zinc-500"} text-white`
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                    data-testid={`toggle-type-${t}`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Size</Label>
            <div className="flex flex-wrap gap-1.5 border rounded-md p-2 min-h-[38px]">
              {CRM_OPTIONS.reqLeasingSize.map((s) => {
                const isSelected = form.size.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm({
                      ...form,
                      size: isSelected ? form.size.filter((v: string) => v !== s) : [...form.size, s],
                    })}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-all ${
                      isSelected
                        ? `${CRM_OPTIONS.reqLeasingSizeColors[s] || "bg-zinc-500"} text-white`
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                    data-testid={`toggle-size-${s}`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Requirement Locations</Label>
            <div className="flex flex-wrap gap-1.5 border rounded-md p-2 min-h-[38px]">
              {CRM_OPTIONS.reqLeasingLocations.map((l) => {
                const isSelected = form.requirementLocations.includes(l);
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setForm({
                      ...form,
                      requirementLocations: isSelected ? form.requirementLocations.filter((v: string) => v !== l) : [...form.requirementLocations, l],
                    })}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-all ${
                      isSelected
                        ? `${CRM_OPTIONS.reqLeasingLocationsColors[l] || "bg-zinc-500"} text-white`
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                    data-testid={`toggle-location-${l}`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Map Locations</Label>
            <FormMultiLocationPicker
              locationData={form.locationData}
              onChange={(data) => setForm({ ...form, locationData: data })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Extract</Label>
              <Select value={form.extract || undefined} onValueChange={(v) => setForm({ ...form, extract: v === "__clear__" ? "" : v })}>
                <SelectTrigger data-testid="select-leasing-extract">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {CRM_OPTIONS.reqLeasingExtract.map((e) => (
                    <SelectItem key={e} value={e}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${CRM_OPTIONS.reqLeasingExtractColors[e] || "bg-gray-400"}`} />
                        {e}
                      </div>
                    </SelectItem>
                  ))}
                  <SelectItem value="__clear__">
                    <span className="text-muted-foreground">Clear</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Comments</Label>
              <Textarea
                value={form.comments}
                onChange={(e) => setForm({ ...form, comments: e.target.value })}
                data-testid="input-leasing-comments"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !form.name} data-testid="button-submit-leasing">
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InvestmentTable({ teamFilter }: { teamFilter?: string | null }) {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<CrmRequirementsInvestment | null>(null);
  const [deleteItem, setDeleteItem] = useState<CrmRequirementsInvestment | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: items = [], isLoading, error } = useQuery<CrmRequirementsInvestment[]>({
    queryKey: ["/api/crm/requirements-investment"],
  });

  const { data: companies = [] } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
  });

  const { data: users = [] } = useQuery<BgpUser[]>({
    queryKey: ["/api/users"],
  });
  const userIdColorMap = useMemo(() => buildUserIdColorMap(users), [users]);

  const teamUserIds = useMemo(() => {
    if (!teamFilter) return null;
    const tf = teamFilter.toLowerCase();
    return new Set(users.filter(u => u.team?.toLowerCase().includes(tf)).map(u => u.id));
  }, [teamFilter, users]);

  const { data: invProperties = [] } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });

  const companyMap = useMemo(() => {
    const map = new Map<string, CrmCompany>();
    companies.forEach((c) => map.set(c.id, c));
    return map;
  }, [companies]);

  const userMap = useMemo(() => {
    const map = new Map<string, BgpUser>();
    users.forEach((u) => map.set(u.id, u));
    return map;
  }, [users]);

  const invPropertyMatchMap = useMemo(() => {
    const map = new Map<string, CrmProperty[]>();
    if (!invProperties.length) return map;
    items.forEach(req => {
      const locs = Array.isArray(req.requirementLocations) ? req.requirementLocations : [];
      if (!locs.length) return;
      const locsLc = locs.map(l => l.toLowerCase());
      const matches = invProperties.filter(p => {
        const addr = p.address as any;
        const addrStr = addr ? [addr.formatted, addr.street, addr.city, addr.area, addr.text, typeof addr === "string" ? addr : ""].filter(Boolean).join(" ").toLowerCase() : "";
        const pName = (p.name || "").toLowerCase();
        return locsLc.some(loc => addrStr.includes(loc) || pName.includes(loc));
      });
      if (matches.length > 0) map.set(req.id, matches);
    });
    return map;
  }, [items, invProperties]);

  const createMutation = useMutation({
    mutationFn: (data: Partial<CrmRequirementsInvestment>) =>
      apiRequest("POST", "/api/crm/requirements-investment", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-investment"] });
      setCreateOpen(false);
      toast({ title: "Requirement created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CrmRequirementsInvestment> }) =>
      apiRequest("PUT", `/api/crm/requirements-investment/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-investment"] });
      setEditItem(null);
      toast({ title: "Requirement updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const inlineUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CrmRequirementsInvestment> }) =>
      apiRequest("PUT", `/api/crm/requirements-investment/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-investment"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const inlineUpdate = (id: string, data: Partial<CrmRequirementsInvestment>) => {
    inlineUpdateMutation.mutate({ id, data });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/crm/requirements-investment/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-investment"] });
      setDeleteItem(null);
      toast({ title: "Requirement deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleColumnFilter = (col: string, value: string) => {
    setColumnFilters((prev) => {
      const current = prev[col] || [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      if (next.length === 0) {
        const { [col]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [col]: next };
    });
  };

  const investFilterOptions = useMemo(() => {
    const groupSet = new Set<string>();
    const useSet = new Set<string>();
    const typeSet = new Set<string>();
    const sizeSet = new Set<string>();
    const locationSet = new Set<string>();
    items.forEach((i) => {
      if (i.groupName) groupSet.add(i.groupName);
      if (Array.isArray(i.use)) i.use.forEach((v) => useSet.add(v));
      if (Array.isArray(i.requirementType)) i.requirementType.forEach((v) => typeSet.add(v));
      if (Array.isArray(i.size)) i.size.forEach((v) => sizeSet.add(v));
      if (Array.isArray(i.requirementLocations)) i.requirementLocations.forEach((v) => locationSet.add(v));
    });
    return {
      group: Array.from(groupSet).sort(),
      use: Array.from(useSet).sort(),
      requirementType: Array.from(typeSet).sort(),
      size: Array.from(sizeSet).sort(),
      location: Array.from(locationSet).sort(),
    };
  }, [items]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.groupName) set.add(i.groupName); });
    return Array.from(set).sort();
  }, [items]);

  const hasColumnFilters = Object.keys(columnFilters).length > 0;

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (teamUserIds) {
        const ids = (item as any).bgpContactUserIds || [];
        if (ids.length > 0 && !ids.some((id: string) => teamUserIds.has(id))) return false;
      }
      if (groupFilter !== "all" && item.groupName !== groupFilter) return false;
      if (columnFilters.group?.length && !columnFilters.group.includes(item.groupName || "")) return false;
      if (columnFilters.use?.length) {
        const vals = Array.isArray(item.use) ? item.use : [];
        if (!columnFilters.use.some((f) => vals.includes(f))) return false;
      }
      if (columnFilters.requirementType?.length) {
        const vals = Array.isArray(item.requirementType) ? item.requirementType : [];
        if (!columnFilters.requirementType.some((f) => vals.includes(f))) return false;
      }
      if (columnFilters.size?.length) {
        const vals = Array.isArray(item.size) ? item.size : [];
        if (!columnFilters.size.some((f) => vals.includes(f))) return false;
      }
      if (columnFilters.location?.length) {
        const vals = Array.isArray(item.requirementLocations) ? item.requirementLocations : [];
        if (!columnFilters.location.some((f) => vals.includes(f))) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        return (
          item.name.toLowerCase().includes(s) ||
          (Array.isArray(item.use) ? item.use.join(" ") : (item.use || "")).toLowerCase().includes(s) ||
          item.locations?.toLowerCase().includes(s) ||
          item.extract?.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [items, groupFilter, columnFilters, search, teamUserIds]);

  const groupCounts = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((i) => {
      const g = i.groupName || "Ungrouped";
      map[g] = (map[g] || 0) + 1;
    });
    return map;
  }, [items]);

  if (error) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-medium mb-1">Could not load Investment Requirements</h3>
          <p className="text-sm text-muted-foreground">Please check the API connection.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        {Object.entries(groupCounts).map(([group, count]) => {
          const badgeColor = group === "Institutional" ? "bg-indigo-500" :
            group === "Active Buyers" ? "bg-emerald-500" :
            group === "Target Buyers" ? "bg-amber-500" :
            "bg-slate-500";
          return (
            <Card
              key={group}
              className={`flex-1 min-w-[130px] cursor-pointer transition-colors ${
                groupFilter === group ? "border-primary" : ""
              }`}
              onClick={() => setGroupFilter(groupFilter === group ? "all" : group)}
              data-testid={`card-invest-group-${group}`}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <Badge className={`${badgeColor} text-white text-[10px] px-1.5 py-0 shrink-0`}>{group}</Badge>
                  <div>
                    <p className="text-lg font-bold">{count}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        <Card
          className={`flex-1 min-w-[130px] cursor-pointer transition-colors ${
            groupFilter === "all" ? "border-primary" : ""
          }`}
          onClick={() => setGroupFilter("all")}
          data-testid="card-invest-group-all"
        >
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-lg font-bold">{items.length}</p>
                <p className="text-xs text-muted-foreground">All</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search investment requirements..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-investment"
          />
        </div>
        {(search || groupFilter !== "all" || hasColumnFilters) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setSearch(""); setGroupFilter("all"); setColumnFilters({}); }}
            data-testid="button-clear-invest-filters"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Clear
          </Button>
        )}
        <input
          type="file"
          ref={importInputRef}
          accept=".xlsx,.xls"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setImporting(true);
            try {
              const formData = new FormData();
              formData.append("file", file);
              const res = await fetch("/api/crm/requirements-investment/import", {
                method: "POST",
                headers: { Authorization: `Bearer ${localStorage.getItem("bgp_auth_token")}` },
                body: formData,
              });
              const result = await res.json();
              if (!res.ok) throw new Error(result.error);
              queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-investment"] });
              queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
              toast({
                title: "Import complete",
                description: `${result.created} requirements imported, ${result.skipped} skipped (already exist)${result.newCompanies > 0 ? `, ${result.newCompanies} new companies created` : ""}`,
              });
            } catch (err: any) {
              toast({ title: "Import failed", description: err.message, variant: "destructive" });
            } finally {
              setImporting(false);
              if (importInputRef.current) importInputRef.current.value = "";
            }
          }}
          data-testid="input-import-investment"
        />
        <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-investment">
          <Plus className="w-4 h-4 mr-1" />
          Add Requirement
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <ScrollableTable minWidth={1600}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[80px] max-w-[120px] sticky left-0 bg-background z-10">Company</TableHead>
                    <TableHead className="min-w-[140px]">Contact</TableHead>
                    <TableHead className="min-w-[100px]">Updated</TableHead>
                    <TableHead className="min-w-[120px]">
                      <ColumnFilterPopover
                        label="Group"
                        options={investFilterOptions.group}
                        activeFilters={columnFilters.group || []}
                        onToggleFilter={(v) => toggleColumnFilter("group", v)}
                      />
                    </TableHead>
                    <TableHead className="min-w-[100px] text-center">Progress</TableHead>
                    <TableHead className="min-w-[100px]">
                      <ColumnFilterPopover
                        label="Use"
                        options={investFilterOptions.use}
                        activeFilters={columnFilters.use || []}
                        onToggleFilter={(v) => toggleColumnFilter("use", v)}
                      />
                    </TableHead>
                    <TableHead className="min-w-[100px]">
                      <ColumnFilterPopover
                        label="Type"
                        options={investFilterOptions.requirementType}
                        activeFilters={columnFilters.requirementType || []}
                        onToggleFilter={(v) => toggleColumnFilter("requirementType", v)}
                      />
                    </TableHead>
                    <TableHead className="min-w-[100px]">
                      <ColumnFilterPopover
                        label="Size"
                        options={investFilterOptions.size}
                        activeFilters={columnFilters.size || []}
                        onToggleFilter={(v) => toggleColumnFilter("size", v)}
                      />
                    </TableHead>
                    <TableHead className="min-w-[150px]">
                      <ColumnFilterPopover
                        label="Locations"
                        options={investFilterOptions.location}
                        activeFilters={columnFilters.location || []}
                        onToggleFilter={(v) => toggleColumnFilter("location", v)}
                      />
                    </TableHead>
                    <TableHead className="min-w-[160px]">BGP Contact</TableHead>
                    <TableHead className="min-w-[200px]">Comments</TableHead>
                    <TableHead className="min-w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow key={item.id} className="text-xs" data-testid={`row-invest-${item.id}`}>
                      <TableCell className="px-1.5 py-1 font-medium text-sm max-w-[120px] sticky left-0 bg-background z-10">
                        {item.companyId && companyMap.has(item.companyId) ? (
                          <button
                            className="flex items-center gap-2 text-left hover:underline cursor-pointer text-blue-600 dark:text-blue-400 max-w-full"
                            onClick={() => navigate(`/contacts?company=${item.companyId}`)}
                            data-testid={`link-company-invest-${item.id}`}
                          >
                            <Building2 className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{companyMap.get(item.companyId)?.name}</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-2 max-w-full">
                            <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate">{item.name}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {item.contactName ? (
                          <div className="space-y-0.5">
                            <div className="font-medium flex items-center gap-1 text-blue-600 dark:text-blue-400">
                              <User className="w-3 h-3 shrink-0" />
                              {item.contactName}
                            </div>
                            {item.contactEmail && (
                              <a href={`mailto:${item.contactEmail}`} className="text-blue-500/70 hover:text-blue-600 hover:underline flex items-center gap-1">
                                <Mail className="w-3 h-3 shrink-0" />
                                {item.contactEmail}
                              </a>
                            )}
                            {item.contactMobile && (
                              <a href={`tel:${item.contactMobile}`} className="text-blue-500/70 hover:text-blue-600 hover:underline flex items-center gap-1">
                                <Phone className="w-3 h-3 shrink-0" />
                                {item.contactMobile}
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="px-1.5 py-1 text-muted-foreground">
                        {item.requirementDate || "—"}
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        {item.groupName && (
                          <Badge className={`text-xs text-white ${
                            item.groupName === "Institutional" ? "bg-indigo-500" :
                            item.groupName === "Active Buyers" ? "bg-emerald-500" :
                            item.groupName === "Target Buyers" ? "bg-amber-500" :
                            "bg-slate-500"
                          }`}>
                            {item.groupName}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="px-1.5 py-1 text-center">
                        <ProgressTickCell
                          item={item}
                          onUpdate={(data) => inlineUpdate(item.id, data)}
                          testIdPrefix={`tick-inv-${item.id}`}
                        />
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        <InlineMultiSelect
                          value={item.use}
                          options={INVEST_USE_OPTIONS}
                          colorMap={CRM_OPTIONS.reqInvestmentUseColors}
                          onSave={(v) => inlineUpdate(item.id, { use: v })}
                          placeholder="Set use"
                          testId={`select-inv-use-${item.id}`}
                        />
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        <InlineMultiSelect
                          value={item.requirementType}
                          options={INVEST_TYPE_OPTIONS}
                          colorMap={CRM_OPTIONS.reqInvestmentTypeColors}
                          onSave={(v) => inlineUpdate(item.id, { requirementType: v })}
                          placeholder="Set type"
                          testId={`select-inv-type-${item.id}`}
                        />
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        <InlineMultiSelect
                          value={item.size}
                          options={INVEST_SIZE_OPTIONS}
                          colorMap={CRM_OPTIONS.reqInvestmentSizeColors}
                          onSave={(v) => inlineUpdate(item.id, { size: v })}
                          placeholder="Set size"
                          testId={`select-inv-size-${item.id}`}
                        />
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        <InlineMultiSelect
                          value={item.requirementLocations}
                          options={INVEST_LOCATION_OPTIONS}
                          colorMap={CRM_OPTIONS.reqInvestmentLocationsColors}
                          onSave={(v) => inlineUpdate(item.id, { requirementLocations: v })}
                          placeholder="Set location"
                          testId={`select-inv-loc-${item.id}`}
                        />
                        {invPropertyMatchMap.has(item.id) && (
                          <div className="flex flex-wrap gap-0.5 mt-1">
                            {invPropertyMatchMap.get(item.id)!.slice(0, 3).map(p => (
                              <Link key={p.id} href={`/properties/${p.id}`}>
                                <Badge variant="outline" className="text-[8px] gap-0.5 cursor-pointer hover:bg-muted border-blue-300 dark:border-blue-700" data-testid={`inv-prop-match-${item.id}-${p.id}`}>
                                  <Building2 className="w-2 h-2 text-blue-500" />{p.name}
                                </Badge>
                              </Link>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        <InlineMultiUserPicker
                          users={users}
                          currentUserIds={(item as any).bgpContactUserIds || []}
                          userMap={userMap}
                          onSelect={(userIds) => inlineUpdate(item.id, { bgpContactUserIds: userIds } as any)}
                          testIdPrefix={`bgp-contact-inv-${item.id}`}
                          colorMap={userIdColorMap}
                        />
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        <InlineText
                          value={item.comments || ""}
                          onSave={(v) => inlineUpdate(item.id, { comments: v || null })}
                          placeholder="Add comments..."
                          testId={`input-inv-comments-${item.id}`}
                          multiline
                          maxLines={2}
                        />
                      </TableCell>
                      <TableCell className="px-1 py-1">
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setEditItem(item)}
                            data-testid={`button-edit-invest-${item.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDeleteItem(item)}
                            data-testid={`button-delete-invest-${item.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                        <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No investment requirements found</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollableTable>
          )}
        </CardContent>
      </Card>

      <InvestmentFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(data) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
        title="Create Investment Requirement"
        groups={groups}
      />

      {editItem && (
        <InvestmentFormDialog
          open={!!editItem}
          onOpenChange={(open) => { if (!open) setEditItem(null); }}
          onSubmit={(data) => updateMutation.mutate({ id: editItem.id, data })}
          isPending={updateMutation.isPending}
          title="Edit Investment Requirement"
          defaultValues={editItem}
          groups={groups}
        />
      )}

      <Dialog open={!!deleteItem} onOpenChange={(open) => { if (!open) setDeleteItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Requirement</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteItem?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)} data-testid="button-cancel-delete-invest">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-invest"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvestmentFormDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending,
  title,
  defaultValues,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  isPending: boolean;
  title: string;
  defaultValues?: Partial<CrmRequirementsInvestment>;
  groups: string[];
}) {
  const [form, setForm] = useState({
    name: defaultValues?.name || "",
    groupName: defaultValues?.groupName || "",
    use: Array.isArray(defaultValues?.use) ? defaultValues.use.join(", ") : (defaultValues?.use || ""),
    requirementType: Array.isArray(defaultValues?.requirementType) ? defaultValues.requirementType.join(", ") : (defaultValues?.requirementType || ""),
    size: Array.isArray(defaultValues?.size) ? defaultValues.size.join(", ") : (defaultValues?.size || ""),
    locations: defaultValues?.locations || "",
    extract: defaultValues?.extract || "",
    contactName: defaultValues?.contactName || "",
    contactEmail: defaultValues?.contactEmail || "",
    contactMobile: defaultValues?.contactMobile || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      use: form.use ? form.use.split(",").map((s: string) => s.trim()).filter(Boolean) : null,
      requirementType: form.requirementType ? form.requirementType.split(",").map((s: string) => s.trim()).filter(Boolean) : null,
      size: form.size ? form.size.split(",").map((s: string) => s.trim()).filter(Boolean) : null,
      contactName: form.contactName || null,
      contactEmail: form.contactEmail || null,
      contactMobile: form.contactMobile || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              data-testid="input-invest-name"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Contact Name</Label>
              <Input
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                placeholder="e.g. John Smith"
                data-testid="input-invest-contact-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Contact Email</Label>
              <Input
                type="email"
                value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                placeholder="john@example.com"
                data-testid="input-invest-contact-email"
              />
            </div>
            <div className="space-y-2">
              <Label>Contact Mobile</Label>
              <Input
                type="tel"
                value={form.contactMobile}
                onChange={(e) => setForm({ ...form, contactMobile: e.target.value })}
                placeholder="07xxx xxxxxx"
                data-testid="input-invest-contact-mobile"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Group</Label>
              <Input
                value={form.groupName}
                onChange={(e) => setForm({ ...form, groupName: e.target.value })}
                data-testid="input-invest-group"
              />
            </div>
            <div className="space-y-2">
              <Label>Use</Label>
              <Input
                value={form.use}
                onChange={(e) => setForm({ ...form, use: e.target.value })}
                data-testid="input-invest-use"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Type</Label>
              <Input
                value={form.requirementType}
                onChange={(e) => setForm({ ...form, requirementType: e.target.value })}
                data-testid="input-invest-type"
              />
            </div>
            <div className="space-y-2">
              <Label>Size</Label>
              <Input
                value={form.size}
                onChange={(e) => setForm({ ...form, size: e.target.value })}
                data-testid="input-invest-size"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Locations</Label>
            <Input
              value={form.locations}
              onChange={(e) => setForm({ ...form, locations: e.target.value })}
              data-testid="input-invest-locations"
            />
          </div>
          <div className="space-y-2">
            <Label>Extract</Label>
            <Textarea
              value={form.extract}
              onChange={(e) => setForm({ ...form, extract: e.target.value })}
              data-testid="input-invest-extract"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !form.name} data-testid="button-submit-invest">
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Requirements() {
  const { activeTeam, userTeam } = useTeam();
  const urlParams = new URLSearchParams(window.location.search);
  const typeParam = urlParams.get("type");
  const teamParam = urlParams.get("team");
  const effectiveTeam = activeTeam === "all" ? userTeam : activeTeam;
  const defaultIsInvestment = effectiveTeam === "Investment";
  const initialView = typeParam ? typeParam === "investment" : defaultIsInvestment;
  const [isInvestmentView, setIsInvestmentView] = useState(initialView);

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="requirements-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Requirements</h1>
          <p className="text-sm text-muted-foreground">{isInvestmentView ? "Investment requirements" : "Leasing requirements"}{teamParam ? ` · Filtered by ${teamParam} team` : ""}</p>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1" data-testid="view-toggle">
          <button
            onClick={() => setIsInvestmentView(false)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${!isInvestmentView ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="button-leasing-view"
          >
            Leasing
          </button>
          <button
            onClick={() => setIsInvestmentView(true)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${isInvestmentView ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="button-investment-view"
          >
            Investment
          </button>
        </div>
      </div>

      {isInvestmentView ? <InvestmentTable teamFilter={teamParam} /> : <LeasingTable teamFilter={teamParam} />}
    </div>
  );
}

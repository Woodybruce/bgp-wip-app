import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Building2, MapPin, User, Phone, Mail, Calendar,
  AlertTriangle, ChevronRight, Trash2, Pencil, Search, ExternalLink,
} from "lucide-react";
import { Link } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TenantRepSearch {
  id: string;
  client_name: string;
  company_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  status: string;
  target_use: string[] | null;
  size_min: number | null;
  size_max: number | null;
  target_locations: string[] | null;
  budget_min: number | null;
  budget_max: number | null;
  next_action: string | null;
  next_action_date: string | null;
  notes: string | null;
  assigned_to: string | null;
  created_at: string;
  // joined fields
  company_name: string | null;
  company_domain: string | null;
  rollout_status: string | null;
  store_count: number | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_role: string | null;
  deal_name: string | null;
}

interface CrmCompany { id: string; name: string; domain: string | null; }
interface CrmContact { id: string; first_name: string; last_name: string; role: string | null; company_id: string | null; }

// ─── Constants ────────────────────────────────────────────────────────────────

const COLUMNS = [
  { key: "Brief Received",  label: "Brief Received",  color: "bg-rose-500",   light: "bg-rose-50 dark:bg-rose-950/30",   border: "border-rose-200 dark:border-rose-800" },
  { key: "Searching",       label: "Searching",       color: "bg-amber-500",  light: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-800" },
  { key: "Shortlisted",     label: "Shortlisted",     color: "bg-blue-500",   light: "bg-blue-50 dark:bg-blue-950/30",   border: "border-blue-200 dark:border-blue-800" },
  { key: "Viewing",         label: "Viewing",         color: "bg-purple-500", light: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-200 dark:border-purple-800" },
  { key: "Negotiating",     label: "Negotiating",     color: "bg-orange-500", light: "bg-orange-50 dark:bg-orange-950/30", border: "border-orange-200 dark:border-orange-800" },
  { key: "Complete",        label: "Complete",        color: "bg-emerald-500",light: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800" },
] as const;

const STATUS_KEYS = COLUMNS.map(c => c.key);

const ROLLOUT_LABELS: Record<string, string> = {
  entering_uk: "Entering UK",
  scaling: "Scaling",
  stable: "Stable",
  contracting: "Contracting",
  rumoured: "Rumoured",
};

const ROLLOUT_COLORS: Record<string, string> = {
  entering_uk: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  scaling: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  stable: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  contracting: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  rumoured: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
};

const USE_CLASSES = ["E", "E(a)", "E(b)", "E(c)", "E(d)", "E(e)", "A1", "A2", "A3", "A4", "A5", "F1", "F2", "Sui Generis"];

const LOCATIONS = [
  "London", "Birmingham", "Manchester", "Edinburgh", "Glasgow", "Bristol",
  "Leeds", "Liverpool", "Oxford", "Cambridge", "Bath", "Cardiff", "Dublin",
  "Paris", "Milan", "Amsterdam", "New York", "Los Angeles", "National",
];

const BGP_TEAM = ["Harry Elliot", "Rupert", "Lucy", "Sohail", "Woody", "Tom Cater"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(min: number | null, max: number | null): string {
  if (!min && !max) return "";
  if (min && max) return `${min.toLocaleString()}–${max.toLocaleString()} sq ft`;
  if (min) return `${min.toLocaleString()}+ sq ft`;
  return `Up to ${max!.toLocaleString()} sq ft`;
}

function formatBudget(min: number | null, max: number | null): string {
  if (!min && !max) return "";
  if (min && max) return `£${min}–£${max} psf`;
  if (min) return `£${min}+ psf`;
  return `Up to £${max!} psf`;
}

function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function getBrandLogoUrl(domain: string | null): string | null {
  if (!domain) return null;
  const clean = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return `https://logo.clearbit.com/${clean}`;
}

// ─── Empty form ───────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  clientName: "",
  companyId: "",
  contactId: "",
  dealId: "",
  status: "Brief Received" as string,
  targetUse: [] as string[],
  sizeMin: "",
  sizeMax: "",
  targetLocations: [] as string[],
  budgetMin: "",
  budgetMax: "",
  nextAction: "",
  nextActionDate: "",
  notes: "",
  assignedTo: "",
};

type FormState = typeof EMPTY_FORM;

// ─── Search card ──────────────────────────────────────────────────────────────

function SearchCard({
  search,
  onEdit,
  onDelete,
  onMoveStatus,
  colConfig,
}: {
  search: TenantRepSearch;
  onEdit: () => void;
  onDelete: () => void;
  onMoveStatus: (status: string) => void;
  colConfig: typeof COLUMNS[number];
}) {
  const overdue = isOverdue(search.next_action_date);
  const logoUrl = getBrandLogoUrl(search.company_domain);

  return (
    <Card className={`mb-2 cursor-pointer hover:shadow-md transition-shadow border ${colConfig.border}`} onClick={onEdit}>
      <CardContent className="p-3 space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                className="w-6 h-6 rounded object-contain flex-shrink-0 bg-white border"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-6 h-6 rounded bg-muted flex items-center justify-center flex-shrink-0">
                <Building2 className="w-3 h-3 text-muted-foreground" />
              </div>
            )}
            <span className="font-semibold text-sm truncate">{search.client_name}</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <button
              className="p-1 rounded hover:bg-muted text-muted-foreground"
              onClick={onEdit}
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Rollout status + store count */}
        {(search.rollout_status || search.store_count != null) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {search.rollout_status && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ROLLOUT_COLORS[search.rollout_status] ?? "bg-slate-100 text-slate-700"}`}>
                {ROLLOUT_LABELS[search.rollout_status] ?? search.rollout_status}
              </span>
            )}
            {search.store_count != null && (
              <span className="text-[10px] text-muted-foreground">{search.store_count} UK stores</span>
            )}
          </div>
        )}

        {/* Size + Budget */}
        {(search.size_min || search.size_max || search.budget_min || search.budget_max) && (
          <div className="space-y-0.5">
            {(search.size_min || search.size_max) && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                {formatSize(search.size_min, search.size_max)}
              </p>
            )}
            {(search.budget_min || search.budget_max) && (
              <p className="text-xs text-muted-foreground">
                {formatBudget(search.budget_min, search.budget_max)}
              </p>
            )}
          </div>
        )}

        {/* Locations */}
        {search.target_locations && search.target_locations.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {search.target_locations.slice(0, 3).map(loc => (
              <span key={loc} className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                <MapPin className="w-2.5 h-2.5" />{loc}
              </span>
            ))}
            {search.target_locations.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{search.target_locations.length - 3}</span>
            )}
          </div>
        )}

        {/* Contact */}
        {search.contact_name && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <User className="w-3 h-3" />
            <span className="truncate">{search.contact_name}</span>
            {search.contact_role && <span className="text-[10px] opacity-70">· {search.contact_role}</span>}
          </div>
        )}

        {/* Next action */}
        {search.next_action && (
          <div className={`text-xs flex items-start gap-1 rounded px-1.5 py-1 ${overdue ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400" : "bg-muted/60 text-muted-foreground"}`}>
            {overdue && <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />}
            <span className="flex-1 leading-tight">{search.next_action}</span>
            {search.next_action_date && (
              <span className="flex-shrink-0 flex items-center gap-0.5 text-[10px]">
                <Calendar className="w-2.5 h-2.5" />
                {formatDate(search.next_action_date)}
              </span>
            )}
          </div>
        )}

        {/* Move status */}
        <div className="flex items-center gap-1 pt-1" onClick={e => e.stopPropagation()}>
          {STATUS_KEYS.indexOf(search.status) > 0 && (
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
              onClick={() => onMoveStatus(STATUS_KEYS[STATUS_KEYS.indexOf(search.status) - 1])}
            >
              ← Back
            </button>
          )}
          <div className="flex-1" />
          {STATUS_KEYS.indexOf(search.status) < STATUS_KEYS.length - 1 && (
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
              onClick={() => onMoveStatus(STATUS_KEYS[STATUS_KEYS.indexOf(search.status) + 1])}
            >
              Next <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Multi-select helper ──────────────────────────────────────────────────────

function MultiSelect({
  label, options, value, onChange,
}: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt]);
  return (
    <div>
      <Label className="text-xs mb-1.5 block">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              value.includes(opt)
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-input hover:bg-muted"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TenantRep() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TenantRepSearch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TenantRepSearch | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [logoErrors, setLogoErrors] = useState<Set<string>>(new Set());

  const { data: searches = [], isLoading } = useQuery<TenantRepSearch[]>({
    queryKey: ["/api/tenant-rep/searches"],
    queryFn: () => fetch("/api/tenant-rep/searches", { headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` } }).then(r => r.json()),
  });

  const { data: companiesRes } = useQuery<{ data: CrmCompany[] } | CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
    queryFn: () => fetch("/api/crm/companies?limit=500", { headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` } }).then(r => r.json()),
  });
  const companies: CrmCompany[] = Array.isArray(companiesRes) ? companiesRes : (companiesRes as any)?.data ?? [];

  const { data: contactsRes } = useQuery<{ data: CrmContact[] } | CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
    queryFn: () => fetch("/api/crm/contacts?limit=500", { headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` } }).then(r => r.json()),
  });
  const contacts: CrmContact[] = Array.isArray(contactsRes) ? contactsRes : (contactsRes as any)?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (data: Partial<FormState>) => apiRequest("POST", "/api/tenant-rep/searches", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/tenant-rep/searches"] }); setDialogOpen(false); toast({ title: "Search added" }); },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/tenant-rep/searches/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/tenant-rep/searches"] }); setDialogOpen(false); toast({ title: "Updated" }); },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/tenant-rep/searches/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/tenant-rep/searches"] }); setDeleteTarget(null); toast({ title: "Deleted" }); },
  });

  const openCreate = (defaultStatus?: string) => {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM, status: defaultStatus ?? "Brief Received" });
    setDialogOpen(true);
  };

  const openEdit = (s: TenantRepSearch) => {
    setEditTarget(s);
    setForm({
      clientName: s.client_name,
      companyId: s.company_id ?? "",
      contactId: s.contact_id ?? "",
      dealId: s.deal_id ?? "",
      status: s.status,
      targetUse: s.target_use ?? [],
      sizeMin: s.size_min?.toString() ?? "",
      sizeMax: s.size_max?.toString() ?? "",
      targetLocations: s.target_locations ?? [],
      budgetMin: s.budget_min?.toString() ?? "",
      budgetMax: s.budget_max?.toString() ?? "",
      nextAction: s.next_action ?? "",
      nextActionDate: s.next_action_date ?? "",
      notes: s.notes ?? "",
      assignedTo: s.assigned_to ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    const payload = {
      clientName: form.clientName,
      companyId: form.companyId || null,
      contactId: form.contactId || null,
      dealId: form.dealId || null,
      status: form.status,
      targetUse: form.targetUse.length ? form.targetUse : null,
      sizeMin: form.sizeMin ? parseInt(form.sizeMin) : null,
      sizeMax: form.sizeMax ? parseInt(form.sizeMax) : null,
      targetLocations: form.targetLocations.length ? form.targetLocations : null,
      budgetMin: form.budgetMin ? parseInt(form.budgetMin) : null,
      budgetMax: form.budgetMax ? parseInt(form.budgetMax) : null,
      nextAction: form.nextAction || null,
      nextActionDate: form.nextActionDate || null,
      notes: form.notes || null,
      assignedTo: form.assignedTo || null,
    };
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const moveStatus = (id: string, status: string) => {
    updateMutation.mutate({ id, data: { status } });
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return searches;
    const q = search.toLowerCase();
    return searches.filter(s =>
      s.client_name.toLowerCase().includes(q) ||
      (s.company_name ?? "").toLowerCase().includes(q) ||
      (s.target_locations ?? []).join(" ").toLowerCase().includes(q) ||
      (s.next_action ?? "").toLowerCase().includes(q) ||
      (s.assigned_to ?? "").toLowerCase().includes(q)
    );
  }, [searches, search]);

  const columnSearches = (colKey: string) => filtered.filter(s => s.status === colKey);

  // Contacts filtered to selected company
  const filteredContacts = form.companyId
    ? contacts.filter(c => c.company_id === form.companyId)
    : contacts;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">Tenant Rep</h1>
          <p className="text-xs text-muted-foreground">
            {searches.length} active {searches.length === 1 ? "search" : "searches"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm w-48"
            />
          </div>
          <Button size="sm" onClick={() => openCreate()} className="gap-1.5">
            <Plus className="w-4 h-4" />
            New Search
          </Button>
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-auto">
        <div className="flex gap-3 p-4 min-h-full" style={{ minWidth: `${COLUMNS.length * 280 + (COLUMNS.length - 1) * 12 + 32}px` }}>
          {COLUMNS.map(col => {
            const colSearches = columnSearches(col.key);
            return (
              <div key={col.key} className="flex flex-col w-[268px] shrink-0">
                {/* Column header */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg ${col.light} border ${col.border} border-b-0`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${col.color}`} />
                    <span className="text-xs font-semibold">{col.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                      {colSearches.length}
                    </Badge>
                    <button
                      className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                      onClick={() => openCreate(col.key)}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Cards */}
                <div className={`flex-1 rounded-b-lg border ${col.border} p-2 min-h-[400px] ${col.light}`}>
                  {isLoading ? (
                    <div className="space-y-2">
                      {[1, 2].map(i => (
                        <div key={i} className="h-24 rounded-lg bg-muted/60 animate-pulse" />
                      ))}
                    </div>
                  ) : colSearches.length === 0 ? (
                    <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">
                      No searches
                    </div>
                  ) : (
                    colSearches.map(s => (
                      <SearchCard
                        key={s.id}
                        search={s}
                        colConfig={col}
                        onEdit={() => openEdit(s)}
                        onDelete={() => setDeleteTarget(s)}
                        onMoveStatus={status => moveStatus(s.id, status)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit Search" : "New Tenant Rep Search"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Client / Brand */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Client Name *</Label>
                <Input
                  placeholder="e.g. Lululemon"
                  value={form.clientName}
                  onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">CRM Brand (optional)</Label>
                <Select
                  value={form.companyId}
                  onValueChange={v => setForm(f => ({ ...f, companyId: v, contactId: "" }))}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Link to CRM company..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">— None —</SelectItem>
                    {companies.slice(0, 200).map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Status + Assigned */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_KEYS.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Assigned To</Label>
                <Select value={form.assignedTo} onValueChange={v => setForm(f => ({ ...f, assignedTo: v }))}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select person..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">— Unassigned —</SelectItem>
                    {BGP_TEAM.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Contact */}
            <div>
              <Label className="text-xs mb-1.5 block">Key Contact</Label>
              <Select
                value={form.contactId}
                onValueChange={v => setForm(f => ({ ...f, contactId: v }))}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select contact..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— None —</SelectItem>
                  {filteredContacts.slice(0, 200).map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.first_name} {c.last_name}{c.role ? ` · ${c.role}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Size */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Min Size (sq ft)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 2000"
                  value={form.sizeMin}
                  onChange={e => setForm(f => ({ ...f, sizeMin: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Max Size (sq ft)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 5000"
                  value={form.sizeMax}
                  onChange={e => setForm(f => ({ ...f, sizeMax: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            {/* Budget */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Min Budget (£psf)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 100"
                  value={form.budgetMin}
                  onChange={e => setForm(f => ({ ...f, budgetMin: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Max Budget (£psf)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 250"
                  value={form.budgetMax}
                  onChange={e => setForm(f => ({ ...f, budgetMax: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            {/* Use classes */}
            <MultiSelect
              label="Target Use Class"
              options={USE_CLASSES}
              value={form.targetUse}
              onChange={v => setForm(f => ({ ...f, targetUse: v }))}
            />

            {/* Locations */}
            <MultiSelect
              label="Target Locations"
              options={LOCATIONS}
              value={form.targetLocations}
              onChange={v => setForm(f => ({ ...f, targetLocations: v }))}
            />

            {/* Next action */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Next Action</Label>
                <Input
                  placeholder="e.g. Send shortlist to client"
                  value={form.nextAction}
                  onChange={e => setForm(f => ({ ...f, nextAction: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Action Date</Label>
                <Input
                  type="date"
                  value={form.nextActionDate}
                  onChange={e => setForm(f => ({ ...f, nextActionDate: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <Label className="text-xs mb-1.5 block">Notes</Label>
              <Textarea
                placeholder="Any additional notes..."
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="text-sm min-h-[80px]"
              />
            </div>

            {/* Links to CRM */}
            {editTarget && (editTarget.company_id || editTarget.deal_id || editTarget.contact_id) && (
              <div className="flex items-center gap-3 pt-1 border-t">
                <span className="text-xs text-muted-foreground">Quick links:</span>
                {editTarget.company_id && (
                  <Link href={`/companies/${editTarget.company_id}`}>
                    <a className="text-xs text-primary flex items-center gap-1 hover:underline" target="_blank">
                      <Building2 className="w-3 h-3" />
                      {editTarget.company_name ?? "Brand"}
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </Link>
                )}
                {editTarget.deal_id && (
                  <Link href={`/deals/${editTarget.deal_id}`}>
                    <a className="text-xs text-primary flex items-center gap-1 hover:underline" target="_blank">
                      Deal <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </Link>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={!form.clientName.trim() || createMutation.isPending || updateMutation.isPending}
            >
              {editTarget ? "Save Changes" : "Add Search"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete search?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the search for <strong>{deleteTarget?.client_name}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

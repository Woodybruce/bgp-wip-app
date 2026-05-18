import { useState, useCallback, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Building2, Upload, Download, Plus, Trash2, Search, ChevronDown, ChevronRight,
  Link2, FileSpreadsheet, X, Loader2, Lock, ExternalLink, MapPin as MapPinIcon,
  Eye
} from "lucide-react";

interface TenancyUnit {
  id: number | string;
  property_id: string;
  // Unit Details
  grouping: string | null;
  floor_level: string | null;
  premises: string;
  unit_number: string;
  permitted_use: string;
  status: string;
  am_initiative: string | null;
  // Covenant
  credit_rating: string | null;
  deposit_held: number | null;
  arrears_balance: number | null;
  // Tenant Details
  tenant_name: string;
  trading_name: string;
  tenant_mix: string | null;
  // crm_companies join — populated by the server when tenant_name or
  // trading_name matches a row in crm_companies (lowercased trim).
  resolved_tenant_company_id?: string | null;
  resolved_tenant_company_name?: string | null;
  // Lease Details
  lease_start: string;
  break_date: string;
  // T / L / M — Tenant / Landlord / Mutual break.
  break_type?: string | null;
  break_details: string | null;
  break_notice: string | null;
  lease_expiry: string;
  term_years: number;
  unexpired_term_break: number | null;
  unexpired_term: number;
  next_review_date: string | null;
  outside_lt_act: string;
  measurement_type: string | null;
  // Areas — GIA per floor
  area_basement_gia: number | null;
  area_ground_gia: number | null;
  area_first_gia: number | null;
  area_other_gia: number | null;
  // Areas — NIA per floor
  area_basement_nia: number | null;
  area_ground_nia: number | null;
  area_first_nia: number | null;
  area_first_sales_nia: number | null;
  area_other_nia: number | null;
  // Areas — ITZA / totals
  area_ground_itza: number | null;
  gia_sqft: number;
  nia_sqft: number;
  itza_sqft: number | null;
  units_applied: number | null;
  // Rental Income
  passing_rent_pa: number;
  marketing_rent_pa: number | null;
  turnover_rent_payable: number | null;
  erv_profile: string | null;
  erv_pa: number;
  rent_free_value: number | null;
  capex_value: number | null;
  // Rates
  rateable_value: number | null;
  rates_payable: number | null;
  // Occupational Costs
  service_charge: number;
  service_charge_cap: number | null;
  insurance: number;
  // Shortfalls
  shortfall_liability: string | null;
  rental_shortfalls: number | null;
  // NOI
  topped_up_noi: number | null;
  noi_pa: number | null;
  // Comments
  comments: string | null;
  leasing_comments: string | null;
  target_tenants: string | null;
  target_company_ids: string[] | null;
  underwriting_comments: string | null;
  // BGP integration
  epc_rating: string;
  rent_psf: number;
  turnover_percent: number;
  blended_erv: number;
  deal_id: string | null;
  deal_ref?: string | null;
  letting_tracker_unit_id: string | null;
  in_leasing_schedule: boolean;
  sort_order: number;
  // Synthetic — set true when this row is a vacant derived from
  // available_units (no real tenancy_schedule_units row backing it).
  is_vacant?: boolean;
  available_unit_id?: string | null;
}

interface DealLink {
  id: string;
  name: string;
  status: string;
  tenant_id: string;
  rent_pa: number;
}

interface LettingLink {
  id: string;
  unit_name: string;
  marketing_status: string;
  dealId: string | null;
}

function fmtCurrency(v: number | string) {
  const n = Number(v);
  if (!n) return "—";
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtNum(v: number | string | null | undefined, dp = 0) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtDate(v: string) {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return v; }
}

// Full set of data columns rendered in the table — mirrors the Landsec
// tenancy schedule template grouped by category band. Functional columns
// (chevron / status / links / delete) live outside this config.
type ColType = "text" | "num" | "currency" | "currency_psf" | "date";
interface Col { field: keyof TenancyUnit; label: string; band: string; width: number; align?: "left" | "right" | "center"; type?: ColType }

const BAND_COLOURS: Record<string, string> = {
  "Unit Details": "bg-slate-700 text-white",
  "Tenant Details": "bg-slate-700 text-white",
  "Lease Details": "bg-slate-700 text-white",
  // GIA / NIA share the slate family but at different tints so the eye can
  // separate gross vs net area at a glance.
  "Areas — GIA": "bg-slate-600 text-white",
  "Areas — NIA": "bg-stone-600 text-white",
  "Areas — Totals": "bg-slate-700 text-white",
  "Rental Income": "bg-emerald-800 text-white",
  "MLA": "bg-emerald-800 text-white",
  "Occupational Costs": "bg-amber-800 text-white",
  "Shortfalls": "bg-rose-800 text-white",
  "NOI": "bg-emerald-900 text-white",
  "Covenant": "bg-indigo-800 text-white",
  "Comments": "bg-zinc-700 text-white",
};

const COLUMNS: Col[] = [
  { field: "grouping",         label: "Zone",           band: "Unit Details", width: 110, align: "left" },
  { field: "floor_level" as any, label: "Floor",        band: "Unit Details", width: 110, align: "left" },
  { field: "unit_number",      label: "Unit",           band: "Unit Details", width: 90,  align: "left" },
  { field: "permitted_use",    label: "Use",            band: "Unit Details", width: 120, align: "left" },
  { field: "status",           label: "Status",         band: "Unit Details", width: 90,  align: "left" },
  { field: "am_initiative",    label: "AM Initiative?", band: "Unit Details", width: 130, align: "left" },
  { field: "tenant_name",      label: "Tenant",         band: "Tenant Details", width: 160, align: "left" },
  { field: "trading_name",     label: "Trading As",     band: "Tenant Details", width: 140, align: "left" },
  { field: "lease_start",      label: "Start",          band: "Lease Details", width: 100, align: "center", type: "date" },
  // Break Date cell renders a T/L/M chip alongside the date (see UnitRow).
  { field: "break_date",       label: "Break Date",     band: "Lease Details", width: 140, align: "center", type: "date" },
  // Break Notice is now the date by which break notice has to be served.
  { field: "break_notice",     label: "Break Notice",   band: "Lease Details", width: 100, align: "center", type: "date" },
  { field: "lease_expiry",     label: "Expiry",         band: "Lease Details", width: 100, align: "center", type: "date" },
  { field: "term_years",       label: "Term",           band: "Lease Details", width: 70,  align: "right", type: "num" },
  { field: "unexpired_term_break", label: "Unexp (Break)", band: "Lease Details", width: 90, align: "right", type: "num" },
  { field: "unexpired_term",   label: "Unexp (Expiry)", band: "Lease Details", width: 90,  align: "right", type: "num" },
  { field: "next_review_date", label: "Next Review",    band: "Lease Details", width: 100, align: "center", type: "date" },
  { field: "outside_lt_act",   label: "L&T Act",        band: "Lease Details", width: 100, align: "left" },
  { field: "area_basement_gia", label: "Basement",      band: "Areas — GIA", width: 90,  align: "right", type: "num" },
  { field: "area_ground_gia",   label: "Ground",        band: "Areas — GIA", width: 90,  align: "right", type: "num" },
  { field: "area_first_gia",    label: "First",         band: "Areas — GIA", width: 90,  align: "right", type: "num" },
  { field: "area_other_gia",    label: "Other",         band: "Areas — GIA", width: 90,  align: "right", type: "num" },
  { field: "area_basement_nia", label: "Basement",      band: "Areas — NIA", width: 90,  align: "right", type: "num" },
  { field: "area_ground_nia",   label: "Ground",        band: "Areas — NIA", width: 90,  align: "right", type: "num" },
  { field: "area_ground_itza",  label: "Ground ITZA",   band: "Areas — NIA", width: 90,  align: "right", type: "num" },
  { field: "area_first_sales_nia", label: "First Sales", band: "Areas — NIA", width: 90, align: "right", type: "num" },
  { field: "area_first_nia",    label: "First",         band: "Areas — NIA", width: 90,  align: "right", type: "num" },
  { field: "area_other_nia",    label: "Other",         band: "Areas — NIA", width: 90,  align: "right", type: "num" },
  { field: "gia_sqft",          label: "GIA",           band: "Areas — Totals", width: 90, align: "right", type: "num" },
  { field: "nia_sqft",          label: "NIA",           band: "Areas — Totals", width: 90, align: "right", type: "num" },
  { field: "itza_sqft",         label: "ITZA",          band: "Areas — Totals", width: 90, align: "right", type: "num" },
  { field: "passing_rent_pa",   label: "Rent (pa)",     band: "Rental Income", width: 110, align: "right", type: "currency" },
  { field: "marketing_rent_pa", label: "Marketing Rent", band: "Rental Income", width: 120, align: "right", type: "currency" },
  { field: "turnover_rent_payable", label: "T/O Rent",  band: "Rental Income", width: 110, align: "right", type: "currency" },
  { field: "erv_profile",       label: "ERV Profile",   band: "Rental Income", width: 100, align: "left" },
  { field: "erv_pa",            label: "ERV (pa)",      band: "Rental Income", width: 110, align: "right", type: "currency" },
  { field: "rent_free_value",   label: "Rent Free",     band: "Rental Income", width: 110, align: "right", type: "currency" },
  { field: "capex_value",       label: "Capex",         band: "Rental Income", width: 110, align: "right", type: "currency" },
  { field: "rateable_value",    label: "Rateable Value", band: "MLA", width: 120, align: "right", type: "currency" },
  { field: "rates_payable",     label: "Rates Payable",  band: "MLA", width: 120, align: "right", type: "currency" },
  { field: "service_charge",    label: "Service Charge", band: "Occupational Costs", width: 120, align: "right", type: "currency" },
  { field: "service_charge_cap", label: "SC Cap",       band: "Occupational Costs", width: 100, align: "right", type: "currency" },
  { field: "insurance",         label: "Insurance",     band: "Occupational Costs", width: 110, align: "right", type: "currency" },
  { field: "shortfall_liability", label: "Liability (L/T)", band: "Shortfalls", width: 110, align: "left" },
  { field: "rental_shortfalls",   label: "Total LL Shortfalls", band: "Shortfalls", width: 140, align: "right", type: "currency" },
  { field: "topped_up_noi",     label: "Topped Up NOI", band: "NOI", width: 120, align: "right", type: "currency" },
  { field: "noi_pa",            label: "NOI (pa)",      band: "NOI", width: 110, align: "right", type: "currency" },
  { field: "credit_rating" as any,   label: "Credit Check Rating", band: "Covenant", width: 130, align: "left" },
  { field: "deposit_held" as any,    label: "Deposit Held",        band: "Covenant", width: 110, align: "right", type: "currency" },
  { field: "arrears_balance" as any, label: "Arrears",             band: "Covenant", width: 110, align: "right", type: "currency" },
  { field: "comments",          label: "Comments",      band: "Comments", width: 200, align: "left" },
  { field: "leasing_comments",  label: "Leasing Comments", band: "Comments", width: 200, align: "left" },
  { field: "target_tenants",    label: "Target Tenants", band: "Comments", width: 180, align: "left" },
  { field: "underwriting_comments", label: "Underwriting Comments", band: "Comments", width: 200, align: "left" },
];

// Small inline T / L / M chip that sits next to the break date — cycles
// through Tenant / Landlord / Mutual via a native select. Tinted so the
// party-to-break is readable at a glance.
function BreakTypeChip({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const tint =
    value === "T" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" :
    value === "L" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" :
    value === "M" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" :
    "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400";
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className={`text-[10px] rounded border-0 px-1 py-0 font-semibold cursor-pointer ${tint}`}
      title="Break party: Tenant / Landlord / Mutual"
    >
      <option value="">—</option>
      <option value="T">T</option>
      <option value="L">L</option>
      <option value="M">M</option>
    </select>
  );
}

function InlineEdit({ value, field, unitId, onSave, type = "text", options, className = "" }: {
  value: string; field: string; unitId: string | number; onSave: (id: string | number, field: string, val: string) => void;
  type?: string; options?: string[]; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  // Date fields use the caller-passed type="date" rather than relying on
  // field-name pattern matching — covers lease_expiry / break_date /
  // landlord_break_date / next_review_date / lease_start in one go.
  const isDate = type === "date";
  const isNumber = type === "number";
  const isSelect = type === "select" && options && options.length > 0;

  if (!editing) {
    let display: string;
    if (isDate) {
      display = value ? fmtDate(value) : "—";
    } else if (isNumber) {
      if (field.includes("rent") || field.includes("income") || field.includes("charge") || field.includes("insurance") || field.includes("occ_costs") || field.includes("erv") || field.includes("shortfall")) {
        display = fmtCurrency(value);
      } else {
        display = fmtNum(value, field.includes("psf") || field.includes("percent") || field.includes("term") ? 2 : 0);
      }
    } else {
      display = value || "—";
    }
    return (
      <span
        className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 px-1 rounded text-xs ${className}`}
        onClick={() => { setVal(value || ""); setEditing(true); setTimeout(() => (isSelect ? selectRef.current?.focus() : inputRef.current?.focus()), 50); }}
        data-testid={`tenancy-cell-${field}-${unitId}`}
      >
        {display}
      </span>
    );
  }

  if (isSelect) {
    return (
      <select
        ref={selectRef}
        value={val}
        onChange={(e) => { setVal(e.target.value); setEditing(false); if (e.target.value !== (value || "")) onSave(unitId, field, e.target.value); }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
        className="h-6 text-xs px-1 py-0 w-full border rounded bg-white dark:bg-gray-700"
        data-testid={`tenancy-input-${field}-${unitId}`}
      >
        <option value="">—</option>
        {options!.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <Input
      ref={inputRef}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { setEditing(false); if (val !== (value || "")) onSave(unitId, field, val); }}
      onKeyDown={(e) => { if (e.key === "Enter") { setEditing(false); if (val !== (value || "")) onSave(unitId, field, val); } if (e.key === "Escape") setEditing(false); }}
      className="h-6 text-xs px-1 py-0 w-full"
      type={isDate ? "date" : isNumber ? "number" : "text"}
      data-testid={`tenancy-input-${field}-${unitId}`}
    />
  );
}

export function PropertyTenancySchedule({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set(["__all__"]));
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // When already on the dedicated full-board route the "Full Board" link is
  // redundant — hide it. The route is /tenancy-schedule/:propertyId.
  const onFullBoard = location === `/tenancy-schedule/${propertyId}`;

  // Column visibility — Set of hidden field names, persisted per property.
  const hiddenStorageKey = `tenancy-hidden-cols:${propertyId}`;
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(hiddenStorageKey);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem(hiddenStorageKey, JSON.stringify([...hiddenFields])); } catch {}
  }, [hiddenStorageKey, hiddenFields]);
  const toggleColumn = (field: string) => {
    setHiddenFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field); else next.add(field);
      return next;
    });
  };
  const visibleColumns = COLUMNS.filter(c => !hiddenFields.has(c.field as string));

  const { data: units = [], isLoading, error: unitsError } = useQuery<TenancyUnit[]>({
    queryKey: ["/api/tenancy-schedule/property", propertyId],
    queryFn: async () => {
      const r = await fetch(`/api/tenancy-schedule/property/${propertyId}`, { headers: getAuthHeaders() });
      if (r.status === 403) throw new Error("ACCESS_DENIED");
      if (!r.ok) throw new Error("LOAD_FAILED");
      return r.json();
    },
    enabled: !!propertyId,
    retry: false,
  });

  const { data: links } = useQuery<{ deals: DealLink[]; lettingUnits: LettingLink[] }>({
    queryKey: ["/api/tenancy-schedule/property", propertyId, "links"],
    queryFn: async () => {
      const r = await fetch(`/api/tenancy-schedule/property/${propertyId}/links`, { headers: getAuthHeaders() });
      if (!r.ok) return { deals: [], lettingUnits: [] };
      return r.json();
    },
    enabled: !!propertyId,
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/tenancy-schedule/unit/${data.id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] }); },
    onError: (err: any) => { toast({ title: "Update failed", description: err.message, variant: "destructive" }); },
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/tenancy-schedule/unit", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
      setShowAddUnit(false);
      toast({ title: "Unit added" });
    },
    onError: (err: any) => { toast({ title: "Failed to add unit", description: err.message, variant: "destructive" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string | number) => apiRequest("DELETE", `/api/tenancy-schedule/unit/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
      toast({ title: "Unit removed" });
    },
    onError: (err: any) => { toast({ title: "Failed to delete unit", description: err.message, variant: "destructive" }); },
  });

  const inlineUpdate = useCallback((unitId: string | number, field: string, value: string) => {
    updateMutation.mutate({ id: unitId, [field]: value });
  }, [updateMutation]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("propertyId", propertyId);
      formData.append("clearExisting", units.length > 0 ? "true" : "false");
      const r = await fetch("/api/tenancy-schedule/import-excel", {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
        credentials: "include",
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      toast({ title: "Import complete", description: result.message });
      queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExport = async () => {
    try {
      const r = await fetch(`/api/tenancy-schedule/property/${propertyId}/export-excel`, { headers: getAuthHeaders() });
      if (!r.ok) throw new Error("Export failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = r.headers.get("content-disposition");
      a.download = cd?.match(/filename="(.+)"/)?.[1] || "Tenancy_Schedule.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Excel exported" });
    } catch { toast({ title: "Export failed", variant: "destructive" }); }
  };

  const toggleZone = (zone: string) => {
    setExpandedZones(prev => {
      const next = new Set(prev);
      if (next.has(zone)) next.delete(zone); else next.add(zone);
      return next;
    });
  };

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading tenancy schedule...</div>;

  if (unitsError) {
    const isAccessDenied = (unitsError as Error)?.message === "ACCESS_DENIED";
    return (
      <div className="space-y-3" data-testid="property-tenancy-schedule">
        <div className="text-center py-6 text-gray-400 border rounded-lg">
          <Lock className="w-6 h-6 mx-auto mb-1 opacity-40" />
          <p className="text-xs">{isAccessDenied ? "Access restricted" : "Failed to load"}</p>
        </div>
      </div>
    );
  }

  const filtered = units.filter(u => {
    if (statusFilter && u.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return [u.unit_number, u.tenant_name, u.trading_name, u.premises, u.permitted_use].some(f => f?.toLowerCase().includes(s));
    }
    return true;
  });

  const zones = [...new Set(filtered.map(u => u.premises || "Unassigned"))];
  const occupied = units.filter(u => u.status === "Occupied").length;
  const vacant = units.filter(u => u.status === "Vacant").length;
  const totalNIA = units.reduce((s, u) => s + Number(u.nia_sqft || 0), 0);
  const totalRent = units.reduce((s, u) => s + Number(u.passing_rent_pa || 0), 0);
  const totalSC = units.reduce((s, u) => s + Number(u.service_charge || 0), 0);
  const avgERV = units.length ? units.reduce((s, u) => s + Number(u.blended_erv || 0), 0) / units.length : 0;
  const avgWAULT = units.filter(u => Number(u.unexpired_term) > 0).length
    ? units.filter(u => Number(u.unexpired_term) > 0).reduce((s, u) => s + Number(u.unexpired_term), 0) / units.filter(u => Number(u.unexpired_term) > 0).length
    : 0;

  const matchDeal = (unit: TenancyUnit): DealLink | undefined => {
    if (unit.deal_id) return links?.deals.find(d => d.id === unit.deal_id);
    return links?.deals.find(d => d.name?.toLowerCase().includes(unit.unit_number?.toLowerCase()) || d.name?.toLowerCase().includes(unit.trading_name?.toLowerCase()));
  };

  const matchLetting = (unit: TenancyUnit): LettingLink | undefined => {
    if (unit.letting_tracker_unit_id) return links?.lettingUnits.find(l => l.id === unit.letting_tracker_unit_id);
    return links?.lettingUnits.find(l => l.unit_name?.toLowerCase().includes(unit.unit_number?.toLowerCase()));
  };

  if (units.length === 0 && !showAddUnit) {
    return (
      <div className="space-y-3" data-testid="property-tenancy-schedule">
        <div className="flex items-center justify-end">
          <div className="flex gap-2">
            <input type="file" ref={fileInputRef} accept=".xlsx,.xls" onChange={handleImport} className="hidden" />
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fileInputRef.current?.click()} disabled={importing} data-testid="btn-import-tenancy">
              {importing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Upload className="w-3 h-3 mr-1" />}Import Excel
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddUnit(true)} data-testid="btn-add-tenancy-unit">
              <Plus className="w-3 h-3 mr-1" />Add Unit
            </Button>
            {!onFullBoard && (
              <Link href={`/tenancy-schedule/${propertyId}`}>
                <span className="text-[10px] text-indigo-500 hover:underline flex items-center gap-1 cursor-pointer" data-testid="link-tenancy-full-board">
                  <ExternalLink className="w-3 h-3" />Full Board
                </span>
              </Link>
            )}
          </div>
        </div>
        <div className="text-center py-8 text-gray-400 border rounded-lg border-dashed">
          <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-xs">No tenancy schedule data</p>
          <p className="text-xs mt-1">Import an Excel tenancy schedule or add units manually</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="property-tenancy-schedule">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Badge variant="secondary" className="text-[10px]">{units.length} units</Badge>
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="h-7 text-xs pl-7 w-40" data-testid="tenancy-search" />
          </div>
          <input type="file" ref={fileInputRef} accept=".xlsx,.xls" onChange={handleImport} className="hidden" />
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fileInputRef.current?.click()} disabled={importing} data-testid="btn-import-tenancy">
            {importing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Upload className="w-3 h-3 mr-1" />}Import
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExport} data-testid="btn-export-tenancy">
            <Download className="w-3 h-3 mr-1" />Excel
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddUnit(true)} data-testid="btn-add-tenancy-unit">
            <Plus className="w-3 h-3 mr-1" />Add
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="btn-tenancy-columns">
                <Eye className="w-3 h-3 mr-1" />Columns
                {hiddenFields.size > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px]">{hiddenFields.size} hidden</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 max-h-[60vh] overflow-y-auto p-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold">Show / hide columns</span>
                {hiddenFields.size > 0 && (
                  <button
                    className="text-[10px] text-indigo-500 hover:underline"
                    onClick={() => setHiddenFields(new Set())}
                    data-testid="btn-tenancy-columns-reset"
                  >
                    Reset
                  </button>
                )}
              </div>
              {(() => {
                const byBand = new Map<string, Col[]>();
                for (const c of COLUMNS) {
                  if (!byBand.has(c.band)) byBand.set(c.band, []);
                  byBand.get(c.band)!.push(c);
                }
                return [...byBand.entries()].map(([band, cols]) => (
                  <div key={band} className="mb-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{band}</div>
                    <div className="space-y-1 pl-1">
                      {cols.map(c => (
                        <label
                          key={c.field as string}
                          className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1 py-0.5"
                          data-testid={`tenancy-col-toggle-${c.field as string}`}
                        >
                          <Checkbox
                            checked={!hiddenFields.has(c.field as string)}
                            onCheckedChange={() => toggleColumn(c.field as string)}
                          />
                          <span>{c.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </PopoverContent>
          </Popover>
          {!onFullBoard && (
            <Link href={`/tenancy-schedule/${propertyId}`}>
              <span className="text-[10px] text-indigo-500 hover:underline flex items-center gap-1 cursor-pointer ml-1" data-testid="link-tenancy-full-board">
                <ExternalLink className="w-3 h-3" />Full Board
              </span>
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {[
          { label: "Total NIA", value: fmtNum(totalNIA) + " sqft", filter: null },
          { label: "Passing Rent", value: fmtCurrency(totalRent), filter: null },
          { label: "Avg ERV £psf", value: fmtNum(avgERV, 0), filter: null },
          { label: "WAULT", value: fmtNum(avgWAULT, 1) + " yrs", filter: null },
          { label: "Occupied", value: String(occupied), filter: "Occupied" },
          { label: "Vacant", value: String(vacant), filter: "Vacant" },
          { label: "Service Charge", value: fmtCurrency(totalSC), filter: null },
        ].map(s => (
          <div
            key={s.label}
            className={`bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-center ${s.filter ? "cursor-pointer hover:ring-1 ring-blue-400" : ""} ${statusFilter === s.filter ? "ring-2 ring-blue-500" : ""}`}
            onClick={() => s.filter && setStatusFilter(statusFilter === s.filter ? null : s.filter)}
            data-testid={`tenancy-stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}
          >
            <div className="text-[10px] text-gray-500 uppercase">{s.label}</div>
            <div className="text-sm font-semibold">{s.value}</div>
          </div>
        ))}
      </div>

      {showAddUnit && (
        <AddTenancyUnitForm
          propertyId={propertyId}
          onAdd={(data) => addMutation.mutate(data)}
          onCancel={() => setShowAddUnit(false)}
          isPending={addMutation.isPending}
        />
      )}

      <div className="overflow-x-auto border rounded-lg">
        <table className="text-xs" style={{ minWidth: 100 + visibleColumns.reduce((s, c) => s + c.width, 0) + 200 }}>
          <thead>
            {/* Category-band row — one cell per contiguous band, merged via
                colSpan so the bands mirror the Landsec sheet layout. */}
            <tr>
              {(() => {
                const bands: Array<{ name: string; span: number }> = [];
                for (const c of visibleColumns) {
                  const last = bands[bands.length - 1];
                  if (last && last.name === c.band) last.span++;
                  else bands.push({ name: c.band, span: 1 });
                }
                return bands.map((b, i) => (
                  <th key={i} colSpan={b.span} className={`p-1.5 font-semibold text-[10px] uppercase tracking-wider text-center ${BAND_COLOURS[b.name] || "bg-slate-700 text-white"}`}>
                    {b.name}
                  </th>
                ));
              })()}
              <th colSpan={3} className="bg-slate-800 text-white p-1.5 font-semibold text-[10px] uppercase tracking-wider text-center">Actions</th>
            </tr>
            {/* Column labels */}
            <tr className="bg-gray-100 dark:bg-gray-800 border-b">
              {visibleColumns.map((c) => (
                <th key={c.field} className={`p-2 font-medium whitespace-nowrap text-${c.align || "left"}`} style={{ minWidth: c.width }}>
                  {c.label}
                </th>
              ))}
              <th className="text-center p-2 font-medium" style={{ minWidth: 80 }}>Status</th>
              <th className="text-center p-2 font-medium" style={{ minWidth: 80 }}>Links</th>
              <th className="text-center p-2 font-medium w-10"></th>
            </tr>
          </thead>
          <tbody>
            {/* Flat one-line-per-unit render — earlier zone-header rows
                ("Bluewater Welcome Hall · £1.2m total rent") were doubling up
                the visual line count without adding info. Floor is now its
                own column so groups remain visible at a glance. */}
            {filtered.map(unit => {
              const isExpanded = true;
              return (
                <UnitRow
                  key={unit.id}
                  unit={unit}
                  columns={visibleColumns}
                  onUpdate={inlineUpdate}
                  onDelete={() => deleteMutation.mutate(unit.id)}
                  deal={matchDeal(unit)}
                  letting={matchLetting(unit)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ZoneGroup({ zone, units, isExpanded, onToggleZone, onInlineUpdate, onDelete, matchDeal, matchLetting }: {
  zone: string; units: TenancyUnit[]; isExpanded: boolean;
  onToggleZone: () => void;
  onInlineUpdate: (id: string | number, field: string, val: string) => void;
  onDelete: (id: string | number) => void;
  matchDeal: (u: TenancyUnit) => DealLink | undefined;
  matchLetting: (u: TenancyUnit) => LettingLink | undefined;
}) {
  if (units.length === 0) return null;
  const zoneRent = units.reduce((s, u) => s + Number(u.passing_rent_pa || 0), 0);
  // Functional cols (chevron + status + links + delete) plus all data COLUMNS.
  const totalCols = 1 + COLUMNS.length + 3;

  return (
    <>
      <tr className="bg-gray-100 dark:bg-gray-700/50 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700" onClick={onToggleZone}>
        <td colSpan={totalCols} className="p-2 font-semibold text-xs">
          {isExpanded ? <ChevronDown className="w-3 h-3 inline mr-1" /> : <ChevronRight className="w-3 h-3 inline mr-1" />}
          {zone}
          <Badge variant="secondary" className="ml-2 text-[10px]">{units.length}</Badge>
          <span className="ml-3 text-muted-foreground font-normal">{fmtCurrency(zoneRent)} total rent</span>
        </td>
      </tr>
      {isExpanded && units.map(unit => (
        <UnitRow
          key={unit.id}
          unit={unit}
          onUpdate={onInlineUpdate}
          onDelete={() => onDelete(unit.id)}
          deal={matchDeal(unit)}
          letting={matchLetting(unit)}
        />
      ))}
    </>
  );
}

function UnitRow({ unit, columns, onUpdate, onDelete, deal, letting }: {
  unit: TenancyUnit;
  columns: Col[];
  onUpdate: (id: string | number, field: string, val: string) => void;
  onDelete: () => void;
  deal?: DealLink; letting?: LettingLink;
}) {
  const isVacant = unit.status === "Vacant" || unit.is_vacant;
  const totalCols = columns.length + 3;

  if (unit.is_vacant) {
    return (
      <tr className="border-b hover:bg-amber-100/40 dark:hover:bg-amber-900/20 bg-amber-50/40 dark:bg-amber-900/10" data-testid={`tenancy-row-${unit.id}`}>
        <td className="p-1 font-medium text-amber-700 dark:text-amber-400" colSpan={Math.min(columns.length, 6)}>
          VACANT — {unit.unit_number || unit.premises || "—"}
          {unit.nia_sqft ? ` · ${unit.nia_sqft.toLocaleString()} sqft` : ""}
          {unit.erv_pa ? ` · £${unit.erv_pa.toLocaleString()} pa asking` : ""}
        </td>
        <td className="p-1 text-muted-foreground text-center" colSpan={Math.max(0, columns.length - 6)}>—</td>
        <td className="p-1 text-center">
          <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 dark:text-amber-400">
            {unit.status || "AVA"}
          </Badge>
        </td>
        <td className="p-1 text-center">
          <div className="flex gap-1 justify-center">
            {unit.deal_id && (
              <a href={`/deals/${unit.deal_id}`} className="inline-flex items-center" title={`Open deal${unit.deal_ref ? ` ${unit.deal_ref}` : ""}`}>
                <Badge variant="outline" className="text-[9px] gap-0.5 cursor-pointer hover:bg-blue-50">
                  <Link2 className="w-2.5 h-2.5" />
                  {unit.deal_ref ? `#${unit.deal_ref}` : "Deal"}
                </Badge>
              </a>
            )}
            <a href={`/deals/letting?propertyId=${unit.property_id}`} className="inline-flex items-center" title="Open in Letting Tracker">
              <Badge variant="outline" className="text-[9px] gap-0.5 cursor-pointer hover:bg-green-50">
                <ExternalLink className="w-2.5 h-2.5" />LT
              </Badge>
            </a>
          </div>
        </td>
        <td className="p-1 text-center text-muted-foreground">—</td>
      </tr>
    );
  }

  return (
    <tr className={`border-b hover:bg-gray-50 dark:hover:bg-gray-800/50 ${isVacant ? "bg-amber-50/30 dark:bg-amber-900/10" : ""}`} data-testid={`tenancy-row-${unit.id}`}>
      {columns.map((c) => {
        const raw = (unit as any)[c.field];
        // Date fields arrive as ISO strings from the API (or as timestamptz
        // strings with the T00:00 suffix). Format for display, hand the
        // canonical ISO date to the edit input.
        const isDateField = c.type === "date";
        let displayVal: string;
        if (isDateField && raw) {
          const dt = new Date(raw);
          displayVal = isNaN(dt.getTime()) ? String(raw) : dt.toISOString().slice(0, 10);
        } else {
          displayVal = raw == null ? "" : String(raw);
        }
        const editType = c.type === "num" || c.type === "currency" || c.type === "currency_psf"
          ? "number"
          : isDateField ? "date" : "text";

        // Specialised renderers — keep the InlineEdit-only default for the
        // bulk of columns and override only where the cell needs extra UI:
        //  - AM Initiative: Y/N select instead of free text.
        //  - Break Date: date input + T/L/M (Tenant / Landlord / Mutual) chip.
        //  - Tenant / Trading As: link icon to /companies/<id> when resolved.
        if (c.field === "am_initiative") {
          return (
            <td key={c.field} className={`p-1 text-${c.align || "left"} whitespace-nowrap`}>
              <InlineEdit
                value={displayVal}
                field="am_initiative"
                unitId={unit.id}
                onSave={onUpdate}
                type="select"
                options={["Y", "N"]}
              />
            </td>
          );
        }
        if (c.field === "break_date") {
          return (
            <td key={c.field} className={`p-1 text-${c.align || "left"} whitespace-nowrap`}>
              <div className="flex items-center gap-1 justify-center">
                <InlineEdit
                  value={displayVal}
                  field="break_date"
                  unitId={unit.id}
                  onSave={onUpdate}
                  type="date"
                />
                <BreakTypeChip
                  value={unit.break_type || ""}
                  onChange={(v) => onUpdate(unit.id, "break_type", v)}
                />
              </div>
            </td>
          );
        }
        if (c.field === "tenant_name" || c.field === "trading_name") {
          const linkedId = unit.resolved_tenant_company_id || null;
          return (
            <td key={c.field} className={`p-1 text-${c.align || "left"} whitespace-nowrap`}>
              <div className="flex items-center gap-1">
                <InlineEdit
                  value={displayVal}
                  field={c.field as string}
                  unitId={unit.id}
                  onSave={onUpdate}
                  type={editType}
                  className={c.field === "tenant_name" && isVacant ? "text-amber-600 font-medium" : ""}
                />
                {displayVal && (
                  <Link
                    href={linkedId ? `/companies/${linkedId}` : `/companies?q=${encodeURIComponent(displayVal)}`}
                    title={linkedId ? "Open KYC brand board" : "Search for this tenant in CRM"}
                    onClick={(e: any) => e.stopPropagation()}
                  >
                    <span
                      className="inline-flex items-center text-indigo-500 hover:text-indigo-700 cursor-pointer"
                      data-testid={`tenancy-tenant-link-${c.field}-${unit.id}`}
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                    </span>
                  </Link>
                )}
              </div>
            </td>
          );
        }

        return (
          <td key={c.field} className={`p-1 text-${c.align || "left"} whitespace-nowrap`}>
            <InlineEdit
              value={displayVal}
              field={c.field as string}
              unitId={unit.id}
              onSave={onUpdate}
              type={editType}
              className={c.field === "tenant_name" && isVacant ? "text-amber-600 font-medium" : ""}
            />
          </td>
        );
      })}
      <td className="p-1 text-center">
        <Badge variant={isVacant ? "destructive" : "default"} className="text-[10px] cursor-pointer" onClick={() => onUpdate(unit.id, "status", isVacant ? "Occupied" : "Vacant")} data-testid={`tenancy-status-${unit.id}`}>
          {unit.status}
        </Badge>
      </td>
      <td className="p-1 text-center">
        <div className="flex gap-1 justify-center">
          {deal && (
            <a href={`/deals?id=${deal.id}`} className="inline-flex items-center" title={`Deal: ${deal.name} (${deal.status})`} data-testid={`tenancy-deal-link-${unit.id}`}>
              <Badge variant="outline" className="text-[9px] gap-0.5 cursor-pointer hover:bg-blue-50"><Link2 className="w-2.5 h-2.5" />WIP</Badge>
            </a>
          )}
          {letting && (
            <a href={`/available`} className="inline-flex items-center" title={`Letting: ${letting.unit_name} (${letting.marketing_status})`} data-testid={`tenancy-letting-link-${unit.id}`}>
              <Badge variant="outline" className="text-[9px] gap-0.5 cursor-pointer hover:bg-green-50"><ExternalLink className="w-2.5 h-2.5" />LT</Badge>
            </a>
          )}
          {/* View this unit on the plan — sets the URL hash so the
              PropertyPlansPanel pulses the matching polygon and scrolls
              into view. Falls back gracefully when no polygon exists. */}
          <button
            type="button"
            onClick={() => {
              const label = unit.unit_number || unit.premises || "";
              if (!label) return;
              window.location.hash = `plan-unit-${encodeURIComponent(label)}`;
              const target = document.querySelector('[data-testid="toggle-plans"]')
                || document.querySelector('[data-testid="property-plans-panel"]');
              target?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="inline-flex items-center"
            title="Highlight this unit on the property plan"
            data-testid={`tenancy-plan-link-${unit.id}`}
          >
            <Badge variant="outline" className="text-[9px] gap-0.5 cursor-pointer hover:bg-violet-50">
              <MapPinIcon className="w-2.5 h-2.5" />Plan
            </Badge>
          </button>
        </div>
      </td>
      <td className="p-1 text-center">
        <button onClick={onDelete} className="text-red-400 hover:text-red-600 p-0.5" data-testid={`tenancy-delete-${unit.id}`}>
          <Trash2 className="w-3 h-3" />
        </button>
      </td>
    </tr>
  );
}


function AddTenancyUnitForm({ propertyId, onAdd, onCancel, isPending }: {
  propertyId: string; onAdd: (data: any) => void; onCancel: () => void; isPending: boolean;
}) {
  const [form, setForm] = useState({
    unit_number: "", tenant_name: "", trading_name: "", permitted_use: "", premises: "",
    nia_sqft: "", passing_rent_pa: "", status: "Occupied"
  });

  return (
    <div className="border rounded-lg p-3 bg-gray-50 dark:bg-gray-800 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Add Unit</span>
        <button onClick={onCancel}><X className="w-3 h-3" /></button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Input placeholder="Unit Number" value={form.unit_number} onChange={e => setForm({ ...form, unit_number: e.target.value })} className="h-7 text-xs" data-testid="add-tenancy-unit-number" />
        <Input placeholder="Tenant Name" value={form.tenant_name} onChange={e => setForm({ ...form, tenant_name: e.target.value })} className="h-7 text-xs" data-testid="add-tenancy-tenant" />
        <Input placeholder="Trading Name" value={form.trading_name} onChange={e => setForm({ ...form, trading_name: e.target.value })} className="h-7 text-xs" data-testid="add-tenancy-trading" />
        <Input placeholder="Permitted Use" value={form.permitted_use} onChange={e => setForm({ ...form, permitted_use: e.target.value })} className="h-7 text-xs" data-testid="add-tenancy-use" />
        <Input placeholder="Zone/Premises" value={form.premises} onChange={e => setForm({ ...form, premises: e.target.value })} className="h-7 text-xs" data-testid="add-tenancy-premises" />
        <Input placeholder="NIA sqft" value={form.nia_sqft} onChange={e => setForm({ ...form, nia_sqft: e.target.value })} className="h-7 text-xs" type="number" data-testid="add-tenancy-sqft" />
        <Input placeholder="Rent PA" value={form.passing_rent_pa} onChange={e => setForm({ ...form, passing_rent_pa: e.target.value })} className="h-7 text-xs" type="number" data-testid="add-tenancy-rent" />
        <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="h-7 text-xs border rounded px-2 bg-white dark:bg-gray-700" data-testid="add-tenancy-status">
          <option value="Occupied">Occupied</option>
          <option value="Vacant">Vacant</option>
        </select>
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="h-7 text-xs" onClick={() => onAdd({ ...form, property_id: propertyId })} disabled={isPending || !form.unit_number} data-testid="btn-save-tenancy-unit">
          {isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}Save
        </Button>
      </div>
    </div>
  );
}

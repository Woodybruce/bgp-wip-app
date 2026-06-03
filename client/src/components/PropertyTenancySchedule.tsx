import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CrmEntityPicker } from "@/components/crm-entity-picker";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Building2, Upload, Download, Plus, Trash2, Search, ChevronDown, ChevronRight,
  Link2, FileSpreadsheet, X, Loader2, Lock, ExternalLink, MapPin as MapPinIcon,
  Eye, Filter, RefreshCw
} from "lucide-react";

// Compact retail-tuned set of use labels we want the team to land on across
// the tenancy schedules — chosen over the full UK planning class list
// because the Landsec sheets and team comments overwhelmingly use these
// short labels. Free-text legacy values still display verbatim; picking a
// value from the dropdown writes the canonical label back.
const USE_CLASSES = ["Shop", "F&B", "Leisure", "Office", "Storage", "Other"] as const;

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

// Canonical lifecycle status vocab — matches what the four-way mirror in
// shared/lease-status-mirror.ts expects. Superset of the simple Tenancy
// Occupied/Vacant pair; the extra states (In Negotiation, Under Offer,
// Trading, Lease Event, Archived) are needed for the Leasing lens and
// the Letting Tracker to do their jobs. Editing any of these on a row
// fans the change out to leasing_schedule_units, available_units, and
// crm_deals via the existing mirror.
const SCHEDULE_STATUSES = [
  "Vacant",         // available, no marketing activity yet
  "In Negotiation", // letting agent in talks
  "Under Offer",    // offer accepted, pre-solicitors
  "Occupied",       // tenant in possession, lease alive
  "Trading",        // tenant in possession and trading (F&B / leisure)
  "Lease Event",    // upcoming break / expiry — actively managed
  "Archived",       // historical row, hidden from default filters
] as const;
const SCHEDULE_STATUS_COLOURS: Record<string, string> = {
  "Vacant":         "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  "In Negotiation": "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  "Under Offer":    "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  "Occupied":       "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  "Trading":        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  "Lease Event":    "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
  "Archived":       "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500",
  "Held":           "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", // legacy bucket — keeps colour consistent until migrated
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
  { field: "passing_rent_pa",   label: "Passing Rent",  band: "Rental Income", width: 110, align: "right", type: "currency" },
  { field: "marketing_rent_pa", label: "Quoting Rent",  band: "Rental Income", width: 120, align: "right", type: "currency" },
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

// Per-column filter pill — small Filter icon next to each header label.
// Click opens a popover with a checkbox per distinct value from the data,
// matching the app-wide shadcn DropdownMenu / Popover pattern.
function HeaderFilter({ field, label, distinctValues, active, onChange }: {
  field: string;
  label: string;
  distinctValues: string[];
  active: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  if (distinctValues.length === 0) return null;
  const isActive = active.size > 0;
  const toggle = (v: string) => {
    const next = new Set(active);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange(next);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center justify-center w-4 h-4 rounded ml-1 ${isActive ? "text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30" : "text-gray-400 hover:text-gray-600"}`}
          title={`Filter ${label}`}
          data-testid={`tenancy-filter-trigger-${field}`}
        >
          <Filter className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 max-h-[50vh] overflow-y-auto p-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold">{label}</span>
          {isActive && (
            <button
              className="text-[10px] text-indigo-500 hover:underline"
              onClick={() => onChange(new Set())}
              data-testid={`tenancy-filter-clear-${field}`}
            >
              Clear
            </button>
          )}
        </div>
        <div className="space-y-1">
          {distinctValues.map(v => (
            <label key={v} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1 py-0.5">
              <Checkbox checked={active.has(v)} onCheckedChange={() => toggle(v)} />
              <span className="truncate">{v || "(empty)"}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

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

// Bands hidden by default in "lettings" lens — leasing-team focus, voids
// + marketing emphasis. Institutional fields (Lease dates, NOI, Shortfalls,
// detailed Areas breakdown) drop out to match what the old standalone
// Leasing Schedule used to show. User can still toggle any column back on
// from the column-visibility picker.
const LETTINGS_HIDDEN_BANDS = new Set([
  "Lease Details",
  "Areas — GIA",
  "Areas — NIA",
  "Shortfalls",
  "NOI",
]);
const LETTINGS_HIDDEN_FIELDS = new Set([
  "passing_rent_pa",         // tenancy view
  "turnover_rent_payable",   // tenancy view
  "rent_free_value",         // tenancy view
  "capex_value",             // tenancy view
  "comments",                // generic; leasing_comments is the lettings version
  "underwriting_comments",   // tenancy view
]);

export function PropertyTenancySchedule({ propertyId, lens }: { propertyId: string; lens?: "lettings" | "tenancy" }) {
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

  // Column visibility — Set of hidden field names, persisted per property
  // AND per lens. Two lenses on the same data: "lettings" pre-hides
  // institutional fields (lease dates, NOI, shortfalls, full areas
  // breakdown) so the board looks like the old standalone Leasing
  // Schedule; "tenancy" shows everything. Each lens has its own
  // localStorage so toggling individual cols in one doesn't disturb
  // the other.
  const lensKey = lens || "tenancy";
  const hiddenStorageKey = `tenancy-hidden-cols:${propertyId}:${lensKey}`;
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(hiddenStorageKey);
      if (raw) return new Set(JSON.parse(raw));
      // First-time load for this property+lens — apply the lens defaults.
      if (lensKey === "lettings") {
        const def = new Set<string>(LETTINGS_HIDDEN_FIELDS);
        for (const c of COLUMNS) if (LETTINGS_HIDDEN_BANDS.has(c.band)) def.add(c.field as string);
        return def;
      }
      return new Set();
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

  // Per-column multi-select filters. Map keyed by field; value is the set of
  // accepted values. A row passes if, for every active filter, its cell
  // value (stringified) is in the set. Distinct value lists are computed
  // from the full units list so options stay stable when filters narrow it.
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const setColFilter = (field: string, values: Set<string>) => {
    setColFilters(prev => {
      const next = { ...prev };
      if (values.size === 0) delete next[field]; else next[field] = values;
      return next;
    });
  };
  const clearAllFilters = () => setColFilters({});

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

  // Promote vacant/letting-tracker "orphan" units into real editable tenancy
  // rows, so every unit on the schedule behaves the same.
  const promoteMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/properties/${propertyId}/promote-orphans-to-tenancy`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
      toast({ title: "Added to schedule", description: "Vacant units are now editable rows." });
    },
    onError: (err: any) => { toast({ title: "Couldn't add to schedule", description: err.message, variant: "destructive" }); },
  });

  // Re-sync the status mirror across all four boards for this property.
  // Links any unmatched Letting Tracker / leasing rows by name and pushes
  // the current canonical status onto each projection. Heals drift in one
  // tap (the Bluewater "no linkage" fix).
  const resyncMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/properties/${propertyId}/resync-mirror`, {}),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
      toast({ title: "Boards re-synced", description: `${res?.synced ?? 0} units mirrored to Letting Tracker + leasing.` });
    },
    onError: (err: any) => { toast({ title: "Re-sync failed", description: err.message, variant: "destructive" }); },
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
      const matchesSearch = [u.unit_number, u.tenant_name, u.trading_name, u.premises, u.permitted_use].some(f => f?.toLowerCase().includes(s));
      if (!matchesSearch) return false;
    }
    for (const [field, values] of Object.entries(colFilters)) {
      const raw = (u as any)[field];
      // Normalise the SAME way the checkbox values are built (distinct uses
      // String(raw).trim()) — otherwise a status like "Occupied " with stray
      // whitespace never matches the ticked "Occupied" box and the filter
      // silently hides everything.
      const v = raw == null ? "" : String(raw).trim();
      if (!values.has(v)) return false;
    }
    return true;
  });

  const zones = [...new Set(filtered.map(u => u.premises || "Unassigned"))];
  // Occupied + Trading both count as "in possession" for the headline
  // KPI. Vacant + In Negotiation + Under Offer + Lease Event all count
  // as "actionable" — surfaced as their own buckets below if non-zero.
  const occupied = units.filter(u => u.status === "Occupied" || u.status === "Trading").length;
  const vacant = units.filter(u => u.status === "Vacant").length;
  const inNeg = units.filter(u => u.status === "In Negotiation").length;
  const underOffer = units.filter(u => u.status === "Under Offer").length;
  const leaseEvent = units.filter(u => u.status === "Lease Event").length;
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
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">{units.length} units</Badge>
          {Object.keys(colFilters).length > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] cursor-pointer border-indigo-400 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
              onClick={clearAllFilters}
              data-testid="tenancy-clear-filters"
            >
              {filtered.length} filtered · clear
            </Badge>
          )}
        </div>
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
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => resyncMutation.mutate()}
            disabled={resyncMutation.isPending}
            title="Re-link Letting Tracker + Tenancy rows by unit name and push the current canonical status onto both. One-tap fix for boards that have drifted out of sync."
            data-testid="btn-resync-mirror"
          >
            {resyncMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}Re-sync boards
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
          { label: "Total NIA", value: fmtNum(totalNIA) + " sq ft", filter: null },
          { label: "Passing Rent", value: fmtCurrency(totalRent), filter: null },
          { label: "Avg ERV £psf", value: fmtNum(avgERV, 0), filter: null },
          { label: "WAULT", value: fmtNum(avgWAULT, 1) + " yrs", filter: null },
          { label: "Occupied", value: String(occupied), filter: "Occupied" },
          { label: "Vacant", value: String(vacant), filter: "Vacant" },
          // Click-filterable buckets only show when there's actually rows
          // in that state — keeps the strip uncluttered on properties
          // where everything is occupied.
          ...(inNeg > 0 ? [{ label: "In Negotiation", value: String(inNeg), filter: "In Negotiation" }] : []),
          ...(underOffer > 0 ? [{ label: "Under Offer", value: String(underOffer), filter: "Under Offer" }] : []),
          ...(leaseEvent > 0 ? [{ label: "Lease Event", value: String(leaseEvent), filter: "Lease Event" }] : []),
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
            {/* Column labels — text-style columns get an inline filter pill
                so the team can narrow by Use, Zone, Tenant, etc without
                leaving the table. Numeric / currency columns skip the
                filter (range-filtering them adds noise for little win). */}
            <tr className="bg-gray-100 dark:bg-gray-800 border-b">
              {visibleColumns.map((c) => {
                const filterable = !c.type || c.type === "text";
                let distinct: string[] = [];
                if (filterable) {
                  const seen = new Set<string>();
                  for (const u of units) {
                    const raw = (u as any)[c.field];
                    if (raw == null) continue;
                    const s = String(raw).trim();
                    if (s) seen.add(s);
                  }
                  distinct = [...seen].sort((a, b) => a.localeCompare(b));
                }
                return (
                  <th key={c.field} className={`p-2 font-medium whitespace-nowrap text-${c.align || "left"}`} style={{ minWidth: c.width }}>
                    <span className="inline-flex items-center">
                      {c.label}
                      {filterable && (
                        <HeaderFilter
                          field={c.field as string}
                          label={c.label}
                          distinctValues={distinct}
                          active={colFilters[c.field as string] || new Set()}
                          onChange={(next) => setColFilter(c.field as string, next)}
                        />
                      )}
                    </span>
                  </th>
                );
              })}
              <th className="text-center p-2 font-medium" style={{ minWidth: 80 }}>Status</th>
              <th className="text-center p-2 font-medium" style={{ minWidth: 80 }}>Links</th>
              {/* Sticky right so the delete button is always visible
                  without horizontal scrolling to the end of the table. */}
              <th className="text-center p-2 font-medium w-10 sticky right-0 bg-slate-800 z-10"></th>
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
                  onPromote={() => promoteMutation.mutate()}
                  promoting={promoteMutation.isPending}
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

// Brand-only picker for Tenant + Trading As columns. Thin wrapper
// around the shared CrmEntityPicker so the tenancy schedule uses the
// exact same affordance as every other CRM picker in the app. Saves
// the brand NAME into tenant_name/trading_name; the server resolver
// then links tenant_company_id by name on next read.
function TenantBrandPicker({
  value, field, unitId, onSave, isVacant,
}: {
  value: string;
  field: "tenant_name" | "trading_name";
  unitId: string | number;
  onSave: (id: string | number, field: string, val: string) => void;
  isVacant?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: allCompanies = [] } = useQuery<Array<{ id: string; name: string; meta: string | null; subLabel: string | null; aliases: string[] }>>({
    queryKey: ["/api/crm/companies-basic"],
    queryFn: async () => {
      const res = await fetch("/api/crm/companies?limit=5000", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (data.companies || []);
      return arr.map((c: any) => {
        // Trading-entity aliases — every legal entity that's been
        // recorded against this brand. Searching any of them lands
        // back on the brand row.
        const trading = Array.isArray(c.tradingEntities || c.trading_entities) ? (c.tradingEntities || c.trading_entities) : [];
        const aliases = trading.map((t: any) => t?.name).filter((n: any) => typeof n === "string" && n.length > 0);
        const uk = c.ukEntityName || c.uk_entity_name || null;
        return {
          id: String(c.id),
          name: c.name,
          // subLabel = first legal entity in priority order. UK
          // contracting entity wins (it's the canonical lease party),
          // else the first trading-entity alias.
          subLabel: uk || aliases[0] || null,
          aliases,
          meta: c.companyType || c.company_type || null,
        };
      });
    },
    staleTime: 120000,
  });

  // Tenant column should only see brand-shaped rows — landlords, agents,
  // solicitors and other counterparties don't belong here. We exclude
  // by company_type; rows without a type set are kept (most brands
  // don't have it filled in yet).
  const TENANT_EXCLUDE = new Set(["Landlord", "Landlord / Client", "Client", "Agent", "Solicitor", "Investor", "Vendor", "Purchaser"]);
  const tenantOptions = useMemo(
    () => allCompanies.filter(c => !c.meta || !TENANT_EXCLUDE.has(c.meta)),
    [allCompanies],
  );

  // We don't carry an id for tenant_name yet (the server resolves it
  // by name) — pass null as `value` and supply the name via valueName
  // so the closed-state shows what's currently saved.
  return (
    <div className={`${field === "tenant_name" && isVacant ? "text-amber-600 font-medium" : ""}`}>
      <CrmEntityPicker
        value={null}
        valueName={value}
        options={tenantOptions}
        kind="company"
        searchPlaceholder="Search brand…"
        emptyLabel={field === "tenant_name" ? "Set tenant" : "Set trading as"}
        testIdPrefix={`tenant-brand-picker-${field}-${unitId}`}
        onSelect={(opt) => onSave(unitId, field, opt.name)}
        onClear={value ? () => onSave(unitId, field, "") : undefined}
        onCreate={async (name) => {
          const r = await apiRequest("POST", "/api/crm/companies", {
            name: name.trim(),
            companyType: "Tenant",
            isTrackedBrand: true,
          });
          const created = await r.json();
          qc.invalidateQueries({ queryKey: ["/api/crm/companies-basic"] });
          qc.invalidateQueries({ queryKey: ["/api/crm/companies"] });
          toast({ title: "Brand created", description: `${created?.name || name} added to Brand Explorer.` });
          return { id: String(created.id), name: created.name, meta: created.companyType || created.company_type || null };
        }}
      />
    </div>
  );
}

function UnitRow({ unit, columns, onUpdate, onDelete, onPromote, promoting, deal, letting }: {
  unit: TenancyUnit;
  columns: Col[];
  onUpdate: (id: string | number, field: string, val: string) => void;
  onDelete: () => void;
  onPromote?: () => void;
  promoting?: boolean;
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
          <div className="flex gap-1 justify-center items-center flex-wrap">
            {onPromote && (
              <button
                onClick={onPromote}
                disabled={promoting}
                className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded border border-amber-400 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                title="Add this unit to the schedule as an editable row"
                data-testid={`promote-vacant-${unit.id}`}
              >
                <Plus className="w-2.5 h-2.5" />{promoting ? "Adding…" : "Add to schedule"}
              </button>
            )}
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
        if (c.field === "permitted_use") {
          return (
            <td key={c.field} className={`p-1 text-${c.align || "left"} whitespace-nowrap`}>
              <InlineEdit
                value={displayVal}
                field="permitted_use"
                unitId={unit.id}
                onSave={onUpdate}
                type="select"
                options={[...USE_CLASSES]}
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
          // When the tenant is resolved to a CRM company, the name
          // itself is the one-click link to the brand/company board.
          // Pencil icon on the right opens inline edit for corrections.
          if (linkedId && displayVal) {
            return (
              <td key={c.field} className={`p-1 text-${c.align || "left"} whitespace-nowrap group`}>
                <div className="flex items-center gap-1">
                  <Link
                    href={`/companies/${linkedId}`}
                    title={`Open ${unit.resolved_tenant_company_name || displayVal} board`}
                    onClick={(e: any) => e.stopPropagation()}
                  >
                    <span
                      className={`text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer font-medium ${c.field === "tenant_name" && isVacant ? "text-amber-600" : ""}`}
                      data-testid={`tenancy-tenant-link-${c.field}-${unit.id}`}
                    >
                      {displayVal}
                    </span>
                  </Link>
                  <InlineEdit
                    value={displayVal}
                    field={c.field as string}
                    unitId={unit.id}
                    onSave={onUpdate}
                    type={editType}
                    className="opacity-0 group-hover:opacity-60 text-[10px]"
                  />
                </div>
              </td>
            );
          }
          // Unresolved — show the brand picker so the user can only
          // select an existing brand or create one. Free-text input is
          // intentionally not offered: tenant rows must reference the
          // Brand Explorer CRM as the single source of truth.
          return (
            <td key={c.field} className={`p-1 text-${c.align || "left"} whitespace-nowrap`}>
              <TenantBrandPicker
                value={displayVal}
                field={c.field as "tenant_name" | "trading_name"}
                unitId={unit.id}
                onSave={onUpdate}
                isVacant={isVacant}
              />
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
            />
          </td>
        );
      })}
      <td className="p-1 text-center">
        {/* Canonical lifecycle status — dropdown carries the full 7-state
            vocab the four-way mirror expects. Changing here fans out to
            leasing_schedule_units + available_units + crm_deals via the
            existing mirror on the PUT endpoint, so the Letting Tracker
            and the Leasing lens both reflect the change on next refresh. */}
        <select
          value={unit.status || ""}
          onChange={(e) => onUpdate(unit.id, "status", e.target.value)}
          className={`text-[10px] font-semibold rounded px-1.5 py-0.5 border-0 cursor-pointer outline-none ${SCHEDULE_STATUS_COLOURS[unit.status || ""] || "bg-gray-100 text-gray-700"}`}
          data-testid={`tenancy-status-${unit.id}`}
          aria-label="Status"
        >
          {!SCHEDULE_STATUSES.includes(unit.status as any) && unit.status && (
            <option value={unit.status}>{unit.status}</option>
          )}
          {SCHEDULE_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
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
      <td className="p-1 text-center sticky right-0 bg-background border-l shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)] z-[5]">
        <button
          onClick={() => {
            const label = unit.unit_number || unit.tenant_name || "this unit";
            if (confirm(`Delete ${label}? This removes the tenancy row — undo by re-importing.`)) onDelete();
          }}
          className="text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 p-1 rounded transition-colors"
          title="Delete tenancy row"
          data-testid={`tenancy-delete-${unit.id}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
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
        {/* Tenant + Trading As use the brand picker so new units land
            already linked to a Brand Explorer row. No free text. */}
        <div className="text-xs">
          <TenantBrandPicker
            value={form.tenant_name}
            field="tenant_name"
            unitId="new"
            onSave={(_id, _f, val) => setForm({ ...form, tenant_name: val })}
          />
        </div>
        <div className="text-xs">
          <TenantBrandPicker
            value={form.trading_name}
            field="trading_name"
            unitId="new"
            onSave={(_id, _f, val) => setForm({ ...form, trading_name: val })}
          />
        </div>
        <Input placeholder="Use Class" value={form.permitted_use} onChange={e => setForm({ ...form, permitted_use: e.target.value })} className="h-7 text-xs" data-testid="add-tenancy-use" />
        <Input placeholder="Zone/Premises" value={form.premises} onChange={e => setForm({ ...form, premises: e.target.value })} className="h-7 text-xs" data-testid="add-tenancy-premises" />
        <Input placeholder="NIA sq ft" value={form.nia_sqft} onChange={e => setForm({ ...form, nia_sqft: e.target.value })} className="h-7 text-xs" type="number" data-testid="add-tenancy-sqft" />
        <Input placeholder="Passing Rent" value={form.passing_rent_pa} onChange={e => setForm({ ...form, passing_rent_pa: e.target.value })} className="h-7 text-xs" type="number" data-testid="add-tenancy-rent" />
        <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="h-7 text-xs border rounded px-2 bg-white dark:bg-gray-700" data-testid="add-tenancy-status">
          {SCHEDULE_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
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

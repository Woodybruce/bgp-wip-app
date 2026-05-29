import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ViewToggle } from "@/components/mobile-card-view";
import { ImportAnythingDialog } from "@/components/import-anything-dialog";
import { CrmEntityPicker } from "@/components/crm-entity-picker";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Building2, ChevronLeft, Search, Filter, Calendar, AlertTriangle,
  Edit2, Plus, Trash2, X, Check, MapPin, Users, TrendingUp,
  Clock, Target, Star, ChevronDown, ChevronRight, Loader2,
  Shield, ShieldCheck, ShieldOff, Download, Upload, History, Lock, Eye, ExternalLink,
  Sparkles, Circle, ThumbsUp, ThumbsDown, UserPlus, RefreshCw, Pencil,
} from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";

interface LeasingProperty {
  id: string;
  name: string;
  address: any;
  asset_class: string;
  bgp_engagement: string[];
  landlord_name: string;
  landlord_id: string;
  unit_count: number;
  occupied_count: number;
  vacant_count: number;
  expiring_soon: number;
  leasing_privacy_enabled: boolean;
}

interface AuditEntry {
  id: number;
  unit_id: string;
  property_id: string;
  user_name: string;
  action: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

interface LeasingUnit {
  id: string;
  property_id: string;
  property_name?: string;
  landlord_name?: string;
  zone: string;
  positioning: string;
  unit_name: string;
  tenant_name: string;
  agent_initials: string;
  lease_expiry: string | null;
  lease_break: string | null;
  rent_review: string | null;
  landlord_break: string | null;
  rent_pa: number | null;
  sqft: number | null;
  mat_psqft: string;
  lfl_percent: string;
  occ_cost_percent: string;
  financial_notes: string;
  target_brands: string;
  target_company_ids: string;
  optimum_target: string;
  priority: string;
  status: string;
  updates: string;
  sort_order: number;
}

function formatDate(d: string | null) {
  if (!d) return "";
  const date = new Date(d);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

function isExpiringSoon(d: string | null) {
  if (!d) return false;
  const expiry = new Date(d);
  const now = new Date();
  const monthsAway = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);
  return monthsAway <= 12 && monthsAway > 0;
}

function isExpired(d: string | null) {
  if (!d) return false;
  return new Date(d) < new Date();
}

function InlineEditCell({ unitId, field, value, onSave, className = "", placeholder = "", multiline = false }: {
  unitId: string; field: string; value: string; onSave: (id: string, field: string, value: string) => void;
  className?: string; placeholder?: string; multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) { const el = multiline ? textareaRef.current : inputRef.current; el?.focus(); } }, [editing, multiline]);
  useEffect(() => { setVal(value); }, [value]);

  const save = () => {
    setEditing(false);
    if (val !== value) onSave(unitId, field, val);
  };

  if (editing) {
    if (multiline) {
      return <textarea ref={textareaRef} value={val} onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === "Escape") { setVal(value); setEditing(false); } }}
        className={`w-full bg-white dark:bg-gray-900 border rounded px-1 py-0.5 text-xs outline-none focus:ring-1 focus:ring-teal-400 resize-none ${className}`} rows={2} data-testid={`inline-edit-${field}-${unitId}`} />;
    }
    return <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setVal(value); setEditing(false); } }}
      className={`w-full bg-white dark:bg-gray-900 border rounded px-1 py-0.5 text-xs outline-none focus:ring-1 focus:ring-teal-400 ${className}`} data-testid={`inline-edit-${field}-${unitId}`} />;
  }

  return <span onClick={() => setEditing(true)} className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 py-0.5 -mx-1 block min-h-[18px] ${className}`} data-testid={`inline-${field}-${unitId}`}>
    {value || <span className="text-gray-300 italic">{placeholder || "—"}</span>}
  </span>;
}

// Shared column widths for every per-zone <table> on the Leasing Schedule.
// Each zone renders its own <table>; without a fixed layout the columns
// auto-size to the content of each zone independently, so the boundaries
// don't line up vertically across zones. A common <colgroup> + table-layout
// fixed locks every zone table to identical column widths.
const LEASING_COL_WIDTHS = [
  { key: "existing",   width: 220 },
  { key: "positioning", width: 160 },
  { key: "financial",   width: 160 },
  { key: "targets",     width: 240 },
  { key: "optimum",     width: 160 },
  { key: "priority",    width: 120 },
  { key: "updates",     width: 280 },
  { key: "actions",     width: 60 },
];
function LeasingColgroup() {
  return (
    <colgroup>
      {LEASING_COL_WIDTHS.map(c => <col key={c.key} style={{ width: `${c.width}px` }} />)}
    </colgroup>
  );
}
const LEASING_TABLE_MIN_WIDTH = LEASING_COL_WIDTHS.reduce((s, c) => s + c.width, 0);

// Landsec leasing-tracker status bands. The bracketed label is what Landsec
// uses internally; we store the enum value in `status_band` and render the
// label + colour. Drives the row tint on the Leasing Schedule.
const STATUS_BANDS: Array<{ value: string; label: string; rowClass: string; pillClass: string }> = [
  { value: "GREEN_A_HALO",       label: "A — Halo",          rowClass: "bg-emerald-200/80 dark:bg-emerald-900/60", pillClass: "border-emerald-600 text-emerald-900 bg-emerald-200 dark:text-emerald-100 dark:bg-emerald-800" },
  { value: "GREEN_B_HALO",       label: "B — On Strategy",   rowClass: "bg-emerald-100/90 dark:bg-emerald-950/50", pillClass: "border-emerald-500 text-emerald-800 bg-emerald-100 dark:text-emerald-200 dark:bg-emerald-900" },
  { value: "AMBER_C_MAINTAIN",   label: "C — Maintain Mix",  rowClass: "bg-amber-200/80 dark:bg-amber-900/50",     pillClass: "border-amber-600 text-amber-900 bg-amber-200 dark:text-amber-100 dark:bg-amber-800" },
  { value: "DARK_RED_D_DIVEST",  label: "D — Divest Over Time", rowClass: "bg-rose-300/70 dark:bg-rose-900/60", pillClass: "border-rose-700 text-rose-900 bg-rose-200 dark:text-rose-100 dark:bg-rose-800" },
  { value: "BRIGHT_RED_D_AT_RISK", label: "D — Customer At Risk / Live Opp", rowClass: "bg-red-300/80 dark:bg-red-900/70", pillClass: "border-red-700 text-red-900 bg-red-300 dark:text-red-100 dark:bg-red-800" },
  { value: "GREY_VOID",          label: "Void / Live Opp",   rowClass: "bg-zinc-300/70 dark:bg-zinc-800/80",      pillClass: "border-zinc-500 text-zinc-800 bg-zinc-200 dark:text-zinc-200 dark:bg-zinc-700" },
];

function statusBandFor(value: string | null | undefined) {
  return STATUS_BANDS.find(b => b.value === value) || null;
}

// Map the status_band enum to a tenant-name colour (matches Landsec key —
// green for halo/on-strategy, amber for maintain, dark/bright red for divest/
// at-risk, grey for void). Uses deeper shades than the row tint so the name
// remains readable on top of a saturated background.
function tenantNameColourFor(value: string | null | undefined): string {
  switch (value) {
    case "GREEN_A_HALO":
    case "GREEN_B_HALO": return "text-emerald-900 dark:text-emerald-200";
    case "AMBER_C_MAINTAIN": return "text-amber-900 dark:text-amber-200";
    case "DARK_RED_D_DIVEST": return "text-rose-900 dark:text-rose-200";
    case "BRIGHT_RED_D_AT_RISK": return "text-red-900 dark:text-red-200";
    case "GREY_VOID": return "text-zinc-700 dark:text-zinc-300";
    default: return "text-foreground";
  }
}

// Header label for the Updates column, formatted like Landsec's
// "Updates - APR 2026 LEASING MEETING". Picks the most recent meeting_month
// from the units; falls back to the current month.
function updatesHeaderLabel(units: any[]): string {
  const mm = units.find((u: any) => u.meeting_month)?.meeting_month;
  const label = (mm || new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })).toUpperCase();
  return `Updates - ${label} - Leasing Meeting`;
}

// Brand picker — free-type autocomplete against CRM companies. Stores the
// brand NAME as the field value (matches Landsec sheet semantics) but if the
// typed name resolves to a tracked CRM company, the deep-link is preserved.
// Suggested sub-types per Landsec positioning group (Key ii). Free-text is
// allowed too — these are just hints in the dropdown so the team converges on
// a shared vocabulary without being forced into it.
const POSITIONING_SUBTYPES: Record<string, string[]> = {
  "Everyday Connections": ["Social Dining", "Gym", "Wellness", "Convenience"],
  "Quick Refuel": ["Café", "Grab & Go", "QSR", "Bakery"],
  "Joyful Gatherings": ["Leisure", "Bars", "Premium Dining", "Cinema"],
  "Leisurely Refuel": ["Casual Dining", "Premium Casual Dining", "Family Dining"],
};

// Positioning cell — two-step picker: group (Key ii umbrella) + sub-type.
// Saves to two fields: positioning_group (filterable) + positioning (free text).
function PositioningCell({ unitId, group, subType, onSave }: {
  unitId: string; group: string | null | undefined; subType: string; onSave: (id: string, field: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftGroup, setDraftGroup] = useState(group || "");
  const [draftSub, setDraftSub] = useState(subType || "");
  useEffect(() => { if (open) { setDraftGroup(group || ""); setDraftSub(subType || ""); } }, [open, group, subType]);
  const commit = () => {
    if ((draftGroup || "") !== (group || "")) onSave(unitId, "positioning_group", draftGroup);
    if ((draftSub || "") !== (subType || "")) onSave(unitId, "positioning", draftSub);
    setOpen(false);
  };
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <span
          className="cursor-pointer hover:bg-muted/50 px-1 rounded text-xs inline-block leading-tight min-w-[100px] align-top"
          data-testid={`positioning-cell-${unitId}`}
        >
          {group ? (
            <div>
              <div className="font-medium text-[11px]">{group}</div>
              {subType && <div className="text-[11px] text-muted-foreground">{subType}</div>}
            </div>
          ) : subType ? (
            <span className="text-[11px]">{subType}</span>
          ) : (
            <span className="italic text-muted-foreground">Set positioning</span>
          )}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="p-3 w-[260px]">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Group (Key ii)</div>
        <div className="flex flex-wrap gap-1 mb-3">
          {POSITIONING_GROUPS.map(g => (
            <button
              key={g.key}
              onClick={() => { setDraftGroup(draftGroup === g.key ? "" : g.key); if (draftGroup !== g.key) setDraftSub(""); }}
              className={`text-[11px] px-2 py-1 rounded border ${draftGroup === g.key ? "bg-foreground text-background border-foreground" : "hover:bg-muted"}`}
              data-testid={`positioning-group-${g.key}-${unitId}`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Sub-type</div>
        {draftGroup && (
          <div className="flex flex-wrap gap-1 mb-2">
            {(POSITIONING_SUBTYPES[draftGroup] || []).map(t => (
              <button
                key={t}
                onClick={() => setDraftSub(t)}
                className={`text-[11px] px-2 py-0.5 rounded border ${draftSub === t ? "bg-foreground text-background border-foreground" : "hover:bg-muted"}`}
                data-testid={`positioning-sub-${t}-${unitId}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        <Input
          value={draftSub}
          onChange={(e) => setDraftSub(e.target.value)}
          placeholder="Or type your own (e.g. Padel)"
          className="h-7 text-[11px]"
          data-testid={`positioning-sub-input-${unitId}`}
        />
        <div className="flex justify-end gap-1 mt-2">
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" className="h-7 text-[11px]" onClick={commit} data-testid={`positioning-save-${unitId}`}>Save</Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Inline financial-performance cell — three-line LFL / MAT / Occ display.
// Click any line to inline-edit. Grid layout keeps lines aligned even when
// some values are missing (so empty rows don't collapse).
function FinancialPerformanceCell({ unit, onSave }: { unit: any; onSave: (id: string, field: string, value: string) => void }) {
  const lfl = unit.lfl_percent || "";
  const mat = unit.mat_psqft || "";
  const occ = unit.occ_cost_percent || "";
  const Row = ({ label, value, field, valueClass }: { label: string; value: string; field: string; valueClass?: string }) => (
    <div className="grid grid-cols-[60px_1fr] items-baseline gap-1 h-[14px] leading-[14px]">
      <span className="text-right tabular-nums truncate">
        <InlineEditCell unitId={unit.id} field={field} value={value} onSave={onSave} className={valueClass} placeholder="—" />
      </span>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{label}</span>
    </div>
  );
  return (
    <div className="text-[11px]">
      <Row label="% LFL" value={lfl} field="lfl_percent" valueClass={lfl ? (String(lfl).startsWith("-") ? "text-rose-600" : "text-emerald-700") : "text-muted-foreground"} />
      <Row label="£ MAT/sqft" value={mat} field="mat_psqft" valueClass="font-medium" />
      <Row label="% Occ" value={occ} field="occ_cost_percent" valueClass="text-muted-foreground" />
    </div>
  );
}

// Existing tenant cell — pulls name LIVE from the linked Tenancy Schedule
// row when the row is FK'd, otherwise uses leasing_schedule_units.tenant_name.
// Clickable through to the brand CRM when matched. Inline-editable if no
// brand match (lets you correct a typo without leaving the schedule). The
// status band picker is rendered as a small pill underneath the name so the
// row tint can be set without a dedicated column.
function ExistingTenantCell({ unit, nameColour, onSave }: {
  unit: any; nameColour: string; onSave: (id: string, field: string, value: string) => void;
}) {
  // The brand-board link follows the Trading As name (= the brand), not the
  // legal entity. live_trading_name comes from the tenancy_schedule join;
  // fall back to live_tenant_name when no trading-as is recorded.
  const tradingName = unit.live_trading_name || "";
  const tenantName = unit.live_tenant_name || unit.tenant_name || unit.unit_name || "";
  const displayName = tradingName || tenantName;
  const brandLookupName = tradingName || tenantName;
  const linkedCompanyId = unit.resolved_tenant_company_id || unit.tenant_company_id || null;
  return (
    <div>
      {linkedCompanyId ? (
        <Link
          href={`/companies/${linkedCompanyId}`}
          className={`text-sm font-bold leading-tight hover:underline ${nameColour}`}
          data-testid={`existing-link-${unit.id}`}
        >
          {displayName || "—"}
        </Link>
      ) : (
        <div className={`text-sm font-bold leading-tight ${nameColour} flex items-center gap-1`}>
          <InlineEditCell unitId={unit.id} field="tenant_name" value={tenantName} onSave={onSave} className="text-sm font-bold" placeholder="Tenant" />
          {brandLookupName && (
            <Link
              href={`/companies?q=${encodeURIComponent(brandLookupName)}`}
              title="Open brand board for this tenant"
              onClick={(e: any) => e.stopPropagation()}
              data-testid={`existing-search-${unit.id}`}
            >
              <ExternalLink className="w-2.5 h-2.5 text-indigo-500 hover:text-indigo-700" />
            </Link>
          )}
        </div>
      )}
      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        <StatusBandCell unitId={unit.id} value={unit.status_band} onSave={onSave} />
        <InlineStatusCell unitId={unit.id} value={unit.status} onSave={onSave} />
      </div>
    </div>
  );
}

function BrandPickerCell({ unitId, field, value, onSave, placeholder = "Type to search brands" }: {
  unitId: string; field: string; value: string; onSave: (id: string, field: string, value: string) => void; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || "");
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: companies = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/crm/companies-basic"],
    queryFn: async () => {
      const r = await fetch("/api/crm/companies?limit=5000", { headers: getAuthHeaders() });
      if (!r.ok) return [];
      const d = await r.json();
      const arr = Array.isArray(d) ? d : (d.companies || []);
      return arr.map((c: any) => ({ id: String(c.id), name: c.name }));
    },
    staleTime: 120000,
  });
  const matches = useMemo(() => {
    if (!text.trim()) return [];
    const q = text.toLowerCase();
    return companies.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [companies, text]);

  useEffect(() => { if (editing) setTimeout(() => inputRef.current?.focus(), 30); }, [editing]);

  if (!editing) {
    return (
      <span
        className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 px-1 rounded text-xs font-medium inline-block align-top leading-tight"
        onClick={() => { setText(value || ""); setEditing(true); }}
        data-testid={`brand-cell-${field}-${unitId}`}
      >
        {value || <span className="text-muted-foreground italic font-normal">{placeholder}</span>}
      </span>
    );
  }
  return (
    <div className="relative" onBlur={(e) => {
      // Save on blur unless the new focus is inside this picker
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        if (text !== (value || "")) onSave(unitId, field, text);
        setEditing(false);
      }
    }}>
      <Input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onSave(unitId, field, text); setEditing(false); }
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-6 text-xs px-1 py-0"
        placeholder={placeholder}
        data-testid={`brand-input-${field}-${unitId}`}
      />
      {matches.length > 0 && (
        <div className="absolute z-50 mt-0.5 left-0 right-0 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto" data-testid={`brand-suggestions-${field}-${unitId}`}>
          {matches.map(c => (
            <button
              key={c.id}
              onMouseDown={(e) => { e.preventDefault(); setText(c.name); onSave(unitId, field, c.name); setEditing(false); }}
              className="w-full text-left px-2 py-1 text-xs hover:bg-muted"
              data-testid={`brand-suggestion-${c.id}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Priority is stored as "MMM YYYY" (e.g. "May 2026") — month-year picker.
function MonthYearCell({ unitId, field, value, onSave }: {
  unitId: string; field: string; value: string; onSave: (id: string, field: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const years = useMemo(() => Array.from({ length: 6 }, (_, i) => now.getFullYear() + i - 1), [now]);
  const setVal = (month: string, year: number) => {
    onSave(unitId, field, `${month} ${year}`);
    setOpen(false);
  };
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <span className="text-[11px] cursor-pointer px-1 rounded hover:bg-muted inline-block min-w-[60px]" data-testid={`monthyear-${field}-${unitId}`}>
          {value || <span className="text-muted-foreground italic">Set date</span>}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="p-2 w-[210px]">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Year</div>
        <div className="flex flex-wrap gap-1 mb-2">
          {years.map(y => (
            <button
              key={y}
              onClick={() => { const m = value?.split(" ")[0] && MONTHS.includes(value.split(" ")[0]) ? value.split(" ")[0] : MONTHS[now.getMonth()]; setVal(m, y); }}
              className={`text-[11px] px-2 py-1 rounded border ${value?.endsWith(` ${y}`) ? "bg-foreground text-background" : "hover:bg-muted"}`}
              data-testid={`year-${y}-${unitId}`}
            >
              {y}
            </button>
          ))}
        </div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Month</div>
        <div className="grid grid-cols-4 gap-1">
          {MONTHS.map(m => (
            <button
              key={m}
              onClick={() => { const y = (() => { const parsed = parseInt(value?.split(" ")[1] || ""); return isNaN(parsed) ? now.getFullYear() : parsed; })(); setVal(m, y); }}
              className={`text-[11px] px-2 py-1 rounded border ${value?.startsWith(`${m} `) ? "bg-foreground text-background" : "hover:bg-muted"}`}
              data-testid={`month-${m}-${unitId}`}
            >
              {m}
            </button>
          ))}
        </div>
        {value && (
          <button
            onClick={() => { onSave(unitId, field, ""); setOpen(false); }}
            className="mt-2 text-[11px] text-muted-foreground hover:text-foreground underline"
            data-testid={`monthyear-clear-${unitId}`}
          >
            Clear
          </button>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Textarea with @-mention autocomplete. On blur, scans for newly added
// @username tokens and POSTs to /api/leasing-schedule/unit/:id/mention-tasks
// to create user tasks for each tagged user.
function MentionTextarea({ unitId, propertyId, value, onSave }: {
  unitId: string; propertyId: string; value: string; onSave: (id: string, field: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || "");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { data: allUsers } = useQuery<Array<{ id: string; username: string; name?: string; email?: string }>>({
    queryKey: ["/api/users"],
    staleTime: 5 * 60_000,
  });
  const userMatches = useMemo(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery.toLowerCase();
    return (allUsers || []).filter(u => {
      const local = (u.email || u.username || "").split("@")[0].toLowerCase();
      const name = (u.name || "").toLowerCase();
      return local.includes(q) || name.includes(q);
    }).slice(0, 6);
  }, [allUsers, mentionQuery]);

  const sync = (newText: string) => {
    setText(newText);
    const ta = textareaRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const before = newText.slice(0, caret);
    const m = before.match(/(?:^|\s)@(\w*)$/);
    if (m) {
      setMentionStart(caret - m[1].length - 1);
      setMentionQuery(m[1]);
    } else {
      setMentionQuery(null);
      setMentionStart(-1);
    }
  };

  const insertMention = (user: { username: string; email?: string }) => {
    const handle = (user.email || user.username || "").split("@")[0];
    if (mentionStart < 0) return;
    const before = text.slice(0, mentionStart);
    const after = text.slice((textareaRef.current?.selectionStart ?? mentionStart + 1));
    const next = `${before}@${handle} ${after}`;
    setText(next);
    setMentionQuery(null);
    setMentionStart(-1);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        const pos = before.length + handle.length + 2;
        ta.setSelectionRange(pos, pos);
        ta.focus();
      }
    }, 10);
  };

  const commit = async () => {
    if (text !== (value || "")) {
      onSave(unitId, "updates", text);
      // Fire-and-forget task creation for new mentions.
      try {
        await fetch(`/api/leasing-schedule/unit/${unitId}/mention-tasks`, {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ text, previousText: value || "", propertyId }),
        });
      } catch {}
    }
    setEditing(false);
  };

  // Render — show stylised text when not editing, textarea when editing.
  if (!editing) {
    // Highlight @username mentions in display
    const parts = (value || "").split(/(@[\w.-]+)/g);
    return (
      <div
        className="cursor-text hover:bg-gray-100 dark:hover:bg-gray-700 px-1 rounded text-[11px] text-gray-700 dark:text-gray-300 leading-snug min-h-[24px] whitespace-pre-wrap"
        onClick={() => { setText(value || ""); setEditing(true); setTimeout(() => textareaRef.current?.focus(), 30); }}
        data-testid={`mention-display-${unitId}`}
      >
        {parts.map((p, i) => p.startsWith("@") ? (
          <span key={i} className="text-blue-600 dark:text-blue-400 font-medium">{p}</span>
        ) : <span key={i}>{p}</span>)}
        {!value && <span className="italic text-muted-foreground">Update / agent input (use @ to tag)</span>}
      </div>
    );
  }

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => sync(e.target.value)}
        onBlur={() => { if (mentionQuery == null) commit(); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setEditing(false); setText(value || ""); }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
        }}
        rows={3}
        className="text-[11px] resize-y min-h-[60px]"
        data-testid={`mention-input-${unitId}`}
      />
      {userMatches.length > 0 && (
        <div className="absolute z-50 mt-0.5 left-0 right-0 bg-popover border rounded-md shadow-lg" data-testid={`mention-suggestions-${unitId}`}>
          {userMatches.map(u => (
            <button
              key={u.id}
              onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
              className="w-full text-left px-2 py-1 text-xs hover:bg-muted flex items-center justify-between gap-2"
              data-testid={`mention-suggestion-${u.username}`}
            >
              <span className="font-medium">@{(u.email || u.username || "").split("@")[0]}</span>
              {u.name && <span className="text-muted-foreground text-[11px]">{u.name}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Zone labels often arrive with a leading "1. " / "2." / etc from imported
// templates. Strip for display; the order is preserved by sort_order anyway.
function cleanZoneLabel(zone: string | null | undefined): string {
  if (!zone) return "Unzoned";
  return String(zone).replace(/^\s*\d+\.\s*/, "").trim() || "Unzoned";
}

function formatLandsecDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  // dd/m/yy — matches Landsec's compact "24/3/35" style
  return `${dt.getDate()}/${dt.getMonth() + 1}/${String(dt.getFullYear()).slice(-2)}`;
}

function StatusBandCell({ unitId, value, onSave }: { unitId: string; value: string | null | undefined; onSave: (id: string, field: string, value: string) => void }) {
  const band = statusBandFor(value);
  // Render the trigger as a real <button> rather than a Badge wrapped in
  // <DropdownMenuTrigger asChild>. Badge is a plain function component
  // without forwardRef, so Radix can't reliably hook up the ref/anchor and
  // the dropdown often fails to open. A button avoids the issue entirely
  // while keeping the Badge-style chip look.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center whitespace-nowrap rounded-md border px-2.5 py-0.5 text-[10px] font-semibold cursor-pointer hover:brightness-95 ${band?.pillClass || "border-gray-300 text-gray-500"}`}
          data-testid={`inline-statusband-${unitId}`}
        >
          {band?.label || "— Set band"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]" data-testid={`statusband-menu-${unitId}`}>
        {STATUS_BANDS.map(b => (
          <DropdownMenuItem
            key={b.value}
            onClick={() => onSave(unitId, "status_band", b.value)}
            className={`text-xs cursor-pointer ${b.value === value ? "font-bold" : ""}`}
            data-testid={`statusband-option-${b.value}-${unitId}`}
          >
            <span className={`inline-block w-3 h-3 rounded mr-2 align-middle ${b.rowClass}`}></span>{b.label}
          </DropdownMenuItem>
        ))}
        {value && (
          <DropdownMenuItem
            onClick={() => onSave(unitId, "status_band", "")}
            className="text-xs cursor-pointer text-muted-foreground border-t mt-1"
            data-testid={`statusband-option-clear-${unitId}`}
          >
            <span className="inline-block w-3 h-3 rounded mr-2 align-middle bg-transparent border" />Clear
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InlineStatusCell({ unitId, value, onSave }: { unitId: string; value: string; onSave: (id: string, field: string, value: string) => void }) {
  const statuses = ["Occupied", "Vacant", "Under Offer", "In Negotiation", "Archived"];
  const colors: Record<string, string> = {
    "Occupied": "border-emerald-300 text-emerald-700 bg-emerald-50",
    "Vacant": "border-gray-300 text-gray-500 bg-gray-50",
    "Under Offer": "border-blue-300 text-blue-700 bg-blue-50",
    "In Negotiation": "border-amber-300 text-amber-700 bg-amber-50",
    "Archived": "border-gray-300 text-gray-400 bg-gray-100 line-through",
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Badge variant="outline" className={`text-[10px] cursor-pointer ${colors[value] || "border-gray-300"}`} data-testid={`inline-status-${unitId}`}>
          {value}
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[140px]" data-testid={`status-menu-${unitId}`}>
        {statuses.map(s => (
          <DropdownMenuItem
            key={s}
            onClick={() => onSave(unitId, "status", s)}
            className={`text-xs cursor-pointer ${s === value ? "font-bold" : ""}`}
            data-testid={`status-option-${s}-${unitId}`}
          >
            {s}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InlineDateCell({ unitId, field, value, onSave, className = "" }: {
  unitId: string; field: string; value: string | null; onSave: (id: string, field: string, value: string) => void; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.showPicker?.(); } }, [editing]);

  if (editing) {
    return <input ref={ref} type="date" defaultValue={value || ""} onBlur={e => { setEditing(false); if (e.target.value !== (value || "")) onSave(unitId, field, e.target.value); }}
      className={`bg-white dark:bg-gray-900 border rounded px-1 py-0.5 text-xs outline-none focus:ring-1 focus:ring-teal-400 w-[110px] ${className}`} data-testid={`inline-date-${field}-${unitId}`} />;
  }

  return <span onClick={() => setEditing(true)} className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 py-0.5 -mx-1 block min-h-[18px] ${className}`} data-testid={`inline-${field}-${unitId}`}>
    {value ? formatDate(value) : <span className="text-gray-300">—</span>}
  </span>;
}

interface CrmCompanyBasic {
  id: string;
  name: string;
  meta?: string | null;       // companyType chip (Tenant / Landlord / Agent…)
  subLabel?: string | null;   // UK contracting entity (or first trading-entity alias)
  aliases?: string[];         // trading-entity names, all searchable
}

function TargetCompaniesCell({ unitId, targetCompanyIds, targetBrands, onUpdate }: {
  unitId: string;
  targetCompanyIds: string;
  targetBrands: string;
  onUpdate: (id: string, field: string, value: string) => void;
}) {
  const queryClient = useQueryClient();

  let ids: string[] = [];
  try { ids = JSON.parse(targetCompanyIds || "[]"); } catch { ids = []; }

  const { data: allCompanies = [] } = useQuery<CrmCompanyBasic[]>({
    queryKey: ["/api/crm/companies-basic"],
    queryFn: async () => {
      const res = await fetch("/api/crm/companies?limit=5000", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (data.companies || []);
      // Carry trading name + UK contracting entity + alias list so the
      // picker can show "Landsec" with "Land Securities Group Plc"
      // underneath, and match searches against either.
      return arr.map((c: any) => {
        const trading = Array.isArray(c.tradingEntities || c.trading_entities) ? (c.tradingEntities || c.trading_entities) : [];
        const aliases = trading.map((t: any) => t?.name).filter((n: any) => typeof n === "string" && n.length > 0);
        const uk = c.ukEntityName || c.uk_entity_name || null;
        return {
          id: String(c.id),
          name: c.name,
          meta: c.companyType || c.company_type || null,
          subLabel: uk || aliases[0] || null,
          aliases,
        };
      });
    },
    staleTime: 120000,
  });

  // Target picker is brand-only — exclude landlords / agents / solicitors
  // so the dropdown shows only the kinds of rows that can sensibly be
  // pitched into a unit.
  const TARGET_EXCLUDE = new Set(["Landlord", "Landlord / Client", "Client", "Agent", "Solicitor", "Investor", "Vendor", "Purchaser"]);
  const brandOptions = useMemo(
    () => (allCompanies as any[]).filter(c => !c.meta || !TARGET_EXCLUDE.has(c.meta)),
    [allCompanies],
  );

  // Multi-select via the shared picker — clicking an existing option
  // toggles it; the green "Create brand" row at the bottom creates a
  // tracked brand inline and immediately adds it to the target list.
  const toggleId = (newId: string) => {
    const nextIds = ids.includes(newId) ? ids.filter(i => i !== newId) : [...ids, newId];
    onUpdate(unitId, "target_company_ids", JSON.stringify(nextIds));
  };

  const linkedCompanies = useMemo(
    () => ids.map(id => allCompanies.find(c => c.id === id)).filter(Boolean) as CrmCompanyBasic[],
    [allCompanies, ids],
  );

  // Closed state matches the previous bespoke chip rendering so existing
  // tests + visual expectations keep working.
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!open) {
    return (
      <div ref={containerRef} className="relative">
        <div
          onClick={() => setOpen(true)}
          className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 py-0.5 -mx-1 min-h-[18px] flex flex-wrap gap-0.5"
          data-testid={`target-companies-${unitId}`}
        >
          {linkedCompanies.length > 0 ? (
            linkedCompanies.map(c => (
              <Link key={c.id} href={`/companies/${c.id}`} onClick={e => e.stopPropagation()}>
                <Badge variant="outline" className="text-[10px] cursor-pointer border-teal-300 text-teal-700 bg-teal-50 hover:bg-teal-100 px-1.5 py-0">
                  {c.name}
                </Badge>
              </Link>
            ))
          ) : targetBrands ? (
            <span className="text-[11px] text-gray-500">{targetBrands}</span>
          ) : (
            <span className="text-gray-300 italic text-[11px]">+ Target</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <CrmEntityPicker
        value={ids}
        options={brandOptions as any}
        multi
        alwaysOpen
        kind="company"
        searchPlaceholder="Search brands…"
        emptyLabel="+ Target"
        panelWidth={240}
        testIdPrefix={`target-picker-${unitId}`}
        onSelect={(opt) => toggleId(opt.id)}
        onCreate={async (name) => {
          const r = await apiRequest("POST", "/api/crm/companies", {
            name: name.trim(),
            companyType: "Tenant",
            isTrackedBrand: true,
          });
          const created = await r.json();
          queryClient.invalidateQueries({ queryKey: ["/api/crm/companies-basic"] });
          queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
          return { id: String(created.id), name: created.name, meta: created.companyType || created.company_type || null };
        }}
      />
    </div>
  );
}

interface TargetTenant {
  id: string;
  unit_id: string;
  property_id: string;
  company_id: string | null;
  brand_name: string;
  rationale: string | null;
  quality_rating: "green" | "amber" | "red";
  status: "suggested" | "approved" | "rejected" | "converted";
  suggested_by: "ai" | "manual";
  approved_by: string | null;
  outcome: string | null;
  company_name: string | null;
  company_domain: string | null;
  created_at: string;
}

function TrafficLightDot({ rating, size = "sm" }: { rating: string; size?: "sm" | "md" }) {
  const s = size === "md" ? "w-3 h-3" : "w-2.5 h-2.5";
  const colors: Record<string, string> = {
    green: "text-emerald-500",
    amber: "text-amber-500",
    red: "text-red-500",
  };
  return <Circle className={`${s} ${colors[rating] || colors.amber} fill-current`} />;
}

function TrafficLightLabel({ rating }: { rating: string }) {
  const labels: Record<string, { text: string; bg: string; border: string; color: string }> = {
    green: { text: "A-Tier", bg: "bg-emerald-50", border: "border-emerald-300", color: "text-emerald-700" },
    amber: { text: "B-Tier", bg: "bg-amber-50", border: "border-amber-300", color: "text-amber-700" },
    red: { text: "C-Tier", bg: "bg-red-50", border: "border-red-300", color: "text-red-700" },
  };
  const l = labels[rating] || labels.amber;
  return <Badge variant="outline" className={`text-[8px] px-1 py-0 ${l.bg} ${l.border} ${l.color}`}>{l.text}</Badge>;
}

function TargetTenantRow({ target, onUpdate, onDelete }: {
  target: TargetTenant;
  onUpdate: (id: string, updates: any) => void;
  onDelete: (id: string) => void;
}) {
  const [showRationale, setShowRationale] = useState(false);
  const ratings: ("green" | "amber" | "red")[] = ["green", "amber", "red"];

  return (
    <div className={`flex items-start gap-2 px-2 py-1.5 rounded-md text-xs group ${
      target.status === "rejected" ? "opacity-40" : target.status === "converted" ? "bg-emerald-50/50 dark:bg-emerald-950/20" : ""
    }`} data-testid={`target-row-${target.id}`}>
      <div className="flex items-center gap-1 shrink-0 mt-0.5">
        {ratings.map(r => (
          <button
            key={r}
            onClick={() => onUpdate(target.id, { quality_rating: r })}
            className={`p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 ${target.quality_rating === r ? "" : "opacity-20 hover:opacity-60"}`}
            data-testid={`rating-${r}-${target.id}`}
          >
            <TrafficLightDot rating={r} size="md" />
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {target.company_id ? (
            <Link href={`/companies/${target.company_id}`}>
              <span className="font-medium text-blue-600 hover:underline cursor-pointer" data-testid={`target-link-${target.id}`}>
                {target.company_name || target.brand_name}
              </span>
            </Link>
          ) : (
            <span className="font-medium">{target.brand_name}</span>
          )}
          <TrafficLightLabel rating={target.quality_rating} />
          {target.suggested_by === "ai" && (
            <Badge variant="outline" className="text-[7px] px-1 py-0 border-violet-200 text-violet-500">AI</Badge>
          )}
          {target.status === "converted" && (
            <Badge variant="outline" className="text-[7px] px-1 py-0 border-emerald-300 text-emerald-600 bg-emerald-50">Signed</Badge>
          )}
        </div>
        {target.rationale && (
          <button onClick={() => setShowRationale(!showRationale)} className="text-[11px] text-gray-400 hover:text-gray-600 mt-0.5" data-testid={`rationale-toggle-${target.id}`}>
            {showRationale ? target.rationale : "View rationale..."}
          </button>
        )}
      </div>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {target.status === "suggested" && (
          <>
            <button onClick={() => onUpdate(target.id, { status: "approved" })} className="p-1 hover:bg-emerald-100 rounded" title="Approve" data-testid={`approve-${target.id}`}>
              <ThumbsUp className="w-3 h-3 text-emerald-500" />
            </button>
            <button onClick={() => onUpdate(target.id, { status: "rejected" })} className="p-1 hover:bg-red-100 rounded" title="Reject" data-testid={`reject-${target.id}`}>
              <ThumbsDown className="w-3 h-3 text-red-400" />
            </button>
          </>
        )}
        {target.status === "rejected" && (
          <button onClick={() => onUpdate(target.id, { status: "suggested" })} className="p-1 hover:bg-gray-100 rounded" title="Restore" data-testid={`restore-${target.id}`}>
            <Check className="w-3 h-3 text-gray-400" />
          </button>
        )}
        <button onClick={() => onDelete(target.id)} className="p-1 hover:bg-red-100 rounded" title="Remove" data-testid={`delete-target-${target.id}`}>
          <X className="w-3 h-3 text-gray-300" />
        </button>
      </div>
    </div>
  );
}

function TargetTenantPanel({ unitId, propertyId, targets, onRefresh }: {
  unitId: string;
  propertyId: string;
  targets: TargetTenant[];
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newBrand, setNewBrand] = useState("");
  const [newRating, setNewRating] = useState("amber");

  const unitTargets = targets.filter(t => t.unit_id === unitId);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/leasing-schedule/unit/${unitId}/generate-targets`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) { toast({ title: "Generation failed", variant: "destructive" }); return; }
      toast({ title: "Target tenants generated" });
      onRefresh();
    } catch { toast({ title: "Generation failed", variant: "destructive" }); }
    finally { setGenerating(false); }
  };

  const handleUpdate = async (id: string, updates: any) => {
    try {
      const res = await fetch(`/api/leasing-schedule/target/${id}`, {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) { toast({ title: "Update failed", variant: "destructive" }); return; }
      onRefresh();
    } catch { toast({ title: "Update failed", variant: "destructive" }); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/leasing-schedule/target/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) { toast({ title: "Delete failed", variant: "destructive" }); return; }
      onRefresh();
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  };

  const handleAdd = async () => {
    if (!newBrand.trim()) return;
    try {
      const res = await fetch(`/api/leasing-schedule/unit/${unitId}/targets`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ brand_name: newBrand, quality_rating: newRating }),
      });
      if (!res.ok) { toast({ title: "Failed to add target", variant: "destructive" }); return; }
      setNewBrand("");
      setShowAdd(false);
      onRefresh();
      toast({ title: "Target added" });
    } catch { toast({ title: "Failed to add target", variant: "destructive" }); }
  };

  if (unitTargets.length === 0 && !generating) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={handleGenerate} className="flex items-center gap-1 text-[11px] text-violet-500 hover:text-violet-700 hover:bg-violet-50 rounded px-1.5 py-0.5" data-testid={`generate-targets-${unitId}`}>
          <Sparkles className="w-3 h-3" />AI Targets
        </button>
        <button onClick={() => setShowAdd(true)} className="text-[11px] text-gray-400 hover:text-gray-600" data-testid={`manual-target-${unitId}`}>
          <Plus className="w-3 h-3" />
        </button>
        {showAdd && (
          <div className="flex items-center gap-1">
            <input value={newBrand} onChange={e => setNewBrand(e.target.value)} placeholder="Brand name..." className="border rounded px-1.5 py-0.5 text-[11px] w-[120px]" data-testid={`new-target-input-${unitId}`}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setShowAdd(false); }} autoFocus />
            <button onClick={handleAdd} className="text-emerald-500 p-0.5"><Check className="w-3 h-3" /></button>
            <button onClick={() => setShowAdd(false)} className="text-gray-400 p-0.5"><X className="w-3 h-3" /></button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-0.5" data-testid={`target-panel-${unitId}`}>
      {generating && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-violet-500">
          <Loader2 className="w-3 h-3 animate-spin" />Generating AI targets...
        </div>
      )}
      {unitTargets.map(t => (
        <TargetTenantRow key={t.id} target={t} onUpdate={handleUpdate} onDelete={handleDelete} />
      ))}
      <div className="flex items-center gap-1 pt-0.5">
        <button onClick={handleGenerate} disabled={generating} className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-600 px-1 py-0.5 rounded hover:bg-violet-50" data-testid={`regenerate-${unitId}`}>
          <Sparkles className="w-2.5 h-2.5" />{generating ? "Generating..." : "More"}
        </button>
        <button onClick={() => setShowAdd(!showAdd)} className="text-[10px] text-gray-400 hover:text-gray-600 px-1 py-0.5" data-testid={`add-manual-${unitId}`}>
          <Plus className="w-2.5 h-2.5 inline" />Add
        </button>
      </div>
      {showAdd && (
        <div className="flex items-center gap-1 px-2 py-1">
          <input value={newBrand} onChange={e => setNewBrand(e.target.value)} placeholder="Brand name..." className="border rounded px-1.5 py-0.5 text-[11px] w-[120px]" data-testid={`new-target-input-${unitId}`}
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setShowAdd(false); }} autoFocus />
          <select value={newRating} onChange={e => setNewRating(e.target.value)} className="border rounded px-1 py-0.5 text-[11px]" data-testid={`new-target-rating-${unitId}`}>
            <option value="green">Green</option>
            <option value="amber">Amber</option>
            <option value="red">Red</option>
          </select>
          <button onClick={handleAdd} className="text-emerald-500 p-0.5"><Check className="w-3 h-3" /></button>
          <button onClick={() => setShowAdd(false)} className="text-gray-400 p-0.5"><X className="w-3 h-3" /></button>
        </div>
      )}
    </div>
  );
}

function PropertyCard({ prop }: { prop: LeasingProperty }) {
  const unitCount = Number(prop.unit_count) || 0;
  const occupiedCount = Number(prop.occupied_count) || 0;
  const occupancy = unitCount > 0 ? Math.round((occupiedCount / unitCount) * 100) : 0;
  return (
    <Link href={`/leasing-schedule/${prop.id}`}>
      <div className="border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer bg-white dark:bg-gray-900" data-testid={`property-card-${prop.id}`}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <h3 className="font-semibold text-sm">{prop.name}</h3>
            {prop.landlord_name && <p className="text-xs text-gray-500">{prop.landlord_name}</p>}
          </div>
          <div className="flex gap-1.5 items-center">
            {prop.leasing_privacy_enabled && (
              <Badge variant="outline" className="text-[11px] border-violet-300 text-violet-700 bg-violet-50" data-testid={`privacy-badge-${prop.id}`}>
                <Lock className="w-2.5 h-2.5 mr-0.5" />Private
              </Badge>
            )}
            {prop.expiring_soon > 0 && (
              <Badge variant="outline" className="text-[11px] border-amber-300 text-amber-700 bg-amber-50">
                <AlertTriangle className="w-3 h-3 mr-0.5" />{prop.expiring_soon} expiring
              </Badge>
            )}
          </div>
        </div>
        <div className="flex gap-3 text-xs text-gray-500 mb-3">
          {prop.asset_class && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{prop.asset_class}</span>}
          <span className="flex items-center gap-1"><Users className="w-3 h-3" />{prop.unit_count} units</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${occupancy}%` }} />
          </div>
          <span className="text-[11px] font-medium text-gray-600">{occupancy}%</span>
        </div>
        <div className="flex gap-3 mt-2 text-[11px]">
          <span className="text-emerald-600">{prop.occupied_count} occupied</span>
          <span className="text-gray-400">{prop.vacant_count} vacant</span>
        </div>
      </div>
    </Link>
  );
}

function UnitEditDialog({ unit, open, onClose, onSave }: {
  unit: LeasingUnit | null; open: boolean; onClose: () => void; onSave: (data: any) => void;
}) {
  const [form, setForm] = useState<any>({});
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  useState(() => {
    if (unit) setForm({ ...unit });
  });

  if (!unit) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Unit — {unit.unit_name}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Unit / Tenant Name</label>
            <Input value={form.unit_name || ""} onChange={e => set("unit_name", e.target.value)} data-testid="edit-unit-name" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Agent</label>
            <Input value={form.agent_initials || ""} onChange={e => set("agent_initials", e.target.value)} data-testid="edit-agent" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Zone</label>
            <Input value={form.zone || ""} onChange={e => set("zone", e.target.value)} data-testid="edit-zone" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Positioning</label>
            <Input value={form.positioning || ""} onChange={e => set("positioning", e.target.value)} data-testid="edit-positioning" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Status</label>
            <Select value={form.status || "Occupied"} onValueChange={v => set("status", v)}>
              <SelectTrigger data-testid="edit-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Occupied">Occupied</SelectItem>
                <SelectItem value="Vacant">Vacant</SelectItem>
                <SelectItem value="Under Offer">Under Offer</SelectItem>
                <SelectItem value="In Negotiation">In Negotiation</SelectItem>
                <SelectItem value="Archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Priority</label>
            <Input value={form.priority || ""} onChange={e => set("priority", e.target.value)} data-testid="edit-priority" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Lease Expiry</label>
            <Input type="date" value={form.lease_expiry?.split("T")[0] || ""} onChange={e => set("lease_expiry", e.target.value)} data-testid="edit-expiry" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Tenant Break</label>
            <Input type="date" value={form.lease_break?.split("T")[0] || ""} onChange={e => set("lease_break", e.target.value)} data-testid="edit-break" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Rent Review</label>
            <Input type="date" value={form.rent_review?.split("T")[0] || ""} onChange={e => set("rent_review", e.target.value)} data-testid="edit-rr" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Landlord Break</label>
            <Input type="date" value={form.landlord_break?.split("T")[0] || ""} onChange={e => set("landlord_break", e.target.value)} data-testid="edit-lb" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">MAT/psqft</label>
            <Input value={form.mat_psqft || ""} onChange={e => set("mat_psqft", e.target.value)} data-testid="edit-mat" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">LFL %</label>
            <Input value={form.lfl_percent || ""} onChange={e => set("lfl_percent", e.target.value)} data-testid="edit-lfl" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Occ. Cost %</label>
            <Input value={form.occ_cost_percent || ""} onChange={e => set("occ_cost_percent", e.target.value)} data-testid="edit-occ" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Optimum Target</label>
            <Input value={form.optimum_target || ""} onChange={e => set("optimum_target", e.target.value)} data-testid="edit-optimum" />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium text-gray-500 mb-1 block">Target Brands</label>
            <Textarea value={form.target_brands || ""} onChange={e => set("target_brands", e.target.value)} rows={2} data-testid="edit-targets" />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium text-gray-500 mb-1 block">Updates / Notes</label>
            <Textarea value={form.updates || ""} onChange={e => set("updates", e.target.value)} rows={3} data-testid="edit-updates" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="edit-cancel">Cancel</Button>
          <Button size="sm" onClick={() => onSave(form)} data-testid="edit-save">
            <Check className="w-3.5 h-3.5 mr-1" />Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PropertyScheduleView({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [editUnit, setEditUnit] = useState<LeasingUnit | null>(null);
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  const [expandedRowZones, setExpandedRowZones] = useState<Set<string>>(new Set());
  const ZONE_ROW_LIMIT = 40;
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [statFilter, setStatFilter] = useState<string | null>(null);
  const [positioningGroupFilter, setPositioningGroupFilter] = useState<string | null>(null);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [importParsing, setImportParsing] = useState(false);
  const [importPreview, setImportPreview] = useState<{ sheetName: string; sheetCount: number; rowsScanned: number; units: any[] } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  // Landsec-format importer + pull-vacant-from-tenancy
  const [landsecImporting, setLandsecImporting] = useState(false);
  const landsecFileRef = useRef<HTMLInputElement>(null);
  const [showPullVacant, setShowPullVacant] = useState(false);

  const handleImportExcel = async (file: File) => {
    setImportParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}/parse-excel`, {
        method: "POST", headers: getAuthHeaders(), body: fd,
      });
      if (!r.ok) { toast({ title: "Parse failed", description: (await r.json()).error || "Could not read file", variant: "destructive" }); return; }
      const data = await r.json();
      if (!data.units?.length) { toast({ title: "No units found", description: "AI could not extract rows from that sheet", variant: "destructive" }); return; }
      setImportPreview(data);
    } catch (e: any) {
      toast({ title: "Parse failed", description: e.message, variant: "destructive" });
    } finally {
      setImportParsing(false);
    }
  };

  const confirmImport = async () => {
    if (!importPreview?.units?.length) return;
    try {
      const r = await fetch(`/api/leasing-schedule/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ property_id: propertyId, units: importPreview.units }),
      });
      if (!r.ok) { toast({ title: "Import failed", variant: "destructive" }); return; }
      const data = await r.json();
      toast({ title: `${data.imported} units imported` });
      setImportPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    }
  };

  const { data: currentUser } = useQuery<{ id: string; username: string; is_admin: boolean }>({
    queryKey: ["/api/auth/me"],
  });

  const { data: units = [], isLoading, error: unitsError, refetch: refetchUnits } = useQuery<LeasingUnit[]>({
    queryKey: ["/api/leasing-schedule/property", propertyId],
    queryFn: async () => {
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}`, { headers: getAuthHeaders() });
      if (r.status === 403) throw new Error("ACCESS_DENIED");
      return r.json();
    },
  });

  const { data: privacyInfo } = useQuery<{ privacy_enabled: boolean; assigned_agents: { user_id: string; username: string }[] }>({
    queryKey: ["/api/leasing-schedule/property", propertyId, "privacy"],
    queryFn: () => fetch(`/api/leasing-schedule/property/${propertyId}/privacy`, { headers: getAuthHeaders() }).then(r => r.json()),
  });

  const { data: allTargets = [], refetch: refetchTargets } = useQuery<TargetTenant[]>({
    queryKey: ["/api/leasing-schedule/property", propertyId, "targets"],
    queryFn: async () => {
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}/targets`, { headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const [generatingAll, setGeneratingAll] = useState(false);
  const [aiBanding, setAiBanding] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [syncingToTenancy, setSyncingToTenancy] = useState(false);
  const handleSyncToTenancy = async () => {
    if (!confirm("Create Tenancy Schedule rows for every Leasing unit that lacks one? Links the two so the Existing column pulls live tenant data.")) return;
    setSyncingToTenancy(true);
    try {
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}/sync-to-tenancy`, {
        method: "POST", headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out?.error || "Sync failed");
      toast({ title: `Synced ${out.scanned} units`, description: `${out.created} created in Tenancy, ${out.linked} linked to existing` });
      refetchUnits();
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    } finally { setSyncingToTenancy(false); }
  };
  const handleSnapshot = async () => {
    if (!confirm("Freeze the current Leasing Schedule as the version presented at this meeting? Past snapshots remain reclaimable.")) return;
    setSnapshotting(true);
    try {
      const meetingMonth = (units.find((u: any) => u.meeting_month) as any)?.meeting_month
        || new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" }).toUpperCase();
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}/snapshot`, {
        method: "POST", headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ meetingMonth }),
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out?.error || "Snapshot failed");
      toast({ title: "Snapshot saved", description: `${out.snapshot.unit_count} units frozen for ${out.snapshot.meeting_month}` });
    } catch (e: any) {
      toast({ title: "Snapshot failed", description: e.message, variant: "destructive" });
    } finally { setSnapshotting(false); }
  };
  const handleAutoBand = async () => {
    setAiBanding(true);
    try {
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}/auto-status`, {
        method: "POST", headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out?.error || "AI banding failed");
      toast({ title: `AI banded ${out.updated} of ${out.total} units`, description: out.attempted ? `${out.attempted} classifications proposed` : undefined });
      refetchUnits();
    } catch (e: any) {
      toast({ title: "AI banding failed", description: e.message, variant: "destructive" });
    } finally { setAiBanding(false); }
  };
  const handleGenerateAll = async () => {
    setGeneratingAll(true);
    try {
      const res = await fetch(`/api/leasing-schedule/property/${propertyId}/generate-targets`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) { toast({ title: "Batch generation failed", variant: "destructive" }); return; }
      const data = await res.json();
      const genCount = data.results?.reduce((s: number, r: any) => s + (r.generated || 0), 0) || 0;
      toast({ title: `Generated targets for ${genCount} units` });
      refetchTargets();
    } catch { toast({ title: "Generation failed", variant: "destructive" }); }
    finally { setGeneratingAll(false); }
  };

  const { data: auditLog = [] } = useQuery<AuditEntry[]>({
    queryKey: ["/api/leasing-schedule/property", propertyId, "audit"],
    queryFn: () => fetch(`/api/leasing-schedule/property/${propertyId}/audit`, { headers: getAuthHeaders() }).then(r => r.json()),
    enabled: showAuditLog,
  });

  const privacyMutation = useMutation({
    mutationFn: (enabled: boolean) => apiRequest("PUT", `/api/leasing-schedule/property/${propertyId}/privacy`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId, "privacy"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/properties"] });
      toast({ title: privacyInfo?.privacy_enabled ? "Privacy mode disabled" : "Privacy mode enabled" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/leasing-schedule/unit/${data.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      // Status changes mirror server-side to available_units + crm_deals,
      // so refresh the Letting Tracker + Deals caches too — otherwise the
      // user changes status here and doesn't see the other boards update.
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      setEditUnit(null);
      toast({ title: "Unit updated" });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err?.message || "Try again", variant: "destructive" }),
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/leasing-schedule/unit", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      setShowAddUnit(false);
      toast({ title: "Unit added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/leasing-schedule/unit/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      toast({ title: "Unit removed" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/leasing-schedule/units/${id}/archive`),
    onSuccess: (_data: any, _id: string) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      toast({ title: "Unit archived" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids?: string[]) => {
      const r = await apiRequest("POST", "/api/leasing-schedule/bulk-delete", { propertyId, ids: ids ?? null });
      return r.json() as Promise<{ deleted: number }>;
    },
    onSuccess: (out) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      toast({ title: `${out.deleted} unit${out.deleted === 1 ? "" : "s"} deleted` });
    },
    onError: (err: any) => toast({ title: "Bulk delete failed", description: err.message, variant: "destructive" }),
  });

  const [includeArchived, setIncludeArchived] = useState(false);

  const inlineUpdate = (unitId: string, field: string, value: string) => {
    updateMutation.mutate({ id: unitId, [field]: value });
  };

  const propertyName = units[0]?.property_name || "Property";
  const landlordName = units[0]?.landlord_name || "";

  const archivedCount = useMemo(() => units.filter(u => u.status === "Archived").length, [units]);

  const filteredUnits = useMemo(() => {
    return units.filter(u => {
      if (!includeArchived && u.status === "Archived") return false;
      if (debouncedSearch) {
        const s = debouncedSearch.toLowerCase();
        if (!u.unit_name?.toLowerCase().includes(s) && !u.zone?.toLowerCase().includes(s) &&
          !u.positioning?.toLowerCase().includes(s) && !u.target_brands?.toLowerCase().includes(s) &&
          !u.updates?.toLowerCase().includes(s) && !u.agent_initials?.toLowerCase().includes(s)) return false;
      }
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (statFilter === "occupied" && u.status !== "Occupied") return false;
      if (statFilter === "vacant" && u.status !== "Vacant") return false;
      if (statFilter === "expiring" && !isExpiringSoon(u.lease_expiry)) return false;
      if (statFilter === "expired" && !isExpired(u.lease_expiry)) return false;
      if (positioningGroupFilter && (u as any).positioning_group !== positioningGroupFilter) return false;
      return true;
    });
  }, [units, debouncedSearch, statusFilter, statFilter, includeArchived, positioningGroupFilter]);

  const zoneGroups = useMemo(() => {
    const groups: Record<string, LeasingUnit[]> = {};
    for (const u of filteredUnits) {
      const zone = u.zone || "Unzoned";
      if (!groups[zone]) groups[zone] = [];
      groups[zone].push(u);
    }
    return Object.entries(groups);
  }, [filteredUnits]);

  const allZones = useMemo(() => new Set(zoneGroups.map(([z]) => z)), [zoneGroups]);
  const allExpanded = expandedZones.size === 0 || allZones.size === expandedZones.size;

  const toggleZone = (zone: string) => {
    setExpandedZones(prev => {
      const next = new Set(prev);
      if (prev.size === 0) {
        for (const z of allZones) { if (z !== zone) next.add(z); }
        return next;
      }
      if (next.has(zone)) next.delete(zone); else next.add(zone);
      return next;
    });
  };

  const isZoneExpanded = (zone: string) => expandedZones.size === 0 || expandedZones.has(zone);

  const stats = useMemo(() => ({
    total: units.length,
    occupied: units.filter(u => u.status === "Occupied").length,
    vacant: units.filter(u => u.status === "Vacant").length,
    expiringSoon: units.filter(u => isExpiringSoon(u.lease_expiry)).length,
    expired: units.filter(u => isExpired(u.lease_expiry)).length,
  }), [units]);

  const handleExport = async () => {
    try {
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}/export`, { headers: getAuthHeaders() });
      if (!r.ok) { toast({ title: "Export denied", variant: "destructive" }); return; }
      const data = await r.json();
      const headers = ["Unit", "Zone", "Positioning", "Tenant", "Agent", "Status", "Lease Expiry", "Break", "Rent Review", "Rent PA", "SqFt", "MAT/psqft", "LFL%", "Occ Cost%", "Target Brands", "Optimum Target", "Priority", "Updates"];
      const csvRows = [headers.join(",")];
      for (const u of data) {
        csvRows.push([u.unit_name, u.zone, u.positioning, u.tenant_name, u.agent_initials, u.status,
          u.lease_expiry, u.lease_break, u.rent_review, u.rent_pa, u.sqft, u.mat_psqft,
          u.lfl_percent, u.occ_cost_percent, u.target_brands, u.optimum_target, u.priority, u.updates
        ].map(v => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(","));
      }
      const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${propertyName}_leasing_schedule.csv`; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Exported successfully" });
    } catch { toast({ title: "Export failed", variant: "destructive" }); }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  );

  if ((unitsError as Error)?.message === "ACCESS_DENIED") return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <ShieldOff className="w-10 h-10 text-gray-300" />
      <h3 className="text-lg font-semibold text-gray-600">Access Restricted</h3>
      <p className="text-sm text-gray-400 text-center max-w-sm">This property's leasing schedule is in privacy mode. Only assigned team members can view it.</p>
      <Link href="/leasing-schedule">
        <Button variant="outline" size="sm" data-testid="btn-back-denied">
          <ChevronLeft className="w-4 h-4 mr-1" />Back to Properties
        </Button>
      </Link>
    </div>
  );

  const isAssigned = currentUser && privacyInfo?.assigned_agents?.some(a => a.user_id === currentUser.id);
  const canTogglePrivacy = currentUser?.is_admin || isAssigned;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/leasing-schedule">
          <Button variant="ghost" size="sm" data-testid="btn-back-schedule">
            <ChevronLeft className="w-4 h-4 mr-1" />Back
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <Link href={`/properties/${propertyId}`}>
              <h2 className="text-lg font-bold hover:text-blue-600 hover:underline cursor-pointer transition-colors" data-testid="property-title">{propertyName}</h2>
            </Link>
            {privacyInfo?.privacy_enabled && (
              <Badge variant="outline" className="text-[11px] border-violet-300 text-violet-700 bg-violet-50">
                <Lock className="w-2.5 h-2.5 mr-0.5" />Private
              </Badge>
            )}
          </div>
          {landlordName && <p className="text-xs text-muted-foreground">{landlordName}</p>}
        </div>
        <div className="ml-auto flex gap-2">
          {canTogglePrivacy && (
            <Button variant="outline" size="sm" onClick={() => privacyMutation.mutate(!privacyInfo?.privacy_enabled)}
              className={privacyInfo?.privacy_enabled ? "border-violet-300 text-violet-700" : ""}
              data-testid="btn-toggle-privacy">
              {privacyInfo?.privacy_enabled ? <><ShieldCheck className="w-3.5 h-3.5 mr-1" />Privacy On</> : <><Shield className="w-3.5 h-3.5 mr-1" />Privacy Off</>}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleGenerateAll} disabled={generatingAll}
            className="border-violet-300 text-violet-700 hover:bg-violet-50" data-testid="btn-generate-all-targets">
            {generatingAll ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
            {generatingAll ? "Generating..." : "AI Targets"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAuditLog(!showAuditLog)} data-testid="btn-audit-log">
            <History className="w-3.5 h-3.5 mr-1" />Audit Log
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={handleAutoBand}
            disabled={aiBanding}
            data-testid="btn-ai-band"
            title="Ask Claude to assign A/B/C/D/Void status bands based on tenant performance + Landsec strategy"
          >
            {aiBanding ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}AI Status Bands
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={handleSnapshot}
            disabled={snapshotting}
            data-testid="btn-snapshot"
            title="Freeze the current schedule as the version presented at this Monday's meeting. Past snapshots remain reclaimable."
          >
            {snapshotting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 mr-1" />}Approve &amp; Snapshot
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => setShowSnapshots(true)}
            data-testid="btn-snapshot-history"
            title="View past snapshots"
          >
            <History className="w-3.5 h-3.5 mr-1" />History
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} data-testid="btn-export">
            <Download className="w-3.5 h-3.5 mr-1" />Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)} data-testid="btn-import">
            <Upload className="w-3.5 h-3.5 mr-1" />Import
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => landsecFileRef.current?.click()}
            disabled={landsecImporting}
            data-testid="btn-import-landsec"
            title="Import a Landsec-format leasing tracker xlsx (Zone / Existing / Targets columns)"
          >
            {landsecImporting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />}Landsec xlsx
          </Button>
          <input
            ref={landsecFileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (!propertyId) { toast({ title: "Open a property's leasing schedule first" }); return; }
              setLandsecImporting(true);
              try {
                const fd = new FormData();
                fd.append("file", f);
                fd.append("propertyId", propertyId);
                const meetingMonth = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" }).toUpperCase();
                fd.append("meetingMonth", meetingMonth);
                const r = await fetch("/api/leasing-schedule/import-landsec", { method: "POST", headers: getAuthHeaders(), body: fd });
                const out = await r.json();
                if (!r.ok) throw new Error(out.error || "Import failed");
                toast({ title: `Imported ${out.imported} rows`, description: `From sheet "${out.sheetName}"` });
                refetchUnits();
              } catch (err: any) {
                toast({ title: "Landsec import failed", description: err.message, variant: "destructive" });
              } finally {
                setLandsecImporting(false);
                e.target.value = "";
              }
            }}
          />
          <Button
            variant="outline" size="sm"
            onClick={() => setShowPullVacant(true)}
            disabled={!propertyId}
            data-testid="btn-pull-tenancy"
            title="Pull vacant units from this property's Tenancy Schedule into the Leasing Schedule"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />From Tenancy
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={handleSyncToTenancy}
            disabled={syncingToTenancy || !propertyId}
            data-testid="btn-sync-tenancy"
            title="Seed missing Tenancy Schedule rows from the Leasing Schedule. One-shot — links the two so the Existing column pulls live."
          >
            {syncingToTenancy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}Sync to Tenancy
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAddUnit(true)} data-testid="btn-add-unit">
            <Plus className="w-3.5 h-3.5 mr-1" />Add Unit
          </Button>
          {units.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const n = units.length;
                if (!confirm(`Delete ALL ${n} unit${n === 1 ? "" : "s"} on this leasing schedule? This cannot be undone.`)) return;
                if (!confirm(`Are you sure? Type 'OK' on the next prompt to confirm.`)) return;
                const typed = prompt(`Type DELETE to wipe all ${n} units:`);
                if ((typed || "").trim().toUpperCase() !== "DELETE") {
                  toast({ title: "Cancelled — text did not match" });
                  return;
                }
                bulkDeleteMutation.mutate(undefined);
              }}
              disabled={bulkDeleteMutation.isPending}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              data-testid="btn-delete-all-units"
              title="Delete every unit on this leasing schedule"
            >
              {bulkDeleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
              Delete all
            </Button>
          )}
        </div>
      </div>
      {/* Last updated + meeting month banner */}
      {(() => {
        const mostRecent = units.reduce((max: Date | null, u: any) => {
          const d = u.updated_at ? new Date(u.updated_at) : null;
          return d && (!max || d > max) ? d : max;
        }, null as Date | null);
        const lastBy = (units.find((u: any) => u.last_updated_by) as any)?.last_updated_by || null;
        const meetingMonth = (units.find((u: any) => u.meeting_month) as any)?.meeting_month || null;
        return (
          <div className="flex items-center gap-3 text-[11px] pt-2 pb-1 text-muted-foreground">
            {mostRecent && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Last updated {mostRecent.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} at {mostRecent.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                {lastBy && <span className="ml-1">by <span className="font-medium text-foreground">{lastBy}</span></span>}
              </span>
            )}
            {meetingMonth && (
              <span className="inline-flex items-center gap-1 ml-2">
                <Badge variant="outline" className="text-[11px]">For {meetingMonth} meeting</Badge>
              </span>
            )}
          </div>
        );
      })()}
      {/* Landsec status-band legend */}
      <div className="flex items-center gap-2 flex-wrap text-[11px] pt-2 pb-1 border-b border-border/40">
        <span className="text-muted-foreground uppercase tracking-wider mr-1">Status bands:</span>
        {STATUS_BANDS.map(b => (
          <span key={b.value} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${b.pillClass}`}>
            {b.label}
          </span>
        ))}
      </div>

      {/* Strategic Principles & Priorities (per-property opt-in) */}
      <StrategicPrinciplesPanel propertyId={propertyId} />

      {/* Positioning group filter chips (Landsec Key ii) — click to filter the
          schedule by umbrella category. Same UX shape as deal-status chips. */}
      <div className="flex items-center gap-2 flex-wrap text-[11px] pt-2 pb-1 border-b border-border/40">
        <span className="text-muted-foreground uppercase tracking-wider mr-1">Positioning:</span>
        <button
          onClick={() => setPositioningGroupFilter(null)}
          className={`px-2 py-0.5 rounded border ${!positioningGroupFilter ? "bg-foreground text-background border-foreground" : "text-muted-foreground hover:bg-muted"}`}
          data-testid="positioning-filter-all"
        >
          All
        </button>
        {POSITIONING_GROUPS.map(g => (
          <button
            key={g.key}
            onClick={() => setPositioningGroupFilter(positioningGroupFilter === g.key ? null : g.key)}
            className={`px-2 py-0.5 rounded border ${positioningGroupFilter === g.key ? "bg-foreground text-background border-foreground" : "text-muted-foreground hover:bg-muted"}`}
            data-testid={`positioning-filter-${g.key}`}
            title={g.subTypes}
          >
            {g.label}
          </button>
        ))}
      </div>

      <ImportAnythingDialog
        open={showImport}
        onOpenChange={setShowImport}
        defaultTarget="leasing_schedule_units"
        onCommitted={() => queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule-units"] })}
      />

      {privacyInfo?.privacy_enabled && privacyInfo.assigned_agents.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 rounded-lg text-xs">
          <Eye className="w-3.5 h-3.5 text-violet-500 shrink-0" />
          <span className="text-violet-700 dark:text-violet-300">
            Visible to: {currentUser?.is_admin ? "You (admin)" : ""}{currentUser?.is_admin && privacyInfo.assigned_agents.length > 0 ? ", " : ""}
            {privacyInfo.assigned_agents.map(a => a.username).join(", ")}
          </span>
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <button onClick={() => { setStatFilter(null); setStatusFilter("all"); }} className={`px-3 py-1.5 rounded-lg text-center transition-all ${!statFilter ? "ring-2 ring-gray-400 bg-gray-100 dark:bg-gray-700" : "bg-gray-50 dark:bg-gray-800 hover:bg-gray-100"}`} data-testid="stat-total">
          <p className="text-lg font-bold">{stats.total}</p>
          <p className="text-[11px] text-gray-500">Total Units</p>
        </button>
        <button onClick={() => { setStatFilter(statFilter === "occupied" ? null : "occupied"); setStatusFilter("all"); }} className={`px-3 py-1.5 rounded-lg text-center transition-all ${statFilter === "occupied" ? "ring-2 ring-emerald-400 bg-emerald-100 dark:bg-emerald-900/40" : "bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100"}`} data-testid="stat-occupied">
          <p className="text-lg font-bold text-emerald-700">{stats.occupied}</p>
          <p className="text-[11px] text-emerald-600">Occupied</p>
        </button>
        <button onClick={() => { setStatFilter(statFilter === "vacant" ? null : "vacant"); setStatusFilter("all"); }} className={`px-3 py-1.5 rounded-lg text-center transition-all ${statFilter === "vacant" ? "ring-2 ring-gray-400 bg-gray-200 dark:bg-gray-600" : "bg-gray-50 dark:bg-gray-800 hover:bg-gray-100"}`} data-testid="stat-vacant">
          <p className="text-lg font-bold text-gray-500">{stats.vacant}</p>
          <p className="text-[11px] text-gray-500">Vacant</p>
        </button>
        {stats.expiringSoon > 0 && (
          <button onClick={() => { setStatFilter(statFilter === "expiring" ? null : "expiring"); setStatusFilter("all"); }} className={`px-3 py-1.5 rounded-lg text-center transition-all ${statFilter === "expiring" ? "ring-2 ring-amber-400 bg-amber-100 dark:bg-amber-900/40" : "bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100"}`} data-testid="stat-expiring">
            <p className="text-lg font-bold text-amber-700">{stats.expiringSoon}</p>
            <p className="text-[11px] text-amber-600">Expiring &lt;12m</p>
          </button>
        )}
        {stats.expired > 0 && (
          <button onClick={() => { setStatFilter(statFilter === "expired" ? null : "expired"); setStatusFilter("all"); }} className={`px-3 py-1.5 rounded-lg text-center transition-all ${statFilter === "expired" ? "ring-2 ring-red-400 bg-red-100 dark:bg-red-900/40" : "bg-red-50 dark:bg-red-950/20 hover:bg-red-100"}`} data-testid="stat-expired">
            <p className="text-lg font-bold text-red-700">{stats.expired}</p>
            <p className="text-[11px] text-red-600">Expired</p>
          </button>
        )}
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search units..." className="pl-8 h-8 text-xs" data-testid="search-units" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setStatFilter(null); }}>
          <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="filter-status">
            <Filter className="w-3 h-3 mr-1" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="Occupied">Occupied</SelectItem>
            <SelectItem value="Vacant">Vacant</SelectItem>
            <SelectItem value="Under Offer">Under Offer</SelectItem>
            <SelectItem value="In Negotiation">In Negotiation</SelectItem>
            <SelectItem value="Archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        {archivedCount > 0 && (
          <button
            onClick={() => setIncludeArchived(!includeArchived)}
            className={`flex items-center gap-1.5 px-2.5 h-8 rounded-md border text-xs transition-colors ${includeArchived ? "border-gray-400 bg-gray-100 dark:bg-gray-700 text-foreground" : "border-gray-200 dark:border-gray-700 text-muted-foreground hover:bg-gray-50 dark:hover:bg-gray-800"}`}
            data-testid="toggle-include-archived"
          >
            <Eye className="w-3 h-3" />
            Archived ({archivedCount})
          </button>
        )}
        <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => setExpandedZones(new Set())} data-testid="btn-expand-all">
          {allExpanded ? "Collapse All" : "Expand All"}
        </Button>
      </div>

      <div className="space-y-3">
        {zoneGroups.map(([zone, zoneUnits]) => (
          <div key={zone} className="border rounded-lg overflow-hidden" data-testid={`zone-${zone}`}>
            <button
              onClick={() => toggleZone(zone)}
              className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-left"
              data-testid={`zone-toggle-${zone}`}
            >
              {isZoneExpanded(zone) ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              <span className="font-semibold text-sm">{cleanZoneLabel(zone)}</span>
              <Badge variant="secondary" className="text-[11px] ml-1">{zoneUnits.length}</Badge>
              {zoneUnits[0]?.positioning && (
                <span className="text-[11px] text-gray-400 ml-2 truncate">{zoneUnits[0].positioning}</span>
              )}
            </button>
            {isZoneExpanded(zone) && (
              <div className="overflow-x-auto min-w-0">
                {/* Width pinned to the colgroup total (not w-full) so the
                    columns stay at their declared sizes when the chat
                    dock opens/closes. With w-full, table-layout: fixed
                    was stretching/compressing each <col> proportionally
                    to the wrapper width, which caused the 'columns get
                    squashed' look when ChatBGP took 340px. Pinning
                    means the wrapper just scrolls horizontally. */}
                <table className="text-xs" style={{ tableLayout: "fixed", width: `${LEASING_TABLE_MIN_WIDTH}px` }} data-testid={`zone-table-${zone}`}>
                  <LeasingColgroup />
                  <thead>
                    <tr className="bg-gray-50/50 dark:bg-gray-800/50 border-b text-left text-sm">
                      <th className="px-3 py-1.5 font-medium text-gray-600 dark:text-gray-300">Existing</th>
                      <th className="px-3 py-1.5 font-medium text-gray-600 dark:text-gray-300">Positioning</th>
                      <th className="px-3 py-1.5 font-medium text-gray-600 dark:text-gray-300">Financial Performance</th>
                      <th className="px-3 py-1.5 font-medium text-gray-600 dark:text-gray-300">Targets</th>
                      <th className="px-3 py-1.5 font-medium text-gray-600 dark:text-gray-300">Optimum Target</th>
                      <th className="px-3 py-1.5 font-medium text-gray-600 dark:text-gray-300">Priority</th>
                      <th className="px-3 py-1.5 font-medium text-gray-600 dark:text-gray-300">{updatesHeaderLabel(zoneUnits)}</th>
                      <th className="px-3 py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody className="text-[13px]">
                    {(() => {
                      const showAll = expandedRowZones.has(zone);
                      const visible = showAll ? zoneUnits : zoneUnits.slice(0, ZONE_ROW_LIMIT);
                      const hasMore = zoneUnits.length > ZONE_ROW_LIMIT && !showAll;
                      return (<>
                        {visible.map(u => {
                          const band = statusBandFor((u as any).status_band);
                          const rowTint = band?.rowClass || (u.status === "Vacant" ? "bg-gray-50/50 dark:bg-gray-800/20" : "");
                          const nameColour = tenantNameColourFor((u as any).status_band);
                          const expFmt = formatLandsecDate((u as any).live_lease_expiry || u.lease_expiry);
                          const breakFmt = formatLandsecDate((u as any).live_lease_break || u.lease_break);
                          const llBreakFmt = formatLandsecDate((u as any).landlord_break);
                          const rrFmt = formatLandsecDate((u as any).live_rent_review || u.rent_review);
                          return (
                            <tr key={u.id} className={`border-b hover:brightness-95 transition-all align-top ${rowTint}`} data-testid={`unit-row-${u.id}`}>
                              {/* Existing — tenant name pulled LIVE from Tenancy Schedule
                                  when linked; clickable through to brand profile when matched
                                  to a CRM company. Colour-coded by status band. */}
                              <td className="px-3 py-2 align-top">
                                <ExistingTenantCell unit={u} nameColour={nameColour} onSave={inlineUpdate} />
                                <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                                  {expFmt && <div>(Exp. {expFmt})</div>}
                                  {breakFmt && <div>(TB {breakFmt})</div>}
                                  {llBreakFmt && <div>(LL {llBreakFmt})</div>}
                                  {rrFmt && <div>(RR {rrFmt})</div>}
                                  {!expFmt && !breakFmt && !llBreakFmt && !rrFmt && (
                                    <div className="italic opacity-60">No lease dates — link to Tenancy Schedule</div>
                                  )}
                                </div>
                              </td>
                              {/* Positioning — group (Key ii) + sub-type two-step picker */}
                              <td className="px-3 py-2 align-top">
                                <PositioningCell unitId={u.id} group={(u as any).positioning_group} subType={(u as any).positioning || ""} onSave={inlineUpdate} />
                              </td>
                              {/* Financial Performance — 3-line LFL / MAT / Occ */}
                              <td className="px-3 py-2 align-top">
                                <FinancialPerformanceCell unit={u} onSave={inlineUpdate} />
                              </td>
                              {/* Targets */}
                              <td className="px-3 py-2 align-top">
                                <TargetTenantPanel unitId={u.id} propertyId={propertyId} targets={allTargets} onRefresh={() => refetchTargets()} />
                              </td>
                              {/* Optimum Target */}
                              <td className="px-3 py-2">
                                <BrandPickerCell unitId={u.id} field="optimum_target" value={(u as any).optimum_target || ""} onSave={inlineUpdate} placeholder="Optimum target" />
                              </td>
                              {/* Priority — month/year */}
                              <td className="px-3 py-2">
                                <MonthYearCell unitId={u.id} field="priority" value={u.priority || ""} onSave={inlineUpdate} />
                              </td>
                              {/* Updates — @-mention autocomplete + task creation */}
                              <td className="px-3 py-2">
                                <MentionTextarea unitId={u.id} propertyId={propertyId} value={u.updates || ""} onSave={inlineUpdate} />
                              </td>
                              {/* Actions */}
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-0.5">
                                  <button
                                    onClick={() => { if (confirm(u.status === "Archived" ? "Restore this unit from archive?" : "Archive this unit?")) archiveMutation.mutate(u.id); }}
                                    className={`p-1 rounded ${u.status === "Archived" ? "hover:bg-emerald-100 text-emerald-500" : "hover:bg-amber-100 text-gray-400"}`}
                                    title={u.status === "Archived" ? "Restore" : "Archive"}
                                    data-testid={`archive-${u.id}`}
                                  >
                                    {u.status === "Archived" ? <History className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
                                  </button>
                                  <button onClick={() => { if (confirm("Remove this unit permanently?")) deleteMutation.mutate(u.id); }} className="p-1 hover:bg-red-100 rounded" data-testid={`delete-${u.id}`}>
                                    <Trash2 className="w-3 h-3 text-gray-400" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {hasMore && (
                          <tr>
                            <td colSpan={8} className="text-center py-2">
                              <button
                                onClick={() => setExpandedRowZones(prev => { const n = new Set(prev); n.add(zone); return n; })}
                                className="text-xs text-primary hover:underline font-medium"
                              >
                                Show all {zoneUnits.length} units ({zoneUnits.length - ZONE_ROW_LIMIT} more)
                              </button>
                            </td>
                          </tr>
                        )}
                      </>);
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      <UnitEditDialog
        unit={editUnit}
        open={!!editUnit}
        onClose={() => setEditUnit(null)}
        onSave={(data) => updateMutation.mutate(data)}
      />

      <Dialog open={showAddUnit} onOpenChange={setShowAddUnit}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Unit</DialogTitle></DialogHeader>
          <AddUnitForm propertyId={propertyId} onSave={(data) => addMutation.mutate(data)} />
        </DialogContent>
      </Dialog>

      <Dialog open={showSnapshots} onOpenChange={setShowSnapshots}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle><History className="w-4 h-4 inline mr-2" />Snapshot history — {propertyName}</DialogTitle></DialogHeader>
          <SnapshotsPanel propertyId={propertyId} />
        </DialogContent>
      </Dialog>

      <Dialog open={showPullVacant} onOpenChange={setShowPullVacant}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Pull units from Tenancy Schedule</DialogTitle></DialogHeader>
          <PullFromTenancyPanel
            propertyId={propertyId}
            onDone={() => { setShowPullVacant(false); refetchUnits(); }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showAuditLog} onOpenChange={setShowAuditLog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle><History className="w-4 h-4 inline mr-2" />Audit Log — {propertyName}</DialogTitle></DialogHeader>
          {auditLog.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No changes recorded yet</p>
          ) : (
            <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
              {auditLog.map(entry => (
                <div key={entry.id} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-xs" data-testid={`audit-${entry.id}`}>
                  <div className="shrink-0 w-[100px] text-gray-400">
                    {new Date(entry.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{" "}
                    {new Date(entry.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div className="shrink-0 font-medium text-gray-600 w-[80px]">{entry.user_name}</div>
                  <div className="flex-1">
                    <Badge variant="outline" className={`text-[10px] mr-1.5 ${
                      entry.action === "create" ? "border-emerald-300 text-emerald-700" :
                      entry.action === "delete" ? "border-red-300 text-red-700" :
                      entry.action === "privacy_toggle" ? "border-violet-300 text-violet-700" :
                      entry.action === "export" ? "border-blue-300 text-blue-700" :
                      entry.action === "import" ? "border-teal-300 text-teal-700" :
                      "border-gray-300 text-gray-600"
                    }`}>{entry.action}</Badge>
                    {entry.field_name && <span className="text-gray-500">{entry.field_name}</span>}
                    {entry.old_value && entry.new_value && (
                      <span className="text-gray-400"> : <span className="line-through text-red-400">{entry.old_value}</span> → <span className="text-emerald-600">{entry.new_value}</span></span>
                    )}
                    {!entry.old_value && entry.new_value && <span className="text-gray-400"> : {entry.new_value}</span>}
                    {entry.old_value && !entry.new_value && <span className="text-gray-400"> : <span className="line-through text-red-400">{entry.old_value}</span> removed</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddUnitForm({ propertyId, onSave }: { propertyId: string; onSave: (data: any) => void }) {
  const [form, setForm] = useState<any>({ property_id: propertyId, status: "Occupied" });
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));
  return (
    <div className="space-y-3 text-sm">
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Unit / Tenant Name *</label>
        <Input value={form.unit_name || ""} onChange={e => set("unit_name", e.target.value)} data-testid="add-unit-name" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Zone</label>
          <Input value={form.zone || ""} onChange={e => set("zone", e.target.value)} data-testid="add-zone" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Agent</label>
          <Input value={form.agent_initials || ""} onChange={e => set("agent_initials", e.target.value)} data-testid="add-agent" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Status</label>
          <Select value={form.status} onValueChange={v => set("status", v)}>
            <SelectTrigger data-testid="add-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Occupied">Occupied</SelectItem>
              <SelectItem value="Vacant">Vacant</SelectItem>
              <SelectItem value="Under Offer">Under Offer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Lease Expiry</label>
          <Input type="date" value={form.lease_expiry || ""} onChange={e => set("lease_expiry", e.target.value)} data-testid="add-expiry" />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Positioning</label>
        <Input value={form.positioning || ""} onChange={e => set("positioning", e.target.value)} data-testid="add-positioning" />
      </div>
      <Button size="sm" onClick={() => { if (form.unit_name) onSave(form); }} disabled={!form.unit_name} data-testid="add-save">
        <Plus className="w-3.5 h-3.5 mr-1" />Add Unit
      </Button>
    </div>
  );
}

function TargetCompanyNames({ targetCompanyIds, targetBrands }: { targetCompanyIds: string; targetBrands: string }) {
  let ids: string[] = [];
  try { ids = JSON.parse(targetCompanyIds || "[]"); } catch { ids = []; }
  const { data: allCompanies } = useQuery<CrmCompanyBasic[]>({
    queryKey: ["/api/crm/companies-basic"],
    queryFn: async () => {
      const res = await fetch("/api/crm/companies?limit=5000", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (data.companies || []);
      return arr.map((c: any) => ({ id: c.id, name: c.name }));
    },
    staleTime: 120000,
  });
  if (ids.length > 0 && allCompanies) {
    const resolved = ids
      .map(id => ({ id, name: allCompanies.find(c => c.id === id)?.name }))
      .filter(x => x.name);
    if (resolved.length > 0) return <span className="flex flex-wrap gap-0.5">{resolved.map((r, i) => (
      <Link
        key={i}
        href={`/companies/${r.id}`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center hover:underline"
      >
        <Badge variant="outline" className="text-[8px] border-teal-300 text-teal-700 bg-teal-50 px-1 py-0 cursor-pointer">
          {r.name}
        </Badge>
      </Link>
    ))}</span>;
  }
  return <span>{targetBrands || "—"}</span>;
}

export function PropertyLeasingSchedule({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set(["__all__"]));
  // Excel import state — referenced by the "Import Excel" button + preview
  // dialog rendered further down. These were missing in this component
  // (only declared in the standalone PropertyScheduleView), which crashed
  // the property detail page with `ReferenceError: importParsing is not
  // defined` whenever the schedule was rendered.
  const [importParsing, setImportParsing] = useState(false);
  const [importPreview, setImportPreview] = useState<{ sheetName: string; sheetCount: number; rowsScanned: number; units: any[] } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const handleImportExcel = async (file: File) => {
    setImportParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}/parse-excel`, {
        method: "POST", headers: getAuthHeaders(), body: fd,
      });
      if (!r.ok) { toast({ title: "Parse failed", description: (await r.json()).error || "Could not read file", variant: "destructive" }); return; }
      const data = await r.json();
      if (!data.units?.length) { toast({ title: "No units found", description: "AI could not extract rows from that sheet", variant: "destructive" }); return; }
      setImportPreview(data);
    } catch (e: any) {
      toast({ title: "Parse failed", description: e.message, variant: "destructive" });
    } finally {
      setImportParsing(false);
    }
  };

  const confirmImport = async () => {
    if (!importPreview?.units?.length) return;
    try {
      const r = await fetch(`/api/leasing-schedule/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ property_id: propertyId, units: importPreview.units }),
      });
      if (!r.ok) { toast({ title: "Import failed", variant: "destructive" }); return; }
      const data = await r.json();
      toast({ title: `${data.imported} units imported` });
      setImportPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    }
  };

  const { data: units = [], isLoading, error: unitsError } = useQuery<LeasingUnit[]>({
    queryKey: ["/api/leasing-schedule/property", propertyId],
    queryFn: async () => {
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}`, { headers: getAuthHeaders() });
      if (r.status === 403) throw new Error("ACCESS_DENIED");
      if (!r.ok) throw new Error("LOAD_FAILED");
      return r.json();
    },
    enabled: !!propertyId,
    retry: false,
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/leasing-schedule/unit/${data.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      // Three-way status mirror: refresh the other two boards' caches so
      // a status change here shows up on the Letting Tracker + Deals board
      // without a manual reload.
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
    },
    onError: (err: any) => { toast({ title: "Update failed", description: err.message, variant: "destructive" }); },
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/leasing-schedule/unit", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      setShowAddUnit(false);
      toast({ title: "Unit added" });
    },
    onError: (err: any) => { toast({ title: "Failed to add unit", description: err.message, variant: "destructive" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/leasing-schedule/unit/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      toast({ title: "Unit removed" });
    },
    onError: (err: any) => { toast({ title: "Failed to delete unit", description: err.message, variant: "destructive" }); },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/leasing-schedule/units/${id}/archive`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      toast({ title: "Unit archived" });
    },
    onError: (err: any) => { toast({ title: "Archive failed", description: err.message, variant: "destructive" }); },
  });

  const [includeArchived, setIncludeArchived] = useState(false);

  const inlineUpdate = (unitId: string, field: string, value: string) => {
    updateMutation.mutate({ id: unitId, [field]: value });
  };

  const archivedCount = useMemo(() => units.filter(u => u.status === "Archived").length, [units]);

  const stats = useMemo(() => {
    const active = includeArchived ? units : units.filter(u => u.status !== "Archived");
    return {
      total: active.length,
      occupied: active.filter(u => u.status === "Occupied").length,
      vacant: active.filter(u => u.status === "Vacant").length,
      expiring: active.filter(u => isExpiringSoon(u.lease_expiry)).length,
      expired: active.filter(u => isExpired(u.lease_expiry)).length,
    };
  }, [units, includeArchived]);

  const filteredUnits = useMemo(() => {
    return units.filter(u => {
      if (!includeArchived && u.status === "Archived") return false;
      if (debouncedSearch) {
        const s = debouncedSearch.toLowerCase();
        if (!u.unit_name?.toLowerCase().includes(s) && !u.zone?.toLowerCase().includes(s) &&
          !u.tenant_name?.toLowerCase().includes(s) && !u.target_brands?.toLowerCase().includes(s) &&
          !u.updates?.toLowerCase().includes(s)) return false;
      }
      if (statusFilter === "occupied" && u.status !== "Occupied") return false;
      if (statusFilter === "vacant" && u.status !== "Vacant") return false;
      if (statusFilter === "expiring" && !isExpiringSoon(u.lease_expiry)) return false;
      if (statusFilter === "expired" && !isExpired(u.lease_expiry)) return false;
      return true;
    });
  }, [units, debouncedSearch, statusFilter, includeArchived]);

  const zoneGroups = useMemo(() => {
    const groups: Record<string, LeasingUnit[]> = {};
    for (const u of filteredUnits) {
      const zone = u.zone || "Unzoned";
      if (!groups[zone]) groups[zone] = [];
      groups[zone].push(u);
    }
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredUnits]);

  const handleExportExcel = async () => {
    try {
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}/export-excel`, { headers: getAuthHeaders() });
      if (!r.ok) { toast({ title: "Export failed", variant: "destructive" }); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Leasing_Schedule.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Excel exported" });
    } catch { toast({ title: "Export failed", variant: "destructive" }); }
  };

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading leasing schedule...</div>;
  if (unitsError) {
    const isAccessDenied = (unitsError as Error)?.message === "ACCESS_DENIED";
    return (
      <div className="space-y-3" data-testid="property-leasing-schedule">
        <div className="text-center py-6 text-gray-400 border rounded-lg">
          <Lock className="w-6 h-6 mx-auto mb-1 opacity-40" />
          <p className="text-xs">{isAccessDenied ? "You don't have access to this property's leasing schedule" : "Failed to load leasing schedule"}</p>
        </div>
      </div>
    );
  }
  if (units.length === 0 && !showAddUnit) return (
    <div className="space-y-3" data-testid="property-leasing-schedule">
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => importFileRef.current?.click()} disabled={importParsing} data-testid="btn-import-first">
            {importParsing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}Import Excel
          </Button>
          <input
            ref={importFileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportExcel(f);
              e.target.value = "";
            }}
          />
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAddUnit(true)} data-testid="btn-add-first-unit">
            <Plus className="w-3 h-3 mr-1" />Add Unit
          </Button>
          <Link href={`/leasing-schedule/${propertyId}`}>
            <span className="text-[11px] text-indigo-500 hover:underline flex items-center gap-1 cursor-pointer">
              <ExternalLink className="w-3 h-3" />Full Board
            </span>
          </Link>
        </div>
      </div>
      {showAddUnit && <PropAddUnitForm propertyId={propertyId} onSave={(data: any) => addMutation.mutate(data)} onCancel={() => setShowAddUnit(false)} isPending={addMutation.isPending} />}
      <div className="text-center py-6 text-gray-400 border rounded-lg">
        <Building2 className="w-6 h-6 mx-auto mb-1 opacity-40" />
        <p className="text-xs">No units in leasing schedule</p>
        <p className="text-[11px] mt-0.5">Add units or import a landlord Excel to track this property's leasing schedule</p>
      </div>

      <Dialog open={!!importPreview} onOpenChange={(v) => !v && setImportPreview(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Preview import — {importPreview?.units.length} units from "{importPreview?.sheetName}"
            </DialogTitle>
          </DialogHeader>
          <div className="text-[11px] text-muted-foreground mb-2">
            AI mapped {importPreview?.rowsScanned} rows. Review before importing — you can edit rows after.
          </div>
          <div className="overflow-auto flex-1 border rounded">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/40 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">Unit</th>
                  <th className="text-left px-2 py-1">Tenant</th>
                  <th className="text-right px-2 py-1">Sq ft</th>
                  <th className="text-right px-2 py-1">Rent £ p.a.</th>
                  <th className="text-left px-2 py-1">Expiry</th>
                  <th className="text-left px-2 py-1">Break</th>
                  <th className="text-left px-2 py-1">Review</th>
                  <th className="text-left px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {importPreview?.units.map((u, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1 font-mono">{u.unit_name || "—"}</td>
                    <td className="px-2 py-1">{u.tenant_name || "—"}</td>
                    <td className="px-2 py-1 text-right">{u.sqft ? Number(u.sqft).toLocaleString() : "—"}</td>
                    <td className="px-2 py-1 text-right">{u.rent_pa ? "£" + Number(u.rent_pa).toLocaleString() : "—"}</td>
                    <td className="px-2 py-1">{u.lease_expiry || "—"}</td>
                    <td className="px-2 py-1">{u.lease_break || "—"}</td>
                    <td className="px-2 py-1">{u.rent_review || "—"}</td>
                    <td className="px-2 py-1">{u.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setImportPreview(null)}>Cancel</Button>
            <Button size="sm" onClick={confirmImport}>Import {importPreview?.units.length} units</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  const toggleZone = (zone: string) => {
    setExpandedZones(p => {
      const next = new Set(p);
      if (next.has(zone)) next.delete(zone); else next.add(zone);
      return next;
    });
  };

  const allExpanded = expandedZones.has("__all__") || expandedZones.size === zoneGroups.length;
  const toggleAll = () => {
    if (allExpanded) {
      setExpandedZones(new Set());
    } else {
      setExpandedZones(new Set(["__all__", ...zoneGroups.map(([z]) => z)]));
    }
  };

  return (
    <div className="space-y-3" data-testid="property-leasing-schedule">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Badge variant="secondary" className="text-[11px]">{stats.total} units</Badge>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2 top-1.5 w-3 h-3 text-gray-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search units..."
              className="pl-6 pr-2 h-7 text-[11px] border rounded-md bg-background w-[140px] outline-none focus:ring-1 focus:ring-teal-400"
              data-testid="search-prop-units"
            />
          </div>
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={handleExportExcel} data-testid="btn-export-excel">
            <Download className="w-3 h-3" />Excel
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => importFileRef.current?.click()} disabled={importParsing} data-testid="btn-import-excel">
            {importParsing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}Import
          </Button>
          <input
            ref={importFileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportExcel(f);
              e.target.value = "";
            }}
          />
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setShowAddUnit(true)} data-testid="btn-add-unit-prop">
            <Plus className="w-3 h-3" />Add
          </Button>
          <Link href={`/leasing-schedule/${propertyId}`}>
            <span className="text-[11px] text-indigo-500 hover:underline flex items-center gap-1 cursor-pointer" data-testid="link-full-board">
              <ExternalLink className="w-3 h-3" />Full Board
            </span>
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
          {[
            { label: "Occupied", count: stats.occupied, color: "text-emerald-600 bg-emerald-50 border-emerald-200", key: "occupied" },
            { label: "Vacant", count: stats.vacant, color: "text-gray-600 bg-gray-50 border-gray-200", key: "vacant" },
            { label: "Expiring", count: stats.expiring, color: "text-amber-600 bg-amber-50 border-amber-200", key: "expiring" },
            { label: "Expired", count: stats.expired, color: "text-red-600 bg-red-50 border-red-200", key: "expired" },
          ].map(s => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(statusFilter === s.key ? null : s.key)}
              className={`rounded-lg border px-3 py-2 text-left transition-all ${statusFilter === s.key ? "ring-2 ring-teal-400 " + s.color : "border-gray-200 dark:border-gray-700 hover:border-gray-300"}`}
              data-testid={`stat-${s.key}`}
            >
              <div className={`text-lg font-bold ${statusFilter === s.key ? "" : "text-foreground"}`}>{s.count}</div>
              <div className={`text-[11px] font-medium ${statusFilter === s.key ? "" : "text-muted-foreground"}`}>{s.label}</div>
            </button>
          ))}
        </div>
        {archivedCount > 0 && (
          <button
            onClick={() => setIncludeArchived(!includeArchived)}
            className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] transition-colors ${includeArchived ? "border-gray-400 bg-gray-100 dark:bg-gray-700 text-foreground" : "border-gray-200 dark:border-gray-700 text-muted-foreground hover:bg-gray-50"}`}
            data-testid="toggle-include-archived-prop"
          >
            <Eye className="w-3 h-3" />
            Archived ({archivedCount})
          </button>
        )}
      </div>

      {showAddUnit && <PropAddUnitForm propertyId={propertyId} onSave={(data: any) => addMutation.mutate(data)} onCancel={() => setShowAddUnit(false)} isPending={addMutation.isPending} />}

      <div className="border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-b">
          <button onClick={toggleAll} className="text-[11px] text-gray-500 hover:text-gray-700 flex items-center gap-1" data-testid="btn-toggle-all-zones">
            {allExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
          <span className="text-[11px] text-gray-400">{filteredUnits.length} of {units.length} units</span>
        </div>

        {zoneGroups.map(([zone, zoneUnits]) => {
          const isExpanded = expandedZones.has("__all__") || expandedZones.has(zone);
          const zoneOcc = zoneUnits.filter(u => u.status === "Occupied").length;
          return (
            <div key={zone}>
              <button
                onClick={() => toggleZone(zone)}
                className="w-full flex items-center gap-2 px-3 py-1.5 bg-gray-50/50 dark:bg-gray-800/50 hover:bg-gray-100 border-b text-left"
                data-testid={`zone-header-${zone}`}
              >
                {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                <span className="font-medium text-xs">{cleanZoneLabel(zone)}</span>
                <Badge variant="secondary" className="text-[10px]">{zoneUnits.length}</Badge>
                <span className="text-[10px] text-emerald-600 ml-auto">{zoneOcc}/{zoneUnits.length} occ</span>
              </button>
              {isExpanded && (
                <div className="overflow-x-auto min-w-0">
                  <table className="text-xs" style={{ tableLayout: "fixed", width: `${LEASING_TABLE_MIN_WIDTH}px` }}>
                    <LeasingColgroup />
                    <thead>
                      <tr className="bg-gray-50/30 border-b text-left text-sm">
                        <th className="px-2 py-1 font-medium text-gray-600 dark:text-gray-300">Existing</th>
                        <th className="px-2 py-1 font-medium text-gray-600 dark:text-gray-300">Positioning</th>
                        <th className="px-2 py-1 font-medium text-gray-600 dark:text-gray-300">Financial Performance</th>
                        <th className="px-2 py-1 font-medium text-gray-600 dark:text-gray-300">Targets</th>
                        <th className="px-2 py-1 font-medium text-gray-600 dark:text-gray-300">Optimum Target</th>
                        <th className="px-2 py-1 font-medium text-gray-600 dark:text-gray-300">Priority</th>
                        <th className="px-2 py-1 font-medium text-gray-600 dark:text-gray-300">{updatesHeaderLabel(zoneUnits)}</th>
                        <th className="px-2 py-1"></th>
                      </tr>
                    </thead>
                    <tbody className="text-[13px]">
                      {zoneUnits.map(u => {
                        const band = statusBandFor((u as any).status_band);
                        const rowTint = band?.rowClass || (u.status === "Vacant" ? "bg-gray-50/50 dark:bg-gray-800/20" : "");
                        const nameColour = tenantNameColourFor((u as any).status_band);
                        const expFmt = formatLandsecDate((u as any).live_lease_expiry || u.lease_expiry);
                        const breakFmt = formatLandsecDate((u as any).live_lease_break || u.lease_break);
                        const llBreakFmt = formatLandsecDate((u as any).landlord_break);
                        const rrFmt = formatLandsecDate((u as any).live_rent_review || u.rent_review);
                        return (
                          <tr key={u.id} className={`border-b hover:brightness-95 transition-all align-top group ${rowTint} ${u.status === "Archived" ? "opacity-50" : ""}`} data-testid={`unit-row-${u.id}`}>
                            <td className="px-2 py-1.5 align-top">
                              <ExistingTenantCell unit={u} nameColour={nameColour} onSave={inlineUpdate} />
                              <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                                {expFmt && <div>(Exp. {expFmt})</div>}
                                {breakFmt && <div>(TB {breakFmt})</div>}
                                {llBreakFmt && <div>(LL {llBreakFmt})</div>}
                                {rrFmt && <div>(RR {rrFmt})</div>}
                              </div>
                            </td>
                            <td className="px-2 py-1.5 align-top">
                              <PositioningCell unitId={u.id} group={(u as any).positioning_group} subType={(u as any).positioning || ""} onSave={inlineUpdate} />
                            </td>
                            <td className="px-2 py-1.5 align-top">
                              <FinancialPerformanceCell unit={u} onSave={inlineUpdate} />
                            </td>
                            <td className="px-2 py-1.5 align-top">
                              <TargetCompaniesCell unitId={u.id} targetCompanyIds={u.target_company_ids || "[]"} targetBrands={u.target_brands || ""} onUpdate={inlineUpdate} />
                            </td>
                            <td className="px-2 py-1.5">
                              <BrandPickerCell unitId={u.id} field="optimum_target" value={(u as any).optimum_target || ""} onSave={inlineUpdate} placeholder="Optimum target" />
                            </td>
                            <td className="px-2 py-1.5">
                              <MonthYearCell unitId={u.id} field="priority" value={u.priority || ""} onSave={inlineUpdate} />
                            </td>
                            <td className="px-2 py-1.5">
                              <MentionTextarea unitId={u.id} propertyId={propertyId} value={u.updates || ""} onSave={inlineUpdate} />
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => { if (confirm(u.status === "Archived" ? "Restore this unit?" : "Archive this unit?")) archiveMutation.mutate(u.id); }}
                                  className={u.status === "Archived" ? "text-emerald-500 hover:text-emerald-700" : "text-gray-400 hover:text-amber-600"}
                                  title={u.status === "Archived" ? "Restore" : "Archive"}
                                  data-testid={`btn-archive-unit-${u.id}`}
                                >
                                  {u.status === "Archived" ? <History className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
                                </button>
                                <button
                                  onClick={() => { if (confirm("Delete this unit permanently?")) deleteMutation.mutate(u.id); }}
                                  className="text-red-400 hover:text-red-600"
                                  data-testid={`btn-delete-unit-${u.id}`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {filteredUnits.length === 0 && (
          <div className="text-center py-4 text-gray-400 text-xs">No units match your filters</div>
        )}
      </div>

      <Dialog open={!!importPreview} onOpenChange={(v) => !v && setImportPreview(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Preview import — {importPreview?.units.length} units from "{importPreview?.sheetName}"
            </DialogTitle>
          </DialogHeader>
          <div className="text-[11px] text-muted-foreground mb-2">
            AI mapped {importPreview?.rowsScanned} rows. Review before importing — you can edit individual rows after.
          </div>
          <div className="overflow-auto flex-1 border rounded">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/40 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">Unit</th>
                  <th className="text-left px-2 py-1">Tenant</th>
                  <th className="text-right px-2 py-1">Sq ft</th>
                  <th className="text-right px-2 py-1">Rent £ p.a.</th>
                  <th className="text-left px-2 py-1">Expiry</th>
                  <th className="text-left px-2 py-1">Break</th>
                  <th className="text-left px-2 py-1">Review</th>
                  <th className="text-left px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {importPreview?.units.map((u, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1 font-mono">{u.unit_name || "—"}</td>
                    <td className="px-2 py-1">{u.tenant_name || "—"}</td>
                    <td className="px-2 py-1 text-right">{u.sqft ? Number(u.sqft).toLocaleString() : "—"}</td>
                    <td className="px-2 py-1 text-right">{u.rent_pa ? "£" + Number(u.rent_pa).toLocaleString() : "—"}</td>
                    <td className="px-2 py-1">{u.lease_expiry || "—"}</td>
                    <td className="px-2 py-1">{u.lease_break || "—"}</td>
                    <td className="px-2 py-1">{u.rent_review || "—"}</td>
                    <td className="px-2 py-1">{u.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setImportPreview(null)}>Cancel</Button>
            <Button size="sm" onClick={confirmImport} data-testid="btn-confirm-import">Import {importPreview?.units.length} units</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Landsec "Key ii" positioning umbrella categories. Drives the filter chips
// at the top of the schedule + the Positioning sub-type assignment per unit.
const POSITIONING_GROUPS: Array<{ key: string; label: string; subTypes: string }> = [
  { key: "Everyday Connections", label: "Everyday Connections", subTypes: "Social Dining" },
  { key: "Quick Refuel",         label: "Quick Refuel",         subTypes: "Café / Grab & Go / QSR" },
  { key: "Joyful Gatherings",    label: "Joyful Gatherings",    subTypes: "Leisure / Bars / Premium Dining" },
  { key: "Leisurely Refuel",     label: "Leisurely Refuel",     subTypes: "Casual / Premium Casual Dining" },
];

interface StrategicPrinciples {
  enabled: boolean;
  fivePriorities: Array<{ rank: number; text: string }>;
  positioningKey: Array<{ group: string; description: string }>;
  rules: Array<{ tag: string; rule: string }>;
  topThree: Array<{ rank: number; text: string; band?: string }>;
}

const DEFAULT_PRINCIPLES: StrategicPrinciples = {
  enabled: false,
  fivePriorities: [
    { rank: 1, text: "Delivering Social Dining across all major retail schemes" },
    { rank: 2, text: "Casual Dining converted to Best-Of-QSR (↓) or Elevated Restaurants (↑)" },
    { rank: 3, text: "Elevated & Independent Cafe and Grab & Go" },
    { rank: 4, text: "Rightsizing Cinema" },
    { rank: 5, text: "Leisure: Flight To Prime" },
  ],
  positioningKey: POSITIONING_GROUPS.map(g => ({ group: g.label, description: g.subTypes })),
  rules: [
    { tag: "Divest or Void", rule: "Min x3 brands in Target + x1 in Optimum" },
    { tag: "Red", rule: "Overarching category in Target and x1 brand in Optimum" },
  ],
  topThree: [
    { rank: 1, text: "" },
    { rank: 2, text: "" },
    { rank: 3, text: "" },
  ],
};

// Editable Strategic Principles & Priorities block. Renders above the schedule
// when enabled. Toggle is per-property — most clients won't use this; Landsec
// does. Stored as JSONB on crm_properties.strategic_principles.
function StrategicPrinciplesPanel({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ principles: StrategicPrinciples | null }>({
    queryKey: ["/api/leasing-schedule/property", propertyId, "strategic-principles"],
    queryFn: () => fetch(`/api/leasing-schedule/property/${propertyId}/strategic-principles`, { headers: getAuthHeaders() }).then(r => r.json()),
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StrategicPrinciples | null>(null);
  const principles = data?.principles || null;

  const save = useMutation({
    mutationFn: async (next: StrategicPrinciples) => {
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}/strategic-principles`, {
        method: "PUT", headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ principles: next }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Save failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId, "strategic-principles"] });
      toast({ title: "Saved" });
      setEditing(false);
      setDraft(null);
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return null;

  // Not yet set up — show "Enable" CTA so user can opt in (most clients won't).
  if (!principles) {
    return (
      <div className="border rounded-lg p-3 bg-muted/20 text-xs flex items-center justify-between">
        <span className="text-muted-foreground">Strategic Principles & Priorities (Landsec key block) — not enabled for this property.</span>
        <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => save.mutate(DEFAULT_PRINCIPLES)} data-testid="btn-enable-principles">
          Enable
        </Button>
      </div>
    );
  }
  if (!principles.enabled) return null;

  const view = editing && draft ? draft : principles;
  const startEdit = () => { setDraft(JSON.parse(JSON.stringify(principles))); setEditing(true); };
  const cancelEdit = () => { setDraft(null); setEditing(false); };
  const update = (patch: Partial<StrategicPrinciples>) => { if (!draft) return; setDraft({ ...draft, ...patch }); };

  return (
    <div className="border rounded-lg p-4 bg-card/60">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold uppercase tracking-wider">Overarching Hospitality &amp; Leisure Strategic Principles &amp; Priorities</h3>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={cancelEdit}>Cancel</Button>
              <Button size="sm" className="h-7 text-[11px]" onClick={() => draft && save.mutate(draft)} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}Save
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={startEdit} data-testid="btn-edit-principles"><Pencil className="w-3 h-3 mr-1" />Edit</Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground" onClick={() => save.mutate({ ...principles, enabled: false })} data-testid="btn-disable-principles">Hide</Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
        {/* Five Priorities */}
        <div>
          <div className="font-semibold text-emerald-700 dark:text-emerald-400 mb-1.5">5 Priorities</div>
          <div className="space-y-1">
            {view.fivePriorities.map((p, i) => (
              <div key={i} className="grid grid-cols-[100px_1fr] gap-2 items-start">
                <span className="text-muted-foreground">Priority {["One", "Two", "Three", "Four", "Five"][i]}</span>
                {editing ? (
                  <Input className="h-7 text-[11px]" value={p.text} onChange={e => { const next = [...(draft!.fivePriorities)]; next[i] = { ...next[i], text: e.target.value }; update({ fivePriorities: next }); }} />
                ) : (
                  <span>{i + 1}. {p.text || <span className="italic text-muted-foreground">—</span>}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Top Three Strategic Priorities */}
        <div>
          <div className="font-semibold text-emerald-700 dark:text-emerald-400 mb-1.5">Top Three Strategic Priorities</div>
          <div className="space-y-1">
            {view.topThree.map((p, i) => (
              <div key={i} className="grid grid-cols-[100px_1fr] gap-2 items-start">
                <span className="text-muted-foreground">Priority {["One", "Two", "Three"][i]}</span>
                {editing ? (
                  <Input
                    className="h-7 text-[11px]"
                    value={p.text}
                    placeholder="e.g. West Village leasing (TG)"
                    onChange={e => { const next = [...(draft!.topThree)]; next[i] = { ...next[i], text: e.target.value }; update({ topThree: next }); }}
                  />
                ) : (
                  <span className={p.band === "AMBER" ? "text-amber-700" : p.band === "RED" ? "text-rose-700" : ""}>{p.text || <span className="italic text-muted-foreground">—</span>}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Key ii — Positioning groups */}
        <div>
          <div className="font-semibold mb-1.5">Positioning Groups (Key ii)</div>
          <div className="space-y-1">
            {view.positioningKey.map((p, i) => (
              <div key={i} className="grid grid-cols-[140px_1fr] gap-2">
                <span className="font-medium">{p.group}</span>
                <span className="text-muted-foreground">{p.description}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Rules */}
        <div>
          <div className="font-semibold mb-1.5">Rules</div>
          <div className="space-y-1">
            {view.rules.map((r, i) => (
              <div key={i} className="grid grid-cols-[120px_1fr] gap-2">
                <span className="font-medium text-rose-700">{r.tag}</span>
                <span className="text-muted-foreground">{r.rule}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Snapshot history viewer — lists past frozen versions of this property's
// Leasing Schedule. Click one to see its full row list at the time of freeze.
function SnapshotsPanel({ propertyId }: { propertyId: string }) {
  const { data, isLoading, refetch } = useQuery<{ snapshots: Array<{ id: string; meeting_month: string; taken_at: string; taken_by_name: string; unit_count: number; notes: string | null }> }>({
    queryKey: ["/api/leasing-schedule/property", propertyId, "snapshots"],
    queryFn: () => fetch(`/api/leasing-schedule/property/${propertyId}/snapshots`, { headers: getAuthHeaders() }).then(r => r.json()),
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: detail } = useQuery<{ snapshot: any }>({
    queryKey: ["/api/leasing-schedule/snapshot", openId],
    queryFn: () => fetch(`/api/leasing-schedule/snapshot/${openId}`, { headers: getAuthHeaders() }).then(r => r.json()),
    enabled: !!openId,
  });

  if (isLoading) return <div className="py-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>;
  if (!data?.snapshots?.length) return <div className="py-6 text-sm text-muted-foreground">No snapshots yet. Use "Approve & Snapshot" after each Monday meeting to freeze a version.</div>;

  return (
    <div className="space-y-3">
      <div className="border rounded divide-y">
        {data.snapshots.map(s => (
          <div key={s.id} className="px-3 py-2 hover:bg-muted/30 cursor-pointer" onClick={() => setOpenId(s.id === openId ? null : s.id)} data-testid={`snapshot-row-${s.id}`}>
            <div className="flex items-center justify-between text-xs">
              <div>
                <div className="font-medium">{s.meeting_month || "Untitled"}</div>
                <div className="text-muted-foreground text-[11px]">{new Date(s.taken_at).toLocaleString("en-GB")} {s.taken_by_name ? `· by ${s.taken_by_name}` : ""} · {s.unit_count} units</div>
              </div>
              <ChevronRight className={`w-3 h-3 transition-transform ${openId === s.id ? "rotate-90" : ""}`} />
            </div>
            {openId === s.id && detail?.snapshot?.data && (
              <div className="mt-2 pt-2 border-t text-[11px]">
                <div className="max-h-[300px] overflow-y-auto space-y-0.5">
                  {(detail.snapshot.data as any[]).map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="font-medium min-w-[100px] truncate">{row.tenant_name || row.unit_name}</span>
                      <span className="text-muted-foreground truncate">{row.zone || "Unzoned"}</span>
                      <span className="ml-auto text-muted-foreground truncate max-w-[280px]">{row.updates || ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Pull units from a property's Tenancy Schedule into the Leasing Schedule.
// Lists tenancy units NOT already on the leasing schedule (matched by unit
// name) with checkboxes; vacant ones default-checked since they're the main
// use case. Each promotion fires a POST to /api/leasing-schedule/promote-from-tenancy.
function PullFromTenancyPanel({ propertyId, onDone }: { propertyId: string; onDone: () => void }) {
  const { toast } = useToast();
  const { data: list, isLoading, refetch } = useQuery<{ units: any[] }>({
    queryKey: ["/api/leasing-schedule/property", propertyId, "available-from-tenancy"],
    queryFn: () => fetch(`/api/leasing-schedule/property/${propertyId}/available-from-tenancy`, { headers: getAuthHeaders() }).then(r => r.json()),
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (list?.units) setPicked(new Set(list.units.filter((u: any) => (u.status || "").toLowerCase() === "vacant").map((u: any) => u.id)));
  }, [list?.units]);

  const promote = async () => {
    setBusy(true);
    let ok = 0, fail = 0;
    for (const id of picked) {
      try {
        const r = await fetch("/api/leasing-schedule/promote-from-tenancy", {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ tenancyUnitId: id }),
        });
        if (r.ok) ok++; else fail++;
      } catch { fail++; }
    }
    setBusy(false);
    toast({ title: `Promoted ${ok} unit${ok === 1 ? "" : "s"}`, description: fail > 0 ? `${fail} failed` : undefined });
    onDone();
  };

  if (isLoading) return <div className="py-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading tenancy schedule…</div>;
  if (!list?.units?.length) return <div className="py-6 text-sm text-muted-foreground">All tenancy units are already on the leasing schedule.</div>;

  const togglePick = (id: string) => {
    setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toggleAll = (on: boolean) => setPicked(on ? new Set(list.units.map((u: any) => u.id)) : new Set());

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Units on this property's Tenancy Schedule that aren't yet on the Leasing Schedule. Vacant units are pre-selected. Promoting copies the basic unit info; lease economics stay live-linked to the Tenancy Schedule.
      </p>
      <div className="flex items-center gap-3 text-xs">
        <button onClick={() => toggleAll(true)} className="text-primary hover:underline">Select all</button>
        <button onClick={() => toggleAll(false)} className="text-muted-foreground hover:text-foreground">Clear</button>
        <span className="ml-auto text-muted-foreground">{picked.size} selected of {list.units.length}</span>
      </div>
      <div className="border rounded max-h-[400px] overflow-y-auto divide-y">
        {list.units.map((u: any) => {
          const isVacant = (u.status || "").toLowerCase() === "vacant";
          const checked = picked.has(u.id);
          return (
            <label key={u.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30 ${isVacant ? "bg-amber-50/40 dark:bg-amber-950/20" : ""}`}>
              <input type="checkbox" checked={checked} onChange={() => togglePick(u.id)} />
              <div className="flex-1 min-w-0 text-xs">
                <div className="font-medium flex items-center gap-2">
                  {u.unit_number || u.premises || "—"}
                  {isVacant && <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700">VACANT</Badge>}
                  {u.in_leasing_schedule && <Badge variant="outline" className="text-[10px] border-blue-400 text-blue-700">Flagged</Badge>}
                </div>
                <div className="text-muted-foreground truncate">
                  {u.tenant_name || "No tenant"}{u.permitted_use ? ` · ${u.permitted_use}` : ""}{u.nia_sqft ? ` · ${u.nia_sqft.toLocaleString()} sqft NIA` : ""}{u.passing_rent_pa ? ` · £${u.passing_rent_pa.toLocaleString()} pa` : ""}
                </div>
              </div>
            </label>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onDone}>Cancel</Button>
        <Button size="sm" onClick={promote} disabled={busy || picked.size === 0} data-testid="btn-promote-from-tenancy">
          {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
          Add {picked.size} to Leasing Schedule
        </Button>
      </div>
    </div>
  );
}

function PropAddUnitForm({ propertyId, onSave, onCancel, isPending }: {
  propertyId: string; onSave: (data: any) => void; onCancel: () => void; isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [zone, setZone] = useState("");
  const [status, setStatus] = useState("Vacant");

  return (
    <div className="border rounded-lg p-3 bg-gray-50 dark:bg-gray-800/50 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[11px] text-gray-500 block mb-0.5">Unit Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Unit 1A"
            className="w-full h-7 text-xs border rounded px-2 bg-background" data-testid="input-new-unit-name" />
        </div>
        <div>
          <label className="text-[11px] text-gray-500 block mb-0.5">Zone</label>
          <input value={zone} onChange={e => setZone(e.target.value)} placeholder="e.g. Ground Floor"
            className="w-full h-7 text-xs border rounded px-2 bg-background" data-testid="input-new-unit-zone" />
        </div>
        <div>
          <label className="text-[11px] text-gray-500 block mb-0.5">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="w-full h-7 text-xs border rounded px-2 bg-background" data-testid="select-new-unit-status">
            <option value="Occupied">Occupied</option>
            <option value="Vacant">Vacant</option>
            <option value="Under Offer">Under Offer</option>
            <option value="In Negotiation">In Negotiation</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel} data-testid="btn-cancel-add-unit">Cancel</Button>
        <Button size="sm" className="h-7 text-xs" disabled={!name.trim() || isPending} data-testid="btn-save-new-unit"
          onClick={() => onSave({ property_id: propertyId, unit_name: name.trim(), zone: zone.trim() || null, status })}>
          {isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}Add Unit
        </Button>
      </div>
    </div>
  );
}

export function CompanyLeasingSchedule({ companyId }: { companyId: string }) {
  const [expandedProps, setExpandedProps] = useState<Set<string>>(new Set());
  const { data: units = [], isLoading } = useQuery<LeasingUnit[]>({
    queryKey: ["/api/leasing-schedule/company", companyId],
    queryFn: () => fetch(`/api/leasing-schedule/company/${companyId}`, { credentials: "include", headers: { ...getAuthHeaders() } }).then(r => r.json()),
    enabled: !!companyId,
  });

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading leasing schedule...</div>;
  if (units.length === 0) return null;

  const byProperty = new Map<string, { name: string; units: LeasingUnit[] }>();
  for (const u of units) {
    const key = u.property_id;
    if (!byProperty.has(key)) byProperty.set(key, { name: u.property_name || "Unknown", units: [] });
    byProperty.get(key)!.units.push(u);
  }

  const allExpanded = expandedProps.size === byProperty.size;
  const toggleProp = (id: string) => {
    setExpandedProps(p => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const totalUnits = units.length;
  const occupied = units.filter(u => u.status === "Occupied").length;
  const expiring = units.filter(u => isExpiringSoon(u.lease_expiry)).length;

  return (
    <Card>
    <CardContent className="p-3 space-y-3" data-testid="company-leasing-schedule">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Building2 className="w-4 h-4" />Leasing Schedule
          <Badge variant="secondary" className="text-[11px]">{totalUnits} units across {byProperty.size} properties</Badge>
        </h3>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-emerald-600">{occupied} occupied</span>
          {expiring > 0 && <span className="text-amber-600">{expiring} expiring</span>}
          <Link href="/leasing-schedule">
            <span className="text-indigo-500 hover:underline flex items-center gap-1 cursor-pointer" data-testid="link-leasing-board">
              <ExternalLink className="w-3 h-3" />Open Board
            </span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
    {Array.from(byProperty.entries()).map(([propId, { name, units: propUnits }]) => {
        const expanded = expandedProps.has(propId);
        const propOccupied = propUnits.filter(u => u.status === "Occupied").length;
        const propExpiring = propUnits.filter(u => isExpiringSoon(u.lease_expiry)).length;
        return (
          <div key={propId} className="border rounded-lg overflow-hidden">
            <button
              onClick={() => toggleProp(propId)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 text-left"
              data-testid={`company-prop-${propId}`}
            >
              {expanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
              <span className="font-medium text-sm">{name}</span>
              <Badge variant="secondary" className="text-[11px]">{propUnits.length}</Badge>
              <span className="text-[11px] text-emerald-600 ml-auto">{propOccupied} occ</span>
              {propExpiring > 0 && <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-600 ml-1">{propExpiring} exp</Badge>}
              <Link href={`/leasing-schedule/${propId}`}>
                <span className="text-[11px] text-indigo-500 hover:underline ml-2" onClick={e => e.stopPropagation()}>View Full</span>
              </Link>
            </button>
            {expanded && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/50 border-b text-left text-sm">
                      <th className="px-3 py-1 font-medium text-gray-500">Zone</th>
                      <th className="px-3 py-1 font-medium text-gray-500">Tenant</th>
                      <th className="px-3 py-1 font-medium text-gray-500">Status</th>
                      <th className="px-3 py-1 font-medium text-gray-500">Expiry</th>
                      <th className="px-3 py-1 font-medium text-gray-500">Performance</th>
                      <th className="px-3 py-1 font-medium text-gray-500">Targets</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs">
                    {propUnits.slice(0, 20).map(u => (
                      <tr key={u.id} className="border-b hover:bg-gray-50">
                        <td className="px-3 py-1.5 text-gray-500 max-w-[120px] truncate">{u.zone}</td>
                        <td className="px-3 py-1.5 font-medium">{u.unit_name}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant="outline" className={`text-[10px] ${u.status === "Occupied" ? "border-emerald-300 text-emerald-700" : "border-gray-300 text-gray-500"}`}>{u.status}</Badge>
                        </td>
                        <td className={`px-3 py-1.5 ${isExpired(u.lease_expiry) ? "text-red-600" : isExpiringSoon(u.lease_expiry) ? "text-amber-600" : "text-gray-600"}`}>
                          {u.lease_expiry ? formatDate(u.lease_expiry) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-[11px]">
                          {u.mat_psqft && <span>{u.mat_psqft}</span>}
                          {u.lfl_percent && <span className={`ml-1 ${u.lfl_percent.startsWith("-") ? "text-red-500" : "text-emerald-600"}`}>{u.lfl_percent}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-[11px] text-gray-500 max-w-[150px]">
                          <TargetCompanyNames targetCompanyIds={u.target_company_ids || "[]"} targetBrands={u.target_brands || ""} />
                        </td>
                      </tr>
                    ))}
                    {propUnits.length > 20 && <tr><td colSpan={6} className="px-3 py-1 text-center text-[11px] text-gray-400">+{propUnits.length - 20} more</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      </div>
    </CardContent>
    </Card>
  );
}

export default function LeasingSchedulePage() {
  const { toast } = useToast();
  const [, params] = useRoute("/leasing-schedule/:propertyId");
  const propertyId = params?.propertyId;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "card" | "board">(
    typeof window !== "undefined" && window.innerWidth < 768 ? "card" : "card"
  );
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [exporting, setExporting] = useState(false);

  // ─── Board-level import (xlsx → pick a CRM property → parse → import) ───
  const [importOpen, setImportOpen] = useState(false);
  const [importPropertyId, setImportPropertyId] = useState<string>("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStep, setImportStep] = useState<"pick" | "parsing" | "preview" | "importing">("pick");
  const [importPreview, setImportPreview] = useState<{ sheetName: string; units: any[] } | null>(null);
  // Multi-scheme: each scheme from the xlsx gets its own property mapping
  const [multiSchemes, setMultiSchemes] = useState<Array<{
    sheetName: string;
    schemeHint: string;
    units: any[];
    propertyId: string;
    skipped?: boolean;
    skipReason?: string;
    error?: string;
  }> | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const { data: properties = [], isLoading } = useQuery<LeasingProperty[]>({
    queryKey: ["/api/leasing-schedule/properties"],
    enabled: !propertyId,
  });

  const { data: crmPropertiesResp } = useQuery<any>({
    queryKey: ["/api/crm/properties", "for-leasing-import"],
    queryFn: () => fetch(`/api/crm/properties?limit=2000`, { headers: getAuthHeaders() }).then(r => r.json()),
    enabled: !propertyId,
  });
  const crmProperties: { id: string; name: string; address?: string }[] = useMemo(() => {
    const raw = Array.isArray(crmPropertiesResp) ? crmPropertiesResp : (crmPropertiesResp?.data || []);
    return raw.map((p: any) => ({ id: p.id, name: p.name || p.address || "(unnamed)", address: p.address }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  }, [crmPropertiesResp]);

  const resetImport = () => {
    setImportOpen(false);
    setImportPropertyId("");
    setImportFile(null);
    setImportStep("pick");
    setImportPreview(null);
    setMultiSchemes(null);
  };

  // Parse: always calls the multi endpoint. If it returns one scheme we drop
  // back to the single-property preview; if it returns several we go into the
  // scheme→property mapping view.
  const runBoardParse = async () => {
    if (!importFile) return;
    setImportStep("parsing");
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      const r = await fetch(`/api/leasing-schedule/parse-excel-multi`, {
        method: "POST", headers: getAuthHeaders(), body: fd,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        toast({ title: "Parse failed", description: err.error || "Could not read file", variant: "destructive" });
        setImportStep("pick");
        return;
      }
      const data = await r.json();
      const schemes: Array<{ sheetName: string; schemeHint?: string; units: any[]; skipped?: boolean; skipReason?: string; error?: string }> =
        Array.isArray(data.schemes) ? data.schemes : [];

      if (schemes.length === 0) {
        toast({ title: "No sheets found", description: "The workbook appears to be empty", variant: "destructive" });
        setImportStep("pick");
        return;
      }

      const usableCount = schemes.filter(s => Array.isArray(s.units) && s.units.length > 0).length;

      if (usableCount === 0) {
        toast({
          title: "No unit rows extracted",
          description: `Read ${schemes.length} sheet${schemes.length === 1 ? "" : "s"} but AI couldn't find unit rows on any of them`,
          variant: "destructive",
        });
        setImportStep("pick");
        return;
      }

      // If exactly one sheet has units AND it's the only sheet full-stop,
      // use the simple single-scheme preview. Otherwise always show the multi
      // view so the user can see every sheet including skipped ones.
      if (usableCount === 1 && schemes.length === 1) {
        const only = schemes.find(s => s.units.length > 0)!;
        setImportPreview({ sheetName: only.sheetName, units: only.units });
        setMultiSchemes(null);
        setImportStep("preview");
        return;
      }

      // Multi-scheme workbook: keep all sheets — including skipped/errored —
      // so the user can see and debug why a particular tab wasn't parsed.
      setMultiSchemes(schemes.map(s => ({
        sheetName: s.sheetName,
        schemeHint: s.schemeHint || s.sheetName,
        units: s.units || [],
        propertyId: importPropertyId || "",
        skipped: s.skipped,
        skipReason: s.skipReason,
        error: s.error,
      })));
      setImportPreview(null);
      setImportStep("preview");
    } catch (e: any) {
      toast({ title: "Parse failed", description: e.message, variant: "destructive" });
      setImportStep("pick");
    }
  };

  const runBoardImport = async () => {
    // Multi path
    if (multiSchemes && multiSchemes.length > 0) {
      const mapped = multiSchemes.filter(s => s.propertyId && s.units.length > 0);
      if (mapped.length === 0) {
        toast({ title: "Pick a property for at least one scheme", variant: "destructive" });
        return;
      }
      setImportStep("importing");
      try {
        const r = await fetch(`/api/leasing-schedule/import-multi`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ imports: mapped.map(s => ({ property_id: s.propertyId, units: s.units })) }),
        });
        if (!r.ok) { toast({ title: "Import failed", variant: "destructive" }); setImportStep("preview"); return; }
        const data = await r.json();
        toast({ title: `${data.totalImported} units imported across ${mapped.length} scheme${mapped.length === 1 ? "" : "s"}` });
        queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/properties"] });
        resetImport();
      } catch (e: any) {
        toast({ title: "Import failed", description: e.message, variant: "destructive" });
        setImportStep("preview");
      }
      return;
    }

    // Single path
    if (!importPreview?.units?.length || !importPropertyId) {
      toast({ title: "Pick a property for this schedule", variant: "destructive" });
      return;
    }
    setImportStep("importing");
    try {
      const r = await fetch(`/api/leasing-schedule/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ property_id: importPropertyId, units: importPreview.units }),
      });
      if (!r.ok) { toast({ title: "Import failed", variant: "destructive" }); setImportStep("preview"); return; }
      const data = await r.json();
      toast({ title: `${data.imported} units imported` });
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/properties"] });
      resetImport();
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
      setImportStep("preview");
    }
  };

  const handleExportAll = async () => {
    if (properties.length === 0) return;
    setExporting(true);
    try {
      const res = await fetch("/api/leasing-schedule/export-multi-excel", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ propertyIds: properties.map(p => p.id) }),
      });
      if (!res.ok) { toast({ title: "Export failed", variant: "destructive" }); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "BGP_Leasing_Schedules.xlsx"; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "All schedules exported to Excel" });
    } catch { toast({ title: "Export failed", variant: "destructive" }); }
    finally { setExporting(false); }
  };

  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const handleDownloadExcel = async () => {
    setDownloadingExcel(true);
    try {
      const res = await fetch("/api/leasing-schedule/export-excel", { headers: getAuthHeaders() });
      if (!res.ok) { toast({ title: "Export failed", variant: "destructive" }); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10);
      a.href = url; a.download = `BGP_Leasing_Schedule_${today}.xlsx`; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Excel downloaded" });
    } catch { toast({ title: "Export failed", variant: "destructive" }); }
    finally { setDownloadingExcel(false); }
  };

  const filtered = useMemo(() => {
    if (!debouncedSearch) return properties;
    const s = debouncedSearch.toLowerCase();
    return properties.filter(p =>
      p.name.toLowerCase().includes(s) || p.landlord_name?.toLowerCase().includes(s)
    );
  }, [properties, debouncedSearch]);

  const stats = useMemo(() => {
    const totalProps = filtered.length;
    const totalUnits = filtered.reduce((s, p) => s + p.unit_count, 0);
    const occupied = filtered.reduce((s, p) => s + p.occupied_count, 0);
    const vacant = filtered.reduce((s, p) => s + p.vacant_count, 0);
    const expiring = filtered.reduce((s, p) => s + p.expiring_soon, 0);
    const occupancy = totalUnits > 0 ? Math.round((occupied / totalUnits) * 100) : 0;
    return { totalProps, totalUnits, occupied, vacant, expiring, occupancy };
  }, [filtered]);

  const byLandlord = useMemo(() => {
    const groups: Record<string, LeasingProperty[]> = {};
    for (const p of filtered) {
      const key = p.landlord_name || "Other";
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  if (propertyId) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <PropertyScheduleView propertyId={propertyId} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="page-title">
            <Building2 className="w-5 h-5" />Leasing Schedule Board
          </h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "property" : "properties"} · {stats.totalUnits} units
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle view={viewMode} onToggle={setViewMode} />
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search properties..." className="pl-8 h-8 text-xs w-[200px]" data-testid="search-properties" />
          </div>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setImportOpen(true)} data-testid="btn-import-board">
            <Upload className="w-3.5 h-3.5" />
            Import Excel
          </Button>
          {properties.length > 0 && (
            <>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleDownloadExcel} disabled={downloadingExcel} data-testid="btn-download-excel">
                {downloadingExcel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Download Excel
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleExportAll} disabled={exporting} data-testid="btn-export-all">
                {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Export All
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stat cards — matching WIP / investment tracker style */}
      <ScrollArea className="w-full shrink-0">
        <div className="flex items-center gap-3 pb-1">
          <Card className="flex-shrink-0 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <div>
                  <p className="text-lg font-bold">{stats.totalProps}</p>
                  <p className="text-xs text-muted-foreground">Properties</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-shrink-0 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                <div>
                  <p className="text-lg font-bold">{stats.totalUnits}</p>
                  <p className="text-xs text-muted-foreground">Total Units</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-shrink-0 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <div>
                  <p className="text-lg font-bold">{stats.occupied}</p>
                  <p className="text-xs text-muted-foreground">Occupied</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-shrink-0 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                <div>
                  <p className="text-lg font-bold">{stats.vacant}</p>
                  <p className="text-xs text-muted-foreground">Vacant</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-shrink-0 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <div>
                  <p className="text-lg font-bold">{stats.expiring}</p>
                  <p className="text-xs text-muted-foreground">Expiring Soon</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-shrink-0 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                <div>
                  <p className="text-lg font-bold">{stats.occupancy}%</p>
                  <p className="text-xs text-muted-foreground">Occupancy</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : viewMode === "table" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Landlord</TableHead>
                  <TableHead>Asset Class</TableHead>
                  <TableHead className="text-center">Units</TableHead>
                  <TableHead className="text-center">Occupied</TableHead>
                  <TableHead className="text-center">Vacant</TableHead>
                  <TableHead className="text-center">Expiring</TableHead>
                  <TableHead className="text-center">Occupancy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(p => {
                  const uc = Number(p.unit_count) || 0;
                  const oc = Number(p.occupied_count) || 0;
                  const occ = uc > 0 ? Math.round((oc / uc) * 100) : 0;
                  return (
                    <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell>
                        <Link href={`/leasing-schedule/${p.id}`} className="font-medium text-sm hover:underline">{p.name}</Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.landlord_id ? (
                          <Link href={`/companies/${p.landlord_id}`} className="hover:underline text-blue-600 dark:text-blue-400" onClick={(e: any) => e.stopPropagation()}>{p.landlord_name}</Link>
                        ) : p.landlord_name || "—"}
                      </TableCell>
                      <TableCell className="text-sm">{p.asset_class || "—"}</TableCell>
                      <TableCell className="text-center text-sm font-medium">{p.unit_count}</TableCell>
                      <TableCell className="text-center text-sm text-emerald-600">{p.occupied_count}</TableCell>
                      <TableCell className="text-center text-sm text-gray-400">{p.vacant_count}</TableCell>
                      <TableCell className="text-center text-sm">
                        {p.expiring_soon > 0 ? (
                          <Badge variant="outline" className="text-[11px] border-amber-300 text-amber-700 bg-amber-50">{p.expiring_soon}</Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-16 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${occ}%` }} />
                          </div>
                          <span className="text-xs font-medium">{occ}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {filtered.length === 0 && (
            <EmptyBoardImport onImportClick={() => setImportOpen(true)} />
          )}
        </Card>
      ) : (
        <div className="space-y-6">
          {byLandlord.map(([landlord, props]) => {
            const landlordId = props[0]?.landlord_id;
            return (
            <div key={landlord}>
              <h2 className="font-semibold text-sm text-muted-foreground mb-3 flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5" />
                {landlordId ? (
                  <Link href={`/companies/${landlordId}`}>
                    <span className="hover:underline cursor-pointer text-blue-600 dark:text-blue-400" data-testid={`link-landlord-${landlordId}`}>{landlord}</span>
                  </Link>
                ) : landlord}
                <Badge variant="secondary" className="text-[11px]">{props.reduce((s, p) => s + p.unit_count, 0)} units</Badge>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {props.map(p => <PropertyCard key={p.id} prop={p} />)}
              </div>
            </div>
            );
          })}
          {filtered.length === 0 && (
            <EmptyBoardImport onImportClick={() => setImportOpen(true)} />
          )}
        </div>
      )}

      {/* Board-level Import Excel dialog */}
      <Dialog open={importOpen} onOpenChange={(o) => { if (!o) resetImport(); else setImportOpen(true); }}>
        <DialogContent className={multiSchemes ? "max-w-3xl" : "max-w-lg"}>
          <DialogHeader>
            <DialogTitle>Import Leasing Schedule from Excel</DialogTitle>
          </DialogHeader>
          {importStep === "pick" && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Drop an Excel file. If it contains <strong>multiple schemes</strong> (one per tab), you'll be able to map each one to a property after parsing.
              </p>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Excel file (.xlsx / .xls / .csv)</label>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={e => setImportFile(e.target.files?.[0] || null)}
                  data-testid="input-import-file"
                />
                <div
                  role="button"
                  onClick={() => importFileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); }}
                  onDrop={e => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) setImportFile(f);
                  }}
                  className="border-2 border-dashed rounded-md p-6 text-center cursor-pointer hover:bg-muted/40 transition"
                >
                  <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                  {importFile ? (
                    <>
                      <p className="text-sm font-medium">{importFile.name}</p>
                      <p className="text-[11px] text-muted-foreground">{(importFile.size / 1024).toFixed(0)} KB · click to change</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm">Drop your schedule here</p>
                      <p className="text-[11px] text-muted-foreground">or click to browse</p>
                    </>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Default property <span className="text-[11px] opacity-70">(used when the file has only one scheme; for multi-scheme files you'll map each scheme individually next)</span>
                </label>
                <Select value={importPropertyId} onValueChange={setImportPropertyId}>
                  <SelectTrigger className="h-9 text-sm" data-testid="select-import-property">
                    <SelectValue placeholder="Pick a property (optional for multi-scheme files)…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {crmProperties.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={resetImport}>Cancel</Button>
                <Button size="sm" onClick={runBoardParse} disabled={!importFile} data-testid="btn-import-parse">
                  Parse file
                </Button>
              </div>
            </div>
          )}
          {importStep === "parsing" && (
            <div className="py-10 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm">Reading workbook — AI is extracting the rows…</p>
              <p className="text-[11px] text-muted-foreground mt-1">This can take 10-30 seconds for large schedules.</p>
            </div>
          )}
          {importStep === "preview" && importPreview && !multiSchemes && (
            <div className="space-y-3">
              <div className="text-sm">
                Detected <strong>{importPreview.units.length}</strong> units on sheet <strong>{importPreview.sheetName}</strong>.
              </div>
              {!importPropertyId && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Which property is this schedule for?</label>
                  <Select value={importPropertyId} onValueChange={setImportPropertyId}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Pick a property…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {crmProperties.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="max-h-[300px] overflow-auto border rounded text-xs">
                <table className="w-full">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Unit</th>
                      <th className="text-left p-2">Tenant</th>
                      <th className="text-left p-2">Rent pa</th>
                      <th className="text-left p-2">Sqft</th>
                      <th className="text-left p-2">Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.units.slice(0, 50).map((u: any, i: number) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{u.unit_name || u.unit || "—"}</td>
                        <td className="p-2">{u.tenant_name || u.tenant || "—"}</td>
                        <td className="p-2">{u.rent_pa || u.rent || "—"}</td>
                        <td className="p-2">{u.sqft || u.area || "—"}</td>
                        <td className="p-2">{u.lease_expiry || u.expiry || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importPreview.units.length > 50 && (
                  <p className="text-[11px] text-muted-foreground p-2">Showing first 50 of {importPreview.units.length} rows.</p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setImportStep("pick")}>Back</Button>
                <Button size="sm" onClick={runBoardImport} disabled={!importPropertyId} data-testid="btn-import-confirm">
                  Import {importPreview.units.length} units
                </Button>
              </div>
            </div>
          )}
          {importStep === "preview" && multiSchemes && (() => {
            const mapable = multiSchemes.filter(s => s.units.length > 0);
            const skippedCount = multiSchemes.length - mapable.length;
            const mappedReady = mapable.filter(s => s.propertyId);
            return (
              <div className="space-y-3">
                <div className="text-sm">
                  Found <strong>{multiSchemes.length}</strong> sheet{multiSchemes.length === 1 ? "" : "s"}.
                  {" "}<strong>{mapable.length}</strong> with unit rows
                  ({mapable.reduce((s, x) => s + x.units.length, 0)} units total)
                  {skippedCount > 0 && <>, <strong>{skippedCount}</strong> skipped</>}.
                </div>
                <div className="max-h-[420px] overflow-auto border rounded divide-y">
                  {multiSchemes.map((scheme, idx) => {
                    const hasUnits = scheme.units.length > 0;
                    const showError = !!scheme.error;
                    const showSkipped = !hasUnits && !showError;
                    return (
                      <div key={idx} className={`p-3 space-y-2 ${!hasUnits ? "bg-muted/20" : ""}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium truncate">{scheme.schemeHint}</p>
                              {showError && <Badge variant="destructive" className="text-[11px]">error</Badge>}
                              {showSkipped && <Badge variant="secondary" className="text-[11px]">skipped</Badge>}
                              {hasUnits && <Badge variant="outline" className="text-[11px] border-emerald-500 text-emerald-700">{scheme.units.length} units</Badge>}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              Sheet "{scheme.sheetName}"
                              {scheme.skipReason && <> · {scheme.skipReason}</>}
                              {scheme.error && <> · {scheme.error}</>}
                            </p>
                          </div>
                          <div className="w-[260px] shrink-0">
                            <Select
                              value={scheme.propertyId}
                              onValueChange={(v) => {
                                setMultiSchemes(prev => prev ? prev.map((s, i) => i === idx ? { ...s, propertyId: v } : s) : prev);
                              }}
                              disabled={!hasUnits}
                            >
                              <SelectTrigger className="h-8 text-xs" data-testid={`select-scheme-${idx}`}>
                                <SelectValue placeholder={hasUnits ? "Map to property…" : "No units to import"} />
                              </SelectTrigger>
                              <SelectContent className="max-h-[260px]">
                                {crmProperties.map(p => (
                                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        {hasUnits && (
                          <div className="text-[11px] text-muted-foreground">
                            Preview:{" "}
                            {scheme.units.slice(0, 3).map((u: any) => u.tenant_name || u.unit_name || "?").join(" · ")}
                            {scheme.units.length > 3 && ` · +${scheme.units.length - 3} more`}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <p className="text-[11px] text-muted-foreground">
                    {mappedReady.length} of {mapable.length} mappable schemes ready
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setImportStep("pick")}>Back</Button>
                    <Button
                      size="sm"
                      onClick={runBoardImport}
                      disabled={mappedReady.length === 0}
                      data-testid="btn-import-multi-confirm"
                    >
                      Import {mappedReady.reduce((s, x) => s + x.units.length, 0)} units
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}
          {importStep === "importing" && (
            <div className="py-10 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm">Writing units to the schedule…</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyBoardImport({ onImportClick }: { onImportClick: () => void }) {
  return (
    <div className="text-center py-14 px-4">
      <div className="mx-auto w-14 h-14 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center mb-3">
        <Building2 className="w-7 h-7 text-blue-500" />
      </div>
      <h3 className="text-base font-semibold mb-1">No leasing schedules yet</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
        Import a landlord's Excel schedule — AI will extract units, tenants, rents, breaks and expiries into the board.
      </p>
      <Button onClick={onImportClick} className="gap-1.5" data-testid="btn-empty-import">
        <Upload className="w-4 h-4" />
        Import Excel schedule
      </Button>
      <p className="text-[11px] text-muted-foreground mt-3">
        Supports .xlsx, .xls, .csv — any landlord format.
      </p>
    </div>
  );
}

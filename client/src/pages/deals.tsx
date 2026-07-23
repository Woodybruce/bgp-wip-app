import { useQuery, useMutation } from "@tanstack/react-query";
import { ScrollableTable } from "@/components/scrollable-table";
import { XeroContactPicker, type XeroContact } from "@/components/xero-contact-picker";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Search,
  Users,
  Building2,
  AlertCircle,
  X,
  ArrowLeft,
  Handshake,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Clock,
  BarChart3,
  SlidersHorizontal,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
  Check,
  RefreshCw,
  Link2,
  FileText,
  Sparkles,
  Brain,
  Receipt,
  ExternalLink,
  Send,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  MessageCircle,
  Image as ImageIcon,
  History,
  Shield,
  Bookmark,
  BookmarkCheck,
  Mail,
  CalendarDays,
} from "lucide-react";
import { useState, useMemo, useCallback, useEffect } from "react";
import { trackRecentItem } from "@/hooks/use-recent-items";
import { useTeam } from "@/lib/team-context";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getAuthHeaders, invalidateDealCaches } from "@/lib/queryClient";
import { useRoute, Link, useLocation } from "wouter";
import type { CrmDeal, CrmProperty, CrmCompany, CrmContact, DealFeeAllocation, AvailableUnit, PropertyUnit } from "@shared/schema";
import { InlineText, InlineNumber, InlineSelect, InlineLabelSelect, InlineLinkSelect } from "@/components/inline-edit";
import { buildUserColorMap } from "@/lib/agent-colors";
import { ColumnFilterPopover } from "@/components/column-filter-popover";
import { CRM_OPTIONS, areaBasisFromAssetClass, isRetailAssetClass, teamLabel } from "@/lib/crm-options";
import { toDateInputValue } from "@/lib/format";
import { MobileCardView, ViewToggle, type MobileCardItem } from "@/components/mobile-card-view";
import { useIsMobile } from "@/hooks/use-mobile";
import { PageLayout } from "@/components/page-layout";
import { EmptyState } from "@/components/empty-state";
import { DealKanban } from "@/components/deal-kanban";
import { buildAmlCompanyMap, computeDealAmlStatus, DealAmlBadge } from "@/components/deal-aml-badge";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { EntityCombobox } from "@/components/entity-combobox";
import { PropertyCombobox } from "@/components/property-combobox";
import { SortableTableHead } from "@/components/sortable-table-head";
import { useTableSort } from "@/hooks/use-table-sort";
import { NumericStackedCell, type NumericRow } from "@/components/numeric-stacked-cell";
import { FeeAllocationEditor, type FeeAllocationRow as FeeAllocationEditorRow } from "@/components/fee-allocation-editor";
import { DealDetail } from "@/components/deal-detail";
import { DEAL_STATUS_LABELS, legacyToCode, WIP_STATUSES, type DealStatusCode } from "@shared/deal-status";

// Canonical 10-code colour map — now sourced from the shared module so the
// Letting Tracker / property summary use identical hues. Re-exported here
// because many files historically import it from @/pages/deals.
import { DEAL_STATUS_DOT_COLORS } from "@/lib/deal-status-colors";
export const DEAL_STATUS_COLORS: Record<string, string> = DEAL_STATUS_DOT_COLORS;

export const DEAL_TYPE_COLORS: Record<string, string> = {
  // Legacy — still exist in older deals
  "Acquisition": "bg-blue-600",
  "Leasing": "bg-green-600",
  "Investment": "bg-indigo-600",
  "Lease Advisory": "bg-cyan-600",
  // Current types
  "Sale": "bg-red-600",
  "Purchase": "bg-emerald-600",
  "Investment Sale": "bg-red-700",
  "Investment Acquisition": "bg-indigo-700",
  "Lease Renewal": "bg-purple-600",
  "Rent Review": "bg-orange-500",
  "Tenant Rep": "bg-rose-600",
  "Lease Acquisition": "bg-violet-600",
  "Lease Disposal": "bg-amber-600",
  "Regear": "bg-teal-600",
  "New Letting": "bg-lime-600",
  "Sub-Letting": "bg-sky-600",
  "Temp Lease": "bg-cyan-600",
  "Assignment": "bg-slate-600",
};

export const DEAL_TEAM_COLORS: Record<string, string> = {
  "Development": "bg-orange-600",
  "London F&B": "bg-rose-600",
  "London Retail": "bg-teal-600",
  "National Leasing": "bg-emerald-600",
  "Investment": "bg-purple-600",
  "Tenant Rep": "bg-rose-600",
  "Lease Advisory": "bg-cyan-600",
  "Office / Corporate": "bg-slate-600",
  "Landsec": "bg-sky-700",
};

export const DEAL_ASSET_CLASS_COLORS: Record<string, string> = {
  "Retail": "bg-indigo-500",
  "Leisure": "bg-lime-600",
  "Office": "bg-slate-600",
  "Hotel": "bg-yellow-500",
  "Resi": "bg-cyan-500",
  "Mixed Use": "bg-violet-500",
  "Other": "bg-neutral-400",
};

export const DEAL_FEE_AGREEMENT_COLORS: Record<string, string> = {
  "YES": "bg-green-600",
  "NO": "bg-red-600",
};

export const DEAL_AML_COLORS: Record<string, string> = {
  "YES": "bg-green-600",
  "NO": "bg-red-600",
};

const ALL_DEAL_GROUPS = [
  "Leasing - Targeting",
  "Leasing - Marketing",
  "Leasing - HOTs",
  "Leasing - SOLs",
  "Leasing - Exchanged",
  "Leasing - Completed",
  "Leasing Comps",
  "Investment - Available",
];

const GROUP_COLORS: Record<string, string> = {
  "Leasing - Targeting": "bg-amber-500",
  "Leasing - Marketing": "bg-sky-500",
  "Leasing - HOTs": "bg-fuchsia-600",
  "Leasing - SOLs": "bg-indigo-600",
  "Leasing - Exchanged": "bg-teal-500",
  "Leasing - Completed": "bg-green-700",
  "Leasing Comps": "bg-cyan-600",
  "Investment - Available": "bg-purple-500",
};

const COLUMN_LABELS: Record<string, string> = {
  // Consolidated cells (default on) — listed first so they sit at the
  // top of the column-visibility menu.
  unit: "Unit (standalone)",
  clientXero: "Client / Billing",
  type: "Deal Type",
  status: "Status",
  tenant: "Tenant",
  parties: "Parties",
  feeCombined: "Fee & Agreement",
  feeAlloc: "Fee Split",
  assetClass: "Asset Class",
  pricingCombined: "Pricing & Yield",
  floorAreas: "Floor Areas",
  leaseTerms: "Lease Terms",
  datesCombined: "Dates",
  sharepoint: "SharePoint",
  lastInteraction: "Last Touch",
  // Legacy single-field columns (default off, kept toggleable).
  landlord: "Client (legacy)",
  team: "Team (legacy)",
  agent: "BGP Contact (legacy)",
  clientContact: "Client Contact (legacy)",
  vendor: "Vendor (legacy)",
  purchaser: "Purchaser (legacy)",
  vendorAgent: "Vendor Agent (legacy)",
  acquisitionAgent: "Acquisition Agent (legacy)",
  purchaserAgent: "Purchaser Agent (legacy)",
  leasingAgent: "Leasing Agent (legacy)",
  pricing: "Pricing (legacy)",
  yield: "Yield % (legacy)",
  fee: "Fee (legacy)",
  feeAgreement: "Fee Agreement (legacy)",
  xeroContact: "Xero Contact (legacy)",
  pricePsf: "Price PSF (legacy)",
  priceItza: "Price ITZA (legacy)",
  rentPa: "Headline Rent (legacy)",
  capitalContribution: "Capital Contribution (legacy)",
  rentFree: "Rent Free (legacy)",
  leaseLength: "Lease Length (legacy)",
  breakOption: "Break Option (legacy)",
  dateAdded: "Date Added (legacy)",
  instructedAt: "Instructed",
  targetDate: "Target Date (legacy)",
  exchangedAt: "Exchanged",
  completedAt: "Completed",
  invoicedAt: "Invoiced",
  rentAnalysis: "Rent Analysis (legacy)",
};

// Drizzle `numeric` columns arrive as strings over JSON, so these accept
// string | number and coerce before formatting.
export function formatCurrency(val: number | string | null | undefined): string {
  if (val == null || val === "") return "—";
  const n = typeof val === "string" ? Number(val) : val;
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
}

export function formatNumber(val: number | string | null | undefined): string {
  if (val == null || val === "") return "—";
  const n = typeof val === "string" ? Number(val) : val;
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-GB").format(n);
}

export function formatDate(val: string | Date | null | undefined): string {
  if (!val) return "—";
  try {
    return new Date(val).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return typeof val === "string" ? val : "—";
  }
}

// Native datalist of every PO number already seen on a deal or invoice.
// Mounted alongside the PO number input so the browser surfaces suggestions
// as the user types — autocomplete without a custom popover. The Input's
// `list="deal-po-suggestions"` attribute binds to this.
function PoNumberDatalist() {
  const { data: poNumbers = [] } = useQuery<string[]>({
    queryKey: ["/api/crm/deals/po-numbers"],
    staleTime: 60_000,
  });
  return (
    <datalist id="deal-po-suggestions">
      {poNumbers.map(po => <option key={po} value={po} />)}
    </datalist>
  );
}

// Compact "Last Touch" cell — colour-coded by recency. Reads the
// deal.lastInteraction value populated by the AI activity curator.
function LastTouchCell({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="text-[10px] text-muted-foreground">—</span>;
  const t = Date.parse(iso);
  if (isNaN(t)) return <span className="text-[10px] text-muted-foreground">—</span>;
  const days = Math.round((Date.now() - t) / (1000 * 60 * 60 * 24));
  const cls = days <= 7 ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : days <= 30 ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-red-50 text-red-700 border-red-200";
  const label = days === 0 ? "today" : days === 1 ? "1d" : days < 30 ? `${days}d` : days < 365 ? `${Math.round(days / 7)}w` : `${Math.round(days / 365)}y`;
  return <Badge className={`${cls} text-[10px] font-medium`}>{label}</Badge>;
}

// ColumnFilterPopover imported from shared component


function InlineMultiSelect({
  value,
  options,
  colorMap,
  placeholder,
  onSave,
  testId,
}: {
  value: string[] | string | null;
  options: { label: string; value: string }[];
  colorMap?: Record<string, string>;
  placeholder: string;
  onSave: (val: string[]) => void;
  testId?: string;
}) {
  const current: string[] = Array.isArray(value) ? value : value ? [value] : [];

  const toggle = (name: string) => {
    const next = current.includes(name)
      ? current.filter(v => v !== name)
      : [...current, name];
    onSave(next);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-1 flex-wrap min-h-[20px]" data-testid={testId || "inline-multi-trigger"}>
          {current.length === 0 ? (
            <span className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
              <Plus className="w-3 h-3" />
              {placeholder}
            </span>
          ) : (
            current.map(v => (
              <Badge key={v} className={`text-[10px] px-1.5 py-0 text-white ${colorMap?.[v] || "bg-zinc-500"}`}>
                {options.find(o => o.value === v)?.label ?? v}
              </Badge>
            ))
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 max-h-[300px] overflow-y-auto">
        {options.map(o => (
          <DropdownMenuItem key={o.value} onClick={() => toggle(o.value)} data-testid={`${testId}-option-${o.value}`}>
            <div className={`w-3 h-3 rounded-sm border mr-2 flex items-center justify-center ${current.includes(o.value) ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
              {current.includes(o.value) && <span className="text-primary-foreground text-[8px]">✓</span>}
            </div>
            {colorMap?.[o.value] && <div className={`w-2 h-2 rounded-full ${colorMap[o.value]} mr-1`} />}
            <span className="truncate">{o.label}</span>
          </DropdownMenuItem>
        ))}
        {current.length > 0 && (
          <DropdownMenuItem onClick={() => onSave([])} data-testid={`${testId}-clear-all`}>
            <X className="w-3 h-3 mr-2 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Clear all</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface DealFormData {
  name: string;
  groupName: string;
  dealType: string;
  status: string;
  team: string[];
  internalAgent: string[];
  propertyId: string;
  unitId: string;
  landlordId: string;
  tenantId: string;
  vendorId: string;
  purchaserId: string;
  assetClass: string;
  tenureText: string;
  pricing: string;
  yieldPercent: string;
  feeAgreement: string;
  fee: string;
  totalAreaSqft: string;
  basementAreaSqft: string;
  gfAreaSqft: string;
  ffAreaSqft: string;
  itzaAreaSqft: string;
  pricePsf: string;
  priceItza: string;
  rentPa: string;
  capitalContribution: string;
  rentFree: string;
  leaseLength: string;
  breakOption: string;
  instructedAt: string;
  targetDate: string;
  exchangedAt: string;
  completedAt: string;
  invoicedAt: string;
  amlCheckCompleted: string;
  comments: string;
  lastInteraction: string;
  sharepointLink: string;
  rentAnalysis: string;
  xeroContactId: string;
  xeroContactName: string;
  xeroAccountNumber: string;
  xeroBillingAddress: any | null;
  poNumber: string;
  invoicingEmail: string;
  feePercentage: string;
  // Per-counterparty Xero contact link — the formal legal/billing
  // entity for each role. ID is a Xero ContactID GUID; cached name lets
  // the picker render without a Xero round-trip. AML reads these to
  // KYC the right legal entity.
  landlordEntityId: string;
  landlordEntityName: string;
  tenantEntityId: string;
  tenantEntityName: string;
  vendorEntityId: string;
  vendorEntityName: string;
  purchaserEntityId: string;
  purchaserEntityName: string;
}

const emptyForm: DealFormData = {
  name: "",
  groupName: "",
  dealType: "",
  // Default to SOL (Solicitors). The Deals CRM is for instructed deals;
  // anything pre-solicitors (marketing, viewings, negotiating) belongs
  // on the Letting Tracker via 'Add Unit'.
  status: "SOL",
  team: [],
  internalAgent: [],
  propertyId: "",
  unitId: "",
  landlordId: "",
  tenantId: "",
  vendorId: "",
  purchaserId: "",
  assetClass: "",
  tenureText: "",
  pricing: "",
  yieldPercent: "",
  feeAgreement: "",
  fee: "",
  totalAreaSqft: "",
  basementAreaSqft: "",
  gfAreaSqft: "",
  ffAreaSqft: "",
  itzaAreaSqft: "",
  pricePsf: "",
  priceItza: "",
  rentPa: "",
  capitalContribution: "",
  rentFree: "",
  leaseLength: "",
  breakOption: "",
  instructedAt: "",
  targetDate: "",
  exchangedAt: "",
  completedAt: "",
  invoicedAt: "",
  amlCheckCompleted: "",
  comments: "",
  lastInteraction: "",
  sharepointLink: "",
  rentAnalysis: "",
  xeroContactId: "",
  xeroContactName: "",
  xeroAccountNumber: "",
  xeroBillingAddress: null,
  poNumber: "",
  invoicingEmail: "",
  feePercentage: "",
  landlordEntityId: "",
  landlordEntityName: "",
  tenantEntityId: "",
  tenantEntityName: "",
  vendorEntityId: "",
  vendorEntityName: "",
  purchaserEntityId: "",
  purchaserEntityName: "",
};

function dealToForm(deal: CrmDeal): DealFormData {
  return {
    name: deal.name || "",
    groupName: deal.groupName || "",
    dealType: deal.dealType || "",
    status: deal.status || "",
    team: Array.isArray(deal.team) ? deal.team : deal.team ? [deal.team] : [],
    internalAgent: Array.isArray(deal.internalAgent) ? deal.internalAgent : deal.internalAgent ? [deal.internalAgent] : [],
    propertyId: deal.propertyId || "",
    unitId: deal.unitId || "",
    landlordId: deal.landlordId || "",
    tenantId: deal.tenantId || "",
    vendorId: deal.vendorId || "",
    purchaserId: deal.purchaserId || "",
    assetClass: deal.assetClass || "",
    tenureText: deal.tenureText || "",
    pricing: deal.pricing != null ? String(deal.pricing) : "",
    yieldPercent: deal.yieldPercent != null ? String(deal.yieldPercent) : "",
    feeAgreement: deal.feeAgreement || "",
    fee: deal.fee != null ? String(deal.fee) : "",
    totalAreaSqft: deal.totalAreaSqft != null ? String(deal.totalAreaSqft) : "",
    basementAreaSqft: deal.basementAreaSqft != null ? String(deal.basementAreaSqft) : "",
    gfAreaSqft: deal.gfAreaSqft != null ? String(deal.gfAreaSqft) : "",
    ffAreaSqft: deal.ffAreaSqft != null ? String(deal.ffAreaSqft) : "",
    itzaAreaSqft: deal.itzaAreaSqft != null ? String(deal.itzaAreaSqft) : "",
    pricePsf: deal.pricePsf != null ? String(deal.pricePsf) : "",
    priceItza: deal.priceItza != null ? String(deal.priceItza) : "",
    rentPa: deal.rentPa != null ? String(deal.rentPa) : "",
    capitalContribution: deal.capitalContribution != null ? String(deal.capitalContribution) : "",
    rentFree: deal.rentFree != null ? String(deal.rentFree) : "",
    leaseLength: deal.leaseLength != null ? String(deal.leaseLength) : "",
    breakOption: deal.breakOption != null ? String(deal.breakOption) : "",
    // Date-input values use local-component formatting (not UTC),
    // so a 23:00 UK timestamp stays on its UK date when round-tripped
    // through the form. See toDateInputValue.
    instructedAt: toDateInputValue(deal.instructedAt),
    targetDate: toDateInputValue(deal.targetDate),
    exchangedAt: toDateInputValue(deal.exchangedAt),
    completedAt: toDateInputValue(deal.completedAt),
    invoicedAt: toDateInputValue(deal.invoicedAt),
    amlCheckCompleted: deal.amlCheckCompleted || "",
    comments: deal.comments || "",
    lastInteraction: deal.lastInteraction || "",
    sharepointLink: deal.sharepointLink || "",
    rentAnalysis: deal.rentAnalysis != null ? String(deal.rentAnalysis) : "",
    xeroContactId: (deal as any).xeroContactId || "",
    xeroContactName: (deal as any).xeroContactName || "",
    xeroAccountNumber: (deal as any).xeroAccountNumber || "",
    xeroBillingAddress: (deal as any).xeroBillingAddress || null,
    poNumber: deal.poNumber || "",
    invoicingEmail: (deal as any).invoicingEmail || "",
    feePercentage: (deal as any).feePercentage != null ? String((deal as any).feePercentage) : "",
    landlordEntityId: (deal as any).landlordEntityId || "",
    landlordEntityName: (deal as any).landlordEntityName || "",
    tenantEntityId: (deal as any).tenantEntityId || "",
    tenantEntityName: (deal as any).tenantEntityName || "",
    vendorEntityId: (deal as any).vendorEntityId || "",
    vendorEntityName: (deal as any).vendorEntityName || "",
    purchaserEntityId: (deal as any).purchaserEntityId || "",
    purchaserEntityName: (deal as any).purchaserEntityName || "",
  };
}

function formToPayload(form: DealFormData, changeReason?: string): Record<string, unknown> {
  const parseNum = (v: string) => { if (!v) return null; const n = parseFloat(v); return isNaN(n) ? null : n; };
  const payload: Record<string, unknown> = {
    name: form.name,
    groupName: form.groupName || null,
    dealType: form.dealType || null,
    status: form.status || null,
    team: form.team.length > 0 ? form.team : null,
    internalAgent: form.internalAgent.length > 0 ? form.internalAgent : null,
    propertyId: form.propertyId || null,
    unitId: form.unitId || null,
    landlordId: form.landlordId || null,
    tenantId: form.tenantId || null,
    vendorId: form.vendorId || null,
    purchaserId: form.purchaserId || null,
    assetClass: form.assetClass || null,
    tenureText: form.tenureText || null,
    pricing: parseNum(form.pricing),
    yieldPercent: parseNum(form.yieldPercent),
    feeAgreement: form.feeAgreement || null,
    fee: parseNum(form.fee),
    basementAreaSqft: parseNum(form.basementAreaSqft),
    gfAreaSqft: parseNum(form.gfAreaSqft),
    ffAreaSqft: parseNum(form.ffAreaSqft),
    totalAreaSqft: (() => {
      const t = (parseNum(form.basementAreaSqft) || 0) + (parseNum(form.gfAreaSqft) || 0) + (parseNum(form.ffAreaSqft) || 0);
      return t > 0 ? t : null;
    })(),
    itzaAreaSqft: parseNum(form.itzaAreaSqft),
    pricePsf: parseNum(form.pricePsf),
    priceItza: parseNum(form.priceItza),
    rentPa: parseNum(form.rentPa),
    capitalContribution: parseNum(form.capitalContribution),
    rentFree: parseNum(form.rentFree),
    leaseLength: parseNum(form.leaseLength),
    breakOption: parseNum(form.breakOption),
    instructedAt: form.instructedAt || null,
    targetDate: form.targetDate || null,
    exchangedAt: form.exchangedAt || null,
    completedAt: form.completedAt || null,
    invoicedAt: form.invoicedAt || null,
    amlCheckCompleted: form.amlCheckCompleted || null,
    comments: form.comments || null,
    lastInteraction: form.lastInteraction || null,
    sharepointLink: form.sharepointLink || null,
    rentAnalysis: parseNum(form.rentAnalysis),
    xeroContactId: form.xeroContactId || null,
    xeroContactName: form.xeroContactName || null,
    xeroAccountNumber: form.xeroAccountNumber || null,
    xeroBillingAddress: form.xeroBillingAddress || null,
    poNumber: form.poNumber || null,
    invoicingEmail: form.invoicingEmail || null,
    feePercentage: parseNum(form.feePercentage),
    landlordEntityId: form.landlordEntityId || null,
    landlordEntityName: form.landlordEntityName || null,
    tenantEntityId: form.tenantEntityId || null,
    tenantEntityName: form.tenantEntityName || null,
    vendorEntityId: form.vendorEntityId || null,
    vendorEntityName: form.vendorEntityName || null,
    purchaserEntityId: form.purchaserEntityId || null,
    purchaserEntityName: form.purchaserEntityName || null,
  };
  if (changeReason) payload.changeReason = changeReason;
  return payload;
}

function formToPayloadWithLearning(form: DealFormData, changeReason: string | undefined, learning: string | undefined) {
  const p = formToPayload(form, changeReason);
  if (learning && learning.trim()) p.learning = learning.trim();
  return p;
}


// Unit picker that overlays the tenancy schedule (canonical spine)
// on top of property_units. Picking a tenancy row whose name matches
// a property_units row writes the property_units.id — the server
// then auto-stamps tenancy_unit_id. When a tenancy row has no
// matching property_units yet, the user is prompted to promote the
// spine on the property page first.
// Map a deal status code to the tenancy status we stamp on a freshly
// created unit. Keeps the tenancy spine in sync with what the deal is
// doing the moment Layla types a new unit name into the picker.
// Server returns gate failures as `409: {JSON body}` via apiRequest's
// throwIfResNotOk. This decodes the body and classifies the failure so
// callers can render a useful dialog instead of a raw error toast.
//   AML gate: { error, code: "AML_GATE_FAILED", notReady: [{name,reason,role}], hint }
//   Senior approval: { error: "Senior approval required to mark deals as ..." }
function parseGateError(message: string): { kind: "aml" | "senior" | "other"; message: string } {
  // Try JSON parse first (new gate shape)
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const body = JSON.parse(message.slice(jsonStart));
      if (body?.code === "AML_GATE_FAILED") {
        const blockers = (body.notReady || []).map((c: any) => `• ${c.name} (${c.role}) — ${c.reason}`).join("\n");
        const lines = [body.error || "AML not complete"];
        if (blockers) lines.push("", "Blocking counterparties:", blockers);
        if (body.hint) lines.push("", body.hint);
        return { kind: "aml", message: lines.join("\n") };
      }
      if (typeof body?.error === "string") {
        const senior = body.error.includes("Senior approval required") || body.error.includes("senior approval");
        return { kind: senior ? "senior" : "other", message: body.error };
      }
    } catch { /* fall through to legacy regex */ }
  }
  if (message.includes("Senior approval required")) {
    const msg = message.replace(/^\d+:\s*/, "").replace(/^{?"?error"?:?\s*"?/, "").replace(/"?\s*}?$/, "");
    return { kind: "senior", message: msg };
  }
  return { kind: "other", message };
}

function dealStatusToTenancyStatus(dealStatus: string | undefined | null): string {
  const code = legacyToCode(dealStatus || "") || dealStatus || "";
  if (code === "SOL" || code === "EXC") return "Under Offer";
  if (code === "COM") return "Occupied";
  return "Marketing";
}

function DealUnitPicker({
  propertyId, unitOptions, value, onChange, dealStatus, onUnitCreated,
}: {
  propertyId: string;
  unitOptions: Array<{ id: string; unitName: string; propertyId: string }>;
  value: string;
  onChange: (v: string) => void;
  dealStatus?: string;
  // Fires when a brand-new tenancy row is created inline. Carries the
  // tenancy row so the parent form can prefill area / asking rent.
  onUnitCreated?: (tenancyRow: { id: string; unit_number: string; gia_sqft?: number | null; nia_sqft?: number | null; itza_sqft?: number | null; marketing_rent_pa?: number | null; erv_pa?: number | null }) => void;
}) {
  const { data: tenancyUnits = [], refetch } = useQuery<Array<{
    id: string | number; unit_number: string; tenant_name: string | null;
    status: string | null; nia_sqft: number | null;
  }>>({
    queryKey: ["/api/tenancy-schedule/property", propertyId],
    queryFn: async () => {
      if (!propertyId) return [];
      const r = await fetch(`/api/tenancy-schedule/property/${propertyId}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!propertyId,
    staleTime: 60_000,
  });

  // Build combobox items. Tenancy rows that already have a matching
  // property_units shadow use the property_units id; orphans use the
  // "__tenancy__<id>" token which the server resolves on deal save.
  type Item = { id: string; label: string; subLabel?: string; keywords?: string[] };
  const items: Item[] = (() => {
    const seen = new Set<string>();
    const out: Item[] = [];
    const pUnitsByName = new Map<string, string>();
    for (const pu of unitOptions) {
      pUnitsByName.set((pu.unitName || "").trim().toLowerCase(), pu.id);
    }
    for (const t of tenancyUnits) {
      const key = (t.unit_number || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const matchedId = pUnitsByName.get(key);
      const tenantSub = t.tenant_name ? `· ${t.tenant_name}` : (t.status || "");
      out.push({
        id: matchedId || `__tenancy__${t.id}`,
        label: t.unit_number,
        subLabel: tenantSub || undefined,
        keywords: [t.tenant_name || "", t.status || ""],
      });
    }
    for (const pu of unitOptions) {
      const key = (pu.unitName || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ id: pu.id, label: pu.unitName });
    }
    return out;
  })();

  const handleCreate = async (name: string): Promise<Item> => {
    const tenancyStatus = dealStatusToTenancyStatus(dealStatus);
    const res = await fetch("/api/tenancy-schedule/unit", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ property_id: propertyId, unit_number: name, status: tenancyStatus }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(msg || "Failed to create unit");
    }
    const row = await res.json();
    // Tell the parent so it can prefill area / asking rent from this row.
    onUnitCreated?.(row);
    // Refresh the tenancy query so the new row shows up in the dropdown.
    await refetch();
    // Invalidate downstream views that list tenancy rows for this property.
    queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
    return { id: `__tenancy__${row.id}`, label: row.unit_number };
  };

  return (
    <EntityCombobox
      testId="select-deal-unit"
      placeholder={propertyId ? "Select unit" : "Pick a property first"}
      searchPlaceholder="Search units on this property…"
      emptyText="No units yet — type to create one"
      items={items}
      value={value}
      onChange={onChange}
      disabled={!propertyId}
      onCreate={propertyId ? handleCreate : undefined}
      createLabel="unit"
    />
  );
}

// Consolidated Parties cell — replaces the seven role-specific columns
// (Client Contact, Vendor, Purchaser, Vendor/Acquisition/Purchaser/Leasing
// Agent) with one. Cell shows a compact stack of the populated roles;
// clicking opens a popover containing the existing InlineLinkSelect
// editors wired with inline-create so an unknown counterparty / agent
// can be added without leaving the deals board.
type PartyRole = {
  key: "clientContactId" | "vendorId" | "purchaserId" | "vendorAgentId" | "acquisitionAgentId" | "purchaserAgentId" | "leasingAgentId";
  label: string;
  type: "contact" | "company-vendor" | "company-purchaser" | "agent";
};

const PARTY_ROLES: PartyRole[] = [
  { key: "clientContactId",    label: "Client Contact",    type: "contact" },
  { key: "vendorId",            label: "Vendor",            type: "company-vendor" },
  { key: "purchaserId",         label: "Purchaser",         type: "company-purchaser" },
  { key: "vendorAgentId",       label: "Vendor Agent",      type: "agent" },
  { key: "acquisitionAgentId",  label: "Acquisition Agent", type: "agent" },
  { key: "purchaserAgentId",    label: "Purchaser Agent",   type: "agent" },
  { key: "leasingAgentId",      label: "Leasing Agent",     type: "agent" },
];

function PartiesCell({
  deal, companies, contacts, agentCompanies, onSave, onCreated,
}: {
  deal: any;
  companies: CrmCompany[];
  contacts: CrmContact[];
  agentCompanies: CrmCompany[];
  onSave: (field: string, value: string | null) => void;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const optionsFor = (role: PartyRole) => {
    if (role.type === "contact") {
      return contacts.map(c => ({ id: c.id, name: c.name || (c as any).email || "Unknown" }));
    }
    if (role.type === "agent") {
      return agentCompanies.map(c => ({ id: c.id, name: c.name }));
    }
    // company-vendor / company-purchaser — keep the existing filter so
    // the dropdown stays scoped to the right counterparty pool.
    if (role.type === "company-vendor") {
      return companies
        .filter(c => c.companyType === "Vendor" || c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client" || c.id === deal[role.key])
        .map(c => ({ id: c.id, name: c.name }));
    }
    return companies
      .filter(c => c.companyType?.startsWith("Tenant") || c.companyType === "Purchaser" || c.companyType === "Investor" || c.id === deal[role.key])
      .map(c => ({ id: c.id, name: c.name }));
  };

  const hrefFor = (role: PartyRole, id: string) =>
    role.type === "contact" ? `/contacts/${id}` : `/companies/${id}`;

  const displayNameFor = (role: PartyRole) => {
    const id = deal[role.key];
    if (!id) return null;
    if (role.type === "contact") {
      const c = contacts.find(x => x.id === id);
      return c?.name || (c as any)?.email || "Linked contact";
    }
    const co = companies.find(x => x.id === id);
    return co?.name || "Linked company";
  };

  const createForRole = async (role: PartyRole, name: string) => {
    try {
      if (role.type === "contact") {
        const r = await apiRequest("POST", "/api/crm/contacts", { name: name.trim() });
        const created = await r.json();
        queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
        onSave(role.key, String(created.id));
        toast({ title: "Contact created", description: `${created.name || name} added.` });
      } else {
        const companyType = role.type === "company-vendor" ? "Vendor"
          : role.type === "company-purchaser" ? "Purchaser"
          : "Agent";
        const r = await apiRequest("POST", "/api/crm/companies", { name: name.trim(), companyType });
        const created = await r.json();
        queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
        onSave(role.key, String(created.id));
        toast({ title: `${companyType} created`, description: `${created.name || name} added.` });
      }
      onCreated();
    } catch (e: any) {
      toast({ title: "Create failed", description: e?.message || "Try from the CRM page", variant: "destructive" });
    }
  };

  const populated = PARTY_ROLES.filter(r => !!deal[r.key]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full text-left flex flex-col gap-0.5 px-1 py-0.5 hover:bg-accent rounded text-xs min-w-[160px]"
          data-testid={`parties-cell-${deal.id}`}
        >
          {populated.length === 0 ? (
            <span className="text-muted-foreground text-[11px] flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add party
            </span>
          ) : (
            populated.map(r => (
              <div key={r.key} className="flex items-center gap-1 truncate">
                <span className="text-[9px] uppercase text-muted-foreground tracking-wide shrink-0">{r.label}</span>
                <span className="truncate">{displayNameFor(r)}</span>
              </div>
            ))
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-3 space-y-2.5" align="start">
        <p className="text-xs font-semibold">Parties on this deal</p>
        {PARTY_ROLES.map(role => (
          <div key={role.key} className="grid grid-cols-[120px_1fr] items-center gap-2">
            <Label className="text-xs text-muted-foreground">{role.label}</Label>
            <InlineLinkSelect
              value={deal[role.key]}
              options={optionsFor(role)}
              href={deal[role.key] ? hrefFor(role, deal[role.key]) : undefined}
              onSave={(v) => onSave(role.key, v || null)}
              onCreate={(name) => createForRole(role, name)}
              placeholder={`Link ${role.label.toLowerCase()}`}
            />
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// Consolidated Lease Terms cell — replaces five SOL-stage columns
// (Rent PA, Capital Contribution, Rent Free, Lease Length, Break
// Option) with a single column. Same pattern as PartiesCell.
type LeaseTermKey = "rentPa" | "capitalContribution" | "rentFree" | "leaseLength" | "breakOption" | "rentAnalysis";
const LEASE_TERMS: Array<{ key: LeaseTermKey; label: string; prefix?: string; suffix?: string; short: string }> = [
  { key: "rentPa",              label: "Rent PA",             prefix: "£",        short: "Rent" },
  { key: "capitalContribution", label: "Capital Contribution", prefix: "£",       short: "Cap Contrib" },
  { key: "rentFree",            label: "Rent Free",            suffix: " months", short: "RF" },
  { key: "leaseLength",         label: "Lease Length",         suffix: " years",  short: "Term" },
  { key: "breakOption",         label: "Break Option",         suffix: " years",  short: "Break" },
  { key: "rentAnalysis",        label: "Rent Analysis",        prefix: "£",       short: "Analysis" },
];

function LeaseTermsCell({
  deal, onSave,
}: {
  deal: any;
  onSave: (field: string, value: number | null) => void;
}) {
  return (
    <NumericStackedCell
      row={deal}
      rows={LEASE_TERMS}
      title="Lease terms"
      emptyLabel="Add terms"
      onSave={onSave}
      testId={`lease-terms-cell-${deal.id}`}
      popoverWidth="w-[320px]"
      labelWidth="140px"
    />
  );
}

// Consolidated Property + Unit cell. Stacks the property name (linked
// to the property page) over the unit name underneath; clicking opens
// a popover with the property picker + the unit picker (which supports
// inline-create of new tenancy rows on that property).
function PropertyUnitCell({
  deal, properties, propertyUnits, onPropertySave, onPropertyCreate, onUnitSave, onUnitCreated,
}: {
  deal: any;
  properties: CrmProperty[];
  propertyUnits: PropertyUnit[];
  onPropertySave: (v: string | null) => void;
  onPropertyCreate?: (name: string) => void;
  onUnitSave: (v: string | null) => void;
  onUnitCreated?: (tenancyRow: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const propertyName = deal.propertyId
    ? (properties.find(p => p.id === deal.propertyId)?.name || "Linked property")
    : null;
  const unitName = deal.unitId
    ? (propertyUnits.find(u => u.id === deal.unitId)?.unitName || null)
    : null;
  const unitOptions = propertyUnits.filter(pu => !deal.propertyId || pu.propertyId === deal.propertyId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full text-left flex flex-col gap-0 px-1 py-0.5 hover:bg-accent rounded min-w-0 max-w-full overflow-hidden"
          data-testid={`property-unit-cell-${deal.id}`}
        >
          {propertyName ? (
            <span className="text-sm font-medium truncate" title={propertyName}>{propertyName}</span>
          ) : (
            <span className="text-muted-foreground text-[11px] flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add property
            </span>
          )}
          {unitName && (
            <span className="text-[11px] text-muted-foreground truncate">{unitName}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-3 space-y-2.5" align="start">
        <p className="text-xs font-semibold">Property &amp; unit</p>
        <div className="grid grid-cols-[80px_1fr] items-center gap-2">
          <Label className="text-xs text-muted-foreground">Property</Label>
          <InlineLinkSelect
            value={deal.propertyId}
            options={properties.map(p => ({ id: p.id, name: p.name }))}
            href={deal.propertyId ? `/properties/${deal.propertyId}` : undefined}
            onSave={onPropertySave}
            onCreate={onPropertyCreate}
            placeholder="Link property"
          />
        </div>
        <div className="grid grid-cols-[80px_1fr] items-center gap-2">
          <Label className="text-xs text-muted-foreground">Unit</Label>
          <DealUnitPicker
            propertyId={deal.propertyId || ""}
            unitOptions={unitOptions}
            value={deal.unitId || ""}
            onChange={(v) => onUnitSave(v || null)}
            dealStatus={deal.status}
            onUnitCreated={onUnitCreated}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Consolidated Fee cell — £ amount on top, Fee Agreement chip
// underneath. Popover lets the team set both without touching two
// columns.
function FeeCombinedCell({
  deal, onSave,
}: {
  deal: any;
  onSave: (field: string, value: number | string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const feeStr = deal.fee != null ? `£${Number(deal.fee).toLocaleString("en-GB")}` : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full text-left flex flex-col gap-0.5 px-1 py-0.5 hover:bg-accent rounded text-xs min-w-[100px]"
          data-testid={`fee-combined-cell-${deal.id}`}
        >
          {feeStr ? (
            <span className="font-mono text-xs font-medium">{feeStr}</span>
          ) : (
            <span className="text-muted-foreground text-[11px] flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add fee
            </span>
          )}
          {deal.feeAgreement ? (
            <Badge
              variant="secondary"
              className={`text-[9px] px-1 py-0 leading-tight w-fit ${DEAL_FEE_AGREEMENT_COLORS[deal.feeAgreement] || ""}`}
            >
              FA {deal.feeAgreement}
            </Badge>
          ) : (
            <span className="text-[10px] text-muted-foreground italic">No FA</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-3 space-y-2.5" align="start">
        <p className="text-xs font-semibold">Fee &amp; agreement</p>
        <div className="grid grid-cols-[100px_1fr] items-center gap-2">
          <Label className="text-xs text-muted-foreground">Fee</Label>
          <InlineNumber
            value={deal.fee}
            onSave={(v) => onSave("fee", v)}
            prefix="£"
          />
        </div>
        <div className="grid grid-cols-[100px_1fr] items-center gap-2">
          <Label className="text-xs text-muted-foreground">Fee Agreement</Label>
          <InlineLabelSelect
            value={deal.feeAgreement}
            options={CRM_OPTIONS.dealFeeAgreement}
            colorMap={DEAL_FEE_AGREEMENT_COLORS}
            onSave={(v) => onSave("feeAgreement", v || null)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Consolidated Team + BGP Contact cell. Teams (colour-tagged) stack
// over the assigned agent(s); popover holds both InlineMultiSelect
// editors so a single click captures both. Empty rosters surface a
// "+ Add team / agent" affordance.

// Consolidated Dates cell — Date Added (read-only) sits above the
// editable Target Date. Target Date is what feeds the WIP report's
// month / fiscal-year buckets when a deal hasn't yet exchanged, so a
// hint flags that in the popover.
function DatesCell({
  deal, onSave,
}: {
  deal: any;
  onSave: (field: string, value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const added = deal.createdAt ? formatDate(deal.createdAt) : null;
  const target = deal.targetDate ? formatDate(deal.targetDate) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full text-left flex flex-col gap-0 px-1 py-0.5 hover:bg-accent rounded min-w-[120px]"
          data-testid={`dates-cell-${deal.id}`}
        >
          <span className="text-[11px] text-muted-foreground">
            {added ? `Added ${added}` : "—"}
          </span>
          {target ? (
            <span className="text-xs font-medium">Target {target}</span>
          ) : (
            <span className="text-[11px] text-muted-foreground italic flex items-center gap-1">
              <Plus className="w-3 h-3" /> Target date
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-3 space-y-2.5" align="start">
        <p className="text-xs font-semibold">Dates</p>
        <div className="grid grid-cols-[110px_1fr] items-center gap-2">
          <Label className="text-xs text-muted-foreground">Date Added</Label>
          <span className="text-xs">{added || "—"}</span>
        </div>
        <div className="grid grid-cols-[110px_1fr] items-center gap-2">
          <Label className="text-xs text-muted-foreground">Target Date</Label>
          <input
            type="date"
            className="text-xs border rounded px-2 py-1 cursor-pointer"
            value={toDateInputValue(deal.targetDate)}
            onChange={(e) => onSave("targetDate", e.target.value || null)}
            data-testid={`dates-target-input-${deal.id}`}
          />
        </div>
        <p className="text-[10px] text-muted-foreground leading-tight pt-1 border-t">
          Target Date drives the WIP report's month / fiscal-year bucket
          until the deal exchanges.
        </p>
      </PopoverContent>
    </Popover>
  );
}

// Consolidated Pricing cell — folds Pricing (£ headline), Price PSF
// and Price ITZA into one column. Same stacked-summary + popover
// pattern as LeaseTermsCell.
const PRICING_ROWS: NumericRow[] = [
  { key: "pricing",      label: "Pricing",    short: "Price", prefix: "£" },
  { key: "pricePsf",     label: "Price PSF",  short: "PSF",   prefix: "£" },
  { key: "priceItza",    label: "Price ITZA", short: "ITZA",  prefix: "£" },
  { key: "yieldPercent", label: "Yield",      short: "Yield", suffix: "%" },
];

function PricingCell({
  deal, onSave,
}: {
  deal: any;
  onSave: (field: string, value: number | null) => void;
}) {
  return (
    <NumericStackedCell
      row={deal}
      rows={PRICING_ROWS}
      title="Pricing & yield"
      emptyLabel="Add pricing"
      onSave={onSave}
      testId={`pricing-cell-${deal.id}`}
    />
  );
}

// Consolidated Client + Xero contact cell. Stacks client (landlord)
// over the linked Xero billing contact. Click opens a popover with
// the landlord picker (inline-create wired) and the Xero contact
// picker (which writes id + cached name/account/address in one go).
function ClientXeroCell({
  deal, companies, onLandlordSave, onLandlordCreate, onXeroChange,
}: {
  deal: any;
  companies: CrmCompany[];
  onLandlordSave: (v: string | null) => void;
  onLandlordCreate: (name: string) => Promise<void> | void;
  onXeroChange: (c: { ContactID: string; Name: string; AccountNumber: string | null; BillingAddress: any } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const clientName = deal.landlordId
    ? (companies.find(c => c.id === deal.landlordId)?.name || "Linked client")
    : null;
  const xeroName = (deal as any).xeroContactName || null;
  const xeroAcct = (deal as any).xeroAccountNumber || null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full text-left flex flex-col gap-0 px-1 py-0.5 hover:bg-accent rounded min-w-0 max-w-full overflow-hidden"
          data-testid={`client-xero-cell-${deal.id}`}
        >
          {clientName ? (
            <span className="text-sm font-medium truncate" title={clientName}>{clientName}</span>
          ) : (
            <span className="text-muted-foreground text-[11px] flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add client
            </span>
          )}
          {xeroName ? (
            <span className="text-[11px] text-muted-foreground truncate flex items-center gap-1 min-w-0 max-w-full">
              <Receipt className="w-2.5 h-2.5 shrink-0" />
              {/* min-w-0 — flex items refuse to shrink below content width
                  without it, which is exactly how long billing entities were
                  painting across the Deal Type column. */}
              <span className="truncate min-w-0" title={`${xeroName}${xeroAcct ? ` · A/C ${xeroAcct}` : ""}`}>{xeroName}{xeroAcct ? ` · A/C ${xeroAcct}` : ""}</span>
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground italic">No Xero contact</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-3 space-y-2.5" align="start">
        <p className="text-xs font-semibold">Client &amp; billing</p>
        <div className="grid grid-cols-[80px_1fr] items-center gap-2">
          <Label className="text-xs text-muted-foreground">Client</Label>
          <InlineLinkSelect
            value={deal.landlordId}
            options={companies.filter(c => c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client" || c.companyType?.startsWith("Tenant") || c.id === deal.landlordId).map(c => ({ id: c.id, name: c.name }))}
            href={deal.landlordId ? `/companies/${deal.landlordId}` : undefined}
            onSave={onLandlordSave}
            onCreate={(name) => onLandlordCreate(name)}
            placeholder="Link client"
          />
        </div>
        <div className="grid grid-cols-[80px_1fr] items-start gap-2">
          <Label className="text-xs text-muted-foreground pt-1.5">Xero contact</Label>
          <XeroContactPicker
            value={(deal as any).xeroContactId || null}
            cachedName={(deal as any).xeroContactName}
            cachedAccountNumber={(deal as any).xeroAccountNumber}
            cachedAddress={(deal as any).xeroBillingAddress}
            onChange={(c) => onXeroChange(c as any)}
            testIdPrefix={`deal-${deal.id}-xero`}
            compact
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Simplified create-deal body — shown by default when opening "New
// Deal". Five fields, all the team needs to spin a deal up: property,
// deal type, the relevant counterparty (one smart picker that switches
// based on deal type), deal name (auto-fills from property), and BGP
// contacts. Everything else is set later on the deal board / via the
// "Show all fields" toggle.
//
// Picker rules:
//   - Landlord picker: companies where companyType IS landlord-family
//     (NOT tenants — the old filter was including them by mistake).
//   - Tenant picker: companies where companyType IS tenant-family.
//   - Vendor / Purchaser: investment-side counterparties.
//   - BGP contacts: users, sorted alphabetically by name.
// ─────────────────────────────────────────────────────────────────────────
// Consultant deals are fee-only — no property, counterparty, agent or unit
// context. When "Consultant" is the deal type, the create form collapses to
// just Deal Type, Deal Name, Total fee, timing for completion and the BGP fee
// split (this renders instead of SimplifiedCreateBody). The counterparty
// requirement in handleSubmit is skipped for this type.
function ConsultantCreateBody({
  form, set, setForm, feeRows, setFeeRows, feeAllocType, setFeeAllocType, users, toggleAgent,
}: {
  form: any;
  set: (k: any, v: any) => void;
  setForm: any;
  feeRows: FeeAllocationEditorRow[];
  setFeeRows: (r: FeeAllocationEditorRow[]) => void;
  feeAllocType: "percentage" | "fixed";
  setFeeAllocType: (t: "percentage" | "fixed") => void;
  users: { id: number; name: string }[];
  toggleAgent: (name: string) => void;
}) {
  const sortedUsers = [...users].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="space-y-4">
      <div>
        <Label>Deal Type *</Label>
        <Select
          value={form.dealType || undefined}
          onValueChange={(v) => {
            const val = v === "__clear__" ? "" : v;
            set("dealType", val);
            // Switching to a standard type auto-assigns its team (mirrors the
            // simplified form); Consultant itself gets no auto-team.
            let autoTeam: string | null = null;
            if (["Purchase", "Sale"].includes(val)) autoTeam = "Investment";
            else if (val === "Lease Acquisition") autoTeam = "Tenant Rep";
            else if (["Lease Disposal", "Lease Renewal", "Rent Review", "Regear"].includes(val)) autoTeam = "Lease Advisory";
            if (autoTeam && !form.team.includes(autoTeam)) {
              setForm((p: any) => ({ ...p, team: [...p.team, autoTeam] }));
            }
          }}
        >
          <SelectTrigger data-testid="select-deal-type">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            {CRM_OPTIONS.dealType.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="consultant-deal-name">Deal Name <span className="text-rose-600">*</span></Label>
        <Input
          id="consultant-deal-name"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Acme Ltd — retail strategy advice"
          data-testid="input-deal-name"
        />
      </div>

      <div>
        <Label>BGP Contact</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-start font-normal h-auto min-h-[36px] py-1.5" data-testid="input-deal-agent">
              {form.internalAgent.length === 0 ? (
                <span className="text-muted-foreground">Select BGP contacts…</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {form.internalAgent.map((name: string) => (
                    <Badge key={name} variant="secondary" className="text-xs">{name}</Badge>
                  ))}
                </div>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 max-h-[300px] overflow-y-auto">
            {sortedUsers.map(u => (
              <DropdownMenuItem key={u.id} onClick={() => toggleAgent(u.name)} data-testid={`agent-option-${u.name}`}>
                <div className={`w-3 h-3 rounded-sm border mr-2 flex items-center justify-center ${form.internalAgent.includes(u.name) ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                  {form.internalAgent.includes(u.name) && <span className="text-primary-foreground text-[8px]">✓</span>}
                </div>
                <span className="truncate">{u.name}</span>
              </DropdownMenuItem>
            ))}
            {form.internalAgent.length > 0 && (
              <DropdownMenuItem onClick={() => setForm((p: any) => ({ ...p, internalAgent: [] }))} data-testid="agent-clear-all">
                <X className="w-3 h-3 mr-2 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Clear all</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div>
        <Label htmlFor="consultant-fee">Total fee £</Label>
        <Input
          id="consultant-fee"
          type="number"
          step="0.01"
          min="0"
          value={form.fee}
          onChange={(e) => set("fee", e.target.value)}
          placeholder="e.g. 15000"
          data-testid="input-deal-fee"
        />
      </div>

      <div>
        <Label htmlFor="consultant-target-date">
          Timing for completion <span className="text-rose-600">*</span>
        </Label>
        <Input
          id="consultant-target-date"
          type="date"
          value={form.targetDate}
          onChange={(e) => set("targetDate", e.target.value)}
          required
          className={!form.targetDate ? "border-rose-300" : ""}
          data-testid="input-deal-target-date"
        />
        {!form.targetDate && (
          <p className="text-[10px] text-rose-600 mt-0.5">Required — drives the WIP report bucket.</p>
        )}
      </div>

      <div>
        <Label className="text-xs">BGP fee split</Label>
        <div className="border rounded-md p-2.5 bg-muted/30">
          <FeeAllocationEditor
            rows={feeRows}
            onChange={setFeeRows}
            allocType={feeAllocType}
            onAllocTypeChange={setFeeAllocType}
            dealFee={parseFloat(form.fee) || null}
            bgpAgents={users.map(u => ({ id: String(u.id), name: u.name }))}
          />
        </div>
      </div>
    </div>
  );
}

function SimplifiedCreateBody({
  form, set, properties, propertyUnits, companies, users, toggleAgent, setForm,
  feeRows, setFeeRows, feeAllocType, setFeeAllocType,
  nameAutoFilled, setNameAutoFilled,
}: {
  form: any;
  set: (k: any, v: any) => void;
  properties: CrmProperty[];
  propertyUnits: Array<{ id: string; unitName: string; propertyId: string }>;
  feeRows: FeeAllocationEditorRow[];
  setFeeRows: (r: FeeAllocationEditorRow[]) => void;
  feeAllocType: "percentage" | "fixed";
  setFeeAllocType: (t: "percentage" | "fixed") => void;
  nameAutoFilled: boolean;
  setNameAutoFilled: (v: boolean) => void;
  companies: CrmCompany[];
  users: { id: number; name: string }[];
  toggleAgent: (name: string) => void;
  setForm: any;
}) {
  // Counterparty picker contextual label + filter — driven by deal type.
  // Tenant Acquisition + New Letting + Sub-Letting + Consultancy + Secondment
  // fall through to "auto", which renders BOTH landlord and tenant pickers
  // so the agent can link either side as the deal needs.
  // Sale + Purchase use "investment" which renders BOTH vendor and
  // purchaser pickers — the * marker on the client side comes from
  // clientRole below.
  const dt = form.dealType || "";
  const isInvestment = dt === "Purchase" || dt === "Sale";
  // Sale / Purchase use "investment" (vendor + purchaser pickers).
  // Everything else uses "leasing" (landlord + tenant pickers). Both
  // pickers are always shown — the client one is marked with *.
  const counterpartyKind: "leasing" | "investment" =
    dt === "Purchase" || dt === "Sale" ? "investment" : "leasing";

  // Who is OUR client for this deal type? Used to mark the right
  // counterparty picker as required (*) and to drive AML (we KYC the
  // client, lighter screen for the counterparty). Per the agreed
  // mapping:
  //   Sale  → vendor is our client (we're disposing for them)
  //   Purchase → purchaser is our client (we're acquiring for them)
  //   Lease Acquisition → tenant (tenant-rep)
  //   Lease Disposal → tenant
  //   New Letting → landlord
  //   Lease Renewal / Rent Review / Regear → either (ambiguous, user picks)
  //   Tenant Acquisition / Sub-Letting / Consultancy / Secondment → either
  const clientRole: "landlord" | "tenant" | "vendor" | "purchaser" | null =
    dt === "Sale" ? "vendor"
    : dt === "Purchase" ? "purchaser"
    : dt === "Lease Acquisition" ? "tenant"
    : dt === "Lease Disposal" ? "tenant"
    : dt === "New Letting" ? "landlord"
    : null;

  // Deal name auto-fill rule (Woody, 2026-05): non-investment uses
  //   `Tenant – Property`, investment uses `Client – Property` where
  //   Client = Vendor (Sale) or Purchaser (Purchase). Stays in sync as
  //   long as the user hasn't manually typed in the Deal Name box —
  //   typing flips nameAutoFilled off and the auto-fill stops touching
  //   it.
  const computeAutoName = (f: any): string => {
    const prop = properties.find(p => p.id === f.propertyId);
    const propName = prop?.name || "";
    const investType = f.dealType === "Sale" || f.dealType === "Purchase";
    let cpName = "";
    if (investType) {
      const clientId = f.dealType === "Sale" ? f.vendorId : f.purchaserId;
      cpName = companies.find(c => c.id === clientId)?.name || "";
    } else {
      cpName = companies.find(c => c.id === f.tenantId)?.name || "";
    }
    if (cpName && propName) return `${cpName} – ${propName}`;
    return cpName || propName || "";
  };
  const applyAutoName = (next: any) => {
    if (!nameAutoFilled) return;
    const auto = computeAutoName(next);
    if (auto && auto !== next.name) setForm((p: any) => ({ ...p, name: auto }));
  };

  const landlordOptions = companies.filter(c =>
    c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client"
    || c.id === form.landlordId
  );
  const tenantOptions = companies.filter(c =>
    (c.companyType?.startsWith("Tenant") || false) || c.id === form.tenantId
  );
  const vendorOptions = companies.filter(c =>
    c.companyType === "Vendor" || c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client"
    || c.id === form.vendorId
  );
  const purchaserOptions = companies.filter(c =>
    (c.companyType?.startsWith("Tenant") || false) || c.companyType === "Purchaser" || c.companyType === "Investor"
    || c.id === form.purchaserId
  );

  // BGP contacts (internalAgent multi-select) sorted alphabetically.
  const sortedUsers = [...users].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  // Inline-create handler factory — same shape as TenantBrandPicker /
  // CrmEntityPicker but for the cmdk-based EntityCombobox. Each picker
  // gets a curried function that POSTs to /api/crm/companies with the
  // right companyType, invalidates caches, and returns the new option.
  const { toast: comboToast } = useToast();
  const makeCompanyCreator = (companyType: string) => async (name: string) => {
    try {
      const r = await apiRequest("POST", "/api/crm/companies", {
        name: name.trim(),
        companyType,
        isTrackedBrand: companyType.startsWith("Tenant"),
      });
      const created = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies-basic"] });
      comboToast({ title: `${companyType} created`, description: `${created.name} added to CRM.` });
      return { id: String(created.id), label: created.name, subLabel: created.companyType };
    } catch (e: any) {
      comboToast({ title: "Couldn't create", description: e?.message, variant: "destructive" });
      throw e;
    }
  };
  const createLandlord = makeCompanyCreator("Landlord");
  const createTenant = makeCompanyCreator("Tenant");
  const createVendor = makeCompanyCreator("Vendor");
  const createPurchaser = makeCompanyCreator("Purchaser");

  const toComboItems = (list: CrmCompany[]) => {
    // SubLabel = legal/contracting entity ("Land Securities Group Plc"
    // under "Landsec") rather than the companyType chip, which now
    // ends up implicit (the user already picked the column the brand
    // sits in). companyType moves into keywords so it's still
    // searchable. Trading entity aliases come in as keywords too so
    // typing any legal entity name still finds the brand row.
    return list.map(c => {
      const trading = Array.isArray((c as any).tradingEntities) ? (c as any).tradingEntities : [];
      const aliases = trading.map((t: any) => t?.name).filter((n: any) => typeof n === "string" && n.length > 0);
      const uk = (c as any).ukEntityName || (c as any).uk_entity_name || null;
      return {
        id: c.id,
        label: c.name,
        subLabel: uk || aliases[0] || undefined,
        keywords: [
          c.companyType || "",
          c.domainUrl || "",
          c.domain || "",
          ...(uk ? [uk] : []),
          ...aliases,
        ].filter(Boolean),
      };
    });
  };

  return (
    <div className="space-y-4">
      {/* The Deals CRM is for Solicitors-stage onwards. Pre-SOL units
          (marketing, viewings, negotiating) live on the Letting Tracker
          — adding a unit there auto-creates a backing deal and links
          them. Flag this up so Layla doesn't add a marketing-stage deal
          here by mistake. */}
      <div className="text-[11px] text-muted-foreground bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-md px-3 py-2 leading-snug">
        New Deal creates a <strong>Solicitors-stage</strong> deal on the CRM kanban.
        For marketing / viewings / negotiating units, use the{" "}
        <a href="/deals/letting" className="underline">Letting Tracker → Add Unit</a> instead.
      </div>
      <div>
        <Label>Property *</Label>
        <PropertyCombobox
          testId="select-deal-property-top"
          placeholder="Select property or paste an address"
          value={form.propertyId}
          items={properties.map((p) => ({
            id: p.id,
            label: p.name,
            subLabel: p.postcode || undefined,
            keywords: [p.postcode || "", p.address ? JSON.stringify(p.address) : ""],
          }))}
          onChange={(val) => {
            // Auto-fill landlord (leasing) or vendor (Sale/Purchase)
            // from the picked property's landlord_id when the user
            // hasn't already chosen one. The property's landlord is
            // canonically the same as the deal-side counterparty for
            // most flows — saves a click.
            const prop = properties.find(p => p.id === val);
            const propLandlordId = (prop as any)?.landlordId || "";
            const investType = form.dealType === "Sale" || form.dealType === "Purchase";
            const patch: any = { propertyId: val };
            if (propLandlordId) {
              if (investType && !form.vendorId) patch.vendorId = propLandlordId;
              if (!investType && !form.landlordId) patch.landlordId = propLandlordId;
            }
            setForm((p: any) => ({ ...p, ...patch }));
            applyAutoName({ ...form, ...patch });
          }}
          onCreated={(prop) => {
            // The parent's properties array updates after the next
            // refetch; meanwhile the picker holds the row so the
            // trigger label stays correct.
            queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
            // Auto-name driven by counterparty + property; the new
            // property may not be in `properties` yet so seed the
            // lookup with its name directly.
            if (nameAutoFilled) {
              const investType = form.dealType === "Sale" || form.dealType === "Purchase";
              let cpName = "";
              if (investType) {
                const clientId = form.dealType === "Sale" ? form.vendorId : form.purchaserId;
                cpName = companies.find(c => c.id === clientId)?.name || "";
              } else {
                cpName = companies.find(c => c.id === form.tenantId)?.name || "";
              }
              const auto = cpName && prop.name ? `${cpName} – ${prop.name}` : (cpName || prop.name);
              if (auto) set("name", auto);
            }
          }}
        />
      </div>

      <div>
        <Label>Deal Type *</Label>
        <Select
          value={form.dealType || undefined}
          onValueChange={(v) => {
            const val = v === "__clear__" ? "" : v;
            set("dealType", val);
            // Auto-assign team based on deal type — matches the existing rule.
            let autoTeam: string | null = null;
            if (["Purchase", "Sale"].includes(val)) autoTeam = "Investment";
            else if (val === "Lease Acquisition") autoTeam = "Tenant Rep";
            else if (["Lease Disposal", "Lease Renewal", "Rent Review", "Regear"].includes(val)) autoTeam = "Lease Advisory";
            if (autoTeam && !form.team.includes(autoTeam)) {
              setForm((p: any) => ({ ...p, team: [...p.team, autoTeam] }));
            }
            applyAutoName({ ...form, dealType: val });
          }}
        >
          <SelectTrigger data-testid="select-deal-type">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            {CRM_OPTIONS.dealType.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Unit picker — only shown for unit-level deal types. Searches
          the tenancy schedule first (god of truth) and lets the user
          inline-create a tenancy row when the unit doesn't exist yet.
          New row gets a status derived from the deal status so it
          mirrors out to the right boards immediately. */}
      {(() => {
        const UNIT_LEVEL_TYPES = new Set([
          // Landlord-side deal types where the unit lives on the property's
          // tenancy spine. Lease Acquisition + Sub-Letting are excluded —
          // those are tenant-rep deals where BGP is acting for the tenant
          // and the property is a candidate, not something we manage.
          "Lease Renewal", "Rent Review", "Regear", "Lease Disposal",
          "New Letting", "Temp Lease", "Dilapidations", "Service Charge",
        ]);
        if (!UNIT_LEVEL_TYPES.has(form.dealType)) return null;
        const unitOptions = propertyUnits.filter(pu => !form.propertyId || pu.propertyId === form.propertyId);
        return (
          <div>
            <Label>Unit *</Label>
            <DealUnitPicker
              propertyId={form.propertyId}
              unitOptions={unitOptions}
              value={form.unitId}
              onChange={(v) => set("unitId", v)}
              dealStatus={form.status}
              onUnitCreated={(row) => {
                // Prefill area + asking rent from the new tenancy row so
                // Layla doesn't have to retype data she just entered (or
                // would have to look up). She can still override on the
                // full form if anything's wrong.
                const sqft = row.gia_sqft ?? row.nia_sqft ?? row.itza_sqft ?? null;
                const rent = row.marketing_rent_pa ?? row.erv_pa ?? null;
                setForm((p: any) => ({
                  ...p,
                  totalAreaSqft: p.totalAreaSqft || (sqft != null ? String(sqft) : p.totalAreaSqft),
                  rentPa: p.rentPa || (rent != null ? String(rent) : p.rentPa),
                }));
              }}
            />
            {!form.propertyId && (
              <p className="text-[11px] text-muted-foreground mt-1">Pick a property first.</p>
            )}
          </div>
        );
      })()}

      {/* Counterparties — always BOTH for the chosen deal flavour.
          - "leasing" types show Landlord + Tenant (one or both required;
            asterisks show whichever side is the client per clientRole).
          - "investment" types show Vendor + Purchaser (same shape).
          Both names are needed to fire the right AML chain (full KYC
          on the client, lighter screen on the counterparty). */}
      {counterpartyKind === "leasing" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Landlord{clientRole === "landlord" ? " * (client)" : " *"}</Label>
            <EntityCombobox
              testId="select-deal-landlord"
              placeholder="Link landlord"
              searchPlaceholder="Search landlords…"
              value={form.landlordId}
              items={toComboItems(landlordOptions)}
              onChange={(v) => { set("landlordId", v); set("landlordEntityId", ""); applyAutoName({ ...form, landlordId: v }); }}
              onCreate={createLandlord}
              createLabel="landlord"
            />
            {form.landlordId && (
              <div>
                <Label className="text-[10px] text-muted-foreground">Billing / legal entity (Xero)</Label>
                <XeroContactPicker
                  testIdPrefix="deal-landlord-entity"
                  value={form.landlordEntityId || null}
                  cachedName={form.landlordEntityName}
                  onChange={(c) => {
                    setForm((prev: any) => ({
                      ...prev,
                      landlordEntityId: c?.ContactID || "",
                      landlordEntityName: c?.Name || "",
                    }));
                  }}
                  compact
                />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Tenant{clientRole === "tenant" ? " * (client)" : " *"}</Label>
            <EntityCombobox
              testId="select-deal-tenant"
              placeholder="Link tenant"
              searchPlaceholder="Search tenants…"
              value={form.tenantId}
              items={toComboItems(tenantOptions)}
              onChange={(v) => { set("tenantId", v); set("tenantEntityId", ""); applyAutoName({ ...form, tenantId: v }); }}
              onCreate={createTenant}
              createLabel="tenant"
            />
            {form.tenantId && (
              <div>
                <Label className="text-[10px] text-muted-foreground">Billing / legal entity (Xero)</Label>
                <XeroContactPicker
                  testIdPrefix="deal-tenant-entity"
                  value={form.tenantEntityId || null}
                  cachedName={form.tenantEntityName}
                  onChange={(c) => {
                    setForm((prev: any) => ({
                      ...prev,
                      tenantEntityId: c?.ContactID || "",
                      tenantEntityName: c?.Name || "",
                    }));
                  }}
                  compact
                />
              </div>
            )}
          </div>
        </div>
      )}
      {counterpartyKind === "investment" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Vendor{clientRole === "vendor" ? " * (client)" : " *"}</Label>
            <EntityCombobox
              testId="select-deal-vendor"
              placeholder="Link vendor"
              searchPlaceholder="Search vendors…"
              value={form.vendorId}
              items={toComboItems(vendorOptions)}
              onChange={(v) => { set("vendorId", v); set("vendorEntityId", ""); applyAutoName({ ...form, vendorId: v }); }}
              onCreate={createVendor}
              createLabel="vendor"
            />
            {form.vendorId && (
              <div>
                <Label className="text-[10px] text-muted-foreground">Billing / legal entity (Xero)</Label>
                <XeroContactPicker
                  testIdPrefix="deal-vendor-entity"
                  value={form.vendorEntityId || null}
                  cachedName={form.vendorEntityName}
                  onChange={(c) => {
                    setForm((prev: any) => ({
                      ...prev,
                      vendorEntityId: c?.ContactID || "",
                      vendorEntityName: c?.Name || "",
                    }));
                  }}
                  compact
                />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Purchaser{clientRole === "purchaser" ? " * (client)" : " *"}</Label>
            <EntityCombobox
              testId="select-deal-purchaser"
              placeholder="Link purchaser"
              searchPlaceholder="Search purchasers…"
              value={form.purchaserId}
              items={toComboItems(purchaserOptions)}
              onChange={(v) => { set("purchaserId", v); set("purchaserEntityId", ""); applyAutoName({ ...form, purchaserId: v }); }}
              onCreate={createPurchaser}
              createLabel="purchaser"
            />
            {form.purchaserId && (
              <div>
                <Label className="text-[10px] text-muted-foreground">Billing / legal entity (Xero)</Label>
                <XeroContactPicker
                  testIdPrefix="deal-purchaser-entity"
                  value={form.purchaserEntityId || null}
                  cachedName={form.purchaserEntityName}
                  onChange={(c) => {
                    setForm((prev: any) => ({
                      ...prev,
                      purchaserEntityId: c?.ContactID || "",
                      purchaserEntityName: c?.Name || "",
                    }));
                  }}
                  compact
                />
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="deal-name">Deal Name <span className="text-muted-foreground text-xs">(auto-fills as {counterpartyKind === "investment" ? "Client – Property" : "Tenant – Property"})</span></Label>
        <Input
          id="deal-name"
          value={form.name}
          onChange={(e) => { setNameAutoFilled(false); set("name", e.target.value); }}
          placeholder={computeAutoName(form) || "Enter deal name"}
          data-testid="input-deal-name"
        />
      </div>

      <div>
        <Label>BGP Contact</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-start font-normal h-auto min-h-[36px] py-1.5" data-testid="input-deal-agent">
              {form.internalAgent.length === 0 ? (
                <span className="text-muted-foreground">Select BGP contacts…</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {form.internalAgent.map((name: string) => (
                    <Badge key={name} variant="secondary" className="text-xs">{name}</Badge>
                  ))}
                </div>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 max-h-[300px] overflow-y-auto">
            {sortedUsers.map(u => (
              <DropdownMenuItem key={u.id} onClick={() => toggleAgent(u.name)} data-testid={`agent-option-${u.name}`}>
                <div className={`w-3 h-3 rounded-sm border mr-2 flex items-center justify-center ${form.internalAgent.includes(u.name) ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                  {form.internalAgent.includes(u.name) && <span className="text-primary-foreground text-[8px]">✓</span>}
                </div>
                <span className="truncate">{u.name}</span>
              </DropdownMenuItem>
            ))}
            {form.internalAgent.length > 0 && (
              <DropdownMenuItem onClick={() => setForm((p: any) => ({ ...p, internalAgent: [] }))} data-testid="agent-clear-all">
                <X className="w-3 h-3 mr-2 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Clear all</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* WIP-template fields — these mirror what Layla fills in via the
          shared spreadsheet so creating a deal here captures everything
          the team currently emails in. All optional at submit time
          except where validation above already enforces them. */}
      <div className="border-t pt-3 space-y-3">
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Financials & timing</div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="deal-rent-pa" className="text-xs">Headline Rent (£ p.a.)</Label>
            <Input id="deal-rent-pa" type="number" value={form.rentPa}
              onChange={(e) => set("rentPa", e.target.value)}
              placeholder="e.g. 175000" />
          </div>
          <div>
            <Label htmlFor="deal-fee-pct" className="text-xs">% Agency fee</Label>
            <Input id="deal-fee-pct" type="number" step="0.01" value={form.feePercentage}
              onChange={(e) => {
                const pct = e.target.value;
                set("feePercentage", pct);
                const rent = parseFloat(form.rentPa);
                const pctNum = parseFloat(pct);
                if (!isNaN(rent) && !isNaN(pctNum) && pctNum > 0) {
                  set("fee", String(Math.round((rent * pctNum) / 100)));
                }
              }}
              placeholder="e.g. 6" />
          </div>
          <div>
            <Label htmlFor="deal-fee" className="text-xs">Total fee £</Label>
            <Input id="deal-fee" type="number" step="0.01" value={form.fee}
              onChange={(e) => set("fee", e.target.value)}
              placeholder="auto from rent × %" />
          </div>
        </div>

        <div>
          <Label className="text-xs">BGP fee split</Label>
          <div className="border rounded-md p-2.5 bg-muted/30">
            <FeeAllocationEditor
              rows={feeRows}
              onChange={setFeeRows}
              allocType={feeAllocType}
              onAllocTypeChange={setFeeAllocType}
              dealFee={parseFloat(form.fee) || null}
              bgpAgents={users.map(u => ({ id: String(u.id), name: u.name }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="deal-target-date" className="text-xs">
              Timing for completion <span className="text-rose-600">*</span>
            </Label>
            <Input
              id="deal-target-date"
              type="date"
              value={form.targetDate}
              onChange={(e) => set("targetDate", e.target.value)}
              required
              className={!form.targetDate ? "border-rose-300" : ""}
            />
            {!form.targetDate && (
              <p className="text-[10px] text-rose-600 mt-0.5">Required — drives the WIP report bucket.</p>
            )}
          </div>
          <div>
            <Label htmlFor="deal-invoicing-email" className="text-xs">Invoicing email / contact</Label>
            <Input id="deal-invoicing-email" type="email" value={form.invoicingEmail}
              onChange={(e) => set("invoicingEmail", e.target.value)}
              placeholder="e.g. accounts@client.com" />
          </div>
        </div>

        {/* AML completion is no longer a self-attest checkbox — the
            regulator doesn't care that the agent ticked a box. The deal
            page derives 'AML complete' from crm_companies.aml_checklist
            for every linked counterparty (CH lookup, sanctions screen,
            PEP screen, UBO, ID verification, address verification). The
            stage-transition handler blocks moves to SOL+ when AML
            status is not complete for all parties. */}
        <div>
          <Label htmlFor="deal-po-number" className="text-xs">PO number (if known)</Label>
          {/* Native <datalist> autocomplete sourced from every PO already
              on a deal or Xero invoice (deduped + sorted). The input
              still accepts arbitrary text — these are suggestions, not
              a closed list. Works on mobile + desktop without extra JS. */}
          <Input
            id="deal-po-number"
            list="deal-po-suggestions"
            value={form.poNumber}
            onChange={(e) => set("poNumber", e.target.value)}
            placeholder="leave blank if finance to request"
          />
          <PoNumberDatalist />
        </div>

        <div>
          <Label htmlFor="deal-comments" className="text-xs">Comments / specific wording</Label>
          <Textarea id="deal-comments" rows={3} value={form.comments}
            onChange={(e) => set("comments", e.target.value)}
            placeholder="Anything finance needs to know — special wording, PO process, billing quirks…" />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground border-t pt-3">
        Anything not here (yield, areas, individual dates, Xero billing address) is editable on the deal board after creation. Click <span className="font-medium text-foreground">Show all fields</span> below if you need the full form now.
      </p>
    </div>
  );
}

export function DealFormDialog({
  open,
  onOpenChange,
  deal,
  properties,
  propertyUnits = [],
  companies,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: CrmDeal;
  properties: CrmProperty[];
  propertyUnits?: PropertyUnit[];
  companies: CrmCompany[];
  users: { id: number; name: string; email: string }[];
}) {
  const { toast } = useToast();
  const isEdit = !!deal;
  const [form, setForm] = useState<DealFormData>(deal ? dealToForm(deal) : { ...emptyForm });
  const [changeReason, setChangeReason] = useState("");
  const [learning, setLearning] = useState("");
  // When creating a deal, the form defaults to a stripped-down view
  // showing only the essentials. Set true to reveal every legacy
  // field. EDIT always renders the full form regardless.
  const [showAllFields, setShowAllFields] = useState(false);
  const [approvalGateOpen, setApprovalGateOpen] = useState(false);
  const [approvalGateMessage, setApprovalGateMessage] = useState("");
  // Fee allocations live alongside the form state. On EDIT they're loaded
  // from the existing deal's allocations endpoint (read-only here — the
  // FeeAllocationCard on the deal-detail page is the canonical editor
  // for existing deals); on CREATE they're collected in-form and POSTed
  // after the deal is created.
  const [feeRows, setFeeRows] = useState<FeeAllocationEditorRow[]>([]);
  const [feeAllocType, setFeeAllocType] = useState<"percentage" | "fixed">("percentage");
  // Tracks whether the deal name is still being managed by the auto-fill
  // rule or has been hand-edited. Goes false the first time Layla types
  // into the deal name input — from that point we stop overwriting.
  // Edit mode starts in "manual" so we never trample a saved name.
  const [nameAutoFilled, setNameAutoFilled] = useState<boolean>(!deal);

  // Reset form whenever the dialog re-opens. Without this, the previous
  // create attempt's values stick around — Layla hit 'New Deal' after
  // creating one and saw the old property / counterparty still selected.
  // Edit mode reloads from the deal prop so any uncommitted edits are
  // dropped on reopen (acceptable — they weren't saved).
  useEffect(() => {
    if (!open) return;
    setForm(deal ? dealToForm(deal) : { ...emptyForm });
    setChangeReason("");
    setLearning("");
    setShowAllFields(false);
    setFeeRows([]);
    setFeeAllocType("percentage");
    setNameAutoFilled(!deal); // new = auto-managed; edit = treat name as user-owned
  }, [open, deal]);

  const statusChanged = isEdit && deal && form.status !== (deal.status || "");
  // Compare against canonical codes — form.status holds the code after the
  // status migration, so the old label-based check ["Invoiced","Completed"]
  // never fired and let users save past the approval gate without warning.
  const APPROVAL_STATUS_CODES: DealStatusCode[] = ["INV", "COM"];
  const formStatusCode = legacyToCode(form.status);
  const isApprovalStatus = statusChanged && formStatusCode !== null && APPROVAL_STATUS_CODES.includes(formStatusCode);
  const isCompletingNow = statusChanged && formStatusCode === "COM";

  const { data: currentUser } = useQuery<{ isAdmin?: boolean; email?: string }>({
    queryKey: ["/api/auth/me"],
  });
  const SENIOR_EMAILS = new Set([
    "woody@brucegillinghampollard.com",
    "charlotte@brucegillinghampollard.com",
    "rupert@brucegillinghampollard.com",
    "jack@brucegillinghampollard.com",
  ]);
  const isSenior = !!currentUser?.isAdmin || (!!currentUser?.email && SENIOR_EMAILS.has(currentUser.email.toLowerCase()));

  const set = (field: keyof DealFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleAgent = (name: string) => {
    setForm((prev) => ({
      ...prev,
      internalAgent: prev.internalAgent.includes(name)
        ? prev.internalAgent.filter(a => a !== name)
        : [...prev.internalAgent, name],
    }));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const finalForm = { ...form };
      if (!finalForm.name.trim() && finalForm.propertyId) {
        const prop = properties.find(p => p.id === finalForm.propertyId);
        if (prop) finalForm.name = prop.name;
      }
      const payload = formToPayloadWithLearning(finalForm, changeReason || undefined, isCompletingNow ? learning : undefined);
      if (isEdit) {
        await apiRequest("PUT", `/api/crm/deals/${deal.id}`, payload);
      } else {
        const res = await apiRequest("POST", "/api/crm/deals", payload);
        const created = await res.json();
        // Persist fee allocations alongside the new deal. Only fires when
        // the user actually entered any rows — empty array = "no split set"
        // (deal still saves, allocations can be added later on the deal
        // detail page). PUT /fee-allocations replaces the existing set;
        // for a new deal that's empty anyway.
        if (created?.id && feeRows.length > 0) {
          const allocations = feeRows
            .filter(r => (r.isBgpHouse || r.agentName))
            .map(r => ({
              agentName: r.isBgpHouse ? (r.agentName || "BGP House") : r.agentName,
              allocationType: feeAllocType,
              percentage: feeAllocType === "percentage" ? r.percentage : null,
              fixedAmount: feeAllocType === "fixed" ? r.fixedAmount : null,
              isBgpHouse: !!r.isBgpHouse,
            }));
          if (allocations.length > 0) {
            try {
              await apiRequest("PUT", `/api/crm/deals/${created.id}/fee-allocations`, { allocations });
            } catch (e: any) {
              // Deal exists, allocations failed — surface but don't undo
              // the deal create (Layla can retry from the deal page).
              toast({
                title: "Deal created, fee split failed to save",
                description: e?.message || "Open the deal and set the split there.",
                variant: "destructive",
              });
            }
          }
        }
      }
    },
    onSuccess: async () => {
      toast({ title: isEdit ? "Deal updated" : "Deal created" });
      invalidateDealCaches();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] });
      // Saving a deal can create a property_units shadow row server-side (when
      // a unit is picked via a tenancy token). Refresh the unit list so the
      // saved unit resolves to a real item next time the deal is opened —
      // otherwise the Unit picker reopens blank.
      queryClient.invalidateQueries({ queryKey: ["/api/property-units"] });
      if (isEdit) {
        queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", deal.id] });
        queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", deal.id, "audit-log"] });
      }
      setChangeReason("");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      // Handle approval gate (senior 403) and AML gate (409) — both surface
      // through the same dialog so the user can see why the save was blocked.
      const parsed = parseGateError(err.message);
      if (parsed.kind === "aml" || parsed.kind === "senior") {
        setApprovalGateMessage(parsed.message);
        setApprovalGateOpen(true);
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() && !form.propertyId) {
      toast({ title: "Either a property or deal name is required", variant: "destructive" });
      return;
    }
    // Target Date is mandatory — without it the deal floats around the
    // WIP report on updatedAt fallback (drifts every time anything edits).
    if (!form.targetDate) {
      toast({
        title: "Target Date required",
        description: "Set the expected completion month — it's what places the deal on the WIP report.",
        variant: "destructive",
      });
      return;
    }
    // Same exclusion as the picker — Lease Acquisition + Sub-Letting are
    // tenant-rep, property-level, unit not required.
    const UNIT_LEVEL_TYPES = new Set([
      "Lease Renewal", "Rent Review", "Regear", "Lease Disposal",
      "New Letting", "Temp Lease",
    ]);
    if (UNIT_LEVEL_TYPES.has(form.dealType) && !form.unitId) {
      toast({ title: `${form.dealType} needs a unit`, description: "Pick or add a unit on this property — leasing deals can't be unit-less.", variant: "destructive" });
      return;
    }

    // Enforce client + counterparty per deal type. Always required —
    // a deal without both names blocks the AML chain (full KYC on the
    // client, lighter screen on the counterparty). Applies to edits too:
    // a historic deal missing a side needs the missing party filled in
    // before any further changes save.
    // Consultant deals are fee-only — no counterparty, so skip the landlord/
    // tenant (or vendor/purchaser) requirement for them.
    if (form.dealType && form.dealType !== "Consultant") {
      // Include both the canonical "Sale"/"Purchase" and the legacy
      // "Investment Sale"/"Investment Acquisition" labels still present
      // in DEAL_TYPE_COLORS — without these, legacy-typed deals bypass
      // the vendor/purchaser AML gate and fall through to the landlord/
      // tenant check, which fails confusingly.
      const investmentTypes = new Set(["Sale", "Purchase", "Investment Sale", "Investment Acquisition"]);
      if (investmentTypes.has(form.dealType)) {
        if (!form.vendorId || !form.purchaserId) {
          toast({
            title: "Vendor and Purchaser required",
            description: "Both parties on an investment deal — link or create each so AML can run on both sides.",
            variant: "destructive",
          });
          return;
        }
      } else {
        // Leasing-side deal types — landlord + tenant both required.
        if (!form.landlordId || !form.tenantId) {
          toast({
            title: "Landlord and Tenant required",
            description: "Both parties needed so AML can fire on the client + counterparty.",
            variant: "destructive",
          });
          return;
        }
      }
    }

    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[700px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Deal" : "New Deal"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update deal details below." : "Fill in the details to create a new deal."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* On CREATE, render a stripped-down form by default — just
              what the team needs to spin a deal up. Property, Deal
              Type, the right counterparty, Deal Name, BGP Contact.
              Everything else (rent / yield / areas / dates / Xero /
              AML) lives behind a "Show all fields" toggle and can
              also be filled in later on the actual deal board. The
              EDIT path always renders the full form. */}
          {!isEdit && !showAllFields ? (
            form.dealType === "Consultant" ? (
            <ConsultantCreateBody
              form={form}
              set={set}
              setForm={setForm}
              feeRows={feeRows}
              setFeeRows={setFeeRows}
              feeAllocType={feeAllocType}
              setFeeAllocType={setFeeAllocType}
              users={users}
              toggleAgent={toggleAgent}
            />
            ) : (
            <SimplifiedCreateBody
              form={form}
              set={set}
              properties={properties}
              propertyUnits={propertyUnits}
              companies={companies}
              users={users}
              toggleAgent={toggleAgent}
              setForm={setForm}
              feeRows={feeRows}
              setFeeRows={setFeeRows}
              feeAllocType={feeAllocType}
              setFeeAllocType={setFeeAllocType}
              nameAutoFilled={nameAutoFilled}
              setNameAutoFilled={setNameAutoFilled}
            />
            )
          ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label>Property *</Label>
              <PropertyCombobox
                testId="select-deal-property-top"
                placeholder="Select property or paste an address"
                value={form.propertyId}
                items={properties.map((p) => ({
                  id: p.id,
                  label: p.name,
                  subLabel: p.postcode || undefined,
                  keywords: [p.postcode || "", p.address ? JSON.stringify(p.address) : ""],
                }))}
                onChange={(val) => {
                  set("propertyId", val);
                  if (val && !form.name.trim()) {
                    const prop = properties.find(p => p.id === val);
                    if (prop) set("name", prop.name);
                  }
                }}
                onCreated={(prop) => {
                  queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
                  if (!form.name.trim()) set("name", prop.name);
                }}
              />
            </div>

            {(() => {
              const UNIT_LEVEL_TYPES = new Set([
                "Lease Renewal", "Rent Review", "Regear", "Lease Disposal",
                "Sub-Letting", "New Letting", "Temp Lease", "Lease Acquisition",
                "Dilapidations", "Service Charge",
              ]);
              const needsUnit = UNIT_LEVEL_TYPES.has(form.dealType);
              const unitOptions = propertyUnits.filter(pu => !form.propertyId || pu.propertyId === form.propertyId);
              return (
                <div className="sm:col-span-2">
                  <Label>Unit{needsUnit ? " *" : " (optional for property-level deals)"}</Label>
                  <DealUnitPicker
                    propertyId={form.propertyId}
                    unitOptions={unitOptions}
                    value={form.unitId}
                    onChange={(v) => set("unitId", v)}
                    dealStatus={form.status}
                    onUnitCreated={(row) => {
                      const sqft = row.gia_sqft ?? row.nia_sqft ?? row.itza_sqft ?? null;
                      const rent = row.marketing_rent_pa ?? row.erv_pa ?? null;
                      setForm((p: any) => ({
                        ...p,
                        totalAreaSqft: p.totalAreaSqft || (sqft != null ? String(sqft) : p.totalAreaSqft),
                        rentPa: p.rentPa || (rent != null ? String(rent) : p.rentPa),
                      }));
                    }}
                  />
                  {needsUnit && !form.unitId && form.propertyId && (
                    <p className="text-[11px] text-rose-600 mt-1">A {form.dealType} requires a specific unit on the property.</p>
                  )}
                </div>
              );
            })()}

            <div className="sm:col-span-2">
              <Label htmlFor="deal-name">Deal Name (optional — auto-fills from property)</Label>
              <Input
                id="deal-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={form.propertyId ? properties.find(p => p.id === form.propertyId)?.name || "" : "Enter deal name"}
                data-testid="input-deal-name"
              />
            </div>

            <div>
              <Label>Deal Type</Label>
              <Select value={form.dealType || undefined} onValueChange={(v) => {
                const val = v === "__clear__" ? "" : v;
                set("dealType", val);
                let autoTeam: string | null = null;
                if (["Purchase", "Sale"].includes(val)) autoTeam = "Investment";
                else if (val === "Lease Acquisition") autoTeam = "Tenant Rep";
                else if (["Lease Disposal", "Lease Renewal", "Rent Review", "Regear"].includes(val)) autoTeam = "Lease Advisory";
                if (autoTeam && !form.team.includes(autoTeam)) {
                  set("team", [...form.team, autoTeam] as any);
                }
              }}>
                <SelectTrigger data-testid="select-deal-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__clear__">None</SelectItem>
                  {CRM_OPTIONS.dealType.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!isEdit && form.dealType === "Leasing" && (
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Tip: for an available unit, start in the <a href="/deals/letting" className="underline">Letting Tracker</a> — adding a unit auto-creates this deal and links them.
                </p>
              )}
            </div>

            <div>
              <Label>Status</Label>
              <Select value={legacyToCode(form.status) || undefined} onValueChange={(v) => set("status", v === "__clear__" ? "" : v)}>
                <SelectTrigger data-testid="select-deal-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__clear__">None</SelectItem>
                  {CRM_OPTIONS.dealStatus.map((s) => {
                    // Pre-Solicitors statuses don't belong on the Deals
                    // CRM — those marketing-stage deals live on the
                    // Letting Tracker. Disable them when creating a new
                    // deal, but keep them selectable in edit mode so
                    // existing deals don't get stuck.
                    const PRE_SOL = ["REP", "SPEC", "LIVE", "AVA", "NEG"];
                    const isPreSol = PRE_SOL.includes(s);
                    return (
                      <SelectItem key={s} value={s} disabled={s === "INV" || (!isEdit && isPreSol)}>
                        {DEAL_STATUS_LABELS[s as keyof typeof DEAL_STATUS_LABELS] ?? s}
                        {s === "INV" ? " (auto)" : ""}
                        {!isEdit && isPreSol ? " — use Letting Tracker" : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {isApprovalStatus && !isSenior && (
                <div className="mt-1.5 flex items-center gap-1.5 text-amber-600 text-xs">
                  <Shield className="w-3.5 h-3.5" />
                  <span>Senior approval required for <strong>{form.status}</strong></span>
                </div>
              )}
              {isApprovalStatus && isSenior && (
                <div className="mt-1.5 flex items-center gap-1.5 text-emerald-600 text-xs">
                  <Shield className="w-3.5 h-3.5" />
                  <span>You will approve this as <strong>{form.status}</strong></span>
                </div>
              )}
              {statusChanged && (
                <div className="mt-2">
                  <Label className="text-xs text-muted-foreground">Reason for status change (optional)</Label>
                  <Input
                    placeholder="e.g. Scope increase, Client approved terms..."
                    value={changeReason}
                    onChange={(e) => setChangeReason(e.target.value)}
                    className="mt-1 text-sm"
                    data-testid="input-change-reason"
                  />
                </div>
              )}
              {isCompletingNow && (
                <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2">
                  <Label className="text-xs font-medium text-emerald-800 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" /> What did we learn from this deal?
                  </Label>
                  <p className="text-[10px] text-emerald-700 mt-0.5">
                    1-2 sentences. Attaches to the tenant's brand card so the team builds a deal knowledge bank.
                  </p>
                  <Textarea
                    placeholder="e.g. Tenant needed 6m rent free to accept ZoneA £300 — happy to go higher for a pop-up term."
                    value={learning}
                    onChange={(e) => setLearning(e.target.value)}
                    rows={2}
                    className="mt-1 text-sm bg-white"
                    data-testid="input-deal-learning"
                  />
                </div>
              )}
            </div>

            <div>
              <Label>Team</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-start font-normal" data-testid="select-deal-team">
                    {form.team.length === 0 ? (
                      <span className="text-muted-foreground">Select teams</span>
                    ) : (
                      <div className="flex gap-1 flex-wrap">
                        {form.team.map(t => (
                          <Badge key={t} className={`text-[10px] px-1.5 py-0 text-white ${DEAL_TEAM_COLORS[t] || "bg-zinc-500"}`}>{teamLabel(t)}</Badge>
                        ))}
                      </div>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {CRM_OPTIONS.dealTeam.map(t => (
                    <DropdownMenuItem key={t} onClick={() => {
                      const next = form.team.includes(t) ? form.team.filter(v => v !== t) : [...form.team, t];
                      set("team", next as any);
                    }}>
                      <div className={`w-3 h-3 rounded-sm border mr-2 flex items-center justify-center ${form.team.includes(t) ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                        {form.team.includes(t) && <span className="text-primary-foreground text-[8px]">✓</span>}
                      </div>
                      <div className={`w-2 h-2 rounded-full ${DEAL_TEAM_COLORS[t] || "bg-zinc-500"} mr-1`} />
                      {teamLabel(t)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div>
              <Label>
                Target Date <span className="text-rose-600">*</span>
              </Label>
              <Input
                type="date"
                value={form.targetDate}
                onChange={(e) => set("targetDate", e.target.value)}
                required
                className={!form.targetDate ? "border-rose-300" : ""}
                data-testid="input-deal-target-date"
              />
              {!form.targetDate && (
                <p className="text-[10px] text-rose-600 mt-0.5">Required — drives the WIP report bucket.</p>
              )}
            </div>

            <div>
              <Label>BGP Contact</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-start font-normal h-auto min-h-[36px] py-1.5" data-testid="input-deal-agent">
                    {form.internalAgent.length === 0 ? (
                      <span className="text-muted-foreground">Select BGP contacts...</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {form.internalAgent.map(name => (
                          <Badge key={name} variant="secondary" className="text-xs">{name}</Badge>
                        ))}
                      </div>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56 max-h-[300px] overflow-y-auto">
                  {/* Alphabetical sort — was rendered in DB-row order
                      which made it nearly impossible to find someone
                      in a team of 30. */}
                  {[...users].sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(u => (
                    <DropdownMenuItem key={u.id} onClick={() => toggleAgent(u.name)} data-testid={`agent-option-${u.name}`}>
                      <div className={`w-3 h-3 rounded-sm border mr-2 flex items-center justify-center ${form.internalAgent.includes(u.name) ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                        {form.internalAgent.includes(u.name) && <span className="text-primary-foreground text-[8px]">✓</span>}
                      </div>
                      <span className="truncate">{u.name}</span>
                    </DropdownMenuItem>
                  ))}
                  {form.internalAgent.length > 0 && (
                    <DropdownMenuItem onClick={() => setForm(p => ({ ...p, internalAgent: [] }))} data-testid="agent-clear-all">
                      <X className="w-3 h-3 mr-2 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Clear all</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div>
              <Label>Asset Class</Label>
              <Select value={form.assetClass || undefined} onValueChange={(v) => set("assetClass", v === "__clear__" ? "" : v)}>
                <SelectTrigger data-testid="select-deal-asset-class">
                  <SelectValue placeholder="Select asset class" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__clear__">None</SelectItem>
                  {CRM_OPTIONS.dealAssetClass.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(() => {
              const dt = form.dealType || "";
              const LEASE_TYPES = new Set(["Lease Acquisition", "Lease Disposal"]);
              const INVESTMENT_TYPES = new Set(["Purchase", "Sale"]);
              const ADVISORY_TYPES = new Set(["Lease Renewal", "Rent Review", "Regear"]);
              const isLease = LEASE_TYPES.has(dt);
              const isInvestment = INVESTMENT_TYPES.has(dt);
              const isAdvisory = ADVISORY_TYPES.has(dt);
              const showAll = !dt || (!isLease && !isInvestment && !isAdvisory);

              const showLandlord = isLease || isAdvisory || showAll;
              const showTenant = isLease || isAdvisory || showAll;
              const showVendor = isInvestment || showAll;
              const showPurchaser = isInvestment || showAll;
              const showRent = isLease || isAdvisory || showAll;
              const showLeaseTerm = isLease || isAdvisory || showAll;
              const showPricing = isInvestment || showAll;
              const showYield = isInvestment || showAll;
              const showArea = isLease || isAdvisory || showAll;
              const showTenure = isLease || isInvestment || showAll;

              // Strict picker filtering — the legacy Landlord picker
              // also included every Tenant in the CRM (carry-over from
              // an early data shape where types were mixed). Cleaned up
              // so Landlord = landlord-family only, Tenant = tenant-
              // family only. Tenants joining a Landlord picker was the
              // top user complaint on this form.
              const tenantTypes = companies.filter(c => c.companyType?.startsWith("Tenant") || c.id === form.tenantId);
              const landlordTypes = companies.filter(c => c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client" || c.id === form.landlordId);
              const vendorTypes = companies.filter(c => c.companyType === "Vendor" || c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client" || c.id === form.vendorId);
              const purchaserTypes = companies.filter(c => c.companyType?.startsWith("Tenant") || c.companyType === "Purchaser" || c.companyType === "Investor" || c.id === form.purchaserId);

              return (
                <>
                  {showLandlord && (
                    <div>
                      <Label>Landlord</Label>
                      <Select value={form.landlordId || undefined} onValueChange={(v) => set("landlordId", v === "__clear__" ? "" : v)}>
                        <SelectTrigger data-testid="select-deal-landlord">
                          <SelectValue placeholder="Link landlord" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__clear__">None</SelectItem>
                          {landlordTypes.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}{c.companyType ? ` (${c.companyType})` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {showTenant && (
                    <div>
                      <Label>Tenant</Label>
                      <Select value={form.tenantId || undefined} onValueChange={(v) => set("tenantId", v === "__clear__" ? "" : v)}>
                        <SelectTrigger data-testid="select-deal-tenant">
                          <SelectValue placeholder="Link tenant" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__clear__">None</SelectItem>
                          {tenantTypes.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}{c.companyType ? ` (${c.companyType})` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {showVendor && (
                    <div>
                      <Label>Vendor</Label>
                      <Select value={form.vendorId || undefined} onValueChange={(v) => set("vendorId", v === "__clear__" ? "" : v)}>
                        <SelectTrigger data-testid="select-deal-vendor">
                          <SelectValue placeholder="Link vendor" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__clear__">None</SelectItem>
                          {vendorTypes.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}{c.companyType ? ` (${c.companyType})` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {showPurchaser && (
                    <div>
                      <Label>Purchaser</Label>
                      <Select value={form.purchaserId || undefined} onValueChange={(v) => set("purchaserId", v === "__clear__" ? "" : v)}>
                        <SelectTrigger data-testid="select-deal-purchaser">
                          <SelectValue placeholder="Link purchaser" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__clear__">None</SelectItem>
                          {purchaserTypes.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}{c.companyType ? ` (${c.companyType})` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {showTenure && (
                    <div>
                      <Label>Tenure</Label>
                      <Input value={form.tenureText} onChange={(e) => set("tenureText", e.target.value)} data-testid="input-deal-tenure" />
                    </div>
                  )}

                  {showPricing && (
                    <div>
                      <Label>Pricing ({"\u00A3"})</Label>
                      <Input type="number" min="0" value={form.pricing} onChange={(e) => set("pricing", e.target.value)} data-testid="input-deal-pricing" />
                    </div>
                  )}

                  {showRent && (
                    <div>
                      <Label>Headline Rent ({"\u00A3"} p.a.)</Label>
                      <Input type="number" min="0" value={form.rentPa} onChange={(e) => set("rentPa", e.target.value)} data-testid="input-deal-rent-pa" />
                    </div>
                  )}

                  {showYield && (
                    <div>
                      <Label>Yield %</Label>
                      <Input type="number" step="0.01" min="0" max="100" value={form.yieldPercent} onChange={(e) => set("yieldPercent", e.target.value)} data-testid="input-deal-yield" />
                    </div>
                  )}

                  <div>
                    <Label>Fee ({"\u00A3"})</Label>
                    <Input type="number" min="0" step="0.01" value={form.fee} onChange={(e) => set("fee", e.target.value)} data-testid="input-deal-fee" />
                  </div>

                  <div>
                    <Label>Fee Agreement</Label>
                    <Select value={form.feeAgreement || undefined} onValueChange={(v) => set("feeAgreement", v === "__clear__" ? "" : v)}>
                      <SelectTrigger data-testid="select-deal-fee-agreement"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__clear__">None</SelectItem>
                        {CRM_OPTIONS.dealFeeAgreement.map((f) => (<SelectItem key={f} value={f}>{f}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>

                  {showArea && (
                    <>
                      <div>
                        <Label>GF Area (sq ft)</Label>
                        <Input type="number" min="0" value={form.gfAreaSqft} onChange={(e) => set("gfAreaSqft", e.target.value)} data-testid="input-deal-gf-area" />
                      </div>
                      <div>
                        <Label>FF Area (sq ft)</Label>
                        <Input type="number" min="0" value={form.ffAreaSqft} onChange={(e) => set("ffAreaSqft", e.target.value)} data-testid="input-deal-ff-area" />
                      </div>
                      <div>
                        <Label>Basement (sq ft)</Label>
                        <Input type="number" min="0" value={form.basementAreaSqft} onChange={(e) => set("basementAreaSqft", e.target.value)} data-testid="input-deal-basement-area" />
                      </div>
                      {isRetailAssetClass(form.assetClass) && (
                        <div>
                          <Label>ITZA (sq ft)</Label>
                          <Input type="number" min="0" value={form.itzaAreaSqft} onChange={(e) => set("itzaAreaSqft", e.target.value)} data-testid="input-deal-itza-area" />
                        </div>
                      )}
                      <div>
                        <Label>{areaBasisFromAssetClass(form.assetClass)} Area (sq ft)</Label>
                        <Input type="number" value={(() => { const t = (parseFloat(form.basementAreaSqft) || 0) + (parseFloat(form.gfAreaSqft) || 0) + (parseFloat(form.ffAreaSqft) || 0); return t > 0 ? String(t) : ""; })()} readOnly className="bg-muted" data-testid="input-deal-total-area" />
                      </div>
                    </>
                  )}

                  {showLeaseTerm && (
                    <>
                      <div>
                        <Label>Lease Length (years)</Label>
                        <Input type="number" step="0.5" min="0" value={form.leaseLength} onChange={(e) => set("leaseLength", e.target.value)} data-testid="input-deal-lease-length" />
                      </div>
                      <div>
                        <Label>Break Option (years)</Label>
                        <Input type="number" step="0.5" min="0" value={form.breakOption} onChange={(e) => set("breakOption", e.target.value)} data-testid="input-deal-break-option" />
                      </div>
                      <div>
                        <Label>Rent Free (months)</Label>
                        <Input type="number" min="0" value={form.rentFree} onChange={(e) => set("rentFree", e.target.value)} data-testid="input-deal-rent-free" />
                      </div>
                      <div>
                        <Label>Capital Contribution ({"\u00A3"})</Label>
                        <Input type="number" min="0" value={form.capitalContribution} onChange={(e) => set("capitalContribution", e.target.value)} data-testid="input-deal-capital-contribution" />
                      </div>
                    </>
                  )}

                  <div>
                    <Label>Instructed</Label>
                    <Input type="date" value={form.instructedAt} onChange={(e) => set("instructedAt", e.target.value)} data-testid="input-deal-instructed-at" />
                  </div>
                  <div>
                    <Label>Exchanged</Label>
                    <Input type="date" value={form.exchangedAt} onChange={(e) => set("exchangedAt", e.target.value)} data-testid="input-deal-exchanged-at" />
                  </div>
                  <div>
                    <Label>Completed</Label>
                    <Input type="date" value={form.completedAt} onChange={(e) => set("completedAt", e.target.value)} data-testid="input-deal-completed-at" />
                  </div>
                  <div>
                    <Label>Invoiced</Label>
                    <Input type="date" value={form.invoicedAt} onChange={(e) => set("invoicedAt", e.target.value)} data-testid="input-deal-invoiced-at" />
                  </div>

                  <div>
                    <Label>AML Check</Label>
                    <Select value={form.amlCheckCompleted || undefined} onValueChange={(v) => set("amlCheckCompleted", v === "__clear__" ? "" : v)}>
                      <SelectTrigger data-testid="select-deal-aml"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__clear__">None</SelectItem>
                        {CRM_OPTIONS.dealAmlCheck.map((a) => (<SelectItem key={a} value={a}>{a}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="sm:col-span-2">
                    <Label>Xero Contact (Billing)</Label>
                    <XeroContactPicker
                      value={form.xeroContactId || null}
                      cachedName={form.xeroContactName}
                      cachedAccountNumber={form.xeroAccountNumber}
                      cachedAddress={form.xeroBillingAddress}
                      onChange={(c) => {
                        setForm((prev) => ({
                          ...prev,
                          xeroContactId: c?.ContactID || "",
                          xeroContactName: c?.Name || "",
                          xeroAccountNumber: c?.AccountNumber || "",
                          xeroBillingAddress: c?.BillingAddress || null,
                        }));
                      }}
                      testIdPrefix="deal-xero-contact"
                    />
                  </div>
                  <div>
                    <Label>PO Number</Label>
                    <Input value={form.poNumber || ""} onChange={(e) => set("poNumber", e.target.value)} placeholder="Purchase order number" data-testid="input-deal-po-number" />
                  </div>
                </>
              );
            })()}

            <div className="sm:col-span-2">
              <Label>Comments</Label>
              <Textarea
                value={form.comments}
                onChange={(e) => set("comments", e.target.value)}
                className="resize-none"
                rows={3}
                data-testid="input-deal-comments"
              />
            </div>
          </div>
          )}

          <DialogFooter className="flex items-center gap-2">
            {!isEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowAllFields(s => !s)}
                className="mr-auto text-xs text-muted-foreground"
                data-testid="button-toggle-all-fields"
              >
                {showAllFields ? "← Back to essentials" : "Show all fields →"}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-deal">
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="button-save-deal">
              {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isEdit ? "Save Changes" : "Create Deal"}
            </Button>
          </DialogFooter>
        </form>

        {isEdit && deal && (
          <div className="px-6 pb-4">
            <FeeAllocationCard
              dealId={deal.id}
              dealFee={parseFloat(form.fee) || deal.fee}
              users={users.map(u => ({ id: String(u.id), name: u.name }))}
              colorMap={buildUserColorMap(users as any)}
            />
          </div>
        )}
      </DialogContent>

      <AlertDialog open={approvalGateOpen} onOpenChange={setApprovalGateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-amber-500" />
              {approvalGateMessage?.includes("AML") ? "AML Check Required" : "Approval Required"}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="whitespace-pre-line block">{approvalGateMessage || "This status change requires senior approval."}</span>
              {!approvalGateMessage?.includes("AML") && (
                <span className="text-xs text-muted-foreground mt-2 block">
                  Please ask a senior team member (Woody, Charlotte, Rupert, or Jack) to make this change, or contact them to approve it on your behalf.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-approval-gate-close">Understood</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function FeeAllocCell({ dealId, dealFee, allAllocations, colorMap, teams, onClick }: { dealId: string; dealFee: number | null | undefined; allAllocations: Record<string, DealFeeAllocation[]> | undefined; colorMap?: Record<string, string>; teams?: string[] | string | null; onClick?: () => void }) {
  const allocations = allAllocations?.[dealId];
  const fee = dealFee || 0;
  const teamList: string[] = Array.isArray(teams) ? teams : (teams ? [teams] : []);
  const teamBadges = teamList.length > 0 ? (
    <div className="flex flex-wrap gap-0.5 mb-0.5">
      {teamList.map(t => (
        <Badge key={t} variant="secondary" className={`text-[9px] px-1 py-0 leading-tight ${DEAL_TEAM_COLORS[t] || ""}`}>{t}</Badge>
      ))}
    </div>
  ) : null;
  if (!allocations || allocations.length === 0) {
    return (
      <div className="space-y-0.5">
        {teamBadges}
        <button onClick={onClick} className="text-xs text-muted-foreground hover:text-foreground hover:underline cursor-pointer">
          + Add split
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-0.5 cursor-pointer group" onClick={onClick} data-testid={`fee-alloc-summary-${dealId}`}>
      {teamBadges}
      {allocations.map((a, i) => {
        const amount = a.allocationType === "percentage"
          ? (fee ?? 0) * (a.percentage || 0) / 100
          : a.fixedAmount || 0;
        const initials = a.agentName.split(" ").map(n => n[0]).join("").slice(0, 2);
        const bg = colorMap?.[a.agentName] || "bg-primary/10";
        return (
          <div key={i} className="flex items-center gap-1.5">
            <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${bg}`}>
              <span className="text-[7px] font-bold text-white">{initials}</span>
            </div>
            <span className="text-[11px] truncate max-w-[60px]">{a.agentName.split(" ")[0]}</span>
            <span className="text-[10px] text-muted-foreground ml-auto font-mono">{formatCurrency(amount)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function FeeAllocationCard({ dealId, dealFee, headlineRent, users, colorMap }: { dealId: string; dealFee: number | null | undefined; headlineRent?: number | null; users: { id: string; name: string }[]; colorMap?: Record<string, string> }) {
  const { toast } = useToast();
  const { data: allocations = [], isLoading } = useQuery<DealFeeAllocation[]>({
    queryKey: ["/api/crm/deals", dealId, "fee-allocations"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/deals/${dealId}/fee-allocations`, { credentials: "include", headers: { Authorization: `Bearer ${localStorage.getItem("bgp_auth_token")}` } });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<FeeAllocationEditorRow[]>([]);
  const [allocType, setAllocType] = useState<"percentage" | "fixed">("percentage");

  // Hydrate the editor state from the saved allocations whenever they
  // arrive (or change) and we're not in the middle of editing. Includes
  // is_bgp_house so the BGP House row reappears flagged on reopen.
  useEffect(() => {
    if (allocations && allocations.length > 0 && !editing) {
      setRows(allocations.map(a => ({
        agentName: a.agentName,
        allocationType: a.allocationType as "percentage" | "fixed",
        percentage: a.percentage || 0,
        fixedAmount: a.fixedAmount || 0,
        isBgpHouse: (a as any).isBgpHouse === true || /\(BGP House\)/i.test(a.agentName || ""),
      })));
      setAllocType(allocations[0].allocationType as "percentage" | "fixed");
    }
  }, [allocations, editing]);

  const saveMutation = useMutation({
    mutationFn: async (data: FeeAllocationEditorRow[]) => {
      await apiRequest("PUT", `/api/crm/deals/${dealId}/fee-allocations`, { allocations: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId, "fee-allocations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/fee-allocations"] });
      setEditing(false);
      toast({ title: "Fee allocation saved" });
    },
    onError: () => {
      toast({ title: "Failed to save fee allocation", variant: "destructive" });
    },
  });

  // Inline edit of the fee basis — headline rent + fee % (fee = rent × pct).
  const [feeBasisEditing, setFeeBasisEditing] = useState(false);
  const [rentInput, setRentInput] = useState("");
  const [pctInput, setPctInput] = useState("");
  const feeBasisMutation = useMutation({
    mutationFn: async ({ rentPa, fee }: { rentPa: number; fee: number }) => {
      await apiRequest("PUT", `/api/crm/deals/${dealId}`, { rentPa, fee });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      setFeeBasisEditing(false);
      toast({ title: "Rent & fee updated" });
    },
    onError: () => toast({ title: "Failed to update rent/fee", variant: "destructive" }),
  });
  const openFeeBasis = () => {
    setRentInput(headlineRent != null ? String(headlineRent) : "");
    setPctInput(headlineRent && (dealFee || 0) ? (((dealFee || 0) / headlineRent) * 100).toFixed(2) : "");
    setFeeBasisEditing(true);
  };
  const saveFeeBasis = () => {
    const rent = Math.round(Number(rentInput) || 0);
    const pct = Number(pctInput) || 0;
    if (rent <= 0 || pct <= 0) { toast({ title: "Enter a rent and a fee %", variant: "destructive" }); return; }
    feeBasisMutation.mutate({ rentPa: rent, fee: Math.round(rent * pct / 100) });
  };

  const startEditing = () => {
    if (!allocations || allocations.length === 0) {
      setRows([{ agentName: "", allocationType: "percentage", percentage: 0, fixedAmount: 0, isBgpHouse: false }]);
      setAllocType("percentage");
    }
    setEditing(true);
  };

  const handleSave = () => {
    const data = rows
      .filter(r => r.isBgpHouse || r.agentName)
      .map(r => ({
        agentName: r.isBgpHouse ? (r.agentName || "BGP House") : r.agentName,
        allocationType: allocType,
        percentage: allocType === "percentage" ? r.percentage : 0,
        fixedAmount: allocType === "fixed" ? r.fixedAmount : 0,
        isBgpHouse: !!r.isBgpHouse,
      }));
    if (data.length === 0) {
      saveMutation.mutate([]);
      return;
    }
    if (allocType === "percentage") {
      const total = data.reduce((s, r) => s + (r.percentage || 0), 0);
      if (Math.abs(total - 100) > 0.01) {
        toast({ title: `Percentages total ${total.toFixed(1)}% — must equal 100%`, variant: "destructive" });
        return;
      }
    }
    saveMutation.mutate(data);
  };

  const totalFee = dealFee || 0;
  const totalAllocated = allocations?.reduce((s, a) => {
    if (a.allocationType === "percentage") return s + (totalFee * (a.percentage || 0) / 100);
    return s + (a.fixedAmount || 0);
  }, 0) || 0;

  const bgpAgents = users.map(u => u.name);

  return (
    <Card data-testid="card-fee-allocation">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <Users className="w-4 h-4 shrink-0" />
            <h3 className="text-sm font-semibold">Fee Allocation</h3>
            {totalFee > 0 && !editing && allocations && allocations.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {formatCurrency(totalAllocated)} of {formatCurrency(totalFee)} allocated
              </Badge>
            )}
            {headlineRent != null && !editing && !feeBasisEditing && (
              <button type="button" onClick={openFeeBasis} title="Click to edit headline rent & fee %" data-testid="button-edit-fee-basis">
                <Badge variant="outline" className="text-[10px] cursor-pointer hover:bg-muted">
                  {headlineRent > 0 && totalFee > 0 ? `${((totalFee / headlineRent) * 100).toFixed(1)}% of ${formatCurrency(headlineRent)} rent` : "Set rent & fee %"}
                </Badge>
              </button>
            )}
          </div>
          <div className="shrink-0">
          {!editing ? (
            <Button variant="outline" size="sm" onClick={startEditing} data-testid="button-edit-fee-allocation">
              <Pencil className="w-3.5 h-3.5 mr-1" />
              {allocations && allocations.length > 0 ? "Edit" : "Add Split"}
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setRows(allocations?.map(a => ({ agentName: a.agentName, allocationType: a.allocationType as "percentage" | "fixed", percentage: a.percentage || 0, fixedAmount: a.fixedAmount || 0 })) || []); }} data-testid="button-cancel-fee-allocation">
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-fee-allocation">
                {saveMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
                Save
              </Button>
            </div>
          )}
          </div>
        </div>

        {feeBasisEditing && (
          <div className="flex items-center gap-2 mb-3 flex-wrap bg-muted/30 rounded-md p-2">
            <span className="text-[10px] text-muted-foreground">Rent £/pa</span>
            <Input type="number" step="0.01" value={rentInput} onChange={(e) => setRentInput(e.target.value)} className="h-7 w-28 text-xs" data-testid="input-fee-rent" />
            <span className="text-[10px] text-muted-foreground">Fee %</span>
            <Input type="number" step="0.01" value={pctInput} onChange={(e) => setPctInput(e.target.value)} className="h-7 w-20 text-xs" data-testid="input-fee-pct" />
            <span className="text-[10px] text-muted-foreground">= {formatCurrency(Math.round((Number(rentInput) || 0) * (Number(pctInput) || 0) / 100))}</span>
            <Button size="sm" className="h-7 text-xs" onClick={saveFeeBasis} disabled={feeBasisMutation.isPending} data-testid="button-save-fee-basis">
              {feeBasisMutation.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}Save
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setFeeBasisEditing(false)}>Cancel</Button>
          </div>
        )}

        {editing ? (
          // Shared editor — same UI as the New Deal create form so the
          // %/£ toggle, agent picker, BGP House row all behave identically.
          // FeeAllocationCard keeps ownership of the save mutation; the
          // editor is purely controlled.
          <FeeAllocationEditor
            rows={rows}
            onChange={setRows}
            allocType={allocType}
            onAllocTypeChange={setAllocType}
            dealFee={totalFee}
            bgpAgents={users}
            colorMap={colorMap}
          />
        ) : isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : allocations && allocations.length > 0 ? (
          <div className="space-y-1">
            {allocations.filter((a) => !(a as any).isBgpHouse).map((alloc, idx) => {
              const amount = alloc.allocationType === "percentage"
                ? totalFee * (alloc.percentage || 0) / 100
                : alloc.fixedAmount || 0;
              // agentName is blank on rows saved with only the canonical
              // agentUserId — resolve the name from the BGP user list so the
              // split always shows who it's for (and never crashes on a null
              // name). BGP House (firm overhead) rows are hidden here.
              const agentLabel = alloc.agentName || users?.find((u: any) => u.id === (alloc as any).agentUserId)?.name || "Unknown";
              return (
                <div key={alloc.id} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/30" data-testid={`fee-alloc-display-${idx}`}>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-[9px] font-semibold">
                        {agentLabel.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                      </span>
                    </div>
                    <span className="text-xs font-medium">{agentLabel}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {alloc.allocationType === "percentage" && (
                      <span className="text-muted-foreground">{alloc.percentage}%</span>
                    )}
                    <span className="font-mono font-medium">{formatCurrency(amount)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-3">No fee allocation set — click Add Split to allocate the fee between BGP agents</p>
        )}
      </CardContent>
    </Card>
  );
}

function HotsChecklistDialog({
  open,
  onOpenChange,
  deal,
  properties,
  companies,
  users,
  onComplete,
  colorMap,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: CrmDeal | null;
  properties: CrmProperty[];
  companies: CrmCompany[];
  users: { id: number; name: string; email: string }[];
  onComplete: () => void;
  colorMap?: Record<string, string>;
}) {
  const { toast } = useToast();

  const [step, setStep] = useState<"upload" | "parsing" | "form" | "saving">("upload");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [extractedData, setExtractedData] = useState<any>(null);
  const [missingFields, setMissingFields] = useState<string[]>([]);

  const [form, setForm] = useState({
    xeroContactId: "",
    xeroContactName: "",
    xeroAccountNumber: "",
    xeroBillingAddress: null as any,
    invoicingEmail: "",
    propertyId: "",
    // Money / percentage fields are nullable — using 0 as "empty" caused
    // the controlled-input to wipe user typing mid-keystroke (typing
    // "10.5" went 1 → 10 → 10 → 10.5, and the "10" intermediate where
    // state==10 then ".5" tried to extend caused React to reset value
    // because `0 || ""` rendered as empty). Now `null` means empty and
    // any numeric (including 0) is preserved.
    rentPa: null as number | null,
    feePercentage: null as number | null,
    fee: null as number | null,
    targetDate: "",
    amlCheckCompleted: "",
    invoicingNotes: "",
    poNumber: "",
    leaseLength: "" as string | number,
    breakOption: "",
    rentFree: "" as string | number,
    capitalContribution: 0,
    dealType: "",
    assetClass: "",
    totalAreaSqft: 0,
  });
  const [feeRows, setFeeRows] = useState<{ agentName: string; percentage: number }[]>([
    { agentName: "", percentage: 100 },
  ]);
  const [propertySearch, setPropertySearch] = useState("");

  const { data: existingAllocations = [] } = useQuery<DealFeeAllocation[]>({
    queryKey: ["/api/crm/deals", deal?.id, "fee-allocations"],
    enabled: !!deal?.id && open,
  });

  useEffect(() => {
    if (!open) {
      setStep("upload");
      setUploadedFileName("");
      setAiSummary("");
      setExtractedData(null);
      setMissingFields([]);
      setPropertySearch("");
    }
  }, [open]);

  useEffect(() => {
    if (deal && open && step === "upload") {
      setForm(prev => ({
        ...prev,
        xeroContactId: (deal as any).xeroContactId || "",
        xeroContactName: (deal as any).xeroContactName || "",
        xeroAccountNumber: (deal as any).xeroAccountNumber || "",
        xeroBillingAddress: (deal as any).xeroBillingAddress || null,
        propertyId: deal.propertyId || "",
        rentPa: deal.rentPa || 0,
        fee: deal.fee || 0,
        feePercentage: deal.feePercentage || 0,
        dealType: deal.dealType || "",
        assetClass: deal.assetClass || "",
        totalAreaSqft: deal.totalAreaSqft || 0,
        leaseLength: deal.leaseLength || "",
        breakOption: deal.breakOption || "",
        rentFree: deal.rentFree || "",
        capitalContribution: deal.capitalContribution || 0,
        amlCheckCompleted: deal.amlCheckCompleted || "",
        invoicingNotes: deal.invoicingNotes || "",
        poNumber: deal.poNumber || "",
        targetDate: toDateInputValue(deal.targetDate),
        invoicingEmail: deal.invoicingEmail || "",
      }));
    }
  }, [deal, open]);

  useEffect(() => {
    if (open && existingAllocations && existingAllocations.length > 0) {
      setFeeRows(existingAllocations.map(a => ({
        agentName: a.agentName,
        percentage: a.percentage || 0,
      })));
    } else if (open && step === "upload") {
      setFeeRows([{ agentName: "", percentage: 100 }]);
    }
  }, [open, existingAllocations]);

  useEffect(() => {
    const rent = form.rentPa;
    const pct = form.feePercentage;
    if (rent != null && rent > 0 && pct != null && pct > 0) {
      setForm(prev => ({ ...prev, fee: Math.round((rent * pct) / 100) }));
    }
  }, [form.rentPa, form.feePercentage]);

  const filteredProperties = useMemo(() => {
    if (!propertySearch.trim()) return properties.slice(0, 20);
    const q = propertySearch.toLowerCase();
    return properties.filter(p => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [properties, propertySearch]);

  const selectedProperty = properties.find(p => p.id === form.propertyId);

  const handleFileUpload = async (file: File) => {
    if (!deal) return;
    setUploadedFileName(file.name);
    setStep("parsing");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/parse-hots`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      const ex = data.extracted;
      setExtractedData(ex);
      setAiSummary(ex.summary || "");

      const missing: string[] = [];
      const tryMatchCompany = (name: string | null) => {
        if (!name) return "";
        const q = name.toLowerCase().trim();
        const match = companies.find(c => c.name.toLowerCase().trim() === q)
          || companies.find(c => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase()));
        return match?.id || "";
      };
      const tryMatchProperty = (addr: string | null) => {
        if (!addr) return "";
        const q = addr.toLowerCase().trim();
        const match = properties.find(p => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()))
          || properties.find(p => { const a = typeof p.address === 'string' ? p.address : (p.address as any)?.formatted || ''; return a.toLowerCase().includes(q) || q.includes(a.toLowerCase()); });
        return match?.id || "";
      };

      const tenantId = tryMatchCompany(ex.tenantName);
      const landlordId = tryMatchCompany(ex.landlordName);
      const propId = tryMatchProperty(ex.propertyAddress) || form.propertyId;

      // The Xero contact picker is unfilled until the user selects one —
      // we cache the extracted name as a search hint, but the actual
      // ContactID has to come from Xero.
      const extractedBillingName = ex.tenantName || ex.landlordName || "";

      if (!form.xeroContactId && !extractedBillingName) missing.push("Billing Contact");
      if (!propId) missing.push("Property / Unit");
      if (!ex.rentPa) missing.push("Rent PA");
      if (!ex.feePercentage && !ex.fee) missing.push("Fee Details");
      if (!ex.targetDate) missing.push("Target Date");

      setMissingFields(missing);
      setForm(prev => ({
        ...prev,
        xeroContactName: prev.xeroContactName || extractedBillingName,
        propertyId: propId || prev.propertyId,
        rentPa: ex.rentPa || prev.rentPa,
        feePercentage: ex.feePercentage || prev.feePercentage,
        fee: ex.fee || prev.fee,
        targetDate: ex.targetDate || prev.targetDate,
        leaseLength: ex.leaseLength || prev.leaseLength,
        breakOption: ex.breakOption || prev.breakOption,
        rentFree: ex.rentFree || prev.rentFree,
        capitalContribution: ex.capitalContribution || prev.capitalContribution,
        dealType: ex.dealType || prev.dealType,
        assetClass: ex.assetClass || prev.assetClass,
        totalAreaSqft: ex.totalAreaSqft || prev.totalAreaSqft,
        invoicingNotes: ex.invoicingNotes || ex.specialConditions || prev.invoicingNotes,
      }));

      if (ex.agentNames && Array.isArray(ex.agentNames) && ex.agentNames.length > 0) {
        const bgpAgents = users.map(u => u.name);
        const matched = ex.agentNames.map((name: string) => {
          const match = bgpAgents.find(a => a.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(a.toLowerCase()));
          return match || name;
        });
        const pct = Math.round(100 / matched.length);
        setFeeRows(matched.map((name: string, i: number) => ({
          agentName: bgpAgents.includes(name) ? name : "",
          percentage: i === matched.length - 1 ? 100 - pct * (matched.length - 1) : pct,
        })));
      }

      if (!propId && ex.propertyAddress) setPropertySearch(ex.propertyAddress);

      setStep("form");
      toast({ title: "HOTs parsed successfully", description: `Extracted ${Object.values(ex).filter(v => v !== null).length} fields from ${file.name}` });
    } catch (err: any) {
      toast({ title: "Could not parse HOTs", description: err.message, variant: "destructive" });
      setStep("form");
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!deal) throw new Error("No deal");
      const payload: Record<string, unknown> = {
        status: "HOTs",
        xeroContactId: form.xeroContactId || null,
        xeroContactName: form.xeroContactName || null,
        xeroAccountNumber: form.xeroAccountNumber || null,
        xeroBillingAddress: form.xeroBillingAddress || null,
        invoicingEmail: form.invoicingEmail || null,
        propertyId: form.propertyId || null,
        rentPa: form.rentPa || null,
        feePercentage: form.feePercentage || null,
        fee: form.fee || null,
        targetDate: form.targetDate || null,
        amlCheckCompleted: form.amlCheckCompleted || null,
        invoicingNotes: form.invoicingNotes || null,
        poNumber: form.poNumber || null,
      };
      if (form.leaseLength) payload.leaseLength = form.leaseLength;
      if (form.breakOption) payload.breakOption = form.breakOption;
      if (form.rentFree) payload.rentFree = form.rentFree;
      if (form.capitalContribution) payload.capitalContribution = form.capitalContribution;
      if (form.dealType) payload.dealType = form.dealType;
      if (form.assetClass) payload.assetClass = form.assetClass;
      if (form.totalAreaSqft) payload.totalAreaSqft = form.totalAreaSqft;

      // Save allocations FIRST so the status flip is the commit point.
      // Previously the deal was flipped to HOTs before allocations, so a
      // 400 on the allocations write (now stricter — 100% sum + BGP House
      // required) left the deal in HOTs without a valid fee split.
      const allocations = feeRows.filter(r => r.agentName).map(r => ({
        agentName: r.agentName,
        allocationType: "percentage",
        percentage: r.percentage,
        fixedAmount: 0,
      }));
      if (allocations.length > 0) {
        await apiRequest("PUT", `/api/crm/deals/${deal.id}/fee-allocations`, { allocations });
      }
      await apiRequest("PUT", `/api/crm/deals/${deal.id}`, payload);
    },
    onSuccess: async () => {
      toast({ title: "HOTs checklist completed", description: "Deal moved to HOTs with all details saved." });
      invalidateDealCaches();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/fee-allocations"] });
      onOpenChange(false);
      onComplete();
    },
    onError: (err: Error) => {
      setStep("form");
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const canSubmit = (form.xeroContactId || form.xeroContactName) && (form.fee ?? 0) > 0;
  const bgpAgents = users.map(u => u.name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            HOTs Checklist — {deal?.name || "Deal"}
          </DialogTitle>
          <DialogDescription>
            {step === "upload" && "Upload the Heads of Terms document. AI will extract all the deal information."}
            {step === "parsing" && "Reading the HOTs document and extracting deal information..."}
            {step === "form" && (missingFields.length > 0
              ? `Extracted from HOTs — please complete the ${missingFields.length} missing field${missingFields.length > 1 ? "s" : ""} highlighted below.`
              : "All fields extracted from HOTs. Review and confirm the details below.")}
            {step === "saving" && "Saving deal details..."}
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="py-4">
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary hover:bg-muted/30 transition-colors"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".pdf,.docx,.doc,.txt,.rtf";
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) handleFileUpload(file);
                };
                input.click();
              }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files?.[0];
                if (file) handleFileUpload(file);
              }}
              data-testid="hots-upload-zone"
            >
              <FileText className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">Upload Heads of Terms</p>
              <p className="text-xs text-muted-foreground mt-1">
                Drop a PDF, DOCX, or text file here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                AI will read the document and pre-fill all deal details automatically
              </p>
            </div>
            <div className="mt-4 text-center">
              <Button variant="ghost" size="sm" onClick={() => setStep("form")} data-testid="button-hots-skip-upload">
                Skip — enter details manually
              </Button>
            </div>
          </div>
        )}

        {step === "parsing" && (
          <div className="py-8 text-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
            <div>
              <p className="text-sm font-medium">Reading {uploadedFileName}...</p>
              <p className="text-xs text-muted-foreground mt-1">Extracting deal terms, parties, financials, and lease details</p>
            </div>
          </div>
        )}

        {(step === "form" || step === "saving") && (
          <div className="space-y-4 py-2">
            {aiSummary && (
              <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-3">
                <p className="text-xs font-medium text-blue-800 dark:text-blue-300 mb-1 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> AI Summary from HOTs
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-400">{aiSummary}</p>
                {missingFields.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-medium">
                    Missing: {missingFields.join(", ")}
                  </p>
                )}
              </div>
            )}

            <div className={`rounded-md border p-3 space-y-3 bg-muted/20 ${missingFields.includes("Billing Contact") ? "ring-2 ring-amber-400" : ""}`}>
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Receipt className="w-4 h-4" />
                Xero Billing Contact (required)
                {missingFields.includes("Billing Contact") && <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-400">Needs input</Badge>}
              </h4>
              <div>
                <Label className="text-xs">Xero Contact</Label>
                <XeroContactPicker
                  value={form.xeroContactId || null}
                  cachedName={form.xeroContactName}
                  cachedAccountNumber={form.xeroAccountNumber}
                  cachedAddress={form.xeroBillingAddress}
                  onChange={(c) => {
                    setForm((prev) => ({
                      ...prev,
                      xeroContactId: c?.ContactID || "",
                      xeroContactName: c?.Name || "",
                      xeroAccountNumber: c?.AccountNumber || "",
                      xeroBillingAddress: c?.BillingAddress || null,
                    }));
                  }}
                  testIdPrefix="hots-xero-contact"
                />
                {!form.xeroContactId && form.xeroContactName && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    AI suggested name: <span className="font-medium">{form.xeroContactName}</span> — pick the matching Xero contact above.
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Invoicing Email Address (override)</Label>
                <Input value={form.invoicingEmail} onChange={(e) => setForm(prev => ({ ...prev, invoicingEmail: e.target.value }))}
                  placeholder="invoices@company.com" type="email" data-testid="input-hots-email" />
              </div>
            </div>

            <div className={`rounded-md border p-3 space-y-3 bg-muted/20 ${missingFields.includes("Property / Unit") ? "ring-2 ring-amber-400" : ""}`}>
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Property / Unit
                {missingFields.includes("Property / Unit") && <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-400">Needs input</Badge>}
              </h4>
              <div>
                <Label className="text-xs">Unit Address</Label>
                <div className="relative">
                  <Input value={selectedProperty ? selectedProperty.name : propertySearch}
                    onChange={(e) => { setPropertySearch(e.target.value); if (form.propertyId) setForm(prev => ({ ...prev, propertyId: "" })); }}
                    placeholder="Search properties..." data-testid="input-hots-property" />
                  {propertySearch && !form.propertyId && (
                    <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {filteredProperties.map(p => (
                        <div key={p.id} className="px-3 py-2 text-sm hover:bg-accent cursor-pointer"
                          onClick={() => { setForm(prev => ({ ...prev, propertyId: p.id })); setPropertySearch(""); }}
                          data-testid={`hots-property-option-${p.id}`}>
                          <span className="font-medium">{p.name}</span>
                          {(() => { const a = typeof p.address === "string" ? p.address : (p.address as any)?.formatted || ""; return a ? <span className="text-muted-foreground ml-1">— {a}</span> : null; })()}
                        </div>
                      ))}
                      {filteredProperties.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No properties found</div>}
                    </div>
                  )}
                </div>
                {selectedProperty && (
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{selectedProperty.name}</Badge>
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setForm(prev => ({ ...prev, propertyId: "" }))}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {(form.leaseLength || form.breakOption || form.rentFree || form.totalAreaSqft > 0) && (
              <div className="rounded-md border p-3 space-y-3 bg-muted/20">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Lease Terms (from HOTs)
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {form.totalAreaSqft > 0 && (
                    <div><Label className="text-xs">Area (sq ft)</Label><Input type="number" value={form.totalAreaSqft}
                      onChange={(e) => setForm(prev => ({ ...prev, totalAreaSqft: parseFloat(e.target.value) || 0 }))} /></div>
                  )}
                  {form.leaseLength && (
                    <div><Label className="text-xs">Lease Length</Label><Input value={form.leaseLength}
                      onChange={(e) => setForm(prev => ({ ...prev, leaseLength: e.target.value }))} /></div>
                  )}
                  {form.breakOption && (
                    <div><Label className="text-xs">Break Option</Label><Input value={form.breakOption}
                      onChange={(e) => setForm(prev => ({ ...prev, breakOption: e.target.value }))} /></div>
                  )}
                  {form.rentFree && (
                    <div><Label className="text-xs">Rent Free</Label><Input value={form.rentFree}
                      onChange={(e) => setForm(prev => ({ ...prev, rentFree: e.target.value }))} /></div>
                  )}
                </div>
              </div>
            )}

            <div className={`rounded-md border p-3 space-y-3 bg-muted/20 ${missingFields.includes("Rent PA") || missingFields.includes("Fee Details") ? "ring-2 ring-amber-400" : ""}`}>
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Receipt className="w-4 h-4" />
                Fee Details
                {(missingFields.includes("Rent PA") || missingFields.includes("Fee Details")) && <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-400">Needs input</Badge>}
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Headline Rent (£ p.a.)</Label>
                  <Input type="number" value={form.rentPa ?? ""} onChange={(e) => {
                    const v = e.target.value;
                    setForm(prev => ({ ...prev, rentPa: v === "" ? null : (Number.isNaN(parseFloat(v)) ? prev.rentPa : parseFloat(v)) }));
                  }}
                    placeholder="0" data-testid="input-hots-rent" />
                </div>
                <div>
                  <Label className="text-xs">% Agency Fee</Label>
                  <Input type="number" step="0.01" value={form.feePercentage ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm(prev => ({ ...prev, feePercentage: v === "" ? null : (Number.isNaN(parseFloat(v)) ? prev.feePercentage : parseFloat(v)) }));
                    }}
                    placeholder="e.g. 10" data-testid="input-hots-fee-pct" />
                </div>
                <div>
                  <Label className="text-xs">Total Fee (£) +VAT</Label>
                  <Input type="number" step="0.01" value={form.fee ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm(prev => ({ ...prev, fee: v === "" ? null : (Number.isNaN(parseFloat(v)) ? prev.fee : parseFloat(v)) }));
                    }}
                    placeholder="0.00" data-testid="input-hots-fee" />
                </div>
              </div>
              {form.capitalContribution > 0 && (
                <div className="w-48">
                  <Label className="text-xs">Capital Contribution (£)</Label>
                  <Input type="number" value={form.capitalContribution}
                    onChange={(e) => setForm(prev => ({ ...prev, capitalContribution: parseFloat(e.target.value) || 0 }))} />
                </div>
              )}
            </div>

            <div className="rounded-md border p-3 space-y-3 bg-muted/20">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Users className="w-4 h-4" />
                BGP Fee Split
              </h4>
              {feeRows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2" data-testid={`hots-fee-row-${idx}`}>
                  <Select value={row.agentName} onValueChange={(v) => setFeeRows(prev => prev.map((r, i) => i === idx ? { ...r, agentName: v } : r))}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select agent" /></SelectTrigger>
                    <SelectContent>{bgpAgents.map(name => <SelectItem key={name} value={name}><span className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${colorMap?.[name] || "bg-zinc-500"}`} />{name}</span></SelectItem>)}</SelectContent>
                  </Select>
                  <div className="flex items-center gap-1 w-24">
                    <Input type="number" className="w-16" value={row.percentage || ""} step="any"
                      onChange={(e) => setFeeRows(prev => prev.map((r, i) => i === idx ? { ...r, percentage: parseFloat(e.target.value) || 0 } : r))} />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                  {feeRows.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFeeRows(prev => prev.filter((_, i) => i !== idx))}>
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setFeeRows(prev => [...prev, { agentName: "", percentage: 0 }])} data-testid="button-hots-add-split">
                <Plus className="w-3 h-3 mr-1" /> Add Agent
              </Button>
              {feeRows.filter(r => r.agentName).length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Total: {feeRows.reduce((s, r) => s + (r.percentage || 0), 0).toFixed(1)}%
                  {(form.fee ?? 0) > 0 && ` — ${feeRows.filter(r => r.agentName).map(r => `${r.agentName}: £${((form.fee! * r.percentage / 100)).toFixed(2)}`).join(", ")}`}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className={missingFields.includes("Target Date") ? "ring-2 ring-amber-400 rounded-md" : ""}>
                <Label className="text-xs">Target Exchange / Completion Date</Label>
                <Input
                  type="date"
                  value={form.targetDate || ""}
                  onChange={e => setForm(prev => ({ ...prev, targetDate: e.target.value }))}
                  data-testid="input-hots-target-date"
                />
              </div>
              <div>
                <Label className="text-xs">AML Check Completed?</Label>
                <Select value={form.amlCheckCompleted || undefined} onValueChange={(v) => setForm(prev => ({ ...prev, amlCheckCompleted: v }))}>
                  <SelectTrigger data-testid="select-hots-aml"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES">YES</SelectItem>
                    <SelectItem value="NO">NO</SelectItem>
                    <SelectItem value="N/A">N/A</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <Label className="text-xs">Comments / Specific Invoice Wording</Label>
                <Textarea value={form.invoicingNotes} onChange={(e) => setForm(prev => ({ ...prev, invoicingNotes: e.target.value }))}
                  placeholder="e.g. For settlement of Pizza Express' 2023 CVA rent review at Bromley South Central"
                  rows={3} data-testid="input-hots-notes" />
              </div>
              <div>
                <Label className="text-xs">PO Number</Label>
                <Input value={form.poNumber || ""} onChange={(e) => setForm(prev => ({ ...prev, poNumber: e.target.value }))}
                  placeholder="Purchase order number" data-testid="input-hots-po-number" />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "upload" && (
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-hots-cancel">Cancel</Button>
          )}
          {(step === "form" || step === "saving") && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-hots-cancel">Cancel</Button>
              <Button onClick={() => { setStep("saving"); saveMutation.mutate(); }}
                disabled={!canSubmit || saveMutation.isPending} data-testid="button-hots-submit">
                {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Complete & Move to HOTs
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function XeroInvoiceSection({ dealId, deal }: { dealId: string; deal: CrmDeal; companies?: CrmCompany[] }) {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [poNumber, setPoNumber] = useState(deal.poNumber || "");

  const xeroContactId = (deal as any).xeroContactId || null;
  const xeroContactName = (deal as any).xeroContactName || null;
  const xeroAccountNumber = (deal as any).xeroAccountNumber || null;
  const xeroBillingAddress = (deal as any).xeroBillingAddress || null;

  const updateXeroContact = useCallback((contact: XeroContact | null) => {
    apiRequest("PUT", `/api/crm/deals/${dealId}`, {
      xeroContactId: contact?.ContactID || null,
      xeroContactName: contact?.Name || null,
      xeroAccountNumber: contact?.AccountNumber || null,
      xeroBillingAddress: contact?.BillingAddress || null,
    })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId] });
        invalidateDealCaches();
        if (contact) {
          toast({ title: "Xero contact linked", description: `${contact.Name}${contact.AccountNumber ? ` (A/C ${contact.AccountNumber})` : ""}` });
        }
      })
      .catch((err) => {
        toast({ title: "Error linking Xero contact", description: err?.message || String(err), variant: "destructive" });
      });
  }, [dealId, toast]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const xeroError = params.get("xero_error");
    if (xeroError) {
      toast({ title: "Xero Connection Failed", description: decodeURIComponent(xeroError), variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const { data: xeroStatus } = useQuery<{ configured: boolean; connected: boolean }>({
    queryKey: ["/api/xero/status"],
  });

  const { data: invoices = [], refetch: refetchInvoices } = useQuery<any[]>({
    queryKey: ["/api/xero/invoices", dealId],
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/xero/auth");
      const data = await res.json();
      window.location.href = data.url;
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/xero/invoices", {
        dealId,
        xeroContactId: xeroContactId || null,
        contactName: xeroContactName || deal.name,
        poNumber: poNumber || deal.poNumber || null,
        lineItems: [{
          Description: deal.name || "Professional fees",
          Quantity: 1,
          UnitAmount: amount || deal.fee || 0,
          AccountCode: "200",
          TaxType: "OUTPUT2",
        }],
        reference: reference || deal.name,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Invoice created in Xero" });
      setCreating(false);
      setReference("");
      setAmount(0);
      refetchInvoices();
      invalidateDealCaches();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error creating invoice", description: err.message, variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest("POST", `/api/xero/invoices/${invoiceId}/sync`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Invoice synced" });
      refetchInvoices();
      invalidateDealCaches();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] });
    },
    onError: (err: Error) => {
      toast({ title: "Sync error", description: err.message, variant: "destructive" });
    },
  });

  const XERO_STATUS_COLORS: Record<string, string> = {
    DRAFT: "bg-zinc-500",
    SUBMITTED: "bg-blue-500",
    AUTHORISED: "bg-green-600",
    PAID: "bg-emerald-600",
    VOIDED: "bg-red-500",
    DELETED: "bg-red-700",
    ERROR: "bg-red-500",
  };

  if (!xeroStatus?.configured) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Receipt className="w-4 h-4" />
            <h3 className="text-sm font-semibold">Xero Invoicing</h3>
          </div>
          <p className="text-xs text-muted-foreground">Xero is not yet configured. API credentials will be added soon.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="xero-invoice-section">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4" />
            <h3 className="text-sm font-semibold">Xero Invoicing</h3>
            {invoices.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{invoices.length} invoice{invoices.length !== 1 ? "s" : ""}</Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {!xeroStatus?.connected ? (
              <Button variant="outline" size="sm" onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending} data-testid="button-connect-xero">
                {connectMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
                Connect Xero
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setCreating(true); setAmount(deal.fee || 0); setReference(deal.name || ""); }}
                data-testid="button-create-xero-invoice"
              >
                <Send className="w-3.5 h-3.5 mr-1" />
                Send to Xero
              </Button>
            )}
          </div>
        </div>

        {!creating && (
          <div className="mb-3">
            <XeroContactPicker
              value={xeroContactId}
              cachedName={xeroContactName}
              cachedAccountNumber={xeroAccountNumber}
              cachedAddress={xeroBillingAddress}
              onChange={updateXeroContact}
              testIdPrefix="deal-summary-xero-contact"
            />
          </div>
        )}

        {creating && (
          <div className="border rounded-md p-3 mb-3 space-y-3 bg-muted/30">
            <div>
              <Label className="text-xs mb-1 block">Xero Contact (Billing)</Label>
              <XeroContactPicker
                value={xeroContactId}
                cachedName={xeroContactName}
                cachedAccountNumber={xeroAccountNumber}
                cachedAddress={xeroBillingAddress}
                onChange={updateXeroContact}
                testIdPrefix="invoice-xero-contact"
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Reference</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={deal.name || "Invoice reference"}
                data-testid="input-xero-reference"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1 block">Amount (excl. VAT)</Label>
                <Input
                  type="number"
                  value={amount || ""}
                  onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  data-testid="input-xero-amount"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">PO Number</Label>
                <Input
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  placeholder={deal.poNumber || "Purchase order number"}
                  data-testid="input-xero-po-number"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => createInvoiceMutation.mutate()}
                disabled={createInvoiceMutation.isPending}
                data-testid="button-confirm-xero-invoice"
              >
                {createInvoiceMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
                Create Draft Invoice
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCreating(false)} data-testid="button-cancel-xero-invoice">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {invoices.length > 0 && (
          <div className="space-y-2">
            {invoices.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between p-2 rounded-md border text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge className={`text-[10px] text-white ${XERO_STATUS_COLORS[inv.status] || "bg-zinc-500"}`}>
                    {inv.status}
                  </Badge>
                  <span className="truncate">
                    {inv.invoicingEntityName && <span className="text-muted-foreground">{inv.invoicingEntityName} — </span>}
                    {inv.invoiceNumber || inv.reference || "Draft"}
                  </span>
                  {inv.totalAmount != null && (
                    <span className="text-muted-foreground font-mono text-xs">
                      £{inv.totalAmount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {inv.xeroUrl && (
                    <a href={inv.xeroUrl} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-xero-link-${inv.id}`}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </a>
                  )}
                  {inv.sentToXero && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => syncMutation.mutate(inv.id)}
                      disabled={syncMutation.isPending}
                      data-testid={`button-xero-sync-${inv.id}`}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!xeroStatus?.connected && invoices.length === 0 && (
          <p className="text-xs text-muted-foreground">Connect Xero to create and track invoices for this deal.</p>
        )}
      </CardContent>
    </Card>
  );
}

function KYCPartyRow({ company, role, onRunKyc, loading }: { company: CrmCompany; role: string; onRunKyc: (id: string) => void; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const chData = company.companiesHouseData as any;
  const profile = chData?.profile;
  const officers = (chData?.officers || company.companiesHouseOfficers || []) as any[];
  const pscs = (chData?.pscs || []) as any[];
  const filings = (chData?.filings || []) as any[];
  const kycStatus = company.kycStatus;
  const hasKyc = !!profile;
  const activeOfficers = officers.filter((o: any) => !o.resignedOn);
  const activePscs = pscs.filter((p: any) => !p.ceasedOn);

  return (
    <div className="rounded-md border bg-muted/10 p-3 space-y-2" data-testid={`kyc-party-${company.id}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {kycStatus === "approved" ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" /> :
           kycStatus === "in_review" ? <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" /> :
           kycStatus === "rejected" ? <XCircle className="w-4 h-4 text-red-500 shrink-0" /> :
           <div className="w-4 h-4 rounded-full border-2 border-dashed border-muted-foreground/40 shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{company.name}</p>
            <p className="text-[10px] text-muted-foreground">{role}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {kycStatus && kycStatus !== "pending" && (
            <Badge className={`text-[9px] text-white ${kycStatus === "approved" ? "bg-green-600" : kycStatus === "in_review" ? "bg-amber-500" : kycStatus === "rejected" ? "bg-red-500" : "bg-zinc-400"}`}>
              {kycStatus === "approved" ? "Approved" : kycStatus === "in_review" ? "In review" : kycStatus === "rejected" ? "Rejected" : kycStatus}
            </Badge>
          )}
          {!hasKyc && !kycStatus && <Badge variant="outline" className="text-[9px] text-muted-foreground">Not Checked</Badge>}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRunKyc(company.id)} disabled={loading} data-testid={`button-run-kyc-${company.id}`}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {hasKyc && (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
            <span className="text-muted-foreground">Company</span><span>{profile.companyName}</span>
            <span className="text-muted-foreground">Number</span><span>{profile.companyNumber}</span>
            <span className="text-muted-foreground">Status</span><span className="capitalize">{profile.companyStatus}</span>
            <span className="text-muted-foreground">Type</span><span className="capitalize">{profile.companyType?.replace(/-/g, " ")}</span>
            <span className="text-muted-foreground">Incorporated</span><span>{profile.dateOfCreation}</span>
            {profile.registeredOfficeAddress && (
              <>
                <span className="text-muted-foreground">Address</span>
                <span>{[profile.registeredOfficeAddress.address_line_1, profile.registeredOfficeAddress.locality, profile.registeredOfficeAddress.postal_code].filter(Boolean).join(", ")}</span>
              </>
            )}
            {profile.sicCodes?.length > 0 && (
              <><span className="text-muted-foreground">SIC</span><span>{profile.sicCodes.join(", ")}</span></>
            )}
            {profile.lastAccountsMadeUpTo && (
              <><span className="text-muted-foreground">Last Accounts</span><span>{profile.lastAccountsMadeUpTo}</span></>
            )}
            {profile.hasInsolvencyHistory && (
              <><span className="text-muted-foreground">Insolvency</span><span className="text-amber-600 font-medium">History found</span></>
            )}
            {profile.accountsOverdue && (
              <><span className="text-muted-foreground">Accounts</span><span className="text-amber-600 font-medium">Overdue</span></>
            )}
            {profile.confirmationStatementOverdue && (
              <><span className="text-muted-foreground">Confirmation</span><span className="text-amber-600 font-medium">Overdue</span></>
            )}
            {profile.hasCharges && (
              <><span className="text-muted-foreground">Charges</span><span>Yes</span></>
            )}
          </div>

          <Button variant="ghost" size="sm" className="text-[11px] px-0 h-5" onClick={() => setExpanded(!expanded)} data-testid={`button-expand-kyc-${company.id}`}>
            {expanded ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
            {expanded ? "Hide" : `Officers (${activeOfficers.length}), PSCs (${activePscs.length}), Filings (${filings.length})`}
          </Button>

          {expanded && (
            <div className="space-y-2 text-[11px]">
              {activeOfficers.length > 0 && (
                <div>
                  <p className="font-semibold mb-1">Active Officers</p>
                  {activeOfficers.map((o: any, i: number) => (
                    <div key={i} className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      <Badge variant="outline" className="text-[8px]">{o.officerRole?.replace(/-/g, " ")}</Badge>
                      <span className="font-medium">{o.name}</span>
                      {o.appointedOn && <span className="text-muted-foreground">since {o.appointedOn}</span>}
                      {o.nationality && <span className="text-muted-foreground">({o.nationality})</span>}
                    </div>
                  ))}
                </div>
              )}
              {activePscs.length > 0 && (
                <div>
                  <p className="font-semibold mb-1">Persons with Significant Control</p>
                  {activePscs.map((p: any, i: number) => (
                    <div key={i} className="mb-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium">{p.name}</span>
                        {p.nationality && <span className="text-muted-foreground">({p.nationality})</span>}
                      </div>
                      {p.naturesOfControl?.length > 0 && (
                        <div className="flex gap-1 flex-wrap mt-0.5">
                          {p.naturesOfControl.map((n: string, j: number) => (
                            <Badge key={j} variant="outline" className="text-[7px]">{n.replace(/-/g, " ").replace(/ownership-of-shares-/g, "shares ")}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {filings.length > 0 && (
                <div>
                  <p className="font-semibold mb-1">Recent Filings</p>
                  {filings.slice(0, 8).map((f: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-muted-foreground w-20 shrink-0">{f.date}</span>
                      <Badge variant="outline" className="text-[7px]">{f.category}</Badge>
                      <span className="truncate">{f.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {chData?.checkedAt && (
            <p className="text-[10px] text-muted-foreground">Checked: {new Date(chData.checkedAt).toLocaleString("en-GB")}</p>
          )}
        </>
      )}

      {!hasKyc && (
        <p className="text-[11px] text-muted-foreground">Not yet checked against Companies House</p>
      )}
    </div>
  );
}

function getRequiredKycParties(deal: CrmDeal, companies: CrmCompany[]): { company: CrmCompany; role: string; required: boolean }[] {
  const parties: { company: CrmCompany; role: string; required: boolean }[] = [];
  const seen = new Set<string>();

  const add = (id: string | null | undefined, role: string, required: boolean) => {
    if (!id || seen.has(id)) return;
    const co = companies.find(c => c.id === id);
    if (!co) return;
    seen.add(id);
    parties.push({ company: co, role, required });
  };

  // Billing identity is now the Xero contact, not a CRM company — so we
  // don't surface it as a "party" needing KYC. KYC still runs against the
  // counterparty companies below.
  const dt = deal.dealType?.toLowerCase() || "";

  if (dt.includes("disposal") || dt.includes("letting")) {
    add(deal.landlordId, "Client (Landlord)", true);
    add(deal.tenantId, "Counterparty (Tenant)", true);
  } else if (dt.includes("acquisition")) {
    add(deal.tenantId, "Client (Tenant)", true);
    add(deal.landlordId, "Counterparty (Landlord)", true);
  } else if (dt === "sale") {
    add(deal.vendorId, "Client (Vendor)", true);
    add(deal.purchaserId, "Counterparty (Purchaser)", true);
  } else if (dt === "purchase") {
    add(deal.purchaserId, "Client (Purchaser)", true);
    add(deal.vendorId, "Counterparty (Vendor)", true);
  } else if (dt.includes("renewal") || dt.includes("review") || dt.includes("regear")) {
    add(deal.landlordId, "Landlord", true);
    add(deal.tenantId, "Tenant", true);
  } else {
    add(deal.landlordId, "Landlord", true);
    add(deal.tenantId, "Tenant", true);
    add(deal.vendorId, "Vendor", true);
    add(deal.purchaserId, "Purchaser", true);
  }

  return parties;
}

export function DealKYCPanel({ deal, companies }: { deal: CrmDeal; companies: CrmCompany[] }) {
  const { toast } = useToast();
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const [approvingKyc, setApprovingKyc] = useState(false);

  const parties = useMemo(() => getRequiredKycParties(deal, companies), [deal, companies]);

  // Canonical KYC vocab (migration 0028 + the MLRO approve/reject endpoints):
  // approved | in_review | rejected | pending. This is the HMRC-facing MLRO
  // *decision*, not the raw auto-screen result.
  const totalRequired = parties.filter(p => p.required).length;
  const totalApproved = parties.filter(p => p.required && p.company.kycStatus === "approved").length;
  const totalInReview = parties.filter(p => p.required && p.company.kycStatus === "in_review").length;
  const totalRejected = parties.filter(p => p.required && p.company.kycStatus === "rejected").length;
  const totalUnchecked = totalRequired - totalApproved - totalInReview - totalRejected;

  // "Complete" = every required counterparty has a documented MLRO approval —
  // the decision that clears the deal for invoicing (and protects against HMRC fines).
  const allComplete = totalRequired > 0 && totalApproved === totalRequired;

  const runKyc = async (companyId: string) => {
    setLoadingIds(prev => new Set(prev).add(companyId));
    const entity = companies.find(c => c.id === companyId);
    try {
      const res = await fetch(`/api/companies-house/auto-kyc/${companyId}`, { method: "POST", credentials: "include", headers: getAuthHeaders() });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      if (data.success) {
        toast({
          title: data.kycStatus === "approved" ? "KYC Passed" : data.kycStatus === "in_review" ? "KYC Needs Review" : "KYC Failed",
          description: `${data.profile?.companyName || entity?.name} — ${data.kycStatus === "approved" ? "Active, no adverse flags" : "Review needed"}`,
          variant: data.kycStatus === "rejected" ? "destructive" : "default",
        });
      } else {
        toast({ title: "KYC Failed", description: data.message || data.error || "Could not complete", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "KYC check failed", variant: "destructive" });
    } finally {
      setLoadingIds(prev => { const n = new Set(prev); n.delete(companyId); return n; });
    }
  };

  const runAllKyc = async () => {
    setRunningAll(true);
    const unchecked = parties.filter(p => !p.company.kycStatus);
    toast({ title: "Running KYC on all parties", description: `Checking ${unchecked.length || parties.length} ${unchecked.length === 1 ? "company" : "companies"}...` });
    const toCheck = unchecked.length > 0 ? unchecked : parties;
    for (const p of toCheck) {
      await runKyc(p.company.id);
    }
    setRunningAll(false);
  };

  const approveKyc = async () => {
    setApprovingKyc(true);
    try {
      await apiRequest("PUT", `/api/crm/deals/${deal.id}`, { kycApproved: true });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", deal.id] });
      invalidateDealCaches();
      toast({ title: "KYC Approved", description: "This deal is now cleared for invoicing." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setApprovingKyc(false);
    }
  };

  if (parties.length === 0) return null;

  return (
    <Card data-testid="deal-kyc-panel">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            <h3 className="text-xs font-semibold">AML / KYC Compliance</h3>
            {deal.kycApproved ? (
              <Badge className="text-[9px] bg-green-600 text-white">KYC Approved</Badge>
            ) : allComplete ? (
              <Badge className="text-[9px] bg-amber-500 text-white">Ready to approve</Badge>
            ) : totalRejected > 0 ? (
              <Badge className="text-[9px] bg-red-500 text-white">{totalRejected} rejected</Badge>
            ) : totalInReview > 0 ? (
              <Badge className="text-[9px] bg-amber-500 text-white">{totalInReview} in review</Badge>
            ) : totalUnchecked > 0 ? (
              <Badge variant="outline" className="text-[9px] text-muted-foreground">{totalUnchecked} to check</Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {!deal.kycApproved && allComplete && (
              <Button size="sm" onClick={approveKyc} disabled={approvingKyc} className="bg-green-600 hover:bg-green-700 text-white h-7 text-[11px]" data-testid="button-approve-kyc">
                {approvingKyc ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                Approve KYC
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={runAllKyc} disabled={runningAll} className="h-7 text-[11px]" data-testid="button-run-all-kyc">
              {runningAll ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              {runningAll ? "Checking..." : totalUnchecked > 0 ? "Run All KYC" : "Refresh"}
            </Button>
          </div>
        </div>

        {deal.kycApproved && deal.kycApprovedBy && (
          <div className="text-[11px] text-muted-foreground mb-2">
            Approved by <span className="font-medium text-foreground">{deal.kycApprovedBy}</span>
            {deal.kycApprovedAt && <> on {new Date(deal.kycApprovedAt).toLocaleDateString("en-GB")}</>}
          </div>
        )}

        <div className="space-y-1">
          {parties.map(({ company, role }) => {
            const kycStatus = company.kycStatus;
            return (
              <div key={company.id} className="flex items-center justify-between py-1.5 px-2 rounded border bg-muted/20" data-testid={`kyc-party-${company.id}`}>
                <div className="flex items-center gap-2 min-w-0">
                  {kycStatus === "approved" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /> :
                   kycStatus === "in_review" ? <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" /> :
                   kycStatus === "rejected" ? <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" /> :
                   <div className="w-3.5 h-3.5 rounded-full border-2 border-dashed border-muted-foreground/40 shrink-0" />}
                  <div className="min-w-0">
                    <Link href={`/companies/${company.id}`}>
                      <span className="text-xs font-medium hover:underline cursor-pointer truncate block">{company.name}</span>
                    </Link>
                    <span className="text-[10px] text-muted-foreground capitalize">{role}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {kycStatus && kycStatus !== "pending" && (
                    <Badge className={`text-[8px] h-4 text-white ${kycStatus === "approved" ? "bg-green-600" : kycStatus === "in_review" ? "bg-amber-500" : kycStatus === "rejected" ? "bg-red-500" : "bg-zinc-400"}`}>
                      {kycStatus === "approved" ? "Approved" : kycStatus === "in_review" ? "In review" : kycStatus === "rejected" ? "Rejected" : kycStatus}
                    </Badge>
                  )}
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => runKyc(company.id)} disabled={loadingIds.has(company.id)} data-testid={`button-run-kyc-${company.id}`}>
                    {loadingIds.has(company.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-2 pt-2 border-t flex items-center justify-between">
          <Link href="/compliance-board">
            <span className="text-[11px] text-primary hover:underline cursor-pointer flex items-center gap-1" data-testid="link-compliance-board">
              <ShieldCheck className="w-3 h-3" /> View full KYC packs on Compliance Board
            </span>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function DealTimeline({ dealId }: { dealId: string }) {
  const { data: timeline, isLoading } = useQuery<any[]>({
    queryKey: ["/api/deals", dealId, "timeline"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/timeline`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const iconMap: Record<string, React.ElementType> = {
    plus: Plus,
    "file-text": FileText,
    "shield-check": ShieldCheck,
    "check-circle": CheckCircle2,
    link: Link2,
    "bar-chart": BarChart3,
    receipt: Receipt,
    "message-circle": MessageCircle,
  };

  const colorMap: Record<string, string> = {
    deal_created: "text-green-500",
    hots_completed: "text-blue-500",
    kyc_approved: "text-emerald-500",
    completion: "text-green-600",
    requirement_linked: "text-purple-500",
    comp_created: "text-orange-500",
    invoice: "text-amber-500",
    interaction: "text-cyan-500",
  };

  if (isLoading) {
    return (
      <Card data-testid="deal-timeline">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4" />
            <h3 className="text-sm font-semibold">Deal Timeline</h3>
          </div>
          <div className="space-y-3">
            {[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!timeline?.length) return null;

  return (
    <Card data-testid="deal-timeline">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4" />
          <h3 className="text-sm font-semibold">Deal Timeline</h3>
          <Badge variant="secondary" className="text-[10px]">{timeline.length}</Badge>
        </div>
        <div className="relative">
          <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
          <div className="space-y-3">
            {timeline.map((event: any, idx: number) => {
              const Icon = iconMap[event.icon] || Clock;
              const color = colorMap[event.type] || "text-muted-foreground";
              return (
                <div key={idx} className="flex items-start gap-3 relative" data-testid={`timeline-event-${idx}`}>
                  <div className="w-6 h-6 rounded-full bg-background border flex items-center justify-center shrink-0 z-10">
                    <Icon className={`w-3 h-3 ${color}`} />
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <p className="text-xs font-medium">{event.detail}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {event.date && !isNaN(new Date(event.date).getTime()) ? new Date(event.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DealAuditLog({ dealId }: { dealId: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data: logs, isLoading } = useQuery<any[]>({
    queryKey: ["/api/crm/deals", dealId, "audit-log"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/deals/${dealId}/audit-log`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <Card data-testid="deal-audit-log">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4" />
            <h3 className="text-sm font-semibold">Change Log</h3>
          </div>
          <div className="space-y-3">
            {[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!logs?.length) return null;

  const displayLogs = expanded ? logs : logs.slice(0, 8);

  const formatFieldName = (field: string) => {
    const map: Record<string, string> = {
      status: "status", fee: "fee", internalAgent: "BGP contacts",
      team: "team", dealType: "deal type", name: "name", pricing: "pricing",
      yieldPercent: "yield", feeAgreement: "fee agreement", rentPa: "rent PA",
      capitalContribution: "capital contribution", rentFree: "rent free",
      leaseLength: "lease length", breakOption: "break option",
      instructedAt: "instructed", targetDate: "target date", exchangedAt: "exchanged", completedAt: "completed", invoicedAt: "invoiced",
      tenureText: "tenure", assetClass: "asset class",
      comments: "comments", amlCheckCompleted: "AML check", totalAreaSqft: "total area",
      propertyId: "property", landlordId: "landlord", tenantId: "tenant",
      vendorId: "vendor", purchaserId: "purchaser",
      xeroContactId: "Xero contact", xeroContactName: "Xero contact name",
      xeroAccountNumber: "Xero account number", xeroBillingAddress: "Xero billing address",
      kycApproved: "KYC approved", feePercentage: "fee %",
      invoicingNotes: "invoicing notes",
      poNumber: "PO number",
    };
    return map[field] || field;
  };

  const formatValue = (field: string, val: string | null) => {
    if (val == null || val === "null") return "empty";
    if (field === "fee" || field === "pricing" || field === "rentPa" || field === "capitalContribution") {
      const num = parseFloat(val);
      if (!isNaN(num)) return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(num);
    }
    if (field === "kycApproved") return val === "true" ? "Yes" : "No";
    return val;
  };

  return (
    <Card data-testid="deal-audit-log">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4" />
          <h3 className="text-sm font-semibold">Change Log</h3>
          <Badge variant="secondary" className="text-[10px]">{logs.length}</Badge>
        </div>
        <div className="relative">
          <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
          <div className="space-y-3">
            {displayLogs.map((log: any, idx: number) => {
              const initials = (log.changedByName || "?")
                .split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);
              const ts = log.createdAt ? new Date(log.createdAt) : null;
              const timeStr = ts ? ts.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + " " + ts.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
              return (
                <div key={log.id || idx} className="flex items-start gap-3 relative" data-testid={`audit-log-${idx}`}>
                  <div className="w-6 h-6 rounded-full bg-muted border flex items-center justify-center shrink-0 z-10" title={log.changedByName || ""}>
                    <span className="text-[8px] font-bold text-muted-foreground">{initials}</span>
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <p className="text-xs">
                      <span className="font-medium">{log.changedByName || "Unknown"}</span>
                      {" changed "}
                      <span className="font-medium">{formatFieldName(log.field)}</span>
                      {log.oldValue && log.oldValue !== "null" ? (
                        <>{" from "}<span className="text-muted-foreground line-through">{formatValue(log.field, log.oldValue)}</span></>
                      ) : null}
                      {" to "}
                      <span className="font-semibold">{formatValue(log.field, log.newValue)}</span>
                    </p>
                    {log.reason && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 italic">
                        Reason: {log.reason}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">{timeStr}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {logs.length > 8 && (
          <Button variant="ghost" size="sm" className="w-full mt-3 text-xs" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : `Show all ${logs.length} changes`}
            {expanded ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function DealRelatedEmails({ dealId }: { dealId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<{ connected: boolean; emails: any[]; message?: string }>({
    queryKey: ["/api/crm/deals", dealId, "related-emails"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/deals/${dealId}/related-emails`, { headers: getAuthHeaders() });
      if (!res.ok) return { connected: false, emails: [] };
      return res.json();
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Card>
      <CardContent className="p-4">
        <button
          className="flex items-center gap-2 w-full text-left"
          onClick={() => setOpen(!open)}
          data-testid="toggle-related-emails"
        >
          <Mail className="w-4 h-4" />
          <h3 className="text-sm font-semibold flex-1">Emails</h3>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {open && (
          <div className="mt-3 space-y-2">
            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Searching emails...
              </div>
            ) : !data?.connected ? (
              <p className="text-xs text-muted-foreground py-2">Microsoft 365 not connected. Connect in Settings to see related emails.</p>
            ) : data.emails.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No related emails found.</p>
            ) : (
              data.emails.map((email: any) => (
                <Link key={email.id} href="/mail">
                  <div className="p-2 rounded-md border hover:bg-muted/50 cursor-pointer transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate flex-1">{email.subject}</p>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {new Date(email.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{email.from}</p>
                  </div>
                </Link>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DealRelatedMeetings({ dealId }: { dealId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<{ connected: boolean; events: any[]; message?: string }>({
    queryKey: ["/api/crm/deals", dealId, "related-events"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/deals/${dealId}/related-events`, { headers: getAuthHeaders() });
      if (!res.ok) return { connected: false, events: [] };
      return res.json();
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const formatEventTime = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const dateStr = s.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    const startTime = s.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const endTime = e.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `${dateStr}, ${startTime} - ${endTime}`;
  };

  return (
    <Card>
      <CardContent className="p-4">
        <button
          className="flex items-center gap-2 w-full text-left"
          onClick={() => setOpen(!open)}
          data-testid="toggle-related-meetings"
        >
          <CalendarDays className="w-4 h-4" />
          <h3 className="text-sm font-semibold flex-1">Meetings</h3>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {open && (
          <div className="mt-3 space-y-2">
            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Searching calendar...
              </div>
            ) : !data?.connected ? (
              <p className="text-xs text-muted-foreground py-2">Microsoft 365 not connected. Connect in Settings to see upcoming meetings.</p>
            ) : data.events.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No upcoming meetings found.</p>
            ) : (
              data.events.map((evt: any) => (
                <Link key={evt.id} href="/calendar">
                  <div className="p-2 rounded-md border hover:bg-muted/50 cursor-pointer transition-colors">
                    <p className="text-sm font-medium truncate">{evt.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatEventTime(evt.start, evt.end)}
                    </p>
                    {evt.location && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{evt.location}</p>
                    )}
                  </div>
                </Link>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// DealDetail extracted to @/components/deal-detail.tsx


interface AiMatchSuggestion {
  dealId: string;
  dealName: string;
  matches: {
    entityType: "contact" | "company";
    entityId: string;
    entityName: string;
    role: string;
    confidence: "high" | "medium" | "low";
    reason: string;
  }[];
}

function AiMatchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [suggestions, setSuggestions] = useState<AiMatchSuggestion[]>([]);
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<{ totalUnlinked: number; totalContacts: number; totalCompanies: number } | null>(null);

  const suggestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/crm/ai-match/suggest");
      return res.json();
    },
    onSuccess: (data) => {
      setSuggestions(data.suggestions || []);
      setStats({ totalUnlinked: data.totalUnlinked, totalContacts: data.totalContacts, totalCompanies: data.totalCompanies });
      const allKeys = new Set<string>();
      for (const s of (data.suggestions || [])) {
        for (const m of s.matches || []) {
          if (m.confidence === "high") {
            allKeys.add(`${s.dealId}:${m.entityId}:${m.role}`);
          }
        }
      }
      setSelectedMatches(allKeys);
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (matches: any[]) => {
      const res = await apiRequest("POST", "/api/crm/ai-match/apply", { matches });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Matches applied", description: `${data.applied} links created successfully` });
      invalidateDealCaches();
      onOpenChange(false);
      setSuggestions([]);
      setSelectedMatches(new Set());
    },
  });

  const toggleMatch = (key: string) => {
    setSelectedMatches(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleApply = () => {
    const matches: any[] = [];
    for (const s of suggestions) {
      for (const m of s.matches) {
        const key = `${s.dealId}:${m.entityId}:${m.role}`;
        if (selectedMatches.has(key)) {
          matches.push({ dealId: s.dealId, entityType: m.entityType, entityId: m.entityId, role: m.role });
        }
      }
    }
    if (matches.length === 0) {
      toast({ title: "No matches selected", variant: "destructive" });
      return;
    }
    applyMutation.mutate(matches);
  };

  const confidenceColor = (c: string) => c === "high" ? "text-green-600" : c === "medium" ? "text-amber-600" : "text-red-500";

  const totalMatches = suggestions.reduce((sum, s) => sum + (s.matches?.length || 0), 0);
  const selectedCount = selectedMatches.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto" data-testid="ai-match-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            AI Deal Matching
          </DialogTitle>
          <DialogDescription>
            Use AI to intelligently match deals to contacts and companies based on names and context.
          </DialogDescription>
        </DialogHeader>

        {suggestions.length === 0 ? (
          <div className="py-8 text-center space-y-4">
            <Sparkles className="w-12 h-12 mx-auto text-muted-foreground opacity-40" />
            <div>
              <p className="text-sm font-medium">AI-Powered Deal Matching</p>
              <p className="text-xs text-muted-foreground mt-1">
                Analyses all unlinked deals against your contacts and companies to find connections.
              </p>
            </div>
            <Button
              onClick={() => suggestMutation.mutate()}
              disabled={suggestMutation.isPending}
              data-testid="button-run-ai-match"
            >
              {suggestMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analysing deals...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Run AI Matching
                </>
              )}
            </Button>
            {suggestMutation.isPending && (
              <p className="text-[10px] text-muted-foreground">This may take a minute for large datasets</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {stats && (
              <div className="flex items-center gap-4 text-xs text-muted-foreground border-b pb-3">
                <span>{stats.totalUnlinked} unlinked deals</span>
                <span>{stats.totalContacts} contacts</span>
                <span>{stats.totalCompanies} companies</span>
                <span className="ml-auto font-medium text-foreground">
                  {totalMatches} matches found · {selectedCount} selected
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 mb-2">
              <Button
                variant="outline" size="sm"
                onClick={() => {
                  const allKeys = new Set<string>();
                  for (const s of suggestions) for (const m of s.matches) allKeys.add(`${s.dealId}:${m.entityId}:${m.role}`);
                  setSelectedMatches(allKeys);
                }}
                data-testid="button-select-all-matches"
              >
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedMatches(new Set())} data-testid="button-deselect-all-matches">
                Deselect All
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => {
                  const highKeys = new Set<string>();
                  for (const s of suggestions) for (const m of s.matches) if (m.confidence === "high") highKeys.add(`${s.dealId}:${m.entityId}:${m.role}`);
                  setSelectedMatches(highKeys);
                }}
                data-testid="button-select-high-confidence"
              >
                High Confidence Only
              </Button>
            </div>

            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {suggestions.map(suggestion => (
                <div key={suggestion.dealId} className="border rounded-lg p-3">
                  <p className="text-sm font-medium mb-2">{suggestion.dealName}</p>
                  <div className="space-y-1.5">
                    {suggestion.matches.map(match => {
                      const key = `${suggestion.dealId}:${match.entityId}:${match.role}`;
                      const isSelected = selectedMatches.has(key);
                      return (
                        <div
                          key={key}
                          className={`flex items-center gap-2 p-2 rounded text-xs cursor-pointer transition-colors ${
                            isSelected ? "bg-primary/5 border border-primary/20" : "bg-muted/30 hover:bg-muted/60"
                          }`}
                          onClick={() => toggleMatch(key)}
                          data-testid={`match-${suggestion.dealId}-${match.entityId}`}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                            {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            {match.entityType === "contact" ? "Contact" : "Company"}
                          </Badge>
                          <span className="font-medium">{match.entityName}</span>
                          <Badge variant="secondary" className="text-[10px]">{match.role}</Badge>
                          <span className={`font-medium ${confidenceColor(match.confidence)}`}>
                            {match.confidence}
                          </span>
                          <span className="text-muted-foreground truncate max-w-[200px] ml-auto">{match.reason}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setSuggestions([]); setSelectedMatches(new Set()); }} data-testid="button-reset-matches">
                Reset
              </Button>
              <Button
                onClick={handleApply}
                disabled={applyMutation.isPending || selectedCount === 0}
                data-testid="button-apply-matches"
              >
                {applyMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Applying...</>
                ) : (
                  <>Apply {selectedCount} Match{selectedCount !== 1 ? "es" : ""}</>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Canonical codes only — `crm_deals.status` is the source of truth post-migration.
// All comparison sites must route through legacyToCode() so legacy free-text rows
// still in the DB (e.g. "Under Negotiation", "Billed") match correctly.
const NEGOTIATION_STATUS_CODES: DealStatusCode[] = ["NEG"];
const COMPLETED_STATUS_CODES: DealStatusCode[] = ["EXC", "COM", "INV"];
const INTERNAL_BGP_TEAMS = new Set<string>(CRM_OPTIONS.dealTeam.filter((t: string) => t !== "Landsec"));

export default function Deals({ mode = "wip" }: { mode?: "wip" | "comps" | "negotiations" } = {}) {
  const isCompsMode = mode === "comps";
  const isNegotiationsMode = mode === "negotiations";
  const [, dealsParams] = useRoute("/deals/:id");
  const [, compsParams] = useRoute("/comps/:id");
  const params = isNegotiationsMode ? null : isCompsMode ? compsParams : dealsParams;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { activeTeam } = useTeam();
  // Saved Views / per-user localStorage key — without scoping by user id,
  // two users sharing a browser see each other's saved views.
  const { data: currentUserForViews } = useQuery<{ id?: string | number; email?: string; name?: string }>({ queryKey: ["/api/auth/me"] });
  // Lower-cased current-user name, matched against a deal's internalAgent so a
  // user's own deals — where they're the BGP contact or a fee-split agent
  // (the fee-split save syncs split agents into internalAgent) — always show
  // regardless of the team filter.
  const myName = (currentUserForViews?.name || "").trim().toLowerCase();
  const urlParams = new URLSearchParams(window.location.search);
  const urlTeamParam = urlParams.get("team");
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [aiMatchOpen, setAiMatchOpen] = useState(false);
  const [rentAnalysisRunning, setRentAnalysisRunning] = useState(false);
  const [deleteListDeal, setDeleteListDeal] = useState<{ id: string; name: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Click-to-sort on the deals schedule headers. Filtered columns
  // (Type, Status, Team, Asset Class) keep their existing
  // ColumnFilterPopover; everything else is wired below.
  const dealsSort = useTableSort(null, "asc");
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [hotsChecklistDeal, setHotsChecklistDeal] = useState<CrmDeal | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [teamFilterInitialised, setTeamFilterInitialised] = useState(false);
  const isMobile = useIsMobile();
  const [viewMode, setViewMode] = useState<"table" | "card" | "board">(
    // Mobile defaults to the stacked Card view (fits the phone). The kanban
    // Board view overflows horizontally on a phone, so it's opt-in there.
    typeof window !== "undefined" && window.innerWidth < 768 ? "card" : "table"
  );

  // Client logins (e.g. Landsec) are already scoped to their company by the
  // API, and their deals aren't tagged with a BGP team — so never apply the
  // activeTeam column filter for them (it would hide everything).
  const isClientDeals = (currentUserForViews as any)?.role === "Client";

  useEffect(() => {
    if (!teamFilterInitialised) {
      const teamToSet = isClientDeals ? null : (urlTeamParam || (activeTeam && activeTeam !== "all" ? activeTeam : null));
      if (teamToSet) {
        setColumnFilters(prev => ({ ...prev, team: [teamToSet] }));
      }
      setTeamFilterInitialised(true);
    }
  }, [activeTeam, teamFilterInitialised, urlTeamParam, isClientDeals]);

  useEffect(() => {
    if (isClientDeals) return;
    if (teamFilterInitialised && activeTeam && !urlTeamParam) {
      if (activeTeam === "all") {
        setColumnFilters(prev => { const { team, ...rest } = prev; return rest; });
      } else {
        setColumnFilters(prev => ({ ...prev, team: [activeTeam] }));
      }
    }
  }, [activeTeam, isClientDeals]);
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    unit: false,
    // 'landlord' (renders as 'Client') is folded into clientXero by default
    landlord: false,
    status: true,
    type: true,
    // The combined Team / BGP column was dropped — the agent is now read
    // off the Fee Split column (deal_fee_allocations is the source of
    // truth). Granular Team / Agent columns stay available from the
    // column-visibility menu if you need them in-table.
    team: false,
    agent: false,
    // Asset Class is property-level — the parent Property tab carries it.
    // Off here to keep the row tight; toggle on for investment views.
    assetClass: false,
    // Parties duplicated Client/Billing (landlord) + Tenant — off by default.
    // Toggle on when working an investment deal that needs vendor / purchaser
    // / acquisition / leasing agents visible at a glance.
    parties: false,
    clientContact: false,
    tenant: true,
    vendor: false,
    purchaser: false,
    vendorAgent: false,
    acquisitionAgent: false,
    purchaserAgent: false,
    leasingAgent: false,
    yield: false,
    feeCombined: true,
    fee: false,
    feeAgreement: false,
    // Fee Split is a popover-on-click on the Fee cell — separate column was
    // duplicative. Off by default; toggle on for agent commission reviews.
    feeAlloc: true,
    // Floor Areas is per-unit physical detail — useful but heavy. Off by
    // default; the deal-detail page carries the full areas card.
    floorAreas: false,
    // Client (landlord) + Xero billing contact now live behind one
    // 'Client / Billing' cell. Toggle the granular columns back on
    // from the column-visibility menu if you ever need them.
    clientXero: true,
    xeroContact: false,
    // Pricing column rolls up Pricing / Price PSF / Price ITZA — same
    // stack-and-popover pattern as Lease Terms.
    pricingCombined: true,
    pricing: false,
    pricePsf: false,
    priceItza: false,
    // Dates cell stacks Date Added (read-only) over the editable
    // Target Date. The legacy single-column Date Added stays toggleable.
    datesCombined: true,
    dateAdded: false,
    targetDate: false,
    // Five lease-term columns now consolidated behind the Lease Terms
    // column. Toggle them back on from the column-visibility menu for
    // the per-column sortable view.
    leaseTerms: true,
    rentPa: false,
    capitalContribution: false,
    rentFree: false,
    leaseLength: false,
    breakOption: false,
    instructedAt: false,
    exchangedAt: false,
    completedAt: false,
    invoicedAt: false,
    rentAnalysis: false,
    // SharePoint files belong on the deal detail page; the column on the
    // list view was just an icon-and-link that didn't add scannable value.
    sharepoint: false,
    lastInteraction: true,
  });

  // Always hide pre-SOL tracker-backed deals from the Deals CRM. They
  // live on the Letting Tracker until they get promoted to SOL+, at
  // which point the server-side filter lets them through naturally
  // (storage checks the available_units.marketing_status before
  // suppressing). Cleans up the AVA clutter that used to appear at the
  // top of the table.
  const dealsUrl = "/api/crm/deals?excludeTrackerDeals=true";
  const { data: deals = [], isLoading, error } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals", { excludeTracker: true }],
    queryFn: async () => {
      const r = await fetch(dealsUrl, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      return r.json();
    },
  });

  const { data: availableUnitsData = [] } = useQuery<AvailableUnit[]>({
    queryKey: ["/api/available-units"],
    enabled: isNegotiationsMode,
  });

  const migratedDealIds = useMemo(() => {
    return new Set(availableUnitsData.filter(u => u.dealId).map(u => u.dealId));
  }, [availableUnitsData]);

  const { data: properties = [] } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties", { excludeComps: true }],
    queryFn: async () => {
      const res = await fetch("/api/crm/properties?excludeComps=true");
      if (!res.ok) throw new Error("Failed to load properties");
      const data = await res.json();
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
  });

  const { data: companies = [] } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies", { includeBillingEntities: true }],
    queryFn: async () => {
      const res = await fetch("/api/crm/companies?includeBillingEntities=true");
      if (!res.ok) throw new Error("Failed to load companies");
      return res.json();
    },
  });

  const { data: contacts = [] } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
  });

  const { data: propertyUnits = [] } = useQuery<PropertyUnit[]>({
    queryKey: ["/api/property-units"],
  });

  const { data: users = [] } = useQuery<{ id: number; name: string; email: string }[]>({
    queryKey: ["/api/users"],
  });
  const userColorMap2 = useMemo(() => buildUserColorMap(users as any), [users]);
  // AML lookup for the badge — built from the same companies list so we don't
  // re-fetch. Hoisted above the early returns below so the hook order stays
  // stable (was previously declared after `if (params?.id) return …`, a
  // Rules-of-Hooks violation that could crash on navigation into a deal).
  const amlCompanyMap = useMemo(() => buildAmlCompanyMap(companies), [companies]);
  const agentCompanies = useMemo(() => companies.filter(c => c.companyType === "Agent"), [companies]);

  const { data: allFeeAllocations = {} } = useQuery<Record<string, DealFeeAllocation[]>>({
    queryKey: ["/api/crm/fee-allocations"],
  });


  const [listApprovalGateOpen, setListApprovalGateOpen] = useState(false);
  const [listApprovalGateMsg, setListApprovalGateMsg] = useState("");
  const [feeAllocEditDeal, setFeeAllocEditDeal] = useState<CrmDeal | null>(null);
  const inlineUpdateMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: unknown }) => {
      const res = await apiRequest("PUT", `/api/crm/deals/${id}`, { [field]: value });
      return res.json();
    },
    onSuccess: (data: any) => {
      invalidateDealCaches();
      if (data?.mirrorWarning) {
        toast({ title: "Cross-board sync warning", description: data.mirrorWarning, variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      // Roll back the kanban card's optimistic move: invalidate so the
      // server-source-of-truth re-paints and the dragged card snaps back
      // to its old column. Otherwise the card looks like it landed in
      // the new status while the server actually rejected the write.
      invalidateDealCaches();
      const parsed = parseGateError(err.message);
      if (parsed.kind === "aml") {
        setListApprovalGateMsg(parsed.message);
        setListApprovalGateOpen(true);
      } else if (parsed.kind === "senior") {
        setListApprovalGateMsg(parsed.message);
        setListApprovalGateOpen(true);
      } else {
        toast({ title: "Error saving", description: err.message, variant: "destructive" });
      }
    },
  });

  const deleteListMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/crm/deals/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Deal deleted" });
      invalidateDealCaches();
      setDeleteListDeal(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ ids, field, value }: { ids: string[]; field: string; value: unknown }) => {
      const res = await apiRequest("POST", "/api/crm/deals/bulk-update", { ids, field, value });
      return res.json();
    },
    onSuccess: (json: any) => {
      invalidateDealCaches();
      setSelectedIds(new Set());
      // Server now runs the same AML / senior-approval gates as the
      // single-row PUT. Some rows can be skipped while others apply —
      // surface that so the user isn't silently misled.
      const skipped = Array.isArray(json?.failures) ? json.failures : [];
      if (skipped.length > 0) {
        toast({
          title: `${json.updated} updated, ${skipped.length} skipped`,
          description: skipped.slice(0, 3).map((f: any) => f.reason).join(" • ") + (skipped.length > 3 ? ` (+${skipped.length - 3} more)` : ""),
          variant: "destructive",
        });
      } else {
        toast({ title: "Deals updated" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      await apiRequest("POST", "/api/crm/deals/bulk-delete", { ids });
    },
    onSuccess: () => {
      invalidateDealCaches();
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      toast({ title: "Deals deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeGroup, search, columnFilters]);

  const handleInlineSave = useCallback((dealId: string, field: string, value: unknown) => {
    if (field === "status" && value === "HOTs") {
      const deal = deals.find(d => d.id === dealId);
      if (deal) {
        setHotsChecklistDeal(deal);
        return;
      }
    }
    if (field === "basementAreaSqft" || field === "gfAreaSqft" || field === "ffAreaSqft") {
      const deal = deals.find(d => d.id === dealId);
      if (deal) {
        const basement = field === "basementAreaSqft" ? (value as number | null) : deal.basementAreaSqft;
        const gf = field === "gfAreaSqft" ? (value as number | null) : deal.gfAreaSqft;
        const ff = field === "ffAreaSqft" ? (value as number | null) : deal.ffAreaSqft;
        const total = (basement || 0) + (gf || 0) + (ff || 0);
        inlineUpdateMutation.mutate({ id: dealId, field, value });
        inlineUpdateMutation.mutate({ id: dealId, field: "totalAreaSqft", value: total > 0 ? total : null });
        return;
      }
    }
    if (field === "dealType" && typeof value === "string") {
      const types = value.split(",").map(t => t.trim());
      const investmentTypes = ["Purchase", "Sale", "Investment Sale", "Investment Acquisition"];
      const leaseAdvisoryTypes = ["Lease Disposal", "Lease Renewal", "Rent Review", "Regear"];
      const deal = deals.find(d => d.id === dealId);
      const currentTeams: string[] = Array.isArray(deal?.team) ? deal.team : deal?.team ? [deal.team] : [];
      let autoTeam: string | null = null;
      if (types.some(t => investmentTypes.includes(t))) autoTeam = "Investment";
      else if (types.some(t => t === "Lease Acquisition")) autoTeam = "Tenant Rep";
      else if (types.some(t => leaseAdvisoryTypes.includes(t))) autoTeam = "Lease Advisory";
      if (autoTeam) {
        const newTeams = currentTeams.includes(autoTeam) ? currentTeams : [...currentTeams, autoTeam];
        inlineUpdateMutation.mutate({ id: dealId, field, value });
        inlineUpdateMutation.mutate({ id: dealId, field: "team", value: newTeams });
        return;
      }
    }
    inlineUpdateMutation.mutate({ id: dealId, field, value });

    // Counterparty/client party change → fire full AML sweep on both sides of the deal.
    if ((field === "tenantId" || field === "landlordId" || field === "vendorId" || field === "purchaserId") && value) {
      const entity = companies.find((c: any) => c.id === String(value));
      toast({ title: "Running AML checks", description: `Screening ${entity?.name || "party"}...` });
      fetch(`/api/kyc/run-all-checks`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ dealId, bothSides: true }),
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      }).catch(() => {});
    }
  }, [deals, companies, toast]);

  // Inline "search and set up" for party cells — when the typed name matches
  // no existing CRM record, create it (with the right company type) and link
  // it to the deal in one step, mirroring the deal-detail panel.
  const createCompanyForDeal = async (dealId: string, field: string, companyType: string, name: string) => {
    try {
      const r = await apiRequest("POST", "/api/crm/companies", {
        name: name.trim(),
        companyType,
        isTrackedBrand: companyType.startsWith("Tenant"),
      });
      const created = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      handleInlineSave(dealId, field, String(created.id));
      toast({ title: `${companyType} created`, description: `${created.name || name} added.` });
    } catch (e: any) {
      toast({ title: "Create failed", description: e?.message || "Try again", variant: "destructive" });
    }
  };

  const createContactForDeal = async (dealId: string, field: string, name: string) => {
    try {
      const r = await apiRequest("POST", "/api/crm/contacts", { name: name.trim() });
      const created = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      handleInlineSave(dealId, field, String(created.id));
      toast({ title: "Contact created", description: `${created.name || name} added.` });
    } catch (e: any) {
      toast({ title: "Create failed", description: e?.message || "Try again", variant: "destructive" });
    }
  };

  const createPropertyForDeal = async (dealId: string, name: string) => {
    try {
      const r = await apiRequest("POST", "/api/crm/properties", { name: name.trim() });
      const created = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      handleInlineSave(dealId, "propertyId", String(created.id));
      toast({ title: "Property created", description: `${created.name || name} added to CRM.` });
    } catch (e: any) {
      toast({ title: "Create failed", description: e?.message || "Try again", variant: "destructive" });
    }
  };

  const toggleColumn = useCallback((key: string) => {
    setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleFilter = useCallback((column: string, value: string) => {
    setColumnFilters((prev) => {
      const current = prev[column] || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [column]: next };
    });
  }, []);

  const statusValues = useMemo(() => {
    // WIP page only ever offers post-instruction statuses (NEG → INV); the
    // pre-instruction codes (REP/SPEC/LIVE/AVA) live on the Letting/Investment
    // trackers and WIT is hidden from WIP.
    if (mode === "wip") return [...WIP_STATUSES];
    // Always return canonical codes — legacy free-text rows still in the DB
    // are normalised through legacyToCode so chips bucket correctly.
    const s = new Set<DealStatusCode>();
    deals.forEach((d) => {
      const code = legacyToCode(d.status);
      if (code) s.add(code);
    });
    return Array.from(s).sort();
  }, [deals, mode]);

  const typeValues = useMemo(() => {
    const s = new Set<string>();
    deals.forEach((d) => { if (d.dealType) s.add(d.dealType); });
    return Array.from(s).sort();
  }, [deals]);

  const teamValues = useMemo(() => {
    const s = new Set<string>();
    deals.forEach((d) => {
      const teams = Array.isArray(d.team) ? d.team : d.team ? [d.team] : [];
      teams.forEach(t => s.add(t));
    });
    return Array.from(s).sort();
  }, [deals]);

  const assetClassValues = useMemo(() => {
    const s = new Set<string>();
    deals.forEach((d) => { if (d.assetClass) s.add(d.assetClass); });
    return Array.from(s).sort();
  }, [deals]);

  const activeFilterCount = useMemo(() => {
    return Object.values(columnFilters).reduce((sum, arr) => sum + arr.length, 0);
  }, [columnFilters]);

  // --- Saved filter views (localStorage) ---
  // Scoped per user so two people sharing a browser don't pollute each
  // other's saved views. Falls back to the legacy unscoped key for
  // anonymous sessions / first paint before the user query resolves.
  const SAVED_VIEWS_KEY = currentUserForViews?.id
    ? `bgp_saved_deal_views:${currentUserForViews.id}`
    : currentUserForViews?.email
      ? `bgp_saved_deal_views:${currentUserForViews.email.toLowerCase()}`
      : "bgp_saved_deal_views";
  type SavedView = { name: string; filters: { search: string; activeGroup: string; columnFilters: Record<string, string[]> } };

  const getSavedViews = useCallback((): SavedView[] => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || "[]"); } catch { return []; }
  }, [SAVED_VIEWS_KEY]);

  const [savedViews, setSavedViews] = useState<SavedView[]>(getSavedViews);
  const [savedViewsOpen, setSavedViewsOpen] = useState(false);

  // Re-load when the storage key changes (e.g. user query resolves and
  // we switch from the unscoped fallback to the per-user key).
  useEffect(() => { setSavedViews(getSavedViews()); }, [getSavedViews]);

  const handleSaveView = useCallback(() => {
    const name = window.prompt("Name this saved view:");
    if (!name?.trim()) return;
    const view: SavedView = {
      name: name.trim(),
      filters: { search, activeGroup, columnFilters },
    };
    const views = [...getSavedViews(), view];
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
    setSavedViews(views);
    toast({ title: "View saved", description: `"${name.trim()}" has been saved.` });
  }, [search, activeGroup, columnFilters, getSavedViews, toast, SAVED_VIEWS_KEY]);

  const handleApplyView = useCallback((view: SavedView) => {
    setSearch(view.filters.search || "");
    setActiveGroup(view.filters.activeGroup || "all");
    setColumnFilters(view.filters.columnFilters || {});
    setSavedViewsOpen(false);
    toast({ title: "View applied", description: `Applied "${view.name}".` });
  }, [toast]);

  const handleDeleteView = useCallback((idx: number) => {
    const views = getSavedViews().filter((_, i) => i !== idx);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
    setSavedViews(views);
    toast({ title: "View deleted" });
  }, [getSavedViews, toast, SAVED_VIEWS_KEY]);
  // --- End saved filter views ---

  const baseDeals = useMemo(() => {
    if (isCompsMode) {
      return deals.filter(d => {
        const code = legacyToCode(d.status);
        return code !== null && COMPLETED_STATUS_CODES.includes(code);
      });
    }
    if (isNegotiationsMode) {
      return deals.filter(d => {
        const code = legacyToCode(d.status);
        return code !== null && NEGOTIATION_STATUS_CODES.includes(code) && !migratedDealIds.has(d.id);
      });
    }
    // WIP page: client-side guard so pre-instruction tracker deals (REP/SPEC/
    // LIVE/AVA) and WIT can never leak in, regardless of server filter state.
    return deals.filter(d => {
      const code = legacyToCode(d.status);
      return code !== null && WIP_STATUSES.includes(code);
    });
  }, [deals, isCompsMode, isNegotiationsMode, migratedDealIds]);

  const filteredDeals = useMemo(() => {
    return baseDeals.filter((deal) => {
      const dealCode = legacyToCode(deal.status);
      // Always compare canonical codes — statusValues only ever offers codes
      // (legacy free-text rows are normalised through legacyToCode), so the
      // old raw-string branch silently dropped legacy-status rows from the
      // comps/negotiations filters.
      const statusMatch = (target: string) => dealCode === target;
      if (activeGroup !== "all" && !statusMatch(activeGroup)) return false;
      if (columnFilters["status"]?.length) {
        const ok = columnFilters["status"].some(statusMatch);
        if (!ok) return false;
      }
      if (columnFilters["type"]?.length && (!deal.dealType || !columnFilters["type"].includes(deal.dealType))) return false;
      // A deal you're on always shows on your deals page, even if its team
      // doesn't match the team filter (or it has no team). "On it" = you're in
      // internalAgent — the BGP contact and, since the fee-split save syncs
      // them, the fee-split agents too. So your own deals are never hidden by
      // the team view (this is why Emily couldn't see Costain — no team set,
      // but she's the contact).
      const dealAgents: string[] = Array.isArray(deal.internalAgent)
        ? deal.internalAgent
        : deal.internalAgent ? [deal.internalAgent as string] : [];
      const isMyDeal = !!myName && dealAgents.some((a) => (a || "").trim().toLowerCase() === myName);
      if (columnFilters["team"]?.length && !isMyDeal) {
        const dealTeams: string[] = Array.isArray(deal.team) ? deal.team : deal.team ? [deal.team] : [];
        if (dealTeams.length === 0) return false;
        const matchesTeam = dealTeams.some(t => columnFilters["team"].some(filter => t === filter || t.startsWith(filter + " ") || (filter.startsWith(t) && filter.includes(" "))));
        if (!matchesTeam) {
          const matchesClientGroup = columnFilters["team"].some(filter =>
            !INTERNAL_BGP_TEAMS.has(filter) &&
            deal.groupName &&
            deal.groupName.toLowerCase().replace(/\s+/g, "") === filter.toLowerCase().replace(/\s+/g, "")
          );
          if (!matchesClientGroup) return false;
        }
      }
      if (columnFilters["assetClass"]?.length && (!deal.assetClass || !columnFilters["assetClass"].includes(deal.assetClass))) return false;
      if (search) {
        const s = search.toLowerCase();
        const propName = deal.propertyId ? (properties.find(p => p.id === deal.propertyId)?.name || "") : "";
        const unitName = deal.unitId ? (propertyUnits.find(u => u.id === deal.unitId)?.unitName || "") : "";
        // Counterparty name lookups — search "Burberry" should find the
        // tenant on a New Letting, the vendor on a Sale, etc. Falls back
        // to the empty string when the FK is unset.
        const counterpartyName = (id: string | null | undefined) =>
          id ? (companies.find(c => c.id === id)?.name || "").toLowerCase() : "";
        const tenantName    = counterpartyName(deal.tenantId);
        const landlordName  = counterpartyName(deal.landlordId);
        const vendorName    = counterpartyName((deal as any).vendorId);
        const purchaserName = counterpartyName((deal as any).purchaserId);
        const match =
          deal.name.toLowerCase().includes(s) ||
          propName.toLowerCase().includes(s) ||
          unitName.toLowerCase().includes(s) ||
          tenantName.includes(s) ||
          landlordName.includes(s) ||
          vendorName.includes(s) ||
          purchaserName.includes(s) ||
          (Array.isArray(deal.internalAgent) ? deal.internalAgent.some((a: string) => a.toLowerCase().includes(s)) : (deal.internalAgent as any)?.toLowerCase?.()?.includes(s)) ||
          deal.status?.toLowerCase().includes(s) ||
          (Array.isArray(deal.team) ? deal.team.some((t: string) => t.toLowerCase().includes(s)) : (deal.team as any)?.toLowerCase?.()?.includes(s)) ||
          deal.comments?.toLowerCase().includes(s) ||
          deal.dealType?.toLowerCase().includes(s) ||
          deal.assetClass?.toLowerCase().includes(s) ||
          deal.tenureText?.toLowerCase().includes(s);
        if (!match) return false;
      }
      return true;
    });
  }, [baseDeals, activeGroup, columnFilters, search, properties, companies, propertyUnits, myName]);

  const teamFilteredDeals = useMemo(() => {
    if (!columnFilters["team"]?.length) return baseDeals;
    return baseDeals.filter(deal => {
      const dealTeams: string[] = Array.isArray(deal.team) ? deal.team : deal.team ? [deal.team] : [];
      if (dealTeams.length === 0) return false;
      const matchesTeam = dealTeams.some(t => 
        columnFilters["team"].some(filter => 
          t === filter || t.startsWith(filter + " ") || (filter.startsWith(t) && filter.includes(" "))
        )
      );
      if (matchesTeam) return true;
      return columnFilters["team"].some(filter =>
        !INTERNAL_BGP_TEAMS.has(filter) &&
        deal.groupName &&
        deal.groupName.toLowerCase().replace(/\s+/g, "") === filter.toLowerCase().replace(/\s+/g, "")
      );
    });
  }, [baseDeals, columnFilters]);

  const statusCounts = useMemo(() => {
    return statusValues
      .filter(s => isCompsMode ? COMPLETED_STATUS_CODES.includes(s as DealStatusCode) : true)
      .map((s) => {
        const inStatus = teamFilteredDeals.filter((d) => legacyToCode(d.status) === s);
        // statusValues are canonical codes across all modes — match via
        // legacyToCode so older free-text rows still bucket into the right chip.
        return {
          name: s,
          count: inStatus.length,
          feeTotal: inStatus.reduce((sum, d) => sum + (Number((d as any).fee) || 0), 0),
        };
      })
      .filter(s => s.count > 0);
  }, [teamFilteredDeals, statusValues, isCompsMode, mode]);

  // If the last deal matching the active filter chip moves out of the
  // view, the chip itself is hidden (count==0 filter above). Without
  // this, activeGroup stays pointing at a now-invisible chip and the
  // board reads as empty with no way to clear the filter.
  useEffect(() => {
    if (activeGroup !== "all" && !statusCounts.some(s => s.name === activeGroup)) {
      setActiveGroup("all");
    }
  }, [statusCounts, activeGroup]);

  // '/deals/list' is the deals schedule tab (the bare '/deals' now lands on
  // the WIP Report). 'list' is a reserved hub segment, not a deal id, so
  // don't mistake it for a profile route.
  if (params?.id && params.id !== "list" && !isNegotiationsMode) {
    return <DealDetail id={params.id} isComps={isCompsMode} />;
  }

  const clearAllFilters = () => {
    setSearch("");
    setActiveGroup("all");
    // Clear everything, including the team filter — "Clear all" should mean all.
    // It used to re-apply the team filter here, so someone whose team switcher
    // was set to their own team could never drop it from the deals page and
    // thought their deals (on another team) had vanished.
    setColumnFilters({});
  };

  const hasFilters = search || activeGroup !== "all" || activeFilterCount > 0;

  if (error) {
    return (
      <PageLayout
        title={isCompsMode ? "Leasing Comps" : "Deals"}
        icon={Handshake}
        fullHeight
        subtitle={isCompsMode ? "Comparable transactions" : "Deal CRM"}
      >
        <Card>
          <CardContent className="py-12 text-center">
            <EmptyState
              icon={AlertCircle}
              title={`Could not load ${isCompsMode ? "Leasing Comps" : "Deals"}`}
              description={(error as Error).message || "An error occurred while loading deals."}
            />
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  const propertyMap = new Map(properties.map((p) => [p.id, p.name]));
  const companyMap = new Map(companies.map((c) => [c.id, c.name]));
  const unitMap = new Map(propertyUnits.map((u) => [u.id, u.unitName]));
  // Click-to-sort applied after the existing filter chain. Looks up
  // names through propertyMap / companyMap so sorts on Property,
  // Client, Tenant etc. compare against the human label rather than
  // the FK id. Falls back to filteredDeals when no column is picked.
  const sortedFilteredDeals = dealsSort.sortKey
    ? dealsSort.sorted(filteredDeals as any[], {
        ref: (d: any) => d.dealRef,
        type: (d: any) => d.dealType || "",
        status: (d: any) => legacyToCode(d.status) || d.status || "",
        property: (d: any) => propertyMap.get(d.propertyId) || d.name,
        unit: (d: any) => d.unitId ? unitMap.get(d.unitId) || "" : "",
        landlord: (d: any) => companyMap.get(d.landlordId),
        tenant: (d: any) => companyMap.get(d.tenantId),
        vendor: (d: any) => companyMap.get(d.vendorId),
        purchaser: (d: any) => companyMap.get(d.purchaserId),
        vendorAgent: (d: any) => companyMap.get(d.vendorAgentId),
        acquisitionAgent: (d: any) => companyMap.get(d.acquisitionAgentId),
        purchaserAgent: (d: any) => companyMap.get(d.purchaserAgentId),
        leasingAgent: (d: any) => companyMap.get(d.leasingAgentId),
        clientContact: (d: any) => d.clientContactName || d.clientContactId,
        agent: (d: any) => Array.isArray(d.internalAgent) ? d.internalAgent.join(", ") : d.internalAgent,
        fee: (d: any) => d.fee,
        pricing: (d: any) => d.pricing,
        yield: (d: any) => d.yieldPercent,
        feeAgreement: (d: any) => d.feeAgreement,
        xeroContact: (d: any) => d.xeroContactName,
        rentPa: (d: any) => d.rentPa,
        capitalContribution: (d: any) => d.capitalContribution,
        rentFree: (d: any) => d.rentFree,
        leaseLength: (d: any) => d.leaseLength,
        breakOption: (d: any) => d.breakOption,
        dateAdded: (d: any) => d.createdAt ? new Date(d.createdAt) : null,
        instructedAt: (d: any) => d.instructedAt ? new Date(d.instructedAt) : null,
        targetDate: (d: any) => d.targetDate ? new Date(d.targetDate) : null,
        exchangedAt: (d: any) => d.exchangedAt ? new Date(d.exchangedAt) : null,
        completedAt: (d: any) => d.completedAt ? new Date(d.completedAt) : null,
        invoicedAt: (d: any) => d.invoicedAt ? new Date(d.invoicedAt) : null,
        lastInteraction: (d: any) => d.lastInteraction ? new Date(d.lastInteraction) : null,
      })
    : filteredDeals;

  return (
    <PageLayout
      title={isCompsMode ? "Leasing Comps" : "Deals"}
      icon={Handshake}
      fullHeight
      subtitle={isCompsMode
        ? `${baseDeals.length} completed deal${baseDeals.length !== 1 ? "s" : ""} — comparable transactions`
        : urlTeamParam
          ? `${filteredDeals.length} deal${filteredDeals.length !== 1 ? "s" : ""} · Filtered by ${urlTeamParam} team`
          : activeTeam && activeTeam !== "all"
            ? `${filteredDeals.length} deal${filteredDeals.length !== 1 ? "s" : ""} — ${activeTeam}`
            : `${deals.length} deal${deals.length !== 1 ? "s" : ""} in the CRM`}
      actions={!isCompsMode ? (
        <>
          {!isMobile && (<>
          <Button
            variant="outline"
            size="sm"
            disabled={rentAnalysisRunning}
            onClick={async () => {
              setRentAnalysisRunning(true);
              toast({ title: "Running rent analysis", description: "Calculating NER for all lease deals and emailing Tom Cater..." });
              try {
                const res = await fetch("/api/crm/deals/bulk-rent-analysis", { method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, credentials: "include", body: JSON.stringify({ sendEmail: true }) });
                if (!res.ok) {
                  const err = await res.json().catch(() => ({}));
                  throw new Error(err.message || `Request failed (${res.status})`);
                }
                const data = await res.json();
                invalidateDealCaches();
                toast({ title: "Rent Analysis Complete", description: `${data.analysed} deals analysed, ${data.updated} updated${data.emailSent ? " — report sent to Tom" : ""}` });
              } catch (err: any) { toast({ title: "Error", description: err?.message || "Rent analysis failed", variant: "destructive" }); }
              setRentAnalysisRunning(false);
            }}
            data-testid="button-rent-analysis"
          >
            {rentAnalysisRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BarChart3 className="w-4 h-4 mr-2" />}
            Rent Analysis
          </Button>
          <Button variant="outline" onClick={() => setAiMatchOpen(true)} data-testid="button-ai-match">
            <Brain className="w-4 h-4 mr-2" />
            AI Match
          </Button>
          </>)}
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-deal">
            <Plus className="w-4 h-4 mr-2" />
            New Deal
          </Button>
        </>
      ) : undefined}
      className="h-[calc(100vh-3rem)] flex flex-col"
      testId={isCompsMode ? "comps-page" : "deals-page"}
    >

      {isMobile ? (
        <div className="flex flex-wrap gap-1.5 shrink-0">
          <button
            onClick={() => setActiveGroup("all")}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${activeGroup === "all" ? "border-primary bg-primary/5 font-semibold" : "text-muted-foreground"}`}
            data-testid="chip-group-all"
          >
            {isCompsMode ? "All Comps" : "All"}
            <span className="font-bold tabular-nums">{teamFilteredDeals.length}</span>
          </button>
          {statusCounts.map((s) => (
            <button
              key={s.name}
              onClick={() => setActiveGroup(activeGroup === s.name ? "all" : s.name)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${activeGroup === s.name ? "border-primary bg-primary/5 font-semibold" : "text-muted-foreground"}`}
              data-testid={`chip-status-${s.name}`}
            >
              <span className={`w-2 h-2 rounded-full ${DEAL_STATUS_COLORS[s.name] || "bg-primary/60"}`} />
              {s.name}
              <span className="font-bold tabular-nums">{s.count}</span>
            </button>
          ))}
        </div>
      ) : (
      <ScrollArea className="w-full shrink-0">
        <div className="flex items-center gap-3 pb-1">
          <Card
            className={`flex-shrink-0 min-w-[120px] cursor-pointer transition-colors ${
              activeGroup === "all" ? "border-primary" : ""
            }`}
            onClick={() => setActiveGroup("all")}
            data-testid="card-group-all"
          >
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Handshake className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-lg font-bold">{teamFilteredDeals.length}</p>
                  <p className="text-xs text-muted-foreground">{isCompsMode ? "All Comps" : "All Deals"}</p>
                  <p className="text-[11px] font-semibold text-muted-foreground tabular-nums">{formatCurrency(teamFilteredDeals.reduce((sum, d) => sum + (Number((d as any).fee) || 0), 0))}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {statusCounts.map((s) => (
            <Card
              key={s.name}
              className={`flex-shrink-0 min-w-[120px] cursor-pointer transition-colors ${
                activeGroup === s.name ? "border-primary" : ""
              }`}
              onClick={() => setActiveGroup(activeGroup === s.name ? "all" : s.name)}
              data-testid={`card-status-${s.name}`}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${DEAL_STATUS_COLORS[s.name] || "bg-primary/60"}`} />
                  <div>
                    <p className="text-lg font-bold">{s.count}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-[100px]">{s.name}</p>
                    <p className="text-[11px] font-semibold text-muted-foreground tabular-nums">{formatCurrency(s.feeTotal)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
      )}

      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search deals..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-deals"
          />
        </div>
        {!isMobile && (<>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-toggle-columns">
              <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
              Columns
              {Object.values(visibleColumns).filter(v => !v).length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">
                  {Object.values(visibleColumns).filter(v => v).length}/{Object.keys(visibleColumns).length}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={() => {
                const allVisible = Object.values(visibleColumns).every(v => v);
                setVisibleColumns(prev => {
                  const next: Record<string, boolean> = {};
                  for (const key of Object.keys(prev)) next[key] = !allVisible;
                  return next;
                });
              }}
              data-testid="toggle-columns-all"
            >
              {Object.values(visibleColumns).every(v => v) ? (
                <EyeOff className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
              ) : (
                <Eye className="w-3.5 h-3.5 mr-2 text-foreground" />
              )}
              <span className="font-medium">{Object.values(visibleColumns).every(v => v) ? "Hide All" : "Show All"}</span>
            </DropdownMenuItem>
            <div className="h-px bg-border my-1" />
            {Object.entries(COLUMN_LABELS).map(([key, label]) => (
              <DropdownMenuItem
                key={key}
                onClick={() => toggleColumn(key)}
                data-testid={`toggle-column-${key}`}
              >
                {visibleColumns[key] ? (
                  <Eye className="w-3.5 h-3.5 mr-2 text-foreground" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                )}
                <span className={visibleColumns[key] ? "" : "text-muted-foreground"}>{label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {hasFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveView}
            data-testid="button-save-view"
          >
            <Bookmark className="w-3.5 h-3.5 mr-1.5" />
            Save View
          </Button>
        )}
        {savedViews.length > 0 && (
          <Popover open={savedViewsOpen} onOpenChange={setSavedViewsOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-saved-views">
                <BookmarkCheck className="w-3.5 h-3.5 mr-1.5" />
                Saved Views
                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">{savedViews.length}</Badge>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">
              <div className="space-y-1">
                {savedViews.map((view, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded-md hover:bg-muted px-2 py-1.5 group">
                    <button
                      className="text-sm text-left flex-1 truncate"
                      onClick={() => handleApplyView(view)}
                      data-testid={`saved-view-${idx}`}
                    >
                      {view.name}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={(e) => { e.stopPropagation(); handleDeleteView(idx); }}
                      data-testid={`delete-saved-view-${idx}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {hasFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearAllFilters}
            data-testid="button-clear-all-filters"
          >
            <X className="w-3.5 h-3.5 mr-1.5" />
            Clear all
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        )}
        <ViewToggle view={viewMode} onToggle={setViewMode} showBoard />
        </>)}
      </div>

      {viewMode === "board" ? (
        isLoading ? (
          <div className="flex gap-3 overflow-x-auto pb-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="min-w-[260px] w-[280px] shrink-0">
                <Skeleton className="h-10 rounded-t-lg mb-2" />
                <Skeleton className="h-32 rounded-lg mb-2" />
                <Skeleton className="h-32 rounded-lg" />
              </div>
            ))}
          </div>
        ) : (
          <DealKanban
            deals={filteredDeals}
            propertyMap={propertyMap}
            unitMap={unitMap}
            tenantMap={companyMap}
            amlCompanyMap={amlCompanyMap}
          />
        )
      ) : viewMode === "card" ? (
        <Card className="flex-1 min-h-0 flex flex-col">
          <CardContent className="p-0 flex-1 min-h-0 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
              </div>
            ) : (
              <MobileCardView
                items={filteredDeals.map((deal): MobileCardItem => {
                  const propName = deal.propertyId ? (properties.find(p => p.id === deal.propertyId)?.name || "") : "";
                  const agents = Array.isArray(deal.internalAgent) ? deal.internalAgent.join(", ") : (deal.internalAgent || "");
                  const teams = Array.isArray(deal.team) ? deal.team.join(", ") : (deal.team || "");
                  // Custom deal name (different from the auto-filled property
                  // name) wins as the title — Layla's typed name should show.
                  // Otherwise fall back to the canonical property → deal name.
                  const customDealName = deal.name && deal.name !== propName ? deal.name : null;
                  return {
                    id: deal.id,
                    title: customDealName || propName || deal.name,
                    subtitle: customDealName && propName ? propName : undefined,
                    href: `/deals/${deal.id}`,
                    status: deal.status || undefined,
                    statusColor: DEAL_STATUS_COLORS[deal.status || ""] || "bg-muted-foreground",
                    // Billing leads \u2014 fee first, then rent. Type/agent follow.
                    fields: [
                      { label: "Fee", value: deal.fee ? `\u00A3${Number(deal.fee).toLocaleString()}` : null },
                      { label: "Rent p.a.", value: deal.rentPa ? `\u00A3${Number(deal.rentPa).toLocaleString()}` : null },
                      { label: "Type", value: deal.dealType, badge: true },
                      { label: "Agent", value: agents },
                    ],
                  };
                })}
                emptyMessage="No deals found"
                emptyIcon={BarChart3}
              />
            )}
          </CardContent>
        </Card>
      ) : (
      <Card className="flex-1 min-h-0 flex flex-col">
        <CardContent className="p-0 flex-1 min-h-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <ScrollableTable minWidth={1700}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px] px-2">
                      <Checkbox
                        checked={
                          filteredDeals.length > 0 && filteredDeals.every(d => selectedIds.has(d.id))
                            ? true
                            : filteredDeals.some(d => selectedIds.has(d.id))
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedIds(new Set(filteredDeals.map(d => d.id)));
                          } else {
                            setSelectedIds(new Set());
                          }
                        }}
                        data-testid="checkbox-select-all-deals"
                      />
                    </TableHead>
                    <SortableTableHead sortKey="ref" sort={dealsSort} className="w-[60px]">Ref</SortableTableHead>
                    <SortableTableHead sortKey="property" sort={dealsSort} className="min-w-[200px]">Property / Unit</SortableTableHead>
                    {visibleColumns.unit && <SortableTableHead sortKey="unit" sort={dealsSort} className="min-w-[100px]">Unit</SortableTableHead>}
                    {visibleColumns.clientXero && <TableHead className="min-w-[160px]">Client / Billing</TableHead>}
                    {visibleColumns.landlord && <SortableTableHead sortKey="landlord" sort={dealsSort} className="min-w-[120px] px-1.5">Client</SortableTableHead>}
                    {visibleColumns.type && (
                      <TableHead className="min-w-[120px]">
                        <div className="flex items-center gap-1">
                          <ColumnFilterPopover
                            label="Deal Type"
                            options={typeValues}
                            activeFilters={columnFilters["type"] || []}
                            onToggleFilter={(val) => toggleFilter("type", val)}
                          />
                          <button type="button" onClick={() => dealsSort.toggle("type")} title="Sort by deal type" className={`shrink-0 hover:text-foreground transition-colors ${dealsSort.sortKey === "type" ? "text-primary" : "opacity-50"}`} data-testid="sort-type">
                            {dealsSort.sortKey === "type" ? (dealsSort.direction === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronsUpDown className="w-3 h-3" />}
                          </button>
                        </div>
                      </TableHead>
                    )}
                    {visibleColumns.status && (
                      <TableHead className="min-w-[120px]">
                        <div className="flex items-center gap-1">
                          <ColumnFilterPopover
                            label="Deal Status"
                            options={statusValues}
                            activeFilters={columnFilters["status"] || []}
                            onToggleFilter={(val) => toggleFilter("status", val)}
                          />
                          <button type="button" onClick={() => dealsSort.toggle("status")} title="Sort by deal status" className={`shrink-0 hover:text-foreground transition-colors ${dealsSort.sortKey === "status" ? "text-primary" : "opacity-50"}`} data-testid="sort-status">
                            {dealsSort.sortKey === "status" ? (dealsSort.direction === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronsUpDown className="w-3 h-3" />}
                          </button>
                        </div>
                      </TableHead>
                    )}
                    {visibleColumns.team && (
                      <TableHead className="min-w-[80px]">
                        <ColumnFilterPopover
                          label="Team"
                          options={teamValues}
                          activeFilters={columnFilters["team"] || []}
                          onToggleFilter={(val) => toggleFilter("team", val)}
                        />
                      </TableHead>
                    )}
                    {visibleColumns.tenant && <SortableTableHead sortKey="tenant" sort={dealsSort} className="min-w-[120px]">Tenant</SortableTableHead>}
                    {visibleColumns.parties && <TableHead className="min-w-[180px]">Parties</TableHead>}
                    {visibleColumns.feeCombined && <TableHead className="min-w-[110px]">Fee</TableHead>}
                    {visibleColumns.fee && <SortableTableHead sortKey="fee" sort={dealsSort} align="right" className="min-w-[80px]">Fee</SortableTableHead>}
                    {visibleColumns.feeAlloc && <TableHead className="min-w-[120px]">Fee Split</TableHead>}
                    {visibleColumns.agent && <SortableTableHead sortKey="agent" sort={dealsSort} className="min-w-[80px]">BGP Contact</SortableTableHead>}
                    {visibleColumns.assetClass && (
                      <TableHead className="min-w-[80px]">
                        <ColumnFilterPopover
                          label="Asset Class"
                          options={assetClassValues}
                          activeFilters={columnFilters["assetClass"] || []}
                          onToggleFilter={(val) => toggleFilter("assetClass", val)}
                        />
                      </TableHead>
                    )}
                    {visibleColumns.clientContact && <SortableTableHead sortKey="clientContact" sort={dealsSort} className="min-w-[120px]">Client Contact</SortableTableHead>}
                    {visibleColumns.vendor && <SortableTableHead sortKey="vendor" sort={dealsSort} className="min-w-[120px]">Vendor</SortableTableHead>}
                    {visibleColumns.purchaser && <SortableTableHead sortKey="purchaser" sort={dealsSort} className="min-w-[120px]">Purchaser</SortableTableHead>}
                    {visibleColumns.vendorAgent && <SortableTableHead sortKey="vendorAgent" sort={dealsSort} className="min-w-[120px]">Vendor Agent</SortableTableHead>}
                    {visibleColumns.acquisitionAgent && <SortableTableHead sortKey="acquisitionAgent" sort={dealsSort} className="min-w-[120px]">Acquisition Agent</SortableTableHead>}
                    {visibleColumns.purchaserAgent && <SortableTableHead sortKey="purchaserAgent" sort={dealsSort} className="min-w-[120px]">Purchaser Agent</SortableTableHead>}
                    {visibleColumns.leasingAgent && <SortableTableHead sortKey="leasingAgent" sort={dealsSort} className="min-w-[120px]">Leasing Agent</SortableTableHead>}
                    {visibleColumns.pricingCombined && <TableHead className="min-w-[130px]">Pricing</TableHead>}
                    {visibleColumns.pricing && <SortableTableHead sortKey="pricing" sort={dealsSort} align="right" className="min-w-[100px]">Pricing</SortableTableHead>}
                    {visibleColumns.yield && <SortableTableHead sortKey="yield" sort={dealsSort} align="right" className="min-w-[80px]">Yield %</SortableTableHead>}
                    {visibleColumns.feeAgreement && <SortableTableHead sortKey="feeAgreement" sort={dealsSort} className="min-w-[100px]">Fee Agreement</SortableTableHead>}
                    {visibleColumns.xeroContact && <SortableTableHead sortKey="xeroContact" sort={dealsSort} className="min-w-[180px]">Xero Contact</SortableTableHead>}
                    {visibleColumns.floorAreas && <TableHead className="min-w-[140px]">Floor Areas</TableHead>}
                    {visibleColumns.pricePsf && <TableHead className="min-w-[80px] text-right">Price PSF</TableHead>}
                    {visibleColumns.priceItza && <TableHead className="min-w-[80px] text-right">Price ITZA</TableHead>}
                    {visibleColumns.leaseTerms && <TableHead className="min-w-[160px]">Lease Terms</TableHead>}
                    {visibleColumns.rentPa && <SortableTableHead sortKey="rentPa" sort={dealsSort} align="right" className="min-w-[100px]">Rent PA</SortableTableHead>}
                    {visibleColumns.capitalContribution && <SortableTableHead sortKey="capitalContribution" sort={dealsSort} align="right" className="min-w-[100px]">Capital Contribution</SortableTableHead>}
                    {visibleColumns.rentFree && <SortableTableHead sortKey="rentFree" sort={dealsSort} align="right" className="min-w-[80px]">Rent Free</SortableTableHead>}
                    {visibleColumns.leaseLength && <SortableTableHead sortKey="leaseLength" sort={dealsSort} align="right" className="min-w-[80px]">Lease Length</SortableTableHead>}
                    {visibleColumns.breakOption && <SortableTableHead sortKey="breakOption" sort={dealsSort} align="right" className="min-w-[80px]">Break Option</SortableTableHead>}
                    {visibleColumns.datesCombined && <TableHead className="min-w-[140px]">Dates</TableHead>}
                    {visibleColumns.dateAdded && <SortableTableHead sortKey="dateAdded" sort={dealsSort} className="min-w-[110px]">Date Added</SortableTableHead>}
                    {visibleColumns.instructedAt && <SortableTableHead sortKey="instructedAt" sort={dealsSort} className="min-w-[110px]">Instructed</SortableTableHead>}
                    {visibleColumns.targetDate && <SortableTableHead sortKey="targetDate" sort={dealsSort} className="min-w-[120px]">Target Date</SortableTableHead>}
                    {visibleColumns.exchangedAt && <SortableTableHead sortKey="exchangedAt" sort={dealsSort} className="min-w-[110px]">Exchanged</SortableTableHead>}
                    {visibleColumns.completedAt && <SortableTableHead sortKey="completedAt" sort={dealsSort} className="min-w-[110px]">Completed</SortableTableHead>}
                    {visibleColumns.invoicedAt && <SortableTableHead sortKey="invoicedAt" sort={dealsSort} className="min-w-[110px]">Invoiced</SortableTableHead>}
                    {visibleColumns.rentAnalysis && <TableHead className="min-w-[100px] text-right">Rent Analysis</TableHead>}
                    {visibleColumns.sharepoint && <TableHead className="min-w-[140px]">SharePoint Files</TableHead>}
                    {visibleColumns.lastInteraction && <SortableTableHead sortKey="lastInteraction" sort={dealsSort} className="min-w-[100px]">Last Touch</SortableTableHead>}
                    <TableHead className="w-[40px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedFilteredDeals.map((deal: any) => (
                    <TableRow
                      key={deal.id}
                      className="text-xs"
                      data-testid={`deal-row-${deal.id}`}
                    >
                      <TableCell className="px-1.5 py-1">
                        <Checkbox
                          checked={selectedIds.has(deal.id)}
                          onCheckedChange={(checked) => {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              if (checked) {
                                next.add(deal.id);
                              } else {
                                next.delete(deal.id);
                              }
                              return next;
                            });
                          }}
                          data-testid={`checkbox-deal-${deal.id}`}
                        />
                      </TableCell>
                      <TableCell className="px-1.5 py-1 font-mono text-muted-foreground text-xs">
                        <div className="flex items-center gap-1">
                          {(() => {
                            const aml = computeDealAmlStatus(deal as any, amlCompanyMap);
                            return <DealAmlBadge status={aml.status} missing={aml.missing} />;
                          })()}
                          {deal.dealRef ? (
                            <Link
                              href={`/deals/${deal.id}`}
                              className="text-blue-600 hover:underline"
                              data-testid={`link-deal-${deal.id}`}
                            >
                              #{deal.dealRef}
                            </Link>
                          ) : "—"}
                        </div>
                      </TableCell>
                      <TableCell className="px-1.5 py-1 w-[220px] max-w-[220px] overflow-hidden">
                        <PropertyUnitCell
                          deal={deal}
                          properties={properties}
                          propertyUnits={propertyUnits}
                          onPropertySave={(v) => handleInlineSave(deal.id, "propertyId", v)}
                          onPropertyCreate={(name) => createPropertyForDeal(deal.id, name)}
                          onUnitSave={(v) => handleInlineSave(deal.id, "unitId", v)}
                          onUnitCreated={() => invalidateDealCaches()}
                        />
                      </TableCell>
                      {visibleColumns.unit && (
                        <TableCell className="px-1.5 py-1 text-sm text-muted-foreground max-w-[120px] truncate">
                          {deal.unitId ? (unitMap.get(deal.unitId) || "—") : "—"}
                        </TableCell>
                      )}
                      {visibleColumns.clientXero && (
                        <TableCell className="px-1.5 py-1 w-[200px] max-w-[200px] overflow-hidden">
                          <ClientXeroCell
                            deal={deal}
                            companies={companies}
                            onLandlordSave={(v) => handleInlineSave(deal.id, "landlordId", v)}
                            onLandlordCreate={async (name) => {
                              try {
                                const r = await apiRequest("POST", "/api/crm/companies", {
                                  name: name.trim(),
                                  companyType: "Landlord / Client",
                                });
                                const created = await r.json();
                                queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
                                handleInlineSave(deal.id, "landlordId", String(created.id));
                                toast({ title: "Client created", description: `${created.name || name} added.` });
                              } catch (e: any) {
                                toast({ title: "Create failed", description: e?.message || "Try again", variant: "destructive" });
                              }
                            }}
                            onXeroChange={(c) => {
                              // One Xero pick = four deal fields to keep
                              // the cached billing snapshot in sync.
                              inlineUpdateMutation.mutate({ id: deal.id, field: "xeroContactId", value: c?.ContactID || null });
                              inlineUpdateMutation.mutate({ id: deal.id, field: "xeroContactName", value: c?.Name || null });
                              inlineUpdateMutation.mutate({ id: deal.id, field: "xeroAccountNumber", value: c?.AccountNumber || null });
                              inlineUpdateMutation.mutate({ id: deal.id, field: "xeroBillingAddress", value: c?.BillingAddress || null });
                            }}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.landlord && (
                        <TableCell className="px-1.5 py-1 max-w-[120px]">
                          <InlineLinkSelect
                            value={deal.landlordId}
                            options={companies.filter(c => c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client" || c.companyType?.startsWith("Tenant") || c.id === deal.landlordId).map(c => ({ id: c.id, name: c.name }))}
                            href={deal.landlordId ? `/companies/${deal.landlordId}` : undefined}
                            onSave={(v) => handleInlineSave(deal.id, "landlordId", v || null)}
                            onCreate={(name) => createCompanyForDeal(deal.id, "landlordId", "Landlord / Client", name)}
                            placeholder="Link landlord"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.type && (
                        <TableCell className="px-1.5 py-1">
                          <InlineLabelSelect
                            value={deal.dealType}
                            options={CRM_OPTIONS.dealType}
                            colorMap={DEAL_TYPE_COLORS}
                            onSave={(v) => handleInlineSave(deal.id, "dealType", v || null)}
                            data-testid={`inline-deal-type-${deal.id}`}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.status && (
                        <TableCell className="px-1.5 py-1">
                          <InlineLabelSelect
                            value={legacyToCode(deal.status) || deal.status}
                            options={mode === "wip" ? WIP_STATUSES : CRM_OPTIONS.dealStatus}
                            colorMap={DEAL_STATUS_COLORS}
                            labelMap={DEAL_STATUS_LABELS}
                            onSave={(v) => handleInlineSave(deal.id, "status", v || null)}
                            data-testid={`inline-deal-status-${deal.id}`}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.team && (
                        <TableCell className="px-1.5 py-1">
                          <InlineMultiSelect
                            value={deal.team}
                            options={CRM_OPTIONS.dealTeam.map(t => ({ label: teamLabel(t), value: t }))}
                            colorMap={DEAL_TEAM_COLORS}
                            placeholder="Set team"
                            onSave={(v) => handleInlineSave(deal.id, "team", v.length > 0 ? v : null)}
                            testId={`inline-deal-team-${deal.id}`}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.tenant && (
                        <TableCell className="px-1.5 py-1">
                          <div className="w-[110px] overflow-hidden">
                            <InlineLinkSelect
                              value={deal.tenantId}
                              options={companies.filter(c => c.companyType?.startsWith("Tenant") || c.companyType === "Purchaser" || c.id === deal.tenantId).map(c => ({ id: c.id, name: c.name }))}
                              href={deal.tenantId ? `/companies/${deal.tenantId}` : undefined}
                              onSave={(v) => handleInlineSave(deal.id, "tenantId", v || null)}
                              onCreate={(name) => createCompanyForDeal(deal.id, "tenantId", "Tenant", name)}
                              placeholder="Link tenant"
                            />
                          </div>
                        </TableCell>
                      )}
                      {visibleColumns.parties && (
                        <TableCell className="px-1.5 py-1">
                          <PartiesCell
                            deal={deal}
                            companies={companies}
                            contacts={contacts}
                            agentCompanies={agentCompanies}
                            onSave={(field, value) => handleInlineSave(deal.id, field, value)}
                            onCreated={() => invalidateDealCaches()}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.feeCombined && (
                        <TableCell className="px-1.5 py-1">
                          <FeeCombinedCell
                            deal={deal}
                            onSave={(field, value) => handleInlineSave(deal.id, field, value)}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.fee && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.fee}
                            onSave={(v) => handleInlineSave(deal.id, "fee", v)}
                            prefix="£"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.feeAlloc && (
                        <TableCell className="px-1.5 py-1">
                          <FeeAllocCell dealId={deal.id} dealFee={deal.fee} allAllocations={allFeeAllocations} colorMap={userColorMap2} teams={deal.team} onClick={() => setFeeAllocEditDeal(deal)} />
                        </TableCell>
                      )}
                      {visibleColumns.agent && (
                        <TableCell className="px-1.5 py-1">
                          <InlineMultiSelect
                            value={deal.internalAgent}
                            options={users.map(u => ({ label: u.name, value: u.name }))}
                            placeholder="Set agent"
                            onSave={(v) => handleInlineSave(deal.id, "internalAgent", v.length > 0 ? v : null)}
                            testId={`inline-deal-agent-${deal.id}`}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.assetClass && (
                        <TableCell className="px-1.5 py-1">
                          <InlineLabelSelect
                            value={deal.assetClass}
                            options={CRM_OPTIONS.dealAssetClass}
                            colorMap={DEAL_ASSET_CLASS_COLORS}
                            onSave={(v) => handleInlineSave(deal.id, "assetClass", v || null)}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.clientContact && (
                        <TableCell className="px-1.5 py-1 max-w-[120px]">
                          <InlineLinkSelect
                            value={deal.clientContactId}
                            options={contacts.map(c => ({ id: c.id, name: c.name || c.email || "Unknown" }))}
                            href={deal.clientContactId ? `/contacts/${deal.clientContactId}` : undefined}
                            onSave={(v) => handleInlineSave(deal.id, "clientContactId", v || null)}
                            onCreate={(name) => createContactForDeal(deal.id, "clientContactId", name)}
                            placeholder="Link contact"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.vendor && (
                        <TableCell className="px-1.5 py-1">
                          <div className="w-[110px] overflow-hidden">
                            <InlineLinkSelect
                              value={deal.vendorId}
                              options={companies.filter(c => c.companyType === "Vendor" || c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client" || c.id === deal.vendorId).map(c => ({ id: c.id, name: c.name }))}
                              href={deal.vendorId ? `/companies/${deal.vendorId}` : undefined}
                              onSave={(v) => handleInlineSave(deal.id, "vendorId", v || null)}
                              onCreate={(name) => createCompanyForDeal(deal.id, "vendorId", "Vendor", name)}
                              placeholder="Link vendor"
                            />
                          </div>
                        </TableCell>
                      )}
                      {visibleColumns.purchaser && (
                        <TableCell className="px-1.5 py-1">
                          <div className="w-[110px] overflow-hidden">
                            <InlineLinkSelect
                              value={deal.purchaserId}
                              options={companies.filter(c => c.companyType?.startsWith("Tenant") || c.companyType === "Purchaser" || c.companyType === "Investor" || c.id === deal.purchaserId).map(c => ({ id: c.id, name: c.name }))}
                              href={deal.purchaserId ? `/companies/${deal.purchaserId}` : undefined}
                              onSave={(v) => handleInlineSave(deal.id, "purchaserId", v || null)}
                              onCreate={(name) => createCompanyForDeal(deal.id, "purchaserId", "Purchaser", name)}
                              placeholder="Link purchaser"
                            />
                          </div>
                        </TableCell>
                      )}
                      {visibleColumns.vendorAgent && (
                        <TableCell className="px-1.5 py-1">
                          <div className="w-[110px] overflow-hidden">
                            <InlineLinkSelect
                              value={deal.vendorAgentId}
                              options={agentCompanies.map(c => ({ id: c.id, name: c.name }))}
                              href={deal.vendorAgentId ? `/companies/${deal.vendorAgentId}` : undefined}
                              onSave={(v) => handleInlineSave(deal.id, "vendorAgentId", v || null)}
                              onCreate={(name) => createCompanyForDeal(deal.id, "vendorAgentId", "Agent", name)}
                              placeholder="Link agent"
                            />
                          </div>
                        </TableCell>
                      )}
                      {visibleColumns.acquisitionAgent && (
                        <TableCell className="px-1.5 py-1">
                          <div className="w-[110px] overflow-hidden">
                            <InlineLinkSelect
                              value={deal.acquisitionAgentId}
                              options={agentCompanies.map(c => ({ id: c.id, name: c.name }))}
                              href={deal.acquisitionAgentId ? `/companies/${deal.acquisitionAgentId}` : undefined}
                              onSave={(v) => handleInlineSave(deal.id, "acquisitionAgentId", v || null)}
                              onCreate={(name) => createCompanyForDeal(deal.id, "acquisitionAgentId", "Agent", name)}
                              placeholder="Link agent"
                            />
                          </div>
                        </TableCell>
                      )}
                      {visibleColumns.purchaserAgent && (
                        <TableCell className="px-1.5 py-1">
                          <div className="w-[110px] overflow-hidden">
                            <InlineLinkSelect
                              value={deal.purchaserAgentId}
                              options={agentCompanies.map(c => ({ id: c.id, name: c.name }))}
                              href={deal.purchaserAgentId ? `/companies/${deal.purchaserAgentId}` : undefined}
                              onSave={(v) => handleInlineSave(deal.id, "purchaserAgentId", v || null)}
                              onCreate={(name) => createCompanyForDeal(deal.id, "purchaserAgentId", "Agent", name)}
                              placeholder="Link agent"
                            />
                          </div>
                        </TableCell>
                      )}
                      {visibleColumns.leasingAgent && (
                        <TableCell className="px-1.5 py-1">
                          <div className="w-[110px] overflow-hidden">
                            <InlineLinkSelect
                              value={deal.leasingAgentId}
                              options={agentCompanies.map(c => ({ id: c.id, name: c.name }))}
                              href={deal.leasingAgentId ? `/companies/${deal.leasingAgentId}` : undefined}
                              onSave={(v) => handleInlineSave(deal.id, "leasingAgentId", v || null)}
                              onCreate={(name) => createCompanyForDeal(deal.id, "leasingAgentId", "Agent", name)}
                              placeholder="Link agent"
                            />
                          </div>
                        </TableCell>
                      )}
                      {visibleColumns.pricingCombined && (
                        <TableCell className="px-1.5 py-1">
                          <PricingCell
                            deal={deal}
                            onSave={(field, value) => handleInlineSave(deal.id, field, value)}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.pricing && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.pricing}
                            onSave={(v) => handleInlineSave(deal.id, "pricing", v)}
                            prefix="£"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.yield && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.yieldPercent}
                            onSave={(v) => handleInlineSave(deal.id, "yieldPercent", v)}
                            suffix="%"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.feeAgreement && (
                        <TableCell className="px-1.5 py-1">
                          <InlineLabelSelect
                            value={deal.feeAgreement}
                            options={CRM_OPTIONS.dealFeeAgreement}
                            colorMap={DEAL_FEE_AGREEMENT_COLORS}
                            onSave={(v) => handleInlineSave(deal.id, "feeAgreement", v || null)}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.xeroContact && (
                        <TableCell className="px-1.5 py-1">
                          {(deal as any).xeroContactName ? (
                            <div className="flex flex-col">
                              <span className="text-xs truncate">{(deal as any).xeroContactName}</span>
                              {(deal as any).xeroAccountNumber && (
                                <span className="text-[10px] text-muted-foreground">A/C {(deal as any).xeroAccountNumber}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">No Xero contact</span>
                          )}
                        </TableCell>
                      )}
                      {visibleColumns.floorAreas && (
                        <TableCell className="px-1.5 py-1">
                          <div className="space-y-0.5">
                            {[
                              { label: "GF", value: deal.gfAreaSqft, field: "gfAreaSqft", show: true },
                              { label: "FF", value: deal.ffAreaSqft, field: "ffAreaSqft", show: true },
                              { label: "Bsmt", value: deal.basementAreaSqft, field: "basementAreaSqft", show: true },
                              { label: "ITZA", value: deal.itzaAreaSqft, field: "itzaAreaSqft", show: isRetailAssetClass(deal.assetClass) },
                              { label: deal.areaBasis || areaBasisFromAssetClass(deal.assetClass), value: deal.totalAreaSqft, field: "totalAreaSqft", show: true },
                            ].filter(r => r.show).map(({ label, value, field }) => (
                              <div key={field} className="flex items-center gap-1.5">
                                <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wide w-7 shrink-0">{label}</span>
                                <InlineNumber
                                  value={value}
                                  onSave={(v) => handleInlineSave(deal.id, field, v)}
                                  suffix=" sf"
                                  className="text-xs"
                                />
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      )}
                      {visibleColumns.pricePsf && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.pricePsf}
                            onSave={(v) => handleInlineSave(deal.id, "pricePsf", v)}
                            prefix="£"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.priceItza && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.priceItza}
                            onSave={(v) => handleInlineSave(deal.id, "priceItza", v)}
                            prefix="£"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.leaseTerms && (
                        <TableCell className="px-1.5 py-1">
                          <LeaseTermsCell
                            deal={deal}
                            onSave={(field, value) => handleInlineSave(deal.id, field, value)}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.rentPa && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.rentPa}
                            onSave={(v) => handleInlineSave(deal.id, "rentPa", v)}
                            prefix="£"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.capitalContribution && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.capitalContribution}
                            onSave={(v) => handleInlineSave(deal.id, "capitalContribution", v)}
                            prefix="£"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.rentFree && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.rentFree}
                            onSave={(v) => handleInlineSave(deal.id, "rentFree", v)}
                            suffix=" months"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.leaseLength && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.leaseLength}
                            onSave={(v) => handleInlineSave(deal.id, "leaseLength", v)}
                            suffix=" years"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.breakOption && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.breakOption}
                            onSave={(v) => handleInlineSave(deal.id, "breakOption", v)}
                            suffix=" years"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.datesCombined && (
                        <TableCell className="px-1.5 py-1">
                          <DatesCell
                            deal={deal}
                            onSave={(field, value) => handleInlineSave(deal.id, field, value)}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.dateAdded && (
                        <TableCell className="px-1.5 py-1">
                          {deal.createdAt ? formatDate(deal.createdAt) : "—"}
                        </TableCell>
                      )}
                      {visibleColumns.instructedAt && (
                        <TableCell className="px-1.5 py-1">
                          {deal.instructedAt ? formatDate(deal.instructedAt) : "—"}
                        </TableCell>
                      )}
                      {visibleColumns.targetDate && (
                        <TableCell className="px-1.5 py-1">
                          <input
                            type="date"
                            className="text-xs bg-transparent border-0 outline-none cursor-pointer hover:bg-muted rounded px-1 w-[110px]"
                            value={toDateInputValue(deal.targetDate)}
                            onChange={(e) => handleInlineSave(deal.id, "targetDate", e.target.value || null)}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.exchangedAt && (
                        <TableCell className="px-1.5 py-1">
                          {deal.exchangedAt ? formatDate(deal.exchangedAt) : "—"}
                        </TableCell>
                      )}
                      {visibleColumns.completedAt && (
                        <TableCell className="px-1.5 py-1">
                          {deal.completedAt ? formatDate(deal.completedAt) : "—"}
                        </TableCell>
                      )}
                      {visibleColumns.invoicedAt && (
                        <TableCell className="px-1.5 py-1">
                          {deal.invoicedAt ? formatDate(deal.invoicedAt) : "—"}
                        </TableCell>
                      )}
                      {visibleColumns.rentAnalysis && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.rentAnalysis}
                            onSave={(v) => handleInlineSave(deal.id, "rentAnalysis", v)}
                            prefix="£"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.sharepoint && (
                        <TableCell className="px-1.5 py-1 max-w-[140px]">
                          <div className="space-y-0.5">
                            {deal.sharepointLink && (
                              <a
                                href={deal.sharepointLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline cursor-pointer flex items-center gap-1"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span className="text-xs">SharePoint</span>
                              </a>
                            )}
                            {deal.propertyId ? (
                              <Link href={`/properties/${deal.propertyId}`}>
                                <span className="text-primary hover:underline cursor-pointer flex items-center gap-1">
                                  <Building2 className="w-3 h-3" />
                                  {propertyMap.get(deal.propertyId) || "View"}
                                </span>
                              </Link>
                            ) : !deal.sharepointLink ? (
                              <span className="text-muted-foreground text-[10px]">No files linked</span>
                            ) : null}
                          </div>
                        </TableCell>
                      )}
                      {visibleColumns.lastInteraction && (
                        <TableCell className="px-1.5 py-1">
                          <LastTouchCell iso={deal.lastInteraction} />
                        </TableCell>
                      )}
                      <TableCell className="p-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); setDeleteListDeal({ id: deal.id, name: deal.name }); }}
                          data-testid={`button-delete-deal-${deal.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredDeals.length > 0 && (
                    <TableRow className="bg-muted/50 font-semibold border-t-2 hover:bg-muted/50">
                      <TableCell colSpan={3 + Object.values(visibleColumns).filter(v => v).length} className="text-right py-2 text-xs">
                        {filteredDeals.length} {isCompsMode ? "comps" : "deals"} · Total fees: {formatCurrency(filteredDeals.reduce((s, d) => s + (Number((d as any).fee) || 0), 0))}
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredDeals.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3 + Object.values(visibleColumns).filter(v => v).length} className="text-center py-12 text-muted-foreground">
                        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                          <BarChart3 className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-semibold text-foreground">{isCompsMode ? "No comps found" : "No deals found"}</p>
                        <p className="text-xs mt-1">
                          {hasFilters ? "Create a deal or adjust your filters" : "Create a deal to get started"}
                        </p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollableTable>
          )}
        </CardContent>
      </Card>
      )}

      {!isCompsMode && (
        <>
          <DealFormDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            properties={properties}
            propertyUnits={propertyUnits}
            companies={companies}
            users={users}
          />


          <AiMatchDialog
            open={aiMatchOpen}
            onOpenChange={setAiMatchOpen}
          />

          <HotsChecklistDialog
            open={!!hotsChecklistDeal}
            onOpenChange={(open) => !open && setHotsChecklistDeal(null)}
            deal={hotsChecklistDeal}
            properties={properties}
            companies={companies}
            users={users}
            onComplete={() => setHotsChecklistDeal(null)}
            colorMap={userColorMap2}
          />
        </>
      )}

      <Dialog open={!!feeAllocEditDeal} onOpenChange={(open) => !open && setFeeAllocEditDeal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{feeAllocEditDeal?.name || "Fee Split"}</DialogTitle>
            <DialogDescription className="text-xs">
              {feeAllocEditDeal?.fee != null ? `Total fee: ${formatCurrency(feeAllocEditDeal.fee)}` : "Set fee on the deal first"}
            </DialogDescription>
          </DialogHeader>
          {feeAllocEditDeal && (
            <FeeAllocationCard
              dealId={feeAllocEditDeal.id}
              dealFee={feeAllocEditDeal.fee}
              users={users.map(u => ({ id: String(u.id), name: u.name }))}
              colorMap={userColorMap2}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteListDeal} onOpenChange={(open) => !open && setDeleteListDeal(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Deal</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteListDeal?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-list">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteListDeal && deleteListMutation.mutate(deleteListDeal.id)}
              disabled={deleteListMutation.isPending}
              data-testid="button-confirm-delete-list"
            >
              {deleteListMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectedIds.size > 0 && (
        <div
          className="fixed bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-md border bg-card px-4 py-3 shadow-lg"
          data-testid="bulk-action-bar-deals"
        >
          <span className="text-sm font-medium" data-testid="text-selected-count-deals">
            {selectedIds.size} selected
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="bulk-assign-team-deals">
                <Users className="w-3.5 h-3.5 mr-1.5" />
                Assign Team
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              {CRM_OPTIONS.dealTeam.map(team => (
                <DropdownMenuItem
                  key={team}
                  onClick={() => bulkUpdateMutation.mutate({ ids: Array.from(selectedIds), field: "team", value: [team] })}
                  data-testid={`bulk-assign-team-option-${team}`}
                >
                  <div className={`w-2 h-2 rounded-full ${DEAL_TEAM_COLORS[team] || "bg-zinc-500"} mr-2`} />
                  {teamLabel(team)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setBulkDeleteOpen(true)}
            data-testid="bulk-delete-deals"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Delete
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedIds(new Set())}
            data-testid="button-clear-selection-deals"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} Deal{selectedIds.size !== 1 ? "s" : ""}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedIds.size} deal{selectedIds.size !== 1 ? "s" : ""}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-delete-deals">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => bulkDeleteMutation.mutate({ ids: Array.from(selectedIds) })}
              disabled={bulkDeleteMutation.isPending}
              data-testid="button-confirm-bulk-delete-deals"
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={listApprovalGateOpen} onOpenChange={setListApprovalGateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-amber-500" />
              {listApprovalGateMsg?.includes("AML") ? "AML Check Required" : "Approval Required"}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="whitespace-pre-line block">{listApprovalGateMsg || "This status change requires senior approval."}</span>
              {!listApprovalGateMsg?.includes("AML") && (
                <span className="text-xs text-muted-foreground mt-2 block">
                  Please ask a senior team member (Woody, Charlotte, Rupert, or Jack) to make this change.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Understood</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageLayout>
  );
}
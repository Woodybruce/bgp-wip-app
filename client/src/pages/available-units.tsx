import { useQuery, useMutation } from "@tanstack/react-query";
import { ScrollableTable } from "@/components/scrollable-table";
import { PropertyPlanningCard } from "@/components/property-planning-card";
import { SourceEmailDialog, SourceEventDialog } from "@/components/tracker-source";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search, Plus, Pencil, Trash2, Link2, ArrowRightLeft, Store, Eye, Building2, Mail,
  FileText, Upload, Sparkles, Download, X, File, Star, CalendarDays, HandCoins, Flame,
  ChevronDown, ChevronRight, ChevronUp, ExternalLink, AlertTriangle, FileBadge, Target, MessageSquare, Loader2, MoreVertical, Ban } from "lucide-react";
import { UnitBriefDialog } from "@/components/unit-brief-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Fragment, useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest, queryClient, getAuthHeaders, invalidateDealCaches } from "@/lib/queryClient";
import { UnifiedAddUnitDialog, UNIFIED_ADD_UNIT_ENABLED } from "@/components/unified-add-unit-dialog";
import { PropertyUnifiedSchedule } from "@/components/PropertyUnifiedSchedule";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { InlineText, InlineNumber, InlineSelect, InlineLabelSelect, InlineMultiSelect, InlineLinkSelect } from "@/components/inline-edit";
import type { AvailableUnit, CrmProperty, CrmDeal, CrmCompany, CrmContact, UnitMarketingFile, UnitViewing, UnitOffer, PropertyUnit } from "@shared/schema";
import { BRIEF_TARGET_STATUSES } from "@shared/schema";
import { BrandSearchInput, type BrandPick } from "@/components/brand-search-input";
import { SuggestTargetsDialog } from "@/components/suggest-targets-dialog";
import { TargetRowCells, LETTING_CATEGORIES, targetStatusLabel } from "@/components/target-operators-table";
import { useTeam } from "@/lib/team-context";
import { CRM_OPTIONS, areaBasisFromAssetClass, isRetailAssetClass } from "@/lib/crm-options";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { PropertyCombobox } from "@/components/property-combobox";
import PDFViewer from "@/components/pdf-viewer";
import { EntityCombobox } from "@/components/entity-combobox";
import { XeroContactPicker } from "@/components/xero-contact-picker";
import { FeeAllocationEditor, type FeeAllocationRow } from "@/components/fee-allocation-editor";

import { LETTING_STATUSES, DEAL_STATUS_LABELS, legacyToCode, type DealStatusCode } from "@shared/deal-status";
const MARKETING_STATUSES = LETTING_STATUSES;
// The per-row Deal Status dropdown offers the deal pipeline only (Woody,
// 2026-09-01): Opportunity/Available belong to Unit Status, Withdrawn moved
// to the bulk Change Status menu (historic WIT rows keep their chip). AVA
// reads as "Marketing" on this board — same stored code (legacyToCode
// already maps "marketing" → AVA), so WIP / deals boards are untouched.
const DEAL_PIPELINE_STATUSES: DealStatusCode[] = ["AVA", "NEG", "HOT", "SOL", "EXC", "COM", "INV"];
const DEAL_PIPELINE_LABELS: Record<string, string> = { ...DEAL_STATUS_LABELS, AVA: "Marketing" };
// Feedback (2026-08-14): a unit itself is only ever an Opportunity or
// Available — everything past that (NEG/HOT/SOL/…) is the DEAL's status,
// which drives the boards. The unit-stage select offers just these two;
// UNIT_STAGE_EDITABLE is the set of effective codes where flipping the
// unit stage can't regress a live deal via the 4-way status mirror.
// Unit names imported from client schedules often carry the postcode, which
// the narrow Property / Unit column can't spare and the property sub-line
// underneath already identifies. Display only — the stored name is untouched.
function displayUnitName(name: string): string {
  return name
    .replace(/,?\s*\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, "")
    .replace(/\s*,\s*(?=,|$)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[,\s-]+|[,\s]+$/g, "");
}

const UNIT_STATUSES: DealStatusCode[] = ["OPP", "AVA"];
const UNIT_STAGE_EDITABLE = new Set<DealStatusCode>(["OPP", "AVA", "REP", "SPEC", "LIVE"]);
const USE_CLASSES = ["E", "E(a)", "E(b)", "E(c)", "E(d)", "E(e)", "A1", "A2", "A3", "A4", "A5", "B1", "B2", "B8", "C1", "C3", "D1", "D2", "F1", "F2", "Sui Generis"];
const FLOORS = ["Basement", "Lower Ground", "Ground", "Mezzanine", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "Upper"];
const CONDITIONS = ["Shell & Core", "Cat A", "Cat A+", "Cat B", "Fitted", "Turn Key", "As Is"];
const EPC_RATINGS = ["A", "B", "C", "D", "E", "F", "G", "Exempt"];
const LOCATIONS = ["Clapham", "East Anglia", "Ireland", "London", "Midlands", "N. Ireland", "National", "North East", "North West", "Scotland", "South East", "South West", "Wales"];
const LOCATION_COLORS: Record<string, string> = {
  "Clapham": "bg-pink-500", "East Anglia": "bg-amber-500", "Ireland": "bg-emerald-600",
  "London": "bg-blue-600", "Midlands": "bg-purple-500", "N. Ireland": "bg-teal-500",
  "National": "bg-emerald-500", "North East": "bg-sky-500", "North West": "bg-indigo-500",
  "Scotland": "bg-blue-800", "South East": "bg-orange-500", "South West": "bg-lime-600",
  "Wales": "bg-red-600",
};

// Status colours come from the shared module so the tracker, Deals board
// and property summary all paint the same code the same hue (these used
// to be three diverging local palettes).
import { DEAL_STATUS_BADGE_COLORS as STATUS_COLORS } from "@/lib/deal-status-colors";
import { DEAL_STATUS_DOT_COLORS as STATUS_LABEL_COLORS } from "@/lib/deal-status-colors";

const ASSET_CLASS_COLORS: Record<string, string> = {
  "E": "bg-blue-500",
  "E(a)": "bg-blue-400",
  "E(b)": "bg-blue-400",
  "E(c)": "bg-blue-400",
  "E(d)": "bg-blue-400",
  "E(e)": "bg-blue-400",
  "A1": "bg-emerald-500",
  "A2": "bg-emerald-500",
  "A3": "bg-teal-500",
  "A4": "bg-teal-500",
  "A5": "bg-teal-500",
  "B1": "bg-purple-500",
  "B2": "bg-purple-500",
  "B8": "bg-purple-400",
  "C1": "bg-rose-500",
  "C3": "bg-rose-400",
  "D1": "bg-orange-500",
  "D2": "bg-orange-500",
  "F1": "bg-cyan-500",
  "F2": "bg-cyan-500",
  "Sui Generis": "bg-gray-600",
};

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("en-GB");
}

function fmtCurrency(n: number | null | undefined) {
  if (n == null) return "—";
  return `£${n.toLocaleString("en-GB")}`;
}

// Company/contact picker for the viewings & offers dialogs. Renders the
// inline EntityCombobox rather than a Popover: these pickers only appear
// inside a Radix Dialog, where a portal'd Popover never receives pointer
// events — clicking a company did nothing and every viewing saved with an
// "Unknown" company.
function CrmPicker({ items, value, valueName, onSelect, placeholder, testId }: {
  items: { id: string; name: string }[];
  value: string;
  valueName: string;
  onSelect: (id: string, name: string) => void;
  placeholder: string;
  testId: string;
}) {
  return (
    <EntityCombobox
      items={items.map(i => ({ id: i.id, label: i.name }))}
      value={value}
      onChange={(id) => onSelect(id, id ? (items.find(i => i.id === id)?.name ?? "") : "")}
      placeholder={placeholder}
      searchPlaceholder={`Search ${placeholder.toLowerCase()}...`}
      testId={testId}
    />
  );
}

interface UnitFormState {
  unitName: string;
  propertyId: string;
  dealType: string;
  floor: string;
  sqft: string;
  askingRent: string;
  ratesPa: string;
  serviceChargePa: string;
  useClass: string;
  condition: string;
  availableDate: string;
  marketingStatus: string;
  epcRating: string;
  location: string;
  notes: string;
  restrictions: string;
  fee: string;
  feePercentage: string;
  marketingStartDate: string;
  agentUserIds: string[];
  // Landlord brand (client). Auto-pre-filled from
  // crm_properties.landlord_id when the user picks a property, but
  // overrideable. No Xero billing entity at this stage — that's a
  // SOL-handover concern.
  landlordId: string;
  landlordName: string;
}

const emptyForm: UnitFormState = {
  unitName: "",
  propertyId: "",
  dealType: "New Letting",
  floor: "",
  sqft: "",
  askingRent: "",
  ratesPa: "",
  serviceChargePa: "",
  useClass: "",
  condition: "",
  availableDate: "",
  marketingStatus: "AVA",
  epcRating: "",
  location: "",
  notes: "",
  restrictions: "",
  fee: "",
  feePercentage: "",
  marketingStartDate: "",
  agentUserIds: [],
  landlordId: "",
  landlordName: "",
};

function formToPayload(f: UnitFormState) {
  return {
    unitName: f.unitName,
    propertyId: f.propertyId,
    dealType: f.dealType || "New Letting",
    floor: f.floor || null,
    sqft: f.sqft ? parseFloat(f.sqft) : null,
    askingRent: f.askingRent ? parseFloat(f.askingRent) : null,
    ratesPa: f.ratesPa ? parseFloat(f.ratesPa) : null,
    serviceChargePa: f.serviceChargePa ? parseFloat(f.serviceChargePa) : null,
    useClass: f.useClass || null,
    condition: f.condition || null,
    availableDate: f.availableDate || null,
    marketingStatus: legacyToCode(f.marketingStatus) || "AVA",
    epcRating: f.epcRating || null,
    location: f.location || null,
    notes: f.notes || null,
    restrictions: f.restrictions || null,
    fee: f.fee ? parseFloat(f.fee) : null,
    feePercentage: f.feePercentage ? parseFloat(f.feePercentage) : null,
    marketingStartDate: f.marketingStartDate || null,
    agentUserIds: f.agentUserIds.length > 0 ? f.agentUserIds : null,
    landlordId: f.landlordId || null,
  };
}

function unitToForm(u: AvailableUnit, dealType?: string | null, landlord?: { id: string; name: string } | null): UnitFormState {
  return {
    unitName: u.unitName || "",
    propertyId: u.propertyId || "",
    dealType: dealType || "New Letting",
    floor: u.floor || "",
    sqft: u.sqft?.toString() || "",
    askingRent: u.askingRent?.toString() || "",
    ratesPa: u.ratesPa?.toString() || "",
    serviceChargePa: u.serviceChargePa?.toString() || "",
    useClass: u.useClass || "",
    condition: u.condition || "",
    availableDate: u.availableDate || "",
    marketingStatus: legacyToCode(u.marketingStatus) || "AVA",
    epcRating: u.epcRating || "",
    location: u.location || "",
    notes: u.notes || "",
    restrictions: u.restrictions || "",
    fee: u.fee?.toString() || "",
    feePercentage: "",
    marketingStartDate: u.marketingStartDate || "",
    agentUserIds: Array.isArray(u.agentUserIds) ? u.agentUserIds : [],
    landlordId: (u as any).landlordId || landlord?.id || "",
    landlordName: landlord?.name || "",
  };
}

function fmtNumStr(v: string): string {
  const raw = v.replace(/[^0-9.]/g, "");
  if (!raw) return "";
  const parts = raw.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}
function stripCommas(v: string): string {
  return v.replace(/,/g, "");
}
function CurrencyInput({ value, onChange, placeholder, prefix, testId }: { value: string; onChange: (v: string) => void; placeholder?: string; prefix?: string; testId?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative">
      {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">{prefix}</span>}
      <Input
        type="text"
        inputMode="decimal"
        value={focused ? value : fmtNumStr(value)}
        onChange={e => onChange(stripCommas(e.target.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        className={prefix ? "pl-7" : ""}
        data-testid={testId}
      />
    </div>
  );
}

const INTERNAL_BGP_TEAMS = new Set(CRM_OPTIONS.dealTeam.filter((t: string) => t !== "Landsec"));

export default function AvailableUnitsPage() {
  const { activeTeam } = useTeam();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [suggestUnit, setSuggestUnit] = useState<{ id: string; unitName: string } | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  // Deep links from TrackerSummary lozenges / "Letting Tracker" buttons
  // carry ?propertyId= and ?status= — honour them on first mount (they
  // were silently ignored before).
  const urlParam = (k: string) => { try { return new URLSearchParams(window.location.search).get(k) || "all"; } catch { return "all"; } };
  const [statusFilter, setStatusFilter] = useState(() => urlParam("status"));
  // Compact header (team feedback: the fixed header block was so tall the
  // table barely had scroll room). Hides the FY strip and swaps the big
  // status cards for thin chips — every filter stays reachable. Persisted.
  const [compactHeader, setCompactHeader] = useState(() => {
    try { return localStorage.getItem("tracker_compact_header") === "1"; } catch { return false; }
  });
  const toggleCompactHeader = () => setCompactHeader(v => {
    try { localStorage.setItem("tracker_compact_header", v ? "0" : "1"); } catch {}
    return !v;
  });
  // "All statuses" view — every deal-status group laid out down the page
  // (SOL+ included) with the tenancy schedules underneath, instead of
  // clicking each status card in turn (Woody, 2026-08-06).
  const [viewAll, setViewAll] = useState(() => urlParam("view") === "all");
  const [scheduleOpen, setScheduleOpen] = useState<Record<string, boolean>>({});
  // Header sort — Property/Unit and Client columns, A→Z / Z→A toggle.
  const [sortBy, setSortBy] = useState<"none" | "property" | "client">("none");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const toggleSort = (key: "property" | "client") => {
    if (sortBy === key) {
      if (sortDir === 1) setSortDir(-1);
      else { setSortBy("none"); setSortDir(1); }
    } else { setSortBy(key); setSortDir(1); }
  };
  const [targetStatusFilter, setTargetStatusFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState<null | "viewings" | "offers" | "interest">(null);
  // "Pitch property" from a brand profile carries the brand through
  // (?pitchBrand=<id>&pitchBrandName=<name>) so units get a one-tap
  // "add as target" instead of re-finding the brand by hand (UX #15).
  const [pitchBrand, setPitchBrand] = useState<{ id: string; name: string } | null>(() => {
    try {
      const ps = new URLSearchParams(window.location.search);
      const id = ps.get("pitchBrand"); const name = ps.get("pitchBrandName");
      return id && name ? { id, name } : null;
    } catch { return null; }
  });
  // Column show/hide, mirroring the WIP report's Deal Detail Columns menu.
  // Checkbox + Property/Unit + Target Tenant + Actions always stay.
  const LETTING_COLS: { key: string; label: string }[] = [
    { key: "ref", label: "Ref" },
    { key: "existingTenant", label: "Existing Tenant" },
    { key: "unitStatus", label: "Unit Status" },
    { key: "pipelineStatus", label: "Deal Status" },
    { key: "client", label: "Client" },
    { key: "dealStatus", label: "Target Status" },
    { key: "category", label: "Category" },
    { key: "priority", label: "Priority" },
    { key: "agent", label: "Agent" },
    { key: "comments", label: "Comments" },
    { key: "areaCosts", label: "Area & Costs" },
  ];
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem("bgp_letting_hidden_cols") || "[]")); } catch { return new Set(); }
  });
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const showCol = (k: string) => !hiddenCols.has(k);
  const toggleColVis = (k: string) => setHiddenCols((prev) => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    try { localStorage.setItem("bgp_letting_hidden_cols", JSON.stringify([...n])); } catch {}
    return n;
  });
  const [propertyFilter, setPropertyFilter] = useState(() => urlParam("propertyId"));
  const [assetClassFilter, setAssetClassFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [bgpTeamFilter, setBgpTeamFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [unifiedAddOpen, setUnifiedAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<AvailableUnit | null>(null);
  const [deleteItem, setDeleteItem] = useState<AvailableUnit | null>(null);
  const [matchItem, setMatchItem] = useState<AvailableUnit | null>(null);
  const [linkDealOpen, setLinkDealOpen] = useState<AvailableUnit | null>(null);
  const [linkDealId, setLinkDealId] = useState("");
  const [form, setForm] = useState<UnitFormState>(emptyForm);
  // Fee split for the auto-created deal — same shape as Add Deal so a
  // unit lands with BGP House + agent rows pre-baked rather than empty.
  const [unitFeeRows, setUnitFeeRows] = useState<FeeAllocationRow[]>([]);
  const [unitFeeAllocType, setUnitFeeAllocType] = useState<"percentage" | "fixed">("percentage");
  // Mirror Add Deal's "Show all fields" toggle — minor fields (Rates,
  // Service Charge, Use Class, Condition, EPC, Location, Marketing
  // Start Date, Restrictions) collapse behind it.
  const [showAllUnitFields, setShowAllUnitFields] = useState(false);
  const [filesUnit, setFilesUnit] = useState<AvailableUnit | null>(null);
  const [hotsUnit, setHotsUnit] = useState<AvailableUnit | null>(null);
  const [briefUnit, setBriefUnit] = useState<AvailableUnit | null>(null);
  // Unit-name rename is behind the pencil (UX #24) — a bare name click opens
  // the targeting brief instead of dropping straight into an edit input.
  const [renameUnitId, setRenameUnitId] = useState<string | null>(null);
  const [viewingsUnit, setViewingsUnit] = useState<AvailableUnit | null>(null);
  const [interestUnit, setInterestUnit] = useState<AvailableUnit | null>(null);
  const [offersUnit, setOffersUnit] = useState<AvailableUnit | null>(null);
  // Provenance pop-outs: the email an offer/interest row was detected from,
  // and the diary event behind a viewing.
  const [sourceEmail, setSourceEmail] = useState<{ kind: "offer" | "interest"; id: string; title: string } | null>(null);
  const [sourceEvent, setSourceEvent] = useState<{ kind: "viewing" | "interest"; id: string } | null>(null);
  const [addingTargetFrom, setAddingTargetFrom] = useState<string | null>(null);
  const [addViewingOpen, setAddViewingOpen] = useState(false);
  const [addOfferOpen, setAddOfferOpen] = useState(false);
  // Most viewings are logged the day they happen, so the date defaults to
  // today (still editable). Editing ids switch the add forms into edit mode.
  const emptyViewingForm = () => ({ companyName: "", companyId: "", contactName: "", contactId: "", viewingDate: new Date().toISOString().slice(0, 10), viewingTime: "", attendees: "", notes: "", outcome: "" });
  const emptyOfferForm = () => ({ companyName: "", companyId: "", contactName: "", contactId: "", offerDate: new Date().toISOString().slice(0, 10), rentPa: "", rentFreeMonths: "", termYears: "", breakOption: "", incentives: "", premium: "", fittingOutContribution: "", comments: "" });
  const [viewingForm, setViewingForm] = useState(emptyViewingForm);
  const [offerForm, setOfferForm] = useState(emptyOfferForm);
  const [editingViewingId, setEditingViewingId] = useState<string | null>(null);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [companySearchOpen, setCompanySearchOpen] = useState<"viewing" | "offer" | null>(null);
  const [contactSearchOpen, setContactSearchOpen] = useState<"viewing" | "offer" | null>(null);
  const [wipUnit, setWipUnit] = useState<AvailableUnit | null>(null);
  const [wipForm, setWipForm] = useState({
    dealType: "New Letting",
    team: [] as string[],
    agent: "",
    // Tenant brand (crm_companies.id) + cached display name. Replaces the
    // old free-text tenantName so AML can fire on a real company link
    // rather than a string lookup. Tenant Xero entity is the billing /
    // legal entity for invoicing.
    tenantId: "",
    tenantName: "",
    tenantEntityId: "",
    tenantEntityName: "",
    // Landlord Xero entity — landlord brand is derived from the
    // property (crm_properties.landlord_id) and shown read-only.
    landlordEntityId: "",
    landlordEntityName: "",
    fee: "",
    feeAgreement: "",
    askingRent: "",
    totalAreaSqft: "",
    leaseLength: "",
    rentFree: "",
    targetDate: "", // expected completion — mandatory so WIP report buckets correctly
    comments: "",
    amlChecked: "",      // YES | NO | N-A — soft-required at SOL
    overrideCompliance: false, // user-acknowledged shipping despite incomplete AML/fee agreement
  });
  // Fee split is the same shape the deal form collects — BGP House 15% +
  // agents on the remaining 85%. FeeAllocationEditor auto-injects BGP
  // House if missing, so starting empty is safe.
  const [wipFeeRows, setWipFeeRows] = useState<FeeAllocationRow[]>([]);
  const [wipFeeAllocType, setWipFeeAllocType] = useState<"percentage" | "fixed">("percentage");
  const { toast } = useToast();

  // The two live collaborative datasets poll faster than the app default
  // (30s felt laggy in team sessions — edits took half a minute to appear
  // on colleagues' screens). Reference data below stays on defaults.
  const { data: units = [], isLoading } = useQuery<AvailableUnit[]>({
    queryKey: ["/api/available-units"],
    refetchInterval: 10_000,
    staleTime: 3_000,
  });

  // Pitch mode: the "+ <brand>" button sits in the Target Tenant cell, which
  // at 1440px-and-below starts out UNDER the sticky Actions & Activity column
  // — the banner told users to click a button they couldn't see. Scroll the
  // table sideways once so the first pitch button clears the pinned column.
  const pitchScrolledRef = useRef(false);
  useEffect(() => {
    if (!pitchBrand || isLoading || pitchScrolledRef.current) return;
    const t = setTimeout(() => {
      const btn = document.querySelector('[data-testid^="pitch-here-"]');
      const container = btn?.closest<HTMLElement>(".table-scroll-container");
      if (!btn || !container) return;
      pitchScrolledRef.current = true;
      const stickyCol = container.querySelector<HTMLElement>("th.sticky");
      const stickyW = stickyCol ? stickyCol.getBoundingClientRect().width : 205;
      const visibleRight = container.getBoundingClientRect().right - stickyW - 12;
      const overhang = btn.getBoundingClientRect().right - visibleRight;
      if (overhang > 0) container.scrollLeft += overhang;
    }, 400);
    return () => clearTimeout(t);
  }, [pitchBrand, isLoading, units.length]);

  // Client logins get a one-line explainer of what the tracker is for.
  const { data: auUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClientTracker = auUser?.role === "Client";

  const { data: properties = [] } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });

  const { data: propertyUnits = [] } = useQuery<PropertyUnit[]>({
    queryKey: ["/api/property-units"],
    enabled: !isClientTracker, // staff-only master-unit cache; 403s for clients
  });

  const { data: deals = [] } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals"],
    refetchInterval: 10_000,
    staleTime: 3_000,
  });

  const { data: bgpUsers = [] } = useQuery<{ id: string; name: string; team?: string; additionalTeams?: string[] }[]>({
    queryKey: ["/api/users"],
  });

  const { data: crmCompanies = [] } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
  });

  const { data: crmContacts = [] } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
  });

  const { data: favoriteIds = [] } = useQuery<string[]>({
    queryKey: ["/api/favorite-instructions"],
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: async (propertyId: string) => {
      const isFav = favoriteIds.includes(propertyId);
      if (isFav) {
        await apiRequest("DELETE", `/api/favorite-instructions/${propertyId}`);
      } else {
        await apiRequest("POST", `/api/favorite-instructions/${propertyId}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorite-instructions"] });
    },
  });

  const { data: allViewings = [] } = useQuery<UnitViewing[]>({
    queryKey: ["/api/available-units/all-viewings"],
  });

  const { data: allInterest = [] } = useQuery<any[]>({
    queryKey: ["/api/available-units/all-interest"],
  });
  const { data: interestCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/available-units/all-interest-counts"],
  });
  const { data: allOffers = [] } = useQuery<UnitOffer[]>({
    queryKey: ["/api/available-units/all-offers"],
  });

  const { data: viewingsCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/available-units/all-viewings-counts"],
  });

  const { data: offersCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/available-units/all-offers-counts"],
  });

  // Existing fee-split allocations keyed by dealId. Used by the WIP-flip
  // dialog to pre-populate the FeeAllocationEditor when a deal already
  // has a split — otherwise the user gets the default 85/15 split on
  // every reopen and re-types what was already saved.
  const { data: allAllocations = {} } = useQuery<Record<string, Array<{ agentName: string; percentage: number | null; fixedAmount: number | null; allocationType: string; isBgpHouse: boolean }>>>({
    queryKey: ["/api/crm/fee-allocations"],
  });

  const { data: viewingsForUnit = [] } = useQuery<UnitViewing[]>({
    queryKey: ["/api/available-units", viewingsUnit?.id, "viewings"],
    queryFn: () => viewingsUnit ? fetch(`/api/available-units/${viewingsUnit.id}/viewings`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()) : Promise.resolve([]),
    enabled: !!viewingsUnit,
  });

  const { data: offersForUnit = [] } = useQuery<UnitOffer[]>({
    queryKey: ["/api/available-units", offersUnit?.id, "offers"],
    queryFn: () => offersUnit ? fetch(`/api/available-units/${offersUnit.id}/offers`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()) : Promise.resolve([]),
    enabled: !!offersUnit,
  });

  const { data: interestForUnit = [] } = useQuery<any[]>({
    queryKey: ["/api/available-units", interestUnit?.id, "interest"],
    queryFn: () => interestUnit ? fetch(`/api/available-units/${interestUnit.id}/interest`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()) : Promise.resolve([]),
    enabled: !!interestUnit,
  });

  const deleteInterestMutation = useMutation({
    mutationFn: (interestId: string) => apiRequest("DELETE", `/api/available-units/interest/${interestId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", interestUnit?.id, "interest"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-interest-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-interest"] });
      toast({ title: "Interest removed" });
    },
  });

  // Manual interest log (UX #71) — a phone call couldn't be recorded before;
  // rows only arrived via the inbox sweep.
  const emptyInterestForm = () => ({ companyName: "", companyId: "", contactName: "", contactId: "", interestDate: new Date().toISOString().slice(0, 10), notes: "" });
  const [interestForm, setInterestForm] = useState(emptyInterestForm());
  const addInterestMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/available-units/${interestUnit?.id}/interest`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", interestUnit?.id, "interest"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-interest-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-interest"] });
      setInterestForm(emptyInterestForm());
      toast({ title: "Interest logged" });
    },
    onError: (e: any) => toast({ title: "Couldn't log interest", description: e?.message, variant: "destructive" }),
  });

  const addViewingMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/available-units/${viewingsUnit?.id}/viewings`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", viewingsUnit?.id, "viewings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-viewings-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-viewings"] });
      setAddViewingOpen(false);
      setViewingForm(emptyViewingForm());
      toast({ title: "Viewing added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateViewingMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/available-units/viewings/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", viewingsUnit?.id, "viewings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-viewings"] });
      setAddViewingOpen(false);
      setEditingViewingId(null);
      setViewingForm(emptyViewingForm());
      toast({ title: "Viewing updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteViewingMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/available-units/viewings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", viewingsUnit?.id, "viewings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-viewings-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-viewings"] });
      toast({ title: "Viewing removed" });
    },
    onError: (e: any) => toast({ title: "Couldn't remove viewing", description: e.message, variant: "destructive" }),
  });

  const addOfferMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/available-units/${offersUnit?.id}/offers`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", offersUnit?.id, "offers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-offers-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-offers"] });
      setAddOfferOpen(false);
      setOfferForm(emptyOfferForm());
      toast({ title: "Offer added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateOfferMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/available-units/offers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", offersUnit?.id, "offers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-offers"] });
      setAddOfferOpen(false);
      setEditingOfferId(null);
      setOfferForm(emptyOfferForm());
      toast({ title: "Offer updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteOfferMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/available-units/offers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", offersUnit?.id, "offers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-offers-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-offers"] });
      toast({ title: "Offer removed" });
    },
    onError: (e: any) => toast({ title: "Couldn't remove offer", description: e.message, variant: "destructive" }),
  });

  const { data: filesForUnit = [] } = useQuery<UnitMarketingFile[]>({
    queryKey: ["/api/available-units", filesUnit?.id, "files"],
    queryFn: () => filesUnit ? fetch(`/api/available-units/${filesUnit.id}/files`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()) : Promise.resolve([]),
    enabled: !!filesUnit,
  });

  const propertyMap = useMemo(() => {
    const m: Record<string, CrmProperty> = {};
    for (const p of properties) m[p.id] = p;
    return m;
  }, [properties]);

  const teamFilteredPropertyIds = useMemo(() => {
    if (!activeTeam || activeTeam === "all") return null;
    const isInternal = [...INTERNAL_BGP_TEAMS].some(t => t.toLowerCase() === (activeTeam as string).toLowerCase() || (activeTeam as string).toLowerCase().startsWith(t.toLowerCase()));
    if (isInternal) return null;
    const norm = (activeTeam as string).toLowerCase().replace(/\s+/g, "");
    const matchingCompanyIds = new Set(
      crmCompanies
        .filter(c => c.name && c.name.toLowerCase().replace(/\s+/g, "") === norm)
        .map(c => c.id)
    );
    if (matchingCompanyIds.size === 0) return null;
    return new Set(
      properties
        .filter(p => p.landlordId && matchingCompanyIds.has(p.landlordId))
        .map(p => p.id)
    );
  }, [activeTeam, crmCompanies, properties]);

  const teamUnits = useMemo(() => {
    if (!teamFilteredPropertyIds) return units;
    return units.filter(u => teamFilteredPropertyIds.has(u.propertyId));
  }, [units, teamFilteredPropertyIds]);

  // Hide the Client column whenever the view is pinned to one client —
  // client logins, staff viewing-as-client, the sidebar team switched to a
  // client team (Landsec), or the toolbar team filter set to one: every
  // row is that client, so the column says nothing.
  const targetBlockSpan = 1 + ["dealStatus", "category", "priority", "agent", "comments"].filter((k) => showCol(k)).length;
  const hideClientCol = isClientTracker
    || !!(auUser as any)?.companyScopeId
    || !!teamFilteredPropertyIds
    || (bgpTeamFilter !== "all" && !(INTERNAL_BGP_TEAMS as Set<string>).has(bgpTeamFilter));

  const dealMap = useMemo(() => {
    const m: Record<string, CrmDeal> = {};
    for (const d of deals) m[d.id] = d;
    return m;
  }, [deals]);

  // Effective pipeline code per unit: the linked deal's status when a deal
  // exists (the deal drives the process), else the unit's own marketing
  // status. Boards, chips, grouping and filters all key off this.
  const effByUnit = useMemo(() => {
    const m: Record<string, DealStatusCode> = {};
    for (const u of units) {
      const d = u.dealId ? dealMap[u.dealId] : null;
      m[u.id] = (d ? legacyToCode(d.status) : null) || legacyToCode(u.marketingStatus) || "AVA";
    }
    return m;
  }, [units, dealMap]);

  // Landlord for the Edit Unit dialog: the unit row doesn't carry one, so
  // fall back to the linked deal's landlord, then the property's.
  const landlordPrefillFor = (u: AvailableUnit): { id: string; name: string } | null => {
    const deal = u.dealId ? dealMap[u.dealId] : null;
    const id = (deal as any)?.landlordId || (propertyMap[u.propertyId] as any)?.landlordId || "";
    if (!id) return null;
    return { id, name: crmCompanies.find(c => c.id === id)?.name || "" };
  };

  const unitsByProperty = useMemo(() => {
    const m: Record<string, PropertyUnit[]> = {};
    for (const pu of propertyUnits) {
      (m[pu.propertyId] = m[pu.propertyId] || []).push(pu);
    }
    return m;
  }, [propertyUnits]);

  const unitMasterById = useMemo(() => {
    const m: Record<string, PropertyUnit> = {};
    for (const pu of propertyUnits) m[pu.id] = pu;
    return m;
  }, [propertyUnits]);

  const userMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of bgpUsers) m[u.id] = u.name;
    return m;
  }, [bgpUsers]);

  const companyMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of crmCompanies) m[c.id] = c.name;
    return m;
  }, [crmCompanies]);

  const createMutation = useMutation({
    mutationFn: async ({ data, feeRows, feeAllocType }: { data: any; feeRows: FeeAllocationRow[]; feeAllocType: "percentage" | "fixed" }) => {
      const res = await apiRequest("POST", "/api/available-units", data);
      const unit = await res.json();
      // The server auto-creates a backing deal and stamps its id on the
      // unit. Fold the user's fee split onto that deal so it lands with
      // BGP House + agents pre-baked instead of empty (which used to
      // require re-opening the deal to lock in).
      const dealId = unit?.dealId;
      if (dealId && feeRows.length > 0) {
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
            await apiRequest("PUT", `/api/crm/deals/${dealId}/fee-allocations`, { allocations });
          } catch (e: any) {
            toast({
              title: "Unit added, fee split failed to save",
              description: e?.message || "Open the deal to set the split there.",
              variant: "destructive",
            });
          }
        }
      }
      return unit;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      invalidateDealCaches();
      setCreateOpen(false);
      setForm(emptyForm);
      setUnitFeeRows([]);
      setUnitFeeAllocType("percentage");
      setShowAllUnitFields(false);
      toast({ title: "Unit added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/available-units/${id}`, data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      // Master fields (floor/sqft/useClass/condition/epcRating/unitName) flow to
      // property_units server-side, so refresh that cache too.
      queryClient.invalidateQueries({ queryKey: ["/api/property-units"] });
      // Three-way status mirror: marketing-status edits propagate to the
      // linked crm_deal + leasing_schedule_unit server-side. Invalidate
      // those caches too so the other boards reflect the change live.
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property"] });
      setEditItem(null);
      if (data?.mirrorWarning) {
        toast({ title: "Cross-board sync warning", description: data.mirrorWarning, variant: "destructive" });
      } else {
        toast({ title: "Unit updated" });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/available-units/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      setDeleteItem(null);
      toast({ title: "Unit deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => apiRequest("DELETE", `/api/available-units/${id}`)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      // Bulk delete cascades to crm_deals + leasing schedule via the
      // server-side cleanup. Refresh sibling boards so they don't show
      // ghost rows.
      invalidateDealCaches();
      const count = selectedIds.size;
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      toast({ title: `${count} unit${count !== 1 ? "s" : ""} deleted` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const results = await Promise.all(ids.map(async id => {
        const res = await apiRequest("PATCH", `/api/available-units/${id}`, { marketingStatus: status });
        return res.json();
      }));
      return results;
    },
    onSuccess: (results: any[]) => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      // Status PATCH triggers the 4-way mirror server-side — refresh the
      // sibling boards so Deals + Leasing Schedule + Tenancy reflect.
      invalidateDealCaches();
      setSelectedIds(new Set());
      const warned = results.find(r => r?.mirrorWarning);
      if (warned) {
        toast({ title: "Cross-board sync warning", description: warned.mirrorWarning, variant: "destructive" });
      } else {
        toast({ title: "Status updated" });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const dealInlineUpdate = useMutation({
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
    onError: (e: any) => toast({ title: "Error saving", description: e.message, variant: "destructive" }),
  });

  const createPropertyUnitMutation = useMutation({
    mutationFn: async (data: { propertyId: string; unitName: string; floor?: string | null; sqft?: number | null }) => {
      const res = await apiRequest("POST", "/api/property-units", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/property-units"] });
    },
    onError: (e: any) => toast({ title: "Error creating unit", description: e.message, variant: "destructive" }),
  });

  // Pick an existing master unit (by id) for a listing, or create one and link.
  // Keeps listing.unitId, listing.unitName, deal.unitId, and deal.name in sync.
  const pickOrCreateUnit = async (
    listing: AvailableUnit,
    selection: { unitId: string } | { newName: string }
  ) => {
    let unitId: string | null = null;
    let unitName: string;

    if ("unitId" in selection) {
      const pu = unitMasterById[selection.unitId];
      if (!pu) return;
      unitId = pu.id;
      unitName = pu.unitName;
    } else {
      const trimmed = selection.newName.trim();
      if (!trimmed) return;
      // Reuse if a unit with this name already exists on the property
      const existing = (unitsByProperty[listing.propertyId] || []).find(
        u => u.unitName.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (existing) {
        unitId = existing.id;
        unitName = existing.unitName;
      } else {
        const created = await createPropertyUnitMutation.mutateAsync({
          propertyId: listing.propertyId,
          unitName: trimmed,
          floor: listing.floor || null,
          sqft: listing.sqft ?? null,
        });
        unitId = created.id;
        unitName = trimmed;
      }
    }

    updateMutation.mutate({ id: listing.id, data: { unitId, unitName } });
    if (listing.dealId) {
      const prop = propertyMap[listing.propertyId];
      const dealName = prop ? `${prop.name} – ${unitName}` : unitName;
      dealInlineUpdate.mutate({ id: listing.dealId, field: "unitId", value: unitId });
      dealInlineUpdate.mutate({ id: listing.dealId, field: "name", value: dealName });
    }
  };

  const linkDealMutation = useMutation({
    mutationFn: ({ id, dealId }: { id: string; dealId: string }) =>
      apiRequest("POST", `/api/available-units/${id}/link-deal`, { dealId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      setLinkDealOpen(null);
      setLinkDealId("");
      toast({ title: "Deal linked" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createDealMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/available-units/${id}/create-deal`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      invalidateDealCaches();
      toast({ title: "Deal created and linked" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const wipDealMutation = useMutation({
    mutationFn: async ({ unitId, data, feeRows, feeAllocType }: { unitId: string; data: any; feeRows: FeeAllocationRow[]; feeAllocType: "percentage" | "fixed" }) => {
      const res = await apiRequest("POST", `/api/available-units/${unitId}/create-deal`, data);
      const json = await res.json();
      const dealId = json?.deal?.id;
      // Persist fee allocations alongside the promote, same shape the
      // deal-form mutation uses. Empty list = no split set yet (fall
      // back to whatever was on the deal previously).
      if (dealId && feeRows.length > 0) {
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
            await apiRequest("PUT", `/api/crm/deals/${dealId}/fee-allocations`, { allocations });
          } catch (e: any) {
            toast({
              title: "Promoted, but fee split failed to save",
              description: e?.message || "Open the deal to set the split there.",
              variant: "destructive",
            });
          }
        }
      }
      return json;
    },
    onSuccess: (json: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      invalidateDealCaches();
      setWipUnit(null);
      // Surface the server's AML warn-but-allow result. Promotion went
      // through, but some counterparties are still missing KYC — flag it
      // so Layla can chase before the deal reaches exchange.
      if (json?.amlWarning?.message) {
        toast({
          title: "Promoted — AML follow-up needed",
          description: json.amlWarning.message,
          variant: "destructive",
        });
      } else {
        toast({ title: "Promoted to Solicitors" });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openWipDialog = (unit: AvailableUnit) => {
    const prop = propertyMap[unit.propertyId];
    // Pre-fill from the linked deal if there is one — that's the common path
    // now that Add Unit auto-creates a deal at AVA. User just updates the
    // fields that matter at the SOL handover.
    const existingDeal = unit.dealId ? dealMap[unit.dealId] : null;
    setWipForm({
      // Map legacy "Letting" (pre-fix) → canonical "New Letting" so the
      // dropdown shows a real value for older flipped deals.
      dealType: (existingDeal?.dealType === "Letting" ? "New Letting" : existingDeal?.dealType) || "New Letting",
      team: Array.isArray(existingDeal?.team) ? existingDeal.team : (existingDeal?.team ? [existingDeal.team] : []),
      agent: (Array.isArray(existingDeal?.internalAgent) && existingDeal.internalAgent[0]) || "",
      tenantId: existingDeal?.tenantId || "",
      tenantName: crmCompanies.find(c => c.id === existingDeal?.tenantId)?.name || "",
      tenantEntityId: (existingDeal as any)?.tenantEntityId || "",
      tenantEntityName: (existingDeal as any)?.tenantEntityName || "",
      landlordEntityId: (existingDeal as any)?.landlordEntityId || "",
      landlordEntityName: (existingDeal as any)?.landlordEntityName || "",
      fee: (existingDeal?.fee ?? unit.fee)?.toString() || "",
      feeAgreement: existingDeal?.feeAgreement || "",
      askingRent: (existingDeal?.rentPa ?? unit.askingRent)?.toString() || "",
      totalAreaSqft: (existingDeal?.totalAreaSqft ?? unit.sqft)?.toString() || "",
      leaseLength: existingDeal?.leaseLength?.toString() || "",
      rentFree: existingDeal?.rentFree?.toString() || "",
      targetDate: existingDeal?.targetDate
        ? new Date(existingDeal.targetDate).toISOString().slice(0, 10)
        : "",
      comments: existingDeal?.comments || `${prop?.name || "Property"} — ${unit.unitName}${unit.floor ? ` (${unit.floor})` : ""}`,
      amlChecked: existingDeal?.amlCheckCompleted || "",
      overrideCompliance: false,
    });
    // Pre-populate the fee-split editor from the deal's existing
    // allocations when present — otherwise the user gets the default
    // 85% agent / 15% BGP House split on every reopen and has to
    // re-type what they already saved. BGP House rows are dropped from
    // the seed since the editor auto-injects that row itself.
    const existingAllocs = existingDeal?.id ? allAllocations[existingDeal.id] : null;
    if (existingAllocs && existingAllocs.length > 0) {
      const agentRows = existingAllocs
        .filter(a => !a.isBgpHouse)
        .map(a => ({
          agentName: a.agentName,
          allocationType: (a.allocationType === "fixed" ? "fixed" : "percentage") as "fixed" | "percentage",
          percentage: a.percentage || 0,
          fixedAmount: a.fixedAmount || 0,
        }));
      setWipFeeRows(agentRows);
      setWipFeeAllocType((existingAllocs.find(a => !a.isBgpHouse)?.allocationType === "fixed" ? "fixed" : "percentage"));
    } else {
      // No existing split — fall back to picked agent at 85%; FeeAllocationEditor
      // auto-injects BGP House at 15% to make a complete 100%.
      const initialAgent = (Array.isArray(existingDeal?.internalAgent) && existingDeal.internalAgent[0]) || "";
      setWipFeeRows(initialAgent ? [{
        agentName: initialAgent,
        allocationType: "percentage",
        percentage: 85,
        fixedAmount: 0,
      }] : []);
      setWipFeeAllocType("percentage");
    }
    setWipUnit(unit);
  };

  const inlineUpdate = (id: string, field: string, value: any) => {
    if (typeof value === "number" && isNaN(value)) value = null;
    // Status → SOL always fires the promotion modal so the user captures the
    // SOL-handover fields (fee, fee agreement, tenant, lease length, rent free).
    // Pre-fill comes from the linked deal if it already exists.
    // Clients skip the WIP-capture dialog on the SOL flip — that's the BGP
    // fee/compliance handover, which stays internal. Their status change
    // just applies directly (the server strips fee fields anyway).
    if (field === "marketingStatus" && legacyToCode(value) === "SOL" && !isClientTracker) {
      const unit = units.find(u => u.id === id);
      if (unit) {
        openWipDialog(unit);
        return;
      }
    }
    // Server PATCH handler routes master-managed fields (unitName, floor, sqft,
    // useClass, condition, epcRating) to property_units when unit_id is set.
    updateMutation.mutate({ id, data: { [field]: value } });
  };

  // Inline "search and set up" — create the CRM record when the typed name
  // matches nothing, then return it so the cell can link it.
  const createProperty = async (name: string) => {
    const r = await apiRequest("POST", "/api/crm/properties", { name: name.trim() });
    const created = await r.json();
    queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
    toast({ title: "Property created", description: `${created.name} added to CRM.` });
    return { id: String(created.id), name: created.name };
  };
  const createCompany = async (name: string) => {
    const r = await apiRequest("POST", "/api/crm/companies", { name: name.trim() });
    const created = await r.json();
    queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
    toast({ title: "Company created", description: `${created.name} added to CRM.` });
    return { id: String(created.id), name: created.name };
  };

  // Briefs (with target operators) keyed by unit — the Tenant column shows
  // each unit's targets and lets you add one without opening the brief.
  const { data: allBriefs = [] } = useQuery<any[]>({
    queryKey: ["/api/unit-briefs"],
    staleTime: 30_000,
  });
  const briefByUnit = useMemo(() => {
    const m: Record<string, any> = {};
    for (const b of allBriefs) if (b.unitId && !m[b.unitId]) m[b.unitId] = b;
    return m;
  }, [allBriefs]);
  const invalidateBriefs = (unitId?: string) => {
    queryClient.invalidateQueries({ queryKey: ["/api/unit-briefs"] });
    if (unitId) queryClient.invalidateQueries({ queryKey: ["/api/available-units", unitId, "brief"] });
  };
  const ensureBriefFor = async (u: { id: string; unitName: string }): Promise<string> => {
    const existingId = briefByUnit[u.id]?.id;
    if (existingId) return existingId;
    const r = await apiRequest("POST", `/api/available-units/${u.id}/brief`, { title: `Operator Targeting — ${u.unitName}` });
    return (await r.json()).id;
  };
  const addUnitTarget = async (u: { id: string; unitName: string }, pick: BrandPick) => {
    try {
      const briefId = await ensureBriefFor(u);
      await apiRequest("POST", `/api/unit-briefs/${briefId}/targets`, {
        operatorName: pick.name,
        companyId: pick.companyId,
        category: pick.companyType && LETTING_CATEGORIES.includes(pick.companyType) ? pick.companyType : undefined,
        priority: "B",
        agentUserIds: auUser?.id ? [String(auUser.id)] : undefined,
      });
      invalidateBriefs(u.id);
      toast({ title: "Target added", description: pick.name });
    } catch (e: any) {
      toast({ title: "Couldn't add target", description: e?.message, variant: "destructive" });
    }
  };

  // Interest → target operator. The server ensures the unit's brief, skips
  // duplicates, and carries every interest note for that brand across as the
  // target's rationale (AI-summarised when there's more than one).
  const addTargetFromInterest = async (i: any) => {
    setAddingTargetFrom(i.id);
    try {
      const r = await apiRequest("POST", `/api/tracker/interest/${i.id}/add-target`);
      const out = await r.json();
      if (out.alreadyTarget) {
        toast({ title: `${out.operatorName} is already a target on this unit` });
      } else {
        toast({ title: "Added to target operators", description: `${out.operatorName} — interest notes carried over` });
      }
      if (interestUnit) invalidateBriefs(interestUnit.id);
    } catch (e: any) {
      toast({ title: "Couldn't add the target", description: e?.message, variant: "destructive" });
    } finally {
      setAddingTargetFrom(null);
    }
  };

  const uniqueProperties = useMemo(() => {
    const ids = new Set(teamUnits.map(u => u.propertyId));
    return properties.filter(p => ids.has(p.id));
  }, [teamUnits, properties]);

  // Toolbar filters only (team / property / location / agent / target /
  // search) — WITHOUT the status pill. The KPI lozenges count from this
  // set so they always mirror the toolbar; the status pill then applies
  // on top for the table.
  const toolbarFiltered = useMemo(() => {
    let result = teamUnits;
    if (propertyFilter !== "all") result = result.filter(u => u.propertyId === propertyFilter);
    if (assetClassFilter !== "all") result = result.filter(u => u.useClass === assetClassFilter);
    if (locationFilter !== "all") result = result.filter(u => u.location === locationFilter);
    if (bgpTeamFilter !== "all") {
      const teamUserIds = new Set(
        bgpUsers
          .filter(bu => bu.team === bgpTeamFilter || (bu.additionalTeams || []).includes(bgpTeamFilter))
          .map(bu => bu.id)
      );
      result = result.filter(u => Array.isArray(u.agentUserIds) && u.agentUserIds.some(id => teamUserIds.has(id)));
    }
    if (agentFilter !== "all") result = result.filter(u => Array.isArray(u.agentUserIds) && u.agentUserIds.includes(agentFilter));
    if (targetStatusFilter !== "all") {
      result = result.filter(u => (briefByUnit[u.id]?.targets || []).some((t: any) => (t.status || "Identified") === targetStatusFilter));
    }
    // FY strip chips filter to units with live interest (UX #31).
    if (activityFilter === "viewings") result = result.filter(u => (viewingsCounts[u.id] || 0) > 0);
    if (activityFilter === "offers") result = result.filter(u => (offersCounts[u.id] || 0) > 0);
    if (activityFilter === "interest") result = result.filter(u => (interestCounts[u.id] || 0) > 0);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(u => {
        const propName = propertyMap[u.propertyId]?.name || "";
        // Tenant name lives on the linked deal — resolve from dealMap →
        // crmCompanies. Without this, typing a tenant on the letting
        // tracker returns nothing.
        const linkedDeal = u.dealId ? dealMap[u.dealId] : null;
        const tenantName = linkedDeal?.tenantId
          ? (crmCompanies.find(c => c.id === linkedDeal.tenantId)?.name || "")
          : "";
        return u.unitName.toLowerCase().includes(q)
          || propName.toLowerCase().includes(q)
          || (u.floor || "").toLowerCase().includes(q)
          || tenantName.toLowerCase().includes(q);
      });
    }
    return result;
  }, [teamUnits, targetStatusFilter, briefByUnit, propertyFilter, assetClassFilter, locationFilter, bgpTeamFilter, agentFilter, bgpUsers, search, propertyMap, dealMap, crmCompanies, activityFilter, viewingsCounts, offersCounts, interestCounts]);

  const filtered = useMemo(() => {
    // The Letting Tracker is the marketing pipeline (REP / AVA / NEG). Once a
    // unit moves to Solicitors it lives on the Deals board; we hide SOL+ from
    // the default view here so the tracker stays focused. Users can still
    // click an SOL/EXC/COM lozenge to drill back in.
    const PRE_SOL_CODES = new Set(["OPP", "REP", "SPEC", "LIVE", "AVA", "NEG", "HOT"]);
    let result = viewAll
      ? [...toolbarFiltered]
      : statusFilter !== "all"
      ? toolbarFiltered.filter(u => (effByUnit[u.id] || "AVA") === statusFilter)
      : toolbarFiltered.filter(u => {
          const code = effByUnit[u.id] || "AVA";
          return PRE_SOL_CODES.has(code);
        });
    if (sortBy !== "none") {
      const clientNameFor = (u: AvailableUnit) => {
        const d = u.dealId ? dealMap[u.dealId] : null;
        const id = d
          ? ((d.dealType || "").toLowerCase().includes("tenant rep") ? d.tenantId : d.landlordId)
          : (propertyMap[u.propertyId] as any)?.landlordId;
        return id ? (crmCompanies.find(c => c.id === id)?.name || "") : "";
      };
      const keyFor = (u: AvailableUnit) => sortBy === "property"
        ? `${propertyMap[u.propertyId]?.name || ""} ${u.unitName || ""}`
        : clientNameFor(u);
      result = [...result].sort((a, b) => sortDir * keyFor(a).localeCompare(keyFor(b), "en-GB", { sensitivity: "base" }));
    }
    if (viewAll) {
      // Status is the primary grouping key; the stable sort keeps any
      // property/client ordering from above within each group.
      const orderOf = (u: AvailableUnit) => {
        const i = MARKETING_STATUSES.indexOf(effByUnit[u.id] || "AVA");
        return i === -1 ? MARKETING_STATUSES.length : i;
      };
      result = [...result].sort((a, b) => orderOf(a) - orderOf(b));
    }
    return result;
  }, [toolbarFiltered, statusFilter, viewAll, sortBy, sortDir, propertyMap, dealMap, crmCompanies, effByUnit]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of MARKETING_STATUSES) counts[s] = 0;
    for (const u of teamUnits) {
      const code = effByUnit[u.id] || "AVA";
      counts[code] = (counts[code] || 0) + 1;
    }
    return counts;
  }, [teamUnits, effByUnit]);

  const activeAssetClasses = useMemo(() => {
    const classes = new Set<string>();
    for (const u of teamUnits) if (u.useClass) classes.add(u.useClass);
    return USE_CLASSES.filter(c => classes.has(c));
  }, [teamUnits]);

  const agentOptions = useMemo(() => {
    return bgpUsers.map(u => ({ value: u.id, label: u.name }));
  }, [bgpUsers]);

  const activeAgents = useMemo(() => {
    const ids = new Set<string>();
    for (const u of teamUnits) for (const id of (Array.isArray(u.agentUserIds) ? u.agentUserIds : [])) ids.add(id);
    return bgpUsers.filter(u => ids.has(u.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [teamUnits, bgpUsers]);

  const activeBgpTeams = useMemo(() => {
    const teams = new Set<string>();
    for (const u of activeAgents) {
      if (u.team) teams.add(u.team);
      for (const t of u.additionalTeams || []) teams.add(t);
    }
    return [...teams].sort();
  }, [activeAgents]);

  const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
  const FY_MONTH_NUMS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

  const currentFYStart = useMemo(() => {
    const now = new Date();
    return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  }, []);

  const viewingsMonthly = useMemo(() => {
    const buckets: number[] = new Array(12).fill(0);
    for (const v of allViewings) {
      if (!v.viewingDate) continue;
      const d = new Date(v.viewingDate);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      const fyIdx = FY_MONTH_NUMS.indexOf(m);
      if (fyIdx === -1) continue;
      const expectedYear = m >= 4 ? currentFYStart : currentFYStart + 1;
      if (y === expectedYear) buckets[fyIdx]++;
    }
    return buckets;
  }, [allViewings, currentFYStart]);

  const offersMonthly = useMemo(() => {
    const buckets: number[] = new Array(12).fill(0);
    for (const o of allOffers) {
      if (!o.offerDate) continue;
      const d = new Date(o.offerDate);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      const fyIdx = FY_MONTH_NUMS.indexOf(m);
      if (fyIdx === -1) continue;
      const expectedYear = m >= 4 ? currentFYStart : currentFYStart + 1;
      if (y === expectedYear) buckets[fyIdx]++;
    }
    return buckets;
  }, [allOffers, currentFYStart]);

  const interestMonthly = useMemo(() => {
    const buckets: number[] = new Array(12).fill(0);
    for (const i of allInterest) {
      if (!i.interestDate) continue;
      const d = new Date(i.interestDate);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      const fyIdx = FY_MONTH_NUMS.indexOf(m);
      if (fyIdx === -1) continue;
      const expectedYear = m >= 4 ? currentFYStart : currentFYStart + 1;
      if (y === expectedYear) buckets[fyIdx]++;
    }
    return buckets;
  }, [allInterest, currentFYStart]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="available-units-page">
      <div className="sticky top-0 z-10 bg-background -mx-4 md:-mx-6 px-4 md:px-6 -mt-4 md:-mt-6 pt-4 md:pt-6 pb-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Letting Tracker</h1>
          <p className="text-sm text-muted-foreground">
            {/* Recount under active search/filters — the header disagreeing
                with the chips/table was the same class as the deals-board
                "All" chip fix (UX #63). */}
            {filtered.length !== teamUnits.length
              ? `${filtered.length} of ${teamUnits.length} units`
              : `${teamUnits.length} unit${teamUnits.length !== 1 ? "s" : ""}`}
            {isClientTracker && (
              <span> — live deals in progress: units being marketed, under offer and completing. Updates flow to the Leasing Schedule and back to the Tenancy Schedule.</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
        {auUser?.isAdmin && (
          <Button
            variant="outline"
            onClick={async () => {
              // Dry-run first, then a numbers-in-hand confirm before touching data.
              try {
                const r = await apiRequest("POST", "/api/admin/letting-tracker-focus", { dryRun: true });
                const plan = await r.json();
                const msg = `Focus the tracker on units in play?\n\n` +
                  `Keep: ${plan.keep}\nRemove idle rows: ${plan.prune}\nPull in from strategy boards: ${plan.pullIn}\nTargets to migrate: ${plan.targetsToMigrate}\n\n` +
                  `Idle rows have no viewings, offers, files, targets, live deal or strategy-board activity. ` +
                  `Their tenancy (rent roll) rows are untouched and can be re-listed any time.`;
                if (!window.confirm(msg)) return;
                const r2 = await apiRequest("POST", "/api/admin/letting-tracker-focus", { dryRun: false });
                const done = await r2.json();
                toast({ title: "Tracker focused", description: `Removed ${done.pruned}, pulled in ${done.added}, migrated ${done.migrated} targets.` });
                queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
                queryClient.invalidateQueries({ queryKey: ["/api/unit-briefs"] });
                queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
              } catch (e: any) {
                toast({ title: "Tracker focus failed", description: e?.message, variant: "destructive" });
              }
            }}
            data-testid="button-focus-tracker"
          >
            <Target className="h-4 w-4 mr-1" /> Focus tracker
          </Button>
        )}
        <Button
          onClick={() => {
            // Stage 3b feature flag — when on, the new unified dialog opens
            // instead of the legacy UnitFormDialog. Old dialog stays code-
            // present for fallback / Stage 4 cleanup.
            if (UNIFIED_ADD_UNIT_ENABLED) {
              setUnifiedAddOpen(true);
            } else {
              setForm(emptyForm);
              setCreateOpen(true);
            }
          }}
          data-testid="button-add-unit"
        >
          <Plus className="h-4 w-4 mr-1" /> Add unit
        </Button>
        {!isMobile && (
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleCompactHeader}
            className="text-xs text-muted-foreground"
            title={compactHeader ? "Show the full header (FY activity + status cards)" : "Compact the header for more table room"}
            data-testid="button-compact-header"
          >
            {compactHeader ? <ChevronDown className="h-3.5 w-3.5 mr-1" /> : <ChevronUp className="h-3.5 w-3.5 mr-1" />}
            {compactHeader ? "Expand" : "Compact"}
          </Button>
        )}
        </div>
      </div>

      {/* Single thin FY activity strip — was two full cards stacked
          (~240px) with bar charts that were 16px tall and rarely
          scanned beyond the headline number. Now one row carrying the
          two totals + tiny sparkline of monthly counts. */}
      {!isMobile && !compactHeader && (
      <Card>
        <CardContent className="px-4 py-2.5 flex items-center gap-6 flex-wrap">
          <span className="text-xs text-muted-foreground">FY {currentFYStart}/{currentFYStart + 1}</span>
          {([
            { label: "Interest", icon: Flame,        data: interestMonthly, colour: "bg-violet-500", dim: "bg-violet-200 dark:bg-violet-800" },
            { label: "Viewings", icon: CalendarDays, data: viewingsMonthly, colour: "bg-blue-500", dim: "bg-blue-200 dark:bg-blue-800" },
            { label: "Offers",   icon: HandCoins,    data: offersMonthly,   colour: "bg-amber-500", dim: "bg-amber-200 dark:bg-amber-800" },
          ] as const).map(({ label, icon: Icon, data, colour, dim }) => {
            const total = data.reduce((a, b) => a + b, 0);
            const max = Math.max(...data, 1);
            const currentMonthIdx = FY_MONTH_NUMS.indexOf(new Date().getMonth() + 1);
            const filterKey = label === "Viewings" ? "viewings" as const : label === "Offers" ? "offers" as const : "interest" as const;
            return (
              <button
                type="button"
                key={label}
                onClick={() => setActivityFilter(activityFilter === filterKey ? null : filterKey)}
                className={`flex items-center gap-2.5 rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors hover:bg-muted/60 ${activityFilter === filterKey ? "ring-2 ring-primary/60 bg-primary/5" : ""}`}
                title={`Show only units with ${label.toLowerCase()}`}
                data-testid={`fy-chip-${filterKey}`}
              >
                <Icon className={`h-3.5 w-3.5 ${label === "Viewings" ? "text-blue-500" : label === "Offers" ? "text-amber-500" : "text-violet-500"}`} />
                <span className="text-xs font-semibold">{label}</span>
                <span className="text-sm font-bold tabular-nums">{total}</span>
                <div className="flex items-end gap-[2px] h-5" title={data.map((c, i) => `${FY_MONTHS[i]}: ${c}`).join(" · ")}>
                  {data.map((count, i) => (
                    <div
                      key={i}
                      className={`w-[6px] rounded-sm ${count > 0 ? (i === currentMonthIdx ? colour : dim) : "bg-muted"}`}
                      style={{ height: `${Math.max((count / max) * 100, 8)}%` }}
                    />
                  ))}
                </div>
              </button>
            );
          })}
          {activityFilter && (
            <span className="text-[11px] text-muted-foreground">
              showing units with {activityFilter} — click again to clear
            </span>
          )}
        </CardContent>
      </Card>
      )}

      {pitchBrand && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs" data-testid="pitch-brand-banner">
          <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>Pitching <span className="font-semibold">{pitchBrand.name}</span> — use the "+ {pitchBrand.name}" button on a unit to add them as a target operator.</span>
          <button
            type="button"
            className="ml-auto text-muted-foreground hover:text-foreground"
            onClick={() => { setPitchBrand(null); try { window.history.replaceState({}, "", window.location.pathname); } catch {} }}
            aria-label="Dismiss pitch banner"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search units, property or tenant..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-units"
          />
        </div>
        {!isMobile && (<>
        <Select value={propertyFilter} onValueChange={setPropertyFilter}>
          <SelectTrigger className="w-[220px]" data-testid="select-property-filter">
            <SelectValue placeholder="All Properties" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Properties</SelectItem>
            {uniqueProperties.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-location-filter">
            <SelectValue placeholder="All Locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {LOCATIONS.map(l => (
              <SelectItem key={l} value={l}>
                <span className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${LOCATION_COLORS[l] || "bg-gray-400"}`} />
                  {l}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Pill row removed — the status cards directly underneath
            already act as filter buttons (same setStatusFilter call)
            and carry counts too, so this row was duplicated UI. The
            cards now own status filtering on this page. */}
        {/* Teams + Agents are BGP-internal concepts — dead weight on a
            client's filter row (their work is one team; agents mean
            nothing to them). Property/location/status filters stay. */}
        {!isClientTracker && (<>
        <Select value={bgpTeamFilter} onValueChange={setBgpTeamFilter}>
          <SelectTrigger className="w-[170px]" data-testid="select-team-filter">
            <SelectValue placeholder="All Teams" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Teams</SelectItem>
            {activeBgpTeams.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="w-[170px]" data-testid="select-agent-filter">
            <SelectValue placeholder="All Agents" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Agents</SelectItem>
            {activeAgents.map(u => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        </>)}
        <Select value={targetStatusFilter} onValueChange={setTargetStatusFilter}>
          <SelectTrigger className="w-[170px]" data-testid="select-target-status-filter">
            <SelectValue placeholder="Deal status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Deal Statuses</SelectItem>
            {BRIEF_TARGET_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{targetStatusLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeAssetClasses.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground mr-0.5">Class:</span>
            {activeAssetClasses.map(c => (
              <button
                key={c}
                onClick={() => setAssetClassFilter(assetClassFilter === c ? "all" : c)}
                className={`${ASSET_CLASS_COLORS[c] || "bg-gray-500"} text-white text-[10px] font-medium px-2 py-0.5 rounded-full transition-all whitespace-nowrap ${
                  assetClassFilter === c ? "ring-2 ring-primary ring-offset-1 scale-105" : assetClassFilter !== "all" ? "opacity-40" : "hover:opacity-90"
                }`}
                data-testid={`filter-class-${c.toLowerCase().replace(/[() ]/g, "-")}`}
              >
                {c}
                {assetClassFilter === c && <X className="inline h-3 w-3 ml-0.5 -mr-0.5" />}
              </button>
            ))}
          </div>
        )}
        <div className="relative ml-auto">
          <button
            onClick={() => setColMenuOpen((o) => !o)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-600 hover:text-gray-900 border border-gray-200 rounded px-2 py-1 bg-white whitespace-nowrap"
            data-testid="letting-columns-button"
          >
            Columns{hiddenCols.size > 0 ? ` (${LETTING_COLS.length - hiddenCols.size}/${LETTING_COLS.length})` : ""}
          </button>
          {colMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setColMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-2 w-48 max-h-[320px] overflow-y-auto">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide px-1 pb-1">Show columns</p>
                {LETTING_COLS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-50 cursor-pointer text-xs text-gray-700">
                    <Checkbox checked={showCol(c.key)} onCheckedChange={() => toggleColVis(c.key)} className="h-4 w-4" data-no-min-touch />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        </>)}
      </div>

      {/* KPI stat cards — matching Investment Tracker style. Compact mode
          renders the thin chip row (same filters, ~1/3 the height). */}
      {(isMobile || compactHeader) ? (
        <div className="flex flex-wrap gap-1.5">
          <Pill
            active={viewAll}
            onClick={() => { setViewAll(!viewAll); setStatusFilter("all"); }}
            data-testid="stat-chip-all"
          >
            All <span className="opacity-70 font-mono tabular-nums">{toolbarFiltered.length}</span>
          </Pill>
          {MARKETING_STATUSES.map(s => {
            const count = toolbarFiltered.filter(u => (effByUnit[u.id] || "AVA") === s).length;
            return (
              <Pill
                key={s}
                active={statusFilter === s}
                onClick={() => { setViewAll(false); setStatusFilter(statusFilter === s ? "all" : s); }}
                data-testid={`stat-chip-${s.toLowerCase()}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_LABEL_COLORS[s] || "bg-gray-400"}`} />
                {DEAL_PIPELINE_LABELS[s]} <span className="opacity-70 font-mono tabular-nums">{count}</span>
              </Pill>
            );
          })}
        </div>
      ) : (
      <div className="w-full overflow-x-auto">
        <div className="flex items-center gap-1.5 pb-1">
          <Pill
            active={viewAll}
            onClick={() => { setViewAll(!viewAll); setStatusFilter("all"); }}
            data-testid="stat-card-all"
          >
            All statuses <span className="font-mono normal-case opacity-60 tabular-nums">{toolbarFiltered.length}</span>
          </Pill>
          {MARKETING_STATUSES.map(s => {
            const count = toolbarFiltered.filter(u => (effByUnit[u.id] || "AVA") === s).length;
            return (
              <Pill
                key={s}
                active={statusFilter === s}
                onClick={() => { setViewAll(false); setStatusFilter(statusFilter === s ? "all" : s); }}
                data-testid={`stat-card-${s.toLowerCase()}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_LABEL_COLORS[s] || "bg-gray-400"}`} />
                {DEAL_PIPELINE_LABELS[s]} <span className="font-mono normal-case opacity-60 tabular-nums">{count}</span>
              </Pill>
            );
          })}
        </div>
      </div>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border bg-background px-4 py-2 shadow-sm">
          <span className="text-sm font-medium">{selectedIds.size} unit{selectedIds.size !== 1 ? "s" : ""} selected</span>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} data-testid="bulk-clear-selection">
            <X className="w-3.5 h-3.5 mr-1" />Clear
          </Button>
          <div className="h-4 w-px bg-border" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="bulk-change-status">
                Change Status<ChevronDown className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {/* SOL is excluded from bulk — flipping to Solicitors needs
                  the WIP-capture modal (tenant, landlord, fee split,
                  AML check) that the inline per-row path runs. Bulk
                  flipping skipped all of that and let deals land in
                  SOL with no counterparties. */}
              {MARKETING_STATUSES.filter(s => s !== "SOL").map(s => (
                <DropdownMenuItem
                  key={s}
                  onClick={() => bulkStatusMutation.mutate({ ids: Array.from(selectedIds), status: s })}
                  data-testid={`bulk-status-${s.toLowerCase()}`}
                >
                  <span className={`w-2 h-2 rounded-full mr-2 ${STATUS_LABEL_COLORS[s] || "bg-gray-400"}`} />
                  {DEAL_PIPELINE_LABELS[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)} data-testid="bulk-delete-units">
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete
          </Button>
        </div>
      )}

      {isMobile && (
        filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <Store className="h-8 w-8 opacity-40" />
            <p className="text-sm">{teamUnits.length === 0 ? "No available units yet" : "No units match filters"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 pb-2">
            {filtered.map((u, idx) => {
              const prop = propertyMap[u.propertyId];
              const deal = u.dealId ? dealMap[u.dealId] : null;
              const code = effByUnit[u.id] || "AVA";
              const prevCode = idx > 0 ? (effByUnit[filtered[idx - 1].id] || "AVA") : null;
              const tenant = deal?.tenantId ? companyMap[deal.tenantId] : null;
              const rent = deal?.rentPa ?? (u as any).askingRent;
              const size = deal?.totalAreaSqft ?? u.sqft;
              const vCount = viewingsCounts[u.id] || 0;
              const oCount = offersCounts[u.id] || 0;
              // Area/Rent stay visible with "—" when unset so "not recorded"
              // reads as data, not a hidden field (UX #42); Tenant still
              // drops when there's no linked deal tenant.
              const rows = [
                { label: "Area", value: size ? `${Number(size).toLocaleString()} sq ft` : "—" },
                ...(tenant ? [{ label: "Tenant", value: tenant }] : []),
                { label: "Rent p.a.", value: rent ? `£${Number(rent).toLocaleString()}` : "—" },
              ];
              return (
                <Fragment key={u.id}>
                {viewAll && code !== prevCode && (
                  <div className="flex items-center gap-2 pt-2 text-xs font-semibold uppercase tracking-wide" data-testid={`mobile-status-group-${code.toLowerCase()}`}>
                    <span className={`w-2 h-2 rounded-full ${STATUS_LABEL_COLORS[code] || "bg-gray-400"}`} />
                    {DEAL_PIPELINE_LABELS[code]}
                    <span className="text-muted-foreground font-normal normal-case tracking-normal tabular-nums">
                      {filtered.filter(x => (effByUnit[x.id] || "AVA") === code).length}
                    </span>
                  </div>
                )}
                <div className="rounded-xl border bg-card p-4 space-y-3 shadow-sm" data-testid={`mobile-unit-${u.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {/* Unit first — a filtered list repeats the property name
                          150 times; the unit is what you scan for (UX #70). */}
                      <span className="text-sm font-semibold leading-tight block truncate">{u.unitName || prop?.name || "Unit"}</span>
                      {(prop?.name || u.floor) && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{[u.unitName ? prop?.name : null, u.floor].filter(Boolean).join(" · ")}</p>
                      )}
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-[10px] px-2 py-0.5 gap-1.5">
                      <span className={`inline-block w-2 h-2 rounded-full ${STATUS_LABEL_COLORS[code] || "bg-gray-400"}`} />
                      {DEAL_PIPELINE_LABELS[code] || code}
                    </Badge>
                  </div>
                  {rows.length > 0 && (
                    <div className="space-y-1.5">
                      {rows.map((r, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-muted-foreground shrink-0">{r.label}</span>
                          <span className="font-medium truncate text-right">{String(r.value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Tenant-demand actions: View (brochure/details), log a
                      viewing, register an interested tenant + comment, edit. */}
                  <div className="flex items-center flex-wrap gap-1 pt-2 border-t">
                    <Button variant="ghost" size="sm" className="h-9 px-2.5 text-xs gap-1.5" onClick={() => setFilesUnit(u)} data-testid={`unit-view-${u.id}`}>
                      <Eye className="w-3.5 h-3.5" /> Files
                    </Button>
                    <Button variant="ghost" size="sm" className="h-9 px-2.5 text-xs gap-1.5" onClick={() => { setViewingsUnit(u); setAddViewingOpen(true); }} data-testid={`unit-viewing-${u.id}`}>
                      <CalendarDays className="w-3.5 h-3.5" /> Viewing{vCount ? ` (${vCount})` : ""}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-9 px-2.5 text-xs gap-1.5" onClick={() => { setOffersUnit(u); setAddOfferOpen(true); }} data-testid={`unit-offer-${u.id}`}>
                      <HandCoins className="w-3.5 h-3.5" /> Offer{oCount ? ` (${oCount})` : ""}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-9 px-2.5 text-xs gap-1.5" onClick={() => setInterestUnit(u)} data-testid={`unit-interest-${u.id}`}>
                      <Flame className="w-3.5 h-3.5" /> Interest{(interestCounts[u.id] || 0) ? ` (${interestCounts[u.id]})` : ""}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-9 px-2.5 text-xs gap-1.5" onClick={() => { setForm(unitToForm(u, u.dealId ? dealMap[u.dealId]?.dealType : null, landlordPrefillFor(u))); setEditItem(u); }} data-testid={`unit-edit-${u.id}`}>
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Button>
                  </div>
                </div>
                </Fragment>
              );
            })}
          </div>
        )
      )}

      {!isMobile && (
      <Card>
        <ScrollableTable minWidth={2600}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[36px] px-2">
                  <Checkbox
                    checked={filtered.length > 0 && filtered.every(u => selectedIds.has(u.id))}
                    onCheckedChange={(c) => {
                      if (c) setSelectedIds(new Set(filtered.map(u => u.id)));
                      else setSelectedIds(new Set());
                    }}
                    aria-label="Select all"
                    data-testid="checkbox-select-all-units"
                  />
                </TableHead>
                {showCol("ref") && <TableHead className="w-[34px] min-w-[34px] px-1">Ref</TableHead>}
                {/* Left block runs tight (Woody, 2026-09-01: "all need to be
                    reduced in width") — Target Tenant and Comments carry no
                    fixed width, so THEY absorb spare page width instead of
                    every column inflating evenly. */}
                <TableHead className="w-[120px] min-w-[112px] cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("property")} data-testid="sort-property">
                  Property / Unit{sortBy === "property" ? (sortDir === 1 ? " ↑" : " ↓") : ""}
                </TableHead>
                {/* "Existing Tenant" wrapped to two lines and sat out of
                    line with the other headers (Woody, 2026-09-01) — one
                    word, tighter column. */}
                {showCol("existingTenant") && <TableHead className="w-[90px] min-w-[80px] whitespace-nowrap" title="Existing tenant — from the tenancy schedule">Tenant</TableHead>}
                {showCol("unitStatus") && <TableHead className="w-[100px] min-w-[96px]">Unit Status</TableHead>}
                {showCol("pipelineStatus") && <TableHead className="w-[104px] min-w-[100px]">Deal Status</TableHead>}
                {!hideClientCol && showCol("client") && (
                  <TableHead className="w-[128px] min-w-[120px] cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("client")} data-testid="sort-client">
                    Client{sortBy === "client" ? (sortDir === 1 ? " ↑" : " ↓") : ""}
                  </TableHead>
                )}
                {/* Area & Costs sits with the unit's own facts (Client side of
                    the table) rather than out past the target-tenant block
                    (Woody, 2026-09-02). */}
                {showCol("areaCosts") && <TableHead className="w-[130px] min-w-[130px]">Area &amp; Costs</TableHead>}
                <TableHead className="w-[180px] min-w-[170px]">Target Tenant</TableHead>
                {showCol("dealStatus") && <TableHead className="w-[130px] min-w-[130px]">Target Status</TableHead>}
                {showCol("category") && <TableHead className="w-[144px] min-w-[144px]">Category</TableHead>}
                {showCol("priority") && <TableHead className="w-[60px] min-w-[60px]">Priority</TableHead>}
                {showCol("agent") && <TableHead className="w-[140px] min-w-[140px]">Agent</TableHead>}
                {showCol("comments") && <TableHead className="w-[320px] min-w-[280px]">Comments</TableHead>}
                {/* Width-less filler — on wide screens the table's spare
                    width lands HERE, next to the pinned cluster, instead of
                    inflating a data column and shoving the rest under the
                    sticky overlay (Woody, 2026-09-01 "target tenant still
                    not right"). */}
                <TableHead className="p-0" aria-hidden />
                <TableHead className="w-[205px] min-w-[205px] sticky right-0 z-20 border-l bg-card">Actions &amp; Activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4 + targetBlockSpan + ["ref", "existingTenant", "unitStatus", "pipelineStatus", "areaCosts"].filter((k) => showCol(k)).length + (!hideClientCol && showCol("client") ? 1 : 0)} className="py-12 text-muted-foreground">
                    {/* The table is wider than its scroll container, so a
                        cell-centred message lands off-screen — pin it to the
                        visible viewport instead. */}
                    <div className="sticky left-0 w-[min(100%,calc(100vw-20rem))] text-center" data-testid="tracker-empty-state">
                      <Store className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      {teamUnits.length === 0 ? "No available units yet. Add your first unit to get started." : "No units match filters."}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((u, idx) => {
                  const prop = propertyMap[u.propertyId];
                  const deal = u.dealId ? dealMap[u.dealId] : null;
                  const rowCode = effByUnit[u.id] || "AVA";
                  const prevRowCode = idx > 0 ? (effByUnit[filtered[idx - 1].id] || "AVA") : null;
                  const unitTargets: any[] = briefByUnit[u.id]?.targets || [];
                  // Unit-level cells span every target row, so targets read
                  // as first-class columns. Adding after the first target
                  // happens via the small + next to the first operator —
                  // no dedicated add row eating vertical space.
                  const unitRowSpan = Math.max(1, unitTargets.length);
                  const unitClientCompanyId = briefByUnit[u.id]?.clientCompanyId || (prop as any)?.landlordId || null;
                  return (
                    <Fragment key={u.id}>
                    {viewAll && rowCode !== prevRowCode && (
                      <TableRow className="bg-muted/60 hover:bg-muted/60" data-testid={`status-group-${rowCode.toLowerCase()}`}>
                        <TableCell colSpan={4 + targetBlockSpan + ["ref", "existingTenant", "unitStatus", "pipelineStatus", "areaCosts"].filter((k) => showCol(k)).length + (!hideClientCol && showCol("client") ? 1 : 0)} className="py-1.5">
                          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                            <span className={`w-2 h-2 rounded-full ${STATUS_LABEL_COLORS[rowCode] || "bg-gray-400"}`} />
                            {DEAL_PIPELINE_LABELS[rowCode]}
                            <span className="text-muted-foreground font-normal normal-case tracking-normal tabular-nums">
                              {filtered.filter(x => (effByUnit[x.id] || "AVA") === rowCode).length}
                            </span>
                          </span>
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow className={selectedIds.has(u.id) ? "bg-primary/5" : ""} data-testid={`row-unit-${u.id}`}>
                      <TableCell rowSpan={unitRowSpan} className="px-2">
                        <Checkbox
                          checked={selectedIds.has(u.id)}
                          onCheckedChange={() => {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
                              return next;
                            });
                          }}
                          aria-label={`Select ${u.unitName || "unit"}`}
                          data-testid={`checkbox-unit-${u.id}`}
                        />
                      </TableCell>
                      {showCol("ref") && (
                      <TableCell rowSpan={unitRowSpan} className="px-1 py-1 text-xs font-mono text-muted-foreground whitespace-nowrap">
                        {deal?.dealRef ? (
                          <div className="flex items-center gap-1.5">
                            <a
                              href={`/deals/${deal.id}`}
                              className="text-primary hover:underline"
                              title={`Open deal ${deal.dealRef}`}
                              data-testid={`link-deal-ref-${u.id}`}
                            >
                              #{deal.dealRef}
                            </a>
                            {(() => {
                              const amlOk = deal.amlCheckCompleted === "YES" || deal.amlCheckCompleted === "N-A";
                              const feeOk = deal.feeAgreement === "YES";
                              const code = legacyToCode(deal.status);
                              // Only flag for deals on/past SOL — pre-SOL the fields don't matter yet.
                              const promoted = code === "SOL" || code === "EXC" || code === "COM" || code === "INV";
                              if (!promoted) return null;
                              if (amlOk && feeOk) return null;
                              return (
                                <span
                                  className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"
                                  title={`Compliance gap: ${[!amlOk && "AML", !feeOk && "Fee agreement"].filter(Boolean).join(" + ")}`}
                                  data-testid={`compliance-flag-${u.id}`}
                                />
                              );
                            })()}
                          </div>
                        ) : "—"}
                      </TableCell>
                      )}
                      <TableCell rowSpan={unitRowSpan} className="px-1.5 py-1 max-w-[120px]">
                        {/* Unit leads, property is the sub-line — on a
                            one-property board the property name repeats on
                            every row and carries no signal (UX #97). */}
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-start gap-1 text-xs font-medium group/uname">
                            {renameUnitId === u.id ? (
                              <Input
                                autoFocus
                                defaultValue={u.unitName}
                                className="h-6 text-xs px-1.5 py-0 max-w-[104px]"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    const v = (e.target as HTMLInputElement).value.trim();
                                    if (v && v !== u.unitName) inlineUpdate(u.id, "unitName", v);
                                    setRenameUnitId(null);
                                  }
                                  if (e.key === "Escape") setRenameUnitId(null);
                                }}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  if (v && v !== u.unitName) inlineUpdate(u.id, "unitName", v);
                                  setRenameUnitId(null);
                                }}
                                data-testid={`input-rename-unit-${u.id}`}
                              />
                            ) : (
                              <>
                                <button
                                  type="button"
                                  // Wrap over two lines rather than cutting the
                                  // name off — the row is already tall (one per
                                  // target tenant), so the second line is free
                                  // space (Woody, 2026-09-02: "find a neat way
                                  // of fitting the text into the column").
                                  className="min-w-0 text-left leading-snug break-words line-clamp-3 hover:underline hover:text-foreground"
                                  onClick={() => setBriefUnit(u)}
                                  title={u.unitName ? `${u.unitName} — open unit brief` : "Open unit brief"}
                                  data-testid={`unit-name-${u.id}`}
                                >
                                  {u.unitName ? displayUnitName(u.unitName) : <span className="italic opacity-60">Unit name</span>}
                                </button>
                                <button
                                  type="button"
                                  className="p-0.5 mt-0.5 shrink-0 rounded opacity-0 group-hover/uname:opacity-60 hover:!opacity-100 focus-visible:opacity-100 transition-opacity"
                                  onClick={() => setRenameUnitId(u.id)}
                                  title="Rename unit"
                                  aria-label={`Rename ${u.unitName || "unit"}`}
                                  data-testid={`button-rename-unit-${u.id}`}
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              </>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            <InlineLinkSelect
                              value={u.propertyId}
                              options={properties.map(p => ({ id: p.id, name: p.name }))}
                              href={`/properties/${u.propertyId}`}
                              onSave={(v) => inlineUpdate(u.id, "propertyId", v || null)}
                              onCreate={async (name) => { const c = await createProperty(name); inlineUpdate(u.id, "propertyId", c.id); }}
                              placeholder="Link property"
                            />
                          </div>
                        </div>
                      </TableCell>
                      {showCol("existingTenant") && (
                      <TableCell rowSpan={unitRowSpan} className="px-1.5 max-w-[90px]">
                        {/* The name itself is derived from the tenancy
                            schedule (read-only) — but if it isn't a CRM
                            brand yet, the + adds it (Woody, 2026-09-01). */}
                        {(() => {
                          const et = String((u as any).existingTenant || "").trim();
                          const vacant = !et || /^vacant$/i.test(et);
                          if (vacant) return <span className="text-xs text-muted-foreground italic">Vacant</span>;
                          const match = crmCompanies.find(c => (c.name || "").trim().toLowerCase() === et.toLowerCase());
                          return (
                            <span className="text-xs truncate flex items-center gap-1 group/et" title={et}>
                              {match ? (
                                <a href={`/companies/${match.id}`} className="truncate hover:underline text-primary">{et}</a>
                              ) : (
                                <>
                                  <span className="truncate">{et}</span>
                                  <button
                                    type="button"
                                    className="p-0.5 rounded shrink-0 opacity-0 group-hover/et:opacity-60 hover:!opacity-100 transition-opacity"
                                    title={`Add "${et}" to the brand list`}
                                    onClick={() => createCompany(et)}
                                    data-testid={`button-add-existing-tenant-brand-${u.id}`}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                </>
                              )}
                            </span>
                          );
                        })()}
                      </TableCell>
                      )}
                      {showCol("unitStatus") && (
                      <TableCell rowSpan={unitRowSpan} className="px-1.5">
                        {UNIT_STAGE_EDITABLE.has(rowCode) ? (
                          <InlineLabelSelect
                            value={legacyToCode(u.marketingStatus) === "OPP" ? "OPP" : "AVA"}
                            options={UNIT_STATUSES}
                            colorMap={STATUS_LABEL_COLORS}
                            labelMap={DEAL_STATUS_LABELS}
                            onSave={v => inlineUpdate(u.id, "marketingStatus", v || "AVA")}
                            allowClear={false}
                          />
                        ) : (
                          // Deal past marketing — the deal drives; freeze the
                          // unit stage so a flip here can't regress the deal
                          // through the status mirror.
                          <span
                            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                            title="Deal in progress — status is driven by the deal"
                          >
                            <span className={`w-2 h-2 rounded-full ${STATUS_LABEL_COLORS["AVA"] || "bg-gray-400"}`} />
                            Available
                          </span>
                        )}
                      </TableCell>
                      )}
                      {showCol("pipelineStatus") && (
                      <TableCell rowSpan={unitRowSpan} className="px-1.5">
                        <InlineLabelSelect
                          value={rowCode}
                          options={DEAL_PIPELINE_STATUSES}
                          colorMap={STATUS_LABEL_COLORS}
                          labelMap={DEAL_PIPELINE_LABELS}
                          onSave={v => inlineUpdate(u.id, "marketingStatus", v || "AVA")}
                          allowClear={false}
                        />
                      </TableCell>
                      )}
                      {!hideClientCol && showCol("client") && (
                      <TableCell rowSpan={unitRowSpan} className="px-1.5 max-w-[150px]">
                        <div className="flex flex-col gap-0.5">
                        {deal ? (() => {
                          const isTenantRep = (deal.dealType || "").toLowerCase().includes("tenant rep");
                          const field = isTenantRep ? "tenantId" : "landlordId";
                          const value = isTenantRep ? deal.tenantId : deal.landlordId;
                          return (
                            <InlineLinkSelect
                              value={value}
                              options={crmCompanies.map(c => ({ id: c.id, name: c.name }))}
                              href={value ? `/companies/${value}` : undefined}
                              onSave={(v) => dealInlineUpdate.mutate({ id: deal.id, field, value: v || null })}
                              onCreate={async (name) => { const c = await createCompany(name); dealInlineUpdate.mutate({ id: deal.id, field, value: c.id }); }}
                              placeholder="Link client"
                            />
                          );
                        })() : (
                          /* No deal yet — fall back to the property's
                             landlord, editable: the unit PATCH stamps the
                             property / mirrors once a deal exists. */
                          <InlineLinkSelect
                            value={(propertyMap[u.propertyId] as any)?.landlordId || null}
                            options={crmCompanies.map(c => ({ id: c.id, name: c.name }))}
                            href={(propertyMap[u.propertyId] as any)?.landlordId ? `/companies/${(propertyMap[u.propertyId] as any).landlordId}` : undefined}
                            onSave={(v) => { if (v) inlineUpdate(u.id, "landlordId", v); }}
                            onCreate={async (name) => { const c = await createCompany(name); inlineUpdate(u.id, "landlordId", c.id); }}
                            placeholder="Link client"
                          />
                        )}
                        {/* Client contact folded under the company (Woody,
                            2026-09-01) — stored on the unit's targets. */}
                        <UnitClientContactLine
                          targets={unitTargets}
                          clientCompanyId={unitClientCompanyId}
                          onChanged={() => invalidateBriefs(u.id)}
                        />
                        </div>
                      </TableCell>
                      )}
                      {showCol("areaCosts") && (
                      <TableCell rowSpan={unitRowSpan} className="px-1.5 py-1">
                        {/* Area + Costs in one column (Woody, 2026-09-01) —
                            the cell shows Total sf + Rent; EVERYTHING else
                            (per-floor areas incl. ITZA for retail, rates,
                            SC, unit details) edits inside the popover. */}
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="w-full text-left flex flex-col gap-0.5 px-1 py-0.5 hover:bg-accent rounded text-xs"
                              data-testid={`costs-cell-${u.id}`}
                            >
                              <span className="font-mono text-[11px] tabular-nums">
                                {(deal?.totalAreaSqft ?? u.sqft) != null
                                  ? `${Number(deal?.totalAreaSqft ?? u.sqft).toLocaleString("en-GB")} sf`
                                  : <span className="text-muted-foreground">— sf</span>}
                              </span>
                              {u.askingRent != null ? (
                                <span className="font-mono text-[11px] tabular-nums">£{Number(u.askingRent).toLocaleString("en-GB")}</span>
                              ) : (
                                <span className="text-muted-foreground text-[11px] flex items-center gap-1">
                                  <Plus className="w-3 h-3" /> Details
                                </span>
                              )}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[320px] p-3 space-y-2.5 max-h-[70vh] overflow-y-auto" align="end">
                            <p className="text-xs font-semibold">Areas</p>
                            {(deal ? [
                              { label: "GF", value: deal.gfAreaSqft, field: "gfAreaSqft", show: true },
                              { label: "FF", value: deal.ffAreaSqft, field: "ffAreaSqft", show: !isRetailAssetClass(deal.assetClass) || deal.ffAreaSqft != null },
                              { label: "Bsmt", value: deal.basementAreaSqft, field: "basementAreaSqft", show: !isRetailAssetClass(deal.assetClass) || deal.basementAreaSqft != null },
                              { label: "ITZA", value: deal.itzaAreaSqft, field: "itzaAreaSqft", show: isRetailAssetClass(deal.assetClass) },
                              { label: deal.areaBasis || areaBasisFromAssetClass(deal.assetClass), value: deal.totalAreaSqft, field: "totalAreaSqft", show: true },
                            ].filter(r => r.show) : [{ label: "Total", value: u.sqft, field: "sqft", show: true }]).map(({ label, value, field }) => (
                              <div key={field} className="grid grid-cols-[100px_1fr] items-center gap-2">
                                <Label className="text-xs text-muted-foreground">{label}</Label>
                                <InlineNumber
                                  value={value}
                                  onSave={v => {
                                    if (!deal) { inlineUpdate(u.id, "sqft", v); return; }
                                    dealInlineUpdate.mutate({ id: deal.id, field, value: v });
                                    // Auto-sum GF+FF+Bsmt into Total (mirrors Deals board logic)
                                    if (field === "gfAreaSqft" || field === "ffAreaSqft" || field === "basementAreaSqft") {
                                      const gf = field === "gfAreaSqft" ? (v || 0) : (deal.gfAreaSqft || 0);
                                      const ff = field === "ffAreaSqft" ? (v || 0) : (deal.ffAreaSqft || 0);
                                      const bsmt = field === "basementAreaSqft" ? (v || 0) : (deal.basementAreaSqft || 0);
                                      const total = gf + ff + bsmt || null;
                                      dealInlineUpdate.mutate({ id: deal.id, field: "totalAreaSqft", value: total });
                                      inlineUpdate(u.id, "sqft", total);
                                    }
                                    if (field === "totalAreaSqft") inlineUpdate(u.id, "sqft", v);
                                  }}
                                  suffix=" sf"
                                />
                              </div>
                            ))}
                            <p className="text-xs font-semibold border-t pt-2">Costs</p>
                            <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                              <Label className="text-xs text-muted-foreground">Quoting Rent</Label>
                              <InlineNumber value={u.askingRent} onSave={v => inlineUpdate(u.id, "askingRent", v)} prefix="£" />
                            </div>
                            <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                              <Label className="text-xs text-muted-foreground">Rates p.a.</Label>
                              <InlineNumber value={u.ratesPa} onSave={v => inlineUpdate(u.id, "ratesPa", v)} prefix="£" />
                            </div>
                            <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                              <Label className="text-xs text-muted-foreground">SC p.a.</Label>
                              <InlineNumber value={u.serviceChargePa} onSave={v => inlineUpdate(u.id, "serviceChargePa", v)} prefix="£" />
                            </div>
                            {/* Full unit details — every Edit Unit form field is
                                editable here too, writing through the same PATCH
                                so the table and the form mirror each other. */}
                            <p className="text-xs font-semibold border-t pt-2">Details</p>
                            <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                              <Label className="text-xs text-muted-foreground">Floor</Label>
                              <InlineText value={u.floor} onSave={v => inlineUpdate(u.id, "floor", v || null)} placeholder="—" className="text-xs" />
                            </div>
                            <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                              <Label className="text-xs text-muted-foreground">Use class</Label>
                              <InlineText value={u.useClass} onSave={v => inlineUpdate(u.id, "useClass", v || null)} placeholder="—" className="text-xs" />
                            </div>
                            <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                              <Label className="text-xs text-muted-foreground">Condition</Label>
                              <InlineText value={u.condition} onSave={v => inlineUpdate(u.id, "condition", v || null)} placeholder="—" className="text-xs" />
                            </div>
                            <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                              <Label className="text-xs text-muted-foreground">EPC</Label>
                              <InlineText value={u.epcRating} onSave={v => inlineUpdate(u.id, "epcRating", v || null)} placeholder="—" className="text-xs" />
                            </div>
                            <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                              <Label className="text-xs text-muted-foreground">Available from</Label>
                              <input
                                type="date"
                                className="h-7 text-xs border rounded px-1.5 bg-background"
                                defaultValue={u.availableDate ? String(u.availableDate).slice(0, 10) : ""}
                                onBlur={e => { const v = e.target.value || null; if (v !== (u.availableDate ? String(u.availableDate).slice(0, 10) : null)) inlineUpdate(u.id, "availableDate", v); }}
                              />
                            </div>
                            <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                              <Label className="text-xs text-muted-foreground">Marketing start</Label>
                              <input
                                type="date"
                                className="h-7 text-xs border rounded px-1.5 bg-background"
                                defaultValue={u.marketingStartDate ? String(u.marketingStartDate).slice(0, 10) : ""}
                                onBlur={e => { const v = e.target.value || null; if (v !== (u.marketingStartDate ? String(u.marketingStartDate).slice(0, 10) : null)) inlineUpdate(u.id, "marketingStartDate", v); }}
                              />
                            </div>
                            <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                              <Label className="text-xs text-muted-foreground">Location</Label>
                              <InlineText value={u.location} onSave={v => inlineUpdate(u.id, "location", v || null)} placeholder="—" className="text-xs" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Notes</Label>
                              <InlineText value={u.notes} onSave={v => inlineUpdate(u.id, "notes", v || null)} placeholder="Add notes…" className="text-xs" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Restrictions</Label>
                              <InlineText value={u.restrictions} onSave={v => inlineUpdate(u.id, "restrictions", v || null)} placeholder="—" className="text-xs" />
                            </div>
                          </PopoverContent>
                        </Popover>
                      </TableCell>
                      )}
                      {unitTargets.length === 0 ? (
                        <TableCell colSpan={targetBlockSpan}>
                          <div className="flex items-center gap-1.5">
                            <BrandSearchInput
                              className="h-7 w-[220px] border-dashed text-[11px]"
                              placeholder="+ Target operator"
                              value=""
                              allowCreate
                              onPick={p => addUnitTarget(u, p)}
                              testId={`add-target-${u.id}`}
                            />
                            {pitchBrand && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-[11px] text-primary"
                                onClick={() => addUnitTarget(u, { name: pitchBrand.name, companyId: pitchBrand.id } as any)}
                                data-testid={`pitch-here-${u.id}`}
                              >
                                <Plus className="w-3 h-3 mr-0.5" /> {pitchBrand.name}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                              onClick={() => setSuggestUnit(u)}
                              title="AI-suggest target brands: live requirements that fit this unit + brands in matching categories, ranked by AI"
                              data-testid={`button-suggest-targets-${u.id}`}
                            >
                              <Sparkles className="w-3.5 h-3.5 mr-0.5" /> AI
                            </Button>
                          </div>
                        </TableCell>
                      ) : (
                        <TargetRowCells
                          target={unitTargets[0]}
                          clientCompanyId={unitClientCompanyId}
                          onChanged={() => invalidateBriefs(u.id)}
                          visibleCols={{ status: showCol("dealStatus"), category: showCol("category"), priority: showCol("priority"), agent: showCol("agent"), client: false, comments: showCol("comments") }}
                          operatorExtra={
                            <BrandSearchInput
                              iconOnly
                              placeholder="Add target operator…"
                              value=""
                              allowCreate
                              onPick={p => addUnitTarget(u, p)}
                              testId={`add-target-${u.id}`}
                            />
                          }
                        />
                      )}
                      {/* Deal Type column dropped (Woody, 2026-09-01: "it's a
                          letting tracker, they are all lettings") — the type
                          still sets from the unit form / deal page. */}
                      <TableCell rowSpan={unitRowSpan} className="p-0" aria-hidden />
                      <TableCell rowSpan={unitRowSpan} className={`sticky right-0 z-10 border-l ${selectedIds.has(u.id) ? "bg-primary/5" : "bg-card"}`}>
                        {/* Everything actionable in one pinned cluster —
                            activity counts, files/HOTs/brief and row actions
                            (Woody, 2026-09-01 "all in one"; supersedes the
                            separate Activity/Files/Brief columns + UX #100).
                            Counts open the list dialogs; adding lives inside. */}
                        <div className="flex flex-col gap-1 items-start">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-1.5 text-[11px] gap-1 tabular-nums text-muted-foreground hover:text-foreground"
                              onClick={() => setViewingsUnit(u)}
                              title="Viewings"
                              data-testid={`button-viewings-${u.id}`}
                            >
                              <CalendarDays className="h-3.5 w-3.5" />
                              {viewingsCounts[u.id] || 0}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-1.5 text-[11px] gap-1 tabular-nums text-muted-foreground hover:text-foreground"
                              onClick={() => setOffersUnit(u)}
                              title="Offers"
                              data-testid={`button-offers-${u.id}`}
                            >
                              <HandCoins className="h-3.5 w-3.5" />
                              {offersCounts[u.id] || 0}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-1.5 text-[11px] gap-1 tabular-nums text-muted-foreground hover:text-foreground"
                              onClick={() => setInterestUnit(u)}
                              title="Interest — brands who've expressed interest by email"
                              data-testid={`button-interest-${u.id}`}
                            >
                              <Flame className="h-3.5 w-3.5" />
                              {interestCounts[u.id] || 0}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                              onClick={() => setFilesUnit(u)}
                              title="Files — brochures, floor plans, photos, info sheet"
                              data-testid={`button-files-${u.id}`}
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                              onClick={() => setHotsUnit(u)}
                              title="Heads of Terms"
                              data-testid={`button-hots-${u.id}`}
                            >
                              <FileBadge className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                              onClick={() => setBriefUnit(u)}
                              title="Targeting brief"
                              data-testid={`button-brief-${u.id}`}
                            >
                              <Target className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                              onClick={() => setMatchItem(u)}
                              data-testid={`button-match-${u.id}`}
                              title="Find matching requirements"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => {
                                const pName = propertyMap[u.propertyId]?.name || "the property";
                                const prompt = `Tell me about unit ${u.unitName || u.id} at ${pName} — current letting status, targeting and anything relevant from the CRM.`;
                                window.dispatchEvent(new CustomEvent("open-ai-chat-with-prompt", { detail: { prompt } }));
                              }}
                              data-testid={`button-ask-ai-${u.id}`}
                              title="Ask ChatBGP about this unit"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => { setForm(unitToForm(u, u.dealId ? dealMap[u.dealId]?.dealType : null, landlordPrefillFor(u))); setEditItem(u); }}
                              data-testid={`button-edit-${u.id}`}
                              title="Edit unit form (everything is also editable in the row)"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {/* Withdrawn left the Deal Status dropdown
                                (2026-09-01) — this is the per-row way to
                                kill a deal; bulk Change Status can revive. */}
                            {rowCode !== "WIT" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                  if (confirm(`Withdraw ${u.unitName || "this unit"}? The deal moves to Withdrawn (reversible via bulk Change Status).`)) {
                                    inlineUpdate(u.id, "marketingStatus", "WIT");
                                  }
                                }}
                                data-testid={`button-withdraw-${u.id}`}
                                title="Withdraw deal"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive"
                              onClick={() => setDeleteItem(u)}
                              data-testid={`button-delete-${u.id}`}
                              title="Delete unit"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                    {unitTargets.slice(1).map((t: any) => (
                      <TableRow key={t.id} className={selectedIds.has(u.id) ? "bg-primary/5" : ""} data-testid={`row-unit-target-${t.id}`}>
                        <TargetRowCells
                          target={t}
                          clientCompanyId={unitClientCompanyId}
                          onChanged={() => invalidateBriefs(u.id)}
                          visibleCols={{ status: showCol("dealStatus"), category: showCol("category"), priority: showCol("priority"), agent: showCol("agent"), client: false, comments: showCol("comments") }}
                        />
                      </TableRow>
                    ))}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </ScrollableTable>
      </Card>
      )}

      {/* All-statuses view rounds off with the general tenancy schedule so
          the whole picture — every deal stage plus the rent roll — reads
          top to bottom without clicking through categories. One collapsible
          per property; schedules mount lazily on expand. */}
      {viewAll && (() => {
        const schedulePropIds = Array.from(new Set(filtered.map(u => u.propertyId).filter(Boolean)));
        if (schedulePropIds.length === 0) return null;
        return (
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">General Tenancy Schedule</h2>
            </div>
            {schedulePropIds.map(pid => {
              const expanded = scheduleOpen[pid] ?? schedulePropIds.length === 1;
              return (
                <Card key={pid}>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium"
                    onClick={() => setScheduleOpen(prev => ({ ...prev, [pid]: !expanded }))}
                    data-testid={`tenancy-schedule-toggle-${pid}`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate">{propertyMap[pid]?.name || "Property"}</span>
                    </span>
                    {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  </button>
                  {expanded && (
                    <CardContent className="pt-0">
                      <PropertyUnifiedSchedule propertyId={pid} />
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        );
      })()}

      {/* Stage 3b — unified Add-Unit dialog (behind VITE_UNIFIED_ADD_UNIT). */}
      <UnifiedAddUnitDialog
        open={unifiedAddOpen}
        onOpenChange={setUnifiedAddOpen}
        mode="tracker"
      />

      <UnitBriefDialog
        unit={briefUnit}
        open={!!briefUnit}
        onClose={() => setBriefUnit(null)}
      />

      <UnitFormDialog
        open={createOpen}
        onOpenChange={(v) => {
          setCreateOpen(v);
          if (!v) { setForm(emptyForm); setUnitFeeRows([]); setUnitFeeAllocType("percentage"); setShowAllUnitFields(false); }
        }}
        title="Add Available Unit"
        form={form}
        setForm={setForm}
        properties={properties}
        propertyUnits={propertyUnits}
        bgpUsers={bgpUsers}
        feeRows={unitFeeRows}
        setFeeRows={setUnitFeeRows}
        feeAllocType={unitFeeAllocType}
        setFeeAllocType={setUnitFeeAllocType}
        crmCompanies={crmCompanies}
        showAllFields={showAllUnitFields}
        setShowAllFields={setShowAllUnitFields}
        onSubmit={() => createMutation.mutate({ data: formToPayload(form), feeRows: unitFeeRows, feeAllocType: unitFeeAllocType })}
        isPending={createMutation.isPending}
        isEdit={false}
      />

      <UnitFormDialog
        open={!!editItem}
        onOpenChange={v => { if (!v) { setEditItem(null); setForm(emptyForm); } }}
        title="Edit Unit"
        form={form}
        setForm={setForm}
        properties={properties}
        propertyUnits={propertyUnits}
        bgpUsers={bgpUsers}
        feeRows={unitFeeRows}
        setFeeRows={setUnitFeeRows}
        feeAllocType={unitFeeAllocType}
        setFeeAllocType={setUnitFeeAllocType}
        crmCompanies={crmCompanies}
        showAllFields={true}
        setShowAllFields={setShowAllUnitFields}
        onSubmit={() => editItem && updateMutation.mutate({ id: editItem.id, data: formToPayload(form) })}
        isPending={updateMutation.isPending}
        isEdit={true}
      />

      <Dialog open={!!deleteItem} onOpenChange={v => { if (!v) setDeleteItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Unit</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteItem?.unitName}"? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)} disabled={deleteMutation.isPending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} unit{selectedIds.size !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedIds.size} selected unit{selectedIds.size !== 1 ? "s" : ""}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
              disabled={bulkDeleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UnitMatchesDialog unit={matchItem} onClose={() => setMatchItem(null)} />

      <Dialog open={!!linkDealOpen} onOpenChange={v => { if (!v) setLinkDealOpen(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link to Existing Deal</DialogTitle>
            <DialogDescription>Select a deal to link this unit to.</DialogDescription>
          </DialogHeader>
          <Select value={linkDealId} onValueChange={setLinkDealId}>
            <SelectTrigger data-testid="select-link-deal">
              <SelectValue placeholder="Select a deal..." />
            </SelectTrigger>
            <SelectContent>
              {deals.map(d => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDealOpen(null)}>Cancel</Button>
            <Button
              disabled={!linkDealId || linkDealMutation.isPending}
              onClick={() => linkDealOpen && linkDealMutation.mutate({ id: linkDealOpen.id, dealId: linkDealId })}
            >
              Link Deal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!wipUnit} onOpenChange={v => { if (!v) setWipUnit(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Promote to Solicitors</DialogTitle>
            <DialogDescription>
              {wipUnit ? `${propertyMap[wipUnit.propertyId]?.name || "Property"} — ${wipUnit.unitName}` : ""}
              . Fill in the deal details below.
            </DialogDescription>
          </DialogHeader>
          {wipUnit && (
            <div className="pb-2">
              <PropertyPlanningCard propertyId={wipUnit.propertyId} compact />
            </div>
          )}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">Deal Type</Label>
                <Select value={wipForm.dealType} onValueChange={v => setWipForm(f => ({ ...f, dealType: v }))}>
                  <SelectTrigger data-testid="wip-deal-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(isClientTracker ? ["New Letting", "Lease Renewal", "Rent Review", "Regear", "Temp Lease"] : ["New Letting", "Temp Lease", "Lease Acquisition", "Sale", "Lease Renewal", "Rent Review", "Regear"]).map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1">Team</Label>
                <Select value={wipForm.team[0] || ""} onValueChange={v => setWipForm(f => ({ ...f, team: v ? [v] : [] }))}>
                  <SelectTrigger data-testid="wip-team"><SelectValue placeholder="Select team" /></SelectTrigger>
                  <SelectContent>
                    {CRM_OPTIONS.dealTeam.map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1">Agent *</Label>
              <Select
                value={wipForm.agent}
                onValueChange={v => setWipForm(f => {
                  // Auto-grab the agent's team so the user doesn't have
                  // to set both fields. Only fills when the team is
                  // currently empty — keep an existing override intact.
                  const picked = bgpUsers.find(u => u.name === v);
                  const teamFromUser = picked?.team;
                  return {
                    ...f,
                    agent: v,
                    team: (f.team.length > 0 || !teamFromUser) ? f.team : [teamFromUser],
                  };
                })}
              >
                <SelectTrigger data-testid="wip-agent"><SelectValue placeholder="Select agent" /></SelectTrigger>
                <SelectContent>
                  {bgpUsers.map(u => (
                    <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Contracting entities — required at SOL so AML fires on
                a real company link, not a name string. Landlord is
                derived from the property (read-only); tenant is the
                applicant the agent is contracting with. Both sides
                also need a Xero billing entity for invoicing. */}
            {wipUnit && (() => {
              const prop = propertyMap[wipUnit.propertyId];
              const landlordBrand = prop?.landlordId ? crmCompanies.find(c => c.id === prop.landlordId) : null;
              const tenantOptions = crmCompanies.filter(c =>
                (c.companyType?.startsWith("Tenant") || false) || c.id === wipForm.tenantId
              );
              const tenantItems = tenantOptions.map(c => ({
                id: c.id,
                label: c.name,
                subLabel: (c as any).ukEntityName || c.companyType || undefined,
                keywords: [c.companyType || "", c.domainUrl || ""].filter(Boolean),
              }));
              const createTenant = async (name: string) => {
                const r = await apiRequest("POST", "/api/crm/companies", {
                  name: name.trim(),
                  companyType: "Tenant",
                });
                const created = await r.json();
                queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
                toast({ title: "Tenant created", description: `${created.name} added to CRM.` });
                return { id: String(created.id), label: created.name, subLabel: created.companyType };
              };
              return (
                <div className="border rounded-md p-3 bg-muted/30 space-y-3">
                  <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    Contracting entities (required for AML)
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Landlord brand</Label>
                      {landlordBrand ? (
                        <div className="text-sm border rounded-md px-2.5 py-1.5 bg-background">
                          {landlordBrand.name}
                        </div>
                      ) : (
                        <div className="text-xs text-amber-700 border border-amber-300 rounded-md px-2.5 py-1.5 bg-amber-50">
                          No landlord linked on {prop?.name || "property"}. Add one on the property page before promoting.
                        </div>
                      )}
                      <Label className="text-[10px] text-muted-foreground">Billing / legal entity (Xero)</Label>
                      <XeroContactPicker
                        testIdPrefix="wip-landlord-entity"
                        value={wipForm.landlordEntityId || null}
                        cachedName={wipForm.landlordEntityName}
                        onChange={(c) => setWipForm(f => ({
                          ...f,
                          landlordEntityId: c?.ContactID || "",
                          landlordEntityName: c?.Name || "",
                        }))}
                        compact
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tenant brand *</Label>
                      <EntityCombobox
                        testId="wip-tenant"
                        placeholder="Link tenant"
                        searchPlaceholder="Search tenants…"
                        value={wipForm.tenantId}
                        items={tenantItems}
                        onChange={(v) => {
                          const picked = crmCompanies.find(c => c.id === v);
                          setWipForm(f => ({
                            ...f,
                            tenantId: v,
                            tenantName: picked?.name || "",
                            tenantEntityId: "",
                            tenantEntityName: "",
                          }));
                        }}
                        onCreate={createTenant}
                        createLabel="tenant"
                      />
                      <Label className="text-[10px] text-muted-foreground">Billing / legal entity (Xero)</Label>
                      <XeroContactPicker
                        testIdPrefix="wip-tenant-entity"
                        value={wipForm.tenantEntityId || null}
                        cachedName={wipForm.tenantEntityName}
                        onChange={(c) => setWipForm(f => ({
                          ...f,
                          tenantEntityId: c?.ContactID || "",
                          tenantEntityName: c?.Name || "",
                        }))}
                        compact
                      />
                    </div>
                  </div>
                </div>
              );
            })()}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">Fee (£) *</Label>
                <CurrencyInput
                  value={wipForm.fee}
                  onChange={v => setWipForm(f => ({ ...f, fee: v }))}
                  placeholder="0"
                  prefix="£"
                  testId="wip-fee"
                />
              </div>
              <div>
                <Label className="text-xs mb-1">Fee Agreement signed</Label>
                <Select value={wipForm.feeAgreement} onValueChange={v => setWipForm(f => ({ ...f, feeAgreement: v }))}>
                  <SelectTrigger data-testid="wip-fee-agreement"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES">YES</SelectItem>
                    <SelectItem value="NO">NO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Fee split — same shape as the deal form (BGP House 15%
                locked + agents on the remaining 85%). The auto-created
                AVA deal lands here with no split set, so this is where
                Layla locks it in for SOL handover. PUT'd to
                /api/crm/deals/:id/fee-allocations after the promote
                mutation succeeds. */}
            <div>
              <Label className="text-xs mb-1">BGP fee split</Label>
              <div className="border rounded-md p-2.5 bg-muted/30">
                <FeeAllocationEditor
                  rows={wipFeeRows}
                  onChange={setWipFeeRows}
                  allocType={wipFeeAllocType}
                  onAllocTypeChange={setWipFeeAllocType}
                  dealFee={parseFloat(wipForm.fee) || null}
                  bgpAgents={bgpUsers.map(u => ({ id: String(u.id), name: u.name }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">AML / KYC checked</Label>
                <Select value={wipForm.amlChecked} onValueChange={v => setWipForm(f => ({ ...f, amlChecked: v }))}>
                  <SelectTrigger data-testid="wip-aml"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES">YES</SelectItem>
                    <SelectItem value="NO">NO</SelectItem>
                    <SelectItem value="N-A">N/A</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">Headline Rent (£ p.a.)</Label>
                <CurrencyInput
                  value={wipForm.askingRent}
                  onChange={v => setWipForm(f => ({ ...f, askingRent: v }))}
                  placeholder="0"
                  prefix="£"
                  testId="wip-rent"
                />
              </div>
              <div>
                <Label className="text-xs mb-1">Total Area (sq ft)</Label>
                <CurrencyInput
                  value={wipForm.totalAreaSqft}
                  onChange={v => setWipForm(f => ({ ...f, totalAreaSqft: v }))}
                  placeholder="0"
                  testId="wip-sqft"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">Lease Length (years)</Label>
                <Input
                  type="number"
                  min="0"
                  value={wipForm.leaseLength}
                  onChange={e => setWipForm(f => ({ ...f, leaseLength: e.target.value }))}
                  placeholder="0"
                  data-testid="wip-lease-length"
                />
              </div>
              <div>
                <Label className="text-xs mb-1">Rent Free (months)</Label>
                <Input
                  type="number"
                  min="0"
                  value={wipForm.rentFree}
                  onChange={e => setWipForm(f => ({ ...f, rentFree: e.target.value }))}
                  placeholder="0"
                  data-testid="wip-rent-free"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs mb-1">
                Target Completion Date <span className="text-rose-600">*</span>
              </Label>
              <Input
                type="date"
                value={wipForm.targetDate}
                onChange={e => setWipForm(f => ({ ...f, targetDate: e.target.value }))}
                required
                className={!wipForm.targetDate ? "border-rose-300" : ""}
                data-testid="wip-target-date"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Drives the WIP report's month / fiscal-year bucket.
              </p>
            </div>

            {/* Net Effective = Headline × (term − rent_free) / term.
                Derived live — no extra DB column. Hidden when the
                inputs aren't enough to make the number meaningful. */}
            {(() => {
              const headline = parseFloat(wipForm.askingRent) || 0;
              const termYears = parseFloat(wipForm.leaseLength) || 0;
              const freeMonths = parseFloat(wipForm.rentFree) || 0;
              if (!headline || !termYears) return null;
              const termMonths = termYears * 12;
              if (freeMonths >= termMonths) return null;
              const net = Math.round(headline * (termMonths - freeMonths) / termMonths);
              return (
                <div className="text-xs text-muted-foreground border rounded-md px-3 py-2 bg-muted/30 flex items-center justify-between">
                  <span>Net Effective Rent (derived from headline, term, rent free)</span>
                  <span className="font-medium text-foreground">£{net.toLocaleString()} p.a.</span>
                </div>
              );
            })()}

            <div>
              <Label className="text-xs mb-1">Notes</Label>
              <Textarea
                value={wipForm.comments}
                onChange={e => setWipForm(f => ({ ...f, comments: e.target.value }))}
                rows={2}
                data-testid="wip-comments"
              />
            </div>
          </div>
          {(() => {
            const hardMissing: string[] = [];
            if (!wipForm.tenantId) hardMissing.push("Tenant brand");
            if (!wipForm.fee.trim()) hardMissing.push("Fee");
            if (!wipForm.agent.trim()) hardMissing.push("Agent");
            if (!wipForm.targetDate) hardMissing.push("Target date");
            const softMissing: string[] = [];
            if (wipForm.feeAgreement !== "YES") softMissing.push("Fee agreement signed");
            if (wipForm.amlChecked !== "YES" && wipForm.amlChecked !== "N-A") softMissing.push("AML / KYC checked");
            const canSubmit = hardMissing.length === 0 && (softMissing.length === 0 || wipForm.overrideCompliance);
            return (
              <>
                {(hardMissing.length > 0 || softMissing.length > 0) && (
                  <div className="rounded-md border p-2 bg-amber-50 dark:bg-amber-900/10 mt-2 space-y-1.5">
                    {hardMissing.length > 0 && (
                      <p className="text-xs text-rose-700 dark:text-rose-400">Required before saving: {hardMissing.join(", ")}</p>
                    )}
                    {hardMissing.length === 0 && softMissing.length > 0 && (
                      <>
                        <p className="text-xs text-amber-700 dark:text-amber-400">Missing compliance: {softMissing.join(", ")}</p>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={wipForm.overrideCompliance}
                            onChange={e => setWipForm(f => ({ ...f, overrideCompliance: e.target.checked }))}
                            data-testid="wip-override"
                          />
                          <span>Promote anyway — I'll complete these before exchange</span>
                        </label>
                      </>
                    )}
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setWipUnit(null)}>Cancel</Button>
                  <Button
                    onClick={() => wipUnit && wipDealMutation.mutate({ unitId: wipUnit.id, data: wipForm, feeRows: wipFeeRows, feeAllocType: wipFeeAllocType })}
                    disabled={wipDealMutation.isPending || !canSubmit}
                    data-testid="wip-submit"
                  >
                    {wipDealMutation.isPending ? "Saving..." : "Promote to Solicitors"}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Provenance pop-outs — the email behind an offer/interest row, and
          the diary event behind a viewing. Applying AI-read figures fills
          the offer edit form; it never saves on its own. */}
      <SourceEmailDialog
        kind={sourceEmail?.kind || "offer"}
        rowId={sourceEmail?.id || null}
        title={sourceEmail?.title}
        onClose={() => setSourceEmail(null)}
        onApplyFigures={(f) => {
          const o = offersForUnit.find((row: any) => row.id === sourceEmail?.id);
          if (!o) return;
          setOfferForm({
            companyName: o.companyName || "", companyId: o.companyId || "",
            contactName: o.contactName || "", contactId: o.contactId || "",
            offerDate: o.offerDate || "",
            rentPa: f.rentPa != null ? String(f.rentPa) : (o.rentPa != null ? String(o.rentPa) : ""),
            rentFreeMonths: f.rentFreeMonths != null ? String(f.rentFreeMonths) : (o.rentFreeMonths != null ? String(o.rentFreeMonths) : ""),
            termYears: f.termYears != null ? String(f.termYears) : (o.termYears != null ? String(o.termYears) : ""),
            breakOption: f.breakOption || o.breakOption || "",
            incentives: f.incentives || o.incentives || "",
            premium: f.premium != null ? String(f.premium) : (o.premium != null ? String(o.premium) : ""),
            fittingOutContribution: f.fittingOutContribution != null ? String(f.fittingOutContribution) : (o.fittingOutContribution != null ? String(o.fittingOutContribution) : ""),
            comments: [o.comments, f.notes].filter(Boolean).join(" — "),
          });
          setEditingOfferId(o.id);
          setAddOfferOpen(true);
          setSourceEmail(null);
        }}
      />
      <SourceEventDialog kind={sourceEvent?.kind || "viewing"} rowId={sourceEvent?.id || null} onClose={() => setSourceEvent(null)} />

      <Dialog open={!!interestUnit} onOpenChange={v => { if (!v) setInterestUnit(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-violet-500" />
              Interest — {interestUnit?.unitName?.split(",")[0] || "Unit"}
            </DialogTitle>
            <DialogDescription>
              Brands and agents who've expressed interest — mostly auto-detected from the team's inbox. Log a viewing or an offer when it firms up.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {interestForUnit.length === 0 && (
              <p className="text-sm text-muted-foreground italic py-4 text-center">No interest logged for this unit yet.</p>
            )}
            {interestForUnit.map((i: any) => (
              <div key={i.id} className="flex items-start justify-between gap-2 border rounded-lg p-2.5" data-testid={`interest-row-${i.id}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{i.companyName || i.contactName || "Unknown"}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[i.contactName && i.companyName ? i.contactName : null, i.interestDate].filter(Boolean).join(" · ")}
                  </p>
                  {i.notes && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{i.notes}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {i.source === "email" && <Badge variant="outline" className="text-[9px]">from inbox</Badge>}
                  {/* The brand that's keen goes straight onto the unit's
                      target operators, carrying its interest notes. */}
                  {(i.companyName || i.contactName) && (
                    <Button
                      variant="outline" size="sm" className="h-7 px-2 text-[11px]"
                      disabled={addingTargetFrom === i.id}
                      onClick={() => addTargetFromInterest(i)}
                      title={`Add ${i.companyName || i.contactName} to this unit's target operators, with these notes`}
                      data-testid={`interest-add-target-${i.id}`}
                    >
                      {addingTargetFrom === i.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Plus className="w-3 h-3 mr-1" />}
                      Target
                    </Button>
                  )}
                  {/* Interest arrives from BOTH the inbox sweep and the
                      diary sweep, sharing one column — the key's prefix says
                      which, so the button opens the matching source. */}
                  {i.emailConversationId && (
                    String(i.emailConversationId).startsWith("cal_") ? (
                      <Button
                        variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                        onClick={() => setSourceEvent({ kind: "interest", id: i.id })}
                        title="Open the diary entry this came from"
                        data-testid={`interest-event-${i.id}`}
                      >
                        <CalendarDays className="w-3.5 h-3.5" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                        onClick={() => setSourceEmail({ kind: "interest", id: i.id, title: `Interest — ${i.companyName || i.contactName || "email"}` })}
                        title="Open the email this came from"
                        data-testid={`interest-email-${i.id}`}
                      >
                        <Mail className="w-3.5 h-3.5" />
                      </Button>
                    )
                  )}
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteInterestMutation.mutate(i.id)} data-testid={`interest-delete-${i.id}`}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {/* Manual log (UX #71) — mirrors the add-viewing pattern so a
              phone-call expression of interest can be recorded. */}
          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-medium">Log interest</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0">
                <CrmPicker
                  items={crmCompanies.map(c => ({ id: c.id, name: c.name }))}
                  value={interestForm.companyId}
                  valueName={interestForm.companyName}
                  onSelect={(id, name) => setInterestForm(f => ({ ...f, companyId: id, companyName: name }))}
                  placeholder="Company / brand"
                  testId="interest-company"
                />
              </div>
              <Input type="date" className="min-w-0" value={interestForm.interestDate} onChange={e => setInterestForm(f => ({ ...f, interestDate: e.target.value }))} data-testid="interest-date" />
            </div>
            <Input value={interestForm.notes} onChange={e => setInterestForm(f => ({ ...f, notes: e.target.value }))} placeholder="Note (e.g. rang about this unit — wants floorplans)" data-testid="interest-notes" />
            <Button
              size="sm"
              disabled={!interestForm.companyName || addInterestMutation.isPending}
              onClick={() => addInterestMutation.mutate(interestForm)}
              data-testid="interest-add"
            >
              {addInterestMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
              Log interest
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingsUnit} onOpenChange={v => { if (!v) { setViewingsUnit(null); setAddViewingOpen(false); setEditingViewingId(null); setViewingForm(emptyViewingForm()); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 shrink-0" />
              Viewings
            </DialogTitle>
            {/* Property names carry full addresses — a truncating one-liner
                beats the four-line title it produced on phones. */}
            <DialogDescription className="truncate">
              {viewingsUnit ? `${viewingsUnit.unitName} · ${propertyMap[viewingsUnit.propertyId]?.name || "Property"}` : "Track all viewings for this unit"}
            </DialogDescription>
          </DialogHeader>

          {viewingsForUnit.length === 0 && !addViewingOpen && (
            <div className="text-center py-6 text-muted-foreground text-sm">No viewings recorded yet</div>
          )}

          {viewingsForUnit.length > 0 && (
            <div className="space-y-2">
              {viewingsForUnit.map(v => (
                <div key={v.id} className="border rounded-lg p-3 text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="font-medium flex items-center gap-2">
                      {v.companyId ? <a href={`/contacts?company=${v.companyId}`} className="text-primary hover:underline">{v.companyName}</a> : (v.companyName || v.contactName || v.attendees || "No company")}
                      {v.source === "diary" && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <CalendarDays className="w-2.5 h-2.5" /> Diary
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{v.viewingDate}{v.viewingTime ? ` at ${v.viewingTime}` : ""}</span>
                      {/* Viewings live in the team calendar — link to the
                          actual event rather than making people hunt for it. */}
                      {v.calendarEventId && (
                        <Button
                          variant="outline" size="sm" className="h-7 px-2 text-[11px]"
                          onClick={() => setSourceEvent({ kind: "viewing", id: v.id })}
                          title="Open the diary event / team calendar"
                          data-testid={`viewing-event-${v.id}`}
                        >
                          <CalendarDays className="w-3 h-3 mr-1" /> Calendar
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" aria-label="Edit viewing" title="Edit viewing" onClick={() => {
                        setViewingForm({ companyName: v.companyName || "", companyId: v.companyId || "", contactName: v.contactName || "", contactId: v.contactId || "", viewingDate: v.viewingDate || "", viewingTime: v.viewingTime || "", attendees: v.attendees || "", notes: v.notes || "", outcome: v.outcome || "" });
                        setEditingViewingId(v.id);
                        setAddViewingOpen(true);
                      }} data-testid={`viewing-edit-${v.id}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" aria-label="Delete viewing" title="Delete viewing" onClick={() => deleteViewingMutation.mutate(v.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {v.contactName && <div className="text-xs text-muted-foreground">Contact: {v.contactId ? <a href={`/contacts?contact=${v.contactId}`} className="text-primary hover:underline">{v.contactName}</a> : v.contactName}</div>}
                  {/* When the attendees string already headlines the card
                      (no company/contact), repeating it here read every
                      quick-logged viewing twice. */}
                  {v.attendees && (v.companyName || v.contactName) && <div className="text-xs text-muted-foreground">Attendees: {v.attendees}</div>}
                  {v.outcome && <div className="text-xs"><Badge variant="outline">{v.outcome}</Badge></div>}
                  {v.notes && <div className="text-xs text-muted-foreground">{v.notes}</div>}
                </div>
              ))}
            </div>
          )}

          {addViewingOpen ? (
            <div className="border rounded-lg p-3 space-y-3">
              <div className="text-sm font-medium">{editingViewingId ? "Edit Viewing" : "Add Viewing"}</div>
              {/* Pickers stack full-width on phones — half-width triggers
                  truncated their own placeholders ("Select com…"). */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Company</Label>
                  <CrmPicker
                    items={crmCompanies.map(c => ({ id: c.id, name: c.name }))}
                    value={viewingForm.companyId}
                    valueName={viewingForm.companyName}
                    onSelect={(id, name) => setViewingForm(f => ({ ...f, companyId: id, companyName: name }))}
                    placeholder="Select company"
                    testId="viewing-company"
                  />
                </div>
                <div>
                  <Label className="text-xs">Contact</Label>
                  <CrmPicker
                    items={crmContacts.map(c => ({ id: c.id, name: c.name }))}
                    value={viewingForm.contactId}
                    valueName={viewingForm.contactName}
                    onSelect={(id, name) => setViewingForm(f => ({ ...f, contactId: id, contactName: name }))}
                    placeholder="Select contact"
                    testId="viewing-contact"
                  />
                </div>
              </div>
              {/* min-w-0 — iOS date/time inputs refuse to shrink below their
                  intrinsic width and pushed the Time field off-screen at 390px. */}
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <Label className="text-xs">Date</Label>
                  <Input type="date" className="min-w-0" value={viewingForm.viewingDate} onChange={e => setViewingForm(f => ({ ...f, viewingDate: e.target.value }))} data-testid="viewing-date" />
                </div>
                <div className="min-w-0">
                  <Label className="text-xs">Time</Label>
                  <Input type="time" className="min-w-0" value={viewingForm.viewingTime} onChange={e => setViewingForm(f => ({ ...f, viewingTime: e.target.value }))} data-testid="viewing-time" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Attendees</Label>
                <Input value={viewingForm.attendees} onChange={e => setViewingForm(f => ({ ...f, attendees: e.target.value }))} placeholder="Who attended" data-testid="viewing-attendees" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Outcome</Label>
                  <Select value={viewingForm.outcome} onValueChange={v => setViewingForm(f => ({ ...f, outcome: v }))}>
                    <SelectTrigger data-testid="viewing-outcome"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {["Interested", "Not Interested", "Follow Up", "Offer Expected", "No Show"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Notes</Label>
                  <Input value={viewingForm.notes} onChange={e => setViewingForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any notes" data-testid="viewing-notes" />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => { setAddViewingOpen(false); setEditingViewingId(null); setViewingForm(emptyViewingForm()); }}>Cancel</Button>
                <Button size="sm" disabled={!viewingForm.viewingDate || addViewingMutation.isPending || updateViewingMutation.isPending} onClick={() => editingViewingId ? updateViewingMutation.mutate({ id: editingViewingId, data: viewingForm }) : addViewingMutation.mutate(viewingForm)} data-testid="viewing-save">
                  {(addViewingMutation.isPending || updateViewingMutation.isPending) ? "Saving..." : editingViewingId ? "Save Changes" : "Save Viewing"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={() => { setEditingViewingId(null); setViewingForm(emptyViewingForm()); setAddViewingOpen(true); }} data-testid="viewing-add">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Viewing
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!offersUnit} onOpenChange={v => { if (!v) { setOffersUnit(null); setAddOfferOpen(false); setEditingOfferId(null); setOfferForm(emptyOfferForm()); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandCoins className="h-5 w-5 shrink-0" />
              Offers
            </DialogTitle>
            <DialogDescription className="truncate">
              {offersUnit ? `${offersUnit.unitName} · ${propertyMap[offersUnit.propertyId]?.name || "Property"}` : "Track all offers received for this unit"}
            </DialogDescription>
          </DialogHeader>

          {offersForUnit.length === 0 && !addOfferOpen && (
            <div className="text-center py-6 text-muted-foreground text-sm">No offers recorded yet</div>
          )}

          {offersForUnit.length > 0 && (
            <div className="space-y-2">
              {offersForUnit.map(o => (
                <div key={o.id} className="border rounded-lg p-3 text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">
                      {o.companyId ? <a href={`/contacts?company=${o.companyId}`} className="text-primary hover:underline">{o.companyName}</a> : (o.companyName || o.contactName || "No company")}
                      {o.contactName && <span className="text-xs text-muted-foreground ml-2">({o.contactId ? <a href={`/contacts?contact=${o.contactId}`} className="text-primary hover:underline">{o.contactName}</a> : o.contactName})</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {o.source === "email" && (
                        <Badge variant="outline" className="text-[10px] gap-1 border-amber-400 text-amber-700 dark:text-amber-400">
                          <Mail className="w-2.5 h-2.5" /> From email — confirm figures
                        </Badge>
                      )}
                      {/* The email is the evidence for the numbers — open it
                          alongside, read the figures, then log them. */}
                      {o.emailConversationId && (
                        <Button
                          variant="outline" size="sm" className="h-7 px-2 text-[11px]"
                          onClick={() => setSourceEmail({ kind: "offer", id: o.id, title: `Offer — ${o.companyName || o.contactName || "email"}` })}
                          title="Open the offer email"
                          data-testid={`offer-email-${o.id}`}
                        >
                          <Mail className="w-3 h-3 mr-1" /> Email
                        </Button>
                      )}
                      <Badge variant="outline" className={o.status === "Accepted" ? "bg-emerald-100 text-emerald-800" : o.status === "Rejected" ? "bg-red-100 text-red-800" : ""}>{o.status || "Pending"}</Badge>
                      <span className="text-xs text-muted-foreground">{o.offerDate}</span>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" aria-label="Edit offer" title="Edit offer" onClick={() => {
                        setOfferForm({ companyName: o.companyName || "", companyId: o.companyId || "", contactName: o.contactName || "", contactId: o.contactId || "", offerDate: o.offerDate || "", rentPa: o.rentPa != null ? String(o.rentPa) : "", rentFreeMonths: o.rentFreeMonths != null ? String(o.rentFreeMonths) : "", termYears: o.termYears != null ? String(o.termYears) : "", breakOption: o.breakOption || "", incentives: o.incentives || "", premium: o.premium != null ? String(o.premium) : "", fittingOutContribution: o.fittingOutContribution != null ? String(o.fittingOutContribution) : "", comments: o.comments || "" });
                        setEditingOfferId(o.id);
                        setAddOfferOpen(true);
                      }} data-testid={`offer-edit-${o.id}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" aria-label="Delete offer" title="Delete offer" onClick={() => deleteOfferMutation.mutate(o.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs">
                    {o.rentPa != null && <div><span className="text-muted-foreground">Rent: </span>£{o.rentPa.toLocaleString()} p.a.</div>}
                    {o.rentFreeMonths != null && <div><span className="text-muted-foreground">Rent Free: </span>{o.rentFreeMonths} months</div>}
                    {o.termYears != null && <div><span className="text-muted-foreground">Term: </span>{o.termYears} years</div>}
                    {o.breakOption && <div><span className="text-muted-foreground">Break: </span>{o.breakOption}</div>}
                    {o.premium != null && <div><span className="text-muted-foreground">Premium: </span>£{o.premium.toLocaleString()}</div>}
                    {o.fittingOutContribution != null && <div><span className="text-muted-foreground">Fit-out: </span>£{o.fittingOutContribution.toLocaleString()}</div>}
                  </div>
                  {o.incentives && <div className="text-xs"><span className="text-muted-foreground">Incentives: </span>{o.incentives}</div>}
                  {o.comments && <div className="text-xs text-muted-foreground">{o.comments}</div>}
                </div>
              ))}
            </div>
          )}

          {addOfferOpen ? (
            <div className="border rounded-lg p-3 space-y-3">
              <div className="text-sm font-medium">{editingOfferId ? "Edit Offer" : "Add Offer"}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Company</Label>
                  <CrmPicker
                    items={crmCompanies.map(c => ({ id: c.id, name: c.name }))}
                    value={offerForm.companyId}
                    valueName={offerForm.companyName}
                    onSelect={(id, name) => setOfferForm(f => ({ ...f, companyId: id, companyName: name }))}
                    placeholder="Select company"
                    testId="offer-company"
                  />
                </div>
                <div>
                  <Label className="text-xs">Contact</Label>
                  <CrmPicker
                    items={crmContacts.map(c => ({ id: c.id, name: c.name }))}
                    value={offerForm.contactId}
                    valueName={offerForm.contactName}
                    onSelect={(id, name) => setOfferForm(f => ({ ...f, contactId: id, contactName: name }))}
                    placeholder="Select contact"
                    testId="offer-contact"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <Label className="text-xs">Date</Label>
                  <Input type="date" className="min-w-0" value={offerForm.offerDate} onChange={e => setOfferForm(f => ({ ...f, offerDate: e.target.value }))} data-testid="offer-date" />
                </div>
                <div className="min-w-0">
                  <Label className="text-xs">Rent p.a. (£)</Label>
                  <CurrencyInput value={offerForm.rentPa} onChange={v => setOfferForm(f => ({ ...f, rentPa: v }))} placeholder="0" prefix="£" testId="offer-rent" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Rent Free (months)</Label>
                  <Input type="number" min="0" value={offerForm.rentFreeMonths} onChange={e => setOfferForm(f => ({ ...f, rentFreeMonths: e.target.value }))} placeholder="0" data-testid="offer-rent-free" />
                </div>
                <div>
                  <Label className="text-xs">Term (years)</Label>
                  <Input type="number" min="0" value={offerForm.termYears} onChange={e => setOfferForm(f => ({ ...f, termYears: e.target.value }))} placeholder="0" data-testid="offer-term" />
                </div>
                <div>
                  <Label className="text-xs">Break Option</Label>
                  <Input value={offerForm.breakOption} onChange={e => setOfferForm(f => ({ ...f, breakOption: e.target.value }))} placeholder="e.g. Year 5" data-testid="offer-break" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Premium (£)</Label>
                  <CurrencyInput value={offerForm.premium} onChange={v => setOfferForm(f => ({ ...f, premium: v }))} placeholder="0" prefix="£" testId="offer-premium" />
                </div>
                <div>
                  <Label className="text-xs">Fit-out Contribution (£)</Label>
                  <CurrencyInput value={offerForm.fittingOutContribution} onChange={v => setOfferForm(f => ({ ...f, fittingOutContribution: v }))} placeholder="0" prefix="£" testId="offer-fitout" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Incentives</Label>
                <Input value={offerForm.incentives} onChange={e => setOfferForm(f => ({ ...f, incentives: e.target.value }))} placeholder="Any other incentives" data-testid="offer-incentives" />
              </div>
              <div>
                <Label className="text-xs">Comments</Label>
                <Textarea value={offerForm.comments} onChange={e => setOfferForm(f => ({ ...f, comments: e.target.value }))} rows={2} data-testid="offer-comments" />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => { setAddOfferOpen(false); setEditingOfferId(null); setOfferForm(emptyOfferForm()); }}>Cancel</Button>
                <Button size="sm" disabled={!offerForm.offerDate || addOfferMutation.isPending || updateOfferMutation.isPending} onClick={() => {
                  const payload: any = { ...offerForm };
                  // On add, empty numeric fields are omitted; on edit they clear the stored value.
                  for (const k of ["rentPa", "rentFreeMonths", "termYears", "premium", "fittingOutContribution"] as const) {
                    if (payload[k]) payload[k] = parseFloat(payload[k]);
                    else if (editingOfferId) payload[k] = null;
                    else delete payload[k];
                  }
                  if (editingOfferId) updateOfferMutation.mutate({ id: editingOfferId, data: payload });
                  else addOfferMutation.mutate(payload);
                }} data-testid="offer-save">
                  {(addOfferMutation.isPending || updateOfferMutation.isPending) ? "Saving..." : editingOfferId ? "Save Changes" : "Save Offer"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={() => { setEditingOfferId(null); setOfferForm(emptyOfferForm()); setAddOfferOpen(true); }} data-testid="offer-add">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Offer
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <MarketingFilesDialog
        unit={filesUnit}
        files={filesForUnit}
        propertyName={filesUnit ? (propertyMap[filesUnit.propertyId]?.name || "") : ""}
        isClient={isClientTracker}
        onClose={() => setFilesUnit(null)}
      />

      <HotsDialog
        unit={hotsUnit}
        propertyName={hotsUnit ? (propertyMap[hotsUnit.propertyId]?.name || "") : ""}
        isClient={isClientTracker}
        onClose={() => setHotsUnit(null)}
      />

      <SuggestTargetsDialog
        unit={suggestUnit}
        onClose={() => setSuggestUnit(null)}
        onAdd={async (pick) => { if (suggestUnit) await addUnitTarget(suggestUnit, pick); }}
      />
    </div>
  );
}


// ─── Heads of Terms dialog ──────────────────────────────────────────────
// Standard HOTs live on the property; "Populate" copies them onto the unit
// with the deal specifics filled in ({PROPERTY}, {UNIT}, {TENANT}, {RENT},
// {SERVICE_CHARGE}, {RATES}, {AREA}, {LANDLORD}); the text is negotiated
// inline and exported as a PDF for the solicitors.
function HotsDialog({ unit, propertyName, isClient, onClose }: {
  unit: AvailableUnit | null; propertyName: string; isClient: boolean; onClose: () => void;
}) {
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [template, setTemplate] = useState("");
  const [editTemplate, setEditTemplate] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data, refetch } = useQuery<{ content: string | null; template: string | null; updatedAt: string | null; templateDocx?: boolean; templateDocxName?: string | null }>({
    queryKey: ["/api/available-units", unit?.id, "hots"],
    queryFn: () => fetch(`/api/available-units/${unit!.id}/hots`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()),
    enabled: !!unit,
  });
  const docxInputRef = useRef<HTMLInputElement>(null);
  const [wordBusy, setWordBusy] = useState(false);
  const uploadDocx = async (file: File) => {
    setWordBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/properties/${unit!.propertyId}/hots-docx`, { method: "POST", credentials: "include", headers: getAuthHeaders(), body: fd });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || `HTTP ${r.status}`);
      toast({ title: "Standard HOTs document saved for this property" });
      refetch();
    } catch (e: any) { toast({ title: "Upload failed", description: e.message, variant: "destructive" }); }
    finally { setWordBusy(false); }
  };
  const populateDocx = async (destination: "word" | "download") => {
    setWordBusy(true);
    try {
      const r = await fetch(`/api/available-units/${unit!.id}/hots-docx-populate`, {
        method: "POST", credentials: "include",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ destination }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || `HTTP ${r.status}`);
      if (destination === "word") {
        const out = await r.json();
        window.open(out.webUrl, "_blank");
        toast({ title: "HOTs populated from the offer", description: "Opened in Word — saved to SharePoint" });
      } else {
        const blob = await r.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `HOTs — ${propertyName} ${unit!.unitName || ""}.docx`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (e: any) { toast({ title: "Populate failed", description: e.message, variant: "destructive" }); }
    finally { setWordBusy(false); }
  };
  useEffect(() => {
    setContent(data?.content || "");
    setTemplate(data?.template || "");
  }, [data, unit?.id]);

  const call = async (method: string, url: string, body?: any) => {
    const r = await fetch(url, {
      method,
      credentials: "include",
      headers: { ...getAuthHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || `HTTP ${r.status}`);
    return r.json();
  };

  if (!unit) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileBadge className="h-4 w-4" />
            Heads of Terms — {propertyName}{unit.unitName ? ` · ${unit.unitName}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Word-document flow: the standard set uploaded once per property,
              populated per unit from the best offer, edited in Word Online. */}
          <div className="flex items-center gap-2 flex-wrap rounded-md border border-dashed px-3 py-2">
            <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            {data?.templateDocx ? (
              <>
                <span className="text-xs text-muted-foreground truncate max-w-[220px]" title={data.templateDocxName || ""}>
                  {data.templateDocxName || "Standard HOTs.docx"}
                </span>
                <Button size="sm" className="h-7 text-xs" disabled={wordBusy} onClick={() => populateDocx("word")} data-testid="hots-docx-word">
                  {wordBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                  Populate from offer → open in Word
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={wordBusy} onClick={() => populateDocx("download")} data-testid="hots-docx-download">
                  Download .docx
                </Button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">No standard HOTs document for this property yet</span>
            )}
            {!isClient && (
              <>
                <button type="button" className="text-[11px] text-primary hover:underline ml-auto" onClick={() => docxInputRef.current?.click()} data-testid="hots-docx-upload">
                  {data?.templateDocx ? "Replace document" : "Upload standard HOTs (.docx)"}
                </button>
                <input ref={docxInputRef} type="file" accept=".docx" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDocx(f); e.target.value = ""; }} />
              </>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm" variant="outline" className="h-7 text-xs" disabled={busy}
              onClick={async () => {
                if (content.trim() && !window.confirm("Replace the current HOTs with a fresh copy of the property standard?")) return;
                setBusy(true);
                try {
                  const out = await call("POST", `/api/available-units/${unit.id}/hots/populate`);
                  setContent(out.content || "");
                  toast({ title: "HOTs populated from the property standard" });
                } catch (e: any) { toast({ title: "Populate failed", description: e.message, variant: "destructive" }); }
                finally { setBusy(false); }
              }}
              data-testid="hots-populate"
            >
              Populate from standard
            </Button>
            <Button
              size="sm" className="h-7 text-xs" disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await call("PUT", `/api/available-units/${unit.id}/hots`, { content });
                  toast({ title: "HOTs saved" });
                  refetch();
                } catch (e: any) { toast({ title: "Save failed", description: e.message, variant: "destructive" }); }
                finally { setBusy(false); }
              }}
              data-testid="hots-save"
            >
              Save
            </Button>
            <a
              href={`/api/available-units/${unit.id}/hots/pdf`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center h-7 px-2.5 rounded-md border text-xs hover:bg-muted"
              data-testid="hots-pdf"
            >
              Download PDF
            </a>
            {!isClient && (
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground underline ml-auto"
                onClick={() => setEditTemplate(v => !v)}
              >
                {editTemplate ? "Hide standard template" : "Edit property standard"}
              </button>
            )}
          </div>
          {editTemplate && !isClient && (
            <div className="space-y-1.5 rounded-md border p-2 bg-muted/30">
              <p className="text-[11px] text-muted-foreground">
                Standard HOTs for {propertyName} — placeholders {"{PROPERTY} {UNIT} {LANDLORD} {TENANT} {RENT} {SERVICE_CHARGE} {RATES} {AREA}"} fill from the unit and deal on Populate.
              </p>
              <Textarea value={template} onChange={e => setTemplate(e.target.value)} rows={10} className="font-mono text-xs" placeholder="Paste or write the property's standard Heads of Terms…" />
              <Button
                size="sm" variant="outline" className="h-7 text-xs" disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await call("PUT", `/api/properties/${unit.propertyId}/hots-template`, { template });
                    toast({ title: "Standard HOTs saved for this property" });
                  } catch (e: any) { toast({ title: "Save failed", description: e.message, variant: "destructive" }); }
                  finally { setBusy(false); }
                }}
              >
                Save standard template
              </Button>
            </div>
          )}
          <Textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={22}
            className="font-mono text-xs leading-relaxed"
            placeholder={`No HOTs on this unit yet — click "Populate from standard" to pull the property's standard terms with this deal's details filled in.`}
            data-testid="hots-content"
          />
          {data?.updatedAt && (
            <p className="text-[10px] text-muted-foreground">Last saved {new Date(data.updatedAt).toLocaleString("en-GB")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UnitMatchesDialog({ unit, onClose }: { unit: AvailableUnit | null; onClose: () => void }) {
  const { data: matches = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/available-units/matches", unit?.id],
    queryFn: async () => {
      if (!unit?.id) return [];
      const res = await fetch(`/api/available-units/matches/${unit.id}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!unit?.id,
  });

  return (
    <Dialog open={!!unit} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Matching Requirements</DialogTitle>
          <DialogDescription>
            Requirements matching "{unit?.unitName}" by use class and location
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[400px]">
          {isLoading ? (
            <div className="space-y-2 p-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : matches.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">No matching requirements found</p>
              <p className="text-xs text-muted-foreground mt-1">No requirements currently match this unit's criteria</p>
            </div>
          ) : (
            <div className="space-y-1 p-1">
              {matches.map((req: any) => (
                <div key={req.id} className="flex items-center justify-between p-3 rounded-md border hover:bg-muted/50 transition-colors" data-testid={`match-req-${req.id}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{req.name}</p>
                    <p className="text-xs text-muted-foreground">{req.company_name || "Unknown"} · {(req.use || []).join(", ") || "Any use"}</p>
                    {req.requirement_locations && req.requirement_locations.length > 0 && <p className="text-[10px] text-muted-foreground">{req.requirement_locations.join(", ")}</p>}
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    {req.size && req.size.length > 0 && <p className="text-xs font-medium">{req.size.join(", ")}</p>}
                    <Badge variant="outline" className="text-[9px] mt-0.5">{req.status || "Active"}</Badge>
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

// Client company + client-side contact merged into one column (Woody,
// 2026-09-01 "combine the client with the client contact"). The contact is
// stored per target (unit_brief_targets.clientContactId) — this line shows
// the first target's contact and saves to every target so the unit reads as
// one client line. Hidden until the unit has a target to store it on.
function UnitClientContactLine({ targets, clientCompanyId, onChanged }: {
  targets: any[];
  clientCompanyId: string | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const { data: clientContacts = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/contacts", "by-company", clientCompanyId],
    queryFn: async () => {
      const r = await fetch(`/api/crm/contacts?companyId=${clientCompanyId}&limit=500`, { headers: getAuthHeaders() });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : (d.contacts || []);
    },
    enabled: !!clientCompanyId && targets.length > 0,
    staleTime: 60_000,
  });
  const current = targets.find((t: any) => t.clientContactId)?.clientContactId || null;
  const options = useMemo(() => {
    const all = clientContacts
      .map((c: any) => ({ id: String(c.id), name: c.name || [c.firstName, c.lastName].filter(Boolean).join(" "), role: String(c.role || "").trim().toLowerCase() }))
      .filter(c => c.name);
    // Directors only where the client has them — same rule as the old
    // Client Contact column (Woody, 2026-08-04).
    const directors = all.filter(c => c.role === "director");
    let pool = directors.length > 0 ? directors : all;
    if (current && !pool.some(c => c.id === String(current))) {
      const cur = all.find(c => c.id === String(current));
      if (cur) pool = [...pool, cur];
    }
    return pool.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [clientContacts, current]);
  if (!clientCompanyId || targets.length === 0) return null;
  const save = async (v: string | null) => {
    try {
      await Promise.all(targets.map((t: any) => apiRequest("PATCH", `/api/unit-briefs/targets/${t.id}`, { clientContactId: v })));
      onChanged();
    } catch (e: any) {
      toast({ title: "Couldn't update client contact", description: e?.message, variant: "destructive" });
    }
  };
  return (
    <div className="text-xs text-muted-foreground">
      <InlineLinkSelect
        value={current}
        options={options}
        href={current ? `/contacts/${current}` : undefined}
        onSave={save}
        placeholder="Link contact"
      />
    </div>
  );
}

function MarketingFilesDialog({
  unit, files, propertyName, isClient, onClose,
}: {
  unit: AvailableUnit | null;
  files: UnitMarketingFile[];
  propertyName: string;
  isClient: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // The pills FILTER the list (and aim uploads) — they looked like filters
  // and weren't, which read as broken (Woody, 2026-09-01). Files sit front
  // and centre; the info-sheet generator collapses below them.
  const [section, setSection] = useState<"all" | "brochure" | "floorplan" | "photo">("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetOpts, setSheetOpts] = useState({ floorplans: true, schemePlan: true, brochure: false, photos: true });
  const [generatingSheet, setGeneratingSheet] = useState(false);
  // In-app preview instead of window.open — in the iOS home-screen app a
  // window.open'd PDF takes over the whole webview with no back button
  // (Woody, 2026-09-01, stuck on the Westgate scheme plan).
  const [preview, setPreview] = useState<{ url: string; name: string; kind: "pdf" | "image" } | null>(null);

  const fetchFileBlobUrl = useCallback(async (filePath: string) => {
    // Fetched to a blob URL so auth travels with it in every context —
    // pdfjs/img requests don't carry the bearer token on their own.
    const res = await fetch(filePath, { credentials: "include", headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return URL.createObjectURL(await res.blob());
  }, []);

  const closePreview = useCallback(() => {
    setPreview(p => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
  }, []);

  const downloadBlob = useCallback(async (filePath: string, fileName: string) => {
    try {
      const objUrl = await fetchFileBlobUrl(filePath);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = fileName || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
    } catch (e: any) {
      toast({ title: "Download failed", description: e.message, variant: "destructive" });
    }
  }, [fetchFileBlobUrl, toast]);

  const openFile = useCallback(async (f: UnitMarketingFile | { filePath: string; fileName: string; mimeType?: string | null }) => {
    const kind = f.mimeType?.includes("pdf") ? "pdf" : f.mimeType?.startsWith("image/") ? "image" : null;
    if (!kind) return downloadBlob(f.filePath, f.fileName);
    try {
      const objUrl = await fetchFileBlobUrl(f.filePath);
      setPreview({ url: objUrl, name: f.fileName, kind });
    } catch (e: any) {
      toast({ title: "Could not open file", description: e.message, variant: "destructive" });
    }
  }, [downloadBlob, fetchFileBlobUrl, toast]);

  // Scheme plans live on the property record — count them so the info
  // sheet tick-box can say what exists.
  const { data: schemePlansData } = useQuery<{ plans: any[] }>({
    queryKey: ["/api/properties", unit?.propertyId, "plans"],
    queryFn: async () => {
      const r = await fetch(`/api/properties/${unit!.propertyId}/plans`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return { plans: [] };
      return r.json();
    },
    enabled: !!unit?.propertyId,
    staleTime: 60_000,
  });
  const schemePlanCount = schemePlansData?.plans?.length || 0;

  const catOf = (f: UnitMarketingFile) => (((f as any).category === "brochure" && f.mimeType?.startsWith("image/")) ? "photo" : ((f as any).category || "brochure"));
  const counts = {
    floorplans: files.filter(f => catOf(f) === "floorplan").length,
    brochure: files.filter(f => catOf(f) === "brochure" && (f.fileType || "") !== "infosheet").length,
    photos: files.filter(f => catOf(f) === "photo").length,
  };

  const generateSheet = useCallback(async () => {
    if (!unit) return;
    setGeneratingSheet(true);
    try {
      const res = await apiRequest("POST", `/api/available-units/${unit.id}/info-sheet`, sheetOpts);
      const j = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", unit.id, "files"] });
      toast({ title: "Info sheet created", description: `${j.pages} page${j.pages !== 1 ? "s" : ""} — saved to this unit's Files` });
      if (j.file?.filePath) openFile({ filePath: j.file.filePath, fileName: j.file.fileName || "Info sheet", mimeType: "application/pdf" });
    } catch (e: any) {
      toast({ title: "Info sheet failed", description: e.message, variant: "destructive" });
    } finally {
      setGeneratingSheet(false);
    }
  }, [unit, sheetOpts, toast, openFile]);

  const uploadFile = useCallback(async (file: globalThis.File) => {
    if (!unit) return;
    setUploading(true);
    try {
      // Active section aims the upload; on "All", images land in Photos
      // and documents in Brochures.
      const category = section !== "all" ? section : (file.type.startsWith("image/") ? "photo" : "brochure");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", category);
      const res = await fetch(`/api/available-units/${unit.id}/files`, {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: { ...getAuthHeaders() },
      });
      if (!res.ok) throw new Error("Upload failed");
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", unit.id, "files"] });
      toast({ title: "File uploaded" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [unit, toast, section]);

  const moveFile = useCallback(async (fileId: string, category: string) => {
    if (!unit) return;
    try {
      await apiRequest("PATCH", `/api/available-units/files/${fileId}`, { category });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", unit.id, "files"] });
    } catch (e: any) {
      toast({ title: "Couldn't move file", description: e.message, variant: "destructive" });
    }
  }, [unit, toast]);

  const deleteFile = useCallback(async (fileId: string) => {
    if (!unit) return;
    try {
      await apiRequest("DELETE", `/api/available-units/files/${fileId}`);
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", unit.id, "files"] });
      toast({ title: "File removed" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }, [unit, toast]);

  const getFileIcon = (mimeType: string | null) => {
    if (mimeType?.startsWith("image/")) return "🖼️";
    if (mimeType?.includes("pdf")) return "📄";
    if (mimeType?.includes("word") || mimeType?.includes("document")) return "📝";
    if (mimeType?.includes("excel") || mimeType?.includes("spreadsheet")) return "📊";
    return "📎";
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <>
    <Dialog open={!!unit} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 shrink-0" />
            Files
          </DialogTitle>
          <DialogDescription className="truncate">
            {unit?.unitName} · {propertyName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Files come first (Woody, 2026-09-01: "file share front and
              central"). The pills genuinely FILTER the list and aim
              uploads; the info-sheet generator collapses below. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill active={section === "all"} onClick={() => setSection("all")} data-testid="files-cat-all">
              All <span className="opacity-70 font-mono tabular-nums">{files.length}</span>
            </Pill>
            {([["brochure", "Brochures"], ["floorplan", "Floor plans"], ["photo", "Photos"]] as const).map(([key, label]) => (
              <Pill key={key} active={section === key} onClick={() => setSection(key)} data-testid={`files-cat-${key}`}>
                {label} <span className="opacity-70 font-mono tabular-nums">{files.filter(f => catOf(f) === key).length}</span>
              </Pill>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
                e.target.value = "";
              }}
              data-testid="input-upload-marketing-file"
            />
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-2"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              data-testid="button-upload-brochure"
            >
              <Upload className="h-4 w-4" />
              {uploading ? "Uploading..." : `Upload ${section === "all" ? "file" : section === "floorplan" ? "floor plan" : section}`}
            </Button>
            {/* Doc Studio is a staff surface — /templates isn't in
                CLIENT_ALLOWED_ROUTES, so for clients the button opened a
                tab that bounced straight to their dashboard (r452). */}
            {!isClient && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-2"
              onClick={() => {
                window.open("/templates", "_blank");
              }}
              data-testid="button-create-doc-studio"
            >
              <Sparkles className="h-4 w-4" />
              Create in Doc Studio
            </Button>
            )}
          </div>

          {files.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <File className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No files yet</p>
              <p className="text-xs mt-1">{isClient ? "Upload a brochure, floor plan or photo" : "Upload a brochure, floor plan or photo — or create one in Document Studio"}</p>
            </div>
          ) : (
            // plain overflow div, not ScrollArea — Radix's display:table
            // viewport sizes to the untruncated filename and pushes the
            // dialog wider than the phone (r438)
            <div className="max-h-[45dvh] overflow-y-auto">
              <div className="space-y-3">
                {([["brochure", "Brochures"], ["floorplan", "Floor plans"], ["photo", "Photos"], ["other", "Other"]] as const).map(([key, heading]) => {
                  if (section !== "all" && key !== section) return null;
                  const sectionFiles = files.filter(f => catOf(f) === key);
                  if (sectionFiles.length === 0) return null;
                  return (
                    <div key={key}>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{heading} · {sectionFiles.length}</p>
                      <div className="space-y-2">
                        {sectionFiles.map(f => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer"
                    onClick={() => openFile(f)}
                    data-testid={`file-item-${f.id}`}
                  >
                    <span className="text-lg shrink-0">{getFileIcon(f.mimeType)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{f.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatSize(f.fileSize)}
                        {f.createdAt && ` · ${new Date(f.createdAt).toLocaleDateString("en-GB")}`}
                      </p>
                    </div>
                    {/* Always visible — hover-only actions don't exist on
                        a phone (Woody, 2026-09-01). */}
                    <div className="flex gap-0.5 shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={(e) => e.stopPropagation()}
                            title="Move to another section"
                            data-testid={`button-move-file-${f.id}`}
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          {([["brochure", "Move to Brochures"], ["floorplan", "Move to Floor plans"], ["photo", "Move to Photos"], ["other", "Move to Other"]] as const)
                            .filter(([k]) => k !== catOf(f))
                            .map(([k, label]) => (
                              <DropdownMenuItem key={k} onClick={() => moveFile(f.id, k)} data-testid={`move-file-${f.id}-${k}`}>
                                {label}
                              </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={(e) => { e.stopPropagation(); downloadBlob(f.filePath, f.fileName); }}
                        title="Download"
                        data-testid={`button-download-${f.id}`}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive"
                        onClick={(e) => { e.stopPropagation(); deleteFile(f.id); }}
                        title="Remove"
                        data-testid={`button-remove-file-${f.id}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Info sheet — collapsed below the files (Woody, 2026-09-01:
              files front and centre, "info sheet generate as an
              expansion"). Output saves back into these Files. */}
          <div className="border rounded-lg" data-testid="info-sheet-panel">
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold"
              onClick={() => setSheetOpen(o => !o)}
              data-testid="button-toggle-info-sheet"
            >
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Info sheet — branded PDF for agents/tenants
              </span>
              {sheetOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            </button>
            {sheetOpen && (
              <div className="px-3 pb-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {([
                    ["floorplans", `Unit floor plans (${counts.floorplans})`, counts.floorplans > 0],
                    ["schemePlan", `Scheme plan (${schemePlanCount})`, schemePlanCount > 0],
                    ["brochure", `Brochure (${counts.brochure})`, counts.brochure > 0],
                    ["photos", `Photos (${Math.min(counts.photos, 6)})`, counts.photos > 0],
                  ] as const).map(([key, label, available]) => (
                    <label key={key} className={`flex items-center gap-2 text-xs ${available ? "text-foreground cursor-pointer" : "text-muted-foreground/50"}`}>
                      {/* data-no-min-touch: the mobile 44px tap-target rule
                          ballooned these into tall bars — h-3.5 doesn't match
                          the rule's h-4 size-class exemption. */}
                      <Checkbox
                        className="h-4 w-4 shrink-0"
                        data-no-min-touch
                        disabled={!available}
                        checked={available && sheetOpts[key]}
                        onCheckedChange={(v) => setSheetOpts(o => ({ ...o, [key]: v === true }))}
                        data-testid={`sheet-inc-${key}`}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <Button size="sm" className="w-full gap-2" onClick={generateSheet} disabled={generatingSheet} data-testid="button-generate-info-sheet">
                  <FileText className="h-4 w-4" />
                  {generatingSheet ? "Generating…" : "Generate info sheet PDF"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <PDFViewer
      url={preview?.kind === "pdf" ? preview.url : ""}
      fileName={preview?.name || "File"}
      open={preview?.kind === "pdf"}
      onClose={closePreview}
      propertyName={propertyName}
    />

    <Dialog open={preview?.kind === "image"} onOpenChange={v => { if (!v) closePreview(); }}>
      <DialogContent className="max-w-full sm:max-w-[90vw] xl:max-w-[1200px] w-full p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
          <DialogTitle className="text-sm font-medium truncate pr-8">{preview?.name}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[80dvh] overflow-auto bg-muted/30 flex items-center justify-center p-2">
          {preview?.kind === "image" && (
            <img src={preview.url} alt={preview.name} className="max-w-full max-h-[76dvh] object-contain rounded" />
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

function UnitFormDialog({
  open, onOpenChange, title, form, setForm, properties, propertyUnits = [], bgpUsers, crmCompanies = [],
  feeRows, setFeeRows, feeAllocType, setFeeAllocType,
  showAllFields, setShowAllFields, isEdit,
  onSubmit, isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  form: UnitFormState;
  setForm: (f: UnitFormState) => void;
  properties: CrmProperty[];
  propertyUnits?: PropertyUnit[];
  bgpUsers: { id: string; name: string }[];
  crmCompanies?: CrmCompany[];
  feeRows: FeeAllocationRow[];
  setFeeRows: (r: FeeAllocationRow[]) => void;
  feeAllocType: "percentage" | "fixed";
  setFeeAllocType: (t: "percentage" | "fixed") => void;
  showAllFields: boolean;
  setShowAllFields: (v: boolean) => void;
  isEdit: boolean;
  onSubmit: () => void;
  isPending: boolean;
}) {
  const upd = (field: keyof UnitFormState, value: string) => setForm({ ...form, [field]: value });

  // Tenancy schedule is the canonical unit source. When a property
  // is picked, we fetch its tenancy rows and let the user pick from
  // there — picking pre-fills sqft/use from the tenancy row, and the
  // server stamps tenancy_unit_id on the new available_units row.
  // Falls back to property_units for legacy properties without a
  // tenancy schedule yet.
  const { data: tenancyUnits = [] } = useQuery<Array<{
    id: string | number; unit_number: string; premises: string | null;
    permitted_use: string | null; nia_sqft: number | null; gia_sqft: number | null;
    floor_level: string | null; status: string | null; tenant_name: string | null;
    marketing_rent_pa: number | null; rates_payable: number | null;
    service_charge: number | null; epc_rating: string | null;
  }>>({
    queryKey: ["/api/tenancy-schedule/property", form.propertyId],
    queryFn: async () => {
      if (!form.propertyId) return [];
      const r = await fetch(`/api/tenancy-schedule/property/${form.propertyId}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!form.propertyId && open,
    staleTime: 60_000,
  });

  // Merge tenancy + property_units into one canonical list, tenancy
  // first. De-dupe by lowercased unit name so a property_units row
  // that already appears in tenancy doesn't double up.
  const pickerOptions = (() => {
    const seen = new Set<string>();
    const out: Array<{
      id: string; name: string; floor: string | null; sqft: number | null;
      useClass: string | null; askingRent: number | null; ratesPa: number | null;
      serviceChargePa: number | null; epcRating: string | null;
      source: "tenancy" | "property"; vacant?: boolean;
    }> = [];
    for (const t of tenancyUnits) {
      const key = (t.unit_number || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const isVacant = (t.status || "").toLowerCase() === "vacant" || (t.tenant_name || "").toLowerCase() === "vacant";
      out.push({
        id: String(t.id),
        name: t.unit_number,
        floor: t.floor_level || t.premises,
        sqft: t.nia_sqft || t.gia_sqft,
        useClass: t.permitted_use,
        askingRent: t.marketing_rent_pa,
        ratesPa: t.rates_payable,
        serviceChargePa: t.service_charge,
        epcRating: t.epc_rating,
        source: "tenancy",
        vacant: isVacant,
      });
    }
    const legacyUnits = form.propertyId ? propertyUnits.filter(pu => pu.propertyId === form.propertyId) : [];
    for (const pu of legacyUnits) {
      const key = (pu.unitName || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: pu.id,
        name: pu.unitName,
        floor: pu.floor || null,
        sqft: pu.sqft ?? null,
        useClass: pu.useClass || null,
        askingRent: null,
        ratesPa: null,
        serviceChargePa: null,
        epcRating: null,
        source: "property",
      });
    }
    return out;
  })();
  const matchedExistingUnit = pickerOptions.find(
    pu => pu.name.trim().toLowerCase() === (form.unitName || "").trim().toLowerCase()
  );

  const updSel = (field: keyof UnitFormState, value: string) => setForm({ ...form, [field]: value === "__none__" ? "" : value });
  const noneItem = <SelectItem value="__none__"><span className="text-muted-foreground">— None —</span></SelectItem>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[700px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Saving will auto-create a linked Leasing deal on the <a href="/deals" className="underline">deals board</a>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Property *</Label>
            <PropertyCombobox
              testId="select-property"
              placeholder="Select property or paste an address"
              value={form.propertyId}
              items={properties.map(p => ({
                id: p.id,
                label: p.name,
                subLabel: p.postcode || undefined,
                keywords: [p.postcode || "", p.address ? JSON.stringify(p.address) : ""],
              }))}
              onChange={(val) => {
                // Auto-fill the Landlord picker from the picked
                // property's landlord_id. User can override below. Only
                // overrides when the user hasn't already touched the
                // landlord field, so previously-picked landlords on a
                // re-pick survive.
                const prop = properties.find(p => p.id === val);
                const propLandlordId = (prop as any)?.landlordId || "";
                const landlordBrand = propLandlordId
                  ? crmCompanies.find(c => c.id === propLandlordId)
                  : null;
                setForm({
                  ...form,
                  propertyId: val || "",
                  landlordId: form.landlordId || propLandlordId,
                  landlordName: form.landlordName || landlordBrand?.name || "",
                });
              }}
              onCreated={() => {
                // Newly-created property won't be in `properties` yet —
                // PropertyCombobox holds the row internally so the
                // trigger label stays correct until the cache refetch
                // catches up.
                queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
              }}
            />
          </div>
          {/* Landlord (the client for a Letting deal). Auto-pre-filled
              from the picked property's landlord_id; user can swap to a
              different brand or create one inline. No Xero billing
              entity at this stage — that's a SOL-handover concern, not
              an AVA one. */}
          <div className="col-span-2">
            <Label>Landlord (client)</Label>
            <EntityCombobox
              testId="select-unit-landlord"
              placeholder="Link landlord"
              searchPlaceholder="Search landlords…"
              value={form.landlordId}
              items={crmCompanies
                .filter(c =>
                  c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client"
                  || c.id === form.landlordId
                )
                .map(c => ({
                  id: c.id,
                  label: c.name,
                  subLabel: (c as any).ukEntityName || c.companyType || undefined,
                  keywords: [c.companyType || "", c.domainUrl || ""].filter(Boolean),
                }))}
              onChange={(v) => {
                const picked = crmCompanies.find(c => c.id === v);
                setForm({
                  ...form,
                  landlordId: v,
                  landlordName: picked?.name || "",
                });
              }}
              onCreate={async (name) => {
                const r = await apiRequest("POST", "/api/crm/companies", {
                  name: name.trim(),
                  companyType: "Landlord",
                });
                const created = await r.json();
                queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
                return { id: String(created.id), label: created.name, subLabel: created.companyType };
              }}
              createLabel="landlord"
            />
            {!form.landlordId && form.propertyId && (
              <p className="text-[10px] text-amber-700 mt-0.5">
                No landlord linked to this property — picking one here will also stamp it on the property going forward.
              </p>
            )}
          </div>
          <div>
            <Label>Deal Type *</Label>
            <Select value={form.dealType} onValueChange={v => upd("dealType", v)}>
              <SelectTrigger data-testid="select-deal-type"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {CRM_OPTIONS.dealType.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Unit Name / Number *</Label>
            <EntityCombobox
              testId="input-unit-name"
              placeholder={form.propertyId ? "Pick a unit or type a new name" : "Select a property first"}
              searchPlaceholder="Search units on this property…"
              emptyText="No units yet — type a name to create one"
              disabled={!form.propertyId}
              value={form.unitName}
              items={pickerOptions.map(pu => ({
                id: pu.name,
                label: pu.name,
                subLabel: [
                  pu.source === "tenancy" ? "tenancy" : "legacy",
                  pu.vacant ? "vacant" : null,
                  pu.floor || null,
                  pu.sqft != null ? `${pu.sqft.toLocaleString()} sq ft` : null,
                ].filter(Boolean).join(" · ") || undefined,
                keywords: [pu.useClass || ""].filter(Boolean),
              }))}
              onChange={(name) => {
                // Picking an existing unit pre-fills every field the tenancy
                // spine already knows so Layla doesn't re-type them — only
                // empty fields are filled, anything already typed wins. A name
                // that matches nothing (typed new) just sets the unit name.
                const pu = pickerOptions.find(o => o.name === name);
                if (pu) {
                  setForm({
                    ...form,
                    unitName: pu.name,
                    floor: form.floor || pu.floor || "",
                    sqft: form.sqft || (pu.sqft != null ? String(pu.sqft) : ""),
                    useClass: form.useClass || pu.useClass || "",
                    askingRent: form.askingRent || (pu.askingRent != null ? String(pu.askingRent) : ""),
                    ratesPa: form.ratesPa || (pu.ratesPa != null ? String(pu.ratesPa) : ""),
                    serviceChargePa: form.serviceChargePa || (pu.serviceChargePa != null ? String(pu.serviceChargePa) : ""),
                    epcRating: form.epcRating || pu.epcRating || "",
                  });
                } else {
                  setForm({ ...form, unitName: name });
                }
              }}
              onCreate={async (name) => {
                // "Create" just adopts the typed name — the available_units
                // row is written on Save, not now.
                const clean = name.trim();
                return { id: clean, label: clean };
              }}
              createLabel="unit"
            />
            {form.unitName && !matchedExistingUnit && pickerOptions.length > 0 && (
              <p className="text-[10px] text-emerald-600 mt-0.5">New unit — will be created. Add to the tenancy schedule next so it lives on the spine.</p>
            )}
            {matchedExistingUnit?.source === "tenancy" && (
              <p className="text-[10px] text-purple-700 mt-0.5">Tenancy schedule unit — canonical link will be stamped.</p>
            )}
            {matchedExistingUnit?.source === "property" && (
              <p className="text-[10px] text-muted-foreground mt-0.5">Legacy property_units row — add to the tenancy schedule to make it canonical.</p>
            )}
          </div>
          <div>
            <Label>Floor</Label>
            <Select value={form.floor} onValueChange={v => updSel("floor", v)}>
              <SelectTrigger><SelectValue placeholder="Select floor..." /></SelectTrigger>
              <SelectContent>
                {noneItem}
                {FLOORS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Size (sq ft)</Label>
            <CurrencyInput value={form.sqft} onChange={v => upd("sqft", v)} placeholder="e.g. 1,500" />
          </div>
          <div>
            <Label>Unit Status</Label>
            {(() => {
              const code = legacyToCode(form.marketingStatus) || "AVA";
              // Past marketing the deal drives — freeze the field so saving
              // the dialog can't regress the deal via the status mirror.
              if (!UNIT_STAGE_EDITABLE.has(code)) {
                return (
                  <div className="h-9 flex items-center px-3 text-sm text-muted-foreground border rounded-md bg-muted/40">
                    {DEAL_STATUS_LABELS[code]} — driven by the deal
                  </div>
                );
              }
              return (
                <Select value={code === "OPP" ? "OPP" : "AVA"} onValueChange={v => upd("marketingStatus", v)}>
                  <SelectTrigger><SelectValue placeholder="Status..." /></SelectTrigger>
                  <SelectContent>
                    {UNIT_STATUSES.map(s => <SelectItem key={s} value={s}>{DEAL_STATUS_LABELS[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              );
            })()}
          </div>
          <div className="min-w-0">
            <Label>Available Date</Label>
            <Input type="date" className="min-w-0" value={form.availableDate} onChange={e => upd("availableDate", e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>BGP Contact</Label>
            {/* Same DropdownMenu pattern as the New Deal dialog so the
                two forms feel like one. Stores agentUserIds (user IDs)
                rather than names, since the server keyed off IDs. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-start font-normal h-auto min-h-[36px] py-1.5" data-testid="input-unit-agent">
                  {form.agentUserIds.length === 0 ? (
                    <span className="text-muted-foreground">Select BGP contacts…</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {form.agentUserIds.map(id => {
                        const u = bgpUsers.find(bu => bu.id === id);
                        return (
                          <Badge key={id} variant="secondary" className="text-xs">{u?.name || id}</Badge>
                        );
                      })}
                    </div>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 max-h-[300px] overflow-y-auto">
                {[...bgpUsers].sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(u => {
                  const selected = form.agentUserIds.includes(u.id);
                  return (
                    <DropdownMenuItem
                      key={u.id}
                      onClick={() => {
                        const next = selected
                          ? form.agentUserIds.filter(id => id !== u.id)
                          : [...form.agentUserIds, u.id];
                        setForm({ ...form, agentUserIds: next });
                      }}
                      data-testid={`agent-option-${u.id}`}
                    >
                      <div className={`w-3 h-3 rounded-sm border mr-2 flex items-center justify-center ${selected ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                        {selected && <span className="text-primary-foreground text-[8px]">✓</span>}
                      </div>
                      <span className="truncate">{u.name}</span>
                    </DropdownMenuItem>
                  );
                })}
                {form.agentUserIds.length > 0 && (
                  <DropdownMenuItem onClick={() => setForm({ ...form, agentUserIds: [] })} data-testid="agent-clear-all">
                    <X className="w-3 h-3 mr-2 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Clear all</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {/* Financials & timing — same shape as the New Deal form so
              fee structure is captured up-front instead of relying on
              the agent to re-open the auto-created deal later. % drives
              Total fee from Quoting Rent × % (only overrides empty
              Total so manual numbers survive). FeeAllocationEditor
              flows to the linked deal's allocations on submit. */}
          <div className="col-span-2 border-t pt-3 space-y-3">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Financials & fee split</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Quoting Rent (£ p.a.)</Label>
                <CurrencyInput value={form.askingRent} onChange={v => upd("askingRent", v)} placeholder="e.g. 85,000" prefix="£" />
              </div>
              <div>
                <Label className="text-xs">% Agency fee</Label>
                <Input type="number" step="0.01" value={form.feePercentage}
                  onChange={(e) => {
                    const pct = e.target.value;
                    const rent = parseFloat(form.askingRent);
                    const pctNum = parseFloat(pct);
                    const next = { ...form, feePercentage: pct } as UnitFormState;
                    if (!isNaN(rent) && !isNaN(pctNum) && pctNum > 0) {
                      next.fee = String(Math.round((rent * pctNum) / 100));
                    }
                    setForm(next);
                  }}
                  placeholder="e.g. 10" />
              </div>
              <div>
                <Label className="text-xs">Total fee (£)</Label>
                <CurrencyInput value={form.fee} onChange={v => upd("fee", v)} placeholder="auto from rent × %" prefix="£" />
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
                  bgpAgents={bgpUsers.map(u => ({ id: String(u.id), name: u.name }))}
                />
              </div>
            </div>
          </div>

          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => upd("notes", e.target.value)} placeholder="Additional notes..." rows={3} />
          </div>

          {/* Less-frequently-set fields collapse behind a toggle, same
              shape Add Deal uses. Always-expanded on edit so an existing
              row isn't pretending it has no values. */}
          {!isEdit && (
            <div className="col-span-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground whitespace-normal h-auto text-left"
                onClick={() => setShowAllFields(!showAllFields)}
                data-testid="toggle-show-all-fields"
              >
                <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${showAllFields ? "rotate-180" : ""}`} />
                {showAllFields ? "Hide extra fields" : "Show all fields (rates, service charge, use class, condition, EPC, location, restrictions)"}
              </Button>
            </div>
          )}

          {showAllFields && (
            <>
              <div>
                <Label>Rates (£ p.a.)</Label>
                <CurrencyInput value={form.ratesPa} onChange={v => upd("ratesPa", v)} placeholder="e.g. 25,000" prefix="£" />
              </div>
              <div>
                <Label>Service Charge (£ p.a.)</Label>
                <CurrencyInput value={form.serviceChargePa} onChange={v => upd("serviceChargePa", v)} placeholder="e.g. 15,000" prefix="£" />
              </div>
              <div>
                <Label>Use Class</Label>
                <Select value={form.useClass} onValueChange={v => upd("useClass", v)}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {USE_CLASSES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Condition</Label>
                <Select value={form.condition} onValueChange={v => upd("condition", v)}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>EPC Rating</Label>
                <Select value={form.epcRating} onValueChange={v => upd("epcRating", v)}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {EPC_RATINGS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Location</Label>
                <Select value={form.location} onValueChange={v => upd("location", v)}>
                  <SelectTrigger data-testid="select-location"><SelectValue placeholder="Select location..." /></SelectTrigger>
                  <SelectContent>
                    {LOCATIONS.map(l => (
                      <SelectItem key={l} value={l}>
                        <span className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${LOCATION_COLORS[l] || "bg-gray-400"}`} />
                          {l}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Marketing Start Date</Label>
                <Input type="date" value={form.marketingStartDate} onChange={e => upd("marketingStartDate", e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label>Restrictions</Label>
                <Textarea value={form.restrictions} onChange={e => upd("restrictions", e.target.value)} placeholder="Any use or tenant restrictions..." rows={2} />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSubmit} disabled={isPending || !form.unitName || !form.propertyId || !form.dealType} title={!form.dealType ? "Pick a deal type" : ""}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

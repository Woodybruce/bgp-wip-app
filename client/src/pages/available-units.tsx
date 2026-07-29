import { useQuery, useMutation } from "@tanstack/react-query";
import { ScrollableTable } from "@/components/scrollable-table";
import { PropertyPlanningCard } from "@/components/property-planning-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Search, Plus, Pencil, Trash2, Link2, ArrowRightLeft, Store, Eye, Building2,
  FileText, Upload, Sparkles, Download, X, File, Star, CalendarDays, HandCoins,
  ChevronDown, ExternalLink, AlertTriangle, FileBadge, Target,
} from "lucide-react";
import { UnitBriefDialog } from "@/components/unit-brief-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState, useMemo, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest, queryClient, getAuthHeaders, invalidateDealCaches } from "@/lib/queryClient";
import { UnifiedAddUnitDialog, UNIFIED_ADD_UNIT_ENABLED } from "@/components/unified-add-unit-dialog";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { InlineText, InlineNumber, InlineSelect, InlineLabelSelect, InlineMultiSelect, InlineLinkSelect } from "@/components/inline-edit";
import type { AvailableUnit, CrmProperty, CrmDeal, CrmCompany, CrmContact, UnitMarketingFile, UnitViewing, UnitOffer, PropertyUnit } from "@shared/schema";
import { useTeam } from "@/lib/team-context";
import { CRM_OPTIONS, areaBasisFromAssetClass, isRetailAssetClass } from "@/lib/crm-options";
import { DEAL_TYPE_COLORS, DEAL_TEAM_COLORS } from "@/pages/deals";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { PropertyCombobox } from "@/components/property-combobox";
import { EntityCombobox } from "@/components/entity-combobox";
import { XeroContactPicker } from "@/components/xero-contact-picker";
import { FeeAllocationEditor, type FeeAllocationRow } from "@/components/fee-allocation-editor";

import { LETTING_STATUSES, DEAL_STATUS_LABELS, legacyToCode, type DealStatusCode } from "@shared/deal-status";
const MARKETING_STATUSES = LETTING_STATUSES;
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
import { DEAL_STATUS_BADGE_COLORS as STATUS_COLORS, DEAL_STATUS_DOT_COLORS as STATUS_LABEL_COLORS } from "@/lib/deal-status-colors";

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

function CrmPicker({ items, value, valueName, onSelect, placeholder, testId }: {
  items: { id: string; name: string }[];
  value: string;
  valueName: string;
  onSelect: (id: string, name: string) => void;
  placeholder: string;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search) return items.slice(0, 50);
    const q = search.toLowerCase();
    return items.filter(i => i.name.toLowerCase().includes(q)).slice(0, 50);
  }, [items, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start font-normal h-9 text-sm truncate" data-testid={testId}>
          {valueName || <span className="text-muted-foreground">{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[280px]" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={`Search ${placeholder.toLowerCase()}...`} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>No results</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem onSelect={() => { onSelect("", ""); setOpen(false); setSearch(""); }} className="text-muted-foreground text-xs">
                  Clear selection
                </CommandItem>
              )}
              {filtered.map(i => (
                <CommandItem key={i.id} onSelect={() => { onSelect(i.id, i.name); setOpen(false); setSearch(""); }}>
                  {i.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [propertyFilter, setPropertyFilter] = useState("all");
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
  const [briefUnit, setBriefUnit] = useState<AvailableUnit | null>(null);
  const [viewingsUnit, setViewingsUnit] = useState<AvailableUnit | null>(null);
  const [offersUnit, setOffersUnit] = useState<AvailableUnit | null>(null);
  const [addViewingOpen, setAddViewingOpen] = useState(false);
  const [addOfferOpen, setAddOfferOpen] = useState(false);
  const [viewingForm, setViewingForm] = useState({ companyName: "", companyId: "", contactName: "", contactId: "", viewingDate: "", viewingTime: "", attendees: "", notes: "", outcome: "" });
  const [offerForm, setOfferForm] = useState({ companyName: "", companyId: "", contactName: "", contactId: "", offerDate: "", rentPa: "", rentFreeMonths: "", termYears: "", breakOption: "", incentives: "", premium: "", fittingOutContribution: "", comments: "" });
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

  const { data: units = [], isLoading } = useQuery<AvailableUnit[]>({
    queryKey: ["/api/available-units"],
  });

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

  const addViewingMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/available-units/${viewingsUnit?.id}/viewings`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", viewingsUnit?.id, "viewings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-viewings-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/available-units/all-viewings"] });
      setAddViewingOpen(false);
      setViewingForm({ companyName: "", companyId: "", contactName: "", contactId: "", viewingDate: "", viewingTime: "", attendees: "", notes: "", outcome: "" });
      toast({ title: "Viewing added" });
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
      setOfferForm({ companyName: "", companyId: "", contactName: "", contactId: "", offerDate: "", rentPa: "", rentFreeMonths: "", termYears: "", breakOption: "", incentives: "", premium: "", fittingOutContribution: "", comments: "" });
      toast({ title: "Offer added" });
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

  const dealMap = useMemo(() => {
    const m: Record<string, CrmDeal> = {};
    for (const d of deals) m[d.id] = d;
    return m;
  }, [deals]);

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
    if (field === "marketingStatus" && legacyToCode(value) === "SOL") {
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

  const uniqueProperties = useMemo(() => {
    const ids = new Set(teamUnits.map(u => u.propertyId));
    return properties.filter(p => ids.has(p.id));
  }, [teamUnits, properties]);

  const filtered = useMemo(() => {
    let result = teamUnits;
    // The Letting Tracker is the marketing pipeline (REP / AVA / NEG). Once a
    // unit moves to Solicitors it lives on the Deals board; we hide SOL+ from
    // the default view here so the tracker stays focused. Users can still
    // click an SOL/EXC/COM pill to drill back in.
    const PRE_SOL_CODES = new Set(["REP", "SPEC", "LIVE", "AVA", "NEG"]);
    if (statusFilter !== "all") {
      result = result.filter(u => legacyToCode(u.marketingStatus) === statusFilter);
    } else {
      result = result.filter(u => {
        const code = legacyToCode(u.marketingStatus) || "AVA";
        return PRE_SOL_CODES.has(code);
      });
    }
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
  }, [teamUnits, statusFilter, propertyFilter, assetClassFilter, locationFilter, bgpTeamFilter, agentFilter, bgpUsers, search, propertyMap, dealMap, crmCompanies]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of MARKETING_STATUSES) counts[s] = 0;
    for (const u of teamUnits) {
      const code = legacyToCode(u.marketingStatus) || "AVA";
      counts[code] = (counts[code] || 0) + 1;
    }
    return counts;
  }, [teamUnits]);

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
            {teamUnits.length} unit{teamUnits.length !== 1 ? "s" : ""}
            {isClientTracker && (
              <span> — live deals in progress: units being marketed, under offer and completing. Updates flow to the Leasing Schedule and back to the Tenancy Schedule.</span>
            )}
          </p>
        </div>
        {!isClientTracker && (
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
          <Plus className="h-4 w-4 mr-1" /> Add Unit
        </Button>
        )}
      </div>

      {/* Single thin FY activity strip — was two full cards stacked
          (~240px) with bar charts that were 16px tall and rarely
          scanned beyond the headline number. Now one row carrying the
          two totals + tiny sparkline of monthly counts. */}
      {!isMobile && (
      <Card>
        <CardContent className="px-4 py-2.5 flex items-center gap-6 flex-wrap">
          <span className="text-xs text-muted-foreground">FY {currentFYStart}/{currentFYStart + 1}</span>
          {([
            { label: "Viewings", icon: CalendarDays, data: viewingsMonthly, colour: "bg-blue-500", dim: "bg-blue-200 dark:bg-blue-800" },
            { label: "Offers",   icon: HandCoins,    data: offersMonthly,   colour: "bg-amber-500", dim: "bg-amber-200 dark:bg-amber-800" },
          ] as const).map(({ label, icon: Icon, data, colour, dim }) => {
            const total = data.reduce((a, b) => a + b, 0);
            const max = Math.max(...data, 1);
            const currentMonthIdx = FY_MONTH_NUMS.indexOf(new Date().getMonth() + 1);
            return (
              <div key={label} className="flex items-center gap-2.5">
                <Icon className={`h-3.5 w-3.5 ${label === "Viewings" ? "text-blue-500" : "text-amber-500"}`} />
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
              </div>
            );
          })}
        </CardContent>
      </Card>
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
        </>)}
      </div>

      {/* KPI stat cards — matching Investment Tracker style */}
      {isMobile ? (
        <div className="flex flex-wrap gap-1.5">
          {MARKETING_STATUSES.map(s => {
            const count = teamUnits.filter(u => legacyToCode(u.marketingStatus) === s).length;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${statusFilter === s ? "border-primary bg-primary/5 font-semibold" : "text-muted-foreground"}`}
                data-testid={`stat-chip-${s.toLowerCase()}`}
              >
                <span className={`w-2 h-2 rounded-full ${STATUS_LABEL_COLORS[s] || "bg-gray-400"}`} />
                {DEAL_STATUS_LABELS[s]}
                <span className="font-bold tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      ) : (
      <ScrollArea className="w-full">
        <div className="flex items-center gap-3 pb-1">
          {MARKETING_STATUSES.map(s => {
            const count = teamUnits.filter(u => legacyToCode(u.marketingStatus) === s).length;
            return (
              <Card
                key={s}
                className={`flex-shrink-0 min-w-[120px] cursor-pointer transition-colors ${statusFilter === s ? "border-primary" : ""}`}
                onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                data-testid={`stat-card-${s.toLowerCase()}`}
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${STATUS_LABEL_COLORS[s] || "bg-gray-400"}`} />
                    <div>
                      <p className="text-lg font-bold">{count}</p>
                      <p className="text-xs text-muted-foreground">{DEAL_STATUS_LABELS[s]}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </ScrollArea>
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
                  {DEAL_STATUS_LABELS[s]}
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
            {filtered.map(u => {
              const prop = propertyMap[u.propertyId];
              const deal = u.dealId ? dealMap[u.dealId] : null;
              const code = legacyToCode(u.marketingStatus) || "AVA";
              const tenant = deal?.tenantId ? companyMap[deal.tenantId] : null;
              const rent = deal?.rentPa ?? (u as any).askingRent;
              const size = deal?.totalAreaSqft ?? u.sqft;
              const vCount = viewingsCounts[u.id] || 0;
              const oCount = offersCounts[u.id] || 0;
              const rows = [
                { label: "Area", value: size ? `${Number(size).toLocaleString()} sq ft` : null },
                { label: "Tenant", value: tenant },
                { label: "Rent p.a.", value: rent ? `£${Number(rent).toLocaleString()}` : null },
              ].filter(r => r.value);
              return (
                <div key={u.id} className="rounded-xl border bg-card p-4 space-y-3 shadow-sm" data-testid={`mobile-unit-${u.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-semibold leading-tight block truncate">{prop?.name || u.unitName || "Unit"}</span>
                      {(u.unitName || u.floor) && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{[u.unitName, u.floor].filter(Boolean).join(" · ")}</p>
                      )}
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-[10px] px-2 py-0.5 gap-1.5">
                      <span className={`inline-block w-2 h-2 rounded-full ${STATUS_LABEL_COLORS[code] || "bg-gray-400"}`} />
                      {DEAL_STATUS_LABELS[code] || code}
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
                      <Eye className="w-3.5 h-3.5" /> Brochure
                    </Button>
                    <Button variant="ghost" size="sm" className="h-9 px-2.5 text-xs gap-1.5" onClick={() => { setViewingsUnit(u); setAddViewingOpen(true); }} data-testid={`unit-viewing-${u.id}`}>
                      <CalendarDays className="w-3.5 h-3.5" /> Viewing{vCount ? ` (${vCount})` : ""}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-9 px-2.5 text-xs gap-1.5" onClick={() => { setOffersUnit(u); setAddOfferOpen(true); }} data-testid={`unit-interest-${u.id}`}>
                      <HandCoins className="w-3.5 h-3.5" /> Interest{oCount ? ` (${oCount})` : ""}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-9 px-2.5 text-xs gap-1.5" onClick={() => { setForm(unitToForm(u, u.dealId ? dealMap[u.dealId]?.dealType : null, landlordPrefillFor(u))); setEditItem(u); }} data-testid={`unit-edit-${u.id}`}>
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Button>
                  </div>
                </div>
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
                <TableHead className="w-[50px]">Ref</TableHead>
                <TableHead className="min-w-[200px]">Property / Unit</TableHead>
                <TableHead className="w-[120px]">Deal Type</TableHead>
                <TableHead className="w-[140px]">Client</TableHead>
                <TableHead className="w-[140px]">Tenant</TableHead>
                <TableHead className="w-[160px]">Team / BGP</TableHead>
                <TableHead className="min-w-[140px]">Floor Areas</TableHead>
                <TableHead className="min-w-[120px] text-right">Costs</TableHead>
                <TableHead className="min-w-[110px]">Class / Cond</TableHead>
                <TableHead>Deal Status</TableHead>
                <TableHead className="text-center min-w-[100px]">Activity</TableHead>
                <TableHead className="min-w-[120px]">Fee &amp; FA</TableHead>
                <TableHead>Files</TableHead>
                <TableHead>Brief</TableHead>
                <TableHead className="w-[100px] sticky right-0 z-20 border-l bg-card">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={16} className="text-center py-12 text-muted-foreground">
                    <Store className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    {teamUnits.length === 0 ? "No available units yet. Add your first unit to get started." : "No units match filters."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(u => {
                  const prop = propertyMap[u.propertyId];
                  const deal = u.dealId ? dealMap[u.dealId] : null;
                  return (
                    <TableRow key={u.id} className={selectedIds.has(u.id) ? "bg-primary/5" : ""} data-testid={`row-unit-${u.id}`}>
                      <TableCell className="px-2">
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
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {deal?.dealRef ? (
                          <div className="flex items-center gap-1.5">
                            <a
                              href={`/deals/${deal.id}`}
                              className="text-blue-600 hover:underline"
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
                      <TableCell className="px-1.5 py-1 max-w-[220px]">
                        <div className="flex flex-col gap-0.5">
                          <div className="text-sm font-medium truncate">
                            <InlineLinkSelect
                              value={u.propertyId}
                              options={properties.map(p => ({ id: p.id, name: p.name }))}
                              href={`/properties/${u.propertyId}`}
                              onSave={(v) => inlineUpdate(u.id, "propertyId", v || null)}
                              onCreate={async (name) => { const c = await createProperty(name); inlineUpdate(u.id, "propertyId", c.id); }}
                              placeholder="Link property"
                            />
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <InlineText
                              value={u.unitName}
                              onSave={(v) => inlineUpdate(u.id, "unitName", v)}
                              placeholder="Unit name"
                              className="text-xs"
                            />
                            <span className="text-[9px] opacity-60">·</span>
                            <InlineSelect
                              value={u.floor || ""}
                              options={FLOORS}
                              onSave={v => inlineUpdate(u.id, "floor", v)}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-1.5">
                        {deal ? (
                          <InlineLabelSelect
                            value={deal.dealType}
                            options={CRM_OPTIONS.dealType}
                            colorMap={DEAL_TYPE_COLORS}
                            onSave={(v) => dealInlineUpdate.mutate({ id: deal.id, field: "dealType", value: v || null })}
                          />
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="px-1.5 max-w-[140px]">
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
                        })() : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="px-1.5 max-w-[140px]">
                        {deal ? (
                          <InlineLinkSelect
                            value={deal.tenantId}
                            options={crmCompanies.map(c => ({ id: c.id, name: c.name }))}
                            href={deal.tenantId ? `/companies/${deal.tenantId}` : undefined}
                            onSave={(v) => dealInlineUpdate.mutate({ id: deal.id, field: "tenantId", value: v || null })}
                            onCreate={async (name) => { const c = await createCompany(name); dealInlineUpdate.mutate({ id: deal.id, field: "tenantId", value: c.id }); }}
                            placeholder="Link tenant"
                          />
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="px-1.5 max-w-[180px]">
                        <div className="space-y-1">
                          {deal ? (
                            <InlineMultiSelect
                              value={deal.team || []}
                              options={CRM_OPTIONS.dealTeam.map(t => ({ label: t, value: t }))}
                              colorMap={DEAL_TEAM_COLORS}
                              placeholder="Set team"
                              onSave={(v) => dealInlineUpdate.mutate({ id: deal.id, field: "team", value: v.length > 0 ? v : null })}
                            />
                          ) : <span className="text-xs text-muted-foreground italic">No team</span>}
                          <InlineMultiSelect
                            value={Array.isArray(u.agentUserIds) ? u.agentUserIds : []}
                            options={agentOptions}
                            onSave={v => inlineUpdate(u.id, "agentUserIds", v)}
                            placeholder="Set agent"
                            testId={`inline-agent-${u.id}`}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        <div className="space-y-0.5">
                          {deal ? (
                            [
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
                                  onSave={v => {
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
                                  className="text-xs"
                                />
                              </div>
                            ))
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wide w-7 shrink-0">Total</span>
                              <InlineNumber
                                value={u.sqft}
                                onSave={v => inlineUpdate(u.id, "sqft", v)}
                                suffix=" sf"
                                className="text-xs"
                              />
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-1.5 py-1 text-right">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="w-full text-right flex flex-col gap-0.5 px-1 py-0.5 hover:bg-accent rounded text-xs"
                              data-testid={`costs-cell-${u.id}`}
                            >
                              {[
                                { label: "Rent", value: u.askingRent },
                                { label: "Rates", value: u.ratesPa },
                                { label: "SC",    value: u.serviceChargePa },
                              ].filter(r => r.value != null).length === 0 ? (
                                <span className="text-muted-foreground text-[11px] flex items-center gap-1 justify-end">
                                  <Plus className="w-3 h-3" /> Add costs
                                </span>
                              ) : (
                                [
                                  { label: "Rent",  value: u.askingRent },
                                  { label: "Rates", value: u.ratesPa },
                                  { label: "SC",    value: u.serviceChargePa },
                                ].filter(r => r.value != null).map(r => (
                                  <div key={r.label} className="flex items-center gap-1 justify-end">
                                    <span className="text-[9px] uppercase text-muted-foreground tracking-wide shrink-0">{r.label}</span>
                                    <span className="font-mono text-[11px]">£{Number(r.value).toLocaleString("en-GB")}</span>
                                  </div>
                                ))
                              )}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[280px] p-3 space-y-2.5" align="end">
                            <p className="text-xs font-semibold">Costs</p>
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
                          </PopoverContent>
                        </Popover>
                      </TableCell>
                      <TableCell className="px-1.5 py-1 max-w-[140px]">
                        <div className="space-y-1">
                          <InlineLabelSelect
                            value={u.useClass || ""}
                            options={USE_CLASSES}
                            colorMap={ASSET_CLASS_COLORS}
                            onSave={v => inlineUpdate(u.id, "useClass", v)}
                            placeholder="Set class"
                          />
                          <InlineSelect
                            value={u.condition || ""}
                            options={CONDITIONS}
                            onSave={v => inlineUpdate(u.id, "condition", v)}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <InlineLabelSelect
                          value={legacyToCode(u.marketingStatus) || "AVA"}
                          options={MARKETING_STATUSES}
                          colorMap={STATUS_LABEL_COLORS}
                          labelMap={DEAL_STATUS_LABELS}
                          onSave={v => inlineUpdate(u.id, "marketingStatus", v || "AVA")}
                          allowClear={false}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => setViewingsUnit(u)}
                            title="Viewings"
                            data-testid={`button-viewings-${u.id}`}
                          >
                            <CalendarDays className="h-3.5 w-3.5" />
                            {viewingsCounts[u.id] || 0}
                          </Button>
                          <span className="text-[9px] text-muted-foreground/60">·</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => setOffersUnit(u)}
                            title="Offers"
                            data-testid={`button-offers-${u.id}`}
                          >
                            <HandCoins className="h-3.5 w-3.5" />
                            {offersCounts[u.id] || 0}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="px-1.5 py-1 max-w-[150px]">
                        <div className="space-y-0.5">
                          <InlineNumber
                            value={u.fee}
                            onSave={v => inlineUpdate(u.id, "fee", v)}
                            placeholder="—"
                            prefix="£"
                          />
                          {deal ? (
                            deal.feeAgreementUrl ? (
                              <div className="flex items-center gap-1">
                                <a
                                  href={deal.feeAgreementUrl.startsWith("http") ? deal.feeAgreementUrl : `https://${deal.feeAgreementUrl}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] text-green-700 hover:underline"
                                  title="Open fee agreement"
                                >
                                  <FileBadge className="h-3 w-3" />
                                  FA signed
                                </a>
                                <button
                                  className="text-[10px] text-muted-foreground hover:text-foreground"
                                  title="Change URL"
                                  onClick={() => {
                                    const url = window.prompt("Fee agreement URL:", deal.feeAgreementUrl || "");
                                    if (url !== null) dealInlineUpdate.mutate({ id: deal.id, field: "feeAgreementUrl", value: url || null });
                                  }}
                                >✎</button>
                              </div>
                            ) : (
                              <button
                                className="inline-flex items-center gap-1 text-[11px] text-red-600 hover:text-red-800"
                                title="No fee agreement on file — click to add link"
                                onClick={() => {
                                  const url = window.prompt("Paste fee agreement URL (SharePoint / OneDrive link):");
                                  if (url) {
                                    dealInlineUpdate.mutate({ id: deal.id, field: "feeAgreementUrl", value: url });
                                    dealInlineUpdate.mutate({ id: deal.id, field: "feeAgreement", value: "YES" });
                                  }
                                }}
                              >
                                <AlertTriangle className="h-3 w-3" />
                                FA missing
                              </button>
                            )
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">FA n/a</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={() => setFilesUnit(u)}
                          data-testid={`button-files-${u.id}`}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Files
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={() => setBriefUnit(u)}
                          data-testid={`button-brief-${u.id}`}
                        >
                          <Target className="h-3.5 w-3.5" />
                          Brief
                        </Button>
                      </TableCell>
                      <TableCell className={`sticky right-0 z-10 border-l ${selectedIds.has(u.id) ? "bg-primary/5" : "bg-card"}`}>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-purple-500 hover:text-purple-700"
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
                            onClick={() => { setForm(unitToForm(u, u.dealId ? dealMap[u.dealId]?.dealType : null, landlordPrefillFor(u))); setEditItem(u); }}
                            data-testid={`button-edit-${u.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive"
                            onClick={() => setDeleteItem(u)}
                            data-testid={`button-delete-${u.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </ScrollableTable>
      </Card>
      )}

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
                    {["New Letting", "Temp Lease", "Lease Acquisition", "Sale", "Lease Renewal", "Rent Review"].map(t => (
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
                  isTrackedBrand: true,
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

      <Dialog open={!!viewingsUnit} onOpenChange={v => { if (!v) { setViewingsUnit(null); setAddViewingOpen(false); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Viewings — {viewingsUnit ? `${propertyMap[viewingsUnit.propertyId]?.name || "Property"}, ${viewingsUnit.unitName}` : ""}
            </DialogTitle>
            <DialogDescription>Track all viewings for this unit</DialogDescription>
          </DialogHeader>

          {viewingsForUnit.length === 0 && !addViewingOpen && (
            <div className="text-center py-6 text-muted-foreground text-sm">No viewings recorded yet</div>
          )}

          {viewingsForUnit.length > 0 && (
            <div className="space-y-2">
              {viewingsForUnit.map(v => (
                <div key={v.id} className="border rounded-lg p-3 text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">
                      {v.companyId ? <a href={`/contacts?company=${v.companyId}`} className="text-blue-600 hover:underline dark:text-blue-400">{v.companyName}</a> : (v.companyName || v.contactName || "Unknown")}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{v.viewingDate}{v.viewingTime ? ` at ${v.viewingTime}` : ""}</span>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteViewingMutation.mutate(v.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  {v.contactName && <div className="text-xs text-muted-foreground">Contact: {v.contactId ? <a href={`/contacts?contact=${v.contactId}`} className="text-blue-600 hover:underline dark:text-blue-400">{v.contactName}</a> : v.contactName}</div>}
                  {v.attendees && <div className="text-xs text-muted-foreground">Attendees: {v.attendees}</div>}
                  {v.outcome && <div className="text-xs"><Badge variant="outline">{v.outcome}</Badge></div>}
                  {v.notes && <div className="text-xs text-muted-foreground">{v.notes}</div>}
                </div>
              ))}
            </div>
          )}

          {addViewingOpen ? (
            <div className="border rounded-lg p-3 space-y-3">
              <div className="text-sm font-medium">Add Viewing</div>
              <div className="grid grid-cols-2 gap-3">
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Date</Label>
                  <Input type="date" value={viewingForm.viewingDate} onChange={e => setViewingForm(f => ({ ...f, viewingDate: e.target.value }))} data-testid="viewing-date" />
                </div>
                <div>
                  <Label className="text-xs">Time</Label>
                  <Input type="time" value={viewingForm.viewingTime} onChange={e => setViewingForm(f => ({ ...f, viewingTime: e.target.value }))} data-testid="viewing-time" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Attendees</Label>
                <Input value={viewingForm.attendees} onChange={e => setViewingForm(f => ({ ...f, attendees: e.target.value }))} placeholder="Who attended" data-testid="viewing-attendees" />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                <Button variant="outline" size="sm" onClick={() => setAddViewingOpen(false)}>Cancel</Button>
                <Button size="sm" disabled={!viewingForm.viewingDate || addViewingMutation.isPending} onClick={() => addViewingMutation.mutate(viewingForm)} data-testid="viewing-save">
                  {addViewingMutation.isPending ? "Saving..." : "Save Viewing"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={() => setAddViewingOpen(true)} data-testid="viewing-add">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Viewing
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!offersUnit} onOpenChange={v => { if (!v) { setOffersUnit(null); setAddOfferOpen(false); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandCoins className="h-5 w-5" />
              Offers — {offersUnit ? `${propertyMap[offersUnit.propertyId]?.name || "Property"}, ${offersUnit.unitName}` : ""}
            </DialogTitle>
            <DialogDescription>Track all offers received for this unit</DialogDescription>
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
                      {o.companyId ? <a href={`/contacts?company=${o.companyId}`} className="text-blue-600 hover:underline dark:text-blue-400">{o.companyName}</a> : (o.companyName || o.contactName || "Unknown")}
                      {o.contactName && <span className="text-xs text-muted-foreground ml-2">({o.contactId ? <a href={`/contacts?contact=${o.contactId}`} className="text-blue-600 hover:underline dark:text-blue-400">{o.contactName}</a> : o.contactName})</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={o.status === "Accepted" ? "bg-emerald-100 text-emerald-800" : o.status === "Rejected" ? "bg-red-100 text-red-800" : ""}>{o.status || "Pending"}</Badge>
                      <span className="text-xs text-muted-foreground">{o.offerDate}</span>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteOfferMutation.mutate(o.id)}>
                        <Trash2 className="h-3 w-3" />
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
              <div className="text-sm font-medium">Add Offer</div>
              <div className="grid grid-cols-2 gap-3">
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
                <div>
                  <Label className="text-xs">Date</Label>
                  <Input type="date" value={offerForm.offerDate} onChange={e => setOfferForm(f => ({ ...f, offerDate: e.target.value }))} data-testid="offer-date" />
                </div>
                <div>
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
              <div className="grid grid-cols-2 gap-3">
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
                <Button variant="outline" size="sm" onClick={() => setAddOfferOpen(false)}>Cancel</Button>
                <Button size="sm" disabled={!offerForm.offerDate || addOfferMutation.isPending} onClick={() => {
                  const payload: any = { ...offerForm };
                  if (payload.rentPa) payload.rentPa = parseFloat(payload.rentPa);
                  else delete payload.rentPa;
                  if (payload.rentFreeMonths) payload.rentFreeMonths = parseFloat(payload.rentFreeMonths);
                  else delete payload.rentFreeMonths;
                  if (payload.termYears) payload.termYears = parseFloat(payload.termYears);
                  else delete payload.termYears;
                  if (payload.premium) payload.premium = parseFloat(payload.premium);
                  else delete payload.premium;
                  if (payload.fittingOutContribution) payload.fittingOutContribution = parseFloat(payload.fittingOutContribution);
                  else delete payload.fittingOutContribution;
                  addOfferMutation.mutate(payload);
                }} data-testid="offer-save">
                  {addOfferMutation.isPending ? "Saving..." : "Save Offer"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={() => setAddOfferOpen(true)} data-testid="offer-add">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Offer
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <MarketingFilesDialog
        unit={filesUnit}
        files={filesForUnit}
        propertyName={filesUnit ? (propertyMap[filesUnit.propertyId]?.name || "") : ""}
        onClose={() => setFilesUnit(null)}
      />
    </div>
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

function MarketingFilesDialog({
  unit, files, propertyName, onClose,
}: {
  unit: AvailableUnit | null;
  files: UnitMarketingFile[];
  propertyName: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const uploadFile = useCallback(async (file: globalThis.File) => {
    if (!unit) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/available-units/${unit.id}/files`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", unit.id, "files"] });
      toast({ title: "File uploaded" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
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
    <Dialog open={!!unit} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Marketing Files
          </DialogTitle>
          <DialogDescription>
            {propertyName} — {unit?.unitName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
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
              {uploading ? "Uploading..." : "Upload Brochure"}
            </Button>
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
          </div>

          {files.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <File className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No marketing files yet</p>
              <p className="text-xs mt-1">Upload a brochure or create one in Document Studio</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[300px]">
              <div className="space-y-2">
                {files.map(f => (
                  <div
                    key={f.id}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30 hover:bg-muted/60 transition-colors group cursor-pointer"
                    onClick={() => window.open(`${f.filePath}?view=1`, "_blank")}
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
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={(e) => { e.stopPropagation(); window.open(f.filePath, "_blank"); }}
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
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);

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
            <Popover open={unitPickerOpen} onOpenChange={setUnitPickerOpen}>
              <PopoverTrigger asChild>
                <div>
                  <Input
                    value={form.unitName}
                    onChange={e => upd("unitName", e.target.value)}
                    onFocus={() => pickerOptions.length > 0 && setUnitPickerOpen(true)}
                    placeholder={form.propertyId ? "Pick from tenancy schedule or type a new name" : "Select a property first"}
                    disabled={!form.propertyId}
                    data-testid="input-unit-name"
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
              </PopoverTrigger>
              {pickerOptions.length > 0 && (
                <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Search units..." />
                    <CommandList>
                      <CommandEmpty>No matches. Keep typing to create a new unit.</CommandEmpty>
                      <CommandGroup heading={`Tenancy schedule (${pickerOptions.filter(o => o.source === "tenancy").length}) · Legacy (${pickerOptions.filter(o => o.source === "property").length})`}>
                        {pickerOptions.map(pu => (
                          <CommandItem
                            key={`${pu.source}-${pu.id}`}
                            value={pu.name}
                            onSelect={() => {
                              // Pre-fill every field the tenancy spine already knows so
                              // Layla doesn't re-type values that exist canonically. Only
                              // fills empty fields — anything the user already typed
                              // wins.
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
                              setUnitPickerOpen(false);
                            }}
                          >
                            <span className="text-sm">{pu.name}</span>
                            {pu.source === "tenancy" && (
                              <Badge variant="outline" className="ml-1.5 text-[9px] border-purple-300 text-purple-700">tenancy</Badge>
                            )}
                            {pu.vacant && (
                              <Badge variant="outline" className="ml-1 text-[9px] border-amber-300 text-amber-700">vacant</Badge>
                            )}
                            {pu.floor && <span className="text-xs text-muted-foreground ml-2">{pu.floor}</span>}
                            {pu.sqft != null && <span className="text-xs text-muted-foreground ml-2">{pu.sqft.toLocaleString()} sq ft</span>}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              )}
            </Popover>
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
            <Label>Marketing Status</Label>
            <Select value={legacyToCode(form.marketingStatus) || "AVA"} onValueChange={v => upd("marketingStatus", v)}>
              <SelectTrigger><SelectValue placeholder="Status..." /></SelectTrigger>
              <SelectContent>
                {MARKETING_STATUSES.map(s => <SelectItem key={s} value={s}>{DEAL_STATUS_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Available Date</Label>
            <Input type="date" value={form.availableDate} onChange={e => upd("availableDate", e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>BGP Contact *</Label>
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
                className="text-xs text-muted-foreground"
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
          <Button onClick={onSubmit} disabled={isPending || !form.unitName || !form.propertyId || !form.dealType || form.agentUserIds.length === 0} title={!form.dealType ? "Pick a deal type" : form.agentUserIds.length === 0 ? "Pick at least one BGP agent" : ""}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

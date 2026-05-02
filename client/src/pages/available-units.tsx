import { useQuery, useMutation } from "@tanstack/react-query";
import { ScrollableTable } from "@/components/scrollable-table";
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
  ChevronDown, ExternalLink, AlertTriangle, FileBadge,
} from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { InlineText, InlineNumber, InlineSelect, InlineLabelSelect, InlineMultiSelect, InlineLinkSelect } from "@/components/inline-edit";
import type { AvailableUnit, CrmProperty, CrmDeal, CrmCompany, CrmContact, UnitMarketingFile, UnitViewing, UnitOffer, PropertyUnit } from "@shared/schema";
import { useTeam } from "@/lib/team-context";
import { CRM_OPTIONS } from "@/lib/crm-options";
import { DEAL_TYPE_COLORS, DEAL_TEAM_COLORS } from "@/pages/deals";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

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

const STATUS_COLORS: Record<string, string> = {
  REP: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  AVA: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  NEG: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  SOL: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  EXC: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  COM: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  WIT: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  INV: "bg-emerald-200 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200",
};

const STATUS_LABEL_COLORS: Record<string, string> = {
  REP: "bg-violet-500",
  AVA: "bg-emerald-500",
  NEG: "bg-blue-500",
  SOL: "bg-amber-500",
  EXC: "bg-violet-600",
  COM: "bg-green-500",
  WIT: "bg-gray-500",
  INV: "bg-emerald-600",
};

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
  marketingStartDate: string;
  agentUserIds: string[];
}

const emptyForm: UnitFormState = {
  unitName: "",
  propertyId: "",
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
  marketingStartDate: "",
  agentUserIds: [],
};

function formToPayload(f: UnitFormState) {
  return {
    unitName: f.unitName,
    propertyId: f.propertyId,
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
    marketingStartDate: f.marketingStartDate || null,
    agentUserIds: f.agentUserIds.length > 0 ? f.agentUserIds : null,
  };
}

function unitToForm(u: AvailableUnit): UnitFormState {
  return {
    unitName: u.unitName || "",
    propertyId: u.propertyId || "",
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
    marketingStartDate: u.marketingStartDate || "",
    agentUserIds: Array.isArray(u.agentUserIds) ? u.agentUserIds : [],
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
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [assetClassFilter, setAssetClassFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<AvailableUnit | null>(null);
  const [deleteItem, setDeleteItem] = useState<AvailableUnit | null>(null);
  const [matchItem, setMatchItem] = useState<AvailableUnit | null>(null);
  const [linkDealOpen, setLinkDealOpen] = useState<AvailableUnit | null>(null);
  const [linkDealId, setLinkDealId] = useState("");
  const [form, setForm] = useState<UnitFormState>(emptyForm);
  const [filesUnit, setFilesUnit] = useState<AvailableUnit | null>(null);
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
    dealType: "Letting",
    team: [] as string[],
    agent: "",
    tenantName: "",
    fee: "",
    feeAgreement: "",
    askingRent: "",
    totalAreaSqft: "",
    leaseLength: "",
    rentFree: "",
    comments: "",
  });
  const { toast } = useToast();

  const { data: units = [], isLoading } = useQuery<AvailableUnit[]>({
    queryKey: ["/api/available-units"],
  });

  const { data: properties = [] } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });

  const { data: propertyUnits = [] } = useQuery<PropertyUnit[]>({
    queryKey: ["/api/property-units"],
  });

  const { data: deals = [] } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals"],
  });

  const { data: bgpUsers = [] } = useQuery<{ id: string; name: string; team?: string }[]>({
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
    mutationFn: (data: any) => apiRequest("POST", "/api/available-units", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      setCreateOpen(false);
      setForm(emptyForm);
      toast({ title: "Unit added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiRequest("PATCH", `/api/available-units/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      // Master fields (floor/sqft/useClass/condition/epcRating/unitName) flow to
      // property_units server-side, so refresh that cache too.
      queryClient.invalidateQueries({ queryKey: ["/api/property-units"] });
      setEditItem(null);
      toast({ title: "Unit updated" });
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
      const count = selectedIds.size;
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      toast({ title: `${count} unit${count !== 1 ? "s" : ""} deleted` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(ids.map(id => apiRequest("PATCH", `/api/available-units/${id}`, { marketingStatus: status })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      setSelectedIds(new Set());
      toast({ title: "Status updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const dealInlineUpdate = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: unknown }) => {
      await apiRequest("PUT", `/api/crm/deals/${id}`, { [field]: value });
    },
    onSuccess: () => {
      invalidateDealCaches();
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
    mutationFn: async ({ unitId, data }: { unitId: string; data: any }) => {
      const res = await apiRequest("POST", `/api/available-units/${unitId}/create-deal`, data);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
      invalidateDealCaches();
      setWipUnit(null);
      toast({ title: "Solicitors — WIP deal created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openWipDialog = (unit: AvailableUnit) => {
    const prop = propertyMap[unit.propertyId];
    setWipForm({
      dealType: "Letting",
      team: [],
      agent: unit.agent || "",
      tenantName: "",
      fee: unit.fee?.toString() || "",
      feeAgreement: "",
      askingRent: unit.askingRent?.toString() || "",
      totalAreaSqft: unit.sqft?.toString() || "",
      leaseLength: "",
      rentFree: "",
      comments: `${prop?.name || "Property"} — ${unit.unitName}${unit.floor ? ` (${unit.floor})` : ""}`,
    });
    setWipUnit(unit);
  };

  const inlineUpdate = (id: string, field: string, value: any) => {
    if (typeof value === "number" && isNaN(value)) value = null;
    if (field === "marketingStatus" && legacyToCode(value) === "SOL") {
      const unit = units.find(u => u.id === id);
      if (unit && !unit.dealId) {
        openWipDialog(unit);
        return;
      }
    }
    // Server PATCH handler routes master-managed fields (unitName, floor, sqft,
    // useClass, condition, epcRating) to property_units when unit_id is set.
    updateMutation.mutate({ id, data: { [field]: value } });
  };

  const uniqueProperties = useMemo(() => {
    const ids = new Set(teamUnits.map(u => u.propertyId));
    return properties.filter(p => ids.has(p.id));
  }, [teamUnits, properties]);

  const filtered = useMemo(() => {
    let result = teamUnits;
    if (statusFilter !== "all") result = result.filter(u => legacyToCode(u.marketingStatus) === statusFilter);
    if (propertyFilter !== "all") result = result.filter(u => u.propertyId === propertyFilter);
    if (assetClassFilter !== "all") result = result.filter(u => u.useClass === assetClassFilter);
    if (locationFilter !== "all") result = result.filter(u => u.location === locationFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(u => {
        const propName = propertyMap[u.propertyId]?.name || "";
        return u.unitName.toLowerCase().includes(q) || propName.toLowerCase().includes(q) || (u.floor || "").toLowerCase().includes(q);
      });
    }
    return result;
  }, [teamUnits, statusFilter, propertyFilter, assetClassFilter, locationFilter, search, propertyMap]);

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Letting Tracker</h1>
          <p className="text-sm text-muted-foreground">Shops and spaces to let across leasing instructions</p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setCreateOpen(true); }} data-testid="button-add-unit">
          <Plus className="h-4 w-4 mr-1" /> Add Unit
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-semibold">Viewings</span>
              </div>
              <span className="text-xs text-muted-foreground">FY {currentFYStart}/{currentFYStart + 1}</span>
            </div>
            <div className="flex items-end gap-1 h-16">
              {viewingsMonthly.map((count, i) => {
                const max = Math.max(...viewingsMonthly, 1);
                const h = Math.max((count / max) * 100, 4);
                const now = new Date();
                const currentMonthIdx = FY_MONTH_NUMS.indexOf(now.getMonth() + 1);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${FY_MONTHS[i]}: ${count} viewing${count !== 1 ? "s" : ""}`}>
                    <div
                      className={`w-full rounded-t transition-all ${i === currentMonthIdx ? "bg-blue-500" : count > 0 ? "bg-blue-300 dark:bg-blue-700" : "bg-muted"}`}
                      style={{ height: `${h}%` }}
                    />
                    <span className="text-[9px] text-muted-foreground leading-none">{FY_MONTHS[i]}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t">
              <span className="text-xs text-muted-foreground">Total this FY</span>
              <span className="text-sm font-bold">{viewingsMonthly.reduce((a, b) => a + b, 0)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <HandCoins className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-semibold">Offers</span>
              </div>
              <span className="text-xs text-muted-foreground">FY {currentFYStart}/{currentFYStart + 1}</span>
            </div>
            <div className="flex items-end gap-1 h-16">
              {offersMonthly.map((count, i) => {
                const max = Math.max(...offersMonthly, 1);
                const h = Math.max((count / max) * 100, 4);
                const now = new Date();
                const currentMonthIdx = FY_MONTH_NUMS.indexOf(now.getMonth() + 1);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${FY_MONTHS[i]}: ${count} offer${count !== 1 ? "s" : ""}`}>
                    <div
                      className={`w-full rounded-t transition-all ${i === currentMonthIdx ? "bg-amber-500" : count > 0 ? "bg-amber-300 dark:bg-amber-700" : "bg-muted"}`}
                      style={{ height: `${h}%` }}
                    />
                    <span className="text-[9px] text-muted-foreground leading-none">{FY_MONTHS[i]}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t">
              <span className="text-xs text-muted-foreground">Total this FY</span>
              <span className="text-sm font-bold">{offersMonthly.reduce((a, b) => a + b, 0)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search units..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-units"
          />
        </div>
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
        <div className="flex items-center gap-1.5 flex-wrap">
          {MARKETING_STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
              className={`${STATUS_LABEL_COLORS[s]} text-white text-[11px] font-medium px-2.5 py-1 rounded-full transition-all whitespace-nowrap ${
                statusFilter === s ? "ring-2 ring-primary ring-offset-1 scale-105" : statusFilter !== "all" ? "opacity-40" : "hover:opacity-90"
              }`}
              data-testid={`filter-status-${s.toLowerCase()}`}
            >
              {DEAL_STATUS_LABELS[s]}
              {statusFilter === s && <X className="inline h-3 w-3 ml-1 -mr-0.5" />}
            </button>
          ))}
        </div>
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
      </div>

      {/* KPI stat cards — matching Investment Tracker style */}
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
              {MARKETING_STATUSES.map(s => (
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
                <TableHead className="w-10 px-1"><Star className="w-3.5 h-3.5 text-muted-foreground" /></TableHead>
                <TableHead className="w-[50px]">Ref</TableHead>
                <TableHead className="w-[180px]">Property</TableHead>
                <TableHead className="w-[120px]">Deal Type</TableHead>
                <TableHead className="w-[140px]">Client</TableHead>
                <TableHead className="w-[140px]">Tenant</TableHead>
                <TableHead className="w-[140px]">Team</TableHead>
                <TableHead className="w-[140px]">Unit</TableHead>
                <TableHead>Floor</TableHead>
                <TableHead className="min-w-[140px]">Floor Areas</TableHead>
                <TableHead className="text-right">Asking Rent</TableHead>
                <TableHead className="text-right">Rates p.a.</TableHead>
                <TableHead className="text-right">SC p.a.</TableHead>
                <TableHead>Asset Class</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>EPC</TableHead>
                <TableHead>Deal Status</TableHead>
                <TableHead className="text-center">Viewings</TableHead>
                <TableHead className="text-center">Offers</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead>BGP Contact</TableHead>
                <TableHead>WIP Deal</TableHead>
                <TableHead className="w-[110px]">Fee Agreement</TableHead>
                <TableHead>Marketing</TableHead>
                <TableHead className="w-[100px] sticky right-0 z-20 border-l bg-card">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={26} className="text-center py-12 text-muted-foreground">
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
                      <TableCell className="px-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleFavoriteMutation.mutate(u.propertyId); }}
                          className="p-1 hover:bg-muted rounded transition-colors"
                          data-testid={`star-unit-${u.id}`}
                          title={favoriteIds.includes(u.propertyId) ? "Remove from dashboard" : "Pin to dashboard"}
                        >
                          <Star className={`w-4 h-4 ${favoriteIds.includes(u.propertyId) ? "text-amber-500 fill-amber-500" : "text-muted-foreground/40 hover:text-amber-400"}`} />
                        </button>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {deal?.dealRef ? `#${deal.dealRef}` : "—"}
                      </TableCell>
                      <TableCell className="px-1.5 py-1 font-medium max-w-[200px]">
                        <InlineLinkSelect
                          value={u.propertyId}
                          options={properties.map(p => ({ id: p.id, name: p.name }))}
                          href={`/properties/${u.propertyId}`}
                          onSave={(v) => inlineUpdate(u.id, "propertyId", v || null)}
                          placeholder="Link property"
                          data-testid={`link-property-${u.id}`}
                        />
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
                            placeholder="Link tenant"
                          />
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="px-1.5 max-w-[160px]">
                        {deal ? (
                          <InlineMultiSelect
                            value={deal.team || []}
                            options={CRM_OPTIONS.dealTeam.map(t => ({ label: t, value: t }))}
                            colorMap={DEAL_TEAM_COLORS}
                            placeholder="Set team"
                            onSave={(v) => dealInlineUpdate.mutate({ id: deal.id, field: "team", value: v.length > 0 ? v : null })}
                          />
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="px-1.5 max-w-[140px]">
                        <div className="flex items-center gap-1">
                          <InlineLinkSelect
                            value={u.unitId}
                            options={(unitsByProperty[u.propertyId] || []).map(pu => ({ id: pu.id, name: pu.unitName }))}
                            href={u.propertyId ? `/properties/${u.propertyId}` : undefined}
                            onSave={(id) => {
                              if (id) pickOrCreateUnit(u, { unitId: id });
                            }}
                            onCreate={(newName) => pickOrCreateUnit(u, { newName })}
                            placeholder="Pick unit"
                          />
                          {deal && (
                            <a
                              href={`/deals/${deal.id}`}
                              title={`Open deal: ${deal.name || u.unitName}`}
                              className="shrink-0 text-muted-foreground hover:text-primary"
                              onClick={e => e.stopPropagation()}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <InlineSelect
                          value={u.floor || ""}
                          options={FLOORS}
                          onSave={v => inlineUpdate(u.id, "floor", v)}
                        />
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        <div className="space-y-0.5">
                          {deal ? (
                            [
                              { label: "GF", value: deal.gfAreaSqft, field: "gfAreaSqft" },
                              { label: "FF", value: deal.ffAreaSqft, field: "ffAreaSqft" },
                              { label: "Bsmt", value: deal.basementAreaSqft, field: "basementAreaSqft" },
                              { label: "ITZA", value: deal.itzaAreaSqft, field: "itzaAreaSqft" },
                              { label: "Total", value: deal.totalAreaSqft, field: "totalAreaSqft" },
                            ].map(({ label, value, field }) => (
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
                      <TableCell className="text-right">
                        <InlineNumber
                          value={u.askingRent}
                          onSave={v => inlineUpdate(u.id, "askingRent", v)}
                          placeholder="—"
                          className="text-right"
                          prefix="£"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <InlineNumber
                          value={u.ratesPa}
                          onSave={v => inlineUpdate(u.id, "ratesPa", v)}
                          placeholder="—"
                          className="text-right"
                          prefix="£"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <InlineNumber
                          value={u.serviceChargePa}
                          onSave={v => inlineUpdate(u.id, "serviceChargePa", v)}
                          placeholder="—"
                          className="text-right"
                          prefix="£"
                        />
                      </TableCell>
                      <TableCell>
                        <InlineLabelSelect
                          value={u.useClass || ""}
                          options={USE_CLASSES}
                          colorMap={ASSET_CLASS_COLORS}
                          onSave={v => inlineUpdate(u.id, "useClass", v)}
                          placeholder="Set class"
                        />
                      </TableCell>
                      <TableCell>
                        <InlineLabelSelect
                          value={u.location || ""}
                          options={LOCATIONS}
                          colorMap={LOCATION_COLORS}
                          onSave={v => inlineUpdate(u.id, "location", v)}
                          placeholder="Set location"
                        />
                      </TableCell>
                      <TableCell>
                        <InlineSelect
                          value={u.condition || ""}
                          options={CONDITIONS}
                          onSave={v => inlineUpdate(u.id, "condition", v)}
                        />
                      </TableCell>
                      <TableCell>
                        <InlineSelect
                          value={u.epcRating || ""}
                          options={EPC_RATINGS}
                          onSave={v => inlineUpdate(u.id, "epcRating", v)}
                        />
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
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={() => setViewingsUnit(u)}
                          data-testid={`button-viewings-${u.id}`}
                        >
                          <CalendarDays className="h-3.5 w-3.5" />
                          {viewingsCounts[u.id] || 0}
                        </Button>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={() => setOffersUnit(u)}
                          data-testid={`button-offers-${u.id}`}
                        >
                          <HandCoins className="h-3.5 w-3.5" />
                          {offersCounts[u.id] || 0}
                        </Button>
                      </TableCell>
                      <TableCell className="text-right">
                        <InlineNumber
                          value={u.fee}
                          onSave={v => inlineUpdate(u.id, "fee", v)}
                          placeholder="—"
                          className="text-right"
                          prefix="£"
                        />
                      </TableCell>
                      <TableCell>
                        <InlineMultiSelect
                          value={Array.isArray(u.agentUserIds) ? u.agentUserIds : []}
                          options={agentOptions}
                          onSave={v => inlineUpdate(u.id, "agentUserIds", v)}
                          placeholder="Set agent"
                          testId={`inline-agent-${u.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        {deal ? (
                          <a href={`/deals/${deal.id}`} className="text-xs text-blue-600 hover:underline" data-testid={`link-deal-${u.id}`}>
                            {deal.name || "View Deal"}
                          </a>
                        ) : (
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1 text-xs"
                              onClick={() => { setLinkDealOpen(u); setLinkDealId(""); }}
                              title="Link existing deal"
                              data-testid={`button-link-deal-${u.id}`}
                            >
                              <Link2 className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1 text-xs"
                              onClick={() => createDealMutation.mutate(u.id)}
                              title="Auto-create deal"
                              data-testid={`button-create-deal-${u.id}`}
                            >
                              <ArrowRightLeft className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="px-1.5 py-1">
                        {deal ? (
                          deal.feeAgreementUrl ? (
                            <div className="flex items-center gap-1">
                              <a
                                href={deal.feeAgreementUrl.startsWith("http") ? deal.feeAgreementUrl : `https://${deal.feeAgreementUrl}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-green-700 hover:underline"
                                title="Open fee agreement"
                              >
                                <FileBadge className="h-3.5 w-3.5" />
                                View
                              </a>
                              <button
                                className="text-[10px] text-muted-foreground hover:text-foreground ml-1"
                                title="Change URL"
                                onClick={() => {
                                  const url = window.prompt("Fee agreement URL:", deal.feeAgreementUrl || "");
                                  if (url !== null) dealInlineUpdate.mutate({ id: deal.id, field: "feeAgreementUrl", value: url || null });
                                }}
                              >✎</button>
                            </div>
                          ) : (
                            <button
                              className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800"
                              title="No fee agreement on file — click to add link"
                              onClick={() => {
                                const url = window.prompt("Paste fee agreement URL (SharePoint / OneDrive link):");
                                if (url) {
                                  dealInlineUpdate.mutate({ id: deal.id, field: "feeAgreementUrl", value: url });
                                  dealInlineUpdate.mutate({ id: deal.id, field: "feeAgreement", value: "YES" });
                                }
                              }}
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Missing
                            </button>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
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
                            onClick={() => { setForm(unitToForm(u)); setEditItem(u); }}
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

      <UnitFormDialog
        open={createOpen}
        onOpenChange={(v) => { setCreateOpen(v); if (!v) setForm(emptyForm); }}
        title="Add Available Unit"
        form={form}
        setForm={setForm}
        properties={properties}
        propertyUnits={propertyUnits}
        bgpUsers={bgpUsers}
        onSubmit={() => createMutation.mutate(formToPayload(form))}
        isPending={createMutation.isPending}
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
        onSubmit={() => editItem && updateMutation.mutate({ id: editItem.id, data: formToPayload(form) })}
        isPending={updateMutation.isPending}
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
            <DialogTitle>Create WIP Deal — Solicitors</DialogTitle>
            <DialogDescription>
              {wipUnit ? `${propertyMap[wipUnit.propertyId]?.name || "Property"} — ${wipUnit.unitName}` : ""}
              . Fill in the deal details below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">Deal Type</Label>
                <Select value={wipForm.dealType} onValueChange={v => setWipForm(f => ({ ...f, dealType: v }))}>
                  <SelectTrigger data-testid="wip-deal-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Letting", "Acquisition", "Sale", "Lease Renewal", "Rent Review"].map(t => (
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">Agent</Label>
                <Select value={wipForm.agent} onValueChange={v => setWipForm(f => ({ ...f, agent: v }))}>
                  <SelectTrigger data-testid="wip-agent"><SelectValue placeholder="Select agent" /></SelectTrigger>
                  <SelectContent>
                    {bgpUsers.map(u => (
                      <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1">Tenant / Applicant</Label>
                <Input
                  value={wipForm.tenantName}
                  onChange={e => setWipForm(f => ({ ...f, tenantName: e.target.value }))}
                  placeholder="Tenant name"
                  data-testid="wip-tenant"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">Fee (£)</Label>
                <CurrencyInput
                  value={wipForm.fee}
                  onChange={v => setWipForm(f => ({ ...f, fee: v }))}
                  placeholder="0"
                  prefix="£"
                  testId="wip-fee"
                />
              </div>
              <div>
                <Label className="text-xs mb-1">Fee Agreement</Label>
                <Input
                  value={wipForm.feeAgreement}
                  onChange={e => setWipForm(f => ({ ...f, feeAgreement: e.target.value }))}
                  placeholder="e.g. 10% of rent"
                  data-testid="wip-fee-agreement"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">Rent p.a. (£)</Label>
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
              <Label className="text-xs mb-1">Notes</Label>
              <Textarea
                value={wipForm.comments}
                onChange={e => setWipForm(f => ({ ...f, comments: e.target.value }))}
                rows={2}
                data-testid="wip-comments"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWipUnit(null)}>Cancel</Button>
            <Button
              onClick={() => wipUnit && wipDealMutation.mutate({ unitId: wipUnit.id, data: wipForm })}
              disabled={wipDealMutation.isPending}
              data-testid="wip-submit"
            >
              {wipDealMutation.isPending ? "Creating..." : "Create WIP Deal"}
            </Button>
          </DialogFooter>
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
              <div className="grid grid-cols-3 gap-3">
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
  open, onOpenChange, title, form, setForm, properties, propertyUnits = [], bgpUsers, onSubmit, isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  form: UnitFormState;
  setForm: (f: UnitFormState) => void;
  properties: CrmProperty[];
  propertyUnits?: PropertyUnit[];
  bgpUsers: { id: string; name: string }[];
  onSubmit: () => void;
  isPending: boolean;
}) {
  const upd = (field: keyof UnitFormState, value: string) => setForm({ ...form, [field]: value });
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const existingUnitsOnProperty = form.propertyId
    ? propertyUnits.filter(pu => pu.propertyId === form.propertyId)
    : [];
  const matchedExistingUnit = existingUnitsOnProperty.find(
    pu => pu.unitName.trim().toLowerCase() === (form.unitName || "").trim().toLowerCase()
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Property (Instruction)</Label>
            <Select value={form.propertyId} onValueChange={v => upd("propertyId", v)}>
              <SelectTrigger data-testid="select-property">
                <SelectValue placeholder="Select property..." />
              </SelectTrigger>
              <SelectContent>
                {properties.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Unit Name / Number</Label>
            <Popover open={unitPickerOpen} onOpenChange={setUnitPickerOpen}>
              <PopoverTrigger asChild>
                <div>
                  <Input
                    value={form.unitName}
                    onChange={e => upd("unitName", e.target.value)}
                    onFocus={() => existingUnitsOnProperty.length > 0 && setUnitPickerOpen(true)}
                    placeholder={form.propertyId ? "Pick or type a new unit name" : "Select a property first"}
                    disabled={!form.propertyId}
                    data-testid="input-unit-name"
                  />
                  {form.unitName && !matchedExistingUnit && existingUnitsOnProperty.length > 0 && (
                    <p className="text-[10px] text-emerald-600 mt-0.5">New unit — will be created on this property</p>
                  )}
                  {matchedExistingUnit && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">Existing unit on this property — will be linked</p>
                  )}
                </div>
              </PopoverTrigger>
              {existingUnitsOnProperty.length > 0 && (
                <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Search existing units..." />
                    <CommandList>
                      <CommandEmpty>No matches. Keep typing to create a new unit.</CommandEmpty>
                      <CommandGroup heading={`Units on this property (${existingUnitsOnProperty.length})`}>
                        {existingUnitsOnProperty.map(pu => (
                          <CommandItem
                            key={pu.id}
                            value={pu.unitName}
                            onSelect={() => {
                              setForm({
                                ...form,
                                unitName: pu.unitName,
                                floor: pu.floor || form.floor,
                                sqft: pu.sqft != null ? String(pu.sqft) : form.sqft,
                                useClass: pu.useClass || form.useClass,
                                condition: pu.condition || form.condition,
                                epcRating: pu.epcRating || form.epcRating,
                              });
                              setUnitPickerOpen(false);
                            }}
                          >
                            <span className="text-sm">{pu.unitName}</span>
                            {pu.floor && <span className="text-xs text-muted-foreground ml-2">{pu.floor}</span>}
                            {pu.sqft != null && <span className="text-xs text-muted-foreground ml-2">{pu.sqft.toLocaleString()} sqft</span>}
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
            <Select value={form.floor} onValueChange={v => upd("floor", v)}>
              <SelectTrigger><SelectValue placeholder="Select floor..." /></SelectTrigger>
              <SelectContent>
                {FLOORS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Size (sq ft)</Label>
            <CurrencyInput value={form.sqft} onChange={v => upd("sqft", v)} placeholder="e.g. 1,500" />
          </div>
          <div>
            <Label>Asking Rent (£ p.a.)</Label>
            <CurrencyInput value={form.askingRent} onChange={v => upd("askingRent", v)} placeholder="e.g. 85,000" prefix="£" />
          </div>
          <div>
            <Label>Fee (£)</Label>
            <CurrencyInput value={form.fee} onChange={v => upd("fee", v)} placeholder="e.g. 12,500" prefix="£" />
          </div>
          <div>
            <Label>Rates (£ p.a.)</Label>
            <CurrencyInput value={form.ratesPa} onChange={v => upd("ratesPa", v)} placeholder="e.g. 25,000" prefix="£" />
          </div>
          <div>
            <Label>Service Charge (£ p.a.)</Label>
            <CurrencyInput value={form.serviceChargePa} onChange={v => upd("serviceChargePa", v)} placeholder="e.g. 15,000" prefix="£" />
          </div>
          <div>
            <Label>Asset Class</Label>
            <Select value={form.useClass} onValueChange={v => upd("useClass", v)}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {USE_CLASSES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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
          <div>
            <Label>Marketing Start Date</Label>
            <Input type="date" value={form.marketingStartDate} onChange={e => upd("marketingStartDate", e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Agents</Label>
            <div className="flex flex-wrap gap-1.5 p-2 border rounded-md min-h-[38px]">
              {bgpUsers.map(u => {
                const selected = form.agentUserIds.includes(u.id);
                return (
                  <Badge
                    key={u.id}
                    variant={selected ? "default" : "outline"}
                    className={`cursor-pointer text-xs transition-colors ${selected ? "" : "opacity-50 hover:opacity-80"}`}
                    onClick={() => {
                      const next = selected
                        ? form.agentUserIds.filter(id => id !== u.id)
                        : [...form.agentUserIds, u.id];
                      setForm({ ...form, agentUserIds: next });
                    }}
                    data-testid={`badge-agent-${u.id}`}
                  >
                    {u.name}
                  </Badge>
                );
              })}
            </div>
          </div>
          <div className="col-span-2">
            <Label>Restrictions</Label>
            <Textarea value={form.restrictions} onChange={e => upd("restrictions", e.target.value)} placeholder="Any use or tenant restrictions..." rows={2} />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => upd("notes", e.target.value)} placeholder="Additional notes..." rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSubmit} disabled={isPending || !form.unitName || !form.propertyId}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useQuery, useMutation } from "@tanstack/react-query";
import { ScrollableTable } from "@/components/scrollable-table";
import { useDealAmlStatus } from "@/components/deal-aml-status";
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
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useRoute, Link, useLocation } from "wouter";
import type { CrmDeal, CrmProperty, CrmCompany, CrmContact, DealFeeAllocation, AvailableUnit } from "@shared/schema";
import { InlineText, InlineNumber, InlineSelect, InlineLabelSelect, InlineLinkSelect } from "@/components/inline-edit";
import { buildUserColorMap } from "@/lib/agent-colors";
import { ColumnFilterPopover } from "@/components/column-filter-popover";
import { CRM_OPTIONS } from "@/lib/crm-options";
import { MobileCardView, ViewToggle, type MobileCardItem } from "@/components/mobile-card-view";
import { PageLayout } from "@/components/page-layout";
import { EmptyState } from "@/components/empty-state";
import { DealKanban } from "@/components/deal-kanban";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DealDetail } from "@/components/deal-detail";
import { DEAL_STATUS_LABELS, legacyToCode } from "@shared/deal-status";

// Canonical 10-code colour map. Legacy strings retained as fallbacks for any
// rows that haven't yet been touched by the migration.
export const DEAL_STATUS_COLORS: Record<string, string> = {
  REP: "bg-slate-500",
  SPEC: "bg-violet-500",
  LIVE: "bg-blue-500",
  AVA: "bg-emerald-500",
  NEG: "bg-yellow-600",
  SOL: "bg-orange-500",
  EXC: "bg-purple-500",
  COM: "bg-green-500",
  WIT: "bg-zinc-500",
  INV: "bg-emerald-600",
  // Legacy strings — kept for safety; all map to the new colours above
  "Targeting": "bg-slate-500",
  "Reporting": "bg-slate-500",
  "Speculative": "bg-violet-500",
  "Live": "bg-blue-500",
  "Available": "bg-emerald-500",
  "Marketing": "bg-emerald-500",
  "Under Negotiation": "bg-yellow-600",
  "HOTs": "bg-yellow-600",
  "Under Offer": "bg-orange-500",
  "SOLs": "bg-orange-500",
  "Exchanged": "bg-purple-500",
  "Completed": "bg-green-500",
  "Let": "bg-green-500",
  "Withdrawn": "bg-zinc-500",
  "Lost": "bg-zinc-500",
  "Dead": "bg-zinc-500",
  "Invoiced": "bg-emerald-600",
  "Billed": "bg-emerald-600",
  "Leasing Comps": "bg-cyan-600",
  "Investment Comps": "bg-purple-500",
};

export const DEAL_TYPE_COLORS: Record<string, string> = {
  "Acquisition": "bg-blue-600",
  "Sale": "bg-red-600",
  "Leasing": "bg-green-600",
  "Lease Renewal": "bg-purple-600",
  "Rent Review": "bg-orange-500",
  "Investment": "bg-indigo-600",
  "Lease Advisory": "bg-cyan-600",
  "Tenant Rep": "bg-rose-600",
  "Lease Acquisition": "bg-violet-600",
  "Lease Disposal": "bg-amber-600",
  "Regear": "bg-teal-600",
  "Purchase": "bg-emerald-600",
  "New Letting": "bg-lime-600",
  "Sub-Letting": "bg-sky-600",
  "Assignment": "bg-slate-600",
};

export const DEAL_TEAM_COLORS: Record<string, string> = {
  "Development": "bg-orange-600",
  "London Leasing": "bg-blue-700",
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
  landlord: "Landlord",
  status: "Status",
  type: "Deal Type",
  team: "Team",
  agent: "BGP Contact",
  assetClass: "Asset Class",
  clientContact: "Client Contact",
  tenant: "Tenant",
  vendor: "Vendor",
  purchaser: "Purchaser",
  vendorAgent: "Vendor Agent",
  acquisitionAgent: "Acquisition Agent",
  purchaserAgent: "Purchaser Agent",
  leasingAgent: "Leasing Agent",
  timeline: "Timeline",
  pricing: "Pricing",
  yield: "Yield %",
  fee: "Fee",
  feeAlloc: "Fee Split",
  feeAgreement: "Fee Agreement",
  amlCheck: "AML Check",
  invoicingEntity: "Invoicing Entity",
  area: "Total Area",
  basementArea: "Basement Area",
  gfArea: "GF Area",
  ffArea: "FF Area",
  itzaArea: "ITZA Area",
  pricePsf: "Price PSF",
  priceItza: "Price ITZA",
  rentPa: "Rent PA",
  capitalContribution: "Capital Contribution",
  rentFree: "Rent Free",
  leaseLength: "Lease Length",
  breakOption: "Break Option",
  completionDate: "Completion Date",
  rentAnalysis: "Rent Analysis",
  comments: "Comments",
  sharepoint: "SharePoint",
  wipBadge: "WIP Match",
};

export function formatCurrency(val: number | null | undefined): string {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(val);
}

export function formatNumber(val: number | null | undefined): string {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-GB").format(val);
}

export function formatDate(val: string | null | undefined): string {
  if (!val) return "—";
  try {
    return new Date(val).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return val;
  }
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
                {v}
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
  completionDate: string;
  timelineStart: string;
  timelineEnd: string;
  amlCheckCompleted: string;
  comments: string;
  lastInteraction: string;
  sharepointLink: string;
  rentAnalysis: string;
  invoicingEntityId: string;
  poNumber: string;
}

const emptyForm: DealFormData = {
  name: "",
  groupName: "",
  dealType: "",
  status: "",
  team: [],
  internalAgent: [],
  propertyId: "",
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
  completionDate: "",
  timelineStart: "",
  timelineEnd: "",
  amlCheckCompleted: "",
  comments: "",
  lastInteraction: "",
  sharepointLink: "",
  rentAnalysis: "",
  invoicingEntityId: "",
  poNumber: "",
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
    completionDate: deal.completionDate || "",
    timelineStart: deal.timelineStart || "",
    timelineEnd: deal.timelineEnd || "",
    amlCheckCompleted: deal.amlCheckCompleted || "",
    comments: deal.comments || "",
    lastInteraction: deal.lastInteraction || "",
    sharepointLink: deal.sharepointLink || "",
    rentAnalysis: deal.rentAnalysis != null ? String(deal.rentAnalysis) : "",
    invoicingEntityId: deal.invoicingEntityId || "",
    poNumber: deal.poNumber || "",
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
    completionDate: form.completionDate || null,
    timelineStart: form.timelineStart || null,
    timelineEnd: form.timelineEnd || null,
    amlCheckCompleted: form.amlCheckCompleted || null,
    comments: form.comments || null,
    lastInteraction: form.lastInteraction || null,
    sharepointLink: form.sharepointLink || null,
    rentAnalysis: parseNum(form.rentAnalysis),
    invoicingEntityId: form.invoicingEntityId || null,
    poNumber: form.poNumber || null,
  };
  if (changeReason) payload.changeReason = changeReason;
  return payload;
}

function formToPayloadWithLearning(form: DealFormData, changeReason: string | undefined, learning: string | undefined) {
  const p = formToPayload(form, changeReason);
  if (learning && learning.trim()) p.learning = learning.trim();
  return p;
}


export function DealFormDialog({
  open,
  onOpenChange,
  deal,
  properties,
  companies,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: CrmDeal;
  properties: CrmProperty[];
  companies: CrmCompany[];
  users: { id: number; name: string; email: string }[];
}) {
  const { toast } = useToast();
  const isEdit = !!deal;
  const [form, setForm] = useState<DealFormData>(deal ? dealToForm(deal) : { ...emptyForm });
  const [changeReason, setChangeReason] = useState("");
  const [learning, setLearning] = useState("");
  const [approvalGateOpen, setApprovalGateOpen] = useState(false);
  const [approvalGateMessage, setApprovalGateMessage] = useState("");

  const statusChanged = isEdit && deal && form.status !== (deal.status || "");
  const APPROVAL_STATUSES = ["Invoiced", "Completed"];
  const isApprovalStatus = statusChanged && APPROVAL_STATUSES.includes(form.status);
  const isCompletingNow = statusChanged && form.status === "Completed";

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
        await apiRequest("POST", "/api/crm/deals", payload);
      }
    },
    onSuccess: async () => {
      toast({ title: isEdit ? "Deal updated" : "Deal created" });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      if (isEdit) {
        queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", deal.id] });
        queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", deal.id, "audit-log"] });
      }
      setChangeReason("");
      onOpenChange(false);

      const invoicingChanged = form.invoicingEntityId && (!deal || form.invoicingEntityId !== (deal.invoicingEntityId || ""));
      if (invoicingChanged) {
        const entityName = companies.find(c => c.id === form.invoicingEntityId)?.name || "company";
        toast({ title: "Running KYC", description: `Checking ${entityName} via Companies House...` });
        try {
          const res = await fetch(`/api/companies-house/auto-kyc/${form.invoicingEntityId}`, {
            method: "POST",
            credentials: "include",
            headers: getAuthHeaders(),
          });
          const data = await res.json();
          if (res.ok && data.success) {
            queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
            toast({
              title: data.kycStatus === "pass" ? "KYC Passed" : data.kycStatus === "warning" ? "KYC Needs Review" : "KYC Failed",
              description: `${data.profile?.companyName || entityName} — ${data.kycStatus === "pass" ? "Active, no adverse flags" : "Review needed"}`,
              variant: data.kycStatus === "fail" ? "destructive" : "default",
            });
          }
        } catch (err: any) {
          console.error("[KYC] Auto-check failed:", err.message);
        }
      }
    },
    onError: (err: Error) => {
      // Handle approval gate 403
      if (err.message.includes("Senior approval required")) {
        setApprovalGateMessage(err.message.replace(/^\d+:\s*/, "").replace(/^{?"?error"?:?\s*"?/, "").replace(/"?\s*}?$/, ""));
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label>Property *</Label>
              <Select value={form.propertyId || undefined} onValueChange={(v) => {
                const val = v === "__clear__" ? "" : v;
                set("propertyId", val);
                if (val && !form.name.trim()) {
                  const prop = properties.find(p => p.id === val);
                  if (prop) set("name", prop.name);
                }
              }}>
                <SelectTrigger data-testid="select-deal-property-top">
                  <SelectValue placeholder="Select property" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__clear__">None</SelectItem>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
                if (val === "Purchase" || val === "Sale") autoTeam = "Investment";
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
            </div>

            <div>
              <Label>Status</Label>
              <Select value={legacyToCode(form.status) || undefined} onValueChange={(v) => set("status", v === "__clear__" ? "" : v)}>
                <SelectTrigger data-testid="select-deal-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__clear__">None</SelectItem>
                  {CRM_OPTIONS.dealStatus.map((s) => (
                    <SelectItem key={s} value={s} disabled={s === "INV"}>
                      {DEAL_STATUS_LABELS[s as keyof typeof DEAL_STATUS_LABELS] ?? s}
                      {s === "INV" ? " (auto)" : ""}
                    </SelectItem>
                  ))}
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
                          <Badge key={t} className={`text-[10px] px-1.5 py-0 text-white ${DEAL_TEAM_COLORS[t] || "bg-zinc-500"}`}>{t}</Badge>
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
                      {t}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
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
                  {users.map(u => (
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

              const tenantTypes = companies.filter(c => c.companyType?.startsWith("Tenant") || c.companyType === "Purchaser" || c.id === form.tenantId);
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
                      <Input type="number" value={form.pricing} onChange={(e) => set("pricing", e.target.value)} data-testid="input-deal-pricing" />
                    </div>
                  )}

                  {showRent && (
                    <div>
                      <Label>Rent PA ({"\u00A3"})</Label>
                      <Input type="number" value={form.rentPa} onChange={(e) => set("rentPa", e.target.value)} data-testid="input-deal-rent-pa" />
                    </div>
                  )}

                  {showYield && (
                    <div>
                      <Label>Yield %</Label>
                      <Input type="number" step="0.01" value={form.yieldPercent} onChange={(e) => set("yieldPercent", e.target.value)} data-testid="input-deal-yield" />
                    </div>
                  )}

                  <div>
                    <Label>Fee ({"\u00A3"})</Label>
                    <Input type="number" value={form.fee} onChange={(e) => set("fee", e.target.value)} data-testid="input-deal-fee" />
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
                        <Label>GF Area (sqft)</Label>
                        <Input type="number" value={form.gfAreaSqft} onChange={(e) => set("gfAreaSqft", e.target.value)} data-testid="input-deal-gf-area" />
                      </div>
                      <div>
                        <Label>FF Area (sqft)</Label>
                        <Input type="number" value={form.ffAreaSqft} onChange={(e) => set("ffAreaSqft", e.target.value)} data-testid="input-deal-ff-area" />
                      </div>
                      <div>
                        <Label>Basement (sqft)</Label>
                        <Input type="number" value={form.basementAreaSqft} onChange={(e) => set("basementAreaSqft", e.target.value)} data-testid="input-deal-basement-area" />
                      </div>
                      <div>
                        <Label>ITZA (sqft)</Label>
                        <Input type="number" value={form.itzaAreaSqft} onChange={(e) => set("itzaAreaSqft", e.target.value)} data-testid="input-deal-itza-area" />
                      </div>
                      <div>
                        <Label>Total Area (sqft)</Label>
                        <Input type="number" value={(() => { const t = (parseFloat(form.basementAreaSqft) || 0) + (parseFloat(form.gfAreaSqft) || 0) + (parseFloat(form.ffAreaSqft) || 0); return t > 0 ? String(t) : ""; })()} readOnly className="bg-muted" data-testid="input-deal-total-area" />
                      </div>
                    </>
                  )}

                  {showLeaseTerm && (
                    <>
                      <div>
                        <Label>Lease Length (years)</Label>
                        <Input type="number" step="0.5" value={form.leaseLength} onChange={(e) => set("leaseLength", e.target.value)} data-testid="input-deal-lease-length" />
                      </div>
                      <div>
                        <Label>Break Option (years)</Label>
                        <Input type="number" step="0.5" value={form.breakOption} onChange={(e) => set("breakOption", e.target.value)} data-testid="input-deal-break-option" />
                      </div>
                      <div>
                        <Label>Rent Free (months)</Label>
                        <Input type="number" value={form.rentFree} onChange={(e) => set("rentFree", e.target.value)} data-testid="input-deal-rent-free" />
                      </div>
                      <div>
                        <Label>Capital Contribution ({"\u00A3"})</Label>
                        <Input type="number" value={form.capitalContribution} onChange={(e) => set("capitalContribution", e.target.value)} data-testid="input-deal-capital-contribution" />
                      </div>
                    </>
                  )}

                  <div>
                    <Label>Completion Date</Label>
                    <Input type="date" value={form.completionDate} onChange={(e) => set("completionDate", e.target.value)} data-testid="input-deal-completion-date" />
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

                  <div>
                    <Label>Invoicing Entity</Label>
                    <Select value={form.invoicingEntityId || undefined} onValueChange={(v) => set("invoicingEntityId", v === "__clear__" ? "" : v)}>
                      <SelectTrigger data-testid="select-deal-invoicing-entity"><SelectValue placeholder="Select company" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__clear__">None</SelectItem>
                        {companies.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-deal">
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="button-save-deal">
              {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isEdit ? "Save Changes" : "Create Deal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <AlertDialog open={approvalGateOpen} onOpenChange={setApprovalGateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-amber-500" />
              Approval Required
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>{approvalGateMessage || "This status change requires senior approval."}</p>
              <p className="text-xs text-muted-foreground mt-2">
                Please ask a senior team member (Woody, Charlotte, Rupert, or Jack) to make this change, or contact them to approve it on your behalf.
              </p>
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

function FeeAllocCell({ dealId, dealFee, allAllocations, colorMap }: { dealId: string; dealFee: number | null | undefined; allAllocations: Record<string, DealFeeAllocation[]> | undefined; colorMap?: Record<string, string> }) {
  const allocations = allAllocations?.[dealId];
  if (!allocations || allocations.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const fee = dealFee || 0;
  return (
    <div className="space-y-0.5" data-testid={`fee-alloc-summary-${dealId}`}>
      {allocations.map((a, i) => {
        const amount = a.allocationType === "percentage"
          ? fee * (a.percentage || 0) / 100
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

interface FeeAllocationRow {
  agentName: string;
  allocationType: "percentage" | "fixed";
  percentage: number;
  fixedAmount: number;
}

export function FeeAllocationCard({ dealId, dealFee, users, colorMap }: { dealId: string; dealFee: number | null | undefined; users: { id: string; name: string }[]; colorMap?: Record<string, string> }) {
  const { toast } = useToast();
  const { data: allocations, isLoading } = useQuery<DealFeeAllocation[]>({
    queryKey: ["/api/crm/deals", dealId, "fee-allocations"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/deals/${dealId}/fee-allocations`, { credentials: "include", headers: { Authorization: `Bearer ${localStorage.getItem("bgp_auth_token")}` } });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<FeeAllocationRow[]>([]);
  const [allocType, setAllocType] = useState<"percentage" | "fixed">("percentage");

  useEffect(() => {
    if (allocations && allocations.length > 0 && !editing) {
      setRows(allocations.map(a => ({
        agentName: a.agentName,
        allocationType: a.allocationType as "percentage" | "fixed",
        percentage: a.percentage || 0,
        fixedAmount: a.fixedAmount || 0,
      })));
      setAllocType(allocations[0].allocationType as "percentage" | "fixed");
    }
  }, [allocations, editing]);

  const saveMutation = useMutation({
    mutationFn: async (data: FeeAllocationRow[]) => {
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

  const startEditing = () => {
    if (!allocations || allocations.length === 0) {
      setRows([{ agentName: "", allocationType: "percentage", percentage: 0, fixedAmount: 0 }]);
      setAllocType("percentage");
    }
    setEditing(true);
  };

  const addRow = () => {
    setRows(prev => [...prev, { agentName: "", allocationType: allocType, percentage: 0, fixedAmount: 0 }]);
  };

  const removeRow = (idx: number) => {
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, field: keyof FeeAllocationRow, value: string | number) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const handleSave = () => {
    const data = rows
      .filter(r => r.agentName)
      .map(r => ({ ...r, allocationType: allocType }));
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
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            <h3 className="text-sm font-semibold">Fee Allocation</h3>
            {totalFee > 0 && !editing && allocations && allocations.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {formatCurrency(totalAllocated)} of {formatCurrency(totalFee)} allocated
              </Badge>
            )}
          </div>
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

        {editing ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Split type:</span>
              <div className="flex items-center rounded-full border p-0.5 gap-0.5">
                {(["percentage", "fixed"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setAllocType(t)}
                    className={`text-[11px] px-2.5 py-1 rounded-full transition-colors ${
                      allocType === t
                        ? "bg-black text-white dark:bg-white dark:text-black"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid={`button-alloc-type-${t}`}
                  >
                    {t === "percentage" ? "% Split" : "Fixed £"}
                  </button>
                ))}
              </div>
              {totalFee > 0 && (
                <span className="text-xs text-muted-foreground ml-auto">Total fee: {formatCurrency(totalFee)}</span>
              )}
            </div>

            <div className="space-y-1.5">
              {rows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2" data-testid={`fee-alloc-row-${idx}`}>
                  <Select value={row.agentName || undefined} onValueChange={(v) => updateRow(idx, "agentName", v)}>
                    <SelectTrigger className="h-8 text-xs flex-1" data-testid={`select-agent-${idx}`}>
                      <SelectValue placeholder="Select BGP Agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {bgpAgents.filter(name => !rows.some((r, i) => i !== idx && r.agentName === name)).map(name => (
                        <SelectItem key={name} value={name}>
                          <span className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${colorMap?.[name] || "bg-zinc-500"}`} />
                            {name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {allocType === "percentage" ? (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        value={row.percentage || ""}
                        onChange={(e) => updateRow(idx, "percentage", Number(e.target.value))}
                        className="w-20 h-8 text-xs text-right"
                        placeholder="0"
                        data-testid={`input-percentage-${idx}`}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">£</span>
                      <Input
                        type="number"
                        value={row.fixedAmount || ""}
                        onChange={(e) => updateRow(idx, "fixedAmount", Number(e.target.value))}
                        className="w-24 h-8 text-xs text-right"
                        placeholder="0"
                        data-testid={`input-fixed-amount-${idx}`}
                      />
                    </div>
                  )}
                  {totalFee > 0 && allocType === "percentage" && row.percentage > 0 && (
                    <span className="text-[10px] text-muted-foreground w-20 text-right shrink-0">
                      = {formatCurrency(totalFee * row.percentage / 100)}
                    </span>
                  )}
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => removeRow(idx)} data-testid={`button-remove-agent-${idx}`}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            <Button variant="outline" size="sm" onClick={addRow} className="w-full" data-testid="button-add-agent-row">
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add BGP Agent
            </Button>

            {allocType === "percentage" && rows.length > 0 && (
              <div className="text-xs text-right">
                <span className={`font-medium ${Math.abs(rows.reduce((s, r) => s + (r.percentage || 0), 0) - 100) > 0.01 ? "text-red-500" : "text-green-600"}`}>
                  Total: {rows.reduce((s, r) => s + (r.percentage || 0), 0).toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : allocations && allocations.length > 0 ? (
          <div className="space-y-1">
            {allocations.map((alloc, idx) => {
              const amount = alloc.allocationType === "percentage"
                ? totalFee * (alloc.percentage || 0) / 100
                : alloc.fixedAmount || 0;
              return (
                <div key={alloc.id} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/30" data-testid={`fee-alloc-display-${idx}`}>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-[9px] font-semibold">
                        {alloc.agentName.split(" ").map(n => n[0]).join("").slice(0, 2)}
                      </span>
                    </div>
                    <span className="text-sm font-medium">{alloc.agentName}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
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

  const [step, setStep] = useState<"upload" | "parsing" | "form" | "saving" | "kyc">("upload");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [extractedData, setExtractedData] = useState<any>(null);
  const [missingFields, setMissingFields] = useState<string[]>([]);

  const [form, setForm] = useState({
    invoicingEntityId: "",
    invoicingEmail: "",
    propertyId: "",
    rentPa: 0,
    feePercentage: 0,
    fee: 0,
    completionTiming: "",
    amlCheckCompleted: "",
    invoicingNotes: "",
    poNumber: "",
    leaseLength: "",
    breakOption: "",
    rentFree: "",
    capitalContribution: 0,
    dealType: "",
    assetClass: "",
    totalAreaSqft: 0,
  });
  const [feeRows, setFeeRows] = useState<{ agentName: string; percentage: number }[]>([
    { agentName: "", percentage: 100 },
  ]);
  const [companySearch, setCompanySearch] = useState("");
  const [propertySearch, setPropertySearch] = useState("");
  const [kycResult, setKycResult] = useState<{
    running: boolean;
    status?: string;
    profile?: any;
    officers?: any[];
    error?: string;
  } | null>(null);

  const { data: existingAllocations } = useQuery<DealFeeAllocation[]>({
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
      setKycResult(null);
      setCompanySearch("");
      setPropertySearch("");
    }
  }, [open]);

  useEffect(() => {
    if (deal && open && step === "upload") {
      setForm(prev => ({
        ...prev,
        invoicingEntityId: deal.invoicingEntityId || "",
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
        completionTiming: deal.completionTiming || "",
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
    if (form.rentPa > 0 && form.feePercentage > 0) {
      setForm(prev => ({ ...prev, fee: Math.round(prev.rentPa * prev.feePercentage) / 100 }));
    }
  }, [form.rentPa, form.feePercentage]);

  const filteredCompanies = useMemo(() => {
    if (!companySearch.trim()) return companies.slice(0, 20);
    const q = companySearch.toLowerCase();
    return companies.filter(c => c.name.toLowerCase().includes(q)).slice(0, 20);
  }, [companies, companySearch]);

  const filteredProperties = useMemo(() => {
    if (!propertySearch.trim()) return properties.slice(0, 20);
    const q = propertySearch.toLowerCase();
    return properties.filter(p => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [properties, propertySearch]);

  const selectedCompany = companies.find(c => c.id === form.invoicingEntityId);
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
      const billingId = tenantId || landlordId || form.invoicingEntityId;
      const propId = tryMatchProperty(ex.propertyAddress) || form.propertyId;

      if (!billingId) missing.push("Billing Entity");
      if (!propId) missing.push("Property / Unit");
      if (!ex.rentPa) missing.push("Rent PA");
      if (!ex.feePercentage && !ex.fee) missing.push("Fee Details");
      if (!ex.completionTiming) missing.push("Completion Timing");

      setMissingFields(missing);
      setForm(prev => ({
        ...prev,
        invoicingEntityId: billingId || prev.invoicingEntityId,
        propertyId: propId || prev.propertyId,
        rentPa: ex.rentPa || prev.rentPa,
        feePercentage: ex.feePercentage || prev.feePercentage,
        fee: ex.fee || prev.fee,
        completionTiming: ex.completionTiming || prev.completionTiming,
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

      if (!tenantId && ex.tenantName) setCompanySearch(ex.tenantName);
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
        invoicingEntityId: form.invoicingEntityId || null,
        invoicingEmail: form.invoicingEmail || null,
        propertyId: form.propertyId || null,
        rentPa: form.rentPa || null,
        feePercentage: form.feePercentage || null,
        fee: form.fee || null,
        completionTiming: form.completionTiming || null,
        amlCheckCompleted: form.amlCheckCompleted || null,
        invoicingNotes: form.invoicingNotes || null,
        poNumber: form.poNumber || null,
        hotsCompletedAt: new Date().toISOString(),
      };
      if (form.leaseLength) payload.leaseLength = form.leaseLength;
      if (form.breakOption) payload.breakOption = form.breakOption;
      if (form.rentFree) payload.rentFree = form.rentFree;
      if (form.capitalContribution) payload.capitalContribution = form.capitalContribution;
      if (form.dealType) payload.dealType = form.dealType;
      if (form.assetClass) payload.assetClass = form.assetClass;
      if (form.totalAreaSqft) payload.totalAreaSqft = form.totalAreaSqft;

      await apiRequest("PUT", `/api/crm/deals/${deal.id}`, payload);
      const allocations = feeRows.filter(r => r.agentName).map(r => ({
        agentName: r.agentName,
        allocationType: "percentage",
        percentage: r.percentage,
        fixedAmount: 0,
      }));
      await apiRequest("PUT", `/api/crm/deals/${deal.id}/fee-allocations`, { allocations });
    },
    onSuccess: async () => {
      toast({ title: "HOTs checklist completed", description: "Deal moved to HOTs with all details saved." });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/fee-allocations"] });

      if (form.invoicingEntityId) {
        setStep("kyc");
        setKycResult({ running: true });
        try {
          const res = await fetch(`/api/companies-house/auto-kyc/${form.invoicingEntityId}`, {
            method: "POST",
            credentials: "include",
            headers: getAuthHeaders(),
          });
          const data = await res.json();
          if (res.ok && data.success) {
            setKycResult({ running: false, status: data.kycStatus, profile: data.profile, officers: data.officers });
            queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
            toast({
              title: data.kycStatus === "pass" ? "KYC Verified" : data.kycStatus === "warning" ? "KYC Needs Review" : "KYC Failed",
              description: `${data.profile?.companyName || "Company"} — ${data.kycStatus === "pass" ? "Active, no adverse flags" : "Review needed"}`,
              variant: data.kycStatus === "fail" ? "destructive" : "default",
            });
          } else {
            setKycResult({ running: false, status: data.kycStatus || "error", error: data.message || data.error });
          }
        } catch (err: any) {
          setKycResult({ running: false, status: "error", error: err.message });
        }
      } else {
        onOpenChange(false);
        onComplete();
      }
    },
    onError: (err: Error) => {
      setStep("form");
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const canSubmit = form.invoicingEntityId && form.fee > 0;
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
            {step === "kyc" && "Running Companies House KYC check..."}
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

            <div className={`rounded-md border p-3 space-y-3 bg-muted/20 ${missingFields.includes("Billing Entity") ? "ring-2 ring-amber-400" : ""}`}>
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Billing Entity (required)
                {missingFields.includes("Billing Entity") && <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-400">Needs input</Badge>}
              </h4>
              <div>
                <Label className="text-xs">Client / Invoicing Entity</Label>
                <div className="relative">
                  <Input
                    value={selectedCompany ? selectedCompany.name : companySearch}
                    onChange={(e) => {
                      setCompanySearch(e.target.value);
                      if (form.invoicingEntityId) setForm(prev => ({ ...prev, invoicingEntityId: "" }));
                    }}
                    placeholder="Search companies..."
                    data-testid="input-hots-company"
                  />
                  {companySearch && !form.invoicingEntityId && (
                    <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {filteredCompanies.map(c => (
                        <div key={c.id} className="px-3 py-2 text-sm hover:bg-accent cursor-pointer"
                          onClick={() => { setForm(prev => ({ ...prev, invoicingEntityId: c.id })); setCompanySearch(""); }}
                          data-testid={`hots-company-option-${c.id}`}>
                          <span className="font-medium">{c.name}</span>
                          {c.companyType && <Badge variant="outline" className="ml-2 text-[10px]">{c.companyType}</Badge>}
                          {c.companiesHouseNumber && <Badge className="ml-1 text-[9px] bg-green-600">KYC</Badge>}
                        </div>
                      ))}
                      {filteredCompanies.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No companies found</div>}
                    </div>
                  )}
                </div>
                {selectedCompany && (
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{selectedCompany.name}</Badge>
                    {selectedCompany.companiesHouseNumber ? (
                      <Badge className="text-[9px] bg-green-600 text-white">KYC Verified</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-400">KYC Required</Badge>
                    )}
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setForm(prev => ({ ...prev, invoicingEntityId: "" }))}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>
              <div>
                <Label className="text-xs">Invoicing Email Address</Label>
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
                          {p.address && <span className="text-muted-foreground ml-1">— {p.address}</span>}
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
                  <Label className="text-xs">Rent PA (£)</Label>
                  <Input type="number" value={form.rentPa || ""} onChange={(e) => setForm(prev => ({ ...prev, rentPa: parseFloat(e.target.value) || 0 }))}
                    placeholder="0" data-testid="input-hots-rent" />
                </div>
                <div>
                  <Label className="text-xs">% Agency Fee</Label>
                  <Input type="number" step="0.01" value={form.feePercentage || ""}
                    onChange={(e) => setForm(prev => ({ ...prev, feePercentage: parseFloat(e.target.value) || 0 }))}
                    placeholder="e.g. 10" data-testid="input-hots-fee-pct" />
                </div>
                <div>
                  <Label className="text-xs">Total Fee (£) +VAT</Label>
                  <Input type="number" step="0.01" value={form.fee || ""}
                    onChange={(e) => setForm(prev => ({ ...prev, fee: parseFloat(e.target.value) || 0 }))}
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
                    <Input type="number" className="w-16" value={row.percentage || ""}
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
                  {form.fee > 0 && ` — ${feeRows.filter(r => r.agentName).map(r => `${r.agentName}: £${((form.fee * r.percentage / 100)).toFixed(2)}`).join(", ")}`}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className={missingFields.includes("Completion Timing") ? "ring-2 ring-amber-400 rounded-md" : ""}>
                <Label className="text-xs">Timing for Completion</Label>
                <Select value={form.completionTiming || undefined} onValueChange={(v) => setForm(prev => ({ ...prev, completionTiming: v }))}>
                  <SelectTrigger data-testid="select-hots-timing"><SelectValue placeholder="Select timing" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Complete - to bill">Complete - to bill</SelectItem>
                    <SelectItem value="Pending exchange">Pending exchange</SelectItem>
                    <SelectItem value="Pending completion">Pending completion</SelectItem>
                    <SelectItem value="30 days">30 days</SelectItem>
                    <SelectItem value="60 days">60 days</SelectItem>
                    <SelectItem value="90 days">90 days</SelectItem>
                    <SelectItem value="6 months">6 months</SelectItem>
                    <SelectItem value="TBC">TBC</SelectItem>
                  </SelectContent>
                </Select>
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

        {step === "kyc" && kycResult && (
          <div className="rounded-md border p-3 space-y-3 bg-muted/20" data-testid="hots-kyc-result">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              Companies House KYC
              {kycResult.running && <Loader2 className="w-3 h-3 animate-spin" />}
            </h4>
            {kycResult.running && <p className="text-xs text-muted-foreground">Running automated KYC check against Companies House...</p>}
            {!kycResult.running && kycResult.status === "pass" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-medium text-green-700">Verified — Active Company</span>
                </div>
                {kycResult.profile && (
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <span className="text-muted-foreground">Company:</span><span>{kycResult.profile.companyName}</span>
                    <span className="text-muted-foreground">Number:</span><span>{kycResult.profile.companyNumber}</span>
                    <span className="text-muted-foreground">Status:</span><span className="capitalize">{kycResult.profile.companyStatus}</span>
                    <span className="text-muted-foreground">Incorporated:</span><span>{kycResult.profile.dateOfCreation}</span>
                  </div>
                )}
                {kycResult.officers && kycResult.officers.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mt-2 mb-1">Active Officers / Advisors:</p>
                    <div className="space-y-1">
                      {kycResult.officers.map((o: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <Badge variant="outline" className="text-[9px]">{o.officerRole?.replace(/-/g, " ")}</Badge>
                          <span>{o.name}</span>
                          {o.appointedOn && <span className="text-muted-foreground">since {o.appointedOn}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {!kycResult.running && kycResult.status === "warning" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-500" />
                  <span className="text-sm font-medium text-yellow-700">Needs Review</span>
                </div>
                {kycResult.profile && (
                  <div className="text-xs space-y-1">
                    <p>{kycResult.profile.companyName} ({kycResult.profile.companyNumber})</p>
                    {kycResult.profile.hasInsolvencyHistory && <p className="text-amber-600">Insolvency history found</p>}
                    {kycResult.profile.accountsOverdue && <p className="text-amber-600">Accounts overdue</p>}
                  </div>
                )}
                {kycResult.officers && kycResult.officers.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mt-1 mb-1">Active Officers:</p>
                    {kycResult.officers.map((o: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="text-[9px]">{o.officerRole?.replace(/-/g, " ")}</Badge>
                        <span>{o.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!kycResult.running && kycResult.status === "fail" && (
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-500" />
                <span className="text-sm font-medium text-red-700">Failed — Company Not Active</span>
              </div>
            )}
            {!kycResult.running && (kycResult.status === "not_found" || kycResult.status === "error") && (
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{kycResult.error || "KYC check could not complete"}</span>
              </div>
            )}
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
          {step === "kyc" && (
            <Button onClick={() => { setKycResult(null); onOpenChange(false); onComplete(); }}
              disabled={kycResult?.running} data-testid="button-hots-done">
              {kycResult?.running ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running KYC...</> : "Done"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function XeroInvoiceSection({ dealId, deal, companies = [] }: { dealId: string; deal: CrmDeal; companies?: CrmCompany[] }) {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const { data: amlStatus } = useDealAmlStatus(dealId);
  const [contactName, setContactName] = useState("");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [invoicingEntityId, setInvoicingEntityId] = useState(deal.invoicingEntityId || "");
  const [entitySearch, setEntitySearch] = useState("");
  const [poNumber, setPoNumber] = useState(deal.poNumber || "");

  useEffect(() => {
    setInvoicingEntityId(deal.invoicingEntityId || "");
  }, [deal.invoicingEntityId]);

  const invoicingEntity = companies.find(c => c.id === invoicingEntityId);

  const filteredEntities = useMemo(() => {
    if (!entitySearch) return companies.slice(0, 20);
    const q = entitySearch.toLowerCase();
    return companies.filter(c => c.name?.toLowerCase().includes(q)).slice(0, 20);
  }, [companies, entitySearch]);

  const updateInvoicingEntity = useCallback((entityId: string) => {
    setInvoicingEntityId(entityId);
    setEntitySearch("");
    const entity = companies.find(c => c.id === entityId);
    if (entity?.name) setContactName(entity.name);
    apiRequest("PUT", `/api/crm/deals/${dealId}`, { invoicingEntityId: entityId || null })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId] });
        queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
        if (entityId) {
          toast({ title: "Running KYC", description: `Checking ${entity?.name || "entity"} via Companies House...` });
          fetch(`/api/companies-house/auto-kyc/${entityId}`, { method: "POST", credentials: "include", headers: getAuthHeaders() })
            .then(r => r.json())
            .then(data => {
              if (data.success) {
                queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
                toast({
                  title: data.kycStatus === "pass" ? "KYC Passed" : data.kycStatus === "warning" ? "KYC Needs Review" : "KYC Failed",
                  description: `${data.profile?.companyName || entity?.name || "Company"} — ${data.kycStatus === "pass" ? "Active, no adverse flags" : "Review needed"}`,
                  variant: data.kycStatus === "fail" ? "destructive" : "default",
                });
              }
            })
            .catch(() => {});
        }
      });
  }, [companies, dealId, toast]);

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
      const finalContact = contactName || invoicingEntity?.name || deal.name;
      const res = await apiRequest("POST", "/api/xero/invoices", {
        dealId,
        contactName: finalContact,
        invoicingEntityId: invoicingEntityId || null,
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
      setContactName("");
      setReference("");
      setAmount(0);
      refetchInvoices();
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
                disabled={amlStatus && !amlStatus.canInvoice}
                title={amlStatus && !amlStatus.canInvoice ? `AML approval needed for ${amlStatus.missing.join(", ")}` : undefined}
                data-testid="button-create-xero-invoice"
              >
                <Send className="w-3.5 h-3.5 mr-1" />
                Send to Xero
                {amlStatus && !amlStatus.canInvoice && <span className="ml-1.5 text-[10px] uppercase opacity-70">AML pending</span>}
              </Button>
            )}
          </div>
        </div>

        {invoicingEntity && !creating && (
          <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
            <Building2 className="w-3.5 h-3.5" />
            <span>Invoicing Entity: <span className="font-medium text-foreground">{invoicingEntity.name}</span></span>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => updateInvoicingEntity("")} data-testid="button-clear-invoicing-entity">
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}

        {creating && !deal.kycApproved && (
          <div className="flex items-center gap-2 mb-3 p-2 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs" data-testid="kyc-warning-banner">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <span>KYC has not been approved for this deal. From 1st May 2025, invoices cannot be created without KYC approval.</span>
          </div>
        )}

        {creating && (
          <div className="border rounded-md p-3 mb-3 space-y-3 bg-muted/30">
            <div>
              <Label className="text-xs mb-1 block">Invoicing Entity (Billing Company)</Label>
              {invoicingEntity ? (
                <div className="flex items-center gap-2 bg-background border rounded-md px-3 py-2">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium flex-1">{invoicingEntity.name}</span>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setInvoicingEntityId(""); setContactName(""); }} data-testid="button-change-invoicing-entity">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    value={entitySearch}
                    onChange={(e) => setEntitySearch(e.target.value)}
                    placeholder="Search companies..."
                    data-testid="input-invoicing-entity-search"
                  />
                  {entitySearch && filteredEntities.length > 0 && (
                    <div className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {filteredEntities.map(c => (
                        <button
                          key={c.id}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent truncate"
                          onClick={() => updateInvoicingEntity(c.id)}
                          data-testid={`entity-option-${c.id}`}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1 block">Contact / Client Name</Label>
                <Input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder={invoicingEntity?.name || deal.name || "Client name"}
                  data-testid="input-xero-contact"
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
                disabled={createInvoiceMutation.isPending || (amlStatus && !amlStatus.canInvoice)}
                title={amlStatus && !amlStatus.canInvoice ? `AML approval needed for ${amlStatus.missing.join(", ")}` : undefined}
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
          {kycStatus === "pass" ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" /> :
           kycStatus === "warning" ? <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" /> :
           kycStatus === "fail" ? <XCircle className="w-4 h-4 text-red-500 shrink-0" /> :
           <div className="w-4 h-4 rounded-full border-2 border-dashed border-muted-foreground/40 shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{company.name}</p>
            <p className="text-[10px] text-muted-foreground">{role}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {kycStatus && (
            <Badge className={`text-[9px] ${kycStatus === "pass" ? "bg-green-600" : kycStatus === "warning" ? "bg-amber-500" : "bg-red-500"} text-white`}>
              {kycStatus === "pass" ? "Verified" : kycStatus === "warning" ? "Review" : "Failed"}
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

  add(deal.invoicingEntityId, "Billing Entity", true);

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

  const totalRequired = parties.filter(p => p.required).length;
  const totalPassed = parties.filter(p => p.required && p.company.kycStatus === "pass").length;
  const totalWarning = parties.filter(p => p.required && p.company.kycStatus === "warning").length;
  const totalFailed = parties.filter(p => p.required && p.company.kycStatus === "fail").length;
  const totalUnchecked = totalRequired - totalPassed - totalWarning - totalFailed;

  const allComplete = totalUnchecked === 0 && totalFailed === 0;

  const runKyc = async (companyId: string) => {
    setLoadingIds(prev => new Set(prev).add(companyId));
    const entity = companies.find(c => c.id === companyId);
    try {
      const res = await fetch(`/api/companies-house/auto-kyc/${companyId}`, { method: "POST", credentials: "include", headers: getAuthHeaders() });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      if (data.success) {
        toast({
          title: data.kycStatus === "pass" ? "KYC Passed" : data.kycStatus === "warning" ? "KYC Needs Review" : "KYC Failed",
          description: `${data.profile?.companyName || entity?.name} — ${data.kycStatus === "pass" ? "Active, no adverse flags" : "Review needed"}`,
          variant: data.kycStatus === "fail" ? "destructive" : "default",
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
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
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
              <Badge className="text-[9px] bg-amber-500 text-white">Ready to Approve</Badge>
            ) : totalUnchecked > 0 ? (
              <Badge variant="outline" className="text-[9px] text-muted-foreground">{totalUnchecked} unchecked</Badge>
            ) : totalFailed > 0 ? (
              <Badge className="text-[9px] bg-red-500 text-white">{totalFailed} failed</Badge>
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
                  {kycStatus === "pass" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /> :
                   kycStatus === "warning" ? <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" /> :
                   kycStatus === "fail" ? <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" /> :
                   <div className="w-3.5 h-3.5 rounded-full border-2 border-dashed border-muted-foreground/40 shrink-0" />}
                  <div className="min-w-0">
                    <Link href={`/companies/${company.id}`}>
                      <span className="text-xs font-medium hover:underline cursor-pointer truncate block">{company.name}</span>
                    </Link>
                    <span className="text-[10px] text-muted-foreground capitalize">{role}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {kycStatus && (
                    <Badge className={`text-[8px] h-4 ${kycStatus === "pass" ? "bg-green-600" : kycStatus === "warning" ? "bg-amber-500" : "bg-red-500"} text-white`}>
                      {kycStatus === "pass" ? "Verified" : kycStatus === "warning" ? "Review" : "Failed"}
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

const SOURCE_OF_FUNDS_OPTIONS = [
  { value: "mortgage", label: "Mortgage" },
  { value: "cash", label: "Cash / Own Funds" },
  { value: "investment", label: "Investment Proceeds" },
  { value: "pension", label: "Pension" },
  { value: "inheritance", label: "Inheritance" },
  { value: "sale_proceeds", label: "Sale Proceeds" },
  { value: "business_income", label: "Business Income" },
  { value: "loan", label: "Third Party Loan" },
  { value: "other", label: "Other" },
];

const SOURCE_OF_WEALTH_OPTIONS = [
  { value: "employment", label: "Employment / Salary" },
  { value: "business", label: "Business Ownership" },
  { value: "inheritance", label: "Inheritance" },
  { value: "investment", label: "Investments / Dividends" },
  { value: "property", label: "Property Sales" },
  { value: "gift", label: "Gift" },
  { value: "other", label: "Other" },
];

const PEP_STATUS_OPTIONS = [
  { value: "clear", label: "Not a PEP" },
  { value: "pep_domestic", label: "Domestic PEP" },
  { value: "pep_foreign", label: "Foreign PEP" },
  { value: "pep_family", label: "PEP Family Member" },
  { value: "pep_associate", label: "PEP Close Associate" },
];

const ID_DOC_OPTIONS = [
  { value: "passport", label: "Passport" },
  { value: "driving_licence", label: "Driving Licence" },
  { value: "national_id", label: "National ID Card" },
  { value: "other", label: "Other Government ID" },
];

const ADDRESS_DOC_OPTIONS = [
  { value: "utility_bill", label: "Utility Bill (< 3 months)" },
  { value: "bank_statement", label: "Bank Statement (< 3 months)" },
  { value: "council_tax", label: "Council Tax Bill" },
  { value: "mortgage_statement", label: "Mortgage Statement" },
  { value: "other", label: "Other" },
];

const EDD_REASON_LABELS: Record<string, string> = {
  super_prime: "Super-prime transaction value",
  pep: "Politically Exposed Person",
  high_risk_country: "High-risk third country",
  complex_structure: "Complex ownership structure",
  suspicious: "Suspicious indicators",
  other: "Other risk factors",
};

export function DealAMLChecklist({ deal }: { deal: CrmDeal }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState<string | null>(null);

  const updateField = async (field: string, value: any) => {
    setSaving(field);
    try {
      await apiRequest("PUT", `/api/crm/deals/${deal.id}`, { [field]: value });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", deal.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const updateFields = async (fields: Record<string, any>) => {
    setSaving("multi");
    try {
      await apiRequest("PUT", `/api/crm/deals/${deal.id}`, fields);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", deal.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const d = deal as any;
  const pricing = d.pricing || 0;
  const isLondon = (d.name || "").toLowerCase().includes("london") || (d.assetClass || "").toLowerCase().includes("london");
  const superPrimeThreshold = isLondon ? 5_000_000 : 1_000_000;
  const isSuperPrime = pricing >= superPrimeThreshold;

  // Calculate overall compliance progress
  const checks = [
    { label: "Companies House KYC", done: !!d.kycApproved },
    { label: "Identity verified", done: !!d.amlIdVerified },
    { label: "Address verified", done: !!d.amlAddressVerified },
    { label: "Source of funds", done: !!d.amlSourceOfFunds },
    { label: "Source of wealth", done: !!d.amlSourceOfWealth },
    { label: "PEP screening", done: !!d.amlPepStatus },
    { label: "Sanctions screening", done: d.amlCheckCompleted === "YES" },
  ];
  if (d.amlEddRequired) {
    checks.push({ label: "Enhanced Due Diligence", done: !!d.amlEddCompletedAt });
  }
  const completedCount = checks.filter(c => c.done).length;
  const totalChecks = checks.length;
  const progressPct = Math.round((completedCount / totalChecks) * 100);

  const riskLevel = d.amlRiskLevel || (isSuperPrime ? "high" : d.amlPepStatus && d.amlPepStatus !== "clear" ? "high" : "");
  const riskColor = riskLevel === "critical" ? "bg-red-600" : riskLevel === "high" ? "bg-red-500" : riskLevel === "medium" ? "bg-amber-500" : riskLevel === "low" ? "bg-green-600" : "bg-muted";

  return (
    <Card data-testid="deal-aml-checklist">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5" />
            <h3 className="text-xs font-semibold">MLR 2017 Compliance Checklist</h3>
            {riskLevel && (
              <Badge className={`text-[9px] ${riskColor} text-white capitalize`}>{riskLevel} risk</Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{completedCount}/{totalChecks} complete</span>
            <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        </div>

        {isSuperPrime && !d.amlEddRequired && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>Super-prime transaction ({pricing >= 5_000_000 ? "£5M+" : "£1M+"}) — Enhanced Due Diligence required under MLR 2017</span>
            <Button size="sm" variant="outline" className="ml-auto text-[10px] h-6" onClick={() => updateFields({ amlEddRequired: true, amlEddReason: "super_prime" })}>
              Flag EDD
            </Button>
          </div>
        )}

        {/* Risk Level */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Overall Risk Assessment</label>
          <div className="flex gap-1.5">
            {["low", "medium", "high", "critical"].map(level => (
              <Button
                key={level}
                variant={riskLevel === level ? "default" : "outline"}
                size="sm"
                className={`text-[10px] h-7 capitalize ${riskLevel === level ? (level === "low" ? "bg-green-600 hover:bg-green-700" : level === "medium" ? "bg-amber-500 hover:bg-amber-600" : level === "high" ? "bg-red-500 hover:bg-red-600" : "bg-red-700 hover:bg-red-800") : ""}`}
                onClick={() => updateField("amlRiskLevel", level)}
                disabled={saving === "amlRiskLevel"}
              >
                {level}
              </Button>
            ))}
          </div>
        </div>

        {/* CDD Section: Identity & Address */}
        <div className="space-y-2">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Customer Due Diligence — Identity</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-md border p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">ID Verification</span>
                {d.amlIdVerified ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <div className="w-3.5 h-3.5 rounded-full border-2 border-dashed border-muted-foreground/40" />}
              </div>
              <Select value={d.amlIdDocType || ""} onValueChange={(v) => updateFields({ amlIdDocType: v, amlIdVerified: true, amlIdVerifiedAt: new Date().toISOString() })}>
                <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="Select ID document type..." /></SelectTrigger>
                <SelectContent>
                  {ID_DOC_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {d.amlIdVerifiedAt && <p className="text-[10px] text-muted-foreground">Verified {new Date(d.amlIdVerifiedAt).toLocaleDateString("en-GB")}{d.amlIdVerifiedBy ? ` by ${d.amlIdVerifiedBy}` : ""}</p>}
            </div>

            <div className="rounded-md border p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Address Verification</span>
                {d.amlAddressVerified ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <div className="w-3.5 h-3.5 rounded-full border-2 border-dashed border-muted-foreground/40" />}
              </div>
              <Select value={d.amlAddressDocType || ""} onValueChange={(v) => updateFields({ amlAddressDocType: v, amlAddressVerified: true })}>
                <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="Select proof of address..." /></SelectTrigger>
                <SelectContent>
                  {ADDRESS_DOC_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Source of Funds & Wealth */}
        <div className="space-y-2">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Source of Funds & Wealth</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-md border p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Source of Funds</span>
                {d.amlSourceOfFunds ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <div className="w-3.5 h-3.5 rounded-full border-2 border-dashed border-muted-foreground/40" />}
              </div>
              <Select value={d.amlSourceOfFunds || ""} onValueChange={(v) => updateField("amlSourceOfFunds", v)}>
                <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="How is this transaction funded?" /></SelectTrigger>
                <SelectContent>
                  {SOURCE_OF_FUNDS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Textarea
                placeholder="Additional details on funding source..."
                className="text-[11px] min-h-[48px]"
                defaultValue={d.amlSourceOfFundsNotes || ""}
                onBlur={(e) => { if (e.target.value !== (d.amlSourceOfFundsNotes || "")) updateField("amlSourceOfFundsNotes", e.target.value); }}
              />
            </div>

            <div className="rounded-md border p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Source of Wealth</span>
                {d.amlSourceOfWealth ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <div className="w-3.5 h-3.5 rounded-full border-2 border-dashed border-muted-foreground/40" />}
              </div>
              <Select value={d.amlSourceOfWealth || ""} onValueChange={(v) => updateField("amlSourceOfWealth", v)}>
                <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="Origin of customer's wealth?" /></SelectTrigger>
                <SelectContent>
                  {SOURCE_OF_WEALTH_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Textarea
                placeholder="Additional details on wealth origin..."
                className="text-[11px] min-h-[48px]"
                defaultValue={d.amlSourceOfWealthNotes || ""}
                onBlur={(e) => { if (e.target.value !== (d.amlSourceOfWealthNotes || "")) updateField("amlSourceOfWealthNotes", e.target.value); }}
              />
            </div>
          </div>
        </div>

        {/* PEP Screening */}
        <div className="space-y-2">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">PEP & Sanctions Screening</label>
          <div className="rounded-md border p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">PEP Status</span>
              {d.amlPepStatus === "clear" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> :
               d.amlPepStatus && d.amlPepStatus !== "clear" ? <ShieldAlert className="w-3.5 h-3.5 text-red-500" /> :
               <div className="w-3.5 h-3.5 rounded-full border-2 border-dashed border-muted-foreground/40" />}
            </div>
            <Select value={d.amlPepStatus || ""} onValueChange={(v) => updateField("amlPepStatus", v)}>
              <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="PEP screening result..." /></SelectTrigger>
              <SelectContent>
                {PEP_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {d.amlPepStatus && d.amlPepStatus !== "clear" && (
              <div className="p-1.5 rounded bg-red-50 border border-red-200 text-[10px] text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300">
                PEP identified — Enhanced Due Diligence and senior management approval required (MLR 2017 Reg 35)
              </div>
            )}
            <Textarea
              placeholder="PEP screening notes..."
              className="text-[11px] min-h-[36px]"
              defaultValue={d.amlPepNotes || ""}
              onBlur={(e) => { if (e.target.value !== (d.amlPepNotes || "")) updateField("amlPepNotes", e.target.value); }}
            />
          </div>
        </div>

        {/* Enhanced Due Diligence */}
        {(d.amlEddRequired || isSuperPrime || (d.amlPepStatus && d.amlPepStatus !== "clear")) && (
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="w-3 h-3 text-red-500" />
              Enhanced Due Diligence (EDD)
            </label>
            <div className="rounded-md border border-red-200 bg-red-50/50 p-2.5 space-y-2 dark:bg-red-950/20 dark:border-red-800">
              {d.amlEddReason && (
                <div className="flex flex-wrap gap-1">
                  {d.amlEddReason.split(",").map((r: string) => (
                    <Badge key={r} variant="outline" className="text-[9px] border-red-300 text-red-700 dark:text-red-300">{EDD_REASON_LABELS[r] || r}</Badge>
                  ))}
                </div>
              )}
              <Textarea
                placeholder="EDD findings and additional measures taken..."
                className="text-[11px] min-h-[60px]"
                defaultValue={d.amlEddNotes || ""}
                onBlur={(e) => { if (e.target.value !== (d.amlEddNotes || "")) updateField("amlEddNotes", e.target.value); }}
              />
              {d.amlEddCompletedAt ? (
                <p className="text-[10px] text-green-600">
                  <CheckCircle2 className="w-3 h-3 inline mr-1" />
                  EDD completed {new Date(d.amlEddCompletedAt).toLocaleDateString("en-GB")}{d.amlEddCompletedBy ? ` by ${d.amlEddCompletedBy}` : ""}
                </p>
              ) : (
                <Button size="sm" variant="outline" className="text-[10px] h-7 border-red-300 text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-950"
                  onClick={() => updateFields({ amlEddCompletedAt: new Date().toISOString() })}
                  disabled={saving === "multi"}>
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Mark EDD Complete
                </Button>
              )}
            </div>
          </div>
        )}

        {/* SAR Section */}
        <div className="space-y-2">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Suspicious Activity Report (SAR)</label>
          <div className="rounded-md border p-2.5 space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="sar-filed"
                  checked={!!d.amlSarFiled}
                  onCheckedChange={(checked) => updateField("amlSarFiled", !!checked)}
                />
                <label htmlFor="sar-filed" className="text-xs">SAR filed with NCA</label>
              </div>
              {d.amlSarFiled && d.amlSarFiledAt && (
                <span className="text-[10px] text-muted-foreground">Filed {new Date(d.amlSarFiledAt).toLocaleDateString("en-GB")}</span>
              )}
            </div>
            {d.amlSarFiled && (
              <>
                <Input
                  placeholder="NCA reference number..."
                  className="h-7 text-[11px]"
                  defaultValue={d.amlSarReference || ""}
                  onBlur={(e) => { if (e.target.value !== (d.amlSarReference || "")) updateField("amlSarReference", e.target.value); }}
                />
                <div className="p-2 rounded bg-red-100 border border-red-300 text-[10px] text-red-800 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200 space-y-1">
                  <p className="font-semibold flex items-center gap-1"><ShieldAlert className="w-3 h-3" /> TIPPING OFF WARNING — Criminal Offence</p>
                  <p>Under sections 333A of the Proceeds of Crime Act 2002 and section 21D of the Terrorism Act 2000, it is a criminal offence to disclose to the customer (or any third party) that a SAR has been filed or that an investigation is underway. Penalty: up to 5 years imprisonment and/or unlimited fine.</p>
                  <p className="font-medium">Do NOT inform the customer or any third party about this report.</p>
                </div>
              </>
            )}
            <p className="text-[10px] text-muted-foreground">File SARs via the NCA SAR Portal: sarsreporting.nationalcrimeagency.gov.uk</p>
          </div>
        </div>

        {/* Compliance Notes */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Compliance Notes</label>
          <Textarea
            placeholder="Any additional compliance observations, risk factors, or actions taken..."
            className="text-[11px] min-h-[48px]"
            defaultValue={d.amlComplianceNotes || ""}
            onBlur={(e) => { if (e.target.value !== (d.amlComplianceNotes || "")) updateField("amlComplianceNotes", e.target.value); }}
          />
        </div>

        {/* Checklist Summary */}
        <div className="rounded-md bg-muted/30 border p-2.5">
          <p className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Compliance Checklist</p>
          <div className="grid grid-cols-2 gap-1">
            {checks.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                {c.done ? <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" /> : <div className="w-3 h-3 rounded-full border border-muted-foreground/30 shrink-0" />}
                <span className={c.done ? "text-foreground" : "text-muted-foreground"}>{c.label}</span>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-muted-foreground mt-2">
            Money Laundering Regulations 2017 / RICS Professional Statement on AML / HMRC Guidance for Estate Agency Businesses
          </p>
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
      completionDate: "completion date", tenureText: "tenure", assetClass: "asset class",
      comments: "comments", amlCheckCompleted: "AML check", totalAreaSqft: "total area",
      propertyId: "property", landlordId: "landlord", tenantId: "tenant",
      vendorId: "vendor", purchaserId: "purchaser", invoicingEntityId: "billing entity",
      kycApproved: "KYC approved", feePercentage: "fee %",
      completionTiming: "completion timing", invoicingNotes: "invoicing notes",
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
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
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

const NEGOTIATION_STATUSES = ["Under Negotiation", "HOTs", "NEG"];
const COMPLETED_STATUSES = ["Invoiced", "Billed", "Exchanged", "Completed"];
const INTERNAL_BGP_TEAMS = new Set([
  "London Leasing", "National Leasing", "Investment", "Tenant Rep",
  "Development", "Lease Advisory", "Office / Corporate",
]);

export default function Deals({ mode = "wip" }: { mode?: "wip" | "comps" | "negotiations" } = {}) {
  const isCompsMode = mode === "comps";
  const isNegotiationsMode = mode === "negotiations";
  const [, dealsParams] = useRoute("/deals/:id");
  const [, compsParams] = useRoute("/comps/:id");
  const params = isNegotiationsMode ? null : isCompsMode ? compsParams : dealsParams;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { activeTeam } = useTeam();
  const urlParams = new URLSearchParams(window.location.search);
  const urlTeamParam = urlParams.get("team");
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [aiMatchOpen, setAiMatchOpen] = useState(false);
  const [rentAnalysisRunning, setRentAnalysisRunning] = useState(false);
  const [deleteListDeal, setDeleteListDeal] = useState<{ id: string; name: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [hotsChecklistDeal, setHotsChecklistDeal] = useState<CrmDeal | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [teamFilterInitialised, setTeamFilterInitialised] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "card" | "board">(
    typeof window !== "undefined" && window.innerWidth < 768 ? "board" : "table"
  );

  useEffect(() => {
    if (!teamFilterInitialised) {
      const teamToSet = urlTeamParam || (activeTeam && activeTeam !== "all" ? activeTeam : null);
      if (teamToSet) {
        setColumnFilters(prev => ({ ...prev, team: [teamToSet] }));
      }
      setTeamFilterInitialised(true);
    }
  }, [activeTeam, teamFilterInitialised, urlTeamParam]);

  useEffect(() => {
    if (teamFilterInitialised && activeTeam && !urlTeamParam) {
      if (activeTeam === "all") {
        setColumnFilters(prev => { const { team, ...rest } = prev; return rest; });
      } else {
        setColumnFilters(prev => ({ ...prev, team: [activeTeam] }));
      }
    }
  }, [activeTeam]);
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    landlord: true,
    status: true,
    type: true,
    team: true,
    agent: true,
    assetClass: true,
    clientContact: true,
    tenant: true,
    vendor: true,
    purchaser: true,
    vendorAgent: true,
    acquisitionAgent: true,
    purchaserAgent: true,
    leasingAgent: true,
    timeline: true,
    pricing: true,
    yield: true,
    fee: true,
    feeAlloc: true,
    feeAgreement: true,
    amlCheck: true,
    invoicingEntity: true,
    area: true,
    basementArea: true,
    gfArea: true,
    ffArea: true,
    itzaArea: true,
    pricePsf: true,
    priceItza: true,
    rentPa: true,
    capitalContribution: true,
    rentFree: true,
    leaseLength: true,
    breakOption: true,
    completionDate: true,
    rentAnalysis: true,
    comments: true,
    sharepoint: true,
    wipBadge: true,
  });

  const dealsUrl = mode === "wip" ? "/api/crm/deals?excludeTrackerDeals=true" : "/api/crm/deals";
  const { data: deals = [], isLoading, error } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals", { excludeTracker: mode === "wip" }],
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
    queryKey: ["/api/crm/properties"],
  });

  const { data: companies = [] } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
  });

  const { data: contacts = [] } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
  });

  const { data: users = [] } = useQuery<{ id: number; name: string; email: string }[]>({
    queryKey: ["/api/users"],
  });
  const userColorMap2 = useMemo(() => buildUserColorMap(users as any), [users]);

  const { data: allFeeAllocations } = useQuery<Record<string, DealFeeAllocation[]>>({
    queryKey: ["/api/crm/fee-allocations"],
  });

  const { data: wipBadges } = useQuery<Record<string, { amtWip: number; amtInvoice: number; count: number; entries: { ref: string; project: string; amtWip: number; amtInvoice: number; stage: string; month: string }[] }>>({
    queryKey: ["/api/crm/deals/wip-badges"],
    queryFn: async () => {
      const r = await fetch("/api/crm/deals/wip-badges", { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      return r.json();
    },
    enabled: mode === "wip",
  });

  const [listApprovalGateOpen, setListApprovalGateOpen] = useState(false);
  const [listApprovalGateMsg, setListApprovalGateMsg] = useState("");
  const inlineUpdateMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: unknown }) => {
      await apiRequest("PUT", `/api/crm/deals/${id}`, { [field]: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
    },
    onError: (err: Error) => {
      if (err.message.includes("Senior approval required")) {
        const msg = err.message.replace(/^\d+:\s*/, "").replace(/^{?"?error"?:?\s*"?/, "").replace(/"?\s*}?$/, "");
        setListApprovalGateMsg(msg);
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
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      setDeleteListDeal(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ ids, field, value }: { ids: string[]; field: string; value: unknown }) => {
      await apiRequest("POST", "/api/crm/deals/bulk-update", { ids, field, value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      setSelectedIds(new Set());
      toast({ title: "Deals updated" });
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
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
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
      const investmentTypes = ["Purchase", "Sale"];
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

    if (field === "invoicingEntityId" && value) {
      const entityId = String(value);
      const entity = companies.find((c: any) => c.id === entityId);
      toast({ title: "Running KYC", description: `Checking ${entity?.name || "billing entity"} via Companies House...` });
      fetch(`/api/companies-house/auto-kyc/${entityId}`, { method: "POST", credentials: "include", headers: getAuthHeaders() })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
            toast({
              title: data.kycStatus === "pass" ? "KYC Passed" : data.kycStatus === "warning" ? "KYC Needs Review" : "KYC Failed",
              description: `${data.profile?.companyName || entity?.name || "Company"} — ${data.kycStatus === "pass" ? "Active, no adverse flags" : "Review needed"}`,
              variant: data.kycStatus === "fail" ? "destructive" : "default",
            });
          }
        })
        .catch(() => {});
    }
  }, [deals, companies, toast]);

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
    const s = new Set<string>();
    deals.forEach((d) => { if (d.status) s.add(d.status); });
    return Array.from(s).sort();
  }, [deals]);

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
  const SAVED_VIEWS_KEY = "bgp_saved_deal_views";
  type SavedView = { name: string; filters: { search: string; activeGroup: string; columnFilters: Record<string, string[]> } };

  const getSavedViews = useCallback((): SavedView[] => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || "[]"); } catch { return []; }
  }, []);

  const [savedViews, setSavedViews] = useState<SavedView[]>(getSavedViews);
  const [savedViewsOpen, setSavedViewsOpen] = useState(false);

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
  }, [search, activeGroup, columnFilters, getSavedViews, toast]);

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
  }, [getSavedViews, toast]);
  // --- End saved filter views ---

  const baseDeals = useMemo(() => {
    if (isCompsMode) {
      return deals.filter(d => COMPLETED_STATUSES.includes(d.status || ""));
    }
    if (isNegotiationsMode) {
      return deals.filter(d => NEGOTIATION_STATUSES.includes(d.status || "") && !migratedDealIds.has(d.id));
    }
    return deals;
  }, [deals, isCompsMode, isNegotiationsMode, migratedDealIds]);

  const filteredDeals = useMemo(() => {
    return baseDeals.filter((deal) => {
      if (activeGroup !== "all" && deal.status !== activeGroup) return false;
      if (columnFilters["status"]?.length && (!deal.status || !columnFilters["status"].includes(deal.status))) return false;
      if (columnFilters["type"]?.length && (!deal.dealType || !columnFilters["type"].includes(deal.dealType))) return false;
      if (columnFilters["team"]?.length) {
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
        const match =
          deal.name.toLowerCase().includes(s) ||
          propName.toLowerCase().includes(s) ||
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
  }, [baseDeals, activeGroup, columnFilters, search, properties]);

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
      .filter(s => isCompsMode ? COMPLETED_STATUSES.includes(s) : true)
      .map((s) => ({
        name: s,
        count: teamFilteredDeals.filter((d) => d.status === s).length,
      }))
      .filter(s => s.count > 0);
  }, [teamFilteredDeals, statusValues, isCompsMode]);

  if (params?.id && !isNegotiationsMode) {
    return <DealDetail id={params.id} isComps={isCompsMode} />;
  }

  const clearAllFilters = () => {
    setSearch("");
    setActiveGroup("all");
    if (activeTeam && activeTeam !== "all") {
      setColumnFilters({ team: [activeTeam] });
    } else {
      setColumnFilters({});
    }
  };

  const hasFilters = search || activeGroup !== "all" || activeFilterCount > 0;

  if (error) {
    return (
      <PageLayout
        title={isCompsMode ? "Leasing Comps" : "WIP"}
        icon={Handshake}
        subtitle={isCompsMode ? "Comparable transactions" : "Work in Progress"}
      >
        <Card>
          <CardContent className="py-12 text-center">
            <EmptyState
              icon={AlertCircle}
              title={`Could not load ${isCompsMode ? "Leasing Comps" : "WIP"}`}
              description={(error as Error).message || "An error occurred while loading deals."}
            />
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  const propertyMap = new Map(properties.map((p) => [p.id, p.name]));
  const companyMap = new Map(companies.map((c) => [c.id, c.name]));
  const agentCompanies = companies.filter(c => c.companyType === "Agent");

  return (
    <PageLayout
      title={isCompsMode ? "Leasing Comps" : "WIP"}
      icon={Handshake}
      subtitle={isCompsMode
        ? `${baseDeals.length} completed deal${baseDeals.length !== 1 ? "s" : ""} — comparable transactions`
        : urlTeamParam
          ? `${filteredDeals.length} deal${filteredDeals.length !== 1 ? "s" : ""} · Filtered by ${urlTeamParam} team`
          : activeTeam && activeTeam !== "all"
            ? `${filteredDeals.length} deal${filteredDeals.length !== 1 ? "s" : ""} — ${activeTeam}`
            : `${deals.length} deal${deals.length !== 1 ? "s" : ""} in the CRM`}
      actions={!isCompsMode ? (
        <>
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
                queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
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
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-deal">
            <Plus className="w-4 h-4 mr-2" />
            New Deal
          </Button>
        </>
      ) : undefined}
      className="h-[calc(100vh-3rem)] flex flex-col"
      testId={isCompsMode ? "comps-page" : "deals-page"}
    >

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
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>

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
          <DealKanban deals={filteredDeals} propertyMap={propertyMap} />
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
                  return {
                    id: deal.id,
                    title: propName || deal.name,
                    subtitle: propName ? deal.name : undefined,
                    href: `/deals/${deal.id}`,
                    status: deal.status || undefined,
                    statusColor: DEAL_STATUS_COLORS[deal.status || ""] || "bg-muted-foreground",
                    fields: [
                      { label: "Type", value: deal.dealType, badge: true },
                      { label: "Team", value: teams },
                      { label: "Agent", value: agents },
                      { label: "Asset Class", value: deal.assetClass },
                      { label: "Fee", value: deal.fee ? `\u00A3${Number(deal.fee).toLocaleString()}` : null },
                      { label: "Rent PA", value: deal.rentPa ? `\u00A3${Number(deal.rentPa).toLocaleString()}` : null },
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
            <ScrollableTable minWidth={2200}>
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
                    <TableHead className="min-w-[200px]">Property</TableHead>
                    {visibleColumns.landlord && <TableHead className="min-w-[120px]">Landlord</TableHead>}
                    {visibleColumns.type && (
                      <TableHead className="min-w-[120px]">
                        <ColumnFilterPopover
                          label="Deal Type"
                          options={typeValues}
                          activeFilters={columnFilters["type"] || []}
                          onToggleFilter={(val) => toggleFilter("type", val)}
                        />
                      </TableHead>
                    )}
                    {visibleColumns.status && (
                      <TableHead className="min-w-[120px]">
                        <ColumnFilterPopover
                          label="Status"
                          options={statusValues}
                          activeFilters={columnFilters["status"] || []}
                          onToggleFilter={(val) => toggleFilter("status", val)}
                        />
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
                    {visibleColumns.agent && <TableHead className="min-w-[80px]">BGP Contact</TableHead>}
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
                    {visibleColumns.clientContact && <TableHead className="min-w-[120px]">Client Contact</TableHead>}
                    {visibleColumns.tenant && <TableHead className="min-w-[120px]">Tenant</TableHead>}
                    {visibleColumns.vendor && <TableHead className="min-w-[120px]">Vendor</TableHead>}
                    {visibleColumns.purchaser && <TableHead className="min-w-[120px]">Purchaser</TableHead>}
                    {visibleColumns.vendorAgent && <TableHead className="min-w-[120px]">Vendor Agent</TableHead>}
                    {visibleColumns.acquisitionAgent && <TableHead className="min-w-[120px]">Acquisition Agent</TableHead>}
                    {visibleColumns.purchaserAgent && <TableHead className="min-w-[120px]">Purchaser Agent</TableHead>}
                    {visibleColumns.leasingAgent && <TableHead className="min-w-[120px]">Leasing Agent</TableHead>}
                    {visibleColumns.timeline && <TableHead className="min-w-[160px]">Timeline</TableHead>}
                    {visibleColumns.pricing && <TableHead className="min-w-[100px] text-right">Pricing</TableHead>}
                    {visibleColumns.yield && <TableHead className="min-w-[80px] text-right">Yield %</TableHead>}
                    {visibleColumns.fee && <TableHead className="min-w-[80px] text-right">Fee</TableHead>}
                    {visibleColumns.wipBadge && mode === "wip" && <TableHead className="min-w-[100px] text-right">WIP Match</TableHead>}
                    {visibleColumns.feeAlloc && <TableHead className="min-w-[120px]">Fee Split</TableHead>}
                    {visibleColumns.feeAgreement && <TableHead className="min-w-[100px]">Fee Agreement</TableHead>}
                    {visibleColumns.amlCheck && <TableHead className="min-w-[80px]">AML Check</TableHead>}
                    {visibleColumns.invoicingEntity && <TableHead className="min-w-[150px]">Invoicing Entity</TableHead>}
                    {visibleColumns.area && <TableHead className="min-w-[100px] text-right">Total Area sqft</TableHead>}
                    {visibleColumns.basementArea && <TableHead className="min-w-[100px] text-right">Basement Area</TableHead>}
                    {visibleColumns.gfArea && <TableHead className="min-w-[80px] text-right">GF Area</TableHead>}
                    {visibleColumns.ffArea && <TableHead className="min-w-[80px] text-right">FF Area</TableHead>}
                    {visibleColumns.itzaArea && <TableHead className="min-w-[80px] text-right">ITZA Area</TableHead>}
                    {visibleColumns.pricePsf && <TableHead className="min-w-[80px] text-right">Price PSF</TableHead>}
                    {visibleColumns.priceItza && <TableHead className="min-w-[80px] text-right">Price ITZA</TableHead>}
                    {visibleColumns.rentPa && <TableHead className="min-w-[100px] text-right">Rent PA</TableHead>}
                    {visibleColumns.capitalContribution && <TableHead className="min-w-[100px] text-right">Capital Contribution</TableHead>}
                    {visibleColumns.rentFree && <TableHead className="min-w-[80px] text-right">Rent Free</TableHead>}
                    {visibleColumns.leaseLength && <TableHead className="min-w-[80px] text-right">Lease Length</TableHead>}
                    {visibleColumns.breakOption && <TableHead className="min-w-[80px] text-right">Break Option</TableHead>}
                    {visibleColumns.completionDate && <TableHead className="min-w-[120px]">Completion Date</TableHead>}
                    {visibleColumns.rentAnalysis && <TableHead className="min-w-[100px] text-right">Rent Analysis</TableHead>}
                    {visibleColumns.comments && <TableHead className="min-w-[200px]">Comments</TableHead>}
                    {visibleColumns.sharepoint && <TableHead className="min-w-[140px]">SharePoint Files</TableHead>}
                    <TableHead className="w-[40px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDeals.map((deal) => (
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
                      <TableCell className="px-1.5 py-1 font-medium text-sm max-w-[200px]">
                        <div className="flex items-center gap-2">
                          <Link href={`/deals/${deal.id}`} data-testid={`link-deal-${deal.id}`}>
                            <Handshake className="w-3.5 h-3.5 text-muted-foreground shrink-0 cursor-pointer hover:text-primary" />
                          </Link>
                          <InlineLinkSelect
                            value={deal.propertyId}
                            options={properties.map(p => ({ id: p.id, name: p.name }))}
                            href={deal.propertyId ? `/properties/${deal.propertyId}` : undefined}
                            onSave={(v) => handleInlineSave(deal.id, "propertyId", v || null)}
                            placeholder="Link property"
                          />
                        </div>
                      </TableCell>
                      {visibleColumns.landlord && (
                        <TableCell className="px-1.5 py-1 max-w-[120px]">
                          <InlineLinkSelect
                            value={deal.landlordId}
                            options={companies.filter(c => c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client" || c.id === deal.landlordId).map(c => ({ id: c.id, name: c.name }))}
                            href={deal.landlordId ? `/companies/${deal.landlordId}` : undefined}
                            onSave={(v) => handleInlineSave(deal.id, "landlordId", v || null)}
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
                            options={CRM_OPTIONS.dealStatus}
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
                            options={CRM_OPTIONS.dealTeam.map(t => ({ label: t, value: t }))}
                            colorMap={DEAL_TEAM_COLORS}
                            placeholder="Set team"
                            onSave={(v) => handleInlineSave(deal.id, "team", v.length > 0 ? v : null)}
                            testId={`inline-deal-team-${deal.id}`}
                          />
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
                            placeholder="Link contact"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.tenant && (
                        <TableCell className="px-1.5 py-1 max-w-[120px]">
                          <InlineLinkSelect
                            value={deal.tenantId}
                            options={companies.filter(c => c.companyType?.startsWith("Tenant") || c.companyType === "Purchaser" || c.id === deal.tenantId).map(c => ({ id: c.id, name: c.name }))}
                            href={deal.tenantId ? `/companies/${deal.tenantId}` : undefined}
                            onSave={(v) => handleInlineSave(deal.id, "tenantId", v || null)}
                            placeholder="Link tenant"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.vendor && (
                        <TableCell className="px-1.5 py-1 max-w-[120px]">
                          <InlineLinkSelect
                            value={deal.vendorId}
                            options={companies.filter(c => c.companyType === "Vendor" || c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client" || c.id === deal.vendorId).map(c => ({ id: c.id, name: c.name }))}
                            href={deal.vendorId ? `/companies/${deal.vendorId}` : undefined}
                            onSave={(v) => handleInlineSave(deal.id, "vendorId", v || null)}
                            placeholder="Link vendor"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.purchaser && (
                        <TableCell className="px-1.5 py-1 max-w-[120px]">
                          <InlineLinkSelect
                            value={deal.purchaserId}
                            options={companies.filter(c => c.companyType?.startsWith("Tenant") || c.companyType === "Purchaser" || c.companyType === "Investor" || c.id === deal.purchaserId).map(c => ({ id: c.id, name: c.name }))}
                            href={deal.purchaserId ? `/companies/${deal.purchaserId}` : undefined}
                            onSave={(v) => handleInlineSave(deal.id, "purchaserId", v || null)}
                            placeholder="Link purchaser"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.vendorAgent && (
                        <TableCell className="px-1.5 py-1 max-w-[120px]">
                          <InlineLinkSelect
                            value={deal.vendorAgentId}
                            options={agentCompanies.map(c => ({ id: c.id, name: c.name }))}
                            href={deal.vendorAgentId ? `/companies/${deal.vendorAgentId}` : undefined}
                            onSave={(v) => handleInlineSave(deal.id, "vendorAgentId", v || null)}
                            placeholder="Link agent"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.acquisitionAgent && (
                        <TableCell className="px-1.5 py-1 max-w-[120px]">
                          <InlineLinkSelect
                            value={deal.acquisitionAgentId}
                            options={agentCompanies.map(c => ({ id: c.id, name: c.name }))}
                            href={deal.acquisitionAgentId ? `/companies/${deal.acquisitionAgentId}` : undefined}
                            onSave={(v) => handleInlineSave(deal.id, "acquisitionAgentId", v || null)}
                            placeholder="Link agent"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.purchaserAgent && (
                        <TableCell className="px-1.5 py-1 max-w-[120px]">
                          <InlineLinkSelect
                            value={deal.purchaserAgentId}
                            options={agentCompanies.map(c => ({ id: c.id, name: c.name }))}
                            href={deal.purchaserAgentId ? `/companies/${deal.purchaserAgentId}` : undefined}
                            onSave={(v) => handleInlineSave(deal.id, "purchaserAgentId", v || null)}
                            placeholder="Link agent"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.leasingAgent && (
                        <TableCell className="px-1.5 py-1 max-w-[120px]">
                          <InlineLinkSelect
                            value={deal.leasingAgentId}
                            options={agentCompanies.map(c => ({ id: c.id, name: c.name }))}
                            href={deal.leasingAgentId ? `/companies/${deal.leasingAgentId}` : undefined}
                            onSave={(v) => handleInlineSave(deal.id, "leasingAgentId", v || null)}
                            placeholder="Link agent"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.timeline && (
                        <TableCell className="px-1.5 py-1">
                          {deal.timelineStart || deal.timelineEnd ? (
                            <span>{deal.timelineStart ? formatDate(deal.timelineStart) : "—"} — {deal.timelineEnd ? formatDate(deal.timelineEnd) : "—"}</span>
                          ) : "—"}
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
                      {visibleColumns.fee && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.fee}
                            onSave={(v) => handleInlineSave(deal.id, "fee", v)}
                            prefix="£"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.wipBadge && mode === "wip" && (
                        <TableCell className="px-1.5 py-1 text-right">
                          {(() => {
                            const badge = wipBadges?.[deal.id];
                            if (!badge) return null;
                            const topEntry = badge.entries[0];
                            const tipText = topEntry
                              ? `${topEntry.project}${topEntry.stage ? ` — ${topEntry.stage}` : ""}${badge.count > 1 ? ` (+${badge.count - 1} more)` : ""}`
                              : `${badge.count} WIP entr${badge.count === 1 ? "y" : "ies"}`;
                            return (
                              <Badge
                                className="text-[10px] px-1.5 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white cursor-default"
                                title={tipText}
                              >
                                £{(badge.amtWip / 1000).toFixed(0)}k
                              </Badge>
                            );
                          })()}
                        </TableCell>
                      )}
                      {visibleColumns.feeAlloc && (
                        <TableCell className="px-1.5 py-1">
                          <FeeAllocCell dealId={deal.id} dealFee={deal.fee} allAllocations={allFeeAllocations} colorMap={userColorMap2} />
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
                      {visibleColumns.amlCheck && (
                        <TableCell className="px-1.5 py-1">
                          <InlineLabelSelect
                            value={deal.amlCheckCompleted}
                            options={CRM_OPTIONS.dealAmlCheck}
                            colorMap={DEAL_AML_COLORS}
                            onSave={(v) => handleInlineSave(deal.id, "amlCheckCompleted", v || null)}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.invoicingEntity && (
                        <TableCell className="px-1.5 py-1">
                          <InlineLinkSelect
                            value={deal.invoicingEntityId}
                            options={companies.map(c => ({ id: c.id, name: c.name }))}
                            href={deal.invoicingEntityId ? `/companies/${deal.invoicingEntityId}` : undefined}
                            onSave={(v) => handleInlineSave(deal.id, "invoicingEntityId", v || null)}
                            placeholder="Link entity"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.area && (
                        <TableCell className="px-1.5 py-1 text-right text-muted-foreground">
                          {((deal.basementAreaSqft || 0) + (deal.gfAreaSqft || 0) + (deal.ffAreaSqft || 0)) > 0
                            ? ((deal.basementAreaSqft || 0) + (deal.gfAreaSqft || 0) + (deal.ffAreaSqft || 0)).toLocaleString() + " sqft"
                            : "—"}
                        </TableCell>
                      )}
                      {visibleColumns.basementArea && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.basementAreaSqft}
                            onSave={(v) => handleInlineSave(deal.id, "basementAreaSqft", v)}
                            suffix=" sqft"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.gfArea && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.gfAreaSqft}
                            onSave={(v) => handleInlineSave(deal.id, "gfAreaSqft", v)}
                            suffix=" sqft"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.ffArea && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.ffAreaSqft}
                            onSave={(v) => handleInlineSave(deal.id, "ffAreaSqft", v)}
                            suffix=" sqft"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.itzaArea && (
                        <TableCell className="px-1.5 py-1">
                          <InlineNumber
                            value={deal.itzaAreaSqft}
                            onSave={(v) => handleInlineSave(deal.id, "itzaAreaSqft", v)}
                            suffix=" sqft"
                          />
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
                      {visibleColumns.completionDate && (
                        <TableCell className="px-1.5 py-1">
                          {deal.completionDate ? formatDate(deal.completionDate) : "—"}
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
                      {visibleColumns.comments && (
                        <TableCell className="px-1.5 py-1 max-w-[200px]">
                          <span className="truncate block">{deal.comments || "—"}</span>
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
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-md border bg-card px-4 py-3 shadow-lg"
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
              {["Development", "London Leasing", "National Leasing", "Investment", "Tenant Rep", "Lease Advisory", "Office / Corporate", "Landsec"].map(team => (
                <DropdownMenuItem
                  key={team}
                  onClick={() => bulkUpdateMutation.mutate({ ids: Array.from(selectedIds), field: "team", value: [team] })}
                  data-testid={`bulk-assign-team-option-${team}`}
                >
                  <div className={`w-2 h-2 rounded-full ${DEAL_TEAM_COLORS[team] || "bg-zinc-500"} mr-2`} />
                  {team}
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
              Approval Required
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>{listApprovalGateMsg || "This status change requires senior approval."}</p>
              <p className="text-xs text-muted-foreground mt-2">
                Please ask a senior team member (Woody, Charlotte, Rupert, or Jack) to make this change.
              </p>
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
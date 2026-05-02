import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import PathwayIntelStrip from "@/components/pathway-intel-strip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
  Users,
  Building2,
  X,
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Clock,
  ExternalLink,
  Link2,
  Image as ImageIcon,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  History,
  Mail,
  Calendar as CalendarIcon,
  TrendingUp,
  FileText,
  MessageSquare,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState, useMemo, useEffect } from "react";
import { trackRecentItem } from "@/hooks/use-recent-items";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, invalidateDealCaches } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import type { CrmDeal, CrmProperty, CrmCompany, CrmContact } from "@shared/schema";
import { buildUserColorMap } from "@/lib/agent-colors";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { BrandProfilePanel } from "@/components/brand-profile-panel";
import { DEAL_STATUS_LABELS, legacyToCode } from "@shared/deal-status";
import {
  DEAL_STATUS_COLORS,
  DEAL_TYPE_COLORS,
  DEAL_TEAM_COLORS,
  DEAL_ASSET_CLASS_COLORS,
  DEAL_FEE_AGREEMENT_COLORS,
  DEAL_AML_COLORS,
  formatCurrency,
  formatNumber,
  formatDate,
  DealFormDialog,
  FeeAllocationCard,
  XeroInvoiceSection,
  DealKYCPanel,
  DealTimeline,
  DealAuditLog,
  DealRelatedEmails,
  DealRelatedMeetings,
} from "@/pages/deals";
// DealAmlStatusCard removed — KYC pack now consolidated on Compliance Board

// Collapsible card pattern reused across the deal page for heavy panels.
function CollapsibleCard({
  open,
  onToggle,
  icon: Icon,
  title,
  children,
  testId,
}: {
  open: boolean;
  onToggle: () => void;
  icon: any;
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Card>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors text-left"
        data-testid={testId}
      >
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">{title}</span>
        </div>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </Card>
  );
}

// Right-sidebar collapsible row (different styling — borderless, full-width).
function SidebarSection({
  open,
  onToggle,
  icon: Icon,
  title,
  children,
  testId,
}: {
  open: boolean;
  onToggle: () => void;
  icon: any;
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="border-b">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
        data-testid={testId}
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

export function DealDetail({ id, isComps = false }: { id: string; isComps?: boolean }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Heavy panels — collapsed by default to keep the page scannable.
  const [mainSections, setMainSections] = useState<Record<string, boolean>>({
    pathway: false,
    kyc: false,
    brands: false,
    timeline: false,
    audit: false,
    emails: false,
    meetings: false,
  });
  const toggleMain = (key: string) => setMainSections(prev => ({ ...prev, [key]: !prev[key] }));

  // Right sidebar — linked records, files, contacts.
  const [sidebarSections, setSidebarSections] = useState<Record<string, boolean>>({
    files: true,
    property: true,
    contacts: true,
    comments: true,
  });
  const toggleSidebar = (key: string) => setSidebarSections(prev => ({ ...prev, [key]: !prev[key] }));

  const { data: deal, isLoading } = useQuery<CrmDeal>({
    queryKey: ["/api/crm/deals", id],
  });

  const { data: properties = [] } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
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

  const { data: users = [] } = useQuery<{ id: number; name: string; email: string }[]>({
    queryKey: ["/api/users"],
  });
  const userColorMap = useMemo(() => buildUserColorMap(users as any), [users]);

  useEffect(() => {
    if (deal) {
      trackRecentItem({ id: deal.id, type: "deal", name: (deal as any).propertyName || deal.name || "Untitled Deal", subtitle: deal.status || undefined, team: Array.isArray(deal.team) ? deal.team[0] : undefined });
    }
  }, [deal?.id, deal?.name, (deal as any)?.propertyName]);

  useEffect(() => {
    if (deal && window.location.search.includes("tab=invoice")) {
      setTimeout(() => {
        const el = document.querySelector('[data-testid="xero-invoice-section"]');
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    }
  }, [deal?.id]);

  const linkedProperty = deal?.propertyId ? properties.find((p) => p.id === deal.propertyId) : null;
  const linkedLandlord = deal?.landlordId ? companies.find((c) => c.id === deal.landlordId) : null;
  const linkedTenant = deal?.tenantId ? companies.find((c) => c.id === deal.tenantId) : null;
  const linkedInvoicingEntity = deal?.invoicingEntityId ? companies.find((c) => c.id === deal.invoicingEntityId) : null;

  const linkedContacts = useMemo(() => {
    if (!deal) return [];
    const ids = [deal.clientContactId, deal.vendorAgentId, deal.acquisitionAgentId, deal.purchaserAgentId, deal.leasingAgentId].filter(Boolean);
    return contacts.filter((c) => ids.includes(c.id));
  }, [deal, contacts]);

  const updateAgentsMutation = useMutation({
    mutationFn: async (agents: string[]) => {
      await apiRequest("PUT", `/api/crm/deals/${id}`, { internalAgent: agents });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", id] });
      invalidateDealCaches();
    },
  });

  const [sharepointDialogOpen, setSharepointDialogOpen] = useState(false);
  const [sharepointUrlInput, setSharepointUrlInput] = useState("");
  const [feeEditing, setFeeEditing] = useState(false);
  const [feeInput, setFeeInput] = useState("");

  const updateSharepointMutation = useMutation({
    mutationFn: async (url: string | null) => {
      await apiRequest("PUT", `/api/crm/deals/${id}`, { sharepointLink: url });
    },
    onSuccess: () => {
      toast({ title: "SharePoint link updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", id] });
      invalidateDealCaches();
      setSharepointDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/crm/deals/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Deal deleted" });
      invalidateDealCaches();
      navigate(isComps ? "/comps" : "/deals");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleFeeSave = async () => {
    const val = parseFloat(feeInput.replace(/[^0-9.]/g, ""));
    if (!isNaN(val)) {
      await apiRequest("PUT", `/api/crm/deals/${id}`, { fee: val });
      invalidateDealCaches(id);
    }
    setFeeEditing(false);
  };

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="p-4 sm:p-6 text-center space-y-4">
        <h2 className="text-lg font-semibold">Deal not found</h2>
        <Link href={isComps ? "/comps" : "/deals"}>
          <Button variant="outline" data-testid="button-back-deals-notfound">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {isComps ? "Back to Comps" : "Back to WIP"}
          </Button>
        </Link>
      </div>
    );
  }

  const numericFields: { label: string; value: number | null | undefined; format?: "currency" | "number" | "percent" }[] = [
    { label: "Pricing", value: deal.pricing, format: "currency" },
    { label: "Rent PA", value: deal.rentPa, format: "currency" },
    { label: "Yield", value: deal.yieldPercent, format: "percent" },
    { label: "Total Area (sqft)", value: deal.totalAreaSqft, format: "number" },
    { label: "GF Area (sqft)", value: deal.gfAreaSqft, format: "number" },
    { label: "FF Area (sqft)", value: deal.ffAreaSqft, format: "number" },
    { label: "Basement (sqft)", value: deal.basementAreaSqft, format: "number" },
    { label: "ITZA (sqft)", value: deal.itzaAreaSqft, format: "number" },
    { label: "Price PSF", value: deal.pricePsf, format: "currency" },
    { label: "Price ITZA", value: deal.priceItza, format: "currency" },
    { label: "Capital Contribution", value: deal.capitalContribution, format: "currency" },
    { label: "Rent Free (months)", value: deal.rentFree, format: "number" },
    { label: "Lease Length (years)", value: deal.leaseLength, format: "number" },
    { label: "Break Option (years)", value: deal.breakOption, format: "number" },
    { label: "Rent Analysis", value: deal.rentAnalysis, format: "currency" },
  ];

  const linkedLandlordName = deal.landlordId ? companies.find(c => c.id === deal.landlordId)?.name : null;
  const linkedTenantName = deal.tenantId ? companies.find(c => c.id === deal.tenantId)?.name : null;
  const linkedVendorName = deal.vendorId ? companies.find(c => c.id === deal.vendorId)?.name : null;
  const linkedPurchaserName = deal.purchaserId ? companies.find(c => c.id === deal.purchaserId)?.name : null;
  const linkedBillingName = deal.invoicingEntityId ? companies.find(c => c.id === deal.invoicingEntityId)?.name : null;

  const textFields: { label: string; value: string | null | undefined; colorMap?: Record<string, string>; href?: string }[] = [
    { label: "Deal Type", value: deal.dealType, colorMap: DEAL_TYPE_COLORS },
    { label: "Status", value: deal.status, colorMap: DEAL_STATUS_COLORS },
    { label: "Team", value: Array.isArray(deal.team) ? deal.team.join(", ") : deal.team, colorMap: DEAL_TEAM_COLORS },
    { label: "Asset Class", value: deal.assetClass, colorMap: DEAL_ASSET_CLASS_COLORS },
    { label: "Landlord", value: linkedLandlordName, href: deal.landlordId ? `/companies/${deal.landlordId}` : undefined },
    { label: "Tenant", value: linkedTenantName, href: deal.tenantId ? `/companies/${deal.tenantId}` : undefined },
    { label: "Vendor", value: linkedVendorName, href: deal.vendorId ? `/companies/${deal.vendorId}` : undefined },
    { label: "Purchaser", value: linkedPurchaserName, href: deal.purchaserId ? `/companies/${deal.purchaserId}` : undefined },
    { label: "Billing Entity", value: linkedBillingName, href: deal.invoicingEntityId ? `/companies/${deal.invoicingEntityId}` : undefined },
    { label: "Tenure", value: deal.tenureText },
    { label: "Fee Agreement", value: deal.feeAgreement, colorMap: DEAL_FEE_AGREEMENT_COLORS },
    { label: "AML Check", value: deal.amlCheckCompleted, colorMap: DEAL_AML_COLORS },
    { label: "Instructed", value: deal.instructedAt ? formatDate(deal.instructedAt) : null },
    { label: "Target Date", value: deal.targetDate ? formatDate(deal.targetDate) : null },
    { label: "Exchanged", value: deal.exchangedAt ? formatDate(deal.exchangedAt) : null },
    { label: "Completed", value: deal.completedAt ? formatDate(deal.completedAt) : null },
    { label: "Invoiced", value: deal.invoicedAt ? formatDate(deal.invoicedAt) : null },
    { label: "Last Interaction", value: deal.lastInteraction },
  ];

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col" data-testid={`deal-detail-${id}`}>
      <div className="px-4 sm:px-6 pt-4 sm:pt-5">
        <Breadcrumbs
          items={[
            { label: isComps ? "Comps" : "Deals", href: isComps ? "/comps" : "/deals" },
            { label: linkedProperty?.name || deal.name },
          ]}
        />
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Link href={isComps ? "/comps" : "/deals"}>
          <Button variant="ghost" size="icon" data-testid="button-back-deals">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold truncate" data-testid="text-deal-name">{linkedProperty?.name || deal.name}</h1>
            {deal.status && (
              <Badge className={`text-[10px] text-white ${DEAL_STATUS_COLORS[deal.status] || "bg-zinc-500"}`} data-testid="badge-deal-status">{(() => { const code = legacyToCode(deal.status); return code ? DEAL_STATUS_LABELS[code] : deal.status; })()}</Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/image-studio?property=${encodeURIComponent(linkedProperty?.name || (deal as any).propertyName || deal.name || "")}&address=${encodeURIComponent(linkedProperty?.address ? (typeof linkedProperty.address === 'object' && linkedProperty.address !== null ? ((linkedProperty.address as any).formatted || (linkedProperty.address as any).line1 || linkedProperty.name) : String(linkedProperty.address || linkedProperty.name)) : ((deal as any).propertyName || deal.name || ""))}&propertyId=${encodeURIComponent(deal.propertyId || "")}`}>
            <Button variant="outline" size="sm" data-testid="button-deal-image-studio">
              <ImageIcon className="w-4 h-4 mr-2" />
              Image Studio
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} data-testid="button-edit-deal">
            <Pencil className="w-4 h-4 mr-2" />
            Edit
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-1.5">
            {textFields.filter((f) => f.value).map((field) => (
              <div key={field.label} className="flex flex-col py-1">
                <p className="text-[10px] text-muted-foreground leading-tight">{field.label}</p>
                {field.colorMap && field.value && field.colorMap[field.value] ? (
                  <Badge className={`text-[9px] text-white w-fit mt-0.5 ${field.colorMap[field.value]}`} data-testid={`text-deal-${field.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    {field.value}
                  </Badge>
                ) : field.href ? (
                  <Link href={field.href}>
                    <p className="text-xs font-medium text-primary hover:underline cursor-pointer truncate" data-testid={`text-deal-${field.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      {field.value}
                    </p>
                  </Link>
                ) : (
                  <p className="text-xs font-medium truncate" data-testid={`text-deal-${field.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    {field.value}
                  </p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 space-y-1.5">
          <p className="text-[10px] text-muted-foreground font-medium">BGP Contacts</p>
          <div className="flex items-center gap-1 flex-wrap">
            {(deal.internalAgent || []).map((name: string) => {
              const bg = userColorMap[name] || "bg-zinc-500";
              return (
                <span key={name} className="inline-flex items-center gap-0.5">
                  <Badge className={`text-[10px] px-1.5 py-0 text-white ${bg}`} data-testid={`badge-deal-agent-${name}`}>
                    {name}
                  </Badge>
                  <button
                    onClick={() => updateAgentsMutation.mutate((deal.internalAgent || []).filter((a: string) => a !== name))}
                    className="text-muted-foreground hover:text-red-500 transition-colors"
                    data-testid={`button-remove-agent-${name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 rounded-full" data-testid="button-add-deal-agent">
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 max-h-[300px] overflow-y-auto">
                {users.filter(u => !(deal.internalAgent || []).includes(u.name)).map(u => (
                  <DropdownMenuItem
                    key={u.id}
                    onClick={() => updateAgentsMutation.mutate([...(deal.internalAgent || []), u.name])}
                    data-testid={`option-add-agent-${u.name}`}
                  >
                    <div className={`w-2 h-2 rounded-full ${userColorMap[u.name] || "bg-zinc-500"} mr-2`} />
                    {u.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-4 gap-y-1.5">
            {numericFields.filter((f) => f.value != null).map((field) => (
              <div key={field.label} className="flex flex-col py-1">
                <p className="text-[10px] text-muted-foreground leading-tight">{field.label}</p>
                <p className="text-xs font-mono font-medium" data-testid={`text-deal-${field.label.toLowerCase().replace(/[\s()\/]+/g, "-")}`}>
                  {field.format === "currency"
                    ? formatCurrency(field.value)
                    : field.format === "percent"
                    ? `${field.value}%`
                    : formatNumber(field.value)}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] text-muted-foreground">Total Fee</p>
            {feeEditing ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">£</span>
                <Input
                  autoFocus
                  type="number"
                  min="0"
                  className="h-7 w-32 text-xs font-mono"
                  value={feeInput}
                  onChange={(e) => setFeeInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleFeeSave(); if (e.key === "Escape") setFeeEditing(false); }}
                />
                <Button size="sm" className="h-7 px-2 text-xs" onClick={handleFeeSave}>Save</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setFeeEditing(false)}>Cancel</Button>
              </div>
            ) : (
              <button
                className="text-sm font-mono font-semibold hover:underline cursor-pointer"
                onClick={() => { setFeeInput(deal.fee != null ? String(deal.fee) : ""); setFeeEditing(true); }}
                data-testid="button-edit-fee"
              >
                {deal.fee != null ? formatCurrency(deal.fee) : <span className="text-muted-foreground text-xs">Set fee…</span>}
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      <FeeAllocationCard
        dealId={deal.id}
        dealFee={deal.fee}
        users={users.map(u => ({ id: String(u.id), name: u.name }))}
        colorMap={userColorMap}
      />

      <XeroInvoiceSection dealId={deal.id} deal={deal} companies={companies} />

      <Dialog open={sharepointDialogOpen} onOpenChange={setSharepointDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link SharePoint Folder</DialogTitle>
            <DialogDescription>
              Paste the SharePoint URL for this deal's folder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="https://brucegillinghampollard.sharepoint.com/..."
              value={sharepointUrlInput}
              onChange={(e) => setSharepointUrlInput(e.target.value)}
              data-testid="input-sharepoint-url"
            />
          </div>
          <DialogFooter className="gap-2">
            {deal.sharepointLink && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive mr-auto"
                onClick={() => updateSharepointMutation.mutate(null)}
                disabled={updateSharepointMutation.isPending}
                data-testid="button-remove-sharepoint-link"
              >
                Remove Link
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSharepointDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => updateSharepointMutation.mutate(sharepointUrlInput.trim() || null)}
              disabled={updateSharepointMutation.isPending || !sharepointUrlInput.trim()}
              data-testid="button-save-sharepoint-link"
            >
              {updateSharepointMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CollapsibleCard open={mainSections.pathway} onToggle={() => toggleMain("pathway")} icon={TrendingUp} title="Pathway Intel" testId="toggle-deal-pathway">
        <PathwayIntelStrip
          propertyId={(deal as any).propertyId || undefined}
          address={(deal as any).propertyAddress || (deal as any).address || deal.name}
          postcode={(deal as any).postcode}
        />
      </CollapsibleCard>

      <CollapsibleCard open={mainSections.kyc} onToggle={() => toggleMain("kyc")} icon={ShieldCheck} title="KYC" testId="toggle-deal-kyc">
        <DealKYCPanel deal={deal} companies={companies} />
      </CollapsibleCard>

      {[
        { company: linkedTenant, role: "Tenant" },
        { company: linkedLandlord, role: "Landlord" },
      ]
        .filter(({ company }) => !!company)
        .filter(({ company }, i, arr) => arr.findIndex(a => a.company!.id === company!.id) === i).length > 0 && (
        <CollapsibleCard open={mainSections.brands} onToggle={() => toggleMain("brands")} icon={Building2} title="Brand Profiles" testId="toggle-deal-brands">
          <div className="space-y-3">
            {[
              { company: linkedTenant, role: "Tenant" },
              { company: linkedLandlord, role: "Landlord" },
            ]
              .filter(({ company }) => !!company)
              .filter(({ company }, i, arr) => arr.findIndex(a => a.company!.id === company!.id) === i)
              .map(({ company, role }) => (
                <div key={company!.id} data-testid={`deal-brand-${role.toLowerCase()}`}>
                  <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1 flex items-center gap-1.5">
                    <Building2 className="w-3 h-3" /> {role}: {company!.name}
                  </p>
                  <BrandProfilePanel companyId={company!.id} />
                </div>
              ))}
          </div>
        </CollapsibleCard>
      )}

      <CollapsibleCard open={mainSections.timeline} onToggle={() => toggleMain("timeline")} icon={CalendarIcon} title="Timeline" testId="toggle-deal-timeline">
        <DealTimeline dealId={id} />
      </CollapsibleCard>

      <CollapsibleCard open={mainSections.audit} onToggle={() => toggleMain("audit")} icon={History} title="Audit Log" testId="toggle-deal-audit">
        <DealAuditLog dealId={id} />
      </CollapsibleCard>

      <CollapsibleCard open={mainSections.emails} onToggle={() => toggleMain("emails")} icon={Mail} title="Related Emails" testId="toggle-deal-emails">
        <DealRelatedEmails dealId={id} />
      </CollapsibleCard>

      <CollapsibleCard open={mainSections.meetings} onToggle={() => toggleMain("meetings")} icon={CalendarIcon} title="Related Meetings" testId="toggle-deal-meetings">
        <DealRelatedMeetings dealId={id} />
      </CollapsibleCard>

      {deal.updatedAt && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Last updated: {new Date(deal.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      )}

      <DealFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        deal={deal}
        properties={properties}
        companies={companies}
        users={users}
      />

      <div className="flex justify-start mt-6 pt-3 border-t">
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteOpen(true)} data-testid="button-delete-deal">
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Deal
        </Button>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Deal</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deal.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
          </div>
        </div>

        {/* Right sidebar — linked records, files, comments */}
        <div className="w-[300px] border-l bg-background flex flex-col shrink-0 h-full overflow-hidden hidden md:flex">
          <ScrollArea className="flex-1">
            <div className="px-4 pt-4 pb-3 border-b">
              <h3 className="text-sm font-bold leading-tight truncate" data-testid="sidebar-deal-name">{linkedProperty?.name || deal.name}</h3>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {deal.status && (
                  <Badge className={`text-[10px] text-white ${DEAL_STATUS_COLORS[deal.status] || "bg-zinc-500"}`}>
                    {(() => { const code = legacyToCode(deal.status); return code ? DEAL_STATUS_LABELS[code] : deal.status; })()}
                  </Badge>
                )}
                {deal.dealType && (
                  <Badge variant="outline" className="text-[10px]">{deal.dealType}</Badge>
                )}
                {deal.fee != null && (
                  <Badge variant="outline" className="text-[10px] font-mono">{formatCurrency(deal.fee)}</Badge>
                )}
              </div>
            </div>

            <SidebarSection open={sidebarSections.files} onToggle={() => toggleSidebar("files")} icon={FileText} title="Files" testId="toggle-sidebar-files">
              <div className="space-y-2" data-testid="deal-files-section">
                {deal.sharepointLink ? (
                  <div className="flex items-center gap-2">
                    <a
                      href={deal.sharepointLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                      data-testid="link-deal-sharepoint-folder"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open in SharePoint
                    </a>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-muted-foreground"
                      onClick={() => {
                        setSharepointUrlInput(deal.sharepointLink || "");
                        setSharepointDialogOpen(true);
                      }}
                      data-testid="button-edit-sharepoint-link"
                    >
                      <Pencil className="w-3 h-3" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 w-full justify-start"
                    onClick={() => {
                      setSharepointUrlInput("");
                      setSharepointDialogOpen(true);
                    }}
                    data-testid="button-link-sharepoint-folder"
                  >
                    <Link2 className="w-3 h-3 mr-1.5" />
                    Link SharePoint Folder
                  </Button>
                )}
                {deal.propertyId && (
                  <Link href={`/properties/${deal.propertyId}`}>
                    <span className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 cursor-pointer" data-testid="link-deal-sharepoint">
                      <Building2 className="w-3 h-3" />
                      Property folder
                    </span>
                  </Link>
                )}
              </div>
            </SidebarSection>

            {linkedProperty && (
              <SidebarSection open={sidebarSections.property} onToggle={() => toggleSidebar("property")} icon={Building2} title="Linked Property" testId="toggle-sidebar-property">
                <Link href={`/properties/${linkedProperty.id}`}>
                  <div className="p-2 rounded-md border hover-elevate cursor-pointer" data-testid="linked-property-panel">
                    <p className="text-xs font-medium">{linkedProperty.name}</p>
                    {linkedProperty.status && (
                      <Badge variant="outline" className="mt-1 text-[9px]">{linkedProperty.status}</Badge>
                    )}
                  </div>
                </Link>
              </SidebarSection>
            )}

            {linkedContacts.length > 0 && (
              <SidebarSection open={sidebarSections.contacts} onToggle={() => toggleSidebar("contacts")} icon={Users} title={`Linked Contacts (${linkedContacts.length})`} testId="toggle-sidebar-contacts">
                <div className="space-y-1.5" data-testid="linked-contacts-panel">
                  {linkedContacts.map((contact) => (
                    <Link key={contact.id} href={`/contacts/${contact.id}`}>
                      <div className="p-2 rounded-md border hover-elevate cursor-pointer">
                        <p className="text-xs font-medium">{contact.name}</p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {contact.role && (
                            <span className="text-[9px] text-muted-foreground">{contact.role}</span>
                          )}
                          {contact.companyName && (
                            <Badge variant="outline" className="text-[9px]">{contact.companyName}</Badge>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </SidebarSection>
            )}

            {deal.comments && (
              <SidebarSection open={sidebarSections.comments} onToggle={() => toggleSidebar("comments")} icon={MessageSquare} title="Comments" testId="toggle-sidebar-comments">
                <p className="text-xs whitespace-pre-wrap text-muted-foreground" data-testid="text-deal-comments">{deal.comments}</p>
              </SidebarSection>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

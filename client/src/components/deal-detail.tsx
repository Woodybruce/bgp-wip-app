import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  FileText,
  MessageSquare,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState, useMemo, useEffect } from "react";
import { Pill } from "@/components/ui/pill";
import { trackRecentItem } from "@/hooks/use-recent-items";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, invalidateDealCaches, getAuthHeaders } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import type { CrmDeal, CrmProperty, CrmCompany, CrmContact } from "@shared/schema";
import { buildUserColorMap, resolveDealAgents } from "@/lib/agent-colors";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { BrandProfilePanel } from "@/components/brand-profile-panel";
import { DEAL_STATUS_LABELS, legacyToCode } from "@shared/deal-status";
import { InlineLinkSelect, InlineText } from "@/components/inline-edit";
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
} from "@/pages/deals";
import { PropertyFoldersPanel } from "@/pages/properties";
import { areaBasisFromAssetClass, isRetailAssetClass } from "@/lib/crm-options";
import { AIActivityCard } from "@/components/ai-activity-card";
import { DealAmlStatusCard } from "@/components/deal-aml-status";

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
          <Icon className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{title}</span>
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
  const [unitEditOpen, setUnitEditOpen] = useState(false);
  const [unitEditForm, setUnitEditForm] = useState({
    switchToUnitId: "",
    unitAddress: "",
    unitPostcode: "",
    unitUprn: "",
    unitAddressFreeText: "",
  });

  // Heavy panels — collapsed by default to keep the page scannable.
  const [mainSections, setMainSections] = useState<Record<string, boolean>>({
    pathway: false,
    planning: false,
    kyc: true,
    brands: false,
    history: false,
    timeline: false,
    audit: false,
    emails: false,
    meetings: false,
  });
  const toggleMain = (key: string) => setMainSections(prev => ({ ...prev, [key]: !prev[key] }));

  // Phone section switcher (docs/DESIGN.md §9) — the deal page runs 15+
  // boards deep in one scroll; below md we show one section at a time,
  // same treatment that fixed the WIP report. Desktop layout unchanged.
  const [phoneSection, setPhoneSection] = useState<"overview" | "brand" | "compliance" | "activity" | "files">("overview");
  const sec = (k: typeof phoneSection) => (phoneSection === k ? "" : "hidden md:block");

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

  // Client logins (e.g. Landsec) see a trimmed deal page — no BGP-internal
  // panels (AI activity feed of staff emails, KYC/AML, Xero billing,
  // SharePoint folders). Those endpoints 403 for clients anyway; hiding the
  // panels stops broken cards + console noise on the deal they open.
  const { data: ddUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  // Treat the user as a client until auth/me resolves — on a hard page load
  // the panels otherwise mount for a beat and fire their (403) queries
  // before the role is known. Staff just see the panels pop in a tick later.
  const isClientDeal = !ddUser || ddUser.role === "Client" || !!ddUser.companyScopeId;

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

  // Clients chasing a deal need a BGP owner in sight (UX #44): prefer the
  // deal's own internalAgent names, fall back to the account team's lead.
  // The client-teams endpoint is already scope-jailed to the client's own
  // company and carries emails for mailto links.
  const ddClientCompanyId = ddUser?.companyScopeId || null;
  const { data: ddBgpTeam = [] } = useQuery<Array<{ user_id: string; full_name: string | null; username: string | null; email: string | null; is_lead: boolean }>>({
    queryKey: ["/api/client-teams", ddClientCompanyId],
    queryFn: async () => {
      const r = await fetch(`/api/client-teams/${ddClientCompanyId}`, { headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!ddUser && isClientDeal && !!ddClientCompanyId,
  });
  const ddBgpLeads: Array<{ name: string; email: string | null }> = (() => {
    if (!isClientDeal || !deal) return [];
    const raw = (deal as any).internalAgent;
    const agentNames = (Array.isArray(raw) ? raw : String(raw || "").split(","))
      .map((s: string) => String(s).trim()).filter(Boolean);
    const memberByName = (n: string) =>
      ddBgpTeam.find(m => (m.full_name || m.username || "").toLowerCase() === n.toLowerCase());
    if (agentNames.length > 0) {
      const mapped = agentNames.map((n: string) => ({ name: n, email: memberByName(n)?.email || null }));
      // UX #65: an agent who isn't on the account-team board renders with
      // no email, leaving the client an inert name and nobody to chase.
      // Guarantee at least one clickable contact by appending the account
      // lead when none of the named agents resolved to an email.
      if (!mapped.some((m: { email: string | null }) => m.email)) {
        const lead = ddBgpTeam.find(m => m.is_lead && m.email) || ddBgpTeam.find(m => m.email);
        const leadName = lead ? (lead.full_name || lead.username || "") : "";
        if (lead && !mapped.some((m: { name: string }) => m.name.toLowerCase() === leadName.toLowerCase())) {
          mapped.push({ name: leadName, email: lead.email });
        }
      }
      return mapped;
    }
    // No agent on the deal — fall back to the account team's flagged lead,
    // or failing that the first team member, so the client is never left
    // with nobody to chase.
    const lead = ddBgpTeam.find(m => m.is_lead) || ddBgpTeam[0];
    return lead ? [{ name: lead.full_name || lead.username || "BGP team", email: lead.email || null }] : [];
  })();

  // Look up units on this deal's property so we can show breadcrumb + power
  // the "edit unit / address" overlay on the heading.
  const { data: propertyUnits = [] } = useQuery<Array<{
    id: string; unitName: string; propertyId: string;
    unitAddress?: string | null; unitPostcode?: string | null;
    unitUprn?: string | null; unitAddressFreeText?: string | null;
  }>>({
    queryKey: ["/api/property-units"],
    enabled: !isClientDeal,
  });
  const linkedUnit = (deal as any)?.unitId
    ? propertyUnits.find((u) => u.id === (deal as any).unitId)
    : null;
  const unitsOnThisProperty = (deal as any)?.propertyId
    ? propertyUnits.filter(u => u.propertyId === (deal as any).propertyId)
    : [];
  const userColorMap = useMemo(() => buildUserColorMap(users as any), [users]);

  useEffect(() => {
    if (deal) {
      trackRecentItem({ id: deal.id, type: "deal", name: (deal as any).propertyName || deal.name || "Untitled Deal", subtitle: deal.status || undefined, team: Array.isArray(deal.team) ? deal.team[0] : undefined });
    }
  }, [deal?.id, deal?.name, (deal as any)?.propertyName]);

  useEffect(() => {
    if (!deal || !window.location.search.includes("tab=invoice")) return;
    const timer = setTimeout(() => {
      const el = document.querySelector('[data-testid="xero-invoice-section"]');
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 300);
    return () => clearTimeout(timer);
  }, [deal?.id]);

  const linkedProperty = deal?.propertyId ? properties.find((p) => p.id === deal.propertyId) : null;

  // Investment deals are about the whole property, so the property name can
  // stand in for a missing deal name. A leasing deal with no linked unit must
  // keep its own name — two unit-less deals at the same property would
  // otherwise be indistinguishable everywhere the title shows.
  const isInvestmentDeal = deal?.dealType === "Sale" || deal?.dealType === "Purchase";
  const dealDisplayName = (isInvestmentDeal
    ? (linkedProperty?.name || deal?.name)
    : (deal?.name || linkedProperty?.name)) || "Untitled Deal";

  const linkedLandlord = deal?.landlordId ? companies.find((c) => c.id === deal.landlordId) : null;
  const linkedTenant = deal?.tenantId ? companies.find((c) => c.id === deal.tenantId) : null;

  const linkedContacts = useMemo(() => {
    if (!deal) return [];
    const ids = [deal.clientContactId, deal.vendorAgentId, deal.acquisitionAgentId, deal.purchaserAgentId, deal.leasingAgentId].filter(Boolean);
    return contacts.filter((c) => ids.includes(c.id));
  }, [deal, contacts]);

  // Open the unit-edit overlay, pre-filling from the currently linked unit.
  const openUnitEdit = () => {
    setUnitEditForm({
      switchToUnitId: linkedUnit?.id || "",
      unitAddress: linkedUnit?.unitAddress || "",
      unitPostcode: linkedUnit?.unitPostcode || "",
      unitUprn: linkedUnit?.unitUprn || "",
      unitAddressFreeText: linkedUnit?.unitAddressFreeText || "",
    });
    setUnitEditOpen(true);
  };

  // Save handler: writes any address-field changes to property_units, and if
  // the user picked a different unit, points the deal's unitId at it.
  const saveUnitEdit = useMutation({
    mutationFn: async () => {
      if (linkedUnit?.id) {
        await apiRequest("PATCH", `/api/property-units/${linkedUnit.id}`, {
          unitAddress: unitEditForm.unitAddress || null,
          unitPostcode: unitEditForm.unitPostcode || null,
          unitUprn: unitEditForm.unitUprn || null,
          unitAddressFreeText: unitEditForm.unitAddressFreeText || null,
        });
      }
      if (unitEditForm.switchToUnitId && unitEditForm.switchToUnitId !== linkedUnit?.id) {
        await apiRequest("PUT", `/api/crm/deals/${id}`, { unitId: unitEditForm.switchToUnitId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/property-units"] });
      setUnitEditOpen(false);
    },
  });

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

  const handlePartySave = async (field: "tenantId" | "landlordId" | "vendorId" | "purchaserId", value: string | null) => {
    await apiRequest("PUT", `/api/crm/deals/${id}`, { [field]: value });
    invalidateDealCaches(id);
    // AML screening is a staff-only endpoint — a client linking a party on
    // their own deal must not fire it (403) or see the "Running AML checks"
    // toast for a run that never happens.
    if (value && !isClientDeal) {
      const co = companies.find(c => c.id === value);
      toast({ title: "Running AML checks", description: `Screening ${co?.name || "party"}...` });
      try {
        await fetch(`/api/kyc/run-all-checks`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ dealId: id, bothSides: true }),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      } catch (err: any) {
        console.error("[AML] auto-run failed:", err.message);
      }
    }
  };

  // Inline create for the party pickers. Mirrors the deal-form's
  // createLandlord/Tenant/Vendor/Purchaser flow — the inline picker
  // already supports onCreate; the deal-detail page just wasn't wiring
  // it, so a "No matches" search had no way out. Returning the new id
  // from this resolver lets the picker auto-select it.
  const createCounterparty = async (
    field: "landlordId" | "tenantId" | "vendorId" | "purchaserId",
    companyType: string,
    name: string,
  ) => {
    try {
      const r = await apiRequest("POST", "/api/crm/companies", {
        name: name.trim(),
        companyType,
        isTrackedBrand: companyType.startsWith("Tenant"),
      });
      const created = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      await handlePartySave(field, String(created.id));
      toast({ title: `${companyType} created`, description: `${created.name} added to CRM and linked.` });
    } catch (e: any) {
      toast({ title: "Create failed", description: e?.message || "Try again from the Companies page", variant: "destructive" });
    }
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

  const _areaBasis = deal.areaBasis || areaBasisFromAssetClass(deal.assetClass);
  const _isRetail = isRetailAssetClass(deal.assetClass);
  // Net Effective = Headline Rent × (term − rent_free / 12) / term.
  // Rent-free is captured in months on the deal, lease length in years.
  // Only meaningful when all three values are present and the term is
  // longer than the free period; otherwise hide the row rather than
  // show a misleading zero or negative.
  const netEffectiveRent = (() => {
    const headline = Number(deal.rentPa) || 0;
    const termYears = Number(deal.leaseLength) || 0;
    const freeMonths = Number(deal.rentFree) || 0;
    if (!headline || !termYears) return null;
    const termMonths = termYears * 12;
    if (freeMonths >= termMonths) return null;
    return Math.round(headline * (termMonths - freeMonths) / termMonths);
  })();

  const numericFields: { label: string; value: number | string | null | undefined; format?: "currency" | "number" | "percent" }[] = [
    { label: "Pricing", value: deal.pricing, format: "currency" },
    { label: "Headline Rent", value: deal.rentPa, format: "currency" },
    { label: "Net Effective Rent", value: netEffectiveRent, format: "currency" },
    { label: "Yield", value: deal.yieldPercent, format: "percent" },
    { label: `${_areaBasis} Area (sq ft)`, value: deal.totalAreaSqft, format: "number" },
    { label: "Price PSF", value: deal.pricePsf, format: "currency" },
    ...(_isRetail ? [{ label: "Price ITZA", value: deal.priceItza, format: "currency" as const }] : []),
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
  const linkedBillingName = (deal as any).xeroContactName || null;

  // Deal Type + Status deliberately omitted here — they're already in the
  // header (the orange "Deal · {type}" eyebrow + the status badge), so
  // repeating them in this card was pure duplication.
  const textFields: { label: string; value: string | null | undefined; colorMap?: Record<string, string>; href?: string }[] = [
    { label: "Team", value: Array.isArray(deal.team) ? deal.team.join(", ") : deal.team, colorMap: DEAL_TEAM_COLORS },
    { label: "Tenure", value: deal.tenureText },
    { label: "Fee Agreement", value: deal.feeAgreement, colorMap: DEAL_FEE_AGREEMENT_COLORS },
    { label: "Instructed", value: deal.instructedAt ? formatDate(deal.instructedAt) : null },
    { label: "Exchanged", value: deal.exchangedAt ? formatDate(deal.exchangedAt) : null },
    { label: "Completed", value: deal.completedAt ? formatDate(deal.completedAt) : null },
    { label: "Invoiced", value: deal.invoicedAt ? formatDate(deal.invoicedAt) : null },
    { label: "Last Interaction", value: deal.lastInteraction ? (isNaN(Date.parse(deal.lastInteraction)) ? deal.lastInteraction : formatDate(deal.lastInteraction)) : null },
  ];

  // Files / linked records / comments / history. Rendered in the right
  // sidebar on ≥md screens and stacked under the main column on mobile —
  // the sidebar is display:none below md, which used to make these
  // sections unreachable on phones.
  const sidebarLinkPanels = (
    <>
      <SidebarSection open={sidebarSections.files} onToggle={() => toggleSidebar("files")} icon={FileText} title="Files" testId="toggle-sidebar-files">
        <div className="space-y-2" data-testid="deal-files-section">
          {/* The deal's files live in its property's folder — render the
              same unified Files panel (browse / upload / new folder /
              rename / delete / share) instead of just a link. */}
          {linkedProperty && !isClientDeal && (
            <PropertyFoldersPanel
              propertyName={linkedProperty.name}
              folderTeams={(linkedProperty as any).folderTeams}
              sharepointFolderUrl={(linkedProperty as any).sharepointFolderUrl}
            />
          )}
          {isClientDeal && (
            <p className="text-xs text-muted-foreground italic">Documents are managed by the BGP team.</p>
          )}
          {!linkedProperty && !isClientDeal && (
            <p className="text-xs text-muted-foreground italic">Link this deal to a property to see its folders.</p>
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

    </>
  );

  const sidebarActivityPanels = (
    <>
      <SidebarSection open={sidebarSections.comments} onToggle={() => toggleSidebar("comments")} icon={MessageSquare} title="Comments" testId="toggle-sidebar-comments">
        <DealComments dealId={id} comments={deal.comments} />
      </SidebarSection>

      <SidebarSection open={sidebarSections.history ?? true} onToggle={() => toggleSidebar("history")} icon={History} title="History & activity" testId="toggle-sidebar-history">
        <div className="space-y-2">
          {/* Timeline reads /api/deals/:id/timeline, which the client gateway
              blocks — offering the panel to clients opens an empty box over a
              403. Clients keep the Audit log below. */}
          {!isClientDeal && (
          <CollapsibleCard open={mainSections.timeline} onToggle={() => toggleMain("timeline")} icon={CalendarIcon} title="Timeline" testId="toggle-deal-timeline">
            <DealTimeline dealId={id} />
          </CollapsibleCard>
          )}
          <CollapsibleCard open={mainSections.audit} onToggle={() => toggleMain("audit")} icon={History} title="Audit log" testId="toggle-deal-audit">
            <DealAuditLog dealId={id} />
          </CollapsibleCard>
        </div>
      </SidebarSection>
    </>
  );

  const sidebarPanels = (
    <>
      {sidebarLinkPanels}
      {sidebarActivityPanels}
    </>
  );

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col" data-testid={`deal-detail-${id}`}>
      <div className="px-4 sm:px-6 pt-4 sm:pt-5">
        <Breadcrumbs
          items={[
            { label: isComps ? "Comps" : "Deals", href: isComps ? "/comps" : "/deals" },
            { label: dealDisplayName },
          ]}
        />
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto cq-body">
          <div className="p-4 sm:p-5 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="ghost"
          size="icon"
          data-testid="button-back-deals"
          onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
            else navigate(isComps ? "/comps" : "/deals");
          }}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        {/* min-w-[16rem], not min-w-0: with basis 0 the title block "fits" at
            any width, so the wrap never triggered and a narrow window (chat
            panel open) crushed the heading to one word per line — the action
            buttons must wrap below instead. */}
        <div className="flex-1 min-w-[16rem]">
          {(() => {
            // Investment (Sale/Purchase) deals are about the whole property —
            // heading = property name. Leasing deals are about a specific unit
            // — heading = unit name, property as subtitle.
            const isInvestment = deal.dealType === "Sale" || deal.dealType === "Purchase";
            const headingIsUnit = !isInvestment && !!linkedUnit;
            const headingText = headingIsUnit
              ? linkedUnit!.unitName
              : dealDisplayName;
            // Counterparty: Purchaser/Vendor for investment, Tenant for leasing.
            let counterpartyId: string | null = null;
            let counterpartyLabel = "";
            if (isInvestment) {
              if (deal.dealType === "Sale") { counterpartyId = (deal as any).purchaserId; counterpartyLabel = "Purchaser"; }
              else { counterpartyId = (deal as any).vendorId; counterpartyLabel = "Vendor"; }
            } else {
              counterpartyId = (deal as any).tenantId;
              counterpartyLabel = "Tenant";
            }
            const counterparty = counterpartyId ? companies.find((c) => c.id === counterpartyId) : null;
            return (
              <>
                <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary mb-1" data-testid="deal-eyebrow">
                  <span className="w-2 h-2 rounded-full bg-primary" /> Deal{deal.dealType ? ` · ${deal.dealType}` : ""}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {headingIsUnit ? (
                    <button
                      onClick={openUnitEdit}
                      className="text-xl font-bold truncate hover:underline hover:text-primary transition-colors"
                      data-testid="text-deal-name"
                      title="Click to switch unit or edit unit address"
                    >
                      {headingText}
                    </button>
                  ) : (
                    <h1 className="text-xl font-bold truncate" data-testid="text-deal-name">{headingText}</h1>
                  )}
                  {deal.status && (
                    <Badge variant="outline" className={`text-[10px] border-transparent ${DEAL_STATUS_COLORS[legacyToCode(deal.status) || ""] || "bg-muted text-muted-foreground"}`} data-testid="badge-deal-status">{(() => { const code = legacyToCode(deal.status); return code ? DEAL_STATUS_LABELS[code] : deal.status; })()}</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1 flex-wrap" data-testid="deal-breadcrumb">
                  {linkedProperty && headingText !== linkedProperty.name && (
                    <Link href={`/properties/${linkedProperty.id}`} className="inline-flex items-center gap-1 hover:underline hover:text-foreground" title="Open property">
                      <Building2 className="w-3.5 h-3.5" /> {linkedProperty.name}
                    </Link>
                  )}
                  {counterparty && (
                    <Link href={`/companies/${counterparty.id}`} className="inline-flex items-center gap-1 hover:underline hover:text-foreground" title={`Open ${counterpartyLabel.toLowerCase()}`}>
                      <Users className="w-3.5 h-3.5" /> {counterpartyLabel}: {counterparty.name}
                    </Link>
                  )}
                  {!counterparty && (
                    <span className="text-xs italic">{counterpartyLabel} not set</span>
                  )}
                  {ddBgpLeads.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs" title="Your BGP contact for this deal" data-testid="deal-bgp-lead">
                      <Users className="w-3.5 h-3.5" /> BGP contact:{" "}
                      {ddBgpLeads.map((p, i) => (
                        <span key={p.name}>
                          {i > 0 && ", "}
                          {p.email ? (
                            <a href={`mailto:${p.email}`} className="font-medium text-foreground hover:underline">{p.name}</a>
                          ) : (
                            <span className="font-medium text-foreground">{p.name}</span>
                          )}
                        </span>
                      ))}
                    </span>
                  )}
                  {deal.targetDate && (
                    <span className="inline-flex items-center gap-1 text-xs" title="Target date" data-testid="deal-target-date">
                      <CalendarIcon className="w-3.5 h-3.5" /> Target: {formatDate(deal.targetDate)}
                    </span>
                  )}
                  {headingIsUnit && (
                    <Link href={`/deals/letting${linkedProperty ? `?propertyId=${linkedProperty.id}` : ""}`} className="text-xs hover:underline hover:text-foreground" data-testid="link-back-to-tracker">
                      ← Back to Letting Tracker
                    </Link>
                  )}
                  {/* Spine state — green chip when the deal is linked
                      to the canonical tenancy unit, amber when it
                      isn't yet (so the property page doesn't see this
                      deal on a specific row). Clicking the green chip
                      jumps to the unit on the property's tenancy
                      schedule. */}
                  {linkedProperty && !isInvestment && (
                    (deal as any).tenancyUnitId ? (
                      <Link href={`/properties/${linkedProperty.id}#tenancy-unit-${(deal as any).tenancyUnitId}`}>
                        <a
                          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          title="Linked to the tenancy schedule (canonical spine)"
                          data-testid="chip-on-tenancy-spine"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          On tenancy spine
                        </a>
                      </Link>
                    ) : !isClientDeal ? (
                      // Internal data-hygiene flag — hidden from client
                      // viewers (the nightly sweep re-links automatically;
                      // staff can still Resolve from the property page).
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700"
                        title="This deal isn't yet linked to a tenancy schedule row. It will auto-link on the nightly sweep, or use Resolve on the property page."
                        data-testid="chip-off-tenancy-spine"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Off tenancy spine
                      </span>
                    ) : null
                  )}
                </div>
              </>
            );
          })()}
        </div>
        <div className="flex items-center gap-2 flex-wrap gap-y-1.5">
          <Link href={`/image-studio?property=${encodeURIComponent(linkedProperty?.name || (deal as any).propertyName || deal.name || "")}&address=${encodeURIComponent(linkedProperty?.address ? (typeof linkedProperty.address === 'object' && linkedProperty.address !== null ? ((linkedProperty.address as any).formatted || (linkedProperty.address as any).line1 || linkedProperty.name) : String(linkedProperty.address || linkedProperty.name)) : ((deal as any).propertyName || deal.name || ""))}&propertyId=${encodeURIComponent(deal.propertyId || "")}`}>
            <Button variant="outline" size="sm" data-testid="button-deal-image-studio">
              <ImageIcon className="w-4 h-4 mr-2" />
              Image Studio
            </Button>
          </Link>
          {/* Document briefs are staff-only (the API 403s clients and the
              route guard bounces them home) — hide the entry point. */}
          {!isClientDeal && (
            <Link href={`/document-briefs?propertyId=${encodeURIComponent(deal.propertyId || "")}&propertyName=${encodeURIComponent(linkedProperty?.name || (deal as any).propertyName || deal.name || "")}&postcode=${encodeURIComponent((linkedProperty as any)?.postcode || "")}`}>
              <Button variant="outline" size="sm" data-testid="button-deal-create-document">
                <FileText className="w-4 h-4 mr-2" />
                Create document
              </Button>
            </Link>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} data-testid="button-edit-deal">
            <Pencil className="w-4 h-4 mr-2" />
            Edit
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 md:hidden" data-testid="deal-phone-sections">
        <Pill active={phoneSection === "overview"} onClick={() => setPhoneSection("overview")} data-testid="deal-section-overview">Overview</Pill>
        <Pill active={phoneSection === "brand"} onClick={() => { setPhoneSection("brand"); setMainSections(prev => ({ ...prev, brands: true })); }} data-testid="deal-section-brand">Brand</Pill>
        {!isClientDeal && (
          <Pill active={phoneSection === "compliance"} onClick={() => { setPhoneSection("compliance"); setMainSections(prev => ({ ...prev, kyc: true })); }} data-testid="deal-section-compliance">KYC</Pill>
        )}
        <Pill active={phoneSection === "activity"} onClick={() => setPhoneSection("activity")} data-testid="deal-section-activity">Activity</Pill>
        <Pill active={phoneSection === "files"} onClick={() => setPhoneSection("files")} data-testid="deal-section-files">Files</Pill>
      </div>

      <div className={`space-y-2.5 ${sec("overview")}`}>
      {textFields.some((f) => f.value) && (
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
      )}

      {/* Parties + Fee Allocation side by side to use the horizontal space. */}
      <div className="cq-two-up">
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Parties</h3>
          </div>
          {/* Clients see WHO at BGP runs this deal (names only, no fees) —
              "who do I chase?" previously ended in a blank (UX #25). */}
          {isClientDeal && (() => {
            const raw = (deal as any).internalAgent;
            const agents = (Array.isArray(raw) ? raw : String(raw || "").split(",")).map((a: string) => String(a).trim()).filter(Boolean);
            if (agents.length === 0) return null;
            return (
              <p className="text-xs text-muted-foreground" data-testid="client-bgp-contact">
                Your BGP contact{agents.length > 1 ? "s" : ""}: <span className="font-medium text-foreground">{agents.join(", ")}</span>
              </p>
            );
          })()}
          {/* Leasing deals show Landlord/Tenant; investment (Sale/Purchase)
              deals show Vendor/Purchaser — the unused pair is clutter that
              invites mis-linking (UX #19). Already-linked slots stay visible
              either way so existing data is never hidden. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
            {(() => { const partiesInvestment = deal.dealType === "Sale" || deal.dealType === "Purchase"; return (<>
            {(!partiesInvestment || deal.landlordId) && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-muted-foreground leading-tight">Landlord</p>
              <InlineLinkSelect
                value={deal.landlordId}
                options={companies.filter(c => c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client" || c.companyType?.startsWith("Tenant") || c.id === deal.landlordId).map(c => ({ id: c.id, name: c.name }))}
                href={deal.landlordId ? `/companies/${deal.landlordId}` : undefined}
                onSave={(v) => handlePartySave("landlordId", v || null)}
                onCreate={(name) => createCounterparty("landlordId", "Landlord", name)}
                placeholder="Link landlord"
              />
            </div>
            )}
            {(!partiesInvestment || deal.tenantId) && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-muted-foreground leading-tight">Tenant</p>
              <InlineLinkSelect
                value={deal.tenantId}
                options={companies.filter(c => c.companyType?.startsWith("Tenant") || c.companyType === "Purchaser" || c.id === deal.tenantId).map(c => ({ id: c.id, name: c.name }))}
                href={deal.tenantId ? `/companies/${deal.tenantId}` : undefined}
                onSave={(v) => handlePartySave("tenantId", v || null)}
                onCreate={(name) => createCounterparty("tenantId", "Tenant", name)}
                placeholder="Link tenant"
              />
            </div>
            )}
            {(partiesInvestment || deal.vendorId) && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-muted-foreground leading-tight">Vendor</p>
              <InlineLinkSelect
                value={deal.vendorId}
                options={companies.filter(c => c.companyType === "Vendor" || c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client" || c.id === deal.vendorId).map(c => ({ id: c.id, name: c.name }))}
                href={deal.vendorId ? `/companies/${deal.vendorId}` : undefined}
                onSave={(v) => handlePartySave("vendorId", v || null)}
                onCreate={(name) => createCounterparty("vendorId", "Vendor", name)}
                placeholder="Link vendor"
              />
            </div>
            )}
            {(partiesInvestment || deal.purchaserId) && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-muted-foreground leading-tight">Purchaser</p>
              <InlineLinkSelect
                value={deal.purchaserId}
                options={companies.filter(c => c.companyType?.startsWith("Tenant") || c.companyType === "Purchaser" || c.companyType === "Investor" || c.id === deal.purchaserId).map(c => ({ id: c.id, name: c.name }))}
                href={deal.purchaserId ? `/companies/${deal.purchaserId}` : undefined}
                onSave={(v) => handlePartySave("purchaserId", v || null)}
                onCreate={(name) => createCounterparty("purchaserId", "Purchaser", name)}
                placeholder="Link purchaser"
              />
            </div>
            )}
            </>); })()}
            {!isClientDeal && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-muted-foreground leading-tight">Xero Contact</p>
              {(deal as any).xeroContactName ? (
                <div className="text-xs">
                  <span className="font-medium">{(deal as any).xeroContactName}</span>
                  {(deal as any).xeroAccountNumber && (
                    <span className="text-muted-foreground"> · A/C {(deal as any).xeroAccountNumber}</span>
                  )}
                </div>
              ) : (
                <span className="text-[11px] text-muted-foreground italic">Set via Edit · Xero Contact</span>
              )}
            </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Fee Allocation sits next to Parties. The allocated agents ARE the
          BGP contacts, so the separate BGP Contacts card was removed —
          edit the agents via the Fee Allocation "Edit" button.
          BGP fees are never shown to client logins. */}
      {!isClientDeal ? (
      <FeeAllocationCard
        dealId={deal.id}
        dealFee={deal.fee}
        headlineRent={deal.rentPa}
        users={users.map(u => ({ id: String(u.id), name: u.name }))}
        colorMap={userColorMap}
      />
      ) : (deal.fee != null || deal.feePercentage != null) ? (
        // Client-facing fee view: the fee they're paying us. Headline rent
        // already appears in the metrics card below, so it's not repeated
        // here. The internal per-agent split (FeeAllocationCard) stays
        // staff-only.
        <Card>
          <CardContent className="p-3">
            <h3 className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest mb-2">BGP Fee</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {deal.fee != null && (
                <div className="flex flex-col py-1">
                  <p className="text-[10px] text-muted-foreground leading-tight">Total Fee</p>
                  <p className="text-xs font-mono font-medium" data-testid="text-client-fee-total">{formatCurrency(deal.fee)}</p>
                </div>
              )}
              {deal.feePercentage != null && (
                <div className="flex flex-col py-1">
                  <p className="text-[10px] text-muted-foreground leading-tight">Agency Fee</p>
                  <p className="text-xs font-mono font-medium" data-testid="text-client-fee-pct">{deal.feePercentage}%</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
      </div>

      {(numericFields.some((f) => f.value != null) || [deal.gfAreaSqft, deal.ffAreaSqft, deal.basementAreaSqft, deal.itzaAreaSqft].some((v) => v != null)) && (
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
            {[
              { label: "GF", value: deal.gfAreaSqft },
              { label: "FF", value: deal.ffAreaSqft },
              { label: "Bsmt", value: deal.basementAreaSqft },
              ...(_isRetail ? [{ label: "ITZA", value: deal.itzaAreaSqft }] : []),
            ].some(f => f.value != null) && (
              <div className="flex flex-col py-1 col-span-2">
                <p className="text-[10px] text-muted-foreground leading-tight mb-0.5">Floor Breakdown</p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {[
                    { label: "GF", value: deal.gfAreaSqft },
                    { label: "FF", value: deal.ffAreaSqft },
                    { label: "Bsmt", value: deal.basementAreaSqft },
                    ...(_isRetail ? [{ label: "ITZA", value: deal.itzaAreaSqft }] : []),
                  ].filter(f => f.value != null).map(f => (
                    <span key={f.label} className="text-xs font-mono">
                      <span className="text-[9px] text-muted-foreground/70 uppercase mr-0.5">{f.label}</span>
                      {formatNumber(f.value)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      {!isClientDeal && <XeroInvoiceSection dealId={deal.id} deal={deal} companies={companies} />}

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

      </div>

      {/* AI-curated activity — primary comms feed (emails + meetings), shown
          above KYC. Raw sources live in "History & activity" in the rail.
          Hidden for clients: it surfaces BGP staff emails/meetings. */}
      {!isClientDeal && (
        <div className={sec("activity")}>
          <AIActivityCard subjectType="deal" subjectId={id} title="Deal Activity (AI curated)" />
        </div>
      )}

      {/* KYC/AML is BGP-internal compliance — never shown to clients. */}
      {!isClientDeal && (
      <div className={sec("compliance")}>
      <CollapsibleCard open={mainSections.kyc} onToggle={() => toggleMain("kyc")} icon={ShieldCheck} title="KYC" testId="toggle-deal-kyc">
        <div className="space-y-3">
          <DealKYCPanel deal={deal} companies={companies} />
          {/* AML AI augments — MLR scope, AI triage, SoF analyser, MLRO PDF.
              Sits below the existing per-counterparty KYC pack so MLRO has the
              full toolset on one screen. Renders even with <2 counterparties. */}
          <DealAmlStatusCard dealId={id} />
        </div>
      </CollapsibleCard>
      </div>
      )}

      {[
        { company: linkedTenant, role: "Tenant" },
        { company: linkedLandlord, role: "Landlord" },
      ]
        .filter(({ company }) => !!company)
        .filter(({ company }, i, arr) => arr.findIndex(a => a.company!.id === company!.id) === i).length > 0 && (
        <div className={sec("brand")}>
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
        </div>
      )}


      {deal.updatedAt && (
        <p className={`text-xs text-muted-foreground items-center gap-1 ${phoneSection === "overview" ? "flex" : "hidden md:flex"}`}>
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

      {/* Unit pick + unit-level address editor — opened from the heading. */}
      <Dialog open={unitEditOpen} onOpenChange={setUnitEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Unit</DialogTitle>
            <DialogDescription>
              Switch to a different unit on this property, or edit this unit's address details. The address feeds business-rates and EPC lookups.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Switch unit</Label>
              <Select
                value={unitEditForm.switchToUnitId || undefined}
                onValueChange={(v) => setUnitEditForm(f => ({ ...f, switchToUnitId: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Pick a unit on this property" /></SelectTrigger>
                <SelectContent>
                  {unitsOnThisProperty.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.unitName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="border-t pt-3 space-y-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Unit address — for "{linkedUnit?.unitName || "this unit"}"
              </div>
              <div>
                <Label className="text-xs">Address line</Label>
                <Input
                  value={unitEditForm.unitAddress}
                  onChange={e => setUnitEditForm(f => ({ ...f, unitAddress: e.target.value }))}
                  placeholder="e.g. Unit 4A, Grand Central, Birmingham"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Postcode</Label>
                  <Input
                    value={unitEditForm.unitPostcode}
                    onChange={e => setUnitEditForm(f => ({ ...f, unitPostcode: e.target.value }))}
                    placeholder="B2 4AB"
                  />
                </div>
                <div>
                  <Label className="text-xs">UPRN</Label>
                  <Input
                    value={unitEditForm.unitUprn}
                    onChange={e => setUnitEditForm(f => ({ ...f, unitUprn: e.target.value }))}
                    placeholder="200012345678"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Free-text fallback <span className="text-muted-foreground">(if not on PAF)</span></Label>
                <Input
                  value={unitEditForm.unitAddressFreeText}
                  onChange={e => setUnitEditForm(f => ({ ...f, unitAddressFreeText: e.target.value }))}
                  placeholder="Kiosk 12, Market Hall ground floor"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnitEditOpen(false)}>Cancel</Button>
            <Button onClick={() => saveUnitEdit.mutate()} disabled={saveUnitEdit.isPending}>
              {saveUnitEdit.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Below md the right sidebar is hidden — surface the same sections
          stacked here so files/contacts/comments/history stay reachable
          on phones. */}
      <div className={`md:hidden border rounded-md mt-4 ${phoneSection === "files" ? "" : "hidden"}`} data-testid="deal-sidebar-mobile">
        {sidebarLinkPanels}
      </div>
      <div className={`md:hidden border rounded-md mt-4 ${phoneSection === "activity" ? "" : "hidden"}`} data-testid="deal-sidebar-mobile-activity">
        {sidebarActivityPanels}
      </div>

      {!isClientDeal && (
      <div className="flex justify-start mt-6 pt-3 border-t">
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteOpen(true)} data-testid="button-delete-deal">
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Deal
        </Button>
      </div>
      )}

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
        <div className="w-[340px] border-l bg-background flex flex-col shrink-0 h-full overflow-hidden hidden md:flex">
          <ScrollArea className="flex-1">
            <div className="px-4 pt-4 pb-3 border-b">
              <h3 className="text-sm font-bold leading-tight truncate" data-testid="sidebar-deal-name">{dealDisplayName}</h3>
            </div>
            {sidebarPanels}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

// Append-only comments (UX #48). Entries live in crm_deals.comments as
// "[stamp · author]\ntext" blocks separated by blank lines — parsed here for
// display; anything that predates the format renders as one "Earlier note".
function parseDealComments(blob: string | null | undefined): Array<{ meta: string | null; text: string }> {
  if (!blob?.trim()) return [];
  const parts = blob.split(/\n\n(?=\[[^\]\n]+ · [^\]\n]+\]\n)/);
  return parts.map((p) => {
    const m = p.match(/^\[([^\]\n]+ · [^\]\n]+)\]\n([\s\S]*)$/);
    return m ? { meta: m[1], text: m[2] } : { meta: null, text: p.trim() };
  }).filter((e) => e.text);
}

function DealComments({ dealId, comments }: { dealId: string; comments: string | null | undefined }) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const entries = parseDealComments(comments);
  const post = async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      await apiRequest("POST", `/api/crm/deals/${dealId}/comments`, { text });
      setDraft("");
      invalidateDealCaches(dealId);
    } finally {
      setPosting(false);
    }
  };
  return (
    <div className="space-y-2" data-testid="deal-comments">
      {entries.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No comments yet.</p>
      )}
      {entries.map((e, i) => (
        <div key={i} className="text-xs border rounded-md p-2" data-testid={`deal-comment-${i}`}>
          <p className="text-[10px] text-muted-foreground mb-0.5">{e.meta ?? "Earlier note"}</p>
          <p className="whitespace-pre-wrap">{e.text}</p>
        </div>
      ))}
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Add a comment…"
        className="text-xs min-h-[56px]"
        data-testid="input-deal-comment"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={post}
        disabled={posting || !draft.trim()}
        data-testid="btn-add-deal-comment"
      >
        {posting ? "Posting…" : "Add comment"}
      </Button>
    </div>
  );
}

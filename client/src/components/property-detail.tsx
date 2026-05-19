import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import PathwayIntelStrip from "@/components/pathway-intel-strip";
import { PropertyBrochuresPanel } from "@/components/property-brochures-panel";
import { ErrorBoundary } from "@/components/error-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Building2,
  ExternalLink,
  ChevronDown,
  X,
  ArrowLeft,
  FolderTree,
  Loader2,
  FolderOpen,
  ChevronRight,
  Handshake,
  Trash2,
  MapPin,
  Globe,
  Landmark,
  UserCheck,
  Image as ImageIcon,
  MessageSquare,
  Calendar as CalendarIcon,
  Newspaper,
  ShieldCheck,
  Sparkles,
  Activity,
  TrendingUp,
  Store,
  Map as MapIcon,
} from "lucide-react";
import { useState, useMemo, useEffect, useRef } from "react";
import { StreetViewPanoramaCapture } from "@/components/image-studio/street-view-panorama";
import { PropertyLeasingSchedule } from "@/pages/leasing-schedule";
import { PropertyTenancySchedule } from "@/components/PropertyTenancySchedule";
import { PropertyPlansPanel } from "@/components/property-plans-panel";
import { LeasingPitchPanel } from "@/components/leasing-pitch-panel";
import { BrandGapPanel } from "@/components/brand-gap-panel";
import { ComplianceBoard } from "@/components/brand-profile-panel";
import {
  PropertyAssetBriefPanel,
  PropertyCoveringStrip,
  PipelinePerformanceBoard,
  WeeklyFocusCard,
  RiskRegisterCard,
  PropertyRecentActivityCard,
  BgpCommentaryCard,
  PropertyLinkageCard,
} from "@/components/property-asset-brief";
import { trackRecentItem } from "@/hooks/use-recent-items";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { InlineText, InlineLabelSelect, InlineNumber } from "@/components/inline-edit";
import { buildUserColorMap } from "@/lib/agent-colors";
import { AddressAutocomplete, buildGoogleMapsUrl } from "@/components/address-autocomplete";
import { Checkbox } from "@/components/ui/checkbox";
import { Breadcrumbs } from "@/components/breadcrumbs";
import type { CrmProperty, CrmCompany, User } from "@shared/schema";
import {
  STATUS_OPTIONS,
  PROPERTY_STATUS_COLORS,
  ASSET_CLASS_OPTIONS,
  ASSET_CLASS_COLORS,
  TENURE_OPTIONS,
  TENURE_COLORS,
  TEAM_OPTIONS,
  TEAM_COLORS,
  CompanyLogoImg,
  addressToResult,
  resultToAddress,
  formatAddress,
  InlineEngagement,
  InlineAgents,
  InlineLandlord,
  InlineOwnerLink,
  InlineCompetitorAgent,
  InlineBillingEntity,
  InlineDeals,
  InlineTenants,
  SetUpFoldersDialog,
  PropertyFoldersPanel,
  PropertySharepointLink,
  LinkedDealsPanel,
  ClientBoardPanel,
  LinkedContactsPanel,
  PropertyIntelligencePanel,
  PropertyKycPanel,
  PropertyNewsPanel,
  LinkedLandRegistryPanel,
  StreetViewCard,
  type DealLink,
} from "@/pages/properties";

// Compact collapsible card used by the heavy mid-page panels (leasing schedule,
// tenancy, KYC, etc). Header is always rendered; body only mounts when open.
// Property Compliance & KYC wrapper — fetches the brand-profile
// payload for whichever company owns this property (freeholder >
// long leaseholder > landlord, first one set wins) and renders the
// existing ComplianceBoard inline. Also surfaces the per-property
// Billing Entity at the top — sometimes the entity that gets
// invoiced (the SPV) differs from the corporate owner.
//
// embedded=true means we're rendering inside a sidebar section
// that already provides the heading + Card chrome, so we drop our
// own wrapper.
function PropertyComplianceBoardWrapper({
  property, allCompanies, embedded = false,
}: {
  property: CrmProperty;
  allCompanies: CrmCompany[];
  embedded?: boolean;
}) {
  const ownerId: string | null =
    (property as any).freeholderId
    || (property as any).longLeaseholderId
    || (property as any).landlordId
    || null;

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/brand", ownerId, "profile"],
    queryFn: async () => {
      const res = await fetch(`/api/brand/${ownerId}/profile`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!ownerId,
  });

  // Billing entity row — rendered above the brand checks via the
  // ComplianceBoard's `prefix` slot.
  const billingEntityRow = (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
        Billing entity
        <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-300 text-amber-600">SPV</Badge>
      </div>
      <InlineBillingEntity propertyId={property.id} billingEntityId={property.billingEntityId} landlordId={property.landlordId} allCompanies={allCompanies} />
      <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
        The corporate entity invoiced for fees. Often a property SPV distinct from the freeholder / landlord above.
      </p>
    </div>
  );

  if (!ownerId) {
    const empty = (
      <div className="space-y-2.5">
        {billingEntityRow}
        <p className="text-[11px] text-muted-foreground italic border-t pt-2">
          Add a freeholder, long leaseholder, or landlord above to enable Companies House lookups, accounts download, and AML checks.
        </p>
      </div>
    );
    if (embedded) return empty;
    return <Card><CardContent className="p-3">{empty}</CardContent></Card>;
  }

  if (isLoading || !data?.company) {
    const skel = (
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    );
    if (embedded) return skel;
    return <Card><CardContent className="p-3">{skel}</CardContent></Card>;
  }

  return (
    <ComplianceBoard
      companyId={ownerId}
      company={data.company}
      embedded={embedded}
      prefix={billingEntityRow}
    />
  );
}

// Pull the commentary fields off the asset-brief payload and pass
// them into the purple BgpCommentaryCard so the card stays generic
// (it's also used elsewhere in the panel stack via the shared
// useAssetBrief query — same cache hit).
function BgpCommentaryWrapper({ propertyId }: { propertyId: string }) {
  const { data } = useQuery<any>({
    queryKey: ["/api/properties", propertyId, "asset-brief"],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/asset-brief`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
  if (!data) return <Card><CardContent className="p-3"><Skeleton className="h-16 w-full" /></CardContent></Card>;
  return <BgpCommentaryCard propertyId={propertyId} commentary={data.bgp_commentary} updatedAt={data.bgp_commentary_at} />;
}

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

export function PropertyDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { data: property, isLoading } = useQuery<CrmProperty>({
    queryKey: ["/api/crm/properties", id],
    refetchInterval: (query) => {
      const p = query.state.data;
      if (!p?.createdAt) return false;
      const ageMs = Date.now() - new Date(p.createdAt).getTime();
      const isRecent = ageMs < 5 * 60 * 1000;
      const hasEnrichmentData = !!(p.proprietorName || p.landlordId || p.titleNumber);
      if (isRecent && !hasEnrichmentData && p.address) return 10000;
      return false;
    },
  });
  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });
  const userColorMap = useMemo(() => buildUserColorMap(allUsers), [allUsers]);
  const { data: agentLinks = [] } = useQuery<Array<{ propertyId: string; userId: string; role?: string | null }>>({
    queryKey: ["/api/crm/property-agents"],
  });
  const { data: allCompanies = [] } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies", { includeBillingEntities: true }],
    queryFn: async () => {
      const res = await fetch("/api/crm/companies?includeBillingEntities=true");
      if (!res.ok) throw new Error("Failed to load companies");
      return res.json();
    },
  });
  const { data: tenantLinks = [] } = useQuery<{ propertyId: string; companyId: string }[]>({
    queryKey: ["/api/crm/property-tenants"],
  });
  const { data: dealLinks = [] } = useQuery<DealLink[]>({
    queryKey: ["/api/crm/property-deal-links"],
  });
  const { data: allDealsForDetail = [] } = useQuery<DealLink[]>({
    queryKey: ["/api/crm/deals"],
    select: (data: any[]) => data.map((d: any) => ({ id: d.id, name: d.name, propertyId: d.propertyId, status: d.status, groupName: d.groupName })),
  });
  useEffect(() => {
    if (property) {
      trackRecentItem({ id: property.id, type: "property", name: property.name || "Untitled Property", subtitle: property.status || undefined, team: (property as any).team || undefined });
    }
  }, [property?.id, property?.name, property?.status]);

  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [streetViewExpanded, setStreetViewExpanded] = useState(false);
  const [sidebarSections, setSidebarSections] = useState<Record<string, boolean>>({
    details: true,
    files: true,
    team: true,
    clients: false,
    deals: false,
    availableUnits: true,
    landRegistry: false,
    images: true,
    compliance: false,
    activity: false,
    linkage: false,
  });
  const toggleSection = (key: string) => setSidebarSections(prev => ({ ...prev, [key]: !prev[key] }));

  // Heavy panels in the main column — collapsed by default to keep the page short.
  const [mainSections, setMainSections] = useState<Record<string, boolean>>({
    plans: true,
    leasingSchedule: true,
    tenancy: true,
    pathway: false,
    kyc: false,
    intel: false,
    pitch: false,
    brands: false,
    news: false,
    contacts: false,
  });
  const toggleMain = (key: string) => setMainSections(prev => ({ ...prev, [key]: !prev[key] }));
  const { toast } = useToast();

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<CrmProperty>) => {
      const payload: any = { ...data };
      if (payload.sqft !== undefined && payload.sqft !== null) {
        payload.sqft = typeof payload.sqft === "string" ? parseFloat(payload.sqft) : payload.sqft;
      }
      if (payload.billingEntityId === "") payload.billingEntityId = null;
      const res = await apiRequest("PUT", `/api/crm/properties/${id}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const inlineUpdate = (field: string, value: any) => {
    updateMutation.mutate({ [field]: value } as any);
  };

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/crm/properties/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Property Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      navigate("/properties");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="p-4 sm:p-6 text-center space-y-4">
        <h2 className="text-lg font-semibold">Property not found</h2>
        <Link href="/properties">
          <Button variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Properties
          </Button>
        </Link>
      </div>
    );
  }


  return (
    <div className="h-[calc(100vh-48px)] flex flex-col" data-testid={`property-detail-${id}`}>
      <SetUpFoldersDialog
        propertyId={id}
        propertyName={property.name}
        folderTeams={property.folderTeams}
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
      />

      <div className="px-4 sm:px-6 pt-4 sm:pt-5">
        <Breadcrumbs
          items={[
            { label: "Properties", href: "/properties" },
            { label: property.name || "Untitled Property" },
          ]}
        />
      </div>
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2" data-testid="button-back-properties" onClick={() => window.history.length > 1 ? window.history.back() : navigate("/properties")}>
                <ArrowLeft className="w-3.5 h-3.5" />
                Properties
              </Button>
              <span className="text-muted-foreground/40">/</span>
              {editingAddress ? (
                <div className="flex items-center gap-2 flex-1 max-w-lg">
                  <div className="flex-1">
                    <AddressAutocomplete
                      value={addressToResult(property.address)}
                      onChange={(result) => {
                        const newAddress = resultToAddress(result);
                        const updates: any = { address: newAddress };
                        // Prefer the establishment name (e.g. "Grand
                        // Central") as the property's display name when
                        // Google identifies one. Otherwise fall back to
                        // the formatted address so we never end up with
                        // a blank name.
                        if (result?.placeName) {
                          updates.name = result.placeName;
                        } else if (result?.formatted) {
                          updates.name = result.formatted;
                        }
                        updateMutation.mutate(updates, { onSuccess: () => setEditingAddress(false) });
                      }}
                      placeholder="Search for an address..."
                    />
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setEditingAddress(false)} data-testid="button-cancel-address">
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <h1
                    className="text-lg font-bold cursor-pointer hover:text-muted-foreground transition-colors"
                    onClick={() => setEditingAddress(true)}
                    data-testid="text-property-name"
                  >
                    {property.name}
                  </h1>
                  {formatAddress(property.address) && (() => {
                    const mapsUrl = buildGoogleMapsUrl(property.address);
                    return mapsUrl ? (
                      <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" data-testid="link-property-map">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    ) : null;
                  })()}
                  {(property.status === "Leasing Instruction" || property.status === "Lease Advisory Instruction" || property.status === "Sales Instruction") && (
                    <Badge variant="outline" className={`text-[10px] ${property.status === "Sales Instruction" ? "border-emerald-500 text-emerald-600" : property.status === "Lease Advisory Instruction" ? "border-violet-500 text-violet-600" : "border-blue-500 text-blue-600"}`} data-testid="badge-instruction-type">
                      {property.status}
                    </Badge>
                  )}
                  {property.groupName && (
                    <Badge variant="outline" className="text-[10px]" data-testid="badge-property-group">{property.groupName}</Badge>
                  )}
                  {(() => {
                    if (!property.createdAt) return null;
                    const ageMs = Date.now() - new Date(property.createdAt).getTime();
                    const isRecent = ageMs < 5 * 60 * 1000;
                    const hasEnrichmentData = !!(property.proprietorName || property.landlordId || property.titleNumber);
                    if (isRecent && !hasEnrichmentData && property.address) {
                      return (
                        <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-600 bg-purple-50 animate-pulse gap-1" data-testid="badge-enriching">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          Auto-enriching...
                        </Badge>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <Link href={`/image-studio?property=${encodeURIComponent(property.name)}&address=${encodeURIComponent(formatAddress(property.address) || property.name)}&propertyId=${encodeURIComponent(property.id)}`}>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="button-image-studio">
                    <ImageIcon className="w-3.5 h-3.5" />
                    Image Studio
                  </Button>
                </Link>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setFolderDialogOpen(true)} data-testid="button-setup-folders">
                  <FolderTree className="w-3.5 h-3.5" />
                  Set Up Folders
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => { if (confirm("Are you sure you want to delete this property?")) deleteMutation.mutate(); }}
                  disabled={deleteMutation.isPending}
                  data-testid="button-delete-property"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Top-row strip: property summary card on the left,
                latest property news on the right (lg+). News gets
                more breathing room than 50/50 — typical news
                content (image + 3-4 headlines) wants a wider column.
                Stacks 1-col on smaller screens. */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3">
              {/* Left column stack: Asset Owner card + Weekly Focus
                  beneath. Same width as Asset Owner; mirrors the
                  News + Brochures stack on the right so both columns
                  feel balanced. */}
              <div className="space-y-3">
              <Card>
                <CardContent className="p-3 space-y-2">
                  {/* Property covering strip — Asset Owner + Asset
                      Lead + Last activity packed into a single tight
                      row at the top of the card. */}
                  <div className="pb-2 border-b">
                    <PropertyCoveringStrip propertyId={property.id} />
                  </div>

                  {/* Top strip — 4 cells, one field each. Tenure
                      removed. Sq Ft + Competitor Agent moved to a
                      dedicated 'Area & agent' row below Ownership
                      so the bottom of the card isn't empty. */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                    <div>
                      <p className="text-[10px] text-muted-foreground leading-tight mb-0.5">Status</p>
                      <InlineLabelSelect value={property.status} options={STATUS_OPTIONS} colorMap={PROPERTY_STATUS_COLORS} onSave={(val) => inlineUpdate("status", val)} placeholder="Set status" />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground leading-tight mb-0.5">Asset Class</p>
                      <InlineLabelSelect value={Array.isArray(property.assetClass) ? property.assetClass[0] : property.assetClass} options={ASSET_CLASS_OPTIONS} colorMap={ASSET_CLASS_COLORS} onSave={(val) => inlineUpdate("assetClass", val)} placeholder="Set class" />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground leading-tight mb-0.5">Team</p>
                      <InlineEngagement value={property.bgpEngagement} options={TEAM_OPTIONS} colorMap={TEAM_COLORS} onSave={(val) => inlineUpdate("bgpEngagement", val)} />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground leading-tight mb-0.5">Website</p>
                      <InlineText value={property.website || ""} onSave={(val) => inlineUpdate("website", val)} placeholder="Set website" className="text-sm truncate" />
                    </div>
                  </div>

                {(() => {
                  // Only render ownership rows that have a value
                  // assigned. Empty placeholders ("+ Long Leaseholder",
                  // "+ Junior Lender") chewed up vertical space on
                  // properties where most ownership slots are blank.
                  // A single "+ Add owner" affordance at the end keeps
                  // adding new entries one click away.
                  const allRows = [
                    { label: "Freeholder",       field: "freeholderId",      id: (property as any).freeholderId },
                    { label: "Long Leaseholder", field: "longLeaseholderId", id: (property as any).longLeaseholderId },
                    { label: "Senior Lender",    field: "seniorLenderId",    id: (property as any).seniorLenderId },
                    { label: "Junior Lender",    field: "juniorLenderId",    id: (property as any).juniorLenderId },
                  ];
                  const filled = allRows.filter(r => !!r.id);
                  const empty = allRows.filter(r => !r.id);
                  return (
                    <div className="border-t pt-2">
                      <p className="text-[10px] text-muted-foreground leading-tight mb-1.5 flex items-center gap-1">
                        <Landmark className="w-3 h-3" /> Ownership
                      </p>
                      {filled.length === 0 && empty.length > 0 ? (
                        // No ownership recorded yet — show one inline
                        // row to start with (Freeholder) so the team
                        // can click to add without an extra step.
                        <div className="grid grid-cols-[90px,1fr] items-center gap-2 text-[11px]">
                          <span className="text-muted-foreground leading-tight truncate">{empty[0].label}</span>
                          <div className="min-w-0">
                            <InlineOwnerLink propertyId={id} companyId={empty[0].id} fieldName={empty[0].field} label={empty[0].label} allCompanies={allCompanies} />
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                          {filled.map(row => (
                            <div key={row.field} className="grid grid-cols-[90px,1fr] items-center gap-2">
                              <span className="text-muted-foreground leading-tight truncate">{row.label}</span>
                              <div className="min-w-0">
                                <InlineOwnerLink propertyId={id} companyId={row.id} fieldName={row.field} label={row.label} allCompanies={allCompanies} />
                              </div>
                            </div>
                          ))}
                          {empty.length > 0 && (
                            // One affordance to add the next missing
                            // slot. The InlineOwnerLink itself renders
                            // a "+ Add" UI when companyId is null, so
                            // we just show the first empty row here.
                            <div className="grid grid-cols-[90px,1fr] items-center gap-2">
                              <span className="text-muted-foreground leading-tight truncate">{empty[0].label}</span>
                              <div className="min-w-0">
                                <InlineOwnerLink propertyId={id} companyId={empty[0].id} fieldName={empty[0].field} label={empty[0].label} allCompanies={allCompanies} />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Area + Competitor Agent — fills the bottom of the
                    card. Sq Ft and the competitor-agent picker sit
                    side-by-side. Competitor agent links to a
                    crm_companies row (company_type='Agent') with an
                    inline 'Add new agent' shortcut. */}
                <div className="border-t pt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-tight mb-0.5">Area</p>
                    <InlineNumber value={property.sqft} onSave={(val) => inlineUpdate("sqft", val)} suffix=" sf" className="text-sm font-mono font-medium" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <p className="text-[10px] text-muted-foreground leading-tight">Competitor Agent</p>
                      {property.competitorAgentStatus === "active" && property.competitorAgentInstructedAt && (
                        Date.now() - new Date(property.competitorAgentInstructedAt).getTime() > 365 * 864e5 ? (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 border-orange-300 text-orange-600">stale</Badge>
                        ) : null
                      )}
                    </div>
                    <InlineCompetitorAgent
                      propertyId={id}
                      competitorAgentId={(property as any).competitorAgentId}
                      competitorAgent={property.competitorAgent}
                      allCompanies={allCompanies}
                    />
                  </div>
                </div>

                </CardContent>
              </Card>
              {/* Weekly Focus — same width as Asset Owner. Lives in
                  the left column stack so leasing context (news,
                  brochures) and operational context (tasks) sit on
                  their respective sides of the row. */}
              <ErrorBoundary compact name="Weekly focus">
                <WeeklyFocusCard propertyId={property.id} />
              </ErrorBoundary>
              </div>

              {/* Property news + Brochures stacked in the right
                  column — each half the height of the property info
                  card on the left. Brochures pulls from the property's
                  SharePoint folder, leasing/investment toggle, click
                  to pop out full screen. */}
              <div className="space-y-3">
                <Card>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Newspaper className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs font-semibold">Property News</span>
                    </div>
                    <ErrorBoundary compact name="Property news (top-strip preview)">
                      <PropertyNewsPanel propertyId={property.id} propertyName={property.name} />
                    </ErrorBoundary>
                  </CardContent>
                </Card>
                <ErrorBoundary compact name="Property brochures">
                  <PropertyBrochuresPanel propertyId={property.id} />
                </ErrorBoundary>
              </div>
            </div>

            {/* Risk + Brand Gap — two compact cards side-by-side
                under the top strip. Weekly Focus moved into the left
                column above (under Asset Owner) so this row is
                operational risk + leasing context. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ErrorBoundary compact name="Risk register">
                <RiskRegisterCard propertyId={property.id} />
              </ErrorBoundary>
              <ErrorBoundary compact name="Brand gap">
                <CollapsibleCard open={mainSections.brands} onToggle={() => toggleMain("brands")} icon={Building2} title="Brand Gap" testId="toggle-brands">
                  <BrandGapPanel propertyId={property.id} />
                </CollapsibleCard>
              </ErrorBoundary>
            </div>

            {/* Pipeline + Performance combined — single 'how's the
                building doing' tile that sits above Plans, giving
                the asset lead a snapshot before they scroll into
                the schedules. */}
            <ErrorBoundary compact name="Pipeline & performance">
              <PipelinePerformanceBoard propertyId={property.id} />
            </ErrorBoundary>

            {/* Compliance & KYC now lives in the right sidebar as a
                dropdown section (see below) — closer to where the asset
                lead toggles other reference cards (Files, BGP Contacts,
                Available Units etc.). */}

            {/* Asset Brief — structured client-facing dashboard.
                Replaces the old free-text Notes blob with a live
                working board (header / focus / pipeline / deals /
                activity / risks / performance). Notes still exists
                as a free-form 'Asset Lead commentary' bucket inside
                the brief but isn't rendered here as its own card. */}
            <ErrorBoundary compact name="Property asset brief">
              <PropertyAssetBriefPanel propertyId={property.id} />
            </ErrorBoundary>

            {/* BGP Commentary — purple AI card. Pulls commentary
                + last-generated timestamp from the asset-brief
                payload and renders the same purple treatment used
                on the brand profile's brand_analysis. */}
            <BgpCommentaryWrapper propertyId={property.id} />

            {streetViewExpanded ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <StreetViewSection
                  address={formatAddress(property.address) || property.name}
                  propertyId={property.id}
                  onClose={() => setStreetViewExpanded(false)}
                />
                <div className="rounded-lg border bg-card p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Images</span>
                  </div>
                  <EntityImagesPanel entityType="property" entityId={property.id} />
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs" onClick={() => setStreetViewExpanded(true)} data-testid="button-expand-street-view">
                <ImageIcon className="w-3.5 h-3.5" />
                Show Street View
              </Button>
            )}

            {/* LeasingTrackerSummary removed — its counts (available /
                under-offer / let / viewings / offers) duplicate what's
                already visible per unit on the Leasing Schedule below.
                The deal-CRM letting-tracker function it sourced from
                (available_units) is untouched. */}

            <ErrorBoundary compact name="Property plans">
              <CollapsibleCard open={mainSections.plans} onToggle={() => toggleMain("plans")} icon={MapIcon} title="Plans" testId="toggle-plans">
                <PropertyPlansPanel propertyId={property.id} />
              </CollapsibleCard>
            </ErrorBoundary>

            <CollapsibleCard open={mainSections.leasingSchedule} onToggle={() => toggleMain("leasingSchedule")} icon={CalendarIcon} title="Leasing Schedule" testId="toggle-leasing-schedule">
              <div className="max-h-[640px] overflow-y-auto pr-1">
                <PropertyLeasingSchedule propertyId={property.id} />
              </div>
            </CollapsibleCard>

            <ErrorBoundary compact name="Tenancy schedule">
              <CollapsibleCard open={mainSections.tenancy} onToggle={() => toggleMain("tenancy")} icon={Users} title="Tenancy Schedule" testId="toggle-tenancy">
                <div className="max-h-[640px] overflow-y-auto pr-1">
                  <PropertyTenancySchedule propertyId={property.id} />
                </div>
              </CollapsibleCard>
            </ErrorBoundary>

            <ErrorBoundary compact name="Pathway intel strip">
              <CollapsibleCard open={mainSections.pathway} onToggle={() => toggleMain("pathway")} icon={TrendingUp} title="Pathway Intel" testId="toggle-pathway">
                <PathwayIntelStrip
                  propertyId={property.id}
                  address={typeof property.address === "string" ? property.address : (property.address as any)?.line1 || property.name}
                  postcode={(property as any).postcode || (property.address as any)?.postcode}
                />
              </CollapsibleCard>
            </ErrorBoundary>

            {/* KYC panel removed from the main column — it lives in
                the right sidebar's Compliance & KYC dropdown so the
                board isn't duplicated. */}

            {/* Property Intelligence + Leasing Pitch are pre-instruction
                 tools (catchment / Land Registry research; brand pitch
                 to landlords we don't yet act for). Once the property
                 is on any kind of instruction (Leasing / Lease
                 Advisory / Sales / generic 'BGP Instruction') we're
                 past pitching, into delivery — hide both so the page
                 focuses on the operational view. */}
            {!/instruction/i.test(property.status || "") && (
              <>
                <ErrorBoundary compact name="Property intelligence (Land Registry / planning)">
                  <CollapsibleCard open={mainSections.intel} onToggle={() => toggleMain("intel")} icon={Landmark} title="Property Intelligence" testId="toggle-intel">
                    <PropertyIntelligencePanel property={property} />
                  </CollapsibleCard>
                </ErrorBoundary>

                <ErrorBoundary compact name="Leasing pitch">
                  <CollapsibleCard open={mainSections.pitch} onToggle={() => toggleMain("pitch")} icon={Sparkles} title="Leasing Pitch" testId="toggle-pitch">
                    <LeasingPitchPanel propertyId={property.id} />
                  </CollapsibleCard>
                </ErrorBoundary>
              </>
            )}

            {/* Brand Gap moved to the top of the main column (above
                Pipeline & Performance) — leasing context leads. */}

            {/* Property News card moved into the top-strip half-width
                slot (see above). Lower full-width card removed to
                avoid rendering the feed twice on the same page. */}

            <ErrorBoundary compact name="Linked contacts">
              <CollapsibleCard open={mainSections.contacts} onToggle={() => toggleMain("contacts")} icon={UserCheck} title="Linked Contacts" testId="toggle-contacts">
                <LinkedContactsPanel propertyId={property.id} />
              </CollapsibleCard>
            </ErrorBoundary>

            <div className="md:hidden space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <PropertyFoldersPanel propertyName={property.name} folderTeams={property.folderTeams} sharepointFolderUrl={property.sharepointFolderUrl} />
                <LinkedDealsPanel propertyId={property.id} />
              </div>
              <Card>
                <CardContent className="p-4 space-y-1">
                  <p className="text-xs text-muted-foreground">BGP Contacts</p>
                  <InlineAgents propertyId={id} agentLinks={agentLinks} allUsers={allUsers} colorMap={userColorMap} landlordId={property.landlordId} />
                </CardContent>
              </Card>
              <ClientBoardPanel propertyId={property.id} landlordId={property.landlordId} allCompanies={allCompanies} />
              <Card>
                <CardContent className="p-4 space-y-1">
                  <p className="text-xs text-muted-foreground">WIP</p>
                  <InlineDeals propertyId={id} dealLinks={dealLinks} allDeals={allDealsForDetail} />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Right sidebar = property metadata pane. The gutter
            against the global ChatBGP dock now comes from the chat
            panel itself (md:ml-3), so any page that has its own
            right-edge content benefits — not just this one. */}
        <div className="w-[320px] border-l bg-background flex flex-col shrink-0 h-full overflow-hidden hidden xl:flex">
          <ScrollArea className="flex-1">
            <div className="px-4 pt-4 pb-3 border-b">
              <div className="flex items-start gap-3">
                {(() => {
                  const landlordForLogo = property.landlordId ? allCompanies.find(c => c.id === property.landlordId) : null;
                  return landlordForLogo ? (
                    <CompanyLogoImg domain={landlordForLogo.domainUrl || landlordForLogo.domain} name={landlordForLogo.name} size={36} />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-4.5 h-4.5 text-primary" />
                    </div>
                  );
                })()}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold leading-tight truncate">{property.name}</h3>
                  {formatAddress(property.address) && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 shrink-0" />
                      {formatAddress(property.address)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {property.status && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[10px] font-medium">
                    {property.status}
                  </span>
                )}
                {property.assetClass && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[10px] font-medium">
                    {property.assetClass}
                  </span>
                )}
                {property.sqft && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium">
                    {Number(property.sqft).toLocaleString()} sq ft
                  </span>
                )}
                {property.tenure && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium">
                    {property.tenure}
                  </span>
                )}
                {property.bgpEngagement && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 text-[10px] font-medium">
                    {property.bgpEngagement}
                  </span>
                )}
              </div>
              <Link
                href="/chatbgp"
                className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity justify-center"
                data-testid="button-open-property-chat"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Chat about this property
              </Link>
            </div>

            <div className="border-b">
              <button onClick={() => toggleSection("files")} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors" data-testid="toggle-files-section">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Files</span>
                </div>
                {sidebarSections.files ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
              {sidebarSections.files && (
                <div className="px-4 pb-3 space-y-3">
                  <PropertyFoldersPanel propertyName={property.name} folderTeams={property.folderTeams} sharepointFolderUrl={property.sharepointFolderUrl} />
                  <PropertySharepointLink propertyId={property.id} sharepointFolderUrl={property.sharepointFolderUrl} onUpdate={inlineUpdate} />
                </div>
              )}
            </div>

            {/* Compliance & KYC — billing entity + owner brand checks
                (UK trading entity, accounts PDF, annual report PDF,
                officers + PSCs, Red Flag, AML PEP). Single source of
                truth lives in brand-profile-panel's ComplianceBoard;
                we embed it here so the asset lead can flip checks
                without leaving the property page. */}
            <div className="border-b">
              <button onClick={() => toggleSection("compliance")} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors" data-testid="toggle-compliance-section">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Compliance &amp; KYC</span>
                </div>
                {sidebarSections.compliance ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
              {sidebarSections.compliance && (
                <div className="px-4 pb-3">
                  <ErrorBoundary compact name="Property compliance & KYC">
                    <PropertyComplianceBoardWrapper property={property} allCompanies={allCompanies} embedded />
                  </ErrorBoundary>
                </div>
              )}
            </div>

            {/* Recent activity — moved out of the main column. Same
                sanitised summaries (no email body content) so
                client users like Mark see headline touches without
                content leakage. */}
            <div className="border-b">
              <button onClick={() => toggleSection("activity")} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors" data-testid="toggle-activity-section">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Recent activity</span>
                  <Badge variant="secondary" className="text-[10px]">14d</Badge>
                </div>
                {sidebarSections.activity ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
              {sidebarSections.activity && (
                <div className="px-4 pb-3">
                  <ErrorBoundary compact name="Property recent activity">
                    <PropertyRecentActivityCard propertyId={property.id} />
                  </ErrorBoundary>
                </div>
              )}
            </div>

            {/* Linkage audit — diagnostic of what's actually hooked
                up. Surfaces 'landlord orphans' (deals tagged to the
                landlord but not the property), schedule units
                missing from property_units, tenants on the schedule
                not yet matched to a CRM company. Red numbers =
                data needing fixing. */}
            <div className="border-b">
              <button onClick={() => toggleSection("linkage")} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors" data-testid="toggle-linkage-section">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Data linkage</span>
                </div>
                {sidebarSections.linkage ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
              {sidebarSections.linkage && (
                <div className="px-4 pb-3">
                  <ErrorBoundary compact name="Property linkage audit">
                    <PropertyLinkageCard propertyId={property.id} />
                  </ErrorBoundary>
                </div>
              )}
            </div>

            <div className="border-b">
              <button onClick={() => toggleSection("team")} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors" data-testid="toggle-team-section">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">BGP Contacts</span>
                </div>
                {sidebarSections.team ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
              {sidebarSections.team && (
                <div className="px-4 pb-3">
                  <InlineAgents propertyId={id} agentLinks={agentLinks} allUsers={allUsers} colorMap={userColorMap} landlordId={property.landlordId} />
                </div>
              )}
            </div>

            <div className="border-b">
              <button onClick={() => toggleSection("clients")} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors" data-testid="toggle-clients-section">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Client Board</span>
                </div>
                {sidebarSections.clients ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
              {sidebarSections.clients && (
                <div className="px-4 pb-3">
                  <ClientBoardPanel propertyId={property.id} landlordId={property.landlordId} allCompanies={allCompanies} />
                </div>
              )}
            </div>

            <div className="border-b">
              <button onClick={() => toggleSection("deals")} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors" data-testid="toggle-deals-section">
                <div className="flex items-center gap-2">
                  <Handshake className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Deals</span>
                </div>
                {sidebarSections.deals ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
              {sidebarSections.deals && (
                <div className="px-4 pb-3 space-y-2">
                  <LinkedDealsPanel propertyId={property.id} />
                </div>
              )}
            </div>

            <div className="border-b">
              <button onClick={() => toggleSection("availableUnits")} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors" data-testid="toggle-available-units-section">
                <div className="flex items-center gap-2">
                  <Store className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Available Units</span>
                </div>
                {sidebarSections.availableUnits ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
              {sidebarSections.availableUnits && (
                <div className="px-4 pb-3">
                  <AvailableUnitsPanel propertyId={property.id} />
                </div>
              )}
            </div>

            <div className="border-b">
              <button onClick={() => toggleSection("landRegistry")} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors" data-testid="toggle-land-registry-section">
                <div className="flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Land Registry</span>
                </div>
                {sidebarSections.landRegistry ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
              {sidebarSections.landRegistry && (
                <div className="px-4 pb-3">
                  <LinkedLandRegistryPanel propertyId={property.id} />
                </div>
              )}
            </div>

          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

// ── Available Units panel for the property sidebar ──────────────────────────
// Shows units from the Letting Tracker that are anchored to this property,
// with their status, asking rent and a click-through to the linked deal.
interface AvailableUnitRow {
  id: string;
  unitName: string;
  marketingStatus: string | null;
  askingRent: number | null;
  sqft: number | null;
  dealId: string | null;
  dealRef: string | null;
}
function AvailableUnitsPanel({ propertyId }: { propertyId: string }) {
  const { data: units = [], isLoading } = useQuery<AvailableUnitRow[]>({
    queryKey: ["/api/available-units", { propertyId }],
    queryFn: async () => {
      const r = await fetch(`/api/available-units?propertyId=${encodeURIComponent(propertyId)}`, { credentials: "include" });
      if (!r.ok) throw new Error("failed to load units");
      return r.json();
    },
  });

  if (isLoading) {
    return <div className="space-y-1.5">{[1, 2].map(i => <Skeleton key={i} className="h-12" />)}</div>;
  }
  if (units.length === 0) {
    return (
      <div className="text-center py-4">
        <Store className="w-7 h-7 mx-auto mb-1.5 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">No units on the Letting Tracker yet</p>
        <a href={`/deals/letting?propertyId=${propertyId}`} className="text-[11px] text-blue-600 hover:underline mt-1 inline-block">
          Add unit →
        </a>
      </div>
    );
  }
  return (
    <div className="space-y-1.5" data-testid="available-units-panel">
      {units.map(u => (
        <div key={u.id} className="flex items-center justify-between gap-2 p-2 rounded border bg-card hover:bg-muted/40">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{u.unitName || "—"}</div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {u.marketingStatus && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{u.marketingStatus}</Badge>}
              {u.sqft && <span>{u.sqft.toLocaleString()} sqft</span>}
              {u.askingRent && <span>£{u.askingRent.toLocaleString()}</span>}
            </div>
          </div>
          {u.dealId && (
            <a
              href={`/deals/${u.dealId}`}
              className="text-[11px] font-mono text-blue-600 hover:underline shrink-0"
              title="Open deal"
            >
              {u.dealRef ? `#${u.dealRef}` : "Deal →"}
            </a>
          )}
        </div>
      ))}
      <a href={`/deals/letting?propertyId=${propertyId}`} className="text-[11px] text-blue-600 hover:underline block pt-1">
        Open in Letting Tracker →
      </a>
    </div>
  );
}

// ── Entity images panel ─────────────────────────────────────────────────────
// Drop-zone for photos + Street View captures, plus a thumbnail grid. Same
// component serves property / unit / deal — pass entityType + entityId.
interface EntityImageRow {
  id: string;
  entity_type: string;
  entity_id: string;
  file_id: string;
  image_studio_id: string | null;
  kind: string | null;
  title: string | null;
  notes: string | null;
  created_at: string;
  created_by_name: string | null;
  mime_type: string | null;
}
function EntityImagesPanel({ entityType, entityId }: { entityType: "property" | "unit" | "deal"; entityId: string }) {
  const { toast } = useToast();
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [aiEditFor, setAiEditFor] = useState<EntityImageRow | null>(null);
  const [aiEditPrompt, setAiEditPrompt] = useState("");
  const [imageVersion, setImageVersion] = useState(0); // cache-buster — bumps after AI edit / revert so the preview reloads
  const [canRevert, setCanRevert] = useState(false);   // last edit produced an undo snapshot we can roll back to

  const { data: images = [], isLoading } = useQuery<EntityImageRow[]>({
    queryKey: ["/api/entity-images", entityType, entityId],
    queryFn: async () => {
      const r = await fetch(`/api/entity-images?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const uploadFile = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("entityType", entityType);
    fd.append("entityId", entityId);
    fd.append("kind", "photo");
    const r = await fetch("/api/entity-images", { method: "POST", body: fd, credentials: "include" });
    if (!r.ok) throw new Error(await r.text());
  };

  const uploadMutation = useMutation({
    mutationFn: async (files: FileList) => {
      const list = Array.from(files).filter(f => /^image\//.test(f.type));
      for (const f of list) await uploadFile(f);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/entity-images", entityType, entityId] });
      toast({ title: "Image saved" });
    },
    onError: (err: any) => toast({ title: "Upload failed", description: err?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/entity-images/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/entity-images", entityType, entityId] }),
  });

  const aiEditMutation = useMutation({
    mutationFn: async ({ id, prompt }: { id: string; prompt: string }) => {
      const r = await fetch(`/api/entity-images/${id}/ai-edit`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ editPrompt: prompt }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "AI edit failed");
    },
    onSuccess: () => {
      // Stay open so the user sees the new version. Bump cache-buster so the
      // <img> reloads, enable Undo (Image Studio's ai-edit always writes a
      // revert snapshot), clear the prompt for the next iteration.
      queryClient.invalidateQueries({ queryKey: ["/api/entity-images", entityType, entityId] });
      setImageVersion(v => v + 1);
      setCanRevert(true);
      setAiEditPrompt("");
      toast({ title: "Image edited" });
    },
    onError: (err: any) => toast({ title: "Edit failed", description: err?.message, variant: "destructive" }),
  });

  const revertMutation = useMutation({
    mutationFn: async (entityImageId: string) => {
      const r = await fetch(`/api/entity-images/${entityImageId}/revert`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Revert failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/entity-images", entityType, entityId] });
      setImageVersion(v => v + 1);
      setCanRevert(false);
      toast({ title: "Reverted to previous version" });
    },
    onError: (err: any) => toast({ title: "Revert failed", description: err?.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2" data-testid="entity-images-panel">
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) uploadMutation.mutate(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-md p-3 text-center text-xs cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground/60"}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files && e.target.files.length > 0) uploadMutation.mutate(e.target.files); }}
        />
        {uploadMutation.isPending ? "Uploading…" : "Drop images here or click to upload"}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-1.5">{[1, 2, 3].map(i => <Skeleton key={i} className="aspect-square" />)}</div>
      ) : images.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">No images yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {images.map(img => (
            <button
              key={img.id}
              type="button"
              onClick={() => { setAiEditFor(img); setAiEditPrompt(""); }}
              className="relative group aspect-square rounded overflow-hidden border bg-muted text-left"
              data-testid={`entity-image-${img.id}`}
              title="Click to preview & AI edit"
            >
              <img
                src={`/api/entity-images/${img.id}/file`}
                alt={img.title || "image"}
                className="w-full h-full object-cover"
              />
              <button
                onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(img.id); }}
                className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete"
              >
                <X className="w-3 h-3" />
              </button>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!aiEditFor} onOpenChange={(o) => { if (!o) { setAiEditFor(null); setCanRevert(false); setImageVersion(0); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-purple-500" /> {aiEditFor?.title || "Image"}</DialogTitle>
            <DialogDescription>Preview and AI-edit. Edits write back to this image (and into Image Studio).</DialogDescription>
          </DialogHeader>
          {aiEditFor && (
            <div className="space-y-3">
              <img
                src={`/api/entity-images/${aiEditFor.id}/file?v=${imageVersion}`}
                alt={aiEditFor.title || ""}
                className="w-full max-h-[60vh] object-contain rounded border bg-muted"
                key={imageVersion}
              />
              {aiEditFor.image_studio_id ? (
                <>
                  <div>
                    <Label className="text-xs">AI Edit prompt</Label>
                    <Input
                      value={aiEditPrompt}
                      onChange={e => setAiEditPrompt(e.target.value)}
                      placeholder="e.g. blue sky, sunny day, remove pedestrians, add awnings…"
                      autoFocus
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Quick prompts: "remove watermark", "brighten sky", "marketing-ready", "sharpen building", "remove car".
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground italic">
                  AI edit is only available for images captured via Street View or Image Studio. Drag-and-drop uploads can be replaced via delete + re-upload.
                </p>
              )}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => aiEditFor && window.open(`/api/entity-images/${aiEditFor.id}/file`, "_blank")}
            >
              Download
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => { if (aiEditFor) { deleteMutation.mutate(aiEditFor.id); setAiEditFor(null); } }}
            >
              <X className="w-3 h-3 mr-1" /> Delete
            </Button>
            {canRevert && aiEditFor?.image_studio_id && (
              <Button
                variant="outline"
                onClick={() => aiEditFor && revertMutation.mutate(aiEditFor.id)}
                disabled={revertMutation.isPending}
                title="Roll back to the version before the last AI edit"
              >
                {revertMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ArrowLeft className="w-3 h-3 mr-1" />}
                Undo
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="outline" onClick={() => setAiEditFor(null)}>Close</Button>
            {aiEditFor?.image_studio_id && (
              <Button
                onClick={() => aiEditFor && aiEditMutation.mutate({ id: aiEditFor.id, prompt: aiEditPrompt })}
                disabled={!aiEditPrompt.trim() || aiEditMutation.isPending}
              >
                {aiEditMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                {aiEditMutation.isPending ? "Editing…" : "Apply AI Edit"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Google Street View Capture — embedded inline ────────────────────────────
// Mirrors the Image Studio capture dialog UI exactly (panorama + "Enhance
// with AI" checkbox + Save button) but rendered inline on the property page
// at ~max-w-3xl. Saves via /api/image-studio/capture-streetview (or
// /capture-and-enhance) with propertyId — the endpoint links into
// property_imagery_assets AND entity_images, so the new image appears on
// both the Image Studio library and the property's Images sidebar panel.
function StreetViewSection({ address, propertyId, onClose }: { address: string; propertyId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [pov, setPov] = useState({ heading: 0, pitch: 0, fov: 90 });
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [enhanceAi, setEnhanceAi] = useState(true);

  const captureMutation = useMutation({
    mutationFn: async () => {
      const endpoint = enhanceAi
        ? "/api/image-studio/capture-and-enhance"
        : "/api/image-studio/capture-streetview";
      const location = pos ? `${pos.lat},${pos.lng}` : address;
      const r = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          location,
          heading: pov.heading,
          pitch: pov.pitch,
          fov: pov.fov,
          area: address,
          propertyId,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/entity-images", "property", propertyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      toast({
        title: data?.enhanced ? "Captured & AI-enhanced" : "Captured",
        description: data?.enhanced ? "Saved raw + enhanced versions" : "Street View image saved",
      });
    },
    onError: (err: any) => toast({ title: "Capture failed", description: err?.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-lg border bg-card p-3 max-w-3xl space-y-3">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Google Street View Capture</span>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
          <X className="w-3 h-3 mr-1" /> Hide
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Drag the panorama to aim the camera, then save. We capture exactly the view you see.
      </p>
      <StreetViewPanoramaCapture
        address={address}
        onPovChange={setPov}
        onPositionChange={setPos}
      />
      <label className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm cursor-pointer">
        <Checkbox checked={enhanceAi} onCheckedChange={(c) => setEnhanceAi(!!c)} />
        <span>
          <span className="font-medium">Enhance with AI for marketing</span>
          <span className="block text-xs text-muted-foreground">
            Removes Google watermarks, improves lighting and sky, sharpens the building.
            Saves both raw and enhanced versions to the library.
          </span>
        </span>
      </label>
      <Button
        onClick={() => captureMutation.mutate()}
        className="w-full"
        disabled={captureMutation.isPending}
        data-testid="button-streetview-capture"
      >
        {captureMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
        {captureMutation.isPending ? "Capturing…" : enhanceAi ? "Save + AI Enhance" : "Save"}
      </Button>
    </div>
  );
}

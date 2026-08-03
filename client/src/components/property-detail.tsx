import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import PathwayIntelStrip from "@/components/pathway-intel-strip";
import { PropertyBrochuresPanel } from "@/components/property-brochures-panel";
import { PropertyDecksPanel } from "@/components/decks/property-decks-panel";
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
  FileText,
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
import { PropertyUnifiedSchedule } from "@/components/PropertyUnifiedSchedule";
import { PropertyPlansPanel } from "@/components/property-plans-panel";
import { BrandGapPanel } from "@/components/brand-gap-panel";
import { BrandComplianceCard } from "@/components/brand-profile-panel";
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
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
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
  InlineOwnerLink,
  InlineCompetitorAgent,
  InlineBillingEntity,
  SetUpFoldersDialog,
  PropertyFoldersPanel,
  PropertySharepointLink,
  LinkedDealsPanel, TaggedConversationsPanel,
  ClientBoardPanel,
  LinkedContactsPanel,
  PropertyIntelligencePanel,
  PropertyNewsPanel,
  LinkedLandRegistryPanel,
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
    <BrandComplianceCard
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
  badge,
  children,
  testId,
}: {
  open: boolean;
  onToggle: () => void;
  icon: any;
  title: string;
  badge?: string;
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
          {badge && <Badge variant="secondary" className="text-[10px] h-4 px-1">{badge}</Badge>}
        </div>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </Card>
  );
}

// Alias used for the folded-from-sidebar reference grid. Same component
// under the hood — but wraps the body in a fixed-height scrollable
// container so every reference board on the right column has the same
// outward size and only the body scrolls when content is taller.
function ReferenceSection(props: {
  open: boolean;
  onToggle: () => void;
  icon: any;
  title: string;
  badge?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <CollapsibleCard {...props}>
      <div className="max-h-[380px] overflow-y-auto -mx-3 px-3">
        {props.children}
      </div>
    </CollapsibleCard>
  );
}

export function PropertyDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  // Client logins (e.g. Landsec) get a read-only view — no BGP staff tools
  // (Image Studio, doc gen, folders, delete, KYC/risk/data-linkage panels).
  const { data: pdViewer } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  // Fail CLOSED while /api/auth/me loads, and match the server's wider
  // definition of a client (any non-BGP login gets companyScopeId) —
  // role === "Client" alone let mis-provisioned external users see the
  // full internal shell with every panel in a 403 error state.
  const isClientViewer = !pdViewer || pdViewer.role === "Client" || !!pdViewer.companyScopeId;
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
  useEffect(() => {
    if (property) {
      trackRecentItem({ id: property.id, type: "property", name: property.name || "Untitled Property", subtitle: property.status || undefined, team: (property as any).team || undefined });
    }
  }, [property?.id, property?.name, property?.status]);

  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [streetViewExpanded, setStreetViewExpanded] = useState(false);
  // Sidebar + main sections all open by default so nothing is hidden from
  // a first visit; users still collapse via the per-card toggle when they
  // want a tighter view. A few panels start collapsed because they're
  // typically empty until the property has had specific work done
  // (land-reg searches, image studio uploads, Pathway run).
  const [sidebarSections, setSidebarSections] = useState<Record<string, boolean>>({
    details: true,
    files: true,
    team: true,
    clients: true,
    contacts: true,
    deals: true,
    availableUnits: true,
    landRegistry: false,
    images: false,
    compliance: true,
    activity: true,
    linkage: true,
  });
  const toggleSection = (key: string) => setSidebarSections(prev => ({ ...prev, [key]: !prev[key] }));

  const [mainSections, setMainSections] = useState<Record<string, boolean>>({
    plans: true,
    leasingSchedule: true,
    tenancy: true,
    pathway: false,
    kyc: true,
    intel: true,
    pitch: true,
    brands: true,
    news: true,
    contacts: true,
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
      queryClient.invalidateQueries({ queryKey: ["/api/properties", id, "asset-brief"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties", id, "linkage-audit"] });
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
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {/* Single page-level scroll. A 2-col grid splits content from
            the reference stack: main content on the left, fixed-width
            sticky reference column on the right. Each reference board
            has its own max-height + internal overflow-y so the boards
            stay the same outward size and only their bodies scroll. */}
        <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_660px] gap-4 lg:gap-6 items-start">
          <div className="min-w-0 space-y-3">
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
                        // Mirror the structured fields Google gives us into the
                        // top-level columns too. The picker was only writing the
                        // `address` jsonb, so crm_properties.postcode/lat/lng
                        // stayed blank — which left the healthcheck, Brand Gap
                        // geocoder and exports thinking there was no postcode
                        // even though it was visible in the address string.
                        if (result?.postcode !== undefined) updates.postcode = result.postcode || null;
                        if (result?.lat !== undefined && result.lat !== null) updates.latitude = String(result.lat);
                        if (result?.lng !== undefined && result.lng !== null) updates.longitude = String(result.lng);
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
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400" data-testid="property-eyebrow">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" /> Property
                  </span>
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
                    if (isRecent && !hasEnrichmentData && property.address && !isClientViewer) {
                      return (
                        <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-600 bg-purple-50 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800 animate-pulse gap-1" data-testid="badge-enriching">
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
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => {
                    const prompt = `Tell me about ${property.name || "this property"} — occupancy, live deals, letting activity and anything notable in the CRM.`;
                    window.dispatchEvent(new CustomEvent("open-ai-chat-with-prompt", { detail: { prompt } }));
                  }}
                  data-testid="button-ask-ai-property"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Ask ChatBGP
                </Button>
                {!isClientViewer && (<>
                <Link href={`/image-studio?property=${encodeURIComponent(property.name)}&address=${encodeURIComponent(formatAddress(property.address) || property.name)}&propertyId=${encodeURIComponent(property.id)}`}>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="button-image-studio">
                    <ImageIcon className="w-3.5 h-3.5" />
                    Image Studio
                  </Button>
                </Link>
                <Link href={`/document-briefs?propertyId=${encodeURIComponent(property.id)}&propertyName=${encodeURIComponent(property.name)}&postcode=${encodeURIComponent(property.postcode || "")}`}>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="button-create-document">
                    <FileText className="w-3.5 h-3.5" />
                    Create document
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
                </>)}
              </div>
            </div>

            {/* Top-row strip: property summary card on the left,
                latest property news on the right (lg+). News gets
                more breathing room than 50/50 — typical news
                content (image + 3-4 headlines) wants a wider column.
                Stacks 1-col on smaller screens. */}
            {/* Top row splits Asset Owner+Weekly Focus | News+Risk at
                xl (1280px) instead of lg (1024px). At lg the main
                column is already sharing space with the 320px right
                aside, leaving ~700px to split — and nested grids
                inside (Status/Asset/Team/Website at 4-col) overflowed
                their cells. Single column at lg means each card gets
                full main-col width before the side-by-side kicks in. */}
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3">
              {/* Left column stack: Asset Owner card + Weekly Focus
                  beneath. h-full lets the grid cell stretch and the
                  inner flex-1 on Weekly Focus compute properly. */}
              <div className="flex flex-col gap-3 h-full min-h-0">
              <Card>
                <CardContent className="p-3 space-y-2">
                  {/* Property covering strip — Asset Owner + Asset
                      Lead + Last activity. BGP-internal coverage (and it
                      fires the staff-only linkage-audit), so staff-only. */}
                  {!isClientViewer && (
                  <div className="pb-2 border-b">
                    <PropertyCoveringStrip propertyId={property.id} />
                  </div>
                  )}

                  {/* Top strip — 4 cells, one field each. Tenure
                      removed. Sq Ft + Competitor Agent moved to a
                      dedicated 'Area & agent' row below Ownership
                      so the bottom of the card isn't empty. */}
                  {/* Status / Asset Class / Team / Website — kept at
                      2-col only. The previous 4-col upgrade fired on
                      viewport width but the actual Asset Owner card
                      is by design a narrow column (~280-340px in
                      the top-row split), so 4-col gave each pill
                      ~70px and 'BGP Instruction' truncated to 'B…'.
                      Two columns gives each pill ~140px which fits
                      every label comfortably. */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 min-w-0">
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground leading-tight mb-0.5">Status</p>
                      {isClientViewer ? <span className="text-sm">{property.status || "—"}</span> : <InlineLabelSelect value={property.status} options={STATUS_OPTIONS} colorMap={PROPERTY_STATUS_COLORS} onSave={(val) => inlineUpdate("status", val)} placeholder="Set status" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground leading-tight mb-0.5">Asset Class</p>
                      {isClientViewer ? <span className="text-sm">{(Array.isArray(property.assetClass) ? property.assetClass[0] : property.assetClass) || "—"}</span> : <InlineLabelSelect value={Array.isArray(property.assetClass) ? property.assetClass[0] : property.assetClass} options={ASSET_CLASS_OPTIONS} colorMap={ASSET_CLASS_COLORS} onSave={(val) => inlineUpdate("assetClass", val)} placeholder="Set class" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground leading-tight mb-0.5">BGP Team</p>
                      {isClientViewer ? <span className="text-sm">{Array.isArray(property.bgpEngagement) ? property.bgpEngagement.join(", ") : (property.bgpEngagement || "—")}</span> : <InlineEngagement value={property.bgpEngagement} options={TEAM_OPTIONS} colorMap={TEAM_COLORS} onSave={(val) => inlineUpdate("bgpEngagement", val)} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground leading-tight mb-0.5">Website</p>
                      {isClientViewer ? <span className="text-sm truncate block">{property.website || "—"}</span> : <InlineText value={property.website || ""} onSave={(val) => inlineUpdate("website", val)} placeholder="Set website" className="text-sm truncate block" />}
                    </div>
                  </div>

                {(() => {
                  // Only render ownership rows that have a value
                  // assigned. Empty placeholders ("+ Long Leaseholder",
                  // "+ Junior Lender") chewed up vertical space on
                  // properties where most ownership slots are blank.
                  // A single "+ Add owner" affordance at the end keeps
                  // adding new entries one click away.
                  // landlordId is the property-level "Client" — whoever BGP
                  // is working for on this asset. The deals board surfaces
                  // this implicitly via the deal-type → client-role logic
                  // (landlord on a New Letting, vendor on a Sale, etc.).
                  // At property level there's no deal type, so we expose
                  // it directly as Client / Landlord. Same company can
                  // sit in both the Freeholder + Client slots when the
                  // legal owner is the operator too.
                  const allRows = [
                    { label: "Client / Landlord", field: "landlordId",        id: (property as any).landlordId },
                    { label: "Freeholder",        field: "freeholderId",      id: (property as any).freeholderId },
                    { label: "Long Leaseholder",  field: "longLeaseholderId", id: (property as any).longLeaseholderId },
                    { label: "Senior Lender",     field: "seniorLenderId",    id: (property as any).seniorLenderId },
                    { label: "Junior Lender",     field: "juniorLenderId",    id: (property as any).juniorLenderId },
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
                        <div className="grid grid-cols-[130px,1fr] items-center gap-2 text-[11px]">
                          <span className="text-muted-foreground leading-tight truncate" title={empty[0].label}>{empty[0].label}</span>
                          <div className="min-w-0">
                            <InlineOwnerLink propertyId={id} companyId={empty[0].id} fieldName={empty[0].field} label={empty[0].label} allCompanies={allCompanies} readOnly={isClientViewer} />
                          </div>
                        </div>
                      ) : (
                        // Ownership rows always stacked vertically inside
                        // the Asset Owner card. Previously sm:grid-cols-2
                        // put two rows side-by-side, but the card is in a
                        // narrow grid cell — so each row got ~140px total,
                        // leaving only ~30px for the value column after
                        // the 130px label. Stack instead.
                        <div className="grid grid-cols-1 gap-y-1 text-[11px]">
                          {/* Clients see names only — the pickers depend on
                              the full company list (scope-limited for them)
                              and every save 403s, so editing renders as
                              broken "+ Add owner" affordances. */}
                          {filled.map(row => (
                            <div key={row.field} className="grid grid-cols-[130px,1fr] items-center gap-2">
                              <span className="text-muted-foreground leading-tight truncate" title={row.label}>{row.label}</span>
                              <div className="min-w-0">
                                {isClientViewer ? (
                                  <span className="truncate block">{allCompanies.find(c => c.id === row.id)?.name || "—"}</span>
                                ) : (
                                  <InlineOwnerLink propertyId={id} companyId={row.id} fieldName={row.field} label={row.label} allCompanies={allCompanies} readOnly={isClientViewer} />
                                )}
                              </div>
                            </div>
                          ))}
                          {empty.length > 0 && !isClientViewer && (
                            <div className="grid grid-cols-[130px,1fr] items-center gap-2">
                              <span className="text-muted-foreground leading-tight truncate" title={empty[0].label}>{empty[0].label}</span>
                              <div className="min-w-0">
                                <InlineOwnerLink propertyId={id} companyId={empty[0].id} fieldName={empty[0].field} label={empty[0].label} allCompanies={allCompanies} readOnly={isClientViewer} />
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
                    {isClientViewer ? <span className="text-sm font-mono font-medium">{property.sqft ? `${Number(property.sqft).toLocaleString()} sq ft` : "—"}</span> : <InlineNumber value={property.sqft} onSave={(val) => inlineUpdate("sqft", val)} suffix=" sf" className="text-sm font-mono font-medium" />}
                  </div>
                  {/* Competitor intel is BGP-internal — never shown to clients. */}
                  {!isClientViewer && (
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
                  )}
                </div>

                </CardContent>
              </Card>
              {/* Weekly Focus — same width as Asset Owner. flex-1
                  makes the card stretch to fill the leftover vertical
                  space in the column, so the right-hand News card
                  never has a white void beneath it. */}
              {/* Hidden for clients: the tasks GET is blocked for client
                  accounts, so the card showed empty while still accepting
                  input that silently vanished. */}
              {/* Clients see + edit the focus list on their own property —
                  board parity with the BGP view (Woody, 2026-08-03). */}
              <ErrorBoundary compact name="Weekly focus">
                <div className="flex-1 flex flex-col min-h-0 [&>div]:flex-1 [&>div]:flex [&>div]:flex-col">
                  <WeeklyFocusCard propertyId={property.id} />
                </div>
              </ErrorBoundary>
              </div>

              {/* Right column stack: News + Risk Register. Risk
                  Register sits up here so the operational watch list
                  is visible at a glance alongside the news ticker.
                  Brochures moved down to share a row with Brand Gap. */}
              <div className="flex flex-col gap-3 h-full min-h-0">
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
                <ErrorBoundary compact name="Risk register">
                  <div className="flex-1 min-h-[280px]">
                    <RiskRegisterCard propertyId={property.id} />
                  </div>
                </ErrorBoundary>
              </div>
            </div>

            {/* Brochures + Brand Gap — two side-by-side boards below
                the top strip. Brochures swapped down from the top-right
                slot; Risk Register went up so the operational watch
                list reads alongside the news ticker. */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <ErrorBoundary compact name="Property brochures">
                <PropertyBrochuresPanel propertyId={property.id} />
              </ErrorBoundary>
              {/* Property Decks panel hidden for the Monday demo —
                  feature not yet ready for the firm. See PRESENTATION_BACKLOG.md.
              <ErrorBoundary compact name="Property decks">
                <PropertyDecksPanel propertyId={property.id} />
              </ErrorBoundary>
              */}
              {/* Brand Gap renders for clients too — the server slices the
                  analysis to their brand categories + self-adds (Woody,
                  2026-08-03), so Landsec sees the hospitality/leisure view. */}
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
                the brief but isn't rendered here as its own card.
                The PropertyAssetBriefPanel shell was the original
                container; after the break-out it renders nothing
                visible, so it's no longer mounted.
            <ErrorBoundary compact name="Property asset brief">
              <PropertyAssetBriefPanel propertyId={property.id} />
            </ErrorBoundary>
            */}

            {/* BGP Commentary — purple AI card. Pulls commentary
                + last-generated timestamp from the asset-brief
                payload and renders the same purple treatment used
                on the brand profile's brand_analysis. */}
            <BgpCommentaryWrapper propertyId={property.id} />

            {isClientViewer ? null : streetViewExpanded ? (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-stretch">
                <StreetViewSection
                  address={formatAddress(property.address) || property.name}
                  propertyId={property.id}
                  onClose={() => setStreetViewExpanded(false)}
                />
                {/* h-full + flex so the card stretches to match the (taller)
                    Street View capture instead of leaving a dead gap. */}
                <div className="rounded-lg border bg-card p-3 h-full flex flex-col">
                  <div className="flex items-center gap-2 mb-2">
                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Images</span>
                  </div>
                  <div className="flex-1 min-h-0">
                    <EntityImagesPanel entityType="property" entityId={property.id} />
                  </div>
                  <BrandPipelineImagesLink propertyId={property.id} propertyName={property.name} />
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

            {/* Plans render for clients too — the GET is opened server-side
                for in-scope properties (board parity, Woody 2026-08-03). */}
            <ErrorBoundary compact name="Property plans">
              <CollapsibleCard open={mainSections.plans} onToggle={() => toggleMain("plans")} icon={MapIcon} title="Plans" testId="toggle-plans">
                <PropertyPlansPanel propertyId={property.id} />
              </CollapsibleCard>
            </ErrorBoundary>

            {/* Schedule — unified view (Lettings / Tenancy lens toggle)
                rendered for every property. Bluewater was the rollout
                test; verified, so the firm-wide flip is in. The
                `crm_properties.unified_schedule` column is now vestigial
                (kept for historical records; safe to drop in a future
                migration). PropertyTenancySchedule is the only board
                that reads tenancy_schedule_units, and the unit-mirror
                fan-out (server/unit-mirror.ts) already keeps the
                leasing_schedule_units + available_units projections in
                sync — so the lens toggle is purely a column-visibility
                preset, not a data switch. */}
            <ErrorBoundary compact name="Schedule">
              <CollapsibleCard open={mainSections.leasingSchedule} onToggle={() => toggleMain("leasingSchedule")} icon={CalendarIcon} title="Schedule" testId="toggle-schedule">
                <div className="max-h-[640px] overflow-y-auto pr-1">
                  <PropertyUnifiedSchedule propertyId={property.id} />
                </div>
              </CollapsibleCard>
            </ErrorBoundary>

            {!isClientViewer && (
            <ErrorBoundary compact name="Pathway intel strip">
              <CollapsibleCard open={mainSections.pathway} onToggle={() => toggleMain("pathway")} icon={TrendingUp} title="Pathway Intel" testId="toggle-pathway">
                <PathwayIntelStrip
                  propertyId={property.id}
                  address={typeof property.address === "string" ? property.address : (property.address as any)?.line1 || property.name}
                  postcode={(property as any).postcode || (property.address as any)?.postcode}
                />
              </CollapsibleCard>
            </ErrorBoundary>
            )}

            {/* KYC panel removed from the main column — it lives in
                the right sidebar's Compliance & KYC dropdown so the
                board isn't duplicated. */}

            {/* Property Intelligence is a pre-instruction tool (catchment /
                 Land Registry research). Once the property is on any kind of
                 instruction (Leasing / Lease Advisory / Sales / generic 'BGP
                 Instruction') we're past research, into delivery — hide it so
                 the page focuses on the operational view. */}
            {!/instruction/i.test(property.status || "") && (
              <ErrorBoundary compact name="Property intelligence (Land Registry / planning)">
                <CollapsibleCard open={mainSections.intel} onToggle={() => toggleMain("intel")} icon={Landmark} title="Property Intelligence" testId="toggle-intel">
                  <PropertyIntelligencePanel property={property} />
                </CollapsibleCard>
              </ErrorBoundary>
            )}

            {/* Brand Gap moved to the top of the main column (above
                Pipeline & Performance) — leasing context leads. */}

            {/* Property News card moved into the top-strip half-width
                slot (see above). Lower full-width card removed to
                avoid rendering the feed twice on the same page. */}

            {/* Linked Contacts moved into the right sidebar under
                Client Board so the main column reads property → deals
                → marketing rather than "client people" twice. */}
          </div>

          {/* Right column = reference stack. Single-column on the right
              side of the 2-col page grid. Each ReferenceSection has a
              fixed max-height + internal overflow so the boards stay
              the same outward size and only their contents scroll. The
              column itself is sticky so it stays visible as you scroll
              through the (longer) left column. */}
          {/* On very wide screens the reference stack doubles to two
              columns (sidebar widens to 660px) so related boards sit
              side by side half-width instead of one long strip —
              Files+Contacts, Compliance+Activity, BGP Contacts+Client
              Board, Deals+Units (Woody, 2026-07-30). */}
          <aside className="space-y-3 2xl:space-y-0 2xl:grid 2xl:grid-cols-2 2xl:gap-3 2xl:items-start lg:sticky lg:top-4 self-start">
              {/* SharePoint is fully sealed for client accounts — the
                  panel could only ever render dead Upload/Delete buttons
                  over a 403, so it's staff-only. */}
              {!isClientViewer && (
              <ReferenceSection
                title="Files"
                icon={FolderOpen}
                open={sidebarSections.files}
                onToggle={() => toggleSection("files")}
                testId="toggle-files-section"
              >
                <PropertyFoldersPanel propertyName={property.name} folderTeams={property.folderTeams} sharepointFolderUrl={property.sharepointFolderUrl} />
                <PropertySharepointLink propertyId={property.id} sharepointFolderUrl={property.sharepointFolderUrl} onUpdate={inlineUpdate} />
              </ReferenceSection>
              )}

              <ReferenceSection
                title="Linked Contacts"
                icon={UserCheck}
                open={sidebarSections.contacts}
                onToggle={() => toggleSection("contacts")}
                testId="toggle-contacts-section"
              >
                <LinkedContactsPanel propertyId={property.id} />
              </ReferenceSection>

              {/* Visible to clients — same decision as the brand-profile
                  KYC panel (landlords need tenant AML/financial standing). */}
              <ReferenceSection
                title="Compliance & KYC"
                icon={ShieldCheck}
                open={sidebarSections.compliance}
                onToggle={() => toggleSection("compliance")}
                testId="toggle-compliance-section"
              >
                <ErrorBoundary compact name="Property compliance & KYC">
                  <PropertyComplianceBoardWrapper property={property} allCompanies={allCompanies} embedded />
                </ErrorBoundary>
              </ReferenceSection>

              <ReferenceSection
                title="Recent activity"
                icon={Activity}
                badge="14d"
                open={sidebarSections.activity}
                onToggle={() => toggleSection("activity")}
                testId="toggle-activity-section"
              >
                <ErrorBoundary compact name="Property recent activity">
                  <PropertyRecentActivityCard propertyId={property.id} />
                </ErrorBoundary>
              </ReferenceSection>

              <ReferenceSection
                title="BGP Contacts"
                icon={UserCheck}
                open={sidebarSections.team}
                onToggle={() => toggleSection("team")}
                testId="toggle-team-section"
              >
                <InlineAgents propertyId={id} agentLinks={agentLinks} allUsers={allUsers} colorMap={userColorMap} landlordId={property.landlordId} readOnly={isClientViewer} />
              </ReferenceSection>

              <ReferenceSection
                title="Client Board"
                icon={Users}
                open={sidebarSections.clients}
                onToggle={() => toggleSection("clients")}
                testId="toggle-clients-section"
              >
                <ClientBoardPanel propertyId={property.id} landlordId={property.landlordId} allCompanies={allCompanies} />
              </ReferenceSection>

              <ReferenceSection
                title="Deals"
                icon={Handshake}
                open={sidebarSections.deals}
                onToggle={() => toggleSection("deals")}
                testId="toggle-deals-section"
              >
                <LinkedDealsPanel propertyId={property.id} />
                <TaggedConversationsPanel entityType="property" entityId={property.id} />
              </ReferenceSection>

              <ReferenceSection
                title="Available Units"
                icon={Store}
                open={sidebarSections.availableUnits}
                onToggle={() => toggleSection("availableUnits")}
                testId="toggle-available-units-section"
              >
                <AvailableUnitsPanel propertyId={property.id} />
              </ReferenceSection>

              {/* Land Registry back to staff-only (Woody, 2026-08-03). */}
              {!isClientViewer && (
              <ReferenceSection
                title="Land Registry"
                icon={Landmark}
                open={sidebarSections.landRegistry}
                onToggle={() => toggleSection("landRegistry")}
                testId="toggle-land-registry-section"
              >
                <LinkedLandRegistryPanel propertyId={property.id} />
              </ReferenceSection>
              )}

              {!isClientViewer && (
              <ReferenceSection
                title="Data linkage"
                icon={Activity}
                open={sidebarSections.linkage}
                onToggle={() => toggleSection("linkage")}
                testId="toggle-linkage-section"
              >
                <ErrorBoundary compact name="Property linkage audit">
                  <PropertyLinkageCard propertyId={property.id} />
                </ErrorBoundary>
              </ReferenceSection>
              )}
          </aside>
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
function AvailableUnitsPanel({ propertyId, readOnly }: { propertyId: string; readOnly?: boolean }) {
  const { data: units = [], isLoading } = useQuery<AvailableUnitRow[]>({
    queryKey: ["/api/available-units", { propertyId }],
    queryFn: async () => {
      const r = await fetch(`/api/available-units?propertyId=${encodeURIComponent(propertyId)}`, { credentials: "include", headers: getAuthHeaders() });
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
        <p className="text-xs text-muted-foreground">{readOnly ? "No units currently being marketed here." : "No units on the Letting Tracker yet"}</p>
        {!readOnly && (
          <a href={`/deals/letting?propertyId=${propertyId}`} className="text-[11px] text-blue-600 hover:underline mt-1 inline-block">
            Add unit →
          </a>
        )}
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
      {!readOnly && (
        <a href={`/deals/letting?propertyId=${propertyId}`} className="text-[11px] text-blue-600 hover:underline block pt-1">
          Open in Letting Tracker →
        </a>
      )}
    </div>
  );
}

// ── Brand pipeline images (auto-attributed from landlord scrape) ────────────
// Small footer link in the property's Images panel. Shows a count of
// image-studio images linked to this property by FK (set during the
// landlord brand-image refresh, when the URL slug matched the
// property's name) and deep-links to Image Studio with the property
// pre-filtered.
function BrandPipelineImagesLink({ propertyId, propertyName }: { propertyId: string; propertyName: string }) {
  const { data } = useQuery<any[]>({
    queryKey: ["/api/image-studio/search", { propertyId }],
    queryFn: async () => {
      const r = await fetch(`/api/image-studio/search?propertyId=${encodeURIComponent(propertyId)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  const images = Array.isArray(data) ? data : [];
  const count = images.length;
  if (count === 0) return null;
  const SHOWN = 12;
  const thumbSrc = (img: any) =>
    img.thumbnailData || ((img as any).hasThumbnail ? `/api/image-studio/${img.id}/thumb` : `/api/image-studio/${img.id}/full`);
  return (
    <div className="mt-3 pt-3 border-t border-border/60">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
        Landlord-auto images ({count})
      </p>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
        {images.slice(0, SHOWN).map((img: any) => (
          <a
            key={img.id}
            href={`/api/image-studio/${img.id}/full`}
            target="_blank"
            rel="noopener noreferrer"
            className="block aspect-square rounded-md overflow-hidden border border-border/60 hover:border-foreground/40 transition"
            title={img.title || img.caption || "Open full image"}
            data-testid={`thumb-brand-pipeline-${img.id}`}
          >
            <img
              src={thumbSrc(img)}
              alt={img.title || "Property image"}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </a>
        ))}
      </div>
      <Link
        href={`/image-studio?property=${encodeURIComponent(propertyName)}&propertyId=${encodeURIComponent(propertyId)}`}
        className="text-[11px] text-muted-foreground hover:text-foreground underline inline-flex items-center gap-1 mt-2"
        data-testid="link-brand-pipeline-images"
      >
        {count > SHOWN ? `View all ${count} landlord-auto images in Image Studio →` : `Open in Image Studio →`}
      </Link>
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

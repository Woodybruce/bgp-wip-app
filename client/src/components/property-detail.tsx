import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pill } from "@/components/ui/pill";
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
  AlertTriangle,
} from "lucide-react";
import { useState, useMemo, useEffect, useRef } from "react";
import { StreetViewPanoramaCapture } from "@/components/image-studio/street-view-panorama";
import { PropertyUnifiedSchedule } from "@/components/PropertyUnifiedSchedule";
import { PropertyPlansPanel } from "@/components/property-plans-panel";
import { PropertySimpleOverview, NextLeaseEvents } from "@/components/property-simple-overview";
import { PROPERTY_VIEW_LABELS, suggestPropertyView, type PropertyOverviewUnit } from "@shared/property-view";
import { BrandGapPanel } from "@/components/brand-gap-panel";
import { NotesPanel } from "@/components/notes-panel";
import { TrackerSummary } from "@/components/tracker-summary";
import { ActivitySummary } from "@/components/activity-summary";
import { BrandComplianceCard } from "@/components/brand-profile-panel";
import {
  PropertyAssetBriefPanel,
  PropertyCoveringStrip,
  WeeklyFocusCard,
  RiskRegisterCard,
  BgpCommentaryCard,
  PropertyLinkageCard,
} from "@/components/property-asset-brief";
import { trackRecentItem } from "@/hooks/use-recent-items";
import { legacyToCode, DEAL_STATUS_LABELS } from "@shared/deal-status";
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
import type { CrmProperty, CrmCompany, User, PropertyView } from "@shared/schema";
import {
  STATUS_OPTIONS,
  PROPERTY_STATUS_COLORS,
  ASSET_CLASS_OPTIONS,
  ASSET_CLASS_COLORS,
  USE_CLASS_OPTIONS,
  USE_CLASS_LABELS,
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
  ClientPropertyFoldersPanel,
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

  // Billing entity is BGP invoicing bookkeeping — the setter's PUT
  // /api/crm/properties/:id is gateway-blocked for clients, so don't
  // show them a control that can only fail. Fail closed while loading.
  const { data: kycViewer } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClientViewer = !kycViewer || kycViewer.role === "Client" || !!kycViewer.companyScopeId;

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/brand", ownerId, "profile"],
    queryFn: async () => {
      const res = await fetch(`/api/brand/${ownerId}/profile`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!ownerId,
  });

  // Billing entity row — rendered above the brand checks via the
  // ComplianceBoard's `prefix` slot.
  const billingEntityRow = isClientViewer ? null : (
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
      const res = await fetch(`/api/properties/${propertyId}/asset-brief`, { credentials: "include", headers: getAuthHeaders() });
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
        aria-expanded={open}
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

export function propertyAssetClasses(value: string | string[] | null | undefined): string[] {
  return [...new Set((Array.isArray(value) ? value : [value || ""])
    .flatMap(item => item.split(",")).map(item => item.trim()).filter(Boolean))];
}

// Keep a visited section mounted so switching tabs does not discard a draft.
// Research and integrations are first mounted when the user opens their tab.
function PropertySection({ name, active, simple, children }: { name: string; active: string; simple: boolean; children: React.ReactNode }) {
  const [visited, setVisited] = useState(!simple || name === active);
  useEffect(() => { if (!simple || name === active) setVisited(true); }, [name, active, simple]);
  if (simple && !visited && name !== active) return null;
  return <div className={name === active ? "space-y-3" : simple ? "hidden" : "hidden lg:block lg:space-y-3"}>{children}</div>;
}

// A Sales Instruction and the Investment tracker's Sales board are one piece
// of work (Woody, 2026-09-26): show whether this property is on the board,
// and add it in one click when it isn't. Staff only.
function SalesBoardLink({ property }: { property: any }) {
  const { toast } = useToast();
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isStaff = !!me && me.role !== "Client" && !me.companyScopeId;
  const { data: tracker = [] } = useQuery<any[]>({ queryKey: ["/api/investment-tracker"], enabled: isStaff });
  const onBoard = (Array.isArray(tracker) ? tracker : []).some((t: any) => t.propertyId === property.id && t.boardType === "Sales");
  const add = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/investment-tracker", {
      propertyId: property.id, assetName: property.name, boardType: "Sales", status: "REP",
      clientId: property.landlordId || null,
    })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker"] }); toast({ title: "Added to the Sales board" }); },
    onError: (e: any) => toast({ title: "Couldn't add to the Sales board", description: e?.message, variant: "destructive" }),
  });
  if (!isStaff) return null;
  // On the board → always say so (Brixton Market sits on the Sales board as
  // a 'BGP Instruction'); the add button only on a Sales Instruction.
  if (!onBoard && property.status !== "Sales Instruction") return null;
  return onBoard
    ? <Link href="/investment-tracker" className="text-[11px] text-emerald-700 hover:underline" data-testid="link-sales-board">On the Sales board</Link>
    : <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => add.mutate()} disabled={add.isPending} data-testid="button-add-sales-board">{add.isPending ? "Adding…" : "Add to Sales board"}</Button>;
}

export function PropertyDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  // Clients can edit scoped business fields; internal tools and ownership
  // controls retain their separate staff permissions.
  const { data: pdViewer } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  // Fail CLOSED while /api/auth/me loads, and match the server's wider
  // definition of a client (any non-BGP login gets companyScopeId) —
  // role === "Client" alone let mis-provisioned external users see the
  // full internal shell with every panel in a 403 error state.
  const isClientViewer = !pdViewer || pdViewer.role === "Client" || !!pdViewer.companyScopeId;
  const { data: property, isLoading } = useQuery<CrmProperty>({
    queryKey: ["/api/crm/properties", id],
    refetchInterval: (query) => {
      // A short refresh window picks up background data changes. Property
      // age and missing fields do not prove that an enrichment job is running.
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
  const overviewSchedule = useQuery<PropertyOverviewUnit[]>({
    queryKey: ["/api/tenancy-schedule/property", id],
    queryFn: async () => (await apiRequest("GET", `/api/tenancy-schedule/property/${id}`)).json(),
    enabled: Boolean(property),
  });
  const suggestedView = suggestPropertyView(property?.assetClass, overviewSchedule.isError ? undefined : overviewSchedule.data, property?.name);
  const propertyView = property?.propertyView || suggestedView;
  const [showFullPage, setShowFullPage] = useState(false);
  const simpleLayout = !showFullPage && (propertyView === "building" || propertyView === "multi_let");
  useEffect(() => { setShowFullPage(false); }, [id]);
  const userColorMap = useMemo(() => buildUserColorMap(allUsers), [allUsers]);
  const { data: agentLinks = [] } = useQuery<Array<{ propertyId: string; userId: string; role?: string | null }>>({
    queryKey: ["/api/crm/property-agents"],
  });
  // Lease Advisory evidence plan linked to this property (staff only) —
  // surfaces a jump straight from the property board to the plan.
  const { data: evidencePlans = [] } = useQuery<Array<{ id: string; property_id: string | null }>>({
    queryKey: ["/api/evidence-plans"],
    enabled: !isClientViewer,
  });
  const linkedEvidencePlan = evidencePlans.find(p => p.property_id === id);
  const { data: investmentData } = useQuery<{ assets: any[]; ownership: any[] }>({ queryKey: ["/api/properties", id, "investment"], enabled: !!pdViewer && !isClientViewer });
  const hasInvestment = !!(investmentData?.assets?.length || investmentData?.ownership?.length);
  const { data: allCompanies = [] } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies", { includeBillingEntities: true }],
    queryFn: async () => {
      const res = await fetch("/api/crm/companies?includeBillingEntities=true", { credentials: "include", headers: getAuthHeaders() });
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
    investmentComps: true,
    investment: true,
    spaceFits: true,
    leaseEvents: true,
    landRegistry: false,
    images: false,
    compliance: true,
    activity: true,
    linkage: false,
  });
  const toggleSection = (key: string) => setSidebarSections(prev => ({ ...prev, [key]: !prev[key] }));

  // Phone section switcher (docs/DESIGN.md §9) — below lg the aside stacks
  // under the main column and the page ran 20 boards deep in one scroll.
  // One section at a time on the phone; lg+ layout unchanged.
  const [phoneSection, setPhoneSection] = useState<"overview" | "boards" | "tenancy" | "plans" | "research" | "deals" | "files" | "kyc" | "activity">("overview");
  const sec = (k: typeof phoneSection) => (phoneSection === k ? "space-y-3" : simpleLayout ? "hidden" : "hidden lg:block lg:space-y-3");
  useEffect(() => {
    setPhoneSection(previous => simpleLayout && previous === "boards" ? "tenancy" : !simpleLayout && ["tenancy", "plans", "research"].includes(previous) ? "boards" : previous);
  }, [simpleLayout]);

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
  useEffect(() => {
    let frame: number;
    const openLinkedPlan = () => {
      if (!/^#plan-(tenancy|unit)-/.test(window.location.hash)) return;
      setMainSections(previous => ({ ...previous, plans: true }));
      setPhoneSection(simpleLayout ? "plans" : "boards");
      frame = requestAnimationFrame(() => document.querySelector('[data-testid="toggle-plans"]')?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    openLinkedPlan();
    window.addEventListener("hashchange", openLinkedPlan);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("hashchange", openLinkedPlan); };
  }, [id, property?.id, simpleLayout]);

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

  const inlineUpdateAsync = async (field: string, value: any) => {
    await updateMutation.mutateAsync({ [field]: value } as any);
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

  // Wait for the first layout decision only. Once a request has settled,
  // keep the schedule mounted while it retries: hiding it on every pending
  // state lets retry-on-mount turn a failed request into a render/fetch loop.
  if (isLoading || (property && !property.propertyView && overviewSchedule.isPending && !overviewSchedule.isFetched)) {
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
      {/* Container queries, not viewport breakpoints: with the ChatBGP panel
          pinned open the page loses ~400px but the viewport doesn't change,
          so lg:/xl: grids kept splitting into columns that no longer fit
          (Woody, 2026-09-15: "still overlap"). The page and the main column
          are inline-size containers; the grids below key off THEIR width. */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden [container-type:inline-size]">
        {/* Single page-level scroll. A 2-col grid splits content from
            the reference stack: main content on the left, fixed-width
            sticky reference column on the right. Each reference board
            has its own max-height + internal overflow-y so the boards
            stay the same outward size and only their bodies scroll. */}
        {/* One layout at every width: the old 2xl mode doubled the aside to
            660px (two board columns), squeezing the main content exactly on
            BIG windows — Landsec's window hit it, BGP's didn't, and the two
            looked like different apps (Woody, 2026-08-03). Single ~340px
            aside always. */}
        <div className={`p-4 sm:p-6 grid grid-cols-1 ${simpleLayout ? "max-w-7xl mx-auto" : "[@container(min-width:1000px)]:grid-cols-[minmax(0,1fr)_340px]"} gap-4 lg:gap-6 items-start`} data-property-view={simpleLayout ? propertyView : "full"}>
          <div className="min-w-0 space-y-3 [container-type:inline-size]">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Hidden on phones — the mobile top bar + breadcrumb already
                  give two ways back; a third row just eats screen. */}
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex gap-1.5 text-muted-foreground hover:text-foreground -ml-2" data-testid="button-back-properties" onClick={() => window.history.length > 1 ? window.history.back() : navigate("/properties")}>
                <ArrowLeft className="w-3.5 h-3.5" />
                {/* It returns to wherever you came from (a deal, a brand…), so
                    say Back — "Properties" read as a link to the list. */}
                {typeof window !== "undefined" && window.history.length > 1 ? "Back" : "Properties"}
              </Button>
              <span className="hidden sm:inline text-muted-foreground/40">/</span>
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
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground" data-testid="property-eyebrow">
                    Property
                  </span>
                  <h1 className="text-2xl font-bold tracking-tight" data-testid="text-property-name">
                    <button type="button" className="text-left rounded hover:text-muted-foreground transition-colors" onClick={() => setEditingAddress(true)} aria-label={`Edit address for ${property.name}`}>
                      {property.name}
                    </button>
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
                  <SalesBoardLink property={property} />
                  {property.groupName && !/^properties$/i.test(property.groupName) && (
                    <Badge variant="outline" className="text-[10px]" data-testid="badge-property-group">{property.groupName}</Badge>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap gap-y-1.5 ml-auto">
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
                {linkedEvidencePlan && (
                  <Link href={`/evidence-plans/${linkedEvidencePlan.id}`}>
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="button-evidence-plan">
                      <MapIcon className="w-3.5 h-3.5" />
                      Evidence plan
                    </Button>
                  </Link>
                )}
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

            <p className="text-sm text-muted-foreground">{formatAddress(property.address) || "Address not recorded"}</p>
            {/* Other names the building goes by (Lucent is Piccadilly Lights) —
                search finds the property under each of them too. */}
            {Array.isArray((property as any).aliases) && (property as any).aliases.length > 0 && (
              <p className="text-xs text-muted-foreground -mt-1" data-testid="property-aliases">
                Also known as {((property as any).aliases as string[]).filter(a => !/,\s*UK$|^\d+.*,.*,/i.test(a)).join(" · ") || (property as any).aliases.join(" · ")}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="property-view-controls"
              title={property.propertyView ? "Saved for this property. Layout changes keep the same records and editing permissions." : suggestedView ? "Suggested from the recorded property use and tenancy information. Choose a layout to keep it fixed." : "No reliable layout suggestion yet — choose one."}>
              <label className="flex items-center gap-2 min-w-0">Layout
                <select aria-label="Property layout" value={property.propertyView || "auto"} disabled={updateMutation.isPending || !pdViewer} className="rounded border bg-background px-2 py-1 text-xs text-foreground min-w-0 w-full sm:w-auto" onChange={event => {
                  const value = event.target.value;
                  updateMutation.mutate({ propertyView: value === "auto" ? null : value as PropertyView }, { onSuccess: () => { setShowFullPage(false); setPhoneSection("overview"); } });
                }}>
                  <option value="auto">Automatic{suggestedView ? ` · ${PROPERTY_VIEW_LABELS[suggestedView]}` : " · choose a layout"}</option>
                  {Object.entries(PROPERTY_VIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {(propertyView === "building" || propertyView === "multi_let") && <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setShowFullPage(previous => !previous); setPhoneSection("overview"); }} data-testid="property-toggle-full-page">{showFullPage ? "Return to simple view" : "Show full page"}</Button>}
              {!isClientViewer && <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setStreetViewExpanded(value => !value)} data-testid="button-expand-street-view"><ImageIcon className="w-3.5 h-3.5" />{streetViewExpanded ? "Hide Street View & images" : "Street View & images"}</Button>}
            </div>

            <div className={`flex flex-wrap gap-1.5 ${simpleLayout ? "" : "lg:hidden"}`} data-testid="property-phone-sections">
              <Pill active={phoneSection === "overview"} onClick={() => setPhoneSection("overview")} data-testid="property-section-overview">Overview</Pill>
              {simpleLayout ? <>
                <Pill active={phoneSection === "tenancy"} onClick={() => setPhoneSection("tenancy")} data-testid="property-section-tenancy">Tenancy</Pill>
                <Pill active={phoneSection === "plans"} onClick={() => setPhoneSection("plans")} data-testid="property-section-plans">Plans</Pill>
              </> : <Pill active={phoneSection === "boards"} onClick={() => setPhoneSection("boards")} data-testid="property-section-boards">Boards</Pill>}
              <Pill active={phoneSection === "deals"} onClick={() => setPhoneSection("deals")} data-testid="property-section-deals">Deals &amp; units</Pill>
              <Pill active={phoneSection === "files"} onClick={() => setPhoneSection("files")} data-testid="property-section-files">Files &amp; contacts</Pill>
              <Pill active={phoneSection === "kyc"} onClick={() => setPhoneSection("kyc")} data-testid="property-section-kyc">KYC</Pill>
              <Pill active={phoneSection === "activity"} onClick={() => setPhoneSection("activity")} data-testid="property-section-activity">Activity</Pill>
              {simpleLayout && <Pill active={phoneSection === "research"} onClick={() => setPhoneSection("research")} data-testid="property-section-research">Research</Pill>}
            </div>

            <PropertySection name={"overview"} active={phoneSection} simple={simpleLayout}>
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
            <div className={`grid grid-cols-1 ${simpleLayout ? "[@container(min-width:760px)]:grid-cols-2" : "[@container(min-width:760px)]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"} gap-3`}>
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
                  {/* Business fields remain editable for clients with
                      access to this property; the API checks record scope. */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 min-w-0">
                    <div className="min-w-0" data-testid="property-field-status">
                      <p className="text-[11px] text-muted-foreground leading-tight mb-0.5">Status</p>
                      <InlineLabelSelect value={property.status} options={STATUS_OPTIONS} colorMap={PROPERTY_STATUS_COLORS} onSave={(val) => inlineUpdate("status", val)} placeholder="Set status" />
                    </div>
                    <div className="min-w-0" data-testid="property-field-asset-class">
                      <p className="text-[11px] text-muted-foreground leading-tight mb-0.5">Asset class</p>
                      <InlineEngagement value={propertyAssetClasses(property.assetClass)} options={ASSET_CLASS_OPTIONS} colorMap={ASSET_CLASS_COLORS} onSave={(values) => inlineUpdate("assetClass", values.join(", ") || null)} placeholder="Set class" />
                    </div>
                    <div className="min-w-0" data-testid="property-field-use-class">
                      <p className="text-[11px] text-muted-foreground leading-tight mb-0.5">Use class</p>
                      <InlineLabelSelect value={(property as any).useClass} options={USE_CLASS_OPTIONS} labelMap={USE_CLASS_LABELS} onSave={(val) => inlineUpdate("useClass" as any, val)} placeholder="Set use class" />
                    </div>
                    <div className="min-w-0" data-testid="property-field-team">
                      <p className="text-[11px] text-muted-foreground leading-tight mb-0.5">BGP team</p>
                      <InlineEngagement value={property.bgpEngagement} options={TEAM_OPTIONS} colorMap={TEAM_COLORS} onSave={(val) => inlineUpdate("bgpEngagement", val)} />
                    </div>
                    <div className="min-w-0" data-testid="property-field-website">
                      <p className="text-[11px] text-muted-foreground leading-tight mb-0.5">Website</p>
                      <InlineText value={property.website || ""} onSave={(val) => inlineUpdateAsync("website", val)} label="Website" placeholder="Set website" className="text-sm truncate block" />
                    </div>
                  </div>

                {(() => {
                  // Only render ownership rows that have a value
                  // assigned. Empty placeholders ("+ Long Leaseholder",
                  // "+ Junior Lender") chewed up vertical space on
                  // properties where most ownership slots are blank.
                  // A single "+ Add owner" affordance at the end keeps
                  // adding new entries one click away.
                  // landlordId is the property's owner / landlord. It used
                  // to read "Client / Landlord", but a completed sale hands
                  // it to the buyer, who needn't be BGP's client (Woody,
                  // 2026-09-27) — who BGP acts for lives on the deals.
                  // Same company can sit in the Freeholder slot too.
                  const allRows = [
                    { label: "Owner / Landlord", field: "landlordId",        id: (property as any).landlordId },
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
                        <div className="grid grid-cols-[minmax(84px,110px),minmax(0,1fr)] items-center gap-2 text-[11px]">
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
                            <div key={row.field} className="grid grid-cols-[minmax(84px,110px),minmax(0,1fr)] items-center gap-2">
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
                            <div className="grid grid-cols-[minmax(84px,110px),minmax(0,1fr)] items-center gap-2">
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
                  <div data-testid="property-field-area">
                    <p className="text-[11px] text-muted-foreground leading-tight mb-0.5">Area</p>
                    <InlineNumber value={property.sqft} onSave={(val) => inlineUpdateAsync("sqft", val)} label="Area (sq ft)" suffix=" sq ft" className="text-sm font-mono tabular-nums font-medium" />
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
                {simpleLayout && !isClientViewer && <PropertyReviewPanel propertyId={property.id} onOpenPlans={() => { setMainSections(previous => ({ ...previous, plans: true })); setPhoneSection("plans"); }} />}
                {simpleLayout ? <div className="flex-1 flex flex-col [&>*]:flex-1"><PropertySimpleOverview propertyId={id} propertyName={property.name} landlordName={allCompanies.find(c => c.id === (property as any).landlordId)?.name || null} canTrack={!isClientViewer} showUnits={propertyView === "building"} rows={overviewSchedule.data} loading={overviewSchedule.isPending} failed={overviewSchedule.isError} onRetry={() => overviewSchedule.refetch()} onOpenTenancy={() => { setMainSections(previous => ({ ...previous, leasingSchedule: true })); setPhoneSection("tenancy"); }} /></div> : <>
                {/* PropertyNewsPanel renders its own card + "News Feed"
                    header — the old outer Card double-framed it. */}
                <ErrorBoundary compact name="Property news (top-strip preview)">
                  <PropertyNewsPanel propertyId={property.id} propertyName={property.name} />
                </ErrorBoundary>
                <ErrorBoundary compact name="Risk register">
                  <div className="flex-1 min-h-[280px]">
                    <RiskRegisterCard propertyId={property.id} />
                  </div>
                </ErrorBoundary>
                </>}
              </div>
            </div>

            </PropertySection>

            <PropertySection name={simpleLayout ? "files" : "boards"} active={phoneSection} simple={simpleLayout}>
            {/* Brochures row. Property Decks panel hidden for the Monday
                demo — feature not yet ready for the firm. See
                PRESENTATION_BACKLOG.md. */}
            <ErrorBoundary compact name="Property brochures">
              <PropertyBrochuresPanel propertyId={property.id} />
            </ErrorBoundary>
            </PropertySection>

            <PropertySection name={simpleLayout ? "activity" : "boards"} active={phoneSection} simple={simpleLayout}>
            {/* Brand Gap — full-width board (Woody, 2026-08-04: "gap
                analysis display needs a proper rework, full width to
                start"). Renders for clients too — the server slices the
                analysis to their brand categories + self-adds, so Landsec
                sees the hospitality/leisure view. */}
            {!isClientViewer && (
              <ErrorBoundary compact name="Notes">
                <NotesPanel propertyId={property.id} />
              </ErrorBoundary>
            )}
            </PropertySection>
            <PropertySection name={simpleLayout ? "research" : "boards"} active={phoneSection} simple={simpleLayout}>
            {simpleLayout && <>
              <ErrorBoundary compact name="Property news"><PropertyNewsPanel propertyId={property.id} propertyName={property.name} /></ErrorBoundary>
              <ErrorBoundary compact name="Risk register"><RiskRegisterCard propertyId={property.id} /></ErrorBoundary>
            </>}
            <ErrorBoundary compact name="Brand gap">
              <CollapsibleCard open={mainSections.brands} onToggle={() => toggleMain("brands")} icon={Building2} title="Brand Gap" testId="toggle-brands">
                <BrandGapPanel propertyId={property.id} />
              </CollapsibleCard>
            </ErrorBoundary>
            </PropertySection>

            {/* Pipeline & performance retired from the property page
                (Woody, 2026-09-27: "not linked and a double up") — deal
                stages are on Deals, vacancy / WAULT / rent on the tenancy
                schedule, lease risks on the Risk register. */}

            <PropertySection name={simpleLayout ? "activity" : "overview"} active={phoneSection} simple={simpleLayout}>
            <BgpCommentaryWrapper propertyId={property.id} />
            </PropertySection>

            <PropertySection name={simpleLayout ? "files" : "overview"} active={phoneSection} simple={simpleLayout}>
            {isClientViewer ? null : streetViewExpanded ? (
              <div className="grid grid-cols-1 [@container(min-width:760px)]:grid-cols-2 gap-3 items-stretch">
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
            ) : null}

            </PropertySection>

            <PropertySection name={simpleLayout ? "plans" : "boards"} active={phoneSection} simple={simpleLayout}>
            {/* LeasingTrackerSummary removed — its counts (available /
                under-offer / let / viewings / offers) duplicate what's
                already visible per unit on the Leasing Schedule below.
                The deal-CRM letting-tracker function it sourced from
                (available_units) is untouched. */}

            {/* Plans render for clients too — the GET is opened server-side
                for in-scope properties (board parity, Woody 2026-08-03). */}
            <ErrorBoundary compact name="Property plans">
              <CollapsibleCard open={mainSections.plans} onToggle={() => toggleMain("plans")} icon={MapIcon} title="Plans" testId="toggle-plans">
                <PropertyPlansPanel propertyId={property.id} bare />
              </CollapsibleCard>
            </ErrorBoundary>
            </PropertySection>

            <div className={simpleLayout && propertyView === "multi_let" && phoneSection === "overview" ? "space-y-3" : sec(simpleLayout ? "tenancy" : "boards")}>
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
              <CollapsibleCard open={mainSections.leasingSchedule} onToggle={() => toggleMain("leasingSchedule")} icon={CalendarIcon} title="Tenancy Schedule" testId="toggle-schedule">
                <div className="max-h-[640px] overflow-y-auto pr-1">
                  <PropertyUnifiedSchedule propertyId={property.id} presentation={simpleLayout ? "compact" : "full"} />
                </div>
              </CollapsibleCard>
            </ErrorBoundary>
            </div>

            <PropertySection name={simpleLayout ? "research" : "boards"} active={phoneSection} simple={simpleLayout}>
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
            </PropertySection>
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
          <aside className={simpleLayout ? ["files", "deals", "kyc", "activity"].includes(phoneSection) ? "grid grid-cols-1 md:grid-cols-2 gap-3 items-start" : "hidden" : "space-y-3 lg:sticky lg:top-4 self-start"}>
              {!isClientViewer && !simpleLayout && (
              <PropertySection name={"overview"} active={phoneSection} simple={simpleLayout}>
                <PropertyReviewPanel propertyId={property.id} onOpenPlans={() => {
                  setMainSections(previous => ({ ...previous, plans: true }));
                  setPhoneSection(simpleLayout ? "plans" : "boards");
                  requestAnimationFrame(() => document.querySelector('[data-testid="toggle-plans"]')?.scrollIntoView({ behavior: "smooth", block: "start" }));
                }} />
              </PropertySection>
              )}

              {/* Clients get the read-only jailed browser (their own
                  SharePoint area, no internal team names) instead of the
                  staff panel — restored per Woody, 2026-08-03. */}
              <PropertySection name={"files"} active={phoneSection} simple={simpleLayout}>
              <ReferenceSection
                title="Files"
                icon={FolderOpen}
                open={sidebarSections.files}
                onToggle={() => toggleSection("files")}
                testId="toggle-files-section"
              >
                {isClientViewer ? (
                  // Wait for /api/auth/me before mounting: isClientViewer
                  // defaults true while it loads, so staff loads briefly
                  // mounted this panel and fired a doomed client-scoped
                  // sharepoint fetch (403 on every staff property view).
                  pdViewer ? <ClientPropertyFoldersPanel propertyName={property.name} propertyId={property.id} /> : null
                ) : (
                  <>
                    <PropertyFoldersPanel propertyName={property.name} folderTeams={property.folderTeams} sharepointFolderUrl={property.sharepointFolderUrl} bare />
                    <PropertySharepointLink propertyId={property.id} sharepointFolderUrl={property.sharepointFolderUrl} onUpdate={inlineUpdate} />
                  </>
                )}
              </ReferenceSection>
              </PropertySection>

              <PropertySection name={"files"} active={phoneSection} simple={simpleLayout}>
              <ReferenceSection
                title="Contacts"
                icon={UserCheck}
                open={sidebarSections.contacts}
                onToggle={() => toggleSection("contacts")}
                testId="toggle-contacts-section"
              >
                <div className="mb-2 pb-2 border-b">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">BGP team</div>
                  <InlineAgents propertyId={id} agentLinks={agentLinks} allUsers={allUsers} colorMap={userColorMap} landlordId={property.landlordId} readOnly={isClientViewer} />
                </div>
                <LinkedContactsPanel propertyId={property.id} bare />
              </ReferenceSection>
              </PropertySection>

              {/* Visible to clients — same decision as the brand-profile
                  KYC panel (landlords need tenant AML/financial standing). */}
              <PropertySection name={"kyc"} active={phoneSection} simple={simpleLayout}>
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
              </PropertySection>

              <PropertySection name={"activity"} active={phoneSection} simple={simpleLayout}>
              <ReferenceSection
                title="Activity"
                icon={Activity}
                open={sidebarSections.activity}
                onToggle={() => toggleSection("activity")}
                testId="toggle-activity-section"
              >
                <ErrorBoundary compact name="Property activity">
                  {/* Canonical ActivitySummary — upcoming diary events plus
                      the last 14 days of touches (Woody, 2026-08-03). */}
                  <ActivitySummary propertyId={property.id} />
                </ErrorBoundary>
              </ReferenceSection>
              </PropertySection>

              {/* BGP Contacts folded into Contacts (its BGP team row) — it listed the same people. */}

              {/* Client Board retired (Woody, 2026-08-05) — Linked Contacts'
                  Internal team group now carries the client-side people. */}

              <PropertySection name={"deals"} active={phoneSection} simple={simpleLayout}>
              <ReferenceSection
                title="Deals"
                icon={Handshake}
                open={sidebarSections.deals}
                onToggle={() => toggleSection("deals")}
                testId="toggle-deals-section"
              >
                <LinkedDealsPanel propertyId={property.id} bare />
                <TaggedConversationsPanel entityType="property" entityId={property.id} />
              </ReferenceSection>
              </PropertySection>

              <PropertySection name={"deals"} active={phoneSection} simple={simpleLayout}>
              <ReferenceSection
                title="Available units"
                icon={Store}
                open={sidebarSections.availableUnits}
                onToggle={() => toggleSection("availableUnits")}
                testId="toggle-available-units-section"
              >
                <AvailableUnitsPanel propertyId={property.id} />
                {!isClientViewer && <div className="mt-3 pt-2 border-t">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Brands that fit the vacant space</div>
                  <PropertySpaceFitsPanel propertyId={property.id} />
                </div>}
              </ReferenceSection>
              </PropertySection>

              {!isClientViewer && !simpleLayout && (overviewSchedule.data || []).length > 0 && (
              <PropertySection name={"deals"} active={phoneSection} simple={simpleLayout}>
              <ReferenceSection
                title="Next lease events"
                icon={CalendarIcon}
                open={sidebarSections.leaseEvents}
                onToggle={() => toggleSection("leaseEvents")}
                testId="toggle-lease-events-section"
              >
                <NextLeaseEvents propertyId={property.id} propertyName={property.name} landlordName={allCompanies.find(c => c.id === (property as any).landlordId)?.name || null} rows={overviewSchedule.data || []} limit={6} />
              </ReferenceSection>
              </PropertySection>
              )}

              {/* Brands that fit now sits inside Available Units. */}

              {!isClientViewer && hasInvestment && (
              <PropertySection name={"deals"} active={phoneSection} simple={simpleLayout}>
              <ReferenceSection
                title="Investment"
                icon={Landmark}
                open={sidebarSections.investment}
                onToggle={() => toggleSection("investment")}
                testId="toggle-investment-section"
              >
                <PropertyInvestmentPanel propertyId={property.id} />
              </ReferenceSection>
              </PropertySection>
              )}

              {!isClientViewer && (
              <PropertySection name={"deals"} active={phoneSection} simple={simpleLayout}>
              <ReferenceSection
                title="Investment comps"
                icon={TrendingUp}
                open={sidebarSections.investmentComps}
                onToggle={() => toggleSection("investmentComps")}
                testId="toggle-investment-comps-section"
              >
                <PropertyInvestmentCompsPanel propertyId={property.id} />
              </ReferenceSection>
              </PropertySection>
              )}

              {/* Land Registry retired from the property page entirely
                  (Woody, 2026-08-03) — title data lives in Property
                  Intelligence when needed. */}

              {!isClientViewer && pdViewer?.isAdmin && (
              <PropertySection name={"activity"} active={phoneSection} simple={simpleLayout}>
              <ReferenceSection
                title="Data housekeeping (admin)"
                icon={Activity}
                open={sidebarSections.linkage}
                onToggle={() => toggleSection("linkage")}
                testId="toggle-linkage-section"
              >
                <p className="text-[11px] text-muted-foreground mb-2">How well this property's records are joined up — tenants matched to CRM brands, deals and tasks attached to the property. The nightly sweep fixes most of it automatically; these buttons fix the rest now.</p>
                <ErrorBoundary compact name="Property linkage audit">
                  <PropertyLinkageCard propertyId={property.id} />
                </ErrorBoundary>
              </ReferenceSection>
              </PropertySection>
              )}
          </aside>
        </div>

      </div>
    </div>
  );
}

// ── Needs review ────────────────────────────────────────────────────────────
// Things on this property waiting for a person (Woody, 2026-09-27): plan scans
// to review, outlines to link, tracker lines that fit two units, source data
// held back. Each item carries its choices; resolving applies the chosen
// schedule edits. Hidden when nothing is waiting. Staff only.
function PropertyReviewPanel({ propertyId, onOpenPlans }: { propertyId: string; onOpenPlans: () => void }) {
  const { toast } = useToast();
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { data } = useQuery<{ items: any[] }>({ queryKey: ["/api/properties", propertyId, "review-items"] });
  const resolve = useMutation({
    mutationFn: async ({ id, option, dismiss }: { id: string; option?: string; dismiss?: boolean }) => (await apiRequest("POST", `/api/review-items/${id}/resolve`, { option, dismiss })).json(),
    onSuccess: (_r, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "review-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
      toast({ title: vars.dismiss ? "Dismissed" : "Done — the schedule has been updated" });
    },
    onError: (e: any) => toast({ title: "Couldn't apply that", description: e?.message, variant: "destructive" }),
  });
  const items = data?.items || [];
  if (!items.length) return null;
  const KIND: Record<string, string> = { plan_scan: "Plan scan", plan_links: "Plan links", tracker_unit: "Leasing tracker", data_difference: "Data difference", trading_name: "Trading name" };
  return (
    <Card className="border-amber-300" data-testid="property-review-panel">
      <div className="px-3 py-2 flex items-center gap-2 border-b">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
        <span className="text-xs font-semibold">Needs review</span>
        <Badge variant="secondary" className="text-[10px] h-4 px-1">{items.length}</Badge>
      </div>
      <div className="max-h-[420px] overflow-y-auto divide-y">
        {(showAll ? items : items.slice(0, 4)).map(item => (
          <div key={item.id} className="px-3 py-2 text-xs space-y-1" data-testid={`review-item-${item.kind}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{KIND[item.kind] || item.kind}</div>
                <div className="font-medium">{item.title}</div>
              </div>
              {item.live
                ? <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] shrink-0" onClick={onOpenPlans}>Open plans</Button>
                : <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] shrink-0" onClick={() => setOpenItem(openItem === item.id ? null : item.id)}>{openItem === item.id ? "Hide" : "Choose"}</Button>}
            </div>
            {/* Detail shows when the item is opened — the card read as a wall
                of working notes (Woody, 2026-09-27). */}
            {item.detail && (item.live || openItem === item.id) && <p className={`text-[11px] text-muted-foreground whitespace-pre-line ${item.live ? "line-clamp-2" : ""}`}>{item.detail}</p>}
            {!item.live && openItem === item.id && (
              <div className="space-y-1.5 pt-1">
                {(item.options || []).map((o: any) => (
                  <div key={o.key} className="rounded border p-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{o.label}</span>
                      <Button size="sm" className="h-6 px-2 text-[10px]" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: item.id, option: o.key })} data-testid={`review-apply-${o.key}`}>Apply</Button>
                    </div>
                    {o.detail && <p className="text-[11px] text-muted-foreground whitespace-pre-line">{o.detail}</p>}
                  </div>
                ))}
                <button className="text-[11px] text-muted-foreground underline" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: item.id, dismiss: true })}>Dismiss — nothing to change</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {items.length > 4 && (
        <button className="w-full px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground border-t text-left" onClick={() => setShowAll(v => !v)}>
          {showAll ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </Card>
  );
}

// ── Brands that fit the property's vacant units ─────────────────────────────
// Each vacant / marketing unit with the brands whose live leasing requirement
// fits it (size plus use or location) — the landlord page's Tenant rep view,
// for one building. ★ = BGP acts for the brand. Staff only.
function PropertySpaceFitsPanel({ propertyId }: { propertyId: string }) {
  const { data, isLoading } = useQuery<{ space: any[] }>({ queryKey: ["/api/properties", propertyId, "space-fits"] });
  if (isLoading) return <div className="text-xs text-muted-foreground py-2">Loading…</div>;
  const space = data?.space || [];
  const fitting = space.filter(u => u.fits.length > 0);
  if (!space.length) return <p className="text-xs text-muted-foreground">No vacant or marketing units recorded.</p>;
  return (
    <div className="space-y-1">
      {fitting.map(u => (
        <div key={`${u.kind}-${u.id}`} className="py-1.5 border-b last:border-0 text-xs" data-testid={`space-fit-${u.id}`}>
          <div className="flex items-center justify-between gap-2">
            <Link href={u.kind === "marketing" ? `/available?propertyId=${propertyId}&unitId=${u.id}` : `/leasing-schedule/${propertyId}`} className="font-medium hover:underline truncate">{u.unitName || "Unit"}</Link>
            <span className="flex items-center gap-1.5 shrink-0">
              {u.sqft ? <span className="text-[10px] tabular-nums text-muted-foreground">{Number(u.sqft).toLocaleString()} sq ft</span> : null}
              <Badge variant="outline" className="text-[9px]">{u.status}</Badge>
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {u.fits.map((f: any, i: number) => (
              <span key={f.requirementId}>{i > 0 && ", "}
                {f.companyId ? <Link href={`/companies/${f.companyId}`} className={`hover:underline ${f.bgpClient ? "font-semibold text-foreground" : ""}`}>{f.name}{f.bgpClient ? " ★" : ""}</Link> : <span>{f.name}</span>}
              </span>
            ))}
            {u.fitCount > u.fits.length ? ` +${u.fitCount - u.fits.length}` : ""}
          </div>
        </div>
      ))}
      {fitting.length === 0 && <p className="text-xs text-muted-foreground">{space.length} vacant or marketing unit{space.length === 1 ? "" : "s"} — none fits a live requirement's size with a matching use or location.</p>}
      {fitting.length > 0 && space.length > fitting.length && <p className="text-[11px] text-muted-foreground">{space.length - fitting.length} other vacant unit{space.length - fitting.length === 1 ? "" : "s"} with no fit yet.</p>}
      <p className="text-[10px] text-muted-foreground">★ BGP acts for the brand · <Link href="/requirements?type=leasing" className="text-primary hover:underline">Requirements</Link></p>
    </div>
  );
}

// ── Investment work on the property ─────────────────────────────────────────
// The property's Sales / Purchases board assets (Woody, 2026-09-27: the
// property board should carry the sale): status, guide, viewings, bids,
// particulars sent and the best-fitting buyers not yet approached, plus the
// ownership history completions wrote. Staff only.
function PropertyInvestmentPanel({ propertyId }: { propertyId: string }) {
  const { data, isLoading } = useQuery<{ assets: any[]; ownership: any[] }>({ queryKey: ["/api/properties", propertyId, "investment"] });
  const money = (v: any) => { const n = Number(v); return n ? (n >= 1e6 ? `£${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}m` : `£${Math.round(n / 1e3)}k`) : null; };
  const when = (d: any) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
  if (isLoading) return <div className="text-xs text-muted-foreground py-2">Loading…</div>;
  const assets = data?.assets || [], ownership = data?.ownership || [];
  if (!assets.length && !ownership.length) return (
    <div className="text-xs text-muted-foreground space-y-1">
      <p>Not on BGP's Sales or Purchases boards.</p>
      <Link href="/deals/investment" className="text-[11px] text-primary hover:underline">Investment tracker →</Link>
    </div>
  );
  return (
    <div className="space-y-3">
      {assets.map(a => {
        const code = legacyToCode(a.status);
        return (
          <div key={a.id} className="space-y-1.5" data-testid={`property-investment-${a.id}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{a.board_type === "Sales" ? "Sale" : "Purchase"}{a.client ? ` for ${a.client}` : ""}</span>
              <Badge variant="outline" className="text-[10px]">{code ? DEAL_STATUS_LABELS[code] : a.status || "Reporting"}</Badge>
            </div>
            <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-2 tabular-nums">
              {money(a.guide_price) && <span>Guide {money(a.guide_price)}</span>}
              {a.niy && <span>NIY {Number(a.niy).toFixed(2)}%</span>}
              {a.bid_deadline && <span>Bids {a.bid_deadline}</span>}
            </div>
            <div className="grid grid-cols-3 gap-1 text-center">
              {[["Sent", a.sent], ["Viewings", a.viewings], ["Bids", a.bids]].map(([label, n]) => (
                <div key={label as string} className="rounded border py-1">
                  <div className="text-sm font-semibold tabular-nums">{n || 0}</div>
                  <div className="text-[10px] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
            {money(a.best_bid) && <p className="text-[11px]">Best bid <span className="font-medium tabular-nums">{money(a.best_bid)}</span>{a.buyer ? <> · buyer {a.buyer_id ? <Link href={`/companies/${a.buyer_id}`} className="hover:underline">{a.buyer}</Link> : a.buyer}</> : null}</p>}
            {a.fits?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Buyers who fit — not yet sent{a.fitsTotal > a.fits.length ? ` (top ${a.fits.length} of ${a.fitsTotal})` : ""}</div>
                {a.fits.map((b: any) => (
                  <div key={b.companyId || b.name} className="py-1 border-b last:border-0">
                    <div className="text-[11px] flex items-center justify-between gap-2">
                      {b.companyId ? <Link href={`/companies/${b.companyId}`} className="font-medium hover:underline truncate">{b.name}</Link> : <span className="font-medium truncate">{b.name}</span>}
                      <span className="text-[10px] text-muted-foreground shrink-0">{(b.sources || []).map((x: string) => x === "comps" ? "past buyer" : x).join(" · ")}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">{(b.reasons || []).map((r: string) => r.replace(/ \((requirement|mandate)\)$/, "")).join(" · ")}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-3 text-[11px]">
              <Link href="/deals/investment" className="text-primary hover:underline">On the {a.board_type === "Sales" ? "Sales" : "Purchases"} board →</Link>
              {a.deal_id && <Link href={`/deals/${a.deal_id}`} className="text-primary hover:underline">Deal{a.deal_ref ? ` #${a.deal_ref}` : ""} →</Link>}
            </div>
          </div>
        );
      })}
      {ownership.length > 0 && (
        <div className="border-t pt-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Ownership history</div>
          {ownership.map((o, i) => (
            <div key={i} className="text-[11px]">
              {when(o.date)}: {o.fromId ? <Link href={`/companies/${o.fromId}`} className="hover:underline">{o.from || "seller"}</Link> : (o.from || "seller")} → {o.toId ? <Link href={`/companies/${o.toId}`} className="hover:underline font-medium">{o.to || "buyer"}</Link> : (o.to || "buyer")}
              {o.dealId && <> · <Link href={`/deals/${o.dealId}`} className="text-primary hover:underline">deal</Link></>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Investment comps for the property sidebar ───────────────────────────────
// Investment trades live with the property, apart from the lease advisory
// comps (Woody, 2026-09-27): trades on this building, then comparable trades
// of the same use. Staff only.
function PropertyInvestmentCompsPanel({ propertyId }: { propertyId: string }) {
  const { data, isLoading } = useQuery<{ property: any; here: any[]; similar: any[] }>({ queryKey: ["/api/properties", propertyId, "investment-comps"] });
  const money = (v: any) => { const n = Number(v); return n ? (n >= 1e6 ? `£${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}m` : `£${Math.round(n / 1e3)}k`) : null; };
  const pct = (v: any) => { const n = Number(v); return n ? `${(n < 1 ? n * 100 : n).toFixed(2)}%` : null; };
  const when = (d: any) => { if (!d) return null; const t = new Date(d); return isNaN(+t) ? String(d) : t.toLocaleDateString("en-GB", { month: "short", year: "numeric" }); };
  const party = (name: string | null, id: string | null) => !name ? null : id
    ? <Link href={`/companies/${id}`} className="hover:underline">{name}</Link> : <span>{name}</span>;
  const row = (c: any, extra?: string) => (
    <div key={c.id} className="py-1.5 border-b last:border-0 text-xs" data-testid={`property-investment-comp-${c.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{c.property_name || "Trade"}</span>
        <span className="tabular-nums shrink-0">{[money(c.price), pct(c.cap_rate)].filter(Boolean).join(" · ")}</span>
      </div>
      <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-1">
        <span>{[c.status === "Sale - Pending" ? "Exchanged" : "Sold", when(c.transaction_date), c.city].filter(Boolean).join(" · ")}</span>
      </div>
      {(c.seller || c.buyer) && (
        <div className="text-[11px] text-muted-foreground">
          {c.seller && c.buyer ? <>{party(c.seller, c.seller_company_id)} → {party(c.buyer, c.buyer_company_id)}</>
            : c.seller ? <>Sold by {party(c.seller, c.seller_company_id)}</> : <>Bought by {party(c.buyer, c.buyer_company_id)}</>}
        </div>
      )}
      {extra && <div className="text-[10px] text-muted-foreground">{extra}</div>}
    </div>
  );
  if (isLoading) return <div className="text-xs text-muted-foreground py-2">Loading…</div>;
  const here = data?.here || [], similar = data?.similar || [];
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">This building</div>
        {here.length ? here.map(c => row(c)) : <div className="text-xs text-muted-foreground">No recorded trades.</div>}
      </div>
      {similar.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Comparable trades</div>
          {similar.map(c => row(c, (c.reasons || []).join(" · ")))}
        </div>
      )}
      <Link href="/investment-comps" className="text-[11px] text-primary hover:underline">All investment comps →</Link>
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
function AvailableUnitsPanel({ propertyId }: { propertyId: string; readOnly?: boolean }) {
  // Thin wrapper over the canonical tracker summary (Woody, 2026-08-03) —
  // the property sidebar, dashboard widget and page-header strip are all
  // the same component now.
  return <TrackerSummary variant="card" propertyId={propertyId} />;
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
      const r = await fetch(`/api/entity-images?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`, { credentials: "include", headers: getAuthHeaders() });
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
    const r = await fetch("/api/entity-images", { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
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
      const r = await fetch(`/api/entity-images/${id}`, { method: "DELETE", credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/entity-images", entityType, entityId] }),
  });

  const aiEditMutation = useMutation({
    mutationFn: async ({ id, prompt }: { id: string; prompt: string }) => {
      const r = await fetch(`/api/entity-images/${id}/ai-edit`, {
        method: "POST",
        credentials: "include",
        headers: { ...getAuthHeaders(), "content-type": "application/json" },
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
        headers: getAuthHeaders(),
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
            <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> {aiEditFor?.title || "Image"}</DialogTitle>
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
        headers: { ...getAuthHeaders(), "content-type": "application/json" },
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

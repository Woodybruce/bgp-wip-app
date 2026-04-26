import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import PathwayIntelStrip from "@/components/pathway-intel-strip";
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
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { PropertyLeasingSchedule } from "@/pages/leasing-schedule";
import { PropertyTenancySchedule } from "@/components/PropertyTenancySchedule";
import { LeasingPitchPanel } from "@/components/leasing-pitch-panel";
import { BrandGapPanel } from "@/components/brand-gap-panel";
import { trackRecentItem } from "@/hooks/use-recent-items";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { InlineText, InlineLabelSelect, InlineNumber } from "@/components/inline-edit";
import { buildUserColorMap } from "@/lib/agent-colors";
import { AddressAutocomplete, buildGoogleMapsUrl } from "@/components/address-autocomplete";
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
  InlineBillingEntity,
  InlineDeals,
  InlineTenants,
  SetUpFoldersDialog,
  PropertyFoldersPanel,
  PropertySharepointLink,
  LinkedDealsPanel,
  ClientBoardPanel,
  LinkedContactsPanel,
  LeasingTrackerSummary,
  PropertyIntelligencePanel,
  PropertyKycPanel,
  PropertyNewsPanel,
  Property360Panel,
  LinkedLandRegistryPanel,
  StreetViewCard,
  type DealLink,
} from "@/pages/properties";

export function PropertyDetail({ id }: { id: string }) {
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
  const { data: agentLinks = [] } = useQuery<{ propertyId: string; userId: string }[]>({
    queryKey: ["/api/crm/property-agents"],
  });
  const { data: allCompanies = [] } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
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
  const [sidebarSections, setSidebarSections] = useState<Record<string, boolean>>({
    details: true,
    files: true,
    team: true,
    clients: false,
    deals: false,
    landRegistry: false,
  });
  const toggleSection = (key: string) => setSidebarSections(prev => ({ ...prev, [key]: !prev[key] }));
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
      window.location.href = "/properties";
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
          <div className="p-4 sm:p-6 space-y-5">
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2" data-testid="button-back-properties" onClick={() => window.history.length > 1 ? window.history.back() : window.location.href = "/properties"}>
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
                        if (result?.formatted) updates.name = result.formatted;
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

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <InlineLabelSelect value={property.status} options={STATUS_OPTIONS} colorMap={PROPERTY_STATUS_COLORS} onSave={(val) => inlineUpdate("status", val)} placeholder="Set status" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Asset Class</p>
                  <InlineEngagement value={property.assetClass} options={ASSET_CLASS_OPTIONS} colorMap={ASSET_CLASS_COLORS} onSave={(val) => inlineUpdate("assetClass", val)} placeholder="Set class" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Tenure</p>
                  <InlineLabelSelect value={property.tenure} options={TENURE_OPTIONS} colorMap={TENURE_COLORS} onSave={(val) => inlineUpdate("tenure", val)} placeholder="Set tenure" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Team</p>
                  <InlineEngagement value={property.bgpEngagement} options={TEAM_OPTIONS} colorMap={TEAM_COLORS} onSave={(val) => inlineUpdate("bgpEngagement", val)} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Landlord / Client</p>
                  <InlineLandlord propertyId={id} landlordId={property.landlordId} allCompanies={allCompanies} />
                </CardContent>
              </Card>
              <Card className="border-amber-200 dark:border-amber-800">
                <CardContent className="p-3 space-y-1">
                  <div className="flex items-center gap-1">
                    <p className="text-xs text-muted-foreground">Billing Entity</p>
                    <Badge variant="outline" className="text-[8px] px-1 py-0 border-amber-300 text-amber-600">SPV</Badge>
                  </div>
                  <InlineBillingEntity propertyId={id} billingEntityId={property.billingEntityId} landlordId={property.landlordId} allCompanies={allCompanies} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Sq Ft</p>
                  <InlineNumber value={property.sqft} onSave={(val) => inlineUpdate("sqft", val)} suffix=" sf" className="text-sm font-mono font-medium" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Tenants</p>
                  <InlineTenants propertyId={id} tenantLinks={tenantLinks} allCompanies={allCompanies} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Website</p>
                  <InlineText value={property.website || ""} onSave={(val) => inlineUpdate("website", val)} placeholder="Set website" className="text-sm" />
                  {property.website && (
                    <a href={property.website.startsWith("http") ? property.website : `https://${property.website}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-1">
                      <Globe className="w-3 h-3" /> Open <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Notes</p>
                <InlineText value={property.notes || ""} onSave={(val) => inlineUpdate("notes", val)} placeholder="Add notes..." className="text-sm" multiline />
              </CardContent>
            </Card>

            <StreetViewCard address={formatAddress(property.address) || property.name} propertyName={property.name} />

            {(property.status === "Leasing Instruction" || property.status === "Lease Advisory Instruction") && (
              <LeasingTrackerSummary propertyId={property.id} />
            )}

            <Card>
              <CardContent className="p-4">
                <PropertyLeasingSchedule propertyId={property.id} />
              </CardContent>
            </Card>

            <ErrorBoundary compact name="Tenancy schedule">
              <Card>
                <CardContent className="p-4">
                  <PropertyTenancySchedule propertyId={property.id} />
                </CardContent>
              </Card>
            </ErrorBoundary>

            <ErrorBoundary compact name="Pathway intel strip">
              <PathwayIntelStrip
                propertyId={property.id}
                address={typeof property.address === "string" ? property.address : (property.address as any)?.line1 || property.name}
                postcode={(property as any).postcode || (property.address as any)?.postcode}
              />
            </ErrorBoundary>

            <ErrorBoundary compact name="Property 360">
              <Property360Panel propertyId={property.id} />
            </ErrorBoundary>

            <ErrorBoundary compact name="KYC panel">
              <PropertyKycPanel property={property} />
            </ErrorBoundary>

            <ErrorBoundary compact name="Property intelligence (Land Registry / planning)">
              <PropertyIntelligencePanel property={property} />
            </ErrorBoundary>

            <ErrorBoundary compact name="Leasing pitch">
              <LeasingPitchPanel propertyId={property.id} />
            </ErrorBoundary>

            <ErrorBoundary compact name="Brand gap">
              <BrandGapPanel propertyId={property.id} />
            </ErrorBoundary>

            <ErrorBoundary compact name="Property news">
              <PropertyNewsPanel propertyId={property.id} propertyName={property.name} />
            </ErrorBoundary>

            <ErrorBoundary compact name="Linked contacts">
              <LinkedContactsPanel propertyId={property.id} />
            </ErrorBoundary>

            <div className="md:hidden space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <PropertyFoldersPanel propertyName={property.name} folderTeams={property.folderTeams} />
                <LinkedDealsPanel propertyId={property.id} />
              </div>
              <Card>
                <CardContent className="p-4 space-y-1">
                  <p className="text-xs text-muted-foreground">BGP Contacts</p>
                  <InlineAgents propertyId={id} agentLinks={agentLinks} allUsers={allUsers} colorMap={userColorMap} />
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

        <div className="w-[300px] border-l bg-background flex flex-col shrink-0 h-full overflow-hidden hidden md:flex">
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
                  <PropertyFoldersPanel propertyName={property.name} folderTeams={property.folderTeams} />
                  <PropertySharepointLink propertyId={property.id} sharepointFolderUrl={property.sharepointFolderUrl} onUpdate={inlineUpdate} />
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
                  <InlineAgents propertyId={id} agentLinks={agentLinks} allUsers={allUsers} colorMap={userColorMap} />
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
                  <InlineDeals propertyId={id} dealLinks={dealLinks} allDeals={allDealsForDetail} />
                  <LinkedDealsPanel propertyId={property.id} />
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
